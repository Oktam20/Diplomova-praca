# Hľadanie škvŕn na dokumente – technický popis

Súbory: `dokument_tlac.py` (strana, text, tlač, papier), `dokument_miesta.py` (návrh miest
a filtre), `dokument.py` (maska v oknách, výrezy, spustenie).

## Postup

Strana sa spracúva zmenšená na dlhšiu stranu **1600 px**; mapa tlače vo vyššom rozlíšení
(do 3200 px), lebo v nižšom sa šrafovanie zlieva do plôch, ktoré vyzerajú ako škvrny.

1. **Strana** (`maska_strany`) – ak je okraj záberu výrazne tmavší ako stred, papier je
   najväčšia svetlá oblasť (Otsu na jase); inak sa za stranu považuje celý obrázok.
2. **Odstránenie textu** (`odstran_text`) – black-hat jasu: o koľko je pixel tmavší ako
   morfologické uzavretie v okne s polomerom 2,5 × hrúbka ťahu písma (hrúbka sa meria na
   každej strane). Prah = medián + 6 · MAD odozvy (aspoň 6 L*), s hysterézou. Atrament sa
   vyplní uzavretím farby – najsvetlejším okolím, teda papierom medzi ťahmi.
3. **Mapa tlače** (`mapa_tlace`) – ilustrácie (súvislé útvary atramentu vyššie aj širšie ako
   5 výšok písmena) a plná tlač (plochy odlišné od papiera o ΔE > 15, väčšie ako písmeno,
   s ostrým okrajom). Atrament na pozadí tmavšom ako papier o viac ako 10 L* sa do ilustrácií
   nepočíta – sú to zrná tmavej škvrny, nie čiary.
4. **Rozdiel od papiera** (`rozdiel_od_papiera`) – farba papiera sa odhadne veľkým mediánom;
   ΔE voči nemu (jas s váhou 0,5) sa prahuje s hysterézou podľa šumu papiera
   (medián + 4 · MAD / + 2 · MAD, aspoň 4,5 / 3,5). Škvrna musí papier tmaviť alebo
   zafarbovať do teplých tónov; čierne škvrny sa pripúšťajú mimo tlače.
5. **Filtre** (`odfiltruj`) – vyradí nález, ktorý:
   - leží hlavne v páse pri okraji strany (1/40 dlhšej strany),
   - je takmer celý z textu alebo v husto potlačenej ploche a nie je teplý,
   - je rovnomerne tmavý s ostrým okrajom (tlačený prvok),
   - má rozdiel farby od okolia ΔE < 7.

   Nálezy na tlači (`odstran_tlac`) si ponechajú len časti, ktoré sú od očakávanej farby tlače
   teplejšie alebo o viac ako 15 L* tmavšie.
6. **Maska v okne** (`najdi_skvrny`, `najlepsia_maska_pri`) – okolo každého navrhnutého miesta
   (od najväčšieho) štvorcové okno 2,5 × jeho veľkosť, zväčšené na 700 px. Kandidáti a skóre
   ako v `skvrny/maska.py` (profil rýchly), s podmienkami: z kandidáta ostanú len časti pri
   mieste, musí pokryť aspoň 30 % miesta a nesmie vyplniť viac ako 92 % svojho obdĺžnika
   (výsek okna). Ak nič nevyhovuje, miesto sa vynechá.
7. **Výrezy** (`uloz_vyrezy`) – blízke časti masky sa zlúčia do jednej škvrny (obdĺžniky
   rozšírené o 30 % veľkosti sa prekrývajú); každá škvrna s plochou aspoň 150 px sa vyreže
   ako štvorec 2 × jej veľkosť zo strany bez textu.

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
