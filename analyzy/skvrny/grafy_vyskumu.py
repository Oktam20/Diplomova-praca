import argparse
import shutil
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import wilcoxon

from klasifikacia.vzhlad import ATRAMENT2, CERVENA, MODRA, MODRA_TMAVA, TLMENA, TMAVE, os_grafu
from skvrny.maska import PROFILY
from skvrny.rozdelenie import SUBOR
from skvrny.subory import VYSLEDKY

KORENE = Path(__file__).resolve().parents
STARE = KORENE[3] / "backend" / "backend_app" / "09_analyza_presnosti_masiek" / "vysledky"
OBRAZKY = KORENE[2] / "latex-final" / "obrazky"
STLPCE = ["fotka", "dice", "iou", "presnost", "citlivost"]
NAZVY = {
    "zakladna": "základná metóda (Otsu na jase)",
    "sada_12x7_bez": "12 × 7, základné skóre",
    "sada_12x7": "12 × 7, skóre s kontrastom",
    "kvalitny": "profil Kvalitný (6 × 4)",
    "rychly": "profil Rýchly (4 × 3)",
}
FARBY = {"sada_12x7_bez": TLMENA, "sada_12x7": TMAVE, "kvalitny": MODRA_TMAVA, "rychly": MODRA}


def nacitaj_varianty(vysledky, stare):
    """Metriky každej fotky pre všetky varianty – sady 12 × 7 a základná metóda zo staršej analýzy presnosti."""
    casti = []
    starsie = pd.read_csv(stare / "vylepsenie_metriky.csv")
    for povodny, novy in (("produkcia", "sada_12x7_bez"), ("produkcia_kontrast", "sada_12x7")):
        casti.append(starsie[starsie.variant == povodny][STLPCE].assign(variant=novy))
    zakladna = pd.read_csv(stare / "metriky_po_fotkach.csv")
    casti.append(zakladna[zakladna.variant == "zakladna"][STLPCE].assign(variant="zakladna"))

    rychly = pd.read_csv(vysledky / "vyhodnotenie.csv")
    casti.append(rychly[STLPCE].assign(variant="rychly"))
    test = pd.read_csv(vysledky / "profily_test.csv")
    casti.append(test[test.profil == "kvalitny"][STLPCE].assign(variant="kvalitny"))

    kandidati = pd.read_csv(vysledky / "kandidati.csv")
    kanaly, metody = PROFILY["kvalitny"]
    kandidati = kandidati[kandidati.kanal.isin(kanaly) & kandidati.metoda.isin(metody)]
    vitazi = kandidati.loc[kandidati.groupby("fotka").skore.idxmax(), ["fotka", "dice"]]
    casti.append(vitazi.assign(variant="kvalitny"))

    rozdelenie = pd.read_csv(SUBOR, dtype={"vzorka": str})[["fotka", "vzorka", "druh", "cast"]]
    return pd.concat(casti, ignore_index=True).merge(rozdelenie, on="fotka"), test


def interval(tabulka, rng, pocet=5000):
    """95 % interval priemerného Dice – bootstrap, ktorý prevzorkúva celé kartičky."""
    karticky = tabulka.groupby("vzorka").dice.agg(["sum", "size"])
    sucty, pocty = karticky["sum"].to_numpy(), karticky["size"].to_numpy()
    vyber = rng.integers(0, len(sucty), (pocet, len(sucty)))
    return np.percentile(sucty[vyber].sum(axis=1) / pocty[vyber].sum(axis=1), [2.5, 97.5])


def suhrn(varianty, casy):
    rng = np.random.default_rng(2026)
    riadky = []
    for variant in NAZVY:
        for cast in ("train", "test"):
            d = varianty[(varianty.variant == variant) & (varianty.cast == cast)]
            dolna, horna = interval(d, rng)
            riadky.append({"variant": variant, "cast": cast, "dice": d.dice.mean(), "dolna": dolna, "horna": horna,
                           "iou": d.iou.mean(), "presnost": d.presnost.mean(), "citlivost": d.citlivost.mean(),
                           "iou_aspon_05": (d.iou >= 0.5).mean(), "zlych": int((d.dice < 0.7).sum())})
    tabulka = pd.DataFrame(riadky)
    tabulka["cas_ms"] = tabulka.variant.map(casy.groupby("profil").ms.median())
    return tabulka


def porovnaj_varianty(varianty, a, b, cast):
    """Párový Wilcoxonov test na priemeroch kartičiek."""
    x = varianty[(varianty.variant == a) & (varianty.cast == cast)].groupby("vzorka").dice.mean()
    y = varianty[(varianty.variant == b) & (varianty.cast == cast)].groupby("vzorka").dice.mean()
    rozdiel = x - y
    print(f"{cast}: {a} − {b}: {rozdiel.mean():+.3f}, lepší {(rozdiel > 1e-9).sum()} : {(rozdiel < -1e-9).sum()}, "
          f"p = {wilcoxon(x, y).pvalue:.2g}")


