import { zBase64 } from '../png';
import { JADRA_WASM } from './jadra.generated';

/** Funkcie z jadra.wat (adresy sú bajty v pamäti modulu). */
type Exporty = {
  pamat: WebAssembly.Memory;
  kombinuj(out: number, zdroj: number, n: number, max: number): void;
  riadky(zdroj: number, ciel: number, krok: number, riadok: number, h: number, ch: number, max: number): void;
  gauss_h(zdroj: number, medzi: number, mapa: number, buf: number, jadro: number, w: number, h: number, ch: number, r: number): void;
  gauss_v(medzi: number, out: number, riadky: number, jadro: number, riadok: number, h: number, r: number): void;
};

let jadra: Exporty | null = null;
let nacitanie: Promise<void> | null = null;

/** Načíta WebAssembly jadrá, ak prostredie podporuje WebAssembly so SIMD (inak ostanú JavaScript verzie). */
export function nacitajJadra(): Promise<void> {
  nacitanie ??= (async () => {
    try {
      if (typeof WebAssembly === 'undefined') return;
      const bajty = zBase64(JADRA_WASM);
      if (!WebAssembly.validate(bajty)) return;
      const { instance } = await WebAssembly.instantiate(bajty);
      jadra = instance.exports as unknown as Exporty;
    } catch {
      jadra = null;
    }
  })();
  return nacitanie;
}

export const wasmJadra = () => jadra;

/** Bloky v pamäti modulu: zaistí dosť pamäte a vráti adresy blokov (zarovnané na 16 bajtov). */
export function rozlozPamat(j: Exporty, velkosti: number[]): number[] {
  const adresy: number[] = [];
  let koniec = 16;
  for (const v of velkosti) {
    adresy.push(koniec);
    koniec += (v + 31) & ~15;
  }
  const chyba = koniec - j.pamat.buffer.byteLength;
  if (chyba > 0) j.pamat.grow(Math.ceil(chyba / 65536));
  return adresy;
}
