import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../dist/app.js';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { guest, memorySessionStore, sessionKey } from '../dist/auth.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server, until } from './helpers/app-server.mjs';

const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const busy = { code: 'E_RATE_LIMIT', family: 'limit', message: 'busy', retryable: true };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const copyDevice = persist => {
  const copy = memoryPersistence();
  for (const [name, rows] of persist.stores) copy.stores.set(name, new Map(rows));
  return webDevice({ wasm, persist: copy });
};
async function fixture(t) {
  const { url } = await server(t), values = new Map(), persist = memoryPersistence();
  const store = { async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
  const signed = await guest(url); assert.equal(signed.ok, true);
  const initial = await createLocalClient({ url, session: signed.session, sessionStore: store, device: webDevice({ wasm, persist }) });
  await initial.close();
  const near = { ...signed.session, expiresAt: Date.now() + 3600000 };
  await store.set(sessionKey(url), JSON.stringify(near));
  return { url, store, values, persist, near };
}
async function open(door, f, fetcher) {
  const options = { url: f.url, sessionStore: { ...f.store }, fetch: fetcher };
  if (door === 'local') {
    const client = await createLocalClient({ ...options, device: copyDevice(f.persist) });
    return { client, close: () => client.close() };
  }
  const app = createApp({ ...options, ...(door === 'app-web' ? { device: copyDevice(f.persist) } : {}) });
  await app.ready;
  return { app, client: app.client, close: () => app.close() };
}
function faultyRefresh(f, mode, statuses, calls) {
  return async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') {
      calls.push(new Headers(init?.headers).get('authorization'));
      const response = await defaultFetch(input, init); statuses.push(response.status); await response.arrayBuffer();
      if (mode === 'json') return Response.json({});
      if (mode === 'body') return new Response(new ReadableStream({ start(c) { c.error(Object.assign(Error('body failed'), { code: 'ECONNREFUSED' })); } }));
      throw Object.assign(Error('lost successful refresh'), { cause: { code: 'ECONNRESET' } });
    }
    return Response.json({ denied: busy }, { status: 503 });
  };
}
for (const door of ['app-online', 'app-web', 'local']) for (const mode of ['reset', 'json', 'body', 'later']) {
  test(`${door}: a shared-store peer and a new runtime fence ${mode} refresh`, { timeout: 25000 }, async t => {
    const f = await fixture(t), statuses = [], calls = [];
    if (mode === "later") { f.near.expiresAt = Date.now() + 7 * 86400000; await f.store.set(sessionKey(f.url), JSON.stringify(f.near)); }
    const fetcher = faultyRefresh(f, mode, statuses, calls);
    const first = await open(door, f, fetcher); t.after(() => first.close());
    const failed = await first.client.refreshSession();
    assert.equal(failed.ok, false); assert.equal(failed.why.code, mode === 'json' ? 'E_HTTP_RESPONSE' : 'E_OFFLINE');
    if (mode === 'json') assert.match(failed.why.message, /HTTP 200.*session refresh/);
    assert.equal(first.client.session()?.token, f.near.token, 'unknown is not signed out');
    if (first.app) { assert.equal(first.app.auth.state, 'signed-in'); assert.match(first.app.auth.why?.rewrite ?? '', /sign in again/); }
    const second = await open(door, f, fetcher); t.after(() => second.close());
    if (second.app) {
      await until(() => second.app.auth.why, "restoration reports its pending rotation");
      assert.match(second.app.auth.why.rewrite ?? "", /sign in again/);
    }
    assert.equal((await second.client.refreshSession()).ok, false);
    assert.deepEqual(statuses, [200]); assert.equal(calls.length, 1);
    await second.close(); await first.close();

    // Serialize only persisted state into a fresh process: no instance, module
    // singleton, WeakMap or session-store object survives this restart.
    const dir = mkdtempSync(join(tmpdir(), 'fu-refresh-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify({ values: [...f.values], stores: [...f.persist.stores].map(([k,v]) => [k,[...v]]) }));
    const module = name => new URL(`../dist/${name}.js`, import.meta.url).href;
    const code = `
      import { readFileSync, writeFileSync } from 'node:fs';
      import { createApp } from ${JSON.stringify(module('app'))};
      import { createLocalClient } from ${JSON.stringify(module('local'))};
      import { webDevice, memoryPersistence } from ${JSON.stringify(module('web'))};
      const file = process.argv[1], state = JSON.parse(readFileSync(file)), values = new Map(state.values);
      const store = { async get(k) { return values.get(k) ?? null; }, async set(k,v) { values.set(k,v); writeFileSync(file, JSON.stringify({...state,values:[...values]})); }, async delete(k) { values.delete(k); } };
      const persist = memoryPersistence(); for (const [k,v] of state.stores) persist.stores.set(k,new Map(v));
      let calls = 0;
      const options = { url: ${JSON.stringify(f.url)}, sessionStore: store, fetch: async input => {
        if (new URL(input).pathname === '/auth/refresh') calls++;
        return Response.json({denied:${JSON.stringify(busy)}},{status:503});
      } };
      const device = webDevice({wasm:readFileSync(${JSON.stringify(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url).pathname)}),persist});
      const app = ${door === 'local' ? 'null' : `createApp({...options,${door === 'app-web' ? 'device' : ''}})`};
      if (app) await app.ready;
      const client = app ? app.client : await createLocalClient({...options,device});
      const restoredWarning = app?.auth.why;
      const result = await client.refreshSession();
      console.log(JSON.stringify({calls, result, restoredWarning, token:client.session()?.token, auth: app && {state:app.auth.state,why:app.auth.why}}));
      await (app ?? client).close();
    `;
    const child = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', code, file], { timeout: 15000 });
    const restarted = JSON.parse(child.stdout.trim());
    assert.equal(restarted.calls, 0, child.stdout); assert.equal(restarted.result.ok, false);
    assert.equal(restarted.token, f.near.token);
    if (restarted.auth) {
      assert.match(restarted.auth.why?.rewrite ?? '', /sign in again/);
      if (mode === 'later') assert.match(restarted.restoredWarning?.rewrite ?? '', /sign in again/, 'restoration warns before another refresh request');
    }
  });
}
for (const door of ['app-online', 'app-web', 'local']) for (const renewal of ['explicit', 'scheduled', 'peer']) test(`${door}: a proven unsent automatic refresh can renew later (${renewal})`, { timeout: 15000 }, async t => {
  const f = await fixture(t); let attempts = 0;
  const timers = new Map(), timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms === 60000) { const id = { unref() {} }; timers.set(id, () => fn(...args)); return id; }
    return timeout(fn, ms, ...args);
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); clear(id); });
  const fetcher = async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh' && ++attempts === 1) throw Object.assign(Error('not connected'), { cause: { code: 'ECONNREFUSED' } });
    return defaultFetch(input, init);
  };
  const opened = await open(door, f, fetcher); t.after(() => opened.close());
  await until(() => attempts === 1 && timers.size > 0, 'proven nondispatch re-arms automatic renewal');
  if (opened.app) assert.equal(opened.app.auth.why, undefined);
  if (renewal === 'peer') {
    const peer = await open(door, f, fetcher); t.after(() => peer.close());
    await until(() => peer.client.session()?.token !== f.near.token);
    assert.equal(attempts, 2); return;
  }
  if (renewal === 'scheduled') {
    for (const [id, fire] of [...timers]) { timers.delete(id); fire(); }
    await until(() => opened.client.session()?.token !== f.near.token);
    assert.equal(attempts, 2); return;
  }
  const renewed = await opened.client.refreshSession();
  // An online startup may still own the initial failure. Wait for its returned
  // outcome, then explicitly exercise renewal after the connection recovers.
  const result = renewed.ok ? renewed : await opened.client.refreshSession();
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(attempts, 2);
  assert.notEqual(opened.client.session().token, f.near.token);
});
for (const door of ['app-online', 'app-web']) test(`${door}: a claim fences a concurrent peer before the response`, { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let calls = 0;
  const fetcher = async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh') { calls++; entered.resolve(); await release.promise; return defaultFetch(input, init); }
    return Response.json({ denied: busy }, { status: 503 });
  };
  const starting = open(door, f, fetcher); await entered.promise;
  const peer = await open(door, f, fetcher); t.after(() => peer.close());
  const result = await peer.client.refreshSession(); assert.equal(result.ok, false); assert.equal(calls, 1);
  release.resolve(); const first = await starting; t.after(() => first.close());
  await until(() => first.client.session()?.token !== f.near.token);
  assert.equal(calls, 1);
});
for (const retryable of [false, undefined]) for (const tier of ['online', 'web']) test(`${tier}: nonretryable changes (${retryable}) is visible and stops polling`, { timeout: 10000 }, async t => {
  const { url } = await server(t), signed = await guest(url), entered = deferred(), release = deferred(); let polls = 0;
  const why = { code: 'E_STORE', family: 'store', message: 'the partition is gone', ...(retryable === false ? { retryable } : {}) };
  const options = { url, session: signed.session, sessionStore: memorySessionStore(), fetch: async (input, init) => {
    if (new URL(input).pathname === '/changes') { polls++; entered.resolve(); await release.promise; return Response.json({ denied: why }, { status: 500 }); }
    return defaultFetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => { release.resolve(); return client.close(); });
  const watch = client.observe({ kind: 'query', name: 'list' }, {}); const stop = watch.subscribe(() => {}); t.after(stop);
  await entered.promise; await until(() => 'data' in watch.getSnapshot()); release.resolve();
  await until(() => watch.getSnapshot().denied?.code === 'E_STORE', JSON.stringify(watch.getSnapshot()));
  assert.equal(client.link(), 'online'); await sleep(1400); assert.equal(polls, 1);
  assert.equal(watch.getSnapshot().denied?.message, why.message);
});

for (const door of ['app-online', 'app-web']) test(`${door}: failed outcome persistence retains the pre-dispatch fence and warning`, { timeout: 20000 }, async t => {
  const f = await fixture(t), original = f.store.set, calls = [], statuses = [];
  let failed = false;
  f.store.set = async (key, value) => {
    if (JSON.parse(value)?.snapback4Rotation?.why?.code === 'E_OFFLINE') { failed = true; throw Error('outcome save failed'); }
    return original(key, value);
  };
  const fetcher = faultyRefresh(f, 'reset', statuses, calls);
  const first = await open(door, f, fetcher); t.after(() => first.close());
  await until(() => failed, 'automatic refresh tried to preserve its detailed failure');
  assert.equal(first.app.auth.why?.code, 'E_OFFLINE', 'the automatic warning keeps the original transport outcome');
  const outcome = await first.client.refreshSession();
  assert.equal(outcome.why.code, 'E_HTTP_RESPONSE', 'a subsequent call reads the durable generic claim when the diagnostic save failed');
  assert.match(first.app.auth.why?.rewrite ?? '', /sign in again/);
  const peer = await open(door, f, fetcher); t.after(() => peer.close());
  assert.equal((await peer.client.refreshSession()).ok, false);
  assert.deepEqual(statuses, [200]); assert.equal(calls.length, 1);
});

for (const door of ['app-online', 'app-web', 'local']) for (const renewal of ['explicit', 'scheduled']) test(`${door}: a peer releases its warning after the owner proves non-dispatch (${renewal})`, { timeout: 10000 }, async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(); let attempts = 0;
  f.near.expiresAt = Date.now() + 7 * 86400000;
  await f.store.set(sessionKey(f.url), JSON.stringify(f.near));
  const fetcher = async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh' && ++attempts === 1) {
      entered.resolve(); await release.promise;
      throw Object.assign(Error('connection refused before dispatch'), { code: 'ECONNREFUSED' });
    }
    return defaultFetch(input, init);
  };
  const first = await open(door, f, fetcher), peer = await open(door, f, fetcher);
  t.after(async () => { release.resolve(); await first.close(); await peer.close(); });
  const timers = new Map(), timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms === 60000) { const id = { unref() {} }; timers.set(id, () => fn(...args)); return id; }
    return timeout(fn, ms, ...args);
  });
  t.mock.method(globalThis, 'clearTimeout', id => { timers.delete(id); clear(id); });
  const pending = first.client.refreshSession(); await entered.promise;
  assert.equal((await peer.client.refreshSession()).ok, false);
  if (peer.app) assert.match(peer.app.auth.why?.rewrite ?? '', /sign in again/);
  const peerRetries = [...timers];
  release.resolve(); assert.equal((await pending).why.code, 'E_OFFLINE');
  if (renewal === 'scheduled') {
    assert.equal(peerRetries.length, 1, 'a peer checks an in-flight claim without dispatching');
    for (const [id, fire] of peerRetries) { timers.delete(id); fire(); }
    await until(() => peer.client.session()?.token !== f.near.token);
  } else { const retry = await peer.client.refreshSession(); assert.equal(retry.ok, true, JSON.stringify(retry)); }
  assert.equal(attempts, 2);
  if (peer.app) assert.equal(peer.app.auth.why, undefined, 'successful renewal clears only the rotation warning');
});
