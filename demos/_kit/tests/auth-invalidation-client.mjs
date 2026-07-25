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
  headers: new Headers(),
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
const ackOutcomes = ['discharged', 'stale', 'discharged', 'discharged', 'discharged', 'discharged'];
let failQueueRevision3 = true;
let blockedScopeSequence = null;
let blockedQueueStarted = null;
let releaseBlockedQueue = null;
let namespace;
let scopeId;

const queue = {
  async applyObligation(value) {
    order.push(`queue-apply:${value.revision}`);
    appliedScopeSequences.push(value.scopeId.scopeSequence);
    if (value.scopeId.scopeSequence === blockedScopeSequence) {
      blockedQueueStarted?.();
      await new Promise((resolve) => { releaseBlockedQueue = resolve; });
    }
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
      });
      return response({
        connectionId: 'granted-auth',
        connectionToken: 'sct_auth',
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
      return response({ outcome: ackOutcomes.shift() });
    }
    if (path === '/outbox/granted-auth') return response(outbox.shift() ?? []);
    if (path === '/live/listTodos/unsubscribe') {
      return response({ subscription_id: 'sub_auth', disposed: true });
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
  assert(boundaries.some(({ kind }) => kind === 'authorization_quarantine'));
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

  // Independent scope roots coexist. A slow durable delete for scope A must
  // not be cancelled merely because a retain+resolution for scope B arrives
  // while A's queue write is pending.
  const scopeA = { ...scopeId, scopeSequence: 41 };
  const scopeB = { ...scopeId, scopeSequence: 42 };
  const slowDelete = {
    ...obligation(scopeA, 1, 15),
    maxDisposition: 'delete',
  };
  const independentRetain = {
    ...obligation(scopeB, 1, 15),
    maxDisposition: 'retain',
  };
  blockedScopeSequence = scopeA.scopeSequence;
  const queueStarted = new Promise((resolve) => { blockedQueueStarted = resolve; });
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: slowDelete,
    resolution: null,
    snapshot: null,
  }) } }]);
  await handle.poll();
  await queueStarted;
  outbox.push([{ Durable: { payload: JSON.stringify({
    kind: 'authorization_invalidation',
    obligation: independentRetain,
    resolution: resolution(independentRetain, 'ack_5'),
    snapshot: {
      subscriptionId: 'sub_auth',
      function: 'listTodos',
      version: 15,
      rows: [{ _id: 'scope_b_only' }],
    },
  }) } }]);
  await handle.poll();
  releaseBlockedQueue();
  await waitFor(
    () => assert.equal(order.filter((entry) => entry === 'ack:ack_5').length, 1),
    'independent retain scope did not discharge after the slow delete root',
  );
  assert(appliedScopeSequences.includes(41), 'slow delete root reached durable queue custody');
  assert.deepEqual(handle.rows, [], 'unresolved delete scope keeps the aggregate boundary blank');
  assert.equal(
    authorizationErrors.length,
    errorsBeforeExactRefire,
    'coexisting scope roots do not manufacture a stale-task fault',
  );
  assert.equal(ackOutcomes.length, 0);

  handle.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log('kit authorization invalidation integration: ok');
} finally {
  globalThis.fetch = originalFetch;
}
