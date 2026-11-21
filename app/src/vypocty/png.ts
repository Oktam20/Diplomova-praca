import { unzlibSync, zlibSync } from 'fflate';

import type { Obrazok } from './obrazok';

const ZNAKY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const HODNOTA_ZNAKU = new Uint8Array(256);
for (let i = 0; i < ZNAKY.length; i++) HODNOTA_ZNAKU[ZNAKY.charCodeAt(i)] = i;

export function zBase64(text: string): Uint8Array {
  const cisty = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((cisty.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < cisty.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => HODNOTA_ZNAKU[cisty.charCodeAt(i + k)]);
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < cisty.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < cisty.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export function naBase64(bajty: Uint8Array): string {
  const kusy: string[] = [];
  let kus = '';
  for (let i = 0; i < bajty.length; i += 3) {
    const [a, b, c] = [bajty[i], bajty[i + 1] ?? 0, bajty[i + 2] ?? 0];
    kus +=
      ZNAKY[a >> 2] +
      ZNAKY[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bajty.length ? ZNAKY[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bajty.length ? ZNAKY[c & 63] : '=');
    if (kus.length >= 8192) {
      kusy.push(kus);
      kus = '';
    }
  }
  kusy.push(kus);
  return kusy.join('');
}

const CRC = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bajty: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < bajty.length; i++) c = CRC[(c ^ bajty[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const cislo32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const bajty32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

/** Časti (chunky) PNG súboru po prvé IEND. */
function casti(bajty: Uint8Array): { typ: string; data: Uint8Array }[] {
  const out = [];
  for (let pos = 8; pos + 8 <= bajty.length; ) {
    const dlzka = cislo32(bajty, pos);
    const typ = String.fromCharCode(...bajty.subarray(pos + 4, pos + 8));
    out.push({ typ, data: bajty.subarray(pos + 8, pos + 8 + dlzka) });
    if (typ === 'IEND') break;
    pos += 12 + dlzka;
  }
  return out;
}

/** Načítaný PNG ako BGR v sRGB a jeho farebný profil („sRGB“, „Display P3“, iný názov alebo null). */
export type NacitanyPng = Obrazok & { profil: string | null };

export function nacitajPng(bajty: Uint8Array): NacitanyPng {
  const obr = pixely(bajty);
  const profil = farebnyProfil(bajty);
  if (profil === 'Display P3') zDisplayP3(obr.data);
  return { ...obr, profil };
}

/** Farebný profil z častí sRGB, cICP alebo iCCP. */
function farebnyProfil(bajty: Uint8Array): string | null {
  for (const { typ, data } of casti(bajty)) {
    if (typ === 'IDAT' || typ === 'IEND') break;
    if (typ === 'sRGB') return 'sRGB';
    if (typ === 'cICP') return data[0] === 12 ? 'Display P3' : data[0] === 1 ? 'sRGB' : `cICP ${data[0]}`;
    if (typ === 'iCCP') {
      const koniecNazvu = data.indexOf(0) < 0 ? data.length : data.indexOf(0);
      const nazov = String.fromCharCode(...data.subarray(0, koniecNazvu));
      let text = nazov + ' ';
      try {
        for (const c of unzlibSync(data.subarray(koniecNazvu + 2))) if (c >= 32 && c < 127) text += String.fromCharCode(c);
      } catch {}
      if (/P3/.test(text)) return 'Display P3';
      if (/sRGB/i.test(text)) return 'sRGB';
      return nazov || 'ICC profil';
    }
  }
  return null;
}

/** Display P3 -> sRGB na mieste (v lineárnom RGB, farby mimo sRGB sa orežú). */
function zDisplayP3(bgr: Uint8Array): void {
  const linearne = Float64Array.from({ length: 256 }, (_, v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const KROKOV = 4096;
  const naSrgb = Uint8Array.from({ length: KROKOV + 1 }, (_, i) => {
    const x = i / KROKOV;
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  const zakoduj = (x: number) => naSrgb[Math.round(Math.min(1, Math.max(0, x)) * KROKOV)];
  for (let p = 0; p < bgr.length; p += 3) {
    const b = linearne[bgr[p]];
    const g = linearne[bgr[p + 1]];
    const r = linearne[bgr[p + 2]];
    bgr[p + 2] = zakoduj(1.2249401 * r - 0.2249404 * g);
    bgr[p + 1] = zakoduj(-0.0420569 * r + 1.0420571 * g);
    bgr[p] = zakoduj(-0.0196376 * r - 0.0786361 * g + 1.0982735 * b);
  }
}

/** Odstráni PNG filter z jedného riadku (a = vľavo, b = hore, c = vľavo hore). */
function odfiltrujRiadok(filter: number, riadok: Uint8Array, hore: Uint8Array | null, bpp: number): void {
  for (let i = 0; i < riadok.length; i++) {
    const a = i >= bpp ? riadok[i - bpp] : 0;
    const b = hore ? hore[i] : 0;
    const c = hore && i >= bpp ? hore[i - bpp] : 0;
    if (filter === 1) riadok[i] += a;
    else if (filter === 2) riadok[i] += b;
    else if (filter === 3) riadok[i] += (a + b) >> 1;
    else if (filter === 4) {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      riadok[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    } else if (filter !== 0) throw new Error(`Neplatný PNG filter ${filter}.`);
  }
}

function pixely(bajty: Uint8Array): Obrazok {
  const podpis = [137, 80, 78, 71, 13, 10, 26, 10];
  if (podpis.some((v, i) => bajty[i] !== v)) throw new Error('Nie je to PNG súbor.');
  const vsetky = casti(bajty);
  const hlavicka = vsetky.find((c) => c.typ === 'IHDR')!.data;
  const [sirka, vyska] = [cislo32(hlavicka, 0), cislo32(hlavicka, 4)];
  const [hlbka, typ] = [hlavicka[8], hlavicka[9]];
  if (hlavicka[12] !== 0) throw new Error('Prekladané (interlaced) PNG nie je podporované.');
  const paleta = vsetky.find((c) => c.typ === 'PLTE')?.data;
  const idat = vsetky.filter((c) => c.typ === 'IDAT').map((c) => c.data);
  const surove = unzlibSync(spoj(idat));

  const kanalov = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[typ];
  if (!kanalov) throw new Error(`Nepodporovaný typ PNG (${typ}).`);
  const bpp = Math.max(1, (kanalov * hlbka) >> 3);
  const dlzkaRiadku = Math.ceil((sirka * kanalov * hlbka) / 8);
  const px = new Uint8Array(dlzkaRiadku * vyska);
  for (let y = 0; y < vyska; y++) {
    const riadok = px.subarray(y * dlzkaRiadku, (y + 1) * dlzkaRiadku);
    riadok.set(surove.subarray(y * (dlzkaRiadku + 1) + 1, (y + 1) * (dlzkaRiadku + 1)));
    const hore = y > 0 ? px.subarray((y - 1) * dlzkaRiadku, y * dlzkaRiadku) : null;
    odfiltrujRiadok(surove[y * (dlzkaRiadku + 1)], riadok, hore, bpp);
  }

  const vzorka = (y: number, index: number) => {
    const zaciatok = y * dlzkaRiadku;
    if (hlbka === 8) return px[zaciatok + index];
    if (hlbka === 16) return px[zaciatok + index * 2];
    const bit = index * hlbka;
    const v = (px[zaciatok + (bit >> 3)] >> (8 - hlbka - (bit & 7))) & ((1 << hlbka) - 1);
    return typ === 3 ? v : Math.round((v * 255) / ((1 << hlbka) - 1));
  };
  const out = new Uint8Array(sirka * vyska * 3);
  if (hlbka === 8 && (typ === 2 || typ === 6)) {
    for (let i = 0, p = 0; i < out.length; i += 3, p += kanalov) {
      out[i] = px[p + 2];
      out[i + 1] = px[p + 1];
      out[i + 2] = px[p];
    }
    return { sirka, vyska, data: out };
  }
  for (let y = 0; y < vyska; y++) {
    for (let x = 0; x < sirka; x++) {
      let rgb: number[];
      if (typ === 2 || typ === 6) rgb = [0, 1, 2].map((k) => vzorka(y, x * kanalov + k));
      else if (typ === 3) rgb = Array.from(paleta!.subarray(vzorka(y, x) * 3, vzorka(y, x) * 3 + 3));
      else rgb = Array(3).fill(vzorka(y, x * kanalov));
      out.set([rgb[2], rgb[1], rgb[0]], (y * sirka + x) * 3);
    }
  }
  return { sirka, vyska, data: out };
}

function cast(typ: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(bajty32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = typ.charCodeAt(i);
  out.set(data, 8);
  out.set(bajty32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
}

function zakodujPng(sirka: number, vyska: number, typ: 0 | 2, kanalov: number, uroven: 0 | 1, riadok: (y: number) => Uint8Array) {
  const dlzkaRiadku = sirka * kanalov;
  const surove = new Uint8Array((dlzkaRiadku + 1) * vyska);
  for (let y = 0; y < vyska; y++) surove.set(riadok(y), y * (dlzkaRiadku + 1) + 1);
  const hlavicka = new Uint8Array(13);
  hlavicka.set([...bajty32(sirka), ...bajty32(vyska), 8, typ]);
  return spoj([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    cast('IHDR', hlavicka),
    cast('IDAT', zlibSync(surove, { level: uroven })),
    cast('IEND', new Uint8Array(0)),
  ]);
}

function spoj(kusy: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(kusy.reduce((s, k) => s + k.length, 0));
  let o = 0;
  for (const k of kusy) {
    out.set(k, o);
    o += k.length;
  }
  return out;
}

/** Maska ako sivý PNG (komprimuje sa dobre aj pri najrýchlejšej úrovni). */
export function pngSivy(obr: Obrazok): Uint8Array {
  return zakodujPng(obr.sirka, obr.vyska, 0, 1, 1, (y) => obr.data.subarray(y * obr.sirka, (y + 1) * obr.sirka));
}

/** Fotka BGR ako PNG; predvolene bez kompresie, lebo je len na zobrazenie a kompresia v JS je pomalá. */
export function pngFarebny(obr: Obrazok, uroven: 0 | 1 = 0): Uint8Array {
  return zakodujPng(obr.sirka, obr.vyska, 2, 3, uroven, (y) => {
    const riadok = new Uint8Array(obr.sirka * 3);
    for (let x = 0; x < obr.sirka * 3; x += 3) {
      const p = y * obr.sirka * 3 + x;
      riadok[x] = obr.data[p + 2];
      riadok[x + 1] = obr.data[p + 1];
      riadok[x + 2] = obr.data[p];
    }
    return riadok;
  });
}
