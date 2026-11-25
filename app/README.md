# Aplikácia

Mobilná aplikácia (Expo, React Native), ktorá odfotí škvrnu alebo celú stranu dokumentu, nájde
masku škvrny a určí druh plesne alebo baktérie aj s cestou určovacím kľúčom. Všetko sa počíta
priamo v telefóne, bez servera a bez internetu.

| režim | vstup | spracovanie |
|---|---|---|
| **Obrázok** | detailný záber jednej škvrny | maska algoritmom detailného záberu (profil Rýchly) |
| **Dokument** | fotografia celej strany s textom | odstránenie textu, hľadanie miest škvŕn, maska v okne a výrez každej škvrny |

Po nájdení masky si používateľ masku skontroluje (pohľady Maska, Originál, Výrez) a spustí
klasifikáciu. Výsledok ukáže pre každú škvrnu určený druh alebo skupinu možných druhov, obrázok čŕt
(zóny od okraja k stredu, lem) a cestu kľúčom s hodnotami čŕt a prahmi.

## Rovnaký algoritmus ako v analýzach

Výpočty v `src/vypocty/` sú prepisom kódu z `../analyzy/` do TypeScriptu s rovnakými krokmi,
konštantami a menami funkcií:

| časť | v aplikácii | v analýzach |
|---|---|---|
| maska na detailnom zábere | `maska.ts`, `kanaly.ts`, `prahy.ts`, profil Rýchly | `skvrny/maska.py` |
| príprava strany, model papiera a tlače | `dokument-tlac.ts` | `dokumenty/dokument_tlac.py` |
| hľadanie miest škvŕn | `dokument-miesta.ts` | `dokumenty/dokument_miesta.py` |
| maska v okne a výrezy | `dokument.ts` | `dokumenty/dokument.py` |

Funkcie OpenCV a NumPy, ktoré analýzy volajú, sú v `filtre.ts`, `binarne.ts`, `kanaly.ts`
a `inpaint.ts` prepísané podľa zdrojového kódu OpenCV 4.11, aby dávali rovnaký výsledok bit po bite.
Ide o prevod farieb, Gaussov filter, zmenu veľkosti, morfológiu, vzdialenostnú transformáciu,
mediánový filter a inpaint Telea. Výpočty, ktoré Python robí vo float32, počíta aplikácia tiež
vo float32 (`Math.fround`).

**Overenie:** masky z aplikácie sa porovnali s Python verziou (`python/`, rovnaký kód ako
`analyzy/`) na rovnakých vstupoch:

- detailný záber: 41 fotografií z datasetu (každá 12.), všetky masky zhodné pixel po pixeli,
- dokument: 4 testovacie strany v pôvodnej veľkosti aj zväčšené na 2400 px, zhodné všetky
  medzivýsledky (maska strany, text, mapa tlače, odhad papiera, navrhnuté miesta) aj výsledná maska
  a počet škvŕn.

Fotografia sa pred výpočtom zmenší v telefóne (`expo-image-manipulator`): detailný záber na dlhšiu
stranu 1200 px, strana dokumentu na 2400 px. Pracovnú stranu 1600 px si postup zmenší sám ako
v analýzach (INTER_AREA). Mapa tlače sa počíta z 2400 px, kým analýzy ju pri väčších fotografiách
počítajú až z 3200 px (`TLAC_STRANA`).

**Určenie druhu:** aplikácia zatiaľ používa staršiu verziu určovacieho kľúča
(`src/vypocty/manualny-kluc.json`, črty z celej masky). Súčasný kľúč z analýz
(`analyzy/klasifikacia/kluc.json`, črty z jadra škvrny, test 80,8 %) do aplikácie ešte nie je
prenesený.

## Výkon

Najťažšie časti postupu (šedá morfológia pri odstraňovaní textu a 8-bitový Gaussov filter) sú
v `src/vypocty/wasm/jadra.wat`, malom module WebAssembly so SIMD inštrukciami (16 bajtov naraz).
Počíta tú istú celočíselnú aritmetiku ako JavaScript verzie v `filtre.ts`. Ak prostredie WebAssembly
SIMD nepodporuje (napríklad Hermes), použijú sa JavaScript verzie.

## Spustenie

```
npm install
npx expo start
```

Aplikácia sa otvorí v Expo Go na mobile (naskenovaním QR kódu).

Výpočty bežia v skrytom WebView (JavaScript s JIT je niekoľkonásobne rýchlejší ako Hermes). Ak
WebView nie je pripravený, ten istý kód sa spustí priamo v aplikácii. WebView spúšťa zbalený kód
zo `src/vypocty/webview-worker.generated.ts`, preto po každej zmene v `src/vypocty/` alebo
`src/lang/` treba spustiť:

