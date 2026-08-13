import assert from 'node:assert/strict';

import { IDBFactory } from 'fake-indexeddb';

import { createExternalSessionClient } from '../snapback-client/index.mjs';
import {
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
} from '../snapback-client/rqs-store.mjs';
import { argsHash, digestOfRows } from '../snapback-client/rqs.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackQueries,
} from './index.mjs';

// Regression: issues/20260804-guide-gap-react-expo-offline-cold-boot.md.
// The real-Chrome witness in demos/warble remains the manual reproduction;
// this is the CI-runnable Node simulation over fake-indexeddb. It uses the
// real client over a scripted wire and a Web Locks double mirroring the one in
// ../snapback-client/rqs-store.test.mjs. Session 1 gates the first lock grant
// until online binding preparation has tried to persist its receipt. Session 2
// is a fresh browser client over the same IndexedDB backing with the server
// unreachable and must prepare from that receipt and render retained rows.

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const BEARER = 'sbs_cold_boot_indexeddb_owner';
const APP_ID = '018f0d90-7b14-7a22-8c33-445566778899';
const PROFILE = 'local-dev-sqlite-ibex';
const ROWS = [{ _id: 'cell-1', title: 'first' }, { _id: 'cell-2', title: 'second' }];

const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: '_id', required: true, value: { kind: 'string', maxBytes: 64 } },
      { name: 'title', required: true, value: { kind: 'string', maxBytes: 64 } },
    ],
    allowExtra: false,
  },
};
const cellsDefinition = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: APP_ID,
  id: `${APP_ID}:cells`,
  name: 'cells',
  kind: 'LiveQuery',
  implementationHash: 'sha256:cells-implementation',
  argsContractHash: 'sha256:cells-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
  authorityIndependent: true,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: APP_ID,
  bundleHash: 'sha256:cold-boot-indexeddb-bundle',
  functions: [cellsDefinition],
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: PROFILE,
  supportedCapabilities: ['live_subscriptions'],
});
const generatedManifest = Object.freeze({ functions, capabilityManifest });

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-cold-boot-binding-indexeddb',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: {
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: {
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId: '018f0d90-7b12-7a22-8c33-445566778899',
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: APP_ID,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  },
  authorizedLease: null,
};

const resume = Object.freeze({
  token: `sbrt1.sbrq_test.${Buffer.from(JSON.stringify({ version: 5, versionStream: 'stream-1' })).toString('base64url')}.${'m'.repeat(43)}`,
  meta: {
    app: APP_ID,
    version: 5,
    contentDigest: digestOfRows('mset1', ROWS),
    generation: 'gen1:aaaa',
    versionStream: 'stream-1',
    queryArtifact: `sha256:${'2'.repeat(64)}`,
    argsHash: argsHash({}),
  },
});

const onlineFetch = async (url, init = {}) => {
  const path = new URL(url).pathname;
  if (path === '/auth/session') return Response.json(handshake);
  if (path === '/inspect') {
    return Response.json({
      targetProfileId: PROFILE,
      target: PROFILE,
      functions,
      schema: null,
      capabilityManifest,
    });
  }
  if (path === '/connection/open') {
    return Response.json({
      connectionId: 'wire-cold-boot-indexeddb',
      connectionToken: 'sct-cold-boot-indexeddb',
      authorizationInvalidation: null,
      wireVersion: 'snapback.v1',
    });
  }
  if (path === '/live/cells/subscribe') {
    return Response.json({
      subscription_id: 'sub-cells-indexeddb-1',
      snapshot: { version: 5, rows: ROWS },
      resume,
      permission_epochs: {},
    });
  }
  if (path === '/live/cells/unsubscribe') {
    const body = JSON.parse(init.body);
    return Response.json({ subscription_id: body.subscription_id, disposed: true });
  }
  throw new Error(`unexpected cold-boot IndexedDB online request: ${path}`);
};

