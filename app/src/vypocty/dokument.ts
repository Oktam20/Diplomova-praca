import {
  aj,
  ajNie,
  jeNieco,
  kruh,
  mapaOblasti,
  maskaOblasti,
  oblastCislo,
  pocet,
  rozsirMasku,
  vyplnDieryMasky,
  zuzMasku,
  type MapaOblasti,
  type Oblasti,
} from './binarne';
import { CasVyprsal, prestavka, teraz } from './cas';
import { navrhniMiesta, type Strana } from './dokument-miesta';
import { mapaTlace, priprav } from './dokument-tlac';
import { zmenKubicky, zmenNajblizsi, zmenPlochou } from './filtre';
import { kandidati, skore } from './maska';
import { medianFarby, vyplnMimo, vyrez, vyrezObrazka, zaokruhli, type Obdlznik, type Obrazok } from './obrazok';

const OKNO_NASOBOK = 2.5;
const OKNO_MIN = 48;
const OKNO_STRANA = 700;
const ROZSIRENIE = 0.25;
const MIN_POKRYTIE = 0.3;
const MAX_OBDLZNIK = 0.92;

const VYREZ_NASOBOK = 2.0;
const VYREZ_MIN_PLOCHA = 150;
const ZLUCENIE = 0.3;

/**
 * Vyrezaná škvrna dokumentu – vstup pre určenie druhu. `box` je výrez s okrajom papiera, `skvrna` obdĺžnik
 * samotnej škvrny a `zobrazenie` ten istý výrez z pôvodnej fotky (bez odstraňovania textu).
 */
export type Vyrez = { cislo: number; box: Obdlznik; skvrna: Obdlznik; obrazok: Obrazok; maska: Uint8Array; zobrazenie: Obrazok };

/** Štvorcové okno okolo každého navrhnutého miesta (od najväčšieho). */
function okna(navrh: MapaOblasti, w: number, h: number) {
  const poradie = Array.from({ length: navrh.pocet }, (_, k) => k + 1).sort((a, b) => navrh.plocha[b] - navrh.plocha[a]);
  return poradie.map((c) => {
    const sirka = navrh.maxX[c] - navrh.minX[c] + 1;
    const vyska = navrh.maxY[c] - navrh.minY[c] + 1;
    const s = Math.max(OKNO_MIN, Math.trunc(Math.max(sirka, vyska) * OKNO_NASOBOK));
    const cx = navrh.minX[c] + (sirka >> 1);
    const cy = navrh.minY[c] + (vyska >> 1);
    const x1 = Math.min(w, Math.max(0, cx - (s >> 1)) + s);
    const y1 = Math.min(h, Math.max(0, cy - (s >> 1)) + s);
    return { box: [Math.max(0, x1 - s), Math.max(0, y1 - s), x1, y1] as Obdlznik, miesto: c };
  });
}

