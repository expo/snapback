// The data-tier conformance corpus, authored with the typed builder.
//
// Every case below is BUILT with the define.mjs builder and serialized with
// the real codegen serializer, then committed as JSON under
// tests/conformance/data-tier/ (regen-and-diff gated by
// data-tier-corpus.test.mjs). That structure is itself the Increment 3
// builder-parity gate: if a case's plan cannot be authored through the
// builder, this module cannot produce it.
//
// The committed JSON — not this module — is the cross-language contract:
// the Rust runner (tests/data_tier_corpus_v0.rs) executes the JSON, and
// Exact-side evaluators (LLP 0329 E-A/E-C) consume the same files by
// reference. Cases are data (plans + rows), never JS functions.
//
// Corpus staging note (LLP 0051 D5 status honesty): the LLP 0010 corpus
// format and runners are designed, not built; until they land, these cases
// stage here as the bridge, with $ANY_NOW/$ANY_ID placeholders standing in
// for the ledger-driven exact outputs Increment 2/4 will enable.
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract

import { readFileSync } from 'node:fs';

import {
  arg, argOpt, authUserId, bindingRef, lit, runtimeNow,
  add, mod, mul, div, gte, cond, concat, call, coalesce, record, field, eqv, ne, or,
  insert, patch, del, get, guard, letBind, deleteWhere, insertEach,
  returnBinding, returnChangedCount, returnExpr, returnLiteral,
  defineMutation,
} from './define.mjs';
import { serializeMutationPlan } from './index.mjs';

const DATA_TIER_PROFILE = JSON.parse(
  readFileSync(new URL('../../schemas/data-tier.profile.json', import.meta.url), 'utf8'),
);

// The Rust-generated public profile is the authority. A profile bump now
// walks corpus generation instead of relying on a mirrored JS literal.
export const CORPUS_VERSION = DATA_TIER_PROFILE.profileVersion;

// Mirrors demos/all-aboard/snapback/handlers.mjs:11 (module-scope constant;
// data-tier-builder assertions in data-tier-corpus.test.mjs check the drift).
export const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];

const str = (name, optional = false) => ({ name, field_type: 'String', optional });
const int = (name, optional = false) => ({ name, field_type: 'Integer', optional });
const bool = (name, optional = false) => ({ name, field_type: 'Boolean', optional });
const jsonField = (name, optional = false) => ({ name, field_type: 'Json', optional });
const table = (name, fields, indexes = []) => ({ name, fields, indexes, syncable: false });

const TODO_SCHEMA = {
  tables: [table('todos', [str('title'), str('priority', true), bool('completed'), str('userId')])],
};

const AA_SCHEMA = {
  tables: [
    table('trainStatus', [int('delaySeconds'), str('status'), int('observedAt')]),
    table('liveDepartures', [
      str('departureId'), str('stationId'), str('direction'),
      int('predictedDepartureMs'), int('delaySeconds'), str('status'), int('observedAt'),
    ]),
    table('feedTicks', [jsonField('delays', true), str('note', true)]),
    table('feedRefreshState', [
      int('fetchedAt', true), int('tickIndex', true), int('tickCount', true),
      str('lastSource', true), str('lastRunTrigger', true), str('lastError', true),
      int('lastUpstreamPollAt', true),
    ]),
  ],
};

const EXPR_SCHEMA = { tables: [table('rows', [jsonField('value', true)])] };

const trainStatusSeed = () =>
  PATTERN_IDS.map((id) => ({ _id: id, delaySeconds: 0, status: 'on-time', observedAt: 1 }));

// --- Gate (b): the all-aboard mutations, authored entirely via the builder.
// The constant-driven unrolls are `.map()` metaprogramming — the exact shape
// the 0329 r3 transcription experiment showed a grammar cannot express well.

export function buildResetFeedPlan() {
  return defineMutation({
    args: {},
    plan: [
      ...PATTERN_IDS.map((id) =>
        patch('trainStatus', lit(id), {
          delaySeconds: lit(0),
          status: lit('on-time'),
          observedAt: runtimeNow(),
        })),
      deleteWhere('liveDepartures'),
      patch('feedRefreshState', lit('caltrain'), {
        fetchedAt: runtimeNow(),
        tickIndex: lit(0),
        lastSource: lit('reset'),
        lastRunTrigger: lit('reset'),
        lastError: lit(''),
        lastUpstreamPollAt: lit(0),
      }),
    ],
    returns: returnLiteral({ tickIndex: 0 }),
  }).plan;
}

