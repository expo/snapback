// @ref LLP 3000.033#3 — Round 5: rejected peer reads wait for rotation custody; obsolete sign-out watermarks are bounded.
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
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


for (const timing of ['after refresh consumes predecessor', 'read dispatched before refresh']) {
  test(`peer read recovers held refresh: ${timing}`, { timeout: 15000 }, async t => {
    const f = await fixture(t), entered = defer(), release = defer(), readEntered = defer(), readRelease = defer(), rejected = defer();
    t.after(() => { release.resolve(); readRelease.resolve(); });
    let next, predecessorReads = 0;
    const a = f.app({ fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname === '/auth/refresh') {
        next = (await response.clone().json()).session;
        entered.resolve(); await release.promise;
      }
      return response;
    } }), b = f.app({ fetch: async (input, init) => {
      const predecessor = new URL(input).pathname === '/q/who' && new Headers(init?.headers).get('authorization') === `Bearer ${f.initial.token}`;
      if (predecessor) {
        predecessorReads++; readEntered.resolve();
        if (timing === 'read dispatched before refresh') await readRelease.promise;
      }
      const response = await fetch(input, init);
      if (predecessor) { assert.equal((await response.clone().json()).denied.code, 'E_AUTH'); rejected.resolve(); }
      return response;
    } }), c = f.app();
    await Promise.all([a.ready, b.ready, c.ready]);
    const epoch = f.saved().snapback4Epoch ?? '0';
    let reading;
    if (timing === 'read dispatched before refresh') { reading = b.client.query(query, {}); await readEntered.promise; }
    const rotating = a.client.refreshSession(); await entered.promise;
    if (!reading) reading = b.client.query(query, {});
    readRelease.resolve(); await rejected.promise;
    assert.equal(await Promise.race([reading.then(() => 'settled'), delay(100).then(() => 'waiting')]), 'waiting');
    assert.equal(f.saved().token, f.initial.token);
    assert.equal(f.saved().snapback4Successor, undefined, 'owner has not received its response');
    release.resolve();
    assert.equal((await rotating).ok, true);
    assert.equal((await reading).data, f.initial.principal);
    assert.equal(predecessorReads, 1);
    assert.equal(b.auth.state, 'signed-in');
    assert.equal(b.client.session().token, next.token);
    assert.equal(f.saved().token, next.token);
    assert.equal(f.saved().snapback4Epoch, epoch);
    assert.equal(f.saved().snapback4Logout, undefined);
    assert.equal((await c.client.query(query, {})).data, f.initial.principal);
    const restart = f.app(); assert.equal((await restart.ready).ok, true);
    assert.equal(restart.auth.state, 'signed-in');
    assert.equal((await restart.client.query(query, {})).data, f.initial.principal);
  });
}

for (const caller of ['waiting peer', 'third app']) test(`logout bypasses rejected read waiting for rotation: ${caller}`, { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = defer(), release = defer(), rejected = defer(); let next;
  t.after(() => release.resolve());
  const a = f.app({ fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/auth/refresh') { next = (await response.clone().json()).session; entered.resolve(); await release.promise; }
    return response;
  } }), b = f.app({ fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/q/who') { assert.equal((await response.clone().json()).denied.code, 'E_AUTH'); rejected.resolve(); }
    return response;
  } }), c = f.app();
  await Promise.all([a.ready, b.ready, c.ready]);
  const rotating = a.client.refreshSession(); await entered.promise;
  const reading = b.client.query(query, {}); await rejected.promise;
  assert.equal(await Promise.race([reading.then(() => 'settled'), delay(100).then(() => 'waiting')]), 'waiting');
  const logout = (caller === 'waiting peer' ? b : c).auth.logout();
  assert.equal((await Promise.race([logout, delay(500).then(() => ({ ok: false }))])).ok, true, 'logout must not wait for rotation or its waiting peer');
  await signedOutRestart(f);
  release.resolve(); assert.equal((await rotating).ok, false);
  assert.ok('denied' in await reading);
  await signedOutRestart(f);
  await until(async () => (await f.probe(next.token)).denied?.code === 'E_AUTH', 'late successor retirement');
});

for (const readOnly of [true, false]) test(`24 account switches bound sign-out watermarks; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, readOnly), active = f.app(); await active.ready;
  for (let i = 0; i < 24; i++) {
    const stale = f.app(); await stale.ready;
    const prior = f.saved().principal, epoch = f.saved().snapback4Epoch ?? '0';
    assert.equal((await active.auth.signup(`account${i}@example.test`, password)).ok, true);
    assert.ok(BigInt(f.saved().snapback4Epoch) > BigInt(epoch));
    assert.deepEqual(f.saved().snapback4SignOuts ?? {}, {}, 'replacement discards older epochs');
    await stale.auth.logout(); await stale.close();
    assert.deepEqual(f.saved().snapback4SignOuts, { [prior]: 1 }, `bounded after switch ${i + 1}`);
    const currentEpoch = f.saved().snapback4Epoch;
    assert.equal((await active.client.refreshSession()).ok, true);
    await until(() => f.saved().token === active.client.session().token);
    assert.equal(f.saved().snapback4Epoch, currentEpoch);
    assert.deepEqual(f.saved().snapback4SignOuts, { [prior]: 1 }, 'same-epoch rotation retains the fence');
  }
  const last = f.saved().principal;
  await active.auth.logout();
  assert.deepEqual(f.saved().snapback4SignOuts ?? {}, {}, 'logout advances the epoch');
  assert.equal((await active.auth.login('account23@example.test', password)).ok, true);
  assert.equal(f.saved().principal, last);
  assert.deepEqual(f.saved().snapback4SignOuts ?? {}, {});
});
