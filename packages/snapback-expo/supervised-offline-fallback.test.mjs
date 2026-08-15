import assert from 'node:assert/strict';

import { createMemoryRqsResumeStore } from '../snapback-client/rqs-store-memory.mjs';

import { createSnapbackExpoBoot } from './provider.mjs';
import {
  SUPERVISED_EXCHANGE_FORMAT,
  createSupervisedExpoEnvironment,
} from './supervised-environment.mjs';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const TOKEN = 'sbs_supervised_offline_warm_token';
const APP_ID = 'supervised-offline-fallback';
const ORIGIN = 'http://127.0.0.1:4317';
const EXCHANGE_ORIGIN = 'http://127.0.0.1:4321';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';

const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: APP_ID,
  bundleHash: 'sha256:supervised-offline-functions',
  functions: Object.freeze([]),
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: 'local-dev-sqlite-ibex',
  supportedCapabilities: Object.freeze([]),
});
const app = Object.freeze({
  format: 'snapback.app.v1',
  authoringProfile: 'snapback-explicit-v1',
  identity: Object.freeze({
    app: APP_ID,
    schema: 'sha256:supervised-offline-schema',
    functions: functions.bundleHash,
    descriptor: 'sha256:supervised-offline-descriptor',
  }),
  api: Object.freeze({
    queries: Object.freeze({}),
    mutations: Object.freeze({}),
    assets: Object.freeze({}),
    ephemeral: Object.freeze({}),
    queryGroups: Object.freeze({}),
  }),
  commands: Object.freeze({}),
  surfaces: Object.freeze({}),
  capabilities: Object.freeze({ required: Object.freeze([]) }),
});
const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: ORIGIN,
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze([]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'supervised-offline-generation',
    issuedAt: '2026-08-07T11:00:00.000Z',
    expiresAt: '2026-08-07T13:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});
const handshake = Object.freeze({
  protocolVersion: 1,
  serverStartupNonce: 'startup-supervised-offline',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: Object.freeze({
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  }),
  availability: Object.freeze({
    onlineRequestResponse: Object.freeze({ available: true, reason: null }),
    authScopedLive: Object.freeze({
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    }),
    retainedReads: Object.freeze({
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    }),
    queuedReplay: Object.freeze({
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    }),
  }),
  provider: Object.freeze({ key: 'email-code', available: true }),
  transports: Object.freeze(['bearer']),
  authority: Object.freeze({
    kind: 'humanSession',
    userId: '018f0d90-7b12-7a22-8c33-445566778899',
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
    isAuthenticated: true,
  }),
  authorityDescriptor: Object.freeze({
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  }),
  deploymentIdentity: Object.freeze({
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: APP_ID,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  }),
  authorizedLease: null,
});

function appStateHarness() {
  return Object.freeze({
    currentState: 'active',
    addEventListener() { return Object.freeze({ remove() {} }); },
  });
}

function providerHarness(capture) {
  return (prepared) => {
    capture.prepared = prepared;
    return Object.freeze({
      async pause() {},
      async resume() {},
      async dispose() {},
      inspection: () => Object.freeze({ hostPaused: false }),
    });
  };
}

function lifecycleHarness() {
  return Object.freeze({ dispose() {}, settled: async () => {} });
}

function memoryBindingCache(initial = null) {
  let record = initial === null ? null : structuredClone(initial);
  const saves = [];
  return Object.freeze({
    saves,
    current: () => record === null ? null : structuredClone(record),
    async load() { return record === null ? null : structuredClone(record); },
    async save(value) {
      record = structuredClone(value);
      saves.push(structuredClone(value));
    },
    async clear() { record = null; },
  });
}

function exchangeResponse() {
  return Response.json({
    format: SUPERVISED_EXCHANGE_FORMAT,
    correlationId: 'supervised-offline-correlation',
    binding,
    authority: Object.freeze({
      status: 'ready',
      tokenType: 'Bearer',
      token: TOKEN,
    }),
  });
}

const onlineFetch = async (url) => {
  const path = new URL(url).pathname;
  if (path === '/auth/session') return Response.json(handshake);
  if (path === '/inspect') {
    return Response.json({
      targetProfileId: capabilityManifest.targetProfileId,
      target: capabilityManifest.targetProfileId,
      functions,
      schema: { schemaHash: app.identity.schema, ephemeralCollections: [] },
      capabilityManifest,
      routeManifestHash: null,
    });
  }
  throw new Error(`unexpected supervised-offline online request: ${path}`);
};

const sharedStore = createMemoryRqsResumeStore();
const bindingCache = memoryBindingCache();
const exchangeCounts = { attempts: 0, successes: 0 };
const warmCapture = {};
const originalFetch = globalThis.fetch;
let warmBoot;

// WARM: a successful supervised exchange persists only public binding and
// authority facts, while the real client persists its digest-bound receipt.
globalThis.fetch = onlineFetch;
try {
  const environment = createSupervisedExpoEnvironment({
    exchangeOrigin: EXCHANGE_ORIGIN,
    appState: appStateHarness(),
    bindingCache,
    clientOptions: { rqsStore: sharedStore },
    async fetch() {
      exchangeCounts.attempts += 1;
      exchangeCounts.successes += 1;
      return exchangeResponse();
    },
  });
  warmBoot = createSnapbackExpoBoot({
    app,
    environment,
    now: () => NOW,
    createProvider: providerHarness(warmCapture),
    bindLifecycle: lifecycleHarness,
  });
  const state = await warmBoot.start();
  assert.equal(state.status, 'ready');
  assert.equal(state.preparation.source, 'deployment');
  assert.equal(warmCapture.prepared.source, 'deployment');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bindingCache.saves.length, 1);
  const saved = bindingCache.current();
  assert.deepEqual(saved.binding, binding);
  assert.equal(saved.publicFacts.kind, 'session');
  assert.equal(saved.publicFacts.authMode, 'sessions');
  assert.equal(JSON.stringify(saved).includes(TOKEN), false);
  assert.notEqual(
    await sharedStore.loadReactBindingReceipt(),
    null,
    'warm preparation persists the React binding receipt in the shared store',
  );
  const refreshed = await warmBoot.refreshAuthority();
  assert.equal(refreshed.status, 'ready');
  assert.equal(refreshed.preparation.source, 'deployment');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(bindingCache.saves.length, 2, 'successful authority refresh updates the cache');
  assert.equal(JSON.stringify(bindingCache.current()).includes(TOKEN), false);
} finally {
  globalThis.fetch = originalFetch;
}

