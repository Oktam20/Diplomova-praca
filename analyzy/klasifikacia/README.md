# Klasifikácia – určovací kľúč druhu škvrny

Druh sa určuje vysvetliteľným kľúčom: postupnosťou otázok „črta ≤ prah?“ (alebo dvojica čŕt
oddelená priamkou). Črty sa počítajú z fotky a masky škvrny voči farbe okolitého papiera, a to
z **jadra škvrny** – bez rozmazaného okraja kolónie, ktorého farba prechádza do papiera.

## Postup

Spúšťa sa z priečinka `analyzy/` (masky z `python -m skvrny.vytvor_masky images/D2`):

```
python -m klasifikacia.postav_kluc --fotky images/D2 --masky images/D2/masky
python -m klasifikacia.postav_kluc --uloz      # uloží kľúč aj do kluc.json a do aplikácie
```

1. pre každú fotku vypočíta črty (`crty.py`): farbu papiera a lem z celej masky, farbu, zóny
   a textúru z jadra škvrny (pixely, ktorých farebný rozdiel od papiera ΔE je aspoň 45 % z 90.
   percentilu ΔE v škvrne; najväčšia súvislá časť – výber podielu v časti *Jadro škvrny* nižšie),
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

**Výsledok (masky profilu Rýchly):** train (krížová validácia) **82,6 % fotiek** (91,1 % kartičiek)
určených správne, **test 80,8 % fotiek a 84,6 % kartičiek**. S črtami z celej masky to bolo 78,7 %
a na teste 71,7 % fotiek (76,9 % kartičiek). Najťažšie sú *Aspergillus* a *Epicoccum* (67 %
v krížovej validácii), *Rhodococcus* a *Sphingomonas* (71 %); najčastejšie zámeny sú *Aspergillus*
→ *Rhodococcus* / *Exiguobacterium*, *Rhodococcus* ↔ *Exiguobacterium* a *Alternaria* ↔ *Epicoccum*.

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

## Jadro škvrny – `vyber_jadra.py`

Maska škvrny (automatická aj ručná) zahŕňa aj rozmazaný okraj kolónie, kde farba plynule prechádza
do farby papiera. Okraj je pri všetkých druhoch podobne bledý a rozdiely medzi druhmi zotiera. Črty sa
preto počítajú z jadra: z pixelov masky, ktorých farebný rozdiel od papiera ΔE je aspoň daný podiel
z 90. percentilu ΔE v škvrne (najväčšia súvislá časť). Farba papiera a lem sa určujú z celej masky.
Mení sa len to, z ktorých pixelov sa merajú tie isté črty – otázky kľúča ostávajú rovnaké.

```
python -m klasifikacia.vyber_jadra --fotky images/D2 --masky images/D2/masky --rucne images/D2masks
```

Pre každý podiel sa kľúč naučí na train a vyhodnotí krížovou validáciou po kartičkách (5 rozdelení na
foldy); podiel sa vyberá len podľa nej, test je na porovnanie.

| podiel | 0 (celá maska) | 0,2 | 0,3 | 0,35 | 0,4 | **0,45** | 0,5 | 0,6 | 0,7 | 0,8 |
|---|---|---|---|---|---|---|---|---|---|---|
| krížová validácia | 79,2 % | 80,4 % | 82,2 % | 82,1 % | 82,8 % | **82,6 %** | 81,2 % | 82,9 % | 80,8 % | 75,7 % |
| plocha jadra / maska | 100 % | 95 % | 91 % | 88 % | 85 % | **81 %** | 76 % | 66 % | 55 % | 40 % |

Úspešnosť stúpne z 79,2 % na plató 82–83 % pri podieloch 0,3–0,6 (rozdiely v ňom sú v rámci rozptylu
medzi rozdeleniami na foldy, asi ±1 p. b.) a pri príliš malom jadre klesá. Zvolený podiel **0,45** je
v strede plató a má najmenší rozptyl (±0,5 p. b.). Pri ručných maskách je účinok ešte väčší: 76,6 %
s celou maskou, 83,8 % s jadrom 0,45 – aj ručne obkreslená škvrna zahŕňa bledý okraj.

**Výstup v `klasifikacia/vysledky_jadra/`:** `01_uspesnost_podla_jadra.png` (úspešnosť kľúča a plocha
jadra podľa podielu pre automatickú a ručnú masku), `02_jadro_priklady.png` (maska, jadro a vynechaný
okraj na štyroch škvrnách), `uspesnost.csv`, `plocha_jadra.csv`.

