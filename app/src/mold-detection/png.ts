import { unzlibSync, zlibSync } from 'fflate';

import type { BgrImage, GrayImage } from './image';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, o);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    chunk +=
      B64[a >> 2] +
      B64[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? B64[c & 63] : '=');
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return parts.join('');
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = -1;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const readU32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/** Dekódovaný obrázok + farebný profil PNG („sRGB“, „Display P3“, iný názov alebo null). */
export type DecodedPng = BgrImage & { profil: string | null };

/** Dekóduje PNG na BGR obrázok v sRGB. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  const image = decodePixels(bytes);
  const profil = readColorProfile(bytes);
  if (profil === 'Display P3') displayP3ToSrgb(image.data);
  return { ...image, profil };
}

/** Farebný profil z chunkov sRGB / cICP / iCCP (názov alebo popis profilu). */
export function readColorProfile(bytes: Uint8Array): string | null {
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = readU32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'sRGB') return 'sRGB';
    if (type === 'cICP') return data[0] === 12 ? 'Display P3' : data[0] === 1 ? 'sRGB' : `cICP ${data[0]}`;
    if (type === 'iCCP') {
      let n = 0;
      while (n < data.length && data[n] !== 0) n++;
      const name = String.fromCharCode(...data.subarray(0, n));
      let text = name;
      try {
        const profile = unzlibSync(data.subarray(n + 2));
        let ascii = '';
        for (let i = 0; i < profile.length; i++) {
          const c = profile[i];
          if (c >= 32 && c < 127) ascii += String.fromCharCode(c);
        }
        text += ' ' + ascii;
      } catch {
      }
      if (/P3/.test(text)) return 'Display P3';
      if (/sRGB/i.test(text)) return 'sRGB';
      return name || 'ICC profil';
    }
    pos += 12 + len;
  }
  return null;
}

/** Display P3 -> sRGB na mieste (lineárne RGB, matica D65 -> D65, mimo gamutu sa oreže). */
function displayP3ToSrgb(bgr: Uint8Array): void {
  const toLin = Float64Array.from({ length: 256 }, (_, v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const LUT = 4096;
  const toSrgb = Uint8Array.from({ length: LUT + 1 }, (_, i) => {
    const x = i / LUT;
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  const enc = (x: number) => toSrgb[Math.round(Math.min(1, Math.max(0, x)) * LUT)];
  for (let p = 0; p < bgr.length; p += 3) {
    const b = toLin[bgr[p]];
    const g = toLin[bgr[p + 1]];
    const r = toLin[bgr[p + 2]];
    bgr[p + 2] = enc(1.2249401 * r - 0.2249404 * g);
    bgr[p + 1] = enc(-0.0420569 * r + 1.0420571 * g);
    bgr[p] = enc(-0.0196376 * r - 0.0786361 * g + 1.0982735 * b);
  }
}

function decodePixels(bytes: Uint8Array): BgrImage {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('Nie je to PNG súbor.');

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const len = readU32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (interlace !== 0) throw new Error('Prekladané (interlaced) PNG nie je podporované.');

  let total = 0;
  for (const d of idat) total += d.length;
  const compressed = new Uint8Array(total);
  let off = 0;
  for (const d of idat) {
    compressed.set(d, off);
    off += d.length;
  }
  const raw = unzlibSync(compressed);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType as 0 | 2 | 3 | 4 | 6];
  if (!channels) throw new Error(`Nepodporovaný typ PNG (${colorType}).`);
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);

  const pixels = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const s = y * (rowBytes + 1) + 1;
    const o = y * rowBytes;
    const up = o - rowBytes;
    const hasUp = y > 0;
    if (filter === 0) {
      pixels.set(raw.subarray(s, s + rowBytes), o);
    } else if (filter === 1) {
      for (let i = 0; i < rowBytes; i++) pixels[o + i] = raw[s + i] + (i >= bpp ? pixels[o + i - bpp] : 0);
    } else if (filter === 2) {
      if (hasUp) for (let i = 0; i < rowBytes; i++) pixels[o + i] = raw[s + i] + pixels[up + i];
      else pixels.set(raw.subarray(s, s + rowBytes), o);
    } else if (filter === 3) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? pixels[o + i - bpp] : 0;
        const b = hasUp ? pixels[up + i] : 0;
        pixels[o + i] = raw[s + i] + ((a + b) >> 1);
      }
    } else if (filter === 4) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? pixels[o + i - bpp] : 0;
        const b = hasUp ? pixels[up + i] : 0;
        const c = hasUp && i >= bpp ? pixels[up + i - bpp] : 0;
        const p = a + b - c;
        const pa = p > a ? p - a : a - p;
        const pb = p > b ? p - b : b - p;
        const pc = p > c ? p - c : c - p;
        pixels[o + i] = raw[s + i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
    } else {
      throw new Error(`Neplatný PNG filter ${filter}.`);
    }
  }

  const out = new Uint8Array(width * height * 3);
  if (bitDepth === 8 && (colorType === 2 || colorType === 6)) {
    const n = width * height;
    for (let i = 0, p = 0, q = 0; i < n; i++, p += channels, q += 3) {
      out[q] = pixels[p + 2];
      out[q + 1] = pixels[p + 1];
      out[q + 2] = pixels[p];
    }
    return { width, height, data: out };
  }
  const sample = (row: number, index: number): number => {
    const base = row * rowBytes;
    if (bitDepth === 8) return pixels[base + index];
    if (bitDepth === 16) return pixels[base + index * 2];
    const bitPos = index * bitDepth;
    const byte = pixels[base + (bitPos >> 3)];
    const v = (byte >> (8 - bitDepth - (bitPos & 7))) & ((1 << bitDepth) - 1);
    return colorType === 3 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1));
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      let r: number;
      let g: number;
      let b: number;
      if (colorType === 2 || colorType === 6) {
        r = sample(y, x * channels);
        g = sample(y, x * channels + 1);
        b = sample(y, x * channels + 2);
      } else if (colorType === 3) {
        const i = sample(y, x) * 3;
        r = palette![i];
        g = palette![i + 1];
        b = palette![i + 2];
      } else {
        r = g = b = sample(y, x * channels);
      }
      out[o] = b;
      out[o + 1] = g;
      out[o + 2] = r;
    }
  }
  return { width, height, data: out };
}

