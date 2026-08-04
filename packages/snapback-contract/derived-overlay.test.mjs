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

  const replayIds = [...(testCase.ctxLedger?.ids ?? [])];
  const out = reducer(seed, testCase.args ?? {}, {
    userId: testCase.authUserId ?? null,
    optimisticId: 'optimistic_1',
    baseVersion: null,
    nowMs: testCase.ctxLedger?.now,
    runtimeId: replayIds.length ? () => replayIds.shift() : undefined,
  });

  if (testCase.expect?.error) {
    // Expression-only rejection cases are the paired D5 evaluator contract:
    // require the same typed code, not merely the same no-row side effect.
    const returnExpr = testCase.plan?.return_value?.Expr;
    if ((testCase.plan?.steps ?? []).length === 0 && returnExpr) {
      let thrown = null;
      try {
        evalValueExpr(returnExpr, {
          args: testCase.args ?? {},
          authUserId: testCase.authUserId ?? null,
          bindings: new Map(),
          nowMs: Date.now(),
          runtimeId: () => 'expr_replay_id',
        });
      } catch (error) {
        thrown = error;
      }
      assert.equal(
        thrown?.code,
        testCase.expect.error.code,
        `${testCase.name}: expression rejection code matches`,
      );
    }
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

// Actor-bearing authorization inputs are resolved and intersected only by the
// host. A retained client must fail closed instead of attempting to predict
// either projection from optimistic state.
for (const expression of ['AuthKind', 'AuthActorKind', 'AuthIsDelegated']) {
  assert.throws(
    () => evalValueExpr(expression, { args: {}, bindings: new Map() }),
    (error) => error?.code === 'SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY',
    `${expression} is server-authoritative`,
  );
}

// Native ECMAScript is the independent oracle for the mirrored client
// evaluator. These are adjacent representable doubles around both half
// boundaries; Math.floor(x + 0.5) gets the first case wrong.
for (const value of [
  0.49999999999999994,
  0.5,
  0.5000000000000001,
  -0.5000000000000001,
  -0.5,
  -0.49999999999999994,
]) {
  const expected = Math.round(value);
  const normalizedExpected = Object.is(expected, -0) ? 0 : expected;
  const actual = evalValueExpr(
    { Call: { func: 'round', args: [{ Literal: value }] } },
    { args: {}, bindings: new Map() },
  );
  assert.equal(actual, normalizedExpected, `round(${value}) matches ECMAScript Math.round`);
}

// Record construction is a JSON-data operation, not ordinary JS assignment:
// the legal key __proto__ must be an own field on a null-prototype record.
{
  const expr = JSON.parse('{"Record":{"fields":{"__proto__":{"Literal":"own-data"}}}}');
  const value = evalValueExpr(expr, { args: {}, bindings: new Map() });
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.prototype.hasOwnProperty.call(value, '__proto__'), true);
  assert.equal(value.__proto__, 'own-data');
}

// The overlay sees the JSON transport value, never raw JavaScript values.
// Pin every external evaluator source (Arg, Field, and Binding), recursively:
// non-finite numbers and unsupported array slots become null, unsupported
// object fields disappear, and -0 becomes JSON's +0.
{
  const unsupported = () => {};
  const symbol = Symbol('not-json');
  const nested = [NaN, -Infinity, -0, undefined, unsupported, symbol];
  nested.length = 7; // Sparse slots follow JSON.stringify's null rule too.
  const payload = {
    score: Infinity,
    nested,
    absent: undefined,
    callback: unsupported,
    token: symbol,
  };
  const arg = evalValueExpr({ Arg: 'payload' }, {
    args: { payload },
    bindings: new Map(),
  });
  assert.equal(Object.getPrototypeOf(arg), null, 'Arg objects enter the JSON record model');
  assert.equal(arg.score, null, 'Arg recursively normalizes non-finite numbers');
  assert.deepEqual(arg.nested, [null, null, 0, null, null, null, null]);
  assert.deepEqual(Object.keys(arg).sort(), ['nested', 'score']);

  const field = evalValueExpr({
    Field: { base: { Arg: 'payload' }, key: 'score' },
  }, { args: { payload }, bindings: new Map() });
  assert.equal(field, null, 'Field reads the canonicalized Arg object');

  const binding = evalValueExpr({ Binding: 'saved' }, {
    args: {},
    bindings: new Map([['saved', payload]]),
  });
  assert.equal(binding.score, null, 'Binding recursively normalizes non-finite numbers');
  assert.deepEqual(binding.nested, [null, null, 0, null, null, null, null]);
  assert.deepEqual(Object.keys(binding).sort(), ['nested', 'score']);
}

