// Derived-overlay evaluator conformance (Exact LLP 0329 E-B).
//
// The JS overlay evaluator mirrors the shared Rust evaluator
// (src/value_expr.rs + the storage step semantics); the data-tier corpus
// (tests/conformance/data-tier/, LLP 0051 D5) pins both. This test replays
// every applicable corpus case against the derived reducer: accepted cases
// must predict the server's row outcomes, rejection cases must yield the
// rows UNCHANGED (overlay aborted — pending-without-overlay), never a wrong
// prediction. Plus unit coverage for the overlay-specific contract:
// idempotent re-application, stable provisional ids, and derivability
// scoping. Pure node — no server, no Exact.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveOptimisticReducer,
  deriveOptimisticReducers,
  evalValueExpr,
  planDerivableForTable,
  valuesEqual,
} from './derived-overlay.mjs';

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'conformance', 'data-tier');

const cases = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.case.json'))
  .map((name) => JSON.parse(readFileSync(join(corpusDir, name), 'utf8')));

assert.ok(cases.length >= 25, `corpus present (found ${cases.length} cases)`);

// --- placeholder-aware subset matching (the corpus README's row rules) ------

const matchValue = (expected, actual) => {
  if (expected === '$ANY_ID') return typeof actual === 'string' && actual.length > 0;
  if (expected === '$ANY_NOW') return typeof actual === 'number' && actual > 0;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((item, index) => matchValue(item, actual[index]))
    );
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) => matchValue(value, actual[key]));
  }
  return valuesEqual(actual, expected);
};

