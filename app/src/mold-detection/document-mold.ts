import { rasterizeLabels, type Components } from './binary';
import { gaussianBlur } from './blur';
import { getColorChannels } from './color';
import { repairedCrop, type Box } from './document-stains';
import { cvRound, type BgrImage } from './image';
import { ALL_SIDES, MoldDetectionMask, ProcessingTimeout, type CandidateInfo } from './mold-detection';
import * as R from './raster';
import { channelHistogram } from './thresholds';
import { tick } from './yield';

const OKNO_NASOBOK = 2.5;
const OKNO_MIN = 48;
const OKNO_STRANA = 700;
const PREKRYV_ROZSIRENIE = 0.25;
const MIN_POKRYTIE = 0.3;
const MAX_OBDLZNIK = 0.92;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

function sameData(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Súčty po riadkoch (prefix) – počet jednotiek v úseku riadku za O(1). */
function rowPrefix(mask: Uint8Array, w: number, h: number): Int32Array {
  const pre = new Int32Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      s += mask[y * w + x] ? 1 : 0;
      pre[y * (w + 1) + x + 1] = s;
    }
  }
  return pre;
}

/** Okno okolo každej nájdenej oblasti zvlášť (od najväčšej). */
function windows(lm: R.LabelMap, w: number, h: number): { box: Box; label: number }[] {
  const order = Array.from({ length: lm.count }, (_, k) => k + 1).sort((a, b) => lm.area[b] - lm.area[a]);
  return order.map((i) => {
    const bw = lm.maxX[i] - lm.minX[i] + 1;
    const bh = lm.maxY[i] - lm.minY[i] + 1;
    const s = Math.max(OKNO_MIN, Math.trunc(Math.max(bw, bh) * OKNO_NASOBOK));
    const cx = lm.minX[i] + (bw >> 1);
    const cy = lm.minY[i] + (bh >> 1);
    let x0 = Math.max(0, cx - (s >> 1));
    let y0 = Math.max(0, cy - (s >> 1));
    const x1 = Math.min(w, x0 + s);
    const y1 = Math.min(h, y0 + s);
    x0 = Math.max(0, x1 - s);
    y0 = Math.max(0, y1 - s);
    return { box: [x0, y0, x1, y1] as Box, label: i };
  });
}

/** Vlastný algoritmus (createMoldMaskAuto) s podmienkou navyše. */
function bestMaskNear(
  detector: MoldDetectionMask,
  img: BgrImage,
  part: Uint8Array,
  deadline: number | null
): { mask: Uint8Array; info: CandidateInfo | null } {
  const { width: W, height: H } = img;
  const g = Math.max(2, Math.trunc((PREKRYV_ROZSIRENIE * Math.max(H, W)) / OKNO_NASOBOK));
  const nearPre = rowPrefix(R.dilateMask(part, W, H, R.disk(g)), W, H);
  const corePre = rowPrefix(part, W, H);
  let coreSum = 0;
  for (let y = 0; y < H; y++) coreSum += corePre[y * (W + 1) + W];
  const rangeSum = (pre: Int32Array, y: number, s: number, e: number) => pre[y * (W + 1) + e + 1] - pre[y * (W + 1) + s];

  let bestScore = -Infinity;
  let best: { comps: Components; keep: Uint8Array } | null = null;
  let info: CandidateInfo | null = null;
  const blurredSeen: Uint8Array[] = [];
  for (const [channelName, channel] of getColorChannels(img, detector.channels)) {
    const blurred = gaussianBlur(channel, 5);
    if (blurredSeen.some((b) => sameData(b, blurred.data))) continue;
    blurredSeen.push(blurred.data);
    const hist = channelHistogram(blurred.data);
    const seen = new Set<string>();
    for (const [methodName, fn] of detector.thresholdMethods) {
      let t: number;
      try {
        t = fn(hist);
      } catch {
        continue;
      }
      for (const polarity of ['below', 'above'] as const) {
        if (deadline !== null && now() > deadline) throw new ProcessingTimeout();
        const cut = MoldDetectionMask.integerCutoff(t, polarity);
        const key = `${polarity}:${cut}`;
        if (cut !== null && seen.has(key)) continue;
        seen.add(key);
        const { bits, count } = detector.maskFromThreshold(blurred, t, polarity);
        const evaluation = detector.evaluateCandidate(bits, count, ALL_SIDES);
        const cleaned = evaluation.cleaned;
        if (!cleaned) continue;
        const { comps, keep } = cleaned;
        const { runs, runLabel } = comps;
        const keepNear = new Uint8Array(comps.count + 1);
        for (let y = 0; y < H; y++) {
          for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
            const lab = runLabel[i];
            if (keep[lab] && !keepNear[lab] && rangeSum(nearPre, y, runs.xs[i], runs.xe[i]) > 0) keepNear[lab] = 1;
          }
        }
        let area = 0;
        let coreHits = 0;
        let bx0 = W;
        let by0 = H;
        let bx1 = -1;
        let by1 = -1;
        for (let lab = 1; lab <= comps.count; lab++) {
          if (!keepNear[lab]) continue;
          area += comps.area[lab];
          bx0 = Math.min(bx0, comps.minX[lab]);
          by0 = Math.min(by0, comps.minY[lab]);
          bx1 = Math.max(bx1, comps.maxX[lab]);
          by1 = Math.max(by1, comps.maxY[lab]);
        }
        if (area === 0) continue;
        for (let y = 0; y < H; y++) {
          for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
            if (keepNear[runLabel[i]]) coreHits += rangeSum(corePre, y, runs.xs[i], runs.xe[i]);
          }
        }
        if (coreHits < MIN_POKRYTIE * coreSum) continue;
        if (area > MAX_OBDLZNIK * (bx1 - bx0 + 1) * (by1 - by0 + 1)) continue;
        const coverage = area / (W * H);
        const score = detector.scoreWithContrast(
          detector.scoreMask({ ...cleaned, keep: keepNear, keptArea: area }, coverage),
          comps,
          keepNear,
          blurred
        );
        if (score > bestScore) {
          bestScore = score;
          best = { comps, keep: keepNear };
          info = { channel: channelName, method: methodName, polarity, coverage, score };
        }
      }
    }
  }
  if (best === null) return { mask: new Uint8Array(W * H), info: null };
  const m = rasterizeLabels(best.comps, W, H, best.keep);
  for (let i = 0; i < m.length; i++) m[i] = m[i] ? 1 : 0;
  return { mask: m, info };
}

