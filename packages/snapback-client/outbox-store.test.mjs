// LLP 0043 M2 outbox on the JS arm (LLP 0129 Phase 0) — unit obligations.
//
// Covers the three store arms' shared outbox contract (memory / file /
// IndexedDB), default-store resolution, and the client mutate/replay queue
// behavior over a stubbed fetch. The end-to-end diary-grade proof lives in
// demos/public-dashboard/tests/acceptance/offline-local-first.mjs.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { SnapbackClient, isSnapbackDiagnosticError } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';
import { createFileRqsResumeStore, RQS_FILE_STORE_FORMAT_V1 } from './rqs-store-file.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import { resolveDefaultRqsStore } from './rqs-store-default.mjs';
import {
  OUTBOX_MAX_PENDING_ACKS,
  emptyOutboxState,
  isConnectivityFailureError,
  outboxNotWriterError,
  outboxOps,
} from './outbox-shared.mjs';

const originalFetch = globalThis.fetch;
const TEST_AUTHORITY_DESCRIPTOR = Object.freeze({
  descriptorVersion: 1,
  authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
  sessionGeneration: 1,
});
const TEST_SESSION_USER_ID = '018f0d90-7b25-7a22-8c33-445566778899';
const TEST_ARTIFACT_GENERATION = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'outbox-adoption-test',
  schemaHash: `sha256:${'a'.repeat(64)}`,
  bundleHash: `sha256:${'b'.repeat(64)}`,
  inputsHash: `sha256:${'c'.repeat(64)}`,
});
const TEST_CREATE_THING_ARGUMENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' } },
  required: ['title'],
});
const TEST_FRESH_SNAPSHOT_BARRIER = Object.freeze({
  schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1',
  status: 'passed',
  kind: 'full-snapshot',
});

const adoptionInspection = (generation = TEST_ARTIFACT_GENERATION) => ({
  schema: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    schemaHash: generation.schemaHash,
    inputsHash: generation.inputsHash,
  },
  functions: {
    schemaVersion: generation.schemaVersion,
    appId: generation.appId,
    bundleHash: generation.bundleHash,
    inputsHash: generation.inputsHash,
  },
});

const sessionHandshake = (authorityDescriptor, userId = TEST_SESSION_USER_ID) => ({
  protocolVersion: 1,
  serverStartupNonce: 'outbox-recovery-test',
  authorizationStreamIncarnation: '018f0d90-7b26-7a22-8c33-445566778899',
  transitionGeneration: 1,
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
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    },
    queuedReplay: {
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId,
    sessionId: '018f0d90-7b27-7a22-8c33-445566778899',
    isAuthenticated: true,
  },
  authorityDescriptor,
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: 'outbox-recovery-test',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'a'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'b'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'c'.repeat(64)}`,
  },
  authorizedLease: null,
});

// Immediate-grant Web Locks double (single context; enough for the outbox
// contract — ownership contention is rqs-store.test.mjs territory).
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

const createDurableTestStore = (options = undefined) => {
  const store = createMemoryRqsResumeStore(options);
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

async function exerciseOutboxContract(store, { label }) {
  assert.equal(await store.outboxEmpty(), true, `${label}: starts empty`);
  assert.equal(
    typeof store.outboxPrepareSubmission,
    'function',
    `${label}: carries the settle-time submission fence`,
  );
  const first = await store.outboxEnqueue({
    id: 'cm-1',
    function: 'createThing',
    args: { title: 'a' },
    userId: 'user_a',
    capturedNow: 1234,
  });
  const second = await store.outboxEnqueue({
    id: 'cm-2',
    function: 'updateThing',
    args: { title: 'b' },
    userId: 'user_a',
  });
  assert.equal(first.sequence, 1, `${label}: first sequence`);
  assert.equal(second.sequence, 2, `${label}: monotonic sequence`);
  assert.equal(first.status, 'pending');
  assert.equal(first.capturedNow, 1234, `${label}: captured clock retained as labeled claim`);
  // Idempotent re-enqueue of the same durable identity.
  const re = await store.outboxEnqueue({
    id: 'cm-1',
    function: 'createThing',
    args: { title: 'a' },
    userId: 'user_a',
    capturedNow: 1234,
  });
  assert.equal(re.sequence, 1, `${label}: re-enqueue returns the existing record`);
  await assert.rejects(
    () => store.outboxEnqueue({
      id: 'cm-1',
      function: 'createThing',
      args: { title: 'different' },
      userId: 'user_a',
      capturedNow: 1234,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
  );
  assert.equal(await store.outboxEmpty(), false, `${label}: pending -> non-empty`);
  assert.deepEqual(
    (await store.outboxPending()).map((r) => r.id),
    ['cm-1', 'cm-2'],
    `${label}: pending in sequence order`,
  );
  // Drop-and-mark-failed stays visible, leaves the pending lane.
  assert.equal(await store.outboxMarkFailed('cm-1', { code: 'X', message: 'refused' }), true);
  assert.deepEqual((await store.outboxPending()).map((r) => r.id), ['cm-2']);
  const failed = (await store.outboxRecords()).find((r) => r.id === 'cm-1');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'X');
  // Durable consumption retains the complete settlement and creates its ACK
  // obligation atomically. It leaves the replay lane but remains recoverable
  // until the server confirms ledger GC.
  const settlement = { result: { ok: true }, version: 7 };
  const consumed = await store.outboxDurablyConsume('cm-2', settlement, 'user_a');
  assert.equal(consumed.status, 'settled');
  assert.deepEqual(consumed.settlement, settlement);
  // A failed record is terminal (never replayed), so it does not block the
  // LLP 0090 resume rule — but it stays visible in outboxRecords().
  assert.equal(await store.outboxEmpty(), true, `${label}: only failed records left -> empty for resume`);
  assert.deepEqual((await store.outboxPending()), []);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), []);
  await store.outboxMarkAcknowledgementsReady(['cm-2']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), ['cm-2']);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements('user_b', 64),
    [],
    `${label}: another identity never sends this one's ACKs`,
  );
  await store.outboxConfirmAcknowledgements(['cm-2']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), []);
  assert.equal(
    (await store.outboxRecords()).some((record) => record.id === 'cm-2'),
    false,
    `${label}: confirmation retires the retained settlement`,
  );
  // Outcome-known/payload-gone is a durable fourth state, not pending,
  // failed, or settled. It never re-enters transport and remains an ordered
  // submission fence until explicitly discarded.
  await store.outboxEnqueue({ id: 'cm-result-gone', function: 'createThing' });
  const resultGone = await store.outboxMarkResultGone('cm-result-gone', {
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  assert.equal(resultGone.status, 'result-gone');
  assert.deepEqual(resultGone.resultGone, {
    disposition: 'result-expired',
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  assert.deepEqual(
    await store.outboxMarkResultGone('cm-result-gone', {
      outcome: 'committed',
      receiptDigest: `sha256:${'e'.repeat(64)}`,
    }),
    resultGone,
    `${label}: exact result-gone retry is idempotent`,
  );
  for (const divergent of [
    { outcome: 'refused', receiptDigest: `sha256:${'e'.repeat(64)}` },
    { outcome: 'committed', receiptDigest: `sha256:${'f'.repeat(64)}` },
  ]) {
    await assert.rejects(
      () => store.outboxMarkResultGone('cm-result-gone', divergent),
      (error) => error.code === 'SNAPBACK_OUTBOX_RESULT_GONE_MISMATCH',
      `${label}: divergent result-gone custody refuses`,
    );
  }
  await store.outboxEnqueue({ id: 'cm-after-result-gone', function: 'updateThing' });
  assert.deepEqual(
    (await store.outboxPending()).map((record) => record.id),
    ['cm-after-result-gone'],
    `${label}: result-gone is not replayable pending work`,
  );
  assert.equal(await store.outboxEmpty(), false, `${label}: result-gone keeps resume fenced`);
  assert.deepEqual(
    await store.outboxPrepareSubmission('cm-after-result-gone'),
    { status: 'blocked', record: null },
    `${label}: missing result blocks ordered successors`,
  );
  await store.outboxDiscard('cm-result-gone');
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-result-gone')).status,
    'ready',
    `${label}: explicit discard releases the ordered successor`,
  );
  await store.outboxDiscard('cm-after-result-gone');
  // Explicit discard of the failed record; wipe clears everything.
  assert.equal(await store.outboxDiscard('cm-1'), true);
  await store.outboxEnqueue({
    id: 'cm-quarantine',
    function: 'createThing',
    args: { privateValue: 'must-not-project' },
  });
  const quarantine = await store.outboxMarkQuarantined('cm-quarantine', {
    code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
  });
  assert.equal(quarantine.count, 1, `${label}: quarantine transition commits`);
  assert.equal((await store.outboxRecords())[0].status, 'quarantined');
  assert.equal(Object.hasOwn((await store.outboxRecords())[0], 'args'), false);
  assert.equal(await store.outboxEmpty(), false, `${label}: quarantine keeps resume fenced`);
  const reentry = await store.outboxReenterQuarantined();
  assert.deepEqual(reentry.clientMutationIds, ['cm-quarantine']);
  assert.deepEqual((await store.outboxPending())[0].args, { privateValue: 'must-not-project' });
  await store.outboxDiscard('cm-quarantine');
  await store.outboxEnqueue({ id: 'cm-3', function: 'createThing' });
  await store.wipe();
  assert.deepEqual(await store.outboxPending(), [], `${label}: wipe clears the queue`);

  const predecessorScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-a',
    userId: 'user-a',
  };
  const predecessorDescriptor = {
    descriptorVersion: 1,
    authorityInstanceId: 'authority-a',
    sessionGeneration: 1,
  };
  const fenced = (id) => ({
    id,
    function: 'createThing',
    args: { privateValue: id },
    authorityDescriptor: predecessorDescriptor,
    principalScope: predecessorScope,
    custody: { authorityEpoch: 1, authorityKey: 'authority-key-a' },
  });
  await store.outboxEnqueue(fenced('cm-strand-pending'));
  await store.outboxEnqueue(fenced('cm-strand-failed'));
  await store.outboxEnqueue(fenced('cm-custody-settled'));
  await store.outboxMarkFailed('cm-strand-failed', { code: 'X', message: 'failed first' });
  await store.outboxDurablyConsume('cm-custody-settled', {
    result: { privateValue: 'settled-predecessor-result' },
    authorityDescriptor: predecessorDescriptor,
  }, predecessorScope.userId);
  await store.outboxMarkAcknowledgementsReady(['cm-custody-settled']);
  const stranded = await store.outboxReconcileCustody(predecessorScope, {
    ...predecessorDescriptor,
    authorityInstanceId: 'authority-b',
    sessionGeneration: 2,
  }, { authorityEpoch: 2, authorityKey: 'authority-key-b' });
  assert.equal(stranded.stranded, 2, `${label}: pending and failed strand atomically`);
  assert.deepEqual(await store.outboxPending(), [], `${label}: stranded is never replay pending`);
  assert.equal(await store.outboxEmpty(), true, `${label}: stranded does not hold D3 resume`);
  const strandedRecords = await store.outboxRecords();
  assert.deepEqual(
    strandedRecords.map((record) => record.status),
    ['stranded', 'stranded', 'settled'],
    `${label}: same-principal instance changes retain settled cohorts`,
  );
  assert.equal(
    strandedRecords.filter((record) => record.status === 'stranded')
      .every((record) => record.rerecordable === true),
    true,
  );
  assert.deepEqual(strandedRecords[0].predecessorPrincipalScope, predecessorScope);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      predecessorScope.userId,
      64,
      predecessorDescriptor,
    ),
    ['cm-custody-settled'],
    `${label}: same-principal instance changes retain settlement acknowledgements`,
  );
  const discarded = await store.outboxDiscardStranded(
    ['cm-strand-pending'],
    predecessorScope,
  );
  assert.deepEqual(discarded.clientMutationIds, ['cm-strand-pending']);
  const deleted = await store.outboxReconcileCustody(
    { ...predecessorScope, userId: 'user-b' },
    { ...predecessorDescriptor, authorityInstanceId: 'authority-c' },
    { authorityEpoch: 3, authorityKey: 'authority-key-c' },
  );
  assert.equal(
    deleted.deleted,
    2,
    `${label}: principal change counts stranded and settled predecessor payloads`,
  );
  assert.deepEqual(await store.outboxRecords(), []);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(
      predecessorScope.userId,
      64,
      predecessorDescriptor,
    ),
    [],
    `${label}: principal change deletes predecessor acknowledgement rows`,
  );

  const agentScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: 'stream-agent',
    userId: 'effective-agent-user',
  };
  await store.outboxEnqueue({
    id: 'cm-agent-grant-change',
    function: 'agentIntent',
    authorityDescriptor: {
      descriptorVersion: 1,
      authorityInstanceId: 'agent-authority-a',
      sessionGeneration: 0,
    },
    principalScope: agentScope,
    custody: { authorityEpoch: 1, authorityKey: 'grant-tuple-a' },
  });
  const agentDeleted = await store.outboxReconcileCustody(
    agentScope,
    {
      descriptorVersion: 1,
      authorityInstanceId: 'agent-authority-b',
      sessionGeneration: 0,
    },
    { authorityEpoch: 2, authorityKey: 'grant-tuple-b' },
  );
  assert.equal(agentDeleted.deleted, 1, `${label}: agent grant-tuple change is principal deletion`);
  assert.equal(agentDeleted.stranded, 0, `${label}: agent grant-tuple change never strands`);
  assert.deepEqual(await store.outboxRecords(), []);
}

