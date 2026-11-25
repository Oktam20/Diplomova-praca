import {
  aj,
  ajNie,
  hodnotyPod,
  hystereza,
  jeNieco,
  konvexnyObal,
  kruh,
  mapaOblasti,
  naBity,
  nie,
  oblastCislo,
  oblastVObdlzniku,
  obrys,
  okrajovyPas,
  plochaObrysu,
  pocet,
  rozsirMasku,
  uzavriMasku,
  vyplnVelkeObrysy,
} from './binarne';
import { prestavka } from './cas';
import {
  JAS8,
  TMAVE_POZADIE,
  gradientJasu,
  malyRozmer,
  mapaZMalehoObrazka,
  naLab,
  odhadPapiera,
  priprav,
  vyrezLab,
  type Lab,
  type MapaFarby,
  type Priprava,
} from './dokument-tlac';
import { gauss, medianovyFilter, vzdialenost3, zmenNajblizsi, zmenPlochou } from './filtre';
import { inpaintTelea } from './inpaint';
import { medianF32, neparne, okolo, percentil, vyrez, type Obdlznik, type Obrazok } from './obrazok';

const SILNY_K = 4.0;
const SLABY_K = 2.0;
const SILNY_MIN = 4.5;
const SLABY_MIN = 3.5;
const MIN_SYTOST = 4.0;

const OKRAJ_STRANY = 1 / 40;
const TLAC_TMAVE = 0.55;
const TLAC_OKRAJ = 2.5;
const MIN_KONTRAST = 7.0;
const ODSTUP_KONTRASTU = 0.15;
const TEXT_VNUTRI = 0.8;
const TEXT_OKOLO = 0.72;

const TEPLY_POSUN = 6.0;
const TEPLY_MIN = 2.0;
const OKNO_TLACE = 8;
const SKVRNA_NA_TLACI = 0.2;
const SVETLEJSIE_AKO_TLAC = 3.0;
const TMAVSIE_AKO_TLAC = 15.0;
const KUSOK_MIN = 4;
const KUSOK_KOMPAKTNOST = 0.5;
const KUSOK_OKOLIE = 0.5;
const KUSOK_OKOLIE_MIN = 15;
const MAKKY_OKRAJ = 6.0;

const f32 = Math.fround;

/** Rozobratá strana dokumentu (ako Strana v analýzach); jas a lab sú vo float32. */
export type Strana = {
  obrazok: Obrazok;
  jas: Float32Array;
  maska: Uint8Array;
  bezTextu: Obrazok;
  sLemom: Uint8Array;
  text: Uint8Array;
  polomer: number;
  lab: Lab;
  papier: Lab;
  tlac: Uint8Array;
};

async function rozoberStranu(obr: Obrazok, tlacPrace: Uint8Array, priprava: Priprava): Promise<Strana> {
  const { sirka: w, vyska: h } = obr;
  const { L8, strana: maska, text } = priprava;
  const { bezTextu } = text;
  const lab = naLab(bezTextu);
  const tlac = aj(tlacPrace, maska);
  await prestavka();
  const papier = odhadPapiera(bezTextu, tlac, maska).oblast([0, 0, w, h]);
  const textBezPozadia = text.sLemom.slice();
  const jas = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (lab.L[i] < f32(papier.L[i] - TMAVE_POZADIE)) textBezPozadia[i] = 0;
    jas[i] = JAS8[L8[i]];
  }
  return { obrazok: obr, jas, maska, bezTextu, sLemom: text.sLemom, text: textBezPozadia, polomer: text.polomer, lab, papier, tlac };
}

/** Navrhnuté miesta škvŕn na strane a rozobratá strana. */
export async function navrhniMiesta(obr: Obrazok, tlac: Uint8Array, priprava?: Priprava) {
  const strana = await rozoberStranu(obr, tlac, priprava ?? (await priprav(obr)));
  await prestavka();
  const tmavePovolene = ajNie(strana.maska, strana.tlac);
  const nalezy = rozdielOdPapiera(strana, tmavePovolene);
  await prestavka();
  return { navrh: odfiltruj(nalezy, strana), strana };
}

