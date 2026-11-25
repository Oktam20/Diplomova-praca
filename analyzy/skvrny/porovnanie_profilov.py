import argparse
import time
from pathlib import Path

import pandas as pd

from skvrny.maska import PROFILY, najdi_masku
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import VYSLEDKY, nacitaj_masku, nacitaj_obrazok, najdi_fotku
from skvrny.vyhodnotenie import METRIKY, porovnaj


def porovnaj_profily(fotky, rucne, cast):
    """Maska každého profilu pre fotky časti (train/test): metriky voči ručnej maske a čas v ms."""
    rozdelenie = nacitaj_rozdelenie()
    vyber = rozdelenie[rozdelenie.cast == cast]
    riadky = []

    for poradie, fotka in enumerate(vyber.itertuples(), 1):
        obrazok = nacitaj_obrazok(najdi_fotku(fotky, fotka.fotka))
        rucna = nacitaj_masku(rucne / f"{fotka.fotka}.png")
        for profil in PROFILY:
            zaciatok = time.perf_counter()
            maska, _ = najdi_masku(obrazok, profil)
            ms = 1000 * (time.perf_counter() - zaciatok)
            riadky.append({"profil": profil, "fotka": fotka.fotka, "druh": fotka.druh, "cast": cast, "ms": ms,
                           **porovnaj(maska > 0, rucna)})
        print(f"\r{poradie}/{len(vyber)} fotiek", end="")
    print()

    return pd.DataFrame(riadky)


def main():
    parser = argparse.ArgumentParser(description="Presnosť a čas profilov Rýchly a Kvalitný (sekvenčne).")
    parser.add_argument("--fotky", type=Path, required=True)
    parser.add_argument("--rucne", type=Path, required=True)
    parser.add_argument("--cast", default="test", choices=["train", "test"])
    parser.add_argument("--vystup", type=Path, default=VYSLEDKY)
    args = parser.parse_args()

    args.vystup.mkdir(parents=True, exist_ok=True)
    tabulka = porovnaj_profily(args.fotky, args.rucne, args.cast)
    tabulka.to_csv(args.vystup / f"profily_{args.cast}.csv", index=False)
    print(tabulka.groupby("profil")[METRIKY + ["ms"]].agg(["mean", "median"]).round(3).to_string())


if __name__ == "__main__":
    main()
