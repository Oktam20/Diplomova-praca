import { zaokruhli, type Obrazok } from './obrazok';

const orez = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

const HSV_POSUN = 12;
const DELENIE_S = Int32Array.from({ length: 256 }, (_, i) => (i ? zaokruhli((255 << HSV_POSUN) / i) : 0));
const DELENIE_H = Int32Array.from({ length: 256 }, (_, i) => (i ? zaokruhli((180 << HSV_POSUN) / (6 * i)) : 0));
const HSV_POL = 1 << (HSV_POSUN - 1);

function hsv(b: number, g: number, r: number) {
  const v = Math.max(b, g, r);
  const rozdiel = v - Math.min(b, g, r);
  let h = v === r ? g - b : v === g ? b - r + 2 * rozdiel : r - g + 4 * rozdiel;
  h = (h * DELENIE_H[rozdiel] + HSV_POL) >> HSV_POSUN;
  return { h: orez(h < 0 ? h + 180 : h), s: (rozdiel * DELENIE_S[v] + HSV_POL) >> HSV_POSUN, v };
}

const GAMA_POSUN = 3;
const LAB_POSUN = 12;
const LAB_POSUN2 = LAB_POSUN + GAMA_POSUN;
const LAB_POL = 1 << (LAB_POSUN - 1);
const LAB_POL2 = 1 << (LAB_POSUN2 - 1);
const LINEARNE = Int32Array.from({ length: 256 }, (_, i) => {
  const x = i / 255;
  return zaokruhli(255 * (1 << GAMA_POSUN) * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
});
const ODMOCNINA = Int32Array.from({ length: (256 * 3) / 2 * (1 << GAMA_POSUN) }, (_, i) => {
  const x = i / (255 * (1 << GAMA_POSUN));
  return zaokruhli((1 << LAB_POSUN2) * (x < 216 / 24389 ? x * (841 / 108) + 16 / 116 : Math.cbrt(x)));
});
const D65 = [0.950456, 1, 1.088754];
const C = [0.412453, 0.35758, 0.180423, 0.212671, 0.71516, 0.072169, 0.019334, 0.119193, 0.950227].map((c, i) =>
  zaokruhli(((1 << LAB_POSUN) * c) / D65[Math.floor(i / 3)])
);
const L_MIERKA = Math.trunc((116 * 255 + 50) / 100);
const L_POSUN = -Math.trunc((16 * 255 * (1 << LAB_POSUN2) + 50) / 100);
const AB_POSUN = 128 * (1 << LAB_POSUN2) + LAB_POL2;

/** Lab pixela zabalený ako (L << 16) | (a << 8) | b – presne ako cv2.cvtColor 8-bitového BGR -> LAB. */
export function labPixela(r: number, g: number, b: number): number {
  const R = LINEARNE[r];
  const G = LINEARNE[g];
  const B = LINEARNE[b];
  const fX = ODMOCNINA[(R * C[0] + G * C[1] + B * C[2] + LAB_POL) >> LAB_POSUN];
  const fY = ODMOCNINA[(R * C[3] + G * C[4] + B * C[5] + LAB_POL) >> LAB_POSUN];
  const fZ = ODMOCNINA[(R * C[6] + G * C[7] + B * C[8] + LAB_POL) >> LAB_POSUN];
  const L = (L_MIERKA * fY + L_POSUN + LAB_POL2) >> LAB_POSUN2;
  const a = (500 * (fX - fY) + AB_POSUN) >> LAB_POSUN2;
  const bb = (200 * (fY - fZ) + AB_POSUN) >> LAB_POSUN2;
  return (orez(L) << 16) | (orez(a) << 8) | orez(bb);
}

const YUV_POSUN = 14;
const YUV_STRED = (128 << YUV_POSUN) + (1 << (YUV_POSUN - 1));
const jas = (b: number, g: number, r: number) => (b * 1868 + g * 9617 + r * 4899 + (1 << (YUV_POSUN - 1))) >> YUV_POSUN;
const yuv = (rozdiel: number, k: number) => orez((rozdiel * k + YUV_STRED) >> YUV_POSUN);
const xyz = (r: number, g: number, b: number, kr: number, kg: number, kb: number) => orez((r * kr + g * kg + b * kb + 2048) >> 12);

type Vzorec = (b: number, g: number, r: number) => number;

/** Všetky kanály v pevnom poradí ako VSETKY_KANALY v analýzach (poradie rozhoduje pri rovnakom skóre). */
const KANALY: [string, Vzorec][] = [
  ['RGB_R', (b, g, r) => r],
  ['RGB_G', (b, g) => g],
  ['RGB_B', (b) => b],
  ['HSV_H', (b, g, r) => hsv(b, g, r).h],
  ['HSV_S', (b, g, r) => hsv(b, g, r).s],
  ['HSV_V', (b, g, r) => Math.max(b, g, r)],
  ['Lab_L', (b, g, r) => labPixela(r, g, b) >>> 16],
  ['Lab_a', (b, g, r) => (labPixela(r, g, b) >>> 8) & 255],
  ['Lab_b', (b, g, r) => labPixela(r, g, b) & 255],
  ['YCbCr_Y', jas],
  ['YCbCr_Cr', (b, g, r) => yuv(r - jas(b, g, r), 11682)],
  ['YCbCr_Cb', (b, g, r) => yuv(b - jas(b, g, r), 9241)],
  ['XYZ_X', (b, g, r) => xyz(r, g, b, 1689, 1465, 739)],
  ['XYZ_Y', (b, g, r) => xyz(r, g, b, 871, 2929, 296)],
  ['XYZ_Z', (b, g, r) => xyz(r, g, b, 79, 488, 3892)],
  ['YUV_Y', jas],
  ['YUV_U', (b, g, r) => yuv(b - jas(b, g, r), 8061)],
  ['YUV_V', (b, g, r) => yuv(r - jas(b, g, r), 14369)],
  ['Gray', jas],
];

/** Vybrané farebné kanály obrázka (v poradí KANALY). */
export function farebneKanaly(obr: Obrazok, nazvy: readonly string[]): [string, Obrazok][] {
  const { sirka, vyska, data } = obr;
  return KANALY.filter(([nazov]) => nazvy.includes(nazov)).map(([nazov, vzorec]) => {
    const kanal = new Uint8Array(sirka * vyska);
    for (let i = 0, p = 0; i < kanal.length; i++, p += 3) kanal[i] = vzorec(data[p], data[p + 1], data[p + 2]);
    return [nazov, { sirka, vyska, data: kanal }];
  });
}

/** cv2.cvtColor(obrazok, COLOR_BGR2LAB) – kanály L, a, b (8-bitové). */
export function naLab8(obr: Obrazok): [Uint8Array, Uint8Array, Uint8Array] {
  const n = obr.sirka * obr.vyska;
  const L = new Uint8Array(n);
  const A = new Uint8Array(n);
  const B = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const lab = labPixela(obr.data[p + 2], obr.data[p + 1], obr.data[p]);
    L[i] = lab >>> 16;
    A[i] = (lab >>> 8) & 255;
    B[i] = lab & 255;
  }
  return [L, A, B];
}
