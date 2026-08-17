import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clearNativeRqsFiles,
  registerNativeRqsFiles,
} from '@expo/snapback-client/rqs-store-default';
import {
  createFileRqsResumeStore,
  createNodeFilesAdapter,
  inspectLegacyFileRqsStore,
  legacyFileRqsStorePath,
} from '@expo/snapback-client/rqs-store-file';
import { createSqliteRqsResumeStore } from '@expo/snapback-client/rqs-store-sqlite';

import { createNodeSqliteNamespace } from '../../demos/expo-local-first-carrier/node-sqlite-adapter.mjs';
import { runBrokenStoreNegativeControl } from '../../demos/expo-local-first-carrier/scripts/node-recovery-verifier.mjs';
import {
  __resetExpoSqliteCarrierRegistryForTests,
  acquireExpoSqliteDefaultRqsStore,
  expoSqliteDatabaseName,
  publicationRowAdmitted,
} from './expo-sqlite-carrier.mjs';
import { createSnapbackExpoBoot } from './provider.mjs';
import { createSupervisedExpoEnvironment } from './supervised-environment.mjs';

const roots = [];
const root = async () => {
  const value = await mkdtemp(join(tmpdir(), 'snapback-expo-sqlite-test-'));
  roots.push(value);
  return value;
};
after(async () => {
  await __resetExpoSqliteCarrierRegistryForTests();
  clearNativeRqsFiles();
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true })));
});
beforeEach(async () => {
  await __resetExpoSqliteCarrierRegistryForTests();
  clearNativeRqsFiles();
});

const app = Object.freeze(JSON.parse(await readFile(new URL(
  '../../demos/zero-bakeoff/apps/field-notebook/snapback/generated/app.descriptor.json',
  import.meta.url,
), 'utf8')));
const binding = Object.freeze({
  format: 'snapback.app-binding.v1',
  source: 'supervised-dev',
  descriptorIdentity: app.identity.descriptor,
  target: Object.freeze({
    app: app.identity.app,
    schema: app.identity.schema,
    functions: app.identity.functions,
    origin: 'http://127.0.0.1:4317',
    routing: 'loopback',
  }),
  capabilities: Object.freeze({ offered: Object.freeze([...app.capabilities.required]) }),
  provenance: Object.freeze({
    supervisorGeneration: 'expo-carrier-test-generation',
    issuedAt: '2026-08-16T12:00:00.000Z',
    expiresAt: '2026-08-16T14:00:00.000Z',
  }),
  integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
});
const target = Object.freeze({
  operatingSystem: 'android',
  osVersion: '35',
  architecture: 'arm64-v8a',
  distribution: 'release',
  deviceClass: 'real-device',
});
const env = (sqlite, overrides = {}) => Object.freeze({
  async resolveExpoSqliteOperatingSystem() { return 'android'; },
  async resolveExpoSqliteTarget() { return target; },
  async resolveExpoSqliteModule() { return sqlite; },
  ...overrides,
});

async function rowFor(sqlite) {
  const directory = await root();
  const probe = await createSqliteRqsResumeStore({ sqlite, databaseName: 'facts.sqlite' });
  const facts = probe.qualificationFacts();
  await probe.close();
  return Object.freeze({
    profile: 'durable-fragments-v1',
    target,
    sqlite: Object.freeze({ sourceId: facts.sqliteSourceId, compileOptions: facts.compileOptions }),
  });
}

