import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import { SnapbackClient } from './index.mjs';

const APP = 'snapback.test/sender-client';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION = '018f0d90-7b12-7a22-8c33-445566778899';
const USER = '018f0d90-7b13-7a22-8c33-445566778899';
const AUTHORITY = '018f0d90-7b14-7a22-8c33-445566778899';
const NONCE_1 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';
const NONCE_2 = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const NONCE_3 = Buffer.alloc(32, 3).toString('base64url');
const NONCE_4 = Buffer.alloc(32, 4).toString('base64url');
const NONCE_5 = Buffer.alloc(32, 5).toString('base64url');
const NONCE_6 = Buffer.alloc(32, 6).toString('base64url');
const NONCE_7 = Buffer.alloc(32, 7).toString('base64url');
const NONCE_8 = Buffer.alloc(32, 8).toString('base64url');
const NONCE_9 = Buffer.alloc(32, 9).toString('base64url');
const NONCE_10 = Buffer.alloc(32, 10).toString('base64url');
const NONCE_11 = Buffer.alloc(32, 11).toString('base64url');
const RESET_INCARNATION = '018f0d90-7b15-7a22-8c33-445566778899';
const BEARER = 'sbs_sender_client_fixture';
const SUCCESSOR_BEARER = 'sbs_sender_client_successor';

const deploymentIdentity = {
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: APP,
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
};

const availability = {
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
};

const handshake = ({ authenticated, incarnation = INCARNATION }) => ({
  protocolVersion: 1,
  serverStartupNonce: 'startup-1',
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
    ? { kind: 'humanSession', userId: USER, sessionId: SESSION, isAuthenticated: true }
    : { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: authenticated ? AUTHORITY : incarnation,
    sessionGeneration: authenticated ? 1 : 0,
  },
  deploymentIdentity,
  authorizedLease: null,
});

const invalidationHandshake = ({ authenticated }) => ({
  ...handshake({ authenticated }),
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    ...availability,
    authScopedLive: {
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    },
  },
});

const credential = {
  tokenType: 'Bearer',
  token: BEARER,
  refreshAfter: 120_000,
  session: {
    id: SESSION,
    userId: USER,
    provider: 'email-code',
    createdAt: 1,
    expiresAt: 240_000,
    absoluteExpiresAt: 480_000,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY,
    sessionGeneration: 1,
  },
};

const successorCredential = {
  ...credential,
  token: SUCCESSOR_BEARER,
  refreshAfter: 180_000,
};

const decode = (value) => JSON.parse(Buffer.from(
  value.replaceAll('-', '+').replaceAll('_', '/'),
  'base64',
).toString('utf8'));

