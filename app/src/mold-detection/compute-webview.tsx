import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { WORKER_JS } from './webview-worker.generated';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

let webview: WebView | null = null;
let ready = false;
let readyWaiters: (() => void)[] = [];
let nextId = 1;
const pending = new Map<number, Pending>();

const HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
  WORKER_JS.replace(/<\/script/gi, '<\\/script') +
  '</script></body></html>';

function rejectAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function restart(view: WebView | null) {
  ready = false;
  rejectAll('Výpočet vo WebView bol prerušený (nedostatok pamäte?) – skús to znova.');
  view?.reload();
}

function onMessage(event: WebViewMessageEvent) {
  let message: { ready?: boolean; id?: number; ok?: boolean; res?: unknown; error?: string };
  try {
    message = JSON.parse(event.nativeEvent.data);
  } catch {
    return;
  }
  if (message.ready) {
    ready = true;
    for (const f of readyWaiters.splice(0)) f();
    return;
  }
  const p = message.id !== undefined ? pending.get(message.id) : undefined;
  if (!p) return;
  pending.delete(message.id!);
  if (message.ok) p.resolve(message.res);
  else p.reject(new Error(message.error ?? 'Výpočet vo WebView zlyhal.'));
}

export function ComputeWebView() {
  const ref = useRef<WebView>(null);
  useEffect(() => {
    webview = ref.current;
    return () => {
      webview = null;
      ready = false;
      rejectAll('WebView sa zatvoril.');
    };
  }, []);
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        onContentProcessDidTerminate={() => restart(ref.current)}
        onRenderProcessGone={() => restart(ref.current)}
      />
    </View>
  );
}

/** Pošle výpočet do WebView a vráti výsledok. */
export async function computeInWebView<T>(request: object, waitMs = 3000): Promise<T | null> {
  if (!webview) return null;
  if (!ready) {
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), waitMs);
      readyWaiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!ok || !webview) return null;
  }
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    webview!.postMessage(JSON.stringify({ ...request, id }));
  });
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 },
});
