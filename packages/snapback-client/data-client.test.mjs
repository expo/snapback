import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { createDataClient } from './data-client.mjs';
import { emptyOutboxState, outboxOps, pendingOutboxRecords } from './outbox-shared.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';

const generation = Object.freeze({
  schemaVersion: 'snapback.v0',
  appId: 'data-test',
  schemaHash: `sha256:${'a'.repeat(64)}`,
  bundleHash: `sha256:${'b'.repeat(64)}`,
  inputsHash: `sha256:${'c'.repeat(64)}`,
});

const argsContract = (fields) => ({
  fields: fields.map(([name, kind]) => ({
    name,
    required: true,
    value: kind === 'id' ? { kind: 'id', table: 'todos' } : { kind },
  })),
});

const createRef = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Mutation',
  id: 'data-test:todos.create',
  name: 'todos.create',
  expectedGeneration: generation,
  argsContract: argsContract([['title', 'string']]),
});
const updateRef = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'Mutation',
  id: 'data-test:todos.update',
  name: 'todos.update',
  expectedGeneration: generation,
  argsContract: argsContract([['id', 'id'], ['title', 'string']]),
});
const queryRef = Object.freeze({
  artifactKind: 'functionReference',
  kind: 'LiveQuery',
  id: 'data-test:data.q_eeeeeeeeeeeeeeee',
  name: 'data.q_eeeeeeeeeeeeeeee',
  expectedGeneration: generation,
  argsContract: argsContract([['status', 'string']]),
});
const queryCatalogEntry = Object.freeze({
  normalizedDataQueryId: `sha256:${'e'.repeat(64)}`,
  resolution: Object.freeze({
    kind: 'synthesized-generated',
    exportedName: 'data.q_eeeeeeeeeeeeeeee',
  }),
  functionReference: queryRef,
});
const queryDescriptor = Object.freeze({
  artifactKind: 'dataQuery',
  schemaVersion: 'snapback.data-query.v1',
  normalizedDataQueryId: queryCatalogEntry.normalizedDataQueryId,
  core: Object.freeze({ resource: 'todos', requiredCapabilities: Object.freeze(['data.live.v1']) }),
  resolution: queryCatalogEntry.resolution,
  functionReference: queryRef,
  namedArguments: Object.freeze({ status: 'open' }),
  explain: Object.freeze({
    witness: queryCatalogEntry.normalizedDataQueryId,
    requiredCapabilities: Object.freeze(['data.live.v1']),
    servedCapabilities: Object.freeze(['data.live.v1']),
    retained: false,
    materializationKey: null,
  }),
});

const core = Object.freeze({
  format: 'snapback.normalized-data-transaction.v1',
  chunks: Object.freeze([
    Object.freeze({ position: 0, exportedName: 'todos.create' }),
    Object.freeze({ position: 1, exportedName: 'todos.update' }),
  ]),
  prediction: 'generated-exact',
  custody: Object.freeze({ class: 'queue-eligible', reasons: Object.freeze([]) }),
  reach: Object.freeze({ reads: Object.freeze(['todos']), writes: Object.freeze(['todos']) }),
});

function binding(coreOverride = {}) {
  const data = {};
  Object.defineProperty(data, '__snapbackDataBinding', {
    enumerable: false,
    value: Object.freeze({
      dataResources: Object.freeze([{ core: { resource: 'todos', table: 'todos' } }]),
      dataQueryCatalog: Object.freeze([queryCatalogEntry]),
      operations: Object.freeze({
        todos: Object.freeze({ create: createRef, update: updateRef }),
      }),
      dataTransactionCatalog: Object.freeze([Object.freeze({
        normalizedDataTransactionId: `sha256:${'d'.repeat(64)}`,
        core: Object.freeze({ ...core, ...coreOverride }),
        resolution: Object.freeze({ kind: 'synthesized-batch', exportedName: 'data.tx_dddddddddddddddd' }),
        functionReference: Object.freeze({ ...createRef, id: 'data-test:data.tx_dddddddddddddddd', name: 'data.tx_dddddddddddddddd' }),
        chunkFunctionReferences: Object.freeze([createRef, updateRef]),
        argumentNames: Object.freeze([Object.freeze(['title']), Object.freeze(['id', 'title'])]),
        shape: Object.freeze([
          Object.freeze({ resource: 'todos', operation: 'create' }),
          Object.freeze({ resource: 'todos', operation: 'update' }),
        ]),
      })]),
    }),
  });
  return Object.freeze(data);
}

