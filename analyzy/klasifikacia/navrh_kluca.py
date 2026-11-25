"""Návrh manuálneho určovacieho kľúča z výstupov krokov 1–5 (farba, radiálny profil, textúra, tvar).

Postup:
  1. pre každú fotku spočíta črty (predvolene funkciami krokov 3–5 a priemernú farbu voči papieru),
  2. na trénovacích fotkách stavia kľúč zhora nadol: v uzle zoradí druhy podľa mediánu črty
     a hľadá rez medzi nimi s prahom, pri ktorom je najviac fotiek na správnej strane
     (priemer cez druhy, rovnaké pravidlo ako v kluc.py),
  3. črty skúša po úrovniach: najprv farba, potom radiálny profil (zóny), potom textúra a tvar;
     ďalšia úroveň sa použije, len keď predchádzajúca nedosiahne ISTOTA,
  4. s --dvojice skúsi, keď žiadna črta nedosiahne ISTOTA, aj dvojicu čŕt oddelenú priamkou
     (z DVOJICE_Z najlepších čŕt uzla); použije ju, len keď je lepšia aspoň o ZISK_DVOJICE,
  5. keď nič neoddelí druhy uzla aspoň na MIN_ISTOTA, uzol ostane ako skupina
     „nerozlíšiteľné bez mikroskopie“,
  6. kľúč vypíše ako tabuľku v Markdowne a JSON, overí ho na testovacích fotkách (fotky aj kartičky
     väčšinovým hlasovaním) a s --cv aj krížovou validáciou po kartičkách na trénovacích fotkách.

Črty (--crty):
  zakladne   – kroky 3–5: priemerná farba, kruhy od ťažiska, zrnitosť, entropia, tvar; papier = medián
               mimo masky; s --jadro sa farba, profil a textúra merajú v jadre škvrny,
  vylepsene  – črty kľúča z crty.py (lokálny odhad papiera, jadro 0,45, percentily farby, zóny od okraja,
               lem, LBP, Gaborova textúra) a k nim entropia jasu z kroku 5 a tvar z kroku 4.

Výstup v vysledky_navrh_kluca[_…]/: crty_fotiek.csv, kluc.md, kluc.json (kroky kľúča, určuje funkcia urci),
urcenie_fotiek.csv, krizova_validacia.csv (s --cv)

    python -m klasifikacia.navrh_kluca --jadro 0.45
    python -m klasifikacia.navrh_kluca --crty vylepsene --dvojice --cv
"""
import argparse
import json
import math
from concurrent.futures import ProcessPoolExecutor
from itertools import combinations
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

from klasifikacia.crty import MIN_PLOCHA, crty_skvrny, jadro, odhad_papiera
from klasifikacia.kluc import prah_pre_skupiny
from klasifikacia.porovnanie_dvojice import priznaky_textury
from klasifikacia.postav_kluc import FOLDY, foldy
from klasifikacia.radialny_profil import radialny_profil
from klasifikacia.tvary_masky import priznaky_masky
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import nacitaj_masku, nacitaj_obrazok, najdi_fotku, udaje_z_nazvu, zoznam_fotiek

PRIECINOK = Path(__file__).parent
PREKRYV = PRIECINOK / "vysledky_prekryv" / "matica_prekryvu.csv"
MAX_STRANA = 1200
ISTOTA = 0.9
MIN_ISTOTA = 0.75
MIN_FOTIEK = 5
DVOJICE_Z = 8
ZISK_DVOJICE = 0.02
UHOL_KROK = 6
ROZDELENI_CV = 5