test('memory arm carries the outbox contract', async () => {
  const store = createMemoryRqsResumeStore();
  await exerciseOutboxContract(store, { label: 'memory' });
  assert.deepEqual(store.durability(), { implementation: 'memory', durable: false });
  await store.close();
});

const OPERATION_RANGE = Object.freeze({
  schemaVersion: 1,
  audience: 'authority-a',
  authorityInstanceId: 'authority-a',
  epochId: 'epoch-a',
  epochSequence: 0,
  rangeStart: 10,
  rangeEndExclusive: 12,
  issuedAtMs: 1,
  expiresAtMs: 10_000,
  authorityAuthenticatorDigest: `sha256:${'a'.repeat(64)}`,
});

test('operation range, next counter, and intent move in one outbox transition', () => {
  const first = outboxOps.enqueueWithOperationIdentity(
    emptyOutboxState(),
    { id: 'cm-operation-1', function: 'createThing' },
    2,
    'dev:user-a',
    OPERATION_RANGE,
  );
  assert.equal(first.result.operationIssuance.counter, 10);
  assert.equal(first.result.operationCoverageDisposition, 'covered');
  assert.equal(first.state.operationIdentityRanges['dev:user-a'].nextCounter, 11);

  // A JSON crash/reopen cut cannot preserve the intent without the advanced
  // counter: both live in the same persisted outbox section.
  const reopened = JSON.parse(JSON.stringify(first.state));
  const second = outboxOps.enqueueWithOperationIdentity(
    reopened,
    { id: 'cm-operation-2', function: 'createThing' },
    3,
    'dev:user-a',
  );
  assert.equal(second.result.operationIssuance.counter, 11);
  assert.equal(second.state.operationIdentityRanges['dev:user-a'].nextCounter, 12);

  const exhausted = outboxOps.enqueueWithOperationIdentity(
    second.state,
    { id: 'cm-operation-3', function: 'createThing' },
    4,
    'dev:user-a',
  );
  assert.equal(exhausted.result.operationIssuance, null);
  assert.equal(
    exhausted.result.operationCoverageDisposition,
    'uncovered-range-exhausted',
  );
});

test('ACK pressure refuses settlement publication without losing pending intent', () => {
  const pending = outboxOps.enqueue(
    emptyOutboxState(),
    { id: 'cm-pressure', function: 'createThing' },
    1,
  ).state;
  const full = {
    ...pending,
    acks: Array.from({ length: OUTBOX_MAX_PENDING_ACKS }, (_, index) => ({
      id: `cm-old-${index}`,
      userId: null,
    })),
  };
  assert.throws(
    () => outboxOps.durablyConsume(full, 'cm-pressure', { result: { ok: true } }, null, 2),
    (error) => error.code === 'SNAPBACK_OUTBOX_ACK_FULL',
  );
  assert.equal(full.records['cm-pressure'].status, 'pending');
  assert.equal(full.acks[0].id, 'cm-old-0', 'old recovery obligations are never evicted');

  const advanced = outboxOps.durablyConsume(
    full,
    'cm-pressure',
    { result: { ok: true } },
    null,
    2,
    ['cm-old-0'],
  ).state;
  assert.equal(advanced.records['cm-pressure'].status, 'settled');
  assert.equal(advanced.acks.length, OUTBOX_MAX_PENDING_ACKS);
  assert.equal(advanced.acks.some((ack) => ack.id === 'cm-old-0'), false);
  assert.equal(advanced.acks.some((ack) => ack.id === 'cm-pressure'), true);
});

test('ACK custody is scoped by authority instance as well as user', async () => {
  const first = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const second = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b25-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const store = createMemoryRqsResumeStore();
  await store.outboxEnqueue({
    id: 'cm-authority',
    function: 'createThing',
    userId: 'user_a',
    authorityDescriptor: first,
  });
  await store.outboxDurablyConsume('cm-authority', { result: { ok: true } }, 'user_a');
  await store.outboxMarkAcknowledgementsReady(['cm-authority']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64, first), ['cm-authority']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64, second), []);
  assert.equal(await store.outboxConfirmAcknowledgements(['cm-authority'], 'user_a', second), 0);
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  assert.equal(await store.outboxConfirmAcknowledgements(['cm-authority'], 'user_a', first), 1);
  assert.deepEqual(await store.outboxRecords(), []);
});

test('memory arm carries the optional React binding receipt outside entry accounting', async () => {
  const store = createMemoryRqsResumeStore();
  assert.equal(await store.loadReactBindingReceipt(), null);
  const receipt = { binding: 'todos:list', nested: { version: 1 } };
  assert.equal(await store.commitReactBindingReceipt(receipt), true);
  receipt.nested.version = 99;
  const loaded = await store.loadReactBindingReceipt();
  assert.deepEqual(loaded, { binding: 'todos:list', nested: { version: 1 } });
  loaded.nested.version = 2;
  assert.equal((await store.loadReactBindingReceipt()).nested.version, 1, 'loads are detached');
  assert.equal(await store.commitReactBindingReceipt(null), false);
  assert.equal(await store.commitReactBindingReceipt('not-an-object'), false);
  assert.equal(await store.commitReactBindingReceipt([]), false);
  assert.equal(await store.commitReactBindingReceipt({ payload: 'x'.repeat(64 * 1024) }), false);
  assert.equal((await store.loadReactBindingReceipt()).binding, 'todos:list');
  const inspection = await store.inspection();
  assert.deepEqual({ entries: inspection.entries, bytes: inspection.bytes }, { entries: 0, bytes: 0 });
  await store.wipe();
  assert.equal(await store.loadReactBindingReceipt(), null);
  await store.close();
});

test('indexeddb arm carries the outbox contract atomically', async () => {
  const store = createIndexedDbRqsResumeStore({
    indexedDB: new IDBFactory(),
    lockManager: grantingLocks,
  });
  // The web arm's lock callback runs synchronously under the granting
  // double; whenLockSettled() resolves only at close for a granted writer.
  await Promise.resolve();
  assert.equal(store.isWriter(), true);
  await exerciseOutboxContract(store, { label: 'indexeddb' });
  assert.deepEqual(store.durability(), { implementation: 'indexeddb', durable: true });
  const inspection = await store.inspection();
  assert.equal(inspection.outbox.pending, 0);
  await store.close();
});

test('file arm outbox survives relaunch and refuses non-writers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-'));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await store.whenLockSettled();
  await exerciseOutboxContract(store, { label: 'file' });
  await store.outboxEnqueue({ id: 'cm-durable', function: 'createThing', args: { n: 1 } });
  // A second instance in the same process on the same identity is a reader:
  // enqueue must throw the typed not-writer refusal, never silently drop.
  const reader = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await reader.whenLockSettled();
  assert.equal(reader.isWriter(), false);
  await assert.rejects(
    () => reader.outboxEnqueue({ id: 'cm-x', function: 'createThing' }),
    (error) => error.code === 'SNAPBACK_OUTBOX_NOT_WRITER',
  );
  assert.equal(await reader.outboxEmpty(), false, 'readers still see pending intent');
  await reader.close();
  await store.close();
  // Relaunch (fresh instance): the pending record survived on disk.
  const relaunched = createFileRqsResumeStore({ directory, identity: 'origin:test' });
  await relaunched.whenLockSettled();
  assert.equal(relaunched.isWriter(), true, 'relaunch reclaims writership');
  assert.deepEqual(
    (await relaunched.outboxPending()).map((r) => r.id),
    ['cm-durable'],
    'restart-safe queue: pending intent survives the relaunch',
  );
  await relaunched.close();
});

