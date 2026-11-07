import { contourArea, traceOuterBorder } from './binary';
import { bgrToLab, labPixel } from './color';
import { convexHull } from './geometry';
import { cropBgr, cvRound, type BgrImage } from './image';
import * as R from './raster';
import { tick } from './yield';

export const WORK_SIDE = 1600;
const PROXY_SIDE = 400;
const PAPER_WINDOW = 4;
const INK_C = 10;
const STAIN_MIN_CHROMA = 4.0;
const HI_K = 4.0;
const LO_K = 2.0;
const HI_MIN = 4.5;
const LO_MIN = 3.5;
const MIN_CROP_AREA = 150;
const CROP_SCALE = 2.0;
const GROUP_GAP = 0.3;
const BLACKHAT_FACTOR = 2.5;
const BLACKHAT_K = 6.0;
const BLACKHAT_MIN = 6.0;
const DENSE_REPLACE = 0.35;
const BORDER_FRAC = 1 / 40;
const PRINT_DARK_FRAC = 0.55;
const PRINT_EDGE_W = 2.5;
const MIN_CONTRAST_DE = 7.0;
const INK_INSIDE_MAX = 0.8;
const INK_RING_MAX = 0.72;
const DENSE_MIN_WARM = 6.0;
const WARM_MIN_ABS = 2.0;
const WARM_ON_PRINT_MIN = 0.2;
const CONTRAST_GAP = 0.15;
const PRINT_WINDOW = 8;
const WARM_REF_GAP = 0.5;
const PRINT_LIGHTER_MAX = 3.0;
const PRINT_SOFT_EDGE = 6.0;
const DARK_ON_PRINT_DL = 15.0;
const PRINT_NEIGH_MIN = 15;
const PRINT_PIECE_MIN = 4;
const PRINT_PIECE_SOLIDITY = 0.5;
const ILLUS_FACTOR = 5.0;
const SOLID_DE = 15.0;
const SOLID_MIN_LETTERS = 2.0;
const SOLID_MIN_SIZE = 1.6;
const SOLID_EDGE_W = 2.5;
const DARK_BACKGROUND = 10.0;

/** L* (0–100), a*, b* ako float roviny. */
export type Planes = { L: Float32Array; A: Float32Array; B: Float32Array };
/** Obdĺžnik [x0, y0, x1, y1) v pixeloch. */
export type Box = [number, number, number, number];

const L_SCALE = 100 / 255;

function odd(x: number): number {
  const r = cvRound(x);
  return r % 2 ? r : r + 1;
}

function ones(n: number): Uint8Array {
  return new Uint8Array(n).fill(1);
}

function any(mask: Uint8Array): boolean {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return true;
  return false;
}

function count(mask: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) s++;
  return s;
}

/** keep[labels[i]] pre každý pixel. */
function fromLabels(labels: Int32Array, keep: Uint8Array): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = keep[labels[i]];
  return out;
}

function labelIs(labels: Int32Array, lab: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) if (labels[i] === lab) out[i] = 1;
  return out;
}

function andMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) out[i] = 1;
  return out;
}

function andNot(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (a[i] && !b[i]) out[i] = 1;
  return out;
}

function notMask(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) if (!a[i]) out[i] = 1;
  return out;
}

/** _lab: cv2.cvtColor(BGR -> LAB) ako float – L* 0–100, a*, b* okolo nuly. */
function labPlanes(img: BgrImage): Planes {
  const [L, A, B] = bgrToLab(img);
  const n = img.width * img.height;
  const out: Planes = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    out.L[i] = L.data[i] * L_SCALE;
    out.A[i] = A.data[i] - 128;
    out.B[i] = B.data[i] - 128;
  }
  return out;
}

/** Výrez [x0, x1) x [y0, y1) z jednokanálového poľa šírky w. */
function cropArr<T extends Uint8Array | Float32Array | Int32Array>(src: T, w: number, [x0, y0, x1, y1]: Box): T {
  const bw = x1 - x0;
  const out = new (src.constructor as { new (n: number): T })(bw * (y1 - y0));
  for (let y = y0; y < y1; y++) out.set(src.subarray(y * w + x0, y * w + x1) as never, (y - y0) * bw);
  return out;
}

function cropPlanes(p: Planes, w: number, box: Box): Planes {
  return { L: cropArr(p.L, w, box), A: cropArr(p.A, w, box), B: cropArr(p.B, w, box) };
}

/** Maska labelu `lab` v obdĺžniku. */
function labelCrop(labels: Int32Array, w: number, [x0, y0, x1, y1]: Box, lab: number): Uint8Array {
  const bw = x1 - x0;
  const out = new Uint8Array(bw * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (labels[y * w + x] === lab) out[(y - y0) * bw + (x - x0)] = 1;
  }
  return out;
}

/** Hodnoty roviny pod maskou. */
function valuesAt(plane: ArrayLike<number>, mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(plane[i]);
  return out;
}

/** np.median nad hodnotami histogramu (index = hodnota). */
function histMedian(hist: Int32Array, total: number): number {
  const at = (rank: number) => {
    let seen = 0;
    for (let v = 0; v < hist.length; v++) {
      seen += hist[v];
      if (seen > rank) return v;
    }
    return hist.length - 1;
  };
  const lo = (total - 1) >> 1;
  return total % 2 ? at(lo) : (at(lo) + at(lo + 1)) / 2;
}

/** np.median(img[mask], axis=0).astype(np.uint8) pre BGR obrázok (zaokrúhlenie nadol). */
function medianColor(data: Uint8Array, mask: Uint8Array): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const hist = new Int32Array(256);
    let total = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      hist[data[3 * i + c]]++;
      total++;
    }
    out[c] = Math.floor(histMedian(hist, total));
  }
  return out;
}

class ColorField {
  private readonly xa: Int32Array;
  private readonly xb: Int32Array;
  private readonly ax: Float32Array;

