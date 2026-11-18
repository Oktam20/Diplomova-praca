"""PCA farieb pixelov škvrny: pomôžu smery vlastných vektorov a pomery vlastných čísel určiť druh?

    python -m klasifikacia.pca_farieb --fotky images/D2 --masky images/D2/masky --rucne images/D2masks

Z pixelov vo vnútri masky sa spočíta kovariančná matica farieb (Lab voči papieru, rovina ab, RGB),
jej vlastné vektory a vlastné čísla. Črty sú smer hlavnej osi, pomery vlastných čísel a rozptyl pozdĺž
hlavnej osi. Porovnáva sa ručná maska, automatická maska a jej jadro bez okrajovej zóny. Analýza,
výber čŕt aj učenie sú len na train (krížová validácia po kartičkách), test slúži na konečné porovnanie.
"""
import argparse
import copy
import json
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from matplotlib.ticker import PercentFormatter
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from klasifikacia.crty import MIN_PLOCHA, ZON, crty_skvrny, odhad_papiera
from klasifikacia.kluc import druhy_v_otazke, nacitaj, nauc_dvojicu, nauc_kluc, okraj_dvojice, prah_pre_skupiny
from klasifikacia.postav_kluc import FOLDY, STRUKTURA, foldy, poradie_druhov, vyhodnot
from klasifikacia.vzhlad import (ATRAMENT, ATRAMENT2, CERVENA, KONTEXT, MODRA, MODRA_SVETLA, MODRA_TMAVA, POVRCH,
                                 SEKVENCNA, SVETLE, TMAVE, os_grafu)
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import nacitaj_masku, nacitaj_obrazok, najdi_fotku

PRIECINOK = Path(__file__).parent
OPAKOVANIA = 5
ZLEPSENIE = 0.01
PRIKLADY = ("Alternaria", "Aspergillus", "Rhodococcus", "Curtobacterium")
MASKY = {"rucna": "ručná maska", "auto": "automatická maska", "jadro": "jadro automatickej masky (bez zóny 0)"}
OSI = ("pca_lab_smer_ab", "pca_ab_smer")
POPISY = {
    "pca_lab_sklon": "Lab · sklon hlavnej osi od osi jasu",
    "pca_lab_smer_ab": "Lab · smer hlavnej osi v rovine ab",
    "pca_lab_odchylka": "Lab · odchýlka hlavnej osi od farby škvrny",
    "pca_lab_pomer21": "Lab · pomer λ2 / λ1",
    "pca_lab_pomer31": "Lab · pomer λ3 / λ1",
    "pca_lab_rozptyl": "Lab · √λ1 (rozptyl pozdĺž hlavnej osi)",
    "pca_ab_smer": "ab · smer hlavnej osi",
    "pca_ab_odchylka": "ab · odchýlka hlavnej osi od tónu",
    "pca_ab_pomer": "ab · pomer λ2 / λ1",
    "pca_ab_rozptyl": "ab · √λ1",
    "pca_rgb_sklon": "RGB · sklon hlavnej osi od osi šedej",
    "pca_rgb_pomer21": "RGB · pomer λ2 / λ1",
    "pca_rgb_pomer31": "RGB · pomer λ3 / λ1",
    "pca_rgb_rozptyl": "RGB · √λ1",
}
PCA_CRTY = list(POPISY)
PRIESTORY = {p: [c for c in PCA_CRTY if c.startswith(f"pca_{p.lower()}_")] for p in ("Lab", "ab", "RGB")}
KANALY = "Lab"
FARBY_PRIESTOROV = {"Lab": MODRA_TMAVA, "ab": MODRA, "RGB": MODRA_SVETLA}
ZNACKY_MASIEK = {"rucna": ("o", "#0d366b"), "auto": ("s", "#3987e5"), "jadro": ("D", MODRA_SVETLA)}


def vlastne(kovariancia):
    """Vlastné čísla zostupne a vlastné vektory v stĺpcoch."""
    cisla, vektory = np.linalg.eigh(kovariancia)
    poradie = np.argsort(cisla)[::-1]
    return np.clip(cisla[poradie], 1e-12, None), vektory[:, poradie]


def uhol_od(vektor, smer):
    """Uhol osi od smeru v stupňoch (0–90°), orientácia vlastného vektora nerozhoduje."""
    smer = np.asarray(smer, float)
    kosinus = abs(float(vektor @ smer)) / (np.linalg.norm(vektor) * np.linalg.norm(smer))
    return float(np.degrees(np.arccos(min(1.0, kosinus))))


def smer_osi(x, y):
    """Smer osi v rovine v stupňoch 0–180° (os nemá orientáciu)."""
    return float(np.degrees(np.arctan2(y, x)) % 180)


def pca_crty(lab, rgb):
    """Črty z kovariančnej matice farieb pixelov: Lab voči papieru (3D), rovina ab (2D) a RGB fotky (3D)."""
    stred = lab.mean(axis=0)
    kov = np.cov(lab, rowvar=False)
    cisla, v = vlastne(kov)
    cisla_ab, v_ab = vlastne(kov[1:, 1:])
    cisla_rgb, v_rgb = vlastne(np.cov(rgb, rowvar=False))
    smer_ab = smer_osi(*v_ab[:, 0])
    odchylka = abs(smer_ab - smer_osi(stred[1], stred[2]))
    crty = {
        "pca_lab_sklon": uhol_od(v[:, 0], (1, 0, 0)),
        "pca_lab_smer_ab": smer_osi(v[1, 0], v[2, 0]),
        "pca_lab_odchylka": uhol_od(v[:, 0], stred),
        "pca_lab_pomer21": float(cisla[1] / cisla[0]),
        "pca_lab_pomer31": float(cisla[2] / cisla[0]),
        "pca_lab_rozptyl": float(math.sqrt(cisla[0])),
        "pca_ab_smer": smer_ab,
        "pca_ab_odchylka": min(odchylka, 180 - odchylka),
        "pca_ab_pomer": float(cisla_ab[1] / cisla_ab[0]),
        "pca_ab_rozptyl": float(math.sqrt(cisla_ab[0])),
        "pca_rgb_sklon": uhol_od(v_rgb[:, 0], (1, 1, 1)),
        "pca_rgb_pomer21": float(cisla_rgb[1] / cisla_rgb[0]),
        "pca_rgb_pomer31": float(cisla_rgb[2] / cisla_rgb[0]),
        "pca_rgb_rozptyl": float(math.sqrt(cisla_rgb[0])),
    }
    crty.update({f"stred_{k}": float(stred[i]) for i, k in enumerate(KANALY)})
    crty.update({f"kov_{KANALY[i]}{KANALY[j]}": float(kov[i, j]) for i in range(3) for j in range(i, 3)})
    return crty


