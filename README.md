# Diplomová práca – detekcia škvŕn plesní a baktérií z fotografie

| priečinok | obsah |
|---|---|
| [analyzy/](analyzy/README.md) | Python: hľadanie masky škvrny, vyhodnotenie voči ručným maskám, výber kanálov, škvrny na dokumentoch, určovací kľúč druhu (train / test) |
| [app/](app/README.md) | mobilná aplikácia (Expo, React Native): výpočet priamo v mobile |

Aplikácia počíta v Pythone (cez Pyodide – Python s numpy, OpenCV a scikit-image v prehliadači).
Používa kópiu kódu z `analyzy/` v [app/python/](app/python/README.md) s rovnakými funkciami,
upravenú na rýchlosť v mobile, takže masku škvrny, škvrny na dokumentoch aj druh škvrny určuje
rovnako ako analýzy.
