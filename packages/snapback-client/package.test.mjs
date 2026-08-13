import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SEARCH_REQUEST_ARGS_CONTRACT_HASH } from './search-contract.generated.mjs';

import {
  AgentAuthorityFence,
  SnapbackClient,
  admitSnapbackId,
  bindSnapbackAppLifecycle,
  createExternalSessionClient,
  createMemoryAgentAuthorityCustodyStorage,
  newSeedOperationIdV1,
} from './index.mjs';
import {
  SnapbackClient as OnlineSnapbackClient,
  bindSnapbackAppLifecycle as bindOnlineSnapbackAppLifecycle,
} from './online.mjs';

const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const packageFiles = new Set(packageManifest.files);
const exportedTargets = Object.values(packageManifest.exports)
  .flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
  .filter((target) => target !== './package.json')
  .map((target) => target.replace(/^\.\//, ''));
for (const target of exportedTargets) {
  assert.ok(packageFiles.has(target), `package files must include exported target ${target}`);
}

assert.equal(typeof SnapbackClient, 'function');
assert.equal(admitSnapbackId('todos', 'todo_01'), 'todo_01');
assert.equal(
  admitSnapbackId('todos', '01983c8d-9f87-7ec1-bc02-7e81290debc0'),
  '01983c8d-9f87-7ec1-bc02-7e81290debc0',
);
assert.throws(
  () => admitSnapbackId('../todos', 'todo_01'),
  /SNAPBACK_CLIENT_ID_TABLE_INVALID/u,
);
assert.throws(
  () => admitSnapbackId('todos', 'bad id'),
  /SNAPBACK_CLIENT_ID_INVALID/u,
);
assert.throws(
  () => admitSnapbackId('todos', 'a'.repeat(257)),
  /SNAPBACK_CLIENT_ID_INVALID/u,
);
assert.equal(OnlineSnapbackClient, SnapbackClient);
assert.equal(typeof AgentAuthorityFence, 'function');
assert.equal(typeof createMemoryAgentAuthorityCustodyStorage, 'function');
assert.equal(typeof createExternalSessionClient, 'function');
assert.equal(bindOnlineSnapbackAppLifecycle, bindSnapbackAppLifecycle);
assert.match(newSeedOperationIdV1(1_722_000_000_000), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const client = new SnapbackClient('http://127.0.0.1:9');
const idleEphemeralUnsubscribe = await client.unsubscribeEphemeral(
  'idle-room',
  { connectionId: 'already-disconnected' },
);
assert.deepEqual(
  idleEphemeralUnsubscribe,
  { removed: false, skipped: 'socket-not-open' },
);
assert.equal(
  client.localResourceInspection(['already-disconnected']).managerCount,
  0,
  'ephemeral teardown after disconnect must not manufacture a manager',
);

const savedDecodeWebSocket = globalThis.WebSocket;
const decodeSockets = [];
class DecodeFailureWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    decodeSockets.push(this);
    queueMicrotask(() => this.emit('open', {}));
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
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.emit('close', { code, reason }));
  }
}
globalThis.WebSocket = DecodeFailureWebSocket;
try {
  const decodeClient = new SnapbackClient('http://snapback.test');
  decodeClient.authSession = async () => null;
  decodeClient.connectionGrant = async () => ({ id: 'decode', token: 'decode' });
  decodeClient.liveStreamProtocolsFor = async () => [];
  const decodeManager = decodeClient.liveStreamManager('decode-failure', {
    reconnectBaseDelayMs: 60_000,
    reconnectMaxDelayMs: 60_000,
  });
  const decodeStates = [];
  decodeManager.onState((state) => decodeStates.push(state));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(decodeManager.inspection().open, true);
  decodeSockets[0].emit('message', { data: '{"kind":' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(decodeManager.inspection().open, false);
  assert.equal(decodeManager.inspection().reconnectTimer, 1);
  assert.ok(decodeStates.includes('lost'));
  decodeManager.close();
} finally {
  globalThis.WebSocket = savedDecodeWebSocket;
}

assert.equal(client.baseUrl, 'http://127.0.0.1:9');
assert.throws(
  () => new SnapbackClient('http://127.0.0.1:9', {
    agentAuthority: Object.create(AgentAuthorityFence.prototype),
  }),
  /agentAuthority must be an AgentAuthorityFence/,
);
const agentAuthority = new AgentAuthorityFence({
  actorUserId: '018f0f00-0000-7000-8000-000000000001',
  credentialId: '018f0f00-0000-7000-8000-000000000002',
  credentialGeneration: 0,
  grantId: '018f0f00-0000-7000-8000-000000000003',
  tokenId: '018f0f00-0000-7000-8000-000000000004',
  bearerToken: 'package-test-bearer',
});
const agentClient = new SnapbackClient('http://127.0.0.1:9', { agentAuthority });
assert.equal(agentClient.agentAuthority, agentAuthority);
const externalClient = createExternalSessionClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_external_package_test',
});
assert.equal(externalClient.bearerToken, 'sbs_external_package_test');
assert.deepEqual(externalClient.authProtocols, {
  authClient: 1,
  authInvalidation: 1,
  authorityDescriptor: 1,
  authorizedLease: null,
  ephemeralAuthority: null,
  ephemeralExpiry: 1,
});
assert.throws(
  () => createExternalSessionClient('http://127.0.0.1:9', { bearerToken: '' }),
  /non-empty bearerToken/,
);
assert.throws(
  () => new SnapbackClient('http://127.0.0.1:9', { authClientProtocol: 1 }),
  /explicit external-bearer, or anonymous-public custody/,
);
assert.throws(
  () => externalClient.setBearerToken('sbs_external_replacement'),
  /replaceBearerToken/u,
);
const externalTransitionEvents = [];
let settleExternalRelease;
let reentrantExternalReplacement;
const externalHandle = {
  paused: false,
  pause() {
    externalTransitionEvents.push('pause');
    reentrantExternalReplacement = externalClient.replaceBearerToken('sbs_reentrant_replacement');
    reentrantExternalReplacement.catch(() => {});
    return new Promise((resolve) => { settleExternalRelease = resolve; });
  },
  async resume() { externalTransitionEvents.push('resume'); },
};
const prePausedExternalHandle = {
  paused: true,
  pause() { assert.fail('a pre-paused handle must not be paused by bearer custody'); },
  resume() { assert.fail('a pre-paused handle must not resume during bearer custody'); },
};
externalClient.__externalBearerHandles.add(externalHandle);
externalClient.__externalBearerHandles.add(prePausedExternalHandle);
const unregisterExternalMaterialization = externalClient.registerAuthMaterialization({
  capture: () => null,
  blank: () => externalTransitionEvents.push('blank'),
});
externalClient.__connectionGrants.set('old', Promise.resolve({
  id: 'old',
  token: 'old',
}));
externalClient.__liveStreamManagers = new Map([['old', {
  close() { externalTransitionEvents.push('close'); },
}]]);
const externalReplacement = externalClient.replaceBearerToken('sbs_external_replacement');
await Promise.resolve();
assert.deepEqual(
  externalTransitionEvents,
  ['pause', 'blank', 'close'],
  'predecessor rows blank and transports cut before asynchronous unsubscribe settlement',
);
assert.equal(
  externalClient.bearerToken,
  'sbs_external_package_test',
  'successor bearer is not installed before predecessor release settles',
);
await assert.rejects(reentrantExternalReplacement, /cannot overlap/u);
await assert.rejects(
  () => externalClient.replaceBearerToken('sbs_overlapping_replacement'),
  /cannot overlap/u,
);
assert.throws(
  () => externalClient.__registerExternalBearerHandle({
    paused: false,
    pause() {},
    resume() {},
  }),
  /admission is closed/u,
  'a handle cannot join after the transition participant set was captured',
);