// The same three source forms are pinned through an actual optimistic plan,
// not only through the exported evaluator helper.
{
  const payload = { score: Infinity, nested: [Infinity, undefined] };
  const plan = {
    steps: [
      { Let: { bind_as: 'saved', expr: { Arg: 'payload' } } },
      {
        Insert: {
          table: 'todos',
          values: {
            argValue: { Arg: 'rawNumber' },
            fieldValue: { Field: { base: { Arg: 'payload' }, key: 'score' } },
            bindingValue: { Binding: 'saved' },
          },
          bind_id_as: null,
        },
      },
    ],
    return_value: null,
  };
  const reducer = deriveOptimisticReducer({ name: 'jsonBoundary', plan, table: 'todos' });
  const [row] = reducer([], { rawNumber: Infinity, payload }, {
    optimisticId: 'json_boundary_1',
    nowMs: 1,
  });
  assert.equal(row.argValue, null, 'Arg cannot put Infinity in an optimistic row');
  assert.equal(row.fieldValue, null, 'Field cannot put Infinity in an optimistic row');
  assert.equal(row.bindingValue.score, null, 'Binding cannot put Infinity in an optimistic row');
  assert.deepEqual(row.bindingValue.nested, [null, null]);
}

// Values whose transport result could be effectful or cannot exist in JSON
// abort the prediction. The mutation still goes to the server; only the
// potentially dishonest optimistic row is suppressed.
{
  const plan = {
    steps: [{
      Insert: {
        table: 'todos',
        values: { payload: { Arg: 'payload' } },
        bind_id_as: null,
      },
    }],
    return_value: null,
  };
  const rejects = [
    1n,
    new Date(0),
    { toJSON: () => ({ changed: true }) },
    Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 }),
  ];
  const cyclic = {};
  cyclic.self = cyclic;
  rejects.push(cyclic);
  for (const payload of rejects) {
    const errors = [];
    const reducer = deriveOptimisticReducer({
      name: 'rejectNonJson',
      plan,
      table: 'todos',
      onError: (_code, _message, details) => errors.push(details),
    });
    const original = [{ _id: 'existing' }];
    assert.equal(reducer(original, { payload }, { optimisticId: 'rejected' }), original);
    assert.equal(errors[0]?.code, 'SNAPBACK_EXPR_TYPE');
  }

  for (const [payload, expectedCode] of [
    [undefined, 'SNAPBACK_ARG_MISSING'],
    [() => {}, 'SNAPBACK_EXPR_TYPE'],
    [Symbol('not-json'), 'SNAPBACK_EXPR_TYPE'],
  ]) {
    const errors = [];
    const reducer = deriveOptimisticReducer({
      name: 'rejectUnsupportedRoot',
      plan,
      table: 'todos',
      onError: (_code, _message, details) => errors.push(details),
    });
    const original = [{ _id: 'existing' }];
    assert.equal(reducer(original, { payload }, { optimisticId: 'rejected' }), original);
    assert.equal(errors[0]?.code, expectedCode);
  }
}

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

