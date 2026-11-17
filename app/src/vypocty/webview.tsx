import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { Poziadavka } from './webview-worker';
import { KOD_WORKERA } from './webview-worker.generated';

type Odpoved = { pripraveny?: boolean; chybaStartu?: string; id?: number; ok?: boolean; vysledok?: unknown; chyba?: string };
type Caka = { splnene: (vysledok: unknown) => void; zlyhalo: (chyba: Error) => void };

const CAKAT_NA_PYTHON = 180_000;

let webview: WebView | null = null;
let pripraveny = false;
let chybaStartu: string | null = null;
let poStarte: (() => void)[] = [];
let dalsieId = 1;
const cakajuce = new Map<number, Caka>();

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
  KOD_WORKERA.replace(/<\/script/gi, '<\\/script') +
  '</script></body></html>';

/** Či je Python vo WebView už načítaný (prvé načítanie trvá dlhšie). */
export const pythonPripraveny = () => pripraveny;

function zrusVsetky(sprava: string) {
  for (const c of cakajuce.values()) c.zlyhalo(new Error(sprava));
  cakajuce.clear();
}

function restartuj(view: WebView | null) {
  pripraveny = false;
  chybaStartu = null;
  zrusVsetky('Výpočet vo WebView bol prerušený (nedostatok pamäte?) – skús to znova.');
  view?.reload();
}

function naSpravu(event: WebViewMessageEvent) {
  let odpoved: Odpoved;
  try {
    odpoved = JSON.parse(event.nativeEvent.data);
  } catch {
    return;
  }
  if (odpoved.pripraveny || odpoved.chybaStartu) {
    pripraveny = !!odpoved.pripraveny;
    chybaStartu = odpoved.chybaStartu ?? null;
    for (const f of poStarte.splice(0)) f();
    return;
  }
  const caka = odpoved.id !== undefined ? cakajuce.get(odpoved.id) : undefined;
  if (!caka) return;
  cakajuce.delete(odpoved.id!);
  if (odpoved.ok) caka.splnene(odpoved.vysledok);
  else caka.zlyhalo(new Error(odpoved.chyba ?? 'Výpočet vo WebView zlyhal.'));
}

/** Skrytý WebView, v ktorom beží Python s analýzami (Pyodide). Načíta sa hneď pri štarte aplikácie. */
export function VypoctovyWebView() {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    webview = ref.current;
    return () => {
      webview = null;
      pripraveny = false;
      zrusVsetky('WebView sa zatvoril.');
    };
  }, []);
  return (
    <View style={styles.skryty} pointerEvents="none">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: HTML }}
        onMessage={naSpravu}
        javaScriptEnabled
        onContentProcessDidTerminate={() => restartuj(ref.current)}
        onRenderProcessGone={() => restartuj(ref.current)}
      />
    </View>
  );
}

/** Počká, kým sa vo WebView načíta Python; po chybe pri štarte ho skúsi načítať znova. */
async function pockajNaPython(): Promise<void> {
  if (chybaStartu) restartuj(webview);
  if (pripraveny) return;
  const stihol = await new Promise<boolean>((resolve) => {
    const casovac = setTimeout(() => resolve(false), CAKAT_NA_PYTHON);
    poStarte.push(() => {
      clearTimeout(casovac);
      resolve(true);
    });
  });
  if (chybaStartu) throw new Error(chybaStartu);
  if (!stihol) throw new Error('Python sa nenačítal včas – skontroluj internet a skús to znova.');
}

/** Pošle výpočet do WebView a vráti jeho výsledok. */
export async function vypocitajVoWebView<T>(poziadavka: Poziadavka): Promise<T> {
  if (!webview) throw new Error('Výpočtový WebView nie je spustený.');
  await pockajNaPython();
  const id = dalsieId++;
  return new Promise<T>((splnene, zlyhalo) => {
    cakajuce.set(id, { splnene: splnene as (vysledok: unknown) => void, zlyhalo });
    webview!.postMessage(JSON.stringify({ ...poziadavka, id }));
  });
}

const styles = StyleSheet.create({
  skryty: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
});
