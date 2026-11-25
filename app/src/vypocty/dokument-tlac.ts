import {
  ajNie,
  hodnotyPod,
  hystereza,
  jeNieco,
  kruh,
  mapaOblasti,
  oblastCislo,
  oblastVObdlzniku,
  okrajovyPas,
  pocet,
  rozsirMasku,
  uzavriMasku,
  vybraneOblasti,
  vyplnDieryMasky,
  zuzMasku,
  type MapaOblasti,
} from './binarne';
import { prestavka } from './cas';
import { gaussBajty, medianovyFilter, priemerVOkne, uzavri, vzdialenost3, zmenLinearne, zmenNajblizsi, zmenPlochou } from './filtre';
import { inpaintTelea } from './inpaint';
import { labPixela, naLab8 } from './kanaly';
import { medianF32, medianFarby, medianHistogramu, median, neparne, odraz, okolo, percentil, vyplnMimo, vyrez, zaokruhli, type Obdlznik, type Obrazok } from './obrazok';
import { histogram, otsu } from './prahy';

const OKNO_TEXTU = 2.5;
const TEXT_K = 6.0;
const TEXT_MIN = 6.0;
const HUSTY_TEXT = Math.fround(0.35);
const ADAPTIVNY_PRAH = 10;

const ILUSTRACIA = 5.0;
const PLNA_TLAC_DE = 15.0;
const PLNA_TLAC_PLOCHA = 2.0;
const PLNA_TLAC_ROZMER = 1.6;
const PLNA_TLAC_OKRAJ = 2.5;
export const TMAVE_POZADIE = 10.0;

const ODHAD_STRANA = 400;
const OKNO_PAPIERA = 4;

const f32 = Math.fround;

/** L* (0–100), a*, b* vo float32 – ako lab_z_8bit v analýzach. */
export type Lab = { L: Float32Array; A: Float32Array; B: Float32Array };

/** JAS_Z_8BIT: 8-bitový jas OpenCV -> L* vo float32 (v · float32(100/255)). */
export const JAS8 = Float32Array.from({ length: 256 }, (_, v) => f32(v * f32(100 / 255)));

export function naLab(obr: Obrazok): Lab {
  const [L8, A8, B8] = naLab8(obr);
  const n = L8.length;
  const lab: Lab = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    lab.L[i] = JAS8[L8[i]];
    lab.A[i] = A8[i] - 128;
    lab.B[i] = B8[i] - 128;
  }
  return lab;
}

export function vyrezLab(lab: Lab, w: number, box: Obdlznik): Lab {
  return { L: vyrez(lab.L, w, box), A: vyrez(lab.A, w, box), B: vyrez(lab.B, w, box) };
}

/** Odhad farby (papiera alebo tlače) pre každý pixel; Lab sa počíta len pre potrebný obdĺžnik. */
export type MapaFarby = { oblast(box: Obdlznik): Lab };

/** Malý obrázok BGR zväčšený (cv2.resize INTER_LINEAR) na w × h a prevedený do Lab. */
export function mapaZMalehoObrazka(male: Uint8Array, sw: number, sh: number, w: number, h: number): MapaFarby {
  const velky = zmenLinearne(male, 3, sw, sh, w, h);
  const oblast = ([x0, y0, x1, y1]: Obdlznik): Lab => {
    const sirka = x1 - x0;
    const n = sirka * (y1 - y0);
    const lab: Lab = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
    let poslednaFarba = -1;
    let poslednyLab = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = 3 * (y * w + x);
        const farba = (velky[p] << 16) | (velky[p + 1] << 8) | velky[p + 2];
        if (farba !== poslednaFarba) {
          poslednyLab = labPixela(velky[p + 2], velky[p + 1], velky[p]);
          poslednaFarba = farba;
        }
        const i = (y - y0) * sirka + x - x0;
        lab.L[i] = JAS8[poslednyLab >>> 16];
        lab.A[i] = ((poslednyLab >>> 8) & 255) - 128;
        lab.B[i] = (poslednyLab & 255) - 128;
      }
    }
    return lab;
  };
  return { oblast };
}

