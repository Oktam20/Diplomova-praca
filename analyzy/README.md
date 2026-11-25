# Analýzy – maska, škvrny na dokumentoch a určenie druhu

Python kód k diplomovej práci. Z fotografie škvrny plesne alebo baktérie na papieri:

1. **nájde masku škvrny** – ktoré pixely patria škvrne (časť 1, `skvrny/`),
2. **nájde škvrny na celej strane dokumentu** s textom a ilustráciami a vyreže ich (časť 2, `dokumenty/`),
3. **určí druh** škvrny vysvetliteľným určovacím kľúčom (časť 3, `klasifikacia/`).

Žiadna časť nepoužíva strojové učenie. Maska sa hľadá automatickým prahovaním farebných kanálov
a výberom podľa pravidiel, kľúč je postupnosť otázok „črta ≤ prah?“ a z dát sa učia len prahy.
Mobilná aplikácia ([../app/](../app/README.md)) používa rovnaký algoritmus.

## Ako algoritmus funguje

```
fotografia škvrny ──► kandidátne masky ──► skóre ──► maska ──► črty z jadra škvrny ──► určovací kľúč ──► druh
                     (kanál × metóda ×                          (farba voči papieru,
                      polarita, profil Rýchly)                   zóny, lem, textúra)

strana dokumentu ──► príprava strany ──► model papiera ──► hľadanie miest ──► maska v okne ──► výrezy škvŕn
                     (odstránenie        a tlače           škvŕn             (ten istý          (ďalej ako
                      textu)                                                  algoritmus masky)   detailný záber)
```

**Maska škvrny** (detailný záber, `skvrny/maska.py`). Fotografia sa rozloží na farebné kanály.
Každý kanál sa vyhladí a prahuje niekoľkými automatickými metódami v oboch polaritách: škvrna pod
prahom aj nad prahom. Každá taká **kandidátna maska** sa vyčistí morfologickými operáciami a ohodnotí
**skóre**:

```
skóre = kruhovitosť + bonus za pokrytie − penalizácia za rozpad + 0,3 · ln(1 + kontrast)
```

Vyhrá kandidát s najvyšším skóre. Kontrast meria, či maska končí tam, kde sa farba naozaj mení.
Bez neho skóre často vybralo len tmavé jadro škvrny.

Ktoré kanály a metódy sa skúšajú, určuje **profil**. Profily vznikli spätným vylučovaním na
trénovacej množine, porovnaním s ručne obkreslenými maskami (krok 1.4):

| profil | kanály | metódy | kandidátov | Dice train | Dice test |
|---|---|---|---|---|---|
| **Rýchly** (predvolený, aplikácia aj masky pre kľúč) | HSV_S, Lab_a, XYZ_X, YUV_U | Yen, ISODATA, Minimum | 24 | 0,843 | **0,832** |
| **Kvalitný** | HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V | Yen, Li, ISODATA, Minimum | 48 | 0,854 | – |
| sada 12 × 7 (referencia) | všetky okrem jasových | všetkých 7 | 168 | 0,853 | 0,830 |

Počet kandidátov je kanály × metódy × 2 polarity. Sada 12 × 7 je plná sada 19 kanálov × 7 metód
bez siedmich jasových kanálov, ktorých vylúčenie nezmení ani jednu masku. Dice je zhoda s ručnou
maskou (0–1). Profil Rýchly je rovnako presný ako sada 12 × 7 so skóre s kontrastom a počíta
7-krát menej kandidátov, preto ho používa aplikácia aj tvorba masiek pre určovací kľúč. Test
profilu Kvalitný sa pre jeho súčasnú verziu nemeral.

**Škvrny na strane dokumentu** (`dokumenty/`). Na strane je najtmavšia štruktúra text a škvŕn je
viac, preto sa maska nedá hľadať priamo. Najprv sa odstráni text, odhadne sa farba papiera a tlače
a nájdu sa miesta, ktoré sa od papiera líšia farbou. Okolo každého miesta sa vyreže okno a masku
v ňom nájde ten istý algoritmus ako na detailnom zábere.

**Určenie druhu** (`klasifikacia/`). Z masky sa vypočítajú **črty** voči farbe okolitého papiera:
jas, žltosť, sýtosť, tón, farba v zónach od okraja k stredu, farba lemu a textúra. Črty sa merajú
v **jadre škvrny**, bez bledého okraja kolónie. **Určovací kľúč** položí postupne niekoľko otázok
a výsledkom je druh alebo skupina možných druhov spolu s cestou kľúčom.

