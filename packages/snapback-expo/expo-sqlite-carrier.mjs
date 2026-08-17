// Expo-only default resolver. The universal client stays module-neutral;
// this integration package is the sole owner of the guarded native require.
//
// @ref LLP 0270#d6-arm-claims-are-receipt-scoped — the
//   packaged, SHA-bound allowlist is the only runtime promotion authority.
// @ref LLP 0166#d6--resume-delta-and-the-shipped-rqs-machinery — a legacy
//   file predecessor is fenced and discarded; its rows are never relabelled.

import publicationManifest from './expo-sqlite-carrier-publication.v1.json' with { type: 'json' };

import { createMemoryRqsResumeStore } from '@expo/snapback-client';
import {
  brandDefaultRqsStoreResolution,
  registeredNativeRqsFiles,
} from '@expo/snapback-client/rqs-store-default';
import {
  acquireLegacyFileRqsStoreMigrationLease,
  createFileRqsResumeStore,
  legacyFileRqsStorePath,
} from '@expo/snapback-client/rqs-store-file';
import { createExpoFilesAdapter } from '@expo/snapback-client/rqs-store-expo';
import { createExpoSqliteRqsResumeStore } from '@expo/snapback-client/rqs-store-sqlite';
import { hex, sha256 } from '@expo/snapback-client/rqs';
import {
  resolveDefaultExpoSqliteOperatingSystem,
  resolveDefaultExpoSqliteTarget,
} from './expo-sqlite-target.mjs';

export const EXPO_SQLITE_PUBLICATION_FORMAT = 'snapback.expo-sqlite-carrier-publication.v1';
export const EXPO_SQLITE_REGISTRY_SYMBOL = Symbol.for(
  '@expo/snapback-expo/expo-sqlite-carrier-registry.v1',
);

const encoder = new TextEncoder();
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const REQUIRED_PHASES = Object.freeze([
  'pending-durable-before-delivery',
  'server-result-before-local-settlement',
  'commit-loop',
  'committed-before-callback',
  'consumed-before-ack',
  'ack-proof-before-local-removal',
  'authority-wipe-before-successor',
]);
const TARGET_CELL_FIELDS = Object.freeze([
  'operatingSystem',
  'osVersion',
  'architecture',
  'distribution',
  'deviceClass',
]);
const REQUIRED_PACKAGE_IDENTITIES = Object.freeze([
  '@expo/snapback-client',
  '@expo/snapback-expo',
  'expo',
  'expo-device',
  'expo-sqlite',
  'react-native',
]);
const registry = () => {
  const existing = globalThis[EXPO_SQLITE_REGISTRY_SYMBOL];
  if (existing?.schemaVersion === 1 && existing.entries instanceof Map) return existing;
  const installed = { schemaVersion: 1, entries: new Map() };
  Object.defineProperty(globalThis, EXPO_SQLITE_REGISTRY_SYMBOL, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: installed,
  });
  return installed;
};

const resolved = (store, implementation, durable, reason, randomBytes = undefined) => (
  brandDefaultRqsStoreResolution({
    store,
    info: Object.freeze({ source: 'default', implementation, durable, reason }),
    ...(randomBytes === undefined ? {} : { randomBytes }),
  })
);
const memoryResolution = (reason) => {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    return resolved(null, null, false, 'secure-random-unavailable');
  }
  return resolved(createMemoryRqsResumeStore(), 'memory', false, reason);
};

const canonicalOrigin = (value) => {
  const url = new URL(value);
  return url.origin;
};
const appIdentity = (app) => JSON.stringify([
  app?.identity?.app ?? null,
  app?.identity?.schema ?? null,
  app?.identity?.functions ?? null,
  app?.identity?.descriptor ?? null,
]);
export function expoSqliteDatabaseName({ app, storagePartition = 'default', origin }) {
  const digest = hex(sha256(encoder.encode(JSON.stringify([
    appIdentity(app),
    storagePartition,
    canonicalOrigin(origin),
  ]))));
  return `snapback-rqs-${digest.slice(0, 40)}.sqlite`;
}
const fileIdentity = (origin) => `origin:${canonicalOrigin(origin)}`;

