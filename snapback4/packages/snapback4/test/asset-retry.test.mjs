import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.008.002.000#6 — retry only transfers that cannot consume a view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fetchAsset } from '../dist/assets.js';
import { assetQueue, assetRetryAt } from '../dist/asset-download.js';
const denied = (code, retryable = false, headers) => Response.json({ denied: { code, family: 'asset', message: code, retryable } }, { status: code === 'E_RATE_LIMIT' ? 503 : 416, headers });
const bytes = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png', 'accept-ranges': 'bytes' } });
const download = (send, ...rest) => fetchAsset('http://assets.invalid', {}, send, 'avatar', ...rest);
const reset = () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); };

for (const status of [408, 429, 500, 502, 503, 504]) test(`bare HTTP ${status} retries ordinary bytes without a refusal envelope`, async () => {
  let calls = 0;
  const read = await download(async () => ++calls === 1 ? new Response('proxy unavailable', { status }) : bytes());
  assert.ok('url' in read, JSON.stringify(read)); read.revoke(); assert.equal(calls, 2);
});

test('rotation during admission backoff returns the existing refusal instead of resetting custody', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let calls = 0, current = true;
  const reading = download(async () => { calls++; return denied('E_RATE_LIMIT', true, { 'Retry-After': '1' }); }, undefined, undefined, () => current);
  await new Promise(resolve => setImmediate(resolve)); current = false;
  t.mock.timers.tick(1500); await new Promise(resolve => setImmediate(resolve));
  const read = await reading;
  assert.equal(calls, 1); assert.equal(read.denied.code, 'E_RATE_LIMIT');
  assert.equal(assetRetryAt(read.denied), 101000);
});

for (const kind of ['reset', 'body reset', '503', 'timeout']) test(`ordinary ${kind} recovers with a non-consuming full-file Range`, { timeout: hangBudget(4) }, async t => {
  if (kind === 'timeout') t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let calls = 0; const times = [];
  const reading = download(async (_url, init) => {
    assert.equal(init.headers.range, 'bytes=0-'); times.push(Date.now());
    if (++calls > 1) return bytes();
    if (kind === 'reset') return reset();
    if (kind === '503') return denied('E_RATE_LIMIT', true, { 'Retry-After': '0.5' });
    if (kind === 'timeout') return new Promise(() => {}); // host ignores abort
    return new Response(new ReadableStream({ start(stream) { try { reset(); } catch (error) { stream.error(error); } } }));
  });
  if (kind === 'timeout') {
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(2_108_000); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(400); await new Promise(resolve => setImmediate(resolve));
  }
  const read = await reading;
  assert.ok('url' in read, JSON.stringify(read)); read.revoke(); assert.equal(calls, 2);
  assert.ok(times[1] - times[0] >= (kind === '503' ? 500 : kind === 'timeout' ? 5000 : 250));
});

test('exhaustion is bounded, retains its cause, and preserves long retry guidance', async () => {
  let calls = 0;
  const read = await download(async () => { calls++; return reset(); });
  assert.equal(calls, 4); assert.equal(read.denied.code, 'E_OFFLINE'); assert.equal(read.denied.retryable, true);
  assert.match(read.denied.message, /ECONNRESET/);
  calls = 0;
  const start = Date.now();
  const limited = await download(async () => { calls++; return denied('E_RATE_LIMIT', true, { 'Retry-After': '60' }); });
  assert.equal(calls, 1); assert.equal(limited.denied.code, 'E_RATE_LIMIT'); assert.ok(assetRetryAt(limited.denied) >= start + 60000);
});

test('a real HTTP video progressing for over five seconds completes in one transfer', { timeout: hangBudget(4) }, async t => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '12' });
    let sent = 0;
    const timer = setInterval(() => {
      response.write(Buffer.from([++sent]));
      if (sent === 12) { clearInterval(timer); response.end(); }
    }, 500);
    response.on('close', () => clearInterval(timer));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const controller = new AbortController();
  t.after(() => { controller.abort(); server.closeAllConnections(); server.close(); });
  // A retry returns a diagnostic response, so the unfixed implementation fails
  // promptly rather than spending four identical five-second attempts.
  const result = await fetchAsset(`http://127.0.0.1:${server.address().port}`, {}, async (...args) => calls ? denied('E_RULE') : fetch(...args), 'video', undefined, controller.signal);
  assert.ok('url' in result, JSON.stringify(result));
  try {
    assert.equal(calls, 1); assert.equal(result.type, 'video/mp4');
    assert.deepEqual([...new Uint8Array(await (await fetch(result.url)).arrayBuffer())], Array.from({ length: 12 }, (_, i) => i + 1));
  } finally { result.revoke(); }
});

