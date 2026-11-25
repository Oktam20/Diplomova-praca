"""Textúra a lokálny kontrast jasu škvrny – porovnanie druhov (všetkých alebo vybranej dvojice).

Pre každú masku spočíta:
  - zrnitosť: SD jasu (dL) vnútri masky,
  - entropia: Shannonova entropia histogramu jasu (32 binov),
  - gradient_dL: priemer jasu v strede (1. tercil vzdialenosti od ťažiska) − priemer na okraji (3. tercil).

Výstup:
  - porovnanie_dvojice.csv (riadok = fotka)
  - porovnanie_dvojice.png (strip plot pre 3 príznaky, bod = fotka)

    python -m klasifikacia.porovnanie_dvojice --fotky images/D2 --masky images/D2/masky
    python -m klasifikacia.porovnanie_dvojice --druhy Curtobacterium Sphingomonas
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import nacitaj_masku, nacitaj_obrazok, udaje_z_nazvu, zoznam_fotiek

VYSTUP = Path(__file__).parent / "vysledky_dvojica"
MIN_PIXELOV = 100
PRIZNAKY = {
    "sd_dL": "zrnitosť (SD jasu)",
    "entropia": "entropia jasu (bity)",
    "gradient_dL": "gradient jasu (stred − okraj)",
}


def priznaky_textury(obrazok, maska, papier=None):
    """Zrnitosť, entropia a gradient jasu; None pri prázdnej alebo príliš malej maske.

    papier: farba papiera (Lab); predvolene medián pixelov mimo masky.
    """
    if maska.sum() < MIN_PIXELOV or (~maska).sum() < MIN_PIXELOV:
        return None
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    if papier is None:
        papier = np.median(lab[~maska], axis=0)
    jas = lab[maska][:, 0] - papier[0]

    hist, _ = np.histogram(jas, bins=32)
    p = hist[hist > 0] / hist.sum()
    entropia = float(-np.sum(p * np.log2(p)))

    # tercily vzdialenosti od ťažiska -> stred, medzikružie, okraj s rovnakým počtom pixelov
    ys, xs = np.nonzero(maska)
    r = np.hypot(ys - ys.mean(), xs - xs.mean())
    kruh = np.digitize(r, np.quantile(r, [1 / 3, 2 / 3]))
    if (kruh == 0).sum() < 10 or (kruh == 2).sum() < 10:
        return None

    return {"sd_dL": float(jas.std()), "entropia": entropia,
            "gradient_dL": float(jas[kruh == 0].mean() - jas[kruh == 2].mean())}


def graf(tabulka, druhy, cesta):
    """Strip plot: každý bod je fotka, čiarkovaná čiara priemer druhu."""
    rng = np.random.default_rng(42)
    farby = plt.get_cmap("tab20")(np.linspace(0, 1, max(len(druhy), 2)))
    fig, osi = plt.subplots(1, 3, figsize=(max(12, 1.3 * len(druhy) * 3), 5.5))

    for ax, (priznak, nazov) in zip(osi, PRIZNAKY.items()):
        for i, (druh, farba) in enumerate(zip(druhy, farby)):
            hodnoty = tabulka.loc[tabulka.druh == druh, priznak]
            ax.scatter(i + rng.normal(0, 0.08, len(hodnoty)), hodnoty, color=farba, alpha=0.75,
                       edgecolor="white", s=45)
            ax.hlines(hodnoty.mean(), i - 0.25, i + 0.25, colors="black", linestyles="dashed", lw=1.8)
        ax.set_xticks(range(len(druhy)))
        ax.set_xticklabels(druhy, rotation=45 if len(druhy) > 3 else 0, ha="right" if len(druhy) > 3 else "center")
        ax.set_ylabel(nazov)
        ax.set_title(nazov)
        ax.grid(alpha=0.3, axis="y")

    fig.suptitle("Textúra a gradient jasu po druhoch (bod = fotka, čiarkovaná čiara = priemer druhu)")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    ap.add_argument("--druhy", nargs="+", help="len tieto druhy (napr. problémová dvojica); predvolene všetky")
    args = ap.parse_args()

    riadky = []
    for cesta in zoznam_fotiek(args.fotky):
        _, druh = udaje_z_nazvu(cesta.stem)
        if args.druhy and druh not in args.druhy:
            continue
        maska = nacitaj_masku(Path(args.masky) / (cesta.stem + ".png"))
        if maska is None:
            continue
        priznaky = priznaky_textury(nacitaj_obrazok(cesta), maska)
        if priznaky is None:
            print(f"vynechaná (malá maska): {cesta.name}")
            continue
        riadky.append({"druh": druh, "subor": cesta.name, **priznaky})

    tabulka = pd.DataFrame(riadky)
    if tabulka.empty:
        print("Žiadne masky nenačítané.")
        return

    VYSTUP.mkdir(exist_ok=True)
    nazov = "porovnanie_dvojice" if not args.druhy else "porovnanie_" + "_".join(args.druhy)
    tabulka.to_csv(VYSTUP / f"{nazov}.csv", index=False, encoding="utf-8")
    druhy = args.druhy or sorted(tabulka.druh.unique())
    graf(tabulka, [d for d in druhy if d in set(tabulka.druh)], VYSTUP / f"{nazov}.png")

    pd.set_option("display.width", 200)
    print(tabulka.groupby("druh")[list(PRIZNAKY)].agg(["mean", "std"]).round(2).to_string())
    print(f"\nUložené do {VYSTUP}")


if __name__ == "__main__":
    main()
