// Channel B persisted RQS resume store — native/DK-9 file arm unit
// obligations (LLP 0090 rollout step 5, ENG-25456; LLP 0091 §0A.5). Real
// filesystem via temp directories: atomic temp-write+rename commits, the
// on-disk single-writer lock with liveness (never timing-lease) staleness,
// the shared budget/eviction bookkeeping, per-identity blob keying with the
// LLP 0053 user-switch wipe, and the DK-9 corrupt-bytes posture (preserve in
// place, refuse reads and writes, wipe() is the caller-authorized reset).

import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { argsHash, digestOfRows } from './rqs.mjs';
import {
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';
import {
  RQS_FILE_STORE_FORMAT,
  createFileRqsResumeStore,
  createNodeFilesAdapter,
  sweepStaleRqsBlobs,
} from './rqs-store-file.mjs';

const ROWS = [{ _id: 'a', title: 'first' }, { _id: 'b', title: 'second' }];

function makeEntry({
  rows = ROWS,
  version = 7,
  args = {},
  generation = 'gen1:aaaa',
  versionStream = 'stream-1',
  app = 'demo.app',
} = {}) {
  return {
    rows,
    meta: {
      app,
      version,
      contentDigest: digestOfRows('mset1', rows),
      generation,
      versionStream,
      queryArtifact: `sha256:${'1'.repeat(64)}`,
      argsHash: argsHash(args),
    },
    token: 'sbrt1.sbrq_key.eyJib2R5IjoxfQ.bWFj',
  };
}

async function makeDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-rqs-file-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function makeStore(t, overrides = {}) {
  const directory = overrides.directory ?? await makeDirectory(t);
  const store = createFileRqsResumeStore({
    directory,
    files: overrides.files,
    identity: overrides.identity,
    now: overrides.now,
    maxBytes: overrides.maxBytes,
    maxEntries: overrides.maxEntries,
    relaunchOutboxEmpty: overrides.relaunchOutboxEmpty ?? null,
  });
  await store.whenLockSettled();
  return { store, directory };
}

const blobPathIn = async (directory) => {
  const blobs = (await readdir(directory)).filter((name) => name.endsWith('.v1.json'));
  assert.equal(blobs.length, 1, 'exactly one persisted blob');
  return join(directory, blobs[0]);
};

const permissionMode = async (path) => (await stat(path)).mode & 0o777;

test('commit/load roundtrip is atomic {rows, meta, token} and clears in-progress; recency survives rewrites', async (t) => {
  const { store, directory } = await makeStore(t);
  assert.equal(store.isWriter(), true);
  const key = rqsEntryKey('listCells', {});
  const entry = makeEntry();
  const outcome = await store.commit(key, entry);
  assert.equal(outcome.persisted, true);

  const loaded = await store.load(key);
  assert.deepEqual(loaded.rows, entry.rows);
  assert.deepEqual(loaded.meta, entry.meta);
  assert.equal(loaded.token, entry.token);
  assert.equal(loaded.inProgress, false);
  assert.equal(loaded.resumedAt, 0);
  assert.equal(verifyPersistedResumeEntry(loaded, { args: {} }).ok, true);

  await store.markResumed(key, 12345);
  await store.commit(key, makeEntry({ version: 8 }));
  const rewritten = await store.load(key);
  assert.equal(rewritten.resumedAt, 12345, 'recency is resume bookkeeping, not write bookkeeping');

  // The atomic temp-write+rename leaves no droppings and a parseable blob.
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.includes('.tmp-')), false, 'no temp files survive a commit');
  const raw = JSON.parse(await readFile(await blobPathIn(directory), 'utf8'));
  assert.equal(raw.format, RQS_FILE_STORE_FORMAT);
  await store.close();
});

