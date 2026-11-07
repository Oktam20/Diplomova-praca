"""Vytvorí masky škvŕn pre všetky fotky v priečinku.

    python -m skvrny.vytvor_masky <priečinok s fotkami> [--vystup <priečinok>] [--profil rychly|kvalitny]
"""
import argparse
from pathlib import Path

import pandas as pd

from skvrny.maska import PROFILY, najdi_masku
from skvrny.subory import nacitaj_obrazok, uloz_obrazok, zoznam_fotiek


def main():
    parser = argparse.ArgumentParser(description="Vytvorí masky škvŕn pre fotky v priečinku.")
    parser.add_argument("fotky", type=Path, help="priečinok s fotkami")
    parser.add_argument("--vystup", type=Path, help="kam uložiť masky (predvolene <fotky>/masky)")
    parser.add_argument("--profil", default="rychly", choices=PROFILY)
    args = parser.parse_args()

    vystup = args.vystup or args.fotky / "masky"
    vystup.mkdir(parents=True, exist_ok=True)
    fotky = zoznam_fotiek(args.fotky)

    vitazi = []
    for poradie, cesta in enumerate(fotky, 1):
        obrazok = nacitaj_obrazok(cesta)
        if obrazok is None:
            print(f"[{poradie}/{len(fotky)}] {cesta.name}: nepodarilo sa načítať")
            continue

        maska, vitaz = najdi_masku(obrazok, args.profil)
        uloz_obrazok(vystup / f"{cesta.stem}.png", maska)
        vitazi.append({"fotka": cesta.stem, "kanal": vitaz["kanal"], "metoda": vitaz["metoda"],
                       "smer": vitaz["smer"], "skore": round(vitaz["skore"], 4)})
        print(f"[{poradie}/{len(fotky)}] {cesta.name}: {vitaz['kanal']}, {vitaz['metoda']}, {vitaz['smer']}")

    pd.DataFrame(vitazi).to_csv(vystup / "vitazi.csv", index=False)
    print(f"Masky sú v {vystup}")


if __name__ == "__main__":
    main()