/** Súčty jednotiek v riadkoch masky – počet v úseku riadku za konštantný čas. */
function suctyRiadkov(maska: Uint8Array, w: number, h: number) {
  const sucty = new Int32Array((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sucty[y * (w + 1) + x + 1] = sucty[y * (w + 1) + x] + (maska[y * w + x] ? 1 : 0);
  return (y: number, od: number, po: number) => sucty[y * (w + 1) + po + 1] - sucty[y * (w + 1) + od];
}

/** Vlastný algoritmus s podmienkou navyše: oblasti pri navrhnutom mieste, ktoré ho dosť pokrývajú. */
function najlepsiaMaskaPri(obr: Obrazok, miesto: Uint8Array, koniec: number): Uint8Array {
  const { sirka: W, vyska: H } = obr;
  const g = Math.max(2, Math.trunc((ROZSIRENIE * Math.max(H, W)) / OKNO_NASOBOK));
  const blizko = suctyRiadkov(rozsirMasku(miesto, W, H, kruh(g)), W, H);
  const vJadre = suctyRiadkov(miesto, W, H);
  const jadro = pocet(miesto);

  let najlepsieSkore = -Infinity;
  let najlepsia: { oblasti: Oblasti; ponechat: Uint8Array } | null = null;
  for (const { maska, rozmazany } of kandidati(obr, koniec)) {
    const { oblasti } = maska;
    const { useky, cisloUseku } = oblasti;
    const ponechat = new Uint8Array(oblasti.pocet + 1);
    for (let y = 0; y < H; y++) {
      for (let i = useky.zaciatok[y]; i < useky.zaciatok[y + 1]; i++) {
        const c = cisloUseku[i];
        if (maska.ponechat[c] && !ponechat[c] && blizko(y, useky.od[i], useky.po[i]) > 0) ponechat[c] = 1;
      }
    }
    let plocha = 0;
    let [x0, y0, x1, y1] = [W, H, -1, -1];
    for (let c = 1; c <= oblasti.pocet; c++) {
      if (!ponechat[c]) continue;
      plocha += oblasti.plocha[c];
      x0 = Math.min(x0, oblasti.minX[c]);
      y0 = Math.min(y0, oblasti.minY[c]);
      x1 = Math.max(x1, oblasti.maxX[c]);
      y1 = Math.max(y1, oblasti.maxY[c]);
    }
    if (plocha === 0) continue;
    let pokryteJadro = 0;
    for (let y = 0; y < H; y++) {
      for (let i = useky.zaciatok[y]; i < useky.zaciatok[y + 1]; i++) {
        if (ponechat[cisloUseku[i]]) pokryteJadro += vJadre(y, useky.od[i], useky.po[i]);
      }
    }
    if (pokryteJadro < MIN_POKRYTIE * jadro) continue;
    if (plocha > MAX_OBDLZNIK * (x1 - x0 + 1) * (y1 - y0 + 1)) continue;
    const s = skore({ ...maska, ponechat, plocha }, rozmazany);
    if (s > najlepsieSkore) {
      najlepsieSkore = s;
      najlepsia = { oblasti, ponechat };
    }
  }
  if (!najlepsia) return new Uint8Array(W * H);
  return Uint8Array.from(maskaOblasti(najlepsia.oblasti, W, H, najlepsia.ponechat), (v) => (v ? 1 : 0));
}

/** Výrez strany bez textu; pixely mimo strany majú medián farby strany vo výreze (ako v analýzach). */
function vyrezBezTextu(strana: Strana, box: Obdlznik): Obrazok {
  const vyrezany = vyrezObrazka(strana.bezTextu, box);
  const naStrane = vyrez(strana.maska, strana.obrazok.sirka, box);
  const nIn = pocet(naStrane);
  if (nIn > 0 && nIn < naStrane.length) vyplnMimo(vyrezany.data, naStrane, medianFarby(vyrezany.data, naStrane));
  return vyrezany;
}

/** Maska vlastného algoritmu v jednom okne (v súradniciach okna, 0/1). */
function maskaVOkne(strana: Strana, navrh: MapaOblasti, box: Obdlznik, miesto: number, koniec: number) {
  const w = strana.obrazok.sirka;
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  const vyrezany = vyrezBezTextu(strana, box);
  const tohtoMiesta = oblastCislo(vyrez(navrh.cisla, w, box), miesto);

  const f = OKNO_STRANA / Math.max(bh, bw);
  const W = Math.max(1, zaokruhli(bw * f));
  const H = Math.max(1, zaokruhli(bh * f));
  const velky = f > 1 ? zmenKubicky(vyrezany.data, 3, bw, bh, W, H) : zmenPlochou(vyrezany.data, 3, bw, bh, W, H);
  const maska = najlepsiaMaskaPri({ sirka: W, vyska: H, data: velky }, zmenNajblizsi(tohtoMiesta, 1, bw, bh, W, H), koniec);
  return zmenNajblizsi(maska, 1, W, H, bw, bh);
}

/** Maska škvŕn na celej strane – vlastný algoritmus v okne okolo každého navrhnutého miesta. */
async function najdiSkvrny(navrhMaska: Uint8Array, strana: Strana, koniec: number) {
  const { sirka: w, vyska: h } = strana.obrazok;
  const navrh = mapaOblasti(navrhMaska, w, h);
  const vsetkyOkna = okna(navrh, w, h);
  const maska = new Uint8Array(w * h);
  let spracovanych = 0;
  let casVyprsal = false;
  for (const { box, miesto } of vsetkyOkna) {
    const [x0, y0, x1, y1] = box;
    let pokryte = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (navrh.cisla[y * w + x] === miesto && maska[y * w + x]) pokryte++;
    if (pokryte / navrh.plocha[miesto] > 0.5) continue;
    if (teraz() > koniec) {
      casVyprsal = true;
      break;
    }
    await prestavka();
    let vOkne: Uint8Array;
    try {
      vOkne = maskaVOkne(strana, navrh, box, miesto, koniec);
    } catch (chyba) {
      if (!(chyba instanceof CasVyprsal)) throw chyba;
      casVyprsal = true;
      break;
    }
    spracovanych++;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (vOkne[(y - y0) * (x1 - x0) + x - x0]) maska[y * w + x] = 1;
  }
  return { maska: aj(maska, strana.maska), okien: vsetkyOkna.length, spracovanych, casVyprsal };
}

/** Zlúči blízke časti masky do jednej škvrny; vráti čísla skupín a ich [x, y, šírka, výška, plocha]. */
function zlucBlizke(maska: Uint8Array, w: number, h: number) {
  const m = mapaOblasti(maska, w, h);
  const rodic = Int32Array.from({ length: m.pocet + 1 }, (_, i) => i);
  const koren = (a: number) => {
    while (rodic[a] !== a) {
      rodic[a] = rodic[rodic[a]];
      a = rodic[a];
    }
    return a;
  };
  const obdlzniky = Array.from({ length: m.pocet }, (_, k) => {
    const c = k + 1;
    const sirka = m.maxX[c] - m.minX[c] + 1;
    const vyska = m.maxY[c] - m.minY[c] + 1;
    const g = ZLUCENIE * Math.max(sirka, vyska);
    return [c, m.minX[c] - g, m.minY[c] - g, m.minX[c] + sirka + g, m.minY[c] + vyska + g];
  });
  for (let a = 0; a < obdlzniky.length; a++) {
    for (let b = a + 1; b < obdlzniky.length; b++) {
      const [i, ax0, ay0, ax1, ay1] = obdlzniky[a];
      const [j, bx0, by0, bx1, by1] = obdlzniky[b];
      if (ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1) rodic[koren(i)] = koren(j);
    }
  }
  const korene = [...new Set(Array.from({ length: m.pocet }, (_, k) => koren(k + 1)))].sort((a, b) => a - b);
  const noveCislo = new Int32Array(m.pocet + 1);
  for (let c = 1; c <= m.pocet; c++) noveCislo[c] = korene.indexOf(koren(c)) + 1;
  const skupiny = new Int32Array(m.cisla.length);
  for (let i = 0; i < skupiny.length; i++) skupiny[i] = noveCislo[m.cisla[i]];

  const udaje = Array.from({ length: korene.length + 1 }, () => [Infinity, Infinity, -1, -1, 0]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!skupiny[y * w + x]) continue;
      const u = udaje[skupiny[y * w + x]];
      u[0] = Math.min(u[0], x);
      u[1] = Math.min(u[1], y);
      u[2] = Math.max(u[2], x);
      u[3] = Math.max(u[3], y);
      u[4]++;
    }
  }
  return { skupiny, udaje: udaje.map(([x0, y0, x1, y1, plocha]) => [x0, y0, x1 - x0 + 1, y1 - y0 + 1, plocha]) };
}

