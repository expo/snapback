// Channel B persisted RQS resume store — web/IndexedDB arm (LLP 0090 rollout
// step 5, ENG-25456). The native/DK-9 arm rides the same entry contract from
// rqs-store-file.mjs; verification, arbitration, and the budget bookkeeping
// helpers below are the shared (store-agnostic) halves.
//
// The store persists the latest verified `{rows, meta, token}` per
// authority-independent subscription so a relaunch can render first and
// subscribe with `resumeFromToken`. Persisted state is untrusted input:
// every consumer verifies entries with `verifyPersistedResumeEntry` (digest
// recompute, fail-closed) before rendering or seeding a token.
//
// @ref LLP 0091#0a5-token-refresh-persistence-cadence-store-budget-and-eviction —
//   one-transaction atomic commits, the in-progress marker, the 32 MiB/256
//   entry budget, and least-recently-resumed eviction with atomic bookkeeping.
// @ref LLP 0090#d3-channel-b--persisted-device-snapshot — single-writer
//   Web-Lock ownership (the lock holder persists; an attaching tab adopts the
//   store's token) and the A-vs-B arbitration rule.

import { argsHash, jcs, rowsMatchDigest } from './rqs.mjs';
import {
  allOutboxRecords,
  emptyOutboxState,
  outboxAuthorizationStatus,
  outboxNotWriterError,
  outboxOps,
  pendingAcknowledgementsFor,
  pendingOutboxRecords,
  unresolvedOutboxRecords,
  validateOutboxState,
} from './outbox-shared.mjs';
import {
  allocateQueryInstanceIdInMeta,
  createInitialStoreMeta,
  mintClientStoreId,
  prepareStoreMeta,
  RQS_STORE_META_KEY,
  wipeStoreMeta,
} from './rqs-store-meta.mjs';

export const RQS_STORE_DATABASE_NAME = 'snapback-rqs-store.v1';
export const RQS_STORE_MAX_BYTES = 32 * 1024 * 1024;
export const RQS_STORE_MAX_ENTRIES = 256;
export const RQS_TOKEN_MAX_BYTES = 1024;
export const RQS_REACT_BINDING_RECEIPT_MAX_BYTES = 64 * 1024;

const OUTBOX_NORMALIZATION_REQUEST = 'snapback.outbox-normalization-request.v1';
const OUTBOX_NORMALIZATION_OUTCOME = 'snapback.outbox-normalization-outcome.v1';
const OUTBOX_NORMALIZATION_TIMEOUT_MS = 5_000;
let outboxNormalizationRequestCounter = 0;

const exactRecord = (value, fields) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).length === fields.length
  && fields.every((field) => Object.hasOwn(value, field))
);

const normalizationChannelName = (databaseName) => (
  `snapback:rqs-store:${databaseName}:outbox-normalization`
);

const defaultBroadcastChannelFactory = () => (
  typeof globalThis.BroadcastChannel === 'function'
    ? (name) => new globalThis.BroadcastChannel(name)
    : null
);

