import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stage = process.argv[2];
if (!['base', 'evolved'].includes(stage)) {
  throw new Error('usage: stage-schema.mjs base|evolved');
}
const root = resolve(import.meta.dirname, '..');
copyFileSync(
  resolve(root, `instant.schema.${stage}.ts`),
  resolve(root, 'instant.schema.ts'),
);
process.stdout.write(JSON.stringify({ ok: true, staged: stage }) + '\n');
