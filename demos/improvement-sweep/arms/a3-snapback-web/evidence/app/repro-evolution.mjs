import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gen = () => new Promise((res) => spawn(join(root, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback'], { cwd: root, stdio: 'ignore' }).on('exit', res));
const boot = async (label) => {
  const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile) && out.includes('generated-and-loaded')) { console.log(label, 'READY'); return { child, out: () => out }; }
    if (child.exitCode !== null) break;
    await sleep(50);
  }
  console.log(label, 'NOT READY (exit', child.exitCode, '). output tail:');
  console.log(out.slice(-2000));
  return { child, out: () => out };
};
for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) rmSync(join(root, '.snapback', `dev.sqlite3${s}`), { force: true });
copyFileSync('versions/schema.v1.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v1.mjs', 'snapback/functions.mjs');
await gen();
const a = await boot('v1');
await sleep(500);
a.child.stdin.end();
await sleep(1500);
console.log('v1 stopped, exit', a.child.exitCode, 'readyFile exists:', existsSync(readyFile));
copyFileSync('versions/schema.v2.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v2.mjs', 'snapback/functions.mjs');
await gen();
const b = await boot('v2-over-existing-db');
b.child.stdin.end();
await sleep(1000);
console.log('v2 exit', b.child.exitCode);
process.exit(0);
