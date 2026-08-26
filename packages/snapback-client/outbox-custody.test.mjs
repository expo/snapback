import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { SnapbackClient as InspectingSnapbackClient, isSnapbackDiagnosticError } from './index.mjs';
import {
  OUTBOX_MAX_RECORD_BYTES,
  emptyOutboxState,
  outboxOps,
  outboxRecordBytes,
} from './outbox-shared.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      __outboxDrainLifecycle: false,
      ...options,
    });
  }
}

const originalFetch = globalThis.fetch;
const fixtures = new Map();

const IDS = Object.freeze({
  stream: '018f0d90-7c01-7a22-8c33-445566778899',
  streamB: '018f0d90-7c02-7a22-8c33-445566778899',
  anonymousInstance: '018f0d90-7c03-7a22-8c33-445566778899',
  userA: '018f0d90-7c04-7a22-8c33-445566778899',
  userB: '018f0d90-7c05-7a22-8c33-445566778899',
  sessionA1: '018f0d90-7c06-7a22-8c33-445566778899',
  sessionA2: '018f0d90-7c07-7a22-8c33-445566778899',
  sessionB: '018f0d90-7c08-7a22-8c33-445566778899',
  instanceA1: '018f0d90-7c09-7a22-8c33-445566778899',
  instanceA2: '018f0d90-7c0a-7a22-8c33-445566778899',
  instanceB: '018f0d90-7c0b-7a22-8c33-445566778899',
});

let fixtureCounter = 0;

const actor = ({
  userId,
  sessionId,
  authorityInstanceId,
  bearer,
  authorizationStreamIncarnation = IDS.stream,
  sessionGeneration = 1,
}) => ({
  userId,
  sessionId,
  authorityInstanceId,
  bearer,
  authorizationStreamIncarnation,
  sessionGeneration,
});

const actorA1 = () => actor({
  userId: IDS.userA,
  sessionId: IDS.sessionA1,
  authorityInstanceId: IDS.instanceA1,
  bearer: 'sbs_outbox_custody_user_a_one',
});

const actorA2 = () => actor({
  userId: IDS.userA,
  sessionId: IDS.sessionA2,
  authorityInstanceId: IDS.instanceA2,
  bearer: 'sbs_outbox_custody_user_a_two',
});

const actorB = () => actor({
  userId: IDS.userB,
  sessionId: IDS.sessionB,
  authorityInstanceId: IDS.instanceB,
  bearer: 'sbs_outbox_custody_user_b',
  authorizationStreamIncarnation: IDS.streamB,
});

