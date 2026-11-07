"""Návrh miest, kde sú na strane dokumentu škvrny."""
from dataclasses import dataclass

import cv2
import numpy as np

from dokumenty.dokument_tlac import (ODHAD_STRANA, TMAVE_POZADIE, gradient_jasu, hystereza, kruh,
                                     maska_strany, na_lab, neparne, odhad_papiera, odstran_text, okolo,
                                     okrajovy_pas)

SILNY_K, SLABY_K = 4.0, 2.0
SILNY_MIN, SLABY_MIN = 4.5, 3.5
MIN_SYTOST = 4.0

OKRAJ_STRANY = 1 / 40
TLAC_TMAVE = 0.55
TLAC_OKRAJ = 2.5
MIN_KONTRAST = 7.0
ODSTUP_KONTRASTU = 0.15
TEXT_VNUTRI = 0.8
TEXT_OKOLO = 0.72

TEPLY_POSUN = 6.0
TEPLY_MIN = 2.0
OKNO_TLACE = 8
SKVRNA_NA_TLACI = 0.2
SVETLEJSIE_AKO_TLAC = 3.0
TMAVSIE_AKO_TLAC = 15.0
KUSOK_MIN = 4
KUSOK_KOMPAKTNOST = 0.5
KUSOK_OKOLIE = 0.5
KUSOK_OKOLIE_MIN = 15
MAKKY_OKRAJ = 6.0


@dataclass
class Strana:
    obrazok: np.ndarray
    maska: np.ndarray
    bez_textu: np.ndarray
    text: np.ndarray
    polomer: int
    lab: np.ndarray
    papier: np.ndarray
    tlac: np.ndarray


def rozober_stranu(obrazok, tlac):
    maska = maska_strany(obrazok)
    bez_textu, text, polomer, _ = odstran_text(obrazok, na_lab(obrazok), maska)
    lab = na_lab(bez_textu)
    tlac = tlac & (maska > 0)
    papier = odhad_papiera(bez_textu, (tlac * 255).astype(np.uint8), maska)
    text[lab[..., 0] < papier[..., 0] - TMAVE_POZADIE] = 0
    return Strana(obrazok, maska, bez_textu, text, polomer, lab, papier, tlac)


def navrhni_miesta(obrazok, tlac):
    strana = rozober_stranu(obrazok, tlac)
    tmave_povolene = (strana.maska > 0) & ~strana.tlac
    nalezy = rozdiel_od_papiera(strana.lab, strana.papier, strana.maska, tmave_povolene)
    return odfiltruj(nalezy, strana), strana


def najmensia_plocha(dlhsia):
    return max(12, int(dlhsia * dlhsia * 4e-6))