// Each expected row subset-matches one distinct actual row; count-exact.
const rowsMatch = (expectedRows, actualRows) => {
  if (expectedRows.length !== actualRows.length) return false;
  const unmatched = [...actualRows];
  for (const expected of expectedRows) {
    const index = unmatched.findIndex((actual) => matchValue(expected, actual));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
};

// --- corpus replay -----------------------------------------------------------

let replayed = 0;
let abortReplayed = 0;
const skipped = [];

for (const testCase of cases) {
  const tables = testCase.schema?.tables ?? [];
  if (tables.length !== 1) {
    skipped.push(`${testCase.name} (multi-table schema)`);
    continue;
  }
  const table = tables[0].name;
  if (!planDerivableForTable(testCase.plan, table)) {
    skipped.push(`${testCase.name} (plan not derivable for ${table})`);
    continue;
  }

  const seed = (testCase.seed?.[table] ?? []).map((row) => ({ ...row }));
  const errors = [];
  const reducer = deriveOptimisticReducer({
    name: testCase.name,
    plan: testCase.plan,
    table,
    onError: (code, message, details) => errors.push({ code, message, details }),
  });
  assert.ok(reducer, `${testCase.name}: reducer derives`);

  const out = reducer(seed, testCase.args ?? {}, {
    userId: testCase.authUserId ?? null,
    optimisticId: 'optimistic_1',
    baseVersion: null,
  });

  if (testCase.expect?.error) {
    // Server rejects: the overlay must predict NOTHING — rows unchanged is
    // the invariant. The abort diagnostic is best-effort: rejections living
    // outside the overlay's step scope (e.g. an over-bound return_value
    // expression) never evaluate client-side, so nothing aborts.
    assert.deepEqual(out, seed, `${testCase.name}: rejected plan leaves rows unchanged`);
    assert.ok(errors.length <= 1, `${testCase.name}: at most one abort report`);
    abortReplayed += 1;
    continue;
  }

  const expectedRows = testCase.expect?.rows?.[table];
  if (!expectedRows) {
    // Expression-semantics cases: empty steps, an Expr return, and an
    // expected result. Replay the expression through the evaluator directly —
    // these pin exactly the value-model rules the overlay shares with the
    // Rust evaluator.
    const returnExpr = testCase.plan?.return_value?.Expr;
    if ((testCase.plan?.steps ?? []).length === 0 && returnExpr && 'result' in (testCase.expect ?? {})) {
      const value = evalValueExpr(returnExpr, {
        args: testCase.args ?? {},
        authUserId: testCase.authUserId ?? null,
        bindings: new Map(),
        nowMs: Date.now(),
        runtimeId: () => 'expr_replay_id',
      });
      assert.ok(
        matchValue(testCase.expect.result, value),
        `${testCase.name}: expression result matches\nexpected ${JSON.stringify(testCase.expect.result)}\nactual   ${JSON.stringify(value)}`,
      );
      replayed += 1;
      continue;
    }
    skipped.push(`${testCase.name} (no expected rows)`);
    continue;
  }
  // Overlay rows are predictions: strip the overlay-only marker before
  // comparing against the server-semantics expectation.
  const comparable = out.map(({ optimistic, ...row }) => row);
  assert.ok(
    rowsMatch(expectedRows, comparable),
    `${testCase.name}: overlay predicts the corpus row outcome\nexpected ${JSON.stringify(expectedRows)}\nactual   ${JSON.stringify(comparable)}`,
  );
  assert.equal(errors.length, 0, `${testCase.name}: no abort on an accepted case`);
  replayed += 1;
}

assert.ok(replayed >= 15, `replayed ${replayed} accepted cases (>= 15 expected)`);
assert.ok(abortReplayed >= 9, `replayed ${abortReplayed} rejection cases (>= 9 expected)`);

// --- overlay-specific units ---------------------------------------------------

const todoPlan = {
  steps: [
    {
      Insert: {
        table: 'todos',
        values: {
          title: { Arg: 'title' },
          completed: { Literal: false },
          userId: 'AuthUserId',
        },
        bind_id_as: 'todoId',
      },
    },
  ],
  return_value: { Binding: 'todoId' },
};

// Idempotent re-application: rows that already contain the committed effect
// (a non-optimistic stable-field match at a version above baseVersion) must
// not gain a duplicate optimistic copy (ENG-23385, the derived dual).
{
  const reducer = deriveOptimisticReducer({ name: 'createTodo', plan: todoPlan, table: 'todos' });
  const committed = [
    { _id: 'todo_2', title: 'milk', completed: false, userId: 'u1', _version: 2 },
  ];
  const out = reducer(committed, { title: 'milk' }, { userId: 'u1', optimisticId: 'opt_1', baseVersion: 1 });
  assert.equal(out.length, 1, 'committed row is not doubled');

  // A pre-existing look-alike BELOW baseVersion is NOT this commit: append.
  const preExisting = [
    { _id: 'todo_1', title: 'milk', completed: false, userId: 'u1', _version: 1 },
  ];
  const out2 = reducer(preExisting, { title: 'milk' }, { userId: 'u1', optimisticId: 'opt_2', baseVersion: 2 });
  assert.equal(out2.length, 2, 'duplicate-title create still appends');
  assert.equal(out2[1].optimistic, true, 'appended row is marked optimistic');
}

// Stable provisional ids: re-application yields identical output (the
// adapter re-applies on every server-rows write during the in-flight window).
{
  const reducer = deriveOptimisticReducer({ name: 'createTodo', plan: todoPlan, table: 'todos' });
  const ctx = { userId: 'u1', optimisticId: 'opt_9', baseVersion: 0 };
  const first = reducer([], { title: 'a' }, ctx);
  const second = reducer([], { title: 'a' }, ctx);
  assert.deepEqual(first, second, 'derived reducer is deterministic per optimisticId');
  assert.equal(first[0]._id, 'opt_9', 'first provisional id is the optimisticId');
}

// Derivability scoping: a plan naming a table the boundary cannot see does
// not derive (pending-without-overlay beats a wrong prediction).
{
  const crossTablePlan = {
    steps: [
      { Insert: { table: 'todos', values: { title: { Arg: 'title' } }, bind_id_as: null } },
      { Insert: { table: 'audit', values: { title: { Arg: 'title' } }, bind_id_as: null } },
    ],
    return_value: null,
  };
  assert.equal(planDerivableForTable(crossTablePlan, 'todos'), false);
  assert.equal(
    deriveOptimisticReducer({ name: 'x', plan: crossTablePlan, table: 'todos' }),
    null,
  );
}

// Manifest-level derivation: only mutations with derivable embedded plans.
{
  const manifest = {
    queries: { listTodos: { reads: ['todos'] } },
    mutations: {
      withPlan: { plan: todoPlan },
      noPlan: {},
    },
  };
  const derived = deriveOptimisticReducers({ manifest, table: 'todos' });
  assert.ok(typeof derived.withPlan === 'function');
  assert.ok(!('noPlan' in derived));
}

console.log(
  `derived-overlay.test.mjs: all assertions passed `
  + `(${replayed} corpus cases predicted, ${abortReplayed} rejections aborted, ${skipped.length} skipped)`,
);
for (const reason of skipped) console.log(`  skipped: ${reason}`);
