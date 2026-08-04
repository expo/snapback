// Browser-safe Move-3 local-read admission. Registration is interest, not
// authority: generated coverage says what an address may answer, while the
// materialization answer class decides whether any rows may enter the IR
// evaluator's private workspace.
//
// @ref LLP 0155#local-read-admission — missing input never becomes an empty
//   table; server-only is an ordinary, inspectable prediction outcome.
// @ref LLP 0166#d4--completeness-honest-local-answers — only an
//   authoritative answer may contribute rows or prove point absence.

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import {
  classifyLocalMutationIrV1,
  evaluateLocalMutationIrV1,
} from './ir-evaluator.mjs';

export const LOCAL_READ_COVERAGE_FORMAT_V1 =
  'snapback.local-read-materialization-coverage.v1';
export const LOCAL_READ_ADMISSION_FORMAT_V1 = 'snapback.local-read-admission.v1';
export const LOCAL_MUTATION_PREDICTION_FORMAT_V1 =
  'snapback.local-mutation-prediction.v1';

const QMK = /^qmk1\.[A-Za-z0-9_-]{43}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ANSWER_CLASSES = new Set([
  'authoritative',
  'lease-authorized-retained',
  'labeled-retained',
  'unknown',
  'refused',
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const deepFreeze = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const frozen = (value) => deepFreeze(value);

const canonicalClone = (value) => JSON.parse(canonicalizeClientValueV1(value));

const stableText = (value) => canonicalizeClientValueV1(value);

const sameSet = (left, right) => (
  left.size === right.size && [...left].every((entry) => right.has(entry))
);

const classification = (classificationName, code, details = {}) => ({
  classification: classificationName,
  code,
  details,
});

const admissionResult = ({
  classification: classificationName,
  code,
  details = {},
  declaredReads = [],
  reads = [],
  failures = [],
  admittedRows = null,
}) => frozen({
  format: LOCAL_READ_ADMISSION_FORMAT_V1,
  classification: classificationName,
  code,
  details,
  declaredReads,
  reads,
  failures,
  admittedRows,
});

const exactKeys = (value, keys) => (
  plain(value)
  && Object.keys(value).length === keys.length
  && keys.every((key) => own(value, key))
);

/**
 * Derive the only v1 source-row coverage admitted by the landed store:
 * single_table_v1@1 returning the generated documents(table) contract.
 * The result is bound to the exact QMK, plan, and result-contract identity;
 * callers cannot reinterpret one authoritative fragment as another table.
 */
export function deriveGeneratedLocalReadCoverageV1({ ref, materializationKey } = {}) {
  try {
    if (!QMK.test(materializationKey ?? '')) return null;
    if (
      ref?.artifactKind !== 'functionReference'
      || !DIGEST.test(ref?.composition?.planHash ?? '')
      || !DIGEST.test(ref?.resultContractHash ?? '')
    ) return null;
    const normalized = ref.composition.normalizedCompositePlan;
    if (
      normalized?.format !== 'snapback.normalized-composite-plan.v1'
      || normalized.profileId !== 'single-node.v1'
      || !Array.isArray(normalized.nodes)
      || normalized.nodes.length !== 1
    ) return null;
    const node = normalized.nodes[0];
    const nodePlan = node?.nodePlan;
    const query = nodePlan?.normalizedPlan?.query;
    if (
      node?.position !== 0
      || nodePlan?.format !== 'snapback.node-plan.v1'
      || nodePlan.classId !== 'single_table_v1'
      || nodePlan.classVersion !== 1
      || nodePlan.normalizedPlan?.format !== 'snapback.single-table-plan.v1'
      || typeof query?.table !== 'string'
      || query.table.length === 0
      || !Array.isArray(query.filters)
      || !Array.isArray(query.membershipFilters)
      || !own(query, 'limit')
    ) return null;
    const resultContract = ref.composition.resultContract;
    if (
      resultContract?.kind !== 'documents'
      || resultContract.table !== query.table
      || !Array.isArray(resultContract.document?.fields)
    ) return null;
    const projectedFields = resultContract.document.fields.map((field) => field?.name);
    if (
      projectedFields.some((field) => typeof field !== 'string' || field.length === 0)
      || new Set(projectedFields).size !== projectedFields.length
    ) return null;
    return frozen({
      format: LOCAL_READ_COVERAGE_FORMAT_V1,
      materializationKey,
      planHash: ref.composition.planHash,
      resultContractHash: ref.resultContractHash,
      table: query.table,
      projectedFields: [...projectedFields].sort(),
      absence: query.filters.length === 0
        && query.membershipFilters.length === 0
        && query.limit === null
        ? 'table-complete'
        : 'unproven',
    });
  } catch {
    return null;
  }
}

export function prepareLocalReadCoverageV1(value) {
  try {
    if (!exactKeys(value, [
      'format',
      'materializationKey',
      'planHash',
      'resultContractHash',
      'table',
      'projectedFields',
      'absence',
    ])) return null;
    if (
      value.format !== LOCAL_READ_COVERAGE_FORMAT_V1
      || !QMK.test(value.materializationKey ?? '')
      || !DIGEST.test(value.planHash ?? '')
      || !DIGEST.test(value.resultContractHash ?? '')
      || typeof value.table !== 'string'
      || value.table.length === 0
      || !Array.isArray(value.projectedFields)
      || !['table-complete', 'unproven'].includes(value.absence)
    ) return null;
    const fields = value.projectedFields;
    if (
      fields.some((field) => typeof field !== 'string' || field.length === 0)
      || new Set(fields).size !== fields.length
      || fields.some((field, index) => index > 0 && fields[index - 1] >= field)
    ) return null;
    return frozen(canonicalClone(value));
  } catch {
    return null;
  }
}

const planExpressions = (plan) => {
  const expressions = [];
  for (const step of plan?.steps ?? []) {
    const kind = Object.keys(step ?? {})[0];
    const body = step?.[kind];
    if (body?.id !== undefined) expressions.push(body.id);
    if (body?.cond !== undefined) expressions.push(body.cond);
    if (body?.expr !== undefined) expressions.push(body.expr);
    if (body?.source !== undefined) expressions.push(body.source);
    if (body?.values && typeof body.values === 'object') {
      expressions.push(...Object.values(body.values));
    }
  }
  if (plan?.return_value?.Document?.id !== undefined) {
    expressions.push(plan.return_value.Document.id);
  }
  if (plan?.return_value?.Expr !== undefined) expressions.push(plan.return_value.Expr);
  return expressions;
};

const collectBindingFields = (expression, binding, fields) => {
  if (expression === null || typeof expression !== 'object') return;
  const keys = Object.keys(expression);
  if (keys.length !== 1) return;
  const kind = keys[0];
  const body = expression[kind];
  if (kind === 'Field') {
    if (body?.base?.Binding === binding && typeof body?.key === 'string') fields.add(body.key);
    collectBindingFields(body?.base, binding, fields);
  } else if (kind === 'Binary') {
    collectBindingFields(body?.left, binding, fields);
    collectBindingFields(body?.right, binding, fields);
  } else if (kind === 'Unary') {
    collectBindingFields(body?.expr, binding, fields);
  } else if (kind === 'If') {
    collectBindingFields(body?.cond, binding, fields);
    collectBindingFields(body?.then, binding, fields);
    collectBindingFields(body?.else, binding, fields);
  } else if (kind === 'Concat' && Array.isArray(body)) {
    for (const part of body) collectBindingFields(part, binding, fields);
  } else if (kind === 'Call' && Array.isArray(body?.args)) {
    for (const argument of body.args) collectBindingFields(argument, binding, fields);
  } else if (kind === 'Record' && plain(body?.fields)) {
    for (const field of Object.values(body.fields)) collectBindingFields(field, binding, fields);
  }
};

const prepareOperationReads = (operation) => {
  let declaredReads;
  let requirements;
  let schema;
  let plan;
  let args;
  try {
    declaredReads = canonicalClone(operation?.declaredReads);
    requirements = canonicalClone(operation?.localReadRequirements);
    schema = canonicalClone(operation?.schema);
    plan = structuredClone(operation?.plan);
    args = canonicalClone(operation?.args ?? {});
  } catch {
    return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };
  }
  if (
    !Array.isArray(declaredReads)
    || declaredReads.some((table) => typeof table !== 'string' || table.length === 0)
    || new Set(declaredReads).size !== declaredReads.length
    || !Array.isArray(requirements)
    || !Array.isArray(schema?.tables)
    || !Array.isArray(plan?.steps)
  ) return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };

  const schemaTables = new Map(schema.tables.map((table) => [
    table?.name,
    new Set(['_id', ...(table?.fields ?? []).map((field) => field?.name)]),
  ]));
  if (schemaTables.size !== schema.tables.length || schemaTables.has(undefined)) {
    return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };
  }

  const preparedRequirements = [];
  for (const requirement of requirements) {
    if (!exactKeys(requirement, [
      'kind', 'table', 'idArg', 'binding', 'requiredFields',
    ])) return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };
    if (
      requirement.kind !== 'point'
      || typeof requirement.table !== 'string'
      || typeof requirement.idArg !== 'string'
      || requirement.idArg.length === 0
      || (requirement.binding !== null && (
        typeof requirement.binding !== 'string' || requirement.binding.length === 0
      ))
      || !Array.isArray(requirement.requiredFields)
      || requirement.requiredFields.length === 0
      || requirement.requiredFields.some((field) => typeof field !== 'string' || field.length === 0)
      || new Set(requirement.requiredFields).size !== requirement.requiredFields.length
      || !requirement.requiredFields.includes('_id')
    ) return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };
    const tableFields = schemaTables.get(requirement.table);
    if (!tableFields || requirement.requiredFields.some((field) => !tableFields.has(field))) {
      return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_INVALID') };
    }
    if (typeof args?.[requirement.idArg] !== 'string') {
      return { error: classification('refused', 'SNAPBACK_IR_POINT_ID_INVALID', {
        table: requirement.table,
        idArg: requirement.idArg,
      }) };
    }
    preparedRequirements.push({
      ...requirement,
      requiredFields: [...requirement.requiredFields].sort(),
      id: args[requirement.idArg],
    });
  }

  const accesses = [];
  for (const step of plan.steps) {
    const kind = Object.keys(step ?? {})[0];
    if (!['Get', 'Patch'].includes(kind)) continue;
    const body = step[kind];
    if (
      typeof body?.table !== 'string'
      || !exactKeys(body?.id, ['Arg'])
      || typeof body.id.Arg !== 'string'
    ) return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_MISMATCH') };
    accesses.push({
      kind,
      table: body.table,
      idArg: body.id.Arg,
      binding: kind === 'Get' ? body.bind_as : null,
    });
  }
  const actualTables = new Set(accesses.map((access) => access.table));
  const declaredTableSet = new Set(declaredReads);
  const requirementTables = new Set(preparedRequirements.map((requirement) => requirement.table));
  if (
    !sameSet(actualTables, declaredTableSet)
    || !sameSet(requirementTables, declaredTableSet)
  ) return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_MISMATCH') };

  for (const access of accesses) {
    const matches = preparedRequirements.filter((requirement) => (
      requirement.table === access.table
      && requirement.idArg === access.idArg
      && (access.kind !== 'Get' || requirement.binding === access.binding)
    ));
    if (matches.length !== 1) {
      return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_MISMATCH') };
    }
  }
  for (const requirement of preparedRequirements) {
    const matches = accesses.filter((access) => (
      access.table === requirement.table
      && access.idArg === requirement.idArg
      && (requirement.binding === null || access.binding === requirement.binding)
    ));
    if (matches.length === 0) {
      return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_MISMATCH') };
    }
    if (requirement.binding !== null) {
      const usedFields = new Set(['_id']);
      for (const expression of planExpressions(plan)) {
        collectBindingFields(expression, requirement.binding, usedFields);
      }
      const declaredFields = new Set(requirement.requiredFields);
      if (![...usedFields].every((field) => declaredFields.has(field))) {
        return { error: classification('refused', 'SNAPBACK_IR_READ_DECLARATION_MISMATCH', {
          table: requirement.table,
          binding: requirement.binding,
          missingFields: [...usedFields].filter((field) => !declaredFields.has(field)).sort(),
        }) };
      }
    }
  }

  return {
    declaredReads,
    requirements: preparedRequirements,
  };
};

