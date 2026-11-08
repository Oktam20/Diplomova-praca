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
WebView spúšťa zbalený kód zo `src/vypocty/webview-worker.generated.ts`, preto po každej
zmene v `src/vypocty/` treba spustiť:

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

| súbor | obsah | v analýzach |
|---|---|---|
| `maska.ts` | hľadanie masky škvrny (kanály × metódy × smer prahu, skóre) | `skvrny/maska.py` |
| `kanaly.ts`, `prahy.ts` | farebné kanály a metódy prahovania | `skvrny/maska.py` |
| `dokument-tlac.ts` | maska strany, odstránenie textu, odhad papiera, mapa tlače | `dokumenty/dokument_tlac.py` |
| `dokument-miesta.ts` | rozdiel od papiera a vyradenie nálezov, ktoré nie sú škvrny | `dokumenty/dokument_miesta.py` |
| `dokument.ts` | okná okolo navrhnutých miest, maska v okne, zlúčenie a výrezy škvŕn | `dokumenty/dokument.py` |
| `crty.ts`, `gabor.ts` | odhad papiera pod škvrnou a črty škvrny (farba, zóny, lem, LBP, textúra) | – |
| `kluc.ts`, `manualny-kluc.json` | určovací kľúč | – |
| `obrazok-crt.ts` | obrázok čŕt na obrazovke výsledku | – |
| `postup.ts` | celý postup režimov Obrázok a Dokument a určenie druhu | – |
| `zariadenie.ts` | príprava fotky a výpočet vo WebView (alebo priamo v aplikácii) | – |
| `webview.tsx`, `webview-worker.ts` | skrytý WebView a kód, ktorý v ňom beží | – |
| `binarne.ts`, `filtre.ts` | operácie s maskami a obrázkami (ako v OpenCV) | – |
| `obrazok.ts`, `png.ts`, `cas.ts` | obrázky a výrezy, PNG, časový limit | – |
| `vysledok-skenu.ts` | výsledok skenu medzi obrazovkami | – |