const najmensiaPlocha = (dlhsia: number) => Math.max(12, Math.trunc(dlhsia * dlhsia * 4e-6));

/** Medián (float32 ako np.median) a 1,4826 · MAD hodnôt pod maskou. */
function sumPapiera(hodnoty: Float32Array, maska: Uint8Array) {
  const pod = new Float32Array(pocet(maska));
  for (let i = 0, k = 0; i < hodnoty.length; i++) if (maska[i]) pod[k++] = hodnoty[i];
  if (pod.length === 0) return { med: 0, mad: 1 };
  const med = medianF32(pod);
  for (let i = 0; i < pod.length; i++) pod[i] = Math.abs(f32(pod[i] - med));
  return { med, mad: 1.4826 * medianF32(pod) };
}

/** Farebný rozdiel od papiera s prahom podľa šumu papiera a hysteréziou. */
export function rozdielOdPapiera({ lab, papier, maska: naStrane, obrazok }: Strana, tmavePovolene: Uint8Array): Uint8Array {
  const { sirka: w, vyska: h } = obrazok;
  const n = w * h;
  const dlhsia = Math.max(w, h);
  const de0 = new Float32Array(n);
  const sytost0 = new Float32Array(n);
  const teple0 = new Float32Array(n);
  const dL = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = (dL[i] = f32(lab.L[i] - papier.L[i]));
    const da = f32(lab.A[i] - papier.A[i]);
    const db = f32(lab.B[i] - papier.B[i]);
    const pol = f32(0.5 * l);
    de0[i] = l > 2 && db < 2 && da < 2 ? 0 : f32(Math.sqrt(f32(f32(f32(pol * pol) + f32(da * da)) + f32(db * db))));
    sytost0[i] = f32(Math.hypot(da, db));
    teple0[i] = Math.max(da, db);
  }
  const sytost = gauss(sytost0, w, h, 1.2);
  const de = gauss(de0, w, h, 1.2);
  const teple = gauss(teple0, w, h, 1.2);
  const { med, mad } = sumPapiera(de, naStrane);
  const silny = f32(Math.max(med + SILNY_K * mad, SILNY_MIN));
  const slaby = f32(Math.max(med + SLABY_K * mad, SLABY_MIN));
  for (let i = 0; i < n; i++) {
    const farebne = (sytost[i] >= MIN_SYTOST && teple[i] > 1.0) || (tmavePovolene[i] && dL[i] < -SLABY_MIN);
    if (!naStrane[i] || !farebne) de[i] = 0;
  }
  const slabe = new Uint8Array(n);
  const silne = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (de[i] > slaby) slabe[i] = 1;
    if (de[i] > silny) silne[i] = 1;
  }
  let maska = hystereza(slabe, silne, w, h);
  maska = uzavriMasku(maska, w, h, kruh(Math.max(1, dlhsia / 600)));
  maska = vyplnVelkeObrysy(maska, w, h, najmensiaPlocha(dlhsia));
  return aj(maska, naStrane);
}

/** Vyradí nálezy pri okraji strany, v hustom texte, tlačené prvky a nálezy so slabým kontrastom. */
export function odfiltruj(nalezy: Uint8Array, strana: Strana): Uint8Array {
  const { sirka: w, vyska: h } = strana.obrazok;
  const dlhsia = Math.max(w, h);
  const maska = odstranTlac(nalezy, strana, najmensiaPlocha(dlhsia));
  const ramik = strana.maska.slice();
  for (let x = 0; x < w; x++) ramik[x] = ramik[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) ramik[y * w] = ramik[y * w + w - 1] = 0;
  const odOkraja = vzdialenost3(ramik, w, h);
  const blizkoOkraja = f32(dlhsia * OKRAJ_STRANY);

  const vysledok = new Uint8Array(w * h);
  const m = mapaOblasti(maska, w, h);
  for (let c = 1; c <= m.pocet; c++) {
    const ohranicenie = [m.minX[c], m.minY[c], m.maxX[c] + 1, m.maxY[c] + 1] as const;
    const box = okolo(...ohranicenie, 6, w, h);
    const nalez = oblastVObdlzniku(m.cisla, w, box, c);
    const plocha = pocet(nalez);

    const priOkraji = pocet(aj(nalez, Uint8Array.from(vyrez(odOkraja, w, box), (d) => (d < blizkoOkraja ? 1 : 0))));
    if (priOkraji / plocha > 0.5) continue;
    if (vHustomTexte(m.cisla, c, okolo(...ohranicenie, 3 * strana.polomer + 2, w, h), plocha, strana) && !jeTeply(nalez, box, strana)) continue;
    if (tlacenyPrvok(nalez, box, strana)) continue;
    if (kontrastSOkolim(nalez, plocha, box, strana) < MIN_KONTRAST) continue;
    vloz(vysledok, w, box, nalez);
  }
  return vysledok;
}

