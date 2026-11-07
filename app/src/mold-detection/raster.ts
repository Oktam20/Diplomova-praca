import {
  bitsFromLut,
  contourArea,
  dilate,
  ellipseHalfWidths,
  erode,
  externalComponents,
  fillHoles,
  labelComponents,
  rasterizeLabels,
  traceOuterBorder,
  type BitImage,
} from './binary';
import { cvRound, reflect101 } from './image';

const NONZERO = Uint8Array.from({ length: 256 }, (_, v) => (v ? 1 : 0));

export function toBits(mask: Uint8Array, w: number, h: number): BitImage {
  return bitsFromLut(mask, w, h, NONZERO).bits;
}

export function fromBits(bits: BitImage): Uint8Array {
  const { width: w, height: h, stride, data } = bits;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * stride;
    const row = y * w;
    for (let k = 0; k < stride; k++) {
      let word = data[o + k] | 0;
      const base = row + (k << 5);
      while (word !== 0) {
        out[base + 31 - Math.clz32(word & -word)] = 1;
        word &= word - 1;
      }
    }
  }
  return out;
}

export function disk(r: number): number[] {
  return ellipseHalfWidths(2 * Math.max(1, cvRound(r)) + 1);
}

/** cv2.dilate masky (okolie mimo obrázka = 0). */
export function dilateMask(mask: Uint8Array, w: number, h: number, hw: readonly number[]): Uint8Array {
  return fromBits(dilate(toBits(mask, w, h), hw));
}

/** cv2.erode masky (okolie mimo obrázka = 1, ako v OpenCV). */
export function erodeMask(mask: Uint8Array, w: number, h: number, hw: readonly number[]): Uint8Array {
  return fromBits(erode(toBits(mask, w, h), hw));
}

/** cv2.morphologyEx(MORPH_CLOSE) masky. */
export function closeMask(mask: Uint8Array, w: number, h: number, hw: readonly number[]): Uint8Array {
  return fromBits(erode(dilate(toBits(mask, w, h), hw), hw));
}

/** findContours(RETR_EXTERNAL) + drawContours(FILLED): vyplnenie dier. */
export function fillHolesMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  return fromBits(fillHoles(toBits(mask, w, h)));
}

/** Vonkajšie kontúry s cv2.contourArea >= minArea, vyplnené (drawContours FILLED) */
export function fillExternal(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const bits = toBits(mask, w, h);
  const { comps, external } = externalComponents(bits);
  const keep = new Uint8Array(comps.count + 1);
  for (let lab = 1; lab <= comps.count; lab++) {
    if (!external[lab]) continue;
    if (contourArea(traceOuterBorder(bits, comps.startX[lab], comps.startY[lab])) >= minArea) keep[lab] = 1;
  }
  return fillHolesMask(rasterizeLabels(comps, w, h, keep), w, h);
}

export type LabelMap = {
  labels: Int32Array;
  count: number;
  area: Int32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
};

/** cv2.connectedComponentsWithStats (8-susednosť) – labely v poradí riadkov. */
export function labelMap(mask: Uint8Array, w: number, h: number): LabelMap {
  const comps = labelComponents(toBits(mask, w, h));
  const labels = new Int32Array(w * h);
  const { runs, runLabel } = comps;
  for (let y = 0; y < h; y++) {
    for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
      labels.fill(runLabel[i], y * w + runs.xs[i], y * w + runs.xe[i] + 1);
    }
  }
  return {
    labels,
    count: comps.count,
    area: comps.area,
    minX: comps.minX,
    minY: comps.minY,
    maxX: comps.maxX,
    maxY: comps.maxY,
  };
}

