// RV 0.1.8 — A1 offline trio + Expo node-sim orchestrator.
// Facts: RV-A1-F4, RV-A1-F5, RV-A1-F6, RV-A1E-F1, RV-A1E-F2, RV-A1E-F4.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const rqsDir = join(root, 'rqs-store');
rmSync(rqsDir, { recursive: true, force: true });
mkdirSync(rqsDir, { recursive: true });
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

function startServer() {
  const child = spawn(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  return { child, log: () => out };
}
async function stopServer(server) {
  if (server.child.exitCode === null) {
    server.child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (server.child.exitCode === null && Date.now() < deadline) await sleep(25);
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  }
}
function runPhase(phase, extraEnv = {}) {
  return new Promise((resolvePhase) => {
    const outFile = join(root, `phase-${phase}.json`);
    rmSync(outFile, { force: true });
    const child = spawn(process.execPath, [join(root, 'rv-a1-phase.mjs'), phase], {
      cwd: root,
      env: { ...process.env, SNAPBACK_CLIENT_RQS_DIR: rqsDir, A1_OUT: outFile, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', (c) => { log += c; });
    child.stderr.on('data', (c) => { log += c; });
    child.on('exit', () => {
      let body = null;
      try { body = JSON.parse(readFileSync(outFile, 'utf8')); } catch { body = { ok: false, error: { message: `no phase output; log tail: ${log.slice(-400)}` } }; }
      resolvePhase(body);
    });
  });
}

let server = startServer();
try {
  let ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready file');
  await until(() => server.log().includes('generated-and-loaded'), 'loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const signIn = async (email) => {
    const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
      method: 'POST', headers, body: JSON.stringify({ email }),
    }).then((r) => r.json());
    const mailbox = await fetch(
      `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
    ).then((r) => r.json());
    const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
      method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
    }).then((r) => r.json());
    assert.equal(typeof credential.token, 'string', `sign-in ${email}`);
    return credential;
  };

  const alice = await signIn('alice@rv018-a1.test');
  const mallory = await signIn('mallory@rv018-a1.test');

  // Bootstrap workspace + records through the app's own mutations.
  const { SnapbackClient } = await import('@expo/snapback-client');
  const api = (await import('./snapback/generated/api.mjs')).default;
  const boot = new SnapbackClient(ready.serverUrl, { bearerToken: alice.token, authClientProtocol: 1 });
  const created = await boot.mutate(api.createWorkspace, { args: { name: 'RV018 workspace' } });
  const workspaceId = created.result;
  const rec = await boot.mutate(api.createRecord, {
    args: { workspaceId, title: 'Baseline record', assigneeId: alice.session.userId,
      assigneeName: 'Alice', dueAt: 1785542400000, position: 1000, clientKey: 'rv-base' },
  });
  const recordId = rec.result;
  await boot.closeAuth?.();

  const baseEnv = {
    A1_SERVER_URL: ready.serverUrl, A1_BEARER: alice.token, A1_STORE_ID: 'rv018-store',
    A1_WORKSPACE: workspaceId, A1_RECORD: recordId, A1_MALLORY_BEARER: mallory.token,
  };

  // Online: warm the retainable store; Expo sims that need the server.
  const warm = await runPhase('warm', baseEnv);
  const cryptoless = await runPhase('cryptoless', { ...baseEnv, A1_STORE_ID: 'rv018-nocrypto' });
  record('RV-A1E-F1', cryptoless.ok === true,
    cryptoless.ok ? `cryptoless boot reached live query (${cryptoless.sites.rows} rows), zero polyfills`
      : JSON.stringify(cryptoless.error ?? cryptoless));
  const rotation = await runPhase('rotation', { ...baseEnv, A1_STORE_ID: 'rv018-rotation' });
  record('RV-A1E-F4', rotation.ok === true,
    rotation.ok ? `downgrade settled without throw; denial fact ${JSON.stringify(rotation.duringDenial.denial)}; back-rotation restored ${rotation.back.rows} rows`
      : JSON.stringify({ downgrade: rotation.downgrade, during: rotation.duringDenial, back: rotation.back, error: rotation.error }));

  // Queue one intent via the plain-Error rejection (RN provenance shape).
  const plainQueue = await runPhase('queue-plain-error', baseEnv);
  record('RV-A1E-F2', plainQueue.ok === true,
    plainQueue.ok ? `plain-Error rejection queued: ${JSON.stringify(plainQueue.queued)}`
      : JSON.stringify(plainQueue.error ?? plainQueue.queued ?? plainQueue));

  assert.equal(warm.ok, true, `warm phase: ${JSON.stringify(warm.error ?? warm)}`);

  // Offline: stop the server.
  await stopServer(server);
  const coldRetained = await runPhase('cold-retained', baseEnv);
  record('RV-A1-F4', coldRetained.ok === true,
    coldRetained.ok ? `guide-declared retainable query cold-booted: freshness ${coldRetained.sites.freshness}, connection ${coldRetained.sites.connection}, ${coldRetained.sites.rows} rows`
      : JSON.stringify(coldRetained.error ?? coldRetained));

  const relaunch = await runPhase('relaunch-pending', baseEnv);
  record('RV-A1-F6', relaunch.ok === true,
    relaunch.ok ? `relaunch with pending intent rendered ${relaunch.sites.rows} retained rows (freshness ${relaunch.sites.freshness}); outbox ${JSON.stringify(relaunch.outboxDiagnostics)}`
      : JSON.stringify({ sites: relaunch.sites, error: relaunch.error }));
  const reactHalf = relaunch.react ?? {};
  const reactPass = reactHalf.freshness === 'retained' && (reactHalf.outbox?.queued ?? reactHalf.outbox?.count ?? (Array.isArray(reactHalf.outbox?.records) ? reactHalf.outbox.records.length : null)) >= 1;
  record('RV-A1-F5', reactPass,
    `react projection offline: freshness ${reactHalf.freshness}, rows ${reactHalf.rows}, outbox ${JSON.stringify(reactHalf.outbox)}${reactHalf.error ? `, error ${JSON.stringify(reactHalf.error)}` : ''}`);

  // Reconnect: restart server, replay exactly once.
  server = startServer();
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready file (restart)');
  await until(() => server.log().includes('generated-and-loaded'), 'loaded (restart)');
  const reconnect = await runPhase('reconnect', { ...baseEnv, A1_SERVER_URL: ready.serverUrl });
  console.error(`reconnect replay: ${JSON.stringify(reconnect.replay)} again: ${JSON.stringify(reconnect.replayAgain)}`);
  if (!reconnect.ok) {
    facts.push({ id: 'RV-A1E-F2', result: 'fail', note: `replay did not settle exactly-once: ${JSON.stringify(reconnect)}` });
  }

  writeFileSync(join(root, 'rv-a1.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
} finally {
  await stopServer(server);
}
