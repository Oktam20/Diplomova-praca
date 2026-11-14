"""Stavba určovacieho kľúča na trénovacích fotkách a overenie na testovacích.

    python -m klasifikacia.postav_kluc --fotky images/D2 --masky images/D2/masky [--uloz]

Štruktúra kľúča je zo struktura_kluca.json, prahy sa učia len na train (skvrny/rozdelenie.csv).
Úspešnosť na train sa odhaduje krížovou validáciou po kartičkách, konečné vyhodnotenie je na test.
"""
import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter
import numpy as np
import pandas as pd

from klasifikacia.crty import crty_skvrny
from klasifikacia.kluc import nacitaj, nauc_kluc, urci
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import nacitaj_masku, nacitaj_obrazok, najdi_fotku

PRIECINOK = Path(__file__).parent
STRUKTURA = PRIECINOK / "struktura_kluca.json"
KLUC = PRIECINOK / "kluc.json"
KLUC_APLIKACIE = PRIECINOK.parents[1] / "app" / "python" / "klasifikacia" / "kluc.json"

FOLDY = 5
SEED = 0
VYSLEDKY = {"urceny": ("určený druh (správne)", "#256abf"),
            "v_skupine": ("správny druh v skupine", "#6da7ec"),
            "zle": ("zle", "#d03b3b")}


def crty_fotky(uloha):
    fotka, cesta_fotky, cesta_masky = uloha
    obrazok, maska = nacitaj_obrazok(cesta_fotky), nacitaj_masku(cesta_masky)
    vysledok = crty_skvrny(obrazok, maska) if obrazok is not None and maska is not None else None
    return {"fotka": fotka, **(vysledok[0] if vysledok else {})}


def vypocitaj_crty(rozdelenie, fotky, masky):
    ulohy = [(f, najdi_fotku(fotky, f), masky / f"{f}.png") for f in rozdelenie.fotka]
    riadky = []
    with ProcessPoolExecutor() as pool:
        for poradie, riadok in enumerate(pool.map(crty_fotky, ulohy, chunksize=4), 1):
            riadky.append(riadok)
            print(f"\r{poradie}/{len(ulohy)} fotiek", end="")
    print()
    return rozdelenie.merge(pd.DataFrame(riadky), on="fotka")


def foldy(df):
    """Kartičky do FOLDY skupín, v rámci každého druhu zvlášť -> číslo foldu každej fotky."""
    rng = np.random.default_rng(SEED)
    fold = {}
    for _, skupina in df.groupby("druh"):
        vzorky = rng.permutation(sorted(skupina.vzorka.unique()))
        zaciatok = rng.integers(FOLDY)
        fold.update({v: (zaciatok + i) % FOLDY for i, v in enumerate(vzorky)})
    return df.vzorka.map(fold).to_numpy()


def vyhodnot(kluc, df):
    riadky = []
    for riadok in df.itertuples():
        u = urci(df.loc[riadok.Index].to_dict(), kluc)
        if riadok.druh not in u["druhy"]:
            vysledok = "zle"
        else:
            vysledok = "urceny" if len(u["druhy"]) == 1 else "v_skupine"
        riadky.append({"fotka": riadok.fotka, "druh": riadok.druh, "vzorka": riadok.vzorka, "vysledok": vysledok,
                       "urcenie": u["druh"] or "viac druhov", "druhy": ",".join(u["druhy"])})
    return pd.DataFrame(riadky, index=df.index)


def krizova_validacia(struktura, train):
    """Kľúč sa naučí bez kartičiek jedného foldu a určí ich fotky; opakuje sa pre každý fold."""
    fold = foldy(train)
    casti = [vyhodnot(nauc_kluc(struktura, train[fold != f]), train[fold == f]) for f in range(FOLDY)]
    return pd.concat(casti).loc[train.index]


def karticky(vysledky):
    """Kartička ako celok: výsledok jej najčastejšieho určenia."""
    def vysledok_karticky(skupina):
        najcastejsie = skupina.druhy.value_counts().index[0]
        return skupina[skupina.druhy == najcastejsie].vysledok.iloc[0]
    return vysledky.groupby("vzorka").apply(vysledok_karticky, include_groups=False)