function fakeClient({ disposition = 'settled', presentation = 'installed' } = {}) {
  const calls = [];
  const queryCalls = [];
  const liveCalls = [];
  const listeners = new Set();
  return {
    calls,
    queryCalls,
    liveCalls,
    async __dataMutation(reference, options) {
      calls.push({ reference, options });
      if (disposition === 'settled') {
        const receipt = { kind: 'mutation', outcome: 'confirmed' };
        Object.defineProperty(receipt, Symbol('authority-capture'), {
          value: { authorityEpoch: 1 },
        });
        return {
          status: 'settled',
          clientMutationId: options.clientMutationId,
          result: { c0: { _id: 'todo-new', title: 'a' }, c1: { _id: 'todo-1', title: 'b' } },
          receipt,
        };
      }
      return {
        status: disposition,
        clientMutationId: options.clientMutationId,
        presentation,
      };
    },
    async mutationStatus() { return { status: disposition === 'queued' ? 'pending' : 'unknown' }; },
    subscribeMutation(_intentId, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async __dataPendingWrites() {
      return Object.freeze([
        Object.freeze({
          intentId: 'cm-b', sequence: 2, state: 'pending', presentation: 'withheld',
          reach: Object.freeze({ reads: Object.freeze([]), writes: Object.freeze(['todos']) }),
        }),
        Object.freeze({
          intentId: 'cm-a', sequence: 1, state: 'queued', presentation: 'installed',
          reach: Object.freeze({ reads: Object.freeze([]), writes: Object.freeze(['todos']) }),
        }),
        Object.freeze({
          intentId: 'cm-other', sequence: 3, state: 'queued', presentation: 'installed',
          reach: Object.freeze({ reads: Object.freeze([]), writes: Object.freeze(['notes']) }),
        }),
      ]);
    },
    async query(reference, options) {
      queryCalls.push({ reference, options });
      return { version: 4, rows: [{ _id: 'todo-1', title: 'first' }], cursor: 'dc1.next' };
    },
    async liveQuery(reference, options) {
      liveCalls.push({ reference, options });
      const handle = {
        rows: [{ _id: 'todo-1', title: 'first' }],
        cursor: 'dc1.next',
        connection: 'live',
        freshness: 'current',
        retention: { retainable: false, reason: 'data v1 is unretained' },
        async poll() {
          this.rows = [...this.rows, { _id: 'todo-2', title: 'second' }];
          this.cursor = null;
          options.onUpdate?.(this.rows, { kind: 'snapshot' });
          return this.rows;
        },
        dispose() { this.disposed = true; },
      };
      options.onUpdate?.(handle.rows, { kind: 'snapshot' });
      return handle;
    },
  };
}

test('inert chunks enforce exact contracts and one catalogued ordered composition', async () => {
  const client = fakeClient();
  const db = createDataClient({ client, data: binding() });
  assert.throws(
    () => db.tx.todos.create({ title: 'a', extra: true }),
    ({ code }) => code === 'SNAPBACK_DATA_TRANSACTION_INVALID',
  );
  const create = db.tx.todos.create({ title: 'a' });
  const update = db.tx.todos.update({ id: 'todo-1', title: 'b' });
  assert.equal(client.calls.length, 0, 'chunk construction is inert');
  assert.throws(
    () => db.transact(update, create),
    ({ code }) => code === 'SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED',
  );
  assert.throws(
    () => db.transact(update, db.tx.todos.update({ id: 'todo-1', title: 'again' })),
    ({ code }) => code === 'SNAPBACK_DATA_TRANSACTION_INVALID',
    'duplicate existing-row targets escape the tiny transaction grammar',
  );
  const handle = db.transact(create, update);
  assert.equal(typeof handle.intentId, 'string');
  const dispatch = await handle.dispatched;
  const settlement = await handle.settled;
  assert.deepEqual(dispatch, { status: 'settled', intentId: handle.intentId });
  assert.deepEqual(settlement.results, [
    { _id: 'todo-new', title: 'a' },
    { _id: 'todo-1', title: 'b' },
  ]);
  assert.equal(client.calls[0].options.clientMutationId, handle.intentId);
  assert.equal(client.calls[0].options.dataTransaction.intentId, handle.intentId);
  assert.deepEqual(client.calls[0].options.args, {
    c0_title: 'a', c1_id: 'todo-1', c1_title: 'b',
  });
  assert.deepEqual(client.calls[0].options.dataTransaction.canonicalArguments, [
    'a', 'todo-1', 'b',
  ]);
});

test('handle subscription is notify-only and dispose never cancels dispatch custody', async () => {
  const client = fakeClient();
  const db = createDataClient({ client, data: binding() });
  const handle = db.transact(
    db.tx.todos.create({ title: 'a' }),
    db.tx.todos.update({ id: 'todo-1', title: 'b' }),
  );
  const notifications = [];
  handle.subscribe((...args) => notifications.push(args));
  handle.dispose();
  assert.equal((await handle.dispatched).status, 'settled');
  assert.equal((await handle.settled).status, 'committed');
  assert.equal(client.calls.length, 1, 'dispose does not cancel accepted work');
  assert.deepEqual(notifications, [], 'disposed observation receives no later notification');
});

test('pendingWrites intersects materialization reach and preserves owner ordering without payloads', async () => {
  const db = createDataClient({ client: fakeClient(), data: binding() });
  const pending = await db.pendingWrites({ core: { resource: 'todos' } });
  assert.deepEqual(pending, [
    { intentId: 'cm-a', state: 'queued', presentation: 'installed' },
    { intentId: 'cm-b', state: 'pending', presentation: 'withheld' },
  ]);
  assert.equal(JSON.stringify(pending).includes('args'), false);
  assert.deepEqual(await db.pendingWrites({ status: 'skipped' }), []);
});

test('headless read returns DataPageV1 and explain never opens transport', async () => {
  const client = fakeClient();
  const db = createDataClient({ client, data: binding() });
  assert.equal('query' in db, false, 'the experimental doorway does not publish a second query verb');
  assert.deepEqual(db.explain(queryDescriptor), queryDescriptor.explain);
  assert.equal(client.queryCalls.length, 0);
  assert.deepEqual(await db.read(queryDescriptor), {
    rows: [{ _id: 'todo-1', title: 'first' }],
    cursor: 'dc1.next',
    complete: false,
  });
  assert.deepEqual(client.queryCalls[0], {
    reference: queryRef,
    options: { args: { status: 'open' } },
  });
});

test('watch projects the canonical handle/state union and delegates one live materialization', async () => {
  const client = fakeClient();
  const db = createDataClient({ client, data: binding() });
  const watch = db.watch(queryDescriptor);
  const notifications = [];
  watch.subscribe(() => notifications.push(watch.snapshot().status));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.liveCalls.length, 1);
  assert.equal(client.liveCalls[0].options.transport, 'stream');
  assert.equal(client.liveCalls[0].options.persistResume, false);
  assert.deepEqual(watch.snapshot(), {
    status: 'ready',
    data: {
      rows: [{ _id: 'todo-1', title: 'first' }],
      cursor: 'dc1.next',
      complete: false,
    },
    error: null,
    connection: 'live',
    freshness: 'current',
    retention: { retainable: false, reason: 'data v1 is unretained' },
    pendingWrites: [
      { intentId: 'cm-a', state: 'queued', presentation: 'installed' },
      { intentId: 'cm-b', state: 'pending', presentation: 'withheld' },
    ],
  });
  await watch.refresh();
  assert.equal(watch.snapshot().data.complete, true);
  assert.equal(watch.snapshot().data.rows.length, 2);
  watch.dispose();
  assert.equal(client.liveCalls.length, 1, 'refresh and dispose do not create another transport owner');
  assert.equal(notifications.includes('ready'), true);
});

