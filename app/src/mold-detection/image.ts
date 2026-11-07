/** 8-bitový jednokanálový obrázok (riadok po riadku) – obdoba 2D uint8 numpy poľa. */
export type GrayImage = { width: number; height: number; data: Uint8Array };

/** 8-bitový trojkanálový obrázok v poradí BGR ako v OpenCV (prekladané kanály). */
export type BgrImage = { width: number; height: number; data: Uint8Array };

/** Zaokrúhlenie ako OpenCV cvRound / saturate_cast<int> (polovice k párnemu číslu). */
export function cvRound(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Výrez [y0, y1) x [x0, x1) – obdoba image[y0:y1, x0:x1] (kópia). */
export function cropBgr(img: BgrImage, x0: number, y0: number, x1: number, y1: number): BgrImage {
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * img.width + x0) * 3;
    data.set(img.data.subarray(src, src + width * 3), y * width * 3);
  }
  return { width, height, data };
}

/** Index pixela pri okraji BORDER_REFLECT_101 (predvolený okraj OpenCV filtrov). */
export function reflect101(p: number, len: number): number {
  if (len === 1) return 0;
  while (p < 0 || p >= len) p = p < 0 ? -p : 2 * len - 2 - p;
  return p;
}
