# Návrh manuálneho kľúča

Črty: vylepsene, jadro 0.45, dvojice čŕt: áno. Prahy z trénovacích fotiek (385). Istota úrovne 90%, najmenšia istota 75%.

| Krok | Podmienka | Výsledok | Zdôvodnenie |
|---|---|---|---|
| 1 | jas (priemer) ≤ −48,86 | áno → **Cladosporium**; nie → krok 2 | farba; medián Cladosporium −51,57, najbližší druh Epicoccum −34,71; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Cladosporium–Epicoccum 0,16 |
| 2 | červenosť (10. percentil) ≤ −1,83 | áno → **Micrococcus**; nie → krok 3 | farba; medián Micrococcus −2,83, najbližší druh Sphingomonas 0,26; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Micrococcus–Sphingomonas 0,13 |
| 3 | žltosť (90. percentil) ≤ 27,87 | áno → krok 4; nie → krok 5 | farba; medián Rhodococcus 19,98, najbližší druh Sphingomonas 33,11; správne zaradených 99 % (priemer cez druhy); prekryv pixelov Rhodococcus–Sphingomonas 0,07 |
| 4 | jas (10. percentil) ≤ −42,00 | áno → **Epicoccum**; nie → krok 6 | farba; medián Epicoccum −47,65, najbližší druh Alternaria −35,01; správne zaradených 96 % (priemer cez druhy); prekryv pixelov Epicoccum–Alternaria 0,20 |
| 5 | červenosť stred − okraj ≤ 1,17 | áno → **Sphingomonas**; nie → **Curtobacterium** | zóny a lem; medián Sphingomonas 0,05, najbližší druh Curtobacterium 1,85; správne zaradených 94 % (priemer cez druhy); prekryv pixelov Sphingomonas–Curtobacterium 0,33 |
| 6 | tón (°) ≤ 38,76 | áno → **Arthrobacter**; nie → krok 7 | farba; medián Arthrobacter 28,18, najbližší druh Alternaria 51,28; správne zaradených 97 % (priemer cez druhy); prekryv pixelov Arthrobacter–Alternaria 0,01 |
| 7 | jas (priemer) ≤ −3,23 | áno → krok 8; nie → **Exiguobacterium** | farba; medián Talaromyces −6,28, najbližší druh Exiguobacterium −2,03; správne zaradených 95 % (priemer cez druhy); prekryv pixelov Talaromyces–Exiguobacterium 0,20 |
| 8 | jas (10. percentil) ≤ −29,39 | áno → **Alternaria**; nie → krok 9 | farba; medián Alternaria −35,01, najbližší druh Aspergillus −22,56; správne zaradených 94 % (priemer cez druhy); prekryv pixelov Alternaria–Aspergillus 0,03 |
| 9 | žltosť (medián) ≤ 7,44 | áno → **Penicilium**; nie → krok 10 | farba; medián Penicilium 6,17, najbližší druh Talaromyces 11,63; správne zaradených 96 % (priemer cez druhy); prekryv pixelov Penicilium–Talaromyces 0,04 |
| 10 | dvojica: hrubá textúra (Gabor, λ = 32 px) a jas zóny 3 (priamka pod uhlom 42°) ≤ 0,62 | áno → krok 11; nie → **Talaromyces** | dvojica čŕt; medián Rhodococcus −0,43, najbližší druh Talaromyces 1,23; správne zaradených 100 % (priemer cez druhy); prekryv pixelov Rhodococcus–Talaromyces 0,35 |
| 11 | dvojica: jas stred − okraj a jas (10. percentil) (priamka pod uhlom 156°) ≤ −0,40 | áno → **Rhodococcus**; nie → **Aspergillus** | dvojica čŕt; medián Rhodococcus −0,51, najbližší druh Aspergillus 0,41; správne zaradených 91 % (priemer cez druhy); prekryv pixelov Rhodococcus–Aspergillus 0,30 |

| úspešnosť | hodnota |
|---|---|
| test_fotky | 64.6% |
| train_fotky | 85.2% |
| test_karticky | 73.1% |
| train_cv_fotky | 73.6% |
| train_cv_fotky_sd | 1.8% |
| train_cv_karticky | 79.4% |
