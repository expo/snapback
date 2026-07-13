// Bootstrap auth-handshake network sentinel (no server required).

import { SnapbackClient } from '../client.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../harness.mjs';

const suite = createSuite('_kit auth handshake', { expectedChecks: 4 });
const originalFetch = globalThis.fetch;
const AUTHORITY = '018f0d90-7b24-7a22-8c33-445566778899';

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
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
} = {}) => ({
  protocolVersion: 1,
  serverStartupNonce: nonce,
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
  authority: { userId: null, sessionId: null, isAuthenticated: false },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: AUTHORITY,
    sessionGeneration: activeMode === 'sessions' ? 1 : 0,
  },
});

try {
  await suite.check('dev discovers once before online work and preserves legacy body authority', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, init });
      if (path === '/auth/session') return response(handshake());
      if (path === '/query/listTodos') return response({ rows: [] });
      if (path === '/action/reindex') return response({ ok: true });
      throw new Error(`unexpected path ${path}`);
    };
    const db = new SnapbackClient('http://stub');
    await db.query('listTodos', { userId: 'user_ada' });
    await db.action('reindex', { userId: 'user_ada' });
    assertEqual(calls.map(({ path }) => path), [
      '/auth/session',
      '/query/listTodos',
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
    const db = new SnapbackClient('http://stub', {
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
    const db = new SnapbackClient('http://stub');
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
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.query('listTodos'));
    assertEqual(error.diagnostic.code, 'SNAPBACK_AUTH_MODE_PENDING');
    assertEqual(calls.map(({ path }) => path), ['/auth/session']);
    return { blocked: true };
  });
} finally {
  globalThis.fetch = originalFetch;
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
