import { odraz, zaokruhli, type Obdlznik, type Obrazok } from './obrazok';

type Pole = Float32Array | Float64Array;
const novePole = <T extends Pole>(vzor: T, n: number) => new (vzor.constructor as new (n: number) => T)(n);
const orez = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

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

/** Konvolúcia so symetrickým jadrom po riadkoch alebo stĺpcoch (okraj REFLECT_101). */
function konvolucia(src: Float32Array, w: number, h: number, jadro: Float32Array, vodorovne: boolean): Float32Array {
  const r = jadro.length >> 1;
  const out = new Float32Array(w * h);
  if (vodorovne) {
    const riadok = new Float32Array(w + 2 * r);
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < riadok.length; i++) riadok[i] = src[y * w + odraz(i - r, w)];
      for (let x = 0; x < w; x++) {
        let s = jadro[r] * riadok[x + r];
        for (let j = 1; j <= r; j++) s += jadro[r + j] * (riadok[x + r - j] + riadok[x + r + j]);
        out[y * w + x] = s;
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const stred = y * w;
    for (let x = 0; x < w; x++) out[o + x] = jadro[r] * src[stred + x];
    for (let j = 1; j <= r; j++) {
      const a = odraz(y - j, h) * w;
      const b = odraz(y + j, h) * w;
      for (let x = 0; x < w; x++) out[o + x] += jadro[r + j] * (src[a + x] + src[b + x]);
    }
  }
  return out;
}

/** cv2.GaussianBlur(src, (0, 0), sigma); pri sigma > 3 sa aproximuje tromi krabicovými filtrami. */
export function gauss(src: Float32Array, w: number, h: number, sigma: number, velkost = 0): Float32Array {
  if (sigma > 3) return gaussKrabicami(src, w, h, sigma);
  const n = velkost > 0 ? velkost : zaokruhli(sigma * 8 + 1) | 1;
  const r = n >> 1;
  const jadro = Float32Array.from({ length: n }, (_, i) => Math.exp(-((i - r) * (i - r)) / (2 * sigma * sigma)));
  const sucet = jadro.reduce((s, v) => s + v, 0);
  for (let i = 0; i < n; i++) jadro[i] /= sucet;
  return konvolucia(konvolucia(src, w, h, jadro, true), w, h, jadro, false);
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

/** cv2.blur(src, (k, k)). */
export function priemerVOkne(src: Float32Array, w: number, h: number, k: number): Float32Array {
  const r = k >> 1;
  return krabica(krabica(src, w, h, r, true), w, h, r, false);
}

export function naBajty(src: ArrayLike<number>): Uint8Array {
  return Uint8Array.from({ length: src.length }, (_, i) => orez(zaokruhli(src[i])));
}

/** GaussianBlur 8-bitového kanála. */
export function gaussBajty(src: Uint8Array, w: number, h: number, sigma: number, velkost = 0): Uint8Array {
  return naBajty(gauss(Float32Array.from(src), w, h, sigma, velkost > 0 ? velkost : zaokruhli(sigma * 6 + 1) | 1));
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

/** Maximum z troch susedov v riadku (mimo obrázka sa ignoruje). */
function maximumTroch(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = Math.max(src[i], x > 0 ? src[i - 1] : 0, x < w - 1 ? src[i + 1] : 0);
    }
  }
  return out;
}

/** cv2.dilate (maximum) 8-bitového kanála; erode sa počíta ako dilate obrátených hodnôt. */
function sedaMorfologia(src: Uint8Array, w: number, h: number, jadro: readonly number[], maximum: boolean): Uint8Array {
  let riadky = maximum ? src : Uint8Array.from(src, (v) => 255 - v);
  const out = new Uint8Array(w * h);
  const stred = (jadro.length - 1) >> 1;
  for (let r = 0; r <= Math.max(...jadro); r++) {
    if (r > 0) riadky = maximumTroch(riadky, w, h);
    for (let i = 0; i < jadro.length; i++) {
      if (jadro[i] !== r) continue;
      const posun = (i - stred) * w;
      for (let p = Math.max(0, -posun); p < Math.min(w * h, w * h - posun); p++) {
        if (riadky[p + posun] > out[p]) out[p] = riadky[p + posun];
      }
    }
  }
  return maximum ? out : Uint8Array.from(out, (v) => 255 - v);
}

