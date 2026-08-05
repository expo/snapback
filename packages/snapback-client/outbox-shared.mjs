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
  (error?.fetchDispatchFailed === true || error instanceof TypeError)
  && error?.name !== 'AbortError'
  && error?.name !== 'TimeoutError'
  && error?.status === undefined
  && error?.diagnostic === undefined
  && error?.receipt === undefined
);

const REPLAY_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const plainRecord = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);
const stringOrNull = (value) => typeof value === 'string' ? value : null;
const authorityInstanceId = (descriptor) => stringOrNull(descriptor?.authorityInstanceId);
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
  return {
    id,
    function: functionName,
    args: record.args ?? {},
    userId: stringOrNull(record.userId),
    readSet: Array.isArray(record.readSet) ? record.readSet : [],
    correlation: record.correlation ?? null,
    // The authority descriptor captured at enqueue (LLP 0043 §Auth posture):
    // replay sends THIS stored descriptor, never a newly observed one.
    authorityDescriptor: record.authorityDescriptor ?? null,
    // The captured replay environment, when one exists (LLP 0008 pins the
    // wire to {generatedIds, now} = the ctx-answer ledger). The plain JS arm
    // runs no local execution, so it usually captures none; a composing
    // layer with derived overlays supplies one.
    ctxLedger: record.ctxLedger ?? null,
    // Generated-artifact call-time binding (LLP 0012 amendment). Replay pins
    // the generation that authored the queued args; it never silently adopts
    // the currently discovered same-named mutation.
    expectedGeneration: record.expectedGeneration ?? null,
    // @ref LLP 0133#the-two-settlement-lanes — mixed queues retain one
    //   immutable policy and claim carrier per sequence-ordered mutation.
    settlementLane,
    settlementIdentity: record.settlementIdentity ?? null,
    settlementClaims: record.settlementClaims ?? null,
    boundedSkew: record.boundedSkew ?? null,
    // Move-3 lane-L intent payload. The durable outbox owns the immutable IR
    // operation; private layers are always recomputed from it and never become
    // a second persistence authority.
    // @ref LLP 0155#rebase — reload replays remaining operations in sequence.
    optimisticOperation,
    // Client-captured wall-clock at enqueue. A labeled claim for receipts
    // and UI (LLP 0129 ledger row 1, decision 10 taxonomy) — never
    // transmitted as authority and never used for ordering.
    capturedNow: Number.isSafeInteger(record.capturedNow) ? record.capturedNow : null,
  };
}

const durableReplayIdentity = (record) => {
  const { capturedNow: _claimOnly, ...identity } = normalizeOutboxRecordInput(record);
  return identity;
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
export const emptyOutboxState = () => ({ sequence: 0, records: {}, acks: [] });

export function validateOutboxState(value) {
  if (
    !plainRecord(value)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !plainRecord(value.records)
    || !Array.isArray(value.acks)
  ) return null;
  return value;
}

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
  .filter((record) => record.status === 'pending')
  .sort(outboxOrder);

export const allOutboxRecords = (state) => Object.values(state.records).sort(outboxOrder);

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
