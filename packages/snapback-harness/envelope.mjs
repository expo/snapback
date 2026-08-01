// Single-sourced handler-envelope decode and error-code taxonomy for JS
// hosts (ENG-23586). This is the JS analogue of `parse_handler_output` +
// `handler_envelope_code` in src/runtime.rs: the Cloudflare coordinator (the
// only JS host today) decodes the tagged completion envelope through this one
// module so the same handler failure surfaces the same public code on every
// target. Both decoders fail closed with SNAPBACK_HANDLER_DID_NOT_SETTLE for
// a `{"r": ...}` envelope whose `r` carries no boolean `__snapbackOk`: only
// the settle wrapper constructs the tag, and only after the awaited handler
// value exists, so an untagged `r` proves nothing about settlement
// (ENG-23430, aligned in ENG-23603).

// Mirrors handler_envelope_code (src/runtime.rs): internal denial codes map
// to their public names, a known allowlist passes through, host-call codes
// pass through, and anything else — including handler-invented codes — folds
// to SNAPBACK_HANDLER_FAILED.
const PASSTHROUGH_CODES = new Set([
  'SNAPBACK_HANDLER_WRITE_IN_QUERY',
  'SNAPBACK_HANDLER_EXPORT_MISSING',
  'SNAPBACK_HANDLER_RESULT_INVALID',
  'SNAPBACK_HANDLER_STALE_CONTINUATION',
  'SNAPBACK_CONFIG_UNDECLARED',
  'SNAPBACK_CONFIG_MISSING',
  'SNAPBACK_AUTH_REQUIRED',
  'SNAPBACK_ACTION_CONTEXT_UNAVAILABLE',
  'SNAPBACK_OVERLOADED',
  'SNAPBACK_VALUE_TOO_LARGE',
  'SNAPBACK_UNKNOWN_TABLE',
  'SNAPBACK_UNKNOWN_FIELD',
  'SNAPBACK_QUERY_UNKNOWN_INDEX',
  'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
  'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
  'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
  'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED',
  'SNAPBACK_QUERY_LIMIT_INVALID',
  'SNAPBACK_FIELD_MISSING',
  'SNAPBACK_FIELD_TYPE_MISMATCH',
  'SNAPBACK_SYSTEM_FIELD_WRITE',
  'SNAPBACK_ACTION_TIMEOUT',
  // @ref LLP 0076#diagnostics — every promised stream refusal family must
  // survive the handler envelope with its exact code.
  'SNAPBACK_ACTION_STREAM_CANCELLED',
  'SNAPBACK_ACTION_STREAM_IDLE_TIMEOUT',
  'SNAPBACK_ACTION_STREAM_INVALID',
  'SNAPBACK_ACTION_STREAM_LIMIT_EXCEEDED',
  'SNAPBACK_ACTION_STREAM_TIMEOUT',
  'SNAPBACK_ACTION_STREAM_UNSUPPORTED',
  'SNAPBACK_ACTION_STREAM_UPSTREAM_AMBIGUOUS',
  'SNAPBACK_ACTION_STREAM_UPSTREAM_FAILED',
  'SNAPBACK_ACTION_PROGRESS_RATE_EXCEEDED',
  'SNAPBACK_ACTION_REPLAY_DIVERGED',
  'SNAPBACK_FUNCTION_KIND_MISMATCH',
  'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED',
  'SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE',
  'SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8',
]);

export function handlerEnvelopeCode(code) {
  if (code === 'SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') {
    return 'SNAPBACK_HANDLER_CAPABILITY_DENIED';
  }
  if (PASSTHROUGH_CODES.has(code)) return code;
  if (typeof code === 'string' && code.startsWith('SNAPBACK_HANDLER_HOST_CALL_')) return code;
  return 'SNAPBACK_HANDLER_FAILED';
}

// Decode the settle wrapper's tagged completion envelope. Returns
// { ok:true, value } or { ok:false, code, message }.
export function parseHandlerEnvelope(envelope) {
  let parsed;
  try {
    parsed = JSON.parse(envelope);
  } catch (_) {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1) {
    const r = parsed.r;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      if (r.__snapbackOk === true) {
        return { ok: true, value: r.value === undefined ? null : r.value };
      }
      if (r.__snapbackOk === false) {
        return {
          ok: false,
          code: handlerEnvelopeCode(typeof r.code === 'string' ? r.code : null),
          message: typeof r.message === 'string' ? r.message : 'JavaScript handler failed',
        };
      }
    }
  }
  return {
    ok: false,
    code: 'SNAPBACK_HANDLER_DID_NOT_SETTLE',
    message: 'handler promise never settled — the invocation produced no result and committed no writes',
  };
}