test('file store uses owner-only modes and tightens existing carriers on open', async (t) => {
  const { store, directory } = await makeStore(t);
  const key = rqsEntryKey('privateCards', {});
  await store.commit(key, makeEntry());
  const blobPath = await blobPathIn(directory);
  const lockPath = join(directory, 'rqs-anonymous.v1.lock');

  assert.equal(await permissionMode(directory), 0o700, 'store directory is owner-only');
  assert.equal(await permissionMode(blobPath), 0o600, 'resume/outbox blob is owner-only');
  assert.equal(await permissionMode(lockPath), 0o600, 'writer lock is owner-only');
  await store.close();

  // Simulate a store and live foreign lock created by the older permissive
  // implementation. Opening as a reader must still tighten every carrier.
  await chmod(directory, 0o777);
  await chmod(blobPath, 0o666);
  const adapter = createNodeFilesAdapter();
  const foreignPid = adapter.processId() + 10_000;
  await writeFile(lockPath, JSON.stringify({ pid: foreignPid, instanceId: 'foreign-live' }));
  await chmod(lockPath, 0o666);
  const readerFiles = {
    ...adapter,
    processAlive: (pid) => pid === foreignPid,
  };
  const reader = createFileRqsResumeStore({ directory, files: readerFiles });
  await reader.whenLockSettled();
  assert.equal(reader.isWriter(), false, 'the live foreign lock remains authoritative');
  assert.equal(await permissionMode(directory), 0o700, 'reopen tightens an existing directory');
  assert.equal(await permissionMode(blobPath), 0o600, 'reopen tightens an existing blob');
  assert.equal(await permissionMode(lockPath), 0o600, 'reopen tightens an existing lock');
  await reader.close();
});

test('chmod refusal on an exotic files adapter is best-effort, not an availability failure', async (t) => {
  const files = {
    ...createNodeFilesAdapter(),
    async chmod() {
      const error = new Error('permissions unsupported');
      error.code = 'ENOTSUP';
      throw error;
    },
  };
  const { store } = await makeStore(t, { files });
  assert.equal(store.isWriter(), true);
  assert.equal(
    (await store.commit(rqsEntryKey('portable', {}), makeEntry())).persisted,
    true,
  );
  await store.close();
});

test('operation identity range counter and queued intent survive file-store reopen atomically', async (t) => {
  const directory = await makeDirectory(t);
  const range = {
    schemaVersion: 1,
    audience: 'authority-file',
    authorityInstanceId: 'authority-file',
    epochId: 'epoch-file',
    epochSequence: 0,
    rangeStart: 20,
    rangeEndExclusive: 22,
    issuedAtMs: 1,
    expiresAtMs: 10_000,
    authorityAuthenticatorDigest: `sha256:${'b'.repeat(64)}`,
  };
  const { store } = await makeStore(t, { directory, now: () => 2 });
  const first = await store.outboxEnqueueWithOperationIdentity(
    { id: 'cm-file-operation-1', function: 'createThing' },
    'dev:file-user',
    range,
  );
  assert.equal(first.operationIssuance.counter, 20);
  await store.close();

  const { store: reopened } = await makeStore(t, { directory, now: () => 3 });
  const second = await reopened.outboxEnqueueWithOperationIdentity(
    { id: 'cm-file-operation-2', function: 'createThing' },
    'dev:file-user',
  );
  assert.equal(second.operationIssuance.counter, 21);
  assert.deepEqual(
    (await reopened.outboxPending()).map((record) => record.id),
    ['cm-file-operation-1', 'cm-file-operation-2'],
  );
  await reopened.close();
});

