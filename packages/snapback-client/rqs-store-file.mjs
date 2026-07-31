// Channel B persisted RQS resume store — native/DK-9 file arm (LLP 0090
// rollout step 5, ENG-25456).
//
// The native half of the step-5 store: the same persisted-entry contract the
// web/IndexedDB arm exposes (`load`/`commit`/`markInProgress`/`markResumed`/
// `remove`/`wipe`/`outboxEmpty`/`inspection`/`close`, consumed store-
// agnostically by index.mjs), backed by durable local files on the native
// side of the Hermes/Ibex boundary. LLP 0090 D3 sanctions "SQLite or files"
// for this arm; this is the file-backed reference implementation, and a
// SQLite backing can replace the injected `files` adapter without changing
// the observable contract (LLP 0008 DK-9).
//
// DK-9 discipline carried over verbatim:
// - Every operation is serialized through one in-process mutex (the native
//   analogue of the single-connection SQLite mutex — a correctness
//   requirement, not an optimization).
// - Single-writer ownership replaces the web arm's Web-Lock role with an
//   exclusively created on-disk lock file plus a same-process registry. A
//   holder is stale only on a *liveness* verdict (dead pid, our own pid
//   without an in-process registration, unreadable lock) — never on a
//   timing lease. A live foreign holder demotes this instance to a reader
//   that adopts persisted tokens and silently skips writes, exactly like a
//   non-holding tab on web; ownership is re-attempted on every operation so
//   a reader becomes the writer once the holder closes or dies.
// - Commits are atomic: the whole store blob is rewritten to a temp file and
//   renamed over the old one, so `{rows, meta, token}`, the in-progress
//   marker, recency bookkeeping, and budget eviction land as one unit.
// - Corruption fails closed and never becomes empty success: an unparseable
//   or future-format blob is preserved byte-for-byte in place, reads raise
//   `SNAPBACK_RQS_STORE_CORRUPT`, writes refuse, and only `wipe()` — the
//   caller-authorized reset (user switch, app reset) — replaces the bytes.
//
// Per-identity keying (LLP 0090 D3): each identity gets its own blob file so
// the v2 auth-scoped door inherits a correct layout; v1 entries are all
// authority-independent and `wipe()` clears EVERY identity's blob (LLP 0053
// user-switch wipe semantics).
//
// At-rest posture (LLP 0090 Q4, open): the v1 baseline is OS-level
// protection — the platform app container and platform disk encryption.
// This store adds no encryption of its own; Q4 owns anything stronger.
//
// @ref LLP 0090#d3-channel-b--persisted-device-snapshot — the native store
//   rides the DK-9 store-agnostic interface rather than a parallel artifact,
//   inheriting its corruption/fail-closed posture; durable local storage on
//   the native side of the Hermes/Ibex boundary.
// @ref LLP 0091#dated-amendment-step-5-native-persistence-knobs-2026-07-25-eng-25456 —
//   native cadence/budget pinned to the web values; constrained
//   widget/extension processes never construct a writer.

import { hex, sha256 } from './rqs.mjs';
import {
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
  rqsEntryRecordBytes,
  rqsEvictionOrder,
} from './rqs-store.mjs';
import {
  allOutboxRecords,
  emptyOutboxState,
  outboxNotWriterError,
  outboxOps,
  pendingAcknowledgementsFor,
  pendingOutboxRecords,
  validateOutboxState,
} from './outbox-shared.mjs';

// v1 held `{ format, entries }`. v2 adds the LLP 0043 M2 outbox section
// (`{ format, entries, outbox }` — LLP 0129 Phase 0). A v1 blob migrates in
// place (entries preserved, empty outbox: v1 had no queue by construction).
// A v2 blob read by v1 code is a future format there and fails closed with
// bytes preserved — a downgrade can never load the queue as empty and
// overwrite the only copy (LLP 0008 DK-9).
export const RQS_FILE_STORE_FORMAT_V1 = 'snapback-rqs-store-file.v1';
export const RQS_FILE_STORE_FORMAT = 'snapback-rqs-store-file.v2';
const BLOB_PREFIX = 'rqs-';
const BLOB_SUFFIX = '.v1.json';
const LOCK_SUFFIX = '.v1.lock';
const BLOB_FILE_PATTERN = /^rqs-[A-Za-z0-9_-]+\.v1\.json$/;
const TMP_MARKER = '.tmp-';

