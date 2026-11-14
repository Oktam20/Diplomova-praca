# Klasifikácia – určovací kľúč druhu škvrny

Druh sa určuje vysvetliteľným kľúčom: postupnosťou otázok „črta ≤ prah?“ (alebo dvojica čŕt
oddelená priamkou). Črty sa počítajú z fotky a masky škvrny voči farbe okolitého papiera.

## Postup

Spúšťa sa z priečinka `analyzy/` (masky z `python -m skvrny.vytvor_masky images/D2`):

```
python -m klasifikacia.postav_kluc --fotky images/D2 --masky images/D2/masky
python -m klasifikacia.postav_kluc --uloz      # uloží kľúč aj do kluc.json a do aplikácie
```

1. pre každú fotku vypočíta črty (`crty.py`),
2. na trénovacích fotkách (`skvrny/rozdelenie.csv`) naučí prahy kľúča (`kluc.py`, štruktúra
   kľúča je v `struktura_kluca.json`),
3. úspešnosť na train odhadne krížovou validáciou po kartičkách (5 foldov, prahy sa vždy učia
   bez kartičiek foldu), konečné vyhodnotenie je na testovacích fotkách,
4. pre každú fotku zistí výsledok: **určený** (kľúč vráti jeden druh a je správny), **v skupine**
   (viac druhov a správny je medzi nimi), **zle**.

**Výstup v `klasifikacia/vysledky/`:**

| súbor | obsah |
|---|---|
| `kluc.json` | naučený kľúč (štruktúra + prahy + úspešnosť) |
| `suhrn.csv` | podiel určených / v skupine / zle pre train (krížová validácia) a test, fotky aj kartičky |
| `fotky.csv` | výsledok každej fotky |
| `crty.csv` | črty všetkých fotiek |
| `uspesnost.png` | celková úspešnosť (train – krížová validácia, test – fotky a kartičky) |
| `po_druhoch.png` | výsledok po druhoch na train a test |
| `zameny_test.png` | kam padajú testovacie fotky každého druhu |

**Výsledok (masky profilu Rýchly):** train (krížová validácia) 78,7 % fotiek určených správne,
**test 71,7 % fotiek a 76,9 % kartičiek**. Najťažšie sú *Sphingomonas* (zamieňa sa
s *Curtobacterium*), *Aspergillus*, *Talaromyces* a *Micrococcus*.

## Kľúč

| krok | črta | čo rozhodne |
|---|---|---|
| 1. jas | `farba_dL_mean` | tmavé (5 plesní) / svetlé; v neistej zóne ± 3 rozhodne sýtosť (`farba_chroma`) |
| T1–T5 | zóny, LBP | tmavé plesne: *Cladosporium*, *Rhodococcus* (tmavé fotky), *Aspergillus*, *Penicilium*, *Epicoccum* / *Alternaria* |
| 3. tón | `farba_odtien_deg` | svetlé: do červena (*Arthrobacter*) / žltooranžové / čisto žlté (*Micrococcus*) |
| 4. textúra | `gabor_l32_odozva` | žltooranžové: hrubá textúra (*Talaromyces*) / hladké baktérie |
| B1–B4 | zóny, percentily, lem | hladké: *Aspergillus* (svetlé fotky), *Exiguobacterium*, *Rhodococcus*, *Curtobacterium* / *Sphingomonas* |

Štruktúra (skupiny druhov, poradie otázok a ich črty) pochádza z analýzy čŕt na celom datasete,
preto test nie je od nej úplne nezávislý; prahy sa však učia len na train.

## Súbory

| súbor | čo robí |
|---|---|
| `crty.py` | črty škvrny: farba voči papieru, 4 zóny od okraja k stredu, lem, LBP, Gaborova textúra |
| `kluc.py` | učenie prahov (`nauc_kluc`) a určenie škvrny (`urci`) – to isté používa aplikácia |
| `struktura_kluca.json` | štruktúra kľúča bez prahov |
| `postav_kluc.py` | celý postup: črty, učenie na train, vyhodnotenie, grafy |
| `kluc.json` | kľúč, ktorý používa aplikácia (`--uloz`) |