const fixtureDigest = `sha256:${'ab'.repeat(32)}`;
async function publicationRowFor(sqlite) {
  const row = await rowFor(sqlite);
  return Object.freeze({
    ...row,
    arm: 'expo',
    carrier: 'expo-sqlite',
    acceptedReceipt: Object.freeze({
      schemaVersion: 'snapback.expo-sqlite-carrier-qualification.v1',
      verdict: 'accepted',
      path: 'tests/acceptance/receipts/expo-android.json',
      sha256: fixtureDigest,
    }),
    claimSourceClosure: Object.freeze({
      'packages/snapback-client/rqs-store-sqlite.mjs': fixtureDigest,
      'packages/snapback-expo/expo-sqlite-carrier.mjs': fixtureDigest,
    }),
    artifacts: Object.freeze({
      jsBundleSha256: fixtureDigest,
      nativeBinarySha256: fixtureDigest,
      packages: Object.freeze([
        Object.freeze({ name: '@expo/snapback-client', version: '0.1.0', sha256: fixtureDigest }),
        Object.freeze({ name: '@expo/snapback-expo', version: '0.1.0', sha256: fixtureDigest }),
        Object.freeze({ name: 'expo', version: '57.0.7', sha256: fixtureDigest }),
        Object.freeze({ name: 'expo-device', version: '57.0.1', sha256: fixtureDigest }),
        Object.freeze({ name: 'expo-sqlite', version: '57.0.1', sha256: fixtureDigest }),
        Object.freeze({ name: 'react-native', version: '0.86.2', sha256: fixtureDigest }),
      ]),
    }),
    targetCell: Object.freeze({
      complete: true,
      operatingSystem: target.operatingSystem,
      osVersion: target.osVersion,
      architecture: target.architecture,
      distribution: target.distribution,
      deviceClass: target.deviceClass,
      processCuts: 100,
      powerCuts: 25,
      phases: Object.freeze([
        'pending-durable-before-delivery',
        'server-result-before-local-settlement',
        'commit-loop',
        'committed-before-callback',
        'consumed-before-ack',
        'ack-proof-before-local-removal',
        'authority-wipe-before-successor',
      ]),
    }),
    completeBatteryReference: Object.freeze({
      path: 'llp/receipts/local-proof.json',
      sha256: fixtureDigest,
      qualifiedCommit: '0123456789abcdef',
    }),
  });
}

test('packaged empty publication resolves default memory as pending qualification', async () => {
  const lease = await acquireExpoSqliteDefaultRqsStore({ app, binding, environment: env(null) });
  assert.deepEqual(lease.resolution.info, {
    source: 'default',
    implementation: 'memory',
    durable: false,
    reason: 'expo-sqlite-carrier-pending-qualification',
  });
  await lease.release();
});

test('qualification negative control drives a broken store through worker recovery and verifier', async () => {
  const directory = await root();
  const openStore = (storeDirectory) => createSqliteRqsResumeStore({
    sqlite: createNodeSqliteNamespace(storeDirectory),
    databaseName: 'qualification.sqlite',
  });
  const outcome = await runBrokenStoreNegativeControl({
    directory,
    workerPath: fileURLToPath(new URL(
      '../../demos/expo-local-first-carrier/scripts/node-worker.mjs',
      import.meta.url,
    )),
    openStore,
  });
  assert.equal(outcome.expectedHarnessVerdict, 'fail');
  assert.equal(outcome.observedHarnessVerdict, 'fail');
  assert.equal(outcome.storeImplementation, 'drop-generation-membership-write');
  assert.match(outcome.failureMessage, /generation is hybrid/u);
});

test('unsupported platform and unmatched target have exact typed default rows', async () => {
  const unsupported = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(null, { async resolveExpoSqliteOperatingSystem() { return 'web'; } }),
  });
  assert.equal(unsupported.resolution.info.reason, 'expo-sqlite-platform-unsupported');
  await unsupported.release();
  const unmatched = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(null),
    manifest: {
      schemaVersion: 'snapback.expo-sqlite-carrier-publication.v1',
      profile: 'durable-fragments-v1',
      rows: [{ profile: 'durable-fragments-v1', target: { operatingSystem: 'ios' } }],
    },
  });
  assert.equal(unmatched.resolution.info.reason, 'expo-sqlite-target-unqualified');
  await unmatched.release();
});