KANALY = {"dL": "jas", "da": "červenosť", "db": "žltosť"}
STATISTIKY = {"mean": "priemer", "p10": "10. percentil", "p50": "medián", "p90": "90. percentil", "std": "SD"}
UROVNE = {
    "zakladne": {
        "farba": ["dL", "da", "db"],
        "radiálny profil": ["grad_dL", "grad_da", "grad_db"],
        "textúra a tvar": ["sd_dL", "entropia", "kruhovitost", "excentricita"],
    },
    "vylepsene": {
        "farba": [f"farba_{k}_{s}" for k in KANALY for s in ("mean", "p10", "p50", "p90")]
                 + ["farba_chroma", "farba_odtien_deg"],
        "zóny a lem": [f"zona{z}_{k}" for z in range(4) for k in KANALY]
                      + [f"zona_stred_minus_okraj_{k}" for k in KANALY] + [f"halo_{k}" for k in KANALY],
        "textúra a tvar": [f"farba_{k}_std" for k in KANALY] + ["entropia", "gabor_l32_odozva"]
                          + [f"lbp_P8R1_{i}" for i in range(10)] + ["kruhovitost", "excentricita"],
    },
}
NAZVY = {
    "dL": "jas dL", "da": "červenosť da", "db": "žltosť db",
    "grad_dL": "zmena jasu okraj − stred", "grad_da": "zmena červenosti okraj − stred",
    "grad_db": "zmena žltosti okraj − stred", "sd_dL": "zrnitosť (SD jasu)", "entropia": "entropia jasu",
    "kruhovitost": "kruhovitosť", "excentricita": "excentricita", "farba_chroma": "sýtosť",
    "farba_odtien_deg": "tón (°)", "gabor_l32_odozva": "hrubá textúra (Gabor, λ = 32 px)",
}


def nazov(crta):
    """Zrozumiteľný názov črty (zóna 0 = okraj jadra, zóna 3 = stred)."""
    if crta in NAZVY:
        return NAZVY[crta]
    casti = crta.split("_")
    if crta.startswith("farba_"):
        return f"{KANALY[casti[1]]} ({STATISTIKY[casti[2]]})"
    if crta.startswith("zona_stred_minus_okraj_"):
        return f"{KANALY[casti[-1]]} stred − okraj"
    if crta.startswith("zona"):
        return f"{KANALY[casti[1]]} zóny {crta[4]}"
    if crta.startswith("halo_"):
        return f"{KANALY[casti[1]]} lemu"
    if crta.startswith("lbp_"):
        return f"LBP vzor {casti[-1]}" + (" (neuniformné)" if casti[-1] == "9" else "")
    return crta


def zmensi(obrazok, maska):
    """Fotka a maska zmenšené na dlhšiu stranu MAX_STRANA (rýchlejší výpočet, rovnaké pomery)."""
    vyska, sirka = maska.shape
    mierka = MAX_STRANA / max(vyska, sirka)
    if mierka >= 1:
        return obrazok, maska
    velkost = (round(sirka * mierka), round(vyska * mierka))
    mensia = cv2.resize(maska.astype(np.uint8), velkost, interpolation=cv2.INTER_NEAREST) > 0
    return cv2.resize(obrazok, velkost, interpolation=cv2.INTER_AREA), mensia


def crty_fotky(obrazok, maska, podiel_jadra=0.0):
    """Základné črty jednej fotky; None, ak niektorý krok masku odmietne (prázdna alebo malá).

    Pri podiel_jadra > 0 sa farba, radiálny profil a textúra merajú len v jadre škvrny (crty.jadro),
    papier a tvar z celej masky.
    """
    obrazok, maska = zmensi(obrazok, maska)
    if maska.sum() < MIN_PLOCHA or (~maska).sum() < MIN_PLOCHA:
        return None
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    papier = np.median(lab[~maska], axis=0)
    vnutri = jadro(lab - papier, maska.astype(np.uint8) * 255, podiel_jadra) > 0 if podiel_jadra > 0 else maska

    textura = priznaky_textury(obrazok, vnutri, papier)
    profil = radialny_profil(obrazok, vnutri, papier)
    tvar = priznaky_masky(maska)
    if textura is None or profil is None or tvar is None:
        return None

    farba = (lab[vnutri] - papier).mean(axis=0)
    gradient = profil[-1] - profil[0]
    return {"dL": farba[0], "da": farba[1], "db": farba[2],
            "grad_dL": gradient[0], "grad_da": gradient[1], "grad_db": gradient[2],
            "sd_dL": textura["sd_dL"], "entropia": textura["entropia"],
            "kruhovitost": tvar["kruhovitost"], "excentricita": tvar["excentricita"]}


