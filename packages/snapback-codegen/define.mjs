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
const TABLE = Symbol('snapback.table');
const EPHEMERAL_COLLECTION = Symbol('snapback.ephemeralCollection');
const EPHEMERAL = Symbol('snapback.ephemeral');
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const REFLECT_APPLY = Reflect.apply;
const ARRAY_SLICE = Array.prototype.slice;
const AUTH_MODES = new Set(['dev', 'sessions']);
const AUTH_REQUIREMENTS = new Set(['public', 'optional-user', 'authenticated']);
const AUTHORIZATION_DIMENSIONS = new Set([
  'userId',
  'kind',
  'actorKind',
  'isDelegated',
  'sessionId',
  'provider',
  'roles',
  'isAuthenticated',
  'opaque',
]);
const QUERY_SPEC_FIELDS = new Set([
  'table', 'args', 'filter', 'order', 'limit', 'index', 'defaultLive',
  'auth', 'authorityIndependent', 'retainable', 'authScopeField', 'membership',
]);
const JS_QUERY_SPEC_FIELDS = new Set([
  'args', 'source', 'exportName', 'reads', 'result', 'authScopeField',
  'defaultLive', 'auth', 'authorityIndependent', 'retainable',
  'authorizationDependence',
]);
const TARGET_CAPABILITIES = new Set([
  'auth.sessions.v1',
  'cron',
  'cron_action_run_mutation',
  'host_plan_runtime',
  'ibex_ctx_db_host_bridge',
  'live_subscriptions',
  'mutation_read_set_validation',
  'permission_epoch_resync',
]);
const MEMBERSHIP_FIELDS = new Set([
  'id', 'principal', 'resource', 'role', 'roles', 'pendingRoles',
  'bootstrapRole', 'lastHolder', 'expiry', 'incidental', 'provenance',
  'transitions', 'scope',
]);
const MEMBERSHIP_TRANSITION_FIELDS = new Set([
  'op', 'by', 'target', 'from', 'to', 'fields',
]);
const MEMBERSHIP_OPS = new Set(['insert', 'setRole', 'remove', 'patch']);
const MEMBERSHIP_TARGETS = new Set(['self', 'other']);
const MEMBERSHIP_PROVENANCE = new Set(['creation', 'full']);

function authoredFunctionAuth(spec, kind) {
  // @ref LLP 0058#closed-function-requirement — authoring accepts only the
  // closed requirement and authority-independence spellings the Rust parser owns.
  const fields = {};
  if (spec.auth !== undefined) {
    assert(AUTH_REQUIREMENTS.has(spec.auth), `${kind} auth must be public, optional-user, or authenticated`);
    fields.auth = spec.auth;
  }
  if (spec.authorityIndependent !== undefined) {
    assert(typeof spec.authorityIndependent === 'boolean', `${kind} authorityIndependent must be boolean`);
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot be authorityIndependent`);
    fields.authorityIndependent = spec.authorityIndependent;
  }
  if (spec.authorityCreating !== undefined) {
    assert(typeof spec.authorityCreating === 'boolean', `${kind} authorityCreating must be boolean`);
    assert(kind === 'Mutation' || kind === 'Action', `${kind} cannot be authorityCreating`);
    fields.authorityCreating = spec.authorityCreating;
  }
  if (spec.retainable !== undefined) {
    assert(typeof spec.retainable === 'boolean', `${kind} retainable must be boolean`);
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot be retainable`);
    fields.retainable = spec.retainable;
  }
  if (spec.authorizationDependence !== undefined) {
    assert(kind === 'Query' || kind === 'LiveQuery', `${kind} cannot declare authorizationDependence`);
    assert(Array.isArray(spec.authorizationDependence), `${kind} authorizationDependence must be an array`);
    const seen = new Set();
    for (let index = 0; index < spec.authorizationDependence.length; index += 1) {
      const dimension = spec.authorizationDependence[index];
      assert(AUTHORIZATION_DIMENSIONS.has(dimension), `${kind} authorizationDependence contains unknown dimension ${String(dimension)}`);
      assert(!seen.has(dimension), `${kind} authorizationDependence repeats ${dimension}`);
      seen.add(dimension);
    }
    fields.authorizationDependence = REFLECT_APPLY(ARRAY_SLICE, spec.authorizationDependence, []);
  }
  return fields;
}

