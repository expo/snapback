import { waitFor as awaitState } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { keepSession, memorySessionStore, restoreSession } from '../dist/auth.js';
const url = 'https://terminal.invalid', q = { kind: 'query', name: 'page' }, a = { kind: 'action', name: 'charge' };
const session = token => ({ principal: 'alice', token, kind: 'user', expiresAt: Date.now() + 30 * 86400_000 });
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ready = (store_id = 'A', seq = 10) => ({ data: [], store_id, seq, complete: true });
const until = async check => { return awaitState(check); };

for (const replacement of [true, false]) test(`terminal ${replacement ? 'replacement' : 'regression'} refuses every active entry point`, async t => {
  const code = replacement ? 'E_STORE_REPLACED' : 'E_STORE_RESTORE', links = []; let requests = 0;
  const client = createClient({ url, session: session('old'), fetch: async () => Response.json(++requests === 1 ? ready() : ready(replacement ? 'B' : 'A', 1)) });
  t.after(() => client.close()); client.onLink(value => links.push(value));
  await client.query(q, {}); assert.equal((await client.query(q, {})).denied.code, code);
  assert.equal(client.link(), 'signed-out'); assert.deepEqual(links, ['signed-out']);
  assert.equal((await client.act(a, {})).denied?.code, code);
  assert.equal((await client.upload(new Uint8Array([1]))).why?.code, code);
  assert.equal((await client.asset('photo')).denied?.code, code);
  assert.equal((await client.refreshSession()).why?.code, code);
  assert.equal((await client.logoutAll()).why?.code, code);
  assert.deepEqual(client.assetSource('photo'), { uri: '', headers: {} });
  assert.equal(requests, 2, 'no terminal entry point may contact the replacement');
});

for (const replacement of [true, false]) test(`in-flight assets and action are fenced without aborting effects on ${replacement ? 'replacement' : 'regression'}`, async t => {
  const release = gate(), signals = [], revoked = [], closedBlobs = []; let queries = 0;
  const code = replacement ? 'E_STORE_REPLACED' : 'E_STORE_RESTORE';
  t.mock.method(URL, 'createObjectURL', () => 'blob:late-private');
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/q/page') return Response.json(++queries === 1 ? ready() : ready(replacement ? 'B' : 'A', 1));
    signals.push({ path, signal: init.signal }); await release.promise; // Intentionally deliver despite abort.
    if (path === '/assets') return Response.json({ asset: { id: 'late', type: 'image/png', bytes: 1 } });
    if (path.startsWith('/a/')) return Response.json({ state: 'done', id: JSON.parse(init.body).id, result: 'late-private' });
    const blob = new Blob(['private'], { type: 'image/png' }); blob.close = () => closedBlobs.push(true);
    return { ok: true, headers: new Headers(), blob: async () => blob };
  } });
  t.after(async () => { release.resolve(); await client.close(); });
  await client.query(q, {});
  const upload = client.upload(new Uint8Array([1])), asset = client.asset('photo'), action = client.act(a, {});
  await until(() => signals.length === 3);
  assert.equal((await client.query(q, {})).denied.code, code);
  for (const { path, signal } of signals) assert.equal(signal?.aborted, path === '/assets/photo' ? true : undefined, 'only the asset fetch may abort');
  assert.equal((await upload).why?.code, code, 'cancel the upload caller before its body arrives');
  assert.equal((await action).denied?.code, code, 'cancel the action caller before its body arrives');
  release.resolve();
  assert.equal((await upload).why?.code, code);
  assert.equal((await asset).denied?.code, code);
  assert.equal((await action).denied?.code, code, 'a terminal action must not become retryable pending');
  await until(() => closedBlobs.length === 1);
  assert.deepEqual(revoked, [], 'aborted responses never allocate display URLs'); assert.deepEqual(closedBlobs, [true]);
});

