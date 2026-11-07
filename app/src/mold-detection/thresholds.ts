
export type ChannelHistogram = {
  counts: Int32Array;
  total: number;
  min: number;
  max: number;
};

export function channelHistogram(data: Uint8Array): ChannelHistogram {
  const counts = new Int32Array(256);
  for (let i = 0; i < data.length; i++) counts[data[i]]++;
  let min = 0;
  while (min < 255 && counts[min] === 0) min++;
  let max = 255;
  while (max > 0 && counts[max] === 0) max--;
  return { counts, total: data.length, min, max };
}

const f32 = Math.fround;
const FLT_EPSILON = 1.1920928955078125e-7;

/** OpenCV getThreshVal_Otsu_8u. */
function otsu({ counts, total }: ChannelHistogram): number {
  const scale = 1 / total;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * counts[i];
  mu *= scale;
  let mu1 = 0;
  let q1 = 0;
  let maxSigma = 0;
  let maxVal = 0;
  for (let i = 0; i < 256; i++) {
    const p = counts[i] * scale;
    mu1 *= q1;
    q1 += p;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < FLT_EPSILON || Math.max(q1, q2) > 1 - FLT_EPSILON) continue;
    mu1 = (mu1 + i * p) / q1;
    const mu2 = (mu - q1 * mu1) / q2;
    const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
    if (sigma > maxSigma) {
      maxSigma = sigma;
      maxVal = i;
    }
  }
  return maxVal;
}

/** OpenCV getThreshVal_Triangle_8u. */
function triangle({ counts }: ChannelHistogram): number {
  const N = 256;
  const h = Array.from(counts);
  let left = 0;
  let right = 0;
  let maxInd = 0;
  let max = 0;
  for (let i = 0; i < N; i++) {
    if (h[i] > 0) {
      left = i;
      break;
    }
  }
  if (left > 0) left--;
  for (let i = N - 1; i > 0; i--) {
    if (h[i] > 0) {
      right = i;
      break;
    }
  }
  if (right < N - 1) right++;
  for (let i = 0; i < N; i++) {
    if (h[i] > max) {
      max = h[i];
      maxInd = i;
    }
  }
  let flipped = false;
  if (maxInd - left < right - maxInd) {
    flipped = true;
    h.reverse();
    left = N - 1 - right;
    maxInd = N - 1 - maxInd;
  }
  let thresh = left;
  const a = max;
  const b = left - maxInd;
  let dist = 0;
  for (let i = left + 1; i <= maxInd; i++) {
    const d = a * i + b * h[i];
    if (d > dist) {
      dist = d;
      thresh = i;
    }
  }
  thresh--;
  if (flipped) thresh = N - 1 - thresh;
  return thresh;
}

/** skimage.filters.threshold_yen. */
function yen({ counts, total, min, max }: ChannelHistogram): number {
  const n = max - min + 1;
  if (n === 1) return min;
  const pmf = new Float64Array(n);
  for (let i = 0; i < n; i++) pmf[i] = f32(counts[min + i] / total);
  const P1 = new Float64Array(n);
  const P1sq = new Float64Array(n);
  const P2sq = new Float64Array(n);
  let acc = 0;
  let acc2 = 0;
  for (let i = 0; i < n; i++) {
    acc = f32(acc + pmf[i]);
    acc2 = f32(acc2 + f32(pmf[i] * pmf[i]));
    P1[i] = acc;
    P1sq[i] = acc2;
  }
  acc2 = 0;
  for (let i = n - 1; i >= 0; i--) {
    acc2 = f32(acc2 + f32(pmf[i] * pmf[i]));
    P2sq[i] = acc2;
  }
  let best = -Infinity;
  let bestIdx = 0;
  for (let i = 0; i < n - 1; i++) {
    const inv = f32(1 / f32(P1sq[i] * P2sq[i + 1]));
    const y = f32(P1[i] * f32(1 - P1[i]));
    const crit = f32(Math.log(f32(inv * f32(y * y))));
    if (Number.isNaN(crit)) return min + i;
    if (crit > best) {
      best = crit;
      bestIdx = i;
    }
  }
  return min + bestIdx;
}

