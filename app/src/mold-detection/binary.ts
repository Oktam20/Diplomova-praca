import { cvRound } from './image';

export type BitImage = {
  width: number;
  height: number;
  stride: number;
  data: Uint32Array;
};

export function createBitImage(width: number, height: number): BitImage {
  const stride = (width + 31) >>> 5;
  return { width, height, stride, data: new Uint32Array(stride * height) };
}

function tailMask(width: number): number {
  const r = width & 31;
  return r === 0 ? 0xffffffff : ((1 << r) - 1) >>> 0;
}

/** Binárny obrázok z 8-bitového: pixel je 1, ak lut[hodnota] je 1. */
export function bitsFromLut(
  src: Uint8Array,
  width: number,
  height: number,
  lut: Uint8Array
): { bits: BitImage; count: number } {
  const bits = createBitImage(width, height);
  const { stride, data } = bits;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const wo = y * stride;
    for (let k = 0; k < stride; k++) {
      const x0 = k << 5;
      const x1 = Math.min(x0 + 32, width);
      let word = 0;
      for (let x = x0; x < x1; x++) {
        if (lut[src[row + x]]) {
          word |= 1 << (x - x0);
          count++;
        }
      }
      data[wo + k] = word;
    }
  }
  return { bits, count };
}

function invertBits(src: BitImage): BitImage {
  const out = createBitImage(src.width, src.height);
  const { stride, height } = src;
  const tail = tailMask(src.width);
  for (let y = 0; y < height; y++) {
    const o = y * stride;
    for (let k = 0; k < stride; k++) out.data[o + k] = ~src.data[o + k];
    out.data[o + stride - 1] &= tail;
  }
  return out;
}

export function getBit(bits: BitImage, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bits.width || y >= bits.height) return false;
  return ((bits.data[y * bits.stride + (x >> 5)] >>> (x & 31)) & 1) === 1;
}

/** Nastaví pixely [s, e] (vrátane) v riadku y. */
function setRange(bits: BitImage, y: number, s: number, e: number): void {
  const o = y * bits.stride;
  const k0 = s >> 5;
  const k1 = e >> 5;
  const lo = -1 << (s & 31);
  const hi = (e & 31) === 31 ? -1 : (1 << ((e & 31) + 1)) - 1;
  if (k0 === k1) {
    bits.data[o + k0] |= lo & hi;
    return;
  }
  bits.data[o + k0] |= lo;
  for (let k = k0 + 1; k < k1; k++) bits.data[o + k] = 0xffffffff;
  bits.data[o + k1] |= hi;
}

/** Pol-šírky riadkov elipsy ako cv2.getStructuringElement(MORPH_ELLIPSE, (k, k)) */
export function ellipseHalfWidths(ksize: number): number[] {
  const r = ksize >> 1;
  const c = ksize >> 1;
  const inv = r ? 1 / (r * r) : 0;
  const out: number[] = [];
  for (let i = 0; i < ksize; i++) {
    const dy = i - r;
    out.push(Math.min(cvRound(c * Math.sqrt((r * r - dy * dy) * inv)), c));
  }
  return out;
}

function horizontalDilations(src: BitImage, wanted: boolean[], maxR: number): (Uint32Array | null)[] {
  const { stride, height, width } = src;
  const out: (Uint32Array | null)[] = new Array(maxR + 1).fill(null);
  out[0] = src.data;
  if (maxR === 0) return out;
  const s = src.data;
  const cur = s.slice();
  const tail = tailMask(width);
  for (let r = 1; r <= maxR; r++) {
    const inv = 32 - r;
    for (let y = 0; y < height; y++) {
      const o = y * stride;
      const last = o + stride - 1;
      for (let k = o; k <= last; k++) {
        const w = s[k];
        let v = (w >>> r) | (w << r);
        if (k < last) v |= s[k + 1] << inv;
        if (k > o) v |= s[k - 1] >>> inv;
        cur[k] |= v;
      }
      cur[last] &= tail;
    }
    if (wanted[r]) out[r] = cur.slice();
  }
  return out;
}

