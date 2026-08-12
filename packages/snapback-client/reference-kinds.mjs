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
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return null;
  if (reference.kind === 'asset-bearing-command.v1') return 'Command';
  return Object.hasOwn(correctVerb, reference.kind) ? reference.kind : null;
}

function mismatchDiagnostic(receivedKind, acceptedKinds, invokedVerb) {
  const details = Object.freeze({
    receivedKind,
    acceptedKinds: Object.freeze([...acceptedKinds]),
    invokedVerb,
    correctVerb: correctVerb[receivedKind],
    guideAnchor: CLIENT_REFERENCE_KIND_GUIDE,
  });
  return Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: CLIENT_REFERENCE_KIND_MISMATCH_CODE,
    severity: 'error',
    message: `${invokedVerb} does not accept a ${receivedKind} reference; use ${correctVerb[receivedKind]}`,
    details,
  });
}

// @ref LLP 0238#d8-diagnostics-arrive-at-the-misuse-site — generated/skewed
// reference objects fail at the client call boundary. Strings retain their
// compatibility path because they carry no kind discriminant to compare.
export function assertClientReferenceKind({
  reference,
  acceptedKinds,
  invokedVerb,
  diagnosticsChannel = null,
}) {
  if (typeof reference === 'string') return;
  const receivedKind = receivedReferenceKind(reference);
  if (receivedKind === null || acceptedKinds.includes(receivedKind)) return;
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
