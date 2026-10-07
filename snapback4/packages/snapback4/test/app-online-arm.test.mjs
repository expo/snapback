import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../dist/app.js';
import { memorySessionStore } from '../dist/auth.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server, until } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const device = () => webDevice({ wasm, persist: memoryPersistence() });
const gate = () => { let release; const promise = new Promise(r => release = r); return { promise, release }; };
const list = { kind: 'query', name: 'list' }, add = { kind: 'mutation', name: 'add' };
const signal = { kind: 'mutation', name: 'touch', ephemeral: true, renews: false };
const action = { kind: 'action', name: 'work' };
const source = `use identity
table notes:
  owner: principal
  body: text <=200
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 1 by .id
mutation add(body: text <=200):
  insert notes { owner: viewer, body }
query list():
  return notes where .owner = viewer first 100 by .id
table hints:
  principal: principal
  unique principal
  immutable principal
  public 'typing hints'
  insert <- .principal = viewer
  update <- .principal = viewer
  ephemeral 4s
mutation touch():
  upsert hints[viewer] {}
query hints():
  return hints first 100 by .id
`;
async function openFixture(t, options = {}) {
  const { url } = await server(t, undefined, source);
  const app = createApp({ url, sessionStore: memorySessionStore(), device: device(), ...options });
  t.after(() => app.close()); await app.ready;
  return { app, url };
}

for (const mode of ['device', 'online']) {
const fixture = (t, options = {}) => openFixture(t, { device: mode === 'device' ? device() : undefined, ...options });
const test = (name, options, run) => nodeTest(`${mode}: ${name}`, options, run);

test('owned server snapshot bypasses the device horizon and exports no credential or lifetime surface', { timeout: hangBudget(15) }, async t => {
  const { app } = await fixture(t);
  assert.equal((await app.online.query(list, {})).denied.code, 'E_AUTH');
  assert.equal((await app.online.mutate(signal, {})).why.code, 'E_AUTH');
  assert.equal((await app.online.act(action, {})).denied.code, 'E_AUTH');
  await app.auth.guest();
  await app.mutate(add, { body: 'first' }); await app.mutate(add, { body: 'second' });
  const arm = app.online, read = await arm.query(list, {});
  assert.deepEqual(read.data.map(row => row.body), ['first', 'second']);
  assert.equal(read.complete, true); assert.equal(read.fresh, true);
  assert.deepEqual(Object.keys(arm).sort(), ['act','link','mutate','now','observe','onLink','query','readOnly','viewer'].sort());
  for (const key of ['session', 'onSession', 'token', 'headers', 'assetSource', 'refreshSession', 'signOut', 'logoutAll', 'close']) assert.equal(arm[key], undefined, key);
  assert.ok(!JSON.stringify(arm).includes(app.client.session().token));
  assert.equal((await arm.mutate(add, { body: 'wrong route' })).why.code, 'E_INPUT');
  assert.equal((await arm.query(list, {})).data.length, 2);
});

for (const method of ['mutate', 'act']) test(`rotation drains dispatched ${method}, fences waiting/new calls and keeps the app signed in`, { timeout: hangBudget(15) }, async t => {
  const held = gate(); let request, responseReady = false, count = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === (method === 'mutate' ? '/m/touch' : '/a/work')) {
      count++; request = init;
      const response = method === 'mutate' ? await fetch(input, init)
        : Response.json({ id: JSON.parse(init.body).id, state: 'done', result: 42 });
      const json = await response.json(); responseReady = true;
      await held.promise; return Response.json(json, { status: response.status });
    }
    return fetch(input, init);
  } });
  t.after(() => held.release()); await app.auth.guest();
  const arm = app.online;
  await arm.query(list, {}); // establish store identity before the held call
  const pending = method === 'mutate' ? arm.mutate(signal, {}) : arm.act(action, {});
  await until(() => responseReady);
  const queued = method === 'mutate' ? arm.mutate(signal, {}) : undefined;
  let notifications = 0; t.after(app.onOnlineChange(() => notifications++));
  assert.equal((await app.client.refreshSession()).ok, true);
  assert.notEqual(app.online, arm); assert.ok(notifications > 0);
  assert.equal(request.signal?.aborted ?? false, false, 'rotation must not abort the dispatched call');
  assert.equal((await arm.mutate(signal, {})).why.code, 'E_AUTH');
  assert.equal((await arm.act(action, {})).denied.code, 'E_AUTH');
  held.release();
  assert.equal((await pending).state, method === 'mutate' ? 'sent' : 'done');
  if (queued) assert.equal((await queued).why.code, 'E_AUTH');
  assert.equal(count, 1, 'retired queued calls cannot dispatch with the old bearer');
  assert.equal(app.auth.state, 'signed-in');
  assert.equal((await app.online.query(list, {})).existence, 'absent');
});