## Inštalácia

Python 3.11, potom v tomto priečinku:

```
pip install -r requirements.txt
```

Všetky príkazy nižšie sa spúšťajú **z priečinka `analyzy/`** ako moduly (`python -m ...`).

## Dáta – `images/`

| priečinok | obsah |
|---|---|
| `images/D2/` | 484 fotografií škvŕn: 127 kartičiek po 4 škvrny, 12 druhov, telefón Oppo Reno5z. Názov `<kartička>_<škvrna>_<Rod-druh>_<telefón>.jpg`, napr. `01_a_Epicoccum-layunese_OppoReno5z.jpg` |
| `images/D2masks/` | ručne obkreslené masky tých istých fotografií, `<rovnaký názov>.png` (škvrna biela, pozadie čierne) |
| `images/testovacie_strany/` | vygenerované strany dokumentu so vloženými škvrnami (krok 2.1) |

Fotografie sú rozdelené na **trénovaciu množinu** (train, 101 kartičiek, 385 fotografií) a
**testovaciu množinu** (test, 26 kartičiek, 99 fotografií) po kartičkách (krok 1.2). Všetko sa ladí
len na trénovacej množine, testovacia slúži na konečné overenie.

## Celý postup naraz

```
bash spusti_analyzy.sh               # všetky kroky
bash spusti_analyzy.sh skvrny        # len časť 1
bash spusti_analyzy.sh dokumenty     # len časť 2
bash spusti_analyzy.sh klasifikacia  # len časť 3
```

Skript spustí kroky nižšie postupne a všetko uloží do vlastného priečinka `behy/<dátum_čas>/`
(masky, tabuľky, grafy, strany) spolu so záznamom `beh.log`: čo ktorý krok vypísal, ako dlho trval
a súhrn na konci. Doterajšie výsledky v `skvrny/vysledky/`, `images/D2/masky/`, `dokumenty/vysledky/`
a `klasifikacia/` sa neprepíšu.

Jednotlivé kroky (výstupy idú do predvolených priečinkov):

```
python -m skvrny.vytvor_masky images/D2
python -m skvrny.rozdelenie images/D2
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks

python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks
python -m dokumenty.dokument images/testovacie_strany

python -m klasifikacia.postav_kluc --fotky images/D2 --masky images/D2/masky
```

---

## 1. Maska škvrny na detailnom zábere (`skvrny/`)

### 1.1 Vytvorenie masiek

```
python -m skvrny.vytvor_masky images/D2
```

**Čo urobí:** pre každú fotografiu nájde masku škvrny algoritmom zo `skvrny/maska.py`:

1. fotografiu s dlhšou stranou nad 1200 px zmenší (ako v aplikácii),
2. rozloží ju na farebné kanály profilu (predvolene Rýchly: HSV_S, Lab_a, XYZ_X, YUV_U),
3. každý kanál vyhladí Gaussovým filtrom 5 × 5 a prahuje metódami profilu (Yen, ISODATA, Minimum)
   v oboch polaritách – najviac 24 kandidátnych masiek; prah, ktorý na rovnakom kanáli dá rovnakú
   masku, sa nepočíta dvakrát,
4. každú masku vyčistí: uzavretie a otvorenie, vyplnenie dier, odstránenie malých oblastí a oblastí
   pri okraji fotografie,
5. každú ohodnotí skóre (kruhovitosť, pokrytie, rozpad, kontrast voči okoliu),
6. vyberie kandidáta s najvyšším skóre.

**Výstup:** `images/D2/masky/<fotka>.png` (maska 0/255) a `images/D2/masky/vitazi.csv` (pre každú
fotografiu víťazný kanál, metóda, polarita a skóre). Počas behu vypisuje víťaza každej fotografie.

Voľby: `--profil kvalitny`, `--vystup <priečinok>`. Podrobnosti: [skvrny/docs/maska.md](skvrny/docs/maska.md).

### 1.2 Rozdelenie na trénovaciu a testovaciu množinu

```
python -m skvrny.rozdelenie images/D2
```

**Čo urobí:** rozdelí fotografie na trénovaciu (80 %) a testovaciu (20 %) množinu **po kartičkách**.
Štyri fotografie jednej kartičky sú zábery tej istej kolónie, preto idú celé do jednej množiny.
Delí sa v rámci každého druhu zvlášť (každý druh je v teste), s pevným seedom 2026.

