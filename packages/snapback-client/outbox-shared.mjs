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

/// Refusal bounds: exactly-once wins over opportunistic eviction (LLP 0043).
/// At the cap the store refuses a new record rather than evicting a pending
/// one. Values sized for a client-held queue, not the server ledger.
export const OUTBOX_MAX_RECORDS = 1024;
export const OUTBOX_MAX_RECORD_BYTES = 262_144; // 256 KiB serialized
export const OUTBOX_MAX_PENDING_ACKS = 4096;
export const OUTBOX_QUARANTINE_TOMBSTONE_FORMAT = 'snapback.outbox-quarantine-tombstone.v1';

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
  { bytes, maxBytes: OUTBOX_MAX_RECORD_BYTES },
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
  let argsContract = null;
  let argumentSchema = null;
  let dataTransaction = null;
  try {
    if (record.argsContract != null) {
      argsContract = JSON.parse(canonicalizeClientValueV1(record.argsContract));
    }
    if (record.argumentSchema != null) {
      argumentSchema = JSON.parse(canonicalizeClientValueV1(record.argumentSchema));
    }
    if (record.dataTransaction != null) {
      dataTransaction = JSON.parse(canonicalizeClientValueV1(record.dataTransaction));
    }
  } catch {
    throw invalidOutboxRecord(
      'outbox generated argument contracts must be finite canonical client values',
    );
  }
  const dataCustodyClass = record.dataCustodyClass ?? null;
  if (
    dataCustodyClass !== null
    && dataCustodyClass !== 'queue-eligible'
    && dataCustodyClass !== 'online-only'
  ) throw invalidOutboxRecord('data custody class must be queue-eligible or online-only');
  const dispatchBoundary = dataCustodyClass === 'online-only'
    ? (record.dispatchBoundary ?? 'not-crossed')
    : null;
  if (
    dispatchBoundary !== null
    && dispatchBoundary !== 'not-crossed'
    && dispatchBoundary !== 'possibly-crossed'
  ) throw invalidOutboxRecord('online-only data observation has an invalid dispatch boundary');
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
    ...(dataTransaction === null ? {} : { dataTransaction }),
    dataCustodyClass,
    dataCustodyReason: typeof record.dataCustodyReason === 'string'
      ? record.dataCustodyReason
      : null,
    replayable: dataCustodyClass !== 'online-only',
    dispatchBoundary,
    // Client-captured wall-clock at enqueue. A labeled claim for receipts
    // and UI (LLP 0129 ledger row 1, decision 10 taxonomy) — never
    // transmitted as authority and never used for ordering.
    capturedNow: Number.isSafeInteger(record.capturedNow) ? record.capturedNow : null,
  };
}

const durableReplayIdentity = (record) => {
  const { capturedNow: _claimOnly, authorityDescriptor, ...identity } = (
    normalizeOutboxRecordInput(record)
  );
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
  return new TextEncoder().encode(JSON.stringify(stored)).length;
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

const rewriteStringLeaves = (value, replacements) => {
  if (typeof value === 'string') return replacements.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => rewriteStringLeaves(item, replacements));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      rewriteStringLeaves(item, replacements),
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

// Resolve only ids attested by this client's own mint ledger. Receipt entries
// outside that ledger do not gain rewrite authority, and every ambiguity is
// treated as unmapped. Lane Q needs no rewrite because replay-accept preserves
// the speculative ids themselves.
//
// @ref LLP 0133#divergence-on-settle — leaf rewrite is claim-ledger scoped;
//   missing, duplicate, conflicting, or colliding map entries fail closed.
const settlementIdResolution = (record, settlement) => {
  if (record?.settlementLane !== 're-derive') {
    return { replacements: new Map(), unresolved: new Set() };
  }
  const claimedMints = settlementMints(record);
  const claimed = settlementMintIds(record);
  const claimCounts = new Map();
  for (const id of claimed) claimCounts.set(id, (claimCounts.get(id) ?? 0) + 1);
  const claimById = new Map(claimedMints
    .filter((mint) => typeof mint?.claimed === 'string')
    .map((mint) => [mint.claimed, mint]));
  const entries = new Map();
  const receipt = settlement?.receipt?.kind === 'mutation'
    ? settlement.receipt
    : settlement?.kind === 'mutation' ? settlement : null;
  const receiptMap = receipt?.idMap;
  for (const entry of Array.isArray(receiptMap) ? receiptMap : []) {
    if (!claimCounts.has(entry?.speculative)) continue;
    const candidates = entries.get(entry.speculative) ?? [];
    candidates.push(entry);
    entries.set(entry.speculative, candidates);
  }
  const replacements = new Map();
  const unresolved = new Set();
  const authoritativeOwners = new Map();
  for (const [speculative, count] of claimCounts) {
    const candidates = entries.get(speculative) ?? [];
    const entry = candidates.length === 1 ? candidates[0] : null;
    const claim = claimById.get(speculative);
    if (
      count !== 1
      || entry?.disposition !== 'mapped'
      || typeof entry?.authoritative !== 'string'
      || entry?.site !== claim?.site
      || entry?.occurrence !== claim?.occurrence
    ) {
      unresolved.add(speculative);
      continue;
    }
    const prior = authoritativeOwners.get(entry.authoritative);
    if (prior !== undefined && prior !== speculative) {
      unresolved.add(prior);
      unresolved.add(speculative);
      replacements.delete(prior);
      continue;
    }
    authoritativeOwners.set(entry.authoritative, speculative);
    replacements.set(speculative, entry.authoritative);
  }
  return { replacements, unresolved };
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
});

