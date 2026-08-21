import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient } from './index.mjs';

const APP_ID = '018f0d90-7d10-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7d11-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7d12-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7d13-7a22-8c33-445566778899';
const AUTHORITY_ID = '018f0d90-7d14-7a22-8c33-445566778899';
const BEARER = 'sbs_anonymous_read_recovery';

const availability = Object.freeze({
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
});

const deploymentIdentity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

const handshake = (authenticated) => ({
  protocolVersion: 1,
  serverStartupNonce: 'anonymous-read-recovery-startup',
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
  deploymentIdentity,
  authorizedLease: null,
});

const credential = () => ({
  tokenType: 'Bearer',
  token: BEARER,
  refreshAfter: Date.now() + 60_000,
  session: {
    id: SESSION_ID,
    userId: USER_ID,
    provider: 'email-code',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    absoluteExpiresAt: Date.now() + 240_000,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_ID,
    sessionGeneration: 1,
  },
});

const protectedQuery = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Query',
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const protectedAction = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Action',
  name: 'privateAction',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const protectedMutation = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Mutation',
  name: 'privateMutation',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const legacyProtectedQuery = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Query',
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
});

const authRequired = () => Response.json({
  diagnostic: {
    code: 'SNAPBACK_AUTH_REQUIRED',
    message: 'authentication is required',
  },
}, { status: 401 });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return Object.freeze({ promise, resolve, reject });
};

class BroadcastHub {
  channels = new Map();
  onPostMessage = null;

  factory = (name) => {
    const channel = {
      onmessage: null,
      postMessage: (message) => {
        for (const peer of this.channels.get(name) ?? []) {
          if (peer !== channel) peer.onmessage?.({ data: structuredClone(message) });
        }
        this.onPostMessage?.(structuredClone(message));
      },
      close: () => this.channels.get(name)?.delete(channel),
    };
    if (!this.channels.has(name)) this.channels.set(name, new Set());
    this.channels.get(name).add(channel);
    return channel;
  };
}

function makeFixture() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let exchanged = false;
  let refuseNextAnonymousQuery = false;
  let heldEffect = null;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const authorization = new Headers(init.headers).get('authorization');
    requests.push({ path, authorization });
    if (path === '/auth/session') {
      return Response.json(handshake(authorization === `Bearer ${BEARER}`));
    }
    if (path === '/auth/exchange') {
      exchanged = true;
      return Response.json(credential());
    }
    if (path === '/query/privateRecords') {
      if (authorization !== `Bearer ${BEARER}` || refuseNextAnonymousQuery) {
        refuseNextAnonymousQuery = false;
        return authRequired();
      }
      return Response.json({ rows: [{ id: 'private-1' }], version: 1 });
    }
    if (path === '/action/privateAction' || path === '/mutation/privateMutation') {
      if (heldEffect === null) throw new Error(`unexpected unheld effect request: ${path}`);
      const gate = heldEffect;
      heldEffect = null;
      gate.entered.resolve();
      return new Promise((resolve, reject) => {
        const abort = () => reject(init.signal?.reason ?? new Error('request aborted'));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    throw new Error(`unexpected anonymous-read recovery request: ${path}`);
  };

  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://anonymous-read-recovery.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: null,
    offlineQueue: false,
  });
  return {
    client,
    coordinator,
    requests,
    refuseNextAnonymousQuery() { refuseNextAnonymousQuery = true; },
    holdNextEffect() {
      assert.equal(heldEffect, null, 'only one controlled effect may be held');
      const entered = deferred();
      heldEffect = { entered };
      return Object.freeze({ entered: entered.promise });
    },
    exchanged() { return exchanged; },
    async close() {
      await client.closeAuth();
      await coordinator.close();
      globalThis.fetch = originalFetch;
    },
  };
}

const assertLocalAuthRequired = async (operation) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, 'SNAPBACK_AUTH_REQUIRED');
    assert.equal(error?.reason, 'authentication-required');
    assert.equal(error?.retryable, true);
    assert.equal(error?.effectMayHaveCommitted, false);
    assert.equal(error?.diagnostic?.reason, 'authentication-required');
    assert.deepEqual(error?.diagnostic?.details, {
      reason: 'authentication-required',
      transitionOwner: 'auth-coordinator',
      retryable: true,
      retryStrategy: 'after-authentication',
      effectCommitted: false,
    });
    return true;
  });
};

