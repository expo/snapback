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
//   3. admitted app platform — its browser/native/memory arm, with durable
//      application stores namespaced by the full app owner key;
//   4. browser (IndexedDB + Web Locks) — the ambient web arm;
//   5. React Native with registered platform files — the native file arm;
//   6. node (filesystem + a resolvable state directory) — the file arm,
//      under `SNAPBACK_CLIENT_RQS_DIR` or `~/.snapback/rqs`, keyed by the
//      server origin so distinct servers never share a blob;
//   7. otherwise — the in-memory arm (`durable: false`; no cold-boot or
//      restart-safe claim may be made over it).

import { authCustodyOwnerKeyHash } from '@expo/snapback-contract/auth-coordinator';

import {
  RQS_STORE_DATABASE_NAME,
  createIndexedDbRqsResumeStore,
} from './rqs-store.mjs';
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

// Expo's provider-level default installer needs to inspect the already
// registered legacy carrier before deciding whether SQLite may replace it.
// The returned registration is immutable; callers cannot mutate the module
// resolver's state through this seam.
export function registeredNativeRqsFiles() {
  return nativeRqsFiles;
}

// The Expo provider retains default resolutions in a realm-global registry.
// A module-scoped WeakSet loses those brands when Metro replaces this module
// during HMR, so put the versioned brand on the retained envelope itself.
// Symbol.for keeps the identity stable across those module evaluations while
// the non-enumerable property keeps the public resolution shape unchanged.
export const DEFAULT_RQS_STORE_RESOLUTION_BRAND = Symbol.for(
  '@expo/snapback-client/default-rqs-store-resolution.v1',
);
const DEFAULT_RQS_STORE_RESOLUTION_BRAND_VALUE = 'snapback.default-rqs-store-resolution.v1';

// A provider may acquire a default store asynchronously before constructing
// SnapbackClient. Branding preserves the public `source: "default"` fact
// while keeping ordinary object-shaped injected stores unambiguous.
export function brandDefaultRqsStoreResolution(resolution) {
  if (
    resolution === null
    || typeof resolution !== 'object'
    || !('store' in resolution)
    || resolution.info?.source !== 'default'
  ) {
    throw new TypeError('default RQS store resolution requires a default-source info record');
  }
  const branded = resolution[DEFAULT_RQS_STORE_RESOLUTION_BRAND];
  if (branded !== undefined && branded !== DEFAULT_RQS_STORE_RESOLUTION_BRAND_VALUE) {
    throw new TypeError('default RQS store resolution has an incompatible brand');
  }
  if (branded === undefined) {
    Object.defineProperty(resolution, DEFAULT_RQS_STORE_RESOLUTION_BRAND, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: DEFAULT_RQS_STORE_RESOLUTION_BRAND_VALUE,
    });
  }
  return resolution;
}

export function isDefaultRqsStoreResolution(value) {
  return value !== null
    && typeof value === 'object'
    && value[DEFAULT_RQS_STORE_RESOLUTION_BRAND] === DEFAULT_RQS_STORE_RESOLUTION_BRAND_VALUE;
}

