// Kit client error-path regression suite (no server required).
//
// Exercises the HTTP and live-stream failure seams of the shared bridge with a
// stubbed fetch/WebSocket, so the checks run with plain `node` and no Snapback
// server, Chrome, or Exact checkout.
//
// @ref LLP 0032#confirmed-defect-register — pins S5.D3 (non-JSON bodies become
//   structured diagnostics, never bare SyntaxErrors) and S5.D7 (a closed stream
//   latches, so nextUpdate() after close rejects instead of hanging).
//
// Also pins ENG-23391: the delivery choke points (drainConnection and the
// socket dispatch) isolate consumer exceptions and per-envelope decode
// failures, so one throwing app callback never discards the rest of a
// destructively drained batch or escapes as an unhandled rejection.

import { EphemeralOverlay, SnapbackClient } from '../client.mjs';
import { AdminClient } from '../../../packages/snapback-admin-client/index.mjs';
import { assert, assertEqual, assertThrows, createSuite } from '../harness.mjs';

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type, handler, options) {
    const list = this.listeners.get(type) ?? [];
    list.push({ handler, once: options?.once ?? false });
    this.listeners.set(type, list);
  }
  dispatch(type, event = {}) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((entry) => !entry.once));
    for (const entry of list) entry.handler(event);
  }
  send() {}
  close() {
    this.dispatch('close', {});
  }
}

const stubFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

// ENG-23442: openLiveStream resolves a connection grant before constructing
// the socket, so stream tests stub the grant response and await the async
// socket construction instead of grabbing it synchronously.
const grantFetch = (connectionId) => stubFetch(200, JSON.stringify({
  connectionId,
  connectionToken: 'sct_stub_token',
}));

const nextSocket = async (countBefore) => {
  for (let i = 0; i < 200; i += 1) {
    if (FakeWebSocket.instances.length > countBefore) return FakeWebSocket.instances.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('stub WebSocket was never constructed');
};

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
// Node's experimental localStorage global throws without a backing file; give
// the admin client the browser-shaped API its constructor probes for.
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null },
  configurable: true,
  writable: true,
});
const suite = createSuite('_kit client / error paths');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
};
const encodedValue = (value) => [...new TextEncoder().encode(JSON.stringify(value))];
const overlayRoom = { collection: 'presence', routing_key: '4:room=1:a' };
const snapshot = (scopeEpoch, entries = []) => ({
  Snapshot: {
    room: overlayRoom,
    scope_epoch: scopeEpoch,
    entries: entries.map(({ key, version, value }) => ({
      key,
      value: encodedValue(value),
      received_at_ms: 100 + version,
      expires_at_ms: 10_000,
      scope_epoch: scopeEpoch,
      entry_version: version,
    })),
  },
});