function assertKnownSpecFields(spec, kind, allowed) {
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), `${kind} expects a spec object`);
  const fields = Object.keys(spec);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    assert(allowed.has(field), `${kind} has unknown field ${field}`);
  }
}

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
  // @ref LLP 0056#declaring-a-membership-table — principal and application
  // ids stay strings on the wire while preserving their nominal identity in
  // the manifest for authorization-axis validation.
  principal: () => validator('Principal', 'string'),
  id: (table) => {
    assert(typeof table === 'string' && table.length > 0, 'v.id() expects a table name');
    return validator({ Id: { table } }, 'string');
  },
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

// The only two resource references admitted by the membership predicate IR.
// An app-scoped declaration uses the host-owned singleton rather than an app
// argument; TableBuilder.memberOf()/hasRole() also infer this form when their
// resource argument is omitted.
export const membershipResource = Object.freeze({
  arg(path) {
    assert(typeof path === 'string' && path.length > 0, 'membershipResource.arg() expects a path');
    return Object.freeze({ __membershipResourceRef: true, kind: 'arg', path });
  },
  rowField(field) {
    assert(typeof field === 'string' && field.length > 0, 'membershipResource.rowField() expects a field');
    return Object.freeze({ __membershipResourceRef: true, kind: 'rowField', field });
  },
  app() {
    return Object.freeze({ __membershipResourceRef: true, kind: 'app' });
  },
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function exactObject(value, where, allowed) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${where} must be an object`);
  for (const field of Object.keys(value)) {
    assert(allowed.has(field), `${where} has unknown field ${field}`);
  }
}

function stringArray(value, where, { allowEmpty = false } = {}) {
  assert(Array.isArray(value), `${where} must be an array`);
  assert(allowEmpty || value.length > 0, `${where} must not be empty`);
  const seen = new Set();
  for (const item of value) {
    assert(typeof item === 'string' && item.length > 0, `${where} entries must be non-empty strings`);
    assert(!seen.has(item), `${where} repeats ${item}`);
    seen.add(item);
  }
  return REFLECT_APPLY(ARRAY_SLICE, value, []);
}

function normalizeMembership(spec) {
  exactObject(spec, 'membership()', MEMBERSHIP_FIELDS);
  const scope = spec.scope ?? 'resource';
  assert(scope === 'resource' || scope === 'app', 'membership() scope must be resource or app');
  assert(typeof spec.principal === 'string' && spec.principal.length > 0, 'membership() requires principal');
  assert(typeof spec.role === 'string' && spec.role.length > 0, 'membership() requires role');
  if (scope === 'resource') {
    assert(typeof spec.resource === 'string' && spec.resource.length > 0, 'resource membership() requires resource');
  } else {
    assert(spec.resource === undefined, 'app membership() cannot declare a resource field');
  }
  if (spec.id !== undefined) assert(typeof spec.id === 'string' && spec.id.length > 0, 'membership() id must be non-empty');
  const roles = stringArray(spec.roles, 'membership() roles');
  const pendingRoles = spec.pendingRoles === undefined
    ? undefined
    : stringArray(spec.pendingRoles, 'membership() pendingRoles');
  const vocabulary = new Set([...roles, ...(pendingRoles ?? [])]);
  assert(vocabulary.size === roles.length + (pendingRoles?.length ?? 0), 'membership() roles and pendingRoles must be disjoint');

  if (spec.bootstrapRole !== undefined) {
    assert(roles.includes(spec.bootstrapRole), 'membership() bootstrapRole must be a declared non-pending role');
  }
  let lastHolder;
  if (spec.lastHolder !== undefined) {
    exactObject(spec.lastHolder, 'membership() lastHolder', new Set(['protect']));
    assert(roles.includes(spec.lastHolder.protect), 'membership() lastHolder.protect must be a non-pending role');
    lastHolder = { protect: spec.lastHolder.protect };
  }
  let expiry;
  if (spec.expiry !== undefined) {
    exactObject(spec.expiry, 'membership() expiry', new Set(['field', 'onExpiry']));
    assert(typeof spec.expiry.field === 'string' && spec.expiry.field.length > 0, 'membership() expiry.field is required');
    assert(spec.expiry.onExpiry === 'remove', 'membership() expiry.onExpiry must be remove');
    expiry = { field: spec.expiry.field, onExpiry: 'remove' };
  }
  const incidental = spec.incidental === undefined
    ? undefined
    : stringArray(spec.incidental, 'membership() incidental');
  if (spec.provenance !== undefined) {
    assert(MEMBERSHIP_PROVENANCE.has(spec.provenance), 'membership() provenance must be creation or full');
  }

  const transitions = (spec.transitions ?? []).map((transition, index) => {
    const where = `membership() transitions[${index}]`;
    exactObject(transition, where, MEMBERSHIP_TRANSITION_FIELDS);
    assert(MEMBERSHIP_OPS.has(transition.op), `${where}.op is invalid`);
    assert(MEMBERSHIP_TARGETS.has(transition.target), `${where}.target must be self or other`);
    const by = stringArray(transition.by, `${where}.by`);
    for (const caller of by) {
      assert(caller === 'self' || caller === 'none' || vocabulary.has(caller), `${where}.by names undeclared class ${caller}`);
    }
    const from = transition.from === undefined ? undefined : stringArray(transition.from, `${where}.from`);
    const to = transition.to === undefined ? undefined : stringArray(transition.to, `${where}.to`);
    for (const role of [...(from ?? []), ...(to ?? [])]) {
      assert(vocabulary.has(role), `${where} names undeclared role ${role}`);
    }
    const fields = transition.fields === undefined ? undefined : stringArray(transition.fields, `${where}.fields`);
    if (transition.op === 'insert') {
      assert(from === undefined, `${where}.from is forbidden for insert`);
      assert(to !== undefined, `${where}.to is required for insert`);
      assert(!by.includes('self'), `${where}.by cannot name self for insert`);
    } else if (transition.op === 'setRole') {
      assert(to !== undefined, `${where}.to is required for setRole`);
      assert(fields === undefined, `${where}.fields is forbidden for setRole`);
      assert(!by.includes('none'), `${where}.by cannot name none for setRole`);
    } else if (transition.op === 'remove') {
      assert(to === undefined && fields === undefined, `${where} remove forbids to and fields`);
      assert(!by.includes('none'), `${where}.by cannot name none for remove`);
    } else {
      assert(to === undefined, `${where}.to is forbidden for patch`);
      assert(fields !== undefined, `${where}.fields is required for patch`);
      assert(!by.includes('none'), `${where}.by cannot name none for patch`);
    }
    return {
      op: transition.op,
      by,
      target: transition.target,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(fields ? { fields } : {}),
    };
  });

  return {
    ...(spec.id !== undefined ? { id: spec.id } : {}),
    principal: spec.principal,
    ...(scope === 'resource' ? { resource: spec.resource } : {}),
    role: spec.role,
    roles,
    ...(pendingRoles ? { pendingRoles } : {}),
    ...(spec.bootstrapRole !== undefined ? { bootstrapRole: spec.bootstrapRole } : {}),
    ...(lastHolder ? { lastHolder } : {}),
    ...(expiry ? { expiry } : {}),
    ...(incidental ? { incidental } : {}),
    ...(spec.provenance !== undefined ? { provenance: spec.provenance } : {}),
    transitions,
    scope,
  };
}

class TableBuilder {
  constructor(fields) {
    this[TABLE] = true;
    this.__table = true;
    this.fields = fields;
    this.indexes = [];
    this.syncable = false;
  }

  /** @ref LLP 0007#index-contract — uniqueness is part of the portable index
   *  declaration, not a handler convention. */
  index(name, fields, options = {}) {
    assert(Array.isArray(fields) && fields.length > 0, `index ${name} needs fields`);
    assertKnownSpecFields(options, `index ${name} options`, new Set(['unique']));
    const unique = options.unique ?? false;
    assert(typeof unique === 'boolean', `index ${name} unique must be boolean`);
    this.indexes.push({ name, fields: REFLECT_APPLY(ARRAY_SLICE, fields, []), unique });
    return this;
  }

  /** @ref LLP 0004#relationship-to-sync-and-realtime — only declared-syncable
   *  tables back the restricted syncable-live subset. */
  sync() {
    this.syncable = true;
    return this;
  }

  /** Declare that this table contains authorization-granting facts. An
   * optional field list narrows only known updates; insert/delete and unknown
   * changed-field sets remain conservative.
   * @ref LLP 0053#two-orthogonal-declarations — permission backing is the
   *   independent authorization-dependence axis. */
  permissionBacking(fields) {
    assert(!this.permissionBackingDeclared, 'permissionBacking() may be declared only once per table');
    assert(!this.membershipDeclaration, 'permissionBacking() cannot be combined with membership()');
    if (fields !== undefined) {
      assert(Array.isArray(fields), 'permissionBacking() fields must be an array');
      for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        assert(typeof field === 'string', 'permissionBacking() fields must be strings');
      }
      this.permissionFields = REFLECT_APPLY(ARRAY_SLICE, fields, []);
    }
    this.permissionBackingDeclared = true;
    return this;
  }

  /** Declare this table as the closed role-per-resource authority primitive.
   * The resource table is derived later from the resource field's v.id(...)
   * validator, never repeated as an unverified string in this object.
   * @ref LLP 0056#declaring-a-membership-table — one declaration owns the
   * permission-backing derivation and its generated indexes. */
  membership(spec) {
    assert(!this.membershipDeclaration, 'membership() may be declared only once per table');
    assert(!this.permissionBackingDeclared, 'membership() cannot be combined with permissionBacking()');
    this.membershipDeclaration = normalizeMembership(spec);
    return this;
  }

  _membershipPredicate(resource, roles) {
    assert(this.membershipDeclaration, 'memberOf()/hasRole() requires membership()');
    const declaration = this.membershipDeclaration.id ?? this.__tableName;
    assert(declaration, 'membership helper table must be installed in defineSchema() before use');
    let reference = resource;
    if (this.membershipDeclaration.scope === 'app' && reference === undefined) {
      reference = membershipResource.app();
    }
    assert(reference?.__membershipResourceRef === true, 'membership helper expects membershipResource.arg(), rowField(), or app()');
    assert(
      this.membershipDeclaration.scope === 'app' ? reference.kind === 'app' : reference.kind !== 'app',
      `membership helper resource does not match ${this.membershipDeclaration.scope} scope`,
    );
    return Object.freeze({
      __membershipPredicate: true,
      declaration,
      resource: reference,
      roles,
    });
  }

  memberOf(resource) {
    return this._membershipPredicate(resource, null);
  }

  hasRole(resource, ...roles) {
    assert(this.membershipDeclaration, 'hasRole() requires membership()');
    if (this.membershipDeclaration?.scope === 'app' && typeof resource === 'string') {
      roles.unshift(resource);
      resource = undefined;
    }
    const normalized = stringArray(roles, 'hasRole() roles');
    const vocabulary = new Set([
      ...this.membershipDeclaration.roles,
      ...(this.membershipDeclaration.pendingRoles ?? []),
    ]);
    for (const role of normalized) assert(vocabulary.has(role), `hasRole() names undeclared role ${role}`);
    return this._membershipPredicate(resource, normalized);
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
    assert(!table.__tableName || table.__tableName === name, `one table builder cannot be installed as both ${table.__tableName} and ${name}`);
    table.__tableName = name;
  }
  const ephemeralDef = options.ephemeral ?? null;
  if (ephemeralDef !== null) {
    assert(ephemeralDef && ephemeralDef[EPHEMERAL], 'defineSchema option "ephemeral" must be defineEphemeral(...)');
  }
  let auth;
  // @ref LLP 0058#closed-auth-mode — auth mode is must-understand, including
  // unknown members on the otherwise additive schema authoring object.
  if (options.auth !== undefined) {
    assert(options.auth && typeof options.auth === 'object' && !Array.isArray(options.auth), 'defineSchema option "auth" must be an object');
    assert(Object.keys(options.auth).length === 1 && Object.hasOwn(options.auth, 'mode'), 'defineSchema option "auth" accepts only mode');
    assert(AUTH_MODES.has(options.auth.mode), 'defineSchema auth.mode must be dev or sessions');
    auth = { mode: options.auth.mode };
  }
  if (options.requiredCapabilities !== undefined) {
    assert(Array.isArray(options.requiredCapabilities), 'defineSchema requiredCapabilities must be an array');
    for (const capability of options.requiredCapabilities) {
      assert(TARGET_CAPABILITIES.has(capability), `unknown required target capability ${String(capability)}`);
    }
  }
  return {
    __schema: true,
    tables,
    ephemeral: ephemeralDef,
    ...(auth ? { auth } : {}),
    ...(options.requiredCapabilities !== undefined
      ? { requiredCapabilities: [...new Set(options.requiredCapabilities)] }
      : {}),
  };
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
      ...(spec.ttlMs !== undefined ? { ttlMs: spec.ttlMs } : {}),
      maxTtlMs: spec.maxTtlMs ?? 30_000,
      maxValueBytes: spec.maxValueBytes ?? 1_024,
      hardMaxValueBytes: spec.hardMaxValueBytes ?? 4_096,
      publishRate: spec.publishRate ?? { sustainedHz: 20, burst: 60 },
      delivery: spec.delivery ?? { mode: 'latest', dispatchMs: 33 },
      ...(spec.publish !== undefined ? { publish: spec.publish } : {}),
      ...(spec.subscribe !== undefined ? { subscribe: spec.subscribe } : {}),
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
//
// The typed builder is the FIRST-CLASS authoring surface for the data-tier
// IR (LLP 0051 D2): TS metaprogramming is load-bearing (constant-driven
// unrolls are a `.map()` here), and the expression set below is the closed
// v1 profile — no arrows, no closures, no free calls. Typings live in
// define.d.ts beside this file.
//
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   builder-first authoring; the Contract grammar is Exact LLP 0329's
//   evidence-gated option.
// ---------------------------------------------------------------------------

function expectExpr(value, where) {
  assert(value && value.__expr, `${where} expects a value expression`);
  return value;
}

export const arg = (path) => ({ __expr: true, Arg: path });
export const authUserId = () => ({ __expr: true, kind: 'AuthUserId' });
export const authKind = () => ({ __expr: true, kind: 'AuthKind' });
export const authActorKind = () => ({ __expr: true, kind: 'AuthActorKind' });
export const authIsDelegated = () => ({ __expr: true, kind: 'AuthIsDelegated' });
export const lit = (value) => ({ __expr: true, Literal: value });
export const bindingRef = (name) => ({ __expr: true, Binding: name });
export const runtimeId = () => ({ __expr: true, kind: 'RuntimeId' });
export const runtimeNow = () => ({ __expr: true, kind: 'RuntimeNow' });

/** The whole args object — the null-safe base for optional-arg access. */
export const argsRoot = () => ({ __expr: true, kind: 'Args' });

/** Null-propagating access by arbitrary string key (hyphenated keys are
 * first-class): field(bindingRef('row'), 'delays', 'sb-local'). */
export const field = (base, ...keys) => {
  assert(keys.length > 0 && keys.every((k) => typeof k === 'string'), 'field() expects string keys');
  let current = expectExpr(base, 'field()');
  for (const key of keys) current = { __expr: true, Field: { base: current, key } };
  return current;
};

/** Optional arg access: missing keys yield null (strict `arg()` fails). */
export const argOpt = (path) => {
  assert(typeof path === 'string' && path.length > 0, 'argOpt() expects a path');
  return field(argsRoot(), ...path.split('.'));
};

const binary = (op) => (left, right) => ({
  __expr: true,
  Binary: { op, left: expectExpr(left, op), right: expectExpr(right, op) },
});

export const add = binary('Add');
export const sub = binary('Sub');
export const mul = binary('Mul');
export const div = binary('Div');
export const mod = binary('Mod');
export const eqv = binary('Eq');
export const ne = binary('Ne');
export const lt = binary('Lt');
export const lte = binary('Lte');
export const gt = binary('Gt');
export const gte = binary('Gte');
export const and = binary('And');
export const or = binary('Or');

export const not = (expr) => ({ __expr: true, Unary: { op: 'Not', expr: expectExpr(expr, 'not()') } });
export const neg = (expr) => ({ __expr: true, Unary: { op: 'Neg', expr: expectExpr(expr, 'neg()') } });

/** Ternary: cond(test, whenTruthy, otherwise). */
export const cond = (test, then, otherwise) => ({
  __expr: true,
  If: { cond: expectExpr(test, 'cond()'), then: expectExpr(then, 'cond()'), else: expectExpr(otherwise, 'cond()') },
});

/** String-template lowering: parts are expressions or plain strings. */
export const concat = (...parts) => ({
  __expr: true,
  Concat: parts.map((part) => (typeof part === 'string' ? lit(part) : expectExpr(part, 'concat()'))),
});

/** The pinned v1 expression function library. JS mirror of the authority in
 * `src/value_expr.rs` (`PINNED_FUNCTIONS`); the data-tier corpus pins the
 * behavior of every entry, so drift between the two lists fails tests, not
 * users. Growing it is a profile-version event. */
export const PINNED_FUNCTIONS = Object.freeze([
  'len', 'trim', 'lower', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'coalesce',
]);

/** Call into the pinned v1 function library; codegen fails closed on
 * anything outside it. */
export const call = (func, ...fnArgs) => {
  assert(typeof func === 'string' && func.length > 0, 'call() expects a function name');
  return { __expr: true, Call: { func, args: fnArgs.map((a) => expectExpr(a, `call(${func})`)) } };
};

export const coalesce = (...exprs) => call('coalesce', ...exprs);

/** Closed record constructor — the computed-summary return shape. */
export const record = (fields) => {
  assert(fields && typeof fields === 'object' && !Array.isArray(fields), 'record() expects a fields object');
  // JSON records have own data properties only. A normal object would route
  // the legal key "__proto__" through Object.prototype's legacy setter.
  const out = Object.create(null);
  for (const [key, value] of Object.entries(fields)) out[key] = expectExpr(value, `record().${key}`);
  return { __expr: true, Record: { fields: out } };
};

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export const eq = (field, value) => ({ field, op: 'Eq', value });
export const ltFilter = (field, value) => ({ field, op: 'Lt', value });
export const lteFilter = (field, value) => ({ field, op: 'Lte', value });
export const gtFilter = (field, value) => ({ field, op: 'Gt', value });
export const gteFilter = (field, value) => ({ field, op: 'Gte', value });
export const asc = (field) => ({ field, direction: 'Asc' });
export const desc = (field) => ({ field, direction: 'Desc' });

function queryDef(kind, spec) {
  assertKnownSpecFields(spec, kind, QUERY_SPEC_FIELDS);
  assert(spec.table, `${kind} requires a table`);
  if (spec.authScopeField !== undefined) {
    assert(
      typeof spec.authScopeField === 'string' && spec.authScopeField.length > 0,
      `${kind} authScopeField must be a non-empty string`,
    );
  }
  if (spec.membership !== undefined) {
    assert(Array.isArray(spec.membership), `${kind} membership must be an array`);
    for (const predicate of spec.membership) {
      assert(predicate?.__membershipPredicate === true, `${kind} membership entries must come from a declaration-bound memberOf()/hasRole()`);
    }
  }
  return {
    [FN]: true,
    __kind: kind, // 'Query' | 'LiveQuery'
    ...authoredFunctionAuth(spec, kind),
    args: spec.args ?? {},
    // LLP 0034 D3 (Exact LLP 0284 §2.4): a chatty/expensive LiveQuery may opt
    // out of binding live by default; livePush capability is unaffected.
    ...(kind === 'LiveQuery' && spec.defaultLive === false ? { defaultLive: false } : {}),
    ...(spec.authScopeField !== undefined ? { authScopeField: spec.authScopeField } : {}),
    plan: {
      table: spec.table,
      filters: spec.filter ?? [],
      order: spec.order ?? [],
      limit: spec.limit ?? null,
      index: spec.index ?? null,
      membershipFilters: spec.membership ?? [],
    },
  };
}

/** @ref LLP 0004#first-slice-api-decisions — defineLiveQuery is the restricted
 *  syncable-live subset; ordinary defineQuery is a callable server read only. */
export const defineLiveQuery = (spec) => queryDef('LiveQuery', spec);
export const defineQuery = (spec) => queryDef('Query', spec);

function jsQueryDef(kind, spec) {
  assertKnownSpecFields(spec, kind, JS_QUERY_SPEC_FIELDS);
  assert(spec.source, `${kind} requires a handler source file`);
  assert(spec.exportName, `${kind} requires exportName`);
  assert(spec.reads && Array.isArray(spec.reads) && spec.reads.length > 0, `${kind} requires declared reads`);
  if (spec.authScopeField !== undefined) {
    assert(
      typeof spec.authScopeField === 'string' && spec.authScopeField.length > 0,
      `${kind} authScopeField must be a non-empty string`,
    );
  }
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
    ...authoredFunctionAuth(spec, kind),
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

// The v1 extension steps (LLP 0051 D2): reads/guards plus the two closed
// set-oriented forms. General iteration and data-dependent cross-step
// control flow are permanently out of the profile — a mutation needing them
// outgrew the IR and belongs on the JS/WASM tier (see defineJsMutation's
// `outgrewIr` declaration).

/** Point read captured into the read-set. Missing binds null (compose with
 * coalesce) unless opts.elseError names a typed failure code. */
export const get = (table, id, bindAs, opts = {}) => {
  assert(typeof bindAs === 'string' && bindAs.length > 0, 'get() requires a bindAs name');
  return { Get: { table, id: expectExpr(id, 'get()'), bind_as: bindAs, else_error: opts.elseError ?? null } };
};

/** Truthiness guard; failure is the author-supplied typed error code. */
export const guard = (condExpr, elseError) => {
  assert(typeof elseError === 'string' && elseError.length > 0, 'guard() requires an error code');
  return { Guard: { cond: expectExpr(condExpr, 'guard()'), else_error: elseError } };
};

/** Bind a computed expression for later steps. */
export const letBind = (bindAs, expr) => {
  assert(typeof bindAs === 'string' && bindAs.length > 0, 'letBind() requires a name');
  return { Let: { bind_as: bindAs, expr: expectExpr(expr, 'letBind()') } };
};

/** Set-oriented delete; empty (or omitted) filter clears the table. */
export const deleteWhere = (table, filter = []) => {
  assert(Array.isArray(filter), 'deleteWhere() filter must be an array');
  return { DeleteWhere: { table, filter } };
};

/** One insert per element of an argument-supplied array — a bounded
 * comprehension. Values are expressions over the itemAs binding. */
export const insertEach = (table, source, itemAs, values) => {
  assert(typeof itemAs === 'string' && itemAs.length > 0, 'insertEach() requires an itemAs name');
  return { InsertEach: { table, source: expectExpr(source, 'insertEach()'), item_as: itemAs, values } };
};

export const returnBinding = (name) => ({ Binding: name });
export const returnChangedCount = () => ({ kind: 'ChangedCount' });
export const returnDocument = (table, id) => ({ Document: { table, id } });
export const returnLiteral = (value) => ({ Literal: value });
/** Expression-valued return — with record() this covers computed summaries. */
export const returnExpr = (expr) => ({ Expr: expectExpr(expr, 'returnExpr()') });

export function defineMutation(spec) {
  const steps = Array.isArray(spec.plan) ? spec.plan : [spec.plan];
  assert(steps.length > 0, 'defineMutation requires at least one plan step');
  return {
    [FN]: true,
    __kind: 'Mutation',
    ...authoredFunctionAuth(spec, 'Mutation'),
    args: spec.args ?? {},
    plan: { steps, return_value: spec.returns ?? null },
  };
}

/** The named out-of-profile classes (LLP 0051 D2): why a mutation is
 * JS/WASM-tier rather than IR. Declaring one on defineJsMutation makes
 * codegen emit the class-specific "outgrew the IR" info diagnostic into the
 * generated manifest — the tier ladder stays explicit, never vibes. */
export const OUTGREW_IR_CLASSES = Object.freeze({
  'conditional-writes': 'data-dependent step skipping',
  'filtered-read-guards': 'uniqueness/quota/membership guards over non-id keys',
  'type-coercion': 'sanitizing untyped inputs with coercion the pinned library lacks',
  'general-iteration': 'general iteration or data-dependent cross-step control flow',
});

export function defineJsMutation(spec) {
  assert(spec.source, 'defineJsMutation requires a handler source file');
  assert(spec.exportName, 'defineJsMutation requires exportName');
  assert(spec.writes && Array.isArray(spec.writes) && spec.writes.length > 0, 'defineJsMutation requires declared writes');
  if (spec.outgrewIr !== undefined) {
    assert(
      typeof spec.outgrewIr === 'string' && OUTGREW_IR_CLASSES[spec.outgrewIr],
      `defineJsMutation outgrewIr must be one of: ${Object.keys(OUTGREW_IR_CLASSES).join(', ')}`,
    );
  }
  return {
    [FN]: true,
    __kind: 'Mutation',
    ...authoredFunctionAuth(spec, 'Mutation'),
    args: spec.args ?? {},
    ...(spec.outgrewIr !== undefined ? { outgrewIr: spec.outgrewIr } : {}),
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
      ...authoredFunctionAuth(spec, 'Action'),
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
    ...authoredFunctionAuth(spec, 'Action'),
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
  return !!(value && value[FN]);
}

export function isCronDef(value) {
  return !!(value && value[CRON]);
}

export function isConfigDef(value) {
  return !!(value && value[CONFIG]);
}

export function isTableDef(value) {
  return !!(
    value
    && value[TABLE]
    && OBJECT_GET_PROTOTYPE_OF(value) === TableBuilder.prototype
  );
}

export function isEphemeralCollectionDef(value) {
  return !!(value && value[EPHEMERAL_COLLECTION]);
}

export function isEphemeralDef(value) {
  return !!(value && value[EPHEMERAL]);
}

export function assert(cond, message) {
  if (!cond) throw new Error(`[snapback-define] ${message}`);
}
