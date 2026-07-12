// Regression: two legitimate identical subscribers must both keep advancing
// (ENG-22478 review fix A — explicit supersession, never inferred).
//
// The D2 branch briefly inferred supersession from (connection, function,
// args, principal): the second of two components sharing a query on one
// connection disposed the first's subscription server-side, and the first
// froze at old rows WHILE REPORTING 'live' (the heartbeat is
// connection-level). Supersession is now explicit — the kit names its own
// predecessor on resubscribe paths only — so plain duplicates coexist.
//
// Run: node demos/_kit/tests/regression-gc-starvation.mjs
//
// Derived from the review probe (scratchpad probe-gc-starvation.mjs, which
// exited 1 while the bug was present); assertions inverted to pin the fix.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { assert, createSuite } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));

const server = await startServer({ port: 4419, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / gc-starvation (ENG-22478 review fix A)');
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
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  await suite.check('two identical handles on one connection both keep advancing', async () => {
    // Component A and component B: same connection, same query+args+user.
    const a = await db.liveQuery('listTodos', { connectionId: 'shared_conn', userId: ADA, transport: 'stream', stream: FAST });
    const b = await db.liveQuery('listTodos', { connectionId: 'shared_conn', userId: ADA, transport: 'stream', stream: FAST });
    try {
      assert(a.subscriptionId !== b.subscriptionId, 'distinct subscriptions');
      await waitFor(() => a.connection === 'live' && b.connection === 'live', "both handles 'live'");

      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'update after B subscribed' }, userId: ADA });
      await waitFor(
        () => a.rows.some((r) => r.title === 'update after B subscribed'),
        'handle A receives the update (was starved pre-fix)',
      );
      await waitFor(
        () => b.rows.some((r) => r.title === 'update after B subscribed'),
        'handle B receives the update',
      );

      // And again — no one-shot luck.
      await other.mutate('createTodo', { args: { title: 'second update' }, userId: ADA });
      await waitFor(() => a.rows.some((r) => r.title === 'second update'), 'handle A keeps advancing');
      await waitFor(() => b.rows.some((r) => r.title === 'second update'), 'handle B keeps advancing');
      return { a: a.rows.length, b: b.rows.length };
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  await suite.check("a handle's own resubscribe still supersedes its predecessor server-side", async () => {
    const recorder = { events: [] };
    const handle = await db.liveQuery('listTodos', {
      connectionId: 'supersede_conn',
      userId: ADA,
      transport: 'stream',
      stream: FAST,
      onSubscriptionEvent: (event) => recorder.events.push(event),
    });
    try {
      await waitFor(() => handle.connection === 'live', "handle 'live'");
      const before = handle.subscriptionId;
      db.liveStreamManager('supersede_conn').debugCloseSocket();
      await waitFor(
        () => recorder.events.some((e) => e.event === 'resubscribed' && e.reason === 'reconnect'),
        'resubscribed after loss',
      );
      assert(handle.subscriptionId !== before, 'fresh subscription id');
      // The predecessor must be DISPOSED server-side, by whichever path won
      // the race: the socket close's disconnect (receipted 'disconnected' in
      // the global ring — the connection ring died with the connection) or,
      // when the subscription survived into the fresh subscribe, the explicit
      // supersession (receipted 'superseded' on the connection ring). Either
      // way: no zombie fan-out.
      const all = await (await fetch(`${server.baseUrl}/_snapback/api/receipts`)).json();
      const disposedGlobally = all.global.some(
        (r) => r.event === 'disposed' && r.subscriptionId === before,
      );
      const disposedOnConnection = Object.values(all.connections ?? {}).some((ring) =>
        ring.some((r) => r.event === 'disposed' && r.reason === 'superseded' && r.subscriptionId === before),
      );
      assert(
        disposedGlobally || disposedOnConnection,
        `predecessor must be receipted disposed (either path): ${JSON.stringify({ global: all.global.length })}`,
      );
      return { before, after: handle.subscriptionId, disposedGlobally, disposedOnConnection };
    } finally {
      handle.dispose();
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