test('React binding receipt is atomic, detached, bounded, uncounted, writer-gated, and durable', async (t) => {
  const directory = await makeDirectory(t);
  const { store } = await makeStore(t, { directory });
  assert.equal(await store.loadReactBindingReceipt(), null, 'a blob without the optional field reads null');

  const receipt = { binding: 'todos:list', authorityMode: 'anonymous', nested: { version: 1 } };
  assert.equal(await store.commitReactBindingReceipt(receipt), true);
  receipt.nested.version = 99;
  const loaded = await store.loadReactBindingReceipt();
  assert.deepEqual(loaded, {
    binding: 'todos:list',
    authorityMode: 'anonymous',
    nested: { version: 1 },
  });
  loaded.nested.version = 2;
  assert.equal((await store.loadReactBindingReceipt()).nested.version, 1, 'loads are detached');

  const blob = JSON.parse(await readFile(await blobPathIn(directory), 'utf8'));
  assert.deepEqual(blob.reactBindingReceipt, {
    binding: 'todos:list',
    authorityMode: 'anonymous',
    nested: { version: 1 },
  });
  const inspection = await store.inspection();
  assert.deepEqual(
    { entries: inspection.entries, bytes: inspection.bytes },
    { entries: 0, bytes: 0 },
    'receipt metadata is excluded from entry inspection accounting',
  );

  const { store: reader } = await makeStore(t, { directory });
  assert.equal(reader.isWriter(), false);
  await assert.rejects(
    reader.commitReactBindingReceipt({ binding: 'refused' }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED');
      assert.equal(error.diagnostic.details.reason, 'competing_writer');
      assert.equal(error.diagnostic.details.competingPid, process.pid);
      assert.match(error.diagnostic.details.lockPath, /\.v1\.lock$/u);
      assert.match(error.diagnostic.details.storePath, /\.v1\.json$/u);
      assert.match(error.message, new RegExp(`pid ${process.pid}`, 'u'));
      return true;
    },
  );
  assert.equal((await reader.loadReactBindingReceipt()).binding, 'todos:list');
  assert.equal(await store.commitReactBindingReceipt(null), false);
  assert.equal(await store.commitReactBindingReceipt(42), false);
  assert.equal(await store.commitReactBindingReceipt([]), false);
  assert.equal(
    await store.commitReactBindingReceipt({ payload: 'x'.repeat(64 * 1024) }),
    false,
    'serialized receipts over 64 KiB are refused without replacing the prior receipt',
  );
  assert.equal((await store.loadReactBindingReceipt()).binding, 'todos:list');
  await reader.close();
  await store.close();

  const { store: reopened } = await makeStore(t, { directory });
  assert.equal((await reopened.loadReactBindingReceipt()).binding, 'todos:list', 'receipt survives reopen');
  assert.equal(await reopened.wipe(), true);
  assert.equal(await reopened.loadReactBindingReceipt(), null, 'user-switch wipe clears receipt metadata');
  await reopened.close();
});

test('an entry found in-progress at relaunch is refused (interrupted delta sequence)', async (t) => {
  const { store } = await makeStore(t);
  const key = rqsEntryKey('listCells', {});
  await store.commit(key, makeEntry());
  await store.markInProgress(key);
  const loaded = await store.load(key);
  assert.equal(loaded.inProgress, true);
  assert.deepEqual(verifyPersistedResumeEntry(loaded, { args: {} }), { ok: false, reason: 'in_progress' });
  // The next atomic commit clears the marker again.
  await store.commit(key, makeEntry());
  assert.equal(verifyPersistedResumeEntry(await store.load(key), { args: {} }).ok, true);
  await store.close();
});

test('budget eviction removes least-recently-resumed entries at the cap, atomically with the commit', async (t) => {
  const { store } = await makeStore(t, { maxEntries: 3 });
  const keys = ['q0', 'q1', 'q2', 'q3'].map((name) => rqsEntryKey(name, {}));
  await store.commit(keys[0], makeEntry());
  await store.commit(keys[1], makeEntry());
  await store.commit(keys[2], makeEntry());
  // q0 and q2 resumed; q1 never resumed -> least-recently-resumed.
  await store.markResumed(keys[0], 100);
  await store.markResumed(keys[2], 200);
  const outcome = await store.commit(keys[3], makeEntry());
  assert.deepEqual(outcome.evicted, [keys[1]]);
  assert.equal(await store.load(keys[1]), null);
  assert.notEqual(await store.load(keys[0]), null);
  assert.notEqual(await store.load(keys[2]), null);
  assert.notEqual(await store.load(keys[3]), null);
  assert.equal((await store.inspection()).entries, 3);
  await store.close();
});

