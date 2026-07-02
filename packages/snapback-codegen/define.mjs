// Snapback authoring surface: source-authored schema + handlers.
//
// @ref LLP 0004#schema-api — schema/handlers are source-authored and codegen-friendly.
// @ref LLP 0004#first-slice-api-decisions — source definitions codegen into
//   manifest-backed handlers; HostPlan remains for narrow deterministic fixtures
//   while JavaScript `ctx.db` handlers use the Ibex bridge.
//
// These builders are *executed* by codegen (packages/snapback-codegen/index.mjs)
// to produce the generated manifests. Executing the definition module — rather
// than regex/AST parsing it — is a deliberate response to the Valet silent-drop
// failure recovered in LLP 0006 / LLP 0010#generated-artifacts: a typo is a loud
// runtime error here, never a field quietly missing from the persisted schema.
//
// The definition markers below are Symbols, so guard checks work only against
// this module instance: every import path (including the demos/_kit/define.mjs
// compatibility shim) must resolve to this one file.

const FN = Symbol('snapback.fn');
const CRON = Symbol('snapback.cron');
const CONFIG = Symbol('snapback.config');
const EPHEMERAL_COLLECTION = Symbol('snapback.ephemeralCollection');
const EPHEMERAL = Symbol('snapback.ephemeral');

// ---------------------------------------------------------------------------
// Validators (field + arg types). The vocabulary maps 1:1 onto the server's
// FieldType enum and the Contract DataTypeDescriptor primitive names.
// ---------------------------------------------------------------------------

/** @ref LLP 0004#portability-rules — the validator vocabulary must map cleanly to
 *  SQLite, Postgres, generated types, and the wire format. */
function validator(fieldType, primitive) {
  return { __validator: true, fieldType, primitive, optional: false };
}

export const v = {
  string: () => validator('String', 'string'),
  boolean: () => validator('Boolean', 'boolean'),
  integer: () => validator('Integer', 'number'),
  real: () => validator('Real', 'number'),
  number: () => validator('Real', 'number'),
  json: () => validator('Json', 'unknown'),
  object: (fields) => {
    assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'v.object() expects a fields object');
    for (const [name, val] of Object.entries(fields)) {
      assert(val && val.__validator, `object field ${name} must be a validator`);
    }
    return { __validator: true, fieldType: 'Json', primitive: 'object', fields, optional: false };
  },
  optional: (inner) => {
    assert(inner && inner.__validator, 'v.optional() expects a validator');
    return { ...inner, optional: true };
  },
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

class TableBuilder {
  constructor(fields) {
    this.__table = true;
    this.fields = fields;
    this.indexes = [];
    this.syncable = false;
  }

  index(name, fields) {
    assert(Array.isArray(fields) && fields.length > 0, `index ${name} needs fields`);
    this.indexes.push({ name, fields });
    return this;
  }

  /** @ref LLP 0004#relationship-to-sync-and-realtime — only declared-syncable
   *  tables back the restricted syncable-live subset. */
  sync() {
    this.syncable = true;
    return this;
  }
}

export function defineTable(fields) {
  assert(fields && typeof fields === 'object', 'defineTable expects a fields object');
  for (const [name, val] of Object.entries(fields)) {
    assert(val && val.__validator, `field ${name} must be a validator (v.string(), ...)`);
  }
  return new TableBuilder(fields);
}

export function defineSchema(tables, options = {}) {
  assert(tables && typeof tables === 'object', 'defineSchema expects a tables object');
  for (const [name, table] of Object.entries(tables)) {
    assert(table && table.__table, `table ${name} must be defineTable(...)`);
  }
  const ephemeralDef = options.ephemeral ?? null;
  if (ephemeralDef !== null) {
    assert(ephemeralDef && ephemeralDef[EPHEMERAL], 'defineSchema option "ephemeral" must be defineEphemeral(...)');
  }
  return { __schema: true, tables, ephemeral: ephemeralDef };
}

// ---------------------------------------------------------------------------
// Ephemeral realtime collections
// ---------------------------------------------------------------------------
// @ref LLP 0013#proposal — source-authored ephemeral collections are typed,
// scoped, TTL-bounded latest-state maps rather than ad hoc realtime routes.

export const allow = {
  all: () => ({ __accessPolicy: true, kind: 'AllowAll' }),
  roomPermission: (prefix) => {
    assert(typeof prefix === 'string' && prefix.length > 0, 'allow.roomPermission() expects a prefix');
    return { __accessPolicy: true, kind: 'RequireRoomPermission', prefix };
  },
};

