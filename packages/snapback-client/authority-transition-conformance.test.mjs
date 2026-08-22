import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_SURFACES,
  CLIENT_AUTHORITY_TERMINALS,
  authorityTransitionCell,
  classifyClientAuthorityState,
} from './authority-transition.mjs';
import { SnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const EXPECTED_TERMINALS_BY_SURFACE = Object.freeze({
  'one-shot-anonymous': ['admit', 'refuse', 'admit', 'refuse', 'admit'],
  'one-shot-authenticated': ['refuse', 'refuse', 'admit', 'refuse', 'admit'],
  'live-optional-user': ['admit', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'live-authenticated': ['blocked', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'mutation-foreground': ['project', 'refuse', 'admit', 'refuse', 'queue'],
  'mutation-housekeeping': ['admit', 'queue', 'admit', 'queue', 'queue'],
  'outbox-drain': ['drain-active', 'drain-suspended', 'drain-active', 'drain-suspended', 'drain-suspended'],
  ephemeral: ['admit', 'blank-successor', 'admit', 'blank-successor', 'retain-stale'],
  'react-familiar': ['project', 'project', 'project', 'project', 'project'],
  provider: ['provider-wait', 'provider-wait', 'admit', 'provider-teardown-rearm', 'provider-retain'],
});

test('the 50 normative cells match an independently transcribed terminal matrix', () => {
  assert.deepEqual(Object.keys(EXPECTED_TERMINALS_BY_SURFACE), [...CLIENT_AUTHORITY_SURFACES]);
  let cells = 0;
  for (const [surface, expectedTerminals] of Object.entries(EXPECTED_TERMINALS_BY_SURFACE)) {
    assert.equal(expectedTerminals.length, CLIENT_AUTHORITY_STATES.length);
    for (const [index, state] of CLIENT_AUTHORITY_STATES.entries()) {
      const expected = expectedTerminals[index];
      assert.equal(CLIENT_AUTHORITY_TERMINALS.includes(expected), true);
      assert.equal(authorityTransitionCell(surface, state).terminal, expected, `${surface}/${state}`);
      assert.equal(Object.isFrozen(authorityTransitionCell(surface, state).observable), true);
      cells += 1;
    }
  }
  assert.equal(cells, 50);
});

test('the ordered classifier gives the barrier priority over reconnecting and mode-pending', () => {
  const anonymous = { kind: 'anonymous' };
  const session = { kind: 'session' };
  assert.equal(classifyClientAuthorityState({ current: anonymous }), 'anonymous');
  assert.equal(classifyClientAuthorityState({ current: session }), 'authenticated');
  assert.equal(classifyClientAuthorityState({ current: session, modePending: true }), 'reconnecting');
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
        && error.authorityDisposition === 'carrier'
      ),
    );
    assert.equal(attempts, 1);

    attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return modePending({
        reason: 'mode_transition',
        authorityDisposition: 'durableDelete',
      });
    };
    await assert.rejects(
      client.query('classifiedModeTransitionProbe'),
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

test('production authority status projects an in-flight mode-pending retry as reconnecting', async () => {
  const originalFetch = globalThis.fetch;
  let releaseSuccess;
  let secondAttemptEntered;
  const successHeld = new Promise((resolve) => { releaseSuccess = resolve; });
  const secondAttempt = new Promise((resolve) => { secondAttemptEntered = resolve; });
  const client = new SnapbackClient('https://authority-transition-real-reconnect.test', {
    rqsStore: null,
    reservationRetryJitterMilliseconds: [0, 0],
  });
  try {
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      if (attempts === 1) {
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_AUTH_MODE_PENDING',
            message: 'auth-mode activation is settling',
            details: {},
          },
        }, { status: 503 });
      }
      secondAttemptEntered();
      await successHeld;
      return Response.json({ version: 1, rows: [] });
    };
    const states = [];
    const unsubscribe = client.subscribeAuthorityTransition(({ state }) => states.push(state));
    const query = client.query('realModePendingProjection');
    await secondAttempt;
    assert.equal(client.authorityTransitionStatus().state, 'reconnecting');
    assert.equal(states.includes('reconnecting'), true);
    releaseSuccess();
    await query;
    assert.equal(client.authorityTransitionStatus().state, 'anonymous');
    unsubscribe();
  } finally {
    releaseSuccess?.();
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
  assert.equal(settled.timing.enqueuedAtMs < settled.timing.dispatchedAtMs, true);
  assert.equal(settled.timing.authorizedAtMs < settled.timing.executedAtMs, true);
  assert.equal(settled.timing.executedAtMs < settled.timing.committedAtMs, true);
  // No assertion relates dispatchedAtMs to authorizedAtMs: those timestamps
  // come from different machines and do not define a cross-domain order.
});

test('rejected mutations retain server timing on the error and durable failed disposition', async () => {
  const originalFetch = globalThis.fetch;
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  const client = new SnapbackClient('https://mutation-error-timing.test', {
    rqsStore: store,
    __offlineMutationReplayCapability: true,
    __outboxDrainLifecycle: false,
  });
  const serverTiming = Object.freeze({
    authorizedAtMs: 30,
    executedAtMs: 31,
    committedAtMs: 32,
  });
  try {
    globalThis.fetch = async () => Response.json({
      formatVersion: 'snapback.error-response.v1',
      diagnostic: {
        code: 'SNAPBACK_TEST_MUTATION_REJECTED',
        message: 'rejected after staged execution',
        details: {},
      },
      timing: serverTiming,
    }, { status: 400 });
    await assert.rejects(
      client.mutate('rejectWithTiming', {
        args: { value: 1 },
        clientMutationId: 'cm-rejected-with-timing',
      }),
      (error) => {
        assert.deepEqual(error.timing, serverTiming);
        return true;
      },
    );
    const failed = await client.mutationStatus('cm-rejected-with-timing');
    assert.equal(failed.status, 'failed');
    assert.deepEqual(
      {
        authorizedAtMs: failed.timing.authorizedAtMs,
        executedAtMs: failed.timing.executedAtMs,
        committedAtMs: failed.timing.committedAtMs,
      },
      serverTiming,
    );
  } finally {
    await client.closeAuth();
    await store.close();
    globalThis.fetch = originalFetch;
  }
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
