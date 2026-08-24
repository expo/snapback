// Shared client-outbox halves for the persisted RQS store arms (LLP 0043 M2
// on the JS/React arm — LLP 0129 Phase 0).
//
// The outbox is the durable queued-intent half of the DK-9 client store: one
// monotonic client-local sequence (never a wall clock — LLP 0008 §Mutation
// Replay), records that survive relaunch, drop-and-mark-failed as the honest
// terminal, and pending-acknowledgement obligations so the server's
// exactly-once settlement ledger can be GC'd by the same identity that
// created the records. Every store arm (memory / IndexedDB / file) exposes
// the same observable contract; these helpers keep validation, ordering, and
// bounds identical across arms.
//
// @ref LLP 0043#milestone-2-queued-mutation-replay — client-minted durable
//   identity, sequence ordering, captured environment, ACK-driven GC.
// @ref LLP 0008#mutation-replay-and-conflict-semantics — ordering uses the
//   sequence, never a wall clock; drop-and-mark-failed, never retried.

import { canonicalizeClientValueV1 } from './canonical-client-value.mjs';
import {
  effectiveDisposition,
  mergeResyncObligation,
  resolutionSatisfies,
  scopeKey,
  validateResolutionTicket,
  validateResyncObligation,
  validateScopeId,
} from '@expo/snapback-contract/auth-invalidation';
import {
  rewriteGeneratedArgumentIdsV1,
  settlementIdResolution,
} from './settlement-id-resolution.mjs';

/// Refusal bounds: exactly-once wins over opportunistic eviction (LLP 0043).
/// At the cap the store refuses a new record rather than evicting a pending
/// one. Values sized for a client-held queue, not the server ledger.
export const OUTBOX_MAX_RECORDS = 1024;
export const OUTBOX_MAX_RECORD_BYTES = 262_144; // 256 KiB serialized
export const OUTBOX_MAX_PENDING_ACKS = 4096;
export const OUTBOX_QUARANTINE_TOMBSTONE_FORMAT = 'snapback.outbox-quarantine-tombstone.v1';

/**
 * Fair two-lane dispatch gate. Foreground and housekeeping each remain
 * single-flight, but one lane never queues behind work already admitted in
 * the other. Calls without a lane are exclusive and fence both lanes for
 * authorization-root and authority-transition cuts.
 */
export function createOutboxAuthorizationDispatchGate() {
  const queue = [];
  const activeLanes = new Set();
  let exclusiveActive = false;

  function run(entry) {
    if (entry.lane === null) exclusiveActive = true;
    else activeLanes.add(entry.lane);
    Promise.resolve()
      .then(entry.operation)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        if (entry.lane === null) exclusiveActive = false;
        else activeLanes.delete(entry.lane);
        pump();
      });
  }

  function pump() {
    if (exclusiveActive) return;
    if (activeLanes.size === 0 && queue[0]?.lane === null) {
      run(queue.shift());
      return;
    }
    const exclusiveIndex = queue.findIndex(({ lane }) => lane === null);
    const candidates = queue.slice(0, exclusiveIndex === -1 ? queue.length : exclusiveIndex);
    for (const entry of candidates) {
      if (activeLanes.has(entry.lane)) continue;
      queue.splice(queue.indexOf(entry), 1);
      run(entry);
    }
  }

  return (operation, { lane = null } = {}) => {
    if (typeof operation !== 'function') {
      return Promise.reject(new TypeError('authorization dispatch operation must be a function'));
    }
    if (lane !== null && lane !== 'foreground' && lane !== 'housekeeping') {
      return Promise.reject(new TypeError('authorization dispatch lane must be foreground or housekeeping'));
    }
    return new Promise((resolve, reject) => {
      queue.push({ operation, lane, resolve, reject });
      pump();
    });
  };
}

// Connectivity classification shared by the LLP 0043 M2 queue path and the
// offline binding-receipt path (react-binding.mjs, which cannot import
// index.mjs without a cycle): transport PROVENANCE, not constructor identity
// (0137 A1-Expo f2). The primary signal is `fetchDispatchFailed` — stamped
// by index.mjs's sanitizeTransportError exactly where the fetch dispatch
// itself rejected, i.e. no Response was ever produced (no HTTP status, no
// server diagnostic, no receipt). WHATWG runtimes reject with TypeError
// there, but Expo/RN fetch rejects connection failures with a plain Error,
// so class identity alone silently disabled the queue on that carrier. The
// `instanceof TypeError` arm remains for errors that reach this predicate
// without crossing the stamped boundary. Caller-owned aborts and deadline
// expiries are not outages; anything the server answered — refusals,
// conflicts, rejections — is NOT connectivity and is never queued.
export const isConnectivityFailureError = (error) => (
  (
    (
      (error?.fetchDispatchFailed === true || error?.cause?.fetchDispatchFailed === true)
      && (
        error?.diagnostic === undefined
        || error?.diagnostic?.code === 'SNAPBACK_CLIENT_REFUSED'
      )
    )
    || (error instanceof TypeError && error?.diagnostic === undefined)
  )
  && error?.name !== 'AbortError'
  && error?.cause?.name !== 'AbortError'
  && error?.name !== 'TimeoutError'
  && error?.cause?.name !== 'TimeoutError'
  && error?.status === undefined
  && error?.receipt === undefined
);

const REPLAY_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const plainRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);
const stringOrNull = (value) => typeof value === 'string' ? value : null;
const authorityInstanceId = (descriptor) => stringOrNull(descriptor?.authorityInstanceId);
const normalizePrincipalScope = (value) => (
  plainRecord(value)
  && typeof value.authMode === 'string'
  && typeof value.authorizationStreamIncarnation === 'string'
  && (value.userId == null || typeof value.userId === 'string')
    ? {
      authMode: value.authMode,
      authorizationStreamIncarnation: value.authorizationStreamIncarnation,
      userId: stringOrNull(value.userId),
    }
    : null
);
const normalizeCustody = (value) => (
  plainRecord(value)
  && Number.isSafeInteger(value.authorityEpoch)
  && value.authorityEpoch >= 0
  && typeof value.authorityKey === 'string'
    ? {
      authorityEpoch: value.authorityEpoch,
      authorityKey: value.authorityKey,
    }
    : null
);
const samePrincipalScope = (left, right) => (
  left?.authMode === right?.authMode
  && left?.authorizationStreamIncarnation === right?.authorizationStreamIncarnation
  && (left?.userId ?? null) === (right?.userId ?? null)
);
const isFencedRecord = (record) => (
  plainRecord(record?.authorityDescriptor)
  && normalizePrincipalScope(record?.principalScope) !== null
  && normalizeCustody(record?.custody) !== null
);
const acknowledgementMatches = (ack, userId, descriptor) => (
  (userId === undefined || ack.userId === stringOrNull(userId))
  && (descriptor === undefined
    || (ack.authorityInstanceId ?? null) === authorityInstanceId(descriptor))
);

function outboxError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}
const invalidOutboxRecord = (message) => outboxError(
  'SNAPBACK_OUTBOX_RECORD_INVALID',
  message,
);

export const outboxNotWriterError = () => outboxError(
  'SNAPBACK_OUTBOX_NOT_WRITER',
  'this context does not hold single-writer ownership of the client store; '
    + 'the mutation was not queued',
);

export const outboxFullError = () => outboxError(
  'SNAPBACK_OUTBOX_FULL',
  `the durable outbox holds ${OUTBOX_MAX_RECORDS} records; new intent is `
    + 'refused rather than evicting an unsettled record (exactly-once wins)',
);

export const outboxAckFullError = () => outboxError(
  'SNAPBACK_OUTBOX_ACK_FULL',
  `the durable outbox holds ${OUTBOX_MAX_PENDING_ACKS} unconfirmed settlement acknowledgements; `
    + 'new settlement publication is refused rather than discarding recovery state',
);

export const outboxOversizeError = (bytes) => outboxError(
  'SNAPBACK_OUTBOX_RECORD_OVERSIZE',
  `serialized outbox record is ${bytes} bytes (max ${OUTBOX_MAX_RECORD_BYTES})`,
);

