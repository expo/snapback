// SnapbackClient + LLP 0056 AuthCoordinator network race sentinel.

import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';
import { SnapbackClient } from '../client.mjs';

const APP = 'snapback.test/coordinated-client';
const INCARNATION = '018f0d90-7b31-7a22-8c33-445566778899';
const SESSION_A = '018f0d90-7b32-7a22-8c33-445566778899';
const SESSION_B = '018f0d90-7b33-7a22-8c33-445566778899';
const USER_A = '018f0d90-7b34-7a22-8c33-445566778899';
const USER_B = '018f0d90-7b35-7a22-8c33-445566778899';

const anonymous = {
  kind: 'anonymous',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
};
const sessionA = {
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId: SESSION_A,
  userId: USER_A,
};
const sessionB = {
  kind: 'session',
  authMode: 'sessions',
  authorizationStreamIncarnation: INCARNATION,
  sessionId: SESSION_B,
  userId: USER_B,
};

const handshake = (authority = anonymous) => ({
  protocolVersion: 1,
  serverStartupNonce: 'coordinator-client-test',
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  authorizationStreamIncarnation: INCARNATION,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: null,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: false, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: null,
    },
    queuedReplay: { available: false, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: authority.kind === 'session'
    ? { userId: authority.userId, sessionId: authority.sessionId, isAuthenticated: true }
    : { userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authority.kind === 'session' ? authority.sessionId : INCARNATION,
    sessionGeneration: authority.kind === 'session' ? 1 : 0,
  },
});

const credential = (token, authority, refreshAfter = 20_000) => ({
  tokenType: 'Bearer',
  token,
  refreshAfter,
  session: {
    id: authority.sessionId,
    userId: authority.userId,
    provider: 'email-code',
    createdAt: 1,
    expiresAt: 2,
    absoluteExpiresAt: 3,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authority.sessionId,
    sessionGeneration: 1,
  },
});

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const diagnosticResponse = (code, status = 401) => response({
  diagnostic: { code, message: code },
}, status);

const authorization = (init) => init?.headers?.authorization ?? null;
const pathOf = (url) => new URL(url).pathname;

const originalFetch = globalThis.fetch;
const custodyState = { custody: {} };
const storage = createMemoryAuthCustodyStorage({ state: custodyState });
const coordinator = new AuthCoordinator({
  appId: APP,
  storage,
  broadcastChannelFactory: null,
  hintStorage: null,
});
const db = new SnapbackClient('http://stub', { authCoordinator: coordinator });
const surfaceResumeWitnesses = [];
const unregisterSurfaceProbe = db.registerAuthBarrierParticipant({
  name: 'test-contract-surface',
  async quiesce() {},
  blank() {},
  clearMemory() {},
  async commitDurable() {},
  async resume() {
    surfaceResumeWitnesses.push(calls.at(-1)?.path ?? null);
  },
});

let bearerAuthority = new Map([
  ['bearer-a', sessionA],
  ['bearer-b', sessionB],
  ['bearer-c', sessionB],
]);
let calls = [];
let queryMode = 'success';
let supersededHook = null;
let delayedQueryResolve = null;
let delayedQueryStartedResolve = null;
let delayedQueryStarted = null;
let delayedQueryResponse = null;

const prepareDelayedQuery = () => {
  delayedQueryStarted = new Promise((resolve) => { delayedQueryStartedResolve = resolve; });
  delayedQueryResponse = new Promise((resolve) => { delayedQueryResolve = resolve; });
};

globalThis.fetch = async (url, init = {}) => {
  const path = pathOf(url);
  const bearer = authorization(init)?.replace(/^Bearer /, '') ?? null;
  calls.push({ path, bearer, body: init.body ? JSON.parse(init.body) : null });
  if (path === '/auth/session') {
    return response(handshake(bearer ? bearerAuthority.get(bearer) : anonymous));
  }
  if (path === '/auth/exchange') return response(credential('bearer-a', sessionA, 10_000));
  if (path === '/auth/refresh') return response(credential('bearer-c', sessionA, 30_000));
  if (path === '/auth/logout') return response({ revoked: true });
  if (path === '/auth/family-alarm') return response({ accepted: true });
  if (path === '/query/list') {
    if (queryMode === 'delayed') {
      delayedQueryStartedResolve();
      return delayedQueryResponse;
    }
    if (queryMode === 'superseded') {
      queryMode = 'success';
      await supersededHook?.();
      return diagnosticResponse('SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED');
    }
    return response({ rows: [{ bearer }] });
  }
  throw new Error(`unexpected path ${path}`);
};

