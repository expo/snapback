// RV 0.1.8 — A2 presence pair re-verification (findings a2-f1 + a2-f2).
// Fixed claims: (F1) a provider that OWNS active live-query subscriptions
// brings its managed presence room to 'ready'; (F2) the GENERATED
// api.ephemeral.* reference is admitted by the binding (no schemaVersion
// mismatch).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createExternalSessionClient } from '@expo/snapback-client';
import {
  createSnapbackReactProvider,
  observeSnapbackPresence,
  observeSnapbackQueries,
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
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}\n${out.slice(-1500)}`);
    await sleep(30);
  }
};
const facts = [];

try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready file');
  await until(() => out.includes('generated-and-loaded'), 'loaded');
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
    const client = createExternalSessionClient(ready.serverUrl, { bearerToken: credential.token });
    const binding = await client.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest },
    });
    return { provider: createSnapbackReactProvider(binding), binding };
  };

  const alice = await signIn('alice@rv018-a2.test');
  const bob = await signIn('bob@rv018-a2.test');

  // Providers OWN live queries first (the 0.1.7 wedge precondition).
  let aliceSnap = null;
  const aliceObserver = observeSnapbackQueries(alice.provider, {
    publicChannels: { ref: api.listPublicChannels, args: {} },
  }, (snapshot) => { aliceSnap = snapshot; });
  await until(() => aliceSnap?.queries.publicChannels.status === 'ready', 'alice live query ready');
  const generalId = aliceSnap.queries.publicChannels.data.find((r) => r.name === 'general')._id;
  let bobSnap = null;
  const bobObserver = observeSnapbackQueries(bob.provider, {
    publicChannels: { ref: api.listPublicChannels, args: {} },
  }, (snapshot) => { bobSnap = snapshot; });
  await until(() => bobSnap?.queries.publicChannels.status === 'ready', 'bob live query ready');

  // RV-A2-F2: the GENERATED api.ephemeral reference on the SAME providers.
  assert.ok(api.ephemeral?.chatPresence, 'generated api carries ephemeral.chatPresence');
  let alicePresence = null;
  let bobPresence = null;
  const aliceP = observeSnapbackPresence(
    alice.provider, api.ephemeral.chatPresence, {
      scope: { channelId: generalId }, value: { name: 'Alice' }, ttlMs: 8_000,
    }, (snapshot) => { alicePresence = snapshot; });
  const bobP = observeSnapbackPresence(
    bob.provider, api.ephemeral.chatPresence, {
      scope: { channelId: generalId }, value: { name: 'Bob' }, ttlMs: 8_000,
    }, (snapshot) => { bobPresence = snapshot; });

  // RV-A2-F1: ready + published on providers that own live queries.
  try {
    await until(
      () => alicePresence?.status === 'ready' && alicePresence.entries.length === 2
        && bobPresence?.status === 'ready' && bobPresence.entries.length === 2,
      'presence ready beside owned live queries (collapsed window)', 20_000,
    );
    const names = alicePresence.entries.map((e) => e.value.name).sort();
    assert.deepEqual(names, ['Alice', 'Bob']);
    facts.push({ id: 'RV-A2-F1', result: 'pass',
      note: `presence status ready, publisher ${alicePresence.publisher ?? '(field absent)'}, 2 entries, on a provider owning an active live query` });
    facts.push({ id: 'RV-A2-F2', result: 'pass',
      note: 'generated api.ephemeral.chatPresence admitted by prepareReactBinding path; no schemaVersion refusal' });
  } catch (err) {
    facts.push({ id: 'RV-A2-F1', result: 'fail', note: `${err.message}; alice=${JSON.stringify(alicePresence)}` });
    facts.push({ id: 'RV-A2-F2', result: alicePresence ? 'pass' : 'fail',
      note: alicePresence ? 'reference admitted (observer produced snapshots)' : 'no snapshot; reference may be refused' });
  }

  aliceP.dispose(); bobP.dispose(); bobObserver.dispose(); aliceObserver.dispose();
  await alice.provider.dispose(); await bob.provider.dispose();
  writeFileSync(join(root, 'rv-a2.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
