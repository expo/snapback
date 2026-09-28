import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorker, runGeneratedEffects } from '../dist/worker.js';
import { uploadAsset, fetchAsset } from '../dist/assets.js';

const refusal = { code: 'E_RATE_LIMIT', family: 'limit', message: 'busy', retryable: true };
for (const generated of [false, true]) for (const family of ['auth', 'limit']) {
  test(`${generated ? 'generated' : 'ordinary'} worker retries overload (${family}) without ending authentication`, { timeout: 5000 }, async t => {
    const stop = new AbortController(); t.after(() => stop.abort());
    let attempts = 0, auth = 0; const times = [];
    const options = { url: 'http://worker.invalid', token: 'test', signal: stop.signal, effects: { notify() {} }, onError() {}, onAuthFailure() { auth++; }, fetch: async () => {
      times.push(Date.now());
      if (++attempts === 1) return Response.json({ denied: { ...refusal, family } }, { status: 503 });
      stop.abort(); return Response.json({ effects: [] });
    } };
    const worker = generated ? runGeneratedEffects(options, { notify: { declarationContract: 'd', execute() {} } }) : runWorker(options);
    await worker.done;
    assert.equal(auth, 0); assert.equal(attempts, 2);
    assert.ok(times[1] - times[0] >= 1900, 'overload takes the worker retry delay');
  });
}
for (const denied of [{}, { code: 'E_RATE_LIMIT' }, { ...refusal, message: 42 }, { ...refusal, retryable: 'true' }]) {
  test(`upload rejects malformed refusal ${JSON.stringify(denied)}`, async () => {
    let attempts = 0;
    const result = await uploadAsset('http://asset.invalid', {}, async () => { attempts++; return Response.json({ denied }, { status: 503 }); }, new Uint8Array([1]));
    assert.equal(attempts, 1); assert.equal(result.why.code, 'E_HTTP_RESPONSE'); assert.match(result.why.message, /HTTP 503/);
  });
}
for (const body of ['busy', JSON.stringify({ denied: {} }), 'null']) test(`download rejects malformed overload: ${body}`, async () => {
  const read = await fetchAsset('http://asset.invalid', {}, async () => new Response(body, { status: 503 }), 'photo');
  assert.equal(read.denied.code, 'E_HTTP_RESPONSE'); assert.match(read.denied.message, /HTTP 503/);
});
test('one-view download retries explicit admission refusals, never an ambiguous reset', async t => {
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  let attempts = 0;
  const read = await fetchAsset('http://asset.invalid', {}, async () => {
    attempts++;
    if (attempts <= 2) return Response.json({ denied: refusal }, { status: 503 });
    throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  }, 'once');
  assert.equal(attempts, 3); assert.equal(read.denied.code, 'E_OFFLINE'); assert.match(read.denied.message, /ECONNRESET/);
});

