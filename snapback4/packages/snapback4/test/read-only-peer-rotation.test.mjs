// @ref LLP 3000.033#3 — Round 3 real-server peer rotation and rejection interleavings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { signup, sessionKey } from '../dist/auth.js';
import { server, until } from './helpers/app-server.mjs';
const query = { kind: 'query', name: 'who' };
const password = 'review-read-only-password';
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
async function fixture(t, readOnly = true) {
  const { url } = await server(t, undefined, 'use identity\nquery who():\n  return viewer\n');
  const initial = await signup(url, 'bob@example.test', password, { scope: readOnly ? 'read' : 'full' });
  assert.equal(initial.ok, true);
  const key = sessionKey(url, readOnly), values = new Map([[key, JSON.stringify(initial.session)]]);
  const store = { async get(k) { return values.get(k) ?? null; }, async set(k, v) { values.set(k, v); }, async delete(k) { values.delete(k); } };
  const app = (options = {}) => {
    const result = createApp({ url, readOnly, sessionStore: store, ...options });
    t.after(() => result.close());
    return result;
  };
  const saved = () => JSON.parse(values.get(key) ?? 'null');
  const probe = async token => (await fetch(url + '/probe?scope=1', { headers: { authorization: `Bearer ${token}` } })).json();
  return { url, key, values, store, initial: initial.session, app, saved, probe };
}
async function signedOutRestart(f) {
  const restarted = f.app(); await restarted.ready;
  assert.equal(restarted.auth.state, 'signed-out');
  assert.equal(restarted.client.session(), null);
  assert.ok('denied' in await restarted.client.query(query, {}));
  assert.ok(f.saved().snapback4Logout);
  assert.equal(f.saved().token, undefined);
  assert.equal(f.saved().snapback4Successor, undefined);
}
for (const readOnly of [true, false]) {
  test(`logout after peer completed refresh; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
    const f = await fixture(t, readOnly), a = f.app(), b = f.app();
    await Promise.all([a.ready, b.ready]);
    const epoch = f.saved().snapback4Epoch ?? '0';
    const rotated = await b.client.refreshSession(); assert.equal(rotated.ok, true);
    await until(() => f.saved().token === rotated.session.token);
    assert.equal(f.saved().snapback4Epoch ?? '0', epoch);
    assert.equal((await a.auth.logout()).ok, true);
    await signedOutRestart(f);
    assert.ok(BigInt(f.saved().snapback4Logout) > BigInt(epoch));
    await until(async () => (await f.probe(rotated.session.token)).denied?.code === 'E_AUTH', 'successor retirement');
  });
  test(`peer refresh then logout fences a pending login; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
    const f = await fixture(t, readOnly), entered = defer(), release = defer();
    t.after(() => release.resolve());
    const a = f.app(), b = f.app({ fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname === '/auth/login') { entered.resolve(); await release.promise; }
      return response;
    } });
    await Promise.all([a.ready, b.ready]);
    const rotated = await b.client.refreshSession(); assert.equal(rotated.ok, true);
    await until(() => f.saved().token === rotated.session.token);
    const opening = b.auth.login('bob@example.test', password); await entered.promise;
    assert.equal((await a.auth.logout()).ok, true);
    release.resolve(); assert.equal((await opening).ok, false);
    await signedOutRestart(f);
  });
  for (const replacement of ['same principal, new epoch', 'different principal']) {
    test(`stale logout preserves replacement ${replacement}; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
      const f = await fixture(t, readOnly), a = f.app(), b = f.app();
      await Promise.all([a.ready, b.ready]);
      const opened = replacement === 'different principal'
        ? await b.auth.signup('alice@example.test', password) : await b.auth.login('bob@example.test', password);
      assert.equal(opened.ok, true);
      const saved = f.saved(); assert.ok(BigInt(saved.snapback4Epoch) > 0n);
      assert.equal((await a.auth.logout()).ok, true);
      assert.equal(f.saved().token, saved.token);
      assert.equal(f.saved().snapback4Epoch, saved.snapback4Epoch);
      const restarted = f.app(); assert.equal((await restarted.ready).ok, true);
      assert.equal((await restarted.client.query(query, {})).data, opened.session.principal);
      assert.equal((await f.probe(opened.session.token)).ok, true);
    });
  }
  test(`committed login stays successful across logout without public adoption; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
    const f = await fixture(t, readOnly), entered = defer(), release = defer();
    t.after(() => release.resolve()); f.values.clear();
    const set = f.store.set; let held = false;
    f.store.set = async (key, value) => {
      if (key === f.key && JSON.parse(value).token && !held) { held = true; entered.resolve(); await release.promise; }
      await set(key, value);
    };
    const app = f.app(); await app.ready;
    const login = app.auth.login('bob@example.test', password); await entered.promise;
    const logout = app.auth.logout(); release.resolve();
    assert.equal((await login).ok, true);
    assert.equal((await logout).ok, true);
    assert.equal(app.auth.state, 'signed-out'); assert.equal(app.client.session(), null);
    await signedOutRestart(f);
  });
}
test('a read peer recovers a completed refresh', { timeout: 15000 }, async t => {
  const f = await fixture(t), a = f.app(), b = f.app(); await Promise.all([a.ready, b.ready]);
  assert.equal((await a.client.refreshSession()).ok, true);
  assert.equal((await b.client.refreshSession()).ok, true);
  assert.equal((await b.client.query(query, {})).data, f.initial.principal);
});
for (const readOnly of [true, false]) {
  test(`ordinary peer query during rotation verification preserves successor; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
    const f = await fixture(t, readOnly), entered = defer(), release = defer();
    t.after(() => release.resolve()); let next, predecessorQueries = 0;
    const a = f.app({ fetch: async (input, init) => {
      const response = await fetch(input, init), path = new URL(input).pathname;
      if (path === '/auth/refresh' && response.ok) next = (await response.clone().json()).session;
      if (readOnly && path === '/probe' && new Headers(init?.headers).get('authorization') !== `Bearer ${f.initial.token}`) {
        entered.resolve(); await release.promise;
      }
      return response;
    } }), b = f.app({ fetch: async (input, init) => {
      if (new URL(input).pathname === '/q/who' && new Headers(init?.headers).get('authorization') === `Bearer ${f.initial.token}`) predecessorQueries++;
      return fetch(input, init);
    } });
    await Promise.all([a.ready, b.ready]);
    const epoch = f.saved().snapback4Epoch ?? '0';
    const rotation = a.client.refreshSession();
    if (readOnly) {
      await entered.promise;
      assert.equal(f.saved().token, f.initial.token);
      assert.equal(f.saved().snapback4Successor.token, next.token);
    } else { assert.equal((await rotation).ok, true); await until(() => f.saved().token === next.token); }
    const answer = await b.client.query(query, {});
    if (readOnly) {
      assert.equal(answer.data, f.initial.principal);
      assert.equal(predecessorQueries, 0, 'recover the receipt before dispatch with the consumed predecessor');
    }
    assert.equal(f.saved().token, next.token);
    assert.equal(f.saved().snapback4Epoch ?? '0', epoch);
    assert.equal((await f.probe(next.token)).ok, true);
    release.resolve(); assert.equal((await rotation).ok, true);
    const restarted = f.app(); assert.equal((await restarted.ready).ok, true);
    assert.equal((await restarted.client.query(query, {})).data, f.initial.principal);
  });
  test(`late predecessor rejection preserves pending or committed successor; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
    const f = await fixture(t, readOnly), queryEntered = defer(), queryRelease = defer(), probeEntered = defer(), probeRelease = defer();
    t.after(() => { queryRelease.resolve(); probeRelease.resolve(); }); let next;
    const a = f.app({ fetch: async (input, init) => {
      const response = await fetch(input, init), path = new URL(input).pathname;
      if (path === '/auth/refresh' && response.ok) next = (await response.clone().json()).session;
      if (readOnly && path === '/probe' && new Headers(init?.headers).get('authorization') !== `Bearer ${f.initial.token}`) {
        probeEntered.resolve(); await probeRelease.promise;
      }
      return response;
    } }), b = f.app({ fetch: async (input, init) => {
      if (new URL(input).pathname === '/q/who') { queryEntered.resolve(); await queryRelease.promise; }
      return fetch(input, init);
    } });
    await Promise.all([a.ready, b.ready]);
    const epoch = f.saved().snapback4Epoch ?? '0', reading = b.client.query(query, {}); await queryEntered.promise;
    const rotation = a.client.refreshSession();
    if (readOnly) await probeEntered.promise;
    else { assert.equal((await rotation).ok, true); await until(() => f.saved().token === next.token); }
    queryRelease.resolve(); assert.equal((await reading).denied.code, 'E_AUTH');
    await until(() => b.auth.state === 'signed-out', 'rejected peer cleanup');
    assert.equal(f.saved().snapback4Epoch ?? '0', epoch);
    assert.equal(readOnly ? f.saved().snapback4Successor?.token : f.saved().token, next.token);
    assert.equal((await f.probe(next.token)).ok, true);
    probeRelease.resolve(); assert.equal((await rotation).ok, true);
    const restarted = f.app(); assert.equal((await restarted.ready).ok, true);
    assert.equal((await restarted.client.query(query, {})).data, f.initial.principal);
  });
}

