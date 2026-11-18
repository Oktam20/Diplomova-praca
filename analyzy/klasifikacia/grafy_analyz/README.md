# Grafy analýz, z ktorých vznikol určovací kľúč

Grafy skopírované zo starého backendu (`backend/backend_app/`), na základe ktorých bol navrhnutý
kľúč v `klasifikacia/` – výber čŕt, poradie otázok, prahy a ich hodnotenie. Priečinky majú
rovnaké čísla ako sekcie v starom backende (tam sú aj skripty a CSV s výsledkami).

> **Dôležité pri citovaní čísel.** Sekcie 03–07 sú počítané na **pôvodných maskách** datasetu
> a na **celom datasete** (overenie po vzorkách / kartičkách, leave-one-out). Sekcie 10–11
> už pracujú s rozdelením train / test. Aktuálny kľúč v `klasifikacia/` (nové masky, profil
> Rýchly, črty z jadra škvrny, prahy len z train) má na teste 80,8 % fotiek – čísla nižšie preto
> opisujú, **prečo** má kľúč takú štruktúru, nie výslednú úspešnosť (tá je v `klasifikacia/vysledky/`).

**Spoločné pojmy**
- **črty** – farba škvrny **voči papieru** v CIELAB: `dL` (< 0 = tmavšia), `da` (> 0 = červenšia),
  `db` (> 0 = žltšia), sýtosť `chroma`, tón `odtien_deg` (0° do červena, 90° do žlta);
  `zona0–3` = 4 zóny od okraja (0) k stredu (3); `halo` = pás papiera tesne za okrajom;
  textúra GLCM, LBP, Gabor; tvar.
- **eta²** – podiel rozptylu črty vysvetlený druhom (0 = nerozlišuje, 1 = dokonale), z Kruskal-Wallis
  testu na mediánoch vzoriek (4 fotky kartičky nie sú nezávislé).
- **spoľahlivosť otázky** – priemerný podiel škvŕn na správnej strane prahu **cez druhy**
  (každý druh má rovnakú váhu); **overenie po vzorkách** = prah určený bez jednej kartičky
  a otestovaný na nej.

| priečinok | čo rieši |
|---|---|
| [03_crty_skvrn/](03_crty_skvrn/) | ktoré črty vôbec rozlišujú druhy |
| [04_kluc_zakladne_kroky/](04_kluc_zakladne_kroky/) | horné poschodia kľúča: jas → sýtosť → tón → Gabor |
| [05_kluc_nove_vetvy/](05_kluc_nove_vetvy/) | rozdelenie tmavých plesní (T1–T5) a hladkých baktérií (B1–B4) |
| [06_hodnotenie_kluca/](06_hodnotenie_kluca/) | úspešnosť celého kľúča, zámeny, kde vznikajú chyby |
| [07_aplikacia_vs_python/](07_aplikacia_vs_python/) | či aplikácia počíta rovnaké črty a rozhodne rovnako |
| [10_rozdelenie_train_test/](10_rozdelenie_train_test/) | rozdelenie datasetu 80 / 20 po kartičkách |
| [11_kluc_train_test/](11_kluc_train_test/) | kľúč na nových maskách: stavba na train, overenie na teste |
| [pokusy/](pokusy/) | automatický strom a štatistický klasifikátor – prístupy, ktoré do výsledku nešli |
| [kluc/](kluc/) | diagram (zastaraný) ručného kľúča |

---

## 03 – Črty škvŕn: čo rozlišuje druhy

