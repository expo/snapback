import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient, createExternalSessionClient } from '../snapback-client/index.mjs';
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
  // Match the generated single-table references used by starters. This
  // engages the ordinary optimistic-presentation view even when no mutation
  // is pending, which is where authority metadata must remain private.
  composition: Object.freeze({
    normalizedCompositePlan: Object.freeze({
      nodes: Object.freeze([
        Object.freeze({
          nodePlan: Object.freeze({
            normalizedPlan: Object.freeze({
              query: Object.freeze({ table: 'cells' }),
            }),
          }),
        }),
      ]),
    }),
  }),
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

const onlineRequests = [];
let rowlessWire = null;
const onlineFetch = async (url, init = {}) => {
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;
  onlineRequests.push({
    path,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  });
  if (path === '/auth/session') {
    return Response.json(parsedUrl.hostname === 'public-current-as-of.test'
      ? {
          ...handshake,
          authority: {
            kind: 'anonymous',
            userId: null,
            sessionId: null,
            isAuthenticated: false,
          },
          authorityDescriptor: {
            descriptorVersion: 1,
            authorityInstanceId: INCARNATION,
            sessionGeneration: 0,
          },
        }
      : handshake);
  }
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
    if (rowlessWire !== null) {
      const subscriptionId = `sub-cells-rowless-${rowlessWire.subscribeCalls + 1}`;
      rowlessWire.subscribeCalls += 1;
      setTimeout(() => rowlessWire.socket?.emit('message', {
        data: JSON.stringify({
          kind: 'current_as_of',
          subscription_id: subscriptionId,
          function: 'cells',
          version: 5,
          resume,
        }),
      }), 10);
      return Response.json({
        subscription_id: subscriptionId,
        facts: { activeGeneration: descriptorCellsReference.expectedGeneration },
      });
    }
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

// The real client/provider path inherits the library advertisement without
// per-app or provider wiring. Keep a socket open long enough for the provider
// to establish its managed live handle, then inspect the actual subscribe.
const originalWebSocket = globalThis.WebSocket;
class ProviderWireWebSocket {
  constructor() {
    this.listeners = new Map();
    this.readyState = 0;
    if (rowlessWire !== null) rowlessWire.socket = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add({ listener, once: options.once === true });
  }

  emit(type, event) {
    for (const entry of [...(this.listeners.get(type) ?? [])]) {
      if (entry.once) this.listeners.get(type).delete(entry);
      entry.listener(event);
    }
  }

  send() {}

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit('close', { code, reason }));
  }
}

globalThis.fetch = onlineFetch;
globalThis.WebSocket = ProviderWireWebSocket;
let wireClient = null;
let wireCoordinator = null;
let wireProvider = null;
let wireObserver = null;
try {
  onlineRequests.length = 0;
  rowlessWire = { socket: null, subscribeCalls: 0 };
  wireCoordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  wireClient = new SnapbackClient('http://public-current-as-of.test', {
    authCoordinator: wireCoordinator,
    authClientProtocol: 1,
    rqsStore: store,
  });
  const wireBinding = await wireClient.prepareReactBinding({ generatedManifest });
  wireProvider = createSnapbackReactProvider(wireBinding, { connectionId: 'provider-wire' });
  wireObserver = observeSnapbackQueries(
    wireProvider,
    { cells: { ref: wireBinding.references.cells, args: {} } },
    () => {},
  );
  await flush();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(
    wireObserver.snapshot().queries.cells.status,
    'ready',
    'the real provider live path establishes successfully',
  );
  assert.equal(
    wireObserver.snapshot().queries.cells.connection,
    'live',
    'a public CurrentAsOf answer admits the provider as live',
  );
  assert.deepEqual(
    wireProvider.registry.aggregateConnection(),
    { status: 'live', diagnostic: null, activeSubscriptions: 1 },
    'the accepted handle enters the provider connection aggregate',
  );
  assert.equal(rowlessWire.subscribeCalls, 1, 'CurrentAsOf does not trigger a resubscribe loop');
  const wireOpen = onlineRequests.find(({ path }) => path === '/connection/open');
  const wireSubscribe = onlineRequests.find(({ path }) => path === '/live/cells/subscribe');
  assert.equal(
    wireOpen?.body?.authInvalidationProtocol,
    1,
    'the provider inherits the client open-time invalidation advertisement',
  );
  assert.equal(
    wireSubscribe?.headers.get('x-snapback-auth-invalidation-protocol'),
    '1',
    'the provider live subscribe inherits the client invalidation header end to end',
  );
} finally {
  wireObserver?.dispose();
  await wireProvider?.dispose();
  await wireClient?.close();
  await wireCoordinator?.close();
  rowlessWire = null;
  globalThis.WebSocket = originalWebSocket;
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