def crty_fotky_vylepsene(uloha):
    """Črty kľúča z crty.py (lokálny papier, jadro) + entropia jasu jadra a tvar celej masky."""
    fotka, cesta_fotky, cesta_masky = uloha
    obrazok, maska = nacitaj_obrazok(cesta_fotky), nacitaj_masku(cesta_masky)
    if obrazok is None or maska is None or maska.sum() < MIN_PLOCHA:
        return {"fotka": fotka}
    vysledok = crty_skvrny(obrazok, maska)
    if vysledok is None:
        return {"fotka": fotka}
    crty, podklady = vysledok

    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    pozadie, _ = odhad_papiera(lab, maska.astype(np.uint8) * 255, math.sqrt(maska.sum() / math.pi))
    jas = (lab[..., 0] - pozadie[..., 0])[podklady["jadro"] > 0]
    hist, _ = np.histogram(jas, bins=32)
    p = hist[hist > 0] / hist.sum()
    tvar = priznaky_masky(maska) or {}
    return {"fotka": fotka, **crty, "entropia": float(-np.sum(p * np.log2(p))),
            "kruhovitost": tvar.get("kruhovitost", np.nan), "excentricita": tvar.get("excentricita", np.nan)}


def vypocitaj_crty(priecinok_fotiek, priecinok_masiek, podiel_jadra):
    """Základné črty všetkých fotiek s druhom a časťou (train/test); fotky s malou maskou vynechá."""
    cast = nacitaj_rozdelenie().set_index("fotka").cast
    fotky = zoznam_fotiek(priecinok_fotiek)
    riadky = []
    for poradie, cesta in enumerate(fotky, 1):
        maska = nacitaj_masku(Path(priecinok_masiek) / (cesta.stem + ".png"))
        crty = None if maska is None else crty_fotky(nacitaj_obrazok(cesta), maska, podiel_jadra)
        if crty is None:
            print(f"\nvynechaná (prázdna alebo malá maska): {cesta.name}")
            continue
        riadky.append({"fotka": cesta.stem, "druh": udaje_z_nazvu(cesta.stem)[1],
                       "cast": cast.get(cesta.stem, "train"), **crty})
        print(f"\r{poradie}/{len(fotky)} fotiek", end="")
    print()
    return pd.DataFrame(riadky)


def vypocitaj_crty_vylepsene(priecinok_fotiek, priecinok_masiek):
    """Vylepšené črty všetkých fotiek (paralelne); fotky bez čŕt vynechá."""
    rozdelenie = nacitaj_rozdelenie()
    ulohy = [(f, najdi_fotku(priecinok_fotiek, f), Path(priecinok_masiek) / f"{f}.png") for f in rozdelenie.fotka]
    riadky = []
    with ProcessPoolExecutor() as pool:
        for poradie, riadok in enumerate(pool.map(crty_fotky_vylepsene, ulohy, chunksize=4), 1):
            riadky.append(riadok)
            print(f"\r{poradie}/{len(ulohy)} fotiek", end="")
    print()
    data = rozdelenie[["fotka", "druh", "cast"]].merge(pd.DataFrame(riadky), on="fotka")
    return data.dropna(subset=["farba_dL_mean"])


