import { zaokruhli } from './obrazok';

/** Binárny obrázok – 32 pixelov v jednom čísle (riadok má `slov` čísel). */
type Bity = { sirka: number; vyska: number; slov: number; data: Uint32Array };

function noveBity(sirka: number, vyska: number): Bity {
  const slov = (sirka + 31) >>> 5;
  return { sirka, vyska, slov, data: new Uint32Array(slov * vyska) };
}

/** Bity posledného slova v riadku, ktoré ešte patria do obrázka. */
function koniecRiadku(sirka: number): number {
  const r = sirka & 31;
  return r === 0 ? 0xffffffff : ((1 << r) - 1) >>> 0;
}

function naBity(maska: Uint8Array, sirka: number, vyska: number): Bity {
  const bity = noveBity(sirka, vyska);
  for (let y = 0; y < vyska; y++) {
    for (let x = 0; x < sirka; x++) if (maska[y * sirka + x]) bity.data[y * bity.slov + (x >> 5)] |= 1 << (x & 31);
  }
  return bity;
}

function naMasku({ sirka, vyska, slov, data }: Bity): Uint8Array {
  const out = new Uint8Array(sirka * vyska);
  for (let y = 0; y < vyska; y++) {
    for (let x = 0; x < sirka; x++) out[y * sirka + x] = (data[y * slov + (x >> 5)] >>> (x & 31)) & 1;
  }
  return out;
}

function doplnok(src: Bity): Bity {
  const out = noveBity(src.sirka, src.vyska);
  const koniec = koniecRiadku(src.sirka);
  for (let y = 0; y < src.vyska; y++) {
    const o = y * src.slov;
    for (let k = 0; k < src.slov; k++) out.data[o + k] = ~src.data[o + k];
    out.data[o + src.slov - 1] &= koniec;
  }
  return out;
}

/** Polovičné šírky riadkov kruhu s polomerom r ako cv2.getStructuringElement(MORPH_ELLIPSE, (2r+1, 2r+1)). */
export function kruh(polomer: number): number[] {
  const r = Math.max(1, zaokruhli(polomer));
  const inv = 1 / (r * r);
  return Array.from({ length: 2 * r + 1 }, (_, i) => Math.min(zaokruhli(r * Math.sqrt((r * r - (i - r) * (i - r)) * inv)), r));
}

/** Pridá do `cur` pixely z `s` posunuté o r doľava aj doprava. */
function pridajPosun(s: Uint32Array, cur: Uint32Array, slov: number, vyska: number, koniec: number, r: number): void {
  const q = r >> 5;
  const b = r & 31;
  for (let y = 0; y < vyska; y++) {
    const o = y * slov;
    for (let k = 0; k < slov; k++) {
      let v = 0;
      const a = k - q;
      if (a >= 0) {
        v |= b ? s[o + a] << b : s[o + a];
        if (b && a > 0) v |= s[o + a - 1] >>> (32 - b);
      }
      const c = k + q;
      if (c < slov) {
        v |= b ? s[o + c] >>> b : s[o + c];
        if (b && c + 1 < slov) v |= s[o + c + 1] << (32 - b);
      }
      cur[o + k] |= v;
    }
    cur[o + slov - 1] &= koniec;
  }
}

/** cv2.dilate so symetrickým jadrom (mimo obrázka sú nuly). */
function rozsir(src: Bity, jadro: readonly number[]): Bity {
  const { sirka, vyska, slov } = src;
  const stred = (jadro.length - 1) >> 1;
  const koniec = koniecRiadku(sirka);
  const riadok = src.data.slice();
  const out = noveBity(sirka, vyska);
  for (let r = 0; r <= Math.max(...jadro); r++) {
    if (r > 0) pridajPosun(src.data, riadok, slov, vyska, koniec, r);
    for (let i = 0; i < jadro.length; i++) {
      if (jadro[i] !== r) continue;
      const dy = i - stred;
      for (let y = Math.max(0, -dy); y < Math.min(vyska, vyska - dy); y++) {
        for (let k = 0; k < slov; k++) out.data[y * slov + k] |= riadok[(y + dy) * slov + k];
      }
    }
  }
  return out;
}

/** cv2.dilate masky. */
export const rozsirMasku = (m: Uint8Array, w: number, h: number, jadro: readonly number[]) =>
  naMasku(rozsir(naBity(m, w, h), jadro));

/** cv2.erode masky (mimo obrázka sú jednotky). */
export const zuzMasku = (m: Uint8Array, w: number, h: number, jadro: readonly number[]) =>
  naMasku(doplnok(rozsir(doplnok(naBity(m, w, h)), jadro)));

export const pocet = (m: Uint8Array) => m.reduce((s, v) => s + (v ? 1 : 0), 0);

/** Hodnoty roviny tam, kde je maska. */
export function hodnotyPod(rovina: ArrayLike<number>, maska: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < maska.length; i++) if (maska[i]) out.push(rovina[i]);
  return out;
}
