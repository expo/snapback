// Regression: a late-dying old socket must not nuke the reconnected session
// (LLP 0034 review fix 1 — generation-guarded live_stream teardown).
//
// A reconnect reuses the connection id; with half-open TCP the OLD socket's
// task can die arbitrarily long after the NEW socket registered. Without the
// generation guard, the old task's teardown removed the new socket's delivery
// waker and destroyed the fresh subscriptions while the new socket kept
// answering pings — permanent silent staleness reported as 'live'.
//
// Deterministic stand-in for the half-open timing:
//   1. open socket A on connection X (registers waker A)
//   2. open socket B on connection X (register supersedes: waker B)
//   3. fresh subscribe_live S2 on X (the reconnect's re-subscribe)
//   4. close A late -> its teardown must be a generation-guarded no-op
//   5. mutate -> B must still receive S2's live_replace promptly
//
// Run: node demos/_kit/tests/regression-reconnect-nuke.mjs
//
// Derived from the review probe (scratchpad probe-reconnect-nuke.mjs, which
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

const server = await startServer({ port: 4416, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('_kit regression / reconnect-nuke (LLP 0034 review fix 1)');
const ADA = 'user_ada';
const X = 'race_conn';

const openSocket = (label) => {
  const ws = new WebSocket(`${server.baseUrl.replace(/^http/, 'ws')}/live/${X}/stream`);
  const frames = [];
  ws.addEventListener('message', async (e) => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    frames.push(JSON.parse(text));
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({ ws, frames, label }), { once: true });
    ws.addEventListener('error', () => reject(new Error(`${label} failed to open`)), { once: true });
  });
};

const waitFor = async (predicate, label, timeoutMs = 5_000) => {
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

  const A = await openSocket('A');
  const B = await openSocket('B'); // the reconnect: same connection id
  const s2 = await db.subscribeLive('listTodos', { connectionId: X, userId: ADA });

  await suite.check('the reconnected socket receives fan-out before the old task dies', async () => {
    await db.mutate('createTodo', { args: { title: 'sanity before nuke' }, userId: ADA });
    await waitFor(
      () => A.frames.concat(B.frames).some((f) => f.kind === 'live_replace' && f.subscription_id === s2.subscription_id),
      'pre-nuke live_replace',
    );
    return { subscription: s2.subscription_id.slice(0, 16) };
  });

  await suite.check('a late-dying old socket does not destroy the reconnected session', async () => {
    A.ws.close();
    await sleep(400); // let the server process the old task's teardown

    const before = B.frames.length;
    await db.mutate('createTodo', { args: { title: 'after old socket died' }, userId: ADA });
    await waitFor(
      () => B.frames.slice(before).some((f) => f.kind === 'live_replace' && f.subscription_id === s2.subscription_id),
      "B's live_replace after the old socket died (subscription must survive)",
    );

    // The waker must remain event-driven: a fresh subscribe + mutate delivers
    // well under the 30s safety net.
    const s3 = await db.subscribeLive('listTodos', { connectionId: X, userId: ADA });
    const before3 = B.frames.length;
    await db.mutate('createTodo', { args: { title: 'post-recovery write' }, userId: ADA });
    await waitFor(
      () => B.frames.slice(before3).some((f) => f.kind === 'live_replace' && f.subscription_id === s3.subscription_id),
      'event-driven delivery for a fresh subscription (waker intact)',
      3_000,
    );

    // And the socket still answers pings (it always did — the bug was that
    // this masked the destroyed state as healthy).
    B.ws.send(JSON.stringify({ type: 'ping', requestId: 'p1' }));
    await waitFor(() => B.frames.some((f) => f.kind === 'pong'), 'pong');
    return { frames: B.frames.length };
  });

  B.ws.close();
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
