import { zaokruhli } from './obrazok';

/** Binárny obrázok – 32 pixelov v jednom čísle (riadok má `slov` čísel). */
export type Bity = { sirka: number; vyska: number; slov: number; data: Uint32Array };

function noveBity(sirka: number, vyska: number): Bity {
  const slov = (sirka + 31) >>> 5;
  return { sirka, vyska, slov, data: new Uint32Array(slov * vyska) };
}

/** Bity posledného slova v riadku, ktoré ešte patria do obrázka. */
function koniecRiadku(sirka: number): number {
  const r = sirka & 31;
  return r === 0 ? 0xffffffff : ((1 << r) - 1) >>> 0;
}

/** Pixel je 1, ak tabulka[hodnota pixela] je 1. */
export function bityPodlaTabulky(src: Uint8Array, sirka: number, vyska: number, tabulka: Uint8Array) {
  const bity = noveBity(sirka, vyska);
  let pocet = 0;
  for (let y = 0; y < vyska; y++) {
    for (let k = 0; k < bity.slov; k++) {
      const x0 = k << 5;
      const x1 = Math.min(x0 + 32, sirka);
      let slovo = 0;
      for (let x = x0; x < x1; x++) {
        if (tabulka[src[y * sirka + x]]) {
          slovo |= 1 << (x - x0);
          pocet++;
        }
      }
      bity.data[y * bity.slov + k] = slovo;
    }
  }
  return { bity, pocet };
}

const NENULOVE = Uint8Array.from({ length: 256 }, (_, v) => (v ? 1 : 0));

export function naBity(maska: Uint8Array, w: number, h: number): Bity {
  return bityPodlaTabulky(maska, w, h, NENULOVE).bity;
}

export function naMasku(bity: Bity): Uint8Array {
  const { sirka, vyska, slov, data } = bity;
  const out = new Uint8Array(sirka * vyska);
  for (let y = 0; y < vyska; y++) {
    for (let k = 0; k < slov; k++) {
      let slovo = data[y * slov + k] | 0;
      const zaciatok = y * sirka + (k << 5);
      while (slovo !== 0) {
        out[zaciatok + 31 - Math.clz32(slovo & -slovo)] = 1;
        slovo &= slovo - 1;
      }
    }
  }
  return out;
}

export function doplnok(src: Bity): Bity {
  const out = noveBity(src.sirka, src.vyska);
  const koniec = koniecRiadku(src.sirka);
  for (let y = 0; y < src.vyska; y++) {
    const o = y * src.slov;
    for (let k = 0; k < src.slov; k++) out.data[o + k] = ~src.data[o + k];
    out.data[o + src.slov - 1] &= koniec;
  }
  return out;
}

function jeBit(bity: Bity, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bity.sirka || y >= bity.vyska) return false;
  return ((bity.data[y * bity.slov + (x >> 5)] >>> (x & 31)) & 1) === 1;
}

/** Nastaví pixely od..po (vrátane) v riadku y. */
function nastavUsek(bity: Bity, y: number, od: number, po: number): void {
  const o = y * bity.slov;
  const k0 = od >> 5;
  const k1 = po >> 5;
  const zac = -1 << (od & 31);
  const kon = (po & 31) === 31 ? -1 : (1 << ((po & 31) + 1)) - 1;
  if (k0 === k1) {
    bity.data[o + k0] |= zac & kon;
    return;
  }
  bity.data[o + k0] |= zac;
  for (let k = k0 + 1; k < k1; k++) bity.data[o + k] = 0xffffffff;
  bity.data[o + k1] |= kon;
}

/** Polovičné šírky riadkov elipsy ako cv2.getStructuringElement(MORPH_ELLIPSE, (k, k)). */
export function elipsa(k: number): number[] {
  const r = k >> 1;
  const inv = r ? 1 / (r * r) : 0;
  const polsirky: number[] = [];
  for (let i = 0; i < k; i++) {
    const dy = i - r;
    polsirky.push(Math.min(zaokruhli(r * Math.sqrt((r * r - dy * dy) * inv)), r));
  }
  return polsirky;
}

