// Shipping, browser-safe evaluator for the mutation-IR data tier.
//
// The complete v1 semantic executor below is the D5 conformance consumer. The
// local-prediction wrapper is intentionally narrower: it admits only the
// Insert/Get/Guard/Patch step ceiling plus at most one single-row Delete,
// admitted by author ruling 2026-08-07, for Move 3 lane M1. Keeping these
// surfaces separate lets the package prove all v1 evaluator semantics without
// silently claiming every conformant server operation is locally executable.
// @ref LLP 0129#phases — Phase 2a: single-row Delete admitted into the M1
//   local verb set by author ruling 2026-08-07
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   exact returns, changed counts, declared rows, ctx ledgers, and typed
//   rejections are the cross-runtime contract.
// @ref LLP 0155#execution-contract — locally admitted reads are the only read
//   world and writes remain inside a private optimistic layer.

import {
  canonicalizeJsonValue,
  evalValueExpr,
  MAX_INSERT_EACH_FANOUT,
  MAX_PLAN_STEPS,
  truthy,
  valuesEqual,
} from '@expo/snapback-contract';

export const BROWSER_IR_ADMISSION_CLASSES = Object.freeze([
  'ready',
  'predictable-with-partial-input',
  'server-only',
  'refused',
]);

// The v1 class string stays stable and now also admits the single-row Delete
// shape under the 2026-08-07 author ruling.
export const BROWSER_IR_LOCAL_EFFECT_CLASS =
  'snapback.browser-ir.insert-get-guard-patch.v1';
export const BROWSER_IR_CTX_CLAIM_LABEL = 'labeled-client-claim';

const LOCAL_STEPS = new Set(['Insert', 'Get', 'Guard', 'Patch', 'Delete']);
const SERVER_ONLY_STEPS = new Set([
  'AllocateSequence',
  'AssertCurrentRelation',
  'AssertSourceChanged',
]);
const SERVER_ONLY_EXPRESSIONS = new Set([
  'AuthUserId',
  'AuthKind',
  'AuthActorKind',
  'AuthActivityActorKind',
  'AuthActorUserId',
  'AuthGrantId',
  'ClientMutationDigest',
  'AuthIsDelegated',
  'MembershipExists',
]);
const UNIT_EXPRESSIONS = new Set([
  'Args',
  'AuthUserId',
  'AuthKind',
  'AuthActorKind',
  'AuthActivityActorKind',
  'AuthActorUserId',
  'AuthGrantId',
  'ClientMutationDigest',
  'AuthIsDelegated',
  'RuntimeId',
  'RuntimeNow',
]);
const LEDGER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const MAX_LEDGER_IDS = 1_024;
const MAX_PLAN_CLONE_DEPTH = 256;
const MAX_PLAN_CLONE_NODES = 32_768;

class BrowserIrError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new BrowserIrError(code, message);
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const freezeTree = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
};

const cloneTransportValue = (value) => canonicalizeJsonValue(value);

// Plans are generated JSON data, but the expression-depth rejection case is
// intentionally deeper than the external value-model limit. Clone plans with
// their own finite ceiling and descriptor checks so that D5 reaches the
// evaluator's SNAPBACK_PLAN_BOUNDS pin without invoking getters or toJSON.
const clonePlanValue = (root) => {
  const seen = new Set();
  let nodes = 0;

  const visit = (value, depth) => {
    nodes += 1;
    if (nodes > MAX_PLAN_CLONE_NODES || depth > MAX_PLAN_CLONE_DEPTH) {
      fail('SNAPBACK_PLAN_BOUNDS', 'mutation plan exceeds the browser clone bound');
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    }
    if (typeof value !== 'object') {
      fail('SNAPBACK_PLAN_INVALID', `mutation plan contains a ${typeof value} value`);
    }
    if (seen.has(value)) fail('SNAPBACK_PLAN_INVALID', 'mutation plan is cyclic');
    seen.add(value);
    try {
      const prototype = Object.getPrototypeOf(value);
      if (Array.isArray(value)) {
        const output = new Array(value.length);
        for (let index = 0; index < value.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) {
            fail('SNAPBACK_PLAN_INVALID', 'mutation plan contains a sparse or accessor array');
          }
          output[index] = visit(descriptor.value, depth + 1);
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        fail('SNAPBACK_PLAN_INVALID', 'mutation plan contains an exotic object');
      }
      const output = Object.create(null);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') {
          fail('SNAPBACK_PLAN_INVALID', 'mutation plan contains a symbol key');
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !own(descriptor, 'value')) {
          fail('SNAPBACK_PLAN_INVALID', 'mutation plan contains an accessor field');
        }
        output[key] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  };

  return visit(root, 0);
};

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) output[key] = canonicalValue(value[key]);
    return output;
  }
  return Object.is(value, -0) ? 0 : value;
};

