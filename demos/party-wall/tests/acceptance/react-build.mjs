// Party Wall — React surface build check (integration surface).
//
// Proves the browser arm assembles: bun install + vite build over the real
// workspace packages and the generated api. A full browser walkthrough is
// manual (README); the load-bearing product claims are proven headless, and
// the sessions sign-in story a browser suite would need is itself a recorded
// gap (diary 0041 finding 7).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const surface = join(here, '..', '..', 'surfaces', 'react');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: surface, stdio: 'inherit', timeout: 600000 });
  if (result.status !== 0) {
    console.error(`FAIL party-wall / react-build — ${cmd} ${args.join(' ')} exited ${result.status}`);
    process.exit(1);
  }
}

run('bun', ['install', '--silent']);
run('bun', ['run', 'build']);
if (!existsSync(join(surface, 'dist', 'index.html'))) {
  console.error('FAIL party-wall / react-build — no dist/index.html');
  process.exit(1);
}
console.log('PASS party-wall / react-build');