/** Kruhové jadro s polomerom r (ako kruh() v analýzach). */
export function kruh(r: number): number[] {
  return elipsa(2 * Math.max(1, zaokruhli(r)) + 1);
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
export function rozsir(src: Bity, jadro: readonly number[]): Bity {
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

/** cv2.erode (mimo obrázka sú jednotky). */
export function zuz(src: Bity, jadro: readonly number[]): Bity {
  return doplnok(rozsir(doplnok(src), jadro));
}

/** Úseky jednotiek v riadkoch: úseky riadku y sú zaciatok[y]..zaciatok[y + 1]. */
export type Useky = { pocet: number; zaciatok: Int32Array; od: Int32Array; po: Int32Array };

const nulyZprava = (v: number) => 31 - Math.clz32(v & -v);

function useky(bity: Bity): Useky {
  const { sirka, vyska, slov, data } = bity;
  const od: number[] = [];
  const po: number[] = [];
  const zaciatok = new Int32Array(vyska + 1);
  for (let y = 0; y < vyska; y++) {
    zaciatok[y] = od.length;
    let otvoreny = -1;
    for (let k = 0; k < slov; k++) {
      let slovo = data[y * slov + k];
      const x0 = k << 5;
      if (otvoreny >= 0) {
        if (slovo === 0xffffffff) continue;
        const z = nulyZprava(~slovo);
        od.push(otvoreny);
        po.push(x0 + z - 1);
        otvoreny = -1;
        slovo = (slovo & (-1 << z)) >>> 0;
      }
      while (slovo !== 0) {
        const t = nulyZprava(slovo);
        const inv = ~(slovo >>> t);
        const koniec = t + (inv === 0 ? 32 : nulyZprava(inv));
        if (koniec >= 32) {
          otvoreny = x0 + t;
          break;
        }
        od.push(x0 + t);
        po.push(x0 + koniec - 1);
        slovo = (slovo & (-1 << koniec)) >>> 0;
      }
    }
    if (otvoreny >= 0) {
      od.push(otvoreny);
      po.push(sirka - 1);
    }
  }
  zaciatok[vyska] = od.length;
  return { pocet: od.length, zaciatok, od: Int32Array.from(od), po: Int32Array.from(po) };
}

/** Úseky pozadia – medzery medzi úsekmi popredia. */
function usekyPozadia(popredie: Useky, sirka: number, vyska: number): Useky {
  const od: number[] = [];
  const po: number[] = [];
  const zaciatok = new Int32Array(vyska + 1);
  for (let y = 0; y < vyska; y++) {
    zaciatok[y] = od.length;
    let x = 0;
    for (let i = popredie.zaciatok[y]; i < popredie.zaciatok[y + 1]; i++) {
      if (popredie.od[i] > x) {
        od.push(x);
        po.push(popredie.od[i] - 1);
      }
      x = popredie.po[i] + 1;
    }
    if (x <= sirka - 1) {
      od.push(x);
      po.push(sirka - 1);
    }
  }
  zaciatok[vyska] = od.length;
  return { pocet: od.length, zaciatok, od: Int32Array.from(od), po: Int32Array.from(po) };
}

function koren(rodic: Int32Array, i: number): number {
  while (rodic[i] !== i) {
    rodic[i] = rodic[rodic[i]];
    i = rodic[i];
  }
  return i;
}

/** Spojí úseky susedných riadkov (medzera 1 = 8-susednosť, 0 = 4-susednosť). */
function spojUseky(u: Useky, vyska: number, medzera: number): Int32Array {
  const rodic = Int32Array.from({ length: u.pocet }, (_, i) => i);
  for (let y = 1; y < vyska; y++) {
    let i = u.zaciatok[y - 1];
    let j = u.zaciatok[y];
    while (i < u.zaciatok[y] && j < u.zaciatok[y + 1]) {
      if (u.po[i] + medzera < u.od[j]) {
        i++;
        continue;
      }
      if (u.po[j] + medzera < u.od[i]) {
        j++;
        continue;
      }
      const a = koren(rodic, i);
      const b = koren(rodic, j);
      if (a < b) rodic[b] = a;
      else if (b < a) rodic[a] = b;
      if (u.po[i] < u.po[j]) i++;
      else j++;
    }
  }
  return rodic;
}

/** Pozadie a pre každý jeho úsek, či je spojený s okrajom obrázka. */
function vonkajsiePozadie(popredie: Useky, sirka: number, vyska: number) {
  const pozadie = usekyPozadia(popredie, sirka, vyska);
  const rodic = spojUseky(pozadie, vyska, 0);
  const priOkraji = new Uint8Array(pozadie.pocet);
  for (let y = 0; y < vyska; y++) {
    for (let i = pozadie.zaciatok[y]; i < pozadie.zaciatok[y + 1]; i++) {
      if (y === 0 || y === vyska - 1 || pozadie.od[i] === 0 || pozadie.po[i] === sirka - 1) {
        priOkraji[koren(rodic, i)] = 1;
      }
    }
  }
  const vonku = Uint8Array.from({ length: pozadie.pocet }, (_, i) => priOkraji[koren(rodic, i)]);
  return { pozadie, vonku };
}

/** Vyplní diery (ako findContours RETR_EXTERNAL + drawContours FILLED). */
export function vyplnDiery(bity: Bity): Bity {
  const { pozadie, vonku } = vonkajsiePozadie(useky(bity), bity.sirka, bity.vyska);
  const out: Bity = { ...bity, data: bity.data.slice() };
  for (let y = 0; y < bity.vyska; y++) {
    for (let i = pozadie.zaciatok[y]; i < pozadie.zaciatok[y + 1]; i++) {
      if (!vonku[i]) nastavUsek(out, y, pozadie.od[i], pozadie.po[i]);
    }
  }
  return out;
}

/** Spojené oblasti (8-susednosť) s plochou, ohraničením a prvým pixelom (začiatok obrysu). */
export type Oblasti = {
  useky: Useky;
  cisloUseku: Int32Array;
  pocet: number;
  plocha: Int32Array;
  minX: Int32Array;
  minY: Int32Array;
  maxX: Int32Array;
  maxY: Int32Array;
  prvyX: Int32Array;
  prvyY: Int32Array;
};

/** cv2.connectedComponentsWithStats – oblasti očíslované v poradí riadkov. */
export function oznacOblasti(bity: Bity): Oblasti {
  const u = useky(bity);
  const rodic = spojUseky(u, bity.vyska, 1);
  const n = u.pocet + 1;
  const cisloUseku = new Int32Array(u.pocet);
  const cisloKorena = new Int32Array(u.pocet);
  const [plocha, minX, minY, maxX, maxY, prvyX, prvyY] = Array.from({ length: 7 }, () => new Int32Array(n));
  let dalsie = 1;
  for (let y = 0; y < bity.vyska; y++) {
    for (let i = u.zaciatok[y]; i < u.zaciatok[y + 1]; i++) {
      const k = koren(rodic, i);
      let c = cisloKorena[k];
      if (c === 0) {
        c = cisloKorena[k] = dalsie++;
        prvyX[c] = minX[c] = u.od[i];
        prvyY[c] = minY[c] = y;
        maxX[c] = u.po[i];
      }
      cisloUseku[i] = c;
      plocha[c] += u.po[i] - u.od[i] + 1;
      minX[c] = Math.min(minX[c], u.od[i]);
      maxX[c] = Math.max(maxX[c], u.po[i]);
      maxY[c] = y;
    }
  }
  return { useky: u, cisloUseku, pocet: dalsie - 1, plocha, minX, minY, maxX, maxY, prvyX, prvyY };
}

/** Maska (0/255) z vybraných oblastí. */
export function maskaOblasti(o: Oblasti, w: number, h: number, ponechat: Uint8Array): Uint8Array {
  const out = new Uint8Array(w * h);
  const { useky: u, cisloUseku } = o;
  for (let y = 0; y < h; y++) {
    for (let i = u.zaciatok[y]; i < u.zaciatok[y + 1]; i++) {
      if (ponechat[cisloUseku[i]]) out.fill(255, y * w + u.od[i], y * w + u.po[i] + 1);
    }
  }
  return out;
}

/** Ktoré oblasti nie sú vo vnútri inej oblasti (majú vonkajší obrys). */
export function vonkajsieOblasti(bity: Bity) {
  const oblasti = oznacOblasti(bity);
  const { pozadie, vonku } = vonkajsiePozadie(oblasti.useky, bity.sirka, bity.vyska);
  const jeVonkajsia = (x: number, y: number) => {
    let dole = pozadie.zaciatok[y];
    let hore = pozadie.zaciatok[y + 1] - 1;
    while (dole <= hore) {
      const stred = (dole + hore) >> 1;
      if (pozadie.po[stred] < x) dole = stred + 1;
      else if (pozadie.od[stred] > x) hore = stred - 1;
      else return vonku[stred] === 1;
    }
    return false;
  };
  const vonkajsia = new Uint8Array(oblasti.pocet + 1);
  for (let c = 1; c <= oblasti.pocet; c++) {
    const x = oblasti.prvyX[c];
    vonkajsia[c] = x === 0 || jeVonkajsia(x - 1, oblasti.prvyY[c]) ? 1 : 0;
  }
  return { oblasti, vonkajsia };
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const SMER = [3, 2, 1, 4, -1, 0, 5, 6, 7];

/** Vonkajší obrys oblasti od jej prvého pixela ako [x0, y0, x1, y1, ...] (ako cv2.findContours). */
export function obrys(bity: Bity, sx: number, sy: number): number[] {
  let d1 = -1;
  for (let k = 0; k < 8; k++) {
    const d = (12 - k) & 7;
    if (jeBit(bity, sx + DX[d], sy + DY[d])) {
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
  const body: number[] = [];
  for (;;) {
    const d2 = SMER[(y2 - y3 + 1) * 3 + (x2 - x3 + 1)];
    let x4 = x2;
    let y4 = y2;
    for (let k = 1; k <= 8; k++) {
      const d = (d2 + k) & 7;
      if (jeBit(bity, x3 + DX[d], y3 + DY[d])) {
        x4 = x3 + DX[d];
        y4 = y3 + DY[d];
        break;
      }
    }
    body.push(x3, y3);
    if (x4 === sx && y4 === sy && x3 === x1 && y3 === y1) break;
    x2 = x3;
    y2 = y3;
    x3 = x4;
    y3 = y4;
  }
  return body;
}

/** cv2.contourArea. */
export function plochaObrysu(body: ArrayLike<number>): number {
  const n = body.length >> 1;
  if (n < 3) return 0;
  let a = 0;
  let px = body[2 * n - 2];
  let py = body[2 * n - 1];
  for (let i = 0; i < n; i++) {
    a += px * body[2 * i + 1] - py * body[2 * i];
    px = body[2 * i];
    py = body[2 * i + 1];
  }
  return Math.abs(a * 0.5);
}

/** cv2.arcLength(obrys, closed=True). */
export function dlzkaObrysu(body: ArrayLike<number>): number {
  const n = body.length >> 1;
  if (n < 2) return 0;
  let dlzka = 0;
  let px = body[2 * n - 2];
  let py = body[2 * n - 1];
  for (let i = 0; i < n; i++) {
    const x = body[2 * i];
    const y = body[2 * i + 1];
    dlzka += Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
    px = x;
    py = y;
  }
  return dlzka;
}

/** cv2.convexHull. */
export function konvexnyObal(body: ArrayLike<number>): number[] {
  const n = body.length >> 1;
  const poradie = Array.from({ length: n }, (_, i) => i);
  poradie.sort((a, b) => body[2 * a] - body[2 * b] || body[2 * a + 1] - body[2 * b + 1]);
  const vektorovo = (o: number, a: number, b: number) =>
    (body[2 * a] - body[2 * o]) * (body[2 * b + 1] - body[2 * o + 1]) -
    (body[2 * a + 1] - body[2 * o + 1]) * (body[2 * b] - body[2 * o]);
  const polObalu = (indexy: number[]) => {
    const obal: number[] = [];
    for (const i of indexy) {
      while (obal.length >= 2 && vektorovo(obal[obal.length - 2], obal[obal.length - 1], i) <= 0) obal.pop();
      obal.push(i);
    }
    obal.pop();
    return obal;
  };
  const obal = [...polObalu(poradie), ...polObalu([...poradie].reverse())];
  if (obal.length === 0 && n > 0) obal.push(poradie[0]);
  return obal.flatMap((i) => [body[2 * i], body[2 * i + 1]]);
}

export const rozsirMasku = (m: Uint8Array, w: number, h: number, jadro: readonly number[]) =>
  naMasku(rozsir(naBity(m, w, h), jadro));

export const zuzMasku = (m: Uint8Array, w: number, h: number, jadro: readonly number[]) =>
  naMasku(zuz(naBity(m, w, h), jadro));

/** cv2.morphologyEx(MORPH_CLOSE). */
export const uzavriMasku = (m: Uint8Array, w: number, h: number, jadro: readonly number[]) =>
  naMasku(zuz(rozsir(naBity(m, w, h), jadro), jadro));

export const vyplnDieryMasky = (m: Uint8Array, w: number, h: number) => naMasku(vyplnDiery(naBity(m, w, h)));

/** Vyplnené vonkajšie obrysy s plochou aspoň minPlocha. */
export function vyplnVelkeObrysy(m: Uint8Array, w: number, h: number, minPlocha: number): Uint8Array {
  const bity = naBity(m, w, h);
  const { oblasti, vonkajsia } = vonkajsieOblasti(bity);
  const ponechat = new Uint8Array(oblasti.pocet + 1);
  for (let c = 1; c <= oblasti.pocet; c++) {
    if (vonkajsia[c] && plochaObrysu(obrys(bity, oblasti.prvyX[c], oblasti.prvyY[c])) >= minPlocha) ponechat[c] = 1;
  }
  return vyplnDieryMasky(maskaOblasti(oblasti, w, h, ponechat), w, h);
}

/** Oblasti masky aj s číslom oblasti pre každý pixel. */
export type MapaOblasti = Omit<Oblasti, 'useky' | 'cisloUseku' | 'prvyX' | 'prvyY'> & { cisla: Int32Array };

export function mapaOblasti(m: Uint8Array, w: number, h: number): MapaOblasti {
  const o = oznacOblasti(naBity(m, w, h));
  const cisla = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let i = o.useky.zaciatok[y]; i < o.useky.zaciatok[y + 1]; i++) {
      cisla.fill(o.cisloUseku[i], y * w + o.useky.od[i], y * w + o.useky.po[i] + 1);
    }
  }
  return { cisla, pocet: o.pocet, plocha: o.plocha, minX: o.minX, minY: o.minY, maxX: o.maxX, maxY: o.maxY };
}

/** Maska pixelov, ktorých oblasť je vybraná (ponechat[cislo] = 1). */
export function vybraneOblasti(cisla: Int32Array, ponechat: Uint8Array): Uint8Array {
  return Uint8Array.from(cisla, (c) => ponechat[c]);
}

export function oblastCislo(cisla: Int32Array, c: number): Uint8Array {
  return Uint8Array.from(cisla, (v) => (v === c ? 1 : 0));
}

/** Maska oblasti c v obdĺžniku [x0, y0, x1, y1). */
export function oblastVObdlzniku(cisla: Int32Array, w: number, [x0, y0, x1, y1]: number[], c: number): Uint8Array {
  const sirka = x1 - x0;
  const out = new Uint8Array(sirka * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (cisla[y * w + x] === c) out[(y - y0) * sirka + x - x0] = 1;
  }
  return out;
}

export const aj = (a: Uint8Array, b: Uint8Array) => Uint8Array.from(a, (v, i) => (v && b[i] ? 1 : 0));
export const ajNie = (a: Uint8Array, b: Uint8Array) => Uint8Array.from(a, (v, i) => (v && !b[i] ? 1 : 0));
export const nie = (a: Uint8Array) => Uint8Array.from(a, (v) => (v ? 0 : 1));
export const jeNieco = (m: Uint8Array) => m.some((v) => v !== 0);
export const pocet = (m: Uint8Array) => m.reduce((s, v) => s + (v ? 1 : 0), 0);

/** Hodnoty roviny tam, kde je maska. */
export function hodnotyPod(rovina: ArrayLike<number>, maska: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < maska.length; i++) if (maska[i]) out.push(rovina[i]);
  return out;
}

/** Hysterézia: oblasti slabej masky, v ktorých je aspoň jeden pixel silnej masky. */
export function hystereza(slabe: Uint8Array, silne: Uint8Array, w: number, h: number): Uint8Array {
  const m = mapaOblasti(slabe, w, h);
  const ponechat = new Uint8Array(m.pocet + 1);
  for (let i = 0; i < silne.length; i++) if (silne[i]) ponechat[m.cisla[i]] = 1;
  ponechat[0] = 0;
  return vybraneOblasti(m.cisla, ponechat);
}

/** Pás okolo okraja oblasti: rozšírená a nie zúžená (ako okrajovy_pas v analýzach). */
export function okrajovyPas(oblast: Uint8Array, w: number, h: number, sirka = 2): Uint8Array {
  return ajNie(rozsirMasku(oblast, w, h, kruh(sirka)), zuzMasku(oblast, w, h, kruh(sirka)));
}
