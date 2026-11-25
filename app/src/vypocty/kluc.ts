import { JAZYKY, type Jazyk, type Texty } from '../preklady';
import { crtySkvrny, odhadniPapier, textura, type Crty } from './crty';
import kluc from './manualny-kluc.json';
import { nahlad, obrazokCrt } from './obrazok-crt';
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

/** Určená škvrna: číslo (null pri režime Obrázok), výsledok kľúča v každom jazyku, obrázok čŕt a náhľad výrezu (PNG base64). */
export type Skvrna = { cislo: number | null; urcenie: Record<Jazyk, Urcenie>; obrazok: string | null; nahlad: string | null };

type Krok = 'krok_2' | 'svetle_ton' | 'stred_gabor' | 'tmave_druhy' | 'stred_hladke_druhy';

/** Kroky kľúča ostávajú uložené v JSON, použijú sa len zapnuté (aktivne_kroky). */
const aktivny = (krok: Krok) => (kluc.aktivne_kroky as Record<string, unknown>)[krok] !== false;

/** Úspešnosť kľúča overená po kartičkách (zobrazí sa pod výsledkom). */
export const OVERENIE_KLUCA = aktivny('krok_2') ? kluc.krok_2.overenie_po_karticakch : kluc.overenie_po_karticakch;

const cislo = (t: Texty, v: number, miest = 1) => v.toFixed(miest).replace('.', t.oddelovacDesatin).replace('-', '−');

/** „Alternaria_Alternata“ -> „Alternaria alternata“, „Arthrobacter_Sp“ -> „Arthrobacter sp.“ */
export function nazovDruhu(druh: string): string {
  const [rod, ...zvysok] = druh.split('_');
  const meno = zvysok.join(' ').toLowerCase();
  return `${rod} ${meno === 'sp' ? 'sp.' : meno}`.trim();
}

/** Zrozumiteľný názov črty (zóna 0 = okraj škvrny, zóna 3 = stred). */
function nazovCrty(t: Texty, crta: string): string {
  const { kanaly, crty, zona: nazovZony, stredMinusOkraj } = t.kluc;
  if (crty[crta]) return crty[crta];
  const zona = /^zona(\d)_d(L|a|b)$/.exec(crta);
  if (zona) return nazovZony(kanaly[zona[2] as 'L' | 'a' | 'b'], zona[1]);
  const rozdiel = /^zona_stred_minus_okraj_d(L|a|b)$/.exec(crta);
  if (rozdiel) return stredMinusOkraj(kanaly[rozdiel[1] as 'L' | 'a' | 'b']);
  return crta;
}

const nazovSkupiny = (t: Texty, s: Skupina | null) => (s ? t.kluc.skupiny[s] : '–');

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
function vetva(t: Texty, meno: 'tmave_druhy' | 'stred_hladke_druhy', znak: string, crty: Crty, cesta: KrokCesty[]): string[] | null {
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
      const crtyOtazky = o.crty.map((c, k) => `${nazovCrty(t, c)} ${cislo(t, hodnoty[k])}`).join(', ');
      popis = `${crtyOtazky} · ${t.kluc.vzdialenostOdHranice} ${cislo(t, vzdialenost)}`;
      if (Math.abs(vzdialenost) <= (o.neista_zona ?? 0)) {
        cesta.push({ otazka, popis, vysledok: t.kluc.neisteBlizkoHranice });
        return [...o.druhy_v_otazke];
      }
      ano = vzdialenost > 0;
    } else {
      const v = hodnoty[0];
      ano = o.smer === '<=' ? v <= o.prah : v > o.prah;
      popis = `${nazovCrty(t, o.crty[0])} ${cislo(t, v)} ${ano === (o.smer === '<=') ? '≤' : '>'} ${cislo(t, o.prah)}`;
    }
    if (ano) {
      cesta.push({ otazka, popis, vysledok: nazovDruhu(o.druh) });
      return [o.druh];
    }
    if (i === otazky.length - 1 && o.inak) {
      cesta.push({ otazka, popis, vysledok: nazovDruhu(o.inak) });
      return [o.inak];
    }
    cesta.push({ otazka, popis, vysledok: t.kluc.nieDalej });
  }
  return null;
}

