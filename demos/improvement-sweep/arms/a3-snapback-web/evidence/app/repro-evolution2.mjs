import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gen = () => new Promise((res) => spawn(join(root, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback'], { cwd: root, stdio: 'ignore' }).on('exit', res));
for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) rmSync(join(root, '.snapback', `dev.sqlite3${s}`), { force: true });
copyFileSync('versions/schema.v1.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v1.mjs', 'snapback/functions.mjs');
await gen();
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
const events = [];
child.stdout.on('data', (c) => {
  out += c;
  for (const line of c.toString().split('\n')) {
    try { const e = JSON.parse(line.trim()); if (e?.schemaVersion === 'snapback.dev.v1') events.push(e); } catch {}
  }
});
child.stderr.on('data', (c) => { out += c; });
const deadline = Date.now() + 30000;
while (Date.now() < deadline && !(existsSync(readyFile) && events.some((e) => e.state === 'generated-and-loaded'))) await sleep(50);
console.log('v1 READY, events so far:', events.map((e) => e.state).join(','));
const loadedBefore = events.filter((e) => e.state === 'generated-and-loaded').length;
// live evolution: swap sources while dev runs (dev owns watch + codegen)
copyFileSync('versions/schema.v2.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v2.mjs', 'snapback/functions.mjs');
const d2 = Date.now() + 30000;
while (Date.now() < d2 && events.filter((e) => e.state === 'generated-and-loaded').length === loadedBefore) await sleep(100);
console.log('after v2 swap, events:', JSON.stringify(events.map((e) => e.state)));
console.log('reloaded:', events.filter((e) => e.state === 'generated-and-loaded').length > loadedBefore);
console.log('tail:', out.slice(-600));
child.stdin.end();
await sleep(1000);
process.exit(0);