def farby_voci_papieru(obrazok, maska):
    """Farba každého pixelu fotky voči odhadnutej farbe papiera (ΔL*, Δa*, Δb*)."""
    m = maska.astype(np.uint8) * 255
    polomer = math.sqrt(cv2.countNonZero(m) / math.pi)
    lab = cv2.cvtColor(obrazok.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    return (lab - odhad_papiera(lab, m, polomer)[0]).astype(np.float64)


def jadro(maska):
    """Maska bez okrajovej zóny 0 (vzdialenosť od okraja nad štvrtinou maxima)."""
    vzdialenost = cv2.distanceTransform(maska.astype(np.uint8), cv2.DIST_L2, 5)
    return vzdialenost > vzdialenost.max() / ZON


def spracuj_fotku(uloha):
    fotka, cesta_fotky, cesty_masiek = uloha
    obrazok = nacitaj_obrazok(cesta_fotky)
    riadky = []
    for nazov, cesta in cesty_masiek.items():
        maska = nacitaj_masku(cesta)
        if obrazok is None or maska is None or maska.sum() < MIN_PLOCHA:
            continue
        rel, rgb = farby_voci_papieru(obrazok, maska), obrazok[..., ::-1].astype(np.float64)
        riadky.append({"fotka": fotka, "maska": nazov, **crty_skvrny(obrazok, maska)[0],
                       **pca_crty(rel[maska], rgb[maska])})
        if nazov == "auto":
            vnutro = jadro(maska)
            riadky.append({"fotka": fotka, "maska": "jadro", **pca_crty(rel[vnutro], rgb[vnutro])})
    return riadky


def posun_osi(uhly, vzor):
    """Smer osi v rozsahu ±90° okolo priemerného smeru vzoru (kruh 0–180° sa rozstrihne oproti nemu)."""
    dvojity = np.radians(2 * np.asarray(vzor, float))
    stred = np.degrees(np.arctan2(np.sin(dvojity).mean(), np.cos(dvojity).mean())) / 2
    return (uhly - stred + 90) % 180 + stred - 90


def vypocitaj_crty(rozdelenie, fotky, masky, rucne):
    ulohy = [(f, najdi_fotku(fotky, f), {"auto": masky / f"{f}.png", "rucna": rucne / f"{f}.png"})
             for f in rozdelenie.fotka]
    riadky = []
    with ProcessPoolExecutor() as pool:
        for poradie, vysledok in enumerate(pool.map(spracuj_fotku, ulohy, chunksize=4), 1):
            riadky.extend(vysledok)
            print(f"\r{poradie}/{len(ulohy)} fotiek", end="")
    print()
    crty = rozdelenie.merge(pd.DataFrame(riadky), on="fotka")
    vzor = (crty.cast == "train") & (crty.maska == "auto")
    for c in OSI:
        crty[c] = posun_osi(crty[c], crty.loc[vzor, c])
    return crty


def eta2(df, crty):
    """Sila rozlíšenia druhov: eta² z Kruskal-Wallisovho testu na mediánoch kartičiek."""
    karticky = df.groupby(["druh", "vzorka"])[crty].median().reset_index()
    k, n = karticky.druh.nunique(), len(karticky)
    vysledok = {}
    for c in crty:
        h = stats.kruskal(*[s[c].dropna().to_numpy() for _, s in karticky.groupby("druh")]).statistic
        vysledok[c] = max(0.0, (h - k + 1) / (n - k))
    return pd.Series(vysledok)


def nadbytocnost(train, doterajsie):
    """Najpodobnejšia doterajšia črta (Spearman) a R² odhadu PCA črty zo všetkých doterajších (náhodný les)."""
    fold = foldy(train)
    X = SimpleImputer(strategy="median").fit_transform(train[doterajsie])
    riadky = []
    for c in PCA_CRTY:
        rho = train[doterajsie].corrwith(train[c], method="spearman").abs()
        y = train[c].to_numpy(float)
        odhad = np.empty(len(y))
        for f in range(FOLDY):
            les = RandomForestRegressor(300, min_samples_leaf=2, random_state=0, n_jobs=-1)
            odhad[fold == f] = les.fit(X[fold != f], y[fold != f]).predict(X[fold == f])
        riadky.append({"crta": c, "najpodobnejsia": rho.idxmax(), "rho": rho.max(),
                       "r2": 1 - ((y - odhad) ** 2).sum() / ((y - y.mean()) ** 2).sum()})
    return pd.DataFrame(riadky).set_index("crta")


def stlpce_modelu(df, crty):
    """Črty pre klasifikátor; smer osi (0–180°) ako kosínus a sínus dvojnásobného uhla."""
    X = {}
    for c in crty:
        if c in OSI:
            X[f"{c}_cos"], X[f"{c}_sin"] = np.cos(np.radians(2 * df[c])), np.sin(np.radians(2 * df[c]))
        else:
            X[c] = df[c]
    return pd.DataFrame(X, index=df.index)


MODELY = {
    "logistická regresia": lambda: make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                                 LogisticRegression(max_iter=5000, class_weight="balanced")),
    "náhodný les": lambda: make_pipeline(SimpleImputer(strategy="median"),
                                         RandomForestClassifier(500, class_weight="balanced", random_state=0,
                                                                n_jobs=-1)),
}


def klasifikatory(crty, doterajsie):
    """Podiel správne určených fotiek bežnými klasifikátormi s doterajšími črtami, s PCA črtami a len s nimi."""
    sady = {"doterajšie črty (46)": doterajsie, "doterajšie + PCA": doterajsie + PCA_CRTY,
            "len PCA – všetky": PCA_CRTY, **{f"len PCA – {p}": c for p, c in PRIESTORY.items()}}
    riadky = []
    for maska in ("auto", "rucna"):
        df = crty[crty.maska == maska]
        train, test = df[df.cast == "train"].reset_index(drop=True), df[df.cast == "test"].reset_index(drop=True)
        y, y_test = train.druh.to_numpy(), test.druh.to_numpy()
        for sada, zoznam in sady.items():
            X, X_test = stlpce_modelu(train, zoznam), stlpce_modelu(test, zoznam)
            for nazov, model in MODELY.items():
                for seed in range(OPAKOVANIA):
                    fold = foldy(train, seed)
                    odhad = np.empty(len(y), dtype=object)
                    for f in range(FOLDY):
                        odhad[fold == f] = model().fit(X[fold != f], y[fold != f]).predict(X[fold == f])
                    riadky.append({"maska": maska, "sada": sada, "model": nazov, "cast": "train_cv", "seed": seed,
                                   "uspesnost": float((odhad == y).mean())})
                riadky.append({"maska": maska, "sada": sada, "model": nazov, "cast": "test", "seed": 0,
                               "uspesnost": float((model().fit(X, y).predict(X_test) == y_test).mean())})
            print(f"  {MASKY[maska]}: {sada}")
    return pd.DataFrame(riadky)


def balans(y, spravne):
    return float(np.mean([spravne[y == d].mean() for d in np.unique(y)]))