def najlepsi_rez(hodnoty, druhy, indexy):
    """Najlepšie rozdelenie druhov podľa hodnôt: druhy zoradené podľa mediánu, rez medzi nimi; None, ak druhu chýbajú hodnoty."""
    mediany = []
    for druh, index in indexy.items():
        h = hodnoty[index]
        h = h[np.isfinite(h)]
        if not len(h):
            return None
        mediany.append((float(np.median(h)), druh))
    mediany.sort()

    najlepsi = None
    for k in range(1, len(mediany)):
        vlavo = [d for _, d in mediany[:k]]
        prah, skore = prah_pre_skupiny(hodnoty, druhy, set(vlavo))
        vyvazenie = min(k, len(mediany) - k)
        if najlepsi is None or (skore, vyvazenie) > (najlepsi["skore"], najlepsi["vyvazenie"]):
            najlepsi = {"prah": prah, "skore": skore, "vyvazenie": vyvazenie, "vlavo": vlavo,
                        "vpravo": [d for _, d in mediany[k:]],
                        "hranica": (mediany[k - 1][1], mediany[k - 1][0], mediany[k][1], mediany[k][0])}
    return najlepsi


def poradie(rez):
    return rez["skore"], rez["vyvazenie"]


def otazka_dvojice(data, a, b, druhy, indexy):
    """Dvojica čŕt: obe štandardizované, priemet na priamku pod uhlom (po UHOL_KROK °), na priemete najlepší rez."""
    X = data[[a, b]].to_numpy(float)
    stred, mierka = np.nanmean(X, axis=0), np.nanstd(X, axis=0)
    mierka[mierka == 0] = 1
    Z = (X - stred) / mierka
    najlepsia = None
    for uhol in range(0, 180, UHOL_KROK):
        u = np.deg2rad(uhol)
        rez = najlepsi_rez(np.cos(u) * Z[:, 0] + np.sin(u) * Z[:, 1], druhy, indexy)
        if rez and (najlepsia is None or poradie(rez) > poradie(najlepsia)):
            najlepsia = {"crty": [a, b], "stred": stred.tolist(), "mierka": mierka.tolist(), "uhol": uhol,
                         "uroven": "dvojica čŕt", **rez}
    return najlepsia


def vyber_otazku(data, urovne, dvojice):
    """Prvá úroveň čŕt, ktorá dosiahne ISTOTA; inak lepšia dvojica alebo najlepšia črta nad MIN_ISTOTA; inak None."""
    druhy = data.druh.to_numpy()
    indexy = {d: np.flatnonzero(druhy == d) for d in sorted(set(druhy))}
    jednotlive = []
    for uroven, crty in urovne.items():
        rezy = []
        for crta in crty:
            rez = najlepsi_rez(data[crta].to_numpy(float), druhy, indexy)
            if rez:
                rezy.append({"crta": crta, "uroven": uroven, **rez})
        if rezy and max(rezy, key=poradie)["skore"] >= ISTOTA:
            return max(rezy, key=poradie)
        jednotlive += rezy

    najlepsia = max(jednotlive, key=poradie)
    if dvojice:
        kandidati = [r["crta"] for r in sorted(jednotlive, key=poradie, reverse=True)[:DVOJICE_Z]]
        rezy = [otazka_dvojice(data, a, b, druhy, indexy) for a, b in combinations(kandidati, 2)]
        rezy = [r for r in rezy if r]
        if rezy and max(rezy, key=poradie)["skore"] >= najlepsia["skore"] + ZISK_DVOJICE:
            najlepsia = max(rezy, key=poradie)
    return najlepsia if najlepsia["skore"] >= MIN_ISTOTA else None


def postav(data, urovne, dvojice=False):
    """Rekurzívne postaví kľúč; list je {'druhy': [...]}, uzol {'otazka': ..., 'ano': ..., 'nie': ...}."""
    druhy = sorted(data.druh.unique())
    if len(druhy) == 1:
        return {"druhy": druhy}
    otazka = vyber_otazku(data, urovne, dvojice)
    if otazka is None:
        return {"druhy": druhy, "nerozlisitelne": True}
    return {"otazka": otazka,
            "ano": postav(data[data.druh.isin(otazka["vlavo"])], urovne, dvojice),
            "nie": postav(data[data.druh.isin(otazka["vpravo"])], urovne, dvojice)}


