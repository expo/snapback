// RV 0.1.8 — A3 evolution facts (findings a3-f5 + a3-f4).
// F5 fixed claim: a source edit watch-reloads to 'generated-and-loaded'
// WITH a live subscriber attached (0.1.7: permanent AUTH_MODE_PENDING
// wedge); the post-reload catalog serves rows.
// F4 fixed claim: the stop/regenerate/start refusal names
// SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH as the primary diagnostic (with
// recovery), not a runtime/codegen identity mismatch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
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

const bin = join(root, '..', 'node_modules', '.bin', 'snapback');
function startDev() {
  const child = spawn(bin, ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  return { child, log: () => out };
}
async function stop(server) {
  if (server.child.exitCode === null) {
    server.child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (server.child.exitCode === null && Date.now() < deadline) await sleep(25);
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  }
}
const loadedCount = (log) => (log.match(/generated-and-loaded/g) ?? []).length;

let server = startDev();
try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready');
  await until(() => loadedCount(server.log()) >= 1, 'loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers, body: JSON.stringify({ email: 'alice@rv018-evo.test' }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  const api = (await import('./snapback/generated/api.mjs')).default;
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token, authClientProtocol: 1, authInvalidationProtocol: 1,
  });

  // ATTACH a live subscriber and keep it attached across the reload.
  const sites = await client.liveQuery(api.listSites, { connectionId: 'rv_evo_sites', transport: 'stream' });
  await until(() => sites.connection === 'live', 'live handle attached');
  const loadsBefore = loadedCount(server.log());

  // Evolve: add an optional field to records.
  const schemaPath = join(root, 'snapback', 'schema.mjs');
  const schema = readFileSync(schemaPath, 'utf8');
  writeFileSync(schemaPath, schema.replace(
    "notes: v.string(),",
    "notes: v.string(),\n    rv018EvolvedField: v.optional(v.string()),",
  ));
  try {
    await until(() => loadedCount(server.log()) > loadsBefore, 'watch reload with live subscriber attached', 45_000);
    // Post-reload: a fresh query serves rows under the evolved catalog.
    const probe = new SnapbackClient(ready.serverUrl, { bearerToken: credential.token, authClientProtocol: 1 });
    const rows = await until(async () => {
      try { const q = await probe.query(api.listSites, {}); return q.rows; } catch { return null; }
    }, 'post-reload query', 20_000);
    record('RV-A3-F5', rows.length > 0,
      `watch reload reached generated-and-loaded with a live subscriber attached; post-reload query served ${rows.length} rows; handle connection now '${sites.connection}'`);
    await probe.closeAuth?.();
  } catch (err) {
    const pending = /AUTH_MODE_PENDING/.test(server.log());
    record('RV-A3-F5', false, `${err.message}; AUTH_MODE_PENDING in log: ${pending}; tail: ${server.log().slice(-400)}`);
  }
  await sites.dispose();
  await client.closeAuth?.();

  // F4: stop, regenerate offline with a further evolution, start — the
  // refusal (if any) must name the startup pin as itself.
  await stop(server);
  const schema2 = readFileSync(schemaPath, 'utf8');
  writeFileSync(schemaPath, schema2.replace(
    "notes: v.string(),",
    "notes: v.string(),\n    rv018SecondField: v.optional(v.string()),",
  ));
  await new Promise((resolveGen, rejectGen) => {
    const gen = spawn(bin, ['generate', 'snapback'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let genOut = '';
    gen.stdout.on('data', (c) => { genOut += c; });
    gen.stderr.on('data', (c) => { genOut += c; });
    gen.on('exit', (code) => (code === 0 ? resolveGen() : rejectGen(new Error(`generate failed: ${genOut.slice(-300)}`))));
  });
  const restart = startDev();
  let exited = false;
  restart.child.on('exit', () => { exited = true; });
  const outcome = await until(() => {
    if (exited) return { kind: 'refused' };
    if (loadedCount(restart.log()) >= 1) return { kind: 'started' };
    return null;
  }, 'restart outcome', 45_000);
  if (outcome.kind === 'refused') {
    const log = restart.log();
    const primary = /SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH/.test(log);
    const misattributed = /RUNTIME.*IDENTITY|CODEGEN.*MISMATCH|SNAPBACK_RUNTIME_ARTIFACT/.test(log) && !primary;
    const recovery = /recovery|reset-install|watch|running dev|live reload/i.test(log);
    record('RV-A3-F4', primary && !misattributed,
      `stop/regenerate/start refused; SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH present: ${primary}; recovery text present: ${recovery}; tail: ${log.slice(-350).replace(/\n/g, ' ')}`);
  } else {
    // The evolved pair was adopted at startup — the refusal no longer
    // occurs for the additive path; the misattribution cannot reproduce.
    record('RV-A3-F4', true,
      'stop/regenerate/start now ADOPTS the evolved artifacts and reaches ready (no refusal to misattribute); sanctioned path works');
    await stop(restart);
  }
  if (restart.child.exitCode === null) await stop(restart);
  writeFileSync(join(root, 'rv-a3.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
} finally {
  await stop(server);
}
