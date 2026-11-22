# Dokumenty – škvrny na strane s textom a ilustráciami

Algoritmus masky zo `skvrny/` je stavaný na jednu škvrnu na čistom papieri. Na strane dokumentu
by zlyhal: najtmavšia štruktúra na strane je text, škvŕn je viac a sú malé voči strane a papier
starých dokumentov nemá jednotnú farbu. Hľadanie sa preto delí na dve úlohy. Najprv sa nájde,
**kde** sú škvrny, a až potom sa v okne okolo každého miesta nájde ich presná maska tým istým
algoritmom ako na detailnom zábere (profil Rýchly):

| krok | čo urobí | súbor |
|---|---|---|
| **Príprava strany** | oddelí papier od podkladu, odhadne hrúbku písma a odstráni text (black-hat) | `dokument_tlac.py` |
| **Model papiera a tlače** | farba papiera v každom mieste strany, mapa ilustrácií a plnej tlače | `dokument_tlac.py` |
| **Hľadanie miest škvŕn** | farebný rozdiel ΔE od papiera s hysterézou, vyradenie tlače, okraja, textu a slabých nálezov | `dokument_miesta.py` |
| **Maska v okne a výrezy** | maska algoritmom detailného záberu v okne okolo miesta, zlúčenie a výrezy škvŕn | `dokument.py` |

Výrez každej škvrny má rovnakú podobu ako detailný záber, takže z neho určovací kľúč určí druh
rovnako. Technický popis s parametrami: [docs/dokument.md](docs/dokument.md).

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
| `dokument.py` | celý postup na strane: okná, maska v okne, výrezy, prehľad | [docs/dokument.md](docs/dokument.md) |
| `dokument_tlac.py` | príprava strany (maska strany, odstránenie textu), mapa tlače, odhad papiera | [docs/dokument.md](docs/dokument.md) |
| `dokument_miesta.py` | hľadanie miest škvŕn: rozdiel farby voči papieru a filtre | [docs/dokument.md](docs/dokument.md) |
| `generuj_strany.py` | testovacie strany s textom a vloženými škvrnami | [docs/test_dokumenty.md](docs/test_dokumenty.md) |
| `test_dokumenty.py` | syntetický test: vložené škvrny so známou maskou a ich vyhodnotenie | [docs/test_dokumenty.md](docs/test_dokumenty.md) |
| `vysledky/` | výstupy skriptov | – |
