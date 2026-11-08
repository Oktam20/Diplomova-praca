import { hodnotyPod, kruh, pocet, rozsirMasku, zuzMasku } from './binarne';
import { gaussKrabicami, linearnyBod, vzdialenost5, zmenLinearneF, zmenPlochouF } from './filtre';
import { gaborovaOdozva } from './gabor';
import { median, percentil, zaokruhli, type Obrazok } from './obrazok';

const MIN_PLOCHA = 200;
const STRANA_ODHADU = 256;
const ZON = 4;
const PRIEMER_VYREZU = 256;

export type Crty = Record<string, number>;

/** Lab fotky a odhad farby papiera pod každým pixelom. */
export type Papier = {
  w: number;
  h: number;
  lab: Float64Array[];
  polomer: number;
  pozadie: (k: number, x: number, y: number) => number;
  maska: Uint8Array;
};

const LINEARNE = Float64Array.from({ length: 256 }, (_, v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
});

const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** cv2.cvtColor(bgr / 255 ako float32, COLOR_BGR2LAB) – L 0–100, a, b okolo nuly. */
function labFotky({ sirka, vyska, data }: Obrazok): Float64Array[] {
  const n = sirka * vyska;
  const [L, A, B] = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = LINEARNE[data[p + 2]];
    const g = LINEARNE[data[p + 1]];
    const b = LINEARNE[data[p]];
    const X = (0.412453 * r + 0.35758 * g + 0.180423 * b) / 0.950456;
    const Y = 0.212671 * r + 0.71516 * g + 0.072169 * b;
    const Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
    L[i] = Y > 0.008856 ? 116 * f(Y) - 16 : 903.3 * Y;
    A[i] = 500 * (f(X) - f(Y));
    B[i] = 200 * (f(Y) - f(Z));
  }
  return [L, A, B];
}

/** Papier = okolie škvrny v odstupe od nej; jeho farba sa rozmaže vážene, aby pokryla aj škvrnu. */
export function odhadniPapier(obr: Obrazok, maska: Uint8Array): Papier | null {
  const { sirka: w, vyska: h } = obr;
  const n = w * h;
  const plocha = pocet(maska);
  if (plocha < MIN_PLOCHA) return null;
  const polomer = Math.sqrt(plocha / Math.PI);
  const lab = labFotky(obr);

  const odstup = Math.max(1, zaokruhli(Math.max(5, 0.3 * polomer)));
  let papier = Uint8Array.from(rozsirMasku(maska, w, h, kruh(odstup)), (v) => (v ? 0 : 1));
  if (pocet(papier) / n < 0.05) papier = Uint8Array.from(maska, (v) => (v ? 0 : 1));
  if (pocet(papier) < 50) {
    const stredy = lab.map((k) => median(k));
    return { w, h, lab, polomer, pozadie: (k) => stredy[k], maska: papier };
  }

  const m = Math.min(1, STRANA_ODHADU / Math.max(h, w));
  const sw = Math.max(8, Math.trunc(w * m));
  const sh = Math.max(8, Math.trunc(h * m));
  const [bw, bh] = m < 1 ? [sw, sh] : [w, h];
  const zmensi = (src: Float64Array) => (m < 1 ? zmenPlochouF(src, w, h, sw, sh) : src);
  const vaha = zmensi(Float64Array.from(papier));
  const sigma = Math.min(Math.max(polomer * m, 3.0), 0.5 * Math.min(sw, sh));
  const menovatel = gaussKrabicami(vaha, bw, bh, sigma);
  const mriezky = lab.map((k) => {
    const nahradna = median(hodnotyPod(k, papier));
    const male = zmensi(k);
    const citatel = gaussKrabicami(Float64Array.from(male, (v, i) => v * vaha[i]), bw, bh, sigma);
    return Float64Array.from(citatel, (v, i) => (menovatel[i] > 1e-3 ? v / menovatel[i] : nahradna));
  });

  const bodyX = Array.from({ length: w }, (_, x) => linearnyBod(x, bw / w, bw));
  const bodyY = Array.from({ length: h }, (_, y) => linearnyBod(y, bh / h, bh));
  const pozadie = (k: number, x: number, y: number) => {
    const g = mriezky[k];
    const [x0, x1, ax] = bodyX[x];
    const [y0, y1, ay] = bodyY[y];
    const hore = g[y0 * bw + x0] * (1 - ax) + g[y0 * bw + x1] * ax;
    const dole = g[y1 * bw + x0] * (1 - ax) + g[y1 * bw + x1] * ax;
    return hore * (1 - ay) + dole * ay;
  };
  return { w, h, lab, polomer, pozadie, maska: papier };
}

