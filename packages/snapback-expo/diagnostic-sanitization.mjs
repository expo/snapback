const SAFE_DIAGNOSTIC_CODE = /^SNAPBACK_[A-Z0-9_]+$/u;
const SAFE_CAUSE_CODE = /^(?:ERR|SNAPBACK)_[A-Z0-9_]+$/u;
const SAFE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const SECRET_BEARING_TEXT = /(?:\bBearer\s+\S+|sbs_[A-Za-z0-9._~-]+|sbrv1_[A-Za-z0-9._~-]+)/iu;
const UNSAFE_FACT_KEY = /(?:bearer|credential|password|recovery|secret|token)/iu;

const SAFE_DETAIL_KEYS = new Set([
  'allowedClockSkewMs',
  'cause',
  'causeCode',
  'correlationId',
  'currentPrincipalStatus',
  'expectedFormat',
  'expectedSupervisorGeneration',
  'missingCapabilities',
  'observedFormat',
  'observedSupervisorGeneration',
  'phase',
  'platform',
  'principalStatus',
  'requiredCapability',
  'requiredGrade',
  'seam',
  'source',
  'status',
]);

const SAFE_PRECONDITION_KEYS = new Set([
  'bindingSource',
  'cause',
  'causeCode',
  'code',
  'expectedFormat',
  'platform',
  'principalStatus',
  'requiredCapability',
  'requiredGrade',
  'status',
]);

const safeString = (value, { code = false, identifier = false } = {}) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 512
  && !SECRET_BEARING_TEXT.test(value)
  && (!code || SAFE_DIAGNOSTIC_CODE.test(value))
  && (!identifier || SAFE_IDENTIFIER.test(value))
);

function sanitizeValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (safeString(value)) return value;
  if (depth >= 2) return undefined;
  if (Array.isArray(value)) {
    return Object.freeze(value.slice(0, 32).map(
      (entry) => sanitizeValue(entry, depth + 1),
    ).filter((entry) => entry !== undefined));
  }
  if (value === null || typeof value !== 'object') return undefined;
  const entries = [];
  for (const [key, fact] of Object.entries(value)) {
    if (UNSAFE_FACT_KEY.test(key) || !SAFE_DETAIL_KEYS.has(key)) continue;
    const safe = sanitizeValue(fact, depth + 1);
    if (safe !== undefined) entries.push([key, safe]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function sanitizeNamedFacts(value, allowedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return Object.freeze({});
  }
  const entries = [];
  for (const [key, fact] of Object.entries(value)) {
    if (UNSAFE_FACT_KEY.test(key) || !allowedKeys.has(key)) continue;
    if (key === 'code' && !safeString(fact, { code: true })) continue;
    if (
      key === 'causeCode'
      && !(safeString(fact) && SAFE_CAUSE_CODE.test(fact))
    ) continue;
    const safe = sanitizeValue(fact);
    if (safe !== undefined) entries.push([key, safe]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function sanitizePublicDiagnostic(value, {
  fallbackCode = 'SNAPBACK_EXPO_BOOT_FAILED',
  fallbackMessage = 'The Expo environment reported a diagnostic.',
  correlationId = null,
} = {}) {
  const code = safeString(value?.code, { code: true }) ? value.code : fallbackCode;
  const message = safeString(value?.message) ? value.message : fallbackMessage;
  const details = sanitizeNamedFacts(value?.details, SAFE_DETAIL_KEYS);
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: ['error', 'warning', 'info'].includes(value?.severity) ? value.severity : 'error',
    message,
    details: Object.freeze({
      ...details,
      ...(safeString(correlationId) ? { correlationId } : {}),
    }),
  });
}

export function sanitizePublicRemediations(values) {
  if (!Array.isArray(values)) return Object.freeze([]);
  const projected = [];
  for (const value of values.slice(0, 16)) {
    if (
      value === null
      || typeof value !== 'object'
      || Array.isArray(value)
      || !safeString(value.kind, { identifier: true })
      || !safeString(value.riskClass, { identifier: true })
      || typeof value.machineApplicable !== 'boolean'
      || typeof value.requiresApproval !== 'boolean'
      || !safeString(value.authorityEffect, { identifier: true })
      || !safeString(value.description)
    ) continue;
    projected.push(Object.freeze({
      kind: value.kind,
      riskClass: value.riskClass,
      machineApplicable: value.machineApplicable,
      requiresApproval: value.requiresApproval,
      authorityEffect: value.authorityEffect,
      precondition: sanitizeNamedFacts(value.precondition, SAFE_PRECONDITION_KEYS),
      description: value.description,
    }));
  }
  return Object.freeze(projected);
}