def graf_test(tabulka, cesta):
    poradie = ["sada_12x7_bez", "sada_12x7", "kvalitny", "rychly"]
    fig, osi = plt.subplots(1, 2, figsize=(9, 2.8), sharey=True)

    for ax, cast, nadpis in zip(osi, ("train", "test"),
                                ("trénovacia množina (385 fotografií)", "testovacia množina (99 fotografií)")):
        for i, variant in enumerate(poradie):
            s = tabulka[(tabulka.variant == variant) & (tabulka.cast == cast)].iloc[0]
            y = len(poradie) - 1 - i
            ax.plot([s.dolna, s.horna], [y, y], color=FARBY[variant], lw=2.2, alpha=0.45, solid_capstyle="round")
            ax.plot(s.dice, y, "o", color=FARBY[variant], ms=7, mec="white", mew=1)
            ax.text(s.horna + 0.004, y, f"{s.dice:.3f}".replace(".", ","), va="center", fontsize=8.5, color=ATRAMENT2)
        ax.set_title(nadpis, loc="left", fontsize=9.5)
        ax.set_xlim(0.72, 0.905)
        ax.set_xlabel("priemerný Dice (95 % interval, bootstrap po kartičkách)")
        os_grafu(ax)

    osi[0].set_yticks(range(len(poradie)))
    osi[0].set_yticklabels([NAZVY[v] for v in poradie][::-1])
    fig.savefig(cesta)
    plt.close(fig)


def graf_vaha(stare, cesta):
    vaha = pd.read_csv(stare / "vylepsenie_vaha.csv")
    vaha = vaha[vaha.konfig == "produkcia"]
    fig, ax = plt.subplots(figsize=(6.5, 3))
    ax.plot(vaha.vaha, vaha.dice, color=MODRA, lw=2)
    ax.axvline(0.3, color=TLMENA, ls="--", lw=0.9)

    for x in (0.0, 0.3):
        y = float(vaha[np.isclose(vaha.vaha, x)].dice.iloc[0])
        ax.plot(x, y, "o", color=MODRA, ms=6, mec="white")
        ax.annotate(f"{y:.3f}".replace(".", ","), (x, y), xytext=(6, -12 if x == 0 else 6),
                    textcoords="offset points", fontsize=8.5, color=ATRAMENT2)

    ax.set_xlabel("váha kontrastu $w$ ($w = 0$: základné skóre)")
    ax.set_ylabel("priemerný Dice (train)")
    os_grafu(ax, "y")
    fig.savefig(cesta)
    plt.close(fig)


def graf_vylucovanie(kroky, cesta):
    fig, ax = plt.subplots(figsize=(8, 3.4))
    x = np.arange(len(kroky))
    ax.plot(x, kroky.dice, "-o", color=MODRA, ms=4.5, lw=1.6)
    ax.axhline(kroky.dice.iloc[0], color=TLMENA, ls="--", lw=0.9)
    ax.axhline(kroky.dice.iloc[0] - 0.01, color=TLMENA, ls=":", lw=0.9)

    for i, krok in kroky.iterrows():
        if i:
            ax.annotate(f"−{krok.odobrate}", (i, krok.dice), xytext=(0, 7), textcoords="offset points", rotation=60,
                        fontsize=7, color=ATRAMENT2, ha="left", va="bottom")

    for nazov, (kanaly, metody) in (("Kvalitný", PROFILY["kvalitny"]), ("Rýchly", PROFILY["rychly"])):
        i = kroky.index[(kroky.kanalov == len(kanaly)) & (kroky.metod == len(metody))][0]
        ax.plot(i, kroky.dice[i], "o", color=CERVENA, ms=9, mec="white", mew=1.2, zorder=3)
        ax.annotate(f"{nazov} {len(kanaly)} × {len(metody)}", (i, kroky.dice[i]), xytext=(-8, -16),
                    textcoords="offset points", ha="right", fontsize=8.5, color=CERVENA, fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels([f"{k}×{m}" for k, m in zip(kroky.kanalov, kroky.metod)], fontsize=7.5)
    ax.set_xlabel("ponechané kanály × metódy")
    ax.set_ylabel("priemerný Dice (train)")
    ax.set_ylim(kroky.dice.min() - 0.01, kroky.dice.max() + 0.022)
    os_grafu(ax, "y")
    fig.savefig(cesta)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="Tabuľky a grafy masky škvrny pre kapitolu Výskum.")
    parser.add_argument("--vysledky", type=Path, default=VYSLEDKY, help="výstupy vyhodnotenia, výberu kanálov a profilov")
    parser.add_argument("--stare", type=Path, default=STARE, help="staršia analýza presnosti (sady 12 × 7, základná metóda)")
    parser.add_argument("--vystup", type=Path, default=OBRAZKY, help="priečinok obrázkov práce")
    args = parser.parse_args()

    args.vystup.mkdir(parents=True, exist_ok=True)
    varianty, casy = nacitaj_varianty(args.vysledky, args.stare)
    tabulka = suhrn(varianty, casy)
    tabulka.to_csv(args.vysledky / "varianty_suhrn.csv", index=False)
    print(tabulka.round(3).to_string(index=False))
    print()

    for cast in ("train", "test"):
        porovnaj_varianty(varianty, "sada_12x7", "sada_12x7_bez", cast)
        porovnaj_varianty(varianty, "rychly", "sada_12x7", cast)
        porovnaj_varianty(varianty, "kvalitny", "rychly", cast)
        porovnaj_varianty(varianty, "rychly", "zakladna", cast)
    print()
    for variant in ("rychly", "zakladna"):
        print(variant, varianty[varianty.variant == variant].groupby("druh").dice.mean().sort_values().round(3).to_dict())

    graf_test(tabulka, args.vystup / "maska_test.png")
    graf_vaha(args.stare, args.vystup / "maska_vaha_kontrastu.png")
    graf_vylucovanie(pd.read_csv(args.vysledky / "vylucovanie.csv"), args.vystup / "maska_vylucovanie.png")
    shutil.copyfile(args.vysledky / "vyhry_kanalov_a_metod.png", args.vystup / "maska_vyhry.png")
    shutil.copyfile(args.vysledky / "ukazky.png", args.vystup / "maska_ukazky.png")
    print(f"Grafy sú v {args.vystup}")


if __name__ == "__main__":
    main()
