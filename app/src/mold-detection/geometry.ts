import { cvRound, type BgrImage } from './image';

/** cv2.convexHull – v smere hodinových ručičiek na obrazovke, od bodu s min (x, y). */
export function convexHull(pts: ArrayLike<number>): number[] {
  const n = pts.length >> 1;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o: number, a: number, b: number) =>
    (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) -
    (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lower: number[] = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  if (hull.length === 0 && n > 0) hull.push(idx[0]);
  const out: number[] = [];
  for (const i of hull) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

/** cv2.isContourConvex. */
export function isContourConvex(p: ArrayLike<number>): boolean {
  const n = p.length >> 1;
  if (n < 3) return false;
  let prevX = p[2 * ((n - 2 + n) % n)];
  let prevY = p[2 * ((n - 2 + n) % n) + 1];
  let curX = p[2 * (n - 1)];
  let curY = p[2 * (n - 1) + 1];
  let dx0 = curX - prevX;
  let dy0 = curY - prevY;
  let orientation = 0;
  for (let i = 0; i < n; i++) {
    prevX = curX;
    prevY = curY;
    curX = p[2 * i];
    curY = p[2 * i + 1];
    const dx = curX - prevX;
    const dy = curY - prevY;
    const dxdy0 = dx * dy0;
    const dydx0 = dy * dx0;
    orientation |= dydx0 > dxdy0 ? 1 : dydx0 < dxdy0 ? 2 : 3;
    if (orientation === 3) return false;
    dx0 = dx;
    dy0 = dy;
  }
  return true;
}

/** cv2.boundingRect pre celočíselné body – [x, y, w, h]. */
export function boundingRect(p: ArrayLike<number>): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
  }
  return [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

/** cv2.getPerspectiveTransform – 3x3 matica (riadkovo) zo 4 párov bodov. */
export function getPerspectiveTransform(src: number[], dst: number[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = src[2 * i];
    const y = src[2 * i + 1];
    const u = dst[2 * i];
    const v = dst[2 * i + 1];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      if (f === 0) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [...x, 1];
}

/** Inverzia 3x3 matice tak ako cv::invert pre malé matice. */
function invert3x3(m: number[]): number[] {
  let d =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  d = d !== 0 ? 1 / d : 0;
  return [
    (m[4] * m[8] - m[5] * m[7]) * d,
    (m[2] * m[7] - m[1] * m[8]) * d,
    (m[1] * m[5] - m[2] * m[4]) * d,
    (m[5] * m[6] - m[3] * m[8]) * d,
    (m[0] * m[8] - m[2] * m[6]) * d,
    (m[2] * m[3] - m[0] * m[5]) * d,
    (m[3] * m[7] - m[4] * m[6]) * d,
    (m[1] * m[6] - m[0] * m[7]) * d,
    (m[0] * m[4] - m[1] * m[3]) * d,
  ];
}

const INTER_BITS = 5;
const INTER_TAB_SIZE = 1 << INTER_BITS;

/** cv2.warpPerspective(src, M, (outW, outH)) s INTER_LINEAR a BORDER_CONSTANT (0). */
export function warpPerspective(src: BgrImage, M: number[], outW: number, outH: number): BgrImage {
  const m = invert3x3(M);
  const { width: sw, height: sh, data: s } = src;
  const out = new Uint8Array(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    const X0 = m[1] * y + m[2];
    const Y0 = m[4] * y + m[5];
    const W0 = m[7] * y + m[8];
    for (let x = 0; x < outW; x++) {
      let W = W0 + m[6] * x;
      W = W ? INTER_TAB_SIZE / W : 0;
      const fX = Math.max(-2147483648, Math.min(2147483647, (X0 + m[0] * x) * W));
      const fY = Math.max(-2147483648, Math.min(2147483647, (Y0 + m[3] * x) * W));
      const X = cvRound(fX);
      const Y = cvRound(fY);
      const sx = X >> INTER_BITS;
      const sy = Y >> INTER_BITS;
      const ax = X & (INTER_TAB_SIZE - 1);
      const ay = Y & (INTER_TAB_SIZE - 1);
      const w00 = (INTER_TAB_SIZE - ax) * (INTER_TAB_SIZE - ay);
      const w01 = ax * (INTER_TAB_SIZE - ay);
      const w10 = (INTER_TAB_SIZE - ax) * ay;
      const w11 = ax * ay;
      const o = (y * outW + x) * 3;
      if (sx >= 0 && sy >= 0 && sx < sw - 1 && sy < sh - 1) {
        const p00 = (sy * sw + sx) * 3;
        const p10 = p00 + sw * 3;
        for (let c = 0; c < 3; c++) {
          const v = s[p00 + c] * w00 + s[p00 + 3 + c] * w01 + s[p10 + c] * w10 + s[p10 + 3 + c] * w11;
          out[o + c] = (v + 512) >> 10;
        }
      } else if (sx >= sw || sx + 1 < 0 || sy >= sh || sy + 1 < 0) {
      } else {
        const inX0 = sx >= 0 && sx < sw;
        const inX1 = sx + 1 >= 0 && sx + 1 < sw;
        const inY0 = sy >= 0 && sy < sh;
        const inY1 = sy + 1 >= 0 && sy + 1 < sh;
        for (let c = 0; c < 3; c++) {
          const v00 = inX0 && inY0 ? s[(sy * sw + sx) * 3 + c] : 0;
          const v01 = inX1 && inY0 ? s[(sy * sw + sx + 1) * 3 + c] : 0;
          const v10 = inX0 && inY1 ? s[((sy + 1) * sw + sx) * 3 + c] : 0;
          const v11 = inX1 && inY1 ? s[((sy + 1) * sw + sx + 1) * 3 + c] : 0;
          out[o + c] = (v00 * w00 + v01 * w01 + v10 * w10 + v11 * w11 + 512) >> 10;
        }
      }
    }
  }
  return { width: outW, height: outH, data: out };
}
