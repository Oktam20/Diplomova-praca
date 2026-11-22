/**
 * cv2.inpaint(obrazok, maska, polomer, cv2.INPAINT_TELEA) pre 8-bitový BGR obrázok – prepis icvInpaint
 * z OpenCV 4.11 (modules/photo/src/inpaint.cpp) s rovnakým poradím výpočtov a zaokrúhľovaním na float32,
 * aby výsledok sedel bit po bite.
 */

const KNOWN = 0;
const BAND = 1;
const INSIDE = 2;
const CHANGE = 3;

const f32 = Math.fround;
const MALE = f32(1e-20);
const MIKRO = f32(0.000001);

/** cvRound – zaokrúhlenie k párnemu číslu. */
function cvRound(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Halda podľa (T, poradie vloženia) – ako std::priority_queue s CvHeapElem. */
class Halda {
  private T = new Float32Array(64);
  private poradie = new Int32Array(64);
  private bod = new Int32Array(64);
  private n = 0;
  private dalsie = 0;

  private zvacsi() {
    const T = new Float32Array(this.T.length * 2);
    const poradie = new Int32Array(this.T.length * 2);
    const bod = new Int32Array(this.T.length * 2);
    T.set(this.T);
    poradie.set(this.poradie);
    bod.set(this.bod);
    [this.T, this.poradie, this.bod] = [T, poradie, bod];
  }

  private mensi(a: number, b: number) {
    return this.T[a] < this.T[b] || (this.T[a] === this.T[b] && this.poradie[a] < this.poradie[b]);
  }

  private vymen(a: number, b: number) {
    [this.T[a], this.T[b]] = [this.T[b], this.T[a]];
    [this.poradie[a], this.poradie[b]] = [this.poradie[b], this.poradie[a]];
    [this.bod[a], this.bod[b]] = [this.bod[b], this.bod[a]];
  }

  vloz(bod: number, T: number) {
    if (this.n === this.T.length) this.zvacsi();
    let k = this.n++;
    this.T[k] = T;
    this.poradie[k] = this.dalsie++;
    this.bod[k] = bod;
    while (k > 0) {
      const rodic = (k - 1) >> 1;
      if (!this.mensi(k, rodic)) break;
      this.vymen(k, rodic);
      k = rodic;
    }
  }

  /** Bod s najmenším T (pri rovnosti skôr vložený); -1, ak je halda prázdna. */
  vyber(): number {
    if (this.n === 0) return -1;
    const vrch = this.bod[0];
    this.n--;
    if (this.n > 0) {
      this.T[0] = this.T[this.n];
      this.poradie[0] = this.poradie[this.n];
      this.bod[0] = this.bod[this.n];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.n && this.mensi(l, m)) m = l;
        if (r < this.n && this.mensi(r, m)) m = r;
        if (m === k) break;
        this.vymen(k, m);
        k = m;
      }
    }
    return vrch;
  }
}

/** Všetky nenulové body masky do haldy s T = 0 (po riadkoch, ako CvPriorityQueueFloat::Add). */
function pridajVsetky(halda: Halda, maska: Uint8Array) {
  for (let i = 0; i < maska.length; i++) if (maska[i]) halda.vloz(i, 0);
}

/** Okraj rozšíreného poľa (prvý a posledný riadok a stĺpec) na nulu. */
function nulovyOkraj(pole: Uint8Array, riadkov: number, stlpcov: number) {
  pole.fill(0, 0, stlpcov);
  pole.fill(0, (riadkov - 1) * stlpcov);
  for (let i = 1; i < riadkov - 1; i++) pole[i * stlpcov] = pole[i * stlpcov + stlpcov - 1] = 0;
}

/** cv::dilate s pravouhlým jadrom (2r+1) × (2r+1) alebo krížom 3 × 3 (mimo poľa sa ignoruje). */
function rozsir(src: Uint8Array, riadkov: number, stlpcov: number, r: number, kriz: boolean): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < riadkov; i++) {
    for (let j = 0; j < stlpcov; j++) {
      let m = 0;
      for (let di = -r; di <= r; di++) {
        const y = i + di;
        if (y < 0 || y >= riadkov) continue;
        for (let dj = -r; dj <= r; dj++) {
          if (kriz && di !== 0 && dj !== 0) continue;
          const x = j + dj;
          if (x < 0 || x >= stlpcov) continue;
          const v = src[y * stlpcov + x];
          if (v > m) m = v;
        }
      }
      out[i * stlpcov + j] = m;
    }
  }
  return out;
}

