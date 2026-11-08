"""Hľadanie škvŕn na fotkách strán dokumentov.

    python -m dokumenty.dokument <strany alebo priečinok>
"""
import argparse
import shutil
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import numpy as np

from dokumenty.dokument_miesta import navrhni_miesta
from dokumenty.dokument_tlac import hystereza, kruh, mapa_tlace
from skvrny.maska import PROFILY, kandidati, skore
from skvrny.subory import nacitaj_obrazok, uloz_obrazok, zoznam_fotiek

VYSLEDKY = Path(__file__).parent / "vysledky"

PRACOVNA_STRANA = 1600
OKNO_NASOBOK = 2.5
OKNO_MIN = 48
OKNO_STRANA = 700
ROZSIRENIE = 0.25
MIN_POKRYTIE = 0.3
MAX_OBDLZNIK = 0.92
PROFIL = "rychly"

VYREZ_NASOBOK = 2.0
VYREZ_MIN_PLOCHA = 150
ZLUCENIE = 0.3


def spracuj_stranu(povodny):
    f = min(1.0, PRACOVNA_STRANA / max(povodny.shape[:2]))
    obrazok = cv2.resize(povodny, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else povodny
    return najdi_skvrny(obrazok, mapa_tlace(povodny, obrazok.shape[:2]))


def najdi_skvrny(obrazok, tlac):
    navrh, strana = navrhni_miesta(obrazok, tlac)
    maska = np.zeros(navrh.shape, np.uint8)
    for okno, miesto in okna(navrh):
        if (maska[miesto] > 0).mean() > 0.5:
            continue
        x0, y0, x1, y1 = okno
        maska[y0:y1, x0:x1][maska_v_okne(strana, okno, miesto)] = 255
    return maska & strana.maska, navrh, strana


def okna(navrh):
    h, w = navrh.shape
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(navrh)
    for i in sorted(range(1, pocet), key=lambda k: -udaje[k, cv2.CC_STAT_AREA]):
        x, y, sirka, vyska, _ = (int(v) for v in udaje[i])
        s = max(OKNO_MIN, int(max(sirka, vyska) * OKNO_NASOBOK))
        cx, cy = x + sirka // 2, y + vyska // 2
        x0, y0 = max(0, cx - s // 2), max(0, cy - s // 2)
        x1, y1 = min(w, x0 + s), min(h, y0 + s)
        x0, y0 = max(0, x1 - s), max(0, y1 - s)
        yield (x0, y0, x1, y1), oblasti == i


def maska_v_okne(strana, okno, miesto):
    x0, y0, x1, y1 = okno
    vyrez = strana.bez_textu[y0:y1, x0:x1].copy()
    mimo = strana.maska[y0:y1, x0:x1] == 0
    if mimo.any() and (~mimo).any():
        vyrez[mimo] = np.median(vyrez[~mimo], axis=0).astype(np.uint8)

    h, w = vyrez.shape[:2]
    f = OKNO_STRANA / max(h, w)
    velkost = (max(1, round(w * f)), max(1, round(h * f)))
    velky = cv2.resize(vyrez, velkost, interpolation=cv2.INTER_CUBIC if f > 1 else cv2.INTER_AREA)
    miesto = cv2.resize(miesto[y0:y1, x0:x1].astype(np.uint8), velkost, interpolation=cv2.INTER_NEAREST)

    maska = najlepsia_maska_pri(velky, miesto)
    return cv2.resize(maska.astype(np.uint8), (w, h), interpolation=cv2.INTER_NEAREST) > 0


def najlepsia_maska_pri(obrazok, miesto):
    g = max(2, int(ROZSIRENIE * max(obrazok.shape[:2]) / OKNO_NASOBOK))
    blizko = cv2.dilate(miesto, kruh(g)) > 0
    jadro = miesto > 0
    kanaly, metody = PROFILY[PROFIL]

    najlepsie_skore, najlepsia = -np.inf, None
    for kandidat in kandidati(obrazok, kanaly, metody):
        maska = kandidat["maska"] > 0
        maska = hystereza(maska, maska & blizko)
        if not maska.any() or (maska & jadro).sum() < MIN_POKRYTIE * jadro.sum():
            continue
        ys, xs = np.nonzero(maska)
        if maska.sum() > MAX_OBDLZNIK * (np.ptp(ys) + 1) * (np.ptp(xs) + 1):
            continue
        s = skore(maska.astype(np.uint8) * 255, kandidat["rozmazany_kanal"])
        if s > najlepsie_skore:
            najlepsie_skore, najlepsia = s, maska

    return najlepsia if najlepsia is not None else np.zeros(obrazok.shape[:2], bool)


def zluc_blizke(maska):
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(maska)
    rodic = list(range(pocet))

    def koren(a):
        while rodic[a] != a:
            a = rodic[a]
        return a

    obdlzniky = []
    for i in range(1, pocet):
        x, y, sirka, vyska = (int(v) for v in udaje[i, :4])
        g = ZLUCENIE * max(sirka, vyska)
        obdlzniky.append((i, x - g, y - g, x + sirka + g, y + vyska + g))
    for a, (i, ax0, ay0, ax1, ay1) in enumerate(obdlzniky):
        for j, bx0, by0, bx1, by1 in obdlzniky[a + 1:]:
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                rodic[koren(i)] = koren(j)

    korene = sorted({koren(i) for i in range(1, pocet)})
    nove_cislo = np.zeros(pocet, np.int32)
    for i in range(1, pocet):
        nove_cislo[i] = korene.index(koren(i)) + 1
    skupiny = nove_cislo[oblasti]

    statistiky = np.zeros((len(korene) + 1, 5), np.int64)
    for k in range(1, len(korene) + 1):
        ys, xs = np.nonzero(skupiny == k)
        statistiky[k] = (xs.min(), ys.min(), np.ptp(xs) + 1, np.ptp(ys) + 1, len(xs))
    return skupiny, statistiky


def uloz_vyrezy(strana, maska, priecinok, meno):
    (priecinok / "masky").mkdir(parents=True, exist_ok=True)
    h, w = maska.shape
    skupiny, udaje = zluc_blizke(maska)
    pocet = 0
    for i in range(1, len(udaje)):
        x, y, sirka, vyska, plocha = (int(v) for v in udaje[i])
        if plocha < VYREZ_MIN_PLOCHA:
            continue
        s = int(max(sirka, vyska) * VYREZ_NASOBOK)
        x0, y0 = max(0, x + sirka // 2 - s // 2), max(0, y + vyska // 2 - s // 2)
        x1, y1 = min(w, x0 + s), min(h, y0 + s)
        vyrez = strana.bez_textu[y0:y1, x0:x1].copy()
        mimo = strana.maska[y0:y1, x0:x1] == 0
        if mimo.any():
            vyrez[mimo] = np.median(vyrez[~mimo], axis=0).astype(np.uint8)
        if min(vyrez.shape[:2]) < 40:
            continue

        nazov = f"{meno}_{i:03d}.png"
        uloz_obrazok(priecinok / nazov, vyrez)
        uloz_obrazok(priecinok / "masky" / nazov, ((skupiny[y0:y1, x0:x1] == i) * 255).astype(np.uint8))
        pocet += 1
    return pocet


def uloz_prehlad(strana, navrh, maska, cesta):
    hrubka = max(2, round(max(strana.obrazok.shape[:2]) / 500))
    s_navrhom = strana.bez_textu.copy()
    obrysy, _ = cv2.findContours(navrh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(s_navrhom, obrysy, -1, (230, 120, 20), hrubka)

    cervena = strana.bez_textu.copy()
    cervena[maska > 0] = (40, 40, 220)
    s_maskou = cv2.addWeighted(cervena, 0.35, strana.bez_textu, 0.65, 0)
    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(s_maskou, obrysy, -1, (0, 0, 255), hrubka)

    h, w = strana.obrazok.shape[:2]
    fig, osi = plt.subplots(1, 3, figsize=(12.6, 4.2 * h / w + 0.5))
    for ax, (obrazok, nazov) in zip(osi, ((strana.obrazok, "Pôvodná strana"),
                                         (s_navrhom, "Bez textu + navrhnuté miesta"),
                                         (s_maskou, "Výsledná maska"))):
        ax.imshow(cv2.cvtColor(obrazok, cv2.COLOR_BGR2RGB))
        ax.set_title(nazov, fontsize=10, loc="left")
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="Nájde škvrny na fotkách strán dokumentov.")
    parser.add_argument("strany", nargs="+", type=Path, help="fotky strán alebo priečinok s nimi")
    parser.add_argument("--vystup", type=Path, default=VYSLEDKY, help="pred spustením sa vyprázdni")
    args = parser.parse_args()
    shutil.rmtree(args.vystup, ignore_errors=True)
    args.vystup.mkdir(parents=True)

    strany = [p for cesta in args.strany for p in (zoznam_fotiek(cesta) if cesta.is_dir() else [cesta])]
    for cesta in strany:
        povodny = nacitaj_obrazok(cesta)
        if povodny is None:
            print(f"{cesta.name}: nepodarilo sa načítať")
            continue

        maska, navrh, strana = spracuj_stranu(povodny)
        meno = cesta.stem
        uloz_obrazok(args.vystup / f"{meno}_maska.png", maska)
        uloz_obrazok(args.vystup / f"{meno}_bez_textu.jpg", strana.bez_textu)
        uloz_prehlad(strana, navrh, maska, args.vystup / f"{meno}_prehlad.png")
        vyrezov = uloz_vyrezy(strana, maska, args.vystup / f"{meno}_vyrezy", meno)

        navrhnutych = len(zluc_blizke(navrh)[1]) - 1
        najdenych = len(zluc_blizke(maska)[1]) - 1
        print(f"{cesta.name}: navrhnutých miest {navrhnutych}, nájdených škvŕn {najdenych}, výrezov {vyrezov}")

    print(f"Výstupy sú v {args.vystup}")


if __name__ == "__main__":
    main()