def ocisluj(koren):
    """Uzly s otázkou v poradí po úrovniach a ich čísla krokov (1, 2, …)."""
    uzly, rad = [], [koren]
    while rad:
        uzol = rad.pop(0)
        if "otazka" in uzol:
            uzly.append(uzol)
            rad += [uzol["ano"], uzol["nie"]]
    return uzly, {id(u): i + 1 for i, u in enumerate(uzly)}


def popis_otazky(o):
    if "uhol" in o:
        return f"dvojica: {nazov(o['crty'][0])} a {nazov(o['crty'][1])} (priamka pod uhlom {o['uhol']}°)"
    return nazov(o["crta"])


def kluc_do_json(koren, prekryv, nastavenia, uspesnost):
    """Kľúč ako zoznam krokov; odpoveď áno/nie vedie na ďalší krok, druh alebo nerozlíšiteľnú skupinu."""
    uzly, cisla = ocisluj(koren)

    def ciel(uzol):
        if "otazka" in uzol:
            return {"krok": cisla[id(uzol)]}
        if uzol.get("nerozlisitelne"):
            return {"druhy": uzol["druhy"], "nerozlisitelne": True}
        return {"druh": uzol["druhy"][0]}

    kroky = []
    for uzol in uzly:
        o = uzol["otazka"]
        krok = {"krok": cisla[id(uzol)]}
        if "uhol" in o:
            krok.update({"crty": o["crty"], "stred": [round(v, 4) for v in o["stred"]],
                         "mierka": [round(v, 4) for v in o["mierka"]], "uhol": o["uhol"]})
        else:
            krok["crta"] = o["crta"]
        krok.update({"nazov": popis_otazky(o), "uroven": o["uroven"], "podmienka": "<=",
                     "prah": round(float(o["prah"]), 4), "skore": round(float(o["skore"]), 4),
                     "ano": ciel(uzol["ano"]), "nie": ciel(uzol["nie"]), "zdovodnenie": zdovodnenie(o, prekryv)})
        kroky.append(krok)
    return json.loads(json.dumps({"nastavenia": nastavenia, "crty": {c: nazov(c) for c in pouzite_crty(kroky)},
                                  "kroky": kroky, "uspesnost": uspesnost}, ensure_ascii=False))


def pouzite_crty(kroky):
    return sorted({c for k in kroky for c in k.get("crty", [k.get("crta")])})


def hodnota_otazky(krok, crty):
    """Hodnota, ktorá sa porovná s prahom: črta, alebo pri dvojici priemet štandardizovaných čŕt na priamku."""
    if "uhol" in krok:
        z = (np.array([crty[c] for c in krok["crty"]], float) - krok["stred"]) / np.array(krok["mierka"])
        u = np.deg2rad(krok["uhol"])
        return float(np.cos(u) * z[0] + np.sin(u) * z[1])
    return float(crty[krok["crta"]])


def urci(kluc, crty):
    """Prejde kľúč (JSON) pre črty jednej fotky -> (možné druhy, cesta kľúčom). Chýbajúca hodnota ide na „nie“."""
    kroky = {k["krok"]: k for k in kluc["kroky"]}
    krok, cesta = kroky[1], []
    while True:
        hodnota = hodnota_otazky(krok, crty)
        ano = hodnota <= krok["prah"]
        cesta.append(f"{krok['krok']}. {krok['nazov']} {cislo(hodnota)} {'≤' if ano else '>'} {cislo(krok['prah'])}")
        ciel = krok["ano"] if ano else krok["nie"]
        if "krok" not in ciel:
            return ([ciel["druh"]] if "druh" in ciel else ciel["druhy"]), cesta
        krok = kroky[ciel["krok"]]


def cislo(v):
    return f"{v:.2f}".replace(".", ",").replace("-", "−")