export const ephemeral = {
  collection(spec) {
    assert(spec && typeof spec === 'object', 'ephemeral.collection() expects a spec object');
    assert(spec.scope && typeof spec.scope === 'object', 'ephemeral.collection() requires scope');
    for (const [name, val] of Object.entries(spec.scope)) {
      assert(val && val.__validator, `ephemeral scope ${name} must be a validator`);
    }
    assert(spec.value && spec.value.__validator, 'ephemeral.collection() requires a value validator');
    return {
      [EPHEMERAL_COLLECTION]: true,
      scope: spec.scope,
      routing: spec.routing ?? Object.keys(spec.scope),
      key: spec.key ?? 'connection',
      ttlMs: spec.ttlMs,
      maxTtlMs: spec.maxTtlMs ?? 30_000,
      maxValueBytes: spec.maxValueBytes ?? 1_024,
      hardMaxValueBytes: spec.hardMaxValueBytes ?? 4_096,
      publishRate: spec.publishRate ?? { sustainedHz: 20, burst: 60 },
      delivery: spec.delivery ?? { mode: 'latest', dispatchMs: 33 },
      publish: spec.publish,
      subscribe: spec.subscribe,
      value: spec.value,
      targets: spec.targets ?? ['local-dev-sqlite-ibex'],
      maxPendingEphemeralKeys: spec.maxPendingEphemeralKeys ?? 1_024,
    };
  },
};

export function defineEphemeral(collections) {
  assert(collections && typeof collections === 'object', 'defineEphemeral expects a collections object');
  for (const [name, collection] of Object.entries(collections)) {
    assert(collection && collection[EPHEMERAL_COLLECTION], `ephemeral collection ${name} must be ephemeral.collection(...)`);
  }
  return { [EPHEMERAL]: true, collections };
}

// ---------------------------------------------------------------------------
// Value expressions (map onto the server's ValueExpr enum).
// ---------------------------------------------------------------------------

export const arg = (path) => ({ __expr: true, Arg: path });
export const authUserId = () => ({ __expr: true, kind: 'AuthUserId' });
export const lit = (value) => ({ __expr: true, Literal: value });
export const bindingRef = (name) => ({ __expr: true, Binding: name });
export const runtimeId = () => ({ __expr: true, kind: 'RuntimeId' });
export const runtimeNow = () => ({ __expr: true, kind: 'RuntimeNow' });

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export const eq = (field, value) => ({ field, op: 'Eq', value });
export const asc = (field) => ({ field, direction: 'Asc' });
export const desc = (field) => ({ field, direction: 'Desc' });

function queryDef(kind, spec) {
  assert(spec.table, `${kind} requires a table`);
  return {
    [FN]: true,
    __kind: kind, // 'Query' | 'LiveQuery'
    args: spec.args ?? {},
    // LLP 0034 D3 (Exact LLP 0284 §2.4): a chatty/expensive LiveQuery may opt
    // out of binding live by default; livePush capability is unaffected.
    ...(kind === 'LiveQuery' && spec.defaultLive === false ? { defaultLive: false } : {}),
    plan: {
      table: spec.table,
      filters: spec.filter ?? [],
      order: spec.order ?? [],
      limit: spec.limit ?? null,
      index: spec.index ?? null,
    },
  };
}

/** @ref LLP 0004#first-slice-api-decisions — defineLiveQuery is the restricted
 *  syncable-live subset; ordinary defineQuery is a callable server read only. */
export const defineLiveQuery = (spec) => queryDef('LiveQuery', spec);
export const defineQuery = (spec) => queryDef('Query', spec);

function jsQueryDef(kind, spec) {
  assert(spec.source, `${kind} requires a handler source file`);
  assert(spec.exportName, `${kind} requires exportName`);
  assert(spec.reads && Array.isArray(spec.reads) && spec.reads.length > 0, `${kind} requires declared reads`);
  if (spec.result !== undefined) {
    // LLP 0032 P3: a JS handler can return any shape, so its result rows are
    // typed only when declared. `result` describes the app fields of each
    // returned row (system fields ride along); undeclared results are typed
    // as an honest `unknown`, never guessed from the first read table.
    assert(spec.result && spec.result.__validator && spec.result.primitive === 'object', `${kind} result must be a v.object(...) row validator`);
  }
  return {
    [FN]: true,
    __kind: kind,
    args: spec.args ?? {},
    ...(spec.result !== undefined ? { result: spec.result } : {}),
    // LLP 0034 D3: per-definition defaultLive opt-out (see queryDef).
    ...(kind === 'LiveQuery' && spec.defaultLive === false ? { defaultLive: false } : {}),
    js: {
      source: spec.source,
      exportName: spec.exportName,
      reads: spec.reads,
      writes: [],
      authScopeField: spec.authScopeField ?? null,
      syncabilityClass: kind === 'LiveQuery' ? 'syncable-live' : 'online-only',
    },
  };
}

