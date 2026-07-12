// Derived optimistic overlays (Exact LLP 0329 E-B / LLP 0051 Q10 rung 1).
//
// For IR-tier mutations the generated contract-data manifest embeds the
// snapback `MutationPlan`; this module derives the mutation's optimistic
// reducer from that plan instead of requiring the app to hand-write one.
// The derived reducer obeys the same contract as app reducers (ENG-23385):
// pure over (rows, args, ctx) and IDEMPOTENT — it is re-applied to every
// authoritative server-rows write while its mutation is in flight, and those
// rows may already contain the committed effect.
//
// An overlay is an honest PREDICTION, not a promise (LLP 0329 §E5): reads
// re-evaluate per tier, so a plan `Guard` may pass locally and fail at
// commit — or fail locally on stale rows and succeed at commit. On any local
// guard failure or evaluation error the reducer yields the rows UNCHANGED
// (pending-without-overlay for that application) and reports through the
// optional diagnostics hook; the server outcome arrives via the mutation
// receipt (`outcome` / `rollbackReason`).
//
// The expression evaluator mirrors the shared Rust evaluator
// (`src/value_expr.rs`) — one semantics, pinned by the data-tier corpus
// (`tests/conformance/data-tier/`); `derived-overlay.test.mjs` replays the
// applicable corpus cases against this module so drift fails loudly.
//
// @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//   the v1 profile this evaluator implements client-side.

export const DATA_TIER_PROFILE_VERSION = 1;
export const MAX_PLAN_STEPS = 64;
export const MAX_EXPR_DEPTH = 32;
export const MAX_INSERT_EACH_FANOUT = 1024;

export const PINNED_FUNCTIONS = [
  'len', 'trim', 'lower', 'abs', 'min', 'max', 'round', 'floor', 'ceil', 'coalesce',
];

/** Overlay classes a mutation invocation can present (LLP 0329 §E5 / EQ5). */
export const OVERLAY_CLASSES = Object.freeze(['derived', 'reducer', 'none']);

class OverlayEvalError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new OverlayEvalError(code, message);
};

// --- Value model (mirrors src/value_expr.rs) --------------------------------

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

// JSON has no NaN or infinities. Arithmetic that crosses that boundary is
// normalized before it can enter an optimistic row, matching serde_json.
const numberValue = (value) => {
  if (!Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
};

// The server evaluates serde_json::Value, never a raw JavaScript object graph.
// Canonicalize every external expression value to the same transport domain
// before it can affect a prediction. This intentionally mirrors the stable
// JSON.stringify rules (non-finite numbers -> null; unsupported object fields
// omitted; unsupported/sparse array slots -> null) while rejecting values
// whose second serialization could observe behavior: cycles, BigInt,
// accessors, toJSON/class instances, and other exotic objects. A skipped
// overlay is honest; a row containing a value the server can never see is not.
const OMIT_JSON_FIELD = Object.freeze({});

const canonicalJsonValue = (
  value,
  { container = 'top', seen = new WeakSet(), depth = 0, path = '$' } = {},
) => {
  if (depth > MAX_EXPR_DEPTH) {
    fail('SNAPBACK_EXPR_TYPE', `JSON value at ${path} exceeds the client evaluator depth bound`);
  }
  if (value === null) return null;
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value;
  if (kind === 'number') return numberValue(value);
  if (kind === 'undefined' || kind === 'function' || kind === 'symbol') {
    if (container === 'object') return OMIT_JSON_FIELD;
    if (container === 'array') return null;
    fail('SNAPBACK_EXPR_TYPE', `${path} is not a JSON value (${kind})`);
  }
  if (kind === 'bigint') {
    fail('SNAPBACK_EXPR_TYPE', `${path} is not a JSON value (bigint)`);
  }
  if (kind !== 'object') {
    fail('SNAPBACK_EXPR_TYPE', `${path} is not a JSON value (${kind})`);
  }
  for (let cursor = value; cursor !== null; cursor = Object.getPrototypeOf(cursor)) {
    if (hasOwn(cursor, 'toJSON')) {
      fail('SNAPBACK_EXPR_TYPE', `JSON value at ${path} may not define toJSON`);
    }
  }
  if (seen.has(value)) fail('SNAPBACK_EXPR_TYPE', `cyclic JSON value at ${path}`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const output = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) {
          if (String(index) in value) {
            fail('SNAPBACK_EXPR_TYPE', `JSON array slot ${path}[${index}] may not be inherited`);
          }
          output[index] = null; // JSON.stringify's sparse-array rule.
        } else if (!hasOwn(descriptor, 'value')) {
          fail('SNAPBACK_EXPR_TYPE', `JSON array slot ${path}[${index}] must be a data property`);
        } else {
          output[index] = canonicalJsonValue(descriptor.value, {
            container: 'array', seen, depth: depth + 1, path: `${path}[${index}]`,
          });
        }
      }
      return output;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('SNAPBACK_EXPR_TYPE', `JSON object at ${path} must have a plain or null prototype`);
    }
    const output = Object.create(null);
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !hasOwn(descriptor, 'value')) {
        fail('SNAPBACK_EXPR_TYPE', `JSON field ${path}.${key} must be a data property`);
      }
      const field = canonicalJsonValue(descriptor.value, {
        container: 'object', seen, depth: depth + 1, path: `${path}.${key}`,
      });
      if (field !== OMIT_JSON_FIELD) output[key] = field;
    }
    return output;
  } finally {
    seen.delete(value);
  }
};