export function buildApplyFeedTickPlan() {
  const delayFor = (id) => coalesce(field(bindingRef('delays'), id), lit(0));
  return defineMutation({
    args: { trigger: 'unused', source: 'unused', lastError: 'unused' },
    plan: [
      // Null-binding Get: on first run the state row is missing, the binding
      // is null, and the coalesce defaults reproduce the JS defensive reads.
      get('feedRefreshState', lit('caltrain'), 'state'),
      letBind('tickCount', coalesce(field(bindingRef('state'), 'tickCount'), lit(1))),
      letBind('nextIndex', mod(
        add(coalesce(field(bindingRef('state'), 'tickIndex'), lit(0)), lit(1)),
        call('max', lit(1), bindingRef('tickCount')),
      )),
      get('feedTicks', concat('tick-', bindingRef('nextIndex')), 'tick'),
      letBind('delays', coalesce(field(bindingRef('tick'), 'delays'), lit({}))),
      ...PATTERN_IDS.map((id) =>
        // Bracket-key access: every pattern id is a hyphenated JSON key.
        patch('trainStatus', lit(id), {
          delaySeconds: delayFor(id),
          status: cond(gte(delayFor(id), lit(120)), lit('delayed'), lit('on-time')),
          observedAt: runtimeNow(),
        })),
      deleteWhere('liveDepartures'),
      patch('feedRefreshState', lit('caltrain'), {
        fetchedAt: runtimeNow(),
        tickIndex: bindingRef('nextIndex'),
        lastSource: coalesce(argOpt('source'), lit('recorded')),
        lastRunTrigger: coalesce(argOpt('trigger'), lit('manual')),
        lastError: coalesce(argOpt('lastError'), lit('')),
      }),
    ],
    returns: returnExpr(record({
      tickIndex: bindingRef('nextIndex'),
      note: coalesce(field(bindingRef('tick'), 'note'), lit('')),
    })),
  }).plan;
}

// The applyLiveFeedSnapshot CORES only (clear-and-replace + clamp). The full
// mutation is the profile's negative exemplar (conditional writes) and stays
// JS-tier; these fragments are what the IR does own.
export function buildSnapshotFragmentsPlan() {
  const dep = (key) => field(bindingRef('dep'), key);
  return defineMutation({
    args: { departures: 'unused' },
    plan: [
      deleteWhere('liveDepartures'),
      insertEach('liveDepartures', arg('departures'), 'dep', {
        departureId: dep('departureId'),
        stationId: dep('stationId'),
        direction: dep('direction'),
        predictedDepartureMs: coalesce(dep('predictedDepartureMs'), runtimeNow()),
        delaySeconds: call('max', lit(-300), call('min', lit(3600), call('round', coalesce(dep('delaySeconds'), lit(0))))),
        status: coalesce(dep('status'), lit('on-time')),
        observedAt: runtimeNow(),
      }),
    ],
    returns: returnChangedCount(),
  }).plan;
}

const serialize = (plan) => serializeMutationPlan(plan);

