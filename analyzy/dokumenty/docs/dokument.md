# Hľadanie škvŕn na strane dokumentu – technický popis

Súbory: `dokument_tlac.py` (príprava strany, model papiera a tlače), `dokument_miesta.py` (hľadanie
miest škvŕn), `dokument.py` (maska v okne, výrezy, spustenie).

Strana sa spracúva zmenšená na dlhšiu stranu **1600 px** (`PRACOVNA_STRANA`). Mapa tlače sa počíta
vo vyššom rozlíšení (do 3200 px, `TLAC_STRANA`), lebo v nižšom sa šrafovanie rytín zlieva do plôch,
ktoré vyzerajú ako škvrny. Mobilná aplikácia počíta mapu tlače z 2400 px, lebo jej fotografia
dokumentu má dlhšiu stranu najviac 2400 px.

## 1. Príprava strany

1. **Maska strany** (`maska_strany`) – ak je okraj záberu výrazne tmavší ako stred (strana fotená na
   stole), papier je najväčšia svetlá oblasť (Otsu na rozmazanom jase) s vyplnenými dierami, mierne
   zmenšená od okraja. Inak sa za stranu považuje celý obrázok.
2. **Hrúbka písma** (`hrubka_tahu`) – adaptívne prahovanie jasu L s Gaussovými váhami (okno
   max(15, dlhšia strana / 30) px, konštanta 10) nájde tmavé útvary, teda prevažne písmená.
   Hrúbka ťahu je 75. percentil maxím ich vzdialenostnej transformácie.
3. **Odstránenie textu** (`odstran_text`) – transformácia black-hat jasu: o koľko je pixel tmavší ako
   morfologické uzavretie s polomerom 2,5 × hrúbka ťahu. Prah = medián + 6 · MAD odozvy na strane
   (aspoň 6 L*), s hysterézou (slabý prah polovičný). Nájdený atrament sa mierne rozšíri a vyplní
   farbou pozadia (`vypln_pozadie`: uzavretie farby a Gaussovo rozmazanie, teda najsvetlejšie okolie
   – papier medzi ťahmi). V husto potlačených miestach sa vyplní celé okolie. Plošná škvrna širšia
   ako ťah písma black-hat odozvu nemá, takže ostane.

## 2. Model papiera a tlače

4. **Odhad papiera** (`odhad_papiera`) – strana sa zmenší na 400 px, vynechané pixely (atrament,
   tlač) sa doplnia z okolia (inpaint Telea) a obrázok sa rozmaže mediánovým filtrom s oknom ¼
   strany. Medián v okne väčšom ako škvrny vráti farbu papiera, lebo škvrny tvoria v okne menšinu
   pixelov, a pritom sleduje pomalé zmeny farby papiera, napríklad stmavnutie pri okraji.
5. **Mapa tlače** (`mapa_tlace`) – ilustrácie (súvislé útvary atramentu vyššie aj širšie ako 5 výšok
   písmena, uzavreté a vyplnené) a plná tlač (plochy odlišné od papiera o ΔE > 15, väčšie ako písmeno,
   s ostrým okrajom). Atrament na pozadí tmavšom ako papier o viac ako 10 L* sa do ilustrácií
   nepočíta – sú to zrná tmavej škvrny, nie čiary.

## 3. Hľadanie miest škvŕn

6. **Rozdiel od papiera** (`rozdiel_od_papiera`) – farebný rozdiel ΔE každého pixela strany bez textu
   voči odhadnutej farbe papiera v Lab (jas s váhou 0,5). Prahuje sa s hysterézou podľa šumu papiera:
   silný prah medián + 4 · MAD (aspoň 4,5), slabý medián + 2 · MAD (aspoň 3,5). Škvrna musí papier
   zafarbovať do teplých tónov alebo ho mimo tlače tmaviť. Výsledok sa uzavrie a ponechajú sa
   oblasti s plochou aspoň 4 · 10⁻⁶ · (dlhšia strana)².
7. **Škvrny na tlači** (`odstran_tlac`) – nález ležiaci na mape tlače si ponechá len časti, ktoré sú
   od očakávanej farby tlače teplejšie alebo o viac ako 15 L* tmavšie. Kúsok ležiaci hlavne na tlači
   ostane, ak je dosť veľký, kompaktný a teplý alebo s mäkkým okrajom.
8. **Filtre** (`odfiltruj`) – vyradí nález, ktorý:
   - leží hlavne v páse pri okraji strany (1/40 dlhšej strany),
   - je takmer celý z textu alebo v husto potlačenej ploche a nie je teplý,
   - je rovnomerne tmavý s ostrým okrajom (tlačený prvok),
   - má farebný rozdiel od okolitého papiera ΔE < 7.

## 4. Maska v okne a výrezy

9. **Maska v okne** (`najdi_skvrny`, `najlepsia_maska_pri`) – okolo každého navrhnutého miesta (od
   najväčšieho) sa vyreže štvorcové okno 2,5 × jeho veľkosť zo strany bez textu a zväčší sa na 700 px.
   Kandidáti a skóre sú ako v `skvrny/maska.py` (profil Rýchly), s podmienkami: z kandidáta ostanú len
   oblasti pri mieste, musia pokryť aspoň 30 % miesta a nesmú vyplniť viac ako 92 % svojho obdĺžnika
   (výsek okna). Ak nič nevyhovuje, miesto sa vynechá. Miesto, ktoré už z väčšej časti pokrýva maska
   iného okna, sa preskočí.
10. **Výrezy** (`vyrezy`, `uloz_vyrezy`) – blízke časti masky sa zlúčia do jednej škvrny (obdĺžniky
    rozšírené o 30 % veľkosti sa prekrývajú). Každá škvrna s plochou aspoň 150 px sa vyreže ako
    štvorec 2 × jej veľkosť zo strany bez textu. Výrez s maskou je vstup pre určenie druhu.

## Výstup

| súbor | obsah |
|---|---|
| `<strana>_prehlad.png` | pôvodná strana \| bez textu + navrhnuté miesta (modrá) \| maska (červená) |
| `<strana>_maska.png` | maska škvŕn (0/255) v pracovnom rozlíšení |
| `<strana>_bez_textu.jpg` | strana po odstránení textu |
| `<strana>_vyrezy/<strana>_<n>.png` | výrez škvrny, v `masky/` jej maska |

## Obmedzenia

- Veľmi bledé škvrny (ΔE voči papieru pod 6) sa takmer nenájdu.
- Veľké tmavé tlačené plochy a farebná tlač sa od škvŕn nedajú vždy spoľahlivo odlíšiť.
