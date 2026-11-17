"""Morfológia s eliptickým jadrom – rovnaký výsledok ako cv2.dilate, cv2.erode a cv2.morphologyEx,
ale v Pyodide (WebAssembly bez SIMD) niekoľkonásobne rýchlejšia.

Jadro sa rozloží na riadky: riadok dy má polovičnú šírku s. Obrázok sa postupne rozšíri do strán
(o 1, 2, ... px) a každý riadok jadra sa pridá posunutý o dy. Binárne masky sa pritom zbalia
po 64 pixelov do jedného čísla (ako v pôvodnom TypeScripte aplikácie).
"""
import numpy as np


def polsirky_jadra(jadro):
    return jadro.sum(axis=1).astype(int) // 2


def krajna_hodnota(dtype, maximum):
    info = np.iinfo(dtype) if np.issubdtype(dtype, np.integer) else np.finfo(dtype)
    return info.min if maximum else info.max


def filter_jadrom(obrazok, jadro, maximum):
    """Maximum (dilatácia) alebo minimum (erózia) sivého obrázka cez okolie dané jadrom."""
    funkcia = np.maximum if maximum else np.minimum
    polsirky = polsirky_jadra(jadro)
    r = len(polsirky) // 2
    vyska = obrazok.shape[0]
    vodorovne = obrazok.copy()
    vysledok = np.full_like(obrazok, krajna_hodnota(obrazok.dtype, maximum))
    for s in range(polsirky.max() + 1):
        if s > 0:
            predtym = vodorovne.copy()
            funkcia(vodorovne[:, 1:], predtym[:, :-1], out=vodorovne[:, 1:])
            funkcia(vodorovne[:, :-1], predtym[:, 1:], out=vodorovne[:, :-1])
        for i in np.flatnonzero(polsirky == s):
            dy = i - r
            y0, y1 = max(0, -dy), min(vyska, vyska - dy)
            funkcia(vysledok[y0:y1], vodorovne[y0 + dy:y1 + dy], out=vysledok[y0:y1])
    return vysledok


def uzavri(obrazok, jadro):
    """cv2.morphologyEx(obrazok, MORPH_CLOSE, jadro) pre sivý alebo farebný obrázok."""
    return filter_jadrom(filter_jadrom(obrazok, jadro, True), jadro, False)


def zabal(maska):
    """Maska (nenulové = 1) zbalená po 64 pixelov: pixel x je bit x % 64 čísla x // 64 v riadku."""
    h, w = maska.shape
    bajty = np.zeros((h, (w + 63) // 64 * 8), np.uint8)
    bajty[:, :(w + 7) // 8] = np.packbits(maska != 0, axis=1, bitorder="little")
    return bajty.view(np.uint64)


def rozbal(bity, sirka):
    return np.unpackbits(bity.view(np.uint8), axis=1, count=sirka, bitorder="little").view(bool)


def platne_bity(sirka):
    """Bity riadku, ktoré patria do obrázka (za šírkou sú nuly)."""
    platne = np.full((sirka + 63) // 64, np.iinfo(np.uint64).max, np.uint64)
    if sirka % 64:
        platne[-1] = (1 << (sirka % 64)) - 1
    return platne


def posun(bity, s):
    """Pixely posunuté o s doprava (záporné s doľava), z okraja prichádzajú nuly."""
    q, b = divmod(abs(s), 64)
    n = bity.shape[1]
    vysledok = np.zeros_like(bity)
    if q >= n:
        return vysledok
    if s > 0:
        vysledok[:, q:] = bity[:, :n - q] << np.uint64(b)
        if b and n - q > 1:
            vysledok[:, q + 1:] |= bity[:, :n - q - 1] >> np.uint64(64 - b)
    else:
        vysledok[:, :n - q] = bity[:, q:] >> np.uint64(b)
        if b and n - q > 1:
            vysledok[:, :n - q - 1] |= bity[:, q + 1:] << np.uint64(64 - b)
    return vysledok


def rozsir_bity(bity, jadro, platne):
    polsirky = polsirky_jadra(jadro)
    r = len(polsirky) // 2
    vyska = bity.shape[0]
    vodorovne = bity.copy()
    vysledok = np.zeros_like(bity)
    for s in range(polsirky.max() + 1):
        if s > 0:
            vodorovne |= posun(bity, s) | posun(bity, -s)
            vodorovne &= platne
        for i in np.flatnonzero(polsirky == s):
            dy = i - r
            y0, y1 = max(0, -dy), min(vyska, vyska - dy)
            vysledok[y0:y1] |= vodorovne[y0 + dy:y1 + dy]
    return vysledok


def zuz_bity(bity, jadro, platne):
    """Erózia ako dilatácia doplnku (mimo obrázka sú jednotky)."""
    return ~rozsir_bity(~bity & platne, jadro, platne) & platne


def morfologia_masky(maska, jadro, *operacie):
    """Postupnosť operácií ("rozsir", "zuz") na maske; výsledok ako cv2.dilate / cv2.erode > 0."""
    sirka = maska.shape[1]
    platne = platne_bity(sirka)
    bity = zabal(maska)
    for operacia in operacie:
        bity = (rozsir_bity if operacia == "rozsir" else zuz_bity)(bity, jadro, platne)
    return rozbal(bity, sirka)


def rozsir_masku(maska, jadro):
    """cv2.dilate(maska, jadro) > 0."""
    return morfologia_masky(maska, jadro, "rozsir")


def zuz_masku(maska, jadro):
    """cv2.erode(maska, jadro) > 0 (mimo obrázka sú jednotky)."""
    return morfologia_masky(maska, jadro, "zuz")


def uzavri_masku(maska, jadro):
    """cv2.morphologyEx(maska, MORPH_CLOSE, jadro) > 0."""
    return morfologia_masky(maska, jadro, "rozsir", "zuz")


def uzavri_a_otvor_masku(maska, jadro):
    """Uzavretie a potom otvorenie (MORPH_CLOSE, MORPH_OPEN) > 0."""
    return morfologia_masky(maska, jadro, "rozsir", "zuz", "zuz", "rozsir")
