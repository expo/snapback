// RV 0.1.8 — RV-A4-F4 (everyMs catch-up trusted time) + RV-A4-F2 (dev
// prints its failed envelope).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`); await sleep(40); }
};
const facts = [];
const record = (id, pass, note) => {
  facts.push({ id, result: pass ? 'pass' : 'fail', note });
  console.error(`${pass ? 'PASS' : 'FAIL'} ${id}: ${note}`);
};

// ---- RV-A4-F4: first everyMs tick nominal is the most recent slot ----
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
const child = spawn(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready');
  await until(() => out.includes('generated-and-loaded'), 'loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const wallBefore = Date.now();
  const res = await fetch(`${ready.serverUrl}/_snapback/api/cron/tick`, {
    method: 'POST', headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' }, body: '{}',
  });
  const runs = await res.json();
  const first = Array.isArray(runs) ? runs[0] : null;
  const nominal = first?.scheduledAtMs ?? null;
  const intervalMs = 1_000;
  const withinInterval = typeof nominal === 'number'
    && nominal > 0
    && Math.abs(wallBefore - nominal) <= intervalMs + 1_500;
  record('RV-A4-F4', withinInterval,
    `first catch-up tick nominal ${nominal} vs wall ${wallBefore} (delta ${nominal === null ? 'n/a' : wallBefore - nominal}ms, interval ${intervalMs}ms); runs: ${JSON.stringify(runs).slice(0, 200)}`);
} catch (err) {
  record('RV-A4-F4', false, String(err?.message ?? err));
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

// ---- RV-A4-F2: dev prints its failed envelope ----
// Change seed bytes under the installed (reused) seedVersion; the next dev
// start's runDev result is not ok, and 0.1.8 must PRINT the envelope.
const seedPath = join(root, 'snapback', 'seed.json');
const seedBody = readFileSync(seedPath, 'utf8');
try {
  const mutated = seedBody.replace('"Hana"', '"Hana RV"');
  if (mutated === seedBody) throw new Error('seed byte-change anchor not found');
  writeFileSync(seedPath, mutated);
  const run = spawnSync(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
  });
  const output = `${run.stdout}\n${run.stderr}`;
  const printed = output.trim().length > 0;
  const named = /SNAPBACK_SEED_VERSION_REUSED|SNAPBACK_[A-Z_]*SEED[A-Z_]*/.test(output);
  record('RV-A4-F2', run.status === 1 && printed && named,
    `dev exited ${run.status} with ${output.trim().length} bytes of output; envelope code present: ${named}; excerpt: ${output.trim().slice(0, 220).replace(/\n/g, ' ')}`);
} catch (err) {
  record('RV-A4-F2', false, String(err?.message ?? err));
} finally {
  writeFileSync(seedPath, seedBody);
}

writeFileSync(join(root, 'rv-a4-cron-dev.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
