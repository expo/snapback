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
  assert.equal(attempts, 4); assert.deepEqual(delays, [450, 562.5, 1125]); assert.deepEqual(result.json.denied, refusal);
});
test('safe-read retry policy respects its cumulative ten-second wait bound', async t => {
  t.mock.method(Math, 'random', () => 0.5);
  const delays = []; let attempts = 0;
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { delays.push(delay); queueMicrotask(fn); return 0; });
  await readWithAdmissionRetry(async () => {
    attempts++; return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '6' } });
  }, () => true);
  assert.equal(attempts, 2); assert.deepEqual(delays, [6750]);
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const session = token => ({ token, principal: 'alice', kind: 'account', expiresAt: Date.now() + 7 * 86400000 });
for (const outcome of ['ECONNRESET', 'invalid', 'success', 'auth', 'terminal-overload']) test(`public asset rotation preserves ${outcome} without consuming another view`, async t => {
  const entered = deferred(), release = deferred(); let gets = 0;
  const client = createClient({ url: 'http://asset.invalid', session: session('old'), fetch: async input => {
    if (new URL(input).pathname === '/auth/refresh') return Response.json({ session: session('new') });
    gets++;
    if (gets === 1) {
      entered.resolve(); await release.promise;
      if (outcome === 'ECONNRESET') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
      if (outcome === 'invalid') return new Response('busy', { status: 503 });
      if (outcome === 'terminal-overload') return Response.json({ denied: { ...refusal, retryable: false } }, { status: 503 });
      if (outcome === 'auth') return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'old token' } }, { status: 401 });
      return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
    }
    return Response.json({ denied: { code: 'E_ASSET_VIEWED', family: 'asset', message: 'already viewed' } }, { status: 410 });
  } });
  t.after(() => client.close());
  const read = client.asset('once'); await entered.promise;
  assert.equal((await client.refreshSession()).ok, true); release.resolve();
  const result = await read;
  assert.equal(gets, outcome === 'auth' ? 2 : 1);
  assert.equal(result.denied?.code, { ECONNRESET: 'E_OFFLINE', invalid: 'E_HTTP_RESPONSE', success: 'E_AUTH', auth: 'E_ASSET_VIEWED', 'terminal-overload': 'E_RATE_LIMIT' }[outcome]);
  if (outcome === 'ECONNRESET') assert.match(result.denied.message, /ECONNRESET/);
});

for (const tier of ['online', 'web']) for (const mode of ['refusal', 'text', 'null', 'envelope', 'success-envelope', 'reset', 'body']) test(`${tier}: public ephemeral ${mode} preserves HTTP status and never replays`, async t => {
  const { url } = await server(t, undefined, source);
  const entered = deferred(), release = deferred(); const calls = [];
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    if (new URL(input).pathname === '/m/signal') {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) {
        entered.resolve(); await release.promise;
        if (mode === 'reset') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
        if (mode === 'body') return new Response(new ReadableStream({ start(c) { c.error(Object.assign(Error('body failed'), { cause: { code: 'ECONNRESET' } })); } }), { status: 503 });
        if (mode === 'text') return new Response('busy', { status: 503 });
        if (mode === 'null') return Response.json(null, { status: 503 });
        if (mode === 'envelope') return Response.json({ denied: { code: 'E_RATE_LIMIT' } }, { status: 503 });
        if (mode === 'success-envelope') return Response.json({ state: 'sent' });
        return Response.json({ denied: refusal }, { status: 503 });
      }
      return Response.json({ state: 'sent', result: null });
    }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close());
  const links = []; client.onLink(link => links.push(link));
  const op = { kind: 'mutation', name: 'signal', ephemeral: true, renewMs: 1000 };
  const first = client.mutate(op, { n: 1 }); await entered.promise;
  const second = client.mutate(op, { n: 2 }); release.resolve();
  const result = await first;
  if (mode === 'reset' || mode === 'body') {
    assert.equal(result.why.code, 'E_OFFLINE'); assert.match(result.why.message, /ECONNRESET/);
    assert.equal((await second).why.code, 'E_OFFLINE'); assert.equal(calls.length, 1);
    assert.ok(links.includes('offline')); return;
  }
  if (mode === 'refusal') assert.deepEqual(result.why, refusal);
  else {
    assert.equal(result.why.code, 'E_HTTP_RESPONSE');
    assert.match(result.why.message, new RegExp(`HTTP ${mode === 'success-envelope' ? 200 : 503}`));
  }
  assert.equal((await second).state, 'sent');
  assert.deepEqual(calls.map(c => c.args.n), [1, 2]);
  assert.equal(new Set(calls.map(c => c.id)).size, 2);
  assert.equal(client.link(), 'online'); assert.ok(!links.includes('offline'));
});