async function operatingSystem(environment) {
  if (typeof environment?.resolveExpoSqliteOperatingSystem === 'function') {
    return environment.resolveExpoSqliteOperatingSystem();
  }
  return resolveDefaultExpoSqliteOperatingSystem({
    resolveReactNativeModule: environment?.resolveExpoSqliteReactNativeModule,
  });
}

async function targetFacts(environment, os) {
  if (typeof environment?.resolveExpoSqliteTarget === 'function') {
    const explicit = await environment.resolveExpoSqliteTarget();
    return Object.freeze({ operatingSystem: os, ...(explicit ?? {}) });
  }
  return resolveDefaultExpoSqliteTarget({
    operatingSystem: os,
    resolveReactNativeModule: environment?.resolveExpoSqliteReactNativeModule,
    resolveExpoDeviceModule: environment?.resolveExpoDeviceModule,
  });
}

function rowsForTarget(manifest, target) {
  if (
    manifest?.schemaVersion !== EXPO_SQLITE_PUBLICATION_FORMAT
    || manifest.profile !== 'durable-fragments-v1'
    || !Array.isArray(manifest.rows)
  ) return [];
  return manifest.rows.filter((row) => {
    if (!publicationRowAdmitted(row) || row.target === null) return false;
    return Object.entries(row.target).every(([key, value]) => target[key] === value);
  });
}

const exactRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === 'string' && value.length > 0;
const targetFact = (value) => nonEmptyString(value) && value !== 'unknown';
const digest = (value) => typeof value === 'string' && digestPattern.test(value);

// Publication rows are reviewed evidence bindings, not runtime self-attestation.
// Keep every memo §3 closure axis mandatory so dropping any receipt/artifact/
// target fact makes the row ineligible instead of silently weakening a claim.
export function publicationRowAdmitted(row) {
  if (
    !exactRecord(row)
    || row.profile !== 'durable-fragments-v1'
    || row.arm !== 'expo'
    || row.carrier !== 'expo-sqlite'
    || !exactRecord(row.target)
    || TARGET_CELL_FIELDS.some((field) => !targetFact(row.target[field]))
  ) return false;
  const receipt = row.acceptedReceipt;
  if (
    !exactRecord(receipt)
    || receipt.schemaVersion !== 'snapback.expo-sqlite-carrier-qualification.v1'
    || receipt.verdict !== 'accepted'
    || !nonEmptyString(receipt.path)
    || !digest(receipt.sha256)
  ) return false;
  if (
    !exactRecord(row.claimSourceClosure)
    || Object.keys(row.claimSourceClosure).length === 0
    || !Object.entries(row.claimSourceClosure).every(([path, hash]) => nonEmptyString(path) && digest(hash))
  ) return false;
  const artifacts = row.artifacts;
  if (
    !exactRecord(artifacts)
    || !digest(artifacts.jsBundleSha256)
    || !digest(artifacts.nativeBinarySha256)
    || !Array.isArray(artifacts.packages)
  ) return false;
  const packages = new Map(artifacts.packages.map((entry) => [entry?.name, entry]));
  for (const name of REQUIRED_PACKAGE_IDENTITIES) {
    const identity = packages.get(name);
    if (!exactRecord(identity) || !nonEmptyString(identity.version) || !digest(identity.sha256)) return false;
  }
  const cell = row.targetCell;
  if (
    !exactRecord(cell)
    || cell.complete !== true
    || TARGET_CELL_FIELDS.some((field) => cell[field] !== row.target[field])
    || !Number.isSafeInteger(cell.processCuts)
    || cell.processCuts < 100
    || !Number.isSafeInteger(cell.powerCuts)
    || cell.powerCuts < 25
    || !Array.isArray(cell.phases)
    || REQUIRED_PHASES.some((phase) => !cell.phases.includes(phase))
  ) return false;
  const battery = row.completeBatteryReference;
  return exactRecord(battery)
    && nonEmptyString(battery.path)
    && digest(battery.sha256)
    && nonEmptyString(battery.qualifiedCommit);
}

