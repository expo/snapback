// LLP 0166 L1 format-v3 acceptance: migration preservation, crash cuts,
// version skew, exact wipe projection, monotone allocation, and corrupt-store
// identity rotation across the shipped carrier family.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { emptyOutboxState, outboxOps } from './outbox-shared.mjs';
import {
  RQS_FILE_STORE_FORMAT,
  RQS_FILE_STORE_FORMAT_V2,
  createFileRqsResumeStore,
  createNodeFilesAdapter,
} from './rqs-store-file.mjs';
import {
  createMemoryRqsResumeStore,
  createMemoryRqsStoreBacking,
} from './rqs-store-memory.mjs';
import {
  DATABASE_VERSION,
  createIndexedDbRqsResumeStore,
} from './rqs-store.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
  transaction.onerror = () => {};
});

const openDatabase = (indexedDB, name, version, upgrade = null) => new Promise((resolve, reject) => {
  const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
  request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const fixtureOutbox = () => {
  let state = emptyOutboxState();
  state = outboxOps.enqueue(state, { id: 'pending-intent', function: 'createThing' }, 101).state;
  state = outboxOps.enqueue(state, { id: 'settled-intent', function: 'updateThing' }, 102).state;
  state = outboxOps.durablyConsume(
    state,
    'settled-intent',
    { result: { ok: true }, version: 7 },
    'user-1',
    103,
  ).state;
  return state;
};

const predecessorDeleteOutbox = () => {
  const principalScope = {
    authMode: 'sessions',
    authorizationStreamIncarnation: '018f0d90-7b31-7a22-8c33-445566778899',
    userId: '018f0d90-7b32-7a22-8c33-445566778899',
  };
  let payloadState = emptyOutboxState();
  payloadState = outboxOps.enqueue(payloadState, {
    id: 'predecessor-quarantined',
    function: 'createSecret',
    args: { secret: 'quarantined-predecessor-secret' },
  }, 101).state;
  payloadState = outboxOps.markQuarantined(
    payloadState,
    'predecessor-quarantined',
    { code: 'SNAPBACK_UPGRADE_REQUIRED' },
    102,
  ).state;
  payloadState = outboxOps.enqueue(payloadState, {
    id: 'predecessor-stranded',
    function: 'updateSecret',
    args: { secret: 'stranded-predecessor-secret' },
  }, 103).state;
  payloadState = outboxOps.markStranded(
    payloadState,
    'predecessor-stranded',
    'authority_instance_changed',
    104,
    principalScope,
  ).state;
  const obligation = {
    protocolVersion: 1,
    scopeId: {
      kind: 'clientQuery',
      namespace: {
        clientStoreId: 'predecessor-delete-store',
        queryKey: 'secrets:{}',
        queryInstanceId: 1,
      },
    },
    revision: 1,
    maxDisposition: 'delete',
    witness: {
      authorization: {
        incarnation: '018f0d90-7b33-7a22-8c33-445566778899',
        epoch: 1,
      },
      data: null,
    },
    retryEpisodeId: null,
  };
  const rooted = outboxOps.applyAuthorizationObligation(
    emptyOutboxState(),
    obligation,
  ).state;
  const records = structuredClone(payloadState.records);
  for (const record of Object.values(records)) {
    delete record.authorizationAuthorityGeneration;
    delete record.authorizationQueueGeneration;
  }
  return {
    obligation,
    state: {
      ...rooted,
      sequence: payloadState.sequence,
      records,
    },
  };
};

const fixtureEntry = Object.freeze({
  rows: [{ _id: 'r1', payload: 'legacy' }],
  meta: { opaque: 'legacy-bytes' },
  token: 'legacy-token',
  bytes: 41,
  savedAt: 100,
  resumedAt: 90,
  inProgress: false,
});

const fixtureReceipt = Object.freeze({
  binding: 'todos:list',
  authorityMode: 'anonymous',
  nested: { revision: 7 },
});

const populatedMeta = (meta) => ({
  ...meta,
  generationCounters: {
    writerGeneration: 9,
    authorityGenerationHighWater: 7,
    queryGenerationHighWater: 8,
  },
  durableRegistrations: { registration: { source: 'programmatic' } },
  policyBudgetFacts: { materializationBytes: 123 },
  brokerRoster: { context: { revision: 4 } },
  fenceHighWaters: { qmk: 11 },
  tombstoneHighWaters: { qmk: 12 },
  barrierHighWaters: { authority: 13 },
});

const assertWipedMeta = (before, after) => {
  assert.equal(after.clientStoreId, before.clientStoreId);
  assert.equal(after.formatVersion, 3);
  assert.equal(after.queryInstanceIdHighWater, before.queryInstanceIdHighWater);
  assert.deepEqual(after.generationCounters, before.generationCounters);
  assert.deepEqual(after.fenceHighWaters, before.fenceHighWaters);
  assert.deepEqual(after.tombstoneHighWaters, before.tombstoneHighWaters);
  assert.deepEqual(after.barrierHighWaters, before.barrierHighWaters);
  assert.deepEqual(after.durableRegistrations, {});
  assert.deepEqual(after.policyBudgetFacts, {});
  assert.deepEqual(after.brokerRoster, {});
  assert.notEqual(after.handleKey, before.handleKey);
};

test('IndexedDB v2 -> v3 adds the four stores and preserves entries/outbox/receipt byte-exact', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'rqs-v2-migration';
  const legacy = await openDatabase(indexedDB, databaseName, 2, (db) => {
    db.createObjectStore('entries');
    db.createObjectStore('outbox');
  });
  const legacyTx = legacy.transaction(['entries', 'outbox'], 'readwrite');
  legacyTx.objectStore('entries').put(structuredClone(fixtureEntry), 'legacy-key');
  const expectedOutbox = fixtureOutbox();
  legacyTx.objectStore('outbox').put(expectedOutbox, 'state');
  legacyTx.objectStore('outbox').put(structuredClone(fixtureReceipt), 'reactBindingReceipt');
  await transactionDone(legacyTx);
  legacy.close();

  const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager: grantingLocks, databaseName });
  await tick();
  const meta = await store.readStoreMeta();
  assert.equal(meta.formatVersion, 3);

  const upgraded = await openDatabase(indexedDB, databaseName);
  assert.equal(upgraded.version, DATABASE_VERSION);
  assert.deepEqual(
    [...upgraded.objectStoreNames],
    ['entries', 'materializations', 'memberships', 'outbox', 'pageSets', 'storeMeta'],
  );
  const tx = upgraded.transaction(['entries', 'outbox'], 'readonly');
  assert.deepEqual(await requestResult(tx.objectStore('entries').get('legacy-key')), fixtureEntry);
  assert.deepEqual(await requestResult(tx.objectStore('outbox').get('state')), expectedOutbox);
  assert.deepEqual(
    await requestResult(tx.objectStore('outbox').get('reactBindingReceipt')),
    fixtureReceipt,
  );
  await transactionDone(tx);
  upgraded.close();
  await store.close();
});