const portableTrim = (value) => value.replace(
  /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/g,
  '',
);

const compareUnicodeScalars = (left, right) => {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xFFFF ? 2 : 1;
    rightIndex += rightPoint > 0xFFFF ? 2 : 1;
  }
  if (leftIndex === left.length && rightIndex === right.length) return 0;
  return leftIndex === left.length ? -1 : 1;
};

export const truthy = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') return value.length > 0;
  return true; // objects and arrays
};

const asNumber = (value) => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const valuesEqual = (left, right) => {
  const a = asNumber(left);
  const b = asNumber(right);
  if (a !== null && b !== null) return a === b; // NaN !== NaN, JS parity
  return deepEqual(left, right);
};

const deepEqual = (left, right) => {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object') {
    if (Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
};

/// Null-propagating access by arbitrary string key; arrays index by decimal
/// string; any miss is null (never a type error).
const fieldAccess = (base, key) => {
  if (Array.isArray(base)) {
    const index = /^\+?\d+$/.test(key) ? Number(key) : null;
    const item = index === null ? undefined : base[index];
    return item === undefined ? null : item;
  }
  if (base !== null && typeof base === 'object') {
    const value = hasOwn(base, key) ? base[key] : undefined;
    return value === undefined ? null : value;
  }
  return null;
};

const stringifyForConcat = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fail('SNAPBACK_EXPR_TYPE', 'string templates cannot interpolate arrays or objects');
};

const lookupPath = (value, path) => {
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(current, part);
    if (!descriptor) return undefined;
    if (!hasOwn(descriptor, 'value')) {
      fail('SNAPBACK_EXPR_TYPE', `handler arg ${path} traverses an accessor property`);
    }
    current = descriptor.value;
    if (current === undefined) return undefined;
  }
  return current;
};