  static fromBgr(bg: Uint8Array, sw: number, sh: number, w: number, h: number): ColorField {
    return new ColorField(bg, null, sw, sh, w, h);
  }

  static fromPlanes(planes: Planes, w: number, h: number): ColorField {
    return new ColorField(null, planes, w, h, w, h);
  }

  private constructor(
    private readonly bg: Uint8Array | null,
    private readonly planes: Planes | null,
    private readonly sw: number,
    private readonly sh: number,
    readonly w: number,
    readonly h: number
  ) {
    this.xa = new Int32Array(w);
    this.xb = new Int32Array(w);
    this.ax = new Float32Array(w);
    for (let x = 0; x < w; x++) [this.xa[x], this.xb[x], this.ax[x]] = linearTap(x, sw / w, sw);
  }

  region(box: Box): Planes {
    if (this.planes) return cropPlanes(this.planes, this.w, box);
    const [x0, y0, x1, y1] = box;
    const bw = x1 - x0;
    const n = bw * (y1 - y0);
    const out: Planes = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
    const bg = this.bg!;
    const { sw, sh, h, xa, xb, ax } = this;
    let lastKey = -1;
    let lab = 0;
    for (let y = y0; y < y1; y++) {
      const [ya, yb, ay] = linearTap(y, sh / h, sh);
      const ra = ya * sw;
      const rb = yb * sw;
      const o = (y - y0) * bw - x0;
      for (let x = x0; x < x1; x++) {
        const a = ax[x];
        const p00 = (ra + xa[x]) * 3;
        const p01 = (ra + xb[x]) * 3;
        const p10 = (rb + xa[x]) * 3;
        const p11 = (rb + xb[x]) * 3;
        let key = 0;
        for (let c = 0; c < 3; c++) {
          const top = bg[p00 + c] + (bg[p01 + c] - bg[p00 + c]) * a;
          const bottom = bg[p10 + c] + (bg[p11 + c] - bg[p10 + c]) * a;
          const v = cvRound(top + (bottom - top) * ay);
          key = (key << 8) | (v < 0 ? 0 : v > 255 ? 255 : v);
        }
        if (key !== lastKey) {
          lab = labPixel(key & 255, (key >>> 8) & 255, key >>> 16);
          lastKey = key;
        }
        out.L[o + x] = (lab >>> 16) * L_SCALE;
        out.A[o + x] = ((lab >>> 8) & 255) - 128;
        out.B[o + x] = (lab & 255) - 128;
      }
    }
    return out;
  }

  full(): Planes {
    return this.region([0, 0, this.w, this.h]);
  }
}

function linearTap(d: number, scale: number, srcLen: number): [number, number, number] {
  const f = (d + 0.5) * scale - 0.5;
  let s0 = Math.floor(f);
  let a = f - s0;
  if (s0 < 0) {
    s0 = 0;
    a = 0;
  }
  if (s0 >= srcLen - 1) {
    s0 = srcLen - 1;
    a = 0;
  }
  return [s0, Math.min(s0 + 1, srcLen - 1), a];
}

function proxySize(w: number, h: number): [number, number] {
  const f = Math.min(1, PROXY_SIDE / Math.max(h, w));
  return [Math.max(8, cvRound(w * f)), Math.max(8, cvRound(h * f))];
}

/** Papier = najväčšia svetlá oblasť (s vyplnenými dierami), mierne zmenšená od okraja. */
export function pageMask(img: BgrImage, L8?: Uint8Array): Uint8Array {
  const { width: w, height: h } = img;
  const n = w * h;
  const side = Math.max(w, h);
  const L = R.gaussianU8(L8 ?? bgrToLab(img)[0].data, w, h, Math.max(2, side / 300));
  const b = Math.max(2, Math.trunc(Math.min(h, w) / 25));
  const hb = new Int32Array(256);
  let nb = 0;
  const addRows = (r0: number, r1: number) => {
    for (let y = Math.max(0, r0); y < Math.min(h, r1); y++) for (let x = 0; x < w; x++, nb++) hb[L[y * w + x]]++;
  };
  const addCols = (c0: number, c1: number) => {
    for (let y = 0; y < h; y++) for (let x = Math.max(0, c0); x < Math.min(w, c1); x++, nb++) hb[L[y * w + x]]++;
  };
  addRows(0, b);
  addRows(h - b, h);
  addCols(0, b);
  addCols(w - b, w);
  const hc = new Int32Array(256);
  let nc = 0;
  for (let y = Math.trunc(h / 4); y < Math.trunc((3 * h) / 4); y++) {
    for (let x = Math.trunc(w / 4); x < Math.trunc((3 * w) / 4); x++, nc++) hc[L[y * w + x]]++;
  }
  if (histMedian(hb, nb) > 0.6 * histMedian(hc, nc)) return ones(n);

  const t = R.otsuThreshold(L);
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (L[i] > t) bright[i] = 1;
  const lm = R.labelMap(bright, w, h);
  if (lm.count === 0) return ones(n);
  let big = 1;
  for (let lab = 2; lab <= lm.count; lab++) if (lm.area[lab] > lm.area[big]) big = lab;
  let page: Uint8Array = R.fillHolesMask(labelIs(lm.labels, big), w, h);
  const frac = count(page) / n;
  if (frac > 0.97 || frac < 0.2) page = ones(n);
  return R.erodeMask(page, w, h, R.disk(side / 80));
}

/** Typický polomer ťahu písma v px. */
function strokeWidth(L8: Uint8Array, w: number, h: number, page: Uint8Array): number {
  const n = w * h;
  const block = odd(Math.max(15, Math.max(w, h) / 30));
  const sigma = 0.3 * ((block - 1) * 0.5 - 1) + 0.8;
  const mean = R.gaussianU8(L8, w, h, sigma, block);
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = page[i] && L8[i] - mean[i] <= -INK_C ? 1 : 0;
  const lm = R.labelMap(dark, w, h);
  if (lm.count === 0) return 2.0;
  const dt = R.distanceTransform(dark, w, h);
  const peak = new Float32Array(lm.count + 1);
  for (let i = 0; i < n; i++) if (dt[i] > peak[lm.labels[i]]) peak[lm.labels[i]] = dt[i];
  const peaks: number[] = [];
  for (let lab = 1; lab <= lm.count; lab++) if (lm.area[lab] >= 8) peaks.push(peak[lab]);
  return peaks.length ? R.percentile(peaks, 75) : 2.0;
}