test('ordinary and one-view streams exceed thirty seconds; an actual stall still recovers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  let stream, request, calls = 0, settled;
  const controller = new AbortController(); t.after(() => controller.abort());
  const reading = download(async (_url, init) => {
    calls++; request = init;
    if (calls > 1) return bytes();
    return new Response(new ReadableStream({ start(value) { stream = value; } }), { headers: { 'content-type': 'video/mp4' } });
  }, undefined, controller.signal).then(value => { settled = value; return value; });
  await drain();
  for (let chunk = 0; chunk < 18; chunk++) {
    t.mock.timers.tick(2000); stream.enqueue(new Uint8Array([chunk])); await drain();
    assert.equal(request.signal.aborted, false, `progress at ${(chunk + 1) * 2}s must not abort`);
    assert.equal(calls, 1); assert.equal(settled, undefined);
  }
  stream.close(); await drain();
  const read = await reading; assert.ok('url' in read); assert.equal(read.bytes, 18); read.revoke();

  let probes = 0, views = 0;
  const onceReading = download(async (_url, init) => {
    if (init.headers.range) { probes++; return denied('E_ASSET_RANGE'); }
    views++; request = init;
    return new Response(new ReadableStream({ start(value) { stream = value; } }));
  });
  await drain();
  for (let chunk = 0; chunk < 18; chunk++) {
    t.mock.timers.tick(2000); stream.enqueue(new Uint8Array([chunk])); await drain();
    assert.equal(request.signal.aborted, false, 'a progressing one-view body is allowed to finish');
  }
  stream.close();
  const onceRead = await onceReading;
  assert.ok('url' in onceRead); assert.equal(onceRead.bytes, 18); onceRead.revoke();
  assert.equal(probes, 1); assert.equal(views, 1);

  calls = 0; settled = undefined;
  const stalled = download(async () => {
    if (++calls > 1) return bytes();
    return new Response(new ReadableStream({ start(value) { value.enqueue(new Uint8Array([1])); } }));
  }).then(value => { settled = value; return value; });
  await drain(); t.mock.timers.tick(4999); await drain(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await drain(); t.mock.timers.tick(400); await drain();
  const recovered = await stalled; assert.equal(calls, 2); assert.ok('url' in recovered); recovered.revoke();
});

test('body decoding consumes Retry-After time without an early request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  t.mock.method(Math, 'random', () => 0);
  let body, calls = 0;
  const reading = download(async () => {
    if (++calls > 1) return bytes();
    return new Response(new ReadableStream({ start(stream) { body = stream; } }), { status: 503, headers: { 'Retry-After': '1' } });
  });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await drain(); t.mock.timers.tick(500);
  body.enqueue(new TextEncoder().encode(JSON.stringify({ denied: { code: 'E_RATE_LIMIT', family: 'limit', message: 'busy', retryable: true } })));
  body.close(); await drain();
  t.mock.timers.tick(499); await drain(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await drain(); assert.equal(calls, 2, 'only the remaining 500 ms is waited');
  const read = await reading; assert.ok('url' in read); read.revoke();
});

test('empty chunks cannot postpone a stall or its bounded recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  t.mock.method(Math, 'random', () => 0);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController(); t.after(() => controller.abort());
  let stream, request, calls = 0, canceled = 0, settled;
  const reading = download(async (_url, init) => {
    calls++; request = init;
    return new Response(new ReadableStream({
      start(value) { stream = value; value.enqueue(new Uint8Array([1])); },
      cancel() { canceled++; },
    }));
  }, undefined, controller.signal).then(value => { settled = value; return value; });
  await drain();
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal(calls, attempt);
    for (let chunk = 0; chunk < 2; chunk++) {
      t.mock.timers.tick(2000); stream.enqueue(new Uint8Array()); await drain();
      assert.equal(request.signal.aborted, false);
    }
    t.mock.timers.tick(1000); await drain();
    assert.equal(request.signal.aborted, true, 'empty chunks cannot renew the five-second byte deadline');
    assert.equal(canceled, attempt, 'each stalled stream is canceled');
    if (attempt < 4) { t.mock.timers.tick(250 * 2 ** (attempt - 1)); await drain(); }
  }
  assert.ok(settled, 'the fourth stall settles without another event');
  const read = await reading;
  assert.equal(read.denied.code, 'E_CLIENT'); assert.equal(read.denied.retryable, true);
  assert.equal(calls, 4); assert.match(read.denied.message, /no observable progress/);
});

