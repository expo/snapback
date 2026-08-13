import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient } from './index.mjs';

const APP_ID = '018f0d90-7c10-7a22-8c33-445566778899';
const OLD_INCARNATION = '018f0d90-7c11-7a22-8c33-445566778899';
const NEW_INCARNATION = '018f0d90-7c12-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7c13-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7c14-7a22-8c33-445566778899';
const AUTHORITY_ID = '018f0d90-7c15-7a22-8c33-445566778899';
const STALE_BEARER = 'sbs_unrecognized_authority_stale_bearer';

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

const deploymentIdentity = Object.freeze({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP_ID,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
});

const handshake = ({ incarnation, authenticated }) => ({
  protocolVersion: 1,
  serverStartupNonce: `unrecognized-authority-${incarnation}`,
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
    authorityInstanceId: authenticated ? AUTHORITY_ID : incarnation,
    sessionGeneration: authenticated ? 1 : 0,
  },
  deploymentIdentity,
  authorizedLease: null,
});

const credential = () => ({
  tokenType: 'Bearer',
  token: STALE_BEARER,
  refreshAfter: 60_000,
  session: {
    id: SESSION_ID,
    userId: USER_ID,
    provider: 'email-code',
    createdAt: 1,
    expiresAt: 120_000,
    absoluteExpiresAt: 240_000,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY_ID,
    sessionGeneration: 1,
  },
});

const authRequired = () => Response.json({
  diagnostic: {
    code: 'SNAPBACK_AUTH_REQUIRED',
    message: 'authentication is required',
  },
}, { status: 401 });

