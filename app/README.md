# Aplikácia

Mobilná aplikácia (Expo, React Native), ktorá odfotí škvrnu, nájde jej masku a určí druh
plesne alebo baktérie. Všetko sa počíta priamo v mobile, bez servera.

Režimy:

| režim | vstup |
|---|---|
| **Obrázok** | detailný záber jednej škvrny |
| **Dokument** | strana s textom – odstráni sa text, nájdu sa škvrny a vyrežú sa |

## Spustenie

```
npm install
npx expo start
```

Aplikácia sa otvorí v Expo Go na mobile (naskenovaním QR kódu).

Výpočty bežia v skrytom WebView (JavaScript s JIT je niekoľkonásobne rýchlejší ako Hermes).
WebView spúšťa zbalený kód zo `src/mold-detection/webview-worker.generated.ts`, preto po každej
zmene v `src/mold-detection/` treba spustiť:

```
npm run build:worker
```

## Súbory

Obrazovky (`src/app/`):

| súbor | obsah |
|---|---|
| `index.tsx` | skenovanie – fotka, výber režimu, maska a spustenie klasifikácie |
| `vysledok.tsx` | výsledok – určený druh a črty škvrny |
| `_layout.tsx` | navigácia a skrytý WebView na výpočty |

Výpočty (`src/mold-detection/`):

| súbor | obsah | v analýzach |
|---|---|---|
| `mold-detection.ts` | hľadanie masky škvrny (kanály × metódy × smer prahu, skóre) | `analyzy/skvrny/maska.py` |
| `color.ts`, `thresholds.ts` | farebné kanály a metódy prahovania | `maska.py` |
| `document-stains.ts` | dokument: odstránenie textu, mapa tlače, návrh miest, výrezy | `analyzy/dokumenty/dokument_tlac.py`, `dokument_miesta.py` |
| `document-mold.ts` | dokument: maska v okne okolo navrhnutého miesta | `analyzy/dokumenty/dokument.py` |
| `manual-key.ts`, `manualny-kluc.json` | črty škvrny a určovací kľúč | – |
| `gabor.ts` | Gaborov filter (textúra stredu škvrny) | – |
| `spot-figure.ts` | obrázok čŕt na obrazovke výsledku | – |
| `pipelines.ts`, `document-pipeline.ts` | celý postup režimov Obrázok a Dokument | – |
| `device.ts` | príprava fotky a odoslanie výpočtu do WebView | – |
| `compute-webview.tsx`, `webview-worker.ts` | skrytý WebView a kód, ktorý v ňom beží | – |
| `binary.ts`, `raster.ts`, `blur.ts`, `geometry.ts` | operácie s obrázkami a maskami (ako v OpenCV) | – |
| `image.ts`, `png.ts` | typy obrázkov, kódovanie PNG | – |
| `result-store.ts`, `yield.ts` | výsledok medzi obrazovkami, prestávky výpočtu | – |
