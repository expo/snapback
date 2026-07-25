// Channel B relaunch/resume acceptance — web arm (LLP 0090 rollout step 5,
// ENG-25456): the client half of the step-5 acceptance list driven against a
// scripted wire (fake fetch, poll transport), with real digests/tokens from
// rqs.mjs and the real IndexedDB store under the Web-Lock double.
//
// The server half of these behaviors (admission refusals by code, rung
// selection, mint suppression) is proven in Rust (tests/local_v0.rs, step 1);
// here the wire is scripted to the contract so the CLIENT transitions of LLP
// 0091 §0B.3 and the LLP 0090 D3 storage rules are what is under test.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IDBFactory } from 'fake-indexeddb';

import { SnapbackClient } from './index.mjs';
import { argsHash, digestOfRows } from './rqs.mjs';
import { createIndexedDbRqsResumeStore, rqsEntryKey } from './rqs-store.mjs';

// --- Web Locks double (queued exclusive, AbortSignal-aware) -----------------

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

// --- scripted wire ----------------------------------------------------------

let currentServer = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init = {}) => currentServer.handle(url, init);
test.after(() => { globalThis.fetch = originalFetch; });

function createFakeServer() {
  const server = {
    subscribeCalls: [],
    outbox: [],
    // (body, call) => subscribe response JSON
    answer: () => { throw new Error('no subscribe answer scripted'); },
    handle: async (url, init = {}) => {
      const target = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      if (target.pathname === '/connection/open') {
        return Response.json({ connectionId: body.connectionId, connectionToken: 'ct-1' });
      }
      const subscribe = target.pathname.match(/^\/live\/([^/]+)\/subscribe$/);
      if (subscribe) {
        const call = { name: decodeURIComponent(subscribe[1]), body };
        server.subscribeCalls.push(call);
        return Response.json(server.answer(body, call));
      }
      if (/^\/live\/[^/]+\/unsubscribe$/.test(target.pathname)) {
        return Response.json({ disposed: true });
      }
      if (/^\/outbox\//.test(target.pathname)) {
        const batch = server.outbox.splice(0);
        return Response.json(batch.map((update) => ({
          Durable: { payload: JSON.stringify(update) },
        })));
      }
      throw new Error(`unexpected request ${init.method ?? 'GET'} ${target.pathname}`);
    },
  };
  currentServer = server;
  return server;
}

// --- fixtures ---------------------------------------------------------------

const APP = 'demo.app';
const GEN = 'gen1:aaaa';
const STREAM = 'stream-1';
const QUERY = 'cells';
const ROWS_V5 = [{ _id: 'a', title: 'first' }, { _id: 'b', title: 'second' }];

function makeResume(rows, version, {
  kind = 'mset1',
  versionStream = STREAM,
  generation = GEN,
  args = {},
} = {}) {
  return {
    token: `sbrt1.sbrq_test.${Buffer.from(JSON.stringify({ version, versionStream })).toString('base64url')}.${'m'.repeat(43)}`,
    meta: {
      app: APP,
      version,
      contentDigest: digestOfRows(kind, rows),
      generation,
      versionStream,
      queryArtifact: `sha256:${'2'.repeat(64)}`,
      argsHash: argsHash(args),
    },
  };
}

async function makeStore({ indexedDB, lockManager, relaunchOutboxEmpty = null } = {}) {
  const store = createIndexedDbRqsResumeStore({
    indexedDB: indexedDB ?? new IDBFactory(),
    lockManager: lockManager ?? createLockManagerDouble(),
    relaunchOutboxEmpty,
  });
  await tick();
  return store;
}

function makeClient(store) {
  return new SnapbackClient('https://rqs.example.test', { rqsStore: store });
}

async function openQuery(client, { onUpdate = null, args = {}, ...options } = {}) {
  const updates = [];
  const handle = await client.liveQuery(QUERY, {
    connectionId: 'c1',
    transport: 'poll',
    args,
    onUpdate: (rows, detail) => {
      updates.push({ rows, detail });
      onUpdate?.(rows, detail);
    },
    ...options,
  });
  return { handle, updates };
}

