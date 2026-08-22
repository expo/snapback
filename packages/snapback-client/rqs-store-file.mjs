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
//   `SNAPBACK_RQS_STORE_CORRUPT` and writes refuse. The explicit
//   `resetCorruptStoreIdentity()` barrier hook rotates the unreadable store's
//   identity before replacing those bytes.
//
// The injected identity keys independent store domains (the default resolver
// uses server origin). Each v3 blob carries its exact clientStoreId in
// storeMeta; wipe affects that one domain, while corrupt reset rotates it.
//
// At-rest posture (LLP 0090 Q4, open): the baseline is OS-level protection —
// owner-only directories/files, the platform app container, and platform disk
// encryption. This store adds no encryption of its own; Q4 owns anything
// stronger.
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
  prepareReactBindingReceipt,
  rqsEntryRecordBytes,
  rqsEvictionOrder,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';
import {
  allOutboxRecords,
  createOutboxAuthorizationDispatchGate,
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
  wipeStoreMeta,
} from './rqs-store-meta.mjs';

// v1 held `{ format, entries }`; v2 added outbox + the optional React binding
// receipt. v3 adds LLP 0166's three resident sections and storeMeta. Each
// migration is one-way and publishes through the existing temp+rename cut.
export const RQS_FILE_STORE_FORMAT_V1 = 'snapback-rqs-store-file.v1';
export const RQS_FILE_STORE_FORMAT_V2 = 'snapback-rqs-store-file.v2';
export const RQS_FILE_STORE_FORMAT = 'snapback-rqs-store-file.v3';
const BLOB_PREFIX = 'rqs-';
const BLOB_SUFFIX = '.v1.json';
const LOCK_SUFFIX = '.v1.lock';
const BLOB_FILE_PATTERN = /^rqs-[A-Za-z0-9_-]+\.v1\.json$/;
const TMP_MARKER = '.tmp-';
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

function storeError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = { code, message, details };
  return error;
}

const corruptError = (path) => storeError(
  'SNAPBACK_RQS_STORE_CORRUPT',
  'persisted RQS store bytes are unreadable or from an unknown format; '
    + 'original bytes were left untouched (resetCorruptStoreIdentity() is the authorized reset)',
  { path },
);

/// Default files adapter: Node-compatible hosts. The filesystem builtin is
/// looked up lazily through `process.getBuiltinModule` — never an import
/// statement or a literal dynamic `import()` — because this module is
/// reachable from the client root export: Metro statically resolves even
/// lazy literal `import('node:fs')` specifiers when bundling for a
/// Hermes/React Native host (which injects its own adapter over the platform
/// filesystem), and the browser release proof refuses any builtin specifier
/// in the emitted bundle. The builtin lookup is invisible to both bundlers
/// and non-Node hosts reject only if this default adapter is actually used.
// Process-exit lock hygiene (module-level so N store instances share ONE
// exit listener): a normal process exit unlinks still-held lock files so
// short-lived clients (tests, CLIs) do not strew stale locks — a crashed
// process still relies on the dead-pid staleness verdict instead.
const exitLockCleanup = { paths: new Set(), unlinkSync: null, hooked: false };

