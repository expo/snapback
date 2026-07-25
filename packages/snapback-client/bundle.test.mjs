// fetchBundle client behavior (LLP 0090 rollout step 2; contract LLP 0092
// §0D): request shape for both modes, client-minted boot idempotency keys,
// and register-mode grant adoption so the subsequent connection-scoped
// operations present the bundle-minted grant without a second
// /connection/open handshake.

import assert from 'node:assert/strict';
import { SnapbackClient } from './index.mjs';

const requests = [];
let bundleResponse = null;
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
    return new Response(JSON.stringify([]), {
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

  console.log('bundle.test.mjs passed');
} finally {
  globalThis.fetch = originalFetch;
}