/** Rozmer zmenšeného obrázka na odhad papiera a tlače. */
export function malyRozmer(w: number, h: number): [number, number] {
  const f = Math.min(1, ODHAD_STRANA / Math.max(h, w));
  return [Math.max(8, zaokruhli(w * f)), Math.max(8, zaokruhli(h * f))];
}

/** gradient_jasu: hypot(Sobel dx, Sobel dy) / 8 jasu vo float32 v obdĺžniku roviny pw × ph. */
export function gradientJasu(rovina: Float32Array, pw: number, ph: number, [x0, y0, x1, y1]: Obdlznik): Float32Array {
  const out = new Float32Array((x1 - x0) * (y1 - y0));
  for (let y = y0; y < y1; y++) {
    const r = [odraz(y - 1, ph) * pw, y * pw, odraz(y + 1, ph) * pw];
    for (let x = x0; x < x1; x++) {
      const l = odraz(x - 1, pw);
      const p = odraz(x + 1, pw);
      const dx = r.map((o) => f32(rovina[o + p] - rovina[o + l]));
      const hl = r.map((o) => f32(f32(rovina[o + l] + rovina[o + p]) + f32(rovina[o + x] * 2)));
      const gx = f32(f32(dx[0] + dx[2]) + f32(dx[1] * 2));
      const gy = f32(hl[2] - hl[0]);
      out[(y - y0) * (x1 - x0) + x - x0] = f32(f32(Math.hypot(gx, gy)) / 8);
    }
  }
  return out;
}

/** Papier = najväčšia svetlá oblasť s vyplnenými dierami, mierne zmenšená od okraja (maska 0/1). */
export function maskaStrany(obr: Obrazok, L8: Uint8Array): Uint8Array {
  const { sirka: w, vyska: h } = obr;
  const n = w * h;
  const dlhsia = Math.max(w, h);
  const cela = new Uint8Array(n).fill(1);
  const jas = gaussBajty(L8, w, h, Math.max(2, dlhsia / 300));
  const b = Math.max(2, Math.trunc(Math.min(h, w) / 25));
  const okraj = new Int32Array(256);
  let naOkraji = 0;
  const pridaj = (x0: number, x1: number, y0: number, y1: number) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++, naOkraji++) okraj[jas[y * w + x]]++;
    }
  };
  pridaj(0, w, 0, b);
  pridaj(0, w, h - b, h);
  pridaj(0, b, 0, h);
  pridaj(w - b, w, 0, h);
  const stred = new Int32Array(256);
  let vStrede = 0;
  for (let y = Math.trunc(h / 4); y < Math.trunc((3 * h) / 4); y++) {
    for (let x = Math.trunc(w / 4); x < Math.trunc((3 * w) / 4); x++, vStrede++) stred[jas[y * w + x]]++;
  }
  if (medianHistogramu(okraj, naOkraji) > 0.6 * medianHistogramu(stred, vStrede)) return cela;

  const prah = otsu(histogram(jas));
  const nadPrahom = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (jas[i] > prah) nadPrahom[i] = 1;
  const svetle = mapaOblasti(nadPrahom, w, h);
  if (svetle.pocet === 0) return cela;
  let najvacsia = 1;
  for (let c = 2; c <= svetle.pocet; c++) if (svetle.plocha[c] > svetle.plocha[najvacsia]) najvacsia = c;
  let strana = vyplnDieryMasky(oblastCislo(svetle.cisla, najvacsia), w, h);
  const podiel = pocet(strana) / n;
  if (podiel > 0.97 || podiel < 0.2) strana = cela;
  return zuzMasku(strana, w, h, kruh(dlhsia / 80));
}