for (const transition of ['account', 'logout', 'close']) test(`${transition} fences cached arms, observations and late server data`, { timeout: hangBudget(15) }, async t => {
  const held = gate(); let hold = false, entered = false, reads = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/q/list') {
      reads++; const json = await response.json();
      if (hold) { entered = true; await held.promise; }
      return Response.json(json, { status: response.status });
    }
    return response;
  } });
  t.after(() => held.release()); await app.auth.guest();
  await app.mutate(add, { body: 'old account' });
  const arm = app.online, observation = arm.observe(list, {}, { keep: false });
  t.after(() => observation.close());
  await until(() => observation.getSnapshot().data?.length === 1);
  hold = true; const pending = arm.query(list, {}); await until(() => entered);
  if (transition === 'account') await app.auth.guest();
  else if (transition === 'logout') await app.auth.logout();
  else await app.close();
  assert.equal(observation.getSnapshot().denied.code, 'E_AUTH');
  const before = reads;
  assert.equal((await arm.query(list, {})).denied.code, 'E_AUTH');
  assert.equal((await arm.mutate(signal, {})).why.code, 'E_AUTH');
  assert.equal(reads, before);
  held.release(); assert.equal((await pending).denied.code, 'E_AUTH');
  hold = false;
  if (transition === 'account') assert.deepEqual((await app.online.query(list, {})).data, []);
});

test('offline drops signals, refuses snapshots/actions; observed reads recover without replay', { timeout: hangBudget(15) }, async t => {
  let offline = false, sends = 0;
  const { app } = await fixture(t, { fetch: (input, init) => {
    if (offline) return Promise.reject(Error('offline'));
    if (new URL(input).pathname === '/m/touch') sends++;
    return fetch(input, init);
  } });
  await app.auth.guest(); const arm = app.online;
  const observed = arm.observe(list, {}, { keep: false }); t.after(() => observed.close());
  await until(() => observed.getSnapshot().data);
  offline = true;
  assert.equal((await arm.query(list, {})).denied.code, 'E_OFFLINE');
  assert.equal((await arm.mutate(signal, {})).why.code, 'E_OFFLINE');
  assert.equal((await arm.act(action, {})).denied.code, 'E_OFFLINE');
  offline = false;
  await until(async () => (await arm.query(list, {})).data, 'reconnected snapshot');
  await until(() => observed.getSnapshot().fresh === true);
  assert.equal(sends, 0);
  assert.equal((await arm.mutate(signal, {})).state, 'sent'); assert.equal(sends, 1);
});