/// Session 1 boilerplate: subscribe fresh, receive snapshot v5 + token, flush
/// the persisted entry, dispose. Returns the persisted token string.
async function populateStore(store, { rows = ROWS_V5, version = 5, kind = 'mset1' } = {}) {
  const server = createFakeServer();
  const resume = makeResume(rows, version, { kind });
  server.answer = () => ({
    subscription_id: 'sub-populate',
    snapshot: { rows, version },
    resume,
  });
  const client = makeClient(store);
  const { handle } = await openQuery(client);
  assert.equal(handle.freshness, 'current');
  await handle.flushResumeState();
  handle.dispose();
  const persisted = await store.load(rqsEntryKey(QUERY, {}));
  assert.notEqual(persisted, null, 'session 1 persisted an entry');
  assert.equal(persisted.token, resume.token);
  return resume;
}

// --- acceptance -------------------------------------------------------------

test('relaunch renders persisted rows as retained with the wire showing only CurrentAsOf (rung 1)', async () => {
  const indexedDB = new IDBFactory();
  const store1 = await makeStore({ indexedDB });
  const resume = await populateStore(store1);
  await store1.close();

  // Relaunch: fresh store over the same IndexedDB, fresh client.
  const store2 = await makeStore({ indexedDB });
  const server = createFakeServer();
  server.answer = (body) => {
    // §0B.4 dispatch rule 2: the persisted token seeds the fresh subscribe.
    assert.equal(body.resumeFromToken?.resume?.token, resume.token);
    return { subscription_id: 'sub-2' }; // rung 1: no snapshot rides the answer
  };
  const freshResume = makeResume(ROWS_V5, 6);
  server.outbox.push({
    kind: 'current_as_of',
    subscription_id: 'sub-2',
    function: QUERY,
    version: 6,
    resume: freshResume,
  });

  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client);
  // Render-first: the persisted rows surfaced as retained BEFORE any wire
  // answer, through the existing update path (T1).
  assert.equal(updates[0].detail.kind, 'persisted');
  assert.equal(updates[0].detail.freshness, 'retained');
  assert.deepEqual(updates[0].rows, ROWS_V5);
  assert.equal(handle.freshness, 'retained', 'retained until the authoritative answer');
  assert.deepEqual(handle.rows, ROWS_V5);

  await handle.poll(); // drain the CurrentAsOf
  assert.equal(handle.freshness, 'current');
  assert.equal(handle.version, 6);
  assert.deepEqual(handle.rows, ROWS_V5, 'CurrentAsOf never touches rows (T3)');
  assert.equal(server.subscribeCalls.length, 1, 'no refetch, no resubscribe');

  await handle.flushResumeState();
  const persisted = await store2.load(rqsEntryKey(QUERY, {}));
  assert.equal(persisted.meta.version, 6, 'the advanced token was persisted');
  assert.equal(persisted.token, freshResume.token);
  assert.ok(persisted.resumedAt > 0, 'successful authoritative resume bumped recency');
  handle.dispose();
  await store2.close();
});

test('relaunch AFTER live deltas resumes from the refreshed token without discarding persisted state', async () => {
  const indexedDB = new IDBFactory();
  const store1 = await makeStore({ indexedDB });
  const server = createFakeServer();
  const rowsV5 = [{ _id: 'a', title: 'first' }];
  const rowsV6 = [{ _id: 'a', title: 'first' }, { _id: 'b', title: 'added' }];
  const resumeV6 = makeResume(rowsV6, 6);
  server.answer = () => ({
    subscription_id: 'sub-1',
    snapshot: { rows: rowsV5, version: 5 },
    resume: makeResume(rowsV5, 5),
  });
  const client1 = makeClient(store1);
  const { handle: handle1 } = await openQuery(client1);
  server.outbox.push({
    kind: 'live_delta',
    subscription_id: 'sub-1',
    function: QUERY,
    version: 6,
    ops: [{ op: 'add', id: 'b', row: rowsV6[1] }],
    resume: resumeV6,
  });
  await handle1.poll();
  assert.deepEqual(handle1.rows, rowsV6);
  await handle1.flushResumeState();
  handle1.dispose();
  await store1.close();

  // Relaunch resumes from the DELTA-refreshED token, holding the delta-built
  // rows — persisted state is not discarded, not re-fetched.
  const store2 = await makeStore({ indexedDB });
  const relaunch = createFakeServer();
  relaunch.answer = (body) => {
    assert.equal(body.resumeFromToken?.resume?.token, resumeV6.token, 'the refreshed token seeded the resume');
    return { subscription_id: 'sub-2' };
  };
  relaunch.outbox.push({
    kind: 'current_as_of',
    subscription_id: 'sub-2',
    function: QUERY,
    version: 6,
    resume: makeResume(rowsV6, 6),
  });
  const client2 = makeClient(store2);
  const { handle: handle2, updates } = await openQuery(client2);
  assert.equal(updates[0].detail.kind, 'persisted');
  assert.deepEqual(updates[0].rows, rowsV6, 'the post-delta rows render from disk');
  await handle2.poll();
  assert.equal(handle2.freshness, 'current');
  handle2.dispose();
  await store2.close();
});

