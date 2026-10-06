// @ref LLP 3000.033#3 — permanent regressions from the blind code-review reproductions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { sessionKey } from '../dist/auth.js';
import { waitFor } from './helpers/wait.mjs';
const url = 'https://read-custody.invalid', key = sessionKey(url, true);
const query = { kind: 'query', name: 'secret' };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const session = (who, token = `ro.${who}`) => ({ token, principal: who, kind: 'user', scope: 'read', expiresAt: Date.now() + 86400000, capExpiresAt: Date.now() + 86400000 });
function storage(initial) {
  const values = new Map(initial ? [[key, JSON.stringify(initial)]] : []);
  return { values, async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
}
function fetcher(input, init) {
  const path = new URL(input).pathname, token = init?.headers?.authorization?.slice(7), who = token?.slice(3);
  if (path === '/auth/login') return Promise.resolve(Response.json({ session: session(JSON.parse(init.body).email.split('@')[0]) }));
  if (path === '/probe') return Promise.resolve(Response.json({ ok: true, scope: 'read', viewer: who, store_id: 'test', seq: 0 }));
  if (path === '/q/secret') return Promise.resolve(Response.json({ data: `${who}-secret`, complete: true, seq: 0, store_id: 'test' }));
  if (path === '/changes') return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('aborted'));
    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.resolve(Response.json({ ok: true }));
}
test('logout fences a login held inside persistence and restart stays signed out', async t => {
  const store = storage(), entered = deferred(), release = deferred();
  const write = store.set;
  store.set = async (...args) => { entered.resolve(); await release.promise; await write(...args); };
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: fetcher });
  t.after(() => app.close());
  await app.ready;
  const login = app.auth.login('bob@example.test', 'password');
  await entered.promise;
  const logout = app.auth.logout();
  release.resolve();
  await login; // A completed durable commit keeps its result; logout still fences its public adoption.
  assert.equal((await logout).ok, true);
  assert.equal(app.auth.state, 'signed-out');
  assert.equal(JSON.parse(store.values.get(key) ?? 'null')?.token, undefined);
  assert.equal(app.client.session(), null);
  await app.close();
  const restarted = createApp({ url, readOnly: true, sessionStore: store, fetch: fetcher });
  t.after(() => restarted.close());
  await restarted.ready;
  assert.equal(restarted.auth.state, 'signed-out');
  assert.ok('denied' in await restarted.client.query(query, {}));
});
test('account mismatch permanently withdraws old observations and bearer without deleting the new account', async t => {
  const store = storage(session('bob'));
  const bob = createApp({ url, readOnly: true, sessionStore: store, fetch: fetcher });
  t.after(() => bob.close()); await bob.ready;
  const old = bob.client, watch = old.observe(query, {}), stop = watch.subscribe(() => {});
  t.after(() => { stop(); watch.close(); });
  await waitFor(() => watch.getSnapshot().data === 'bob-secret');
  const alice = createApp({ url, readOnly: true, sessionStore: store, fetch: fetcher });
  t.after(() => alice.close()); await alice.ready;
  assert.equal((await alice.auth.login('alice@example.test', 'password')).ok, true);
  assert.equal((await old.query(query, {})).denied.code, 'E_AUTH');
  await waitFor(() => bob.auth.state === 'signed-out');
  assert.ok('denied' in watch.getSnapshot());
  assert.deepEqual(old.assetSource('secret'), { uri: '', headers: {} });
  assert.equal(old.session(), null); assert.equal(old.viewer(), null); assert.equal(old.link(), 'signed-out');
  assert.equal(JSON.parse(store.values.get(key)).principal, 'alice');
  // Even restoring the same token cannot revive a facade whose custody ended.
  const aliceValue = store.values.get(key);
  await store.set(key, JSON.stringify(session('bob')));
  assert.equal((await old.query(query, {})).denied.code, 'E_AUTH');
  assert.ok('denied' in watch.getSnapshot());
  await store.set(key, aliceValue);
  await bob.auth.logout();
  assert.equal(JSON.parse(store.values.get(key)).principal, 'alice');
});
test('successor verification recovers private custody, persists once and authenticates after restart', async t => {
  const store = storage(session('bob', 'ro.old')), recovered = deferred(), entered = deferred();
  const persisting = deferred(), persisted = deferred();
  t.after(() => { recovered.resolve(); persisted.resolve(); });
  let live = 'ro.old', fail = true, hold = true, writes = 0, queries = 0;
  const write = store.set;
  store.set = async (...args) => { if (++writes === 2) { persisting.resolve(); await persisted.promise; } await write(...args); };
  const transport = async (input, init) => {
    const path = new URL(input).pathname, token = init.headers.authorization.slice(7);
    if (path.startsWith("/q/")) queries++;
    if (token !== live) return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'not live' } }, { status: 401 });
    if (path === '/auth/refresh') { live = 'ro.next'; return Response.json({ session: session('bob', live) }); }
    if (path === '/probe' && live === 'ro.next') {
      if (fail) { fail = false; throw Error('temporary outage after rotation'); }
      if (hold) { entered.resolve(); await recovered.promise; }
    }
    if (path === "/probe") return Response.json({ ok: true, scope: "read", viewer: "bob", store_id: "test", seq: 0 });
    return fetcher(input, init);
  };
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(() => app.close()); await app.ready;
  const events = []; app.client.onSession(s => events.push(s?.token));
  assert.equal((await app.client.refreshSession()).ok, false);
  assert.equal(app.client.session(), null, 'unverified successor stays private');
  assert.deepEqual(app.client.assetSource('secret'), { uri: '', headers: {} });
  assert.equal(JSON.parse(store.values.get(key)).token, 'ro.old');
  const read = app.client.query(query, {}); await entered.promise;
  assert.deepEqual(app.client.assetSource('secret'), { uri: '', headers: {} });
  hold = false; recovered.resolve();
  await persisting.promise;
  assert.equal(app.client.session(), null, 'verified successor stays private until persisted');
  assert.deepEqual(app.client.assetSource('secret'), { uri: '', headers: {} });
  assert.deepEqual(events, []);
  assert.equal(queries, 0, 'public transport is gated through persistence');
  persisted.resolve();
  assert.ok('data' in await read);
  assert.equal(app.client.session().token, 'ro.next');
  assert.equal(JSON.parse(store.values.get(key)).token, 'ro.next');
  assert.deepEqual(events, ['ro.next']);
  assert.equal(writes, 2, 'restore and successor each persist once');
  await app.close();
  const restarted = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(() => restarted.close());
  assert.equal((await restarted.ready).ok, true);
  assert.equal(restarted.auth.state, 'signed-in');
  assert.ok('data' in await restarted.client.query(query, {}));
});

test('consumed predecessors leave custody after each persisted successor', async t => {
  const original = session('bob', 'ro.0'), store = storage(original);
  let sequence = 0;
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') return Response.json({ session: session('bob', `ro.${++sequence}`) });
    if (path === '/probe') return Response.json({ ok: true, scope: 'read', viewer: 'bob', store_id: 'test', seq: 0 });
    return fetcher(input, init);
  } });
  t.after(() => app.close()); await app.ready;
  // Callback work can itself await the client; notification must not hold rotation.
  const notifications = [];
  app.client.onSession(async next => { if (next) notifications.push(await app.client.query(query, {})); });
  for (let i = 1; i <= 32; i++) {
    assert.equal((await app.client.refreshSession()).ok, true);
    assert.equal(JSON.parse(store.values.get(key)).token, `ro.${i}`);
  }
  await waitFor(() => notifications.length === 32);
  // A peer restoring a consumed predecessor no longer matches our deletion authority.
  await store.set(key, JSON.stringify(original));
  await app.auth.logout();
  assert.equal(JSON.parse(store.values.get(key)).token, original.token);
});