const mintOutboxNormalizationRequestId = () => {
  outboxNormalizationRequestCounter += 1;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${nonce}-${outboxNormalizationRequestCounter.toString(16)}`;
};

const validOutboxNormalizationRequest = (value) => (
  exactRecord(value, ['format', 'requestId'])
  && value.format === OUTBOX_NORMALIZATION_REQUEST
  && typeof value.requestId === 'string'
  && value.requestId.length > 0
  && value.requestId.length <= 128
);

const validOutboxNormalizationOutcome = (value) => (
  exactRecord(value, ['format', 'requestId', 'outcome'])
  && value.format === OUTBOX_NORMALIZATION_OUTCOME
  && typeof value.requestId === 'string'
  && value.requestId.length > 0
  && value.requestId.length <= 128
  && ['committed', 'refused'].includes(value.outcome)
);

const unavailableOutboxProjection = () => Object.freeze({
  availability: 'unavailable',
  reason: 'normalization-pending',
});

const availableOutboxProjection = (state) => Object.freeze({
  availability: 'available',
  state,
});

/// Cross-context request half of the destructive outbox-normalization broker.
/// The exact long-held Web-Lock owner is the only context that acknowledges;
/// callers must still reread durable bytes after a `committed` outcome.
// @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — cross-context requests target the exact writer and acknowledgement precedes a confirming reread.
export async function requestIndexedDbOutboxNormalization({
  databaseName = RQS_STORE_DATABASE_NAME,
  broadcastChannelFactory = undefined,
  timeoutMs = OUTBOX_NORMALIZATION_TIMEOUT_MS,
} = {}) {
  const channelFactory = broadcastChannelFactory === undefined
    ? defaultBroadcastChannelFactory()
    : broadcastChannelFactory;
  if (typeof channelFactory !== 'function') {
    return Object.freeze({ status: 'unavailable', reason: 'channel-unavailable' });
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError('outbox normalization broker timeoutMs must be a non-negative number');
  }

  let channel;
  try {
    channel = channelFactory(normalizationChannelName(databaseName));
  } catch {
    return Object.freeze({ status: 'unavailable', reason: 'channel-unavailable' });
  }
  if (
    channel === null
    || typeof channel !== 'object'
    || typeof channel.postMessage !== 'function'
    || typeof channel.close !== 'function'
  ) {
    try { channel?.close?.(); } catch { /* an invalid carrier is already unavailable */ }
    return Object.freeze({ status: 'unavailable', reason: 'channel-unavailable' });
  }
  channel.unref?.();

  const requestId = mintOutboxNormalizationRequestId();
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      channel.onmessage = null;
      try { channel.close(); } catch { /* completion is already known */ }
      resolve(Object.freeze(outcome));
    };
    channel.onmessage = (event) => {
      const message = event?.data;
      if (!validOutboxNormalizationOutcome(message) || message.requestId !== requestId) return;
      finish(message.outcome === 'committed'
        ? { status: 'committed' }
        : { status: 'unavailable', reason: 'writer-refused' });
    };
    timer = setTimeout(
      () => finish({ status: 'unavailable', reason: 'timeout' }),
      timeoutMs,
    );
    try {
      channel.postMessage({ format: OUTBOX_NORMALIZATION_REQUEST, requestId });
    } catch {
      finish({ status: 'unavailable', reason: 'channel-failed' });
    }
  });
}

const unavailableOutboxInspection = () => Object.freeze({
  pending: 0,
  failed: 0,
  stranded: 0,
  quarantined: 0,
  resultGone: 0,
  pendingAcknowledgements: 0,
});

const ENTRIES = 'entries';
const OUTBOX = 'outbox';
const MATERIALIZATIONS = 'materializations';
const PAGE_SETS = 'pageSets';
const MEMBERSHIPS = 'memberships';
const STORE_META = 'storeMeta';
const RESIDENT_STORES = Object.freeze([
  MATERIALIZATIONS, PAGE_SETS, MEMBERSHIPS, ENTRIES, OUTBOX,
]);
const ALL_STORES = Object.freeze([...RESIDENT_STORES, STORE_META]);
const OUTBOX_STATE_KEY = 'state';
const REACT_BINDING_RECEIPT_KEY = 'reactBindingReceipt';
const REACT_BINDING_RECEIPT_NOT_PERSISTED =
  'SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED';
// @ref LLP 0166#writer-discipline-and-format-versioning — version 3 adds
//   stores without rewriting entries/outbox; IndexedDB's upgrade transaction
//   is the crash-safe migration and older open(..., 2) calls get VersionError.
export const DATABASE_VERSION = 3;

function storeError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

function warnReactBindingReceiptNotPersisted(details) {
  try {
    globalThis.console?.warn?.(
      `${REACT_BINDING_RECEIPT_NOT_PERSISTED}: react binding receipt was not persisted; the next offline cold boot cannot adopt it`,
      details,
    );
  } catch {
    // Environments without a console must not turn best-effort persistence into a failure.
  }
}

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? storeError(
    'SNAPBACK_RQS_STORE_FAILED',
    'IndexedDB request failed',
  ));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? storeError(
    'SNAPBACK_RQS_STORE_FAILED',
    'IndexedDB transaction aborted',
  ));
  transaction.onerror = () => {
    // onabort is the terminal notification and carries the transaction error.
  };
});

const utf8Length = (value) => new TextEncoder().encode(value).length;

/// Validate, bound, and detach the optional React binding-preparation
/// metadata. This record is deliberately separate from the persisted resume
/// entry contract and its budget accounting.
export function prepareReactBindingReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  try {
    const cloned = structuredClone(receipt);
    const serialized = JSON.stringify(cloned);
    if (
      typeof serialized !== 'string'
      || utf8Length(serialized) > RQS_REACT_BINDING_RECEIPT_MAX_BYTES
    ) return null;
    return cloned;
  } catch {
    return null;
  }
}

/// Canonical persisted-entry key for one subscription: query name + JCS args.
/// The key deliberately carries NO authority component — the v1 store holds
/// only authority-independent snapshots, so this is the canonical
/// authority-independent alias key of LLP 0090 D2 applied to Channel B.
/// Returns null when the args cannot canonicalize (nothing to persist).
export function rqsEntryKey(name, args = {}) {
  if (typeof name !== 'string' || name.length === 0) return null;
  try {
    return `${name}\u0000${jcs(args)}`;
  } catch {
    return null;
  }
}

const META_STRING_FIELDS = Object.freeze([
  'app', 'generation', 'versionStream', 'queryArtifact', 'argsHash', 'contentDigest',
]);

/// Fail-closed verification of a persisted (or preloaded) resume entry:
/// structural shape, the in-progress marker, identity coherence against the
/// subscription's own args, and the recomputed content digest. Any refusal
/// means "discard and subscribe fresh" (LLP 0091 §0B.3 T2).
export function verifyPersistedResumeEntry(entry, { args } = {}) {
  const refuse = (reason) => ({ ok: false, reason });
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return refuse('shape');
  // An entry found in-progress at relaunch is an interrupted delta sequence:
  // invalid by contract, regardless of what the digest would say.
  if (entry.inProgress !== false && entry.inProgress !== undefined) return refuse('in_progress');
  if (
    typeof entry.token !== 'string'
    || entry.token.length === 0
    || utf8Length(entry.token) > RQS_TOKEN_MAX_BYTES
  ) return refuse('token');
  const meta = entry.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return refuse('meta');
  for (const field of META_STRING_FIELDS) {
    if (typeof meta[field] !== 'string' || meta[field].length === 0) return refuse('meta');
  }
  if (!Number.isSafeInteger(meta.version) || meta.version < 0) return refuse('meta');
  if (!Array.isArray(entry.rows)) return refuse('rows');
  if (args !== undefined) {
    try {
      if (argsHash(args) !== meta.argsHash) return refuse('identity');
    } catch {
      return refuse('identity');
    }
  }
  if (!rowsMatchDigest(entry.rows, meta.contentDigest)) return refuse('digest');
  return { ok: true, reason: null };
}

/// Channel A vs Channel B arbitration (LLP 0090 D3): both candidates supply
/// the same subscription; the higher `version` within MATCHING token identity
/// (app, generation, versionStream, queryArtifact, argsHash) wins. Any
/// identity mismatch returns null — the caller discards BOTH and subscribes
/// fresh. Callers must have digest-verified each candidate individually
/// before arbitration (verifyPersistedResumeEntry).
export function arbitrateResumeCandidates(a, b) {
  const metaA = a?.resume?.meta;
  const metaB = b?.resume?.meta;
  if (!metaA || !metaB) return null;
  for (const field of ['app', 'generation', 'versionStream', 'queryArtifact', 'argsHash']) {
    if (metaA[field] !== metaB[field]) return null;
  }
  return metaB.version > metaA.version ? b : a;
}

function openDatabase(indexedDB, name, initialMeta) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES);
      // v1 -> v2: adds the outbox store; entries are untouched, and a fresh
      // outbox store is safe (v1 databases held no queue by construction).
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX);
      if (!db.objectStoreNames.contains(MATERIALIZATIONS)) db.createObjectStore(MATERIALIZATIONS);
      if (!db.objectStoreNames.contains(PAGE_SETS)) db.createObjectStore(PAGE_SETS);
      if (!db.objectStoreNames.contains(MEMBERSHIPS)) db.createObjectStore(MEMBERSHIPS);
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META).put(initialMeta, RQS_STORE_META_KEY);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      if (ALL_STORES.some((storeName) => !db.objectStoreNames.contains(storeName))) {
        db.close();
        fail(storeError('SNAPBACK_RQS_STORE_CORRUPT', 'RQS store database is missing its object store'));
        return;
      }
      settled = true;
      resolve(db);
    };
    request.onerror = () => fail(request.error ?? storeError(
      'SNAPBACK_RQS_STORE_FAILED',
      'could not open the RQS store database',
    ));
    request.onblocked = () => fail(storeError(
      'SNAPBACK_RQS_STORE_FAILED',
      'RQS store database upgrade is blocked by another context',
    ));
  });
}

/// Budget accounting for one persisted entry (LLP 0091 §0A.5): serialized
/// `{rows, meta, token}` bytes. Shared by every store arm so the budget
/// fixture measures the same thing everywhere.
export const rqsEntryRecordBytes = (persisted) => utf8Length(JSON.stringify({
  rows: persisted.rows,
  meta: persisted.meta,
  token: persisted.token,
}));

const entryBytes = rqsEntryRecordBytes;

/// Least-recently-resumed ordering (LLP 0091 §0A.5): recency is the last
/// SUCCESSFUL authoritative resume (never bumped by mere writes),
/// never-resumed entries first, savedAt as the tiebreak. Shared across arms.
export const rqsEvictionOrder = (a, b) => (
  (a.resumedAt ?? 0) - (b.resumedAt ?? 0) || (a.savedAt ?? 0) - (b.savedAt ?? 0)
);

const evictionOrder = rqsEvictionOrder;
const authorityTransitionWipersByLockManager = new WeakMap();

/**
 * IndexedDB-backed persisted RQS resume store under the same-origin Web-Lock
 * store discipline (LLP 0008): the exclusive lock holder is the single writer
 * of persisted resume state; every other tab reads (and thereby adopts the
 * store's persisted tokens) but silently skips writes. Lock takeover follows
 * Web Locks release-on-context-loss, so a surviving tab becomes the writer
 * without a timing lease.
 */
export function createIndexedDbRqsResumeStore({
  indexedDB = globalThis.indexedDB,
  lockManager = globalThis.navigator?.locks ?? null,
  databaseName = RQS_STORE_DATABASE_NAME,
  now = () => Date.now(),
  maxBytes = RQS_STORE_MAX_BYTES,
  maxEntries = RQS_STORE_MAX_ENTRIES,
  clientStoreId = null,
  randomBytes = undefined,
  broadcastChannelFactory = undefined,
  outboxNormalizationTimeoutMs = OUTBOX_NORMALIZATION_TIMEOUT_MS,
  onBeforeStoreIdentityRotation = null,
  // LLP 0090 D3 outbox rule hook: a relaunching client with a non-empty
  // mutation outbox must not send resumeFromToken. The raw @expo/snapback-client
  // web path has no relaunch mutation outbox (that machinery is the
  // LLP 0043 contract-layer client store), so the default is structurally
  // "empty"; a composing layer that HAS an outbox injects its check here.
  relaunchOutboxEmpty = null,
} = {}) {
  if (!indexedDB || typeof indexedDB.open !== 'function') {
    throw storeError(
      'SNAPBACK_RQS_STORE_UNAVAILABLE',
      'the RQS resume store requires IndexedDB or an equivalent transactional adapter',
    );
  }
  if (!lockManager || typeof lockManager.request !== 'function') {
    // Same posture as the LLP 0008 localStorage client store: no Web Locks,
    // no cross-context single-writer guarantee, no store.
    throw storeError(
      'SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE',
      'the RQS resume store requires the Web Locks API for single-writer ownership',
    );
  }

  const lockName = `snapback:rqs-store:${databaseName}`;
  let authorityTransitionWipersByLock = authorityTransitionWipersByLockManager.get(lockManager);
  if (authorityTransitionWipersByLock === undefined) {
    authorityTransitionWipersByLock = new Map();
    authorityTransitionWipersByLockManager.set(lockManager, authorityTransitionWipersByLock);
  }
  const authorityTransitionInstance = {};
  let databasePromise = null;
  let closed = false;
  let writer = false;
  let releaseLock = null;
  let pendingReactBindingReceipt = null;
  let pendingOutboxNormalization = false;
  let outboxNormalizationTask = null;
  let initialMeta = createInitialStoreMeta({ clientStoreId, randomBytes });
  let authorityTransitionWipe = null;
  const writerLockListeners = new Set();
  const resolvedBroadcastChannelFactory = broadcastChannelFactory === undefined
    ? defaultBroadcastChannelFactory()
    : broadcastChannelFactory;
  if (
    resolvedBroadcastChannelFactory !== null
    && typeof resolvedBroadcastChannelFactory !== 'function'
  ) {
    throw new TypeError('broadcastChannelFactory must be a function, null, or undefined');
  }
  let outboxNormalizationChannel = null;
  function registerOutboxNormalizationBroker() {
    if (outboxNormalizationChannel !== null || resolvedBroadcastChannelFactory === null) return;
    let channel;
    try {
      channel = resolvedBroadcastChannelFactory(normalizationChannelName(databaseName));
    } catch {
      return;
    }
    if (
      channel === null
      || typeof channel !== 'object'
      || typeof channel.postMessage !== 'function'
      || typeof channel.close !== 'function'
    ) {
      try { channel?.close?.(); } catch { /* invalid broker carrier */ }
      return;
    }
    channel.unref?.();
    channel.onmessage = (event) => {
      const message = event?.data;
      if (!validOutboxNormalizationRequest(message) || !writer || closed) return;
      void requestOutboxNormalization().then((committed) => {
        if (!writer || closed) return;
        channel.postMessage({
          format: OUTBOX_NORMALIZATION_OUTCOME,
          requestId: message.requestId,
          outcome: committed === true ? 'committed' : 'refused',
        });
      }).catch(() => {
        if (!writer || closed) return;
        try {
          channel.postMessage({
            format: OUTBOX_NORMALIZATION_OUTCOME,
            requestId: message.requestId,
            outcome: 'refused',
          });
        } catch { /* a failed broker remains fail-closed */ }
      });
    };
    outboxNormalizationChannel = channel;
  }
  function unregisterOutboxNormalizationBroker() {
    const channel = outboxNormalizationChannel;
    outboxNormalizationChannel = null;
    if (channel === null) return;
    channel.onmessage = null;
    try { channel.close(); } catch { /* close remains best-effort */ }
  }
  const notifyWriterLock = (value) => {
    for (const listener of [...writerLockListeners]) {
      try { listener(value); } catch { /* observation cannot own the lock */ }
    }
  };

  async function flushPendingReactBindingReceipt() {
    const pending = pendingReactBindingReceipt;
    if (pending === null || closed) return;
    try {
      const db = await database();
      const tx = db.transaction([OUTBOX], 'readwrite');
      const txStore = tx.objectStore(OUTBOX);
      const current = prepareReactBindingReceipt(
        await requestResult(txStore.get(REACT_BINDING_RECEIPT_KEY)),
      );
      const currentSavedAt = current?.savedAt;
      const pendingSavedAt = pending.savedAt;
      // A surviving stale tab can still flush after takeover, just as it can
      // resume entry writes; never let an older dated receipt replace a newer one.
      if (!(
        Number.isFinite(currentSavedAt)
        && Number.isFinite(pendingSavedAt)
        && currentSavedAt > pendingSavedAt
      )) {
        txStore.put(pending, REACT_BINDING_RECEIPT_KEY);
      }
      await transactionDone(tx);
    } finally {
      pendingReactBindingReceipt = null;
    }
  }

  // Single long-held exclusive lock: granted -> this context is THE writer
  // until close; otherwise the request waits in the lock queue and ownership
  // transfers when the holder closes or its context dies. close() aborts a
  // still-queued request so a reader can shut down without waiting for the
  // writer to release.
  //
  // Two distinct settling points, deliberately separated (2026-08-07,
  // browser-carrier public witness): the Web Locks request promise resolves
  // only when the CALLBACK'S RETURNED PROMISE settles — for the granted
  // writer that is lock RELEASE at close, not acquisition. `whenLockSettled`
  // consumers (the LLP 0043 M2 outbox drain awaits it before its writer
  // check) need ADJUDICATION: "this context's initial writer-or-reader role
  // is known". Handing them the request promise wedged every browser drain
  // forever — replay was unreachable on the default browser carrier. Node
  // suites missed it because their fake lock managers resolve request() at
  // callback return and the drain is exercised on the file/memory arms.
  const lockAbort = typeof AbortController === 'function' ? new AbortController() : null;
  let adjudicateLock = null;
  const lockAdjudicated = new Promise((resolve) => {
    adjudicateLock = resolve;
  });
  const lockReleased = Promise.resolve(lockManager.request(
    lockName,
    { mode: 'exclusive', ...(lockAbort ? { signal: lockAbort.signal } : {}) },
    () => {
      if (closed) {
        adjudicateLock();
        return undefined;
      }
      writer = true;
      registerOutboxNormalizationBroker();
      authorityTransitionWipersByLock.set(lockName, {
        instance: authorityTransitionInstance,
        request: (...args) => authorityTransitionWipe(...args),
      });
      adjudicateLock();
      notifyWriterLock(true);
      void flushPendingReactBindingReceipt().catch((error) => {
        warnReactBindingReceiptNotPersisted({ error });
      });
      void Promise.resolve().then(() => flushPendingOutboxNormalization()).catch(() => {});
      return new Promise((resolve) => {
        releaseLock = resolve;
      });
    },
  )).catch(() => {}).finally(() => adjudicateLock());
  // Reader adjudication: same-name lock requests are serviced in request
  // order, so this ifAvailable probe runs strictly after the main request is
  // enqueued. `null` means the lock was held at probe time — if this context
  // is not the holder, its initial role is reader, adjudicated without
  // waiting for a takeover grant. (When the main request was granted first,
  // adjudication already happened and this is a no-op.)
  if (lockManager && typeof lockManager.request === 'function') {
    void Promise.resolve(lockManager.request(
      lockName,
      { mode: 'exclusive', ifAvailable: true },
      (probe) => {
        if (probe === null && !writer) adjudicateLock();
      },
    )).catch(() => {});
  }

  const database = () => {
    if (closed) throw storeError('SNAPBACK_RQS_STORE_CLOSED', 'RQS resume store is closed');
    if (!databasePromise) databasePromise = openDatabase(indexedDB, databaseName, initialMeta);
    return databasePromise;
  };

  const readMetaFromStore = async (txStore) => {
    const stored = await requestResult(txStore.get(RQS_STORE_META_KEY));
    const meta = prepareStoreMeta(stored);
    if (meta === null) {
      throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'RQS store metadata is missing or invalid');
    }
    return meta;
  };

  const readAllForBudget = async (txStore) => {
    const [keys, values] = await Promise.all([
      requestResult(txStore.getAllKeys()),
      requestResult(txStore.getAll()),
    ]);
    return keys.map((key, index) => ({
      key,
      bytes: values[index]?.bytes ?? 0,
      resumedAt: values[index]?.resumedAt ?? 0,
      savedAt: values[index]?.savedAt ?? 0,
    }));
  };

  const normalizedOutboxState = (stored) => {
    const state = validateOutboxState(stored);
    if (state === null) return { state: emptyOutboxState(), changed: false };
    let changed = true;
    try {
      changed = JSON.stringify(stored) !== JSON.stringify(state);
    } catch {
      // IndexedDB can clone values JSON cannot encode. A valid outbox state is
      // nevertheless JSON-shaped, so such a record is not durable-normalized.
    }
    return { state, changed };
  };

  // One-record atomic read-modify-write for the outbox section: the whole
  // LLP 0043 M2 state (sequence, records, pending ACKs) commits in a single
  // IndexedDB transaction, mirroring the file arm's atomic blob replace.
  const readOutboxState = async (txStore) => {
    const stored = await requestResult(txStore.get(OUTBOX_STATE_KEY));
    const normalized = normalizedOutboxState(stored);
    if (normalized.changed && txStore.transaction.mode === 'readwrite') {
      txStore.put(normalized.state, OUTBOX_STATE_KEY);
    }
    return normalized;
  };

  const readDurablyNormalizedOutboxState = async () => {
    const db = await database();
    let tx = db.transaction([OUTBOX], 'readonly');
    let normalized = await readOutboxState(tx.objectStore(OUTBOX));
    await transactionDone(tx);
    if (!normalized.changed) {
      pendingOutboxNormalization = false;
      return availableOutboxProjection(normalized.state);
    }

    pendingOutboxNormalization = true;
    let completed = false;
    if (writer && !closed) {
      completed = await requestOutboxNormalization();
    } else if (!closed) {
      const brokered = await requestIndexedDbOutboxNormalization({
        databaseName,
        broadcastChannelFactory: resolvedBroadcastChannelFactory,
        timeoutMs: outboxNormalizationTimeoutMs,
      });
      completed = brokered.status === 'committed';
    }

    if (!completed) return unavailableOutboxProjection();
    // Confirm against durable bytes after the writer's transaction completes;
    // the normalized projection is never trusted merely because a broker said
    // it scheduled work.
    // @ref LLP 0053#dispositions-with-producers-and-meanings — a delete root
    //   destroys predecessor payload in durable custody, not just its return.
    tx = db.transaction([OUTBOX], 'readonly');
    normalized = await readOutboxState(tx.objectStore(OUTBOX));
    await transactionDone(tx);
    pendingOutboxNormalization = normalized.changed;
    if (normalized.changed) return unavailableOutboxProjection();
    return availableOutboxProjection(normalized.state);
  };

  const readOutboxAuthorizationMetadata = async () => {
    const db = await database();
    const tx = db.transaction([OUTBOX], 'readonly');
    const normalized = await readOutboxState(tx.objectStore(OUTBOX));
    await transactionDone(tx);
    if (normalized.changed) {
      pendingOutboxNormalization = true;
      if (writer && !closed) {
        void requestOutboxNormalization().catch(() => {});
      } else if (!closed) {
        void requestIndexedDbOutboxNormalization({
          databaseName,
          broadcastChannelFactory: resolvedBroadcastChannelFactory,
          timeoutMs: outboxNormalizationTimeoutMs,
        }).catch(() => {});
      }
    }
    // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — split projection keeps exact payload-free metadata readable while payload-bearing custody remains blank.
    // The queue is already schema-validated and contains no mutation payload.
    // Its exact authority generation remains observable while the holder owns
    // the separate destructive record rewrite.
    return outboxAuthorizationStatus(normalized.state);
  };

  function requestOutboxNormalization() {
    if (outboxNormalizationTask !== null || closed || !writer) return outboxNormalizationTask;
    const task = (async () => {
      const db = await database();
      const tx = db.transaction([OUTBOX], 'readwrite');
      await readOutboxState(tx.objectStore(OUTBOX));
      await transactionDone(tx);
      pendingOutboxNormalization = false;
      return true;
    })();
    outboxNormalizationTask = task;
    void task.finally(() => {
      if (outboxNormalizationTask === task) outboxNormalizationTask = null;
    }).catch(() => {});
    return task;
  }

  async function flushPendingOutboxNormalization() {
    if (!pendingOutboxNormalization || !writer || closed) return;
    await requestOutboxNormalization();
  }

  const outboxRead = async (reader, unavailable) => {
    const projection = await readDurablyNormalizedOutboxState();
    return projection.availability === 'available'
      ? reader(projection.state)
      : unavailable(projection);
  };

  const outboxWrite = async (
    transition,
    { throwWhenNotWriter = false, authorizationWriter = false } = {},
  ) => {
    if ((!writer && !authorizationWriter) || closed) {
      if (throwWhenNotWriter) throw outboxNotWriterError();
      return false;
    }
    if (authorizationWriter) {
      const projection = await readDurablyNormalizedOutboxState();
      if (projection.availability !== 'available') {
        if (throwWhenNotWriter) throw outboxNotWriterError();
        return false;
      }
    }
    const db = await database();
    const tx = db.transaction([OUTBOX], 'readwrite');
    const txStore = tx.objectStore(OUTBOX);
    const { state } = await readOutboxState(txStore);
    const applied = transition(state);
    if (applied.state !== state) txStore.put(applied.state, OUTBOX_STATE_KEY);
    await transactionDone(tx);
    pendingOutboxNormalization = false;
    return applied.result;
  };

  // @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — legacy
  // entries, outbox, and QMK sections share the adoption commit domain.
  const materializationTransaction = async (mode, operation) => {
    await readDurablyNormalizedOutboxState();
    return import('./materialization-store-runtime.mjs')
      .then(({ indexedDbMaterializationTransaction }) => indexedDbMaterializationTransaction([
        mode,
        operation,
        writer,
        closed,
        database,
        requestResult,
        async (txStore) => {
          const normalized = await readOutboxState(txStore);
          return normalized.changed && txStore.transaction.mode === 'readonly'
            ? null
            : normalized.state;
        },
        readMetaFromStore,
        storeError,
        transactionDone,
      ]));
  };

  authorityTransitionWipe = async (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => {
    if (closed) return false;
    // The external-bearer follower path must install its local predecessor
    // fence and request the elected writer. Keyed coordinator transitions are
    // already inside the shared authorization-dispatch lock and may commit the
    // IndexedDB transaction from either tab.
    if (!writer && authorityTransitionKey === null) return false;
    const db = await database();
    const tx = db.transaction(ALL_STORES, 'readwrite');
    const outboxStore = tx.objectStore(OUTBOX);
    const { state: predecessorOutbox } = await readOutboxState(outboxStore);
    const advanced = outboxOps.advanceAuthorizationAuthority(
      predecessorOutbox,
      authorityTransitionKey,
      authorityTransitionEpoch,
      options,
    );
    if (advanced.result.status === 'authority-current') {
      await transactionDone(tx);
      return true;
    }
    pendingReactBindingReceipt = null;
    const nextMeta = wipeStoreMeta(
      await readMetaFromStore(tx.objectStore(STORE_META)),
      { randomBytes },
    );
    if (nextMeta === null) {
      tx.abort();
      throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'RQS store metadata is invalid');
    }
    for (const storeName of RESIDENT_STORES) {
      if (storeName !== OUTBOX) tx.objectStore(storeName).clear();
    }
    outboxStore.put(advanced.state, OUTBOX_STATE_KEY);
    outboxStore.delete(REACT_BINDING_RECEIPT_KEY);
    tx.objectStore(STORE_META).put(nextMeta, RQS_STORE_META_KEY);
    await transactionDone(tx);
    return true;
  };

  return {
    isWriter() {
      return writer && !closed;
    },

    /// Initial writer-or-reader adjudication (never the release promise: a
    /// granted writer's Web Locks request promise resolves only at close).
    whenLockSettled() {
      return lockAdjudicated;
    },

    /// A short, cross-tab gate shared by authorization-root installation,
    /// authority advance/reconciliation, and mutation transport. IndexedDB
    /// serializes each state commit; this lock extends the cut across prepare
    /// -> fetch -> settlement so a reader tab's root or transition cannot race
    /// between those stages.
    async withOutboxAuthorizationDispatch(operation) {
      if (closed) throw storeError('SNAPBACK_RQS_STORE_CLOSED', 'RQS resume store is closed');
      return lockManager.request(
        `${lockName}:authorization-dispatch`,
        { mode: 'exclusive' },
        operation,
      );
    },

    // @ref LLP 0218#43-the-platform-owned-drain — a queued Web Lock grant
    //   wakes the durable drain after this context transitions reader→writer.
    subscribeWriterLock(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribeWriterLock requires a listener function');
      }
      writerLockListeners.add(listener);
      return () => writerLockListeners.delete(listener);
    },

    /// Degradation-mode capability fact (DK-9: capability reports name the
    /// store implementation and degradation mode in force).
    durability() {
      return { implementation: 'indexeddb', durable: true };
    },

    // Internal v3 semantic seam: callers receive detached section maps and
    // must complete synchronously so IndexedDB cannot auto-close mid-CAS.
    materializationTransaction,

    /// LLP 0090 D3 outbox rule input: false whenever this arm's own durable
    /// queue holds pending intent (or a composing layer's injected check
    /// says so). An unreadable outbox reads as non-empty — fail closed to
    /// the full-resync path, never to token resume over an unknown queue.
    async outboxEmpty() {
      if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
      try {
        return await outboxRead(
          (state) => unresolvedOutboxRecords(state).length === 0
            && outboxAuthorizationStatus(state).suspended === false,
          () => false,
        );
      } catch {
        return false;
      }
    },

    // ---- LLP 0043 M2 outbox (LLP 0129 Phase 0, web arm) ----

    async outboxEnqueue(record, expectedAuthorizationFence = null) {
      return outboxWrite(
        (state) => outboxOps.enqueue(state, record, now(), expectedAuthorizationFence),
        { throwWhenNotWriter: true },
      );
    },

    async outboxAuthorizationStatus() {
      return readOutboxAuthorizationMetadata();
    },

    async outboxAuthorizationTransitionVisible(
      kind,
      payload,
      expectedAuthorityGeneration = null,
    ) {
      return outboxRead(
        (state) => outboxOps.authorizationTransitionVisible(
          state,
          kind,
          payload,
          expectedAuthorityGeneration,
        ).result,
        () => false,
      );
    },

    async outboxApplyAuthorizationObligation(obligation, expectedAuthorityGeneration = null) {
      return outboxWrite(
        (state) => outboxOps.applyAuthorizationObligation(
          state,
          obligation,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, authorizationWriter: true },
      );
    },

    async outboxResolveAuthorizationObligation(resolution, expectedAuthorityGeneration = null) {
      return outboxWrite(
        (state) => outboxOps.resolveAuthorizationObligation(
          state,
          resolution,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, authorizationWriter: true },
      );
    },

    async outboxAcknowledgeAuthorizationResolution(
      resolution,
      expectedAuthorityGeneration = null,
    ) {
      return outboxWrite(
        (state) => outboxOps.acknowledgeAuthorizationResolution(
          state,
          resolution,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, authorizationWriter: true },
      );
    },

    async outboxRetireAuthorizationScopes(scopes, expectedAuthorityGeneration = null) {
      return outboxWrite(
        (state) => outboxOps.retireAuthorizationScopes(
          state,
          scopes,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, authorizationWriter: true },
      );
    },

    async outboxEnqueueWithOperationIdentity(
      record,
      authorityCohortKey,
      range = null,
      expectedAuthorizationFence = null,
    ) {
      return outboxWrite(
        (state) => outboxOps.enqueueWithOperationIdentity(
          state,
          record,
          now(),
          authorityCohortKey,
          range,
          expectedAuthorizationFence,
        ),
        { throwWhenNotWriter: true },
      );
    },

    async outboxAssignOperationIdentity(
      id,
      authorityCohortKey,
      range = null,
      authorityDescriptor = undefined,
      authorityPrincipalId = undefined,
      expectedAuthorizationFence = null,
    ) {
      return outboxWrite((state) => outboxOps.assignOperationIdentity(
        state,
        id,
        now(),
        authorityCohortKey,
        range,
        authorityDescriptor,
        authorityPrincipalId,
        expectedAuthorizationFence,
      ));
    },

    async outboxOperationIdentityRange(authorityCohortKey) {
      return outboxRead(
        (state) => outboxOps.operationIdentityRange(state, authorityCohortKey).result,
        () => null,
      );
    },

    async outboxPending() {
      return outboxRead(pendingOutboxRecords, () => []);
    },

    async outboxPrepareSubmission(id, options = undefined) {
      return outboxWrite((state) => outboxOps.prepareSubmission(state, id, options));
    },

    async outboxRecords() {
      return outboxRead(allOutboxRecords, () => []);
    },

    async outboxSettle(id, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.settle(state, id, expectedAuthorizationFence));
    },

    async outboxDurablyConsume(
      id,
      settlement,
      userId = null,
      confirmedAcknowledgements = [],
      expectedAuthorizationFence = null,
    ) {
      return outboxWrite(
        (state) => outboxOps.durablyConsume(
          state,
          id,
          settlement,
          userId,
          now(),
          confirmedAcknowledgements,
          expectedAuthorizationFence,
        ),
      );
    },

    async outboxMarkFailed(id, failure, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.markFailed(
        state,
        id,
        failure,
        expectedAuthorizationFence,
      ));
    },

    async outboxMarkStranded(
      id,
      reason,
      predecessorPrincipalScope = null,
      expectedAuthorizationFence = null,
      effectProvenance = null,
    ) {
      return outboxWrite((state) => outboxOps.markStranded(
        state,
        id,
        reason,
        now(),
        predecessorPrincipalScope,
        expectedAuthorizationFence,
        effectProvenance,
      ));
    },

    async outboxReconcileCustody(
      principalScope,
      authorityDescriptor,
      custody,
      expectedAuthorityGeneration = null,
    ) {
      return outboxWrite(
        (state) => outboxOps.reconcileCustody(
          state,
          principalScope,
          authorityDescriptor,
          custody,
          now(),
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, authorizationWriter: true },
      );
    },

    async outboxDiscardStranded(ids, principalScope, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.discardStranded(
        state,
        ids,
        principalScope,
        expectedAuthorizationFence,
      ));
    },

    async outboxMarkQuarantined(id, refusal, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.markQuarantined(
        state,
        id,
        refusal,
        now(),
        expectedAuthorizationFence,
      ));
    },

    async outboxReenterQuarantined(expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.reenterQuarantined(
        state,
        expectedAuthorizationFence,
      ));
    },

    async outboxMarkResultGone(id, resultGone, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.markResultGone(
        state,
        id,
        resultGone,
        expectedAuthorizationFence,
      ));
    },

    async outboxDiscard(id, expectedAuthorizationFence = null) {
      return outboxWrite((state) => outboxOps.discard(state, id, expectedAuthorizationFence));
    },

    async outboxDiscardPendingInsertion(
      id,
      insertionSequence,
      expectedAuthorizationFence = null,
    ) {
      return outboxWrite((state) => outboxOps.discardPendingInsertion(
        state,
        id,
        insertionSequence,
        expectedAuthorizationFence,
      ));
    },

    async outboxRecordAcknowledgement(id, userId = null, authorityDescriptor = null) {
      return outboxWrite(
        (state) => outboxOps.recordAck(state, id, userId, authorityDescriptor),
      );
    },

    async outboxPendingAcknowledgements(userId = null, limit = 64, authorityDescriptor = null) {
      return outboxRead(
        (state) => pendingAcknowledgementsFor(state, userId, limit, authorityDescriptor),
        () => [],
      );
    },

    async outboxMarkAcknowledgementsReady(ids, userId = undefined, authorityDescriptor = undefined) {
      return outboxWrite(
        (state) => outboxOps.markAcksReady(state, ids, userId, authorityDescriptor),
      );
    },

    async outboxConfirmAcknowledgements(
      ids,
      userId = undefined,
      authorityDescriptor = undefined,
      expectedAuthorizationFence = null,
    ) {
      return outboxWrite(
        (state) => outboxOps.confirmAcks(
          state,
          ids,
          userId,
          authorityDescriptor,
          expectedAuthorizationFence,
        ),
      );
    },

    /// Optional offline React binding-preparation metadata. It rides the
    /// outbox object store under its own reserved key so entry enumeration,
    /// verification, budget, eviction, and inspection never observe it.
    async loadReactBindingReceipt() {
      const db = await database();
      const tx = db.transaction([OUTBOX], 'readonly');
      const stored = await requestResult(tx.objectStore(OUTBOX).get(REACT_BINDING_RECEIPT_KEY));
      await transactionDone(tx);
      return stored === undefined ? null : prepareReactBindingReceipt(stored);
    },

    async commitReactBindingReceipt(receipt) {
      const stored = prepareReactBindingReceipt(receipt);
      if (stored === null) return false;
      if (closed) return false;
      // @ref LLP 0114#offline-binding-receipt-dated-amendment-2026-08-01 —
      // boot-time persistence waits in instance custody until Web Locks elects
      // this context, without delaying availability-only binding preparation.
      if (!this.isWriter()) {
        pendingReactBindingReceipt = stored;
        return 'deferred';
      }
      const db = await database();
      const tx = db.transaction([OUTBOX], 'readwrite');
      tx.objectStore(OUTBOX).put(stored, REACT_BINDING_RECEIPT_KEY);
      await transactionDone(tx);
      return true;
    },

    async readStoreMeta() {
      const db = await database();
      const tx = db.transaction([STORE_META], 'readonly');
      const meta = await readMetaFromStore(tx.objectStore(STORE_META));
      await transactionDone(tx);
      return meta;
    },

    async writeStoreMeta(value) {
      if (!this.isWriter()) return false;
      const replacement = prepareStoreMeta(value);
      if (replacement === null) {
        throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'refusing invalid RQS store metadata');
      }
      const db = await database();
      const tx = db.transaction([STORE_META], 'readwrite');
      const txStore = tx.objectStore(STORE_META);
      const current = await readMetaFromStore(txStore);
      if (
        replacement.clientStoreId !== current.clientStoreId
        || replacement.queryInstanceIdHighWater < current.queryInstanceIdHighWater
        || [
          'writerGeneration',
          'authorityGenerationHighWater',
          'queryGenerationHighWater',
        ].some((field) => (
          replacement.generationCounters[field] < current.generationCounters[field]
        ))
      ) {
        tx.abort();
        throw storeError(
          'SNAPBACK_RQS_STORE_META_REGRESSION',
          'store metadata cannot rotate identity or lower monotone high-waters',
        );
      }
      txStore.put(replacement, RQS_STORE_META_KEY);
      await transactionDone(tx);
      return true;
    },

    async allocateQueryInstanceId() {
      if (!this.isWriter()) return null;
      const db = await database();
      const tx = db.transaction([STORE_META], 'readwrite');
      const txStore = tx.objectStore(STORE_META);
      const allocated = allocateQueryInstanceIdInMeta(await readMetaFromStore(txStore));
      if (allocated === null) {
        tx.abort();
        throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'RQS store metadata is invalid');
      }
      txStore.put(allocated.meta, RQS_STORE_META_KEY);
      await transactionDone(tx);
      return allocated.queryInstanceId;
    },

    /// Read one persisted entry (any tab — reading is how a second tab adopts
    /// the store's token). Returns the raw record; callers MUST verify with
    /// verifyPersistedResumeEntry before trusting it.
    async load(key) {
      if (typeof key !== 'string' || key.length === 0) return null;
      const db = await database();
      const tx = db.transaction([ENTRIES], 'readonly');
      const record = await requestResult(tx.objectStore(ENTRIES).get(key));
      await transactionDone(tx);
      return record === undefined ? null : record;
    },

    /// Atomic commit of `{rows, meta, token}` in ONE transaction, clearing
    /// the in-progress marker, preserving resume recency, and enforcing the
    /// budget with least-recently-resumed eviction in the same transaction.
    /// Writer-only: a non-holder returns { persisted: false } untouched.
    async commit(key, { rows, meta, token }) {
      if (!this.isWriter()) return { persisted: false, reason: 'not_writer' };
      if (typeof key !== 'string' || key.length === 0) return { persisted: false, reason: 'key' };
      const bytes = entryBytes({ rows, meta, token });
      const db = await database();
      if (bytes > maxBytes) {
        // A single over-budget entry can never be stored; drop any stale
        // predecessor so relaunch fails closed to a fresh subscribe.
        const tx = db.transaction([ENTRIES], 'readwrite');
        tx.objectStore(ENTRIES).delete(key);
        await transactionDone(tx);
        return { persisted: false, reason: 'oversize' };
      }
      const tx = db.transaction([ENTRIES], 'readwrite');
      const txStore = tx.objectStore(ENTRIES);
      const existing = await requestResult(txStore.get(key));
      const record = {
        rows,
        meta,
        token,
        bytes,
        savedAt: now(),
        resumedAt: existing?.resumedAt ?? 0,
        inProgress: false,
      };
      txStore.put(record, key);
      // Budget enforcement rides the same transaction (atomic bookkeeping).
      const all = (await readAllForBudget(txStore))
        .filter((candidate) => candidate.key !== key);
      let totalBytes = bytes + all.reduce((sum, candidate) => sum + candidate.bytes, 0);
      let totalEntries = all.length + 1;
      const evictable = [...all].sort(evictionOrder);
      const evicted = [];
      while ((totalBytes > maxBytes || totalEntries > maxEntries) && evictable.length > 0) {
        const victim = evictable.shift();
        txStore.delete(victim.key);
        totalBytes -= victim.bytes;
        totalEntries -= 1;
        evicted.push(victim.key);
      }
      await transactionDone(tx);
      return { persisted: true, reason: null, bytes, evicted };
    },

    /// Mark an entry in-progress before applying a delta sequence to the held
    /// rows; a crash before the next commit leaves the marker set and the
    /// relaunch verifier refuses the entry (LLP 0091 §0A.5).
    async markInProgress(key) {
      if (!this.isWriter()) return false;
      const db = await database();
      const tx = db.transaction([ENTRIES], 'readwrite');
      const txStore = tx.objectStore(ENTRIES);
      const existing = await requestResult(txStore.get(key));
      if (existing !== undefined) txStore.put({ ...existing, inProgress: true }, key);
      await transactionDone(tx);
      return existing !== undefined;
    },

    /// Record a successful authoritative resume for eviction recency, updated
    /// atomically with the entry (never invents an entry).
    async markResumed(key, at = now()) {
      if (!this.isWriter()) return false;
      const db = await database();
      const tx = db.transaction([ENTRIES], 'readwrite');
      const txStore = tx.objectStore(ENTRIES);
      const existing = await requestResult(txStore.get(key));
      if (existing !== undefined) txStore.put({ ...existing, resumedAt: at }, key);
      await transactionDone(tx);
      return existing !== undefined;
    },

    /// Invalidate one persisted entry (digest mismatch, purge on
    /// clear_retained/AuthorizationInvalidation, eligibility loss).
    async remove(key) {
      if (!this.isWriter()) return false;
      const db = await database();
      const tx = db.transaction([ENTRIES], 'readwrite');
      tx.objectStore(ENTRIES).delete(key);
      await transactionDone(tx);
      return true;
    },

    /// The client-wide identity-barrier projection. The five resident
    /// sections and selected metadata slots clear in one transaction; owner
    /// high-waters survive and the local-row handle key rotates.
    async wipe() {
      pendingReactBindingReceipt = null;
      if (!this.isWriter()) return false;
      const db = await database();
      const tx = db.transaction(ALL_STORES, 'readwrite');
      const nextMeta = wipeStoreMeta(
        await readMetaFromStore(tx.objectStore(STORE_META)),
        { randomBytes },
      );
      if (nextMeta === null) {
        tx.abort();
        throw storeError('SNAPBACK_RQS_STORE_CORRUPT', 'RQS store metadata is invalid');
      }
      for (const storeName of RESIDENT_STORES) tx.objectStore(storeName).clear();
      tx.objectStore(STORE_META).put(nextMeta, RQS_STORE_META_KEY);
      await transactionDone(tx);
      return true;
    },

    wipeForAuthorityTransition: authorityTransitionWipe,

    requestAuthorityTransitionWipe(...args) {
      if (closed) return null;
      const owner = authorityTransitionWipersByLock.get(lockName);
      if (!owner || typeof owner.request !== 'function') return null;
      return Object.freeze({
        settlement: Promise.resolve().then(() => owner.request(...args)),
      });
    },

    /// Caller-authorized recovery for a database whose metadata/schema cannot
    /// be interpreted. The hook is the LLP 0059 participant integration cut;
    /// this carrier consumes its authorization and does not implement it.
    async resetCorruptStoreIdentity() {
      if (!this.isWriter()) return { reset: false, reason: 'not_writer' };
      let previousClientStoreId = clientStoreId;
      try {
        previousClientStoreId = (await this.readStoreMeta()).clientStoreId;
        return { reset: false, reason: 'not_corrupt' };
      } catch { /* unreadable is the operation's intended input */ }
      pendingReactBindingReceipt = null;
      const nextClientStoreId = mintClientStoreId(randomBytes);
      await onBeforeStoreIdentityRotation?.({
        carrier: 'indexeddb',
        databaseName,
        previousClientStoreId,
        nextClientStoreId,
      });
      if (databasePromise) {
        try { (await databasePromise).close(); } catch { /* broken handle */ }
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? storeError(
          'SNAPBACK_RQS_STORE_FAILED',
          'could not destroy corrupt RQS database',
        ));
        request.onblocked = () => reject(storeError(
          'SNAPBACK_RQS_STORE_FAILED',
          'corrupt RQS database reset is blocked by another context',
        ));
      });
      initialMeta = createInitialStoreMeta({ clientStoreId: nextClientStoreId, randomBytes });
      databasePromise = null;
      await database();
      return { reset: true, previousClientStoreId, clientStoreId: nextClientStoreId };
    },

    async inspection() {
      const outboxProjection = await readDurablyNormalizedOutboxState();
      const db = await database();
      const tx = db.transaction([ENTRIES], 'readonly');
      const all = await readAllForBudget(tx.objectStore(ENTRIES));
      await transactionDone(tx);
      return Object.freeze({
        writer: this.isWriter(),
        entries: all.length,
        bytes: all.reduce((sum, candidate) => sum + candidate.bytes, 0),
        maxBytes,
        maxEntries,
        outbox: outboxProjection.availability !== 'available'
          ? unavailableOutboxInspection()
          : Object.freeze({
            pending: pendingOutboxRecords(outboxProjection.state).length,
            failed: allOutboxRecords(outboxProjection.state)
              .filter((r) => r.status === 'failed').length,
            stranded: allOutboxRecords(outboxProjection.state)
              .filter((r) => r.status === 'stranded').length,
            quarantined: allOutboxRecords(outboxProjection.state)
              .filter((r) => r.status === 'quarantined').length,
            resultGone: allOutboxRecords(outboxProjection.state)
              .filter((r) => r.status === 'result-gone').length,
            pendingAcknowledgements: outboxProjection.state.acks.length,
          }),
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      pendingReactBindingReceipt = null;
      const wasWriter = releaseLock !== null;
      unregisterOutboxNormalizationBroker();
      releaseLock?.();
      releaseLock = null;
      writer = false;
      if (
        authorityTransitionWipersByLock.get(lockName)?.instance
          === authorityTransitionInstance
      ) authorityTransitionWipersByLock.delete(lockName);
      notifyWriterLock(false);
      writerLockListeners.clear();
      if (wasWriter) await lockReleased;
      else lockAbort?.abort();
      if (databasePromise) {
        try {
          (await databasePromise).close();
        } catch {
          // Closing a broken database handle is best-effort.
        }
      }
    },
  };
}
