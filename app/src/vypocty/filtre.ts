import { odraz, zaokruhli, type Obdlznik, type Obrazok } from './obrazok';
import { rozlozPamat, wasmJadra } from './wasm/jadra';

type Pole = Float32Array | Float64Array;
const novePole = <T extends Pole>(vzor: T, n: number) => new (vzor.constructor as new (n: number) => T)(n);
const orez = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const f32 = Math.fround;

/** cv2.GaussianBlur(kanal, (5, 5), 0) – jadro [1, 4, 6, 4, 1] / 16, presne ako v OpenCV. */
export function gauss5(kanal: Obrazok): Obrazok {
  const { sirka: w, vyska: h, data } = kanal;
  const medzi = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const px = (x: number) => data[o + odraz(x, w)];
    for (let x = 0; x < w; x++) {
      medzi[o + x] = px(x - 2) + px(x + 2) + 4 * (px(x - 1) + px(x + 1)) + 6 * data[o + x];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = (dy: number) => odraz(y + dy, h) * w;
    const [a, b, c, d, e] = [r(-2), r(-1), y * w, r(1), r(2)];
    for (let x = 0; x < w; x++) {
      out[c + x] = (medzi[a + x] + medzi[e + x] + 4 * (medzi[b + x] + medzi[d + x]) + 6 * medzi[c + x] + 128) >> 8;
    }
  }
  return { sirka: w, vyska: h, data: out };
}

/** a · b + c s jedným zaokrúhlením (softdouble mulAdd v OpenCV) – Dekkerov súčin a súčet s chybou. */
function fma(a: number, b: number, c: number): number {
  const rozdel = (v: number) => {
    const t = 134217729 * v;
    const hi = t - (t - v);
    return [hi, v - hi];
  };
  const p = a * b;
  const [ah, al] = rozdel(a);
  const [bh, bl] = rozdel(b);
  const chybaSucinu = ah * bh - p + ah * bl + al * bh + al * bl;
  const s = p + c;
  const z = s - p;
  const chybaSuctu = p - (s - z) + (c - z);
  return s + (chybaSuctu + chybaSucinu);
}

const MALE_JADRA: Record<number, number[]> = {
  1: [1],
  3: [0.25, 0.5, 0.25],
  5: [0.0625, 0.25, 0.375, 0.25, 0.0625],
  7: [0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125],
  9: [4 / 256, 13 / 256, 30 / 256, 51 / 256, 60 / 256, 51 / 256, 30 / 256, 13 / 256, 4 / 256],
};

/** getGaussianKernelBitExact z OpenCV (smooth.dispatch.cpp) – jadro dĺžky n v plnej presnosti. */
function gaussovoJadro(n: number, sigma: number): number[] {
  if (sigma <= 0 && MALE_JADRA[n]) return MALE_JADRA[n];
  const s = sigma > 0 ? sigma : fma(n, 0.15, 0.35);
  const mierka = -0.125 / (s * s);
  const pol = (n - 1) >> 1;
  const hodnoty: number[] = [];
  let sucet = 0;
  for (let i = 0, x = 1 - n; i < pol; i++, x += 2) {
    const t = Math.exp(x * x * mierka);
    hodnoty.push(t);
    sucet += t;
  }
  sucet = sucet * 2 + 1;
  if ((n & 1) === 0) sucet += 1;
  const nasob = 1 / sucet;
  const jadro = new Array<number>(n);
  for (let i = 0; i < pol; i++) jadro[i] = jadro[n - 1 - i] = hodnoty[i] * nasob;
  jadro[pol] = nasob;
  if ((n & 1) === 0) jadro[pol + 1] = nasob;
  return jadro;
}

/** getGaussianKernelFixedPoint_ED: celočíselné jadro so súčtom 256 (8 bitov, rozptýlenie chyby). */
function pevneJadro(n: number, sigma: number): Int32Array {
  const jadro = gaussovoJadro(n, sigma);
  const out = new Int32Array(n);
  const pol = n >> 1;
  let chyba = 0;
  let sucet = 0;
  for (let i = 0; i < pol; i++) {
    const v = jadro[i] * 256 + chyba;
    const v0 = zaokruhli(v);
    chyba = v - v0;
    out[i] = out[n - 1 - i] = v0;
    sucet += v0;
  }
  out[pol] = 256 - 2 * sucet;
  return out;
}

const replikuj = (p: number, dlzka: number) => (p < 0 ? 0 : p >= dlzka ? dlzka - 1 : p);

/** gaussBajty vo WebAssembly (jadra.wat): okraje sa pripravia v tabuľkách, súčty počíta gauss_h a gauss_v. */
function gaussBajtyWasm(
  j: NonNullable<ReturnType<typeof wasmJadra>>,
  src: Uint8Array,
  w: number,
  h: number,
  ch: number,
  k: Int32Array,
  r: number,
  okraj: (p: number, dlzka: number) => number
): Uint8Array {
  const riadok = w * ch;
  const n = 2 * r + 1;
  const [zdroj, medzi, mapa, buf, jadro, riadky, out] = rozlozPamat(j, [
    riadok * h,
    2 * riadok * h + 32,
    4 * (w + 2 * r),
    (w + 2 * r) * ch + 16,
    4 * n,
    4 * h * n,
    riadok * h + 16,
  ]);
  const pamat = j.pamat.buffer;
  new Uint8Array(pamat).set(src, zdroj);
  const mapa32 = new Int32Array(pamat, mapa, w + 2 * r);
  for (let i = 0; i < w + 2 * r; i++) mapa32[i] = okraj(i - r, w) * ch;
  new Int32Array(pamat, jadro, n).set(k);
  const riadky32 = new Int32Array(pamat, riadky, h * n);
  for (let y = 0; y < h; y++) for (let d = -r; d <= r; d++) riadky32[y * n + d + r] = okraj(y + d, h) * riadok * 2;
  j.gauss_h(zdroj, medzi, mapa, buf, jadro, w, h, ch, r);
  j.gauss_v(medzi, out, riadky, jadro, riadok, h, r);
  return new Uint8Array(pamat, out, riadok * h).slice();
}

