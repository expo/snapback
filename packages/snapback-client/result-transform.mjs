// Shipped result-transform.v1 evaluator. The pure functions below remain the
// cross-runtime reference; `evaluateAdmittedResultTransformV1` is the closed
// carrier/owner gate used by the client invocation seam.
//
// @ref LLP 0166#the-evaluation-model-result-transformv1 — the transform is a
//   closed record over one established result with the fixed
//   base -> client overlay -> filter -> order -> limit pipeline.

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import { refuseLocalEvaluation } from './evaluation-floor.mjs';

export const RESULT_TRANSFORM_V1_FORMAT = 'snapback.result-transform.v1';
export const RESULT_TRANSFORM_V1_HASH_DOMAIN = 'snapback:result-transform:v1:';
export const RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID =
  'snapback.result-transform.javascript.v1';
export const RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID =
  'snapback.result-transform.rust.v1';
export const RESULT_TRANSFORM_V1_RETENTION_CLASS =
  'result-transform-snapshot-v1';

// @ref LLP 0166#ship-gate — this immutable receipt is code-owned admission,
//   not a caller-supplied feature flag. Browser IndexedDB and Node/file are
//   the D9 carriers that claim the evaluator; memory and the currently
//   non-durable Expo adapter remain on the refusal floor.
export const RESULT_TRANSFORM_V1_SHIP_GATE = Object.freeze({
  firedOn: '2026-08-04',
  corpus: 'snapback-data-tier.result-transform-v1',
  corpusCases: 56,
  corpusFormatVersion: 1,
  profileVersion: 1,
  transformHash: 'TransformHashV1',
  evaluatorIdentities: Object.freeze({
    javascript: RESULT_TRANSFORM_V1_JAVASCRIPT_EVALUATOR_ID,
    rust: RESULT_TRANSFORM_V1_RUST_EVALUATOR_ID,
  }),
  claimingCarrierContexts: Object.freeze(['browser-indexeddb', 'file-node']),
});

export const RESULT_TRANSFORM_V1_REFUSAL_CODES = Object.freeze({
  PLAN_INVALID: 'SNAPBACK_RESULT_TRANSFORM_PLAN_INVALID',
  STAGE_UNKNOWN: 'SNAPBACK_RESULT_TRANSFORM_STAGE_UNKNOWN',
  COMPARATOR_UNKNOWN: 'SNAPBACK_RESULT_TRANSFORM_COMPARATOR_UNKNOWN',
  NORMALIZATION_UNADMITTED: 'SNAPBACK_RESULT_TRANSFORM_NORMALIZATION_UNADMITTED',
  FIELD_UNPROJECTED: 'SNAPBACK_RESULT_TRANSFORM_FIELD_UNPROJECTED',
  ORDER_FIELD_DUPLICATE: 'SNAPBACK_RESULT_TRANSFORM_ORDER_FIELD_DUPLICATE',
  LIMIT_INVALID: 'SNAPBACK_RESULT_TRANSFORM_LIMIT_INVALID',
  CROSS_ADDRESS: 'SNAPBACK_RESULT_TRANSFORM_CROSS_ADDRESS',
  NON_SCALAR: 'SNAPBACK_RESULT_TRANSFORM_NON_SCALAR',
  BASE_INVALID: 'SNAPBACK_RESULT_TRANSFORM_BASE_INVALID',
  MIXED_VERSION: 'SNAPBACK_RESULT_TRANSFORM_MIXED_VERSION',
  OVERLAY_INPUT_REQUIRED: 'SNAPBACK_RESULT_TRANSFORM_OVERLAY_INPUT_REQUIRED',
});

export function resultTransformCarrierContextV1(carrier) {
  if (carrier?.durable !== true) return null;
  if (carrier.implementation === 'indexeddb') return 'browser-indexeddb';
  if (carrier.implementation === 'file') return 'file-node';
  return null;
}

const PLAN_FIELDS = Object.freeze([
  'format',
  'materializationKey',
  'overlay',
  'filterGrammar',
  'filter',
  'order',
  'limit',
]);
const FILTER_FIELDS = Object.freeze(['field', 'op', 'value']);
const ORDER_FIELDS = Object.freeze(['field', 'direction']);
const FILTER_OPERATORS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in']);
const encoder = new TextEncoder();

function refusal(code, reason, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'result-transform',
    message: `result-transform.v1 refused: ${reason}`,
    details: Object.freeze({ reason, ...details }),
  });
  const error = new TypeError(`${code}: ${diagnostic.message}`);
  error.code = code;
  error.reason = reason;
  error.diagnostic = diagnostic;
  return error;
}

function fail(code, reason, details) {
  throw refusal(code, reason, details);
}

