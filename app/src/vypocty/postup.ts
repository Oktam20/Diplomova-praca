import { JAZYKY, type Jazyk } from '../preklady';
import { jeNieco } from './binarne';
import { CasVyprsal, stopky, teraz } from './cas';
import { spracujStranu, type Vyrez } from './dokument';
import { zmenNajblizsi } from './filtre';
import { OVERENIE_KLUCA, urciFotku, urciVyrezy, type Skvrna } from './kluc';
import { najdiMasku, vyrezMaskou } from './maska';
import type { Obrazok } from './obrazok';
import { naBase64, nacitajPng, pngFarebny, pngSivy, zBase64 } from './png';

/** Časový limit výpočtu v sekundách. */
export const CAS_OBRAZOK = 90;
const CAS_DOKUMENT = 120;

/** Požiadavka na výpočet – obrázky ako PNG v base64. */
export type Poziadavka =
  | { druh: 'obrazok'; png: string }
  | { druh: 'dokument'; praca: string; ilustracie: string | null }
  | { druh: 'urci'; podklad: number; jazyk: Jazyk };

type Spolocne = { sirka: number; vyska: number; profil: string | null; casy: string[]; podklad: number | null };

export type VysledokObrazka = Spolocne & { casVyprsal: boolean; maska: string | null; vyrez: string | null };

export type VysledokDokumentu = Spolocne & {
  prehlad: string;
  maska: string;
  vyrez: string;
  nasiel: boolean;
  okien: number;
  spracovanych: number;
  casVyprsal: boolean;
};

export type VysledokUrcenia = { skvrny: Skvrna[]; overenie: number };

/** Podklad pre určenie druhu ostáva tam, kde sa počítala maska (posledné tri skeny). */
type Podklad = { obrazok: Obrazok; maska: Uint8Array } | { vyrezy: Vyrez[] };
const podklady = new Map<number, Podklad>();
let dalsiPodklad = 1;

function uloz(podklad: Podklad): number {
  const cislo = dalsiPodklad++;
  podklady.set(cislo, podklad);
  while (podklady.size > 3) podklady.delete(podklady.keys().next().value!);
  return cislo;
}

const nacitaj = (png: string) => nacitajPng(zBase64(png));

async function obrazok(png: string): Promise<VysledokObrazka> {
  const { casy, kolo } = stopky();
  const obr = nacitaj(png);
  kolo('dekódovanie');
  const { sirka, vyska } = obr;
  const zaklad = { sirka, vyska, profil: obr.profil, casy };
  try {
    const maska = await najdiMasku(obr, teraz() + CAS_OBRAZOK);
    kolo('maska');
    return {
      ...zaklad,
      casVyprsal: false,
      maska: naBase64(pngSivy({ sirka, vyska, data: maska })),
      vyrez: naBase64(pngFarebny(vyrezMaskou(maska, obr), 1)),
      podklad: uloz({ obrazok: obr, maska }),
    };
  } catch (chyba) {
    if (!(chyba instanceof CasVyprsal)) throw chyba;
    return { ...zaklad, casVyprsal: true, maska: null, vyrez: null, podklad: null };
  }
}

async function dokument(pracovny: string, sIlustraciami: string | null): Promise<VysledokDokumentu> {
  const { casy, kolo } = stopky();
  const praca = nacitaj(pracovny);
  const ilustracie = sIlustraciami ? nacitaj(sIlustraciami) : null;
  kolo('dekódovanie');
  const { sirka, vyska } = praca;
  const s = await spracujStranu(praca, ilustracie, teraz() + CAS_DOKUMENT, kolo);
  const maska = Uint8Array.from(s.maska, (v) => (v ? 255 : 0));
  const nasiel = jeNieco(s.maska);
  const { povodna } = s;
  const maskaPovodnej = zmenNajblizsi(maska, 1, sirka, vyska, povodna.sirka, povodna.vyska);
  const vysledok = {
    sirka,
    vyska,
    profil: praca.profil,
    casy,
    prehlad: naBase64(pngFarebny(s.prehlad, 1)),
    maska: naBase64(pngSivy({ sirka, vyska, data: maska })),
    vyrez: naBase64(pngFarebny(vyrezMaskou(maskaPovodnej, povodna), 1)),
    nasiel,
    okien: s.okien,
    spracovanych: s.spracovanych,
    casVyprsal: s.casVyprsal,
    podklad: nasiel ? uloz({ vyrezy: s.vyrezy }) : null,
  };
  kolo('výrezy a obrázky');
  return vysledok;
}

function urci(cislo: number, jazyk: Jazyk): VysledokUrcenia {
  const podklad = podklady.get(cislo);
  if (!podklad) throw new Error((JAZYKY[jazyk] ?? JAZYKY.sk).chyby.podklad);
  const skvrny = 'vyrezy' in podklad ? urciVyrezy(podklad.vyrezy) : urciFotku(podklad.obrazok, podklad.maska);
  return { skvrny, overenie: OVERENIE_KLUCA };
}

/** Výsledok podľa druhu požiadavky: VysledokObrazka, VysledokDokumentu alebo VysledokUrcenia. */
export async function spracuj(p: Poziadavka): Promise<unknown> {
  if (p.druh === 'obrazok') return obrazok(p.png);
  if (p.druh === 'dokument') return dokument(p.praca, p.ilustracie);
  return urci(p.podklad, p.jazyk);
}
