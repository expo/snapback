// Stable Cloudflare platform-limit taxonomy for the gateway and coordinator.
//
// Cloudflare can reject a request before an ordinary Snapback handler result
// exists (Durable Object SQLite value limits, service-binding request-chain
// depth, or Durable Object overload). Keep those failures out of the generic
// handler-failed bucket so clients can distinguish permanent input failures
// from transient pressure and apply backoff only to the latter (ENG-23849).

import { wireDiagnostic, wireErrorResponse } from './wire-diagnostic.js';

export const DEFAULT_MAX_PENDING_INVOCATIONS = 16;
const SERVICE_BINDING_INVOCATION_LIMIT = 32;
const SUBREQUEST_DEPTH_MESSAGE = /subrequest depth limit exceeded/i;
const SQLITE_VALUE_LIMIT_MESSAGE = /SQLITE_TOOBIG|string or blob too big|maximum size of (?:a )?string or BLOB/i;

export function valueTooLargeFailure({ limitBytes, actualBytes = null, table = null } = {}) {
  const details = {
    platform: 'cloudflare-durable-object-sqlite',
    reason: 'maximum_row_bytes',
    limitBytes,
    retryable: false,
  };
  if (Number.isFinite(actualBytes)) details.actualBytes = actualBytes;
  if (typeof table === 'string' && table.length > 0) details.table = table;
  return {
    ok: false,
    code: 'SNAPBACK_VALUE_TOO_LARGE',
    message: 'the serialized row exceeds the Cloudflare Durable Object SQLite value limit',
    details,
  };
}

export function overloadedFailure({ reason, pendingInvocations = null, maxPendingInvocations = null } = {}) {
  const details = {
    platform: 'cloudflare-workers',
    reason: reason || 'durable_object_overloaded',
    serviceBindingInvocationLimit: SERVICE_BINDING_INVOCATION_LIMIT,
    retryable: true,
    overloaded: true,
    backoff: true,
  };
  if (Number.isFinite(pendingInvocations)) details.pendingInvocations = pendingInvocations;
  if (Number.isFinite(maxPendingInvocations)) details.maxPendingInvocations = maxPendingInvocations;
  return {
    ok: false,
    code: 'SNAPBACK_OVERLOADED',
    message: 'the Cloudflare coordinator is temporarily overloaded; retry with backoff',
    details,
  };
}

export function platformFailureError(failure) {
  const error = new Error(`${failure.code}: ${failure.message}`);
  error.name = 'SnapbackPlatformError';
  error.snapbackFailure = failure;
  return error;
}

// Classify both Snapback's deliberate admission/size errors and platform
// exceptions. Unknown exceptions deliberately return null: this boundary is
// not a generic error-swallowing layer.
export function classifyPlatformError(error, { maxRowBytes } = {}) {
  if (error && error.snapbackFailure) return error.snapbackFailure;
  const message = String((error && error.message) || error || '');
  if (SUBREQUEST_DEPTH_MESSAGE.test(message)) {
    return overloadedFailure({ reason: 'service_binding_subrequest_depth' });
  }
  if (error && error.overloaded === true) {
    return overloadedFailure({ reason: 'durable_object_overloaded' });
  }
  if (SQLITE_VALUE_LIMIT_MESSAGE.test(message)) {
    return valueTooLargeFailure({ limitBytes: maxRowBytes });
  }
  return null;
}

// A service-binding depth exception can surface inside the stripped handler
// isolate's host-call round trip. The handler envelope intentionally carries
// only code/message, so reconstruct the stable overload details here.
export function classifyHandlerPlatformFailure(result, { maxRowBytes } = {}) {
  if (!result || result.ok !== false) return result;
  const message = String(result.message || '');
  if (SUBREQUEST_DEPTH_MESSAGE.test(message)) {
    return preservePrivateFailureCarrier(
      result,
      overloadedFailure({ reason: 'service_binding_subrequest_depth' }),
    );
  }
  if (result.code === 'SNAPBACK_OVERLOADED') {
    return preservePrivateFailureCarrier(
      result,
      overloadedFailure({ reason: 'handler_transport_overload' }),
    );
  }
  if (result.code === 'SNAPBACK_VALUE_TOO_LARGE') {
    return preservePrivateFailureCarrier(
      result,
      valueTooLargeFailure({ limitBytes: maxRowBytes }),
    );
  }
  return result;
}

function preservePrivateFailureCarrier(source, replacement) {
  return source.failureCarrier
    ? { ...replacement, failureCarrier: source.failureCarrier }
    : replacement;
}

export function platformFailureResponse(path, failure) {
  const headers = { 'content-type': 'application/json' };
  if (failure.code === 'SNAPBACK_OVERLOADED') headers['retry-after'] = '1';

  // LLP 0040's proof protocol and the internal host-call protocol encode
  // failures in a 200 JSON result. Kit routes use the local server's ApiError
  // envelope and meaningful HTTP status.
  if (path === '/query' || path === '/mutation' || path === '/_snapback/host-call') {
    return new Response(JSON.stringify(failure), { status: 200, headers });
  }
  const status = failure.code === 'SNAPBACK_VALUE_TOO_LARGE' ? 413 : 503;
  // @ref LLP 0094#0c6-response-shape-divergences-audited-at-137dee8c-defects-not-contract — item 9: the kit-route branch fills the committed
  //   Diagnostic completely; details is never dropped when undefined.
  const diagnostic = wireDiagnostic(failure.code, failure.message, failure.details ?? null);
  return new Response(JSON.stringify(wireErrorResponse(diagnostic)), { status, headers });
}