### [analyza_crt/](03_crty_skvrn/analyza_crt/) – štatistika všetkých čŕt
| súbor | čo je na grafe | záver |
|---|---|---|
| `01_sila_crt.png` | vľavo eta² najsilnejších čŕt, vpravo najlepšia črta každej rodiny | najsilnejšie sú **zónové a farebné črty jasu a žltosti**: zona3_dL (eta² 0,89), zona2_dL 0,88, farba_dL_p10 0,88, zona3_db 0,86; najlepšia z rodín: GLCM 0,76, okraj 0,74, tvar 0,67, LBP 0,64, halo 0,63 |
| `02_rozdelenia_top_crt.png` | panel na črtu: hodnoty fotiek po druhoch | ktoré druhy sa v danej črte prekrývajú |
| `03_pca_druhy.png` | 12 panelov PCA (PC1 × PC2), v každom zvýraznený jeden druh | *Cladosporium* tvorí kompaktný zhluk, iné druhy sa prekrývajú |
| `04_pca_stredy.png` | PCA – medián druhu + medzikvartilové rozpätie | ktoré druhy sú si podobné |
| `05_korelacie.png` | korelačná matica najsilnejších čŕt | veľké bloky korelovaných čŕt (db v zónach, percentily db) → z bloku stačí jedna |
| `06_parove_rozlisenie.png` | matica druh × druh: počet čŕt, ktoré dvojicu významne odlišujú | dvojice s malým číslom sú ťažké – tam treba špeciálne otázky |
| `07_profil_druhov.png` | teplotná mapa druh × črta (nad / pod celkovým mediánom) | „odtlačok“ druhu, intuitívne porovnanie |

### [textura/](03_crty_skvrn/textura/) – pomáha textúra?
Klasifikácia „najbližší profil druhu“ (profil vždy bez kartičky testovanej škvrny).
| súbor | čo je na grafe | záver |
|---|---|---|
| `01_sila_crt.png` | eta² každej textúrnej črty po rodinách (GLCM, LBP, Gabor, vlnky) | jednotlivé textúrne črty sú slabšie než farebné |
| `02_rozlisenie_druhov.png` | % správne: každá rodina samostatne a spolu s farbou | samotná farba 69,8 %, samotné textúry 35–46 %, farba + vlnky 72,5 %, farba + všetky textúry 69,6 % → textúra celkovo pridá málo |
| `03_druhy_x_skupiny.png` | druh × rodina čŕt (% správne) | textúra pomáha konkrétnym druhom (*Epicoccum* 38 → 78 % s LBP, *Rhodococcus* 29 → 61 %) → v kľúči len v konkrétnych otázkach (Gabor pri *Talaromyces*, LBP pri *Epicoccum*) |
| `04_najsilnejsie_crty.png` | eta² najsilnejších textúrnych čŕt | ktoré textúrne črty stoja za úvahu |

### [histogramy_odtiena_a_farieb/](03_crty_skvrn/histogramy_odtiena_a_farieb/)
- `odtien_Alternaria_Alternata.png` – ukážka: histogram odtieňa H (HSV) škvrny a papiera.
- `odtien_vsetky_druhy.png`, `farby_vsetky_druhy.png` – odtieň / histogramy R, G, B, panel na druh.
- `odtien_porovnanie.png` – odtiene všetkých druhov pod sebou.

**Záver:** odtiene všetkých škvŕn ležia v úzkom pásme (asi 20–50° HSV) a nádych papiera posúva
odtieň celej fotky → kľúč nepoužíva odtieň HSV, ale **tón voči papieru v CIELAB**.

### [podobnost_histogramy_farba/](03_crty_skvrn/podobnost_histogramy_farba/) a [podobnost_histogramy_odtien/](03_crty_skvrn/podobnost_histogramy_odtien/)
Bhattacharyyova vzdialenosť histogramov (H×S, resp. H) pre každú dvojicu fotiek.
| súbor | čo je na grafe |
|---|---|
| `01_matica_vzdialenosti.png` | vzdialenosť každej dvojice fotiek zoradených podľa druhu |
| `02_v_ramci_vs_medzi.png` | vzdialenosti v rámci druhu vs. medzi druhmi |
| `03_priemerne_histogramy.png` | priemerný histogram každého druhu |
| `04_vzdialenosti_druhov.png` | priemerné vzdialenosti druh × druh |
| `05_rozlisenie_druhov.png` | matica zámen pri priradení k najbližšiemu priemernému histogramu |