const originalFetch = globalThis.fetch;
const requests = [];
let serverMode = 'normal';
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  requests.push(request);
  if (serverMode !== 'normal' && url.endsWith('/auth/session')) {
    if (request.headers.has('authorization')) {
      const payload = decode(request.headers.get('dpop').split('.')[1]);
      assert.equal(request.headers.get('authorization'), `Bearer ${SUCCESSOR_BEARER}`);
      const expectedNonce = serverMode === 'expired'
        ? NONCE_9
        : serverMode === 'recover-expiry'
          ? NONCE_10
          : NONCE_11;
      assert.equal(payload.nonce, expectedNonce);
      if (serverMode === 'expired') {
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_AUTH_SESSION_EXPIRED',
            message: 'authentication session is expired',
            details: { authorityDisposition: 'carrier' },
          },
        }, {
          status: 401,
          headers: { 'dpop-nonce': NONCE_10 },
        });
      }
      if (serverMode === 'recover-expiry') {
        return Response.json(handshake({ authenticated: true }), {
          headers: { 'dpop-nonce': NONCE_11 },
        });
      }
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_AUTH_SENDER_PROOF_INVALID',
          message: 'sender-constrained request admission failed',
        },
      }, { status: 401 });
    }
    return Response.json(handshake({
      authenticated: false,
      incarnation: serverMode === 'reset' ? RESET_INCARNATION : INCARNATION,
    }));
  }
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(handshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    assert.equal(request.body.senderConstraint.protocol, 'snapback.sender-issuance.v2');
    const payload = decode(request.body.senderConstraint.proof.split('.')[1]);
    assert.equal(payload.challengeId, 'challenge-1');
    assert.equal(payload.htu, 'https://app.example.test/auth/exchange');
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (url.endsWith('/auth/session') && request.headers.get('authorization') === `Bearer ${BEARER}`) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    const expectedNonce = requests.length === 3
      ? NONCE_1
      : requests.length === 4
        ? NONCE_2
        : NONCE_5;
    const successorNonce = requests.length === 3
      ? NONCE_2
      : requests.length === 4
        ? NONCE_3
        : NONCE_6;
    assert.equal(payload.nonce, expectedNonce);
    assert.equal(payload.htu, 'https://app.example.test/auth/session');
    return Response.json(handshake({ authenticated: true }), {
      headers: { 'dpop-nonce': successorNonce },
    });
  }
  if (
    url.endsWith('/auth/session')
    && request.headers.get('authorization') === `Bearer ${SUCCESSOR_BEARER}`
  ) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(payload.nonce, NONCE_7);
    return Response.json(handshake({ authenticated: true }), {
      headers: { 'dpop-nonce': NONCE_8 },
    });
  }
  if (url.endsWith('/query/list')) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    assert.equal(payload.nonce, NONCE_3);
    assert.equal(payload.htm, 'POST');
    assert.equal(payload.htu, 'https://app.example.test/query/list');
    return Response.json({ rows: [{ id: 'row-1' }] }, {
      headers: { 'dpop-nonce': NONCE_4 },
    });
  }
  if (url.endsWith('/query/fail')) {
    const compact = request.headers.get('dpop');
    const [header, payload, signature] = compact.split('.');
    const decodedHeader = decode(header);
    const decodedPayload = decode(payload);
    assert.equal(decodedPayload.nonce, NONCE_8);
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_REFLECTED_SENDER_MATERIAL',
        message: [
          request.headers.get('authorization'),
          SUCCESSOR_BEARER,
          decodedPayload.nonce,
          NONCE_9,
          decodedHeader.jwk.x,
          decodedHeader.jwk.y,
          header,
          payload,
          signature,
          compact,
        ].join('|'),
      },
    }, {
      status: 400,
      headers: { 'dpop-nonce': NONCE_9 },
    });
  }
  if (url.endsWith('/auth/refresh') && requests.length === 6) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    assert.equal(payload.nonce, NONCE_4);
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
        message: 'response-controlled text must not escape',
      },
    }, {
      status: 401,
      headers: { 'dpop-nonce': NONCE_5 },
    });
  }
  if (url.endsWith('/auth/refresh')) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    assert.equal(payload.nonce, NONCE_5);
    return Response.json(successorCredential, {
      headers: { 'dpop-nonce': NONCE_7 },
    });
  }
  throw new Error(`unexpected sender transport request: ${request.method} ${url}`);
};