def zdovodnenie(o, prekryv):
    """Text zdôvodnenia: mediány druhov pri prahu, podiel fotiek na správnej strane, prekryv pixelov z kroku 2."""
    a, ma, b, mb = o["hranica"]
    text = (f"{o['uroven']}; medián {a} {cislo(ma)}, najbližší druh {b} {cislo(mb)}; "
            f"správne zaradených {o['skore'] * 100:.0f} % (priemer cez druhy)")
    if prekryv is not None and a in prekryv.index and b in prekryv.columns:
        text += f"; prekryv pixelov {a}–{b} {cislo(prekryv.loc[a, b])}"
    return text


def tabulka_kluca(kluc):
    """Markdown tabuľka z JSON kľúča: odpoveď vedie na druh alebo ďalší krok."""
    def ciel(c):
        if "krok" in c:
            return f"krok {c['krok']}"
        if c.get("nerozlisitelne"):
            return "nerozlíšiteľné bez mikroskopie: " + ", ".join(f"*{d}*" for d in c["druhy"])
        return f"**{c['druh']}**"

    riadky = ["| Krok | Podmienka | Výsledok | Zdôvodnenie |", "|---|---|---|---|"]
    for k in kluc["kroky"]:
        riadky.append(f"| {k['krok']} | {k['nazov']} ≤ {cislo(k['prah'])} | áno → {ciel(k['ano'])}; "
                      f"nie → {ciel(k['nie'])} | {k['zdovodnenie']} |")
    return "\n".join(riadky)


def vyhodnot(kluc, data):
    """Určenie každej fotky kľúčom."""
    urcenie = [", ".join(urci(kluc, r)[0]) for _, r in data.iterrows()]
    vysledky = data[["fotka", "druh", "vzorka", "cast"]].assign(urcenie=urcenie)
    vysledky["spravne"] = vysledky.urcenie == vysledky.druh
    return vysledky


def uspesnost_karticiek(vysledky):
    """Podiel kartičiek, ktorých najčastejšie určenie je správny druh."""
    return vysledky.groupby("vzorka").apply(
        lambda g: g.urcenie.value_counts().index[0] == g.druh.iloc[0], include_groups=False).mean()


def krizova_validacia(train, urovne, dvojice):
    """5-násobná krížová validácia po kartičkách, ROZDELENI_CV rôznych rozdelení do foldov."""
    riadky = []
    for seed in range(ROZDELENI_CV):
        fold = foldy(train, seed)
        casti = [vyhodnot(kluc_do_json(postav(train[fold != f], urovne, dvojice), None, {}, {}), train[fold == f])
                 for f in range(FOLDY)]
        v = pd.concat(casti)
        riadky.append({"seed": seed, "fotky": v.spravne.mean(), "karticky": uspesnost_karticiek(v)})
        print(f"  rozdelenie {seed}: fotky {v.spravne.mean():.1%}, kartičky {riadky[-1]['karticky']:.1%}")
    return pd.DataFrame(riadky)