/// Validate + normalize one enqueue input into the stored record shape.
/// `sequence`, `enqueuedAt`, and `status` are store-assigned, never caller
/// input. Throws typed SNAPBACK_OUTBOX_RECORD_INVALID on a bad shape.
export function normalizeOutboxRecordInput(record) {
  if (!plainRecord(record)) {
    throw invalidOutboxRecord('outbox record must be an object');
  }
  const { id, function: functionName } = record;
  if (typeof id !== 'string' || !REPLAY_OPAQUE_ID.test(id)) {
    throw invalidOutboxRecord(
      'outbox record id must match the opaque replay-id alphabet (LLP 0043)',
    );
  }
  if (typeof functionName !== 'string' || !functionName) {
    throw invalidOutboxRecord('outbox record needs a function name');
  }
  const principalScope = normalizePrincipalScope(record.principalScope);
  const custody = normalizeCustody(record.custody);
  if (
    (record.principalScope != null || record.custody != null)
    && (principalScope === null || custody === null)
  ) {
    throw invalidOutboxRecord(
      'fenced outbox records require a complete principal scope and durable custody pair',
    );
  }
  const settlementLane = record.settlementLane ?? 'replay-accept';
  if (settlementLane !== 'replay-accept' && settlementLane !== 're-derive') {
    throw invalidOutboxRecord(
      'outbox settlement lane must be replay-accept or re-derive',
    );
  }
  const dispatchLane = record.dispatchLane ?? 'foreground';
  if (dispatchLane !== 'foreground' && dispatchLane !== 'housekeeping') {
    throw invalidOutboxRecord('outbox dispatch lane must be foreground or housekeeping');
  }
  const housekeepingKey = dispatchLane === 'housekeeping' ? record.housekeepingKey : null;
  if (
    dispatchLane === 'housekeeping'
    && (typeof housekeepingKey !== 'string' || !REPLAY_OPAQUE_ID.test(housekeepingKey))
  ) {
    throw invalidOutboxRecord('housekeeping outbox records require an opaque housekeeping key');
  }
  const successorTargetedHousekeeping = record.successorTargetedHousekeeping === true;
  if (successorTargetedHousekeeping && dispatchLane !== 'housekeeping') {
    throw invalidOutboxRecord('only housekeeping intent may target authority-barrier settlement');
  }
  // The protocol identity is the layer identity. Callers may capture the IR
  // before minting an id; normalize the durable copy once rather than retain
  // a second local-only identity that cannot match settlement.
  let optimisticOperation = null;
  if (record.optimisticOperation != null) {
    try {
      optimisticOperation = JSON.parse(canonicalizeClientValueV1(record.optimisticOperation));
    } catch {
      throw invalidOutboxRecord(
        'outbox optimistic operation must be a finite canonical client value',
      );
    }
    if (!plainRecord(optimisticOperation)) {
      throw invalidOutboxRecord('outbox optimistic operation must be an object');
    }
    optimisticOperation.layerId = id;
  }
  let generatedMutationTables = null;
  if (record.generatedMutationTables != null) {
    if (
      !Array.isArray(record.generatedMutationTables)
      || record.generatedMutationTables.some(
        (table) => typeof table !== 'string' || table.length === 0,
      )
    ) {
      throw invalidOutboxRecord('outbox generated mutation tables must be a string array');
    }
    generatedMutationTables = [...new Set(record.generatedMutationTables)].sort();
  }
  let argsContract = null;
  let argumentSchema = null;
  try {
    if (record.argsContract != null) {
      argsContract = JSON.parse(canonicalizeClientValueV1(record.argsContract));
    }
    if (record.argumentSchema != null) {
      argumentSchema = JSON.parse(canonicalizeClientValueV1(record.argumentSchema));
    }
  } catch {
    throw invalidOutboxRecord(
      'outbox generated argument contracts must be finite canonical client values',
    );
  }
  return {
    id,
    function: functionName,
    args: record.args ?? {},
    userId: stringOrNull(record.userId),
    readSet: Array.isArray(record.readSet) ? record.readSet : [],
    correlation: record.correlation ?? null,
    // The authority descriptor captured at enqueue (LLP 0043 §Auth posture).
    // It is immutable after identity assignment. An uncovered intent may
    // atomically adopt a fresh descriptor only after the client proves the
    // authenticated principal is unchanged.
    authorityDescriptor: record.authorityDescriptor ?? null,
    ...(principalScope === null ? {} : { principalScope }),
    ...(custody === null ? {} : { custody }),
    operationAuthorityPrincipalId: stringOrNull(record.operationAuthorityPrincipalId),
    // The captured replay environment, when one exists (LLP 0008 pins the
    // wire to {generatedIds, now} = the ctx-answer ledger). The plain JS arm
    // runs no local execution, so it usually captures none; a composing
    // layer with derived overlays supplies one.
    ctxLedger: record.ctxLedger ?? null,
    // Generated-artifact call-time binding (LLP 0012 amendment). Replay pins
    // the generation that authored the queued args; it never silently adopts
    // the currently discovered same-named mutation.
    expectedGeneration: record.expectedGeneration ?? null,
    ...(argsContract === null ? {} : { argsContract }),
    ...(argumentSchema === null ? {} : { argumentSchema }),
    // @ref LLP 0133#the-two-settlement-lanes — mixed queues retain one
    //   immutable policy and claim carrier per sequence-ordered mutation.
    settlementLane,
    dispatchLane,
    housekeepingKey,
    successorTargetedHousekeeping,
    settlementIdentity: record.settlementIdentity ?? null,
    settlementClaims: record.settlementClaims ?? null,
    boundedSkew: record.boundedSkew ?? null,
    // LLP 0163 widens the existing durable clientMutationId. The issuance is
    // immutable after first transport admission and therefore participates
    // in the outbox's exact replay identity.
    operationIssuance: record.operationIssuance ?? null,
    operationCoverageDisposition: record.operationCoverageDisposition ?? null,
    // Move-3 lane-L intent payload. The durable outbox owns the immutable IR
    // operation; private layers are always recomputed from it and never become
    // a second persistence authority.
    // @ref LLP 0155#rebase — reload replays remaining operations in sequence.
    optimisticOperation,
    // Empty means generated/server-only intent whose table effects are not
    // locally knowable; null distinguishes an older/non-generated record.
    generatedMutationTables,
    // Presentation ordering spans the durable and process-local generated
    // optimistic ledgers. The epoch is deliberately persisted with durable
    // intent so a later process can distinguish predecessor records from its
    // own invocations without comparing unrelated durable/ephemeral counters.
    // These fields are presentation metadata, not replay identity.
    optimisticProcessEpoch: typeof record.optimisticProcessEpoch === 'string'
      && REPLAY_OPAQUE_ID.test(record.optimisticProcessEpoch)
      ? record.optimisticProcessEpoch
      : null,
    optimisticInvocationSequence:
      Number.isSafeInteger(record.optimisticInvocationSequence)
      && record.optimisticInvocationSequence > 0
        ? record.optimisticInvocationSequence
        : null,
    // Client-captured wall-clock at enqueue. A labeled claim for receipts
    // and UI (LLP 0129 ledger row 1, decision 10 taxonomy) — never
    // transmitted as authority and never used for ordering.
    capturedNow: Number.isSafeInteger(record.capturedNow) ? record.capturedNow : null,
  };
}

const durableReplayIdentity = (record) => {
  const {
    capturedNow: _claimOnly,
    optimisticProcessEpoch: _presentationEpoch,
    optimisticInvocationSequence: _presentationSequence,
    authorityDescriptor,
    ...identity
  } = normalizeOutboxRecordInput(record);
  // sessionGeneration is retained and transmitted for observability, but the
  // ratified queue axis is the authority instance. Principal scope and the
  // durable custody lineage remain identity inputs so one clientMutationId
  // can never be rebound across a principal or custody transition.
  // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — descriptor instance is the
  //   replay equality axis; session generation is observability only.
  return {
    ...identity,
    authorityDescriptor: authorityDescriptor === null ? null : {
      descriptorVersion: authorityDescriptor.descriptorVersion,
      authorityInstanceId: authorityDescriptor.authorityInstanceId,
    },
  };
};

/// Serialized-size guard shared by every arm.
export function outboxRecordBytes(stored) {
  const {
    insertionOwned: _atomicReceipt,
    housekeepingSupersessions: _runtimeCostFact,
    ...durableRecord
  } = stored;
  return new TextEncoder().encode(JSON.stringify(durableRecord)).length;
}

/// Ordering rule: the client-local monotonic sequence, never a wall clock.
export const outboxOrder = (a, b) => a.sequence - b.sequence;

const settlementMints = (record) => (Array.isArray(record?.settlementClaims?.mints)
  ? record.settlementClaims.mints
  : []);

const settlementMintIds = (record) => (settlementMints(record)
    .map((mint) => mint?.claimed)
    .filter((claimed) => typeof claimed === 'string')
);

const rewriteLegacyStringLeaves = (value, replacements) => {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => rewriteLegacyStringLeaves(item, replacements));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      rewriteLegacyStringLeaves(item, replacements),
    ]));
  }
  return value;
};

const hasStringLeaf = (value, candidates) => {
  if (typeof value === 'string') return candidates.has(value);
  if (Array.isArray(value)) return value.some((item) => hasStringLeaf(item, candidates));
  return value !== null
    && typeof value === 'object'
    && Object.values(value).some((item) => hasStringLeaf(item, candidates));
};

const cascadeFailure = (state, unresolvedIds, afterSequence) => {
  if (!unresolvedIds.size) return { state, failedIds: [] };
  const records = { ...state.records };
  const failedIds = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of Object.values(records).sort(outboxOrder)) {
      if (
        candidate.status !== 'pending'
        || candidate.sequence <= afterSequence
        || !hasStringLeaf(candidate.args, unresolvedIds)
      ) continue;
      records[candidate.id] = {
        ...candidate,
        status: 'failed',
        failure: {
          code: 'SNAPBACK_SPECULATIVE_ID_UNRESOLVED',
          message: 'a predecessor speculative id has no authoritative mapping',
        },
        effectProvenance: {
          effectCommitted: false,
          effectMayHaveCommitted: false,
        },
      };
      failedIds.push(candidate.id);
      for (const minted of settlementMintIds(candidate)) unresolvedIds.add(minted);
      changed = true;
    }
  }
  return !failedIds.length
    ? { state, failedIds }
    : { state: { ...state, records }, failedIds };
};

const quarantineDependencyIds = (records, trigger) => {
  const unresolvedIds = new Set(settlementMintIds(trigger));
  const dependentIds = new Set();
  if (!unresolvedIds.size) return dependentIds;
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of records) {
      if (
        candidate.id === trigger.id
        || candidate.sequence <= trigger.sequence
        || dependentIds.has(candidate.id)
        || !hasStringLeaf(candidate.args, unresolvedIds)
      ) continue;
      dependentIds.add(candidate.id);
      for (const minted of settlementMintIds(candidate)) unresolvedIds.add(minted);
      changed = true;
    }
  }
  return dependentIds;
};

// The durable record keeps the original intent privately so explicit re-entry
// can restore it. Every observable store/client projection replaces that
// private record with this stable payload-free tombstone.
//
// @ref LLP 0081#4-execution-journaling-and-crash-recovery — an incompatible
//   client's queued intent is observable as a redacted tombstone, never
//   silently replayed or dropped.
const quarantineTombstone = (record) => ({
  format: OUTBOX_QUARANTINE_TOMBSTONE_FORMAT,
  status: 'quarantined',
  id: record.id,
  clientMutationId: record.id,
  function: record.function,
  sequence: record.sequence,
  quarantinedAt: record.quarantine?.quarantinedAt ?? null,
  refusalCode: record.quarantine?.refusalCode ?? 'SNAPBACK_UPGRADE_REQUIRED',
  quarantineDisposition: record.quarantine?.disposition ?? 'compatibility-unclassified',
  causeClientMutationId: record.quarantine?.causeClientMutationId ?? record.id,
  provenance: {
    source: 'server-replay-refusal',
    payload: 'redacted',
  },
  effectProvenance: effectProvenance(record.effectProvenance),
});