// Minimal Web Locks double: per-name exclusive FIFO with AbortSignal support,
// plus an optional gate before the first grant callback runs.
function createLockManagerDouble({ gateFirstGrant = false } = {}) {
  const states = new Map();
  let firstGrant = true;
  let releaseGate = null;
  const firstGrantGate = gateFirstGrant
    ? new Promise((resolve) => { releaseGate = resolve; })
    : null;
  const stateFor = (name) => {
    let state = states.get(name);
    if (!state) {
      state = { held: false, queue: [] };
      states.set(name, state);
    }
    return state;
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (next.aborted) continue;
      state.held = true;
      const gate = firstGrant ? firstGrantGate : null;
      firstGrant = false;
      Promise.resolve(gate)
        .then(() => next.callback({ name, mode: 'exclusive' }))
        .then(next.resolve, next.reject)
        .finally(() => {
          state.held = false;
          pump(name);
        });
      return;
    }
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject, aborted: false };
        const signal = options?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            entry.aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
        state.queue.push(entry);
        pump(name);
      });
    },
    releaseFirstGrant() {
      releaseGate?.();
      releaseGate = null;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const pollBindingReceipt = async (store) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const receipt = await store.loadReactBindingReceipt();
    if (receipt !== null) return receipt;
    await tick();
  }
  return null;
};

const originalFetch = globalThis.fetch;
const indexedDB = new IDBFactory();
const gatedLocks = createLockManagerDouble({ gateFirstGrant: true });
const warmStore = createIndexedDbRqsResumeStore({ indexedDB, lockManager: gatedLocks });
let flushedReceipt = null;

// --- Session 1: online preparation commits before the writer election, then
// --- the grant flushes the deferred receipt and the live query warms rows.
globalThis.fetch = onlineFetch;
try {
  const client = createExternalSessionClient('http://cold-boot-binding-indexeddb.test', {
    bearerToken: BEARER,
    rqsStore: warmStore,
  });
  const binding = await client.prepareReactBinding({ generatedManifest });
  assert.equal(binding.appId, APP_ID);
  assert.equal(binding.source, 'deployment', 'online preparation is deployment-admitted');
  assert.equal(warmStore.isWriter(), false, 'receipt commit ran before writer election settled');

  gatedLocks.releaseFirstGrant();
  flushedReceipt = await pollBindingReceipt(warmStore);

  const handle = await client.liveQuery('cells', {
    connectionId: 'warm-indexeddb',
    transport: 'poll',
    pollCadenceMs: 60_000,
  });
  assert.equal(handle.freshness, 'current');
  await handle.flushResumeState();
  handle.dispose();
  const persisted = await warmStore.load(rqsEntryKey('cells', {}));
  assert.notEqual(persisted, null, 'session 1 persisted the resume entry');
} finally {
  globalThis.fetch = originalFetch;
  await warmStore.close();
}

// --- Session 2: fresh browser session, server unreachable — preparation
// --- adopts the receipt and the provider renders the retained rows.
const coldStore = createIndexedDbRqsResumeStore({
  indexedDB,
  lockManager: createLockManagerDouble(),
});
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const cold = createExternalSessionClient('http://cold-boot-binding-indexeddb.test', {
    bearerToken: BEARER,
    rqsStore: coldStore,
  });
  const binding = await cold.prepareReactBinding({ generatedManifest });
  assert.notEqual(flushedReceipt, null, 'the deferred receipt landed after writer election');
  assert.equal(binding.source, 'persisted-receipt', 'offline preparation names its provenance');

  const provider = createSnapbackReactProvider(binding, { connectionId: 'cold-indexeddb' });
  const observer = observeSnapbackQueries(
    provider,
    { cells: { ref: binding.references.cells, args: {} } },
    () => {},
  );
  await flush();
  await flush();
  const state = observer.snapshot().queries.cells;
  assert.deepEqual(state.data, ROWS, 'retained rows render offline from IndexedDB');
  assert.equal(state.freshness, 'retained', 'rows are labeled retained, never current');
  assert.equal(state.status, 'refreshing', 'retained rows are never presented as settled');

  observer.dispose();
  await provider.dispose();
  await flush();
} finally {
  globalThis.fetch = originalFetch;
  await coldStore.close();
}

console.log('snapback-react IndexedDB cold-boot binding tests: ok');
