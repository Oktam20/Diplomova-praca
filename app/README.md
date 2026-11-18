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
do WebAssembly). Maska škvrny, škvrny na dokumentoch aj určenie druhu kľúčom sa počítajú Python
súbormi z `python/` – kópiou `analyzy/` s rovnakými funkciami (pozri [python/README.md](python/README.md)).
Python a knižnice (desiatky MB) sa pri prvom spustení stiahnu z internetu, potom sú v cache.

Python súbory sa do WebView vkladajú pri zbalení, preto po každej zmene v `src/vypocty/`
alebo v `python/` treba spustiť:

```
npm run build:worker
```

## Súbory

Obrazovky (`src/app/`) a ich časti (`src/komponenty/`):

| súbor | obsah |
|---|---|
| `app/index.tsx` | skenovanie – fotka, výber režimu, maska a spustenie určenia druhu |
| `app/vysledok.tsx` | výsledok – určený druh a črty škvrny; pri viacerých škvrnách zoznam a prepínač |
| `app/_layout.tsx` | navigácia a skrytý WebView na výpočty |
| `komponenty/karta-skvrny.tsx` | výsledok jednej škvrny a cesta kľúčom |
| `komponenty/zoznam-skvrn.tsx` | zoznam všetkých škvŕn: náhľad výrezu, názov a určený druh |
| `komponenty/prepinac-skvrn.tsx` | karty škvŕn po jednej – šípky alebo potiahnutie do strany |
| `komponenty/prepinac.tsx`, `vodidlo.tsx`, `ikona.tsx` | prepínač, rohy na zarovnanie vzorky, ikony |
| `vzhlad.ts` | farby a medzery |

Výpočty (`src/vypocty/`):

| súbor | obsah |
|---|---|
| `webview.tsx`, `webview-worker.ts` | skrytý WebView, načítanie Pyodide a súborov z `python/`, výmena správ s aplikáciou |
| `zariadenie.ts` | príprava fotky (zmenšenie, PNG), odoslanie výpočtu a určenia druhu do WebView |
| `vysledok-skenu.ts` | typy výsledkov z Pythonu a výsledok skenu medzi obrazovkami |
