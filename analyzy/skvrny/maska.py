"""Hľadanie masky škvrny na fotke jednej škvrny.

Fotka sa rozloží na farebné kanály, každý kanál sa prahuje niekoľkými metódami v oboch
smeroch a z takto vzniknutých kandidátnych masiek sa vyberie tá s najvyšším skóre.
"""
import math

import cv2
import numpy as np
from skimage import filters

PRIESTORY = [
    ("RGB", None, ["R", "G", "B"]),
    ("HSV", cv2.COLOR_BGR2HSV, ["H", "S", "V"]),
    ("Lab", cv2.COLOR_BGR2LAB, ["L", "a", "b"]),
    ("YCbCr", cv2.COLOR_BGR2YCrCb, ["Y", "Cr", "Cb"]),
    ("XYZ", cv2.COLOR_BGR2XYZ, ["X", "Y", "Z"]),
    ("YUV", cv2.COLOR_BGR2YUV, ["Y", "U", "V"]),
]
VSETKY_KANALY = [f"{priestor}_{zlozka}" for priestor, _, zlozky in PRIESTORY for zlozka in zlozky] + ["Gray"]
JASOVE_KANALY = ["HSV_V", "Lab_L", "YCbCr_Y", "XYZ_Y", "XYZ_Z", "YUV_Y", "Gray"]


def otsu(kanal):
    return cv2.threshold(kanal, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0]


def triangle(kanal):
    return cv2.threshold(kanal, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_TRIANGLE)[0]


METODY = {
    "Otsu": otsu,
    "Triangle": triangle,
    "Yen": filters.threshold_yen,
    "Li": filters.threshold_li,
    "Isodata": filters.threshold_isodata,
    "Mean": filters.threshold_mean,
    "Minimum": filters.threshold_minimum,
}

PROFILY = {
    "rychly": (["HSV_S", "Lab_a", "XYZ_X", "YUV_U"],
               ["Yen", "Isodata", "Minimum"]),
    "kvalitny": (["HSV_H", "HSV_S", "Lab_a", "XYZ_X", "YUV_U", "YUV_V"],
                 ["Yen", "Li", "Isodata", "Minimum"]),
}

POKRYTIE = (0.02, 0.9)
VAHA_KONTRASTU = 0.3
JADRO = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))


def farebne_kanaly(obrazok):
    """Všetkých 19 kanálov fotky (BGR) v pevnom poradí VSETKY_KANALY."""
    kanaly = {}
    for priestor, konverzia, zlozky in PRIESTORY:
        if konverzia is None:
            casti = cv2.split(obrazok)[::-1]
        else:
            casti = cv2.split(cv2.cvtColor(obrazok, konverzia))
        for zlozka, kanal in zip(zlozky, casti):
            kanaly[f"{priestor}_{zlozka}"] = kanal
    kanaly["Gray"] = cv2.cvtColor(obrazok, cv2.COLOR_BGR2GRAY)
    return kanaly


def vypocitaj_prah(metoda, kanal):
    try:
        with np.errstate(all="ignore"):
            return float(METODY[metoda](kanal))
    except Exception:
        return None  # napr. Minimum, keď histogram nemá dva vrcholy


def vycisti(maska):
    """Vyhladí masku, vyplní diery a nechá len dosť veľké oblasti, ktoré sa nedotýkajú okraja."""
    maska = cv2.morphologyEx(maska, cv2.MORPH_CLOSE, JADRO)
    maska = cv2.morphologyEx(maska, cv2.MORPH_OPEN, JADRO)

    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    vyplnena = np.zeros_like(maska)
    if obrysy:
        cv2.drawContours(vyplnena, obrysy, -1, 255, cv2.FILLED)

    vyska, sirka = maska.shape
    min_plocha = max(150, int(0.002 * vyska * sirka))
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(vyplnena)

    vysledok = np.zeros_like(maska)
    for i in range(1, pocet):
        x, y, w, h, plocha = udaje[i]
        pri_okraji = x == 0 or y == 0 or x + w == sirka or y + h == vyska
        if plocha >= min_plocha and not pri_okraji:
            vysledok[oblasti == i] = 255
    return vysledok


def kontrast(maska, kanal):
    plocha = np.count_nonzero(maska)
    if plocha == 0:
        return 0.0

    polomer = max(3, round(0.15 * math.sqrt(plocha / math.pi)))
    vonku = np.where(maska, 0, 255).astype(np.uint8)
    vzdialenost = cv2.distanceTransform(vonku, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    lem = (vzdialenost > 0) & (vzdialenost <= polomer)
    if not lem.any():
        return 0.0

    hodnoty_lemu = kanal[lem].astype(np.float32)
    rozdiel = abs(float(kanal[maska].mean()) - float(hodnoty_lemu.mean()))
    return rozdiel / (float(hodnoty_lemu.std()) + 1.0)


def skore(maska, kanal):
    """Kruhovitosť + bonus za primerané pokrytie - penalizácia za rozpad + kontrast s okolím."""
    pokrytie = cv2.countNonZero(maska) / maska.size
    if pokrytie == 0:
        return -math.inf

    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    kruhovitosti, plochy = [], []
    for obrys in obrysy:
        plocha = cv2.contourArea(obrys)
        obvod = cv2.arcLength(obrys, True)
        if plocha > 0 and obvod > 0:
            kruhovitosti.append(min(4 * math.pi * plocha / obvod ** 2, 1.0))
            plochy.append(plocha)
    if not plochy:
        return -math.inf

    kruhovitost = float(np.average(kruhovitosti, weights=plochy))

    najmenej, najviac = POKRYTIE
    if najmenej <= pokrytie <= najviac:
        bonus = 0.3
    else:
        stred = (najmenej + najviac) / 2
        bonus = -min(abs(pokrytie - stred) / stred, 1.0)

    penalizacia = 0.04 * max(0, len(plochy) - 6)
    return kruhovitost + bonus - penalizacia + VAHA_KONTRASTU * math.log1p(kontrast(maska > 0, kanal))


def kandidati(obrazok, kanaly, metody):
    """Všetky kandidátne masky: kanál × metóda × smer prahu (škvrna pod alebo nad prahom)."""
    for nazov, kanal in farebne_kanaly(obrazok).items():
        if nazov not in kanaly:
            continue
        kanal = cv2.GaussianBlur(kanal, (5, 5), 0)

        for metoda in METODY:
            if metoda not in metody:
                continue
            prah = vypocitaj_prah(metoda, kanal)
            if prah is None:
                continue

            for smer in ("pod", "nad"):
                surova = kanal < prah if smer == "pod" else kanal > prah
                maska = vycisti(surova.astype(np.uint8) * 255)
                yield {"kanal": nazov, "metoda": metoda, "smer": smer, "maska": maska,
                       "skore": skore(maska, kanal), "rozmazany_kanal": kanal}


def najdi_masku(obrazok, profil="rychly", max_strana=1200):
    kanaly, metody = PROFILY[profil]
    vyska, sirka = obrazok.shape[:2]

    mensi = obrazok
    if max_strana and max(vyska, sirka) > max_strana:
        mierka = max_strana / max(vyska, sirka)
        nova_velkost = (round(sirka * mierka), round(vyska * mierka))
        mensi = cv2.resize(obrazok, nova_velkost, interpolation=cv2.INTER_AREA)

    vitaz = max(kandidati(mensi, kanaly, metody), key=lambda kandidat: kandidat["skore"])
    maska = cv2.resize(vitaz["maska"], (sirka, vyska), interpolation=cv2.INTER_NEAREST)
    return maska, vitaz