// Finite requests and direct auth/session discovery share the same admission
// cut as live handles. Neither may start with the predecessor bearer while the
// transition is waiting for exact T-UNSUB settlement.
const originalFetch = globalThis.fetch;
const externalBarrierFetches = [];
globalThis.fetch = async (url, init = {}) => {
  externalBarrierFetches.push({
    url: String(url),
    authorization: new Headers(init.headers).get('authorization'),
  });
  return new Response(JSON.stringify({
    diagnostic: {
      code: 'SNAPBACK_TEST_SUCCESSOR_PROBE',
      message: 'successor request reached the transport',
    },
  }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
};
const finiteDuringExternalTransition = externalClient.query('transitionProbe').catch(() => {});
const discoveryDuringExternalTransition =
  externalClient.authSession({ force: true }).catch(() => {});
let connectionGrantSettledDuringExternalTransition = false;
const grantDuringExternalTransition = externalClient.connectionGrant('old')
  .catch(() => {})
  .finally(() => { connectionGrantSettledDuringExternalTransition = true; });
await Promise.resolve();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(
  externalBarrierFetches,
  [],
  'finite and auth-session requests do not dispatch while predecessor release is held',
);
assert.equal(
  connectionGrantSettledDuringExternalTransition,
  false,
  'direct connection-grant discovery cannot expose predecessor custody during the cut',
);
settleExternalRelease();
await externalReplacement;
await Promise.all([
  finiteDuringExternalTransition,
  discoveryDuringExternalTransition,
  grantDuringExternalTransition,
]);
globalThis.fetch = originalFetch;
assert(
  externalBarrierFetches.length >= 1,
  'held requests dispatch after the successor lifecycle settles',
);
assert(
  externalBarrierFetches.every(
    ({ authorization }) => authorization === 'Bearer sbs_external_replacement',
  ),
  `held requests dispatch only with the successor bearer: ${JSON.stringify(externalBarrierFetches)}`,
);
assert.equal(externalClient.bearerToken, 'sbs_external_replacement');
assert.deepEqual(externalTransitionEvents, ['pause', 'blank', 'close', 'resume']);
assert.equal(externalClient.__connectionGrants.size, 0);
assert.equal(externalClient.__liveStreamManagers.size, 0);
externalClient.__externalBearerHandles.delete(externalHandle);
externalClient.__externalBearerHandles.delete(prePausedExternalHandle);
unregisterExternalMaterialization();

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  const generation = {
    schemaVersion: 'snapback.v1',
    appId: '018f0d90-7b14-7a22-8c33-445566778899',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  };
  const generatedRef = {
    artifactKind: 'functionReference',
    name: 'generationBound',
    expectedGeneration: generation,
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  };
  const generatedLiveRef = {
    ...generatedRef,
    kind: 'LiveQuery',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { requiredValue: { type: 'string' } },
      required: ['requiredValue'],
    },
  };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'generation-wire-connection',
        connectionToken: 'generation-wire-token',
        wireVersion: 'snapback.v1',
        authorizationInvalidation: null,
      });
    }
    requests.push({ path, body: JSON.parse(init.body) });
    if (path.endsWith('/subscribe')) {
      return Response.json({
        subscription_id: 'generation-wire-subscription',
        snapshot: { version: 1, rows: [] },
        permission_epochs: {},
      });
    }
    return Response.json({ version: 1, rows: [], result: null });
  };
  try {
    const generationClient = new SnapbackClient('http://generation.test');
    await generationClient.query(generatedRef);
    await generationClient.action(generatedRef);
    await generationClient.mutate(generatedRef, { queue: false });
    await generationClient.authorizedLeaseQuery(generatedRef, {
      leaseRequestId: 'lease-generation-test',
      authorizationNamespace: {
        clientStoreId: 'generation-store',
        queryKey: 'generationBound:{}',
        queryInstanceId: 1,
      },
    });
    await generationClient.subscribeLive(generatedRef, {
      connectionId: 'generation-client-connection',
    });
    const requestCountBeforeInvalidLiveQuery = requests.length;
    await assert.rejects(
      () => generationClient.liveQuery(generatedLiveRef, {
        connectionId: 'generation-invalid-live-query-connection',
        args: { forged: true },
        persistResume: false,
      }),
      (error) => {
        assert.equal(error.code, 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED');
        assert.equal(error.diagnostic.details.reason, 'unknown object property');
        assert.equal(error.diagnostic.details.path, 'args.forged');
        return true;
      },
    );
    assert.equal(
      requests.length,
      requestCountBeforeInvalidLiveQuery,
      'liveQuery validates a generated reference before network I/O',
    );
    const generatedLiveHandle = await generationClient.liveQuery(
      generatedLiveRef,
      {
        connectionId: 'generation-live-query-connection',
        args: { requiredValue: 'valid' },
        persistResume: false,
      },
    );
    generatedLiveHandle.dispose();
    await generatedLiveHandle.settled();
    const generatedCalls = requests.filter(({ path }) => !path.endsWith('/unsubscribe'));
    assert.deepEqual(
      generatedCalls.map(({ body }) => body.expectedGeneration),
      Array(6).fill(generation),
      'every generated call family, including liveQuery, carries the exact artifact generation',
    );
    const mutationCall = generatedCalls.find(({ path }) => path === '/mutation/generationBound');
    assert.equal(
      mutationCall.body.wireVersion,
      'snapback.v1',
      'finite mutations offer the version that makes build identity required at migration floors',
    );
    assert.throws(
      () => generationClient.query({
        ...generatedRef,
        expectedGeneration: { ...generation, bundleHash: '' },
      }),
      /complete generated artifact identity/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// Exercise the first-party handle path as well as the synthetic participant
// above: the old subscription must retire without deadlocking on its own
// transition barrier, then the fresh subscription must be established only
// after auth discovery has observed the successor bearer.
{
  const liveTransitionOriginalFetch = globalThis.fetch;
  const incarnation = '018f0d90-7b11-7a22-8c33-445566778899';
  const userId = '018f0d90-7b12-7a22-8c33-445566778899';
  const sessionId = '018f0d90-7b13-7a22-8c33-445566778899';
  const handshake = {
    protocolVersion: 1,
    serverStartupNonce: 'startup-live-bearer-transition',
    authorizationStreamIncarnation: incarnation,
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
      userId,
      sessionId,
      isAuthenticated: true,
    },
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: incarnation,
      sessionGeneration: 1,
    },
    deploymentIdentity: {
      schemaVersion: 'snapback.v1',
      authMode: 'sessions',
      appId: '018f0d90-7b14-7a22-8c33-445566778899',
      schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
      bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
      inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
    },
    authorizedLease: null,
  };
  let activeHandshakeBearer = null;
  let subscribeSequence = 0;
  let releasePredecessorUnsubscribe;
  let reportPredecessorUnsubscribe;
  const predecessorUnsubscribeStarted = new Promise((resolve) => {
    reportPredecessorUnsubscribe = resolve;
  });
  const liveTransitionRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const authorization = new Headers(init.headers).get('authorization');
    if (path === '/auth/session') {
      activeHandshakeBearer = authorization;
      liveTransitionRequests.push({ path, bearer: activeHandshakeBearer });
      return new Response(JSON.stringify(handshake), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/connection/open') {
      liveTransitionRequests.push({ path, bearer: activeHandshakeBearer });
      const generation = subscribeSequence + 1;
      return new Response(JSON.stringify({
        connectionId: `wire-live-transition-${generation}`,
        connectionToken: `sct-live-transition-${generation}`,
        authorizationInvalidation: null,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/live/transitionTodos/subscribe') {
      subscribeSequence += 1;
      const body = JSON.parse(init.body);
      liveTransitionRequests.push({ path, bearer: activeHandshakeBearer });
      return new Response(JSON.stringify({
        subscription_id: `sub-live-transition-${subscribeSequence}`,
        snapshot: {
          version: subscribeSequence,
          rows: [{ _id: activeHandshakeBearer }],
        },
        permission_epochs: {},
        ...(body.supersedes
          ? {
              supersessionRefusal:
                'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN',
            }
          : {}),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === '/live/transitionTodos/unsubscribe') {
      const body = JSON.parse(init.body);
      liveTransitionRequests.push({ path, bearer: activeHandshakeBearer });
      if (body.subscription_id === 'sub-live-transition-1') {
        reportPredecessorUnsubscribe();
        await new Promise((resolve) => { releasePredecessorUnsubscribe = resolve; });
      }
      return new Response(JSON.stringify({
        subscription_id: body.subscription_id,
        disposed: true,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected live transition request: ${path}`);
  };

  let liveTransitionHandle = null;
  try {
    const liveTransitionClient = createExternalSessionClient('http://live-transition.test', {
      bearerToken: 'sbs_live_predecessor',
    });
    liveTransitionHandle = await liveTransitionClient.liveQuery('transitionTodos', {
      connectionId: 'live-transition-label',
      pollCadenceMs: 60_000,
    });
    assert.deepEqual(liveTransitionHandle.rows, [{ _id: 'Bearer sbs_live_predecessor' }]);

    const liveReplacement =
      liveTransitionClient.replaceBearerToken('sbs_live_successor');
    await predecessorUnsubscribeStarted;
    assert.deepEqual(
      liveTransitionHandle.rows,
      [],
      'the live handle blanks while predecessor unsubscribe owns the custody cut',
    );
    assert.equal(liveTransitionClient.bearerToken, 'sbs_live_predecessor');
    assert.equal(
      liveTransitionRequests.some(({ bearer }) => bearer === 'Bearer sbs_live_successor'),
      false,
      'successor auth discovery cannot start before predecessor unsubscribe settles',
    );

    releasePredecessorUnsubscribe();
    await liveReplacement;
    assert.equal(liveTransitionClient.bearerToken, 'sbs_live_successor');
    assert.equal(liveTransitionHandle.paused, false);
    assert.deepEqual(liveTransitionHandle.rows, [{ _id: 'Bearer sbs_live_successor' }]);
    assert.deepEqual(
      liveTransitionRequests
        .filter(({ path }) => path === '/live/transitionTodos/subscribe')
        .map(({ bearer }) => bearer),
      ['Bearer sbs_live_predecessor', 'Bearer sbs_live_successor'],
      'fresh live subscribe is authorized only after successor discovery',
    );

    await liveTransitionHandle.pause();
    liveTransitionHandle.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    liveTransitionHandle = null;
  } finally {
    liveTransitionHandle?.dispose();
    globalThis.fetch = liveTransitionOriginalFetch;
  }
}

const appStateListeners = new Set();
const appState = {
  currentState: 'active',
  addEventListener(event, listener) {
    assert.equal(event, 'change');
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};
const lifecycleCalls = [];
const lifecycle = bindSnapbackAppLifecycle(appState, {
  pause() { lifecycleCalls.push('pause'); },
  async resume() { lifecycleCalls.push('resume'); },
});
for (const listener of appStateListeners) listener('background');
for (const listener of appStateListeners) listener('active');
await lifecycle.settled();
assert.deepEqual(lifecycleCalls, ['pause', 'resume']);
lifecycle.dispose();
assert.equal(appStateListeners.size, 0);

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      version: 7,
      rows: [{
        rowId: 'incident_1',
        score: 400,
        fields: { title: 'Cache miss' },
        highlights: [],
      }],
      cursor: 'search-cursor',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const searchClient = new SnapbackClient('http://snapback.test');
  const searchRef = {
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'demo',
    id: 'demo:searchIncidents',
    name: 'searchIncidents',
    kind: 'Query',
    implementationHash: `sha256:${'1'.repeat(64)}`,
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {},
        limit: { type: 'integer' },
        after: { type: 'string' },
      },
      required: ['query'],
    },
    // The generated pin (LLP 0131 identity cascade item 2): regenerated, not
    // hand-kept, and asserted against codegen by the search-pin conformance
    // test in @expo/snapback-codegen.
    argsContractHash: SEARCH_REQUEST_ARGS_CONTRACT_HASH,
    resultContractHash: `sha256:${'2'.repeat(64)}`,
    searchRequestContractHash: SEARCH_REQUEST_ARGS_CONTRACT_HASH,
    searchResourceArg: null,
  };
  const queryAst = { all: [{ Term: { value: 'cache' } }] };
  try {
    await assert.rejects(
      searchClient.search('searchIncidents', { query: queryAst }),
      (error) => error.code === 'SNAPBACK_SEARCH_REFERENCE_INVALID',
    );
    const {
      searchRequestContractHash: omittedSearchRequestContractHash,
      ...preWitnessSearchRef
    } = searchRef;
    assert.equal(omittedSearchRequestContractHash, SEARCH_REQUEST_ARGS_CONTRACT_HASH);
    await assert.rejects(
      searchClient.search(preWitnessSearchRef, { query: queryAst }),
      (error) => error.code === 'SNAPBACK_SEARCH_REFERENCE_INVALID'
        && /predates the request witness/u.test(error.message)
        && /regenerate the app references/u.test(error.message),
    );
    await assert.rejects(
      searchClient.search({
        ...searchRef,
        searchRequestContractHash: `sha256:${'3'.repeat(64)}`,
      }, {
        query: queryAst,
      }),
      (error) => error.code === 'SNAPBACK_SEARCH_REFERENCE_INVALID'
        && /contract generation/u.test(error.message)
        && error.diagnostic?.details?.carriedArgsContractHash === `sha256:${'3'.repeat(64)}`,
    );
    await assert.rejects(
      searchClient.search(searchRef, { query: queryAst, after: null }),
      /after cursor must be a string/u,
    );
    assert.equal(requests.length, 0, 'invalid search refs and after:null refuse before I/O');
    const page = await searchClient.search(searchRef, { query: queryAst });
    assert.deepEqual(page, {
      items: [{
        rowId: 'incident_1',
        score: 400,
        fields: { title: 'Cache miss' },
        highlights: [],
      }],
      cursor: 'search-cursor',
      hasMore: true,
    });
    assert.deepEqual(JSON.parse(requests[0].init.body).args, { query: queryAst });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      version: 8,
      rows: [{ rowId: 'document_1', distance: 0.25, fields: { title: 'Nearest' } }],
      cursor: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const vectorClient = new SnapbackClient('http://snapback.test');
  const vectorRef = {
    artifactKind: 'functionReference',
    schemaVersion: 'snapback.v0',
    appId: 'demo',
    id: 'demo:nearestDocuments',
    name: 'nearestDocuments',
    kind: 'Query',
    implementationHash: `sha256:${'4'.repeat(64)}`,
    argsContractHash: `sha256:${'5'.repeat(64)}`,
    resultContractHash: `sha256:${'6'.repeat(64)}`,
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vector: {
          type: 'array',
          items: { type: 'number', minimum: -(2 ** 100), maximum: 2 ** 100 },
          minItems: 3,
          maxItems: 3,
        },
        filters: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              field: { const: 'category' },
              op: { const: 'eq' },
              value: {
                anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
              },
            },
            required: ['field', 'op', 'value'],
          },
        },
      },
      required: ['vector'],
    },
  };
  try {
    await assert.rejects(
      vectorClient.vectorSearch(vectorRef, { vector: [1, 2] }),
      (error) => error.code === 'SNAPBACK_VECTOR_QUERY_INVALID' && /exactly 3/u.test(error.message),
    );
    await assert.rejects(
      vectorClient.vectorSearch(vectorRef, {
        vector: [1, 2, 3],
        filters: [{ field: 'category', op: 'eq', value: null }],
      }),
      (error) => error.code === 'SNAPBACK_VECTOR_QUERY_INVALID' && /closed scalar/u.test(error.message),
    );
    await assert.rejects(
      vectorClient.vectorSearch(vectorRef, {
        vector: [1, 2, 3],
        filters: [{ field: 'undeclared', op: 'eq', value: true }],
      }),
      (error) => error.code === 'SNAPBACK_VECTOR_QUERY_INVALID' && /declared equality field/u.test(error.message),
    );
    await assert.rejects(
      vectorClient.vectorSearch(vectorRef, {
        vector: [1, 2, 3],
        filters: [
          { field: 'category', op: 'eq', value: true },
          { field: 'category', op: 'eq', value: false },
        ],
      }),
      (error) => error.code === 'SNAPBACK_VECTOR_QUERY_INVALID' && /at most once/u.test(error.message),
    );
    assert.equal(requests.length, 0, 'invalid vector requests refuse before I/O');
    const page = await vectorClient.vectorSearch(vectorRef, {
      vector: [1, -0, 3],
      filters: [{ field: 'category', op: 'eq', value: true }],
    });
    assert.deepEqual(page, {
      items: [{ rowId: 'document_1', distance: 0.25, fields: { title: 'Nearest' } }],
    });
    assert.equal(Object.hasOwn(page, 'cursor'), false);
    assert.equal(Object.hasOwn(page, 'hasMore'), false);
    assert.deepEqual(JSON.parse(requests[0].init.body).args, {
      vector: [1, 0, 3],
      filters: [{ field: 'category', op: 'eq', value: true }],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      intent: 'provision',
      schema: 'provisioned',
      functions: 'provisioned',
      seed: 'skipped-absent',
      profile: 'dev',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provisioningClient = new SnapbackClient('http://snapback.test', {
      adminToken: 'ensure-admin',
    });
    const outcome = await provisioningClient.ensureApp({
      intent: 'provision',
      requestedMode: 'sessions',
      schema: { appId: 'sessions-app' },
      functions: { appId: 'sessions-app' },
    });
    assert.equal(outcome.intent, 'provision');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://snapback.test/app/ensure');
    assert.equal(
      new Headers(requests[0].init.headers).get('x-snapback-admin-token'),
      'ensure-admin',
    );
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      intent: 'provision',
      requestedMode: 'sessions',
      schema: { appId: 'sessions-app' },
      functions: { appId: 'sessions-app' },
    });
    await assert.rejects(
      provisioningClient.ensureApp({
        intent: 'attest',
        requestedMode: 'sessions',
      }),
      /intent must be 'provision'/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/inspect')) {
      return new Response(JSON.stringify({
        capabilityManifest: {
          supportedCapabilities: ['versioned_seed_install_v1'],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ state: 'installed', receipt: { outcome: 'installed' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const seedClient = new SnapbackClient('http://snapback.test', { adminToken: 'seed-admin' });
    const artifact = {
      formatVersion: 'snapback.seed.v1',
      appId: 'demo',
      seedVersion: 'v1',
      seedDigest: `sha256:${'a'.repeat(64)}`,
      tables: {},
    };
    const operationId = '01983c8d-9f87-7ec1-bc02-7e81290debc0';
    await seedClient.ensureVersionedSeed(artifact, { operationId });
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, 'http://snapback.test/_snapback/api/app/seed/ensure-v1');
    assert.equal(new Headers(requests[1].init.headers).get('x-snapback-admin-token'), 'seed-admin');
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      formatVersion: 'snapback.seed.install-request.v1',
      operationId,
      artifact,
      requestedMode: 'dev',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      capabilityManifest: { supportedCapabilities: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const seedClient = new SnapbackClient('http://snapback.test', { adminToken: 'seed-admin' });
    await assert.rejects(
      seedClient.ensureVersionedSeed({
        formatVersion: 'snapback.seed.v1',
        appId: 'demo',
        seedVersion: 'v1',
        seedDigest: `sha256:${'a'.repeat(64)}`,
        tables: {},
      }),
      (error) => error?.code === 'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
    );
    assert.equal(requests.length, 1, 'capability refusal performs no legacy seed/reset request');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (url.endsWith('/inspect')) {
      return new Response(JSON.stringify({
        capabilityManifest: {
          supportedCapabilities: [
            'versioned_seed_install_v1',
            'versioned_seed_reset_v1',
          ],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ operation: 'preview', outcome: 'eligible' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const seedClient = new SnapbackClient('http://snapback.test', { adminToken: 'seed-admin' });
  const artifact = {
    formatVersion: 'snapback.seed.v1',
    appId: 'demo',
    seedVersion: 'v1',
    seedDigest: `sha256:${'a'.repeat(64)}`,
    tables: {},
  };
  const expectedDataVersionStream = { state: 'absent' };
  try {
    await assert.rejects(
      seedClient.previewVersionedSeed(null, { operation: 'install' }),
      /install seed preview requires artifact/u,
    );
    await assert.rejects(
      seedClient.previewVersionedSeed(artifact, { operation: 'resetInstall' }),
      /ExpectedDataVersionStreamV1/u,
    );
    await assert.rejects(
      seedClient.previewVersionedSeed(artifact, {
        operation: 'clear',
        expectedDataVersionStream,
      }),
      /clear seed preview forbids artifact/u,
    );
    await assert.rejects(
      seedClient.previewVersionedSeed(null, {
        operation: 'clear',
      }),
      /ExpectedDataVersionStreamV1/u,
    );
    assert.equal(requests.length, 0, 'impossible seed preview variants refuse before capability I/O');
    await seedClient.previewVersionedSeed(artifact);
    await seedClient.previewVersionedSeed(artifact, {
      operation: 'resetInstall',
      expectedDataVersionStream,
    });
    await seedClient.previewVersionedSeed(null, {
      operation: 'clear',
      expectedDataVersionStream,
    });
    assert.deepEqual(
      requests.filter(({ url }) => url.endsWith('/_snapback/api/app/seed/preview-v1'))
        .map(({ init }) => JSON.parse(init.body)),
      [
        {
          formatVersion: 'snapback.seed.preview-request.v1',
          artifact,
          requestedMode: 'dev',
          operation: 'install',
        },
        {
          formatVersion: 'snapback.seed.preview-request.v1',
          artifact,
          requestedMode: 'dev',
          operation: 'resetInstall',
          expectedDataVersionStream,
        },
        {
          formatVersion: 'snapback.seed.preview-request.v1',
          requestedMode: 'dev',
          operation: 'clear',
          expectedDataVersionStream,
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('package.test.mjs: packaged client exports are consumable');