const createDurableTestStore = () => {
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

const availability = Object.freeze({
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
});

const descriptor = (current) => ({
  descriptorVersion: 1,
  authorityInstanceId: current?.authorityInstanceId ?? IDS.anonymousInstance,
  sessionGeneration: current?.sessionGeneration ?? 0,
});

const handshake = (fixture, current) => ({
  protocolVersion: 1,
  serverStartupNonce: 'outbox-custody-startup',
  authorizationStreamIncarnation:
    current?.authorizationStreamIncarnation ?? IDS.stream,
  transitionGeneration: current?.sessionGeneration ?? 0,
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
  authority: current === null
    ? { kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false }
    : {
      kind: 'humanSession',
      userId: current.userId,
      sessionId: current.sessionId,
      isAuthenticated: true,
    },
  authorityDescriptor: descriptor(current),
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: fixture.appId,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
});

const credential = (current) => ({
  tokenType: 'Bearer',
  token: current.bearer,
  refreshAfter: Date.now() + 60_000,
  session: {
    id: current.sessionId,
    userId: current.userId,
    provider: 'email-code',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    absoluteExpiresAt: Date.now() + 240_000,
  },
  authorityDescriptor: descriptor(current),
});

const fixtureFetch = async (url, init = {}) => {
  const parsed = new URL(url);
  const fixture = fixtures.get(parsed.host);
  if (!fixture) throw new Error(`no outbox custody fixture for ${parsed.host}`);
  const path = parsed.pathname;
  const headers = new Headers(init.headers);
  const bearer = headers.get('authorization')?.replace(/^Bearer /u, '') ?? null;
  if (path === '/auth/session') {
    await Promise.resolve();
    await fixture.onAuthSessionAttempt?.();
    return Response.json(handshake(fixture, fixture.actorsByBearer.get(bearer) ?? null));
  }
  if (path === '/auth/exchange') {
    fixture.actorsByBearer.set(fixture.loginActor.bearer, fixture.loginActor);
    return Response.json(credential(fixture.loginActor));
  }
  if (path === '/auth/refresh') {
    const refreshed = fixture.refreshActor;
    if (!refreshed) throw new Error('refresh fixture has no successor credential');
    fixture.actorsByBearer.set(refreshed.bearer, refreshed);
    return Response.json(credential(refreshed));
  }
  const body = init.body === undefined ? null : JSON.parse(init.body);
  fixture.mutationAttempts.push(structuredClone(body));
  if (fixture.offlineMutations) {
    // #request starts fetch synchronously inside the authority publication
    // fence. Yield before a fixture-driven custody transition so the test
    // changes authority after that synchronous start cut, never reentrantly.
    await Promise.resolve();
    fixture.beforeOfflineFailure?.();
    await fixture.onOfflineAttempt?.();
    const error = new TypeError('original fixture connectivity failure');
    error.fixtureConnectivity = true;
    throw error;
  }
  const refusal = fixture.refusalFor?.(body) ?? null;
  if (refusal) {
    return Response.json({
      diagnostic: { code: refusal.code, message: refusal.message ?? refusal.code },
    }, { status: refusal.status ?? 409 });
  }
  // Fetch is invoked synchronously inside the final authority commit. Yield
  // once so race fixtures transition only after that publication callback has
  // returned, matching a real response that arrives later on the event loop.
  await Promise.resolve();
  await fixture.beforeMutationSuccess?.();
  fixture.successfulMutationBodies.push(structuredClone(body));
  fixture.version += 1;
  return Response.json({ result: { ok: true }, version: fixture.version });
};

const makeFixture = ({ store = createDurableTestStore(), storage = null } = {}) => {
  fixtureCounter += 1;
  const host = `outbox-custody-${fixtureCounter}.test`;
  const fixture = {
    appId: `snapback.test/${host}`,
    baseUrl: `https://${host}`,
    store,
    storage: storage ?? createMemoryAuthCustodyStorage(),
    actorsByBearer: new Map(),
    loginActor: actorA1(),
    refreshActor: null,
    offlineMutations: false,
    onOfflineAttempt: null,
    onAuthSessionAttempt: null,
    beforeOfflineFailure: null,
    beforeMutationSuccess: null,
    refusalFor: null,
    mutationAttempts: [],
    successfulMutationBodies: [],
    version: 0,
  };
  fixtures.set(host, fixture);
  return fixture;
};

const makeClient = (fixture, { store = fixture.store, storage = fixture.storage } = {}) => {
  const coordinator = new AuthCoordinator({
    appId: fixture.appId,
    storage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(fixture.baseUrl, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: store,
  });
  return { client, coordinator };
};

const signIn = async (fixture, client, current = actorA1()) => {
  fixture.loginActor = current;
  fixture.actorsByBearer.set(current.bearer, current);
  await client.authExchange({ challengeId: 'outbox-custody-challenge', code: '123456' });
  return current;
};

const transitionTo = async (fixture, coordinator, current, reason = 'test_successor') => {
  fixture.actorsByBearer.set(current.bearer, current);
  const capture = coordinator.capture();
  await coordinator.transition(capture, {
    authority: {
      kind: 'session',
      authMode: 'sessions',
      authorizationStreamIncarnation: current.authorizationStreamIncarnation,
      sessionId: current.sessionId,
      userId: current.userId,
    },
    bearer: current.bearer,
    refreshAfterMs: Date.now() + 60_000,
  }, reason);
};

const queueOffline = async (fixture, client, name, options = {}) => {
  fixture.offlineMutations = true;
  const queued = await client.mutate(name, options);
  assert.equal(queued.status, 'queued');
  return queued;
};

test.before(() => { globalThis.fetch = fixtureFetch; });
test.after(() => { globalThis.fetch = originalFetch; });

test('sessions enqueue captures only descriptor, principal scope, and durable custody', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  const current = await signIn(fixture, client);
  const queued = await queueOffline(fixture, client, 'captureIntent', {
    args: { privateValue: 'kept' },
  });
  const [record] = await fixture.store.outboxRecords();
  assert.equal(record.id, queued.clientMutationId);
  assert.deepEqual(record.authorityDescriptor, descriptor(current));
  assert.deepEqual(record.principalScope, {
    authMode: 'sessions',
    authorizationStreamIncarnation: current.authorizationStreamIncarnation,
    userId: current.userId,
  });
  const capture = coordinator.capture();
  assert.deepEqual(record.custody, {
    authorityEpoch: capture.authorityEpoch,
    authorityKey: capture.authorityKey,
  });
  const serialized = JSON.stringify(record);
  assert.doesNotMatch(serialized, new RegExp(current.bearer, 'u'));
  for (const forbidden of [
    'bearer', 'bearerToken', 'credential', 'privateKey', 'senderConstraint',
    'dpop', 'nonce', 'tokenId', 'carrierGeneration', 'custodyRevision',
  ]) assert.equal(Object.hasOwn(record, forbidden), false, forbidden);
});

test('clearing fence refuses post-connectivity enqueue and preserves the original error', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const successor = actorA2();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const unregister = coordinator.registerParticipant({
    name: 'outbox-custody-clearing-hold',
    async quiesce() {},
    blank() {},
    clearMemory() {},
    commitDurable: () => held,
    async resume() {},
  });
  let transition;
  const beginTransitionDuringQueueCapture = async () => {
    if (transition) return;
    fixture.onAuthSessionAttempt = null;
    fixture.actorsByBearer.set(successor.bearer, successor);
    transition = coordinator.transition(coordinator.capture(), {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: successor.authorizationStreamIncarnation,
        sessionId: successor.sessionId,
        userId: successor.userId,
      },
      bearer: successor.bearer,
      refreshAfterMs: Date.now() + 60_000,
    }, 'clearing_enqueue_fixture');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { coordinator.capture(); } catch {
        setTimeout(release, 10);
        return;
      }
      await Promise.resolve();
    }
    throw new Error('fixture did not enter the clearing phase');
  };
  fixture.beforeOfflineFailure = () => {
    fixture.beforeOfflineFailure = null;
    client.clearAuthSession();
    fixture.onAuthSessionAttempt = beginTransitionDuringQueueCapture;
  };
  fixture.offlineMutations = true;
  await assert.rejects(
    client.mutate('refusedWhileClearing', { args: { value: 1 } }),
    (error) => isSnapbackDiagnosticError(error)
      && error.cause instanceof TypeError
      && /original fixture connectivity failure/u.test(error.cause.message),
  );
  assert.deepEqual(await fixture.store.outboxRecords(), []);
  assert.equal(client.outboxDiagnostics.at(-1)?.code, 'SNAPBACK_OFFLINE_MUTATION_QUEUE_REFUSED');
  await transition;
  await unregister();
});

