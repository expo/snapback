// THROWAWAY SPIKE — not a package export and not a product evaluator.
//
// This module sizes the smallest credible Candidate-A seam over the landed
// materialization vocabulary. It deliberately returns private layer data and
// never mutates the LLP 0166 store.

import {
  deriveOptimisticReducer,
  evalValueExpr,
} from '../../../../../../packages/snapback-contract/derived-overlay.mjs';
import {
  canonicalizeClientValueV1,
} from '../../../../../../packages/snapback-client/canonical-client-value.mjs';
import {
  deriveQmk1AnswerV1,
} from '../../../../../../packages/snapback-client/answer-classes.mjs';

export const SPIKE_ADMISSION_CLASSES = Object.freeze([
  'ready',
  'predictable-with-partial-input',
  'server-only',
  'refused',
]);

export const SPIKE_KANBAN_EFFECT_CLASS = 'spike.kanban-point-indexed.v1';

const LOCAL_STEPS = new Set(['Insert', 'Patch', 'Get', 'Guard']);
const SERVER_ONLY_STEPS = new Set([
  'AllocateSequence',
  'AssertCurrentRelation',
  'AssertSourceChanged',
]);
const SERVER_ONLY_EXPRS = new Set([
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
const LEDGER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const encoder = new TextEncoder();

const result = (admission, code, extra = {}) => Object.freeze({ admission, code, ...extra });

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function expressionKinds(expr, into = new Set()) {
  if (typeof expr === 'string') {
    into.add(expr);
    return into;
  }
  if (expr === null || typeof expr !== 'object') return into;
  const kind = Object.keys(expr)[0];
  if (kind) into.add(kind);
  if (kind === 'Field') expressionKinds(expr.Field.base, into);
  if (kind === 'Binary') {
    expressionKinds(expr.Binary.left, into);
    expressionKinds(expr.Binary.right, into);
  }
  if (kind === 'Unary') expressionKinds(expr.Unary.expr, into);
  if (kind === 'If') {
    expressionKinds(expr.If.cond, into);
    expressionKinds(expr.If.then, into);
    expressionKinds(expr.If.else, into);
  }
  if (kind === 'Concat') expr.Concat.forEach((part) => expressionKinds(part, into));
  if (kind === 'Call') expr.Call.args.forEach((part) => expressionKinds(part, into));
  if (kind === 'Record') Object.values(expr.Record.fields).forEach((part) => expressionKinds(part, into));
  return into;
}

function planExpressions(plan) {
  const expressions = [];
  for (const step of plan?.steps ?? []) {
    const kind = Object.keys(step)[0];
    const body = step[kind];
    if (body?.id) expressions.push(body.id);
    if (body?.scope) expressions.push(body.scope);
    if (body?.scope_id) expressions.push(body.scope_id);
    if (body?.cond) expressions.push(body.cond);
    if (body?.expr) expressions.push(body.expr);
    if (body?.source) expressions.push(body.source);
    if (body?.values) expressions.push(...Object.values(body.values));
    if (body?.filter) expressions.push(...body.filter.map((filter) => filter.value));
  }
  const returnValue = plan?.return_value;
  if (returnValue?.Document?.id) expressions.push(returnValue.Document.id);
  if (returnValue?.Expr) expressions.push(returnValue.Expr);
  return expressions;
}

export function classifySpikePlan(plan, declaredEffectClass) {
  if (declaredEffectClass === 'server-only') {
    return result('server-only', 'SPIKE_DECLARED_SERVER_ONLY');
  }
  if (declaredEffectClass !== SPIKE_KANBAN_EFFECT_CLASS || !Array.isArray(plan?.steps)) {
    return result('refused', 'SPIKE_DECLARED_LOCAL_CLASS_MISMATCH');
  }
  for (const step of plan.steps) {
    const keys = Object.keys(step ?? {});
    if (keys.length !== 1) return result('refused', 'SPIKE_MALFORMED_STEP');
    const kind = keys[0];
    if (SERVER_ONLY_STEPS.has(kind)) {
      return result('server-only', `SPIKE_SERVER_ONLY_STEP_${kind}`);
    }
    if (!LOCAL_STEPS.has(kind)) {
      return result('refused', `SPIKE_EFFECT_CEILING_STEP_${kind}`);
    }
    const table = step[kind]?.table;
    if (table !== undefined && table !== 'cards') {
      return result('refused', 'SPIKE_EFFECT_CEILING_TABLE');
    }
  }
  for (const expr of planExpressions(plan)) {
    for (const kind of expressionKinds(expr)) {
      if (SERVER_ONLY_EXPRS.has(kind)) {
        return result('server-only', `SPIKE_SERVER_ONLY_EXPR_${kind}`);
      }
    }
  }
  return result('ready', 'SPIKE_PLAN_ADMITTED');
}

function prepareLedger(ledger) {
  canonicalizeClientValueV1(ledger);
  if (ledger?.version !== 1) {
    throw Object.assign(new Error('ctx ledger version is not v1'), {
      code: 'SNAPBACK_CTX_LEDGER_VERSION_UNSUPPORTED',
    });
  }
  if (!Array.isArray(ledger.ids) || ledger.ids.length > 1_024) {
    throw Object.assign(new Error('ctx ledger id list is invalid'), {
      code: 'SNAPBACK_CTX_LEDGER_LIMIT_EXCEEDED',
    });
  }
  if (ledger.ids.some((id) => typeof id !== 'string' || !LEDGER_ID.test(id))) {
    throw Object.assign(new Error('ctx ledger contains an invalid id'), {
      code: 'SNAPBACK_CTX_LEDGER_ID_INVALID',
    });
  }
  if (!Number.isSafeInteger(ledger.now) || ledger.now < 0) {
    throw Object.assign(new Error('ctx ledger timestamp is outside the portable range'), {
      code: 'SNAPBACK_TIMESTAMP_OUT_OF_RANGE',
    });
  }
  let cursor = 0;
  return {
    now: ledger.now,
    nextId() {
      if (cursor >= ledger.ids.length) {
        throw Object.assign(new Error('ctx ledger id answers exhausted'), {
          code: 'SNAPBACK_CTX_LEDGER_EXHAUSTED',
        });
      }
      const value = ledger.ids[cursor];
      cursor += 1;
      return value;
    },
    finish() {
      if (cursor !== ledger.ids.length) {
        throw Object.assign(new Error('ctx ledger has unused id answers'), {
          code: 'SNAPBACK_CTX_LEDGER_UNUSED_IDS',
        });
      }
      return Object.freeze({
        version: 1,
        idsUsed: cursor,
        now: ledger.now,
        authority: 'labeled-client-claim',
      });
    },
  };
}

function materializationAnswer(materialization) {
  const record = materialization?.record;
  if (
    record?.format !== 'snapback.materialization-record.v1'
    || !Array.isArray(record.address)
    || record.address[0] !== 'snapback:client-materialization-address:v1'
    || !Number.isSafeInteger(record.queryInstanceId)
    || typeof record.authorityPartitionDigest !== 'string'
  ) {
    return result('refused', 'SPIKE_MATERIALIZATION_RECORD_MISMATCH');
  }
  const answer = deriveQmk1AnswerV1(materialization.answerFacts);
  return result('ready', 'SPIKE_MATERIALIZATION_SHAPE_ADMITTED', { answer });
}

function requirementForGet(step, requirements) {
  const body = step.Get;
  const matching = requirements.filter((requirement) => (
    requirement.kind === 'point'
    && requirement.table === body.table
    && requirement.binding === body.bind_as
  ));
  if (matching.length !== 1) return null;
  const requirement = matching[0];
  if (!own(body.id, 'Arg') || body.id.Arg !== requirement.idArg) return null;
  return requirement;
}

function rowForId(rows, id) {
  return rows.find((row) => row?._id === id) ?? null;
}

function coversFields(materialization, requirement) {
  const fields = new Set(materialization.coverage?.projectedFields ?? []);
  return requirement.requiredFields.every((field) => fields.has(field));
}

function admitReads(plan, requirements, materializations, args) {
  const gets = plan.steps.filter((step) => own(step, 'Get'));
  if (gets.length !== requirements.length) {
    return result('refused', 'SPIKE_LOCAL_READ_DECLARATION_MISMATCH');
  }
  let partial = false;
  for (const step of gets) {
    const requirement = requirementForGet(step, requirements);
    if (!requirement) return result('refused', 'SPIKE_LOCAL_READ_DECLARATION_MISMATCH');
    const id = args?.[requirement.idArg];
    if (typeof id !== 'string') return result('refused', 'SPIKE_POINT_ID_NOT_STRING');
    let positive = false;
    let provenAbsent = false;
    for (const materialization of materializations) {
      const classified = materializationAnswer(materialization);
      if (classified.admission === 'refused') return classified;
      if (classified.answer.answerClass !== 'authoritative') continue;
      if (materialization.coverage?.table !== requirement.table) continue;
      if (!coversFields(materialization, requirement)) continue;
      const row = rowForId(materialization.rows ?? [], id);
      if (row) {
        positive = true;
        if (materialization.coverage.completeForTable !== true) partial = true;
      } else if (materialization.coverage.completeForTable === true) {
        provenAbsent = true;
      }
    }
    if (!positive && !provenAbsent) {
      return result('server-only', 'SPIKE_POINT_READ_NOT_SATISFIABLE');
    }
  }
  return result(
    partial ? 'predictable-with-partial-input' : 'ready',
    partial ? 'SPIKE_READS_PARTIAL_POSITIVE_ONLY' : 'SPIKE_READS_COMPLETE',
  );
}

function mergeWorkspace(materializations) {
  const rows = new Map();
  let authorityPartitionDigest = null;
  for (const materialization of materializations) {
    const classified = materializationAnswer(materialization);
    if (classified.admission === 'refused') return classified;
    if (classified.answer.answerClass !== 'authoritative') continue;
    const digest = materialization.record.authorityPartitionDigest;
    if (authorityPartitionDigest !== null && authorityPartitionDigest !== digest) {
      return result('server-only', 'SPIKE_CROSS_AUTHORITY_MERGE_FORBIDDEN');
    }
    authorityPartitionDigest = digest;
    for (const row of materialization.rows ?? []) {
      const prior = rows.get(row?._id);
      if (prior && canonicalizeClientValueV1(prior) !== canonicalizeClientValueV1(row)) {
        return result('server-only', 'SPIKE_CROSS_MATERIALIZATION_ROW_AMBIGUOUS');
      }
      if (typeof row?._id === 'string') rows.set(row._id, row);
    }
  }
  return result('ready', 'SPIKE_EPHEMERAL_WORKSPACE_READY', { rows: [...rows.values()] });
}

function compareUtf8(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compareScalar(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') return compareUtf8(left, right);
  throw Object.assign(new Error('spike comparator received a non-homogeneous scalar pair'), {
    code: 'SPIKE_COMPARATOR_OUT_OF_PROFILE',
  });
}

function projectRows(rows, coverage) {
  let projected = [...rows];
  for (const filter of coverage?.filters ?? []) {
    projected = projected.filter((row) => row?.[filter.field] === filter.value);
  }
  const order = coverage?.order ?? [];
  projected.sort((left, right) => {
    for (const item of order) {
      const compared = compareScalar(left?.[item.field], right?.[item.field]);
      if (compared !== 0) return item.direction === 'desc' ? -compared : compared;
    }
    return 0;
  });
  return projected;
}

export function evaluateKanbanMutationSpike({
  name,
  plan,
  declaredEffectClass,
  localReadRequirements,
  args,
  ctxLedger,
  materializations,
}) {
  canonicalizeClientValueV1(args ?? {});
  const classifiedPlan = classifySpikePlan(plan, declaredEffectClass);
  if (classifiedPlan.admission !== 'ready') return classifiedPlan;
  const reads = admitReads(plan, localReadRequirements ?? [], materializations ?? [], args ?? {});
  if (reads.admission === 'server-only' || reads.admission === 'refused') return reads;
  const workspace = mergeWorkspace(materializations ?? []);
  if (workspace.admission !== 'ready') return workspace;

  let ledger;
  try {
    ledger = prepareLedger(ctxLedger ?? { version: 1, ids: [], now: 0 });
  } catch (error) {
    return result('refused', error?.code ?? 'SPIKE_LEDGER_INVALID');
  }
  const evaluationErrors = [];
  const reducer = deriveOptimisticReducer({
    name,
    plan,
    table: 'cards',
    onError: (_code, _message, details) => evaluationErrors.push(details),
  });
  if (!reducer) return result('refused', 'SPIKE_SHIPPED_EVALUATOR_DID_NOT_DERIVE');
  const evaluated = reducer(workspace.rows, args ?? {}, {
    userId: null,
    optimisticId: 'spike-no-ledger-id',
    nowMs: ledger.now,
    runtimeId: () => ledger.nextId(),
  });
  if (evaluationErrors.length > 0) {
    return result(reads.admission, 'SPIKE_PREDICTION_SKIPPED', {
      prediction: Object.freeze({ kind: 'skipped', code: evaluationErrors[0].code }),
      layers: Object.freeze([]),
    });
  }
  let ledgerClaim;
  try {
    ledgerClaim = ledger.finish();
  } catch (error) {
    return result('refused', error?.code ?? 'SPIKE_LEDGER_DIVERGENCE');
  }
  const layers = (materializations ?? []).map((materialization) => Object.freeze({
    kind: 'spike-private-optimistic-layer',
    address: materialization.record.address,
    baseQueryInstanceId: materialization.record.queryInstanceId,
    rows: Object.freeze(projectRows(evaluated, materialization.coverage)),
    authority: 'prediction-only',
  }));
  return result(reads.admission, 'SPIKE_PREDICTION_READY', {
    prediction: Object.freeze({ kind: 'rows', ledgerClaim }),
    layers: Object.freeze(layers),
  });
}

// Keep this helper exported so the measurement retains the same expression
// evaluator used by the admission path without inventing a second parser.
export function evaluatePointIdForEvidence(expr, args) {
  return evalValueExpr(expr, { args, bindings: new Map(), nowMs: 0, runtimeId: null });
}
