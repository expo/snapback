export const LOCAL_ANSWER_CLASSES_V1 = /* @__PURE__ */ Object.freeze([
  'authoritative',
  'lease-authorized-retained',
  'labeled-retained',
  'unknown',
  'refused',
]);

const connectedAction = (connected, online, offline = `${online}-on-reconnect`) => (
  connected ? online : offline
);

const answer = (answerClass, freshness, storeMutation, resumeAction) => Object.freeze({
  answerClass,
  freshness,
  storeMutation,
  resumeAction,
});

const UNKNOWN_FRESH_SYNC = (connected, mutation) => answer(
  'unknown',
  null,
  mutation,
  connectedAction(connected, 'fresh-sync'),
);

// @ref LLP 0166#d4--completeness-honest-local-answers — qmk1 authority is
// proof-or-nothing. Completeness comes only from L2/LLP 0157; these supplied
// owner facts select the delete/quarantine transition that must precede read.
export function deriveQmk1AnswerV1({
  completenessStatus,
  freshness,
  renderable,
  connected,
  integrity = 'valid',
  activation = 'current',
  lease = 'valid',
  witness = 'valid',
  scope = 'current',
} = {}) {
  if (typeof connected !== 'boolean') throw new TypeError('connected must be boolean');
  if (activation === 'mismatch') {
    return UNKNOWN_FRESH_SYNC(connected, 'delete-before-read');
  }
  if (lease === 'invalid') {
    return UNKNOWN_FRESH_SYNC(connected, 'delete-before-read');
  }
  if (witness === 'newer-epoch') {
    return answer(
      'unknown',
      null,
      'quarantine-before-read',
      connectedAction(connected, 'satisfying-resnapshot'),
    );
  }
  if (witness === 'invalid') {
    return UNKNOWN_FRESH_SYNC(connected, 'delete-before-read');
  }
  if (scope === 'superseded') {
    return answer(
      'unknown',
      null,
      'make-predecessor-proofs-historical',
      connectedAction(connected, 're-establish'),
    );
  }
  if (integrity === 'invalid') {
    return UNKNOWN_FRESH_SYNC(connected, 'discard-corrupt-fragment-proof');
  }
  if (completenessStatus === 'refused') {
    return answer('refused', null, 'store-refusal', 'safe-fallback');
  }
  if (
    completenessStatus !== 'complete'
    || renderable !== true
    || !['current', 'retained'].includes(freshness)
  ) {
    return UNKNOWN_FRESH_SYNC(connected, 'discard-corrupt-fragment-proof');
  }
  return answer('authoritative', freshness, 'none', 'none');
}

// Rows 9-13 deliberately consume the shipped Channel-B verification and
// outbox facts. A token's server-admission age never revokes offline display.
export function deriveLegacyResumeAnswerV1({
  connected,
  verified,
  outboxPending = false,
  tokenExpired = false,
  clearRetained = false,
} = {}) {
  if (typeof connected !== 'boolean') throw new TypeError('connected must be boolean');
  if (clearRetained) {
    return answer(
      'unknown',
      null,
      'purge-persisted-copy',
      connectedAction(connected, 'fresh-subscribe'),
    );
  }
  if (verified !== true) {
    return answer(
      'unknown',
      null,
      'delete-entry',
      connectedAction(connected, 'fresh-subscribe'),
    );
  }
  if (tokenExpired) {
    return answer(
      'labeled-retained',
      'retained',
      'replace-token-on-authoritative-answer',
      connected ? 'fresh-subscribe-rung-3' : 'none',
    );
  }
  if (outboxPending) {
    return answer(
      'labeled-retained',
      'retained',
      'none',
      connectedAction(connected, 'full-resync-then-replay'),
    );
  }
  return answer(
    'labeled-retained',
    'retained',
    'none',
    connectedAction(connected, 'resume-ladder'),
  );
}

// LLP 0043 remains the owner. This arm models its M1 facts without importing
// Contract storage or duplicating lease verification machinery.
export function deriveLegacyLeaseAnswerV1({
  connected,
  ownerFacts,
} = {}) {
  if (typeof connected !== 'boolean') throw new TypeError('connected must be boolean');
  const authorized = ownerFacts?.protectedRetainable === true
    && ownerFacts.identityWitnessMatch === true
    && ownerFacts.completeLeaseCustody === true
    && ownerFacts.beforeDeadline === true
    && ownerFacts.clockMonotone === true
    && ownerFacts.cursorTargetValid === true
    && ownerFacts.blockingFence === false;
  if (!authorized) {
    return answer(
      'unknown',
      null,
      'commit-delete-tombstone-before-read',
      connectedAction(connected, 'full-revalidate-and-fresh-snapshot'),
    );
  }
  return answer(
    'lease-authorized-retained',
    'retained',
    'none',
    connectedAction(connected, 'full-revalidate-and-fresh-snapshot'),
  );
}

export function deriveLocalAnswerV1(input) {
  if (input?.family === 'qmk1') return deriveQmk1AnswerV1(input);
  if (input?.family === 'legacy-resume') return deriveLegacyResumeAnswerV1(input);
  if (input?.family === 'legacy-lease') return deriveLegacyLeaseAnswerV1(input);
  throw new TypeError('family must be qmk1, legacy-resume, or legacy-lease');
}
