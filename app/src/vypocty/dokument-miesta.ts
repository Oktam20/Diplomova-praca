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
  JAS,
  TMAVE_POZADIE,
  malyRozmer,
  mapaZMalehoObrazka,
  naLab,
  odhadPapiera,
  priprav,
  vyplnPozadie,
  vyrezLab,
  type Lab,
  type MapaFarby,
  type Priprava,
} from './dokument-tlac';
import { doplnZOkolia, gauss, gradient, medianovyFilter, vzdialenost3, zmenNajblizsi, zmenPlochou } from './filtre';
import { median, medianHistogramu, neparne, okolo, percentil, vyrez, type Obdlznik, type Obrazok } from './obrazok';

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

/** Rozobratá strana dokumentu (ako Strana v analýzach). */
export type Strana = {
  obrazok: Obrazok;
  L8: Uint8Array;
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
  const bezTextu = vyplnPozadie(obr, text.sLemom, text.polomer);
  await prestavka();
  const lab = naLab(bezTextu);
  const tlac = aj(tlacPrace, maska);
  const papier = odhadPapiera(bezTextu, tlac, maska).oblast([0, 0, w, h]);
  const textBezPozadia = Uint8Array.from(text.sLemom, (v, i) => (lab.L[i] < papier.L[i] - TMAVE_POZADIE ? 0 : v));
  return { obrazok: obr, L8, maska, bezTextu, sLemom: text.sLemom, text: textBezPozadia, polomer: text.polomer, lab, papier, tlac };
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

/** Medián a 1,4826 · MAD hodnôt pod maskou (z histogramu po 0,01). */
function sumPapiera(hodnoty: Float32Array, maska: Uint8Array) {
  const KROK = 100;
  const MAX = 30000;
  const hist = new Int32Array(MAX + 1);
  let spolu = 0;
  for (let i = 0; i < hodnoty.length; i++) {
    if (!maska[i]) continue;
    hist[Math.min(Math.round(hodnoty[i] * KROK), MAX)]++;
    spolu++;
  }
  if (spolu === 0) return { med: 0, mad: 1 };
  const med2 = Math.round(2 * medianHistogramu(hist, spolu));
  const odchylky = new Int32Array(2 * MAX + 2);
  for (let b = 0; b <= MAX; b++) if (hist[b]) odchylky[Math.abs(2 * b - med2)] += hist[b];
  return { med: med2 / 2 / KROK, mad: (1.4826 * medianHistogramu(odchylky, spolu)) / 2 / KROK };
}

/** Farebný rozdiel od papiera s prahom podľa šumu papiera a hysteréziou. */
function rozdielOdPapiera({ lab, papier, maska: naStrane, obrazok }: Strana, tmavePovolene: Uint8Array): Uint8Array {
  const { sirka: w, vyska: h } = obrazok;
  const n = w * h;
  const dlhsia = Math.max(w, h);
  const de0 = new Float32Array(n);
  const sytost0 = new Float32Array(n);
  const teple0 = new Float32Array(n);
  const dL = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dL[i] = lab.L[i] - papier.L[i];
    const da = lab.A[i] - papier.A[i];
    const db = lab.B[i] - papier.B[i];
    const l = lab.L[i] - papier.L[i];
    de0[i] = l > 2 && db < 2 && da < 2 ? 0 : Math.sqrt(0.25 * l * l + da * da + db * db);
    sytost0[i] = Math.sqrt(da * da + db * db);
    teple0[i] = Math.max(da, db);
  }
  const sytost = gauss(sytost0, w, h, 1.2);
  const de = gauss(de0, w, h, 1.2);
  const teple = gauss(teple0, w, h, 1.2);
  const { med, mad } = sumPapiera(de, naStrane);
  const silny = Math.max(med + SILNY_K * mad, SILNY_MIN);
  const slaby = Math.max(med + SLABY_K * mad, SLABY_MIN);
  for (let i = 0; i < n; i++) {
    const farebne = (sytost[i] >= MIN_SYTOST && teple[i] > 1.0) || (tmavePovolene[i] && dL[i] < -SLABY_MIN);
    if (!naStrane[i] || !farebne) de[i] = 0;
  }
  let maska = hystereza(
    Uint8Array.from(de, (v) => (v > slaby ? 1 : 0)),
    Uint8Array.from(de, (v) => (v > silny ? 1 : 0)),
    w,
    h
  );
  maska = uzavriMasku(maska, w, h, kruh(Math.max(1, dlhsia / 600)));
  maska = vyplnVelkeObrysy(maska, w, h, najmensiaPlocha(dlhsia));
  return aj(maska, naStrane);
}