const evalCall = (func, args) => {
  const arity = (expected) => {
    if (args.length !== expected) {
      fail('SNAPBACK_EXPR_TYPE', `${func} expects ${expected} argument(s), got ${args.length}`);
    }
  };
  switch (func) {
    case 'coalesce':
      return args.find((value) => value !== null) ?? null;
    case 'len': {
      arity(1);
      const value = args[0];
      if (value === null) return null;
      if (typeof value === 'string') return value.length; // UTF-16 code units
      if (Array.isArray(value)) return value.length;
      return fail('SNAPBACK_EXPR_TYPE', 'len expects a string or array');
    }
    case 'trim':
    case 'lower': {
      arity(1);
      const value = args[0];
      if (value === null) return null;
      if (typeof value !== 'string') return fail('SNAPBACK_EXPR_TYPE', `${func} expects a string`);
      return func === 'trim' ? portableTrim(value) : value.toLowerCase();
    }
    case 'abs':
    case 'round':
    case 'floor':
    case 'ceil': {
      arity(1);
      const value = args[0];
      if (value === null) return null;
      if (typeof value !== 'number') return fail('SNAPBACK_EXPR_TYPE', `${func} expects a number`);
      if (func === 'abs') return numberValue(Math.abs(value));
      if (func === 'round') return numberValue(Math.floor(value + 0.5)); // JS Math.round parity
      if (func === 'floor') return numberValue(Math.floor(value));
      return numberValue(Math.ceil(value));
    }
    case 'min':
    case 'max': {
      if (args.length === 0) fail('SNAPBACK_EXPR_TYPE', `${func} expects at least one argument`);
      if (args.some((value) => value === null)) return null;
      let best = null;
      for (const value of args) {
        if (typeof value !== 'number') return fail('SNAPBACK_EXPR_TYPE', `${func} expects numbers`);
        if (best === null || ((func === 'min') === (value < best))) best = value;
      }
      return numberValue(best);
    }
    default:
      return fail(
        'SNAPBACK_EXPR_UNSUPPORTED_FUNCTION',
        `expression function ${func} is not in the pinned v1 library`,
      );
  }
};

const evalBinary = (op, left, right) => {
  switch (op) {
    case 'And':
      return truthy(left) ? right : left;
    case 'Or':
      return truthy(left) ? left : right;
    case 'Eq':
      return valuesEqual(left, right);
    case 'Ne':
      return !valuesEqual(left, right);
    case 'Add':
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      return numericBinary(op, left, right);
    case 'Sub':
    case 'Mul':
    case 'Div':
    case 'Mod':
      return numericBinary(op, left, right);
    case 'Lt':
    case 'Lte':
    case 'Gt':
    case 'Gte': {
      if (left === null || right === null) return null;
      if (typeof left === 'string' && typeof right === 'string') {
        const ordering = compareUnicodeScalars(left, right);
        if (op === 'Lt') return ordering < 0;
        if (op === 'Lte') return ordering <= 0;
        if (op === 'Gt') return ordering > 0;
        return ordering >= 0;
      }
      if (typeof left !== 'number' || typeof right !== 'number') {
        return fail('SNAPBACK_EXPR_TYPE', 'ordering comparison expects two numbers or two strings');
      }
      if (op === 'Lt') return left < right;
      if (op === 'Lte') return left <= right;
      if (op === 'Gt') return left > right;
      return left >= right;
    }
    default:
      return fail('SNAPBACK_EXPR_TYPE', `unsupported binary op ${op}`);
  }
};

const numericBinary = (op, left, right) => {
  // Three-valued: a null operand yields null, never JS null-coercion.
  if (left === null || right === null) return null;
  if (typeof left !== 'number' || typeof right !== 'number') {
    return fail('SNAPBACK_EXPR_TYPE', `${op} expects numeric operands`);
  }
  switch (op) {
    case 'Add':
      return numberValue(left + right);
    case 'Sub':
      return numberValue(left - right);
    case 'Mul':
      return numberValue(left * right);
    case 'Div':
      return numberValue(left / right);
    case 'Mod':
      return numberValue(left % right); // JS remainder (dividend sign)
    default:
      return fail('SNAPBACK_EXPR_TYPE', `unsupported numeric op ${op}`);
  }
};

