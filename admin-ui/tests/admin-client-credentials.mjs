// Browser credential regression tests for the shared admin client.
//
// @ref LLP 0017#security-defaults — browser storage may contain only the
// short-lived derived console capability, never the master admin token.

import assert from 'node:assert/strict';

import {
  AdminClient,
  consumeConsoleCredentialFragment,
} from '../../packages/snapback-admin-client/index.mjs';

const MASTER = 'master-admin-credential-SENTINEL';
const DERIVED = 'sbcc_derived-console-SENTINEL';
const SECRET_READ = 'sbrl_memory-only-secret-read-SENTINEL';
const UNKNOWN_ISSUED = 'sbcc_unknown-non-2xx-successor-SENTINEL';
const UNKNOWN_FETCH_REJECTION = 'sbcc_unknown-fetch-rejection-successor-SENTINEL';
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
const sessionStorageRecords = new Map();
globalThis.sessionStorage = {
  getItem(key) { return sessionStorageRecords.get(key) ?? null; },
  setItem(key, value) {
    sessionWrites.push([key, String(value)]);
    sessionStorageRecords.set(key, String(value));
  },
  removeItem(key) { sessionStorageRecords.delete(key); },
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
      expiresAtMs: Date.now() + 10 * 60_000,
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
  const cause = new Error(`cause retained ${UNKNOWN_FETCH_REJECTION}`);
  cause.code = `CAUSE_${UNKNOWN_FETCH_REJECTION}`;
  const error = new Error(
    `transport retained ${MASTER} and ${UNKNOWN_FETCH_REJECTION}`,
    { cause },
  );
  error.name = `Issuer${UNKNOWN_FETCH_REJECTION}`;
  error.code = `MASTER_${MASTER}_${UNKNOWN_FETCH_REJECTION}`;
  error.diagnostic = {
    code: `SNAPBACK_TRANSPORT_${UNKNOWN_FETCH_REJECTION}`,
    message: `master=${MASTER}; successor=${UNKNOWN_FETCH_REJECTION}`,
    details: { adminToken: MASTER, successorCredential: UNKNOWN_FETCH_REJECTION },
  };
  error[`credential_${UNKNOWN_FETCH_REJECTION}`] = UNKNOWN_FETCH_REJECTION;
  throw error;
};
const masterFailure = await captureFailure(() => client.setToken(MASTER));
assertCredentialAbsent(masterFailure, MASTER, 'master transport failure');
assertCredentialAbsent(masterFailure, UNKNOWN_FETCH_REJECTION, 'unknown rejected successor');
assert.equal(
  masterFailure.message,
  'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: credential issuer returned an invalid response',
);
assert.deepEqual(masterFailure.diagnostic, {
  code: 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
  message: 'credential issuer returned an invalid response',
});
assert.equal(Object.hasOwn(masterFailure, 'cause'), false);
assert.equal(Object.hasOwn(masterFailure, 'receipt'), false);
assert.equal(
  JSON.stringify(Object.keys(masterFailure)).includes(UNKNOWN_FETCH_REJECTION),
  false,
  'issuer rejection property names are discarded',
);

// Ordinary non-issuer fetch rejection keeps the existing request-secret
// sanitizer rather than being collapsed to the credential issuer error.
fetchOverride = async () => {
  const error = new Error(`ordinary transport retained ${DERIVED}`);
  error.code = `ORDINARY_${DERIVED}`;
  throw error;
};
const ordinaryTransportFailure = await captureFailure(() => reloaded.configStatus());
assertCredentialAbsent(ordinaryTransportFailure, DERIVED, 'ordinary transport failure');
assert.notEqual(
  ordinaryTransportFailure.code,
  'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
);
assert.match(ordinaryTransportFailure.message, /\[REDACTED\]/);