try {
  const custodyStorage = createMemoryAuthCustodyStorage();
  const coordinator = new AuthCoordinator({
    appId: APP,
    storage: custodyStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient('https://app.example.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  const projection = await client.authExchange({
    challengeId: 'challenge-1',
    code: '123456',
  });
  assert.equal(projection.session.id, SESSION);
  const capture = coordinator.capture();
  const installed = coordinator.senderCredentialFor(capture);
  assert.equal(installed.bearer, BEARER);
  assert.equal(installed.senderConstraint.privateKey.extractable, false);
  assert.equal(installed.senderConstraint.nonce.value, NONCE_2);
  assert.equal(installed.senderConstraint.nonce.generation, 2);
  assert.equal(installed.senderConstraint.custodyGeneration, 2);

  const query = await client.query('list');
  assert.deepEqual(query, { rows: [{ id: 'row-1' }] });
  const afterQueryCapture = coordinator.capture();
  const afterQuery = coordinator.senderCredentialFor(afterQueryCapture);
  assert.equal(afterQuery.senderConstraint.nonce.value, NONCE_4);
  assert.equal(afterQuery.senderConstraint.nonce.generation, 4);
  assert.equal(afterQuery.senderConstraint.custodyGeneration, 4);

  const refreshed = await client.authRefresh();
  assert.equal(refreshed.session.id, SESSION);
  const refreshedCapture = coordinator.capture();
  const refreshedCredential = coordinator.senderCredentialFor(refreshedCapture);
  assert.equal(refreshedCredential.bearer, SUCCESSOR_BEARER);
  assert.equal(refreshedCredential.senderConstraint.nonce.value, NONCE_7);
  assert.equal(refreshedCredential.senderConstraint.nonce.generation, 6);
  assert.equal(refreshedCredential.senderConstraint.custodyGeneration, 6);
  const websocketProtocols = await client.liveStreamProtocolsFor(
    { id: 'conn_sender', token: 'sct_sender_grant' },
    '/live/conn_sender/stream',
    refreshedCapture,
  );
  const websocketProofProtocol = websocketProtocols.find(
    (protocol) => protocol.startsWith('snapback.sender-proof.'),
  );
  assert.ok(websocketProofProtocol);
  const websocketPayload = decode(
    websocketProofProtocol
      .slice('snapback.sender-proof.'.length)
      .split('.')[1],
  );
  assert.equal(websocketPayload.htm, 'GET');
  assert.equal(websocketPayload.htu, 'https://app.example.test/live/conn_sender/stream');
  assert.equal(websocketPayload.nonce, NONCE_7);
  let reflectedError = null;
  try {
    await client.query('fail');
  } catch (error) {
    reflectedError = error;
  }
  assert.equal(
    reflectedError?.diagnostic?.code,
    'SNAPBACK_REFLECTED_SENDER_MATERIAL',
    reflectedError?.stack,
  );
  const projectedError = JSON.stringify({
    message: reflectedError.message,
    diagnostic: reflectedError.diagnostic,
  });
  const failedRequest = requests.at(-1);
  const failedProof = failedRequest.headers.get('dpop');
  const failedHeader = decode(failedProof.split('.')[0]);
  for (const forbidden of [
    SUCCESSOR_BEARER,
    NONCE_8,
    NONCE_9,
    refreshedCredential.senderConstraint.thumbprint,
    failedHeader.jwk.x,
    failedHeader.jwk.y,
    ...failedProof.split('.'),
    failedProof,
  ]) {
    assert.equal(
      projectedError.includes(forbidden),
      false,
      `reflected ${forbidden} escaped in ${projectedError}`,
    );
  }
  const afterFailure = coordinator.senderCredentialFor(coordinator.capture());
  assert.equal(afterFailure.senderConstraint.nonce.value, NONCE_9);
  assert.equal(requests.length, 9);
  for (const request of requests) {
    for (const forbidden of [
      BEARER,
      SUCCESSOR_BEARER,
      NONCE_1,
      NONCE_2,
      NONCE_3,
      NONCE_4,
      NONCE_5,
      NONCE_6,
      NONCE_7,
      NONCE_8,
      NONCE_9,
      refreshedCredential.senderConstraint.thumbprint,
    ]) {
      assert.equal(request.url.includes(forbidden), false, 'sender material escaped into a URL');
    }
  }

  serverMode = 'expired';
  await assert.rejects(
    client.query('never_reaches_query'),
    (error) => (
      error?.diagnostic?.code === 'SNAPBACK_AUTH_SESSION_EXPIRED'
      && error?.authorityDisposition === 'carrier'
    ),
  );
  const expiredCarrierCustody = custodyStorage.snapshot(APP);
  assert.equal(expiredCarrierCustody.formatVersion, 3);
  assert.equal(expiredCarrierCustody.senderConstraint.nonce.value, NONCE_10);
  assert.equal(expiredCarrierCustody.bearer, SUCCESSOR_BEARER);

  const recoveryClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  serverMode = 'recover-expiry';
  const recoveredProjection = await recoveryClient.authSession({ force: true });
  assert.equal(recoveredProjection.authority.isAuthenticated, true);
  assert.equal(
    custodyStorage.snapshot(APP).senderConstraint.nonce.value,
    NONCE_11,
  );

  serverMode = 'same';
  await assert.rejects(
    recoveryClient.authSession({ force: true }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_SENDER_PROOF_INVALID',
  );
  const sameStreamCustody = custodyStorage.snapshot(APP);
  assert.equal(sameStreamCustody.formatVersion, 3);
  assert.equal(sameStreamCustody.senderConstraint.nonce.value, NONCE_11);
  assert.equal(sameStreamCustody.bearer, SUCCESSOR_BEARER);

  serverMode = 'reset';
  const resetProjection = await recoveryClient.authSession({ force: true });
  assert.equal(resetProjection.authority.kind, 'anonymous');
  assert.equal(
    resetProjection.authorizationStreamIncarnation,
    RESET_INCARNATION,
  );
  const postResetCustody = custodyStorage.snapshot(APP);
  assert.equal(postResetCustody.formatVersion, 2);
  assert.equal(postResetCustody.authority.kind, 'anonymous');
  assert.equal(
    postResetCustody.authority.authorizationStreamIncarnation,
    RESET_INCARNATION,
  );
  assert.equal('senderConstraint' in postResetCustody, false);
  assert.equal(JSON.stringify(postResetCustody).includes(SUCCESSOR_BEARER), false);
  assert.equal(
    requests.length,
    18,
    'carrier expiry and same-stream refusal each probe without deletion, while reset adds protected refusal plus each registered transport resume confirmation',
  );
} finally {
  globalThis.fetch = originalFetch;
}

const serializedRequests = [];
let serializedNonce = NONCE_1;
const serializedSuccessors = [
  NONCE_2,
  NONCE_3,
  NONCE_4,
  NONCE_5,
  NONCE_6,
  NONCE_7,
  NONCE_8,
  NONCE_9,
  NONCE_10,
  NONCE_11,
];
let protectedInFlight = 0;
let maximumProtectedInFlight = 0;
let committedMissingNonceEffects = 0;
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  serializedRequests.push(request);
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(handshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (request.headers.has('dpop')) {
    protectedInFlight += 1;
    maximumProtectedInFlight = Math.max(maximumProtectedInFlight, protectedInFlight);
    try {
      const payload = decode(request.headers.get('dpop').split('.')[1]);
      if (payload.nonce !== serializedNonce) {
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
            message: 'the sender nonce must be refreshed',
          },
        }, {
          status: 401,
          headers: { 'dpop-nonce': serializedNonce },
        });
      }
      const successor = serializedSuccessors.shift();
      assert.ok(successor, 'serialized sender fixture exhausted its nonce sequence');
      serializedNonce = successor;
      if (url.endsWith('/mutation/commitOnce')) {
        committedMissingNonceEffects += 1;
        return Response.json({ committed: true });
      }
      if (url.endsWith('/auth/session')) {
        return Response.json(handshake({ authenticated: true }), {
          headers: { 'dpop-nonce': successor },
        });
      }
      if (url.includes('/query/')) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return Response.json({ path: new URL(url).pathname }, {
          headers: { 'dpop-nonce': successor },
        });
      }
    } finally {
      protectedInFlight -= 1;
    }
  }
  throw new Error(`unexpected serialized sender request: ${request.method} ${url}`);
};

