// Bootstrap auth-handshake network sentinel (no server required).

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';
import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
  SnapbackClient,
  deriveServiceAuthorityInstanceId,
} from '../client.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../harness.mjs';

const suite = createSuite('_kit auth handshake', { expectedChecks: 21 });
const originalFetch = globalThis.fetch;
const APP_ID = 'snapback.test/auth-handshake';
const AUTHORITY = '018f0d90-7b24-7a22-8c33-445566778899';
const AUTHORIZATION_INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7b25-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7b26-7a22-8c33-445566778899';
const BEARER_SENTINEL = 'sbs_HANDSHAKE_SUCCESS_SENTINEL_MUST_NOT_ESCAPE';
const NUMERIC_BEARER_SENTINEL = '2915031750813250';
const AGENT_CREDENTIAL_ID = '018f0d90-7b27-7a22-8c33-445566778899';
const AGENT_GRANT_ID = '018f0d90-7b28-7a22-8c33-445566778899';
const AGENT_TOKEN_A = '018f0d90-7b29-7a22-8c33-445566778899';
const AGENT_TOKEN_B = '018f0d90-7b2a-7a22-8c33-445566778899';
const PROTOCOL_HEADERS = {
  authClient: 'x-snapback-auth-client-protocol',
  authInvalidation: 'x-snapback-auth-invalidation-protocol',
  authorityDescriptor: 'x-snapback-authority-descriptor-protocol',
  authorizedLease: 'x-snapback-authorized-lease-protocol',
};

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  // Match the Fetch Response surface consumed by sender-proof nonce
  // validation. The production client added that response-header read on
  // main, while this no-server sentinel retained its older partial mock.
  headers: new Headers(),
  text: async () => JSON.stringify(body),
});

const handshake = ({
  activeMode = 'dev',
  desiredMode = activeMode,
  modeState = 'settled',
  available = true,
  reason = null,
  nonce = 'startup-1',
  generation = 1,
  appId = APP_ID,
} = {}) => ({
  protocolVersion: 1,
  serverStartupNonce: nonce,
  authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
  transitionGeneration: generation,
  activeMode,
  desiredMode,
  modeState,
  appDataAvailability: available ? 'available' : 'refusedPending',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: null,
    authorityDescriptor: null,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available, reason },
    authScopedLive: { available, minimumAuthInvalidationProtocol: null, reason },
    retainedReads: {
      available,
      minimumAuthInvalidationProtocol: null,
      minimumAuthorizedLeaseProtocol: null,
      reason,
    },
    queuedReplay: { available, minimumAuthorityDescriptorProtocol: null, reason },
  },
  provider: { key: 'email-code', available: activeMode === 'sessions' },
  transports: ['bearer'],
  authority: activeMode === 'sessions'
    ? {
        kind: 'humanSession',
        userId: USER_ID,
        sessionId: SESSION_ID,
        isAuthenticated: true,
      }
    : { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY,
    sessionGeneration: activeMode === 'sessions' ? 1 : 0,
  },
  deploymentIdentity: activeMode === 'sessions'
    ? {
        schemaVersion: 'snapback.v1',
        authMode: 'sessions',
        appId,
        schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
        bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
        inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
      }
    : null,
  authorizedLease: null,
});

// @ref LLP 0059#client-custody-and-authcoordinator — protocol-1 fixtures use
// the production custody owner; authenticated cases seed bearer state through
// its transition rather than bypassing it through a client constructor option.
const coordinatedClient = async ({ bearerToken = null, ...options } = {}) => {
  const authMode = bearerToken === null ? 'dev' : 'sessions';
  const coordinator = new AuthCoordinator({
    appId: APP_ID,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const capture = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode,
    authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
  });
  if (bearerToken !== null) {
    await coordinator.transition(capture, {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
        sessionId: SESSION_ID,
        userId: USER_ID,
      },
      bearer: bearerToken,
      refreshAfterMs: 60_000,
    }, 'test_session_fixture');
  }
  return new SnapbackClient('http://stub', { ...options, authCoordinator: coordinator });
};

