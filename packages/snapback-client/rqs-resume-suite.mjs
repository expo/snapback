// Channel B relaunch/resume acceptance — the store-parameterized suite
// (LLP 0090 rollout step 5, ENG-25456). The step-5 acceptance list is one
// list; the web/IndexedDB arm and the native/DK-9 file arm run the SAME
// tests against a scripted wire (fake fetch, poll transport) with real
// digests/tokens from rqs.mjs. Each arm's test file supplies a context:
//
//   createContext() -> {
//     // Stores created by one context share one durable backing (one
//     // IndexedDB + lock domain; one on-disk store directory) — a fresh
//     // store over the same backing models an app relaunch.
//     makeStore({ relaunchOutboxEmpty } = {}) -> Promise<store>,
//     // Settle single-writer ownership after the holder closed (web: the
//     // queued Web Lock grants; native: the lock file is re-attempted).
//     settleOwnership(store) -> Promise<void>,
//     dispose?() -> Promise<void>,
//   }
//
// The server half of these behaviors (admission refusals by code, rung
// selection, mint suppression) is proven in Rust (tests/local_v0.rs, step
// 1); here the wire is scripted to the contract so the CLIENT transitions of
// LLP 0091 §0B.3 and the LLP 0090 D3 storage rules are what is under test.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SnapbackClient } from './index.mjs';
import {
  argsHash,
  base64UrlNoPad,
  digestOfRows,
  rowHash,
} from './rqs.mjs';
import { rqsEntryKey } from './rqs-store.mjs';

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- scripted wire ----------------------------------------------------------

let currentServer = null;
const originalFetch = globalThis.fetch;