export type TextRemoval = {
  cleaned: BgrImage;
  removed: Uint8Array;
  r: number;
  lines: Uint8Array;
};

/** Odstráni text a tlačené vzory. */
export function removeText(img: BgrImage, L8: Uint8Array, page: Uint8Array, fill: boolean): TextRemoval {
  const { width: w, height: h } = img;
  const n = w * h;
  const stroke = strokeWidth(L8, w, h, page);
  const r = Math.max(2, cvRound(BLACKHAT_FACTOR * stroke));
  const closed = R.grayClose(L8, w, h, R.disk(r));
  const bh = new Uint8Array(n);
  const hist = new Int32Array(256);
  let total = 0;
  for (let i = 0; i < n; i++) {
    bh[i] = closed[i] - L8[i];
    if (page[i]) {
      hist[bh[i]]++;
      total++;
    }
  }
  let med = 0;
  let mad = 0;
  if (total > 0) {
    med = histMedian(hist, total);
    const dev2 = new Int32Array(512);
    for (let v = 0; v < 256; v++) if (hist[v]) dev2[Math.abs(2 * v - 2 * med)] += hist[v];
    mad = histMedian(dev2, total) / 2;
  }
  med *= L_SCALE;
  mad = 1.4826 * mad * L_SCALE + 1e-3;
  const thr = Math.max(BLACKHAT_MIN, med + BLACKHAT_K * mad);
  const weak = new Uint8Array(n);
  for (let i = 0; i < n; i++) weak[i] = page[i] && bh[i] * L_SCALE > 0.5 * thr ? 1 : 0;
  const lm = R.labelMap(weak, w, h);
  const keep = new Uint8Array(lm.count + 1);
  for (let i = 0; i < n; i++) if (page[i] && bh[i] * L_SCALE > thr) keep[lm.labels[i]] = 1;
  keep[0] = 0;
  const lines = fromLabels(lm.labels, keep);
  const removed = R.dilateMask(lines, w, h, R.disk(Math.max(1, stroke * 0.6)));
  return { cleaned: fill ? fillBackground(img, removed, r) : img, removed, r, lines };
}

/** Vyplní atrament farbou pozadia z morfologického uzavretia (každý kanál BGR, okno r) */
function fillBackground(img: BgrImage, hole: Uint8Array, r: number): BgrImage {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const hw = R.disk(r);
  const bg = new Uint8Array(n * 3);
  const ch = new Uint8Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = data[3 * i + c];
    const smooth = R.gaussianU8(R.grayClose(ch, w, h, hw), w, h, Math.max(1, r / 2));
    for (let i = 0; i < n; i++) bg[3 * i + c] = smooth[i];
  }
  const density = R.boxMeanF(R.toFloat(hole), w, h, odd(4 * r + 1));
  const out = data.slice();
  for (let i = 0; i < n; i++) {
    if (hole[i] || density[i] > DENSE_REPLACE) {
      out[3 * i] = bg[3 * i];
      out[3 * i + 1] = bg[3 * i + 1];
      out[3 * i + 2] = bg[3 * i + 2];
    }
  }
  return { width: w, height: h, data: out };
}

/** Farba papiera pre každý pixel. */
function paperEstimate(img: BgrImage, exclude: Uint8Array, page: Uint8Array): ColorField {
  const { width: w, height: h } = img;
  const [sw, sh] = proxySize(w, h);
  const ex = R.resizeNearest(exclude, 1, w, h, sw, sh);
  const pg = R.resizeNearest(page, 1, w, h, sw, sh);
  const small = R.inpaintBgr(R.resizeAreaU8(img.data, 3, w, h, sw, sh), sw, sh, R.dilateMask(ex, sw, sh, R.disk(1)));
  const good = andNot(pg, ex);
  if (any(good)) {
    const [b, g, r] = medianColor(small, good);
    for (let i = 0; i < sw * sh; i++) {
      if (pg[i]) continue;
      small[3 * i] = b;
      small[3 * i + 1] = g;
      small[3 * i + 2] = r;
    }
  }
  const k = odd(Math.max(sw, sh) / PAPER_WINDOW);
  return ColorField.fromBgr(R.medianBlurBgr(small, sw, sh, Math.min(k, 255)), sw, sh, w, h);
}

/** Očakávaná farba tlače: ako paperEstimate, ale len z pixelov tlače (illus) a s menším oknom. */
function printEstimate(cleaned: BgrImage, clean: Planes, illus: Uint8Array): ColorField {
  const { width: w, height: h } = cleaned;
  const [sw, sh] = proxySize(w, h);
  const ill = R.resizeNearest(illus, 1, w, h, sw, sh);
  if (!any(ill)) return ColorField.fromPlanes(clean, w, h);
  const small = R.inpaintBgr(R.resizeAreaU8(cleaned.data, 3, w, h, sw, sh), sw, sh, notMask(ill));
  const k = odd(Math.max(sw, sh) / PRINT_WINDOW);
  return ColorField.fromBgr(R.medianBlurBgr(small, sw, sh, Math.min(k, 255)), sw, sh, w, h);
}

