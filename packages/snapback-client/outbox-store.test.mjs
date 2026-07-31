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

const originalFetch = globalThis.fetch;

// Immediate-grant Web Locks double (single context; enough for the outbox
// contract — ownership contention is rqs-store.test.mjs territory).
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
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
  // Settle removes; ACK obligations are per-identity.
  assert.equal(await store.outboxSettle('cm-2'), true);
  // A failed record is terminal (never replayed), so it does not block the
  // LLP 0090 resume rule — but it stays visible in outboxRecords().
  assert.equal(await store.outboxEmpty(), true, `${label}: only failed records left -> empty for resume`);
  assert.deepEqual((await store.outboxPending()), []);
  await store.outboxRecordAcknowledgement('cm-2', 'user_a');
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), ['cm-2']);
  assert.deepEqual(
    await store.outboxPendingAcknowledgements('user_b', 64),
    [],
    `${label}: another identity never sends this one's ACKs`,
  );
  await store.outboxConfirmAcknowledgements(['cm-2']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user_a', 64), []);
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

test('mutate queues on connectivity failure and replays exactly-once', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore();
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

test('replay drop-and-mark-failed on server refusal, pending kept on connectivity', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore();
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

console.log('snapback client outbox store tests pass');
