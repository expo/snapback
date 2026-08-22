import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const moduleRoot = process.env.SNAPBACK_AUTH_SETTLEMENT_MODULE_ROOT ?? null;
if (moduleRoot === null) {
  throw new Error('SNAPBACK_AUTH_SETTLEMENT_MODULE_ROOT must name packed node_modules');
}
const moduleUrl = (packageName, file) => pathToFileURL(
  resolve(moduleRoot, packageName, file),
);

const {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} = await import(moduleUrl('@expo/snapback-contract', 'auth-coordinator.mjs'));
const { SnapbackClient } = await import(moduleUrl('@expo/snapback-client', 'index.mjs'));
const { createMemoryRqsResumeStore } = await import(
  moduleUrl('@expo/snapback-client', 'rqs-store-memory.mjs')
);
const {
  CLIENT_AUTHORITY_STATE_MATRIX,
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_SURFACES,
} = await import(moduleUrl('@expo/snapback-client', 'authority-transition.mjs'));
const { prepareReactBindingForClient } = await import(
  moduleUrl('@expo/snapback-client', 'react-binding.mjs')
);
const { createSnapbackReactProvider } = await import(
  moduleUrl('@expo/snapback-react', 'index.mjs')
);
const {
  SnapbackProvider: FamiliarSnapbackProvider,
  useQuery: useFamiliarQuery,
} = await import(moduleUrl('@expo/snapback-react', 'familiar.mjs'));
const packedExpo = await import(moduleUrl('@expo/snapback-expo', 'index.mjs'));

assert.equal(CLIENT_AUTHORITY_SURFACES.length * CLIENT_AUTHORITY_STATES.length, 50);
assert.deepEqual(packedExpo.CLIENT_AUTHORITY_STATE_MATRIX, CLIENT_AUTHORITY_STATE_MATRIX);

const APP_ID = '018f0d90-7d10-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7d11-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7d12-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7d13-7a22-8c33-445566778899';
const AUTHORITY_ID = '018f0d90-7d14-7a22-8c33-445566778899';
const BEARER = 'sbs_auth_settlement_packed_proof';
const TRANSITION_OWNER = 'auth-coordinator';

const availability = Object.freeze({
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
});

const handshake = (authenticated) => ({
  protocolVersion: 1,
  serverStartupNonce: 'auth-settlement-packed-proof',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 0,
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
  availability,
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: authenticated
    ? {
        kind: 'humanSession',
        userId: USER_ID,
        sessionId: SESSION_ID,
        isAuthenticated: true,
      }
    : {
        kind: 'anonymous',
        userId: null,
        sessionId: null,
        isAuthenticated: false,
      },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authenticated ? AUTHORITY_ID : INCARNATION,
    sessionGeneration: authenticated ? 1 : 0,
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
});

const protectedQuery = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Query',
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const legacyProtectedQuery = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Query',
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
});

const sessionSuccessor = () => ({
  authority: {
    kind: 'session',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
    sessionId: SESSION_ID,
    userId: USER_ID,
  },
  bearer: BEARER,
  refreshAfterMs: Date.now() + 60_000,
});

const promptRejection = async (operation, code, reason) => {
  let outcome = null;
  const observed = operation.then(
    () => { outcome = { status: 'resolved' }; },
    (error) => { outcome = { status: 'rejected', error }; },
  );
  await Promise.resolve();
  assert.equal(outcome?.status, 'rejected');
  assert.equal(outcome.error?.code, code);
  assert.equal(outcome.error?.reason, reason);
  assert.equal(outcome.error?.diagnostic?.details?.transitionOwner, TRANSITION_OWNER);
  assert.equal(outcome.error?.effectMayHaveCommitted, false);
  await observed;
  return code;
};

let gateSequence = 0;
const transitionGate = (coordinator) => {
  let reportEntered;
  let releaseCommit;
  const entered = new Promise((resolveEntered) => { reportEntered = resolveEntered; });
  const held = new Promise((resolveHeld) => { releaseCommit = resolveHeld; });
  const unregister = coordinator.registerParticipant({
    name: `auth-settlement-packed-gate-${++gateSequence}`,
    async commitDurable() {
      reportEntered();
      await held;
    },
  });
  return { entered, release: releaseCommit, unregister };
};

