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
import {
  doplnZOkolia,
  gaussBajty,
  gradient,
  linearnyBod,
  medianovyFilter,
  priemerVOkne,
  uzavri,
  vzdialenost3,
  zmenNajblizsi,
  zmenPlochou,
} from './filtre';
import { labPixela, naLab8 } from './kanaly';
import {
  medianFarby,
  medianHistogramu,
  median,
  neparne,
  okolo,
  percentil,
  vyplnMimo,
  vyrez,
  zaokruhli,
  type Obdlznik,
  type Obrazok,
} from './obrazok';
import { histogram, otsu } from './prahy';

const OKNO_TEXTU = 2.5;
const TEXT_K = 6.0;
const TEXT_MIN = 6.0;
const HUSTY_TEXT = 0.35;
const ADAPTIVNY_PRAH = 10;

const ILUSTRACIA = 5.0;
const PLNA_TLAC_DE = 15.0;
const PLNA_TLAC_PLOCHA = 2.0;
const PLNA_TLAC_ROZMER = 1.6;
const PLNA_TLAC_OKRAJ = 2.5;
export const TMAVE_POZADIE = 10.0;

const ODHAD_STRANA = 400;
const OKNO_PAPIERA = 4;

/** L* (0–100), a*, b* ako reálne čísla. */
export type Lab = { L: Float32Array; A: Float32Array; B: Float32Array };

export const JAS = 100 / 255;

export function naLab(obr: Obrazok): Lab {
  const [L, A, B] = naLab8(obr);
  return {
    L: Float32Array.from(L, (v) => v * JAS),
    A: Float32Array.from(A, (v) => v - 128),
    B: Float32Array.from(B, (v) => v - 128),
  };
}

export function vyrezLab(lab: Lab, w: number, box: Obdlznik): Lab {
  return { L: vyrez(lab.L, w, box), A: vyrez(lab.A, w, box), B: vyrez(lab.B, w, box) };
}

/** Odhad farby (papiera alebo tlače) pre každý pixel; Lab sa počíta len pre potrebný obdĺžnik. */
export type MapaFarby = { oblast(box: Obdlznik): Lab };

