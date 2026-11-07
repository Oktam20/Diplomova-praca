import { cvRound, type BgrImage, type GrayImage } from './image';

const HSV_SHIFT = 12;
const SDIV = new Int32Array(256);
const HDIV180 = new Int32Array(256);
for (let i = 1; i < 256; i++) {
  SDIV[i] = cvRound((255 << HSV_SHIFT) / i);
  HDIV180[i] = cvRound((180 << HSV_SHIFT) / (6 * i));
}

const GAMMA_SHIFT = 3;
const LAB_SHIFT = 12;
const LAB_SHIFT2 = LAB_SHIFT + GAMMA_SHIFT;
const LAB_CBRT_TAB_SIZE_B = 256 * 3 / 2 * (1 << GAMMA_SHIFT);
const SRGB_GAMMA_TAB = new Int32Array(256);
const LAB_CBRT_TAB = new Int32Array(LAB_CBRT_TAB_SIZE_B);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  const lin = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  SRGB_GAMMA_TAB[i] = cvRound(255 * (1 << GAMMA_SHIFT) * lin);
}
for (let i = 0; i < LAB_CBRT_TAB_SIZE_B; i++) {
  const x = i / (255 * (1 << GAMMA_SHIFT));
  const f = x < 216 / 24389 ? x * (841 / 108) + 16 / 116 : Math.cbrt(x);
  LAB_CBRT_TAB[i] = cvRound((1 << LAB_SHIFT2) * f);
}
const SRGB2XYZ_D65 = [
  0.412453, 0.35758, 0.180423,
  0.212671, 0.71516, 0.072169,
  0.019334, 0.119193, 0.950227,
];
const D65 = [0.950456, 1, 1.088754];
const LAB_COEFFS = SRGB2XYZ_D65.map((c, i) => cvRound(((1 << LAB_SHIFT) * c) / D65[Math.floor(i / 3)]));
const [C0, C1, C2, C3, C4, C5, C6, C7, C8] = LAB_COEFFS;
const LAB_HALF = 1 << (LAB_SHIFT - 1);
const LAB_HALF2 = 1 << (LAB_SHIFT2 - 1);
const LAB_AB_OFFSET = 128 * (1 << LAB_SHIFT2) + LAB_HALF2;
const L_SCALE = Math.trunc((116 * 255 + 50) / 100);
const L_SHIFT = -Math.trunc((16 * 255 * (1 << LAB_SHIFT2) + 50) / 100);

const YUV_SHIFT = 14;
const R2Y = 4899;
const G2Y = 9617;
const B2Y = 1868;
const YCRI = 11682;
const YCBI = 9241;
const R2VI = 14369;
const B2UI = 8061;
const YUV_DELTA = (128 << YUV_SHIFT) + (1 << (YUV_SHIFT - 1));
const YUV_ROUND = 1 << (YUV_SHIFT - 1);

const XYZ_SHIFT = 12;
const XYZ_ROUND = 1 << (XYZ_SHIFT - 1);

const sat = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Všetky kanály z MoldDetectionMask.get_color_channels v rovnakom poradí (ovplyvňuje remízy). */
export const COLOR_CHANNELS = [
  'RGB_R', 'RGB_G', 'RGB_B',
  'HSV_H', 'HSV_S', 'HSV_V',
  'Lab_L', 'Lab_a', 'Lab_b',
  'YCbCr_Y', 'YCbCr_Cr', 'YCbCr_Cb',
  'XYZ_X', 'XYZ_Y', 'XYZ_Z',
  'YUV_Y', 'YUV_U', 'YUV_V',
  'Gray',
] as const;
export type ColorChannel = (typeof COLOR_CHANNELS)[number];