function engineMatches(row, facts) {
  const expected = row?.sqlite;
  if (expected === null || typeof expected !== 'object') return false;
  if (expected.sourceId !== facts.sqliteSourceId) return false;
  if (!Array.isArray(expected.compileOptions)) return false;
  return JSON.stringify([...expected.compileOptions].sort())
    === JSON.stringify([...facts.compileOptions].sort());
}

async function loadNativeSqlite(environment) {
  try {
    if (typeof environment?.resolveExpoSqliteModule === 'function') {
      return await environment.resolveExpoSqliteModule();
    }
    if (typeof require === 'function') return require('expo-sqlite');
  } catch (cause) {
    const error = new Error('Expo SQLite native module resolution is unavailable');
    error.code = 'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }
  const error = new Error('Expo SQLite native module resolution is unavailable');
  error.code = 'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE';
  throw error;
}

const errorReason = (error) => {
  switch (error?.code) {
    case 'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE':
      return 'expo-sqlite-native-module-unavailable';
    case 'SNAPBACK_EXPO_SQLITE_DURABILITY_PRAGMAS_UNAVAILABLE':
      return 'expo-sqlite-durability-pragmas-unavailable';
    case 'SNAPBACK_EXPO_SQLITE_STORE_OWNER_UNAVAILABLE':
      return 'expo-sqlite-store-owner-unavailable';
    case 'SNAPBACK_EXPO_SQLITE_STORE_CLOSE_FAILED':
      return 'expo-sqlite-store-close-failed';
    case 'SNAPBACK_EXPO_SQLITE_STORE_CORRUPT':
      return 'expo-sqlite-store-corrupt';
    case 'SNAPBACK_EXPO_SQLITE_MULTI_PROCESS_HOST_UNSUPPORTED':
      return 'expo-sqlite-multi-process-host-unsupported';
    default:
      return 'expo-sqlite-store-corrupt';
  }
};

const legacyResolution = (registration, origin, reason) => {
  const store = createFileRqsResumeStore({
    directory: registration.directory,
    files: registration.files,
    identity: fileIdentity(origin),
    randomBytes: registration.randomBytes,
  });
  return resolved(store, 'file', false, reason, registration.randomBytes);
};

const validLegacyProvider = (provider) => (
  exactRecord(provider)
  && nonEmptyString(provider.directory)
  && typeof provider.files?.readFile === 'function'
  && typeof provider.files?.unlink === 'function'
  && typeof provider.files?.writeFileExclusive === 'function'
);

async function automaticLegacyProvider(environment) {
  const registered = registeredNativeRqsFiles();
  if (registered !== null) return registered;
  const explicit = await environment?.resolveExpoLegacyRqsFiles?.();
  if (explicit !== undefined && explicit !== null) return validLegacyProvider(explicit) ? explicit : null;
  let fileSystem;
  try {
    if (typeof environment?.resolveExpoFileSystemModule === 'function') {
      fileSystem = await environment.resolveExpoFileSystemModule();
    } else if (typeof require === 'function') {
      fileSystem = require('expo-file-system');
    }
    fileSystem = fileSystem?.default ?? fileSystem;
    if (
      typeof fileSystem?.File !== 'function'
      || typeof fileSystem?.Directory !== 'function'
      || fileSystem?.Paths?.document == null
    ) return null;
    return Object.freeze({
      files: createExpoFilesAdapter(fileSystem),
      directory: new fileSystem.Directory(fileSystem.Paths.document, 'snapback-rqs').uri,
      implementation: 'file',
    });
  } catch {
    return null;
  }
}

async function refuseForLegacyWriter(store, provider, origin) {
  await store.close();
  return provider === null
    ? memoryResolution('expo-legacy-file-writer-active')
    : legacyResolution(provider, origin, 'expo-legacy-file-writer-active');
}

async function prepareQualifiedResolution({
  app,
  origin,
  storagePartition,
  environment,
  row,
  os,
  databaseName,
  runtimeKind,
}) {
  let store;
  try {
    const sqlite = await loadNativeSqlite(environment);
    store = await createExpoSqliteRqsResumeStore({
      sqlite,
      databaseName,
      platformOperatingSystem: os,
      randomBytes: environment?.expoSqliteRandomBytes,
      faultInjector: environment?.expoSqliteFaultInjector ?? null,
      qualificationMaxPageCount: environment?.expoSqliteQualificationMaxPageCount ?? null,
      runtimeKind,
    });
  } catch (error) {
    return memoryResolution(errorReason(error));
  }
  if (!engineMatches(row, store.qualificationFacts())) {
    await store.close();
    return memoryResolution('expo-sqlite-engine-unqualified');
  }

  const identity = fileIdentity(origin);
  const provider = await automaticLegacyProvider(environment);
  const pendingFences = (await store.predecessorFences()).filter((fence) => fence.pendingDelete === true);

  // Durable successor state is the crash-recovery authority. Replay every
  // pending predecessor deletion before any qualified exposure, regardless of
  // whether the legacy registration ceremony still exists in this process.
  for (const fence of pendingFences) {
    if (provider === null) {
      await store.close();
      return memoryResolution('expo-legacy-file-state-unreadable');
    }
    const expectedPath = legacyFileRqsStorePath({ directory: provider.directory, identity });
    if (fence.pathIdentity !== expectedPath) {
      await store.close();
      return memoryResolution('expo-legacy-file-state-unreadable');
    }
    let migrationLease;
    try {
      migrationLease = await acquireLegacyFileRqsStoreMigrationLease({
        directory: provider.directory,
        files: provider.files,
        identity,
      });
      if (migrationLease.status !== 'acquired') {
        return refuseForLegacyWriter(store, provider, origin);
      }
      await migrationLease.deleteAndConfirmAbsent();
      if ((await store.confirmPredecessorAbsent(
        fence.predecessorClientStoreId,
        fence.pathIdentity,
      )) !== true) throw new Error('durable predecessor fence disappeared before confirmation');
    } catch {
      await store.close();
      return memoryResolution('expo-legacy-file-state-unreadable');
    } finally {
      await migrationLease?.release?.();
    }
  }

  // The no-ceremony path still inspects a legacy blob at the automatically
  // derived location. Inspection and deletion both occur while holding the
  // actual writer lock, so a legacy writer cannot enqueue between them.
  if (provider !== null) {
    let migrationLease;
    try {
      migrationLease = await acquireLegacyFileRqsStoreMigrationLease({
        directory: provider.directory,
        files: provider.files,
        identity,
      });
      if (migrationLease.status !== 'acquired') {
        return refuseForLegacyWriter(store, provider, origin);
      }
      const migration = await migrationLease.inspect();
    if (migration.status === 'pending-custody') {
      await store.close();
      return legacyResolution(
        provider,
        origin,
        'expo-legacy-file-pending-custody',
      );
    }
    if (migration.status === 'unreadable') {
      await store.close();
      return memoryResolution('expo-legacy-file-state-unreadable');
    }
    if (migration.status === 'discardable') {
        await store.recordPredecessorFence(migration);
        await migrationLease.deleteAndConfirmAbsent();
        if ((await store.confirmPredecessorAbsent(
          migration.predecessorClientStoreId,
          migration.pathIdentity,
        )) !== true) throw new Error('durable predecessor fence disappeared before confirmation');
      }
    } catch {
      await store.close();
      return memoryResolution('expo-legacy-file-state-unreadable');
    } finally {
      await migrationLease?.release?.();
    }
  }
  return resolved(store, 'expo-sqlite', true, null, environment?.expoSqliteRandomBytes);
}

async function resolveDefault({
  app,
  origin,
  storagePartition,
  environment,
  manifest,
  qualificationRow,
  databaseName,
  runtimeKind,
}) {
  const os = await operatingSystem(environment);
  if (!['ios', 'android'].includes(os)) {
    return memoryResolution('expo-sqlite-platform-unsupported');
  }
  if (runtimeKind !== 'main-app') {
    return memoryResolution('expo-sqlite-multi-process-host-unsupported');
  }
  const target = await targetFacts(environment, os);
  const effectiveRows = qualificationRow === null ? rowsForTarget(manifest, target) : [qualificationRow];
  if (qualificationRow === null && Array.isArray(manifest?.rows) && manifest.rows.length === 0) {
    const legacy = registeredNativeRqsFiles();
    return legacy === null
      ? memoryResolution('expo-sqlite-carrier-pending-qualification')
      : legacyResolution(legacy, origin, 'native-files-no-power-loss-cut');
  }
  if (effectiveRows.length === 0) return memoryResolution('expo-sqlite-target-unqualified');
  return prepareQualifiedResolution({
    app,
    origin,
    storagePartition,
    environment,
    row: effectiveRows[0],
    os,
    databaseName,
    runtimeKind,
  });
}

export async function acquireExpoSqliteDefaultRqsStore({
  app,
  binding,
  storagePartition = 'default',
  environment = null,
  manifest = publicationManifest,
  // Qualification/test-only manifest bypass. Product provider never sets it.
  qualificationRow = null,
  runtimeKind = null,
} = {}) {
  const origin = binding?.target?.origin;
  const databaseName = expoSqliteDatabaseName({ app, storagePartition, origin });
  const state = registry();
  const effectiveRuntimeKind = runtimeKind
    ?? await environment?.resolveExpoSqliteRuntimeKind?.()
    ?? 'main-app';
  const registryKey = `${databaseName}\0${effectiveRuntimeKind}`;
  let entry;
  while (true) {
    entry = state.entries.get(registryKey);
    if (entry?.state === 'closing') {
      try { await entry.closePromise; } catch { /* state becomes close-failed */ }
      continue;
    }
    if (entry?.state === 'close-failed') {
      const resolution = memoryResolution('expo-sqlite-store-close-failed');
      let refusalReleased = false;
      return Object.freeze({
        databaseName,
        resolution,
        async release() {
          if (refusalReleased) return;
          refusalReleased = true;
          await resolution.store?.close?.();
        },
      });
    }
    break;
  }
  if (entry === undefined) {
    entry = {
      references: 0,
      state: 'open',
      closePromise: null,
      closeError: null,
      promise: resolveDefault({
        app,
        origin,
        storagePartition,
        environment,
        manifest,
        qualificationRow,
        databaseName,
        runtimeKind: effectiveRuntimeKind,
      }),
    };
    state.entries.set(registryKey, entry);
  }
  entry.references += 1;
  let released = false;
  let referenceDropped = false;
  const resolution = await entry.promise;
  const closeEntry = () => {
    if (entry.state === 'closing') return entry.closePromise;
    entry.state = 'closing';
    entry.closeError = null;
    const attempt = Promise.resolve().then(() => resolution.store?.close?.());
    entry.closePromise = attempt.then(
      () => {
        entry.state = 'closed';
        if (state.entries.get(registryKey) === entry) state.entries.delete(registryKey);
      },
      (cause) => {
        const error = new Error('the Expo SQLite store owner failed to close');
        error.code = 'SNAPBACK_EXPO_SQLITE_STORE_CLOSE_FAILED';
        error.cause = cause;
        entry.state = 'close-failed';
        entry.closeError = error;
        throw error;
      },
    );
    return entry.closePromise;
  };
  return Object.freeze({
    databaseName,
    resolution,
    async release() {
      if (released) return;
      if (!referenceDropped) {
        referenceDropped = true;
        entry.references -= 1;
      }
      if (entry.references !== 0) {
        released = true;
        return;
      }
      await closeEntry();
      released = true;
    },
  });
}

export async function __resetExpoSqliteCarrierRegistryForTests() {
  const state = registry();
  const entries = [...state.entries.values()];
  for (const entry of entries) {
    try {
      if (entry.state === 'closing') await entry.closePromise;
      else await (await entry.promise).store?.close?.();
    } catch { /* test cleanup */ }
  }
  state.entries.clear();
}
