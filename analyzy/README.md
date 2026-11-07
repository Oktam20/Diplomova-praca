# Analýzy – maska škvrny plesne a baktérie z fotografie

Python kód k diplomovej práci. Pre fotku škvrny nájde **masku** (ktoré pixely patria škvrne),
porovná ju s ručne obkreslenými maskami a zdôvodní výber farebných kanálov. Druhá časť
hľadá škvrny na **stranách dokumentov** s textom a ilustráciami.

Maska sa hľadá bez trénovania: fotka sa rozloží na farebné kanály, každý kanál sa prahuje
niekoľkými automatickými metódami a vyberie sa kandidát, ktorý najviac vyzerá ako škvrna
(okrúhly, primerane veľký, s výrazným prechodom farby do okolia).

## Inštalácia

Python 3.11, potom v tomto priečinku:

```
pip install -r requirements.txt
```

Všetky príkazy nižšie sa spúšťajú **z priečinka `analyzy/`** ako moduly (`python -m ...`).

## Dáta – `images/`

| priečinok | obsah |
|---|---|
| `images/D2/` | 484 fotiek škvŕn (127 kartičiek po 4 škvrny, 12 druhov, telefón Oppo Reno5z). Názov `<kartička>_<škvrna>_<Rod-druh>_<telefón>.jpg`, napr. `01_a_Epicoccum-layunese_OppoReno5z.jpg` |
| `images/D2masks/` | ručne obkreslené masky tých istých fotiek, `<rovnaký názov>.png` (škvrna biela, pozadie čierne) |
| `images/testovacie_strany/` | vygenerované strany dokumentu so vloženými škvrnami (krok 2.1) |

## Celý postup naraz

```
python -m skvrny.vytvor_masky images/D2
python -m skvrny.rozdelenie images/D2
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks

python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks
python -m dokumenty.dokument images/testovacie_strany
```

---

## 1. Škvrny – detailný záber jednej škvrny (`skvrny/`)

### 1.1 Vytvorenie masiek

```
python -m skvrny.vytvor_masky images/D2
```

**Čo urobí:** pre každú fotku v priečinku nájde masku škvrny algoritmom zo `skvrny/maska.py`:

1. fotku rozloží na farebné kanály (predvolený profil *rýchly*: HSV_S, Lab_a, XYZ_X, YUV_U),
2. každý kanál vyhladí a prahuje metódami Yen, Isodata a Minimum v oboch smeroch (škvrna pod
   aj nad prahom) – spolu 24 kandidátnych masiek,
3. každú masku vyčistí (morfológia, vyplnenie dier, odstránenie malých oblastí a oblastí
   pri okraji fotky),
4. ohodnotí ju skóre: kruhovitosť + primerané pokrytie − penalizácia za rozpad + kontrast
   s okolím,
5. vyberie kandidáta s najvyšším skóre.

**Výstup:** `images/D2/masky/<fotka>.png` (maska 0/255) a `images/D2/masky/vitazi.csv`
(pre každú fotku víťazný kanál, metóda, smer prahu a skóre). Počas behu vypisuje víťaza
každej fotky.

Voľby: `--profil kvalitny` (6 kanálov × 4 metódy), `--vystup <priečinok>`.

### 1.2 Rozdelenie na trénovaciu a testovaciu časť

```
python -m skvrny.rozdelenie images/D2
```

**Čo urobí:** rozdelí fotky na train (80 %) a test (20 %) **po kartičkách** – štyri fotky
jednej kartičky sú zábery tej istej kolónie, takže idú celé do jednej časti. Delí sa v rámci
každého druhu zvlášť (každý druh je zastúpený v teste), s pevným seedom 2026.

Súbor `skvrny/rozdelenie.csv` s rozdelením použitým v práci je už v repozitári – skript ho
len načíta a vypíše počty (train 101 kartičiek / 385 fotiek, test 26 / 99). Nové rozdelenie
vytvorí iba s `--znova`.

**Výstup:** graf `skvrny/vysledky/rozdelenie.png` (počet fotiek každého druhu v train a test).

### 1.3 Vyhodnotenie voči ručným maskám

```
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2
```

**Čo urobí:** pre každú fotku porovná automatickú masku z kroku 1.1 s ručnou maskou
(ručná = správna odpoveď) a spočíta:

| metrika | význam |
|---|---|
| Dice | celková zhoda masiek (0 – 1) |
| IoU | prekryv; IoU ≥ 0,5 sa bežne považuje za správne nájdený objekt |
| presnosť | koľko z automatickej masky je naozaj škvrna |
| citlivosť | koľko zo škvrny maska zachytila |

Výsledky vypíše zvlášť pre train, test a všetky fotky a priemerný Dice po druhoch.

**Výstup v `skvrny/vysledky/`:**

