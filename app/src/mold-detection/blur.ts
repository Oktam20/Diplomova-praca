import { cvRound, reflect101, type GrayImage } from './image';

const kernelCache = new Map<number, Int32Array>();

/** Jadro ako getGaussianKernelBitExact + getGaussianKernelFixedPoint_ED (8 desatinných bitov). */
export function gaussianKernelFixed(ksize: number): Int32Array {
  const cached = kernelCache.get(ksize);
  if (cached) return cached;

  let values: number[];
  if (ksize === 3) values = [0.25, 0.5, 0.25];
  else if (ksize === 5) values = [0.0625, 0.25, 0.375, 0.25, 0.0625];
  else if (ksize === 7) values = [0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125];
  else {
    const sigma = ksize * 0.15 + 0.35;
    const scale2X = -0.125 / (sigma * sigma);
    const half = (ksize - 1) / 2;
    const raw: number[] = [];
    let sum = 0;
    for (let i = 0, x = 1 - ksize; i < half; i++, x += 2) {
      const t = Math.exp(x * x * scale2X);
      raw.push(t);
      sum += t;
    }
    sum = sum * 2 + 1;
    const mul = 1 / sum;
    values = new Array(ksize);
    for (let i = 0; i < half; i++) values[i] = values[ksize - 1 - i] = raw[i] * mul;
    values[half] = mul;
  }

  const n = ksize;
  const out = new Int32Array(n);
  const half = (n - 1) / 2;
  let err = 0;
  let sum = 0;
  for (let i = 0; i < half; i++) {
    const adj = values[i] * 256 + err;
    const v0 = cvRound(adj);
    err = adj - v0;
    out[i] = out[n - 1 - i] = v0;
    sum += v0;
  }
  out[half] = 256 - 2 * sum;
  kernelCache.set(ksize, out);
  return out;
}

export function gaussianBlur(src: GrayImage, ksize: number): GrayImage {
  if (ksize === 5) return gaussianBlur5(src);
  const { width: w, height: h, data } = src;
  const k = gaussianKernelFixed(ksize);
  const r = (ksize - 1) / 2;

  const tmp = new Uint16Array(w * h);
  const ext = new Uint8Array(w + 2 * r);
  const leftIdx = new Int32Array(r);
  const rightIdx = new Int32Array(r);
  for (let i = 0; i < r; i++) {
    leftIdx[i] = reflect101(i - r, w);
    rightIdx[i] = reflect101(w + i, w);
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let i = 0; i < r; i++) {
      ext[i] = data[row + leftIdx[i]];
      ext[r + w + i] = data[row + rightIdx[i]];
    }
    ext.set(data.subarray(row, row + w), r);
    for (let x = 0; x < w; x++) {
      let s = k[r] * ext[x + r];
      for (let j = 0; j < r; j++) s += k[j] * (ext[x + j] + ext[x + ksize - 1 - j]);
      tmp[row + x] = s;
    }
  }

  const out = new Uint8Array(w * h);
  const rows = new Int32Array(ksize);
  for (let y = 0; y < h; y++) {
    for (let j = 0; j < ksize; j++) rows[j] = reflect101(y + j - r, h) * w;
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = k[r] * tmp[rows[r] + x];
      for (let j = 0; j < r; j++) s += k[j] * (tmp[rows[j] + x] + tmp[rows[ksize - 1 - j] + x]);
      out[o + x] = (s + 32768) >>> 16;
    }
  }
  return { width: w, height: h, data: out };
}

/** Rozbalená verzia pre jadro 5x5 ([16, 64, 96, 64, 16] / 256 = [1, 4, 6, 4, 1] / 16). */
function gaussianBlur5(src: GrayImage): GrayImage {
  const { width: w, height: h, data } = src;
  const tmp = new Uint16Array(w * h);
  const ext = new Uint8Array(w + 4);
  const l0 = reflect101(-2, w);
  const l1 = reflect101(-1, w);
  const r0 = reflect101(w, w);
  const r1 = reflect101(w + 1, w);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    ext[0] = data[row + l0];
    ext[1] = data[row + l1];
    ext.set(data.subarray(row, row + w), 2);
    ext[w + 2] = data[row + r0];
    ext[w + 3] = data[row + r1];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = ext[x] + ext[x + 4] + 4 * (ext[x + 1] + ext[x + 3]) + 6 * ext[x + 2];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const a = reflect101(y - 2, h) * w;
    const b = reflect101(y - 1, h) * w;
    const c = y * w;
    const d = reflect101(y + 1, h) * w;
    const e = reflect101(y + 2, h) * w;
    for (let x = 0; x < w; x++) {
      out[c + x] = (tmp[a + x] + tmp[e + x] + 4 * (tmp[b + x] + tmp[d + x]) + 6 * tmp[c + x] + 128) >> 8;
    }
  }
  return { width: w, height: h, data: out };
}