for (const readOnly of [true, false]) test(`malformed stored JSON is collected; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, readOnly); f.values.set(f.key, '{');
  const app = f.app(); assert.equal((await app.ready).ok, true);
  assert.equal(app.auth.state, 'signed-out'); assert.equal(f.values.has(f.key), false);
  const restart = f.app(); assert.equal((await restart.ready).ok, true);
  assert.equal(restart.auth.state, 'signed-out');
});

for (const readOnly of [true, false]) test(`logout honors the legacy committed epoch; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, readOnly); f.values.set(f.key + '.epoch', '7');
  const app = f.app(); assert.equal((await app.ready).ok, true);
  assert.equal((await app.auth.logout()).ok, true);
  await signedOutRestart(f); assert.equal(f.saved().snapback4Logout, '8');
});
test('logout owns two completed peer rotations without retaining a token lineage', { timeout: 15000 }, async t => {
  const f = await fixture(t), a = f.app(), b = f.app(); await Promise.all([a.ready, b.ready]);
  const first = await b.client.refreshSession(); assert.equal(first.ok, true);
  const second = await b.client.refreshSession(); assert.equal(second.ok, true);
  assert.notEqual(first.session.token, second.session.token);
  assert.equal((await a.auth.logout()).ok, true); await signedOutRestart(f);
  await until(async () => (await f.probe(second.session.token)).denied?.code === 'E_AUTH', 'second successor retirement');
});