function writeChunk(parts: Uint8Array[], type: string, data: Uint8Array) {
  const chunk = new Uint8Array(12 + data.length);
  const len = data.length;
  chunk[0] = len >>> 24;
  chunk[1] = (len >>> 16) & 255;
  chunk[2] = (len >>> 8) & 255;
  chunk[3] = len & 255;
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  const crc = crc32(chunk, 4, 8 + len);
  chunk[8 + len] = crc >>> 24;
  chunk[9 + len] = (crc >>> 16) & 255;
  chunk[10 + len] = (crc >>> 8) & 255;
  chunk[11 + len] = crc & 255;
  parts.push(chunk);
}

function encodePng(
  width: number,
  height: number,
  colorType: 0 | 2,
  channels: number,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
  rows: (y: number, out: Uint8Array) => void
) {
  const rowBytes = width * channels;
  const raw = new Uint8Array((rowBytes + 1) * height);
  const row = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    rows(y, row);
    raw[y * (rowBytes + 1)] = 0;
    raw.set(row, y * (rowBytes + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set([width >>> 24, (width >>> 16) & 255, (width >>> 8) & 255, width & 255], 0);
  ihdr.set([height >>> 24, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  writeChunk(parts, 'IHDR', ihdr);
  writeChunk(parts, 'IDAT', zlibSync(raw, { level }));
  writeChunk(parts, 'IEND', new Uint8Array(0));
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Maska sa komprimuje výborne aj pri najrýchlejšej úrovni. */
export function encodeGrayPng(img: GrayImage): Uint8Array {
  return encodePng(img.width, img.height, 0, 1, 1, (y, out) =>
    out.set(img.data.subarray(y * img.width, (y + 1) * img.width))
  );
}

/** Fotka sa predvolene ukladá bez kompresie – je len na zobrazenie a kompresia v JS je pomalá. */
export function encodeBgrPng(img: BgrImage, level: 0 | 1 = 0): Uint8Array {
  return encodePng(img.width, img.height, 2, 3, level, (y, out) => {
    const base = y * img.width * 3;
    for (let x = 0; x < img.width * 3; x += 3) {
      out[x] = img.data[base + x + 2];
      out[x + 1] = img.data[base + x + 1];
      out[x + 2] = img.data[base + x];
    }
  });
}