test('file arm retains a consumed settlement and ACK obligation across relaunch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-settlement-'));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:settlement' });
  await store.whenLockSettled();
  await store.outboxEnqueue({ id: 'cm-settled', function: 'createThing', args: { n: 1 } });
  await store.outboxDurablyConsume(
    'cm-settled',
    { result: { id: 'thing_1' }, version: 9 },
    'user_a',
  );
  await store.close();

  const relaunched = createFileRqsResumeStore({ directory, identity: 'origin:settlement' });
  await relaunched.whenLockSettled();
  assert.deepEqual(await relaunched.outboxPending(), [], 'settled work is never re-executed');
  const retained = (await relaunched.outboxRecords()).find((record) => record.id === 'cm-settled');
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.settlement.result, { id: 'thing_1' });
  assert.deepEqual(await relaunched.outboxPendingAcknowledgements('user_a'), []);
  await relaunched.outboxMarkAcknowledgementsReady(['cm-settled']);
  assert.deepEqual(await relaunched.outboxPendingAcknowledgements('user_a'), ['cm-settled']);
  await relaunched.outboxConfirmAcknowledgements(['cm-settled']);
  assert.deepEqual(await relaunched.outboxRecords(), []);
  await relaunched.close();
});

test('file arm migrates a v1 blob in place (entries kept, empty outbox)', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-v1-'));
  const store = createFileRqsResumeStore({ directory, identity: 'origin:v1' });
  await store.whenLockSettled();
  // Find the blob path by writing once, then rewrite it as a v1 blob.
  await store.outboxEnqueue({ id: 'cm-seed', function: 'seed' });
  const blobName = (await import('node:fs')).readdirSync(directory)
    .find((name) => name.endsWith('.v1.json'));
  const blobPath = join(directory, blobName);
  const v2 = JSON.parse(readFileSync(blobPath, 'utf8'));
  writeFileSync(blobPath, JSON.stringify({
    format: RQS_FILE_STORE_FORMAT_V1,
    entries: v2.entries,
  }));
  assert.deepEqual(await store.outboxPending(), [], 'v1 blob reads as an empty outbox');
  const record = await store.outboxEnqueue({ id: 'cm-after', function: 'seed' });
  assert.equal(record.sequence, 1, 'migrated store restarts its sequence');
  const upgraded = JSON.parse(readFileSync(blobPath, 'utf8'));
  assert.notEqual(upgraded.format, RQS_FILE_STORE_FORMAT_V1, 'write upgrades the format');
  await store.close();
});

test('default store resolution ladder', () => {
  // Node with a state directory -> durable file store.
  const directory = mkdtempSync(join(tmpdir(), 'snapback-default-'));
  const previousDir = process.env.SNAPBACK_CLIENT_RQS_DIR;
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  try {
    process.env.SNAPBACK_CLIENT_RQS_DIR = directory;
    delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    const resolved = resolveDefaultRqsStore({ baseUrl: 'http://127.0.0.1:4400' });
    assert.equal(resolved.info.implementation, 'file');
    assert.equal(resolved.info.durable, true);
    assert.equal(resolved.info.source, 'default');
    void resolved.store.close();
    // Kill switch -> disabled, no store.
    process.env.SNAPBACK_CLIENT_RQS_STORE = 'off';
    const disabled = resolveDefaultRqsStore({ baseUrl: 'http://127.0.0.1:4400' });
    assert.equal(disabled.store, null);
    assert.equal(disabled.info.source, 'disabled');
  } finally {
    if (previousDir === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
    else process.env.SNAPBACK_CLIENT_RQS_DIR = previousDir;
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('client constructor reports the resolved store (DK-9 degradation fact)', () => {
  const injected = createMemoryRqsResumeStore();
  const client = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: injected });
  assert.deepEqual(
    { ...client.rqsStoreInfo },
    { source: 'injected', implementation: 'memory', durable: false, reason: null },
  );
  const optedOut = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: null });
  assert.equal(optedOut.rqsStore, null);
  assert.equal(optedOut.rqsStoreInfo.source, 'disabled');
});

test('volatile store never claims the durable settlement-publication path', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => client.mutate('createThing', { args: {}, queue: true }),
    (error) => error.code === 'SNAPBACK_OFFLINE_QUEUE_DURABILITY_REQUIRED',
  );
  assert.equal(calls, 0, 'required durable custody refuses before dispatch');
  await assert.rejects(
    () => client.mutate('createThing', { args: {} }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
  assert.equal((await store.outboxRecords()).length, 0, 'auto mode never queues into memory');
});

test('closeAuth releases an owned default store for the next sequential client', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-client-handoff-'));
  const previousDir = process.env.SNAPBACK_CLIENT_RQS_DIR;
  const previousSwitch = process.env.SNAPBACK_CLIENT_RQS_STORE;
  try {
    process.env.SNAPBACK_CLIENT_RQS_DIR = directory;
    delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    const first = new SnapbackClient('http://127.0.0.1:4400');
    await first.rqsStore.whenLockSettled();
    assert.equal(first.rqsStore.isWriter(), true);
    await first.closeAuth();

    const second = new SnapbackClient('http://127.0.0.1:4400');
    await second.rqsStore.whenLockSettled();
    assert.equal(second.rqsStore.isWriter(), true, 'the successor acquires the released writer role');
    const record = await second.rqsStore.outboxEnqueue({ id: 'cm-successor', function: 'createThing' });
    assert.equal(record.id, 'cm-successor', 'the successor persists instead of silently reading');
    await second.closeAuth();

    let injectedClosed = 0;
    const injected = createMemoryRqsResumeStore();
    const injectedClose = injected.close.bind(injected);
    injected.close = async () => { injectedClosed += 1; await injectedClose(); };
    const callerOwned = new SnapbackClient('http://127.0.0.1:4400', { rqsStore: injected });
    await callerOwned.closeAuth();
    assert.equal(injectedClosed, 0, 'client cleanup never closes an injected store');
    await injected.close();
  } finally {
    if (previousDir === undefined) delete process.env.SNAPBACK_CLIENT_RQS_DIR;
    else process.env.SNAPBACK_CLIENT_RQS_DIR = previousDir;
    if (previousSwitch === undefined) delete process.env.SNAPBACK_CLIENT_RQS_STORE;
    else process.env.SNAPBACK_CLIENT_RQS_STORE = previousSwitch;
  }
});

test('mutate queues on connectivity failure and replays exactly-once', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const devDiagnosticsEvents = [];
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });

  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.queued, true);
  assert.equal(queued.presentation, 'withheld');
  assert.match(queued.clientMutationId, /^mut_[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.equal(queued.sequence, 1);
  const queuedUpdate = await client.mutate('updateThing', { args: { title: 'later' } });
  assert.equal(queuedUpdate.sequence, 2);
  assert.equal((await store.outboxPending()).length, 2);
  assert.deepEqual(devDiagnosticsEvents, [
    {
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      mutation: 'createThing',
      clientMutationId: queued.clientMutationId,
      sequence: 1,
      queueReasonClass: 'connectivity',
      drainMode: 'none',
      firstInSession: true,
    },
    {
      code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
      mutation: 'updateThing',
      clientMutationId: queuedUpdate.clientMutationId,
      sequence: 2,
      queueReasonClass: 'connectivity',
      drainMode: 'none',
      firstInSession: false,
    },
  ], 'the injected stub receives every relinquishment transition');
  assert(devDiagnosticsEvents.every(Object.isFrozen));

  // A server refusal is NOT queued: it throws with its diagnostic.
  globalThis.fetch = async () => Response.json(
    { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
    { status: 400 },
  );
  await assert.rejects(
    () => client.mutate('createThing', { args: { bad: true } }),
    /SNAPBACK_VALIDATION/,
  );
  assert.equal((await store.outboxPending()).length, 2, 'refusal did not enqueue');

  // Reconnect: replay drains in sequence order under the SAME minted ids.
  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    delivered.push(body);
    return Response.json({
      result: { ok: true },
      version: 7,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [queued.clientMutationId, queuedUpdate.clientMutationId],
    'replay is ordered by sequence and keeps the minted durable identity',
  );
  // Settlements survive the crash-before-publication cut and do not become
  // ACK-eligible until the application explicitly consumes the recovery API.
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);
  const recovered = await client.settledMutations();
  assert.deepEqual(
    recovered.map((entry) => entry.clientMutationId).sort(),
    [queued.clientMutationId, queuedUpdate.clientMutationId].sort(),
  );
  await client.markMutationSettlementsConsumed(
    recovered.map((entry) => entry.clientMutationId),
  );
  // Consumed ids became ACK obligations; the next mutation piggybacks them.
  const acks = await store.outboxPendingAcknowledgements(
    null,
    64,
    TEST_AUTHORITY_DESCRIPTOR,
  );
  assert.deepEqual(
    [...acks].sort(),
    [queued.clientMutationId, queuedUpdate.clientMutationId].sort(),
  );
  delivered.length = 0;
  await client.mutate('createThing', {
    args: { title: 'online' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  assert.deepEqual(
    [...(delivered[0].acknowledgedClientMutationIds ?? [])].sort(),
    [...acks].sort(),
    'next mutation carries the exactly-once ledger GC piggyback',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    [],
    'a successful response confirms the sent acknowledgements',
  );
});

test('checked sidecar adoption drains one injected store against the candidate origin', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  await store.outboxEnqueue({
    id: 'cm-sidecar-adoption',
    function: 'createThing',
    args: { title: 'pending across origin' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  });
  const delivered = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/inspect')) return Response.json(adoptionInspection());
    const body = JSON.parse(init.body);
    delivered.push({ url: String(url), body });
    return Response.json({ result: { ok: true }, version: 7 });
  };
  const candidate = new SnapbackClient('http://127.0.0.1:41002', {
    rqsStore: store,
    offlineQueue: true,
  });
  const receipt = await candidate.adoptQueuedMutations({
    expectedClientStoreId: clientStoreId,
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
  });
  assert.equal(receipt.schemaVersion, 'snapback.outbox-adoption.v1');
  assert.equal(receipt.clientStoreId, clientStoreId);
  assert.equal(receipt.writer, true);
  assert.equal(receipt.pendingBefore, 1);
  assert.equal(receipt.replayed, 1, JSON.stringify({
    receipt,
    stop: candidate.__outboxLastReplayStop,
    diagnostics: candidate.outboxDiagnostics,
  }));
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.stopped, false);
  assert.deepEqual(
    receipt.before,
    { pending: 1, failed: 0, stranded: 0, quarantined: 0, resultGone: 0 },
  );
  assert.deepEqual(
    receipt.after,
    { pending: 0, failed: 0, stranded: 0, quarantined: 0, resultGone: 0 },
  );
  assert.equal(delivered[0].url, 'http://127.0.0.1:41002/mutation/createThing');
  assert.equal(delivered[0].body.clientMutationId, 'cm-sidecar-adoption');
  assert.equal(Object.isFrozen(receipt), true);
  assert.equal(Object.isFrozen(receipt.before), true);
});

test('sidecar adoption refuses freshness, store, writer, and artifact divergence before replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-outbox-adoption-writer-'));
  const firstStore = createFileRqsResumeStore({
    directory,
    identity: 'sidecar-adoption-writer',
    clientStoreId: 'sidecar-adoption-writer-store',
  });
  await firstStore.whenLockSettled();
  await firstStore.outboxEnqueue({
    id: 'cm-sidecar-writer-fence',
    function: 'createThing',
    args: {},
    expectedGeneration: TEST_ARTIFACT_GENERATION,
  });
  const secondStore = createFileRqsResumeStore({
    directory,
    identity: 'sidecar-adoption-writer',
  });
  t.after(async () => {
    await secondStore.close();
    await firstStore.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await secondStore.whenLockSettled();
  assert.equal(secondStore.isWriter(), false);
  const nonWriter = new SnapbackClient('http://127.0.0.1:41003', {
    rqsStore: secondStore,
    offlineQueue: true,
  });
  await assert.rejects(
    () => nonWriter.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_NOT_WRITER',
  );
  const fencedReplay = await nonWriter.replayQueuedMutations();
  assert.deepEqual(
    { remaining: fencedReplay.remaining, stopped: fencedReplay.stopped },
    { remaining: 1, stopped: true },
    'a non-writer reports the authoritative visible queue instead of zero',
  );

  const writerClient = new SnapbackClient('http://127.0.0.1:41004', {
    rqsStore: firstStore,
    offlineQueue: true,
  });
  let unexpectedDispatches = 0;
  globalThis.fetch = async () => {
    unexpectedDispatches += 1;
    throw new Error('adoption prerequisite refusal must precede network dispatch');
  };
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => ({
        ...TEST_FRESH_SNAPSHOT_BARRIER,
        kind: 'incremental',
      }),
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_FRESH_SNAPSHOT_REQUIRED',
  );
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'different-sidecar-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_STORE_ID_MISMATCH',
  );
  assert.equal(unexpectedDispatches, 0);
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/inspect$/u, 'artifact mismatch refuses before mutation dispatch');
    return Response.json(adoptionInspection({
      ...TEST_ARTIFACT_GENERATION,
      bundleHash: `sha256:${'d'.repeat(64)}`,
    }));
  };
  await assert.rejects(
    () => writerClient.adoptQueuedMutations({
      expectedClientStoreId: 'sidecar-adoption-writer-store',
      expectedGeneration: TEST_ARTIFACT_GENERATION,
      afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_ADOPTION_INCOMPATIBLE_SUCCESSOR',
  );
  assert.equal((await firstStore.outboxPending()).length, 1);
});