**Záver:** fotky jednej kartičky sú si veľmi podobné, iné kartičky toho istého druhu menej
(najbližší sused z inej kartičky je rovnaký druh pri *Alternaria* 95 %, pri *Sphingomonas* len
59 %). Histogram druh nesie len čiastočne → kľúč pracuje s jednoduchými číslami (priemer,
percentil, zóna).

---

## 04 – Kľúč: základné kroky

```
                 jas voči papieru (farba_dL_mean)
            ≤ −11,01 /            \ > −11,01        (|dL − prah| < 3 → neistá zóna: rozhodne sýtosť)
     TMAVÉ (5 plesní)            SVETLÉ – tón voči papieru
     → vetva T (sekcia 05)        ≤ 47,1° → Arthrobacter,  > 90,8° → Micrococcus
                                  inak stred: Gabor λ = 32 px > 936,5 → Talaromyces
                                              inak 4 hladké baktérie → vetva B (sekcia 05)
```

### [a_farba_skvrn/](04_kluc_zakladne_kroky/a_farba_skvrn/) – ktorý farebný parameter delí škvrny na dve skupiny?
Pre jas, červenosť, žltosť, sýtosť, tón a ΔE: (1) prirodzené údolie rozdelenia, (2) najlepší prah podľa druhov.
| súbor | čo je na grafe |
|---|---|
| `01_druhy_<parameter>.png` | riadok = druh, body = škvrny, čiara = medián, prerušovaná = najlepší prah |
| `05_histogramy_<parameter>.png` | histogram parametra pre každý druh (rovnaká os x) |
| `02_histogramy.png` | 6 panelov, histogram všetkých škvŕn; oranžová = prirodzené údolie, modrá = najlepší prah podľa druhov – dáta sa „samé“ na dve polovice nerozpadajú |
| `03_porovnanie.png` | **hlavný graf zdôvodnenia kroku 1**: spoľahlivosť, najhorší druh a pomer skupín pre každý parameter |
| `04_rovina_farieb.png` | „mapa“ druhov: sýtosť × jas a da × db (mediány + IQR) |
| `05_histogramy_druhov.png` | histogramy druhov na spoločnej osi |

| parameter | prah | spoľahlivosť | najhorší druh | skupiny |
|---|---|---|---|---|
| **jas** | −11,01 | **92,5 %** | Aspergillus 68 % | 5 : 7 |
| žltosť | 16,4 | 96,0 % | Rhodococcus 61 % | 8 : 4 |
| sýtosť | 19,19 | 95,0 % | Rhodococcus 46 % | 8 : 4 |
| ΔE | 27,01 | 89,8 % | Epicoccum 68 % | 8 : 4 |
| tón | 69,72 | 88,9 % | Epicoccum 58 % | 5 : 7 |
| červenosť | 2,61 | 85,7 % | Sphingomonas 56 % | 6 : 6 |

Žltosť a sýtosť majú vyšší priemer, ale niektorý druh delia veľmi zle a oddelia len 4 žlté
baktérie; jas delí na zmysluplné skupiny (tmavé plesne / svetlé baktérie + *Talaromyces*).

### [b_krok1_jas/](04_kluc_zakladne_kroky/b_krok1_jas/) – krok 1: tmavé / svetlé
| súbor | čo je na grafe |
|---|---|
| `01_jas_druhov.png` | jas škvŕn po druhoch, prah −11,01 a neistá zóna ±3 – **hlavný graf kroku 1** |
| `02_jas_zltost.png` | žltosť × jas: hnedé a žlté škvrny sa líšia hlavne jasom, nie žltosťou |
| `03_ton_v_skupinach.png` | tón vo vnútri každej skupiny – vo svetlej môže tón pomôcť |
| `04_histogram_jasu.png` | histogram jasu farebne podľa skupiny s prahom a neistou zónou |

