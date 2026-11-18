import argparse
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.ticker import PercentFormatter
import numpy as np
import pandas as pd

from klasifikacia.crty import JADRO, crty_skvrny
from klasifikacia.kluc import nacitaj, nauc_kluc
from klasifikacia.postav_kluc import FOLDY, STRUKTURA, foldy, vyhodnot
from klasifikacia.vzhlad import ATRAMENT2, CERVENA, MODRA, MODRA_SVETLA, MODRA_TMAVA, POVRCH, os_grafu
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import nacitaj_masku, nacitaj_obrazok, najdi_fotku

PRIECINOK = Path(__file__).parent
PODIELY = (0.0, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8)
OPAKOVANIA = 5
PRIKLADY = ("Epicoccum", "Aspergillus", "Talaromyces", "Curtobacterium")
MASKY = {"auto": ("automatická maska", MODRA_TMAVA, "o"), "rucna": ("ručná maska", MODRA_SVETLA, "s")}


def crty_fotky(uloha):
    fotka, cesta_fotky, cesty_masiek = uloha
    obrazok = nacitaj_obrazok(cesta_fotky)
    riadky = []
    for maska, cesta in cesty_masiek.items():
        m = nacitaj_masku(cesta)
        if obrazok is None or m is None:
            continue
        for podiel in PODIELY:
            vysledok = crty_skvrny(obrazok, m, podiel_jadra=podiel)
            if vysledok:
                crty, podklady = vysledok
                riadky.append({"fotka": fotka, "maska": maska, "podiel": podiel,
                               "plocha_jadra": cv2.countNonZero(podklady["jadro"]) / max(1, int(m.sum())), **crty})
    return riadky


def vypocitaj_crty(rozdelenie, fotky, masky, rucne):
    ulohy = [(f, najdi_fotku(fotky, f), {"auto": masky / f"{f}.png", "rucna": rucne / f"{f}.png"})
             for f in rozdelenie.fotka]
    riadky = []
    with ProcessPoolExecutor() as pool:
        for poradie, vysledok in enumerate(pool.map(crty_fotky, ulohy, chunksize=4), 1):
            riadky.extend(vysledok)
            print(f"\r{poradie}/{len(ulohy)} fotiek", end="")
    print()
    return rozdelenie.merge(pd.DataFrame(riadky), on="fotka")


def uspesnost_variantu(uloha):
    """Podiel správne určených fotiek kľúčom pre jednu masku a podiel: krížová validácia a test."""
    (maska, podiel), df, struktura = uloha
    train, test = df[df.cast == "train"].reset_index(drop=True), df[df.cast == "test"].reset_index(drop=True)
    riadky = []
    for seed in range(OPAKOVANIA):
        fold = foldy(train, seed)
        casti = [vyhodnot(nauc_kluc(struktura, train[fold != f]), train[fold == f]) for f in range(FOLDY)]
        riadky.append({"maska": maska, "podiel": podiel, "cast": "train_cv", "seed": seed,
                       "uspesnost": float((pd.concat(casti).vysledok == "urceny").mean())})
    t = vyhodnot(nauc_kluc(struktura, train), test)
    riadky.append({"maska": maska, "podiel": podiel, "cast": "test", "seed": 0,
                   "uspesnost": float((t.vysledok == "urceny").mean())})
    return riadky


def uspesnost(crty, struktura):
    ulohy = [(kluc, df, struktura) for kluc, df in crty.groupby(["maska", "podiel"])]
    with ProcessPoolExecutor() as pool:
        return pd.DataFrame([r for riadky in pool.map(uspesnost_variantu, ulohy) for r in riadky])


