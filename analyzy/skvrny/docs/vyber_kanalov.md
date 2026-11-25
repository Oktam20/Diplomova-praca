# Výber kanálov a metód – `vyber_kanalov.py`

Prečo profily v `maska.py` obsahujú práve tieto farebné kanály a prahovacie metódy.

## Použitie

```
python -m skvrny.vyber_kanalov --fotky <fotografie> --rucne <ručné masky> [--znova]
```

Prvý beh vypočíta všetkých kandidátov trénovacích fotografií (trvá to niekoľko minút) a uloží ich
do `vysledky/kandidati.csv`. Ďalšie behy ich len načítajú (`--znova` ich prepočíta).

Výstup v `vysledky/`:

| súbor | obsah |
|---|---|
| `vyhry_kanalov_a_metod.png` | koľkokrát ktorý kanál a metóda dali vybranú masku (sivé = jasové kanály) |
| `vylucovanie.png` | priemerný Dice počas spätného vylučovania, zvýraznené profily |
| `vylucovanie.csv` | každý krok: čo sa odobralo, zostávajúce kanály a metódy, Dice |

## Technická špecifikácia

Používa sa **len trénovacia množina** z `rozdelenie.csv`.

1. **Kandidáti** – pre každú fotografiu všetky kandidátne masky plnej sady: 19 kanálov × 7 metód
   × 2 polarity = 266 kandidátov, každý so skóre (`maska.skore`) a Dice voči ručnej maske. Vďaka tomu
   sa dá pre ľubovoľnú sadu kanálov a metód bez nového výpočtu zistiť, ktorý kandidát by vyhral
   a aký je jeho Dice.
2. **Výhry** – so všetkými kanálmi a metódami sa spočíta, kto vyhral. Najčastejšie vyhráva HSV_S.
   Jasové kanály (HSV_V, Lab_L, YCbCr_Y, XYZ_Y, XYZ_Z, YUV_Y, Gray) nevyhrávajú takmer nikdy a ich
   vylúčenie nezmení ani jednu masku: škvrna sa od papiera líši hlavne farbou, nie jasom (tieň
   a nerovnomerné svetlo menia jas, nie farbu). Preto sa vylúčia a ostane **sada 12 × 7**.
3. **Spätné vylučovanie** – začína sa sadou 12 kanálov × 7 metód. V každom kroku sa skúsi odobrať
   každý kanál a každá metóda a natrvalo sa odoberie ten prvok, bez ktorého je priemerný Dice
   vybraných masiek najvyšší. Pokračuje sa, kým neostanú 2 kombinácie.
4. **Profily** sa z tejto cesty vyberú podľa pevných pravidiel:
   - **Kvalitný** – najmenšia sada, ktorej Dice nie je nižší ako Dice sady 12 × 7,
   - **Rýchly** – najmenšia sada, ktorej Dice je najviac o 0,01 nižší ako Dice sady 12 × 7.

## Výsledok

| krok | sada | Dice train |
|---|---|---|
| začiatok | 12 × 7 | 0,853 |
| po odobratí Mean, RGB_B, Triangle, RGB_G, Lab_b | 9 × 5 | 0,858 |
| **Kvalitný** | 6 × 4: HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V × Yen, Li, ISODATA, Minimum | 0,854 |
| **Rýchly** | 4 × 3: HSV_S, Lab_a, XYZ_X, YUV_U × Yen, ISODATA, Minimum | 0,843 |

Prvé odobratia Dice dokonca zvýšia: tieto prvky prinášali do výberu len nevhodných kandidátov.
Mnohé sady sa líšia len v tisícinách Dice, chromatické kanály sú do veľkej miery zameniteľné.
Každý prvok profilu pritom prispieva, bez ktoréhokoľvek z nich Dice klesne. Na testovacej množine
dosahuje profil Rýchly Dice 0,832, rovnako ako sada 12 × 7 (0,830).

Skript vypíše zvolené profily. V `maska.py` sú zapísané v `PROFILY`.