Výsledok: spoľahlivosť 92,5 %, overenie po kartičkách 91,3 % škvŕn; prah stabilný (−11,12 až
−10,18). Najhoršie *Aspergillus* 68 % a *Rhodococcus* 71 % (majú svetlé aj tmavé škvrny).
Neistá zóna obsahuje 12,8 % škvŕn; v nej rozhodne sýtosť (`farba_chroma` ≤ 17,9 → tmavé).

### [c_ton/](04_kluc_zakladne_kroky/c_ton/) – tón naprieč všetkými druhmi
- `01_ton_druhov.png` – tón škvŕn po druhoch + najlepší prah,
- `05_histogramy_druhov.png`, `histogramy/<druh>.png` – histogramy tónu.

**Záver:** cez všetkých 12 druhov tón spoľahlivo oddelí len sivé *Cladosporium* a do červena
sfarbený *Arthrobacter* → nehodí sa na krok 1, ale hodí sa vo svetlej skupine.

### [d_ton_svetlych/](04_kluc_zakladne_kroky/d_ton_svetlych/) – tón svetlých škvŕn
| súbor | čo je na grafe |
|---|---|
| `01_cervenost_druhov.png` | červenosť da svetlých druhov a prahy krajných podskupín |
| `02_ton_druhov.png` | to isté pre tón – **hlavný graf kroku „tón svetlých“** |
| `03_cervenost_zltost.png` | rovina da × db: smer = tón, vzdialenosť = sýtosť, čiary = prahy tónu |
| `04_dvojice.png` | ktoré dvojice svetlých druhov farba oddelí – stred (5 druhov) neoddelí |
| `05_histogramy.png` | rozdelenie hodnôt s prahmi a prirodzeným údolím |

Tón ≤ 47,1° → *Arthrobacter*, > 90,8° → *Micrococcus*: overenie 96,2 %; prah 47,1° leží
presne v prirodzenom údolí (47,06°). Červenosť oddelí len *Micrococcus*.

### [e_gabor_stredu/](04_kluc_zakladne_kroky/e_gabor_stredu/) – textúra strednej skupiny
`01_gabor_prehlad.png` – mriežka 3 × 4: riadky odozva / rozptyl / anizotropia, stĺpce λ = 4, 8,
16, 32 px. *Talaromyces* (vláknité mycélium) sa jasne odlišuje pri λ = 32 px:
`gabor_l32_odozva` > 936,5 → *Talaromyces*, overenie 98,5 %.

Po krokoch 04 určí kľúč presne len *Arthrobacter*, *Micrococcus* a *Talaromyces* (17 % fotiek);
skupiny „tmavé“ (41 %) a „stred – hladké“ (40 %) rieši sekcia 05.

---

## 05 – Nové vetvy kľúča

Postup pre každú skupinu: (1) ktoré črty druhy v skupine odlišujú (eta²), (2) všetky rozdelenia
na dve časti, (3) jeden druh proti ostatným – vetva = „najľahšie oddeliteľný druh preč“, kým
neostanú dva, (4) pri slabých otázkach dvojica čŕt (deliaca priamka v rovine dvoch čŕt).

### Analýzy skupín – každý priečinok má rovnakých 5 grafov
| súbor | čo je na grafe |
|---|---|
| `01_sila_crt.png` | najsilnejšie črty (eta²), farba = rodina čŕt |
| `02_rozdelenia_crt.png` | panel na črtu: bod = fotka, čiarka = medián vzorky, hrubá čiara = medián druhu |
| `03_rozdelenia_skupiny.png` | najlepšie rozdelenia skupiny na dve časti (overenie po vzorkách) |
| `04_jeden_proti_ostatnym.png` | vyvážená úspešnosť oddelenia druhu od ostatných (50 % = nerozlíši) |
| `05_najlepsie_rozdelenie.png` | najlepšie rozdelenie: hodnoty po druhoch + prah |

