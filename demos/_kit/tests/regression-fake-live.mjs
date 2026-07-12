// Regression: a failed re-subscribe must never be swallowed or promoted to
// 'live' (LLP 0034 review fix 2).
//
// Scenario: the socket reopens but subscribe_live fails transiently (a server
// mid-restart returning errors for a moment). Pre-fix, resubscribe() swallowed
// the error and the open handler promoted the connection to 'live' anyway —
// with pongs keeping the freshness budget happy, the handle claimed 'live'
// forever while receiving nothing. Post-fix: promotion happens only after a
// successful fresh subscribe; failures surface on onConnectionChange and are
// retried (backoff loop + every fallback drain tick) until they land.
//
// Run: node demos/_kit/tests/regression-fake-live.mjs
//
// Derived from the review probe (scratchpad probe-fake-live.mjs, which exited
// 1 while the bug was present); assertions inverted to pin the fix.

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

const server = await startServer({ port: 4417, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / fake-live (LLP 0034 review fix 2)');
const ADA = 'user_ada';

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

  const transitions = [];
  const errors = [];
  const events = [];
  const handle = await db.liveQuery('listTodos', {
    connectionId: 'fake_live_conn',
    userId: ADA,
    transport: 'stream',
    pollCadenceMs: 200,
    stream: { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 400 },
    onConnectionChange: (next, detail) => {
      transitions.push(next);
      if (detail.error) errors.push(String(detail.error.message ?? detail.error));
    },
    onSubscriptionEvent: (e) => events.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });

  try {
    await waitFor(() => handle.connection === 'live', "initial 'live'");

    await suite.check('a transient subscribe outage cannot produce a fake live', async () => {
      // subscribe_live fails for 900ms (covers the on-open retry AND the
      // post-loss fallback retry), then heals — a brief server hiccup.
      const realSubscribe = SnapbackClient.prototype.subscribeLive;
      const failUntil = Date.now() + 900;
      db.subscribeLive = async function (...args) {
        if (Date.now() < failUntil) {
          throw new Error('SNAPBACK_TRANSIENT: simulated 500 during reconnect window');
        }
        return realSubscribe.apply(this, args);
      };
      db.liveStreamManager('fake_live_conn').debugCloseSocket();

      // Once the loss is DETECTED, the handle must never claim 'live' again
      // until a fresh subscribe actually lands (the socket itself reopens
      // quickly, but the subscription does not).
      await waitFor(() => handle.connection !== 'live', 'loss detection');
      const outageClaims = new Set();
      while (Date.now() < failUntil) {
        outageClaims.add(handle.connection);
        await sleep(40);
      }
      assert(!outageClaims.has('live'), `claimed 'live' during the subscribe outage: ${[...outageClaims]}`);
      assert(errors.length > 0, 'resubscribe failures must surface on onConnectionChange, not be swallowed');

      // After the outage heals, the retry loop lands the fresh subscribe and
      // only then promotes to 'live'.
      await waitFor(
        () => events.some((e) => e.startsWith('resubscribed')) && handle.connection === 'live',
        "recovery to genuine 'live'",
      );
      return { outageClaims: [...outageClaims], surfacedFailures: errors.length, events };
    });

    await suite.check('server-authored writes arrive after recovery (nothing is silently lost)', async () => {
      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'missed forever?' }, userId: ADA });
      await waitFor(() => handle.rows.some((r) => r.title === 'missed forever?'), 'post-recovery delivery');
      return { rows: handle.rows.length, connection: handle.connection };
    });
  } finally {
    handle.dispose();
  }

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
