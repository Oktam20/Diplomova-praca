import { ellipseHalfWidths } from './binary';
import { gaborResponse } from './gabor';
import { cvRound, reflect101, type BgrImage } from './image';
import kluc from './manualny-kluc.json';
import { distanceTransform5, percentile } from './raster';
import { spotFigurePng } from './spot-figure';

export type ManualKeyGroup = 'tmave' | 'svetle' | 'neiste';

export type SpotColor = {
  dL: number;
  chroma: number;
  odtien: number;
};

export type ManualKeyResult = {
  skupina: ManualKeyGroup | null;
  nazov: string;
  druhy: string[];
  crta: string;
  hodnota: number | null;
  prah: number;
  krok: 1 | 2;
  farba: SpotColor | null;
  podskupina: LightSubgroupResult | null;
  textura: TextureResult | null;
  druh: string | null;
  cesta: KrokCesty[];
  crty: SpotFeatures;
};

/** Jedna otázka kľúča na ceste k výsledku. */
export type KrokCesty = {
  otazka: string;
  popis: string;
  vysledok: string;
};

export type SpotFeatures = Record<string, number>;

export type TextureResult = {
  kluc: 'nad_prahom' | 'pod_prahom';
  nazov: string;
  hodnota: number;
};

export type LightSubgroup = 'do_cervena' | 'stred' | 'do_zlta';

export type LightSubgroupResult = {
  kluc: LightSubgroup;
  nazov: string;
  ton: number;
};

export type SpotGroup = {
  cast: 'cela_fotka' | `skvrna_${number}`;
  vysledok: ManualKeyResult;
  obrazok?: string;
};

/** Celý kľúč (prah, neistá zóna, spoľahlivosť po druhoch...) – na zobrazenie výsledku. */
export const MANUAL_KEY = kluc;

/** Ďalšie kroky kľúča – v JSON ostávajú uložené, ale použijú sa len zapnuté (aktivne_kroky). */
export type OptionalStep = 'krok_2' | 'svetle_ton' | 'stred_gabor' | 'tmave_druhy' | 'stred_hladke_druhy';

export function isStepActive(step: OptionalStep): boolean {
  const active = (kluc as { aktivne_kroky?: Partial<Record<OptionalStep, boolean>> }).aktivne_kroky;
  return active?.[step] ?? true;
}

const MIN_MASK_PIXELS = 200;
const PAPER_PROXY = 256;

