import type { StainCrop } from './document-stains';
import type { BgrImage } from './image';
import { urcMasku, urcVyrezy, type SpotGroup } from './manual-key';
import { extractMasked, MoldDetectionMask, ProcessingTimeout, type CandidateInfo } from './mold-detection';
import type { ColorChannel } from './color';
import { bytesToBase64, encodeBgrPng, encodeGrayPng, type DecodedPng } from './png';

/** Podklad pre klasifikáciu: obrázok a maska alebo výrezy škvŕn z dokumentu. */
export type Retained =
  | { kind: 'mask'; image: BgrImage; mask: Uint8Array }
  | { kind: 'crops'; vyrezy: StainCrop[] };

export type PipelineOutput<T> = { result: T; retained: Retained | null };

const seconds = (from: number) => ((Date.now() - from) / 1000).toFixed(1);
const png = (bytes: Uint8Array) => bytesToBase64(bytes);

/** Maska a výrez (extract_masked) ako PNG base64. */
function maskPngs(mask: Uint8Array, image: BgrImage) {
  return {
    maskPng: png(encodeGrayPng({ width: image.width, height: image.height, data: mask })),
    cutoutPng: png(encodeBgrPng(extractMasked(mask, image), 1)),
  };
}

export type ImageRequest = { kind: 'image'; image: string; channels: string[]; methods: string[]; timeoutS: number };
export type ImageResult = {
  message: string | null;
  maskPng: string | null;
  cutoutPng: string | null;
  info: CandidateInfo | null;
  profil: string | null;
  width: number;
  height: number;
  times: string[];
};

/** Maska škvrny z celého obrázka. */
export async function runImage(image: DecodedPng, req: ImageRequest): Promise<PipelineOutput<ImageResult>> {
  const detector = new MoldDetectionMask({
    acceptedRange: [0.02, 0.9],
    timeoutS: req.timeoutS,
    channels: req.channels as ColorChannel[],
    thresholdMethods: req.methods,
  });
  const base = { profil: image.profil, width: image.width, height: image.height };
  const t = Date.now();
  try {
    const { mask, info } = await detector.createMoldMaskAuto(image, undefined, detector.deadline());
    return {
      result: { ...base, message: null, ...maskPngs(mask, image), info, times: [`maska ${seconds(t)} s`] },
      retained: { kind: 'mask', image, mask },
    };
  } catch (err) {
    if (!(err instanceof ProcessingTimeout)) throw err;
    return {
      result: { ...base, message: detector.timeoutMessage(), maskPng: null, cutoutPng: null, info: null, times: [] },
      retained: null,
    };
  }
}

export type ClassifyRequest = { kind: 'classify'; key: number };

/** Zaradenie škvŕn podľa manuálneho kľúča (celý obrázok alebo výrezy dokumentu). */
export function classifyRetained(retained: Retained): SpotGroup[] {
  return retained.kind === 'crops'
    ? urcVyrezy(retained.vyrezy)
    : urcMasku(retained.image, retained.mask);
}