/** Odčítanie s orezaním na nulu (cv::subtract pre uchar). */
function odcitaj(a: Uint8Array, b: Uint8Array): Uint8Array {
  return Uint8Array.from(a, (v, i) => Math.max(0, v - b[i]));
}

function vyriesFMM(i1: number, j1: number, i2: number, j2: number, f: Uint8Array, t: Float32Array, s: number): number {
  const a11 = t[i1 * s + j1];
  const a22 = t[i2 * s + j2];
  const m12 = Math.min(a11, a22);
  let sol: number;
  if (f[i1 * s + j1] !== INSIDE) {
    if (f[i2 * s + j2] !== INSIDE) {
      if (Math.abs(a11 - a22) >= 1.0) sol = 1 + m12;
      else sol = (a11 + a22 + Math.sqrt(2 - (a11 - a22) * (a11 - a22))) * 0.5;
    } else sol = 1 + a11;
  } else if (f[i2 * s + j2] !== INSIDE) sol = 1 + a22;
  else sol = 1 + m12;
  return f32(sol);
}

function vzdialenostBodu(i: number, j: number, f: Uint8Array, t: Float32Array, s: number): number {
  const a = vyriesFMM(i - 1, j, i, j - 1, f, t, s);
  const b = vyriesFMM(i + 1, j, i, j - 1, f, t, s);
  const c = vyriesFMM(i - 1, j, i, j + 1, f, t, s);
  const d = vyriesFMM(i + 1, j, i, j + 1, f, t, s);
  return Math.min(Math.min(a, b), Math.min(c, d));
}

const SUSEDIA: [number, number][] = [
  [-1, 0],
  [0, -1],
  [1, 0],
  [0, 1],
];

/** icvCalcFMM s negate = true: záporné vzdialenosti v okolí diery. */
function vzdialenostiVonku(f: Uint8Array, t: Float32Array, halda: Halda, riadkov: number, stlpcov: number) {
  for (let bod = halda.vyber(); bod >= 0; bod = halda.vyber()) {
    const ii = Math.trunc(bod / stlpcov);
    const jj = bod - ii * stlpcov;
    f[bod] = CHANGE;
    for (const [di, dj] of SUSEDIA) {
      const i = ii + di;
      const j = jj + dj;
      if (i <= 0 || j <= 0 || i > riadkov || j > stlpcov) continue;
      const k = i * stlpcov + j;
      if (f[k] !== INSIDE) continue;
      const dist = vzdialenostBodu(i, j, f, t, stlpcov);
      t[k] = dist;
      f[k] = BAND;
      halda.vloz(k, dist);
    }
  }
  for (let k = 0; k < f.length; k++) {
    if (f[k] !== CHANGE) continue;
    f[k] = KNOWN;
    t[k] = -t[k];
  }
}

