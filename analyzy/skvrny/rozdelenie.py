"""Rozdelenie fotiek na trénovaciu (80 %) a testovaciu (20 %) časť.

    python -m skvrny.rozdelenie <priečinok s fotkami> [--znova]
"""
import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import VYSLEDKY, udaje_z_nazvu, zoznam_fotiek

TEST_PODIEL = 0.2
SEED = 2026
SUBOR = Path(__file__).parent / "rozdelenie.csv"


def rozdel(priecinok_fotiek):
    """Delí sa po vzorkách (kartičkách) a v rámci každého druhu zvlášť."""
    fotky = pd.DataFrame(
        [(cesta.stem, *udaje_z_nazvu(cesta.stem)) for cesta in zoznam_fotiek(priecinok_fotiek)],
        columns=["fotka", "vzorka", "druh"],
    )

    rng = np.random.default_rng(SEED)
    testovacie = set()
    for _, skupina in fotky.groupby("druh"):
        vzorky = np.array(sorted(skupina.vzorka.unique()))
        pocet = max(1, round(TEST_PODIEL * len(vzorky)))
        testovacie.update(rng.choice(vzorky, size=pocet, replace=False))

    fotky["cast"] = np.where(fotky.vzorka.isin(testovacie), "test", "train")
    return fotky


def nacitaj_rozdelenie(cesta=SUBOR):
    return pd.read_csv(cesta, dtype={"vzorka": str})


def graf(rozdelenie, cesta):
    pocty = rozdelenie.groupby(["druh", "cast"]).size().unstack(fill_value=0)[["train", "test"]]
    ax = pocty.plot.barh(stacked=True, figsize=(8, 5), color=["#256abf", "#e8862a"])
    ax.set_xlabel("počet fotiek")
    ax.set_ylabel("")
    ax.set_title("Rozdelenie fotiek na train a test (po kartičkách)")
    ax.figure.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(ax.figure)


def main():
    parser = argparse.ArgumentParser(description="Rozdelí fotky na train a test.")
    parser.add_argument("fotky", type=Path, help="priečinok s fotkami")
    parser.add_argument("--znova", action="store_true", help="prepísať existujúce rozdelenie.csv")
    args = parser.parse_args()

    if SUBOR.exists() and not args.znova:
        rozdelenie = nacitaj_rozdelenie()
        print("rozdelenie.csv už existuje, použije sa (nové rozdelenie: --znova)")
    else:
        rozdelenie = rozdel(args.fotky)
        rozdelenie.to_csv(SUBOR, index=False)

    for cast, skupina in rozdelenie.groupby("cast"):
        print(f"{cast}: {skupina.vzorka.nunique()} kartičiek, {len(skupina)} fotiek")

    VYSLEDKY.mkdir(exist_ok=True)
    graf(rozdelenie, VYSLEDKY / "rozdelenie.png")


if __name__ == "__main__":
    main()
