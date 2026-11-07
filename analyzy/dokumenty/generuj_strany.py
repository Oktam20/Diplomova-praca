"""Testovacie strany s textom a vloženými škvrnami.

    python -m dokumenty.generuj_strany --fotky images/D2 --masky images/D2masks
"""
import argparse
import csv
from pathlib import Path

import cv2
import numpy as np

from dokumenty.test_dokumenty import skvrny_podla_druhu, vytvor_stranu
from skvrny.subory import uloz_obrazok

SLOVA = ("plesne", "papier", "kniha", "strana", "listina", "rukopis", "farba", "dokument", "zbierka",
         "obal", "text", "riadok", "kolonie", "pod", "list", "rok", "mesto", "pisar", "kapitula", "zapis",
         "a", "na", "v", "je", "sa", "do", "pri", "ako", "alebo", "bola", "medzi", "podla", "ten")


def prazdna_strana(rng, sirka=1400, vyska=2000, okraj=140):
    papier = np.full((vyska, sirka, 3), (200, 222, 232), np.float32) + rng.normal(0, 3, (vyska, sirka, 3))
    strana = np.clip(papier, 0, 255).astype(np.uint8)
    atrament = (45, 40, 40)

    cv2.putText(strana, f"KAPITOLA {rng.integers(1, 20)}", (okraj, 170), cv2.FONT_HERSHEY_COMPLEX, 1.6,
                atrament, 3, cv2.LINE_AA)
    y = 270
    while y < vyska - okraj:
        x = okraj + (40 if rng.random() < 0.15 else 0)
        while True:
            slovo = SLOVA[rng.integers(len(SLOVA))]
            (w, _), _ = cv2.getTextSize(slovo, cv2.FONT_HERSHEY_COMPLEX, 0.9, 2)
            if x + w > sirka - okraj:
                break
            cv2.putText(strana, slovo, (x, y), cv2.FONT_HERSHEY_COMPLEX, 0.9, atrament, 2, cv2.LINE_AA)
            x += w + 16
        y += 80 if rng.random() < 0.12 else 46
    return strana


def main():
    parser = argparse.ArgumentParser(description="Vygeneruje testovacie strany so škvrnami.")
    parser.add_argument("--fotky", type=Path, required=True, help="fotky škvŕn")
    parser.add_argument("--masky", type=Path, required=True, help="masky škvŕn (<fotka>.png)")
    parser.add_argument("--strany", nargs="+", type=Path, help="skutočné strany (inak sa vygenerujú)")
    parser.add_argument("--pocet", type=int, default=4, help="počet vygenerovaných strán")
    parser.add_argument("--skvrn", type=int, default=4, help="počet škvŕn na stranu")
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--vystup", type=Path, default=Path("images/testovacie_strany"))
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    strany = args.strany
    if not strany:
        prazdne = args.vystup / "prazdne"
        prazdne.mkdir(parents=True, exist_ok=True)
        strany = []
        for cislo in range(1, args.pocet + 1):
            cesta = prazdne / f"strana_{cislo}.png"
            uloz_obrazok(cesta, prazdna_strana(rng))
            strany.append(cesta)

    skvrny = skvrny_podla_druhu(args.fotky)
    druhy = sorted(skvrny)
    zoznam = []
    for cesta_strany in strany:
        vybrane = rng.choice(druhy, size=min(args.skvrn, len(druhy)), replace=False)
        cesty = [skvrny[d][int(rng.integers(len(skvrny[d])))] for d in vybrane]
        _, strana, vlozene = vytvor_stranu(cesta_strany, [(c, args.masky / f"{c.stem}.png") for c in cesty], rng)

        nazov = f"{cesta_strany.stem}_skvrny.png"
        uloz_obrazok(args.vystup / nazov, strana)
        for druh, pravda in vlozene:
            ys, xs = np.nonzero(pravda)
            zoznam.append((nazov, druh, xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
        print(f"{nazov}: {', '.join(d for d, _ in vlozene)}")

    with open(args.vystup / "zoznam.csv", "w", newline="", encoding="utf-8") as subor:
        zapis = csv.writer(subor)
        zapis.writerow(["obrazok", "druh", "x0", "y0", "x1", "y1"])
        zapis.writerows(zoznam)
    print(f"Strany sú v {args.vystup}")


if __name__ == "__main__":
    main()
