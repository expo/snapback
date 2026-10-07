// @ref LLP 3000.033#3 — Round 4 review reproductions: credential spelling and retirement during held network work.
import test from 'node:test';
import { createClient } from '../dist/client.js';
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

for (const caller of ["self", "peer"]) test(`full-session logout must complete while ${caller} refresh response is held`, {timeout: 10000}, async t => {
 const f=await fixture(t,false), entered=defer(), release=defer(); let next;
 t.after(()=>release.resolve());
 const a=f.app({fetch:async(input,init)=>{
   const r=await fetch(input,init);
   if(new URL(input).pathname==='/auth/refresh') { next=(await r.clone().json()).session; entered.resolve(); await release.promise; }
   return r;
 }}), b=f.app(), c=f.app();
 await Promise.all([a.ready,b.ready,c.ready]);
 const rotating=a.client.refreshSession(); await entered.promise;
 const logout=(caller === "self" ? a : b).auth.logout();
 const result=await Promise.race([logout,delay(500).then(()=>'blocked-on-network')]);
 const saved=f.saved();
 release.resolve(); await Promise.all([rotating,logout]);
 await signedOutRestart(f);
 await until(async()=> (await f.probe(next.token)).denied?.code==='E_AUTH','late successor retired');
 assert.notEqual(result,'blocked-on-network','local logout waits for the remote refresh response');
 assert.ok(saved.snapback4Logout,'local logout must durably fence before the held refresh returns');
});