test('a replace-only (seq1) persisted entry takes rung 3 without error and the refused state is replaced', async () => {
  const indexedDB = new IDBFactory();
  const orderedRows = [{ _id: 'z', rank: 1 }, { _id: 'y', rank: 2 }];
  const store1 = await makeStore({ indexedDB });
  const staleResume = await populateStore(store1, { rows: orderedRows, kind: 'seq1' });
  await store1.close();

  const store2 = await makeStore({ indexedDB });
  const server = createFakeServer();
  const freshRows = [{ _id: 'y', rank: 1 }, { _id: 'z', rank: 2 }];
  const freshResume = makeResume(freshRows, 9, { kind: 'seq1' });
  server.answer = (body) => {
    assert.equal(body.resumeFromToken?.resume?.token, staleResume.token);
    // Ordered/replace-only: the server chose rung 3 — always correct.
    return {
      subscription_id: 'sub-2',
      snapshot: { rows: freshRows, version: 9 },
      resume: freshResume,
    };
  };
  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client);
  assert.equal(updates[0].detail.kind, 'persisted');
  assert.deepEqual(updates[0].rows, orderedRows, 'seq1 digest verifies the ordered persisted rows');
  assert.deepEqual(handle.rows, freshRows, 'rung 3 replaced without error');
  assert.equal(handle.freshness, 'current');
  await handle.flushResumeState();
  const persisted = await store2.load(rqsEntryKey(QUERY, {}));
  assert.equal(persisted.token, freshResume.token, 'the stale persisted state was discarded for the fresh mint');
  handle.dispose();
  await store2.close();
});

test('storage reset rotates versionStream: the stale token is refused (rung 3) and persisted state discarded', async () => {
  const indexedDB = new IDBFactory();
  const store1 = await makeStore({ indexedDB });
  const staleResume = await populateStore(store1);
  assert.equal(staleResume.meta.versionStream, STREAM);
  await store1.close();

  const store2 = await makeStore({ indexedDB });
  const server = createFakeServer();
  const freshRows = [{ _id: 'fresh', title: 'post-reset' }];
  const freshResume = makeResume(freshRows, 2, { versionStream: 'stream-2' });
  server.answer = (body) => {
    // The stale-stream token reached admission; the server refuses
    // (SNAPBACK_RESUME_STREAM_MISMATCH) and answers rung 3 on the same
    // subscribe — the client never retries the token (LLP 0091 §0B.4).
    assert.equal(body.resumeFromToken?.resume?.token, staleResume.token);
    return {
      subscription_id: 'sub-2',
      snapshot: { rows: freshRows, version: 2 },
      resume: freshResume,
    };
  };
  const client = makeClient(store2);
  const { handle } = await openQuery(client);
  assert.deepEqual(handle.rows, freshRows);
  await handle.flushResumeState();
  const persisted = await store2.load(rqsEntryKey(QUERY, {}));
  assert.equal(persisted.meta.versionStream, 'stream-2', 'post-reset stream state replaced the stale entry');
  assert.notEqual(persisted.token, staleResume.token);
  handle.dispose();
  await store2.close();
});

test('corrupt persisted state fails closed: no retained render, no token, entry invalidated', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const store1 = await makeStore({ indexedDB, lockManager });
  await populateStore(store1);
  // Tamper the persisted rows without updating the digest (a coherent
  // attacker is out of the v1 threat model; corruption detection is not).
  const key = rqsEntryKey(QUERY, {});
  const entry = await store1.load(key);
  await store1.commit(key, {
    rows: [...entry.rows, { _id: 'evil', injected: true }],
    meta: entry.meta,
    token: entry.token,
  });
  await store1.close();

  const store2 = await makeStore({ indexedDB, lockManager });
  const server = createFakeServer();
  server.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined, 'a corrupt entry seeds nothing');
    return {
      subscription_id: 'sub-2',
      snapshot: { rows: ROWS_V5, version: 7 },
      resume: makeResume(ROWS_V5, 7),
    };
  };
  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client);
  assert.notEqual(updates[0]?.detail.kind, 'persisted', 'corrupt rows never render');
  assert.deepEqual(handle.rows, ROWS_V5);
  await handle.flushResumeState();
  handle.dispose();
  await store2.close();
});

