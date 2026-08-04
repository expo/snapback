// Test-only browser-safe D5 executor. This is an ephemeral complete workspace
// over the corpus's pinned seed rows; it is not exported, registered, or a
// partial-replica admission implementation. The shipped value evaluator stays
// the semantic authority for expressions while this harness supplies the
// multi-table, atomic whole-plan outcome surface the D5 JS runner needs.
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   replay pins return values, changed counts, resulting rows, ledgers, and
//   typed rejections across runtimes.

import {
  MAX_INSERT_EACH_FANOUT,
  MAX_PLAN_STEPS,
  evalValueExpr,
  truthy,
  valuesEqual,
} from '../../../packages/snapback-contract/derived-overlay.mjs';

const LEDGER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const MAX_LEDGER_IDS = 1_024;

class D5JsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new D5JsError(code, message);
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
};

const canonicalText = (value) => JSON.stringify(canonicalValue(value));

const publicRow = (row) => {
  const out = Object.create(null);
  for (const [key, value] of Object.entries(row ?? {})) {
    if (key.startsWith('_') && key !== '_id') continue;
    out[key] = value;
  }
  return canonicalValue(out);
};

const normalizedRows = (rowsByTable, tableManifests) => {
  const out = {};
  const manifests = new Map(tableManifests.map((table) => [table.name, table]));
  for (const tableName of Object.keys(rowsByTable).sort()) {
    out[tableName] = rowsByTable[tableName]
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
  return out;
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
  if (typeof value !== 'string') fail('SNAPBACK_EXPECTED_STRING', `${label} must evaluate to a string`);
  return value;
};

const fieldValue = (row, field) => (
  row !== null && typeof row === 'object' && own(row, field) ? row[field] : null
);

const filterMatches = (filter, env, row) => {
  const actual = fieldValue(row, filter.field);
  const expected = evalValueExpr(filter.value, env);
  if (actual === null) return false;
  if (filter.op === 'In') {
    return Array.isArray(expected) && expected.some((candidate) => valuesEqual(actual, candidate));
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
  }, env) === true;
};

const createWorkspace = (testCase) => {
  const workspace = new Map();
  for (const table of testCase.schema?.tables ?? []) {
    workspace.set(table.name, cloneJson(testCase.seed?.[table.name] ?? []));
  }
  return workspace;
};

const workspaceRows = (workspace) => Object.fromEntries(
  [...workspace.entries()].map(([table, rows]) => [table, cloneJson(rows)]),
);

const tableRows = (workspace, table) => {
  const rows = workspace.get(table);
  if (!rows) fail('SNAPBACK_UNKNOWN_TABLE', `mutation plan names unknown table ${table}`);
  return rows;
};

const evaluateValues = (values, env) => {
  const row = {};
  for (const [field, expression] of Object.entries(values ?? {})) {
    row[field] = evalValueExpr(expression, env);
  }
  return row;
};

const evaluateReturn = (returnValue, workspace, env, changedCount) => {
  if (returnValue === null || returnValue === undefined || returnValue === 'ChangedCount') {
    return changedCount;
  }
  if (own(returnValue, 'Literal')) return cloneJson(returnValue.Literal);
  if (own(returnValue, 'Binding')) {
    return env.bindings.has(returnValue.Binding)
      ? cloneJson(env.bindings.get(returnValue.Binding))
      : null;
  }
  if (own(returnValue, 'Document')) {
    const id = expectString(evalValueExpr(returnValue.Document.id, env), 'document id');
    return cloneJson(tableRows(workspace, returnValue.Document.table).find((row) => row?._id === id) ?? null);
  }
  if (own(returnValue, 'Expr')) return evalValueExpr(returnValue.Expr, env);
  fail('SNAPBACK_PLAN_RETURN_INVALID', 'mutation plan has an unsupported return form');
};