test('byte budget binds too, and a single over-budget entry refuses to persist (dropping its predecessor)', async (t) => {
  const { store } = await makeStore(t, { maxBytes: 2048 });
  const key = rqsEntryKey('big', {});
  await store.commit(key, makeEntry());
  const bigRows = [{ _id: 'big', blob: 'x'.repeat(4096) }];
  const refused = await store.commit(key, {
    rows: bigRows,
    meta: { ...makeEntry().meta, contentDigest: digestOfRows('mset1', bigRows) },
    token: 'sbrt1.k.b.m',
  });
  assert.deepEqual(refused, { persisted: false, reason: 'oversize' });
  assert.equal(await store.load(key), null, 'the stale predecessor fails closed');

  // Multiple small entries: oldest-resumed evicted when bytes exceed budget.
  const small = (id) => {
    const rows = [{ _id: id, pad: 'y'.repeat(600) }];
    return { rows, meta: { ...makeEntry().meta, contentDigest: digestOfRows('mset1', rows) }, token: 'sbrt1.k.b.m' };
  };
  await store.commit(rqsEntryKey('s1', {}), small('s1'));
  await store.markResumed(rqsEntryKey('s1', {}), 50);
  await store.commit(rqsEntryKey('s2', {}), small('s2'));
  await store.markResumed(rqsEntryKey('s2', {}), 60);
  const third = await store.commit(rqsEntryKey('s3', {}), small('s3'));
  assert.deepEqual(third.evicted, [rqsEntryKey('s1', {})], 'least-recently-resumed evicts first');
  await store.close();
});

test('two instances, one directory: single writer; the reader adopts but cannot write; takeover on close', async (t) => {
  const directory = await makeDirectory(t);
  const { store: writerInstance } = await makeStore(t, { directory });
  const { store: readerInstance } = await makeStore(t, { directory });
  assert.equal(writerInstance.isWriter(), true);
  assert.equal(readerInstance.isWriter(), false, 'the same-process registry demotes the second instance');

  const key = rqsEntryKey('listCells', {});
  await writerInstance.commit(key, makeEntry({ version: 5 }));
  const refused = await readerInstance.commit(key, makeEntry({ version: 9 }));
  assert.deepEqual(refused, { persisted: false, reason: 'not_writer' });
  assert.equal(await readerInstance.markResumed(key, 1), false);
  assert.equal(await readerInstance.markInProgress(key), false);
  assert.equal(await readerInstance.remove(key), false);
  assert.equal(await readerInstance.wipe(), false);

  // Reading is how the second context adopts the store's persisted token.
  const adopted = await readerInstance.load(key);
  assert.equal(adopted.meta.version, 5, "the writer's entry, not the reader's refused write");

  await writerInstance.close();
  await readerInstance.whenLockSettled();
  assert.equal(readerInstance.isWriter(), true, 'ownership takeover after the holder closed');
  const outcome = await readerInstance.commit(key, makeEntry({ version: 9 }));
  assert.equal(outcome.persisted, true);
  await readerInstance.close();
});

