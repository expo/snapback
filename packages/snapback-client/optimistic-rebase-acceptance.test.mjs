// Move-3 Phase-1 M3 in-process acceptance: the three named gate legs avoid
// loopback transport and exercise the shipped evaluator, M2 admission, and
// durable outbox composition directly.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BROWSER_IR_LOCAL_EFFECT_CLASS } from './ir-evaluator.mjs';
import { createOptimisticRebaseEngineV1 } from './optimistic-rebase.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const QMK = `qmk1.${'G'.repeat(43)}`;
const digest = (character) => `sha256:${character.repeat(64)}`;
const encoder = new TextEncoder();
const address = ['snapback:client-materialization-address:v1', 'm3-gate-store', QMK];
const schema = {
  tables: [{
    name: 'cards',
    fields: [{ name: 'locked' }, { name: 'position' }, { name: 'title' }],
  }],
};
const coverage = {
  format: 'snapback.local-read-materialization-coverage.v1',
  materializationKey: QMK,
  planHash: digest('4'),
  resultContractHash: digest('5'),
  table: 'cards',
  projectedFields: ['_id', 'locked', 'position', 'title'],
  absence: 'table-complete',
};
const registrationLedger = {
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
const materialization = {
  materializationKey: QMK,
  queryInstanceId: 1,
  planHash: digest('4'),
  resultContractHash: digest('5'),
  authorityPartitionDigest: digest('6'),
};

const moveOperation = (id, cardId, position) => ({
  name: 'moveCard',
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
          values: { position: { Arg: 'position' } },
        },
      },
    ],
    return_value: 'ChangedCount',
  },
  args: { id: cardId, position },
  ctxLedger: { version: 1, ids: [], now: position + 1 },
  layerId: id,
  declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
  declaredReads: ['cards'],
  localReadRequirements: [{
    kind: 'point',
    table: 'cards',
    idArg: 'id',
    binding: 'card',
    requiredFields: ['_id', 'locked'],
  }],
});

const insertOperation = (id) => ({
  name: 'createCard',
  schema,
  plan: {
    steps: [{
      Insert: {
        table: 'cards',
        values: {
          locked: { Literal: false },
          position: { Literal: 1 },
          title: { Arg: 'title' },
        },
        bind_id_as: 'cardId',
      },
    }],
    return_value: 'ChangedCount',
  },
  args: { title: 'new' },
  ctxLedger: { version: 1, ids: ['card-speculative'], now: 1 },
  layerId: id,
  declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
  declaredReads: [],
  localReadRequirements: [],
});

const enqueue = (store, id, operation) => store.outboxEnqueue({
  id,
  function: operation.name,
  args: operation.args,
  ctxLedger: operation.ctxLedger,
  settlementLane: 're-derive',
  optimisticOperation: operation,
});

const harness = (store, initialRows) => {
  let rows = initialRows;
  const readMaterializationAnswer = async () => ({
    answerClass: 'authoritative',
    freshness: 'current',
    value: encoder.encode(JSON.stringify(rows)),
    materialization,
  });
  return {
    setRows(next) { rows = next; },
    engine: createOptimisticRebaseEngineV1({
      outboxStore: store,
      registrationLedger,
      readMaterializationAnswer,
      initialAuthoritativeRows: { cards: initialRows },
    }),
  };
};

test('M3 gate: 20 rapid moves with interleaved deliveries converge to server outcome', async () => {
  const store = createMemoryRqsResumeStore();
  let serverRows = [{ _id: 'card-1', locked: false, position: 0, title: 'one' }];
  const fixture = harness(store, serverRows);
  const reflected = [];

  for (let move = 1; move <= 20; move += 1) {
    const id = `rapid-move-${String(move).padStart(2, '0')}`;
    await enqueue(store, id, moveOperation(id, 'card-1', move));
    await fixture.engine.refresh({ authoritativeRows: { cards: serverRows } });
    assert.equal(
      fixture.engine.getSnapshot().visibleRows.cards[0].position,
      move,
      `rapid move ${move} paints from its IR layer`,
    );

    if ([5, 12, 20].includes(move)) {
      const pending = await store.outboxPending();
      for (const record of pending) {
        await store.outboxDurablyConsume(record.id, {
          result: { position: move },
          version: move,
          receipt: { kind: 'mutation', mutationId: record.id, idMap: [] },
        });
        reflected.push(record.id);
      }
      serverRows = [{ _id: 'card-1', locked: false, position: move, title: 'one' }];
      fixture.setRows(serverRows);
      const delivery = await fixture.engine.rebase({
        authoritativeRows: { cards: serverRows },
        retiredSettlementIdentities: reflected,
        cause: `authoritative-delivery-${move}`,
      });
      assert.equal(delivery.refusals.length, 0);
      assert.equal(fixture.engine.getSnapshot().layers.length, 0);
      assert.deepEqual(fixture.engine.getSnapshot().visibleRows, { cards: serverRows });
    }
  }

  assert.equal(reflected.length, 20);
  assert.deepEqual(fixture.engine.getSnapshot().visibleRows, { cards: serverRows });
  assert.equal(fixture.engine.inspection().reflectedSettlementIdentities.length, 20);
});