test('IndexedDB older-client open against v3 fails closed with VersionError and leaves v3 intact', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'rqs-v3-skew';
  const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager: grantingLocks, databaseName });
  await tick();
  await store.readStoreMeta();
  await store.close();

  await assert.rejects(
    openDatabase(indexedDB, databaseName, 2),
    (error) => error?.name === 'VersionError',
  );
  const intact = await openDatabase(indexedDB, databaseName);
  assert.equal(intact.version, 3);
  assert.equal(intact.objectStoreNames.contains('storeMeta'), true);
  intact.close();
});

test('IndexedDB wipe clears five resident stores, preserves high-waters, rotates handle key, and allocator stays monotone', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'rqs-v3-wipe';
  const store = createIndexedDbRqsResumeStore({ indexedDB, lockManager: grantingLocks, databaseName });
  await tick();
  assert.equal(await store.allocateQueryInstanceId(), 1);
  assert.equal(await store.allocateQueryInstanceId(), 2);
  await store.writeStoreMeta(populatedMeta(await store.readStoreMeta()));

  const db = await openDatabase(indexedDB, databaseName);
  const seed = db.transaction(
    ['materializations', 'pageSets', 'memberships', 'entries', 'outbox'],
    'readwrite',
  );
  for (const name of ['materializations', 'pageSets', 'memberships', 'entries']) {
    seed.objectStore(name).put({ occupied: name }, 'key');
  }
  seed.objectStore('outbox').put(fixtureOutbox(), 'state');
  seed.objectStore('outbox').put(fixtureReceipt, 'reactBindingReceipt');
  await transactionDone(seed);
  db.close();

  const before = await store.readStoreMeta();
  assert.equal(await store.wipe(), true);
  const after = await store.readStoreMeta();
  assertWipedMeta(before, after);
  assert.equal(await store.allocateQueryInstanceId(), 3);

  const checkDb = await openDatabase(indexedDB, databaseName);
  const check = checkDb.transaction(
    ['materializations', 'pageSets', 'memberships', 'entries', 'outbox'],
    'readonly',
  );
  for (const name of ['materializations', 'pageSets', 'memberships', 'entries', 'outbox']) {
    assert.equal(await requestResult(check.objectStore(name).count()), 0, `${name} cleared`);
  }
  await transactionDone(check);
  checkDb.close();
  await store.close();
});