/** Farebný rozdiel voči papieru a prah s hysterézou podľa šumu papiera. */
function stainMask(lab: Planes, paper: Planes, page: Uint8Array, w: number, h: number, darkOk: Uint8Array): Uint8Array {
  const n = w * h;
  const side = Math.max(h, w);
  const de0 = new Float32Array(n);
  const chroma0 = new Float32Array(n);
  const warm0 = new Float32Array(n);
  const dLs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dL = lab.L[i] - paper.L[i];
    const da = lab.A[i] - paper.A[i];
    const db = lab.B[i] - paper.B[i];
    de0[i] = dL > 2 && db < 2 && da < 2 ? 0 : Math.sqrt(0.25 * dL * dL + da * da + db * db);
    chroma0[i] = Math.sqrt(da * da + db * db);
    warm0[i] = Math.max(da, db);
    dLs[i] = dL;
  }
  const chroma = R.gaussianF(chroma0, w, h, 1.2);
  const de = R.gaussianF(de0, w, h, 1.2);
  const warm = R.gaussianF(warm0, w, h, 1.2);
  const { med, mad } = noiseStats(de, page);
  const hi = Math.max(med + HI_K * mad, HI_MIN);
  const lo = Math.max(med + LO_K * mad, LO_MIN);
  const weak = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const colored = (chroma[i] >= STAIN_MIN_CHROMA && warm[i] > 1.0) || (darkOk[i] && dLs[i] < -LO_MIN);
    if (!page[i] || !colored) de[i] = 0;
    weak[i] = de[i] > lo ? 1 : 0;
  }
  const lm = R.labelMap(weak, w, h);
  const keep = new Uint8Array(lm.count + 1);
  for (let i = 0; i < n; i++) if (de[i] > hi) keep[lm.labels[i]] = 1;
  keep[0] = 0;
  let mask: Uint8Array = fromLabels(lm.labels, keep);
  mask = R.closeMask(mask, w, h, R.disk(Math.max(1, side / 600)));
  mask = R.fillExternal(mask, w, h, Math.max(12, Math.trunc(side * side * 4e-6)));
  for (let i = 0; i < n; i++) mask[i] &= page[i];
  return mask;
}

/** Medián a 1,4826 * MAD hodnôt (ΔE >= 0) pod maskou. */
function noiseStats(values: Float32Array, mask: Uint8Array): { med: number; mad: number } {
  const BIN = 100;
  const MAX = 30000;
  const hist = new Int32Array(MAX + 1);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if (!mask[i]) continue;
    const b = Math.round(values[i] * BIN);
    hist[b < MAX ? b : MAX]++;
    total++;
  }
  if (total === 0) return { med: 0, mad: 1 };
  const med2 = Math.round(2 * histMedian(hist, total));
  const dev = new Int32Array(2 * MAX + 2);
  for (let b = 0; b <= MAX; b++) if (hist[b]) dev[Math.abs(2 * b - med2)] += hist[b];
  return { med: med2 / 2 / BIN, mad: (1.4826 * histMedian(dev, total)) / 2 / BIN };
}

/** Teplé zafarbenie: posun do žlta alebo červena voči papieru a farba na teplej strane neutrálnej. */
function isWarm(a: number, b: number, pa: number, pb: number): boolean {
  return Math.max(a - pa, b - pb) >= DENSE_MIN_WARM && Math.max(a, b) > WARM_MIN_ABS;
}

/** Nález výrazne zafarbený do teplých tónov (medián farby nálezu na stránke bez tlače). */
function isWarmStain(c: Uint8Array, clean: Planes, paper: Planes, w: number, box: Box): boolean {
  const cl = cropPlanes(clean, w, box);
  const pp = cropPlanes(paper, w, box);
  return isWarm(R.median(valuesAt(cl.A, c)), R.median(valuesAt(cl.B, c)), R.median(valuesAt(pp.A, c)), R.median(valuesAt(pp.B, c)));
}

/** smooth_lab v obdĺžniku: Gauss (sigma 2) okolia, z ktorého sa vezme len obdĺžnik. */
function smoothRegion(p: Planes, w: number, h: number, [x0, y0, x1, y1]: Box): Planes {
  const pad = 8;
  const X0 = Math.max(0, x0 - pad);
  const Y0 = Math.max(0, y0 - pad);
  const X1 = Math.min(w, x1 + pad);
  const Y1 = Math.min(h, y1 + pad);
  const cw = X1 - X0;
  const ch = Y1 - Y0;
  const inner: Box = [x0 - X0, y0 - Y0, x1 - X0, y1 - Y0];
  const blur = (plane: Float32Array) => cropArr(R.gaussianF(cropArr(plane, w, [X0, Y0, X1, Y1]), cw, ch, 2), cw, inner);
  return { L: blur(p.L), A: blur(p.A), B: blur(p.B) };
}

function warmOnPrint(s: Planes, ref: Planes): Uint8Array {
  const out = new Uint8Array(s.L.length);
  for (let i = 0; i < out.length; i++) {
    const L = s.L[i];
    if ((isWarm(s.A[i], s.B[i], ref.A[i], ref.B[i]) && L <= ref.L[i] + PRINT_LIGHTER_MAX) || L < ref.L[i] - DARK_ON_PRINT_DL) {
      out[i] = 1;
    }
  }
  return out;
}

/** Šírka prechodu na okraji oblasti c (px): kontrast voči okoliu / strmosť jasu na okraji. */
function edgeWidth(L: Float32Array, c: Uint8Array, bw: number, bh: number): number {
  const d2 = R.dilateMask(c, bw, bh, R.disk(2));
  const e2 = R.erodeMask(c, bw, bh, R.disk(2));
  const d6 = R.dilateMask(c, bw, bh, R.disk(6));
  const band = andNot(d2, e2);
  const ring = andNot(d6, d2);
  if (!any(ring)) return Infinity;
  const grad = R.sobelMagBox(L, bw, bh, 0, 0, bw, bh);
  const contrast = R.median(valuesAt(L, ring)) - R.percentile(valuesAt(L, c), 10);
  return contrast / (R.percentile(valuesAt(grad, band), 90) + 1e-3);
}

