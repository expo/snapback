// Regression: the ephemeral wiring fixes from the ENG-22479 integration
// review (all four probe classes, inverted):
//   fix 1 — in-flight dedup: two bindings of one (collection, scope) mounting
//           in the same flush share ONE server subscription;
//   fix 2 — TTL expiry on a quiet room: an expired entry leaves the delivered
//           cell without further activity (Exact 0284 §2.5 normative);
//   fix 3 — a transient resync re-subscribe failure presents an honest
//           degraded cell ('stale') and recovers on bounded backoff;
//   fix 4 — dispose racing an in-flight subscribe never leaks a live overlay
//           (no lane consumer survives surface disposal).
// Plus the ENG-22541 reconnect regression (diary 0011 flip condition 3): a
// server restart sends NO in-band needs_resync, so the wiring must re-enter
// through a fresh snapshot-with-subscribe on socket regain (the kit's
// durable-lane needsResubscribe-on-open policy), present 'stale' — never
// 'live' — over the dead room until that subscribe lands, and never overlap
// two subscribes for one room.
//
// Plus the ENG-22527 item 3 idle-room teardown policy (LLP 0034 §10.1):
//   linger A — unbind→rebind WITHIN the linger window reuses the shared room
//              (no new server subscription);
//   linger B — unbind→expiry tears the room down (server registration
//              receipted disposed/unsubscribed) and a later rebind creates a
//              fresh subscription.
//
// Needs the Exact runtime, which imports .js-suffixed TypeScript modules that
// resolve ONLY under bun — run this suite with bun, never plain node. Under node
// the Exact runtime import crashes with a cryptic ERR_MODULE_NOT_FOUND (ENG-
// 22655); the requireBunRuntime guard below turns that into a clear message.
// Standard structured skip when no Exact checkout resolves.
//
// Run: bun demos/_kit/tests/regression-ephemeral-wiring.mjs   (NOT node)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { resolveExact } from '../exact-resolver.mjs';
import { assert, assertEqual, createSuite, requireBunRuntime } from '../harness.mjs';

// ENG-22655: fail fast with a "run under bun" message before the Exact runtime
// import can crash under node with an unhelpful module-resolution stack.
requireBunRuntime('_kit regression / ephemeral-wiring');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo-v2', 'snapback');
const exactInstallRoot = join(repoRoot, 'demos', 'todo-v2', 'surfaces', 'contract');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));
const { createSnapbackContractSurface } = await import(join(repoRoot, 'packages/snapback-contract/index.mjs'));
const { importExactContractRuntime } = await import(join(repoRoot, 'packages/snapback-contract/exact-package.mjs'));

const exact = resolveExact({ repoRoot, targetInstallRoot: exactInstallRoot });
if (exact.sourceKind === 'missing') {
  console.log(JSON.stringify({
    title: '_kit regression / ephemeral-wiring',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    diagnostics: exact.diagnostics,
  }, null, 2));
  console.log('\nSKIP (valid, expected_missing): _kit regression / ephemeral-wiring');
  process.exit(0);
}

