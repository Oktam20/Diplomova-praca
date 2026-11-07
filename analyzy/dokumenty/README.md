# Dokumenty – škvrny na strane s textom a ilustráciami

Algoritmus masky zo `skvrny/` je stavaný na jednu škvrnu na čistom papieri. Na strane
dokumentu zlyhá: text je tmavší ako papier, škvŕn je veľa a sú malé. Preto sa najprv
odstráni text, navrhnú sa miesta so škvrnami a masku v okne okolo každého miesta nájde
ten istý algoritmus ako pri detailnom zábere.

## Postup

Spúšťa sa z priečinka `analyzy/`:

```
# testovacie strany so škvrnami -> images/testovacie_strany/ (+ zoznam.csv, kde je ktorá škvrna)
python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks

# škvrny na stranách (súbory alebo celý priečinok) -> dokumenty/vysledky/
python -m dokumenty.dokument images/testovacie_strany

# syntetický test (škvrny z datasetu vložené na strany) -> dokumenty/vysledky_test/
python -m dokumenty.test_dokumenty --strany strana1.jpg strana2.png --fotky images/D2
```

Test potrebuje masky škvŕn (predvolene `images/D2/masky/` z `python -m skvrny.vytvor_masky images/D2`).

## Súbory

| súbor | čo robí | dokumentácia |
|---|---|---|
| `dokument.py` | celý postup: okná, maska vlastným algoritmom, výrezy, prehľad | [docs/dokument.md](docs/dokument.md) |
| `dokument_miesta.py` | návrh miest: rozdiel farby voči papieru a filtre | [docs/dokument.md](docs/dokument.md) |
| `dokument_tlac.py` | strana, odstránenie textu, mapa tlače, odhad papiera | [docs/dokument.md](docs/dokument.md) |
| `test_dokumenty.py` | syntetický test | [docs/test_dokumenty.md](docs/test_dokumenty.md) |
| `generuj_strany.py` | testovacie strany s textom a vloženými škvrnami | – |
| `vysledky/` | výstupy skriptov | – |
