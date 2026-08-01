// React Native/Expo projection of the Channel B durable file store. The fake
// is node-backed but conforms to the pinned synchronous File/Directory API,
// so these tests exercise the exact adapter boundary an app injects.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createFakeExpoFileSystem } from './fake-expo-file-system.mjs';
import { argsHash, digestOfRows } from './rqs.mjs';
import { rqsEntryKey } from './rqs-store.mjs';
import {
  clearNativeRqsFiles,
  resolveDefaultRqsStore,
} from './rqs-store-default.mjs';
import {
  createExpoFilesAdapter,
  createExpoRqsResumeStore,
  registerExpoFileSystemRqsFiles,
} from './rqs-store-expo.mjs';

const ROWS = [{ _id: 'one', title: 'café' }];

const makeEntry = (version = 7) => ({
  rows: ROWS,
  meta: {
    app: 'demo.app',
    version,
    contentDigest: digestOfRows('mset1', ROWS),
    generation: 'gen1:aaaa',
    versionStream: 'stream-1',
    queryArtifact: `sha256:${'1'.repeat(64)}`,
    argsHash: argsHash({}),
  },
  token: 'sbrt1.sbrq_key.eyJib2R5IjoxfQ.bWFj',
});

async function makeFake(t) {
  const root = await mkdtemp(join(tmpdir(), 'snapback-rqs-expo-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return createFakeExpoFileSystem(root);
}

test('adapter refuses a module without the pinned File/Directory shape', () => {
  assert.throws(
    () => createExpoFilesAdapter({}),
    (error) => error?.code === 'SNAPBACK_RQS_STORE_UNAVAILABLE',
  );
});

test('exclusive writes preserve the first writer and utf8 reads roundtrip', async (t) => {
  const { module: fileSystem, documentPath } = await makeFake(t);
  const files = createExpoFilesAdapter(fileSystem);
  const path = join(documentPath, 'exclusive.txt');

  assert.equal(await files.readFile(path), null);
  assert.equal(await files.writeFileExclusive(path, 'first café'), true);
  assert.equal(await files.writeFileExclusive(path, 'second'), false);
  assert.equal(await files.readFile(path), 'first café');

  await files.writeFile(path, 'replacement 你好');
  assert.equal(await files.readFile(path), 'replacement 你好');
});

test('rename replaces, unlink reports absence, and readdir returns URI-decoded names', async (t) => {
  const { module: fileSystem, documentPath } = await makeFake(t);
  const files = createExpoFilesAdapter(fileSystem);
  const missing = join(documentPath, 'missing');
  const directory = join(documentPath, 'listing');
  const source = join(directory, 'source café.txt');
  const destination = join(directory, 'destination.txt');

  assert.deepEqual(await files.readdir(missing), []);
  await files.writeFile(source, 'source');
  await files.writeFile(destination, 'old destination');
  await files.rename(source, destination);
  assert.equal(await files.readFile(source), null);
  assert.equal(await files.readFile(destination), 'source');
  await files.writeFile(join(directory, '你好.txt'), 'unicode');
  assert.deepEqual(
    (await files.readdir(directory)).sort(),
    ['destination.txt', '你好.txt'].sort(),
  );
  assert.equal(await files.unlink(destination), true);
  assert.equal(await files.unlink(destination), false);
});

test('the launch id is stable and exactly defines mobile-process liveness', async (t) => {
  const { module: fileSystem } = await makeFake(t);
  const first = createExpoFilesAdapter(fileSystem);
  const second = createExpoFilesAdapter(fileSystem);
  const pid = first.processId();
  assert.equal(Number.isInteger(pid), true);
  assert.equal(pid > 0, true);
  assert.equal(second.processId(), pid);
  assert.equal(first.processAlive(pid), true);
  assert.equal(first.processAlive(pid === 1 ? 2 : 1), false);
});

test('Expo store defaults under Paths.document, survives relaunch, and reclaims a crashed lock', async (t) => {
  const { module: fileSystem } = await makeFake(t);
  const expectedDirectory = new fileSystem.Directory(
    fileSystem.Paths.document,
    'snapback-rqs',
  );
  const key = rqsEntryKey('listCells', {});

  const first = createExpoRqsResumeStore({ fileSystem });
  await first.whenLockSettled();
  assert.equal(first.isWriter(), true);
  assert.deepEqual(first.durability(), { implementation: 'file', durable: true });
  assert.equal((await first.commit(key, makeEntry())).persisted, true);
  assert.equal(expectedDirectory.exists, true);
  assert.deepEqual((await first.load(key)).rows, ROWS);
  await first.close();

  const second = createExpoRqsResumeStore({ fileSystem });
  await second.whenLockSettled();
  assert.deepEqual((await second.load(key)).rows, ROWS);
  await second.close();

  const files = createExpoFilesAdapter(fileSystem);
  const lockPath = new fileSystem.File(expectedDirectory, 'rqs-anonymous.v1.lock').uri;
  await files.writeFile(lockPath, JSON.stringify({
    pid: files.processId() + 1,
    instanceId: 'crashed-predecessor',
    acquiredAt: 1,
  }));
  const successor = createExpoRqsResumeStore({ fileSystem });
  await successor.whenLockSettled();
  assert.equal(successor.isWriter(), true);
  await successor.close();
});

test('corrupt bytes fail closed in place until explicit wipe', async (t) => {
  const { module: fileSystem } = await makeFake(t);
  const directory = new fileSystem.Directory(fileSystem.Paths.document, 'corrupt').uri;
  const key = rqsEntryKey('listCells', {});
  const first = createExpoRqsResumeStore({ fileSystem, directory });
  await first.whenLockSettled();
  await first.commit(key, makeEntry());
  await first.close();

  const blob = new fileSystem.Directory(directory)
    .list()
    .find((entry) => entry.uri.endsWith('.v1.json'));
  assert.ok(blob);
  blob.write('{garbage bytes');

  const second = createExpoRqsResumeStore({ fileSystem, directory });
  await second.whenLockSettled();
  await assert.rejects(
    () => second.load(key),
    (error) => error?.code === 'SNAPBACK_RQS_STORE_CORRUPT',
  );
  assert.equal(await second.wipe(), true);
  assert.equal(await second.load(key), null);
  await second.close();
});

test('default ladder registers Expo for RN, isolates origins, resets, and leaves node intact', async (t) => {
  const fake = await makeFake(t);
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const restoreNavigator = () => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  };

  clearNativeRqsFiles();
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: { product: 'ReactNative' },
      configurable: true,
    });
    const unregistered = resolveDefaultRqsStore({ baseUrl: 'https://one.example/path' });
    assert.equal(unregistered.info.implementation, 'memory');
    assert.equal(unregistered.info.reason, 'no-native-files-registered');

    registerExpoFileSystemRqsFiles(fake.module);
    const one = resolveDefaultRqsStore({ baseUrl: 'https://one.example/path' });
    const two = resolveDefaultRqsStore({ baseUrl: 'https://two.example/path' });
    await one.store.whenLockSettled();
    await two.store.whenLockSettled();
    assert.deepEqual(
      { implementation: one.info.implementation, durable: one.info.durable },
      { implementation: 'file', durable: true },
    );
    const key = rqsEntryKey('listCells', {});
    await one.store.commit(key, makeEntry(1));
    await two.store.commit(key, makeEntry(2));
    assert.equal((await one.store.load(key)).meta.version, 1);
    assert.equal((await two.store.load(key)).meta.version, 2);
    const storeDirectory = new fake.module.Directory(
      fake.module.Paths.document,
      'snapback-rqs',
    );
    assert.equal(
      storeDirectory.list().filter((entry) => entry.uri.endsWith('.v1.json')).length,
      2,
      'per-origin identities produce distinct blobs',
    );
    await one.store.close();
    await two.store.close();

    clearNativeRqsFiles();
    const cleared = resolveDefaultRqsStore({ baseUrl: 'https://one.example' });
    assert.equal(cleared.info.reason, 'no-native-files-registered');

    Object.defineProperty(globalThis, 'navigator', {
      value: { product: 'NotReactNative' },
      configurable: true,
    });
    const node = resolveDefaultRqsStore({ baseUrl: 'https://node.example' });
    assert.equal(node.info.implementation, 'file');
    assert.equal(node.info.durable, true);
    await node.store.close();
  } finally {
    clearNativeRqsFiles();
    restoreNavigator();
  }
});