test('packaged publication admission rejects a minimal self-asserted row', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const minimal = await rowFor(sqlite);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite),
    manifest: {
      schemaVersion: 'snapback.expo-sqlite-carrier-publication.v1',
      profile: 'durable-fragments-v1',
      rows: [minimal],
    },
  });
  assert.equal(lease.resolution.info.reason, 'expo-sqlite-target-unqualified');
  assert.equal(lease.resolution.info.durable, false);
  await lease.release();
});

test('packaged publication admission requires and accepts the complete evidence binding', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const complete = await publicationRowFor(sqlite);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite),
    manifest: {
      schemaVersion: 'snapback.expo-sqlite-carrier-publication.v1',
      profile: 'durable-fragments-v1',
      rows: [complete],
    },
  });
  assert.deepEqual(lease.resolution.info, {
    source: 'default', implementation: 'expo-sqlite', durable: true, reason: null,
  });
  await lease.release();
});

test('device receipt source binds run identity, full target facts, and installed package artifacts', async () => {
  const source = await readFile(new URL(
    '../../demos/expo-local-first-carrier/scripts/qualify.mjs',
    import.meta.url,
  ), 'utf8');
  assert.match(source, /const receipt = \{[\s\S]*?runId,[\s\S]*?seed,/u);
  assert.match(source, /target: \{ \.\.\.runtimeTargetFacts, mode \}/u);
  assert.match(source, /targetCell: \{[\s\S]*?\.\.\.runtimeTargetFacts,/u);
  assert.match(source, /sha256: await digestPackageDirectory\(root\)/u);
  assert.doesNotMatch(source, /hashFile\(probePackagePath\)/u);
  for (const packageName of ['expo', 'expo-device', 'expo-sqlite', 'react-native']) {
    assert.equal(source.includes(`'${packageName}'`), true);
  }
});

for (const field of ['operatingSystem', 'osVersion', 'architecture', 'distribution', 'deviceClass']) {
  test(`publication admission rejects missing target.${field}`, async () => {
    const directory = await root();
    const complete = await publicationRowFor(createNodeSqliteNamespace(directory));
    const { [field]: _missing, ...targetWithoutField } = complete.target;
    assert.equal(publicationRowAdmitted({ ...complete, target: targetWithoutField }), false);
  });

  test(`publication admission rejects missing targetCell.${field}`, async () => {
    const directory = await root();
    const complete = await publicationRowFor(createNodeSqliteNamespace(directory));
    const { [field]: _missing, ...cellWithoutField } = complete.targetCell;
    assert.equal(publicationRowAdmitted({ ...complete, targetCell: cellWithoutField }), false);
  });
}

for (const packageName of [
  '@expo/snapback-client',
  '@expo/snapback-expo',
  'expo',
  'expo-device',
  'expo-sqlite',
  'react-native',
]) {
  test(`publication admission rejects missing package identity ${packageName}`, async () => {
    const directory = await root();
    const complete = await publicationRowFor(createNodeSqliteNamespace(directory));
    const packages = complete.artifacts.packages.filter((entry) => entry.name !== packageName);
    assert.equal(publicationRowAdmitted({
      ...complete,
      artifacts: { ...complete.artifacts, packages },
    }), false);
  });
}

test('framework default target resolver activates a matching admitted row without a custom target resolver', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const frameworkEnvironment = createSupervisedExpoEnvironment({
    async resolveExpoSqliteReactNativeModule() {
      return { Platform: { OS: 'android', Version: 35 } };
    },
    async resolveExpoDeviceModule() {
      return { isDevice: true, supportedCpuArchitectures: ['arm64-v8a'] };
    },
  });
  const environment = Object.freeze({
    ...frameworkEnvironment,
    async resolveExpoSqliteModule() { return sqlite; },
  });
  const complete = await publicationRowFor(sqlite);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment,
    manifest: {
      schemaVersion: 'snapback.expo-sqlite-carrier-publication.v1',
      profile: 'durable-fragments-v1',
      rows: [complete],
    },
  });
  assert.equal(Object.hasOwn(environment, 'resolveExpoSqliteTarget'), true);
  assert.deepEqual(lease.resolution.info, {
    source: 'default', implementation: 'expo-sqlite', durable: true, reason: null,
  });
  await lease.release();
});

