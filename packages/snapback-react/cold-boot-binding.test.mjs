import assert from 'node:assert/strict';

import { createExternalSessionClient } from '../snapback-client/index.mjs';
import { createMemoryRqsResumeStore } from '../snapback-client/rqs-store-memory.mjs';
import { rqsEntryKey } from '../snapback-client/rqs-store.mjs';
import { argsHash, digestOfRows } from '../snapback-client/rqs.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackQueries,
  observeSnapbackSurface,
} from './index.mjs';

// Regression: issues/20260801-0137-reverify-react-cold-boot-binding-requires-server.md
// — prepareReactBinding awaited Promise.all([inspect, authSession]) against
// the server, so a genuinely cold process with the backend unreachable threw
// `fetch failed` before a provider existed, making the A1-05 offline
// cold-boot floor unreachable for an external consumer. This test uses the
// REAL client over a scripted wire (the fake-client shortcut in
// offline.test.mjs is exactly how the gap survived to the packaged closure):
// session 1 prepares online (persisting the digest-bound binding receipt)
// and warms the store with a retained-eligible entry; session 2 is a cold
// client over the same durable backing with the server unreachable, and must
// reach a ready provider rendering retained rows from useSnapbackQuery's
// own snapshot path.

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const BEARER = 'sbs_cold_boot_owner';
const APP_ID = '018f0d90-7b14-7a22-8c33-445566778899';
const PROFILE = 'local-dev-sqlite-ibex';
const DESCRIPTOR_SCHEMA_HASH = 'sha256:cold-boot-schema';
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
  bundleHash: 'sha256:cold-boot-bundle',
  functions: [cellsDefinition],
});
const capabilityManifest = Object.freeze({
  artifactKind: 'capabilityManifest',
  schemaVersion: 'snapback.v0',
  targetProfileId: PROFILE,
  supportedCapabilities: ['live_subscriptions'],
});
const generatedManifest = Object.freeze({ functions, capabilityManifest });
const descriptorCellsReference = Object.freeze({
  ...cellsDefinition,
  expectedGeneration: Object.freeze({
    schemaVersion: 'snapback.v0',
    appId: APP_ID,
    schemaHash: DESCRIPTOR_SCHEMA_HASH,
    bundleHash: functions.bundleHash,
    inputsHash: 'sha256:cold-boot-inputs',
  }),
});
const descriptorApp = Object.freeze({
  format: 'snapback.app.v1',
  identity: Object.freeze({
    app: APP_ID,
    schema: DESCRIPTOR_SCHEMA_HASH,
    functions: functions.bundleHash,
    descriptor: 'sha256:cold-boot-descriptor',
  }),
  api: Object.freeze({
    queries: Object.freeze({ cells: descriptorCellsReference }),
    mutations: Object.freeze({}),
    assets: Object.freeze({}),
    ephemeral: Object.freeze({}),
    queryGroups: Object.freeze({}),
  }),
  commands: Object.freeze({}),
  surfaces: Object.freeze({
    cells: Object.freeze({
      artifactKind: 'surfaceDescriptor',
      appId: APP_ID,
      id: `${APP_ID}:surface:cells`,
      name: 'cells',
      params: Object.freeze({}),
      reads: Object.freeze({
        cells: Object.freeze({
          artifactKind: 'surfaceMemberBinding',
          reference: descriptorCellsReference,
          inputs: Object.freeze({}),
          bindings: Object.freeze({}),
        }),
      }),
      mutations: Object.freeze({}),
      commands: Object.freeze({}),
      assets: Object.freeze({}),
      presence: Object.freeze({}),
    }),
  }),
  capabilities: Object.freeze({ required: Object.freeze([]) }),
});

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-cold-boot-binding',
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
      schema: { schemaHash: DESCRIPTOR_SCHEMA_HASH, ephemeralCollections: [] },
      capabilityManifest,
    });
  }
  if (path === '/connection/open') {
    return Response.json({
      connectionId: 'wire-cold-boot',
      connectionToken: 'sct-cold-boot',
      authorizationInvalidation: null,
      wireVersion: 'snapback.v1',
    });
  }
  if (path === '/live/cells/subscribe') {
    return Response.json({
      subscription_id: 'sub-cells-1',
      snapshot: { version: 5, rows: ROWS },
      resume,
      permission_epochs: {},
    });
  }
  if (path === '/live/cells/unsubscribe') {
    const body = JSON.parse(init.body);
    return Response.json({ subscription_id: body.subscription_id, disposed: true });
  }
  throw new Error(`unexpected cold-boot online request: ${path}`);
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const originalFetch = globalThis.fetch;
const store = createMemoryRqsResumeStore();

