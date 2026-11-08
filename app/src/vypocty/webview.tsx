import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { Poziadavka } from './postup';
import { KOD_WORKERA } from './webview-worker.generated';

type Odpoved = { pripraveny?: boolean; id?: number; ok?: boolean; vysledok?: unknown; chyba?: string };
type Caka = { splnene: (vysledok: unknown) => void; zlyhalo: (chyba: Error) => void };

let webview: WebView | null = null;
let pripraveny = false;
let poPriprave: (() => void)[] = [];
let dalsieId = 1;
const cakajuce = new Map<number, Caka>();

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
  KOD_WORKERA.replace(/<\/script/gi, '<\\/script') +
  '</script></body></html>';

function zrusVsetky(sprava: string) {
  for (const c of cakajuce.values()) c.zlyhalo(new Error(sprava));
  cakajuce.clear();
}

function restartuj(view: WebView | null) {
  pripraveny = false;
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
  if (odpoved.pripraveny) {
    pripraveny = true;
    for (const f of poPriprave.splice(0)) f();
    return;
  }
  const caka = odpoved.id !== undefined ? cakajuce.get(odpoved.id) : undefined;
  if (!caka) return;
  cakajuce.delete(odpoved.id!);
  if (odpoved.ok) caka.splnene(odpoved.vysledok);
  else caka.zlyhalo(new Error(odpoved.chyba ?? 'Výpočet vo WebView zlyhal.'));
}

/** Skrytý WebView, v ktorom bežia výpočty (JavaScript s JIT je niekoľkonásobne rýchlejší ako Hermes). */
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

/** Pošle výpočet do WebView; null, ak WebView nie je do `cakat` ms pripravený. */
export async function vypocitajVoWebView<T>(poziadavka: Poziadavka, cakat = 3000): Promise<T | null> {
  if (!webview) return null;
  if (!pripraveny) {
    const stihol = await new Promise<boolean>((resolve) => {
      const casovac = setTimeout(() => resolve(false), cakat);
      poPriprave.push(() => {
        clearTimeout(casovac);
        resolve(true);
      });
    });
    if (!stihol || !webview) return null;
  }
  const id = dalsieId++;
  return new Promise<T>((splnene, zlyhalo) => {
    cakajuce.set(id, { splnene: splnene as (vysledok: unknown) => void, zlyhalo });
    webview!.postMessage(JSON.stringify({ ...poziadavka, id }));
  });
}

const styles = StyleSheet.create({
  skryty: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
});
