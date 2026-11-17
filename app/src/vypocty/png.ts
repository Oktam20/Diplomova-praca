import { zlibSync } from 'fflate';

import type { Obrazok } from './obrazok';

const ZNAKY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

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

const bajty32 = (v: number) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

function cast(typ: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(bajty32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = typ.charCodeAt(i);
  out.set(data, 8);
  out.set(bajty32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length);
  return out;
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

/** Obrázok BGR ako farebný PNG. */
export function pngFarebny(obr: Obrazok): Uint8Array {
  const dlzkaRiadku = obr.sirka * 3;
  const surove = new Uint8Array((dlzkaRiadku + 1) * obr.vyska);
  for (let y = 0; y < obr.vyska; y++) {
    for (let x = 0; x < dlzkaRiadku; x += 3) {
      const p = y * dlzkaRiadku + x;
      const o = y * (dlzkaRiadku + 1) + 1 + x;
      surove[o] = obr.data[p + 2];
      surove[o + 1] = obr.data[p + 1];
      surove[o + 2] = obr.data[p];
    }
  }
  const hlavicka = new Uint8Array(13);
  hlavicka.set([...bajty32(obr.sirka), ...bajty32(obr.vyska), 8, 2]);
  return spoj([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    cast('IHDR', hlavicka),
    cast('IDAT', zlibSync(surove, { level: 1 })),
    cast('IEND', new Uint8Array(0)),
  ]);
}
