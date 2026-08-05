import assert from 'node:assert/strict';

import {
  EXIT,
  RESULT_CORE_ARTIFACT_KIND,
  RESULT_CORE_FORMAT_VERSION,
  buildResultCore,
  classifyDiagnosticExit,
  diagnosticRecord,
  resultExitCode,
  wrapCallResult,
} from './result-core.mjs';

// ---------------------------------------------------------------------------
// The frozen exit taxonomy (LLP 0062 §2). This table IS the compatibility
// surface agents script against — a changed number here is a breaking change
// and must fail this test until the taxonomy is formally re-frozen.
// ---------------------------------------------------------------------------
assert.deepEqual(EXIT, {
  OK: 0,
  USAGE: 2,
  AUTH_REFUSED: 3,
  FUNCTION_NOT_FOUND: 4,
  FUNCTION_ERROR: 5,
  TRANSPORT_FAILED: 6,
  ARTIFACT_IDENTITY_MISMATCH: 7,
  VERSION_MISMATCH: 8,
  TIMEOUT: 9,
  SCRIPT_ERROR: 10,
  RESOURCE_EXCEEDED: 11,
});

// Outcome → exit, pinned per class.
const outcomeCase = (outcome, extra = {}) => buildResultCore({
  kind: 'mutation',
  outcome,
  diagnostics: [],
  ...extra,
});
assert.equal(resultExitCode(outcomeCase('ok')), 0);
assert.equal(resultExitCode(outcomeCase('app-refusal', {
  appRefusal: { appCode: 'SEAT_TAKEN' },
})), 5, 'a declared ctx.refuse app refusal is the function-error class');
assert.equal(resultExitCode(outcomeCase('failed')), 5);
assert.equal(resultExitCode(outcomeCase('transport-failed')), 6);
assert.equal(resultExitCode(outcomeCase('timeout')), 9);
assert.equal(resultExitCode(outcomeCase('not-dispatched')), 2);
assert.equal(resultExitCode(outcomeCase('unknown')), 6,
  'a lost write exits by its underlying class (transport default)');
assert.equal(resultExitCode(outcomeCase('unknown', {
  mutation: { clientMutationId: 'cm_1', underlying: 'timeout' },
})), 9, 'a lost write under a timeout exits 9 with outcome unknown');

// Known-code refusals, pinned per family — including the generation-mismatch
// refusal from the call-time binding landing and residue #10's frozen
// envelope-absent sub-cause (exit 7, explicitly not exit 8).
const refusedWith = (record) => resultExitCode(buildResultCore({
  kind: 'query',
  outcome: 'refused',
  diagnostics: [record],
}));
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_USAGE', locus: 'engine' })), 2);
assert.equal(
  refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_SCRIPT_EMPTY', locus: 'engine' })),
  2,
  'stdin EOF without source is a usage refusal, not a script failure',
);
for (const code of [
  'SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID',
  'SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE',
  'SNAPBACK_APP_CLI_HOST_UNSUPPORTED',
]) {
  assert.equal(refusedWith(diagnosticRecord({ code, locus: 'engine' })), 2, `${code} is usage-class`);
}
assert.equal(
  refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_AGENT_ADMISSION_TIMEOUT', locus: 'engine' })),
  9,
  'bounded cross-process admission timeout retains the frozen timeout exit',
);
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_AUTH_REQUIRED', locus: 'request', httpStatus: 401 })), 3,
  'server auth codes are preserved and classify to exit 3, never rewritten');
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_FUNCTION_UNKNOWN', locus: 'engine' })), 4);
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_ARTIFACT_IDENTITY_MISMATCH', locus: 'request', httpStatus: 409 })), 7,
  'the call-time generation-mismatch refusal is the identity class');
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_ENVELOPE_ABSENT', locus: 'engine' })), 7,
  'residue #10: envelope-less sessions redeploy-required is exit 7, not 8');
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_VERSION_MISMATCH', locus: 'engine' })), 8);
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_TIMEOUT', locus: 'engine' })), 9);
assert.equal(refusedWith(diagnosticRecord({ code: 'SNAPBACK_APP_CLI_HTTP_FAILED', locus: 'request', httpStatus: 502 })), 6);