const promptRejection = async (operation, expectedCode, expectedReason) => {
  let outcome = null;
  const observed = operation.then(
    () => { outcome = { status: 'resolved' }; },
    (error) => { outcome = { status: 'rejected', error }; },
  );
  await Promise.resolve();
  assert.notEqual(outcome, null, 'local auth admission settles in the promise microtask queue');
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error?.code, expectedCode);
  assert.equal(outcome.error?.reason, expectedReason);
  assert.equal(
    outcome.error?.diagnostic?.details?.transitionOwner,
    'auth-coordinator',
  );
  assert.equal(outcome.error?.effectMayHaveCommitted, false);
  await observed;
};

let transitionGateSequence = 0;
const gateNextTransitionCommit = (coordinator) => {
  let reportEntered;
  let releaseCommit;
  const entered = new Promise((resolve) => { reportEntered = resolve; });
  const held = new Promise((resolve) => { releaseCommit = resolve; });
  const unregister = coordinator.registerParticipant({
    name: `auth-one-shot-transition-gate-${++transitionGateSequence}`,
    async commitDurable() {
      reportEntered();
      await held;
    },
  });
  return Object.freeze({ entered, release: releaseCommit, unregister });
};

const gateNextTransitionResume = (coordinator) => {
  let reportEntered;
  let releaseResume;
  const entered = new Promise((resolve) => { reportEntered = resolve; });
  const held = new Promise((resolve) => { releaseResume = resolve; });
  const unregister = coordinator.registerParticipant({
    name: `auth-one-shot-resume-gate-${++transitionGateSequence}`,
    async resume() {
      reportEntered();
      await held;
    },
  });
  return Object.freeze({ entered, release: releaseResume, unregister });
};