/** Prvý pixel (v poradí riadkov) – začiatok sledovania kontúry. */
function firstPixel(mask: Uint8Array, w: number): [number, number] {
  for (let i = 0; i < mask.length; i++) if (mask[i]) return [i % w, Math.trunc(i / w)];
  return [0, 0];
}

/** Odstráni z nálezov tlač (mapa illus). */
function stripPrint(
  mask: Uint8Array,
  w: number,
  h: number,
  illus: Uint8Array,
  clean: Planes,
  printField: ColorField,
  minArea: number
): Uint8Array {
  const lm = R.labelMap(mask, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 1; i <= lm.count; i++) {
    const box: Box = [
      Math.max(0, lm.minX[i] - 6),
      Math.max(0, lm.minY[i] - 6),
      Math.min(w, lm.maxX[i] + 1 + 6),
      Math.min(h, lm.maxY[i] + 1 + 6),
    ];
    const [x0, y0, x1, y1] = box;
    const bw = x1 - x0;
    const bh = y1 - y0;
    const paste = (m: Uint8Array) => {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (m[y * bw + x]) out[(y0 + y) * w + x0 + x] = 1;
    };
    const c0 = labelCrop(lm.labels, w, box, i);
    const ill = cropArr(illus, w, box);
    const on = andMask(c0, ill);
    if (!any(on)) {
      paste(c0);
      continue;
    }
    const slab = smoothRegion(clean, w, h, box);
    const pref = printField.region(box);
    const wp = warmOnPrint(slab, pref);
    const cSum = count(c0);
    let c: Uint8Array;
    if (count(on) > 0.5 * cSum) {
      c = andMask(c0, wp);
      if (count(c) < WARM_ON_PRINT_MIN * cSum) continue;
    } else {
      c = andNot(c0, andNot(on, wp));
    }
    const pl = R.labelMap(c, bw, bh);
    const cleanL = cropArr(clean.L, w, box);
    for (let j = 1; j <= pl.count; j++) {
      if (pl.area[j] < minArea) continue;
      const piece = labelIs(pl.labels, j);
      const pieceSum = pl.area[j];
      let onIll = 0;
      for (let k = 0; k < piece.length; k++) if (piece[k] && ill[k]) onIll++;
      if (onIll > 0.5 * pieceSum) {
        if (pieceSum < PRINT_PIECE_MIN * minArea) continue;
        const g = Math.max(PRINT_NEIGH_MIN, Math.trunc(WARM_REF_GAP * Math.sqrt(pieceSum)));
        const pw = bw + 2 * g;
        const pb = new Uint8Array(pw * (bh + 2 * g));
        for (let y = 0; y < bh; y++) pb.set(piece.subarray(y * bw, (y + 1) * bw), (y + g) * pw + g);
        const pd = R.dilateMask(pb, pw, bh + 2 * g, R.disk(g));
        let neigh = 0;
        for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (pd[(y + g) * pw + x + g] && c0[y * bw + x]) neigh++;
        if (pieceSum < WARM_ON_PRINT_MIN * neigh) continue;
        const [sx, sy] = firstPixel(piece, bw);
        const hull = convexHull(traceOuterBorder(R.toBits(piece, bw, bh), sx, sy));
        if (pieceSum < PRINT_PIECE_SOLIDITY * contourArea(hull)) continue;
        const warm = isWarm(
          R.median(valuesAt(slab.A, piece)),
          R.median(valuesAt(slab.B, piece)),
          R.median(valuesAt(pref.A, piece)),
          R.median(valuesAt(pref.B, piece))
        );
        if (!warm && edgeWidth(cleanL, piece, bw, bh) < PRINT_SOFT_EDGE) continue;
      }
      paste(piece);
    }
  }
  return out;
}

