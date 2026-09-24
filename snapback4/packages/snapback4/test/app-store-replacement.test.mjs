import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../dist/app.js';
import { keepSession, memorySessionStore, restoreSession } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { storeKey } from '../dist/app-storage.js';
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

for (const end of ['logout', 'close']) test(`${end} cancels replacement verification without restoring the account`, async t => {
  const sessionStore = memorySessionStore(); await keepSession(url, session, sessionStore);
  let store = 'A', probing = false, aborted = false;
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/probe') {
      probing = true;
      try { return await blocked(init.signal); } finally { aborted = true; }
    }
    if (path === '/auth/logout') return Response.json({ ok: true });
    return Response.json({ data: [], seq: 1, store_id: store });
  } });
  t.after(() => app.close()); await app.ready;
  await app.client.query(q, {}); store = 'B'; await app.client.query(q, {});
  await until(() => probing);
  await (end === 'logout' ? app.auth.logout() : app.close());
  await until(() => aborted);
  assert.equal(app.auth.state, 'signed-out'); assert.equal(app.auth.viewer, null);
});
