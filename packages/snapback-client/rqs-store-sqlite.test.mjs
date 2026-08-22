import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';

import { createNodeSqliteNamespace } from '../../demos/expo-local-first-carrier/node-sqlite-adapter.mjs';
import { createSqliteRqsResumeStore } from './rqs-store-sqlite.mjs';

const roots = [];
const root = async () => {
  const value = await mkdtemp(join(tmpdir(), 'snapback-sqlite-store-test-'));
  roots.push(value);
  return value;
};
after(async () => Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true }))));

const open = async (directory, options = {}) => createSqliteRqsResumeStore({
  sqlite: createNodeSqliteNamespace(directory),
  databaseName: 'rqs.sqlite',
  ...options,
});

test('SQLite carrier owns one WAL connection and verifies its durability profile', async () => {
  const store = await open(await root());
  const facts = store.qualificationFacts();
  assert.equal(facts.profile, 'durable-fragments-v1');
  assert.deepEqual(facts.pragmas, {
    lockingMode: 'exclusive',
    journalMode: 'wal',
    synchronous: 2,
    foreignKeys: 1,
    fullfsync: null,
  });
  assert.match(facts.sqliteSourceId, /^\d{4}-/u);
  assert.deepEqual(store.durability(), { implementation: 'expo-sqlite', durable: true });
  await store.close();
});

test('SQLite entries, recency, eviction, and identity metadata survive reopen', async () => {
  const directory = await root();
  let clock = 10;
  const store = await open(directory, { now: () => ++clock, maxEntries: 2 });
  const meta = await store.readStoreMeta();
  assert.equal(await store.allocateQueryInstanceId(), 1);
  for (const key of ['a', 'b', 'c']) {
    assert.equal((await store.commit(key, { rows: [{ key }], meta: { key }, token: key })).persisted, true);
  }
  assert.equal(await store.load('a'), null);
  assert.deepEqual((await store.load('c')).rows, [{ key: 'c' }]);
  await store.markInProgress('c');
  await store.close();
  const reopened = await open(directory);
  assert.equal((await reopened.load('c')).inProgress, true);
  assert.equal((await reopened.readStoreMeta()).clientStoreId, meta.clientStoreId);
  assert.equal(await reopened.allocateQueryInstanceId(), 2);
  await reopened.close();
});

