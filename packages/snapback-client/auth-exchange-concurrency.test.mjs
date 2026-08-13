import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient } from './index.mjs';

const APP_ID = '018f0d90-7b10-7a22-8c33-445566778899';
const INCARNATION_A = '018f0d90-7b11-7a22-8c33-445566778899';
const INCARNATION_B = '018f0d90-7b12-7a22-8c33-445566778899';
const EXCHANGED_SESSION = '018f0d90-7b13-7a22-8c33-445566778899';
const EXCHANGED_USER = '018f0d90-7b14-7a22-8c33-445566778899';
const OTHER_SESSION = '018f0d90-7b15-7a22-8c33-445566778899';
const OTHER_USER = '018f0d90-7b16-7a22-8c33-445566778899';
const EXCHANGED_AUTHORITY = '018f0d90-7b17-7a22-8c33-445566778899';
const OTHER_AUTHORITY = '018f0d90-7b18-7a22-8c33-445566778899';
const EXCHANGED_BEARER = 'sbs_auth_exchange_concurrency';
const OTHER_BEARER = 'sbs_auth_exchange_concurrent_successor';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const withDeadline = async (promise, label, timeoutMs = 1_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not settle`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const availability = Object.freeze({
  onlineRequestResponse: { available: true, reason: null },
  authScopedLive: {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    reason: 'SNAPBACK_AUTH_INVALIDATION_PROTOCOL_REQUIRED',
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

const deploymentIdentity = {
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
};

const handshake = ({
  incarnation,
  sessionId = null,
  userId = null,
  authorityInstanceId = incarnation,
}) => ({
  protocolVersion: 1,
  serverStartupNonce: 'auth-exchange-concurrency-startup',
  authorizationStreamIncarnation: incarnation,
  transitionGeneration: 0,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability,
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: sessionId === null
    ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
    : { kind: 'humanSession', userId, sessionId, isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId,
    sessionGeneration: sessionId === null ? 0 : 1,
  },
  deploymentIdentity,
  authorizedLease: null,
});

const exchangedCredential = () => ({
  tokenType: 'Bearer',
  token: EXCHANGED_BEARER,
  refreshAfter: Date.now() + 60_000,
  session: {
    id: EXCHANGED_SESSION,
    userId: EXCHANGED_USER,
    provider: 'email-code',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    absoluteExpiresAt: Date.now() + 240_000,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: EXCHANGED_AUTHORITY,
    sessionGeneration: 1,
  },
});

const otherAuthority = Object.freeze({
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION_A,
  sessionId: OTHER_SESSION,
  userId: OTHER_USER,
});

const makeFixture = () => {
  const exchangeStarted = deferred();
  const exchangeResponse = deferred();
  let anonymousIncarnation = INCARNATION_A;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const authorization = new Headers(init.headers).get('authorization');
    if (path === '/auth/exchange') {
      exchangeStarted.resolve();
      return exchangeResponse.promise;
    }
    if (path === '/auth/session' && authorization === `Bearer ${EXCHANGED_BEARER}`) {
      return Response.json(handshake({
        incarnation: anonymousIncarnation,
        sessionId: EXCHANGED_SESSION,
        userId: EXCHANGED_USER,
        authorityInstanceId: EXCHANGED_AUTHORITY,
      }));
    }
    if (path === '/auth/session' && authorization === `Bearer ${OTHER_BEARER}`) {
      return Response.json(handshake({
        incarnation: INCARNATION_A,
        sessionId: OTHER_SESSION,
        userId: OTHER_USER,
        authorityInstanceId: OTHER_AUTHORITY,
      }));
    }
    if (path === '/auth/session' && authorization === null) {
      return Response.json(handshake({ incarnation: anonymousIncarnation }));
    }
    throw new Error(`unexpected auth-exchange concurrency request: ${path}`);
  };

  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://auth-exchange-concurrency.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: null,
    offlineQueue: false,
  });
  return {
    client,
    coordinator,
    exchangeStarted,
    exchangeResponse,
    setAnonymousIncarnation(value) { anonymousIncarnation = value; },
    async close() {
      globalThis.fetch = originalFetch;
      await client.closeAuth();
    },
  };
};

test('authExchange terminates across interleaved internal authSession custody changes', async (t) => {
  await t.test('uses a fresh anonymous capture and completes login', async () => {
    const fixture = makeFixture();
    try {
      const exchange = fixture.client.authExchange({
        challengeId: 'challenge-anonymous-refresh',
        code: '123456',
      });
      await fixture.exchangeStarted.promise;

      fixture.setAnonymousIncarnation(INCARNATION_B);
      await withDeadline(
        fixture.client.authSession({ force: true }),
        'interleaved anonymous authSession refresh',
      );

      fixture.exchangeResponse.resolve(Response.json(exchangedCredential()));
      const projection = await withDeadline(exchange, 'authExchange after anonymous refresh');
      assert.equal(projection.session.id, EXCHANGED_SESSION);
      assert.deepEqual(fixture.coordinator.authority, {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: INCARNATION_B,
        sessionId: EXCHANGED_SESSION,
        userId: EXCHANGED_USER,
        isAuthenticated: true,
      });
    } finally {
      await fixture.close();
    }
  });

  await t.test('rejects typed stale instead of queueing behind the internal refresh barrier', async () => {
    const fixture = makeFixture();
    const releaseBarrier = deferred();
    const barrierEntered = deferred();
    const unregister = fixture.client.registerAuthBarrierParticipant({
      name: 'auth-exchange-concurrency-held-refresh',
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable(context) {
        if (context.reason !== 'handshake_authority_change') return;
        barrierEntered.resolve();
        await releaseBarrier.promise;
      },
      async resume() {},
    });
    try {
      const exchange = fixture.client.authExchange({
        challengeId: 'challenge-authenticated-refresh',
        code: '654321',
      });
      exchange.then(releaseBarrier.resolve, releaseBarrier.resolve);
      await fixture.exchangeStarted.promise;

      fixture.setAnonymousIncarnation(INCARNATION_B);
      const internalRefresh = fixture.client.authSession({ force: true });
      await barrierEntered.promise;

      fixture.exchangeResponse.resolve(Response.json(exchangedCredential()));
      await withDeadline(assert.rejects(exchange, (error) => {
        assert.equal(error?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
        return true;
      }), 'authExchange stale-authority rejection');

      await withDeadline(
        Promise.allSettled([internalRefresh]),
        'interleaved internal authSession settlement',
      );
      assert.deepEqual(fixture.coordinator.authority, {
        kind: 'anonymous',
        authMode: 'sessions',
        authorizationStreamIncarnation: INCARNATION_B,
        isAuthenticated: false,
      });
    } finally {
      releaseBarrier.resolve();
      await unregister();
      await fixture.close();
    }
  });

  await t.test('rejects typed stale after custody advances to another session', async () => {
    const fixture = makeFixture();
    try {
      const exchange = fixture.client.authExchange({
        challengeId: 'challenge-authenticated-successor',
        code: '246810',
      });
      await fixture.exchangeStarted.promise;

      await withDeadline(fixture.coordinator.transition(
        fixture.coordinator.capture(),
        {
          authority: otherAuthority,
          bearer: OTHER_BEARER,
          refreshAfterMs: Date.now() + 60_000,
        },
        'interleaved_internal_auth_refresh',
      ), 'authenticated custody advance');

      fixture.exchangeResponse.resolve(Response.json(exchangedCredential()));
      await withDeadline(assert.rejects(exchange, (error) => {
        assert.equal(error?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
        return true;
      }), 'authExchange authenticated stale-authority rejection');
      assert.deepEqual(fixture.coordinator.authority, {
        ...otherAuthority,
        isAuthenticated: true,
      });
    } finally {
      await fixture.close();
    }
  });
});
