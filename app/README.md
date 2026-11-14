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

Výpočty bežia v skrytom WebView v Pyodide (Python s numpy, OpenCV a scikit-image skompilovaný
do WebAssembly). Maska škvrny aj škvrny na dokumentoch sa počítajú priamo Python súbormi
z `analyzy/` (`skvrny/maska.py`, `dokumenty/dokument*.py`) – aplikácia ich len zavolá.
Python a knižnice (desiatky MB) sa pri prvom spustení stiahnu z internetu, potom sú v cache.

Python súbory sa do WebView vkladajú pri zbalení, preto po každej zmene v `src/vypocty/`
alebo v `analyzy/` treba spustiť:

```
npm run build:worker
```

## Súbory

Obrazovky (`src/app/`) a ich časti (`src/komponenty/`):

| súbor | obsah |
|---|---|
| `app/index.tsx` | skenovanie – fotka, výber režimu, maska a spustenie určenia druhu |
| `app/vysledok.tsx` | výsledok – určený druh a črty škvrny |
| `app/_layout.tsx` | navigácia a skrytý WebView na výpočty |
| `komponenty/karta-skvrny.tsx` | výsledok jednej škvrny a cesta kľúčom |
| `komponenty/prepinac.tsx`, `vodidlo.tsx`, `ikona.tsx` | prepínač, rohy na zarovnanie vzorky, ikony |
| `vzhlad.ts` | farby a medzery |

Výpočty (`src/vypocty/`):

| súbor | obsah |
|---|---|
| `aplikacia.py` | prepojenie s analýzami: načítanie fotky, volanie `najdi_masku` a `spracuj_stranu`, obrázky na zobrazenie |
| `webview.tsx`, `webview-worker.ts` | skrytý WebView, načítanie Pyodide a súborov z `analyzy/`, výmena správ s aplikáciou |
| `zariadenie.ts` | príprava fotky (zmenšenie, PNG) a odoslanie výpočtu do WebView |
| `crty.ts`, `gabor.ts` | odhad papiera pod škvrnou a črty škvrny (farba, zóny, lem, LBP, textúra) |
| `kluc.ts`, `manualny-kluc.json` | určovací kľúč |
| `obrazok-crt.ts` | obrázok čŕt na obrazovke výsledku |
| `binarne.ts`, `filtre.ts`, `obrazok.ts`, `png.ts` | pomocné operácie pre črty (ako v OpenCV) a PNG |
| `vysledok-skenu.ts` | výsledok skenu medzi obrazovkami |