// A 307 must remain a first-hop response. A fetch adapter that sees anything
// but manual mode models the platform default by recording the credential at
// the hostile target; the hardened client never lets that branch run.
const redirectRequests = [];
fetchOverride = async (url, options) => {
  redirectRequests.push({ url, options });
  if (options.redirect !== 'manual') {
    redirectRequests.push({
      url: 'https://redirect-target.invalid/replayed',
      options,
    });
    return response(200, { replayed: true });
  }
  return {
    ok: false,
    status: 307,
    type: 'basic',
    headers: { get: () => null },
    body: { cancel: async () => {} },
    async text() { assert.fail('redirect bodies are not materialized'); },
  };
};
const redirectFailure = await captureFailure(() => headless.inspect());
assert.equal(redirectFailure.code, 'SNAPBACK_REDIRECT_REFUSED');
assert.deepEqual(redirectFailure.diagnostic.details, { status: 307 });
assert.equal(redirectRequests.length, 1, 'the admin credential is sent to one origin only');
assert.equal(redirectRequests[0].options.redirect, 'manual');
assert.equal(
  redirectRequests.some(({ url }) => url.startsWith('https://redirect-target.invalid')),
  false,
  'the admin credential is never replayed to the redirect target',
);

fetchOverride = async (_url, options) => {
  assert.equal(options.redirect, 'manual', 'credentialed happy paths retain the redirect fence');
  return response(200, { ok: true });
};
assert.deepEqual(await headless.inspect(), { ok: true }, 'ordinary 2xx admin responses are unchanged');

let oversizedBodyCancelled = false;
fetchOverride = async () => ({
  ok: true,
  status: 200,
  headers: {
    get(name) {
      return name === 'content-length' ? String(64 * 1024 * 1024 + 1) : null;
    },
  },
  body: { cancel: async () => { oversizedBodyCancelled = true; } },
  async text() { assert.fail('oversized admin responses are rejected before materialization'); },
});
const oversizedFailure = await captureFailure(() => headless.inspect());
assert.equal(oversizedFailure.code, 'SNAPBACK_INGRESS_LIMIT_EXCEEDED');
assert.deepEqual(oversizedFailure.diagnostic.details, {
  ingressClass: 'admin',
  limitBytes: 64 * 1024 * 1024,
});
assert.equal(oversizedBodyCancelled, true);

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