/**
 * Evaluate a serialized (serde-shape) `ValueExpr` against an environment
 * `{ args, authUserId, bindings, nowMs, runtimeId }`. Mirrors
 * `eval_value_expr` in src/value_expr.rs; throws `{ code, message }` on the
 * same typed failures.
 */
export const evalValueExpr = (expr, env, depth = 0) => {
  if (depth > MAX_EXPR_DEPTH) {
    fail('SNAPBACK_PLAN_BOUNDS', `expression depth exceeds the declared bound (${MAX_EXPR_DEPTH})`);
  }
  if (expr === 'Args') return canonicalJsonValue(env.args ?? {});
  if (expr === 'AuthUserId') {
    if (typeof env.authUserId !== 'string') {
      fail('SNAPBACK_AUTH_USER_MISSING', 'handler requested auth.user_id but no user was supplied');
    }
    return env.authUserId;
  }
  if (expr === 'RuntimeId') {
    if (typeof env.runtimeId !== 'function') fail('SNAPBACK_EXPR_UNANALYZABLE', 'RuntimeId is not available');
    return canonicalJsonValue(env.runtimeId());
  }
  if (expr === 'RuntimeNow') {
    if (typeof env.nowMs !== 'number' || !Number.isFinite(env.nowMs)) {
      fail('SNAPBACK_EXPR_UNANALYZABLE', 'RuntimeNow is not available');
    }
    return numberValue(env.nowMs);
  }
  if (expr === null || typeof expr !== 'object') {
    fail('SNAPBACK_EXPR_TYPE', `malformed expression ${JSON.stringify(expr)}`);
  }
  if (hasOwn(expr, 'Arg')) {
    const value = lookupPath(env.args ?? {}, expr.Arg);
    if (value === undefined) fail('SNAPBACK_ARG_MISSING', `handler arg ${expr.Arg} was not provided`);
    return canonicalJsonValue(value);
  }
  if (hasOwn(expr, 'Binding')) {
    const bindings = env.bindings ?? new Map();
    if (!bindings.has(expr.Binding)) {
      fail('SNAPBACK_BINDING_MISSING', `handler binding ${expr.Binding} was not available`);
    }
    return canonicalJsonValue(bindings.get(expr.Binding));
  }
  if (hasOwn(expr, 'Literal')) {
    return canonicalJsonValue(expr.Literal);
  }
  if (hasOwn(expr, 'Field')) {
    const base = evalValueExpr(expr.Field.base, env, depth + 1);
    return canonicalJsonValue(fieldAccess(base, expr.Field.key));
  }
  if (hasOwn(expr, 'Binary')) {
    const left = evalValueExpr(expr.Binary.left, env, depth + 1);
    const right = evalValueExpr(expr.Binary.right, env, depth + 1);
    return evalBinary(expr.Binary.op, left, right);
  }
  if (hasOwn(expr, 'Unary')) {
    const value = evalValueExpr(expr.Unary.expr, env, depth + 1);
    if (expr.Unary.op === 'Not') return !truthy(value);
    if (value === null) return null;
    if (typeof value !== 'number') fail('SNAPBACK_EXPR_TYPE', 'Neg expects a number');
    return numberValue(-value);
  }
  if (hasOwn(expr, 'If')) {
    const cond = evalValueExpr(expr.If.cond, env, depth + 1);
    return truthy(cond)
      ? evalValueExpr(expr.If.then, env, depth + 1)
      : evalValueExpr(expr.If.else, env, depth + 1);
  }
  if (hasOwn(expr, 'Concat')) {
    return expr.Concat.map((part) => stringifyForConcat(evalValueExpr(part, env, depth + 1))).join('');
  }
  if (hasOwn(expr, 'Call')) {
    const args = expr.Call.args.map((arg) => evalValueExpr(arg, env, depth + 1));
    return evalCall(expr.Call.func, args);
  }
  if (hasOwn(expr, 'Record')) {
    const output = Object.create(null);
    for (const [key, fieldExpr] of Object.entries(expr.Record.fields)) {
      output[key] = evalValueExpr(fieldExpr, env, depth + 1);
    }
    return output;
  }
  return fail('SNAPBACK_EXPR_TYPE', `unsupported expression form ${Object.keys(expr)[0]}`);
};