test('native absence, engine mismatch, pragma refusal, owner contention, and corruption map exactly', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const row = await rowFor(sqlite);
  const unavailable = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(null, { async resolveExpoSqliteModule() { throw Object.assign(new Error('unlinked'), { code: 'SNAPBACK_EXPO_SQLITE_NATIVE_API_UNAVAILABLE' }); } }),
    qualificationRow: row,
  });
  assert.equal(unavailable.resolution.info.reason, 'expo-sqlite-native-module-unavailable');
  await unavailable.release();

  const mismatch = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite),
    qualificationRow: { ...row, sqlite: { ...row.sqlite, sourceId: 'different' } },
  });
  assert.equal(mismatch.resolution.info.reason, 'expo-sqlite-engine-unqualified');
  await mismatch.release();

  const badPragma = {
    async openDatabaseAsync(...args) {
      const db = await sqlite.openDatabaseAsync(...args);
      return { ...db, async getFirstAsync(sqlText, ...parameters) {
        if (sqlText === 'PRAGMA synchronous') return { synchronous: 1 };
        return db.getFirstAsync(sqlText, ...parameters);
      } };
    },
  };
  const pragma = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(badPragma),
    qualificationRow: row,
  });
  assert.equal(pragma.resolution.info.reason, 'expo-sqlite-durability-pragmas-unavailable');
  await pragma.release();

  const databaseName = expoSqliteDatabaseName({ app, origin: binding.target.origin });
  const owner = await createSqliteRqsResumeStore({ sqlite, databaseName });
  const busy = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite),
    qualificationRow: row,
  });
  assert.equal(busy.resolution.info.reason, 'expo-sqlite-store-owner-unavailable');
  await busy.release();
  await owner.close();

  const seed = await createSqliteRqsResumeStore({ sqlite, databaseName });
  await seed.close();
  const raw = new DatabaseSync(join(directory, databaseName));
  raw.exec('PRAGMA user_version=99');
  raw.close();
  const corrupt = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite),
    qualificationRow: row,
  });
  assert.equal(corrupt.resolution.info.reason, 'expo-sqlite-store-corrupt');
  await corrupt.release();

  const extension = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite, { async resolveExpoSqliteRuntimeKind() { return 'share-extension'; } }),
    qualificationRow: row,
  });
  assert.equal(extension.resolution.info.reason, 'expo-sqlite-multi-process-host-unsupported');
  await extension.release();
});

test('qualified acquisition reports expo-sqlite durable and coalesces one refcounted store', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const row = await rowFor(sqlite);
  const first = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  const second = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  assert.strictEqual(first.resolution.store, second.resolution.store);
  assert.deepEqual(first.resolution.info, {
    source: 'default', implementation: 'expo-sqlite', durable: true, reason: null,
  });
  await first.release();
  assert.equal((await second.resolution.store.inspection()).writer, true);
  await second.release();
});

