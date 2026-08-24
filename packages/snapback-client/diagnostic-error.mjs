// One public exception carrier for immediate Snapback refusals.
//
// @ref LLP 0247#d4-one-public-typed-refusal-exception — primary one-shot
// client verbs expose the same stable diagnostic, retry, and effect facts.

const objectDiagnostic = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const APP_CODE = /^(?!SNAPBACK_)[A-Z0-9_]{1,64}$/u;

/**
 * Project the declared application refusal carried by either a public
 * Snapback error or a raw diagnostic. This is deliberately an observation
 * helper, not an admission authority: the serving host has already checked
 * the appCode against the invoked function's declaration.
 *
 * @ref LLP 0144#axis-d--generation-and-client-typing-cv-16 — Explicit and
 * Familiar clients narrow the one namespaced diagnostic shape instead of
 * reaching through transport-specific error fields.
 */
export function projectAppRefusal(error) {
  const diagnostic = objectDiagnostic(error?.diagnostic)
    ? error.diagnostic
    : objectDiagnostic(error)
      ? error
      : null;
  if (diagnostic?.code !== 'SNAPBACK_APP_REFUSAL') return null;
  const details = diagnostic.details;
  if (
    !objectDiagnostic(details)
    || typeof details.appCode !== 'string'
    || !APP_CODE.test(details.appCode)
  ) return null;
  const detailsDropped = details.appDetailsDropped === true;
  return Object.freeze({
    code: 'SNAPBACK_APP_REFUSAL',
    appCode: details.appCode,
    appDetails: detailsDropped ? null : (details.appDetails ?? null),
    detailsDropped,
  });
}

const diagnosticFor = (error, fallbackCode = 'SNAPBACK_CLIENT_REFUSED') => {
  if (objectDiagnostic(error?.diagnostic) && typeof error.diagnostic.code === 'string') {
    return error.diagnostic;
  }
  const code = typeof error?.code === 'string' && error.code.length > 0
    ? error.code
    : fallbackCode;
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client',
    message: error?.message ?? String(error ?? code),
    details: Object.freeze({}),
  });
};

export class SnapbackDiagnosticError extends Error {
  constructor(diagnostic, {
    message = diagnostic?.message,
    operation = null,
    refKind = null,
    retryable = diagnostic?.details?.retryable ?? null,
    retryStrategy = diagnostic?.details?.retryStrategy ?? null,
    effectCommitted = diagnostic?.details?.effectCommitted ?? null,
    effectMayHaveCommitted = null,
    cause = undefined,
    status = undefined,
  } = {}) {
    if (!objectDiagnostic(diagnostic) || typeof diagnostic.code !== 'string') {
      throw new TypeError('SnapbackDiagnosticError requires a diagnostic with a stable code');
    }
    super(`${diagnostic.code}: ${message ?? ''}`, cause === undefined ? {} : { cause });
    this.name = 'SnapbackDiagnosticError';
    this.code = diagnostic.code;
    this.diagnostic = diagnostic;
    this.operation = operation;
    this.refKind = refKind;
    this.retryable = typeof retryable === 'boolean' ? retryable : null;
    this.retryStrategy = typeof retryStrategy === 'string' ? retryStrategy : null;
    this.effectCommitted = typeof effectCommitted === 'boolean' ? effectCommitted : null;
    this.effectMayHaveCommitted = typeof effectMayHaveCommitted === 'boolean'
      ? effectMayHaveCommitted
      : null;
    if (status !== undefined) this.status = status;
  }
}

export function isSnapbackDiagnosticError(value) {
  return value instanceof SnapbackDiagnosticError;
}

export function asSnapbackDiagnosticError(error, facts = {}) {
  if (isSnapbackDiagnosticError(error)) {
    if (facts.operation !== undefined && error.operation === null) error.operation = facts.operation;
    if (facts.refKind !== undefined && error.refKind === null) error.refKind = facts.refKind;
    if (typeof facts.retryable === 'boolean' && error.retryable === null) {
      error.retryable = facts.retryable;
    }
    if (typeof facts.retryStrategy === 'string' && error.retryStrategy === null) {
      error.retryStrategy = facts.retryStrategy;
    }
    if (typeof facts.effectCommitted === 'boolean' && error.effectCommitted === null) {
      error.effectCommitted = facts.effectCommitted;
    }
    if (
      typeof facts.effectMayHaveCommitted === 'boolean'
      && error.effectMayHaveCommitted === null
    ) {
      error.effectMayHaveCommitted = facts.effectMayHaveCommitted;
    }
    return error;
  }
  const diagnostic = diagnosticFor(error, facts.fallbackCode);
  const wrapped = new SnapbackDiagnosticError(diagnostic, {
    ...facts,
    cause: facts.cause ?? error,
    status: facts.status ?? error?.status,
    retryable: facts.retryable ?? error?.retryable ?? null,
    retryStrategy: facts.retryStrategy ?? error?.retryStrategy ?? null,
    effectCommitted: facts.effectCommitted ?? error?.effectCommitted ?? null,
    effectMayHaveCommitted: facts.effectMayHaveCommitted
      ?? error?.effectMayHaveCommitted
      ?? null,
  });
  for (const field of [
    'receipt',
    'attribution',
    'authorityDisposition',
    'clientMutationId',
    'outboxSettlementPersistenceFailure',
    'fetchDispatchFailed',
    'reason',
    'outcome',
  ]) {
    if (error?.[field] !== undefined) wrapped[field] = error[field];
  }
  return wrapped;
}

export function snapbackDiagnosticError(code, message, details = {}, facts = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client',
    message,
    details: Object.freeze({ ...details }),
  });
  return new SnapbackDiagnosticError(diagnostic, { ...facts, message });
}
