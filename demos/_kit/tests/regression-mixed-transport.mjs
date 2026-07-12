// Regression: mixed transports on ONE connection — a poll-transport handle
// must not starve while a stream-transport handle's socket owns the outbox
// (ENG-22478 review: durable lane-registry unification).
//
// Pre-fix, durable socket frames reached only manager.onDurable listeners;
// the lane registry (where poll handles listen) saw nothing once the socket
// drained the outbox first. Durable socket frames now route through the same
// registry HTTP drains use — one delivery pipeline, no double delivery
// (stream handles no longer subscribe via onDurable).
//
// Run: node demos/_kit/tests/regression-mixed-transport.mjs
//
// Derived from the review probe (scratchpad probe-mixed-transport.mjs);
// assertions inverted to pin the fix.

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

const server = await startServer({ port: 4423, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / mixed-transport (ENG-22478 review)');
const ADA = 'user_ada';
const BOB = 'user_bob';
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

  await suite.check('a poll handle sharing a stream-owned connection keeps receiving', async () => {
    // P first (poll), then S (stream) — same connection; different users so
    // each subscription's rows are distinct.
    const updates = { p: 0, s: 0 };
    const p = await db.liveQuery('listTodos', {
      connectionId: 'mixed_t', userId: BOB, transport: 'poll',
      onUpdate: () => { updates.p += 1; },
    });
    const s = await db.liveQuery('listTodos', {
      connectionId: 'mixed_t', userId: ADA, transport: 'stream', stream: FAST,
      onUpdate: () => { updates.s += 1; },
    });
    try {
      await waitFor(() => s.connection === 'live', "stream handle 'live'");

      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'for bob' }, userId: BOB });
      await other.mutate('createTodo', { args: { title: 'for ada' }, userId: ADA });

      // The stream handle receives by push; the POLL handle's update was
      // drained by the socket server-side — the registry must still deliver
      // it (pre-fix, P starved here forever).
      await waitFor(() => s.rows.some((r) => r.title === 'for ada'), 'stream handle receives');
      await waitFor(
        () => p.rows.some((r) => r.title === 'for bob'),
        'poll handle receives despite the socket owning the outbox',
      );

      // No double delivery for the stream handle: exactly one live_replace
      // application per fan-out (its version guard would mask duplicates, so
      // count onUpdate invocations for the single mutation affecting it).
      const sBefore = updates.s;
      await other.mutate('createTodo', { args: { title: 'ada again' }, userId: ADA });
      await waitFor(() => s.rows.some((r) => r.title === 'ada again'), 'second stream delivery');
      await sleep(300); // allow any duplicate path to fire
      assert(
        updates.s - sBefore === 1,
        `stream handle must receive exactly one application per fan-out, got ${updates.s - sBefore}`,
      );
      return { pRows: p.rows.length, sRows: s.rows.length, updates };
    } finally {
      p.dispose();
      s.dispose();
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