const canonicalText = (value) => JSON.stringify(canonicalValue(value));

const publicRow = (row) => {
  const output = Object.create(null);
  for (const [key, value] of Object.entries(row ?? {})) {
    if (key.startsWith('_') && key !== '_id') continue;
    output[key] = value;
  }
  return canonicalValue(output);
};

const normalizedRows = (workspace, tableManifests) => {
  const output = Object.create(null);
  const manifests = new Map(tableManifests.map((table) => [table.name, table]));
  for (const tableName of [...manifests.keys()].sort()) {
    output[tableName] = (workspace.get(tableName) ?? [])
      .map((row) => {
        const completed = { ...row };
        for (const field of manifests.get(tableName)?.fields ?? []) {
          if (!own(completed, field.name)) completed[field.name] = null;
        }
        return publicRow(completed);
      })
      .sort((left, right) => {
        const a = canonicalText(left);
        const b = canonicalText(right);
        return a === b ? 0 : a < b ? -1 : 1;
      });
  }
  return output;
};

const prepareLedger = (ledger) => {
  if (ledger === null || typeof ledger !== 'object' || Array.isArray(ledger)) {
    fail('SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED', 'ctx-answer ledger is missing');
  }
  if (ledger.version !== 1) {
    fail('SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED', 'ctx-answer ledger version is not v1');
  }
  if (!Array.isArray(ledger.ids) || ledger.ids.length > MAX_LEDGER_IDS) {
    fail('SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED', 'ctx-answer ledger id list exceeds v1 bounds');
  }
  if (ledger.ids.some((id) => typeof id !== 'string' || !LEDGER_ID.test(id))) {
    fail('SNAPBACK_CTX_LEDGER_ID_INVALID', 'ctx-answer ledger contains an invalid id');
  }
  if (!Number.isSafeInteger(ledger.now) || ledger.now < 0) {
    fail('SNAPBACK_TIMESTAMP_OUT_OF_RANGE', 'ctx-answer ledger timestamp is outside the portable range');
  }

  let cursor = 0;
  return {
    now: ledger.now,
    nextId() {
      if (cursor >= ledger.ids.length) {
        fail('SNAPBACK_CTX_LEDGER_EXHAUSTED', 'ctx-answer ledger id answers are exhausted');
      }
      const id = ledger.ids[cursor];
      cursor += 1;
      return id;
    },
    finish() {
      if (cursor !== ledger.ids.length) {
        fail('SNAPBACK_CTX_LEDGER_UNUSED_IDS', 'ctx-answer ledger contains unused id answers');
      }
      return { version: 1, ids: [...ledger.ids], now: ledger.now };
    },
  };
};

const expectString = (value, label) => {
  if (typeof value !== 'string') {
    fail('SNAPBACK_EXPECTED_STRING', `${label} must evaluate to a string`);
  }
  return value;
};

const fieldValue = (row, field) => (
  row !== null && typeof row === 'object' && own(row, field) ? row[field] : null
);

const filterMatches = (filter, environment, row) => {
  const actual = fieldValue(row, filter.field);
  const expected = evalValueExpr(filter.value, environment);
  if (actual === null) return false;
  if (filter.op === 'In') {
    return Array.isArray(expected)
      && expected.some((candidate) => valuesEqual(actual, candidate));
  }
  if (expected === null) return false;
  if (filter.op === 'Eq') return valuesEqual(actual, expected);
  if (!['Lt', 'Lte', 'Gt', 'Gte'].includes(filter.op)) return false;
  return evalValueExpr({
    Binary: {
      op: filter.op,
      left: { Literal: actual },
      right: { Literal: expected },
    },
  }, environment) === true;
};

