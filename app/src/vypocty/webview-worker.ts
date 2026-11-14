import dokument from '../../../analyzy/dokumenty/dokument.py';
import dokumentMiesta from '../../../analyzy/dokumenty/dokument_miesta.py';
import dokumentTlac from '../../../analyzy/dokumenty/dokument_tlac.py';
import maska from '../../../analyzy/skvrny/maska.py';
import subory from '../../../analyzy/skvrny/subory.py';
import aplikacia from './aplikacia.py';
import { urciFotku, urciVyrezy, type Skvrna } from './kluc';
import type { Obrazok } from './obrazok';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
const BALIKY = ['numpy', 'opencv-python', 'scikit-image'];

/** Python súbory analýz, ktoré sa nahrajú do Pyodide (cesta -> obsah). */
const PYTHON: Record<string, string> = {
  'skvrny/__init__.py': '',
  'skvrny/maska.py': maska,
  'skvrny/subory.py': subory,
  'dokumenty/__init__.py': '',
  'dokumenty/dokument.py': dokument,
  'dokumenty/dokument_tlac.py': dokumentTlac,
  'dokumenty/dokument_miesta.py': dokumentMiesta,
  'aplikacia.py': aplikacia,
};

export type Poziadavka = { druh: 'obrazok'; png: string } | { druh: 'dokument'; png: string } | { druh: 'urci'; podklad: number };

type Spolocne = { sirka: number; vyska: number; profil: string | null; maska: string; vyrez: string; podklad: number | null };
export type VysledokObrazka = Spolocne;
export type VysledokDokumentu = Spolocne & { prehlad: string; miest: number; nasiel: boolean };

type PyProxy = any;
type Posluchac = (event: { data?: unknown }) => void;
type Hostitel = {
  ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener?: (typ: string, posluchac: Posluchac) => void;
  document?: any;
  loadPyodide?: (nastavenia: { indexURL: string }) => Promise<any>;
};

const hostitel = globalThis as unknown as Hostitel;
const posli = (sprava: object) => hostitel.ReactNativeWebView?.postMessage(JSON.stringify(sprava));

function nacitajSkript(src: string): Promise<void> {
  return new Promise((splnene, zlyhalo) => {
    const skript = hostitel.document.createElement('script');
    skript.src = src;
    skript.onload = () => splnene();
    skript.onerror = () => zlyhalo(new Error('Python (Pyodide) sa nepodarilo stiahnuť – pri prvom spustení treba internet.'));
    hostitel.document.head.appendChild(skript);
  });
}

/** Spustí Python, stiahne knižnice a nahrá súbory analýz; vráti modul aplikacia. */
async function spustiPython(): Promise<PyProxy> {
  await nacitajSkript(PYODIDE + 'pyodide.js');
  const py = await hostitel.loadPyodide!({ indexURL: PYODIDE });
  await py.loadPackage(BALIKY);
  for (const [cesta, kod] of Object.entries(PYTHON)) {
    py.FS.mkdirTree('/home/pyodide/' + cesta.split('/').slice(0, -1).join('/'));
    py.FS.writeFile('/home/pyodide/' + cesta, kod);
  }
  py.runPython("import sys; sys.path.insert(0, '/home/pyodide')");
  return py.pyimport('aplikacia');
}

/** numpy pole z Pythonu skopírované do obrázka v JavaScripte. */
function pole(proxy: PyProxy): Obrazok {
  const buffer = proxy.getBuffer('u8');
  const obr = { vyska: buffer.shape[0], sirka: buffer.shape[1], data: buffer.data.slice() };
  buffer.release();
  proxy.destroy();
  return obr;
}

/** Podklad pre určenie druhu z posledných troch skenov (obrázok s maskou alebo výrezy škvŕn). */
type Podklad = { obrazok: Obrazok; maska: Uint8Array } | { vyrezy: { cislo: number; obrazok: Obrazok; maska: Uint8Array }[] };
const podklady = new Map<number, Podklad>();
let dalsiPodklad = 1;

function uloz(podklad: Podklad): number {
  const cislo = dalsiPodklad++;
  podklady.set(cislo, podklad);
  while (podklady.size > 3) podklady.delete(podklady.keys().next().value!);
  return cislo;
}

function spolocne(v: PyProxy) {
  return { sirka: v.get('sirka'), vyska: v.get('vyska'), profil: v.get('profil') ?? null, maska: v.get('maska_png'), vyrez: v.get('vyrez_png') };
}

async function spracuj(app: PyProxy, p: Poziadavka): Promise<VysledokObrazka | VysledokDokumentu | Skvrna[]> {
  if (p.druh === 'urci') {
    const podklad = podklady.get(p.podklad);
    if (!podklad) throw new Error('Podklad pre klasifikáciu už nie je k dispozícii – naskenuj vzorku znova.');
    return 'vyrezy' in podklad ? urciVyrezy(podklad.vyrezy) : urciFotku(podklad.obrazok, podklad.maska);
  }
  if (p.druh === 'obrazok') {
    const v = app.obrazok(p.png);
    const obr = pole(v.get('obrazok'));
    const maska = pole(v.get('maska')).data;
    const vysledok = { ...spolocne(v), podklad: uloz({ obrazok: obr, maska }) };
    v.destroy();
    return vysledok;
  }
  const v = app.dokument(p.png);
  const zoznam = v.get('vyrezy');
  const vyrezy = Array.from({ length: zoznam.length }, (_, k) => {
    const d = zoznam.get(k);
    const vyrez = { cislo: k + 1, obrazok: pole(d.get('obrazok')), maska: pole(d.get('maska')).data };
    d.destroy();
    return vyrez;
  });
  zoznam.destroy();
  const nasiel: boolean = v.get('nasiel');
  const vysledok = {
    ...spolocne(v),
    prehlad: v.get('prehlad_png'),
    miest: v.get('miest'),
    nasiel,
    podklad: nasiel ? uloz({ vyrezy }) : null,
  };
  v.destroy();
  return vysledok;
}

const python = spustiPython();
python.then(
  () => posli({ pripraveny: true }),
  (chyba) => posli({ chybaStartu: chyba instanceof Error ? chyba.message : String(chyba) })
);

const vybavene = new Set<number>();

async function naSpravu(event: { data?: unknown }) {
  if (typeof event.data !== 'string') return;
  let poziadavka: (Poziadavka & { id: number }) | null;
  try {
    poziadavka = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!poziadavka || typeof poziadavka.id !== 'number' || vybavene.has(poziadavka.id)) return;
  vybavene.add(poziadavka.id);
  try {
    posli({ id: poziadavka.id, ok: true, vysledok: await spracuj(await python, poziadavka) });
  } catch (chyba) {
    posli({ id: poziadavka.id, ok: false, chyba: chyba instanceof Error ? chyba.message : String(chyba) });
  }
}

hostitel.addEventListener?.('message', naSpravu);
hostitel.document?.addEventListener?.('message', naSpravu);
