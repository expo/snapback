// Provider live conformance — the LLP 0034 D5 named checks for what D1/D3
// built, runnable headlessly with node (no Exact checkout required).
//
//   node demos/_kit/tests/provider-live-conformance.mjs
//
// Named checks (numbering follows LLP 0034 rev 2 §6):
//   §6.1  snapshot-with-subscribe atomicity
//   §6.2  stream-delivered durable update (client A mutates over HTTP;
//         client B receives live_replace without polling)
//   §6.3  connection-axis transitions (fallback + no-fallback mappings)
//   §6.4  receipt monotonicity, partial pending D2 (the global commit
//         version is non-decreasing across snapshot and updates per binding)
//   §2.1  one socket, both lanes (durable + two-client presence multiplexed;
//         §6.7's shared-socket ground — the flood-priority check itself
//         waits on D2's delivered-rate receipts)
//   §6.8  codegen migration cross-check (old/new manifest fields agree; a
//         deliberately broken binding fails)
//
// @ref LLP 0034#6-d5--conformance-and-the-first-proof
// @ref Exact LLP 0284 §2.2 (connection axis), §5.2 (provider conformance)

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../client.mjs';
import { startServer } from '../server-process.mjs';
import { generate, crossCheckContractQueryBinding } from '../codegen.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const todoBackend = join(repoRoot, 'demos', 'todo', 'snapback');
const todoFixtures = join(repoRoot, 'demos', 'todo', 'tests', 'acceptance', 'fixtures');
const gen = (f) => JSON.parse(readFileSync(join(todoBackend, 'generated', f), 'utf8'));

const ADA = 'user_ada';
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const seed = JSON.parse(readFileSync(join(todoBackend, 'seed.json'), 'utf8'));

// Fast timers so transitions are observable in test time; the production
// defaults live in client.mjs (LIVE_HEARTBEAT_INTERVAL_MS and friends).
const FAST_STREAM = {
  heartbeatIntervalMs: 200,
  freshnessBudgetMs: 800,
  reconnectBaseDelayMs: 100,
  reconnectMaxDelayMs: 400,
};