Súbor `skvrny/rozdelenie.csv` s rozdelením použitým v práci je v repozitári. Skript ho len načíta
a vypíše počty (train 101 kartičiek / 385 fotografií, test 26 / 99). Nové rozdelenie vytvorí iba
s `--znova`.

**Výstup:** graf `skvrny/vysledky/rozdelenie.png` (počet fotografií každého druhu v oboch množinách).

### 1.3 Vyhodnotenie voči ručným maskám

```
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2
```

**Čo urobí:** pre každú fotografiu porovná automatickú masku z kroku 1.1 s ručnou maskou
(ručná maska = správna odpoveď):

| metrika | význam |
|---|---|
| Dice | celková zhoda masiek (0–1) |
| IoU | prekryv; IoU ≥ 0,5 sa bežne považuje za správne nájdený objekt |
| presnosť | aká časť automatickej masky je naozaj škvrna |
| citlivosť | akú časť škvrny maska zachytila |

Výsledky vypíše zvlášť pre trénovaciu, testovaciu a celú množinu a priemerný Dice po druhoch.

**Výstup v `skvrny/vysledky/`:**

| súbor | obsah |
|---|---|
| `vyhodnotenie.csv` | metriky každej fotografie |
| `suhrn.csv` | priemery pre train / test / spolu |
| `dice_histogram.png` | rozdelenie Dice v oboch množinách |
| `dice_po_druhoch.png` | priemerný Dice každého druhu |
| `ukazky.png` | najlepšie, typické a najhoršie fotografie (zelená = ručná maska, červená = automatická) |

**Výsledok (profil Rýchly):**

| | fotografií | Dice | IoU | presnosť | citlivosť | IoU ≥ 0,5 |
|---|---|---|---|---|---|---|
| train | 385 | 0,843 | 0,749 | 0,911 | 0,815 | 94,3 % |
| **test** | 99 | **0,832** | 0,737 | 0,909 | 0,810 | 92,9 % |

Presnosť je vyššia ako citlivosť: maska takmer nezachytí papier, no občas vynechá najbledší okraj
kolónie. Najťažšie druhy sú *Arthrobacter* (Dice 0,69) a *Epicoccum* (0,78), ktoré majú bledé kolónie
a nepravidelné okraje. Najlepšie sú *Curtobacterium* a *Sphingomonas* (0,90).

### 1.4 Výber farebných kanálov a prahovacích metód (profily)

```
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks
```

**Čo urobí:** zdôvodní, prečo profily obsahujú práve tieto kanály a metódy. Pracuje **len
s trénovacou množinou**:

1. pre každú fotografiu vytvorí všetkých 266 kandidátov plnej sady (19 kanálov × 7 metód × 2
   polarity) a ku každému uloží skóre a Dice voči ručnej maske,
2. spočíta, ktorý kanál a metóda vyhrávajú so skóre s kontrastom. Najčastejšie vyhráva HSV_S
   (165 z 385 fotografií), jasové kanály (HSV_V, Lab_L, YCbCr_Y, XYZ_Y, XYZ_Z, YUV_Y, Gray) takmer
   nikdy. Škvrna sa od papiera líši hlavne farbou, nie jasom, preto sa jasové kanály vylúčia (sada 12 × 7),
3. **spätné vylučovanie:** od sady 12 × 7 v každom kroku odoberie kanál alebo metódu, bez ktorej je
   priemerný Dice vybraných masiek najvyšší,
4. z tejto cesty vyberie podľa pevných pravidiel profily: **Kvalitný** (najmenšia sada bez straty
   oproti 12 × 7) a **Rýchly** (najmenšia sada so stratou najviac 0,01 Dice).

Prvý beh trvá niekoľko minút (počíta sa paralelne). Kandidáti sa uložia do
`skvrny/vysledky/kandidati.csv` a ďalšie behy ich len načítajú (`--znova` ich prepočíta).

**Výstup v `skvrny/vysledky/`:** `vyhry_kanalov_a_metod.png`, `vylucovanie.png` (Dice počas
vylučovania so zvýraznenými profilmi), `vylucovanie.csv` (každý krok).

Prvé odobratia (Mean, RGB_B, Triangle, RGB_G, Lab_b) Dice dokonca zvýšia z 0,853 na 0,858.
Tieto prvky prinášali do výberu len nevhodných kandidátov. Každý prvok profilu pritom prispieva:
bez ktoréhokoľvek z nich Dice klesne. Výsledné profily sú v `PROFILY` v `skvrny/maska.py`
a v tabuľke profilov vyššie. Podrobnosti: [skvrny/docs/vyber_kanalov.md](skvrny/docs/vyber_kanalov.md).

