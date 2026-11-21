import {
  bityPodlaTabulky,
  dlzkaObrysu,
  elipsa,
  maskaOblasti,
  obrys,
  oznacOblasti,
  plochaObrysu,
  rozsir,
  vyplnDiery,
  zuz,
  type Bity,
  type Oblasti,
} from './binarne';
import { prestavka, skontrolujCas } from './cas';
import { gauss5, vzdialenostNaDruhu } from './filtre';
import { farebneKanaly } from './kanaly';
import { zaokruhli, type Obrazok } from './obrazok';
import { histogram, METODY } from './prahy';

export const PROFIL = {
  kanaly: ['HSV_S', 'Lab_a', 'XYZ_X', 'YUV_U'],
  metody: ['Yen', 'Isodata', 'Minimum'],
};

const POKRYTIE = [0.02, 0.9];
const VAHA_KONTRASTU = 0.3;
const JADRO = elipsa(9);

type Smer = 'pod' | 'nad';

/** Vyčistená maska: oblasti po vyplnení dier a ktoré z nich ostali (`ponechat`). */
export type Vycistena = { vyplnena: Bity; oblasti: Oblasti; ponechat: Uint8Array; plocha: number };

export type Kandidat = { kanal: string; metoda: string; smer: Smer; maska: Vycistena; rozmazany: Obrazok };

/** Celočíselný prah pre 8-bitový kanál (null pri neplatnom prahu). */
function celyPrah(prah: number, smer: Smer): number | null {
  if (!Number.isFinite(prah)) return null;
  const cely = smer === 'pod' ? Math.ceil(prah) - 1 : Math.floor(prah);
  return Math.min(Math.max(cely, -1), 255);
}

function prahuj(kanal: Obrazok, prah: number, smer: Smer) {
  const cely = celyPrah(prah, smer);
  const tabulka = Uint8Array.from({ length: 256 }, (_, v) => {
    if (cely === null) return (smer === 'pod' ? v < prah : v > prah) ? 1 : 0;
    return (smer === 'pod' ? v <= cely : v > cely) ? 1 : 0;
  });
  return bityPodlaTabulky(kanal.data, kanal.sirka, kanal.vyska, tabulka);
}

/** Uzavretie a otvorenie, vyplnenie dier a vyradenie malých oblastí a oblastí pri okraji. */
function vycisti(surova: Bity): Vycistena {
  const vyplnena = vyplnDiery(rozsir(zuz(zuz(rozsir(surova, JADRO), JADRO), JADRO), JADRO));
  const oblasti = oznacOblasti(vyplnena);
  const { sirka: w, vyska: h } = vyplnena;
  const minPlocha = Math.max(150, Math.trunc(0.002 * h * w));
  const ponechat = new Uint8Array(oblasti.pocet + 1);
  let plocha = 0;
  for (let c = 1; c <= oblasti.pocet; c++) {
    const priOkraji = oblasti.minX[c] <= 0 || oblasti.minY[c] <= 0 || oblasti.maxX[c] + 1 >= w || oblasti.maxY[c] + 1 >= h;
    if (oblasti.plocha[c] < minPlocha || priOkraji) continue;
    ponechat[c] = 1;
    plocha += oblasti.plocha[c];
  }
  return { vyplnena, oblasti, ponechat, plocha };
}

/** Rozdiel jasu masky a lemu okolo nej voči rozptylu lemu. */
function kontrast({ oblasti, ponechat, plocha }: Vycistena, kanal: Obrazok): number {
  if (plocha === 0) return 0;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -1, -1];
  for (let c = 1; c <= oblasti.pocet; c++) {
    if (!ponechat[c]) continue;
    minX = Math.min(minX, oblasti.minX[c]);
    minY = Math.min(minY, oblasti.minY[c]);
    maxX = Math.max(maxX, oblasti.maxX[c]);
    maxY = Math.max(maxY, oblasti.maxY[c]);
  }
  const { sirka: W, vyska: H, data } = kanal;
  const polomer = Math.max(3, zaokruhli(0.15 * Math.sqrt(plocha / Math.PI)));
  const x0 = Math.max(0, minX - polomer - 1);
  const y0 = Math.max(0, minY - polomer - 1);
  const w = Math.min(W, maxX + polomer + 2) - x0;
  const h = Math.min(H, maxY + polomer + 2) - y0;
  const vonku = new Uint8Array(w * h).fill(1);
  const { useky } = oblasti;
  for (let y = y0; y < y0 + h; y++) {
    for (let i = useky.zaciatok[y]; i < useky.zaciatok[y + 1]; i++) {
      if (!ponechat[oblasti.cisloUseku[i]]) continue;
      const od = Math.max(useky.od[i], x0);
      const po = Math.min(useky.po[i], x0 + w - 1);
      if (od <= po) vonku.fill(0, (y - y0) * w + od - x0, (y - y0) * w + po - x0 + 1);
    }
  }
  const vzdialenost = vzdialenostNaDruhu(vonku, w, h);
  let [sucetVnutri, vnutri, sucetLemu, sucetLemu2, lem] = [0, 0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[(y0 + y) * W + x0 + x];
      if (!vonku[y * w + x]) {
        sucetVnutri += v;
        vnutri++;
      } else if (vzdialenost[y * w + x] <= polomer * polomer) {
        sucetLemu += v;
        sucetLemu2 += v * v;
        lem++;
      }
    }
  }
  if (lem === 0 || vnutri === 0) return 0;
  const priemerLemu = sucetLemu / lem;
  const odchylka = Math.sqrt(Math.max(0, sucetLemu2 / lem - priemerLemu * priemerLemu));
  return Math.abs(sucetVnutri / vnutri - priemerLemu) / (odchylka + 1);
}

