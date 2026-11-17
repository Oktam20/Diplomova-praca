# Python v aplikácii

Kópia výpočtov z `analyzy/`, ktorú aplikácia spúšťa v mobile cez Pyodide (Python s numpy,
OpenCV a scikit-image vo WebView). Funkcie a konštanty sa volajú rovnako ako v analýzach,
kód je len upravený na rýchlosť – v Pyodide nemá OpenCV SIMD ani vlákna, takže veľké
morfologické jadrá a zbytočné prechody cez celý obrázok sú tam niekoľkonásobne pomalšie ako na PC.

| súbor | kópia z | čo je inak |
|---|---|---|
| `skvrny/maska.py` | `analyzy/skvrny/maska.py` | len kanály z profilu, rovnaký celočíselný prah sa neskúša dvakrát, vyčistenie masky tabuľkou, kontrast len v okolí masky, skóre až pri výbere |
| `skvrny/morfologia.py` | – | dilatácia a erózia s eliptickým jadrom cez posuny riadkov; binárne masky zbalené po 64 pixelov do čísla (rovnaký výsledok ako `cv2.dilate`/`cv2.erode`) |
| `dokumenty/dokument_tlac.py` | `analyzy/dokumenty/dokument_tlac.py` | morfológia z `morfologia.py`, blackhat na 8-bitovom jase, Lab sa počíta raz, mapa tlače z 2400 px (`TLAC_STRANA`) |
| `dokumenty/dokument_miesta.py` | `analyzy/dokumenty/dokument_miesta.py` | morfológia z `morfologia.py`, Lab pôvodnej strany sa počíta raz |
| `dokumenty/dokument.py` | `analyzy/dokumenty/dokument.py` | pri fotke do 1600 px sa text odstraňuje len raz, rýchlejší výber masky pri navrhnutom mieste, bez ukladania súborov; výrezy vracia `vyrezy()` |
| `klasifikacia/crty.py`, `kluc.py` | `analyzy/klasifikacia/` | bez zmeny (Gaborova textúra sa v aplikácii počíta len pri žltooranžových škvrnách, kde ju kľúč potrebuje) |
| `klasifikacia/kluc.json` | `analyzy/klasifikacia/kluc.json` | zapíše ho `python -m klasifikacia.postav_kluc --uloz` |
| `aplikacia.py` | – | prepojenie s aplikáciou: načítanie fotky (aj Display P3), volanie analýz, určenie druhu, obrázky na zobrazenie |

Čas v Pyodide na PC (fotka škvrny 751×748 px, strana 1120×1600 px):

| | `analyzy/` pred zrýchlením | `app/python/` |
|---|---|---|
| obrázok | 2,7 s | 0,7 s |
| dokument | 27,8 s | 6,0 s |

Okrem `TLAC_STRANA` (v analýzach 3200 px) dávajú funkcie rovnaký výsledok ako v `analyzy/`.
Súbory sa do aplikácie vkladajú pri `npm run build:worker`, preto ho treba po každej zmene spustiť.