## PCA farieb pixelov – `pca_farieb.py`

Overenie nápadu: v RGB alebo Lab (prípadne len v rovine ab) nájsť vlastné vektory kovariančnej matice
farieb pixelov škvrny a porovnať medzi druhmi smery vlastných vektorov a pomery vlastných čísel.

```
python -m klasifikacia.pca_farieb --fotky images/D2 --masky images/D2/masky --rucne images/D2masks
```

Z pixelov vo vnútri masky sa spočíta kovariančná matica farieb, jej vlastné čísla λ1 ≥ λ2 (≥ λ3)
a vlastné vektory. Hlavná os je 1. vlastný vektor, teda smer, v ktorom sa farby pixelov líšia najviac.
Os nemá orientáciu (v aj −v je tá istá os), preto sú smery v rozsahu 0–180° a uhly od osí 0–90°.

| črta | priestor | význam |
|---|---|---|
| `pca_lab_sklon` | Lab voči papieru | uhol hlavnej osi od osi jasu: 0° = pixely sa líšia len jasom, 90° = len farbou |
| `pca_lab_smer_ab` | Lab | smer hlavnej osi premietnutej do roviny ab |
| `pca_lab_odchylka` | Lab | uhol hlavnej osi od smeru papier → priemerná farba škvrny |
| `pca_lab_pomer21`, `pca_lab_pomer31` | Lab | pomery λ2/λ1, λ3/λ1 (0 = pretiahnutý oblak pixelov, 1 = guľatý) |
| `pca_lab_rozptyl` | Lab | √λ1 – smerodajná odchýlka pozdĺž hlavnej osi |
| `pca_ab_smer`, `pca_ab_pomer`, `pca_ab_rozptyl` | ab | to isté len v rovine ab (2D) |
| `pca_ab_odchylka` | ab | uhol hlavnej osi od tónu škvrny (0° = pixely sa líšia len sýtosťou rovnakého tónu) |
| `pca_rgb_sklon` | RGB fotky | uhol hlavnej osi od osi šedej (1, 1, 1) |
| `pca_rgb_pomer21`, `pca_rgb_pomer31`, `pca_rgb_rozptyl` | RGB | pomery vlastných čísel a rozptyl |

Porovnávajú sa tri masky: ručná (`images/D2masks`), automatická (tá istá ako pre kľúč) a jadro
automatickej masky bez okrajovej zóny 0. Sila čŕt, výber otázok aj učenie sú len na train
(krížová validácia po kartičkách, 5 rozdelení na foldy), test slúži len na konečné porovnanie.

**Výstup v `klasifikacia/vysledky_pca/`:**

| súbor | čo je na ňom |
|---|---|
| `01_princip.png` | 4 typické škvrny: výrez s maskou, hustota pixelov v rovine ab a v rovine jas × sýtosť, elipsa, hlavná os a 2. vlastný vektor. Sklon hlavnej osi od osi jasu rastie od *Alternaria* (6°, pixely sa líšia jasom) cez *Aspergillus* (33°) a *Rhodococcus* (59°) po *Curtobacterium* (79°, líšia sa sýtosťou) – **hlavný obrázok princípu** |
| `02_elipsy_ab.png` | elipsy (2 smerodajné odchýlky) pixelov každej trénovacej škvrny v rovine ab, panel na druh; elipsy svetlých druhov smerujú k papieru, hlavná os teda opakuje tón |
| `03_elipsy_jas_sytost.png` | to isté v rovine jas × sýtosť: zvislé elipsy tmavých plesní, šikmé *Aspergillus*, *Rhodococcus* a *Talaromyces*, vodorovné žltých baktérií – **najnázornejšie porovnanie druhov** |
| `04_crty_druhov.png` | 6 hlavných PCA čŕt po druhoch (bod = fotka, čiara = medián) s eta² |
| `05_sila_crt.png` | eta² všetkých 14 PCA čŕt oproti doterajším črtám a R² ich odhadu zo 46 doterajších čŕt |
| `06_vplyv_masky.png` | eta² PCA čŕt s ručnou maskou, automatickou maskou a jadrom; zhoda hodnôt medzi maskami |
| `07_klasifikatory.png` | logistická regresia a náhodný les s doterajšími črtami, s pridanými PCA črtami a len s PCA (všetky, Lab, ab, RGB), pre automatickú a ručnú masku |
| `08_otazky_kluca.png` | pre každú otázku vetiev: aktuálna otázka, samotná PCA črta a najlepšia otázka s PCA črtou; vpravo celý kľúč s PCA otázkami (vnorená krížová validácia, test) |
| `crty.csv` | doterajšie a PCA črty každej fotky pre každú masku (aj priemer a kovariancia farieb) |
| `sila_crt.csv` | eta² pre každú masku, zhoda s automatickou maskou, R² a najpodobnejšia doterajšia črta |
| `klasifikatory.csv`, `otazky_kluca.csv`, `kluc_vnorena_validacia.csv` | čísla ku grafom 07 a 08 |
| `struktura_kluca_s_pca.json` | štruktúra kľúča, ktorú by výber otázok s PCA zvolil na celom train |