| súbor | obsah |
|---|---|
| `vyhodnotenie.csv` | metriky každej fotky |
| `suhrn.csv` | priemery pre train / test / spolu |
| `dice_histogram.png` | rozdelenie Dice na train a test |
| `dice_po_druhoch.png` | priemerný Dice každého druhu |
| `ukazky.png` | najlepšie, typické a najhoršie fotky (zelená = ručná maska, červená = automatická) |

**Výsledok (profil rýchly):**

| | fotiek | Dice | IoU | presnosť | citlivosť | IoU ≥ 0,5 |
|---|---|---|---|---|---|---|
| train | 385 | 0,843 | 0,749 | 0,911 | 0,815 | 94,3 % |
| **test** | 99 | **0,832** | 0,737 | 0,909 | 0,810 | 92,9 % |

Najťažšie druhy sú *Arthrobacter* (0,69) a *Epicoccum* (0,78) – bledé kolónie
a nepravidelné okraje; najlepšie *Curtobacterium* a *Sphingomonas* (0,90).

Pôvodný profil z práce (HSV_H, HSV_S, YCbCr_Cr, YCbCr_Cb, XYZ_X × Otsu, Yen, Isodata) mal
na teste Dice 0,834 – nový profil je rovnako presný s menej kandidátmi (24 namiesto 30),
len na najbledšom druhu *Arthrobacter* je horší (0,69 namiesto 0,75).

### 1.4 Výber farebných kanálov a metód prahovania

```
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks
```

**Čo urobí:** zdôvodní, prečo maska používa práve kanály a metódy z profilov. Pracuje
**len s trénovacími fotkami**:

1. pre každú fotku vytvorí všetkých 266 kandidátov (19 kanálov × 7 metód × 2 smery) a ku
   každému uloží skóre a Dice voči ručnej maske,
2. spočíta, ktorý kanál a metóda vyhrávajú pri všetkých kombináciách so súčasným skóre
   (s kontrastom) – najčastejšie HSV_S, jasové kanály (L, V, Y, Gray) len zriedka; škvrna sa
   od papiera líši hlavne farbou, preto sa jasové kanály vylúčia (graf pôvodnej analýzy
   s pôvodným skóre je `skvrny/grafy_z_prace/02_vyhry_kanalov.png`),
3. postupné vylučovanie: od 12 kanálov (bez jasových) × 7 metód vždy odoberie kanál alebo
   metódu, bez ktorej je priemerný Dice vybraných masiek najvyšší,
4. z tejto cesty vyberie profily *kvalitný* (najmenšia sada bez straty) a *rýchly*
   (najmenšia sada so stratou do 0,01 Dice).

Prvý beh trvá niekoľko minút (počíta sa paralelne); kandidáti sa uložia do
`skvrny/vysledky/kandidati.csv` a ďalšie behy ich len načítajú (`--znova` ich prepočíta).

**Výstup v `skvrny/vysledky/`:** `vyhry_kanalov_a_metod.png`, `vylucovanie.png`
(Dice počas vylučovania so zvýraznenými profilmi), `vylucovanie.csv`.

Profily v `maska.py` sú výsledkom tohto skriptu:

| profil | kanály | metódy | Dice (train) |
|---|---|---|---|
| `rychly` | HSV_S, Lab_a, XYZ_X, YUV_U | Yen, Isodata, Minimum | 0,843 |
| `kvalitny` | HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V | Yen, Li, Isodata, Minimum | 0,854 |

Pôvodné profily z práce (5 × 3 a 7 × 4) mali na trénovacích fotkách Dice 0,846 a 0,854 –
iné kanály dávajú takmer rovnaký výsledok, na presnom výbere kanálov teda veľmi nezáleží.

---

## 2. Dokumenty – strana s textom a ilustráciami (`dokumenty/`)

Algoritmus masky z časti 1 je stavaný na jednu škvrnu na čistom papieri. Na strane
dokumentu zlyhá – text je tmavší ako papier, škvŕn je viac a sú malé. Postup preto najprv
odstráni text, navrhne miesta so škvrnami a v okne okolo každého miesta použije ten istý
algoritmus masky ako v časti 1.

### 2.1 Testovacie strany

```
python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks
```

**Čo urobí:** vygeneruje 4 strany s textom a na každú vloží 4 skutočné škvrny z datasetu
(rôzne druhy). Škvrna sa vkladá **násobením** – pomer jej farby ku farbe papiera sa prenesie
na stranu, takže text pod škvrnou ostane ako pri skutočnej škvrne.

**Výstup v `images/testovacie_strany/`:** `strana_<n>_skvrny.png`, `zoznam.csv` (ktorý druh
je kde – obdĺžnik x0, y0, x1, y1) a `prazdne/` (tie isté strany bez škvŕn).

Voľby: `--pocet`, `--skvrn`, `--seed` (iné škvrny a polohy), `--strany <obrázky>` (vloží
škvrny na skutočné fotky strán namiesto generovaných).