def suhrn(vysledky):
    riadky = []
    for cast, v in vysledky.items():
        fotky = v.vysledok.value_counts(normalize=True)
        karty = karticky(v).value_counts(normalize=True)
        riadky.append({"cast": cast, "fotiek": len(v), "karticiek": v.vzorka.nunique(),
                       **{f"fotky_{k}": fotky.get(k, 0.0) for k in VYSLEDKY},
                       **{f"karticky_{k}": karty.get(k, 0.0) for k in VYSLEDKY}})
    return pd.DataFrame(riadky).set_index("cast")


def poradie_druhov(kluc):
    pod = kluc["ton"]["podskupiny"]
    return kluc["skupiny"]["tmave"] + pod["do_cervena"] + pod["stred"] + pod["do_zlta"]


def pruhy(ax, tabulka, popisy):
    y = np.arange(len(tabulka))
    zlava = np.zeros(len(tabulka))
    for kluc_vysledku, (popis, farba) in VYSLEDKY.items():
        hodnoty = tabulka[kluc_vysledku].to_numpy()
        ax.barh(y, hodnoty, left=zlava, color=farba, label=popis, height=0.7)
        for yi, (z, h) in enumerate(zip(zlava, hodnoty)):
            if h >= 0.08:
                ax.text(z + h / 2, yi, f"{h:.0%}", ha="center", va="center", fontsize=7, color="white")
        zlava += hodnoty
    ax.set_yticks(y, popisy, fontsize=8)
    ax.set_xlim(0, 1)
    ax.xaxis.set_major_formatter(PercentFormatter(1.0))


def graf_suhrn(tabulka, cesta):
    riadky = pd.DataFrame({k: [tabulka.loc["train_cv", f"fotky_{k}"], tabulka.loc["test", f"fotky_{k}"],
                               tabulka.loc["test", f"karticky_{k}"]] for k in VYSLEDKY})
    popisy = [f"train – krížová validácia\n{tabulka.loc['train_cv', 'fotiek']} fotiek",
              f"test – fotky\n{tabulka.loc['test', 'fotiek']} fotiek",
              f"test – kartičky\n{tabulka.loc['test', 'karticiek']} kartičiek"]
    fig, ax = plt.subplots(figsize=(8, 2.6))
    pruhy(ax, riadky, popisy)
    ax.invert_yaxis()
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.18), ncol=3, frameon=False, fontsize=8)
    ax.set_title("Úspešnosť určovacieho kľúča", loc="left")
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def graf_po_druhoch(vysledky, kluc, cesta):
    poradie = poradie_druhov(kluc)
    pocty = {c: v.druh.value_counts() for c, v in vysledky.items()}
    popisy = [f"{kluc['druhy'][d]} ({pocty['train_cv'].get(d, 0)} / {pocty['test'].get(d, 0)})" for d in poradie]
    fig, osi = plt.subplots(1, 2, figsize=(11, 4.8), sharey=True)
    for ax, (cast, nazov) in zip(osi, (("train_cv", "train – krížová validácia"), ("test", "test"))):
        v = vysledky[cast]
        tabulka = pd.DataFrame({k: [(v[v.druh == d].vysledok == k).mean() for d in poradie] for k in VYSLEDKY})
        pruhy(ax, tabulka, popisy)
        ax.set_title(nazov, loc="left")
    osi[0].invert_yaxis()
    osi[0].legend(loc="upper center", bbox_to_anchor=(1.05, -0.08), ncol=3, frameon=False, fontsize=8)
    fig.suptitle("Výsledok kľúča po druhoch (v zátvorke počet fotiek train / test)", x=0.01, ha="left")
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def graf_zameny(vysledky, kluc, cesta):
    poradie = poradie_druhov(kluc)
    stlpce = poradie + ["viac druhov"]
    matica = np.array([[(vysledky[vysledky.druh == d].urcenie == s).mean() for s in stlpce] for d in poradie])
    fig, ax = plt.subplots(figsize=(9, 6.5))
    ax.imshow(matica, cmap="Blues", vmin=0, vmax=1)
    for i in range(len(poradie)):
        for j in range(len(stlpce)):
            if matica[i, j] > 0:
                ax.text(j, i, f"{matica[i, j]:.0%}", ha="center", va="center", fontsize=7,
                        color="white" if matica[i, j] > 0.55 else "black")
    ax.set_xticks(range(len(stlpce)), [kluc["druhy"].get(s, s) for s in stlpce], rotation=45, ha="right", fontsize=8)
    ax.set_yticks(range(len(poradie)), [kluc["druhy"][d] for d in poradie], fontsize=8)
    ax.set_xlabel("určenie kľúčom")
    ax.set_ylabel("skutočný druh")
    ax.set_title("Zámeny na testovacích fotkách (podiel fotiek druhu)", loc="left")
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def vypis(tabulka, vysledky, kluc):
    for cast, nazov in (("train_cv", "train (krížová validácia)"), ("test", "test")):
        r = tabulka.loc[cast]
        print(f"{nazov}: {int(r.fotiek)} fotiek, určený druh správne {r.fotky_urceny:.1%}, v skupine "
              f"{r.fotky_v_skupine:.1%}, zle {r.fotky_zle:.1%} | kartičky ({r.karticiek}): "
              f"správne {r.karticky_urceny:.1%}, zle {r.karticky_zle:.1%}")
    print("\ntest po druhoch (určený správne):")
    test = vysledky["test"]
    for druh in poradie_druhov(kluc):
        v = test[test.druh == druh]
        print(f"  {kluc['druhy'][druh]:36s} {len(v):3d} fotiek  {(v.vysledok == 'urceny').mean():5.0%}")
    print(f"\nprahy: jas {kluc['jas']['prah']:.3f}, sýtosť {kluc['sytost']['prah']:.3f}, "
          f"tón {kluc['ton']['prah_cervena']:.1f}° / {kluc['ton']['prah_zlta']:.1f}°, textúra {kluc['textura']['prah']:.1f}")


