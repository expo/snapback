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
  let databasePromise = null;
  let closed = false;
  let writer = false;
  let releaseLock = null;
  let pendingReactBindingReceipt = null;
  let initialMeta = createInitialStoreMeta({ clientStoreId, randomBytes });
  const writerLockListeners = new Set();
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
      adjudicateLock();
      notifyWriterLock(true);
      void flushPendingReactBindingReceipt().catch((error) => {
        warnReactBindingReceiptNotPersisted({ error });
      });
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

  // One-record atomic read-modify-write for the outbox section: the whole
  // LLP 0043 M2 state (sequence, records, pending ACKs) commits in a single
  // IndexedDB transaction, mirroring the file arm's atomic blob replace.
  const readOutboxState = async (txStore) => {
    const stored = await requestResult(txStore.get(OUTBOX_STATE_KEY));
    return validateOutboxState(stored) ?? emptyOutboxState();
  };

  const outboxRead = async (reader) => {
    const db = await database();
    const tx = db.transaction([OUTBOX], 'readonly');
    const state = await readOutboxState(tx.objectStore(OUTBOX));
    await transactionDone(tx);
    return reader(state);
  };

  const outboxWrite = async (transition, { throwWhenNotWriter = false } = {}) => {
    if (!writer || closed) {
      if (throwWhenNotWriter) throw outboxNotWriterError();
      return false;
    }
    const db = await database();
    const tx = db.transaction([OUTBOX], 'readwrite');
    const txStore = tx.objectStore(OUTBOX);
    const state = await readOutboxState(txStore);
    const applied = transition(state);
    if (applied.state !== state) txStore.put(applied.state, OUTBOX_STATE_KEY);
    await transactionDone(tx);
    return applied.result;
  };

  // @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — legacy
  // entries, outbox, and QMK sections share the adoption commit domain.
  const materializationTransaction = (mode, operation) => import(
    './materialization-store-runtime.mjs'
  ).then(({ indexedDbMaterializationTransaction }) => indexedDbMaterializationTransaction([
    mode, operation, writer, closed, database, requestResult, readOutboxState,
    readMetaFromStore, storeError, transactionDone,
  ]));

  return {
    isWriter() {
      return writer && !closed;
    },

    /// Initial writer-or-reader adjudication (never the release promise: a
    /// granted writer's Web Locks request promise resolves only at close).
    whenLockSettled() {
      return lockAdjudicated;
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
        return await outboxRead((state) => unresolvedOutboxRecords(state).length === 0);
      } catch {
        return false;
      }
    },

    // ---- LLP 0043 M2 outbox (LLP 0129 Phase 0, web arm) ----

    async outboxEnqueue(record) {
      return outboxWrite(
        (state) => outboxOps.enqueue(state, record, now()),
        { throwWhenNotWriter: true },
      );
    },

    async outboxMarkDispatchPossiblyCrossed(id) {
      return outboxWrite((state) => outboxOps.markDispatchPossiblyCrossed(state, id));
    },

    async outboxEnqueueWithOperationIdentity(record, authorityCohortKey, range = null) {
      return outboxWrite(
        (state) => outboxOps.enqueueWithOperationIdentity(
          state,
          record,
          now(),
          authorityCohortKey,
          range,
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
    ) {
      return outboxWrite((state) => outboxOps.assignOperationIdentity(
        state,
        id,
        now(),
        authorityCohortKey,
        range,
        authorityDescriptor,
        authorityPrincipalId,
      ));
    },

    async outboxOperationIdentityRange(authorityCohortKey) {
      return outboxRead((state) => outboxOps.operationIdentityRange(
        state,
        authorityCohortKey,
      ).result);
    },

    async outboxPending() {
      return outboxRead((state) => pendingOutboxRecords(state));
    },

    async outboxPrepareSubmission(id) {
      return outboxWrite((state) => outboxOps.prepareSubmission(state, id));
    },

    async outboxRecords() {
      return outboxRead((state) => allOutboxRecords(state));
    },

    async outboxSettle(id) {
      return outboxWrite((state) => outboxOps.settle(state, id));
    },

    async outboxDurablyConsume(id, settlement, userId = null, confirmedAcknowledgements = []) {
      return outboxWrite(
        (state) => outboxOps.durablyConsume(
          state,
          id,
          settlement,
          userId,
          now(),
          confirmedAcknowledgements,
        ),
      );
    },

    async outboxMarkFailed(id, failure) {
      return outboxWrite((state) => outboxOps.markFailed(state, id, failure));
    },

    async outboxMarkStranded(id, reason, predecessorPrincipalScope = null) {
      return outboxWrite((state) => outboxOps.markStranded(
        state,
        id,
        reason,
        now(),
        predecessorPrincipalScope,
      ));
    },

    async outboxReconcileCustody(principalScope, authorityDescriptor, custody) {
      return outboxWrite((state) => outboxOps.reconcileCustody(
        state,
        principalScope,
        authorityDescriptor,
        custody,
        now(),
      ));
    },

    async outboxDiscardStranded(ids, principalScope) {
      return outboxWrite((state) => outboxOps.discardStranded(
        state,
        ids,
        principalScope,
      ));
    },

    async outboxMarkQuarantined(id, refusal) {
      return outboxWrite((state) => outboxOps.markQuarantined(state, id, refusal, now()));
    },

    async outboxReenterQuarantined() {
      return outboxWrite((state) => outboxOps.reenterQuarantined(state));
    },

    async outboxMarkResultGone(id, resultGone) {
      return outboxWrite((state) => outboxOps.markResultGone(state, id, resultGone));
    },

    async outboxDiscard(id) {
      return outboxWrite((state) => outboxOps.discard(state, id));
    },

    async outboxRecordAcknowledgement(id, userId = null, authorityDescriptor = null) {
      return outboxWrite(
        (state) => outboxOps.recordAck(state, id, userId, authorityDescriptor),
      );
    },

    async outboxPendingAcknowledgements(userId = null, limit = 64, authorityDescriptor = null) {
      return outboxRead(
        (state) => pendingAcknowledgementsFor(state, userId, limit, authorityDescriptor),
      );
    },

    async outboxMarkAcknowledgementsReady(ids, userId = undefined, authorityDescriptor = undefined) {
      return outboxWrite(
        (state) => outboxOps.markAcksReady(state, ids, userId, authorityDescriptor),
      );
    },

    async outboxConfirmAcknowledgements(ids, userId = undefined, authorityDescriptor = undefined) {
      return outboxWrite(
        (state) => outboxOps.confirmAcks(state, ids, userId, authorityDescriptor),
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

    async wipeForAuthorityTransition() {
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
      for (const storeName of RESIDENT_STORES) {
        if (storeName !== OUTBOX) tx.objectStore(storeName).clear();
      }
      tx.objectStore(OUTBOX).delete(REACT_BINDING_RECEIPT_KEY);
      tx.objectStore(STORE_META).put(nextMeta, RQS_STORE_META_KEY);
      await transactionDone(tx);
      return true;
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
      const db = await database();
      const tx = db.transaction([ENTRIES, OUTBOX], 'readonly');
      const all = await readAllForBudget(tx.objectStore(ENTRIES));
      const outboxState = await readOutboxState(tx.objectStore(OUTBOX));
      await transactionDone(tx);
      return Object.freeze({
        writer: this.isWriter(),
        entries: all.length,
        bytes: all.reduce((sum, candidate) => sum + candidate.bytes, 0),
        maxBytes,
        maxEntries,
        outbox: Object.freeze({
          pending: pendingOutboxRecords(outboxState).length,
          failed: allOutboxRecords(outboxState).filter((r) => r.status === 'failed').length,
          stranded: allOutboxRecords(outboxState)
            .filter((r) => r.status === 'stranded').length,
          quarantined: allOutboxRecords(outboxState)
            .filter((r) => r.status === 'quarantined').length,
          resultGone: allOutboxRecords(outboxState)
            .filter((r) => r.status === 'result-gone').length,
          pendingAcknowledgements: outboxState.acks.length,
        }),
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      pendingReactBindingReceipt = null;
      const wasWriter = releaseLock !== null;
      releaseLock?.();
      releaseLock = null;
      writer = false;
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