/** Typický polomer ťahu písma v pixeloch (adaptívny prah ako cv2.adaptiveThreshold GAUSSIAN_C). */
export function hrubkaTahu(L8: Uint8Array, w: number, h: number, strana: Uint8Array): number {
  const okno = neparne(Math.max(15, Math.max(w, h) / 30));
  const priemer = gaussBajty(L8, w, h, 0, okno, true);
  const tmave = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (strana[i] && L8[i] - priemer[i] <= -ADAPTIVNY_PRAH) tmave[i] = 1;
  const m = mapaOblasti(tmave, w, h);
  if (m.pocet === 0) return 2.0;
  const vzdialenost = vzdialenost3(tmave, w, h);
  const vrcholy = new Float32Array(m.pocet + 1);
  for (let i = 0; i < vzdialenost.length; i++) vrcholy[m.cisla[i]] = Math.max(vrcholy[m.cisla[i]], vzdialenost[i]);
  const velke: number[] = [];
  for (let c = 1; c <= m.pocet; c++) if (m.plocha[c] >= 8) velke.push(vrcholy[c]);
  return velke.length ? percentil(velke, 75) : 2.0;
}

/** Text nájdený čiernym klobúkom (blackhat): čiary atramentu, ich okolie na vyplnenie a strana bez textu. */
export type Text = { ciary: Uint8Array; sLemom: Uint8Array; polomer: number; bezTextu: Obrazok };

/** Medián a medián absolútnych odchýlok blackhatu (float32) zadaného počtami párov (zatvorený jas, jas). */
function medianBlackhatu(pocty: Int32Array, spolu: number) {
  type Hodnoty = { v: number; n: number }[];
  const kTy = (zoznam: Hodnoty, k: number) => {
    let videne = 0;
    for (const { v, n } of zoznam) {
      videne += n;
      if (videne > k) return v;
    }
    return zoznam[zoznam.length - 1].v;
  };
  const medianZ = (zoznam: Hodnoty) => {
    zoznam.sort((a, b) => a.v - b.v);
    if (spolu % 2) return kTy(zoznam, spolu >> 1);
    return f32(f32(kTy(zoznam, (spolu >> 1) - 1) + kTy(zoznam, spolu >> 1)) / 2);
  };
  const hodnoty: Hodnoty = [];
  for (let k = 0; k < pocty.length; k++) if (pocty[k]) hodnoty.push({ v: f32(JAS8[k >> 8] - JAS8[k & 255]), n: pocty[k] });
  const med = medianZ(hodnoty);
  const odchylky = new Map<number, number>();
  for (const { v, n } of hodnoty) {
    const d = Math.abs(f32(v - med));
    odchylky.set(d, (odchylky.get(d) ?? 0) + n);
  }
  return { med, mad: medianZ([...odchylky].map(([v, n]) => ({ v, n }))) };
}

function odstranText(obr: Obrazok, L8: Uint8Array, strana: Uint8Array): Text {
  const { sirka: w, vyska: h } = obr;
  const hrubka = hrubkaTahu(L8, w, h, strana);
  const polomer = Math.max(2, zaokruhli(OKNO_TEXTU * hrubka));
  const uzavrete = uzavri(L8, w, h, kruh(polomer));

  const pocty = new Int32Array(65536);
  let spolu = 0;
  for (let i = 0; i < L8.length; i++) {
    if (!strana[i]) continue;
    pocty[(uzavrete[i] << 8) | L8[i]]++;
    spolu++;
  }
  let prah = TEXT_MIN;
  if (spolu > 0) {
    const { med, mad } = medianBlackhatu(pocty, spolu);
    prah = Math.max(TEXT_MIN, med + TEXT_K * (1.4826 * mad + 1e-3));
  }
  const slaby = f32(0.5 * prah);
  const silny = f32(prah);
  const slabe = new Uint8Array(w * h);
  const silne = new Uint8Array(w * h);
  for (let i = 0; i < L8.length; i++) {
    if (!strana[i]) continue;
    const v = f32(JAS8[uzavrete[i]] - JAS8[L8[i]]);
    if (v > slaby) slabe[i] = 1;
    if (v > silny) silne[i] = 1;
  }
  const ciary = hystereza(slabe, silne, w, h);
  const sLemom = rozsirMasku(ciary, w, h, kruh(Math.max(1, hrubka * 0.6)));
  return { ciary, sLemom, polomer, bezTextu: vyplnPozadie(obr, sLemom, polomer) };
}

