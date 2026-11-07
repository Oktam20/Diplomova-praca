# Rozdelenie na train / test – `rozdelenie.py`

## Použitie

```
python -m skvrny.rozdelenie <priečinok s fotkami> [--znova]
```

Ak `rozdelenie.csv` existuje, len sa načíta a vypíšu sa počty; `--znova` vytvorí nové
a prepíše ho. Graf sa uloží do `vysledky/rozdelenie.png`.

Ostatné skripty rozdelenie čítajú funkciou `nacitaj_rozdelenie()`.

## Technická špecifikácia

- **Po kartičkách** – fotky a–d jednej kartičky sú zábery tej istej kolónie pri rovnakom
  svetle. Keby boli časť v train a časť v test, výsledok na teste by bol príliš optimistický.
  Preto idú všetky fotky kartičky do rovnakej časti.
- **Po druhoch** – z každého druhu ide do testu `round(0,2 · počet kartičiek)`, aspoň jedna,
  aby bol v teste zastúpený každý druh.
- **Pevný seed 2026** – rozdelenie sa dá zopakovať.

`rozdelenie.csv`: `fotka, vzorka, druh, cast` (cast = `train` / `test`).
V práci: train 101 kartičiek / 385 fotiek, test 26 kartičiek / 99 fotiek.

Na testovacích fotkách sa nič neladí – ani algoritmus masky, ani výber kanálov.
