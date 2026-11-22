"""Jednoduchá PCA farieb pixelov pre každý druh.

Pre každý druh sa zoberú pixely vnútri masky všetkých jeho fotografií, ich farba v Lab voči papieru
(dL, da, db) a z nich kovariančná matica. Jej vlastné vektory sú smery, v ktorých sa farby pixelov
druhu líšia; hlavný vlastný vektor (najväčšie vlastné číslo) je smer, v ktorom sa líšia najviac.

    python -m klasifikacia.pca_analyza --fotky images/D2 --masky images/D2/masky
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import nacitaj_masku, nacitaj_obrazok, udaje_z_nazvu, zoznam_fotiek

VYSTUP = Path(__file__).parent / "vysledky_pca_analyza"
PIXELOV_Z_FOTKY = 2000  # z každej fotografie rovnako veľa pixelov, aby veľké škvrny neprevážili
OSI = ["dL", "da", "db"]


def farby_skvrny(obrazok, maska, rng):
    """Lab pixelov škvrny voči papieru (medián farby mimo masky)."""
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    papier = np.median(lab[~maska], axis=0)
    pixely = lab[maska] - papier
    if len(pixely) > PIXELOV_Z_FOTKY:
        pixely = pixely[rng.choice(len(pixely), PIXELOV_Z_FOTKY, replace=False)]
    return pixely


def pca(pixely):
    """Vlastné čísla od najväčšieho a k nim vlastné vektory (stĺpce) kovariančnej matice farieb."""
    cisla, vektory = np.linalg.eigh(np.cov(pixely, rowvar=False))
    poradie = np.argsort(cisla)[::-1]
    cisla, vektory = cisla[poradie], vektory[:, poradie]
    # vektor v aj -v je tá istá os; otočíme ho tak, aby smeroval od papiera k priemernej farbe škvrny
    vektory *= np.where(pixely.mean(axis=0) @ vektory < 0, -1, 1)
    return cisla, vektory


def graf(tabulka, cesta):
    """Hlavná os každého druhu: úsečka cez priemernú farbu dlhá ± 2 smerodajné odchýlky."""
    fig, osi = plt.subplots(1, 2, figsize=(13, 6))
    farby = plt.get_cmap("tab20")(np.linspace(0, 1, len(tabulka)))
    for (_, r), farba in zip(tabulka.iterrows(), farby):
        stred = np.array([r.priemer_dL, r.priemer_da, r.priemer_db])
        smer = np.array([r.v1_dL, r.v1_da, r.v1_db]) * 2 * np.sqrt(r.lambda1)
        for ax, (x, y) in zip(osi, [(2, 0), (1, 2)]):
            ax.plot([stred[x] - smer[x], stred[x] + smer[x]], [stred[y] - smer[y], stred[y] + smer[y]], color=farba, lw=2)
            ax.scatter(stred[x], stred[y], color=farba, s=30, label=r.druh if x == 2 else None)
    for ax, (x, y) in zip(osi, [(2, 0), (1, 2)]):
        ax.set_xlabel(f"{OSI[x]} voči papieru")
        ax.set_ylabel(f"{OSI[y]} voči papieru")
        ax.axhline(0, color="#ccc", lw=0.8)
        ax.axvline(0, color="#ccc", lw=0.8)
    osi[0].set_title("žltosť × jas")
    osi[1].set_title("červenosť × žltosť")
    osi[0].legend(fontsize=8)
    fig.suptitle("Hlavná os farieb pixelov každého druhu (bod = priemerná farba, úsečka = ± 2 smerodajné odchýlky)")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    args = ap.parse_args()
    rng = np.random.default_rng(2026)

    pixely_druhu, fotiek_druhu = {}, {}
    for cesta in zoznam_fotiek(args.fotky):
        maska = nacitaj_masku(Path(args.masky) / (cesta.stem + ".png"))
        if maska is None or not maska.any():
            continue
        _, druh = udaje_z_nazvu(cesta.stem)
        pixely_druhu.setdefault(druh, []).append(farby_skvrny(nacitaj_obrazok(cesta), maska, rng))
        fotiek_druhu[druh] = fotiek_druhu.get(druh, 0) + 1

    riadky = []
    for druh in sorted(pixely_druhu):
        pixely = np.concatenate(pixely_druhu[druh])
        cisla, vektory = pca(pixely)
        v1 = vektory[:, 0]
        riadky.append({
            "druh": druh, "fotiek": fotiek_druhu[druh], "pixelov": len(pixely),
            **{f"priemer_{o}": m for o, m in zip(OSI, pixely.mean(axis=0))},
            "lambda1": cisla[0], "lambda2": cisla[1], "lambda3": cisla[2],
            "podiel_lambda1": cisla[0] / cisla.sum(),
            **{f"v1_{o}": v for o, v in zip(OSI, v1)},
            "sklon_od_jasu_deg": np.degrees(np.arccos(abs(v1[0]))),
        })
    tabulka = pd.DataFrame(riadky)

    VYSTUP.mkdir(exist_ok=True)
    tabulka.to_csv(VYSTUP / "vlastne_vektory.csv", index=False, encoding="utf-8")
    graf(tabulka, VYSTUP / "hlavne_osi.png")
    pd.set_option("display.width", 200)
    print(tabulka[["druh", "fotiek", "v1_dL", "v1_da", "v1_db", "podiel_lambda1", "sklon_od_jasu_deg"]]
          .round(3).to_string(index=False))
    print(f"\nUložené do {VYSTUP}")


if __name__ == "__main__":
    main()