/** JavaScript handler declarations bundle a source file into the function
 * manifest. They are the Phase 2 bridge toward real `ctx.db` authoring; HostPlan
 * stays available for deterministic fixture coverage. */
export const defineJsLiveQuery = (spec) => jsQueryDef('LiveQuery', spec);
export const defineJsQuery = (spec) => jsQueryDef('Query', spec);

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

export const insert = (table, values, opts = {}) => ({
  Insert: { table, values, bind_id_as: opts.bindIdAs ?? null },
});
export const patch = (table, id, values) => ({ Patch: { table, id, values } });
export const del = (table, id) => ({ Delete: { table, id } });

export const returnBinding = (name) => ({ Binding: name });
export const returnChangedCount = () => ({ kind: 'ChangedCount' });
export const returnDocument = (table, id) => ({ Document: { table, id } });
export const returnLiteral = (value) => ({ Literal: value });

export function defineMutation(spec) {
  const steps = Array.isArray(spec.plan) ? spec.plan : [spec.plan];
  assert(steps.length > 0, 'defineMutation requires at least one plan step');
  return {
    [FN]: true,
    __kind: 'Mutation',
    args: spec.args ?? {},
    plan: { steps, return_value: spec.returns ?? null },
  };
}

export function defineJsMutation(spec) {
  assert(spec.source, 'defineJsMutation requires a handler source file');
  assert(spec.exportName, 'defineJsMutation requires exportName');
  assert(spec.writes && Array.isArray(spec.writes) && spec.writes.length > 0, 'defineJsMutation requires declared writes');
  return {
    [FN]: true,
    __kind: 'Mutation',
    args: spec.args ?? {},
    js: {
      source: spec.source,
      exportName: spec.exportName,
      reads: spec.reads ?? [],
      writes: spec.writes,
      syncabilityClass: 'mutation',
    },
  };
}

// ---------------------------------------------------------------------------
// Actions and cron
// ---------------------------------------------------------------------------

export const runMutation = (name, args = {}, opts = {}) => ({
  RunMutation: { name, args, bind_result_as: opts.bindResultAs ?? null },
});

export function defineAction(spec) {
  if (spec.js) {
    assert(spec.js.source, 'defineAction js.source is required');
    assert(spec.js.exportName, 'defineAction js.exportName is required');
    return {
      [FN]: true,
      __kind: 'Action',
      args: spec.args ?? {},
      // @ref LLP 0036#declared-configuration-in-the-manifest — D8: the config
      // entries this action may receive via ctx.secrets.
      uses: spec.uses ?? [],
      js: {
        source: spec.js.source,
        exportName: spec.js.exportName,
        reads: [],
        writes: spec.writes ?? [],
        syncabilityClass: 'action',
      },
    };
  }
  const steps = Array.isArray(spec.plan) ? spec.plan : [spec.plan];
  assert(steps.length > 0, 'defineAction requires a plan or js handler');
  return {
    [FN]: true,
    __kind: 'Action',
    args: spec.args ?? {},
    uses: spec.uses ?? [],
    plan: { steps, return_value: spec.returns ?? null },
    writes: spec.writes ?? [],
  };
}

export function defineCron(jobs) {
  assert(jobs && typeof jobs === 'object', 'defineCron expects a jobs object');
  return { [CRON]: true, jobs };
}

/**
 * Declare the app's config entries (API keys and deployment settings).
 * Names, purposes, and acquisition metadata are app source — public by
 * construction; values live only in the deployment's config store.
 *
 * @ref LLP 0036#declared-configuration-in-the-manifest — entries ride the
 * generated function manifest the way cron jobs do.
 */
export function defineConfig(entries) {
  assert(entries && typeof entries === 'object', 'defineConfig expects an entries object');
  return { [CONFIG]: true, entries };
}

// ---------------------------------------------------------------------------

export function isFunctionDef(value) {
  return Boolean(value && value[FN]);
}

export function isCronDef(value) {
  return Boolean(value && value[CRON]);
}

export function isConfigDef(value) {
  return Boolean(value && value[CONFIG]);
}

export function isEphemeralCollectionDef(value) {
  return Boolean(value && value[EPHEMERAL_COLLECTION]);
}

export function assert(cond, message) {
  if (!cond) throw new Error(`[snapback-define] ${message}`);
}
