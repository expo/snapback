// Full committed-Diagnostic composition for the hosted arm's kit routes.
//
// `error.response.schema.json` governs every non-2xx JSON failure on the
// LLP 0094 §0A.1 kit routes — gateway lane, parse lane, platform lane, and
// handler lane alike — and its inner `Diagnostic` requires
// `code`/`severity`/`subsystem`/`message`/`details`. The hosted arm
// historically under-filled that object (LLP 0094 §0C.6 items 3 and 7-9);
// every kit-lane emitter now composes it through this helper.
//
// Subsystem classification mirrors the local arm's vocabulary
// (`crates/snapback/src/diagnostic.rs` call sites: "realtime" for the connection/live
// surface, "server" for request-shape refusals, "storage" for persistence
// limits, "auth" for credential failures, "runtime" for handler/invocation
// failures). Classification is by stable code family so a shared code never
// reports different subsystems across the two arms.
//
// @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — served divergences are defects, not contract; the
//   decided direction is to converge the emitters to the committed schemas.

export const ERROR_RESPONSE_FORMAT_VERSION = 'snapback.error-response.v1';

// The format version is must-understand; members added to a known version are
// forward-compatible and receivers ignore ones they do not recognize. This is
// deliberately only the ErrorResponse carrier. LLP 0146's ruled remediation
// set is nested in Diagnostic.details and therefore does not change this
// outer version.
// @ref LLP 0094#0c7-errorresponse-format-version-and-forward-skew-2026-08-08
export function wireErrorResponse(diagnostic, members = {}) {
  return {
    formatVersion: ERROR_RESPONSE_FORMAT_VERSION,
    diagnostic,
    ...members,
  };
}

const SUBSYSTEM_RULES = [
  // Connection grants, live subscriptions, sockets, and the bundle/RQS
  // surface: the local arm reports these as "realtime".
  {
    test: /^SNAPBACK_(CONNECTION|LIVE|SUBSCRIPTION|BUNDLE|UPGRADE|ACCEPTED_SOCKET|LEGACY_PROOF_SOCKET|RESUME)_/,
    subsystem: 'realtime',
  },
  // Request-shape refusals (parse lane, method/route refusals): "server",
  // matching the local arm's SNAPBACK_REQUEST_JSON_INVALID subsystem.
  {
    test: /^SNAPBACK_(REQUEST|CONTENT_TYPE|UTF8|JSON|METHOD|ROUTE)_/,
    subsystem: 'server',
  },
  // Persistence limits and stale persisted state: "storage".
  {
    test: /^SNAPBACK_(VALUE_TOO_LARGE$|SQLITE_|STALE_CLOUDFLARE_|RESET_)/,
    subsystem: 'storage',
  },
  { test: /^SNAPBACK_AUTH_/, subsystem: 'auth' },
];

// Compose one fully-filled committed Diagnostic. `details` is always
// present — `{}` when the emitter has none, matching the local
// `Diagnostic::error` default (`crates/snapback/src/diagnostic.rs`).
export function wireDiagnostic(code, message, details = null) {
  const rule = SUBSYSTEM_RULES.find((candidate) => candidate.test.test(code));
  return {
    code,
    severity: 'error',
    // Handler/invocation failures (SNAPBACK_HANDLER_*, SNAPBACK_QUERY_*,
    // kind mismatches, capability admission) default to "runtime".
    subsystem: rule ? rule.subsystem : 'runtime',
    message,
    details: details ?? {},
  };
}
