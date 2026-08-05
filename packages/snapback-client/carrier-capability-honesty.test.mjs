// LLP 0166 S8: one carrier-facing oracle for durability claims, structured
// capability GAPs, and fail-closed version skew.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { createFakeExpoFileSystem } from './fake-expo-file-system.mjs';
import { createMaterializationStore } from './materialization-store.mjs';
import { resultTransformCarrierContextV1 } from './result-transform.mjs';
import { createExpoRqsResumeStore } from './rqs-store-expo.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { createMemoryRqsResumeStore } from './rqs-store-memory.mjs';
import { createIndexedDbRqsResumeStore } from './rqs-store.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const QMK = `qmk1.${'A'.repeat(43)}`;
const grantingLocks = {
  request: (_name, _options, callback) => Promise.resolve(callback({ mode: 'exclusive' })),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const authorityState = () => ({
  query_instance_id: null,
  query_lifecycle: 'active',
  authority_generation: 1,
  query_generation: 1,
  authority_instance_id: 's8-authority',
  expected_boot_issuer: { issuer_id: 's8-issuer', boot_sequence: 1 },
  expected_authorization: { incarnation: 's8-incarnation', epoch: 1, version_stream: 's8-stream' },
  effective_disposition: 'retain',
  accepted: null,
  retired_issuer_frontier: { incarnation: 's8-incarnation', boot_sequence: 0 },
  retired_scope_frontier: null,
  pending_by_scope: {},
  scope_state: {},
});

async function initializeDurable(store, clientStoreId) {
  const materializations = await createMaterializationStore(store);
  return materializations.initialize(
    ['snapback:client-materialization-address:v1', clientStoreId, QMK],
    {
      planHash: digest('1'),
      activationHash: digest('2'),
      argsDigest: digest('3'),
      authorityPartitionDigest: digest('4'),
      storageProfile: 'durable-fragments-v1',
      authorityState: authorityState(),
    },
  );
}

function isDurableFragmentsGap(error) {
  return error?.code === 'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP'
    && error?.diagnostic?.code === 'SNAPBACK_MATERIALIZATION_STORAGE_PROFILE_GAP'
    && error?.diagnostic?.details?.requiredCapability === 'durable_fragments_v1';
}

const openDatabase = (indexedDB, name, version) => new Promise((resolve, reject) => {
  const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// @ref LLP 0166#executable-acceptance — S8 keeps every carrier claim and
// refusal in one named suite so a durability profile cannot drift separately
// from its GAP or version-skew posture.
describe('S8 — per-carrier capability honesty', () => {
  test('memory is volatile, claims no transform carrier, and refuses durable fragments with a structured GAP', async (t) => {
    const store = createMemoryRqsResumeStore({ clientStoreId: 's8-memory' });
    await store.whenLockSettled();
    t.after(() => store.close());

    assert.deepEqual(store.durability(), { implementation: 'memory', durable: false });
    assert.equal(resultTransformCarrierContextV1(store.durability()), null);
    await assert.rejects(() => initializeDurable(store, 's8-memory'), isDurableFragmentsGap);
  });

  test('Expo file is volatile, claims no transform carrier, and refuses durable fragments with the same GAP', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'snapback-s8-expo-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { module: fileSystem } = createFakeExpoFileSystem(root);
    const store = createExpoRqsResumeStore({ fileSystem, clientStoreId: 's8-expo' });
    await store.whenLockSettled();
    t.after(() => store.close());

    assert.deepEqual(store.durability(), { implementation: 'file', durable: false });
    assert.equal(resultTransformCarrierContextV1(store.durability()), null);
    await assert.rejects(() => initializeDurable(store, 's8-expo'), isDurableFragmentsGap);
  });

  test('Node file is power-loss durable and admits the file-node transform profile', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'snapback-s8-file-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const store = createFileRqsResumeStore({ directory, clientStoreId: 's8-file' });
    await store.whenLockSettled();
    t.after(() => store.close());

    assert.deepEqual(store.durability(), { implementation: 'file', durable: true });
    assert.equal(resultTransformCarrierContextV1(store.durability()), 'file-node');
    assert.equal((await initializeDurable(store, 's8-file')).storageProfile, 'durable-fragments-v1');
  });

  test('IndexedDB is durable, admits the browser profile, and an older opener gets VersionError without mutation', async (t) => {
    const indexedDB = new IDBFactory();
    const databaseName = 's8-indexeddb-v3';
    const store = createIndexedDbRqsResumeStore({
      indexedDB,
      lockManager: grantingLocks,
      databaseName,
      clientStoreId: 's8-indexeddb',
    });
    await tick();
    t.after(() => store.close());

    assert.deepEqual(store.durability(), { implementation: 'indexeddb', durable: true });
    assert.equal(resultTransformCarrierContextV1(store.durability()), 'browser-indexeddb');
    assert.equal(
      (await initializeDurable(store, 's8-indexeddb')).storageProfile,
      'durable-fragments-v1',
    );
    await store.close();
    await assert.rejects(
      openDatabase(indexedDB, databaseName, 2),
      (error) => error?.name === 'VersionError',
    );
    const intact = await openDatabase(indexedDB, databaseName);
    assert.equal(intact.version, 3);
    assert.equal(intact.objectStoreNames.contains('storeMeta'), true);
    intact.close();
  });

  test('Node file preserves a future-format blob and refuses it with the stable corrupt-store diagnostic', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'snapback-s8-file-skew-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const blobPath = join(directory, 'rqs-anonymous.v1.json');
    const future = JSON.stringify({ format: 'snapback-rqs-store-file.v9', entries: { k: {} } });
    await writeFile(blobPath, future);
    const store = createFileRqsResumeStore({ directory, clientStoreId: 's8-file-skew' });
    await store.whenLockSettled();
    t.after(() => store.close());

    await assert.rejects(
      store.readStoreMeta(),
      (error) => error?.code === 'SNAPBACK_RQS_STORE_CORRUPT',
    );
    assert.equal(await readFile(blobPath, 'utf8'), future);
  });
});