test('a stale lock (dead pid, our own crashed pid, or unreadable) is taken over; a live foreign holder is not', async (t) => {
  const adapter = createNodeFilesAdapter();

  // Dead-pid holder: liveness says stale, the new instance claims the lock.
  const deadDir = await makeDirectory(t);
  await writeFile(join(deadDir, 'rqs-anonymous.v1.lock'), JSON.stringify({ pid: 2 ** 30, instanceId: 'x' }));
  const { store: afterDead } = await makeStore(t, { directory: deadDir });
  assert.equal(afterDead.isWriter(), true, 'dead holder is stale');
  await afterDead.close();

  // Unreadable lock bytes: stale.
  const junkDir = await makeDirectory(t);
  await writeFile(join(junkDir, 'rqs-anonymous.v1.lock'), 'not json');
  const { store: afterJunk } = await makeStore(t, { directory: junkDir });
  assert.equal(afterJunk.isWriter(), true, 'unreadable holder is stale');
  await afterJunk.close();

  // Our own pid without an in-process registration: a crashed predecessor's
  // leftover from a recycled pid — stale.
  const ownDir = await makeDirectory(t);
  await writeFile(join(ownDir, 'rqs-anonymous.v1.lock'), JSON.stringify({ pid: adapter.processId(), instanceId: 'gone' }));
  const { store: afterOwn } = await makeStore(t, { directory: ownDir });
  assert.equal(afterOwn.isWriter(), true, 'unregistered same-pid holder is stale');
  await afterOwn.close();

  // A LIVE foreign holder keeps this instance a reader — liveness, not a
  // timing lease (LLP 0008 DK-9).
  const liveDir = await makeDirectory(t);
  await writeFile(join(liveDir, 'rqs-anonymous.v1.lock'), JSON.stringify({ pid: adapter.processId() + 1, instanceId: 'y' }));
  const liveFiles = { ...adapter, processAlive: () => true };
  const { store: reader } = await makeStore(t, { directory: liveDir, files: liveFiles });
  assert.equal(reader.isWriter(), false, 'a live holder demotes to reader');
  assert.deepEqual(
    await reader.commit(rqsEntryKey('q', {}), makeEntry()),
    { persisted: false, reason: 'not_writer' },
  );
  await assert.rejects(
    reader.commitReactBindingReceipt({ binding: 'foreign-holder' }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_REACT_BINDING_RECEIPT_NOT_PERSISTED');
      assert.equal(error.diagnostic.details.competingPid, adapter.processId() + 1);
      assert.equal(
        error.diagnostic.details.lockPath,
        join(liveDir, 'rqs-anonymous.v1.lock'),
      );
      assert.equal(
        error.diagnostic.details.storePath,
        join(liveDir, 'rqs-anonymous.v1.json'),
      );
      return true;
    },
  );
  await reader.close();
});

test('corrupt blob bytes are preserved in place until identity-rotating reset', async (t) => {
  const directory = await makeDirectory(t);
  const { store: session1 } = await makeStore(t, { directory });
  const key = rqsEntryKey('listCells', {});
  await session1.commit(key, makeEntry());
  await session1.close();

  const blobPath = await blobPathIn(directory);
  await writeFile(blobPath, '{ definitely not the persisted format');
  const { store } = await makeStore(t, { directory });
  await assert.rejects(store.load(key), (error) => error.code === 'SNAPBACK_RQS_STORE_CORRUPT');
  assert.deepEqual(await store.commit(key, makeEntry()), { persisted: false, reason: 'corrupt' });
  assert.equal(await store.markResumed(key, 1), false);
  assert.equal(await store.remove(key), false);
  const inspection = await store.inspection();
  assert.equal(inspection.corrupt, true);
  assert.equal(inspection.entries, 0);
  assert.equal(
    await readFile(blobPath, 'utf8'),
    '{ definitely not the persisted format',
    'no parse fallback ever replaced the only copy (DK-9)',
  );

  assert.equal(await store.wipe(), false, 'ordinary wipe cannot recover unreadable high-waters');
  const reset = await store.resetCorruptStoreIdentity();
  assert.equal(reset.reset, true);
  assert.equal(await store.load(key), null);
  const outcome = await store.commit(key, makeEntry());
  assert.equal(outcome.persisted, true);
  await store.close();
});

test('a future/unknown blob format is the same corrupt verdict, never empty success', async (t) => {
  const directory = await makeDirectory(t);
  await writeFile(
    join(directory, 'rqs-anonymous.v1.json'),
    JSON.stringify({ format: 'snapback-rqs-store-file.v9', entries: { k: {} } }),
  );
  const { store } = await makeStore(t, { directory });
  await assert.rejects(store.load('k'), (error) => error.code === 'SNAPBACK_RQS_STORE_CORRUPT');
  assert.deepEqual(await store.commit('k', makeEntry()), { persisted: false, reason: 'corrupt' });
  await store.close();
});

