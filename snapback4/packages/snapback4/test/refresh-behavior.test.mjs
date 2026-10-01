import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../dist/app.js';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { guest, memorySessionStore, sessionKey } from '../dist/auth.js';
import { defaultFetch } from '../dist/node-fetch.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server, until } from './helpers/app-server.mjs';

const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
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
for (const door of ['app-online', 'app-web', 'local']) for (const renewal of ['explicit', 'scheduled', 'peer']) test(`${door}: a proven unsent automatic refresh can renew later (${renewal})`, { timeout: hangBudget(8) }, async t => {
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

// Astra round 4 #3: an explicitly supplied account is not stale restoration.
for (const tier of ['online', 'web']) test(`${tier}: supplied replacement refreshes while another account is stored`, async t => {
  const { url } = await server(t), a = await guest(url), b = await guest(url);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  const memory = memorySessionStore(), key = sessionKey(url), aBytes = JSON.stringify(a.session);
  await memory.set(key, aBytes);
  const removed = [], calls = [], statuses = [];
  const store = { ...memory, async delete(k) { removed.push(k); await memory.delete(k); } };
  const supplied = { ...b.session, expiresAt: Date.now() + 30 * 60000 };
  const options = { url, session: supplied, sessionStore: store, fetch: async (input, init) => {
    const response = await defaultFetch(input, init);
    if (new URL(input).pathname === '/auth/refresh') {
      calls.push(new Headers(init?.headers).get('authorization')); statuses.push(response.status);
    }
    return response;
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close());
  await until(() => client.session()?.token !== supplied.token);
  assert.equal(client.session()?.principal, b.session.principal);
  assert.deepEqual(calls, [`Bearer ${b.session.token}`]); assert.deepEqual(statuses, [200]);
  assert.ok(!removed.includes(key), 'opening B must not delete A as an authentication rejection');
  const saved = await memory.get(key);
  if (tier === 'web') assert.equal(JSON.parse(saved).token, client.session().token);
  else assert.equal(saved, aBytes, 'raw online clients leave persistence with their caller, as on main');
  assert.deepEqual((await client.query({ kind: 'query', name: 'list' }, {})).data, []);
});

for (const tier of ['online', 'web']) for (const mode of ['empty', 'invalid-session', 'retryable-auth']) test(`${tier}: refresh ${mode} preserves the account and allows renewal`, async t => {
  const { url } = await server(t), store = memorySessionStore(); let fail = true, calls = 0;
  const app = createApp({ url, sessionStore: store, ...(tier === 'web' ? { device: webDevice({ wasm, persist: memoryPersistence() }) } : {}), fetch: async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh') {
      calls++;
      if (fail) return mode === 'retryable-auth'
        ? Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'try again', retryable: true } }, { status: 503 })
        : Response.json(mode === 'empty' ? {} : { session: { token: 'incomplete' } });
    }
    return defaultFetch(input, init);
  } });
  t.after(() => app.close()); await app.ready; assert.equal((await app.auth.guest()).ok, true);
  const before = await store.get(sessionKey(url)), token = app.client.session().token;
  const result = await app.client.refreshSession(); assert.equal(result.ok, false);
  assert.equal(result.why.code, mode === 'retryable-auth' ? 'E_AUTH' : 'E_HTTP_RESPONSE');
  if (mode !== 'retryable-auth') assert.match(result.why.message, /HTTP 200.*session refresh/);
  assert.equal(app.auth.state, 'signed-in'); assert.equal(app.client.session().token, token);
  assert.equal(await store.get(sessionKey(url)), before, 'no claim or outcome metadata is written');
  assert.equal(calls, 1);
  fail = false; assert.equal((await app.client.refreshSession()).ok, true); assert.equal(calls, 2);
  assert.notEqual(app.client.session().token, token);
});