test('materializations, outbox settlement, ACK custody, and authority wipe share one domain', async () => {
  const store = await open(await root());
  await store.materializationTransaction('readwrite', (view) => {
    view.materializations.set('m', { generation: 1 });
    view.pageSets.set('p', { page: 1 });
    view.memberships.set('x', { member: true });
  });
  await store.outboxEnqueue({ id: 'mutation-1', function: 'createThing', args: { value: 1 } });
  await store.outboxDurablyConsume('mutation-1', { result: { ok: true } }, 'user-1');
  await store.outboxMarkAcknowledgementsReady(['mutation-1']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user-1'), ['mutation-1']);
  const before = await store.readStoreMeta();
  assert.equal(await store.wipeForAuthorityTransition(), true);
  const after = await store.readStoreMeta();
  assert.equal(after.clientStoreId, before.clientStoreId);
  assert.notEqual(after.handleKey, before.handleKey);
  assert.equal((await store.outboxRecords()).length, 1, 'authority wipe preserves settlement custody');
  const sections = await store.materializationTransaction('readonly', (view) => ({
    materializations: view.materializations.size,
    pageSets: view.pageSets.size,
    memberships: view.memberships.size,
  }));
  assert.deepEqual(sections, { materializations: 0, pageSets: 0, memberships: 0 });
  await store.close();
});

test('SQLite authority wipe advances the outbox generation and fences stale enqueue/reconcile', async () => {
  const store = await open(await root());
  const predecessor = await store.outboxAuthorizationStatus();
  await store.outboxEnqueue({
    id: 'sqlite-predecessor',
    function: 'saveIntent',
    args: { value: 1 },
  }, predecessor);
  assert.equal(await store.wipeForAuthorityTransition('sessions:0->1', 1), true);
  const successor = await store.outboxAuthorizationStatus();
  assert.equal(successor.authorityGeneration, predecessor.authorityGeneration + 1);
  assert.equal(successor.generation, predecessor.generation + 1);
  await assert.rejects(
    store.outboxEnqueue({ id: 'sqlite-stale', function: 'saveIntent' }, predecessor),
    (error) => error?.code === 'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
  );
  await assert.rejects(
    store.outboxReconcileCustody(
      {
        authMode: 'sessions',
        authorizationStreamIncarnation: 'sqlite-stream',
        userId: 'sqlite-user',
      },
      {
        descriptorVersion: 1,
        authorityInstanceId: 'sqlite-authority',
        sessionGeneration: 1,
      },
      { authorityEpoch: 1, authorityKey: 'sqlite-key' },
      predecessor.authorityGeneration,
    ),
    (error) => error?.code === 'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
  );
  assert.equal(
    await store.wipeForAuthorityTransition('sessions:0->1', 1),
    true,
    'the same keyed transition is idempotent',
  );
  assert.deepEqual(await store.outboxAuthorizationStatus(), successor);
  await store.close();
});

test('SQLite dispatch gate admits foreground beside housekeeping and keeps authority cuts exclusive', async () => {
  const store = await open(await root());
  let enterHousekeeping;
  let releaseHousekeeping;
  const housekeepingEntered = new Promise((resolve) => { enterHousekeeping = resolve; });
  const housekeepingHeld = new Promise((resolve) => { releaseHousekeeping = resolve; });
  const housekeeping = store.withOutboxAuthorizationDispatch(async () => {
    enterHousekeeping();
    await housekeepingHeld;
  }, { lane: 'housekeeping' });
  await housekeepingEntered;
  let foregroundEntered = false;
  await store.withOutboxAuthorizationDispatch(async () => {
    foregroundEntered = true;
  }, { lane: 'foreground' });
  assert.equal(foregroundEntered, true);
  let exclusiveEntered = false;
  const exclusive = store.withOutboxAuthorizationDispatch(async () => {
    exclusiveEntered = true;
  });
  await Promise.resolve();
  assert.equal(exclusiveEntered, false);
  releaseHousekeeping();
  await housekeeping;
  await exclusive;
  assert.equal(exclusiveEntered, true);
  await store.close();
});

test('materialization callbacks are synchronous and non-reentrant', async () => {
  const store = await open(await root());
  await assert.rejects(
    store.materializationTransaction('readwrite', async () => {}),
    /callbacks must be synchronous/u,
  );
  await assert.rejects(
    store.materializationTransaction('readwrite', () => store.readStoreMeta()),
    (error) => error?.code === 'SNAPBACK_EXPO_SQLITE_TRANSACTION_REENTRANT',
  );
  await store.close();
});

test('a second process-equivalent connection refuses while the owner lives and takes over after close', async () => {
  const directory = await root();
  const owner = await open(directory);
  await assert.rejects(
    open(directory),
    (error) => error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE',
  );
  await owner.close();
  const successor = await open(directory);
  assert.equal(successor.isWriter(), true);
  await successor.close();
});

test('faults after transaction statements roll back to the prior whole state', async () => {
  const directory = await root();
  let armed = false;
  const store = await open(directory, {
    faultInjector(boundary) {
      if (armed && boundary === 'write:entries:k') throw new Error('injected-cut');
    },
  });
  await store.commit('k', { rows: [{ generation: 1 }], meta: {}, token: 'one' });
  armed = true;
  await assert.rejects(
    store.commit('k', { rows: [{ generation: 2 }], meta: {}, token: 'two' }),
    /injected-cut/u,
  );
  armed = false;
  assert.deepEqual((await store.load('k')).rows, [{ generation: 1 }]);
  await store.close();
});

test('bad row digests and future schema fail closed without replacing bytes', async () => {
  for (const kind of ['digest', 'future']) {
    const directory = await root();
    const path = join(directory, 'rqs.sqlite');
    const store = await open(directory);
    await store.commit('k', { rows: [{ generation: 1 }], meta: {}, token: 'one' });
    await store.close();
    const raw = new DatabaseSync(path);
    if (kind === 'digest') raw.exec("UPDATE entries SET content_digest = 'sha256:bad' WHERE record_key = 'k'");
    else raw.exec('PRAGMA user_version=99');
    raw.close();
    await assert.rejects(
      open(directory),
      (error) => error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT',
      kind,
    );
  }
});

test('version-one schema validation refuses a missing durable table before repair', async () => {
  const directory = await root();
  const path = join(directory, 'rqs.sqlite');
  const store = await open(directory);
  await store.commit('preserved', { rows: [{ generation: 1 }], meta: {}, token: 'one' });
  await store.close();
  const raw = new DatabaseSync(path);
  raw.exec('DROP TABLE memberships');
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  raw.close();
  const before = await readFile(path);
  await assert.rejects(
    open(directory),
    (error) => error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT',
  );
  assert.deepEqual(await readFile(path), before, 'corrupt v1 database bytes were preserved');
  const inspection = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    inspection.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='table' AND name='memberships'").get().count,
    0,
    'boot did not recreate the missing durable table',
  );
  inspection.close();
});

test('predecessor fences reject identity reuse and persist confirmed deletion', async () => {
  const store = await open(await root());
  const meta = await store.readStoreMeta();
  const fence = await store.recordPredecessorFence({
    predecessorClientStoreId: 'cs1_predecessor',
    predecessorHandleKey: 'ab'.repeat(32),
    pathIdentity: '/legacy/rqs.json',
  });
  assert.equal(fence.disposition, 'discard-and-refetch');
  assert.equal(fence.pendingDelete, true);
  assert.equal(await store.confirmPredecessorAbsent('cs1_predecessor', '/legacy/rqs.json'), true);
  assert.equal((await store.predecessorFences())[0].pendingDelete, false);
  await assert.rejects(
    store.recordPredecessorFence({
      predecessorClientStoreId: meta.clientStoreId,
      predecessorHandleKey: 'cd'.repeat(32),
      pathIdentity: '/legacy/reused.json',
    }),
    (error) => error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT',
  );
  await store.close();
});