function storeError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const corruptError = (path) => storeError(
  'SNAPBACK_RQS_STORE_CORRUPT',
  'persisted RQS store bytes are unreadable or from an unknown format; '
    + 'original bytes were left untouched (explicit wipe() is the only reset)',
  { path },
);

/// Default files adapter: Node-compatible hosts (`node:fs` loaded lazily so
/// bundling this module for a Hermes/React Native host — which injects its
/// own adapter over the platform filesystem — never resolves the builtin).
// Process-exit lock hygiene (module-level so N store instances share ONE
// exit listener): a normal process exit unlinks still-held lock files so
// short-lived clients (tests, CLIs) do not strew stale locks — a crashed
// process still relies on the dead-pid staleness verdict instead.
const exitLockCleanup = { paths: new Set(), unlinkSync: null, hooked: false };

export function createNodeFilesAdapter() {
  let fsPromise = null;
  const fs = () => {
    fsPromise ??= import('node:fs').then((mod) => {
      exitLockCleanup.unlinkSync ??= mod.unlinkSync;
      return mod.promises;
    });
    return fsPromise;
  };
  const missing = (error) => error?.code === 'ENOENT';
  return {
    trackLockForExitCleanup(path) {
      exitLockCleanup.paths.add(path);
      if (!exitLockCleanup.hooked && typeof globalThis.process?.on === 'function') {
        exitLockCleanup.hooked = true;
        globalThis.process.on('exit', () => {
          for (const lockPath of exitLockCleanup.paths) {
            try {
              exitLockCleanup.unlinkSync?.(lockPath);
            } catch { /* stale-pid reclaim covers what exit cleanup cannot */ }
          }
        });
      }
    },
    untrackLockForExitCleanup(path) {
      exitLockCleanup.paths.delete(path);
    },
    async mkdir(path) {
      await (await fs()).mkdir(path, { recursive: true });
    },
    async readFile(path) {
      try {
        return await (await fs()).readFile(path, 'utf8');
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async writeFile(path, data) {
      // `flush: true` (durability past the page cache) where the Node
      // runtime supports it; older runtimes ignore the extra option.
      await (await fs()).writeFile(path, data, { encoding: 'utf8', flush: true });
    },
    async writeFileExclusive(path, data) {
      try {
        await (await fs()).writeFile(path, data, { encoding: 'utf8', flag: 'wx', flush: true });
        return true;
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
      }
    },
    async rename(from, to) {
      await (await fs()).rename(from, to);
    },
    async unlink(path) {
      try {
        await (await fs()).unlink(path);
        return true;
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    },
    async readdir(path) {
      try {
        return await (await fs()).readdir(path);
      } catch (error) {
        if (missing(error)) return [];
        throw error;
      }
    },
    processId() {
      return globalThis.process?.pid ?? 0;
    },
    processAlive(pid) {
      const kill = globalThis.process?.kill;
      if (typeof kill !== 'function') return true; // cannot probe: assume live (fail closed to reader)
      try {
        kill.call(globalThis.process, pid, 0);
        return true;
      } catch (error) {
        return error?.code === 'EPERM';
      }
    },
  };
}

const REQUIRED_ADAPTER_METHODS = [
  'mkdir', 'readFile', 'writeFile', 'writeFileExclusive', 'rename', 'unlink',
  'readdir', 'processId', 'processAlive',
];

// Same-process single-writer registry: two store instances in one process on
// the same lock path must not both claim the writer role (the on-disk pid
// check alone cannot tell them apart).
const heldLocks = new Map();

let instanceCounter = 0;

const identitySlug = (identity) => {
  if (identity === null || identity === undefined) return 'anonymous';
  return `id-${hex(sha256(new TextEncoder().encode(String(identity)))).slice(0, 32)}`;
};

/**
 * Durable file-backed persisted RQS resume store for native/Node hosts.
 * Same observable contract as `createIndexedDbRqsResumeStore`.
 */
export function createFileRqsResumeStore({
  directory,
  files = createNodeFilesAdapter(),
  identity = null,
  now = () => Date.now(),
  maxBytes = RQS_STORE_MAX_BYTES,
  maxEntries = RQS_STORE_MAX_ENTRIES,
  // LLP 0090 D3 outbox rule hook — identical to the web store: the raw
  // client has no relaunch mutation outbox, so the default is structurally
  // "empty"; a composing layer that HAS one injects its check here.
  relaunchOutboxEmpty = null,
} = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw storeError(
      'SNAPBACK_RQS_STORE_UNAVAILABLE',
      'the file RQS resume store requires a durable directory path',
    );
  }
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof files?.[method] !== 'function') {
      throw storeError(
        'SNAPBACK_RQS_STORE_UNAVAILABLE',
        `the file RQS resume store requires a files adapter with ${method}()`,
      );
    }
  }

  const slug = identitySlug(identity);
  const sep = directory.endsWith('/') ? '' : '/';
  const blobPath = `${directory}${sep}${BLOB_PREFIX}${slug}${BLOB_SUFFIX}`;
  const lockPath = `${directory}${sep}${BLOB_PREFIX}${slug}${LOCK_SUFFIX}`;
  instanceCounter += 1;
  const instanceId = `${files.processId()}-${instanceCounter}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpPath = `${blobPath}${TMP_MARKER}${instanceId}`;

  let closed = false;
  let writer = false;
  let corrupt = false;

  // DK-9 single-connection mutex analogue: one promise chain serializes every
  // operation, including lock acquisition.
  let chain = Promise.resolve();
  const serialized = (operation) => {
    const result = chain.then(operation);
    chain = result.then(() => {}, () => {});
    return result;
  };

  const acquireLock = async () => {
    if (writer || closed) return;
    await files.mkdir(directory);
    if (heldLocks.has(lockPath)) return; // live sibling instance in this process
    const payload = JSON.stringify({
      pid: files.processId(),
      instanceId,
      acquiredAt: now(),
    });
    const granted = () => {
      writer = true;
      heldLocks.set(lockPath, instanceId);
      files.trackLockForExitCleanup?.(lockPath);
    };
    if (await files.writeFileExclusive(lockPath, payload)) {
      granted();
      return;
    }
    const raw = await files.readFile(lockPath);
    if (raw !== null) {
      let holder = null;
      try {
        holder = JSON.parse(raw);
      } catch {
        holder = null;
      }
      const holderPid = Number.isSafeInteger(holder?.pid) ? holder.pid : null;
      // Liveness, never a timing lease (LLP 0008 DK-9): a readable lock from
      // a live foreign process keeps us a reader; anything else is stale.
      const stale = holderPid === null
        || holderPid === files.processId() // our pid, not registered here: a crashed predecessor's leftover
        || files.processAlive(holderPid) !== true;
      if (!stale) return;
      await files.unlink(lockPath);
    }
    if (await files.writeFileExclusive(lockPath, payload)) granted();
  };

  // Eager first acquisition so `isWriter()` has settled by the time the
  // client's first debounced persist checks it.
  const initialAcquisition = serialized(acquireLock).catch(() => {});

  const readState = async () => {
    if (corrupt) throw corruptError(blobPath);
    const raw = await files.readFile(blobPath);
    if (raw === null) return { entries: {}, outbox: emptyOutboxState() };
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const entriesValid = parsed !== null
      && typeof parsed === 'object'
      && parsed.entries !== null
      && typeof parsed.entries === 'object'
      && !Array.isArray(parsed.entries);
    if (entriesValid && parsed.format === RQS_FILE_STORE_FORMAT_V1) {
      // In-place v1 migration: entries preserved, empty outbox (v1 stores
      // held no queue, so nothing can be silently dropped).
      return { entries: parsed.entries, outbox: emptyOutboxState() };
    }
    const outboxValid = entriesValid && validateOutboxState(parsed.outbox) !== null;
    if (!entriesValid || parsed.format !== RQS_FILE_STORE_FORMAT || !outboxValid) {
      // Unparseable bytes and future/unknown formats are the same verdict:
      // preserve in place, refuse reads and writes until an explicit wipe.
      corrupt = true;
      throw corruptError(blobPath);
    }
    return { entries: parsed.entries, outbox: parsed.outbox };
  };

  // Atomic replace: temp write + rename lands the entry, its bookkeeping,
  // and any evictions as one unit.
  const writeState = async (state) => {
    await files.mkdir(directory);
    await files.writeFile(tmpPath, JSON.stringify({
      format: RQS_FILE_STORE_FORMAT,
      entries: state.entries,
      outbox: validateOutboxState(state.outbox) ?? emptyOutboxState(),
    }));
    await files.rename(tmpPath, blobPath);
  };

  // Writer-gated outbox transition committed atomically with the whole blob
  // (the DK-9 transaction analogue). Enqueue throws on a non-writer; the
  // other transitions report false, matching the entry methods' posture.
  const outboxWrite = async (transition, { throwWhenNotWriter = false } = {}) => {
    await acquireLock();
    if (!writer) {
      if (throwWhenNotWriter) throw outboxNotWriterError();
      return { skipped: true, result: false };
    }
    const state = await readState();
    const applied = transition(state.outbox);
    if (applied.state !== state.outbox) {
      await writeState({ ...state, outbox: applied.state });
    }
    return { skipped: false, result: applied.result };
  };

  const requireOpen = () => {
    if (closed) throw storeError('SNAPBACK_RQS_STORE_CLOSED', 'RQS resume store is closed');
  };

  return {
    isWriter() {
      return writer && !closed;
    },

    /// Settles (and, unlike web's queued lock, re-attempts) ownership: a
    /// reader whose holder has since closed or died becomes the writer here.
    whenLockSettled() {
      return serialized(acquireLock).catch(() => {});
    },

    /// Degradation-mode capability fact (DK-9: capability reports name the
    /// store implementation and degradation mode in force).
    durability() {
      return { implementation: 'file', durable: true };
    },

    /// LLP 0090 D3 outbox rule input: false whenever this arm's own durable
    /// queue holds pending intent (or a composing layer's injected check
    /// says so). A corrupt blob reads as non-empty — fail closed to the
    /// full-resync path, never to token resume over an unknown queue.
    async outboxEmpty() {
      requireOpen();
      if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
      return serialized(async () => {
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        return pendingOutboxRecords(state.outbox).length === 0;
      });
    },

    // ---- LLP 0043 M2 outbox (LLP 0129 Phase 0, JS/node arm) ----

    async outboxEnqueue(record) {
      requireOpen();
      return serialized(async () => {
        const { result } = await outboxWrite(
          (outbox) => outboxOps.enqueue(outbox, record, now()),
          { throwWhenNotWriter: true },
        );
        return result;
      });
    },

    async outboxPending() {
      requireOpen();
      return serialized(async () => pendingOutboxRecords((await readState()).outbox));
    },

    async outboxRecords() {
      requireOpen();
      return serialized(async () => allOutboxRecords((await readState()).outbox));
    },

    async outboxSettle(id) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.settle(outbox, id),
      )).result);
    },

    async outboxMarkFailed(id, failure) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markFailed(outbox, id, failure),
      )).result);
    },

    async outboxDiscard(id) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.discard(outbox, id),
      )).result);
    },

    async outboxRecordAcknowledgement(id, userId = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.recordAck(outbox, id, userId),
      )).result);
    },

    async outboxPendingAcknowledgements(userId = null, limit = 64) {
      requireOpen();
      return serialized(async () => pendingAcknowledgementsFor(
        (await readState()).outbox,
        userId,
        limit,
      ));
    },

    async outboxConfirmAcknowledgements(ids) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.confirmAcks(outbox, ids),
      )).result);
    },

    /// Read one persisted entry (reader or writer — reading is how a second
    /// context adopts the store's token). Callers MUST verify with
    /// verifyPersistedResumeEntry before trusting the record.
    async load(key) {
      if (typeof key !== 'string' || key.length === 0) return null;
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        const state = await readState();
        const record = state.entries[key];
        return record === undefined ? null : record;
      });
    },

    /// Atomic commit of `{rows, meta, token}`, clearing the in-progress
    /// marker, preserving resume recency, and enforcing the budget with
    /// least-recently-resumed eviction in the same on-disk replace.
    /// Writer-only; a corrupt store refuses (wipe() is the reset).
    async commit(key, { rows, meta, token }) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return { persisted: false, reason: 'not_writer' };
        if (typeof key !== 'string' || key.length === 0) return { persisted: false, reason: 'key' };
        if (corrupt) return { persisted: false, reason: 'corrupt' };
        const bytes = rqsEntryRecordBytes({ rows, meta, token });
        let state;
        try {
          state = await readState();
        } catch {
          return { persisted: false, reason: 'corrupt' };
        }
        if (bytes > maxBytes) {
          // A single over-budget entry can never be stored; drop any stale
          // predecessor so relaunch fails closed to a fresh subscribe.
          if (state.entries[key] !== undefined) {
            delete state.entries[key];
            await writeState(state);
          }
          return { persisted: false, reason: 'oversize' };
        }
        const existing = state.entries[key];
        state.entries[key] = {
          rows,
          meta,
          token,
          bytes,
          savedAt: now(),
          resumedAt: existing?.resumedAt ?? 0,
          inProgress: false,
        };
        const others = Object.entries(state.entries)
          .filter(([candidateKey]) => candidateKey !== key)
          .map(([candidateKey, record]) => ({
            key: candidateKey,
            bytes: record?.bytes ?? 0,
            resumedAt: record?.resumedAt ?? 0,
            savedAt: record?.savedAt ?? 0,
          }))
          .sort(rqsEvictionOrder);
        let totalBytes = bytes + others.reduce((sum, candidate) => sum + candidate.bytes, 0);
        let totalEntries = others.length + 1;
        const evicted = [];
        while ((totalBytes > maxBytes || totalEntries > maxEntries) && others.length > 0) {
          const victim = others.shift();
          delete state.entries[victim.key];
          totalBytes -= victim.bytes;
          totalEntries -= 1;
          evicted.push(victim.key);
        }
        await writeState(state);
        return { persisted: true, reason: null, bytes, evicted };
      });
    },

    /// Mark an entry in-progress before applying a delta sequence; a crash
    /// before the clearing commit leaves the marker set and the relaunch
    /// verifier refuses the entry (LLP 0091 §0A.5).
    async markInProgress(key) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        const existing = state.entries[key];
        if (existing === undefined) return false;
        state.entries[key] = { ...existing, inProgress: true };
        await writeState(state);
        return true;
      });
    },

    /// Record a successful authoritative resume for eviction recency,
    /// updated atomically with the entry (never invents an entry).
    async markResumed(key, at = now()) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        const existing = state.entries[key];
        if (existing === undefined) return false;
        state.entries[key] = { ...existing, resumedAt: at };
        await writeState(state);
        return true;
      });
    },

    /// Invalidate one persisted entry (digest mismatch, purge on
    /// clear_retained/AuthorizationInvalidation, eligibility loss).
    async remove(key) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        if (state.entries[key] !== undefined) {
          delete state.entries[key];
          await writeState(state);
        }
        return true;
      });
    },

    /// User-switch wipe (LLP 0053 wipe semantics): clears EVERY identity's
    /// persisted blob, and doubles as the DK-9 caller-authorized reset that
    /// replaces corrupt bytes.
    async wipe() {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        const names = await files.readdir(directory);
        for (const name of names) {
          if (BLOB_FILE_PATTERN.test(name) || name.includes(TMP_MARKER)) {
            try {
              await files.unlink(`${directory}${sep}${name}`);
            } catch {
              // Best-effort per file; the wipe itself must not throw for
              // an already-gone sibling.
            }
          }
        }
        corrupt = false;
        return true;
      });
    },

    async inspection() {
      requireOpen();
      return serialized(async () => {
        let state = null;
        try {
          state = await readState();
        } catch {
          return Object.freeze({
            writer: this.isWriter(),
            corrupt: true,
            entries: 0,
            bytes: 0,
            maxBytes,
            maxEntries,
          });
        }
        const records = Object.values(state.entries);
        return Object.freeze({
          writer: this.isWriter(),
          corrupt: false,
          entries: records.length,
          bytes: records.reduce((sum, record) => sum + (record?.bytes ?? 0), 0),
          maxBytes,
          maxEntries,
          outbox: Object.freeze({
            pending: pendingOutboxRecords(state.outbox).length,
            failed: allOutboxRecords(state.outbox).filter((r) => r.status === 'failed').length,
            pendingAcknowledgements: state.outbox.acks.length,
          }),
        });
      });
    },

    async close() {
      if (closed) return;
      await serialized(async () => {
        closed = true;
        if (writer) {
          writer = false;
          if (heldLocks.get(lockPath) === instanceId) heldLocks.delete(lockPath);
          files.untrackLockForExitCleanup?.(lockPath);
          try {
            await files.unlink(lockPath);
          } catch {
            // Releasing a lock file on a broken filesystem is best-effort;
            // a successor will observe our dead pid and take over.
          }
        }
      });
    },
  };
}
