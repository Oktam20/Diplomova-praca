"""Načítanie a ukladanie obrázkov (aj z ciest s diakritikou) a údaje z názvu fotky."""
from pathlib import Path

import cv2
import numpy as np

PRIPONY = (".jpg", ".jpeg", ".png")
VYSLEDKY = Path(__file__).parent / "vysledky"


def zoznam_fotiek(priecinok):
    return sorted(p for p in Path(priecinok).iterdir() if p.suffix.lower() in PRIPONY)


def najdi_fotku(priecinok, nazov):
    return next(p for p in zoznam_fotiek(priecinok) if p.stem == nazov)


def nacitaj_obrazok(cesta):
    return cv2.imdecode(np.fromfile(str(cesta), np.uint8), cv2.IMREAD_COLOR)


def nacitaj_masku(cesta):
    if not Path(cesta).is_file():
        return None
    return cv2.imdecode(np.fromfile(str(cesta), np.uint8), cv2.IMREAD_GRAYSCALE) > 127


def uloz_obrazok(cesta, obrazok):
    cv2.imencode(Path(cesta).suffix, obrazok)[1].tofile(str(cesta))


def udaje_z_nazvu(nazov):
    vzorka, _, druh = nazov.split("_")[:3]
    return vzorka, druh.split("-")[0].capitalize()
