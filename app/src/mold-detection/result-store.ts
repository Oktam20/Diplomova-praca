import type { SpotGroup } from './manual-key';

export type ScanResult = {
  mode: 'obrazok' | 'dokument';
  imageUri: string | null;
  maskUri: string | null;
  cutoutUri: string | null;
  skupiny: SpotGroup[];
  farebnyProfil: string | null;
  durationMs: number;
};

let current: ScanResult | null = null;

export function setScanResult(result: ScanResult): void {
  current = result;
}

export function getScanResult(): ScanResult | null {
  return current;
}

let newScanRequested = false;

export function requestNewScan(): void {
  newScanRequested = true;
}

/** Vráti true, ak bol požadovaný nový sken, a požiadavku zruší. */
export function consumeNewScanRequest(): boolean {
  const requested = newScanRequested;
  newScanRequested = false;
  return requested;
}