if (mode === 'online') for (const readOnly of [false, true]) test(`no-device app reuses its own client (readOnly=${readOnly}) and obeys shared logout`, { timeout: hangBudget(15) }, async t => {
  const storage = memorySessionStore(); const requests = [];
  const { app, url } = await fixture(t, { device: undefined, sessionStore: storage, readOnly,
    fetch: (input, init) => { requests.push(new URL(input).pathname); return fetch(input, init); } });
  assert.equal((await app.online.query(list, {})).denied.code, 'E_AUTH');
  assert.equal((await app.online.mutate(signal, {})).why.code, 'E_AUTH');
  assert.equal((await app.online.act(action, {})).denied.code, 'E_AUTH');
  await app.auth.guest(); const arm = app.online;
  assert.equal(arm.readOnly, readOnly);
  assert.deepEqual((await arm.query(list, {})).data, []);
  if (readOnly) {
    const before = requests.length;
    assert.equal((await arm.mutate(signal, {})).why.code, 'E_READ_ONLY');
    assert.equal((await arm.act(action, {})).why.code, 'E_READ_ONLY');
    assert.equal((await app.client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
    assert.equal(requests.length, before);
    assert.ok(!requests.includes('/auth/refresh'));
    assert.equal(requests.filter(path => path === '/probe').length, 1, 'no second client or verification probe');
  }
  const peer = createApp({ url, sessionStore: storage, readOnly }); t.after(() => peer.close()); await peer.ready;
  await peer.auth.logout();
  assert.equal((await arm.query(list, {})).denied.code, 'E_AUTH');
  await until(() => app.auth.state === 'signed-out');
});

test('an arm waiting for shared authority cannot dispatch after synchronous logout fencing', { timeout: hangBudget(15) }, async t => {
  const memory = memorySessionStore(), held = gate(); let hold = false, entered = false, sends = 0;
  const { app } = await fixture(t, { sessionStore: { ...memory, async get(key) {
    const value = await memory.get(key);
    if (hold) { hold = false; entered = true; await held.promise; }
    return value;
  } }, fetch: (input, init) => {
    if (new URL(input).pathname === '/m/touch') sends++;
    return fetch(input, init);
  } });
  t.after(() => held.release()); await app.auth.guest();
  const arm = app.online; await arm.query(list, {});
  hold = true;
  const pending = arm.mutate(signal, {}); await until(() => entered);
  const logout = app.auth.logout();
  held.release(); await logout;
  // The shared raw client's close may win the authority gate on explicit
  // logout. Preserve that cancellation; neither result permits a dispatch.
  const why = (await pending).why.code;
  assert.ok(mode === 'online' ? ['E_CLOSED', 'E_AUTH'].includes(why) : why === 'E_AUTH', why);
  assert.equal(sends, 0);
});

test('failed account opening restores a new arm without reviving the old exposed handle', { timeout: hangBudget(15) }, async t => {
  const opener = device(), memory = memorySessionStore(); let fail = false;
  const refuse = () => { if (fail) { fail = false; throw Error('opening failed'); } };
  const { app } = await fixture(t, mode === 'device'
    ? { device: { ...opener, open(...args) { refuse(); return opener.open(...args); } } }
    : { sessionStore: { ...memory, set(...args) { refuse(); return memory.set(...args); } } });
  await app.auth.guest(); const before = app.auth.viewer, old = app.online;
  await old.query(list, {}); fail = true;
  assert.equal((await app.auth.guest()).ok, false);
  assert.equal(app.auth.viewer, before); assert.equal(app.auth.state, 'signed-in');
  assert.notEqual(app.online, old);
  assert.equal((await old.query(list, {})).denied.code, 'E_AUTH');
  assert.deepEqual((await app.online.query(list, {})).data, []);
});

test('an old action response cannot retry under the replacement credential or sign out its owner', { timeout: hangBudget(15) }, async t => {
  const held = gate(); let entered = false, sends = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    if (new URL(input).pathname === '/a/work') {
      sends++; entered = true; await held.promise;
      return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'old credential' } }, { status: 401 });
    }
    return fetch(input, init);
  } });
  t.after(() => held.release()); await app.auth.guest();
  const arm = app.online, pending = arm.act(action, {}, { id: 'retired-action' });
  await until(() => entered);
  assert.equal((await app.client.refreshSession()).ok, true);
  held.release();
  assert.equal((await pending).denied.code, 'E_AUTH');
  assert.equal((await pending).id, 'retired-action');
  assert.equal(sends, 1);
  assert.equal(app.auth.state, 'signed-in');
  assert.deepEqual((await app.online.query(list, {})).data, []);
});

test('a dispatched signal keeps its transport failure after rotation', { timeout: hangBudget(15) }, async t => {
  const held = gate(); let entered = false, sends = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    if (new URL(input).pathname === '/m/touch') {
      sends++; entered = true; await held.promise; throw Error('lost response');
    }
    return fetch(input, init);
  } });
  t.after(() => held.release()); await app.auth.guest();
  const arm = app.online, pending = arm.mutate(signal, {});
  await until(() => entered); await app.client.refreshSession(); held.release();
  assert.equal((await pending).why.code, 'E_OFFLINE');
  assert.equal(sends, 1);
  assert.equal(app.auth.state, 'signed-in');
});