test('sidecar adoption keeps identity-divergent intent pending for rollback', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientStoreId = (await store.readStoreMeta()).clientStoreId;
  await store.outboxEnqueue({
    id: 'cm-sidecar-identity-divergence',
    function: 'createThing',
    args: { title: 'different identity' },
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    argumentSchema: TEST_CREATE_THING_ARGUMENT_SCHEMA,
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/inspect')) return Response.json(adoptionInspection());
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_CLIENT_MUTATION_ID_REUSED',
        message: 'client mutation identity diverged',
      },
    }, { status: 409 });
  };
  const candidate = new SnapbackClient('http://127.0.0.1:41005', {
    rqsStore: store,
    offlineQueue: true,
  });
  const receipt = await candidate.adoptQueuedMutations({
    expectedClientStoreId: clientStoreId,
    expectedGeneration: TEST_ARTIFACT_GENERATION,
    afterFreshSnapshot: async () => TEST_FRESH_SNAPSHOT_BARRIER,
  });
  assert.deepEqual(
    {
      replayed: receipt.replayed,
      failedDelta: receipt.failedDelta,
      remaining: receipt.remaining,
      stopped: receipt.stopped,
    },
    { replayed: 0, failedDelta: 0, remaining: 1, stopped: true },
  );
  const [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.id, 'cm-sidecar-identity-divergence');
});

test('opt-in client range transport allocates before first mutation and reuses one retry carrier', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const clientAudienceId = (await store.readStoreMeta()).clientStoreId;
  const requests = [];
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/client-mutations/identity-range')) {
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'dev-user-a',
          authorityInstanceId: 'dev-user-a',
          epochId: 'epoch-client-a',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'c'.repeat(64)}`,
        },
      });
    }
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-range.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const result = await client.mutate('createThing', {
    args: { title: 'covered' },
    userId: 'user-a',
  });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/client-mutations\/identity-range$/);
  assert.equal(requests[0].body.clientAudienceId, clientAudienceId);
  assert.match(requests[1].url, /\/mutation\/createThing$/);
  assert.match(requests[1].body.clientMutationId, /^mut_/u);
  assert.deepEqual(requests[1].body.operationIssuance, {
    kind: 'clientRange',
    epoch_id: 'epoch-client-a',
    counter: 0,
    range_start: 0,
    range_end_exclusive: 256,
    authority_authenticator_digest: `sha256:${'c'.repeat(64)}`,
  });
  const retained = await store.outboxRecords();
  assert.equal(retained[0].operationIssuance.counter, 0);
  assert.equal(retained[0].status, 'settled');
});

test('uncovered offline intent obtains and durably assigns a range before reconnect admission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const client = new SnapbackClient('https://operation-reconnect.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'offline-before-range' },
    userId: 'user-a',
  });
  assert.equal(queued.operationCoverageDisposition, 'uncovered-range-exhausted');
  assert.equal((await store.outboxPending())[0].operationIssuance, null);

  const requests = [];
  const issuedAtMs = Date.now();
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), body });
    if (String(url).endsWith('/client-mutations/identity-range')) {
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-reconnect',
          authorityInstanceId: 'authority-reconnect',
          epochId: 'epoch-reconnect',
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'d'.repeat(64)}`,
        },
      });
    }
    assert(body.operationIssuance, 'mutation transport must never see an uncovered replay');
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  assert.equal(
    requests.filter(({ url }) => url.endsWith('/mutation/createThing')).length,
    1,
  );
  assert.equal(requests[1].body.operationIssuance.epoch_id, 'epoch-reconnect');
});

test('server epoch-capacity refusal keeps uncovered intent queued for fresh authority', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const devDiagnosticsEvents = [];
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/client-mutations\/identity-range$/u);
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_OPERATION_RANGE_EXHAUSTED',
        message: 'client identity epoch reached its finite v1 counter capacity',
      },
    }, { status: 409 });
  };
  const client = new SnapbackClient('https://operation-capacity.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'wait-for-fresh-epoch' },
    userId: 'user-a',
  });
  assert.equal(queued.queued, true);
  assert.equal(queued.operationCoverageDisposition, 'uncovered-range-exhausted');
  assert.deepEqual(devDiagnosticsEvents, [{
    code: 'SNAPBACK_OFFLINE_MUTATION_QUEUED',
    mutation: 'createThing',
    clientMutationId: queued.clientMutationId,
    sequence: queued.sequence,
    queueReasonClass: 'no-attempt-policy',
    drainMode: 'none',
    firstInSession: true,
  }], 'the no-attempt relinquishment site emits the same canonical event');
  let [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);

  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { failed: replay.failed, remaining: replay.remaining, stopped: replay.stopped },
    { failed: 0, remaining: 1, stopped: true },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
});