for (const mode of ['recover', 'exhaust', 'reset', 'invalid']) test(`public fresh web schema ${mode} retains startup cause`, async t => {
  const { url } = await server(t, undefined, source);
  let attempts = 0;
  const options = { url, persona: 'alice', device: webDevice({ wasm, persist: memoryPersistence() }), fetch: async (input, init) => {
    if (new URL(input).pathname === '/schema') {
      attempts++;
      if (mode === 'reset') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
      if (mode === 'invalid') return new Response('busy', { status: 503 });
      if (mode !== 'recover' || attempts < 3) return Response.json({ denied: refusal }, { status: 503 });
    }
    return defaultFetch(input, init);
  } };
  if (mode === 'recover') {
    const client = await createLocalClient(options); t.after(() => client.close());
    assert.equal(client.link(), 'online'); assert.equal(attempts, 3);
  } else {
    const code = { exhaust: 'E_RATE_LIMIT', reset: 'E_OFFLINE', invalid: 'E_HTTP_RESPONSE' }[mode];
    await assert.rejects(createLocalClient(options), error => {
      assert.equal(error.denied?.code, code); assert.match(error.message, new RegExp(code));
      if (mode === 'reset') assert.match(error.message, /ECONNRESET/);
      return true;
    });
    assert.equal(attempts, mode === 'exhaust' ? 4 : 1);
  }
});

for (const tier of ['online', 'web']) test(`${tier}: public mutation overload uses deterministic jitter and Retry-After`, async t => {
  const { url } = await server(t, undefined, source); let calls = 0; const ids = [], delays = [];
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    if (new URL(input).pathname === '/m/add') {
      ids.push(JSON.parse(init.body).id); calls++;
      if (calls <= 2) return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': calls === 1 ? '0.4' : '0' } });
    }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close());
  const realTimeout = globalThis.setTimeout;
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (fn, delay, ...args) => { delays.push(delay); return realTimeout(fn, delay, ...args); });
  await client.mutate({ kind: 'mutation', name: 'add' }, { body: 'one intent' });
  await until(() => calls === 3);
  assert.equal(new Set(ids).size, 1);
  assert.ok(delays.includes(450), JSON.stringify(delays));
  assert.ok(delays.includes(562.5), `second mutation backoff is 500 * 1.125: ${JSON.stringify(delays)}`);
});

import { guest, signup, login, refreshSession, logoutAll } from '../dist/auth.js';
import { memorySessionStore, sessionKey } from '../dist/auth.js';
import { createApp } from '../dist/app.js';