// D1 answer order matches the Rust HostPlan evaluator exactly: implicit
// insert id, value-map RuntimeId, then return-expression RuntimeId.
{
  const answers = [];
  const plan = {
    steps: [{
      Insert: {
        table: 'todos',
        values: { title: { Arg: 'title' }, token: 'RuntimeId' },
        bind_id_as: 'rowId',
      },
    }],
    return_value: { Expr: 'RuntimeId' },
  };
  const reducer = deriveOptimisticReducer({ name: 'orderedIds', plan, table: 'todos' });
  const rows = reducer([], { title: 'ordered' }, {
    optimisticId: 'fallback',
    runtimeId() {
      const id = `ledger_${answers.length + 1}`;
      answers.push(id);
      return id;
    },
    nowMs: 1,
  });
  assert.deepEqual(answers, ['ledger_1', 'ledger_2', 'ledger_3']);
  assert.equal(rows[0]._id, 'ledger_1');
  assert.equal(rows[0].token, 'ledger_2');
}

// DeleteWhere lowers filter values once before its scan (not once per row),
// which is also load-bearing for ledger consumption.
{
  let calls = 0;
  const plan = {
    steps: [{
      DeleteWhere: {
        table: 'todos',
        filter: [{ field: 'token', op: 'Eq', value: 'RuntimeId' }],
      },
    }],
    return_value: 'ChangedCount',
  };
  const reducer = deriveOptimisticReducer({ name: 'deleteToken', plan, table: 'todos' });
  reducer([{ token: 'id_1' }, { token: 'id_2' }], {}, {
    optimisticId: 'fallback',
    runtimeId: () => `id_${++calls}`,
    nowMs: 1,
  });
  assert.equal(calls, 1);
}

// Manifest-level derivation: only mutations with derivable embedded plans.
{
  const manifest = {
    queries: { listTodos: { reads: ['todos'] } },
    mutations: {
      withPlan: { plan: todoPlan },
      ordinaryJsLegacyFlag: { optimistic: false, plan: todoPlan },
      withheld: { optimistic: false, atomicOptimisticWithholding: true, plan: todoPlan },
      noPlan: {},
    },
  };
  const derived = deriveOptimisticReducers({ manifest, table: 'todos' });
  assert.ok(typeof derived.withPlan === 'function');
  assert.ok(
    typeof derived.ordinaryJsLegacyFlag === 'function',
    'optimistic:false alone does not carry sequence-atomic withholding authority',
  );
  assert.ok(!('withheld' in derived));
  assert.ok(!('noPlan' in derived));
}

// LLP 0135 §5.1: withholding is mutation-atomic across projections. A mixed
// changeset has a sequence-bearing message insert and a sequence-free room
// patch; neither the messages projection nor the rooms-only projection may
// derive an optimistic reducer for the mutation.
{
  const mixedSequencePlan = {
    steps: [
      {
        AllocateSequence: {
          counter: 'messageNumber',
          scope: { Arg: 'roomId' },
          into: 'sequence',
        },
      },
      {
        Insert: {
          table: 'messages',
          values: {
            roomId: { Arg: 'roomId' },
            sequence: { Binding: 'sequence' },
            body: { Arg: 'body' },
          },
          bind_id_as: 'messageId',
        },
      },
      {
        Patch: {
          table: 'rooms',
          id: { Arg: 'roomId' },
          values: { lastBody: { Arg: 'body' } },
        },
      },
    ],
    return_value: { Binding: 'sequence' },
  };
  const manifest = {
    mutations: {
      send: {
        plan: mixedSequencePlan,
        optimistic: false,
        atomicOptimisticWithholding: true,
      },
    },
  };
  for (const table of ['messages', 'rooms']) {
    assert.ok(
      !('send' in deriveOptimisticReducers({ manifest, table })),
      `${table} projection withholds the complete mixed sequence changeset`,
    );
  }
}

console.log(
  `derived-overlay.test.mjs: all assertions passed `
  + `(${replayed} corpus cases predicted, ${abortReplayed} rejections aborted, ${skipped.length} skipped)`,
);
for (const reason of skipped) console.log(`  skipped: ${reason}`);
