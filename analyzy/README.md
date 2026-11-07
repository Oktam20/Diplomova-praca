# Analýzy

Python kód k diplomovej práci. Hľadá masku škvrny (ktoré pixely patria škvrne) na dvoch
druhoch fotiek a vyhodnocuje ju.

| priečinok | čo rieši |
|---|---|
| [skvrny/](skvrny/README.md) | **detailný záber jednej škvrny** – hľadanie masky, vyhodnotenie voči ručným maskám, rozdelenie na train / test, výber farebných kanálov |
| [dokumenty/](dokumenty/README.md) | **strana dokumentu** s textom a ilustráciami – odstránenie textu, návrh miest so škvrnami, maska rovnakým algoritmom ako pri detailnom zábere, syntetický test |

Dokumenty používajú algoritmus masky zo `skvrny/maska.py`.

## Inštalácia

```
pip install -r requirements.txt
```

## Spustenie

Všetky skripty sa spúšťajú z tohto priečinka (`analyzy/`) ako moduly, napríklad:

```
python -m skvrny.vytvor_masky images/D2
python -m dokumenty.dokument images/testovacie_strany
```

Výstupy sa ukladajú do `skvrny/vysledky/` a `dokumenty/vysledky/`.

## Dáta

V priečinku `images/`:

- `D2/` – 484 fotiek škvŕn (127 kartičiek, 12 druhov, telefón Oppo Reno5z),
  názov `<vzorka>_<časť>_<Rod-druh>_<telefón>.jpg`, napr. `01_a_Epicoccum-layunese_OppoReno5z.jpg`,
- `D2masks/` – ručne obkreslené masky `<rovnaký názov>.png` (škvrna biela, pozadie čierne),
- `testovacie_strany/` – vygenerované strany dokumentov so škvrnami (`python -m dokumenty.generuj_strany`).
