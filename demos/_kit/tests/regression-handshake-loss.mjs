// Regression: a handshake-window socket death must not strand the handle
// fake-healthy (ENG-23428).
//
// The server registers the live_stream task at upgrade completion, BEFORE any
// frame (src/server.rs), and any termination runs teardown -> disconnect,
// destroying the connection's durable subscriptions and outbox. So a retry
// socket that completes the upgrade server-side but dies before the client
// ever observes 'open' (stalled 101 behind a proxy, connect-budget
// force-close) destroys a subscription the client still believes is healthy.
// Pre-fix the manager was silent on retry losses (wasOpen false, attempts>0)
// and the handle gated needsResubscribe on detail.wasOpen ("a socket that
// never opened dropped nothing") — the handle kept draining a permanently
// empty outbox reporting 'polling', and a later successful open promoted
// straight to 'live' with no server-side subscription: permanent silent
// staleness reported as live. Post-fix: the manager emits 'lost' on every
// death of a constructed socket, and the handle treats every loss as
// requiring a fresh subscribe (redundant subscribes are safe — each
// supersedes its own predecessor).
//
// Deterministic stand-in for the stalled-101 timing: a patched global
// WebSocket that connects for real (so the server registers the stream task)
// but never delivers 'open' to the manager, then closes right after the real
// open — the server saw a completed upgrade + death; the client saw a socket
// that "never opened".
//
// Run: node demos/_kit/tests/regression-handshake-loss.mjs

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

// --- controllable WebSocket: 'real' | 'fail-construct' | 'handshake-death' ---
const RealWebSocket = globalThis.WebSocket;
let wsMode = 'real';
let ghostDeaths = 0; // sockets that completed the upgrade but died pre-'open'

// Connects for real (the server registers the stream task on upgrade
// completion) but suppresses the client-visible 'open', then closes shortly
// after the real open — the handshake-window death, made deterministic.
class GhostSocket {
  constructor(url, protocols) {
    this.real = new RealWebSocket(url, protocols);
    this.real.addEventListener('open', () => {
      setTimeout(() => {
        try {
          this.real.close();
        } finally {
          ghostDeaths += 1;
        }
      }, 30);
    }, { once: true });
  }

  addEventListener(type, listener, options) {
    if (type === 'open') return; // the client never observes 'open'
    this.real.addEventListener(type, listener, options);
  }

  close() {
    this.real.close();
  }

  send() {
    throw new Error('ghost socket: send before open');
  }
}

globalThis.WebSocket = function PatchedWebSocket(url, protocols) {
  if (wsMode === 'fail-construct') throw new Error('simulated blocked WebSocket constructor');
  if (wsMode === 'handshake-death') return new GhostSocket(url, protocols);
  return new RealWebSocket(url, protocols);
};

const server = await startServer({ port: 4437, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
const suite = createSuite('_kit regression / handshake-window loss (ENG-23428)');
const ADA = 'user_ada';
const CONN = 'handshake_loss_conn';

const waitFor = async (predicate, label, timeoutMs = 8_000) => {
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

  const events = [];
  const managerStates = [];
  const handle = await db.liveQuery('listTodos', {
    connectionId: CONN,
    userId: ADA,
    transport: 'stream',
    pollCadenceMs: 200,
    stream: { heartbeatIntervalMs: 200, freshnessBudgetMs: 800, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 300 },
    onSubscriptionEvent: (e) => events.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });
  const offState = db
    .liveStreamManager(CONN)
    .onState((state, detail = {}) => managerStates.push({ state, wasOpen: detail.wasOpen }));

  try {
    await waitFor(() => handle.connection === 'live', "initial 'live'");

    // 1. Poll-fallback with a healthy re-created subscription: kill the open
    //    socket while the constructor is blocked, and let the loss path land
    //    its fresh subscribe over HTTP.
    const resubscribesBefore = () => events.filter((e) => e.startsWith('resubscribed')).length;
    wsMode = 'fail-construct';
    db.liveStreamManager(CONN).debugCloseSocket();
    await waitFor(
      () => handle.connection === 'polling' && resubscribesBefore() >= 1,
      'poll fallback with a landed fresh subscribe',
    );

    await suite.check('a handshake-window socket death is heard and re-subscribed', async () => {
      // 2. The next retry completes the upgrade server-side but dies before
      //    the client ever sees 'open' — the server-side disconnect destroys
      //    the healthy subscription and the outbox.
      const eventsBeforeGhost = resubscribesBefore();
      const lossesBeforeGhost = managerStates.filter((s) => s.state === 'lost').length;
      wsMode = 'handshake-death';
      await waitFor(() => ghostDeaths >= 1, 'a ghost socket to register and die');
      wsMode = 'fail-construct'; // hold the socket down; recovery must not depend on a reopen

      // The manager must report the loss (pre-fix: silent, wasOpen false +
      // attempts > 0), and the handle must land a fresh subscribe from the
      // fallback path alone.
      await waitFor(
        () => managerStates.filter((s) => s.state === 'lost').length > lossesBeforeGhost,
        "a 'lost' emission for the handshake-window death",
      );
      await waitFor(() => resubscribesBefore() > eventsBeforeGhost, 'a fresh subscribe after the ghost death');
      const ghostLoss = managerStates.filter((s) => s.state === 'lost').at(-1);
      assert(ghostLoss.wasOpen === false, `ghost loss must report wasOpen:false, got ${JSON.stringify(ghostLoss)}`);
      return { ghostDeaths, managerStates, events };
    });

    await suite.check('a later successful open is genuinely live (updates flow)', async () => {
      // 3. Let the socket reopen for real; then a server-authored write must
      //    reach the handle. Pre-fix this is the permanent-staleness state:
      //    'live' with no server-side subscription, rows frozen forever.
      wsMode = 'real';
      await waitFor(() => handle.connection === 'live', "recovery to 'live'");
      const other = new SnapbackClient(server.baseUrl, server.clientOptions);
      await other.mutate('createTodo', { args: { title: 'after handshake loss' }, userId: ADA });
      await waitFor(
        () => handle.rows.some((r) => r.title === 'after handshake loss'),
        'post-recovery delivery',
      );
      return { connection: handle.connection, rows: handle.rows.length };
    });
  } finally {
    offState();
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
} finally {
  globalThis.WebSocket = RealWebSocket;
}
