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
const passed = [], reused = [], started = Date.now();
let failed, code = 0;
try {
  for (const step of steps) {
    unwatch.check(); // close the polling interval race before admitting a phase
    writeSync(fd, `\n=== ${step} ===\n`);
    const phaseStarted = Date.now();
    const progress = setInterval(() => console.log(`verify: running ${step}; ${Math.round((Date.now()-phaseStarted)/1000)}s elapsed`), 5000);
    try {
    const reuse = await reusePhase(step);
    unwatch.check(); // hashing may yield; revalidate before reuse or worker admission
    if (reuse) { passed.push(step); reused.push(step); writeSync(fd, 'reused passing phase (same source/session)\n'); continue; }
    forgetPhase(step);
    // npm owns pre/post hooks, authored scripts and their ordinary exit codes.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', step], {detached:process.platform !== 'win32', stdio:['ignore', fd, fd, 'ipc']});
    code = await new Promise(resolve => {
      let result = 1;
      child.once('message', message => { if (Number.isInteger(message?.code)) result = message.code; child.disconnect(); });
      child.once('error', error => { writeSync(fd, String(error)+'\n'); resolve(1); });
      child.once('exit', () => resolve(result));
    }); } finally { clearInterval(progress); }
    if (code) { failed = step; break; }
    passed.push(step);
  }
} finally { unwatch(); closeSync(fd); renameSync(temporary, path); }
const detail = readFileSync(path, 'utf8');
if (args.length) process.stdout.write(detail);
else if (failed) {
  // CALLS1 prints these lines before Node's original assertion; retain their
  // order and full content. Never replace them with a later assertion diff.
  const lines = detail.split('\n');
  const begin = lines.findLastIndex(line => line.startsWith(`=== ${failed} ===`));
  const relevant = lines.slice(begin+1).filter(line => /^\s*(?:#\s*)?(proof refusal|likely fix:|nearest server |proof failed:)|\bE_[A-Z_]+\b|error TS\d|Error:/.test(line));
  console.log(relevant.slice(0, 6).join('\n') || `verify: ${failed} failed; inspect ${path}`);
}
console.log(`verify: ${failed ? `FAIL ${failed}; exit ${code}` : 'passed'}; ${passed.length}/${steps.length} phases; ${Date.now()-started}ms`);
console.log(`steps: ${passed.map(step => step + (reused.includes(step) ? ' (reused)' : '')).join(', ') || 'none'}${failed ? `; rerun: npm run ${failed}` : ''}`);
console.log(`details: ${path}; npm run verify -- --explain for complete output`);
process.exitCode = code;

}
