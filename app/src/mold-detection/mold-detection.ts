import {
  arcLength,
  belowMasks,
  bitsFromLut,
  complementBits,
  contourArea,
  Ellipse9CloseOpen,
  fillHoles,
  labelComponents,
  rasterizeLabels,
  traceOuterBorder,
  type BitImage,
  type Components,
} from './binary';
import { gaussianBlur } from './blur';
import { COLOR_CHANNELS, getColorChannels, type ColorChannel } from './color';
import { cvRound, type BgrImage, type GrayImage } from './image';
import { distanceTransformExactSq } from './raster';
import { channelHistogram, THRESHOLD_METHODS } from './thresholds';

/** Váha kontrastu v skóre. */
export const VAHA_KONTRASTU = 0.3;

export const PROFIL_RYCHLY: { channels: ColorChannel[]; methods: string[] } = {
  channels: ['HSV_S', 'Lab_a', 'XYZ_X', 'YUV_U'],
  methods: ['Yen', 'Isodata', 'Minimum'],
};

export type BorderSide = 'top' | 'bottom' | 'left' | 'right';
type Polarity = 'below' | 'above';

export const ALL_SIDES: BorderSide[] = ['top', 'bottom', 'left', 'right'];

export type CandidateInfo = {
  channel: string | null;
  method: string | null;
  polarity: Polarity | null;
  coverage: number;
  score: number;
};

export class ProcessingTimeout extends Error {}

export type MoldDetectionOptions = {
  acceptedRange?: [number, number];
  timeoutS?: number | null;
  channels?: readonly ColorChannel[];
  thresholdMethods?: readonly string[];
  kontrastVaha?: number;
};

type Cleaned = { filled: BitImage; comps: Components; keep: Uint8Array; keptArea: number };
type Evaluation = { score: number; coverage: number; cleaned: Cleaned | null };
type ChannelBest = { score: number; method: string; polarity: Polarity; evaluation: Evaluation };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
let lastYield = 0;
const yieldToEventLoop = async () => {
  if (now() - lastYield < 0.25) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  lastYield = now();
};

function sameData(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function kontrast(comps: Components, keep: Uint8Array, blurred: GrayImage): number {
  let area = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let lab = 1; lab <= comps.count; lab++) {
    if (!keep[lab]) continue;
    area += comps.area[lab];
    minX = Math.min(minX, comps.minX[lab]);
    minY = Math.min(minY, comps.minY[lab]);
    maxX = Math.max(maxX, comps.maxX[lab]);
    maxY = Math.max(maxY, comps.maxY[lab]);
  }
  if (area === 0) return 0;
  const { width: W, height: H, data } = blurred;
  const r = Math.max(3, cvRound(0.15 * Math.sqrt(area / Math.PI)));
  const x0 = Math.max(0, minX - r - 1);
  const y0 = Math.max(0, minY - r - 1);
  const x1 = Math.min(W, maxX + r + 2);
  const y1 = Math.min(H, maxY + r + 2);
  const w = x1 - x0;
  const h = y1 - y0;
  const outside = new Uint8Array(w * h).fill(1);
  const { runs, runLabel } = comps;
  for (let y = y0; y < y1; y++) {
    for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
      if (!keep[runLabel[i]]) continue;
      const s = Math.max(runs.xs[i], x0);
      const e = Math.min(runs.xe[i], x1 - 1);
      if (s <= e) outside.fill(0, (y - y0) * w + s - x0, (y - y0) * w + e - x0 + 1);
    }
  }
  const d2 = distanceTransformExactSq(outside, w, h);
  const r2 = r * r;
  let sumIn = 0;
  let nIn = 0;
  let sumOut = 0;
  let sumOut2 = 0;
  let nOut = 0;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * W + x0;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const v = data[row + x];
      if (!outside[k]) {
        sumIn += v;
        nIn++;
      } else if (d2[k] <= r2) {
        sumOut += v;
        sumOut2 += v * v;
        nOut++;
      }
    }
  }
  if (nOut === 0 || nIn === 0) return 0;
  const meanOut = sumOut / nOut;
  const std = Math.sqrt(Math.max(0, sumOut2 / nOut - meanOut * meanOut));
  return Math.abs(sumIn / nIn - meanOut) / (std + 1);
}

export class MoldDetectionMask {
  acceptedRange: [number, number];
  timeoutS: number | null;
  channels: readonly ColorChannel[];
  thresholdMethods: typeof THRESHOLD_METHODS;
  kontrastVaha: number;