const reconcileSettledMintIds = (state, record, settlement) => {
  const { replacements, unresolved } = settlementIdResolution(record, settlement);
  let records = state.records;
  if (replacements.size) {
    records = { ...records };
    for (const candidate of Object.values(records)) {
      if (candidate.status !== 'pending' || candidate.sequence <= record.sequence) continue;
      const args = candidate.argsContract == null
        ? rewriteLegacyStringLeaves(candidate.args, replacements)
        : rewriteGeneratedArgumentIdsV1(
            candidate.args,
            candidate.argsContract,
            replacements,
          );
      if (canonicalizeClientValueV1(args) === canonicalizeClientValueV1(candidate.args)) continue;
      const rewritten = { ...candidate, args };
      if (outboxRecordBytes(rewritten) > OUTBOX_MAX_RECORD_BYTES) {
        for (const minted of settlementMintIds(record)) unresolved.add(minted);
        continue;
      }
      records[candidate.id] = rewritten;
    }
  }
  return cascadeFailure(
    records === state.records ? state : { ...state, records },
    unresolved,
    record.sequence,
  );
};

/// Shared state-shape helpers for arms that hold the outbox as one JSON
/// section ({ sequence, records: {id -> record}, acks: [{id, userId}] }).
export const emptyOutboxState = () => ({
  sequence: 0,
  records: {},
  acks: [],
  operationIdentityRanges: {},
  // @ref LLP 0053#dispositions-with-producers-and-meanings —
  //   mutation replay roots share the outbox's atomic persistence domain.
  authorizationQueue: {
    authorityGeneration: 0,
    generation: 0,
    authorityTransitionKey: null,
    authorityTransitionEpoch: null,
    pendingByScope: {},
    resolvedByToken: {},
  },
});

export function validateOutboxState(value) {
  if (
    !plainRecord(value)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !plainRecord(value.records)
    || !Array.isArray(value.acks)
  ) return null;
  const authorizationQueue = value.authorizationQueue === undefined
    ? {
      authorityGeneration: 0,
      generation: 0,
      authorityTransitionKey: null,
      authorityTransitionEpoch: null,
      pendingByScope: {},
      resolvedByToken: {},
    }
    : value.authorizationQueue;
  if (
    !plainRecord(authorizationQueue)
    || (authorizationQueue.authorityGeneration !== undefined
      && (!Number.isSafeInteger(authorizationQueue.authorityGeneration)
        || authorizationQueue.authorityGeneration < 0))
    || !Number.isSafeInteger(authorizationQueue.generation)
    || authorizationQueue.generation < 0
    || (
      authorizationQueue.authorityTransitionKey !== undefined
      && authorizationQueue.authorityTransitionKey !== null
      && (
        typeof authorizationQueue.authorityTransitionKey !== 'string'
        || authorizationQueue.authorityTransitionKey.length === 0
        || authorizationQueue.authorityTransitionKey.length > 2_048
      )
    )
    || (
      authorizationQueue.authorityTransitionEpoch !== undefined
      && authorizationQueue.authorityTransitionEpoch !== null
      && (
        !Number.isSafeInteger(authorizationQueue.authorityTransitionEpoch)
        || authorizationQueue.authorityTransitionEpoch < 0
      )
    )
    || !plainRecord(authorizationQueue.pendingByScope)
    || (authorizationQueue.resolvedByToken !== undefined
      && !plainRecord(authorizationQueue.resolvedByToken))
    || Object.keys(authorizationQueue.resolvedByToken ?? {}).length > OUTBOX_MAX_PENDING_ACKS
  ) return null;
  const pendingByScope = {};
  const resolvedByToken = {};
  try {
    for (const [key, obligationValue] of Object.entries(authorizationQueue.pendingByScope)) {
      const obligation = validateResyncObligation(obligationValue);
      if (
        scopeKey(obligation.scopeId) !== key
        || obligation.scopeId.kind === 'connection'
        || obligation.maxDisposition === 'retain'
      ) return null;
      pendingByScope[key] = structuredClone(obligation);
    }
    for (const [token, resolutionValue] of Object.entries(
      authorizationQueue.resolvedByToken ?? {},
    )) {
      const resolution = validateResolutionTicket(resolutionValue);
      if (resolution.ackToken !== token) return null;
      resolvedByToken[token] = structuredClone(resolution);
    }
  } catch {
    return null;
  }
  const normalizedAuthorizationQueue = {
    authorityGeneration: authorizationQueue.authorityGeneration ?? 0,
    generation: authorizationQueue.generation,
    authorityTransitionKey: authorizationQueue.authorityTransitionKey ?? null,
    authorityTransitionEpoch: authorizationQueue.authorityTransitionEpoch ?? null,
    pendingByScope,
    resolvedByToken,
  };
  const normalizedRecords = Object.fromEntries(
    Object.entries(value.records).map(([id, record]) => [id, {
      ...record,
      authorizationAuthorityGeneration: Number.isSafeInteger(
        record?.authorizationAuthorityGeneration,
      )
        ? record.authorizationAuthorityGeneration
        : (authorizationQueue.authorityGeneration ?? 0),
      authorizationQueueGeneration: Number.isSafeInteger(record?.authorizationQueueGeneration)
        ? record.authorizationQueueGeneration
        : authorizationQueue.generation,
    }]),
  );
  return {
    ...value,
    // Persisted predecessor shapes may already carry a live delete root but
    // predate per-record generations and delete redaction. Upgrade is itself
    // an exposure boundary: normalize the fence, then destroy every active or
    // re-enterable payload before callers can observe or proof-rebase it.
    // @ref LLP 0053#dispositions-with-producers-and-meanings — delete custody
    //   is terminal, payload-free, and discard-only across restart upgrade.
    records: effectiveDisposition(pendingByScope) === 'delete'
      ? redactOutboxForAuthorizationDelete(
        normalizedRecords,
        normalizedAuthorizationQueue,
      )
      : normalizedRecords,
    operationIdentityRanges: value.operationIdentityRanges
      && typeof value.operationIdentityRanges === 'object'
      && !Array.isArray(value.operationIdentityRanges)
      ? value.operationIdentityRanges
      : {},
    authorizationQueue: normalizedAuthorizationQueue,
  };
}

const queueExpectationFor = (obligation) => ({
  authorization: obligation.witness.authorization,
  versionStream: obligation.witness.data?.versionStream ?? null,
  issuerId: obligation.scopeId.kind === 'clientQuery' ? null : obligation.scopeId.issuerId,
});

const advanceAuthorizationQueueGeneration = (authorizationQueue) => {
  if (authorizationQueue.generation === Number.MAX_SAFE_INTEGER) {
    throw outboxError(
      'SNAPBACK_AUTH_INVALIDATION_GENERATION_EXHAUSTED',
      'authorization queue generation is exhausted and the client store must be replaced',
    );
  }
  return authorizationQueue.generation + 1;
};

const advanceAuthorizationAuthorityGeneration = (authorizationQueue) => {
  if (authorizationQueue.authorityGeneration === Number.MAX_SAFE_INTEGER) {
    throw outboxError(
      'SNAPBACK_AUTH_INVALIDATION_AUTHORITY_GENERATION_EXHAUSTED',
      'authorization authority generation is exhausted and the client store must be replaced',
    );
  }
  return authorizationQueue.authorityGeneration + 1;
};

const authorizationFence = (authorizationQueue) => Object.freeze({
  authorityGeneration: authorizationQueue.authorityGeneration,
  generation: authorizationQueue.generation,
});

const recordAuthorizationFence = (record) => ({
  authorityGeneration: record?.authorizationAuthorityGeneration,
  generation: record?.authorizationQueueGeneration,
});

const sameAuthorizationFence = (left, right) => (
  Number.isSafeInteger(left?.authorityGeneration)
  && Number.isSafeInteger(left?.generation)
  && left.authorityGeneration === right?.authorityGeneration
  && left.generation === right?.generation
);

const requireAuthorizationFence = (state, record, expectedFence = null) => {
  const current = state.authorizationQueue ?? emptyOutboxState().authorizationQueue;
  if (authorizationQueueResult(current).suspended) {
    throw outboxError(
      'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
      'the mutation queue authorization root blocks this record transition',
    );
  }
  const expected = expectedFence ?? recordAuthorizationFence(record);
  if (!sameAuthorizationFence(expected, authorizationFence(current))) {
    throw outboxError(
      'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
      'the mutation queue authorization generation changed before compare-and-commit',
      { expected, actual: authorizationFence(current) },
    );
  }
  return current;
};

const requireAuthorizationAuthorityGeneration = (
  state,
  expectedAuthorityGeneration = null,
) => {
  const current = state.authorizationQueue ?? emptyOutboxState().authorizationQueue;
  const expected = expectedAuthorityGeneration;
  if (
    !Number.isSafeInteger(expected)
    || expected < 0
    || expected !== current.authorityGeneration
  ) {
    throw outboxError(
      'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
      'the mutation queue authority generation changed before compare-and-commit',
      { expected, actual: current.authorityGeneration },
    );
  }
  return current;
};

const requireCurrentAuthorizationFence = (
  state,
  expectedFence = null,
  { allowSuspended = false } = {},
) => {
  const current = state.authorizationQueue ?? emptyOutboxState().authorizationQueue;
  if (!allowSuspended && authorizationQueueResult(current).suspended) {
    throw outboxError(
      'SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED',
      'the mutation queue authorization root blocks this queue transition',
    );
  }
  const expected = expectedFence ?? authorizationFence(current);
  if (!sameAuthorizationFence(expected, authorizationFence(current))) {
    throw outboxError(
      'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
      'the mutation queue authorization generation changed before compare-and-commit',
      { expected, actual: authorizationFence(current) },
    );
  }
  return current;
};

