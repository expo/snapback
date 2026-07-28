import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
});
assert.throws(
  () => createExternalSessionClient('http://127.0.0.1:9', { bearerToken: '' }),
  /non-empty bearerToken/,
);
assert.throws(
  () => new SnapbackClient('http://127.0.0.1:9', { authClientProtocol: 1 }),
  /explicit external-bearer custody/,
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

console.log('package.test.mjs: packaged client exports are consumable');
