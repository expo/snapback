import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLIENT_AUTHORITY_OPERATION_TIMINGS,
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_SURFACES,
  CLIENT_AUTHORITY_TERMINALS,
  CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS,
  CLIENT_AUTHORITY_TRANSITION_EVENTS,
  authorityTransitionCell,
  classifyClientAuthorityState,
} from './authority-transition.mjs';
import { SnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const EXPECTED_TERMINALS_BY_SURFACE = Object.freeze({
  'one-shot-anonymous': ['admit', 'join', 'admit', 'join', 'admit'],
  'one-shot-authenticated': ['refuse', 'join', 'admit', 'join', 'admit'],
  'live-optional-user': ['admit', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'live-authenticated': ['blocked', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'mutation-foreground': ['project', 'join', 'admit', 'join', 'queue'],
  'mutation-housekeeping': ['admit', 'queue', 'admit', 'queue', 'queue'],
  'outbox-drain': ['drain-active', 'drain-suspended', 'drain-active', 'drain-suspended', 'drain-suspended'],
  ephemeral: ['admit', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'react-familiar': ['project', 'project', 'project', 'project', 'project'],
  provider: ['provider-wait', 'provider-wait', 'admit', 'provider-teardown-rearm', 'provider-retain'],
});

test('the normative authority matrix generates every W2 row exactly once', () => {
  const expectedCount = CLIENT_AUTHORITY_SURFACES.length
    * CLIENT_AUTHORITY_STATES.length
    * CLIENT_AUTHORITY_TRANSITION_EVENTS.length
    * CLIENT_AUTHORITY_OPERATION_TIMINGS.length;
  assert.equal(CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS.length, expectedCount);
  assert.equal(new Set(CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS.map((row) => row.id)).size, expectedCount);
  for (const row of CLIENT_AUTHORITY_TRANSITION_CONFORMANCE_ROWS) {
    assert.deepEqual(row.expected, authorityTransitionCell(row.surface, row.startingState), row.id);
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(row.expected.observable), true);
  }
});

test('every generated cell matches the independently transcribed closed terminal matrix', () => {
  assert.deepEqual(Object.keys(EXPECTED_TERMINALS_BY_SURFACE), [...CLIENT_AUTHORITY_SURFACES]);
  for (const [surface, expectedTerminals] of Object.entries(EXPECTED_TERMINALS_BY_SURFACE)) {
    assert.equal(expectedTerminals.length, CLIENT_AUTHORITY_STATES.length);
    for (const [index, state] of CLIENT_AUTHORITY_STATES.entries()) {
      const expected = expectedTerminals[index];
      assert.equal(CLIENT_AUTHORITY_TERMINALS.includes(expected), true);
      assert.equal(authorityTransitionCell(surface, state).terminal, expected, `${surface}/${state}`);
    }
  }
});

test('the ordered classifier gives the barrier priority over reconnecting and mode-pending', () => {
  const anonymous = { kind: 'anonymous' };
  const session = { kind: 'session' };
  assert.equal(classifyClientAuthorityState({ successor: anonymous }), 'anonymous');
  assert.equal(classifyClientAuthorityState({ successor: session }), 'authenticated');
  assert.equal(classifyClientAuthorityState({ successor: session, modePending: true }), 'reconnecting');
  assert.equal(classifyClientAuthorityState({ predecessor: anonymous, successor: session, barrierActive: true, reconnecting: true }), 'authenticating');
  assert.equal(classifyClientAuthorityState({ predecessor: session, successor: anonymous, barrierActive: true }), 'revoking');
  assert.equal(classifyClientAuthorityState({ predecessor: anonymous, successor: session, barrierActive: true, authModeChanged: true }), 'revoking');
  assert.equal(classifyClientAuthorityState({ predecessor: anonymous, successor: session, barrierActive: true, incarnationChanged: true }), 'revoking');
});

test('axisless watch-reload mode-pending is bounded-retried while the terminal axis stays terminal', async () => {
  const originalFetch = globalThis.fetch;
  const modePending = (details = {}) => Response.json({
    diagnostic: {
      code: 'SNAPBACK_AUTH_MODE_PENDING',
      message: 'auth-mode activation is settling',
      details,
    },
  }, { status: 503 });
  const client = new SnapbackClient('https://authority-transition-watch-reload.test', {
    rqsStore: null,
    reservationRetryJitterMilliseconds: [0, 0],
  });
  try {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return attempts < 3
        ? modePending()
        : Response.json({ version: 1, rows: [{ id: 'successor' }] });
    };
    assert.deepEqual((await client.query('watchReloadProbe')).rows, [{ id: 'successor' }]);
    assert.equal(attempts, 3);
    assert.equal(client.authTerminalStatus().terminated, false);

    attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return modePending({ authorityDisposition: 'durableDelete' });
    };
    await assert.rejects(
      client.query('stagedModeTransitionProbe'),
      (error) => (
        error.diagnostic?.code === 'SNAPBACK_AUTH_MODE_PENDING'
        && error.authorityDisposition === 'durableDelete'
      ),
    );
    assert.equal(attempts, 1);

    attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return modePending({ authorityDisposition: 'future-value' });
    };
    await assert.rejects(
      client.query('malformedModeTransitionProbe'),
      (error) => (
        error.diagnostic?.code === 'SNAPBACK_AUTH_MODE_PENDING'
        && error.authorityDisposition === 'carrier'
      ),
    );
    assert.equal(attempts, 1);
  } finally {
    await client.closeAuth();
    globalThis.fetch = originalFetch;
  }
});