test('anonymous protected one-shots recover on the same client', async (t) => {
  await t.test('local generated preflight performs no transport I/O and sign-in succeeds', async () => {
    const fixture = makeFixture();
    try {
      await fixture.client.authSession();
      assert.equal(fixture.coordinator.authority?.kind, 'anonymous');
      const requestsBeforeRefusals = fixture.requests.length;

      await assertLocalAuthRequired(fixture.client.query(protectedQuery));
      await assertLocalAuthRequired(fixture.client.action(protectedAction));
      await assertLocalAuthRequired(fixture.client.mutate(protectedMutation, { queue: false }));
      assert.equal(
        fixture.requests.length,
        requestsBeforeRefusals,
        'all generated protected one-shots refuse before fetch',
      );

      const projection = await fixture.client.authExchange({
        challengeId: 'challenge-local-preflight',
        code: '123456',
      });
      assert.equal(fixture.exchanged(), true);
      assert.equal(projection.session.id, SESSION_ID);
      assert.equal(fixture.coordinator.authority?.kind, 'session');

      const result = await fixture.client.query(protectedQuery);
      assert.deepEqual(result.rows, [{ id: 'private-1' }]);
    } finally {
      await fixture.close();
    }
  });

  await t.test('a raced server AUTH_REQUIRED on an anonymous capture does not poison sign-in', async () => {
    const fixture = makeFixture();
    try {
      await fixture.client.authSession();
      fixture.refuseNextAnonymousQuery();
      await assert.rejects(fixture.client.query(legacyProtectedQuery), (error) => {
        assert.equal(error?.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED');
        assert.equal(error?.status, 401);
        return true;
      });
      assert.equal(fixture.coordinator.phase, 'settled');
      assert.equal(fixture.coordinator.authority?.kind, 'anonymous');

      const projection = await fixture.client.authExchange({
        challengeId: 'challenge-server-race',
        code: '654321',
      });
      assert.equal(projection.session.id, SESSION_ID);
      assert.equal(fixture.coordinator.authority?.kind, 'session');
      assert.deepEqual((await fixture.client.query(protectedQuery)).rows, [
        { id: 'private-1' },
      ]);
    } finally {
      await fixture.close();
    }
  });

  await t.test('mid-flight revocation keeps action and mutation effects possibly committed', async () => {
    for (const { label, start } of [
      {
        label: 'action',
        start: (client) => client.run(protectedAction),
      },
      {
        label: 'mutation',
        start: (client) => client.mutate(protectedMutation, { queue: false }),
      },
    ]) {
      const fixture = makeFixture();
      try {
        await fixture.client.authSession();
        await fixture.client.authExchange({
          challengeId: `challenge-mid-flight-${label}`,
          code: '112233',
        });
        const gate = fixture.holdNextEffect();
        const operation = start(fixture.client);
        await gate.entered;
        const revoked = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session was revoked');
        revoked.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
        const terminal = fixture.client.handleTerminalAuthLoss(
          fixture.coordinator.capture(),
          revoked,
        );
        await assert.rejects(operation, (error) => {
          assert.equal(
            error?.effectMayHaveCommitted,
            true,
            `${label} transport entry makes retry safety indeterminate`,
          );
          assert.notEqual(
            error?.effectCommitted,
            false,
            `${label} revocation cannot manufacture authoritative no-effect proof`,
          );
          return true;
        });
        await terminal.settlement;
      } finally {
        await fixture.close();
      }
    }
  });

  await t.test('legacy protected query refuses a transition instead of joining its barrier', async () => {
    const fixture = makeFixture();
    let gate = null;
    try {
      await fixture.client.authSession();
      gate = gateNextTransitionCommit(fixture.coordinator);
      const signingIn = fixture.coordinator.transition(
        fixture.coordinator.capture(),
        {
          authority: {
            kind: 'session',
            authMode: 'sessions',
            authorizationStreamIncarnation: INCARNATION,
            sessionId: SESSION_ID,
            userId: USER_ID,
          },
          bearer: BEARER,
          refreshAfterMs: Date.now() + 60_000,
        },
        'login',
      );
      await gate.entered;
      const requestsBeforeRefusal = fixture.requests.length;
      await promptRejection(
        fixture.client.query(legacyProtectedQuery),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authentication-not-settled',
      );
      assert.equal(
        fixture.requests.length,
        requestsBeforeRefusal,
        'transition refusal performs no query transport request',
      );
      gate.release();
      await signingIn;
      await gate.unregister();
      gate = null;
      assert.deepEqual((await fixture.client.query(legacyProtectedQuery)).rows, [
        { id: 'private-1' },
      ]);
    } finally {
      gate?.release();
      await gate?.unregister();
      await fixture.close();
    }
  });

  await t.test('legacy protected query refuses while successor resume is settled but unexposed', async () => {
    const fixture = makeFixture();
    let gate = null;
    try {
      await fixture.client.authSession();
      gate = gateNextTransitionResume(fixture.coordinator);
      const signingIn = fixture.coordinator.transition(
        fixture.coordinator.capture(),
        {
          authority: {
            kind: 'session',
            authMode: 'sessions',
            authorizationStreamIncarnation: INCARNATION,
            sessionId: SESSION_ID,
            userId: USER_ID,
          },
          bearer: BEARER,
          refreshAfterMs: Date.now() + 60_000,
        },
        'login',
      );
      await gate.entered;
      assert.equal(
        fixture.coordinator.phase,
        'settled',
        'durable custody is settled while publication remains paused in resume',
      );
      const requestsBeforeRefusal = fixture.requests.length;
      await promptRejection(
        fixture.client.query(legacyProtectedQuery),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authentication-not-settled',
      );
      assert.equal(fixture.requests.length, requestsBeforeRefusal);
      gate.release();
      await signingIn;
      await gate.unregister();
      gate = null;
    } finally {
      gate?.release();
      await gate?.unregister();
      await fixture.close();
    }
  });

  await t.test('legacy protected query refuses synchronously after a peer clearing wakeup', async () => {
    const originalFetch = globalThis.fetch;
    const shared = { custody: {} };
    const hub = new BroadcastHub();
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const authorization = new Headers(init.headers).get('authorization');
      requests.push({ path, authorization });
      if (path === '/auth/session') {
        return Response.json(handshake(authorization === `Bearer ${BEARER}`));
      }
      if (path === '/query/privateRecords') {
        return Response.json({ rows: [{ id: 'private-1' }], version: 1 });
      }
      throw new Error(`unexpected peer-wakeup request: ${path}`);
    };
    const coordinatorA = new AuthCoordinator({
      appId: APP_ID,
      storage: createMemoryAuthCustodyStorage({ state: shared }),
      broadcastChannelFactory: hub.factory,
      hintStorage: null,
    });
    const coordinatorB = new AuthCoordinator({
      appId: APP_ID,
      storage: createMemoryAuthCustodyStorage({ state: shared }),
      broadcastChannelFactory: hub.factory,
      hintStorage: null,
    });
    const clientOptions = {
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      rqsStore: null,
      offlineQueue: false,
    };
    const clientA = new SnapbackClient('https://anonymous-read-recovery.test', {
      ...clientOptions,
      authCoordinator: coordinatorA,
    });
    const clientB = new SnapbackClient('https://anonymous-read-recovery.test', {
      ...clientOptions,
      authCoordinator: coordinatorB,
    });
    let gate = null;
    let transition = null;
    let peerOperation = null;
    let peerPhaseAtAdmission = null;
    try {
      await clientA.authSession();
      await clientB.authSession();
      hub.onPostMessage = (message) => {
        if (message.phase !== 'clearing' || peerOperation !== null) return;
        peerPhaseAtAdmission = coordinatorB.phase;
        peerOperation = clientB.query(legacyProtectedQuery);
      };
      gate = gateNextTransitionCommit(coordinatorA);
      transition = coordinatorA.transition(
        coordinatorA.capture(),
        {
          authority: {
            kind: 'session',
            authMode: 'sessions',
            authorizationStreamIncarnation: INCARNATION,
            sessionId: SESSION_ID,
            userId: USER_ID,
          },
          bearer: BEARER,
          refreshAfterMs: Date.now() + 60_000,
        },
        'peer-login',
      );
      await gate.entered;
      assert.equal(peerPhaseAtAdmission, 'settled');
      assert.ok(peerOperation, 'the clearing wakeup started the peer one-shot race');
      const queryRequestsBeforeRefusal = requests.filter(
        ({ path }) => path === '/query/privateRecords',
      ).length;
      await promptRejection(
        peerOperation,
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authentication-not-settled',
      );
      assert.equal(
        requests.filter(({ path }) => path === '/query/privateRecords').length,
        queryRequestsBeforeRefusal,
        'the wakeup race performs zero query transport',
      );
      gate.release();
      await transition;
      await gate.unregister();
      gate = null;
      transition = null;
    } finally {
      hub.onPostMessage = null;
      gate?.release();
      await transition?.catch(() => {});
      await gate?.unregister();
      await clientB.closeAuth();
      await clientA.closeAuth();
      await coordinatorB.close();
      await coordinatorA.close();
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('protected query settles across the five authority states', async () => {
    const fixture = makeFixture();
    let gate = null;
    try {
      await fixture.client.authSession();
      const anonymousCapture = fixture.coordinator.capture();
      const anonymousAuthority = fixture.coordinator.credentialFor(anonymousCapture).authority;

      const requestsBeforeSignedOut = fixture.requests.length;
      await promptRejection(
        fixture.client.query(protectedQuery),
        'SNAPBACK_AUTH_REQUIRED',
        'authentication-required',
      );
      assert.equal(fixture.requests.length, requestsBeforeSignedOut);

      gate = gateNextTransitionCommit(fixture.coordinator);
      const signingIn = fixture.client.authExchange({
        challengeId: 'challenge-state-matrix-signin',
        code: '135790',
      });
      await gate.entered;
      const requestsBeforeSigningInRefusal = fixture.requests.length;
      await promptRejection(
        fixture.client.query(protectedQuery),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authentication-not-settled',
      );
      assert.equal(fixture.requests.length, requestsBeforeSigningInRefusal);
      gate.release();
      await signingIn;
      await gate.unregister();
      gate = null;

      assert.deepEqual((await fixture.client.query(protectedQuery)).rows, [
        { id: 'private-1' },
      ]);

      gate = gateNextTransitionCommit(fixture.coordinator);
      const signingOut = fixture.coordinator.transition(
        fixture.coordinator.capture(),
        { authority: anonymousAuthority, bearer: null, refreshAfterMs: null },
        'logout',
      );
      await gate.entered;
      const requestsBeforeSigningOutRefusal = fixture.requests.length;
      await promptRejection(
        fixture.client.query(protectedQuery),
        'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
        'authentication-not-settled',
      );
      assert.equal(fixture.requests.length, requestsBeforeSigningOutRefusal);
      gate.release();
      await signingOut;
      await gate.unregister();
      gate = null;

      await fixture.client.authExchange({
        challengeId: 'challenge-state-matrix-revocation',
        code: '246801',
      });
      const revoked = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session was revoked');
      revoked.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
      const terminal = fixture.client.handleTerminalAuthLoss(
        fixture.coordinator.capture(),
        revoked,
      );
      await terminal.settlement;
      const requestsBeforeRevokedRefusal = fixture.requests.length;
      await promptRejection(
        fixture.client.query(protectedQuery),
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'authentication-terminated',
      );
      assert.equal(fixture.requests.length, requestsBeforeRevokedRefusal);
    } finally {
      gate?.release();
      await gate?.unregister();
      await fixture.close();
    }
  });
});