/** Výrez okolo škvrny preškálovaný na ekvivalentný priemer 256 px: jas voči papieru a maska. */
export type VyrezCrt = { jas: Float64Array; maska: Uint8Array; cw: number; ch: number };

function normovanyVyrez({ w, h, lab, polomer, pozadie }: Papier, maska: Uint8Array): VyrezCrt {
  let [xmin, ymin, xmax, ymax] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maska[y * w + x]) continue;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
  }
  const okraj = Math.trunc(Math.max(5, 0.3 * polomer));
  const x0 = Math.max(0, xmin - okraj);
  const y0 = Math.max(0, ymin - okraj);
  const rw = Math.min(w, xmax + okraj + 1) - x0;
  const rh = Math.min(h, ymax + okraj + 1) - y0;
  const s = PRIEMER_VYREZU / (2 * polomer);
  const cw = Math.max(8, zaokruhli(rw * s));
  const ch = Math.max(8, zaokruhli(rh * s));

  const relativny = new Float64Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) relativny[y * rw + x] = lab[0][(y0 + y) * w + x0 + x] - pozadie(0, x0 + x, y0 + y);
  }
  const jas = s < 1 ? zmenPlochouF(relativny, rw, rh, cw, ch) : zmenLinearneF(relativny, rw, rh, cw, ch);
  const vyrezMasky = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(Math.floor((y * rh) / ch), rh - 1);
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(Math.floor((x * rw) / cw), rw - 1);
      vyrezMasky[y * cw + x] = maska[(y0 + sy) * w + x0 + sx] ? 1 : 0;
    }
  }
  return { jas, maska: vyrezMasky, cw, ch };
}

/** Histogram uniformných LBP (P susedov na kružnici s polomerom R) ako skimage local_binary_pattern. */
function lbp(jas: Float64Array, w: number, h: number, vyber: Uint8Array, P: number, R: number): number[] {
  const u8 = Float64Array.from(jas, (v) => Math.trunc(Math.min(255, Math.max(0, (v + 100) * 2))));
  const zaokruhli5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const dy = Array.from({ length: P }, (_, p) => zaokruhli5(-R * Math.sin((2 * Math.PI * p) / P)));
  const dx = Array.from({ length: P }, (_, p) => zaokruhli5(R * Math.cos((2 * Math.PI * p) / P)));
  const px = (r: number, c: number) => (r < 0 || r >= h || c < 0 || c >= w ? 0 : u8[r * w + c]);
  const bilinearne = (r: number, c: number) => {
    const [r0, c0, r1, c1] = [Math.floor(r), Math.floor(c), Math.ceil(r), Math.ceil(c)];
    const hore = (1 - (c - c0)) * px(r0, c0) + (c - c0) * px(r0, c1);
    const dole = (1 - (c - c0)) * px(r1, c0) + (c - c0) * px(r1, c1);
    return (1 - (r - r0)) * hore + (r - r0) * dole;
  };
  const hist = new Array(P + 2).fill(0);
  let spolu = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!vyber[r * w + c]) continue;
      const stred = u8[r * w + c];
      const bity = dx.map((_, p) => (bilinearne(r + dy[p], c + dx[p]) - stred >= 0 ? 1 : 0));
      let zmeny = 0;
      for (let p = 0; p < P - 1; p++) if (bity[p] !== bity[p + 1]) zmeny++;
      hist[zmeny <= 2 ? bity.reduce((s, b) => s + b, 0) : P + 1]++;
      spolu++;
    }
  }
  return hist.map((v) => v / Math.max(1, spolu));
}