/** Atrament nahradí farbou pozadia (uzavretie každého kanála), aj v hustom texte. */
export function vyplnPozadie(obr: Obrazok, diery: Uint8Array, polomer: number): Obrazok {
  const { sirka: w, vyska: h, data } = obr;
  const n = w * h;
  const pozadie = gaussBajty(uzavri(data, w, h, kruh(polomer), 3), w, h, Math.max(1, polomer / 2), 0, false, 3);
  const hustota = priemerVOkne(diery, w, h, neparne(4 * polomer + 1));
  const out = data.slice();
  for (let i = 0; i < n; i++) {
    if (!diery[i] && !(hustota[i] > HUSTY_TEXT)) continue;
    out[3 * i] = pozadie[3 * i];
    out[3 * i + 1] = pozadie[3 * i + 1];
    out[3 * i + 2] = pozadie[3 * i + 2];
  }
  return { sirka: w, vyska: h, data: out };
}

/** Farba papiera: zmenšený obrázok bez vynechaných pixelov, doplnený (inpaint TELEA) a mediánovo rozmazaný. */
export function odhadPapiera(obr: Obrazok, vynechat: Uint8Array, strana: Uint8Array): MapaFarby {
  const { sirka: w, vyska: h } = obr;
  const [sw, sh] = malyRozmer(w, h);
  const vynechane = zmenNajblizsi(vynechat, 1, w, h, sw, sh);
  const naStrane = zmenNajblizsi(strana, 1, w, h, sw, sh);
  const male = inpaintTelea(zmenPlochou(obr.data, 3, w, h, sw, sh), sw, sh, rozsirMasku(vynechane, sw, sh, kruh(1)), 3);
  const dobre = ajNie(naStrane, vynechane);
  if (jeNieco(dobre)) vyplnMimo(male, naStrane, medianFarby(male, dobre));
  const okno = Math.min(neparne(Math.max(sw, sh) / OKNO_PAPIERA), 255);
  return mapaZMalehoObrazka(medianovyFilter(male, sw, sh, okno), sw, sh, w, h);
}

/** Medián výšok útvarov atramentu s plochou aspoň 10 px. */
export function typickaVyskaPismena(m: MapaOblasti): number | null {
  const vysky: number[] = [];
  for (let c = 1; c <= m.pocet; c++) if (m.plocha[c] >= 10) vysky.push(m.maxY[c] - m.minY[c] + 1);
  return vysky.length ? median(vysky) : null;
}

/** Ilustrácie: útvary atramentu oveľa väčšie ako písmeno, uzavreté a s vyplnenými dierami. */
export function mapaIlustracii(atrament: Uint8Array, w: number, h: number, strana: Uint8Array): Uint8Array {
  const m = mapaOblasti(atrament, w, h);
  const prazdna = new Uint8Array(w * h);
  if (m.pocet === 0) return prazdna;
  const pismeno = typickaVyskaPismena(m) ?? 10.0;
  const hranica = ILUSTRACIA * pismeno;
  const velke = new Uint8Array(m.pocet + 1);
  for (let c = 1; c <= m.pocet; c++) {
    if (m.maxY[c] - m.minY[c] + 1 > hranica && m.maxX[c] - m.minX[c] + 1 > hranica) velke[c] = 1;
  }
  if (!jeNieco(velke)) return prazdna;
  const mapa = vyplnDieryMasky(uzavriMasku(vybraneOblasti(m.cisla, velke), w, h, kruh(Math.max(2, pismeno))), w, h);
  for (let i = 0; i < mapa.length; i++) mapa[i] &= strana[i];
  return mapa;
}

