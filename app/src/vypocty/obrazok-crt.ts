import { zmenNajblizsi, zmenPlochou } from './filtre';
import { vyrezObrazka, zaokruhli, type Obdlznik, type Obrazok } from './obrazok';
import { naBase64, pngFarebny } from './png';

const MAX_STRANA = 720;
const MAX_NAHLAD = 160;
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

/** Maska alebo mapa (w × h) zväčšená bez vyhladzovania na veľkosť obrázka. */
function naVelkost(pole: Uint8Array, w: number, h: number, obr: Obrazok): Uint8Array {
  return w === obr.sirka && h === obr.vyska ? pole : zmenNajblizsi(pole, 1, w, h, obr.sirka, obr.vyska);
}

/** Najmenší obdĺžnik [x0, y0, x1, y1] (vrátane) okolo nenulových pixelov; null pri prázdnej maske. */
function ohranicenie(maska: Uint8Array, w: number, h: number): Obdlznik | null {
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maska[y * w + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Obrázok zmenšený na dlhšiu stranu najviac `strana` px ako PNG base64. */
function zmensenyPng({ sirka, vyska, data }: Obrazok, strana: number): string {
  const f = Math.min(1, strana / Math.max(sirka, vyska));
  const fw = Math.max(1, zaokruhli(sirka * f));
  const fh = Math.max(1, zaokruhli(vyska * f));
  const zmenseny = f < 1 ? zmenPlochou(data, 3, sirka, vyska, fw, fh) : data;
  return naBase64(pngFarebny({ sirka: fw, vyska: fh, data: zmenseny }, 1));
}

/**
 * Obrázok čŕt škvrny (PNG base64): zóny, lem, obrys a vynechané okolie, z ktorých kľúč počíta.
 * Masky majú rozmer w × h; `obr` môže byť ten istý výrez vo vyššom rozlíšení.
 */
export function obrazokCrt(obr: Obrazok, w: number, h: number, maska: Uint8Array, zony: Int8Array, lem: Uint8Array, papier: Uint8Array): string {
  const { sirka: W, vyska: H, data } = obr;
  const vnutri = naVelkost(maska, w, h, obr);
  const zonyV = Int8Array.from(naVelkost(Uint8Array.from(zony, (z) => z + 1), w, h, obr), (z) => z - 1);
  const lemV = naVelkost(lem, w, h, obr);
  const papierV = naVelkost(papier, w, h, obr);

  const okolie = Uint8Array.from(vnutri, (v, i) => (v || lemV[i] ? 1 : 0));
  const box = ohranicenie(okolie, W, H);
  if (!box) throw new Error('Prázdna maska.');
  let [x0, y0, x1, y1] = box;
  const okraj = Math.round(0.35 * Math.max(x1 - x0, y1 - y0)) + 8;
  x0 = Math.max(0, x0 - okraj);
  y0 = Math.max(0, y0 - okraj);
  x1 = Math.min(W - 1, x1 + okraj);
  y1 = Math.min(H - 1, y1 + okraj);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  const out = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y0 + y) * W + x0 + x;
      const o = (y * cw + x) * 3;
      const zmiesaj = (farba: number[]) => {
        for (let k = 0; k < 3; k++) out[o + k] = Math.round((1 - PRIEHLADNOST) * data[3 * i + k] + PRIEHLADNOST * farba[k]);
      };
      const naOkraji = x0 + x === 0 || y0 + y === 0 || x0 + x === W - 1 || y0 + y === H - 1;
      if (vnutri[i] && (naOkraji || !vnutri[i - 1] || !vnutri[i + 1] || !vnutri[i - W] || !vnutri[i + W])) out.set(OBRYS, o);
      else if (vnutri[i] && zonyV[i] >= 0) zmiesaj(FARBY_ZON[zonyV[i]]);
      else if (vnutri[i]) zmiesaj(VYNECHANE);
      else if (lemV[i]) zmiesaj(LEM);
      else if (!papierV[i]) zmiesaj(VYNECHANE);
      else out.set(data.subarray(3 * i, 3 * i + 3), o);
    }
  }
  return zmensenyPng({ sirka: cw, vyska: ch, data: out }, MAX_STRANA);
}

/** Malý výrez okolo škvrny bez značiek (PNG base64) na zoznam škvŕn; null pri prázdnej maske. */
export function nahlad(obr: Obrazok, w: number, h: number, maska: Uint8Array): string | null {
  const { sirka: W, vyska: H } = obr;
  const box = ohranicenie(naVelkost(maska, w, h, obr), W, H);
  if (!box) return null;
  const [x0, y0, x1, y1] = box;
  const okraj = Math.round(0.15 * Math.max(x1 - x0, y1 - y0)) + 4;
  const vyrez = vyrezObrazka(obr, [Math.max(0, x0 - okraj), Math.max(0, y0 - okraj), Math.min(W, x1 + okraj + 1), Math.min(H, y1 + okraj + 1)]);
  return zmensenyPng(vyrez, MAX_NAHLAD);
}
