import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BROWSER_IR_LOCAL_EFFECT_CLASS } from './ir-evaluator.mjs';
import { SnapbackClient as InspectingSnapbackClient } from './index.mjs';
import {
  applyPrivateOptimisticLayerV1,
  applyPrivateOptimisticLayersV1,
  createOptimisticRebaseEngineV1,
} from './optimistic-rebase.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      ...options,
    });
  }
}

const originalFetch = globalThis.fetch;

const QMK = `qmk1.${'R'.repeat(43)}`;
const digest = (character) => `sha256:${character.repeat(64)}`;
const encoder = new TextEncoder();
const address = ['snapback:client-materialization-address:v1', 'rebase-store', QMK];

const schema = {
  tables: [{
    name: 'cards',
    fields: [{ name: 'locked' }, { name: 'position' }, { name: 'title' }],
  }],
};

const coverage = {
  format: 'snapback.local-read-materialization-coverage.v1',
  materializationKey: QMK,
  planHash: digest('1'),
  resultContractHash: digest('2'),
  table: 'cards',
  projectedFields: ['_id', 'locked', 'position', 'title'],
  absence: 'table-complete',
};

const ledger = {
  demandedMaterializations: () => [{
    family: 'qmk1',
    address,
    addressKey: JSON.stringify(address),
    demandState: 'demanded-active',
    effectiveScope: null,
    registrations: [{
      registration: { functionReference: { localReadCoverage: coverage } },
      resolution: {},
    }],
  }],
};

const identity = {
  materializationKey: QMK,
  queryInstanceId: 1,
  planHash: digest('1'),
  resultContractHash: digest('2'),
  authorityPartitionDigest: digest('3'),
};

const incrementOperation = (id) => ({
  name: 'incrementCardPosition',
  schema,
  plan: {
    steps: [
      {
        Get: {
          table: 'cards',
          id: { Arg: 'id' },
          bind_as: 'card',
          else_error: 'CARD_NOT_FOUND',
        },
      },
      {
        Guard: {
          cond: {
            Binary: {
              op: 'Eq',
              left: { Field: { base: { Binding: 'card' }, key: 'locked' } },
              right: { Literal: false },
            },
          },
          else_error: 'CARD_LOCKED',
        },
      },
      {
        Patch: {
          table: 'cards',
          id: { Arg: 'id' },
          values: {
            position: {
              Binary: {
                op: 'Add',
                left: { Field: { base: { Binding: 'card' }, key: 'position' } },
                right: { Literal: 1 },
              },
            },
          },
        },
      },
    ],
    return_value: 'ChangedCount',
  },
  args: { id: 'card-1' },
  ctxLedger: { version: 1, ids: [], now: 1 },
  layerId: id,
  declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
  declaredReads: ['cards'],
  localReadRequirements: [{
    kind: 'point',
    table: 'cards',
    idArg: 'id',
    binding: 'card',
    requiredFields: ['_id', 'locked', 'position'],
  }],
});

const enqueueOperation = (store, id, operation = incrementOperation(id)) => store.outboxEnqueue({
  id,
  function: operation.name,
  args: operation.args,
  ctxLedger: operation.ctxLedger,
  settlementLane: 're-derive',
  optimisticOperation: operation,
});

const setup = async (initialRows = [{
  _id: 'card-1', locked: false, position: 0, title: 'one',
}]) => {
  const store = createMemoryRqsResumeStore();
  let answerClass = 'authoritative';
  let rows = initialRows;
  let releaseAnswer = null;
  const readMaterializationAnswer = async () => {
    if (releaseAnswer) await releaseAnswer;
    return {
      answerClass,
      freshness: answerClass === 'authoritative' ? 'current' : 'retained',
      value: encoder.encode(JSON.stringify(rows)),
      materialization: identity,
    };
  };
  const engine = createOptimisticRebaseEngineV1({
    outboxStore: store,
    registrationLedger: ledger,
    readMaterializationAnswer,
    initialAuthoritativeRows: { cards: initialRows },
  });
  return {
    store,
    engine,
    setRows(next) { rows = next; },
    setAnswerClass(next) { answerClass = next; },
    holdAnswers() {
      let release;
      releaseAnswer = new Promise((resolve) => { release = resolve; });
      return () => {
        releaseAnswer = null;
        release();
      };
    },
  };
};

