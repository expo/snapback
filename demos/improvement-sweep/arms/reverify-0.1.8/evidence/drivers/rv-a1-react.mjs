// RV-A1-F5 projection halves, live server: freshness/retention fields on
// react snapshots + outbox hook counts/replay. (The end-to-end cold-offline
// react boot is separately recorded — binding prep fetches on 0.1.8.)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createExternalSessionClient } from '@expo/snapback-client';
import {
  createSnapbackReactProvider, invokeSnapbackMutation,
  observeSnapbackOutbox, observeSnapbackQueries,
} from '@expo/snapback-react';
import api from './snapback/generated/api.mjs';
import functions from './snapback/generated/functions.manifest.json' with { type: 'json' };
import capabilityManifest from './snapback/generated/capability.manifest.json' with { type: 'json' };
import schema from './snapback/generated/schema.manifest.json' with { type: 'json' };

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
const child = spawn(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
});
let child2 = null;
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}\n${out.slice(-800)}`); await sleep(30); }
};
try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready');
  await until(() => out.includes('generated-and-loaded'), 'loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers, body: JSON.stringify({ email: 'alice@rv018-react.test' }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());

  const client = createExternalSessionClient(ready.serverUrl, {
    bearerToken: credential.token, offlineQueue: true, clientStoreId: 'rv018-react-live',
  });
  const binding = await client.prepareReactBinding({ generatedManifest: { schema, functions, capabilityManifest } });
  const provider = createSnapbackReactProvider(binding);
  const ws = await invokeSnapbackMutation(provider, api.createWorkspace, { name: 'RV react ws' });

  let snap = null;
  const qObs = observeSnapbackQueries(provider, { sites: { ref: api.listSites, args: {} } }, (s) => { snap = s; });
  await until(() => snap?.queries.sites.status === 'ready', 'sites ready');
  const freshnessField = snap.queries.sites.freshness;
  const retentionField = 'retention' in snap.queries.sites;
  assert.ok(freshnessField === 'current' || freshnessField === 'retained',
    `freshness projected on hook snapshot (got ${freshnessField})`);

  let outbox = null;
  const oObs = observeSnapbackOutbox(provider, (s) => { outbox = s; });
  await until(() => outbox !== null, 'outbox snapshot');
  const supported = outbox.supported !== false;

  // The real tab-goes-offline shape: stop the dev server, queue an intent,
  // watch the hook projection, restart, replay.
  child.stdin.end();
  await until(() => child.exitCode !== null, 'server stopped');
  await sleep(400);
  const queued = await client.mutate(api.createRecord, {
    args: { workspaceId: ws, title: 'RV outbox record', assigneeId: credential.session.userId,
      assigneeName: 'Alice', dueAt: 1785542400000, position: 2000, clientKey: 'rv-outbox' },
  });
  assert.equal(queued.queued, true, `intent queued offline (${JSON.stringify(queued)})`);
  await until(() => (outbox?.pending ?? 0) >= 1, 'outbox pending count reaches the hook projection');
  const pendingSeen = outbox.pending;
  const offlineFreshness = snap.queries.sites.freshness;
  const offlineConnection = snap.queries.sites.connection;

  child2 = spawn(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  });
  child2.stdout.on('data', (c) => { out += c; });
  child2.stderr.on('data', (c) => { out += c; });
  await until(() => existsSync(readyFile), 'ready again');
  await sleep(1500);
  const replayResult = await oObs.replay();
  await until(() => (outbox?.pending ?? 1) === 0, 'outbox drains after replay()');
  void offlineFreshness; void offlineConnection;

  qObs.dispose(); oObs.dispose(); await provider.dispose();
  writeFileSync(join(root, 'rv-a1-react.results.json'), `${JSON.stringify({
    ok: true, freshnessField, retentionField, outboxSupported: supported,
    pendingSeen, replayResult, finalOutbox: outbox,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, freshnessField, retentionField, pendingSeen, replayResult, finalOutbox: outbox }));
} finally {
  for (const c of [child, child2]) {
    if (c && c.exitCode === null) {
      c.stdin.end();
      const deadline = Date.now() + 10_000;
      while (c.exitCode === null && Date.now() < deadline) await sleep(25);
      if (c.exitCode === null) c.kill('SIGKILL');
    }
  }
}