for (const refusal of [false, true]) for (const authGap of [false, true])
  test(`late refresh ${refusal ? 'refusal' : 'successor'} cannot change terminal credentials; awaited E_AUTH gap: ${authGap}`, async t => {
    const change = gate(), rotation = gate(), auth = gate(), sessions = [], logouts = []; let rotating = false, rotationSignal;
    const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/auth/logout') { logouts.push(new Headers(init.headers).get('authorization')); return Response.json({ ok: true }); }
      if (path === '/auth/refresh') { rotating = true; rotationSignal = init.signal; await rotation.promise; return Response.json(refusal ? { denied: { code: 'E_AUTH', family: 'auth', message: 'sign in to continue' } } : { session: session('next') }, { status: refusal ? 401 : 200 }); }
      const args = JSON.parse(init.body).args;
      if (args.change) { await change.promise; return Response.json(ready('B', 1)); }
      if (args.auth) { await auth.promise; return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'sign in to continue' } }, { status: 401 }); }
      return Response.json(ready());
    } });
    t.after(async () => { change.resolve(); rotation.resolve(); auth.resolve(); await client.close(); });
    client.onSession(value => sessions.push(value));
    await client.query(q, {});
    // Dispatch before refresh so these requests can finish during rotation.
    const changing = client.query(q, { change: true }), obsolete = authGap ? client.query(q, { auth: true }) : null;
    const refreshing = client.refreshSession(); await until(() => rotating);
    auth.resolve(); await delay(0); // E_AUTH's continuation now waits on refresh.
    change.resolve(); assert.equal((await changing).denied.code, 'E_STORE_REPLACED');
    assert.equal(rotationSignal, undefined, 'a rotation may already have committed; its body must remain readable');
    assert.equal((await refreshing).why?.code, 'E_STORE_REPLACED', 'only the caller wait ends');
    assert.equal((await client.upload(new Uint8Array())).why?.code, 'E_STORE_REPLACED', 'a new call never waits for the retired refresh');
    assert.equal((await client.asset('photo')).denied?.code, 'E_STORE_REPLACED');
    rotation.resolve();
    assert.equal((await refreshing).why?.code, 'E_STORE_REPLACED');
    if (obsolete) assert.equal((await obsolete).denied.code, 'E_STORE_REPLACED');
    assert.deepEqual(sessions, [], 'neither adoption nor E_AUTH clears the session needed by recovery');
    assert.equal(client.session().token, 'old'); assert.equal(client.link(), 'signed-out');
    await until(() => refusal || logouts.length === 1);
    assert.deepEqual(logouts, refusal ? [] : ['Bearer next'], 'an unkept successor is revoked exactly once');
  });

test('a change poll waiting for refresh never resumes its retired lifetime', async t => {
  const poll = gate(), rotation = gate(), change = gate(); let polls = 0, rotating = false;
  const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/logout') return Response.json({ ok: true });
    if (path === '/auth/refresh') { rotating = true; await rotation.promise; return Response.json({ session: session('next') }); }
    if (path === '/changes') { polls++; await poll.promise; return Response.json({ store_id: 'A', seq: 10, tables: [] }); }
    if (JSON.parse(init.body).args.change) { await change.promise; return Response.json(ready('B', 1)); }
    return Response.json(ready());
  } });
  t.after(async () => { poll.resolve(); rotation.resolve(); change.resolve(); await client.close(); });
  await client.query(q, {});
  const watch = client.observe(q, {}); watch.subscribe(() => {});
  await until(() => polls === 1);
  const changing = client.query(q, { change: true }), refreshing = client.refreshSession();
  await until(() => rotating);
  poll.resolve(); await delay(0); // The next poll now waits for refresh.
  change.resolve(); assert.equal((await changing).denied.code, 'E_STORE_REPLACED');
  rotation.resolve(); assert.equal((await refreshing).why?.code, 'E_STORE_REPLACED');
  await delay(0); assert.equal(polls, 1, 'no second request after the refresh wait');
  watch.close();
});

test('app replacement never persists a late successor before probing the kept session', async t => {
  const values = memorySessionStore(), saved = [], probes = [], revoked = [], change = gate(), rotation = gate(); let rotating = false;
  const sessionStore = { ...values, async set(key, value) { saved.push(value); await values.set(key, value); } };
  await keepSession(url, session('old'), sessionStore);
  const app = createApp({ url, sessionStore, fetch: async (input, init) => {
    const path = new URL(input).pathname, bearer = new Headers(init.headers).get('authorization');
    if (path === '/auth/refresh') { rotating = true; await rotation.promise; return Response.json({ session: session('next') }); }
    if (path === '/auth/logout') { revoked.push(bearer); return Response.json({ ok: true }); }
    if (path === '/probe') { probes.push(bearer); return Response.json(bearer === 'Bearer old' ? { ok: true } : { denied: { code: 'E_AUTH', family: 'auth', message: 'sign in to continue' } }, { status: bearer === 'Bearer old' ? 200 : 401 }); }
    if (JSON.parse(init.body).args.change) { await change.promise; return Response.json(ready('B', 1)); }
    return Response.json(ready());
  } });
  t.after(async () => { change.resolve(); rotation.resolve(); await app.close(); });
  await app.ready; const prior = app.client; await prior.query(q, {});
  const changing = prior.query(q, { change: true }), refreshing = prior.refreshSession(); await until(() => rotating);
  change.resolve(); assert.equal((await changing).denied.code, 'E_STORE_REPLACED');
  assert.equal(app.auth.state, 'restoring'); rotation.resolve();
  assert.equal((await refreshing).why?.code, 'E_STORE_REPLACED');
  await until(() => app.auth.state === 'signed-in' && app.client !== prior);
  assert.deepEqual(probes, ['Bearer old']); assert.deepEqual(revoked, ['Bearer next']);
  assert.equal((await restoreSession(url, sessionStore)).token, 'old');
  assert.ok(saved.every(value => JSON.parse(value).token !== 'next'));
});