export function createNodeFilesAdapter() {
  let fsPromise = null;
  const fs = () => {
    fsPromise ??= Promise.resolve().then(() => {
      const mod = globalThis.process?.getBuiltinModule?.('fs');
      if (!mod) {
        throw storeError(
          'SNAPBACK_RQS_STORE_HOST_UNSUPPORTED',
          'the default files adapter requires a Node host; inject a files adapter on this platform',
        );
      }
      exitLockCleanup.unlinkSync ??= mod.unlinkSync;
      return mod.promises;
    });
    return fsPromise;
  };
  const missing = (error) => error?.code === 'ENOENT';
  return {
    powerLossDurable: true,
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
      await (await fs()).mkdir(path, { recursive: true, mode: DIRECTORY_MODE });
    },
    async chmod(path, mode) {
      await (await fs()).chmod(path, mode);
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
      await (await fs()).writeFile(path, data, {
        encoding: 'utf8',
        flush: true,
        mode: FILE_MODE,
      });
    },
    async writeFileExclusive(path, data) {
      try {
        await (await fs()).writeFile(path, data, {
          encoding: 'utf8',
          flag: 'wx',
          flush: true,
          mode: FILE_MODE,
        });
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
    async syncDirectory(path) {
      const handle = await (await fs()).open(path, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
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
  'readdir', 'syncDirectory', 'processId', 'processAlive',
];

// Same-process single-writer registry: two store instances in one process on
// the same lock path must not both claim the writer role (the on-disk pid
// check alone cannot tell them apart).
const heldLocks = new Map();
const authorityTransitionWipersByLock = new Map();

let instanceCounter = 0;

const unavailableOutboxInspection = () => Object.freeze({
  pending: 0,
  failed: 0,
  stranded: 0,
  quarantined: 0,
  resultGone: 0,
  pendingAcknowledgements: 0,
});

const identitySlug = (identity) => {
  if (identity === null || identity === undefined) return 'anonymous';
  return `id-${hex(sha256(new TextEncoder().encode(String(identity)))).slice(0, 32)}`;
};

export function legacyFileRqsStorePath({ directory, identity = null } = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('legacy file inspection requires a non-empty directory');
  }
  const sep = directory.endsWith('/') ? '' : '/';
  return `${directory}${sep}${BLOB_PREFIX}${identitySlug(identity)}${BLOB_SUFFIX}`;
}

const legacyFileRqsStoreLockPath = ({ directory, identity = null }) => {
  const sep = directory.endsWith('/') ? '' : '/';
  return `${directory}${sep}${BLOB_PREFIX}${identitySlug(identity)}${LOCK_SUFFIX}`;
};

// Read-only migration preflight. It never opens the legacy writer and never
// rewrites numbered predecessors: SQLite adoption is allowed only from the
// exact current v3 shape with no pending/settled/ACK custody.
export async function inspectLegacyFileRqsStore({ directory, files, identity = null } = {}) {
  if (typeof files?.readFile !== 'function') {
    throw new TypeError('legacy file inspection requires files.readFile()');
  }
  const pathIdentity = legacyFileRqsStorePath({ directory, identity });
  let raw;
  try { raw = await files.readFile(pathIdentity); } catch (error) {
    return Object.freeze({ status: 'unreadable', pathIdentity, error });
  }
  if (raw === null) return Object.freeze({ status: 'absent', pathIdentity });
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    return Object.freeze({ status: 'unreadable', pathIdentity });
  }
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const outbox = validateOutboxState(parsed?.outbox);
  const storeMeta = prepareStoreMeta(parsed?.storeMeta);
  const entriesValid = plain(parsed?.entries)
    && Object.values(parsed.entries).every((entry) => verifyPersistedResumeEntry(entry).ok);
  if (
    parsed?.format !== RQS_FILE_STORE_FORMAT
    || !entriesValid
    || outbox === null
    || !plain(parsed.materializations)
    || !plain(parsed.pageSets)
    || !plain(parsed.memberships)
    || storeMeta === null
  ) return Object.freeze({ status: 'unreadable', pathIdentity });
  const custodyCount = allOutboxRecords(outbox).length + outbox.acks.length;
  return Object.freeze({
    status: custodyCount === 0 ? 'discardable' : 'pending-custody',
    pathIdentity,
    predecessorClientStoreId: storeMeta.clientStoreId,
    predecessorHandleKey: storeMeta.handleKey,
    custodyCount,
  });
}

export async function deleteLegacyFileRqsStore({ directory, files, identity = null } = {}) {
  if (typeof files?.unlink !== 'function' || typeof files?.readFile !== 'function') {
    throw new TypeError('legacy file deletion requires files.unlink() and files.readFile()');
  }
  const pathIdentity = legacyFileRqsStorePath({ directory, identity });
  await files.unlink(pathIdentity);
  if (await files.readFile(pathIdentity) !== null) {
    throw storeError(
      'SNAPBACK_EXPO_LEGACY_FILE_DELETE_UNCONFIRMED',
      'legacy RQS file remained present after deletion',
      { pathIdentity },
    );
  }
  return pathIdentity;
}

// Migration is an authority transition, not an unlocked file inspection. The
// lease below acquires the exact writer lock used by createFileRqsResumeStore
// and retains it across inspection, durable successor fencing, unlink, and
// absence confirmation. A live legacy writer therefore either wins before
// inspection or waits until migration has finished; it cannot enqueue or
// recreate the blob in the middle of the transition.
export async function acquireLegacyFileRqsStoreMigrationLease({
  directory,
  files,
  identity = null,
  now = () => Date.now(),
} = {}) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('legacy file migration requires a non-empty directory');
  }
  for (const method of ['mkdir', 'readFile', 'writeFileExclusive', 'unlink', 'processId', 'processAlive']) {
    if (typeof files?.[method] !== 'function') {
      throw new TypeError(`legacy file migration requires files.${method}()`);
    }
  }
  const pathIdentity = legacyFileRqsStorePath({ directory, identity });
  const lockPath = legacyFileRqsStoreLockPath({ directory, identity });
  await files.mkdir(directory);
  const inProcessOwner = heldLocks.get(lockPath);
  if (inProcessOwner !== undefined) {
    return Object.freeze({
      status: 'writer-active',
      pathIdentity,
      lockPath,
      owner: Object.freeze({
        pid: files.processId(),
        instanceId: inProcessOwner?.instanceId ?? inProcessOwner,
      }),
    });
  }

  const migrationInstanceId = `${files.processId()}-migration-${++instanceCounter}-${Math.random().toString(36).slice(2, 10)}`;
  const payload = JSON.stringify({
    pid: files.processId(),
    instanceId: migrationInstanceId,
    acquiredAt: now(),
    purpose: 'sqlite-successor-migration',
  });
  let acquired = await files.writeFileExclusive(lockPath, payload);
  if (!acquired) {
    const raw = await files.readFile(lockPath);
    let holder = null;
    try { holder = raw === null ? null : JSON.parse(raw); } catch { holder = null; }
    const holderPid = Number.isSafeInteger(holder?.pid) ? holder.pid : null;
    const stale = holderPid === null
      || holderPid === files.processId()
      || files.processAlive(holderPid) !== true;
    if (!stale) {
      return Object.freeze({
        status: 'writer-active',
        pathIdentity,
        lockPath,
        owner: Object.freeze({
          pid: holderPid,
          ...(typeof holder?.instanceId === 'string' ? { instanceId: holder.instanceId } : {}),
        }),
      });
    }
    await files.unlink(lockPath);
    acquired = await files.writeFileExclusive(lockPath, payload);
  }
  if (!acquired) {
    return Object.freeze({ status: 'writer-active', pathIdentity, lockPath, owner: null });
  }

  heldLocks.set(lockPath, migrationInstanceId);
  files.trackLockForExitCleanup?.(lockPath);
  let released = false;
  const requireLease = () => {
    if (released || heldLocks.get(lockPath) !== migrationInstanceId) {
      throw storeError(
        'SNAPBACK_EXPO_LEGACY_MIGRATION_FENCE_LOST',
        'legacy migration no longer owns the actual writer fence',
        { pathIdentity, lockPath },
      );
    }
  };
  return Object.freeze({
    status: 'acquired',
    pathIdentity,
    lockPath,
    async inspect() {
      requireLease();
      return inspectLegacyFileRqsStore({ directory, files, identity });
    },
    async deleteAndConfirmAbsent() {
      requireLease();
      return deleteLegacyFileRqsStore({ directory, files, identity });
    },
    async release() {
      if (released) return;
      released = true;
      if (heldLocks.get(lockPath) === migrationInstanceId) heldLocks.delete(lockPath);
      files.untrackLockForExitCleanup?.(lockPath);
      try { await files.unlink(lockPath); } catch { /* successor observes stale owner */ }
    },
  });
}

const plainSweepRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

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
  clientStoreId = null,
  randomBytes = undefined,
  onBeforeStoreIdentityRotation = null,
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
  let migrationMeta = null;
  let competingWriter = null;
  let authorityTransitionBroker = null;
  let authorizationMutationBroker = null;
  let authorizationMutationWithinDispatchBroker = null;
  let authorityTransitionWithinDispatchBroker = null;
  let authorizationDispatchBroker = null;
  let borrowedAuthorizationDispatchDepth = 0;
  let pendingOutboxNormalization = false;
  let outboxNormalizationTask = null;
  let authorityTransitionWipe = null;

  const chmodBestEffort = async (path, mode) => {
    if (typeof files.chmod !== 'function') return;
    try {
      await files.chmod(path, mode);
    } catch {
      // Some injected/mobile filesystems expose no useful POSIX permission
      // model. Availability is preserved there; Node still creates every
      // carrier owner-only through the mandatory write/mkdir modes above.
    }
  };

  // @ref LLP 0090#d3-owner-only-file-permissions-amendment-2026-08-12 —
  // reopening an older store upgrades directory, blob, and lock permissions
  // best-effort without turning an exotic-filesystem chmod refusal into data
  // loss or unavailability.
  const tightenExistingPermissions = async () => {
    await chmodBestEffort(directory, DIRECTORY_MODE);
    await chmodBestEffort(blobPath, FILE_MODE);
    await chmodBestEffort(lockPath, FILE_MODE);
  };

  const plainRecord = (value) => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  );
  const initialMeta = () => {
    migrationMeta ??= createInitialStoreMeta({ clientStoreId, randomBytes });
    return structuredClone(migrationMeta);
  };
  const emptyState = (storeMeta = initialMeta()) => ({
    entries: {},
    outbox: emptyOutboxState(),
    reactBindingReceipt: null,
    materializations: {},
    pageSets: {},
    memberships: {},
    storeMeta,
  });
  const outboxNormalizationChanged = (stored, normalized) => {
    try {
      return JSON.stringify(stored) !== JSON.stringify(normalized);
    } catch {
      // A value that cannot be serialized back into the file carrier cannot
      // be treated as already-normalized durable state.
      return true;
    }
  };

  // DK-9 single-connection mutex analogue: one promise chain serializes every
  // operation, including lock acquisition.
  let chain = Promise.resolve();
  const serialized = (operation) => {
    const result = chain.then(operation);
    chain = result.then(() => {}, () => {});
    return result;
  };

  const authorizationDispatchGate = createOutboxAuthorizationDispatchGate();
  const withAuthorizationDispatch = (operation, options = undefined) => {
    requireOpen();
    return authorizationDispatchGate(operation, options);
  };

  const acquireLock = async () => {
    if (writer || closed) return;
    await files.mkdir(directory);
    await tightenExistingPermissions();
    if (heldLocks.has(lockPath)) {
      // A same-process sibling is just as authoritative as a foreign holder;
      // retain enough identity to make the availability refusal actionable.
      competingWriter = {
        pid: files.processId(),
        instanceId: heldLocks.get(lockPath)?.instanceId ?? heldLocks.get(lockPath),
        lockPath,
        storePath: blobPath,
      };
      return;
    }
    const payload = JSON.stringify({
      pid: files.processId(),
      instanceId,
      acquiredAt: now(),
    });
    const granted = () => {
      writer = true;
      competingWriter = null;
      heldLocks.set(lockPath, {
        instanceId,
        authorityTransition: (...args) => authorityTransitionBroker?.(...args),
        authorityTransitionWithinDispatch: (...args) => (
          authorityTransitionWithinDispatchBroker?.(...args)
        ),
        authorizationMutation: (...args) => authorizationMutationBroker?.(...args),
        authorizationMutationWithinDispatch: (...args) => (
          authorizationMutationWithinDispatchBroker?.(...args)
        ),
        authorizationDispatch: (...args) => authorizationDispatchBroker?.(...args),
        requestOutboxNormalization: () => requestOutboxNormalization(),
      });
      authorityTransitionWipersByLock.set(lockPath, {
        instanceId,
        request: (...args) => authorityTransitionBroker?.(...args),
      });
      files.trackLockForExitCleanup?.(lockPath);
    };
    // Registration covers the entire acquisition, including adapters that
    // create the lock synchronously but resolve writeFileExclusive later. A
    // same-PID migration must see that in-flight owner instead of declaring
    // its newly-created lock stale.
    heldLocks.set(lockPath, instanceId);
    try {
      if (await files.writeFileExclusive(lockPath, payload)) {
        granted();
        await chmodBestEffort(lockPath, FILE_MODE);
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
          || holderPid === files.processId() // no distinct registered holder: a crashed predecessor's leftover
          || files.processAlive(holderPid) !== true;
        if (!stale) {
          competingWriter = {
            pid: holderPid,
            ...(typeof holder?.instanceId === 'string' ? { instanceId: holder.instanceId } : {}),
            lockPath,
            storePath: blobPath,
          };
          return;
        }
        await files.unlink(lockPath);
      }
      if (await files.writeFileExclusive(lockPath, payload)) {
        granted();
        await chmodBestEffort(lockPath, FILE_MODE);
      } else competingWriter = { pid: null, lockPath, storePath: blobPath };
    } finally {
      // A failed/refused create never leaves a phantom in-process owner.
      if (!writer && heldLocks.get(lockPath) === instanceId) heldLocks.delete(lockPath);
    }
  };

  const readState = async ({ persistOutboxNormalization = true } = {}) => {
    if (corrupt) throw corruptError(blobPath);
    const raw = await files.readFile(blobPath);
    if (raw === null) {
      const initialized = emptyState();
      if (writer) await writeState(initialized);
      return initialized;
    }
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
      const migrated = { ...emptyState(), entries: parsed.entries };
      if (writer) await writeState(migrated);
      return migrated;
    }
    const normalizedOutbox = entriesValid ? validateOutboxState(parsed.outbox) : null;
    const outboxValid = normalizedOutbox !== null;
    if (outboxValid && parsed.format === RQS_FILE_STORE_FORMAT_V2) {
      const migrated = {
        ...emptyState(),
        entries: parsed.entries,
        outbox: normalizedOutbox,
        reactBindingReceipt: prepareReactBindingReceipt(parsed.reactBindingReceipt),
      };
      if (writer) await writeState(migrated);
      return migrated;
    }
    const v3Valid = outboxValid
      && parsed.format === RQS_FILE_STORE_FORMAT
      && plainRecord(parsed.materializations)
      && plainRecord(parsed.pageSets)
      && plainRecord(parsed.memberships)
      && prepareStoreMeta(parsed.storeMeta) !== null;
    if (!v3Valid) {
      // Unparseable bytes and future/unknown formats are the same verdict:
      // preserve in place, refuse reads and writes until an explicit wipe.
      corrupt = true;
      throw corruptError(blobPath);
    }
    const state = {
      entries: parsed.entries,
      outbox: normalizedOutbox,
      materializations: parsed.materializations,
      pageSets: parsed.pageSets,
      memberships: parsed.memberships,
      storeMeta: prepareStoreMeta(parsed.storeMeta),
      // Optional metadata never weakens the fail-closed entry/outbox reader:
      // absent or independently invalid receipt bytes simply mean no receipt.
      reactBindingReceipt: prepareReactBindingReceipt(parsed.reactBindingReceipt),
    };
    if (outboxNormalizationChanged(parsed.outbox, normalizedOutbox)) {
      // A live delete root makes validation a destructive security migration.
      // Entry reads may request the exact writer's rewrite in the background,
      // but only the outbox projection waits for and confirms that rewrite.
      // This keeps Channel-B entry adoption independently readable without
      // exposing outbox state ahead of its durable destruction cut.
      // @ref LLP 0053#dispositions-with-producers-and-meanings — delete
      //   destroys retained predecessor payload before normalized outbox state
      //   becomes observable.
      pendingOutboxNormalization = true;
      if (writer && persistOutboxNormalization) {
        await writeState(state);
        pendingOutboxNormalization = false;
      } else if (writer) {
        void requestOutboxNormalization().catch(() => {});
      } else {
        const holder = heldLocks.get(lockPath);
        if (
          holder?.instanceId === competingWriter?.instanceId
          && typeof holder?.requestOutboxNormalization === 'function'
        ) void holder.requestOutboxNormalization();
      }
    } else pendingOutboxNormalization = false;
    return state;
  };

  // Atomic and power-loss durable replace: flush temp contents, rename, then
  // sync the parent directory before publication may proceed.
  const writeState = async (state) => {
    const outbox = validateOutboxState(state.outbox);
    const storeMeta = prepareStoreMeta(state.storeMeta);
    if (
      outbox === null
      || storeMeta === null
      || !plainRecord(state.entries)
      || !plainRecord(state.materializations)
      || !plainRecord(state.pageSets)
      || !plainRecord(state.memberships)
    ) {
      throw corruptError(blobPath);
    }
    await files.mkdir(directory);
    await tightenExistingPermissions();
    await files.writeFile(tmpPath, JSON.stringify({
      format: RQS_FILE_STORE_FORMAT,
      entries: state.entries,
      outbox,
      ...(state.reactBindingReceipt === null
        ? {}
        : { reactBindingReceipt: state.reactBindingReceipt }),
      materializations: state.materializations,
      pageSets: state.pageSets,
      memberships: state.memberships,
      storeMeta,
    }));
    await chmodBestEffort(tmpPath, FILE_MODE);
    await files.rename(tmpPath, blobPath);
    await chmodBestEffort(blobPath, FILE_MODE);
    await files.syncDirectory(directory);
  };

  function requestOutboxNormalization() {
    pendingOutboxNormalization = true;
    if (outboxNormalizationTask !== null || closed) return outboxNormalizationTask;
    const task = serialized(async () => {
      await acquireLock();
      if (!writer || closed || !pendingOutboxNormalization) return false;
      await readState();
      return pendingOutboxNormalization === false;
    });
    outboxNormalizationTask = task;
    void task.finally(() => {
      if (outboxNormalizationTask === task) outboxNormalizationTask = null;
    }).catch(() => {});
    return task;
  }

  const readStateForOutboxProjection = async () => {
    await acquireLock();
    let state = await readState();
    if (!pendingOutboxNormalization) return { available: true, state };

    // @ref LLP 0166#writer-discipline-and-format-versioning — a reader routes
    //   the destructive rewrite to the exact holder and publishes no outbox
    //   projection when that writer is unreachable.
    if (!writer && !closed) {
      const holder = heldLocks.get(lockPath);
      if (
        holder?.instanceId === competingWriter?.instanceId
        && typeof holder?.requestOutboxNormalization === 'function'
      ) {
        await holder.requestOutboxNormalization();
        state = await readState();
      }
    }

    // The broker can disappear between lookup and completion. Re-attempt the
    // lock once so a reader promoted by that loss performs the same durable
    // rewrite before publishing; a still-live unreachable writer leaves the
    // outbox projection unavailable.
    if (pendingOutboxNormalization && !writer && !closed) {
      await acquireLock();
      if (writer) state = await readState();
    }
    return { available: !pendingOutboxNormalization, state };
  };

  const readOutboxAuthorizationMetadata = async () => {
    await acquireLock();
    const state = await readState({ persistOutboxNormalization: false });
    // @ref LLP 0043#js-arm-sessions-custody-queue--recorded-design-2026-08-03-commissioned-at-author-sitting-2--ratified-2026-08-04-author-sitting-3-implementation-authorized-as-a-lane — split projection keeps exact payload-free metadata readable while payload-bearing custody remains blank.
    // Payload normalization is a separate writer-owned cut. The validated
    // authorization queue is payload-free and retains its exact durable
    // authority generation while that rewrite remains pending.
    return outboxAuthorizationStatus(state.outbox);
  };

  const outboxRead = async (reader, unavailable) => {
    const projection = await readStateForOutboxProjection();
    return projection.available ? reader(projection.state.outbox) : unavailable();
  };

  // Eager first acquisition so `isWriter()` has settled by the time the
  // client's first debounced persist checks it. The public settling point
  // below also forces a numbered migration while the writer lock is held.
  const initialAcquisition = serialized(acquireLock).catch(() => {});

  // Writer-gated outbox transition committed atomically with the whole blob
  // (the DK-9 transaction analogue). Enqueue throws on a non-writer; the
  // other transitions report false, matching the entry methods' posture.
  const outboxWrite = async (
    transition,
    { throwWhenNotWriter = false, deferToWriter = false } = {},
  ) => {
    await acquireLock();
    if (!writer) {
      const holder = heldLocks.get(lockPath);
      if (
        deferToWriter
        && holder?.instanceId === competingWriter?.instanceId
        && typeof holder?.authorizationMutation === 'function'
      ) {
        const broker = borrowedAuthorizationDispatchDepth > 0
          ? holder.authorizationMutationWithinDispatch
          : holder.authorizationMutation;
        return {
          skipped: false,
          result: await broker(transition),
        };
      }
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

  authorizationMutationWithinDispatchBroker = async (transition) => {
    const applied = await serialized(
      () => outboxWrite(transition, { throwWhenNotWriter: true }),
    );
    return applied.result;
  };
  authorizationMutationBroker = (transition) => withAuthorizationDispatch(
    () => authorizationMutationWithinDispatchBroker(transition),
  );
  authorizationDispatchBroker = (operation, options = undefined) => (
    withAuthorizationDispatch(operation, options)
  );

  const requireOpen = () => {
    if (closed) throw storeError('SNAPBACK_RQS_STORE_CLOSED', 'RQS resume store is closed');
  };

  const sweepSiblingIdentityBlobs = async () => {
    const ownBlobName = blobPath.slice(blobPath.lastIndexOf(sep) + 1);
    const names = await files.readdir(directory);
    for (const name of names) {
      const sweep = name.includes(TMP_MARKER)
        || (BLOB_FILE_PATTERN.test(name) && name !== ownBlobName);
      if (!sweep) continue;
      try {
        await files.unlink(`${directory}${sep}${name}`);
      } catch {
        // Best-effort per sibling; the wipe itself must not throw for an
        // already-gone file.
      }
    }
  };

  const commitAuthorityTransitionAsWriter = async (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => {
    if (!writer) return false;
    let state;
    try {
      state = await readState();
    } catch {
      return false;
    }
    const advanced = outboxOps.advanceAuthorizationAuthority(
      state.outbox,
      authorityTransitionKey,
      authorityTransitionEpoch,
      options,
    );
    if (advanced.result.status === 'authority-current') return true;
    // LLP 0166's client-wide cut still destroys every sibling identity
    // blob. Only this resolved store's outbox receives LLP 0043's
    // per-record custody carve-out.
    await sweepSiblingIdentityBlobs();
    const storeMeta = wipeStoreMeta(state.storeMeta, { randomBytes });
    if (storeMeta === null) return false;
    await writeState({
      ...emptyState(storeMeta),
      outbox: advanced.state,
    });
    return true;
  };

  // Same-process readers cannot take the writer's long-held file lock, but
  // they can defer this one atomic authority cut to that exact lock holder.
  // The writer's dispatch gate keeps roots, transport, and the generation
  // advance in one order; foreign-process readers continue to return false.
  authorityTransitionWithinDispatchBroker = (...args) => serialized(
    () => commitAuthorityTransitionAsWriter(...args),
  );
  authorityTransitionBroker = (...args) => withAuthorizationDispatch(
    () => authorityTransitionWithinDispatchBroker(...args),
  );

  authorityTransitionWipe = (
    authorityTransitionKey = null,
    authorityTransitionEpoch = null,
    options = undefined,
  ) => serialized(async () => {
    requireOpen();
    await acquireLock();
    if (writer) {
      return commitAuthorityTransitionAsWriter(
        authorityTransitionKey,
        authorityTransitionEpoch,
        options,
      );
    }
    // The no-argument external-bearer path must return false so its caller
    // installs the predecessor fence before requestAuthorityTransitionWipe()
    // enters the elected writer. Keyed coordinator transitions preserve the
    // lane's same-process writer broker and its shared dispatch order.
    if (authorityTransitionKey === null) return false;
    const holder = heldLocks.get(lockPath);
    if (
      holder?.instanceId !== competingWriter?.instanceId
      || typeof holder?.authorityTransitionWithinDispatch !== 'function'
    ) return false;
    return holder.authorityTransitionWithinDispatch(
      authorityTransitionKey,
      authorityTransitionEpoch,
      options,
    );
  });

  const withSharedAuthorizationDispatch = async (operation, options = undefined) => {
    await initialAcquisition;
    if (writer) return withAuthorizationDispatch(operation, options);
    const holder = heldLocks.get(lockPath);
    if (
      holder?.instanceId !== competingWriter?.instanceId
      || typeof holder?.authorizationDispatch !== 'function'
    ) throw outboxNotWriterError();
    return holder.authorizationDispatch(async () => {
      borrowedAuthorizationDispatchDepth += 1;
      try {
        return await operation();
      } finally {
        borrowedAuthorizationDispatchDepth -= 1;
      }
    }, options);
  };

  // @ref LLP 0053#client-fences — public and follower-request wipes share the
  // writer's dispatch order when this process can reach it. A foreign-process
  // reader, or one observing a provisional same-process owner, must preserve
  // the raw helper's false result so the caller installs its predecessor fence.
  // If this reader reclaims a stale foreign lock, join the newly-local dispatch
  // tail before committing; the acquisition mutex must be released first so a
  // dispatch that observed writer-ship during acquireLock() can finish ahead of
  // the wipe without deadlocking on serialized store work.
  const authorityTransitionWipeWithDispatch = async (...args) => {
    await initialAcquisition;
    if (writer) {
      return withAuthorizationDispatch(() => authorityTransitionWipe(...args));
    }
    const holder = heldLocks.get(lockPath);
    if (
      holder?.instanceId === competingWriter?.instanceId
      && typeof holder?.authorizationDispatch === 'function'
    ) {
      return holder.authorizationDispatch(async () => {
        borrowedAuthorizationDispatchDepth += 1;
        try {
          return await authorityTransitionWipe(...args);
        } finally {
          borrowedAuthorizationDispatchDepth -= 1;
        }
      });
    }
    const reclaimedWriter = await serialized(async () => {
      requireOpen();
      await acquireLock();
      return writer;
    });
    if (!reclaimedWriter) return false;
    return withAuthorizationDispatch(() => authorityTransitionWipe(...args));
  };

  // @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — legacy
  // entries, outbox, and QMK sections share the adoption commit domain.
  const materializationTransaction = async (mode, operation) => {
    const readMaterializationState = mode === 'readonly'
      ? async () => {
        const projection = await readStateForOutboxProjection();
        return projection.available
          ? projection.state
          : { ...projection.state, outbox: null };
      }
      : readState;
    const { fileMaterializationTransaction } = await import(
      './materialization-store-runtime.mjs'
    );
    return fileMaterializationTransaction([
      mode, operation, requireOpen, acquireLock, () => writer, readMaterializationState,
      writeState, corruptError, blobPath,
    ]);
  };

  return {
    isWriter() {
      return writer && !closed;
    },

    async withOutboxAuthorizationDispatch(operation, options = undefined) {
      return withSharedAuthorizationDispatch(operation, options);
    },

    /// Settles (and, unlike web's queued lock, re-attempts) ownership: a
    /// reader whose holder has since closed or died becomes the writer here.
    whenLockSettled() {
      return serialized(async () => {
        await acquireLock();
        if (writer) await readState();
      }).catch(() => {});
    },

    /// Degradation-mode capability fact (DK-9: capability reports name the
    /// store implementation and degradation mode in force).
    durability() {
      return { implementation: 'file', durable: files.powerLossDurable === true };
    },

    materializationTransaction(mode, operation) {
      return serialized(() => materializationTransaction(mode, operation));
    },

    /// LLP 0090 D3 outbox rule input: false whenever this arm's own durable
    /// queue holds pending intent (or a composing layer's injected check
    /// says so). A corrupt blob reads as non-empty — fail closed to the
    /// full-resync path, never to token resume over an unknown queue.
    async outboxEmpty() {
      requireOpen();
      if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
      return serialized(async () => {
        try {
          return await outboxRead(
            (outbox) => unresolvedOutboxRecords(outbox).length === 0
              && outboxAuthorizationStatus(outbox).suspended === false,
            () => false,
          );
        } catch {
          return false;
        }
      });
    },

    // ---- LLP 0043 M2 outbox (LLP 0129 Phase 0, JS/node arm) ----

    async outboxEnqueue(record, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => {
        const { result } = await outboxWrite(
          (outbox) => outboxOps.enqueue(outbox, record, now(), expectedAuthorizationFence),
          { throwWhenNotWriter: true },
        );
        return result;
      });
    },

    async outboxEnqueueWithOperationIdentity(
      record,
      authorityCohortKey,
      range = null,
      expectedAuthorizationFence = null,
    ) {
      requireOpen();
      return serialized(async () => {
        const { result } = await outboxWrite(
          (outbox) => outboxOps.enqueueWithOperationIdentity(
            outbox,
            record,
            now(),
            authorityCohortKey,
            range,
            expectedAuthorizationFence,
          ),
          { throwWhenNotWriter: true },
        );
        return result;
      });
    },

    async outboxAssignOperationIdentity(
      id,
      authorityCohortKey,
      range = null,
      authorityDescriptor = undefined,
      authorityPrincipalId = undefined,
      expectedAuthorizationFence = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.assignOperationIdentity(
          outbox,
          id,
          now(),
          authorityCohortKey,
          range,
          authorityDescriptor,
          authorityPrincipalId,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxOperationIdentityRange(authorityCohortKey) {
      requireOpen();
      return serialized(() => outboxRead(
        (outbox) => outboxOps.operationIdentityRange(outbox, authorityCohortKey).result,
        () => null,
      ));
    },

    async outboxPending() {
      requireOpen();
      return serialized(() => outboxRead(pendingOutboxRecords, () => []));
    },

    async outboxAuthorizationStatus() {
      requireOpen();
      return serialized(readOutboxAuthorizationMetadata);
    },

    async outboxAuthorizationTransitionVisible(
      kind,
      payload,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      return serialized(() => outboxRead(
        (outbox) => outboxOps.authorizationTransitionVisible(
          outbox,
          kind,
          payload,
          expectedAuthorityGeneration,
        ).result,
        () => false,
      ));
    },

    async outboxApplyAuthorizationObligation(obligation, expectedAuthorityGeneration = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.applyAuthorizationObligation(
          outbox,
          obligation,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, deferToWriter: true },
      )).result);
    },

    async outboxResolveAuthorizationObligation(resolution, expectedAuthorityGeneration = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.resolveAuthorizationObligation(
          outbox,
          resolution,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, deferToWriter: true },
      )).result);
    },

    async outboxAcknowledgeAuthorizationResolution(
      resolution,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.acknowledgeAuthorizationResolution(
          outbox,
          resolution,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, deferToWriter: true },
      )).result);
    },

    async outboxRetireAuthorizationScopes(scopes, expectedAuthorityGeneration = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.retireAuthorizationScopes(
          outbox,
          scopes,
          expectedAuthorityGeneration,
        ),
        { throwWhenNotWriter: true, deferToWriter: true },
      )).result);
    },

    async outboxPrepareSubmission(id, options = undefined) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.prepareSubmission(
          outbox,
          id,
          { ...(options ?? {}), now: now() },
        ),
      )).result);
    },

    async outboxRecords() {
      requireOpen();
      return serialized(() => outboxRead(allOutboxRecords, () => []));
    },

    async outboxSettle(id, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.settle(outbox, id, expectedAuthorizationFence),
      )).result);
    },

    async outboxDurablyConsume(
      id,
      settlement,
      userId = null,
      confirmedAcknowledgements = [],
      expectedAuthorizationFence = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.durablyConsume(
          outbox,
          id,
          settlement,
          userId,
          now(),
          confirmedAcknowledgements,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxMarkFailed(id, failure, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markFailed(outbox, id, failure, expectedAuthorizationFence),
      )).result);
    },

    async outboxMarkStranded(
      id,
      reason,
      predecessorPrincipalScope = null,
      expectedAuthorizationFence = null,
      effectProvenance = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markStranded(
          outbox,
          id,
          reason,
          now(),
          predecessorPrincipalScope,
          expectedAuthorizationFence,
          effectProvenance,
        ),
      )).result);
    },

    async outboxReconcileCustody(
      principalScope,
      authorityDescriptor,
      custody,
      expectedAuthorityGeneration = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.reconcileCustody(
          outbox,
          principalScope,
          authorityDescriptor,
          custody,
          now(),
          expectedAuthorityGeneration,
        ),
        { deferToWriter: true },
      )).result);
    },

    async outboxDiscardStranded(ids, principalScope, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.discardStranded(
          outbox,
          ids,
          principalScope,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxMarkQuarantined(id, refusal, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markQuarantined(
          outbox,
          id,
          refusal,
          now(),
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxReenterQuarantined(expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.reenterQuarantined(outbox, expectedAuthorizationFence),
      )).result);
    },

    async outboxMarkResultGone(id, resultGone, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markResultGone(
          outbox,
          id,
          resultGone,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxDiscard(id, expectedAuthorizationFence = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.discard(outbox, id, expectedAuthorizationFence),
      )).result);
    },

    async outboxDiscardPendingInsertion(
      id,
      insertionSequence,
      expectedAuthorizationFence = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.discardPendingInsertion(
          outbox,
          id,
          insertionSequence,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    async outboxRecordAcknowledgement(id, userId = null, authorityDescriptor = null) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.recordAck(outbox, id, userId, authorityDescriptor),
      )).result);
    },

    async outboxPendingAcknowledgements(userId = null, limit = 64, authorityDescriptor = null) {
      requireOpen();
      return serialized(() => outboxRead(
        (outbox) => pendingAcknowledgementsFor(
          outbox,
          userId,
          limit,
          authorityDescriptor,
        ),
        () => [],
      ));
    },

    async outboxMarkAcknowledgementsReady(ids, userId = undefined, authorityDescriptor = undefined) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.markAcksReady(outbox, ids, userId, authorityDescriptor),
      )).result);
    },

    async outboxConfirmAcknowledgements(
      ids,
      userId = undefined,
      authorityDescriptor = undefined,
      expectedAuthorizationFence = null,
    ) {
      requireOpen();
      return serialized(async () => (await outboxWrite(
        (outbox) => outboxOps.confirmAcks(
          outbox,
          ids,
          userId,
          authorityDescriptor,
          expectedAuthorizationFence,
        ),
      )).result);
    },

    /// Optional offline React binding-preparation metadata. It shares the
    /// blob's atomic temp-write+rename path but is not an RQS entry.
    async loadReactBindingReceipt() {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        const receipt = (await readState()).reactBindingReceipt;
        return receipt === null ? null : structuredClone(receipt);
      });
    },

    async commitReactBindingReceipt(receipt) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) {
          const details = competingWriter ?? { pid: null, lockPath, storePath: blobPath };
          // @ref LLP 0193#program — an agent-triggerable persistence refusal
          // names both the competing process and the exact contested paths.
          throw storeError(
            'SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED',
            `react binding receipt was not persisted because pid ${details.pid ?? 'unknown'} owns the RQS writer lock ${details.lockPath}`,
            {
              reason: 'competing_writer',
              competingPid: details.pid,
              ...(details.instanceId === undefined
                ? {}
                : { competingInstanceId: details.instanceId }),
              lockPath: details.lockPath,
              storePath: details.storePath,
            },
          );
        }
        if (corrupt) return false;
        const stored = prepareReactBindingReceipt(receipt);
        if (stored === null) return false;
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        await writeState({ ...state, reactBindingReceipt: stored });
        return true;
      });
    },

    async readStoreMeta() {
      requireOpen();
      return serialized(async () => structuredClone((await readState()).storeMeta));
    },

    async writeStoreMeta(value) {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        const replacement = prepareStoreMeta(value);
        if (replacement === null) throw corruptError(blobPath);
        const state = await readState();
        const current = state.storeMeta;
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
          throw storeError(
            'SNAPBACK_RQS_STORE_META_REGRESSION',
            'store metadata cannot rotate identity or lower monotone high-waters',
          );
        }
        await writeState({ ...state, storeMeta: replacement });
        return true;
      });
    },

    async allocateQueryInstanceId() {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return null;
        const state = await readState();
        const allocated = allocateQueryInstanceIdInMeta(state.storeMeta);
        if (allocated === null) throw corruptError(blobPath);
        await writeState({ ...state, storeMeta: allocated.meta });
        return allocated.queryInstanceId;
      });
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

    /// User-switch / client-wide wipe (LLP 0053 client-wide delete; LLP 0166
    /// §D1). Every sibling identity's blob is destroyed — shipped scope — and
    /// a destroyed sibling's next open mints a fresh store identity, so
    /// LLP 0053's never-reuse holds by namespace rotation (§D1's
    /// unparseable-reset argument). This domain instead takes the §D1
    /// projection in place: sections cleared, high-waters and
    /// writerGeneration preserved, handle key rotated. Corrupt bytes in this
    /// domain still require the identity-rotating reset below (their
    /// high-waters are unreadable); siblings are swept regardless, so a
    /// user switch never strands another identity's entries or outbox.
    async wipe() {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return false;
        await sweepSiblingIdentityBlobs();
        let state;
        try {
          state = await readState();
        } catch {
          return false;
        }
        const storeMeta = wipeStoreMeta(state.storeMeta, { randomBytes });
        if (storeMeta === null) return false;
        await writeState(emptyState(storeMeta));
        return true;
      });
    },

    wipeForAuthorityTransition: authorityTransitionWipeWithDispatch,

    wipeForAuthorityTransitionWithinDispatch: authorityTransitionWipe,

    // A readable follower cannot mutate the shared blob, but it can enqueue
    // the destructive barrier on the actual same-domain writer. The returned
    // settlement is the writer's serialized durable commit, not a wake hint.
    requestAuthorityTransitionWipe(...args) {
      requireOpen();
      const owner = authorityTransitionWipersByLock.get(lockPath);
      if (!owner || typeof owner.request !== 'function') return null;
      return Object.freeze({
        settlement: Promise.resolve().then(() => owner.request(...args)),
      });
    },

    /// Destructive recovery for an unparseable blob. The callback is the
    /// LLP 0059 barrier hook: it must authorize predecessor destruction before
    /// this carrier removes bytes and publishes the fresh store identity.
    async resetCorruptStoreIdentity() {
      requireOpen();
      return serialized(async () => {
        await acquireLock();
        if (!writer) return { reset: false, reason: 'not_writer' };
        if (!corrupt) {
          try {
            await readState();
            return { reset: false, reason: 'not_corrupt' };
          } catch (error) {
            if (!corrupt) throw error;
          }
        }
        const nextClientStoreId = mintClientStoreId(randomBytes);
        await onBeforeStoreIdentityRotation?.({
          carrier: 'file',
          path: blobPath,
          previousClientStoreId: clientStoreId,
          nextClientStoreId,
        });
        await files.unlink(blobPath);
        const names = await files.readdir(directory);
        for (const name of names) {
          if (name.startsWith(`${blobPath.slice(blobPath.lastIndexOf('/') + 1)}${TMP_MARKER}`)) {
            try { await files.unlink(`${directory}${sep}${name}`); } catch { /* best-effort */ }
          }
        }
        migrationMeta = createInitialStoreMeta({
          clientStoreId: nextClientStoreId,
          randomBytes,
        });
        corrupt = false;
        await writeState(emptyState(migrationMeta));
        return {
          reset: true,
          previousClientStoreId: clientStoreId,
          clientStoreId: nextClientStoreId,
        };
      });
    },

    async inspection() {
      requireOpen();
      return serialized(async () => {
        let projection = null;
        try {
          projection = await readStateForOutboxProjection();
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
        const { state } = projection;
        const records = Object.values(state.entries);
        return Object.freeze({
          writer: this.isWriter(),
          corrupt: false,
          entries: records.length,
          bytes: records.reduce((sum, record) => sum + (record?.bytes ?? 0), 0),
          maxBytes,
          maxEntries,
          outbox: projection.available
            ? Object.freeze({
              pending: pendingOutboxRecords(state.outbox).length,
              failed: allOutboxRecords(state.outbox)
                .filter((r) => r.status === 'failed').length,
              stranded: allOutboxRecords(state.outbox)
                .filter((r) => r.status === 'stranded').length,
              quarantined: allOutboxRecords(state.outbox)
                .filter((r) => r.status === 'quarantined').length,
              resultGone: allOutboxRecords(state.outbox)
                .filter((r) => r.status === 'result-gone').length,
              pendingAcknowledgements: state.outbox.acks.length,
            })
            : unavailableOutboxInspection(),
        });
      });
    },

    async close() {
      if (closed) return;
      await serialized(async () => {
        closed = true;
        if (writer) {
          writer = false;
          if (heldLocks.get(lockPath)?.instanceId === instanceId) heldLocks.delete(lockPath);
          if (authorityTransitionWipersByLock.get(lockPath)?.instanceId === instanceId) {
            authorityTransitionWipersByLock.delete(lockPath);
          }
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

// ---------------------------------------------------------------------------
// Directory janitor (issues/20260731-js-arm-lease-custody-and-sessions-outbox
// leg 3): the default node store keys blobs and locks by server origin, so
// dead origins (ephemeral test ports) accumulate per-origin blobs forever.
// This sweep unlinks sibling blobs that are provably abandoned:
//
//   - never the caller's own identity slug;
//   - never a blob whose lock is held by a live process (in this process or
//     any other, per the same DK-9 liveness verdict acquireLock uses);
//   - never a blob holding PENDING queued intent (exactly-once discipline:
//     queued mutations are dropped only by the explicit drop-and-mark-failed
//     path, not a janitor);
//   - never unreadable/corrupt bytes (the DK-9 corruption posture: original
//     bytes are evidence, resetCorruptStoreIdentity() is the only reset);
//   - only when the newest recorded activity (entry savedAt/resumedAt,
//     outbox enqueuedAt, binding-receipt savedAt) is older than maxAgeMs.
//
// Availability-only: every failure skips the candidate; the sweep never
// throws past its own boundary.
export const RQS_STORE_GC_DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function sweepStaleRqsBlobs({
  directory,
  files = createNodeFilesAdapter(),
  keepIdentity = null,
  maxAgeMs = RQS_STORE_GC_DEFAULT_MAX_AGE_MS,
  now = () => Date.now(),
} = {}) {
  const summary = { swept: 0, kept: 0 };
  if (typeof directory !== 'string' || directory.length === 0) return summary;
  const sep = directory.endsWith('/') ? '' : '/';
  const keepName = keepIdentity === null
    ? null
    : `${BLOB_PREFIX}${identitySlug(keepIdentity)}${BLOB_SUFFIX}`;
  let names = [];
  try {
    names = (await files.readdir(directory)) ?? [];
  } catch {
    return summary;
  }
  for (const name of names) {
    if (!BLOB_FILE_PATTERN.test(name) || name === keepName) continue;
    const blobPath = `${directory}${sep}${name}`;
    const lockPath = `${directory}${sep}${name.slice(0, -BLOB_SUFFIX.length)}${LOCK_SUFFIX}`;
    try {
      if (heldLocks.has(lockPath)) {
        summary.kept += 1;
        continue; // live sibling instance in this process
      }
      let lockIsStale = true;
      const rawLock = await files.readFile(lockPath);
      if (rawLock !== null) {
        let holder = null;
        try {
          holder = JSON.parse(rawLock);
        } catch {
          holder = null;
        }
        const holderPid = Number.isSafeInteger(holder?.pid) ? holder.pid : null;
        lockIsStale = holderPid === null || files.processAlive(holderPid) !== true;
        if (!lockIsStale) {
          summary.kept += 1;
          continue; // held by a live foreign process
        }
      }
      const rawBlob = await files.readFile(blobPath);
      if (rawBlob === null) continue;
      let parsed = null;
      try {
        parsed = JSON.parse(rawBlob);
      } catch {
        summary.kept += 1;
        continue; // corrupt bytes are evidence, never janitor droppings
      }
      const entriesValid = plainSweepRecord(parsed?.entries);
      const recognizedV1 = parsed?.format === RQS_FILE_STORE_FORMAT_V1 && entriesValid;
      const recognizedV2 = parsed?.format === RQS_FILE_STORE_FORMAT_V2
        && entriesValid
        && validateOutboxState(parsed?.outbox) !== null;
      const recognizedV3 = parsed?.format === RQS_FILE_STORE_FORMAT
        && entriesValid
        && validateOutboxState(parsed?.outbox) !== null
        && plainSweepRecord(parsed?.materializations)
        && plainSweepRecord(parsed?.pageSets)
        && plainSweepRecord(parsed?.memberships)
        && prepareStoreMeta(parsed?.storeMeta) !== null;
      if (!recognizedV1 && !recognizedV2 && !recognizedV3) {
        summary.kept += 1;
        continue; // unsupported/future bytes stay preserved exactly in place
      }
      const outbox = recognizedV1 ? emptyOutboxState() : validateOutboxState(parsed.outbox);
      // Quarantined intents are held for explicit re-entry against a successor
      // schema, so the staleness janitor must never reclaim a blob that still
      // carries one — otherwise quarantine-all-on-upgrade-required silently
      // loses the very intents the tombstone promises to preserve. They are not
      // `pending` (never replayed under the incompatible schema), so guard them
      // explicitly alongside queued work.
      // @ref LLP 0081#4-execution-journaling-and-crash-recovery — quarantined
      //   intents survive to re-entry; the janitor cannot drop them.
      const mustKeep = outbox !== null
        && (pendingOutboxRecords(outbox).length > 0
          || allOutboxRecords(outbox).some((record) => record.status === 'quarantined')
          || outboxAuthorizationStatus(outbox).suspended);
      if (mustKeep) {
        summary.kept += 1;
        continue; // queued or quarantined intent is never silently discarded
      }
      let lastActivityMs = 0;
      const consider = (value) => {
        if (Number.isSafeInteger(value) && value > lastActivityMs) lastActivityMs = value;
      };
      for (const record of Object.values(parsed?.entries ?? {})) {
        consider(record?.savedAt);
        consider(record?.resumedAt);
      }
      if (outbox !== null) {
        for (const record of allOutboxRecords(outbox)) consider(record?.enqueuedAt);
      }
      consider(parsed?.reactBindingReceipt?.savedAt);
      if (now() - lastActivityMs <= maxAgeMs) {
        summary.kept += 1;
        continue;
      }
      await files.unlink(blobPath);
      if (rawLock !== null && lockIsStale) {
        try { await files.unlink(lockPath); } catch { /* best-effort */ }
      }
      summary.swept += 1;
    } catch {
      summary.kept += 1; // any surprise keeps the candidate
    }
  }
  return summary;
}