test('an entry left in-progress by an interrupted delta sequence falls back to fresh subscribe', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const store1 = await makeStore({ indexedDB, lockManager });
  await populateStore(store1);
  await store1.markInProgress(rqsEntryKey(QUERY, {}));
  await store1.close();

  const store2 = await makeStore({ indexedDB, lockManager });
  const server = createFakeServer();
  server.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined);
    return { subscription_id: 'sub-2', snapshot: { rows: ROWS_V5, version: 8 }, resume: makeResume(ROWS_V5, 8) };
  };
  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client);
  assert.notEqual(updates[0]?.detail.kind, 'persisted');
  assert.equal(handle.version, 8);
  handle.dispose();
  await store2.close();
});

test('token persistence failure falls back to fresh subscribe and never surfaces (T9)', async () => {
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const failing = Object.create(store);
  failing.commit = async () => { throw new Error('QuotaExceededError'); };

  const server = createFakeServer();
  server.answer = () => ({
    subscription_id: 'sub-1',
    snapshot: { rows: ROWS_V5, version: 5 },
    resume: makeResume(ROWS_V5, 5),
  });
  const client = new SnapbackClient('https://rqs.example.test', { rqsStore: failing });
  const { handle } = await openQuery(client);
  await handle.flushResumeState(); // commit throws; swallowed; entry invalidated
  assert.equal(handle.freshness, 'current', 'in-memory state unaffected');
  assert.deepEqual(handle.rows, ROWS_V5);
  assert.equal(await store.load(rqsEntryKey(QUERY, {})), null);
  handle.dispose();

  // Relaunch takes the fresh path (nothing persisted).
  const relaunch = createFakeServer();
  relaunch.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined);
    return { subscription_id: 'sub-2', snapshot: { rows: ROWS_V5, version: 6 }, resume: makeResume(ROWS_V5, 6) };
  };
  const client2 = makeClient(store);
  const { handle: handle2, updates } = await openQuery(client2);
  assert.notEqual(updates[0]?.detail.kind, 'persisted');
  handle2.dispose();
  await store.close();
});

test('auth-scoped/non-eligible data is never persisted: no token minted, nothing stored, relaunch renders nothing stale', async () => {
  // The server-side gate (step 1, Rust): tokens are minted only for
  // rqsEligible queries — auth-scoped subscriptions get `resume: null`. The
  // client-side write gate keys on exactly that fact: no token, no persist.
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const server = createFakeServer();
  server.answer = () => ({
    subscription_id: 'sub-1',
    snapshot: { rows: [{ _id: 'secret', owner: 'u1' }], version: 5 },
    // resume deliberately absent (auth-scoped / not rqsEligible)
  });
  const client = makeClient(store);
  const { handle } = await openQuery(client);
  await handle.flushResumeState();
  assert.equal((await store.inspection()).entries, 0, 'auth-scoped rows were never persisted');
  handle.dispose();

  // Relaunch after a permission change: nothing persisted exists, so nothing
  // stale can render — the subscribe is fresh and the response is the
  // server's post-change fresh snapshot.
  const relaunch = createFakeServer();
  relaunch.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined);
    return { subscription_id: 'sub-2', snapshot: { rows: [], version: 6 } };
  };
  const client2 = makeClient(store);
  const { handle: handle2, updates } = await openQuery(client2);
  assert.notEqual(updates[0]?.detail.kind, 'persisted');
  assert.deepEqual(handle2.rows, [], 'no stale auth-scoped rows after the permission change');
  handle2.dispose();
  await store.close();
});

