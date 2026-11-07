# Výber kanálov a metód – `vyber_kanalov.py`

Prečo maska používa práve kanály a metódy z profilov v `maska.py`.

## Použitie

```
python -m skvrny.vyber_kanalov --fotky <fotky> --rucne <ručné masky> [--znova]
```

Prvý beh vypočíta všetkých kandidátov trénovacích fotiek (trvá to niekoľko minút) a uloží ich
do `vysledky/kandidati.csv`; ďalšie behy ich len načítajú (`--znova` ich prepočíta).

Výstup v `vysledky/`:

| súbor | obsah |
|---|---|
| `vyhry_kanalov_a_metod.png` | koľkokrát ktorý kanál a metóda dali vybranú masku (sivé = jasové kanály) |
| `vylucovanie.png` | priemerný Dice počas postupného vylučovania, zvýraznené profily |
| `vylucovanie.csv` | každý krok: čo sa odobralo, zostávajúce kanály a metódy, Dice |

## Technická špecifikácia

Používajú sa **len trénovacie fotky** z `rozdelenie.csv`.

1. **Kandidáti** – pre každú fotku všetkých 19 kanálov × 7 metód × 2 smery prahu (266
   kandidátov), každý so skóre (`maska.skore`) a Dice voči ručnej maske. Vďaka tomu sa dá
   pre ľubovoľnú sadu kanálov a metód bez nového výpočtu zistiť, ktorý kandidát by vyhral
   a aký je jeho Dice.
2. **Výhry** – pri všetkých kanáloch a metódach sa spočíta, kto vyhral. Jasové kanály
   (HSV_V, Lab_L, YCbCr_Y, XYZ_Y, XYZ_Z, YUV_Y, Gray) v práci takmer nikdy nevyhrali – škvrna
   sa od papiera líši hlavne farbou, nie jasom (tieň mení jas, nie farbu). Preto sa vylúčia.
3. **Postupné vylučovanie** – začína sa od 12 zvyšných kanálov × 7 metód. V každom kroku sa
   skúsi odobrať každý kanál a každá metóda a natrvalo sa odoberie ten, bez ktorého je
   priemerný Dice vybraných masiek najvyšší. Pokračuje sa, kým neostanú 2 kombinácie.
4. **Profily** sa z cesty vyberú podľa pevných pravidiel:
   - `kvalitny` – najmenšia sada, ktorej Dice nie je nižší ako na začiatku,
   - `rychly` – najmenšia sada, ktorej Dice je najviac o 0,01 nižší ako na začiatku.

Skript vypíše zvolené profily; v `maska.py` sú zapísané ako `PROFILY`.