/** cv2.dilate (isMax) / cv2.erode 8-bitového obrázka s jadrom zadaným pol-šírkami riadkov. */
function grayMorph(src: Uint8Array, w: number, h: number, hw: readonly number[], isMax: boolean): Uint8Array {
  const kh = hw.length;
  const c = (kh - 1) >> 1;
  let maxR = 0;
  for (const r of hw) if (r > maxR) maxR = r;
  const n = w * h;
  let cur: Uint8Array = src;
  if (!isMax) {
    cur = new Uint8Array(n);
    for (let i = 0; i < n; i++) cur[i] = 255 - src[i];
  }
  const out = new Uint8Array(n);
  let next: Uint8Array = new Uint8Array(n);
  let spare: Uint8Array | null = isMax ? null : next;
  for (let k = 0; k <= maxR; k++) {
    if (k > 0) {
      rowMax3(cur, next, w, h);
      const old = cur;
      cur = next;
      next = old === src ? (spare ?? new Uint8Array(n)) : old;
      spare = null;
    }
    for (let i = 0; i < kh; i++) {
      if (hw[i] !== k) continue;
      const dy = i - c;
      const y0 = Math.max(0, -dy);
      const y1 = Math.min(h, h - dy);
      const off = dy * w;
      for (let p = y0 * w, e = y1 * w; p < e; p++) {
        const v = cur[p + off];
        if (v > out[p]) out[p] = v;
      }
    }
  }
  if (!isMax) for (let i = 0; i < n; i++) out[i] = 255 - out[i];
  return out;
}

/** next[x] = max(cur[x-1], cur[x], cur[x+1]) v každom riadku (mimo obrázka sa ignoruje). */
function rowMax3(cur: Uint8Array, next: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    if (w === 1) {
      next[o] = cur[o];
      continue;
    }
    let a = cur[o];
    let b = cur[o + 1];
    next[o] = a > b ? a : b;
    for (let x = 1; x < w - 1; x++) {
      const c = cur[o + x + 1];
      const m = a > b ? a : b;
      next[o + x] = m > c ? m : c;
      a = b;
      b = c;
    }
    next[o + w - 1] = a > b ? a : b;
  }
}

/** cv2.morphologyEx(MORPH_CLOSE) 8-bitového obrázka. */
export function grayClose(src: Uint8Array, w: number, h: number, hw: readonly number[]): Uint8Array {
  return grayMorph(grayMorph(src, w, h, hw, true), w, h, hw, false);
}

/** Konvolúcia so symetrickým jadrom k (k[r - j] = k[r + j]) */
function convolve1d(src: Float32Array, w: number, h: number, k: Float32Array, horizontal: boolean): Float32Array {
  const r = k.length >> 1;
  const kc = k[r];
  const out = new Float32Array(w * h);
  if (horizontal) {
    const idx = new Int32Array(w + 2 * r);
    for (let i = 0; i < idx.length; i++) idx[i] = reflect101(i - r, w);
    const line = new Float32Array(w + 2 * r);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let i = 0; i < line.length; i++) line[i] = src[o + idx[i]];
      for (let x = 0; x < w; x++) {
        const c = x + r;
        let s = kc * line[c];
        for (let j = 1; j <= r; j++) s += k[r + j] * (line[c - j] + line[c + j]);
        out[o + x] = s;
      }
    }
  } else {
    const idx = new Int32Array(h + 2 * r);
    for (let i = 0; i < idx.length; i++) idx[i] = reflect101(i - r, h);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      const so = idx[y + r] * w;
      for (let x = 0; x < w; x++) out[o + x] = kc * src[so + x];
      for (let j = 1; j <= r; j++) {
        const kj = k[r + j];
        const sa = idx[y + r - j] * w;
        const sb = idx[y + r + j] * w;
        for (let x = 0; x < w; x++) out[o + x] += kj * (src[sa + x] + src[sb + x]);
      }
    }
  }
  return out;
}

/** cv2.GaussianBlur(src, (0, 0), sigma) – okraj REFLECT_101. */
export function gaussianF(src: Float32Array, w: number, h: number, sigma: number, ksize = 0): Float32Array {
  if (sigma > 3) return gaussianBoxes(src, w, h, sigma);
  const n = ksize > 0 ? ksize : cvRound(sigma * 8 + 1) | 1;
  const r = n >> 1;
  const k = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const x = i - r;
    k[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    s += k[i];
  }
  for (let i = 0; i < n; i++) k[i] /= s;
  return convolve1d(convolve1d(src, w, h, k, true), w, h, k, false);
}

/** Gaussov filter aproximovaný tromi krabicovými filtrami (šírky podľa Kovesi / Wells). */
function gaussianBoxes(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const nBoxes = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / nBoxes + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - nBoxes * wl * wl - 4 * nBoxes * wl - 3 * nBoxes) / (-4 * wl - 4));
  let cur = src;
  for (let i = 0; i < nBoxes; i++) {
    const radius = ((i < m ? wl : wu) - 1) / 2;
    cur = boxBlur1d(boxBlur1d(cur, w, h, radius, true), w, h, radius, false);
  }
  return cur;
}