test('capture-validate-commit race preserves successor-owned stranded disposition', async (t) => {
  const fixture = makeFixture();
  const underlying = fixture.store;
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const successor = actorA2();
  let raced = false;
  const injectedStore = Object.create(underlying);
  injectedStore.outboxEnqueue = async (record) => {
    const stored = await underlying.outboxEnqueue(record);
    if (!raced) {
      raced = true;
      await transitionTo(fixture, coordinator, successor, 'enqueue_race_fixture');
    }
    return stored;
  };
  const racingClient = new SnapbackClient(fixture.baseUrl, {
    authCoordinator: coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: injectedStore,
  });
  t.after(() => racingClient.closeAuth());
  fixture.offlineMutations = true;
  await assert.rejects(
    racingClient.mutate('racingIntent'),
    (error) => isSnapbackDiagnosticError(error)
      && error.cause instanceof TypeError
      && /original fixture connectivity failure/u.test(error.cause.message),
  );
  assert.equal(raced, true);
  const [record] = await underlying.outboxRecords();
  assert.equal(record.status, 'stranded');
  assert.equal(record.reason, 'authority_instance_changed');
  assert.equal(record.replayable, false);
});

test('concurrent identical enqueue settling in the pre-enqueue gap survives stale compensation', async (t) => {
  const fixture = makeFixture();
  const underlying = fixture.store;
  const first = makeClient(fixture);
  t.after(() => first.client.closeAuth());
  await signIn(fixture, first.client);
  fixture.offlineMutations = false;
  const mutationInput = {
    clientMutationId: 'cm-settled-enqueue-authority-race',
    args: { value: 'predecessor-settlement' },
  };
  let raced = false;
  const injectedStore = Object.create(underlying);
  injectedStore.outboxEnqueue = async (...args) => {
    if (!raced) {
      raced = true;
      const settled = await first.client.mutate('settledBeforeAuthorityRace', mutationInput);
      assert.equal(settled.status, 'settled');
      assert.equal((await underlying.outboxRecords())[0].status, 'settled');
      const stored = await underlying.outboxEnqueue(...args);
      assert.equal(
        stored.insertionOwned,
        false,
        'atomic enqueue reports that this stale call does not own the insertion',
      );
      await transitionTo(
        fixture,
        first.coordinator,
        actorA2(),
        'settled_enqueue_authority_race',
      );
      return stored;
    }
    return underlying.outboxEnqueue(...args);
  };
  const racingClient = new SnapbackClient(fixture.baseUrl, {
    authCoordinator: first.coordinator,
    authClientProtocol: 1,
    authorityDescriptorProtocol: 1,
    rqsStore: injectedStore,
  });
  t.after(() => racingClient.closeAuth());

  await assert.rejects(
    racingClient.mutate('settledBeforeAuthorityRace', mutationInput),
    (error) => isSnapbackDiagnosticError(error)
      && error.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  assert.equal(raced, true);
  assert.equal(
    (await underlying.outboxRecords())[0].status,
    'settled',
    'successor may retain the settlement, but the stale call cannot project it',
  );
});

test('post-dispatch authority change releases queue custody before reconciliation', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const successor = actorA2();
  let transition = null;
  fixture.beforeMutationSuccess = async () => {
    fixture.beforeMutationSuccess = null;
    fixture.actorsByBearer.set(successor.bearer, successor);
    transition = coordinator.transition(coordinator.capture(), {
      authority: {
        kind: 'session',
        authMode: 'sessions',
        authorizationStreamIncarnation: successor.authorizationStreamIncarnation,
        sessionId: successor.sessionId,
        userId: successor.userId,
      },
      bearer: successor.bearer,
      refreshAfterMs: Date.now() + 60_000,
    }, 'post_dispatch_authority_race');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { coordinator.capture(); } catch { return; }
      await Promise.resolve();
    }
    throw new Error('post-dispatch fixture did not enter authority clearing');
  };

  await assert.rejects(
    client.mutate('postDispatchAuthorityRace', {
      clientMutationId: 'cm-post-dispatch-authority-race',
      args: { value: 1 },
    }),
    (error) => isSnapbackDiagnosticError(error)
      && error.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
  );
  await transition;
  const [record] = await fixture.store.outboxRecords();
  assert.equal(record.status, 'stranded');
  assert.equal(record.reason, 'authority_instance_changed');
});