test('fresh same-principal authority atomically covers capacity-stranded intent', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const descriptorA = TEST_AUTHORITY_DESCRIPTOR;
  const descriptorB = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-4455667788bb',
    sessionGeneration: 2,
  };
  let currentDescriptor = descriptorA;
  let currentPrincipalId = TEST_SESSION_USER_ID;
  const issuedAtMs = Date.now();
  const mutationBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/session')) {
      return Response.json(sessionHandshake(currentDescriptor, currentPrincipalId));
    }
    const body = JSON.parse(init.body);
    if (target.endsWith('/client-mutations/identity-range')) {
      assert.deepEqual(body.authorityDescriptor, currentDescriptor);
      if (currentDescriptor.authorityInstanceId === descriptorA.authorityInstanceId) {
        return Response.json({
          diagnostic: {
            code: 'SNAPBACK_OPERATION_RANGE_EXHAUSTED',
            message: 'predecessor epoch reached its finite v1 counter capacity',
          },
        }, { status: 409 });
      }
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-successor',
          authorityInstanceId: descriptorB.authorityInstanceId,
          epochId: 'epoch-successor',
          epochSequence: 2,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'e'.repeat(64)}`,
        },
      });
    }
    mutationBodies.push(body);
    return Response.json({
      result: { ok: true },
      version: 2,
      authorityDescriptor: descriptorB,
    });
  };
  const client = new SnapbackClient('https://operation-successor.example', {
    bearerToken: 'sbs_predecessor_authority',
    authClientProtocol: 1,
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const queued = await client.mutate('createThing', {
    args: { title: 'same principal, fresh authority' },
    authorityDescriptor: descriptorA,
  });
  assert.equal(queued.queued, true);
  let [retained] = await store.outboxRecords();
  assert.equal(retained.operationIssuance, null);
  assert.equal(retained.operationAuthorityPrincipalId, TEST_SESSION_USER_ID);

  currentDescriptor = descriptorB;
  currentPrincipalId = '018f0d90-7b25-7a22-8c33-4455667788cc';
  client.clearAuthSession();
  const crossPrincipal = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: crossPrincipal.replayed,
      failed: crossPrincipal.failed,
      remaining: crossPrincipal.remaining,
      stopped: crossPrincipal.stopped,
    },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'pending');
  assert.equal(retained.operationIssuance, null);
  assert.deepEqual(retained.authorityDescriptor, descriptorA);

  currentPrincipalId = TEST_SESSION_USER_ID;
  client.clearAuthSession();
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  [retained] = await store.outboxRecords();
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.authorityDescriptor, descriptorB);
  assert.equal(retained.operationIssuance.epoch_id, 'epoch-successor');
  assert.equal(mutationBodies.length, 1);
  assert.deepEqual(mutationBodies[0].authorityDescriptor, descriptorB);
  assert.equal(mutationBodies[0].operationIssuance.epoch_id, 'epoch-successor');
});

test('sessions mode automatically carries authority through range issuance and ACK custody', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const issuedAtMs = Date.now();
  const rangeBodies = [];
  const mutationBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/auth/session')) {
      return Response.json(sessionHandshake(TEST_AUTHORITY_DESCRIPTOR, TEST_SESSION_USER_ID));
    }
    const body = JSON.parse(init.body);
    if (target.endsWith('/client-mutations/identity-range')) {
      rangeBodies.push(body);
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: 'audience-automatic-session',
          authorityInstanceId: TEST_AUTHORITY_DESCRIPTOR.authorityInstanceId,
          epochId: 'epoch-automatic-session',
          epochSequence: 1,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${'a'.repeat(64)}`,
        },
      });
    }
    mutationBodies.push(body);
    return Response.json({
      result: { ok: true },
      version: 1,
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const client = new SnapbackClient('https://operation-automatic-session.example', {
    bearerToken: 'sbs_automatic_session',
    authClientProtocol: 1,
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const result = await client.mutate('createThing', {
    args: { title: 'automatic session authority' },
  });
  assert.deepEqual(result.result, { ok: true });
  assert.equal(rangeBodies.length, 1);
  assert.deepEqual(rangeBodies[0].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.equal(mutationBodies.length, 1);
  assert.deepEqual(mutationBodies[0].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  const [retained] = await store.outboxRecords();
  assert.deepEqual(retained.authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.equal(retained.operationAuthorityPrincipalId, TEST_SESSION_USER_ID);
  assert.equal(retained.operationIssuance.epoch_id, 'epoch-automatic-session');

  const recovered = await client.settledMutations();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].clientMutationId, retained.id);
  await client.markMutationSettlementsConsumed([retained.id]);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    [retained.id],
  );

  await client.mutate('createThing', {
    args: { title: 'automatic session acknowledgement' },
  });
  assert.equal(mutationBodies.length, 2);
  assert.deepEqual(mutationBodies[1].authorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
  assert.deepEqual(mutationBodies[1].acknowledgedClientMutationIds, [retained.id]);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    [],
    'the ACK obligation clears only after the second mutation succeeds',
  );
});

test('authority rotation allocates a disjoint range without rebinding old queued identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const descriptorA = TEST_AUTHORITY_DESCRIPTOR;
  const descriptorB = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-4455667788aa',
    sessionGeneration: 2,
  };
  const rangeRequests = [];
  const issuedAtMs = Date.now();
  let refuseAuthorityAMutation = true;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).endsWith('/client-mutations/identity-range')) {
      rangeRequests.push(body);
      const descriptor = body.authorityDescriptor;
      const suffix = descriptor.authorityInstanceId === descriptorA.authorityInstanceId ? 'a' : 'b';
      return Response.json({
        schemaVersion: 1,
        range: {
          schemaVersion: 1,
          audience: `audience-${suffix}`,
          authorityInstanceId: descriptor.authorityInstanceId,
          epochId: `epoch-${suffix}`,
          epochSequence: 0,
          rangeStart: 0,
          rangeEndExclusive: 256,
          issuedAtMs,
          expiresAtMs: issuedAtMs + 60_000,
          authorityAuthenticatorDigest: `sha256:${suffix.repeat(64)}`,
        },
      });
    }
    if (body.authorityDescriptor?.authorityInstanceId === descriptorA.authorityInstanceId
        && refuseAuthorityAMutation) {
      refuseAuthorityAMutation = false;
      throw new TypeError('response lost');
    }
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const client = new SnapbackClient('https://operation-rotation.example', {
    rqsStore: store,
    operationIdentityProtocol: 1,
  });
  const oldQueued = await client.mutate('createThing', {
    args: { title: 'old authority' },
    userId: 'user-a',
    authorityDescriptor: descriptorA,
  });
  const oldRecordBefore = (await store.outboxRecords())
    .find(({ id }) => id === oldQueued.clientMutationId);
  assert.equal(oldRecordBefore.operationIssuance.epoch_id, 'epoch-a');

  await client.mutate('createThing', {
    args: { title: 'new authority' },
    userId: 'user-a',
    authorityDescriptor: descriptorB,
  });
  assert.equal(rangeRequests.length, 2);
  assert.equal(rangeRequests[1].previousRange, undefined);
  const oldRecordAfter = (await store.outboxRecords())
    .find(({ id }) => id === oldQueued.clientMutationId);
  assert.equal(oldRecordAfter.authorityDescriptor.authorityInstanceId, descriptorA.authorityInstanceId);
  assert.deepEqual(oldRecordAfter.operationIssuance, oldRecordBefore.operationIssuance);
});

test('mixed lane-Q and lane-L intents replay in sequence with immutable per-item policy', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const laneQ = await client.mutate('createThing', {
    args: { title: 'queued' },
    settlementLane: 'replay-accept',
    ctxLedger: { version: 1, ids: ['client-q-id'], now: 11 },
  });
  const laneL = await client.mutate('createThing', {
    args: { title: 'local' },
    settlementLane: 're-derive',
    settlementIdentity: {
      implementationHash: 'sha256:synthetic-local-handler',
      activation: {
        schemaVersion: 'snapback.v1',
        appId: 'mixed-lane-test',
        schemaHash: 'sha256:schema',
        bundleHash: 'sha256:bundle',
        inputsHash: 'sha256:inputs',
      },
    },
    settlementClaims: {
      version: 1,
      now: 22,
      mints: [{ claimed: 'client-l-id', site: 'insert:things', occurrence: 0 }],
    },
  });
  assert.deepEqual(
    (await store.outboxPending()).map(({ id, sequence, settlementLane }) => ({
      id,
      sequence,
      settlementLane,
    })),
    [
      { id: laneQ.clientMutationId, sequence: 1, settlementLane: 'replay-accept' },
      { id: laneL.clientMutationId, sequence: 2, settlementLane: 're-derive' },
    ],
  );

  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    delivered.push(body);
    return Response.json({
      result: { ok: true },
      version: delivered.length,
    });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 2, failed: 0, remaining: 0 },
  );
  // @ref LLP 0133#the-two-settlement-lanes — queue order is global, but
  //   settlement policy remains attached to each immutable intent.
  assert.deepEqual(
    delivered.map((body) => [body.clientMutationId, body.settlementLane]),
    [
      [laneQ.clientMutationId, 'replay-accept'],
      [laneL.clientMutationId, 're-derive'],
    ],
  );
  assert.deepEqual(delivered[0].ctx_ledger, { version: 1, ids: ['client-q-id'], now: 11 });
  assert.equal(delivered[1].settlementClaims.now, 22);
  assert.equal(delivered[1].ctx_ledger, undefined);
});

test('LLP 0133 sketch 3 rewrites mapped speculative-id leaves before dependent submission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const mint = await client.mutate('mintParent', {
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  const dependent = await client.mutate('mintChild', {
    args: {
      parentId: 'spec-parent',
      deliberatelyCopiedLabel: 'spec-parent',
      embeddedResidue: 'parent=spec-parent',
    },
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-child', site: 'insert:children:id', occurrence: 0 }],
    },
  });
  const transitive = await client.mutate('attachChild', {
    args: { childId: 'spec-child' },
    settlementLane: 're-derive',
    settlementClaims: { version: 1, mints: [] },
  });

  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    delivered.push(body);
    if (body.clientMutationId === mint.clientMutationId) {
      return Response.json({
        result: { id: 'auth-parent' },
        version: 1,
        receipt: {
          kind: 'mutation',
          idMap: [{
            speculative: 'spec-parent',
            authoritative: 'auth-parent',
            site: 'insert:parents:id',
            occurrence: 0,
            disposition: 'mapped',
          }],
        },
      });
    }
    if (body.clientMutationId === dependent.clientMutationId) {
      assert.equal(body.args.parentId, 'auth-parent');
      assert.equal(
        body.args.deliberatelyCopiedLabel,
        'auth-parent',
        'exact-leaf false positives are an intentional v0 scope limit',
      );
      assert.equal(
        body.args.embeddedResidue,
        'parent=spec-parent',
        'embedded/derived ids are neither rewritten nor detected before OQ2',
      );
      return Response.json({
        result: { id: 'auth-child' },
        version: 2,
        receipt: {
          kind: 'mutation',
          idMap: [{
            speculative: 'spec-child',
            authoritative: 'auth-child',
            site: 'insert:children:id',
            occurrence: 0,
            disposition: 'mapped',
          }],
        },
      });
    }
    assert.equal(body.clientMutationId, transitive.clientMutationId);
    assert.equal(body.args.childId, 'auth-child');
    return Response.json({
      result: { ok: true },
      version: 3,
      receipt: { kind: 'mutation', idMap: [] },
    });
  };

  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 3, failed: 0, remaining: 0 },
  );
  assert.deepEqual(
    delivered.map((body) => body.clientMutationId),
    [mint.clientMutationId, dependent.clientMutationId, transitive.clientMutationId],
    'the submission fence remains sequence-serial across both rewrite generations',
  );
});

