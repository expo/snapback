// Item-6 client integration: authenticated connection expectation, exact query
// namespace, synchronous blanking, queue custody, snapshot commit, then ACK.

import assert from 'node:assert/strict';

import { SnapbackClient } from '../client.mjs';

const originalFetch = globalThis.fetch;
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const issuerId = {
  authorizationIncarnation: INCARNATION,
  bootSequence: 7,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
};
const authorization = { incarnation: INCARNATION, epoch: 4 };

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-auth-invalidation',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: null,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: null,
    },
    queuedReplay: {
      available: false,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: { userId: 'user_1', sessionId: 'session_1', isAuthenticated: true },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  },
  authorizedLease: null,
};

const witness = (version) => ({
  authorization,
  data: { versionStream: 'stream-A', minCommitVersion: version },
});

const obligation = (scopeId, revision, version) => ({
  protocolVersion: 1,
  scopeId,
  revision,
  maxDisposition: 'quarantine',
  witness: witness(version),
  retryEpisodeId: null,
  ownerContinuityId: 'owner_1',
});

const resolution = (pending, ackToken) => ({
  protocolVersion: 1,
  kind: 'snapshot',
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: pending.witness,
  maxDisposition: pending.maxDisposition,
  ackToken,
  ownerContinuityId: pending.ownerContinuityId,
});

const waitFor = async (check, label) => {
  const deadline = Date.now() + 1_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
};

const order = [];
const appliedScopeSequences = [];
const boundaries = [];
const authorizationErrors = [];
const outbox = [];
const ackOutcomes = [
  'discharged',
  'stale',
  'discharged',
  'discharged',
  'discharged',
  'duplicate',
  'discharged',
  'transport-error',
  'discharged',
  'discharged',
];
let failQueueRevision3 = true;
let namespace;
let scopeId;
let subscribeCalls = 0;

const queue = {
  async applyObligation(value) {
    order.push(`queue-apply:${value.revision}`);
    appliedScopeSequences.push(value.scopeId.scopeSequence);
    if (value.revision === 3 && failQueueRevision3) {
      failQueueRevision3 = false;
      throw new Error('injected queue custody failure');
    }
  },
  async resolveObligation(value) {
    order.push(`queue-resolve:${value.revision}`);
  },
  async retireScopes(scopes) {
    order.push(`queue-retire:${scopes.length}`);
  },
};

