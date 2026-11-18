export type Poziadavka = { druh: 'obrazok'; png: string } | { druh: 'dokument'; png: string } | { druh: 'urci'; podklad: number };

type Spolocne = { sirka: number; vyska: number; profil?: string; maska: string; vyrez: string; podklad?: number };
export type VysledokObrazka = Spolocne;
export type VysledokDokumentu = Spolocne & { prehlad: string; miest: number; nasiel: boolean };

/** Jedna otázka kľúča na ceste k výsledku. */
export type KrokCesty = { otazka: string; popis: string; vysledok: string };

export type Urcenie = {
  skupina?: 'tmave' | 'svetle' | 'neiste';
  nazov: string;
  podskupina?: string;
  druhy: string[];
  druh?: string;
  cesta: KrokCesty[];
};

/** Určená škvrna: názov (Škvrna, Škvrna 2, ...), výsledok kľúča, obrázok čŕt a náhľad výrezu (PNG base64). */
export type Skvrna = { nazov: string; urcenie: Urcenie; obrazok?: string; nahlad?: string };

export type VysledokUrcenia = { skvrny: Skvrna[]; uspesnost?: number };

/** Výsledok skenu, ktorý si obrazovka Výsledok prevezme od obrazovky skenovania. */
export type VysledokSkenu = {
  rezim: 'obrazok' | 'dokument';
  obrazokUri: string | null;
  maskaUri: string | null;
  vyrezUri: string | null;
  skvrny: Skvrna[];
  uspesnostKluca?: number;
  profil: string | null;
  trvanie: number;
};

let vysledok: VysledokSkenu | null = null;
let novySken = false;

export const ulozVysledok = (v: VysledokSkenu) => (vysledok = v);
export const nacitajVysledok = () => vysledok;

/** Obrazovka Výsledok žiada o nový sken – skenovanie sa po návrate vynuluje. */
export const poziadajONovySken = () => (novySken = true);

export function prevezmiNovySken(): boolean {
  const ziadany = novySken;
  novySken = false;
  return ziadany;
}