/** Priemer v okne (2r+1) po riadkoch alebo stĺpcoch, okraj REFLECT_101. */
function boxBlur1d(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  if (r <= 0) return src;
  const out = new Float32Array(w * h);
  const len = horizontal ? w : h;
  const idx = new Int32Array(len + 2 * r + 1);
  for (let i = 0; i < idx.length; i++) idx[i] = reflect101(i - r, len);
  const norm = 1 / (2 * r + 1);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let s = 0;
      for (let i = 0; i < 2 * r + 1; i++) s += src[base + idx[i]];
      for (let p = 0; p < w; p++) {
        out[base + p] = s * norm;
        s += src[base + idx[p + 2 * r + 1]] - src[base + idx[p]];
      }
    }
    return out;
  }
  const sums = new Float64Array(w);
  for (let i = 0; i < 2 * r + 1; i++) {
    const so = idx[i] * w;
    for (let x = 0; x < w; x++) sums[x] += src[so + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const sa = idx[y + 2 * r + 1] * w;
    const sb = idx[y] * w;
    for (let x = 0; x < w; x++) {
      out[o + x] = sums[x] * norm;
      sums[x] += src[sa + x] - src[sb + x];
    }
  }
  return out;
}

/** cv2.blur(src, (k, k)) – priemer v štvorci k x k, okraj REFLECT_101. */
export function boxMeanF(src: Float32Array, w: number, h: number, k: number): Float32Array {
  const r = k >> 1;
  return boxBlur1d(boxBlur1d(src, w, h, r, true), w, h, r, false);
}

export function toFloat(src: Uint8Array): Float32Array {
  return Float32Array.from(src);
}

/** saturate_cast<uchar> (zaokrúhlenie k najbližšiemu). */
export function toU8(src: Float32Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = cvRound(src[i]);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/** GaussianBlur 8-bitového jednokanálového obrázka (výsledok 8-bitový). */
export function gaussianU8(src: Uint8Array, w: number, h: number, sigma: number, ksize = 0): Uint8Array {
  return toU8(gaussianF(toFloat(src), w, h, sigma, ksize > 0 ? ksize : cvRound(sigma * 6 + 1) | 1));
}

/** cv2.medianBlur jedného 8-bitového kanála (okraj REPLICATE) */
export function medianBlurU8(src: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const r = k >> 1;
  const out = new Uint8Array(w * h);
  const half = (k * k) >> 1;
  const colF = new Int32Array(w * 256);
  const colC = new Int32Array(w * 16);
  const kC = new Int32Array(16);
  const kF = new Int32Array(256);
  const stamp = new Int32Array(16);
  const cy = (y: number) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  const cx = (x: number) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  for (let dy = -r; dy <= r; dy++) {
    const row = cy(dy) * w;
    for (let x = 0; x < w; x++) {
      const v = src[row + x];
      colF[x * 256 + v]++;
      colC[x * 16 + (v >> 4)]++;
    }
  }
  for (let y = 0; y < h; y++) {
    if (y > 0) {
      const ro = cy(y - r - 1) * w;
      const ri = cy(y + r) * w;
      for (let x = 0; x < w; x++) {
        const vo = src[ro + x];
        const vi = src[ri + x];
        colF[x * 256 + vo]--;
        colC[x * 16 + (vo >> 4)]--;
        colF[x * 256 + vi]++;
        colC[x * 16 + (vi >> 4)]++;
      }
    }
    kC.fill(0);
    for (let dx = -r; dx <= r; dx++) {
      const c = cx(dx) * 16;
      for (let b = 0; b < 16; b++) kC[b] += colC[c + b];
    }
    stamp.fill(-1 << 30);
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        const ci = cx(x + r) * 16;
        const co = cx(x - r - 1) * 16;
        for (let b = 0; b < 16; b++) kC[b] += colC[ci + b] - colC[co + b];
      }
      let acc = 0;
      let b = 0;
      while (acc + kC[b] <= half) acc += kC[b++];
      const fo = b * 16;
      if (x - stamp[b] > k) {
        kF.fill(0, fo, fo + 16);
        for (let dx = -r; dx <= r; dx++) {
          const c = cx(x + dx) * 256 + fo;
          for (let i = 0; i < 16; i++) kF[fo + i] += colF[c + i];
        }
      } else {
        for (let xx = stamp[b] + 1; xx <= x; xx++) {
          const ci = cx(xx + r) * 256 + fo;
          const co = cx(xx - r - 1) * 256 + fo;
          for (let i = 0; i < 16; i++) kF[fo + i] += colF[ci + i] - colF[co + i];
        }
      }
      stamp[b] = x;
      let i = 0;
      while (acc + kF[fo + i] <= half) acc += kF[fo + i++];
      out[y * w + x] = fo + i;
    }
  }
  return out;
}

