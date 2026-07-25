// fetchBundle client behavior (LLP 0090 rollout steps 2 + 7; contract LLP
// 0092 §0D): request shape for both modes, client-minted boot idempotency
// keys, register-mode grant adoption so the subsequent connection-scoped
// operations present the bundle-minted grant without a second
// /connection/open handshake, and the step-7 registered-boot seam — a
// register-mode entry adopted into liveQuery opens NO fresh
// snapshot-with-subscribe and receives deltas by its bundle subscription id.

import assert from 'node:assert/strict';
import { SnapbackClient, createRqsRegisteredRegistry } from './index.mjs';

const requests = [];
let bundleResponse = null;
const outboxQueue = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ path, method: init.method ?? 'GET', body, headers: init.headers ?? {} });
  if (path === '/app/bundle') {
    return new Response(JSON.stringify(bundleResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (path.startsWith('/outbox/')) {
    return new Response(JSON.stringify(outboxQueue.splice(0, outboxQueue.length)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ diagnostic: { code: 'UNEXPECTED', message: path } }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  });
};

try {
  // Boot-key minting: 22-char base64url, distinct per mint.
  const keyA = SnapbackClient.mintBundleBootKey();
  const keyB = SnapbackClient.mintBundleBootKey();
  assert.equal(keyA.length, 22);
  assert.match(keyA, /^[A-Za-z0-9_-]{22}$/u);
  assert.notEqual(keyA, keyB, 'two boot attempts hold distinct keys');

  const client = new SnapbackClient('http://127.0.0.1:9');
  const devManifestEntry = {
    route: '/home',
    queries: [{ function: 'listPosts', args: {} }],
  };

  // Read mode: no idempotency key rides the request; no connection state.
  bundleResponse = {
    commitVersion: 7,
    generation: 'gen1:aa',
    versionStream: 'stream-1',
    entries: [{ function: 'listPosts', args: {}, rows: [], resume: null }],
  };
  const read = await client.fetchBundle({
    route: '/home',
    devManifestEntry,
    userId: 'user_1',
  });
  assert.equal(read.commitVersion, 7);
  const readRequest = requests.find((request) => request.path === '/app/bundle');
  assert.equal(readRequest.body.mode, 'read');
  assert.equal(readRequest.body.idempotencyKey, undefined);
  assert.equal(readRequest.body.route, '/home');
  assert.deepEqual(readRequest.body.devManifestEntry, devManifestEntry);
  assert.equal(readRequest.body.auth.user_id, 'user_1');

  // Register mode: a key is minted when the caller supplies none, and the
  // returned grant is adopted so a connection-scoped drain presents it
  // without opening a second handshake.
  requests.length = 0;
  bundleResponse = {
    commitVersion: 8,
    generation: 'gen1:aa',
    versionStream: 'stream-1',
    entries: [
      {
        function: 'listPosts',
        args: {},
        rows: [],
        resume: null,
        subscriptionId: 'sub_1',
      },
    ],
    connection: {
      connectionId: 'conn_bundle',
      grant: 'sct_bundle_secret',
      attachDeadline: 123456,
    },
  };
  const registered = await client.fetchBundle({
    route: '/home',
    mode: 'register',
    devManifestEntry,
    userId: 'user_1',
  });
  const registerRequest = requests.find((request) => request.path === '/app/bundle');
  assert.equal(registerRequest.body.mode, 'register');
  assert.match(registerRequest.body.idempotencyKey, /^[A-Za-z0-9_-]{22}$/u);
  assert.equal(registered.connection.connectionId, 'conn_bundle');

  await client.drainEnvelopes('conn_bundle');
  const drain = requests.find((request) => request.path.startsWith('/outbox/'));
  assert.ok(drain, 'the drain must have run');
  assert.equal(
    drain.headers['x-snapback-connection-token'],
    'sct_bundle_secret',
    'connection-scoped operations present the adopted bundle grant',
  );
  assert.ok(
    !requests.some((request) => request.path === '/connection/open'),
    'the adopted grant must not trigger a second /connection/open handshake',
  );

  // A caller-supplied key rides unchanged (lost-response retry).
  requests.length = 0;
  await client.fetchBundle({
    route: '/home',
    mode: 'register',
    idempotencyKey: 'AAAAAAAAAAAAAAAAAAAAAA',
    devManifestEntry,
    userId: 'user_1',
  });
  const retryRequest = requests.find((request) => request.path === '/app/bundle');
  assert.equal(retryRequest.body.idempotencyKey, 'AAAAAAAAAAAAAAAAAAAAAA');

  // -------------------------------------------------------------------
  // Step 7 (LLP 0090 D4): registered-boot registry + liveQuery adoption.
  // -------------------------------------------------------------------
  requests.length = 0;
  bundleResponse = {
    commitVersion: 9,
    generation: 'gen1:aa',
    versionStream: 'stream-1',
    entries: [
      {
        function: 'listPosts',
        args: {},
        rows: [{ _id: 'p1', title: 'hello' }],
        // Auth-scoped shape: the closed union's `resume: null` rides
        // through the registry unchanged (LLP 0092 §0D.1).
        resume: null,
        subscriptionId: 'sub_reg_1',
      },
    ],
    connection: {
      connectionId: 'conn_reg',
      grant: 'sct_reg_secret',
      attachDeadline: 987654,
    },
  };
  const boot = await client.fetchBundle({
    route: '/home',
    mode: 'register',
    devManifestEntry,
    userId: 'user_1',
  });
  const registry = createRqsRegisteredRegistry(boot);
  assert.equal(registry.size, 1);
  assert.equal(registry.connection.connectionId, 'conn_reg');
  assert.equal(registry.lookup('listPosts', {}).version, 9, 'entry version is the bundle commit');
  assert.equal(registry.lookup('listPosts', {}).resume, null);

  const updates = [];
  const handle = await client.liveQuery('listPosts', {
    connectionId: 'conn_reg',
    userId: 'user_1',
    transport: 'poll',
    persistResume: false,
    registeredSubscription: registry.consume('listPosts', {}),
    onUpdate: (rows, detail) => updates.push({ kind: detail.kind, rows: rows.length }),
  });
  assert.equal(registry.consume('listPosts', {}), null, 'registry consumption is one-shot');
  assert.equal(handle.subscriptionId, 'sub_reg_1', 'the bundle registration is adopted');
  assert.deepEqual(handle.rows, [{ _id: 'p1', title: 'hello' }]);
  assert.equal(handle.version, 9);
  assert.equal(handle.freshness, 'current', 'the bundle snapshot is authoritative, not retained');
  assert.deepEqual(updates[0], { kind: 'registered', rows: 1 });
  assert.ok(
    !requests.some((request) => request.path.includes('/subscribe')),
    `adoption must not open a fresh snapshot-with-subscribe: ${JSON.stringify(requests.map((r) => r.path))}`,
  );
  assert.ok(
    !requests.some((request) => request.path === '/connection/open'),
    'adoption presents the bundle grant, never a second handshake',
  );

  // A delta drained on the adopted grant applies by the bundle's
  // subscription id — deltas-only after boot, no snapshot replay.
  outboxQueue.push({
    Durable: {
      payload: JSON.stringify({
        kind: 'live_delta',
        subscription_id: 'sub_reg_1',
        version: 10,
        ops: [{ op: 'add', id: 'p2', row: { _id: 'p2', title: 'delta' } }],
      }),
    },
  });
  await handle.poll();
  assert.equal(handle.rows.length, 2);
  assert.equal(handle.version, 10);
  assert.deepEqual(updates.at(-1), { kind: 'live_delta', rows: 2 });
  assert.ok(
    !requests.some((request) => request.path.includes('/subscribe')),
    'delta application must not trigger a resubscribe',
  );
  const drainRequest = requests.find((request) => request.path.startsWith('/outbox/'));
  assert.equal(
    drainRequest.headers['x-snapback-connection-token'],
    'sct_reg_secret',
    'the adopted registration drains under the bundle grant',
  );
  handle.dispose();

  console.log('bundle.test.mjs passed');
} finally {
  globalThis.fetch = originalFetch;
}