test('authority resume fails closed when queue custody reconciliation is refused', async (t) => {
  const underlying = createDurableTestStore();
  let refuseReconciliation = false;
  let refusedCalls = 0;
  const injectedStore = Object.create(underlying);
  injectedStore.outboxReconcileCustody = async (...args) => {
    if (refuseReconciliation) {
      refusedCalls += 1;
      return false;
    }
    return underlying.outboxReconcileCustody(...args);
  };
  const fixture = makeFixture({ store: injectedStore });
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);

  refuseReconciliation = true;
  const successor = actorA2();
  await assert.rejects(
    transitionTo(fixture, coordinator, successor, 'refused_resume_reconciliation'),
    (error) => error.code === 'SNAPBACK_AUTH_TRANSITION_FAILED',
  );

  assert.equal(refusedCalls, 1);
  assert.throws(() => coordinator.capture(), (error) => (
    error.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE'
    || error.code === 'SNAPBACK_CLIENT_AUTHORITY_CLEARING'
  ));
});

test('cold-process replay uses the stored descriptor and applies one delivery', async (t) => {
  const fixture = makeFixture();
  const first = makeClient(fixture);
  await signIn(fixture, first.client);
  const queued = await queueOffline(fixture, first.client, 'coldReplay', {
    args: { durableBeforeSend: true },
  });
  assert.equal((await fixture.store.outboxPending())[0].id, queued.clientMutationId);
  const offlineReplay = await first.client.replayQueuedMutations();
  assert.equal(offlineReplay.stopped, true);
  assert.equal((await fixture.store.outboxPending()).length, 1);
  await first.client.closeAuth();

  fixture.offlineMutations = false;
  fixture.mutationAttempts.length = 0;
  const second = makeClient(fixture);
  t.after(() => second.client.closeAuth());
  await second.client.authSession();
  const outcome = await second.client.replayQueuedMutations();
  assert.equal(outcome.replayed, 1, JSON.stringify({
    outcome,
    records: await fixture.store.outboxRecords(),
    diagnostics: second.client.outboxDiagnostics,
    attempts: fixture.mutationAttempts,
  }));
  assert.equal(fixture.successfulMutationBodies.length, 1);
  assert.equal(
    fixture.successfulMutationBodies[0].clientMutationId,
    queued.clientMutationId,
  );
  assert.deepEqual(
    fixture.successfulMutationBodies[0].authorityDescriptor,
    descriptor(actorA1()),
  );
  await second.client.replayQueuedMutations();
  assert.equal(fixture.successfulMutationBodies.length, 1, 'settled identity is not redelivered');
});

