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
let fetchOverride = null;
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url, options });
  if (fetchOverride) return fetchOverride(url, options);
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

// A broken receiver/proxy can reflect any credential carrier in a transport
// exception, non-JSON response, structured diagnostic, or even HTTP-200 body.
// The shared client owns the last boundary before those values reach the UI.
fetchOverride = async () => {
  const error = new Error(`transport retained ${MASTER}`);
  error.code = `MASTER_${MASTER}`;
  error.diagnostic = {
    code: 'SNAPBACK_TRANSPORT_FAILED',
    message: `master=${MASTER}`,
    adminToken: MASTER,
  };
  throw error;
};
const masterFailure = await captureFailure(() => client.setToken(MASTER));
assertCredentialAbsent(masterFailure, MASTER, 'master transport failure');
assert.match(masterFailure.message, /\[REDACTED\]/);

fetchOverride = async () => ({
  ok: false,
  status: 502,
  async text() {
    return `<html>proxy reflected ${DERIVED}</html>`;
  },
});
const derivedFailure = await captureFailure(() => reloaded.configStatus());
assertCredentialAbsent(derivedFailure, DERIVED, 'derived non-JSON response');
assert.equal(derivedFailure.status, 502);

fetchOverride = async () => response(401, {
  diagnostic: {
    code: 'SNAPBACK_ADMIN_SECRET_READ_REQUIRED',
    message: `lease ${SECRET_READ} was rejected`,
    details: {
      secretReadLease: SECRET_READ,
      nested: [`again ${SECRET_READ}`],
    },
  },
});
const leaseFailure = await captureFailure(() => client.scanTable('privateRows'));
assertCredentialAbsent(leaseFailure, SECRET_READ, 'secret-read diagnostic');
assert.equal(leaseFailure.diagnostic.details.secretReadLease, '[REDACTED]');

fetchOverride = async (_url, options) => response(200, {
  reflected: Object.values(options.headers).join(' / '),
});
const reflectedMaster = await headless.inspect();
assertCredentialAbsent(reflectedMaster, MASTER, 'master HTTP-200 response');
assert.deepEqual(reflectedMaster, { reflected: '[REDACTED]' });
const reflectedSession = await client.inspect();
assertCredentialAbsent(reflectedSession, DERIVED, 'derived HTTP-200 response');
assertCredentialAbsent(reflectedSession, SECRET_READ, 'secret-read HTTP-200 response');
assert.deepEqual(reflectedSession, { reflected: '[REDACTED] / [REDACTED]' });

fetchOverride = async () => response(200, {
  credential: DERIVED,
  expiresAtMs: Date.now() + 60_000,
  reflectedMaster: MASTER,
});
const poisonedExchange = await captureFailure(() => client.setToken(MASTER));
assert.equal(poisonedExchange.diagnostic.code, 'SNAPBACK_RESPONSE_INVALID');
assertCredentialAbsent(poisonedExchange, MASTER, 'poisoned credential exchange');

// Exact shape is not enough: the derived value itself must not retain the
// submitted master. This includes unavoidable one-byte collisions with the
// fixed `sbcc_` prefix. Neither candidate may reach the persisted projection.
for (const { master, minted } of [
  { master: 'QZX', minted: 'sbcc_QZX' },
  { master: 's', minted: 'sbcc_clean-console' },
]) {
  storage.delete('snapback_console_credential_v1');
  const writesBefore = storageWrites.length;
  fetchOverride = async () => response(200, {
    credential: minted,
    expiresAtMs: Date.now() + 60_000,
  });
  const collisionClient = new AdminClient('http://snapback.test/_snapback/api');
  const collisionFailure = await captureFailure(() => collisionClient.setToken(master));
  assert.deepEqual(collisionFailure.diagnostic, {
    code: 'SNAPBACK_RESPONSE_INVALID',
    message: 'console credential exchange returned an invalid credential',
  });
  assert.equal(storage.has('snapback_console_credential_v1'), false);
  assert.deepEqual(storageWrites.slice(writesBefore), [], 'colliding credential is never persisted');
}

