import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { Skvrna } from './kluc';
import { zaokruhli } from './obrazok';
import { spracuj, type Poziadavka, type VysledokDokumentu, type VysledokObrazka } from './postup';
import { vypocitajVoWebView } from './webview';

const STRANA_OBRAZKA = 1200;
const STRANA_DOKUMENTU = 1600;
const STRANA_TLACE = 2400;

/** Kde ostal podklad na určenie druhu (WebView alebo aplikácia). */
export type Podklad = { cislo: number; voWebView: boolean };

export type Detekcia = {
  sprava: string | null;
  obrazokUri: string | null;
  maskaUri: string | null;
  vyrezUri: string | null;
  podklad: Podklad | null;
  profil: string | null;
  trvanie: number;
};

/** Výpočet vo WebView; ak nie je k dispozícii, ten istý kód priamo v aplikácii. */
async function vypocitaj<T>(poziadavka: Poziadavka): Promise<{ vysledok: T; voWebView: boolean }> {
  const vysledok = await vypocitajVoWebView<T>(poziadavka);
  if (vysledok !== null) return { vysledok, voWebView: true };
  return { vysledok: (await spracuj(poziadavka)) as T, voWebView: false };
}

/** Fotka zmenšená na dlhšiu stranu najviac `strana` px a uložená ako PNG. */
async function zmensenaFotka(uri: string, sirka: number, vyska: number, strana: number) {
  const f = Math.min(1, strana / Math.max(sirka, vyska));
  const kontext = ImageManipulator.manipulate(uri);
  if (f < 1) kontext.resize({ width: zaokruhli(sirka * f), height: zaokruhli(vyska * f) });
  const ulozena = await (await kontext.renderAsync()).saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!ulozena.base64) throw new Error('Nepodarilo sa načítať pixely obrázka.');
  return { base64: ulozena.base64, uri: ulozena.uri };
}

const dataUri = (png: string | null) => (png ? `data:image/png;base64,${png}` : null);
const sekundy = (od: number) => ((Date.now() - od) / 1000).toFixed(1);

/** Časy fáz do terminálu Metro (npx expo start). */
function vypisCasy(rezim: string, voWebView: boolean, v: { sirka: number; vyska: number; casy: string[] }, zaciatok: number, nacitanie: string) {
  const casy = [nacitanie, ...v.casy, `spolu ${sekundy(zaciatok)} s`].join(', ');
  console.log(`${rezim} (${voWebView ? 'WebView' : 'Hermes'}) ${v.sirka}x${v.vyska}: ${casy}`);
}

/** Režim Obrázok: maska škvrny na detailnom zábere. */
export async function najdiNaObrazku(uri: string): Promise<Detekcia> {
  const zaciatok = Date.now();
  const povodna = await ImageManipulator.manipulate(uri).renderAsync();
  const fotka = await zmensenaFotka(uri, povodna.width, povodna.height, STRANA_OBRAZKA);
  const nacitanie = `načítanie ${sekundy(zaciatok)} s`;
  const { vysledok: v, voWebView } = await vypocitaj<VysledokObrazka>({ druh: 'obrazok', png: fotka.base64 });
  vypisCasy('Obrázok', voWebView, v, zaciatok, nacitanie);
  return {
    sprava: v.sprava,
    obrazokUri: fotka.uri,
    maskaUri: dataUri(v.maska),
    vyrezUri: dataUri(v.vyrez),
    podklad: v.podklad !== null ? { cislo: v.podklad, voWebView } : null,
    profil: v.profil,
    trvanie: Date.now() - zaciatok,
  };
}

/** Režim Dokument: škvrny na celej strane s textom. */
export async function najdiNaDokumente(uri: string): Promise<Detekcia> {
  const zaciatok = Date.now();
  const povodna = await ImageManipulator.manipulate(uri).renderAsync();
  const dlhsia = Math.max(povodna.width, povodna.height);
  const zmensena = async (strana: number) => (await zmensenaFotka(uri, povodna.width, povodna.height, strana)).base64;
  const praca = await zmensena(STRANA_DOKUMENTU);
  const ilustracie = dlhsia > STRANA_DOKUMENTU ? await zmensena(STRANA_TLACE) : null;
  const nacitanie = `načítanie ${sekundy(zaciatok)} s`;
  const { vysledok: v, voWebView } = await vypocitaj<VysledokDokumentu>({ druh: 'dokument', praca, ilustracie });
  vypisCasy('Dokument', voWebView, v, zaciatok, nacitanie);

  let sprava: string | null = null;
  if (v.okien === 0) sprava = 'Na stránke sa nenašli žiadne škvrny.';
  else if (!v.nasiel) sprava = 'Navrhnuté miesta sa našli, ale vlastný algoritmus v nich masku nenašiel.';
  else if (v.casVyprsal) sprava = `Časový limit – spracovaných ${v.spracovanych} z ${v.okien} miest.`;
  return {
    sprava,
    obrazokUri: dataUri(v.prehlad),
    maskaUri: dataUri(v.maska),
    vyrezUri: dataUri(v.vyrez),
    podklad: v.podklad !== null ? { cislo: v.podklad, voWebView } : null,
    profil: v.profil,
    trvanie: Date.now() - zaciatok,
  };
}

/** Určí druh každej nájdenej škvrny – tam, kde sa počítala maska. */
export async function urciDruh(podklad: Podklad): Promise<Skvrna[]> {
  const poziadavka: Poziadavka = { druh: 'urci', podklad: podklad.cislo };
  if (!podklad.voWebView) return (await spracuj(poziadavka)) as Skvrna[];
  const skvrny = await vypocitajVoWebView<Skvrna[]>(poziadavka);
  if (skvrny === null) throw new Error('Výpočet vo WebView nie je k dispozícii – naskenuj vzorku znova.');
  return skvrny;
}