/** cv2.dilate so symetrickým jadrom zadaným pol-šírkami riadkov (okraj = 0). */
export function dilate(src: BitImage, halfWidths: readonly number[]): BitImage {
  const { width, height, stride } = src;
  const kh = halfWidths.length;
  const c = (kh - 1) >> 1;
  const wanted: boolean[] = [];
  let maxR = 0;
  for (const r of halfWidths) {
    wanted[r] = true;
    if (r > maxR) maxR = r;
  }
  const rows = horizontalDilations(src, wanted, maxR);
  const out = createBitImage(width, height);
  const od = out.data;
  for (let i = 0; i < kh; i++) {
    const hr = rows[halfWidths[i]]!;
    const dy = i - c;
    const y0 = Math.max(0, -dy);
    const y1 = Math.min(height, height - dy);
    for (let y = y0; y < y1; y++) {
      const oo = y * stride;
      const so = (y + dy) * stride;
      for (let k = 0; k < stride; k++) od[oo + k] |= hr[so + k];
    }
  }
  return out;
}

/** cv2.erode (okraj = +nekonečno, teda mimo obrázka sú jednotky). */
export function erode(src: BitImage, halfWidths: readonly number[]): BitImage {
  return invertBits(dilate(invertBits(src), halfWidths));
}

export class Ellipse9CloseOpen {
  private readonly width: number;
  private readonly height: number;
  private readonly stride: number;
  private readonly tail: number;
  private readonly h0: Uint32Array;
  private readonly h3: Uint32Array;
  private readonly h4: Uint32Array;
  private readonly a: Uint32Array;
  private readonly b: Uint32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.stride = (width + 31) >>> 5;
    this.tail = tailMask(width) | 0;
    const padded = this.stride * (height + 8);
    this.h0 = new Uint32Array(padded);
    this.h3 = new Uint32Array(padded);
    this.h4 = new Uint32Array(padded);
    this.a = new Uint32Array(this.stride * height);
    this.b = new Uint32Array(this.stride * height);
  }

  run(src: BitImage): BitImage {
    this.pass(src.data, this.a, false);
    this.pass(this.a, this.b, true);
    this.pass(this.b, this.a, true);
    this.pass(this.a, this.b, false);
    return { width: this.width, height: this.height, stride: this.stride, data: this.b };
  }

  private pass(src: Uint32Array, dst: Uint32Array, erodeMode: boolean): void {
    const { stride, height, tail, h0, h3, h4 } = this;
    for (let y = 0; y < height; y++) {
      const o = y * stride;
      const last = o + stride - 1;
      const po = (y + 4) * stride - o;
      let p = 0;
      let c = erodeMode ? ~src[o] & (o === last ? tail : -1) : src[o] | 0;
      for (let k = o; k <= last; k++) {
        let n = 0;
        if (k < last) {
          n = erodeMode ? ~src[k + 1] & (k + 1 === last ? tail : -1) : src[k + 1] | 0;
        }
        let r3: number;
        let r4: number;
        if ((c | p | n) === 0) {
          r3 = r4 = 0;
        } else if ((c & p & n) === -1) {
          r3 = r4 = -1;
        } else {
          r3 =
            c |
            (c >>> 1) | (n << 31) | (c << 1) | (p >>> 31) |
            (c >>> 2) | (n << 30) | (c << 2) | (p >>> 30) |
            (c >>> 3) | (n << 29) | (c << 3) | (p >>> 29);
          r4 = r3 | (c >>> 4) | (n << 28) | (c << 4) | (p >>> 28);
        }
        if (k === last) {
          r3 &= tail;
          r4 &= tail;
        }
        h0[po + k] = c;
        h3[po + k] = r3;
        h4[po + k] = r4;
        p = c;
        c = n;
      }
    }
    const s = stride;
    for (let y = 0; y < height; y++) {
      const base = (y + 4) * s;
      const o = y * s;
      for (let k = 0; k < s; k++) {
        const i = base + k;
        const v =
          h0[i - 4 * s] | h3[i - 3 * s] | h3[i - 2 * s] | h4[i - s] | h4[i] |
          h4[i + s] | h3[i + 2 * s] | h3[i + 3 * s] | h0[i + 4 * s];
        dst[o + k] = erodeMode ? ~v & (k === s - 1 ? tail : -1) : v;
      }
    }
  }
}