| priečinok | skupina | záver | → otázka |
|---|---|---|---|
| [tmave/](05_kluc_nove_vetvy/tmave/) | 5 tmavých plesní | *Cladosporium* oddelí `zona1_dL` (98,3 %), *Aspergillus* `zona2_db` (96,5 %) | T1, T3 |
| [rhodococcus_tmave/](05_kluc_nove_vetvy/rhodococcus_tmave/) | tmavé + *Rhodococcus* (fotky dL ≤ −8) | tmavé fotky *Rhodococcus* oddelí žltosť stredu `zona3_db` (95,5 %) | T2 |
| [tmave_zvysok/](05_kluc_nove_vetvy/tmave_zvysok/) | *Epicoccum, Alternaria, Penicillium* | *Penicillium* – rozptyl jasu 91 %, v dvojici lepšie zóna stred − okraj | T4 |
| [epicoccum_alternaria/](05_kluc_nove_vetvy/epicoccum_alternaria/) | *Epicoccum* vs. *Alternaria* | jedna črta len 84,6 % → treba dvojicu | T5 |
| [stred_hladke/](05_kluc_nove_vetvy/stred_hladke/) | 4 hladké baktérie | *Exiguobacterium* oddelí `farba_db_p90` (95,2 %) | B2 |
| [aspergillus_svetle/](05_kluc_nove_vetvy/aspergillus_svetle/) | stred + svetlý *Aspergillus* (dL > −14) | najťažšia otázka: jedna črta len 71 % | B1 |
| [rhodo_curto_sphingo/](05_kluc_nove_vetvy/rhodo_curto_sphingo/) | *Rhodococcus, Curtobacterium, Sphingomonas* | *Rhodococcus* `farba_db_p90` ≤ 28,18 (96,9 %) | B3 |
| [curto_sphingo/](05_kluc_nove_vetvy/curto_sphingo/) | *Curtobacterium* vs. *Sphingomonas* | jedna črta 90,2 % | B4 |

### [dvojice/](05_kluc_nove_vetvy/dvojice/) – jedna črta vs. dvojica čŕt
| súbor | čo je na grafe |
|---|---|
| `01_porovnanie.png` | **hlavný graf zdôvodnenia dvojíc**: úspešnosť najlepšej jednej črty vs. dvojice |
| `02_istota.png` | podiel určených fotiek vs. úspešnosť pri rôznej šírke neistej zóny |
| `03_<pripad>.png` | fotky v rovine dvoch čŕt, čiara = hranica, sivý pás = neistá zóna 0,5 (`b0_aspergillus` = B1, `b1_exiguobacterium` = B2, `b3_curtobacterium` = B4, `t4_penicilium` = T4, `t5_epicoccum` = T5) |

| otázka | jedna črta | dvojica |
|---|---|---|
| T4 Penicillium | 91,0 % | **98,3 %** |
| T5 Epicoccum vs. Alternaria | 84,6 % | **94,6 %** |
| B1 svetlý Aspergillus | 87,7 % | **88,8 %** |
| B2 Exiguobacterium | 94,0 % | **97,0 %** |
| B4 Curtobacterium vs. Sphingomonas | 90,2 % | **96,9 %** |

### [vetvy/](05_kluc_nove_vetvy/vetvy/)
`01_vetva_tmave.png`, `02_vetva_bakterie.png` – otázky s jednou črtou: hodnoty po druhoch, ktoré do
otázky prídu, a prah (dvojice sú v `dvojice/03_*`).

**Výsledné vetvy:** T1 *Cladosporium* (`zona1_dL`) → T2 *Rhodococcus* (`zona3_db`) → T3
*Aspergillus* (`zona2_db`) → T4 *Penicillium* (dvojica zóna stred − okraj dL + db) → T5
*Epicoccum* / *Alternaria* (dvojica `lbp_P8R1_9` + `zona3_dL`); B1 *Aspergillus* (dvojica) → B2
*Exiguobacterium* (dvojica) → B3 *Rhodococcus* (`farba_db_p90`) → B4 *Curtobacterium* /
*Sphingomonas* (dvojica `zona_stred_minus_okraj_db` + `halo_da`). *Rhodococcus* a *Aspergillus*
majú otázku aj v „cudzej“ vetve, lebo majú svetlé aj tmavé škvrny.