const tableRows = (workspace, table) => {
  const rows = workspace.get(table);
  if (rows === undefined) fail('SNAPBACK_UNKNOWN_TABLE', `mutation plan names unknown table ${table}`);
  return rows;
};

const evaluateValues = (values, environment) => {
  const row = Object.create(null);
  for (const [field, expression] of Object.entries(values ?? {})) {
    row[field] = evalValueExpr(expression, environment);
  }
  return row;
};

const evaluateReturn = (returnValue, workspace, environment, changedCount) => {
  if (returnValue === null || returnValue === undefined || returnValue === 'ChangedCount') {
    return changedCount;
  }
  if (own(returnValue, 'Literal')) return cloneTransportValue(returnValue.Literal);
  if (own(returnValue, 'Binding')) {
    return environment.bindings.has(returnValue.Binding)
      ? cloneTransportValue(environment.bindings.get(returnValue.Binding))
      : null;
  }
  if (own(returnValue, 'Document')) {
    const id = expectString(evalValueExpr(returnValue.Document.id, environment), 'document id');
    return cloneTransportValue(
      tableRows(workspace, returnValue.Document.table).find((row) => row?._id === id) ?? null,
    );
  }
  if (own(returnValue, 'Expr')) return evalValueExpr(returnValue.Expr, environment);
  fail('SNAPBACK_PLAN_RETURN_INVALID', 'mutation plan has an unsupported return form');
};

const makeWorkspace = (tableManifests, initialRows) => {
  const workspace = new Map();
  for (const table of tableManifests) {
    const rows = initialRows?.[table.name] ?? [];
    if (!Array.isArray(rows)) {
      fail('SNAPBACK_INITIAL_ROWS_INVALID', `initial rows for ${table.name} must be an array`);
    }
    workspace.set(table.name, rows.map((row) => cloneTransportValue(row)));
  }
  return workspace;
};

const cloneWorkspace = (workspace) => new Map(
  [...workspace.entries()].map(([table, rows]) => [
    table,
    rows.map((row) => cloneTransportValue(row)),
  ]),
);

const rejectedOutcome = ({ name, inputCtxLedger, initialWorkspace, tableManifests, error }) => ({
  name,
  status: 'rejected',
  result: null,
  changedCount: null,
  inputCtxLedger: canonicalValue(inputCtxLedger),
  outputCtxLedger: null,
  rejectionCode: error?.code ?? 'SNAPBACK_BROWSER_IR_UNTYPED_ERROR',
  rows: normalizedRows(initialWorkspace, tableManifests),
});

