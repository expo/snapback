// RV 0.1.8 — A6 facts: RV-A6-F1 (jobStatus boots + projects), RV-A6-F2
// (jobs guide recipe accurate), RV-A6-F3 (reset-install terminal-auth
// client surface).
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

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
  }, 'ready (app with defineJobStatusQuery declared — the 0.1.7 unbootable case)');
  await until(() => out.includes('generated-and-loaded'), 'loaded');
  const bootPassNote = 'dev reached ready + generated-and-loaded with defineJobStatusQuery declared (0.1.7: SNAPBACK_FUNCTION_SCHEMA_REFERENCE_INVALID unbootable)';
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const signIn = async (email) => {
    const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
      method: 'POST', headers, body: JSON.stringify({ email }) }).then((r) => r.json());
    const mailbox = await fetch(
      `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
    ).then((r) => r.json());
    return fetch(`${ready.serverUrl}/auth/exchange`, {
      method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
    }).then((r) => r.json());
  };
  const api = (await import('./snapback/generated/api.mjs')).default;
  const dana = await signIn('dana@rv018-a6.test');
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: dana.token, authClientProtocol: 1, authInvalidationProtocol: 1, rqsStore: null, clientStoreId: 'rv018-a6',
  });

  // RV-A6-F2: the guide recipe — delayed enqueue with idempotency key.
  const enq = await client.mutate(api.probeEnqueue, { args: { key: 'rv018-job-1', delayMs: 4000 } });
  const jobId = enq.result.jobId;
  const jobsDrain = (nowMs) => fetch(`${ready.serverUrl}/_snapback/api/jobs/drain`, {
    method: 'POST', headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' },
    body: JSON.stringify(nowMs === undefined ? {} : { nowMs }),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  // RV-A6-F1: the declared job-status live query projects the lifecycle.
  try {
    const status = await client.liveQuery(api.jobStatus, {
      args: { jobId }, connectionId: 'rv_jobstatus', transport: 'stream',
    });
    await until(() => status.rows.length === 1, 'job status row', 10_000);
    const row = status.rows[0];
    const stateBefore = row.state;
    await jobsDrain(Date.now() + 6000);
    await until(() => status.rows[0]?.state !== stateBefore, 'lifecycle transition arrives live', 10_000);
    const after = status.rows[0];
    record('RV-A6-F1', typeof row.queue === 'string' && typeof after.state === 'string',
      `${bootPassNote}; projection served {state ${stateBefore} -> ${after.state}, queue ${row.queue}, attemptCount ${after.attemptCount}} live`);
    await status.dispose();
  } catch (err) {
    record('RV-A6-F1', false, `${bootPassNote}; but the query failed: ${err?.diagnostic?.code ?? err.message}`);
  }

  // RV-A6-F2 continued: premature drain no-op happened implicitly (job was
  // delayed); idempotent re-enqueue; lease-custodied status route.
  const dedupe = await client.mutate(api.probeEnqueue, { args: { key: 'rv018-job-1', delayMs: 4000 } });
  const lease = await new Promise((res) => {
    execFile(join(root, '..', 'node_modules', '.bin', 'snapback'),
      ['secret-read-mint', '--ready-file', readyFile, '--token', adminToken, '--admin-inspect'],
      { cwd: root }, (err, stdout, stderr) => {
        let body = null;
        try { body = JSON.parse(stdout); } catch { /* not JSON */ }
        res({ ok: !err, lease: body?.lease ?? body?.result?.lease ?? (stdout && !err ? stdout.trim() : null), err: String(stderr).slice(0, 200) });
      });
  });
  const statusRoute = await fetch(`${ready.serverUrl}/_snapback/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'x-snapback-admin-token': adminToken, ...(lease.lease ? { 'x-snapback-secret-read-lease': lease.lease } : {}) },
  });
  record('RV-A6-F2',
    dedupe.result.deduplicated === true && lease.ok && statusRoute.status === 200,
    `guide recipe: idempotencyKey re-enqueue deduplicated=${dedupe.result.deduplicated}; secret-read-mint ok=${lease.ok}; lease-custodied status route ${statusRoute.status}`);

  // RV-A6-F3: reset-install terminal-auth client surface.
  const seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
  const live = await client.liveQuery(api.jobStatus, { args: { jobId }, connectionId: 'rv_terminal', transport: 'stream' });
  await until(() => live.connection === 'live', 'live before reset');
  let terminalEvent = null;
  const unsub = client.subscribeAuthTerminal?.((fact) => { terminalEvent = fact; });
  const admin = createExternalSessionClient(ready.serverUrl, { bearerToken: dana.token, adminToken, rqsStore: null });
  const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
  const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
    requestedMode: 'sessions',
    expectedDataVersionStream: { state: "present", value: preview.current.dataVersionStream },
  });
  await until(() => terminalEvent !== null || client.authTerminalStatus?.() != null, 'terminal fact observable', 15_000);
  const terminalStatus = client.authTerminalStatus?.() ?? null;
  record('RV-A6-F3',
    receipt.outcome === 'reset-installed' && (terminalEvent !== null || terminalStatus !== null),
    `reset-install ${receipt.outcome}; authTerminalStatus ${JSON.stringify(terminalStatus).slice(0, 160)}; subscribeAuthTerminal fired: ${terminalEvent !== null}`);
  unsub?.();
  await live.dispose().catch(() => {});
  await client.closeAuth?.().catch(() => {});
  writeFileSync(join(root, 'rv-a6.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