def graf_uspesnost(tabulka, plochy, cesta):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12.5, 4.6), gridspec_kw={"width_ratios": [1.6, 1]})
    for maska, (nazov, farba, znak) in MASKY.items():
        t = tabulka[tabulka.maska == maska]
        cv = t[t.cast == "train_cv"].groupby("podiel").uspesnost
        ax1.errorbar(cv.mean().index, cv.mean(), yerr=cv.std(), color=farba, marker=znak, ms=6, capsize=3, lw=1.6,
                     zorder=3)
        test = t[t.cast == "test"].set_index("podiel").uspesnost
        ax1.scatter(test.index, test, marker="D", s=30, facecolors=POVRCH, edgecolors=farba, lw=1.3, zorder=4)
        ax2.plot(plochy[maska].index, plochy[maska], color=farba, marker=znak, ms=6, lw=1.6)
    for ax in (ax1, ax2):
        ax.axvline(JADRO, color=ATRAMENT2, lw=1, ls="--", zorder=1)
        ax.set_xticks(PODIELY, [f"{p:g}".replace(".", ",") for p in PODIELY])
        ax.set_xlabel("podiel z 90. percentilu farebného rozdielu od papiera (0 = celá maska)")
        os_grafu(ax, "y")
    ax1.text(JADRO, ax1.get_ylim()[1], f" zvolené jadro {JADRO:g}".replace(".", ","), va="top", fontsize=8,
             color=ATRAMENT2)
    ax1.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax1.set_ylabel("podiel správne určených fotiek")
    ax1.set_title("Úspešnosť kľúča podľa jadra, z ktorého sa počítajú črty", loc="left", fontsize=10.5)
    ax2.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax2.set_ylim(0, 1.05)
    ax2.set_ylabel("plocha jadra / plocha masky (priemer)")
    ax2.set_title("Koľko z masky ostane v jadre", loc="left", fontsize=10.5)
    legenda = [Line2D([], [], color=f, marker=z, label=f"{n} – krížová validácia (priemer ± sm. odch., "
                      f"{OPAKOVANIA} rozdelení)") for n, f, z in MASKY.values()]
    legenda += [Line2D([], [], marker="D", ls="", markerfacecolor=POVRCH, markeredgecolor=ATRAMENT2, label="test")]
    fig.legend(handles=legenda, loc="upper center", bbox_to_anchor=(0.5, 0.0), ncol=3, frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(cesta)
    plt.close(fig)


def graf_priklady(crty, fotky, masky, cesta):
    df = crty[(crty.maska == "auto") & (crty.podiel == JADRO) & (crty.cast == "train")]
    fig, osi = plt.subplots(1, len(PRIKLADY), figsize=(3.3 * len(PRIKLADY), 3.9))
    for ax, druh in zip(osi, PRIKLADY):
        d = df[df.druh == druh]
        riadok = d.loc[(d.plocha_jadra - d.plocha_jadra.median()).abs().idxmin()]
        obrazok = nacitaj_obrazok(najdi_fotku(fotky, riadok.fotka))
        maska = nacitaj_masku(masky / f"{riadok.fotka}.png")
        stred = crty_skvrny(obrazok, maska, s_texturou=False)[1]["jadro"] > 0
        ys, xs = np.nonzero(maska)
        okraj = int(0.3 * math.sqrt(maska.sum() / math.pi))
        y0, y1 = max(0, ys.min() - okraj), min(maska.shape[0], ys.max() + okraj + 1)
        x0, x1 = max(0, xs.min() - okraj), min(maska.shape[1], xs.max() + okraj + 1)
        rgb = cv2.cvtColor(obrazok, cv2.COLOR_BGR2RGB).astype(np.float32)
        vynechany = maska & ~stred
        rgb[vynechany] = 0.4 * rgb[vynechany] + 0.6 * np.array([150.0, 150.0, 150.0])
        ax.imshow(rgb[y0:y1, x0:x1].astype(np.uint8))
        for m, farba in ((maska, CERVENA), (stred, MODRA)):
            obrysy = cv2.findContours(m[y0:y1, x0:x1].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]
            for obrys in obrysy:
                ax.plot(obrys[:, 0, 0], obrys[:, 0, 1], color=farba, lw=1.2)
        ax.set_title(f"{druh}\njadro {riadok.plocha_jadra:.0%} plochy masky".replace("%", " %"), loc="left",
                     fontsize=9.5)
        ax.axis("off")
    legenda = [Line2D([], [], color=CERVENA, lw=1.5, label="maska škvrny"),
               Line2D([], [], color=MODRA, lw=1.5, label="jadro – z neho sa počítajú črty"),
               Line2D([], [], marker="s", ls="", color="#969696", ms=9, label="vynechaný rozmazaný okraj")]
    fig.legend(handles=legenda, loc="upper center", bbox_to_anchor=(0.5, 0.02), ncol=3, frameon=False, fontsize=8.5)
    fig.tight_layout()
    fig.savefig(cesta)
    plt.close(fig)


def vypis(tabulka, plochy):
    for (maska, podiel), t in tabulka.groupby(["maska", "podiel"]):
        cv = t[t.cast == "train_cv"].uspesnost
        print(f"  {MASKY[maska][0]:18s} podiel {podiel:4.2f}: krížová validácia {cv.mean():.3f} ± {cv.std():.3f}, "
              f"test {t[t.cast == 'test'].uspesnost.iloc[0]:.3f}, jadro {plochy[maska][podiel]:.0%} plochy masky")


def main():
    parser = argparse.ArgumentParser(description="Výber jadra škvrny pre črty určovacieho kľúča.")
    parser.add_argument("--fotky", type=Path, default=Path("images/D2"))
    parser.add_argument("--masky", type=Path, default=Path("images/D2/masky"), help="automatické masky (<fotka>.png)")
    parser.add_argument("--rucne", type=Path, default=Path("images/D2masks"), help="ručné masky (<fotka>.png)")
    parser.add_argument("--vystup", type=Path, default=PRIECINOK / "vysledky_jadra")
    args = parser.parse_args()
    args.vystup.mkdir(parents=True, exist_ok=True)

    crty = vypocitaj_crty(nacitaj_rozdelenie(), args.fotky, args.masky, args.rucne)
    tabulka = uspesnost(crty, nacitaj(STRUKTURA))
    tabulka.to_csv(args.vystup / "uspesnost.csv", index=False)
    plochy = crty.groupby(["maska", "podiel"]).plocha_jadra.mean()
    plochy.to_csv(args.vystup / "plocha_jadra.csv")
    graf_uspesnost(tabulka, plochy, args.vystup / "01_uspesnost_podla_jadra.png")
    graf_priklady(crty, args.fotky, args.masky, args.vystup / "02_jadro_priklady.png")
    vypis(tabulka, plochy)
    print(f"\nVýstupy sú v {args.vystup}")


if __name__ == "__main__":
    main()