// Known semantic carriers have no minimum secret length. Exercise one-, two-,
// and three-byte admin/config values in both diagnostics and successful object
// property names. Secret-bearing success keys are rejected rather than renamed.
for (const shortSecret of ['Q', 'QZ', 'QZX']) {
  const shortHeadless = new AdminClient('http://snapback.test/_snapback/api', {
    token: shortSecret,
  });
  fetchOverride = async () => response(500, {
    diagnostic: {
      code: 'SNAPBACK_SHORT_ADMIN_FAILED',
      message: `admin carrier ${shortSecret}`,
      [`reflected_${shortSecret}`]: 'property-name poison',
      adminToken: shortSecret,
    },
  });
  const adminFailure = await captureFailure(() => shortHeadless.inspect());
  assertCredentialAbsent(adminFailure, shortSecret, `${shortSecret.length}-byte admin diagnostic`);

  fetchOverride = async () => response(200, {
    [`reflected_${shortSecret}`]: 'property-name poison',
  });
  const adminKeyFailure = await captureFailure(() => shortHeadless.inspect());
  assert.equal(adminKeyFailure.diagnostic.code, 'SNAPBACK_RESPONSE_INVALID');
  assertCredentialAbsent(adminKeyFailure, shortSecret, `${shortSecret.length}-byte admin success key`);

  const configClient = new AdminClient('http://snapback.test/_snapback/api');
  fetchOverride = async (_url, options) => {
    const value = JSON.parse(options.body).value;
    return response(500, {
      diagnostic: {
        code: 'SNAPBACK_SHORT_CONFIG_FAILED',
        message: `config carrier ${value}`,
        [`reflected_${value}`]: 'property-name poison',
        value,
      },
    });
  };
  const configFailure = await captureFailure(() => (
    configClient.runFunction('configProbe', { value: shortSecret })
  ));
  assertCredentialAbsent(configFailure, shortSecret, `${shortSecret.length}-byte config diagnostic`);

  fetchOverride = async (_url, options) => {
    const value = JSON.parse(options.body).value;
    return response(200, { [`reflected_${value}`]: 'property-name poison' });
  };
  const configKeyFailure = await captureFailure(() => (
    configClient.runFunction('configProbe', { value: shortSecret })
  ));
  assert.equal(configKeyFailure.diagnostic.code, 'SNAPBACK_RESPONSE_INVALID');
  assertCredentialAbsent(configKeyFailure, shortSecret, `${shortSecret.length}-byte config success key`);
}

// ENG-24986: all-numeric operator secrets survive as JSON numbers unless every
// projection compares numeric positions in canonical string form. Cover the
// master, the memory-only secret-read lease, and a submitted config value in
// both error diagnostics and successful HTTP-200 reflections.
const NUMERIC_MASTER = String(Date.now() + 3_600_000);
const NUMERIC_LEASE = '735204601122334';
const NUMERIC_CONFIG = '246813579';

const numericHeadless = new AdminClient('http://snapback.test/_snapback/api', {
  token: NUMERIC_MASTER,
});
fetchOverride = async () => response(500, {
  diagnostic: {
    code: 'SNAPBACK_NUMERIC_ADMIN_FAILED',
    message: 'request refused',
    details: {
      reflected: Number(NUMERIC_MASTER),
      nested: [Number(NUMERIC_MASTER)],
    },
  },
});
const numericAdminFailure = await captureFailure(() => numericHeadless.inspect());
assertCredentialAbsent(numericAdminFailure, NUMERIC_MASTER, 'numeric master diagnostic');
assert.equal(numericAdminFailure.diagnostic.details.reflected, '[REDACTED]');
assert.deepEqual(numericAdminFailure.diagnostic.details.nested, ['[REDACTED]']);

fetchOverride = async () => response(200, { reflected: Number(NUMERIC_MASTER) });
const numericAdminSuccess = await numericHeadless.inspect();
assertCredentialAbsent(numericAdminSuccess, NUMERIC_MASTER, 'numeric master HTTP-200 response');
assert.deepEqual(numericAdminSuccess, { reflected: '[REDACTED]' });