const executeBrowserIrPlanV1 = ({
  name,
  schema,
  initialRows,
  plan,
  args,
  ctxLedger,
  authUserId,
}) => {
  let tableManifests = [];
  let initialWorkspace = new Map();
  let inputCtxLedger = null;
  let writeSet = [];

  try {
    const admittedSchema = cloneTransportValue(schema ?? { tables: [] });
    if (!Array.isArray(admittedSchema?.tables)) {
      fail('SNAPBACK_PLAN_INVALID', 'D5 schema must declare tables');
    }
    tableManifests = admittedSchema.tables;
    initialWorkspace = makeWorkspace(
      tableManifests,
      cloneTransportValue(initialRows ?? Object.create(null)),
    );
    const workspace = cloneWorkspace(initialWorkspace);
    const admittedPlan = clonePlanValue(plan);
    const admittedArgs = cloneTransportValue(args ?? Object.create(null));
    inputCtxLedger = cloneTransportValue(ctxLedger ?? null);
    const ledger = prepareLedger(inputCtxLedger);
    const steps = admittedPlan?.steps;
    if (!Array.isArray(steps)) fail('SNAPBACK_PLAN_INVALID', 'mutation plan steps must be an array');
    if (steps.length > MAX_PLAN_STEPS) {
      fail('SNAPBACK_PLAN_BOUNDS', `mutation plan exceeds the ${MAX_PLAN_STEPS}-step bound`);
    }

    const bindings = new Map();
    const environment = {
      args: admittedArgs,
      authUserId: authUserId ?? null,
      bindings,
      nowMs: ledger.now,
      runtimeId: () => ledger.nextId(),
    };
    let changedCount = 0;

    for (const [planStepIndex, step] of steps.entries()) {
      const kinds = Object.keys(step ?? {});
      if (kinds.length !== 1) {
        fail('SNAPBACK_PLAN_INVALID', 'mutation step must name exactly one operation');
      }
      const kind = kinds[0];
      const body = step[kind];

      if (kind === 'Insert') {
        const rows = tableRows(workspace, body.table);
        const id = ledger.nextId();
        if (body.bind_id_as) bindings.set(body.bind_id_as, id);
        const row = { ...evaluateValues(body.values, environment), _id: id };
        rows.push(row);
        writeSet.push({
          operation: 'insert',
          table: body.table,
          planStepIndex,
          id,
          row: cloneTransportValue(row),
        });
        changedCount += 1;
      } else if (kind === 'Patch') {
        if (Object.keys(body.values ?? {}).length === 0) continue;
        const id = expectString(evalValueExpr(body.id, environment), 'patch id');
        const values = evaluateValues(body.values, environment);
        const rows = tableRows(workspace, body.table);
        const index = rows.findIndex((row) => row?._id === id);
        if (index !== -1) {
          rows[index] = { ...rows[index], ...values };
          writeSet.push({
            operation: 'patch',
            table: body.table,
            planStepIndex,
            id,
            values: cloneTransportValue(values),
            row: cloneTransportValue(rows[index]),
          });
          changedCount += 1;
        }
      } else if (kind === 'Delete') {
        const id = expectString(evalValueExpr(body.id, environment), 'delete id');
        const rows = tableRows(workspace, body.table);
        const index = rows.findIndex((row) => row?._id === id);
        if (index !== -1) {
          rows.splice(index, 1);
          writeSet.push({ operation: 'delete', table: body.table, planStepIndex, id });
          changedCount += 1;
        }
      } else if (kind === 'Get') {
        const id = expectString(evalValueExpr(body.id, environment), 'get id');
        const row = tableRows(workspace, body.table).find((candidate) => candidate?._id === id) ?? null;
        if (row === null && body.else_error) {
          fail(body.else_error, `get on ${body.table} ${id} found no row`);
        }
        bindings.set(body.bind_as, cloneTransportValue(row));
      } else if (kind === 'Guard') {
        if (!truthy(evalValueExpr(body.cond, environment))) {
          fail(body.else_error, 'mutation guard failed');
        }
      } else if (kind === 'Let') {
        bindings.set(body.bind_as, evalValueExpr(body.expr, environment));
      } else if (kind === 'DeleteWhere') {
        const filters = (body.filter ?? []).map((filter) => ({
          ...filter,
          value: { Literal: evalValueExpr(filter.value, environment) },
        }));
        const rows = tableRows(workspace, body.table);
        const retained = [];
        for (const row of rows) {
          if (filters.every((filter) => filterMatches(filter, environment, row))) {
            writeSet.push({
              operation: 'delete',
              table: body.table,
              planStepIndex,
              id: row?._id ?? null,
            });
            changedCount += 1;
          } else {
            retained.push(row);
          }
        }
        workspace.set(body.table, retained);
      } else if (kind === 'InsertEach') {
        const source = evalValueExpr(body.source, environment);
        if (!Array.isArray(source)) {
          fail('SNAPBACK_PLAN_SOURCE_INVALID', 'InsertEach source must evaluate to an array');
        }
        if (source.length > MAX_INSERT_EACH_FANOUT) {
          fail('SNAPBACK_PLAN_BOUNDS', `InsertEach exceeds the ${MAX_INSERT_EACH_FANOUT}-row bound`);
        }
        const rows = tableRows(workspace, body.table);
        for (const item of source) {
          const itemBindings = new Map(bindings);
          itemBindings.set(body.item_as, item);
          const itemEnvironment = { ...environment, bindings: itemBindings };
          const id = ledger.nextId();
          const row = { ...evaluateValues(body.values, itemEnvironment), _id: id };
          rows.push(row);
          writeSet.push({
            operation: 'insert',
            table: body.table,
            planStepIndex,
            id,
            row: cloneTransportValue(row),
          });
          changedCount += 1;
        }
      } else {
        fail('SNAPBACK_PLAN_UNSUPPORTED_STEP', `unsupported mutation step ${kind}`);
      }
    }

    const result = evaluateReturn(
      admittedPlan.return_value,
      workspace,
      environment,
      changedCount,
    );
    const outputCtxLedger = ledger.finish();
    return {
      outcome: freezeTree({
        name,
        status: 'committed',
        result: canonicalValue(result),
        changedCount,
        inputCtxLedger: canonicalValue(inputCtxLedger),
        outputCtxLedger: canonicalValue(outputCtxLedger),
        rejectionCode: null,
        rows: normalizedRows(workspace, tableManifests),
      }),
      writeSet: freezeTree(writeSet),
    };
  } catch (error) {
    return {
      outcome: freezeTree(rejectedOutcome({
        name,
        inputCtxLedger,
        initialWorkspace,
        tableManifests,
        error,
      })),
      writeSet: Object.freeze([]),
    };
  }
};

