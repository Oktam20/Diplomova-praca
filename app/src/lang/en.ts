import type { Texty } from './sk';

/** English texts of the app – the same keys as sk.ts. */
export const en: Texty = {
  kod: 'EN',
  oddelovacDesatin: '.',

  jazyk: {
    prepnut: 'Switch language to Slovak',
  },

  rezimy: {
    obrazok: 'Image',
    dokument: 'Document',
  },

  pohlady: {
    maska: 'Mask',
    original: 'Original',
    vyrez: 'Cutout',
  },

  skenovanie: {
    zdrojKamera: 'Scan',
    zdrojSubor: 'Upload file',
    nadpisSpracuva: 'Processing',
    nadpisSkontroluj: 'Check the mask',
    nadpisZnova: 'Try again',
    nadpisNahraj: 'Upload an image',
    nadpisZarovnaj: 'Centre the sample',
    spracuvaSa: 'Processing…',
    klasifikujeSa: 'Classifying…',
    nahrajZoSuboru: 'Upload a photo of the sample from a file.',
    potrebujemeKameru: 'We need access to the camera.',
    povolitKameru: 'Allow camera',
    klasifikovat: 'Classify',
    tipDokument: 'Photograph the whole page – the text is removed and the stains are found automatically.',
    tipObrazok: 'The mould should be in the centre of the image and fully visible.',
    skenovatZnova: 'Scan again',
    nahratSubor: 'Upload file',
  },

  spravy: {
    bezGalerie: 'An image cannot be selected without access to the gallery.',
    maskaSaNevytvorila: 'No mask was created.',
    spracovanieZlyhalo: 'Processing on the device failed.',
    klasifikaciaZlyhala: 'Classification failed.',
    ziadneMiesta: 'No stains were found on the page.',
    bezMasky: 'Candidate areas were found, but the algorithm did not find a mask in them.',
    casDokumentu: (spracovanych: number, okien: number) => `Time limit – processed ${spracovanych} of ${okien} areas.`,
    casObrazka: (sekund: number) => `Processing took longer than ${sekund} s and was stopped – an error probably occurred.`,
  },

  chyby: {
    pixely: 'Could not read the image pixels.',
    webviewPreruseny: 'The computation in the WebView was interrupted (out of memory?) – please try again.',
    webviewZatvoreny: 'The WebView was closed.',
    webviewZlyhal: 'The computation in the WebView failed.',
    webviewNedostupny: 'The computation in the WebView is not available – please scan the sample again.',
    podklad: 'The data for classification is no longer available – please scan the sample again.',
  },

  vysledok: {
    nadpis: 'Scan result',
    ziadnyVysledok: 'No result – scan a sample first.',
    ziadnaSkvrna: 'No stain that could be classified was found.',
    overenieKluca: (percent: number) => `Key accuracy on sample cards ${percent} %`,
    spracovanie: (sekundy: string) => `processing ${sekundy} s`,
    profil: 'Colour profile of the photo:',
    profilNeuvedeny: 'not specified (treated as sRGB)',
    prevedeneP3: ' – converted to sRGB like the training data',
    novySken: 'New scan',
  },

  skvrna: {
    nazov: (cislo: number | null) => (cislo === null ? 'Stain' : `Stain ${cislo}`),
    poradie: (aktualna: number, spolu: number) => `${aktualna} of ${spolu}`,
    urcenyDruh: 'Identified species',
    blizkoPrahu: 'The value is close to the threshold – the stain may belong to either group.',
    cestaKlucom: 'Path through the key',
    mozneDruhy: 'Species not determined yet – possible species',
    legenda: {
      zona0: 'zone 0 (edge)',
      zona1: 'zone 1',
      zona2: 'zone 2',
      zona3: 'zone 3 (centre)',
      lem: 'rim',
      vynechane: 'excluded surroundings',
    },
    legendaPapier: 'paper = no colour, stain outline red',
  },

  kluc: {
    kanaly: { L: 'lightness', a: 'redness', b: 'yellowness' },
    crty: {
      farba_dL_mean: 'lightness vs. paper',
      farba_chroma: 'saturation',
      farba_odtien_deg: 'hue',
      farba_dL_std: 'lightness spread',
      farba_dL_p10: 'lightness of the darkest part (p10)',
      farba_db_p50: 'yellowness (median)',
      farba_db_p90: 'yellowness of the most yellow part (p90)',
      halo_da: 'redness of the rim',
      lbp_P8R1_9: 'graininess (LBP)',
      gabor_l32_odozva: 'coarse texture',
    },
    zona: (kanal: string, zona: string) => `zone ${zona} ${kanal}`,
    stredMinusOkraj: (kanal: string) => `${kanal} centre − edge`,
    skupiny: {
      tmave: 'dark – brownish',
      svetle: 'light – yellowish',
      neiste: 'uncertain',
    },
    neisteSkupiny: (tmave: string, svetle: string) => `uncertain (${tmave} / ${svetle})`,
    podskupiny: {
      do_cervena: 'reddish',
      stred: 'yellow-orange',
      do_zlta: 'pure yellow',
    },
    textury: {
      nad_prahom: 'coarse texture (mould)',
      pod_prahom: 'finer texture (bacteria)',
    },
    otazky: {
      jas: '1. lightness',
      sytost: '2. saturation',
      ton: '3. hue',
      textura: '4. texture',
    },
    nedaSaUrcit: 'cannot be determined (feature value missing)',
    vzdialenostOdHranice: 'distance from the boundary',
    neisteBlizkoHranice: 'uncertain – close to the boundary',
    nieDalej: 'no – next question',
    neistaZona: 'uncertain zone',
    blizkoPrahu: (crta: string, hodnota: string, prah: string, zona: string) => `${crta} ${hodnota} is close to the threshold ${prah} (± ${zona})`,
    medzi: (od: string, po: string) => `between ${od} and ${po}`,
  },
};
