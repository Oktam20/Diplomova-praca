import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vypocty = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vypocty');
const vysledok = await build({
  entryPoints: [join(vypocty, 'webview-worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  minify: true,
  write: false,
});
const kod = vysledok.outputFiles[0].text;
writeFileSync(
  join(vypocty, 'webview-worker.generated.ts'),
  '// Vygenerované príkazom `npm run build:worker` – needitovať ručne.\n' + `export const KOD_WORKERA = ${JSON.stringify(kod)};\n`
);
console.log(`webview-worker.generated.ts: ${(kod.length / 1024).toFixed(0)} kB`);