/** Skóre masky: kruhovitosť + pokrytie − počet oblastí + kontrast s okolím. */
export function skore(maska: Vycistena, kanal: Obrazok): number {
  const { vyplnena, oblasti, ponechat, plocha } = maska;
  const pokrytie = plocha / (vyplnena.sirka * vyplnena.vyska);
  if (pokrytie <= 0) return -Infinity;
  let kruhovitost = 0;
  let plochy = 0;
  let pocet = 0;
  for (let c = 1; c <= oblasti.pocet; c++) {
    if (!ponechat[c]) continue;
    const body = obrys(vyplnena, oblasti.prvyX[c], oblasti.prvyY[c]);
    const p = plochaObrysu(body);
    const obvod = dlzkaObrysu(body);
    if (p <= 0 || obvod <= 0) continue;
    kruhovitost += Math.min((4 * Math.PI * p) / (obvod * obvod), 1.0) * p;
    plochy += p;
    pocet++;
  }
  if (pocet === 0) return -Infinity;

  const [najmenej, najviac] = POKRYTIE;
  const stred = (najmenej + najviac) / 2;
  const bonus = najmenej <= pokrytie && pokrytie <= najviac ? 0.3 : -Math.min(Math.abs(pokrytie - stred) / stred, 1.0);
  const penalizacia = Math.max(0, pocet - 6) * 0.04;
  return kruhovitost / plochy + bonus - penalizacia + VAHA_KONTRASTU * Math.log1p(kontrast(maska, kanal));
}

const rovnake = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Všetky kandidátne masky: kanál × metóda × smer prahu (rovnaké kanály a prahy sa preskočia). */
export function* kandidati(obr: Obrazok, koniec: number): Generator<Kandidat> {
  const pixelov = obr.sirka * obr.vyska;
  const videne: Uint8Array[] = [];
  for (const [kanal, surovy] of farebneKanaly(obr, PROFIL.kanaly)) {
    const rozmazany = gauss5(surovy);
    if (videne.some((d) => rovnake(d, rozmazany.data))) continue;
    videne.push(rozmazany.data);
    const hist = histogram(rozmazany.data);
    const pouzite = new Set<string>();
    for (const [metoda, vypocet] of METODY) {
      if (!PROFIL.metody.includes(metoda)) continue;
      const prah = vypocet(hist);
      if (prah === null) continue;
      for (const smer of ['pod', 'nad'] as const) {
        skontrolujCas(koniec);
        const cely = celyPrah(prah, smer);
        if (cely !== null) {
          if (pouzite.has(`${smer}${cely}`)) continue;
          pouzite.add(`${smer}${cely}`);
        }
        const { bity, pocet } = prahuj(rozmazany, prah, smer);
        if (pocet === 0 || pocet === pixelov) continue;
        yield { kanal, metoda, smer, maska: vycisti(bity), rozmazany };
      }
    }
  }
}

/** Maska škvrny (0/255) na fotke jednej škvrny – kandidát s najvyšším skóre. */
export async function najdiMasku(obr: Obrazok, koniec: number): Promise<Uint8Array> {
  let najlepsi: Vycistena | null = null;
  let najlepsieSkore = -Infinity;
  for (const kandidat of kandidati(obr, koniec)) {
    await prestavka();
    const s = skore(kandidat.maska, kandidat.rozmazany);
    if (s > najlepsieSkore) {
      najlepsieSkore = s;
      najlepsi = kandidat.maska;
    }
  }
  const { sirka: w, vyska: h } = obr;
  return najlepsi ? maskaOblasti(najlepsi.oblasti, w, h, najlepsi.ponechat) : new Uint8Array(w * h);
}

/** Pixely obrázka pod maskou, zvyšok čierny. */
export function vyrezMaskou(maska: Uint8Array, obr: Obrazok): Obrazok {
  const data = new Uint8Array(obr.data.length);
  for (let i = 0; i < maska.length; i++) if (maska[i]) data.set(obr.data.subarray(3 * i, 3 * i + 3), 3 * i);
  return { sirka: obr.sirka, vyska: obr.vyska, data };
}