/**
 * cv2.GaussianBlur 8-bitového obrázka s `ch` prekladanými kanálmi – bit po bite ako OpenCV (jadro v pevnej
 * desatinnej čiarke, 8 + 8 bitov, celočíselné súčty). `velkost` 0 = podľa sigmy (3 sigma na každú stranu);
 * `replikovat` = BORDER_REPLICATE (inak REFLECT_101). Jadro je súmerné, preto sa sčítajú dvojice pixelov.
 */
export function gaussBajty(src: Uint8Array, w: number, h: number, sigma: number, velkost = 0, replikovat = false, ch = 1): Uint8Array {
  const n = velkost > 0 ? velkost : zaokruhli(sigma * 3 * 2 + 1) | 1;
  const k = pevneJadro(n, sigma);
  const r = n >> 1;
  const okraj = replikovat ? replikuj : odraz;
  const j = wasmJadra();
  if (j) return gaussBajtyWasm(j, src, w, h, ch, k, r, okraj);
  const riadok = w * ch;
  const rozsireny = new Int32Array((w + 2 * r) * ch);
  const zdroj = Int32Array.from({ length: w + 2 * r }, (_, i) => okraj(i - r, w) * ch);
  const medzi = new Int32Array(riadok * h);
  for (let y = 0; y < h; y++) {
    const o = y * riadok;
    for (let i = 0; i < w + 2 * r; i++) for (let c = 0; c < ch; c++) rozsireny[i * ch + c] = src[o + zdroj[i] + c];
    for (let p = 0; p < riadok; p++) {
      const stred = p + r * ch;
      let s = k[r] * rozsireny[stred];
      for (let j = 1, d = ch; j <= r; j++, d += ch) s += k[r + j] * (rozsireny[stred - d] + rozsireny[stred + d]);
      medzi[o + p] = s;
    }
  }
  const out = new Uint8Array(riadok * h);
  const hore = new Int32Array(r + 1);
  const dole = new Int32Array(r + 1);
  const k0 = k[r];
  for (let y = 0; y < h; y++) {
    const s0 = y * riadok;
    for (let j = 1; j <= r; j++) {
      hore[j] = okraj(y - j, h) * riadok;
      dole[j] = okraj(y + j, h) * riadok;
    }
    for (let p = 0; p < riadok; p++) {
      let s = k0 * medzi[s0 + p];
      for (let j = 1; j <= r; j++) s += k[r + j] * (medzi[hore[j] + p] + medzi[dole[j] + p]);
      const v = (s + 32768) >>> 16;
      out[s0 + p] = v > 255 ? 255 : v;
    }
  }
  return out;
}

/** cv2.GaussianBlur reálneho (float32) obrázka: jadro z OpenCV, súčty vo float32, okraj REFLECT_101. */
export function gauss(src: Float32Array, w: number, h: number, sigma: number, velkost = 0): Float32Array {
  const n = velkost > 0 ? velkost : zaokruhli(sigma * 4 * 2 + 1) | 1;
  const k = Float32Array.from(gaussovoJadro(n, sigma));
  const r = n >> 1;
  const xs = Int32Array.from({ length: w + 2 * r }, (_, i) => odraz(i - r, w));
  const medzi = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = 0; j < n; j++) s = f32(s + f32(k[j] * src[o + xs[x + j]]));
      medzi[o + x] = s;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = f32(k[r] * medzi[o + x]);
    for (let j = 1; j <= r; j++) {
      const hore = odraz(y - j, h) * w;
      const dole = odraz(y + j, h) * w;
      const kj = k[r + j];
      for (let x = 0; x < w; x++) out[o + x] = f32(out[o + x] + f32(kj * f32(medzi[hore + x] + medzi[dole + x])));
    }
  }
  return out;
}

/** Gaussov filter z troch krabicových filtrov (šírky podľa Wells / Kovesi). */
export function gaussKrabicami<T extends Pole>(src: T, w: number, h: number, sigma: number): T {
  const idealna = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let mensia = Math.floor(idealna);
  if (mensia % 2 === 0) mensia--;
  const m = Math.round((12 * sigma * sigma - 3 * mensia * mensia - 12 * mensia - 9) / (-4 * mensia - 4));
  let out = src;
  for (let i = 0; i < 3; i++) {
    const r = ((i < m ? mensia : mensia + 2) - 1) / 2;
    out = krabica(krabica(out, w, h, r, true), w, h, r, false);
  }
  return out;
}

