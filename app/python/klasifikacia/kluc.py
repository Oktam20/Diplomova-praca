"""Určovací kľúč: učenie prahov z dát a určenie škvrny.

Štruktúra kľúča (struktura_kluca.json) je výsledok analýzy čŕt: skupiny druhov, poradie otázok
a ich črty. Z dát sa učia len prahy. Kľúč sa pýta postupne:
  1. jas voči papieru: tmavé / svetlé (v neistej zóne okolo prahu rozhodne sýtosť),
  2. tmavé: otázky vetvy "tmave" až po druh,
  3. svetlé: tón (do červena / stred / do žlta), stred podľa hrubej textúry (Gabor),
     hladké baktérie otázkami vetvy "stred_hladke".
Otázka má jednu črtu (prah) alebo dvojicu čŕt (deliaca priamka v rovine dvoch štandardizovaných čŕt).
"""
import copy
import json

import numpy as np

UHOL_KROK = 6

NAZVY_CRT = {
    "farba_dL_mean": "jas voči papieru",
    "farba_chroma": "sýtosť",
    "farba_odtien_deg": "tón",
    "farba_dL_std": "rozptyl jasu",
    "farba_dL_p10": "jas najtmavšej časti (p10)",
    "farba_db_p50": "žltosť (medián)",
    "farba_db_p90": "žltosť najžltšej časti (p90)",
    "halo_da": "červenosť lemu",
    "lbp_P8R1_9": "zrnitosť (LBP)",
    "gabor_l32_odozva": "hrubá textúra",
}
KANAL = {"dL": "jas", "da": "červenosť", "db": "žltosť"}


def nacitaj(cesta):
    with open(cesta, encoding="utf-8") as subor:
        return json.load(subor)


def prah_pre_skupiny(hodnoty, druhy, skupina, smer=1):
    """Prah, pri ktorom je priemerný podiel fotiek na správnej strane (cez druhy) najvyšší.

    Druhy zo skupiny majú byť na strane "≤ prah" (pri smer = -1 na strane "> prah"). -> (prah, skóre)
    """
    ok = np.isfinite(hodnoty)
    v, y = smer * hodnoty[ok], druhy[ok]
    zoznam = sorted(set(y))
    poradie = np.argsort(v)
    zoradene = v[poradie]
    jednotky = (y[poradie][:, None] == np.array(zoznam)[None, :]).astype(float)
    pod_prahom = np.cumsum(jednotky, axis=0)
    spolu = jednotky.sum(axis=0)
    v_skupine = np.isin(zoznam, list(skupina))
    spravne = np.where(v_skupine[None, :], pod_prahom, spolu[None, :] - pod_prahom) / spolu[None, :]
    skore = spravne.mean(axis=1)
    skore[~np.r_[zoradene[1:] != zoradene[:-1], False]] = -1
    i = int(np.argmax(skore))
    return smer * float((zoradene[i] + zoradene[i + 1]) / 2), float(skore[i])


def nauc_dvojicu(X, druhy, druh):
    """Deliaca priamka pre dve črty: najlepší uhol (po UHOL_KROK °) a prah pre druh vs. ostatné."""
    stred, mierka = np.nanmean(X, axis=0), np.nanstd(X, axis=0)
    mierka[mierka == 0] = 1
    Z = (X - stred) / mierka
    najlepsia = None
    for uhol in range(0, 180, UHOL_KROK):
        u = np.deg2rad(uhol)
        p = np.cos(u) * Z[:, 0] + np.sin(u) * Z[:, 1]
        for smer in (1, -1):
            prah, skore = prah_pre_skupiny(p, druhy, {druh}, smer)
            if najlepsia is None or skore > najlepsia["skore"]:
                najlepsia = {"stred": stred.tolist(), "mierka": mierka.tolist(), "uhol": uhol, "prah": prah,
                             "smer": smer, "mierka_zony": float(np.nanstd(p)) or 1.0, "skore": skore}
    return najlepsia


def okraj_dvojice(otazka, x):
    """Vzdialenosť od deliacej priamky (> 0 = strana druhu otázky)."""
    z = (np.asarray(x, float) - otazka["stred"]) / np.asarray(otazka["mierka"])
    u = np.deg2rad(otazka["uhol"])
    p = np.cos(u) * z[..., 0] + np.sin(u) * z[..., 1]
    return otazka["smer"] * (otazka["prah"] - p) / otazka["mierka_zony"]


def druhy_v_otazke(otazky, i):
    """Druhy, ktoré ešte môžu prísť k i-tej otázke vetvy (jej druh, ďalšie otázky a posledné "inak")."""
    druhy = [o["druh"] for o in otazky[i:]]
    return druhy + [otazky[-1]["inak"]] if "inak" in otazky[-1] else druhy


