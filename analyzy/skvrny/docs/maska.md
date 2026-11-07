# Hľadanie masky – `maska.py`, `vytvor_masky.py`

## Použitie

Celý priečinok:

```
python -m skvrny.vytvor_masky <priečinok s fotkami> [--vystup <priečinok>] [--profil rychly|kvalitny]
```

- masky sa uložia ako `<fotka>.png` (0 = pozadie, 255 = škvrna) do `<priečinok>/masky/`,
- `vitazi.csv` – pre každú fotku víťazný kanál, metóda, smer prahu a skóre.

Z Pythonu:

```python
from skvrny.maska import najdi_masku
from skvrny.subory import nacitaj_obrazok

maska, vitaz = najdi_masku(nacitaj_obrazok("fotka.jpg"))
print(vitaz["kanal"], vitaz["metoda"], vitaz["smer"], vitaz["skore"])
```

## Technická špecifikácia

Vstup: farebná fotka (BGR, uint8) s jednou škvrnou približne v strede záberu.
Výstup: binárna maska rovnakého rozmeru.

1. **Zmenšenie** – ak je dlhšia strana väčšia ako 1200 px, fotka sa zmenší (ako v mobilnej
   aplikácii); maska sa na konci zväčší späť.
2. **Farebné kanály** (`farebne_kanaly`) – 19 kanálov: RGB, HSV, CIELAB, YCbCr, XYZ, YUV
   (po 3) a šedotónový. Profil určuje, ktoré sa použijú.
3. **Vyhladenie** každého kanála Gaussovým filtrom 5 × 5.
4. **Prahovanie** – pre každú metódu (`METODY`) sa vypočíta prah a vzniknú dve masky:
   škvrna *pod* prahom a škvrna *nad* prahom (žltá škvrna je napr. v Cb nižšie ako papier,
   v Cr vyššie).

   | metóda | princíp |
   |---|---|
   | Otsu | maximalizuje rozptyl medzi dvoma triedami |
   | Triangle | najväčšia vzdialenosť histogramu od priamky vrchol–koniec |
   | Yen | maximalizuje entropické kritérium dvoch tried |
   | Li | minimalizuje krížovú entropiu |
   | Isodata | iteratívne: prah = priemer stredných hodnôt oboch tried |
   | Mean | priemerná hodnota kanála |
   | Minimum | minimum medzi dvoma vrcholmi vyhladeného histogramu |

5. **Čistenie** (`vycisti`) – morfologické uzavretie a otvorenie elipsou 9 × 9, vyplnenie
   dier, odstránenie oblastí menších ako 0,2 % plochy (aspoň 150 px) a oblastí, ktoré sa
   dotýkajú okraja fotky (tam je papier, nie škvrna).
6. **Skóre** (`skore`):

   ```
   skóre = kruhovitosť + bonus za pokrytie − penalizácia + 0,3 · ln(1 + kontrast)
   ```

   - kruhovitosť `4π · plocha / obvod²` oblastí, vážená ich plochou (škvrny sú zhruba okrúhle),
   - pokrytie (podiel plochy masky) v rozsahu 2–90 % → +0,3, mimo neho záporné podľa
     vzdialenosti od stredu rozsahu,
   - penalizácia 0,04 za každú oblasť nad 6 (rozpadnutá maska),
   - kontrast (`kontrast`) = |priemer kanála v maske − priemer v leme| / (smerodajná odchýlka
     lemu + 1), lem = pixely do 15 % polomeru masky za jej okrajom. Bez neho skóre často
     vybralo len tmavé jadro škvrny.
7. **Výber** – vyhrá kandidát s najvyšším skóre; pri zhode ten, ktorý je v poradí skôr.

## Profily

| profil | kanály | metódy | kandidátov |
|---|---|---|---|
| `rychly` (predvolený, aplikácia) | HSV_S, Lab_a, XYZ_X, YUV_U | Yen, Isodata, Minimum | 24 |
| `kvalitny` | HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V | Yen, Li, Isodata, Minimum | 48 |

Ako vznikli, popisuje [vyber_kanalov.md](vyber_kanalov.md).