try {
  const serializedCoordinator = new AuthCoordinator({
    appId: APP,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const serializedClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: serializedCoordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  await serializedClient.authExchange({
    challengeId: 'serialized-challenge',
    code: '123456',
  });

  let indeterminate = null;
  try {
    await serializedClient.mutate('commitOnce');
  } catch (error) {
    indeterminate = error;
  }
  assert.equal(
    indeterminate?.code,
    'SNAPBACK_AUTH_SENDER_OUTCOME_INDETERMINATE',
  );
  assert.equal(indeterminate?.outcome, 'indeterminate');
  assert.equal(indeterminate?.effectMayHaveCommitted, true);
  assert.equal(indeterminate?.retryable, false);
  assert.equal(committedMissingNonceEffects, 1);

  const recovered = await serializedClient.query('afterIndeterminate');
  assert.equal(recovered.path, '/query/afterIndeterminate');
  const [left, right] = await Promise.all([
    serializedClient.query('serializedLeft'),
    serializedClient.query('serializedRight'),
  ]);
  assert.deepEqual(
    [left.path, right.path].sort(),
    ['/query/serializedLeft', '/query/serializedRight'],
  );
  assert.equal(
    maximumProtectedInFlight,
    1,
    'one custody generation may have only one protected request in flight',
  );
  assert.equal(committedMissingNonceEffects, 1, 'indeterminate success is never blind-retried');
} finally {
  globalThis.fetch = originalFetch;
}

const logoutRequests = [];
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  logoutRequests.push(request);
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(handshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    assert.equal(request.body.senderConstraint.protocol, 'snapback.sender-issuance.v2');
    const payload = decode(request.body.senderConstraint.proof.split('.')[1]);
    assert.equal(payload.challengeId, 'logout-challenge');
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (url.endsWith('/auth/session')) {
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(payload.htm, 'GET');
    assert.equal(payload.htu, 'https://app.example.test/auth/session');
    assert.equal(payload.nonce, NONCE_1);
    return Response.json(handshake({ authenticated: true }), {
      headers: { 'dpop-nonce': NONCE_2 },
    });
  }
  if (url.endsWith('/auth/logout')) {
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(payload.htm, 'POST');
    assert.equal(payload.htu, 'https://app.example.test/auth/logout');
    assert.equal(payload.nonce, NONCE_2);
    return new Response(null, {
      status: 204,
      headers: { 'dpop-nonce': NONCE_3 },
    });
  }
  throw new Error(`unexpected sender logout request: ${request.method} ${url}`);
};

try {
  const logoutStorage = createMemoryAuthCustodyStorage();
  const logoutCoordinator = new AuthCoordinator({
    appId: APP,
    storage: logoutStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const logoutClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: logoutCoordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  await logoutClient.authExchange({
    challengeId: 'logout-challenge',
    code: '123456',
  });
  const preLogout = logoutStorage.snapshot(APP);
  assert.equal(preLogout.formatVersion, 3);
  assert.equal(preLogout.bearer, BEARER);
  assert.equal(preLogout.senderConstraint.nonce.value, NONCE_2);

  assert.equal(await logoutClient.authLogout(), null);
  const postLogout = logoutStorage.snapshot(APP);
  assert.equal(postLogout.formatVersion, 2);
  assert.equal(postLogout.authority.kind, 'anonymous');
  assert.equal('senderConstraint' in postLogout, false);
  assert.equal(JSON.stringify(postLogout).includes(BEARER), false);
  assert.equal(
    logoutRequests.length,
    5,
    'logout resumes each registered transport against anonymous custody before returning',
  );
  assert.equal(logoutRequests.at(-1).url.endsWith('/auth/session'), true);
  assert.equal(logoutRequests.at(-1).headers.has('authorization'), false);
} finally {
  globalThis.fetch = originalFetch;
}

// LLP 0077 decision 2 (logout tombstone): a committed logout whose response
// was lost strands custody until the next signed request obtains the
// terminal durableDelete outcome from the revoked-family tombstone; the
// client must then delete sender custody (bearer, key, nonce) rather than
// loop on challenges or keep a dead family.
const tombstoneRequests = [];
let tombstoneMode = false;
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  tombstoneRequests.push(request);
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(handshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (request.headers.has('dpop') && tombstoneMode) {
    // Every signed post-logout request resolves against the tombstone: the
    // terminal outcome carries no nonce header.
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SESSION_EXPIRED',
        message: 'authentication session is expired',
        details: { authorityDisposition: 'durableDelete' },
      },
    }, { status: 401 });
  }
  if (url.endsWith('/auth/session')) {
    return Response.json(handshake({ authenticated: true }), {
      headers: { 'dpop-nonce': NONCE_2 },
    });
  }
  throw new Error(`unexpected sender tombstone request: ${request.method} ${url}`);
};

try {
  const tombstoneStorage = createMemoryAuthCustodyStorage();
  const tombstoneCoordinator = new AuthCoordinator({
    appId: APP,
    storage: tombstoneStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const tombstoneClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: tombstoneCoordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  await tombstoneClient.authExchange({
    challengeId: 'tombstone-challenge',
    code: '123456',
  });
  const stranded = tombstoneStorage.snapshot(APP);
  assert.equal(stranded.formatVersion, 3);
  assert.equal(stranded.bearer, BEARER);

  // The committed logout's response is lost; every later signed request
  // resolves against the server-side tombstone.
  tombstoneMode = true;
  await assert.rejects(
    tombstoneClient.query('post_logout_probe'),
    (error) => (
      error?.diagnostic?.code === 'SNAPBACK_AUTH_SESSION_EXPIRED'
      && error?.authorityDisposition === 'durableDelete'
    ),
    'the terminal durableDelete outcome surfaces to the caller',
  );
  const cleared = tombstoneStorage.snapshot(APP);
  assert.equal(cleared.formatVersion, 2, 'sender custody settles to anonymous v2');
  assert.equal(cleared.authority.kind, 'anonymous');
  assert.equal('senderConstraint' in cleared, false, 'the key and nonce are deleted');
  assert.equal(
    JSON.stringify(cleared).includes(BEARER),
    false,
    'no bearer survives the terminal outcome',
  );
} finally {
  globalThis.fetch = originalFetch;
}

const invalidationRequests = [];
const originalWebSocket = globalThis.WebSocket;
let invalidationSocket = null;

class InvalidationWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.listeners = new Map();
    invalidationSocket = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const entry of listeners) {
      entry.listener(event);
      if (entry.once) {
        const current = this.listeners.get(type) ?? [];
        const index = current.indexOf(entry);
        if (index !== -1) current.splice(index, 1);
      }
    }
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}

globalThis.WebSocket = InvalidationWebSocket;
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  invalidationRequests.push(request);
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(invalidationHandshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (url.endsWith('/auth/session')) {
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    const protectedHandshakeCount = invalidationRequests.filter(
      (candidate) => candidate.url.endsWith('/auth/session')
        && candidate.headers.has('authorization'),
    ).length;
    const expectedNonce = [NONCE_1, NONCE_2, NONCE_4, NONCE_6][protectedHandshakeCount - 1];
    const successorNonce = [NONCE_2, NONCE_3, NONCE_5, NONCE_7][protectedHandshakeCount - 1];
    assert.ok(expectedNonce, `unexpected protected handshake ${protectedHandshakeCount}`);
    assert.equal(payload.nonce, expectedNonce);
    return Response.json(invalidationHandshake({ authenticated: true }), {
      headers: { 'dpop-nonce': successorNonce },
    });
  }
  if (url.endsWith('/connection/open')) {
    assert.equal(request.headers.get('authorization'), `Bearer ${BEARER}`);
    assert.equal(request.body.authInvalidationProtocol, 1);
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    assert.equal(payload.nonce, NONCE_3);
    return Response.json({
      connectionId: 'sender-invalidation-wire',
      connectionToken: 'sender-invalidation-token',
      authorizationInvalidation: null,
    }, { headers: { 'dpop-nonce': NONCE_4 } });
  }
  if (url.endsWith('/outbox/sender-invalidation-wire')) {
    assert.equal(request.headers.has('authorization'), false);
    assert.equal(
      request.headers.get('x-snapback-connection-token'),
      'sender-invalidation-token',
    );
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    const expectedAth = Buffer.from(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('sender-invalidation-token'),
    )).toString('base64url');
    assert.equal(payload.ath, expectedAth);
    assert.equal(payload.nonce, NONCE_5);
    assert.equal(payload.htu, 'https://app.example.test/outbox/sender-invalidation-wire');
    return Response.json([], { headers: { 'dpop-nonce': NONCE_6 } });
  }
  throw new Error(`unexpected sender invalidation request: ${request.method} ${url}`);
};

