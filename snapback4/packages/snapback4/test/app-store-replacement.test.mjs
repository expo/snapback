import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../dist/app.js';
import { keepSession, memorySessionStore, restoreSession } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { storeKey } from '../dist/app-storage.js';
import { WRITE_HISTORY_LIMIT } from '../dist/writes.js';
const url = 'http://store.test', q = { kind: 'query', name: 'page' }, m = { kind: 'mutation', name: 'revoke' };
const until = async check => { for (let n = 0; n < 600; n++) { if (await check()) return; await delay(5); } assert.fail('app recovery did not settle'); };
const session = { principal: 'alice', token: 'alice-token', kind: 'guest', expiresAt: Date.now() + 30 * 86400_000 };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error('closed')); else signal.addEventListener('abort', () => reject(Error('closed')), { once: true }); });

for (const accepted of [true, false]) test(`online app reopens after replacement; replacement accepts session: ${accepted}`, async t => {
  const storage = memorySessionStore();
  let releaseAdmission, heldAdmission = false;
  const admitted = new Promise(resolve => { releaseAdmission = resolve; });
  const sessionStore = { ...storage, async set(key, value) {
    await storage.set(key, value);
    if (!heldAdmission && key === storeKey('writes', url, 'alice') && JSON.parse(value).pending.length === 2) {
      heldAdmission = true; await admitted;
    }
  } };
  await keepSession(url, session, sessionStore);
  let store = 'A', posts = 0, probes = 0; const states = [];
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') {
      probes++; assert.equal(init.headers.authorization, 'Bearer alice-token');
      return Response.json(accepted ? { ok: true, store_id: 'B', seq: 1 } : { denied: { code: 'E_AUTH', message: 'unknown session' } }, { status: accepted ? 200 : 401 });
    }
    if (path === '/auth/logout') return Response.json({ ok: true });
    if (path.startsWith('/changes')) return blocked(init.signal);
    if (path.startsWith('/m/')) { posts++; return blocked(init.signal); }
    assert.equal(path, '/q/page');
    return Response.json({ data: [store], seq: 1, store_id: store, complete: true });
  };
  let app = createApp({ url, sessionStore, fetch: fetcher });
  t.after(async () => { releaseAdmission(); await app.close(); });
  await app.ready;
  const prior = app.client, watch = prior.observe(q, {});
  await until(() => watch.getSnapshot().data?.[0] === 'A');
  app.auth.onChange(() => states.push([app.auth.state, app.client]));
  const ids = [mintId(), mintId()];
  const writes = ids.map(id => app.mutate(m, {}, { id }));
  await until(() => posts === 1 && heldAdmission);
  store = 'B'; assert.equal((await prior.query(q, {})).denied.code, 'E_STORE_REPLACED');
  assert.equal(app.auth.state, 'restoring');
  releaseAdmission(); // The second write was admitted durably but never reached the raw client.
  for (const result of await Promise.all(writes)) { assert.equal(result.state, 'failed'); assert.equal(result.why.code, 'E_STORE_REPLACED'); }
  await until(() => probes === 1 && app.auth.state === (accepted ? 'signed-in' : 'signed-out'));
  assert.notEqual(app.client, prior); assert.equal(watch.getSnapshot().denied.code, 'E_STORE_REPLACED');
  assert.ok(states.some(([state]) => state === 'restoring'));
  const journal = JSON.parse(await sessionStore.get(storeKey('writes', url, 'alice')));
  assert.deepEqual(journal.pending, []);
  for (const id of ids) assert.equal(journal.receipts.find(write => write.id === id).why.code, 'E_STORE_REPLACED');
  assert.equal(posts, 1, 'the queued intent never reaches either backend');
  if (accepted) {
    assert.equal(app.client.session().token, session.token);
    assert.deepEqual((await app.client.query(q, {})).data, ['B']);
    assert.equal((await restoreSession(url, sessionStore)).token, session.token);
    assert.equal((await app.mutate(m, {}, { id: ids[0] })).why.code, 'E_STORE_REPLACED', 'a failed unknown outcome is not replayed by id');
    await app.close();
    app = createApp({ url, sessionStore, fetch: fetcher }); await app.ready;
    assert.equal(posts, 1, 'a later restart does not revive the retired queue');
  } else {
    assert.equal(await restoreSession(url, sessionStore), null);
    assert.equal(app.auth.viewer, null);
    assert.equal((await app.client.query(q, {})).denied.code, 'E_AUTH');
  }
});

for (const end of ['logout', 'close', 'login']) test(`${end} cancels replacement verification without restoring the old account`, async t => {
  const sessionStore = memorySessionStore(); await keepSession(url, session, sessionStore);
  let store = 'A', probing = false, aborted = false;
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') {
      probing = true;
      try { return await blocked(init.signal); } finally { aborted = true; }
    }
    if (path === '/auth/login') return Response.json({ session: { ...session, principal: 'bob', token: 'bob-token' } });
    if (path === '/auth/logout') return Response.json({ ok: true });
    return Response.json({ data: [], seq: 1, store_id: store });
  } });
  t.after(() => app.close()); await app.ready;
  await app.client.query(q, {}); store = 'B'; await app.client.query(q, {});
  await until(() => probing);
  await Promise.race([end === 'logout' ? app.auth.logout() : end === 'login' ? app.auth.login('bob@example.com', 'password') : app.close(),
    delay(1000).then(() => assert.fail('auth operation stayed queued behind replacement probe'))]);
  await until(() => aborted);
  assert.equal(app.auth.state, end === 'login' ? 'signed-in' : 'signed-out');
  assert.equal(app.auth.viewer, end === 'login' ? 'bob' : null);
});