// COLD: only bootstrap-unavailable may use the cached supervised binding;
// tokenless preparation then proves the existing client receipt path.
const coldCapture = {};
let coldBoot;
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const attemptsBefore = exchangeCounts.attempts;
  const successesBefore = exchangeCounts.successes;
  const environment = createSupervisedExpoEnvironment({
    exchangeOrigin: EXCHANGE_ORIGIN,
    appState: appStateHarness(),
    bindingCache,
    clientOptions: { rqsStore: sharedStore },
    async fetch() {
      exchangeCounts.attempts += 1;
      throw new TypeError('fetch failed');
    },
  });
  coldBoot = createSnapbackExpoBoot({
    app,
    environment,
    now: () => NOW,
    createProvider: providerHarness(coldCapture),
    bindLifecycle: lifecycleHarness,
  });
  const state = await coldBoot.start();
  assert.equal(state.status, 'ready');
  assert.equal(state.preparation.source, 'persisted-receipt');
  assert.equal(coldCapture.prepared.source, 'persisted-receipt');
  assert.deepEqual(state.authority, bindingCache.current().publicFacts);
  assert.equal(exchangeCounts.attempts, attemptsBefore + 1);
  assert.equal(exchangeCounts.successes, successesBefore, 'the cold exchange never succeeded');
  assert.equal(bindingCache.saves.length, 2, 'offline adoption learns no new cache record');
} finally {
  globalThis.fetch = originalFetch;
}

// Empty cache: preserve the original supervised bootstrap refusal.
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const environment = createSupervisedExpoEnvironment({
    exchangeOrigin: EXCHANGE_ORIGIN,
    appState: appStateHarness(),
    bindingCache: memoryBindingCache(),
    clientOptions: { rqsStore: sharedStore },
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  const boot = createSnapbackExpoBoot({ app, environment, now: () => NOW });
  const state = await boot.start();
  assert.equal(state.status, 'error');
  assert.equal(state.diagnostic.code, 'SNAPBACK_EXPO_BOOTSTRAP_UNAVAILABLE');
} finally {
  globalThis.fetch = originalFetch;
}

// Expired cache: resolve the cached value, then let ordinary AppBinding
// admission keep the strict restart-required expiry diagnostic.
const expiredRecord = bindingCache.current();
expiredRecord.binding.provenance = {
  ...expiredRecord.binding.provenance,
  issuedAt: '2026-08-07T10:00:00.000Z',
  expiresAt: '2026-08-07T11:00:00.000Z',
};
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const environment = createSupervisedExpoEnvironment({
    exchangeOrigin: EXCHANGE_ORIGIN,
    appState: appStateHarness(),
    bindingCache: memoryBindingCache(expiredRecord),
    clientOptions: { rqsStore: sharedStore },
    fetch: async () => { throw new TypeError('fetch failed'); },
  });
  const boot = createSnapbackExpoBoot({ app, environment, now: () => NOW });
  const state = await boot.start();
  assert.equal(state.status, 'error');
  assert.equal(state.diagnostic.code, 'SNAPBACK_APP_BINDING_EXPIRED');
} finally {
  globalThis.fetch = originalFetch;
}

await coldBoot.dispose();
await warmBoot.dispose();

console.log('supervised-offline-fallback.test.mjs: warm receipt and honest cold fallback/refusals pass');