```
npm run build:worker
```

Príkaz preloží aj `wasm/jadra.wat` do `wasm/jadra.generated.ts` (balík `wabt`).

Spracovanie v Pythone cez Pyodide ostalo v priečinku `python/` len ako pokus a aplikácia ho
nepoužíva (pozri [python/README.md](python/README.md)).

## Jazyky

Všetky texty aplikácie sú v `src/lang/`: `sk.ts` (slovenčina) a `en.ts` (angličtina) s rovnakými
kľúčmi. Jazyk sa prepína tlačidlom **SK / EN** v hornej lište a voľba sa zapamätá. Texty s číslami
sú funkcie (napr. `poradie: (aktualna, spolu) => ...`). Cesta kľúčom sa pri určení druhu vypočíta
v oboch jazykoch, takže prepnutie jazyka na obrazovke výsledku netreba počítať znova.

## Súbory

Obrazovky (`src/app/`) a ich časti (`src/komponenty/`):

| súbor | obsah |
|---|---|
| `app/index.tsx` | skenovanie – fotografia, výber režimu, kontrola masky a spustenie klasifikácie |
| `app/vysledok.tsx` | výsledok – určený druh a črty škvrny; pri viacerých škvrnách zoznam a prepínač |
| `app/_layout.tsx` | navigácia, jazyk a skrytý WebView na výpočty |
| `komponenty/karta-skvrny.tsx` | výsledok jednej škvrny a cesta kľúčom |
| `komponenty/zoznam-skvrn.tsx` | zoznam všetkých škvŕn: náhľad výrezu, názov a určený druh |
| `komponenty/prepinac-skvrn.tsx` | karty škvŕn po jednej – šípky alebo potiahnutie do strany |
| `komponenty/prepinac-jazyka.tsx` | tlačidlo SK / EN |
| `komponenty/prepinac.tsx`, `vodidlo.tsx`, `ikona.tsx` | prepínač, rohy na zarovnanie vzorky, ikony |
| `lang/sk.ts`, `lang/en.ts` | texty v slovenčine a angličtine |
| `preklady.ts`, `jazyk.tsx` | zoznam jazykov; zvolený jazyk pre celú aplikáciu (`useJazyk`) |
| `vzhlad.ts` | farby a medzery |

Výpočty (`src/vypocty/`):

| súbor | obsah | v analýzach |
|---|---|---|
| `maska.ts` | algoritmus masky: kandidátne masky (kanál × metóda × polarita), čistenie, skóre s kontrastom | `skvrny/maska.py` |
| `kanaly.ts`, `prahy.ts` | farebné kanály (ako `cv2.cvtColor`) a prahovacie metódy (ako OpenCV a scikit-image) | `skvrny/maska.py` |
| `dokument-tlac.ts` | maska strany, hrúbka písma, odstránenie textu, odhad papiera, mapa tlače | `dokumenty/dokument_tlac.py` |
| `dokument-miesta.ts` | rozdiel od papiera, škvrny na tlači a filtre nálezov | `dokumenty/dokument_miesta.py` |
| `dokument.ts` | okná okolo navrhnutých miest, maska v okne, zlúčenie a výrezy škvŕn, prehľad strany s číslami škvŕn | `dokumenty/dokument.py` |
| `crty.ts`, `gabor.ts` | odhad papiera pod škvrnou a črty škvrny (farba, zóny, lem, LBP, textúra) | `klasifikacia/crty.py` (staršia verzia) |
| `kluc.ts`, `manualny-kluc.json` | určovací kľúč | `klasifikacia/kluc.py` (staršia verzia) |
| `obrazok-crt.ts` | obrázok čŕt a náhľad škvrny na obrazovke výsledku | – |
| `postup.ts` | celý postup režimov Obrázok a Dokument a určenie druhu | `python/aplikacia.py` |
| `zariadenie.ts` | príprava fotografie a výpočet vo WebView (alebo priamo v aplikácii) | – |
| `webview.tsx`, `webview-worker.ts` | skrytý WebView a kód, ktorý v ňom beží | – |
| `filtre.ts`, `binarne.ts`, `inpaint.ts` | operácie s obrázkami a maskami prepísané z OpenCV | – |
| `wasm/jadra.wat`, `wasm/jadra.ts` | morfológia a Gaussov filter vo WebAssembly SIMD | – |
| `obrazok.ts`, `png.ts`, `cas.ts` | obrázky a výrezy, PNG, časový limit | – |
| `vysledok-skenu.ts` | výsledok skenu medzi obrazovkami | – |
