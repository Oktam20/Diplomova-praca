import { reflect101 } from './image';

const ORIENTATIONS = [0, 45, 90, 135];

/** cv2.getGaborKernel((k, k), sigma, theta, lambd, gamma, psi) – riadkovo, k x k. */
export function gaborKernel(ksize: number, sigma: number, theta: number, lambd: number, gamma: number, psi: number) {
  const sx = sigma;
  const sy = sigma / gamma;
  const half = Math.floor(ksize / 2);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const ex = -0.5 / (sx * sx);
  const ey = -0.5 / (sy * sy);
  const cscale = (Math.PI * 2) / lambd;
  const k = new Float64Array(ksize * ksize);
  for (let y = -half; y <= half; y++) {
    for (let x = -half; x <= half; x++) {
      const xr = x * c + y * s;
      const yr = -x * s + y * c;
      k[(half - y) * ksize + (half - x)] = Math.exp(ex * xr * xr + ey * yr * yr) * Math.cos(cscale * xr + psi);
    }
  }
  return k;
}

/** Komplexná FFT na mieste (radix-2), n = mocnina 2; inverse = spätná (bez škálovania). */
function fft1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
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
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** 2D FFT n x n (riadky, potom stĺpce). */
function fft2d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    const o = y * n;
    rr.set(re.subarray(o, o + n));
    ri.set(im.subarray(o, o + n));
    fft1d(rr, ri, inverse);
    re.set(rr, o);
    im.set(ri, o);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rr[y] = re[y * n + x];
      ri[y] = im[y * n + x];
    }
    fft1d(rr, ri, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rr[y];
      im[y * n + x] = ri[y];
    }
  }
}

/** Priemerná veľkosť Gaborovej odozvy (priemer cez 4 smery) pre jednu vlnovú dĺžku. */
export function gaborResponse(img: Float64Array, w: number, h: number, sel: Uint8Array, lam: number): number {
  const sigma = 0.56 * lam;
  const ksize = Math.trunc(6 * sigma) | 1;
  const a = ksize >> 1;
  const pw = w + 2 * a;
  const ph = h + 2 * a;
  let n = 1;
  while (n < Math.max(pw, ph)) n <<= 1;

  const imgRe = new Float64Array(n * n);
  const imgIm = new Float64Array(n * n);
  for (let y = 0; y < ph; y++) {
    const sy = reflect101(y - a, h) * w;
    for (let x = 0; x < pw; x++) imgRe[y * n + x] = img[sy + reflect101(x - a, w)];
  }
  fft2d(imgRe, imgIm, n, false);

  let sum = 0;
  for (const deg of ORIENTATIONS) {
    const t = (deg * Math.PI) / 180;
    const kRe = gaborKernel(ksize, sigma, t, lam, 0.5, 0);
    const kIm = gaborKernel(ksize, sigma, t, lam, 0.5, Math.PI / 2);
    let mean = 0;
    for (let i = 0; i < kRe.length; i++) mean += kRe[i];
    mean /= kRe.length;
    const hRe = new Float64Array(n * n);
    const hIm = new Float64Array(n * n);
    for (let dy = -a; dy <= a; dy++) {
      const ry = ((-dy % n) + n) % n;
      for (let dx = -a; dx <= a; dx++) {
        const rx = ((-dx % n) + n) % n;
        const ki = (dy + a) * ksize + (dx + a);
        hRe[ry * n + rx] = kRe[ki] - mean;
        hIm[ry * n + rx] = kIm[ki];
      }
    }
    fft2d(hRe, hIm, n, false);
    for (let i = 0; i < n * n; i++) {
      const r = imgRe[i] * hRe[i] - imgIm[i] * hIm[i];
      const im = imgRe[i] * hIm[i] + imgIm[i] * hRe[i];
      hRe[i] = r;
      hIm[i] = im;
    }
    fft2d(hRe, hIm, n, true);
    const norm = 1 / (n * n);
    let s = 0;
    let cnt = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!sel[y * w + x]) continue;
        const i = (y + a) * n + (x + a);
        s += Math.hypot(hRe[i], hIm[i]) * norm;
        cnt++;
      }
    }
    sum += cnt ? s / cnt : 0;
  }
  return sum / ORIENTATIONS.length;
}