export function createFakeServer() {
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
        const answer = server.answer(body, call);
        if (
          body.supersedes !== undefined
          && answer.superseded === undefined
          && answer.supersessionRefusal === undefined
        ) {
          answer.superseded = body.supersedes;
        }
        return Response.json(answer);
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
export const ROWS_V5 = [{ _id: 'a', title: 'first' }, { _id: 'b', title: 'second' }];

export function makeResume(rows, version, {
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

// --- the acceptance suite ---------------------------------------------------

export function defineChannelBResumeSuite({ arm, createContext }) {
  const armed = (name) => `${name} [${arm}]`;

  globalThis.fetch = (url, init = {}) => currentServer.handle(url, init);
  test.after(() => { globalThis.fetch = originalFetch; });

  const suiteTest = (name, run) => {
    test(armed(name), async (t) => {
      const ctx = await createContext();
      if (ctx.dispose) t.after(() => ctx.dispose());
      await run(ctx);
    });
  };

  suiteTest('relaunch renders persisted rows as retained with the wire showing only CurrentAsOf (rung 1)', async (ctx) => {
    const store1 = await ctx.makeStore();
    const resume = await populateStore(store1);
    await store1.close();

    // Relaunch: fresh store over the same durable backing, fresh client.
    const store2 = await ctx.makeStore();
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

  suiteTest('relaunch AFTER live deltas resumes from the refreshed token without discarding persisted state', async (ctx) => {
    const store1 = await ctx.makeStore();
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
    const store2 = await ctx.makeStore();
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

  suiteTest('relaunch with an mset1 entry sends the membership witness and rung-2 delta replay applies a predicate exit', async (ctx) => {
    const store1 = await ctx.makeStore();
    const resume = await populateStore(store1); // ROWS_V5 = [a, b] at v5
    await store1.close();

    const store2 = await ctx.makeStore();
    const server = createFakeServer();
    const addedRow = { _id: 'c', title: 'entered while offline' };
    const rowsV7 = [ROWS_V5[1], addedRow]; // a exited, c entered
    const freshResume = makeResume(rowsV7, 7);
    server.answer = (body) => {
      assert.equal(body.resumeFromToken?.resume?.token, resume.token);
      // The witness names the exact held pairs, sorted, with a count (LLP
      // 0091 rung-2 amendment).
      assert.deepEqual(body.resumeFromToken?.membershipWitness, {
        count: 2,
        entries: [
          { id: 'a', oldRowHash: base64UrlNoPad(rowHash(ROWS_V5[0])) },
          { id: 'b', oldRowHash: base64UrlNoPad(rowHash(ROWS_V5[1])) },
        ],
      });
      return { subscription_id: 'sub-2' }; // rung 2: no rows ride the answer
    };
    server.outbox.push({
      kind: 'live_delta',
      subscription_id: 'sub-2',
      function: QUERY,
      version: 7,
      ops: [
        { op: 'remove', id: 'a' },
        { op: 'add', id: 'c', row: addedRow },
      ],
      resume: freshResume,
    });

    const client = makeClient(store2);
    const { handle, updates } = await openQuery(client);
    assert.equal(updates[0].detail.kind, 'persisted');
    assert.equal(handle.freshness, 'retained');
    await handle.poll(); // drain the replay delta
    assert.equal(handle.freshness, 'current', 'post-replay digest verified (T8) before authority');
    assert.equal(handle.version, 7);
    assert.deepEqual(handle.rows, rowsV7, 'the offline predicate exit is exactly removed');
    assert.equal(server.subscribeCalls.length, 1, 'no refetch, no resubscribe');

    await handle.flushResumeState();
    const persisted = await store2.load(rqsEntryKey(QUERY, {}));
    assert.equal(persisted.meta.version, 7);
    assert.equal(persisted.token, freshResume.token);
    assert.ok(persisted.resumedAt > 0, 'rung-2 completion is a successful authoritative resume');
    handle.dispose();
    await store2.close();
  });

  suiteTest('a seq1 persisted entry sends no membership witness', async (ctx) => {
    const orderedRows = [{ _id: 'z', rank: 1 }, { _id: 'y', rank: 2 }];
    const store1 = await ctx.makeStore();
    const staleResume = await populateStore(store1, { rows: orderedRows, kind: 'seq1' });
    await store1.close();

    const store2 = await ctx.makeStore();
    const server = createFakeServer();
    server.answer = (body) => {
      assert.equal(body.resumeFromToken?.resume?.token, staleResume.token);
      assert.equal(body.resumeFromToken?.membershipWitness, undefined, 'seq1 is never witnessed');
      return {
        subscription_id: 'sub-2',
        snapshot: { rows: orderedRows, version: 9 },
        resume: makeResume(orderedRows, 9, { kind: 'seq1' }),
      };
    };
    const client = makeClient(store2);
    const { handle } = await openQuery(client);
    assert.equal(handle.freshness, 'current');
    handle.dispose();
    await store2.close();
  });

  suiteTest('a rung-2 delta whose post-replay digest mismatches is discarded: client-side rung 3 (T8 failure)', async (ctx) => {
    const store1 = await ctx.makeStore();
    await populateStore(store1);
    await store1.close();

    const store2 = await ctx.makeStore();
    const server = createFakeServer();
    const freshRows = [{ _id: 'fresh', title: 'replaced' }];
    server.answer = (body, call) => {
      if (server.subscribeCalls.length === 1) {
        assert.ok(body.resumeFromToken?.membershipWitness, 'first attempt carries the witness');
        return { subscription_id: 'sub-2' };
      }
      // The client-side rung 3: fresh subscribe with no token after the
      // failed verification.
      assert.equal(body.resumeFromToken, undefined, 'discarded state seeds nothing');
      return {
        subscription_id: `sub-${call ? server.subscribeCalls.length : 0}`,
        snapshot: { rows: freshRows, version: 9 },
        resume: makeResume(freshRows, 9),
      };
    };
    // A replay frame whose refreshed token does NOT match the post-apply rows.
    server.outbox.push({
      kind: 'live_delta',
      subscription_id: 'sub-2',
      function: QUERY,
      version: 7,
      ops: [{ op: 'remove', id: 'a' }],
      resume: makeResume([{ _id: 'not-what-you-hold' }], 7),
    });

    const client = makeClient(store2);
    const { handle } = await openQuery(client);
    await handle.poll(); // triggers the mismatch and the fresh resubscribe
    for (let i = 0; i < 50 && handle.version !== 9; i += 1) await tick();
    assert.equal(server.subscribeCalls.length, 2, 'verification failure resubscribes fresh');
    assert.deepEqual(handle.rows, freshRows);
    assert.equal(handle.freshness, 'current');
    await handle.flushResumeState();
    const persisted = await store2.load(rqsEntryKey(QUERY, {}));
    assert.equal(persisted.meta.version, 9, 'the discarded entry was replaced by post-rung-3 state');
    handle.dispose();
    await store2.close();
  });

  suiteTest('a replace-only (seq1) persisted entry takes rung 3 without error and the refused state is replaced', async (ctx) => {
    const orderedRows = [{ _id: 'z', rank: 1 }, { _id: 'y', rank: 2 }];
    const store1 = await ctx.makeStore();
    const staleResume = await populateStore(store1, { rows: orderedRows, kind: 'seq1' });
    await store1.close();

    const store2 = await ctx.makeStore();
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

  suiteTest('storage reset rotates versionStream: the stale token is refused (rung 3) and persisted state discarded', async (ctx) => {
    const store1 = await ctx.makeStore();
    const staleResume = await populateStore(store1);
    assert.equal(staleResume.meta.versionStream, STREAM);
    await store1.close();

    const store2 = await ctx.makeStore();
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

  suiteTest('corrupt persisted state fails closed: no retained render, no token, entry invalidated', async (ctx) => {
    const store1 = await ctx.makeStore();
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

    const store2 = await ctx.makeStore();
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

  suiteTest('an entry left in-progress by an interrupted delta sequence falls back to fresh subscribe', async (ctx) => {
    const store1 = await ctx.makeStore();
    await populateStore(store1);
    await store1.markInProgress(rqsEntryKey(QUERY, {}));
    await store1.close();

    const store2 = await ctx.makeStore();
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

  suiteTest('token persistence failure falls back to fresh subscribe and never surfaces (T9)', async (ctx) => {
    const store = await ctx.makeStore();
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

  suiteTest('auth-scoped/non-eligible data is never persisted: no token minted, nothing stored, relaunch renders nothing stale', async (ctx) => {
    // The server-side gate (step 1, Rust): tokens are minted only for
    // rqsEligible queries — auth-scoped subscriptions get `resume: null`. The
    // client-side write gate keys on exactly that fact: no token, no persist.
    const store = await ctx.makeStore();
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

  suiteTest('a time-dependent (non-eligible) query re-executes on relaunch instead of receiving CurrentAsOf', async (ctx) => {
    // Closed-inputs eligibility (LLP 0090 Authorization scope): a query
    // reading time/randomness gets no token minted, so nothing persists and
    // every relaunch is a fresh execution — exactly today's behavior.
    const store = await ctx.makeStore();
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

  suiteTest('a non-empty relaunch outbox suppresses resumeFromToken and retained render (LLP 0090 D3 outbox rule)', async (ctx) => {
    const store1 = await ctx.makeStore();
    await populateStore(store1);
    await store1.close();

    const store2 = await ctx.makeStore({
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

  suiteTest('ResyncRequired with clear_retained purges the persisted copy, not just memory', async (ctx) => {
    const store = await ctx.makeStore();
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

  suiteTest('two contexts racing persistence respect the single-writer lock; the reader adopts the store token', async (ctx) => {
    const writerStore = await ctx.makeStore();
    const readerStore = await ctx.makeStore();
    assert.equal(writerStore.isWriter(), true);
    assert.equal(readerStore.isWriter(), false);

    const server = createFakeServer();
    let subscribes = 0;
    server.answer = () => {
      subscribes += 1;
      // Context A (writer) subscribes first at v5; context B at v6.
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
    assert.equal(persisted.meta.version, 5, "only the lock holder's state persisted; the racing context's write was a no-op");

    // The reader context adopts the store's persisted state on its next relaunch.
    handleA.dispose();
    handleB.dispose();
    await writerStore.close();
    await ctx.settleOwnership(readerStore);
    assert.equal(readerStore.isWriter(), true, 'ownership takeover after the writer closed');
    const relaunch = createFakeServer();
    relaunch.answer = (body) => {
      assert.equal(body.resumeFromToken?.resume?.meta.version, 5, "the store's token, not the context's own stale copy");
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

  suiteTest('preloadedResume (Channel A) arbitrates against the persisted entry per LLP 0090 D3', async (ctx) => {
    const store1 = await ctx.makeStore();
    await populateStore(store1); // persisted at v5
    await store1.close();

    // Matching identity, higher version: the preload wins.
    const store2 = await ctx.makeStore();
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
    const store3 = await ctx.makeStore();
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

  suiteTest('persistence rides the debounce cadence without an explicit flush', async (ctx) => {
    const store = await ctx.makeStore();
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

  suiteTest('per-subscription opt-out (persistResume: false) keeps the store empty — the 0C manifest hook stand-in', async (ctx) => {
    const store = await ctx.makeStore();
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
}
