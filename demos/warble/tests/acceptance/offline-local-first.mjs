// Warble — offline acceptance for the local-first microblog surface.
//
// This is the evidence behind the diary's claims. It proves, on the JS arm
// with the DEFAULT persistence path (no injected store), that a Twitter-shaped
// app keeps working with the backend down:
//
//   1. both reader-facing live queries are classified retainable and hold a
//      server-minted resume token (the rqsEligible opt-in actually took);
//   2. a fresh client with the server stopped renders the retained timeline
//      AND the viewer's retained like set — the "did I like this" fact
//      survives offline because it is keyed by an argument, not authUserId();
//   3. composing and liking offline queue durably in order;
//   4. reconnect replays them exactly once, and the denormalized likeCount
//      lands on the right value rather than double-applying.
//
// @ref LLP 0090#d3-channel-b--persisted-device-snapshot — retained render
//   first; a non-empty outbox withholds the resume token.
// @ref LLP 0043#milestone-2-queued-mutation-replay — ordered, exactly-once.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const repoRoot = resolve(appDir, '..', '..');
const generatedDir = join(appDir, 'snapback', 'generated');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const generated = (name) => readJson(join(generatedDir, name));
const seed = readJson(join(appDir, 'snapback', 'seed.json'));

const ADA = 'ada';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(predicate, { timeoutMs = 30_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

const stateDir = mkdtempSync(join(tmpdir(), 'warble-offline-'));
process.env.SNAPBACK_CLIENT_RQS_DIR = join(stateDir, 'rqs');
delete process.env.SNAPBACK_CLIENT_RQS_STORE;
const dbPath = join(stateDir, 'warble.db');

const port = await freePort();
const provenance = {
  appId: 'warble',
  artifactsPath: join(generatedDir, 'artifacts.json'),
};
const bootServer = () => startServer({
  port,
  bindPortExactly: true,
  db: dbPath,
  cwd: repoRoot,
  provenance,
});
const provision = async (baseUrl, clientOptions) => {
  const provisioner = new SnapbackClient(baseUrl, { ...clientOptions, rqsStore: null });
  await provisioner.ensureApp({
    schema: generated('schema.manifest.json'),
    functions: generated('functions.manifest.json'),
    seed,
  });
};

const suite = createSuite('warble / offline-local-first', { expectedChecks: 6 });

let server = await bootServer();
await provision(server.baseUrl, server.clientOptions);

const cleanups = [];
const trackedClients = new Set();
const openClient = () => {
  const client = new SnapbackClient(server.baseUrl, server.clientOptions);
  trackedClients.add(client);
  return client;
};
const closeClient = async (client) => {
  trackedClients.delete(client);
  try { await client.rqsStore?.close?.(); } catch { /* teardown */ }
};
cleanups.push(async () => {
  for (const client of [...trackedClients]) await closeClient(client);
});
cleanups.push(() => server.stop().catch(() => {}));

await runAcceptance(suite, async () => {
  const clientA = openClient();
  let timelineA;
  let likesA;

  await suite.check('the timeline is retainable and holds a resume token', async () => {
    assertEqual(clientA.rqsStoreInfo.implementation, 'file', 'default store implementation');
    timelineA = await clientA.liveQuery('timeline', {
      connectionId: 'warble-a',
      args: {},
      transport: 'stream',
    });
    assertEqual(timelineA.rows.length, 4, 'seeded timeline rows');
    assertEqual(timelineA.rows[0].body.startsWith('Turn this one off'), true, 'newest first');
    assertEqual(timelineA.freshness, 'current', 'fresh subscribe is authoritative');
    assert(timelineA.retention?.retainable === true, 'timeline classified retainable');
    assert(timelineA.rqsResume?.token, 'server minted a timeline resume token');
    await timelineA.flushResumeState();
    return { retention: { ...timelineA.retention, store: undefined } };
  });

  await suite.check('the viewer\'s like set is retainable too (keyed by arg, not authUserId)', async () => {
    likesA = await clientA.liveQuery('myLikes', {
      connectionId: 'warble-a',
      args: { handle: ADA },
      transport: 'stream',
    });
    assertEqual(likesA.rows.map((r) => r.postId), ['seed_post_2'], 'ada\'s seeded like');
    assert(likesA.retention?.retainable === true, 'myLikes classified retainable');
    assert(likesA.rqsResume?.token, 'server minted a myLikes resume token');
    await likesA.flushResumeState();
    return { retention: { ...likesA.retention, store: undefined } };
  });

  // ---- Backend down ----
  timelineA.dispose();
  likesA.dispose();
  await closeClient(clientA);
  await server.stop();

  let clientB;
  let timelineB;
  await suite.check('a fresh client with the server down renders the retained timeline and like set', async () => {
    clientB = openClient();
    const frames = [];
    timelineB = await clientB.liveQuery('timeline', {
      connectionId: 'warble-b',
      args: {},
      transport: 'stream',
      onUpdate: (rows, detail) => frames.push(detail.kind),
    });
    assertEqual(frames[0], 'persisted', 'first frame is the persisted render');
    assertEqual(timelineB.freshness, 'retained', 'offline rows are retained, never current');
    assertEqual(timelineB.rows.length, 4, 'the whole timeline renders offline');

    const likesB = await clientB.liveQuery('myLikes', {
      connectionId: 'warble-b',
      args: { handle: ADA },
    });
    try {
      assertEqual(likesB.freshness, 'retained', 'like set is retained offline');
      assertEqual(likesB.rows.map((r) => r.postId), ['seed_post_2'], 'the heart survives a cold boot');
    } finally {
      likesB.dispose();
    }
    return { connection: timelineB.connection, rows: timelineB.rows.length };
  });

  let queuedPost;
  let queuedLike;
  await suite.check('composing and liking offline queue durably in order', async () => {
    queuedPost = await clientB.mutate('createPost', {
      args: { body: 'Posted from a tunnel with no signal.', authorHandle: ADA, authorName: 'Ada Lovelace' },
      userId: ADA,
    });
    queuedLike = await clientB.mutate('likePost', {
      args: { postId: 'seed_post_3', userHandle: ADA },
      userId: ADA,
    });
    assertEqual(queuedPost.status, 'queued', 'post queued');
    assertEqual(queuedLike.status, 'queued', 'like queued');
    assert(queuedLike.sequence > queuedPost.sequence, 'monotonic sequence order');
    const pending = await clientB.rqsStore.outboxPending();
    assertEqual(pending.map((r) => r.function), ['createPost', 'likePost'], 'durable ordered queue');
    return { queuedPost, queuedLike };
  });

  await suite.check('the retained frame stays pre-intent while writes are pending', async () => {
    const bystander = new SnapbackClient(server.baseUrl, server.clientOptions);
    try {
      const handle = await bystander.liveQuery('timeline', {
        connectionId: 'warble-rule',
        args: {},
      });
      try {
        assertEqual(handle.freshness, 'retained', 'retained render survives the pending outbox');
        assertEqual(handle.connection, 'stale', 'offline boot holds the stale axis');
        assertEqual(handle.pendingIntentsAtSeed, 2, 'the pending-intent fact is on the handle');
        assertEqual(handle.rqsResume, null, 'resume token withheld while the outbox is non-empty');
        assertEqual(handle.rows.length, 4, 'the queued post is NOT fabricated into the frame');
        return { pendingIntentsAtSeed: handle.pendingIntentsAtSeed };
      } finally {
        handle.dispose();
        await handle.settled?.();
      }
    } finally {
      await bystander.rqsStore?.close?.();
    }
  });

  await suite.check('reconnect replays both writes exactly once and the like count lands correctly', async () => {
    server = await bootServer();
    await provision(server.baseUrl, server.clientOptions);
    await waitUntil(async () => (await clientB.rqsStore.outboxPending()).length === 0, {
      label: 'outbox drain after reconnect',
    });
    await waitUntil(() => timelineB.freshness === 'current', { label: 'timeline back to current' });
    await waitUntil(
      () => timelineB.rows.some((row) => row.body === 'Posted from a tunnel with no signal.'),
      { label: 'replayed post visible' },
    );

    const posted = timelineB.rows.filter((r) => r.body === 'Posted from a tunnel with no signal.');
    assertEqual(posted.length, 1, 'exactly one settled post');
    assertEqual(posted[0].authorHandle, ADA, 'author recorded on the replayed post');
    assertEqual(timelineB.rows[0]._id, posted[0]._id, 'the offline post sorts newest by its minted timestamp');

    const liked = timelineB.rows.find((r) => r._id === 'seed_post_3');
    assertEqual(liked.likeCount, 1, 'replayed like incremented exactly once (no double-apply)');

    const diagnostics = clientB.outboxDiagnostics.map(({ code }) => code);
    assert(diagnostics.includes('SNAPBACK_OFFLINE_MUTATION_QUEUED'), 'queue diagnostic recorded');
    assert(diagnostics.includes('SNAPBACK_OFFLINE_MUTATION_REPLAYED'), 'replay diagnostic recorded');
    return { posted: posted[0], likeCount: liked.likeCount, diagnostics };
  });
}, {
  cleanups,
  reportFile: join(appDir, 'offline-acceptance-report.json'),
});