for (const credential of ['session', 'token']) for (const ending of ['sign-out', 'replacement', 'restore']) test(`a rejected refresh cleans up only after sign-out (${credential}, ${ending})`, async t => {
  const rotation = gate(), logouts = []; let rotating = false, queries = 0;
  const client = createClient({ url, ...(credential === 'session' ? { session: session('old') } : { token: 'old' }), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/logout') { logouts.push(new Headers(init.headers).get('authorization')); return Response.json({ ok: true }); }
    if (path === '/auth/refresh') {
      rotating = true; await rotation.promise;
      throw new TypeError('fetch failed'); // No usable body: the old bearer may still be live.
    }
    return Response.json(++queries === 1 ? ready() : ready(ending === 'restore' ? 'A' : 'B', 1));
  } });
  t.after(async () => { rotation.resolve(); await client.close(); });
  await client.query(q, {});
  const changing = ending !== 'sign-out' ? client.query(q, {}) : null;
  const refresh = client.refreshSession(); await until(() => rotating);
  if (ending === 'sign-out') await client.signOut();
  else assert.equal((await changing).denied.code, ending === 'restore' ? 'E_STORE_RESTORE' : 'E_STORE_REPLACED');
  assert.equal((await refresh).ok, false);
  const before = logouts.length; rotation.resolve();
  if (ending === 'sign-out') {
    await until(() => logouts.length > before);
    assert.equal(logouts.at(-1), 'Bearer old', 'sign-out still owns cleanup of an unconsumed bearer');
  } else {
    await delay(0); // Drain the rejected rotation's cleanup continuation.
    assert.deepEqual(logouts, [], 'replacement keeps the old bearer for its recovery probe');
    if (credential === 'session') assert.equal(client.session().token, 'old');
    await client.signOut();
    assert.equal(logouts.at(-1), 'Bearer old', 'explicit sign-out cleans up the held bearer');
  }
});

for (const ending of ['sign-out', 'replacement']) test(`refresh fetch rejects on abort: ${ending} still logs out next`, async t => {
  const rotation = gate(), change = gate(), logouts = [], sessions = []; let rotating = false, aborted = false;
  const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/logout') { logouts.push(new Headers(init.headers).get('authorization')); return Response.json({ ok: true }); }
    if (path === '/auth/refresh') {
      rotating = true; // The server has already committed old -> next.
      return new Promise((resolve, reject) => {
        const abort = () => { aborted = true; reject(new DOMException('request aborted', 'AbortError')); };
        init.signal?.addEventListener('abort', abort, { once: true });
        if (init.signal?.aborted) abort();
        void rotation.promise.then(() => {
          init.signal?.removeEventListener('abort', abort);
          resolve(Response.json({ session: session('next') }));
        });
      });
    }
    if (JSON.parse(init.body).args.change) { await change.promise; return Response.json(ready('B', 1)); }
    return Response.json(ready());
  } });
  t.after(async () => { rotation.resolve(); change.resolve(); await client.close(); });
  client.onSession(value => sessions.push(value)); await client.query(q, {});
  const changing = ending === 'replacement' ? client.query(q, { change: true }) : null;
  const refreshing = client.refreshSession(); await until(() => rotating);
  if (changing) { change.resolve(); assert.equal((await changing).denied.code, 'E_STORE_REPLACED'); }
  else await client.signOut();
  assert.equal((await refreshing).ok, false); assert.equal(aborted, false);
  rotation.resolve(); await until(() => logouts.includes('Bearer next'));
  assert.ok(sessions.every(value => value?.token !== 'next'), 'cleanup never adopts the unkept successor');
  assert.equal(logouts.filter(value => value === 'Bearer next').length, 1);
});
