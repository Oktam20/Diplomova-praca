"""Doplnenie k pca_analyza.py — matica prekryvu dvojíc druhov a grafy s elipsami.

Nezávislý skript, ktorý si sám načíta fotky a masky a spraví:
  1. std_dL, std_da, std_db pre každý druh
  2. maticu prekryvu dvojíc druhov (podiel pixelov v ±1 SD druhého)
  3. graf matice prekryvu (heatmapa)
  4. grafy s elipsami ±1 SD okolo priemeru každého druhu

    python -m klasifikacia.prekryv_druhov --fotky images/D2 --masky images/D2/masky
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import nacitaj_masku, nacitaj_obrazok, udaje_z_nazvu, zoznam_fotiek

VYSTUP = Path(__file__).parent / "vysledky_prekryv"
PIXELOV_Z_FOTKY = 2000
OSI = ["dL", "da", "db"]


def farby_skvrny(obrazok, maska, rng):
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    papier = np.median(lab[~maska], axis=0)
    pixely = lab[maska] - papier
    if len(pixely) > PIXELOV_Z_FOTKY:
        pixely = pixely[rng.choice(len(pixely), PIXELOV_Z_FOTKY, replace=False)]
    return pixely


def statistika(pixely):
    """Priemer a smerodajná odchýlka po osiach."""
    return pixely.mean(axis=0), pixely.std(axis=0, ddof=0)


def podiel_v_rozsahu(pixely, stred, std):
    """Podiel pixelov, ktoré padnú do ±1 SD po všetkých troch osiach."""
    v_rozsahu = np.all(np.abs(pixely - stred) <= std, axis=1)
    return v_rozsahu.mean()


def matica_prekryvu(pixely_druhu):
    """Symetrická matica: priemer podielu A v B a B v A (v ±1 SD)."""
    druhy = sorted(pixely_druhu)
    stredy, odchylky = {}, {}
    for d in druhy:
        stredy[d], odchylky[d] = statistika(pixely_druhu[d])
    n = len(druhy)
    matica = np.zeros((n, n))
    for i, a in enumerate(druhy):
        for j, b in enumerate(druhy):
            if i == j:
                matica[i, j] = 1.0
                continue
            ab = podiel_v_rozsahu(pixely_druhu[a], stredy[b], odchylky[b])
            ba = podiel_v_rozsahu(pixely_druhu[b], stredy[a], odchylky[a])
            matica[i, j] = (ab + ba) / 2
    return druhy, matica


def graf_prekryvu(druhy, matica, cesta):
    fig, ax = plt.subplots(figsize=(max(6, 0.55 * len(druhy) + 3), max(5, 0.55 * len(druhy) + 2)))
    im = ax.imshow(matica, cmap="YlOrRd", vmin=0, vmax=0.5)
    ax.set_xticks(range(len(druhy)))
    ax.set_yticks(range(len(druhy)))
    ax.set_xticklabels(druhy, rotation=45, ha="right", fontsize=8)
    ax.set_yticklabels(druhy, fontsize=8)
    for i in range(len(druhy)):
        for j in range(len(druhy)):
            if i != j:
                ax.text(j, i, f"{matica[i, j]:.2f}", ha="center", va="center", fontsize=7,
                        color="white" if matica[i, j] > 0.3 else "black")
    ax.set_title("Prekryv dvojíc druhov (priemer podielu pixelov v ±1 SD druhého)")
    fig.colorbar(im, ax=ax, label="podiel prekryvu (0 = žiadny, 0.5+ = veľký)")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150)
    plt.close(fig)


def graf_elipsy(tabulka, cesta):
    """Priemery druhov s elipsami ±1 SD v troch rovinách Lab."""
    roviny = [(2, 0, "db × dL"), (1, 0, "da × dL"), (1, 2, "da × db")]
    fig, osi = plt.subplots(1, 3, figsize=(16, 5.5))
    farby = plt.get_cmap("tab20")(np.linspace(0, 1, len(tabulka)))
    for (_, r), farba in zip(tabulka.iterrows(), farby):
        stred = np.array([r.priemer_dL, r.priemer_da, r.priemer_db])
        std = np.array([r.std_dL, r.std_da, r.std_db])
        for ax, (x, y, _) in zip(osi, roviny):
            ax.add_patch(plt.matplotlib.patches.Ellipse(
                (stred[x], stred[y]), 2 * std[x], 2 * std[y],
                facecolor=farba, edgecolor=farba, alpha=0.15, lw=1.5))
            ax.scatter(stred[x], stred[y], color=farba, s=25, label=r.druh if x == 2 and y == 0 else None)
    for ax, (x, y, nazov) in zip(osi, roviny):
        ax.set_xlabel(f"{OSI[x]} voči papieru")
        ax.set_ylabel(f"{OSI[y]} voči papieru")
        ax.axhline(0, color="#ccc", lw=0.8)
        ax.axvline(0, color="#ccc", lw=0.8)
        ax.set_title(nazov)
    osi[0].legend(fontsize=7, loc="best")
    fig.suptitle("Priemery druhov s elipsami ±1 SD (prekryv elíps = riziko zámeny)")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    args = ap.parse_args()
    rng = np.random.default_rng(2026)

    pixely_druhu = {}
    for cesta in zoznam_fotiek(args.fotky):
        maska = nacitaj_masku(Path(args.masky) / (cesta.stem + ".png"))
        if maska is None or not maska.any():
            continue
        _, druh = udaje_z_nazvu(cesta.stem)
        pixely_druhu.setdefault(druh, []).append(farby_skvrny(nacitaj_obrazok(cesta), maska, rng))
    pixely_druhu = {d: np.concatenate(p) for d, p in pixely_druhu.items()}

    # tabuľka so std
    riadky = []
    for druh in sorted(pixely_druhu):
        stred, std = statistika(pixely_druhu[druh])
        riadky.append({"druh": druh,
                       **{f"priemer_{o}": v for o, v in zip(OSI, stred)},
                       **{f"std_{o}": v for o, v in zip(OSI, std)}})
    tabulka = pd.DataFrame(riadky)

    # matica prekryvu
    druhy, matica = matica_prekryvu(pixely_druhu)

    VYSTUP.mkdir(exist_ok=True)
    tabulka.to_csv(VYSTUP / "priemery_std.csv", index=False, encoding="utf-8")
    pd.DataFrame(matica, index=druhy, columns=druhy).round(3).to_csv(
        VYSTUP / "matica_prekryvu.csv", encoding="utf-8")
    graf_prekryvu(druhy, matica, VYSTUP / "matica_prekryvu.png")
    graf_elipsy(tabulka, VYSTUP / "elipsy_1sd.png")

    pd.set_option("display.width", 200)
    print(tabulka.round(2).to_string(index=False))
    print("\nMatica prekryvu (priemer oboch smerov, ±1 SD):")
    print(pd.DataFrame(matica, index=druhy, columns=druhy).round(2).to_string())
    print(f"\nUložené do {VYSTUP}")


if __name__ == "__main__":
    main()