/** Zaradenie škvrny: jas, sýtosť, pri svetlých tón a pri strede hrubá textúra. */
export function urcSkupinu(crty: SpotFeatures, gabor?: () => number | null): ManualKeyResult {
  const farba = colorFromFeatures(crty);
  const cesta: KrokCesty[] = [];
  let result: Omit<ManualKeyResult, 'druh' | 'cesta' | 'crty'> = urcTmaveSvetle(farba);
  if (result.hodnota !== null) {
    const zona = kluc.neista_zona ?? 0;
    const v = result.hodnota;
    cesta.push({
      otazka: '1. jas',
      popis:
        result.krok === 1 && result.skupina !== 'neiste'
          ? `${crtaNazov('farba_dL_mean')} ${fmt(v)} ${v <= kluc.prah ? '≤' : '>'} ${fmt(kluc.prah)}`
          : `${crtaNazov('farba_dL_mean')} ${fmt(v)} je blízko prahu ${fmt(kluc.prah)} (± ${fmt(zona)})`,
      vysledok: result.krok === 1 ? skupinaNazov(result.skupina) : 'neistá zóna',
    });
  }
  if (result.krok === 2 && farba) {
    cesta.push({
      otazka: '2. sýtosť',
      popis: `${crtaNazov('farba_chroma')} ${fmt(farba.chroma)} ${farba.chroma <= kluc.krok_2.prah ? '≤' : '>'} ${fmt(kluc.krok_2.prah)}`,
      vysledok: skupinaNazov(result.skupina),
    });
  }
  if (result.skupina === 'tmave' && isStepActive('tmave_druhy')) {
    const b = vetva('tmave_druhy', 'T', crty, cesta);
    if (b) result = { ...result, druhy: b };
  }
  if (result.skupina === 'svetle' && farba && isStepActive('svetle_ton')) {
    const pod = urcPodskupinuSvetle(farba.odtien);
    if (pod) {
      result = { ...result, podskupina: pod, druhy: [...kluc.svetle_ton.podskupiny[pod.kluc]] };
      cesta.push({
        otazka: '3. tón',
        popis:
          `${crtaNazov('farba_odtien_deg')} ${fmt(pod.ton, 0)}° ` +
          (pod.kluc === 'do_cervena'
            ? `≤ ${fmt(kluc.svetle_ton.prah_cervena, 0)}°`
            : pod.kluc === 'do_zlta'
              ? `> ${fmt(kluc.svetle_ton.prah_zlta, 0)}°`
              : `medzi ${fmt(kluc.svetle_ton.prah_cervena, 0)}° a ${fmt(kluc.svetle_ton.prah_zlta, 0)}°`),
        vysledok: pod.nazov,
      });
    }
  }
  const krok = kluc.stred_gabor;
  if (result.podskupina?.kluc === 'stred' && krok && gabor && isStepActive('stred_gabor')) {
    const v = gabor();
    if (v !== null && Number.isFinite(v)) {
      crty[krok.crta] = v;
      const strana = v > krok.prah ? 'nad_prahom' : 'pod_prahom';
      result = { ...result, textura: { kluc: strana, nazov: krok.nazvy[strana], hodnota: v }, druhy: [...krok[strana]] };
      cesta.push({
        otazka: '4. textúra',
        popis: `${crtaNazov(krok.crta)} ${fmt(v, 0)} ${v > krok.prah ? '>' : '≤'} ${fmt(krok.prah, 0)}`,
        vysledok: krok.nazvy[strana],
      });
      if (strana === 'pod_prahom' && isStepActive('stred_hladke_druhy')) {
        const b = vetva('stred_hladke_druhy', 'B', crty, cesta);
        if (b) result = { ...result, druhy: b };
      }
    }
  }
  return { ...result, druh: result.druhy.length === 1 ? result.druhy[0] : null, cesta, crty };
}

