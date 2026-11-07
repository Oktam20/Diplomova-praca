"""Syntetický test: skutočné škvrny vložené na strany dokumentov.

    python -m dokumenty.test_dokumenty --strany <strany> --fotky <fotky škvŕn>
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from dokumenty.dokument import PRACOVNA_STRANA, najdi_skvrny, zluc_blizke
from dokumenty.dokument_tlac import kruh, mapa_tlace, maska_strany, na_lab
from skvrny.subory import nacitaj_masku, nacitaj_obrazok, udaje_z_nazvu, uloz_obrazok, zoznam_fotiek

SKVRN_NA_STRANU = 4
KOL = 3
SEED = 7
NAJDENA = 0.5
VIDITELNA_DE = 6.0
TOLERANCIA_LEMU = 0.15


def skvrny_podla_druhu(fotky):
    druhy = {}
    for cesta in zoznam_fotiek(fotky):
        druhy.setdefault(udaje_z_nazvu(cesta.stem)[1], []).append(cesta)
    return druhy


def priprav_skvrnu(cesta_fotky, cesta_masky, velkost, rng):
    obrazok = nacitaj_obrazok(cesta_fotky)
    maska = nacitaj_masku(cesta_masky)
    daleko = ~cv2.dilate(maska.astype(np.uint8), np.ones((25, 25), np.uint8)).astype(bool)
    papier = np.median(obrazok[daleko], axis=0).astype(np.float32)

    ys, xs = np.nonzero(maska)
    cy, cx = ys.mean(), xs.mean()
    r = 0.75 * max(np.ptp(ys), np.ptp(xs)) + 5
    y0, y1 = int(max(0, cy - r)), int(min(obrazok.shape[0], cy + r))
    x0, x1 = int(max(0, cx - r)), int(min(obrazok.shape[1], cx + r))
    pomer = np.clip(obrazok[y0:y1, x0:x1].astype(np.float32) / np.maximum(papier, 1), 0, 1)
    maska = maska[y0:y1, x0:x1].astype(np.uint8)

    f = velkost / max(pomer.shape[:2])
    pomer = cv2.resize(pomer, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    maska = cv2.resize(maska, pomer.shape[1::-1], interpolation=cv2.INTER_NEAREST)
    h, w = pomer.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    prechod = np.clip(1.4 - np.hypot((yy - h / 2) / (h / 2), (xx - w / 2) / (w / 2)), 0, 1)[..., None]
    if rng.random() < 0.5:
        pomer, maska = pomer[:, ::-1], maska[:, ::-1]
    return 1 - (1 - pomer) * prechod, maska


def vytvor_stranu(cesta_strany, skvrny, rng):
    strana = nacitaj_obrazok(cesta_strany)
    f = min(1.0, PRACOVNA_STRANA / max(strana.shape[:2]))
    if f < 1:
        strana = cv2.resize(strana, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    na_strane = maska_strany(strana) > 0
    H, W = strana.shape[:2]
    vysledok = strana.astype(np.float32)
    obsadene = np.zeros((H, W), bool)
    vlozene = []

    for cesta_fotky, cesta_masky in skvrny:
        velkost = int(rng.uniform(0.10, 0.22) * min(H, W))
        pomer, maska = priprav_skvrnu(cesta_fotky, cesta_masky, velkost, rng)
        h, w = pomer.shape[:2]
        for _ in range(200):
            y0, x0 = int(rng.integers(0, H - h)), int(rng.integers(0, W - w))
            if na_strane[y0:y0 + h, x0:x0 + w].mean() > 0.97 and not obsadene[y0:y0 + h, x0:x0 + w].any():
                break
        else:
            continue
        vysledok[y0:y0 + h, x0:x0 + w] *= pomer
        obsadene[y0:y0 + h, x0:x0 + w] = True
        pravda = np.zeros((H, W), bool)
        pravda[y0:y0 + h, x0:x0 + w] = maska > 0
        vlozene.append((udaje_z_nazvu(cesta_fotky.stem)[1], pravda))

    return strana, np.clip(vysledok, 0, 255).astype(np.uint8), vlozene


def porovnaj_skvrnu(pravda, maska, povodna, synteticka, tlac):
    ys, xs = np.nonzero(pravda)
    velkost = max(np.ptp(ys), np.ptp(xs))
    p = int(0.6 * velkost) + 5
    y0, y1, x0, x1 = max(0, ys.min() - p), ys.max() + p, max(0, xs.min() - p), xs.max() + p
    t, m = pravda[y0:y1, x0:x1], maska[y0:y1, x0:x1]

    lem = max(2, int(TOLERANCIA_LEMU * velkost))
    t_s_lemom = cv2.dilate(t.astype(np.uint8), kruh(lem)) > 0
    m_pri_skvrne = m & (cv2.dilate(t.astype(np.uint8), kruh(4 * lem)) > 0)
    zmena = na_lab(synteticka[y0:y1, x0:x1]) - na_lab(povodna[y0:y1, x0:x1])
    return {
        "pokrytie": (t & m).sum() / t.sum(),
        "iou": (t & m).sum() / max((t | m).sum(), 1),
        "presnost": (m_pri_skvrne & t_s_lemom).sum() / max(m_pri_skvrne.sum(), 1),
        "iou_s_lemom": (t & m).sum() / max(t.sum() + (m_pri_skvrne & ~t_s_lemom).sum(), 1),
        "viditelnost": float(np.median(np.linalg.norm(zmena, axis=2)[t])),
        "na_tlaci": float(tlac[y0:y1, x0:x1][t].mean()),
    }


def uloz_nahlad(synteticka, vlozene, maska, cesta):
    nahlad = synteticka.copy()
    for _, pravda in vlozene:
        obrysy, _ = cv2.findContours(pravda.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(nahlad, obrysy, -1, (0, 200, 0), 2)
    obrysy, _ = cv2.findContours(maska.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(nahlad, obrysy, -1, (0, 0, 255), 2)
    uloz_obrazok(cesta, nahlad)


def otestuj(strany, fotky, masky, vystup):
    rng = np.random.default_rng(SEED)
    skvrny = skvrny_podla_druhu(fotky)
    druhy = sorted(skvrny)
    mapy_tlace = {}
    riadky, falosne, na_povodnych = [], 0, 0
    poradie = 0

    for kolo in range(KOL):
        for cesta_strany in strany:
            vybrane = [druhy[(poradie + i) % len(druhy)] for i in range(SKVRN_NA_STRANU)]
            poradie += SKVRN_NA_STRANU
            cesty = [skvrny[d][int(rng.integers(len(skvrny[d])))] for d in vybrane]
            povodna, synteticka, vlozene = vytvor_stranu(
                cesta_strany, [(c, masky / f"{c.stem}.png") for c in cesty], rng)

            if cesta_strany not in mapy_tlace:
                mapy_tlace[cesta_strany] = mapa_tlace(nacitaj_obrazok(cesta_strany), synteticka.shape[:2])
            tlac = mapy_tlace[cesta_strany]
            maska_povodnej = najdi_skvrny(povodna, tlac)[0] > 0
            maska = najdi_skvrny(synteticka, tlac)[0] > 0

            pri_vlozenych = np.zeros_like(maska)
            for druh, pravda in vlozene:
                pri_vlozenych |= cv2.dilate(pravda.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
                riadky.append({"strana": cesta_strany.name, "kolo": kolo, "druh": druh,
                               **porovnaj_skvrnu(pravda, maska, povodna, synteticka, tlac)})

            skupiny, udaje = zluc_blizke(maska.astype(np.uint8) * 255)
            for i in range(1, len(udaje)):
                cast = skupiny == i
                if not (cast & pri_vlozenych).any() and not (cast & maska_povodnej).any():
                    falosne += 1
            if kolo == 0:
                na_povodnych += len(zluc_blizke(maska_povodnej.astype(np.uint8) * 255)[1]) - 1

            uloz_nahlad(synteticka, vlozene, maska, vystup / f"{cesta_strany.stem}_k{kolo}.jpg")
            print(f"{cesta_strany.name}, kolo {kolo}: vložených {len(vlozene)}")

    return pd.DataFrame(riadky), falosne, na_povodnych


def suhrn(tabulka, falosne, na_povodnych):
    najdene = tabulka.pokrytie >= NAJDENA
    viditelne = tabulka.viditelnost >= VIDITELNA_DE
    na_tlaci = tabulka.na_tlaci > 0.5
    riadky = [
        f"Všetky ({len(tabulka)}): nájdené {najdene.mean():.0%}, IoU s lemom {tabulka.iou_s_lemom.mean():.2f}",
        f"Viditeľné (ΔE ≥ {VIDITELNA_DE:g}, {viditelne.sum()}): nájdené {najdene[viditelne].mean():.0%}, "
        f"IoU {tabulka.iou[viditelne].mean():.2f}, IoU s lemom {tabulka.iou_s_lemom[viditelne].mean():.2f}, "
        f"presnosť masky {tabulka.presnost[viditelne & najdene].mean():.0%}",
    ]
    for nazov, vyber in (("  mimo ilustrácií (papier, text)", viditelne & ~na_tlaci),
                         ("  na ilustráciách / tlači", viditelne & na_tlaci)):
        if vyber.any():
            riadky.append(f"{nazov}: {vyber.sum()} škvŕn, nájdené {najdene[vyber].mean():.0%}, "
                          f"IoU s lemom {tabulka.iou_s_lemom[vyber].mean():.2f}")
    riadky.append(f"Falošné nálezy na syntetických stranách: {falosne}")
    riadky.append(f"Nálezy na pôvodných stranách (skutočné škvrny aj chyby): {na_povodnych}")
    return "\n".join(riadky)


def main():
    parser = argparse.ArgumentParser(description="Syntetický test hľadania škvŕn na dokumentoch.")
    parser.add_argument("--strany", nargs="+", type=Path, required=True, help="obrázky strán dokumentov")
    parser.add_argument("--fotky", type=Path, required=True, help="fotky škvŕn (detailné zábery)")
    parser.add_argument("--masky", type=Path, help="masky škvŕn (predvolene <fotky>/masky)")
    parser.add_argument("--vystup", type=Path, default=Path(__file__).parent / "vysledky_test")
    args = parser.parse_args()
    args.vystup.mkdir(parents=True, exist_ok=True)

    tabulka, falosne, na_povodnych = otestuj(args.strany, args.fotky, args.masky or args.fotky / "masky", args.vystup)
    tabulka.to_csv(args.vystup / "skvrny.csv", index=False)
    text = suhrn(tabulka, falosne, na_povodnych)
    (args.vystup / "suhrn.txt").write_text(text + "\n", encoding="utf-8")
    print()
    print(text)


if __name__ == "__main__":
    main()
