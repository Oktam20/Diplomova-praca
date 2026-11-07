import type { BgrImage } from './image';
import { bytesToBase64, encodeBgrPng } from './png';
import { resizeLinearU8 } from './raster';

const MAX_SIDE = 360;

export const ZONE_COLORS: [number, number, number][] = [
  [244, 197, 158],
  [236, 167, 109],
  [229, 135, 57],
  [149, 79, 24],
];
const HALO: [number, number, number] = [42, 134, 232];
const OUTLINE: [number, number, number] = [59, 59, 208];
const EXCLUDED: [number, number, number] = [128, 128, 128];
const ALPHA = 0.5;

export function spotFigurePng(
  image: BgrImage,
  mask: Uint8Array,
  zony: Int8Array,
  halo: Uint8Array,
  paper: Uint8Array
): string {
  const { width: w, height: h, data } = image;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x] && !halo[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('Prázdna maska.');
  const pad = Math.round(0.35 * Math.max(x1 - x0, y1 - y0)) + 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const out = new Uint8Array(cw * ch * 3);
  const blend = (o: number, s: number, col: [number, number, number]) => {
    for (let k = 0; k < 3; k++) out[o + k] = Math.round((1 - ALPHA) * data[s + k] + ALPHA * col[k]);
  };
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * w + (x0 + x);
      const s = i * 3;
      const o = (y * cw + x) * 3;
      if (mask[i]) {
        const edge =
          x0 + x === 0 || y0 + y === 0 || x0 + x === w - 1 || y0 + y === h - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w];
        if (edge) {
          out.set(OUTLINE, o);
          continue;
        }
        const z = zony[i];
        if (z >= 0) blend(o, s, ZONE_COLORS[z]);
        else out.set(data.subarray(s, s + 3), o);
      } else if (halo[i]) {
        blend(o, s, HALO);
      } else if (!paper[i]) {
        blend(o, s, EXCLUDED);
      } else {
        out.set(data.subarray(s, s + 3), o);
      }
    }
  }
  const f = Math.min(1, MAX_SIDE / Math.max(cw, ch));
  const fw = Math.max(1, Math.round(cw * f));
  const fh = Math.max(1, Math.round(ch * f));
  const img = f < 1 ? resizeLinearU8(out, 3, cw, ch, fw, fh) : out;
  return bytesToBase64(encodeBgrPng({ width: fw, height: fh, data: img }, 1));
}