test('watch projects refreshing, blocked, and error arms from the canonical live handle', async () => {
  const client = fakeClient();
  let callbacks = null;
  const handle = {
    rows: [{ _id: 'todo-1', title: 'retained' }],
    cursor: null,
    connection: 'connecting',
    freshness: 'retained',
    retention: { retainable: true, reason: 'fixture' },
    authorizationDenial: null,
    async poll() {},
    dispose() {},
  };
  client.liveQuery = async (_reference, options) => {
    callbacks = options;
    return handle;
  };
  const watch = createDataClient({ client, data: binding() }).watch(queryDescriptor);
  assert.equal(watch.snapshot().status, 'pending');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watch.snapshot().status, 'refreshing');
  assert.equal(watch.snapshot().freshness, 'retained');

  handle.connection = 'live';
  handle.freshness = 'current';
  callbacks.onConnectionChange('live', {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watch.snapshot().status, 'ready');

  callbacks.onUpdate([], {
    kind: 'authorization_denied',
    error: { code: 'SNAPBACK_AUTH_REQUIRED', message: 'sign in' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watch.snapshot().status, 'blocked');
  assert.equal(watch.snapshot().reason, 'authentication-required');

  callbacks.onUpdate([], {
    kind: 'authorization_error',
    error: { code: 'SNAPBACK_AUTH_INVALIDATION_CORRUPT', message: 'invalid boundary' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(watch.snapshot().status, 'error');
  assert.equal(watch.snapshot().error.code, 'SNAPBACK_AUTH_INVALIDATION_CORRUPT');
  watch.dispose();
});

test('query admission refuses stale catalogues and missing capabilities before transport', () => {
  const client = fakeClient();
  const db = createDataClient({ client, data: binding() });
  assert.throws(
    () => db.watch({ ...queryDescriptor, normalizedDataQueryId: `sha256:${'f'.repeat(64)}` }),
    (error) => error.code === 'SNAPBACK_DATA_QUERY_NOT_CATALOGUED'
      && error.diagnostic.details.guideAnchor === 'guide/data/queries'
      && /backend source root/u.test(error.message)
      && /data-queries\.mjs/u.test(error.message)
      && /regenerate/u.test(error.message),
  );
  assert.throws(
    () => db.watch({
      ...queryDescriptor,
      explain: { ...queryDescriptor.explain, servedCapabilities: [] },
    }),
    ({ code }) => code === 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE',
  );
  assert.equal(client.queryCalls.length, 0);
  assert.equal(client.liveCalls.length, 0);
});

test('missing generated bindings name the stable setup action', () => {
  assert.throws(
    () => createDataClient({ client: fakeClient(), data: {} }),
    (error) => error.code === 'SNAPBACK_DATA_BINDING_REQUIRED'
      && error.diagnostic.details.action.includes('normal Snapback generation'),
  );
});

test('non-replayable observations persist the atomic boundary but never enter replay ordering', () => {
  const input = {
    id: 'cm-online',
    function: 'data.tx_online',
    dataCustodyClass: 'online-only',
    dataCustodyReason: 'operation-reach-online-only',
    dispatchBoundary: 'not-crossed',
    dataTransaction: {
      artifactKind: 'dataTransaction',
      core: { reach: { reads: [], writes: ['todos'] } },
    },
  };
  const enqueued = outboxOps.enqueue(emptyOutboxState(), input, 1);
  assert.equal(enqueued.result.replayable, false);
  assert.equal(enqueued.result.dispatchBoundary, 'not-crossed');
  assert.deepEqual(pendingOutboxRecords(enqueued.state), []);
  const crossed = outboxOps.markDispatchPossiblyCrossed(enqueued.state, 'cm-online');
  assert.equal(crossed.result.dispatchBoundary, 'possibly-crossed');
  assert.deepEqual(pendingOutboxRecords(crossed.state), []);
  const settled = outboxOps.durablyConsume(
    crossed.state,
    'cm-online',
    { refusal: { code: 'SNAPBACK_ROW_NOT_FOUND' } },
    'user-a',
    2,
  );
  assert.equal(settled.result.status, 'settled');
  assert.equal(settled.state.acks.length, 1, 'ledgered refusal shares ACK capacity');
});

const onlineObservation = (id) => ({
  id,
  function: 'data.tx_online',
  userId: 'user-a',
  dataCustodyClass: 'online-only',
  dispatchBoundary: 'not-crossed',
  dataTransaction: {
    artifactKind: 'dataTransaction',
    core: { reach: { reads: [], writes: ['todos'] } },
  },
});

test('file store survives both non-replayable crash cuts and ACKs a ledgered refusal', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-data-custody-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let store = createFileRqsResumeStore({ directory, identity: 'phase3:file' });
  await store.whenLockSettled();
  await store.outboxEnqueue(onlineObservation('cm-file'));
  await store.close();

  store = createFileRqsResumeStore({ directory, identity: 'phase3:file' });
  await store.whenLockSettled();
  let record = (await store.outboxRecords())[0];
  assert.equal(record.dispatchBoundary, 'not-crossed', 'pre-boundary crash proves non-acceptance');
  assert.deepEqual(await store.outboxPending(), [], 'online-only observations never replay');
  await store.outboxMarkDispatchPossiblyCrossed('cm-file');
  await store.close();

  store = createFileRqsResumeStore({ directory, identity: 'phase3:file' });
  await store.whenLockSettled();
  record = (await store.outboxRecords())[0];
  assert.equal(record.dispatchBoundary, 'possibly-crossed');
  await store.outboxDurablyConsume('cm-file', {
    dataOutcome: 'refused', diagnostic: { code: 'SNAPBACK_ROW_NOT_FOUND' },
  }, 'user-a');
  await store.outboxMarkAcknowledgementsReady(['cm-file']);
  assert.deepEqual(await store.outboxPendingAcknowledgements('user-a'), ['cm-file']);
  assert.equal(await store.outboxConfirmAcknowledgements(['cm-file']), 1);
  await store.close();
});

test('IndexedDB persists the possibly-crossed boundary without joining replay ordering', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = {
    request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
  };
  let store = createIndexedDbRqsResumeStore({
    indexedDB, lockManager, databaseName: 'phase3-data-custody',
  });
  await Promise.resolve();
  await store.outboxEnqueue(onlineObservation('cm-idb'));
  await store.outboxMarkDispatchPossiblyCrossed('cm-idb');
  await store.close();

  store = createIndexedDbRqsResumeStore({
    indexedDB, lockManager, databaseName: 'phase3-data-custody',
  });
  await Promise.resolve();
  const [record] = await store.outboxRecords();
  assert.equal(record.dispatchBoundary, 'possibly-crossed');
  assert.deepEqual(await store.outboxPending(), []);
  await store.close();
});

test('a user switch privacy-purges a non-replayable data observation', () => {
  const predecessorScope = {
    authMode: 'sessions', authorizationStreamIncarnation: 'stream-a', userId: 'user-a',
  };
  const predecessorCustody = { authorityEpoch: 1, authorityKey: 'authority-key-a' };
  const enqueued = outboxOps.enqueue(emptyOutboxState(), {
    ...onlineObservation('cm-private'),
    authorityDescriptor: { authorityInstanceId: 'authority-instance-a' },
    principalScope: predecessorScope,
    custody: predecessorCustody,
  }, 1);
  const reconciled = outboxOps.reconcileCustody(
    enqueued.state,
    { authMode: 'sessions', authorizationStreamIncarnation: 'stream-b', userId: 'user-b' },
    { authorityInstanceId: 'authority-instance-b' },
    { authorityEpoch: 2, authorityKey: 'authority-key-b' },
    2,
  );
  assert.deepEqual(reconciled.result.deletedIds, ['cm-private']);
  assert.deepEqual(Object.keys(reconciled.state.records), []);
});

test('all prediction × custody dispatch cells preserve independent presentation and custody axes', async () => {
  for (const prediction of ['generated-exact', 'none']) {
    for (const custody of ['queue-eligible', 'online-only']) {
      const localData = binding({ prediction, custody: { class: custody, reasons: [] } });
      const client = fakeClient({
        disposition: custody === 'queue-eligible' ? 'queued' : 'pending',
        presentation: prediction === 'generated-exact' ? 'installed' : 'unavailable',
      });
      const db = createDataClient({ client, data: localData });
      const handle = db.transact(
        db.tx.todos.create({ title: 'a' }),
        db.tx.todos.update({ id: 'todo-1', title: 'b' }),
      );
      const dispatch = await handle.dispatched;
      assert.equal(dispatch.status, custody === 'queue-eligible' ? 'queued' : 'pending');
      assert.equal(
        dispatch.presentation,
        prediction === 'generated-exact' ? 'installed' : 'unavailable',
      );
      handle.dispose();
    }
  }
});
