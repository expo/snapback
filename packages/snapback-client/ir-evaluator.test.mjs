import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  BROWSER_IR_CTX_CLAIM_LABEL,
  BROWSER_IR_LOCAL_EFFECT_CLASS,
  classifyLocalMutationIrV1,
  evaluateBrowserIrPlanV1,
  evaluateLocalMutationIrV1,
} from './ir-evaluator.mjs';

const schema = {
  tables: [{
    name: 'todos',
    fields: [
      { name: 'title' },
      { name: 'done' },
    ],
  }],
};
const initialRows = {
  todos: [{ _id: 'old', title: 'Old', done: false }],
};
const admittedPlan = {
  steps: [
    {
      Insert: {
        table: 'todos',
        values: { title: { Arg: 'newTitle' }, done: { Literal: false } },
        bind_id_as: 'newId',
      },
    },
    {
      Get: {
        table: 'todos',
        id: { Arg: 'id' },
        bind_as: 'row',
        else_error: 'TODO_NOT_FOUND',
      },
    },
    {
      Guard: {
        cond: {
          Binary: {
            op: 'Eq',
            left: { Field: { base: { Binding: 'row' }, key: 'done' } },
            right: { Literal: false },
          },
        },
        else_error: 'TODO_ALREADY_DONE',
      },
    },
    {
      Patch: {
        table: 'todos',
        id: { Arg: 'id' },
        values: { done: { Literal: true } },
      },
    },
  ],
  return_value: { Document: { table: 'todos', id: { Arg: 'id' } } },
};
const deletePlan = {
  steps: [{ Delete: { table: 'todos', id: { Arg: 'id' } } }],
  return_value: 'ChangedCount',
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
    return output;
  }
  return Object.is(value, -0) ? 0 : value;
};
const stableText = (value) => JSON.stringify(stableValue(value));
const valuesEqual = (left, right) => stableText(left) === stableText(right);
const rowsMatch = (expectedRows, actualRows) => {
  if (expectedRows.length !== actualRows.length) return false;
  const unmatched = [...actualRows];
  for (const expected of expectedRows) {
    const index = unmatched.findIndex((actual) => Object.entries(expected).every(
      ([key, value]) => Object.prototype.hasOwnProperty.call(actual, key)
        && valuesEqual(value, actual[key]),
    ));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
};

test('M1 evaluates the four-step ceiling into an immutable private layer', () => {
  const before = JSON.stringify(initialRows);
  const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
  Object.defineProperty(globalThis, 'Buffer', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: undefined,
  });
  let outcome;
  try {
    outcome = evaluateLocalMutationIrV1({
      name: 'createAndFinish',
      schema,
      initialRows,
      plan: admittedPlan,
      args: { id: 'old', newTitle: 'New' },
      ctxLedger: { version: 1, ids: ['new'], now: 1_785_758_400_000 },
      layerId: 'layer-1',
      declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
    });
  } finally {
    if (bufferDescriptor) Object.defineProperty(globalThis, 'Buffer', bufferDescriptor);
    else delete globalThis.Buffer;
  }

  assert.equal(outcome.classification, 'ready');
  assert.equal(outcome.code, 'SNAPBACK_IR_PREDICTION_READY');
  assert.equal(outcome.execution.status, 'committed');
  assert.equal(outcome.execution.changedCount, 2);
  assert.ok(valuesEqual(outcome.execution.inputCtxLedger, {
    version: 1,
    ids: ['new'],
    now: 1_785_758_400_000,
  }));
  assert.ok(valuesEqual(outcome.execution.outputCtxLedger, outcome.execution.inputCtxLedger));
  assert.equal(outcome.ledgerClaim.label, BROWSER_IR_CTX_CLAIM_LABEL);
  assert.equal(outcome.ledgerClaim.authority, 'never-authority');
  assert.equal(outcome.layer.visibility, 'private');
  assert.equal(outcome.layer.writes.length, 2);
  assert.deepEqual(outcome.layer.writes.map((write) => write.operation), ['insert', 'patch']);
  assert.equal(
    outcome.layer.declaredTableRows.todos.find((row) => row._id === 'old').done,
    true,
  );
  assert.equal(JSON.stringify(initialRows), before, 'the admitted base rows are never mutated');
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(Object.isFrozen(outcome.layer), true);
  assert.equal(Object.isFrozen(outcome.layer.writes), true);
});