/** cv2.medianBlur trojkanálového (BGR) obrázka. */
export function medianBlurBgr(src: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const n = w * h;
  const out = new Uint8Array(n * 3);
  const ch = new Uint8Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = src[3 * i + c];
    const m = medianBlurU8(ch, w, h, k);
    for (let i = 0; i < n; i++) out[3 * i + c] = m[i];
  }
  return out;
}

/** cv2.distanceTransform(mask, DIST_L2, 3) */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const A = 0.955;
  const B = 1.3693;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + A < v) v = d[i - 1] + A;
      if (y > 0) {
        if (d[i - w] + A < v) v = d[i - w] + A;
        if (x > 0 && d[i - w - 1] + B < v) v = d[i - w - 1] + B;
        if (x < w - 1 && d[i - w + 1] + B < v) v = d[i - w + 1] + B;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1 && d[i + 1] + A < v) v = d[i + 1] + A;
      if (y < h - 1) {
        if (d[i + w] + A < v) v = d[i + w] + A;
        if (x > 0 && d[i + w - 1] + B < v) v = d[i + w - 1] + B;
        if (x < w - 1 && d[i + w + 1] + B < v) v = d[i + w + 1] + B;
      }
      d[i] = v;
    }
  }
  return d;
}

/** cv2.distanceTransform(mask, DIST_L2, 5) */
export function distanceTransform5(mask: Uint8Array, w: number, h: number): Float32Array {
  const A = 1;
  const B = 1.4;
  const C = 2.1969;
  const fwd: [number, number, number][] = [
    [-2, -1, C], [-2, 1, C], [-1, -2, C], [-1, -1, B], [-1, 0, A], [-1, 1, B], [-1, 2, C], [0, -1, A],
  ];
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
  const pass = (forward: boolean) => {
    const s = forward ? 1 : -1;
    for (let yy = 0; yy < h; yy++) {
      const y = forward ? yy : h - 1 - yy;
      for (let xx = 0; xx < w; xx++) {
        const x = forward ? xx : w - 1 - xx;
        const i = y * w + x;
        let v = d[i];
        if (v === 0) continue;
        for (const [dy, dx, wt] of fwd) {
          const ny = y + s * dy;
          const nx = x + s * dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const c = d[ny * w + nx] + wt;
          if (c < v) v = c;
        }
        d[i] = v;
      }
    }
  };
  pass(true);
  pass(false);
  return d;
}

/** cv2.distanceTransform(mask, DIST_L2, DIST_MASK_PRECISE) na druhú. */
export function distanceTransformExactSq(mask: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      out[q] = dq * dq + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = d[row + x];
    pass(w);
    for (let x = 0; x < w; x++) d[row + x] = out[x];
  }
  return d;
}

/** hypot(Sobel dx, Sobel dy) / 8 (jadro 3x3) v obdĺžniku [x0, x1) x [y0, y1) obrázka pw x ph. */
export function sobelMagBox(
  plane: ArrayLike<number>,
  pw: number,
  ph: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Float32Array {
  const bw = x1 - x0;
  const out = new Float32Array(bw * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    const ru = reflect101(y - 1, ph) * pw;
    const rc = y * pw;
    const rd = reflect101(y + 1, ph) * pw;
    for (let x = x0; x < x1; x++) {
      const xl = reflect101(x - 1, pw);
      const xr = reflect101(x + 1, pw);
      const gx =
        plane[ru + xr] + 2 * plane[rc + xr] + plane[rd + xr] - (plane[ru + xl] + 2 * plane[rc + xl] + plane[rd + xl]);
      const gy =
        plane[rd + xl] + 2 * plane[rd + x] + plane[rd + xr] - (plane[ru + xl] + 2 * plane[ru + x] + plane[ru + xr]);
      out[(y - y0) * bw + (x - x0)] = Math.sqrt(gx * gx + gy * gy) / 8;
    }
  }
  return out;
}

/** cv2.resize(..., INTER_NEAREST) pre `ch`-kanálový 8-bitový obrázok. */
export function resizeNearest(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const xs = Int32Array.from({ length: dw }, (_, x) => Math.min(Math.floor((x * sw) / dw), sw - 1));
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(Math.floor((y * sh) / dh), sh - 1);
    for (let x = 0; x < dw; x++) {
      const s = (sy * sw + xs[x]) * ch;
      const o = (y * dw + x) * ch;
      for (let c = 0; c < ch; c++) out[o + c] = src[s + c];
    }
  }
  return out;
}

