// Kit client error-path regression suite (no server required).
//
// Exercises the HTTP and live-stream failure seams of the shared bridge with a
// stubbed fetch/WebSocket, so the checks run with plain `node` and no Snapback
// server, Chrome, or Exact checkout.
//
// @ref LLP 0032#confirmed-defect-register — pins S5.D3 (non-JSON bodies become
//   structured diagnostics, never bare SyntaxErrors) and S5.D7 (a closed stream
//   latches, so nextUpdate() after close rejects instead of hanging).

import { SnapbackClient } from '../client.mjs';
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
    const db = new SnapbackClient('http://stub');
    const stream = db.openLiveStream('conn_close_latch');
    const ws = FakeWebSocket.instances.at(-1);
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
    const db = new SnapbackClient('http://stub');
    const stream = db.openLiveStream('conn_update_then_close');
    const ws = FakeWebSocket.instances.at(-1);
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
    const db = new SnapbackClient('http://stub');
    const stream = db.openLiveStream('conn_first_failure');
    const ws = FakeWebSocket.instances.at(-1);
    const pending = stream.nextUpdate(1_000);
    ws.dispatch('message', { data: '{not json' });
    const first = await assertThrows(() => pending, undefined, 'expected parse failure');
    ws.dispatch('close', {});
    const later = await assertThrows(() => stream.nextUpdate(50), undefined, 'expected latched rejection');
    assertEqual(later.message, first.message, 'post-close rejection carries the original failure');
    return { message: later.message };
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