const server = await startServer({ port: 4407, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('provider live conformance (LLP 0034 D5)');

// Bounded event-driven wait: resolves when `predicate()` is true, checked on
// every recorded event (never a bare sleep loop).
function createRecorder() {
  const transitions = [];
  const events = [];
  const updates = [];
  const waiters = new Set();
  const poke = () => {
    for (const waiter of [...waiters]) {
      if (waiter.predicate()) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }
  };
  return {
    transitions,
    events,
    updates,
    poke,
    onConnectionChange: (next, { previous }) => {
      transitions.push(`${previous}->${next}`);
      poke();
    },
    onSubscriptionEvent: (event) => {
      events.push(event);
      poke();
    },
    onUpdate: (rows, meta) => {
      updates.push({ rows, ...meta });
      poke();
    },
    waitFor(predicate, label, timeoutMs = 8_000) {
      if (predicate()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`timed out waiting for ${label}; transitions=[${transitions.join(', ')}] events=[${events.map((e) => e.event).join(', ')}]`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

try {
  await db.loadSchema(schemaManifest);
  await db.loadFunctions(functionsManifest);
  await db.reset();
  await db.seed(seed);

  await suite.check('snapshot-with-subscribe atomicity (LLP 0034 §6.1)', async () => {
    // One provider operation returns the subscription id AND the
    // authoritative snapshot together — no window in which a delta can be
    // missed, no separate prime read (Exact LLP 0284 §2.1 rule 1).
    const response = await db.subscribeLive('listTodos', { connectionId: 'atomic_conn', userId: ADA });
    assert(typeof response.subscription_id === 'string' && response.subscription_id.length > 0, 'missing subscription_id');
    assert(Array.isArray(response.snapshot?.rows), 'missing snapshot rows in the same response');
    assert(typeof response.snapshot?.version === 'number', 'missing snapshot version in the same response');
    assert(response.permission_epochs !== undefined, 'missing permission_epochs in the same response');
    assertEqual(response.snapshot.rows.length, 3, 'authoritative seed snapshot');

    // Every delta after the snapshot carries a version >= the snapshot's:
    // nothing can fall between the snapshot and the subscription.
    await db.mutate('createTodo', { args: { title: 'after atomic subscribe' }, userId: ADA });
    const updates = await db.drainUpdates('atomic_conn');
    const update = updates.find((u) => u.subscription_id === response.subscription_id);
    assert(update, 'delta for the atomic subscription not delivered');
    assert(update.version >= response.snapshot.version, `delta version ${update.version} regressed below snapshot ${response.snapshot.version}`);
    assertEqual(update.rows.length, 4, 'delta reflects the post-snapshot mutation');
    return { subscriptionId: response.subscription_id, snapshotVersion: response.snapshot.version, deltaVersion: update.version };
  });

  await suite.check('stream-delivered durable update: no polling (LLP 0034 §6.2)', async () => {
    await db.reset();
    await db.seed(seed);
    const recorder = createRecorder();
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'stream_b',
      userId: ADA,
      transport: 'stream',
      stream: FAST_STREAM,
      ...recorder,
    });
    try {
      await recorder.waitFor(() => handle.connection === 'live', "connection 'live'");
      // Client A (a separate client object, plain HTTP) mutates; client B must
      // receive the update over the socket — handle.poll() is never called.
      const clientA = new SnapbackClient(server.baseUrl);
      await clientA.mutate('createTodo', { args: { title: 'pushed to B over stream' }, userId: ADA });
      await recorder.waitFor(
        () => handle.rows.some((row) => row.title === 'pushed to B over stream'),
        'stream-delivered durable update',
      );
      assert(!recorder.transitions.some((t) => t.endsWith('->polling')), `fell back to polling: ${recorder.transitions}`);
      assertEqual(handle.connection, 'live', 'connection during push delivery');
      assertEqual(recorder.events[0]?.event, 'established', 'established event first');
      return { rows: handle.rows.length, transitions: recorder.transitions, updates: recorder.updates.length };
    } finally {
      handle.dispose();
    }
  });

  await suite.check('connection transitions: loss -> polling -> resubscribed -> live (LLP 0034 §6.3)', async () => {
    await db.reset();
    await db.seed(seed);
    const recorder = createRecorder();
    const connectionId = 'transitions_fallback';
    const handle = await db.liveQuery('listTodos', {
      connectionId,
      userId: ADA,
      transport: 'stream',
      pollCadenceMs: 200,
      stream: FAST_STREAM,
      ...recorder,
    });
    try {
      await recorder.waitFor(() => handle.connection === 'live', "initial 'live'");

      // Kill the socket: the mapping says fallback-enabled loss reports
      // 'polling' (HTTP drain at declared cadence), then recovery re-enters
      // through a fresh snapshot-with-subscribe ('resubscribed') -> 'live'.
      db.liveStreamManager(connectionId).debugCloseSocket();
      await recorder.waitFor(() => handle.connection === 'polling', "'polling' after socket loss");

      // A server-authored write during the outage must converge after recovery.
      const clientA = new SnapbackClient(server.baseUrl);
      await clientA.mutate('createTodo', { args: { title: 'written during outage' }, userId: ADA });

      await recorder.waitFor(
        () => recorder.events.some((e) => e.event === 'resubscribed' && e.reason === 'reconnect'),
        "'resubscribed' event",
      );
      await recorder.waitFor(() => handle.connection === 'live', "'live' after recovery");
      await recorder.waitFor(
        () => handle.rows.some((row) => row.title === 'written during outage'),
        'data convergence after recovery',
      );
      const serverRows = (await db.query('listTodos', { userId: ADA })).rows;
      assertEqual(handle.rows.map((r) => r._id).sort(), serverRows.map((r) => r._id).sort(), 'converged to server rows');
      const resubscribed = recorder.events.find((e) => e.event === 'resubscribed');
      assertEqual(resubscribed.reason, 'reconnect', 'resubscribed reason');
      assert(typeof resubscribed.snapshotVersion === 'number', 'resubscribed carries the server snapshot version');
      return { transitions: recorder.transitions, events: recorder.events.map((e) => `${e.event}${e.reason ? `:${e.reason}` : ''}`) };
    } finally {
      handle.dispose();
    }
  });

  await suite.check('connection transitions: fallback disabled -> stale; dispose -> disconnected (LLP 0034 §6.3)', async () => {
    await db.reset();
    await db.seed(seed);
    const recorder = createRecorder();
    const connectionId = 'transitions_nofallback';
    const handle = await db.liveQuery('listTodos', {
      connectionId,
      userId: ADA,
      transport: 'stream',
      fallbackToPoll: false,
      stream: FAST_STREAM,
      ...recorder,
    });
    try {
      await recorder.waitFor(() => handle.connection === 'live', "initial 'live'");
      db.liveStreamManager(connectionId).debugCloseSocket();
      // Fallback disabled: last-known rows stay renderable, the freshness
      // budget is missed while retry/backoff is in progress -> 'stale'.
      await recorder.waitFor(() => handle.connection === 'stale', "'stale' after loss with fallback disabled");
      assert(handle.rows.length === 3, 'last-known rows remain renderable while stale');

      // Restore: the retrying socket reconnects, re-enters through a fresh
      // snapshot ('resubscribed'), and data converges.
      const clientA = new SnapbackClient(server.baseUrl);
      await clientA.mutate('createTodo', { args: { title: 'written while stale' }, userId: ADA });
      await recorder.waitFor(
        () => recorder.events.some((e) => e.event === 'resubscribed'),
        "'resubscribed' after socket restore",
      );
      await recorder.waitFor(() => handle.connection === 'live', "'live' after restore");
      await recorder.waitFor(
        () => handle.rows.some((row) => row.title === 'written while stale'),
        'data convergence after restore',
      );
    } finally {
      handle.dispose();
    }
    assertEqual(handle.connection, 'disconnected', "dispose -> 'disconnected' (no retry scheduled)");
    assertEqual(recorder.events.at(-1)?.event, 'disposed', 'disposed event emitted');
    return { transitions: recorder.transitions };
  });

  await suite.check('version monotonicity on subscription facts (LLP 0034 §6.4, partial pending D2)', async () => {
    await db.reset();
    await db.seed(seed);
    const recorder = createRecorder();
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'monotonic_conn',
      userId: ADA,
      transport: 'stream',
      stream: FAST_STREAM,
      ...recorder,
    });
    try {
      await recorder.waitFor(() => handle.connection === 'live', "connection 'live'");
      const snapshotVersion = handle.version;
      const clientA = new SnapbackClient(server.baseUrl);
      for (let i = 0; i < 5; i += 1) {
        await clientA.mutate('createTodo', { args: { title: `burst ${i}` }, userId: ADA });
      }
      await recorder.waitFor(() => handle.rows.length === 8, 'burst delivery');
      const versions = recorder.updates.filter((u) => u.kind === 'live_replace').map((u) => u.version);
      assert(versions.length > 0, 'no live_replace updates recorded');
      for (const version of versions) {
        assert(version >= snapshotVersion, `update version ${version} below snapshot ${snapshotVersion}`);
      }
      for (let i = 1; i < versions.length; i += 1) {
        assert(versions[i] >= versions[i - 1], `versions regressed: ${versions.join(', ')}`);
      }
      assertEqual(handle.version, versions.at(-1), 'handle tracks the latest server version');
      return { snapshotVersion, versions };
    } finally {
      handle.dispose();
    }
  });

  await suite.check('one socket, both lanes: durable + two-client presence (LLP 0034 §2.1/§6.7 ground)', async () => {
    // Provision the generated ephemeral fixture (the todo boardCursors
    // collection) alongside the todo tables, as the headless suite does.
    const fixtureDir = mkdtempSync(join(todoFixtures, '.tmp-live-conformance-'));
    cpSync(join(todoFixtures, 'ephemeral-backend'), fixtureDir, { recursive: true });
    let generated;
    try {
      generated = await generate(fixtureDir);
      assert(generated.ok, `ephemeral fixture codegen failed: ${JSON.stringify(generated.diagnostics)}`);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
    await db.loadSchema({
      ...schemaManifest,
      schemaHash: 'sha256:todo-plus-board-cursors',
      inputsHash: 'todo-plus-board-cursors',
      ephemeralCollections: generated.schemaManifest.ephemeralCollections,
    });
    await db.loadFunctions(functionsManifest);
    await db.reset();
    await db.seed(seed);

    const scope = { boardId: 'board_live' };
    const permissions = [SnapbackClient.roomPermission('boardMember', scope)];
    const connectionId = 'lanes_conn';
    const recorder = createRecorder();

    // Durable lane: a live query streaming over the managed socket.
    const handle = await db.liveQuery('listTodos', {
      connectionId,
      userId: ADA,
      transport: 'stream',
      stream: FAST_STREAM,
      ...recorder,
    });
    const manager = db.liveStreamManager(connectionId);
    const ephemeralFrames = [];
    const offEphemeral = manager.onEphemeral((frame) => {
      ephemeralFrames.push(frame);
      recorder.poke();
    });
    try {
      await recorder.waitFor(() => handle.connection === 'live', "connection 'live'");

      // Ephemeral lane on the SAME socket: subscribe through the socket's own
      // request channel (the multiplexing the socket already does).
      const subAck = await manager.request({
        type: 'ephemeral_subscribe',
        request: {
          collection: 'boardCursors',
          scope,
          connection_id: connectionId,
          auth: SnapbackClient.auth(ADA, { permissions }),
        },
      });
      assertEqual(subAck.kind, 'ephemeral_ack', 'socket ephemeral subscribe ack');

      // Client B publishes presence; client A mutates durable rows. Both must
      // arrive on the one socket. (Server-side, the outbox drains the durable
      // lane before the ephemeral lane within each tick — LLP 0013
      // §delivery-lanes; the kit preserves arrival order.)
      const clientB = new SnapbackClient(server.baseUrl);
      await clientB.publishEphemeral('boardCursors', {
        connectionId: 'presence_publisher',
        scope,
        userId: ADA,
        permissions,
        value: { x: 12, y: 34 },
      });
      await clientB.mutate('createTodo', { args: { title: 'durable beside presence' }, userId: ADA });

      await recorder.waitFor(
        () => handle.rows.some((row) => row.title === 'durable beside presence'),
        'durable update on the shared socket',
      );
      await recorder.waitFor(
        () => ephemeralFrames.some((frame) => frame.message?.Upsert?.entry?.key === 'presence_publisher'),
        "client B's cursor on the shared socket",
      );
      const upsert = ephemeralFrames.find((frame) => frame.message?.Upsert)?.message.Upsert;
      assertEqual(upsert.entry.key, 'presence_publisher', 'presence entry keyed by publishing connection');
      return { durableRows: handle.rows.length, ephemeralFrames: ephemeralFrames.length };
    } finally {
      offEphemeral();
      handle.dispose();
    }
  });

  await suite.check('codegen migration cross-check: old/new fields agree; broken binding fails (LLP 0034 §6.8)', async () => {
    // Generate into a TEMP COPY of the todo backend (same depth under demos/
    // so its relative ../../_kit imports resolve) — a conformance check must
    // not rewrite committed generated artifacts as a side effect, even now
    // that regeneration is byte-identical (path-independent hashes).
    const tmpRoot = mkdtempSync(join(repoRoot, 'demos', '.tmp-live-conformance-'));
    let result;
    try {
      const tmpBackend = join(tmpRoot, 'snapback');
      cpSync(todoBackend, tmpBackend, { recursive: true });
      rmSync(join(tmpBackend, 'generated'), { recursive: true, force: true });
      result = await generate(tmpBackend);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
    assert(result.ok, `codegen failed: ${JSON.stringify(result.diagnostics)}`);
    const manifest = result.contractManifest;
    // Path-independent hashes make this a real freshness guard: regeneration
    // from ANY checkout must reproduce the committed inputsHash.
    assertEqual(manifest.inputsHash, gen('contract-data.manifest.json').inputsHash, 'committed artifacts are stale — rerun codegen');
    assertEqual(manifest.manifestVersion, 2, 'manifest v2');
    for (const [name, binding] of Object.entries(manifest.queries)) {
      assertEqual(crossCheckContractQueryBinding(name, binding), [], `cross-check mismatches for ${name}`);
    }
    const live = manifest.queries.listTodos;
    assertEqual(live.subscription, 'initial-snapshot', 'legacy field still emitted (emit-both)');
    assertEqual(live.mode, 'live', 'v2 mode');
    assertEqual(live.livePush, true, 'v2 livePush');
    assertEqual(live.initialSnapshot, true, 'v2 initialSnapshot');
    assertEqual(live.defaultLive, true, 'v2 defaultLive');
    assertEqual(live.pollCadenceMs, 1500, 'provider poll floor');
    const snapshotOnly = manifest.queries.listTodosOnce;
    assertEqual(snapshotOnly.mode, 'snapshot', 'snapshot mode for plain query');
    assertEqual(snapshotOnly.livePush, false, 'no livePush for plain query');

    // Deliberately broken bindings must fail loudly with the migration code.
    const broken = [
      { ...live, mode: 'snapshot' },
      { ...live, livePush: false },
      { ...live, subscription: 'none' },
      { ...snapshotOnly, defaultLive: true },
    ];
    for (const binding of broken) {
      const mismatches = crossCheckContractQueryBinding('brokenBinding', binding);
      assert(mismatches.length > 0, `broken binding not caught: ${JSON.stringify(binding)}`);
      assert(
        mismatches.every((d) => d.code === 'CONTRACT_MANIFEST_MIGRATION_MISMATCH' && d.severity === 'error'),
        `wrong diagnostic shape: ${JSON.stringify(mismatches)}`,
      );
    }
    return { queries: Object.keys(manifest.queries), brokenVariantsCaught: broken.length };
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('provider live conformance crashed:', error);
  await server.stop();
  process.exit(2);
}