function captureDataRecord(value, kind) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `${kind}-not-record`);
  }
  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `${kind}-inspection-failed`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `${kind}-exotic-prototype`);
  }
  if (keys.some((key) => typeof key !== 'string')) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `${kind}-symbol-field`);
  }
  const entries = [];
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `${kind}-non-data-field`);
    }
    entries.push([key, descriptor.value]);
  }
  return new Map(entries);
}

function requireClosedFields(record, allowed, kind) {
  const allowedSet = new Set(allowed);
  for (const field of record.keys()) {
    if (allowedSet.has(field)) continue;
    if (kind === 'plan' && (field === 'stages' || field === 'pipeline')) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.STAGE_UNKNOWN, 'unknown-stage');
    }
    if (field === 'normalization' || field === 'normalize') {
      fail(
        RESULT_TRANSFORM_V1_REFUSAL_CODES.NORMALIZATION_UNADMITTED,
        'normalization-unadmitted',
      );
    }
    if (kind === 'order-entry' && field === 'comparator') {
      fail(
        RESULT_TRANSFORM_V1_REFUSAL_CODES.COMPARATOR_UNKNOWN,
        'unknown-comparator',
      );
    }
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `unknown-${kind}-field`);
  }
  for (const field of allowed) {
    if (!record.has(field)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, `missing-${kind}-field`);
    }
  }
}

function isCanonicalScalar(value) {
  if (
    value !== null
    && typeof value !== 'boolean'
    && typeof value !== 'number'
    && typeof value !== 'string'
  ) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  try {
    canonicalizeClientValueV1(value);
    return true;
  } catch {
    return false;
  }
}

function parsePlanStructure(plan) {
  const record = captureDataRecord(plan, 'plan');
  requireClosedFields(record, PLAN_FIELDS, 'plan');

  if (record.get('format') !== RESULT_TRANSFORM_V1_FORMAT) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'unknown-format');
  }
  if (typeof record.get('materializationKey') !== 'string') {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'materialization-key-not-string');
  }
  if (record.get('overlay') !== 'apply' && record.get('overlay') !== 'none') {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'unknown-overlay-mode');
  }
  if (record.get('filterGrammar') !== 'basic-v1') {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'unknown-filter-grammar');
  }

  const filterValue = record.get('filter');
  if (!Array.isArray(filterValue)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'filter-not-array');
  }
  const filter = filterValue.map((entry) => {
    const fields = captureDataRecord(entry, 'filter-entry');
    requireClosedFields(fields, FILTER_FIELDS, 'filter-entry');
    const field = fields.get('field');
    const op = fields.get('op');
    const value = fields.get('value');
    if (typeof field !== 'string') {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'filter-field-not-string');
    }
    if (!FILTER_OPERATORS.has(op)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'unknown-filter-operator');
    }
    if (op === 'in' && (!Array.isArray(value) || value.length === 0)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'in-operand-not-nonempty-array');
    }
    return Object.freeze({ field, op, value });
  });

  const orderValue = record.get('order');
  if (!Array.isArray(orderValue)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'order-not-array');
  }
  const orderFields = new Set();
  const order = orderValue.map((entry) => {
    const fields = captureDataRecord(entry, 'order-entry');
    requireClosedFields(fields, ORDER_FIELDS, 'order-entry');
    const field = fields.get('field');
    const direction = fields.get('direction');
    if (typeof field !== 'string') {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'order-field-not-string');
    }
    if (direction !== 'asc' && direction !== 'desc') {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.PLAN_INVALID, 'unknown-order-direction');
    }
    if (orderFields.has(field)) {
      fail(
        RESULT_TRANSFORM_V1_REFUSAL_CODES.ORDER_FIELD_DUPLICATE,
        'duplicate-order-field',
      );
    }
    orderFields.add(field);
    return Object.freeze({ field, direction });
  });

  const limit = record.get('limit');
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.LIMIT_INVALID, 'limit-not-nonnegative-safe-integer');
  }

  return Object.freeze({
    format: record.get('format'),
    materializationKey: record.get('materializationKey'),
    overlay: record.get('overlay'),
    filterGrammar: record.get('filterGrammar'),
    filter: Object.freeze(filter),
    order: Object.freeze(order),
    limit,
    canonicalRecord: plan,
  });
}

function projectedFieldSet(projectedFields) {
  if (!Array.isArray(projectedFields)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'projected-contract-invalid');
  }
  const fields = new Set();
  for (const field of projectedFields) {
    if (typeof field !== 'string' || fields.has(field)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'projected-contract-invalid');
    }
    fields.add(field);
  }
  return fields;
}

