import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mintId } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { ServerClock } from '../dist/clock.js';
import { AdmissionJournal } from '../dist/web-journal.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
import { modelBackend, modelPage } from './helpers/app-model-device.mjs';

const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm', import.meta.url));
const args = { hiddenHandle: false, refuse: false }, write = { kind: 'mutation', name: 'write' };
const url = 'http://clock.invalid', name = `snapback4-${encodeURIComponent(`${url}:dev:alice`)}`, storeId = 'session-model-store';
const observe = { op: 'observe_store', page: { ...modelPage(0, { stream: true }), requested_watermark: 0 } };
const entry = (now, seq = 1) => ({ id: mintId(), seq, op: 'write', args, viewer: 'dev:alice', now, new_ids: [], predicted: [], predictable: false });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function storage(t) {
  const values = new Map(), saved = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
  } });
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return values;
}

function fixture(t) {
  t.mock.method(Date, 'now', () => 1_000_000);
  const values = storage(t), persist = memoryPersistence(), clients = [], cores = [], cleanup = [];
  const f = { values, persist, cleanup, notices: [], admissions: 0, offline: false, beforeSave: undefined };
  const device = webDevice({ wasm, persist: { ...persist, async save(store, changes) {
    await f.beforeSave?.(store, changes); await persist.save(store, changes);
  } } });
  t.after(async () => { for (const release of cleanup) await release(); await Promise.allSettled(clients.map(c => c.close())); await Promise.allSettled(cores.map(c => c.close())); });
  f.openCore = async () => { const core = await device.open(name, { initial_backend: modelBackend }); cores.push(core); return core; };
  f.open = async (notifications = true) => {
    const client = await createLocalClient({ url, persona: 'alice', device: { async open(...opening) {
      const core = await device.open(...opening); cores.push(core); f.core = core;
      return { ...core, onOutbox: notifications ? listener => core.onOutbox(time => { f.notices.push(time); listener(time); }) : undefined,
        call(request, ...rest) { if (request.op === 'admit') f.admissions++; return core.call(request, ...rest); } };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (f.offline || path.startsWith('/m/')) throw Error('offline');
      if (path === '/changes') return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      if (path === '/schema') return Response.json(modelBackend);
      if (path === '/probe') return Response.json({ ok: true, seq: 0, store_id: storeId });
      if (path === '/sync') return Response.json(modelPage(0, JSON.parse(init.body)));
      throw Error(`unexpected path: ${path}`);
    } });
    clients.push(client); return client;
  };
  return f;
}

test('deferred journal admission advances an idle client immediately after backend adoption', async t => {
  const f = fixture(t), initial = await f.open(); await initial.close();
  const journal = new AdmissionJournal(name, true); journal.load(await f.persist.load(name));
  const recovered = entry(1_004_000), record = journal.capture({ op: 'admit', entry: recovered });
  assert.ok(record);
  await f.persist.save(name, [{ s: 'm', k: 'device:backend-required', v: storeId }]);
  const client = await f.open();
  assert.equal((await f.core.call({ op: 'sync_state' })).ok.backend_required, false);
  assert.equal((await f.core.call({ op: 'queued' })).ok.find(e => e.id === recovered.id).now, 1_004_000);
  assert.equal((await f.core.call({ op: 'meta', key: 'server-clock-floor' })).ok, '1004000');
  assert.equal(f.admissions, 0, 'no later mutation can repair the idle clock');
  assert.equal(client.now(), 1_004_000, 'adoption and replay update the same live clock');
  assert.ok(f.notices.includes(1_004_000), 'journal commits use the outbox notification');
});

test('a returned admission timestamp raises the clock even without host notifications', async t => {
  const f = fixture(t), client = await f.open(false);
  f.offline = true; await client.sync();
  await f.core.call({ op: 'set_meta', key: 'server-clock-floor', value: '1004000' });
  assert.equal(client.now(), 1_000_000);
  const id = mintId(), result = await client.mutate(write, args, { id });
  assert.equal(result.state, 'pending', JSON.stringify(result));
  assert.equal((await f.core.call({ op: 'queued' })).ok.find(e => e.id === id).now, 1_004_000);
  assert.equal(client.now(), 1_004_000, 'the returned execution timestamp must reach the clock');
});

for (const interruption of ['reload', 'rejected save']) test(`${interruption} at a held orphan commit cannot replay a waiting journal before its floor`, { timeout: 10_000 }, async t => {
  const f = fixture(t), core = await f.openCore();
  assert.equal((await core.call({ op: 'apply', page: modelPage(0, {}), first: true })).denied, undefined);
  assert.equal((await core.call(observe)).denied, undefined);
  assert.equal((await core.call({ op: 'sync_state' })).ok.store_id, storeId);
  const clock = new ServerClock(); await clock.attach(core);
  const notices = []; core.onOutbox(time => { notices.push(time); clock.raiseIssued(time); });
  const orphan = `${name}:tab-old`, orphans = [entry(1_002_000), entry(1_004_000, 2)];
  await f.persist.save(orphan, [{ s: 'm', k: 'device:store_id', v: storeId },
    ...orphans.map(e => ({ s: 'o', k: e.id, v: JSON.stringify(e) }))]);
  const entered = deferred(), release = deferred(); f.cleanup.push(() => release.resolve());
  f.beforeSave = async (store, changes) => {
    if (store === name && changes.some(c => c.s === 'o' && c.k === orphans[1].id && c.v)) {
      entered.resolve(); await release.promise; throw Error('orphan commit rejected');
    }
  };
  const recovering = core.call(observe); recovering.catch(() => {});
  await entered.promise;
  const waiting = entry(1_000_000), admitting = core.call({ op: 'admit', entry: waiting }); admitting.catch(() => {});
  const record = [...f.values.values()].map(text => JSON.parse(text)).find(r => r.entry?.id === waiting.id);
  assert.ok(record, 'journal capture precedes completion of the held orphan save');
  assert.equal(clock.issuedDeviceNow(), 1_000_000);
  assert.deepEqual(notices, [], 'uncommitted orphan time cannot advance the clock');
  // Snapshot the exact crash checkpoint: durable stores and synchronous journal,
  // excluding both the in-flight save and the old Wasm VM/ownership claims.
  const checkpoint = structuredClone([...f.persist.stores]), journalCheckpoint = new Map(f.values);
  release.resolve();
  await assert.rejects(recovering, /orphan commit rejected/);
  await assert.rejects(admitting, /orphan commit rejected/);
  assert.equal(clock.issuedDeviceNow(), 1_000_000);
  assert.deepEqual(notices, []);
  assert.equal((await f.persist.load(name)).some(c => c.s === 'o' && c.k === waiting.id), false);
  assert.equal(f.values.get(record.key), JSON.stringify(record), 'failed restore keeps the captured intent unadmitted');
  if (interruption === 'reload') {
    await core.close();
    const restored = memoryPersistence();
    for (const [store, changes] of checkpoint) restored.stores.set(store, changes);
    f.values.clear(); for (const [key, value] of journalCheckpoint) f.values.set(key, value);
    const reopened = await webDevice({ wasm, persist: restored }).open(name, null); t.after(() => reopened.close());
    const queue = (await reopened.call({ op: 'queued' })).ok;
    assert.equal(queue.find(e => e.id === waiting.id).now, 1_004_000);
    assert.deepEqual(queue.map(e => e.id), [...orphans.map(e => e.id), waiting.id], 'restoration adopts orphans before journal replay');
    const reopenedClock = new ServerClock(); await reopenedClock.attach(reopened);
    assert.equal(reopenedClock.issuedDeviceNow(), 1_004_000);
  } else {
    // No admission is live now: a failed lazy restore must not replay even the
    // captured journal before its orphan floor can commit.
    await assert.rejects(core.call({ op: 'queued' }), /orphan commit rejected/);
    assert.equal((await f.persist.load(name)).some(c => c.s === 'o' && c.k === waiting.id), false);
    assert.equal(f.values.get(record.key), JSON.stringify(record));
    assert.deepEqual(notices, []);
    f.beforeSave = undefined;
    const queue = (await core.call({ op: 'queued' })).ok;
    assert.deepEqual(queue.map(e => e.id), [...orphans.map(e => e.id), waiting.id]);
    assert.equal(queue.find(e => e.id === waiting.id).now, 1_004_000);
    assert.equal(clock.issuedDeviceNow(), 1_004_000, 'successful lazy restore also advances the live clock');
  }
});