const numericLeaseClient = new AdminClient('http://snapback.test/_snapback/api');
numericLeaseClient.setSecretReadLease(NUMERIC_LEASE);
fetchOverride = async () => response(401, {
  diagnostic: {
    code: 'SNAPBACK_ADMIN_SECRET_READ_REQUIRED',
    message: 'lease rejected',
    details: { reflected: Number(NUMERIC_LEASE) },
  },
});
const numericLeaseFailure = await captureFailure(() => numericLeaseClient.scanTable('privateRows'));
assertCredentialAbsent(numericLeaseFailure, NUMERIC_LEASE, 'numeric lease diagnostic');
assert.equal(numericLeaseFailure.diagnostic.details.reflected, '[REDACTED]');

fetchOverride = async () => response(200, { reflected: Number(NUMERIC_LEASE) });
const numericLeaseSuccess = await numericLeaseClient.scanTable('privateRows');
assertCredentialAbsent(numericLeaseSuccess, NUMERIC_LEASE, 'numeric lease HTTP-200 response');
assert.deepEqual(numericLeaseSuccess, { reflected: '[REDACTED]' });

const numericConfigClient = new AdminClient('http://snapback.test/_snapback/api');
fetchOverride = async (_url, options) => {
  const value = JSON.parse(options.body).value;
  return response(500, {
    diagnostic: {
      code: 'SNAPBACK_NUMERIC_CONFIG_FAILED',
      message: 'config rejected',
      details: { reflected: Number(value) },
    },
  });
};
const numericConfigFailure = await captureFailure(() => (
  numericConfigClient.runFunction('configProbe', { value: NUMERIC_CONFIG })
));
assertCredentialAbsent(numericConfigFailure, NUMERIC_CONFIG, 'numeric config diagnostic');
assert.equal(numericConfigFailure.diagnostic.details.reflected, '[REDACTED]');

fetchOverride = async (_url, options) => (
  response(200, { reflected: Number(JSON.parse(options.body).value) })
);
const numericConfigSuccess = await numericConfigClient.runFunction('configProbe', {
  value: NUMERIC_CONFIG,
});
assertCredentialAbsent(numericConfigSuccess, NUMERIC_CONFIG, 'numeric config HTTP-200 response');
assert.deepEqual(numericConfigSuccess, { reflected: '[REDACTED]' });

// ENG-24986: an exact-shape exchange whose valid future `expiresAtMs` is the
// submitted all-numeric master must never be returned, thrown with the value,
// or serialized into localStorage.
storage.delete('snapback_console_credential_v1');
const numericWritesBefore = storageWrites.length;
fetchOverride = async () => response(200, {
  credential: 'sbcc_clean-console-numeric',
  expiresAtMs: Number(NUMERIC_MASTER),
});
const numericExchangeClient = new AdminClient('http://snapback.test/_snapback/api');
const numericExchangeFailure = await captureFailure(() => (
  numericExchangeClient.setToken(NUMERIC_MASTER)
));
assert.deepEqual(numericExchangeFailure.diagnostic, {
  code: 'SNAPBACK_RESPONSE_INVALID',
  message: 'console credential exchange returned an invalid credential',
});
assertCredentialAbsent(numericExchangeFailure, NUMERIC_MASTER, 'numeric master expiry reflection');
assert.equal(storage.has('snapback_console_credential_v1'), false);
assert.deepEqual(
  storageWrites.slice(numericWritesBefore),
  [],
  'a record reflecting the numeric master is never persisted',
);
assert.equal(
  [...storage.entries(), ...storageWrites, ...sessionWrites, ...indexedDbCalls]
    .some((entry) => JSON.stringify(entry).includes(NUMERIC_MASTER)),
  false,
  'no persistence adapter ever receives the numeric master',
);

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

async function captureFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail('expected operation to fail');
}

function assertCredentialAbsent(value, credential, label) {
  const projection = value instanceof Error
    ? {
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: value.code,
        status: value.status,
        diagnostic: value.diagnostic,
      }
    : value;
  assert.equal(
    JSON.stringify(projection).includes(credential),
    false,
    `${label} must not retain the credential`,
  );
}