Grafy z práce (výhry kanálov a metód so všetkými 19 kanálmi, presnosť sady 12 × 7, voľba váhy
kontrastu, overenie na testovacej množine) sú v [skvrny/grafy_z_prace/](skvrny/grafy_z_prace/README.md).

---

## 2. Škvrny na stranách dokumentov (`dokumenty/`)

Algoritmus masky z časti 1 je stavaný na jednu škvrnu na čistom papieri. Na strane dokumentu by
zlyhal: text je tmavší ako papier, škvŕn je viac a sú malé voči strane. Postup preto najprv nájde,
**kde** sú škvrny, a až potom v okne okolo každého miesta použije ten istý algoritmus masky.

### 2.1 Testovacie strany

```
python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks
```

**Čo urobí:** vygeneruje 4 strany s textom a na každú vloží 4 skutočné škvrny z datasetu (rôzne
druhy). Škvrna sa vkladá **násobením**: pomer jej farby ku farbe papiera sa prenesie na stranu,
takže text pod škvrnou ostane ako pri skutočnej škvrne.

**Výstup v `images/testovacie_strany/`:** `strana_<n>_skvrny.png`, `zoznam.csv` (ktorý druh je kde,
obdĺžnik x0, y0, x1, y1) a `prazdne/` (tie isté strany bez škvŕn).

Voľby: `--pocet`, `--skvrn`, `--seed` (iné škvrny a polohy), `--strany <obrázky>` (vloží škvrny na
skutočné fotografie strán namiesto generovaných).

### 2.2 Hľadanie škvŕn na stranách

```
python -m dokumenty.dokument images/testovacie_strany
```

Dajú sa zadať aj jednotlivé súbory (`python -m dokumenty.dokument strana1.jpg strana2.png`).
Strana sa spracúva zmenšená na dlhšiu stranu 1600 px, mapa tlače vo vyššom rozlíšení (do 3200 px).

**Čo urobí** s každou stranou:

1. **Príprava strany** – oddelí papier od tmavého podkladu (ak je strana fotená na stole), odhadne
   hrúbku písma a odstráni text: tenké tmavé ťahy nájde transformáciou black-hat a vyplní ich farbou
   okolitého papiera. Plošná škvrna širšia ako ťah písma ostane.
2. **Model papiera a tlače** – odhadne farbu papiera v každom mieste strany a nájde ilustrácie,
   rytiny a plnú tlač, aby sa nepovažovali za škvrny.
3. **Hľadanie miest škvŕn** – nájde miesta, ktoré sa farbou (ΔE v Lab) líšia od papiera, a vyradí
   okraj strany, hustý text, tlačené prvky a slabé fliačiky.
4. **Maska v okne** – okolo každého miesta vyreže štvorcové okno, zväčší ho na 700 px a masku nájde
   algoritmus z časti 1 (profil Rýchly) s podmienkou, že maska musí pokrývať navrhnuté miesto.
5. **Výrezy** – blízke časti masky zlúči do jednej škvrny a každú vyreže zo strany bez textu ako
   samostatný záber. Ten je vstupom pre určenie druhu rovnako ako detailný záber.

Pre každú stranu vypíše počet navrhnutých miest, nájdených škvŕn a výrezov.

**Výstup v `dokumenty/vysledky/`** (priečinok sa pred spustením vyprázdni):

| súbor | obsah |
|---|---|
| `<strana>_prehlad.png` | **hlavný obrázok:** pôvodná strana \| strana bez textu s navrhnutými miestami \| výsledná maska |
| `<strana>_maska.png` | maska škvŕn celej strany |
| `<strana>_bez_textu.jpg` | strana po odstránení textu |
| `<strana>_vyrezy/` | výrez každej škvrny a v `masky/` jeho maska |

Najťažšie sú veľmi bledé baktérie (*Exiguobacterium*, *Arthrobacter*), ktorých farba sa od papiera
takmer nelíši. Tie sa často nenájdu. Podrobnosti: [dokumenty/docs/dokument.md](dokumenty/docs/dokument.md).

### 2.3 Syntetický test

```
python -m dokumenty.test_dokumenty --strany <fotografie strán> --fotky images/D2
```

Napríklad na prázdnych vygenerovaných stranách z kroku 2.1:

```
python -m dokumenty.test_dokumenty --fotky images/D2 --strany images/testovacie_strany/prazdne/strana_1.png images/testovacie_strany/prazdne/strana_2.png images/testovacie_strany/prazdne/strana_3.png images/testovacie_strany/prazdne/strana_4.png
```

**Čo urobí:** na zadané strany 3-krát vloží po 4 škvrny (zakaždým iné druhy a polohy), spustí
hľadanie škvŕn a porovná výsledok so známymi maskami vložených škvŕn. Pre každú škvrnu zistí, či
bola nájdená (maska pokrýva aspoň polovicu škvrny), IoU, presnosť masky a viditeľnosť škvrny (ΔE
voči papieru). Spočíta aj falošné nálezy.

Potrebuje masky škvŕn, predvolene `images/D2/masky/` z kroku 1.1 (iné cez `--masky`).

**Výstup v `dokumenty/vysledky_test/`:** `suhrn.txt` (súhrn), `skvrny.csv` (každá vložená škvrna)
a náhľad každej strany (zelená = vložená škvrna, červená = maska programu). Podrobnosti:
[dokumenty/docs/test_dokumenty.md](dokumenty/docs/test_dokumenty.md).

---

## 3. Určenie druhu (`klasifikacia/`)

### 3.1 Stavba a overenie určovacieho kľúča

```
python -m klasifikacia.postav_kluc --fotky images/D2 --masky images/D2/masky
```

**Čo urobí:**

1. z fotografie a masky (profil Rýchly, krok 1.1) každej škvrny vypočíta črty voči farbe okolitého
   papiera: farbu (jas, sýtosť, tón, percentily), farbu v 4 zónach od okraja k stredu, farbu lemu,
   zrnitosť (LBP) a hrubú textúru (Gaborov filter). Farba, zóny a textúra sa merajú v jadre škvrny
   bez bledého okraja (krok 3.3),
2. na **trénovacej množine** naučí prahy kľúča. Štruktúra kľúča (skupiny druhov, poradie otázok
   a ich črty) je v `klasifikacia/struktura_kluca.json`,
3. úspešnosť na trénovacej množine odhadne krížovou validáciou po kartičkách a kľúč overí na
   **testovacej množine**, aj pre každý druh zvlášť.

S `--uloz` zapíše kľúč aj do `klasifikacia/kluc.json` a do aplikácie.

**Výstup v `klasifikacia/vysledky/`:** `kluc.json`, `suhrn.csv`, `fotky.csv`, `crty.csv` a grafy
`uspesnost.png` (celková úspešnosť), `po_druhoch.png` (po druhoch v oboch množinách) a
`zameny_test.png` (kam padajú testovacie fotografie každého druhu).

**Výsledok:** na testovacej množine **80,8 % fotografií** a **84,6 % kartičiek** určených správne
(trénovacia množina, krížová validácia: 82,6 %). S črtami z celej masky namiesto jadra to bolo
71,7 % a 76,9 % (krížová validácia 78,7 %). Kľúč a jeho otázky popisuje
[klasifikacia/README.md](klasifikacia/README.md).

### 3.2 PCA farieb pixelov škvrny

```
python -m klasifikacia.pca_farieb --fotky images/D2 --masky images/D2/masky --rucne images/D2masks
```

**Čo urobí:** overí nápad opísať škvrnu tvarom oblaku farieb jej pixelov. Pre každú škvrnu nájde
vlastné vektory a vlastné čísla kovariančnej matice farieb pixelov (Lab voči papieru, rovina ab,
RGB) s ručnou maskou, automatickou maskou a jej jadrom. Z nich vytvorí črty (smer hlavnej osi,
pomery vlastných čísel, rozptyl) a na trénovacej množine zmeria, ako dobre rozlišujú druhy, či ich
neobsahujú doterajšie črty, ako závisia od masky, koľko pridajú bežným klasifikátorom a či zlepšia
otázky kľúča (vnorená krížová validácia). Kľúč s PCA otázkami porovná aj na testovacej množine.
Beží asi 15 minút.

**Výstup v `klasifikacia/vysledky_pca/`:** grafy `01_princip.png` až `08_otazky_kluca.png` a tabuľky,
popis v [klasifikacia/README.md](klasifikacia/README.md).