try {
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return response(handshake);
    if (path === '/connection/open') {
      assert.deepEqual(JSON.parse(init.body), {
        connectionId: 'connection-label',
        authInvalidationProtocol: 1,
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
      });
      return response({
        connectionId: 'granted-auth',
        connectionToken: 'sct_auth',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId,
          connectionGeneration: 2,
          authorization,
          versionStream: 'stream-A',
        },
      });
    }
    if (path === '/live/listTodos/subscribe') {
      subscribeCalls += 1;
      const body = JSON.parse(init.body);
      namespace = body.authorizationNamespace;
      scopeId = {
        kind: 'subscription',
        issuerId,
        namespace,
        scopeSequence: 1,
        connectionGeneration: 2,
        subscriptionId: 'sub_auth',
      };
      const pending = obligation(scopeId, 1, 10);
      return response({
        subscription_id: 'sub_auth',
        snapshot: { version: 10, rows: [{ _id: 'row_10' }] },
        permission_epochs: {},
        authorizationScope: scopeId,
        authorizationInvalidation: {
          obligation: pending,
          resolution: resolution(pending, 'ack_1'),
        },
      });
    }
    if (path === '/live/authorization-invalidation/acknowledge') {
      const body = JSON.parse(init.body);
      order.push(`ack:${body.ackToken}`);
      assert.equal(body.connectionId, 'granted-auth');
      const outcome = ackOutcomes.shift();
      if (outcome === 'transport-error') {
        throw new Error('injected acknowledgement transport failure');
      }
      return response({ outcome });
    }
    if (path === '/outbox/granted-auth') return response(outbox.shift() ?? []);
    if (path === '/live/listTodos/unsubscribe') {
      order.push('unsubscribe');
      return response({
        subscription_id: 'sub_auth',
        disposed: true,
        scopeRetirement: {
          issuerId,
          namespace,
          retireThroughScopeSequence: 40,
          authorizationExpectation: authorization,
          mac: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        },
      });
    }
    throw new Error(`unexpected request: ${path}`);
  };

  const client = new SnapbackClient('http://stub', {
    bearerToken: 'session-secret',
    authInvalidationProtocol: 1,
    clientStoreId: 'store_auth_test',
  });
  const handle = await client.liveQuery('listTodos', {
    connectionId: 'connection-label',
    args: { status: 'open' },
    authorizationQueue: queue,
    onAuthorizationBoundary(rows, detail) {
      boundaries.push({ rows: structuredClone(rows), kind: detail.kind });
    },
    onAuthorizationError(error) {
      authorizationErrors.push(error);
    },
  });

  assert.deepEqual(namespace, {
    clientStoreId: 'store_auth_test',
    queryKey: 'listTodos:{"status":"open"}',
    queryInstanceId: 1,
  });
  assert.deepEqual(handle.rows, [{ _id: 'row_10' }]);
  assert.equal(handle.authorizationDisposition, 'retain');
  assert.deepEqual(order.slice(0, 3), [
    'queue-apply:1',
    'queue-resolve:1',
    'ack:ack_1',
  ]);
  assert(
    !boundaries.some(({ kind }) => kind === 'authorization_quarantine'),
    'a usable same-envelope successor snapshot defers the observable quarantine boundary',
  );
  assert(boundaries.some(({ kind }) => kind === 'authorization_snapshot'));

  // A pending obligation blanks synchronously. A later ordinary replace in
  // the same destructively drained batch cannot repopulate the boundary.
  const second = obligation(scopeId, 2, 11);
  outbox.push([
    { Durable: { payload: JSON.stringify({
      kind: 'authorization_invalidation',
      obligation: second,
      resolution: null,
      snapshot: null,
    }) } },
    { Durable: { payload: JSON.stringify({
      kind: 'live_replace',
      subscription_id: 'sub_auth',
      function: 'listTodos',
      version: 99,
      rows: [{ _id: 'must_not_render' }],
    }) } },
  ]);
  await handle.poll();
  assert.deepEqual(handle.rows, []);
  await waitFor(
    () => assert(order.includes('queue-apply:2')),
    'queue suspension did not commit',
  );

  // A stale ACK re-quarantines and reinstalls queue custody. It cannot turn an
  // old resolution into a release while the server owns a newer revision.
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: second,
    resolution: resolution(second, 'ack_2'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 12,
      rows: [{ _id: 'row_12' }],
    },
  }) } }]);
  await handle.poll();
  await waitFor(
    () => assert.equal(order.filter((entry) => entry === 'ack:ack_2').length, 1),
    'stale ACK was not attempted',
  );
  assert.deepEqual(handle.rows, []);
  assert.equal(handle.authorizationDisposition, 'quarantine');
  assert(order.filter((entry) => entry === 'queue-apply:2').length >= 3);

  // Level-triggered re-fire carries the same proof and ACK token; a current
  // discharge reveals only its committed snapshot.
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: second,
    resolution: resolution(second, 'ack_2'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 12,
      rows: [{ _id: 'row_12' }],
    },
  }) } }]);
  await handle.poll();
  await waitFor(
    () => assert.deepEqual(handle.rows, [{ _id: 'row_12' }]),
    'current discharge did not reveal the snapshot',
  );
  assert.equal(handle.authorizationDisposition, 'retain');

  // A queue/store fault is itself fail-closed. Once faulted, an ordinary live
  // frame cannot repopulate the handle; only a valid obligation re-fire plus
  // its authenticated replacement snapshot may recover it.
  const third = obligation(scopeId, 3, 13);
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: third,
    resolution: null,
    snapshot: null,
  }) } }]);
  await handle.poll();
  await waitFor(
    () => assert.equal(handle.connection, 'stale'),
    'queue fault did not fail the query closed',
  );
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'live_replace',
    subscription_id: 'sub_auth',
    function: 'listTodos',
    version: 100,
    rows: [{ _id: 'must_not_render_after_fault' }],
  }) } }]);
  await handle.poll();
  assert.deepEqual(handle.rows, []);

  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: third,
    resolution: resolution(third, 'ack_3'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 13,
      rows: [{ _id: 'row_13' }],
    },
  }) } }]);
  await handle.poll();
  await waitFor(
    () => assert.deepEqual(handle.rows, [{ _id: 'row_13' }]),
    'valid re-fire did not recover the faulted query',
  );
  const errorsBeforeExactRefire = authorizationErrors.length;

  // The socket drain can carry an outbox snapshot and the level-triggered
  // projection of the same exact ticket in one turn. They share one custody,
  // resolution, and ACK task; the duplicate cannot race the first task and
  // falsely fail the query closed as a stale resolution.
  const fourth = obligation(scopeId, 4, 14);
  const fourthFrame = { Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: fourth,
    resolution: resolution(fourth, 'ack_4'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 14,
      rows: [{ _id: 'row_14' }],
    },
  }) } };
  outbox.push([fourthFrame, structuredClone(fourthFrame)]);
  await handle.poll();
  await waitFor(
    () => assert.deepEqual(handle.rows, [{ _id: 'row_14' }]),
    'same-turn exact-ticket re-fire did not reveal the snapshot',
  );
  assert.equal(order.filter((entry) => entry === 'queue-resolve:4').length, 1);
  assert.equal(order.filter((entry) => entry === 'ack:ack_4').length, 1);
  assert.equal(
    authorizationErrors.length,
    errorsBeforeExactRefire,
    'same exact ticket does not report a stale-resolution fault',
  );

  // Once local proof and ACK have completed, a delayed exact redelivery still
  // re-ACKs the same token without reapplying rows or durable queue custody.
  outbox.push([structuredClone(fourthFrame)]);
  await handle.poll();
  await waitFor(
    () => assert.equal(order.filter((entry) => entry === 'ack:ack_4').length, 2),
    'delayed exact-ticket redelivery did not re-acknowledge its original token',
  );
  assert.equal(order.filter((entry) => entry === 'queue-resolve:4').length, 1);
  assert.equal(
    authorizationErrors.length,
    errorsBeforeExactRefire,
    'delayed exact-ticket redelivery does not manufacture a protocol fault',
  );

  // Token dedupe is bound to the entire resolution frame. A same-turn frame
  // that reuses the valid task's token with changed ticket fields is surfaced
  // and never starts a second ACK task.
  const fifth = obligation(scopeId, 5, 15);
  const fifthFrame = { Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: fifth,
    resolution: resolution(fifth, 'ack_5'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 15,
      rows: [{ _id: 'row_15' }],
    },
  }) } };
  const conflictingFifthFrame = structuredClone(fifthFrame);
  const conflictingFifthPayload = JSON.parse(conflictingFifthFrame.Durable.payload);
  conflictingFifthPayload.resolution.maxDisposition = 'delete';
  conflictingFifthFrame.Durable.payload = JSON.stringify(conflictingFifthPayload);
  outbox.push([fifthFrame, conflictingFifthFrame]);
  await handle.poll();
  await waitFor(
    () => assert.equal(order.filter((entry) => entry === 'ack:ack_5').length, 1),
    'the exact resolution was not acknowledged once',
  );
  await waitFor(
    () => assert.equal(authorizationErrors.length, errorsBeforeExactRefire + 1),
    'conflicting same-token ticket did not surface a protocol diagnostic',
  );
  assert.equal(order.filter((entry) => entry === 'queue-resolve:5').length, 1);
  const errorsBeforeForeign = authorizationErrors.length;

  // A matching subscription id is not ownership. Scope sequence and
  // connection generation are part of the exact held scope; foreign frames
  // diagnose without touching queue custody or acknowledging for another
  // owner.
  const queueApplicationsBeforeForeign = appliedScopeSequences.length;
  const acknowledgementsBeforeForeign = order.filter((entry) => entry.startsWith('ack:')).length;
  for (const foreignScope of [
    { ...scopeId, scopeSequence: scopeId.scopeSequence + 1 },
    { ...scopeId, connectionGeneration: scopeId.connectionGeneration + 1 },
  ]) {
    const foreign = obligation(foreignScope, 1, 15);
    outbox.push([{ Durable: { payload: JSON.stringify({
      kind: 'authorization_invalidation',
      obligation: foreign,
      resolution: resolution(foreign, `ack_foreign_${foreignScope.scopeSequence}`),
      snapshot: {
        subscriptionId: 'sub_auth',
        function: 'listTodos',
        version: 15,
        rows: [{ _id: 'foreign_scope_row' }],
      },
    }) } }]);
    await handle.poll();
  }
  await waitFor(
    () => assert.equal(authorizationErrors.length, errorsBeforeForeign + 2),
    'foreign exact scopes did not surface protocol diagnostics',
  );
  assert.equal(appliedScopeSequences.length, queueApplicationsBeforeForeign);
  assert.equal(
    order.filter((entry) => entry.startsWith('ack:')).length,
    acknowledgementsBeforeForeign,
  );
  assert.deepEqual(handle.rows, [{ _id: 'row_15' }], 'foreign scopes do not alter owned rows');
  assert.equal(ackOutcomes.length, 3);

  // A resolution is locally applied before its remote ACK. If that ACK loses
  // transport, the fail-closed error boundary blanks the handle, but the exact
  // level-triggered redelivery must restore the already-accepted boundary and
  // re-ACK without repeating mutation-queue resolution.
  const ackFailureObligation = obligation(scopeId, 6, 16);
  const ackFailureFrame = { Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: ackFailureObligation,
    resolution: resolution(ackFailureObligation, 'ack_transport_6'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 16,
      rows: [{ _id: 'row_16' }],
    },
  }) } };
  outbox.push([structuredClone(ackFailureFrame)]);
  await handle.poll();
  await waitFor(
    () => assert.equal(
      order.filter((entry) => entry === 'ack:ack_transport_6').length,
      1,
    ),
    'the first transport-failed acknowledgement was not attempted',
  );
  await waitFor(
    () => assert.deepEqual(handle.rows, []),
    'acknowledgement transport failure did not fail the materialization closed',
  );
  assert.equal(
    order.filter((entry) => entry === 'queue-resolve:6').length,
    1,
    'the accepted resolution completed queue custody once before its ACK',
  );

  outbox.push([structuredClone(ackFailureFrame)]);
  await handle.poll();
  await waitFor(
    () => assert.deepEqual(handle.rows, [{ _id: 'row_16' }]),
    'exact redelivery did not restore the already-accepted snapshot boundary',
  );
  await waitFor(
    () => assert.equal(
      order.filter((entry) => entry === 'ack:ack_transport_6').length,
      2,
    ),
    'exact redelivery did not retry the original acknowledgement token',
  );
  assert.equal(
    order.filter((entry) => entry === 'queue-resolve:6').length,
    1,
    'exact redelivery must not repeat queue resolution after ACK transport loss',
  );
  assert.equal(ackOutcomes.length, 1);

  // Terminal deletion is a one-way fence for this exact query instance. Every
  // ordinary live/lifecycle recovery input is diagnosed and ignored; a caller
  // that wants the canonical query again must construct a fresh handle and
  // therefore allocate a fresh queryInstanceId.
  const terminalObligation = {
    ...obligation(scopeId, 7, 16),
    maxDisposition: 'delete',
  };
  const terminalResolution = {
    ...resolution(terminalObligation, 'ack_terminal_7'),
    kind: 'terminalDelete',
  };
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: terminalObligation,
    resolution: terminalResolution,
    snapshot: null,
  }) } }]);
  await handle.poll();
  await waitFor(
    () => assert(order.includes('ack:ack_terminal_7')),
    'terminal delete did not commit before acknowledgement',
  );
  assert.deepEqual(handle.rows, []);
  const errorsBeforeTerminalReuse = authorizationErrors.length;
  const subscribesBeforeTerminalReuse = subscribeCalls;
  outbox.push([
    { Durable: { payload: JSON.stringify({
      kind: 'live_replace',
      subscription_id: 'sub_auth',
      version: 16,
      rows: [{ _id: 'must_not_resurrect' }],
    }) } },
    { Durable: { payload: JSON.stringify({
      kind: 'current_as_of',
      subscription_id: 'sub_auth',
      version: 17,
    }) } },
    { Durable: { payload: JSON.stringify({
      kind: 'resync_required',
      subscription_id: 'sub_auth',
      reason: 'terminal-reuse-probe',
    }) } },
  ]);
  await handle.poll();
  await waitFor(
    () => assert.equal(authorizationErrors.length, errorsBeforeTerminalReuse + 3),
    'terminal ordinary frames did not surface protocol diagnostics',
  );
  assert.deepEqual(handle.rows, []);
  assert.equal(subscribeCalls, subscribesBeforeTerminalReuse);

  // Terminal deletion already retired this exact server demand and terminally
  // fenced the query instance. Pause must recognize that boundary locally: a
  // duplicate T-UNSUB would present an intentionally stale capture and cannot
  // advance a deleted query back into an active lifecycle.
  const unsubscribesBeforePause = order.filter((entry) => entry === 'unsubscribe').length;
  await handle.pause();
  assert.equal(
    order.filter((entry) => entry === 'unsubscribe').length,
    unsubscribesBeforePause,
    'pause does not repeat T-UNSUB after terminal deletion already retired the query',
  );
  const pausedAuthorizationState = handle.authorizationState();
  assert(
    pausedAuthorizationState.terminalDeleted === true,
    `pause preserves the terminally deleted query fence: ${JSON.stringify(pausedAuthorizationState)}`,
  );
  assert.equal(
    pausedAuthorizationState.lifecycle,
    'active',
    'the handle lifecycle remains locally active/paused while the terminal marker prevents reuse',
  );
  await handle.resume();
  assert.equal(
    subscribeCalls,
    subscribesBeforeTerminalReuse,
    'foreground resume cannot reuse a terminally deleted query instance',
  );
  assert.equal(handle.paused, true);

  handle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log('kit authorization invalidation integration: ok');

  // Anonymous-public custody regression: streaming live work is auth-scoped
  // even without a credential, so a configured authorization-invalidation
  // offer must reach the wire as the request header on /live/ paths. The
  // custody branch used to send only the base offer headers, making the
  // server's SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED remedy
  // ("configure SnapbackClient with authInvalidationProtocol: 1")
  // unsatisfiable for anonymous streaming clients (found by the Zerobugs
  // zb5-hot gate's anonymous observer).
  {
    const liveHeaders = [];
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/connection/open') {
        return response({
          connectionId: 'granted-anon',
          connectionToken: 'sct_anon',
          wireVersion: 'snapback.v1',
          authorizationInvalidation: {
            protocolVersion: 1,
            issuerId,
            connectionGeneration: 1,
            authorization,
            versionStream: 'stream-anon',
          },
        });
      }
      if (path === '/live/listTodos/subscribe') {
        liveHeaders.push({ ...(init.headers ?? {}) });
        return response({
          subscription_id: 'sub_anon',
          snapshot: { version: 1, rows: [] },
          permission_epochs: {},
        });
      }
      if (path === '/live/listTodos/unsubscribe') {
        return response({ subscription_id: 'sub_anon', disposed: true });
      }
      if (path === '/outbox/granted-anon') return response([]);
      throw new Error(`unexpected anonymous request: ${path}`);
    };
    const anonymous = new SnapbackClient('http://stub', {
      custody: 'anonymous-public',
      adminToken: null,
      authInvalidationProtocol: 1,
      clientStoreId: 'store_anon_invalidation_test',
    });
    const anonymousHandle = await anonymous.liveQuery('listTodos', {
      connectionId: 'anon-connection',
      args: {},
      onSnapshot: () => {},
    });
    assert(liveHeaders.length > 0, 'anonymous live subscribe was issued');
    assert.equal(
      liveHeaders[0]['x-snapback-auth-invalidation-protocol'],
      '1',
      'anonymous-public custody sends the authorization-invalidation offer header on /live/ paths',
    );
    assert.equal(
      liveHeaders[0].authorization,
      undefined,
      'anonymous-public custody still sends no bearer',
    );
    anonymousHandle.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    console.log('kit anonymous-public live invalidation offer header: ok');
  }
} finally {
  globalThis.fetch = originalFetch;
}
