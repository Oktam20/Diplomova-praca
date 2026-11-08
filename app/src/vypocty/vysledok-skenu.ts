import type { Skvrna } from './kluc';

/** Výsledok skenu, ktorý si obrazovka Výsledok prevezme od obrazovky skenovania. */
export type VysledokSkenu = {
  rezim: 'obrazok' | 'dokument';
  obrazokUri: string | null;
  maskaUri: string | null;
  vyrezUri: string | null;
  skvrny: Skvrna[];
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
