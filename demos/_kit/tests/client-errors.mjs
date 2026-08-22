// Kit client error-path regression suite (no server required).
//
// Exercises the HTTP and live-stream failure seams of the shared bridge with a
// stubbed fetch/WebSocket, so the checks run with plain `node` and no Snapback
// server, Chrome, or Exact checkout.
//
// @ref LLP 0032#confirmed-defect-register — pins S5.D3 (non-JSON bodies become
//   structured diagnostics, never bare SyntaxErrors) and S5.D7 (a closed stream
//   latches, so nextUpdate() after close rejects instead of hanging).
//
// Also pins ENG-23391: the delivery choke points (drainConnection and the
// socket dispatch) isolate consumer exceptions and per-envelope decode
// failures, so one throwing app callback never discards the rest of a
// destructively drained batch or escapes as an unhandled rejection. LLP 0095
// T-DB-P additionally requires a post-cut decode failure to synthesize
// connection-wide recovery while that remainder continues.

import {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
  deriveServiceAuthorityInstanceId,
  EphemeralOverlay,
  SnapbackClient as RuntimeSnapbackClient,
} from '../client.mjs';
import { AdminClient } from '../../../packages/snapback-admin-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../harness.mjs';

// This suite isolates existing transport/error seams with request-specific
// fetch stubs. Handshake behavior has its own network-sentinel suite; disabling
// discovery here keeps each stub's asserted request boundary single-purpose.
class SnapbackClient extends RuntimeSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, { authClientProtocol: null, ...options });
  }
}

class FakeWebSocket {
  static instances = [];
  constructor(url, protocols = []) {
    this.url = url;
    this.protocols = protocols;
    this.listeners = new Map();
    this.sent = [];
    this.closeCalls = 0;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, handler, options) {
    const list = this.listeners.get(type) ?? [];
    list.push({ handler, once: options?.once ?? false });
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((entry) => !entry.once));
    for (const entry of list) entry.handler(event);
  }
  send(message) {
    this.sent.push(message);
  }
  close() {
    this.closeCalls += 1;
    this.dispatch('close', {});
  }
}

const stubFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

// ENG-23442: openLiveStream resolves a connection grant before constructing
// the socket, so stream tests stub the grant response and await the async
// socket construction instead of grabbing it synchronously.
const grantFetch = (connectionId) => stubFetch(200, JSON.stringify({
  connectionId,
  connectionToken: 'sct_stub_token',
}));

const AUTHORIZATION_INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7b25-7a22-8c33-445566778899';
const USER_ID = '018f0d90-7b26-7a22-8c33-445566778899';
const AGENT_CREDENTIAL_ID = '018f0d90-7b27-7a22-8c33-445566778899';
const AGENT_GRANT_ID = '018f0d90-7b28-7a22-8c33-445566778899';
const AGENT_TOKEN_A = '018f0d90-7b29-7a22-8c33-445566778899';
const AGENT_TOKEN_B = '018f0d90-7b2a-7a22-8c33-445566778899';
const agentCredential = (tokenId, bearerToken) => ({
  actorUserId: USER_ID,
  credentialId: AGENT_CREDENTIAL_ID,
  credentialGeneration: 1,
  grantId: AGENT_GRANT_ID,
  tokenId,
  bearerToken,
});

const agentDescriptor = (value) => ({
  descriptorVersion: 1,
  authorityInstanceId: deriveServiceAuthorityInstanceId(value),
  sessionGeneration: 0,
});
let coordinatorSequence = 0;
const coordinatorCustody = async ({ session = false } = {}) => {
  coordinatorSequence += 1;
  const coordinator = new AuthCoordinator({
    appId: `snapback.test/client-errors-${coordinatorSequence}`,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const anonymous = await coordinator.establishAnonymous({
    kind: 'anonymous',
    authMode: session ? 'sessions' : 'dev',
    authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
  });
  if (session) {
    await coordinator.transition(anonymous, {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
        sessionId: SESSION_ID,
        userId: USER_ID,
      },
      bearer: 'session_bearer',
      refreshAfterMs: 60_000,
    }, 'client_error_fixture');
  }
  return coordinator;
};

const terminalCoordinatorSpy = () => {
  const capture = Object.freeze({
    authorityEpoch: 7,
    custodyRevision: 11,
    authorityKey: `sha256:${'a'.repeat(64)}`,
  });
  const clears = [];
  let current = true;
  return {
    appId: 'snapback.test/client-errors-terminal-spy',
    clears,
    capture: () => capture,
    synchronize: async () => capture,
    credentialFor: () => ({ bearer: null }),
    isCurrent: (candidate) => current && candidate === capture,
    waitForNewerRevision: async () => null,
    registerParticipant: () => async () => {},
    compareAndCommit: async (candidate, commit) => (
      candidate === capture && current
        ? { committed: true, value: commit({ ...capture, authority: { kind: 'anonymous' } }) }
        : { committed: false }
    ),
    compareAndClear: async (candidate, reason) => {
      clears.push({ candidate, reason });
      if (candidate !== capture || !current) return { cleared: false };
      current = false;
      return { cleared: true };
    },
  };
};

const terminalCoordinatorBarrierSpy = () => {
  const capture = Object.freeze({
    authorityEpoch: 8,
    custodyRevision: 12,
    authorityKey: `sha256:${'b'.repeat(64)}`,
  });
  const participants = [];
  let current = true;
  const coordinator = {
    appId: 'snapback.test/client-errors-terminal-barrier-spy',
    capture: () => capture,
    synchronize: async () => capture,
    credentialFor: () => ({ bearer: null }),
    isCurrent: (candidate) => current && candidate === capture,
    waitForNewerRevision: async () => null,
    registerParticipant(participant, { before = null } = {}) {
      const index = before === null ? -1 : participants.indexOf(before);
      if (index === -1) participants.push(participant);
      else participants.splice(index, 0, participant);
      return async () => {
        const registered = participants.indexOf(participant);
        if (registered !== -1) participants.splice(registered, 1);
      };
    },
    compareAndCommit: async (candidate, commit) => (
      candidate === capture && current
        ? { committed: true, value: commit({ ...capture, authority: { kind: 'session' } }) }
        : { committed: false }
    ),
    async compareAndClear(candidate) {
      if (candidate !== capture || !current) return { cleared: false };
      const context = Object.freeze({
        expectedEpoch: capture.authorityEpoch,
        expectedAuthorityKey: capture.authorityKey,
        reason: 'terminal_test_clear',
        disposition: 'delete',
      });
      for (const participant of participants) await participant.quiesce?.(context);
      for (const participant of participants) participant.blank?.(context);
      for (const participant of participants) participant.clearMemory?.(context);
      for (const participant of participants) await participant.commitDurable?.(context);
      current = false;
      return { cleared: true };
    },
    transportParticipant: () => participants.at(-1),
  };
  return coordinator;
};

const missedWakeupCoordinatorSpy = () => {
  const capture = Object.freeze({
    authorityEpoch: 3,
    custodyRevision: 5,
    authorityKey: `sha256:${'b'.repeat(64)}`,
  });
  let durableCapture = capture;
  let inCommit = false;
  let advanceAfterCommit = false;
  const advanceDurable = () => {
    durableCapture = Object.freeze({
      authorityEpoch: capture.authorityEpoch + 1,
      custodyRevision: capture.custodyRevision + 1,
      authorityKey: `sha256:${'c'.repeat(64)}`,
    });
  };
  return {
    appId: 'snapback.test/client-errors-missed-wakeup',
    capture: () => capture,
    synchronize: async () => capture,
    credentialFor: () => ({ bearer: null }),
    // Deliberately remains true after advanceDurable(): this models the lost
    // broadcast wakeup that made the original client paths unsafe.
    isCurrent: (candidate) => candidate === capture,
    registerParticipant: () => async () => {},
    advanceDurable,
    advanceDurableAfterNextCommit() {
      advanceAfterCommit = true;
    },
    transitionDuringCommit() {
      if (inCommit) throw new Error('transition refused during synchronous publication');
    },
    compareAndCommit: async (candidate, commit) => {
      if (
        candidate?.authorityEpoch !== durableCapture.authorityEpoch
        || candidate?.custodyRevision !== durableCapture.custodyRevision
        || candidate?.authorityKey !== durableCapture.authorityKey
      ) return { committed: false };
      inCommit = true;
      try {
        const value = commit({ ...candidate, authority: { kind: 'session' } });
        if (advanceAfterCommit) {
          advanceAfterCommit = false;
          advanceDurable();
        }
        return { committed: true, value };
      } finally {
        inCommit = false;
      }
    },
    compareAndClear: async () => ({ cleared: false }),
  };
};

const nextSocket = async (countBefore) => {
  for (let i = 0; i < 200; i += 1) {
    if (FakeWebSocket.instances.length > countBefore) return FakeWebSocket.instances.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('stub WebSocket was never constructed');
};

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
// Node's experimental localStorage global throws without a backing file; give
// the admin client the browser-shaped API its constructor probes for.
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null },
  configurable: true,
  writable: true,
});
const suite = createSuite('_kit client / error paths');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const diagnosticError = (code, message = code, status = 409) => {
  const error = new Error(`${code}: ${message}`);
  error.diagnostic = { code, message };
  if (status !== null) error.status = status;
  return error;
};
const nextSentPing = async (ws, previousCount = 0) => {
  await waitFor(() => ws.sent.length > previousCount, 'readiness ping');
  const parsed = ws.sent.slice(previousCount).map((message) => JSON.parse(message));
  const ping = parsed.find((message) => message.type === 'ping');
  assert(ping, `expected a readiness ping, got ${JSON.stringify(parsed)}`);
  return ping;
};
const acknowledgePing = (ws, ping) => {
  ws.dispatch('message', { data: JSON.stringify({ kind: 'pong', requestId: ping.requestId }) });
};
const encodedValue = (value) => [...new TextEncoder().encode(JSON.stringify(value))];
const overlayRoom = { collection: 'presence', routing_key: '4:room=1:a' };
const snapshot = (
  scopeEpoch,
  entries = [],
  highWaterVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0),
) => ({
  Snapshot: {
    room: overlayRoom,
    scope_epoch: scopeEpoch,
    high_water_version: highWaterVersion,
    entries: entries.map(({ key, version, value }) => ({
      key,
      value: encodedValue(value),
      received_at_ms: 100 + version,
      expires_at_ms: 10_000,
      scope_epoch: scopeEpoch,
      entry_version: version,
    })),
  },
});