for (const door of ['constructor', 'deferred', 'online']) for (const mode of ['reset', 'invalid', 'body', 'overload', 'terminal', 'retryable-auth']) {
  test(`public ${door} startup rotation ${mode} retains its retry decision across clock updates`, { timeout: 15000 }, async t => {
    const { url } = await server(t), persist = memoryPersistence(), store = memorySessionStore();
    const signed = await guest(url); assert.equal(signed.ok, true);
    const first = await createLocalClient({ url, session: signed.session, sessionStore: store, device: webDevice({ wasm, persist }) });
    await first.close();
    const near = { ...signed.session, expiresAt: Date.now() + 3600000 };
    await store.set(sessionKey(url), JSON.stringify(near));
    const timers = new Map(), statuses = [], bearers = [];
    const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
    t.mock.method(Math, 'random', () => 0.5);
    t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
      if (ms === 60000) { const id = { unref() {} }; timers.set(id, () => fn(...args)); return id; }
      return timeout(fn, [281.25, 562.5, 1125].includes(ms) ? 1 : ms, ...args);
    });
    t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); clear(id); });
    const retryable = mode === 'overload' || mode === 'retryable-auth';
    const options = { url, sessionStore: store, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/auth/refresh') {
        bearers.push(new Headers(init?.headers).get('authorization'));
        if (bearers.length === 1 && (retryable || mode === 'terminal')) return Response.json({ denied: {
          ...refusal, ...(mode === 'retryable-auth' ? { code: 'E_AUTH', family: 'auth' } : {}), retryable,
        } }, { status: 503 });
        // Real rotation consumes the predecessor before its successful reply is lost.
        const response = await defaultFetch(input, init); statuses.push(response.status);
        if (bearers.length === 1) {
          await response.arrayBuffer();
          if (mode === 'reset') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
          if (mode === 'invalid') return new Response('busy', { status: 503 });
          return new Response(new ReadableStream({ start(c) { c.error(Error('lost refresh body')); } }), { status: 200 });
        }
        // A retry after a proven refusal may adopt the real successor.
        return response;
      }
      if (path === '/auth/logout') return defaultFetch(input, init);
      return Response.json({ denied: refusal }, { status: 503, headers: path === '/q/list'
        ? { 'x-snapback-time': String(Date.now() + 5000), 'x-snapback-clock': 'fu:1' } : {} });
    } };
    let client, app;
    if (door === 'constructor') client = await createLocalClient({ ...options, device: webDevice({ wasm, persist }) });
    else if (door === 'online') client = createClient({ ...options, session: near });
    else { app = createApp({ ...options, device: webDevice({ wasm, persist }) }); await app.ready; client = app.client; }
    t.after(() => app ? app.close() : client?.close());
    assert.ok(client, app?.auth.state);
    await until(() => bearers.length === 1);
    // A public request carrying a new clock sample must not revive a stopped rotation.
    await client.query({ kind: 'query', name: 'list', runs: 'server' }, {});
    const armed = timers.size;
    for (const [id, fire] of [...timers]) { timers.delete(id); fire(); }
    if (armed) await until(() => bearers.length > 1);
    assert.equal(armed, retryable ? 1 : 0, 'only an explicit retryable refusal may arm rotation');
    assert.equal(bearers.length, retryable ? 2 : 1, 'never resend an ambiguously consumed bearer');
    if (['reset', 'invalid', 'body'].includes(mode)) {
      const unknown = await client.refreshSession();
      assert.equal(unknown.why.code, mode === 'invalid' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
      assert.deepEqual(await client.refreshSession(), unknown);
      assert.equal(bearers.length, 1, 'an explicit refresh cannot reuse the unknown predecessor either');
      assert.deepEqual(statuses, [200]);
    } else if (retryable) await until(() => client.session()?.token !== near.token);
    assert.equal(client.session()?.principal, near.principal);
    if (app) assert.equal(app.auth.state, 'signed-in');
  });
}
for (const [name, invoke] of [
  ['guest', f => guest('http://auth.invalid', f)],
  ['signup', f => signup('http://auth.invalid', 'a', 'b', f)],
  ['login', f => login('http://auth.invalid', 'a', 'b', f)],
  ['refresh', f => refreshSession('http://auth.invalid', 'token', f)],
  ['logoutAll', f => logoutAll('http://auth.invalid', 'token', f)],
]) for (const mode of ['overload', 'invalid', 'reset', 'unreachable']) test(`public auth ${name}: ${mode} retains cause with one request`, async () => {
  let attempts = 0;
  const result = await invoke(async () => {
    attempts++;
    if (mode === 'overload') return Response.json({ denied: refusal }, { status: 503 });
    if (mode === 'invalid') return new Response('busy', { status: 503 });
    throw Object.assign(Error('fetch failed'), { cause: { code: mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED' } });
  });
  assert.equal(attempts, 1);
  assert.equal(result.why?.code, mode === 'overload' ? 'E_RATE_LIMIT' : mode === 'invalid' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
  if (mode === 'reset' || mode === 'unreachable') assert.match(result.why.message, new RegExp(mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED'));
});

for (const tier of ['online', 'web']) for (const mode of ['overload', 'refusal', 'reset', 'unreachable']) test(`${tier}: public changes ${mode} classifies delivered refusals separately`, { timeout: 10000 }, async t => {
  const { url } = await server(t, undefined, source); const times = [];
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    if (new URL(input).pathname === '/changes') {
      times.push(Date.now());
      if (times.length === 1) {
        if (mode === 'reset' || mode === 'unreachable') throw Object.assign(Error('fetch failed'), { cause: { code: mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED' } });
        return Response.json({ denied: mode === 'overload' ? refusal : { code: 'E_STORE', family: 'store', message: 'busy', retryable: true } }, { status: 503 });
      }
    }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close()); const links = []; client.onLink(link => links.push(link));
  const watch = client.observe({ kind: 'query', name: 'live', runs: 'server' }, {});
  t.after(watch.subscribe(() => {}));
  await until(() => times.length >= 2);
  assert.ok(times[1] - times[0] >= 900, 'poll failures take a delay');
  if (mode === 'reset' || mode === 'unreachable') assert.ok(links.includes('offline'));
  else { assert.ok(!links.includes('offline')); assert.equal(client.link(), 'online'); }
});

for (const tier of ['online', 'web']) for (const mode of ['overload', 'reset', 'invalid']) test(`${tier}: public session rotation ${mode} schedules only proven refusal retries`, async t => {
  const { url } = await server(t); const signed = await guest(url); assert.equal(signed.ok, true);
  let attempts = 0; const delays = [];
  const options = { url, session: signed.session, fetch: async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh') {
      attempts++;
      if (mode === 'overload') return Response.json({ denied: refusal }, { status: 503 });
      if (mode === 'invalid') return new Response('busy', { status: 503 });
      throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close()); const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => { delays.push(ms); return timeout(fn, ms, ...args); });
  const result = await client.refreshSession();
  assert.equal(result.why.code, mode === 'overload' ? 'E_RATE_LIMIT' : mode === 'invalid' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
  assert.equal(attempts, 1); assert.equal(client.link(), 'online');
  assert.equal(delays.includes(60000), mode === 'overload', JSON.stringify(delays));
});

test('public saved web backend opens connected after exhausted schema overload', async t => {
  const { url } = await server(t, undefined, source); const persist = memoryPersistence(); let fault = false, attempts = 0;
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    if (fault && ['/schema', '/sync'].includes(new URL(input).pathname)) {
      if (new URL(input).pathname === '/schema') attempts++;
      return Response.json({ denied: refusal }, { status: 503 });
    }
    return defaultFetch(input, init);
  } };
  const first = await createLocalClient({ ...options, device: webDevice({ wasm, persist }) }); await first.close();
  fault = true;
  const reopened = await createLocalClient({ ...options, device: webDevice({ wasm, persist }) }); t.after(() => reopened.close());
  assert.equal(attempts, 4); assert.equal(reopened.link(), 'online');
});

for (const rotating of [false, true]) for (const mode of ['overload', 'reset', 'unreachable', 'invalid']) test(`public web asset ${mode} retains cause, rotation=${rotating}`, async t => {
  const { url } = await server(t, undefined, source); let gets = 0; const entered = deferred(), release = deferred();
  const client = await createLocalClient({ url, session: session('old'), device: webDevice({ wasm, persist: memoryPersistence() }), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') return Response.json({ session: session('new') });
    if (path === '/assets/once') {
      gets++; entered.resolve(); await release.promise;
      if (mode === 'overload') return Response.json({ denied: refusal }, { status: 503 });
      if (mode === 'invalid') return new Response('busy', { status: 503 });
      throw Object.assign(Error('fetch failed'), { cause: { code: mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED' } });
    }
    const headers = new Headers(init?.headers); headers.delete('authorization'); headers.set('x-snapback-persona', 'alice');
    return defaultFetch(input, { ...init, headers });
  } });
  t.after(() => client.close());
  const reading = client.asset('once'); await entered.promise;
  if (rotating) assert.equal((await client.refreshSession()).ok, true);
  release.resolve(); const read = await reading;
  assert.equal(read.denied?.code, mode === 'overload' ? 'E_RATE_LIMIT' : mode === 'invalid' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
  assert.equal(gets, mode === 'overload' ? 4 : 1);
  if (['reset', 'unreachable'].includes(mode)) assert.match(read.denied.message, new RegExp(mode === 'reset' ? 'ECONNRESET' : 'ECONNREFUSED'));
  else assert.equal(client.link(), 'online');
});

for (const tier of ['online', 'web']) for (const door of ['probe', 'sync']) {
  if (tier === 'online' && door === 'sync') continue;
  test(`${tier}: public ${door} overload recovers an offline link without adopting identity`, { timeout: 15000 }, async t => {
    let client;
    const events = new EventTarget(), oldAdd = globalThis.addEventListener, oldRemove = globalThis.removeEventListener;
    globalThis.addEventListener = events.addEventListener.bind(events); globalThis.removeEventListener = events.removeEventListener.bind(events);
    t.after(async () => { await client?.close(); globalThis.addEventListener = oldAdd; globalThis.removeEventListener = oldRemove; });
    const { url } = await server(t, undefined, source); let fault = false, probes = 0, uploads = 0;
    const options = { url, persona: 'alice', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (fault) {
        if (path === '/q/live') throw Object.assign(Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
        if (path === '/probe') { probes++; return Response.json({ denied: refusal }, { status: 503 }); }
        if (path === '/sync') return Response.json({ denied: refusal }, { status: 503 });
        if (path === '/assets') { uploads++; return Response.json({ denied: refusal }, { status: 503 }); }
      }
      return defaultFetch(input, init);
    } };
    client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
    await client.query({ kind: 'query', name: 'live', runs: 'server' }, {});
    fault = true; await client.query({ kind: 'query', name: 'live', runs: 'server' }, {});
    assert.equal(client.link(), 'offline');
    if (door === 'sync') await client.sync();
    else {
      events.dispatchEvent(new Event('online'));
      await until(() => probes > 0 && client.link() === 'online');
    }
    assert.equal(client.link(), 'online');
    const upload = await client.upload(new Uint8Array([1]));
    assert.equal(upload.why.code, 'E_RATE_LIMIT'); assert.equal(uploads, 4);
  });
}

test('public transfers jitter beyond Retry-After and stop within their cumulative budget', async t => {
  const delays = []; t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { delays.push(ms); queueMicrotask(fn); return 0; });
  const client = createClient({ url: 'http://asset.invalid', persona: 'alice', fetch: async () => Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '1' } }) });
  t.after(() => client.close());
  assert.equal((await client.upload(new Uint8Array([1]))).why.code, 'E_RATE_LIMIT');
  assert.deepEqual(delays.splice(0).filter(ms => ms > 0), [1125, 1125, 1125]);
  assert.equal((await client.asset('once')).denied.code, 'E_RATE_LIMIT');
  assert.deepEqual(delays.filter(ms => ms > 0), [1125, 1125, 1125]);
});

test('public web probe recovery paces overload while identity remains unverified', { timeout: 10000 }, async t => {
  const { url } = await server(t, undefined, source), entered = deferred(), release = deferred(), probes = [];
  const client = await createLocalClient({ url, persona: 'alice', device: webDevice({ wasm, persist: memoryPersistence() }), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') { entered.resolve(); await release.promise; throw Error('lost change feed'); }
    if (path === '/probe') { await new Promise(setImmediate); probes.push(Date.now()); return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '1' } }); }
    return defaultFetch(input, init);
  } });
  t.after(() => { release.resolve(); return client.close(); });
  await entered.promise; release.resolve();
  await until(() => probes.length >= 3);
  assert.equal(client.link(), 'online');
  for (let i = 1; i < probes.length; i++) assert.ok(probes[i] - probes[i - 1] >= 990, `probe intervals: ${JSON.stringify(probes)}`);
});

for (const tier of ['online', 'web']) for (const kind of ['upload', 'asset', 'query', 'mutation']) test(`${tier}: concurrent public ${kind} retries vary beyond Retry-After`, { timeout: 15000 }, async t => {
  const { url } = await server(t, undefined, source), clients = [], timers = [], calls = new Map();
  let fault = false;
  const path = { upload: '/assets', asset: '/assets/once', query: '/q/live', mutation: '/m/add' }[kind];
  for (let n = 0; n < 4; n++) {
    const options = { url, persona: 'alice', fetch: async (input, init) => {
      if (fault && new URL(input).pathname === path) {
        calls.set(n, (calls.get(n) ?? 0) + 1);
        if (calls.get(n) === 1) return Response.json({ denied: refusal }, { status: 503, headers: { 'Retry-After': '1' } });
        if (kind === 'upload' || kind === 'asset') return Response.json({ denied: { code: 'E_ASSET_KIND', family: 'asset', message: 'test bytes' } }, { status: 400 });
      }
      return defaultFetch(input, init);
    } };
    const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
    clients.push(client); t.after(() => client.close());
  }
  const timeout = globalThis.setTimeout; let sample = 0;
  t.mock.method(Math, 'random', () => [0, 0.25, 0.5, 0.75][sample++ % 4]);
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms >= 1000 && ms <= 1250) timers.push({ ms });
    return timeout(fn, ms, ...args);
  });
  fault = true;
  const pending = clients.map(client => kind === 'upload' ? client.upload(new Uint8Array([1]))
    : kind === 'asset' ? client.asset('once') : kind === 'query' ? client.query({ kind: 'query', name: 'live', runs: 'server' }, {})
    : client.mutate({ kind: 'mutation', name: 'add' }, { body: 'one intent' }));
  await Promise.all(pending);
  await until(() => calls.size === 4 && [...calls.values()].every(count => count >= 2));
  const delays = timers.slice(0, 4).map(timer => timer.ms);
  assert.equal(new Set(delays).size, 4, 'independent calls must not all retry together');
  assert.ok(delays.every(ms => ms >= 1000 && ms < 1250));
  assert.deepEqual(delays.slice().sort((a, b) => a - b), [1000, 1062.5, 1125, 1187.5]);
  assert.deepEqual([...calls.values()], [2, 2, 2, 2]);
});