const agentHandshake = () => {
  const value = handshake({ activeMode: 'sessions' });
  value.clientProtocols.authInvalidation = 1;
  value.clientProtocols.authorityDescriptor = 1;
  value.availability.authScopedLive.minimumAuthInvalidationProtocol = 1;
  value.availability.retainedReads = {
    available: false,
    minimumAuthInvalidationProtocol: 1,
    minimumAuthorizedLeaseProtocol: 1,
    reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
  };
  value.availability.queuedReplay.minimumAuthorityDescriptorProtocol = 1;
  value.authorityDescriptor.sessionGeneration = 0;
  value.authorityDescriptor.authorityInstanceId = deriveServiceAuthorityInstanceId(
    agentCredential(AGENT_TOKEN_A, 'descriptor-only'),
  );
  value.authority = {
    kind: 'servicePrincipal',
    userId: USER_ID,
    sessionId: null,
    isAuthenticated: true,
  };
  return value;
};

const agentCredential = (tokenId, bearerToken, overrides = {}) => ({
  actorUserId: USER_ID,
  credentialId: AGENT_CREDENTIAL_ID,
  credentialGeneration: 3,
  grantId: AGENT_GRANT_ID,
  tokenId,
  bearerToken,
  ...overrides,
});

try {
  await suite.check('dev rediscovers before every online operation and preserves legacy body authority', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') return response(handshake());
      if (path === '/query/listTodos') return response({ rows: [] });
      if (path === '/action/reindex') return response({ ok: true });
      throw new Error(`unexpected path ${path}`);
    };
    const db = await coordinatedClient();
    await db.query('listTodos', { userId: 'user_ada' });
    await db.action('reindex', { userId: 'user_ada' });
    assertEqual(calls.map(({ path }) => path), [
      '/auth/session',
      '/query/listTodos',
      '/auth/session',
      '/action/reindex',
    ]);
    assertEqual(JSON.parse(calls[1].init.body).auth.user_id, 'user_ada');
    return { requests: calls.length };
  });

  await suite.check('sessions repeat protocol/bearer and strip every legacy authority field', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') {
        return response(handshake({ activeMode: 'sessions' }));
      }
      if (path === '/mutation/updateTodo') return response({ result: null });
      throw new Error(`unexpected path ${path}`);
    };
    const db = await coordinatedClient({
      bearerToken: 'session-secret',
      authorityDescriptorProtocol: 1,
    });
    await db.mutate('updateTodo', {
      userId: 'forged-user',
      clientMutationId: 'cm_1',
      ctxLedger: { auth_fingerprint: 'forged', answers: [] },
    });
    const discoveryHeaders = calls[0].init.headers;
    assertEqual(discoveryHeaders.authorization, 'Bearer session-secret');
    assertEqual(discoveryHeaders['x-snapback-auth-client-protocol'], '1');
    const request = calls[1];
    assertEqual(request.init.headers.authorization, 'Bearer session-secret');
    assertEqual(request.init.headers['x-snapback-auth-client-protocol'], '1');
    assertEqual(request.init.headers['x-snapback-authority-descriptor-protocol'], '1');
    const body = JSON.parse(request.init.body);
    assert(!Object.hasOwn(body, 'auth'), 'sessions mutation omitted body auth');
    assert(!Object.hasOwn(body.ctx_ledger, 'auth_fingerprint'), 'sessions ledger omitted legacy fingerprint');
    assertEqual(body.authorityDescriptor.authorityInstanceId, AUTHORITY);
    return { bodyKeys: Object.keys(body).sort() };
  });

  await suite.check('connection open forces a fresh discovery for that attempt', async () => {
    const calls = [];
    let generation = 0;
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') {
        generation += 1;
        return response(handshake({ nonce: 'startup-connection', generation }));
      }
      if (path === '/query/listTodos') return response({ rows: [] });
      if (path === '/connection/open') {
        return response({ connectionId: 'granted-1', connectionToken: 'sct_1' });
      }
      throw new Error(`unexpected path ${path}`);
    };
    const db = await coordinatedClient();
    await db.query('listTodos');
    await db.connectionGrant('client-label');
    assertEqual(calls.map(({ path }) => path), [
      '/auth/session',
      '/query/listTodos',
      '/auth/session',
      '/connection/open',
    ]);
    return { discoveries: generation };
  });

  await suite.check('an unavailable forced probe preserves the last projection for offline fences', async () => {
    let offline = false;
    let calls = 0;
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      calls += 1;
      if (offline) throw new TypeError('fetch failed');
      return response(handshake({ activeMode: 'sessions', nonce: 'offline-cache' }));
    };
    const db = await coordinatedClient({ bearerToken: 'session-secret' });
    const established = await db.authSession();
    offline = true;
    await assertThrows(() => db.authSession({ force: true }));
    const cached = await db.authSession();
    assertEqual(cached.serverStartupNonce, established.serverStartupNonce);
    assertEqual(calls, 2, 'the offline cache read performs no third network probe');
    return { preserved: true };
  });

  await suite.check('concurrent forced offline probes share only the in-flight rejection', async () => {
    let calls = 0;
    let releaseOffline;
    const offline = new Promise((_, reject) => { releaseOffline = reject; });
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      calls += 1;
      if (calls === 1) {
        return response(handshake({ activeMode: 'sessions', nonce: 'concurrent-cache' }));
      }
      await offline;
      assert(false, 'the offline sentinel never resolves');
    };
    const db = await coordinatedClient({ bearerToken: 'session-secret' });
    const established = await db.authSession();
    const first = db.authSession({ force: true });
    const second = db.authSession({ force: true });
    assertEqual(first, second, 'concurrent forced probes share one transport attempt');
    releaseOffline(new TypeError('fetch failed'));
    const [firstResult, secondResult] = await Promise.allSettled([first, second]);
    assertEqual(firstResult.status, 'rejected');
    assertEqual(secondResult.status, 'rejected');
    const cached = await db.authSession();
    assertEqual(cached.serverStartupNonce, established.serverStartupNonce);
    assertEqual(calls, 2, 'a rejected in-flight promise was not restored as the cache');
    return { sharedAttempt: true };
  });

  await suite.check('a same-turn force does not share a cached non-force lookup', async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      calls += 1;
      return response(handshake({ nonce: `force-after-cache-${calls}`, generation: calls }));
    };
    const db = await coordinatedClient();
    await db.authSession();
    const cached = db.authSession();
    const forced = db.authSession({ force: true });
    assert(cached !== forced, 'force owns a fresh transport attempt, not the cached lookup');
    const [cachedSession, forcedSession] = await Promise.all([cached, forced]);
    assertEqual(cachedSession.serverStartupNonce, 'force-after-cache-1');
    assertEqual(forcedSession.serverStartupNonce, 'force-after-cache-2');
    assertEqual(calls, 2);
    return { forcedFresh: true };
  });

  await suite.check('an invalid handshake clears rather than revives the last projection', async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      calls += 1;
      if (calls === 1) return response(handshake({ nonce: 'valid-before-invalid' }));
      if (calls === 2) {
        return response({ ...handshake({ nonce: 'invalid-response' }), protocolVersion: 99 });
      }
      return response(handshake({ nonce: 'fresh-after-invalid' }));
    };
    const db = await coordinatedClient();
    await db.authSession();
    const error = await assertThrows(() => db.authSession({ force: true }));
    assertEqual(error.diagnostic.code, 'SNAPBACK_AUTH_HANDSHAKE_INVALID');
    const recovered = await db.authSession();
    assertEqual(recovered.serverStartupNonce, 'fresh-after-invalid');
    assertEqual(calls, 3, 'invalid validation cannot leave the predecessor projection cached');
    return { cleared: true };
  });

  await suite.check('authorized lease renewal offers both exact protocols after fresh discovery', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') {
        return response(handshake({ activeMode: 'sessions' }));
      }
      if (path === '/query/myHand/authorized-lease') {
        return response({ version: 7, rows: [], authorizedLease: { leaseId: 'lease_1' } });
      }
      throw new Error(`unexpected path ${path}`);
    };
    const db = await coordinatedClient({
      bearerToken: 'session-secret',
      authInvalidationProtocol: 1,
      authorizedLeaseProtocol: 1,
    });
    const result = await db.authorizedLeaseQuery('myHand', {
      args: { gameId: 'game_1' },
      userId: 'forged-user',
      leaseRequestId: 'request_1',
      authorizationNamespace: {
        clientStoreId: 'store_1',
        queryKey: 'myHand:{"gameId":"game_1"}',
        queryInstanceId: 3,
      },
    });
    assertEqual(result.version, 7);
    assertEqual(calls.map(({ path }) => path), [
      '/auth/session',
      '/query/myHand/authorized-lease',
    ]);
    const request = calls[1];
    assertEqual(request.init.headers['x-snapback-auth-invalidation-protocol'], '1');
    assertEqual(request.init.headers['x-snapback-authorized-lease-protocol'], '1');
    const body = JSON.parse(request.init.body);
    assert(!Object.hasOwn(body, 'auth'), 'sessions lease request omitted body auth');
    assertEqual(body.leaseRequestId, 'request_1');
    assertEqual(body.queryInstanceId, 3);
    return { bodyKeys: Object.keys(body).sort() };
  });

  await suite.check('pending handshake blocks bytes before the requested operation', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') {
        return response(handshake({
          desiredMode: 'sessions',
          modeState: 'pendingRestart',
          available: false,
          reason: 'SNAPBACK_AUTH_MODE_PENDING',
        }));
      }
      throw new Error(`operation crossed pending handshake: ${path}`);
    };
    const db = await coordinatedClient();
    const error = await assertThrows(() => db.query('listTodos'));
    assertEqual(error.diagnostic.code, 'SNAPBACK_AUTH_MODE_PENDING');
    assertEqual(calls.map(({ path }) => path), ['/auth/session']);
    return { blocked: true };
  });

  await suite.check('poisoned successful handshakes reject unknown root and nested bearer fields', async () => {
    for (const nested of [false, true]) {
      globalThis.fetch = async () => {
        const poisoned = handshake({ activeMode: 'sessions' });
        if (nested) poisoned.authority.bearer = BEARER_SENTINEL;
        else poisoned.bearer = BEARER_SENTINEL;
        return response(poisoned);
      };
      const db = await coordinatedClient({ bearerToken: BEARER_SENTINEL });
      const error = await assertThrows(
        () => db.authSession({ force: true }),
        'SNAPBACK_AUTH_HANDSHAKE_INVALID',
        `expected ${nested ? 'nested' : 'root'} poison refusal`,
      );
      assert(!JSON.stringify({
        message: error.message,
        diagnostic: error.diagnostic,
      }).includes(BEARER_SENTINEL), 'handshake refusal never republishes the bearer');
    }
    return { rejectedShapes: 2 };
  });

  // ENG-24987: an echoed protocol version the request did not offer is not a
  // capability; the whole response is rejected fail-closed, per axis.
  await suite.check('non-null echoes the request did not offer reject the whole handshake', async () => {
    const cases = [
      { axis: 'authInvalidation', options: {} },
      { axis: 'authorizedLease', options: {} },
      { axis: 'authorityDescriptor', options: { authorityDescriptorProtocol: null } },
    ];
    for (const { axis, options } of cases) {
      let observedHeaders = null;
      globalThis.fetch = async (url, init) => {
        assertEqual(new URL(url).pathname, '/auth/session');
        observedHeaders = init.headers ?? {};
        const poisoned = handshake({ activeMode: 'sessions' });
        poisoned.clientProtocols[axis] = 1;
        return response(poisoned);
      };
      const db = await coordinatedClient({
        bearerToken: 'session-secret',
        ...options,
      });
      const error = await assertThrows(
        () => db.authSession(),
        'SNAPBACK_AUTH_HANDSHAKE_INVALID',
        `expected the unsolicited ${axis} echo to reject the response`,
      );
      assertEqual(error.diagnostic.code, 'SNAPBACK_AUTH_HANDSHAKE_INVALID');
      assertEqual(
        observedHeaders[PROTOCOL_HEADERS[axis]],
        undefined,
        `the request must not have offered ${axis}`,
      );
    }
    return { rejectedAxes: cases.length };
  });

  await suite.check('auth-client protocol 1 requires an explicit custody owner and cannot be suppressed', async () => {
    const error = await assertThrows(
      () => new SnapbackClient('http://stub', { authClientProtocol: 1 }),
      undefined,
      'protocol 1 without coordinator custody must fail construction',
    );
    assert(error instanceof TypeError, 'the invalid construction is a caller type error');
    assert(
      error.message.includes('requires browser or agent authority custody'),
      'the refusal names the missing custody owner',
    );

    let observedHeaders = null;
    globalThis.fetch = async (url, init) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      observedHeaders = init.headers ?? {};
      return response(handshake());
    };
    const db = await coordinatedClient({
      authClientProtocol: null,
      authorityDescriptorProtocol: null,
    });
    await db.authSession();
    assertEqual(observedHeaders[PROTOCOL_HEADERS.authClient], '1');
    assertEqual(observedHeaders[PROTOCOL_HEADERS.authorityDescriptor], undefined);
    return { rejectedUncoordinated: true, coordinatedOffer: 1 };
  });

  await suite.check('a fresh durable agent request binds its transport fence after validated bootstrap', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === '/auth/session') return response(agentHandshake());
      if (path === '/query/listTodos') return response({ rows: [{ id: 'fresh-agent-row' }] });
      throw new Error(`unexpected path ${path}`);
    };
    const authority = new AgentAuthorityFence(
      agentCredential(AGENT_TOKEN_A, 'agent-token-a'),
      {
        storage: createMemoryAgentAuthorityCustodyStorage(),
        custodyId: 'agent:fresh-direct-request',
      },
    );
    const db = new SnapbackClient('http://stub', {
      agentAuthority: authority,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'fresh_agent_store',
    });
    const result = await db.query('listTodos');
    assertEqual(result.rows[0].id, 'fresh-agent-row');
    assertEqual(
      calls,
      ['/auth/session', '/query/listTodos'],
      'the bootstrap barrier generation becomes the request baseline, not a stale entry sample',
    );
    await db.closeAuth();
    return { calls };
  });

  await suite.check('an invalid live agent replacement leaves predecessor custody untouched', async () => {
    const storage = createMemoryAgentAuthorityCustodyStorage();
    const initial = agentCredential(AGENT_TOKEN_A, 'agent-token-a');
    const authority = new AgentAuthorityFence(initial, {
      storage,
      custodyId: 'agent:invalid-live-replacement',
    });
    let rejectReplacement = false;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session' && rejectReplacement) {
        return response({
          diagnostic: {
            code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
            message: 'the proposed replacement bearer is invalid',
            details: { authorityDisposition: 'carrier' },
          },
        }, 401);
      }
      if (path === '/auth/session') return response(agentHandshake());
      if (path === '/query/listTodos') return response({ rows: [{ id: 'predecessor-still-live' }] });
      throw new Error(`unexpected path ${path}`);
    };
    const db = new SnapbackClient('http://stub', {
      agentAuthority: authority,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
    });
    await db.authSession();
    const predecessor = authority.capture();
    const before = storage.snapshot('agent:invalid-live-replacement');
    let blanks = 0;
    const unregister = db.registerAuthMaterialization({
      capture: () => predecessor,
      blank: () => { blanks += 1; },
    });
    rejectReplacement = true;
    const replacementError = await assertThrows(
      () => db.replaceAgentCredential(agentCredential(AGENT_TOKEN_B, 'invalid-new-bearer', {
        grantId: '018f0d90-7b2b-7a22-8c33-445566778899',
      })),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
    );
    assert(authority.isCurrent(predecessor), 'the exact predecessor remains current');
    assertEqual(
      storage.snapshot('agent:invalid-live-replacement'),
      before,
      'an invalid proposal performs no durable write',
    );
    assertEqual(blanks, 0, 'an invalid proposal never enters the destructive barrier');
    assertEqual(authority.credentialFor(predecessor).bearer, initial.bearerToken);
    rejectReplacement = false;
    assertEqual((await db.query('listTodos')).rows[0].id, 'predecessor-still-live');
    unregister();
    await db.closeAuth();
    return { code: replacementError.code, blanks };
  });

  await suite.check('agent custody preserves durable replay across token churn and fences stale carrier work', async () => {
    const calls = [];
    let releaseQuery;
    let queryEntered;
    const queryStarted = new Promise((resolve) => { queryEntered = resolve; });
    const queryRelease = new Promise((resolve) => { releaseQuery = resolve; });
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') {
        const projected = agentHandshake();
        if (init.headers.authorization === 'Bearer other-grant-token') {
          projected.authorityDescriptor.authorityInstanceId = deriveServiceAuthorityInstanceId(
            agentCredential(AGENT_TOKEN_A, 'other-grant-token', {
              grantId: '018f0d90-7b2b-7a22-8c33-445566778899',
            }),
          );
        }
        return response(projected);
      }
      if (path === '/query/listTodos') {
        queryEntered();
        await queryRelease;
        return response({ rows: [{ id: 'stale' }] });
      }
      if (path === '/mutation/updateTodo') return response({ result: 'settled' });
      throw new Error(`unexpected path ${path}`);
    };

    const authority = new AgentAuthorityFence(agentCredential(AGENT_TOKEN_A, 'agent-token-a'));
    const db = new SnapbackClient('http://stub', {
      agentAuthority: authority,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      clientStoreId: 'agent_store',
    });
    const established = await db.authSession();
    assertEqual(
      established.authorityDescriptor.authorityInstanceId,
      deriveServiceAuthorityInstanceId(agentCredential(AGENT_TOKEN_A, 'descriptor-only')),
    );
    assertEqual(established.authority.kind, 'servicePrincipal');

    const tokenACapture = authority.capture();
    const staleQuery = db.query('listTodos');
    await queryStarted;
    await db.replaceAgentCredential(agentCredential(AGENT_TOKEN_B, 'agent-token-b'));
    const tokenBCapture = authority.capture();
    assertEqual(
      authority.terminate(tokenACapture),
      false,
      'a late terminal result for token A cannot close same-grant token B',
    );
    assert(authority.isCurrent(tokenBCapture), 'token B remains current after token A terminates');
    releaseQuery();
    const staleError = await assertThrows(() => staleQuery);
    assertEqual(staleError.code, 'SNAPBACK_CLIENT_AUTHORITY_STALE');

    const mutation = await db.mutate('updateTodo', { clientMutationId: 'agent-cm-1' });
    assertEqual(mutation.result, 'settled');
    const mutationCall = calls.find(({ path }) => path === '/mutation/updateTodo');
    assertEqual(mutationCall.init.headers.authorization, 'Bearer agent-token-b');
    assertEqual(
      JSON.parse(mutationCall.init.body).authorityDescriptor.authorityInstanceId,
      deriveServiceAuthorityInstanceId(agentCredential(AGENT_TOKEN_B, 'agent-token-b')),
      'replacement tokens for one durable grant retain its replay axis',
    );

    const beforeGrantChange = authority.capture();
    await db.replaceAgentCredential(agentCredential(AGENT_TOKEN_A, 'other-grant-token', {
      grantId: '018f0d90-7b2b-7a22-8c33-445566778899',
    }));
    assert(!authority.isCurrent(beforeGrantChange), 'a changed durable grant invalidates prior work');
    assertEqual(
      authority.authorityDescriptor.authorityInstanceId,
      deriveServiceAuthorityInstanceId(agentCredential(AGENT_TOKEN_A, 'other-grant-token', {
        grantId: '018f0d90-7b2b-7a22-8c33-445566778899',
      })),
      'a changed durable grant binds only its newly validated descriptor',
    );
    return { requests: calls.length, staleCarrierRefused: true };
  });

  await suite.check('agent custody rejects a browser-session authority projection', async () => {
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      const value = agentHandshake();
      value.authority = {
        kind: 'humanSession',
        userId: USER_ID,
        sessionId: SESSION_ID,
        isAuthenticated: true,
      };
      value.authorityDescriptor = {
        descriptorVersion: 1,
        authorityInstanceId: SESSION_ID,
        sessionGeneration: 1,
      };
      return response(value);
    };
    const authority = new AgentAuthorityFence(agentCredential(AGENT_TOKEN_A, 'agent-token-a'));
    const db = new SnapbackClient('http://stub', {
      agentAuthority: authority,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
    });
    const error = await assertThrows(
      () => db.authSession(),
      'SNAPBACK_AUTH_HANDSHAKE_INVALID',
      'agent custody must not adopt a human browser session',
    );
    assert(
      error.diagnostic.message.includes('service-principal'),
      'the refusal identifies the required carrier kind',
    );
    return { rejectedKind: 'humanSession' };
  });

  await suite.check('agent credential replacement cuts the carrier despite a broken direct blank', async () => {
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      return response(agentHandshake());
    };
    const authority = new AgentAuthorityFence(agentCredential(AGENT_TOKEN_A, 'agent-token-a'));
    const db = new SnapbackClient('http://stub', {
      agentAuthority: authority,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
    });
    const predecessor = authority.capture();
    const unregister = db.registerAuthMaterialization({
      capture: () => predecessor,
      blank: () => { throw new Error('injected direct blank failure'); },
    });
    const error = await assertThrows(
      () => db.replaceAgentCredential(agentCredential(AGENT_TOKEN_B, 'agent-token-b')),
      undefined,
      'the broken direct blank is surfaced after replacement',
    );
    assert(error.message.includes('injected direct blank failure'));
    assert(!authority.isCurrent(predecessor), 'the predecessor carrier is no longer current');
    const closed = await assertThrows(
      () => authority.capture(),
      'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'a failed blank wedges publication instead of reopening a partial successor',
    );
    unregister();
    return { predecessorCurrent: false, closedCode: closed.code };
  });

  await suite.check('exactly offered echoes still project on every axis', async () => {
    globalThis.fetch = async (url, init) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      for (const header of Object.values(PROTOCOL_HEADERS)) {
        assertEqual(init.headers[header], '1', `expected the ${header} offer`);
      }
      const echoed = handshake({ activeMode: 'sessions' });
      echoed.clientProtocols = {
        authClient: 1,
        authInvalidation: 1,
        authorityDescriptor: 1,
        authorizedLease: 1,
      };
      return response(echoed);
    };
    const db = await coordinatedClient({
      bearerToken: 'session-secret',
      authInvalidationProtocol: 1,
      authorizedLeaseProtocol: 1,
    });
    const session = await db.authSession();
    assertEqual(session.clientProtocols, {
      authClient: 1,
      authInvalidation: 1,
      authorityDescriptor: 1,
      authorizedLease: 1,
    });
    return { projectedAxes: 4 };
  });

  // ENG-24986: an all-numeric bearer reflected as a JSON number in an error
  // diagnostic is compared in canonical string form and redacted.
  await suite.check('numeric bearer reflections in error diagnostics are redacted', async () => {
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') return response(handshake({ activeMode: 'sessions' }));
      assertEqual(path, '/query/listTodos');
      return response({
        diagnostic: {
          code: 'SNAPBACK_TEST_NUMERIC_ECHO',
          message: 'request refused',
          details: {
            reflected: Number(NUMERIC_BEARER_SENTINEL),
            nested: [Number(NUMERIC_BEARER_SENTINEL)],
            text: `bearer ${NUMERIC_BEARER_SENTINEL}`,
          },
        },
      }, 500);
    };
    const db = await coordinatedClient({ bearerToken: NUMERIC_BEARER_SENTINEL });
    const error = await assertThrows(
      () => db.query('listTodos'),
      'SNAPBACK_TEST_NUMERIC_ECHO',
      'expected the sanitized server diagnostic',
    );
    const bytes = JSON.stringify({ message: error.message, diagnostic: error.diagnostic });
    assert(!bytes.includes(NUMERIC_BEARER_SENTINEL), 'numeric bearer reflection escaped');
    assertEqual(error.diagnostic.details.reflected, '[REDACTED]');
    assertEqual(error.diagnostic.details.nested, ['[REDACTED]']);
    return { redacted: true };
  });

  await suite.check('authorized-lease capability facts are exact v1 constants', async () => {
    const validFacts = {
      protocolVersion: 1,
      defaultMs: 86_400_000,
      hardMaxMs: 86_400_000,
      configuredMs: 60_000,
      clamps: ['session', 'provider'],
      renewal: 'full-revalidation',
      timeBasis: 'server-absolute+client-request-elapsed',
      clockRollback: 'delete-before-read',
    };
    for (const authorizedLease of [
      { ...validFacts, defaultMs: Number.MAX_SAFE_INTEGER },
      { ...validFacts, hardMaxMs: Number.MAX_SAFE_INTEGER },
      { ...validFacts, configuredMs: 0 },
    ]) {
      globalThis.fetch = async () => response({
        ...handshake({ activeMode: 'sessions' }),
        authorizedLease,
      });
      const db = await coordinatedClient({ bearerToken: 'session-secret' });
      const error = await assertThrows(() => db.authSession({ force: true }));
      assertEqual(error.diagnostic.code, 'SNAPBACK_AUTH_HANDSHAKE_INVALID');
    }
    return { rejectedFacts: 3 };
  });

  await suite.check('a delayed custody broadcast cannot publish a stale fresh handshake', async () => {
    const state = { custody: {} };
    const queuedBroadcasts = [];
    const channels = new Set();
    const broadcastChannelFactory = () => {
      const channel = {
        onmessage: null,
        postMessage(message) {
          queuedBroadcasts.push({ source: channel, message: structuredClone(message) });
        },
        close() { channels.delete(channel); },
      };
      channels.add(channel);
      return channel;
    };
    const storage = createMemoryAuthCustodyStorage({ state });
    const coordinatorA = new AuthCoordinator({
      appId: APP_ID,
      storage,
      broadcastChannelFactory,
      hintStorage: null,
    });
    const coordinatorB = new AuthCoordinator({
      appId: APP_ID,
      storage: createMemoryAuthCustodyStorage({ state }),
      broadcastChannelFactory,
      hintStorage: null,
    });
    const captureA = await coordinatorA.establishAnonymous({
      kind: 'anonymous',
      authMode: 'dev',
      authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
    });
    await coordinatorB.synchronize();
    const captureB = coordinatorB.capture();
    assertEqual(captureB.authorityKey, captureA.authorityKey);
    const db = new SnapbackClient('http://stub', { authCoordinator: coordinatorA });

    let releaseStale;
    let staleRequestEntered;
    const staleEntered = new Promise((resolve) => { staleRequestEntered = resolve; });
    const staleRelease = new Promise((resolve) => { releaseStale = resolve; });
    let calls = 0;
    globalThis.fetch = async (url) => {
      assertEqual(new URL(url).pathname, '/auth/session');
      calls += 1;
      if (calls === 1) {
        staleRequestEntered();
        await staleRelease;
        return response(handshake({ nonce: 'stale-anonymous-response' }));
      }
      return response(handshake({ activeMode: 'sessions', nonce: `fresh-session-${calls}` }));
    };

    const pending = db.authSession({ force: true });
    await staleEntered;
    await coordinatorB.transition(captureB, {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
        sessionId: SESSION_ID,
        userId: USER_ID,
      },
      bearer: 'session-successor',
      refreshAfterMs: 60_000,
    }, 'delayed_broadcast_race');
    assert(queuedBroadcasts.length > 0, 'successor wakeups remain delayed');
    releaseStale();
    const projected = await pending;
    assertEqual(projected.authority.isAuthenticated, true);
    assert(
      projected.serverStartupNonce.startsWith('fresh-session-'),
      'the stale anonymous response never escaped the durable final fence',
    );
    const cached = await db.authSession();
    assertEqual(cached.authority.isAuthenticated, true);
    assert(
      cached.serverStartupNonce.startsWith('fresh-session-'),
      'the durable cache also excludes the stale anonymous response',
    );
    assert(calls >= 2, 'stale final comparison forced a successor handshake');
    await db.closeAuth();
    await coordinatorB.close();
    await coordinatorA.close();
    return { delayedWakeups: queuedBroadcasts.length, requests: calls };
  });
} finally {
  globalThis.fetch = originalFetch;
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