test('LLP 0133 sketch 3 rejection cascades transitively without dependent submission', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

  const mint = await client.mutate('mintParent', {
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await client.mutate('mintChild', {
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-child', site: 'insert:children:id', occurrence: 0 }],
    },
  });
  await client.mutate('attachChild', {
    args: { childId: 'spec-child' },
    settlementLane: 're-derive',
    settlementClaims: { version: 1, mints: [] },
  });

  let submissions = 0;
  globalThis.fetch = async () => {
    submissions += 1;
    return Response.json({
      diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'mint refused' },
      receipt: {
        kind: 'mutation',
        outcome: 'rejected',
        mutationId: mint.clientMutationId,
        idMap: [{
          speculative: 'spec-parent',
          authoritative: null,
          site: 'insert:parents:id',
          occurrence: 0,
          disposition: 'unmapped',
        }],
      },
    }, { status: 409 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 0, failed: 3, remaining: 0 },
  );
  assert.equal(submissions, 1, 'neither direct nor transitive dependents cross transport');
  const records = await store.outboxRecords();
  assert.equal(records[0].failure.code, 'SNAPBACK_MUTATION_CONFLICT');
  assert.deepEqual(
    records.slice(1).map((record) => [record.status, record.failure.code]),
    [
      ['failed', 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED'],
      ['failed', 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED'],
    ],
    'cascade failures are terminal and observable with the stable code',
  );
});

test('LLP 0133 sketch 3 unmapped successful mint takes the same local cascade', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-mint-unmapped',
    function: 'mintParent',
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await store.outboxEnqueue({
    id: 'cm-dependent-unmapped',
    function: 'useParent',
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
  });
  await store.outboxDurablyConsume('cm-mint-unmapped', {
    result: { ok: true },
    receipt: {
      kind: 'mutation',
      idMap: [{
        speculative: 'spec-parent',
        authoritative: null,
        site: 'insert:parents:id',
        occurrence: 0,
        disposition: 'unmapped',
      }],
    },
  });
  const dependent = (await store.outboxRecords())
    .find((record) => record.id === 'cm-dependent-unmapped');
  assert.equal(dependent.status, 'failed');
  assert.equal(dependent.failure.code, 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED');
});

test('LLP 0133 speculative-id submission fence blocks a pending mint predecessor', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-pending-mint',
    function: 'mintParent',
    settlementLane: 're-derive',
    settlementClaims: {
      version: 1,
      mints: [{ claimed: 'spec-parent', site: 'insert:parents:id', occurrence: 0 }],
    },
  });
  await store.outboxEnqueue({
    id: 'cm-blocked-dependent',
    function: 'useParent',
    args: { parentId: 'spec-parent' },
    settlementLane: 're-derive',
  });
  const prepared = await store.outboxPrepareSubmission('cm-blocked-dependent');
  assert.equal(prepared.status, 'blocked');
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === 'cm-blocked-dependent').status,
    'pending',
    'the fence delays rather than inventing a terminal outcome while the predecessor is pending',
  );
});

test('queued generated mutation retains its call-time artifact generation through replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const expectedGeneration = {
    schemaVersion: 'snapback.v1',
    appId: 'generation-bound-outbox',
    schemaHash: 'schema-generation-bound-outbox',
    bundleHash: 'bundle-generation-bound-outbox',
    inputsHash: 'inputs-generation-bound-outbox',
  };
  const ref = {
    artifactKind: 'functionReference',
    name: 'generationBoundMutation',
    argumentSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'integer' } },
      required: ['value'],
    },
    expectedGeneration,
  };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await client.mutate(ref, { args: { value: 1 } });
  assert.deepEqual((await store.outboxPending())[0].expectedGeneration, expectedGeneration);

  let replayBody;
  globalThis.fetch = async (_url, init) => {
    replayBody = JSON.parse(init.body);
    return Response.json({
      version: 1,
      result: { ok: true },
      authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
    });
  };
  const generationReplay = await client.replayQueuedMutations();
  assert.equal(generationReplay.replayed, 1, JSON.stringify({
    generationReplay,
    records: await store.outboxRecords(),
  }));
  assert.deepEqual(replayBody.expectedGeneration, expectedGeneration);
});

test('explicit-id online publication is durable before delivery and retires only after ACK', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const devDiagnosticsEvents = [];
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    devDiagnosticsChannel: {
      emit(event) { devDiagnosticsEvents.push(event); },
    },
  });
  let releaseResponse;
  globalThis.fetch = async () => new Promise((resolve) => { releaseResponse = resolve; });

  const delivery = client.mutate('createThing', {
    args: { title: 'online' },
    clientMutationId: 'cm-online-durable',
  });
  await new Promise((resolve) => setImmediate(resolve));
  const beforeResponse = (await store.outboxRecords()).find(
    (record) => record.id === 'cm-online-durable',
  );
  assert.equal(beforeResponse.status, 'pending', 'intent commits before network publication');
  assert.deepEqual(
    devDiagnosticsEvents,
    [],
    'durable insertion is not the queued diagnostic cadence',
  );

  releaseResponse(Response.json({
    result: { id: 'thing_1' },
    version: 4,
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  }));
  const result = await delivery;
  assert.equal(result.status, 'settled');
  assert.deepEqual(result.result, { id: 'thing_1' });
  assert.equal(result.version, 4);
  assert.deepEqual(
    devDiagnosticsEvents,
    [],
    'an online foreground settlement never crosses the relinquishment cut',
  );
  const retained = (await store.outboxRecords()).find(
    (record) => record.id === 'cm-online-durable',
  );
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.settlement.result, { id: 'thing_1' });
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);
  assert.deepEqual(
    (await client.settledMutations()).map((entry) => entry.clientMutationId),
    ['cm-online-durable'],
  );

  globalThis.fetch = async () => Response.json({ acknowledged: 1 });
  await client.acknowledgeMutations({ clientMutationIds: ['cm-online-durable'] });
  assert.deepEqual(await store.outboxRecords(), [], 'standalone ACK proof retires recovery state');
});

test('standalone ACK confirms only its exact authority cohort', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const second = {
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b25-7a22-8c33-445566778899',
    sessionGeneration: 1,
  };
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-standalone-cohort',
    function: 'createThing',
    userId: 'user_a',
    authorityDescriptor: first,
  });
  await store.outboxDurablyConsume(
    'cm-standalone-cohort',
    { result: { ok: true } },
    'user_a',
  );
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return Response.json({ acknowledged: 0 });
  };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  await client.acknowledgeMutations({
    userId: 'user_a',
    clientMutationIds: ['cm-standalone-cohort'],
    authorityDescriptor: second,
  });
  assert.equal((await store.outboxRecords())[0].status, 'settled');
  assert.deepEqual(bodies[0].authorityDescriptor, second);

  await client.acknowledgeMutations({
    userId: 'user_a',
    clientMutationIds: ['cm-standalone-cohort'],
    authorityDescriptor: first,
  });
  assert.deepEqual(await store.outboxRecords(), []);
  assert.deepEqual(bodies[1].authorityDescriptor, first);
});

test('explicit-id server refusal is failed locally and never acknowledged', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json(
    { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
    { status: 400 },
  );
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { bad: true },
      clientMutationId: 'cm-online-refused',
    }),
    /SNAPBACK_VALIDATION/,
  );
  const record = (await store.outboxRecords()).find((item) => item.id === 'cm-online-refused');
  assert.equal(record.status, 'failed');
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);
});

test('mutate teardown preserves the real refusal when failure marking races store close', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', {
    rqsStore: store,
    offlineQueue: true,
  });
  let markFetchEntered;
  const fetchEntered = new Promise((resolve) => { markFetchEntered = resolve; });
  let releaseResponse;
  globalThis.fetch = async () => {
    markFetchEntered();
    return new Promise((resolve) => { releaseResponse = resolve; });
  };

  const pending = client.mutate('teardownRefusal', {
    args: { value: 1 },
    clientMutationId: 'cm-teardown-store-close',
    queue: true,
  });
  const refusal = assert.rejects(
    pending,
    (error) => error?.diagnostic?.code === 'SNAPBACK_TEST_MUTATION_REFUSED',
  );
  await fetchEntered;
  await store.close();
  releaseResponse(Response.json({
    diagnostic: {
      code: 'SNAPBACK_TEST_MUTATION_REFUSED',
      message: 'server refusal won the race',
    },
  }, { status: 409 }));
  await refusal;
  assert.equal(
    client.outboxDiagnostics.at(-1)?.code,
    'SNAPBACK_OUTBOX_FAILURE_MARK_SKIPPED_STORE_CLOSED',
  );
  assert.equal(
    client.outboxDiagnostics.at(-1)?.clientMutationId,
    'cm-teardown-store-close',
  );
});

test('explicit id cannot be rebound to another durable replay identity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  await store.outboxEnqueue({
    id: 'cm-bound-once',
    function: 'createThing',
    args: { title: 'first' },
    userId: null,
    readSet: [],
    correlation: null,
    authorityDescriptor: null,
    ctxLedger: null,
    capturedNow: 1,
  });
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'different' },
      clientMutationId: 'cm-bound-once',
    }),
    (error) => error.code === 'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
  );
  assert.equal(calls, 0, 'identity mismatch refuses before delivery');
  assert.deepEqual((await store.outboxPending())[0].args, { title: 'first' });
});

test('server settlement descriptor enriches ACK custody without rebinding request identity', async () => {
  const store = createDurableTestStore();
  const intent = {
    id: 'cm-descriptor-enrichment',
    function: 'createThing',
    args: { title: 'same request' },
    userId: null,
    readSet: [],
    correlation: null,
    authorityDescriptor: null,
    ctxLedger: null,
    capturedNow: 1,
  };
  await store.outboxEnqueue(intent);
  await store.outboxDurablyConsume(
    intent.id,
    { result: { id: 'thing_1' }, authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR },
    null,
  );
  const retained = await store.outboxEnqueue({ ...intent, capturedNow: 2 });
  assert.equal(retained.status, 'settled');
  assert.equal(retained.authorityDescriptor, null, 'captured request identity stays immutable');
  assert.deepEqual(retained.settlementAuthorityDescriptor, TEST_AUTHORITY_DESCRIPTOR);
});

test('crash recovery exposes and consumes only the re-attested authority cohort', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const predecessor = {
    ...TEST_AUTHORITY_DESCRIPTOR,
    authorityInstanceId: '018f0d90-7b28-7a22-8c33-445566778899',
  };
  for (const [id, descriptor, secret] of [
    ['cm-predecessor-settlement', predecessor, 'predecessor-only'],
    ['cm-current-settlement', TEST_AUTHORITY_DESCRIPTOR, 'current-only'],
  ]) {
    await store.outboxEnqueue({
      id,
      function: 'createThing',
      args: {},
      userId: null,
      authorityDescriptor: null,
    });
    await store.outboxDurablyConsume(
      id,
      { result: { secret }, authorityDescriptor: descriptor },
      null,
    );
  }
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/auth\/session$/);
    return Response.json(sessionHandshake(TEST_AUTHORITY_DESCRIPTOR));
  };
  const client = new SnapbackClient('https://recovery.example', {
    bearerToken: 'sbs_current_recovery_bearer',
    authClientProtocol: 1,
    rqsStore: store,
  });
  const recovered = await client.settledMutations();
  assert.deepEqual(
    recovered.map((entry) => entry.clientMutationId),
    ['cm-current-settlement'],
  );
  assert.deepEqual(recovered[0].settlement.result, { secret: 'current-only' });
  assert.equal(
    await client.markMutationSettlementsConsumed([
      'cm-predecessor-settlement',
      'cm-current-settlement',
    ]),
    1,
    'a successor cannot make its predecessor settlement ACK-eligible',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    ['cm-current-settlement'],
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, predecessor),
    [],
  );
});