async function proveOneShots() {
  const originalFetch = globalThis.fetch;
  let queryRequests = 0;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const authorization = new Headers(init.headers).get('authorization');
    if (path === '/auth/session') {
      return Response.json(handshake(authorization === `Bearer ${BEARER}`));
    }
    if (path === '/query/privateRecords') {
      queryRequests += 1;
      return Response.json({ rows: [{ id: 'private-1' }], version: 1 });
    }
    throw new Error(`unexpected packed one-shot request: ${path}`);
  };
  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://auth-settlement-packed.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: null,
    offlineQueue: false,
  });
  let gate = null;
  try {
    await client.authSession();
    const anonymousCapture = coordinator.capture();
    const anonymousAuthority = coordinator.credentialFor(anonymousCapture).authority;
    const matrix = {
      signedOut: await promptRejection(
        client.query(protectedQuery),
        'SNAPBACK_AUTH_REQUIRED',
        'authentication-required',
      ),
    };
    const requestsBeforeSigningIn = queryRequests;
    gate = transitionGate(coordinator);
    const signingIn = coordinator.transition(
      coordinator.capture(),
      sessionSuccessor(),
      'login',
    );
    await gate.entered;
    matrix.signingIn = await promptRejection(
      client.query(legacyProtectedQuery),
      'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      'authentication-not-settled',
    );
    assert.equal(queryRequests, requestsBeforeSigningIn);
    gate.release();
    await signingIn;
    await gate.unregister();
    gate = null;

    assert.deepEqual((await client.query(protectedQuery)).rows, [{ id: 'private-1' }]);
    matrix.signedIn = 'success';

    const requestsBeforeSigningOut = queryRequests;
    gate = transitionGate(coordinator);
    const signingOut = coordinator.transition(
      coordinator.capture(),
      { authority: anonymousAuthority, bearer: null, refreshAfterMs: null },
      'logout',
    );
    await gate.entered;
    matrix.signingOut = await promptRejection(
      client.query(protectedQuery),
      'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      'authentication-not-settled',
    );
    assert.equal(queryRequests, requestsBeforeSigningOut);
    gate.release();
    await signingOut;
    await gate.unregister();
    gate = null;

    await coordinator.transition(coordinator.capture(), sessionSuccessor(), 'login');
    const revoked = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session was revoked');
    revoked.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
    const terminal = client.handleTerminalAuthLoss(coordinator.capture(), revoked);
    await terminal.settlement;
    const requestsBeforeRevoked = queryRequests;
    matrix.revoked = await promptRejection(
      client.query(protectedQuery),
      'SNAPBACK_AUTH_SESSION_REVOKED',
      'authentication-terminated',
    );
    assert.equal(queryRequests, requestsBeforeRevoked);
    return Object.freeze(matrix);
  } finally {
    gate?.release();
    await gate?.unregister();
    await client.close();
    await coordinator.close();
    globalThis.fetch = originalFetch;
  }
}

async function proveModePendingReload() {
  const originalFetch = globalThis.fetch;
  const modePending = (details = {}) => Response.json({
    diagnostic: {
      code: 'SNAPBACK_AUTH_MODE_PENDING',
      message: 'auth-mode activation is settling',
      details,
    },
  }, { status: 503 });
  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymousCapture = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode: 'sessions',
    authorizationStreamIncarnation: INCARNATION,
  });
  await coordinator.transition(anonymousCapture, sessionSuccessor(), 'login');
  const client = new SnapbackClient('https://auth-settlement-packed-mode-pending.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: null,
    reservationRetryJitterMilliseconds: [0, 0],
  });
  try {
    let attempts = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname === '/auth/session') return Response.json(handshake(true));
      attempts += 1;
      return attempts < 3
        ? modePending()
        : Response.json({ version: 1, rows: [{ id: 'successor' }] });
    };
    assert.deepEqual((await client.query('packedWatchReloadProbe')).rows, [{ id: 'successor' }]);
    assert.equal(attempts, 3);
    assert.equal(client.authTerminalStatus().terminated, false);
    assert.equal(coordinator.settledView().authority.sessionId, SESSION_ID);

    attempts = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).pathname === '/auth/session') return Response.json(handshake(false));
      attempts += 1;
      return modePending({
        reason: 'mode_transition',
        authorityDisposition: 'durableDelete',
      });
    };
    await assert.rejects(
      client.query('packedStagedModeTransitionProbe'),
      (error) => (
        error.diagnostic?.code === 'SNAPBACK_AUTH_MODE_PENDING'
        && error.authorityDisposition === 'durableDelete'
      ),
    );
    assert.equal(attempts, 1);
    return Object.freeze({ axislessAttempts: 3, dispositionTerminalAttempts: 1 });
  } finally {
    await client.closeAuth();
    await coordinator.close();
    globalThis.fetch = originalFetch;
  }
}

