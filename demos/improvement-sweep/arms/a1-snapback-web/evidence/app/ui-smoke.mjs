// React-arm runtime smoke for the A1 UI path: sessions bearer custody,
// prepared provider, site directory + protected records queries, workspace
// bootstrap and record creation — the exact surfaces src/App.tsx uses —
// driven via the packaged headless observers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createExternalSessionClient } from '@expo/snapback-client';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
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
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
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

let exitCode = 1;
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
      { headers: {
          'x-snapback-admin-token': adminToken,
          'x-snapback-impersonation-capability': impersonation,
        } },
    ).then((r) => r.json());
    const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
      method: 'POST', headers,
      body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
    }).then((r) => r.json());
    const client = createExternalSessionClient(ready.serverUrl, { bearerToken: credential.token });
    const binding = await client.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest },
    });
    return { provider: createSnapbackReactProvider(binding), userId: credential.session.userId };
  };

  const alice = await signIn('alice@sweep-a1.test');
  const bob = await signIn('bob@sweep-a1.test');

  // site directory, as the nav does
  let aliceSnap = null;
  const sitesObserver = observeSnapbackQueries(alice.provider, {
    sites: { ref: api.listSites, args: {} },
  }, (snapshot) => { aliceSnap = snapshot; });
  await until(() => aliceSnap?.queries.sites.status === 'ready', 'sites ready');
  assert.equal(aliceSnap.queries.sites.data.length, 3);

  // workspace bootstrap, as the New-workspace button does
  const workspaceId = await invokeSnapbackMutation(alice.provider, api.createWorkspace, {
    name: 'Field survey — Alice',
  });
  assert.equal(typeof workspaceId, 'string');
  await invokeSnapbackMutation(alice.provider, api.inviteToWorkspace, {
    workspaceId, userId: bob.userId,
  });
  await invokeSnapbackMutation(bob.provider, api.acceptWorkspaceInvite, { workspaceId });

  // protected records view, as the table does
  let aliceRecords = null;
  const recordsObserver = observeSnapbackQueries(alice.provider, {
    records: { ref: api.listRecords, args: { workspaceId } },
  }, (snapshot) => { aliceRecords = snapshot; });
  await until(() => aliceRecords?.queries.records.status === 'ready', 'records ready');
  const baseline = aliceRecords.queries.records.data.length;

  // bob creates through his provider (the add-record path)
  const recordId = await invokeSnapbackMutation(bob.provider, api.createRecord, {
    workspaceId,
    title: 'ui smoke: north fence pass',
    assigneeId: bob.userId,
    assigneeName: 'Bob',
    dueAt: Date.now() + 86_400_000,
    position: 1000,
    clientKey: `ui-smoke-${Date.now()}`,
  });
  assert.equal(typeof recordId, 'string');
  await until(
    () => aliceRecords.queries.records.data.length === baseline + 1,
    'live delivery into the React store',
  );
  const delivered = aliceRecords.queries.records.data.at(-1);
  assert.equal(delivered._id, recordId);
  assert.equal(delivered.assigneeName, 'Bob');
  assert.equal(delivered.state, 'open');

  // teardown: dispose everything
  recordsObserver.dispose();
  sitesObserver.dispose();
  await alice.provider.dispose();
  await bob.provider.dispose();
  console.error('UI SMOKE PASS: sites=3, workspace bootstrap, live record delivery into the React store');
  exitCode = 0;
} catch (error) {
  console.error('UI SMOKE FAIL:', error?.message ?? error);
} finally {
  child.stdin.end();
  await sleep(1_000);
  process.exit(exitCode);
}