test('same principal on a new authority instance strands pending and failed records', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const pending = await queueOffline(fixture, client, 'pendingBeforeReplacement');
  const failed = await queueOffline(fixture, client, 'failedBeforeReplacement');
  await fixture.store.outboxMarkFailed(failed.clientMutationId, {
    code: 'SNAPBACK_FIXTURE_CONTENT', message: 'terminal fixture content refusal',
  });
  fixture.mutationAttempts.length = 0;
  await transitionTo(fixture, coordinator, actorA2());
  const records = await fixture.store.outboxRecords();
  assert.deepEqual(records.map((record) => record.status), ['stranded', 'stranded']);
  assert.deepEqual(records.map((record) => record.id), [
    pending.clientMutationId,
    failed.clientMutationId,
  ]);
  for (const record of records) {
    assert.equal(record.reason, 'authority_instance_changed');
    assert.equal(record.replayable, false);
    assert.equal(record.rerecordable, true);
  }
  assert.equal((await client.outboxStatus()).stranded, 2);
  const pendingDisposition = await client.mutationStatus(pending.clientMutationId);
  assert.equal(pendingDisposition.status, 'stranded');
  assert.equal(pendingDisposition.targetMatchesCurrent, false);
  assert.equal(
    pendingDisposition.enqueueTarget.artifactIdentity.appId,
    'snapback.internal-configured-replay-capability',
  );
  assert.equal(Object.isFrozen(pendingDisposition), true);
  fixture.offlineMutations = false;
  const replay = await client.replayQueuedMutations();
  assert.equal(replay.replayed, 0);
  assert.equal(fixture.mutationAttempts.length, 0);
});

test('principal switch deletes every predecessor disposition before successor observation', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const first = await queueOffline(fixture, client, 'privatePending', {
    args: { secret: 'PREDECESSOR_PENDING' },
  });
  const second = await queueOffline(fixture, client, 'privateFailed', {
    args: { secret: 'PREDECESSOR_FAILED' },
  });
  const third = await queueOffline(fixture, client, 'privateSettled', {
    args: { secret: 'PREDECESSOR_SETTLED' },
    settlementClaims: { private: 'PREDECESSOR_SETTLEMENT_CLAIM' },
  });
  await fixture.store.outboxMarkFailed(second.clientMutationId, {
    code: 'SNAPBACK_FIXTURE', message: 'fixture',
  });
  await fixture.store.outboxDurablyConsume(third.clientMutationId, {
    result: { secret: 'PREDECESSOR_SETTLEMENT_RESULT' },
    authorityDescriptor: descriptor(actorA1()),
  }, IDS.userA);
  await fixture.store.outboxMarkAcknowledgementsReady([third.clientMutationId]);
  assert.equal((await fixture.store.outboxRecords()).length, 3);
  assert.deepEqual(
    await fixture.store.outboxPendingAcknowledgements(
      IDS.userA,
      64,
      descriptor(actorA1()),
    ),
    [third.clientMutationId],
  );
  await transitionTo(fixture, coordinator, actorB(), 'principal_switch_fixture');
  assert.deepEqual(await fixture.store.outboxRecords(), []);
  assert.deepEqual(
    await fixture.store.outboxPendingAcknowledgements(
      IDS.userA,
      64,
      descriptor(actorA1()),
    ),
    [],
  );
  const diagnostic = client.outboxDiagnostics.find((entry) => (
    entry.code === 'SNAPBACK_OFFLINE_MUTATIONS_DELETED_AUTHORITY_CHANGE'
  ));
  assert.equal(diagnostic?.deleted, 3);
  assert.deepEqual(await client.strandedMutations(), []);
  assert.deepEqual(await client.outboxStatus(), {
    supported: true,
    pending: 0,
    failed: 0,
    stranded: 0,
    quarantined: 0,
    resultGone: 0,
    replaying: false,
    drainMode: 'none',
    oldestPendingAtMs: null,
    drainPhase: 'idle',
    lastAttemptAtMs: null,
    nextRetryAtMs: null,
    blockedReason: null,
  });
  assert.notEqual(first.clientMutationId, second.clientMutationId);
});

