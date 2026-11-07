import { ImageManipulator, SaveFormat, type ImageManipulatorContext } from 'expo-image-manipulator';

import { computeInWebView } from './compute-webview';
import { runDocumentPipeline, type DocumentRequest } from './document-pipeline';
import { WORK_SIDE } from './document-stains';
import { cvRound } from './image';
import type { SpotGroup } from './manual-key';
import { PROFIL_RYCHLY, type CandidateInfo } from './mold-detection';
import { classifyRetained, runImage, type ImageRequest, type PipelineOutput, type Retained } from './pipelines';
import { base64ToBytes, decodePng } from './png';

/** Podklad pre klasifikáciu škvŕn: ostáva tam, kde sa počítalo. */
export type DetectionData = { remote: number } | { local: Retained };

/** Zaradenie škvŕn podľa manuálneho kľúča (vo WebView, ak tam detekcia bežala). */
export async function classifyDetection(data: DetectionData): Promise<SpotGroup[]> {
  if ('local' in data) return classifyRetained(data.local);
  const res = await computeInWebView<SpotGroup[]>({ kind: 'classify', key: data.remote });
  if (res === null) throw new Error('Výpočet vo WebView nie je k dispozícii – naskenuj vzorku znova.');
  return res;
}

/** Rozlíšenia (dlhšia strana v px). */
export const MAX_IMAGE_SIDE = 1200;
export const DOCUMENT_ILLUS_SIDE = 2400;

const SADA = { channels: [...PROFIL_RYCHLY.channels], methods: [...PROFIL_RYCHLY.methods] };

export type OnDeviceImageResult = {
  message: string | null;
  imageUri: string | null;
  maskUri: string | null;
  cutoutUri: string | null;
  data: DetectionData | null;
  farebnyProfil: string | null;
  info: CandidateInfo | null;
  durationMs: number;
};

export type OnDeviceDocumentResult = OnDeviceImageResult & {
  miest: number;
  spracovanych: number;
};

/** Uloží obrázok z ImageManipulatora ako PNG – base64 na výpočet, súbor na zobrazenie. */
async function savePng(context: ImageManipulatorContext): Promise<{ base64: string; uri: string }> {
  const ref = await context.renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error('Nepodarilo sa načítať pixely obrázka.');
  return { base64: saved.base64, uri: saved.uri };
}

const decode = (b64: string) => decodePng(base64ToBytes(b64));
const dataUri = (b64: string | null) => (b64 ? `data:image/png;base64,${b64}` : null);

/** Výpočet vo WebView; ak nie je k dispozícii, rovnaký kód v aplikácii (`local`). */
async function compute<R extends { times: string[] }>(
  request: object,
  local: () => Promise<PipelineOutput<R>>
): Promise<{ res: R; data: DetectionData | null; where: string }> {
  const remote = await computeInWebView<R & { key?: number | null }>(request);
  if (remote) return { res: remote, data: remote.key != null ? { remote: remote.key } : null, where: 'WebView' };
  const out = await local();
  return { res: out.result, data: out.retained ? { local: out.retained } : null, where: 'Hermes' };
}

/** Časy fáz – vypíšu sa do terminálu Metro (npx expo start). */
function logTimes(mode: string, where: string, size: string, started: number, times: string[]) {
  const total = `spolu ${((Date.now() - started) / 1000).toFixed(1)} s`;
  console.log(`${mode} (${where}) ${size}: ${[...times, total].join(', ')}`);
}

const since = (from: number) => ((Date.now() - from) / 1000).toFixed(1);

/** Maska škvrny z celého obrázka. */
export async function detectMoldOnDeviceImage(uri: string): Promise<OnDeviceImageResult> {
  const started = Date.now();
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const factor = Math.min(1, MAX_IMAGE_SIDE / Math.max(original.width, original.height));
  const context = ImageManipulator.manipulate(uri);
  if (factor < 1) {
    context.resize({ width: cvRound(original.width * factor), height: cvRound(original.height * factor) });
  }
  const image = await savePng(context);
  const loaded = `načítanie ${since(started)} s`;
  const request: ImageRequest = {
    kind: 'image',
    image: image.base64,
    ...SADA,
    timeoutS: 90,
  };
  const { res, data, where } = await compute(request, () => runImage(decode(image.base64), request));
  logTimes('Obrázok', where, `${res.width}x${res.height}`, started, [loaded, ...res.times]);
  return {
    message: res.message,
    imageUri: image.uri,
    maskUri: dataUri(res.maskPng),
    cutoutUri: dataUri(res.cutoutPng),
    data,
    farebnyProfil: res.profil,
    info: res.info,
    durationMs: Date.now() - started,
  };
}

export async function detectMoldOnDeviceDocument(uri: string): Promise<OnDeviceDocumentResult> {
  const started = Date.now();
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const longSide = Math.max(original.width, original.height);
  const resized = async (side: number) => {
    const f = Math.min(1, side / longSide);
    const context = ImageManipulator.manipulate(uri);
    if (f < 1) context.resize({ width: cvRound(original.width * f), height: cvRound(original.height * f) });
    return (await savePng(context)).base64;
  };
  const request: DocumentRequest = {
    kind: 'document',
    work: await resized(WORK_SIDE),
    illus: longSide > WORK_SIDE ? await resized(DOCUMENT_ILLUS_SIDE) : null,
    ...SADA,
    timeoutS: 120,
  };
  const loaded = `načítanie ${since(started)} s`;
  const { res, data, where } = await compute(request, () =>
    runDocumentPipeline(decode(request.work), request.illus ? decode(request.illus) : null, request)
  );
  logTimes('Dokument', where, `${res.width}x${res.height}`, started, [loaded, ...res.times]);

  const message =
    res.windows === 0
      ? 'Na stránke sa nenašli žiadne škvrny.'
      : !res.found
        ? 'Navrhnuté miesta sa našli, ale vlastný algoritmus v nich masku nenašiel.'
        : res.timedOut
          ? `Časový limit – spracovaných ${res.processed} z ${res.windows} miest.`
          : null;
  return {
    message,
    imageUri: dataUri(res.overlayPng),
    maskUri: dataUri(res.maskPng),
    cutoutUri: dataUri(res.cutoutPng),
    data,
    farebnyProfil: res.profil,
    info: null,
    miest: res.windows,
    spracovanych: res.processed,
    durationMs: Date.now() - started,
  };
}