/** Execute one committed D5 case against an atomic ephemeral workspace. */
export function replayDataTierCaseInJs(testCase) {
  const initialWorkspace = createWorkspace(testCase);
  const workspace = createWorkspace(testCase);
  const inputCtxLedger = cloneJson(testCase.ctxLedger ?? null);

  try {
    const ledger = prepareLedger(inputCtxLedger);
    const steps = testCase.plan?.steps;
    if (!Array.isArray(steps)) fail('SNAPBACK_PLAN_INVALID', 'mutation plan steps must be an array');
    if (steps.length > MAX_PLAN_STEPS) {
      fail('SNAPBACK_PLAN_BOUNDS', `mutation plan exceeds the ${MAX_PLAN_STEPS}-step bound`);
    }

    const bindings = new Map();
    const env = {
      args: testCase.args ?? {},
      authUserId: testCase.authUserId ?? null,
      bindings,
      nowMs: ledger.now,
      runtimeId: () => ledger.nextId(),
    };
    let changedCount = 0;

    for (const step of steps) {
      const kinds = Object.keys(step ?? {});
      if (kinds.length !== 1) fail('SNAPBACK_PLAN_INVALID', 'mutation step must name exactly one operation');
      const kind = kinds[0];
      const body = step[kind];

      if (kind === 'Insert') {
        const rows = tableRows(workspace, body.table);
        const id = ledger.nextId();
        if (body.bind_id_as) bindings.set(body.bind_id_as, id);
        rows.push({ ...evaluateValues(body.values, env), _id: id });
        changedCount += 1;
      } else if (kind === 'Patch') {
        if (Object.keys(body.values ?? {}).length === 0) continue;
        const id = expectString(evalValueExpr(body.id, env), 'patch id');
        const values = evaluateValues(body.values, env);
        const rows = tableRows(workspace, body.table);
        const index = rows.findIndex((row) => row?._id === id);
        if (index !== -1) {
          rows[index] = { ...rows[index], ...values };
          changedCount += 1;
        }
      } else if (kind === 'Delete') {
        const id = expectString(evalValueExpr(body.id, env), 'delete id');
        const rows = tableRows(workspace, body.table);
        const index = rows.findIndex((row) => row?._id === id);
        if (index !== -1) {
          rows.splice(index, 1);
          changedCount += 1;
        }
      } else if (kind === 'Get') {
        const id = expectString(evalValueExpr(body.id, env), 'get id');
        const row = tableRows(workspace, body.table).find((candidate) => candidate?._id === id) ?? null;
        if (row === null && body.else_error) fail(body.else_error, `get on ${body.table} ${id} found no row`);
        bindings.set(body.bind_as, cloneJson(row));
      } else if (kind === 'Guard') {
        if (!truthy(evalValueExpr(body.cond, env))) fail(body.else_error, 'mutation guard failed');
      } else if (kind === 'Let') {
        bindings.set(body.bind_as, evalValueExpr(body.expr, env));
      } else if (kind === 'DeleteWhere') {
        // Rust lowers the filter expressions once before scanning. Literalize
        // them here so RuntimeId would consume the same single answer.
        const filters = (body.filter ?? []).map((filter) => ({
          ...filter,
          value: { Literal: evalValueExpr(filter.value, env) },
        }));
        const rows = tableRows(workspace, body.table);
        const retained = rows.filter((row) => !filters.every((filter) => filterMatches(filter, env, row)));
        changedCount += rows.length - retained.length;
        workspace.set(body.table, retained);
      } else if (kind === 'InsertEach') {
        const source = evalValueExpr(body.source, env);
        if (!Array.isArray(source)) fail('SNAPBACK_PLAN_SOURCE_INVALID', 'InsertEach source must evaluate to an array');
        if (source.length > MAX_INSERT_EACH_FANOUT) {
          fail('SNAPBACK_PLAN_BOUNDS', `InsertEach exceeds the ${MAX_INSERT_EACH_FANOUT}-row bound`);
        }
        const rows = tableRows(workspace, body.table);
        for (const item of source) {
          const itemBindings = new Map(bindings);
          itemBindings.set(body.item_as, item);
          const itemEnv = { ...env, bindings: itemBindings };
          const id = ledger.nextId();
          rows.push({ ...evaluateValues(body.values, itemEnv), _id: id });
          changedCount += 1;
        }
      } else {
        fail('SNAPBACK_PLAN_UNSUPPORTED_STEP', `unsupported mutation step ${kind}`);
      }
    }

    const result = evaluateReturn(testCase.plan.return_value, workspace, env, changedCount);
    const outputCtxLedger = ledger.finish();
    return {
      name: testCase.name,
      status: 'committed',
      result: canonicalValue(result),
      changedCount,
      inputCtxLedger: canonicalValue(inputCtxLedger),
      outputCtxLedger: canonicalValue(outputCtxLedger),
      rejectionCode: null,
      rows: normalizedRows(workspaceRows(workspace), testCase.schema.tables),
    };
  } catch (error) {
    return {
      name: testCase.name,
      status: 'rejected',
      result: null,
      changedCount: null,
      inputCtxLedger: canonicalValue(inputCtxLedger),
      outputCtxLedger: null,
      rejectionCode: error?.code ?? 'SNAPBACK_D5_JS_UNTYPED_ERROR',
      rows: normalizedRows(workspaceRows(initialWorkspace), testCase.schema.tables),
    };
  }
}

export function d5ValuesEqual(left, right) {
  return canonicalText(left) === canonicalText(right);
}

// Complete row-set comparison with the corpus's documented row projection:
// count-exact, distinct-row matching, and exact expected fields. Runtime-owned
// system columns are outside the case projection and are stripped above.
export function d5RowsMatch(expectedRows, actualRows) {
  if (expectedRows.length !== actualRows.length) return false;
  const unmatched = [...actualRows];
  for (const expected of expectedRows) {
    const index = unmatched.findIndex((actual) => Object.entries(expected).every(
      ([key, value]) => own(actual, key) && d5ValuesEqual(value, actual[key]),
    ));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
}