const UNKNOWN_SUCCESSOR = 'sbcc_unknown-successor-from-reader-SENTINEL';
fetchOverride = async () => ({
  ok: true,
  status: 200,
  async text() {
    throw new Error(`reader exposed ${UNKNOWN_SUCCESSOR}`);
  },
});
const readerFailure = await captureFailure(() => client.setToken(MASTER));
assert.equal(readerFailure.diagnostic.code, 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID');
assertCredentialAbsent(readerFailure, MASTER, 'credential reader failure master');
assertCredentialAbsent(readerFailure, UNKNOWN_SUCCESSOR, 'credential reader failure successor');

const storedBeforeIssuerFailure = storage.get('snapback_console_credential_v1');
fetchOverride = async () => response(503, {
  diagnostic: {
    code: 'UPSTREAM_MINT_FAILED',
    message: `mint failed after issuing ${UNKNOWN_ISSUED}`,
    details: {
      successorCredential: UNKNOWN_ISSUED,
      [`credential_${UNKNOWN_ISSUED}`]: 'property-name poison',
    },
  },
});
const non2xxIssuerFailure = await captureFailure(() => client.setToken(MASTER));
assert.equal(
  non2xxIssuerFailure.message,
  'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: credential issuer returned an invalid response',
);
assert.deepEqual(non2xxIssuerFailure.diagnostic, {
  code: 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
  message: 'credential issuer returned an invalid response',
});
assertCredentialAbsent(non2xxIssuerFailure, MASTER, 'non-2xx mint master');
assertCredentialAbsent(non2xxIssuerFailure, UNKNOWN_ISSUED, 'non-2xx mint successor');
assert.equal(
  storage.get('snapback_console_credential_v1'),
  storedBeforeIssuerFailure,
  'a non-2xx mint failure cannot replace persisted credential custody',
);

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

// The Docs tab reads the public served-guide projection. It must never attach
// admin credentials, and it must bind every page to the manifest response's
// content/build identity before returning bytes to the renderer.
const GUIDE_HASH = 'a'.repeat(64);
const GUIDE_COMMIT = 'b'.repeat(40);
const guideRequests = [];
fetchOverride = async (url, options = {}) => {
  guideRequests.push({ url, options });
  if (url.endsWith('/guide-manifest.generated.json')) {
    return guideResponse(JSON.stringify({
      schemaVersion: 'snapback-guide.v1',
      contentHash: GUIDE_HASH,
      buildIdentity: { commit: GUIDE_COMMIT },
      nav: {},
      pages: {},
    }), GUIDE_HASH, GUIDE_COMMIT);
  }
  return guideResponse('# Guide', GUIDE_HASH, GUIDE_COMMIT);
};
const guideClient = new AdminClient('http://snapback.test/_snapback/api', { token: MASTER });
const loadedGuideManifest = await guideClient.guideManifest();
assert.equal(loadedGuideManifest.identity.contentHash, GUIDE_HASH);
assert.equal(
  guideRequests[0].url,
  'http://snapback.test/_snapback/guide/guide-manifest.generated.json',
  'guide manifest uses the public served-guide origin',
);
assert.deepEqual(guideRequests[0].options.headers, undefined, 'guide reads attach no admin credential');
assert.equal(
  await guideClient.guidePage('index.md', loadedGuideManifest.identity),
  '# Guide',
  'a page with the manifest identity is returned as Markdown',
);
await assert.rejects(
  () => guideClient.guidePage('../secret.md', loadedGuideManifest.identity),
  (error) => error.diagnostic?.code === 'SNAPBACK_GUIDE_PATH_INVALID',
  'guide traversal is rejected before fetch',
);
fetchOverride = async () => guideResponse('# Wrong build', GUIDE_HASH, 'c'.repeat(40));
await assert.rejects(
  () => guideClient.guidePage('index.md', loadedGuideManifest.identity),
  (error) => error.diagnostic?.code === 'SNAPBACK_GUIDE_IDENTITY_MISMATCH',
  'guide pages from another build are rejected',
);

const telemetryRequests = [];
fetchOverride = async (url, options = {}) => {
  telemetryRequests.push({ url, options });
  return response(200, { events: [], statusCounts: [] });
};
const telemetryClient = new AdminClient('http://snapback.test/_snapback/api', { token: MASTER });
telemetryClient.setSecretReadLease(SECRET_READ);
await telemetryClient.telemetryStats({
  kind: 'http_request', fromMs: 10, callerKey: 'int_test', lane: 'integration',
  groupByCaller: true, ignored: MASTER,
});
await telemetryClient.telemetryEvents({ kind: 'log', text: 'needle / value', order: 'desc', limit: 25 });
await telemetryClient.errorsIssues({ state: 'regressed', failureDisposition: 'fault', order: 'lastSeen', limit: 500, ignored: MASTER });
await telemetryClient.errorsIssue('iss_test');
await telemetryClient.errorsTransition({ issue: 'iss_test', to: 'resolved', expectSeq: 7 });
await telemetryClient.networkProfile();
await telemetryClient.setNetworkProfile('optimistic', { source: 'console' });
await telemetryClient.setNetworkProfile({
  name: 'office-wifi',
  mutationAckDelayMs: 120,
  liveDeltaDelayMs: 80,
  queryResponseDelayMs: 40,
  jitterMs: 10,
});
assert.equal(
  telemetryRequests[0].url,
  'http://snapback.test/_snapback/api/telemetry/stats?kind=http_request&fromMs=10&callerKey=int_test&lane=integration&groupByCaller=true',
  'Health uses only the closed telemetry.stats query vocabulary',
);
assert.equal(
  telemetryRequests[0].options.headers['x-snapback-secret-read-lease'],
  undefined,
  'aggregate Health reads do not attach raw-read authority',
);
assert.equal(
  telemetryRequests[1].url,
  'http://snapback.test/_snapback/api/telemetry/events?kind=log&text=needle+%2F+value&order=desc&limit=25',
  'Logs encodes the closed telemetry.events filter vocabulary',
);
assert.equal(
  telemetryRequests[1].options.headers['x-snapback-secret-read-lease'],
  SECRET_READ,
  'Logs attaches the memory-only raw-read lease',
);
assert.equal(
  telemetryRequests[2].url,
  'http://snapback.test/_snapback/api/errors/issues?state=regressed&failureDisposition=fault&order=lastSeen&limit=500',
  'Errors list encodes only the closed structural selector vocabulary',
);
assert.equal(
  telemetryRequests[2].options.headers['x-snapback-secret-read-lease'],
  undefined,
  'structural Errors reads do not attach raw-read authority',
);
assert.equal(
  telemetryRequests[3].url,
  'http://snapback.test/_snapback/api/errors/issue?issue=iss_test',
  'raw issue detail uses the dedicated typed operation',
);
assert.equal(
  telemetryRequests[3].options.headers['x-snapback-secret-read-lease'],
  SECRET_READ,
  'raw issue detail attaches the memory-only errors.issue lease',
);
assert.equal(telemetryRequests[4].options.method, 'POST', 'error state controls use the typed transition write');
assert.deepEqual(
  JSON.parse(telemetryRequests[4].options.body),
  { issue: 'iss_test', to: 'resolved', expectSeq: 7 },
  'error transition preserves the state-sequence CAS body',
);
assert.equal(
  telemetryRequests[5].url,
  'http://snapback.test/_snapback/api/debug/network-profile',
  'network profile status uses the dedicated AdminRead route',
);
assert.equal(telemetryRequests[5].options.method, 'GET', 'network profile status is a GET');
assert.equal(telemetryRequests[6].options.method, 'PUT', 'built-in profile activation is a PUT');
assert.equal(telemetryRequests[6].options.body, '"optimistic"', 'built-in profile activation sends a JSON string');
assert.equal(
  telemetryRequests[6].options.headers['x-snapback-network-profile-source'],
  'console',
  'an explicit console activation carries the provenance source hint',
);
assert.deepEqual(
  JSON.parse(telemetryRequests[7].options.body),
  {
    name: 'office-wifi', mutationAckDelayMs: 120, liveDeltaDelayMs: 80,
    queryResponseDelayMs: 40, jitterMs: 10,
  },
  'custom profile activation sends the inline object unchanged',
);

const FRAGMENT_DERIVED = 'sbcc_fragment-handoff';
const fragmentExpiry = Date.now() + 60_000;
let replacedFragmentUrl = null;
const fragmentClient = new AdminClient('http://snapback.test/_snapback/api');
assert.equal(
  await consumeConsoleCredentialFragment(
    fragmentClient,
    {
      hash: `#credential=${FRAGMENT_DERIVED}&expiresAtMs=${fragmentExpiry}`,
      pathname: '/_snapback/admin/',
      search: '',
    },
    {
      state: { retained: true },
      replaceState(_state, _title, url) { replacedFragmentUrl = url; },
    },
  ),
  true,
);
assert.equal(replacedFragmentUrl, '/_snapback/admin/');
assert.equal(
  JSON.parse(storage.get('snapback_console_credential_v1')).credential,
  FRAGMENT_DERIVED,
  'fragment handoff lands in the same derived-only storage record as token exchange',
);

const CLAIM_CODE = 'sbcl_0123456789abcdef0123456789abcdef';
const CLAIM_DERIVED = 'sbcc_claim-derived';
let claimFragmentStripped = false;
const claimRequests = [];
fetchOverride = async (url, options = {}) => {
  claimRequests.push({ url, options });
  assert.equal(
    claimFragmentStripped,
    true,
    'the claim fragment is removed before the exchange request starts',
  );
  return response(200, {
    credential: CLAIM_DERIVED,
    expiresAtMs: Date.now() + 10 * 60_000,
    provenance: 'operatorClaim',
  });
};
const claimClient = new AdminClient('http://snapback.test/_snapback/api');
assert.equal(
  await consumeConsoleCredentialFragment(
    claimClient,
    {
      hash: `#claim=${CLAIM_CODE}`,
      pathname: '/_snapback/admin/',
      search: '',
    },
    {
      state: null,
      replaceState(_state, _title, url) {
        assert.equal(url, '/_snapback/admin/');
        claimFragmentStripped = true;
      },
    },
  ),
  true,
);
assert.equal(
  claimRequests[0].url,
  'http://snapback.test/_snapback/api/console/claim/exchange',
);
assert.equal(claimRequests[0].options.method, 'POST');
assert.deepEqual(JSON.parse(claimRequests[0].options.body), { claimCode: CLAIM_CODE });
assert.equal(
  claimRequests[0].url.includes(CLAIM_CODE),
  false,
  'the claim code never enters the HTTP URL',
);
assert.deepEqual(
  JSON.parse(storage.get('snapback_console_credential_v1')),
  {
    credential: CLAIM_DERIVED,
    expiresAtMs: JSON.parse(storage.get('snapback_console_credential_v1')).expiresAtMs,
    provenance: 'operatorClaim',
  },
  'claim exchange uses the existing credential storage path with distinct provenance',
);
assert.equal(
  [...storage.entries(), ...storageWrites]
    .some((entry) => JSON.stringify(entry).includes(CLAIM_CODE)),
  false,
  'the raw claim never enters browser storage',
);

// A credential received through a managed LAN/tailnet origin belongs only to
// this browser tab and this exact server process/session. Reload restoration
// probes public identity first and never sends a bearer while identity is
// missing, mismatched, or indeterminate.
const REACHABILITY_CLAIM = 'sbcl_11111111111111111111111111111111';
const REACHABILITY_DERIVED = 'sbcc_reachability-derived';
const REACHABILITY_SESSION = 'sbrs_11111111111111111111111111111111';
const REACHABILITY_INSTANCE = 'startup-instance-a';
const reachabilityExpiry = Date.now() + 10 * 60_000;
fetchOverride = async (url) => {
  assert.equal(url.endsWith('/console/claim/exchange'), true);
  return response(200, {
    credential: REACHABILITY_DERIVED,
    expiresAtMs: reachabilityExpiry,
    provenance: 'operatorClaim',
    reachability: {
      sessionId: REACHABILITY_SESSION,
      instanceId: REACHABILITY_INSTANCE,
    },
  });
};
const reachableClient = new AdminClient('http://snapback.test/_snapback/api');
await reachableClient.exchangeConsoleClaim(REACHABILITY_CLAIM);
assert.equal(
  storage.has('snapback_console_credential_v1'),
  false,
  'a reachability credential never falls back to localStorage',
);
const reachabilityKey = `snapback_reachability_credential_v1:${REACHABILITY_SESSION}:${REACHABILITY_INSTANCE}`;
assert.equal(
  JSON.parse(sessionStorageRecords.get(reachabilityKey)).credential,
  REACHABILITY_DERIVED,
  'the reachability credential is retained in this tab only',
);
assert.deepEqual(
  JSON.parse(sessionStorageRecords.get('snapback_reachability_sessions_v1')),
  [reachabilityKey],
);

const restoreRequests = [];
storage.set('snapback_console_credential_v1', JSON.stringify({
  credential: 'sbcc_stale-ordinary',
  expiresAtMs: reachabilityExpiry,
  provenance: 'operatorClaim',
}));
fetchOverride = async (url, options = {}) => {
  restoreRequests.push({ url, options });
  if (url.endsWith('/_snapback/admin/reachability/identity')) {
    return response(200, { instanceId: REACHABILITY_INSTANCE });
  }
  if (url.includes('/_snapback/admin/reachability/identity?session=')) {
    return response(200, {
      instanceId: REACHABILITY_INSTANCE,
      sessionId: REACHABILITY_SESSION,
    });
  }
  return response(200, { ok: true });
};
const reachableReload = new AdminClient('http://snapback.test/_snapback/api');
assert.equal(
  storage.has('snapback_console_credential_v1'),
  false,
  'a reachability restore candidate removes an older ordinary-storage fallback',
);
await reachableReload.inspect();
assert.equal(restoreRequests.length, 3);
assert.equal(
  restoreRequests[0].options.headers,
  undefined,
  'the process identity probe carries no credential',
);
assert.equal(
  restoreRequests[1].options.headers,
  undefined,
  'the exact-session identity probe carries no credential',
);
assert.equal(
  restoreRequests[2].options.headers['x-snapback-console-credential'],
  REACHABILITY_DERIVED,
  'only an exact instance and session match releases the tab credential',
);

const mismatchRequests = [];
fetchOverride = async (url, options = {}) => {
  mismatchRequests.push({ url, options });
  if (url.endsWith('/_snapback/admin/reachability/identity')) {
    return response(200, { instanceId: 'startup-instance-b' });
  }
  return response(200, { ok: true });
};
const mismatchedReload = new AdminClient('http://snapback.test/_snapback/api');
await mismatchedReload.inspect();
assert.equal(mismatchRequests.length, 2);
assert.equal(
  mismatchRequests[1].options.headers['x-snapback-console-credential'],
  undefined,
  'origin reuse by a different backend never receives the old bearer',
);
assert.equal(sessionStorageRecords.has(reachabilityKey), false);

const reachabilityRenewalRequests = [];
fetchOverride = async (url, options = {}) => {
  reachabilityRenewalRequests.push({ url, options });
  if (url.endsWith('/console/claim/exchange')) {
    return response(200, {
      credential: REACHABILITY_DERIVED,
      expiresAtMs: Date.now() + 1_000,
      provenance: 'operatorClaim',
      reachability: {
        sessionId: REACHABILITY_SESSION,
        instanceId: REACHABILITY_INSTANCE,
      },
    });
  }
  if (url.endsWith('/console/credential')) {
    return response(200, {
      credential: REACHABILITY_DERIVED,
      expiresAtMs: Date.now() + 10 * 60_000,
      provenance: 'operatorClaim',
    });
  }
  return response(200, { ok: true });
};
const leaseLostDuringRenewal = new AdminClient('http://snapback.test/_snapback/api');
await leaseLostDuringRenewal.exchangeConsoleClaim(REACHABILITY_CLAIM);
await assert.rejects(
  () => leaseLostDuringRenewal.inspect(),
  (error) => error.diagnostic?.code === 'SNAPBACK_RESPONSE_INVALID',
  'renewal without the exact reachability binding fails closed',
);
assert.equal(
  reachabilityRenewalRequests.some(({ url }) => url.endsWith('/inspect')),
  false,
  'a downgraded renewal cannot proceed to an API request',
);
assert.equal(sessionStorageRecords.has(reachabilityKey), false);
assert.equal(storage.has('snapback_console_credential_v1'), false);

fetchOverride = async (url) => {
  if (url.endsWith('/console/claim/exchange')) {
    return response(200, {
      credential: REACHABILITY_DERIVED,
      expiresAtMs: reachabilityExpiry,
      provenance: 'operatorClaim',
      reachability: {
        sessionId: REACHABILITY_SESSION,
        instanceId: REACHABILITY_INSTANCE,
      },
    });
  }
  return response(401, {
    diagnostic: {
      code: 'SNAPBACK_ADMIN_TOKEN_REQUIRED',
      message: 'console reachability credential was revoked',
    },
  });
};
const revokedReachability = new AdminClient('http://snapback.test/_snapback/api');
await revokedReachability.exchangeConsoleClaim(REACHABILITY_CLAIM);
await assert.rejects(() => revokedReachability.inspect());
assert.equal(
  sessionStorageRecords.has(reachabilityKey),
  false,
  'an observed authorization failure clears the tab-scoped reachability record',
);
assert.equal(storage.has('snapback_console_credential_v1'), false);

let refusedFragmentStripped = false;
fetchOverride = async () => response(401, {
  diagnostic: {
    code: 'SNAPBACK_ADMIN_CLAIM_INVALID',
    message: `claim ${CLAIM_CODE} is invalid`,
  },
});
const refusedClaim = await captureFailure(() => consumeConsoleCredentialFragment(
  new AdminClient('http://snapback.test/_snapback/api'),
  {
    hash: `#claim=${CLAIM_CODE}`,
    pathname: '/_snapback/admin/',
    search: '',
  },
  {
    replaceState() { refusedFragmentStripped = true; },
  },
));
assert.equal(refusedFragmentStripped, true);
assert.equal(refusedClaim.diagnostic.code, 'SNAPBACK_ADMIN_CLAIM_INVALID');
assertCredentialAbsent(refusedClaim, CLAIM_CODE, 'refused claim diagnostic');

let unstrippedClaimFetches = 0;
fetchOverride = async () => {
  unstrippedClaimFetches += 1;
  return response(500, {});
};
await assert.rejects(
  () => consumeConsoleCredentialFragment(
    new AdminClient('http://snapback.test/_snapback/api'),
    {
      hash: `#claim=${CLAIM_CODE}`,
      pathname: '/_snapback/admin/',
      search: '',
    },
    null,
  ),
  (error) => error.diagnostic?.code === 'SNAPBACK_RESPONSE_INVALID',
  'claim exchange fails closed when the fragment cannot be stripped',
);
assert.equal(unstrippedClaimFetches, 0, 'an unstripped claim is never sent');

const deviceRequests = [];
const DEVICE_CODE = 'sbcd_devicesecret';
const DEVICE_DERIVED = 'sbcc_device-approved';
let devicePolls = 0;
fetchOverride = async (url, options = {}) => {
  deviceRequests.push({ url, options });
  if (url.endsWith('/console/approval/request')) {
    return response(200, {
      deviceCode: DEVICE_CODE,
      userCode: 'ABCD-1234',
      verificationUri: 'http://127.0.0.1/_snapback/admin/',
      expiresIn: 600,
      interval: 2,
    });
  }
  if (url.endsWith('/console/approval/poll')) {
    devicePolls += 1;
    return devicePolls === 1
      ? response(200, { status: 'authorization_pending', interval: 2 })
      : response(200, {
          status: 'approved',
          credential: DEVICE_DERIVED,
          expiresAtMs: Date.now() + 60_000,
        });
  }
  return response(200, { ok: true });
};
const deviceClient = new AdminClient('http://snapback.test/_snapback/api');
const deviceRequest = await deviceClient.requestConsoleApproval();
assert.equal(deviceRequest.userCode, 'ABCD-1234');
assert.equal((await deviceClient.pollConsoleApproval(deviceRequest.deviceCode)).status, 'authorization_pending');
assert.equal((await deviceClient.pollConsoleApproval(deviceRequest.deviceCode)).status, 'approved');
assert.equal(
  JSON.parse(storage.get('snapback_console_credential_v1')).credential,
  DEVICE_DERIVED,
);
assert.equal(
  [...storage.entries(), ...storageWrites].some((entry) => JSON.stringify(entry).includes(DEVICE_CODE)),
  false,
  'the polling device bearer remains memory-only',
);

const NEAR_EXPIRY = 'sbcc_near-expiry';
storage.set('snapback_console_credential_v1', JSON.stringify({
  credential: NEAR_EXPIRY,
  expiresAtMs: Date.now() + 1_000,
}));
const renewalRequests = [];
fetchOverride = async (url, options = {}) => {
  renewalRequests.push({ url, options });
  if (url.endsWith('/console/credential')) {
    return response(200, {
      credential: NEAR_EXPIRY,
      expiresAtMs: Date.now() + 10 * 60_000,
    });
  }
  return response(200, { ok: true });
};
const renewalClient = new AdminClient('http://snapback.test/_snapback/api');
await renewalClient.inspect();
assert.equal(renewalRequests[0].url.endsWith('/console/credential'), true);
assert.equal(
  renewalRequests[0].options.headers['x-snapback-console-credential'],
  NEAR_EXPIRY,
);
assert.equal(renewalRequests[1].url.endsWith('/inspect'), true);
assert.equal(
  renewalRequests[1].options.headers['x-snapback-console-credential'],
  NEAR_EXPIRY,
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
    async json() {
      return body;
    },
  };
}

function guideResponse(body, contentHash, buildCommit) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name === 'x-snapback-guide-content-sha256') return contentHash;
        if (name === 'x-snapback-server-build-commit') return buildCommit;
        return null;
      },
    },
    async text() {
      return body;
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