/** Priemer v okne 2r + 1 po riadkoch alebo stĺpcoch (okraj REFLECT_101). */
function krabica<T extends Pole>(src: T, w: number, h: number, r: number, vodorovne: boolean): T {
  if (r <= 0) return src;
  const out = novePole(src, w * h);
  const dlzka = vodorovne ? w : h;
  const idx = Int32Array.from({ length: dlzka + 2 * r + 1 }, (_, i) => odraz(i - r, dlzka));
  const k = 1 / (2 * r + 1);
  if (vodorovne) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let s = 0;
      for (let i = 0; i < 2 * r + 1; i++) s += src[o + idx[i]];
      for (let x = 0; x < w; x++) {
        out[o + x] = s * k;
        s += src[o + idx[x + 2 * r + 1]] - src[o + idx[x]];
      }
    }
    return out;
  }
  const sucty = new Float64Array(w);
  for (let i = 0; i < 2 * r + 1; i++) for (let x = 0; x < w; x++) sucty[x] += src[idx[i] * w + x];
  for (let y = 0; y < h; y++) {
    const pridat = idx[y + 2 * r + 1] * w;
    const odobrat = idx[y] * w;
    for (let x = 0; x < w; x++) {
      out[y * w + x] = sucty[x] * k;
      sucty[x] += src[pridat + x] - src[odobrat + x];
    }
  }
  return out;
}

/** cv2.blur(maska.astype(float32), (k, k)) pre masku 0/1 – počet jednotiek v okne · 1/(k·k) ako float32. */
export function priemerVOkne(maska: Uint8Array, w: number, h: number, k: number): Float32Array {
  const r = k >> 1;
  const xs = Int32Array.from({ length: w + k }, (_, i) => odraz(i - r, w));
  const riadky = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let i = 0; i < k; i++) s += maska[o + xs[i]] ? 1 : 0;
    for (let x = 0; x < w; x++) {
      riadky[o + x] = s;
      s += (maska[o + xs[x + k]] ? 1 : 0) - (maska[o + xs[x]] ? 1 : 0);
    }
  }
  const ys = Int32Array.from({ length: h + k }, (_, i) => odraz(i - r, h));
  const mierka = 1 / (k * k);
  const out = new Float32Array(w * h);
  const sucty = new Int32Array(w);
  for (let i = 0; i < k; i++) for (let x = 0; x < w; x++) sucty[x] += riadky[ys[i] * w + x];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = f32(sucty[x] * mierka);
      sucty[x] += riadky[ys[y + k] * w + x] - riadky[ys[y] * w + x];
    }
  }
  return out;
}

export function naBajty(src: ArrayLike<number>): Uint8Array {
  return Uint8Array.from({ length: src.length }, (_, i) => orez(zaokruhli(src[i])));
}

/** cv2.medianBlur 8-bitového kanála (okraj REPLICATE) – posuvný histogram v každom riadku. */
function medianovyFilterKanala(src: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const r = k >> 1;
  const polovica = (k * k) >> 1;
  const riadok = (y: number) => Math.min(h - 1, Math.max(0, y)) * w;
  const stlpec = (x: number) => Math.min(w - 1, Math.max(0, x));
  const out = new Uint8Array(w * h);
  const hist = new Int32Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) hist[src[riadok(y + dy) + stlpec(dx)]]++;
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        for (let dy = -r; dy <= r; dy++) {
          const o = riadok(y + dy);
          hist[src[o + stlpec(x - r - 1)]]--;
          hist[src[o + stlpec(x + r)]]++;
        }
      }
      let spolu = 0;
      let v = 0;
      while (spolu + hist[v] <= polovica) spolu += hist[v++];
      out[y * w + x] = v;
    }
  }
  return out;
}

/** cv2.medianBlur obrázka BGR. */
export function medianovyFilter(src: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let c = 0; c < 3; c++) {
    const kanal = Uint8Array.from({ length: w * h }, (_, i) => src[3 * i + c]);
    medianovyFilterKanala(kanal, w, h, k).forEach((v, i) => (out[3 * i + c] = v));
  }
  return out;
}

/**
 * Maximum (alebo minimum) z pixela a jeho suseda vľavo a vpravo v riadku – kanály prekladané, mimo obrázka sa
 * ignoruje. Riadky majú v poli dĺžku `krok` (zarovnané na 4 bajty), obrázka sa týka prvých `riadok` bajtov.
 */
function rozsirRiadky(src: Uint8Array, out: Uint8Array, krok: number, riadok: number, h: number, ch: number, maximum: boolean): void {
  for (let y = 0; y < h; y++) {
    const o = y * krok;
    const k = o + riadok;
    if (maximum) {
      for (let i = o; i < k; i++) {
        let m = src[i];
        if (i - ch >= o && src[i - ch] > m) m = src[i - ch];
        if (i + ch < k && src[i + ch] > m) m = src[i + ch];
        out[i] = m;
      }
    } else {
      for (let i = o; i < k; i++) {
        let m = src[i];
        if (i - ch >= o && src[i - ch] < m) m = src[i - ch];
        if (i + ch < k && src[i + ch] < m) m = src[i + ch];
        out[i] = m;
      }
    }
  }
}

/**
 * cv2.dilate (maximum) alebo cv2.erode (minimum) 8-bitového obrázka s `ch` prekladanými kanálmi a elipsovým jadrom
 * (pološírky riadkov jadra) – ako filter_jadrom v python/skvrny/morfologia.py: vodorovné maximum sa rozširuje
 * po jednom pixeli a riadky jadra s danou pološírkou sa pridajú posunuté zvislo.
 */
const H8 = 0x80808080 | 0;
const L7 = 0x7f7f7f7f;

