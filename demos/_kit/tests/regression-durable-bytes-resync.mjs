// Regression: a durable_bytes socket frame must force a connection-wide
// resync instead of being ignored
// (issues/closed/20260724-durable-bytes-silent-staleness.md; LLP 0093 D3
// fact 2b, found by the 0093 super-refine Round-6 Codex review).
//
// DurableBytes is the server's never-drop-silently fallback for a durable
// payload that failed UTF-8 decoding (src/live_wire.rs), and the payload's
// outbox lease is already released at the WebSocket handoff — so the update
// is gone, no drain will re-deliver it while the socket owns the outbox, and
// the raw bytes cannot identify the affected subscription. Pre-fix the kit
// knowingly ignored the frame: a live handle stayed healthy-looking while
// permanently stale. Post-fix, #dispatch routes the frame through
// dispatchDurableBytesFrame, which (a) hands the raw frame to external
// onDurable listeners and (b) synthesizes the same connection-wide
// clear-retained resync_required sentinel the server emits for outbox
// poison into the durable lane registry.
//
// The server cannot be induced to emit durable_bytes through real flows
// (durable payloads are serialized JSON, always valid UTF-8), so — like
// regression-midflight-resync.mjs's registry-injected overflow sentinel —
// this harness tests three sections deterministically: (1) the dispatch
// transformation as a unit (the exported production function against a
// stream-shaped fixture); (2) sentinel-driven recovery through the REAL
// lane registry of a live handle against a real server; and (3) the
// #dispatch WIRING itself — a durable_bytes frame injected at the stream
// manager's debugInjectFrame seam (the real receive path: authority-fence
// commit into #dispatch) must surface the poison sentinel, carrying the
// propagated authority capture, in the lane registry
// (issues/closed/20260725-durable-bytes-dispatch-test-seam.md; LLP 0093
// Round-7 Fable Concern 1).
//
// Run: node demos/_kit/tests/regression-durable-bytes-resync.mjs

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

const {
  SnapbackClient,
  LIVE_DURABLE_KINDS,
  LIVE_SOCKET_KINDS,
  DURABLE_BYTES_RESYNC_REASON,
  durableBytesResyncSentinel,
  dispatchDurableBytesFrame,
} = await import(join(repoRoot, 'demos/_kit/client.mjs'));

