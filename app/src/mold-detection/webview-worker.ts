import { runDocumentPipeline, type DocumentRequest } from './document-pipeline';
import {
  classifyRetained,
  runImage,
  type ClassifyRequest,
  type ImageRequest,
  type PipelineOutput,
  type Retained,
} from './pipelines';
import { base64ToBytes, decodePng } from './png';
import { setYieldToEventLoop } from './yield';

setYieldToEventLoop(false);

type Request = (DocumentRequest | ImageRequest | ClassifyRequest) & { id: number };

type Host = {
  ReactNativeWebView?: { postMessage(data: string): void };
  addEventListener?: (type: string, listener: (event: { data?: unknown }) => void) => void;
  document?: { addEventListener?: (type: string, listener: (event: { data?: unknown }) => void) => void };
};

const host = globalThis as unknown as Host;
const handled = new Set<number>();

const store = new Map<number, Retained>();
const STORE_MAX = 3;
let nextKey = 1;

function keep(retained: Retained | null): number | null {
  if (!retained) return null;
  const key = nextKey++;
  store.set(key, retained);
  while (store.size > STORE_MAX) store.delete(store.keys().next().value!);
  return key;
}

function post(message: object) {
  host.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

const decode = (b64: string) => decodePng(base64ToBytes(b64));

/** Výsledok + kľúč podkladu pre klasifikáciu; na začiatok časov pridá dekódovanie. */
function withKey<T extends { times: string[] }>(out: PipelineOutput<T>, decoding: string) {
  out.result.times.unshift(decoding);
  return { ...out.result, key: keep(out.retained) };
}

async function handle(req: Request): Promise<unknown> {
  const t0 = Date.now();
  const decoded = () => `dekódovanie ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  switch (req.kind) {
    case 'image': {
      const image = decode(req.image);
      const decoding = decoded();
      return withKey(await runImage(image, req), decoding);
    }
    case 'document': {
      const work = decode(req.work);
      const illus = req.illus ? decode(req.illus) : null;
      const decoding = decoded();
      return withKey(await runDocumentPipeline(work, illus, req), decoding);
    }
    case 'classify': {
      const retained = store.get(req.key);
      if (!retained) throw new Error('Podklad pre klasifikáciu už nie je k dispozícii – naskenuj vzorku znova.');
      return classifyRetained(retained);
    }
  }
}

async function onMessage(event: { data?: unknown }) {
  if (typeof event.data !== 'string') return;
  let request: Request | null = null;
  try {
    request = JSON.parse(event.data);
  } catch {
    return;
  }
  if (!request || typeof request.id !== 'number' || handled.has(request.id)) return;
  handled.add(request.id);
  try {
    post({ id: request.id, ok: true, res: await handle(request) });
  } catch (err) {
    post({ id: request.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

host.addEventListener?.('message', onMessage);
host.document?.addEventListener?.('message', onMessage);
post({ ready: true });