def jedna_crta(x, y, druh):
    """Prah jednej črty pre druh vs. ostatné -> (prah, skóre, smer); smer 1 = druh na strane ≤ prah."""
    return max((prah_pre_skupiny(x, y, {druh}, smer) + (smer,) for smer in (1, -1)), key=lambda t: t[1])


def cv_otazky(X, y, druh, fold):
    """Úspešnosť otázky (priemer cez druhy) v krížovej validácii po kartičkách."""
    spravne = np.zeros(len(y), bool)
    for f in range(FOLDY):
        uc, ov = fold != f, fold == f
        if X.shape[1] == 2:
            ano = okraj_dvojice(nauc_dvojicu(X[uc], y[uc], druh), X[ov]) > 0
        else:
            prah, _, smer = jedna_crta(X[uc, 0], y[uc], druh)
            ano = X[ov, 0] <= prah if smer == 1 else X[ov, 0] > prah
        spravne[ov] = ano == (y[ov] == druh)
    return balans(y, spravne)


def fotky_otazky(df, struktura, vetva, i):
    """Fotky druhov, ktoré k otázke vetvy môžu prísť (rovnaký výber ako pri učení kľúča)."""
    y, otazky = df.druh.to_numpy(), struktura["vetvy"][vetva]
    vyber = np.isin(y, druhy_v_otazke(otazky, i))
    if otazky[i].get("len_fotky_vetvy"):
        jas = df[struktura["jas"]["crta"]].to_numpy(float)
        prah = prah_pre_skupiny(jas, y, set(struktura["skupiny"]["tmave"]))[0]
        zona = struktura["jas"]["neista_zona"]
        vyber &= jas <= prah + zona if vetva == "tmave" else jas > prah - zona
    return df[vyber].reset_index(drop=True)


def otazky(struktura):
    """Otázky vetiev kľúča ako (označenie, vetva, poradie, otázka)."""
    return [(f"{'T' if v == 'tmave' else 'B'}{i + 1}", v, i, o)
            for v, zoznam in struktura["vetvy"].items() for i, o in enumerate(zoznam)]


def kandidati(df, druh, aktualne):
    """Úspešnosť aktuálnej otázky a otázok s PCA črtou, samotnou alebo v dvojici s črtou otázky."""
    y, fold = df.druh.to_numpy(), foldy(df)
    zoznam = [tuple(aktualne)] + [(p,) for p in PCA_CRTY] + [(c, p) for c in aktualne for p in PCA_CRTY]
    return {k: cv_otazky(df[list(k)].to_numpy(float), y, druh, fold) for k in zoznam}


def kluc_s_pca(df, struktura):
    """Štruktúra kľúča, v ktorej otázku vetvy nahradí otázka s PCA črtou, ak je lepšia aspoň o ZLEPSENIE."""
    nova = copy.deepcopy(struktura)
    for _, vetva, i, otazka in otazky(nova):
        data = fotky_otazky(df, nova, vetva, i)
        skore = kandidati(data, otazka["druh"], otazka["crty"])
        najlepsia = max(skore, key=skore.get)
        if skore[najlepsia] >= skore[tuple(otazka["crty"])] + ZLEPSENIE:
            otazka["crty"] = list(najlepsia)
            otazka.pop("smer", None)
            if len(najlepsia) == 1:
                smer = jedna_crta(data[najlepsia[0]].to_numpy(float), data.druh.to_numpy(), otazka["druh"])[2]
                otazka["smer"] = "<=" if smer == 1 else ">"
    return nova


def porovnanie_otazok(train, struktura):
    """Pre každú otázku vetvy: aktuálna otázka, najlepšia samotná PCA črta a najlepšia otázka s PCA."""
    riadky = []
    for znak, vetva, i, otazka in otazky(struktura):
        skore = kandidati(fotky_otazky(train, struktura, vetva, i), otazka["druh"], otazka["crty"])
        akt = tuple(otazka["crty"])
        sama = max((k for k in skore if len(k) == 1 and k[0] in PCA_CRTY), key=skore.get)
        najlepsia = max((k for k in skore if k != akt), key=skore.get)
        riadky.append({"otazka": znak, "druh": otazka["druh"], "aktualna": " + ".join(akt), "aktualna_cv": skore[akt],
                       "pca_sama": sama[0], "pca_sama_cv": skore[sama], "s_pca": " + ".join(najlepsia),
                       "s_pca_cv": skore[najlepsia]})
    return pd.DataFrame(riadky)


def fold_vnorenej(uloha):
    train, struktura, seed, f = uloha
    fold = foldy(train, seed)
    ucenie, overenie = train[fold != f].reset_index(drop=True), train[fold == f]
    riadky = []
    for variant, s in (("aktuálny kľúč", struktura), ("kľúč s PCA", kluc_s_pca(ucenie, struktura))):
        v = vyhodnot(nauc_kluc(s, ucenie), overenie)
        riadky.append({"variant": variant, "seed": seed, "fold": f, "spravne": int((v.vysledok == "urceny").sum()),
                       "fotiek": len(v), "otazky": "; ".join(" + ".join(o["crty"]) for *_, o in otazky(s))})
    return riadky


def vnorena_validacia(train, struktura):
    """Výber PCA otázok aj prahy sa učia bez kartičiek foldu a overia na nich; OPAKOVANIA rozdelení na foldy."""
    ulohy = [(train, struktura, seed, f) for seed in range(OPAKOVANIA) for f in range(FOLDY)]
    with ProcessPoolExecutor() as pool:
        riadky = [r for vysledok in pool.map(fold_vnorenej, ulohy) for r in vysledok]
    return pd.DataFrame(riadky)


def podiel_po_rozdeleniach(vnorena, variant):
    v = vnorena[vnorena.variant == variant]
    return v.groupby("seed").spravne.sum() / v.groupby("seed").fotiek.sum()


def zhoda_masiek(train):
    """Spearmanovo ρ hodnôt PCA čŕt z automatickej masky a z inej masky na tých istých fotkách."""
    auto = train["auto"].set_index("fotka")
    return pd.DataFrame({m: [stats.spearmanr(auto[c], train[m].set_index("fotka")[c].reindex(auto.index),
                                             nan_policy="omit").statistic for c in PCA_CRTY]
                         for m in ("rucna", "jadro")}, index=PCA_CRTY)


def elipsa(stred, kovariancia, k=2.0):
    """Body elipsy k smerodajných odchýlok okolo stredu."""
    cisla, v = vlastne(kovariancia)
    t = np.linspace(0, 2 * np.pi, 72)
    return (np.asarray(stred)[:, None] + v @ (k * np.sqrt(cisla)[:, None] * np.vstack([np.cos(t), np.sin(t)]))).T


def kovariancia(riadok):
    k = np.empty((3, 3))
    for i in range(3):
        for j in range(i, 3):
            k[i, j] = k[j, i] = riadok[f"kov_{KANALY[i]}{KANALY[j]}"]
    return np.array([riadok[f"stred_{c}"] for c in KANALY]), k


