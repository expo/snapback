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
  'SNAPBACK_SEQUENCE_EXHAUSTED',
  'SNAPBACK_SEQUENCE_UNDECLARED',
  'SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE',
  'SNAPBACK_RELATION_PARENT_UNAVAILABLE',
  'SNAPBACK_UNKNOWN_TABLE',
  'SNAPBACK_UNKNOWN_FIELD',
  'SNAPBACK_QUERY_UNKNOWN_INDEX',
  'SNAPBACK_QUERY_FILTER_BINDINGS_EXCEEDED',
  'SNAPBACK_QUERY_FILTER_VALUE_INVALID',
  'SNAPBACK_QUERY_IN_ITEMS_EXCEEDED',
  'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED',
  'SNAPBACK_QUERY_LIMIT_INVALID',
  'SNAPBACK_BATCH_READ_INPUT_INVALID',
  'SNAPBACK_BATCH_READ_ITEMS_EXCEEDED',
  'SNAPBACK_BATCH_READ_INPUT_BYTES_EXCEEDED',
  'SNAPBACK_BATCH_READ_RESPONSE_BYTES_EXCEEDED',
  'SNAPBACK_BATCH_READ_INDEX_INVALID',
  'SNAPBACK_BATCH_READ_KEY_INVALID',
  'SNAPBACK_BATCH_READ_UNIQUE_INVARIANT_CORRUPT',
  'SNAPBACK_TABLE_VISIBILITY_PLAN_MISMATCH',
  'SNAPBACK_MEMBERSHIP_UNKNOWN_DECLARATION',
  'SNAPBACK_FIELD_ENUM_VALUE_INVALID',
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
  // @ref LLP 0204#d91--streaming-conversations — parity with
  // the embedded handler decoder for server-output stream host refusals.
  'SNAPBACK_STREAM_ATTEMPT_LIMIT_EXCEEDED',
  'SNAPBACK_STREAM_ATTEMPT_NOT_FOUND',
  'SNAPBACK_STREAM_CANCELLED',
  'SNAPBACK_STREAM_CHUNK_INVALID',
  'SNAPBACK_STREAM_CHUNK_TOO_LARGE',
  'SNAPBACK_STREAM_FORBIDDEN',
  'SNAPBACK_STREAM_INITIATOR_REQUIRED',
  'SNAPBACK_STREAM_NOT_DECLARED',
  'SNAPBACK_STREAM_RATE_LIMITED',
  'SNAPBACK_STREAM_RUNNER_FENCED',
  'SNAPBACK_STREAM_TERMINAL',
  'SNAPBACK_ACTION_REPLAY_DIVERGED',
  'SNAPBACK_FUNCTION_KIND_MISMATCH',
  'SNAPBACK_TEST_CRON_ACTION_INTERRUPTED',
  'SNAPBACK_HOST_FETCH_DESTINATION_INVALID',
  'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED',
  'SNAPBACK_HOST_FETCH_REDIRECT_REFUSED',
  'SNAPBACK_HOST_FETCH_RESPONSE_TOO_LARGE',
  'SNAPBACK_HOST_FETCH_RESPONSE_INVALID_UTF8',
  // @ref LLP 0158#the-runtime-plane--where-the-real-design-is — parity with
  // the embedded decoder for fail-loud derived-deployment quarantine.
  'SNAPBACK_FORK_EGRESS_DENIED',
  // A claimed application refusal survives the fold only so the host can
  // admit it against the function's declared set; an undeclared code is
  // dropped there, exactly as in admit_declared_refusal (src/runtime.rs).
  // @ref LLP 0108#declared-application-refusals
  'SNAPBACK_APP_REFUSAL',
]);

export function handlerEnvelopeCode(code) {
  if (code === 'SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') {
    return 'SNAPBACK_HANDLER_CAPABILITY_DENIED';
  }
  if (PASSTHROUGH_CODES.has(code)) return code;
  if (typeof code === 'string' && code.startsWith('SNAPBACK_HANDLER_HOST_CALL_')) return code;
  return 'SNAPBACK_HANDLER_FAILED';
}

