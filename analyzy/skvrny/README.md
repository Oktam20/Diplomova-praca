# Škvrny – maska na detailnom zábere jednej škvrny

Maska sa hľadá bez trénovania. Fotografia sa rozloží na farebné kanály a každý kanál sa prahuje
niekoľkými automatickými metódami v oboch polaritách. Z takto vzniknutých kandidátnych masiek sa
vyberie tá, ktorá má najvyššie skóre: je okrúhla, primerane veľká, nerozpadnutá a končí tam, kde
sa farba voči okoliu naozaj mení. Ktoré kanály a metódy sa skúšajú, určuje profil:

| profil | kanály | metódy | kandidátov | Dice train | Dice test |
|---|---|---|---|---|---|
| **Rýchly** (predvolený, aplikácia aj masky pre kľúč) | HSV_S, Lab_a, XYZ_X, YUV_U | Yen, ISODATA, Minimum | 24 | 0,843 | **0,832** |
| **Kvalitný** | HSV_H, HSV_S, Lab_a, XYZ_X, YUV_U, YUV_V | Yen, Li, ISODATA, Minimum | 48 | 0,854 | 0,840 |
| sada 12 × 7 (referencia) | všetky okrem jasových | všetkých 7 | 168 | 0,853 | 0,830 |

Dice je zhoda s ručne obkreslenou maskou. Profily vznikli spätným vylučovaním na trénovacej
množine ([docs/vyber_kanalov.md](docs/vyber_kanalov.md)).

## Postup

Spúšťa sa z priečinka `analyzy/`:

```
# 1. masky pre všetky fotografie v priečinku -> images/D2/masky/<fotka>.png
python -m skvrny.vytvor_masky images/D2

# 2. rozdelenie na trénovaciu a testovaciu množinu (rozdelenie.csv už existuje, len sa načíta)
python -m skvrny.rozdelenie images/D2

# 3. porovnanie s ručnými maskami -> skvrny/vysledky/
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2

# 4. výber kanálov a metód, profily (len trénovacia množina) -> skvrny/vysledky/
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks

# 5. profily Rýchly a Kvalitný na testovacej množine, presnosť a čas -> skvrny/vysledky/profily_test.csv
python -m skvrny.porovnanie_profilov --fotky images/D2 --rucne images/D2masks

# 6. tabuľka, testy a grafy masky pre kapitolu Výskum -> latex-final/obrazky/
python -m skvrny.grafy_vyskumu
```

## Súbory

| súbor | čo robí | dokumentácia |
|---|---|---|
| `maska.py` | algoritmus masky: farebné kanály, prahovanie, čistenie, skóre, profily (`PROFILY`) | [docs/maska.md](docs/maska.md) |
| `morfologia.py` | dilatácia a erózia s eliptickým jadrom (rovnaký výsledok ako OpenCV, rýchlejšie) | – |
| `vytvor_masky.py` | masky pre celý priečinok fotografií | [docs/maska.md](docs/maska.md) |
| `rozdelenie.py` | rozdelenie na trénovaciu a testovaciu množinu | [docs/rozdelenie.md](docs/rozdelenie.md) |
| `rozdelenie.csv` | rozdelenie použité v práci | [docs/rozdelenie.md](docs/rozdelenie.md) |
| `vyhodnotenie.py` | porovnanie s ručnými maskami, grafy | [docs/vyhodnotenie.md](docs/vyhodnotenie.md) |
| `vyber_kanalov.py` | výber farebných kanálov a prahovacích metód, polarita, prínos prvkov profilov, profily | [docs/vyber_kanalov.md](docs/vyber_kanalov.md) |
| `porovnanie_profilov.py` | presnosť a čas profilov Rýchly a Kvalitný (sekvenčne) | – |
| `grafy_vyskumu.py` | súhrn variantov s intervalmi, Wilcoxonove testy a grafy pre kapitolu Výskum (sady 12 × 7 a základná metóda sú zo staršej analýzy v `backend/`) | – |
| `subory.py` | načítanie a ukladanie obrázkov, údaje z názvu fotografie | – |
| `grafy_z_prace/` | grafy z kapitoly Výskum s popisom | [grafy_z_prace/README.md](grafy_z_prace/README.md) |
| `vysledky/` | výstupy skriptov (grafy, tabuľky) | – |
