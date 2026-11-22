# Diplomová práca – škvrny plesní a baktérií na historických dokumentoch

Z fotografie škvrny alebo celej strany dokumentu nájde masku škvrny a určí druh plesne alebo
baktérie vysvetliteľným určovacím kľúčom. Postup nepoužíva strojové učenie: maska sa hľadá
automatickým prahovaním farebných kanálov a výberom podľa skóre, kľúč je postupnosť otázok na
merateľné črty škvrny a z dát sa učia len prahy.

| priečinok | obsah |
|---|---|
| [analyzy/](analyzy/README.md) | Python: algoritmus masky, vyhodnotenie voči ručným maskám a výber profilov, škvrny na stranách dokumentov, určovací kľúč (trénovacia a testovacia množina) |
| [app/](app/README.md) | mobilná aplikácia (Expo, React Native): rovnaký algoritmus prepísaný do TypeScriptu, výpočet priamo v telefóne |
| `latex-final/` | text diplomovej práce |

## Hlavné výsledky

| časť | výsledok | kde |
|---|---|---|
| maska škvrny (profil Rýchly) | Dice 0,832 na testovacej množine (presnosť 0,91, citlivosť 0,81) | [analyzy/](analyzy/README.md#1-maska-škvrny-na-detailnom-zábere-skvrny) |
| určovací kľúč | 80,8 % fotografií a 84,6 % kartičiek určených správne na testovacej množine | [analyzy/klasifikacia/](analyzy/klasifikacia/README.md) |
| aplikácia | masky zhodné s Python verziou pixel po pixeli | [app/](app/README.md#rovnaký-algoritmus-ako-v-analýzach) |

Dataset: 484 fotografií škvŕn 12 druhov (127 kartičiek) s ručne obkreslenými maskami, rozdelených
po kartičkách na trénovaciu (385 fotografií) a testovaciu (99) množinu.

## Kde začať

1. [analyzy/README.md](analyzy/README.md) – ako algoritmus funguje, profily a všetky kroky analýz,
2. [analyzy/skvrny/docs/maska.md](analyzy/skvrny/docs/maska.md) – algoritmus masky podrobne,
3. [analyzy/dokumenty/docs/dokument.md](analyzy/dokumenty/docs/dokument.md) – hľadanie škvŕn na strane,
4. [analyzy/klasifikacia/README.md](analyzy/klasifikacia/README.md) – črty a určovací kľúč,
5. [app/README.md](app/README.md) – mobilná aplikácia.
