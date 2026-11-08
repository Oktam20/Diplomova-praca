"""Porovnanie automatických masiek s ručne obkreslenými maskami.

    python -m skvrny.vyhodnotenie --masky <priečinok> --rucne <priečinok> [--fotky <priečinok>]
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.rozdelenie import SUBOR, nacitaj_rozdelenie
from skvrny.subory import VYSLEDKY, nacitaj_masku, nacitaj_obrazok, najdi_fotku

METRIKY = ["dice", "iou", "presnost", "citlivost"]
FARBY = {"train": "#256abf", "test": "#e8862a"}


def porovnaj(auto, rucna):
    tp = np.count_nonzero(auto & rucna)
    fp = np.count_nonzero(auto & ~rucna)
    fn = np.count_nonzero(~auto & rucna)
    
    return {
        "dice": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0,
        "iou": tp / (tp + fp + fn) if tp + fp + fn else 0.0,
        "presnost": tp / (tp + fp) if tp + fp else 0.0,
        "citlivost": tp / (tp + fn) if tp + fn else 0.0,
    }


def vyhodnot(masky, rucne, rozdelenie):
    riadky = []
    
    for fotka in rozdelenie.itertuples():
        auto = nacitaj_masku(masky / f"{fotka.fotka}.png")
        rucna = nacitaj_masku(rucne / f"{fotka.fotka}.png")
        
        if auto is None or rucna is None:
            print(f"chýba maska: {fotka.fotka}")
            continue
        
        if auto.shape != rucna.shape:
            auto = cv2.resize(auto.astype(np.uint8), rucna.shape[::-1], interpolation=cv2.INTER_NEAREST) > 0
        
        riadky.append({"fotka": fotka.fotka, "druh": fotka.druh, "cast": fotka.cast, **porovnaj(auto, rucna)})
    
    return pd.DataFrame(riadky)


def suhrn(vysledky):
    vsetky = pd.concat([vysledky, vysledky.assign(cast="spolu")])
    skupiny = vsetky.groupby("cast")
    tabulka = skupiny[METRIKY].mean()
    tabulka["dice_median"] = skupiny.dice.median()
    tabulka["iou_aspon_05"] = skupiny.iou.apply(lambda iou: (iou >= 0.5).mean())
    tabulka["fotiek"] = skupiny.size()
    
    return tabulka.loc[["train", "test", "spolu"]]


def graf_histogram(vysledky, cesta):
    fig, ax = plt.subplots(figsize=(7, 4))
    
    for cast, farba in FARBY.items():
        dice = vysledky[vysledky.cast == cast].dice
        ax.hist(dice, bins=np.linspace(0, 1, 21), weights=np.full(len(dice), 100 / len(dice)),
                color=farba, alpha=0.6, label=f"{cast} (priemer {dice.mean():.3f})")
    
    ax.set_xlabel("Dice")
    ax.set_ylabel("% fotiek")
    ax.set_title("Zhoda automatickej a ručnej masky")
    ax.legend()
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def graf_druhy(vysledky, cesta):
    priemery = vysledky.groupby("druh").dice.mean().sort_values()
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.barh(priemery.index, priemery.values, color="#256abf")
    
    for poradie, hodnota in enumerate(priemery.values):
        ax.text(hodnota + 0.01, poradie, f"{hodnota:.2f}", va="center", fontsize=8)
    
    ax.set_xlim(0, 1.08)
    ax.set_xlabel("priemerný Dice")
    ax.set_title("Zhoda masiek po druhoch")
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    
    plt.close(fig)


def graf_ukazky(vysledky, fotky, masky, rucne, cesta, pocet=5):
    zoradene = vysledky.sort_values("dice", ascending=False).reset_index(drop=True)
    stred = len(zoradene) // 2 - pocet // 2
    
    riadky = {
        "najlepšie": zoradene[:pocet],
        "typické": zoradene[stred:stred + pocet],
        "najhoršie": zoradene[-pocet:],
    }

    fig, osi = plt.subplots(3, pocet, figsize=(2.6 * pocet, 8))
    
    for riadok, (nazov, vyber) in enumerate(riadky.items()):
        for ax, fotka in zip(osi[riadok], vyber.itertuples()):
            obrazok = nacitaj_obrazok(najdi_fotku(fotky, fotka.fotka))
            ax.imshow(cv2.cvtColor(obrazok, cv2.COLOR_BGR2RGB))
            for maska, farba in ((nacitaj_masku(rucne / f"{fotka.fotka}.png"), "lime"),
                                 (nacitaj_masku(masky / f"{fotka.fotka}.png"), "red")):
                if maska is not None and maska.any():
                    ax.contour(maska.astype(np.uint8), levels=[0.5], colors=farba, linewidths=1)
            ax.set_title(f"{fotka.druh} · Dice {fotka.dice:.2f}", fontsize=8)
            ax.set_xticks([])
            ax.set_yticks([])
        osi[riadok, 0].set_ylabel(nazov, fontsize=11)

    fig.tight_layout()
    fig.savefig(cesta, dpi=120)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="Porovná automatické masky s ručnými.")
    parser.add_argument("--masky", type=Path, required=True, help="automatické masky (<fotka>.png)")
    parser.add_argument("--rucne", type=Path, required=True, help="ručné masky (<fotka>.png)")
    parser.add_argument("--fotky", type=Path, help="fotky – ak sú zadané, nakreslia sa ukážky")
    parser.add_argument("--rozdelenie", type=Path, default=SUBOR)
    args = parser.parse_args()

    VYSLEDKY.mkdir(exist_ok=True)
    vysledky = vyhodnot(args.masky, args.rucne, nacitaj_rozdelenie(args.rozdelenie))
    vysledky.to_csv(VYSLEDKY / "vyhodnotenie.csv", index=False)

    tabulka = suhrn(vysledky)
    tabulka.to_csv(VYSLEDKY / "suhrn.csv")
    print(tabulka.round(3).to_string())
    print()
    print(vysledky.groupby("druh").dice.mean().sort_values().round(3).to_string())

    graf_histogram(vysledky, VYSLEDKY / "dice_histogram.png")
    graf_druhy(vysledky, VYSLEDKY / "dice_po_druhoch.png")
    
    if args.fotky:
        graf_ukazky(vysledky, args.fotky, args.masky, args.rucne, VYSLEDKY / "ukazky.png")


if __name__ == "__main__":
    main()