/** Masky „hodnota <= cut“ pre viacero prahov naraz. */
export function belowMasks(src: Uint8Array, width: number, height: number, cuts: number[]): Map<number, BitImage> {
  const sorted = [...new Set(cuts)].sort((x, y) => x - y);
  const result = new Map<number, BitImage>();
  if (sorted.length === 0) return result;
  const maxCut = sorted[sorted.length - 1];

  const n = width * height;
  const start = new Int32Array(257);
  for (let i = 0; i < n; i++) start[src[i] + 1]++;
  for (let v = 0; v < 256; v++) start[v + 1] += start[v];
  const fill = start.slice(0, 256);
  const word = new Int32Array(n);
  const bit = new Int32Array(n);
  const stride = (width + 31) >>> 5;
  for (let y = 0, i = 0; y < height; y++) {
    const ro = y * stride;
    for (let x = 0; x < width; x++, i++) {
      const v = src[i];
      if (v > maxCut) continue;
      const pos = fill[v]++;
      word[pos] = ro + (x >> 5);
      bit[pos] = 1 << (x & 31);
    }
  }

  const cur = createBitImage(width, height);
  let next = 0;
  for (const cut of sorted) {
    for (; next <= cut; next++) {
      for (let pos = start[next]; pos < start[next + 1]; pos++) cur.data[word[pos]] |= bit[pos];
    }
    result.set(cut, { ...cur, data: cur.data.slice() });
  }
  return result;
}

/** Doplnok binárneho obrázka (bity za šírkou ostanú 0). */
export function complementBits(src: BitImage): BitImage {
  return invertBits(src);
}

export type Runs = {
  count: number;
  rowStart: Int32Array;
  xs: Int32Array;
  xe: Int32Array;
};

const ctz = (v: number) => 31 - Math.clz32(v & -v);

export function extractRuns(bits: BitImage): Runs {
  const { width, height, stride, data } = bits;
  let cap = Math.max(64, height * 4);
  let xs = new Int32Array(cap);
  let xe = new Int32Array(cap);
  const rowStart = new Int32Array(height + 1);
  let n = 0;
  const push = (s: number, e: number) => {
    if (n === cap) {
      cap *= 2;
      const nxs = new Int32Array(cap);
      nxs.set(xs);
      xs = nxs;
      const nxe = new Int32Array(cap);
      nxe.set(xe);
      xe = nxe;
    }
    xs[n] = s;
    xe[n] = e;
    n++;
  };
  for (let y = 0; y < height; y++) {
    rowStart[y] = n;
    let open = -1;
    const o = y * stride;
    for (let k = 0; k < stride; k++) {
      let w = data[o + k];
      const base = k << 5;
      if (open >= 0) {
        if (w === 0xffffffff) continue;
        const z = ctz(~w);
        push(open, base + z - 1);
        open = -1;
        w = (w & (-1 << z)) >>> 0;
      }
      while (w !== 0) {
        const t = ctz(w);
        const inv = ~(w >>> t);
        const ones = inv === 0 ? 32 : ctz(inv);
        const end = t + ones;
        if (end >= 32) {
          open = base + t;
          break;
        }
        push(base + t, base + end - 1);
        w = (w & (-1 << end)) >>> 0;
      }
    }
    if (open >= 0) push(open, width - 1);
  }
  rowStart[height] = n;
  return { count: n, rowStart, xs: xs.subarray(0, n), xe: xe.subarray(0, n) };
}

/** Behy pozadia (doplnok behov popredia v rámci šírky). */
function complementRuns(fg: Runs, width: number, height: number): Runs {
  const cap = fg.count + height;
  const xs = new Int32Array(cap);
  const xe = new Int32Array(cap);
  const rowStart = new Int32Array(height + 1);
  let n = 0;
  for (let y = 0; y < height; y++) {
    rowStart[y] = n;
    let start = 0;
    for (let i = fg.rowStart[y]; i < fg.rowStart[y + 1]; i++) {
      if (fg.xs[i] > start) {
        xs[n] = start;
        xe[n] = fg.xs[i] - 1;
        n++;
      }
      start = fg.xe[i] + 1;
    }
    if (start <= width - 1) {
      xs[n] = start;
      xe[n] = width - 1;
      n++;
    }
  }
  rowStart[height] = n;
  return { count: n, rowStart, xs: xs.subarray(0, n), xe: xe.subarray(0, n) };
}

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

