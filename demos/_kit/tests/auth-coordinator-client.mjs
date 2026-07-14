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
const BEARER_A = 'sbs_CLIENT_BEARER_A_SECRET_SENTINEL_MUST_NOT_ESCAPE';
const BEARER_B = 'sbs_CLIENT_BEARER_B_SECRET_SENTINEL_MUST_NOT_ESCAPE';
const BEARER_C = 'sbs_CLIENT_BEARER_C_SECRET_SENTINEL_MUST_NOT_ESCAPE';
const ADMIN_SECRET = 'sba_CLIENT_ADMIN_SECRET_SENTINEL_MUST_NOT_ESCAPE';
const CHALLENGE_ID = 'sbc_CLIENT_CHALLENGE_SECRET_SENTINEL_MUST_NOT_ESCAPE';
const LOGIN_CODE = '123456';
const CLIENT_SECRETS = [
  BEARER_A,
  BEARER_B,
  BEARER_C,
  ADMIN_SECRET,
  CHALLENGE_ID,
  LOGIN_CODE,
];

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
const emptyResponse = (status = 204) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => '',
});
const rawResponse = (body, status = 204) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => String(body),
});

const diagnosticResponse = (code, status = 401, { message = code, details = {} } = {}) => response({
  diagnostic: { code, message, details },
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
const db = new SnapbackClient('http://stub', {
  authCoordinator: coordinator,
  adminToken: ADMIN_SECRET,
});
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
  [BEARER_A, sessionA],
  [BEARER_B, sessionB],
  [BEARER_C, sessionB],
]);
let calls = [];
const rawUrls = [];
let queryMode = 'success';
let credentialPoison = null;
let refreshPoison = null;
let logoutMode = 'empty';
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
  rawUrls.push(String(url));
  const path = pathOf(url);
  const bearer = authorization(init)?.replace(/^Bearer /, '') ?? null;
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ path, bearer, body });
  if (path === '/auth/session') {
    return response(handshake(bearer ? bearerAuthority.get(bearer) : anonymous));
  }
  if (path === '/auth/exchange') {
    const issued = credential(BEARER_A, sessionA, 10_000);
    if (credentialPoison === 'root') issued.leakedBearer = BEARER_A;
    if (credentialPoison === 'nested') issued.session.leakedBearer = BEARER_A;
    if (credentialPoison === 'issued-token') issued.session.provider = issued.token;
    if (credentialPoison === 'challenge-id') issued.session.provider = body.challengeId;
    if (credentialPoison === 'login-code-string') issued.session.provider = body.code;
    if (credentialPoison === 'login-code-number') issued.session.createdAt = Number(body.code);
    return response(issued);
  }
  if (path === '/auth/refresh') {
    const issued = credential(BEARER_C, sessionA, 30_000);
    if (refreshPoison === 'predecessor') issued.session.provider = bearer;
    if (refreshPoison === 'successor') issued.session.provider = issued.token;
    return response(issued);
  }
  if (path === '/auth/logout') {
    if (logoutMode === 'wrong-status') return emptyResponse(200);
    if (logoutMode === 'reflected-body') {
      return rawResponse(JSON.stringify({ revoked: true, reflectedBearer: bearer }), 204);
    }
    return emptyResponse(204);
  }
  if (path === '/auth/family-alarm') return response({ accepted: true });
  if (path === '/_snapback/api/schema/load') {
    return diagnosticResponse('SNAPBACK_TEST_ADMIN_ECHO', 500, {
      message: `server echoed ${ADMIN_SECRET}`,
      details: { adminToken: ADMIN_SECRET },
    });
  }
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
    if (queryMode === 'echo-secret-error') {
      queryMode = 'success';
      return diagnosticResponse('SNAPBACK_TEST_BEARER_ECHO', 500, {
        message: `server echoed ${bearer}`,
        details: { bearer },
      });
    }
    if (queryMode === 'throw-secret-error') {
      queryMode = 'success';
      const error = new Error(`adapter echoed ${bearer}`);
      error.name = `Adapter${bearer}`;
      error.code = `E_${bearer}`;
      throw error;
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

  // A 200 response remains untrusted: root/nested extensions and allowed
  // public fields reflecting the successor, challenge id, or login code are
  // rejected before token custody advances. Numeric fields are included so a
  // six-digit code cannot hide in an otherwise valid timestamp.
  for (credentialPoison of [
    'root',
    'nested',
    'issued-token',
    'challenge-id',
    'login-code-string',
    'login-code-number',
  ]) {
    let poisonError;
    await assert.rejects(
      db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE }),
      (error) => {
        poisonError = error;
        return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
      },
    );
    assert.equal(coordinator.capture().authorityEpoch, 0);
    assert.equal(storage.snapshot(APP).bearer, null);
    assert.equal(JSON.stringify({
      message: poisonError.message,
      diagnostic: poisonError.diagnostic,
    }).includes(BEARER_A), false);
  }
  credentialPoison = null;

  // Exchange installs token custody and runs transport resume before exposing
  // the session projection. The token never appears in the returned object.
  calls = [];
  const exchanged = await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  assert.equal(Object.hasOwn(exchanged, 'token'), false);
  assert.equal(exchanged.session.id, SESSION_A);
  assert.equal(coordinator.capture().authorityEpoch, 1);
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.equal(storage.snapshot(APP).bearer, BEARER_A);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/exchange', '/auth/session']);
  assert.equal(surfaceResumeWitnesses.at(-1), '/auth/session');

  calls = [];
  const authenticated = await db.query('list', { userId: 'forged' });
  assert.deepEqual(authenticated.rows, [{ bearer: BEARER_A }]);
  assert.equal(calls[0].bearer, BEARER_A);
  assert.equal(Object.hasOwn(calls[0].body, 'auth'), false);

  // A hostile/misconfigured receiver cannot make a request credential escape
  // through the client error object. Diagnostic codes remain actionable.
  queryMode = 'echo-secret-error';
  let bearerError;
  await assert.rejects(db.query('list'), (error) => {
    bearerError = error;
    return error?.diagnostic?.code === 'SNAPBACK_TEST_BEARER_ECHO';
  });
  assert.equal(JSON.stringify({
    message: bearerError.message,
    diagnostic: bearerError.diagnostic,
  }).includes(BEARER_A), false);

  queryMode = 'throw-secret-error';
  let transportError;
  await assert.rejects(db.query('list'), (error) => {
    transportError = error;
    return true;
  });
  assert.equal(JSON.stringify({
    name: transportError.name,
    message: transportError.message,
    code: transportError.code,
  }).includes(BEARER_A), false);

  let adminError;
  await assert.rejects(db.loadSchema({}), (error) => {
    adminError = error;
    return error?.diagnostic?.code === 'SNAPBACK_TEST_ADMIN_ECHO';
  });
  assert.equal(JSON.stringify({
    message: adminError.message,
    diagnostic: adminError.diagnostic,
  }).includes(ADMIN_SECRET), false);

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
    bearer: BEARER_B,
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
    bearer: BEARER_A,
    refreshAfterMs: 10_000,
  }, 'test_switch_back_to_a');
  delayedQueryResolve(diagnosticResponse('SNAPBACK_AUTH_SESSION_EXPIRED'));
  await assert.rejects(delayedTerminal, (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE');
  assert.equal(coordinator.settledView().authority.sessionId, SESSION_A);
  bearerAuthority.set(BEARER_B, sessionA);
  bearerAuthority.set(BEARER_C, sessionA);

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
      bearer: BEARER_B,
      refreshAfterMs: 20_000,
    });
  queryMode = 'superseded';
  calls = [];
  const retried = await db.query('list');
  assert.deepEqual(retried.rows, [{ bearer: BEARER_B }]);
  assert.equal(coordinator.capture().authorityEpoch, beforeRotation.authorityEpoch);
  assert(calls.some(({ path, bearer }) => path === '/query/list' && bearer === BEARER_B));
  supersededHook = null;
  await peer.close();

  // Refresh refuses both predecessor and successor reflection through allowed
  // public fields without advancing custody or its no-lost-update revision.
  for (refreshPoison of ['predecessor', 'successor']) {
    const beforePoison = storage.snapshot(APP);
    let poisonError;
    await assert.rejects(db.authRefresh(), (error) => {
      poisonError = error;
      return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    });
    assert.equal(storage.snapshot(APP).bearer, BEARER_B);
    assert.equal(storage.snapshot(APP).revision, beforePoison.revision);
    assert.equal(JSON.stringify({
      message: poisonError.message,
      diagnostic: poisonError.diagnostic,
    }).includes(BEARER_B), false);
    assert.equal(JSON.stringify({
      message: poisonError.message,
      diagnostic: poisonError.diagnostic,
    }).includes(BEARER_C), false);
  }
  refreshPoison = null;

  // Refresh is serialized under custody ownership and only exposes the
  // non-secret projection after the exact revision replacement.
  calls = [];
  const refreshed = await db.authRefresh();
  assert.equal(Object.hasOwn(refreshed, 'token'), false);
  assert.equal(storage.snapshot(APP).bearer, BEARER_C);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/refresh']);

  // A malformed successful logout may already have committed server-side. A
  // wrong status and a nonempty reflected body independently clear only the
  // captured authority, expose no body, and return a fixed protocol error.
  calls = [];
  logoutMode = 'wrong-status';
  let wrongStatusLogoutError;
  await assert.rejects(db.authLogout(), (error) => {
    wrongStatusLogoutError = error;
    return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  });
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.equal(JSON.stringify({
    message: wrongStatusLogoutError.message,
    diagnostic: wrongStatusLogoutError.diagnostic,
  }).includes(BEARER_C), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/session', '/auth/logout', '/auth/session']);

  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  logoutMode = 'reflected-body';
  let reflectedLogoutError;
  await assert.rejects(db.authLogout(), (error) => {
    reflectedLogoutError = error;
    return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  });
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.equal(JSON.stringify({
    message: reflectedLogoutError.message,
    diagnostic: reflectedLogoutError.diagnostic,
  }).includes(BEARER_A), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/logout', '/auth/session']);

  // Recover a session, then require exact empty 204 and expose fixed null.
  logoutMode = 'empty';
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  const loggedOut = await db.authLogout();
  assert.equal(loggedOut, null);
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/logout', '/auth/session']);

  // The item-5 client-secret sentinel covers every ordinary app-visible auth
  // result/error and every requested URL. Authorization headers and the
  // documented transactional custody record are the deliberate v1 carriers.
  for (const value of [
    exchanged,
    refreshed,
    loggedOut,
    wrongStatusLogoutError,
    reflectedLogoutError,
    bearerError,
    transportError,
    adminError,
    rawUrls,
  ]) {
    const observable = value instanceof Error
      ? { message: value.message, diagnostic: value.diagnostic, receipt: value.receipt }
      : value;
    const bytes = JSON.stringify(observable);
    for (const secret of CLIENT_SECRETS) {
      assert.equal(bytes.includes(secret), false, `client secret escaped: ${secret}`);
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  await unregisterSurfaceProbe();
  await db.closeAuth();
  await coordinator.close();
}

console.log('coordinated SnapbackClient auth races: ok');