def rovina_jas_sytost(stred):
    """Premietnutie (ΔL*, Δa*, Δb*) do roviny (sýtosť v smere tónu škvrny, jas)."""
    h = stred[1:] / max(np.linalg.norm(stred[1:]), 1e-9)
    return np.array([[0.0, h[0], h[1]], [1.0, 0.0, 0.0]])


def typicke_fotky(crty, druhy):
    """Pre každý druh trénovacia fotka najbližšie k mediánu druhu v hlavných PCA črtách."""
    df = crty[(crty.maska == "auto") & (crty.cast == "train")]
    vyber = {}
    for druh in druhy:
        d = df[df.druh == druh]
        z = [(d[c] - d[c].median()).abs() / max(d[c].quantile(0.75) - d[c].quantile(0.25), 1e-9)
             for c in ("pca_lab_sklon", "pca_lab_pomer21", "pca_ab_pomer", "pca_lab_rozptyl")]
        vyber[druh] = d.fotka.loc[sum(z).idxmin()]
    return vyber


def vyrez(obrazok, maska):
    ys, xs = np.nonzero(maska)
    okraj = int(0.35 * math.sqrt(maska.sum() / math.pi))
    y0, y1 = max(0, ys.min() - okraj), min(maska.shape[0], ys.max() + okraj + 1)
    x0, x1 = max(0, xs.min() - okraj), min(maska.shape[1], xs.max() + okraj + 1)
    return obrazok[y0:y1, x0:x1], maska[y0:y1, x0:x1]


def nakresli_os(ax, stred, smer, dlzka, farba, hrubka):
    a, b = stred - dlzka * smer, stred + dlzka * smer
    ax.plot([a[0], b[0]], [a[1], b[1]], color=farba, lw=hrubka, solid_capstyle="round", zorder=4)


def oblak(ax, x, y):
    """Hustota pixelov v pravidelných šesťuholníkoch (os x aj y v rovnakých jednotkách Lab)."""
    x0, x1, y0, y1 = x.min(), x.max(), y.min(), y.max()
    krok = max(x1 - x0, y1 - y0, 1e-6) / 40
    mriezka = (max(1, round((x1 - x0) / krok)), max(1, round((y1 - y0) / (krok * math.sqrt(3)))))
    ax.hexbin(x, y, gridsize=mriezka, extent=(x0, x1, y0, y1), bins="log", cmap=SEKVENCNA, mincnt=1,
              linewidths=0, zorder=1)
    ax.scatter([0], [0], marker="x", s=36, color=ATRAMENT, lw=1.2, zorder=5)
    ax.annotate("papier", (0, 0), xytext=(5, -11), textcoords="offset points", fontsize=7.5, color=ATRAMENT2)
    ax.grid(True)
    ax.set_axisbelow(True)


def rozsah(ax, x, y):
    x0, x1 = np.percentile(np.r_[x, 0], [0.5, 99.5])
    y0, y1 = np.percentile(np.r_[y, 0], [0.5, 99.5])
    dx, dy = 0.08 * (x1 - x0 + 1), 0.08 * (y1 - y0 + 1)
    ax.set_xlim(min(x0, 0) - dx, max(x1, 0) + dx)
    ax.set_ylim(min(y0, 0) - dy, max(y1, 0) + dy)


def graf_princip(crty, fotky, masky, cesta):
    priklady = typicke_fotky(crty, PRIKLADY)
    fig, osi = plt.subplots(len(priklady), 3, figsize=(12, 3.5 * len(priklady)),
                            gridspec_kw={"width_ratios": [0.8, 1.2, 1.2]})
    for riadok, (druh, fotka) in zip(osi, priklady.items()):
        obrazok = nacitaj_obrazok(najdi_fotku(fotky, fotka))
        maska = nacitaj_masku(masky / f"{fotka}.png")
        rel = farby_voci_papieru(obrazok, maska)[maska]
        c = pca_crty(rel, obrazok[..., ::-1][maska].astype(np.float64))
        stred, kov = rel.mean(axis=0), np.cov(rel, rowvar=False)

        ax = riadok[0]
        obr, m = vyrez(obrazok, maska)
        ax.imshow(cv2.cvtColor(obr, cv2.COLOR_BGR2RGB))
        for obrys in cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0]:
            ax.plot(obrys[:, 0, 0], obrys[:, 0, 1], color=CERVENA, lw=1)
        ax.set_title(druh, loc="left", fontsize=11)
        ax.axis("off")

        ax = riadok[1]
        oblak(ax, rel[:, 1], rel[:, 2])
        dlzka = np.linalg.norm(stred[1:]) * 1.25
        ton = stred[1:] / np.linalg.norm(stred[1:])
        ax.plot([0, ton[0] * dlzka], [0, ton[1] * dlzka], color=ATRAMENT2, lw=1, ls="--", zorder=3)
        ax.plot(*elipsa(stred[1:], kov[1:, 1:]).T, color=MODRA, lw=1.4, zorder=4)
        cisla, v = vlastne(kov[1:, 1:])
        nakresli_os(ax, stred[1:], v[:, 1], 2 * math.sqrt(cisla[1]), MODRA_SVETLA, 2)
        nakresli_os(ax, stred[1:], v[:, 0], 2 * math.sqrt(cisla[0]), MODRA_TMAVA, 2.4)
        rozsah(ax, rel[:, 1], rel[:, 2])
        ax.set_aspect("equal", adjustable="datalim")
        ax.set_xlabel("červenosť Δa*")
        ax.set_ylabel("žltosť Δb*")
        ax.set_title(f"rovina ab: smer hlavnej osi {smer_osi(*v[:, 0]):.0f}° (tón {smer_osi(*stred[1:]):.0f}°), "
                     f"λ2/λ1 = {c['pca_ab_pomer']:.2f}".replace(".", ","), loc="left", fontsize=9)

        ax = riadok[2]
        P = rovina_jas_sytost(stred)
        body, s2, k2 = rel @ P.T, P @ stred, P @ kov @ P.T
        oblak(ax, body[:, 0], body[:, 1])
        ax.plot(*elipsa(s2, k2).T, color=MODRA, lw=1.4, zorder=4)
        cisla3, v3 = vlastne(kov)
        os1 = P @ v3[:, 0]
        nakresli_os(ax, s2, os1, 2 * math.sqrt(cisla3[0]), MODRA_TMAVA, 2.4)
        ax.axvline(s2[0], color=ATRAMENT2, lw=0.8, ls=":", zorder=3)
        rozsah(ax, body[:, 0], body[:, 1])
        ax.set_aspect("equal", adjustable="datalim")
        ax.set_xlabel("sýtosť v smere tónu škvrny")
        ax.set_ylabel("jas ΔL*")
        ax.set_title(f"Lab: sklon hlavnej osi od osi jasu {c['pca_lab_sklon']:.0f}°, "
                     f"λ2/λ1 = {c['pca_lab_pomer21']:.2f}".replace(".", ","), loc="left", fontsize=9)
    legenda = [Line2D([], [], color=MODRA_TMAVA, lw=2.4, label="hlavná os (1. vlastný vektor, ±2√λ1)"),
               Line2D([], [], color=MODRA_SVETLA, lw=2, label="2. vlastný vektor"),
               Line2D([], [], color=MODRA, lw=1.4, label="elipsa 2 smerodajných odchýlok"),
               Line2D([], [], color=ATRAMENT2, lw=1, ls="--", label="smer od papiera k priemeru (tón)"),
               Line2D([], [], color=ATRAMENT2, lw=0.8, ls=":", label="os jasu")]
    fig.legend(handles=legenda, loc="upper left", bbox_to_anchor=(0.01, 0.985), ncol=3, frameon=False, fontsize=8)
    fig.suptitle("PCA farieb pixelov škvrny: farba každého pixelu voči papieru, hustota pixelov (modrá = viac)",
                 x=0.01, ha="left", fontsize=12, y=1.0)
    fig.tight_layout(rect=(0, 0, 1, 0.965))
    fig.savefig(cesta)
    plt.close(fig)


