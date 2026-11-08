import { crtySkvrny, odhadniPapier, textura, type Crty } from './crty';
import kluc from './manualny-kluc.json';
import { obrazokCrt } from './obrazok-crt';
import type { Obrazok } from './obrazok';

export type Skupina = 'tmave' | 'svetle' | 'neiste';

/** Jedna otázka kľúča na ceste k výsledku. */
export type KrokCesty = { otazka: string; popis: string; vysledok: string };

export type Urcenie = {
  skupina: Skupina | null;
  nazov: string;
  podskupina: string | null;
  druhy: string[];
  druh: string | null;
  cesta: KrokCesty[];
};

/** Určená škvrna: názov (Škvrna, Škvrna 2, ...), výsledok kľúča a obrázok čŕt (PNG base64). */
export type Skvrna = { nazov: string; urcenie: Urcenie; obrazok: string | null };

type Krok = 'krok_2' | 'svetle_ton' | 'stred_gabor' | 'tmave_druhy' | 'stred_hladke_druhy';

/** Kroky kľúča ostávajú uložené v JSON, použijú sa len zapnuté (aktivne_kroky). */
const aktivny = (krok: Krok) => (kluc.aktivne_kroky as Record<string, unknown>)[krok] !== false;

/** Úspešnosť kľúča overená po kartičkách (zobrazí sa pod výsledkom). */
export const OVERENIE_KLUCA = aktivny('krok_2') ? kluc.krok_2.overenie_po_karticakch : kluc.overenie_po_karticakch;

const cislo = (v: number, miest = 1) => v.toFixed(miest).replace('.', ',').replace('-', '−');

/** „Alternaria_Alternata“ -> „Alternaria alternata“, „Arthrobacter_Sp“ -> „Arthrobacter sp.“ */
export function nazovDruhu(druh: string): string {
  const [rod, ...zvysok] = druh.split('_');
  const meno = zvysok.join(' ').toLowerCase();
  return `${rod} ${meno === 'sp' ? 'sp.' : meno}`.trim();
}

const KANAL = { L: 'jas', a: 'červenosť', b: 'žltosť' } as const;
const NAZVY_CRT: Record<string, string> = {
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
};

/** Zrozumiteľný názov črty (zóna 0 = okraj škvrny, zóna 3 = stred). */
function nazovCrty(crta: string): string {
  if (NAZVY_CRT[crta]) return NAZVY_CRT[crta];
  const zona = /^zona(\d)_d(L|a|b)$/.exec(crta);
  if (zona) return `${KANAL[zona[2] as 'L' | 'a' | 'b']} zóny ${zona[1]}`;
  const rozdiel = /^zona_stred_minus_okraj_d(L|a|b)$/.exec(crta);
  if (rozdiel) return `${KANAL[rozdiel[1] as 'L' | 'a' | 'b']} stred − okraj`;
  return crta;
}

const nazovSkupiny = (s: Skupina | null) => (s ? ((kluc.nazvy_skupin as Record<string, string>)[s] ?? s) : '–');

/** Otázka vetvy: jedna črta s prahom alebo dvojica čŕt (hranica je priamka). */
type Otazka = {
  typ?: string;
  crty: string[];
  smer: string | number;
  prah: number;
  druh: string;
  inak?: string;
  stred?: number[];
  mierka?: number[];
  uhol?: number;
  mierka_zony?: number;
  neista_zona?: number;
  druhy_v_otazke: string[];
};