async function proveHousekeepingBarrier() {
  const originalFetch = globalThis.fetch;
  let transportAttempts = 0;
  globalThis.fetch = async () => {
    transportAttempts += 1;
    throw new Error('packed auth-barrier housekeeping proof must issue zero transport');
  };
  const transitionStatus = Object.freeze({
    state: 'authenticating',
    settled: false,
    subscribeSafe: false,
    ephemeralAuthorityUsable: false,
    transitionOwner: TRANSITION_OWNER,
    barrierPhase: 'commitDurable',
    authorityEpoch: 1,
    custodyRevision: 2,
    closed: false,
  });
  const authorityFence = {
    authority: null,
    registerParticipant: () => null,
    authorityTransitionStatus: () => transitionStatus,
    subscribeAuthorityTransition(listener) {
      listener(transitionStatus);
      return () => {};
    },
  };
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'packed-memory-test-double', durable: true });
  const client = new SnapbackClient('https://auth-settlement-packed-housekeeping.test', {
    authCoordinator: authorityFence,
    rqsStore: store,
    __offlineMutationReplayCapability: true,
    __outboxDrainLifecycle: false,
  });
  try {
    const queued = await client.mutate('refreshCache', {
      args: { route: '/inbox' },
      clientMutationId: 'packed-housekeeping-auth-barrier',
      housekeeping: { key: 'route-inbox', idempotent: true, successorValid: true },
    });
    assert.equal(queued.status, 'queued');
    assert.equal(queued.blockedReason, 'auth-barrier');
    assert.equal(transportAttempts, 0);
    const record = (await store.outboxRecords())
      .find(({ id }) => id === 'packed-housekeeping-auth-barrier');
    assert.equal(record.dispatchLane, 'housekeeping');
    assert.equal(record.status, 'pending');
    assert.equal((await client.outboxStatus()).blockedReason, 'auth-barrier');
    return Object.freeze({ blockedReason: 'auth-barrier', transportAttempts });
  } finally {
    await client.closeAuth();
    globalThis.fetch = originalFetch;
  }
}

const queryContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } }),
    ]),
    allowExtra: false,
  }),
});
const privateLive = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: APP_ID,
  id: `${APP_ID}:privateLive`,
  name: 'privateLive',
  kind: 'LiveQuery',
  authRequirement: 'authenticated',
  implementationHash: 'sha256:private-live-implementation',
  argsContractHash: 'sha256:private-live-args',
  argsContract: Object.freeze({ kind: 'object', fields: Object.freeze([]) }),
  resultContractHash: 'sha256:1e0850e532f8ed1e2d073a6578c441f488b4325cecc00aaa731a9cd6bedbbc5e',
  resultContract: queryContract,
});
const optionalLive = Object.freeze({
  ...privateLive,
  id: `${APP_ID}:optionalLive`,
  name: 'optionalLive',
  authoringProfile: 'snapback-familiar-ts-v1',
  delivery: 'live',
  retention: 'none',
  authRequirement: 'optional-user',
  implementationHash: 'sha256:optional-live-implementation',
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: APP_ID,
  bundleHash: 'sha256:auth-settlement-packed-react',
  functions: Object.freeze([privateLive, optionalLive]),
});

const flush = () => new Promise((resolveFlush) => setImmediate(resolveFlush));

function projectedClient() {
  const state = {
    authority: 'anonymous',
    authorityEpoch: 0,
    custodyRevision: 1,
    publicationPaused: false,
    participant: null,
    attempts: 0,
  };
  const capture = () => Object.freeze({
    authorityEpoch: state.authorityEpoch,
    authorityKey: `authority:${state.authority}`,
    custodyRevision: state.custodyRevision,
  });
  const coordinator = Object.freeze({
    capture() {
      if (state.publicationPaused) {
        const error = new Error('authority custody is clearing');
        error.code = 'SNAPBACK_CLIENT_AUTHORITY_CLEARING';
        throw error;
      }
      return capture();
    },
    credentialFor() {
      return Object.freeze({
        authority: Object.freeze({
          kind: state.authority === 'anonymous' ? 'anonymous' : 'session',
        }),
      });
    },
  });
  const client = {
    state,
    authCoordinator: coordinator,
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:auth-settlement-packed-schema' },
        functions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    captureAuthority() { return coordinator.capture(); },
    isAuthorityCaptureCurrent(candidate) {
      const current = capture();
      return !state.publicationPaused
        && candidate?.authorityEpoch === current.authorityEpoch
        && candidate?.authorityKey === current.authorityKey
        && candidate?.custodyRevision === current.custodyRevision;
    },
    registerAuthBarrierParticipant(participant) {
      state.participant = participant;
      return async () => { state.participant = null; };
    },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      state.attempts += 1;
      const current = {
        rows: [{ id: state.authority === 'anonymous' ? 'anonymous' : 'session' }],
        connection: 'live',
        freshness: 'current',
      };
      const handle = {
        current,
        started: async () => {},
        dispose() {},
        settled: async () => {},
      };
      queueMicrotask(() => options.onUpdate(current.rows, { freshness: 'current' }));
      return Object.freeze(handle);
    },
    async transitionAuthority(authority, reason, duringBarrier) {
      const participant = state.participant;
      state.publicationPaused = true;
      await participant.quiesce({ reason });
      participant.blank({ reason });
      await duringBarrier?.();
      participant.clearMemory({ reason });
      state.authority = authority;
      state.authorityEpoch += 1;
      state.custodyRevision += 1;
      const successorCapture = capture();
      const successorAuthority = Object.freeze({
        kind: authority === 'anonymous' ? 'anonymous' : 'session',
      });
      const staged = [];
      await participant.resume({
        reason,
        capture: successorCapture,
        authority: successorAuthority,
        stagePublication(expected, commit) {
          assert.deepEqual(expected, successorCapture);
          staged.push(commit);
        },
      });
      for (const commit of staged) {
        commit(Object.freeze({ ...successorCapture, authority: successorAuthority }));
      }
      state.publicationPaused = false;
      await flush();
    },
    async revoke(duringBarrier) {
      const error = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session was revoked');
      error.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
      const context = Object.freeze({
        reason: error.code,
        terminal: true,
        terminalError: error,
        disposition: 'quarantine',
      });
      state.publicationPaused = true;
      await state.participant.quiesce(context);
      state.participant.blank(context);
      await duringBarrier?.();
      state.participant.clearMemory(context);
      state.publicationPaused = false;
    },
  };
  return client;
}