def nazov_vystupu(args):
    """Priečinok čŕt (bez --dvojice) a priečinok výsledkov variantu."""
    meno = "vysledky_navrh_kluca"
    if args.crty == "vylepsene":
        meno += "_vylepsene"
    elif args.jadro > 0:
        meno += f"_jadro_{args.jadro:g}"
    return PRIECINOK / meno, PRIECINOK / (meno + ("_dvojice" if args.dvojice else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fotky", default="images/D2")
    ap.add_argument("--masky", default="images/D2/masky")
    ap.add_argument("--crty", default="zakladne", choices=list(UROVNE))
    ap.add_argument("--jadro", type=float, default=0.0,
                    help="pri základných črtách podiel pre jadro škvrny (napr. 0.45); 0 = celá maska")
    ap.add_argument("--dvojice", action="store_true", help="povoliť otázky s dvojicou čŕt oddelenou priamkou")
    ap.add_argument("--cv", action="store_true", help="krížová validácia po kartičkách na trénovacích fotkách")
    ap.add_argument("--znova", action="store_true", help="prepočítať črty, aj keď sú uložené")
    args = ap.parse_args()

    priecinok_crt, vystup = nazov_vystupu(args)
    subor_crt = priecinok_crt / "crty_fotiek.csv"
    if subor_crt.exists() and not args.znova:
        data = pd.read_csv(subor_crt)
        print(f"Črty načítané z {subor_crt} (--znova ich prepočíta)")
    else:
        if args.crty == "vylepsene":
            data = vypocitaj_crty_vylepsene(args.fotky, args.masky)
        else:
            data = vypocitaj_crty(args.fotky, args.masky, args.jadro)
        priecinok_crt.mkdir(exist_ok=True)
        data.to_csv(subor_crt, index=False, encoding="utf-8")
    data = data.drop(columns=["vzorka"], errors="ignore").merge(nacitaj_rozdelenie()[["fotka", "vzorka"]], on="fotka")

    urovne = UROVNE[args.crty]
    trenovacie = data[data.cast == "train"]
    pocty = trenovacie.druh.value_counts()
    trenovacie = trenovacie[trenovacie.druh.isin(pocty[pocty >= MIN_FOTIEK].index)]
    prekryv = pd.read_csv(PREKRYV, index_col=0) if PREKRYV.exists() else None

    nastavenia = {"crty": args.crty, "jadro": 0.45 if args.crty == "vylepsene" else args.jadro,
                  "papier": "lokálny odhad (crty.py)" if args.crty == "vylepsene" else "medián pixelov mimo masky",
                  "dvojice": args.dvojice, "istota": ISTOTA, "min_istota": MIN_ISTOTA, "max_strana": MAX_STRANA,
                  "fotiek_train": len(trenovacie)}
    kluc = kluc_do_json(postav(trenovacie, urovne, args.dvojice), prekryv, nastavenia, {})
    vysledky = vyhodnot(kluc, data)
    uspesnost = {f"{c}_fotky": round(float(v.spravne.mean()), 4) for c, v in vysledky.groupby("cast")}
    uspesnost["test_karticky"] = round(float(uspesnost_karticiek(vysledky[vysledky.cast == "test"])), 4)

    vystup.mkdir(exist_ok=True)
    if args.cv:
        print("Krížová validácia po kartičkách:")
        cv = krizova_validacia(trenovacie, urovne, args.dvojice)
        cv.to_csv(vystup / "krizova_validacia.csv", index=False, encoding="utf-8")
        uspesnost.update({"train_cv_fotky": round(float(cv.fotky.mean()), 4),
                          "train_cv_fotky_sd": round(float(cv.fotky.std()), 4),
                          "train_cv_karticky": round(float(cv.karticky.mean()), 4)})
    kluc["uspesnost"] = uspesnost

    (vystup / "kluc.json").write_text(json.dumps(kluc, ensure_ascii=False, indent=1), encoding="utf-8")
    vysledky.to_csv(vystup / "urcenie_fotiek.csv", index=False, encoding="utf-8")
    tabulka = tabulka_kluca(kluc)
    hlavicka = (f"# Návrh manuálneho kľúča\n\nČrty: {args.crty}, jadro {nastavenia['jadro']:g}, "
                f"dvojice čŕt: {'áno' if args.dvojice else 'nie'}. Prahy z trénovacích fotiek ({len(trenovacie)}). "
                f"Istota úrovne {ISTOTA:.0%}, najmenšia istota {MIN_ISTOTA:.0%}.\n\n")
    paticka = "\n\n| úspešnosť | hodnota |\n|---|---|\n" + "\n".join(
        f"| {k} | {v:.1%} |" for k, v in uspesnost.items())
    (vystup / "kluc.md").write_text(hlavicka + tabulka + paticka + "\n", encoding="utf-8")

    print(tabulka)
    print(paticka)
    print("\nÚspešnosť po druhoch (test):")
    print(vysledky[vysledky.cast == "test"].groupby("druh").spravne.mean().round(2).to_string())
    print(f"\nUložené do {vystup}")


if __name__ == "__main__":
    main()
