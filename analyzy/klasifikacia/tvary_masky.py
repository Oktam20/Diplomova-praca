"""Veľkosť a tvar masky škvrny — geometrické príznaky pre manuálny kľúč.

Pre každú masku spočíta:
  - plocha            = počet pixelov masky,
  - obvod             = dĺžka kontúry (OpenCV),
  - kruhovitosť       = 4π·plocha / obvod²       (1 = kruh, 0 = nepravidelný),
  - excentricita      = sqrt(1 − (λ2/λ1)) z vlastných čísel 2. centrálneho momentu
                        (0 = kruh, →1 = pretiahnutý),
  - pomer_stran       = sqrt(λ1/λ2)               (koľkokrát je dlhšia os dlhšia).

Výstup:
  - tvary_masky.csv          (riadok = fotka, stĺpce = príznaky)
  - tvary_masky_zhrnute.csv  (riadok = druh, priemer ± SD cez fotky)
  - tvary_boxploty.png       (4 boxploty podľa druhu)

    python -m klasifikacia.tvary_masky --fotky images/D2 --masky images/D2/masky
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import nacitaj_masku, udaje_z_nazvu, zoznam_fotiek

VYSTUP = Path(__file__).parent / "vysledky_tvary"


def priznaky_masky(maska):
    """Vráti dict s geometrickými príznakmi masky. Ak maska nemá kontúru, vráti None."""
    maska_u8 = (maska.astype(np.uint8) * 255)
    kontury, _ = cv2.findContours(maska_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not kontury:
        return None
    # najväčšia kontúra (masky môžu obsahovať drobné artefakty)
    kontura = max(kontury, key=cv2.contourArea)

    plocha = float(cv2.contourArea(kontura))
    obvod = float(cv2.arcLength(kontura, True))
    if plocha < 20 or obvod < 10:
        return None

    kruhovitost = 4 * np.pi * plocha / (obvod ** 2) if obvod > 0 else 0.0

    # 2. centrálny moment z pixelov masky → excentricita a pomer strán
    ys, xs = np.nonzero(maska)
    cov = np.cov(np.column_stack([xs, ys]), rowvar=False)
    cisla = np.sort(np.linalg.eigvalsh(cov))[::-1]  # λ1 >= λ2
    l1, l2 = max(cisla[0], 1e-9), max(cisla[1], 1e-9)
    excentricita = float(np.sqrt(1 - l2 / l1))
    pomer_stran = float(np.sqrt(l1 / l2))

    return {
        "plocha": plocha,
        "obvod": obvod,
        "kruhovitost": kruhovitost,
        "excentricita": excentricita,
        "pomer_stran": pomer_stran,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    args = ap.parse_args()

    riadky = []
    for cesta in zoznam_fotiek(args.fotky):
        maska = nacitaj_masku(Path(args.masky) / (cesta.stem + ".png"))
        if maska is None or not maska.any():
            continue
        _, druh = udaje_z_nazvu(cesta.stem)
        pr = priznaky_masky(maska)
        if pr is None:
            continue
        riadky.append({"druh": druh, "subor": cesta.name, **pr})
    tabulka = pd.DataFrame(riadky)
    if tabulka.empty:
        print("Žiadne masky nenačítané.")
        return

    # zhrnutie po druhoch
    priznaky = ["plocha", "kruhovitost", "excentricita", "pomer_stran"]
    zhrnute = tabulka.groupby("druh")[priznaky].agg(["mean", "std", "count"])
    zhrnute.columns = [f"{a}_{b}" for a, b in zhrnute.columns]
    zhrnute = zhrnute.reset_index()

    VYSTUP.mkdir(exist_ok=True)
    tabulka.to_csv(VYSTUP / "tvary_masky.csv", index=False, encoding="utf-8")
    zhrnute.to_csv(VYSTUP / "tvary_masky_zhrnute.csv", index=False, encoding="utf-8")

    # ---- boxploty ----
    druhy = sorted(tabulka.druh.unique())
    popisky = {
        "plocha": "plocha (px)",
        "kruhovitost": "kruhovitosť (1 = kruh)",
        "excentricita": "excentricita (0 = kruh)",
        "pomer_stran": "pomer strán (dlhšia/kratšia os)",
    }
    fig, osi = plt.subplots(1, 4, figsize=(18, 5.5))
    for ax, priznak in zip(osi, priznaky):
        data = [tabulka.loc[tabulka.druh == d, priznak].to_numpy() for d in druhy]
        bp = ax.boxplot(data, patch_artist=True, labels=druhy, showfliers=True)
        farby = plt.get_cmap("tab20")(np.linspace(0, 1, len(druhy)))
        for patch, farba in zip(bp["boxes"], farby):
            patch.set_facecolor(farba)
            patch.set_alpha(0.6)
        ax.set_title(popisky[priznak])
        ax.set_xticklabels(druhy, rotation=60, ha="right", fontsize=8)
        ax.grid(alpha=0.25, axis="y")
    fig.suptitle("Geometrické príznaky masky podľa druhu (bod = fotka)")
    fig.tight_layout()
    fig.savefig(VYSTUP / "tvary_boxploty.png", dpi=150)
    plt.close(fig)

    # ---- konzolový výpis: kde sa Curtobacterium a Sphingomonas líšia ----
    print("Zhrnutie po druhoch (priemer ± SD):")
    pd.set_option("display.width", 200)
    print(zhrnute.round(2).to_string(index=False))

    dvojica = ["Curtobacterium", "Sphingomonas"]
    pod = tabulka[tabulka.druh.isin(dvojica)]
    if len(pod) > 0:
        print("\nCurtobacterium vs. Sphingomonas — priemer ± SD:")
        for priznak in priznaky:
            for d in dvojica:
                hodnoty = tabulka.loc[tabulka.druh == d, priznak]
                if len(hodnoty):
                    print(f"  {priznak:14s} {d:15s} {hodnoty.mean():8.2f} ± {hodnoty.std(ddof=0):.2f}")
        print("\nAk sa intervaly ±1 SD neprekrývajú → použiteľné ako pravidlo v kľúči.")
    print(f"\nUložené do {VYSTUP}")


if __name__ == "__main__":
    main()