export function registerNativeRqsFiles(provider) {
  const { files, directory, implementation = null, randomBytes } = provider ?? {};
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new TypeError('native RQS files registration requires a non-empty directory');
  }
  for (const method of REQUIRED_NATIVE_FILES_METHODS) {
    if (typeof files?.[method] !== 'function') {
      throw new TypeError(`native RQS files registration requires files.${method}()`);
    }
  }
  if (randomBytes !== undefined && typeof randomBytes !== 'function') {
    throw new TypeError('randomBytes must be a function');
  }
  nativeRqsFiles = Object.freeze({
    files,
    directory,
    implementation,
    randomBytes,
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

const resolvedStore = (store, implementation, durable, reason) => ({
  store,
  info: Object.freeze({
    source: 'default',
    implementation,
    durable,
    reason,
  }),
});
const unavailableFallback = (reason) => resolvedStore(null, null, false, reason);

// @ref LLP 0008#decision-dk-9--client-local-store-mandate-2026-07-02 — an
// unavailable optional store degrades without taking the Online client down.
// LLP 0157's store-local handle key still stays CSPRNG-only: when even the
// memory carrier cannot mint it, report the unavailable rung instead of
// weakening the key or surfacing an internal constructor diagnostic.
const memoryFallback = (reason) => (
  typeof globalThis.crypto?.getRandomValues === 'function'
    ? resolvedStore(createMemoryRqsResumeStore(), 'memory', false, reason)
    : unavailableFallback('secure-random-unavailable')
);

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

// @ref LLP 0258#d3-custody-is-selected-by-capability-never-convenience-fallback
// — the first-party browser participant follows the same full owner-key
// isolation as auth custody. The digest is stable across contexts without
// exposing the raw storage partition in the browser's database registry.
const appOwnerDatabaseName = (ownerKey) => (
  `${RQS_STORE_DATABASE_NAME}.owner.${authCustodyOwnerKeyHash(ownerKey)}`
);

const disabledResolution = () => ({
  store: null,
  info: Object.freeze({
    source: 'disabled',
    implementation: null,
    durable: false,
    reason: 'SNAPBACK_CLIENT_RQS_STORE=off',
  }),
});

const resolveBrowserStore = ({
  indexedDB,
  lockManager,
  databaseName = RQS_STORE_DATABASE_NAME,
}) => {
  if (typeof indexedDB?.open !== 'function') return memoryFallback('indexeddb-unavailable');
  if (typeof lockManager?.request !== 'function') return memoryFallback('web-locks-unavailable');
  try {
    return resolvedStore(
      createIndexedDbRqsResumeStore({ indexedDB, lockManager, databaseName }),
      'indexeddb',
      true,
      null,
    );
  } catch (error) {
    return memoryFallback(error?.code ?? 'indexeddb-unavailable');
  }
};

const resolveNativeStore = (baseUrl) => {
  if (nativeRqsFiles === null) return memoryFallback('no-native-files-registered');
  if (
    typeof nativeRqsFiles.randomBytes !== 'function'
    && typeof globalThis.crypto?.getRandomValues !== 'function'
  ) return unavailableFallback('secure-random-unavailable');
  try {
    const store = createFileRqsResumeStore({
      directory: nativeRqsFiles.directory,
      files: nativeRqsFiles.files,
      identity: originIdentity(baseUrl),
      randomBytes: nativeRqsFiles.randomBytes,
    });
    const durable = store.durability().durable === true;
    return {
      ...resolvedStore(store, 'file', durable, durable ? null : 'native-files-no-power-loss-cut'),
      randomBytes: nativeRqsFiles.randomBytes,
    };
  } catch (error) {
    return memoryFallback(error?.code ?? 'native-files-unavailable');
  }
};

function resolveDefaultRqsStoreForEnvironment({
  baseUrl,
  appPlatform = null,
  appOwnerKey = null,
} = {}) {
  if (env('SNAPBACK_CLIENT_RQS_STORE') === 'off') {
    return disabledResolution();
  }
  if (appPlatform !== null) {
    if (['browser', 'expo-web'].includes(appPlatform.kind)) {
      if (appOwnerKey === null) {
        throw new TypeError('default RQS browser app platform requires an app owner key');
      }
      return resolveBrowserStore({
        indexedDB: appPlatform.indexedDB ?? globalThis.indexedDB,
        lockManager: appPlatform.lockManager ?? globalThis.navigator?.locks ?? null,
        // `appPlatform.databaseName` belongs to auth-custody carrier
        // injection. Queue ownership is derived only from LLP 0258's exact
        // (canonical app id, storage partition) owner key.
        databaseName: appOwnerDatabaseName(appOwnerKey),
      });
    }
    if (appPlatform.kind === 'expo-native') return resolveNativeStore(baseUrl);
    if (appPlatform.kind === 'memory') return memoryFallback('volatile-platform');
    throw new TypeError('default RQS app platform is invalid');
  }
  // Browser arm: IndexedDB with Web-Lock single-writer ownership.
  if (
    typeof globalThis.indexedDB?.open === 'function'
    && typeof globalThis.navigator?.locks?.request === 'function'
  ) {
    return resolveBrowserStore({
      indexedDB: globalThis.indexedDB,
      lockManager: globalThis.navigator.locks,
    });
  }
  // React Native arm: the app registers its platform filesystem module at
  // the root, keeping Metro's static closure free of platform imports.
  if (globalThis.navigator?.product === 'ReactNative') {
    return resolveNativeStore(baseUrl);
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
        return resolvedStore(store, 'file', true, null);
      } catch (error) {
        return memoryFallback(error?.code ?? 'file-store-unavailable');
      }
    }
    return memoryFallback('no-state-directory');
  }
  return memoryFallback('no-durable-backend');
}

export function resolveDefaultRqsStore(options = {}) {
  return resolveDefaultRqsStoreForEnvironment(options);
}
