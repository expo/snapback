// Snapback demo authoring kit: source-authored schema + handler plans.
//
// @ref LLP 0004#schema-api — schema/handlers are source-authored and codegen-friendly.
// @ref LLP 0004#first-slice-api-decisions — handlers are declared as HostPlans (the
//   v0 server runs manifest-backed plans, not JS ctx.db handlers, which remain a
//   capability gap until the Ibex host-call bridge lands).
//
// These builders are *executed* by codegen (demos/_kit/codegen.mjs) to produce the
// generated manifests. Executing the definition module — rather than regex/AST
// parsing it — is a deliberate response to the Valet silent-drop failure recovered
// in LLP 0006 / LLP 0010#generated-artifacts: a typo is a loud runtime error here,
// never a field quietly missing from the persisted schema.

const FN = Symbol('snapback.fn');

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
  json: () => validator('Json', 'unknown'),
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

export function defineSchema(tables) {
  assert(tables && typeof tables === 'object', 'defineSchema expects a tables object');
  for (const [name, table] of Object.entries(tables)) {
    assert(table && table.__table, `table ${name} must be defineTable(...)`);
  }
  return { __schema: true, tables };
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

// ---------------------------------------------------------------------------

export function isFunctionDef(value) {
  return Boolean(value && value[FN]);
}

export function assert(cond, message) {
  if (!cond) throw new Error(`[snapback-define] ${message}`);
}