/** Otázka vetvy: jedna črta s prahom alebo dvojica čŕt (priamka). */
type VetvaOtazka = {
  typ?: 'crta' | 'dvojica';
  crta?: string;
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

/** Vetva kľúča (tmave_druhy, stred_hladke_druhy) */
function vetva(name: 'tmave_druhy' | 'stred_hladke_druhy', znak: string, crty: SpotFeatures, cesta: KrokCesty[]) {
  const rules = (kluc as unknown as Record<string, { pravidla?: VetvaOtazka[] } | undefined>)[name]?.pravidla ?? [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const label = `${znak}${i + 1}. ${druhKratko(r.druh)}`;
    const last = i === rules.length - 1;
    const values = r.crty.map((c) => crty[c]);
    if (values.some((v) => v === undefined || !Number.isFinite(v))) return null;
    let ano: boolean;
    let popis: string;
    if (r.typ === 'dvojica') {
      const u = (r.uhol! * Math.PI) / 180;
      const z = values.map((v, k) => (v - r.stred![k]) / r.mierka![k]);
      const p = Math.cos(u) * z[0] + Math.sin(u) * z[1];
      const m = (Number(r.smer) * (r.prah - p)) / r.mierka_zony!;
      popis = `${r.crty.map((c, k) => `${crtaNazov(c)} ${fmt(values[k])}`).join(', ')} · vzdialenosť od hranice ${fmt(m)}`;
      if (Math.abs(m) <= (r.neista_zona ?? 0)) {
        cesta.push({ otazka: label, popis, vysledok: 'neisté – blízko hranice' });
        return [...r.druhy_v_otazke];
      }
      ano = m > 0;
    } else {
      const v = values[0];
      ano = r.smer === '<=' ? v <= r.prah : v > r.prah;
      popis = `${crtaNazov(r.crty[0])} ${fmt(v)} ${ano === (r.smer === '<=') ? '≤' : '>'} ${fmt(r.prah)}`;
    }
    if (ano) {
      cesta.push({ otazka: label, popis, vysledok: druhKratko(r.druh) });
      return [r.druh];
    }
    if (last && r.inak) {
      cesta.push({ otazka: label, popis, vysledok: druhKratko(r.inak) });
      return [r.inak];
    }
    cesta.push({ otazka: label, popis, vysledok: 'nie – ďalej' });
  }
  return null;
}

const fmt = (v: number, digits = 1) => v.toFixed(digits).replace('.', ',').replace('-', '−');
const druhKratko = (s: string) => {
  const [g, ...rest] = s.split('_');
  const e = rest.join(' ').toLowerCase();
  return `${g} ${e === 'sp' ? 'sp.' : e}`.trim();
};
const skupinaNazov = (g: ManualKeyGroup | null) => (g ? kluc.nazvy_skupin[g as 'tmave' | 'svetle'] ?? g : '–');

/** Zrozumiteľný názov črty (zóna 0 = okraj škvrny, zóna 3 = stred). */
export function crtaNazov(c: string): string {
  const fixed: Record<string, string> = {
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
  if (fixed[c]) return fixed[c];
  const zona = /^zona(\d)_d(L|a|b)$/.exec(c);
  const kanal = { L: 'jas', a: 'červenosť', b: 'žltosť' } as const;
  if (zona) return `${kanal[zona[2] as 'L' | 'a' | 'b']} zóny ${zona[1]}`;
  const sm = /^zona_stred_minus_okraj_d(L|a|b)$/.exec(c);
  if (sm) return `${kanal[sm[1] as 'L' | 'a' | 'b']} stred − okraj`;
  return c;
}

/** Svetlá škvrna -> podskupina podľa tónu: do červena | stred (žltooranžové) | do žlta. */
export function urcPodskupinuSvetle(odtien: number): LightSubgroupResult | null {
  const krok = kluc.svetle_ton;
  if (!krok || !Number.isFinite(odtien)) return null;
  const ton = ((((odtien - krok.ton_od) % 360) + 360) % 360) + krok.ton_od;
  const pod: LightSubgroup =
    krok.prah_cervena !== null && ton <= krok.prah_cervena
      ? 'do_cervena'
      : krok.prah_zlta !== null && ton > krok.prah_zlta
        ? 'do_zlta'
        : 'stred';
  return { kluc: pod, nazov: krok.nazvy_podskupin[pod], ton };
}

/** Prvý krok (jas) a v neistej zóne druhý krok (sýtosť): tmavé / svetlé. */
function urcTmaveSvetle(farba: SpotColor | null): Omit<ManualKeyResult, 'druh' | 'cesta' | 'crty'> {
  const hodnota = farba && Number.isFinite(farba.dL) ? farba.dL : null;
  const base = { crta: kluc.crta, prah: kluc.prah, hodnota, farba, krok: 1 as const, podskupina: null, textura: null };
  if (hodnota === null) {
    return { ...base, skupina: null, nazov: 'nedá sa určiť (chýba hodnota črty)', druhy: [] };
  }
  const nazvy = kluc.nazvy_skupin;
  if (Math.abs(hodnota - kluc.prah) > (kluc.neista_zona ?? 0)) {
    const skupina = hodnota <= kluc.prah ? 'tmave' : 'svetle';
    return { ...base, skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
  }
  const krok2 = isStepActive('krok_2') ? kluc.krok_2 : null;
  if (!krok2 || !farba || !Number.isFinite(farba.chroma)) {
    return {
      ...base,
      skupina: 'neiste',
      nazov: `neisté (${nazvy.tmave} / ${nazvy.svetle})`,
      druhy: [...kluc.tmave, ...kluc.svetle],
    };
  }
  const skupina = farba.chroma <= krok2.prah ? 'tmave' : 'svetle';
  return { ...base, krok: 2, skupina, nazov: nazvy[skupina], druhy: [...kluc[skupina]] };
}

/** Po vytvorení masky: zaradí škvrnu na celom obrázku. */
export function urcMasku(image: BgrImage, mask: Uint8Array): SpotGroup[] {
  const model = paperModel(image, mask);
  return model === null ? [] : [classifySpot('cela_fotka', image, mask, model, checkedGaborLambda())];
}

/** Črty, zaradenie kľúčom a obrázok čŕt jednej škvrny. */
function classifySpot(
  cast: SpotGroup['cast'],
  image: BgrImage,
  mask: Uint8Array,
  model: PaperModel,
  lam: number
): SpotGroup {
  const { crty, zony, halo } = spotFeatures(model, mask);
  const vysledok = urcSkupinu(crty, () => gaborOdozva(model, mask, lam));
  let obrazok: string | undefined;
  try {
    obrazok = spotFigurePng(image, mask, zony, halo, model.paper);
  } catch {
    obrazok = undefined;
  }
  return { cast, vysledok, obrazok };
}

/** Dokument: zaradí každú vyrezanú škvrnu zvlášť (výrez zo stránky bez textu a maska škvrny v ňom. */
export function urcVyrezy(vyrezy: { cislo: number; image: BgrImage; mask: Uint8Array }[]): SpotGroup[] {
  const lam = checkedGaborLambda();
  const out: SpotGroup[] = [];
  for (const { cislo, image, mask } of vyrezy) {
    const model = paperModel(image, mask);
    if (model === null) continue;
    out.push(classifySpot(`skvrna_${cislo}`, image, mask, model, lam));
  }
  return out;
}

/** Overí, že kľúč používa len črty, ktoré aplikácia vie vypočítať; vráti λ Gaborovho kroku. */
function checkedGaborLambda(): number {
  if (
    kluc.crta !== 'farba_dL_mean' ||
    (kluc.krok_2 && kluc.krok_2.crta !== 'farba_chroma') ||
    (kluc.stred_gabor && !/^gabor_l\d+_odozva$/.test(kluc.stred_gabor.crta))
  ) {
    throw new Error('Manuálny kľúč používa črtu, ktorú aplikácia nevie vypočítať.');
  }
  return kluc.stred_gabor ? kluc.stred_gabor.parametre.vlnova_dlzka : 32;
}

/** Odhad farby papiera pre každý pixel. */
type PaperModel = {
  w: number;
  h: number;
  lab: [Float64Array, Float64Array, Float64Array];
  area: number;
  eqRadius: number;
  bgAt: (c: number, x: number, y: number) => number;
  paper: Uint8Array;
};

function paperModel(image: BgrImage, mask: Uint8Array): PaperModel | null {
  const { width: w, height: h } = image;
  const n = w * h;
  let area = 0;
  for (let i = 0; i < n; i++) if (mask[i]) area++;
  if (area < MIN_MASK_PIXELS) return null;
  const eqRadius = Math.sqrt(area / Math.PI);
  const lab = labFloat(image);

  const r = Math.max(1, cvRound(Math.max(5, 0.3 * eqRadius)));
  const dilated = dilateDisk(mask, w, h, r);
  let paper = new Uint8Array(n);
  for (let i = 0; i < n; i++) paper[i] = dilated[i] ? 0 : 1;
  let paperCount = paper.reduce((s, v) => s + v, 0);
  if (paperCount / n < 0.05) {
    paper = new Uint8Array(n);
    for (let i = 0; i < n; i++) paper[i] = mask[i] ? 0 : 1;
    paperCount = paper.reduce((s, v) => s + v, 0);
  }

  if (paperCount < 50) {
    const refs = lab.map((ch) => median(ch, null));
    return { w, h, lab, area, eqRadius, bgAt: (c) => refs[c], paper };
  }

  const f = Math.min(1, PAPER_PROXY / Math.max(h, w));
  const sw = Math.max(8, Math.trunc(w * f));
  const sh = Math.max(8, Math.trunc(h * f));
  const bw = f < 1 ? sw : w;
  const bh = f < 1 ? sh : h;
  const weightFull = Float64Array.from(paper);
  const weight = f < 1 ? resizeArea(weightFull, w, h, sw, sh) : weightFull;
  const sigma = Math.min(Math.max(eqRadius * f, 3.0), 0.5 * Math.min(sw, sh));
  const den = gaussianApprox(weight, bw, bh, sigma);
  const grids = lab.map((ch) => {
    const ref = median(ch, paper);
    const small = f < 1 ? resizeArea(ch, w, h, sw, sh) : ch;
    const weighted = new Float64Array(bw * bh);
    for (let i = 0; i < weighted.length; i++) weighted[i] = small[i] * weight[i];
    const num = gaussianApprox(weighted, bw, bh, sigma);
    const bg = new Float64Array(bw * bh);
    for (let i = 0; i < bg.length; i++) bg[i] = den[i] > 1e-3 ? num[i] / den[i] : ref;
    return bg;
  });

  const tapsX = Array.from({ length: w }, (_, x) => linearTap(x, bw / w, bw));
  const tapsY = Array.from({ length: h }, (_, y) => linearTap(y, bh / h, bh));
  const bgAt = (c: number, x: number, y: number) => {
    const bg = grids[c];
    const [x0, x1, ax] = tapsX[x];
    const [y0, y1, ay] = tapsY[y];
    const top = bg[y0 * bw + x0] * (1 - ax) + bg[y0 * bw + x1] * ax;
    const bottom = bg[y1 * bw + x0] * (1 - ax) + bg[y1 * bw + x1] * ax;
    return top * (1 - ay) + bottom * ay;
  };
  return { w, h, lab, area, eqRadius, bgAt, paper };
}

const N_ZONES = 4;

/** Črty škvrny, ktoré používa kľúč. */
function spotFeatures(model: PaperModel, mask: Uint8Array) {
  const { w, h, lab, bgAt, eqRadius } = model;
  const n = w * h;
  const rel = (c: number, i: number) => lab[c][i] - bgAt(c, i % w, Math.trunc(i / w));
  const crty: SpotFeatures = {};
  const names = ['dL', 'da', 'db'] as const;

  const vals: number[][] = [[], [], []];
  for (let i = 0; i < n; i++) if (mask[i]) for (let c = 0; c < 3; c++) vals[c].push(rel(c, i));
  const means = vals.map((v) => v.reduce((s, x) => s + x, 0) / v.length);
  names.forEach((name, c) => {
    const v = vals[c];
    const m = means[c];
    crty[`farba_${name}_mean`] = m;
    crty[`farba_${name}_std`] = Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / v.length);
    crty[`farba_${name}_p10`] = percentile(v, 10);
    crty[`farba_${name}_p50`] = percentile(v, 50);
    crty[`farba_${name}_p90`] = percentile(v, 90);
  });
  const color = toSpotColor(means);
  crty.farba_chroma = color.chroma;
  crty.farba_odtien_deg = color.odtien;

  const dist = distanceTransform5(mask, w, h);
  let dmax = 0;
  for (let i = 0; i < n; i++) if (dist[i] > dmax && dist[i] < 1e8) dmax = dist[i];
  const zony = new Int8Array(n).fill(-1);
  const zs = Array.from({ length: N_ZONES }, () => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const d = dist[i];
    if (!(d > 0) || dmax <= 0) continue;
    const z = Math.min(N_ZONES - 1, Math.max(0, Math.ceil((d * N_ZONES) / dmax) - 1));
    zony[i] = z;
    for (let c = 0; c < 3; c++) zs[z][c] += rel(c, i);
    zs[z][3]++;
  }
  for (let z = 0; z < N_ZONES; z++) {
    names.forEach((name, c) => {
      crty[`zona${z}_${name}`] = zs[z][3] ? zs[z][c] / zs[z][3] : NaN;
    });
  }
  names.forEach((name) => {
    crty[`zona_stred_minus_okraj_${name}`] = crty[`zona${N_ZONES - 1}_${name}`] - crty[`zona0_${name}`];
  });

  const r = Math.max(1, cvRound(Math.max(3, 0.15 * eqRadius)));
  const dil = dilateDisk(mask, w, h, r);
  const halo = new Uint8Array(n);
  const hs = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!dil[i] || mask[i]) continue;
    halo[i] = 1;
    for (let c = 0; c < 3; c++) hs[c] += rel(c, i);
    hs[3]++;
  }
  names.forEach((name, c) => {
    crty[`halo_${name}`] = hs[3] ? hs[c] / hs[3] : NaN;
  });

  const { cropL, cropM, cw, ch } = normalizedCrop(model, mask);
  const tex = erodeDisk(cropM, cw, ch, 3);
  const hist = lbpUniform(cropL, cw, ch, tex, 8, 1);
  hist.forEach((v, k) => {
    crty[`lbp_P8R1_${k}`] = v;
  });
  return { crty, zony, halo };
}

