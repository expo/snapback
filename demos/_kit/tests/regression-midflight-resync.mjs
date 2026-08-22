// Regression: a resync_required that arrives while another resubscribe is
// already in flight must not be silently swallowed (ENG-23429).
//
// The server's overflow signal is one-shot per episode: OutboundQueue's
// overflow flag is sticky, pushes are dropped while overflowed, and the flag
// resets only on drain (src/ephemeral.rs) — so deltas enqueued between a
// fresh subscription's snapshot and the sentinel-consuming drain have the
// consumed sentinel as their ONLY signal. Pre-fix, resubscribe() early-
// returned when `resubscribing` was true, before recording anything, and the
// in-flight subscribeFresh then cleared needsResubscribe when its POST
// resolved — every re-entry path (retry scheduler, drain tick) was gated on
// the now-cleared flag, and the demand was gone. For a live_delta
// subscription the rows diverge PERMANENTLY while the handle reports healthy
// (subsequent deltas apply cleanly on top of the stale membership).
// Post-fix: a demand that lands mid-flight bumps a demand epoch; the
// in-flight subscribe no longer clears the need, and the resubscribe run
// loops for another fresh subscribe once its POST resolves.
//
// Deterministic stand-in for the race: subscribe_live responses are held
// client-side (the server has already taken the snapshot), a commit lands
// while the response is held, and the second overflow sentinel is injected
// through the connection's durable lane registry — the same choke point
// drains and socket frames use. The handle never polls, mirroring the
// server-side drop: recovery may come ONLY from a follow-up fresh snapshot.
//
// Run: node demos/_kit/tests/regression-midflight-resync.mjs

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