// ---------------------------------------------------------------------------
// Residue #8 — the frozen unknown-code fallback by wire locus / result kind.
// The code is preserved verbatim, marked unrecognized, and NEVER maps to
// exit 8 merely because it is new.
// ---------------------------------------------------------------------------
const unknown = (locus, httpStatus = undefined) => diagnosticRecord({
  code: 'SNAPBACK_FUTURE_CODE_UNSEEN',
  locus,
  httpStatus,
});
assert.equal(unknown('request').unrecognized, true);
assert.equal(unknown('request').code, 'SNAPBACK_FUTURE_CODE_UNSEEN', 'preserved verbatim');
assert.equal(classifyDiagnosticExit(unknown('request', 401)), 3, 'auth-locus non-2xx');
assert.equal(classifyDiagnosticExit(unknown('request', 403)), 3);
assert.equal(classifyDiagnosticExit(unknown('request', 422)), 5, 'ordinary non-2xx');
assert.equal(classifyDiagnosticExit(unknown('request', 500)), 6, '5xx is transport-class');
assert.equal(classifyDiagnosticExit(unknown('result')), 5, 'HTTP-200 ok:false');
assert.equal(classifyDiagnosticExit(unknown('live')), 5, 'live terminal, non-auth');
assert.equal(classifyDiagnosticExit(
  diagnosticRecord({ code: 'SNAPBACK_AUTH_FUTURE_UNSEEN', locus: 'live' }),
), 3, 'live terminal, auth-family unknown code');
assert.equal(classifyDiagnosticExit(unknown('broker')), 5, 'caught broker refusal class');
for (const locus of ['request', 'result', 'live', 'broker', 'engine']) {
  assert.notEqual(classifyDiagnosticExit(unknown(locus)), 8,
    `unknown code at locus ${locus} must never fall back to exit 8`);
}
// An unrecognized-but-auth-family code is not marked unrecognized-hostile:
assert.equal(
  diagnosticRecord({ code: 'SNAPBACK_AUTH_FUTURE_UNSEEN', locus: 'live' }).unrecognized,
  undefined,
  'family-recognized codes are not marked unrecognized',
);

// ---------------------------------------------------------------------------
// JSON stability + cross-language parity anchor. This literal is duplicated
// byte-for-byte in src/app_data_result.rs (ENGINE_REPRESENTATIVE) — the Rust
// authority admits exactly this document under deny_unknown_fields. Change
// them together or not at all.
// ---------------------------------------------------------------------------
const representative = buildResultCore({
  kind: 'mutation',
  outcome: 'ok',
  value: { id: 'todo_1' },
  facts: { changedCount: 1 },
  diagnostics: [],
  attribution: { actorUserId: 'u_1', effectiveUserId: 'u_1', grantId: null, dryRun: false },
  mutation: { clientMutationId: 'cm_018f' },
});
assert.equal(
  JSON.stringify(representative),
  JSON.stringify({
    artifactKind: RESULT_CORE_ARTIFACT_KIND,
    formatVersion: RESULT_CORE_FORMAT_VERSION,
    kind: 'mutation',
    outcome: 'ok',
    value: { id: 'todo_1' },
    facts: { changedCount: 1 },
    diagnostics: [],
    attribution: { actorUserId: 'u_1', effectiveUserId: 'u_1', grantId: null, dryRun: false },
    mutation: { clientMutationId: 'cm_018f' },
  }),
  'core serialization is stable, field-ordered, and matches the Rust anchor',
);

// Attribution retention: the block rides by reference, byte-identical — the
// core never reshapes or synthesizes it (LLP 0055 §Audit).
const serverBlock = Object.freeze({
  actorUserId: 'u_actor',
  effectiveUserId: 'u_effective',
  grantId: 'grant_1',
  dryRun: false,
});
const refusal = buildResultCore({
  kind: 'action',
  outcome: 'refused',
  diagnostics: [diagnosticRecord({ code: 'SNAPBACK_AUTH_REQUIRED', locus: 'request', httpStatus: 401 })],
  attribution: serverBlock,
});
assert.equal(refusal.attribution, serverBlock, 'verbatim by reference');
assert.equal(resultExitCode(refusal), 3, 'attribution retention does not change classification');

// ---------------------------------------------------------------------------
// Wrapper: appCliCallResult embeds the core VERBATIM and adds only
// presentation fields; envelope identity is absent — not null — on dev.
// ---------------------------------------------------------------------------
const wrapped = wrapCallResult(representative, {
  engine: { name: '@expo/snapback-app-cli', version: '0.1.0' },
});
assert.equal(wrapped.core, representative, 'the core is embedded by reference, never rebuilt');
assert.ok(
  JSON.stringify(wrapped).includes(JSON.stringify(representative)),
  'the serialized wrapper carries the serialized core byte-identically',
);
assert.ok(!('envelope' in wrapped), 'dev targets: envelope identity absent, not null');
const wrappedSessions = wrapCallResult(representative, {
  engine: { name: '@expo/snapback-app-cli', version: '0.1.0' },
  envelope: { envelopeDigest: 'a'.repeat(64), inputsHash: 'ih_1' },
});
assert.equal(wrappedSessions.envelope.inputsHash, 'ih_1');

console.log('result-core.test.mjs passed');
