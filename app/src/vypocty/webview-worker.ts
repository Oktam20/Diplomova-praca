import { spracuj, type Poziadavka } from './postup';

type Posluchac = (event: { data?: unknown }) => void;
type Hostitel = {
  ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener?: (typ: string, posluchac: Posluchac) => void;
  document?: { addEventListener?: (typ: string, posluchac: Posluchac) => void };
};

const hostitel = globalThis as unknown as Hostitel;
const vybavene = new Set<number>();

const posli = (sprava: object) => hostitel.ReactNativeWebView?.postMessage(JSON.stringify(sprava));

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
    posli({ id: poziadavka.id, ok: true, vysledok: await spracuj(poziadavka) });
  } catch (chyba) {
    posli({ id: poziadavka.id, ok: false, chyba: chyba instanceof Error ? chyba.message : String(chyba) });
  }
}

hostitel.addEventListener?.('message', naSpravu);
hostitel.document?.addEventListener?.('message', naSpravu);
posli({ pripraveny: true });
