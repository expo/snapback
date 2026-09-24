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
const until = async check => { for (let n = 0; n < 400; n++) { if (await check()) return; await delay(5); } assert.fail('terminal operation did not settle'); };

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

for (const replacement of [true, false]) test(`in-flight assets and action are fenced and aborted on ${replacement ? 'replacement' : 'regression'}`, async t => {
  const release = gate(), signals = [], revoked = [], closedBlobs = []; let queries = 0;
  const code = replacement ? 'E_STORE_REPLACED' : 'E_STORE_RESTORE';
  t.mock.method(URL, 'createObjectURL', () => 'blob:late-private');
  t.mock.method(URL, 'revokeObjectURL', value => revoked.push(value));
  const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/q/page') return Response.json(++queries === 1 ? ready() : ready(replacement ? 'B' : 'A', 1));
    signals.push(init.signal); await release.promise; // Intentionally deliver despite abort.
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
  assert.ok(signals.every(signal => signal?.aborted), 'assets and actions share client lifetime cancellation');
  release.resolve();
  assert.equal((await upload).why?.code, code);
  assert.equal((await asset).denied?.code, code);
  assert.equal((await action).denied?.code, code, 'a terminal action must not become retryable pending');
  assert.deepEqual(revoked, ['blob:late-private']); assert.deepEqual(closedBlobs, [true]);
});

for (const refusal of [false, true]) for (const authGap of [false, true])
  test(`late refresh ${refusal ? 'refusal' : 'successor'} cannot change terminal credentials; awaited E_AUTH gap: ${authGap}`, async t => {
    const change = gate(), rotation = gate(), auth = gate(), sessions = [], logouts = []; let rotating = false, rotationSignal;
    const client = createClient({ url, session: session('old'), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/auth/logout') { logouts.push(new Headers(init.headers).get('authorization')); return Response.json({ ok: true }); }
      if (path === '/auth/refresh') { rotating = true; rotationSignal = init.signal; await rotation.promise; return Response.json(refusal ? { denied: { code: 'E_AUTH' } } : { session: session('next') }, { status: refusal ? 401 : 200 }); }
      const args = JSON.parse(init.body).args;
      if (args.change) { await change.promise; return Response.json(ready('B', 1)); }
      if (args.auth) { await auth.promise; return Response.json({ denied: { code: 'E_AUTH' } }, { status: 401 }); }
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
    assert.equal(rotationSignal?.aborted, true);
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
    if (path === '/probe') { probes.push(bearer); return Response.json(bearer === 'Bearer old' ? { ok: true } : { denied: { code: 'E_AUTH' } }, { status: bearer === 'Bearer old' ? 200 : 401 }); }
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