test('a time-dependent (non-eligible) query re-executes on relaunch instead of receiving CurrentAsOf', async () => {
  // Closed-inputs eligibility (LLP 0090 Authorization scope): a query
  // reading time/randomness gets no token minted, so nothing persists and
  // every relaunch is a fresh execution — exactly today's behavior.
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const server = createFakeServer();
  let execution = 0;
  server.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined, 'no token ever exists for a non-eligible query');
    execution += 1;
    return {
      subscription_id: `sub-${execution}`,
      snapshot: { rows: [{ _id: 'now', executedAt: execution }], version: 5 + execution },
      // resume: null — the server refuses to mint without the closed-inputs proof
    };
  };
  const client = makeClient(store);
  const { handle } = await openQuery(client);
  await handle.flushResumeState();
  assert.equal((await store.inspection()).entries, 0);
  handle.dispose();

  const client2 = makeClient(store);
  const { handle: handle2, updates } = await openQuery(client2);
  assert.notEqual(updates[0]?.detail.kind, 'persisted');
  assert.equal(execution, 2, 'relaunch re-executed the query');
  assert.deepEqual(handle2.rows, [{ _id: 'now', executedAt: 2 }]);
  handle2.dispose();
  await store.close();
});

test('a non-empty relaunch outbox suppresses resumeFromToken and retained render (LLP 0090 D3 outbox rule)', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const store1 = await makeStore({ indexedDB, lockManager });
  await populateStore(store1);
  await store1.close();

  const store2 = await makeStore({
    indexedDB,
    lockManager,
    relaunchOutboxEmpty: () => false, // the composing layer reports pending mutations
  });
  const server = createFakeServer();
  server.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined, 'outbox non-empty: full-resync path, no token');
    return { subscription_id: 'sub-2', snapshot: { rows: ROWS_V5, version: 9 }, resume: makeResume(ROWS_V5, 9) };
  };
  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client);
  assert.notEqual(updates[0]?.detail.kind, 'persisted', 'nothing renders ahead of the 0043 resync');
  assert.equal(handle.version, 9);
  handle.dispose();
  await store2.close();
});

test('ResyncRequired with clear_retained purges the persisted copy, not just memory', async () => {
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const server = createFakeServer();
  let subscribes = 0;
  server.answer = () => {
    subscribes += 1;
    if (subscribes === 1) {
      return { subscription_id: 'sub-1', snapshot: { rows: ROWS_V5, version: 5 }, resume: makeResume(ROWS_V5, 5) };
    }
    // The forced resubscribe: no mint this time, so nothing repopulates.
    return { subscription_id: `sub-${subscribes}`, snapshot: { rows: [], version: 6 } };
  };
  const client = makeClient(store);
  const { handle } = await openQuery(client);
  await handle.flushResumeState();
  assert.equal((await store.inspection()).entries, 1);

  server.outbox.push({
    kind: 'resync_required',
    subscription_id: 'sub-1',
    reason: 'permission_epoch_changed',
    clear_retained: true,
  });
  await handle.poll();
  await handle.flushResumeState();
  assert.equal((await store.inspection()).entries, 0, 'the persisted copy was purged');
  assert.equal(handle.rqsResume, null);
  handle.dispose();
  await store.close();
});

test('two tabs racing persistence respect the single-writer lock; the reader adopts the store token', async () => {
  const indexedDB = new IDBFactory();
  const lockManager = createLockManagerDouble();
  const writerStore = await makeStore({ indexedDB, lockManager });
  const readerStore = await makeStore({ indexedDB, lockManager });
  assert.equal(writerStore.isWriter(), true);
  assert.equal(readerStore.isWriter(), false);

  const server = createFakeServer();
  let subscribes = 0;
  server.answer = () => {
    subscribes += 1;
    // Tab A (writer) subscribes first at v5; tab B at v6.
    const version = 4 + subscribes;
    return {
      subscription_id: `sub-${subscribes}`,
      snapshot: { rows: ROWS_V5, version },
      resume: makeResume(ROWS_V5, version),
    };
  };
  const clientA = makeClient(writerStore);
  const clientB = makeClient(readerStore);
  const { handle: handleA } = await openQuery(clientA);
  const { handle: handleB } = await openQuery(clientB);
  await handleA.flushResumeState();
  await handleB.flushResumeState();
  const persisted = await writerStore.load(rqsEntryKey(QUERY, {}));
  assert.equal(persisted.meta.version, 5, "only the lock holder's state persisted; the racing tab's write was a no-op");

  // The reader tab adopts the store's persisted state on its next relaunch.
  handleA.dispose();
  handleB.dispose();
  await writerStore.close();
  await tick();
  assert.equal(readerStore.isWriter(), true, 'lock takeover after the writer closed');
  const relaunch = createFakeServer();
  relaunch.answer = (body) => {
    assert.equal(body.resumeFromToken?.resume?.meta.version, 5, "the store's token, not the tab's own stale copy");
    return { subscription_id: 'sub-adopt' };
  };
  relaunch.outbox.push({
    kind: 'current_as_of',
    subscription_id: 'sub-adopt',
    function: QUERY,
    version: 7,
    resume: makeResume(ROWS_V5, 7),
  });
  const clientB2 = makeClient(readerStore);
  const { handle: adopted, updates } = await openQuery(clientB2);
  assert.equal(updates[0].detail.kind, 'persisted');
  await adopted.poll();
  assert.equal(adopted.freshness, 'current');
  adopted.dispose();
  await readerStore.close();
});