/** skimage.filters.threshold_li (vetva pre celočíselné obrázky). */
function li({ counts, total, min, max }: ChannelHistogram): number {
  if (min === max) return min;
  const n = max - min + 1;
  const tolerance = 0.5;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i * counts[min + i];
  let tNext = sum / total;
  let tCurr = -2 * tolerance;
  while (Math.abs(tNext - tCurr) > tolerance) {
    tCurr = tNext;
    let wf = 0;
    let sf = 0;
    let wb = 0;
    let sb = 0;
    for (let i = 0; i < n; i++) {
      const c = counts[min + i];
      if (i > tCurr) {
        wf += c;
        sf += i * c;
      } else {
        wb += c;
        sb += i * c;
      }
    }
    if (wf === 0 || wb === 0) throw new Error('Weights sum to zero');
    const meanFore = sf / wf;
    const meanBack = sb / wb;
    if (meanBack === 0) break;
    tNext = (meanBack - meanFore) / (Math.log(meanBack) - Math.log(meanFore));
  }
  return tNext + min;
}

/** skimage.filters.threshold_isodata. */
function isodata({ counts, min, max }: ChannelHistogram): number {
  const n = max - min + 1;
  if (n === 1) return min;
  let total = 0;
  let totalIntensity = 0;
  for (let i = 0; i < n; i++) {
    total += counts[min + i];
    totalIntensity += counts[min + i] * (min + i);
  }
  let csuml = 0;
  let csumIntensity = 0;
  for (let i = 0; i < n - 1; i++) {
    csuml += counts[min + i];
    csumIntensity += counts[min + i] * (min + i);
    const lower = csumIntensity / csuml;
    const higher = (totalIntensity - csumIntensity) / (total - csuml);
    const distance = (lower + higher) / 2 - (min + i);
    if (distance >= 0 && distance < 1) return min + i;
  }
  throw new Error('index 0 is out of bounds');
}

/** skimage.filters.threshold_mean. */
function mean({ counts, total }: ChannelHistogram): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * counts[i];
  return sum / total;
}

/** scipy.ndimage.uniform_filter1d(x, 3) s mode='reflect' pre float32 pole. */
function uniformFilter3(src: Float64Array): Float64Array<ArrayBufferLike> {
  const n = src.length;
  const ext = new Float64Array(n + 2);
  ext[0] = src[0];
  ext.set(src, 1);
  ext[n + 1] = src[n - 1];
  const out = new Float64Array(n);
  let tmp = ext[0] + ext[1] + ext[2];
  tmp /= 3;
  out[0] = f32(tmp);
  for (let i = 1; i < n; i++) {
    tmp += (ext[i + 2] - ext[i - 1]) / 3;
    out[i] = f32(tmp);
  }
  return out;
}

function localMaxima(hist: Float64Array): number[] {
  const idx: number[] = [];
  let direction = 1;
  for (let i = 0; i < hist.length - 1; i++) {
    if (direction > 0) {
      if (hist[i + 1] < hist[i]) {
        direction = -1;
        idx.push(i);
      }
    } else if (hist[i + 1] > hist[i]) {
      direction = 1;
    }
  }
  return idx;
}

/** skimage.filters.threshold_minimum. */
function minimum({ counts, min, max }: ChannelHistogram): number {
  const n = max - min + 1;
  let smooth: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) smooth[i] = counts[min + i];
  const maxIter = 10000;
  let maxima: number[] = [];
  let counter = 0;
  for (counter = 0; counter < maxIter; counter++) {
    smooth = uniformFilter3(smooth);
    maxima = localMaxima(smooth);
    if (maxima.length < 3) break;
  }
  if (maxima.length !== 2) throw new Error('Unable to find two maxima in histogram');
  if (counter === maxIter - 1) throw new Error('Maximum iteration reached for histogram smoothing');
  let best = Infinity;
  let bestIdx = 0;
  for (let i = maxima[0]; i <= maxima[1]; i++) {
    if (smooth[i] < best) {
      best = smooth[i];
      bestIdx = i;
    }
  }
  return min + bestIdx;
}

export const THRESHOLD_METHODS: readonly [string, (h: ChannelHistogram) => number][] = [
  ['Otsu', otsu],
  ['Triangle', triangle],
  ['Yen', yen],
  ['Li', li],
  ['Isodata', isodata],
  ['Mean', mean],
  ['Minimum', minimum],
];