def graf_elipsy(crty, struktura, rovina, cesta):
    df = crty[(crty.maska == "auto") & (crty.cast == "train")]
    druhy = poradie_druhov(struktura)
    tmave = set(struktura["skupiny"]["tmave"])
    elipsy, stredy = {}, {}
    for _, r in df.iterrows():
        stred, kov = kovariancia(r)
        P = rovina_jas_sytost(stred) if rovina == "jas" else np.array([[0.0, 1, 0], [0, 0, 1]])
        elipsy.setdefault(r.druh, []).append(elipsa(P @ stred, P @ kov @ P.T))
        stredy.setdefault(r.druh, []).append(P @ stred)
    riadky, stlpce, sirka = (2, 6, 15) if rovina == "ab" else (3, 4, 13)
    rady = [druhy[r * stlpce:(r + 1) * stlpce] for r in range(riadky)]
    x = np.r_[np.vstack([e for zoznam in elipsy.values() for e in zoznam])[:, 0], 0]
    x0, x1 = x.min() - 2, x.max() + 2
    limity = []
    for rad in rady:
        y = np.r_[np.vstack([e for d in rad for e in elipsy[d]])[:, 1], 0]
        limity.append((y.min() - 2, y.max() + 2))
    vysky = [y1 - y0 for y0, y1 in limity]
    vyska = sum(vysky) / (x1 - x0) * (sirka - 1.2) / stlpce + 0.75 * riadky + 1.3
    fig, osi = plt.subplots(riadky, stlpce, figsize=(sirka, vyska), sharex=True, sharey="row",
                            gridspec_kw={"height_ratios": vysky})
    for r in range(riadky):
        osi[r, 0].set_ylim(*limity[r])
    for ax, druh in zip(osi.ravel(), druhy):
        ax.set_aspect("equal", adjustable="box")
        ostatne = np.vstack([s for d, zoznam in stredy.items() if d != druh for s in zoznam])
        ax.scatter(ostatne[:, 0], ostatne[:, 1], s=5, color=KONTEXT, lw=0, zorder=1)
        farba = TMAVE if druh in tmave else "#c99a04"
        ax.add_collection(LineCollection(elipsy[druh], colors=farba, linewidths=0.7, alpha=0.55, zorder=3))
        ax.scatter([0], [0], marker="x", s=30, color=ATRAMENT, lw=1.1, zorder=4)
        d = df[df.druh == druh]
        if rovina == "jas":
            popis = f"sklon {d.pca_lab_sklon.median():.0f}° · λ2/λ1 {d.pca_lab_pomer21.median():.2f}"
        else:
            popis = f"smer {d.pca_ab_smer.median() % 180:.0f}° · λ2/λ1 {d.pca_ab_pomer.median():.2f}"
        ax.set_title(f"{druh}\n{popis.replace('.', ',')}", loc="left", fontsize=9.5)
        ax.grid(True)
        ax.set_axisbelow(True)
    osi[0, 0].set_xlim(x0, x1)
    if rovina == "jas":
        for ax in osi[-1]:
            ax.set_xlabel("sýtosť v smere tónu škvrny")
        for ax in osi[:, 0]:
            ax.set_ylabel("jas ΔL*")
        nadpis = ("Farby pixelov v rovine jas × sýtosť: elipsa = 2 smerodajné odchýlky pixelov jednej škvrny "
                  "(train, automatická maska)\nzvislá elipsa = pixely sa líšia jasom, vodorovná = sýtosťou; "
                  "× = papier; sivé body = priemery škvŕn ostatných druhov")
    else:
        for ax in osi[-1]:
            ax.set_xlabel("červenosť Δa*")
        for ax in osi[:, 0]:
            ax.set_ylabel("žltosť Δb*")
        nadpis = ("Farby pixelov v rovine ab: elipsa = 2 smerodajné odchýlky pixelov jednej škvrny "
                  "(train, automatická maska)\nelipsy smerujú k papieru (×): hlavná os v ab väčšinou "
                  "opakuje tón škvrny; sivé body = priemery škvŕn ostatných druhov")
    fig.suptitle(nadpis, x=0.01, ha="left", fontsize=11)
    fig.tight_layout(rect=(0, 0, 1, 0.955))
    fig.savefig(cesta)
    plt.close(fig)