test('housekeeping coalesces latest-wins with typed supersession and preserves phase timing', async () => {
  let clock = 10;
  const store = createMemoryRqsResumeStore({ now: () => ++clock });
  const record = (id, value) => ({
    id,
    function: 'refreshCache',
    args: { value },
    dispatchLane: 'housekeeping',
    housekeepingKey: 'refresh-cache',
  });
  const first = await store.outboxEnqueue(record('hk-first', 1));
  const foreground = await store.outboxEnqueue({
    id: 'foreground-after-suspended-housekeeping',
    function: 'saveUserIntent',
    args: { value: 'foreground' },
    dispatchLane: 'foreground',
  });
  const second = await store.outboxEnqueue(record('hk-second', 2));
  let records = await store.outboxRecords();
  assert.equal(records.find(({ id }) => id === first.id).failure.code, 'SNAPBACK_HOUSEKEEPING_SUPERSEDED');
  assert.equal(records.find(({ id }) => id === second.id).status, 'pending');
  const foregroundPrepared = await store.outboxPrepareSubmission(foreground.id);
  assert.equal(foregroundPrepared.status, 'ready', 'an earlier suspended housekeeping row is not a foreground head-of-line fence');
  assert.equal(foregroundPrepared.record.dispatchLane, 'foreground');
  const prepared = await store.outboxPrepareSubmission(second.id, { markDispatched: true });
  assert.equal(prepared.record.timing.enqueuedAtMs < prepared.record.timing.dispatchedAtMs, true);
  const third = await store.outboxEnqueue(record('hk-third', 3));
  records = await store.outboxRecords();
  assert.equal(
    records.find(({ id }) => id === second.id).status,
    'pending',
    'an already-dispatched housekeeping effect is never mislabeled superseded',
  );
  assert.equal(records.find(({ id }) => id === third.id).status, 'pending');
  await store.outboxDurablyConsume(second.id, {
    result: { ok: true },
    timing: { authorizedAtMs: 20, executedAtMs: 21, committedAtMs: 22 },
  });
  records = await store.outboxRecords();
  const settled = records.find(({ id }) => id === second.id);
  assert.deepEqual(settled.timing, {
    enqueuedAtMs: second.timing.enqueuedAtMs,
    dispatchedAtMs: prepared.record.timing.dispatchedAtMs,
    authorizedAtMs: 20,
    executedAtMs: 21,
    committedAtMs: 22,
  });
  const phases = Object.values(settled.timing);
  assert.equal(phases.every(Number.isInteger), true);
  assert.equal(phases.every((value, index) => index === 0 || phases[index - 1] < value), true);
});

test('slow housekeeping never head-of-line blocks foreground while transition cuts stay exclusive', async () => {
  const store = createMemoryRqsResumeStore();
  let releaseHousekeeping;
  let enterHousekeeping;
  const housekeepingEntered = new Promise((resolve) => { enterHousekeeping = resolve; });
  const housekeepingHeld = new Promise((resolve) => { releaseHousekeeping = resolve; });
  const slowHousekeeping = store.withOutboxAuthorizationDispatch(async () => {
    enterHousekeeping();
    await housekeepingHeld;
  }, { lane: 'housekeeping' });
  await housekeepingEntered;

  let foregroundEntered = false;
  await store.withOutboxAuthorizationDispatch(async () => {
    foregroundEntered = true;
  }, { lane: 'foreground' });
  assert.equal(foregroundEntered, true);

  let transitionEntered = false;
  const transitionCut = store.withOutboxAuthorizationDispatch(async () => {
    transitionEntered = true;
  });
  await Promise.resolve();
  assert.equal(transitionEntered, false, 'an authority cut still waits for both dispatch lanes');
  releaseHousekeeping();
  await slowHousekeeping;
  await transitionCut;
  assert.equal(transitionEntered, true);
});

