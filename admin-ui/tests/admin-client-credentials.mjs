// Browser credential regression tests for the shared admin client.
//
// @ref LLP 0017#security-defaults — browser storage may contain only the
// short-lived derived console capability, never the master admin token.

import assert from 'node:assert/strict';

import { AdminClient } from '../../packages/snapback-admin-client/index.mjs';

const MASTER = 'master-admin-credential-SENTINEL';
const DERIVED = 'sbcc_derived-console-SENTINEL';
const SECRET_READ = 'sbrl_memory-only-secret-read-SENTINEL';
const storage = new Map([['snapback_admin_token', MASTER]]);
const storageWrites = [];
globalThis.localStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storageWrites.push([key, String(value)]);
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};
const sessionWrites = [];
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem(key, value) { sessionWrites.push([key, String(value)]); },
  removeItem() {},
};
const indexedDbCalls = [];
globalThis.indexedDB = {
  open(...args) { indexedDbCalls.push(['open', ...args]); },
  deleteDatabase(...args) { indexedDbCalls.push(['deleteDatabase', ...args]); },
};

const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  if (url.endsWith('/console/credential')) {
    return response(200, {
      credential: DERIVED,
      expiresAtMs: Date.now() + 60_000,
    });
  }
  return response(200, { ok: true });
};

const client = new AdminClient('http://snapback.test/_snapback/api');
assert.equal(
  storage.has('snapback_admin_token'),
  false,
  'constructing the browser client deletes legacy persisted master credentials',
);

await client.setToken(MASTER);
assert.equal(requests[0].url, 'http://snapback.test/_snapback/api/console/credential');
assert.equal(requests[0].options.method, 'POST');
assert.equal(requests[0].options.headers['x-snapback-admin-token'], MASTER);
assert.equal(
  requests[0].options.headers['x-snapback-console-credential'],
  undefined,
  'credential exchange cannot be authorized by an older derived credential',
);

const persisted = storage.get('snapback_console_credential_v1');
assert.ok(persisted, 'derived credential is persisted for browser reloads');
assert.deepEqual(
  Object.keys(JSON.parse(persisted)).sort(),
  ['credential', 'expiresAtMs'],
  'the persisted record contains only the derived token and its expiry',
);
assert.equal(JSON.parse(persisted).credential, DERIVED);
assert.deepEqual(
  [...storage.keys()],
  ['snapback_console_credential_v1'],
  'the derived record is the only credential storage entry',
);
assert.equal(
  [...storage.entries(), ...storageWrites, ...sessionWrites, ...indexedDbCalls]
    .some((entry) => JSON.stringify(entry).includes(MASTER)),
  false,
  'localStorage, sessionStorage, and IndexedDB fixtures never receive the master credential',
);
assert.deepEqual(sessionWrites, [], 'sessionStorage is not used for credentials');
assert.deepEqual(indexedDbCalls, [], 'IndexedDB is not used for credentials');

await client.inspect();
assert.equal(requests[1].options.headers['x-snapback-console-credential'], DERIVED);
assert.equal(
  requests[1].options.headers['x-snapback-admin-token'],
  undefined,
  'ordinary browser requests use only the derived carrier',
);

client.setSecretReadLease(SECRET_READ);
await client.scanTable('privateRows');
assert.equal(
  requests[2].options.headers['x-snapback-secret-read-lease'],
  SECRET_READ,
  'secret-bearing inspection may use the operator-minted in-memory lease',
);
assert.equal(
  [...storage.entries(), ...storageWrites, ...sessionWrites, ...indexedDbCalls]
    .some((entry) => JSON.stringify(entry).includes(SECRET_READ)),
  false,
  'the secret-read lease never enters a persistence adapter',
);

const reloaded = new AdminClient('http://snapback.test/_snapback/api');
await reloaded.configStatus();
assert.equal(
  requests[3].options.headers['x-snapback-console-credential'],
  DERIVED,
  'a reload restores the derived credential',
);
assert.equal(
  requests[3].options.headers['x-snapback-secret-read-lease'],
  undefined,
  'a reload never restores an operator secret-read lease',
);

const headless = new AdminClient('http://snapback.test/_snapback/api', { token: MASTER });
await headless.inspect();
assert.equal(requests[4].options.headers['x-snapback-admin-token'], MASTER);
assert.equal(
  storage.get('snapback_console_credential_v1'),
  persisted,
  'an explicit headless token remains in memory and does not mutate browser storage',
);

storage.set('snapback_console_credential_v1', JSON.stringify({
  credential: 'sbcc_expired',
  expiresAtMs: Date.now() - 1,
}));
const expired = new AdminClient('http://snapback.test/_snapback/api');
await expired.inspect();
assert.equal(
  requests[5].options.headers['x-snapback-console-credential'],
  undefined,
  'expired derived credentials are deleted instead of replayed',
);
assert.equal(storage.has('snapback_console_credential_v1'), false);

delete globalThis.fetch;
delete globalThis.indexedDB;
delete globalThis.localStorage;
delete globalThis.sessionStorage;

console.log('admin client credentials: ok');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}