/** Spojí behy susedných riadkov; gap = 1 pre 8-susednosť, 0 pre 4-susednosť. */
function unionRuns(runs: Runs, height: number, gap: number): Int32Array {
  const parent = new Int32Array(runs.count);
  for (let i = 0; i < runs.count; i++) parent[i] = i;
  const { rowStart, xs, xe } = runs;
  for (let y = 1; y < height; y++) {
    let i = rowStart[y - 1];
    const ie = rowStart[y];
    let j = rowStart[y];
    const je = rowStart[y + 1];
    while (i < ie && j < je) {
      if (xe[i] + gap < xs[j]) {
        i++;
        continue;
      }
      if (xe[j] + gap < xs[i]) {
        j++;
        continue;
      }
      const a = find(parent, i);
      const b = find(parent, j);
      if (a < b) parent[b] = a;
      else if (b < a) parent[a] = b;
      if (xe[i] < xe[j]) i++;
      else j++;
    }
  }
  return parent;
}

/** Pozadie spojené (4-susednosťou) s okrajom obrázka. */
function outerBackground(fg: Runs, width: number, height: number): { bg: Runs; outer: Uint8Array } {
  const bg = complementRuns(fg, width, height);
  const parent = unionRuns(bg, height, 0);
  const rootOuter = new Uint8Array(bg.count);
  for (let y = 0; y < height; y++) {
    for (let i = bg.rowStart[y]; i < bg.rowStart[y + 1]; i++) {
      if (y === 0 || y === height - 1 || bg.xs[i] === 0 || bg.xe[i] === width - 1) {
        rootOuter[find(parent, i)] = 1;
      }
    }
  }
  const outer = new Uint8Array(bg.count);
  for (let i = 0; i < bg.count; i++) outer[i] = rootOuter[find(parent, i)];
  return { bg, outer };
}

/** Vyplnenie dier: obdoba findContours(RETR_EXTERNAL) + drawContours(FILLED) */
export function fillHoles(bits: BitImage): BitImage {
  const fg = extractRuns(bits);
  const { bg, outer } = outerBackground(fg, bits.width, bits.height);
  const out: BitImage = { ...bits, data: bits.data.slice() };
  for (let y = 0; y < bits.height; y++) {
    for (let i = bg.rowStart[y]; i < bg.rowStart[y + 1]; i++) {
      if (!outer[i]) setRange(out, y, bg.xs[i], bg.xe[i]);
    }
  }
  return out;
}

export type Components = {
  runs: Runs;
  runLabel: Int32Array;
  count: number;
  area: Int32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
  startX: Int32Array;
  startY: Int32Array;
};

/** cv2.connectedComponentsWithStats (8-susednosť). */
export function labelComponents(bits: BitImage, runs = extractRuns(bits)): Components {
  const { height } = bits;
  const parent = unionRuns(runs, height, 1);
  const size = runs.count + 1;
  const runLabel = new Int32Array(runs.count);
  const rootLabel = new Int32Array(runs.count);
  const area = new Int32Array(size);
  const minX = new Int32Array(size);
  const minY = new Int32Array(size);
  const maxX = new Int32Array(size);
  const maxY = new Int32Array(size);
  const startX = new Int32Array(size);
  const startY = new Int32Array(size);
  let next = 1;
  for (let y = 0; y < height; y++) {
    for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
      const root = find(parent, i);
      let lab = rootLabel[root];
      const s = runs.xs[i];
      const e = runs.xe[i];
      if (lab === 0) {
        lab = rootLabel[root] = next++;
        startX[lab] = s;
        startY[lab] = y;
        minX[lab] = s;
        maxX[lab] = e;
        minY[lab] = y;
      }
      runLabel[i] = lab;
      area[lab] += e - s + 1;
      if (s < minX[lab]) minX[lab] = s;
      if (e > maxX[lab]) maxX[lab] = e;
      maxY[lab] = y;
    }
  }
  return { runs, runLabel, count: next - 1, area, minX, minY, maxX, maxY, startX, startY };
}