/** SpotColor z čŕt (krok 1, 2 a tón). */
function colorFromFeatures(crty: SpotFeatures): SpotColor | null {
  const dL = crty.farba_dL_mean;
  return Number.isFinite(dL) ? { dL, chroma: crty.farba_chroma, odtien: crty.farba_odtien_deg } : null;
}

function lbpUniform(crop: Float64Array, w: number, h: number, sel: Uint8Array, P: number, R: number): number[] {
  const u8 = new Float64Array(w * h);
  for (let i = 0; i < u8.length; i++) u8[i] = Math.trunc(Math.min(255, Math.max(0, (crop[i] + 100) * 2)));
  const round5 = (v: number) => Math.round(v * 1e5) / 1e5;
  const rp = Array.from({ length: P }, (_, p) => round5(-R * Math.sin((2 * Math.PI * p) / P)));
  const cp = Array.from({ length: P }, (_, p) => round5(R * Math.cos((2 * Math.PI * p) / P)));
  const px = (r: number, c: number) => (r < 0 || r >= h || c < 0 || c >= w ? 0 : u8[r * w + c]);
  const bilinear = (r: number, c: number) => {
    const r0 = Math.floor(r);
    const c0 = Math.floor(c);
    const r1 = Math.ceil(r);
    const c1 = Math.ceil(c);
    const dr = r - r0;
    const dc = c - c0;
    const top = (1 - dc) * px(r0, c0) + dc * px(r0, c1);
    const bottom = (1 - dc) * px(r1, c0) + dc * px(r1, c1);
    return (1 - dr) * top + dr * bottom;
  };
  const hist = new Array(P + 2).fill(0);
  const bits = new Array(P).fill(0);
  let total = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (!sel[r * w + c]) continue;
      const center = u8[r * w + c];
      for (let p = 0; p < P; p++) bits[p] = bilinear(r + rp[p], c + cp[p]) - center >= 0 ? 1 : 0;
      let changes = 0;
      for (let p = 0; p < P - 1; p++) if (bits[p] !== bits[p + 1]) changes++;
      const code = changes <= 2 ? bits.reduce((s, b) => s + b, 0) : P + 1;
      hist[code]++;
      total++;
    }
  }
  return hist.map((v) => v / Math.max(1, total));
}

