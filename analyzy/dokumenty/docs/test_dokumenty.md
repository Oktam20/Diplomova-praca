# Syntetický test – technický popis

Súbory: `test_dokumenty.py`, `generuj_strany.py` (len vytvorí strany, bez vyhodnotenia).

## Vloženie škvrny

Zo skutočnej fotky škvrny a jej masky sa odhadne farba papiera (medián mimo škvrny)
a vypočíta sa pomer farby k papieru (0 – 1) pre každý kanál. Pomer sa zmenší na 10 – 22 %
kratšej strany strany, má mäkký prechod do okolia, náhodne sa zrkadlovo otočí a vloží sa
**násobením** na voľné miesto strany. Text pod škvrnou tak ostane – ako pri skutočnej
škvrne. Maska vloženej škvrny je správna odpoveď.

Každá strana sa použije 3-krát (kolá), zakaždým so 4 škvrnami iných druhov; seed 7.

## Metriky (pre každú vloženú škvrnu)

| metrika | význam |
|---|---|
| nájdená | maska programu pokrýva aspoň 50 % plochy škvrny |
| IoU | zhoda masky programu a vloženej škvrny v jej okolí |
| IoU s lemom | toleruje masku do 15 % veľkosti škvrny za jej okrajom (okraj vloženej škvrny je neostrý) |
| presnosť | aká časť masky pri škvrne leží na skutočnej škvrne |
| viditeľnosť | medián ΔE, o ktorý vloženie zmenilo farbu strany; škvrny s ΔE < 6 sú okom takmer neviditeľné |
| na tlači | podiel škvrny ležiaci na ilustrácii alebo tlači |

**Falošné nálezy** – škvrny v maske syntetickej strany, ktoré sa neprekrývajú so žiadnou
vloženou škvrnou ani s nálezom na pôvodnej strane (tie môžu byť skutočné škvrny dokumentu).

## Výstup

`suhrn.txt` – nájdené a IoU pre všetky škvrny, pre viditeľné škvrny a zvlášť mimo
ilustrácií / na tlači, počet falošných nálezov; `skvrny.csv` – riadok za každú vloženú
škvrnu; `<strana>_k<kolo>.jpg` – náhľad (zelená = vložená škvrna, červená = maska programu).
