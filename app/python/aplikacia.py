import base64
import json
import re
import zlib
from pathlib import Path

import cv2
import numpy as np

from dokumenty.dokument import spracuj_stranu, vyrezy
from klasifikacia.crty import crty_skvrny, gabor
from klasifikacia.kluc import urci
from skvrny.maska import najdi_masku

KLUC = json.loads((Path(__file__).parent / "klasifikacia" / "kluc.json").read_text(encoding="utf-8"))
CERVENA = (0, 0, 255)
BIELA = (255, 255, 255)
CIERNA = (0, 0, 0)
FARBY_ZON = [(244, 197, 158), (236, 167, 109), (229, 135, 57), (149, 79, 24)]
FARBA_LEMU = (42, 134, 232)
FARBA_OBRYSU = (59, 59, 208)
FARBA_VYNECHANEHO = (128, 128, 128)

podklady = {}


def uloz_podklad(skvrny):
    """Fotky a masky škvŕn na určenie druhu (posledné tri skeny); vráti číslo podkladu."""
    cislo = max(podklady, default=0) + 1
    podklady[cislo] = skvrny
    for stare in sorted(podklady)[:-3]:
        del podklady[stare]
    return cislo


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


def na_velkost(maska, obrazok):
    """Maska alebo mapa zväčšená bez vyhladzovania na veľkosť obrázka."""
    return cv2.resize(maska.astype(np.uint8), (obrazok.shape[1], obrazok.shape[0]), interpolation=cv2.INTER_NEAREST)


def vyrez_z_povodnej(povodny, pracovny, obdlznik):
    """Výrez z fotky v plnom rozlíšení a bez odstraňovania textu (na zobrazenie) pre obdĺžnik z pracovnej strany."""
    fx, fy = povodny.shape[1] / pracovny.shape[1], povodny.shape[0] / pracovny.shape[0]
    x0, y0, x1, y1 = obdlznik
    return povodny[round(y0 * fy):round(y1 * fy), round(x0 * fx):round(x1 * fx)]


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
        "maska": na_png(maska),
        "vyrez": na_png(len_pod_maskou(obr, maska)),
        "podklad": uloz_podklad([("Škvrna", obr, maska)]),
    }


def prehlad(obrazok, maska, obdlzniky):
    """Strana s červeným obrysom škvŕn a číslom každej škvrny (rovnaké poradie ako v zozname škvŕn)."""
    vysledok = obrazok.copy()
    hrubka = max(2, round(max(obrazok.shape[:2]) / 500))
    obrysy, _ = cv2.findContours(maska, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vysledok, obrysy, -1, CERVENA, hrubka)
    mierka = hrubka / 3
    for cislo, (x0, y0, x1, y1) in enumerate(obdlzniky, 1):
        (_, vyska), _ = cv2.getTextSize(str(cislo), cv2.FONT_HERSHEY_SIMPLEX, mierka, hrubka)
        y = y0 - hrubka if y0 - vyska - 3 * hrubka > 0 else y1 + vyska + 3 * hrubka
        for farba, hrubka_textu in ((CIERNA, 3 * hrubka), (BIELA, hrubka)):
            cv2.putText(vysledok, str(cislo), (x0 + hrubka, y), cv2.FONT_HERSHEY_SIMPLEX, mierka, farba, hrubka_textu)
    return vysledok


def dokument(png_base64):
    """Režim Dokument: škvrny na celej strane, ich výrezy a obrázky na zobrazenie.
    """
    povodny, profil = nacitaj(png_base64)
    maska, navrh, strana = spracuj_stranu(povodny)
    skvrny = list(vyrezy(strana, maska))
    nasiel = bool(maska.any())
    podklad = [(f"Škvrna {cislo}", vyrez, maska_vyrezu, vyrez_z_povodnej(povodny, strana.obrazok, box))
               for cislo, (_, box, vyrez, maska_vyrezu) in enumerate(skvrny, 1)]
    return {
        "sirka": strana.obrazok.shape[1],
        "vyska": strana.obrazok.shape[0],
        "profil": profil,
        "miest": cv2.connectedComponents(navrh)[0] - 1,
        "nasiel": nasiel,
        "prehlad": na_png(prehlad(strana.obrazok, maska, [box for _, box, _, _ in skvrny])),
        "maska": na_png(maska),
        "vyrez": na_png(len_pod_maskou(povodny, na_velkost(maska, povodny))),
        "podklad": uloz_podklad(podklad) if nasiel else None,
    }


