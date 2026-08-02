// LLP 0043 M2 outbox on the JS arm (LLP 0129 Phase 0) — unit obligations.
//
// Covers the three store arms' shared outbox contract (memory / file /
// IndexedDB), default-store resolution, and the client mutate/replay queue
// behavior over a stubbed fetch. The end-to-end diary-grade proof lives in
// demos/public-dashboard/tests/acceptance/offline-local-first.mjs.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { SnapbackClient } from './index.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';
import { createFileRqsResumeStore, RQS_FILE_STORE_FORMAT_V1 } from './rqs-store-file.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import { resolveDefaultRqsStore } from './rqs-store-default.mjs';
import {
  OUTBOX_MAX_PENDING_ACKS,
  emptyOutboxState,
  outboxOps,
} from './outbox-shared.mjs';

const originalFetch = globalThis.fetch;

// Immediate-grant Web Locks double (single context; enough for the outbox
// contract — ownership contention is rqs-store.test.mjs territory).
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

const createDurableTestStore = () => {
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  return store;
};

async function exerciseOutboxContract(store, { label }) {
  assert.equal(await store.outboxEmpty(), true, `${label}: starts empty`);
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
  const re = await store.outboxEnqueue({ id: 'cm-1', function: 'createThing' });
  assert.equal(re.sequence, 1, `${label}: re-enqueue returns the existing record`);
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
  // Explicit discard of the failed record; wipe clears everything.
  assert.equal(await store.outboxDiscard('cm-1'), true);
  await store.outboxEnqueue({ id: 'cm-3', function: 'createThing' });
  await store.wipe();
  assert.deepEqual(await store.outboxPending(), [], `${label}: wipe clears the queue`);
}

test('memory arm carries the outbox contract', async () => {
  const store = createMemoryRqsResumeStore();
  await exerciseOutboxContract(store, { label: 'memory' });
  assert.deepEqual(store.durability(), { implementation: 'memory', durable: false });
  await store.close();
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
  await assert.rejects(() => client.mutate('createThing', { args: {} }), TypeError);
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
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // Offline: fetch refuses at the transport (TypeError, like undici).
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate('createThing', { args: { title: 'offline' } });
  assert.equal(queued.queued, true);
  assert.match(queued.clientMutationId, /^cm/);
  assert.equal(queued.sequence, 1);
  const queuedUpdate = await client.mutate('updateThing', { args: { title: 'later' } });
  assert.equal(queuedUpdate.sequence, 2);
  assert.equal((await store.outboxPending()).length, 2);

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
    return Response.json({ result: { ok: true }, version: 7 });
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
  // Settled ids became ACK obligations; the next mutation piggybacks them.
  const acks = await store.outboxPendingAcknowledgements(null, 64);
  assert.deepEqual(
    [...acks].sort(),
    [queued.clientMutationId, queuedUpdate.clientMutationId].sort(),
  );
  delivered.length = 0;
  await client.mutate('createThing', { args: { title: 'online' } });
  assert.deepEqual(
    [...(delivered[0].acknowledgedClientMutationIds ?? [])].sort(),
    [...acks].sort(),
    'next mutation carries the exactly-once ledger GC piggyback',
  );
  assert.deepEqual(
    await store.outboxPendingAcknowledgements(null, 64),
    [],
    'a successful response confirms the sent acknowledgements',
  );
});

test('explicit-id online publication is durable before delivery and retires only after ACK', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
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

  releaseResponse(Response.json({ result: { id: 'thing_1' }, version: 4 }));
  const result = await delivery;
  assert.deepEqual(result.result, { id: 'thing_1' });
  const retained = (await store.outboxRecords()).find(
    (record) => record.id === 'cm-online-durable',
  );
  assert.equal(retained.status, 'settled');
  assert.deepEqual(retained.settlement.result, { id: 'thing_1' });
  assert.deepEqual(await store.outboxPendingAcknowledgements(null), ['cm-online-durable']);

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
    TypeError,
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
  assert.match(queued.clientMutationId, /^cm/);
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
    (error) => error?.name === 'AbortError',
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

test('outboxStatus and subscribeOutbox project the queue facts (LLP 0114 React-arm seam)', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createDurableTestStore();
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });

  // No outbox-capable store -> supported: false, never a guessed empty queue.
  const disabled = new SnapbackClient('http://127.0.0.1:9', { rqsStore: null });
  assert.deepEqual(
    { ...(await disabled.outboxStatus()) },
    { supported: false, pending: 0, failed: 0, replaying: false },
  );

  const events = [];
  const unsubscribe = client.subscribeOutbox(() => events.push('event'));
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    { supported: true, pending: 0, failed: 0, replaying: false },
  );

  // Queue two intents offline: each transition notifies subscribers.
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const a = await client.mutate('createThing', { args: { n: 1 } });
  await client.mutate('createThing', { args: { n: 2 } });
  assert(events.length >= 2, 'queue transitions notified subscribers');
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    { supported: true, pending: 2, failed: 0, replaying: false },
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
  await replayTask;
  assert(events.length > drained, 'replay transitions notified subscribers');
  assert.deepEqual(
    { ...(await client.outboxStatus()) },
    { supported: true, pending: 0, failed: 1, replaying: false },
    'failed records stay visible; settled records leave the counts',
  );

  unsubscribe();
  const afterUnsubscribe = events.length;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  await client.mutate('createThing', { args: { n: 3 } });
  assert.equal(events.length, afterUnsubscribe, 'unsubscribed listeners hear nothing');
});

console.log('snapback client outbox store tests pass');
