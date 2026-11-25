# Návrh manuálneho kľúča

Črty: zakladne, jadro 0.45, dvojice čŕt: nie. Prahy z trénovacích fotiek (385). Istota úrovne 90%, najmenšia istota 75%.

| Krok | Podmienka | Výsledok | Zdôvodnenie |
|---|---|---|---|
| 1 | jas dL ≤ −49,05 | áno → **Cladosporium**; nie → krok 2 | farba; medián Cladosporium −51,10, najbližší druh Epicoccum −35,69; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Cladosporium–Epicoccum 0,16 |
| 2 | červenosť da ≤ −0,52 | áno → **Micrococcus**; nie → krok 3 | farba; medián Micrococcus −1,75, najbližší druh Exiguobacterium 0,86; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Micrococcus–Exiguobacterium 0,01 |
| 3 | žltosť db ≤ 26,21 | áno → krok 4; nie → krok 5 | farba; medián Rhodococcus 17,01, najbližší druh Sphingomonas 29,94; správne zaradených 98 % (priemer cez druhy); prekryv pixelov Rhodococcus–Sphingomonas 0,07 |
| 4 | jas dL ≤ −21,46 | áno → krok 6; nie → krok 7 | farba; medián Alternaria −23,64, najbližší druh Penicilium −15,57; správne zaradených 96 % (priemer cez druhy); prekryv pixelov Alternaria–Penicilium 0,09 |
| 5 | zmena žltosti okraj − stred ≤ −6,85 | áno → **Curtobacterium**; nie → **Sphingomonas** | radiálny profil; medián Curtobacterium −8,28, najbližší druh Sphingomonas −3,59; správne zaradených 96 % (priemer cez druhy); prekryv pixelov Curtobacterium–Sphingomonas 0,33 |
| 6 | entropia jasu ≤ 4,50 | áno → **Alternaria**; nie → **Epicoccum** | textúra a tvar; medián Alternaria 4,27, najbližší druh Epicoccum 4,72; správne zaradených 95 % (priemer cez druhy); prekryv pixelov Alternaria–Epicoccum 0,20 |
| 7 | žltosť db ≤ 17,40 | áno → krok 8; nie → **Rhodococcus** | farba; medián Aspergillus 14,43, najbližší druh Rhodococcus 17,01; správne zaradených 91 % (priemer cez druhy); prekryv pixelov Aspergillus–Rhodococcus 0,30 |
| 8 | jas dL ≤ −11,15 | áno → krok 9; nie → krok 10 | farba; medián Aspergillus −15,17, najbližší druh Talaromyces −6,86; správne zaradených 92 % (priemer cez druhy); prekryv pixelov Aspergillus–Talaromyces 0,30 |
| 9 | žltosť db ≤ 7,94 | áno → **Penicilium**; nie → **Aspergillus** | farba; medián Penicilium 5,71, najbližší druh Aspergillus 14,43; správne zaradených 93 % (priemer cez druhy); prekryv pixelov Penicilium–Aspergillus 0,02 |
| 10 | červenosť da ≤ 3,59 | áno → krok 11; nie → **Arthrobacter** | farba; medián Talaromyces 2,27, najbližší druh Arthrobacter 5,08; správne zaradených 93 % (priemer cez druhy); prekryv pixelov Talaromyces–Arthrobacter 0,00 |
| 11 | jas dL ≤ −5,27 | áno → **Talaromyces**; nie → **Exiguobacterium** | farba; medián Talaromyces −6,86, najbližší druh Exiguobacterium −2,11; správne zaradených 98 % (priemer cez druhy); prekryv pixelov Talaromyces–Exiguobacterium 0,20 |

| úspešnosť | hodnota |
|---|---|
| test_fotky | 69.7% |
| train_fotky | 83.1% |
| test_karticky | 76.9% |
| train_cv_fotky | 69.6% |
| train_cv_fotky_sd | 2.0% |
| train_cv_karticky | 75.4% |