/** Výrez z pôvodnej fotky (vyššie rozlíšenie, bez odstraňovania textu) pre obdĺžnik z pracovnej strany. */
function vyrezZPovodnej(povodna: Obrazok, praca: Obrazok, [x0, y0, x1, y1]: Obdlznik): Obrazok {
  const fx = povodna.sirka / praca.sirka;
  const fy = povodna.vyska / praca.vyska;
  return vyrezObrazka(povodna, [zaokruhli(x0 * fx), zaokruhli(y0 * fy), zaokruhli(x1 * fx), zaokruhli(y1 * fy)]);
}

/** Každú škvrnu vyreže s okrajom papiera – ako detailný záber jednej škvrny. */
function vyrezySkvrn(strana: Strana, povodna: Obrazok, maska: Uint8Array): Vyrez[] {
  const obr = strana.obrazok;
  const { sirka: w, vyska: h } = obr;
  const { skupiny, udaje } = zlucBlizke(maska, w, h);
  const vyrezy: Vyrez[] = [];
  for (let i = 1; i < udaje.length; i++) {
    const [x, y, sirka, vyska, plocha] = udaje[i];
    if (plocha < VYREZ_MIN_PLOCHA) continue;
    const s = Math.trunc(Math.max(sirka, vyska) * VYREZ_NASOBOK);
    const x0 = Math.max(0, x + (sirka >> 1) - (s >> 1));
    const y0 = Math.max(0, y + (vyska >> 1) - (s >> 1));
    const box: Obdlznik = [x0, y0, Math.min(w, x0 + s), Math.min(h, y0 + s)];
    if (Math.min(box[2] - x0, box[3] - y0) < 40) continue;
    const obrazok = vyrezBezTextu(strana, box);
    vyrezy.push({
      cislo: vyrezy.length + 1,
      box,
      skvrna: [x, y, x + sirka, y + vyska],
      obrazok,
      maska: oblastCislo(vyrez(skupiny, w, box), i),
      zobrazenie: vyrezZPovodnej(povodna, obr, box),
    });
  }
  return vyrezy;
}