/** cv2.morphologyEx(MORPH_CLOSE) 8-bitového kanála. */
export function uzavri(src: Uint8Array, w: number, h: number, jadro: readonly number[]): Uint8Array {
  return sedaMorfologia(sedaMorfologia(src, w, h, jadro, true), w, h, jadro, false);
}

/** Vzdialenostná transformácia s maskou susedov (dy, dx, váha) – dva prechody. */
function vzdialenostMaskou(maska: Uint8Array, w: number, h: number, susedia: number[][]): Float32Array {
  const d = Float32Array.from(maska, (v) => (v ? 1e9 : 0));
  for (const smer of [1, -1]) {
    for (let k = 0; k < h; k++) {
      const y = smer > 0 ? k : h - 1 - k;
      for (let j = 0; j < w; j++) {
        const x = smer > 0 ? j : w - 1 - j;
        let v = d[y * w + x];
        if (v === 0) continue;
        for (const [dy, dx, vaha] of susedia) {
          const ny = y + smer * dy;
          const nx = x + smer * dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          v = Math.min(v, d[ny * w + nx] + vaha);
        }
        d[y * w + x] = v;
      }
    }
  }
  return d;
}

/** cv2.distanceTransform(maska, DIST_L2, 3). */
export function vzdialenost3(maska: Uint8Array, w: number, h: number): Float32Array {
  const [a, b] = [0.955, 1.3693];
  return vzdialenostMaskou(maska, w, h, [[0, -1, a], [-1, 0, a], [-1, -1, b], [-1, 1, b]]);
}

/** cv2.distanceTransform(maska, DIST_L2, 5). */
export function vzdialenost5(maska: Uint8Array, w: number, h: number): Float32Array {
  const [a, b, c] = [1, 1.4, 2.1969];
  return vzdialenostMaskou(maska, w, h, [
    [-2, -1, c], [-2, 1, c], [-1, -2, c], [-1, -1, b], [-1, 0, a], [-1, 1, b], [-1, 2, c], [0, -1, a],
  ]);
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

/** Zdrojové pixely a váha pre INTER_LINEAR (súradnica stredu pixela). */
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

/** cv2.resize INTER_NEAREST, `ch` kanálov. */
export function zmenNajblizsi(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(Math.floor((y * sh) / dh), sh - 1);
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(Math.floor((x * sw) / dw), sw - 1);
      for (let c = 0; c < ch; c++) out[(y * dw + x) * ch + c] = src[(sy * sw + sx) * ch + c];
    }
  }
  return out;
}

/** cv2.resize INTER_LINEAR, `ch` kanálov. */
export function zmenLinearne(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * ch);
  const xs = Array.from({ length: dw }, (_, x) => linearnyBod(x, sw / dw, sw));
  for (let y = 0; y < dh; y++) {
    const [y0, y1, ay] = linearnyBod(y, sh / dh, sh);
    for (let x = 0; x < dw; x++) {
      const [x0, x1, ax] = xs[x];
      for (let c = 0; c < ch; c++) {
        const hore = src[(y0 * sw + x0) * ch + c] * (1 - ax) + src[(y0 * sw + x1) * ch + c] * ax;
        const dole = src[(y1 * sw + x0) * ch + c] * (1 - ax) + src[(y1 * sw + x1) * ch + c] * ax;
        out[(y * dw + x) * ch + c] = orez(zaokruhli(hore * (1 - ay) + dole * ay));
      }
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

/** cv2.resize INTER_AREA pri zmenšení (pri zväčšení INTER_LINEAR), `ch` kanálov. */
export function zmenPlochou(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  if (dw >= sw && dh >= sh) return zmenLinearne(src, ch, sw, sh, dw, dh);
  const vx = vahyPlochy(sw, dw).map((v) => v.map(([i, a]) => [i, Math.fround(a)]));
  const vy = vahyPlochy(sh, dh).map((v) => v.map(([i, a]) => [i, Math.fround(a)]));
  const medzi = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (const [i, a] of vx[x]) s += src[(y * sw + i) * ch + c] * a;
        medzi[(y * dw + x) * ch + c] = s;
      }
    }
  }
  const out = new Float32Array(dw * dh * ch);
  const riadok = dw * ch;
  for (let y = 0; y < dh; y++) {
    for (const [j, a] of vy[y]) {
      for (let i = 0; i < riadok; i++) out[y * riadok + i] += medzi[j * riadok + i] * a;
    }
  }
  return naBajty(out);
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