/** Vyradí nálezy, ktoré nie sú škvrny. */
function filterComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  L8: Uint8Array,
  page: Uint8Array,
  ink: Uint8Array,
  r: number,
  clean: Planes,
  paper: Planes,
  illus: Uint8Array,
  printField: ColorField
): Uint8Array {
  const side = Math.max(h, w);
  const minArea = Math.max(12, Math.trunc(side * side * 4e-6));
  const stripped = stripPrint(mask, w, h, illus, clean, printField, minArea);
  const frame = page.slice();
  for (let x = 0; x < w; x++) frame[x] = frame[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) frame[y * w] = frame[y * w + w - 1] = 0;
  const pdist = R.distanceTransform(frame, w, h);
  const lm = R.labelMap(stripped, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 1; i <= lm.count; i++) {
    const x = lm.minX[i];
    const y = lm.minY[i];
    const bw = lm.maxX[i] - x + 1;
    const bh = lm.maxY[i] - y + 1;
    const box: Box = [Math.max(0, x - 6), Math.max(0, y - 6), Math.min(w, x + bw + 6), Math.min(h, y + bh + 6)];
    const [x0, y0, x1, y1] = box;
    const cw = x1 - x0;
    const ch = y1 - y0;
    const c = labelCrop(lm.labels, w, box, i);
    const cSum = count(c);
    const pd = cropArr(pdist, w, box);
    let atBorder = 0;
    for (let k = 0; k < c.length; k++) if (c[k] && pd[k] < side * BORDER_FRAC) atBorder++;
    if (atBorder / cSum > 0.5) continue;
    const warm = isWarmStain(c, clean, paper, w, box);
    const q = 3 * r + 2;
    const boxQ: Box = [Math.max(0, x - q), Math.max(0, y - q), Math.min(w, x + bw + q), Math.min(h, y + bh + q)];
    const qw = boxQ[2] - boxQ[0];
    const qh = boxQ[3] - boxQ[1];
    const cbig = labelCrop(lm.labels, w, boxQ, i);
    const inkC = cropArr(ink, w, boxQ);
    const dBig = R.dilateMask(cbig, qw, qh, R.disk(3 * r));
    const d2Big = R.dilateMask(cbig, qw, qh, R.disk(2));
    let inkIn = 0;
    let ringN = 0;
    let ringInk = 0;
    for (let k = 0; k < cbig.length; k++) {
      if (cbig[k] && inkC[k]) inkIn++;
      if (dBig[k] && !d2Big[k]) {
        ringN++;
        if (inkC[k]) ringInk++;
      }
    }
    const dense = inkIn / cSum > INK_INSIDE_MAX || (ringN > 0 && ringInk / ringN > INK_RING_MAX);
    if (dense && !warm) continue;
    const d3 = R.dilateMask(c, cw, ch, R.disk(3));
    const d2 = R.dilateMask(c, cw, ch, R.disk(2));
    const e2 = R.erodeMask(c, cw, ch, R.disk(2));
    const ring = andNot(d3, c);
    const band = andNot(d2, e2);
    const L8c = cropArr(L8, w, box);
    const Lc = new Float32Array(L8c.length);
    for (let k = 0; k < Lc.length; k++) Lc[k] = L8c[k] * L_SCALE;
    const inside = valuesAt(Lc, c);
    const darkLvl = R.percentile(inside, 10);
    const contrast = any(ring) ? R.median(valuesAt(Lc, ring)) - darkLvl : 0;
    if (contrast > 0) {
      const grad = R.sobelMagBox(L8, w, h, x0, y0, x1, y1);
      const edgeW = contrast / (R.percentile(valuesAt(grad, band), 90) * L_SCALE + 1e-3);
      let darkN = 0;
      for (const v of inside) if (v < darkLvl + 0.25 * contrast) darkN++;
      if (darkN / inside.length > PRINT_DARK_FRAC && edgeW < PRINT_EDGE_W) continue;
    }
    const g = Math.max(3, Math.trunc(CONTRAST_GAP * Math.sqrt(cSum)));
    const boxG: Box = [Math.max(0, x0 - g - 3), Math.max(0, y0 - g - 3), Math.min(w, x1 + g + 3), Math.min(h, y1 + g + 3)];
    const gw = boxG[2] - boxG[0];
    const gh = boxG[3] - boxG[1];
    const cb = new Uint8Array(gw * gh);
    for (let yy = 0; yy < ch; yy++) cb.set(c.subarray(yy * cw, (yy + 1) * cw), (y0 - boxG[1] + yy) * gw + (x0 - boxG[0]));
    const dFar = R.dilateMask(cb, gw, gh, R.disk(g + 3));
    const dNear = R.dilateMask(cb, gw, gh, R.disk(g));
    const pg = cropArr(page, w, boxG);
    const far = andMask(andNot(dFar, dNear), pg);
    let de = 0;
    if (any(far)) {
      const labc = cropPlanes(clean, w, boxG);
      const diff = [labc.L, labc.A, labc.B].map((p) => R.median(valuesAt(p, cb)) - R.median(valuesAt(p, far)));
      de = Math.hypot(diff[0], diff[1], diff[2]);
    }
    if (de < MIN_CONTRAST_DE) continue;
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (c[yy * cw + xx]) out[(y0 + yy) * w + x0 + xx] = 1;
  }
  return out;
}

/** Oblasti ilustrácií (rytiny, šrafované plochy, vzory) */
function illustrationMask(ink: Uint8Array, w: number, h: number, page: Uint8Array): Uint8Array {
  return illustrationFromLabels(R.labelMap(ink, w, h), w, h, page);
}

/** Typická výška písmena: medián výšok útvarov atramentu s plochou aspoň 10 px (null bez nich). */
function letterHeight(lm: R.LabelMap): number | null {
  const heights: number[] = [];
  for (let lab = 1; lab <= lm.count; lab++) if (lm.area[lab] >= 10) heights.push(lm.maxY[lab] - lm.minY[lab] + 1);
  return heights.length ? R.median(heights) : null;
}

function illustrationFromLabels(lm: R.LabelMap, w: number, h: number, page: Uint8Array): Uint8Array {
  if (lm.count === 0) return new Uint8Array(w * h);
  const letter = letterHeight(lm) ?? 10.0;
  const t = ILLUS_FACTOR * letter;
  const big = new Uint8Array(lm.count + 1);
  let found = false;
  for (let lab = 1; lab <= lm.count; lab++) {
    if (lm.maxY[lab] - lm.minY[lab] + 1 > t && lm.maxX[lab] - lm.minX[lab] + 1 > t) {
      big[lab] = 1;
      found = true;
    }
  }
  if (!found) return new Uint8Array(w * h);
  let m: Uint8Array = fromLabels(lm.labels, big);
  m = R.fillHolesMask(R.closeMask(m, w, h, R.disk(Math.max(2, letter))), w, h);
  for (let i = 0; i < m.length; i++) m[i] &= page[i];
  return m;
}

/** Spoločný začiatok mapy tlače aj detekcie: Lab (8-bitový), maska stránky a text bez vyplnenia. */
export type TextPrep = {
  lab: [Uint8Array, Uint8Array, Uint8Array];
  page: Uint8Array;
  text: TextRemoval;
};

/** Lab, maska stránky a odstránenie textu (bez vyplnenia). */
export async function prepareText(img: BgrImage): Promise<TextPrep> {
  const [L, A, B] = bgrToLab(img);
  const page = pageMask(img, L.data);
  await tick();
  return { lab: [L.data, A.data, B.data], page, text: removeText(img, L.data, page, false) };
}