def main():
    parser = argparse.ArgumentParser(description="Stavba určovacieho kľúča na train a overenie na test.")
    parser.add_argument("--fotky", type=Path, default=Path("images/D2"))
    parser.add_argument("--masky", type=Path, default=Path("images/D2/masky"), help="masky škvŕn (<fotka>.png)")
    parser.add_argument("--vystup", type=Path, default=PRIECINOK / "vysledky")
    parser.add_argument("--uloz", action="store_true", help=f"uložiť kľúč aj do {KLUC.name} a do aplikácie")
    args = parser.parse_args()
    args.vystup.mkdir(parents=True, exist_ok=True)

    crty = vypocitaj_crty(nacitaj_rozdelenie(), args.fotky, args.masky)
    crty.to_csv(args.vystup / "crty.csv", index=False)
    train, test = crty[crty.cast == "train"], crty[crty.cast == "test"]
    print(f"train {len(train)} fotiek / {train.vzorka.nunique()} kartičiek, "
          f"test {len(test)} fotiek / {test.vzorka.nunique()} kartičiek")

    struktura = nacitaj(STRUKTURA)
    kluc = nauc_kluc(struktura, train)
    vysledky = {"train_cv": krizova_validacia(struktura, train), "test": vyhodnot(kluc, test)}
    tabulka = suhrn(vysledky)

    pd.concat(v.assign(cast=c) for c, v in vysledky.items()).to_csv(args.vystup / "fotky.csv", index=False)
    tabulka.to_csv(args.vystup / "suhrn.csv")
    graf_suhrn(tabulka, args.vystup / "uspesnost.png")
    graf_po_druhoch(vysledky, kluc, args.vystup / "po_druhoch.png")
    graf_zameny(vysledky["test"], kluc, args.vystup / "zameny_test.png")

    kluc["uspesnost"] = {"train_cv": round(float(tabulka.loc["train_cv", "fotky_urceny"]), 4),
                         "test": round(float(tabulka.loc["test", "fotky_urceny"]), 4),
                         "test_karticky": round(float(tabulka.loc["test", "karticky_urceny"]), 4)}
    text = json.dumps(kluc, ensure_ascii=False, indent=1)
    (args.vystup / "kluc.json").write_text(text, encoding="utf-8")
    if args.uloz:
        for cesta in (KLUC, KLUC_APLIKACIE):
            cesta.write_text(text, encoding="utf-8")
    vypis(tabulka, vysledky, kluc)
    print(f"\nVýstupy sú v {args.vystup}" + (f"; kľúč uložený do {KLUC} a aplikácie" if args.uloz else ""))


if __name__ == "__main__":
    main()