for (const guidance of ['60', 'Thu, 01 Jan 1970 00:02:40 GMT']) test(`a stalled 503 error body preserves Retry-After ${guidance}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let calls = 0, canceled = 0;
  const controller = new AbortController(); t.after(() => controller.abort());
  const reading = download(async () => {
    calls++;
    return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"denied":')); }, cancel() { canceled++; } }), { status: 503, headers: { 'Retry-After': guidance } });
  }, undefined, controller.signal);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(5000); await new Promise(resolve => setImmediate(resolve));
  // Let a buggy premature retry start, then terminate it for a finite red control.
  t.mock.timers.tick(400); await new Promise(resolve => setImmediate(resolve));
  if (calls > 1) controller.abort();
  const read = await reading;
  assert.equal(calls, 1, 'no early request when refusal JSON stalls');
  assert.equal(read.denied.code, 'E_HTTP_RESPONSE'); assert.match(read.denied.message, /503/);
  assert.equal(read.denied.retryable, true); assert.equal(assetRetryAt(read.denied), 160000);
  assert.equal(canceled, 1);
});

for (const code of ['E_ASSET_UNKNOWN', 'E_ASSET_VIEWED', 'E_AUTH', 'E_RULE']) test(`${code} is final even when mislabelled retryable`, async () => {
  let calls = 0;
  const read = await download(async () => { calls++; return denied(code, true); });
  assert.equal(read.denied.code, code); assert.equal(calls, 1);
});

test('revocation during ordinary retry stops at its first refusal', async () => {
  let calls = 0;
  const read = await download(async () => ++calls === 1 ? reset() : denied('E_ASSET_UNKNOWN'));
  assert.equal(calls, 2); assert.equal(read.denied.code, 'E_ASSET_UNKNOWN');
});

for (const kind of ['reset', 'body reset', 'timeout', 'malformed refusal']) test(`one-view ${kind} never replays an ambiguous download`, { timeout: hangBudget(2) }, async t => {
  if (kind === 'timeout') t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let probes = 0, views = 0;
  const reading = download(async (_url, init) => {
    if (init.headers.range) { probes++; return denied('E_ASSET_RANGE'); }
    views++;
    if (kind === 'reset') return reset();
    if (kind === 'malformed refusal') return new Response('lost outcome', { status: 404 });
    if (kind === 'timeout') return new Promise(() => {});
    return new Response(new ReadableStream({ start(stream) { try { reset(); } catch (error) { stream.error(error); } } }));
  });
  if (kind === 'timeout') {
    await new Promise(resolve => setImmediate(resolve)); t.mock.timers.tick(2_108_000);
  }
  const read = await reading;
  assert.equal(probes, 1); assert.equal(views, 1); assert.equal(read.denied.code, kind === 'malformed refusal' ? 'E_HTTP_RESPONSE' : kind === 'timeout' ? 'E_CLIENT' : 'E_OFFLINE');
  assert.equal(read.denied.retryable, false); assert.match(read.denied.message, /one-view.*consumed/);
});

test('a timed-out late Blob is closed and never retained or published', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  let finish, calls = 0, retained = 0, closed = 0, bodyReads = 0;
  const reading = download(async () => {
    if (++calls > 1) return bytes();
    const response = { ok: true, headers: new Headers(), blob: () => { bodyReads++; return new Promise(resolve => { finish = resolve; }); } }; return response;
  }, async () => { retained++; });
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(2_108_000); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(400); await new Promise(resolve => setImmediate(resolve));
  const read = await reading;
  assert.ok('url' in read); assert.equal(retained, 1); read.revoke();
  finish({ close() { closed++; } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1); assert.equal(retained, 1); assert.equal(bodyReads, 1, "native bytes have exactly one disposal owner");
});

for (const length of ['1048576', null, 'invalid', '']) test(`buffered bodies use a size-aware finite allowance: ${length}`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  let calls = 0, request, settled;
  const controller = new AbortController(); t.after(() => controller.abort());
  const reading = download(async (_url, init) => {
    calls++; request = init;
    if (calls > 1) return bytes();
    return { ok: true, headers: new Headers(length === null ? {} : { 'content-length': length }), body: null, blob: () => new Promise(() => {}) };
  }, undefined, controller.signal).then(value => { settled = value; return value; });
  await drain();
  // More than both old deadlines and the minimum opaque allowance. No bytes
  // are observable, so neither queue time nor streaming inactivity may fire.
  t.mock.timers.tick(61000); await drain();
  assert.equal(request.signal.aborted, false); assert.equal(settled, undefined); assert.equal(calls, 1);
  const limit = length === '1048576' ? 92000 : 2_108_000;
  t.mock.timers.tick(limit - 61000 - 1); await drain(); assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(1); await drain(); assert.equal(request.signal.aborted, true);
  t.mock.timers.tick(400); await drain();
  const result = await reading; assert.ok('url' in result); assert.equal(calls, 2); result.revoke();
});

test('a completion-only fetch gets the unknown-size allowance and disposes its late response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  const controller = new AbortController(); t.after(() => controller.abort());
  let finish, request, calls = 0, closed = 0;
  const reading = download(async (_url, init) => {
    calls++;
    if (calls > 1) return bytes();
    request = init;
    return new Promise(resolve => { finish = resolve; });
  }, undefined, controller.signal);
  await drain();
  t.mock.timers.tick(61000); await drain();
  assert.equal(request.signal.aborted, false); assert.equal(calls, 1);
  t.mock.timers.tick(2_108_000 - 61000 - 1); await drain(); assert.equal(request.signal.aborted, false);
  t.mock.timers.tick(1); await drain(); assert.equal(request.signal.aborted, true);
  t.mock.timers.tick(400); await drain();
  const read = await reading; assert.ok('url' in read); assert.equal(calls, 2); read.revoke();
  finish({ body: null, blob: async () => ({ close() { closed++; } }) }); await drain();
  assert.equal(closed, 1);
});

test('queue and backoff share thirty seconds even across opaque attempts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  t.mock.method(Math, 'random', () => 0);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  let calls = 0, admissions = 0, settled;
  const controller = new AbortController(); t.after(() => controller.abort());
  const queue = signal => new Promise(resolve => {
    admissions++;
    const timer = setTimeout(() => resolve(() => {}), 14000);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
  });
  const reading = download(async () => { calls++; return reset(); }, undefined, controller.signal, undefined, queue)
    .then(value => { settled = value; return value; });
  await drain();
  for (const ms of [14000, 250, 14000, 500]) { t.mock.timers.tick(ms); await drain(); }
  assert.equal(admissions, 3); assert.equal(calls, 2); assert.equal(settled, undefined);
  t.mock.timers.tick(1249); await drain(); assert.equal(settled, undefined);
  t.mock.timers.tick(1); await drain();
  assert.ok(settled, 'no fresh thirty-second budget on each admission');
  const read = await reading; assert.equal(read.denied.code, 'E_OFFLINE'); assert.equal(calls, 2);
});

test('queue expiry during Retry-After preserves the admission refusal and deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  t.mock.method(Math, 'random', () => 0);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  let calls = 0;
  const reading = download(async () => { calls++; return denied('E_RATE_LIMIT', true, { 'Retry-After': '9' }); },
    undefined, undefined, undefined, signal => signal.aborted ? Promise.resolve(undefined) : new Promise(resolve => setTimeout(() => resolve(() => {}), 22000)));
  await drain(); t.mock.timers.tick(22000); await drain();
  t.mock.timers.tick(8000); await drain();
  const read = await reading;
  assert.equal(calls, 1); assert.equal(read.denied.code, 'E_RATE_LIMIT');
  assert.equal(assetRetryAt(read.denied), 131000, 'the server minimum outlives the SDK admission budget');
});

for (const once of [false, true]) test(`post-download retention failure is retryable only for ordinary bytes: once=${once}`, async () => {
  let calls = 0;
  const read = await download(async (_url, init) => {
    calls++;
    if (once && init.headers.range) return denied('E_ASSET_RANGE');
    return bytes();
  }, async () => { throw new Error('retention failed'); });
  assert.equal(read.denied.retryable, !once); assert.equal(calls, once ? 2 : 1);
  assert.equal(read.denied.code, 'E_CLIENT'); assert.match(read.denied.message, /retention failed/);
});

test('the queue admits six bodies and cancels waiting and active calls on close', async () => {
  const queue = assetQueue(), controller = new AbortController();
  let active = 0, peak = 0, calls = 0;
  const requests = Array.from({ length: 40 }, () => download(async (_url, init) => {
    calls++; peak = Math.max(peak, ++active);
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => { active--; reject(new Error('closed')); }, { once: true }));
  }, undefined, controller.signal, () => !controller.signal.aborted, queue));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 6); controller.abort();
  const results = await Promise.all(requests);
  assert.equal(peak, 6); assert.equal(calls, 6); assert.equal(active, 0); assert.equal(results.length, 40);
  assert.ok(results.every(read => 'denied' in read));
});