---

## 06 – Hodnotenie celého kľúča

Výsledok fotky: **určený** (1 druh, správny), **v skupine** (správny je medzi viacerými),
**zle**, **neisté**. Porovnávajú sa 3 verzie: len krok 1 / pôvodný kľúč (sekcia 04) / kľúč + nové
vetvy. Overenie po vzorkách (127× bez jednej kartičky):

| verzia | určený | v skupine | zle | druhov vo výsledku |
|---|---|---|---|---|
| len krok 1 | 0 % | 80,8 % | 6,4 % | 6,9 |
| pôvodný kľúč | 17,1 % | 70,7 % | 12,2 % | 3,8 |
| **kľúč + vetvy** | **88,2 %** | – | **11,8 %** | **1,0** |

| súbor | čo je na grafe | záver |
|---|---|---|
| `01_vysledok_druhov.png` | 3 panely (verzie), riadok = druh, pruh: určený / v skupine / zle / neisté | **hlavný graf výsledkov**; najviac chýb *Aspergillus* (25 %), *Talaromyces* a *Sphingomonas* (22 %) |
| `02_uzly.png` | každá otázka: úspešnosť s uloženými prahmi vs. pri overení | všetky okrem sýtosti a B1 nad 95 %; pokles pri overení len pri sýtosti (85 → 77 %) |
| `03_zameny.png` | matica zámen pôvodného kľúča (aj so skupinami) | väčšina fotiek ostane v skupinách |
| `03b_zameny_vetvy.png` | matica zámen finálneho kľúča | diagonála 75–96 %; *Aspergillus* → *Exiguobacterium* 12 %, *Rhodococcus* → *Exiguobacterium* 11 % |
| `04_suhrn.png` | 3 verzie × (uložené, overenie) + priemerný počet druhov vo výsledku | 6,9 → 3,8 → 1,0 druhu; 0 → 17 → 88 % určených |
| `05_kde_chyby.png` | druh × otázka, kde zle určená fotka zišla zo správnej cesty | najviac chýb v **kroku 1** (12 fotiek *Aspergillus*) a v tóne |
| `06_neista_zona.png` | šírka neistej zóny dvojíc vs. podiel určených / zle | širšia zóna zníži určené 88 → 56 %, chyby len 11,8 → 10,1 % → zóna 0 |

### [obrazky_crt/](06_hodnotenie_kluca/obrazky_crt/)
Pre jednu fotku na druh: vľavo výrez so zónami 0–3, lemom (halo), papierom a obrysom masky, vpravo
cesta kľúčom (hodnoty čŕt, prahy, rozhodnutia). `prehlad_druhov.png` – po jednej fotke z každého
druhu vedľa seba (červený nadpis = zle určená). Vhodné do práce ako ilustrácia zón, lemu a postupu kľúča.

---

## 07 – Aplikácia vs. Python

Porovnanie na 24 fotkách (2 na druh), či TypeScript prepis v aplikácii počíta rovnaké črty a kľúč
rozhodne rovnako. (Robené s pôvodnou maskou aplikácie 5 kanálov × 3 metódy.)
| súbor | čo je na grafe | záver |
|---|---|---|
| `01_rozdiely_mierka.png` | medián \|aplikácia − Python\| pre jas, sýtosť, tón, Gabor; farba = maska | rozdiely zanedbateľné (jas < 0,08, tón < 0,21°, Gabor < 0,5 %) |
| `02_zhoda_kluca.png` | správny druh vo výsledku, IoU masky s datasetom, čas masky | maska aplikácie 145 ms vs. 563 ms, na 2 fotkách z 24 iná oblasť (IoU 0) |
| `03_aplikacia_vs_python.png` | črta v aplikácii vs. v Pythone (body na uhlopriečke = zhoda) | zhoda, 2 odľahlé fotky |
| `04_crty_kluca.png` | rozdiel každej črty kľúča v smerodajných odchýlkach | **dôkaz, že kľúč v aplikácii = kľúč v práci**: 24/24 rovnaký výsledok s maskou datasetu |