def rozdiel_od_papiera(lab, papier, maska_strany, tmave_povolene):
    """Miesta, ktoré sa farbou líšia od papiera."""
    dlhsia = max(maska_strany.shape)
    d = lab - papier
    de = np.sqrt((0.5 * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)
    de[(d[..., 0] > 2) & (d[..., 2] < 2) & (d[..., 1] < 2)] = 0
    sytost = cv2.GaussianBlur(np.hypot(d[..., 1], d[..., 2]), (0, 0), 1.2)
    de = cv2.GaussianBlur(de, (0, 0), 1.2)

    na_strane = maska_strany > 0
    hodnoty = de[na_strane]
    median = float(np.median(hodnoty)) if hodnoty.size else 0.0
    mad = 1.4826 * float(np.median(np.abs(hodnoty - median))) if hodnoty.size else 1.0
    silny = max(median + SILNY_K * mad, SILNY_MIN)
    slaby = max(median + SLABY_K * mad, SLABY_MIN)

    teple = cv2.GaussianBlur(np.maximum(d[..., 1], d[..., 2]), (0, 0), 1.2) > 1.0
    farebne = ((sytost >= MIN_SYTOST) & teple) | (tmave_povolene & (d[..., 0] < -SLABY_MIN))
    de[~na_strane | ~farebne] = 0

    maska = hystereza(de > slaby, de > silny).astype(np.uint8) * 255
    maska = cv2.morphologyEx(maska, cv2.MORPH_CLOSE, kruh(max(1, dlhsia / 600)))
    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    maska[:] = 0
    min_plocha = najmensia_plocha(dlhsia)
    cv2.drawContours(maska, [o for o in obrysy if cv2.contourArea(o) >= min_plocha], -1, 255, cv2.FILLED)
    return maska & maska_strany


def odfiltruj(maska, strana):
    """Vyradí nálezy, ktoré nie sú škvrny."""
    dlhsia = max(maska.shape)
    maska = odstran_tlac(maska, strana, najmensia_plocha(dlhsia))
    jas = na_lab(strana.obrazok)[..., 0]
    gradient = gradient_jasu(jas)
    ramik = strana.maska.copy()
    ramik[[0, -1], :] = 0
    ramik[:, [0, -1]] = 0
    od_okraja = cv2.distanceTransform((ramik > 0).astype(np.uint8), cv2.DIST_L2, 3)

    vysledok = np.zeros_like(maska)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(maska)
    for i in range(1, pocet):
        x0, y0, x1, y1 = box = okolo(udaje[i], 6, maska.shape)
        nalez = oblasti[y0:y1, x0:x1] == i

        if np.mean(od_okraja[y0:y1, x0:x1][nalez] < dlhsia * OKRAJ_STRANY) > 0.5:
            continue
        if v_hustom_texte(oblasti, i, udaje[i], strana) and not je_teply(nalez, box, strana):
            continue
        if tlaceny_prvok(nalez, jas[y0:y1, x0:x1], gradient[y0:y1, x0:x1]):
            continue
        if kontrast_s_okolim(nalez, box, strana) < MIN_KONTRAST:
            continue
        vysledok[y0:y1, x0:x1][nalez] = 255
    return vysledok


def v_hustom_texte(oblasti, i, udaje, strana):
    x0, y0, x1, y1 = okolo(udaje, 3 * strana.polomer + 2, oblasti.shape)
    nalez = (oblasti[y0:y1, x0:x1] == i).astype(np.uint8)
    text = strana.text[y0:y1, x0:x1] > 0
    okolie = (cv2.dilate(nalez, kruh(3 * strana.polomer)) > 0) & ~(cv2.dilate(nalez, kruh(2)) > 0)
    return text[nalez > 0].mean() > TEXT_VNUTRI or (okolie.any() and text[okolie].mean() > TEXT_OKOLO)


def teple(farba, referencia):
    posun = np.maximum(farba[..., 1] - referencia[..., 1], farba[..., 2] - referencia[..., 2]) >= TEPLY_POSUN
    return posun & (np.maximum(farba[..., 1], farba[..., 2]) > TEPLY_MIN)


def je_teply(nalez, box, strana):
    x0, y0, x1, y1 = box
    farba = np.median(strana.lab[y0:y1, x0:x1][nalez], axis=0)
    papier = np.median(strana.papier[y0:y1, x0:x1][nalez], axis=0)
    return bool(teple(farba[None, :], papier[None, :])[0])


def tlaceny_prvok(nalez, jas, gradient):
    """Rovnomerne tmavý útvar s ostrým okrajom."""
    okolie = (cv2.dilate(nalez.astype(np.uint8), kruh(3)) > 0) & ~nalez
    if not okolie.any():
        return False
    vnutri = jas[nalez]
    tmava_uroven = np.percentile(vnutri, 10)
    kontrast = float(np.median(jas[okolie]) - tmava_uroven)
    if kontrast <= 0:
        return False
    sirka_prechodu = kontrast / (np.percentile(gradient[okrajovy_pas(nalez)], 90) + 1e-3)
    tmavy_podiel = float(np.mean(vnutri < tmava_uroven + 0.25 * kontrast))
    return tmavy_podiel > TLAC_TMAVE and sirka_prechodu < TLAC_OKRAJ


def kontrast_s_okolim(nalez, box, strana):
    x0, y0, x1, y1 = box
    h, w = strana.maska.shape
    g = max(3, int(ODSTUP_KONTRASTU * np.sqrt(nalez.sum())))
    X0, Y0, X1, Y1 = max(0, x0 - g - 3), max(0, y0 - g - 3), min(w, x1 + g + 3), min(h, y1 + g + 3)
    velky = np.zeros((Y1 - Y0, X1 - X0), np.uint8)
    velky[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] = nalez
    pas = ((cv2.dilate(velky, kruh(g + 3)) > 0) & ~(cv2.dilate(velky, kruh(g)) > 0)
           & (strana.maska[Y0:Y1, X0:X1] > 0))
    if not pas.any():
        return 0.0
    lab = strana.lab[Y0:Y1, X0:X1]
    return float(np.linalg.norm(np.median(lab[velky > 0], axis=0) - np.median(lab[pas], axis=0)))


def odhad_tlace(bez_textu, tlac):
    """Očakávaná farba tlače v LAB pre každý pixel."""
    h, w = tlac.shape
    f = min(1.0, ODHAD_STRANA / max(h, w))
    velkost = (max(8, round(w * f)), max(8, round(h * f)))
    male = cv2.resize(bez_textu, velkost, interpolation=cv2.INTER_AREA)
    na_tlaci = cv2.resize(tlac.astype(np.uint8), velkost, interpolation=cv2.INTER_NEAREST) > 0
    if not na_tlaci.any():
        return na_lab(bez_textu)
    male = cv2.inpaint(male, (~na_tlaci).astype(np.uint8) * 255, 3, cv2.INPAINT_TELEA)
    pozadie = cv2.medianBlur(male, min(neparne(max(velkost) / OKNO_TLACE), 255))
    return na_lab(cv2.resize(pozadie, (w, h), interpolation=cv2.INTER_LINEAR))


def odlisne_od_tlace(farba, ocakavana):
    tepla = teple(farba, ocakavana) & (farba[..., 0] <= ocakavana[..., 0] + SVETLEJSIE_AKO_TLAC)
    return tepla | (farba[..., 0] < ocakavana[..., 0] - TMAVSIE_AKO_TLAC)


def odstran_tlac(maska, strana, min_plocha):
    """Z nálezov na tlači nechá len časti, ktoré sa od tlače líšia ako škvrna."""
    hladky = np.dstack([cv2.GaussianBlur(strana.lab[..., k], (0, 0), 2) for k in range(3)])
    ocakavana = odhad_tlace(strana.bez_textu, strana.tlac)
    jas_bez_textu = strana.lab[..., 0]

    vysledok = np.zeros_like(maska)
    pocet, oblasti, udaje, _ = cv2.connectedComponentsWithStats(maska)
    for i in range(1, pocet):
        x0, y0, x1, y1 = okolo(udaje[i], 6, maska.shape)
        nalez = oblasti[y0:y1, x0:x1] == i
        tlac = strana.tlac[y0:y1, x0:x1]
        na_tlaci = tlac & nalez
        if not na_tlaci.any():
            vysledok[y0:y1, x0:x1][nalez] = 255
            continue

        farba, cakana = hladky[y0:y1, x0:x1], ocakavana[y0:y1, x0:x1]
        odlisne = odlisne_od_tlace(farba, cakana)
        if na_tlaci.sum() > 0.5 * nalez.sum():
            if (nalez & odlisne).sum() < SKVRNA_NA_TLACI * nalez.sum():
                continue
            zvysok = nalez & odlisne
        else:
            zvysok = nalez & ~(na_tlaci & ~odlisne)

        pocet_kuskov, kusky, udaje_kuskov, _ = cv2.connectedComponentsWithStats(zvysok.astype(np.uint8))
        for j in range(1, pocet_kuskov):
            if udaje_kuskov[j, cv2.CC_STAT_AREA] < min_plocha:
                continue
            kusok = kusky == j
            if (kusok & tlac).sum() > 0.5 * kusok.sum() and not skvrna_na_tlaci(
                    kusok, nalez, farba, cakana, jas_bez_textu[y0:y1, x0:x1], min_plocha):
                continue
            vysledok[y0:y1, x0:x1][kusok] = 255
    return vysledok


def skvrna_na_tlaci(kusok, nalez, farba, ocakavana, jas, min_plocha):
    plocha = kusok.sum()
    if plocha < KUSOK_MIN * min_plocha:
        return False

    g = max(KUSOK_OKOLIE_MIN, int(KUSOK_OKOLIE * np.sqrt(plocha)))
    okolie = (cv2.dilate(np.pad(kusok.astype(np.uint8), g), kruh(g))[g:-g, g:-g] > 0) & nalez
    if plocha < SKVRNA_NA_TLACI * okolie.sum():
        return False

    obrysy, _ = cv2.findContours(kusok.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if plocha < KUSOK_KOMPAKTNOST * cv2.contourArea(cv2.convexHull(np.vstack(obrysy))):
        return False

    je_tepla = teple(np.median(farba[kusok], 0)[None], np.median(ocakavana[kusok], 0)[None])[0]
    return je_tepla or sirka_okraja(jas, kusok) >= MAKKY_OKRAJ


def sirka_okraja(jas, oblast):
    """Šírka prechodu na okraji oblasti v px."""
    oblast_u8 = oblast.astype(np.uint8)
    okolie = (cv2.dilate(oblast_u8, kruh(6)) > 0) & ~(cv2.dilate(oblast_u8, kruh(2)) > 0)
    if not okolie.any():
        return np.inf
    kontrast = float(np.median(jas[okolie]) - np.percentile(jas[oblast], 10))
    return kontrast / (np.percentile(gradient_jasu(jas)[okrajovy_pas(oblast)], 90) + 1e-3)