/** Malý obrázok BGR zväčšený (INTER_LINEAR) na w x h a prevedený do Lab. */
export function mapaZMalehoObrazka(male: Uint8Array, sw: number, sh: number, w: number, h: number): MapaFarby {
  const bodyX = Array.from({ length: w }, (_, x) => linearnyBod(x, sw / w, sw));
  const xa = Int32Array.from(bodyX, (b) => b[0]);
  const xb = Int32Array.from(bodyX, (b) => b[1]);
  const ax = Float32Array.from(bodyX, (b) => b[2]);
  const oblast = ([x0, y0, x1, y1]: Obdlznik): Lab => {
    const sirka = x1 - x0;
    const n = sirka * (y1 - y0);
    const lab: Lab = { L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n) };
    let poslednaFarba = -1;
    let poslednyLab = 0;
    for (let y = y0; y < y1; y++) {
      const [ya, yb, ay] = linearnyBod(y, sh / h, sh);
      for (let x = x0; x < x1; x++) {
        let farba = 0;
        for (let c = 0; c < 3; c++) {
          const px = (yy: number, xx: number) => male[(yy * sw + xx) * 3 + c];
          const hore = px(ya, xa[x]) + (px(ya, xb[x]) - px(ya, xa[x])) * ax[x];
          const dole = px(yb, xa[x]) + (px(yb, xb[x]) - px(yb, xa[x])) * ax[x];
          const v = zaokruhli(hore + (dole - hore) * ay);
          farba = (farba << 8) | (v < 0 ? 0 : v > 255 ? 255 : v);
        }
        if (farba !== poslednaFarba) {
          poslednyLab = labPixela(farba & 255, (farba >>> 8) & 255, farba >>> 16);
          poslednaFarba = farba;
        }
        const i = (y - y0) * sirka + x - x0;
        lab.L[i] = (poslednyLab >>> 16) * JAS;
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

/** Papier = najväčšia svetlá oblasť s vyplnenými dierami, mierne zmenšená od okraja. */
function maskaStrany(obr: Obrazok, L8: Uint8Array): Uint8Array {
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
  const svetle = mapaOblasti(Uint8Array.from(jas, (v) => (v > prah ? 1 : 0)), w, h);
  if (svetle.pocet === 0) return cela;
  let najvacsia = 1;
  for (let c = 2; c <= svetle.pocet; c++) if (svetle.plocha[c] > svetle.plocha[najvacsia]) najvacsia = c;
  let strana = vyplnDieryMasky(oblastCislo(svetle.cisla, najvacsia), w, h);
  const podiel = pocet(strana) / n;
  if (podiel > 0.97 || podiel < 0.2) strana = cela;
  return zuzMasku(strana, w, h, kruh(dlhsia / 80));
}

/** Typický polomer ťahu písma v pixeloch. */
function hrubkaTahu(L8: Uint8Array, w: number, h: number, strana: Uint8Array): number {
  const okno = neparne(Math.max(15, Math.max(w, h) / 30));
  const priemer = gaussBajty(L8, w, h, 0.3 * ((okno - 1) * 0.5 - 1) + 0.8, okno);
  const tmave = Uint8Array.from(L8, (v, i) => (strana[i] && v - priemer[i] <= -ADAPTIVNY_PRAH ? 1 : 0));
  const m = mapaOblasti(tmave, w, h);
  if (m.pocet === 0) return 2.0;
  const vzdialenost = vzdialenost3(tmave, w, h);
  const vrcholy = new Float32Array(m.pocet + 1);
  for (let i = 0; i < vzdialenost.length; i++) vrcholy[m.cisla[i]] = Math.max(vrcholy[m.cisla[i]], vzdialenost[i]);
  const velke: number[] = [];
  for (let c = 1; c <= m.pocet; c++) if (m.plocha[c] >= 8) velke.push(vrcholy[c]);
  return velke.length ? percentil(velke, 75) : 2.0;
}

/** Text nájdený čiernym klobúkom (blackhat): čiary atramentu a ich okolie na vyplnenie. */
export type Text = { ciary: Uint8Array; sLemom: Uint8Array; polomer: number };

function odstranText(L8: Uint8Array, w: number, h: number, strana: Uint8Array): Text {
  const hrubka = hrubkaTahu(L8, w, h, strana);
  const polomer = Math.max(2, zaokruhli(OKNO_TEXTU * hrubka));
  const uzavrete = uzavri(L8, w, h, kruh(polomer));
  const blackhat = Uint8Array.from(L8, (v, i) => uzavrete[i] - v);

  const hist = new Int32Array(256);
  let spolu = 0;
  for (let i = 0; i < blackhat.length; i++) {
    if (!strana[i]) continue;
    hist[blackhat[i]]++;
    spolu++;
  }
  let med = 0;
  let mad = 0;
  if (spolu > 0) {
    med = medianHistogramu(hist, spolu);
    const odchylky = new Int32Array(512);
    for (let v = 0; v < 256; v++) if (hist[v]) odchylky[Math.abs(2 * v - 2 * med)] += hist[v];
    mad = medianHistogramu(odchylky, spolu) / 2;
  }
  const prah = Math.max(TEXT_MIN, med * JAS + TEXT_K * (1.4826 * mad * JAS + 1e-3));
  const slabe = Uint8Array.from(blackhat, (v, i) => (strana[i] && v * JAS > 0.5 * prah ? 1 : 0));
  const silne = Uint8Array.from(blackhat, (v, i) => (strana[i] && v * JAS > prah ? 1 : 0));
  const ciary = hystereza(slabe, silne, w, h);
  return { ciary, sLemom: rozsirMasku(ciary, w, h, kruh(Math.max(1, hrubka * 0.6))), polomer };
}

/** Atrament nahradí farbou pozadia (uzavretie každého kanála), aj v hustom texte. */
export function vyplnPozadie(obr: Obrazok, diery: Uint8Array, polomer: number): Obrazok {
  const { sirka: w, vyska: h, data } = obr;
  const n = w * h;
  const pozadie = new Uint8Array(n * 3);
  for (let c = 0; c < 3; c++) {
    const kanal = Uint8Array.from({ length: n }, (_, i) => data[3 * i + c]);
    const hladke = gaussBajty(uzavri(kanal, w, h, kruh(polomer)), w, h, Math.max(1, polomer / 2));
    hladke.forEach((v, i) => (pozadie[3 * i + c] = v));
  }
  const hustota = priemerVOkne(Float32Array.from(diery), w, h, neparne(4 * polomer + 1));
  const out = data.slice();
  for (let i = 0; i < n; i++) {
    if (diery[i] || hustota[i] > HUSTY_TEXT) out.set(pozadie.subarray(3 * i, 3 * i + 3), 3 * i);
  }
  return { sirka: w, vyska: h, data: out };
}

/** Farba papiera: zmenšený obrázok bez vynechaných pixelov, doplnený z okolia a mediánovo rozmazaný. */
export function odhadPapiera(obr: Obrazok, vynechat: Uint8Array, strana: Uint8Array): MapaFarby {
  const { sirka: w, vyska: h } = obr;
  const [sw, sh] = malyRozmer(w, h);
  const vynechane = zmenNajblizsi(vynechat, 1, w, h, sw, sh);
  const naStrane = zmenNajblizsi(strana, 1, w, h, sw, sh);
  const male = doplnZOkolia(zmenPlochou(obr.data, 3, w, h, sw, sh), sw, sh, rozsirMasku(vynechane, sw, sh, kruh(1)));
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
  return Uint8Array.from(mapa, (v, i) => v & strana[i]);
}

/** Plná tlač: veľké plochy výrazne odlišné od papiera s ostrým okrajom (pridá sa do `mapa`). */
function plnaTlac(mapa: Uint8Array, L8: Uint8Array, odlisne: Uint8Array, papier: MapaFarby, w: number, h: number, pismeno: number): void {
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
    const rozdielJasu = Float32Array.from(vyrez(L8, w, box), (v, i) => v * JAS - papierL[i]);
    const kontrast = Math.abs(median(hodnotyPod(rozdielJasu, utvar))) + 1.0;
    const strmost = percentil(hodnotyPod(gradient(L8, w, h, box), okrajovyPas(utvar, bw, y1 - y0)), 90) * JAS + 1e-3;
    if (!(kontrast / strmost < PLNA_TLAC_OKRAJ)) continue;
    for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < bw; x++) if (utvar[y * bw + x]) mapa[(y0 + y) * w + x0 + x] = 1;
  }
}

/** Spoločný začiatok mapy tlače aj návrhu miest: jas, maska strany a nájdený text. */
export type Priprava = { L8: Uint8Array; strana: Uint8Array; text: Text };

export async function priprav(obr: Obrazok): Promise<Priprava> {
  const [L8] = naLab8(obr);
  const strana = maskaStrany(obr, L8);
  await prestavka();
  return { L8, strana, text: odstranText(L8, obr.sirka, obr.vyska, strana) };
}

/** Mapa tlače (ilustrácie a plná tlač) zmenšená na rozmer pracovného obrázka. */
export async function mapaTlace(obr: Obrazok, sirkaPrace: number, vyskaPrace: number, priprava?: Priprava): Promise<Uint8Array> {
  const { sirka: w, vyska: h } = obr;
  const { strana, text } = priprava ?? (await priprav(obr));
  await prestavka();
  const [L8, A8, B8] = naLab8(vyplnPozadie(obr, text.sLemom, text.polomer));
  const pismeno = typickaVyskaPismena(mapaOblasti(text.ciary, w, h)) ?? 8.0;
  const papier = odhadPapiera(obr, text.ciary, strana);
  await prestavka();

  const tmavePozadie = new Uint8Array(w * h);
  const odlisne = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const riadok = papier.oblast([0, y, w, y + 1]);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dL = L8[i] * JAS - riadok.L[x];
      if (dL < -TMAVE_POZADIE) tmavePozadie[i] = 1;
      if (!strana[i]) continue;
      const da = A8[i] - 128 - riadok.A[x];
      const db = B8[i] - 128 - riadok.B[x];
      if (Math.sqrt(0.25 * dL * dL + da * da + db * db) > PLNA_TLAC_DE) odlisne[i] = 1;
    }
  }
  const mapa = mapaIlustracii(ajNie(text.ciary, tmavePozadie), w, h, strana);
  plnaTlac(mapa, L8, odlisne, papier, w, h, pismeno);
  const rozsirena = rozsirMasku(mapa, w, h, kruh(Math.max(2, pismeno)));
  if (w === sirkaPrace && h === vyskaPrace) return rozsirena;
  return Uint8Array.from(zmenPlochou(rozsirena, 1, w, h, sirkaPrace, vyskaPrace), (v) => (v > 0 ? 1 : 0));
}