test('preloadedResume (Channel A) arbitrates against the persisted entry per LLP 0090 D3', async () => {
  const indexedDB = new IDBFactory();
  const store1 = await makeStore({ indexedDB });
  await populateStore(store1); // persisted at v5
  await store1.close();

  // Matching identity, higher version: the preload wins.
  const store2 = await makeStore({ indexedDB });
  const preloadRows = [...ROWS_V5, { _id: 'c', title: 'newer' }];
  const preload = { rows: preloadRows, resume: makeResume(preloadRows, 6) };
  const server = createFakeServer();
  server.answer = (body) => {
    assert.equal(body.resumeFromToken?.resume?.meta.version, 6, 'the arbitration winner seeds the subscribe');
    return { subscription_id: 'sub-2' };
  };
  server.outbox.push({
    kind: 'current_as_of',
    subscription_id: 'sub-2',
    function: QUERY,
    version: 6,
    resume: makeResume(preloadRows, 6),
  });
  const client = makeClient(store2);
  const { handle, updates } = await openQuery(client, { preloadedResume: preload });
  assert.equal(updates[0].detail.kind, 'persisted');
  assert.deepEqual(updates[0].rows, preloadRows, 'higher version within matching identity won');
  await handle.poll();
  handle.dispose();
  await store2.close();

  // Identity mismatch (different versionStream): BOTH candidates discarded.
  const store3 = await makeStore({ indexedDB });
  await tick();
  const mismatched = { rows: preloadRows, resume: makeResume(preloadRows, 9, { versionStream: 'stream-2' }) };
  const strict = createFakeServer();
  strict.answer = (body) => {
    assert.equal(body.resumeFromToken, undefined, 'identity mismatch discards both candidates');
    return { subscription_id: 'sub-3', snapshot: { rows: ROWS_V5, version: 10 }, resume: makeResume(ROWS_V5, 10) };
  };
  const client3 = makeClient(store3);
  const { handle: handle3, updates: updates3 } = await openQuery(client3, { preloadedResume: mismatched });
  assert.notEqual(updates3[0]?.detail.kind, 'persisted');
  assert.equal(handle3.version, 10);
  handle3.dispose();
  await store3.close();
});

test('persistence rides the debounce cadence without an explicit flush', async () => {
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const server = createFakeServer();
  server.answer = () => ({
    subscription_id: 'sub-1',
    snapshot: { rows: ROWS_V5, version: 5 },
    resume: makeResume(ROWS_V5, 5),
  });
  const client = makeClient(store);
  const { handle } = await openQuery(client);
  assert.equal((await store.inspection()).entries, 0, 'nothing written before the 1 s trailing debounce');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await store.inspection()).entries, 1, 'the debounced commit landed');
  handle.dispose();
  await store.close();
});

test('per-subscription opt-out (persistResume: false) keeps the store empty — the 0C manifest hook stand-in', async () => {
  const indexedDB = new IDBFactory();
  const store = await makeStore({ indexedDB });
  const server = createFakeServer();
  server.answer = () => ({
    subscription_id: 'sub-1',
    snapshot: { rows: ROWS_V5, version: 5 },
    resume: makeResume(ROWS_V5, 5),
  });
  const client = makeClient(store);
  const { handle } = await openQuery(client, { persistResume: false });
  await handle.flushResumeState();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await store.inspection()).entries, 0);
  handle.dispose();
  await store.close();
});