const TEXTURE_DIAMETER = 256;

function normalizedCrop(model: PaperModel, mask: Uint8Array) {
  const { w, h, lab, eqRadius, bgAt } = model;
  let xmin = w;
  let xmax = -1;
  let ymin = h;
  let ymax = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
  }
  const margin = Math.trunc(Math.max(5, 0.3 * eqRadius));
  const y0 = Math.max(0, ymin - margin);
  const y1 = Math.min(h, ymax + margin + 1);
  const x0 = Math.max(0, xmin - margin);
  const x1 = Math.min(w, xmax + margin + 1);
  const rw = x1 - x0;
  const rh = y1 - y0;
  const s = TEXTURE_DIAMETER / (2 * eqRadius);
  const cw = Math.max(8, cvRound(rw * s));
  const ch = Math.max(8, cvRound(rh * s));

  const rel = new Float64Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = (y0 + y) * w + (x0 + x);
      rel[y * rw + x] = lab[0][i] - bgAt(0, x0 + x, y0 + y);
    }
  }
  const cropL = s < 1 ? resizeArea(rel, rw, rh, cw, ch) : resizeLinear(rel, rw, rh, cw, ch);
  const cropM = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(Math.floor((y * rh) / ch), rh - 1);
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(Math.floor((x * rw) / cw), rw - 1);
      cropM[y * cw + x] = mask[(y0 + sy) * w + (x0 + sx)] ? 1 : 0;
    }
  }
  return { cropL, cropM, cw, ch };
}