test('per-identity keying separates blobs; the user-switch wipe clears every identity (LLP 0053) with §D1 survivals for its own domain', async (t) => {
  const directory = await makeDirectory(t);
  const { store: anonStore } = await makeStore(t, { directory });
  await anonStore.commit(rqsEntryKey('q', {}), makeEntry());
  const anonIdentityBefore = (await anonStore.readStoreMeta()).clientStoreId;
  await anonStore.close();
  const { store: userStore } = await makeStore(t, { directory, identity: 'user-42' });
  await userStore.commit(rqsEntryKey('q', {}), makeEntry({ version: 9 }));
  const userMetaBefore = await userStore.readStoreMeta();

  const blobs = (await readdir(directory)).filter((name) => name.endsWith('.v1.json'));
  assert.equal(blobs.length, 2, 'one blob per identity');
  assert.equal(blobs.some((name) => name === 'rqs-anonymous.v1.json'), true);
  const userBlobName = blobs.find((name) => name !== 'rqs-anonymous.v1.json');

  assert.equal(await userStore.wipe(), true);
  const afterWipe = (await readdir(directory)).filter((name) => name.endsWith('.v1.json'));
  assert.deepEqual(
    afterWipe,
    [userBlobName],
    'the user-switch wipe destroys every sibling identity blob (LLP 0053 client-wide delete)',
  );
  assert.equal(await userStore.load(rqsEntryKey('q', {})), null);
  const userMetaAfter = await userStore.readStoreMeta();
  assert.equal(
    userMetaAfter.clientStoreId,
    userMetaBefore.clientStoreId,
    'the wiping domain keeps its store identity (§D1 projection, not rotation)',
  );
  assert.notEqual(
    userMetaAfter.handleKey,
    userMetaBefore.handleKey,
    'the wiping domain rotates its handle key',
  );
  await userStore.close();

  const { store: reopenedAnon } = await makeStore(t, { directory });
  assert.equal(
    await reopenedAnon.load(rqsEntryKey('q', {})),
    null,
    'a destroyed sibling has no predecessor entries after re-open',
  );
  assert.notEqual(
    (await reopenedAnon.readStoreMeta()).clientStoreId,
    anonIdentityBefore,
    'a destroyed sibling re-opens under a fresh store identity (never-reuse by namespace rotation)',
  );
  await reopenedAnon.close();
});

test('a leftover temp file from a crashed write never shadows the blob and is cleared by wipe', async (t) => {
  const directory = await makeDirectory(t);
  const { store: session1 } = await makeStore(t, { directory });
  const key = rqsEntryKey('listCells', {});
  await session1.commit(key, makeEntry());
  await session1.close();
  await writeFile(join(directory, 'rqs-anonymous.v1.json.tmp-crashed'), '{"half":');

  const { store } = await makeStore(t, { directory });
  const loaded = await store.load(key);
  assert.equal(verifyPersistedResumeEntry(loaded, { args: {} }).ok, true, 'the committed blob is what loads');
  await store.wipe();
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.includes('.tmp-')), false, 'wipe clears crashed droppings');
  await store.close();
});

test('defaults, construction validation, and the structural outbox hook', async (t) => {
  assert.throws(
    () => createFileRqsResumeStore({}),
    (error) => error.code === 'SNAPBACK_RQS_STORE_UNAVAILABLE',
    'a durable directory is required',
  );
  assert.throws(
    () => createFileRqsResumeStore({ directory: '/tmp/x', files: { readFile: () => null } }),
    (error) => error.code === 'SNAPBACK_RQS_STORE_UNAVAILABLE',
    'a partial files adapter is refused',
  );

  const { store } = await makeStore(t);
  const inspection = await store.inspection();
  assert.equal(inspection.maxBytes, RQS_STORE_MAX_BYTES);
  assert.equal(inspection.maxEntries, RQS_STORE_MAX_ENTRIES);
  assert.equal(await store.outboxEmpty(), true, 'no composing outbox layer means structurally empty');
  await store.close();

  const { store: withOutbox } = await makeStore(t, { relaunchOutboxEmpty: () => false });
  assert.equal(await withOutbox.outboxEmpty(), false);
  await withOutbox.close();
});