/** Otázky vetvy (tmave_druhy, stred_hladke_druhy) postupne; vráti určené druhy alebo null. */
function vetva(meno: 'tmave_druhy' | 'stred_hladke_druhy', znak: string, crty: Crty, cesta: KrokCesty[]): string[] | null {
  const otazky = (kluc[meno] as unknown as { pravidla: Otazka[] }).pravidla;
  for (let i = 0; i < otazky.length; i++) {
    const o = otazky[i];
    const otazka = `${znak}${i + 1}. ${nazovDruhu(o.druh)}`;
    const hodnoty = o.crty.map((c) => crty[c]);
    if (hodnoty.some((v) => v === undefined || !Number.isFinite(v))) return null;
    let ano: boolean;
    let popis: string;
    if (o.typ === 'dvojica') {
      const u = (o.uhol! * Math.PI) / 180;
      const z = hodnoty.map((v, k) => (v - o.stred![k]) / o.mierka![k]);
      const vzdialenost = (Number(o.smer) * (o.prah - (Math.cos(u) * z[0] + Math.sin(u) * z[1]))) / o.mierka_zony!;
      popis = `${o.crty.map((c, k) => `${nazovCrty(c)} ${cislo(hodnoty[k])}`).join(', ')} · vzdialenosť od hranice ${cislo(vzdialenost)}`;
      if (Math.abs(vzdialenost) <= (o.neista_zona ?? 0)) {
        cesta.push({ otazka, popis, vysledok: 'neisté – blízko hranice' });
        return [...o.druhy_v_otazke];
      }
      ano = vzdialenost > 0;
    } else {
      const v = hodnoty[0];
      ano = o.smer === '<=' ? v <= o.prah : v > o.prah;
      popis = `${nazovCrty(o.crty[0])} ${cislo(v)} ${ano === (o.smer === '<=') ? '≤' : '>'} ${cislo(o.prah)}`;
    }
    if (ano) {
      cesta.push({ otazka, popis, vysledok: nazovDruhu(o.druh) });
      return [o.druh];
    }
    if (i === otazky.length - 1 && o.inak) {
      cesta.push({ otazka, popis, vysledok: nazovDruhu(o.inak) });
      return [o.inak];
    }
    cesta.push({ otazka, popis, vysledok: 'nie – ďalej' });
  }
  return null;
}

