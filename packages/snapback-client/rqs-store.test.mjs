// Channel B persisted RQS resume store — unit obligations (LLP 0090 rollout
// step 5, web arm; LLP 0091 §0A.5). Pure node: fake-indexeddb for the
// transactional store, a queued-exclusive Web Locks double for ownership.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { argsHash, digestOfRows } from './rqs.mjs';
import {
  RQS_STORE_MAX_ENTRIES,
  arbitrateResumeCandidates,
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';

// Minimal Web Locks double: per-name exclusive FIFO with AbortSignal support,
// mirroring the semantics the store relies on (grant-on-release takeover).
function createLockManagerDouble() {
  const states = new Map();
  const stateFor = (name) => {
    let state = states.get(name);
    if (!state) {
      state = { held: false, queue: [] };
      states.set(name, state);
    }
    return state;
  };
  const pump = (name) => {
    const state = stateFor(name);
    if (state.held) return;
    while (state.queue.length > 0) {
      const next = state.queue.shift();
      if (next.aborted) continue;
      state.held = true;
      Promise.resolve()
        .then(() => next.callback({ name, mode: 'exclusive' }))
        .then(next.resolve, next.reject)
        .finally(() => {
          state.held = false;
          pump(name);
        });
      return;
    }
  };
  return {
    request(name, options, callback) {
      const state = stateFor(name);
      return new Promise((resolve, reject) => {
        const entry = { callback, resolve, reject, aborted: false };
        const signal = options?.signal;
        if (signal) {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            return;
          }
          signal.addEventListener('abort', () => {
            entry.aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
        state.queue.push(entry);
        pump(name);
      });
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const ROWS = [
  { _id: 'a', title: 'first', n: 1 },
  { _id: 'b', title: 'second', n: 2 },
];

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

async function makeStore(overrides = {}) {
  const indexedDB = overrides.indexedDB ?? new IDBFactory();
  const lockManager = overrides.lockManager ?? createLockManagerDouble();
  const store = createIndexedDbRqsResumeStore({
    indexedDB,
    lockManager,
    now: overrides.now,
    maxBytes: overrides.maxBytes,
    maxEntries: overrides.maxEntries,
    relaunchOutboxEmpty: overrides.relaunchOutboxEmpty ?? null,
    databaseName: overrides.databaseName,
  });
  await tick();
  return { store, indexedDB, lockManager };
}

test('rqsEntryKey is canonical over arg ordering and null on refused args', () => {
  assert.equal(rqsEntryKey('q', { b: 2, a: 1 }), rqsEntryKey('q', { a: 1, b: 2 }));
  assert.notEqual(rqsEntryKey('q', { a: 1 }), rqsEntryKey('q', { a: 2 }));
  assert.notEqual(rqsEntryKey('q1', {}), rqsEntryKey('q2', {}));
  assert.equal(rqsEntryKey('', {}), null);
  assert.equal(rqsEntryKey('q', { bad: Number.NaN }), null);
});

test('commit/load roundtrip is atomic {rows, meta, token} and clears in-progress; recency survives rewrites', async () => {
  const { store } = await makeStore();
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
  await store.close();
});

test('an entry found in-progress at relaunch is refused (interrupted delta sequence)', async () => {
  const { store } = await makeStore();
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

test('corrupt, truncated, tampered, or identity-mismatched persisted state fails closed', async () => {
  const entry = makeEntry();
  const tamperedRows = [{ ...ROWS[0], title: 'tampered' }, ROWS[1]];
  assert.equal(verifyPersistedResumeEntry({ ...entry, rows: tamperedRows }, { args: {} }).reason, 'digest');
  assert.equal(verifyPersistedResumeEntry({ ...entry, rows: entry.rows.slice(0, 1) }, { args: {} }).reason, 'digest');
  assert.equal(verifyPersistedResumeEntry({ ...entry, token: '' }, { args: {} }).reason, 'token');
  assert.equal(verifyPersistedResumeEntry({ ...entry, token: 'x'.repeat(2048) }, { args: {} }).reason, 'token');
  assert.equal(verifyPersistedResumeEntry({ ...entry, meta: { ...entry.meta, versionStream: '' } }, { args: {} }).reason, 'meta');
  const { meta: { generation, ...rest } } = entry;
  assert.equal(verifyPersistedResumeEntry({ ...entry, meta: rest }, { args: {} }).reason, 'meta');
  assert.equal(verifyPersistedResumeEntry(null, { args: {} }).reason, 'shape');
  // Args identity mismatch (the persisted entry belongs to another instance).
  assert.equal(verifyPersistedResumeEntry(entry, { args: { room: 'other' } }).reason, 'identity');
  // Ordered results verify under seq1 digests.
  const seqRows = [{ n: 2 }, { n: 1 }];
  const seqEntry = makeEntry();
  seqEntry.rows = seqRows;
  seqEntry.meta = { ...seqEntry.meta, contentDigest: digestOfRows('seq1', seqRows) };
  assert.equal(verifyPersistedResumeEntry(seqEntry, { args: {} }).ok, true);
  assert.equal(
    verifyPersistedResumeEntry({ ...seqEntry, rows: [...seqRows].reverse() }, { args: {} }).reason,
    'digest',
    'a permuted ordered result fails the sequence digest',
  );
});

test('budget eviction removes least-recently-resumed entries at the cap, atomically with the commit', async () => {
  const { store } = await makeStore({ maxEntries: 3 });
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

test('byte budget binds too, and a single over-budget entry refuses to persist (dropping its predecessor)', async () => {
  const { store } = await makeStore({ maxBytes: 2048 });
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

test('two tabs: single writer under the Web Lock; the reader adopts but cannot write; takeover on close', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const { store: writerTab } = await makeStore({ indexedDB, lockManager });
  const { store: readerTab } = await makeStore({ indexedDB, lockManager });
  assert.equal(writerTab.isWriter(), true);
  assert.equal(readerTab.isWriter(), false);

  const key = rqsEntryKey('listCells', {});
  await writerTab.commit(key, makeEntry({ version: 9 }));
  // The reader's write is a refused no-op (single-writer discipline)...
  const refused = await readerTab.commit(key, makeEntry({ version: 1 }));
  assert.deepEqual(refused, { persisted: false, reason: 'not_writer' });
  assert.equal(await readerTab.markInProgress(key), false);
  assert.equal(await readerTab.remove(key), false);
  assert.equal(await readerTab.wipe(), false);
  // ...but the reader ADOPTS the store's persisted token (LLP 0090 D3).
  const adopted = await readerTab.load(key);
  assert.equal(adopted.meta.version, 9);

  // Writer close hands the lock (and writership) to the surviving tab.
  await writerTab.close();
  await tick();
  assert.equal(readerTab.isWriter(), true);
  const takeover = await readerTab.commit(key, makeEntry({ version: 10 }));
  assert.equal(takeover.persisted, true);
  await readerTab.close();
});

test('reader close aborts its queued lock request without waiting for the writer', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const { store: writerTab } = await makeStore({ indexedDB, lockManager });
  const { store: readerTab } = await makeStore({ indexedDB, lockManager });
  await readerTab.close(); // must not hang on the still-held lock
  assert.equal(writerTab.isWriter(), true);
  await writerTab.close();
});

test('remove and wipe purge persisted copies; a missing lock manager refuses construction', async () => {
  const { store } = await makeStore();
  const key = rqsEntryKey('listCells', {});
  await store.commit(key, makeEntry());
  await store.remove(key);
  assert.equal(await store.load(key), null);
  await store.commit(key, makeEntry());
  await store.wipe();
  assert.equal((await store.inspection()).entries, 0);
  await store.close();

  assert.throws(
    () => createIndexedDbRqsResumeStore({ indexedDB: new IDBFactory(), lockManager: null }),
    /SNAPBACK_RQS_STORE_LOCK_UNAVAILABLE/,
  );
});

test('A-vs-B arbitration: higher version within matching identity wins; any identity mismatch discards both', () => {
  const base = makeEntry({ version: 5 });
  const candidate = (entry) => ({ rows: entry.rows, resume: { token: entry.token, meta: entry.meta } });
  const older = candidate(base);
  const newer = candidate(makeEntry({ version: 6 }));
  assert.equal(arbitrateResumeCandidates(older, newer), newer);
  assert.equal(arbitrateResumeCandidates(newer, older), newer);
  assert.equal(arbitrateResumeCandidates(newer, candidate(makeEntry({ version: 6 }))).resume.meta.version, 6);
  for (const mismatch of [
    makeEntry({ version: 9, app: 'other.app' }),
    makeEntry({ version: 9, generation: 'gen1:bbbb' }),
    makeEntry({ version: 9, versionStream: 'stream-2' }),
    makeEntry({ version: 9, args: { other: true } }),
  ]) {
    assert.equal(arbitrateResumeCandidates(older, candidate(mismatch)), null);
  }
});

test('defaults: budget constants and the structural outbox hook', async () => {
  assert.equal(RQS_STORE_MAX_ENTRIES, 256);
  const { store } = await makeStore();
  assert.equal(await store.outboxEmpty(), true, 'no outbox machinery on this path = structurally empty');
  await store.close();
  const { store: gated } = await makeStore({ relaunchOutboxEmpty: () => false });
  assert.equal(await gated.outboxEmpty(), false);
  await gated.close();
});