async function proveLive() {
  const client = projectedClient();
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: 'auth-settlement-packed-react',
  });
  const descriptor = provider.registry.descriptor(privateLive, {});
  const lease = provider.registry.subscribe(descriptor, () => {});
  const snapshot = () => provider.registry.snapshot(descriptor);
  const familiarRenders = [];
  const FamiliarProbe = () => (familiarRenders.push(useFamiliarQuery(optionalLive, {})), null);
  let familiarRenderer = null;
  await flush();
  const matrix = {};
  try {
    await act(async () => {
      familiarRenderer = TestRenderer.create(React.createElement(
        FamiliarSnapbackProvider,
        { provider },
        React.createElement(FamiliarProbe),
      ));
      await flush();
    });
    assert.deepEqual(familiarRenders.at(-1), [{ id: 'anonymous' }]);
    assert.equal(snapshot().status, 'blocked');
    assert.equal(snapshot().reason, 'authentication-required');
    assert.equal(snapshot().transitionOwner, TRANSITION_OWNER);
    matrix.signedOut = 'blocked:authentication-required';

    await act(async () => {
      await client.transitionAuthority('session', 'login', () => {
        assert.equal(snapshot().status, 'blocked');
        assert.equal(snapshot().reason, 'authentication-not-settled');
        assert.equal(snapshot().transitionOwner, TRANSITION_OWNER);
        matrix.signingIn = 'blocked:authentication-not-settled';
      });
      await flush();
    });
    assert.equal(snapshot().status, 'ready');
    assert.deepEqual(familiarRenders.at(-1), [{ id: 'session' }]);
    matrix.familiar = 'optional-user:session-successor';
    await act(async () => {
      familiarRenderer.unmount();
      familiarRenderer = null;
      await flush();
    });
    matrix.signedIn = 'ready';

    await client.transitionAuthority('anonymous', 'logout', () => {
      assert.equal(snapshot().status, 'blocked');
      assert.equal(snapshot().reason, 'authentication-not-settled');
      assert.equal(snapshot().transitionOwner, TRANSITION_OWNER);
      matrix.signingOut = 'blocked:authentication-not-settled';
    });
    assert.equal(snapshot().reason, 'authentication-required');

    await client.transitionAuthority('session', 'login');
    await client.revoke(() => {
      assert.equal(snapshot().status, 'error');
      assert.equal(snapshot().error?.code, 'SNAPBACK_AUTH_SESSION_REVOKED');
      assert.equal(snapshot().transitionOwner, TRANSITION_OWNER);
      assert.equal(snapshot().error?.details?.transitionOwner, TRANSITION_OWNER);
      matrix.revoked = 'error:SNAPBACK_AUTH_SESSION_REVOKED';
    });
    return Object.freeze(matrix);
  } finally {
    await act(async () => {
      familiarRenderer?.unmount();
      await flush();
    });
    lease.release();
    await provider.dispose();
  }
}

// guide-auth-settlement-packed-proof:start
const result = Object.freeze({
  oneShot: await proveOneShots(),
  live: await proveLive(),
  modePendingReload: await proveModePendingReload(),
  housekeeping: await proveHousekeepingBarrier(),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
// guide-auth-settlement-packed-proof:end