for (const fail of [false, true]) test(`replacement waits for durable retirement of admitted writes; persistence fails: ${fail}`, async t => {
  const storage = memorySessionStore(), key = storeKey('writes', url, 'alice');
  let releaseAdmission, releaseRetirement, heldAdmission = false, heldRetirement = false, replacing = false;
  const admission = new Promise(resolve => { releaseAdmission = resolve; });
  const retirement = new Promise(resolve => { releaseRetirement = resolve; });
  const sessionStore = { ...storage, async set(k, value) {
    if (k === key) {
      const next = JSON.parse(value);
      if (replacing && next.receipts.some(write => write.why?.code === 'E_STORE_REPLACED')) {
        heldRetirement = true; await retirement;
        if (fail) throw Error('retirement storage failed');
      }
      await storage.set(k, value);
      if (!heldAdmission && next.pending.length === 2) { heldAdmission = true; await admission; }
    } else await storage.set(k, value);
  } };
  await keepSession(url, session, sessionStore);
  let store = 'A', posts = 0, app;
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') return Response.json({ ok: true, store_id: store, seq: 1 });
    if (path.startsWith('/m/')) { posts++; return blocked(init.signal); }
    return Response.json({ data: [], store_id: store, seq: 1 });
  };
  app = createApp({ url, sessionStore, fetch: fetcher });
  t.after(async () => { releaseAdmission(); releaseRetirement(); await app.close(); });
  await app.ready; const prior = app.client; await prior.query(q, {});
  const ids = [mintId(), mintId()], results = [];
  const submitted = ids.map(id => app.mutate(m, {}, { id }).then(write => { results.push(write); return write; }));
  await until(() => heldAdmission && posts === 1);
  replacing = true; store = 'B';
  assert.equal((await prior.query(q, {})).denied.code, 'E_STORE_REPLACED');
  assert.equal(app.auth.state, 'restoring');
  releaseAdmission(); await until(() => heldRetirement);
  const repeated = prior.mutate(m, {}, { id: ids[0] }).then(write => { results.push(write); return write; });
  await delay(20);
  assert.deepEqual(results, [], 'neither dispatch, admission, nor repeated-id return may outrun retirement');
  assert.deepEqual(JSON.parse(await storage.get(key)).pending.map(write => write.id), ids);
  releaseRetirement(); await Promise.all([...submitted, repeated]);
  const journal = JSON.parse(await storage.get(key));
  for (const write of results) assert.equal(write.state, fail ? 'pending' : 'failed');
  if (fail) {
    assert.deepEqual(journal.pending.map(write => write.id), ids);
    assert.equal(journal.receipts.length, 0, 'failed persistence must leave the outcome pending');
  } else {
    assert.deepEqual(journal.pending, []);
    for (const id of ids) assert.equal(journal.receipts.find(write => write.id === id).why.code, 'E_STORE_REPLACED');
    await until(() => app.auth.state === 'signed-in');
    await app.close(); app = createApp({ url, sessionStore, fetch: fetcher }); await app.ready;
    assert.equal(posts, 1, 'a terminal durable intent never replays on the replacement');
  }
});

for (const unknown of [0, 8]) test(`replacement preserves sent receipt ids at the history limit (${unknown} older unknown failures)`, async t => {
  const sessionStore = memorySessionStore(), key = storeKey('writes', url, 'alice');
  await keepSession(url, session, sessionStore);
  const id = n => String(n).padStart(26, '0');
  const sent = Array.from({ length: WRITE_HISTORY_LIMIT - unknown }, (_, i) => ({ state: 'sent', id: id(i + 1), seq: i + 1, replayed: true }));
  const failures = Array.from({ length: unknown }, (_, i) => ({ state: 'failed', id: id(500 + i), why: { code: 'E_STORE_RESTORE', family: 'store', message: 'unknown outcome' } }));
  const pending = Array.from({ length: 4 }, (_, i) => ({ owner: 'alice', id: id(1000 + i), op: m.name, args: {} }));
  await sessionStore.set(key, JSON.stringify({ owner: 'alice', backend: url, receipts: [...sent, ...failures], pending }));
  let store = 'A', posts = 0;
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') return Response.json({ ok: true });
    if (path.startsWith('/m/')) { posts++; return blocked(init.signal); }
    return Response.json({ data: [], store_id: store, seq: 1 });
  } });
  t.after(() => app.close()); await app.ready; const prior = app.client;
  await until(() => posts === 1); await prior.query(q, {});
  store = 'B'; assert.equal((await prior.query(q, {})).denied.code, 'E_STORE_REPLACED');
  await until(() => app.auth.state === 'signed-in' && app.client !== prior);
  const journal = JSON.parse(await sessionStore.get(key));
  assert.deepEqual(journal.pending, []); assert.equal(journal.receipts.length, WRITE_HISTORY_LIMIT);
  assert.deepEqual(journal.receipts.filter(write => write.state === 'sent'), sent);
  if (unknown) assert.ok(failures.slice(0, 4).every(f => !journal.receipts.some(r => r.id === f.id)), 'oldest unknown outcomes leave first');
  const result = await app.mutate(m, {}, { id: sent[0].id });
  assert.equal(result.state, 'sent'); assert.equal(result.replayed, true); assert.equal(result.seq, 1);
  assert.equal(posts, 1, 'retrying a known sent id never executes on the replacement store');
});