/** Vyradí nálezy pri okraji strany, v hustom texte, tlačené prvky a nálezy so slabým kontrastom. */
function odfiltruj(nalezy: Uint8Array, strana: Strana): Uint8Array {
  const { sirka: w, vyska: h } = strana.obrazok;
  const dlhsia = Math.max(w, h);
  const maska = odstranTlac(nalezy, strana, najmensiaPlocha(dlhsia));
  const ramik = strana.maska.slice();
  for (let x = 0; x < w; x++) ramik[x] = ramik[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) ramik[y * w] = ramik[y * w + w - 1] = 0;
  const odOkraja = vzdialenost3(ramik, w, h);

  const vysledok = new Uint8Array(w * h);
  const m = mapaOblasti(maska, w, h);
  for (let c = 1; c <= m.pocet; c++) {
    const ohranicenie = [m.minX[c], m.minY[c], m.maxX[c] + 1, m.maxY[c] + 1] as const;
    const box = okolo(...ohranicenie, 6, w, h);
    const nalez = oblastVObdlzniku(m.cisla, w, box, c);
    const plocha = pocet(nalez);

    const priOkraji = pocet(aj(nalez, Uint8Array.from(vyrez(odOkraja, w, box), (d) => (d < dlhsia * OKRAJ_STRANY ? 1 : 0))));
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

/** Posun do žlta alebo červena voči referencii a farba na teplej strane neutrálnej. */
function teple(a: number, b: number, refA: number, refB: number): boolean {
  return Math.max(a - refA, b - refB) >= TEPLY_POSUN && Math.max(a, b) > TEPLY_MIN;
}

function jeTeply(nalez: Uint8Array, box: Obdlznik, strana: Strana): boolean {
  const w = strana.obrazok.sirka;
  const farba = vyrezLab(strana.lab, w, box);
  const papier = vyrezLab(strana.papier, w, box);
  return teple(median(hodnotyPod(farba.A, nalez)), median(hodnotyPod(farba.B, nalez)), median(hodnotyPod(papier.A, nalez)), median(hodnotyPod(papier.B, nalez)));
}

/** Tlačený prvok: väčšina nálezu je tmavá a prechod na okraji je ostrý. */
function tlacenyPrvok(nalez: Uint8Array, box: Obdlznik, strana: Strana): boolean {
  const { sirka: w, vyska: h } = strana.obrazok;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const jas = Float32Array.from(vyrez(strana.L8, w, box), (v) => v * JAS);
  const okolie = ajNie(rozsirMasku(nalez, bw, bh, kruh(3)), nalez);
  if (!jeNieco(okolie)) return false;
  const vnutri = hodnotyPod(jas, nalez);
  const tmavaUroven = percentil(vnutri, 10);
  const kontrast = median(hodnotyPod(jas, okolie)) - tmavaUroven;
  if (kontrast <= 0) return false;
  const strmost = percentil(hodnotyPod(gradient(strana.L8, w, h, box), okrajovyPas(nalez, bw, bh)), 90) * JAS + 1e-3;
  const tmavych = vnutri.filter((v) => v < tmavaUroven + 0.25 * kontrast).length;
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
  const rozdiel = [lab.L, lab.A, lab.B].map((p) => median(hodnotyPod(p, velky)) - median(hodnotyPod(p, pas)));
  return Math.hypot(rozdiel[0], rozdiel[1], rozdiel[2]);
}

/** Očakávaná farba tlače: ako odhad papiera, ale len z pixelov tlače a s menším oknom. */
function odhadTlace(strana: Strana): MapaFarby {
  const { sirka: w, vyska: h } = strana.obrazok;
  const [sw, sh] = malyRozmer(w, h);
  const naTlaci = zmenNajblizsi(strana.tlac, 1, w, h, sw, sh);
  if (!jeNieco(naTlaci)) return { oblast: (box) => vyrezLab(strana.lab, w, box) };
  const male = doplnZOkolia(zmenPlochou(strana.bezTextu.data, 3, w, h, sw, sh), sw, sh, nie(naTlaci));
  const okno = Math.min(neparne(Math.max(sw, sh) / OKNO_TLACE), 255);
  return mapaZMalehoObrazka(medianovyFilter(male, sw, sh, okno), sw, sh, w, h);
}

/** Lab v obdĺžniku rozmazaný Gaussom (sigma 2) z o niečo väčšieho okolia. */
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
    const tepla = teple(farba.A[i], farba.B[i], ocakavana.A[i], ocakavana.B[i]) && L <= ocakavana.L[i] + SVETLEJSIE_AKO_TLAC;
    return tepla || L < ocakavana.L[i] - TMAVSIE_AKO_TLAC ? 1 : 0;
  });
}

/** Z nálezov odstráni časti, ktoré sú len tlač (mapa tlače), a ponechá škvrny na tlači. */
function odstranTlac(maska: Uint8Array, strana: Strana, minPlocha: number): Uint8Array {
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

  const tepla = teple(
    median(hodnotyPod(farba.A, kusok)),
    median(hodnotyPod(farba.B, kusok)),
    median(hodnotyPod(ocakavana.A, kusok)),
    median(hodnotyPod(ocakavana.B, kusok))
  );
  return tepla || !(sirkaOkraja(jas, kusok, bw, bh) < MAKKY_OKRAJ);
}

/** Šírka prechodu na okraji oblasti: kontrast voči okoliu / strmosť jasu na okraji. */
function sirkaOkraja(jas: Float32Array, oblast: Uint8Array, bw: number, bh: number): number {
  const okolie = ajNie(rozsirMasku(oblast, bw, bh, kruh(6)), rozsirMasku(oblast, bw, bh, kruh(2)));
  if (!jeNieco(okolie)) return Infinity;
  const kontrast = median(hodnotyPod(jas, okolie)) - percentil(hodnotyPod(jas, oblast), 10);
  return kontrast / (percentil(hodnotyPod(gradient(jas, bw, bh, [0, 0, bw, bh]), okrajovyPas(oblast, bw, bh)), 90) + 1e-3);
}
