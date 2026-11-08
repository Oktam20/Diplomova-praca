export type Histogram = { pocty: Int32Array; spolu: number; min: number; max: number };

export function histogram(data: Uint8Array): Histogram {
  const pocty = new Int32Array(256);
  for (let i = 0; i < data.length; i++) pocty[data[i]]++;
  let min = 0;
  while (min < 255 && pocty[min] === 0) min++;
  let max = 255;
  while (max > 0 && pocty[max] === 0) max--;
  return { pocty, spolu: data.length, min, max };
}

const f32 = Math.fround;
const FLT_EPSILON = 1.1920928955078125e-7;

/** cv2.threshold(..., THRESH_OTSU). */
export function otsu({ pocty, spolu }: Histogram): number {
  const k = 1 / spolu;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * pocty[i];
  mu *= k;
  let mu1 = 0;
  let q1 = 0;
  let najSigma = 0;
  let prah = 0;
  for (let i = 0; i < 256; i++) {
    const p = pocty[i] * k;
    mu1 *= q1;
    q1 += p;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < FLT_EPSILON || Math.max(q1, q2) > 1 - FLT_EPSILON) continue;
    mu1 = (mu1 + i * p) / q1;
    const mu2 = (mu - q1 * mu1) / q2;
    const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
    if (sigma > najSigma) {
      najSigma = sigma;
      prah = i;
    }
  }
  return prah;
}

/** cv2.threshold(..., THRESH_TRIANGLE). */
function triangle({ pocty }: Histogram): number {
  const h = Array.from(pocty);
  let vlavo = h.findIndex((v) => v > 0);
  if (vlavo < 0) vlavo = 0;
  if (vlavo > 0) vlavo--;
  let vpravo = 0;
  for (let i = 255; i > 0; i--) {
    if (h[i] > 0) {
      vpravo = i;
      break;
    }
  }
  if (vpravo < 255) vpravo++;
  let vrchol = 0;
  for (let i = 0; i < 256; i++) if (h[i] > h[vrchol]) vrchol = i;
  const max = h[vrchol];
  const otocene = vrchol - vlavo < vpravo - vrchol;
  if (otocene) {
    h.reverse();
    vlavo = 255 - vpravo;
    vrchol = 255 - vrchol;
  }
  let prah = vlavo;
  let najdalej = 0;
  for (let i = vlavo + 1; i <= vrchol; i++) {
    const d = max * i + (vlavo - vrchol) * h[i];
    if (d > najdalej) {
      najdalej = d;
      prah = i;
    }
  }
  prah--;
  return otocene ? 255 - prah : prah;
}

/** skimage.filters.threshold_yen (výpočet vo float32 ako v skimage). */
function yen({ pocty, spolu, min, max }: Histogram): number {
  const n = max - min + 1;
  if (n === 1) return min;
  const p = Float64Array.from({ length: n }, (_, i) => f32(pocty[min + i] / spolu));
  const P1 = new Float64Array(n);
  const P1sq = new Float64Array(n);
  const P2sq = new Float64Array(n);
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    a = f32(a + p[i]);
    b = f32(b + f32(p[i] * p[i]));
    P1[i] = a;
    P1sq[i] = b;
  }
  b = 0;
  for (let i = n - 1; i >= 0; i--) {
    b = f32(b + f32(p[i] * p[i]));
    P2sq[i] = b;
  }
  let najlepsie = -Infinity;
  let index = 0;
  for (let i = 0; i < n - 1; i++) {
    const y = f32(P1[i] * f32(1 - P1[i]));
    const kriterium = f32(Math.log(f32(f32(1 / f32(P1sq[i] * P2sq[i + 1])) * f32(y * y))));
    if (Number.isNaN(kriterium)) return min + i;
    if (kriterium > najlepsie) {
      najlepsie = kriterium;
      index = i;
    }
  }
  return min + index;
}