test('server authority-stale strands and continues to an ordinary failed refusal', async (t) => {
  const fixture = makeFixture();
  const { client } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const stale = await queueOffline(fixture, client, 'staleAtServer', {
    args: { outcome: 'stale' },
  });
  const content = await queueOffline(fixture, client, 'contentRefusal', {
    args: { outcome: 'content' },
  });
  fixture.offlineMutations = false;
  fixture.refusalFor = (body) => body.args.outcome === 'stale'
    ? { code: 'SNAPBACK_AUTH_STALE_RESULT' }
    : { code: 'SNAPBACK_VALIDATION', status: 400 };
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { stranded: replay.stranded, failed: replay.failed, remaining: replay.remaining },
    { stranded: 1, failed: 1, remaining: 0 },
  );
  const byId = new Map((await fixture.store.outboxRecords()).map((record) => [record.id, record]));
  assert.equal(byId.get(stale.clientMutationId).status, 'stranded');
  assert.equal(byId.get(stale.clientMutationId).reason, 'server_authority_stale_result');
  assert.equal(byId.get(content.clientMutationId).status, 'failed');
  assert.equal(fixture.mutationAttempts.length >= 2, true);
});

test('session-generation advance and bearer refresh preserve same-instance pending work', async (t) => {
  const fixture = makeFixture();
  const { client } = makeClient(fixture);
  t.after(() => client.closeAuth());
  const current = await signIn(fixture, client);
  const queued = await queueOffline(fixture, client, 'survivesRefresh');

  const advanced = { ...current, sessionGeneration: 2 };
  fixture.actorsByBearer.set(current.bearer, advanced);
  client.clearAuthSession();
  assert.equal((await client.outboxStatus()).pending, 1);

  const refreshed = { ...advanced, bearer: 'sbs_outbox_custody_user_a_refreshed' };
  fixture.refreshActor = refreshed;
  fixture.offlineMutations = false;
  await client.authRefresh();
  const status = await client.outboxStatus();
  assert.equal(status.pending, 1);
  assert.equal(status.stranded, 0);
  assert.equal((await fixture.store.outboxPending())[0].id, queued.clientMutationId);
});

