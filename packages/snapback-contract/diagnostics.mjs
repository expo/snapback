// Snapback -> Contract provider diagnostic handoff.
//
// Exact owns the final `contract-diagnostic.v1` envelope and its CLI/LSP/Agent
// projections. Snapback owns the provider facts which feed that envelope. This
// module deliberately emits Exact's DataProviderDiagnostic-compatible input
// shape instead of claiming that a provider error is already a final envelope.
//
// @ref LLP 0012#diagnostic-schema — adapters hand the same stable diagnostic
//   facts to every consuming surface.
// @ref LLP 0063#workstream-5--structural-mutation-outcomes-and-excellent-diagnostics —
//   provider failures retain source attribution and repeated reactive failures
//   collapse to one root/instance/cause report.

const PROVIDER_OWNERS = new Set([
  'contract',
  'provider',
  'vite',
  'schema',
  'handler',
  'generated',
]);

const SEVERITIES = new Set(['error', 'warning', 'info']);

function normalizeSource(source) {
  if (!source || typeof source !== 'object') return undefined;
  const normalized = {
    ...(typeof source.file === 'string' ? { file: source.file } : {}),
    ...(Number.isInteger(source.line) && source.line > 0 ? { line: source.line } : {}),
    ...(Number.isInteger(source.column) && source.column > 0 ? { column: source.column } : {}),
    ...(typeof source.generatedFrom === 'string'
      ? { generatedFrom: source.generatedFrom }
      : {}),
  };
  return Object.keys(normalized).length > 0 ? Object.freeze(normalized) : undefined;
}

/**
 * Build the raw provider handoff consumed by Exact's diagnostic-envelope
 * converter and preserved by React/vanilla serialized errors.
 */
export function createSnapbackProviderDiagnostic(code, message, {
  severity = 'error',
  provider = 'snapback',
  owner = 'provider',
  source = undefined,
  queryName = undefined,
  mutationName = undefined,
  table = undefined,
  suggestedFix = undefined,
  targetSurface = 'Contract/Exact',
  details = {},
} = {}) {
  if (typeof code !== 'string' || code.length === 0) {
    throw new TypeError('Snapback provider diagnostics require a stable code.');
  }
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('Snapback provider diagnostics require a message.');
  }
  if (!SEVERITIES.has(severity)) {
    throw new TypeError(`Unsupported Snapback provider diagnostic severity: ${severity}`);
  }
  if (!PROVIDER_OWNERS.has(owner)) {
    throw new TypeError(`Unsupported Snapback provider diagnostic owner: ${owner}`);
  }

  const normalizedSource = normalizeSource(source);
  return Object.freeze({
    code,
    severity,
    subsystem: 'contract-integration',
    message,
    provider,
    owner,
    ...(normalizedSource ? { source: normalizedSource } : {}),
    ...(typeof queryName === 'string' ? { queryName } : {}),
    ...(typeof mutationName === 'string' ? { mutationName } : {}),
    ...(typeof table === 'string' ? { table } : {}),
    ...(typeof suggestedFix === 'string' ? { suggestedFix } : {}),
    details: Object.freeze({
      target_surface: targetSurface,
      ...details,
    }),
  });
}

export function createSnapbackProviderDiagnosticError(code, message, options = {}) {
  const diagnostic = createSnapbackProviderDiagnostic(code, message, options);
  const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  // Exact's query-scope refusal path reads the thrown error's source directly.
  // Keep it beside the full diagnostic so both async cells retain the locus.
  if (diagnostic.source) error.source = diagnostic.source;
  return error;
}

function diagnosticSubject(diagnostic) {
  return diagnostic.queryName
    ?? diagnostic.mutationName
    ?? diagnostic.table
    ?? '(provider)';
}

function diagnosticFrom(value) {
  if (value?.diagnostic && typeof value.diagnostic === 'object') return value.diagnostic;
  if (value && typeof value === 'object' && typeof value.code === 'string') return value;
  return null;
}

/**
 * One report per (root, binding/action instance, cause). Repeated reactive
 * deliveries increment `occurrences` on that report instead of appending one
 * diagnostic per tick.
 */
export function createSnapbackProviderDiagnosticCollector({
  rootId = '(unbound-root)',
} = {}) {
  const diagnostics = [];
  const byIdentity = new Map();

  return Object.freeze({
    record(value, {
      instanceId = undefined,
      causeCode = undefined,
    } = {}) {
      const diagnostic = diagnosticFrom(value);
      if (!diagnostic) return null;
      const subject = diagnosticSubject(diagnostic);
      const effectiveInstance = instanceId ?? subject;
      const effectiveCause = causeCode ?? diagnostic.code;
      const dedupeKey = JSON.stringify([
        rootId,
        effectiveInstance,
        effectiveCause,
      ]);
      const existing = byIdentity.get(dedupeKey);
      if (existing) {
        existing.occurrences += 1;
        if (!existing.source && diagnostic.source) existing.source = diagnostic.source;
        return existing;
      }
      const report = {
        ...diagnostic,
        occurrences: 1,
        diagnosticInstanceId: effectiveInstance,
        diagnosticCauseCode: effectiveCause,
        diagnosticDedupeKey: dedupeKey,
      };
      byIdentity.set(dedupeKey, report);
      diagnostics.push(report);
      return report;
    },
    diagnostics() {
      return diagnostics;
    },
    reset() {
      diagnostics.length = 0;
      byIdentity.clear();
    },
  });
}