/** Črty škvrny pre kľúč: farba voči papieru, zóny od okraja k stredu, lem a LBP. */
export function crtySkvrny(papier: Papier, maska: Uint8Array) {
  const { w, h, lab, pozadie, polomer } = papier;
  const n = w * h;
  const voci = (k: number, i: number) => lab[k][i] - pozadie(k, i % w, Math.trunc(i / w));
  const crty: Crty = {};
  const NAZVY = ['dL', 'da', 'db'];

  const hodnoty: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) if (maska[i]) for (let k = 0; k < 3; k++) hodnoty[k].push(voci(k, i));
  const priemery = hodnoty.map((v) => v.reduce((s, x) => s + x, 0) / v.length);
  NAZVY.forEach((nazov, k) => {
    const v = hodnoty[k];
    const m = priemery[k];
    crty[`farba_${nazov}_mean`] = m;
    crty[`farba_${nazov}_std`] = Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
    for (const q of [10, 50, 90]) crty[`farba_${nazov}_p${q}`] = percentil(v, q);
  });
  crty.farba_chroma = Math.hypot(priemery[1], priemery[2]);
  crty.farba_odtien_deg = (Math.atan2(priemery[2], priemery[1]) * 180) / Math.PI;

  const vzdialenost = vzdialenost5(maska, w, h);
  let najdalej = 0;
  for (let i = 0; i < n; i++) if (vzdialenost[i] > najdalej && vzdialenost[i] < 1e8) najdalej = vzdialenost[i];
  const zony = new Int8Array(n).fill(-1);
  const sucty = Array.from({ length: ZON }, () => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const d = vzdialenost[i];
    if (!(d > 0) || najdalej <= 0) continue;
    const z = Math.min(ZON - 1, Math.max(0, Math.ceil((d * ZON) / najdalej) - 1));
    zony[i] = z;
    for (let k = 0; k < 3; k++) sucty[z][k] += voci(k, i);
    sucty[z][3]++;
  }
  NAZVY.forEach((nazov, k) => {
    for (let z = 0; z < ZON; z++) crty[`zona${z}_${nazov}`] = sucty[z][3] ? sucty[z][k] / sucty[z][3] : NaN;
    crty[`zona_stred_minus_okraj_${nazov}`] = crty[`zona${ZON - 1}_${nazov}`] - crty[`zona0_${nazov}`];
  });

  const sirkaLemu = Math.max(1, zaokruhli(Math.max(3, 0.15 * polomer)));
  const rozsirena = rozsirMasku(maska, w, h, kruh(sirkaLemu));
  const lem = Uint8Array.from(rozsirena, (v, i) => (v && !maska[i] ? 1 : 0));
  const suctyLemu = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!lem[i]) continue;
    for (let k = 0; k < 3; k++) suctyLemu[k] += voci(k, i);
    suctyLemu[3]++;
  }
  NAZVY.forEach((nazov, k) => (crty[`halo_${nazov}`] = suctyLemu[3] ? suctyLemu[k] / suctyLemu[3] : NaN));

  const vyrez = normovanyVyrez(papier, maska);
  lbp(vyrez.jas, vyrez.cw, vyrez.ch, zuzMasku(vyrez.maska, vyrez.cw, vyrez.ch, kruh(3)), 8, 1).forEach(
    (v, k) => (crty[`lbp_P8R1_${k}`] = v)
  );
  return { crty, zony, lem, vyrez };
}

/** Sila hrubej textúry stredu škvrny (gabor_l<λ>_odozva v analýzach). */
export function textura({ jas, maska, cw, ch }: VyrezCrt, lambda: number): number | null {
  const oblast = zuzMasku(maska, cw, ch, kruh(3));
  const vnutri = hodnotyPod(jas, oblast);
  if (vnutri.length < 50) return null;
  const priemer = vnutri.reduce((s, v) => s + v, 0) / vnutri.length;
  const obr = Float64Array.from(jas, (v, i) => (oblast[i] ? v : priemer));
  const k = Math.trunc(6 * 0.56 * lambda) | 1;
  const stred = zuzMasku(oblast, cw, ch, kruh(Math.min(k >> 2, 10)));
  return gaborovaOdozva(obr, cw, ch, pocet(stred) >= 50 ? stred : oblast, lambda);
}