  constructor(options: MoldDetectionOptions = {}) {
    this.acceptedRange = options.acceptedRange ?? [0.01, 0.35];
    this.timeoutS = options.timeoutS === undefined ? 30 : options.timeoutS;
    this.channels = options.channels ?? COLOR_CHANNELS;
    const methods = options.thresholdMethods;
    this.thresholdMethods = methods ? THRESHOLD_METHODS.filter(([name]) => methods.includes(name)) : THRESHOLD_METHODS;
    this.kontrastVaha = options.kontrastVaha ?? VAHA_KONTRASTU;
  }

  scoreWithContrast(score: number, comps: Components, keep: Uint8Array, blurred: GrayImage): number {
    if (!this.kontrastVaha || !Number.isFinite(score)) return score;
    return score + this.kontrastVaha * Math.log1p(kontrast(comps, keep, blurred));
  }

  scoreMask(cleaned: Cleaned, coverage: number): number {
    if (coverage <= 0) return -Infinity;
    const { filled, comps, keep } = cleaned;
    let weighted = 0;
    let weights = 0;
    let nComponents = 0;
    for (let lab = 1; lab <= comps.count; lab++) {
      if (!keep[lab]) continue;
      const contour = traceOuterBorder(filled, comps.startX[lab], comps.startY[lab]);
      const area = contourArea(contour);
      const perimeter = arcLength(contour);
      if (area <= 0 || perimeter <= 0) continue;
      const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
      weighted += Math.min(circularity, 1.0) * area;
      weights += area;
      nComponents++;
    }
    if (nComponents === 0) return -Infinity;
    const meanCircularity = weighted / weights;

    const [minCov, maxCov] = this.acceptedRange;
    let coverageScore: number;
    if (minCov <= coverage && coverage <= maxCov) {
      coverageScore = 0.3;
    } else {
      const mid = (minCov + maxCov) / 2;
      coverageScore = -Math.min(Math.abs(coverage - mid) / mid, 1.0);
    }
    const componentPenalty = Math.max(0, nComponents - 6) * 0.04;
    return meanCircularity + coverageScore - componentPenalty;
  }

  static integerCutoff(t: number, polarity: Polarity): number | null {
    if (!Number.isFinite(t)) return null;
    const cut = polarity === 'below' ? Math.ceil(t) - 1 : Math.floor(t);
    return Math.min(Math.max(cut, -1), 255);
  }