try {
  await suite.check('s5_d3: non-JSON 502 body throws structured SNAPBACK_HTTP_ERROR', async () => {
    globalThis.fetch = stubFetch(502, `<html><body>${'Bad Gateway '.repeat(50)}</body></html>`);
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'SNAPBACK_HTTP_ERROR', 'expected structured HTTP error');
    assertEqual(error.status, 502, 'status is carried on the error');
    assert(error.diagnostic.message.includes('HTTP 502'), `message names the status: ${error.diagnostic.message}`);
    assert(error.diagnostic.message.includes('Bad Gateway'), 'message carries a body snippet');
    assert(error.diagnostic.message.length < 300, 'body snippet is truncated');
    return { code: error.diagnostic.code, status: error.status };
  });

  await suite.check('s5_d3: 200 response with non-JSON body throws SNAPBACK_RESPONSE_NOT_JSON', async () => {
    globalThis.fetch = stubFetch(200, 'status: ok\nmode: yaml\n');
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'SNAPBACK_RESPONSE_NOT_JSON', 'expected structured parse error');
    assertEqual(error.status, 200, 'status is carried on the error');
    assert(error.diagnostic.message.includes('status: ok'), 'message carries a body snippet');
    return { code: error.diagnostic.code };
  });

  await suite.check('s5_d3: valid-JSON error responses still surface the server diagnostic unchanged', async () => {
    const diagnostic = { code: 'SNAPBACK_UNKNOWN_FUNCTION', message: 'no such function nope' };
    globalThis.fetch = stubFetch(400, JSON.stringify({ diagnostic }));
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.query('nope'), 'SNAPBACK_UNKNOWN_FUNCTION', 'expected server diagnostic passthrough');
    assertEqual(error.diagnostic, diagnostic, 'diagnostic object is the server payload');
    assertEqual(error.status, 400, 'status is carried on the error');
    return { code: error.diagnostic.code };
  });

  await suite.check('opaque connection refresh re-suggests wire identity and updates the successful overlay', async () => {
    const label = 'readable_connection_label';
    const originalGrant = { id: 'conn_opaque_original', token: 'sct_original' };
    const successorGrant = { id: 'conn_opaque_successor', token: 'sct_successor' };
    const openBodies = [];
    const subscribeBodies = [];
    const response = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(String(url)).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === '/connection/open') {
        openBodies.push(body);
        const granted = openBodies.length === 1 ? originalGrant : successorGrant;
        return response(200, {
          connectionId: granted.id,
          connectionToken: granted.token,
          ephemeralExpiryProtocol: 1,
          wireVersion: 'snapback.v1',
        });
      }
      if (path === '/ephemeral/subscribe') {
        subscribeBodies.push(body);
        if (subscribeBodies.length === 1) {
          return response(401, {
            diagnostic: {
              code: 'SNAPBACK_CONNECTION_TOKEN_INVALID',
              message: 'force the one bounded grant refresh',
            },
          });
        }
        return response(200, snapshot(2));
      }
      throw new Error(`unexpected opaque-grant retry request: ${path}`);
    };

    const db = new SnapbackClient('http://stub');
    const overlay = await db.subscribeEphemeral('presence', {
      connectionId: label,
      scope: { room: 'a' },
      transport: 'poll',
    });
    try {
      assertEqual(openBodies, [
        {
          connectionId: label,
          ephemeralExpiryProtocol: 1,
          wireVersion: 'snapback.v1',
        },
        {
          connectionId: originalGrant.id,
          ephemeralExpiryProtocol: 1,
          previousToken: originalGrant.token,
          wireVersion: 'snapback.v1',
        },
      ], 'refresh keeps the label-keyed cache but re-suggests the granted wire id');
      assertEqual(
        subscribeBodies.map((body) => body.connection_id),
        [originalGrant.id, successorGrant.id],
        'the retried subscribe uses the refreshed wire identity',
      );
      assertEqual(
        overlay.grantedConnectionId,
        successorGrant.id,
        'the returned overlay exposes the exact successful retry identity',
      );
      return { opens: openBodies.length, subscribes: subscribeBodies.length };
    } finally {
      overlay.dispose();
    }
  });

  await suite.check('fresh ephemeral subscribe owns a ready live stream until overlay disposal', async () => {
    globalThis.WebSocket = FakeWebSocket;
    const connectionId = 'conn_ephemeral_self_start';
    let subscribeRequests = 0;
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/connection/open') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            connectionId,
            connectionToken: 'sct_ephemeral_self_start',
            wireVersion: 'snapback.v1',
          }),
        };
      }
      if (path === '/ephemeral/subscribe') {
        subscribeRequests += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(snapshot(2, [], 0)),
        };
      }
      throw new Error(`unexpected self-start request: ${path}`);
    };

    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const subscribing = db.subscribeEphemeral('presence', {
      connectionId,
      scope: { room: 'a' },
      stream: {
        heartbeatIntervalMs: 5_000,
        freshnessBudgetMs: 20_000,
      },
    });
    const ws = await nextSocket(before);
    assertEqual(subscribeRequests, 0, 'snapshot subscribe waits for current-socket readiness');
    ws.dispatch('open', {});
    await waitFor(
      () => ws.sent.some((message) => JSON.parse(message).type === 'ping'),
      'self-start readiness ping',
    );
    const ping = ws.sent
      .map((message) => JSON.parse(message))
      .find((message) => message.type === 'ping');
    ws.dispatch('message', {
      data: JSON.stringify({ kind: 'pong', requestId: ping.requestId }),
    });

    const overlay = await subscribing;
    assertEqual(subscribeRequests, 1, 'snapshot subscribe starts after readiness proof');
    let changes = 0;
    const offChange = overlay.onChange(() => {
      changes += 1;
    });
    ws.dispatch('message', {
      data: JSON.stringify({
        kind: 'ephemeral',
        message: {
          Upsert: {
            room: overlayRoom,
            entry: {
              key: 'cursor_live',
              value: encodedValue({ x: 7 }),
              received_at_ms: 107,
              expires_at_ms: Date.now() + 10_000,
              scope_epoch: 2,
              entry_version: 1,
            },
          },
        },
      }),
    });
    await waitFor(
      () => overlay.currentEntries({ prune: false }).length === 1,
      'self-start ephemeral delta',
    );
    assertEqual(
      overlay.currentEntries({ prune: false })[0].value,
      { x: 7 },
      'the fresh subscription receives socket-delivered room changes',
    );
    assertEqual(changes, 1, 'the overlay notifies its change observer');

    offChange();
    overlay.dispose();
    await waitFor(() => ws.closeCalls > 0, 'overlay-owned stream demand release');
    return { subscribeRequests, changes, socketClosed: ws.closeCalls > 0 };
  });

  await suite.check('finite scoped-token carrier failures preserve durable custody', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'scoped agent token is invalid',
        details: { authorityDisposition: 'carrier' },
      },
    }));
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    const error = await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'carrier expiry must surface as a terminal request refusal',
    );
    assertEqual(error.authorityDisposition, 'carrier', 'the exact diagnostic classification is retained');
    assertEqual(authCoordinator.clears.length, 0, 'carrier expiry does not clear durable custody');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, clears: authCoordinator.clears.length };
  });

  await suite.check('finite scoped-token durable revocation deletes exact custody', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'scoped agent token is invalid',
        details: { authorityDisposition: 'durableDelete' },
      },
    }));
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    const error = await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'durable revocation must surface as a terminal request refusal',
    );
    assertEqual(error.authorityDisposition, 'durableDelete', 'the exact diagnostic classification is retained');
    assertEqual(authCoordinator.clears.length, 1, 'durable revocation clears exact custody');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, clears: authCoordinator.clears.length };
  });

  await suite.check('explicit external bearers latch finite terminal loss until real replacement', async () => {
    const results = [];
    for (const authorityDisposition of ['carrier', 'durableDelete']) {
      const originalBearer = `external_${authorityDisposition}`;
      const successor = authorityDisposition === 'carrier'
        ? `successor_${authorityDisposition}`
        : null;
      const db = new SnapbackClient('http://stub', {
        authClientProtocol: 1,
        bearerToken: originalBearer,
      });
      db.authSession = async () => ({
        activeMode: 'sessions',
        availability: { onlineRequestResponse: { available: true } },
      });
      const blankContexts = [];
      const unregister = db.registerAuthMaterialization({
        capture: () => null,
        blank: (context) => blankContexts.push(context),
      });
      let transportCalls = 0;
      let terminal = true;
      globalThis.fetch = async () => {
        transportCalls += 1;
        if (!terminal) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          diagnostic: {
            code: 'SNAPBACK_AUTH_SESSION_REVOKED',
            message: 'external bearer is terminal',
            details: { authorityDisposition },
          },
        }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      };

      const first = await assertThrows(
        () => db.query('privateRows'),
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'the external terminal diagnostic must surface',
      );
      assertEqual(first.authorityDisposition, authorityDisposition);
      assertEqual(blankContexts.length, 1, 'terminal loss cuts visible materializations once');
      assertEqual(blankContexts[0].authorityDisposition, authorityDisposition);
      assertEqual(
        blankContexts[0].disposition,
        authorityDisposition === 'durableDelete' ? 'delete' : 'quarantine',
      );
      assertEqual(db.bearerToken, originalBearer, 'caller-controlled bearer bytes stay installed');

      const callsAtTerminal = transportCalls;
      await assertThrows(
        () => db.query('privateRows'),
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'the terminal generation refuses later request admission locally',
      );
      assertEqual(transportCalls, callsAtTerminal, 'latched requests never reach fetch');

      await db.replaceBearerToken(originalBearer);
      await assertThrows(
        () => db.query('privateRows'),
        'SNAPBACK_AUTH_SESSION_REVOKED',
        'same-token replacement is a no-op and cannot clear terminal state',
      );
      assertEqual(transportCalls, callsAtTerminal);

      terminal = false;
      await db.replaceBearerToken(successor);
      const recovered = await db.query('privateRows');
      assertEqual(recovered.ok, true, 'a real successor/null custody transition reopens admission');
      assertEqual(transportCalls, callsAtTerminal + 1);
      results.push({
        authorityDisposition,
        replacement: successor === null ? 'null' : 'successor',
        terminalCuts: blankContexts.length,
      });
      unregister();
    }
    return results;
  });

  await suite.check('finite agent revocation waits for durable deletion before rejecting', async () => {
    const storage = createMemoryAgentAuthorityCustodyStorage();
    const initialCredential = agentCredential(AGENT_TOKEN_A, 'agent-token-a');
    const authority = new AgentAuthorityFence(
      initialCredential,
      { storage, custodyId: 'agent:finite-terminal-settlement' },
    );
    await authority.synchronizeValidated(agentDescriptor(initialCredential));
    const db = new SnapbackClient('http://stub', { agentAuthority: authority });
    let directBlanks = 0;
    const terminalCapture = authority.capture();
    const unregisterMaterialization = db.registerAuthMaterialization({
      capture: () => terminalCapture,
      blank: () => { directBlanks += 1; },
    });
    db.authSession = async () => ({
      activeMode: 'sessions',
      authority: {
        kind: 'servicePrincipal',
        userId: USER_ID,
        sessionId: null,
        isAuthenticated: true,
      },
      availability: { onlineRequestResponse: { available: true } },
    });
    let releaseDeletion;
    let deletionEntered;
    const deletionStarted = new Promise((resolve) => { deletionEntered = resolve; });
    const deletionRelease = new Promise((resolve) => { releaseDeletion = resolve; });
    authority.registerParticipant({
      quiesce() {},
      blank() {},
      clearMemory() {},
      async commitDurable() {
        deletionEntered();
        await deletionRelease;
      },
    });
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'scoped agent token is invalid',
        details: { authorityDisposition: 'durableDelete' },
      },
    }));
    let rejected = false;
    const request = db.query('privateRows').catch((error) => {
      rejected = true;
      throw error;
    });
    await deletionStarted;
    assertEqual(rejected, false, 'the HTTP caller remains pending during durable deletion');
    const duplicateError = diagnosticError(
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'duplicate terminal observer',
      401,
    );
    duplicateError.authorityDisposition = 'durableDelete';
    const duplicateA = db.handleTerminalAuthLoss(terminalCapture, duplicateError);
    const duplicateB = db.handleTerminalAuthLoss(terminalCapture, duplicateError);
    assertEqual(duplicateA, duplicateB, 'same-capture terminal callers reuse one settlement handle');
    assertEqual(
      db.handleTerminalAuthLoss({ ...terminalCapture, tokenId: AGENT_TOKEN_B }, duplicateError),
      false,
      'a distinct stale carrier cannot attach to the terminal settlement',
    );
    assertEqual(
      storage.snapshot('agent:finite-terminal-settlement').phase,
      'clearing',
      'a crash-replayable clearing intent exists before participant deletion',
    );
    releaseDeletion();
    const error = await assertThrows(
      () => request,
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'the classified server diagnostic surfaces after durable settlement',
    );
    const tombstone = storage.snapshot('agent:finite-terminal-settlement');
    assertEqual(tombstone.phase, 'settled');
    assertEqual(tombstone.status, 'deleted');
    assertEqual(directBlanks, 1, 'one agent terminal event blanks each direct surface once');
    unregisterMaterialization();
    await db.closeAuth();
    return { disposition: error.authorityDisposition, status: tombstone.status };
  });

  await suite.check('agent carrier terminal escalates to concurrent durable deletion exactly once', async () => {
    const storage = createMemoryAgentAuthorityCustodyStorage();
    const value = agentCredential(AGENT_TOKEN_A, 'agent-token-a');
    const authority = new AgentAuthorityFence(value, {
      storage,
      custodyId: 'agent:finite-terminal-escalation',
    });
    await authority.synchronizeValidated(agentDescriptor(value));
    const db = new SnapbackClient('http://stub', { agentAuthority: authority });
    const capture = authority.capture();
    let blanks = 0;
    const unregister = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => { blanks += 1; },
    });
    const closeOnly = diagnosticError('SNAPBACK_AUTH_STREAM_RESET', 'unclassified close', null);
    closeOnly.authorityDisposition = 'carrier';
    const carrier = db.handleTerminalAuthLoss(capture, closeOnly);
    const classified = diagnosticError('SNAPBACK_AUTH_SCOPED_TOKEN_INVALID', 'revoked', 401);
    classified.authorityDisposition = 'durableDelete';
    const deletion = db.handleTerminalAuthLoss(capture, classified);
    assertEqual(carrier.authorityDisposition, 'carrier');
    assertEqual(deletion.authorityDisposition, 'durableDelete');
    assert(deletion !== carrier, 'the stronger classification replaces the carrier-only settlement');
    assertEqual(db.handleTerminalAuthLoss(capture, classified), deletion, 'the escalation is idempotent');
    await deletion.settlement;
    assertEqual(blanks, 1, 'durable escalation does not replay the completed local cut');
    assertEqual(storage.snapshot('agent:finite-terminal-escalation').status, 'deleted');
    unregister();
    await db.closeAuth();
    return { blanks, status: storage.snapshot('agent:finite-terminal-escalation').status };
  });

  await suite.check('restart invalid-carrier classification tombstones exact active agent custody', async () => {
    const storage = createMemoryAgentAuthorityCustodyStorage();
    const custodyId = 'agent:restart-finite-terminal';
    const initialValue = agentCredential(AGENT_TOKEN_A, 'agent-token-a');
    const initial = new AgentAuthorityFence(initialValue, { storage, custodyId });
    await initial.synchronizeValidated(agentDescriptor(initialValue));
    const restartedValue = agentCredential(AGENT_TOKEN_B, 'invalid-restart-token');
    const restarted = new AgentAuthorityFence(restartedValue, { storage, custodyId });
    const db = new SnapbackClient('http://stub', { agentAuthority: restarted });
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'revoked while process was offline',
        details: { authorityDisposition: 'durableDelete' },
      },
    }));
    const error = await assertThrows(
      () => db.authSession(),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'the classified handshake refusal surfaces only after exact tombstoning',
    );
    const tombstone = storage.snapshot(custodyId);
    assertEqual(error.authorityDisposition, 'durableDelete');
    assertEqual(tombstone.phase, 'settled');
    assertEqual(tombstone.status, 'deleted');
    assertThrows(() => restarted.capture(), 'SNAPBACK_CLIENT_AUTHORITY_STALE');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, status: tombstone.status };
  });

  await suite.check('restart carrier-only refusal retires the offer without deleting custody', async () => {
    const storage = createMemoryAgentAuthorityCustodyStorage();
    const custodyId = 'agent:restart-carrier-terminal';
    const initialValue = agentCredential(AGENT_TOKEN_A, 'agent-token-a');
    const initial = new AgentAuthorityFence(initialValue, { storage, custodyId });
    await initial.synchronizeValidated(agentDescriptor(initialValue));
    const restartedValue = agentCredential(AGENT_TOKEN_B, 'expired-restart-token');
    const restarted = new AgentAuthorityFence(restartedValue, { storage, custodyId });
    const db = new SnapbackClient('http://stub', { agentAuthority: restarted });
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'carrier expired while process was offline',
        details: { authorityDisposition: 'carrier' },
      },
    }));
    const error = await assertThrows(
      () => db.authSession(),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'the classified carrier refusal remains the public error',
    );
    const preserved = storage.snapshot(custodyId);
    assertEqual(error.authorityDisposition, 'carrier');
    assertEqual(preserved.phase, 'settled');
    assertEqual(preserved.status, 'active');
    assertThrows(
      () => restarted.credentialOfferForHandshake(),
      'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'the refused carrier cannot be offered again by this process',
    );
    await db.closeAuth();
    return { disposition: error.authorityDisposition, status: preserved.status };
  });

  await suite.check('browser durable deletion reuses one exact synchronous client cut', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    const capture = authCoordinator.capture();
    let directBlanks = 0;
    const durablePhases = [];
    const unregisterMaterialization = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => { directBlanks += 1; },
    });
    const unregisterDurable = db.registerAuthBarrierParticipant({
      quiesce: () => durablePhases.push('quiesce'),
      blank: () => durablePhases.push('blank'),
      clearMemory: () => durablePhases.push('clearMemory'),
      commitDurable: async () => durablePhases.push('commitDurable'),
    });
    const error = diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401);
    error.authorityDisposition = 'durableDelete';
    const terminal = db.handleTerminalAuthLoss(capture, error);
    assertEqual(directBlanks, 1, 'the manual confidentiality cut blanks once');
    await authCoordinator.compareAndClear(capture, error.code);
    assertEqual(
      directBlanks,
      1,
      'the exact following coordinator transition does not replay the client blank',
    );
    assertEqual(
      durablePhases,
      ['quiesce', 'blank', 'clearMemory', 'commitDurable'],
      'non-precut durable participants still complete every coordinator phase',
    );
    await terminal.settlement;
    unregisterMaterialization();
    await unregisterDurable();
    await db.closeAuth();
    return { directBlanks, durablePhases };
  });

  await suite.check('one finite terminal event advances auth-session identity exactly once', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SESSION_REVOKED',
        message: 'revoked',
        details: { authorityDisposition: 'carrier' },
      },
    }));
    const error = await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_AUTH_SESSION_REVOKED',
      'the terminal cause survives its single cache-identity cut',
    );
    assertEqual(
      db.__authSessionCacheGeneration,
      1,
      'the transport clear owns the only cache-generation increment for this terminal event',
    );
    assertEqual(db.__authCounterError, null, 'one terminal event does not falsely exhaust the counter');
    await db.closeAuth();
    return { code: error.diagnostic.code, cacheGeneration: db.__authSessionCacheGeneration };
  });

  await suite.check('one no-successor superseded barrier advances auth-session identity exactly once', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    globalThis.fetch = stubFetch(409, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
        message: 'no successor became visible',
      },
    }));
    const error = await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED',
      'the superseded cause survives its single no-successor custody clear',
    );
    assertEqual(db.__authSessionCacheGeneration, 1);
    assertEqual(db.__authCounterError, null, 'one superseded barrier does not falsely exhaust the counter');
    await db.closeAuth();
    return { code: error.diagnostic.code, cacheGeneration: db.__authSessionCacheGeneration };
  });

  await suite.check('auth-session counter exhaustion clears predecessor cache and wedges requests', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    db.clearAuthSession();
    const capture = authCoordinator.capture();
    db.__authSessionLastSuccessful = { privateProjection: 'predecessor' };
    db.__authSessionCapture = {
      authorityEpoch: capture.authorityEpoch,
      authorityKey: capture.authorityKey,
    };
    let blanks = 0;
    const unregister = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => { blanks += 1; },
    });
    const terminal = db.handleTerminalAuthLoss(
      capture,
      diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401),
    );
    const settlementError = await assertThrows(
      () => terminal.settlement,
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
    );
    assertEqual(db.__authSessionLastSuccessful, null, 'overflow cannot retain the old cache');
    assertEqual(blanks, 1, 'materializations still blank when cache generation exhausts');
    const cachedError = await assertThrows(
      () => db.authSession(),
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
    );
    let fetches = 0;
    globalThis.fetch = async () => { fetches += 1; return stubFetch(200, '{}')(); };
    await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
    );
    assertEqual(fetches, 0, 'a wedged cache identity cannot start another request');
    unregister();
    return { code: cachedError.code, settlementCode: settlementError.code, blanks };
  });

  await suite.check('direct auth-session overflow performs one terminal local cut', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    const capture = authCoordinator.capture();
    db.clearAuthSession();
    db.__authSessionLastSuccessful = { privateProjection: 'predecessor' };
    db.__authSessionCapture = {
      authorityEpoch: capture.authorityEpoch,
      authorityKey: capture.authorityKey,
    };
    let materializationBlanks = 0;
    let participantBlanks = 0;
    let participantClears = 0;
    const unregisterMaterialization = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => { materializationBlanks += 1; },
    });
    const unregisterParticipant = db.registerAuthBarrierParticipant({
      async quiesce() {},
      blank() { participantBlanks += 1; },
      clearMemory() { participantClears += 1; },
      async commitDurable() {},
      async resume() {},
    });
    const overflow = await assertThrows(
      () => Promise.resolve(db.clearAuthSession()),
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
    );
    assertEqual(db.__authSessionLastSuccessful, null);
    assertEqual(materializationBlanks, 1, 'direct overflow blanks kit materializations');
    assertEqual(participantBlanks, 1, 'direct overflow blanks Contract participants');
    assertEqual(participantClears, 1, 'direct overflow clears Contract participant memory');
    let publications = 0;
    await assertThrows(
      () => db.commitAuthorityPublication(capture, () => { publications += 1; }),
      'SNAPBACK_CLIENT_AUTH_SESSION_GENERATION_EXHAUSTED',
    );
    assertEqual(publications, 0);
    unregisterMaterialization();
    await unregisterParticipant();
    return {
      code: overflow.code,
      materializationBlanks,
      participantBlanks,
      participantClears,
    };
  });

  await suite.check('receipt observers cannot reenter client authority mutators', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    db.clearAuthSession();
    const capture = authCoordinator.capture();
    const cached = { privateProjection: 'predecessor' };
    db.__authSessionLastSuccessful = cached;
    const terminalError = diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401);
    const refusals = [];
    let laterObservers = 0;
    db.onReceipt(() => {
      for (const operation of [
        () => db.clearAuthSession(),
        () => db.setBearerToken('must-not-be-installed'),
        () => db.handleTerminalAuthLoss(capture, terminalError),
      ]) {
        try {
          operation();
          assert(false, 'authority mutation unexpectedly reentered receipt publication');
        } catch (error) {
          refusals.push(error?.code ?? null);
        }
      }
    });
    db.onReceipt(() => {
      laterObservers += 1;
      assert(authCoordinator.isCurrent(capture), 'the predecessor remains current for the whole callback');
      assertEqual(db.__authSessionLastSuccessful, cached, 'a refused clear cannot partially blank cache state');
      assertEqual(db.bearerToken, null, 'a refused bearer mutation cannot install bytes before failing');
      assertEqual(db.__authCounterError, null, 'a refused nested clear cannot exhaust the client identity');
    });
    db.recordReceipt({ kind: 'authority-reentrancy-probe' }, capture);
    assertEqual(refusals, [
      'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
      'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
      'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
    ]);
    assertEqual(laterObservers, 1, 'later observers run only because no terminal cut occurred');
    assertEqual(
      db.receipts().map((receipt) => receipt.kind),
      ['authority-reentrancy-probe'],
    );
    await db.closeAuth();
    return { refusals, laterObservers };
  });

  await suite.check('uncoordinated receipt observers cannot cut authority mid-dispatch', async () => {
    const db = new SnapbackClient('http://stub', {
      bearerToken: 'legacy-private-bearer',
      authCounterCeiling: 1,
    });
    db.clearAuthSession();
    const cached = { privateProjection: 'legacy-predecessor' };
    db.__authSessionLastSuccessful = cached;
    let refusal = null;
    let laterObservers = 0;
    db.onReceipt(() => {
      try {
        db.clearAuthSession();
      } catch (error) {
        refusal = error;
      }
    });
    db.onReceipt(() => {
      laterObservers += 1;
      assertEqual(db.__authSessionLastSuccessful, cached);
      assertEqual(db.__authCounterError, null);
    });
    db.recordReceipt({ kind: 'legacy-authority-reentrancy-probe' });
    assertEqual(refusal?.code, 'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT');
    assertEqual(laterObservers, 1);
    assertEqual(db.receipts().length, 1);
    await db.closeAuth();
    return { code: refusal.code, laterObservers };
  });

  await suite.check('auth-transport counter exhaustion still closes and wedges publication', async () => {
    const authCoordinator = terminalCoordinatorBarrierSpy();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authCounterCeiling: 1,
    });
    authCoordinator.transportParticipant().quiesce({ reason: 'prime_transport_counter' });
    const capture = authCoordinator.capture();
    let blanks = 0;
    const unregister = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => { blanks += 1; },
    });
    const terminal = db.handleTerminalAuthLoss(
      capture,
      diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401),
    );
    const settlementError = await assertThrows(
      () => terminal.settlement,
      'SNAPBACK_CLIENT_AUTH_TRANSPORT_GENERATION_EXHAUSTED',
    );
    assertEqual(blanks, 1, 'transport overflow cannot veto synchronous blanking');
    let publications = 0;
    const publicationError = await assertThrows(
      () => db.commitAuthorityPublication(capture, () => { publications += 1; }),
      'SNAPBACK_CLIENT_AUTH_TRANSPORT_GENERATION_EXHAUSTED',
    );
    assertEqual(publications, 0, 'a wedged transport cannot publish predecessor state');
    unregister();
    return { code: publicationError.code, settlementCode: settlementError.code, blanks };
  });

  await suite.check('legacy scoped-token refusals default to the non-destructive carrier path', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    globalThis.fetch = stubFetch(401, JSON.stringify({
      diagnostic: {
        code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
        message: 'scoped agent token is invalid',
        details: { authorityDisposition: 'durable_delete' },
      },
    }));
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    const error = await assertThrows(
      () => db.query('privateRows'),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'malformed classification must still terminate the carrier',
    );
    assertEqual(error.authorityDisposition, 'carrier', 'missing or malformed metadata cannot select deletion');
    assertEqual(authCoordinator.clears.length, 0, 'legacy ambiguity preserves durable custody');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, clears: authCoordinator.clears.length };
  });

  await suite.check('s5_d3: empty error body keeps the HTTP_<status> fallback', async () => {
    globalThis.fetch = stubFetch(500, '');
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'HTTP_500', 'expected status-code fallback');
    return { code: error.diagnostic.code };
  });

  await suite.check('eng_24345: function route segments reject traversal and encoded separators', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const db = new SnapbackClient('http://stub', { adminToken: 'sbat_secret' });
    const invalid = [
      '.', '..', '../_snapback/api/app/reset', '%2e', '%2e%2e', 'x/y', 'x%2fy',
      'x%2Fy', 'x\\y', 'x%5cy', 'x?admin=1', 'x#fragment', '',
    ];
    const operations = {
      query: (name) => db.query(name),
      mutation: (name) => db.mutate(name),
      action: (name) => db.action(name),
      liveSubscribe: (name) => db.subscribeLive(name, { connectionId: 'conn_route_test' }),
      liveUnsubscribe: (name) => db.unsubscribeLive(name, {
        connectionId: 'conn_route_test',
        subscriptionId: 'sub_route_test',
      }),
    };
    for (const [operation, invoke] of Object.entries(operations)) {
      for (const name of invalid) {
        const error = await assertThrows(
          () => invoke(name),
          undefined,
          `expected ${operation} ${JSON.stringify(name)} to be rejected`,
        );
        assert(error instanceof TypeError, `expected TypeError for ${operation} ${JSON.stringify(name)}`);
      }
    }
    assertEqual(calls, 0, 'invalid names never reach fetch');
    return { operations: Object.keys(operations).length, rejected: invalid.length * Object.keys(operations).length };
  });

  await suite.check('eng_24345: admin credentials are scoped to system calls', async () => {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), headers: init.headers ?? {} });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const db = new SnapbackClient('http://stub', { adminToken: 'sbat_secret' });
    await db.query({ name: 'safe_name' });
    await db.reset();
    assertEqual(new URL(requests[0].url).pathname, '/query/safe_name', 'generated name stays one route segment');
    assert(!('x-snapback-admin-token' in requests[0].headers), 'data-plane request carries no admin credential');
    assertEqual(new URL(requests[1].url).pathname, '/_snapback/api/app/reset', 'reset uses the system route');
    assertEqual(requests[1].headers['x-snapback-admin-token'], 'sbat_secret', 'system request carries the admin credential');
    return { dataPath: new URL(requests[0].url).pathname, adminPath: new URL(requests[1].url).pathname };
  });

  await suite.check('s5_d3: admin client wraps non-JSON error bodies the same way', async () => {
    globalThis.fetch = stubFetch(502, '<html>proxy error</html>');
    const admin = new AdminClient('http://stub');
    const error = await assertThrows(() => admin.inspect(), 'SNAPBACK_HTTP_ERROR', 'expected structured HTTP error');
    assert(error.diagnostic.message.includes('proxy error'), 'message carries a body snippet');
    globalThis.fetch = stubFetch(200, 'not json');
    const parseError = await assertThrows(() => admin.inspect(), 'SNAPBACK_RESPONSE_NOT_JSON', 'expected structured parse error');
    return { errorCode: error.diagnostic.code, parseCode: parseError.diagnostic.code };
  });

  await suite.check('s5_d7: close with no pending waiters latches; later nextUpdate() rejects immediately', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_close_latch');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_close_latch');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('close', {}); // clean close, zero waiters pending
    const error = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected post-close rejection');
    assert(error.message.includes('Snapback live stream closed'), `expected stream-closed error, got: ${error.message}`);
    assert(!error.message.includes('timed out'), 'must reject via the latch, not the timeout');
    return { message: error.message };
  });

  await suite.check('sessions WebSocket upgrades carry exact protocol offers as subprotocols', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_session_protocols');
    const authCoordinator = await coordinatorCustody();
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
    });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_session_protocols');
    const ws = await nextSocket(before);
    assertEqual(JSON.stringify(ws.protocols), JSON.stringify([
      'snapback.v1',
      'snapback.connection-token.sct_stub_token',
      'snapback.auth-client.1',
      'snapback.auth-invalidation.1',
      'snapback.authority-descriptor.1',
      'snapback.authorized-lease.1',
    ]));
    await stream.close();
    await db.closeAuth();
    return { protocols: ws.protocols.length };
  });

  await suite.check('sessions standalone acknowledgements offer the authority descriptor protocol', async () => {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      requests.push({ path, headers: init.headers ?? {} });
      const body = path === '/connection/open'
        ? { connectionId: 'conn_auth_ack', connectionToken: 'sct_auth_ack' }
        : { outcome: 'discharged' };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const authCoordinator = await coordinatorCustody({ session: true });
    const db = new SnapbackClient('http://stub', {
      authCoordinator,
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
    });
    db.authSession = async () => ({
      activeMode: 'sessions',
      availability: { onlineRequestResponse: { available: true } },
    });
    await db.acknowledgeAuthorizationInvalidation('conn_auth_ack', 'ack_1');
    const acknowledgement = requests.find(
      (request) => request.path === '/live/authorization-invalidation/acknowledge',
    );
    assert(acknowledgement, 'expected the authorization acknowledgement request');
    assertEqual(
      acknowledgement.headers['x-snapback-authority-descriptor-protocol'],
      '1',
      'standalone acknowledgement offers the descriptor protocol required by queued replay',
    );
    await db.closeAuth();
    return { offered: true };
  });

  await suite.check('s5_d7: updates before close still resolve; the close error follows', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_update_then_close');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_update_then_close');
    const ws = await nextSocket(before);
    const pending = stream.nextUpdate(1_000);
    ws.dispatch('message', { data: JSON.stringify({ subscription_id: 'sub_1', rows: [{ id: 1 }] }) });
    const update = await pending;
    assertEqual(update.subscription_id, 'sub_1', 'live update resolves the pending waiter');
    ws.dispatch('close', {});
    const error = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected post-close rejection');
    assert(error.message.includes('Snapback live stream closed'), `expected stream-closed error, got: ${error.message}`);
    return { rows: update.rows.length };
  });

  await suite.check('s5_d7: the first stream failure wins; a later close does not mask it', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_first_failure');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_first_failure');
    const ws = await nextSocket(before);
    const pending = stream.nextUpdate(1_000);
    ws.dispatch('message', { data: '{not json' });
    const first = await assertThrows(() => pending, undefined, 'expected parse failure');
    ws.dispatch('close', {});
    const later = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected latched rejection');
    assertEqual(later.message, first.message, 'post-close rejection carries the original failure');
    return { message: later.message };
  });

  await suite.check('item5: raw live streams latch typed terminal auth frames', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_raw');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_terminal_raw');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'auth_error',
      code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      reason: 'revoked',
      authorityDisposition: 'durableDelete',
    }) });
    const error = await assertThrows(
      () => stream.nextUpdate(50),
      'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      'terminal auth frame must reject instead of entering the durable queue',
    );
    assertEqual(ws.closeCalls, 1, 'terminal frame closes its exact raw socket');
    return { code: error.code, closeCalls: ws.closeCalls };
  });

  await suite.check('item5: managed terminal auth frames close without reconnect', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_managed');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const states = [];
    const manager = db.liveStreamManager('conn_terminal_managed', {
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1,
    });
    manager.onState((state, detail) => states.push({ state, detail }));
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'auth_error',
      code: 'SNAPBACK_AUTH_STREAM_RESET',
      reason: 'reset',
      authorityDisposition: 'durableDelete',
    }) });
    await waitFor(
      () => states.some(({ state, detail }) => state === 'closed' && detail?.terminal),
      'terminal managed-socket close',
    );
    await sleep(10);
    assertEqual(
      FakeWebSocket.instances.length,
      before + 1,
      'terminal close never enters the reconnect loop',
    );
    assertEqual(manager.isOpen(), false, 'terminal manager remains closed');
    return { states: states.map(({ state }) => state), sockets: 1 };
  });

  await suite.check('item5: carrier terminal frames preserve browser durable custody', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_carrier');
    const authCoordinator = terminalCoordinatorSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_terminal_carrier');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'auth_error',
      code: 'SNAPBACK_AUTH_SESSION_EXPIRED',
      reason: 'expired',
      authorityDisposition: 'carrier',
    }) });
    const error = await assertThrows(
      () => stream.nextUpdate(50),
      'SNAPBACK_AUTH_SESSION_EXPIRED',
      'carrier terminal event must latch on the raw stream',
    );
    await sleep(10);
    assertEqual(authCoordinator.clears.length, 0, 'carrier loss does not delete durable custody');
    assertEqual(error.authorityDisposition, 'carrier', 'the exact wire classification reaches custody');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, clears: authCoordinator.clears.length };
  });

  await suite.check('item5: malformed terminal frames cut only the unclassified carrier', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_malformed');
    const authCoordinator = terminalCoordinatorSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_terminal_malformed');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'auth_error',
      code: 'SNAPBACK_AUTH_SCOPED_TOKEN_INVALID',
      reason: 'expired',
      authorityDisposition: 'durable_delete',
    }) });
    const error = await assertThrows(
      () => stream.nextUpdate(50),
      'SNAPBACK_AUTH_LIVE_FRAME_INVALID',
      'malformed terminal control must latch and close the carrier',
    );
    await sleep(10);
    assertEqual(error.authorityDisposition, 'carrier', 'malformed control cannot prove durable deletion');
    assertEqual(authCoordinator.clears.length, 0, 'malformed control preserves durable custody');
    await db.closeAuth();
    return { disposition: error.authorityDisposition, clears: authCoordinator.clears.length };
  });

  await suite.check('item5: raw close-only 4401/auth_error latches without deleting custody', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_raw_close_only');
    const authCoordinator = terminalCoordinatorSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_terminal_raw_close_only');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('close', { code: 4401, reason: 'auth_error' });
    const error = await assertThrows(
      () => stream.nextUpdate(50),
      'SNAPBACK_AUTH_STREAM_RESET',
      'close-only terminal event must latch on the raw stream',
    );
    await sleep(10);
    assertEqual(FakeWebSocket.instances.length, before + 1, 'raw terminal close constructs no replacement socket');
    assertEqual(error.authorityDisposition, 'carrier', 'close-only control cannot prove durable deletion');
    assertEqual(authCoordinator.clears.length, 0, 'raw close-only preserves durable custody');
    await db.closeAuth();
    return { code: error.code, clears: authCoordinator.clears.length };
  });

  await suite.check('item5: managed close-only 4401/auth_error is terminal and never reconnects', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_terminal_managed_close_only');
    const authCoordinator = terminalCoordinatorSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const before = FakeWebSocket.instances.length;
    const states = [];
    const manager = db.liveStreamManager('conn_terminal_managed_close_only', {
      reconnectBaseDelayMs: 1,
      reconnectMaxDelayMs: 1,
    });
    manager.onState((state, detail) => states.push({ state, detail }));
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    ws.dispatch('close', { code: 4401, reason: 'auth_error' });
    await waitFor(
      () => states.some(({ state, detail }) => state === 'closed' && detail?.terminal),
      'managed close-only terminal latch',
    );
    await sleep(10);
    assertEqual(FakeWebSocket.instances.length, before + 1, 'managed terminal close never reconnects');
    assertEqual(manager.isOpen(), false, 'managed close-only terminal latch remains closed');
    assertEqual(authCoordinator.clears.length, 0, 'managed close-only preserves durable custody');
    await db.closeAuth();
    return { states: states.map(({ state }) => state), clears: authCoordinator.clears.length };
  });

  await suite.check('auth custody: a missed wakeup cannot publish managed frames or receipts', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_missed_wakeup');
    const authCoordinator = missedWakeupCoordinatorSpy();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      availability: { onlineRequestResponse: { available: true } },
    });
    const capture = authCoordinator.capture();
    let receiptObservers = 0;
    db.onReceipt(() => {
      receiptObservers += 1;
      authCoordinator.transitionDuringCommit();
    });
    db.recordReceipt({ kind: 'before-peer-transition' }, capture);
    await waitFor(() => db.receipts().length === 1, 'durably fenced predecessor receipt');
    assertEqual(receiptObservers, 1, 'receipt observer ran once inside the publication fence');

    const seen = [];
    const seenEphemeral = [];
    const before = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager('conn_missed_wakeup', {
      reconnectBaseDelayMs: 10_000,
      reconnectMaxDelayMs: 10_000,
    });
    const off = manager.onDurable((frame) => seen.push(frame));
    const offEphemeral = manager.onEphemeral((frame) => seenEphemeral.push(frame));
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    authCoordinator.advanceDurable();
    assert(
      authCoordinator.isCurrent(capture),
      'the process-local hint intentionally remains stale after the peer transition',
    );
    db.recordReceipt({ kind: 'after-peer-transition' }, capture);
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'live_replace',
      subscription_id: 'sub_stale',
      version: 9,
      rows: [{ _id: 'private' }],
    }) });
    ws.dispatch('message', { data: JSON.stringify({
      kind: 'ephemeral',
      message: { Upsert: { entry: { key: 'private-ephemeral' } } },
    }) });
    await sleep(20);
    assertEqual(seen, [], 'durable custody rejected the delayed managed frame');
    assertEqual(seenEphemeral, [], 'durable custody rejected the delayed managed ephemeral frame');
    assertEqual(
      db.receipts().map((receipt) => receipt.kind),
      ['before-peer-transition'],
      'durable custody rejected the delayed receipt',
    );
    off();
    offEphemeral();
    manager.close();
    await db.closeAuth();
    return {
      frames: seen.length,
      ephemeralFrames: seenEphemeral.length,
      receipts: db.receipts().length,
    };
  });

  await suite.check('auth custody: an expected-capture mutation cannot start under a peer successor', async () => {
    const authCoordinator = missedWakeupCoordinatorSpy();
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ result: null }) };
    };
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    const capture = authCoordinator.capture();
    authCoordinator.advanceDurable();
    const error = await assertThrows(
      () => db.mutate('mustNotCross', { authorityCapture: capture }),
      'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'the old click must be refused at the final request-start comparison',
    );
    assertEqual(fetches, 0, 'no network request starts after durable custody advances');
    await db.closeAuth();
    return { code: error.code, fetches };
  });

  await suite.check('auth custody: a default direct mutation cannot start after a missed peer transition', async () => {
    const authCoordinator = missedWakeupCoordinatorSpy();
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ result: null }) };
    };
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    authCoordinator.advanceDurable();
    const error = await assertThrows(
      () => db.mutate('mustNotCross'),
      'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'public direct mutations must final-fence request start without an explicit capture',
    );
    assertEqual(fetches, 0, 'no default network effect starts after durable custody advances');
    await db.closeAuth();
    return { code: error.code, fetches };
  });

  await suite.check('auth custody: a missed wakeup cannot publish destructively drained envelopes', async () => {
    const authCoordinator = missedWakeupCoordinatorSpy();
    const connectionId = 'conn_missed_wakeup_drain';
    const batch = [
      {
        Durable: {
          payload: JSON.stringify({
            kind: 'live_replace',
            subscription_id: 'sub_stale_drain',
            version: 10,
            rows: [{ _id: 'private-drained-row' }],
          }),
        },
      },
      { Ephemeral: { Upsert: { entry: { key: 'private-drained-ephemeral' } } } },
    ];
    globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      const body = path === '/connection/open'
        ? { connectionId, connectionToken: 'sct_missed_wakeup_drain' }
        : path === `/outbox/${connectionId}`
          ? batch
          : null;
      assert(body !== null, `unexpected missed-wakeup drain request ${path}`);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    await db.connectionGrant(connectionId);
    const seenDurable = [];
    const seenEphemeral = [];
    db.registerDurableConsumer(connectionId, (frame) => seenDurable.push(frame));
    db.registerEphemeralConsumer(connectionId, (frame) => seenEphemeral.push(frame));

    // The outbox response itself linearizes under the predecessor. A peer
    // then advances durable custody before drainConnection can expose either
    // already-dequeued envelope; the per-envelope publication fence must
    // discard both lanes despite the deliberately stale process-local hint.
    authCoordinator.advanceDurableAfterNextCommit();
    const error = await assertThrows(
      () => db.drainConnection(connectionId),
      'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'a custody transition after request start refuses the complete drained response',
    );
    assertEqual(seenDurable, [], 'stale drained durable observers never run');
    assertEqual(seenEphemeral, [], 'stale drained ephemeral observers never run');
    await db.closeAuth();
    return { code: error.code, durableObservers: 0, ephemeralObservers: 0 };
  });

  await suite.check('auth custody: an observer transition attempt is refused without deadlock', async () => {
    const authCoordinator = await coordinatorCustody();
    const db = new SnapbackClient('http://stub', { authCoordinator });
    const capture = authCoordinator.capture();
    let transitionAttempt = null;
    db.onReceipt(() => {
      // transition() is async, so the compareAndCommit reentrancy refusal is a
      // rejected promise rather than a synchronous throw. Observe it here to
      // prove an app callback cannot deadlock the ownership fence or create an
      // unhandled rejection while publication remains atomic.
      transitionAttempt = authCoordinator.transition(capture, {
        authority: {
          kind: 'anonymous',
          authMode: 'dev',
          authorizationStreamIncarnation: AUTHORIZATION_INCARNATION,
        },
        bearer: null,
        refreshAfterMs: null,
      }, 'observer_reentrancy_probe').catch((error) => error);
    });
    db.recordReceipt({ kind: 'observer-transition-probe' }, capture);
    await waitFor(() => transitionAttempt !== null, 'observer transition attempt');
    const error = await transitionAttempt;
    assertEqual(
      error?.code,
      'SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT',
      'coordinator refuses transition reentrancy with the stable diagnostic',
    );
    assert(authCoordinator.isCurrent(capture), 'the refused observer transition leaves custody unchanged');
    assertEqual(
      db.receipts().map((receipt) => receipt.kind),
      ['observer-transition-probe'],
      'the receipt linearized once without deadlock or stale successor publication',
    );
    await db.closeAuth();
    await authCoordinator.close();
    return { code: error.code, receipts: db.receipts().length };
  });

  await suite.check('auth custody: nested response receipts inherit the fenced response capture', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        result: { ok: true },
        receipt: { kind: 'nested-response-receipt' },
      }),
    });
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'dev',
      availability: { onlineRequestResponse: { available: true } },
    });
    await db.mutate('receiptCapture');
    await waitFor(() => db.receipts().length === 1, 'nested response receipt publication');
    assertEqual(
      db.receipts()[0].kind,
      'nested-response-receipt',
      'the response capture fences its nested receipt publication',
    );
    await db.closeAuth();
    return { receipts: db.receipts().length };
  });

  await suite.check('terminal auth loss refuses a publication already queued behind custody', async () => {
    const capture = Object.freeze({
      authorityEpoch: 9,
      custodyRevision: 13,
      authorityKey: `sha256:${'d'.repeat(64)}`,
    });
    let releaseComparison;
    let comparisonEntered;
    const comparisonStarted = new Promise((resolve) => { comparisonEntered = resolve; });
    const comparisonRelease = new Promise((resolve) => { releaseComparison = resolve; });
    const coordinator = {
      appId: 'snapback.test/client-errors-terminal-queue',
      capture: () => capture,
      synchronize: async () => capture,
      credentialFor: () => ({ bearer: null }),
      isCurrent: (candidate) => candidate === capture,
      registerParticipant: () => async () => {},
      async compareAndCommit(candidate, commit) {
        if (candidate !== capture) return { committed: false };
        comparisonEntered();
        await comparisonRelease;
        return { committed: true, value: commit() };
      },
      compareAndClear: async () => ({ cleared: false }),
    };
    const db = new SnapbackClient('http://stub', { authCoordinator: coordinator });
    let publications = 0;
    const pending = db.commitAuthorityPublication(capture, () => {
      publications += 1;
      return 'private predecessor value';
    });
    await comparisonStarted;
    db.handleTerminalAuthLoss(
      capture,
      diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401),
    );
    releaseComparison();
    const outcome = await pending;
    assertEqual(outcome.committed, false, 'the queued predecessor publication is refused');
    assertEqual(publications, 0, 'no callback runs after the synchronous terminal blank');
    return { committed: outcome.committed, publications };
  });

  await suite.check('credential rotation cancels an authority-unknown initial live snapshot', async () => {
    const authority = new AgentAuthorityFence(agentCredential(AGENT_TOKEN_A, 'agent-token-a'));
    const db = new SnapbackClient('http://stub', { agentAuthority: authority });
    let releaseSubscribe;
    let subscribeEntered;
    const subscribeStarted = new Promise((resolve) => { subscribeEntered = resolve; });
    const subscribeRelease = new Promise((resolve) => { releaseSubscribe = resolve; });
    const publishedRows = [];
    let unsubscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeEntered();
      await subscribeRelease;
      return {
        subscription_id: 'sub_predecessor_initial',
        snapshot: { version: 1, rows: [{ secret: 'predecessor' }] },
      };
    };
    db.unsubscribeLive = async () => {
      unsubscribeCalls += 1;
      return { removed: true };
    };
    const establishing = db.liveQuery('listPrivate', {
      connectionId: 'conn_predecessor_initial',
      onUpdate: (rows) => publishedRows.push(...rows),
    });
    await subscribeStarted;
    const predecessor = authority.capture();
    const successorCredential = agentCredential(AGENT_TOKEN_B, 'agent-token-b');
    const replacement = authority.replaceCredentialValidated(
      predecessor,
      successorCredential,
      agentDescriptor(successorCredential),
    );
    assert(!authority.isCurrent(predecessor), 'the predecessor carrier was cut');
    await replacement;
    releaseSubscribe();
    await assertThrows(
      () => establishing,
      undefined,
      'the late predecessor subscribe must not establish a live handle',
    );
    assertEqual(publishedRows, [], 'the late predecessor snapshot was never app-visible');
    assertEqual(unsubscribeCalls, 1, 'the persisted late subscription is retired best-effort');
    return { publishedRows: publishedRows.length, unsubscribeCalls };
  });

  await suite.check('terminal auth loss synchronously blanks direct live handles and receipt state', async () => {
    const authCoordinator = terminalCoordinatorSpy();
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      const body = path === '/connection/open'
        ? { connectionId: 'conn_terminal_materialization', connectionToken: 'sct_terminal_materialization' }
        : path === '/live/listTodos/subscribe'
          ? {
              subscription_id: 'sub_terminal_materialization',
              snapshot: { version: 4, rows: [{ _id: 'private-row' }] },
            }
          : path === '/live/listTodos/unsubscribe'
            ? { removed: true }
            : null;
      assert(body !== null, `unexpected terminal-materialization request ${path}`);
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const db = new SnapbackClient('http://stub', { authCoordinator });
    db.authSession = async () => ({
      activeMode: 'sessions',
      availability: { onlineRequestResponse: { available: true } },
    });
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'conn_terminal_materialization',
    });
    const capture = authCoordinator.capture();
    const overlay = new EphemeralOverlay(db, 'presence', {
      connectionId: 'conn_terminal_materialization',
      scope: { room: 'a' },
    });
    overlay.authorityCapture = capture;
    const seeded = await db.commitAuthorityPublication(
      capture,
      () => overlay.apply(snapshot(1, [{ key: 'private-entry', version: 1, value: { x: 1 } }])),
    );
    assert(seeded.committed, 'private overlay snapshot committed under current custody');
    db.recordReceipt({ kind: 'private-receipt' }, capture);
    await waitFor(() => db.receipts().length > 0, 'private receipt publication');
    const blankAttempts = [];
    const unregisterFailingCapture = db.registerAuthMaterialization({
      capture: () => {
        blankAttempts.push('capture-failing');
        throw new Error('injected capture failure');
      },
      blank: () => blankAttempts.push('capture-failing-blank'),
    });
    const unregisterFailingBlank = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => {
        blankAttempts.push('failing');
        throw new Error('injected blank failure');
      },
    });
    const unregisterFollowingBlank = db.registerAuthMaterialization({
      capture: () => capture,
      blank: () => blankAttempts.push('following'),
    });
    assertEqual(handle.rows[0]._id, 'private-row', 'private live row is initially readable');
    const error = diagnosticError('SNAPBACK_AUTH_SESSION_REVOKED', 'revoked', 401);
    db.handleTerminalAuthLoss(capture, error);
    assertEqual(handle.rows, [], 'terminal loss blanks the direct live handle synchronously');
    assertEqual(handle.connection, 'disconnected', 'terminal loss quiesces the direct live handle');
    assertEqual(
      overlay.currentEntries({ prune: false }),
      [],
      'terminal loss blanks the direct ephemeral overlay synchronously',
    );
    assertEqual(
      overlay.apply(snapshot(1, [{ key: 'late', version: 2, value: { x: 2 } }])),
      'needs_resync',
      'a delayed predecessor snapshot cannot repopulate a terminally blanked overlay',
    );
    assertEqual(db.receipts(), [], 'terminal loss clears authority-scoped receipts');
    assertEqual(
      blankAttempts,
      ['capture-failing', 'capture-failing-blank', 'failing', 'following'],
      'capture and blank failures cannot starve later private materializations',
    );
    unregisterFailingCapture();
    unregisterFailingBlank();
    unregisterFollowingBlank();
    handle.dispose();
    overlay.dispose();
    await db.closeAuth();
    return { rows: handle.rows.length, receipts: db.receipts().length };
  });

  await suite.check('eng_24372: a timed-out reader does not consume the next frame', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_timeout_frame');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_timeout_frame');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    const timedOut = await assertThrows(() => stream.nextUpdate(1), undefined, 'first reader should time out');
    assert(timedOut.message.includes('timed out'), `expected timeout, got ${timedOut.message}`);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 1 }) });
    const update = await stream.nextUpdate(50);
    assertEqual(update.sequence, 1, 'frame after timeout remains available to the next reader');
    ws.close();
    return { sequence: update.sequence };
  });

  await suite.check('eng_24372: one timed-out waiter does not starve later waiters', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_multiple_waiters');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_multiple_waiters');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    const first = stream.nextUpdate(1);
    const second = stream.nextUpdate(100);
    await assertThrows(() => first, undefined, 'first waiter should time out');
    ws.dispatch('message', { data: JSON.stringify({ sequence: 2 }) });
    assertEqual((await second).sequence, 2, 'second live waiter receives the frame');
    ws.close();
    return { delivered: true };
  });

  await suite.check('eng_24372: a same-turn timeout/frame race delivers exactly once', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_timeout_frame_race');
    const scheduled = [];
    const cancelled = new Set();
    const clock = {
      setTimeout(callback) {
        const id = scheduled.length;
        scheduled.push(callback);
        return id;
      },
      clearTimeout(id) {
        cancelled.add(id);
      },
    };
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_timeout_frame_race', clock);
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;

    // Frame wins: force the stale timeout callback in the same turn even
    // though delivery cancelled it. The active latch must make it a no-op,
    // and the next read must receive only the next frame (no duplicate).
    const frameWins = stream.nextUpdate(1);
    const frameWinsTimer = scheduled.at(-1);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 1 }) });
    await Promise.resolve(); // let the async message decoder claim the waiter
    frameWinsTimer();
    assertEqual((await frameWins).sequence, 1, 'frame winner receives the raced frame');
    const next = stream.nextUpdate(1);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 2 }) });
    assertEqual((await next).sequence, 2, 'stale timeout did not duplicate the first frame');

    // Timeout wins: run the deadline callback, then deliver the frame in the
    // same turn. Removal from the waiter queue must leave the frame queued for
    // exactly one later reader.
    const timeoutWins = stream.nextUpdate(1);
    const timeoutWinsTimer = scheduled.at(-1);
    timeoutWinsTimer();
    ws.dispatch('message', { data: JSON.stringify({ sequence: 3 }) });
    await Promise.resolve(); // let the decoded frame enter the empty queue
    const timeoutError = await assertThrows(() => timeoutWins, undefined, 'timeout winner rejects');
    assert(timeoutError.message.includes('timed out'), `expected timeout, got ${timeoutError.message}`);
    assertEqual((await stream.nextUpdate(1)).sequence, 3, 'raced frame remains queued exactly once');
    assert(cancelled.size >= 2, 'settled readers cancel their scheduled callbacks');
    ws.close();
    return { frameWon: 1, timeoutWon: 1 };
  });

  await suite.check('eng_24372: close-before-open rejects readiness and pending reads', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_close_before_open');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_close_before_open');
    const ws = await nextSocket(before);
    const pendingRead = stream.nextUpdate(1_000);
    ws.dispatch('close', {});
    const readyError = await assertThrows(() => stream.ready, undefined, 'readiness should reject on close');
    const readError = await assertThrows(() => pendingRead, undefined, 'pending read should reject on close');
    assert(readyError.message.includes('closed before opening'), `unexpected ready error: ${readyError.message}`);
    assert(readError.message.includes('closed'), `unexpected read error: ${readError.message}`);
    return { ready: readyError.message, read: readError.message };
  });

  await suite.check('RQS token state does not collide with the public resume lifecycle method', async () => {
    const db = new SnapbackClient('http://stub');
    const resumeInputs = [];
    const resume = {
      token: 'sbrt1.test-token',
      meta: {
        contentDigest: 'sha256:test-digest',
      },
    };
    db.subscribeLive = async (_name, options) => {
      resumeInputs.push(options.resumeFromToken);
      return {
        subscription_id: `sub_rqs_${resumeInputs.length}`,
        snapshot: { version: resumeInputs.length, rows: [] },
        resume,
      };
    };
    db.unsubscribeLive = async () => ({ removed: true });

    const handle = await db.liveQuery('listTodos', {
      connectionId: 'conn_rqs_resume_method',
      transport: 'poll',
    });
    assertEqual(typeof handle.resume, 'function', 'the public lifecycle method remains callable');
    assertEqual(resumeInputs[0], null, 'the initial subscribe carries no held token');

    handle.pause();
    await handle.resume();
    assertEqual(
      JSON.stringify(resumeInputs[1]),
      JSON.stringify({ resume }),
      'lifecycle resume carries the held RQS token instead of serializing the method as an empty object',
    );
    handle.dispose();
    return { attempts: resumeInputs.length };
  });

  await suite.check('pause releases exact durable demand while a shared stream remains live', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_pause_shared');
    const db = new SnapbackClient('http://stub');
    const subscribes = [];
    const unsubscribes = [];
    db.subscribeLive = async (_name, options) => {
      const subscriptionId = `sub_pause_${subscribes.length + 1}`;
      subscribes.push({ subscriptionId, supersedes: options.supersedes ?? null });
      return {
        subscription_id: subscriptionId,
        snapshot: { version: subscribes.length, rows: [] },
      };
    };
    db.unsubscribeLive = async (_name, options) => {
      unsubscribes.push(options.subscriptionId);
      return { removed: true };
    };

    const alpha = await db.liveQuery('listTodos', {
      connectionId: 'conn_pause_shared',
      transport: 'stream',
    });
    const beta = await db.liveQuery('listTodos', {
      connectionId: 'conn_pause_shared',
      transport: 'stream',
    });
    assertEqual(db.__liveStreamManagers.size, 1, 'both handles share one stream manager');

    const alphaBeforePause = alpha.subscriptionId;
    await alpha.pause();
    assertEqual(
      JSON.stringify(unsubscribes),
      JSON.stringify([alphaBeforePause]),
      'pause explicitly unsubscribes its exact durable demand',
    );
    assertEqual(db.__liveStreamManagers.size, 1, 'the peer keeps shared transport demand alive');

    await alpha.resume();
    assertEqual(
      subscribes.at(-1).supersedes,
      alphaBeforePause,
      'resume enters through a fresh subscribe that supersedes the released id',
    );
    beta.dispose();
    alpha.dispose();
    return { subscribes, unsubscribes };
  });

  await suite.check('fresh supersession requires one exact predecessor-disposal witness', async () => {
    const db = new SnapbackClient('http://stub');
    const subscribeInputs = [];
    const unsubscribed = [];
    let witnessMode = 'initial';
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      if (path === '/connection/open') {
        return new Response(JSON.stringify({
          connectionId: 'conn_supersession_witness',
          connectionToken: 'sct_supersession_witness',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (path === '/live/listTodos/subscribe') {
        const body = JSON.parse(init.body);
        const subscriptionId = `sub_witness_${subscribeInputs.length + 1}`;
        subscribeInputs.push({
          subscriptionId,
          supersedes: body.supersedes ?? null,
          witnessMode,
        });
        const responseBody = {
          subscription_id: subscriptionId,
          snapshot: { version: subscribeInputs.length, rows: [] },
          ...(witnessMode === 'unknown'
            ? { supersessionRefusal: 'SNAPBACK_LIVE_SUPERSESSION_SOMETHING_ELSE' }
            : {}),
          ...(witnessMode === 'absence'
            ? {
                supersessionRefusal:
                  'SNAPBACK_LIVE_SUPERSESSION_TARGET_UNKNOWN',
              }
            : {}),
          ...(witnessMode === 'retired'
            ? { superseded: body.supersedes }
            : {}),
        };
        return new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (path === '/live/listTodos/unsubscribe') {
        const body = JSON.parse(init.body);
        unsubscribed.push(body.subscription_id);
        return new Response(JSON.stringify({ removed: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected supersession-witness request: ${path}`);
    };

    const handle = await db.liveQuery('listTodos', {
      connectionId: 'conn_supersession_witness',
      transport: 'poll',
    });
    assertEqual(handle.subscriptionId, 'sub_witness_1');
    await handle.pause();

    witnessMode = 'missing';
    const missing = await assertThrows(
      () => handle.resume(),
      'SNAPBACK_LIVE_SUPERSESSION_WITNESS_INVALID',
      'a successful snapshot without a disposal witness is protocol corruption',
    );
    await waitFor(
      () => unsubscribed.includes('sub_witness_2'),
      'unproven missing-witness successor cleanup',
    );
    assertEqual(handle.subscriptionId, 'sub_witness_1', 'the predecessor remains retained');

    witnessMode = 'unknown';
    await assertThrows(
      () => handle.resume(),
      'SNAPBACK_LIVE_SUPERSESSION_WITNESS_INVALID',
      'an unknown refusal is not a predecessor-disposal witness',
    );
    await waitFor(
      () => unsubscribed.includes('sub_witness_3'),
      'unproven unknown-refusal successor cleanup',
    );
    assertEqual(handle.subscriptionId, 'sub_witness_1', 'unknown refusal cannot replace the predecessor');

    witnessMode = 'absence';
    await handle.resume();
    assertEqual(
      handle.subscriptionId,
      'sub_witness_4',
      'the exact already-absent refusal is a valid processed witness',
    );

    await handle.pause();
    witnessMode = 'retired';
    await handle.resume();
    assertEqual(
      handle.subscriptionId,
      'sub_witness_5',
      'the exact superseded echo is a valid retirement witness',
    );
    assertEqual(
      JSON.stringify(subscribeInputs.map(({ supersedes }) => supersedes)),
      JSON.stringify([
        null,
        'sub_witness_1',
        'sub_witness_1',
        'sub_witness_1',
        'sub_witness_4',
      ]),
      'failed witness attempts never advance the retained predecessor',
    );
    handle.dispose();
    return {
      code: missing.code,
      subscribes: subscribeInputs.length,
      cleaned: unsubscribed.length,
    };
  });

  await suite.check('socket/session subscribe refusals retry only after generation-scoped readiness', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_session_ready');
    const db = new SnapbackClient('http://stub');
    const events = [];
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      events.push(`subscribe:${subscribeCalls}`);
      if (subscribeCalls === 1) {
        throw diagnosticError(
          'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
          'a current authenticated WebSocket session is required before subscribing',
        );
      }
      if (subscribeCalls === 3) {
        throw diagnosticError(
          'SNAPBACK_CONNECTION_SESSION_REPLACED',
          'the WebSocket session was replaced while the subscription snapshot was loading',
        );
      }
      return {
        subscription_id: `sub_${subscribeCalls}`,
        snapshot: { version: subscribeCalls, rows: [] },
      };
    };
    db.unsubscribeLive = async () => ({ removed: true });

    const beforeInitial = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_session_ready',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    });
    const firstSocket = await nextSocket(beforeInitial);
    await waitFor(() => subscribeCalls === 1, 'the optimistic initial subscribe');
    assertEqual(subscribeCalls, 1, 'the socket-required response does not replay while the socket is connecting');
    firstSocket.dispatch('open', {});
    const firstPing = await nextSentPing(firstSocket);
    await sleep(10);
    assertEqual(subscribeCalls, 1, 'raw WebSocket open alone does not release the safe retry');
    events.push('socket:1:ready');
    acknowledgePing(firstSocket, firstPing);
    const handle = await establishing;
    assertEqual(subscribeCalls, 2, 'initial subscribe retries exactly once after the readiness pong');

    handle.pause();
    const beforeResume = FakeWebSocket.instances.length;
    const resuming = handle.resume();
    const secondSocket = await nextSocket(beforeResume);
    await waitFor(() => subscribeCalls === 3, 'the optimistic resume subscribe');
    secondSocket.dispatch('open', {});
    const secondPing = await nextSentPing(secondSocket);
    await sleep(10);
    assertEqual(subscribeCalls, 3, 'session-replaced resume waits for a fresh readiness proof before replay');
    events.push('socket:2:ready');
    acknowledgePing(secondSocket, secondPing);
    await resuming;
    assertEqual(subscribeCalls, 4, 'resume retries exactly once after current-session readiness');
    assertEqual(
      events.join(','),
      'subscribe:1,socket:1:ready,subscribe:2,subscribe:3,socket:2:ready,subscribe:4',
      'each effect-free refusal is followed by readiness and one successful retry',
    );
    handle.dispose();
    return { subscribeCalls, events };
  });

  await suite.check('unscoped resync during a session-replaced readiness wait keeps one exclusive successor owner', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_session_replaced_resync');
    const db = new SnapbackClient('http://stub');
    const events = [];
    const subscribeInputs = [];
    db.subscribeLive = async (_name, options) => {
      const attempt = subscribeInputs.length + 1;
      subscribeInputs.push({ attempt, supersedes: options.supersedes ?? null });
      if (attempt === 2) {
        throw diagnosticError(
          'SNAPBACK_CONNECTION_SESSION_REPLACED',
          'the successor POST raced the current socket session',
        );
      }
      return {
        subscription_id: `sub_session_replaced_resync_${attempt}`,
        snapshot: { version: attempt, rows: [{ _id: `attempt_${attempt}` }] },
      };
    };
    db.unsubscribeLive = async () => ({ removed: true });

    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_session_replaced_resync',
      transport: 'stream',
      fallbackToPoll: false,
      stream: { freshnessBudgetMs: 1_000 },
      onSubscriptionEvent: (event) => events.push(event),
    });
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    const handle = await establishing;
    const predecessorSubscriptionId = handle.subscriptionId;
    const callsBefore = subscribeInputs.length;
    const receiptsBefore = events.filter((event) => event.event === 'resubscribed').length;
    const sentBefore = ws.sent.length;
    const consumers = db.__laneConsumers.get('conn_session_replaced_resync');

    for (const consumer of [...consumers.durable]) {
      consumer({ kind: 'resync_required', reason: 'outbox_overflow' });
    }
    await waitFor(
      () => subscribeInputs.length === callsBefore + 1,
      'the successor POST to reach the effect-free session-replaced refusal',
    );
    const readinessPing = await nextSentPing(ws, sentBefore);
    assertEqual(
      subscribeInputs.length,
      callsBefore + 1,
      'the refused successor waits without issuing its retry POST',
    );

    // This connection-wide sentinel lands in the exact waitUntilReady window.
    // The exclusive loop must absorb it as supersession of the refused attempt;
    // entering resubscribe() here would bump the demand epoch and add successor D
    // after the readiness retry installs successor C.
    for (const consumer of [...consumers.durable]) {
      consumer({ kind: 'resync_required', reason: 'outbox_overflow' });
    }
    await sleep(20);
    assertEqual(
      subscribeInputs.length,
      callsBefore + 1,
      'the overlapping resync leaves the readiness-waiting loop as sole replacement owner',
    );

    acknowledgePing(ws, readinessPing);
    await waitFor(
      () => handle.subscriptionId === `sub_session_replaced_resync_${callsBefore + 2}`,
      'the single readiness retry successor to install',
    );
    await sleep(100);
    assertEqual(
      subscribeInputs.length,
      callsBefore + 2,
      'the 409 plus readiness retry creates exactly two successor POST attempts and no demand-loop successor',
    );
    assertEqual(
      events.filter((event) => event.event === 'resubscribed').length,
      receiptsBefore + 1,
      'the race installs exactly one authoritative successor receipt',
    );
    assertEqual(
      subscribeInputs.slice(callsBefore).map(({ supersedes }) => supersedes),
      [predecessorSubscriptionId, predecessorSubscriptionId],
      'both the refused POST and its sole retry supersede the same predecessor',
    );
    const installedSubscriptionId = handle.subscriptionId;
    handle.dispose();
    return {
      successorPostAttempts: subscribeInputs.length - callsBefore,
      successorReceipts: events.filter((event) => event.event === 'resubscribed').length - receiptsBefore,
      installedSubscriptionId,
    };
  });

  await suite.check('stream readiness timeout sends no retry after the effect-free refusal', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_session_timeout');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
    };
    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_session_timeout',
      transport: 'stream',
      stream: { freshnessBudgetMs: 20, reconnectBaseDelayMs: 1_000, reconnectMaxDelayMs: 1_000 },
    });
    await nextSocket(before); // deliberately never opened
    const error = await assertThrows(
      () => establishing,
      'SNAPBACK_LIVE_STREAM_READINESS_TIMEOUT',
      'a stream lifecycle without a current socket must fail at readiness',
    );
    assertEqual(subscribeCalls, 1, 'readiness failure never replays the refused HTTP subscribe');
    return { code: error.diagnostic.code, subscribeCalls };
  });

  await suite.check('readiness codes without the exact pre-persistence 409 are never retried', async () => {
    const outcomes = [];
    for (const status of [null, 400, 500]) {
      globalThis.WebSocket = FakeWebSocket;
      globalThis.fetch = grantFetch(`conn_session_status_${status ?? 'missing'}`);
      const db = new SnapbackClient('http://stub');
      let subscribeCalls = 0;
      db.subscribeLive = async () => {
        subscribeCalls += 1;
        throw diagnosticError(
          'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
          'same code from a non-authoritative response',
          status,
        );
      };
      const error = await assertThrows(
        () => db.liveQuery('listTodos', {
          connectionId: `conn_session_status_${status ?? 'missing'}`,
          transport: 'stream',
          stream: { freshnessBudgetMs: 100 },
        }),
        'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
        'same-code response must surface without replay',
      );
      assertEqual(subscribeCalls, 1, `status ${status ?? 'missing'} must not retry`);
      outcomes.push({ status: error.status ?? null, subscribeCalls });
    }
    return outcomes;
  });

  await suite.check('ambiguous failure after readiness is surfaced without an unsafe retry', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_session_no_retry');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      }
      throw new Error('ambiguous subscribe transport failure');
    };
    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_session_no_retry',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    });
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    acknowledgePing(ws, await nextSentPing(ws));
    const error = await assertThrows(() => establishing, undefined, 'subscribe failure must surface');
    await sleep(20);
    assertEqual(subscribeCalls, 2, 'only the effect-free refusal was retried; the ambiguous failure was not');
    return { message: error.message, subscribeCalls };
  });

  await suite.check('successful socketless subscribe preserves local HTTP poll fallback', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_local_poll_fallback');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      return { subscription_id: 'sub_local', snapshot: { version: 1, rows: [{ _id: 'local' }] } };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    db.drainConnection = async () => ({ durable: [], ephemeral: [] });
    const before = FakeWebSocket.instances.length;
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'conn_local_poll_fallback',
      transport: 'stream',
      pollCadenceMs: 10,
      stream: { freshnessBudgetMs: 1_000, reconnectBaseDelayMs: 1_000, reconnectMaxDelayMs: 1_000 },
    });
    const ws = await nextSocket(before); // deliberately never reaches open
    assertEqual(subscribeCalls, 1, 'local socketless subscribe establishes without waiting for WebSocket');
    assertEqual(handle.rows[0]._id, 'local', 'authoritative snapshot is available immediately');
    ws.dispatch('close', {});
    await waitFor(() => handle.connection === 'polling', 'HTTP poll fallback after blocked socket');
    handle.dispose();
    return { subscribeCalls, connection: handle.connection };
  });

  await suite.check('parallel stream subscribes share one readiness probe and retry independently', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_parallel_ready');
    const db = new SnapbackClient('http://stub');
    const attempts = new Map();
    db.subscribeLive = async (name) => {
      const count = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, count);
      if (count === 1) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return { subscription_id: `sub_${name}`, snapshot: { version: 1, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    const before = FakeWebSocket.instances.length;
    const handlesPromise = Promise.all(['alpha', 'beta', 'gamma'].map((name) => db.liveQuery(name, {
      connectionId: 'conn_parallel_ready',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    })));
    const ws = await nextSocket(before);
    await waitFor(
      () => [...attempts.values()].reduce((sum, count) => sum + count, 0) === 3,
      'three optimistic subscribes',
    );
    ws.dispatch('open', {});
    const ping = await nextSentPing(ws);
    await sleep(10);
    assertEqual(ws.sent.length, 1, 'parallel waits share one correlated readiness probe');
    acknowledgePing(ws, ping);
    const handles = await handlesPromise;
    assert(
      [...attempts.values()].every((count) => count === 2),
      `each query should retry once: ${JSON.stringify([...attempts])}`,
    );
    handles.forEach((handle) => handle.dispose());
    return { sockets: FakeWebSocket.instances.length - before, attempts: Object.fromEntries(attempts) };
  });

  await suite.check('a synchronous readiness send failure is Promise-shaped and reconnects cleanly', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_readiness_send_throw');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return { subscription_id: 'sub_after_send_throw', snapshot: { version: 2, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      const before = FakeWebSocket.instances.length;
      const establishing = db.liveQuery('listTodos', {
        connectionId: 'conn_readiness_send_throw',
        transport: 'stream',
        stream: {
          freshnessBudgetMs: 500,
          reconnectBaseDelayMs: 1,
          reconnectMaxDelayMs: 1,
        },
      });
      const first = await nextSocket(before);
      await waitFor(() => subscribeCalls === 1, 'the effect-free refusal before send failure');
      first.send = () => {
        throw new Error('socket entered CLOSING before send');
      };
      // Before the fix this escaped dispatch synchronously and orphaned the
      // pending response promise. It must now enter the ordinary loss path.
      first.dispatch('open', {});
      const replacement = await nextSocket(before + 1);
      assert(first.closeCalls >= 1, 'the send-failed socket is closed immediately');
      replacement.dispatch('open', {});
      acknowledgePing(replacement, await nextSentPing(replacement));
      const handle = await establishing;
      await sleep(20);
      assertEqual(subscribeCalls, 2, 'the refused subscribe replays once on the ready replacement');
      assertEqual(unhandled.length, 0, `send failure leaked no unhandled rejection: ${unhandled.map((e) => e?.message ?? e)}`);
      handle.dispose();
      return { subscribeCalls, replacementSockets: FakeWebSocket.instances.length - before };
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  await suite.check('an open socket withholding readiness pong is replaced within the outer budget', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_readiness_no_pong');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return { subscription_id: 'sub_after_no_pong', snapshot: { version: 2, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_readiness_no_pong',
      transport: 'stream',
      stream: {
        heartbeatIntervalMs: 15,
        freshnessBudgetMs: 200,
        reconnectBaseDelayMs: 1,
        reconnectMaxDelayMs: 1,
      },
    });
    const first = await nextSocket(before);
    first.dispatch('open', {});
    await nextSentPing(first); // deliberately withheld
    const replacement = await nextSocket(before + 1);
    assert(first.closeCalls >= 1, 'a socket that misses the probe deadline is force-closed');
    assertEqual(subscribeCalls, 1, 'no HTTP replay occurs without a current-generation pong');
    replacement.dispatch('open', {});
    acknowledgePing(replacement, await nextSentPing(replacement));
    const handle = await establishing;
    assertEqual(subscribeCalls, 2, 'the replay lands only after replacement readiness');
    handle.dispose();
    return { subscribeCalls, sockets: FakeWebSocket.instances.length - before };
  });

  await suite.check('persistent authoritative readiness refusals stop at the exact retry cap', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_readiness_retry_cap');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
    };
    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'conn_readiness_retry_cap',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    });
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    const firstPing = await nextSentPing(ws);
    acknowledgePing(ws, firstPing);
    await waitFor(() => subscribeCalls === 2, 'the first bounded replay');
    const secondPing = await nextSentPing(ws, 1);
    acknowledgePing(ws, secondPing);
    const error = await assertThrows(
      () => establishing,
      'SNAPBACK_CONNECTION_SOCKET_REQUIRED',
      'the final refusal must surface after the bounded retry count',
    );
    await sleep(20);
    assertEqual(subscribeCalls, 3, 'two retries mean exactly three total POST attempts');
    assertEqual(ws.sent.length, 2, 'each permitted retry requires one fresh readiness proof');
    return { code: error.diagnostic.code, subscribeCalls, probes: ws.sent.length };
  });

  await suite.check('pausing one shared readiness caller cancels only that handle', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_shared_readiness_cancel');
    const db = new SnapbackClient('http://stub');
    const attempts = new Map();
    db.subscribeLive = async (name) => {
      const count = (attempts.get(name) ?? 0) + 1;
      attempts.set(name, count);
      if (count === 2) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return {
        subscription_id: `sub_${name}_${count}`,
        snapshot: { version: count, rows: [] },
      };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    const beforeInitial = FakeWebSocket.instances.length;
    const initial = Promise.all(['alpha', 'beta'].map((name) => db.liveQuery(name, {
      connectionId: 'conn_shared_readiness_cancel',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    })));
    const initialSocket = await nextSocket(beforeInitial);
    initialSocket.dispatch('open', {});
    const [alpha, beta] = await initial;
    alpha.pause();
    beta.pause();

    const beforeResume = FakeWebSocket.instances.length;
    const alphaResume = alpha.resume();
    const alphaOutcome = alphaResume.then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
    const betaResume = beta.resume();
    await waitFor(
      () => attempts.get('alpha') === 2 && attempts.get('beta') === 2,
      'both optimistic resume refusals',
    );
    const resumeSocket = await nextSocket(beforeResume);
    alpha.pause();
    // Queue the new lifecycle synchronously, before the cancelled resume's
    // rejection microtask can poison its own same-lifecycle queue generation.
    const alphaNextLifecycle = alpha.resume();
    resumeSocket.dispatch('open', {});
    const ping = await nextSentPing(resumeSocket);
    acknowledgePing(resumeSocket, ping);
    await Promise.all([alphaNextLifecycle, betaResume]);
    const { error: alphaError } = await alphaOutcome;
    assertEqual(alphaError?.code, 'SNAPBACK_LIVE_QUERY_PAUSED_DURING_SUBSCRIBE', 'paused caller settles with its lifecycle diagnostic');
    assertEqual(attempts.get('alpha'), 3, 'paused caller never replays, while its new lifecycle establishes');
    assertEqual(attempts.get('beta'), 3, 'remaining caller retries after shared readiness');
    assertEqual(resumeSocket.sent.length, 1, 'remaining caller keeps the single shared probe alive');
    alpha.dispose();
    beta.dispose();
    return { attempts: Object.fromEntries(attempts), probes: resumeSocket.sent.length };
  });

  await suite.check('a late old-lifecycle HTTP result cannot poison an immediate resume', async () => {
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    let resolveOldLifecycle;
    const unsubscribed = [];
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        return { subscription_id: 'sub_lifecycle_initial', snapshot: { version: 1, rows: [] } };
      }
      if (subscribeCalls === 2) {
        return new Promise((resolve) => {
          resolveOldLifecycle = () => resolve({
            subscription_id: 'sub_lifecycle_late',
            snapshot: { version: 2, rows: [] },
          });
        });
      }
      return { subscription_id: 'sub_lifecycle_resumed', snapshot: { version: 3, rows: [] } };
    };
    db.unsubscribeLive = async (_name, { subscriptionId }) => {
      unsubscribed.push(subscriptionId);
      return { removed: true };
    };
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'conn_late_old_lifecycle',
      transport: 'poll',
    });
    const consumers = db.__laneConsumers.get('conn_late_old_lifecycle');
    for (const consumer of [...consumers.durable]) consumer({ kind: 'resync_required' });
    await waitFor(() => subscribeCalls === 2, 'old-lifecycle resubscribe in flight');

    handle.pause();
    const resumed = handle.resume();
    resolveOldLifecycle();
    await resumed;
    await sleep(20);
    assertEqual(subscribeCalls, 3, 'the queued new lifecycle reaches its POST exactly once');
    assertEqual(handle.subscriptionId, 'sub_lifecycle_resumed', 'new lifecycle owns the resumed subscription');
    assert(unsubscribed.includes('sub_lifecycle_late'), 'late old-lifecycle success is explicitly retired');
    handle.dispose();
    return { subscribeCalls, unsubscribed };
  });

  await suite.check('dispose during readiness releases last demand and cannot persist afterward', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_dispose_during_readiness');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    const unsubscribed = [];
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        return { subscription_id: 'sub_before_dispose', snapshot: { version: 1, rows: [] } };
      }
      if (subscribeCalls === 2) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return { subscription_id: 'sub_forbidden_late', snapshot: { version: 3, rows: [] } };
    };
    db.unsubscribeLive = async (_name, { subscriptionId }) => {
      unsubscribed.push(subscriptionId);
      return { removed: true };
    };
    const beforeInitial = FakeWebSocket.instances.length;
    const initial = db.liveQuery('listTodos', {
      connectionId: 'conn_dispose_during_readiness',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    });
    const initialSocket = await nextSocket(beforeInitial);
    initialSocket.dispatch('open', {});
    const handle = await initial;
    handle.pause();

    const beforeResume = FakeWebSocket.instances.length;
    const resumeOutcome = handle.resume().then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
    await waitFor(() => subscribeCalls === 2, 'resume refusal before disposal');
    const staleSocket = await nextSocket(beforeResume);
    handle.dispose();
    const { error } = await resumeOutcome;
    assertEqual(error?.code, 'SNAPBACK_LIVE_QUERY_DISPOSED_DURING_SUBSCRIBE', 'dispose cancels its readiness wrapper promptly');
    assert(staleSocket.closeCalls >= 1, 'detaching the last real listener closes the waiting socket');
    assertEqual(db.__liveStreamManagers.size, 0, 'the cancelled readiness observer holds no manager demand');
    // A hostile late open/pong on the stale transport must not release the
    // cancelled retry loop or create a server subscription after disposal.
    staleSocket.dispatch('open', {});
    staleSocket.dispatch('message', { data: JSON.stringify({ kind: 'pong', requestId: 'stale' }) });
    await sleep(20);
    assertEqual(subscribeCalls, 2, 'no post-disposal subscribe POST is issued');
    assert(unsubscribed.includes('sub_before_dispose'), 'dispose retires the previously owned subscription');
    assert(!unsubscribed.includes('sub_forbidden_late'), 'no nonexistent late subscription needed cleanup');
    return { subscribeCalls, managers: db.__liveStreamManagers.size, unsubscribed };
  });

  await suite.check('resume and reconnect serialize into one explicit supersession chain', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_resume_reconnect_serial');
    const db = new SnapbackClient('http://stub');
    const calls = [];
    const active = new Set();
    let inFlight = 0;
    let maxInFlight = 0;
    db.subscribeLive = async (_name, options) => {
      const callNumber = calls.length + 1;
      const record = { callNumber, supersedes: options.supersedes ?? null };
      calls.push(record);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (callNumber === 2) {
          throw diagnosticError('SNAPBACK_CONNECTION_SESSION_REPLACED');
        }
        await sleep(10);
        const subscriptionId = `sub_${callNumber}`;
        if (record.supersedes) active.delete(record.supersedes);
        active.add(subscriptionId);
        return { subscription_id: subscriptionId, snapshot: { version: callNumber, rows: [] } };
      } finally {
        inFlight -= 1;
      }
    };
    db.unsubscribeLive = async (_name, { subscriptionId }) => {
      active.delete(subscriptionId);
      return { removed: true };
    };

    const beforeInitial = FakeWebSocket.instances.length;
    const initial = db.liveQuery('listTodos', {
      connectionId: 'conn_resume_reconnect_serial',
      transport: 'stream',
      fallbackToPoll: false,
      stream: {
        freshnessBudgetMs: 1_000,
        reconnectBaseDelayMs: 1,
        reconnectMaxDelayMs: 1,
      },
    });
    const initialSocket = await nextSocket(beforeInitial);
    initialSocket.dispatch('open', {});
    const handle = await initial;
    assertEqual([...active], ['sub_1'], 'initial server model has one active subscription');
    handle.pause();

    const beforeResume = FakeWebSocket.instances.length;
    const resuming = handle.resume();
    await waitFor(() => calls.length === 2, 'effect-free resume refusal');
    const refusedSocket = await nextSocket(beforeResume);
    refusedSocket.dispatch('open', {});
    const stalePing = await nextSentPing(refusedSocket);
    refusedSocket.dispatch('close', {});

    const replacement = await nextSocket(beforeResume + 1);
    replacement.dispatch('open', {});
    const currentPing = await nextSentPing(replacement);
    acknowledgePing(replacement, stalePing);
    await sleep(10);
    assertEqual(calls.length, 2, 'an old-generation pong cannot release the replacement wait');
    acknowledgePing(replacement, currentPing);
    await resuming;
    await waitFor(() => calls.length === 4 && inFlight === 0, 'serialized reconnect subscribe behind resume');
    assertEqual(maxInFlight, 1, 'fresh subscribe POSTs never overlap for one handle');
    assertEqual(
      calls.map((call) => call.supersedes),
      [null, 'sub_1', 'sub_1', 'sub_3'],
      'successful resume and reconnect form an explicit old -> resume -> reconnect chain',
    );
    assertEqual([...active], ['sub_4'], 'the server model has exactly one active subscription after the race');
    assertEqual(handle.subscriptionId, 'sub_4', 'the handle points at the sole active subscription');
    handle.dispose();
    await waitFor(() => active.size === 0, 'final active subscription cleanup');
    return { maxInFlight, supersedes: calls.map((call) => call.supersedes), active: active.size };
  });

  await suite.check('a throwing connection observer cannot starve the readiness probe', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_throwing_state_observer');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    let observerThrows = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 2) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      return { subscription_id: `sub_observer_${subscribeCalls}`, snapshot: { version: subscribeCalls, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ removed: true });
    const beforeInitial = FakeWebSocket.instances.length;
    const initial = db.liveQuery('listTodos', {
      connectionId: 'conn_throwing_state_observer',
      transport: 'stream',
      stream: { freshnessBudgetMs: 1_000 },
    });
    const initialSocket = await nextSocket(beforeInitial);
    initialSocket.dispatch('open', {});
    const handle = await initial;
    handle.pause();
    const beforeResume = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager('conn_throwing_state_observer', { freshnessBudgetMs: 1_000 });
    const stopThrowingObserver = manager.onState((state) => {
      if (state === 'open') {
        observerThrows += 1;
        throw new Error('observational callback failure');
      }
    });
    const resuming = handle.resume();
    await waitFor(() => subscribeCalls === 2, 'resume refusal with throwing observer armed');
    const ws = await nextSocket(beforeResume);
    ws.dispatch('open', {});
    const ping = await nextSentPing(ws);
    acknowledgePing(ws, ping);
    await resuming;
    assertEqual(observerThrows, 1, 'the observer did throw on the manager open transition');
    assertEqual(subscribeCalls, 3, 'readiness observer still ran and released the one safe retry');
    stopThrowingObserver();
    handle.dispose();
    return { observerThrows, subscribeCalls };
  });

  await suite.check('failed resume after socket loss quiesces fallback and queued retry work', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_failed_resume_quiescence');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    let drainCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        return { subscription_id: 'sub_quiescent_initial', snapshot: { version: 1, rows: [] } };
      }
      if (subscribeCalls === 2) throw diagnosticError('SNAPBACK_CONNECTION_SOCKET_REQUIRED');
      throw new Error('resume retry failed after readiness');
    };
    db.unsubscribeLive = async () => ({ removed: true });
    db.drainConnection = async () => {
      drainCalls += 1;
      return { durable: [], ephemeral: [] };
    };
    const beforeInitial = FakeWebSocket.instances.length;
    const initial = db.liveQuery('listTodos', {
      connectionId: 'conn_failed_resume_quiescence',
      transport: 'stream',
      pollCadenceMs: 5,
      stream: {
        freshnessBudgetMs: 1_000,
        reconnectBaseDelayMs: 1,
        reconnectMaxDelayMs: 1,
      },
    });
    const initialSocket = await nextSocket(beforeInitial);
    initialSocket.dispatch('open', {});
    const handle = await initial;
    handle.pause();

    const beforeResume = FakeWebSocket.instances.length;
    const resuming = handle.resume();
    await waitFor(() => subscribeCalls === 2, 'resume readiness refusal');
    const refusedSocket = await nextSocket(beforeResume);
    refusedSocket.dispatch('open', {});
    await nextSentPing(refusedSocket);
    refusedSocket.dispatch('close', {}); // starts fallback before replacement
    const replacement = await nextSocket(beforeResume + 1);
    replacement.dispatch('open', {});
    acknowledgePing(replacement, await nextSentPing(replacement));
    const error = await assertThrows(() => resuming, undefined, 'resume retry failure must surface');
    assert(error.message.includes('resume retry failed'), `unexpected resume failure: ${error.message}`);
    const drainsAtFailure = drainCalls;
    await sleep(30);
    assertEqual(
      subscribeCalls,
      3,
      'an ambiguous resume failure poisons the already-queued reconnect before its POST',
    );
    assertEqual(drainCalls, drainsAtFailure, 'paused failure state runs no fallback drain interval');
    assertEqual(handle.connection, 'disconnected', 'failed resume returns the handle to disconnected');
    assertEqual(db.__liveStreamManagers.size, 0, 'failed resume releases the manager and queued reconnect work');
    handle.dispose();
    return { subscribeCalls, drainCalls };
  });

  await suite.check('eng_23391: a throwing consumer never discards the rest of a destructively drained batch', async () => {
    // The failure scenario from the issue: a fallback drain carrying
    // [update-for-A, an ephemeral envelope, update-for-B, resync_required]
    // where the app's first callback throws. The server has already dequeued
    // the batch, so everything behind the throw must still be delivered.
    const batch = [
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_a', rows: [], version: 1 }) } },
      { Ephemeral: { Upsert: { entry: { key: 'k', value: [], scope_epoch: 1, entry_version: 1 } } } },
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_b', rows: [], version: 1 }) } },
      { Durable: { payload: JSON.stringify({ kind: 'resync_required', reason: 'outbox_overflow' }) } },
    ];
    globalThis.fetch = stubFetch(200, JSON.stringify(batch));
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_drain_iso';
    const seenDurable = [];
    const seenEphemeral = [];
    // Throwing consumers registered FIRST, so isolation (not luck of
    // iteration order) is what protects the recording consumers.
    db.registerDurableConsumer(conn, () => {
      throw new Error('app render error');
    });
    db.registerDurableConsumer(conn, (update) => seenDurable.push(update));
    db.registerEphemeralConsumer(conn, () => {
      throw new Error('overlay observer error');
    });
    db.registerEphemeralConsumer(conn, (env) => seenEphemeral.push(env));
    const result = await db.drainConnection(conn);
    assertEqual(result.durable.length, 3, 'all durable envelopes decoded despite the throw');
    assertEqual(result.ephemeral.length, 1, 'the ephemeral envelope is routed, not discarded');
    assertEqual(seenDurable.length, 3, 'the second durable consumer received every update');
    assertEqual(seenDurable.at(-1).kind, 'resync_required', 'the resync sentinel behind the throw was delivered');
    assertEqual(seenEphemeral.length, 1, 'the second ephemeral consumer received the envelope');
    assertEqual(result.decodeFailures.length, 0, 'consumer throws are not decode failures');
    return { durable: result.durable.length, ephemeral: result.ephemeral.length };
  });

  await suite.check('llp_0095_t_db_p: malformed durable payload forces resync without aborting the batch', async () => {
    const batch = [
      { Durable: { payload: '{not json' } },
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_ok', rows: [], version: 2 }) } },
    ];
    globalThis.fetch = stubFetch(200, JSON.stringify(batch));
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_decode_iso';
    const seen = [];
    db.registerDurableConsumer(conn, (update) => seen.push(update));
    const result = await db.drainConnection(conn);
    assertEqual(result.decodeFailures.length, 1, 'the malformed envelope is reported');
    assertEqual(result.decodeFailures[0].code, 'SNAPBACK_ENVELOPE_DECODE_FAILED', 'stable diagnostic code');
    assertEqual(result.durable.length, 1, 'the envelope behind the malformed one still decodes');
    assertEqual(seen.length, 2, 'the consumer receives the recovery sentinel and the good update');
    assertEqual(seen[0].kind, 'resync_required', 'decode failure forces resync');
    assertEqual(seen[0].reason, 'durable_bytes_undecodable', 'poll and socket use one recovery class');
    assertEqual(seen[0].clear_retained, true, 'the synthesized resync clears retained state');
    assertEqual(seen[1].subscription_id, 'sub_ok', 'the update behind the failure is still delivered');
    return { code: result.decodeFailures[0].code };
  });

  await suite.check('eng_23391: a throwing consumer on the socket path starves nobody and leaves no unhandled rejection', async () => {
    globalThis.WebSocket = FakeWebSocket;
    // ENG-23442: the manager resolves a connection grant before the socket.
    globalThis.fetch = grantFetch('conn_dispatch_iso');
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_dispatch_iso';
    const rejections = [];
    const onRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const before = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager(conn);
    try {
      const seenListener = [];
      const seenDurable = [];
      const seenEphemeral = [];
      manager.onDurable(() => {
        throw new Error('durable listener error');
      });
      manager.onDurable((frame) => seenListener.push(frame));
      manager.onEphemeral(() => {
        throw new Error('ephemeral listener error');
      });
      db.registerDurableConsumer(conn, () => {
        throw new Error('app render error');
      });
      db.registerDurableConsumer(conn, (frame) => seenDurable.push(frame));
      db.registerEphemeralConsumer(conn, () => {
        throw new Error('overlay observer error');
      });
      db.registerEphemeralConsumer(conn, (env) => seenEphemeral.push(env));
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      ws.dispatch('message', { data: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_s', rows: [{ id: 1 }], version: 3 }) });
      ws.dispatch('message', { data: JSON.stringify({ kind: 'ephemeral', message: {} }) });
      // The message handler is async (websocketText); let delivery and any
      // would-be unhandled rejection surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEqual(seenListener.length, 1, 'the second durable listener received the frame');
      assertEqual(seenDurable.length, 1, 'the second durable consumer received the frame');
      assertEqual(seenEphemeral.length, 1, 'the second ephemeral consumer received the frame');
      assertEqual(rejections.length, 0, `no unhandled rejection escaped the message listener: ${rejections.map((r) => r?.message ?? r).join(', ')}`);
      return { frames: seenListener.length + seenDurable.length + seenEphemeral.length };
    } finally {
      manager.close();
      process.off('unhandledRejection', onRejection);
    }
  });

  await suite.check('auth overflow: HTTP global clear-retained blanks every lane, scoped resync does not', async () => {
    const conn = 'conn_http_global_clear';
    let batch = [{ Durable: { payload: JSON.stringify({
      kind: 'resync_required',
      reason: 'outbox_overflow',
      clear_retained: true,
    }) } }];
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(batch),
    });
    const db = new SnapbackClient('http://stub');
    db.__connectionGrants.set(conn, Promise.resolve({ id: conn, token: 'sct_http_clear' }));
    let overlayA = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
      snapshot: snapshot(1, [{ key: 'a', version: 1, value: { x: 1 } }]),
    });
    let overlayB = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
      snapshot: snapshot(1, [{ key: 'b', version: 1, value: { x: 2 } }]),
    });
    const pendingOverlay = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
    });
    const durable = [];
    const ephemeral = [];
    const unregisterDurable = db.registerDurableConsumer(conn, (frame) => durable.push(frame));
    const unregisterEphemeral = db.registerEphemeralConsumer(conn, (frame) => ephemeral.push(frame));
    try {
      const drained = await db.drainConnection(conn);
      assertEqual(drained.durable.length, 1, 'global control remains a durable drain result');
      assertEqual(drained.ephemeral.length, 0, 'cross-lane control is not mislabeled as a raw ephemeral envelope');
      assertEqual(overlayA.currentEntries({ prune: false }), [], 'first overlay blanked');
      assertEqual(overlayB.currentEntries({ prune: false }), [], 'second overlay blanked');
      assert(overlayA.needsResync && overlayB.needsResync, 'every overlay requires a fresh snapshot');
      assertEqual(ephemeral.length, 1, 'global clear-retained crossed to ephemeral consumers once');
      assert(durable[0] === ephemeral[0], 'both lanes receive the same authority-captured control object');
      pendingOverlay.applyInitialSnapshot(
        snapshot(1, [{ key: 'pre-snapshot', version: 1, value: { x: 7 } }]),
      );
      const lateSignals = [];
      pendingOverlay.onChange((result) => lateSignals.push(result));
      assertEqual(
        lateSignals,
        ['needs_resync'],
        'a poison buffered before the initial snapshot is replayed to a late Contract listener',
      );
      assertEqual(
        pendingOverlay.currentEntries({ prune: false }),
        [],
        'the buffered poison wins after the initial snapshot boundary',
      );

      assertEqual(
        overlayA.apply({
          Upsert: {
            room: overlayRoom,
            entry: {
              key: 'late',
              value: encodedValue({ x: 9 }),
              received_at_ms: 200,
              expires_at_ms: 10_000,
              scope_epoch: 1,
              entry_version: 2,
            },
          },
        }),
        'needs_resync',
        'a delayed delta cannot repopulate a blanked overlay',
      );
      assertEqual(overlayA.currentEntries({ prune: false }), [], 'blank state survives delayed deltas');

      assertEqual(
        overlayA.apply(snapshot(1, [{ key: 'delayed-snapshot', version: 9, value: { x: 99 } }])),
        'needs_resync',
        'a delayed predecessor snapshot cannot reopen a globally poisoned overlay',
      );
      assertEqual(overlayA.currentEntries({ prune: false }), [], 'blank state survives delayed snapshots');

      // Connection continuity recovers only by replacing the poisoned overlay
      // with a fresh subscribe generation. Ordinary subscription-scoped resync
      // remains durable-only after that replacement.
      overlayA.dispose();
      overlayB.dispose();
      overlayA = new EphemeralOverlay(db, 'presence', {
        connectionId: conn,
        scope: { room: 'a' },
        snapshot: snapshot(2, [{ key: 'fresh-a', version: 1, value: { x: 3 } }]),
      });
      overlayB = new EphemeralOverlay(db, 'presence', {
        connectionId: conn,
        scope: { room: 'a' },
        snapshot: snapshot(2, [{ key: 'fresh-b', version: 1, value: { x: 4 } }]),
      });
      assertEqual(overlayA.apply({
        ResyncRequired: {
          room: overlayRoom,
          scope_epoch: 2,
          room_authority_generation: 2,
          reason: 'AuthChanged',
        },
      }), 'needs_resync', 'ordinary room resync still blanks in place');
      assertEqual(
        overlayA.apply(snapshot(3, [{ key: 'fresh-a', version: 1, value: { x: 3 } }])),
        'applied',
        'ordinary room resync still accepts its fresh same-overlay snapshot',
      );
      batch = [{ Durable: { payload: JSON.stringify({
        kind: 'resync_required',
        reason: 'permission_epoch_changed',
        subscription_id: 'sub_only',
        clear_retained: true,
      }) } }];
      await db.drainConnection(conn);
      assertEqual(ephemeral.length, 1, 'subscription-scoped resync never crosses lanes');
      assertEqual(
        overlayA.currentEntries({ prune: false }).map((entry) => entry.key),
        ['fresh-a'],
        'scoped durable resync leaves overlay A intact',
      );
      assertEqual(
        overlayB.currentEntries({ prune: false }).map((entry) => entry.key),
        ['fresh-b'],
        'scoped durable resync leaves overlay B intact',
      );
      return { durable: durable.length, ephemeral: ephemeral.length };
    } finally {
      unregisterDurable();
      unregisterEphemeral();
      overlayA.dispose();
      overlayB.dispose();
      pendingOverlay.dispose();
    }
  });

  await suite.check('auth overflow: WebSocket legacy global clear-retained crosses lanes only at connection scope', async () => {
    globalThis.WebSocket = FakeWebSocket;
    const conn = 'conn_ws_global_clear';
    globalThis.fetch = grantFetch(conn);
    const db = new SnapbackClient('http://stub');
    let overlayA = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
      snapshot: snapshot(1, [{ key: 'a', version: 1, value: { x: 1 } }]),
    });
    let overlayB = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
      snapshot: snapshot(1, [{ key: 'b', version: 1, value: { x: 2 } }]),
    });
    const durable = [];
    const ephemeral = [];
    const unregisterDurable = db.registerDurableConsumer(conn, (frame) => durable.push(frame));
    const unregisterEphemeral = db.registerEphemeralConsumer(conn, (frame) => ephemeral.push(frame));
    const before = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager(conn);
    const stopDemand = manager.onState(() => {});
    try {
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      ws.dispatch('message', { data: JSON.stringify({
        kind: 'resync_required',
        reason: 'outbox_overflow',
        clearRetained: true,
      }) });
      await waitFor(() => ephemeral.length === 1, 'legacy global control crossed lanes');
      assertEqual(overlayA.currentEntries({ prune: false }), [], 'socket blanked overlay A');
      assertEqual(overlayB.currentEntries({ prune: false }), [], 'socket blanked overlay B');
      assert(overlayA.needsResync && overlayB.needsResync, 'socket global control marks both overlays');
      assert(durable[0] === ephemeral[0], 'socket routing preserves the same authority-captured object');

      ws.dispatch('message', { data: JSON.stringify({
        kind: 'ephemeral',
        message: snapshot(1, [{ key: 'delayed-snapshot', version: 9, value: { x: 99 } }]),
      }) });
      await sleep(20);
      assertEqual(
        overlayA.currentEntries({ prune: false }),
        [],
        'a delayed socket snapshot cannot reopen a globally poisoned overlay',
      );
      assert(overlayA.needsResync, 'delayed socket snapshot leaves the connection poison latched');

      overlayA.dispose();
      overlayB.dispose();
      overlayA = new EphemeralOverlay(db, 'presence', {
        connectionId: conn,
        scope: { room: 'a' },
        snapshot: snapshot(2, [{ key: 'fresh-a', version: 1, value: { x: 3 } }]),
      });
      overlayB = new EphemeralOverlay(db, 'presence', {
        connectionId: conn,
        scope: { room: 'a' },
        snapshot: snapshot(2, [{ key: 'fresh-b', version: 1, value: { x: 4 } }]),
      });
      const ephemeralBeforeScopedResync = ephemeral.length;
      ws.dispatch('message', { data: JSON.stringify({
        kind: 'resync_required',
        reason: 'permission_epoch_changed',
        subscription_id: 'sub_only',
        clearRetained: true,
      }) });
      await waitFor(() => durable.length === 2, 'scoped durable control delivered');
      assertEqual(
        ephemeral.length,
        ephemeralBeforeScopedResync,
        'legacy scoped resync remains durable-only',
      );
      assertEqual(
        overlayA.currentEntries({ prune: false }).map((entry) => entry.key),
        ['fresh-a'],
        'socket scoped resync leaves overlay A intact',
      );
      assertEqual(
        overlayB.currentEntries({ prune: false }).map((entry) => entry.key),
        ['fresh-b'],
        'socket scoped resync leaves overlay B intact',
      );
      return { durable: durable.length, ephemeral: ephemeral.length };
    } finally {
      stopDemand();
      manager.close();
      unregisterDurable();
      unregisterEphemeral();
      overlayA.dispose();
      overlayB.dispose();
    }
  });

  await suite.check('auth overflow: HTTP poison cannot be undone by an already-transferred WebSocket snapshot', async () => {
    globalThis.WebSocket = FakeWebSocket;
    const conn = 'conn_cross_transport_clear';
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      const body = path === '/connection/open'
        ? {
            connectionId: conn,
            connectionToken: 'sct_cross_transport_clear',
          }
        : path === `/outbox/${conn}`
          ? [{ Durable: { payload: JSON.stringify({
              kind: 'resync_required',
              reason: 'outbox_overflow',
              clear_retained: true,
            }) } }]
          : null;
      assert(body !== null, `unexpected cross-transport request ${path}`);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      };
    };
    const db = new SnapbackClient('http://stub');
    const overlay = new EphemeralOverlay(db, 'presence', {
      connectionId: conn,
      scope: { room: 'a' },
      snapshot: snapshot(1, [{ key: 'initial', version: 5, value: { x: 1 } }]),
    });
    const before = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager(conn);
    const stopDemand = manager.onState(() => {});
    try {
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      let releaseSnapshot;
      ws.dispatch('message', {
        // Model a predecessor frame already transferred to the socket writer
        // whose browser decode completes after the independent HTTP drain.
        data: {
          text: () => new Promise((resolve) => { releaseSnapshot = resolve; }),
        },
      });
      await db.drainConnection(conn);
      assertEqual(overlay.currentEntries({ prune: false }), [], 'HTTP poison blanked the overlay');
      assert(overlay.needsResync, 'HTTP poison latched continuity loss');

      releaseSnapshot(JSON.stringify({
        kind: 'ephemeral',
        message: snapshot(1, [{ key: 'delayed-ws-snapshot', version: 9, value: { x: 9 } }]),
      }));
      await sleep(20);
      assertEqual(
        overlay.currentEntries({ prune: false }),
        [],
        'the delayed WebSocket snapshot cannot repopulate after HTTP poison',
      );
      assert(overlay.needsResync, 'the delayed WebSocket snapshot cannot clear the poison latch');
      return { delayedSnapshotRejected: true };
    } finally {
      stopDemand();
      manager.close();
      overlay.dispose();
    }
  });

  await suite.check('eng_23392: dispose racing a resubscribe unsubscribes the late server subscription', async () => {
    const db = new SnapbackClient('http://stub');
    const unsubscribed = [];
    let subscribeCalls = 0;
    let resolveLateSubscribe;
    let lateSubscribeStarted = false;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        return { subscription_id: 'sub_initial', snapshot: { version: 1, rows: [] } };
      }
      lateSubscribeStarted = true;
      return new Promise((resolve) => {
        resolveLateSubscribe = () => resolve({ subscription_id: 'sub_late', snapshot: { version: 2, rows: [] } });
      });
    };
    db.unsubscribeLive = async (_ref, { subscriptionId }) => {
      unsubscribed.push(subscriptionId);
      return { ok: true };
    };

    const handle = await db.liveQuery('listTodos', { connectionId: 'dispose_race_conn' });
    const consumers = db.__laneConsumers.get('dispose_race_conn');
    for (const consumer of [...consumers.durable]) consumer({ kind: 'resync_required' });
    await waitFor(() => lateSubscribeStarted, 'resubscribe in flight');

    handle.dispose();
    resolveLateSubscribe();
    await waitFor(() => unsubscribed.includes('sub_late'), 'late subscription unsubscribe');
    assert(unsubscribed.includes('sub_initial'), 'dispose still unsubscribes the original subscription');
    return { unsubscribed };
  });

  await suite.check('eng_23393: a healthy fallback drain restores polling after a stale drain failure', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('fallback_heals_conn');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    let drainCalls = 0;
    const transitions = [];
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      return { subscription_id: `sub_${subscribeCalls}`, snapshot: { version: subscribeCalls, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ ok: true });
    db.drainConnection = async () => {
      drainCalls += 1;
      if (drainCalls === 1) throw new Error('SNAPBACK_TRANSIENT_DRAIN_FAILURE');
      return { durable: [], ephemeral: [] };
    };

    const before = FakeWebSocket.instances.length;
    const establishing = db.liveQuery('listTodos', {
      connectionId: 'fallback_heals_conn',
      transport: 'stream',
      pollCadenceMs: 20,
      stream: { heartbeatIntervalMs: 5_000, freshnessBudgetMs: 20_000, reconnectBaseDelayMs: 20_000, reconnectMaxDelayMs: 20_000 },
      onConnectionChange: (next) => transitions.push(next),
    });
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    const handle = await establishing;
    await waitFor(() => handle.connection === 'live', 'initial live');
    ws.dispatch('close', {});
    await waitFor(() => handle.connection === 'stale', 'stale after failed fallback drain');
    await waitFor(() => handle.connection === 'polling', 'polling after healthy fallback drain');
    handle.dispose();
    return { drainCalls, transitions };
  });

  await suite.check('eng_23433: ephemeral snapshots are guarded by epoch and entry-version high-water', async () => {
    const client = {
      registerEphemeralConsumer: () => () => {},
      recordReceipt: () => {},
    };
    const overlay = new EphemeralOverlay(client, 'presence', {
      connectionId: 'overlay_epoch_conn',
      scope: { room: 'a' },
      userId: 'user_ada',
      permissions: [],
      snapshot: snapshot(2, [{ key: 'cursor_a', version: 5, value: { x: 5 } }]),
    });

    assertEqual(overlay.currentEntries({ prune: false }).map((entry) => entry.key), ['cursor_a'], 'initial snapshot applied');
    assertEqual(
      overlay.apply(snapshot(1, [{ key: 'cursor_old', version: 1, value: { x: 1 } }])),
      'ignored_stale',
      'older epoch snapshot ignored',
    );
    assertEqual(overlay.currentEntries({ prune: false }).map((entry) => entry.key), ['cursor_a'], 'older epoch did not clear entries');
    assertEqual(
      overlay.apply(snapshot(2, [{ key: 'cursor_a', version: 4, value: { x: 4 } }])),
      'ignored_stale',
      'same-epoch lower-version snapshot ignored',
    );
    assertEqual(overlay.currentEntries({ prune: false })[0].entryVersion, 5, 'same-epoch stale snapshot did not regress entry version');
    assertEqual(overlay.apply(snapshot(3, [])), 'applied', 'newer epoch snapshot is a resubscribe boundary');
    assertEqual(overlay.currentEntries({ prune: false }), [], 'newer epoch snapshot replaces the map');
    return { epoch: overlay.scopeEpoch };
  });

  await suite.check('eng_24566: a shared-socket delta between snapshot capture and response is buffered', async () => {
    globalThis.WebSocket = FakeWebSocket;
    const connectionId = 'conn_ephemeral_snapshot_race';
    let subscribeStarted = false;
    let releaseSubscribe;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            connectionId,
            connectionToken: 'sct_snapshot_race',
          }),
        };
      }
      if (path === '/ephemeral/subscribe') {
        subscribeStarted = true;
        return new Promise((resolve) => {
          releaseSubscribe = (body) => resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(body),
          });
        });
      }
      throw new Error(`unexpected request in snapshot race test: ${url}`);
    };

    const db = new SnapbackClient('http://stub');
    const manager = db.liveStreamManager(connectionId, {
      heartbeatIntervalMs: 5_000,
      freshnessBudgetMs: 20_000,
    });
    const before = FakeWebSocket.instances.length;
    const stopDemand = manager.onState(() => {});
    let overlay;
    try {
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      const subscribing = db.subscribeEphemeral('presence', {
        connectionId,
        scope: { room: 'a' },
        transport: 'poll',
      });
      await waitFor(() => subscribeStarted, 'ephemeral subscribe request');

      // The server has already registered this subscriber and captured the
      // version-5 snapshot, but its HTTP response is deliberately held. The
      // shared live socket drains the version-6 remove during that interval.
      ws.dispatch('message', {
        data: JSON.stringify({
          kind: 'ephemeral',
          message: {
            Remove: {
              room: overlayRoom,
              key: 'cursor_a',
              scope_epoch: 2,
              entry_version: 6,
              reason: 'explicit',
            },
          },
        }),
      });
      await sleep(0);
      releaseSubscribe(snapshot(2, [{ key: 'cursor_a', version: 5, value: { x: 5 } }], 5));
      overlay = await subscribing;

      assertEqual(overlay.currentEntries({ prune: false }), [], 'buffered remove applies after the snapshot');
      assertEqual(overlay.highWaterVersion, 6, 'buffered delta advances the authoritative high-water');
      assertEqual(
        overlay.apply({
          Upsert: {
            room: overlayRoom,
            entry: {
              key: 'cursor_a',
              value: encodedValue({ x: 5 }),
              received_at_ms: 105,
              expires_at_ms: 10_000,
              scope_epoch: 2,
              entry_version: 5,
            },
          },
        }),
        'ignored_stale',
        'the delayed pre-remove upsert cannot resurrect the deleted entry',
      );
      assertEqual(overlay.currentEntries({ prune: false }), [], 'stale resurrection remains absent');
      return { highWaterVersion: overlay.highWaterVersion };
    } finally {
      overlay?.dispose();
      stopDemand();
      manager.close();
    }
  });

  await suite.check('eng_24566: pre-snapshot overflow best-effort unsubscribes the abandoned room', async () => {
    globalThis.WebSocket = FakeWebSocket;
    const connectionId = 'conn_ephemeral_snapshot_overflow';
    let subscribeStarted = false;
    let releaseSubscribe;
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            connectionId,
            connectionToken: 'sct_snapshot_overflow',
          }),
        };
      }
      if (path === '/ephemeral/subscribe') {
        subscribeStarted = true;
        return new Promise((resolve) => {
          releaseSubscribe = (body) => resolve({
            ok: true,
            status: 200,
            text: async () => JSON.stringify(body),
          });
        });
      }
      throw new Error(`unexpected request in snapshot overflow test: ${url}`);
    };

    const db = new SnapbackClient('http://stub');
    const manager = db.liveStreamManager(connectionId, {
      heartbeatIntervalMs: 5_000,
      freshnessBudgetMs: 20_000,
    });
    const before = FakeWebSocket.instances.length;
    const stopDemand = manager.onState(() => {});
    try {
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      const subscribing = db.subscribeEphemeral('presence', {
        connectionId,
        scope: { room: 'a' },
        transport: 'poll',
      });
      await waitFor(() => subscribeStarted, 'overflow subscribe request');

      for (let version = 1; version <= 1_025; version += 1) {
        ws.dispatch('message', {
          data: JSON.stringify({
            kind: 'ephemeral',
            message: {
              Upsert: {
                room: overlayRoom,
                entry: {
                  key: `cursor_${version}`,
                  value: encodedValue({ version }),
                  received_at_ms: 100 + version,
                  expires_at_ms: 10_000,
                  scope_epoch: 2,
                  entry_version: version,
                },
              },
            },
          }),
        });
      }
      releaseSubscribe(snapshot(2, [], 0));
      await assertThrows(
        () => subscribing,
        'SNAPBACK_EPHEMERAL_SUBSCRIBE_BUFFER_OVERFLOW',
        'overflow must fail closed instead of returning a partial overlay',
      );

      await waitFor(
        () => ws.sent.some((message) => JSON.parse(message).type === 'ephemeral_unsubscribe'),
        'overflow cleanup unsubscribe',
      );
      const unsubscribe = ws.sent
        .map((message) => JSON.parse(message))
        .find((message) => message.type === 'ephemeral_unsubscribe');
      assertEqual(unsubscribe.request.collection, 'presence', 'cleanup keeps collection identity');
      assertEqual(unsubscribe.request.scope, { room: 'a' }, 'cleanup keeps room scope');
      ws.dispatch('message', {
        data: JSON.stringify({
          kind: 'ephemeral_ack',
          requestId: unsubscribe.requestId,
          operation: 'unsubscribe',
          removed: true,
        }),
      });
      return { cleanup: unsubscribe.type };
    } finally {
      stopDemand();
      manager.close();
    }
  });
} finally {
  globalThis.fetch = originalFetch;
  if (originalWebSocket === undefined) delete globalThis.WebSocket;
  else globalThis.WebSocket = originalWebSocket;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