// --- Session 1: online — prepare the binding (persists the receipt) and
// --- warm the store with a retained-eligible entry.
globalThis.fetch = onlineFetch;
try {
  const client = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: store,
  });
  const binding = await client.prepareReactBinding({ generatedManifest });
  assert.equal(binding.appId, APP_ID);
  assert.equal(binding.source, 'deployment', 'online preparation is deployment-admitted');
  const handle = await client.liveQuery('cells', {
    connectionId: 'warm',
    transport: 'poll',
    pollCadenceMs: 60_000,
  });
  assert.equal(handle.freshness, 'current');
  await handle.flushResumeState();
  handle.dispose();
  const persisted = await store.load(rqsEntryKey('cells', {}));
  assert.notEqual(persisted, null, 'session 1 persisted the resume entry');
} finally {
  globalThis.fetch = originalFetch;
}

// --- Session 2: cold process, server unreachable — binding must prepare
// --- from the persisted receipt and render retained rows through the
// --- provider's own snapshot path.
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const cold = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: store,
  });
  const binding = await cold.prepareReactBinding({ generatedManifest });
  assert.equal(binding.source, 'persisted-receipt', 'offline preparation names its provenance');
  assert.equal(binding.appId, APP_ID);
  assert.equal(binding.authMode, 'sessions', 'authMode carries from the receipt');
  assert.equal(
    binding.deploymentIdentity.bundleHash,
    functions.bundleHash,
    'deployment identity carries from the receipt',
  );

  const provider = createSnapbackReactProvider(binding, { connectionId: 'cold' });
  const observer = observeSnapbackQueries(
    provider,
    { cells: { ref: binding.references.cells, args: {} } },
    () => {},
  );
  await flush();
  await flush();
  const state = observer.snapshot().queries.cells;
  assert.deepEqual(state.data, ROWS, 'retained rows render offline from the cold store');
  assert.equal(state.freshness, 'retained', 'rows are labeled retained, never current');
  assert.equal(state.status, 'refreshing', 'retained rows are never presented as settled');
  assert.equal(state.connection, 'stale', 'cold retained rows keep the offline transport fact');

  observer.dispose();
  await provider.dispose();
  await flush();
} finally {
  globalThis.fetch = originalFetch;
}

// --- The generated AppDescriptor path uses the same receipt/store owner.
// --- Its portable document omits server interiors, so the receipt carries a
// --- compact admitted projection instead of copying the descriptor or
// --- creating a surface-specific cold cache.
const descriptorStore = createMemoryRqsResumeStore();
globalThis.fetch = onlineFetch;
try {
  const client = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: descriptorStore,
  });
  const binding = await client.prepareReactBinding({ generatedManifest: descriptorApp });
  assert.equal(binding.source, 'deployment');
  const handle = await client.liveQuery('cells', {
    connectionId: 'descriptor-warm',
    transport: 'poll',
    pollCadenceMs: 60_000,
  });
  await handle.flushResumeState();
  handle.dispose();
  const receipt = await descriptorStore.loadReactBindingReceipt();
  assert.equal(receipt?.descriptorAdmission?.descriptorIdentity, descriptorApp.identity.descriptor);
  assert.equal(receipt?.descriptorAdmission?.functions?.length, 1);
} finally {
  globalThis.fetch = originalFetch;
}

globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const cold = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: descriptorStore,
  });
  const binding = await cold.prepareReactBinding({ generatedManifest: descriptorApp });
  assert.equal(binding.source, 'persisted-receipt');
  const provider = createSnapbackReactProvider(binding, { connectionId: 'descriptor-cold' });
  const surface = observeSnapbackSurface(
    provider,
    descriptorApp.surfaces.cells,
    {},
    { presence: {} },
    () => {},
  );
  await flush();
  await flush();
  const snapshot = surface.snapshot();
  assert.deepEqual(snapshot.data.cells, ROWS, 'descriptor surface renders the retained rows');
  assert.strictEqual(snapshot.data.cells, snapshot.state.cells.data);
  assert.equal(snapshot.state.cells.freshness, 'retained');
  assert.equal(snapshot.state.cells.status, 'refreshing');
  assert.equal(snapshot.state.cells.connection, 'stale');
  await surface.dispose();
  await provider.dispose();
  await flush();
} finally {
  globalThis.fetch = originalFetch;
}

// --- A server-ANSWERED failure never falls back to the receipt: the
// --- deployment's refusal stays loud.
globalThis.fetch = async () => Response.json(
  { diagnostic: { code: 'SNAPBACK_HTTP_ERROR', message: 'boom' } },
  { status: 500 },
);
try {
  const refused = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: store,
  });
  await assert.rejects(
    () => refused.prepareReactBinding({ generatedManifest }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_HTTP_ERROR'
      || /SNAPBACK_HTTP_ERROR|HTTP_500/u.test(String(error?.message)),
    'a server-answered failure is never masked by the offline receipt',
  );
} finally {
  globalThis.fetch = originalFetch;
}

// --- A drifted generated manifest never adopts the receipt: the digest
// --- binding is the admission, and the existing typed binding-mismatch
// --- refusal remains visible instead of leaking a raw transport TypeError.
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
try {
  const drifted = createExternalSessionClient('http://cold-boot-binding.test', {
    bearerToken: BEARER,
    rqsStore: store,
  });
  await assert.rejects(
    () => drifted.prepareReactBinding({
      generatedManifest: {
        functions: { ...functions, bundleHash: 'sha256:drifted-bundle' },
        capabilityManifest,
      },
    }),
    (error) => error?.code === 'SNAPBACK_REACT_BINDING_MISMATCH'
      && error.diagnostic?.details?.expectedBundleHash === 'sha256:drifted-bundle'
      && error.diagnostic?.details?.actualBundleHash === functions.bundleHash,
    'a generated manifest the receipt never admitted keeps the typed binding mismatch',
  );
} finally {
  globalThis.fetch = originalFetch;
}

// --- With no admitted receipt, binding preparation retains the attempted
// --- origin and phase instead of leaking the browser's bare `Failed to fetch`.
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
try {
  const attemptedOrigin = 'http://127.0.0.1:4291';
  const unreachable = createExternalSessionClient(attemptedOrigin, {
    bearerToken: BEARER,
    rqsStore: createMemoryRqsResumeStore(),
  });
  await assert.rejects(
    () => unreachable.prepareReactBinding({ generatedManifest }),
    (error) => error?.code === 'SNAPBACK_REACT_BINDING_ORIGIN_UNREACHABLE'
      && error.diagnostic?.code === 'SNAPBACK_REACT_BINDING_ORIGIN_UNREACHABLE'
      && error.diagnostic?.details?.origin === attemptedOrigin
      && error.diagnostic?.details?.attemptedOrigin === attemptedOrigin
      && error.diagnostic?.details?.phase === 'application-binding-preparation'
      && error.cause?.fetchDispatchFailed === true,
    'an unreachable explicit origin reports the attempted target and binding-preparation phase',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('snapback-react cold-boot binding tests: ok');