test('post-response persistence failure remains pending and is never published as failed', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const consume = store.outboxDurablyConsume.bind(store);
  store.outboxDurablyConsume = async () => {
    const error = new Error('simulated fsync failure');
    error.code = 'EIO';
    throw error;
  };
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json({ result: { id: 'thing_1' }, version: 4 });
  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'online' },
      clientMutationId: 'cm-persist-failure',
    }),
    (error) => error.code === 'EIO',
  );
  let record = (await store.outboxRecords()).find((item) => item.id === 'cm-persist-failure');
  assert.equal(record.status, 'pending');
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), []);

  store.outboxDurablyConsume = consume;
  const replayed = await client.replayQueuedMutations();
  assert.equal(replayed.replayed, 1);
  record = (await store.outboxRecords()).find((item) => item.id === 'cm-persist-failure');
  assert.equal(record.status, 'settled', 'same id recovers the committed server settlement');
});

test('replay persistence failure stops without drop-and-mark-failed', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  store.outboxDurablyConsume = async () => {
    const error = new Error('simulated fsync failure');
    error.code = 'EIO';
    throw error;
  };
  globalThis.fetch = async () => Response.json({ result: { id: 'thing_1' }, version: 4 });
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining, stopped: outcome.stopped },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  const record = (await store.outboxRecords()).find((item) => item.id === queued.clientMutationId);
  assert.equal(record.status, 'pending');
});

test('identity horizon outcome-unknown remains pending online and during replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => Response.json({
    diagnostic: {
      code: 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED',
      message: 'the identity epoch is below the retained outcome horizon',
      details: {
        disposition: 'identity-horizon-passed',
        outcome: 'unknown',
        terminal: false,
      },
    },
  }, { status: 409 });

  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'ambiguous' },
      clientMutationId: 'cm-outcome-unknown',
    }),
    (error) => (
      error.diagnostic.code === 'SNAPBACK_OPERATION_IDENTITY_HORIZON_PASSED'
      && error.operationOutcome === 'unknown'
    ),
  );
  let record = (await store.outboxRecords()).find((item) => item.id === 'cm-outcome-unknown');
  assert.equal(record.status, 'pending', 'online horizon refusal is not terminal failed state');

  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
    },
    { replayed: 0, failed: 0, remaining: 1, stopped: true },
  );
  record = (await store.outboxRecords()).find((item) => item.id === 'cm-outcome-unknown');
  assert.equal(record.status, 'pending', 'replay horizon refusal remains operator-visible pending');
});

test('committed result-expired becomes durable result-gone and blocks ordered successors', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_OPERATION_RESULT_EXPIRED',
        message: 'the committed operation result payload was reclaimed',
        details: {
          disposition: 'result-expired',
          outcome: 'committed',
          receiptDigest: `sha256:${'e'.repeat(64)}`,
        },
      },
    }, { status: 410 });
  };

  await assert.rejects(
    () => client.mutate('createThing', {
      args: { title: 'known-committed' },
      clientMutationId: 'cm-result-expired',
    }),
    (error) => (
      error.operationOutcome === 'committed'
      && error.operationResult === 'expired'
    ),
  );
  await store.outboxEnqueue({
    id: 'cm-after-result-expired',
    function: 'updateThing',
    args: { title: 'must-wait' },
  });
  calls = 0;
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
      calls,
    },
    { replayed: 0, failed: 0, remaining: 2, stopped: true, calls: 0 },
    'durable payload loss is never retried and keeps successors behind the submission fence',
  );
  assert.deepEqual(
    (await store.outboxRecords()).map((record) => [record.id, record.status]),
    [
      ['cm-result-expired', 'result-gone'],
      ['cm-after-result-expired', 'pending'],
    ],
  );
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 1, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 1, replaying: false,
      oldestPendingAtMs: (await store.outboxRecords())
        .find((record) => record.status === 'pending').enqueuedAt,
      drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null, blockedReason: null,
    },
  );
});

test('recreated file-backed client preserves result-gone without redelivery', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = mkdtempSync(join(tmpdir(), 'snapback-result-gone-relaunch-'));
  const firstStore = createFileRqsResumeStore({
    directory,
    identity: 'origin:result-gone-relaunch',
  });
  await firstStore.whenLockSettled();
  const firstClient = new SnapbackClient('https://result-gone.example', {
    rqsStore: firstStore,
  });
  globalThis.fetch = async () => Response.json({
    diagnostic: {
      code: 'SNAPBACK_OPERATION_RESULT_EXPIRED',
      message: 'the committed operation result payload was reclaimed',
      details: {
        disposition: 'result-expired',
        outcome: 'committed',
        receiptDigest: `sha256:${'f'.repeat(64)}`,
      },
    },
  }, { status: 410 });
  await assert.rejects(
    () => firstClient.mutate('createThing', {
      args: { title: 'restored-operation' },
      clientMutationId: 'cm-result-gone-relaunch',
    }),
    (error) => error.operationOutcome === 'committed' && error.operationResult === 'expired',
  );
  await firstStore.close();

  const reopenedStore = createFileRqsResumeStore({
    directory,
    identity: 'origin:result-gone-relaunch',
  });
  await reopenedStore.whenLockSettled();
  await reopenedStore.outboxEnqueue({
    id: 'cm-after-result-gone-relaunch',
    function: 'updateThing',
    args: { title: 'must remain fenced' },
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('result-gone relaunch must not dispatch');
  };
  const recreatedClient = new SnapbackClient('https://result-gone.example', {
    rqsStore: reopenedStore,
  });
  assert.deepEqual(
    { ...(await recreatedClient.outboxStatus()) },
    {
      supported: true, pending: 1, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 1, replaying: false,
      oldestPendingAtMs: (await reopenedStore.outboxRecords())
        .find((record) => record.status === 'pending').enqueuedAt,
      drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null, blockedReason: null,
    },
  );
  const replay = await recreatedClient.replayQueuedMutations();
  assert.deepEqual(
    {
      replayed: replay.replayed,
      failed: replay.failed,
      remaining: replay.remaining,
      stopped: replay.stopped,
      calls,
    },
    { replayed: 0, failed: 0, remaining: 2, stopped: true, calls: 0 },
  );
  const restored = (await reopenedStore.outboxRecords())
    .find((record) => record.id === 'cm-result-gone-relaunch');
  assert.equal(restored.status, 'result-gone');
  assert.equal(restored.resultGone.outcome, 'committed');
  assert.equal(restored.settlement, undefined, 'payload-gone never fabricates a settlement');
  await reopenedStore.close();
});

test('replay drop-and-mark-failed on server refusal, pending kept on connectivity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const a = await client.mutate('createThing', { args: { n: 1 } });
  const b = await client.mutate('createThing', { args: { n: 2 } });
  assert.equal(a.queued && b.queued, true);

  // First replay attempt: still offline -> stops with both records pending.
  const offline = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: offline.replayed, failed: offline.failed, remaining: offline.remaining },
    { replayed: 0, failed: 0, remaining: 2 },
  );

  // Reconnect: the first record is refused by the server (handler throw /
  // conflict class) -> dropped and marked failed, never retried; the second
  // still replays (LLP 0008 drop-and-mark-failed).
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        {
          diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'conflict' },
          receipt: { kind: 'mutation', outcome: 'REJECTED', mutationId: a.clientMutationId },
        },
        { status: 409 },
      );
    }
    return Response.json({ result: { ok: true }, version: 3 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 1, failed: 1, remaining: 0 },
  );
  const failedRecord = (await store.outboxRecords()).find((r) => r.id === a.clientMutationId);
  assert.equal(failedRecord.status, 'failed', 'refused replay is visible failed client state');
  assert.equal(failedRecord.failure.code, 'SNAPBACK_MUTATION_CONFLICT');

  // queue:false restores fail-loud delivery.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await assert.rejects(
    () => client.mutate('createThing', { args: { n: 3 }, queue: false }),
    (error) => isSnapbackDiagnosticError(error) && error.cause instanceof TypeError,
  );
});

// Regression: 0137 A1-Expo f2 — connectivity classification must be transport
// provenance (the fetch dispatch itself rejected: no HTTP status, no server
// diagnostic, no receipt), not constructor identity. Expo/RN fetch rejects
// connection failures with a PLAIN Error, so the pre-fix
// `instanceof TypeError` gate meant the M2 queue could never engage on that
// carrier — the raw transport error surfaced instead of {queued:true}.
test('mutate queues when the carrier fetch rejects a plain Error (Expo shape)', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // The exact witnessed Expo simulator rejection shape: name 'Error'.
  globalThis.fetch = async () => {
    throw new Error(
      'fetch failed: UnexpectedException: Could not connect to the server. '
      + '(at ExpoModulesCore/Promise.swift:56)',
    );
  };
  const queued = await client.mutate('createThing', { args: { title: 'expo-offline' } });
  assert.equal(queued.queued, true, 'Expo-shaped transport rejection engages the queue');
  assert.match(queued.clientMutationId, /^mut_[0-9a-hjkmnp-tv-z]{26}$/u);
  assert.equal(queued.sequence, 1);
  assert.equal((await store.outboxPending()).length, 1);

  // Replay drains it exactly like the undici-shaped path.
  const delivered = [];
  globalThis.fetch = async (_url, init) => {
    delivered.push(JSON.parse(init.body));
    return Response.json({ result: { ok: true }, version: 1 });
  };
  const outcome = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: outcome.replayed, failed: outcome.failed, remaining: outcome.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  assert.equal(delivered[0].clientMutationId, queued.clientMutationId);
});