**Výsledok:** PCA črty druhy rozlišujú (najlepšia, sklon hlavnej osi od osi jasu, eta² 0,81), doterajšie
črty ich však z veľkej časti obsahujú. Klasifikátorom pridajú najviac 0,5 p. b. a kľúč s PCA otázkami
nie je lepší (vnorená krížová validácia 81,5 % oproti 82,6 %, test 79,8 % oproti 80,8 %). Do kľúča
preto nešli.

### 3.3 Výber jadra škvrny

```
python -m klasifikacia.vyber_jadra --fotky images/D2 --masky images/D2/masky --rucne images/D2masks
```

**Čo urobí:** spočíta črty z jadra škvrny, teda z pixelov masky, ktorých farebný rozdiel od papiera
je aspoň daný podiel (0 až 0,8) z 90. percentilu, pre automatické aj ručné masky. Pre každý podiel
naučí kľúč na trénovacej množine, odhadne jeho úspešnosť krížovou validáciou po kartičkách
(5 rozdelení na foldy) a overí ho na testovacej. Podiel použitý v kľúči (`JADRO` v
`klasifikacia/crty.py`) sa vyberá len podľa krížovej validácie.

**Výstup v `klasifikacia/vysledky_jadra/`:** graf úspešnosti podľa podielu, príklady jadra na
fotografiách a tabuľky.

**Výsledok:** s celou maskou 79,2 %, s jadrom plató 82–83 % pri podieloch 0,3–0,6, pri menšom jadre
pokles (0,8: 75,7 %). Zvolený podiel je 0,45 (stred plató, jadro tvorí 81 % plochy masky).

---

## Súbory

```
analyzy/
├── requirements.txt
├── spusti_analyzy.sh             všetky kroky naraz
├── images/                       dáta (fotografie, ručné masky, testovacie strany)
├── behy/                         výstupy behov spusti_analyzy.sh (každý beh vlastný priečinok s beh.log)
├── skvrny/
│   ├── maska.py                  algoritmus masky: kanály, prahovanie, čistenie, skóre, profily
│   ├── morfologia.py             dilatácia a erózia s eliptickým jadrom (rovnaký výsledok ako OpenCV, rýchlejšie)
│   ├── vytvor_masky.py      1.1  masky pre priečinok fotografií
│   ├── rozdelenie.py        1.2  rozdelenie na trénovaciu a testovaciu množinu
│   ├── rozdelenie.csv            rozdelenie použité v práci
│   ├── vyhodnotenie.py      1.3  porovnanie s ručnými maskami
│   ├── vyber_kanalov.py     1.4  výber kanálov a metód, profily
│   ├── subory.py                 načítanie a ukladanie obrázkov, údaje z názvu fotografie
│   ├── docs/                     technický popis skriptov
│   ├── grafy_z_prace/            grafy z kapitoly Výskum s popisom
│   └── vysledky/                 výstupy skriptov
├── dokumenty/
│   ├── dokument.py          2.2  celý postup na strane: okná, maska v okne, výrezy, prehľad
│   ├── dokument_tlac.py          príprava strany, odstránenie textu, mapa tlače, odhad papiera
│   ├── dokument_miesta.py        hľadanie miest škvŕn a filtre
│   ├── generuj_strany.py    2.1  testovacie strany
│   ├── test_dokumenty.py    2.3  syntetický test
│   ├── docs/                     technický popis
│   └── vysledky/                 výstupy skriptov
└── klasifikacia/
    ├── crty.py                   črty škvrny (z jadra škvrny)
    ├── kluc.py                   učenie prahov a určenie škvrny kľúčom
    ├── struktura_kluca.json      štruktúra kľúča (bez prahov)
    ├── postav_kluc.py       3.1  stavba na trénovacej, overenie na testovacej množine, grafy
    ├── pca_farieb.py        3.2  PCA farieb pixelov škvrny
    ├── vyber_jadra.py       3.3  výber jadra škvrny
    ├── vzhlad.py                 farby a štýl grafov
    ├── kluc.json                 naučený kľúč (zapíše ho postav_kluc.py --uloz)
    ├── grafy_analyz/             grafy analýz, z ktorých vznikla štruktúra kľúča, s popisom
    ├── vysledky/                 výstupy stavby kľúča
    ├── vysledky_pca/             výstupy PCA analýzy
    └── vysledky_jadra/           výstupy výberu jadra
```

Technický popis (vzorce skóre, metriky, parametre) je v [skvrny/docs/](skvrny/docs/),
[dokumenty/docs/](dokumenty/docs/) a [klasifikacia/README.md](klasifikacia/README.md).
