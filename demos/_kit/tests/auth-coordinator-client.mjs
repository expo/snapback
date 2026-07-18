// SnapbackClient + LLP 0059 AuthCoordinator network race sentinel.

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
const READ_FAILURE_SECRET = 'logout_BODY_READER_SECRET_MUST_NOT_ESCAPE';
const UNKNOWN_ISSUED = 'sbs_UNKNOWN_NON_2XX_ISSUED_SECRET_MUST_NOT_ESCAPE';
const UNKNOWN_FETCH_REJECTION = 'sbs_UNKNOWN_FETCH_REJECTION_SECRET_MUST_NOT_ESCAPE';
const CLIENT_SECRETS = [
  BEARER_A,
  BEARER_B,
  BEARER_C,
  ADMIN_SECRET,
  CHALLENGE_ID,
  LOGIN_CODE,
  READ_FAILURE_SECRET,
  UNKNOWN_ISSUED,
  UNKNOWN_FETCH_REJECTION,
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
    ? {
        kind: 'humanSession',
        userId: authority.userId,
        sessionId: authority.sessionId,
        isAuthenticated: true,
      }
    : { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authority.kind === 'session' ? authority.sessionId : INCARNATION,
    sessionGeneration: authority.kind === 'session' ? 1 : 0,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: APP,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
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

// Wrap the transactional owner rather than rejecting withOwnership itself, so
// a failure can target the production #confirmDurableExact owner.read after
// resume has completed and staged the transport cache publication.
const finalOwnerReadFailureSeam = (baseStorage, code) => {
  let readCount = 0;
  let delegatedReadCount = 0;
  let armed = null;
  let failure = null;
  return {
    storage: {
      ...baseStorage,
      async withOwnership(appId, operation) {
        return baseStorage.withOwnership(appId, (owner) => operation({
          ...owner,
          async read() {
            readCount += 1;
            if (armed !== null) {
              failure = {
                phase: armed.phase,
                armedAtReadCount: armed.readCount,
                failureReadCount: readCount,
                delegatedReadCount,
              };
              armed = null;
              throw Object.assign(new Error(`${code}: injected final owner.read failure`), {
                code,
              });
            }
            const value = await owner.read();
            delegatedReadCount += 1;
            return value;
          },
        }));
      },
    },
    arm(phase) {
      if (armed !== null || failure !== null) throw new Error('final owner.read failure seam reused');
      armed = { phase, readCount };
    },
    witness() {
      return failure === null ? null : { ...failure };
    },
  };
};
const poisonedReadResponse = (secret) => ({
  ok: true,
  status: 200,
  async text() {
    throw new Error(`body reader exposed ${secret}`);
  },
});

const diagnosticResponse = (code, status = 401, { message = code, details = {} } = {}) => response({
  diagnostic: { code, message, details },
}, status);
const poisonedIssuerFailure = () => diagnosticResponse('UPSTREAM_ISSUER_FAILURE', 503, {
  message: `issuer failed after creating ${UNKNOWN_ISSUED}`,
  details: {
    successorCredential: UNKNOWN_ISSUED,
    [`credential_${UNKNOWN_ISSUED}`]: 'property-name poison',
  },
});
const poisonedIssuerRejection = () => {
  const cause = new Error(`cause ${UNKNOWN_FETCH_REJECTION}`);
  cause.code = `CAUSE_${UNKNOWN_FETCH_REJECTION}`;
  const error = new Error(`fetch rejected after issuing ${UNKNOWN_FETCH_REJECTION}`, { cause });
  error.name = `Issuer${UNKNOWN_FETCH_REJECTION}`;
  error.code = `ISSUER_${UNKNOWN_FETCH_REJECTION}`;
  error.diagnostic = {
    code: `DIAGNOSTIC_${UNKNOWN_FETCH_REJECTION}`,
    message: UNKNOWN_FETCH_REJECTION,
    details: { successorCredential: UNKNOWN_FETCH_REJECTION },
  };
  error[`credential_${UNKNOWN_FETCH_REJECTION}`] = UNKNOWN_FETCH_REJECTION;
  throw error;
};

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
let issuingFailure = null;
let exchangeErrorReflection = false;
let exchangeTypedFailure = null;
let refreshPoison = null;
let logoutMode = 'empty';
let logoutReadFailureHook = null;
let logoutTerminalHook = null;
let supersededHook = null;
let delayedQueryResolve = null;
let delayedQueryStartedResolve = null;
let delayedQueryStarted = null;
let delayedQueryResponse = null;
let staleLogoutPeer = null;
const familyAlarmCustodyWitnesses = [];

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
  if (path === '/auth/request-code') {
    if (issuingFailure === 'request-code-fetch') return poisonedIssuerRejection();
    if (issuingFailure === 'request-code-read') return poisonedReadResponse(BEARER_A);
    if (issuingFailure === 'request-code-non2xx') return poisonedIssuerFailure();
    if (issuingFailure === 'request-code-near-miss') {
      return response({
        diagnostic: {
          code: 'SNAPBACK_AUTH_CODE_INVALID',
          message: UNKNOWN_FETCH_REJECTION,
        },
        receipt: { credential: UNKNOWN_FETCH_REJECTION },
      }, 401);
    }
    const challenge = { challengeId: CHALLENGE_ID, expiresAt: 10_000 };
    if (issuingFailure === 'request-code-extra') challenge.leakedBearer = BEARER_A;
    return response(challenge);
  }
  if (path === '/auth/exchange') {
    if (issuingFailure === 'exchange-fetch') return poisonedIssuerRejection();
    if (issuingFailure === 'exchange-read') return poisonedReadResponse(BEARER_A);
    if (issuingFailure === 'exchange-non2xx') return poisonedIssuerFailure();
    if (exchangeErrorReflection) {
      return diagnosticResponse('SNAPBACK_AUTH_CHALLENGE_INVALID', 400, {
        message: 'login code rejected',
        details: {
          attemptedCode: Number(body.code),
          attempts: [Number(body.code)],
        },
      });
    }
    if (exchangeTypedFailure) {
      const [code, status] = exchangeTypedFailure;
      return response({
        diagnostic: {
          code,
          message: `hostile issuer text ${UNKNOWN_ISSUED} ${body.code}`,
          details: {
            successorCredential: UNKNOWN_ISSUED,
            attemptedCode: Number(body.code),
            [`credential_${UNKNOWN_ISSUED}`]: 'property-name poison',
          },
        },
        receipt: {
          successorCredential: UNKNOWN_ISSUED,
          [`receipt_${UNKNOWN_ISSUED}`]: UNKNOWN_ISSUED,
        },
      }, status);
    }
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
    if (issuingFailure === 'refresh-fetch') return poisonedIssuerRejection();
    if (issuingFailure === 'refresh-read') return poisonedReadResponse(BEARER_C);
    if (issuingFailure === 'refresh-non2xx') return poisonedIssuerFailure();
    if (issuingFailure === 'refresh-superseded') {
      return response({
        diagnostic: {
          code: 'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
          message: `hostile refresh text ${UNKNOWN_ISSUED} ${bearer}`,
          details: {
            successorCredential: UNKNOWN_ISSUED,
            [`credential_${UNKNOWN_ISSUED}`]: bearer,
          },
        },
        receipt: { successorCredential: UNKNOWN_ISSUED },
      }, 409);
    }
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
    if (logoutMode === 'read-failure') {
      return {
        ok: true,
        status: 204,
        async text() {
          await logoutReadFailureHook?.();
          const error = new Error(`body reader exposed ${READ_FAILURE_SECRET} and ${bearer}`);
          error.name = `BodyReader${bearer}`;
          error.code = `READ_${READ_FAILURE_SECRET}`;
          error.diagnostic = {
            message: READ_FAILURE_SECRET,
            [`reflected_${bearer}`]: bearer,
          };
          throw error;
        },
      };
    }
    if (logoutMode === 'terminal-during-read') {
      return {
        ok: true,
        status: 204,
        async text() {
          await logoutTerminalHook?.();
          return '';
        },
      };
    }
    return emptyResponse(204);
  }
  if (path === '/auth/family-alarm') {
    familyAlarmCustodyWitnesses.push(storage.snapshot(APP).bearer);
    return response({ accepted: true });
  }
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

  // Issuing paths never surface unknown response bytes or reader exceptions.
  for (issuingFailure of [
    'request-code-fetch',
    'request-code-read',
    'request-code-extra',
    'request-code-non2xx',
  ]) {
    let issueError;
    await assert.rejects(db.authRequestCode('person@example.com'), (error) => {
      issueError = error;
      return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    });
    assert.deepEqual(issueError.diagnostic, {
      code: 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
      message: 'auth provider returned an invalid credential response',
    });
    assert.equal(
      issueError.message,
      'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID: auth provider returned an invalid credential response',
    );
    assert.equal(JSON.stringify(issueError).includes(BEARER_A), false);
    assert.equal(JSON.stringify(issueError).includes(UNKNOWN_ISSUED), false);
    assert.equal(JSON.stringify({
      name: issueError.name,
      message: issueError.message,
      code: issueError.code,
      diagnostic: issueError.diagnostic,
      cause: issueError.cause,
      keys: Object.keys(issueError),
    }).includes(UNKNOWN_FETCH_REJECTION), false);
    assert.equal(Object.hasOwn(issueError, 'cause'), false);
    assert.equal(Object.hasOwn(issueError, 'receipt'), false);
  }
  for (issuingFailure of ['exchange-fetch', 'exchange-read', 'exchange-non2xx']) {
    let exchangeReadError;
    await assert.rejects(
      db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE }),
      (error) => {
        exchangeReadError = error;
        return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
      },
    );
    assert.equal(JSON.stringify(exchangeReadError).includes(BEARER_A), false);
    assert.equal(JSON.stringify(exchangeReadError).includes(UNKNOWN_ISSUED), false);
    assert.equal(JSON.stringify({
      name: exchangeReadError.name,
      message: exchangeReadError.message,
      code: exchangeReadError.code,
      diagnostic: exchangeReadError.diagnostic,
      cause: exchangeReadError.cause,
      keys: Object.keys(exchangeReadError),
    }).includes(UNKNOWN_FETCH_REJECTION), false);
    assert.equal(Object.hasOwn(exchangeReadError, 'cause'), false);
    assert.equal(Object.hasOwn(exchangeReadError, 'receipt'), false);
  }
  issuingFailure = null;

  // An allowlisted code on the wrong route remains opaque and cannot smuggle
  // response-controlled receipt bytes through the issuer boundary.
  issuingFailure = 'request-code-near-miss';
  let wrongRouteError;
  await assert.rejects(db.authRequestCode('person@example.com'), (error) => {
    wrongRouteError = error;
    return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  });
  assert.equal(Object.hasOwn(wrongRouteError, 'receipt'), false);
  assert.equal(JSON.stringify(wrongRouteError).includes(UNKNOWN_FETCH_REJECTION), false);
  issuingFailure = null;

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

  // Even an expected exchange refusal is response-controlled at a credential
  // issuer boundary. It is replaced by the same stable local error rather
  // than selectively redacted and forwarded.
  exchangeErrorReflection = true;
  let numericCodeError;
  await assert.rejects(
    db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE }),
    (error) => {
      numericCodeError = error;
      return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    },
  );
  assert.equal(coordinator.capture().authorityEpoch, 0);
  assert.equal(JSON.stringify({
    message: numericCodeError.message,
    diagnostic: numericCodeError.diagnostic,
  }).includes(LOGIN_CODE), false, 'numeric login-code reflection escaped');
  assert.deepEqual(numericCodeError.diagnostic, {
    code: 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID',
    message: 'auth provider returned an invalid credential response',
  });
  exchangeErrorReflection = false;

  // LLP 0057 deliberately exposes only these two exchange outcomes. Exact
  // route/status/code tuples reconstruct fixed local guidance while hostile
  // response-controlled text, details, property names, and fresh credentials
  // remain opaque.
  for (const [code, status, message] of [
    ['SNAPBACK_AUTH_CODE_INVALID', 401, 'the login code is invalid; request a new challenge'],
    ['SNAPBACK_AUTH_CODE_LOCKED', 403, 'the login challenge is locked; request a new challenge'],
  ]) {
    exchangeTypedFailure = [code, status];
    let typedError;
    await assert.rejects(
      db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE }),
      (error) => {
        typedError = error;
        return error?.diagnostic?.code === code && error?.status === status;
      },
    );
    assert.deepEqual(typedError.diagnostic, { code, message });
    const bytes = JSON.stringify({
      message: typedError.message,
      diagnostic: typedError.diagnostic,
      status: typedError.status,
    });
    assert.equal(bytes.includes(LOGIN_CODE), false);
    assert.equal(bytes.includes(UNKNOWN_ISSUED), false);
    assert.equal(Object.hasOwn(typedError, 'receipt'), false);
    assert.equal(storage.snapshot(APP).bearer, null);
  }
  exchangeTypedFailure = null;

  // Exact allowlisted code on the wrong status is not a typed recovery tuple.
  exchangeTypedFailure = ['SNAPBACK_AUTH_CODE_INVALID', 403];
  let wrongStatusError;
  await assert.rejects(
    db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE }),
    (error) => {
      wrongStatusError = error;
      return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    },
  );
  assert.equal(Object.hasOwn(wrongStatusError, 'receipt'), false);
  assert.equal(JSON.stringify(wrongStatusError).includes(UNKNOWN_ISSUED), false);
  exchangeTypedFailure = null;

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
  const resumeHandshakeCallCount = calls.length;
  const cachedAfterResume = await db.authSession();
  assert.equal(cachedAfterResume.authority.sessionId, SESSION_A);
  assert.equal(
    calls.length,
    resumeHandshakeCallCount,
    'successful resume publishes its staged handshake cache at final confirmation',
  );

  calls = [];
  const authenticated = await db.query('list', { userId: 'forged' });
  assert.deepEqual(authenticated.rows, [{ bearer: BEARER_A }]);
  const authenticatedQueryCall = calls.find(({ path }) => path === '/query/list');
  assert.equal(authenticatedQueryCall.bearer, BEARER_A);
  assert.equal(Object.hasOwn(authenticatedQueryCall.body, 'auth'), false);

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

  for (issuingFailure of ['refresh-fetch', 'refresh-read', 'refresh-non2xx']) {
    let refreshReadError;
    await assert.rejects(db.authRefresh(), (error) => {
      refreshReadError = error;
      return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
    });
    assert.equal(JSON.stringify(refreshReadError).includes(BEARER_C), false);
    assert.equal(JSON.stringify(refreshReadError).includes(UNKNOWN_ISSUED), false);
    assert.equal(JSON.stringify({
      name: refreshReadError.name,
      message: refreshReadError.message,
      code: refreshReadError.code,
      diagnostic: refreshReadError.diagnostic,
      cause: refreshReadError.cause,
      keys: Object.keys(refreshReadError),
    }).includes(UNKNOWN_FETCH_REJECTION), false);
    assert.equal(Object.hasOwn(refreshReadError, 'cause'), false);
    assert.equal(Object.hasOwn(refreshReadError, 'receipt'), false);
    assert.equal(storage.snapshot(APP).bearer, BEARER_B);
  }
  issuingFailure = null;

  // The exact refresh 409 is reconstructed locally so the LLP 0059 recovery
  // branch remains reachable. Let the production bounded wait expire; family
  // alarm must observe predecessor custody before compare-clear, and no
  // response-controlled diagnostic bytes may escape.
  calls = [];
  issuingFailure = 'refresh-superseded';
  let supersededRefreshError;
  await assert.rejects(db.authRefresh(), (error) => {
    supersededRefreshError = error;
    return error?.diagnostic?.code === 'SNAPBACK_AUTH_REFRESH_SUPERSEDED'
      && error?.status === 409;
  });
  issuingFailure = null;
  assert.deepEqual(supersededRefreshError.diagnostic, {
    code: 'SNAPBACK_AUTH_REFRESH_SUPERSEDED',
    message: 'the session refresh was superseded',
  });
  assert.equal(JSON.stringify({
    message: supersededRefreshError.message,
    diagnostic: supersededRefreshError.diagnostic,
  }).includes(UNKNOWN_ISSUED), false);
  assert.equal(JSON.stringify(supersededRefreshError.diagnostic).includes(BEARER_B), false);
  assert.equal(Object.hasOwn(supersededRefreshError, 'receipt'), false);
  assert.equal(Object.hasOwn(supersededRefreshError, 'cause'), false);
  assert.equal(familyAlarmCustodyWitnesses.at(-1), BEARER_B);
  assert.equal(storage.snapshot(APP).bearer, null);
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  const refreshCall = calls.findIndex(({ path }) => path === '/auth/refresh');
  const alarmCall = calls.findIndex(({ path }) => path === '/auth/family-alarm');
  assert(refreshCall >= 0 && alarmCall > refreshCall);

  // Restore session custody for the ordinary successful-rotation proof.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });

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

  // The logout request owns its response through the same-session terminal
  // cut. A live socket can observe revocation and synchronously blank every
  // predecessor surface, but it must not abort the logout response that caused
  // that terminal event.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  logoutMode = 'terminal-during-read';
  const logoutCapture = coordinator.capture();
  logoutTerminalHook = async () => {
    const error = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session logged out');
    error.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
    error.diagnostic = { code: error.code, message: 'session logged out' };
    error.authorityDisposition = 'durableDelete';
    db.handleTerminalAuthLoss(logoutCapture, error);
    await coordinator.compareAndClear(logoutCapture, 'logout_live_terminal');
  };
  assert.equal(await db.authLogout(), null);
  logoutTerminalHook = null;
  logoutMode = 'empty';
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/logout', '/auth/session']);

  // A completed peer clear can force logout through its durable confirmation
  // path. Fatal custody diagnostics from that path must remain exact: mapping
  // corruption, exhaustion, or lock/read failures to ordinary stale authority
  // would erase the evidence callers need to fail closed and repair custody.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  logoutMode = 'terminal-during-read';
  const fatalConfirmationCapture = coordinator.capture();
  const fatalConfirmationError = new Error(
    'TEST_LOGOUT_CONFIRMATION_FATAL: exact custody evidence',
  );
  fatalConfirmationError.code = 'TEST_LOGOUT_CONFIRMATION_FATAL';
  fatalConfirmationError.diagnostic = {
    code: fatalConfirmationError.code,
    message: 'exact custody evidence',
  };
  logoutTerminalHook = async () => {
    await coordinator.compareAndClear(
      fatalConfirmationCapture,
      'logout_confirmation_fatal_fixture',
    );
    coordinator.synchronize = async () => { throw fatalConfirmationError; };
  };
  try {
    await assert.rejects(
      db.authLogout(),
      (error) => error === fatalConfirmationError,
    );
  } finally {
    delete coordinator.synchronize;
    logoutTerminalHook = null;
    logoutMode = 'empty';
  }
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);

  // A missed peer wakeup can leave the local view anonymous after the terminal
  // cut while durable custody has already advanced again to session B. Logout
  // must re-read under ownership rather than accepting that stale local view.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  logoutMode = 'terminal-during-read';
  const supersededLogoutCapture = coordinator.capture();
  logoutTerminalHook = async () => {
    const error = new Error('SNAPBACK_AUTH_SESSION_REVOKED: predecessor logged out');
    error.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
    error.diagnostic = { code: error.code, message: 'predecessor logged out' };
    error.authorityDisposition = 'durableDelete';
    db.handleTerminalAuthLoss(supersededLogoutCapture, error);
    await coordinator.compareAndClear(supersededLogoutCapture, 'logout_live_terminal');

    staleLogoutPeer = new AuthCoordinator({
      appId: APP,
      storage: createMemoryAuthCustodyStorage({ state: custodyState }),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    await staleLogoutPeer.synchronize();
    const anonymousCapture = staleLogoutPeer.capture();
    bearerAuthority.set(BEARER_B, sessionB);
    await staleLogoutPeer.transition(anonymousCapture, {
      authority: sessionB,
      bearer: BEARER_B,
      refreshAfterMs: 40_000,
    }, 'test_logout_terminal_then_successor');
  };
  await assert.rejects(
    db.authLogout(),
    (error) => error?.diagnostic?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  logoutTerminalHook = null;
  logoutMode = 'empty';
  assert.equal(storage.snapshot(APP).authority.sessionId, SESSION_B);
  await coordinator.synchronize();
  assert.equal(coordinator.settledView().authority.sessionId, SESSION_B);
  const successorCapture = staleLogoutPeer.capture();
  await staleLogoutPeer.transition(successorCapture, {
    authority: anonymous,
    bearer: null,
    refreshAfterMs: null,
  }, 'test_logout_successor_cleanup');
  await coordinator.synchronize();
  await staleLogoutPeer.close();
  staleLogoutPeer = null;

  // Exact reviewer replay: the response status is already known 2xx when the
  // body reader rejects with bearer/body material. Opaque facts cross the
  // transport boundary, current custody clears, and the fixed invalid-response
  // error contains neither the reader error nor request credential.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  calls = [];
  logoutMode = 'read-failure';
  let readFailureLogoutError;
  await assert.rejects(db.authLogout(), (error) => {
    readFailureLogoutError = error;
    return error?.diagnostic?.code === 'SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID';
  });
  assert.equal(coordinator.settledView().authority.kind, 'anonymous');
  assert.equal(Object.hasOwn(coordinator.settledView(), 'bearer'), false);
  const readFailureProjection = JSON.stringify({
    name: readFailureLogoutError.name,
    message: readFailureLogoutError.message,
    code: readFailureLogoutError.code,
    diagnostic: readFailureLogoutError.diagnostic,
  });
  assert.equal(readFailureProjection.includes(BEARER_A), false);
  assert.equal(readFailureProjection.includes(READ_FAILURE_SECRET), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/logout', '/auth/session']);

  // If another context installs B while A's 2xx body read fails, A still runs
  // compare-clear but cannot erase B. Stale authority wins over the generic
  // malformed-success diagnostic and the successor remains durable.
  await db.authExchange({ challengeId: CHALLENGE_ID, code: LOGIN_CODE });
  staleLogoutPeer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  await staleLogoutPeer.synchronize();
  const stalePeerCapture = staleLogoutPeer.capture();
  bearerAuthority.set(BEARER_B, sessionB);
  logoutReadFailureHook = () => staleLogoutPeer.transition(stalePeerCapture, {
    authority: sessionB,
    bearer: BEARER_B,
    refreshAfterMs: 40_000,
  }, 'test_logout_read_failure_peer_transition');
  calls = [];
  let staleReadFailureError;
  await assert.rejects(db.authLogout(), (error) => {
    staleReadFailureError = error;
    return error?.diagnostic?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE';
  });
  logoutReadFailureHook = null;
  const successorSnapshot = storage.snapshot(APP);
  assert.equal(successorSnapshot.authority.sessionId, SESSION_B);
  assert.equal(successorSnapshot.bearer, BEARER_B);
  const staleFailureProjection = JSON.stringify({
    name: staleReadFailureError.name,
    message: staleReadFailureError.message,
    code: staleReadFailureError.code,
    diagnostic: staleReadFailureError.diagnostic,
  });
  assert.equal(staleFailureProjection.includes(BEARER_A), false);
  assert.equal(staleFailureProjection.includes(READ_FAILURE_SECRET), false);
  assert.deepEqual(calls.map(({ path }) => path), ['/auth/logout', '/auth/session']);
  await staleLogoutPeer.close();
  staleLogoutPeer = null;

  // The item-5 client-secret sentinel covers every ordinary app-visible auth
  // result/error and every requested URL. Authorization headers and the
  // documented transactional custody record are the deliberate v1 carriers.
  for (const value of [
    exchanged,
    refreshed,
    loggedOut,
    wrongStatusLogoutError,
    reflectedLogoutError,
    readFailureLogoutError,
    staleReadFailureError,
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
  await staleLogoutPeer?.close();
  await unregisterSurfaceProbe();
  await db.closeAuth();
  await coordinator.close();
}

// FINAL4: an ordinary coordinated authSession racing either owner resume or
// peer adoption observes a paused exact capture, not "missing custody". It
// must reject without issuing a bootstrap handshake, publishing a cache, or
// enabling compareAndCommit; the transport's staged handshake becomes cached
// only after the final exact confirmation.
for (const mode of ['owner', 'peer']) {
  const state = { custody: {} };
  const subject = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const writer = mode === 'peer'
    ? new AuthCoordinator({
      appId: APP,
      storage: createMemoryAuthCustodyStorage({ state }),
      broadcastChannelFactory: null,
      hintStorage: null,
    })
    : subject;
  const before = await writer.establishAnonymous(anonymous);
  if (writer !== subject) await subject.synchronize();
  const client = new SnapbackClient('http://stub', { authCoordinator: subject });
  let handshakeCalls = 0;
  let enterResume;
  let releaseResume;
  const resumeEntered = new Promise((resolve) => { enterResume = resolve; });
  const resumeGate = new Promise((resolve) => { releaseResume = resolve; });
  const unregisterHold = subject.registerParticipant({
    name: `final4-real-kit-hold-${mode}`,
    async resume() {
      enterResume();
      await resumeGate;
    },
  });
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(pathOf(url), '/auth/session');
    assert.equal(authorization(init), `Bearer ${BEARER_A}`);
    handshakeCalls += 1;
    return response(handshake(sessionA));
  };
  try {
    let barrier;
    if (mode === 'owner') {
      barrier = subject.transition(before, {
        authority: sessionA,
        bearer: BEARER_A,
        refreshAfterMs: 20_000,
      }, 'final4_owner_concurrent_auth_session');
    } else {
      const settled = await writer.transition(before, {
        authority: sessionA,
        bearer: BEARER_A,
        refreshAfterMs: 20_000,
      }, 'final4_peer_concurrent_auth_session');
      assert.equal(settled.authorityEpoch, 1);
      barrier = subject.synchronize();
    }
    await resumeEntered;
    let earlyPublication = 0;
    const pausedCapture = await subject.synchronize();
    assert.deepEqual(
      await subject.compareAndCommit(pausedCapture, () => { earlyPublication += 1; }),
      { committed: false },
    );
    await assert.rejects(
      client.authSession({ force: true }),
      (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    );
    assert.equal(handshakeCalls, 0, `${mode}: paused authSession performs no handshake`);
    assert.equal(earlyPublication, 0, `${mode}: paused compareAndCommit callback did not run`);
    assert.throws(
      () => subject.capture(),
      { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' },
    );
    releaseResume();
    await barrier;
    assert.equal(handshakeCalls, 1, `${mode}: transport resume performs one staged handshake`);
    const cached = await client.authSession();
    assert.equal(cached.authority.sessionId, SESSION_A);
    assert.equal(handshakeCalls, 1, `${mode}: cache is exposed only after final confirmation`);
  } finally {
    globalThis.fetch = originalFetch;
    releaseResume?.();
    await unregisterHold();
    await client.closeAuth();
    if (writer !== subject) await writer.close();
    await subject.close();
  }
}

// A real kit transport may finish and stage its handshake before a later
// participant makes the owner's final exact confirmation stale. The staged
// cache is discarded, every surface stays blank, and a later clean adoption
// must fetch the actual peer successor instead of returning the staged value.
{
  const state = { custody: {} };
  const subject = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const peer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await subject.establishAnonymous(anonymous);
  await peer.synchronize();
  let client;
  let concurrentAuthError = null;
  let compareCallbackCalls = 0;
  const unregisterDisrupt = subject.registerParticipant({
    name: 'final4-owner-real-kit-mismatch',
    async resume(context) {
      try {
        await client.authSession({ force: true });
      } catch (error) {
        concurrentAuthError = error;
      }
      assert.deepEqual(
        await subject.compareAndCommit(context.capture, () => { compareCallbackCalls += 1; }),
        { committed: false },
      );
      const current = await peer.synchronize();
      await peer.transition(current, {
        authority: sessionB,
        bearer: BEARER_B,
        refreshAfterMs: 30_000,
      }, 'final4_owner_real_kit_mismatch');
    },
  });
  client = new SnapbackClient('http://stub', { authCoordinator: subject });
  const handshakeBearers = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(pathOf(url), '/auth/session');
    const bearer = authorization(init)?.replace(/^Bearer /, '') ?? null;
    handshakeBearers.push(bearer);
    return response(handshake(bearer === BEARER_B ? sessionB : sessionA));
  };
  try {
    await assert.rejects(
      subject.transition(before, {
        authority: sessionA,
        bearer: BEARER_A,
        refreshAfterMs: 20_000,
      }, 'final4_owner_real_kit_stage'),
      (error) => error?.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
    );
    assert.equal(concurrentAuthError?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    assert.equal(compareCallbackCalls, 0);
    assert.deepEqual(handshakeBearers, [BEARER_A]);
    assert.throws(() => subject.capture(), { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' });
    await unregisterDisrupt();
    const cleanCapture = await subject.synchronize();
    assert.equal(cleanCapture.authorityEpoch, 2);
    const handshakesAfterCleanSync = handshakeBearers.length;
    const recovered = await client.authSession();
    assert.equal(recovered.authority.sessionId, SESSION_B);
    assert.equal(
      handshakeBearers.length,
      handshakesAfterCleanSync,
      'owner mismatch exposes only the clean synchronization cache',
    );
    assert.equal(handshakeBearers[0], BEARER_A);
    assert(
      handshakeBearers.slice(1).length > 0
        && handshakeBearers.slice(1).every((bearer) => bearer === BEARER_B),
      'owner mismatch discarded staged A; clean recovery fetched only durable B',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await unregisterDisrupt();
    await client.closeAuth();
    await peer.close();
    await subject.close();
  }
}

// The corresponding peer-adoption cut fails the final owner.read after the
// real transport staged its handshake. Failure cleanup must discard that cache,
// remain blank, and force a fresh handshake on clean recovery.
{
  const state = { custody: {} };
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  const finalRead = finalOwnerReadFailureSeam(
    baseStorage,
    'TEST_FINAL6_PEER_FINAL_READ_FAILED',
  );
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const subject = new AuthCoordinator({
    appId: APP,
    storage: finalRead.storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous);
  await subject.synchronize();
  let client;
  let concurrentAuthError = null;
  let compareCallbackCalls = 0;
  let handshakeCalls = 0;
  const unregisterFailure = subject.registerParticipant({
    name: 'final6-peer-real-kit-final-read-failure',
    async resume(context) {
      try {
        await client.authSession({ force: true });
      } catch (error) {
        concurrentAuthError = error;
      }
      assert.deepEqual(
        await subject.compareAndCommit(context.capture, () => { compareCallbackCalls += 1; }),
        { committed: false },
      );
      assert.equal(
        handshakeCalls,
        1,
        'peer transport completed stagePublication before the final read was armed',
      );
      finalRead.arm('peer-resume-after-transport-stage');
    },
  });
  client = new SnapbackClient('http://stub', { authCoordinator: subject });
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(pathOf(url), '/auth/session');
    assert.equal(authorization(init), `Bearer ${BEARER_A}`);
    handshakeCalls += 1;
    return response(handshake(sessionA));
  };
  try {
    await writer.transition(before, {
      authority: sessionA,
      bearer: BEARER_A,
      refreshAfterMs: 20_000,
    }, 'final6_peer_real_kit_stage');
    await assert.rejects(
      subject.synchronize(),
      (error) => error?.code === 'TEST_FINAL6_PEER_FINAL_READ_FAILED',
    );
    const finalReadWitness = finalRead.witness();
    assert.equal(finalReadWitness?.phase, 'peer-resume-after-transport-stage');
    assert(finalReadWitness.armedAtReadCount > 0, 'peer initial/preconfirm reads completed');
    assert.equal(
      finalReadWitness.failureReadCount,
      finalReadWitness.armedAtReadCount + 1,
      'peer failure was the next production owner.read after staging',
    );
    assert.equal(
      finalReadWitness.delegatedReadCount,
      finalReadWitness.armedAtReadCount,
      'peer final owner.read threw before delegating to durable storage',
    );
    assert.equal(concurrentAuthError?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    assert.equal(compareCallbackCalls, 0);
    assert.equal(handshakeCalls, 1);
    assert.throws(() => subject.capture(), { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' });
    await unregisterFailure();
    const cleanCapture = await subject.synchronize();
    assert.equal(cleanCapture.authorityEpoch, 1);
    const handshakesAfterCleanSync = handshakeCalls;
    const recovered = await client.authSession();
    assert.equal(recovered.authority.sessionId, SESSION_A);
    assert(
      handshakeCalls >= 2,
      'peer final-confirm failure discarded the staged cache and fetched again',
    );
    assert.equal(
      handshakeCalls,
      handshakesAfterCleanSync,
      'peer final-confirm failure exposes only the clean synchronization cache',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await unregisterFailure();
    await client.closeAuth();
    await subject.close();
    await writer.close();
  }
}

// FINAL5 symmetric peer-adoption mismatch: the real transport completes and
// stages A, then another context advances durable custody to B before the
// adopting context's final confirmation. The ordinary authSession in flight
// inside resume must return stale, staged A must be discarded, and only a
// later clean synchronization may fetch and expose B.
{
  const state = { custody: {} };
  const writer = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const subject = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage({ state }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await writer.establishAnonymous(anonymous);
  await subject.synchronize();
  let client;
  let concurrentAuthError = null;
  let compareCallbackCalls = 0;
  const unregisterDisrupt = subject.registerParticipant({
    name: 'final5-peer-real-kit-mismatch',
    async resume(context) {
      try {
        await client.authSession({ force: true });
      } catch (error) {
        concurrentAuthError = error;
      }
      assert.deepEqual(
        await subject.compareAndCommit(context.capture, () => { compareCallbackCalls += 1; }),
        { committed: false },
      );
      const current = await writer.synchronize();
      await writer.transition(current, {
        authority: sessionB,
        bearer: BEARER_B,
        refreshAfterMs: 30_000,
      }, 'final5_peer_real_kit_mismatch');
    },
  });
  client = new SnapbackClient('http://stub', { authCoordinator: subject });
  const handshakeBearers = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(pathOf(url), '/auth/session');
    const bearer = authorization(init)?.replace(/^Bearer /, '') ?? null;
    handshakeBearers.push(bearer);
    return response(handshake(bearer === BEARER_B ? sessionB : sessionA));
  };
  try {
    await writer.transition(before, {
      authority: sessionA,
      bearer: BEARER_A,
      refreshAfterMs: 20_000,
    }, 'final5_peer_real_kit_stage');
    await assert.rejects(
      subject.synchronize(),
      (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
    );
    assert.equal(concurrentAuthError?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    assert.equal(compareCallbackCalls, 0);
    assert.deepEqual(handshakeBearers, [BEARER_A]);
    assert.throws(() => subject.capture(), { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' });
    await unregisterDisrupt();
    const cleanCapture = await subject.synchronize();
    assert.equal(cleanCapture.authorityEpoch, 2);
    const handshakesAfterCleanSync = handshakeBearers.length;
    const recovered = await client.authSession();
    assert.equal(recovered.authority.sessionId, SESSION_B);
    assert.equal(handshakeBearers.length, handshakesAfterCleanSync);
    assert(
      handshakeBearers.slice(1).length > 0
        && handshakeBearers.slice(1).every((bearer) => bearer === BEARER_B),
      'peer mismatch discarded staged A; clean synchronization fetched only durable B',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await unregisterDisrupt();
    await client.closeAuth();
    await subject.close();
    await writer.close();
  }
}

// FINAL6 symmetric owner final-read failure: the production transport stages
// A, then the final owner.read fails. No staged or ordinary work is
// exposed; the owner remains closed until a clean synchronization repeats the
// handshake and publishes that newly confirmed result.
{
  const state = { custody: {} };
  const baseStorage = createMemoryAuthCustodyStorage({ state });
  const finalRead = finalOwnerReadFailureSeam(
    baseStorage,
    'TEST_FINAL6_OWNER_FINAL_READ_FAILED',
  );
  const subject = new AuthCoordinator({
    appId: APP,
    storage: finalRead.storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const before = await subject.establishAnonymous(anonymous);
  let client;
  let concurrentAuthError = null;
  let compareCallbackCalls = 0;
  let handshakeCalls = 0;
  const unregisterFailure = subject.registerParticipant({
    name: 'final6-owner-real-kit-final-read-failure',
    async resume(context) {
      try {
        await client.authSession({ force: true });
      } catch (error) {
        concurrentAuthError = error;
      }
      assert.deepEqual(
        await subject.compareAndCommit(context.capture, () => { compareCallbackCalls += 1; }),
        { committed: false },
      );
      assert.equal(
        handshakeCalls,
        1,
        'owner transport completed stagePublication before the final read was armed',
      );
      finalRead.arm('owner-resume-after-transport-stage');
    },
  });
  client = new SnapbackClient('http://stub', { authCoordinator: subject });
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(pathOf(url), '/auth/session');
    assert.equal(authorization(init), `Bearer ${BEARER_A}`);
    handshakeCalls += 1;
    return response(handshake(sessionA));
  };
  try {
    let transitionError;
    await assert.rejects(
      subject.transition(before, {
        authority: sessionA,
        bearer: BEARER_A,
        refreshAfterMs: 20_000,
      }, 'final6_owner_real_kit_stage'),
      (error) => {
        transitionError = error;
        return error?.code === 'SNAPBACK_AUTH_TRANSITION_FAILED';
      },
    );
    assert.equal(
      transitionError?.diagnostic?.details?.causeCode,
      'TEST_FINAL6_OWNER_FINAL_READ_FAILED',
    );
    const finalReadWitness = finalRead.witness();
    assert.equal(finalReadWitness?.phase, 'owner-resume-after-transport-stage');
    assert(finalReadWitness.armedAtReadCount > 0, 'owner initial/preconfirm reads completed');
    assert.equal(
      finalReadWitness.failureReadCount,
      finalReadWitness.armedAtReadCount + 1,
      'owner failure was the next production owner.read after staging',
    );
    assert.equal(
      finalReadWitness.delegatedReadCount,
      finalReadWitness.armedAtReadCount,
      'owner final owner.read threw before delegating to durable storage',
    );
    assert.equal(concurrentAuthError?.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    assert.equal(compareCallbackCalls, 0);
    assert.equal(handshakeCalls, 1);
    assert.throws(() => subject.capture(), { code: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING' });
    await unregisterFailure();
    const cleanCapture = await subject.synchronize();
    assert.equal(cleanCapture.authorityEpoch, 1);
    const handshakesAfterCleanSync = handshakeCalls;
    const recovered = await client.authSession();
    assert.equal(recovered.authority.sessionId, SESSION_A);
    assert(
      handshakeCalls >= 2,
      'owner final-confirm failure discarded the staged cache and fetched again',
    );
    assert.equal(handshakeCalls, handshakesAfterCleanSync);
  } finally {
    globalThis.fetch = originalFetch;
    await unregisterFailure();
    await client.closeAuth();
    await subject.close();
  }
}

console.log('coordinated SnapbackClient auth races: ok');