test('default resolution branding survives a client module reload', async () => {
  const directory = await root();
  const sqlite = createNodeSqliteNamespace(directory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  const reloaded = await import(new URL(
    `../snapback-client/rqs-store-default.mjs?hmr=${Date.now()}`,
    import.meta.url,
  ));
  assert.equal(reloaded.isDefaultRqsStoreResolution(lease.resolution), true);
  await lease.release();
});

test('reacquire waits for the in-flight last-owner close before opening fresh', async () => {
  const directory = await root();
  const base = createNodeSqliteNamespace(directory);
  let closing = false;
  let openDuringClose = 0;
  let resolveCloseStarted;
  const closeStarted = new Promise((resolve) => { resolveCloseStarted = resolve; });
  const sqlite = Object.freeze({
    async openDatabaseAsync(...args) {
      if (closing) openDuringClose += 1;
      const database = await base.openDatabaseAsync(...args);
      return Object.freeze({
        ...database,
        async closeAsync() {
          closing = true;
          resolveCloseStarted();
          await new Promise((resolve) => setTimeout(resolve, 50));
          await database.closeAsync();
          closing = false;
        },
      });
    },
  });
  const row = await rowFor(sqlite);
  const first = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  const firstStore = first.resolution.store;
  const releasing = first.release();
  await closeStarted;
  const second = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  await releasing;
  assert.equal(openDuringClose, 0);
  assert.notStrictEqual(second.resolution.store, firstStore);
  assert.deepEqual(second.resolution.info, {
    source: 'default', implementation: 'expo-sqlite', durable: true, reason: null,
  });
  await second.release();
});

test('throwing close retains a typed close-failed registry entry and permits close retry', async () => {
  const directory = await root();
  const base = createNodeSqliteNamespace(directory);
  const row = await rowFor(base);
  let carrierOpenCount = 0;
  let closeAttempts = 0;
  const sqlite = Object.freeze({
    async openDatabaseAsync(name, options) {
      const database = await base.openDatabaseAsync(name, options);
      carrierOpenCount += 1;
      return Object.freeze({
        ...database,
        async closeAsync() {
          closeAttempts += 1;
          if (closeAttempts === 1) throw new Error('injected close failure');
          await database.closeAsync();
        },
      });
    },
  });
  const first = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  await assert.rejects(first.release(), (error) => (
    error?.code === 'SNAPBACK_EXPO_SQLITE_STORE_CLOSE_FAILED'
      && error?.cause?.message === 'injected close failure'
  ));
  assert.equal((await first.resolution.store.inspection()).writer, true);

  const refused = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  assert.deepEqual(refused.resolution.info, {
    source: 'default',
    implementation: 'memory',
    durable: false,
    reason: 'expo-sqlite-store-close-failed',
  });
  assert.equal(carrierOpenCount, 1, 'reacquisition does not open a replacement over the failed owner');
  await refused.release();

  await first.release();
  assert.equal(closeAttempts, 2, 'the original last-owner lease retries close');
  const recovered = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: row,
  });
  assert.equal(recovered.resolution.info.reason, null);
  assert.equal(carrierOpenCount, 2);
  await recovered.release();
});

async function registeredLegacy(directory, { pending = false, unreadable = false } = {}) {
  const files = createNodeFilesAdapter();
  registerNativeRqsFiles({ files, directory, implementation: 'expo-file-system' });
  const identity = `origin:${new URL(binding.target.origin).origin}`;
  const path = legacyFileRqsStorePath({ directory, identity });
  if (unreadable) {
    await files.mkdir(directory);
    await writeFile(path, '{not-json');
    return { files, path };
  }
  const store = createFileRqsResumeStore({ directory, files, identity });
  await store.whenLockSettled();
  if (pending) await store.outboxEnqueue({ id: 'legacy-intent', function: 'createThing' });
  await store.close();
  return { files, path };
}

test('legacy pending custody remains on the non-claiming file carrier', async () => {
  const legacyDirectory = await root();
  await registeredLegacy(legacyDirectory, { pending: true });
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.deepEqual(lease.resolution.info, {
    source: 'default',
    implementation: 'file',
    durable: false,
    reason: 'expo-legacy-file-pending-custody',
  });
  assert.equal((await lease.resolution.store.outboxRecords())[0].id, 'legacy-intent');
  await lease.release();
});

test('legacy unreadable bytes are preserved and resolve exact memory refusal', async () => {
  const legacyDirectory = await root();
  const { path } = await registeredLegacy(legacyDirectory, { unreadable: true });
  const before = await readFile(path, 'utf8');
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.equal(lease.resolution.info.reason, 'expo-legacy-file-state-unreadable');
  assert.equal(await readFile(path, 'utf8'), before);
  await lease.release();
});