/** gabor_l<λ>_odozva škvrny (priemerná sila textúry pri vlnovej dĺžke λ). */
function gaborOdozva(model: PaperModel, mask: Uint8Array, lam: number): number | null {
  const { cropL, cropM, cw, ch } = normalizedCrop(model, mask);
  const region = erodeDisk(cropM, cw, ch, 3);
  let count = 0;
  let sum = 0;
  for (let i = 0; i < region.length; i++) {
    if (region[i]) {
      count++;
      sum += cropL[i];
    }
  }
  if (count < 50) return null;
  const img = Float64Array.from(cropL, (v, i) => (region[i] ? v : sum / count));
  const ksize = Math.trunc(6 * 0.56 * lam) | 1;
  const inner = erodeDisk(region, cw, ch, Math.min(ksize >> 2, 10));
  const sel = inner.reduce((s, v) => s + v, 0) >= 50 ? inner : region;
  return gaborResponse(img, cw, ch, sel, lam);
}

function toSpotColor([dL, da, db]: number[]): SpotColor {
  return {
    dL,
    chroma: Math.hypot(da, db),
    odtien: (Math.atan2(db, da) * 180) / Math.PI,
  };
}

/** L, a, b z cv2.cvtColor(bgr / 255 ako float32, COLOR_BGR2LAB) – L 0–100, a/b približne ±127. */
const SRGB_LINEAR = Float64Array.from({ length: 256 }, (_, v) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
});

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function labFloat(image: BgrImage): [Float64Array, Float64Array, Float64Array] {
  const { data } = image;
  const n = image.width * image.height;
  const L = new Float64Array(n);
  const A = new Float64Array(n);
  const B = new Float64Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const r = SRGB_LINEAR[data[p + 2]];
    const g = SRGB_LINEAR[data[p + 1]];
    const b = SRGB_LINEAR[data[p]];
    const X = (0.412453 * r + 0.35758 * g + 0.180423 * b) / 0.950456;
    const Y = 0.212671 * r + 0.71516 * g + 0.072169 * b;
    const Z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / 1.088754;
    const fY = labF(Y);
    L[i] = Y > 0.008856 ? 116 * fY - 16 : 903.3 * Y;
    A[i] = 500 * (labF(X) - fY);
    B[i] = 200 * (fY - labF(Z));
  }
  return [L, A, B];
}