test('successor-valid housekeeping admitted before the durable barrier cut binds only after settle', async () => {
  const store = createMemoryRqsResumeStore();
  const before = await store.outboxAuthorizationStatus();
  await store.outboxEnqueue({
    id: 'hk-before-durable-cut',
    function: 'refreshCache',
    args: { route: '/inbox' },
    dispatchLane: 'housekeeping',
    housekeepingKey: 'route-inbox',
    successorTargetedHousekeeping: true,
  }, before);
  await store.wipeForAuthorityTransition('sessions:test:0->1', 1);
  const advanced = await store.outboxAuthorizationStatus();
  const principalScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7b11-7a22-8c33-445566778899',
    userId: '018f0d90-7b14-7a22-8c33-445566778899',
  };
  const authorityDescriptor = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b15-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const custody = {
    authorityEpoch: 1,
    authorityKey: 'session:successor',
  };
  const reconciled = await store.outboxReconcileCustody(
    principalScope,
    authorityDescriptor,
    custody,
    advanced.authorityGeneration,
  );
  assert.deepEqual(reconciled, {
    deleted: 0,
    deletedIds: [],
    stranded: 0,
    strandedIds: [],
  });
  const [record] = await store.outboxRecords();
  assert.equal(record.status, 'pending');
  assert.equal(record.successorTargetedHousekeeping, false);
  assert.deepEqual(record.principalScope, principalScope);
  assert.deepEqual(record.authorityDescriptor, authorityDescriptor);
  assert.deepEqual(record.custody, custody);
  assert.equal(record.authorizationAuthorityGeneration, advanced.authorityGeneration);
});

test('declared housekeeping queues with auth-barrier attribution and zero transport', async () => {
  const originalFetch = globalThis.fetch;
  let transportAttempts = 0;
  globalThis.fetch = async () => {
    transportAttempts += 1;
    throw new Error('authority-barrier conformance must issue zero transport');
  };
  let transitionStatus = Object.freeze({
    state: 'authenticating',
    settled: false,
    subscribeSafe: false,
    ephemeralAuthorityUsable: false,
    transitionOwner: 'auth-coordinator',
    barrierPhase: 'commitDurable',
    authorityEpoch: 1,
    custodyRevision: 2,
    closed: false,
  });
  const transitionListeners = new Set();
  const authorityFence = {
    authority: null,
    registerParticipant: () => null,
    authorityTransitionStatus: () => transitionStatus,
    subscribeAuthorityTransition(listener) {
      transitionListeners.add(listener);
      listener(transitionStatus);
      return () => transitionListeners.delete(listener);
    },
  };
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  const initialAuthorization = await store.outboxAuthorizationStatus();
  await store.outboxApplyAuthorizationObligation({
    protocolVersion: 1,
    scopeId: {
      kind: 'clientQuery',
      namespace: {
        clientStoreId: 'authority-transition-housekeeping',
        queryKey: 'refreshCache:{}',
        queryInstanceId: 1,
      },
    },
    revision: 1,
    maxDisposition: 'delete',
    witness: {
      authorization: {
        incarnation: '018f0d90-7b27-7a22-8c33-445566778899',
        epoch: 1,
      },
      data: null,
    },
    retryEpisodeId: null,
  }, initialAuthorization.authorityGeneration);
  assert.equal((await store.outboxAuthorizationStatus()).effectiveDisposition, 'delete');
  const client = new SnapbackClient('https://authority-transition-housekeeping.test', {
    authCoordinator: authorityFence,
    rqsStore: store,
    __offlineMutationReplayCapability: true,
    __outboxDrainLifecycle: false,
  });
  try {
    const queued = await client.mutate('refreshCache', {
      args: { route: '/inbox' },
      clientMutationId: 'hk-auth-barrier',
      housekeeping: { key: 'route-inbox', idempotent: true, successorValid: true },
    });
    assert.equal(queued.status, 'queued');
    assert.equal(queued.blockedReason, 'auth-barrier');
    assert.equal(transportAttempts, 0);
    const stored = (await store.outboxRecords()).find(({ id }) => id === 'hk-auth-barrier');
    assert.equal(stored.status, 'pending');
    assert.equal(stored.dispatchLane, 'housekeeping');
    assert.equal(Number.isInteger(stored.timing.enqueuedAtMs), true);
    assert.equal((await client.outboxStatus()).blockedReason, 'auth-barrier');
    transitionStatus = Object.freeze({
      ...transitionStatus,
      state: 'authenticated',
      settled: true,
      subscribeSafe: true,
      ephemeralAuthorityUsable: true,
      transitionOwner: null,
      barrierPhase: null,
      authorityEpoch: 2,
      custodyRevision: 3,
    });
    for (const listener of transitionListeners) listener(transitionStatus);
    assert.equal(client.authorityTransitionStatus().state, 'authenticated');
    assert.equal(client.authorityTransitionStatus().settled, true);
  } finally {
    await client.closeAuth();
    globalThis.fetch = originalFetch;
  }
});