/** Váhy bikubickej interpolácie OpenCV (A = −0,75). */
function kubickeVahy(a: number): number[] {
  const A = -0.75;
  const w0 = ((A * (a + 1) - 5 * A) * (a + 1) + 8 * A) * (a + 1) - 4 * A;
  const w1 = ((A + 2) * a - (A + 3)) * a * a + 1;
  const w2 = ((A + 2) * (1 - a) - (A + 3)) * (1 - a) * (1 - a) + 1;
  return [w0, w1, w2, 1 - w0 - w1 - w2];
}

/** cv2.resize INTER_CUBIC, `ch` kanálov (okraj = krajný pixel). */
export function zmenKubicky(src: Uint8Array, ch: number, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const body = (d: number, mierka: number, dlzka: number) => {
    const f = (d + 0.5) * mierka - 0.5;
    const s = Math.floor(f);
    return { idx: [s - 1, s, s + 1, s + 2].map((i) => Math.min(dlzka - 1, Math.max(0, i))), vahy: kubickeVahy(f - s) };
  };
  const bx = Array.from({ length: dw }, (_, x) => body(x, sw / dw, sw));
  const medzi = new Float32Array(dw * sh * ch);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const { idx, vahy } = bx[x];
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let t = 0; t < 4; t++) s += src[(y * sw + idx[t]) * ch + c] * vahy[t];
        medzi[(y * dw + x) * ch + c] = s;
      }
    }
  }
  const out = new Float32Array(dw * dh * ch);
  const riadok = dw * ch;
  for (let y = 0; y < dh; y++) {
    const { idx, vahy } = body(y, sh / dh, sh);
    for (let t = 0; t < 4; t++) {
      for (let i = 0; i < riadok; i++) out[y * riadok + i] += medzi[idx[t] * riadok + i] * vahy[t];
    }
  }
  return naBajty(out);
}

/** Náhrada cv2.inpaint: diery sa po vrstvách od okraja vyplnia priemerom známych susedov. */
export function doplnZOkolia(obr: Uint8Array, w: number, h: number, diera: Uint8Array): Uint8Array {
  const out = obr.slice();
  const zname = nie01(diera);
  let zostava: number[] = [];
  for (let i = 0; i < w * h; i++) if (diera[i]) zostava.push(i);
  if (zostava.length === 0 || zostava.length === w * h) return out;
  while (zostava.length > 0) {
    const dalej: number[] = [];
    const vyplnene: [number, number, number, number][] = [];
    for (const i of zostava) {
      const x = i % w;
      const y = (i - x) / w;
      let n = 0;
      const s = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= w || yy < 0 || yy >= h || !zname[yy * w + xx]) continue;
          n++;
          for (let c = 0; c < 3; c++) s[c] += out[3 * (yy * w + xx) + c];
        }
      }
      if (n === 0) dalej.push(i);
      else vyplnene.push([i, Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n)]);
    }
    if (vyplnene.length === 0) break;
    for (const [i, b, g, r] of vyplnene) {
      out.set([b, g, r], 3 * i);
      zname[i] = 1;
    }
    zostava = dalej;
  }
  return out;
}

const nie01 = (m: Uint8Array) => Uint8Array.from(m, (v) => (v ? 0 : 1));