test('stranded recovery reads, discards, and rerecords as a new current intent', async (t) => {
  const fixture = makeFixture();
  const { client, coordinator } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const queued = await queueOffline(fixture, client, 'recoverIntent', {
    args: { value: 'recover-me' },
    settlementIdentity: { old: 'descriptor-bound-settlement' },
  });
  await transitionTo(fixture, coordinator, actorA2());
  const visible = await client.strandedMutations();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].clientMutationId, queued.clientMutationId);
  assert.deepEqual(visible[0].args, { value: 'recover-me' });

  const discarded = await client.discardStrandedMutations([queued.clientMutationId]);
  assert.equal(discarded.discarded, 1);
  assert.deepEqual(await client.strandedMutations(), []);

  const second = await queueOffline(fixture, client, 'recoverIntent', {
    args: { value: 'recover-again' },
    settlementIdentity: { old: 'must-not-cross-authority' },
  });
  const generatedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: fixture.appId,
    schemaHash: 'schema-generation-bound-stranded',
    bundleHash: 'bundle-generation-bound-stranded',
    inputsHash: 'inputs-generation-bound-stranded',
  };
  const generated = await queueOffline(fixture, client, {
    artifactKind: 'functionReference',
    kind: 'Mutation',
    name: 'recoverGeneratedIntent',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    expectedGeneration: generatedGeneration,
  }, {
    args: { value: 'recover-generated' },
  });
  await transitionTo(fixture, coordinator, {
    ...actorA2(),
    sessionId: IDS.sessionA1,
    authorityInstanceId: IDS.instanceA1,
    bearer: 'sbs_outbox_custody_user_a_three',
  });
  fixture.offlineMutations = false;
  fixture.successfulMutationBodies.length = 0;
  fixture.refusalFor = () => ({
    code: 'SNAPBACK_FIXTURE_RERECORD_REFUSED',
    message: 'replacement intent refused by fixture',
  });
  await assert.rejects(
    client.reRecordStrandedMutation(second.clientMutationId),
    (error) => error?.diagnostic?.code === 'SNAPBACK_FIXTURE_RERECORD_REFUSED',
  );
  assert.deepEqual(
    (await client.strandedMutations()).map((record) => record.clientMutationId),
    [second.clientMutationId, generated.clientMutationId],
    'a failed replacement leaves the stranded source bytes recoverable',
  );
  fixture.refusalFor = null;
  const discardStranded = fixture.store.outboxDiscardStranded;
  fixture.store.outboxDiscardStranded = async () => false;
  const rerecordedId = await client.reRecordStrandedMutation(second.clientMutationId);
  assert.notEqual(rerecordedId, second.clientMutationId);
  assert.equal(fixture.successfulMutationBodies.at(-1).clientMutationId, rerecordedId);
  assert.deepEqual(
    (await client.strandedMutations()).map((record) => record.clientMutationId),
    [second.clientMutationId, generated.clientMutationId],
    'a refused predecessor cleanup remains visible after the replacement succeeds',
  );
  assert.equal(
    client.outboxDiagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_OFFLINE_STRANDED_MUTATION_RERECORD_DISCARD_FAILED'
      && diagnostic.predecessorClientMutationId === second.clientMutationId
      && diagnostic.clientMutationId === rerecordedId
    )),
    true,
  );
  fixture.store.outboxDiscardStranded = discardStranded;
  const generatedRerecordedId = await client.reRecordStrandedMutation(
    generated.clientMutationId,
  );
  assert.notEqual(generatedRerecordedId, generated.clientMutationId);
  assert.deepEqual(
    fixture.successfulMutationBodies.at(-1).expectedGeneration,
    generatedGeneration,
    'production stranded re-record reconstructs a nominal Mutation reference',
  );
  assert.equal(
    (await client.discardStrandedMutations([second.clientMutationId])).discarded,
    1,
  );
  assert.deepEqual(await client.strandedMutations(), []);
  assert.equal((await fixture.store.outboxRecords()).some((record) => (
    record.settlementIdentity?.old === 'must-not-cross-authority'
  )), false);
});

test('anonymous settled sessions custody queues and replays without actor assumptions', async (t) => {
  const fixture = makeFixture();
  const { client } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await client.authSession();
  const queued = await queueOffline(fixture, client, 'anonymousPublicIntent', {
    args: { public: true },
  });
  const record = (await fixture.store.outboxRecords())[0];
  assert.equal(record.id, queued.clientMutationId);
  assert.deepEqual(record.principalScope, {
    authMode: 'sessions',
    authorizationStreamIncarnation: IDS.stream,
    userId: null,
  });
  fixture.offlineMutations = false;
  const replay = await client.replayQueuedMutations();
  assert.equal(replay.replayed, 1);
  assert.deepEqual(fixture.successfulMutationBodies[0].authorityDescriptor, descriptor(null));
});

test('queued values beyond 16 KiB round-trip a post-boundary lone surrogate exactly', async (t) => {
  const fixture = makeFixture();
  const { client } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  const value = `${'x'.repeat(17_000)}\ud800${'y'.repeat(257)}`;
  await queueOffline(fixture, client, 'largeUnicodeIntent', { args: { value } });
  assert.equal((await fixture.store.outboxPending())[0].args.value, value);
  fixture.offlineMutations = false;
  const replay = await client.replayQueuedMutations();
  assert.equal(replay.replayed, 1);
  assert.equal(fixture.successfulMutationBodies[0].args.value, value);
  assert.equal(fixture.successfulMutationBodies[0].args.value.length, value.length);
});

