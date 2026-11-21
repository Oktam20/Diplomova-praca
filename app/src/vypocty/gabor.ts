import { odraz } from './obrazok';

const SMERY = [0, 45, 90, 135];

/** cv2.getGaborKernel((k, k), sigma, theta, lambd, gamma, psi). */
function gaborovoJadro(k: number, sigma: number, theta: number, lambda: number, gamma: number, psi: number): Float64Array {
  const sx = sigma;
  const sy = sigma / gamma;
  const pol = Math.floor(k / 2);
  const jadro = new Float64Array(k * k);
  for (let y = -pol; y <= pol; y++) {
    for (let x = -pol; x <= pol; x++) {
      const xr = x * Math.cos(theta) + y * Math.sin(theta);
      const yr = -x * Math.sin(theta) + y * Math.cos(theta);
      const obalka = Math.exp((-0.5 / (sx * sx)) * xr * xr + (-0.5 / (sy * sy)) * yr * yr);
      jadro[(pol - y) * k + (pol - x)] = obalka * Math.cos(((Math.PI * 2) / lambda) * xr + psi);
    }
  }
  return jadro;
}

/** Komplexná FFT na mieste (radix-2); spätná bez škálovania. */
function fft(re: Float64Array, im: Float64Array, spatna: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let dlzka = 2; dlzka <= n; dlzka <<= 1) {
    const uhol = ((spatna ? 2 : -2) * Math.PI) / dlzka;
    const wr = Math.cos(uhol);
    const wi = Math.sin(uhol);
    for (let i = 0; i < n; i += dlzka) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < dlzka / 2; k++) {
        const a = i + k;
        const b = a + dlzka / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const novyCr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = novyCr;
      }
    }
  }
}

/** 2D FFT n x n – najprv riadky, potom stĺpce. */
function fft2d(re: Float64Array, im: Float64Array, n: number, spatna: boolean): void {
  const r = new Float64Array(n);
  const i = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    r.set(re.subarray(y * n, y * n + n));
    i.set(im.subarray(y * n, y * n + n));
    fft(r, i, spatna);
    re.set(r, y * n);
    im.set(i, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      r[y] = re[y * n + x];
      i[y] = im[y * n + x];
    }
    fft(r, i, spatna);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = r[y];
      im[y * n + x] = i[y];
    }
  }
}

/** Priemerná veľkosť komplexnej Gaborovej odozvy vo výbere (priemer cez 4 smery). */
export function gaborovaOdozva(obr: Float64Array, w: number, h: number, vyber: Uint8Array, lambda: number): number {
  const sigma = 0.56 * lambda;
  const k = Math.trunc(6 * sigma) | 1;
  const a = k >> 1;
  let n = 1;
  while (n < Math.max(w + 2 * a, h + 2 * a)) n <<= 1;

  const obrRe = new Float64Array(n * n);
  const obrIm = new Float64Array(n * n);
  for (let y = 0; y < h + 2 * a; y++) {
    for (let x = 0; x < w + 2 * a; x++) obrRe[y * n + x] = obr[odraz(y - a, h) * w + odraz(x - a, w)];
  }
  fft2d(obrRe, obrIm, n, false);

  let sucet = 0;
  for (const stupne of SMERY) {
    const theta = (stupne * Math.PI) / 180;
    const jadroRe = gaborovoJadro(k, sigma, theta, lambda, 0.5, 0);
    const jadroIm = gaborovoJadro(k, sigma, theta, lambda, 0.5, Math.PI / 2);
    const priemer = jadroRe.reduce((s, v) => s + v, 0) / jadroRe.length;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let dy = -a; dy <= a; dy++) {
      for (let dx = -a; dx <= a; dx++) {
        const i = (((-dy % n) + n) % n) * n + (((-dx % n) + n) % n);
        re[i] = jadroRe[(dy + a) * k + dx + a] - priemer;
        im[i] = jadroIm[(dy + a) * k + dx + a];
      }
    }
    fft2d(re, im, n, false);
    for (let i = 0; i < n * n; i++) {
      const r = obrRe[i] * re[i] - obrIm[i] * im[i];
      im[i] = obrRe[i] * im[i] + obrIm[i] * re[i];
      re[i] = r;
    }
    fft2d(re, im, n, true);
    let s = 0;
    let pocet = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!vyber[y * w + x]) continue;
        const i = (y + a) * n + x + a;
        s += Math.hypot(re[i], im[i]) * (1 / (n * n));
        pocet++;
      }
    }
    sucet += pocet ? s / pocet : 0;
  }
  return sucet / SMERY.length;
}