test('private layers fold in application order without mutating base or layer', () => {
  const base = { cards: [{ _id: 'card-1', locked: false, position: 0 }] };
  const layers = [1, 2].map((position) => ({
    format: 'snapback.private-optimistic-layer.v1',
    visibility: 'private',
    layerId: `layer-${position}`,
    operationName: 'move',
    writes: [{
      operation: 'patch',
      table: 'cards',
      id: 'card-1',
      values: { position },
      row: { _id: 'card-1', locked: false, position },
    }],
    declaredTableRows: {},
  }));
  const beforeBase = JSON.stringify(base);
  const beforeLayers = JSON.stringify(layers);
  const visible = applyPrivateOptimisticLayersV1(base, layers);
  assert.equal(visible.cards[0].position, 2);
  assert.equal(JSON.stringify(base), beforeBase);
  assert.equal(JSON.stringify(layers), beforeLayers);
  assert.equal(Object.isFrozen(visible), true);
  assert.equal(Object.isFrozen(visible.cards[0]), true);
});

test('a private delete fold removes present rows and ignores missing rows', () => {
  const base = {
    cards: [
      { _id: 'card-1', locked: false, position: 0 },
      { _id: 'card-2', locked: false, position: 1 },
    ],
  };
  const layer = (operation, id) => ({
    format: 'snapback.private-optimistic-layer.v1',
    visibility: 'private',
    layerId: `layer-${id}`,
    operationName: 'deleteCard',
    writes: [{ operation, table: 'cards', id }],
    declaredTableRows: {},
  });

  const deleted = applyPrivateOptimisticLayerV1(base, layer('delete', 'card-1'));
  assert.deepEqual(deleted.cards, [
    { _id: 'card-2', locked: false, position: 1 },
  ]);

  const missing = applyPrivateOptimisticLayerV1(base, layer('delete', 'missing'));
  assert.deepEqual(missing, base);

  assert.throws(
    () => applyPrivateOptimisticLayerV1(base, layer('replace', 'card-1')),
    /optimistic layer carries unsupported write replace/u,
  );
});

test('rebase replays by outbox sequence through M2 and records a changed prediction', async () => {
  const fixture = await setup();
  await enqueueOperation(fixture.store, 'move-1');
  await enqueueOperation(fixture.store, 'move-2');

  const first = await fixture.engine.reload({
    authoritativeRows: { cards: [{ _id: 'card-1', locked: false, position: 0, title: 'one' }] },
  });
  assert.deepEqual(first.replayedOperations.map((entry) => entry.clientMutationId), [
    'move-1',
    'move-2',
  ]);
  assert.equal(fixture.engine.getSnapshot().visibleRows.cards[0].position, 2);
  assert.equal(fixture.engine.getSnapshot().layers.length, 2);

  const movedBase = [{ _id: 'card-1', locked: false, position: 10, title: 'one' }];
  fixture.setRows(movedBase);
  const second = await fixture.engine.rebase({
    authoritativeRows: { cards: movedBase },
    retiredSettlementIdentities: ['move-1'],
  });
  assert.deepEqual(second.retiredIdentities.map((entry) => entry.settlementIdentity), ['move-1']);
  assert.deepEqual(second.replayedOperations.map((entry) => entry.clientMutationId), ['move-2']);
  assert.deepEqual(second.changedPredictions.map((entry) => entry.clientMutationId), ['move-2']);
  assert.equal(fixture.engine.getSnapshot().visibleRows.cards[0].position, 11);
  assert.equal(fixture.engine.getSnapshot().layers[0].layer.layerId, 'move-2');
});