const decodeAuthoritativeRows = (value) => {
  const fragments = value instanceof Uint8Array
    ? [value]
    : Array.isArray(value) && value.every((entry) => entry instanceof Uint8Array)
      ? value
      : null;
  if (fragments === null || fragments.length === 0) return null;
  const rows = [];
  const ids = new Set();
  try {
    for (const fragment of fragments) {
      const decoded = JSON.parse(utf8.decode(fragment));
      if (!Array.isArray(decoded)) return null;
      for (const row of decoded) {
        if (!plain(row) || typeof row._id !== 'string' || ids.has(row._id)) return null;
        ids.add(row._id);
        rows.push(canonicalClone(row));
      }
    }
  } catch {
    return null;
  }
  return rows;
};

const identityMatches = (identity, coverage) => (
  plain(identity)
  && identity.materializationKey === coverage.materializationKey
  && identity.planHash === coverage.planHash
  && identity.resultContractHash === coverage.resultContractHash
  && Number.isSafeInteger(identity.queryInstanceId)
  && identity.queryInstanceId > 0
  && DIGEST.test(identity.authorityPartitionDigest ?? '')
);

const publicSource = (source) => ({
  address: [...source.address],
  materializationKey: source.coverage.materializationKey,
  answerClass: source.answerClass,
  freshness: source.freshness,
  coverage: source.coverage,
  queryInstanceId: source.identity?.queryInstanceId ?? null,
  authorityPartitionDigest: source.identity?.authorityPartitionDigest ?? null,
  code: source.code,
});