const rebaseAuthorizationFencesAfterProof = (records, authorizationQueue) => Object.fromEntries(
  Object.entries(records).map(([id, record]) => (
    record.status !== 'stranded'
      ? [id, {
        ...record,
        authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
        authorizationQueueGeneration: authorizationQueue.generation,
      }]
      : [id, record]
  )),
);

// Main's external-bearer wiper preserves outbox custody. Records that
// carry no authority descriptor, principal scope, or custody lineage are not a
// predecessor authority's records to disposition; keep that pre-existing
// contract for still-pending intent while moving its authorization CAS stamp
// into the newly advanced queue. Terminal/quarantined state, keyed coordinator
// transitions, and every authority-scoped record keep the predecessor stamp
// until their owning proof or reconcileCustody decides strand/delete/adopt.
const rebaseUnscopedAuthorizationFences = (records, authorizationQueue) => Object.fromEntries(
  Object.entries(records).map(([id, record]) => (
    record.status === 'pending' && !isFencedRecord(record)
      ? [id, {
        ...record,
        authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
        authorizationQueueGeneration: authorizationQueue.generation,
      }]
      : [id, record]
  )),
);

// Declared successor-valid housekeeping may be durably admitted before the
// barrier's store wipe. It is neither predecessor custody nor an ordinary
// unattributable record: advance its CAS fence into the successor generation,
// then bind exact custody only after the successor has settled.
const rebaseSuccessorTargetedAuthorizationFences = (records, authorizationQueue) => Object.fromEntries(
  Object.entries(records).map(([id, record]) => (
    record.status === 'pending' && record.successorTargetedHousekeeping === true
      ? [id, {
        ...record,
        authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
        authorizationQueueGeneration: authorizationQueue.generation,
      }]
      : [id, record]
  )),
);

const authorizationQueueResult = (authorizationQueue, extra = {}) => Object.freeze({
  ...extra,
  authorityGeneration: authorizationQueue.authorityGeneration,
  generation: authorizationQueue.generation,
  suspended: Object.keys(authorizationQueue.pendingByScope).length > 0,
  pendingScopeCount: Object.keys(authorizationQueue.pendingByScope).length,
  effectiveDisposition: effectiveDisposition(authorizationQueue.pendingByScope),
});

const effectProvenance = (value) => {
  const effectCommitted = typeof value?.effectCommitted === 'boolean'
    ? value.effectCommitted
    : null;
  const effectMayHaveCommitted = typeof value?.effectMayHaveCommitted === 'boolean'
    ? value.effectMayHaveCommitted
    : effectCommitted === true
      ? true
      : effectCommitted === false
        ? false
        : null;
  return {
    effectCommitted,
    effectMayHaveCommitted: effectCommitted === true
      ? true
      : effectMayHaveCommitted,
  };
};

const redactOutboxForAuthorizationDelete = (records, authorizationQueue) => Object.fromEntries(
  Object.entries(records).map(([id, record]) => {
    if (
      record.status === 'pending'
      && record.dispatchLane === 'housekeeping'
      && record.successorTargetedHousekeeping === true
    ) {
      return [id, {
        ...record,
        authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
        authorizationQueueGeneration: authorizationQueue.generation,
      }];
    }
    if (
      record.status !== 'pending'
      && record.status !== 'failed'
      && record.status !== 'quarantined'
      && !(record.status === 'stranded' && record.rerecordable === true)
    ) return [id, record];
    return [id, {
      id: record.id,
      function: record.function,
      sequence: record.sequence,
      enqueuedAt: record.enqueuedAt,
      authorityEpoch: record.authorityEpoch ?? null,
      authorityKey: record.authorityKey ?? null,
      authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
      authorizationQueueGeneration: authorizationQueue.generation,
      status: 'stranded',
      disposition: 'delete',
      reason: 'authorization_invalidation',
      replayable: false,
      discardOnly: true,
      rerecordable: false,
      effectProvenance: effectProvenance(record.effectProvenance),
    }];
  }),
);

export const outboxAuthorizationStatus = (state) => authorizationQueueResult(
  state.authorizationQueue ?? emptyOutboxState().authorizationQueue,
);

const validRange = (range) => (
  range && typeof range === 'object' && !Array.isArray(range)
  && range.schemaVersion === 1
  && typeof range.audience === 'string' && range.audience.length > 0
  && typeof range.authorityInstanceId === 'string' && range.authorityInstanceId.length > 0
  && typeof range.epochId === 'string' && range.epochId.length > 0
  && Number.isSafeInteger(range.epochSequence) && range.epochSequence >= 0
  && Number.isSafeInteger(range.rangeStart) && range.rangeStart >= 0
  && Number.isSafeInteger(range.rangeEndExclusive)
  && range.rangeEndExclusive > range.rangeStart
  && Number.isSafeInteger(range.issuedAtMs) && range.issuedAtMs >= 0
  && Number.isSafeInteger(range.expiresAtMs) && range.expiresAtMs > range.issuedAtMs
  && typeof range.authorityAuthenticatorDigest === 'string'
  && SHA256_DIGEST.test(range.authorityAuthenticatorDigest)
);

const custodyKey = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw outboxError(
      'SNAPBACK_OPERATION_RANGE_CUSTODY_INVALID',
      'operation identity range custody requires a non-empty authority cohort key',
    );
  }
  return value;
};

const installRange = (state, key, range) => {
  if (!validRange(range)) {
    throw outboxError(
      'SNAPBACK_OPERATION_RANGE_INVALID',
      'server operation identity range has an invalid public projection',
    );
  }
  const prior = state.operationIdentityRanges?.[key] ?? null;
  if (prior) {
    const same = canonicalizeClientValueV1(prior.range)
      === canonicalizeClientValueV1(range);
    if (same) return state;
    if (
      prior.range.authorityInstanceId !== range.authorityInstanceId
      || prior.range.audience !== range.audience
      || prior.range.epochId !== range.epochId
      || prior.range.rangeEndExclusive !== range.rangeStart
    ) {
      throw outboxError(
        'SNAPBACK_OPERATION_RANGE_CONTINUITY_INVALID',
        'replacement operation identity range is not the contiguous successor',
      );
    }
  }
  return {
    ...state,
    operationIdentityRanges: {
      ...(state.operationIdentityRanges ?? {}),
      [key]: { range: structuredClone(range), nextCounter: range.rangeStart },
    },
  };
};

const allocateIdentity = (state, key, now) => {
  const current = state.operationIdentityRanges?.[key] ?? null;
  if (current && !validRange(current.range)) {
    throw outboxError(
      'SNAPBACK_OPERATION_RANGE_CUSTODY_INVALID',
      'persisted operation identity range custody is corrupt',
    );
  }
  if (
    !current
    || !Number.isSafeInteger(current.nextCounter)
    || current.nextCounter < current.range.rangeStart
    || current.nextCounter >= current.range.rangeEndExclusive
    || !Number.isSafeInteger(now)
    || now >= current.range.expiresAtMs
  ) {
    return { state, issuance: null, disposition: 'uncovered-range-exhausted' };
  }
  const issuance = {
    kind: 'clientRange',
    epoch_id: current.range.epochId,
    counter: current.nextCounter,
    range_start: current.range.rangeStart,
    range_end_exclusive: current.range.rangeEndExclusive,
    authority_authenticator_digest: current.range.authorityAuthenticatorDigest,
  };
  return {
    state: {
      ...state,
      operationIdentityRanges: {
        ...state.operationIdentityRanges,
        [key]: { ...current, nextCounter: current.nextCounter + 1 },
      },
    },
    issuance,
    disposition: 'covered',
  };
};