/** Doplní pixely obrázka BGR (sirka × vyska) pod maskou (nenulové) metódou Telea s polomerom `polomer`. */
export function inpaintTelea(obrazok: Uint8Array, sirka: number, vyska: number, maska: Uint8Array, polomer: number): Uint8Array {
  const range = Math.min(Math.max(cvRound(polomer), 1), 100);
  const riadkov = vyska + 2;
  const stlpcov = sirka + 2;
  const out = obrazok.slice();

  const m = new Uint8Array(riadkov * stlpcov);
  for (let y = 0; y < vyska; y++) for (let x = 0; x < sirka; x++) if (maska[y * sirka + x]) m[(y + 1) * stlpcov + x + 1] = INSIDE;
  nulovyOkraj(m, riadkov, stlpcov);

  const t = new Float32Array(riadkov * stlpcov).fill(1.0e6);
  const pas = odcitaj(rozsir(m, riadkov, stlpcov, 1, true), m);
  nulovyOkraj(pas, riadkov, stlpcov);
  const halda = new Halda();
  pridajVsetky(halda, pas);
  for (let k = 0; k < pas.length; k++) if (pas[k]) t[k] = 0;

  let okolie = odcitaj(rozsir(m, riadkov, stlpcov, range, false), m);
  const vonku = new Halda();
  pridajVsetky(vonku, pas);
  okolie = odcitaj(okolie, pas);
  nulovyOkraj(okolie, riadkov, stlpcov);
  vzdialenostiVonku(okolie, t, vonku, riadkov, stlpcov);

  const s = stlpcov;
  const px = (y: number, x: number, c: number) => out[(y * sirka + x) * 3 + c];
  const Ia = [0, 0, 0];
  const Jx = [0, 0, 0];
  const Jy = [0, 0, 0];
  const sw = [0, 0, 0];

  for (let bod = halda.vyber(); bod >= 0; bod = halda.vyber()) {
    const ii = Math.trunc(bod / s);
    const jj = bod - ii * s;
    m[bod] = KNOWN;
    for (const [di, dj] of SUSEDIA) {
      const i = ii + di;
      const j = jj + dj;
      if (i <= 0 || j <= 0 || i > riadkov - 1 || j > stlpcov - 1) continue;
      const ij = i * s + j;
      if (m[ij] !== INSIDE) continue;
      const dist = vzdialenostBodu(i, j, m, t, s);
      t[ij] = dist;

      let gx: number;
      let gy: number;
      if (m[ij + 1] !== INSIDE) gx = m[ij - 1] !== INSIDE ? f32(f32(t[ij + 1] - t[ij - 1]) * 0.5) : f32(t[ij + 1] - t[ij]);
      else gx = m[ij - 1] !== INSIDE ? f32(t[ij] - t[ij - 1]) : 0;
      if (m[ij + s] !== INSIDE) gy = m[ij - s] !== INSIDE ? f32(f32(t[ij + s] - t[ij - s]) * 0.5) : f32(t[ij + s] - t[ij]);
      else gy = m[ij - s] !== INSIDE ? f32(t[ij] - t[ij - s]) : 0;

      for (let c = 0; c < 3; c++) {
        Ia[c] = Jx[c] = Jy[c] = 0;
        sw[c] = MALE;
      }
      const tij = t[ij];
      for (let k = i - range; k <= i + range; k++) {
        const km = k - 1 + (k === 1 ? 1 : 0);
        const kp = k - 1 - (k === riadkov - 2 ? 1 : 0);
        for (let l = j - range; l <= j + range; l++) {
          const lm = l - 1 + (l === 1 ? 1 : 0);
          const lp = l - 1 - (l === stlpcov - 2 ? 1 : 0);
          if (!(k > 0 && l > 0 && k < riadkov - 1 && l < stlpcov - 1)) continue;
          const kl = k * s + l;
          if (m[kl] === INSIDE || (l - j) * (l - j) + (k - i) * (k - i) > range * range) continue;
          const ry = i - k;
          const rx = j - l;
          const dlzka = f32(rx * rx + ry * ry);
          const dst = f32(1 / (dlzka * Math.sqrt(dlzka)));
          const lev = f32(1 / f32(1 + Math.abs(f32(t[kl] - tij))));
          let dir = f32(f32(rx * gx) + f32(ry * gy));
          if (Math.abs(dir) <= 0.01) dir = MIKRO;
          const w = f32(Math.abs(f32(f32(dst * lev) * dir)));
          for (let c = 0; c < 3; c++) {
            let gIx: number;
            let gIy: number;
            if (m[kl + 1] !== INSIDE) gIx = m[kl - 1] !== INSIDE ? (px(km, lp + 1, c) - px(km, lm - 1, c)) * 2 : px(km, lp + 1, c) - px(km, lm, c);
            else gIx = m[kl - 1] !== INSIDE ? px(km, lp, c) - px(km, lm - 1, c) : 0;
            if (m[kl + s] !== INSIDE) gIy = m[kl - s] !== INSIDE ? (px(kp + 1, lm, c) - px(km - 1, lm, c)) * 2 : px(kp + 1, lm, c) - px(km, lm, c);
            else gIy = m[kl - s] !== INSIDE ? px(kp, lm, c) - px(km - 1, lm, c) : 0;
            Ia[c] = f32(Ia[c] + f32(w * px(k - 1, l - 1, c)));
            Jx[c] = f32(Jx[c] - f32(w * f32(gIx * rx)));
            Jy[c] = f32(Jy[c] - f32(w * f32(gIy * ry)));
            sw[c] = f32(sw[c] + w);
          }
        }
      }
      for (let c = 0; c < 3; c++) {
        const norma = f32(f32(Math.sqrt(f32(f32(Jx[c] * Jx[c]) + f32(Jy[c] * Jy[c])))) + MALE);
        const sat = f32(f32(Ia[c] / sw[c]) + f32(f32(Jx[c] + Jy[c]) / norma));
        out[((i - 1) * sirka + j - 1) * 3 + c] = Math.min(255, Math.max(0, cvRound(sat + 0.5)));
      }
      m[ij] = BAND;
      halda.vloz(ij, dist);
    }
  }
  return out;
}