  maskFromThreshold(channel: GrayImage, t: number, polarity: Polarity): { bits: BitImage; count: number } {
    const cut = MoldDetectionMask.integerCutoff(t, polarity);
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      if (cut === null) lut[v] = (polarity === 'below' ? v < t : v > t) ? 1 : 0;
      else lut[v] = (polarity === 'below' ? v <= cut : v > cut) ? 1 : 0;
    }
    return bitsFromLut(channel.data, channel.width, channel.height, lut);
  }

  cleanMask(
    binary: BitImage,
    borderSides: BorderSide[],
    morph: Ellipse9CloseOpen = new Ellipse9CloseOpen(binary.width, binary.height),
    minAreaRatio = 0.002
  ): Cleaned {
    const filled = fillHoles(morph.run(binary));
    const comps = labelComponents(filled);
    const { width: w, height: h } = filled;
    const minArea = Math.max(150, Math.trunc(minAreaRatio * h * w));
    const keep = new Uint8Array(comps.count + 1);
    let keptArea = 0;
    for (let lab = 1; lab <= comps.count; lab++) {
      const area = comps.area[lab];
      if (area < minArea) continue;
      const touchesBorder =
        (borderSides.includes('top') && comps.minY[lab] <= 0) ||
        (borderSides.includes('bottom') && comps.maxY[lab] + 1 >= h) ||
        (borderSides.includes('left') && comps.minX[lab] <= 0) ||
        (borderSides.includes('right') && comps.maxX[lab] + 1 >= w);
      if (touchesBorder) continue;
      keep[lab] = 1;
      keptArea += area;
    }
    return { filled, comps, keep, keptArea };
  }

  evaluateCandidate(raw: BitImage, nonzero: number, borderSides: BorderSide[], morph?: Ellipse9CloseOpen): Evaluation {
    const size = raw.width * raw.height;
    if (nonzero === 0 || (nonzero === size && borderSides.length > 0)) {
      return { score: -Infinity, coverage: 0, cleaned: null };
    }
    const cleaned = this.cleanMask(raw, borderSides, morph);
    const coverage = cleaned.keptArea / size;
    return { score: this.scoreMask(cleaned, coverage), coverage, cleaned };
  }

  private bestInChannel(
    blurred: GrayImage,
    borderSides: BorderSide[],
    deadline: number | null,
    morph: Ellipse9CloseOpen
  ): ChannelBest | null {
    const hist = channelHistogram(blurred.data);

    type Candidate = { method: string; polarity: Polarity; t: number; cut: number | null };
    const candidates: Candidate[] = [];
    const seenCutoffs = new Set<string>();
    for (const [methodName, methodFn] of this.thresholdMethods) {
      let thresholdVal: number;
      try {
        thresholdVal = methodFn(hist);
      } catch {
        continue;
      }
      for (const polarity of ['below', 'above'] as const) {
        const cut = MoldDetectionMask.integerCutoff(thresholdVal, polarity);
        if (cut !== null) {
          const key = `${polarity}:${cut}`;
          if (seenCutoffs.has(key)) continue;
          seenCutoffs.add(key);
        }
        candidates.push({ method: methodName, polarity, t: thresholdVal, cut });
      }
    }

    const cuts = candidates.filter((c) => c.cut !== null).map((c) => c.cut as number);
    const below = belowMasks(blurred.data, blurred.width, blurred.height, cuts);
    const cumulative = new Int32Array(257);
    for (let v = 0; v < 256; v++) cumulative[v + 1] = cumulative[v] + hist.counts[v];
    const size = blurred.width * blurred.height;

    let best: ChannelBest | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (deadline !== null && now() > deadline) throw new ProcessingTimeout();
      let bits: BitImage;
      let count: number;
      if (c.cut === null) {
        ({ bits, count } = this.maskFromThreshold(blurred, c.t, c.polarity));
      } else {
        const belowCount = cumulative[c.cut + 1];
        bits = c.polarity === 'below' ? below.get(c.cut)! : complementBits(below.get(c.cut)!);
        count = c.polarity === 'below' ? belowCount : size - belowCount;
      }
      const evaluation = this.evaluateCandidate(bits, count, borderSides, morph);
      const { cleaned } = evaluation;
      const score = cleaned
        ? this.scoreWithContrast(evaluation.score, cleaned.comps, cleaned.keep, blurred)
        : evaluation.score;
      if (score > bestScore) {
        bestScore = score;
        best = { score, method: c.method, polarity: c.polarity, evaluation };
      }
    }
    return best;
  }

  async createMoldMaskAuto(
    image: BgrImage,
    borderSides: BorderSide[] = ALL_SIDES,
    deadline: number | null = null
  ): Promise<{ mask: Uint8Array; info: CandidateInfo }> {
    const tasks: { name: string; blurred: GrayImage }[] = [];
    const raws: Uint8Array[] = [];
    for (const [name, channel] of getColorChannels(image, this.channels)) {
      if (raws.some((r) => sameData(r, channel.data))) continue;
      raws.push(channel.data);
      const blurred = gaussianBlur(channel, 5);
      if (tasks.some((t) => sameData(t.blurred.data, blurred.data))) continue;
      tasks.push({ name, blurred });
    }

    const morph = new Ellipse9CloseOpen(image.width, image.height);
    let bestScore = -Infinity;
    let best: { channel: string; result: ChannelBest } | null = null;
    for (const task of tasks) {
      await yieldToEventLoop();
      const result = this.bestInChannel(task.blurred, borderSides, deadline, morph);
      if (result && result.score > bestScore) {
        bestScore = result.score;
        best = { channel: task.name, result };
      }
    }

    const { width, height } = image;
    if (best === null || best.result.evaluation.cleaned === null) {
      return {
        mask: new Uint8Array(width * height),
        info: { channel: null, method: null, polarity: null, coverage: 0, score: -Infinity },
      };
    }
    const { cleaned, coverage } = best.result.evaluation;
    return {
      mask: rasterizeLabels(cleaned.comps, width, height, cleaned.keep),
      info: {
        channel: best.channel,
        method: best.result.method,
        polarity: best.result.polarity,
        coverage,
        score: best.result.score,
      },
    };
  }

  deadline(): number | null {
    return this.timeoutS === null ? null : now() + this.timeoutS;
  }

  timeoutMessage(): string {
    return (
      `Spracovanie trvalo dlhšie ako ${this.timeoutS} s a bolo prerušené - ` +
      'pravdepodobne nastala chyba.'
    );
  }
}

/** Pixely obrázka pod maskou, zvyšok čierny. */
export function extractMasked(mask: Uint8Array, image: BgrImage): BgrImage {
  const out = new Uint8Array(image.data.length);
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
    if (mask[i]) {
      out[p] = image.data[p];
      out[p + 1] = image.data[p + 1];
      out[p + 2] = image.data[p + 2];
    }
  }
  return { width: image.width, height: image.height, data: out };
}