// --- Filter matching (DeleteWhere; mirrors src/live_matcher.rs) -------------

/// SQL three-valued logic: a NULL operand makes any comparison UNKNOWN and a
/// WHERE excludes UNKNOWN rows; `In` keeps per-element equality.
const filterMatchesRow = (filter, env, row) => {
  const actual = fieldAccess(row, filter.field);
  const expected = evalValueExpr(filter.value, env);
  if (actual === null) return false;
  if (expected === null && filter.op !== 'In') return false;
  switch (filter.op) {
    case 'Eq':
      return valuesEqual(actual, expected);
    case 'In':
      return Array.isArray(expected) && expected.some((value) => valuesEqual(actual, value));
    case 'Lt':
    case 'Lte':
    case 'Gt':
    case 'Gte': {
      const outcome = evalBinary(filter.op, actual, expected);
      return outcome === true;
    }
    default:
      return false;
  }
};

// --- Stability analysis (idempotent-insert suppression) ---------------------

/// An expression is STABLE when re-evaluating it against the same args on the
/// server produces the same value the overlay predicted: no RuntimeId /
/// RuntimeNow, and no Binding outside the known-stable set (Let over stable
/// expressions). Stable fields are the join keys the committed-skip check
/// compares — the generalization of the canonical insert reducer's
/// title/userId match (ENG-23385).
const exprIsStable = (expr, stableBindings) => {
  if (expr === 'Args' || expr === 'AuthUserId') return true;
  if (expr === 'RuntimeId' || expr === 'RuntimeNow') return false;
  if (expr === null || typeof expr !== 'object') return false;
  if ('Arg' in expr || 'Literal' in expr) return true;
  if ('Binding' in expr) return stableBindings.has(expr.Binding);
  if ('Field' in expr) return exprIsStable(expr.Field.base, stableBindings);
  if ('Binary' in expr) {
    return (
      exprIsStable(expr.Binary.left, stableBindings)
      && exprIsStable(expr.Binary.right, stableBindings)
    );
  }
  if ('Unary' in expr) return exprIsStable(expr.Unary.expr, stableBindings);
  if ('If' in expr) {
    return (
      exprIsStable(expr.If.cond, stableBindings)
      && exprIsStable(expr.If.then, stableBindings)
      && exprIsStable(expr.If.else, stableBindings)
    );
  }
  if ('Concat' in expr) return expr.Concat.every((part) => exprIsStable(part, stableBindings));
  if ('Call' in expr) return expr.Call.args.every((arg) => exprIsStable(arg, stableBindings));
  if ('Record' in expr) {
    return Object.values(expr.Record.fields).every((field) => exprIsStable(field, stableBindings));
  }
  return false;
};

// --- Plan derivability -------------------------------------------------------

const stepTables = (step) => {
  const kind = Object.keys(step)[0];
  const body = step[kind];
  return body && typeof body === 'object' && typeof body.table === 'string' ? [body.table] : [];
};

/**
 * A plan is derivable for a boundary iff every table it names (reads and
 * writes) is the boundary's visible table. Mutations that touch tables the
 * boundary cannot see stay `pending-without-overlay` — no overlay beats a
 * wrong prediction (LLP 0329 §E5's honest-prediction posture).
 */
export const planDerivableForTable = (plan, table) => {
  if (!plan || !Array.isArray(plan.steps) || typeof table !== 'string') return false;
  return plan.steps.every((step) => stepTables(step).every((named) => named === table));
};

// --- The derived reducer -----------------------------------------------------