/** Maska vlastného algoritmu v jednom okne (v súradniciach okna, 0/1). */
function maskInWindow(
  img: BgrImage,
  removed: Uint8Array,
  page: Uint8Array,
  labels: Int32Array,
  { box, label }: { box: Box; label: number },
  detector: MoldDetectionMask,
  deadline: number | null
): Uint8Array {
  const w = img.width;
  const [x0, y0, x1, y1] = box;
  const bw = x1 - x0;
  const bh = y1 - y0;
  const crop = repairedCrop(img, removed, box);
  const inside = new Uint8Array(bw * bh);
  const part = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (y0 + y) * w + x0 + x;
      inside[y * bw + x] = page[i] ? 1 : 0;
      part[y * bw + x] = labels[i] === label ? 1 : 0;
    }
  }
  const nIn = inside.reduce((s, v) => s + v, 0);
  if (nIn > 0 && nIn < inside.length) {
    for (let c = 0; c < 3; c++) {
      const hist = new Int32Array(256);
      for (let k = 0; k < inside.length; k++) if (inside[k]) hist[crop.data[3 * k + c]]++;
      let seen = 0;
      let lo = -1;
      let hi = -1;
      const r0 = (nIn - 1) >> 1;
      const r1 = nIn % 2 ? r0 : r0 + 1;
      for (let v = 0; v < 256 && hi < 0; v++) {
        seen += hist[v];
        if (lo < 0 && seen > r0) lo = v;
        if (seen > r1) hi = v;
      }
      const med = Math.floor((lo + hi) / 2);
      for (let k = 0; k < inside.length; k++) if (!inside[k]) crop.data[3 * k + c] = med;
    }
  }
  const f = OKNO_STRANA / Math.max(bh, bw);
  const W = Math.max(1, cvRound(bw * f));
  const H = Math.max(1, cvRound(bh * f));
  const bigData = f > 1 ? R.resizeCubicU8(crop.data, 3, bw, bh, W, H) : R.resizeAreaU8(crop.data, 3, bw, bh, W, H);
  const partBig = R.resizeNearest(part, 1, bw, bh, W, H);
  const { mask } = bestMaskNear(detector, { width: W, height: H, data: bigData }, partBig, deadline);
  return R.resizeNearest(mask, 1, W, H, bw, bh);
}

/** Maska vlastného algoritmu na celej stránke. */
export async function documentMoldMask(
  proposal: Uint8Array,
  img: BgrImage,
  removed: Uint8Array,
  page: Uint8Array,
  detector: MoldDetectionMask,
  deadline: number | null
): Promise<{ mask: Uint8Array; windows: number; processed: number; timedOut: boolean }> {
  const { width: w, height: h } = img;
  const lm = R.labelMap(proposal, w, h);
  const wins = windows(lm, w, h);
  const mask = new Uint8Array(w * h);
  let processed = 0;
  let timedOut = false;
  for (const win of wins) {
    const [x0, y0, x1, y1] = win.box;
    let covered = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) if (lm.labels[y * w + x] === win.label && mask[y * w + x]) covered++;
    }
    if (covered / lm.area[win.label] > 0.5) continue;
    if (deadline !== null && now() > deadline) {
      timedOut = true;
      break;
    }
    await tick();
    let m: Uint8Array;
    try {
      m = maskInWindow(img, removed, page, lm.labels, win, detector, deadline);
    } catch (err) {
      if (err instanceof ProcessingTimeout) {
        timedOut = true;
        break;
      }
      throw err;
    }
    processed++;
    const bw = x1 - x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (m[(y - y0) * bw + (x - x0)]) mask[y * w + x] = 1;
  }
  for (let i = 0; i < mask.length; i++) mask[i] &= page[i];
  return { mask, windows: wins.length, processed, timedOut };
}
