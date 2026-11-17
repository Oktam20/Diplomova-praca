"""Prepojenie aplikácie s analýzami: fotka z mobilu -> maska, výrezy a obrázky na zobrazenie.

Beží v mobile v Pyodide a volá rovnaké funkcie ako analýzy (skvrny.maska, dokumenty.dokument).
"""
import base64
import re
import zlib

import cv2
import numpy as np

from dokumenty.dokument import spracuj_stranu, vyrezy
from skvrny.maska import najdi_masku

ZLTA = (0, 220, 255)
CERVENA = (0, 0, 255)


def farebny_profil(png):
    """Farebný profil PNG z častí sRGB, cICP alebo iCCP („sRGB“, „Display P3“, iný názov alebo None)."""
    pozicia = 8
    while pozicia + 8 <= len(png):
        dlzka = int.from_bytes(png[pozicia:pozicia + 4], "big")
        typ = png[pozicia + 4:pozicia + 8].decode("latin-1")
        data = png[pozicia + 8:pozicia + 8 + dlzka]
        if typ in ("IDAT", "IEND"):
            return None
        if typ == "sRGB":
            return "sRGB"
        if typ == "cICP":
            return {12: "Display P3", 1: "sRGB"}.get(data[0], f"cICP {data[0]}")
        if typ == "iCCP":
            nazov, _, zvysok = data.partition(b"\0")
            text = nazov.decode("latin-1")
            try:
                text += " " + zlib.decompress(zvysok[1:]).decode("latin-1")
            except zlib.error:
                pass
            if "P3" in text:
                return "Display P3"
            if re.search("srgb", text, re.IGNORECASE):
                return "sRGB"
            return nazov.decode("latin-1") or "ICC profil"
        pozicia += 12 + dlzka
    return None


def z_display_p3(obrazok):
    """Display P3 -> sRGB v lineárnom RGB (farby mimo sRGB sa orežú), lebo trénovacie fotky sú v sRGB."""
    x = obrazok[..., ::-1] / 255.0
    linearne = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    matica = np.array([[1.2249401, -0.2249404, 0.0],
                       [-0.0420569, 1.0420571, 0.0],
                       [-0.0196376, -0.0786361, 1.0982735]])
    srgb = np.clip(linearne @ matica.T, 0, 1)
    v = np.where(srgb <= 0.0031308, 12.92 * srgb, 1.055 * srgb ** (1 / 2.4) - 0.055)
    return np.ascontiguousarray(np.round(np.clip(v, 0, 1) * 255).astype(np.uint8)[..., ::-1])


def nacitaj(png_base64):
    png = base64.b64decode(png_base64)
    profil = farebny_profil(png)
    obrazok = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
    return (z_display_p3(obrazok) if profil == "Display P3" else obrazok), profil


def na_png(obrazok):
    return base64.b64encode(cv2.imencode(".png", obrazok)[1].tobytes()).decode()


def len_pod_maskou(obrazok, maska):
    return obrazok * (maska[..., None] > 0)


def obrazok(png_base64):
    """Režim Obrázok: maska škvrny na detailnom zábere."""
    obr, profil = nacitaj(png_base64)
    try:
        maska, _ = najdi_masku(obr)
    except ValueError:
        maska = np.zeros(obr.shape[:2], np.uint8)
    return {
        "sirka": obr.shape[1],
        "vyska": obr.shape[0],
        "profil": profil,
        "obrazok": obr,
        "maska": maska,
        "maska_png": na_png(maska),
        "vyrez_png": na_png(len_pod_maskou(obr, maska)),
    }


def prehlad(obrazok, maska, obdlzniky):
    """Strana s červeným obrysom škvŕn a žltými očíslovanými rámikmi výrezov."""
    vysledok = obrazok.copy()
    hrubka = max(2, round(max(obrazok.shape[:2]) / 500))
    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vysledok, obrysy, -1, CERVENA, hrubka)
    mierka = hrubka / 3
    for cislo, (x0, y0, x1, y1) in enumerate(obdlzniky, 1):
        cv2.rectangle(vysledok, (x0, y0), (x1 - 1, y1 - 1), ZLTA, hrubka)
        (sirka, vyska), _ = cv2.getTextSize(str(cislo), cv2.FONT_HERSHEY_SIMPLEX, mierka, hrubka)
        y = y0 - hrubka if y0 - vyska - 3 * hrubka > 0 else y1 + vyska + 3 * hrubka
        cv2.rectangle(vysledok, (x0, y - vyska - 2 * hrubka), (x0 + sirka + 2 * hrubka, y + hrubka), ZLTA, -1)
        cv2.putText(vysledok, str(cislo), (x0 + hrubka, y), cv2.FONT_HERSHEY_SIMPLEX, mierka, (0, 0, 0), hrubka)
    return vysledok


def dokument(png_base64):
    """Režim Dokument: škvrny na celej strane, ich výrezy a obrázky na zobrazenie."""
    povodny, profil = nacitaj(png_base64)
    maska, navrh, strana = spracuj_stranu(povodny)
    skvrny = list(vyrezy(strana, maska))
    return {
        "sirka": strana.obrazok.shape[1],
        "vyska": strana.obrazok.shape[0],
        "profil": profil,
        "miest": cv2.connectedComponents(navrh)[0] - 1,
        "nasiel": bool(maska.any()),
        "vyrezy": [{"obrazok": vyrez, "maska": maska_vyrezu} for _, _, vyrez, maska_vyrezu in skvrny],
        "prehlad_png": na_png(prehlad(strana.obrazok, maska, [box for _, box, _, _ in skvrny])),
        "maska_png": na_png(maska),
        "vyrez_png": na_png(len_pod_maskou(strana.bez_textu, maska)),
    }