/**
 * out = max(out, zdroj) (alebo min) po bajtoch, štyri bajty naraz v 32-bitových slovách (SWAR):
 * horný bit každého bajtu po odčítaní (x | 0x80) − (y & 0x7f) určí porovnanie dolných 7 bitov.
 */
function maxSlov(out: Uint32Array, zdroj: Uint32Array, od: number, po: number, posun: number, maximum: boolean): void {
  if (maximum) {
    for (let i = od; i < po; i++) {
      const a = out[i];
      const b = zdroj[i + posun];
      const r = a ^ b;
      const m = (((r & a) | (~r & (((a | H8) - (b & L7)) | 0))) & H8) >>> 7;
      const maska = Math.imul(m, 255);
      out[i] = (a & maska) | (b & ~maska);
    }
  } else {
    for (let i = od; i < po; i++) {
      const a = out[i];
      const b = zdroj[i + posun];
      const r = a ^ b;
      const m = (((r & a) | (~r & (((a | H8) - (b & L7)) | 0))) & H8) >>> 7;
      const maska = Math.imul(m, 255);
      out[i] = (b & maska) | (a & ~maska);
    }
  }
}

/** sedaMorfologia vo WebAssembly (jadra.wat): riadky majú pred a za sebou ch neutrálnych bajtov. */
function sedaMorfologiaWasm(j: NonNullable<ReturnType<typeof wasmJadra>>, src: Uint8Array, w: number, h: number, ch: number, jadro: readonly number[], maximum: boolean) {
  const riadok = w * ch;
  const krok = riadok + 2 * ch;
  const n = krok * h;
  let [vodorovne, dalsie, out] = rozlozPamat(j, [n, n, n]);
  const pamat = new Uint8Array(j.pamat.buffer);
  const neutralna = maximum ? 0 : 255;
  pamat.fill(neutralna, vodorovne, vodorovne + n);
  pamat.fill(neutralna, dalsie, dalsie + n);
  pamat.fill(neutralna, out, out + n);
  for (let y = 0; y < h; y++) pamat.set(src.subarray(y * riadok, (y + 1) * riadok), vodorovne + y * krok + ch);
  const stred = (jadro.length - 1) >> 1;
  const najviac = Math.max(...jadro);
  for (let s = 0; s <= najviac; s++) {
    if (s > 0) {
      j.riadky(vodorovne, dalsie, krok, riadok, h, ch, maximum ? 1 : 0);
      [vodorovne, dalsie] = [dalsie, vodorovne];
    }
    for (let i = 0; i < jadro.length; i++) {
      if (jadro[i] !== s) continue;
      const dy = i - stred;
      const od = Math.max(0, -dy);
      const po = Math.min(h, h - dy);
      j.kombinuj(out + od * krok, vodorovne + (od + dy) * krok, (po - od) * krok, maximum ? 1 : 0);
    }
  }
  const vysledok = new Uint8Array(riadok * h);
  for (let y = 0; y < h; y++) vysledok.set(pamat.subarray(out + y * krok + ch, out + y * krok + ch + riadok), y * riadok);
  return vysledok;
}

function sedaMorfologia(src: Uint8Array, w: number, h: number, ch: number, jadro: readonly number[], maximum: boolean): Uint8Array {
  const j = wasmJadra();
  if (j) return sedaMorfologiaWasm(j, src, w, h, ch, jadro, maximum);
  const riadok = w * ch;
  const krok = (riadok + 3) & ~3;
  const slov = krok >> 2;
  const n = krok * h;
  const neutralna = maximum ? 0 : 255;
  let vodorovne = new Uint8Array(n).fill(neutralna);
  for (let y = 0; y < h; y++) vodorovne.set(src.subarray(y * riadok, (y + 1) * riadok), y * krok);
  let dalsie = new Uint8Array(n).fill(neutralna);
  const out = new Uint8Array(n).fill(neutralna);
  const out32 = new Uint32Array(out.buffer);
  const stred = (jadro.length - 1) >> 1;
  const najviac = Math.max(...jadro);
  for (let s = 0; s <= najviac; s++) {
    if (s > 0) {
      rozsirRiadky(vodorovne, dalsie, krok, riadok, h, ch, maximum);
      [vodorovne, dalsie] = [dalsie, vodorovne];
    }
    const vodorovne32 = new Uint32Array(vodorovne.buffer);
    for (let i = 0; i < jadro.length; i++) {
      if (jadro[i] !== s) continue;
      const dy = i - stred;
      maxSlov(out32, vodorovne32, Math.max(0, -dy) * slov, Math.min(h, h - dy) * slov, dy * slov, maximum);
    }
  }
  if (krok === riadok) return out;
  const vysledok = new Uint8Array(riadok * h);
  for (let y = 0; y < h; y++) vysledok.set(out.subarray(y * krok, y * krok + riadok), y * riadok);
  return vysledok;
}

/** cv2.morphologyEx(MORPH_CLOSE) 8-bitového obrázka s `ch` prekladanými kanálmi. */
export function uzavri(src: Uint8Array, w: number, h: number, jadro: readonly number[], ch = 1): Uint8Array {
  return sedaMorfologia(sedaMorfologia(src, w, h, ch, jadro, true), w, h, ch, jadro, false);
}

/**
 * cv2.distanceTransform(maska, DIST_L2, 3 alebo 5) – celočíselné vzdialenosti s 16 bitmi za desatinnou čiarkou
 * a dva prechody ako distanceTransform_3x3 / _5x5 v OpenCV; mimo obrázka je nekonečno.
 */