---

## 10 – Rozdelenie train / test

`01_rozdelenie.png` – riadok = druh, vľavo kartičky, vpravo fotky; modrá = train, oranžová = test.
Delenie **po kartičkách** (4 fotky kartičky spolu), stratifikovane po druhoch, seed 2026:
train 101 kartičiek / 385 fotiek, test 26 / 99. Každý druh je v teste.

---

## 11 – Kľúč na nových maskách: train → test

Porovnanie variantov kľúča (masky profilu Rýchly), vybraný podľa krížovej validácie na train.
| súbor | čo je na grafe |
|---|---|
| `01_varianty.png` | podiel fotiek určený / zle pre varianty V0p, V1p (pôvodné masky), V0, V1, V2 (nové masky) – train (krížová validácia) a test; ★ = vybraný |
| `02_otazky.png` | otázky vetiev: úspešnosť pôvodnej črty vs. najlepšej jednej črty a dvojice vybranej nanovo na train |
| `03_po_druhoch_test.png` | podiel testovacích fotiek druhu určených správne (pôvodný → nový kľúč); malé počty – 1 kartička = 4 fotky |
| `04_zameny_test.png` | kam padajú testovacie fotky každého druhu; rámik = správny výsledok |

| variant | train (CV) | test |
|---|---|---|
| V0p pôvodné masky, pôvodný kľúč | 90,1 % | 87,9 % |
| V1p pôvodné masky, prahy z train | 87,0 % | 79,8 % |
| V0 nové masky, pôvodné prahy | 80,8 % | 75,8 % |
| **V1 nové masky, pôvodné črty, prahy z train** (vybraný) | 79,0 % | 74,7 % |
| V2 nové masky, črty vetiev vybrané na train | 75,6 % | 72,7 % |

**Záver:** nanovo vyberané črty (V2) sú na train CV horšie než pôvodná štruktúra (V1) – preto
kľúč ponecháva pôvodnú štruktúru a z train učí len prahy (tak funguje aj `klasifikacia/kluc.py`).
Na nových maskách je úspešnosť nižšia než na pôvodných; najťažšie sú *Sphingomonas*,
*Micrococcus*, *Talaromyces*, *Penicillium* a *Aspergillus*.

---

## Pokusy – prístupy, ktoré do výsledku nešli

### [automaticky_kluc/](pokusy/automaticky_kluc/)
`kluc.png` (diagram) a `kluc.txt` (text vo formáte botanického kľúča) – rozhodovací strom postavený
automaticky (uzol sa delí len pri spoľahlivosti ≥ 95 % vzoriek a každom druhu ≥ 75 %).
**Prečo nie:** vyberá štatisticky najlepšiu črtu bez ohľadu na zmysel (začína 90. percentilom
žltosti) a mnohé skupiny nechá nerozdelené (napr. „Alternaria alebo Epicoccum“). Ručný kľúč má
každý krok podložený analýzou a dá sa vysvetliť.

### [statisticky_klasifikator/](pokusy/statisticky_klasifikator/)
`matica_zamen.png` – matica zámen štatistického klasifikátora (12 čŕt) na teste (33 vzoriek / 128
fotiek): 87,5 % fotiek, 93,9 % vzoriek; pri 30 opakovaniach rozdelenia priemerne 86,5 % fotiek.
**Prečo nie:** podobná úspešnosť ako ručný kľúč, ale „čierna skrinka“ – hodí sa ako
**porovnávacia hodnota** (baseline), že ručný kľúč nie je horší.

---

## Kľúč

[kluc/manualny_kluc.png](kluc/manualny_kluc.png) – diagram vetvenia ručného kľúča. **Zastaraný:**
obsahuje len kroky 1, 2, tón a Gabor, bez vetiev T a B.