/** cv2.erode(mask, MORPH_ELLIPSE (2r+1, 2r+1)) */
function erodeDisk(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = Uint8Array.from(mask, (v) => (v ? 0 : 1));
  return Uint8Array.from(dilateDisk(inv, w, h, r), (v) => (v ? 0 : 1));
}

/** cv2.resize(..., INTER_LINEAR) pre float obrázok (zväčšenie). */
function resizeLinear(src: Float64Array, sw: number, sh: number, dw: number, dh: number): Float64Array {
  const out = new Float64Array(dw * dh);
  const tx = Array.from({ length: dw }, (_, x) => linearTap(x, sw / dw, sw));
  for (let y = 0; y < dh; y++) {
    const [y0, y1, ay] = linearTap(y, sh / dh, sh);
    for (let x = 0; x < dw; x++) {
      const [x0, x1, ax] = tx[x];
      const top = src[y0 * sw + x0] * (1 - ax) + src[y0 * sw + x1] * ax;
      const bottom = src[y1 * sw + x0] * (1 - ax) + src[y1 * sw + x1] * ax;
      out[y * dw + x] = top * (1 - ay) + bottom * ay;
    }
  }
  return out;
}

/** cv2.dilate(mask, MORPH_ELLIPSE (2r+1, 2r+1)) cez behy riadkov – funguje aj pre veľké r. */
function dilateDisk(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const hw = ellipseHalfWidths(2 * r + 1);
  const out = new Uint8Array(w * h);
  for (let sy = 0; sy < h; sy++) {
    const row = sy * w;
    let x = 0;
    while (x < w) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      const s = x;
      while (x < w && mask[row + x]) x++;
      const e = x - 1;
      for (let i = 0; i <= 2 * r; i++) {
        const ty = sy + i - r;
        if (ty < 0 || ty >= h) continue;
        out.fill(1, ty * w + Math.max(0, s - hw[i]), ty * w + Math.min(w - 1, e + hw[i]) + 1);
      }
    }
  }
  return out;
}

