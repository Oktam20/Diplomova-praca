import { odraz, zaokruhli } from './obrazok';

/** Gaussov filter z troch krabicových filtrov (šírky podľa Wells / Kovesi), okraj REFLECT_101. */
export function gaussKrabicami(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
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
function krabica(src: Float64Array, w: number, h: number, r: number, vodorovne: boolean): Float64Array {
  if (r <= 0) return src;
  const out = new Float64Array(w * h);
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

/** cv2.distanceTransform(maska, DIST_L2, 5) – dva prechody s maskou susedov (dy, dx, váha). */
export function vzdialenost5(maska: Uint8Array, w: number, h: number): Float32Array {
  const [a, b, c] = [1, 1.4, 2.1969];
  const susedia = [[-2, -1, c], [-2, 1, c], [-1, -2, c], [-1, -1, b], [-1, 0, a], [-1, 1, b], [-1, 2, c], [0, -1, a]];
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

/** cv2.resize INTER_LINEAR, `ch` kanálov po 8 bitoch. */
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
        out[(y * dw + x) * ch + c] = Math.min(255, Math.max(0, zaokruhli(hore * (1 - ay) + dole * ay)));
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