export function validateTransformPlanV1(plan, {
  executingMaterializationKey,
  projectedFields,
} = {}) {
  const parsed = parsePlanStructure(plan);
  if (parsed.materializationKey !== executingMaterializationKey) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.CROSS_ADDRESS, 'cross-address-materialization-key');
  }
  const fields = projectedFieldSet(projectedFields);
  for (const clause of parsed.filter) {
    if (!fields.has(clause.field)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.FIELD_UNPROJECTED, 'unprojected-filter-field');
    }
    if (clause.op === 'in') {
      if (clause.value.some((value) => !isCanonicalScalar(value))) {
        fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.NON_SCALAR, 'non-scalar-in-element');
      }
    } else if (!isCanonicalScalar(clause.value)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.NON_SCALAR, 'non-scalar-filter-operand');
    }
  }
  for (const order of parsed.order) {
    if (!fields.has(order.field)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.FIELD_UNPROJECTED, 'unprojected-order-field');
    }
  }
  return parsed;
}

function captureBaseRecord(value, allowed, kind) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `${kind}-not-record`);
  }
  let prototype;
  let keys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `${kind}-inspection-failed`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `${kind}-exotic-prototype`);
  }
  if (keys.some((key) => typeof key !== 'string') || keys.some((key) => !allowed.includes(key))) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `unknown-${kind}-field`);
  }
  if (allowed.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `missing-${kind}-field`);
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, `${kind}-non-data-field`);
    }
  }
  return value;
}

function validateRows(rows, reason) {
  if (!Array.isArray(rows)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, reason);
  }
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'row-not-record');
    }
    try {
      canonicalizeClientValueV1(row);
    } catch {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'row-not-canonical-client-value');
    }
  }
  return [...rows];
}

export function assembleResultTransformBaseV1(base) {
  captureBaseRecord(base, ['shape', 'mode', 'pages'], 'base');
  if (base.shape !== 'row-sequence') {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'non-row-sequence');
  }
  if (base.mode !== 'single-page' && base.mode !== 'complete-page-set') {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'unknown-base-assembly-mode');
  }
  if (!Array.isArray(base.pages) || base.pages.length === 0) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'empty-page-set');
  }
  if (base.mode === 'single-page' && base.pages.length !== 1) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'single-page-count-invalid');
  }

  let version = null;
  const rows = [];
  for (let index = 0; index < base.pages.length; index += 1) {
    const page = captureBaseRecord(base.pages[index], ['version', 'terminal', 'rows'], 'page');
    if (typeof page.version !== 'string' || typeof page.terminal !== 'boolean') {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'page-metadata-invalid');
    }
    if (version === null) version = page.version;
    if (version !== page.version) {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.MIXED_VERSION, 'mixed-version-base');
    }
    if (base.mode === 'complete-page-set') {
      const shouldBeTerminal = index === base.pages.length - 1;
      if (page.terminal !== shouldBeTerminal) {
        fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.BASE_INVALID, 'broken-page-chain');
      }
    }
    rows.push(...validateRows(page.rows, 'page-rows-not-array'));
  }
  return Object.freeze(rows);
}

export function materializeClientOverlayRowsV1(baseRows, overlayLayers) {
  let rows = Object.freeze(validateRows(baseRows, 'base-rows-not-array'));
  if (!Array.isArray(overlayLayers)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.OVERLAY_INPUT_REQUIRED, 'overlay-layers-not-array');
  }
  for (const layer of overlayLayers) {
    if (typeof layer !== 'function') {
      fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.OVERLAY_INPUT_REQUIRED, 'overlay-layer-not-function');
    }
    const next = layer(rows);
    rows = Object.freeze(validateRows(next ?? [], 'overlay-rows-not-array'));
  }
  return rows;
}

function scalarAt(row, field, reason) {
  const value = Object.prototype.hasOwnProperty.call(row, field) ? row[field] : null;
  if (!isCanonicalScalar(value)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.NON_SCALAR, reason);
  }
  return Object.is(value, -0) ? 0 : value;
}

