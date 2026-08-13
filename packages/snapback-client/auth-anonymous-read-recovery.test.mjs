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
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const protectedAction = Object.freeze({
  artifactKind: 'functionReference',
  name: 'privateAction',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const protectedMutation = Object.freeze({
  artifactKind: 'functionReference',
  name: 'privateMutation',
  argsContract: { kind: 'object', fields: [] },
  authRequirement: 'authenticated',
});
const legacyProtectedQuery = Object.freeze({
  artifactKind: 'functionReference',
  name: 'privateRecords',
  argsContract: { kind: 'object', fields: [] },
});

const authRequired = () => Response.json({
  diagnostic: {
    code: 'SNAPBACK_AUTH_REQUIRED',
    message: 'authentication is required',
  },
}, { status: 401 });

function makeFixture() {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let exchanged = false;
  let refuseNextAnonymousQuery = false;
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
      retryable: true,
      retryStrategy: 'after-authentication',
      effectCommitted: false,
    });
    return true;
  });
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
});