const server = await startServer({ port: 4439, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / durable_bytes forced resync', { expectedChecks: 4 });
const ADA = 'user_ada';
const CONN = 'durable_bytes_conn';

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

  await suite.check('dispatchDurableBytesFrame: raw frame to listeners, poison sentinel to the registry', async () => {
    const rawFrames = [];
    const durableLane = [];
    const ephemeralLane = [];
    const capture = { fence: 'test-capture' };
    const laneConsumers = new Map([[CONN, {
      durable: [(f) => durableLane.push(f)],
      ephemeral: [(f) => ephemeralLane.push(f)],
    }]]);
    const streamShaped = {
      durableListeners: [(f) => rawFrames.push(f)],
      connectionId: CONN,
      authorityCapture: capture,
      client: { __laneConsumers: laneConsumers },
    };
    const frame = { kind: LIVE_SOCKET_KINDS.DURABLE_BYTES, payload: [0xff, 0xfe] };
    dispatchDurableBytesFrame(streamShaped, frame);

    assert(rawFrames.length === 1 && rawFrames[0] === frame, 'external listener receives the raw frame');
    assert(durableLane.length === 1, 'registry durable lane receives exactly one synthetic frame');
    const sentinel = durableLane[0];
    assert(sentinel.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED, 'sentinel is resync_required');
    assert(sentinel.reason === DURABLE_BYTES_RESYNC_REASON, 'sentinel carries the durable_bytes reason');
    assert(sentinel.clear_retained === true, 'sentinel clears retained state');
    assert(sentinel.subscription_id == null && sentinel.subscriptionId == null,
      'sentinel is connection-wide (no subscription id)');
    // Connection-wide clear-retained frames cross the lane boundary so
    // in-memory ephemeral overlays blank too (routeDurableLaneFrame).
    assert(ephemeralLane.length === 1 && ephemeralLane[0] === sentinel,
      'the SAME sentinel object crosses to the ephemeral lane');
    return { sentinel: { ...sentinel } };
  });

  const events = [];
  const handle = await db.liveQuery('listTodos', {
    connectionId: CONN,
    userId: ADA,
    transport: 'poll',
    onSubscriptionEvent: (e) => events.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });

  try {
    await suite.check('the sentinel drives a stale handle back to fresh rows via snapshot-with-subscribe', async () => {
      // A commit the handle never sees in-band: transport 'poll' with no
      // drain running here, mirroring the socket-path loss where the lost
      // envelope's lease is already released.
      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'lost behind durable_bytes' }, userId: ADA });
      assert(!handle.rows.some((r) => r.title === 'lost behind durable_bytes'),
        'precondition: the commit has not reached the stale handle');

      // Deliver the production sentinel through the connection's durable
      // lane registry — the same choke point socket dispatch routes the
      // synthetic frame through.
      for (const consumer of [...db.__laneConsumers.get(CONN).durable]) {
        consumer(durableBytesResyncSentinel());
      }
      await waitFor(
        () => handle.rows.some((r) => r.title === 'lost behind durable_bytes'),
        'fresh snapshot-with-subscribe recovering the lost commit',
      );
      assert(events.some((e) => e.startsWith('resubscribed')), `expected a resubscribed event, got ${events}`);
      return { events: [...events], rows: handle.rows.length };
    });

    await suite.check('recovery settles: no runaway resubscribes afterward', async () => {
      const settled = events.filter((e) => e.startsWith('resubscribed')).length;
      await sleep(400);
      const after = events.filter((e) => e.startsWith('resubscribed')).length;
      assert(after === settled, `resubscribes kept growing after recovery: ${settled} -> ${after}`);
      return { resubscribes: after };
    });
  } finally {
    handle.dispose();
  }

  // Section 3 — the dispatch WIRING (Round-7 Fable Concern 1): sections 1-2
  // both enter BELOW the four-line #dispatch interception, so a refactor
  // that reordered #dispatch's branches or dropped the interception would
  // pass them while the silent-staleness defect returned. Injecting at the
  // debugInjectFrame seam drives the frame through the real receive path
  // (authority-fence commit → #dispatch → dispatchDurableBytesFrame).
  await suite.check('dispatch wiring: durable_bytes at the socket seam surfaces the sentinel in the registry', async () => {
    const SEAM_CONN = 'durable_bytes_seam_conn';
    const seamEvents = [];
    const seen = [];
    const seamHandle = await db.liveQuery('listTodos', {
      connectionId: SEAM_CONN,
      userId: ADA,
      transport: 'stream',
      fallbackToPoll: false,
      onSubscriptionEvent: (e) => seamEvents.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
    });
    try {
      const stream = db.liveStreamManager(SEAM_CONN);
      await waitFor(() => stream.open, 'live socket open for the seam connection');
      const unregister = db.registerDurableConsumer(SEAM_CONN, (f) => seen.push(f));
      // The dev arm runs without an authority fence, so a synthetic capture
      // rides the real markAuthorityCapture path and proves the propagation
      // assertion end to end instead of vacuously comparing null to null.
      const priorCapture = stream.authorityCapture;
      const capture = { fence: 'seam-capture' };
      stream.authorityCapture = capture;
      try {
        await stream.debugInjectFrame({ kind: LIVE_SOCKET_KINDS.DURABLE_BYTES, payload: [0xff] });
      } finally {
        stream.authorityCapture = priorCapture;
        unregister();
      }
      // The registered consumer also hears the handle's own subscription
      // traffic; the wiring claim is about the synthesized sentinel.
      const sentinels = seen.filter((f) => f.reason === DURABLE_BYTES_RESYNC_REASON);
      assert(sentinels.length === 1, `expected exactly one poison sentinel at the registry, got ${sentinels.length}`);
      const sentinel = sentinels[0];
      assert(sentinel.kind === LIVE_DURABLE_KINDS.RESYNC_REQUIRED, 'seam sentinel is resync_required');
      assert(sentinel.clear_retained === true, 'seam sentinel clears retained state');
      assert(sentinel.subscription_id == null && sentinel.subscriptionId == null,
        'seam sentinel is connection-wide');
      assert(db.authorityCaptureFor(sentinel) === capture,
        'the sentinel carries the propagated stream authority capture');
      await waitFor(
        () => seamEvents.some((e) => e.startsWith('resubscribed')),
        'seam-driven resubscribe through the real registry consumer',
      );
      return { events: [...seamEvents], registryFrames: seen.length };
    } finally {
      seamHandle.dispose();
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
