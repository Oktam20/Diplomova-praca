import aplikacia from '../../python/aplikacia.py';
import dokument from '../../python/dokumenty/dokument.py';
import dokumentMiesta from '../../python/dokumenty/dokument_miesta.py';
import dokumentTlac from '../../python/dokumenty/dokument_tlac.py';
import crty from '../../python/klasifikacia/crty.py';
import kluc from '../../python/klasifikacia/kluc.json';
import klucPy from '../../python/klasifikacia/kluc.py';
import maska from '../../python/skvrny/maska.py';
import morfologia from '../../python/skvrny/morfologia.py';
import type { Poziadavka } from './vysledok-skenu';

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
const BALIKY = ['numpy', 'opencv-python', 'scikit-image'];

/** Python súbory z app/python, ktoré sa nahrajú do Pyodide (cesta -> obsah). */
const PYTHON: Record<string, string> = {
  'skvrny/__init__.py': '',
  'skvrny/maska.py': maska,
  'skvrny/morfologia.py': morfologia,
  'dokumenty/__init__.py': '',
  'dokumenty/dokument.py': dokument,
  'dokumenty/dokument_tlac.py': dokumentTlac,
  'dokumenty/dokument_miesta.py': dokumentMiesta,
  'klasifikacia/__init__.py': '',
  'klasifikacia/crty.py': crty,
  'klasifikacia/kluc.py': klucPy,
  'klasifikacia/kluc.json': JSON.stringify(kluc),
  'aplikacia.py': aplikacia,
};

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

/** Slovník z Pythonu ako objekt v JavaScripte. */
function naObjekt(proxy: PyProxy): unknown {
  const objekt = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return objekt;
}

function spracuj(app: PyProxy, p: Poziadavka): unknown {
  if (p.druh === 'obrazok') return naObjekt(app.obrazok(p.png));
  if (p.druh === 'dokument') return naObjekt(app.dokument(p.png));
  return naObjekt(app.urci_podklad(p.podklad));
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
    posli({ id: poziadavka.id, ok: true, vysledok: spracuj(await python, poziadavka) });
  } catch (chyba) {
    posli({ id: poziadavka.id, ok: false, chyba: poslednaVeta(chyba) });
  }
}

/** Z výpisu chyby Pythonu len posledný riadok bez názvu výnimky. */
function poslednaVeta(chyba: unknown): string {
  const text = chyba instanceof Error ? chyba.message : String(chyba);
  return (text.trim().split('\n').pop() ?? text).replace(/^\w+(Error|Exception): /, '');
}

hostitel.addEventListener?.('message', naSpravu);
hostitel.document?.addEventListener?.('message', naSpravu);
