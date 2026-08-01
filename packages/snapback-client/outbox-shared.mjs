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
const CONNECTIVITY_EXCLUDED_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
export const isConnectivityFailureError = (error) => (
  (error?.fetchDispatchFailed === true || error instanceof TypeError)
  && !CONNECTIVITY_EXCLUDED_ERROR_NAMES.has(error?.name)
  && error?.status === undefined
  && error?.diagnostic === undefined
  && error?.receipt === undefined
);

const REPLAY_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function outboxError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

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

export const outboxOversizeError = (bytes) => outboxError(
  'SNAPBACK_OUTBOX_RECORD_OVERSIZE',
  `serialized outbox record is ${bytes} bytes (max ${OUTBOX_MAX_RECORD_BYTES})`,
);

const utf8Length = (value) => new TextEncoder().encode(value).length;

/// Validate + normalize one enqueue input into the stored record shape.
/// `sequence`, `enqueuedAt`, and `status` are store-assigned, never caller
/// input. Throws typed SNAPBACK_OUTBOX_RECORD_INVALID on a bad shape.
export function normalizeOutboxRecordInput(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw outboxError('SNAPBACK_OUTBOX_RECORD_INVALID', 'outbox record must be an object');
  }
  const { id, function: functionName } = record;
  if (typeof id !== 'string' || !REPLAY_OPAQUE_ID.test(id)) {
    throw outboxError(
      'SNAPBACK_OUTBOX_RECORD_INVALID',
      'outbox record id must match the opaque replay-id alphabet (LLP 0043)',
    );
  }
  if (typeof functionName !== 'string' || functionName.length === 0) {
    throw outboxError('SNAPBACK_OUTBOX_RECORD_INVALID', 'outbox record needs a function name');
  }
  return {
    id,
    function: functionName,
    args: record.args ?? {},
    userId: typeof record.userId === 'string' ? record.userId : null,
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
    // Client-captured wall-clock at enqueue. A labeled claim for receipts
    // and UI (LLP 0129 ledger row 1, decision 10 taxonomy) — never
    // transmitted as authority and never used for ordering.
    capturedNow: Number.isSafeInteger(record.capturedNow) ? record.capturedNow : null,
  };
}

/// Serialized-size guard shared by every arm.
export function outboxRecordBytes(stored) {
  return utf8Length(JSON.stringify(stored));
}

/// Ordering rule: the client-local monotonic sequence, never a wall clock.
export const outboxOrder = (a, b) => a.sequence - b.sequence;

/// Shared state-shape helpers for arms that hold the outbox as one JSON
/// section ({ sequence, records: {id -> record}, acks: [{id, userId}] }).
export const emptyOutboxState = () => ({ sequence: 0, records: {}, acks: [] });

export function validateOutboxState(value) {
  if (
    !value || typeof value !== 'object' || Array.isArray(value)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)
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
      // Idempotent re-enqueue of the same durable identity (retry after an
      // ambiguous enqueue) returns the existing record unchanged.
      return { state, result: state.records[normalized.id] };
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
    return {
      state: { ...state, records: { ...state.records, [id]: stored } },
      result: true,
    };
  },
  discard(state, id) {
    return outboxOps.settle(state, id);
  },
  recordAck(state, id, userId) {
    if (state.acks.some((ack) => ack.id === id)) return { state, result: false };
    const acks = [...state.acks, { id, userId: typeof userId === 'string' ? userId : null }];
    // ACK obligations are GC proofs; at the bound the oldest is dropped —
    // the server's admin purge is the recovery for a leaked settled result.
    while (acks.length > OUTBOX_MAX_PENDING_ACKS) acks.shift();
    return { state: { ...state, acks }, result: true };
  },
  confirmAcks(state, ids) {
    const confirmed = new Set(ids);
    const acks = state.acks.filter((ack) => !confirmed.has(ack.id));
    if (acks.length === state.acks.length) return { state, result: 0 };
    return { state: { ...state, acks }, result: state.acks.length - acks.length };
  },
};

export const pendingOutboxRecords = (state) => Object.values(state.records)
  .filter((record) => record.status === 'pending')
  .sort(outboxOrder);

export const allOutboxRecords = (state) => Object.values(state.records).sort(outboxOrder);

/// Pending acknowledgements for one auth identity: only records matching the
/// current userId are exposed/sent (LLP 0043: returning to the prior user can
/// finish GC without sending their ids under another user).
export const pendingAcknowledgementsFor = (state, userId, limit) => state.acks
  .filter((ack) => ack.userId === (typeof userId === 'string' ? userId : null))
  .slice(0, limit)
  .map((ack) => ack.id);
