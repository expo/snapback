export const CLIENT_REFERENCE_KIND_MISMATCH_CODE = 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH';
export const CLIENT_REFERENCE_KIND_GUIDE = '/_snapback/guide/clients/headless.md#generated-reference-kinds-and-legal-verbs';

const correctVerb = Object.freeze({
  Query: 'query',
  LiveQuery: 'liveQuery',
  Mutation: 'mutate',
  Action: 'action',
  Command: 'commandClient.start',
});

function receivedReferenceKind(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return 'malformed';
  if (reference.kind === 'asset-bearing-command.v1') return 'Command';
  if (Object.hasOwn(correctVerb, reference.kind)) return reference.kind;
  if (!Object.hasOwn(reference, 'kind')) return 'missing';
  return typeof reference.kind === 'string' ? 'unknown' : 'malformed';
}

function mismatchDiagnostic(receivedKind, acceptedKinds, invokedVerb) {
  const knownCorrectVerb = correctVerb[receivedKind] ?? null;
  const repair = knownCorrectVerb === null
    ? 'Regenerate generated references and align the Snapback client/codegen package versions before choosing a verb.'
    : `Use ${knownCorrectVerb} for this generated reference.`;
  const details = Object.freeze({
    receivedKind,
    acceptedKinds: Object.freeze([...acceptedKinds]),
    invokedVerb,
    correctVerb: knownCorrectVerb,
    repair,
    guideAnchor: CLIENT_REFERENCE_KIND_GUIDE,
  });
  const message = knownCorrectVerb === null
    ? `${invokedVerb} received a ${receivedKind} generated reference kind; ${repair}`
    : `${invokedVerb} does not accept a ${receivedKind} reference; use ${knownCorrectVerb}`;
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: CLIENT_REFERENCE_KIND_MISMATCH_CODE,
    severity: 'error',
    message,
    details,
  });
}

// @ref LLP 0238#d1-generated-references-are-nominal-by-operation-kind — only
// legacy strings lack a discriminant by contract. Every object with a missing,
// unknown, or malformed kind fails before name validation or transport, and
// unknown future kinds receive a payload-safe package-skew repair.
export function assertClientReferenceKind({
  reference,
  acceptedKinds,
  invokedVerb,
  diagnosticsChannel = null,
}) {
  if (typeof reference === 'string') return;
  const receivedKind = receivedReferenceKind(reference);
  if (acceptedKinds.includes(receivedKind)) return;
  const diagnostic = mismatchDiagnostic(receivedKind, acceptedKinds, invokedVerb);
  // @ref LLP 0219#decision — the structured channel is always observational;
  // its default console projection is attached only under positive dev/HMR.
  try {
    diagnosticsChannel?.emit?.({
      schemaVersion: 'snapback.client-diagnostic.v2',
      code: diagnostic.code,
      severity: diagnostic.severity,
      subsystem: 'client-reference',
      message: diagnostic.message,
      details: diagnostic.details,
      site: invokedVerb,
    });
  } catch { /* diagnostics cannot own refusal */ }
  const error = new TypeError(`${diagnostic.code}: ${diagnostic.message}`);
  error.code = diagnostic.code;
  error.diagnostic = diagnostic;
  throw error;
}