/** skimage.filters.threshold_li (pre celočíselné obrázky). */
function li({ pocty, spolu, min, max }: Histogram): number | null {
  if (min === max) return min;
  const n = max - min + 1;
  let sucet = 0;
  for (let i = 0; i < n; i++) sucet += i * pocty[min + i];
  let novy = sucet / spolu;
  let stary = -1;
  while (Math.abs(novy - stary) > 0.5) {
    stary = novy;
    let wPredok = 0;
    let sPredok = 0;
    let wPozadie = 0;
    let sPozadie = 0;
    for (let i = 0; i < n; i++) {
      const c = pocty[min + i];
      if (i > stary) {
        wPredok += c;
        sPredok += i * c;
      } else {
        wPozadie += c;
        sPozadie += i * c;
      }
    }
    if (wPredok === 0 || wPozadie === 0) return null;
    const predok = sPredok / wPredok;
    const pozadie = sPozadie / wPozadie;
    if (pozadie === 0) break;
    novy = (pozadie - predok) / (Math.log(pozadie) - Math.log(predok));
  }
  return novy + min;
}

/** skimage.filters.threshold_isodata. */
function isodata({ pocty, min, max }: Histogram): number | null {
  const n = max - min + 1;
  if (n === 1) return min;
  let spolu = 0;
  let sucet = 0;
  for (let i = 0; i < n; i++) {
    spolu += pocty[min + i];
    sucet += pocty[min + i] * (min + i);
  }
  let spoluDole = 0;
  let sucetDole = 0;
  for (let i = 0; i < n - 1; i++) {
    spoluDole += pocty[min + i];
    sucetDole += pocty[min + i] * (min + i);
    const dole = sucetDole / spoluDole;
    const hore = (sucet - sucetDole) / (spolu - spoluDole);
    const vzdialenost = (dole + hore) / 2 - (min + i);
    if (vzdialenost >= 0 && vzdialenost < 1) return min + i;
  }
  return null;
}

/** skimage.filters.threshold_mean. */
function priemer({ pocty, spolu }: Histogram): number {
  let sucet = 0;
  for (let i = 0; i < 256; i++) sucet += i * pocty[i];
  return sucet / spolu;
}

/** scipy.ndimage.uniform_filter1d(x, 3, mode='reflect') vo float32. */
function vyhladHistogram(src: Float64Array): Float64Array {
  const n = src.length;
  const ext = new Float64Array(n + 2);
  ext[0] = src[0];
  ext.set(src, 1);
  ext[n + 1] = src[n - 1];
  const out = new Float64Array(n);
  let s = (ext[0] + ext[1] + ext[2]) / 3;
  out[0] = f32(s);
  for (let i = 1; i < n; i++) {
    s += (ext[i + 2] - ext[i - 1]) / 3;
    out[i] = f32(s);
  }
  return out;
}

function lokalneMaxima(hist: Float64Array): number[] {
  const maxima: number[] = [];
  let stupa = true;
  for (let i = 0; i < hist.length - 1; i++) {
    if (stupa && hist[i + 1] < hist[i]) {
      stupa = false;
      maxima.push(i);
    } else if (!stupa && hist[i + 1] > hist[i]) {
      stupa = true;
    }
  }
  return maxima;
}

/** skimage.filters.threshold_minimum – null, keď histogram nemá dva vrcholy. */
function minimum({ pocty, min, max }: Histogram): number | null {
  let hladky = Float64Array.from({ length: max - min + 1 }, (_, i) => pocty[min + i]);
  let maxima: number[] = [];
  let k = 0;
  for (; k < 10000; k++) {
    hladky = vyhladHistogram(hladky);
    maxima = lokalneMaxima(hladky);
    if (maxima.length < 3) break;
  }
  if (maxima.length !== 2 || k === 9999) return null;
  let index = maxima[0];
  for (let i = maxima[0]; i <= maxima[1]; i++) if (hladky[i] < hladky[index]) index = i;
  return min + index;
}

export const METODY: [string, (h: Histogram) => number | null][] = [
  ['Otsu', otsu],
  ['Triangle', triangle],
  ['Yen', yen],
  ['Li', li],
  ['Isodata', isodata],
  ['Mean', priemer],
  ['Minimum', minimum],
];