test('null and absent optional fields share one durable replay identity', async () => {
  const store = createDurableTestStore();
  const first = await store.outboxEnqueue({
    id: 'cm-null-absent',
    function: 'canonicalOptionalIntent',
    args: { value: 1 },
  });
  const second = await store.outboxEnqueue({
    id: 'cm-null-absent',
    function: 'canonicalOptionalIntent',
    args: { value: 1 },
    userId: null,
    correlation: null,
    ctxLedger: null,
    expectedGeneration: null,
    settlementIdentity: null,
    settlementClaims: null,
    boundedSkew: null,
    operationIssuance: null,
    operationCoverageDisposition: null,
    optimisticOperation: null,
    capturedNow: null,
    principalScope: null,
    custody: null,
  });
  assert.equal(first.insertionOwned, true);
  assert.equal(second.insertionOwned, false);
  const { insertionOwned: _firstOwnership, ...firstRecord } = first;
  const { insertionOwned: _secondOwnership, ...secondRecord } = second;
  assert.deepEqual(secondRecord, firstRecord);
  assert.equal((await store.outboxRecords()).length, 1);
});

test('stranded records are terminal and do not hold the LLP 0090 D3 gate', async () => {
  const store = createDurableTestStore();
  const scope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: IDS.stream,
    userId: IDS.userA,
  };
  await store.outboxEnqueue({
    id: 'cm-d3-stranded',
    function: 'terminalStrandedIntent',
    authorityDescriptor: descriptor(actorA1()),
    principalScope: scope,
    custody: { authorityEpoch: 1, authorityKey: 'authority-a' },
  });
  await store.outboxMarkStranded(
    'cm-d3-stranded',
    'authority_instance_changed',
    scope,
  );
  assert.deepEqual(await store.outboxPending(), []);
  assert.equal(await store.outboxEmpty(), true);
  assert.equal((await store.outboxRecords())[0].status, 'stranded');
});

test('stranding a valid near-limit record cannot wedge an authority transition', () => {
  const scope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: IDS.stream,
    userId: IDS.userA,
  };
  const inputFor = (length) => ({
    id: 'cm-near-limit-stranded',
    function: 'nearLimitIntent',
    args: { value: 'x'.repeat(length) },
    authorityDescriptor: descriptor(actorA1()),
    principalScope: scope,
    custody: { authorityEpoch: 1, authorityKey: 'authority-a' },
  });
  let low = 0;
  let high = OUTBOX_MAX_RECORD_BYTES;
  let accepted = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    try {
      accepted = outboxOps.enqueue(emptyOutboxState(), inputFor(middle), 1);
      low = middle + 1;
    } catch (error) {
      assert.equal(error.code, 'SNAPBACK_OUTBOX_RECORD_OVERSIZE');
      high = middle - 1;
    }
  }
  assert(accepted?.result);
  assert(outboxRecordBytes(accepted.result) <= OUTBOX_MAX_RECORD_BYTES);
  const stranded = outboxOps.markStranded(
    accepted.state,
    accepted.result.id,
    'authority_instance_changed',
    2,
    scope,
  );
  assert.equal(stranded.result.status, 'stranded');
  assert(outboxRecordBytes(stranded.result) > OUTBOX_MAX_RECORD_BYTES);
});

test('unattributable queue records are privacy-deleted at fenced reconciliation', async (t) => {
  const fixture = makeFixture();
  const { client } = makeClient(fixture);
  t.after(() => client.closeAuth());
  await signIn(fixture, client);
  // Dev-era / foreign-writer bytes: no captured descriptor, principal scope,
  // or custody proof. A fenced observer can neither attribute them to the
  // current principal nor transmit them under a captured authority, so the
  // reconciliation deletes them with the diagnostic count (LLP 0043 dated
  // implementation note, 2026-08-06).
  await fixture.store.outboxEnqueue({ id: 'legacy-dev-pending', function: 'writeLegacy' });
  await client.strandedMutations();
  const status = await client.outboxStatus();
  assert.equal(status.pending, 0);
  assert.equal(status.stranded, 0);
  assert.deepEqual(await fixture.store.outboxRecords(), []);
  const diagnostic = client.outboxDiagnostics.find((entry) => (
    entry.code === 'SNAPBACK_OFFLINE_MUTATIONS_DELETED_AUTHORITY_CHANGE'
  ));
  assert.equal(diagnostic?.deleted, 1);
});