function validatedErrorClass(value) {
  return typeof value === 'string'
    && value !== 'unclassified'
    && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/u.test(value)
    ? value
    : 'unclassified';
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
        const code = handlerEnvelopeCode(typeof r.code === 'string' ? r.code : null);
        const decoded = {
          ok: false,
          code,
          // The raw handler claim before the fold — the JS analogue of the
          // claim half of parse_handler_output_with_claim (src/runtime.rs).
          // Untrusted: consumed only by restoreDenialWitness's match below,
          // never serialized to a wire response (failure()/kitFailure/action
          // diagnostics all rebuild from code/message/details).
          claimedCode: typeof r.code === 'string' ? r.code : null,
          message: typeof r.message === 'string' ? r.message : 'JavaScript handler failed',
          failureCarrier: {
            errorClass: validatedErrorClass(r.errorClass),
            message: typeof r.message === 'string' ? r.message : null,
            stack: typeof r.stack === 'string' ? r.stack : null,
            messageExtractionTruncated: r.messageExtractionTruncated === true,
            stackExtractionTruncated: r.stackExtractionTruncated === true,
          },
        };
        // Claims, not facts: the host admits these only against the declared
        // refusal set (LLP 0108).
        if (code === 'SNAPBACK_APP_REFUSAL' && typeof r.appCode === 'string') {
          decoded.appCode = r.appCode;
          decoded.appDetails = r.appDetails === undefined ? null : r.appDetails;
        }
        return decoded;
      }
    }
  }
  return {
    ok: false,
    code: 'SNAPBACK_HANDLER_DID_NOT_SETTLE',
    message: 'handler promise never settled — the invocation produced no result and committed no writes',
  };
}

// Admit the decoder's claimed application refusal against the invoked
// function's manifest declaration. This is host-neutral on purpose: every JS
// serving host must adjudicate the same claim after decode, and a host that
// cannot supply the declaration folds rather than trusting handler bytes.
// @ref LLP 0144#invariants-for-any-extension — I1/I3 require declaration-
//   backed admission on every completion path and generic folding otherwise.
export function admitDeclaredRefusal(declared, result, { functionName = null } = {}) {
  if (!result || result.ok !== false || result.code !== 'SNAPBACK_APP_REFUSAL') {
    return result;
  }
  const declaration = Array.isArray(declared) ? declared : [];
  if (typeof result.appCode !== 'string' || !declaration.includes(result.appCode)) {
    return {
      ok: false,
      code: 'SNAPBACK_HANDLER_FAILED',
      message: 'JavaScript handler failed',
      details: {
        ...(typeof functionName === 'string' ? { function: functionName } : {}),
        message: 'handler raised an undeclared application refusal',
      },
      ...(result.failureCarrier ? { failureCarrier: result.failureCarrier } : {}),
    };
  }
  const admitted = {
    ok: false,
    code: 'SNAPBACK_APP_REFUSAL',
    message: 'application refusal',
    details: {
      ...(typeof functionName === 'string' ? { function: functionName } : {}),
      message: result.message,
      appCode: result.appCode,
      appDetails: result.appDetails === undefined ? null : result.appDetails,
    },
    ...(result.failureCarrier ? { failureCarrier: result.failureCarrier } : {}),
  };
  return admitted;
}

// Surface a host-recorded trusted SNAPBACK_AUTH_PERMISSION_DENIED through the
// action boundary — the JS analogue of restore_denial_witness (src/runtime.rs,
// 0137 a4-f5). The uniform-denial rules (LLP 0053) make the envelope decoder
// fold the claimed denial code to SNAPBACK_HANDLER_FAILED (it is deliberately
// not in PASSTHROUGH_CODES); only when the failing handler's raw claim matches
// a denial the host itself produced during this invocation is the recorded
// trusted failure — with its uniform, non-disclosing bytes — restored. A
// witness whose invocation fails with a DIFFERENT claim is not restored (the
// handler caught the denial and failed on its own terms), and a caught denial
// followed by success stays success: the denied nested mutation committed
// nothing, and this seam is deliberately non-terminalizing. The private
// failureCarrier of the folded failure survives onto the restored result,
// mirroring the private-failure-context transplant on the Rust side.
export function restoreDenialWitness(witness, claimedCode, result) {
  if (!result || result.ok !== false) return result;
  if (claimedCode !== 'SNAPBACK_AUTH_PERMISSION_DENIED') return result;
  if (!witness || witness.ok !== false || witness.code !== 'SNAPBACK_AUTH_PERMISSION_DENIED') {
    return result;
  }
  return result.failureCarrier
    ? { ...witness, failureCarrier: result.failureCarrier }
    : { ...witness };
}
