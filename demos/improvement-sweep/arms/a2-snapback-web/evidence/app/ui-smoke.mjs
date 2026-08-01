// React-arm runtime smoke for the A2 UI path: sessions bearer custody,
// prepared provider, grouped queries, mutation, presence — the exact
// surfaces src/App.tsx uses — driven via the packaged headless observers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createExternalSessionClient } from '@expo/snapback-client';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackPresence,
  observeSnapbackQueries,
} from '@expo/snapback-react';
import api from './snapback/generated/api.mjs';
import functions from './snapback/generated/functions.manifest.json' with { type: 'json' };
import capabilityManifest from './snapback/generated/capability.manifest.json' with { type: 'json' };
import schema from './snapback/generated/schema.manifest.json' with { type: 'json' };

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
// fresh arm-owned target (the raw admin reset used by the acceptance suite
// leaves rows outside versioned-seed identity, which a new dev start refuses)
const { rmSync } = await import('node:fs');
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
    return {
      provider: createSnapbackReactProvider(binding),
      binding,
      userId: credential.session.userId,
      token: credential.token,
    };
  };

  // 0.1.7 defect (finding a2-f2-react-presence-room-wedged-by-live-queries):
  // a provider with any active live-query subscription never brings its
  // managed presence room out of 'connecting'. Presence is therefore proven
  // on dedicated presence-only providers over the same sessions.
  const presenceProviderFor = async (persona) => {
    const client = createExternalSessionClient(ready.serverUrl, { bearerToken: persona.token });
    const binding = await client.prepareReactBinding({
      generatedManifest: { schema, functions, capabilityManifest },
    });
    return { provider: createSnapbackReactProvider(binding), binding };
  };

  const alice = await signIn('alice@sweep-a2.test');
  const bob = await signIn('bob@sweep-a2.test');

  // grouped channel queries, as the sidebar does
  let aliceSnap = null;
  const aliceObserver = observeSnapbackQueries(alice.provider, {
    publicChannels: { ref: api.listPublicChannels, args: {} },
    myPrivate: { ref: api.listMyPrivateChannels, args: {} },
  }, (snapshot) => { aliceSnap = snapshot; });
  await until(() => aliceSnap?.queries.publicChannels.status === 'ready', 'alice channels ready');
  const generalId = aliceSnap.queries.publicChannels.data.find((r) => r.name === 'general')._id;

  // message view, as the chat panel does
  let aliceMessages = null;
  const messagesObserver = observeSnapbackQueries(alice.provider, {
    messages: { ref: api.listMessages, args: { channelId: generalId } },
    unread: { ref: api.unreadCount, args: { channelId: generalId } },
  }, (snapshot) => { aliceMessages = snapshot; });
  await until(() => aliceMessages?.queries.messages.status === 'ready', 'alice messages ready');
  const baseline = aliceMessages.queries.messages.data.length;

  // bob sends through his provider (the composer path)
  const messageId = await invokeSnapbackMutation(bob.provider, api.sendMessage, {
    channelId: generalId,
    body: 'ui smoke: hello from Bob',
    clientKey: `ui-smoke-${Date.now()}`,
    authorName: 'Bob',
  });
  assert.equal(typeof messageId, 'string');
  await until(
    () => aliceMessages.queries.messages.data.length === baseline + 1,
    'live delivery into the React store',
  );
  const delivered = aliceMessages.queries.messages.data.at(-1);
  assert.equal(delivered._id, messageId);
  assert.equal(delivered.authorName, 'Bob');
  assert.equal(delivered.authorId, bob.userId);
  await until(
    () => (aliceMessages.queries.unread.data?.[0]?.unread ?? 0) >= 1,
    'unread badge rises in the React store',
  );

  // presence, as the member panel does — on dedicated providers (see the
  // wedge defect note above; the single-provider path is the filed finding)
  const alicePresenceArm = await presenceProviderFor(alice);
  const bobPresenceArm = await presenceProviderFor(bob);
  let alicePresence = null;
  let bobPresence = null;
  const alicePresenceObserver = observeSnapbackPresence(
    alicePresenceArm.provider, alicePresenceArm.binding.ephemeral.chatPresence, {
      scope: { channelId: generalId },
      value: { name: 'Alice' },
      ttlMs: 8_000,
    }, (snapshot) => { alicePresence = snapshot; });
  const bobPresenceObserver = observeSnapbackPresence(
    bobPresenceArm.provider, bobPresenceArm.binding.ephemeral.chatPresence, {
      scope: { channelId: generalId },
      value: { name: 'Bob' },
      ttlMs: 8_000,
    }, (snapshot) => { bobPresence = snapshot; });
  try {
    await until(
      () => alicePresence?.status === 'ready'
        && alicePresence.entries.length === 2
        && bobPresence?.status === 'ready'
        && bobPresence.entries.length === 2,
      'both principals visible in presence on both providers',
    );
  } catch (err) {
    console.error('alice presence snapshot:', JSON.stringify(alicePresence));
    console.error('bob presence snapshot:', JSON.stringify(bobPresence));
    throw err;
  }
  const names = alicePresence.entries.map((e) => e.value.name).sort();
  assert.deepEqual(names, ['Alice', 'Bob']);

  // teardown: dispose everything, then prove zero provider-owned resources
  alicePresenceObserver.dispose();
  bobPresenceObserver.dispose();
  messagesObserver.dispose();
  aliceObserver.dispose();
  await alice.provider.dispose();
  await bob.provider.dispose();
  await alicePresenceArm.provider.dispose();
  await bobPresenceArm.provider.dispose();
  for (const [name, provider] of [
    ['alice', alice.provider], ['bob', bob.provider],
    ['alice-presence', alicePresenceArm.provider], ['bob-presence', bobPresenceArm.provider],
  ]) {
    const inspection = provider.inspection();
    assert.deepEqual(
      {
        stores: inspection.stores, consumers: inspection.consumers,
        subscriptions: inspection.serverSubscriptions, leases: inspection.leases,
        timers: inspection.timers, listeners: inspection.listeners,
      },
      { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
      `${name} provider fully drained`,
    );
  }
  console.log(JSON.stringify({
    schemaVersion: 'sweep-a2.ui-smoke.v1',
    ok: true,
    deliveredMessageId: messageId,
    presence: names,
    note: 'sessions bearer custody + prepared React provider + grouped live queries + mutation + presence, zero-leak disposal',
  }));
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