test('empty legacy v3 is fenced, deleted with confirmed absence, and never adopted', async () => {
  const legacyDirectory = await root();
  const { path } = await registeredLegacy(legacyDirectory);
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.equal(lease.resolution.info.reason, null);
  await assert.rejects(readFile(path), (error) => error?.code === 'ENOENT');
  const fences = await lease.resolution.store.predecessorFences();
  assert.equal(fences.length, 1);
  assert.equal(fences[0].disposition, 'discard-and-refetch');
  assert.equal(fences[0].pendingDelete, false);
  assert.equal((await lease.resolution.store.inspection()).entries, 0);
  await lease.release();
});

test('durable pending-delete fence blocks exposure without registration and crash-repeats from its row', async () => {
  const legacyDirectory = await root();
  const { files, path } = await registeredLegacy(legacyDirectory);
  const identity = `origin:${new URL(binding.target.origin).origin}`;
  const migration = await inspectLegacyFileRqsStore({ directory: legacyDirectory, files, identity });
  assert.equal(migration.status, 'discardable');
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const databaseName = expoSqliteDatabaseName({ app, origin: binding.target.origin });
  const successor = await createSqliteRqsResumeStore({ sqlite, databaseName });
  await successor.recordPredecessorFence(migration);
  await successor.close();
  clearNativeRqsFiles();

  const blocked = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.equal(blocked.resolution.info.reason, 'expo-legacy-file-state-unreadable');
  assert.equal((await readFile(path, 'utf8')).length > 0, true);
  await blocked.release();

  const replayed = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite, {
      async resolveExpoLegacyRqsFiles() { return { files, directory: legacyDirectory }; },
    }),
    qualificationRow: await rowFor(sqlite),
  });
  assert.equal(replayed.resolution.info.durable, true);
  await assert.rejects(readFile(path), (error) => error?.code === 'ENOENT');
  assert.equal((await replayed.resolution.store.predecessorFences())[0].pendingDelete, false);
  await replayed.release();
});

test('no-registration upgrade still inspects and fences a legacy blob at the derived path', async () => {
  const legacyDirectory = await root();
  const { files, path } = await registeredLegacy(legacyDirectory);
  clearNativeRqsFiles();
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app,
    binding,
    environment: env(sqlite, {
      async resolveExpoLegacyRqsFiles() { return { files, directory: legacyDirectory }; },
    }),
    qualificationRow: await rowFor(sqlite),
  });
  assert.equal(lease.resolution.info.durable, true);
  await assert.rejects(readFile(path), (error) => error?.code === 'ENOENT');
  assert.equal((await lease.resolution.store.predecessorFences()).length, 1);
  await lease.release();
});

test('migration excludes a still-open legacy writer and preserves its later enqueue', async () => {
  const legacyDirectory = await root();
  const files = createNodeFilesAdapter();
  registerNativeRqsFiles({ files, directory: legacyDirectory, implementation: 'expo-file-system' });
  const identity = `origin:${new URL(binding.target.origin).origin}`;
  const writer = createFileRqsResumeStore({ directory: legacyDirectory, files, identity });
  await writer.whenLockSettled();
  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.deepEqual(lease.resolution.info, {
    source: 'default', implementation: 'file', durable: false, reason: 'expo-legacy-file-writer-active',
  });
  await writer.outboxEnqueue({ id: 'late-legacy-intent', function: 'createThing' });
  assert.equal((await writer.outboxPending())[0].id, 'late-legacy-intent');
  await lease.release();
  await writer.close();
});

