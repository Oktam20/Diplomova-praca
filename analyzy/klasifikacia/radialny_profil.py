"""Radiálny profil farieb škvrny — priemer Lab v 3 kruhoch od stredu masky.

Pre každú masku:
  - nájde ťažisko masky (vážené stredom),
  - rozdelí pixely masky do 3 sústredných kruhov (rovnakej plochy, tercily
    vzdialenosti od ťažiska — aby každý kruh mal rovnako pixelov),
  - spočíta priemer dL, da, db voči papieru v každom kruhu.

Výstup:
  - radialny_profil.csv        (riadok = druh × kruh, priemer ± SD cez fotky)
  - radialne_profily.png       (3 panely: dL / da / db, čiara = druh)
  - radialne_profily_norm.png  (to isté, normalizované tak, že stred = 0 a okraj = 1)

    python -m klasifikacia.radialny_profil --fotky images/D2 --masky images/D2/masky
"""
import argparse
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from skvrny.subory import nacitaj_masku, nacitaj_obrazok, udaje_z_nazvu, zoznam_fotiek

VYSTUP = Path(__file__).parent / "vysledky_radialny"
PIXELOV_Z_FOTKY = 2000
OSI = ["dL", "da", "db"]
POCET_KRUHOV = 3


def radialny_profil(obrazok, maska, papier=None):
    """Priemer Lab voči papieru v 3 kruhoch od ťažiska masky (rovnakej plochy).

    Vráti pole tvaru (POCET_KRUHOV, 3) — riadok = kruh (0 = stred, 2 = okraj),
    stĺpec = dL, da, db. Ak má maska málo pixelov, vráti None.
    papier: farba papiera (Lab); predvolene medián pixelov mimo masky.
    """
    if not maska.any():
        return None
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    if papier is None:
        papier = np.median(lab[~maska], axis=0)

    ys, xs = np.nonzero(maska)
    pixely = lab[maska] - papier  # (N, 3)
    # ťažisko masky
    cy, cx = ys.mean(), xs.mean()
    # vzdialenosť každého pixelu od ťažiska
    r = np.hypot(ys - cy, xs - cx)

    # tercily vzdialenosti → 3 kruhy rovnakej plochy
    hranice = np.quantile(r, [1 / 3, 2 / 3])
    kruh = np.digitize(r, hranice)  # 0, 1, 2

    profil = np.full((POCET_KRUHOV, 3), np.nan)
    for k in range(POCET_KRUHOV):
        vyber = kruh == k
        if vyber.sum() < 10:  # príliš málo pixelov v kruhu
            return None
        profil[k] = pixely[vyber].mean(axis=0)
    return profil


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    args = ap.parse_args()

    # profilov_druhu[druh] = zoznam polí (POCET_KRUHOV, 3) — jedna na fotku
    profilov_druhu = {}
    for cesta in zoznam_fotiek(args.fotky):
        maska = nacitaj_masku(Path(args.masky) / (cesta.stem + ".png"))
        if maska is None or not maska.any():
            continue
        _, druh = udaje_z_nazvu(cesta.stem)
        profil = radialny_profil(nacitaj_obrazok(cesta), maska)
        if profil is None:
            continue
        profilov_druhu.setdefault(druh, []).append(profil)

    # tabuľka: druh × kruh × os, priemer a SD cez fotky
    riadky = []
    for druh in sorted(profilov_druhu):
        profily = np.stack(profilov_druhu[druh])  # (F, K, 3)
        for k in range(POCET_KRUHOV):
            for i, os_ in enumerate(OSI):
                hodnoty = profily[:, k, i]
                riadky.append({
                    "druh": druh,
                    "kruh": k,
                    "kruh_nazov": ["stred", "medzikruzie", "okraj"][k],
                    "os": os_,
                    "priemer": hodnoty.mean(),
                    "std": hodnoty.std(ddof=0),
                    "pocet_fotiek": len(hodnoty),
                })
    tabulka = pd.DataFrame(riadky)

    VYSTUP.mkdir(exist_ok=True)
    tabulka.to_csv(VYSTUP / "radialny_profil.csv", index=False, encoding="utf-8")

    # ---- graf: 3 panely (dL, da, db), čiara = druh, body = kruhy ----
    druhy = sorted(profilov_druhu)
    farby = plt.get_cmap("tab20")(np.linspace(0, 1, len(druhy)))
    x = np.arange(POCET_KRUHOV)

    fig, osi = plt.subplots(1, 3, figsize=(16, 5.5), sharex=True)
    for druh, farba in zip(druhy, farby):
        pod = tabulka[tabulka.druh == druh]
        for ax, os_ in zip(osi, OSI):
            cast = pod[pod.os == os_].sort_values("kruh")
            ax.errorbar(x, cast.priemer, yerr=cast["std"], color=farba,
                        marker="o", lw=2, capsize=3, label=druh if os_ == OSI[0] else None)
    for ax, os_ in zip(osi, OSI):
        ax.set_xticks(x)
        ax.set_xticklabels(["stred", "medzikružie", "okraj"])
        ax.set_xlabel("poloha v kolónii")
        ax.set_ylabel(f"{os_} voči papieru")
        ax.axhline(0, color="#ccc", lw=0.8)
        ax.set_title(f"radiálny profil — {os_}")
        ax.grid(alpha=0.25)
    osi[0].legend(fontsize=7, ncol=2)
    fig.suptitle("Radiálny profil farieb: priemer ± SD cez fotky (stred → okraj)")
    fig.tight_layout()
    fig.savefig(VYSTUP / "radialne_profily.png", dpi=150)
    plt.close(fig)

    # ---- normalizovaný graf: stred = 0, okraj = 1 (tvar gradientu) ----
    fig, osi = plt.subplots(1, 3, figsize=(16, 5.5), sharex=True)
    for druh, farba in zip(druhy, farby):
        pod = tabulka[tabulka.druh == druh]
        for ax, os_ in zip(osi, OSI):
            cast = pod[pod.os == os_].sort_values("kruh")
            hodnoty = cast.priemer.to_numpy()
            # stred = 0, okraj = 1, aby bol viditeľný len tvar gradientu (medzikružie mimo 0..1 = nemonotónny profil)
            rozsah = hodnoty[-1] - hodnoty[0]
            if abs(rozsah) > 1e-6:
                norm = (hodnoty - hodnoty[0]) / rozsah
            else:
                norm = np.zeros_like(hodnoty)
            ax.plot(x, norm, color=farba, marker="o", lw=2,
                    label=druh if os_ == OSI[0] else None)
    for ax, os_ in zip(osi, OSI):
        ax.set_xticks(x)
        ax.set_xticklabels(["stred", "medzikružie", "okraj"])
        ax.set_xlabel("poloha v kolónii")
        ax.set_ylabel("normalizovaná hodnota (0 = stred, 1 = okraj)")
        ax.set_title(f"tvar gradientu — {os_}")
        ax.grid(alpha=0.25)
    osi[0].legend(fontsize=7, ncol=2)
    fig.suptitle("Normalizovaný radiálny profil (tvar gradientu, nie absolútna farba)")
    fig.tight_layout()
    fig.savefig(VYSTUP / "radialne_profily_norm.png", dpi=150)
    plt.close(fig)

    # ---- konzolový výpis: najväčší gradient (okraj − stred) na os ----
    print("Najväčší radiálny gradient (okraj − stred) pre každý druh a os:")
    prehlad = []
    for druh in druhy:
        pod = tabulka[tabulka.druh == druh]
        riadok = {"druh": druh}
        for os_ in OSI:
            cast = pod[pod.os == os_].sort_values("kruh")
            hodnoty = cast.priemer.to_numpy()
            riadok[f"gradient_{os_}"] = hodnoty[-1] - hodnoty[0]  # okraj − stred
        prehlad.append(riadok)
    prehlad = pd.DataFrame(prehlad)
    print(prehlad.round(2).to_string(index=False))
    print(f"\nUložené do {VYSTUP}")


if __name__ == "__main__":
    main()