def obrazok_crt(obr, maska, podklady_crt, max_strana=720):
    """Obrázok čŕt: zóny škvrny od okraja k stredu, lem, vynechané okolie a obrys (PNG base64).
    """
    vnutri = na_velkost(maska > 0, obr) > 0
    zony = na_velkost(podklady_crt["zony"] + 1, obr).astype(np.int16) - 1
    lem = na_velkost(podklady_crt["lem"], obr) > 0
    papier = na_velkost(podklady_crt["papier"], obr) > 0
    ys, xs = np.nonzero(vnutri | lem)
    okraj = round(0.35 * max(np.ptp(xs), np.ptp(ys))) + 8
    h, w = vnutri.shape
    y0, y1 = max(0, ys.min() - okraj), min(h, ys.max() + okraj + 1)
    x0, x1 = max(0, xs.min() - okraj), min(w, xs.max() + okraj + 1)

    vysledok = obr.astype(np.float32)

    def zmiesaj(vyber, farba):
        vysledok[vyber] = 0.5 * vysledok[vyber] + 0.5 * np.array(farba)

    for z, farba in enumerate(FARBY_ZON):
        zmiesaj(vnutri & (zony == z), farba)
    zmiesaj(vnutri & (zony < 0), FARBA_VYNECHANEHO)
    zmiesaj(~vnutri & lem, FARBA_LEMU)
    zmiesaj(~vnutri & ~lem & ~papier, FARBA_VYNECHANEHO)
    s_okrajom = np.pad(vnutri, 1).astype(np.uint8)
    obrys = vnutri & ~(cv2.erode(s_okrajom, cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3)))[1:-1, 1:-1] > 0)
    vysledok[obrys] = FARBA_OBRYSU

    vyrez = np.round(vysledok[y0:y1, x0:x1]).astype(np.uint8)
    f = min(1.0, max_strana / max(vyrez.shape[:2]))
    if f < 1:
        vyrez = cv2.resize(vyrez, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return na_png(vyrez)


def nahlad(obr, maska, max_strana=160):
    """Malý výrez okolo škvrny bez značiek (PNG base64) na zoznam škvŕn."""
    maska = na_velkost(maska > 0, obr)
    ys, xs = np.nonzero(maska)
    okraj = round(0.15 * max(np.ptp(xs), np.ptp(ys))) + 4
    h, w = maska.shape
    vyrez = obr[max(0, ys.min() - okraj):min(h, ys.max() + okraj + 1), max(0, xs.min() - okraj):min(w, xs.max() + okraj + 1)]
    f = min(1.0, max_strana / max(vyrez.shape[:2]))
    if f < 1:
        vyrez = cv2.resize(vyrez, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return na_png(vyrez)


def urci_skvrnu(nazov, obr, maska, na_zobrazenie=None):
    """Druh škvrny z obrázka a masky; obrázok čŕt a náhľad z na_zobrazenie (napr. ostrejší výrez), ak je zadaný."""
    vysledok = crty_skvrny(obr, maska, s_texturou=False)
    if vysledok is None:
        return None
    crty, podklady_crt = vysledok
    urcenie = urci(crty, KLUC, lambda: gabor(*podklady_crt["vyrez"]))
    druhy = KLUC["druhy"]
    urcenie["druhy"] = [druhy[d] for d in urcenie["druhy"]]
    urcenie["druh"] = druhy.get(urcenie["druh"])
    zobrazenie = obr if na_zobrazenie is None else na_zobrazenie
    try:
        obrazok_skvrny = obrazok_crt(zobrazenie, maska, podklady_crt)
    except ValueError:
        obrazok_skvrny = None
    return {"nazov": nazov, "urcenie": urcenie, "obrazok": obrazok_skvrny, "nahlad": nahlad(zobrazenie, maska)}


def urci_podklad(cislo):
    """Určenie druhu každej škvrny zo skenu (podklad z funkcie obrazok alebo dokument)."""
    if cislo not in podklady:
        raise ValueError("Podklad pre klasifikáciu už nie je k dispozícii – naskenuj vzorku znova.")
    skvrny = [urci_skvrnu(*skvrna) for skvrna in podklady[cislo]]
    return {"skvrny": [s for s in skvrny if s], "uspesnost": KLUC.get("uspesnost", {}).get("test")}