test('renewal reuse never crosses arm retirement', { timeout: hangBudget(15) }, async t => {
  let sends = 0;
  const { app } = await fixture(t, { fetch(input, init) {
    if (new URL(input).pathname === '/m/touch') sends++;
    return fetch(input, init);
  } });
  await app.auth.guest();
  const renewal = { ...signal, renews: true, renewMs: 60_000 }, old = app.online;
  assert.equal((await old.mutate(renewal, {})).state, 'sent');
  assert.equal((await old.mutate(renewal, {})).state, 'sent');
  assert.equal(sends, 1, 'same-arm renewals retain the existing reuse window');
  await app.client.refreshSession();
  assert.equal((await app.online.mutate(renewal, {})).state, 'sent');
  assert.equal(sends, 2, 'the replacement arm must dispatch its own renewal');
  assert.equal((await old.mutate(renewal, {})).why.code, 'E_AUTH');
});

// Astra R0: permanent reproductions, in addition to both-tier lifecycle cases.
if (mode === 'online') {
test('an action auth retry keeps its originating arm while waiting for shared rotation', { timeout: hangBudget(15) }, async t => {
  const actionGate = gate(), refreshGate = gate();
  let actionEntered = false, responseRead = false, refreshEntered = false, sends = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    if (new URL(input).pathname === '/a/work') {
      sends++; actionEntered = true; await actionGate.promise;
      const response = Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'rotate' } }, { status: 401 });
      const json = response.json.bind(response);
      response.json = async () => { const body = await json(); responseRead = true; return body; };
      return response;
    }
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/auth/refresh') {
      const json = await response.json(); refreshEntered = true; await refreshGate.promise;
      return Response.json(json, { status: response.status });
    }
    return response;
  } });
  t.after(() => { actionGate.release(); refreshGate.release(); });
  await app.auth.guest();
  const arm = app.online, pending = arm.act(action, {});
  await until(() => actionEntered);
  const rotating = app.client.refreshSession(); await until(() => refreshEntered);
  actionGate.release(); await until(() => responseRead);
  await new Promise(setImmediate); // consume the refusal while refresh is held
  refreshGate.release(); await rotating;
  assert.equal((await pending).denied.code, 'E_AUTH');
  assert.equal(sends, 1, 'the auth retry cannot send as the replacement credential');
  assert.equal(app.auth.state, 'signed-in');
});

test('retired observations do not share queued work with the new arm or app client', { timeout: hangBudget(15) }, async t => {
  let reads = 0;
  const { app } = await fixture(t, { fetch(input, init) {
    if (new URL(input).pathname === '/q/list') reads++;
    return fetch(input, init);
  } });
  await app.auth.guest();
  const old = app.online, plain = app.client.observe(list, {}, { keep: true });
  const first = old.observe(list, {}, { keep: true }), second = old.observe(list, {}, { keep: true });
  t.after(() => { plain.close(); first.close(); second.close(); });
  await until(() => plain.getSnapshot().data && first.getSnapshot().data && second.getSnapshot().data);
  assert.equal(first.getSnapshot(), second.getSnapshot(), 'subscribers in one arm still share');
  assert.ok(reads >= 2, 'the arm and app client have independent request ownership');
  await app.client.refreshSession();
  const next = app.online.observe(list, {}, { keep: true }); t.after(() => next.close());
  await until(() => plain.getSnapshot().data && next.getSnapshot().data);
  assert.equal(first.getSnapshot().denied.code, 'E_AUTH');
  assert.equal(second.getSnapshot().denied.code, 'E_AUTH');
  assert.equal(app.auth.state, 'signed-in');
});

test('an action waiting for the shared refresh cannot use its replacement credential', { timeout: hangBudget(15) }, async t => {
  const held = gate(); let refreshEntered = false, actionEntered = false, sends = 0;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    if (new URL(input).pathname === '/a/work') sends++;
    const response = await fetch(input, init);
    if (new URL(input).pathname === '/auth/refresh') {
      const json = await response.json(); refreshEntered = true; await held.promise;
      return Response.json(json, { status: response.status });
    }
    return response;
  } });
  t.after(() => held.release()); await app.auth.guest();
  const arm = app.online, rotating = app.client.refreshSession();
  await until(() => refreshEntered);
  const pending = arm.act(action, { toJSON() { actionEntered = true; return {}; } });
  await until(() => actionEntered);
  held.release(); await rotating;
  assert.equal((await pending).denied.code, 'E_AUTH');
  assert.equal(sends, 0);
  assert.equal(app.auth.state, 'signed-in');
});