test('an M2 degradation keeps intent queued-only and remains inspectable', async () => {
  const fixture = await setup();
  await enqueueOperation(fixture.store, 'move-degraded');
  await fixture.engine.reload();
  assert.equal(fixture.engine.getSnapshot().layers.length, 1);

  fixture.setAnswerClass('unknown');
  const outcome = await fixture.engine.refresh();
  assert.equal(outcome.replayedOperations.length, 1);
  assert.equal(outcome.degradations.length, 1);
  assert.equal(outcome.degradations[0].classification, 'server-only');
  assert.equal(outcome.degradations[0].code, 'SNAPBACK_IR_READS_SERVER_ONLY');
  assert.equal(outcome.changedPredictions[0].clientMutationId, 'move-degraded');
  assert.equal(fixture.engine.getSnapshot().layers.length, 0);
  assert.equal(fixture.engine.getSnapshot().queuedOnly.length, 1);
  assert.equal((await fixture.store.outboxPending())[0].id, 'move-degraded');
  assert.equal(fixture.engine.inspection().rebaseOutcomes.length, 2);
});

test('async admission publishes base, layers, and outcome exactly once', async () => {
  const fixture = await setup();
  await enqueueOperation(fixture.store, 'move-atomic');
  fixture.setRows([{ _id: 'card-1', locked: false, position: 5, title: 'one' }]);
  const release = fixture.holdAnswers();
  let notifications = 0;
  fixture.engine.subscribe(() => { notifications += 1; });
  const rebasing = fixture.engine.rebase({
    authoritativeRows: {
      cards: [{ _id: 'card-1', locked: false, position: 5, title: 'one' }],
    },
  });
  await Promise.resolve();
  assert.equal(fixture.engine.getSnapshot().revision, 0);
  assert.equal(fixture.engine.getSnapshot().visibleRows.cards[0].position, 0);
  assert.equal(notifications, 0);
  release();
  await rebasing;
  assert.equal(fixture.engine.getSnapshot().revision, 1);
  assert.equal(fixture.engine.getSnapshot().visibleRows.cards[0].position, 6);
  assert.equal(notifications, 1);
});

test('the durable identity includes the immutable optimistic operation', async () => {
  const fixture = await setup();
  await enqueueOperation(fixture.store, 'move-identity');
  const changed = incrementOperation('move-identity');
  changed.plan.steps[2].Patch.values.position.Binary.right.Literal = 2;
  await assert.rejects(
    () => enqueueOperation(fixture.store, 'move-identity', changed),
    (error) => error.code === 'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
  );
});

test('mutate mints one settlement/layer identity and persists replayable IR', async (t) => {
  t.after(() => { globalThis.fetch = originalFetch; });
  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'memory-test-double', durable: true });
  const client = new SnapbackClient('http://127.0.0.1:9', { rqsStore: store });
  const operation = incrementOperation('pre-mint-placeholder');

  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const queued = await client.mutate(operation.name, {
    args: operation.args,
    ctxLedger: operation.ctxLedger,
    settlementLane: 're-derive',
    optimisticOperation: operation,
  });

  assert.equal(queued.queued, true);
  assert.match(queued.clientMutationId, /^mut_[0-9a-hjkmnp-tv-z]{26}$/u);
  const [record] = await store.outboxRecords();
  assert.equal(record.id, queued.clientMutationId);
  assert.equal(record.optimisticOperation.layerId, queued.clientMutationId);

  const rows = [{ _id: 'card-1', locked: false, position: 0, title: 'one' }];
  const engine = createOptimisticRebaseEngineV1({
    outboxStore: store,
    registrationLedger: ledger,
    readMaterializationAnswer: async () => ({
      answerClass: 'authoritative',
      freshness: 'current',
      value: encoder.encode(JSON.stringify(rows)),
      materialization: identity,
    }),
    initialAuthoritativeRows: { cards: rows },
  });
  await engine.reload();
  assert.equal(engine.getSnapshot().layers[0].layer.layerId, queued.clientMutationId);
  assert.equal(engine.getSnapshot().visibleRows.cards[0].position, 1);
});

test('closed optimistic rebase engines reject with a stable diagnostic', async () => {
  const fixture = await setup();
  fixture.engine.close();
  await assert.rejects(
    fixture.engine.rebase(),
    (error) => error.code === 'SNAPBACK_OPTIMISTIC_REBASE_CLOSED'
      && error.diagnostic.code === error.code,
  );
});