import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { server, until } from './helpers/app-server.mjs';
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const source = `use personas alice
table notes:
  body: text <=100
  read <- allow
  insert <- allow
  sync public
mutation add(body: text <=100):
  insert notes { body }
query live():
  return connected[viewer]
`;
for (const tier of ['online', 'web']) test(`${tier}: refusals remain HTTP, reads back off, same-ID writes recover`, { timeout: 20000 }, async t => {
  const { url } = await server(t, undefined, source);
  let fault = false, queryMode = 'overload'; const reads = [], writes = [], syncs = [];
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (fault && path === '/q/live') {
      reads.push(Date.now());
      if (queryMode === 'overload') return Response.json({ denied: refusal }, { status: 503 });
      if (queryMode === 'invalid') return new Response('busy', { status: 503 });
      throw queryMode === 'unknown' ? undefined : Object.assign(Error('fetch failed'), { cause: { code: queryMode } });
    }
    if (fault && path === '/sync') { syncs.push(Date.now()); return Response.json({ denied: refusal }, { status: 503 }); }
    if (fault && path === '/m/add') {
      writes.push({ at: Date.now(), body: JSON.parse(init.body) });
      if (writes.length <= 2) return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '0.3' } });
    }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close());
  await client.query({ kind: 'query', name: 'live', runs: 'server' }, {});
  const links = []; client.onLink(link => links.push(link));
  fault = true;
  const read = await client.query({ kind: 'query', name: 'live', runs: 'server' }, {});
  assert.equal(read.denied?.code, 'E_RATE_LIMIT', JSON.stringify(read));
  assert.equal(reads.length, 4);
  for (let i = 1; i < reads.length; i++) assert.ok(reads[i] - reads[i-1] >= 240 * 2 ** (i-1), 'increasing read delay');
  assert.ok(!links.includes('offline'), JSON.stringify(links));
  if (tier === 'web') {
    const before = syncs.length; await client.sync();
    assert.ok(syncs.length >= before + 4, 'sync overload takes its bounded retry path');
    assert.ok(!links.includes('offline'), JSON.stringify(links));
  }
  const outcome = await client.mutate({ kind: 'mutation', name: 'add' }, { body: 'once' });
  await until(() => writes.length >= 3, 'mutation retried');
  assert.equal(new Set(writes.map(w => w.body.id)).size, 1);
  assert.ok(writes[1].at - writes[0].at >= 290, 'mutation respects Retry-After');
  assert.ok(writes[2].at - writes[1].at >= 490, 'mutation delay increases');
  assert.ok(!links.includes('offline'), JSON.stringify(links));
  for (const mode of ['invalid', 'ECONNRESET', 'ECONNREFUSED', 'unknown']) {
    fault = false; if (tier === 'web') await client.sync(); fault = true;
    queryMode = mode;
    const denied = (await client.query({ kind: 'query', name: 'live', runs: 'server' }, {})).denied;
    assert.equal(denied?.code, mode === 'invalid' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE', JSON.stringify(denied));
    assert.match(denied.message, mode === 'invalid' ? /HTTP 503/ : mode === 'unknown' ? /no transport cause/ : new RegExp(mode));
    assert.doesNotMatch(denied.message, /unreachable/);
  }
  void outcome;
});

import { runVerifiers } from '../dist/server-verify.js';
test('route verifier retries legacy auth-family overload without stopping startServer', { timeout: 5000 }, async t => {
  const stop = new AbortController(); t.after(() => stop.abort()); let attempts = 0, ended = 0;
  const times = [];
  const worker = runVerifiers({ url: 'http://verify.invalid', token: 'test', signal: stop.signal, stop() { ended++; stop.abort(); }, onError() {}, redact: value => value, secrets: () => ({}), routes: { hook: { declaration: { contract: 'test' } } }, fetch: async () => {
    times.push(Date.now());
    if (++attempts === 1) return Response.json({ denied: { ...refusal, family: 'auth' } }, { status: 503 });
    stop.abort(); return Response.json({ requests: [] });
  } });
  await worker.done;
  assert.equal(ended, 0); assert.equal(attempts, 2); assert.ok(times[1] - times[0] >= 1900);
});
for (const status of [404, 410]) test(`download HTTP ${status} requires a valid missing/viewed envelope`, async () => {
  const invalid = await fetchAsset('http://asset.invalid', {}, async () => new Response('not a refusal', { status }), 'photo');
  assert.equal(invalid.denied.code, 'E_HTTP_RESPONSE');
  const why = { code: status === 404 ? 'E_ASSET_UNKNOWN' : 'E_ASSET_VIEWED', family: 'asset', message: 'established asset refusal' };
  const valid = await fetchAsset('http://asset.invalid', {}, async () => Response.json({ denied: why }, { status }), 'photo');
  assert.deepEqual(valid.denied, why);
});

import { readWithAdmissionRetry } from '../dist/http-response.js';
test('safe-read retry policy applies jitter and never retries before Retry-After', async t => {
  const delays = []; let attempts = 0;
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { delays.push(delay); queueMicrotask(fn); return 0; });
  const result = await readWithAdmissionRetry(async () => {
    attempts++; return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': attempts === 1 ? '0.4' : '0' } });
  }, () => true);
  assert.equal(attempts, 4); assert.deepEqual(delays, [400, 562.5, 1125]); assert.deepEqual(result.json.denied, refusal);
});
test('safe-read retry policy respects its cumulative ten-second wait bound', async t => {
  const delays = []; let attempts = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { delays.push(delay); queueMicrotask(fn); return 0; });
  await readWithAdmissionRetry(async () => {
    attempts++; return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '6' } });
  }, () => true);
  assert.equal(attempts, 2); assert.deepEqual(delays, [6000]);
});
