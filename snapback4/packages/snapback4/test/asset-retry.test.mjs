// @ref LLP 3000.008.002.000#6 — retry only transfers that cannot consume a view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAsset } from '../dist/assets.js';
import { assetQueue, assetRetryAt } from '../dist/asset-download.js';
const denied = (code, retryable = false, headers) => Response.json({ denied: { code, family: 'asset', message: code, retryable } }, { status: code === 'E_RATE_LIMIT' ? 503 : 416, headers });
const bytes = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png', 'accept-ranges': 'bytes' } });
const download = (send, ...rest) => fetchAsset('http://assets.invalid', {}, send, 'avatar', ...rest);
const reset = () => { throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }); };

for (const kind of ['reset', 'body reset', '503', 'timeout']) test(`ordinary ${kind} recovers with a non-consuming full-file Range`, { timeout: 10000 }, async () => {
  let calls = 0; const times = [];
  const read = await download(async (_url, init) => {
    assert.equal(init.headers.range, 'bytes=0-'); times.push(Date.now());
    if (++calls > 1) return bytes();
    if (kind === 'reset') return reset();
    if (kind === '503') return denied('E_RATE_LIMIT', true, { 'Retry-After': '0.5' });
    if (kind === 'timeout') return new Promise(() => {}); // host ignores abort
    const response = bytes(); response.blob = async () => reset(); return response;
  });
  assert.ok('url' in read, JSON.stringify(read)); read.revoke(); assert.equal(calls, 2);
  assert.ok(times[1] - times[0] >= (kind === '503' ? 500 : kind === 'timeout' ? 5000 : 250));
});

test('exhaustion is bounded, retains its cause, and long retry guidance survives refocus', async () => {
  let calls = 0;
  const read = await download(async () => { calls++; return reset(); });
  assert.equal(calls, 4); assert.equal(read.denied.code, 'E_OFFLINE'); assert.equal(read.denied.retryable, true);
  assert.match(read.denied.message, /ECONNRESET/);
  calls = 0;
  const start = Date.now();
  const limited = await download(async () => { calls++; return denied('E_RATE_LIMIT', true, { 'Retry-After': '60' }); });
  assert.equal(calls, 1); assert.equal(limited.denied.code, 'E_RATE_LIMIT'); assert.ok(assetRetryAt(limited.denied) >= start + 60000);
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

for (const kind of ['reset', 'body reset', 'timeout', 'malformed refusal']) test(`one-view ${kind} never replays an ambiguous download`, { timeout: 10000 }, async () => {
  let probes = 0, views = 0;
  const read = await download(async (_url, init) => {
    if (init.headers.range) { probes++; return denied('E_ASSET_RANGE'); }
    views++;
    if (kind === 'reset') return reset();
    if (kind === 'malformed refusal') return new Response('lost outcome', { status: 404 });
    if (kind === 'timeout') return new Promise(() => {});
    const response = bytes(); response.blob = async () => reset(); return response;
  });
  assert.equal(probes, 1); assert.equal(views, 1); assert.equal(read.denied.code, kind === 'malformed refusal' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
  assert.equal(read.denied.retryable, false); assert.match(read.denied.message, /one-view.*consumed/);
});

test('a timed-out late Blob is closed and never retained or published', { timeout: 10000 }, async () => {
  let finish, calls = 0, retained = 0, closed = 0, bodyReads = 0;
  const reading = download(async () => {
    if (++calls > 1) return bytes();
    const response = { ok: true, headers: new Headers(), blob: () => { bodyReads++; return new Promise(resolve => { finish = resolve; }); } }; return response;
  }, async () => { retained++; });
  const read = await reading;
  assert.ok('url' in read); assert.equal(retained, 1); read.revoke();
  finish({ close() { closed++; } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1); assert.equal(retained, 1); assert.equal(bodyReads, 1, "native bytes have exactly one disposal owner");
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
