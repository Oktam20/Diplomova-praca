import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { Skvrna } from './kluc';
import { zaokruhli } from './obrazok';
import { vypocitajVoWebView } from './webview';
import type { VysledokDokumentu, VysledokObrazka } from './webview-worker';

/** Dlhšia strana fotky: ako max_strana v najdi_masku a TLAC_STRANA v dokument_tlac.py. */
const STRANA_OBRAZKA = 1200;
const STRANA_DOKUMENTU = 3200;

export type Detekcia = {
  sprava: string | null;
  obrazokUri: string | null;
  maskaUri: string | null;
  vyrezUri: string | null;
  podklad: number | null;
  profil: string | null;
  trvanie: number;
};

/** Fotka zmenšená na dlhšiu stranu najviac `strana` px a uložená ako PNG. */
async function zmensenaFotka(uri: string, strana: number) {
  const povodna = await ImageManipulator.manipulate(uri).renderAsync();
  const f = Math.min(1, strana / Math.max(povodna.width, povodna.height));
  const kontext = ImageManipulator.manipulate(uri);
  if (f < 1) kontext.resize({ width: zaokruhli(povodna.width * f), height: zaokruhli(povodna.height * f) });
  const ulozena = await (await kontext.renderAsync()).saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!ulozena.base64) throw new Error('Nepodarilo sa načítať pixely obrázka.');
  return { base64: ulozena.base64, uri: ulozena.uri };
}

const dataUri = (png: string) => `data:image/png;base64,${png}`;
const sekundy = (od: number) => ((Date.now() - od) / 1000).toFixed(1);

/** Časy do terminálu Metro (npx expo start). */
function vypisCasy(rezim: string, v: { sirka: number; vyska: number }, zaciatok: number, nacitanie: string) {
  console.log(`${rezim} ${v.sirka}x${v.vyska}: ${nacitanie}, spolu ${sekundy(zaciatok)} s`);
}

/** Režim Obrázok: maska škvrny na detailnom zábere (skvrny/maska.py). */
export async function najdiNaObrazku(uri: string): Promise<Detekcia> {
  const zaciatok = Date.now();
  const fotka = await zmensenaFotka(uri, STRANA_OBRAZKA);
  const nacitanie = `načítanie ${sekundy(zaciatok)} s`;
  const v = await vypocitajVoWebView<VysledokObrazka>({ druh: 'obrazok', png: fotka.base64 });
  vypisCasy('Obrázok', v, zaciatok, nacitanie);
  return {
    sprava: null,
    obrazokUri: fotka.uri,
    maskaUri: dataUri(v.maska),
    vyrezUri: dataUri(v.vyrez),
    podklad: v.podklad,
    profil: v.profil,
    trvanie: Date.now() - zaciatok,
  };
}

/** Režim Dokument: škvrny na celej strane s textom (dokumenty/dokument.py). */
export async function najdiNaDokumente(uri: string): Promise<Detekcia> {
  const zaciatok = Date.now();
  const fotka = await zmensenaFotka(uri, STRANA_DOKUMENTU);
  const nacitanie = `načítanie ${sekundy(zaciatok)} s`;
  const v = await vypocitajVoWebView<VysledokDokumentu>({ druh: 'dokument', png: fotka.base64 });
  vypisCasy('Dokument', v, zaciatok, nacitanie);
  let sprava: string | null = null;
  if (v.miest === 0) sprava = 'Na stránke sa nenašli žiadne škvrny.';
  else if (!v.nasiel) sprava = 'Navrhnuté miesta sa našli, ale vlastný algoritmus v nich masku nenašiel.';
  return {
    sprava,
    obrazokUri: dataUri(v.prehlad),
    maskaUri: dataUri(v.maska),
    vyrezUri: dataUri(v.vyrez),
    podklad: v.podklad,
    profil: v.profil,
    trvanie: Date.now() - zaciatok,
  };
}

/** Určí druh každej nájdenej škvrny (črty a kľúč bežia vo WebView pri podklade zo skenu). */
export function urciDruh(podklad: number): Promise<Skvrna[]> {
  return vypocitajVoWebView<Skvrna[]>({ druh: 'urci', podklad });
}
