import test from 'node:test';
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
async function fixture(t, options = {}) {
  const { url } = await server(t, undefined, source);
  const app = createApp({ url, sessionStore: memorySessionStore(), device: device(), ...options });
  t.after(() => app.close()); await app.ready;
  return { app, url };
}

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

for (const readOnly of [false, true]) test(`no-device app reuses its own client (readOnly=${readOnly}) and obeys shared logout`, { timeout: hangBudget(15) }, async t => {
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
  assert.equal((await pending).why.code, 'E_AUTH');
  assert.equal(sends, 0);
});

test('failed account opening restores a new arm without reviving the old exposed handle', { timeout: hangBudget(15) }, async t => {
  const opener = device(); let fail = false;
  const { app } = await fixture(t, { device: { ...opener, open(...args) {
    if (fail) { fail = false; throw Error('opening failed'); }
    return opener.open(...args);
  } } });
  await app.auth.guest(); const before = app.auth.viewer, old = app.online;
  await old.query(list, {}); fail = true;
  assert.equal((await app.auth.guest()).ok, false);
  assert.equal(app.auth.viewer, before); assert.equal(app.auth.state, 'signed-in');
  assert.notEqual(app.online, old);
  assert.equal((await old.query(list, {})).denied.code, 'E_AUTH');
  assert.deepEqual((await app.online.query(list, {})).data, []);
});

test('retirement bounds an unresponsive action drain and preserves its pending ID', async t => {
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
