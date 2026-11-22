# Algoritmus masky – `maska.py`, `vytvor_masky.py`

## Použitie

Celý priečinok:

```
python -m skvrny.vytvor_masky <priečinok s fotografiami> [--vystup <priečinok>] [--profil rychly|kvalitny]
```

- masky sa uložia ako `<fotka>.png` (0 = pozadie, 255 = škvrna) do `<priečinok>/masky/`,
- `vitazi.csv` – pre každú fotografiu víťazný kanál, metóda, polarita (`smer`: `pod` / `nad`) a skóre.

Z Pythonu:

```python
from skvrny.maska import najdi_masku
from skvrny.subory import nacitaj_obrazok

maska, vitaz = najdi_masku(nacitaj_obrazok("fotka.jpg"))          # profil Rýchly
print(vitaz["kanal"], vitaz["metoda"], vitaz["smer"], vitaz["skore"])
```

## Technická špecifikácia

Vstup: farebná fotografia (BGR, uint8) s jednou škvrnou približne v strede záberu.
Výstup: binárna maska rovnakého rozmeru.

### Kandidátne masky

1. **Zmenšenie** – ak je dlhšia strana väčšia ako 1200 px, fotografia sa zmenší (rovnako ako
   v aplikácii). Maska sa na konci zväčší späť.
2. **Farebné kanály** (`farebne_kanaly`) – k dispozícii je 19 kanálov: RGB, HSV, Lab, YCbCr, XYZ,
   YUV (po 3) a šedotónový `Gray`. Profil určuje, ktoré sa použijú.
3. **Vyhladenie** každého kanála Gaussovým filtrom 5 × 5.
4. **Prahovanie** – pre každú metódu profilu sa vypočíta prah a vzniknú dve kandidátne masky,
   jedna pre každú **polaritu**: škvrna *pod* prahom a škvrna *nad* prahom. Napríklad žltá škvrna
   je v kanáli YCbCr_Cb nižšie ako papier, v kanáli YCbCr_Cr vyššie. Ak viac metód dá na tom istom
   kanáli prah, ktorý vytvorí rovnakú masku, kandidát sa vytvorí len raz.

   | metóda | princíp |
   |---|---|
   | Otsu | maximalizuje rozptyl medzi dvoma triedami |
   | Triangle | najväčšia vzdialenosť histogramu od priamky vrchol–koniec |
   | Yen | maximalizuje entropické kritérium dvoch tried |
   | Li | minimalizuje krížovú entropiu |
   | ISODATA | iteratívne: prah = priemer stredných hodnôt oboch tried |
   | Mean | priemerná hodnota kanála |
   | Minimum | minimum medzi dvoma vrcholmi vyhladeného histogramu |

### Čistenie a výber masky

5. **Čistenie** (`vycisti`) – morfologické uzavretie a otvorenie elipsou 9 × 9, vyplnenie dier,
   odstránenie oblastí menších ako 0,2 % plochy (aspoň 150 px) a oblastí, ktoré sa dotýkajú okraja
   fotografie (tam je papier, nie škvrna).
6. **Skóre** (`skore`):

   ```
   skóre = kruhovitosť + bonus za pokrytie − penalizácia za rozpad + 0,3 · ln(1 + kontrast)
   ```

   - **kruhovitosť** `4π · plocha / obvod²` oblastí masky, priemer vážený ich plochou (škvrny sú
     zhruba okrúhle),
   - **pokrytie** (podiel plochy masky) v rozsahu 2–90 % → bonus +0,3, mimo neho záporná hodnota
     podľa vzdialenosti od stredu rozsahu,
   - **penalizácia** 0,04 za každú oblasť nad 6 (rozpadnutá maska),
   - **kontrast voči okoliu** (`kontrast`) = |priemer kanála v maske − priemer v leme| / (smerodajná
     odchýlka lemu + 1). Lem sú pixely mimo masky do vzdialenosti 15 % ekvivalentného polomeru
     masky (aspoň 3 px). Ak maska zachytí celú škvrnu, lem leží na papieri a kontrast je vysoký.
     Ak zachytí len jadro, v leme ostane zvyšok škvrny a kontrast je nízky. Váha 0,3 je zvolená
     na trénovacej množine (plató medzi 0,2 a 1,3, vo 4 z 5 foldov krížovej validácie po kartičkách).
7. **Výber** – vyhrá kandidát s najvyšším skóre. Pri zhode ten, ktorý je v poradí kanálov a metód
   skôr.

## Profily

| profil | kanály | metódy | kandidátov | Dice train | Dice test |
|---|---|---|---|---|---|
| `rychly` (predvolený, aplikácia aj masky pre kľúč) | HSV_S, Lab_a, XYZ_X, YUV_U | Yen, ISODATA, Minimum | 24 | 0,843 | 0,832 |
| `kvalitny` | HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V | Yen, Li, ISODATA, Minimum | 48 | 0,854 | – |

Ako profily vznikli, popisuje [vyber_kanalov.md](vyber_kanalov.md). Jasové kanály, ktoré sa
nepoužívajú, sú v `JASOVE_KANALY`.