function vzdialenostMaskou(maska: Uint8Array, w: number, h: number, susedia: [number, number, number][], vacsiaVaha: number): Float32Array {
  const max = 0xffffffff - vacsiaVaha;
  const okraj = 2;
  const sw = w + 2 * okraj;
  const t = new Float64Array(sw * (h + 2 * okraj)).fill(max);
  const idx = (y: number, x: number) => (y + okraj) * sw + x + okraj;
  const hv = susedia[0][2];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(y, x);
      if (!maska[y * w + x]) {
        t[i] = 0;
        continue;
      }
      let t0 = Infinity;
      for (const [dy, dx, vaha] of susedia) t0 = Math.min(t0, t[i - dy * sw - dx] + vaha);
      t[i] = Math.min(t0, max);
    }
  }
  const out = new Float32Array(w * h);
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = idx(y, x);
      let t0 = t[i];
      if (t0 > hv) {
        for (const [dy, dx, vaha] of susedia) t0 = Math.min(t0, t[i + dy * sw + dx] + vaha);
        t[i] = t0;
      }
      out[y * w + x] = f32(t0 / 65536);
    }
  }
  return out;
}

/** CV_FLT_TO_FIX(metrika vo float32, 16). */
const pevne = (v: number) => zaokruhli(f32(f32(v) * 65536));

/** cv2.distanceTransform(maska, DIST_L2, 3). */
export function vzdialenost3(maska: Uint8Array, w: number, h: number): Float32Array {
  const [a, b] = [pevne(0.955), pevne(1.3693)];
  return vzdialenostMaskou(maska, w, h, [[0, 1, a], [1, 1, b], [1, 0, a], [1, -1, b]], b);
}

/** cv2.distanceTransform(maska, DIST_L2, 5). */
export function vzdialenost5(maska: Uint8Array, w: number, h: number): Float32Array {
  const [a, b, c] = [pevne(1), pevne(1.4), pevne(2.1969)];
  return vzdialenostMaskou(
    maska,
    w,
    h,
    [[0, 1, a], [2, 1, c], [2, -1, c], [1, 2, c], [1, 1, b], [1, 0, a], [1, -1, b], [1, -2, c]],
    c
  );
}