const runtime = await importExactContractRuntime({ exactRoot: exact.path });
let server = await startServer({ port: 4436, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / ephemeral-wiring (ENG-22479 review fixes 1-4 + ENG-22527 idle linger)');
const ADA = 'user_ada';

const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const contractDataManifest = gen('contract-data.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));

const waitFor = async (predicate, label, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${label}`);
};

let surface = null;
try {
  await db.loadSchema(schemaManifest);
  await db.loadFunctions(functionsManifest);
  await db.reset();
  await db.seed(seed);

  await suite.check('fix 1: two same-flush bindings share one server subscription', async () => {
    const realSubscribe = db.subscribeEphemeral.bind(db);
    let subscribeCalls = 0;
    db.subscribeEphemeral = (...args) => {
      subscribeCalls += 1;
      return realSubscribe(...args);
    };
    try {
      surface = await createSnapbackContractSurface({
        queryName: 'listTodos',
        boundaryKey: 'todos',
        runtime,
        client: db,
        userId: ADA,
        manifest: contractDataManifest,
        schemaManifest,
        functionManifest: functionsManifest,
        livePush: false, // durable stream not needed; isolates ephemeral wiring
      });
      subscribeCalls = 0;

      // Two bindings of the SAME room mount in one flush, NO prewarm.
      const cellsA = [];
      const cellsB = [];
      const subA = surface.provider.subscribeEphemeral('todoPresence', { listId: 'shared' }, (cell) => cellsA.push(cell));
      const subB = surface.provider.subscribeEphemeral('todoPresence', { listId: 'shared' }, (cell) => cellsB.push(cell));
      await waitFor(() => cellsA.some((c) => c.status === 'ready') && cellsB.some((c) => c.status === 'ready'), 'both observers ready');
      assertEqual(subscribeCalls, 1, 'exactly one server subscription for the shared room');

      // Both observers keep receiving through the shared record.
      await db.publishEphemeral('todoPresence', {
        connectionId: 'viewer_shared', scope: { listId: 'shared' }, userId: ADA, value: { name: 'shared viewer' },
      });
      await waitFor(
        () => cellsA.at(-1)?.entries.some((e) => e.key === 'viewer_shared')
          && cellsB.at(-1)?.entries.some((e) => e.key === 'viewer_shared'),
        'publish reaches both observers',
      );
      subA.dispose();
      subB.dispose();
      return { subscribeCalls, a: cellsA.length, b: cellsB.length };
    } finally {
      db.subscribeEphemeral = realSubscribe;
    }
  });

  await suite.check('fix 2: an expired entry leaves the binding on a quiet room (0284 §2.5)', async () => {
    const cells = [];
    const sub = surface.provider.subscribeEphemeral('todoPresence', { listId: 'ttl_room' }, (cell) => cells.push(cell));
    try {
      await waitFor(() => cells.some((c) => c.status === 'ready'), 'ready map');
      await db.publishEphemeral('todoPresence', {
        connectionId: 'brief_viewer', scope: { listId: 'ttl_room' }, userId: ADA,
        value: { name: 'brief' }, ttlMs: 300,
      });
      await waitFor(
        () => cells.at(-1)?.entries.some((e) => e.key === 'brief_viewer'),
        'entry visible before TTL',
      );
      // NO further activity: the expiry re-emit timer must remove it.
      await waitFor(
        () => cells.at(-1)?.entries.every((e) => e.key !== 'brief_viewer'),
        'expired entry leaves the delivered cell without any publish/sweep',
        3_000,
      );
      const last = cells.at(-1);
      assert(last.status === 'ready', 'map stays ready');
      assert(last.connection !== 'stale' && last.connection !== 'disconnected', `healthy connection during expiry prune: ${last.connection}`);
      return { cells: cells.length, connection: last.connection };
    } finally {
      sub.dispose();
    }
  });

  await suite.check('fix 3: a transient resync re-subscribe failure degrades honestly, then recovers', async () => {
    const cells = [];
    const sub = surface.provider.subscribeEphemeral('todoPresence', { listId: 'resync_room' }, (cell) => cells.push(cell));
    try {
      await waitFor(() => cells.some((c) => c.status === 'ready'), 'ready map');
      await db.publishEphemeral('todoPresence', {
        connectionId: 'steady_viewer', scope: { listId: 'resync_room' }, userId: ADA, value: { name: 'steady' },
      });
      await waitFor(() => cells.at(-1)?.entries.some((e) => e.key === 'steady_viewer'), 'pre-resync entry');

      // The resync's FIRST fresh subscribe fails transiently; the bounded
      // backoff retry must recover.
      const realSubscribe = db.subscribeEphemeral.bind(db);
      let failures = 1;
      db.subscribeEphemeral = (...args) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(new Error('SNAPBACK_TRANSIENT: simulated resync failure'));
        }
        return realSubscribe(...args);
      };
      try {
        // Collection replace retires the room epoch and enqueues the resync
        // boundary (the D2 epoch work).
        const changed = structuredClone(schemaManifest.ephemeralCollections);
        changed.find((c) => c.name === 'todoPresence').defaultTtlMs = 21_000;
        await db.loadSchema({
          ...schemaManifest,
          schemaHash: 'sha256:resync-transient',
          inputsHash: 'resync-transient',
          ephemeralCollections: changed,
        });
        await waitFor(
          () => cells.at(-1)?.connection === 'stale',
          "degraded cell ('stale') while the re-subscribe retries",
        );
        await waitFor(
          () => cells.at(-1)?.connection !== 'stale',
          'recovery after the backoff retry',
          6_000,
        );
      } finally {
        db.subscribeEphemeral = realSubscribe;
      }
      // Fresh entries flow after recovery (new epoch, applied — never
      // ignored_stale).
      await db.publishEphemeral('todoPresence', {
        connectionId: 'post_resync_viewer', scope: { listId: 'resync_room' }, userId: ADA, value: { name: 'fresh' },
      });
      await waitFor(
        () => cells.at(-1)?.entries.some((e) => e.key === 'post_resync_viewer'),
        'fresh entries after recovery',
      );
      return { lastConnection: cells.at(-1).connection, entries: cells.at(-1).entries.map((e) => e.key) };
    } finally {
      sub.dispose();
    }
  });

  await suite.check('fix 4: dispose racing an in-flight subscribe leaks nothing', async () => {
    // A fresh surface whose room subscribe is deliberately slowed, disposed
    // mid-flight: the late-resolving overlay must be torn down immediately —
    // no lane consumer (and no socket demand) survives the disposal.
    const slow = new SnapbackClient(server.baseUrl, server.clientOptions);
    const realSubscribe = slow.subscribeEphemeral.bind(slow);
    slow.subscribeEphemeral = async (...args) => {
      await sleep(400);
      return realSubscribe(...args);
    };
    const racedSurface = await createSnapbackContractSurface({
        queryName: 'listTodos',
        boundaryKey: 'todos',
      runtime,
      client: slow,
      userId: ADA,
      manifest: contractDataManifest,
      schemaManifest,
      functionManifest: functionsManifest,
      livePush: false,
    });
    const cells = [];
    const sub = racedSurface.provider.subscribeEphemeral('todoPresence', { listId: 'raced_room' }, (cell) => cells.push(cell));
    // Dispose while the 400ms-delayed subscribe is still in flight.
    await sleep(50);
    sub.dispose();
    racedSurface.dispose();
    await sleep(700); // let the in-flight subscribe resolve post-dispose

    const consumers = slow.__laneConsumers?.get(racedSurface.connectionId);
    assertEqual(consumers?.ephemeral?.size ?? 0, 0, 'no ephemeral lane consumer survives disposal');
    assert(!cells.some((c) => c.status === 'ready' && c.entries.length > 0), 'no late delivery after disposal');
    return { cells: cells.length };
  });

  // --- ENG-22527 item 3: idle-room teardown (linger) ---
  // A dedicated surface with a FAST linger override so both arms run in
  // test time (production default is EPHEMERAL_IDLE_LINGER_MS = 30s).
  const LINGER_MS = 300;
  const lingerClient = new SnapbackClient(server.baseUrl, server.clientOptions);
  const realLingerSubscribe = lingerClient.subscribeEphemeral.bind(lingerClient);
  let lingerSubscribeCalls = 0;
  lingerClient.subscribeEphemeral = (...args) => {
    lingerSubscribeCalls += 1;
    return realLingerSubscribe(...args);
  };
  const lingerSurface = await createSnapbackContractSurface({
    queryName: 'listTodos',
    boundaryKey: 'todos',
    runtime,
    client: lingerClient,
    userId: ADA,
    manifest: contractDataManifest,
    schemaManifest,
    functionManifest: functionsManifest,
    livePush: false,
    ephemeralIdleLingerMs: LINGER_MS,
  });

  await suite.check('linger A: rebind within the window reuses the room (no new server subscribe)', async () => {
    lingerSubscribeCalls = 0;
    const first = [];
    const subFirst = lingerSurface.provider.subscribeEphemeral('todoPresence', { listId: 'linger_reuse' }, (cell) => first.push(cell));
    await waitFor(() => first.some((c) => c.status === 'ready'), 'first bind ready');
    assertEqual(lingerSubscribeCalls, 1, 'first bind subscribes once');
    subFirst.dispose();

    // Rebind well inside the linger window.
    await sleep(LINGER_MS / 3);
    const second = [];
    const subSecond = lingerSurface.provider.subscribeEphemeral('todoPresence', { listId: 'linger_reuse' }, (cell) => second.push(cell));
    await waitFor(() => second.some((c) => c.status === 'ready'), 'rebind ready');
    assertEqual(lingerSubscribeCalls, 1, 'rebind within the window reuses the subscription');

    // The reused room is genuinely live: a publish still reaches the observer,
    // and holding it PAST the original expiry proves the timer was cancelled.
    await db.publishEphemeral('todoPresence', {
      connectionId: 'linger_viewer', scope: { listId: 'linger_reuse' }, userId: ADA, value: { name: 'still here' },
    });
    await waitFor(() => second.at(-1)?.entries.some((e) => e.key === 'linger_viewer'), 'publish reaches the reused room');
    await sleep(LINGER_MS + 150);
    await db.publishEphemeral('todoPresence', {
      connectionId: 'linger_viewer_2', scope: { listId: 'linger_reuse' }, userId: ADA, value: { name: 'after window' },
    });
    await waitFor(() => second.at(-1)?.entries.some((e) => e.key === 'linger_viewer_2'), 'room alive past the cancelled window');
    assertEqual(lingerSubscribeCalls, 1, 'still the single original subscription');
    subSecond.dispose();
    return { subscribeCalls: lingerSubscribeCalls };
  });

  await suite.check('linger B: expiry tears down (receipted disposed) and rebind subscribes fresh', async () => {
    lingerSubscribeCalls = 0;
    const first = [];
    const subFirst = lingerSurface.provider.subscribeEphemeral('todoPresence', { listId: 'linger_expire' }, (cell) => first.push(cell));
    await waitFor(() => first.some((c) => c.status === 'ready'), 'first bind ready');
    assertEqual(lingerSubscribeCalls, 1, 'first bind subscribes once');
    subFirst.dispose();

    // Let the linger window expire: the adapter must best-effort unsubscribe,
    // and the server receipts the registration as disposed/unsubscribed.
    await waitFor(
      () => lingerClient.receipts().some((r) => r.lane === 'ephemeral'
        && r.event === 'disposed'
        && r.reason === 'unsubscribed'
        && r.collection === 'todoPresence'
        && r.scope?.listId === 'linger_expire'),
      'disposal receipt after linger expiry',
      LINGER_MS * 10,
    );
    const receipt = lingerClient.receipts().find((r) => r.lane === 'ephemeral' && r.reason === 'unsubscribed' && r.scope?.listId === 'linger_expire');
    assertEqual(receipt.removed, true, 'server actually removed the registration');

    // Rebind after expiry: a FRESH subscription (cache dropped).
    const second = [];
    const subSecond = lingerSurface.provider.subscribeEphemeral('todoPresence', { listId: 'linger_expire' }, (cell) => second.push(cell));
    await waitFor(() => second.some((c) => c.status === 'ready'), 'post-expiry rebind ready');
    assertEqual(lingerSubscribeCalls, 2, 'rebind after expiry creates a fresh subscription');
    await db.publishEphemeral('todoPresence', {
      connectionId: 'fresh_viewer', scope: { listId: 'linger_expire' }, userId: ADA, value: { name: 'fresh room' },
    });
    await waitFor(() => second.at(-1)?.entries.some((e) => e.key === 'fresh_viewer'), 'fresh room is live');
    subSecond.dispose();
    return { subscribeCalls: lingerSubscribeCalls, receipt: { event: receipt.event, reason: receipt.reason, removed: receipt.removed } };
  });

  lingerClient.subscribeEphemeral = realLingerSubscribe;
  lingerSurface.dispose();

  await suite.check('ENG-22541: a server restart re-subscribes the room on socket regain, never live over a dead room', async () => {
    if (server.reused) {
      throw new Error('restart regression requires a suite-owned server — free port 4436 and re-run');
    }
    // Per-room in-flight subscribe tracking: the socket-regain trigger must
    // never overlap the in-band resync retry loop (double-subscription guard).
    const realSubscribe = db.subscribeEphemeral.bind(db);
    const inflight = new Map();
    let maxOverlap = 0;
    db.subscribeEphemeral = (ref, opts) => {
      const key = JSON.stringify([typeof ref === 'string' ? ref : ref?.name, opts?.scope ?? {}]);
      const depth = (inflight.get(key) ?? 0) + 1;
      inflight.set(key, depth);
      maxOverlap = Math.max(maxOverlap, depth);
      const done = () => inflight.set(key, (inflight.get(key) ?? 1) - 1);
      return realSubscribe(ref, opts).then(
        (overlay) => { done(); return overlay; },
        (error) => { done(); throw error; },
      );
    };
    const cells = [];
    const sub = surface.provider.subscribeEphemeral('todoPresence', { listId: 'restart_room' }, (cell) => cells.push(cell));
    try {
      await waitFor(() => cells.some((c) => c.status === 'ready'), 'ready map');
      await db.publishEphemeral('todoPresence', {
        connectionId: 'restart_viewer_pre', scope: { listId: 'restart_room' }, userId: ADA, value: { name: 'pre-restart' },
      });
      await waitFor(() => cells.at(-1)?.entries.some((e) => e.key === 'restart_viewer_pre'), 'pre-restart entry');

      // Server restart: every subscription dies with its socket (diary 0007
      // close→disconnect) and NO in-band needs_resync ever arrives.
      await server.stop();
      await waitFor(() => cells.at(-1)?.connection === 'stale', "honest 'stale' during the outage", 20_000);
      // Respawn on the port the first server ACTUALLY got: with the
      // ENG-22757 provenance gate, a squatter on 4436 moves the first spawn
      // to an isolated port, and `db` (bound to server.baseUrl) must find the
      // restarted server at that same origin.
      server = await startServer({
        port: Number(new URL(server.baseUrl).port),
        db: ':memory:',
        cwd: repoRoot,
        env: { SNAPBACK_ADMIN_TOKEN: server.adminToken },
        bindPortExactly: true,
      });
      await db.loadSchema(schemaManifest);
      await db.loadFunctions(functionsManifest);

      // The fix: socket regain re-enters through a fresh
      // snapshot-with-subscribe (mirroring demos/_kit/client.mjs's durable
      // lane), and only THAT promotes the presented axis back to 'live'.
      await waitFor(() => cells.at(-1)?.connection === 'live', "'live' after regain + fresh subscribe", 30_000);

      // Honesty ordering: the first post-outage 'live' cell must be the
      // fresh snapshot — never the frozen pre-restart map under a live
      // banner (the ENG-22541 failure mode).
      const staleIdx = cells.findIndex((c) => c.connection === 'stale');
      const firstLive = cells.slice(staleIdx).find((c) => c.connection === 'live');
      assert(
        firstLive && firstLive.entries.every((e) => e.key !== 'restart_viewer_pre'),
        `first live cell after the outage must be the fresh snapshot, got: ${JSON.stringify(firstLive?.entries ?? null)}`,
      );

      // The probe's flip-condition check: a fresh publish reaches the room.
      await db.publishEphemeral('todoPresence', {
        connectionId: 'restart_viewer_post', scope: { listId: 'restart_room' }, userId: ADA, value: { name: 'post-restart' },
      });
      await waitFor(() => cells.at(-1)?.entries.some((e) => e.key === 'restart_viewer_post'), 'fresh publish arrives after the restart', 10_000);

      assertEqual(maxOverlap, 1, 'no overlapping subscribes for one room (double-subscription guard)');
      return { cells: cells.length, lastConnection: cells.at(-1).connection, maxOverlap };
    } finally {
      sub.dispose();
      db.subscribeEphemeral = realSubscribe;
    }
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  surface?.dispose?.();
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('regression harness crashed:', error);
  surface?.dispose?.();
  await server.stop();
  process.exit(2);
}
