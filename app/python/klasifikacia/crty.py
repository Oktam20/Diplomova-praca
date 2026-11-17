"""Črty škvrny pre určovací kľúč: farba voči papieru, zóny od okraja k stredu, lem a textúra.

Farba papiera sa odhaduje pre každý pixel z okolia škvrny, preto črty nezávisia od jasu ani
farebného nádychu fotky. Všetky farebné črty sú rozdiely voči papieru v CIELAB (dL, da, db).
"""
import math

import cv2
import numpy as np
from skimage.feature import local_binary_pattern

from skvrny.morfologia import rozsir_masku, zuz_masku

MIN_PLOCHA = 200
STRANA_ODHADU = 256
ZON = 4
PRIEMER_VYREZU = 256
LAMBDA_GABOR = 32
SMERY_GABOR = (0, 45, 90, 135)
KANALY = ("dL", "da", "db")


def kruh(polomer):
    r = max(1, int(round(polomer)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def odhad_papiera(lab, maska, polomer):
    """Farba papiera (L, a, b) pre každý pixel len z pixelov papiera a maska týchto pixelov.

    Papier sú pixely v odstupe 30 % polomeru od škvrny (lem sa vynechá). Pod škvrnou sa farba
    dopočíta normalizovanou konvolúciou blur(lab · váha) / blur(váha), takže zachytí aj tieň
    alebo plynulú zmenu svetla cez fotku.
    """
    h, w = maska.shape
    papier = ~rozsir_masku(maska, kruh(max(5.0, 0.3 * polomer)))
    if papier.mean() < 0.05:
        papier = maska == 0
    if papier.sum() < 50:
        stred = np.median(lab.reshape(-1, 3), axis=0)
        return np.broadcast_to(stred, lab.shape).astype(np.float32), papier

    stred = np.median(lab[papier], axis=0)
    f = min(1.0, STRANA_ODHADU / max(h, w))
    velkost = (max(8, int(w * f)), max(8, int(h * f)))
    male = cv2.resize(lab, velkost, interpolation=cv2.INTER_AREA) if f < 1.0 else lab
    vaha = papier.astype(np.float32)
    if f < 1.0:
        vaha = cv2.resize(vaha, velkost, interpolation=cv2.INTER_AREA)

    sigma = float(np.clip(polomer * f, 3.0, 0.5 * min(velkost)))
    menovatel = cv2.GaussianBlur(vaha, (0, 0), sigma)
    pozadie = np.dstack([cv2.GaussianBlur(male[:, :, k] * vaha, (0, 0), sigma) for k in range(3)])
    ok = menovatel > 1e-3
    pozadie[ok] /= menovatel[ok, None]
    pozadie[~ok] = stred
    if f < 1.0:
        pozadie = cv2.resize(pozadie, (w, h), interpolation=cv2.INTER_LINEAR)
    return pozadie.astype(np.float32), papier


def statistiky(predpona, hodnoty):
    p10, p50, p90 = np.percentile(hodnoty, [10, 50, 90])
    return {f"{predpona}_mean": float(hodnoty.mean()), f"{predpona}_std": float(hodnoty.std()),
            f"{predpona}_p10": float(p10), f"{predpona}_p50": float(p50), f"{predpona}_p90": float(p90)}


def farba(rel, vnutri):
    crty = {}
    for k, nazov in enumerate(KANALY):
        crty.update(statistiky(f"farba_{nazov}", rel[..., k][vnutri]))
    a, b = crty["farba_da_mean"], crty["farba_db_mean"]
    crty["farba_chroma"] = float(np.hypot(a, b))
    crty["farba_odtien_deg"] = float(np.degrees(np.arctan2(b, a)))
    return crty


def zony(rel, maska):
    """Priemerná farba v 4 zónach podľa vzdialenosti od okraja: zóna 0 = okraj, zóna 3 = stred."""
    vzdialenost = cv2.distanceTransform(maska, cv2.DIST_L2, 5)
    najdalej = float(vzdialenost.max())
    cisla = np.full(maska.shape, -1, np.int8)
    crty, priemery = {}, []
    for z in range(ZON):
        od, po = z / ZON * najdalej, (z + 1) / ZON * najdalej
        vyber = (vzdialenost > od) & (vzdialenost <= po) if z else (vzdialenost > 0) & (vzdialenost <= po)
        cisla[vyber] = z
        priemer = rel[vyber].mean(axis=0) if vyber.any() else np.full(3, np.nan)
        priemery.append(priemer)
        for k, nazov in enumerate(KANALY):
            crty[f"zona{z}_{nazov}"] = float(priemer[k])
    for k, nazov in enumerate(KANALY):
        crty[f"zona_stred_minus_okraj_{nazov}"] = float(priemery[-1][k] - priemery[0][k])
    return crty, cisla


def lem(rel, maska, polomer):
    """Priemerná farba úzkeho pásu tesne za okrajom škvrny."""
    pas = rozsir_masku(maska, kruh(max(3.0, 0.15 * polomer))) & (maska == 0)
    priemer = rel[pas].mean(axis=0) if pas.any() else np.full(3, np.nan)
    return {f"halo_{nazov}": float(priemer[k]) for k, nazov in enumerate(KANALY)}, pas


def normovany_vyrez(jas, maska, polomer):
    """Výrez okolo škvrny preškálovaný tak, aby mala ekvivalentný priemer PRIEMER_VYREZU px."""
    ys, xs = np.nonzero(maska)
    okraj = int(max(5, 0.3 * polomer))
    y0, y1 = max(0, ys.min() - okraj), min(maska.shape[0], ys.max() + okraj + 1)
    x0, x1 = max(0, xs.min() - okraj), min(maska.shape[1], xs.max() + okraj + 1)
    s = PRIEMER_VYREZU / (2.0 * polomer)
    velkost = (max(8, int(round((x1 - x0) * s))), max(8, int(round((y1 - y0) * s))))
    vyrez_jasu = cv2.resize(jas[y0:y1, x0:x1], velkost, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
    vyrez_masky = cv2.resize(maska[y0:y1, x0:x1], velkost, interpolation=cv2.INTER_NEAREST)
    return vyrez_jasu, vyrez_masky


def lbp(vyrez_jasu, vyrez_masky, P=8, R=1):
    """Histogram uniformných LBP jasu vo vnútri škvrny (zrnitosť)."""
    vnutri = zuz_masku(vyrez_masky, kruh(3))
    if vnutri.sum() < 50:
        return {f"lbp_P{P}R{R}_{k}": np.nan for k in range(P + 2)}
    u8 = np.clip((vyrez_jasu + 100.0) * 2.0, 0, 255).astype(np.uint8)
    kody = local_binary_pattern(u8, P, R, method="uniform")[vnutri].astype(np.int64)
    hist = np.bincount(kody, minlength=P + 2)[:P + 2].astype(np.float64)
    hist /= max(1.0, hist.sum())
    return {f"lbp_P{P}R{R}_{k}": float(hist[k]) for k in range(P + 2)}


def gabor(vyrez_jasu, vyrez_masky, lam=LAMBDA_GABOR):
    """Sila hrubej textúry: priemerná veľkosť komplexnej Gaborovej odozvy cez 4 smery."""
    oblast = zuz_masku(vyrez_masky, kruh(3))
    if oblast.sum() < 50:
        return np.nan
    obr = vyrez_jasu.astype(np.float32).copy()
    obr[~oblast] = float(vyrez_jasu[oblast].mean())
    sigma = 0.56 * lam
    k = int(6 * sigma) | 1
    stred = zuz_masku(oblast, kruh(min(k // 4, 10)))
    vyber = stred if stred.sum() >= 50 else oblast
    odozvy = []
    for uhol in SMERY_GABOR:
        theta = np.deg2rad(uhol)
        realna = cv2.getGaborKernel((k, k), sigma, theta, lam, 0.5, 0)
        imaginarna = cv2.getGaborKernel((k, k), sigma, theta, lam, 0.5, np.pi / 2)
        realna -= realna.mean()
        re = cv2.filter2D(obr, cv2.CV_32F, realna)
        im = cv2.filter2D(obr, cv2.CV_32F, imaginarna)
        odozvy.append(float(np.sqrt(re * re + im * im)[vyber].mean()))
    return float(np.mean(odozvy))


def crty_skvrny(obrazok, maska, s_texturou=True):
    """Črty škvrny a podklady pre obrázok čŕt (zóny, lem, papier, výrez); None pri malej maske."""
    maska = (maska > 0).astype(np.uint8) * 255
    plocha = cv2.countNonZero(maska)
    if plocha < MIN_PLOCHA:
        return None
    polomer = math.sqrt(plocha / math.pi)
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    pozadie, papier = odhad_papiera(lab, maska, polomer)
    rel = lab - pozadie

    crty = farba(rel, maska > 0)
    crty_zon, cisla_zon = zony(rel, maska)
    crty_lemu, pas = lem(rel, maska, polomer)
    vyrez = normovany_vyrez(rel[..., 0], maska, polomer)
    crty.update(crty_zon)
    crty.update(crty_lemu)
    crty.update(lbp(*vyrez))
    if s_texturou:
        crty[f"gabor_l{LAMBDA_GABOR}_odozva"] = gabor(*vyrez)
    return crty, {"zony": cisla_zon, "lem": pas, "papier": papier, "vyrez": vyrez}