### 2.2 Hľadanie škvŕn na stranách

```
python -m dokumenty.dokument images/testovacie_strany
```

Dajú sa zadať aj jednotlivé súbory (`python -m dokumenty.dokument strana1.jpg strana2.png`).

**Čo urobí** s každou stranou:

1. **Strana** – oddelí papier od tmavého podkladu (ak je strana fotená na stole).
2. **Text** – odstráni písmo black-hat transformáciou jasu (tenké tmavé ťahy) a vyplní ho
   farbou okolitého papiera; plošná škvrna väčšia ako ťah písma ostane.
3. **Tlač** – nájde ilustrácie, rytiny a plnú tlač (aby sa nepovažovali za škvrny).
4. **Návrh miest** – nájde miesta, ktoré sa farbou líšia od papiera, a vyradí okraj strany,
   tlačené prvky, slabé fliačiky a zvyšky tlače.
5. **Maska** – okolo každého miesta vyreže okno, zväčší ho na 700 px a masku nájde algoritmus
   z časti 1 s podmienkou, že maska musí pokrývať navrhnuté miesto.
6. **Výrezy** – každú škvrnu vyreže zo strany bez textu ako samostatný záber (vstup pre
   určenie druhu).

Pre každú stranu vypíše počet navrhnutých miest, nájdených škvŕn a výrezov.

**Výstup v `dokumenty/vysledky/`** (priečinok sa pred spustením vyprázdni):

| súbor | obsah |
|---|---|
| `<strana>_prehlad.png` | **hlavný obrázok:** pôvodná strana \| strana bez textu s navrhnutými miestami \| výsledná maska |
| `<strana>_maska.png` | maska škvŕn celej strany |
| `<strana>_bez_textu.jpg` | strana po odstránení textu |
| `<strana>_vyrezy/` | výrez každej škvrny a v `masky/` jeho maska |

Najťažšie sú veľmi bledé baktérie (*Exiguobacterium*, *Arthrobacter*), ktorých farba sa od
papiera takmer nelíši – tie sa často nenájdu.

### 2.3 Syntetický test

```
python -m dokumenty.test_dokumenty --strany <fotky strán> --fotky images/D2
```

Napríklad na prázdnych vygenerovaných stranách z kroku 2.1:

```
python -m dokumenty.test_dokumenty --fotky images/D2 --strany images/testovacie_strany/prazdne/strana_1.png images/testovacie_strany/prazdne/strana_2.png images/testovacie_strany/prazdne/strana_3.png images/testovacie_strany/prazdne/strana_4.png
```

**Čo urobí:** na zadané strany 3-krát vloží po 4 škvrny (zakaždým iné druhy a polohy),
spustí hľadanie škvŕn a porovná výsledok so známymi maskami vložených škvŕn. Pre každú
škvrnu zistí, či bola nájdená (maska pokrýva aspoň polovicu), IoU, presnosť masky a jej
viditeľnosť (ΔE voči papieru); spočíta aj falošné nálezy.

Potrebuje masky škvŕn – predvolene `images/D2/masky/` z kroku 1.1, iné cez `--masky`.

**Výstup v `dokumenty/vysledky_test/`:** `suhrn.txt` (súhrn), `skvrny.csv` (každá vložená
škvrna) a náhľad každej strany (zelená = vložená škvrna, červená = maska programu).

---

## Súbory

```
analyzy/
├── requirements.txt
├── images/                  dáta (fotky, ručné masky, testovacie strany)
├── skvrny/
│   ├── maska.py             algoritmus hľadania masky
│   ├── vytvor_masky.py      1.1  masky pre priečinok fotiek
│   ├── rozdelenie.py        1.2  rozdelenie na train / test
│   ├── rozdelenie.csv            rozdelenie použité v práci
│   ├── vyhodnotenie.py      1.3  porovnanie s ručnými maskami
│   ├── vyber_kanalov.py     1.4  výber kanálov a metód
│   ├── subory.py            načítanie a ukladanie obrázkov
│   ├── docs/                technický popis jednotlivých skriptov
│   ├── grafy_z_prace/       grafy z pôvodnej analýzy v práci s popisom
│   └── vysledky/            výstupy skriptov
└── dokumenty/
    ├── dokument.py          2.2  celý postup na strane
    ├── dokument_tlac.py          strana, odstránenie textu, mapa tlače
    ├── dokument_miesta.py        návrh miest a filtre
    ├── generuj_strany.py    2.1  testovacie strany
    ├── test_dokumenty.py    2.3  syntetický test
    ├── docs/                technický popis
    └── vysledky/            výstupy skriptov
```

Podrobnejší technický popis (vzorce skóre, metriky, parametre) je v `skvrny/docs/`
a `dokumenty/docs/`.