/** Vloží masku obdĺžnika do masky celej strany. */
function vloz(ciel: Uint8Array, w: number, [x0, y0, x1, y1]: Obdlznik, maska: Uint8Array): void {
  const sirka = x1 - x0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (maska[(y - y0) * sirka + x - x0]) ciel[y * w + x] = 1;
}

function vHustomTexte(cisla: Int32Array, c: number, box: Obdlznik, plocha: number, strana: Strana): boolean {
  const w = strana.obrazok.sirka;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const nalez = oblastVObdlzniku(cisla, w, box, c);
  const text = vyrez(strana.text, w, box);
  const okolie = ajNie(rozsirMasku(nalez, bw, bh, kruh(3 * strana.polomer)), rozsirMasku(nalez, bw, bh, kruh(2)));
  const textOkolo = pocet(okolie) > 0 ? pocet(aj(okolie, text)) / pocet(okolie) : 0;
  return pocet(aj(nalez, text)) / plocha > TEXT_VNUTRI || textOkolo > TEXT_OKOLO;
}

/** Posun do žlta alebo červena voči referencii a farba na teplej strane neutrálnej (float32 ako v numpy). */
function teple(a: number, b: number, refA: number, refB: number): boolean {
  return Math.max(f32(a - refA), f32(b - refB)) >= TEPLY_POSUN && Math.max(a, b) > TEPLY_MIN;
}

/** Mediány kanálov a*, b* pod maskou (np.median(..., axis=0) vo float32). */
const medianyAB = (lab: Lab, maska: Uint8Array) => [medianF32(hodnotyPod(lab.A, maska)), medianF32(hodnotyPod(lab.B, maska))];

function jeTeply(nalez: Uint8Array, box: Obdlznik, strana: Strana): boolean {
  const w = strana.obrazok.sirka;
  const [a, b] = medianyAB(vyrezLab(strana.lab, w, box), nalez);
  const [pa, pb] = medianyAB(vyrezLab(strana.papier, w, box), nalez);
  return teple(a, b, pa, pb);
}

/** Tlačený prvok: väčšina nálezu je tmavá a prechod na okraji je ostrý. */
function tlacenyPrvok(nalez: Uint8Array, box: Obdlznik, strana: Strana): boolean {
  const { sirka: w, vyska: h } = strana.obrazok;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const jas = vyrez(strana.jas, w, box);
  const okolie = ajNie(rozsirMasku(nalez, bw, bh, kruh(3)), nalez);
  if (!jeNieco(okolie)) return false;
  const vnutri = hodnotyPod(jas, nalez);
  const tmavaUroven = percentil(vnutri, 10);
  const kontrast = medianF32(hodnotyPod(jas, okolie)) - tmavaUroven;
  if (kontrast <= 0) return false;
  const strmost = percentil(hodnotyPod(gradientJasu(strana.jas, w, h, box), okrajovyPas(nalez, bw, bh)), 90) + 1e-3;
  const hranica = f32(tmavaUroven + 0.25 * kontrast);
  const tmavych = vnutri.filter((v) => v < hranica).length;
  return tmavych / vnutri.length > TLAC_TMAVE && kontrast / strmost < TLAC_OKRAJ;
}