export async function printMap(img: BgrImage, workW: number, workH: number, prep?: TextPrep): Promise<Uint8Array> {
  const { width: w, height: h } = img;
  const n = w * h;
  prep ??= await prepareText(img);
  const { page } = prep;
  const { lines, removed, r } = prep.text;
  await tick();
  const [L8, A8, B8] = bgrToLab(fillBackground(img, removed, r)).map((p) => p.data);
  const ll = R.labelMap(lines, w, h);
  const letter = letterHeight(ll) ?? 8.0;
  const paper = paperEstimate(img, lines, page);
  await tick();
  const darkBg = new Uint8Array(n);
  const solid = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const row = paper.region([0, y, w, y + 1]);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dL = L8[i] * L_SCALE - row.L[x];
      if (dL < -DARK_BACKGROUND) darkBg[i] = 1;
      if (!page[i]) continue;
      const da = A8[i] - 128 - row.A[x];
      const db = B8[i] - 128 - row.B[x];
      if (Math.sqrt(0.25 * dL * dL + da * da + db * db) > SOLID_DE) solid[i] = 1;
    }
  }
  const m = illustrationFromLabels(R.labelMap(andNot(lines, darkBg), w, h), w, h, page);
  const sl = R.labelMap(solid, w, h);
  for (let lab = 1; lab <= sl.count; lab++) {
    const bw = sl.maxX[lab] - sl.minX[lab] + 1;
    const bh = sl.maxY[lab] - sl.minY[lab] + 1;
    if (sl.area[lab] < SOLID_MIN_LETTERS * letter * letter || Math.min(bw, bh) < SOLID_MIN_SIZE * letter) continue;
    const box: Box = [
      Math.max(0, sl.minX[lab] - 3),
      Math.max(0, sl.minY[lab] - 3),
      Math.min(w, sl.minX[lab] + bw + 3),
      Math.min(h, sl.minY[lab] + bh + 3),
    ];
    const cw = box[2] - box[0];
    const ch = box[3] - box[1];
    const c = labelCrop(sl.labels, w, box, lab);
    const d2 = R.dilateMask(c, cw, ch, R.disk(2));
    const e2 = R.erodeMask(c, cw, ch, R.disk(2));
    const band = andNot(d2, e2);
    const pp = paper.region(box);
    const Lc = cropArr(L8, w, box);
    const dLc = new Float32Array(Lc.length);
    for (let k = 0; k < Lc.length; k++) dLc[k] = Lc[k] * L_SCALE - pp.L[k];
    const contrast = Math.abs(R.median(valuesAt(dLc, c))) + 1.0;
    const grad = R.sobelMagBox(L8, w, h, box[0], box[1], box[2], box[3]);
    const edgeW = contrast / (R.percentile(valuesAt(grad, band), 90) * L_SCALE + 1e-3);
    if (edgeW < SOLID_EDGE_W) {
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (c[y * cw + x]) m[(box[1] + y) * w + box[0] + x] = 1;
    }
  }
  const grown = R.dilateMask(m, w, h, R.disk(Math.max(2, letter)));
  if (w === workW && h === workH) return grown;
  const small = R.resizeAreaU8(grown, 1, w, h, workW, workH);
  for (let i = 0; i < small.length; i++) small[i] = small[i] > 0 ? 1 : 0;
  return small;
}

export type StainDetection = {
  mask: Uint8Array;
  cleaned: BgrImage;
  removed: Uint8Array;
  page: Uint8Array;
};

/** Celá detekcia na pracovnom obrázku. */
export async function detectStains(img: BgrImage, illusIn: Uint8Array | null, prep?: TextPrep): Promise<StainDetection> {
  const { width: w, height: h } = img;
  const n = w * h;
  prep ??= await prepareText(img);
  const L8 = prep.lab[0];
  const { page } = prep;
  const { removed, r, lines } = prep.text;
  await tick();
  const cleaned = fillBackground(img, removed, r);
  await tick();
  const clean = labPlanes(cleaned);
  const illus = illusIn ? illusIn.slice() : illustrationMask(lines, w, h, page);
  for (let i = 0; i < n; i++) illus[i] &= page[i];
  const paper = paperEstimate(cleaned, illus, page).full();
  await tick();
  const proposal = stainMask(clean, paper, page, w, h, andNot(page, illus));
  await tick();
  const printField = printEstimate(cleaned, clean, illus);
  const text = removed.slice();
  for (let i = 0; i < n; i++) if (clean.L[i] < paper.L[i] - DARK_BACKGROUND) text[i] = 0;
  const mask = filterComponents(proposal, w, h, L8, page, text, r, clean, paper, illus, printField);
  return { mask, cleaned, removed, page };
}

/** Výrez `box` z pôvodného obrázka, v ktorom sa pixely textu (removed. */
export function repairedCrop(img: BgrImage, removed: Uint8Array, box: Box, pad = 12): BgrImage {
  const { width: w, height: h } = img;
  const [x0, y0, x1, y1] = box;
  const X0 = Math.max(0, x0 - pad);
  const Y0 = Math.max(0, y0 - pad);
  const X1 = Math.min(w, x1 + pad);
  const Y1 = Math.min(h, y1 + pad);
  const cw = X1 - X0;
  const ch = Y1 - Y0;
  const crop = cropBgr(img, X0, Y0, X1, Y1);
  const hole = cropArr(removed, w, [X0, Y0, X1, Y1]);
  const filled = any(hole) ? R.inpaintBgr(crop.data, cw, ch, hole) : crop.data;
  return cropBgr({ width: cw, height: ch, data: filled }, x0 - X0, y0 - Y0, x1 - X0, y1 - Y0);
}

/** Celý pôvodný obrázok, v ktorom sa text dopočíta z okolia len pri škvrnách (`where`) */
export function repairedWhere(img: BgrImage, removed: Uint8Array, where: Uint8Array): BgrImage {
  const { width: w, height: h } = img;
  const hole = andMask(removed, R.dilateMask(where, w, h, R.disk(3)));
  return { width: w, height: h, data: any(hole) ? R.inpaintBgr(img.data, w, h, hole) : img.data.slice() };
}

