// Copies the generated Snapback client artifacts from the backend into the app.
import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, '..', 'backend', 'rematch', 'snapback', 'generated');
const dst = join(root, 'src', 'generated');
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
rmSync(join(dst, 'contract'), { recursive: true, force: true });
rmSync(join(dst, 'operations'), { recursive: true, force: true });
// Metro/babel compatibility: strip JSON import attributes; TS: expose api types as .d.mts.
import { readFileSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs';
for (const file of readdirSync(dst)) {
  if (file.endsWith('.mjs')) {
    const path = join(dst, file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(" with { type: 'json' }", ''));
  }
}
copyFileSync(join(dst, 'api.d.ts'), join(dst, 'api.d.mts'));
console.log('synced generated artifacts ->', dst);