/**
 * Derive an optimistic reducer from a serialized `MutationPlan`. The returned
 * function matches the app-reducer contract exactly:
 * `(rows, args, { userId, optimisticId, baseVersion }) => rows`.
 *
 * Provisional row ids derive deterministically from `optimisticId` so
 * re-application (every server-rows write during the in-flight window)
 * produces identical output — the idempotence the adapter requires.
 */
export const deriveOptimisticReducer = ({ name, plan, table, onError = null }) => {
  if (!planDerivableForTable(plan, table)) return null;

  return (rows, args, {
    userId = null,
    optimisticId,
    baseVersion = null,
    nowMs = Date.now(),
    runtimeId = null,
  } = {}) => {
    const original = rows;
    try {
      // Mirror the server's fail-closed bounds check: an over-bound plan is a
      // typed rejection there, so the overlay must not predict its effects.
      if (plan.steps.length > MAX_PLAN_STEPS) {
        fail('SNAPBACK_PLAN_BOUNDS', `plan has ${plan.steps.length} steps; the declared bound is ${MAX_PLAN_STEPS}`);
      }
      let provisionalCount = 0;
      const nextProvisionalId = () => {
        provisionalCount += 1;
        if (typeof runtimeId === 'function') return runtimeId(provisionalCount);
        return provisionalCount === 1 ? optimisticId : `${optimisticId}_${provisionalCount}`;
      };
      const bindings = new Map();
      const stableBindings = new Set();
      const env = {
        args: args ?? {},
        authUserId: userId,
        bindings,
        nowMs,
        runtimeId: nextProvisionalId,
      };
      let out = [...(rows ?? [])];

      const evalValues = (values, itemEnv = env) => {
        const row = Object.create(null);
        for (const [field, expr] of Object.entries(values)) {
          row[field] = evalValueExpr(expr, itemEnv);
        }
        return row;
      };

      /// The committed-skip check (ENG-23385): a non-optimistic row matching
      /// every STABLE field at a version newer than the rows the mutation
      /// fired against is this mutation's own landed commit (or an equivalent
      /// concurrent one) — appending the optimistic copy would double it.
      const committedMatch = (values, evaluated, itemStable = stableBindings) => {
        const stableFields = Object.keys(values).filter((field) =>
          exprIsStable(values[field], itemStable),
        );
        if (stableFields.length === 0) return false;
        return out.some(
          (row) =>
            row
            && row.optimistic !== true
            && stableFields.every((field) => valuesEqual(fieldAccess(row, field), evaluated[field]))
            && (typeof row._version !== 'number'
              || baseVersion === null
              || row._version > baseVersion),
        );
      };

      for (const step of plan.steps) {
        const kind = Object.keys(step)[0];
        const body = step[kind];
        if (kind === 'Insert') {
          // Server order is implicit row id first, then the value map. This is
          // load-bearing when values also contain RuntimeId: both tiers must
          // consume one shared ledger in the same order.
          const id = nextProvisionalId();
          if (body.bind_id_as) bindings.set(body.bind_id_as, id);
          const evaluated = evalValues(body.values);
          if (!committedMatch(body.values, evaluated)) {
            out = [...out, { ...evaluated, _id: id, optimistic: true }];
          }
        } else if (kind === 'Patch') {
          if (Object.keys(body.values).length === 0) continue;
          const id = evalValueExpr(body.id, env);
          if (typeof id !== 'string') fail('SNAPBACK_EXPR_TYPE', 'patch id must be a string');
          const evaluated = evalValues(body.values);
          out = out.map((row) => (row?._id === id ? { ...row, ...evaluated } : row));
        } else if (kind === 'Delete') {
          const id = evalValueExpr(body.id, env);
          if (typeof id !== 'string') fail('SNAPBACK_EXPR_TYPE', 'delete id must be a string');
          out = out.filter((row) => row?._id !== id);
        } else if (kind === 'Get') {
          const id = evalValueExpr(body.id, env);
          if (typeof id !== 'string') fail('SNAPBACK_EXPR_TYPE', 'get id must be a string');
          const row = out.find((candidate) => candidate?._id === id) ?? null;
          if (row === null && body.else_error) {
            fail(body.else_error, `get on ${body.table} ${id} found no row`);
          }
          bindings.set(body.bind_as, row);
        } else if (kind === 'Guard') {
          const value = evalValueExpr(body.cond, env);
          if (!truthy(value)) fail(body.else_error, 'mutation guard failed');
        } else if (kind === 'Let') {
          bindings.set(body.bind_as, evalValueExpr(body.expr, env));
          if (exprIsStable(body.expr, stableBindings)) stableBindings.add(body.bind_as);
        } else if (kind === 'DeleteWhere') {
          // SQL lowering evaluates each filter value once before scanning;
          // do the same so RuntimeId answers are not consumed once per row.
          const filters = (body.filter ?? []).map((filter) => ({
            ...filter,
            value: { Literal: evalValueExpr(filter.value, env) },
          }));
          out = out.filter(
            (row) => !filters.every((clause) => filterMatchesRow(clause, env, row)),
          );
        } else if (kind === 'InsertEach') {
          const source = evalValueExpr(body.source, env);
          if (!Array.isArray(source)) {
            fail('SNAPBACK_PLAN_SOURCE_INVALID', 'InsertEach source must evaluate to an array');
          }
          if (source.length > MAX_INSERT_EACH_FANOUT) {
            fail('SNAPBACK_PLAN_BOUNDS', `InsertEach fan-out ${source.length} exceeds the declared bound`);
          }
          for (const item of source) {
            const itemBindings = new Map(bindings);
            itemBindings.set(body.item_as, item);
            const itemStable = new Set(stableBindings);
            itemStable.add(body.item_as); // item derives from args — stable
            const itemEnv = { ...env, bindings: itemBindings };
            const id = nextProvisionalId();
            const evaluated = evalValues(body.values, itemEnv);
            if (!committedMatch(body.values, evaluated, itemStable)) {
              out = [...out, { ...evaluated, _id: id, optimistic: true }];
            }
          }
        } else {
          fail('SNAPBACK_PLAN_UNSUPPORTED_STEP', `unsupported mutation step ${kind}`);
        }
      }
      // Return expressions run after every step on the server and may consume
      // RuntimeId answers even though the optimistic reducer does not expose
      // the mutation's return value. Evaluate just the ledger-bearing forms.
      if (plan.return_value && typeof plan.return_value === 'object') {
        if ('Expr' in plan.return_value) evalValueExpr(plan.return_value.Expr, env);
        if ('Document' in plan.return_value) evalValueExpr(plan.return_value.Document.id, env);
      }
      return out;
    } catch (error) {
      // Prediction only: a local guard failure or evaluation error means "no
      // overlay this application", never a thrown boundary write. The server
      // outcome (and its typed code) arrives on the mutation receipt.
      if (typeof onError === 'function') {
        onError('SNAPBACK_CONTRACT_DERIVED_OVERLAY_SKIPPED', error?.message ?? String(error), {
          mutation: name,
          code: error?.code ?? null,
        });
      }
      return original;
    }
  };
};

/**
 * Build the derived-reducer map for a surface: every manifest mutation that
 * embeds a `plan` derivable for the boundary's table. App reducers override
 * per name at the call site (reducers stay first-class — LLP 0329 §E5).
 */
export const deriveOptimisticReducers = ({ manifest, table, onError = null }) => {
  const derived = Object.create(null);
  if (typeof table !== 'string') return derived;
  for (const [name, descriptor] of Object.entries(manifest?.mutations ?? {})) {
    const plan = descriptor?.plan;
    if (!plan) continue;
    const reducer = deriveOptimisticReducer({ name, plan, table, onError });
    if (reducer) derived[name] = reducer;
  }
  return derived;
};