/** cv2.distanceTransform(maska, DIST_L2, DIST_MASK_PRECISE) na druhú (Felzenszwalb). */
export function vzdialenostNaDruhu(maska: Uint8Array, w: number, h: number): Float64Array {
  const d = Float64Array.from(maska, (v) => (v ? 1e20 : 0));
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const out = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const prechod = (dlzka: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    const priesecnik = (q: number) => (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    for (let q = 1; q < dlzka; q++) {
      let s = priesecnik(q);
      while (s <= z[k]) {
        k--;
        s = priesecnik(q);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < dlzka; q++) {
      while (z[k + 1] < q) k++;
      out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    prechod(h);
    for (let y = 0; y < h; y++) d[y * w + x] = out[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = d[y * w + x];
    prechod(w);
    for (let x = 0; x < w; x++) d[y * w + x] = out[x];
  }
  return d;
}

/** Veľkosť gradientu jasu hypot(Sobel dx, Sobel dy) / 8 v obdĺžniku roviny pw x ph. */
export function gradient(rovina: ArrayLike<number>, pw: number, ph: number, [x0, y0, x1, y1]: Obdlznik): Float32Array {
  const out = new Float32Array((x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    const hore = odraz(y - 1, ph) * pw;
    const stred = y * pw;
    const dole = odraz(y + 1, ph) * pw;
    for (let x = x0; x < x1; x++) {
      const l = odraz(x - 1, pw);
      const p = odraz(x + 1, pw);
      const gx = rovina[hore + p] + 2 * rovina[stred + p] + rovina[dole + p] - (rovina[hore + l] + 2 * rovina[stred + l] + rovina[dole + l]);
      const gy = rovina[dole + l] + 2 * rovina[dole + x] + rovina[dole + p] - (rovina[hore + l] + 2 * rovina[hore + x] + rovina[hore + p]);
      out[(y - y0) * (x1 - x0) + x - x0] = Math.sqrt(gx * gx + gy * gy) / 8;
    }
  }
  return out;
}

/** Zdrojové pixely a váha pre INTER_LINEAR (súradnica stredu pixela) – pre reálne obrázky. */
export function linearnyBod(d: number, mierka: number, dlzka: number): [number, number, number] {
  const f = (d + 0.5) * mierka - 0.5;
  let s = Math.floor(f);
  let a = f - s;
  if (s < 0) {
    s = 0;
    a = 0;
  }
  if (s >= dlzka - 1) {
    s = dlzka - 1;
    a = 0;
  }
  return [s, Math.min(s + 1, dlzka - 1), a];
}

/* ---------- cv2.resize pre 8-bitové obrázky – prepis modules/imgproc/src/resize.cpp (OpenCV 4.11) ---------- */

const KOEF = 2048;

/** saturate_cast<int>(double) a cvFloor. */
const naCele = (v: number) => zaokruhli(v);

/** Celé zväčšenie / zmenšenie (is_area_fast). */
function jeCele(mierka: number) {
  return Math.abs(mierka - naCele(mierka)) < Number.EPSILON;
}

/** cv2.resize INTER_NEAREST, `ch` kanálov; `invX`, `invY` = fx, fy (predvolene cieľ / zdroj). */
export function zmenNajblizsi(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, invX = dw / sw, invY = dh / sh): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const ifx = 1 / invX;
  const ify = 1 / invY;
  const xs = Int32Array.from({ length: dw }, (_, x) => Math.min(Math.floor(x * ifx), sw - 1));
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(Math.floor(y * ify), sh - 1);
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < ch; c++) out[(y * dw + x) * ch + c] = src[(sy * sw + xs[x]) * ch + c];
    }
  }
  return out;
}

/** Koeficienty lineárnej interpolácie ako v cv::resize (fixpt): zdroj, dve váhy (súčet ~2048) a xmax. */
function linearneKoeficienty(zdroj: number, ciel: number, inv: number, plocha: boolean) {
  const mierka = 1 / inv;
  const ofs = new Int32Array(ciel);
  const a0 = new Int32Array(ciel);
  const a1 = new Int32Array(ciel);
  let xmax = ciel;
  for (let d = 0; d < ciel; d++) {
    let s: number;
    let fx: number;
    if (!plocha) {
      fx = f32((d + 0.5) * mierka - 0.5);
      s = Math.floor(fx);
      fx = f32(fx - s);
    } else {
      s = Math.floor(d * mierka);
      fx = f32(d + 1 - (s + 1) * inv);
      fx = fx <= 0 ? 0 : f32(fx - Math.floor(fx));
    }
    if (s < 0) {
      fx = 0;
      s = 0;
    }
    if (s + 1 >= zdroj) {
      xmax = Math.min(xmax, d);
      if (s >= zdroj - 1) {
        fx = 0;
        s = zdroj - 1;
      }
    }
    ofs[d] = s;
    a0[d] = zaokruhli(f32(f32(1 - fx) * KOEF));
    a1[d] = zaokruhli(f32(fx * KOEF));
  }
  return { ofs, a0, a1, xmax };
}

/** Riadok zdroja po vodorovnej interpolácii (int, 11 bitov za desatinnou čiarkou). */
function vodorovneLinearne(src: Uint8Array, ch: number, sw: number, sy: number, k: ReturnType<typeof linearneKoeficienty>, dw: number): Int32Array {
  const out = new Int32Array(dw * ch);
  const o = sy * sw * ch;
  for (let x = 0; x < dw; x++) {
    const s = o + k.ofs[x] * ch;
    for (let c = 0; c < ch; c++) {
      out[x * ch + c] = x < k.xmax ? src[s + c] * k.a0[x] + src[s + ch + c] * k.a1[x] : src[s + c] * KOEF;
    }
  }
  return out;
}

/** Riadkové čísla a váhy zvislej lineárnej interpolácie. */
function zvisleKoeficienty(zdroj: number, ciel: number, inv: number, plocha: boolean) {
  const mierka = 1 / inv;
  const ofs = new Int32Array(ciel);
  const b0 = new Int32Array(ciel);
  const b1 = new Int32Array(ciel);
  for (let d = 0; d < ciel; d++) {
    let s: number;
    let fy: number;
    if (!plocha) {
      fy = f32((d + 0.5) * mierka - 0.5);
      s = Math.floor(fy);
      fy = f32(fy - s);
    } else {
      s = Math.floor(d * mierka);
      fy = f32(d + 1 - (s + 1) * inv);
      fy = fy <= 0 ? 0 : f32(fy - Math.floor(fy));
    }
    ofs[d] = s;
    b0[d] = zaokruhli(f32(f32(1 - fy) * KOEF));
    b1[d] = zaokruhli(f32(fy * KOEF));
  }
  return { ofs, b0, b1 };
}

const medzi = (v: number, dlzka: number) => (v < 0 ? 0 : v >= dlzka ? dlzka - 1 : v);

/** Lineárna interpolácia 8-bitového obrázka v pevnej desatinnej čiarke (resizeGeneric_ s HResizeLinear / VResizeLinear). */
function linearne8(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, invX: number, invY: number, plocha: boolean): Uint8Array {
  const kx = linearneKoeficienty(sw, dw, invX, plocha);
  const ky = zvisleKoeficienty(sh, dh, invY, plocha);
  const out = new Uint8Array(dw * dh * ch);
  const riadky = new Map<number, Int32Array>();
  const riadok = (sy: number) => {
    let r = riadky.get(sy);
    if (!r) {
      r = vodorovneLinearne(src, ch, sw, sy, kx, dw);
      riadky.set(sy, r);
      if (riadky.size > 4) riadky.delete(riadky.keys().next().value!);
    }
    return r;
  };
  const sirka = dw * ch;
  for (let y = 0; y < dh; y++) {
    const s0 = riadok(medzi(ky.ofs[y], sh));
    const s1 = riadok(medzi(ky.ofs[y] + 1, sh));
    const b0 = ky.b0[y];
    const b1 = ky.b1[y];
    const o = y * sirka;
    for (let x = 0; x < sirka; x++) {
      const v = (((b0 * (s0[x] >> 4)) >> 16) + ((b1 * (s1[x] >> 4)) >> 16) + 2) >> 2;
      out[o + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/** cv2.resize INTER_LINEAR, `ch` kanálov (8 bitov, bit po bite ako OpenCV). */
export function zmenLinearne(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, invX = dw / sw, invY = dh / sh): Uint8Array {
  const mx = 1 / invX;
  const my = 1 / invY;
  if (jeCele(mx) && jeCele(my) && naCele(mx) === 2 && naCele(my) === 2) return zmenPlochou(src, ch, sw, sh, dw, dh, invX, invY);
  return linearne8(src, ch, sw, sh, dw, dh, invX, invY, false);
}

/** cv2.resize INTER_AREA, `ch` kanálov (8 bitov, bit po bite ako OpenCV vrátane celočíselného zmenšenia). */
export function zmenPlochou(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, invX = dw / sw, invY = dh / sh): Uint8Array {
  const mx = 1 / invX;
  const my = 1 / invY;
  if (mx < 1 || my < 1) return linearne8(src, ch, sw, sh, dw, dh, invX, invY, true);
  if (jeCele(mx) && jeCele(my)) return plochouCele(src, ch, sw, sh, dw, dh, naCele(mx), naCele(my));
  return plochouVseobecne(src, ch, sw, sh, dw, dh, mx, my);
}

/** resizeAreaFast_ – zmenšenie celým číslom. */
function plochouCele(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const plocha = sx * sy;
  const mierka = f32(1 / plocha);
  const rychlo = sx === 2 && sy === 2 && (ch === 1 || ch === 3 || ch === 4);
  const plne = Math.trunc(sw / sx) * ch;
  const riadok = sw * ch;
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy;
    const o = y * dw * ch;
    if (y0 >= sh) continue;
    const w = y0 + sy <= sh ? plne : 0;
    let d = 0;
    for (; d < w; d++) {
      const x0 = Math.trunc(d / ch) * sx * ch + (d % ch);
      let s = 0;
      for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) s += src[(y0 + j) * riadok + x0 + i * ch];
      out[o + d] = rychlo ? (s + 2) >> 2 : orez(zaokruhli(f32(s * mierka)));
    }
    for (; d < dw * ch; d++) {
      const x0 = Math.trunc(d / ch) * sx * ch + (d % ch);
      let s = 0;
      let pocet = 0;
      for (let j = 0; j < sy && y0 + j < sh; j++) {
        for (let i = 0; i < sx * ch; i += ch) {
          if (x0 + i >= riadok) break;
          s += src[(y0 + j) * riadok + x0 + i];
          pocet++;
        }
      }
      out[o + d] = pocet ? orez(zaokruhli(f32(f32(s) / pocet))) : 0;
    }
  }
  return out;
}

/** computeResizeAreaTab – zoznam (cieľ, zdroj, váha) pre jeden smer. */
function tabulkaPlochy(zdroj: number, ciel: number, mierka: number): [number, number, number][] {
  const tab: [number, number, number][] = [];
  for (let d = 0; d < ciel; d++) {
    const fs1 = d * mierka;
    const fs2 = fs1 + mierka;
    const bunka = Math.min(mierka, zdroj - fs1);
    let s1 = Math.ceil(fs1);
    let s2 = Math.floor(fs2);
    s2 = Math.min(s2, zdroj - 1);
    s1 = Math.min(s1, s2);
    if (s1 - fs1 > 1e-3) tab.push([d, s1 - 1, f32((s1 - fs1) / bunka)]);
    for (let s = s1; s < s2; s++) tab.push([d, s, f32(1 / bunka)]);
    if (fs2 - s2 > 1e-3) tab.push([d, s2, f32(Math.min(Math.min(fs2 - s2, 1), bunka) / bunka)]);
  }
  return tab;
}

/** resizeArea_ – zmenšenie neceločíselným pomerom (súčty vo float32). */
function plochouVseobecne(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, mx: number, my: number): Uint8Array {
  const xtab = tabulkaPlochy(sw, dw, mx);
  const ytab = tabulkaPlochy(sh, dh, my);
  const sirka = dw * ch;
  const out = new Uint8Array(sirka * dh);
  const buf = new Float32Array(sirka);
  const sum = new Float32Array(sirka);
  const uloz = (dy: number) => {
    for (let x = 0; x < sirka; x++) out[dy * sirka + x] = orez(zaokruhli(sum[x]));
  };
  let predosly = ytab[0][0];
  for (const [dy, sy, beta] of ytab) {
    buf.fill(0);
    const o = sy * sw * ch;
    for (const [dx, sx, alfa] of xtab) {
      for (let c = 0; c < ch; c++) buf[dx * ch + c] = f32(buf[dx * ch + c] + f32(src[o + sx * ch + c] * alfa));
    }
    if (dy !== predosly) {
      uloz(predosly);
      for (let x = 0; x < sirka; x++) sum[x] = f32(beta * buf[x]);
      predosly = dy;
    } else {
      for (let x = 0; x < sirka; x++) sum[x] = f32(sum[x] + f32(beta * buf[x]));
    }
  }
  uloz(predosly);
  return out;
}

/** interpolateCubic (A = −0,75) vo float32. */
function kubickeVahy(x: number): number[] {
  const A = -0.75;
  const x1 = f32(x + 1);
  const w0 = f32(f32(f32(f32(f32(f32(A * x1) - -3.75) * x1) + -6) * x1) - -3);
  const w1 = f32(f32(f32(f32(f32(f32(A + 2) * x) - f32(A + 3)) * x) * x) + 1);
  const y = f32(1 - x);
  const w2 = f32(f32(f32(f32(f32(f32(A + 2) * y) - f32(A + 3)) * y) * y) + 1);
  return [w0, w1, w2, f32(f32(f32(1 - w0) - w1) - w2)];
}

/**
 * cv2.resize INTER_CUBIC, `ch` kanálov (8 bitov). Zvislý krok ako na PC s SIMD (SSE, 8 hodnôt naraz vo float32),
 * zvyšok riadku celočíselne – tak ako OpenCV, s ktorým počítajú analýzy.
 */
export function zmenKubicky(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number, invX = dw / sw, invY = dh / sh): Uint8Array {
  const mx = 1 / invX;
  const my = 1 / invY;
  let xmin = 0;
  let xmax = dw;
  const xofs = new Int32Array(dw);
  const ax = new Int32Array(dw * 4);
  for (let d = 0; d < dw; d++) {
    const fx0 = f32((d + 0.5) * mx - 0.5);
    const s = Math.floor(fx0);
    const fx = f32(fx0 - s);
    if (s < 1) xmin = d + 1;
    if (s + 2 >= sw) xmax = Math.min(xmax, d);
    xofs[d] = s;
    kubickeVahy(fx).forEach((v, k) => (ax[d * 4 + k] = zaokruhli(f32(v * KOEF))));
  }
  const sirka = dw * ch;
  const vodorovne = (sy: number) => {
    const S = sy * sw * ch;
    const D = new Int32Array(sirka);
    for (let d = 0; d < dw; d++) {
      for (let c = 0; c < ch; c++) {
        let v = 0;
        if (d < xmin || d >= xmax) {
          for (let j = 0; j < 4; j++) {
            let sx = (xofs[d] - 1 + j) * ch + c;
            while (sx < 0) sx += ch;
            while (sx >= sw * ch) sx -= ch;
            v += src[S + sx] * ax[d * 4 + j];
          }
        } else {
          for (let j = 0; j < 4; j++) v += src[S + (xofs[d] - 1 + j) * ch + c] * ax[d * 4 + j];
        }
        D[d * ch + c] = v;
      }
    }
    return D;
  };
  const riadky = new Map<number, Int32Array>();
  const riadok = (sy: number) => {
    let r = riadky.get(sy);
    if (!r) {
      r = vodorovne(sy);
      riadky.set(sy, r);
      if (riadky.size > 8) riadky.delete(riadky.keys().next().value!);
    }
    return r;
  };
  const out = new Uint8Array(sirka * dh);
  const mierka = f32(1 / (KOEF * KOEF));
  const simd = sirka - (sirka % 8);
  for (let y = 0; y < dh; y++) {
    const fy0 = f32((y + 0.5) * my - 0.5);
    const sy = Math.floor(fy0);
    const b = kubickeVahy(f32(fy0 - sy)).map((v) => zaokruhli(f32(v * KOEF)));
    const r = [0, 1, 2, 3].map((k) => riadok(medzi(sy - 1 + k, sh)));
    const bf = b.map((v) => f32(v * mierka));
    const o = y * sirka;
    for (let x = 0; x < sirka; x++) {
      let v: number;
      if (x < simd) {
        const t = f32(f32(r[0][x] * bf[0]) + f32(f32(r[1][x] * bf[1]) + f32(f32(r[2][x] * bf[2]) + f32(r[3][x] * bf[3]))));
        v = zaokruhli(t);
      } else {
        v = (r[0][x] * b[0] + r[1][x] * b[1] + r[2][x] * b[2] + r[3][x] * b[3] + (1 << 21)) >> 22;
      }
      out[o + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  return out;
}

/** cv2.resize INTER_LINEAR pre reálny jednokanálový obrázok. */
export function zmenLinearneF(src: Float64Array, sw: number, sh: number, dw: number, dh: number): Float64Array {
  const out = new Float64Array(dw * dh);
  const xs = Array.from({ length: dw }, (_, x) => linearnyBod(x, sw / dw, sw));
  for (let y = 0; y < dh; y++) {
    const [y0, y1, ay] = linearnyBod(y, sh / dh, sh);
    for (let x = 0; x < dw; x++) {
      const [x0, x1, ax] = xs[x];
      const hore = src[y0 * sw + x0] * (1 - ax) + src[y0 * sw + x1] * ax;
      const dole = src[y1 * sw + x0] * (1 - ax) + src[y1 * sw + x1] * ax;
      out[y * dw + x] = hore * (1 - ay) + dole * ay;
    }
  }
  return out;
}

/** Pre každý cieľový pixel zoznam [zdrojový pixel, váha] pre INTER_AREA. */
function vahyPlochy(zdroj: number, ciel: number): [number, number][][] {
  const mierka = zdroj / ciel;
  return Array.from({ length: ciel }, (_, d) => {
    const od = d * mierka;
    const po = Math.min((d + 1) * mierka, zdroj);
    const vahy: [number, number][] = [];
    for (let i = Math.floor(od); i < Math.ceil(po); i++) {
      const prekryv = Math.min(po, i + 1) - Math.max(od, i);
      if (prekryv > 1e-12) vahy.push([i, prekryv / mierka]);
    }
    return vahy;
  });
}

/** cv2.resize INTER_AREA pre reálny jednokanálový obrázok. */
export function zmenPlochouF(src: Float64Array, sw: number, sh: number, dw: number, dh: number): Float64Array {
  const vx = vahyPlochy(sw, dw);
  const vy = vahyPlochy(sh, dh);
  const medzi = new Float64Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (const [i, a] of vx[x]) s += src[y * sw + i] * a;
      medzi[y * dw + x] = s;
    }
  }
  const out = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (const [j, a] of vy[y]) for (let x = 0; x < dw; x++) out[y * dw + x] += medzi[j * dw + x] * a;
  }
  return out;
}