test('M3 gate: locked-card refusal is surfaced and does not corrupt sibling layer', async () => {
  const store = createMemoryRqsResumeStore();
  const initialRows = [
    { _id: 'card-a', locked: false, position: 0, title: 'A' },
    { _id: 'card-b', locked: false, position: 0, title: 'B' },
  ];
  const fixture = harness(store, initialRows);
  await enqueue(store, 'locked-move', moveOperation('locked-move', 'card-a', 1));
  await enqueue(store, 'sibling-move', moveOperation('sibling-move', 'card-b', 2));
  await fixture.engine.reload();
  assert.equal(fixture.engine.getSnapshot().layers.length, 2);

  const lockedBase = [
    { _id: 'card-a', locked: true, position: 0, title: 'A' },
    { _id: 'card-b', locked: false, position: 0, title: 'B' },
  ];
  fixture.setRows(lockedBase);
  const outcome = await fixture.engine.rebase({ authoritativeRows: { cards: lockedBase } });
  assert.equal(outcome.refusals.length, 1);
  assert.equal(outcome.refusals[0].clientMutationId, 'locked-move');
  assert.equal(outcome.refusals[0].code, 'CARD_LOCKED');
  assert.equal(fixture.engine.getSnapshot().queuedOnly[0].clientMutationId, 'locked-move');
  assert.deepEqual(
    fixture.engine.getSnapshot().layers.map((entry) => entry.clientMutationId),
    ['sibling-move'],
  );
  const visible = fixture.engine.getSnapshot().visibleRows.cards;
  assert.deepEqual(visible.find((row) => row._id === 'card-a'), lockedBase[0]);
  assert.equal(visible.find((row) => row._id === 'card-b').position, 2);
  assert.deepEqual((await store.outboxPending()).map((record) => record.id), [
    'locked-move',
    'sibling-move',
  ]);
});

test('engine keeps a restarted bridge until the live-query settlement matcher proves reflection', async () => {
  const store = createMemoryRqsResumeStore();
  const operation = insertOperation('reload-insert');
  await enqueue(store, 'reload-insert', operation);

  const first = harness(store, []);
  await first.engine.reload({ authoritativeRows: { cards: [] } });
  assert.deepEqual(first.engine.getSnapshot().visibleRows.cards.map((row) => row._id), [
    'card-speculative',
  ]);

  await store.outboxDurablyConsume('reload-insert', {
    result: { id: 'card-authoritative' },
    version: 1,
    receipt: {
      kind: 'mutation',
      mutationId: 'reload-insert',
      idMap: [{
        speculative: 'card-speculative',
        authoritative: 'card-authoritative',
        site: 'insert:cards:id',
        occurrence: 0,
        disposition: 'mapped',
      }],
    },
  });
  await first.engine.refresh({ authoritativeRows: { cards: [] } });
  assert.equal(first.engine.getSnapshot().layers[0].layerStatus, 'bridging');

  const reloaded = harness(store, []);
  await reloaded.engine.reload({ authoritativeRows: { cards: [] } });
  assert.equal(reloaded.engine.getSnapshot().layers.length, 1);
  assert.deepEqual(reloaded.engine.getSnapshot().visibleRows.cards.map((row) => row._id), [
    'card-speculative',
  ], 'fresh client reconstructs exactly one bridge from durable intent');

  const authoritativeRows = [{
    _id: 'card-authoritative', locked: false, position: 1, title: 'new',
  }];
  reloaded.setRows(authoritativeRows);
  const delivery = await reloaded.engine.rebase({
    authoritativeRows: { cards: authoritativeRows },
  });
  assert.deepEqual(delivery.retiredIdentities, []);
  assert.equal(reloaded.engine.getSnapshot().layers.length, 1);
  assert.deepEqual(reloaded.engine.getSnapshot().visibleRows.cards.map((row) => row._id), [
    'card-authoritative',
    'card-speculative',
  ], 'the generic engine cannot infer settlement reflection from a colliding canonical row');
  assert.equal((await store.outboxRecords())[0].status, 'settled');
});