test('no-device: storage-awaited signal cannot dispatch its retired bearer', { timeout: hangBudget(15) }, async t => {
  const storageGate = gate(), refreshGate = gate(), memory = memorySessionStore();
  let holdStorage = false, storageEntered = false, refreshEntered = false;
  let original, oldBearerDispatches = 0;
  const { app } = await fixture(t, {
    sessionStore: { ...memory, async get(key) {
      const value = await memory.get(key);
      if (holdStorage) { holdStorage = false; storageEntered = true; await storageGate.promise; }
      return value;
    } },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/m/touch' && new Headers(init.headers).get('authorization') === 'Bearer ' + original) oldBearerDispatches++;
      const response = await fetch(input, init);
      if (path === '/auth/refresh') { const json = await response.json(); refreshEntered = true; await refreshGate.promise; return Response.json(json, { status: response.status }); }
      return response;
    },
  });
  t.after(() => { storageGate.release(); refreshGate.release(); });
  await app.auth.guest();
  const arm = app.online;
  await arm.query(list, {});
  original = app.client.session().token;
  const rotating = app.client.refreshSession();
  await until(() => refreshEntered);
  holdStorage = true;
  const signalCall = arm.mutate(signal, {});
  await until(() => storageEntered);
  refreshGate.release();
  await until(() => app.online !== arm);
  storageGate.release();
  await rotating;
  const outcome = await signalCall;
  assert.equal(outcome.why.code, 'E_AUTH');
  assert.equal(app.auth.state, 'signed-in');
  assert.equal(oldBearerDispatches, 0, 'no HTTP request may dispatch with the retired bearer');
});

test('no-device: queued signal cannot send as the old account during replacement', { timeout: hangBudget(15) }, async t => {
  const held = gate(); let responseReady = false, sends = 0, oldAccountWhileHidden = 0, original;
  const { app } = await fixture(t, { fetch: async (input, init) => {
    if (new URL(input).pathname === '/m/touch') {
      sends++;
      if (app.auth.state === 'restoring' && new Headers(init.headers).get('authorization') === 'Bearer ' + original) oldAccountWhileHidden++;
      const response = await fetch(input, init), json = await response.json();
      if (sends === 1) { responseReady = true; await held.promise; }
      return Response.json(json, { status: response.status });
    }
    return fetch(input, init);
  } });
  t.after(() => held.release());
  await app.auth.guest(); const arm = app.online;
  original = app.client.session().token;
  await arm.query(list, {});
  const first = arm.mutate(signal, {});
  await until(() => responseReady);
  const queued = arm.mutate(signal, {});
  t.after(app.auth.onChange(() => { if (app.auth.state === 'restoring') held.release(); }));
  await app.auth.guest();
  assert.equal((await first).state, 'sent');
  const outcome = await queued;
  assert.equal(outcome.why.code, 'E_AUTH');
  assert.equal(oldAccountWhileHidden, 0, 'retired arm must not issue an old-account request during provisional replacement');
});
}

}

nodeTest('retirement bounds an unresponsive action drain and preserves its pending ID', async t => {
  const { ownOnline } = await import('../dist/app-online-arm.js');
  const { QUERY_LIFETIME } = await import('../dist/query-settlement.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const held = gate(); let dispatched = false, closed = 0, active = true;
  const pending = { state: 'pending', id: 'original-action-id' };
  const raw = { readOnly: false, link: () => 'online', async act() { dispatched = true; await held.promise; return pending; },
    async close() { closed++; held.release(); } };
  const arm = ownOnline(raw, async () => true, () => active,
    () => ({ code: 'E_AUTH', family: 'auth', message: 'retired' }), true, () => { active = false; });
  const call = arm.online.act(action, {});
  for (let n = 0; !dispatched && n < 10; n++) await Promise.resolve();
  assert.equal(dispatched, true);
  arm.fence()();
  t.mock.timers.tick(QUERY_LIFETIME - 1); assert.equal(closed, 0);
  t.mock.timers.tick(1); assert.equal(closed, 1);
  assert.deepEqual(await call, pending);
});