/** np.median hodnôt (len tam, kde select[i] je 1; null = všetky). */
function median(values: Float64Array, select: Uint8Array | null): number {
  let count = 0;
  for (let i = 0; i < values.length; i++) if (!select || select[i]) count++;
  const v = new Float64Array(count);
  for (let i = 0, k = 0; i < values.length; i++) if (!select || select[i]) v[k++] = values[i];
  v.sort();
  const mid = count >> 1;
  return count % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** cv2.resize(..., INTER_AREA) pre float obrázok – priemer cez pokrytú plochu. */
function resizeArea(src: Float64Array, sw: number, sh: number, dw: number, dh: number): Float64Array {
  const taps = (srcLen: number, dstLen: number) => {
    const scale = srcLen / dstLen;
    return Array.from({ length: dstLen }, (_, d) => {
      const start = d * scale;
      const end = Math.min((d + 1) * scale, srcLen);
      const list: [number, number][] = [];
      for (let i = Math.floor(start); i < Math.ceil(end); i++) {
        const overlap = Math.min(end, i + 1) - Math.max(start, i);
        if (overlap > 1e-12) list.push([i, overlap / scale]);
      }
      return list;
    });
  };
  const tx = taps(sw, dw);
  const ty = taps(sh, dh);
  const tmp = new Float64Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (const [i, wgt] of tx[x]) s += src[y * sw + i] * wgt;
      tmp[y * dw + x] = s;
    }
  }
  const out = new Float64Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (const [j, wgt] of ty[y]) {
      for (let x = 0; x < dw; x++) out[y * dw + x] += tmp[j * dw + x] * wgt;
    }
  }
  return out;
}

/** Zdrojové indexy a váha pre cv2.INTER_LINEAR pri zväčšení (súradnica stredu pixela). */
function linearTap(d: number, scale: number, srcLen: number): [number, number, number] {
  const fx = (d + 0.5) * scale - 0.5;
  let s0 = Math.floor(fx);
  let a = fx - s0;
  if (s0 < 0) {
    s0 = 0;
    a = 0;
  }
  if (s0 >= srcLen - 1) {
    s0 = srcLen - 1;
    a = 0;
  }
  return [s0, Math.min(s0 + 1, srcLen - 1), a];
}

/** Gaussov filter (sigma) aproximovaný tromi krabicovými filtrami, okraj BORDER_REFLECT_101. */
function gaussianApprox(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const nBoxes = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / nBoxes + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - nBoxes * wl * wl - 4 * nBoxes * wl - 3 * nBoxes) / (-4 * wl - 4));
  let cur = src;
  for (let k = 0; k < nBoxes; k++) {
    const radius = ((k < m ? wl : wu) - 1) / 2;
    cur = boxBlur(cur, w, h, radius, true);
    cur = boxBlur(cur, w, h, radius, false);
  }
  return cur;
}

/** Priemer v okne (2r+1) po riadkoch (horizontal) alebo stĺpcoch, okraj BORDER_REFLECT_101. */
function boxBlur(src: Float64Array, w: number, h: number, r: number, horizontal: boolean): Float64Array {
  if (r <= 0) return src;
  const out = new Float64Array(w * h);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const idx = Int32Array.from({ length: len + 2 * r + 1 }, (_, k) => reflect101(k - r, len));
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    let s = 0;
    for (let k = 0; k < 2 * r + 1; k++) s += src[base + idx[k] * step];
    for (let p = 0; p < len; p++) {
      out[base + p * step] = s * norm;
      s += src[base + idx[p + 2 * r + 1] * step] - src[base + idx[p] * step];
    }
  }
  return out;
}