def graf_crty_druhov(crty, struktura, sila, cesta):
    df = crty[(crty.maska == "auto") & (crty.cast == "train")]
    druhy = poradie_druhov(struktura)[::-1]
    tmave = set(struktura["skupiny"]["tmave"])
    zobrazene = ["pca_lab_sklon", "pca_lab_odchylka", "pca_lab_pomer21", "pca_ab_smer", "pca_ab_pomer",
                 "pca_rgb_sklon"]
    rng = np.random.default_rng(0)
    fig, osi = plt.subplots(2, 3, figsize=(14, 9), sharey=True)
    for ax, c in zip(osi.ravel(), zobrazene):
        for y, druh in enumerate(druhy):
            hodnoty = df.loc[df.druh == druh, c].to_numpy()
            ax.scatter(hodnoty, y + rng.uniform(-0.22, 0.22, len(hodnoty)), s=11, lw=0, alpha=0.75,
                       color=TMAVE if druh in tmave else SVETLE, zorder=2)
            ax.plot([np.median(hodnoty)] * 2, [y - 0.34, y + 0.34], color=ATRAMENT, lw=1.8, zorder=3)
        ax.set_yticks(range(len(druhy)), druhy)
        ax.tick_params(axis="y", length=0)
        ax.set_xlabel("pomer vlastných čísel" if "pomer" in c else "uhol (°)")
        ax.set_title(f"{POPISY[c]}\neta² = {sila.loc[c, 'auto']:.2f}".replace(".", ","), loc="left", fontsize=9.5)
        os_grafu(ax)
    legenda = [Line2D([], [], marker="o", ls="", color=TMAVE, label="tmavé – do hneda"),
               Line2D([], [], marker="o", ls="", color=SVETLE, label="svetlé – do žlta"),
               Line2D([], [], color=ATRAMENT, lw=1.8, label="medián druhu")]
    fig.legend(handles=legenda, loc="upper left", bbox_to_anchor=(0.01, 0.955), ncol=3, frameon=False, fontsize=8.5)
    fig.suptitle("PCA črty škvŕn po druhoch (trénovacie fotky, automatická maska); eta² = sila rozlíšenia "
                 "druhov na mediánoch kartičiek", x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(cesta)
    plt.close(fig)


def priestor(crta):
    return next(p for p, zoznam in PRIESTORY.items() if crta in zoznam)


def graf_sila(sila, doterajsia, nadbytok, cesta):
    poradie = sila["auto"].sort_values().index
    y = np.arange(len(poradie))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 6.2), sharey=True, gridspec_kw={"width_ratios": [1.1, 1]})
    ax1.barh(y, sila.loc[poradie, "auto"], color=[FARBY_PRIESTOROV[priestor(c)] for c in poradie], height=0.68)
    for yi, c in enumerate(poradie):
        ax1.text(sila.loc[c, "auto"] + 0.01, yi, f"{sila.loc[c, 'auto']:.2f}".replace(".", ","), va="center",
                 fontsize=7.5, color=ATRAMENT2)
    najlepsia = doterajsia.idxmax()
    ax1.axvline(doterajsia.max(), color=ATRAMENT, lw=1, ls="--")
    ax1.axvline(doterajsia.median(), color=ATRAMENT2, lw=1, ls=":")
    ax1.text(doterajsia.max(), len(poradie) - 0.3, f" najsilnejšia doterajšia\n {najlepsia}", fontsize=7.5,
             va="bottom", color=ATRAMENT)
    ax1.text(doterajsia.median(), -0.9, f"medián 46 doterajších čŕt ", fontsize=7.5, ha="right", color=ATRAMENT2)
    ax1.set_yticks(y, [POPISY[c] for c in poradie])
    ax1.set_xlim(0, 1)
    ax1.set_ylim(-1.3, len(poradie) + 0.6)
    ax1.set_xlabel("eta² (sila rozlíšenia druhov, Kruskal-Wallis na mediánoch kartičiek)")
    ax1.set_title("Ako dobre PCA črty odlišujú druhy", loc="left", fontsize=10.5)
    ax1.tick_params(axis="y", length=0)
    os_grafu(ax1)
    fig.legend(handles=[Line2D([], [], color=f, lw=6, label=f"PCA v {p}") for p, f in FARBY_PRIESTOROV.items()],
               loc="upper left", bbox_to_anchor=(0.01, 0.955), ncol=3, frameon=False, fontsize=8.5)

    ax2.barh(y, nadbytok.loc[poradie, "r2"].clip(lower=0), color=MODRA_SVETLA, height=0.68)
    for yi, c in enumerate(poradie):
        r = nadbytok.loc[c]
        ax2.text(max(r.r2, 0) + 0.01, yi, f"R² {r.r2:.2f} · najpodobnejšia {r.najpodobnejsia} (|ρ| {r.rho:.2f})"
                 .replace(".", ","), va="center", fontsize=7.5, color=ATRAMENT2)
    ax2.set_xlim(0, 1.6)
    ax2.set_xticks(np.linspace(0, 1, 6))
    ax2.set_xlabel("R² odhadu PCA črty zo 46 doterajších čŕt (náhodný les, krížová validácia)")
    ax2.set_title("Koľko z nej už obsahujú doterajšie črty", loc="left", fontsize=10.5)
    os_grafu(ax2)
    fig.suptitle("Sila a nadbytočnosť PCA čŕt (trénovacia množina, automatická maska)", x=0.01, ha="left",
                 fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    fig.savefig(cesta)
    plt.close(fig)


def graf_masky(sila, zhoda, odchylky, cesta):
    poradie = sila["auto"].sort_values().index
    y = np.arange(len(poradie))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 6.2), sharey=True, gridspec_kw={"width_ratios": [1.1, 1]})
    for maska, (znak, farba) in ZNACKY_MASIEK.items():
        ax1.scatter(sila.loc[poradie, maska], y, s=30, marker=znak, color=farba, edgecolors=POVRCH, lw=0.6,
                    label=MASKY[maska], zorder=3)
    for yi, c in enumerate(poradie):
        hodnoty = sila.loc[c, list(MASKY)]
        ax1.plot([hodnoty.min(), hodnoty.max()], [yi, yi], color=KONTEXT, lw=1.2, zorder=2)
    ax1.set_yticks(y, [POPISY[c] for c in poradie])
    ax1.set_xlim(0, 1)
    ax1.set_xlabel("eta² (trénovacia množina, mediány kartičiek)")
    ax1.set_title("Sila PCA čŕt podľa masky", loc="left", fontsize=10.5)
    ax1.tick_params(axis="y", length=0)
    ax1.legend(loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=3, frameon=False, fontsize=8)
    os_grafu(ax1)

    sirka = 0.36
    ax2.barh(y + sirka / 2, zhoda.loc[poradie, "rucna"], height=sirka, color="#0d366b",
             label="automatická vs. ručná maska")
    ax2.barh(y - sirka / 2, zhoda.loc[poradie, "jadro"], height=sirka, color=MODRA_SVETLA,
             label="automatická maska vs. jej jadro")
    ax2.set_xlim(0, 1)
    ax2.set_xlabel("zhoda hodnôt črty na tých istých fotkách (Spearmanovo ρ)")
    ax2.set_title("Ako veľmi črta závisí od masky", loc="left", fontsize=10.5)
    ax2.legend(loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=2, frameon=False, fontsize=8)
    os_grafu(ax2)
    text = " · ".join(f"{MASKY[m].split(' (')[0]} {odchylky[m]:.0f}°" for m in MASKY)
    fig.suptitle("Vplyv segmentácie na PCA farieb pixelov\nmedián odchýlky hlavnej osi v rovine ab od tónu "
                 f"škvrny: {text}".replace(".", ","), x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(cesta)
    plt.close(fig)


def graf_klasifikatory(tabulka, kluc_cv, kluc_test, cesta):
    sady = list(dict.fromkeys(tabulka.sada))[::-1]
    modely = {"logistická regresia": ("o", MODRA), "náhodný les": ("s", MODRA_TMAVA)}
    fig, osi = plt.subplots(1, 2, figsize=(13, 5.4), sharey=True)
    for ax, maska in zip(osi, ("auto", "rucna")):
        for k, (model, (znak, farba)) in enumerate(modely.items()):
            posun = 0.17 if k == 0 else -0.17
            for yi, sada in enumerate(sady):
                t = tabulka[(tabulka.maska == maska) & (tabulka.sada == sada) & (tabulka.model == model)]
                cv = t[t.cast == "train_cv"].uspesnost
                test = t[t.cast == "test"].uspesnost.iloc[0]
                ax.errorbar(cv.mean(), yi + posun, xerr=cv.std(), fmt=znak, color=farba, ms=6, capsize=2.5, lw=1.2,
                            zorder=3)
                ax.scatter(test, yi + posun, marker="D", s=26, facecolors=POVRCH, edgecolors=farba, lw=1.3, zorder=4)
                ax.text(0.505, yi + posun, f"{cv.mean():.1%}".replace(".", ","), va="center", fontsize=7,
                        color=farba)
        if maska == "auto":
            ax.axvline(kluc_cv, color=ATRAMENT2, lw=1, ls="--", zorder=1)
            ax.axvline(kluc_test, color=ATRAMENT2, lw=1, ls=":", zorder=1)
            ax.text(kluc_cv, len(sady) - 0.35, " kľúč – CV", fontsize=7.5, color=ATRAMENT2)
            ax.text(kluc_test, len(sady) - 0.35, "kľúč – test ", fontsize=7.5, color=ATRAMENT2, ha="right")
        ax.set_yticks(range(len(sady)), sady)
        ax.set_xlim(0.5, 1.0)
        ax.set_ylim(-0.6, len(sady) - 0.1)
        ax.xaxis.set_major_formatter(PercentFormatter(1.0))
        ax.set_xlabel("podiel správne určených fotiek")
        ax.set_title(MASKY[maska] + (" (aj doterajšie črty z nej)" if maska == "rucna" else ""), loc="left",
                     fontsize=10.5)
        ax.tick_params(axis="y", length=0)
        os_grafu(ax)
    legenda = [Line2D([], [], marker=z, ls="", color=f, label=f"{m} – krížová validácia (priemer ± sm. odch., "
                      f"{OPAKOVANIA} rozdelení)") for m, (z, f) in modely.items()]
    legenda += [Line2D([], [], marker="D", ls="", markerfacecolor=POVRCH, markeredgecolor=ATRAMENT2, label="test")]
    fig.legend(handles=legenda, loc="upper center", bbox_to_anchor=(0.5, 0.02), ncol=3, frameon=False, fontsize=8)
    fig.suptitle("Koľko informácie o druhu nesú PCA črty: bežné klasifikátory s doterajšími črtami, s PCA a len "
                 "s PCA", x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0.03, 1, 0.95))
    fig.savefig(cesta)
    plt.close(fig)