def posun_tonu(ton, ton_od):
    """Tón v rozsahu [ton_od, ton_od + 360) – kruh je rozstrihnutý v medzere medzi svetlými škvrnami."""
    return (np.asarray(ton) - ton_od) % 360 + ton_od


def nauc_kluc(struktura, crty):
    """Kľúč so všetkými prahmi naučenými z tabuľky čŕt (stĺpec druh + črty)."""
    kluc = copy.deepcopy(struktura)
    y = crty.druh.to_numpy()
    tmave = set(kluc["skupiny"]["tmave"])

    jas = crty[kluc["jas"]["crta"]].to_numpy(float)
    prah_jasu = kluc["jas"]["prah"] = prah_pre_skupiny(jas, y, tmave)[0]
    zona = kluc["jas"]["neista_zona"]
    blizko = np.abs(jas - prah_jasu) <= zona
    if not (set(y[blizko]) & tmave and set(y[blizko]) - tmave):
        blizko[:] = True
    kluc["sytost"]["prah"] = prah_pre_skupiny(crty[kluc["sytost"]["crta"]].to_numpy(float)[blizko], y[blizko], tmave)[0]

    svetle = np.isin(y, kluc["skupiny"]["svetle"])
    ton = posun_tonu(crty[kluc["ton"]["crta"]].to_numpy(float)[svetle], kluc["ton"]["ton_od"])
    pod = kluc["ton"]["podskupiny"]
    kluc["ton"]["prah_cervena"] = prah_pre_skupiny(ton, y[svetle], set(pod["do_cervena"]))[0]
    kluc["ton"]["prah_zlta"] = prah_pre_skupiny(ton, y[svetle], set(pod["do_cervena"]) | set(pod["stred"]))[0]

    textura = kluc["textura"]
    stred = np.isin(y, textura["nad_prahom"] + textura["pod_prahom"])
    hodnoty = crty[textura["crta"]].to_numpy(float)[stred]
    textura["prah"] = prah_pre_skupiny(hodnoty, y[stred], set(textura["pod_prahom"]))[0]

    for vetva, otazky in kluc["vetvy"].items():
        for i, otazka in enumerate(otazky):
            vyber = np.isin(y, druhy_v_otazke(otazky, i))
            if otazka.get("len_fotky_vetvy"):
                vyber &= jas <= prah_jasu + zona if vetva == "tmave" else jas > prah_jasu - zona
            X = crty[otazka["crty"]].to_numpy(float)
            vyber &= np.isfinite(X).all(axis=1)
            if len(otazka["crty"]) == 2:
                otazka.update(nauc_dvojicu(X[vyber], y[vyber], otazka["druh"]))
            else:
                smer = 1 if otazka["smer"] == "<=" else -1
                otazka["prah"] = prah_pre_skupiny(X[vyber, 0], y[vyber], {otazka["druh"]}, smer)[0]
    return kluc


def cislo(v, miest=1):
    return f"{v:.{miest}f}".replace(".", ",").replace("-", "−")


def nazov_crty(crta):
    """Zrozumiteľný názov črty (zóna 0 = okraj škvrny, zóna 3 = stred)."""
    if crta in NAZVY_CRT:
        return NAZVY_CRT[crta]
    if crta.startswith("zona_stred_minus_okraj_"):
        return f"{KANAL[crta[-2:]]} stred − okraj"
    if crta.startswith("zona"):
        return f"{KANAL[crta[-2:]]} zóny {crta[4]}"
    return crta


def vetva(nazov, crty, kluc, cesta):
    """Otázky vetvy postupne; splnená otázka určí druh. -> [druh] alebo None (chýba črta / žiadna)."""
    otazky = kluc["vetvy"][nazov]
    znak = "T" if nazov == "tmave" else "B"
    for i, o in enumerate(otazky):
        hodnoty = [crty.get(c, np.nan) for c in o["crty"]]
        if not np.all(np.isfinite(hodnoty)):
            return None
        otazka = f"{znak}{i + 1}. {kluc['druhy'][o['druh']]}"
        if len(o["crty"]) == 2:
            okraj = float(okraj_dvojice(o, hodnoty))
            ano = okraj > 0
            popis = ", ".join(f"{nazov_crty(c)} {cislo(v)}" for c, v in zip(o["crty"], hodnoty))
            popis += f" · vzdialenosť od hranice {cislo(okraj)}"
        else:
            v = hodnoty[0]
            ano = v <= o["prah"] if o["smer"] == "<=" else v > o["prah"]
            popis = f"{nazov_crty(o['crty'][0])} {cislo(v)} {'≤' if v <= o['prah'] else '>'} {cislo(o['prah'])}"
        if ano:
            cesta.append({"otazka": otazka, "popis": popis, "vysledok": kluc["druhy"][o["druh"]]})
            return [o["druh"]]
        if i == len(otazky) - 1 and "inak" in o:
            cesta.append({"otazka": otazka, "popis": popis, "vysledok": kluc["druhy"][o["inak"]]})
            return [o["inak"]]
        cesta.append({"otazka": otazka, "popis": popis, "vysledok": "nie – ďalej"})
    return None