test('three read apps refuse refresh and share the original credential until logout', { timeout: 10000 }, async t => {
  const f = await fixture(t), requests = [];
  const fetcher = async (input, init) => { requests.push(new URL(input).pathname); return fetch(input, init); };
  const apps = [f.app({ fetch: fetcher }), f.app({ fetch: fetcher }), f.app({ fetch: fetcher })];
  await Promise.all(apps.map(a => a.ready));
  for (const a of apps) {
    assert.equal((await a.client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
    assert.equal((await a.client.query(query, {})).data, f.initial.principal);
    assert.equal(a.client.session().token, f.initial.token);
  }
  assert.equal((await apps[2].auth.logout()).ok, true);
  await signedOutRestart(f);
  await until(async () => (await f.probe(f.initial.token)).denied?.code === 'E_AUTH');
  assert.ok(!requests.includes('/auth/refresh'));
});

for (const readOnly of [true, false]) for (const held of [true, false]) {
  test(`raw signOut after a refresh attempt; readOnly=${readOnly}, held=${held}`, { timeout: 10000 }, async t => {
    const f = await fixture(t, readOnly), entered = defer(), release = defer();
    t.after(() => release.resolve());
    let next;
    const sent = [];
    const client = createClient({ url: f.url, readOnly, session: f.initial, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      sent.push(path);
      // signOut intentionally does not await the response. A probe may see
      // revocation before that response returns, so record dispatch first.
      const response = await fetch(input, init);
      if (path === '/auth/refresh') {
        next = (await response.clone().json()).session;
        if (!readOnly && held) { entered.resolve(); await release.promise; }
      }
      return response;
    } });
    t.after(() => client.close());
    assert.equal((await client.query(query, {})).data, f.initial.principal);
    const rotating = client.refreshSession();
    if (readOnly) {
      assert.equal((await rotating).why.code, 'E_READ_ONLY_REFRESH');
      assert.equal(client.session().token, f.initial.token); next = f.initial;
    } else if (held) await entered.promise;
    else assert.equal((await rotating).ok, true);
    await client.signOut();
    release.resolve(); await rotating;
    await until(async () => (await f.probe(next.token)).denied?.code === 'E_AUTH', 'raw successor logout');
    assert.ok(sent.includes('/auth/logout'));
    if (readOnly) assert.ok(!sent.includes('/auth/refresh'));
    assert.equal(client.session(), null);
    assert.ok('denied' in await client.query(query, {}));
  });
}

for (const readOnly of [true, false]) test(`bearer spelling and whitespace guard every door; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, readOnly);
  for (const scheme of ['Bearer', 'bearer', 'BEARER', 'bEaReR']) {
    for (const [prefix, between, suffix] of [['', ' ', ''], ['', '   ', ''], ['', '\t', ''], [' \t', ' \t ', '\t ']]) {
      const authorization = `${prefix}${scheme}${between}${f.initial.token}${suffix}`;
      const probe = await (await fetch(f.url + '/probe?scope=1', { headers: { authorization } })).json();
      assert.equal(probe.ok, true, JSON.stringify(authorization));
      assert.equal(probe.scope, readOnly ? 'read' : 'full');
      const answer = await (await fetch(f.url + '/q/who', { method: 'POST', headers: { authorization }, body: '{"args":{}}' })).json();
      assert.equal(answer.data, f.initial.principal);
      // Original dev-clock reproduction and a public sign-in write variation.
      for (const [path, body] of [['/dev/clock/advance', '{"duration":"+1m"}'], ['/auth/guest', '{}']]) {
        const response = await fetch(f.url + path, { method: 'POST', headers: { authorization }, body });
        const result = await response.json();
        assert.equal(response.status, readOnly ? 403 : 200, `${path}: ${JSON.stringify(authorization)}`);
        if (readOnly) {
          assert.equal(result.denied.code, 'E_READ_ONLY');
          assert.equal(result.head, undefined); assert.equal(result.store_id, undefined);
        }
      }
    }
  }
  // The auth helper parses the same spelling as the guard and principal resolver.
  const rotated = await (await fetch(f.url + '/auth/refresh', { method: 'POST', headers: { authorization: `bEaReR\t ${f.initial.token}` }, body: '{}' })).json();
  assert.ok(rotated.session);
  const ended = await (await fetch(f.url + '/auth/logout', { method: 'POST', headers: { authorization: `BEARER   ${rotated.session.token}` }, body: '{}' })).json();
  assert.equal(ended.ok, true);
  assert.equal((await f.probe(rotated.session.token)).denied.code, 'E_AUTH');
});

test('malformed and invalid credentials cannot become anonymous dev writes', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  for (const authorization of ['', 'Bearer', 'Bearer ', `Basic ${f.initial.token}`, `Bearer${f.initial.token}`, `Bearer ${f.initial.token} extra`, 'bearer invalid', 'BEARER ro.invalid']) {
    for (const path of ['/dev/clock/advance', '/auth/guest']) {
      const response = await fetch(f.url + path, { method: 'POST', headers: { authorization }, body: '{"duration":"+1m"}' });
      assert.equal(response.status, 401, `${path}: ${authorization}`);
      assert.equal((await response.json()).denied.code, 'E_AUTH');
    }
  }
  const response = await fetch(f.url + '/dev/clock/advance', { method: 'POST', body: '{"duration":"+1m"}' });
  assert.equal(response.status, 200, 'the unauthenticated dev door remains available');
});

for (const readOnly of [true, false]) test(`stale Bob logout fences another Bob login after an epoch change; readOnly=${readOnly}`, { timeout: 10000 }, async t => {
  const f = await fixture(t, readOnly), entered = defer(), release = defer();
  t.after(() => release.resolve());
  const a = f.app(), b = f.app(); await Promise.all([a.ready, b.ready]);
  const newer = await b.auth.login('bob@example.test', password); assert.equal(newer.ok, true);
  let pending;
  const c = f.app({ fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/auth/login') { pending = (await response.clone().json()).session; entered.resolve(); await release.promise; }
    return response;
  } });
  await c.ready;
  const signingIn = c.auth.login('bob@example.test', password); await entered.promise;
  assert.equal((await a.auth.logout()).ok, true);
  await signedOutRestart(f);
  release.resolve(); assert.equal((await signingIn).ok, false);
  await signedOutRestart(f);
  for (const token of [newer.session.token, pending.token]) await until(async () => (await f.probe(token)).denied?.code === 'E_AUTH');
});

for (const readOnly of [true, false]) test(`Bob logout preserves Alice and fences Bob's in-flight return; readOnly=${readOnly}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, readOnly), entered = defer(), release = defer();
  t.after(() => release.resolve());
  const stale = f.app(), peer = f.app(); await Promise.all([stale.ready, peer.ready]);
  const facade = stale.client;
  const alice = await peer.auth.signup('alice@example.test', password); assert.equal(alice.ok, true);
  let pending;
  const returning = f.app({ fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/auth/login') { pending = (await response.clone().json()).session; entered.resolve(); await release.promise; }
    return response;
  } });
  await returning.ready;
  const login = returning.auth.login('bob@example.test', password); await entered.promise;
  await facade.signOut();
  assert.equal(f.saved().token, alice.session.token);
  // A current account's rotation must carry the sign-out watermark forward.
  const rotated = await peer.client.refreshSession();
  if (readOnly) assert.equal(rotated.why.code, 'E_READ_ONLY_REFRESH'); else assert.equal(rotated.ok, true);
  const kept = readOnly ? alice.session : rotated.session;
  await until(() => f.saved().token === kept.token);
  release.resolve(); assert.equal((await login).ok, false);
  await until(async () => (await f.probe(pending.token)).denied?.code === 'E_AUTH');
  const restart = f.app(); assert.equal((await restart.ready).ok, true);
  assert.equal((await restart.client.query(query, {})).data, alice.session.principal);
  assert.equal((await f.probe(kept.token)).ok, true);
  assert.equal((await restart.auth.login('bob@example.test', password)).ok, true, 'a deliberately started login after logout is allowed');
});