test('IndexedDB unreadable metadata resets only through identity rotation', async () => {
  const indexedDB = new IDBFactory();
  const databaseName = 'rqs-v3-corrupt-reset';
  const malformed = await openDatabase(indexedDB, databaseName, 3, (db) => {
    for (const name of [
      'entries', 'outbox', 'materializations', 'pageSets', 'memberships', 'storeMeta',
    ]) db.createObjectStore(name);
  });
  malformed.close();
  let randomValue = 0;
  const randomBytes = (length) => new Uint8Array(length).fill(++randomValue);
  let hookCalled = false;
  const store = createIndexedDbRqsResumeStore({
    indexedDB,
    lockManager: grantingLocks,
    databaseName,
    clientStoreId: 'indexeddb-predecessor',
    randomBytes,
    onBeforeStoreIdentityRotation: ({ previousClientStoreId, nextClientStoreId }) => {
      assert.equal(previousClientStoreId, 'indexeddb-predecessor');
      assert.notEqual(nextClientStoreId, previousClientStoreId);
      hookCalled = true;
    },
  });
  await tick();
  await assert.rejects(store.readStoreMeta(), (error) => error.code === 'SNAPBACK_RQS_STORE_CORRUPT');
  const reset = await store.resetCorruptStoreIdentity();
  assert.equal(reset.reset, true);
  assert.equal(hookCalled, true);
  const meta = await store.readStoreMeta();
  assert.equal(meta.clientStoreId, reset.clientStoreId);
  assert.equal(meta.queryInstanceIdHighWater, 0);
  assert.equal(meta.handleKey, '03'.repeat(32));
  await store.close();
});

test('file v2 -> v3 preserves entries, pending intent, acknowledgements, and receipt exactly', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-v3-migrate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blobPath = join(directory, 'rqs-anonymous.v1.json');
  const expectedOutbox = fixtureOutbox();
  const v2 = {
    format: RQS_FILE_STORE_FORMAT_V2,
    entries: { 'legacy-key': fixtureEntry },
    outbox: expectedOutbox,
    reactBindingReceipt: fixtureReceipt,
  };
  await writeFile(blobPath, JSON.stringify(v2));

  const store = createFileRqsResumeStore({ directory, clientStoreId: 'legacy-store' });
  await store.whenLockSettled();
  const upgraded = JSON.parse(await readFile(blobPath, 'utf8'));
  assert.equal(upgraded.format, RQS_FILE_STORE_FORMAT);
  assert.equal(JSON.stringify(upgraded.entries), JSON.stringify(v2.entries));
  assert.equal(JSON.stringify(upgraded.outbox), JSON.stringify(v2.outbox));
  assert.equal(
    JSON.stringify(upgraded.reactBindingReceipt),
    JSON.stringify(v2.reactBindingReceipt),
  );
  assert.deepEqual(upgraded.materializations, {});
  assert.deepEqual(upgraded.pageSets, {});
  assert.deepEqual(upgraded.memberships, {});
  assert.equal(upgraded.storeMeta.formatVersion, 3);
  await store.close();
});