const reconcileSettledMintIds = (state, record, settlement) => {
  const { replacements, unresolved } = settlementIdResolution(record, settlement);
  let records = state.records;
  if (replacements.size) {
    records = { ...records };
    for (const candidate of Object.values(records)) {
      if (candidate.status !== 'pending' || candidate.sequence <= record.sequence) continue;
      const args = rewriteStringLeaves(candidate.args, replacements);
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
});

export function validateOutboxState(value) {
  if (
    !plainRecord(value)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !plainRecord(value.records)
    || !Array.isArray(value.acks)
  ) return null;
  return {
    ...value,
    operationIdentityRanges: value.operationIdentityRanges
      && typeof value.operationIdentityRanges === 'object'
      && !Array.isArray(value.operationIdentityRanges)
      ? value.operationIdentityRanges
      : {},
  };
}

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
  enqueue(state, input, now) {
    const normalized = normalizeOutboxRecordInput(input);
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
      return { state, result: existing };
    }
    if (Object.keys(state.records).length >= OUTBOX_MAX_RECORDS) throw outboxFullError();
    const stored = {
      ...normalized,
      sequence: state.sequence + 1,
      enqueuedAt: now,
      status: 'pending',
      failure: null,
    };
    const bytes = outboxRecordBytes(stored);
    if (bytes > OUTBOX_MAX_RECORD_BYTES) throw outboxOversizeError(bytes);
    return {
      state: {
        ...state,
        sequence: stored.sequence,
        records: { ...state.records, [stored.id]: stored },
      },
      result: stored,
    };
  },
  /// Atomically records the only ambiguous boundary for a non-replayable data
  /// intent. The record is already durable at `not-crossed`; after this cut a
  /// crash cannot prove non-acceptance and recovery must consult settlement.
  // @ref LLP 0255#s32-proposed-pending-llp-0218-and-llp-0043-amendment--declared-custody-and-ambiguous-online-intents
  markDispatchPossiblyCrossed(state, id) {
    const existing = state.records[id];
    if (!existing || existing.status !== 'pending') return { state, result: false };
    if (existing.dataCustodyClass !== 'online-only' || existing.replayable !== false) {
      throw invalidOutboxRecord('only a non-replayable data observation may cross this boundary');
    }
    if (existing.dispatchBoundary === 'possibly-crossed') {
      return { state, result: existing };
    }
    if (existing.dispatchBoundary !== 'not-crossed') {
      throw invalidOutboxRecord('non-replayable data observation has no valid boundary');
    }
    const stored = { ...existing, dispatchBoundary: 'possibly-crossed' };
    if (outboxRecordBytes(stored) > OUTBOX_MAX_RECORD_BYTES) {
      throw outboxOversizeError(outboxRecordBytes(stored));
    }
    return {
      state: { ...state, records: { ...state.records, [id]: stored } },
      result: stored,
    };
  },
  /// Atomically install a server response (when present), consume one finite
  /// counter, and persist the queued intent. With no available counter the
  /// intent is retained explicitly uncovered and MUST be assigned before
  /// transport admission.
  enqueueWithOperationIdentity(state, input, now, authorityCohortKey, range = null) {
    const key = custodyKey(authorityCohortKey);
    const existing = state.records[input?.id];
    if (existing) {
      return outboxOps.enqueue(state, {
        ...input,
        operationIssuance: input.operationIssuance ?? existing.operationIssuance,
        operationCoverageDisposition:
          input.operationCoverageDisposition ?? existing.operationCoverageDisposition,
      }, now);
    }
    let working = range === null ? state : installRange(state, key, range);
    const allocated = allocateIdentity(working, key, now);
    working = allocated.state;
    return outboxOps.enqueue(working, {
      ...input,
      operationIssuance: allocated.issuance,
      operationCoverageDisposition: allocated.disposition,
    }, now);
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
  ) {
    const key = custodyKey(authorityCohortKey);
    let working = range === null ? state : installRange(state, key, range);
    const existing = working.records[id];
    if (!existing || existing.status !== 'pending') {
      return { state: working, result: existing ?? null };
    }
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
  settle(state, id) {
    if (!state.records[id]) return { state, result: false };
    const records = { ...state.records };
    delete records[id];
    return { state: { ...state, records }, result: true };
  },
  markFailed(state, id, failure) {
    const existing = state.records[id];
    if (!existing || existing.status !== 'pending') return { state, result: false };
    const stored = {
      ...existing,
      status: 'failed',
      failure: {
        code: typeof failure?.code === 'string' ? failure.code : 'SNAPBACK_OUTBOX_REPLAY_FAILED',
        message: typeof failure?.message === 'string' ? failure.message : String(failure ?? ''),
      },
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
  markStranded(state, id, reason, now, predecessorPrincipalScope = null) {
    const existing = state.records[id];
    if (!existing) return { state, result: false };
    if (existing.status === 'stranded') return { state, result: existing };
    if (existing.status !== 'pending' && existing.status !== 'failed') {
      return { state, result: false };
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
    };
    return {
      state: { ...state, records: { ...state.records, [id]: stored } },
      result: stored,
    };
  },
  /// Reconcile every fenced queue record in one store transaction before the
  /// current authority observes it. Same-principal instance changes strand;
  /// any principal-axis change is a privacy deletion boundary.
  ///
  /// @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — strand-on-instance-change;
  ///   delete-with-diagnostic-count at a cross-principal boundary.
  reconcileCustody(state, principalScope, authorityDescriptor, custody, now) {
    const currentScope = normalizePrincipalScope(principalScope);
    const currentCustody = normalizeCustody(custody);
    const currentInstance = authorityInstanceId(authorityDescriptor);
    if (currentScope === null || currentCustody === null || currentInstance === null) {
      throw invalidOutboxRecord('queue custody reconciliation requires a settled authority');
    }
    let working = state;
    const deletedIds = [];
    const strandedIds = [];
    for (const record of Object.values(state.records).sort(outboxOrder)) {
      if (!isFencedRecord(record)) {
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
      if (agentPrincipalChanged || !samePrincipalScope(record.principalScope, currentScope)) {
        // Every fenced disposition belongs to the predecessor principal.
        // This includes settled records, whose args, settlement claims, and
        // result remain payload-bearing until their acknowledgement is
        // confirmed, plus any future terminal disposition added here.
        deletedIds.push(record.id);
        continue;
      }
      if (
        authorityInstanceId(record.authorityDescriptor) !== currentInstance
        && (record.status === 'pending' || record.status === 'failed')
      ) {
        const applied = outboxOps.markStranded(
          working,
          record.id,
          'authority_instance_changed',
          now,
          record.principalScope,
        );
        working = applied.state;
        if (applied.result) strandedIds.push(record.id);
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
  discardStranded(state, ids, principalScope) {
    const currentScope = normalizePrincipalScope(principalScope);
    if (currentScope === null) {
      throw invalidOutboxRecord('stranded discard requires a settled principal scope');
    }
    const selected = new Set(Array.isArray(ids) ? ids : []);
    const records = { ...state.records };
    const discardedIds = [];
    for (const record of Object.values(records).sort(outboxOrder)) {
      if (
        record.status !== 'stranded'
        || !selected.has(record.id)
        || record.rerecordable !== true
        || !samePrincipalScope(record.predecessorPrincipalScope, currentScope)
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
  markQuarantined(state, id, refusal, now) {
    const trigger = state.records[id];
    if (!trigger || trigger.status !== 'pending') return { state, result: false };
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
  reenterQuarantined(state) {
    const records = { ...state.records };
    const ids = [];
    for (const existing of Object.values(records).sort(outboxOrder)) {
      if (existing.status !== 'quarantined') continue;
      const { quarantine: _quarantine, ...record } = existing;
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
  markResultGone(state, id, resultGone) {
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
  discard(state, id) {
    return outboxOps.settle(state, id);
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
  durablyConsume(state, id, settlement, userId, now, confirmedAcknowledgements = []) {
    // A successful mutation response proves its piggyback ACK stage too.
    // Retire those obligations in this same transaction so an ACK-full store
    // can make room without a crash gap before retaining the new settlement.
    const afterConfirmed = outboxOps.confirmAcks(state, confirmedAcknowledgements).state;
    const existing = afterConfirmed.records[id];
    if (!existing) return { state, result: false };
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
  prepareSubmission(state, id) {
    let working = state;
    let target = working.records[id];
    if (!target || target.status !== 'pending') {
      return {
        state: working,
        result: { status: target?.status ?? 'missing', record: target ?? null },
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
    return { state: working, result: { status: 'ready', record: target } };
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
  confirmAcks(state, ids, userId = undefined, authorityDescriptor = undefined) {
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
  .filter((record) => record.status === 'pending' && record.replayable !== false)
  .sort(outboxOrder);

/// Records that keep the client on the full-resync/submission-fence path.
/// Result-gone entries are not replayable pending work, but they still block
/// ordered successors until the application explicitly resolves the missing
/// result dependency.
export const unresolvedOutboxRecords = (state) => Object.values(state.records)
  .filter((record) => (
    (record.status === 'pending' && record.replayable !== false)
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