/** Farebný rozdiel nálezu a pásu papiera v odstupe od neho. */
function kontrastSOkolim(nalez: Uint8Array, plocha: number, [x0, y0, x1, y1]: Obdlznik, strana: Strana): number {
  const { sirka: w, vyska: h } = strana.obrazok;
  const g = Math.max(3, Math.trunc(ODSTUP_KONTRASTU * Math.sqrt(plocha)));
  const velkyBox = okolo(x0, y0, x1, y1, g + 3, w, h);
  const [X0, Y0, X1, Y1] = velkyBox;
  const gw = X1 - X0;
  const gh = Y1 - Y0;
  const velky = new Uint8Array(gw * gh);
  for (let y = y0; y < y1; y++) velky.set(nalez.subarray((y - y0) * (x1 - x0), (y - y0 + 1) * (x1 - x0)), (y - Y0) * gw + x0 - X0);
  const pas = aj(ajNie(rozsirMasku(velky, gw, gh, kruh(g + 3)), rozsirMasku(velky, gw, gh, kruh(g))), vyrez(strana.maska, w, velkyBox));
  if (!jeNieco(pas)) return 0;
  const lab = vyrezLab(strana.lab, w, velkyBox);
  const rozdiel = [lab.L, lab.A, lab.B].map((p) => f32(medianF32(hodnotyPod(p, velky)) - medianF32(hodnotyPod(p, pas))));
  return f32(Math.sqrt(f32(f32(f32(rozdiel[0] * rozdiel[0]) + f32(rozdiel[1] * rozdiel[1])) + f32(rozdiel[2] * rozdiel[2]))));
}

/** Očakávaná farba tlače: ako odhad papiera, ale len z pixelov tlače a s menším oknom. */
function odhadTlace(strana: Strana): MapaFarby {
  const { sirka: w, vyska: h } = strana.obrazok;
  const [sw, sh] = malyRozmer(w, h);
  const naTlaci = zmenNajblizsi(strana.tlac, 1, w, h, sw, sh);
  if (!jeNieco(naTlaci)) return { oblast: (box) => vyrezLab(strana.lab, w, box) };
  const male = inpaintTelea(zmenPlochou(strana.bezTextu.data, 3, w, h, sw, sh), sw, sh, nie(naTlaci), 3);
  const okno = Math.min(neparne(Math.max(sw, sh) / OKNO_TLACE), 255);
  return mapaZMalehoObrazka(medianovyFilter(male, sw, sh, okno), sw, sh, w, h);
}

/** Lab v obdĺžniku rozmazaný Gaussom (sigma 2) z o niečo väčšieho okolia (jadro má polomer 8). */
function hladkyLab(lab: Lab, w: number, h: number, [x0, y0, x1, y1]: Obdlznik): Lab {
  const vacsi = okolo(x0, y0, x1, y1, 8, w, h);
  const [X0, Y0, X1, Y1] = vacsi;
  const vnutri: Obdlznik = [x0 - X0, y0 - Y0, x1 - X0, y1 - Y0];
  const rozmaz = (p: Float32Array) => vyrez(gauss(vyrez(p, w, vacsi), X1 - X0, Y1 - Y0, 2), X1 - X0, vnutri);
  return { L: rozmaz(lab.L), A: rozmaz(lab.A), B: rozmaz(lab.B) };
}

/** Pixely, ktoré sú teplejšie alebo oveľa tmavšie, ako by mala byť tlač. */
function odlisneOdTlace(farba: Lab, ocakavana: Lab): Uint8Array {
  return Uint8Array.from(farba.L, (L, i) => {
    const tepla = teple(farba.A[i], farba.B[i], ocakavana.A[i], ocakavana.B[i]) && L <= f32(ocakavana.L[i] + SVETLEJSIE_AKO_TLAC);
    return tepla || L < f32(ocakavana.L[i] - TMAVSIE_AKO_TLAC) ? 1 : 0;
  });
}

