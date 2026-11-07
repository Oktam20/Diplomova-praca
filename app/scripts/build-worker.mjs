import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  entryPoints: [join(root, 'src/mold-detection/webview-worker.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'safari15',
  minify: true,
  write: false,
});
const code = result.outputFiles[0].text;
const out = join(root, 'src/mold-detection/webview-worker.generated.ts');
writeFileSync(
  out,
  '// Vygenerované príkazom `npm run build:worker` (scripts/build-worker.mjs) – needitovať ručne.\n' +
    `export const WORKER_JS = ${JSON.stringify(code)};\n`
);
console.log(`webview-worker.generated.ts: ${(code.length / 1024).toFixed(0)} kB`);