test('M1 exposes all four admission classes without fabricating effects', () => {
  assert.equal(classifyLocalMutationIrV1({
    plan: admittedPlan,
    readAdmission: 'ready',
  }).classification, 'ready');
  assert.equal(classifyLocalMutationIrV1({
    plan: admittedPlan,
    readAdmission: 'predictable-with-partial-input',
  }).classification, 'predictable-with-partial-input');

  const serverOnly = evaluateLocalMutationIrV1({
    name: 'serverOnly',
    schema,
    initialRows,
    plan: admittedPlan,
    args: {},
    ctxLedger: { version: 1, ids: [], now: 0 },
    layerId: 'server-only-layer',
    readAdmission: 'server-only',
  });
  assert.equal(serverOnly.classification, 'server-only');
  assert.equal(serverOnly.layer, null);
  assert.equal(serverOnly.execution, null);

  const refused = evaluateLocalMutationIrV1({
    name: 'deleteWhereOutsideCeiling',
    schema,
    initialRows,
    plan: {
      steps: [{ DeleteWhere: { table: 'todos', filter: [] } }],
      return_value: 'ChangedCount',
    },
    args: {},
    ctxLedger: { version: 1, ids: [], now: 0 },
    layerId: 'refused-layer',
  });
  assert.equal(refused.classification, 'refused');
  assert.equal(refused.code, 'SNAPBACK_PLAN_EFFECT_CEILING');
  assert.equal(refused.layer, null);

  const authoritative = classifyLocalMutationIrV1({
    plan: {
      steps: [{ Guard: { cond: 'AuthUserId', else_error: 'NO_USER' } }],
      return_value: 'ChangedCount',
    },
  });
  assert.equal(authoritative.classification, 'server-only');
  assert.equal(authoritative.code, 'SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY');
});

test('M1 predicts a present-row single Delete', () => {
  const outcome = evaluateLocalMutationIrV1({
    name: 'deleteTodo',
    schema,
    initialRows,
    plan: deletePlan,
    args: { id: 'old' },
    ctxLedger: { version: 1, ids: [], now: 0 },
    layerId: 'delete-present-layer',
  });

  assert.equal(outcome.classification, 'ready');
  assert.equal(outcome.code, 'SNAPBACK_IR_PREDICTION_READY');
  assert.equal(outcome.execution.status, 'committed');
  assert.equal(outcome.execution.changedCount, 1);
  assert.equal(outcome.execution.result, 1);
  assert.deepEqual(outcome.layer.writes, [
    { operation: 'delete', table: 'todos', planStepIndex: 0, id: 'old' },
  ]);
  assert.deepEqual(outcome.layer.declaredTableRows.todos, []);
});

test('M1 predicts an absent-row single Delete as a soft no-op', () => {
  const outcome = evaluateLocalMutationIrV1({
    name: 'deleteMissingTodo',
    schema,
    initialRows,
    plan: deletePlan,
    args: { id: 'missing' },
    ctxLedger: { version: 1, ids: [], now: 0 },
    layerId: 'delete-absent-layer',
  });

  assert.equal(outcome.classification, 'ready');
  assert.equal(outcome.execution.status, 'committed');
  assert.equal(outcome.execution.changedCount, 0);
  assert.equal(outcome.execution.result, 0);
  assert.equal(outcome.layer.writes.length, 0);
  assert.ok(valuesEqual(outcome.layer.declaredTableRows.todos, initialRows.todos));
});

