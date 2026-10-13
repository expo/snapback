import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.033#3 — Round 6: read credentials survive refresh attempts and restarts; obsolete sign-out watermarks are bounded.
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


// The Round 5/6 liveness failures required a consumed predecessor. Hold each
// boundary while peers ask to refresh: none can consume the read credential.
for (const boundary of ['read before dispatch', 'read response', 'restart probe', 'close waiting reader']) {
  for (const ordering of ['refresh first', 'peer first']) test(`no read rotation: ${boundary}, ${ordering}`, { timeout: 15000 }, async t => {
    const f = await fixture(t), entered = defer(), release = defer(), requests = [];
    t.after(() => release.resolve());
    const transport = async (input, init) => { requests.push(new URL(input).pathname); return fetch(input, init); };
    const a = f.app({ fetch: transport }), b = f.app({ fetch: transport });
    await Promise.all([a.ready, b.ready]);
    const saved = f.saved();
    const refuse = async client => assert.equal((await client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
    if (ordering === 'refresh first') await refuse(a.client);
    let peer = b, reading;
    if (boundary === 'restart probe') {
      await b.close();
      peer = f.app({ fetch: async (input, init) => {
        const response = await transport(input, init);
        if (new URL(input).pathname === '/probe') { entered.resolve(); await release.promise; }
        return response;
      } });
    } else {
      await b.close();
      peer = f.app({ fetch: async (input, init) => {
        const held = new URL(input).pathname === '/q/who';
        if (held && boundary === 'read before dispatch') { entered.resolve(); await release.promise; }
        const response = await transport(input, init);
        if (held && boundary !== 'read before dispatch') { entered.resolve(); await release.promise; }
        return response;
      } });
      await peer.ready; reading = peer.client.query(query, {});
    }
    await entered.promise;
    await refuse(a.client);
    // A third app must remain usable while another peer waits or restarts.
    const c = f.app({ fetch: transport }); assert.equal((await c.ready).ok, true);
    await refuse(c.client);
    assert.equal((await c.client.query(query, {})).data, f.initial.principal);
    if (boundary === 'close waiting reader') {
      await peer.close(); assert.ok('denied' in await reading); reading = undefined;
      peer = f.app({ fetch: transport }); assert.equal((await peer.ready).ok, true);
    }
    release.resolve(); assert.equal((await peer.ready).ok, true);
    assert.equal((await (reading ?? peer.client.query(query, {}))).data, f.initial.principal);
    await refuse(peer.client); await refuse(a.client);
    assert.equal((await a.client.query(query, {})).data, f.initial.principal);
    assert.equal(peer.auth.state, 'signed-in'); assert.equal(a.auth.state, 'signed-in');
    assert.equal(f.saved().token, saved.token); assert.equal(f.saved().snapback4Epoch, saved.snapback4Epoch);
    assert.equal(f.saved().snapback4Successor, undefined);
    assert.equal((await f.probe(saved.token)).ok, true);
    assert.ok(!requests.includes('/auth/refresh'));
  });
}

for (const caller of ['waiting peer', 'third app']) test(`logout cancels a held read after refresh refusal: ${caller}`, { timeout: 15000 }, async t => {
  const f = await fixture(t), entered = defer(), release = defer(), requests = [];
  t.after(() => release.resolve());
  const transport = async (input, init) => { requests.push(new URL(input).pathname); return fetch(input, init); };
  const a = f.app({ fetch: transport }), b = f.app({ fetch: async (input, init) => {
    const response = await transport(input, init);
    if (new URL(input).pathname === '/q/who') { entered.resolve(); await release.promise; }
    return response;
  } }), c = f.app({ fetch: transport });
  await Promise.all([a.ready, b.ready, c.ready]);
  const reading = b.client.query(query, {}); await entered.promise;
  assert.equal((await a.client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  const logout = (caller === 'waiting peer' ? b : c).auth.logout();
  // The read remains held until after logout: completion proves independence.
  assert.equal((await logout).ok, true);
  await signedOutRestart(f);
  release.resolve(); assert.ok('denied' in await reading);
  await until(async () => (await f.probe(f.initial.token)).denied?.code === 'E_AUTH');
  assert.ok(!requests.includes('/auth/refresh'));
});

for (const readOnly of [true, false]) test(`24 account switches bound sign-out watermarks; readOnly=${readOnly}`, { timeout: hangBudget(24) }, async t => {
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
    const refreshed = await active.client.refreshSession();
    if (readOnly) assert.equal(refreshed.why.code, 'E_READ_ONLY_REFRESH'); else assert.equal(refreshed.ok, true);
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