try {
  await suite.check('s5_d3: non-JSON 502 body throws structured SNAPBACK_HTTP_ERROR', async () => {
    globalThis.fetch = stubFetch(502, `<html><body>${'Bad Gateway '.repeat(50)}</body></html>`);
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'SNAPBACK_HTTP_ERROR', 'expected structured HTTP error');
    assertEqual(error.status, 502, 'status is carried on the error');
    assert(error.diagnostic.message.includes('HTTP 502'), `message names the status: ${error.diagnostic.message}`);
    assert(error.diagnostic.message.includes('Bad Gateway'), 'message carries a body snippet');
    assert(error.diagnostic.message.length < 300, 'body snippet is truncated');
    return { code: error.diagnostic.code, status: error.status };
  });

  await suite.check('s5_d3: 200 response with non-JSON body throws SNAPBACK_RESPONSE_NOT_JSON', async () => {
    globalThis.fetch = stubFetch(200, 'status: ok\nmode: yaml\n');
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'SNAPBACK_RESPONSE_NOT_JSON', 'expected structured parse error');
    assertEqual(error.status, 200, 'status is carried on the error');
    assert(error.diagnostic.message.includes('status: ok'), 'message carries a body snippet');
    return { code: error.diagnostic.code };
  });

  await suite.check('s5_d3: valid-JSON error responses still surface the server diagnostic unchanged', async () => {
    const diagnostic = { code: 'SNAPBACK_UNKNOWN_FUNCTION', message: 'no such function nope' };
    globalThis.fetch = stubFetch(400, JSON.stringify({ diagnostic }));
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.query('nope'), 'SNAPBACK_UNKNOWN_FUNCTION', 'expected server diagnostic passthrough');
    assertEqual(error.diagnostic, diagnostic, 'diagnostic object is the server payload');
    assertEqual(error.status, 400, 'status is carried on the error');
    return { code: error.diagnostic.code };
  });

  await suite.check('s5_d3: empty error body keeps the HTTP_<status> fallback', async () => {
    globalThis.fetch = stubFetch(500, '');
    const db = new SnapbackClient('http://stub');
    const error = await assertThrows(() => db.health(), 'HTTP_500', 'expected status-code fallback');
    return { code: error.diagnostic.code };
  });

  await suite.check('eng_24345: function route segments reject traversal and encoded separators', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const db = new SnapbackClient('http://stub', { adminToken: 'sbat_secret' });
    const invalid = [
      '.', '..', '../_snapback/api/app/reset', '%2e', '%2e%2e', 'x/y', 'x%2fy',
      'x%2Fy', 'x\\y', 'x%5cy', 'x?admin=1', 'x#fragment', '',
    ];
    const operations = {
      query: (name) => db.query(name),
      mutation: (name) => db.mutate(name),
      action: (name) => db.action(name),
      liveSubscribe: (name) => db.subscribeLive(name, { connectionId: 'conn_route_test' }),
      liveUnsubscribe: (name) => db.unsubscribeLive(name, {
        connectionId: 'conn_route_test',
        subscriptionId: 'sub_route_test',
      }),
    };
    for (const [operation, invoke] of Object.entries(operations)) {
      for (const name of invalid) {
        const error = await assertThrows(
          () => invoke(name),
          undefined,
          `expected ${operation} ${JSON.stringify(name)} to be rejected`,
        );
        assert(error instanceof TypeError, `expected TypeError for ${operation} ${JSON.stringify(name)}`);
      }
    }
    assertEqual(calls, 0, 'invalid names never reach fetch');
    return { operations: Object.keys(operations).length, rejected: invalid.length * Object.keys(operations).length };
  });

  await suite.check('eng_24345: admin credentials are scoped to system calls', async () => {
    const requests = [];
    globalThis.fetch = async (url, init = {}) => {
      requests.push({ url: String(url), headers: init.headers ?? {} });
      return { ok: true, status: 200, text: async () => '{}' };
    };
    const db = new SnapbackClient('http://stub', { adminToken: 'sbat_secret' });
    await db.query({ name: 'safe_name' });
    await db.reset();
    assertEqual(new URL(requests[0].url).pathname, '/query/safe_name', 'generated name stays one route segment');
    assert(!('x-snapback-admin-token' in requests[0].headers), 'data-plane request carries no admin credential');
    assertEqual(new URL(requests[1].url).pathname, '/_snapback/api/app/reset', 'reset uses the system route');
    assertEqual(requests[1].headers['x-snapback-admin-token'], 'sbat_secret', 'system request carries the admin credential');
    return { dataPath: new URL(requests[0].url).pathname, adminPath: new URL(requests[1].url).pathname };
  });

  await suite.check('s5_d3: admin client wraps non-JSON error bodies the same way', async () => {
    globalThis.fetch = stubFetch(502, '<html>proxy error</html>');
    const admin = new AdminClient('http://stub');
    const error = await assertThrows(() => admin.inspect(), 'SNAPBACK_HTTP_ERROR', 'expected structured HTTP error');
    assert(error.diagnostic.message.includes('proxy error'), 'message carries a body snippet');
    globalThis.fetch = stubFetch(200, 'not json');
    const parseError = await assertThrows(() => admin.inspect(), 'SNAPBACK_RESPONSE_NOT_JSON', 'expected structured parse error');
    return { errorCode: error.diagnostic.code, parseCode: parseError.diagnostic.code };
  });

  await suite.check('s5_d7: close with no pending waiters latches; later nextUpdate() rejects immediately', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_close_latch');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_close_latch');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    ws.dispatch('close', {}); // clean close, zero waiters pending
    const error = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected post-close rejection');
    assert(error.message.includes('Snapback live stream closed'), `expected stream-closed error, got: ${error.message}`);
    assert(!error.message.includes('timed out'), 'must reject via the latch, not the timeout');
    return { message: error.message };
  });

  await suite.check('s5_d7: updates before close still resolve; the close error follows', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_update_then_close');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_update_then_close');
    const ws = await nextSocket(before);
    const pending = stream.nextUpdate(1_000);
    ws.dispatch('message', { data: JSON.stringify({ subscription_id: 'sub_1', rows: [{ id: 1 }] }) });
    const update = await pending;
    assertEqual(update.subscription_id, 'sub_1', 'live update resolves the pending waiter');
    ws.dispatch('close', {});
    const error = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected post-close rejection');
    assert(error.message.includes('Snapback live stream closed'), `expected stream-closed error, got: ${error.message}`);
    return { rows: update.rows.length };
  });

  await suite.check('s5_d7: the first stream failure wins; a later close does not mask it', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_first_failure');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_first_failure');
    const ws = await nextSocket(before);
    const pending = stream.nextUpdate(1_000);
    ws.dispatch('message', { data: '{not json' });
    const first = await assertThrows(() => pending, undefined, 'expected parse failure');
    ws.dispatch('close', {});
    const later = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected latched rejection');
    assertEqual(later.message, first.message, 'post-close rejection carries the original failure');
    return { message: later.message };
  });

  await suite.check('eng_24372: a timed-out reader does not consume the next frame', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_timeout_frame');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_timeout_frame');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    const timedOut = await assertThrows(() => stream.nextUpdate(1), undefined, 'first reader should time out');
    assert(timedOut.message.includes('timed out'), `expected timeout, got ${timedOut.message}`);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 1 }) });
    const update = await stream.nextUpdate(50);
    assertEqual(update.sequence, 1, 'frame after timeout remains available to the next reader');
    ws.close();
    return { sequence: update.sequence };
  });

  await suite.check('eng_24372: one timed-out waiter does not starve later waiters', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_multiple_waiters');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_multiple_waiters');
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;
    const first = stream.nextUpdate(1);
    const second = stream.nextUpdate(100);
    await assertThrows(() => first, undefined, 'first waiter should time out');
    ws.dispatch('message', { data: JSON.stringify({ sequence: 2 }) });
    assertEqual((await second).sequence, 2, 'second live waiter receives the frame');
    ws.close();
    return { delivered: true };
  });

  await suite.check('eng_24372: a same-turn timeout/frame race delivers exactly once', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_timeout_frame_race');
    const scheduled = [];
    const cancelled = new Set();
    const clock = {
      setTimeout(callback) {
        const id = scheduled.length;
        scheduled.push(callback);
        return id;
      },
      clearTimeout(id) {
        cancelled.add(id);
      },
    };
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_timeout_frame_race', clock);
    const ws = await nextSocket(before);
    ws.dispatch('open', {});
    await stream.ready;

    // Frame wins: force the stale timeout callback in the same turn even
    // though delivery cancelled it. The active latch must make it a no-op,
    // and the next read must receive only the next frame (no duplicate).
    const frameWins = stream.nextUpdate(1);
    const frameWinsTimer = scheduled.at(-1);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 1 }) });
    await Promise.resolve(); // let the async message decoder claim the waiter
    frameWinsTimer();
    assertEqual((await frameWins).sequence, 1, 'frame winner receives the raced frame');
    const next = stream.nextUpdate(1);
    ws.dispatch('message', { data: JSON.stringify({ sequence: 2 }) });
    assertEqual((await next).sequence, 2, 'stale timeout did not duplicate the first frame');

    // Timeout wins: run the deadline callback, then deliver the frame in the
    // same turn. Removal from the waiter queue must leave the frame queued for
    // exactly one later reader.
    const timeoutWins = stream.nextUpdate(1);
    const timeoutWinsTimer = scheduled.at(-1);
    timeoutWinsTimer();
    ws.dispatch('message', { data: JSON.stringify({ sequence: 3 }) });
    await Promise.resolve(); // let the decoded frame enter the empty queue
    const timeoutError = await assertThrows(() => timeoutWins, undefined, 'timeout winner rejects');
    assert(timeoutError.message.includes('timed out'), `expected timeout, got ${timeoutError.message}`);
    assertEqual((await stream.nextUpdate(1)).sequence, 3, 'raced frame remains queued exactly once');
    assert(cancelled.size >= 2, 'settled readers cancel their scheduled callbacks');
    ws.close();
    return { frameWon: 1, timeoutWon: 1 };
  });

  await suite.check('eng_24372: close-before-open rejects readiness and pending reads', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('conn_close_before_open');
    const db = new SnapbackClient('http://stub');
    const before = FakeWebSocket.instances.length;
    const stream = db.openLiveStream('conn_close_before_open');
    const ws = await nextSocket(before);
    const pendingRead = stream.nextUpdate(1_000);
    ws.dispatch('close', {});
    const readyError = await assertThrows(() => stream.ready, undefined, 'readiness should reject on close');
    const readError = await assertThrows(() => pendingRead, undefined, 'pending read should reject on close');
    assert(readyError.message.includes('closed before opening'), `unexpected ready error: ${readyError.message}`);
    assert(readError.message.includes('closed'), `unexpected read error: ${readError.message}`);
    return { ready: readyError.message, read: readError.message };
  });

  await suite.check('eng_23391: a throwing consumer never discards the rest of a destructively drained batch', async () => {
    // The failure scenario from the issue: a fallback drain carrying
    // [update-for-A, an ephemeral envelope, update-for-B, resync_required]
    // where the app's first callback throws. The server has already dequeued
    // the batch, so everything behind the throw must still be delivered.
    const batch = [
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_a', rows: [], version: 1 }) } },
      { Ephemeral: { Upsert: { entry: { key: 'k', value: [], scope_epoch: 1, entry_version: 1 } } } },
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_b', rows: [], version: 1 }) } },
      { Durable: { payload: JSON.stringify({ kind: 'resync_required', reason: 'outbox_overflow' }) } },
    ];
    globalThis.fetch = stubFetch(200, JSON.stringify(batch));
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_drain_iso';
    const seenDurable = [];
    const seenEphemeral = [];
    // Throwing consumers registered FIRST, so isolation (not luck of
    // iteration order) is what protects the recording consumers.
    db.registerDurableConsumer(conn, () => {
      throw new Error('app render error');
    });
    db.registerDurableConsumer(conn, (update) => seenDurable.push(update));
    db.registerEphemeralConsumer(conn, () => {
      throw new Error('overlay observer error');
    });
    db.registerEphemeralConsumer(conn, (env) => seenEphemeral.push(env));
    const result = await db.drainConnection(conn);
    assertEqual(result.durable.length, 3, 'all durable envelopes decoded despite the throw');
    assertEqual(result.ephemeral.length, 1, 'the ephemeral envelope is routed, not discarded');
    assertEqual(seenDurable.length, 3, 'the second durable consumer received every update');
    assertEqual(seenDurable.at(-1).kind, 'resync_required', 'the resync sentinel behind the throw was delivered');
    assertEqual(seenEphemeral.length, 1, 'the second ephemeral consumer received the envelope');
    assertEqual(result.decodeFailures.length, 0, 'consumer throws are not decode failures');
    return { durable: result.durable.length, ephemeral: result.ephemeral.length };
  });

  await suite.check('eng_23391: a malformed durable payload surfaces as a diagnostic, not an aborted batch', async () => {
    const batch = [
      { Durable: { payload: '{not json' } },
      { Durable: { payload: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_ok', rows: [], version: 2 }) } },
    ];
    globalThis.fetch = stubFetch(200, JSON.stringify(batch));
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_decode_iso';
    const seen = [];
    db.registerDurableConsumer(conn, (update) => seen.push(update));
    const result = await db.drainConnection(conn);
    assertEqual(result.decodeFailures.length, 1, 'the malformed envelope is reported');
    assertEqual(result.decodeFailures[0].code, 'SNAPBACK_ENVELOPE_DECODE_FAILED', 'stable diagnostic code');
    assertEqual(result.durable.length, 1, 'the envelope behind the malformed one still decodes');
    assertEqual(seen.length, 1, 'the consumer still receives the good update');
    assertEqual(seen[0].subscription_id, 'sub_ok', 'the delivered update is the one behind the failure');
    return { code: result.decodeFailures[0].code };
  });

  await suite.check('eng_23391: a throwing consumer on the socket path starves nobody and leaves no unhandled rejection', async () => {
    globalThis.WebSocket = FakeWebSocket;
    // ENG-23442: the manager resolves a connection grant before the socket.
    globalThis.fetch = grantFetch('conn_dispatch_iso');
    const db = new SnapbackClient('http://stub');
    const conn = 'conn_dispatch_iso';
    const rejections = [];
    const onRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    const before = FakeWebSocket.instances.length;
    const manager = db.liveStreamManager(conn);
    try {
      const seenListener = [];
      const seenDurable = [];
      const seenEphemeral = [];
      manager.onDurable(() => {
        throw new Error('durable listener error');
      });
      manager.onDurable((frame) => seenListener.push(frame));
      manager.onEphemeral(() => {
        throw new Error('ephemeral listener error');
      });
      db.registerDurableConsumer(conn, () => {
        throw new Error('app render error');
      });
      db.registerDurableConsumer(conn, (frame) => seenDurable.push(frame));
      db.registerEphemeralConsumer(conn, () => {
        throw new Error('overlay observer error');
      });
      db.registerEphemeralConsumer(conn, (env) => seenEphemeral.push(env));
      const ws = await nextSocket(before);
      ws.dispatch('open', {});
      ws.dispatch('message', { data: JSON.stringify({ kind: 'live_replace', subscription_id: 'sub_s', rows: [{ id: 1 }], version: 3 }) });
      ws.dispatch('message', { data: JSON.stringify({ kind: 'ephemeral', message: {} }) });
      // The message handler is async (websocketText); let delivery and any
      // would-be unhandled rejection surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEqual(seenListener.length, 1, 'the second durable listener received the frame');
      assertEqual(seenDurable.length, 1, 'the second durable consumer received the frame');
      assertEqual(seenEphemeral.length, 1, 'the second ephemeral consumer received the frame');
      assertEqual(rejections.length, 0, `no unhandled rejection escaped the message listener: ${rejections.map((r) => r?.message ?? r).join(', ')}`);
      return { frames: seenListener.length + seenDurable.length + seenEphemeral.length };
    } finally {
      manager.close();
      process.off('unhandledRejection', onRejection);
    }
  });

  await suite.check('eng_23392: dispose racing a resubscribe unsubscribes the late server subscription', async () => {
    const db = new SnapbackClient('http://stub');
    const unsubscribed = [];
    let subscribeCalls = 0;
    let resolveLateSubscribe;
    let lateSubscribeStarted = false;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        return { subscription_id: 'sub_initial', snapshot: { version: 1, rows: [] } };
      }
      lateSubscribeStarted = true;
      return new Promise((resolve) => {
        resolveLateSubscribe = () => resolve({ subscription_id: 'sub_late', snapshot: { version: 2, rows: [] } });
      });
    };
    db.unsubscribeLive = async (_ref, { subscriptionId }) => {
      unsubscribed.push(subscriptionId);
      return { ok: true };
    };

    const handle = await db.liveQuery('listTodos', { connectionId: 'dispose_race_conn' });
    const consumers = db.__laneConsumers.get('dispose_race_conn');
    for (const consumer of [...consumers.durable]) consumer({ kind: 'resync_required' });
    await waitFor(() => lateSubscribeStarted, 'resubscribe in flight');

    handle.dispose();
    resolveLateSubscribe();
    await waitFor(() => unsubscribed.includes('sub_late'), 'late subscription unsubscribe');
    assert(unsubscribed.includes('sub_initial'), 'dispose still unsubscribes the original subscription');
    return { unsubscribed };
  });

  await suite.check('eng_23393: a healthy fallback drain restores polling after a stale drain failure', async () => {
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = grantFetch('fallback_heals_conn');
    const db = new SnapbackClient('http://stub');
    let subscribeCalls = 0;
    let drainCalls = 0;
    const transitions = [];
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      return { subscription_id: `sub_${subscribeCalls}`, snapshot: { version: subscribeCalls, rows: [] } };
    };
    db.unsubscribeLive = async () => ({ ok: true });
    db.drainConnection = async () => {
      drainCalls += 1;
      if (drainCalls === 1) throw new Error('SNAPBACK_TRANSIENT_DRAIN_FAILURE');
      return { durable: [], ephemeral: [] };
    };

    const handle = await db.liveQuery('listTodos', {
      connectionId: 'fallback_heals_conn',
      transport: 'stream',
      pollCadenceMs: 20,
      stream: { heartbeatIntervalMs: 5_000, freshnessBudgetMs: 20_000, reconnectBaseDelayMs: 20_000, reconnectMaxDelayMs: 20_000 },
      onConnectionChange: (next) => transitions.push(next),
    });
    const ws = FakeWebSocket.instances.at(-1);
    ws.dispatch('open', {});
    await waitFor(() => handle.connection === 'live', 'initial live');
    ws.dispatch('close', {});
    await waitFor(() => handle.connection === 'stale', 'stale after failed fallback drain');
    await waitFor(() => handle.connection === 'polling', 'polling after healthy fallback drain');
    handle.dispose();
    return { drainCalls, transitions };
  });

  await suite.check('eng_23433: ephemeral snapshots are guarded by epoch and entry-version high-water', async () => {
    const client = {
      registerEphemeralConsumer: () => () => {},
      recordReceipt: () => {},
    };
    const overlay = new EphemeralOverlay(client, 'presence', {
      connectionId: 'overlay_epoch_conn',
      scope: { room: 'a' },
      userId: 'user_ada',
      permissions: [],
      snapshot: snapshot(2, [{ key: 'cursor_a', version: 5, value: { x: 5 } }]),
    });

    assertEqual(overlay.currentEntries({ prune: false }).map((entry) => entry.key), ['cursor_a'], 'initial snapshot applied');
    assertEqual(
      overlay.apply(snapshot(1, [{ key: 'cursor_old', version: 1, value: { x: 1 } }])),
      'ignored_stale',
      'older epoch snapshot ignored',
    );
    assertEqual(overlay.currentEntries({ prune: false }).map((entry) => entry.key), ['cursor_a'], 'older epoch did not clear entries');
    assertEqual(
      overlay.apply(snapshot(2, [{ key: 'cursor_a', version: 4, value: { x: 4 } }])),
      'ignored_stale',
      'same-epoch lower-version snapshot ignored',
    );
    assertEqual(overlay.currentEntries({ prune: false })[0].entryVersion, 5, 'same-epoch stale snapshot did not regress entry version');
    assertEqual(overlay.apply(snapshot(3, [])), 'applied', 'newer epoch snapshot is a resubscribe boundary');
    assertEqual(overlay.currentEntries({ prune: false }), [], 'newer epoch snapshot replaces the map');
    return { epoch: overlay.scopeEpoch };
  });
} finally {
  globalThis.fetch = originalFetch;
  if (originalWebSocket === undefined) delete globalThis.WebSocket;
  else globalThis.WebSocket = originalWebSocket;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