test('file upgrade redacts predecessor delete custody before proof and re-entry', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-delete-upgrade-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blobPath = join(directory, 'rqs-anonymous.v1.json');
  const predecessor = predecessorDeleteOutbox();
  await writeFile(blobPath, JSON.stringify({
    format: RQS_FILE_STORE_FORMAT_V2,
    entries: {},
    outbox: predecessor.state,
    reactBindingReceipt: null,
  }));

  const store = createFileRqsResumeStore({
    directory,
    clientStoreId: 'predecessor-delete-store',
  });
  await store.whenLockSettled();
  const upgraded = await store.outboxRecords();
  assert.deepEqual(upgraded.map((record) => record.id), [
    'predecessor-quarantined',
    'predecessor-stranded',
  ]);
  for (const record of upgraded) {
    assert.equal(record.status, 'stranded');
    assert.equal(record.disposition, 'delete');
    assert.equal(record.discardOnly, true);
    assert.equal(record.rerecordable, false);
    assert.equal(record.replayable, false);
    assert.equal(Object.hasOwn(record, 'args'), false);
    assert.equal(Object.hasOwn(record, 'quarantine'), false);
    assert.equal(Object.hasOwn(record, 'predecessorPrincipalScope'), false);
  }
  const persistedUpgrade = await readFile(blobPath, 'utf8');
  assert.equal(persistedUpgrade.includes('quarantined-predecessor-secret'), false);
  assert.equal(persistedUpgrade.includes('stranded-predecessor-secret'), false);

  await store.outboxResolveAuthorizationObligation({
    protocolVersion: 1,
    kind: 'snapshot',
    scopeId: predecessor.obligation.scopeId,
    revision: predecessor.obligation.revision,
    witness: predecessor.obligation.witness,
    maxDisposition: 'delete',
    ackToken: 'predecessor-delete-proof',
  });
  assert.deepEqual(await store.outboxReenterQuarantined(), {
    count: 0,
    clientMutationIds: [],
  });
  assert.deepEqual(await store.outboxPending(), []);
  for (const record of await store.outboxRecords()) {
    assert.equal(record.disposition, 'delete');
    assert.equal(Object.hasOwn(record, 'args'), false);
  }
  await store.close();
});