/** 8-bitová maska (0/255) z vybraných labelov. */
export function rasterizeLabels(comps: Components, width: number, height: number, keep: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height);
  const { runs, runLabel } = comps;
  for (let y = 0; y < height; y++) {
    for (let i = runs.rowStart[y]; i < runs.rowStart[y + 1]; i++) {
      if (keep[runLabel[i]]) out.fill(255, y * width + runs.xs[i], y * width + runs.xe[i] + 1);
    }
  }
  return out;
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const DIR = [3, 2, 1, 4, -1, 0, 5, 6, 7];

export function traceOuterBorder(bits: BitImage, sx: number, sy: number): number[] {
  let d1 = -1;
  for (let k = 0; k < 8; k++) {
    const d = (12 - k) & 7;
    if (getBit(bits, sx + DX[d], sy + DY[d])) {
      d1 = d;
      break;
    }
  }
  if (d1 < 0) return [sx, sy];
  const x1 = sx + DX[d1];
  const y1 = sy + DY[d1];
  let x2 = x1;
  let y2 = y1;
  let x3 = sx;
  let y3 = sy;
  const pts: number[] = [];
  for (;;) {
    const d2 = DIR[(y2 - y3 + 1) * 3 + (x2 - x3 + 1)];
    let x4 = x2;
    let y4 = y2;
    for (let k = 1; k <= 8; k++) {
      const d = (d2 + k) & 7;
      const nx = x3 + DX[d];
      const ny = y3 + DY[d];
      if (getBit(bits, nx, ny)) {
        x4 = nx;
        y4 = ny;
        break;
      }
    }
    pts.push(x3, y3);
    if (x4 === sx && y4 === sy && x3 === x1 && y3 === y1) break;
    x2 = x3;
    y2 = y3;
    x3 = x4;
    y3 = y4;
  }
  return pts;
}

export function externalComponents(bits: BitImage): { comps: Components; external: Uint8Array } {
  const comps = labelComponents(bits);
  const { bg, outer } = outerBackground(comps.runs, bits.width, bits.height);
  const external = new Uint8Array(comps.count + 1);
  for (let lab = 1; lab <= comps.count; lab++) {
    const sx = comps.startX[lab];
    external[lab] = sx === 0 || isOuterAt(bg, outer, sx - 1, comps.startY[lab]) ? 1 : 0;
  }
  return { comps, external };
}

function isOuterAt(bg: Runs, outer: Uint8Array, x: number, y: number): boolean {
  let lo = bg.rowStart[y];
  let hi = bg.rowStart[y + 1] - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bg.xe[mid] < x) lo = mid + 1;
    else if (bg.xs[mid] > x) hi = mid - 1;
    else return outer[mid] === 1;
  }
  return false;
}

/** cv2.contourArea (absolútna hodnota). */
export function contourArea(pts: ArrayLike<number>): number {
  const n = pts.length >> 1;
  if (n < 3) return 0;
  let a = 0;
  let px = pts[2 * n - 2];
  let py = pts[2 * n - 1];
  for (let i = 0; i < n; i++) {
    const x = pts[2 * i];
    const y = pts[2 * i + 1];
    a += px * y - py * x;
    px = x;
    py = y;
  }
  return Math.abs(a * 0.5);
}

/** cv2.arcLength(contour, closed=True). */
export function arcLength(pts: ArrayLike<number>): number {
  const n = pts.length >> 1;
  if (n < 2) return 0;
  let len = 0;
  let px = pts[2 * n - 2];
  let py = pts[2 * n - 1];
  for (let i = 0; i < n; i++) {
    const x = pts[2 * i];
    const y = pts[2 * i + 1];
    len += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
    px = x;
    py = y;
  }
  return len;
}