/** Farebné kanály obrázka. */
export function getColorChannels(img: BgrImage, only: readonly ColorChannel[] = COLOR_CHANNELS): [string, GrayImage][] {
  const { width, height, data } = img;
  const n = width * height;
  const names = COLOR_CHANNELS.filter((c) => only.includes(c));
  const out = new Map<ColorChannel, Uint8Array>(names.map((c) => [c, new Uint8Array(n)]));
  const empty = new Uint8Array(0);
  const get = (c: ColorChannel) => out.get(c) ?? empty;
  const [cR, cG, cB] = [get('RGB_R'), get('RGB_G'), get('RGB_B')];
  const [cH, cS, cV] = [get('HSV_H'), get('HSV_S'), get('HSV_V')];
  const [cL, cA, cLb] = [get('Lab_L'), get('Lab_a'), get('Lab_b')];
  const [cY, cCr, cCb] = [get('YCbCr_Y'), get('YCbCr_Cr'), get('YCbCr_Cb')];
  const [cX, cXY, cZ] = [get('XYZ_X'), get('XYZ_Y'), get('XYZ_Z')];
  const [cYuvY, cU, cVv, cGray] = [get('YUV_Y'), get('YUV_U'), get('YUV_V'), get('Gray')];
  const wantHsv = cH.length + cS.length + cV.length > 0;
  const wantLab = cL.length + cA.length + cLb.length > 0;
  const wantY = cY.length + cCr.length + cCb.length + cYuvY.length + cU.length + cVv.length + cGray.length > 0;
  const wantXyz = cX.length + cXY.length + cZ.length > 0;

  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const b = data[p];
    const g = data[p + 1];
    const r = data[p + 2];
    if (cR.length) cR[i] = r;
    if (cG.length) cG[i] = g;
    if (cB.length) cB[i] = b;

    if (wantHsv) {
      let v = b;
      let vmin = b;
      if (g > v) v = g;
      if (r > v) v = r;
      if (g < vmin) vmin = g;
      if (r < vmin) vmin = r;
      const diff = v - vmin;
      if (cV.length) cV[i] = v;
      if (cS.length) cS[i] = (diff * SDIV[v] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
      if (cH.length) {
        let h = v === r ? g - b : v === g ? b - r + 2 * diff : r - g + 4 * diff;
        h = (h * HDIV180[diff] + (1 << (HSV_SHIFT - 1))) >> HSV_SHIFT;
        if (h < 0) h += 180;
        cH[i] = sat(h);
      }
    }

    if (wantLab) {
      const R = SRGB_GAMMA_TAB[r];
      const G = SRGB_GAMMA_TAB[g];
      const B = SRGB_GAMMA_TAB[b];
      const fX = LAB_CBRT_TAB[(R * C0 + G * C1 + B * C2 + LAB_HALF) >> LAB_SHIFT];
      const fY = LAB_CBRT_TAB[(R * C3 + G * C4 + B * C5 + LAB_HALF) >> LAB_SHIFT];
      const fZ = LAB_CBRT_TAB[(R * C6 + G * C7 + B * C8 + LAB_HALF) >> LAB_SHIFT];
      if (cL.length) cL[i] = sat((L_SCALE * fY + L_SHIFT + LAB_HALF2) >> LAB_SHIFT2);
      if (cA.length) cA[i] = sat((500 * (fX - fY) + LAB_AB_OFFSET) >> LAB_SHIFT2);
      if (cLb.length) cLb[i] = sat((200 * (fY - fZ) + LAB_AB_OFFSET) >> LAB_SHIFT2);
    }

    if (wantY) {
      const y = (b * B2Y + g * G2Y + r * R2Y + YUV_ROUND) >> YUV_SHIFT;
      if (cY.length) cY[i] = y;
      if (cYuvY.length) cYuvY[i] = y;
      if (cGray.length) cGray[i] = y;
      if (cCr.length) cCr[i] = sat(((r - y) * YCRI + YUV_DELTA) >> YUV_SHIFT);
      if (cCb.length) cCb[i] = sat(((b - y) * YCBI + YUV_DELTA) >> YUV_SHIFT);
      if (cU.length) cU[i] = sat(((b - y) * B2UI + YUV_DELTA) >> YUV_SHIFT);
      if (cVv.length) cVv[i] = sat(((r - y) * R2VI + YUV_DELTA) >> YUV_SHIFT);
    }

    if (wantXyz) {
      if (cX.length) cX[i] = sat((r * 1689 + g * 1465 + b * 739 + XYZ_ROUND) >> XYZ_SHIFT);
      if (cXY.length) cXY[i] = sat((r * 871 + g * 2929 + b * 296 + XYZ_ROUND) >> XYZ_SHIFT);
      if (cZ.length) cZ[i] = sat((r * 79 + g * 488 + b * 3892 + XYZ_ROUND) >> XYZ_SHIFT);
    }
  }
  return names.map((name) => [name, { width, height, data: out.get(name)! }]);
}

/** cv2.cvtColor(img, COLOR_BGR2LAB) – vráti kanály L, a, b. */
export function bgrToLab(img: BgrImage): [GrayImage, GrayImage, GrayImage] {
  const { width, height, data } = img;
  const n = width * height;
  const L = new Uint8Array(n);
  const A = new Uint8Array(n);
  const B = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const lab = labPixel(data[p + 2], data[p + 1], data[p]);
    L[i] = lab >>> 16;
    A[i] = (lab >>> 8) & 255;
    B[i] = lab & 255;
  }
  return [
    { width, height, data: L },
    { width, height, data: A },
    { width, height, data: B },
  ];
}

/** Lab pixel zabalený ako (L << 16) | (a << 8) | b (ako cv2.cvtColor 8-bitového BGR -> LAB). */
export function labPixel(r: number, g: number, b: number): number {
  const R = SRGB_GAMMA_TAB[r];
  const G = SRGB_GAMMA_TAB[g];
  const B = SRGB_GAMMA_TAB[b];
  const half = 1 << (LAB_SHIFT - 1);
  const c = LAB_COEFFS;
  const fX = LAB_CBRT_TAB[(R * c[0] + G * c[1] + B * c[2] + half) >> LAB_SHIFT];
  const fY = LAB_CBRT_TAB[(R * c[3] + G * c[4] + B * c[5] + half) >> LAB_SHIFT];
  const fZ = LAB_CBRT_TAB[(R * c[6] + G * c[7] + B * c[8] + half) >> LAB_SHIFT];
  const half2 = 1 << (LAB_SHIFT2 - 1);
  const L = (L_SCALE * fY + L_SHIFT + half2) >> LAB_SHIFT2;
  const a = (500 * (fX - fY) + 128 * (1 << LAB_SHIFT2) + half2) >> LAB_SHIFT2;
  const bb = (200 * (fY - fZ) + 128 * (1 << LAB_SHIFT2) + half2) >> LAB_SHIFT2;
  return (sat(L) << 16) | (sat(a) << 8) | sat(bb);
}
