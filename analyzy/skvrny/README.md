# Škvrny – maska na detailnom zábere jednej škvrny

Maska sa hľadá bez trénovania: fotka sa rozloží na farebné kanály, každý kanál sa prahuje
niekoľkými automatickými metódami a vyberie sa maska, ktorá najviac vyzerá ako škvrna
(okrúhla, primerane veľká a s ostrým prechodom do okolia).

## Postup

Spúšťa sa z priečinka `analyzy/`:

```
# 1. masky pre všetky fotky v priečinku -> images/D2/masky/<fotka>.png
python -m skvrny.vytvor_masky images/D2

# 2. rozdelenie na train / test (rozdelenie.csv už existuje, len sa načíta)
python -m skvrny.rozdelenie images/D2

# 3. porovnanie s ručnými maskami -> skvrny/vysledky/
python -m skvrny.vyhodnotenie --masky images/D2/masky --rucne images/D2masks --fotky images/D2

# 4. analýza, ktoré kanály a metódy sú potrebné (len train) -> skvrny/vysledky/
python -m skvrny.vyber_kanalov --fotky images/D2 --rucne images/D2masks
```

## Súbory

| súbor | čo robí | dokumentácia |
|---|---|---|
| `maska.py` | algoritmus hľadania masky | [docs/maska.md](docs/maska.md) |
| `vytvor_masky.py` | masky pre celý priečinok fotiek | [docs/maska.md](docs/maska.md) |
| `rozdelenie.py` | rozdelenie fotiek na train / test | [docs/rozdelenie.md](docs/rozdelenie.md) |
| `vyhodnotenie.py` | porovnanie s ručnými maskami, grafy | [docs/vyhodnotenie.md](docs/vyhodnotenie.md) |
| `vyber_kanalov.py` | výber farebných kanálov a metód prahovania | [docs/vyber_kanalov.md](docs/vyber_kanalov.md) |
| `subory.py` | načítanie / ukladanie obrázkov, údaje z názvu fotky | – |
| `rozdelenie.csv` | použité rozdelenie na train / test | [docs/rozdelenie.md](docs/rozdelenie.md) |
| `grafy_z_prace/` | grafy z analýzy v diplomovej práci s popisom | [grafy_z_prace/README.md](grafy_z_prace/README.md) |
| `vysledky/` | výstupy skriptov (grafy, tabuľky) | – |