test('migration sees a same-process writer during delayed exclusive-create resolution and preserves its lock', async (t) => {
  const legacyDirectory = await root();
  const baseFiles = createNodeFilesAdapter();
  let releaseLockCreate;
  let notifyLockCreated;
  const lockCreated = new Promise((resolve) => { notifyLockCreated = resolve; });
  const lockCreateRelease = new Promise((resolve) => { releaseLockCreate = resolve; });
  t.after(() => releaseLockCreate());
  const files = {
    ...baseFiles,
    async writeFileExclusive(path, value) {
      const acquired = await baseFiles.writeFileExclusive(path, value);
      if (acquired && path.endsWith('.lock')) {
        notifyLockCreated();
        await lockCreateRelease;
      }
      return acquired;
    },
  };
  registerNativeRqsFiles({ files, directory: legacyDirectory, implementation: 'expo-file-system' });
  const identity = `origin:${new URL(binding.target.origin).origin}`;
  const lockPath = legacyFileRqsStorePath({ directory: legacyDirectory, identity })
    .replace(/\.json$/u, '.lock');
  const writer = createFileRqsResumeStore({ directory: legacyDirectory, files, identity });
  await lockCreated;
  const writerInstanceId = JSON.parse(await readFile(lockPath, 'utf8')).instanceId;

  const sqliteDirectory = await root();
  const sqlite = createNodeSqliteNamespace(sqliteDirectory);
  const lease = await acquireExpoSqliteDefaultRqsStore({
    app, binding, environment: env(sqlite), qualificationRow: await rowFor(sqlite),
  });
  assert.deepEqual(lease.resolution.info, {
    source: 'default', implementation: 'file', durable: false, reason: 'expo-legacy-file-writer-active',
  });

  await lease.release();
  assert.equal(
    JSON.parse(await readFile(lockPath, 'utf8')).instanceId,
    writerInstanceId,
    'releasing the refused migration-side carrier does not remove the in-flight writer lock',
  );
  releaseLockCreate();
  await writer.whenLockSettled();
  await writer.outboxEnqueue({ id: 'delayed-create-intent', function: 'createThing' });
  assert.equal((await writer.outboxPending())[0].id, 'delayed-create-intent');
  await writer.close();
});

test('boot acquires only after binding and explicit null bypasses acquisition', async () => {
  const events = [];
  let captured;
  let capturedRuntimeKind;
  const environment = Object.freeze({
    format: 'snapback.expo-environment.v1',
    async resolveBinding() {
      events.push('binding');
      return { binding, admission: { productionCondition: false, delivery: { channel: 'local-supervised-ipc' } } };
    },
    async resolveExpoSqliteRuntimeKind() {
      events.push('runtime-kind');
      return 'share-extension';
    },
    async adoptAuthority(input) {
      events.push('adopt');
      captured = input.rqsStore;
      return {
        status: 'ready',
        client: { async prepareReactBinding() { return {}; } },
        publicFacts: { kind: 'session', authMode: 'sessions', sessionId: 's', userId: 'u' },
      };
    },
  });
  const lease = { resolution: Object.freeze({ marker: 'default-resolution' }), async release() { events.push('release'); } };
  const boot = createSnapbackExpoBoot({
    app,
    environment,
    now: () => Date.parse('2026-08-16T13:00:00Z'),
    async acquireDefaultRqsStore(input) { events.push('acquire'); capturedRuntimeKind = input.runtimeKind; return lease; },
    createProvider() { return { start() {}, async dispose() {} }; },
    bindLifecycle() { return { dispose() {} }; },
  });
  await boot.start();
  assert.deepEqual(events.slice(0, 4), ['binding', 'runtime-kind', 'acquire', 'adopt']);
  assert.strictEqual(captured, lease.resolution);
  assert.equal(capturedRuntimeKind, 'share-extension');
  await boot.dispose();
  assert.equal(events.at(-1), 'release');

  let acquired = false;
  const explicit = createSnapbackExpoBoot({
    app,
    environment,
    rqsStore: null,
    now: () => Date.parse('2026-08-16T13:00:00Z'),
    async acquireDefaultRqsStore() { acquired = true; throw new Error('must not load'); },
    createProvider() { return { start() {}, async dispose() {} }; },
    bindLifecycle() { return { dispose() {} }; },
  });
  await explicit.start();
  assert.equal(acquired, false);
  assert.equal(captured, null);
  await explicit.dispose();
});
