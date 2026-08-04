import assert from 'node:assert/strict';

import {
  classifySpikePlan,
  evaluateKanbanMutationSpike,
  SPIKE_KANBAN_EFFECT_CLASS,
} from './browser-evaluator.mjs';
import {
  KANBAN_OPERATIONS,
  qmk1BoardMaterialization,
} from './kanban-fixture.mjs';
import {
  prepareMaterializationRecordV1,
} from '../../../../../../packages/snapback-client/materialization-store.mjs';

const baseRows = [
  { _id: 'card-a', key: 'a', title: 'A', columnKey: 'c0', rank: 100, assigneeId: 'alice', archived: false, locked: false, revision: 0 },
  { _id: 'card-b', key: 'b', title: 'B', columnKey: 'c1', rank: 200, assigneeId: 'bob', archived: false, locked: false, revision: 0 },
  { _id: 'card-locked', key: 'locked', title: 'Locked', columnKey: 'c0', rank: 300, assigneeId: 'cara', archived: false, locked: true, revision: 0 },
];

assert.notEqual(
  prepareMaterializationRecordV1(qmk1BoardMaterialization(baseRows).record),
  null,
  'the spike consumes the landed materialization record shape, not an invented surrogate',
);

const run = (name, args, { rows = baseRows, materializationOptions, ids = [] } = {}) => {
  const operation = KANBAN_OPERATIONS[name];
  return evaluateKanbanMutationSpike({
    name,
    plan: operation.plan,
    declaredEffectClass: operation.effectClass,
    localReadRequirements: operation.localReadRequirements,
    args,
    ctxLedger: { version: 1, ids, now: 1_785_710_400_000 },
    materializations: [qmk1BoardMaterialization(rows, materializationOptions)],
  });
};

{
  const outcome = run('create', {
    key: 'new', title: 'New', columnKey: 'c0', rank: 50, assigneeId: 'alice',
  }, { ids: ['provisional-card-new'] });
  assert.equal(outcome.admission, 'ready');
  assert.deepEqual(outcome.layers[0].rows.map((row) => row._id), [
    'provisional-card-new', 'card-a', 'card-locked', 'card-b',
  ]);
  assert.equal(outcome.prediction.ledgerClaim.authority, 'labeled-client-claim');
}

{
  const edit = run('edit', { id: 'card-a', title: 'Edited', expectedRevision: 0 });
  assert.equal(edit.admission, 'ready');
  assert.equal(edit.layers[0].rows.find((row) => row._id === 'card-a').title, 'Edited');

  const assign = run('assign', { id: 'card-a', assigneeId: 'cara', expectedRevision: 0 });
  assert.equal(assign.layers[0].rows.find((row) => row._id === 'card-a').assigneeId, 'cara');

  const archive = run('archive', { id: 'card-a', archived: true, expectedRevision: 0 });
  assert.equal(archive.layers[0].rows.find((row) => row._id === 'card-a').archived, true);

  const reorder = run('reorder', { id: 'card-a', columnKey: 'c1', rank: 250, expectedRevision: 0 });
  assert.deepEqual(reorder.layers[0].rows.map((row) => row._id), [
    'card-locked', 'card-b', 'card-a',
  ]);
}

{
  const locked = run('reorder', {
    id: 'card-locked', columnKey: 'c1', rank: 1, expectedRevision: 0,
  });
  assert.equal(locked.admission, 'ready');
  assert.equal(locked.code, 'SPIKE_PREDICTION_SKIPPED');
  assert.equal(locked.prediction.code, 'CARD_LOCKED');
  assert.deepEqual(locked.layers, []);
}

{
  const partial = run('edit', { id: 'card-a', title: 'Partial', expectedRevision: 0 }, {
    rows: [baseRows[0]],
    materializationOptions: {
      completeForTable: false,
      filters: [{ field: 'columnKey', value: 'c0' }],
    },
  });
  assert.equal(partial.admission, 'predictable-with-partial-input');

  const serverOnly = run('edit', { id: 'card-b', title: 'Unavailable', expectedRevision: 0 }, {
    rows: [baseRows[0]],
    materializationOptions: { completeForTable: false },
  });
  assert.equal(serverOnly.admission, 'server-only');
  assert.equal(serverOnly.code, 'SPIKE_POINT_READ_NOT_SATISFIABLE');
}

{
  const serverOnly = classifySpikePlan({
    steps: [{ AllocateSequence: { counter: 'cards', scope: { Literal: 'board' }, into: 'rank' } }],
    return_value: null,
  }, SPIKE_KANBAN_EFFECT_CLASS);
  assert.equal(serverOnly.admission, 'server-only');

  const refused = classifySpikePlan({
    steps: [{ Delete: { table: 'cards', id: { Arg: 'id' } } }],
    return_value: null,
  }, SPIKE_KANBAN_EFFECT_CLASS);
  assert.equal(refused.admission, 'refused');
}

{
  const operation = KANBAN_OPERATIONS.create;
  const unused = evaluateKanbanMutationSpike({
    name: 'create',
    plan: operation.plan,
    declaredEffectClass: operation.effectClass,
    localReadRequirements: [],
    args: { key: 'x', title: 'X', columnKey: 'c0', rank: 1, assigneeId: 'a' },
    ctxLedger: { version: 1, ids: ['first', 'unused'], now: 1 },
    materializations: [qmk1BoardMaterialization(baseRows)],
  });
  assert.equal(unused.admission, 'refused');
  assert.equal(unused.code, 'SNAPBACK_CTX_LEDGER_UNUSED_IDS');
}

console.log('phase1 IR evaluator sizing spike: all assertions passed');