**Výsledok:**
- PCA črty druhy rozlišujú dobre: pomer λ2/λ1 v rovine ab má eta² 0,82, odchýlka hlavnej osi od
  farby škvrny 0,81 a sklon hlavnej osi od osi jasu 0,81 (najsilnejšia doterajšia črta 0,90, medián
  doterajších 0,71). Samotných 14 PCA čŕt určí klasifikátorom 76–80 % fotiek; z priestorov je
  najlepší Lab (70–77 %), rovina ab (57–66 %) a RGB (56–63 %) samy nestačia.
- **Smer hlavnej osi v rovine ab je slabý** (eta² 0,30). Medián jeho odchýlky od tónu škvrny je
  8,5°: pixely sa v ab líšia hlavne sýtosťou toho istého tónu (od bledého okraja k sýtemu stredu),
  takže hlavná os opakuje tón, ktorý kľúč už používa. Užitočný smer je až v Lab – sklon od osi jasu.
- PCA črty sú z veľkej časti obsiahnuté v doterajších: sklon sa z nich dá odhadnúť s R² 0,93,
  rozptyly s R² 0,90–0,91. Pridanie PCA čŕt k doterajším 46 zlepší klasifikátory o 0–0,5 p. b.
  v krížovej validácii (v rámci rozptylu medzi rozdeleniami), na teste o 0 až 3 p. b.
- Na segmentácii záleží: s ručnými maskami sú sklony a pomery silnejšie (sklon eta² 0,87) a samotné
  PCA črty určia 81–88 % fotiek; aj vtedy však k doterajším črtám pridajú len 1–2 p. b. PCA
  z geometrického jadra bez okrajovej zóny 0 je slabšia a hlavná os sa v ňom od tónu odchyľuje viac
  (16°) – pre rozptyl farieb nesie prechod k okraju informáciu, kým priemerné farby a zóny kľúča sú
  presnejšie z farebného jadra (časť *Jadro škvrny*).
- **Kľúč PCA nezlepší.** Sklon by bol najlepšou samostatnou otázkou pre T2 (*Rhodococcus* medzi
  tmavými, 100 % oproti 91,0 %), T3 a B2, no celý kľúč s PCA otázkami má vo vnorenej krížovej
  validácii 81,5 % oproti 82,6 % (lepší v 1 z 5 rozdelení) a na teste 79,8 % oproti 80,8 %.

## Súbory

| súbor | čo robí |
|---|---|
| `crty.py` | črty škvrny z jej jadra: farba voči papieru, 4 zóny od okraja k stredu, lem, LBP, Gaborova textúra |
| `kluc.py` | učenie prahov (`nauc_kluc`) a určenie škvrny (`urci`) – to isté používa aplikácia |
| `struktura_kluca.json` | štruktúra kľúča bez prahov |
| `postav_kluc.py` | celý postup: črty, učenie na train, vyhodnotenie, grafy |
| `kluc.json` | kľúč, ktorý používa aplikácia (`--uloz`) |
| `vyber_jadra.py` | výber jadra škvrny (podiel `JADRO` v `crty.py`), výstupy v `vysledky_jadra/` |
| `pca_farieb.py` | PCA farieb pixelov škvrny a jej prínos pre určenie druhu, výstupy v `vysledky_pca/` |
| `vzhlad.py` | farby a štýl grafov analýz |
| `grafy_analyz/` | grafy analýz, z ktorých vznikla štruktúra kľúča (zo starého backendu), s popisom v `grafy_analyz/README.md` |