def graf_otazky(porovnanie, vnorena, test, cesta):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6.4), gridspec_kw={"width_ratios": [2.6, 1]})
    y = np.arange(len(porovnanie))[::-1]
    pruhy = (("aktualna", "aktuálna otázka", MODRA_SVETLA), ("pca_sama", "samotná PCA črta", MODRA),
             ("s_pca", "najlepšia otázka s PCA črtou", MODRA_TMAVA))
    vyska = 0.26
    for k, (stlpec, popis, farba) in enumerate(pruhy):
        hodnoty = porovnanie[f"{stlpec}_cv"].to_numpy()
        yk = y + (1 - k) * vyska
        ax1.barh(yk, hodnoty, height=vyska * 0.92, color=farba, label=popis)
        for yi, v, nazov in zip(yk, hodnoty, porovnanie[stlpec]):
            ax1.text(v + 0.004, yi, f"{v:.1%} · {nazov}".replace(".", ",", 1), va="center", fontsize=6.8,
                     color=ATRAMENT2)
    ax1.set_yticks(y, [f"{r.otazka}: {r.druh}" for r in porovnanie.itertuples()])
    ax1.set_xlim(0.5, 1.32)
    ax1.set_xticks(np.linspace(0.5, 1.0, 6))
    ax1.xaxis.set_major_formatter(PercentFormatter(1.0))
    ax1.set_xlabel("úspešnosť otázky (priemer cez druhy), krížová validácia po kartičkách na train")
    ax1.set_title("Otázky vetiev kľúča", loc="left", fontsize=10.5)
    ax1.tick_params(axis="y", length=0)
    ax1.legend(loc="lower right", frameon=False, fontsize=8)
    os_grafu(ax1)

    varianty = ["aktuálny kľúč", "kľúč s PCA"]
    rozdiel = podiel_po_rozdeleniach(vnorena, varianty[1]) - podiel_po_rozdeleniach(vnorena, varianty[0])
    for xi, variant in enumerate(varianty):
        podiely = podiel_po_rozdeleniach(vnorena, variant)
        ax2.scatter(np.full(len(podiely), xi) + np.linspace(-0.12, 0.12, len(podiely)), podiely, s=18,
                    color=MODRA_SVETLA, zorder=2)
        ax2.plot([xi - 0.22, xi + 0.22], [podiely.mean()] * 2, color=MODRA_TMAVA, lw=2.2, zorder=3)
        ax2.text(xi + 0.25, podiely.mean(), f"{podiely.mean():.1%}".replace(".", ","), va="center", fontsize=8,
                 color=MODRA_TMAVA)
        ax2.scatter([xi], [test[variant]], marker="D", s=40, facecolors=POVRCH, edgecolors=ATRAMENT, lw=1.3, zorder=4)
        ax2.text(xi + 0.25, test[variant], f"test {test[variant]:.1%}".replace(".", ","), va="center", fontsize=8)
    ax2.set_xticks(range(len(varianty)), varianty)
    ax2.set_xlim(-0.5, len(varianty) - 0.2)
    ax2.set_ylim(0.65, 0.85)
    ax2.set_yticks(np.linspace(0.65, 0.85, 5))
    ax2.yaxis.set_major_formatter(PercentFormatter(1.0, decimals=0))
    ax2.set_ylabel("podiel správne určených fotiek")
    ax2.set_title(f"Celý kľúč (vnorená krížová validácia)\nrozdiel s PCA {rozdiel.mean() * 100:+.1f} p. b., "
                  f"lepší v {(rozdiel > 0).sum()} z {len(rozdiel)} rozdelení".replace(".", ",", 1).replace("-", "−"),
                  loc="left", fontsize=10.5)
    os_grafu(ax2, "y")
    legenda = [Line2D([], [], marker="o", ls="", color=MODRA_SVETLA, label="jedno rozdelenie na foldy"),
               Line2D([], [], color=MODRA_TMAVA, lw=2.2, label="priemer"),
               Line2D([], [], marker="D", ls="", markerfacecolor=POVRCH, markeredgecolor=ATRAMENT, label="test")]
    ax2.legend(handles=legenda, loc="upper center", bbox_to_anchor=(0.5, -0.1), ncol=2, frameon=False, fontsize=7.5)
    fig.suptitle("Pomôžu PCA črty určovaciemu kľúču? Otázka sa nahradí, ak je s PCA črtou v krížovej validácii "
                 f"lepšia aspoň o {ZLEPSENIE * 100:.0f} percentuálny bod", x=0.01, ha="left", fontsize=12)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(cesta)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="PCA farieb pixelov škvrny a jej prínos pre určenie druhu.")
    parser.add_argument("--fotky", type=Path, default=Path("images/D2"))
    parser.add_argument("--masky", type=Path, default=Path("images/D2/masky"), help="automatické masky (<fotka>.png)")
    parser.add_argument("--rucne", type=Path, default=Path("images/D2masks"), help="ručné masky (<fotka>.png)")
    parser.add_argument("--vystup", type=Path, default=PRIECINOK / "vysledky_pca")
    args = parser.parse_args()
    args.vystup.mkdir(parents=True, exist_ok=True)

    crty = vypocitaj_crty(nacitaj_rozdelenie(), args.fotky, args.masky, args.rucne)
    crty.to_csv(args.vystup / "crty.csv", index=False)
    struktura = nacitaj(STRUKTURA)
    doterajsie = [c for c in crty.columns if c not in ("fotka", "vzorka", "druh", "cast", "maska")
                  and not c.startswith(("pca_", "stred_", "kov_"))]
    train = {m: crty[(crty.maska == m) & (crty.cast == "train")].reset_index(drop=True) for m in MASKY}
    test = crty[(crty.maska == "auto") & (crty.cast == "test")].reset_index(drop=True)

    sila = pd.DataFrame({m: eta2(train[m], PCA_CRTY) for m in MASKY})
    doterajsia = eta2(train["auto"], doterajsie)
    nadbytok = nadbytocnost(train["auto"], doterajsie)
    zhoda = zhoda_masiek(train)
    odchylky = {m: float(train[m].pca_ab_odchylka.median()) for m in MASKY}
    pd.concat([sila.add_prefix("eta2_"), zhoda.add_prefix("zhoda_s_auto_"), nadbytok], axis=1) \
        .to_csv(args.vystup / "sila_crt.csv")

    print("klasifikátory:")
    tabulka = klasifikatory(crty, doterajsie)
    tabulka.to_csv(args.vystup / "klasifikatory.csv", index=False)

    print("otázky kľúča")
    porovnanie = porovnanie_otazok(train["auto"], struktura)
    porovnanie.to_csv(args.vystup / "otazky_kluca.csv", index=False)
    vnorena = vnorena_validacia(train["auto"], struktura)
    vnorena.to_csv(args.vystup / "kluc_vnorena_validacia.csv", index=False)
    struktura_pca = kluc_s_pca(train["auto"], struktura)
    (args.vystup / "struktura_kluca_s_pca.json").write_text(json.dumps(struktura_pca, ensure_ascii=False, indent=1),
                                                            encoding="utf-8")
    vysledky_testu = {v: float((vyhodnot(nauc_kluc(s, train["auto"]), test).vysledok == "urceny").mean())
                      for v, s in (("aktuálny kľúč", struktura), ("kľúč s PCA", struktura_pca))}
    kluc_cv = float(podiel_po_rozdeleniach(vnorena, "aktuálny kľúč").mean())

    graf_princip(crty, args.fotky, args.masky, args.vystup / "01_princip.png")
    graf_elipsy(crty, struktura, "ab", args.vystup / "02_elipsy_ab.png")
    graf_elipsy(crty, struktura, "jas", args.vystup / "03_elipsy_jas_sytost.png")
    graf_crty_druhov(crty, struktura, sila, args.vystup / "04_crty_druhov.png")
    graf_sila(sila, doterajsia, nadbytok, args.vystup / "05_sila_crt.png")
    graf_masky(sila, zhoda, odchylky, args.vystup / "06_vplyv_masky.png")
    graf_klasifikatory(tabulka, kluc_cv, vysledky_testu["aktuálny kľúč"], args.vystup / "07_klasifikatory.png")
    graf_otazky(porovnanie, vnorena, vysledky_testu, args.vystup / "08_otazky_kluca.png")
    vypis(sila, doterajsia, nadbytok, zhoda, odchylky, tabulka, porovnanie, vnorena, vysledky_testu, struktura_pca)
    print(f"\nVýstupy sú v {args.vystup}")


