"""Strana, text a tlač na fotke dokumentu."""
import cv2
import numpy as np

OKNO_TEXTU = 2.5
TEXT_K = 6.0
TEXT_MIN = 6.0
HUSTY_TEXT = 0.35
ADAPTIVNY_PRAH = 10

ILUSTRACIA = 5.0
TLAC_STRANA = 3200
PLNA_TLAC_DE = 15.0
PLNA_TLAC_PLOCHA = 2.0
PLNA_TLAC_ROZMER = 1.6
PLNA_TLAC_OKRAJ = 2.5
TMAVE_POZADIE = 10.0

ODHAD_STRANA = 400
OKNO_PAPIERA = 4


def neparne(x):
    x = int(round(x))
    return x if x % 2 else x + 1


def kruh(polomer):
    r = max(1, int(round(polomer)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def na_lab(obrazok):
    """BGR -> L* (0-100), a*, b*."""
    lab = cv2.cvtColor(obrazok, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] *= 100.0 / 255.0
    lab[..., 1:] -= 128.0
    return lab


def hystereza(slabe, silne):
    pocet, oblasti = cv2.connectedComponents(slabe.astype(np.uint8))
    ponechat = np.zeros(pocet, bool)
    ponechat[np.unique(oblasti[silne])] = True
    ponechat[0] = False
    return ponechat[oblasti]


def gradient_jasu(jas):
    return np.hypot(cv2.Sobel(jas, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(jas, cv2.CV_32F, 0, 1, ksize=3)) / 8


def okrajovy_pas(oblast, sirka=2):
    oblast = oblast.astype(np.uint8)
    return (cv2.dilate(oblast, kruh(sirka)) > 0) & ~(cv2.erode(oblast, kruh(sirka)) > 0)


def okolo(udaje, okraj, rozmer):
    x, y, sirka, vyska = (int(v) for v in udaje[:4])
    h, w = rozmer[:2]
    return max(0, x - okraj), max(0, y - okraj), min(w, x + sirka + okraj), min(h, y + vyska + okraj)


def typicka_vyska_pismena(udaje, inak):
    plochy, vysky = udaje[1:, cv2.CC_STAT_AREA], udaje[1:, cv2.CC_STAT_HEIGHT]
    return float(np.median(vysky[plochy >= 10])) if (plochy >= 10).any() else inak


def maska_strany(obrazok):
    """Papier strany, ak je fotená na tmavom podklade, inak celý obrázok."""
    h, w = obrazok.shape[:2]
    jas = cv2.GaussianBlur(cv2.cvtColor(obrazok, cv2.COLOR_BGR2LAB)[..., 0], (0, 0), max(2, max(h, w) / 300))
    b = max(2, min(h, w) // 25)
    okraj = np.concatenate([jas[:b].ravel(), jas[-b:].ravel(), jas[:, :b].ravel(), jas[:, -b:].ravel()])
    stred = jas[h // 4:3 * h // 4, w // 4:3 * w // 4]
    cela = np.full((h, w), 255, np.uint8)
    if np.median(okraj) > 0.6 * np.median(stred):
        return cela

    _, svetle = cv2.threshold(jas, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(svetle)
    if pocet <= 1:
        return cela

    najvacsia = 1 + int(np.argmax(udaje[1:, cv2.CC_STAT_AREA]))
    obrysy, _ = cv2.findContours((oblasti == najvacsia).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    strana = np.zeros((h, w), np.uint8)
    cv2.drawContours(strana, obrysy, -1, 255, cv2.FILLED)
    if not 0.2 <= strana.mean() / 255 <= 0.97:
        strana[:] = 255
    return cv2.erode(strana, kruh(max(h, w) / 80))


def hrubka_tahu(obrazok, strana):
    """Typický polomer ťahu písma v px."""
    dlhsia = max(obrazok.shape[:2])
    jas = cv2.cvtColor(obrazok, cv2.COLOR_BGR2LAB)[..., 0]
    tmave = cv2.adaptiveThreshold(jas, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
                                  neparne(max(15, dlhsia / 30)), ADAPTIVNY_PRAH) & strana
    binarna = (tmave > 0).astype(np.uint8)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(binarna, connectivity=8)
    if pocet <= 1:
        return 2.0

    vzdialenost = cv2.distanceTransform(binarna, cv2.DIST_L2, 3)
    vrcholy = np.zeros(pocet, np.float32)
    np.maximum.at(vrcholy, oblasti.ravel(), vzdialenost.ravel())
    vrcholy = vrcholy[1:][udaje[1:, cv2.CC_STAT_AREA] >= 8]
    return float(np.percentile(vrcholy, 75)) if vrcholy.size else 2.0


def odstran_text(obrazok, lab, strana):
    """Odstráni text black-hat transformáciou jasu."""
    jas = lab[..., 0]
    hrubka = hrubka_tahu(obrazok, strana)
    polomer = max(2, int(round(OKNO_TEXTU * hrubka)))
    blackhat = cv2.morphologyEx(jas, cv2.MORPH_CLOSE, kruh(polomer)) - jas

    hodnoty = blackhat[strana > 0]
    median = float(np.median(hodnoty))
    mad = 1.4826 * float(np.median(np.abs(hodnoty - median))) + 1e-3
    prah = max(TEXT_MIN, median + TEXT_K * mad)
    atrament = hystereza((blackhat > 0.5 * prah) & (strana > 0), (blackhat > prah) & (strana > 0))

    s_lemom = cv2.dilate(atrament.astype(np.uint8) * 255, kruh(max(1, hrubka * 0.6)))
    return vypln_pozadie(obrazok, s_lemom, polomer), s_lemom, polomer, atrament


def vypln_pozadie(obrazok, diery, polomer):
    jadro = kruh(polomer)
    pozadie = np.dstack([cv2.morphologyEx(obrazok[..., k], cv2.MORPH_CLOSE, jadro) for k in range(3)])
    pozadie = cv2.GaussianBlur(pozadie, (0, 0), max(1.0, polomer / 2))
    okno = neparne(4 * polomer + 1)
    hustota = cv2.blur((diery > 0).astype(np.float32), (okno, okno))
    nahradit = (diery > 0) | (hustota > HUSTY_TEXT)
    vysledok = obrazok.copy()
    vysledok[nahradit] = pozadie[nahradit]
    return vysledok


def odhad_papiera(obrazok, vynechat, strana):
    """Farba papiera v LAB pre každý pixel."""
    h, w = obrazok.shape[:2]
    f = min(1.0, ODHAD_STRANA / max(h, w))
    velkost = (max(8, round(w * f)), max(8, round(h * f)))
    male = cv2.resize(obrazok, velkost, interpolation=cv2.INTER_AREA)
    vynechane = cv2.resize(vynechat, velkost, interpolation=cv2.INTER_NEAREST)
    na_strane = cv2.resize(strana, velkost, interpolation=cv2.INTER_NEAREST) > 0

    male = cv2.inpaint(male, cv2.dilate(vynechane, kruh(1)), 3, cv2.INPAINT_TELEA)
    dobre = na_strane & (vynechane == 0)
    if dobre.any():
        male[~na_strane] = np.median(male[dobre], axis=0).astype(np.uint8)
    pozadie = cv2.medianBlur(male, min(neparne(max(velkost) / OKNO_PAPIERA), 255))
    return na_lab(cv2.resize(pozadie, (w, h), interpolation=cv2.INTER_LINEAR))


def mapa_ilustracii(atrament, strana):
    """Veľké súvislé siete čiar (ilustrácie, rytiny)."""
    binarna = (atrament > 0).astype(np.uint8)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(binarna, connectivity=8)
    if pocet <= 1:
        return np.zeros(atrament.shape, bool)

    pismeno = typicka_vyska_pismena(udaje, inak=10.0)
    hranica = ILUSTRACIA * pismeno
    velke = np.zeros(pocet, bool)
    velke[1:] = (udaje[1:, cv2.CC_STAT_HEIGHT] > hranica) & (udaje[1:, cv2.CC_STAT_WIDTH] > hranica)
    mapa = velke[oblasti].astype(np.uint8)
    if not mapa.any():
        return np.zeros(atrament.shape, bool)

    mapa = cv2.morphologyEx(mapa, cv2.MORPH_CLOSE, kruh(max(2, pismeno)))
    obrysy, _ = cv2.findContours(mapa, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    vyplnena = np.zeros_like(mapa)
    cv2.drawContours(vyplnena, obrysy, -1, 1, cv2.FILLED)
    return (vyplnena > 0) & (strana > 0)


def plna_tlac(lab, papier, strana, pismeno):
    """Plné tlačené útvary s ostrým okrajom."""
    rozdiel = lab - papier
    odlisne = (np.linalg.norm(rozdiel * np.array([0.5, 1, 1], np.float32), axis=2) > PLNA_TLAC_DE) & (strana > 0)
    jas = lab[..., 0]
    gradient = gradient_jasu(jas)

    vysledok = np.zeros(odlisne.shape, bool)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(odlisne.astype(np.uint8))
    for i in range(1, pocet):
        _, _, sirka, vyska, plocha = (int(v) for v in udaje[i])
        if plocha < PLNA_TLAC_PLOCHA * pismeno * pismeno or min(sirka, vyska) < PLNA_TLAC_ROZMER * pismeno:
            continue
        x0, y0, x1, y1 = okolo(udaje[i], 3, jas.shape)
        utvar = oblasti[y0:y1, x0:x1] == i
        kontrast = abs(float(np.median(rozdiel[y0:y1, x0:x1, 0][utvar]))) + 1.0
        strmost = np.percentile(gradient[y0:y1, x0:x1][okrajovy_pas(utvar)], 90) + 1e-3
        if kontrast / strmost < PLNA_TLAC_OKRAJ:
            vysledok[y0:y1, x0:x1] |= utvar
    return vysledok


def mapa_tlace(povodny, rozmer):
    """Mapa ilustrácií a plnej tlače v rozmere pracovného obrázka."""
    f = min(1.0, TLAC_STRANA / max(povodny.shape[:2]))
    obrazok = cv2.resize(povodny, None, fx=f, fy=f, interpolation=cv2.INTER_AREA) if f < 1 else povodny
    strana = maska_strany(obrazok)
    bez_textu, _, _, ciary = odstran_text(obrazok, na_lab(obrazok), strana)
    lab_bez_textu = na_lab(bez_textu)

    pocet, _, udaje, _ = cv2.connectedComponentsWithStats(ciary.astype(np.uint8))
    pismeno = typicka_vyska_pismena(udaje, inak=8.0) if pocet > 1 else 8.0
    papier = odhad_papiera(obrazok, (ciary * 255).astype(np.uint8), strana)

    tmave_pozadie = lab_bez_textu[..., 0] < papier[..., 0] - TMAVE_POZADIE
    mapa = (mapa_ilustracii(ciary & ~tmave_pozadie, strana)
            | plna_tlac(lab_bez_textu, papier, strana, pismeno))
    mapa = cv2.dilate(mapa.astype(np.uint8), kruh(max(2, pismeno)))
    return cv2.resize(mapa, (rozmer[1], rozmer[0]), interpolation=cv2.INTER_AREA) > 0