/** Krok 1 (jas) a v neistej zóne krok 2 (sýtosť): tmavé alebo svetlé. */
function tmaveSvetle(crty: Crty, cesta: KrokCesty[]): { skupina: Skupina | null; nazov: string; druhy: string[] } {
  const jas = crty.farba_dL_mean;
  const sytost = crty.farba_chroma;
  const nazvy = kluc.nazvy_skupin;
  if (!Number.isFinite(jas)) return { skupina: null, nazov: 'nedá sa určiť (chýba hodnota črty)', druhy: [] };
  const zona = kluc.neista_zona ?? 0;
  const prah = cislo(kluc.prah);
  if (Math.abs(jas - kluc.prah) > zona) {
    const skupina = jas <= kluc.prah ? 'tmave' : 'svetle';
    cesta.push({ otazka: '1. jas', popis: `${nazovCrty('farba_dL_mean')} ${cislo(jas)} ${jas <= kluc.prah ? '≤' : '>'} ${prah}`, vysledok: nazovSkupiny(skupina) });
    return { skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
  }
  const blizko = `${nazovCrty('farba_dL_mean')} ${cislo(jas)} je blízko prahu ${prah} (± ${cislo(zona)})`;
  if (!aktivny('krok_2') || !Number.isFinite(sytost)) {
    cesta.push({ otazka: '1. jas', popis: blizko, vysledok: nazovSkupiny('neiste') });
    return { skupina: 'neiste', nazov: `neisté (${nazvy.tmave} / ${nazvy.svetle})`, druhy: [...kluc.tmave, ...kluc.svetle] };
  }
  const skupina = sytost <= kluc.krok_2.prah ? 'tmave' : 'svetle';
  cesta.push({ otazka: '1. jas', popis: blizko, vysledok: 'neistá zóna' });
  cesta.push({
    otazka: '2. sýtosť',
    popis: `${nazovCrty('farba_chroma')} ${cislo(sytost)} ${sytost <= kluc.krok_2.prah ? '≤' : '>'} ${cislo(kluc.krok_2.prah)}`,
    vysledok: nazovSkupiny(skupina),
  });
  return { skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
}

/** Zaradenie škvrny kľúčom: jas, sýtosť, pri svetlých tón, pri strede textúra a vetvy po druhy. */
export function urci(crty: Crty, gabor: () => number | null): Urcenie {
  const cesta: KrokCesty[] = [];
  const { skupina, nazov, druhy: podlaJasu } = tmaveSvetle(crty, cesta);
  let druhy = podlaJasu;
  let podskupina: string | null = null;

  if (skupina === 'tmave' && aktivny('tmave_druhy')) druhy = vetva('tmave_druhy', 'T', crty, cesta) ?? druhy;

  const ton = kluc.svetle_ton;
  if (skupina === 'svetle' && aktivny('svetle_ton') && Number.isFinite(crty.farba_odtien_deg)) {
    const t = ((((crty.farba_odtien_deg - ton.ton_od) % 360) + 360) % 360) + ton.ton_od;
    const pod = t <= ton.prah_cervena ? 'do_cervena' : t > ton.prah_zlta ? 'do_zlta' : 'stred';
    podskupina = ton.nazvy_podskupin[pod];
    druhy = [...ton.podskupiny[pod]];
    const hranica =
      pod === 'do_cervena'
        ? `≤ ${cislo(ton.prah_cervena, 0)}°`
        : pod === 'do_zlta'
          ? `> ${cislo(ton.prah_zlta, 0)}°`
          : `medzi ${cislo(ton.prah_cervena, 0)}° a ${cislo(ton.prah_zlta, 0)}°`;
    cesta.push({ otazka: '3. tón', popis: `${nazovCrty('farba_odtien_deg')} ${cislo(t, 0)}° ${hranica}`, vysledok: podskupina });

    const krok = kluc.stred_gabor;
    const v = pod === 'stred' && aktivny('stred_gabor') ? gabor() : null;
    if (v !== null && Number.isFinite(v)) {
      crty[krok.crta] = v;
      const strana = v > krok.prah ? 'nad_prahom' : 'pod_prahom';
      druhy = [...krok[strana]];
      cesta.push({
        otazka: '4. textúra',
        popis: `${nazovCrty(krok.crta)} ${cislo(v, 0)} ${v > krok.prah ? '>' : '≤'} ${cislo(krok.prah, 0)}`,
        vysledok: krok.nazvy[strana],
      });
      if (strana === 'pod_prahom' && aktivny('stred_hladke_druhy')) druhy = vetva('stred_hladke_druhy', 'B', crty, cesta) ?? druhy;
    }
  }
  return { skupina, nazov, podskupina, druhy, druh: druhy.length === 1 ? druhy[0] : null, cesta };
}

/** Črty, určenie a obrázok čŕt jednej škvrny (null, ak je maska príliš malá). */
function urciSkvrnu(nazov: string, obr: Obrazok, maska: Uint8Array): Skvrna | null {
  const papier = odhadniPapier(obr, maska);
  if (!papier) return null;
  const { crty, zony, lem, vyrez } = crtySkvrny(papier, maska);
  const urcenie = urci(crty, () => textura(vyrez, kluc.stred_gabor.parametre.vlnova_dlzka));
  let obrazok: string | null = null;
  try {
    obrazok = obrazokCrt(obr, maska, zony, lem, papier.maska);
  } catch {}
  return { nazov, urcenie, obrazok };
}

/** Fotka jednej škvrny s jej maskou. */
export function urciFotku(obr: Obrazok, maska: Uint8Array): Skvrna[] {
  const skvrna = urciSkvrnu('Škvrna', obr, maska);
  return skvrna ? [skvrna] : [];
}

/** Dokument: každá vyrezaná škvrna zvlášť. */
export function urciVyrezy(vyrezy: { cislo: number; obrazok: Obrazok; maska: Uint8Array }[]): Skvrna[] {
  return vyrezy.map((v) => urciSkvrnu(`Škvrna ${v.cislo}`, v.obrazok, v.maska)).filter((s): s is Skvrna => s !== null);
}