/** Zlúči blízke časti masky do jednej škvrny. */
export function groupStains(mask: Uint8Array, w: number, h: number): { grouped: Int32Array; stats: number[][] } {
  const lm = R.labelMap(mask, w, h);
  const n = lm.count + 1;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const boxes: number[][] = [];
  for (let i = 1; i < n; i++) {
    const bw = lm.maxX[i] - lm.minX[i] + 1;
    const bh = lm.maxY[i] - lm.minY[i] + 1;
    const g = GROUP_GAP * Math.max(bw, bh);
    boxes.push([i, lm.minX[i] - g, lm.minY[i] - g, lm.minX[i] + bw + g, lm.minY[i] + bh + g]);
  }
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const [i, ax0, ay0, ax1, ay1] = boxes[a];
      const [j, bx0, by0, bx1, by1] = boxes[b];
      if (ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1) parent[find(i)] = find(j);
    }
  }
  const roots = [...new Set(Array.from({ length: n - 1 }, (_, k) => find(k + 1)))].sort((a, b) => a - b);
  const newId = new Map(roots.map((r, k) => [r, k + 1]));
  const lut = new Int32Array(n);
  for (let i = 1; i < n; i++) lut[i] = newId.get(find(i))!;
  const grouped = new Int32Array(lm.labels.length);
  for (let i = 0; i < grouped.length; i++) grouped[i] = lut[lm.labels[i]];
  const stats = Array.from({ length: roots.length + 1 }, () => [Infinity, Infinity, -1, -1, 0]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = grouped[y * w + x];
      if (!k) continue;
      const s = stats[k];
      if (x < s[0]) s[0] = x;
      if (y < s[1]) s[1] = y;
      if (x > s[2]) s[2] = x;
      if (y > s[3]) s[3] = y;
      s[4]++;
    }
  }
  stats[0] = [0, 0, 0, 0, 0];
  for (let k = 1; k < stats.length; k++) {
    const [x0, y0, x1, y1, area] = stats[k];
    stats[k] = [x0, y0, x1 - x0 + 1, y1 - y0 + 1, area];
  }
  return { grouped, stats };
}

export type StainCrop = {
  cislo: number;
  box: Box;
  image: BgrImage;
  mask: Uint8Array;
};

/** Každú škvrnu vyreže s okrajom papiera – ako detailný záber jednej škvrny (vstup pre klasifikáciu). */
export function cropStains(img: BgrImage, removed: Uint8Array, mask: Uint8Array, page: Uint8Array): StainCrop[] {
  const { width: w, height: h } = img;
  const { grouped, stats } = groupStains(mask, w, h);
  const out: StainCrop[] = [];
  for (let i = 1; i < stats.length; i++) {
    const [x, y, bw, bh, area] = stats[i];
    if (area < MIN_CROP_AREA) continue;
    const s = Math.trunc(Math.max(bw, bh) * CROP_SCALE);
    const cx = x + (bw >> 1);
    const cy = y + (bh >> 1);
    const x0 = Math.max(0, cx - (s >> 1));
    const y0 = Math.max(0, cy - (s >> 1));
    const x1 = Math.min(w, x0 + s);
    const y1 = Math.min(h, y0 + s);
    if (Math.min(x1 - x0, y1 - y0) < 40) continue;
    const box: Box = [x0, y0, x1, y1];
    const image = repairedCrop(img, removed, box);
    const pg = cropArr(page, w, box);
    if (count(pg) < pg.length && any(pg)) {
      const [b, g, r] = medianColor(image.data, pg);
      for (let k = 0; k < pg.length; k++) {
        if (pg[k]) continue;
        image.data[3 * k] = b;
        image.data[3 * k + 1] = g;
        image.data[3 * k + 2] = r;
      }
    }
    const m = labelIs(cropArr(grouped, w, box), i);
    out.push({ cislo: out.length + 1, box, image, mask: m });
  }
  return out;
}

const DIGITS = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 7, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 1, 1, 1],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7],
];

/** Pracovný obrázok s vyznačenými škvrnami. */
export function renderCrops(img: BgrImage, mask: Uint8Array, crops: StainCrop[]): BgrImage {
  const { width: w, height: h } = img;
  const out = img.data.slice();
  const side = Math.max(w, h);
  const thick = Math.max(2, cvRound(side / 500));
  const paint = (x: number, y: number, b: number, g: number, r: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = 3 * (y * w + x);
    out[p] = b;
    out[p + 1] = g;
    out[p + 2] = r;
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number, b: number, g: number, r: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) paint(x, y, b, g, r);
  };
  let edge: Uint8Array = andNot(mask, R.erodeMask(mask, w, h, R.disk(1)));
  const t = Math.max(1, thick >> 1);
  if (t > 1) edge = R.dilateMask(edge, w, h, R.disk((t - 1) / 2));
  for (let i = 0; i < edge.length; i++) if (edge[i]) paint(i % w, Math.trunc(i / w), 0, 0, 255);
  const sc = Math.max(2, cvRound(side / 400));
  for (const { cislo, box } of crops) {
    const [x0, y0, x1, y1] = box;
    fillRect(x0, y0, x1, y0 + thick, 0, 220, 255);
    fillRect(x0, y1 - thick, x1, y1, 0, 220, 255);
    fillRect(x0, y0, x0 + thick, y1, 0, 220, 255);
    fillRect(x1 - thick, y0, x1, y1, 0, 220, 255);
    const label = String(cislo);
    const lw = label.length * 4 * sc + sc;
    const lh = 5 * sc + 2 * sc;
    const ly = y0 - lh - 4 > 0 ? y0 - lh - 2 : y1 + 2;
    fillRect(x0, ly, x0 + lw, ly + lh, 0, 220, 255);
    for (let k = 0; k < label.length; k++) {
      const rows = DIGITS[label.charCodeAt(k) - 48];
      for (let ry = 0; ry < 5; ry++) {
        for (let rx = 0; rx < 3; rx++) {
          if (!((rows[ry] >> (2 - rx)) & 1)) continue;
          const px = x0 + sc + k * 4 * sc + rx * sc;
          const py = ly + sc + ry * sc;
          fillRect(px, py, px + sc, py + sc, 0, 0, 0);
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}