const CISLICE = [
  [7, 5, 5, 5, 7],
  [2, 6, 2, 2, 7],
  [7, 1, 7, 4, 7],
  [7, 1, 7, 1, 7],
  [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7],
  [7, 4, 7, 5, 7],
  [7, 1, 1, 1, 1],
  [7, 5, 7, 5, 7],
  [7, 5, 7, 1, 7],
];

const BIELA = [255, 255, 255];
const CIERNA = [0, 0, 0];

/** Strana s bielym obrysom škvŕn a číslom pri každej škvrne (rovnaké poradie ako v zozname škvŕn). */
function prehlad(obr: Obrazok, maska: Uint8Array, vyrezy: Vyrez[]): Obrazok {
  const { sirka: w, vyska: h } = obr;
  const out = obr.data.slice();
  const hrubka = Math.max(2, zaokruhli(Math.max(w, h) / 500));
  const obdlznik = (x0: number, y0: number, x1: number, y1: number, farba: number[]) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) out.set(farba, 3 * (y * w + x));
  };
  // Ako cv2.drawContours(RETR_EXTERNAL, hrúbka): len vonkajší obrys (diery sa vyplnia), čiara hrúbky `hrubka` stredom na hranici.
  const vonkajsia = vyplnDieryMasky(maska, w, h);
  let okraj = ajNie(vonkajsia, zuzMasku(vonkajsia, w, h, kruh(1)));
  if (hrubka > 1) okraj = rozsirMasku(okraj, w, h, kruh((hrubka - 1) / 2));
  for (let i = 0; i < okraj.length; i++) if (okraj[i]) out.set(BIELA, 3 * i);

  // Číslice 3 × 5 bodov, biele s čiernym lemom – tesne nad ľavým horným rohom škvrny, ak sa tam zmestia, inak pod ňou.
  const bod = Math.max(2, zaokruhli((22 * hrubka) / 15));
  const vyskaCisla = 5 * bod;
  const medzera = 2 * hrubka;
  for (const { cislo, skvrna } of vyrezy) {
    const [sx0, sy0, , sy1] = skvrna;
    const text = String(cislo);
    const sirkaCisla = (4 * text.length - 1) * bod;
    const vrch = sy0 - medzera - vyskaCisla - hrubka >= 0 ? sy0 - medzera - vyskaCisla : Math.min(h - vyskaCisla - hrubka, sy1 + medzera);
    const lavo = Math.max(hrubka, Math.min(w - sirkaCisla - hrubka, sx0));
    const bunky: [number, number][] = [];
    [...text].forEach((znak, k) => {
      CISLICE[Number(znak)].forEach((riadok, ry) => {
        for (let rx = 0; rx < 3; rx++) {
          if ((riadok >> (2 - rx)) & 1) bunky.push([lavo + k * 4 * bod + rx * bod, vrch + ry * bod]);
        }
      });
    });
    for (const [px, py] of bunky) obdlznik(px - hrubka, py - hrubka, px + bod + hrubka, py + bod + hrubka, CIERNA);
    for (const [px, py] of bunky) obdlznik(px, py, px + bod, py + bod, BIELA);
  }
  return { sirka: w, vyska: h, data: out };
}

/**
 * Celá strana: mapa tlače, návrh miest, maska škvŕn, výrezy a obrázky na zobrazenie.
 * `povodna` je pôvodná fotka (ilustrácie alebo pracovná strana) – z nej sú výrezy na zobrazenie.
 */
export async function spracujStranu(praca: Obrazok, ilustracie: Obrazok | null, koniec: number, kolo: (nazov: string) => void) {
  const { sirka: w, vyska: h } = praca;
  const priprava = ilustracie ? undefined : await priprav(praca);
  const tlac = await mapaTlace(ilustracie ?? praca, w, h, priprava);
  kolo('mapa tlače');
  const { navrh, strana } = await navrhniMiesta(praca, tlac, priprava);
  kolo('text a návrh miest');
  const skvrny = await najdiSkvrny(navrh, strana, koniec);
  kolo(`vlastný algoritmus (${skvrny.spracovanych} okien)`);
  const povodna = ilustracie ?? praca;
  const vyrezy = vyrezySkvrn(strana, povodna, skvrny.maska);
  return { ...skvrny, vyrezy, povodna, prehlad: prehlad(praca, skvrny.maska, vyrezy) };
}
