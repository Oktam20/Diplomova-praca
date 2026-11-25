export class CasVyprsal extends Error {}

export const teraz = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

export function skontrolujCas(koniec: number): void {
  if (teraz() > koniec) throw new CasVyprsal();
}

let poslednaPrestavka = 0;

/** Krátka prestávka vo výpočte, aby sa stihol prekresliť spinner (najviac raz za 0,25 s). */
export async function prestavka(): Promise<void> {
  if (teraz() - poslednaPrestavka < 0.25) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  poslednaPrestavka = teraz();
}

/** Zaznamenáva trvanie fáz výpočtu (vypíše sa do terminálu Metro). */
export function stopky() {
  const casy: string[] = [];
  let od = Date.now();
  const kolo = (nazov: string) => {
    casy.push(`${nazov} ${((Date.now() - od) / 1000).toFixed(1)} s`);
    od = Date.now();
  };
  return { casy, kolo };
}
