/** Obrázok BGR (3 bajty na pixel) alebo jeden kanál (1 bajt na pixel), riadok po riadku. */
export type Obrazok = { sirka: number; vyska: number; data: Uint8Array };

/** [x0, y0, x1, y1) v pixeloch. */
export type Obdlznik = [number, number, number, number];

/** Zaokrúhlenie ako cvRound v OpenCV (polovica k párnemu číslu). */
export function zaokruhli(v: number): number {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function neparne(x: number): number {
  const r = zaokruhli(x);
  return r % 2 ? r : r + 1;
}

/** Index pixela za okrajom ako BORDER_REFLECT_101. */
export function odraz(p: number, dlzka: number): number {
  if (dlzka === 1) return 0;
  while (p < 0 || p >= dlzka) p = p < 0 ? -p : 2 * dlzka - 2 - p;
  return p;
}

export function vyrezObrazka(obr: Obrazok, [x0, y0, x1, y1]: Obdlznik): Obrazok {
  const sirka = x1 - x0;
  const vyska = y1 - y0;
  const data = new Uint8Array(sirka * vyska * 3);
  for (let y = 0; y < vyska; y++) {
    const z = ((y0 + y) * obr.sirka + x0) * 3;
    data.set(obr.data.subarray(z, z + sirka * 3), y * sirka * 3);
  }
  return { sirka, vyska, data };
}

/** Výrez z jednokanálového poľa so šírkou w. */
export function vyrez<T extends Uint8Array | Int32Array | Float32Array>(pole: T, w: number, [x0, y0, x1, y1]: Obdlznik): T {
  const sirka = x1 - x0;
  const out = new (pole.constructor as new (n: number) => T)(sirka * (y1 - y0));
  for (let y = y0; y < y1; y++) out.set(pole.subarray(y * w + x0, y * w + x1) as never, (y - y0) * sirka);
  return out;
}

/** Obdĺžnik okolo oblasti rozšírený o okraj a orezaný na obrázok. */
export function okolo(x0: number, y0: number, x1: number, y1: number, okraj: number, w: number, h: number): Obdlznik {
  return [Math.max(0, x0 - okraj), Math.max(0, y0 - okraj), Math.min(w, x1 + okraj), Math.min(h, y1 + okraj)];
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

/** Medián hodnôt zapísaných ako histogram (index = hodnota). */
export function medianHistogramu(hist: Int32Array, spolu: number): number {
  const hodnotaNa = (poradie: number) => {
    let videne = 0;
    for (let v = 0; v < hist.length; v++) {
      videne += hist[v];
      if (videne > poradie) return v;
    }
    return hist.length - 1;
  };
  const stred = (spolu - 1) >> 1;
  return spolu % 2 ? hodnotaNa(stred) : (hodnotaNa(stred) + hodnotaNa(stred + 1)) / 2;
}

/** np.median(obrazok[maska], axis=0) pre BGR, zaokrúhlené nadol. */
export function medianFarby(data: Uint8Array, maska: Uint8Array): [number, number, number] {
  const farba: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const hist = new Int32Array(256);
    let spolu = 0;
    for (let i = 0; i < maska.length; i++) {
      if (!maska[i]) continue;
      hist[data[3 * i + k]]++;
      spolu++;
    }
    farba[k] = Math.floor(medianHistogramu(hist, spolu));
  }
  return farba;
}

/** Pixely mimo masky prefarbí na danú farbu. */
export function vyplnMimo(data: Uint8Array, maska: Uint8Array, [b, g, r]: number[]): void {
  for (let i = 0; i < maska.length; i++) {
    if (maska[i]) continue;
    data[3 * i] = b;
    data[3 * i + 1] = g;
    data[3 * i + 2] = r;
  }
}
