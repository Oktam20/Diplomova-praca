/** Slovenské texty aplikácie. Anglický preklad v en.ts má rovnaké kľúče. */
export const sk = {
  kod: 'SK',
  oddelovacDesatin: ',',

  jazyk: {
    prepnut: 'Prepnúť jazyk na angličtinu',
  },

  rezimy: {
    obrazok: 'Obrázok',
    dokument: 'Dokument',
  },

  pohlady: {
    maska: 'Maska',
    original: 'Originál',
    vyrez: 'Výrez',
  },

  skenovanie: {
    zdrojKamera: 'Skenovanie',
    zdrojSubor: 'Nahraj súbor',
    nadpisSpracuva: 'Spracúva sa',
    nadpisSkontroluj: 'Skontroluj masku',
    nadpisZnova: 'Skús to znova',
    nadpisNahraj: 'Nahraj obrázok',
    nadpisZarovnaj: 'Zarovnaj vzorku na stred',
    spracuvaSa: 'Spracúva sa…',
    klasifikujeSa: 'Klasifikuje sa…',
    nahrajZoSuboru: 'Nahraj fotku vzorky zo súboru.',
    potrebujemeKameru: 'Potrebujeme prístup ku kamere.',
    povolitKameru: 'Povoliť kameru',
    klasifikovat: 'Klasifikovať',
    tipDokument: 'Odfoť celú stránku – text sa odstráni a škvrny sa nájdu samy.',
    tipObrazok: 'Obrázok s plesňou by mal byť v strede a celý viditeľný.',
    skenovatZnova: 'Skenovať znova',
    nahratSubor: 'Nahrať súbor',
  },

  spravy: {
    bezGalerie: 'Bez povolenia do galérie nie je možné vybrať obrázok.',
    maskaSaNevytvorila: 'Maska sa nevytvorila.',
    spracovanieZlyhalo: 'Spracovanie v zariadení zlyhalo.',
    klasifikaciaZlyhala: 'Klasifikácia zlyhala.',
    ziadneMiesta: 'Na stránke sa nenašli žiadne škvrny.',
    bezMasky: 'Navrhnuté miesta sa našli, ale vlastný algoritmus v nich masku nenašiel.',
    casDokumentu: (spracovanych: number, okien: number) => `Časový limit – spracovaných ${spracovanych} z ${okien} miest.`,
    casObrazka: (sekund: number) => `Spracovanie trvalo dlhšie ako ${sekund} s a bolo prerušené – pravdepodobne nastala chyba.`,
  },

  chyby: {
    pixely: 'Nepodarilo sa načítať pixely obrázka.',
    webviewPreruseny: 'Výpočet vo WebView bol prerušený (nedostatok pamäte?) – skús to znova.',
    webviewZatvoreny: 'WebView sa zatvoril.',
    webviewZlyhal: 'Výpočet vo WebView zlyhal.',
    webviewNedostupny: 'Výpočet vo WebView nie je k dispozícii – naskenuj vzorku znova.',
    podklad: 'Podklad pre klasifikáciu už nie je k dispozícii – naskenuj vzorku znova.',
  },

  vysledok: {
    nadpis: 'Výsledok skenu',
    ziadnyVysledok: 'Žiadny výsledok – najprv naskenuj vzorku.',
    ziadnaSkvrna: 'Nenašla sa žiadna škvrna, ktorú by sa dalo zaradiť.',
    overenieKluca: (percent: number) => `Overenie kľúča po kartičkách ${percent} %`,
    spracovanie: (sekundy: string) => `spracovanie ${sekundy} s`,
    profil: 'Farebný profil fotky:',
    profilNeuvedeny: 'neuvedený (berie sa ako sRGB)',
    prevedeneP3: ' – prevedené do sRGB ako trénovacie dáta',
    novySken: 'Nový sken',
  },

  skvrna: {
    nazov: (cislo: number | null) => (cislo === null ? 'Škvrna' : `Škvrna ${cislo}`),
    poradie: (aktualna: number, spolu: number) => `${aktualna} z ${spolu}`,
    urcenyDruh: 'Určený druh',
    blizkoPrahu: 'Hodnota je blízko prahu – škvrna môže patriť do oboch skupín.',
    cestaKlucom: 'Cesta kľúčom',
    mozneDruhy: 'Druh zatiaľ neurčený – možné druhy',
    legenda: {
      zona0: 'zóna 0 (okraj)',
      zona1: 'zóna 1',
      zona2: 'zóna 2',
      zona3: 'zóna 3 (stred)',
      lem: 'lem',
      vynechane: 'vynechané okolie',
    },
    legendaPapier: 'papier = bez farby, obrys škvrny červený',
  },

  /** Texty určovacieho kľúča (cesta kľúčom na karte škvrny). */
  kluc: {
    kanaly: { L: 'jas', a: 'červenosť', b: 'žltosť' },
    crty: {
      farba_dL_mean: 'jas voči papieru',
      farba_chroma: 'sýtosť',
      farba_odtien_deg: 'tón',
      farba_dL_std: 'rozptyl jasu',
      farba_dL_p10: 'jas najtmavšej časti (p10)',
      farba_db_p50: 'žltosť (medián)',
      farba_db_p90: 'žltosť najžltšej časti (p90)',
      halo_da: 'červenosť lemu',
      lbp_P8R1_9: 'zrnitosť (LBP)',
      gabor_l32_odozva: 'hrubá textúra',
    } as Record<string, string>,
    zona: (kanal: string, zona: string) => `${kanal} zóny ${zona}`,
    stredMinusOkraj: (kanal: string) => `${kanal} stred − okraj`,
    skupiny: {
      tmave: 'tmavé – do hneda',
      svetle: 'svetlé – do žlta',
      neiste: 'neisté',
    },
    neisteSkupiny: (tmave: string, svetle: string) => `neisté (${tmave} / ${svetle})`,
    podskupiny: {
      do_cervena: 'do červena',
      stred: 'žltooranžové',
      do_zlta: 'čisto žlté',
    },
    textury: {
      nad_prahom: 'hrubá textúra (pleseň)',
      pod_prahom: 'jemnejšia textúra (baktérie)',
    },
    otazky: {
      jas: '1. jas',
      sytost: '2. sýtosť',
      ton: '3. tón',
      textura: '4. textúra',
    },
    nedaSaUrcit: 'nedá sa určiť (chýba hodnota črty)',
    vzdialenostOdHranice: 'vzdialenosť od hranice',
    neisteBlizkoHranice: 'neisté – blízko hranice',
    nieDalej: 'nie – ďalej',
    neistaZona: 'neistá zóna',
    blizkoPrahu: (crta: string, hodnota: string, prah: string, zona: string) => `${crta} ${hodnota} je blízko prahu ${prah} (± ${zona})`,
    medzi: (od: string, po: string) => `medzi ${od} a ${po}`,
  },
};

export type Texty = typeof sk;