export function buildCorpusCases() {
  const cases = [];
  const pushCase = (c) => cases.push({ corpus: 'snapback-data-tier', corpusVersion: CORPUS_VERSION, ...c });

  // ---- Gate (a): todo / todo-v2 plain CRUD (the shipped plan shapes) ----
  pushCase({
    name: 'todo-v2-create-todo',
    notes: 'Shipped todo-v2 createTodo plan (demos/todo-v2/snapback/functions.mjs): plain Insert + bound id return.',
    schema: TODO_SCHEMA,
    plan: serialize(defineMutation({
      args: { title: 'u', priority: 'u' },
      plan: insert('todos', {
        title: arg('title'), priority: arg('priority'), completed: lit(false), userId: authUserId(),
      }, { bindIdAs: 'todoId' }),
      returns: returnBinding('todoId'),
    }).plan),
    args: { title: 'Buy milk', priority: 'high' },
    authUserId: 'user-1',
    expect: {
      result: '$ANY_ID',
      changedCount: 1,
      rows: { todos: [{ title: 'Buy milk', priority: 'high', completed: false, userId: 'user-1', _id: '$ANY_ID' }] },
    },
  });

  pushCase({
    name: 'todo-v2-set-completed',
    notes: 'Shipped todo-v2 setCompleted: Patch by arg id, ChangedCount return.',
    schema: TODO_SCHEMA,
    seed: { todos: [{ _id: 't1', title: 'A', priority: 'low', completed: false, userId: 'user-1' }] },
    plan: serialize(defineMutation({
      args: { id: 'u', completed: 'u' },
      plan: patch('todos', arg('id'), { completed: arg('completed') }),
      returns: returnChangedCount(),
    }).plan),
    args: { id: 't1', completed: true },
    authUserId: 'user-1',
    expect: {
      result: 1,
      changedCount: 1,
      rows: { todos: [{ _id: 't1', completed: true, title: 'A' }] },
    },
  });

  pushCase({
    name: 'todo-v2-patch-missing-row-is-soft',
    notes: 'The JS defensive-get idiom lowers to plain Patch: a missing row is a no-op with changed count 0 (src/storage.rs patch path), never an error.',
    schema: TODO_SCHEMA,
    plan: serialize(defineMutation({
      args: { id: 'u' },
      plan: patch('todos', arg('id'), { completed: lit(true) }),
      returns: returnChangedCount(),
    }).plan),
    args: { id: 'missing' },
    authUserId: 'user-1',
    expect: { result: 0, changedCount: 0, rows: { todos: [] } },
  });

  pushCase({
    name: 'todo-v2-delete-todo',
    notes: 'Shipped todo-v2 deleteTodo: Delete by arg id.',
    schema: TODO_SCHEMA,
    seed: { todos: [{ _id: 't1', title: 'A', priority: 'low', completed: false, userId: 'user-1' }] },
    plan: serialize(defineMutation({
      args: { id: 'u' },
      plan: del('todos', arg('id')),
      returns: returnChangedCount(),
    }).plan),
    args: { id: 't1' },
    authUserId: 'user-1',
    expect: { result: 1, changedCount: 1, rows: { todos: [] } },
  });

  // ---- todo createTodo, v1 extension: Guard + trim ----
  const todoCreateGuarded = serialize(defineMutation({
    args: { title: 'u' },
    plan: [
      guard(ne(call('trim', arg('title')), lit('')), 'EMPTY_TITLE'),
      insert('todos', {
        title: call('trim', arg('title')), priority: lit('normal'), completed: lit(false), userId: authUserId(),
      }, { bindIdAs: 'todoId' }),
    ],
    returns: returnBinding('todoId'),
  }).plan);

  pushCase({
    name: 'todo-create-guarded',
    notes: 'todo createTodo in the v1 profile: Guard + trim (LLP 0051 D2 measured-profile row).',
    schema: TODO_SCHEMA,
    plan: todoCreateGuarded,
    args: { title: '  Walk dog  ' },
    authUserId: 'user-1',
    expect: {
      result: '$ANY_ID',
      changedCount: 1,
      rows: { todos: [{ title: 'Walk dog', completed: false, userId: 'user-1' }] },
    },
  });

  pushCase({
    name: 'todo-create-guarded-empty-title',
    notes: 'Guard failure is the author-supplied typed code; nothing commits.',
    schema: TODO_SCHEMA,
    plan: todoCreateGuarded,
    args: { title: '   ' },
    authUserId: 'user-1',
    expect: { error: { code: 'EMPTY_TITLE' }, rows: { todos: [] } },
  });

  // ---- Gate (b): all-aboard resetFeed / applyFeedTick via the builder ----
  pushCase({
    name: 'all-aboard-reset-feed',
    notes: 'resetFeed authored entirely via the builder: six constant-driven Patch unrolls (a .map over PATTERN_IDS), DeleteWhere with the empty filter, constant Literal return.',
    schema: AA_SCHEMA,
    seed: {
      trainStatus: PATTERN_IDS.map((id) => ({ _id: id, delaySeconds: 240, status: 'delayed', observedAt: 1 })),
      liveDepartures: [{ _id: 'd1', departureId: 'x', stationId: 's', direction: 'north', predictedDepartureMs: 5, delaySeconds: 0, status: 'on-time', observedAt: 1 }],
      feedRefreshState: [{ _id: 'caltrain', tickIndex: 4, tickCount: 5, lastSource: 'live' }],
    },
    plan: serialize(buildResetFeedPlan()),
    args: {},
    authUserId: null,
    expect: {
      result: { tickIndex: 0 },
      changedCount: 8,
      rows: {
        trainStatus: PATTERN_IDS.map((id) => ({ _id: id, delaySeconds: 0, status: 'on-time', observedAt: '$ANY_NOW' })),
        liveDepartures: [],
        feedRefreshState: [{ _id: 'caltrain', tickIndex: 0, lastSource: 'reset', lastRunTrigger: 'reset', lastError: '', lastUpstreamPollAt: 0, fetchedAt: '$ANY_NOW' }],
      },
    },
  });

  const applyFeedTick = serialize(buildApplyFeedTickPlan());

  pushCase({
    name: 'all-aboard-apply-feed-tick',
    notes: 'applyFeedTick authored entirely via the builder: null-binding Get, % and max, string-template tick id, bracket-key access on hyphenated pattern ids, record-constructor return. Pins the ||-vs-?? defaulting equivalence the schema/seed guarantee (LLP 0051 D2 profile-table row).',
    schema: AA_SCHEMA,
    seed: {
      trainStatus: trainStatusSeed(),
      feedTicks: [
        { _id: 'tick-0', delays: {}, note: '' },
        { _id: 'tick-2', delays: { 'sb-local': 240, 'nb-bullet': 60 }, note: 'signal hold at Bayshore' },
      ],
      feedRefreshState: [{ _id: 'caltrain', tickIndex: 1, tickCount: 3 }],
      liveDepartures: [{ _id: 'd1', departureId: 'x', stationId: 's', direction: 'north', predictedDepartureMs: 5, delaySeconds: 0, status: 'on-time', observedAt: 1 }],
    },
    plan: applyFeedTick,
    args: { trigger: 'cron', source: 'recorded' },
    authUserId: null,
    expect: {
      result: { tickIndex: 2, note: 'signal hold at Bayshore' },
      changedCount: 8,
      rows: {
        trainStatus: PATTERN_IDS.map((id) => ({
          _id: id,
          delaySeconds: id === 'sb-local' ? 240 : id === 'nb-bullet' ? 60 : 0,
          status: id === 'sb-local' ? 'delayed' : 'on-time',
          observedAt: '$ANY_NOW',
        })),
        liveDepartures: [],
        feedRefreshState: [{ _id: 'caltrain', tickIndex: 2, lastSource: 'recorded', lastRunTrigger: 'cron', lastError: '', fetchedAt: '$ANY_NOW' }],
      },
    },
  });

  pushCase({
    name: 'all-aboard-apply-feed-tick-first-run',
    notes: 'Same builder plan against an empty feedRefreshState: the Get binds null, coalesce defaults reproduce the JS first-run path ((state && state.tickCount) || 1), and the trailing Patch on the missing state row is a soft no-op.',
    schema: AA_SCHEMA,
    seed: {
      trainStatus: trainStatusSeed(),
      feedTicks: [{ _id: 'tick-0', delays: { 'sb-limited': 180 }, note: 'first' }],
    },
    plan: applyFeedTick,
    args: {},
    authUserId: null,
    expect: {
      result: { tickIndex: 0, note: 'first' },
      changedCount: 6,
      rows: {
        trainStatus: PATTERN_IDS.map((id) => ({
          _id: id,
          delaySeconds: id === 'sb-limited' ? 180 : 0,
          status: id === 'sb-limited' ? 'delayed' : 'on-time',
          observedAt: '$ANY_NOW',
        })),
        feedRefreshState: [],
      },
    },
  });

  pushCase({
    name: 'all-aboard-live-snapshot-fragments',
    notes: 'The applyLiveFeedSnapshot cores the IR does own: DeleteWhere clear + InsertEach bounded comprehension + the round/min/max clamp idiom. The full mutation is the conditional-writes negative exemplar and stays JS-tier.',
    schema: AA_SCHEMA,
    seed: {
      liveDepartures: [{ _id: 'stale', departureId: 'old', stationId: 's', direction: 'south', predictedDepartureMs: 1, delaySeconds: 0, status: 'on-time', observedAt: 1 }],
    },
    plan: serialize(buildSnapshotFragmentsPlan()),
    args: {
      departures: [
        { departureId: 'a', stationId: 'sf', direction: 'north', predictedDepartureMs: 100, delaySeconds: 3999.6, status: 'delayed' },
        { departureId: 'b', stationId: 'sj', direction: 'south', predictedDepartureMs: 200 },
      ],
    },
    authUserId: null,
    expect: {
      result: 3,
      changedCount: 3,
      rows: {
        liveDepartures: [
          { departureId: 'a', stationId: 'sf', direction: 'north', predictedDepartureMs: 100, delaySeconds: 3600, status: 'delayed', observedAt: '$ANY_NOW' },
          { departureId: 'b', stationId: 'sj', direction: 'south', predictedDepartureMs: 200, delaySeconds: 0, status: 'on-time', observedAt: '$ANY_NOW' },
        ],
      },
    },
  });

  // ---- Value-model and expression pins ----
  const exprCase = (name, notes, returnsExpr, expected, args = {}) => pushCase({
    name,
    notes,
    schema: EXPR_SCHEMA,
    plan: serialize({ steps: [], return_value: returnExpr(returnsExpr) }),
    args,
    authUserId: null,
    expect: { result: expected, changedCount: 0 },
  });

  exprCase(
    'expr-field-null-propagation',
    'Access on null/absent yields null and composes with coalesce; hyphenated keys are first-class (settles the IR half of 0329 EQ8).',
    record({
      hit: field(argOpt('tick'), 'delays', 'sb-local'),
      missTail: field(argOpt('tick'), 'delays', 'nb-bullet'),
      missBase: field(argOpt('absent'), 'anything'),
      defaulted: coalesce(field(argOpt('absent'), 'anything'), lit(7)),
    }),
    { hit: 90, missTail: null, missBase: null, defaulted: 7 },
    { tick: { delays: { 'sb-local': 90 } } },
  );

  exprCase(
    'expr-arithmetic-three-valued',
    'Arithmetic is JS-double with integral JSON output; a null operand yields null (three-valued, matching live-filter NULL semantics — NOT JS null-coercion).',
    record({
      mod: mod(lit(7), lit(3)),
      div: div(lit(7), lit(2)),
      nullAdd: add(lit(null), lit(1)),
      intForm: add(lit(2.5), lit(0.5)),
    }),
    { mod: 1, div: 3.5, nullAdd: null, intForm: 3 },
  );

  exprCase(
    'expr-truthiness-or-vs-coalesce',
    'And/Or are value-returning over JS truthiness; || and ?? diverge on falsy non-null values — the corpus pins both spellings.',
    record({
      orFalsy: or(lit(0), lit(5)),
      coalesceFalsy: coalesce(lit(0), lit(5)),
      orEmpty: or(lit(''), lit('fallback')),
      coalesceNull: coalesce(lit(null), lit('fallback')),
    }),
    { orFalsy: 5, coalesceFalsy: 0, orEmpty: 'fallback', coalesceNull: 'fallback' },
  );

  exprCase(
    'expr-ternary-comparison',
    'Ordering comparison + ternary: the delayed/on-time threshold shape every feed handler uses.',
    record({
      delayed: cond(gte(lit(240), lit(120)), lit('delayed'), lit('on-time')),
      onTime: cond(gte(lit(60), lit(120)), lit('delayed'), lit('on-time')),
      nullCmp: cond(gte(lit(null), lit(120)), lit('delayed'), lit('null-is-falsy')),
    }),
    { delayed: 'delayed', onTime: 'on-time', nullCmp: 'null-is-falsy' },
  );

  exprCase(
    'expr-string-template',
    'Concat stringification: integral numbers print without decimals (JSON.stringify parity), null prints "null", booleans print bare.',
    record({
      tickId: concat('tick-', add(lit(2), lit(1))),
      withNull: concat('x-', lit(null)),
      withBool: concat('is-', lit(true)),
      strAdd: add(lit('a'), lit('b')),
    }),
    { tickId: 'tick-3', withNull: 'x-null', withBool: 'is-true', strAdd: 'ab' },
  );

  exprCase(
    'expr-pinned-library',
    'Every pinned library function; round is JS Math.round (half-up toward +Infinity), len is UTF-16 code units, null propagates through the numeric/string functions.',
    record({
      len: call('len', lit('héllo')),
      lenArr: call('len', lit([1, 2, 3])),
      trim: call('trim', lit('  x  ')),
      lower: call('lower', lit('MiXeD')),
      abs: call('abs', lit(-4)),
      roundHalf: call('round', lit(0.5)),
      roundNegHalf: call('round', lit(-0.5)),
      floor: call('floor', lit(1.9)),
      ceil: call('ceil', lit(1.1)),
      clamp: call('max', lit(-300), call('min', lit(3600), call('round', lit(3999.6)))),
      nullProp: call('round', lit(null)),
      minNull: call('min', lit(1), lit(null)),
    }),
    {
      len: 5, lenArr: 3, trim: 'x', lower: 'mixed', abs: 4,
      roundHalf: 1, roundNegHalf: 0, floor: 1, ceil: 2, clamp: 3600,
      nullProp: null, minNull: null,
    },
  );

  exprCase(
    'expr-equality-value-model',
    'Eq/Ne are deep value equality with cross-representation numeric compare.',
    record({
      intFloat: eqv(lit(1), lit(1.0)),
      strNum: eqv(lit('1'), lit(1)),
      deepObj: eqv(lit({ a: [1] }), lit({ a: [1] })),
      ne: ne(lit('x'), lit('y')),
    }),
    { intFloat: true, strNum: false, deepObj: true, ne: true },
  );

  // ---- Step semantics pins ----
  pushCase({
    name: 'get-else-error',
    notes: 'Get with else_error set fails with that typed code on a missing row (mirrors Guard).',
    schema: TODO_SCHEMA,
    plan: serialize(defineMutation({
      args: { id: 'u' },
      plan: [
        get('todos', arg('id'), 'row', { elseError: 'TODO_NOT_FOUND' }),
        patch('todos', arg('id'), { completed: lit(true) }),
      ],
      returns: returnChangedCount(),
    }).plan),
    args: { id: 'missing' },
    authUserId: null,
    expect: { error: { code: 'TODO_NOT_FOUND' } },
  });

  pushCase({
    name: 'get-guard-read-check-write',
    notes: 'The guarded update: Get -> Guard -> Patch, read-check-write inside the commit transaction (DK-1 Option B ratified-and-extended; LLP 0051 D2).',
    schema: TODO_SCHEMA,
    seed: { todos: [{ _id: 't1', title: 'A', priority: 'low', completed: false, userId: 'owner' }] },
    plan: serialize(defineMutation({
      args: { id: 'u' },
      plan: [
        get('todos', arg('id'), 'row'),
        guard(eqvOwner(), 'NOT_OWNER'),
        patch('todos', arg('id'), { completed: lit(true) }),
      ],
      returns: returnChangedCount(),
    }).plan),
    args: { id: 't1' },
    authUserId: 'owner',
    expect: { result: 1, changedCount: 1, rows: { todos: [{ _id: 't1', completed: true }] } },
  });

  pushCase({
    name: 'get-guard-rejects-non-owner',
    notes: 'Same plan, wrong principal: the Guard fails with the typed code and nothing commits.',
    schema: TODO_SCHEMA,
    seed: { todos: [{ _id: 't1', title: 'A', priority: 'low', completed: false, userId: 'owner' }] },
    plan: serialize(defineMutation({
      args: { id: 'u' },
      plan: [
        get('todos', arg('id'), 'row'),
        guard(eqvOwner(), 'NOT_OWNER'),
        patch('todos', arg('id'), { completed: lit(true) }),
      ],
      returns: returnChangedCount(),
    }).plan),
    args: { id: 't1' },
    authUserId: 'intruder',
    expect: { error: { code: 'NOT_OWNER' }, rows: { todos: [{ _id: 't1', completed: false }] } },
  });

  pushCase({
    name: 'let-binding-chain',
    notes: 'Let bindings compose left to right and feed later steps.',
    schema: EXPR_SCHEMA,
    plan: serialize(defineMutation({
      args: {},
      plan: [
        letBind('x', lit(2)),
        letBind('y', mul3(bindingRef('x'))),
        insert('rows', { value: bindingRef('y') }),
      ],
      returns: returnExpr(bindingRef('y')),
    }).plan),
    args: {},
    authUserId: null,
    expect: { result: 6, changedCount: 1, rows: { rows: [{ value: 6 }] } },
  });

  pushCase({
    name: 'delete-where-filtered',
    notes: 'DeleteWhere with a non-empty filter deletes exactly the matching rows; filter semantics are the query/matcher semantics (one shared evaluator).',
    schema: TODO_SCHEMA,
    seed: {
      todos: [
        { _id: 'a', title: 'A', priority: 'low', completed: true, userId: 'u1' },
        { _id: 'b', title: 'B', priority: 'low', completed: false, userId: 'u1' },
        { _id: 'c', title: 'C', priority: 'low', completed: true, userId: 'u1' },
      ],
    },
    plan: serialize(defineMutation({
      args: {},
      plan: deleteWhere('todos', [{ field: 'completed', op: 'Eq', value: lit(true) }]),
      returns: returnChangedCount(),
    }).plan),
    args: {},
    authUserId: null,
    expect: { result: 2, changedCount: 2, rows: { todos: [{ _id: 'b', title: 'B' }] } },
  });

  // ---- Rejection pins (fail closed, typed, corpus-enumerated) ----
  pushCase({
    name: 'reject-unknown-function',
    notes: 'Calls outside the pinned library are typed rejections at plan validation, before any step executes.',
    schema: EXPR_SCHEMA,
    plan: { steps: [], return_value: { Expr: { Call: { func: 'eval', args: [] } } } },
    args: {},
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_EXPR_UNSUPPORTED_FUNCTION' } },
  });

  pushCase({
    name: 'reject-plan-over-step-bound',
    notes: 'Declared bounds are enforced, not assumed: 65 steps exceeds MAX_PLAN_STEPS (64).',
    schema: EXPR_SCHEMA,
    plan: {
      steps: Array.from({ length: 65 }, () => ({ Let: { bind_as: 'x', expr: { Literal: 1 } } })),
      return_value: null,
    },
    args: {},
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_PLAN_BOUNDS' } },
  });

  pushCase({
    name: 'reject-expr-over-depth-bound',
    notes: 'Expression depth over MAX_EXPR_DEPTH (32) is a bounds rejection.',
    schema: EXPR_SCHEMA,
    plan: {
      steps: [],
      return_value: { Expr: nestUnary({ Literal: 1 }, 34) },
    },
    args: {},
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_PLAN_BOUNDS' } },
  });

  pushCase({
    name: 'reject-insert-each-non-array',
    notes: 'InsertEach over a non-array source is a typed rejection.',
    schema: AA_SCHEMA,
    plan: serialize(defineMutation({
      args: { departures: 'u' },
      plan: insertEach('liveDepartures', arg('departures'), 'dep', {
        departureId: lit('x'), stationId: lit('s'), direction: lit('north'),
        predictedDepartureMs: lit(1), delaySeconds: lit(0), status: lit('on-time'), observedAt: runtimeNow(),
      }),
      returns: returnChangedCount(),
    }).plan),
    args: { departures: 5 },
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_PLAN_SOURCE_INVALID' } },
  });

  pushCase({
    name: 'reject-insert-each-over-fanout',
    notes: 'InsertEach fan-out is bounded by MAX_INSERT_EACH_FANOUT (1024); 1025 items reject.',
    schema: EXPR_SCHEMA,
    plan: serialize(defineMutation({
      args: { items: 'u' },
      plan: insertEach('rows', arg('items'), 'item', { value: bindingRef('item') }),
      returns: returnChangedCount(),
    }).plan),
    args: { items: Array.from({ length: 1025 }, (_, i) => i) },
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_PLAN_BOUNDS' } },
  });

  pushCase({
    name: 'reject-missing-binding',
    notes: 'Referencing an unbound name is a typed failure.',
    schema: EXPR_SCHEMA,
    plan: serialize({ steps: [], return_value: returnExpr(bindingRef('never-bound')) }),
    args: {},
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_BINDING_MISSING' } },
  });

  pushCase({
    name: 'reject-strict-arg-missing',
    notes: 'Strict Arg lookup fails typed on a missing arg; argOpt (Field over Args) is the defaulting spelling.',
    schema: EXPR_SCHEMA,
    plan: serialize({ steps: [], return_value: returnExpr(arg('nope')) }),
    args: {},
    authUserId: null,
    expect: { error: { code: 'SNAPBACK_ARG_MISSING' } },
  });

  return cases;
}

// Helper spellings kept out of the case bodies for readability.
function eqvOwner() {
  return eqv(field(bindingRef('row'), 'userId'), authUserId());
}

function mul3(expr) {
  return mul(expr, lit(3));
}

function nestUnary(inner, depth) {
  let expr = inner;
  for (let i = 0; i < depth; i += 1) expr = { Unary: { op: 'Neg', expr } };
  return expr;
}