/** Z nálezov odstráni časti, ktoré sú len tlač (mapa tlače), a ponechá škvrny na tlači. */
export function odstranTlac(maska: Uint8Array, strana: Strana, minPlocha: number): Uint8Array {
  const { sirka: w, vyska: h } = strana.obrazok;
  const ocakavanaTlac = odhadTlace(strana);
  const vysledok = new Uint8Array(w * h);
  const m = mapaOblasti(maska, w, h);
  for (let c = 1; c <= m.pocet; c++) {
    const box = okolo(m.minX[c], m.minY[c], m.maxX[c] + 1, m.maxY[c] + 1, 6, w, h);
    const bw = box[2] - box[0];
    const bh = box[3] - box[1];
    const nalez = oblastVObdlzniku(m.cisla, w, box, c);
    const tlac = vyrez(strana.tlac, w, box);
    const naTlaci = aj(nalez, tlac);
    if (!jeNieco(naTlaci)) {
      vloz(vysledok, w, box, nalez);
      continue;
    }
    const farba = hladkyLab(strana.lab, w, h, box);
    const ocakavana = ocakavanaTlac.oblast(box);
    const odlisne = odlisneOdTlace(farba, ocakavana);
    const plocha = pocet(nalez);
    let zvysok: Uint8Array;
    if (pocet(naTlaci) > 0.5 * plocha) {
      zvysok = aj(nalez, odlisne);
      if (pocet(zvysok) < SKVRNA_NA_TLACI * plocha) continue;
    } else {
      zvysok = ajNie(nalez, ajNie(naTlaci, odlisne));
    }
    const jas = vyrez(strana.lab.L, w, box);
    const kusky = mapaOblasti(zvysok, bw, bh);
    for (let k = 1; k <= kusky.pocet; k++) {
      if (kusky.plocha[k] < minPlocha) continue;
      const kusok = oblastCislo(kusky.cisla, k);
      if (pocet(aj(kusok, tlac)) > 0.5 * kusky.plocha[k] && !skvrnaNaTlaci(kusok, kusky.plocha[k], nalez, farba, ocakavana, jas, bw, bh, minPlocha)) continue;
      vloz(vysledok, w, box, kusok);
    }
  }
  return vysledok;
}

/** Kúsok na tlači je škvrna, ak je dosť veľký, kompaktný a teplý alebo s mäkkým okrajom. */
function skvrnaNaTlaci(
  kusok: Uint8Array,
  plocha: number,
  nalez: Uint8Array,
  farba: Lab,
  ocakavana: Lab,
  jas: Float32Array,
  bw: number,
  bh: number,
  minPlocha: number
): boolean {
  if (plocha < KUSOK_MIN * minPlocha) return false;

  const g = Math.max(KUSOK_OKOLIE_MIN, Math.trunc(KUSOK_OKOLIE * Math.sqrt(plocha)));
  const pw = bw + 2 * g;
  const ph = bh + 2 * g;
  const sOkrajom = new Uint8Array(pw * ph);
  for (let y = 0; y < bh; y++) sOkrajom.set(kusok.subarray(y * bw, (y + 1) * bw), (y + g) * pw + g);
  const rozsireny = rozsirMasku(sOkrajom, pw, ph, kruh(g));
  let okolie = 0;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (rozsireny[(y + g) * pw + x + g] && nalez[y * bw + x]) okolie++;
  if (plocha < SKVRNA_NA_TLACI * okolie) return false;

  const prvy = kusok.indexOf(1);
  const obal = konvexnyObal(obrys(naBity(kusok, bw, bh), prvy % bw, Math.trunc(prvy / bw)));
  if (plocha < KUSOK_KOMPAKTNOST * plochaObrysu(obal)) return false;

  const [a, b] = medianyAB(farba, kusok);
  const [oa, ob] = medianyAB(ocakavana, kusok);
  return teple(a, b, oa, ob) || sirkaOkraja(jas, kusok, bw, bh) >= MAKKY_OKRAJ;
}

/** Šírka prechodu na okraji oblasti: kontrast voči okoliu / strmosť jasu na okraji. */
function sirkaOkraja(jas: Float32Array, oblast: Uint8Array, bw: number, bh: number): number {
  const okolie = ajNie(rozsirMasku(oblast, bw, bh, kruh(6)), rozsirMasku(oblast, bw, bh, kruh(2)));
  if (!jeNieco(okolie)) return Infinity;
  const kontrast = medianF32(hodnotyPod(jas, okolie)) - percentil(hodnotyPod(jas, oblast), 10);
  return kontrast / (percentil(hodnotyPod(gradientJasu(jas, bw, bh, [0, 0, bw, bh]), okrajovyPas(oblast, bw, bh)), 90) + 1e-3);
}
