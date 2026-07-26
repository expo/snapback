import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'generated', 'runtime.mjs');
await mkdir(dirname(output), { recursive: true });
await build({
  entryPoints: [join(root, 'scripts', 'runtime-entry.mjs')],
  outfile: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  legalComments: 'none',
  sourcemap: false,
});
console.log(`bundled ${output}`);
