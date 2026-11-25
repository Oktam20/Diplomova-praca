# Návrh manuálneho kľúča

Prahy z trénovacích fotiek (385). Istota úrovne 90%, najmenšia istota 75%.

| Krok | Podmienka | Výsledok | Zdôvodnenie |
|---|---|---|---|
| 1 | jas dL ≤ −41,63 | áno → **Cladosporium**; nie → krok 2 | farba; medián Cladosporium −46,50, najbližší druh Epicoccum −28,28; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Cladosporium–Epicoccum 0,16 |
| 2 | červenosť da ≤ −0,60 | áno → **Micrococcus**; nie → krok 3 | farba; medián Micrococcus −1,60, najbližší druh Exiguobacterium 0,80; správne zaradených 98 % (priemer cez druhy); prekryv pixelov Micrococcus–Exiguobacterium 0,01 |
| 3 | žltosť db ≤ 21,76 | áno → krok 4; nie → krok 5 | farba; medián Rhodococcus 15,96, najbližší druh Sphingomonas 27,82; správne zaradených 98 % (priemer cez druhy); prekryv pixelov Rhodococcus–Sphingomonas 0,07 |
| 4 | jas dL ≤ −24,73 | áno → **Epicoccum**; nie → krok 6 | farba; medián Epicoccum −28,28, najbližší druh Alternaria −20,87; správne zaradených 96 % (priemer cez druhy); prekryv pixelov Epicoccum–Alternaria 0,20 |
| 5 | jas dL ≤ −4,90 | áno → **Curtobacterium**; nie → **Sphingomonas** | farba; medián Curtobacterium −6,07, najbližší druh Sphingomonas −3,98; správne zaradených 81 % (priemer cez druhy); prekryv pixelov Curtobacterium–Sphingomonas 0,33 |
| 6 | jas dL ≤ −19,56 | áno → **Alternaria**; nie → krok 7 | farba; medián Alternaria −20,87, najbližší druh Penicilium −14,00; správne zaradených 93 % (priemer cez druhy); prekryv pixelov Alternaria–Penicilium 0,09 |
| 7 | žltosť db ≤ 3,33 | áno → **Arthrobacter**; nie → krok 8 | farba; medián Arthrobacter 2,60, najbližší druh Penicilium 5,27; správne zaradených 91 % (priemer cez druhy); prekryv pixelov Arthrobacter–Penicilium 0,00 |
| 8 | jas dL ≤ −2,96 | áno → krok 9; nie → **Exiguobacterium** | farba; medián Talaromyces −5,94, najbližší druh Exiguobacterium −2,06; správne zaradených 93 % (priemer cez druhy); prekryv pixelov Talaromyces–Exiguobacterium 0,20 |
| 9 | žltosť db ≤ 5,76 | áno → **Penicilium**; nie → krok 10 | farba; medián Penicilium 5,27, najbližší druh Talaromyces 10,81; správne zaradených 93 % (priemer cez druhy); prekryv pixelov Penicilium–Talaromyces 0,04 |
| 10 | zmena jasu okraj − stred ≤ 10,21 | áno → krok 11; nie → **Aspergillus** | radiálny profil; medián Talaromyces 3,41, najbližší druh Aspergillus 12,88; správne zaradených 86 % (priemer cez druhy); prekryv pixelov Talaromyces–Aspergillus 0,30 |
| 11 | žltosť db ≤ 13,45 | áno → **Talaromyces**; nie → **Rhodococcus** | farba; medián Talaromyces 10,81, najbližší druh Rhodococcus 15,96; správne zaradených 83 % (priemer cez druhy); prekryv pixelov Talaromyces–Rhodococcus 0,35 |

| množina | určený druh správne | správny druh v skupine |
|---|---|---|
| test | 57.6% | 57.6% |
| train | 68.6% | 68.6% |