function scalarRank(value) {
  if (value === null) return 0;
  if (typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 2;
  return 3;
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

export function compareResultTransformScalarsV1(left, right) {
  if (!isCanonicalScalar(left) || !isCanonicalScalar(right)) {
    fail(RESULT_TRANSFORM_V1_REFUSAL_CODES.NON_SCALAR, 'comparator-non-scalar');
  }
  const leftRank = scalarRank(left);
  const rightRank = scalarRank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  if (left === null) return 0;
  if (typeof left === 'boolean') return left === right ? 0 : left ? 1 : -1;
  if (typeof left === 'number') {
    const a = Object.is(left, -0) ? 0 : left;
    const b = Object.is(right, -0) ? 0 : right;
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return compareUtf8(left, right);
}

function scalarEqual(left, right) {
  if (scalarRank(left) !== scalarRank(right)) return false;
  return typeof left === 'number' ? left === right : left === right;
}

function filterMatches(value, clause) {
  if (clause.op === 'eq') return scalarEqual(value, clause.value);
  if (clause.op === 'ne') return !scalarEqual(value, clause.value);
  if (clause.op === 'in') return clause.value.some((operand) => scalarEqual(value, operand));
  const order = compareResultTransformScalarsV1(value, clause.value);
  if (clause.op === 'lt') return order < 0;
  if (clause.op === 'lte') return order <= 0;
  if (clause.op === 'gt') return order > 0;
  return order >= 0;
}

function applyFilter(rows, filter) {
  if (filter.length === 0) return rows;
  return rows.filter((row) => {
    let matches = true;
    for (const clause of filter) {
      const value = scalarAt(row, clause.field, 'non-scalar-filter-field');
      if (!filterMatches(value, clause)) matches = false;
    }
    return matches;
  });
}

function applyOrder(rows, order) {
  if (order.length === 0) return rows;
  for (const row of rows) {
    for (const entry of order) scalarAt(row, entry.field, 'non-scalar-order-field');
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      for (const entry of order) {
        const comparison = compareResultTransformScalarsV1(
          scalarAt(left.row, entry.field, 'non-scalar-order-field'),
          scalarAt(right.row, entry.field, 'non-scalar-order-field'),
        );
        if (comparison !== 0) return entry.direction === 'asc' ? comparison : -comparison;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

export function evaluateResultTransformReferenceV1({
  plan,
  executingMaterializationKey,
  projectedFields,
  base,
  clientOverlayRows,
} = {}) {
  const validated = validateTransformPlanV1(plan, {
    executingMaterializationKey,
    projectedFields,
  });
  let rows = [...assembleResultTransformBaseV1(base)];
  if (validated.overlay === 'apply') {
    if (!Array.isArray(clientOverlayRows)) {
      fail(
        RESULT_TRANSFORM_V1_REFUSAL_CODES.OVERLAY_INPUT_REQUIRED,
        'client-overlay-rows-required',
      );
    }
    rows = validateRows(clientOverlayRows, 'overlay-rows-not-array');
  }
  rows = applyFilter(rows, validated.filter);
  rows = applyOrder(rows, validated.order);
  if (validated.limit !== null) rows = rows.slice(0, validated.limit);
  return Object.freeze(rows);
}

export function evaluateResultTransformWithClientLayersV1({
  overlayLayers,
  ...request
} = {}) {
  const parsed = validateTransformPlanV1(request.plan, {
    executingMaterializationKey: request.executingMaterializationKey,
    projectedFields: request.projectedFields,
  });
  if (parsed.overlay !== 'apply') return evaluateResultTransformReferenceV1(request);
  const baseRows = assembleResultTransformBaseV1(request.base);
  const clientOverlayRows = materializeClientOverlayRowsV1(baseRows, overlayLayers);
  return evaluateResultTransformReferenceV1({ ...request, clientOverlayRows });
}

/**
 * The post-gate invocation boundary. `admission` is assembled from the
 * generated owner artifact and the resolved carrier before this function is
 * called; an unadmitted class/carrier reaches the old floor without the
 * transform request being inspected.
 */
export function evaluateAdmittedResultTransformV1(admission, request) {
  const carrierContext = resultTransformCarrierContextV1(admission?.carrier);
  if (
    admission?.retentionClass !== RESULT_TRANSFORM_V1_RETENTION_CLASS
    || carrierContext === null
    || !RESULT_TRANSFORM_V1_SHIP_GATE.claimingCarrierContexts.includes(carrierContext)
  ) {
    return refuseLocalEvaluation(request);
  }
  if (Object.prototype.hasOwnProperty.call(request ?? {}, 'overlayLayers')) {
    return evaluateResultTransformWithClientLayersV1(request);
  }
  return evaluateResultTransformReferenceV1(request);
}

async function sha256Hex(bytes) {
  const nodeCrypto = globalThis.process?.getBuiltinModule?.('node:crypto') ?? null;
  if (nodeCrypto?.createHash) {
    return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
  }
  const subtle = globalThis.crypto?.subtle ?? nodeCrypto?.webcrypto?.subtle;
  if (!subtle) {
    throw new Error('SNAPBACK_RESULT_TRANSFORM_CRYPTO_UNAVAILABLE: SHA-256 is unavailable');
  }
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function transformHashV1(plan) {
  const parsed = parsePlanStructure(plan);
  const canonical = canonicalizeClientValueV1(parsed.canonicalRecord);
  const bytes = encoder.encode(`${RESULT_TRANSFORM_V1_HASH_DOMAIN}${canonical}`);
  return `sha256:${await sha256Hex(bytes)}`;
}
