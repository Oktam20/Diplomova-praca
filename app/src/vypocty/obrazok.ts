/** Obrázok BGR (3 bajty na pixel) alebo jeden kanál (1 bajt na pixel), riadok po riadku. */
export type Obrazok = { sirka: number; vyska: number; data: Uint8Array };

/** Zaokrúhlenie ako cvRound v OpenCV (polovica k párnemu číslu). */
export function zaokruhli(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Index pixela za okrajom ako BORDER_REFLECT_101. */
export function odraz(p: number, dlzka: number): number {
  if (dlzka === 1) return 0;
  while (p < 0 || p >= dlzka) p = p < 0 ? -p : 2 * dlzka - 2 - p;
  return p;
}

/** np.percentile (lineárna interpolácia). */
export function percentil(hodnoty: ArrayLike<number>, q: number): number {
  const n = hodnoty.length;
  if (n === 0) return NaN;
  const v = Float64Array.from(hodnoty).sort();
  const index = (q / 100) * (n - 1);
  const dole = Math.floor(index);
  const hore = Math.min(dole + 1, n - 1);
  return v[dole] + (v[hore] - v[dole]) * (index - dole);
}

export function median(hodnoty: ArrayLike<number>): number {
  return percentil(hodnoty, 50);
}