test('caller aborts and server answers are never classified as connectivity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // A caller-owned abort is not an outage: fail loud, never enqueue.
  globalThis.fetch = async () => {
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    throw abort;
  };
  await assert.rejects(
    () => client.mutate('createThing', { args: { title: 'aborted' } }),
    (error) => isSnapbackDiagnosticError(error) && error.cause?.name === 'AbortError',
  );
  assert.equal((await store.outboxPending()).length, 0, 'abort did not enqueue');

  // A server-answered refusal keeps failing loud even with a plain-Error
  // carrier (the answered diagnostic is the proof the transport worked).
  globalThis.fetch = async () => Response.json(
    { diagnostic: { code: 'SNAPBACK_VALIDATION', message: 'bad args' } },
    { status: 400 },
  );
  await assert.rejects(
    () => client.mutate('createThing', { args: { bad: true } }),
    /SNAPBACK_VALIDATION/,
  );
  assert.equal((await store.outboxPending()).length, 0, 'refusal did not enqueue');
});

test('connectivity classification excludes custody and answered refusals', () => {
  const offlineQueueRefusal = new Error('offline queue disabled');
  offlineQueueRefusal.code = 'SNAPBACK_OFFLINE_QUEUE_DISABLED';
  offlineQueueRefusal.diagnostic = {
    code: 'SNAPBACK_OFFLINE_QUEUE_DISABLED',
    message: 'offline queue disabled',
  };
  const serverRefusal = new Error('server refused mutation');
  serverRefusal.status = 409;
  serverRefusal.diagnostic = {
    code: 'SNAPBACK_MUTATION_CONFLICT',
    message: 'conflict',
  };
  const dispatchFailure = new Error('fetch failed');
  dispatchFailure.fetchDispatchFailed = true;

  assert.equal(isConnectivityFailureError(outboxNotWriterError()), false);
  assert.equal(isConnectivityFailureError(offlineQueueRefusal), false);
  assert.equal(isConnectivityFailureError(serverRefusal), false);
  assert.equal(isConnectivityFailureError(dispatchFailure), true);
});

test('mutationStatus reports pending durable intent without inferring outcome-unknown', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-pending', function: 'createThing' });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  const disposition = await client.mutationStatus('cm-status-pending');
  assert.deepEqual(disposition, { status: 'pending', blockedReason: null });
  assert.equal(Object.isFrozen(disposition), true);
});

test('restart settlement recovery reports settled with the complete retained payload', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const first = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await first.mutate('createThing', { args: { title: 'restart' } });
  const settlement = {
    version: 17,
    changed_count: 1,
    result: { id: 'thing_restart' },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  };
  globalThis.fetch = async () => Response.json(settlement);
  assert.equal((await first.replayQueuedMutations()).replayed, 1);

  const restarted = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const disposition = await restarted.mutationStatus(queued.clientMutationId);
  assert.equal(disposition.status, 'settled');
  assert.deepEqual(disposition.settlement, settlement);
  assert.equal(Number.isSafeInteger(disposition.settledAt), true);
  assert.equal(Object.isFrozen(disposition), true);
  assert.equal(Object.isFrozen(disposition.settlement), true);
});

test('mutationStatus reports a retained terminal failure', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-failed', function: 'createThing' });
  await store.outboxMarkFailed('cm-status-failed', {
    code: 'SNAPBACK_TEST_REFUSAL',
    message: 'fixture refusal',
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  assert.deepEqual(await client.mutationStatus('cm-status-failed'), {
    status: 'failed',
    failure: { code: 'SNAPBACK_TEST_REFUSAL', message: 'fixture refusal' },
  });
});

test('mutationStatus reports a payload-free quarantined disposition', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-quarantined', function: 'createThing' });
  await store.outboxMarkQuarantined('cm-status-quarantined', {
    code: 'SNAPBACK_TEST_UPGRADE_REQUIRED',
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  assert.deepEqual(
    await client.mutationStatus('cm-status-quarantined'),
    { status: 'quarantined' },
  );
});

test('mutationStatus maps result-gone and carries its retained outcome facts', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-result-gone', function: 'createThing' });
  const receiptDigest = `sha256:${'d'.repeat(64)}`;
  await store.outboxMarkResultGone('cm-status-result-gone', {
    outcome: 'committed',
    receiptDigest,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  assert.deepEqual(await client.mutationStatus('cm-status-result-gone'), {
    status: 'resultGone',
    disposition: 'result-expired',
    outcome: 'committed',
    receiptDigest,
  });
});

test('result-gone acknowledgement is payload-free and releases its ordered-successor fence', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-ack-result-gone', function: 'createThing' });
  await store.outboxMarkResultGone('cm-ack-result-gone', {
    outcome: 'committed',
    receiptDigest: `sha256:${'e'.repeat(64)}`,
  });
  await store.outboxEnqueue({ id: 'cm-after-ack-result-gone', function: 'updateThing' });
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-ack-result-gone')).status,
    'blocked',
  );
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  assert.deepEqual(await client.acknowledgeResultGoneMutations(['cm-ack-result-gone']), {
    acknowledged: 1,
    clientMutationIds: ['cm-ack-result-gone'],
  });
  assert.equal((await client.mutationStatus('cm-ack-result-gone')).status, 'unknown');
  assert.equal(
    (await store.outboxPrepareSubmission('cm-after-ack-result-gone')).status,
    'ready',
  );
  await assert.rejects(
    () => client.acknowledgeResultGoneMutations(['cm-after-ack-result-gone']),
    (error) => error?.code === 'SNAPBACK_OUTBOX_RESULT_GONE_NOT_CURRENT',
  );
});

test('mutationStatus reports unknown after ACK consumption and collection', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-collected', function: 'createThing' });
  await store.outboxDurablyConsume('cm-status-collected', {
    version: 1,
    changed_count: 1,
    result: { ok: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  assert.equal((await client.mutationStatus('cm-status-collected')).status, 'settled');
  await client.markMutationSettlementsConsumed(['cm-status-collected']);
  assert.equal(await store.outboxConfirmAcknowledgements(['cm-status-collected']), 1);

  const disposition = await client.mutationStatus('cm-status-collected');
  assert.deepEqual(disposition, { status: 'unknown' });
  assert.equal(Object.isFrozen(disposition), true);
});

test('subscribeMutation delivers current pending then settled during replay', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  const queued = await client.mutate('createThing', { args: { title: 'subscribe' } });

  const statuses = [];
  let subscribing = true;
  const unsubscribe = client.subscribeMutation(queued.clientMutationId, (disposition) => {
    assert.equal(subscribing, false, 'initial mutation disposition is never sync-reentrant');
    statuses.push(disposition.status);
  });
  const unsubscribeThrowing = client.subscribeMutation(
    queued.clientMutationId,
    () => { throw new Error('observer failure'); },
  );
  assert.deepEqual(statuses, []);
  subscribing = false;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, ['pending']);

  globalThis.fetch = async () => Response.json({
    version: 2,
    changed_count: 1,
    result: { ok: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  assert.equal((await client.replayQueuedMutations()).replayed, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(statuses, ['pending', 'settled']);
  assert.equal((await client.mutationStatus(queued.clientMutationId)).status, 'settled');
  unsubscribe();
  unsubscribeThrowing();
});

test('mutation observation never consumes settlement or changes ACK eligibility', async () => {
  const store = createDurableTestStore();
  await store.outboxEnqueue({ id: 'cm-status-observed', function: 'createThing' });
  await store.outboxDurablyConsume('cm-status-observed', {
    version: 3,
    changed_count: 1,
    result: { observed: true },
    receipt: { kind: 'mutation', outcome: 'CONFIRMED' },
    authorityDescriptor: TEST_AUTHORITY_DESCRIPTOR,
  });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const recoveredBefore = await client.settledMutations();
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);

  assert.equal((await client.mutationStatus('cm-status-observed')).status, 'settled');
  const observed = [];
  const unsubscribe = client.subscribeMutation(
    'cm-status-observed',
    (disposition) => observed.push(disposition.status),
  );
  await new Promise((resolve) => setImmediate(resolve));
  unsubscribe();
  assert.deepEqual(observed, ['settled']);
  assert.deepEqual(await client.settledMutations(), recoveredBefore);
  assert.deepEqual(await store.outboxPendingAcknowledgements(null, 64), []);

  await client.markMutationSettlementsConsumed(['cm-status-observed']);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64, TEST_AUTHORITY_DESCRIPTOR),
    ['cm-status-observed'],
  );
});

test('outboxStatus and subscribeOutbox project the queue facts (LLP 0114 React-arm seam)', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // No outbox-capable store -> supported: false, never a guessed empty queue.
  const disabled = new SnapbackClient('http://127.0.0.1:9', { rqsStore: null });
  assert.deepEqual(
    { ...(await disabled.outboxStatus()) },
    {
      supported: false, pending: 0, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false,
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  const events = [];
  const unsubscribe = client.subscribeOutbox(() => events.push('event'));
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 0, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false,
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  // Queue two intents offline: each transition notifies subscribers.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const a = await client.mutate('createThing', { args: { n: 1 } });
  await client.mutate('createThing', { args: { n: 2 } });
  assert(events.length >= 2, 'queue transitions notified subscribers');
  const queuedStatus = await client.outboxStatus();
  const oldestPendingAtMs = Math.min(...(await store.outboxPending())
    .map((record) => record.enqueuedAt));
  assert.deepEqual(
    { ...queuedStatus },
    {
      supported: true, pending: 2, failed: 0, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false,
      oldestPendingAtMs, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
  );

  // Replay: first record refused (drop-and-mark-failed), second settles.
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        {
          diagnostic: { code: 'SNAPBACK_MUTATION_CONFLICT', message: 'conflict' },
          receipt: { kind: 'mutation', outcome: 'REJECTED', mutationId: a.clientMutationId },
        },
        { status: 409 },
      );
    }
    return Response.json({ result: { ok: true }, version: 3 });
  };
  const drained = events.length;
  const replayTask = client.replayQueuedMutations();
  assert.equal(
    (await client.outboxStatus()).replaying,
    true,
    'the single-flight drain is visible while it runs',
  );
  assert.equal((await client.outboxStatus()).drainPhase, 'replaying');
  await replayTask;
  assert(events.length > drained, 'replay transitions notified subscribers');
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    {
      supported: true, pending: 0, failed: 1, stranded: 0,
      quarantined: 0, resultGone: 0, replaying: false,
      oldestPendingAtMs: null, drainPhase: 'idle', lastAttemptAtMs: null, nextRetryAtMs: null,
      blockedReason: null,
    },
    'failed records stay visible; settled records leave the counts',
  );

  unsubscribe();
  const afterUnsubscribe = events.length;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await client.mutate('createThing', { args: { n: 3 } });
  assert.equal(events.length, afterUnsubscribe, 'unsubscribed listeners hear nothing');
});

console.log('snapback client outbox store tests pass');
