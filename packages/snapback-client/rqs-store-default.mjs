// Default client persistence resolution (LLP 0129 Phase 0, option A):
// the client cache persists across cold boots BY DEFAULT. The shipped
// opt-in resume stores (LLP 0090 D3) become the default paths of the
// browser and node clients, with graceful in-memory fallback — degrading,
// never failing, and always reporting which implementation and durability
// mode is in force (LLP 0008 DK-9: capability reports name the store
// implementation and degradation mode).
//
// Resolution ladder:
//   1. explicit `rqsStore` option — injected store or `null` opt-out;
//   2. env `SNAPBACK_CLIENT_RQS_STORE=off` — disabled (test/ops escape);
//   3. browser (IndexedDB + Web Locks) — the web arm;
//   4. React Native with registered platform files — the native file arm;
//   5. node (filesystem + a resolvable state directory) — the file arm,
//      under `SNAPBACK_CLIENT_RQS_DIR` or `~/.snapback/rqs`, keyed by the
//      server origin so distinct servers never share a blob;
//   6. otherwise — the in-memory arm (`durable: false`; no cold-boot or
//      restart-safe claim may be made over it).

import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';
import {
  createFileRqsResumeStore,
  RQS_STORE_GC_DEFAULT_MAX_AGE_MS,
  sweepStaleRqsBlobs,
} from './rqs-store-file.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';

const REQUIRED_NATIVE_FILES_METHODS = [
  'mkdir', 'readFile', 'writeFile', 'writeFileExclusive', 'rename', 'unlink',
  'readdir', 'syncDirectory', 'processId', 'processAlive',
];

let nativeRqsFiles = null;

export function registerNativeRqsFiles(provider) {
  if (typeof provider?.directory !== 'string' || provider.directory.length === 0) {
    throw new TypeError('native RQS files registration requires a non-empty directory');
  }
  for (const method of REQUIRED_NATIVE_FILES_METHODS) {
    if (typeof provider?.files?.[method] !== 'function') {
      throw new TypeError(`native RQS files registration requires files.${method}()`);
    }
  }
  nativeRqsFiles = Object.freeze({
    files: provider.files,
    directory: provider.directory,
    implementation: provider.implementation ?? null,
  });
  return nativeRqsFiles;
}

export function clearNativeRqsFiles() {
  nativeRqsFiles = null;
}

const env = (name) => {
  const value = globalThis.process?.env?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const memoryFallback = (reason) => ({
  store: createMemoryRqsResumeStore(),
  info: Object.freeze({
    source: 'default',
    implementation: 'memory',
    durable: false,
    reason,
  }),
});

/// Stable per-origin identity for the default file store: two clients of the
/// same server share (single-writer) one blob; different servers never do.
const originIdentity = (baseUrl) => {
  try {
    const url = new URL(baseUrl);
    return `origin:${url.protocol}//${url.host}`;
  } catch {
    return `origin:${String(baseUrl)}`;
  }
};

export function resolveDefaultRqsStore({ baseUrl } = {}) {
  if (env('SNAPBACK_CLIENT_RQS_STORE') === 'off') {
    return {
      store: null,
      info: Object.freeze({
        source: 'disabled',
        implementation: null,
        durable: false,
        reason: 'SNAPBACK_CLIENT_RQS_STORE=off',
      }),
    };
  }
  // Browser arm: IndexedDB with Web-Lock single-writer ownership.
  const hasIndexedDb = typeof globalThis.indexedDB?.open === 'function';
  const hasWebLocks = typeof globalThis.navigator?.locks?.request === 'function';
  if (hasIndexedDb && hasWebLocks) {
    try {
      return {
        store: createIndexedDbRqsResumeStore(),
        info: Object.freeze({
          source: 'default',
          implementation: 'indexeddb',
          durable: true,
          reason: null,
        }),
      };
    } catch (error) {
      return memoryFallback(error?.code ?? 'indexeddb-unavailable');
    }
  }
  // React Native arm: the app registers its platform filesystem module at
  // the root, keeping Metro's static closure free of platform imports.
  if (globalThis.navigator?.product === 'ReactNative') {
    if (nativeRqsFiles === null) return memoryFallback('no-native-files-registered');
    try {
      const store = createFileRqsResumeStore({
        directory: nativeRqsFiles.directory,
        files: nativeRqsFiles.files,
        identity: originIdentity(baseUrl),
      });
      const durable = store.durability().durable === true;
      return {
        store,
        info: Object.freeze({
          source: 'default',
          implementation: 'file',
          durable,
          reason: durable ? null : 'native-files-no-power-loss-cut',
        }),
      };
    } catch (error) {
      return memoryFallback(error?.code ?? 'native-files-unavailable');
    }
  }
  // Node arm: durable files under a stable state directory. React Native
  // hosts are handled above and remain explicitly excluded here.
  const isNode = typeof globalThis.process?.versions?.node === 'string'
    && globalThis.navigator?.product !== 'ReactNative';
  if (isNode) {
    const home = env('HOME') ?? env('USERPROFILE');
    const directory = env('SNAPBACK_CLIENT_RQS_DIR')
      ?? (home ? `${home}/.snapback/rqs` : null);
    if (directory) {
      try {
        const store = createFileRqsResumeStore({
          directory,
          identity: originIdentity(baseUrl),
        });
        // Directory hygiene: dead-origin blobs (ephemeral test ports) would
        // otherwise accumulate forever under the shared state directory.
        // Fire-and-forget, availability-only; the sweep keeps anything held
        // by a live process, holding pending queued intent, corrupt, or
        // younger than the age floor. SNAPBACK_CLIENT_RQS_GC=off disables;
        // SNAPBACK_CLIENT_RQS_GC_MAX_AGE_MS overrides the 30-day floor.
        if (env('SNAPBACK_CLIENT_RQS_GC') !== 'off') {
          const configuredAge = Number(env('SNAPBACK_CLIENT_RQS_GC_MAX_AGE_MS'));
          void sweepStaleRqsBlobs({
            directory,
            keepIdentity: originIdentity(baseUrl),
            maxAgeMs: Number.isSafeInteger(configuredAge) && configuredAge > 0
              ? configuredAge
              : RQS_STORE_GC_DEFAULT_MAX_AGE_MS,
          }).catch(() => {});
        }
        return {
          store,
          info: Object.freeze({
            source: 'default',
            implementation: 'file',
            durable: true,
            reason: null,
          }),
        };
      } catch (error) {
        return memoryFallback(error?.code ?? 'file-store-unavailable');
      }
    }
    return memoryFallback('no-state-directory');
  }
  return memoryFallback('no-durable-backend');
}