const makeFixture = ({ bearerlessAfterReset = 'anonymous-new' } = {}) => {
  const originalFetch = globalThis.fetch;
  const storage = createMemoryAuthCustodyStorage();
  const requests = [];
  let incarnation = OLD_INCARNATION;
  let recognizesBearer = true;
  let challengeSequence = 0;

  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    const authorization = headers.get('authorization');
    requests.push({ path, authorization });
    if (path === '/auth/session') {
      if (authorization === `Bearer ${STALE_BEARER}`) {
        return recognizesBearer
          ? Response.json(handshake({ incarnation, authenticated: true }))
          : authRequired();
      }
      if (authorization !== null) return authRequired();
      if (!recognizesBearer && bearerlessAfterReset === 'refuse') return authRequired();
      const observedIncarnation = !recognizesBearer && bearerlessAfterReset === 'anonymous-same'
        ? OLD_INCARNATION
        : incarnation;
      return Response.json(handshake({
        incarnation: observedIncarnation,
        authenticated: false,
      }));
    }
    if (path === '/auth/request-code') {
      challengeSequence += 1;
      return Response.json({
        challengeId: `challenge-${challengeSequence}`,
        expiresAt: 60_000,
      });
    }
    if (path === '/auth/exchange') {
      return Response.json(credential());
    }
    if (path === '/auth/logout') {
      return new Response(null, { status: 204 });
    }
    if (path === '/health') return Response.json({ ok: true });
    throw new Error(`unexpected unrecognized-authority request: ${path}`);
  };

  const makeClient = () => {
    const coordinator = new AuthCoordinator({
      appId: APP_ID,
      storage,
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    const client = new SnapbackClient('https://unrecognized-authority.test', {
      authCoordinator: coordinator,
      authClientProtocol: 1,
      authorityDescriptorProtocol: 1,
      rqsStore: null,
      offlineQueue: false,
    });
    return { client, coordinator };
  };

  return {
    storage,
    requests,
    makeClient,
    resetServer() {
      recognizesBearer = false;
      incarnation = NEW_INCARNATION;
    },
    async signIn(client) {
      const challenge = await client.authRequestCode('person@example.com');
      await client.authExchange({ challengeId: challenge.challengeId, code: '123456' });
    },
    async close(...contexts) {
      for (const context of contexts) {
        await context.client.closeAuth();
        await context.coordinator.close();
      }
      globalThis.fetch = originalFetch;
    },
  };
};

const assertRecoveredAnonymous = (fixture) => {
  const record = fixture.storage.snapshot(APP_ID);
  assert.equal(record.phase, 'settled');
  assert.equal(record.formatVersion, 2);
  assert.equal(record.authority.kind, 'anonymous');
  assert.equal(record.authority.authorizationStreamIncarnation, NEW_INCARNATION);
  assert.equal(record.bearer, null);
  assert.equal(JSON.stringify(record).includes(STALE_BEARER), false);
};

test('cold boot recovers stale bearer custody after the server store is reset', async () => {
  const fixture = makeFixture();
  const first = fixture.makeClient();
  let restored = null;
  try {
    await fixture.signIn(first.client);
    assert.equal(fixture.storage.snapshot(APP_ID).bearer, STALE_BEARER);
    await first.client.closeAuth();
    await first.coordinator.close();

    fixture.resetServer();
    restored = fixture.makeClient();
    const challenge = await restored.client.authRequestCode('person@example.com');
    assert.equal(challenge.challengeId, 'challenge-2');
    assertRecoveredAnonymous(fixture);
    assert.deepEqual(await restored.client.health(), { ok: true });
  } finally {
    await fixture.close(...(restored === null ? [] : [restored]));
  }
});

test('health recovers a failed cold resume before making its exempt request', async () => {
  const fixture = makeFixture();
  const first = fixture.makeClient();
  let restored = null;
  try {
    await fixture.signIn(first.client);
    await first.client.closeAuth();
    await first.coordinator.close();

    fixture.resetServer();
    restored = fixture.makeClient();
    assert.deepEqual(await restored.client.health(), { ok: true });
    assertRecoveredAnonymous(fixture);
  } finally {
    await fixture.close(...(restored === null ? [] : [restored]));
  }
});

test('currentAuthorizationScope is the signed-in whoami after exchange and anonymous after recovered reset', async () => {
  const fixture = makeFixture();
  const context = fixture.makeClient();
  try {
    await fixture.signIn(context.client);
    const signedIn = await context.client.currentAuthorizationScope();
    assert.equal(signedIn.principalScope.authMode, 'sessions');
    assert.equal(signedIn.principalScope.userId, USER_ID);
    const descriptor = await context.client.currentAuthorityDescriptor();
    assert.deepEqual(descriptor, signedIn.authorityDescriptor);

    const session = await context.client.authSession();
    assert.equal(session.activeMode, 'sessions');
    assert.equal(session.authority.isAuthenticated, true);
    assert.equal(session.authority.userId, USER_ID);

    fixture.resetServer();
    const recovered = await context.client.authSession({ force: true });
    assert.equal(recovered.authority.kind, 'anonymous');
    const after = await context.client.currentAuthorizationScope();
    assert.equal(after.principalScope.userId, null);
    assert.equal(after.principalScope.authMode, 'sessions');
  } finally {
    await fixture.close(context);
  }
});

test('warm client recovers once, then anonymous request-code, logout, and health succeed', async () => {
  const fixture = makeFixture();
  const context = fixture.makeClient();
  try {
    await fixture.signIn(context.client);
    fixture.resetServer();
    const requestStart = fixture.requests.length;
    const projection = await context.client.authSession({ force: true });
    assert.equal(projection.authority.kind, 'anonymous');
    const challenge = await context.client.authRequestCode('person@example.com');
    assert.equal(challenge.challengeId, 'challenge-2');
    assertRecoveredAnonymous(fixture);
    assert.equal(await context.client.authLogout(), null);
    assert.deepEqual(await context.client.health(), { ok: true });

    const recoveryRequests = fixture.requests.slice(requestStart);
    assert.equal(
      recoveryRequests.filter((request) => (
        request.path === '/auth/session'
        && request.authorization === `Bearer ${STALE_BEARER}`
      )).length,
      1,
      'one terminal event presents the stale bearer once',
    );
  } finally {
    await fixture.close(context);
  }
});

test('a carrier refusal without a different-incarnation anonymous witness never clears custody', async (t) => {
  for (const bearerlessAfterReset of ['refuse', 'anonymous-same']) {
    await t.test(bearerlessAfterReset, async () => {
      const fixture = makeFixture({ bearerlessAfterReset });
      const context = fixture.makeClient();
      try {
        await fixture.signIn(context.client);
        fixture.resetServer();
        await assert.rejects(
          context.client.authSession({ force: true }),
          (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_REQUIRED',
        );
        const record = fixture.storage.snapshot(APP_ID);
        assert.equal(record.phase, 'settled');
        assert.equal(record.authority.kind, 'session');
        assert.equal(record.authority.authorizationStreamIncarnation, OLD_INCARNATION);
        assert.equal(record.bearer, STALE_BEARER);
      } finally {
        await fixture.close(context);
      }
    });
  }
});
