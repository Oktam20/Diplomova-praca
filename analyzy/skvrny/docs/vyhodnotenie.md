# Vyhodnotenie masiek – `vyhodnotenie.py`

## Použitie

```
python -m skvrny.vyhodnotenie --masky <automatické masky> --rucne <ručné masky> [--fotky <fotky>]
```

Porovnajú sa fotky zo zoznamu `rozdelenie.csv` (iný zoznam: `--rozdelenie`). Masky sa
hľadajú ako `<fotka>.png` v oboch priečinkoch.

Výstup v `vysledky/`:

| súbor | obsah |
|---|---|
| `vyhodnotenie.csv` | metriky každej fotky |
| `suhrn.csv` | priemery pre train, test a všetky fotky |
| `dice_histogram.png` | rozdelenie Dice na train a test |
| `dice_po_druhoch.png` | priemerný Dice každého druhu |
| `ukazky.png` | najlepšie, typické a najhoršie fotky (len s `--fotky`): zelená = ručná maska, červená = automatická |

## Technická špecifikácia

Ručná maska je správna odpoveď. Pre každú fotku sa spočítajú pixely
TP (škvrna v oboch maskách), FP (len v automatickej), FN (len v ručnej):

| metrika | vzorec | význam |
|---|---|---|
| Dice | 2TP / (2TP + FP + FN) | celková zhoda masiek (0–1) |
| IoU | TP / (TP + FP + FN) | prekryv; IoU ≥ 0,5 sa bežne považuje za správne nájdený objekt |
| presnosť | TP / (TP + FP) | koľko z automatickej masky je naozaj škvrna |
| citlivosť | TP / (TP + FN) | koľko zo škvrny maska zachytila |

Ak má automatická maska iný rozmer, zmení sa na rozmer ručnej. Prázdna maska má všetky
metriky 0.

`suhrn.csv` obsahuje priemer metrík, medián Dice a podiel fotiek s IoU ≥ 0,5.