def urci(crty, kluc, textura=None):
    """Zaradenie škvrny kľúčom -> skupina, podskupina, možné druhy, určený druh a cesta kľúčom.

    textura: funkcia, ktorá dopočíta Gaborovu črtu, ak ju črty nemajú (počíta sa len pri strede).
    """
    cesta = []
    nazvy = kluc["nazvy_skupin"]
    jas, k_jas = crty.get(kluc["jas"]["crta"], np.nan), kluc["jas"]
    if not np.isfinite(jas):
        return {"skupina": None, "nazov": "nedá sa určiť (chýba hodnota črty)", "podskupina": None,
                "druhy": [], "druh": None, "cesta": cesta}

    if abs(jas - k_jas["prah"]) > k_jas["neista_zona"]:
        skupina = "tmave" if jas <= k_jas["prah"] else "svetle"
        cesta.append({"otazka": "1. jas", "vysledok": nazvy[skupina],
                      "popis": f"{nazov_crty(k_jas['crta'])} {cislo(jas)} {'≤' if jas <= k_jas['prah'] else '>'} "
                               f"{cislo(k_jas['prah'])}"})
    else:
        sytost, prah = crty.get(kluc["sytost"]["crta"], np.nan), kluc["sytost"]["prah"]
        cesta.append({"otazka": "1. jas", "vysledok": "neistá zóna",
                      "popis": f"{nazov_crty(k_jas['crta'])} {cislo(jas)} je blízko prahu {cislo(k_jas['prah'])} "
                               f"(± {cislo(k_jas['neista_zona'])})"})
        if not np.isfinite(sytost):
            return {"skupina": "neiste", "nazov": f"neisté ({nazvy['tmave']} / {nazvy['svetle']})",
                    "podskupina": None, "druhy": kluc["skupiny"]["tmave"] + kluc["skupiny"]["svetle"],
                    "druh": None, "cesta": cesta}
        skupina = "tmave" if sytost <= prah else "svetle"
        cesta.append({"otazka": "2. sýtosť", "vysledok": nazvy[skupina],
                      "popis": f"{nazov_crty(kluc['sytost']['crta'])} {cislo(sytost)} {'≤' if sytost <= prah else '>'} "
                               f"{cislo(prah)}"})

    druhy, podskupina = list(kluc["skupiny"][skupina]), None
    if skupina == "tmave":
        druhy = vetva("tmave", crty, kluc, cesta) or druhy
    else:
        k_ton = kluc["ton"]
        ton = float(posun_tonu(crty[k_ton["crta"]], k_ton["ton_od"]))
        pod = "do_cervena" if ton <= k_ton["prah_cervena"] else "do_zlta" if ton > k_ton["prah_zlta"] else "stred"
        podskupina, druhy = k_ton["nazvy"][pod], list(k_ton["podskupiny"][pod])
        hranica = {"do_cervena": f"≤ {cislo(k_ton['prah_cervena'], 0)}°", "do_zlta": f"> {cislo(k_ton['prah_zlta'], 0)}°",
                   "stred": f"medzi {cislo(k_ton['prah_cervena'], 0)}° a {cislo(k_ton['prah_zlta'], 0)}°"}[pod]
        cesta.append({"otazka": "3. tón", "vysledok": podskupina,
                      "popis": f"{nazov_crty(k_ton['crta'])} {cislo(ton, 0)}° {hranica}"})

        k_tex = kluc["textura"]
        v = crty.get(k_tex["crta"], np.nan)
        if pod == "stred" and not np.isfinite(v) and textura:
            v = crty[k_tex["crta"]] = textura()
        if pod == "stred" and np.isfinite(v):
            strana = "nad_prahom" if v > k_tex["prah"] else "pod_prahom"
            druhy = list(k_tex[strana])
            cesta.append({"otazka": "4. textúra", "vysledok": k_tex["nazvy"][strana],
                          "popis": f"{nazov_crty(k_tex['crta'])} {cislo(v, 0)} {'>' if v > k_tex['prah'] else '≤'} "
                                   f"{cislo(k_tex['prah'], 0)}"})
            if strana == "pod_prahom":
                druhy = vetva("stred_hladke", crty, kluc, cesta) or druhy

    return {"skupina": skupina, "nazov": nazvy[skupina], "podskupina": podskupina, "druhy": druhy,
            "druh": druhy[0] if len(druhy) == 1 else None, "cesta": cesta}