def vypis(sila, doterajsia, nadbytok, zhoda, odchylky, tabulka, porovnanie, vnorena, vysledky_testu, struktura_pca):
    print(f"\neta² (train, mediány kartičiek); najsilnejšia doterajšia črta {doterajsia.idxmax()} "
          f"{doterajsia.max():.3f}, medián doterajších {doterajsia.median():.3f}")
    for c in sila["auto"].sort_values(ascending=False).index:
        r = nadbytok.loc[c]
        print(f"  {c:18s} ručná {sila.loc[c, 'rucna']:.3f}  auto {sila.loc[c, 'auto']:.3f}  jadro "
              f"{sila.loc[c, 'jadro']:.3f} | R² z doterajších {r.r2:.2f}, najpodobnejšia {r.najpodobnejsia} "
              f"(|ρ| {r.rho:.2f}) | zhoda auto~ručná {zhoda.loc[c, 'rucna']:.2f}")
    print("medián odchýlky hlavnej osi v ab od tónu: " + ", ".join(f"{m} {v:.1f}°" for m, v in odchylky.items()))
    print("\nklasifikátory (krížová validácia priemer ± sm. odch. / test):")
    for (maska, sada, model), t in tabulka.groupby(["maska", "sada", "model"], sort=False):
        cv = t[t.cast == "train_cv"].uspesnost
        print(f"  {maska:5s} {sada:22s} {model:20s} {cv.mean():.3f} ± {cv.std():.3f} / "
              f"{t[t.cast == 'test'].uspesnost.iloc[0]:.3f}")
    print("\notázky kľúča (krížová validácia na train):")
    for r in porovnanie.itertuples():
        print(f"  {r.otazka} {r.druh:15s} aktuálna {r.aktualna_cv:.3f} ({r.aktualna}) | samotná PCA "
              f"{r.pca_sama_cv:.3f} ({r.pca_sama}) | s PCA {r.s_pca_cv:.3f} ({r.s_pca})")
    print("\ncelý kľúč, vnorená krížová validácia:")
    for variant in ("aktuálny kľúč", "kľúč s PCA"):
        podiely = podiel_po_rozdeleniach(vnorena, variant)
        print(f"  {variant:14s} {podiely.mean():.3f} ± {podiely.std():.3f} (rozdelenia: "
              f"{', '.join(f'{p:.3f}' for p in podiely)}) | test {vysledky_testu[variant]:.3f}")
    print("otázky kľúča s PCA (naučené na celom train): " +
          "; ".join(f"{z} {' + '.join(o['crty'])}" for z, _, _, o in otazky(struktura_pca)))


if __name__ == "__main__":
    main()