/**
 * Execute one complete data-tier v1 case against a cloned, in-memory workspace.
 * The returned shape is the exact D5 normalized browser-runner contract.
 */
export function evaluateBrowserIrPlanV1(input) {
  return executeBrowserIrPlanV1(input ?? {}).outcome;
}

const expressionKinds = (expression, into = new Set()) => {
  if (typeof expression === 'string') {
    if (UNIT_EXPRESSIONS.has(expression)) into.add(expression);
    return into;
  }
  if (expression === null || typeof expression !== 'object') return into;
  const keys = Object.keys(expression);
  if (keys.length !== 1) return into;
  const kind = keys[0];
  into.add(kind);
  const body = expression[kind];
  if (kind === 'Field') expressionKinds(body?.base, into);
  if (kind === 'Binary') {
    expressionKinds(body?.left, into);
    expressionKinds(body?.right, into);
  }
  if (kind === 'Unary') expressionKinds(body?.expr, into);
  if (kind === 'If') {
    expressionKinds(body?.cond, into);
    expressionKinds(body?.then, into);
    expressionKinds(body?.else, into);
  }
  if (kind === 'Concat' && Array.isArray(body)) {
    for (const part of body) expressionKinds(part, into);
  }
  if (kind === 'Call' && Array.isArray(body?.args)) {
    for (const argument of body.args) expressionKinds(argument, into);
  }
  if (kind === 'Record' && body?.fields && typeof body.fields === 'object') {
    for (const field of Object.values(body.fields)) expressionKinds(field, into);
  }
  return into;
};

const planExpressions = (plan) => {
  const expressions = [];
  for (const step of plan?.steps ?? []) {
    const kind = Object.keys(step ?? {})[0];
    const body = step?.[kind];
    if (body?.id !== undefined) expressions.push(body.id);
    if (body?.scope !== undefined) expressions.push(body.scope);
    if (body?.scope_id !== undefined) expressions.push(body.scope_id);
    if (body?.cond !== undefined) expressions.push(body.cond);
    if (body?.expr !== undefined) expressions.push(body.expr);
    if (body?.source !== undefined) expressions.push(body.source);
    if (body?.values && typeof body.values === 'object') {
      expressions.push(...Object.values(body.values));
    }
    if (Array.isArray(body?.filter)) {
      expressions.push(...body.filter.map((filter) => filter.value));
    }
  }
  if (plan?.return_value?.Document?.id !== undefined) {
    expressions.push(plan.return_value.Document.id);
  }
  if (plan?.return_value?.Expr !== undefined) expressions.push(plan.return_value.Expr);
  return expressions;
};

const classification = (classificationName, code, details = {}) => freezeTree({
  classification: classificationName,
  code,
  details,
});

