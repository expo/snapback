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
//
// Needs the Exact runtime (run with bun); standard structured skip without it.
//
// Run: bun demos/_kit/tests/regression-ephemeral-wiring.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { resolveExact } from '../exact-resolver.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo-v2', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));
const { createSnapbackContractSurface } = await import(join(repoRoot, 'packages/snapback-contract/index.mjs'));
const { importExactContractRuntime } = await import(join(repoRoot, 'packages/snapback-contract/exact-package.mjs'));

const exact = resolveExact({ repoRoot });
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
const server = await startServer({ port: 4436, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('_kit regression / ephemeral-wiring (ENG-22479 review fixes 1-4)');
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
    const slow = new SnapbackClient(server.baseUrl);
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
