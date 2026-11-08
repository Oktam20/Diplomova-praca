import { zmenLinearne } from './filtre';
import type { Obrazok } from './obrazok';
import { naBase64, pngFarebny } from './png';

const MAX_STRANA = 360;
const PRIEHLADNOST = 0.5;

const FARBY_ZON = [
  [244, 197, 158],
  [236, 167, 109],
  [229, 135, 57],
  [149, 79, 24],
];
const LEM = [42, 134, 232];
const OBRYS = [59, 59, 208];
const VYNECHANE = [128, 128, 128];

/** Obrázok čŕt škvrny (PNG base64): zóny, lem, obrys a vynechané okolie, z ktorých kľúč počíta. */
export function obrazokCrt(obr: Obrazok, maska: Uint8Array, zony: Int8Array, lem: Uint8Array, papier: Uint8Array): string {
  const { sirka: w, vyska: h, data } = obr;
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maska[y * w + x] && !lem[y * w + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error('Prázdna maska.');
  const okraj = Math.round(0.35 * Math.max(x1 - x0, y1 - y0)) + 8;
  x0 = Math.max(0, x0 - okraj);
  y0 = Math.max(0, y0 - okraj);
  x1 = Math.min(w - 1, x1 + okraj);
  y1 = Math.min(h - 1, y1 + okraj);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const out = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * w + x0 + x;
      const o = (y * cw + x) * 3;
      const zmiesaj = (farba: number[]) => {
        for (let k = 0; k < 3; k++) out[o + k] = Math.round((1 - PRIEHLADNOST) * data[3 * i + k] + PRIEHLADNOST * farba[k]);
      };
      const naOkraji = x0 + x === 0 || y0 + y === 0 || x0 + x === w - 1 || y0 + y === h - 1;
      if (maska[i] && (naOkraji || !maska[i - 1] || !maska[i + 1] || !maska[i - w] || !maska[i + w])) out.set(OBRYS, o);
      else if (maska[i] && zony[i] >= 0) zmiesaj(FARBY_ZON[zony[i]]);
      else if (!maska[i] && lem[i]) zmiesaj(LEM);
      else if (!maska[i] && !papier[i]) zmiesaj(VYNECHANE);
      else out.set(data.subarray(3 * i, 3 * i + 3), o);
    }
  }
  const f = Math.min(1, MAX_STRANA / Math.max(cw, ch));
  const fw = Math.max(1, Math.round(cw * f));
  const fh = Math.max(1, Math.round(ch * f));
  const zmenseny = f < 1 ? zmenLinearne(out, 3, cw, ch, fw, fh) : out;
  return naBase64(pngFarebny({ sirka: fw, vyska: fh, data: zmenseny }, 1));
}