/** Classify a generated plan against the lane-M1 local effect ceiling. */
export function classifyLocalMutationIrV1({
  plan,
  declaredEffectClass = BROWSER_IR_LOCAL_EFFECT_CLASS,
  readAdmission = 'ready',
} = {}) {
  if (!BROWSER_IR_ADMISSION_CLASSES.includes(readAdmission)) {
    return classification('refused', 'SNAPBACK_IR_READ_ADMISSION_INVALID');
  }
  if (readAdmission === 'server-only') {
    return classification('server-only', 'SNAPBACK_IR_READS_SERVER_ONLY');
  }
  if (readAdmission === 'refused') {
    return classification('refused', 'SNAPBACK_IR_READS_REFUSED');
  }
  if (declaredEffectClass !== BROWSER_IR_LOCAL_EFFECT_CLASS) {
    return classification('refused', 'SNAPBACK_IR_LOCAL_CLASS_MISMATCH', {
      declaredEffectClass: declaredEffectClass ?? null,
    });
  }

  let admittedPlan;
  try {
    admittedPlan = clonePlanValue(plan);
  } catch (error) {
    return classification('refused', error?.code ?? 'SNAPBACK_PLAN_INVALID');
  }
  if (!Array.isArray(admittedPlan?.steps)) {
    return classification('refused', 'SNAPBACK_PLAN_INVALID');
  }
  if (admittedPlan.steps.length > MAX_PLAN_STEPS) {
    return classification('refused', 'SNAPBACK_PLAN_BOUNDS');
  }
  let deleteSteps = 0;
  for (const step of admittedPlan.steps) {
    const kinds = Object.keys(step ?? {});
    if (kinds.length !== 1) return classification('refused', 'SNAPBACK_PLAN_INVALID');
    const kind = kinds[0];
    if (kind === 'Delete') {
      deleteSteps += 1;
      if (deleteSteps > 1) {
        return classification('refused', 'SNAPBACK_PLAN_EFFECT_CEILING', { step: 'Delete' });
      }
    }
    if (SERVER_ONLY_STEPS.has(kind)) {
      return classification('server-only', 'SNAPBACK_PLAN_SERVER_ONLY_STEP', { step: kind });
    }
    if (!LOCAL_STEPS.has(kind)) {
      return classification('refused', 'SNAPBACK_PLAN_EFFECT_CEILING', { step: kind });
    }
  }
  for (const expression of planExpressions(admittedPlan)) {
    for (const kind of expressionKinds(expression)) {
      if (SERVER_ONLY_EXPRESSIONS.has(kind)) {
        return classification('server-only', 'SNAPBACK_VALUE_EXPR_AUTHORITATIVE_ONLY', {
          expression: kind,
        });
      }
    }
  }
  return classification(
    readAdmission,
    readAdmission === 'predictable-with-partial-input'
      ? 'SNAPBACK_IR_PREDICTABLE_WITH_PARTIAL_INPUT'
      : 'SNAPBACK_IR_READY',
  );
}

/**
 * Evaluate a locally admitted M1 mutation into a private, immutable layer.
 * `readAdmission` and `initialRows` are caller-supplied admission facts; this
 * evaluator performs no hydration, lookup, I/O, clock read, or id mint.
 */
export function evaluateLocalMutationIrV1(input = {}) {
  const admitted = classifyLocalMutationIrV1(input);
  if (
    admitted.classification === 'server-only'
    || admitted.classification === 'refused'
  ) {
    return freezeTree({ ...admitted, execution: null, ledgerClaim: null, layer: null });
  }
  if (typeof input.layerId !== 'string' || input.layerId.length === 0 || input.layerId.length > 256) {
    return freezeTree({
      ...classification('refused', 'SNAPBACK_IR_LAYER_ID_INVALID'),
      execution: null,
      ledgerClaim: null,
      layer: null,
    });
  }

  const evaluated = executeBrowserIrPlanV1(input);
  const ledgerClaim = freezeTree({
    label: BROWSER_IR_CTX_CLAIM_LABEL,
    authority: 'never-authority',
    inputCtxLedger: evaluated.outcome.inputCtxLedger,
    outputCtxLedger: evaluated.outcome.outputCtxLedger,
  });
  if (evaluated.outcome.status === 'rejected') {
    return freezeTree({
      ...admitted,
      code: 'SNAPBACK_IR_PREDICTION_REJECTED',
      execution: evaluated.outcome,
      ledgerClaim,
      layer: null,
    });
  }

  return freezeTree({
    ...admitted,
    code: 'SNAPBACK_IR_PREDICTION_READY',
    execution: evaluated.outcome,
    ledgerClaim,
    layer: {
      format: 'snapback.private-optimistic-layer.v1',
      visibility: 'private',
      layerId: input.layerId,
      operationName: input.name,
      writes: evaluated.writeSet,
      declaredTableRows: evaluated.outcome.rows,
    },
  });
}