/// Pure outbox transitions over the shared JSON section. Each returns
/// { state, result } without mutating the input, so arms can commit the
/// whole section atomically (file rename / IndexedDB transaction).
export const outboxOps = {
  // @ref LLP 0053#client-fences — root apply precedes blank/ACK, and replay
  //   stays suspended until an exact proof or authenticated retirement wins.
  applyAuthorizationObligation(
    state,
    obligationValue,
    expectedAuthorityGeneration = null,
  ) {
    const obligation = validateResyncObligation(obligationValue);
    if (obligation.scopeId.kind === 'connection') {
      throw outboxError(
        'SNAPBACK_CLIENT_QUEUE_SCOPE_UNSUPPORTED',
        'a connection projection root must be expanded into query-sized children',
      );
    }
    if (obligation.maxDisposition === 'retain') {
      throw outboxError(
        'SNAPBACK_CLIENT_QUEUE_ROOT_UNNECESSARY',
        'retain does not create a mutation-queue suspension root',
      );
    }
    const current = requireAuthorizationAuthorityGeneration(
      state,
      expectedAuthorityGeneration,
    );
    const key = scopeKey(obligation.scopeId);
    const merged = mergeResyncObligation(
      current.pendingByScope[key] ?? null,
      obligation,
      queueExpectationFor(obligation),
    );
    if (merged.status !== 'accepted') {
      return { state, result: authorizationQueueResult(current, { status: merged.status }) };
    }
    const authorizationQueue = {
      ...current,
      generation: advanceAuthorizationQueueGeneration(current),
      pendingByScope: {
        ...current.pendingByScope,
        [key]: structuredClone(merged.obligation),
      },
      resolvedByToken: current.resolvedByToken ?? {},
    };
    return {
      state: {
        ...state,
        authorizationQueue,
        records: merged.obligation.maxDisposition === 'delete'
          ? redactOutboxForAuthorizationDelete(state.records, authorizationQueue)
          : state.records,
      },
      result: authorizationQueueResult(authorizationQueue, { status: 'accepted' }),
    };
  },
  resolveAuthorizationObligation(
    state,
    resolutionValue,
    expectedAuthorityGeneration = null,
  ) {
    const resolution = validateResolutionTicket(resolutionValue);
    const current = requireAuthorizationAuthorityGeneration(
      state,
      expectedAuthorityGeneration,
    );
    const key = scopeKey(resolution.scopeId);
    const obligation = current.pendingByScope[key];
    if (!obligation || !resolutionSatisfies(obligation, resolution)) {
      const alreadyResolved = current.resolvedByToken?.[resolution.ackToken] ?? null;
      if (
        alreadyResolved !== null
        && canonicalizeClientValueV1(alreadyResolved)
          === canonicalizeClientValueV1(resolution)
      ) {
        return {
          state,
          result: authorizationQueueResult(current, {
            status: 'duplicate',
            ackToken: resolution.ackToken,
          }),
        };
      }
      throw outboxError(
        'SNAPBACK_CLIENT_QUEUE_RESOLUTION_STALE',
        'resolution does not satisfy the current exact mutation-queue root',
      );
    }
    const pendingByScope = { ...current.pendingByScope };
    if (
      !Object.hasOwn(current.resolvedByToken ?? {}, resolution.ackToken)
      && Object.keys(current.resolvedByToken ?? {}).length >= OUTBOX_MAX_PENDING_ACKS
    ) {
      throw outboxError(
        'SNAPBACK_OUTBOX_ACK_FULL',
        'authorization resolution cleanup capacity is exhausted before acknowledgement',
      );
    }
    delete pendingByScope[key];
    const authorizationQueue = {
      ...current,
      generation: advanceAuthorizationQueueGeneration(current),
      pendingByScope,
      resolvedByToken: {
        ...(current.resolvedByToken ?? {}),
        [resolution.ackToken]: structuredClone(resolution),
      },
    };
    return {
      state: {
        ...state,
        authorizationQueue,
        records: Object.keys(pendingByScope).length === 0
          ? rebaseAuthorizationFencesAfterProof(state.records, authorizationQueue)
          : state.records,
      },
      result: authorizationQueueResult(authorizationQueue, {
        status: 'resolved',
        ackToken: resolution.ackToken,
      }),
    };
  },
  acknowledgeAuthorizationResolution(
    state,
    resolutionValue,
    expectedAuthorityGeneration = null,
  ) {
    const resolution = validateResolutionTicket(resolutionValue);
    const current = requireAuthorizationAuthorityGeneration(
      state,
      expectedAuthorityGeneration,
    );
    const recorded = current.resolvedByToken?.[resolution.ackToken] ?? null;
    if (
      recorded === null
      || canonicalizeClientValueV1(recorded) !== canonicalizeClientValueV1(resolution)
    ) return { state, result: false };
    const resolvedByToken = { ...current.resolvedByToken };
    delete resolvedByToken[resolution.ackToken];
    const authorizationQueue = { ...current, resolvedByToken };
    return { state: { ...state, authorizationQueue }, result: true };
  },
  retireAuthorizationScopes(
    state,
    scopeValues,
    expectedAuthorityGeneration = null,
  ) {
    if (!Array.isArray(scopeValues)) {
      throw new TypeError('retireAuthorizationScopes requires exact scope ids');
    }
    const keys = new Set(scopeValues.map((scopeValue) => {
      const scope = validateScopeId(scopeValue);
      if (scope.kind === 'connection') {
        throw outboxError(
          'SNAPBACK_CLIENT_QUEUE_SCOPE_UNSUPPORTED',
          'a connection projection root must be expanded into query-sized children',
        );
      }
      return scopeKey(scope);
    }));
    const current = requireAuthorizationAuthorityGeneration(
      state,
      expectedAuthorityGeneration,
    );
    const pendingByScope = { ...current.pendingByScope };
    let retired = 0;
    for (const key of keys) {
      if (!Object.hasOwn(pendingByScope, key)) continue;
      delete pendingByScope[key];
      retired += 1;
    }
    if (retired === 0) {
      return { state, result: authorizationQueueResult(current, { retired }) };
    }
    const authorizationQueue = {
      ...current,
      generation: advanceAuthorizationQueueGeneration(current),
      pendingByScope,
      resolvedByToken: current.resolvedByToken ?? {},
    };
    return {
      state: {
        ...state,
        authorizationQueue,
        records: Object.keys(pendingByScope).length === 0
          ? rebaseAuthorizationFencesAfterProof(state.records, authorizationQueue)
          : state.records,
      },
      result: authorizationQueueResult(authorizationQueue, { retired }),
    };
  },
  authorizationTransitionVisible(
    state,
    kind,
    payload,
    expectedAuthorityGeneration = null,
  ) {
    let transition;
    try {
      if (kind === 'apply') {
        transition = outboxOps.applyAuthorizationObligation(
          state,
          payload,
          expectedAuthorityGeneration,
        );
      } else if (kind === 'resolve') {
        transition = outboxOps.resolveAuthorizationObligation(
          state,
          payload,
          expectedAuthorityGeneration,
        );
      } else if (kind === 'retire') {
        transition = outboxOps.retireAuthorizationScopes(
          state,
          payload,
          expectedAuthorityGeneration,
        );
      } else {
        throw new TypeError('authorizationTransitionVisible kind is invalid');
      }
    } catch (error) {
      if ([
        'SNAPBACK_CLIENT_QUEUE_RESOLUTION_STALE',
        'SNAPBACK_OUTBOX_AUTHORIZATION_STALE',
        'SNAPBACK_OUTBOX_AUTHORITY_GENERATION_STALE',
      ].includes(error?.code)) return { state, result: false };
      throw error;
    }
    // Exact visibility means replaying this root/proof/retirement is a no-op.
    // A generic suspended bit cannot prove which scope another context wrote.
    return { state, result: transition.state === state };
  },
  /// Atomically retire every predecessor authorization root/token before a
  /// successor authority can inspect queue state. Records keep their old
  /// authority fence until reconcileCustody strands, deletes, or explicitly
  /// re-adopts them under the settled successor.
  ///
  /// @ref LLP 0059#transition-barrier — durable predecessor custody is
  ///   retired in the same cut that advances successor authority state.
  advanceAuthorizationAuthority(
    state,
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    { rebaseUnscopedPending = false } = {},
  ) {
    const current = state.authorizationQueue ?? emptyOutboxState().authorizationQueue;
    if (
      authorityTransitionKey !== null
      && (
        typeof authorityTransitionKey !== 'string'
        || authorityTransitionKey.length === 0
        || authorityTransitionKey.length > 2_048
      )
    ) {
      throw outboxError(
        'SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_KEY_INVALID',
        'queue authority transition key must be a non-empty bounded string',
      );
    }
    if (
      authorityTransitionKey !== null
      && (
        !Number.isSafeInteger(authorityTransitionEpoch)
        || authorityTransitionEpoch < 0
      )
    ) {
      throw outboxError(
        'SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_EPOCH_INVALID',
        'keyed queue authority transitions require a non-negative successor epoch',
      );
    }
    if (
      authorityTransitionKey !== null
      && current.authorityTransitionKey === authorityTransitionKey
      && current.authorityTransitionEpoch === authorityTransitionEpoch
    ) {
      return {
        state,
        result: authorizationQueueResult(current, { status: 'authority-current' }),
      };
    }
    if (
      authorityTransitionKey !== null
      && current.authorityTransitionEpoch !== null
      && authorityTransitionEpoch <= current.authorityTransitionEpoch
    ) {
      throw outboxError(
        'SNAPBACK_OUTBOX_AUTHORITY_TRANSITION_STALE',
        'queue authority transition is older than the installed durable successor',
        {
          expectedAfterEpoch: current.authorityTransitionEpoch,
          actualEpoch: authorityTransitionEpoch,
        },
      );
    }
    const authorizationQueue = {
      authorityGeneration: advanceAuthorizationAuthorityGeneration(current),
      generation: advanceAuthorizationQueueGeneration(current),
      authorityTransitionKey,
      authorityTransitionEpoch,
      pendingByScope: {},
      resolvedByToken: {},
    };
    return {
      state: {
        ...state,
        authorizationQueue,
        records: rebaseSuccessorTargetedAuthorizationFences(
          rebaseUnscopedPending
            ? rebaseUnscopedAuthorizationFences(state.records, authorizationQueue)
            : state.records,
          authorizationQueue,
        ),
      },
      result: authorizationQueueResult(authorizationQueue, { status: 'authority-advanced' }),
    };
  },
  enqueue(state, input, now, expectedAuthorizationFence = null) {
    const normalized = normalizeOutboxRecordInput(input);
    const authorizationQueue = requireCurrentAuthorizationFence(
      state,
      expectedAuthorizationFence,
      { allowSuspended: true },
    );
    if (state.records[normalized.id]) {
      // Idempotence is the complete replay identity, never the opaque id
      // alone. Rebinding one id to another function/input/auth cohort would
      // let local recovery state disagree with the server's durable ledger.
      const existing = state.records[normalized.id];
      const retainedIdentity = durableReplayIdentity(existing);
      if (
        canonicalizeClientValueV1(retainedIdentity)
          !== canonicalizeClientValueV1(durableReplayIdentity(normalized))
      ) {
        throw outboxError(
          'SNAPBACK_OUTBOX_IDENTITY_MISMATCH',
          'client mutation id is already bound to another durable replay identity',
          { id: normalized.id },
        );
      }
      return {
        state,
        result: { ...existing, insertionOwned: false },
      };
    }
    if (Object.keys(state.records).length >= OUTBOX_MAX_RECORDS) throw outboxFullError();
    const stored = {
      ...normalized,
      sequence: state.sequence + 1,
      enqueuedAt: now,
      // @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — queue, dispatch, authorization, execution, and commit are distinct public mutation phases.
      timing: {
        enqueuedAtMs: now,
        dispatchedAtMs: null,
        authorizedAtMs: null,
        executedAtMs: null,
        committedAtMs: null,
      },
      status: 'pending',
      failure: null,
      authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
      authorizationQueueGeneration: authorizationQueue.generation,
    };
    const admitted = authorizationQueueResult(authorizationQueue).effectiveDisposition === 'delete'
      ? redactOutboxForAuthorizationDelete({ [stored.id]: stored }, authorizationQueue)[stored.id]
      : stored;
    const bytes = outboxRecordBytes(admitted);
    if (bytes > OUTBOX_MAX_RECORD_BYTES) throw outboxOversizeError(bytes);
    const records = { ...state.records };
    // @ref LLP 0267#75-repeated-equivalent-writes-and-effects-bounded-to-what-the-framework-knows
    //   — the queue already owns the mechanical supersession disposition, so
    //   its insertion receipt can report exact per-function counts without
    //   interpreting housekeeping intent.
    const housekeepingSupersessions = new Map();
    if (admitted.dispatchLane === 'housekeeping') {
      for (const [id, candidate] of Object.entries(records)) {
        if (
          candidate.status !== 'pending'
          || candidate.dispatchLane !== 'housekeeping'
          || candidate.housekeepingKey !== admitted.housekeepingKey
          || candidate.timing?.dispatchedAtMs != null
        ) continue;
        housekeepingSupersessions.set(
          candidate.function,
          (housekeepingSupersessions.get(candidate.function) ?? 0) + 1,
        );
        records[id] = {
          ...candidate,
          status: 'failed',
          failure: {
            code: 'SNAPBACK_HOUSEKEEPING_SUPERSEDED',
            message: `housekeeping intent ${admitted.housekeepingKey} was superseded by newer intent`,
          },
        };
      }
    }
    return {
      state: {
        ...state,
        sequence: admitted.sequence,
        records: { ...records, [admitted.id]: admitted },
      },
      // `insertionOwned` is an atomic receipt for this call, not durable
      // record state. Compensation pairs it with the monotone sequence and
      // may remove only that exact still-pending insertion.
      result: {
        ...admitted,
        insertionOwned: true,
        ...(housekeepingSupersessions.size === 0 ? {} : {
          housekeepingSupersessions: [...housekeepingSupersessions.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([functionId, count]) => ({ functionId, count })),
        }),
      },
    };
  },
  /// Atomically install a server response (when present), consume one finite
  /// counter, and persist the queued intent. With no available counter the
  /// intent is retained explicitly uncovered and MUST be assigned before
  /// transport admission.
  enqueueWithOperationIdentity(
    state,
    input,
    now,
    authorityCohortKey,
    range = null,
    expectedAuthorizationFence = null,
  ) {
    const key = custodyKey(authorityCohortKey);
    const existing = state.records[input?.id];
    if (existing) {
      return outboxOps.enqueue(state, {
        ...input,
        operationIssuance: input.operationIssuance ?? existing.operationIssuance,
        operationCoverageDisposition:
          input.operationCoverageDisposition ?? existing.operationCoverageDisposition,
      }, now, expectedAuthorizationFence);
    }
    let working = range === null ? state : installRange(state, key, range);
    const allocated = allocateIdentity(working, key, now);
    working = allocated.state;
    return outboxOps.enqueue(working, {
      ...input,
      operationIssuance: allocated.issuance,
      operationCoverageDisposition: allocated.disposition,
    }, now, expectedAuthorizationFence);
  },
  /// Bind an uncovered pending intent at reconnect in the same durable cut
  /// that installs/advances the range. A crash leaves either the original
  /// uncovered record or the fully assigned record and advanced counter.
  assignOperationIdentity(
    state,
    id,
    now,
    authorityCohortKey,
    range = null,
    authorityDescriptor = undefined,
    authorityPrincipalId = undefined,
    expectedAuthorizationFence = null,
  ) {
    const key = custodyKey(authorityCohortKey);
    const existing = state.records[id];
    if (!existing || existing.status !== 'pending') {
      return { state, result: existing ?? null };
    }
    requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    let working = range === null ? state : installRange(state, key, range);
    if (existing.operationIssuance !== null) return { state: working, result: existing };
    const allocated = allocateIdentity(working, key, now);
    const stored = {
      ...existing,
      ...(authorityDescriptor === undefined ? {} : { authorityDescriptor }),
      ...(authorityPrincipalId === undefined
        ? {}
        : { operationAuthorityPrincipalId: stringOrNull(authorityPrincipalId) }),
      operationIssuance: allocated.issuance,
      operationCoverageDisposition: allocated.disposition,
    };
    if (outboxRecordBytes(stored) > OUTBOX_MAX_RECORD_BYTES) {
      throw outboxOversizeError(outboxRecordBytes(stored));
    }
    return {
      state: {
        ...allocated.state,
        records: { ...allocated.state.records, [id]: stored },
      },
      result: stored,
    };
  },
  operationIdentityRange(state, authorityCohortKey) {
    const current = state.operationIdentityRanges?.[custodyKey(authorityCohortKey)] ?? null;
    return { state, result: current?.range ?? null };
  },
  settle(state, id, expectedAuthorizationFence = null) {
    const existing = state.records[id];
    if (!existing) return { state, result: false };
    requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    const records = { ...state.records };
    delete records[id];
    return { state: { ...state, records }, result: true };
  },
  markFailed(state, id, failure, expectedAuthorizationFence = null) {
    const existing = state.records[id];
    if (!existing || existing.status !== 'pending') return { state, result: false };
    requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    const stored = {
      ...existing,
      status: 'failed',
      timing: {
        ...existing.timing,
        authorizedAtMs: failure?.timing?.authorizedAtMs ?? existing.timing?.authorizedAtMs ?? null,
        executedAtMs: failure?.timing?.executedAtMs ?? existing.timing?.executedAtMs ?? null,
        committedAtMs: failure?.timing?.committedAtMs ?? existing.timing?.committedAtMs ?? null,
      },
      failure: {
        code: typeof failure?.code === 'string' ? failure.code : 'SNAPBACK_OUTBOX_REPLAY_FAILED',
        message: typeof failure?.message === 'string' ? failure.message : String(failure ?? ''),
      },
      effectProvenance: effectProvenance(failure),
    };
    const failed = { ...state, records: { ...state.records, [id]: stored } };
    // A terminal mint failure invalidates every leaf-visible dependent before
    // any later submission slot. Each failed dependent contributes its own
    // minted ids, so the same transition computes the transitive closure.
    // @ref LLP 0133#divergence-on-settle — cascade is drop-and-mark-failed,
    //   terminal, observable, and restricted to exact string leaves.
    const cascaded = cascadeFailure(
      failed,
      new Set(settlementMintIds(existing)),
      existing.sequence,
    );
    return { state: cascaded.state, result: true };
  },
  markStranded(
    state,
    id,
    reason,
    now,
    predecessorPrincipalScope = null,
    expectedAuthorizationFence = null,
    provenance = null,
  ) {
    const existing = state.records[id];
    if (!existing) return { state, result: false };
    if (existing.status === 'stranded') return { state, result: existing };
    if (
      existing.status !== 'pending'
      && existing.status !== 'failed'
      && existing.status !== 'quarantined'
    ) {
      return { state, result: false };
    }
    if (expectedAuthorizationFence !== false) {
      requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    }
    const scope = normalizePrincipalScope(
      predecessorPrincipalScope ?? existing.principalScope,
    );
    if (scope === null) return { state, result: false };
    const stored = {
      ...existing,
      status: 'stranded',
      predecessorPrincipalScope: scope,
      disposition: 'strand',
      reason: typeof reason === 'string' && reason.length > 0
        ? reason
        : 'authority_instance_changed',
      replayable: false,
      discardOnly: false,
      rerecordable: true,
      strandedAt: now,
      effectProvenance: effectProvenance(provenance ?? existing.effectProvenance),
    };
    return {
      state: { ...state, records: { ...state.records, [id]: stored } },
      result: stored,
    };
  },
  /// Reconcile every fenced queue record in one store transaction before the
  /// current authority observes it. The ruled item-5 table strands
  /// anonymous→authenticated, dev→sessions, and same-user predecessor intent;
  /// cross-user, sessions→dev, and incarnation changes privacy-delete.
  ///
  /// @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — apply the item-5 predecessor queue disposition table before successor observation.
  reconcileCustody(
    state,
    principalScope,
    authorityDescriptor,
    custody,
    now,
    expectedAuthorityGeneration = null,
  ) {
    const currentScope = normalizePrincipalScope(principalScope);
    const currentCustody = normalizeCustody(custody);
    const currentInstance = authorityInstanceId(authorityDescriptor);
    if (currentScope === null || currentCustody === null || currentInstance === null) {
      throw invalidOutboxRecord('queue custody reconciliation requires a settled authority');
    }
    let working = state;
    const authorizationQueue = requireAuthorizationAuthorityGeneration(
      working,
      expectedAuthorityGeneration,
    );
    const deletedIds = [];
    const strandedIds = [];
    for (const record of Object.values(state.records).sort(outboxOrder)) {
      if (!isFencedRecord(record)) {
        if (
          record.status === 'pending'
          && record.dispatchLane === 'housekeeping'
          && record.successorTargetedHousekeeping === true
        ) {
          working = {
            ...working,
            records: {
              ...working.records,
              [record.id]: {
                ...working.records[record.id],
                userId: currentScope.userId,
                authorityDescriptor,
                principalScope: currentScope,
                custody: currentCustody,
                operationAuthorityPrincipalId: currentScope.userId,
                successorTargetedHousekeeping: false,
                authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
                authorizationQueueGeneration: authorizationQueue.generation,
              },
            },
          };
          continue;
        }
        const currentDeleteTombstone = record.status === 'stranded'
          && record.disposition === 'delete'
          && record.discardOnly === true
          && record.rerecordable === false
          && record.authorizationAuthorityGeneration
            === authorizationQueue.authorityGeneration;
        if (currentDeleteTombstone) continue;
        // An unattributable record carries no captured principal or custody
        // proof, so a fenced observer can neither attribute it to the current
        // principal nor ever transmit it under a captured authority ("intent
        // is never queued under unknown authority" extends to observation and
        // replay). Privacy-delete it with the same diagnostic count.
        deletedIds.push(record.id);
        continue;
      }
      const recordIsAgent = record.authorityDescriptor?.sessionGeneration === 0
        && record.principalScope?.userId !== null;
      const currentIsAgent = authorityDescriptor?.sessionGeneration === 0
        && currentScope.userId !== null;
      const agentPrincipalChanged = recordIsAgent || currentIsAgent
        ? !recordIsAgent
          || !currentIsAgent
          || record.custody.authorityKey !== currentCustody.authorityKey
        : false;
      const predecessorScope = record.principalScope;
      const incarnationChanged = predecessorScope.authorizationStreamIncarnation
        !== currentScope.authorizationStreamIncarnation;
      const devToSessions = predecessorScope.authMode === 'dev'
        && currentScope.authMode === 'sessions';
      const anonymousToAuthenticated = predecessorScope.authMode === 'sessions'
        && currentScope.authMode === 'sessions'
        && predecessorScope.userId === null
        && currentScope.userId !== null;
      const sameUser = predecessorScope.authMode === currentScope.authMode
        && predecessorScope.userId !== null
        && predecessorScope.userId === currentScope.userId;
      const shouldStrandPredecessor = !agentPrincipalChanged
        && !incarnationChanged
        && (devToSessions || anonymousToAuthenticated || sameUser);
      if (
        shouldStrandPredecessor
        && !samePrincipalScope(predecessorScope, currentScope)
        && (
          record.status === 'pending'
          || record.status === 'failed'
          || record.status === 'quarantined'
        )
      ) {
        const applied = outboxOps.markStranded(
          working,
          record.id,
          devToSessions ? 'auth_mode_changed' : 'predecessor_authority_changed',
          now,
          predecessorScope,
          false,
        );
        working = applied.state;
        if (applied.result) strandedIds.push(record.id);
        continue;
      }
      if (agentPrincipalChanged || !samePrincipalScope(predecessorScope, currentScope)) {
        // Every fenced disposition belongs to the predecessor principal.
        // This includes settled records, whose args, settlement claims, and
        // result remain payload-bearing until their acknowledgement is
        // confirmed, plus any future terminal disposition added here.
        deletedIds.push(record.id);
        continue;
      }
      if (
        authorityInstanceId(record.authorityDescriptor) !== currentInstance
        && (
          record.status === 'pending'
          || record.status === 'failed'
          || record.status === 'quarantined'
        )
      ) {
        const applied = outboxOps.markStranded(
          working,
          record.id,
          'authority_instance_changed',
          now,
          record.principalScope,
          false,
        );
        working = applied.state;
        if (applied.result) strandedIds.push(record.id);
      }
      if (
        authorityInstanceId(record.authorityDescriptor) === currentInstance
        && (
          record.status === 'pending'
          || record.status === 'failed'
          || record.status === 'quarantined'
        )
      ) {
        working = {
          ...working,
          records: {
            ...working.records,
            [record.id]: {
              ...working.records[record.id],
              authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
              authorizationQueueGeneration: authorizationQueue.generation,
            },
          },
        };
      }
      if (record.status === 'result-gone') {
        // The server outcome is already terminal, so a same-principal
        // successor can explicitly discard the retained dependency without
        // ever replaying it. Rebase only its queue fence; cross-principal
        // custody was privacy-deleted above.
        working = {
          ...working,
          records: {
            ...working.records,
            [record.id]: {
              ...working.records[record.id],
              authorizationAuthorityGeneration: authorizationQueue.authorityGeneration,
              authorizationQueueGeneration: authorizationQueue.generation,
            },
          },
        };
      }
    }
    if (deletedIds.length > 0) {
      const deleted = new Set(deletedIds);
      const records = { ...working.records };
      for (const id of deletedIds) delete records[id];
      working = {
        ...working,
        records,
        acks: working.acks.filter((acknowledgement) => !deleted.has(acknowledgement.id)),
      };
    }
    return {
      state: working,
      result: {
        deleted: deletedIds.length,
        deletedIds,
        stranded: strandedIds.length,
        strandedIds,
      },
    };
  },
  discardStranded(state, ids, principalScope, expectedAuthorizationFence = null) {
    const currentScope = normalizePrincipalScope(principalScope);
    if (currentScope === null) {
      throw invalidOutboxRecord('stranded discard requires a settled principal scope');
    }
    const selected = new Set(Array.isArray(ids) ? ids : []);
    requireCurrentAuthorizationFence(state, expectedAuthorizationFence);
    const records = { ...state.records };
    const discardedIds = [];
    for (const record of Object.values(records).sort(outboxOrder)) {
      const deleteTombstone = record.status === 'stranded'
        && record.disposition === 'delete'
        && record.discardOnly === true
        && record.rerecordable === false
        && record.authorizationAuthorityGeneration
          === state.authorizationQueue.authorityGeneration;
      if (
        record.status !== 'stranded'
        || !selected.has(record.id)
        || (!deleteTombstone && (
          record.rerecordable !== true
          || !samePrincipalScope(record.predecessorPrincipalScope, currentScope)
        ))
      ) continue;
      delete records[record.id];
      discardedIds.push(record.id);
    }
    return discardedIds.length === 0
      ? { state, result: { discarded: 0, clientMutationIds: [] } }
      : {
        state: { ...state, records },
        result: { discarded: discardedIds.length, clientMutationIds: discardedIds },
      };
  },
  /// First-cut LLP 0081 quarantine: without generated successor-compatibility
  /// facts, one upgrade-required replay refusal quarantines every pending
  /// intent. Exact-leaf dependents retain an explicit dependent disposition;
  /// other pending records are held as compatibility-unclassified. No intent
  /// is dropped and no quarantined intent is selected by pendingOutboxRecords.
  markQuarantined(state, id, refusal, now, expectedAuthorizationFence = null) {
    const trigger = state.records[id];
    if (!trigger || trigger.status !== 'pending') return { state, result: false };
    requireAuthorizationFence(state, trigger, expectedAuthorizationFence);
    const refusalCode = typeof refusal?.code === 'string' && refusal.code.length > 0
      ? refusal.code
      : 'SNAPBACK_UPGRADE_REQUIRED';
    const pending = Object.values(state.records)
      .filter((record) => record.status === 'pending')
      .sort(outboxOrder);
    const dependentIds = quarantineDependencyIds(pending, trigger);
    const records = { ...state.records };
    for (const record of pending) {
      const disposition = record.id === trigger.id
        ? 'upgrade-required-refusal'
        : dependentIds.has(record.id)
          ? 'dependent'
          : 'compatibility-unclassified';
      records[record.id] = {
        ...record,
        status: 'quarantined',
        failure: null,
        quarantine: {
          quarantinedAt: now,
          refusalCode,
          disposition,
          causeClientMutationId: trigger.id,
        },
        effectProvenance: effectProvenance(
          record.id === trigger.id ? refusal : record.effectProvenance,
        ),
      };
    }
    const next = { ...state, records };
    return {
      state: next,
      result: {
        count: pending.length,
        tombstones: pending.map((record) => quarantineTombstone(records[record.id])),
      },
    };
  },
  /// Explicit successor-admission cut. Payloads and replay identities are
  /// unchanged; only quarantined records re-enter the ordered pending lane.
  /// Compatibility classification/transformation is a generated-facts
  /// follow-on, so this first cut deliberately re-enters the whole quarantine.
  reenterQuarantined(state, expectedAuthorizationFence = null) {
    requireCurrentAuthorizationFence(state, expectedAuthorizationFence);
    const records = { ...state.records };
    const ids = [];
    for (const existing of Object.values(records).sort(outboxOrder)) {
      if (existing.status !== 'quarantined') continue;
      const {
        quarantine: _quarantine,
        effectProvenance: _effectProvenance,
        ...record
      } = existing;
      records[existing.id] = { ...record, status: 'pending', failure: null };
      ids.push(existing.id);
    }
    return ids.length === 0
      ? { state, result: { count: 0, clientMutationIds: [] } }
      : {
        state: { ...state, records },
        result: { count: ids.length, clientMutationIds: ids },
      };
  },
  /// Persist the server's outcome-known/payload-gone disposition without
  /// pretending that an unavailable result is a normal settlement. This is
  /// terminal for transport (the operation must never execute again) but
  /// remains a submission fence until the application explicitly discards
  /// the record because a later ordered operation may depend on the missing
  /// result.
  ///
  /// @ref LLP 0163#contract-summary-normative-details-per-llp-0162-0-2 —
  ///   result-expired is outcome-known and distinct from both settled and
  ///   identity-horizon-passed state.
  markResultGone(state, id, resultGone, expectedAuthorizationFence = null) {
    const existing = state.records[id];
    if (!existing) return { state, result: false };
    const outcome = resultGone?.outcome;
    const receiptDigest = resultGone?.receiptDigest;
    if (
      (outcome !== 'committed' && outcome !== 'refused')
      || typeof receiptDigest !== 'string'
      || !SHA256_DIGEST.test(receiptDigest)
    ) {
      throw outboxError(
        'SNAPBACK_OUTBOX_RESULT_GONE_INVALID',
        'result-gone custody requires a known terminal outcome and receipt digest',
      );
    }
    if (existing.status === 'result-gone') {
      if (
        existing.resultGone?.disposition !== 'result-expired'
        || existing.resultGone?.outcome !== outcome
        || existing.resultGone?.receiptDigest !== receiptDigest
      ) {
        throw outboxError(
          'SNAPBACK_OUTBOX_RESULT_GONE_MISMATCH',
          'result-gone custody is already bound to different terminal facts',
          { id },
        );
      }
      return { state, result: existing };
    }
    if (existing.status !== 'pending') return { state, result: false };
    requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    const stored = {
      ...existing,
      status: 'result-gone',
      resultGone: {
        disposition: 'result-expired',
        outcome,
        receiptDigest,
      },
      failure: null,
    };
    if (outboxRecordBytes(stored) > OUTBOX_MAX_RECORD_BYTES) {
      throw outboxOversizeError(outboxRecordBytes(stored));
    }
    return {
      state: { ...state, records: { ...state.records, [id]: stored } },
      result: stored,
    };
  },
  discard(state, id, expectedAuthorizationFence = null) {
    return outboxOps.settle(state, id, expectedAuthorizationFence);
  },
  discardPendingInsertion(
    state,
    id,
    insertionSequence,
    expectedAuthorizationFence = null,
  ) {
    const existing = state.records[id];
    if (
      !existing
      || existing.status !== 'pending'
      || existing.sequence !== insertionSequence
    ) return { state, result: false };
    requireAuthorizationFence(state, existing, expectedAuthorizationFence);
    const records = { ...state.records };
    delete records[id];
    return { state: { ...state, records }, result: true };
  },
  recordAck(state, id, userId, authorityDescriptor = null, ready = true) {
    if (state.acks.some((ack) => ack.id === id)) return { state, result: false };
    if (state.acks.length >= OUTBOX_MAX_PENDING_ACKS) throw outboxAckFullError();
    const acks = [...state.acks, {
      id,
      userId: stringOrNull(userId),
      authorityInstanceId: authorityInstanceId(
        authorityDescriptor
          ?? state.records[id]?.settlementAuthorityDescriptor
          ?? state.records[id]?.authorityDescriptor,
      ),
      ready,
    }];
    return { state: { ...state, acks }, result: true };
  },
  /// Atomically cross the durable-consumption boundary: retain the complete
  /// settlement for recovery and create its server-GC obligation in the same
  /// store transaction. Publication may happen only after this transition.
  durablyConsume(
    state,
    id,
    settlement,
    userId,
    now,
    confirmedAcknowledgements = [],
    expectedAuthorizationFence = null,
  ) {
    const beforeConfirmed = state.records[id];
    if (!beforeConfirmed) return { state, result: false };
    requireAuthorizationFence(state, beforeConfirmed, expectedAuthorizationFence);
    // A successful mutation response proves its piggyback ACK stage too.
    // Retire those obligations in this same transaction so an ACK-full store
    // can make room without a crash gap before retaining the new settlement.
    const afterConfirmed = outboxOps.confirmAcks(state, confirmedAcknowledgements).state;
    const existing = afterConfirmed.records[id];
    if (existing.status === 'settled') return { state: afterConfirmed, result: existing };
    if (existing.status !== 'pending') return { state, result: false };
    // Rewrite every not-yet-submitted successor in the same durable
    // transition that retains the minting settlement. An unmapped mint takes
    // the same atomic cascade path as rejection.
    // @ref LLP 0133#divergence-on-settle — authoritative id-map delivery
    //   rewrites exact string leaves only; no typed-id/dataflow inference.
    const reconciled = reconcileSettledMintIds(afterConfirmed, existing, settlement).state;
    const stored = {
      ...existing,
      status: 'settled',
      // The request descriptor is immutable replay identity. The server echo
      // is a separate custody fact used only to expose and ACK the settlement.
      settlementAuthorityDescriptor:
        settlement?.authorityDescriptor ?? existing.settlementAuthorityDescriptor ?? null,
      settlement,
      settledAt: now,
      timing: {
        enqueuedAtMs: existing.timing?.enqueuedAtMs ?? existing.enqueuedAt ?? null,
        dispatchedAtMs: existing.timing?.dispatchedAtMs ?? null,
        authorizedAtMs: settlement?.timing?.authorizedAtMs ?? null,
        executedAtMs: settlement?.timing?.executedAtMs ?? null,
        committedAtMs: settlement?.timing?.committedAtMs ?? null,
      },
      failure: null,
    };
    if (outboxRecordBytes(stored) > OUTBOX_MAX_RECORD_BYTES) {
      throw outboxOversizeError(outboxRecordBytes(stored));
    }
    const withSettlement = {
      ...reconciled,
      records: { ...reconciled.records, [id]: stored },
    };
    const acknowledged = outboxOps.recordAck(
      withSettlement,
      id,
      userId,
      stored.settlementAuthorityDescriptor,
      false,
    );
    return { state: acknowledged.state, result: stored };
  },
  prepareSubmission(
    state,
    id,
    { authorizationOnly = false, markDispatched = false, now = Date.now() } = {},
  ) {
    const authorizationQueue = state.authorizationQueue ?? emptyOutboxState().authorizationQueue;
    if (authorizationQueueResult(authorizationQueue).suspended) {
      return {
        state,
        result: {
          status: 'authorization-suspended',
          record: null,
          fence: authorizationFence(authorizationQueue),
        },
      };
    }
    let working = state;
    let target = working.records[id];
    if (!target || target.status !== 'pending') {
      return {
        state: working,
        result: { status: target?.status ?? 'missing', record: target ?? null },
      };
    }
    if (!sameAuthorizationFence(recordAuthorizationFence(target), authorizationFence(
      working.authorizationQueue ?? authorizationQueue,
    ))) {
      return {
        state: working,
        result: {
          status: 'authorization-stale',
          record: null,
          fence: authorizationFence(working.authorizationQueue ?? authorizationQueue),
        },
      };
    }
    if (authorizationOnly) {
      if (markDispatched && target.timing?.dispatchedAtMs == null) {
        target = { ...target, timing: { ...target.timing, dispatchedAtMs: now } };
        working = { ...working, records: { ...working.records, [id]: target } };
      }
      return {
        state: working,
        result: {
          status: 'ready',
          record: target,
          fence: authorizationFence(working.authorizationQueue ?? authorizationQueue),
        },
      };
    }
    for (const predecessor of Object.values(working.records).sort(outboxOrder)) {
      if (predecessor.sequence >= target.sequence) break;
      if (predecessor.status === 'result-gone') {
        return { state: working, result: { status: 'blocked', record: null } };
      }
      if (predecessor.status === 'quarantined') {
        return { state: working, result: { status: 'blocked', record: null } };
      }
      const minted = new Set(settlementMintIds(predecessor));
      if (!minted.size || !hasStringLeaf(target.args, minted)) continue;
      if (predecessor.status === 'pending') {
        return { state: working, result: { status: 'blocked', record: null } };
      }
      if (predecessor.status === 'failed') {
        working = cascadeFailure(working, minted, predecessor.sequence).state;
      } else if (predecessor.status === 'settled') {
        working = reconcileSettledMintIds(
          working,
          predecessor,
          predecessor.settlement,
        ).state;
      }
      target = working.records[id];
      if (!target || target.status !== 'pending') {
        return {
          state: working,
          result: { status: target?.status ?? 'missing', record: target ?? null },
        };
      }
    }
    if (markDispatched && target.timing?.dispatchedAtMs == null) {
      target = { ...target, timing: { ...target.timing, dispatchedAtMs: now } };
      working = { ...working, records: { ...working.records, [id]: target } };
    }
    return {
      state: working,
      result: {
        status: 'ready',
        record: target,
        fence: authorizationFence(working.authorizationQueue ?? authorizationQueue),
      },
    };
  },
  markAcksReady(state, ids, userId = undefined, authorityDescriptor = undefined) {
    const selected = new Set(ids);
    let changed = 0;
    const acks = state.acks.map((ack) => {
      if (
        !selected.has(ack.id)
        || ack.ready === true
        || !acknowledgementMatches(ack, userId, authorityDescriptor)
      ) return ack;
      changed += 1;
      return { ...ack, ready: true };
    });
    return !changed
      ? { state, result: 0 }
      : { state: { ...state, acks }, result: changed };
  },
  confirmAcks(
    state,
    ids,
    userId = undefined,
    authorityDescriptor = undefined,
    expectedAuthorizationFence = null,
  ) {
    requireCurrentAuthorizationFence(state, expectedAuthorizationFence);
    const requested = new Set(ids);
    const confirmed = new Set(state.acks
      .filter((ack) => (
        requested.has(ack.id)
        && acknowledgementMatches(ack, userId, authorityDescriptor)
      ))
      .map((ack) => ack.id));
    if (!confirmed.size) return { state, result: 0 };
    const acks = state.acks.filter((ack) => !confirmed.has(ack.id));
    const records = { ...state.records };
    for (const id of confirmed) {
      if (records[id]?.status === 'settled') delete records[id];
    }
    return {
      state: { ...state, acks, records },
      result: state.acks.length - acks.length,
    };
  },
};

export const pendingOutboxRecords = (state) => Object.values(state.records)
  .filter((record) => record.status === 'pending')
  .sort(outboxOrder);

/// Records that keep the client on the full-resync/submission-fence path.
/// Result-gone entries are not replayable pending work, but they still block
/// ordered successors until the application explicitly resolves the missing
/// result dependency.
export const unresolvedOutboxRecords = (state) => Object.values(state.records)
  .filter((record) => (
    record.status === 'pending'
    || record.status === 'result-gone'
    || record.status === 'quarantined'
  ))
  .sort(outboxOrder);

export const allOutboxRecords = (state) => Object.values(state.records)
  .sort(outboxOrder)
  .map((record) => record.status === 'quarantined' ? quarantineTombstone(record) : record);

/// Pending acknowledgements for one auth identity: only records matching the
/// current userId are exposed/sent (LLP 0043: returning to the prior user can
/// finish GC without sending their ids under another user).
export const pendingAcknowledgementsFor = (
  state,
  userId,
  limit,
  authorityDescriptor = null,
) => state.acks
  .filter((ack) => (
    acknowledgementMatches(ack, userId ?? null, authorityDescriptor)
    && ack.ready === true
  ))
  .slice(0, limit)
  .map((ack) => ack.id);
