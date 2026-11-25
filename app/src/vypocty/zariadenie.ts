import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { aktualneTexty, aktualnyJazyk } from '@/jazyk';

import { zaokruhli } from './obrazok';
import { CAS_OBRAZOK, spracuj, type Poziadavka, type VysledokDokumentu, type VysledokObrazka, type VysledokUrcenia } from './postup';
import { vypocitajVoWebView } from './webview';

/** Dlhšia strana fotky: ako max_strana v najdi_masku a TLAC_STRANA v dokumenty/dokument_tlac.py (pracovnú stranu 1600 px si zmenší postup.ts). */
const STRANA_OBRAZKA = 1200;
const STRANA_DOKUMENTU = 2400;

/** Kde ostal podklad na určenie druhu (WebView alebo aplikácia). */
export type Podklad = { cislo: number; voWebView: boolean };

/** Upozornenie po hľadaní masky – text podľa jazyka sa doplní až pri zobrazení. */
export type SpravaDetekcie =
  | { druh: 'ziadneMiesta' }
  | { druh: 'bezMasky' }
  | { druh: 'casDokumentu'; spracovanych: number; okien: number }
  | { druh: 'casObrazka'; sekund: number };

export type Detekcia = {
  sprava: SpravaDetekcie | null;
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
  if (!ulozena.base64) throw new Error(aktualneTexty().chyby.pixely);
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
    sprava: v.casVyprsal ? { druh: 'casObrazka', sekund: CAS_OBRAZOK } : null,
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
  const fotka = await zmensenaFotka(uri, povodna.width, povodna.height, STRANA_DOKUMENTU);
  const nacitanie = `načítanie ${sekundy(zaciatok)} s`;
  const { vysledok: v, voWebView } = await vypocitaj<VysledokDokumentu>({ druh: 'dokument', png: fotka.base64 });
  vypisCasy('Dokument', voWebView, v, zaciatok, nacitanie);

  let sprava: SpravaDetekcie | null = null;
  if (v.okien === 0) sprava = { druh: 'ziadneMiesta' };
  else if (!v.nasiel) sprava = { druh: 'bezMasky' };
  else if (v.casVyprsal) sprava = { druh: 'casDokumentu', spracovanych: v.spracovanych, okien: v.okien };
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
export async function urciDruh(podklad: Podklad): Promise<VysledokUrcenia> {
  const zaciatok = Date.now();
  const poziadavka: Poziadavka = { druh: 'urci', podklad: podklad.cislo, jazyk: aktualnyJazyk() };
  const v = podklad.voWebView ? await vypocitajVoWebView<VysledokUrcenia>(poziadavka) : ((await spracuj(poziadavka)) as VysledokUrcenia);
  if (v === null) throw new Error(aktualneTexty().chyby.webviewNedostupny);
  console.log(`Určenie druhu: ${v.skvrny.length} škvŕn, ${sekundy(zaciatok)} s`);
  return v;
}
