"""Ktoré farebné kanály a metódy prahovania sú potrebné (len trénovacie fotky).

    python -m skvrny.vyber_kanalov --fotky <priečinok> --rucne <priečinok> [--znova]
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from skvrny.maska import JASOVE_KANALY, METODY, VSETKY_KANALY, kandidati
from skvrny.rozdelenie import nacitaj_rozdelenie
from skvrny.subory import VYSLEDKY, nacitaj_masku, nacitaj_obrazok, najdi_fotku
from skvrny.vyhodnotenie import porovnaj

TOLERANCIA_RYCHLY = 0.01


def kandidati_fotky(uloha):
    """Skóre a Dice každého kandidáta jednej fotky (všetky kanály × metódy × smery)."""
    
    fotka, cesta_fotky, cesta_rucnej = uloha
    rucna = nacitaj_masku(cesta_rucnej)
    
    return [
        {"fotka": fotka, "kanal": k["kanal"], "metoda": k["metoda"], "smer": k["smer"],
         "skore": k["skore"], "dice": porovnaj(k["maska"] > 0, rucna)["dice"]}
        for k in kandidati(nacitaj_obrazok(cesta_fotky), VSETKY_KANALY, list(METODY))
    ]


def nacitaj_kandidatov(fotky, rucne, znova):
    """Výpočet trvá dlho, preto sa výsledok uloží do vysledky/kandidati.csv."""
    
    subor = VYSLEDKY / "kandidati.csv"
    
    if subor.exists() and not znova:
        return pd.read_csv(subor)

    rozdelenie = nacitaj_rozdelenie()
    trenovacie = rozdelenie[rozdelenie.cast == "train"].fotka
    ulohy = [(f, najdi_fotku(fotky, f), rucne / f"{f}.png") for f in trenovacie]

    riadky = []
    with ProcessPoolExecutor() as pool:
        for poradie, vysledok in enumerate(pool.map(kandidati_fotky, ulohy, chunksize=4), 1):
            riadky += vysledok
            print(f"\r{poradie}/{len(ulohy)} fotiek", end="")
    print()

    tabulka = pd.DataFrame(riadky)
    tabulka.to_csv(subor, index=False)
    return tabulka


def vybrane(tabulka, kanaly, metody):
    """Kandidát s najvyšším skóre na každej fotke, keď sú povolené len dané kanály a metódy."""
    
    povoleni = tabulka[tabulka.kanal.isin(kanaly) & tabulka.metoda.isin(metody)]
    
    return povoleni.loc[povoleni.groupby("fotka").skore.idxmax()]


def vylucovanie(tabulka, kanaly, metody):
    """Vždy sa odoberie kanál alebo metóda, bez ktorej je priemerný Dice vybraných masiek najvyšší."""
    kroky = [("", kanaly, metody, vybrane(tabulka, kanaly, metody).dice.mean())]

    while len(kanaly) * len(metody) > 2:
        moznosti = []
        if len(kanaly) > 1:
            moznosti += [(k, [x for x in kanaly if x != k], metody) for k in kanaly]
        if len(metody) > 1:
            moznosti += [(m, kanaly, [x for x in metody if x != m]) for m in metody]

        ohodnotene = [(odobrate, kn, mt, vybrane(tabulka, kn, mt).dice.mean()) for odobrate, kn, mt in moznosti]
        odobrate, kanaly, metody, dice = max(ohodnotene, key=lambda moznost: moznost[3])
        kroky.append((odobrate, kanaly, metody, dice))

    return pd.DataFrame([
        {"odobrate": odobrate, "kanalov": len(kn), "metod": len(mt), "dice": dice,
         "kanaly": ", ".join(kn), "metody": ", ".join(mt)}
        for odobrate, kn, mt, dice in kroky
    ])


def zvol_profily(kroky):
    """Kvalitný = najmenšia sada bez straty, rýchly = najmenšia sada so stratou do 0,01 Dice."""
    
    zaciatok = kroky.dice.iloc[0]
    
    return {
        "kvalitny": kroky[kroky.dice >= zaciatok - 1e-9].iloc[-1],
        "rychly": kroky[kroky.dice >= zaciatok - TOLERANCIA_RYCHLY].iloc[-1],
    }


def graf_vyhry(vitazi, cesta):
    fig, osi = plt.subplots(1, 2, figsize=(11, 5))
    
    for ax, stlpec, poradie, nazov in ((osi[0], "kanal", VSETKY_KANALY, "Víťazný kanál"),
                                       (osi[1], "metoda", list(METODY), "Víťazná metóda")):
        pocty = vitazi[stlpec].value_counts().reindex(poradie, fill_value=0).sort_values()
        farby = ["#898781" if k in JASOVE_KANALY else "#256abf" for k in pocty.index]
        ax.barh(pocty.index, pocty.values, color=farby)
        ax.set_xlabel("počet trénovacích fotiek, kde vyhral")
        ax.set_title(nazov)
    
    fig.suptitle("Výhry pri všetkých 19 kanáloch × 7 metódach (sivé = jasové kanály)")
    fig.tight_layout()
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def graf_vylucovanie(kroky, profily, cesta):
    kombinacie = kroky.kanalov * kroky.metod
    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.plot(kombinacie, kroky.dice, marker="o", color="#256abf")
    
    for krok, pocet in zip(kroky.itertuples(), kombinacie):
        if krok.odobrate:
            ax.annotate(f"−{krok.odobrate}", (pocet, krok.dice), xytext=(0, 8), textcoords="offset points",
                        ha="center", fontsize=7, rotation=60)
    
    for nazov, krok in profily.items():
        ax.scatter(krok.kanalov * krok.metod, krok.dice, s=120, color="#e8862a", zorder=3)
        ax.annotate(f"{nazov} {krok.kanalov} × {krok.metod}", (krok.kanalov * krok.metod, krok.dice),
                    xytext=(10, -16), textcoords="offset points", color="#e8862a", fontweight="bold")
    
    ax.set_xscale("log")
    ax.set_xticks(kombinacie.tolist(), kombinacie.tolist())
    ax.minorticks_off()
    ax.invert_xaxis()
    ax.set_xlabel("počet kombinácií kanál × metóda")
    ax.set_ylabel("priemerný Dice (train)")
    ax.set_title("Postupné vylučovanie kanálov a metód")
    fig.savefig(cesta, dpi=150, bbox_inches="tight")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="Analýza výberu farebných kanálov a metód prahovania.")
    parser.add_argument("--fotky", type=Path, required=True)
    parser.add_argument("--rucne", type=Path, required=True)
    parser.add_argument("--znova", action="store_true", help="prepočítať kandidátov aj keď sú uložení")
    args = parser.parse_args()

    VYSLEDKY.mkdir(exist_ok=True)
    tabulka = nacitaj_kandidatov(args.fotky, args.rucne, args.znova)

    vitazi = vybrane(tabulka, VSETKY_KANALY, list(METODY))
    print(f"Všetky kanály × metódy: priemerný Dice {vitazi.dice.mean():.3f}")
    print(vitazi.kanal.value_counts().to_string())
    graf_vyhry(vitazi, VYSLEDKY / "vyhry_kanalov_a_metod.png")

    bez_jasovych = [k for k in VSETKY_KANALY if k not in JASOVE_KANALY]
    kroky = vylucovanie(tabulka, bez_jasovych, list(METODY))
    kroky.to_csv(VYSLEDKY / "vylucovanie.csv", index=False)
    profily = zvol_profily(kroky)
    graf_vylucovanie(kroky, profily, VYSLEDKY / "vylucovanie.png")

    print()
    print(kroky[["odobrate", "kanalov", "metod", "dice"]].round(4).to_string(index=False))
    
    for nazov, krok in profily.items():
        print(f"\n{nazov}: Dice {krok.dice:.3f}\n  kanály: {krok.kanaly}\n  metódy: {krok.metody}")


if __name__ == "__main__":
    main()