const missingReads = (declaredReads, requirements, code) => declaredReads.map((table) => ({
  table,
  state: 'missing',
  rows: null,
  points: requirements.filter((requirement) => requirement.table === table).map((requirement) => ({
    id: requirement.id,
    state: 'missing',
    sourceMaterializationKeys: [],
  })),
  sources: [],
  code,
}));

/**
 * Resolve an operation's generated point-read requirements through the live
 * registration demand set and the store's classified QMK answer seam.
 */
export async function admitLocalMutationReadsV1({
  operation,
  registrationLedger,
  readMaterializationAnswer,
} = {}) {
  const planClass = classifyLocalMutationIrV1({
    plan: operation?.plan,
    declaredEffectClass: operation?.declaredEffectClass,
    readAdmission: 'ready',
  });
  if (planClass.classification === 'server-only' || planClass.classification === 'refused') {
    return admissionResult({
      ...planClass,
      declaredReads: Array.isArray(operation?.declaredReads) ? [...operation.declaredReads] : [],
    });
  }

  const prepared = prepareOperationReads(operation);
  if (prepared.error) {
    return admissionResult({
      ...prepared.error,
      declaredReads: Array.isArray(operation?.declaredReads) ? [...operation.declaredReads] : [],
      failures: [{ code: prepared.error.code, ...prepared.error.details }],
    });
  }
  const { declaredReads, requirements } = prepared;
  if (declaredReads.length === 0) {
    return admissionResult({
      classification: 'ready',
      code: 'SNAPBACK_IR_READS_READY',
      declaredReads,
      admittedRows: {},
    });
  }
  if (
    typeof registrationLedger?.demandedMaterializations !== 'function'
    || typeof readMaterializationAnswer !== 'function'
  ) {
    const code = 'SNAPBACK_IR_READ_STORE_UNAVAILABLE';
    return admissionResult({
      classification: 'server-only',
      code,
      declaredReads,
      reads: missingReads(declaredReads, requirements, code),
      failures: requirements.map((requirement) => ({
        table: requirement.table,
        id: requirement.id,
        code,
      })),
    });
  }

  let demanded;
  try {
    demanded = registrationLedger.demandedMaterializations();
  } catch {
    demanded = null;
  }
  if (!Array.isArray(demanded)) {
    const code = 'SNAPBACK_IR_READ_DEMAND_UNAVAILABLE';
    return admissionResult({
      classification: 'server-only',
      code,
      declaredReads,
      reads: missingReads(declaredReads, requirements, code),
      failures: requirements.map((requirement) => ({ table: requirement.table, id: requirement.id, code })),
    });
  }

  const declaredTableSet = new Set(declaredReads);
  const sources = [];
  for (const demand of demanded) {
    if (
      demand?.family !== 'qmk1'
      || !Array.isArray(demand.address)
      || !QMK.test(demand.address[2] ?? '')
      || !Array.isArray(demand.registrations)
    ) continue;
    const coverages = new Map();
    for (const entry of demand.registrations) {
      const coverage = prepareLocalReadCoverageV1(
        entry?.registration?.functionReference?.localReadCoverage,
      );
      if (
        coverage !== null
        && coverage.materializationKey === demand.address[2]
        && declaredTableSet.has(coverage.table)
      ) coverages.set(stableText(coverage), coverage);
    }
    if (coverages.size !== 1) continue;
    const coverage = [...coverages.values()][0];
    let answer = null;
    let errorCode = null;
    try {
      answer = await readMaterializationAnswer({
        address: [...demand.address],
        materializationKey: demand.address[2],
      });
    } catch (error) {
      errorCode = error?.code ?? 'SNAPBACK_IR_READ_ANSWER_UNAVAILABLE';
    }
    const answerClass = ANSWER_CLASSES.has(answer?.answerClass)
      ? answer.answerClass
      : 'unknown';
    const identity = answer?.materialization ?? null;
    let rows = null;
    let code = errorCode;
    if (code === null && answerClass !== 'authoritative') {
      code = 'SNAPBACK_IR_READ_ANSWER_NOT_AUTHORITATIVE';
    } else if (code === null && !identityMatches(identity, coverage)) {
      code = 'SNAPBACK_IR_READ_IDENTITY_MISMATCH';
    } else if (code === null) {
      rows = decodeAuthoritativeRows(answer.value);
      if (rows === null) code = 'SNAPBACK_IR_READ_RESULT_INVALID';
    }
    sources.push({
      address: [...demand.address],
      coverage,
      answerClass,
      freshness: answer?.freshness ?? null,
      identity,
      rows,
      code,
    });
  }

  const reads = [];
  const failures = [];
  const admittedRows = Object.create(null);
  const admittedAuthorityPartitions = new Set();
  let partial = false;
  let globalConflict = false;

  for (const table of declaredReads) {
    const tableRequirements = requirements.filter((requirement) => requirement.table === table);
    const tableSources = sources.filter((source) => source.coverage.table === table);
    const points = [];
    const tableRows = new Map();
    let tableMissing = false;
    let tableConflict = false;

    for (const requirement of tableRequirements) {
      const requiredFields = new Set(requirement.requiredFields);
      const facts = [];
      for (const source of tableSources) {
        if (
          source.code !== null
          || source.rows === null
          || requirement.requiredFields.some((field) => (
            !source.coverage.projectedFields.includes(field)
          ))
        ) continue;
        const row = source.rows.find((candidate) => candidate._id === requirement.id) ?? null;
        if (row !== null) {
          if ([...requiredFields].some((field) => !own(row, field))) continue;
          facts.push({ kind: 'present', row, source });
        } else if (source.coverage.absence === 'table-complete') {
          facts.push({ kind: 'absent', row: null, source });
        }
      }
      const factPartitions = new Set(facts.map((fact) => fact.source.identity.authorityPartitionDigest));
      const present = facts.filter((fact) => fact.kind === 'present');
      const absent = facts.filter((fact) => fact.kind === 'absent');
      const rowSpellings = new Map(present.map((fact) => [stableText(fact.row), fact.row]));
      if (factPartitions.size > 1) {
        tableConflict = true;
        points.push({
          id: requirement.id,
          state: 'missing',
          sourceMaterializationKeys: facts.map((fact) => fact.source.coverage.materializationKey).sort(),
        });
        failures.push({
          table,
          id: requirement.id,
          code: 'SNAPBACK_IR_READ_AUTHORITY_MISMATCH',
          authorityPartitionDigests: [...factPartitions].sort(),
        });
      } else if (present.length > 0 && (absent.length > 0 || rowSpellings.size > 1)) {
        tableConflict = true;
        points.push({
          id: requirement.id,
          state: 'missing',
          sourceMaterializationKeys: facts.map((fact) => fact.source.coverage.materializationKey).sort(),
        });
        failures.push({
          table,
          id: requirement.id,
          code: 'SNAPBACK_IR_READ_ROW_AMBIGUOUS',
        });
      } else if (present.length > 0) {
        const row = [...rowSpellings.values()][0];
        tableRows.set(requirement.id, row);
        const complete = present.some((fact) => fact.source.coverage.absence === 'table-complete');
        partial ||= !complete;
        const sourceMaterializationKeys = present
          .map((fact) => fact.source.coverage.materializationKey)
          .sort();
        points.push({ id: requirement.id, state: 'present', sourceMaterializationKeys });
        for (const fact of present) {
          admittedAuthorityPartitions.add(fact.source.identity.authorityPartitionDigest);
        }
      } else if (absent.length > 0) {
        const sourceMaterializationKeys = absent
          .map((fact) => fact.source.coverage.materializationKey)
          .sort();
        points.push({ id: requirement.id, state: 'absent', sourceMaterializationKeys });
        for (const fact of absent) {
          admittedAuthorityPartitions.add(fact.source.identity.authorityPartitionDigest);
        }
      } else {
        tableMissing = true;
        points.push({ id: requirement.id, state: 'missing', sourceMaterializationKeys: [] });
        const nonAuthoritative = tableSources.map(publicSource);
        failures.push({
          table,
          id: requirement.id,
          code: tableSources.some((source) => (
            source.answerClass === 'authoritative'
            && source.coverage.absence === 'unproven'
          ))
            ? 'SNAPBACK_IR_POINT_ABSENCE_UNPROVEN'
            : 'SNAPBACK_IR_READ_MATERIALIZATION_MISSING',
          sources: nonAuthoritative,
        });
      }
    }
    const state = tableMissing || tableConflict ? 'missing' : 'admitted';
    const rowsForTable = state === 'admitted' ? [...tableRows.values()] : null;
    if (state === 'admitted') admittedRows[table] = rowsForTable;
    reads.push({
      table,
      state,
      rows: rowsForTable,
      points,
      sources: tableSources.map(publicSource),
      code: tableConflict
        ? 'SNAPBACK_IR_READ_CONFLICT'
        : tableMissing ? 'SNAPBACK_IR_READ_MISSING' : 'SNAPBACK_IR_READ_ADMITTED',
    });
    globalConflict ||= tableConflict;
  }

  if (admittedAuthorityPartitions.size > 1) {
    globalConflict = true;
    failures.push({
      code: 'SNAPBACK_IR_READ_AUTHORITY_MISMATCH',
      authorityPartitionDigests: [...admittedAuthorityPartitions].sort(),
    });
  }
  if (globalConflict || reads.some((read) => read.state === 'missing')) {
    return admissionResult({
      classification: 'server-only',
      code: globalConflict
        ? 'SNAPBACK_IR_READS_CONFLICT'
        : 'SNAPBACK_IR_READS_MISSING',
      declaredReads,
      reads,
      failures,
    });
  }
  return admissionResult({
    classification: partial ? 'predictable-with-partial-input' : 'ready',
    code: partial
      ? 'SNAPBACK_IR_READS_PARTIAL_POSITIVE'
      : 'SNAPBACK_IR_READS_READY',
    declaredReads,
    reads,
    failures,
    admittedRows,
  });
}

/** Admit reads, then feed only the resulting row map to M1's evaluator. */
export async function evaluateLocalMutationWithReadAdmissionV1(input = {}) {
  const admission = await admitLocalMutationReadsV1(input);
  const operation = input.operation ?? {};
  const prediction = evaluateLocalMutationIrV1({
    name: operation.name,
    schema: operation.schema,
    initialRows: admission.admittedRows ?? {},
    plan: operation.plan,
    args: operation.args,
    ctxLedger: operation.ctxLedger,
    authUserId: operation.authUserId,
    layerId: operation.layerId,
    declaredEffectClass: operation.declaredEffectClass,
    readAdmission: admission.classification,
  });
  return frozen({
    format: LOCAL_MUTATION_PREDICTION_FORMAT_V1,
    admission,
    prediction,
  });
}
