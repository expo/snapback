import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTarget, workRoot } from './lib.mjs';

const target = readTarget();
writeFileSync(resolve(workRoot, '.env.local'), `VITE_INSTANT_APP_ID=${target.appId}\n`, {
  mode: 0o600,
});
process.stdout.write('prepared ignored Vite target binding\n');