/** Plná tlač: veľké plochy výrazne odlišné od papiera s ostrým okrajom (pridá sa do `mapa`). */
function plnaTlac(mapa: Uint8Array, lab: Lab, odlisne: Uint8Array, papier: MapaFarby, w: number, h: number, pismeno: number): void {
  const m = mapaOblasti(odlisne, w, h);
  for (let c = 1; c <= m.pocet; c++) {
    const sirka = m.maxX[c] - m.minX[c] + 1;
    const vyska = m.maxY[c] - m.minY[c] + 1;
    if (m.plocha[c] < PLNA_TLAC_PLOCHA * pismeno * pismeno || Math.min(sirka, vyska) < PLNA_TLAC_ROZMER * pismeno) continue;
    const box = okolo(m.minX[c], m.minY[c], m.minX[c] + sirka, m.minY[c] + vyska, 3, w, h);
    const [x0, y0, x1, y1] = box;
    const bw = x1 - x0;
    const utvar = oblastVObdlzniku(m.cisla, w, box, c);
    const papierL = papier.oblast(box).L;
    const rozdielJasu = Float32Array.from(vyrez(lab.L, w, box), (v, i) => f32(v - papierL[i]));
    const kontrast = Math.abs(medianF32(hodnotyPod(rozdielJasu, utvar))) + 1.0;
    const strmost = percentil(hodnotyPod(gradientJasu(lab.L, w, h, box), okrajovyPas(utvar, bw, y1 - y0)), 90) + 1e-3;
    if (!(kontrast / strmost < PLNA_TLAC_OKRAJ)) continue;
    for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < bw; x++) if (utvar[y * bw + x]) mapa[(y0 + y) * w + x0 + x] = 1;
  }
}

/** Spoločný začiatok mapy tlače aj návrhu miest: jas, maska strany a nájdený text so stranou bez textu. */
export type Priprava = { L8: Uint8Array; strana: Uint8Array; text: Text };

export async function priprav(obr: Obrazok): Promise<Priprava> {
  const [L8] = naLab8(obr);
  const strana = maskaStrany(obr, L8);
  await prestavka();
  return { L8, strana, text: odstranText(obr, L8, strana) };
}

/** Mapa tlače (ilustrácie a plná tlač) zmenšená na rozmer pracovného obrázka. */
export async function mapaTlace(obr: Obrazok, sirkaPrace: number, vyskaPrace: number, priprava?: Priprava): Promise<Uint8Array> {
  const { sirka: w, vyska: h } = obr;
  const { strana, text } = priprava ?? (await priprav(obr));
  await prestavka();
  const lab = naLab(text.bezTextu);
  const pismeno = typickaVyskaPismena(mapaOblasti(text.ciary, w, h)) ?? 8.0;
  const papier = odhadPapiera(obr, text.ciary, strana);
  await prestavka();

  const tmavePozadie = new Uint8Array(w * h);
  const odlisne = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const riadok = papier.oblast([0, y, w, y + 1]);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (lab.L[i] < f32(riadok.L[x] - TMAVE_POZADIE)) tmavePozadie[i] = 1;
      if (!strana[i]) continue;
      const dL = f32(f32(lab.L[i] - riadok.L[x]) * 0.5);
      const da = f32(lab.A[i] - riadok.A[x]);
      const db = f32(lab.B[i] - riadok.B[x]);
      if (f32(Math.sqrt(f32(f32(f32(dL * dL) + f32(da * da)) + f32(db * db)))) > PLNA_TLAC_DE) odlisne[i] = 1;
    }
  }
  const mapa = mapaIlustracii(ajNie(text.ciary, tmavePozadie), w, h, strana);
  plnaTlac(mapa, lab, odlisne, papier, w, h, pismeno);
  const rozsirena = rozsirMasku(mapa, w, h, kruh(Math.max(2, pismeno)));
  if (w === sirkaPrace && h === vyskaPrace) return rozsirena;
  const zmensena = zmenPlochou(rozsirena, 1, w, h, sirkaPrace, vyskaPrace);
  for (let i = 0; i < zmensena.length; i++) if (zmensena[i]) zmensena[i] = 1;
  return zmensena;
}
