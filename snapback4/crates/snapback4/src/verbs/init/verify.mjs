// API signatures: snapback4 guide api proof | client | auth | generated
// @ref LLP 3000.037.000#14-wave-34-one-verify-loop-ver1 — one ordered loop, first red, private full output.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { reusePhase, forgetPhase } from './verify-cache.mjs';
import { watchParent } from './verify-parent.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, chmodSync, openSync, closeSync, readFileSync, writeSync, renameSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--worker') {
  if (!process.connected) throw Error('verify worker requires its owner IPC');
  const child = spawn('npm', ['run', '--silent', args[1]], {stdio:'inherit'});
  const stop = () => { if (process.platform === 'win32') { child.kill('SIGKILL'); process.exit(1); } process.kill(-process.pid, 'SIGKILL'); };
  process.once('disconnect', stop);
  child.once('error', error => { console.error(error); process.send?.({code:1}); });
  child.once('exit', code => process.send?.({code:code ?? 1}));
  // IPC keeps this private leader alive until the owner reclaims descendants.
} else {
const unwatch = watchParent(() => process.exit(1));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => process.exit(1));
if (args.some(a => !['--explain', '--verbose'].includes(a))) { console.error('usage: npm run verify -- [--explain]'); process.exit(2); }
for (const dir of ['.snapback4', '.snapback4/last']) {
  mkdirSync(dir, {recursive:true, mode:0o700});
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw Error('verify details require a real directory');
  chmodSync(dir, 0o700);
}
const path = '.snapback4/last/verify.txt';
const temporary = `${path}.${randomUUID()}.tmp`;
const fd = openSync(temporary, 'wx', 0o600);
const steps = ['check', 'acceptance', 'frontend:proof', 'probe:check'];