try {
  // Fresh custody is invented only after an anonymous server handshake.
  const initial = await db.query('list');
  assert.deepEqual(initial.rows, [{ bearer: null }]);
  assert.equal(coordinator.capture().authorityEpoch, 0);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/session', '/query/list']);

  // Exchange installs token custody and runs transport resume before exposing
  // the session projection. The token never appears in the returned object.
  calls = [];
  const exchanged = await db.authExchange({ challengeId: 'challenge-1', code: '123456' });
  assert.equal(Object.hasOwn(exchanged, 'token'), false);
  assert.equal(exchanged.session.id, SESSION_A);
  assert.equal(coordinator.capture().authorityEpoch, 1);
  assert.equal(coordinator.settledView().bearer, 'bearer-a');
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/exchange', '/auth/session']);
  assert.equal(surfaceResumeWitnesses.at(-1), '/auth/session');

  calls = [];
  const authenticated = await db.query('list', { userId: 'forged' });
  assert.deepEqual(authenticated.rows, [{ bearer: 'bearer-a' }]);
  assert.equal(calls[0].bearer, 'bearer-a');
  assert.equal(Object.hasOwn(calls[0].body, 'auth'), false);

  // A delayed success under A cannot publish after B settles. The network
  // promise deliberately ignores AbortSignal to prove the final capture gate.
  calls = [];
  queryMode = 'delayed';
  prepareDelayedQuery();
  const delayedSuccess = db.query('list');
  await delayedQueryStarted;
  const captureA = coordinator.capture();
  await coordinator.transition(captureA, {
    authority: sessionB,
    bearer: 'bearer-b',
    refreshAfterMs: 20_000,
  }, 'test_switch_to_b');
  delayedQueryResolve(response({ rows: [{ leaked: 'a' }] }));
  await assert.rejects(delayedSuccess, (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(coordinator.settledView().authority.sessionId, SESSION_B);

  // A delayed terminal failure has no power to clear B either.
  queryMode = 'delayed';
  prepareDelayedQuery();
  const delayedTerminal = db.query('list');
  await delayedQueryStarted;
  const captureB = coordinator.capture();
  await coordinator.transition(captureB, {
    authority: sessionA,
    bearer: 'bearer-a',
    refreshAfterMs: 10_000,
  }, 'test_switch_back_to_a');
  delayedQueryResolve(diagnosticResponse('SNAPBACK_AUTH_SESSION_EXPIRED'));
  await assert.rejects(delayedTerminal, (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(coordinator.settledView().authority.sessionId, SESSION_A);
  bearerAuthority.set('bearer-b', sessionA);
  bearerAuthority.set('bearer-c', sessionA);

  // A peer rotation during a request leaves the authority epoch intact. The
  // superseded response waits for the new custody revision and retries once.
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await peer.synchronize();
  const beforeRotation = peer.capture();
  supersededHook = () => peer.compareAndRotateBearer(beforeRotation, {
      bearer: 'bearer-b',
      refreshAfterMs: 20_000,
    });
  queryMode = 'superseded';
  calls = [];
  const retried = await db.query('list');
  assert.deepEqual(retried.rows, [{ bearer: 'bearer-b' }]);
  assert.equal(coordinator.capture().authorityEpoch, beforeRotation.authorityEpoch);
  assert(calls.some(({ path, bearer }) => path === '/query/list' && bearer === 'bearer-b'));
  supersededHook = null;
  await peer.close();

  // Refresh is serialized under custody ownership and only exposes the
  // non-secret projection after the exact revision replacement.
  calls = [];
  const refreshed = await db.authRefresh();
  assert.equal(Object.hasOwn(refreshed, 'token'), false);
  assert.equal(coordinator.settledView().bearer, 'bearer-c');
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/refresh']);

  // Logout completes the server revocation before the delete barrier and
  // returns only after anonymous custody has settled and re-handshaken.
  calls = [];
  const loggedOut = await db.authLogout();
  assert.equal(loggedOut.revoked, true);
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(coordinator.settledView().bearer, null);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/session', '/auth/logout', '/auth/session']);
} finally {
  globalThis.fetch = originalFetch;
  await unregisterSurfaceProbe();
  await db.closeAuth();
  await coordinator.close();
}

console.log('coordinated SnapbackClient auth races: ok');
