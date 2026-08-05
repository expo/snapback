// LLP 0032 P4: the named multiplexing proof — two durable liveQuery handles
// PLUS an ephemeral overlay share one connection (and one socket), and every
// lane advances independently; a socket kill converges all lanes again.
//
// The P4 register (2026-07-01) recorded destructive whoever-asks-first drains:
// two handles discarded each other's updates, and durable/ephemeral consumers
// discarded each other's envelopes. The LLP 0034 D1 + ENG-22478 D2 arc
// replaced that with subscription-id-addressed envelopes and the per-connection
// lane registry; this test pins the combined claim in one place.
//
// Run: node demos/_kit/tests/regression-multiplexed-lanes.mjs

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { assert, createSuite } from '../harness.mjs';
import { generate } from '../codegen.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo', 'snapback');
const cursorFixtureDir = join(repoRoot, 'demos', 'todo', 'tests', 'acceptance', 'fixtures', 'ephemeral-backend');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));

const server = await startServer({ port: 4423, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / multiplexed-lanes (LLP 0032 P4)');
const ADA = 'user_ada';
const FAST = { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 };

const waitFor = async (predicate, label, timeoutMs = 6_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  // Board-cursor ephemeral collection codegen'd from the shared fixture, then
  // merged into the todo schema (the todo headless suite's pattern). The
  // scratch copy stays beside the fixture so its relative define.mjs import
  // still resolves.
  const scratch = mkdtempSync(join(dirname(cursorFixtureDir), '.tmp-mux-'));
  let cursorRef;
  let ephemeralCollections;
  try {
    cpSync(cursorFixtureDir, scratch, { recursive: true });
    const generated = await generate(scratch);
    assert(generated.ok, `fixture codegen failed: ${JSON.stringify(generated.diagnostics)}`);
    const api = await import(`${new URL(`file://${join(scratch, 'generated', 'api.mjs')}`).href}`);
    cursorRef = api.ephemeral.boardCursors;
    ephemeralCollections = generated.schemaManifest.ephemeralCollections;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  await db.loadSchema({
    ...gen('schema.manifest.json'),
    schemaHash: 'sha256:todo-plus-board-cursors',
    inputsHash: 'todo-plus-board-cursors',
    ephemeralCollections,
  });
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  const scope = { boardId: 'board_1' };
  const permissions = [SnapbackClient.roomPermission('boardMember', scope)];
  // @ref LLP 0034#101-implementation-review-round--first-proof-2026-07-02
  // — exact socket teardown temporarily suspends one connection id. These
  // independent lifecycle checks use distinct ids so check two cannot race
  // check one's legal cleanup while each still proves same-socket multiplexing.
  const SHARED_CONN = 'mux_shared_conn';
  const RECONNECT_CONN = 'mux_reconnect_conn';

  await suite.check('two durable handles + an ephemeral overlay share one connection; every lane advances', async () => {
    const a = await db.liveQuery('listTodos', { connectionId: SHARED_CONN, userId: ADA, transport: 'stream', stream: FAST });
    const b = await db.liveQuery('listTodos', { connectionId: SHARED_CONN, userId: ADA, transport: 'stream', stream: FAST });
    const overlay = await db.subscribeEphemeral(cursorRef, { connectionId: SHARED_CONN, scope, userId: ADA, permissions });
    const writer = new SnapbackClient(server.baseUrl, server.clientOptions);
    try {
      await waitFor(() => a.connection === 'live' && b.connection === 'live', "both durable handles 'live'");

      // Durable lane: both handles see the same server-authored write.
      await writer.mutate('createTodo', { args: { title: 'mux durable' }, userId: ADA });
      await waitFor(() => a.rows.some((r) => r.title === 'mux durable'), 'handle A advanced');
      await waitFor(() => b.rows.some((r) => r.title === 'mux durable'), 'handle B advanced');

      // Ephemeral lane on the SAME connection: a publish from another
      // connection reaches the overlay without disturbing the durable lane.
      const durableVersion = a.version;
      await writer.publishEphemeral(cursorRef, {
        connectionId: 'mux_publisher',
        scope,
        userId: ADA,
        permissions,
        value: { x: 7, y: 9 },
      });
      await waitFor(() => overlay.currentEntries().length === 1, 'overlay received the presence upsert');
      assert(a.version === durableVersion && b.version === durableVersion, 'ephemeral publish must not advance the durable lane');

      // And the durable lane still advances after ephemeral traffic.
      await writer.mutate('createTodo', { args: { title: 'mux durable 2' }, userId: ADA });
      await waitFor(() => a.rows.some((r) => r.title === 'mux durable 2') && b.rows.some((r) => r.title === 'mux durable 2'), 'both handles advanced again');
      return { aRows: a.rows.length, bRows: b.rows.length, overlayEntries: overlay.currentEntries().length };
    } finally {
      a.dispose();
      b.dispose();
      overlay.dispose();
      // The writer holds no stream; nothing to close.
    }
  });

  await suite.check('a socket kill converges every lane (fresh snapshots, no resume)', async () => {
    const events = [];
    const a = await db.liveQuery('listTodos', {
      connectionId: RECONNECT_CONN,
      userId: ADA,
      transport: 'stream',
      stream: FAST,
      onSubscriptionEvent: (e) => events.push(e),
    });
    const b = await db.liveQuery('listTodos', { connectionId: RECONNECT_CONN, userId: ADA, transport: 'stream', stream: FAST });
    const writer = new SnapbackClient(server.baseUrl, server.clientOptions);
    try {
      await waitFor(() => a.connection === 'live' && b.connection === 'live', "both handles 'live'");
      const beforeA = a.subscriptionId;

      db.liveStreamManager(RECONNECT_CONN).debugCloseSocket();
      await waitFor(
        () => events.some((e) => e.event === 'resubscribed' && e.reason === 'reconnect'),
        'handle A resubscribed after the kill',
      );
      await waitFor(() => a.connection === 'live' && b.connection === 'live', 'both handles live again');
      assert(a.subscriptionId !== beforeA, 'reconnect is a fresh subscription, not a resume');

      // Convergence across all lanes on the reconnected socket: durable write
      // reaches both handles; a fresh overlay (the consumer-driven recovery
      // path an adapter runs on needsResync) sees new presence.
      await writer.mutate('createTodo', { args: { title: 'post-kill durable' }, userId: ADA });
      await waitFor(() => a.rows.some((r) => r.title === 'post-kill durable') && b.rows.some((r) => r.title === 'post-kill durable'), 'durable lanes converged');

      const overlay = await db.subscribeEphemeral(cursorRef, { connectionId: RECONNECT_CONN, scope, userId: ADA, permissions });
      try {
        await writer.publishEphemeral(cursorRef, {
          connectionId: 'mux_publisher',
          scope,
          userId: ADA,
          permissions,
          value: { x: 1, y: 2 },
        });
        await waitFor(() => overlay.currentEntries().length >= 1, 'ephemeral lane converged on the reconnected socket');
      } finally {
        overlay.dispose();
      }
      return { resubscribed: events.filter((e) => e.event === 'resubscribed').length };
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('regression harness crashed:', error);
  await server.stop();
  process.exit(2);
}