/** Krok 1 (jas) a v neistej zóne krok 2 (sýtosť): tmavé alebo svetlé. */
function tmaveSvetle(t: Texty, crty: Crty, cesta: KrokCesty[]): { skupina: Skupina | null; nazov: string; druhy: string[] } {
  const jas = crty.farba_dL_mean;
  const sytost = crty.farba_chroma;
  const nazvy = t.kluc.skupiny;
  if (!Number.isFinite(jas)) return { skupina: null, nazov: t.kluc.nedaSaUrcit, druhy: [] };
  const zona = kluc.neista_zona ?? 0;
  const prah = cislo(t, kluc.prah);
  if (Math.abs(jas - kluc.prah) > zona) {
    const skupina = jas <= kluc.prah ? 'tmave' : 'svetle';
    cesta.push({
      otazka: t.kluc.otazky.jas,
      popis: `${nazovCrty(t, 'farba_dL_mean')} ${cislo(t, jas)} ${jas <= kluc.prah ? '≤' : '>'} ${prah}`,
      vysledok: nazovSkupiny(t, skupina),
    });
    return { skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
  }
  const blizko = t.kluc.blizkoPrahu(nazovCrty(t, 'farba_dL_mean'), cislo(t, jas), prah, cislo(t, zona));
  if (!aktivny('krok_2') || !Number.isFinite(sytost)) {
    cesta.push({ otazka: t.kluc.otazky.jas, popis: blizko, vysledok: nazovSkupiny(t, 'neiste') });
    return { skupina: 'neiste', nazov: t.kluc.neisteSkupiny(nazvy.tmave, nazvy.svetle), druhy: [...kluc.tmave, ...kluc.svetle] };
  }
  const skupina = sytost <= kluc.krok_2.prah ? 'tmave' : 'svetle';
  cesta.push({ otazka: t.kluc.otazky.jas, popis: blizko, vysledok: t.kluc.neistaZona });
  cesta.push({
    otazka: t.kluc.otazky.sytost,
    popis: `${nazovCrty(t, 'farba_chroma')} ${cislo(t, sytost)} ${sytost <= kluc.krok_2.prah ? '≤' : '>'} ${cislo(t, kluc.krok_2.prah)}`,
    vysledok: nazovSkupiny(t, skupina),
  });
  return { skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
}

/** Zaradenie škvrny kľúčom: jas, sýtosť, pri svetlých tón, pri strede textúra a vetvy po druhy. */
export function urci(crty: Crty, gabor: () => number | null, t: Texty): Urcenie {
  const cesta: KrokCesty[] = [];
  const { skupina, nazov, druhy: podlaJasu } = tmaveSvetle(t, crty, cesta);
  let druhy = podlaJasu;
  let podskupina: string | null = null;

  if (skupina === 'tmave' && aktivny('tmave_druhy')) druhy = vetva(t, 'tmave_druhy', 'T', crty, cesta) ?? druhy;

  const ton = kluc.svetle_ton;
  if (skupina === 'svetle' && aktivny('svetle_ton') && Number.isFinite(crty.farba_odtien_deg)) {
    const uhol = ((((crty.farba_odtien_deg - ton.ton_od) % 360) + 360) % 360) + ton.ton_od;
    const pod = uhol <= ton.prah_cervena ? 'do_cervena' : uhol > ton.prah_zlta ? 'do_zlta' : 'stred';
    podskupina = t.kluc.podskupiny[pod];
    druhy = [...ton.podskupiny[pod]];
    const hranica =
      pod === 'do_cervena'
        ? `≤ ${cislo(t, ton.prah_cervena, 0)}°`
        : pod === 'do_zlta'
          ? `> ${cislo(t, ton.prah_zlta, 0)}°`
          : t.kluc.medzi(`${cislo(t, ton.prah_cervena, 0)}°`, `${cislo(t, ton.prah_zlta, 0)}°`);
    cesta.push({ otazka: t.kluc.otazky.ton, popis: `${nazovCrty(t, 'farba_odtien_deg')} ${cislo(t, uhol, 0)}° ${hranica}`, vysledok: podskupina });

    const krok = kluc.stred_gabor;
    const v = pod === 'stred' && aktivny('stred_gabor') ? gabor() : null;
    if (v !== null && Number.isFinite(v)) {
      crty[krok.crta] = v;
      const strana = v > krok.prah ? 'nad_prahom' : 'pod_prahom';
      druhy = [...krok[strana]];
      cesta.push({
        otazka: t.kluc.otazky.textura,
        popis: `${nazovCrty(t, krok.crta)} ${cislo(t, v, 0)} ${v > krok.prah ? '>' : '≤'} ${cislo(t, krok.prah, 0)}`,
        vysledok: t.kluc.textury[strana],
      });
      if (strana === 'pod_prahom' && aktivny('stred_hladke_druhy')) druhy = vetva(t, 'stred_hladke_druhy', 'B', crty, cesta) ?? druhy;
    }
  }
  return { skupina, nazov, podskupina, druhy, druh: druhy.length === 1 ? druhy[0] : null, cesta };
}

/**
 * Črty, určenie a obrázok čŕt jednej škvrny (null, ak je maska príliš malá).
 * Obrázok čŕt a náhľad sa kreslia do `zobrazenie` – ten istý výrez vo vyššom rozlíšení a bez odstraňovania textu.
 */
function urciSkvrnu(cisloSkvrny: number | null, obr: Obrazok, maska: Uint8Array, zobrazenie: Obrazok = obr): Skvrna | null {
  const papier = odhadniPapier(obr, maska);
  if (!papier) return null;
  const { crty, zony, lem, vyrez } = crtySkvrny(papier, maska);
  let odozva: number | null | undefined;
  const gabor = () => (odozva === undefined ? (odozva = textura(vyrez, kluc.stred_gabor.parametre.vlnova_dlzka)) : odozva);
  const urcenie = Object.fromEntries(
    (Object.keys(JAZYKY) as Jazyk[]).map((jazyk) => {
      const u = urci({ ...crty }, gabor, JAZYKY[jazyk]);
      return [jazyk, { ...u, druhy: u.druhy.map(nazovDruhu), druh: u.druh && nazovDruhu(u.druh) }];
    })
  ) as Record<Jazyk, Urcenie>;
  const { sirka: w, vyska: h } = obr;
  let obrazok: string | null = null;
  try {
    obrazok = obrazokCrt(zobrazenie, w, h, maska, zony, lem, papier.maska);
  } catch {}
  return { cislo: cisloSkvrny, urcenie, obrazok, nahlad: nahlad(zobrazenie, w, h, maska) };
}

/** Fotka jednej škvrny s jej maskou. */
export function urciFotku(obr: Obrazok, maska: Uint8Array): Skvrna[] {
  const skvrna = urciSkvrnu(null, obr, maska);
  return skvrna ? [skvrna] : [];
}

/** Dokument: každá vyrezaná škvrna zvlášť. */
export function urciVyrezy(vyrezy: { cislo: number; obrazok: Obrazok; maska: Uint8Array; zobrazenie: Obrazok }[]): Skvrna[] {
  return vyrezy.map((v) => urciSkvrnu(v.cislo, v.obrazok, v.maska, v.zobrazenie)).filter((s): s is Skvrna => s !== null);
}