try {
  const invalidationStorage = createMemoryAuthCustodyStorage();
  const invalidationCoordinator = new AuthCoordinator({
    appId: APP,
    storage: invalidationStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const invalidationClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: invalidationCoordinator,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  await invalidationClient.authExchange({
    challengeId: 'invalidation-challenge',
    code: '123456',
  });
  const granted = await invalidationClient.connectionGrant('sender-invalidation');
  assert.equal(granted.token, 'sender-invalidation-token');
  assert.deepEqual(
    await invalidationClient.drainEnvelopes('sender-invalidation'),
    [],
  );
  const stream = invalidationClient.openLiveStream('sender-invalidation');
  await stream.ready;
  assert.ok(invalidationSocket);
  assert.equal(
    invalidationSocket.protocols.some(
      (protocol) => protocol.startsWith('snapback.sender-proof.'),
    ),
    true,
  );
  const socketProof = invalidationSocket.protocols.find(
    (protocol) => protocol.startsWith('snapback.sender-proof.'),
  ).slice('snapback.sender-proof.'.length);
  assert.equal(decode(socketProof.split('.')[1]).nonce, NONCE_7);

  const terminal = {
    kind: 'auth_error',
    code: 'SNAPBACK_AUTH_STREAM_RESET',
    reason: 'reset',
    authorityDisposition: 'durableDelete',
  };
  invalidationSocket.emit('message', { data: JSON.stringify(terminal) });
  await assert.rejects(
    stream.nextUpdate(),
    (error) => (
      error?.code === terminal.code
      && error?.authorityDisposition === 'durableDelete'
    ),
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (invalidationStorage.snapshot(APP)?.formatVersion === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const postInvalidation = invalidationStorage.snapshot(APP);
  assert.equal(postInvalidation.formatVersion, 2);
  assert.equal(postInvalidation.authority.kind, 'anonymous');
  assert.equal('senderConstraint' in postInvalidation, false);
  assert.equal(JSON.stringify(postInvalidation).includes(BEARER), false);
  assert.equal(
    invalidationRequests.at(-1).headers.has('authorization'),
    false,
    'durable deletion resumes the sender transport only with anonymous custody',
  );
} finally {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
}

// LLP 0077 decision 5: the per-custody flight held across a sender-proof
// WebSocket upgrade releases on the FIRST server frame carrying the
// successor nonce in band; the frame commits into custody, never surfaces to
// the application, and open/close-without-frame resolves as consumed-unknown
// through the bounded challenge on the next protected request.
const WS_EXTRA_NONCES = [12, 13, 14, 15].map(
  (value) => Buffer.alloc(32, value).toString('base64url'),
);
const wsNonceRequests = [];
let wsNonceSocket = null;
let wsNonceServerNonce = NONCE_1;
class SenderNonceWebSocket {
  constructor(url, protocols) {
    this.url = url;
    this.protocols = protocols;
    this.readyState = 0;
    this.listeners = new Map();
    wsNonceSocket = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open', {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once: options.once === true });
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    for (const entry of listeners) {
      entry.listener(event);
      if (entry.once) {
        const current = this.listeners.get(type) ?? [];
        const index = current.indexOf(entry);
        if (index !== -1) current.splice(index, 1);
      }
    }
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}
globalThis.WebSocket = SenderNonceWebSocket;
globalThis.fetch = async (url, init = {}) => {
  const request = {
    url,
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body === undefined ? null : JSON.parse(init.body),
  };
  wsNonceRequests.push(request);
  if (url.endsWith('/auth/session') && !request.headers.has('authorization')) {
    return Response.json(handshake({ authenticated: false }));
  }
  if (url.endsWith('/auth/exchange')) {
    wsNonceServerNonce = NONCE_1;
    return Response.json(credential, { headers: { 'dpop-nonce': NONCE_1 } });
  }
  if (request.headers.has('dpop')) {
    const payload = decode(request.headers.get('dpop').split('.')[1]);
    if (payload.nonce !== wsNonceServerNonce) {
      // Consumed-unknown recovery: the still-current nonce, one retry.
      return Response.json({
        diagnostic: {
          code: 'SNAPBACK_AUTH_SENDER_PROOF_REQUIRED',
          message: 'the sender nonce must be refreshed',
        },
      }, { status: 401, headers: { 'dpop-nonce': wsNonceServerNonce } });
    }
    const successors = [
      NONCE_2, NONCE_3, NONCE_4, NONCE_5, NONCE_6, NONCE_7, NONCE_8,
      NONCE_9, NONCE_10, NONCE_11, ...WS_EXTRA_NONCES,
    ];
    const successor = successors[successors.indexOf(wsNonceServerNonce) + 1]
      ?? (() => { throw new Error('ws-nonce fixture exhausted its nonce sequence'); })();
    // The upgrade proof consumes its nonce exactly like HTTP, but its
    // successor travels in band (the fixture emits the frame), not in a
    // readable header.
    wsNonceServerNonce = successor;
    if (url.endsWith('/connection/open')) {
      return Response.json({
        connectionId: 'ws-nonce-wire',
        connectionToken: 'ws-nonce-token',
      }, { headers: { 'dpop-nonce': successor } });
    }
    if (url.endsWith('/auth/session')) {
      return Response.json(handshake({ authenticated: true }), {
        headers: { 'dpop-nonce': successor },
      });
    }
    if (url.includes('/query/')) {
      return Response.json({ value: 'ws-nonce-ok' }, {
        headers: { 'dpop-nonce': successor },
      });
    }
  }
  throw new Error(`unexpected ws-nonce request: ${request.method} ${url}`);
};

try {
  const wsNonceStorage = createMemoryAuthCustodyStorage();
  const wsNonceCoordinator = new AuthCoordinator({
    appId: APP,
    storage: wsNonceStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const wsNonceClient = new SnapbackClient('https://app.example.test', {
    authCoordinator: wsNonceCoordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    senderConstrained: true,
    rqsStore: null,
  });
  await wsNonceClient.authExchange({
    challengeId: 'ws-nonce-challenge',
    code: '123456',
  });

  // Release event: the first server frame carrying the successor nonce.
  const stream = wsNonceClient.openLiveStream('ws-nonce');
  await stream.ready;
  assert.ok(wsNonceSocket);
  const upgradeProof = wsNonceSocket.protocols.find(
    (protocol) => protocol.startsWith('snapback.sender-proof.'),
  );
  assert.ok(upgradeProof, 'the upgrade carries a sender proof subprotocol');
  // A real upgrade consumes the proof's nonce and installs a successor the
  // 101 header cannot deliver to browser JavaScript; the fixture advances
  // its serving nonce and hands that successor to the first frame.
  const successors = [
    NONCE_2, NONCE_3, NONCE_4, NONCE_5, NONCE_6, NONCE_7, NONCE_8,
    NONCE_9, NONCE_10, NONCE_11, ...WS_EXTRA_NONCES,
  ];
  const inBandSuccessor = successors[successors.indexOf(wsNonceServerNonce) + 1];
  wsNonceServerNonce = inBandSuccessor;
  const beforeRelease = wsNonceRequests.length;
  wsNonceSocket.emit('message', {
    data: JSON.stringify({ kind: 'sender_nonce', nonce: inBandSuccessor }),
  });
  // The commit is a same-authority custody rotation, exactly like an HTTP
  // DPoP-Nonce install: the durable record holds the in-band successor.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (wsNonceStorage.snapshot(APP)?.senderConstraint?.nonce?.value === inBandSuccessor) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(
    wsNonceStorage.snapshot(APP).senderConstraint.nonce.value,
    inBandSuccessor,
    'the in-band successor commits into custody exactly like an HTTP DPoP-Nonce',
  );
  assert.equal(
    wsNonceRequests.length,
    beforeRelease,
    'the in-band commit needs no HTTP round at all',
  );

  // The transport-internal frame never surfaces; the next app frame does.
  wsNonceSocket.emit('message', { data: JSON.stringify({ update: 'app-frame' }) });
  const surfaced = await stream.nextUpdate();
  assert.equal(surfaced.update, 'app-frame', 'the sender_nonce frame is not application-visible');

  // The released flight admits the next protected request, signing under the
  // committed in-band successor with no challenge round.
  const beforeQuery = wsNonceRequests.length;
  await wsNonceClient.query('after_in_band_nonce');
  const queryRequests = wsNonceRequests.slice(beforeQuery)
    .filter((request) => request.url.includes('/query/'));
  assert.equal(queryRequests.length, 1, 'the committed custody needs no challenge resync');
  await stream.close();

  // Consumed-unknown: a socket that closes before delivering the frame
  // releases the flight, and the next protected request resynchronizes
  // through the bounded challenge — a nonce is never reused as current.
  const second = wsNonceClient.openLiveStream('ws-nonce');
  await second.ready;
  // The real upgrade consumed the proof's nonce and installed a successor
  // this socket will never deliver: advance the serving nonce, then lose the
  // socket before any frame.
  wsNonceServerNonce = successors[successors.indexOf(wsNonceServerNonce) + 1];
  wsNonceSocket.close();
  const beforeRecovery = wsNonceRequests.length;
  await wsNonceClient.query('after_consumed_unknown');
  const recovery = wsNonceRequests.slice(beforeRecovery)
    .filter((request) => request.headers.has('dpop'));
  // The stranded nonce surfaces on the first protected request after the
  // loss (the query's forced handshake): one challenge, one retry, then the
  // query itself proceeds under the resynchronized nonce — exactly one
  // bounded round, never a loop.
  assert.equal(
    recovery.length,
    3,
    'close-without-frame recovers through exactly one bounded challenge round',
  );
  assert.equal(
    recovery.filter((request) => request.url.includes('/query/')).length,
    1,
    'the query itself needs no challenge after the resynchronized handshake',
  );
  await second.close();
} finally {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
}

console.log('sender-transport.test.mjs: issuance, resource, challenge recovery, refresh, expiry/reset/logout/tombstone/invalidation recovery, in-band WebSocket successor release, and reflected-secret redaction pass');