const server = await startServer({ port: 4438, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / mid-flight resync demand (ENG-23429)', { expectedChecks: 4 });
const ADA = 'user_ada';
const CONN = 'midflight_conn';
// The wire shape the server emits on outbox overflow (src/ephemeral.rs:733).
const OVERFLOW_SENTINEL = { kind: 'resync_required', reason: 'outbox_overflow' };

const waitFor = async (predicate, label, timeoutMs = 6_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
};

try {
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  // Instrument subscribe_live: every call goes to the real server (the
  // snapshot is taken server-side before the hold), but while `holdResponse`
  // is set the resolved response is withheld from the kit — the "subscribe
  // POST in flight" window, made deterministic.
  const realSubscribe = SnapbackClient.prototype.subscribeLive;
  const subscribeCalls = [];
  let holdResponse = null;
  db.subscribeLive = async function (...args) {
    const call = { snapshotReady: false };
    subscribeCalls.push(call);
    const sub = await realSubscribe.apply(this, args);
    call.snapshotReady = true;
    if (holdResponse) await holdResponse;
    return sub;
  };

  const events = [];
  const handle = await db.liveQuery('listTodos', {
    connectionId: CONN,
    userId: ADA,
    transport: 'poll',
    onSubscriptionEvent: (e) => events.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });

  // Deliver an update through the connection's durable lane registry — the
  // same registered-consumer choke point HTTP drains and socket frames route
  // through (registerDurableConsumer), so the handle sees exactly what a
  // drained sentinel envelope would deliver.
  const deliverDurable = (update) => {
    for (const consumer of [...db.__laneConsumers.get(CONN).durable]) consumer(update);
  };

  try {
    await suite.check('baseline: an in-band overflow sentinel triggers one fresh subscribe', async () => {
      const callsBefore = subscribeCalls.length;
      deliverDurable(OVERFLOW_SENTINEL);
      await waitFor(
        () => subscribeCalls.length === callsBefore + 1 && events.includes('resubscribed:overflow'),
        'single resubscribe from an idle sentinel',
      );
      return { subscribeCalls: subscribeCalls.length, events: [...events] };
    });

    await suite.check('a scoped resync fences its predecessor and lands exactly one authoritative successor', async () => {
      const callsBefore = subscribeCalls.length;
      const resubscribeEventsBefore = events.filter((event) => event.startsWith('resubscribed')).length;
      const predecessorSubscriptionId = handle.subscriptionId;
      const predecessorVersion = handle.version;
      const predecessorRows = structuredClone(handle.rows);
      let release;
      holdResponse = new Promise((resolve) => { release = resolve; });

      try {
        deliverDurable({
          ...OVERFLOW_SENTINEL,
          subscription_id: predecessorSubscriptionId,
          reason: 'watch_reload',
        });
        assert(handle.connection === 'stale', `expected projected stale transition, got '${handle.connection}'`);
        assert(handle.freshness === 'retained', `expected retained predecessor, got '${handle.freshness}'`);
        await waitFor(
          () => subscribeCalls.length === callsBefore + 1 && subscribeCalls[callsBefore].snapshotReady,
          'scoped successor snapshot held before installation',
        );

        // This is a correctly addressed but late predecessor frame. Its high
        // version makes accidental application unmistakable even though the
        // authoritative successor snapshot will later repair the rows.
        deliverDurable({
          kind: 'live_replace',
          function: 'listTodos',
          subscription_id: predecessorSubscriptionId,
          version: predecessorVersion + 10_000,
          rows: [{ _id: 'late_predecessor', title: 'late predecessor authority' }],
        });
        assert(handle.version === predecessorVersion, 'late predecessor advanced the public version');
        assert(
          JSON.stringify(handle.rows) === JSON.stringify(predecessorRows),
          'late predecessor changed the retained public rows',
        );

        // Duplicate transition evidence for the already-fenced predecessor
        // is coalesced into the in-flight successor, never a second snapshot.
        deliverDurable({
          ...OVERFLOW_SENTINEL,
          subscription_id: predecessorSubscriptionId,
          reason: 'watch_reload',
        });
      } finally {
        holdResponse = null;
        release();
      }

      await waitFor(
        () => handle.subscriptionId !== predecessorSubscriptionId
          && handle.connection === 'polling'
          && handle.freshness === 'current',
        'one authoritative successor installation',
      );
      await sleep(150);
      assert(
        subscribeCalls.length === callsBefore + 1,
        `scoped resync created ${subscribeCalls.length - callsBefore} successors instead of one`,
      );
      const resubscribeEventsAfter = events.filter((event) => event.startsWith('resubscribed')).length;
      assert(
        resubscribeEventsAfter === resubscribeEventsBefore + 1,
        `scoped resync emitted ${resubscribeEventsAfter - resubscribeEventsBefore} successor receipts instead of one`,
      );
      return {
        predecessorSubscriptionId,
        successorSubscriptionId: handle.subscriptionId,
        successorSnapshots: 1,
        latePredecessorFramesApplied: 0,
      };
    });

    await suite.check('a sentinel consumed mid-resubscribe still forces a follow-up fresh subscribe', async () => {
      const callsBefore = subscribeCalls.length;
      let release;
      holdResponse = new Promise((r) => { release = r; });

      // Overflow #1: resubscribe R1 starts; the server takes its snapshot,
      // and the response is held in flight.
      deliverDurable(OVERFLOW_SENTINEL);
      await waitFor(
        () => subscribeCalls.length === callsBefore + 1 && subscribeCalls[callsBefore].snapshotReady,
        'R1 snapshot taken with response held',
      );

      // A commit lands AFTER R1's snapshot. The handle never polls, so —
      // like the deltas the sticky-overflow window drops server-side — this
      // row can only ever arrive via a fresh snapshot.
      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'dropped behind the sentinel' }, userId: ADA });

      // Overflow #2 reaches the handle while R1 is still in flight — the
      // one-shot sentinel the pre-fix code swallowed.
      deliverDurable(OVERFLOW_SENTINEL);

      // R1 lands with its stale snapshot; the recorded demand must loop a
      // follow-up fresh subscribe that carries the post-sentinel state.
      holdResponse = null;
      release();
      await waitFor(() => subscribeCalls.length >= callsBefore + 2, 'follow-up fresh subscribe after R1 landed');
      await waitFor(
        () => handle.rows.some((r) => r.title === 'dropped behind the sentinel'),
        'post-sentinel commit recovered by the follow-up snapshot (no drain ran)',
      );
      const resubscribes = events.filter((e) => e.startsWith('resubscribed')).length;
      assert(resubscribes >= 2, `expected a resubscribed receipt per landed subscribe, got ${resubscribes}`);
      return { subscribeCalls: subscribeCalls.length, events: [...events] };
    });

    await suite.check('the demand loop settles: no runaway resubscribes afterward', async () => {
      const settled = subscribeCalls.length;
      await sleep(400);
      assert(
        subscribeCalls.length === settled,
        `subscribe count kept growing after the demand was satisfied: ${settled} -> ${subscribeCalls.length}`,
      );
      assert(handle.connection === 'polling', `expected 'polling', got '${handle.connection}'`);
      return { subscribeCalls: subscribeCalls.length, connection: handle.connection };
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