test('sweepStaleRqsBlobs unlinks only provably abandoned sibling origins', async (t) => {
  const directory = await makeDirectory(t);
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;

  // Abandoned dead origin: old entry, no lock, no pending intent -> swept.
  const { store: dead } = await makeStore(t, {
    directory,
    identity: 'origin-dead-1',
    now: () => old,
  });
  await dead.commit(rqsEntryKey('cells', {}), makeEntry());
  await dead.close();

  // Fresh sibling origin: recent activity -> kept.
  const { store: fresh } = await makeStore(t, {
    directory,
    identity: 'origin-fresh-2',
  });
  await fresh.commit(rqsEntryKey('cells', {}), makeEntry());
  await fresh.close();

  // Old origin holding PENDING queued intent -> kept (exactly-once).
  const { store: queued } = await makeStore(t, {
    directory,
    identity: 'origin-queued-3',
    now: () => old,
  });
  await queued.outboxEnqueue({ id: 'cm-stale', function: 'createThing' });
  await queued.close();

  // Corrupt sibling bytes -> kept (evidence, never janitor droppings).
  const corruptName = 'rqs-id-deadbeefdeadbeefdeadbeefdeadbeef.v1.json';
  await writeFile(join(directory, corruptName), 'not json {', 'utf8');

  // The caller's own identity is never a candidate even when old.
  const { store: own } = await makeStore(t, {
    directory,
    identity: 'origin-own-4',
    now: () => old,
  });
  await own.commit(rqsEntryKey('cells', {}), makeEntry());
  await own.close();

  const summary = await sweepStaleRqsBlobs({
    directory,
    keepIdentity: 'origin-own-4',
  });
  assert.equal(summary.swept, 1, 'exactly the abandoned dead origin was swept');
  const names = await readdir(directory);
  assert.equal(
    names.filter((name) => name.endsWith('.v1.json')).length,
    4,
    'fresh + queued + corrupt + own survive; only the dead origin is gone',
  );

  // Idempotent: a second sweep finds nothing new to do.
  const again = await sweepStaleRqsBlobs({
    directory,
    keepIdentity: 'origin-own-4',
  });
  assert.equal(again.swept, 0);
});

test('sweepStaleRqsBlobs keeps an old origin holding only a quarantined intent', async (t) => {
  // Quarantine-all-on-upgrade-required leaves a blob whose only outbox work is
  // quarantined (never pending). The staleness janitor must not reclaim it, or
  // the tombstone-and-re-entry guarantee (LLP 0081) loses the held intent.
  const directory = await makeDirectory(t);
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const { store: quarantined } = await makeStore(t, {
    directory,
    identity: 'origin-quarantined-1',
    now: () => old,
  });
  await quarantined.outboxEnqueue({ id: 'cm-quarantined', function: 'createThing' });
  const marked = await quarantined.outboxMarkQuarantined('cm-quarantined', {
    code: 'SNAPBACK_MIGRATION_UPGRADE_REQUIRED',
  });
  assert.equal(marked.count, 1, 'the intent is quarantined, not pending');
  assert.equal((await quarantined.outboxPending()).length, 0, 'no pending intent remains');
  await quarantined.close();

  // A never-swept caller identity so the sweep has a keepIdentity that is not
  // the candidate under test.
  const { store: own } = await makeStore(t, { directory, identity: 'origin-own-keep' });
  await own.commit(rqsEntryKey('cells', {}), makeEntry());
  await own.close();

  const summary = await sweepStaleRqsBlobs({ directory, keepIdentity: 'origin-own-keep' });
  assert.equal(summary.swept, 0, 'the quarantined-only blob is not abandoned');
  const names = await readdir(directory);
  assert.equal(
    names.filter((name) => name.endsWith('.v1.json')).length,
    2,
    'the quarantined origin and the caller identity both survive',
  );
});
