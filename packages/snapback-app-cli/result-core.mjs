// The shared app-data result core, engine side (LLP 0024 amendment; LLP 0062 §2).
//
// The core's SHAPE is Rust-owned (schemas/app-data.result-core.schema.json);
// this module constructs conforming documents and applies the frozen exit
// taxonomy. Projections (CLI text/JSON, MCP) consume these functions and
// never re-derive outcome semantics. `appCliCallResult` is a presentation
// wrapper AROUND the core — it embeds the core verbatim and adds only
// engine identity and the active envelope identity (absent on dev targets).

export const RESULT_CORE_ARTIFACT_KIND = 'appDataResultCore';
export const RESULT_CORE_FORMAT_VERSION = 'snapback.app-data-result.v1';
export const CALL_RESULT_ARTIFACT_KIND = 'appCliCallResult';
export const CALL_RESULT_FORMAT_VERSION = 'snapback.app-cli-call-result.v1';

// LLP 0062 §2 — frozen from phase 1; renumbering is a compatibility break.
export const EXIT = Object.freeze({
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

// Known-code classification: exact codes first, then families. Frozen — an
// addition is compatible, a move is not. Exit 8 is reserved strictly for
// version/tuple admission; no code ever falls back to it (residue #8).
const EXACT_CODE_EXITS = new Map([
  ['SNAPBACK_APP_CLI_USAGE', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_ARTIFACTS_REQUIRED', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_COMMAND_UNKNOWN', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_AUTH_REFUSED', EXIT.AUTH_REFUSED],
  ['SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', EXIT.FUNCTION_NOT_FOUND],
  ['SNAPBACK_APP_CLI_FUNCTION_UNKNOWN', EXIT.FUNCTION_NOT_FOUND],
  ['SNAPBACK_APP_CLI_FUNCTION_ERROR', EXIT.FUNCTION_ERROR],
  ['SNAPBACK_APP_CLI_TRANSPORT_FAILED', EXIT.TRANSPORT_FAILED],
  ['SNAPBACK_APP_CLI_HTTP_FAILED', EXIT.TRANSPORT_FAILED],
  ['SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ARTIFACT_INDEX_INVALID', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_FUNCTION_MANIFEST_INVALID', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  // Residue #10: an envelope-less sessions target needing redeploy is an
  // identity-establishment failure (exit 7, sub-cause `envelope-absent`),
  // explicitly NOT exit 8 — nothing about protocol versions mismatched.
  ['SNAPBACK_APP_CLI_ENVELOPE_ABSENT', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_ARTIFACT_IDENTITY_MISMATCH', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  // Served-envelope ingestion (0062-02 step 4) — additions, no moves. Every
  // trust failure on the served surface is identity establishment (exit 7)
  // except the format-version admission, which is exactly the exit-8 class.
  ['SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ENVELOPE_NONCANONICAL', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ENVELOPE_MEMBER_DIGEST_MISMATCH', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ENVELOPE_DIGEST_MISMATCH', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ENVELOPE_CORRESPONDENCE_FAILED', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_DISCOVERY_INVALID', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_ENVELOPE_VERSION_UNSUPPORTED', EXIT.VERSION_MISMATCH],
  ['SNAPBACK_APP_CLI_OFFLINE_CACHED_SURFACE', EXIT.USAGE],
  // LLP 0062 §4: asking for a principal class the target does not advertise
  // is a usage error against a stated capability — the same class as pointing
  // served mode at a dev target, and deliberately not an auth refusal (no
  // credential was ever presented).
  ['SNAPBACK_APP_CLI_PRINCIPAL_UNSUPPORTED', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_CREDENTIAL_SOURCE_INVALID', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_AGENT_ORIGIN_UNSAFE', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_HOST_UNSUPPORTED', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_AGENT_ADMISSION_TIMEOUT', EXIT.TIMEOUT],
  // Server-side app-api refusals as the engine meets them on the wire:
  // pointing served mode at a dev target is a usage error; a stale hash is
  // identity establishment (refetch through /app-api/current).
  ['SNAPBACK_APP_API_UNAVAILABLE', EXIT.USAGE],
  ['SNAPBACK_APP_API_ENVELOPE_UNKNOWN', EXIT.ARTIFACT_IDENTITY_MISMATCH],
  ['SNAPBACK_APP_CLI_VERSION_MISMATCH', EXIT.VERSION_MISMATCH],
  ['SNAPBACK_APP_CLI_TIMEOUT', EXIT.TIMEOUT],
  ['SNAPBACK_APP_CLI_SCRIPT_EMPTY', EXIT.USAGE],
  ['SNAPBACK_APP_CLI_SCRIPT_ERROR', EXIT.SCRIPT_ERROR],
  ['SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', EXIT.RESOURCE_EXCEEDED],
]);

const AUTH_FAMILY = /^SNAPBACK_AUTH_/;

// Residue #8 — the frozen unknown-code fallback, keyed on wire locus and
// result kind, never on code recognition. Preservation stays absolute: the
// unknown code rides the diagnostic verbatim with `unrecognized: true`.
const isAuthShaped = (record) => AUTH_FAMILY.test(record.code)
  || record.httpStatus === 401 || record.httpStatus === 403;

export function classifyDiagnosticExit(record) {
  const exact = EXACT_CODE_EXITS.get(record.code);
  if (exact !== undefined) return exact;
  if (AUTH_FAMILY.test(record.code)) return EXIT.AUTH_REFUSED;
  switch (record.locus) {
    case 'request': {
      if (isAuthShaped(record)) return EXIT.AUTH_REFUSED;
      if (typeof record.httpStatus === 'number' && record.httpStatus >= 500) {
        return EXIT.TRANSPORT_FAILED;
      }
      return EXIT.FUNCTION_ERROR;
    }
    case 'result':
      return EXIT.FUNCTION_ERROR;
    case 'live':
      return isAuthShaped(record) ? EXIT.AUTH_REFUSED : EXIT.FUNCTION_ERROR;
    case 'broker':
      return EXIT.FUNCTION_ERROR;
    case 'engine':
      return EXIT.USAGE;
    default:
      return EXIT.FUNCTION_ERROR;
  }
}

const KNOWN_CODES = new Set(EXACT_CODE_EXITS.keys());

export const diagnosticRecord = ({
  code,
  severity = undefined,
  subsystem = undefined,
  locus,
  httpStatus = undefined,
  fields = undefined,
}) => {
  const record = { code, locus };
  if (severity !== undefined) record.severity = severity;
  if (subsystem !== undefined) record.subsystem = subsystem;
  if (httpStatus !== undefined) record.httpStatus = httpStatus;
  // Preserved, marked, never rewritten; never a third compatibility gate.
  if (!KNOWN_CODES.has(code) && !AUTH_FAMILY.test(code)) record.unrecognized = true;
  if (fields !== undefined) record.fields = fields;
  return Object.freeze(record);
};

export function buildResultCore({
  kind,
  outcome,
  value = undefined,
  facts = undefined,
  appRefusal = undefined,
  diagnostics = [],
  attribution = undefined,
  mutation = undefined,
}) {
  const core = {
    artifactKind: RESULT_CORE_ARTIFACT_KIND,
    formatVersion: RESULT_CORE_FORMAT_VERSION,
    kind,
    outcome,
  };
  if (value !== undefined) core.value = value;
  if (facts !== undefined) core.facts = facts;
  if (appRefusal !== undefined) core.appRefusal = appRefusal;
  core.diagnostics = diagnostics;
  // The server-derived attribution block rides verbatim (LLP 0055 §Audit);
  // this constructor never reshapes or synthesizes one.
  if (attribution !== undefined) core.attribution = attribution;
  if (mutation !== undefined) core.mutation = mutation;
  return Object.freeze(core);
}

// The frozen outcome → exit mapping. `refused` defers to the diagnostic
// classification; `unknown` (a lost write) exits by its underlying class
// (transport or timeout) while the outcome field says what is known.
export function resultExitCode(core) {
  switch (core.outcome) {
    case 'ok':
      return EXIT.OK;
    case 'app-refusal':
    case 'failed':
      return EXIT.FUNCTION_ERROR;
    case 'transport-failed':
      return EXIT.TRANSPORT_FAILED;
    case 'timeout':
      return EXIT.TIMEOUT;
    case 'not-dispatched':
      return EXIT.USAGE;
    case 'unknown':
      return core.mutation?.underlying === 'timeout' ? EXIT.TIMEOUT : EXIT.TRANSPORT_FAILED;
    case 'refused': {
      const [first] = core.diagnostics;
      return first === undefined ? EXIT.FUNCTION_ERROR : classifyDiagnosticExit(first);
    }
    default:
      // An outcome this engine does not know is engine-internal territory:
      // exit 1 is reserved for exactly that, never dressed as taxonomy.
      return 1;
  }
}

export function wrapCallResult(core, { engine, envelope = undefined }) {
  const wrapper = {
    artifactKind: CALL_RESULT_ARTIFACT_KIND,
    formatVersion: CALL_RESULT_FORMAT_VERSION,
    engine,
    // Absent — not null — on dev targets, which hold no envelope identity.
    ...(envelope === undefined ? {} : { envelope }),
    core,
  };
  return Object.freeze(wrapper);
}