/** cv2.resize(..., INTER_AREA) pri zmenšení (priemer cez pokrytú plochu); pri zväčšení INTER_LINEAR. */
export function resizeAreaU8(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (dw >= sw && dh >= sh) return resizeLinearU8(src, ch, sw, sh, dw, dh);
  const tx = areaTaps(sw, dw);
  const ty = areaTaps(sh, dh);
  const tmp = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * ch;
    const orow = y * dw * ch;
    for (let x = 0; x < dw; x++) {
      const t0 = tx.start[x];
      const t1 = tx.start[x + 1];
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let t = t0; t < t1; t++) s += src[row + tx.idx[t] * ch + c] * tx.wgt[t];
        tmp[orow + x * ch + c] = s;
      }
    }
  }
  const acc = new Float32Array(dw * dh * ch);
  const rowLen = dw * ch;
  for (let y = 0; y < dh; y++) {
    const o = y * rowLen;
    for (let t = ty.start[y]; t < ty.start[y + 1]; t++) {
      const so = ty.idx[t] * rowLen;
      const wt = ty.wgt[t];
      for (let i = 0; i < rowLen; i++) acc[o + i] += tmp[so + i] * wt;
    }
  }
  return toU8(acc);
}

/** Váhy INTER_AREA: pre cieľový index d zdrojové indexy idx[start[d]..start[d+1]) a ich váhy. */
function areaTaps(srcLen: number, dstLen: number) {
  const scale = srcLen / dstLen;
  const start = new Int32Array(dstLen + 1);
  const idx: number[] = [];
  const wgt: number[] = [];
  for (let d = 0; d < dstLen; d++) {
    start[d] = idx.length;
    const s = d * scale;
    const e = Math.min((d + 1) * scale, srcLen);
    for (let i = Math.floor(s); i < Math.ceil(e); i++) {
      const overlap = Math.min(e, i + 1) - Math.max(s, i);
      if (overlap > 1e-12) {
        idx.push(i);
        wgt.push(overlap / scale);
      }
    }
  }
  start[dstLen] = idx.length;
  return { start, idx: Int32Array.from(idx), wgt: Float32Array.from(wgt) };
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

/** cv2.resize(..., INTER_LINEAR) pre `ch`-kanálový 8-bitový obrázok. */
export function resizeLinearU8(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const tx = Array.from({ length: dw }, (_, x) => linearTap(x, sw / dw, sw));
  for (let y = 0; y < dh; y++) {
    const [y0, y1, ay] = linearTap(y, sh / dh, sh);
    for (let x = 0; x < dw; x++) {
      const [x0, x1, ax] = tx[x];
      for (let c = 0; c < ch; c++) {
        const top = src[(y0 * sw + x0) * ch + c] * (1 - ax) + src[(y0 * sw + x1) * ch + c] * ax;
        const bottom = src[(y1 * sw + x0) * ch + c] * (1 - ax) + src[(y1 * sw + x1) * ch + c] * ax;
        const v = cvRound(top * (1 - ay) + bottom * ay);
        out[(y * dw + x) * ch + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}

/** Váhy bikubickej interpolácie OpenCV (A = -0,75). */
function cubicWeights(a: number): [number, number, number, number] {
  const A = -0.75;
  const w0 = ((A * (a + 1) - 5 * A) * (a + 1) + 8 * A) * (a + 1) - 4 * A;
  const w1 = ((A + 2) * a - (A + 3)) * a * a + 1;
  const w2 = ((A + 2) * (1 - a) - (A + 3)) * (1 - a) * (1 - a) + 1;
  return [w0, w1, w2, 1 - w0 - w1 - w2];
}

/** cv2.resize(..., INTER_CUBIC) pre `ch`-kanálový 8-bitový obrázok (okraj = krajný pixel). */
export function resizeCubicU8(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const tap = (d: number, scale: number, len: number) => {
    const f = (d + 0.5) * scale - 0.5;
    const s = Math.floor(f);
    const idx = [s - 1, s, s + 1, s + 2].map((i) => (i < 0 ? 0 : i >= len ? len - 1 : i));
    return { idx, wgt: cubicWeights(f - s) };
  };
  const tx = Array.from({ length: dw }, (_, x) => tap(x, sw / dw, sw));
  const tmp = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const { idx, wgt } = tx[x];
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let t = 0; t < 4; t++) s += src[(y * sw + idx[t]) * ch + c] * wgt[t];
        tmp[(y * dw + x) * ch + c] = s;
      }
    }
  }
  const out = new Float32Array(dw * dh * ch);
  for (let y = 0; y < dh; y++) {
    const { idx, wgt } = tap(y, sh / dh, sh);
    const o = y * dw * ch;
    for (let t = 0; t < 4; t++) {
      const so = idx[t] * dw * ch;
      for (let i = 0; i < dw * ch; i++) out[o + i] += tmp[so + i] * wgt[t];
    }
  }
  return toU8(out);
}

/** Náhrada cv2.inpaint(..., INPAINT_TELEA) pre BGR obrázok. */
export function inpaintBgr(img: Uint8Array, w: number, h: number, hole: Uint8Array): Uint8Array {
  const out = img.slice();
  const n = w * h;
  const known = new Uint8Array(n);
  let todo = new Int32Array(n);
  let nTodo = 0;
  for (let i = 0; i < n; i++) {
    if (hole[i]) todo[nTodo++] = i;
    else known[i] = 1;
  }
  if (nTodo === 0 || nTodo === n) return out;
  let rest = new Int32Array(nTodo);
  const filled = new Int32Array(nTodo);
  const values = new Uint8Array(nTodo * 3);
  while (nTodo > 0) {
    let nRest = 0;
    let nFilled = 0;
    for (let t = 0; t < nTodo; t++) {
      const i = todo[t];
      const x = i % w;
      const y = (i - x) / w;
      let cnt = 0;
      let b = 0;
      let g = 0;
      let r = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          const j = yy * w + xx;
          if (!known[j]) continue;
          cnt++;
          b += out[3 * j];
          g += out[3 * j + 1];
          r += out[3 * j + 2];
        }
      }
      if (cnt === 0) {
        rest[nRest++] = i;
      } else {
        values[3 * nFilled] = Math.round(b / cnt);
        values[3 * nFilled + 1] = Math.round(g / cnt);
        values[3 * nFilled + 2] = Math.round(r / cnt);
        filled[nFilled++] = i;
      }
    }
    if (nFilled === 0) break;
    for (let k = 0; k < nFilled; k++) {
      const i = filled[k];
      out[3 * i] = values[3 * k];
      out[3 * i + 1] = values[3 * k + 1];
      out[3 * i + 2] = values[3 * k + 2];
      known[i] = 1;
    }
    const swap = todo;
    todo = rest;
    rest = swap;
    nTodo = nRest;
  }
  return out;
}

/** np.percentile(values, q) (lineárna interpolácia). */
export function percentile(values: ArrayLike<number>, q: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  const v = Float64Array.from(values);
  v.sort();
  const index = (q / 100) * (n - 1);
  const lo = Math.floor(index);
  const hi = Math.min(lo + 1, n - 1);
  return v[lo] + (v[hi] - v[lo]) * (index - lo);
}

export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

/** Prah cv2.THRESH_OTSU pre 8-bitový obrázok (popredie = hodnota > prah). */
export function otsuThreshold(data: Uint8Array): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  const scale = 1 / data.length;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * hist[i];
  mu *= scale;
  let mu1 = 0;
  let q1 = 0;
  let maxSigma = 0;
  let maxVal = 0;
  const eps = 1.1920929e-7;
  for (let i = 0; i < 256; i++) {
    const p = hist[i] * scale;
    mu1 *= q1;
    q1 += p;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < eps || Math.max(q1, q2) > 1 - eps) continue;
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