test('M1 keeps fanout and multiple Delete effects above the local ceiling', () => {
  const refusedPlans = [
    {
      steps: [{ DeleteWhere: { table: 'todos', filter: [] } }],
      return_value: 'ChangedCount',
    },
    {
      steps: [{
        InsertEach: {
          table: 'todos',
          source: { Arg: 'rows' },
          item_as: 'row',
          values: {},
        },
      }],
      return_value: 'ChangedCount',
    },
    {
      steps: [
        { Delete: { table: 'todos', id: { Arg: 'firstId' } } },
        { Delete: { table: 'todos', id: { Arg: 'secondId' } } },
      ],
      return_value: 'ChangedCount',
    },
  ];

  for (const plan of refusedPlans) {
    const outcome = classifyLocalMutationIrV1({ plan });
    assert.equal(outcome.classification, 'refused');
    assert.equal(outcome.code, 'SNAPBACK_PLAN_EFFECT_CEILING');
  }
});

test('a typed guard rejection atomically discards the private write set', () => {
  const outcome = evaluateLocalMutationIrV1({
    name: 'alreadyDone',
    schema,
    initialRows: { todos: [{ _id: 'old', title: 'Old', done: true }] },
    plan: admittedPlan,
    args: { id: 'old', newTitle: 'New' },
    ctxLedger: { version: 1, ids: ['new'], now: 3 },
    layerId: 'rejected-layer',
  });
  assert.equal(outcome.classification, 'ready');
  assert.equal(outcome.code, 'SNAPBACK_IR_PREDICTION_REJECTED');
  assert.equal(outcome.execution.status, 'rejected');
  assert.equal(outcome.execution.rejectionCode, 'TODO_ALREADY_DONE');
  assert.equal(outcome.execution.changedCount, null);
  assert.equal(outcome.execution.outputCtxLedger, null);
  assert.equal(outcome.layer, null);
  assert.ok(valuesEqual(outcome.execution.rows.todos, [
    { _id: 'old', done: true, title: 'Old' },
  ]));
});

test('the shipping executor replays all 37 D5 v1 cases exactly', async () => {
  const corpusDirectory = new URL('../../tests/conformance/data-tier/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('corpus.manifest.json', corpusDirectory), 'utf8'));
  let committed = 0;
  let rejected = 0;

  for (const entry of manifest.cases) {
    const testCase = JSON.parse(await readFile(new URL(entry.path, corpusDirectory), 'utf8'));
    const outcome = evaluateBrowserIrPlanV1({
      name: testCase.name,
      schema: testCase.schema,
      initialRows: testCase.seed,
      plan: testCase.plan,
      args: testCase.args,
      ctxLedger: testCase.ctxLedger,
      authUserId: testCase.authUserId,
    });
    assert.ok(valuesEqual(outcome.inputCtxLedger, testCase.ctxLedger), `${testCase.name}: input ledger`);
    if (testCase.expect.error) {
      rejected += 1;
      assert.equal(outcome.status, 'rejected', `${testCase.name}: rejection status`);
      assert.equal(outcome.rejectionCode, testCase.expect.error.code, `${testCase.name}: rejection code`);
      assert.equal(outcome.result, null, `${testCase.name}: rejected result`);
      assert.equal(outcome.changedCount, null, `${testCase.name}: rejected count`);
      assert.equal(outcome.outputCtxLedger, null, `${testCase.name}: rejected output ledger`);
      for (const table of testCase.schema.tables) {
        assert.ok(
          rowsMatch(testCase.seed?.[table.name] ?? [], outcome.rows[table.name]),
          `${testCase.name}: atomic rollback ${table.name}`,
        );
      }
    } else {
      committed += 1;
      assert.equal(outcome.status, 'committed', `${testCase.name}: commit status`);
      assert.ok(valuesEqual(outcome.result, testCase.expect.result), `${testCase.name}: result`);
      assert.equal(outcome.changedCount, testCase.expect.changedCount, `${testCase.name}: changed count`);
      assert.ok(valuesEqual(outcome.outputCtxLedger, testCase.ctxLedger), `${testCase.name}: output ledger`);
      for (const [table, expectedRows] of Object.entries(testCase.expect.rows ?? {})) {
        assert.ok(rowsMatch(expectedRows, outcome.rows[table]), `${testCase.name}: rows ${table}`);
      }
    }
  }

  assert.equal(manifest.cases.length, 37);
  assert.equal(committed, 26);
  assert.equal(rejected, 11);
});
