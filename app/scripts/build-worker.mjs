import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nacitajWabt from 'wabt';

const vypocty = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vypocty');

// WebAssembly jadrá (src/vypocty/wasm/jadra.wat) -> base64 v jadra.generated.ts
const wabt = await nacitajWabt();
const wat = join(vypocty, 'wasm', 'jadra.wat');
const modul = wabt.parseWat(wat, new Uint8Array(readFileSync(wat)), { simd: true });
modul.validate();
const bajty = Buffer.from(modul.toBinary({}).buffer);
modul.destroy();
writeFileSync(
  join(vypocty, 'wasm', 'jadra.generated.ts'),
  '// Vygenerované príkazom `npm run build:worker` z jadra.wat – needitovať ručne.\n' +
    `export const JADRA_WASM = ${JSON.stringify(bajty.toString('base64'))};\n`
);
console.log(`jadra.generated.ts: ${bajty.length} B WebAssembly`);

const vysledok = await build({
  entryPoints: [join(vypocty, 'webview-worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  minify: true,
  loader: { '.py': 'text' },
  write: false,
});
const kod = vysledok.outputFiles[0].text;
writeFileSync(
  join(vypocty, 'webview-worker.generated.ts'),
  '// Vygenerované príkazom `npm run build:worker` – needitovať ručne.\n' + `export const KOD_WORKERA = ${JSON.stringify(kod)};\n`
);
console.log(`webview-worker.generated.ts: ${(kod.length / 1024).toFixed(0)} kB`);
