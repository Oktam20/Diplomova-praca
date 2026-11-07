import type { ColorChannel } from './color';
import { documentMoldMask } from './document-mold';
import { cropStains, detectStains, prepareText, printMap, renderCrops, repairedWhere } from './document-stains';
import type { BgrImage } from './image';
import { extractMasked, MoldDetectionMask } from './mold-detection';
import type { PipelineOutput } from './pipelines';
import { bytesToBase64, encodeBgrPng, encodeGrayPng } from './png';

export type DocumentOptions = {
  channels: string[];
  methods: string[];
  timeoutS: number;
};

export type DocumentRequest = DocumentOptions & {
  kind: 'document';
  work: string;
  illus: string | null;
};

/** Výsledok zakódovaný na prenos (obrázky ako PNG base64, výrezy ako surové bajty v base64). */
export type DocumentResult = {
  width: number;
  height: number;
  profil: string | null;
  overlayPng: string;
  maskPng: string;
  cutoutPng: string;
  crops: number;
  found: boolean;
  windows: number;
  processed: number;
  timedOut: boolean;
  times: string[];
};

export async function runDocumentPipeline(
  work: BgrImage & { profil?: string | null },
  illusImage: BgrImage | null,
  options: DocumentOptions
): Promise<PipelineOutput<DocumentResult>> {
  const detector = new MoldDetectionMask({
    acceptedRange: [0.02, 0.9],
    timeoutS: options.timeoutS,
    channels: options.channels as ColorChannel[],
    thresholdMethods: options.methods,
  });
  const times: string[] = [];
  let mark = Date.now();
  const lap = (name: string) => {
    times.push(`${name} ${((Date.now() - mark) / 1000).toFixed(1)} s`);
    mark = Date.now();
  };
  const prep = illusImage ? undefined : await prepareText(work);
  const illus = await printMap(illusImage ?? work, work.width, work.height, prep);
  lap('mapa tlače');
  const { mask: proposal, removed, page } = await detectStains(work, illus, prep);
  lap('text a návrh miest');
  const { mask, windows, processed, timedOut } = await documentMoldMask(
    proposal,
    work,
    removed,
    page,
    detector,
    detector.deadline()
  );
  lap(`vlastný algoritmus (${processed} okien)`);
  const crops = cropStains(work, removed, mask, page);
  const repaired = repairedWhere(work, removed, mask);
  const mask255 = new Uint8Array(mask.length);
  let found = false;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    mask255[i] = 255;
    found = true;
  }
  const { width, height } = work;
  const result: DocumentResult = {
    width,
    height,
    profil: work.profil ?? null,
    overlayPng: bytesToBase64(encodeBgrPng(renderCrops(work, mask, crops), 1)),
    maskPng: bytesToBase64(encodeGrayPng({ width, height, data: mask255 })),
    cutoutPng: bytesToBase64(encodeBgrPng(extractMasked(mask255, repaired), 1)),
    crops: crops.length,
    found,
    windows,
    processed,
    timedOut,
    times,
  };
  lap('výrezy a obrázky');
  return { result, retained: found ? { kind: 'crops', vyrezy: crops } : null };
}