test('file migration crash cuts leave the prior or successor blob, never a hybrid', async (t) => {
  for (const boundary of ['temp-write', 'rename', 'directory-sync']) {
    const directory = await mkdtemp(join(tmpdir(), `snapback-rqs-v3-${boundary}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const blobPath = join(directory, 'rqs-anonymous.v1.json');
    const v2 = {
      format: RQS_FILE_STORE_FORMAT_V2,
      entries: { legacy: fixtureEntry },
      outbox: fixtureOutbox(),
      reactBindingReceipt: fixtureReceipt,
    };
    await writeFile(blobPath, JSON.stringify(v2));
    const base = createNodeFilesAdapter();
    let injected = false;
    const crash = () => {
      injected = true;
      throw Object.assign(new Error(`crash after ${boundary}`), { code: 'TEST_CRASH' });
    };
    const files = {
      ...base,
      async writeFile(path, data) {
        await base.writeFile(path, data);
        if (!injected && boundary === 'temp-write' && path.includes('.json.tmp-')) crash();
      },
      async rename(from, to) {
        await base.rename(from, to);
        if (!injected && boundary === 'rename') crash();
      },
      async syncDirectory(path) {
        await base.syncDirectory(path);
        if (!injected && boundary === 'directory-sync') crash();
      },
    };
    const store = createFileRqsResumeStore({ directory, files, clientStoreId: 'crash-store' });
    await store.whenLockSettled();
    assert.equal(injected, true, `${boundary} was exercised`);
    const surviving = JSON.parse(await readFile(blobPath, 'utf8'));
    assert.equal(
      [RQS_FILE_STORE_FORMAT_V2, RQS_FILE_STORE_FORMAT].includes(surviving.format),
      true,
    );
    if (surviving.format === RQS_FILE_STORE_FORMAT_V2) {
      assert.deepEqual(surviving, v2, 'prior blob survives exactly');
    } else {
      assert.deepEqual(surviving.entries, v2.entries);
      assert.deepEqual(surviving.outbox, v2.outbox);
      assert.deepEqual(surviving.reactBindingReceipt, v2.reactBindingReceipt);
      assert.deepEqual(surviving.materializations, {});
      assert.deepEqual(surviving.pageSets, {});
      assert.deepEqual(surviving.memberships, {});
    }
    await store.close();
  }
});

test('file wipe has the exact v3 projection and allocator remains monotone across it', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-v3-wipe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store = createFileRqsResumeStore({ directory, clientStoreId: 'file-store' });
  await store.whenLockSettled();
  assert.equal(await store.allocateQueryInstanceId(), 1);
  await store.writeStoreMeta(populatedMeta(await store.readStoreMeta()));
  await store.outboxEnqueue({ id: 'pending-file', function: 'writeThing' });
  await store.commitReactBindingReceipt(fixtureReceipt);
  await store.close();

  const blobName = (await readdir(directory)).find((name) => name.endsWith('.v1.json'));
  const blobPath = join(directory, blobName);
  const seeded = JSON.parse(await readFile(blobPath, 'utf8'));
  seeded.entries.legacy = fixtureEntry;
  seeded.materializations.m = { occupied: true };
  seeded.pageSets.p = { occupied: true };
  seeded.memberships.x = { occupied: true };
  await writeFile(blobPath, JSON.stringify(seeded));

  store = createFileRqsResumeStore({ directory, clientStoreId: 'file-store' });
  await store.whenLockSettled();
  const before = await store.readStoreMeta();
  assert.equal(await store.wipe(), true);
  const after = await store.readStoreMeta();
  assertWipedMeta(before, after);
  assert.equal(await store.allocateQueryInstanceId(), 2);
  const wiped = JSON.parse(await readFile(blobPath, 'utf8'));
  assert.deepEqual(wiped.entries, {});
  assert.deepEqual(wiped.outbox, emptyOutboxState());
  assert.equal(wiped.reactBindingReceipt, undefined);
  assert.deepEqual(wiped.materializations, {});
  assert.deepEqual(wiped.pageSets, {});
  assert.deepEqual(wiped.memberships, {});
  await store.close();
});

test('memory carrier mirrors v3 sections with durable false and exact wipe survivals', async () => {
  const backing = createMemoryRqsStoreBacking({ clientStoreId: 'memory-store' });
  const store = createMemoryRqsResumeStore({ backing });
  assert.deepEqual(store.durability(), { implementation: 'memory', durable: false });
  assert.deepEqual(
    await store.resetCorruptStoreIdentity(),
    { reset: false, reason: 'not_corrupt' },
    'destructive reset is not a second ordinary wipe surface',
  );
  assert.equal(await store.allocateQueryInstanceId(), 1);
  await store.writeStoreMeta(populatedMeta(await store.readStoreMeta()));
  backing.entries.set('legacy', fixtureEntry);
  backing.outbox = fixtureOutbox();
  backing.reactBindingReceipt = fixtureReceipt;
  backing.materializations.set('m', { occupied: true });
  backing.pageSets.set('p', { occupied: true });
  backing.memberships.set('x', { occupied: true });
  const before = await store.readStoreMeta();
  assert.equal(await store.wipe(), true);
  assertWipedMeta(before, await store.readStoreMeta());
  assert.equal(await store.allocateQueryInstanceId(), 2);
  assert.equal(backing.entries.size, 0);
  assert.deepEqual(backing.outbox, emptyOutboxState());
  assert.equal(backing.reactBindingReceipt, null);
  assert.equal(backing.materializations.size, 0);
  assert.equal(backing.pageSets.size, 0);
  assert.equal(backing.memberships.size, 0);
  await store.close();
});

test('unparseable file reset preserves evidence until authorization, then rotates store identity', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-v3-reset-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const blobPath = join(directory, 'rqs-anonymous.v1.json');
  const corruptBytes = '{ unparseable predecessor bytes';
  await writeFile(blobPath, corruptBytes);
  let randomValue = 0;
  const randomBytes = (length) => new Uint8Array(length).fill(++randomValue);
  let hookSawPredecessor = false;
  const store = createFileRqsResumeStore({
    directory,
    clientStoreId: 'corrupt-store',
    randomBytes,
    onBeforeStoreIdentityRotation: async ({ previousClientStoreId, nextClientStoreId }) => {
      assert.equal(previousClientStoreId, 'corrupt-store');
      assert.notEqual(nextClientStoreId, previousClientStoreId);
      hookSawPredecessor = (await readFile(blobPath, 'utf8')) === corruptBytes;
    },
  });
  await store.whenLockSettled();
  await assert.rejects(store.readStoreMeta(), (error) => error.code === 'SNAPBACK_RQS_STORE_CORRUPT');
  assert.equal(await store.wipe(), false, 'ordinary wipe cannot invent unreadable survivals');
  assert.equal(await readFile(blobPath, 'utf8'), corruptBytes);

  const rotated = await store.resetCorruptStoreIdentity();
  assert.equal(rotated.reset, true);
  assert.equal(rotated.previousClientStoreId, 'corrupt-store');
  assert.equal(hookSawPredecessor, true, 'LLP 0059 hook ran before destruction');
  const meta = await store.readStoreMeta();
  assert.equal(meta.clientStoreId, rotated.clientStoreId);
  assert.equal(meta.queryInstanceIdHighWater, 0);
  assert.equal(meta.formatVersion, 3);
  assert.equal(meta.handleKey, '02'.repeat(32));
  const replacement = JSON.parse(await readFile(blobPath, 'utf8'));
  assert.equal(replacement.format, RQS_FILE_STORE_FORMAT);
  assert.deepEqual(replacement.entries, {});
  assert.equal((await readFile(blobPath, 'utf8')).includes(corruptBytes), false);
  await store.close();
});
