import test from 'node:test';
import assert from 'node:assert/strict';
import { memorySessionStore, sessionKey } from '../dist/auth.js';
import { storeKey } from '../dist/app-storage.js';
import { mintId } from '../dist/client.js';
import { ProgressiveWrites, progressiveWriteCustody } from '../dist/progressive-writes.js';
import { fixture, gate, until, mutation } from './helpers/progressive-writes.mjs';

const regression = (name, work) => test(name, { timeout: 20_000 }, work);
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

function browser(t) {
  const entries = new Map(), storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: k => entries.get(k) ?? null, setItem: (k, value) => entries.set(k, String(value)), removeItem: k => entries.delete(k) };
  for (const [name, value] of Object.entries({ window: Object.assign(new EventTarget(), { location: { href: 'https://app.invalid' } }), localStorage: storage })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
  }
  const session = sessionKey(url), authority = { capture: () => ({ key: session, epoch: '1', principal: 'alice', source: 'browser' }),
    read: async requested => requested === session ? JSON.stringify({ principal: 'alice', snapback4Epoch: '1' }) : '1', recheck() {} };
  return { entries, authority };
}

regression('E15 non-browser fresh admission waits for the restored prefix during first inspection', async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate(), restored = mintId();
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [
    { owner: 'alice', id: restored, op: 'write', args: {}, storeId: 'A' },
  ], receipts: [] }));
  let unreadable = true, installs = 0, nestedReads = 0, progressive;
  const store = { ...memory, async get(k) {
    if (k === key) {
      if (unreadable) { unreadable = false; throw Error('initial journal unavailable'); }
      if (installs === 2 && ++nestedReads === 2) { entered.resolve(); await release.promise; }
    }
    return memory.get(k);
  } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) {
    progressive = this; installs++; return install.apply(this, args);
  });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report: () => {} });
  const recovering = progressive.pending(); await entered.promise;
  assert.equal(progressive.plan.authority, undefined, 'this webDevice client has no browser capture authority');
  const fresh = mintId(), writing = f.app.client.mutate(mutation, {}, { id: fresh, waitSeconds: 0 });
  assert.deepEqual(progressiveWriteCustody(f.app.client).captures(), []);
  assert.deepEqual(f.requests, []);
  release.resolve(); await recovering; await writing;
  await until(() => f.requests.length === 2);
  assert.deepEqual(f.requests, [restored, fresh], 'the recovered prefix must reach transport before this runtime\'s new write');
});

for (const target of ['dispatcher', 'custody']) regression(`E15 retained denial close fences ${target} during first inspection without capture`, async t => {
  const { entries, authority } = browser(t), memory = memorySessionStore(), entered = gate(), release = gate();
  await memory.set(key, 'damaged opening');
  let installs = 0, nestedReads = 0, progressive;
  const store = { ...memory, async get(k) {
    if (k === key && installs === 2 && ++nestedReads === 2) { entered.resolve(); await release.promise; }
    return memory.get(k);
  } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; installs++; return install.apply(this, args); });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, authority, hold: false, report: () => {} });
  const close = f.app.client.close;
  const recovering = progressive.pending(); await entered.promise;
  const custody = progressiveWriteCustody(f.app.client);
  assert.equal(nestedReads, 2, 'custody is installed with its first inspection held');
  const client = target === 'dispatcher' ? f.app.client : custody.client;
  const ending = close();
  const id = mintId(), writing = client.mutate(mutation, {}, { id, waitSeconds: 0 });
  assert.deepEqual(custody.captures(), [], 'closing synchronously prevents a new capture');
  assert.equal([...entries.values()].some(value => JSON.parse(value).id === id), false, 'closing leaves no durable browser intent');
  release.resolve(); await recovering; await ending;
  assert.equal((await writing).why?.code, target === 'dispatcher' ? 'E_CLOSED' : 'E_AUTH');
  assert.deepEqual(JSON.parse(await memory.get(key)).pending, [], 'the refused click cannot execute on reopen');
  assert.deepEqual(f.requests, []);
});

regression('E15 retained opening pause fences the installed dispatcher until start', async t => {
  const { entries, authority } = browser(t), memory = memorySessionStore(), entered = gate(), release = gate();
  await memory.set(key, 'damaged opening');
  let installs = 0, nestedReads = 0, progressive;
  const store = { ...memory, async get(k) {
    if (k === key && installs === 2 && ++nestedReads === 2) { entered.resolve(); await release.promise; }
    return memory.get(k);
  } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; installs++; return install.apply(this, args); });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, authority, hold: false, report: () => {} });
  const handle = progressiveWriteCustody(f.app.client), pause = handle.pause;
  const recovering = progressive.pending(); await entered.promise;
  pause();
  const id = mintId(), writing = f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 });
  assert.deepEqual(handle.captures(), []);
  assert.equal([...entries.values()].some(value => JSON.parse(value).id === id), false);
  release.resolve(); await recovering;
  assert.equal((await writing).why?.code, 'E_ADMISSION');
  assert.deepEqual(JSON.parse(await memory.get(key)).pending, []);
  assert.deepEqual(f.requests, []);
  assert.equal((await f.app.client.act({ kind: 'action', name: 'perform' }, {})).state, 'done', 'pause leaves the device open');
  handle.start();
  assert.equal((await f.app.client.mutate(mutation, {}, { id, waitSeconds: 5 })).state, 'sent', 'the refused id can be retried after start');
  assert.deepEqual(f.requests, [id]);
});

for (const method of ['close', 'signOut', 'pause', 'viewer']) for (const preserves of [false, true]) {
  regression(`E15 ${method} during opening recovery ${preserves ? 'still reports the quarantine side key' : 'suppresses preservation failure'}`, async t => {
    const memory = memorySessionStore(), entered = gate(), release = gate(), reports = [];
    const damaged = 'damaged opening recovery'; await memory.set(key, damaged);
    let hold = false, preserving = false, saves = 0, installs = 0, progressive;
    const store = { ...memory, async get(k) {
      if (k === key && hold) { hold = false; entered.resolve(); await release.promise; preserving = true; }
      return memory.get(k);
    }, async set(k, value) {
      if (preserving && k.startsWith(`${key}.damaged.`)) {
        saves++;
        if (!preserves) throw Error('quarantine storage unavailable');
      }
      return memory.set(k, value);
    } };
    const install = ProgressiveWrites.prototype.install;
    t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; installs++; return install.apply(this, args); });
    t.after(() => release.resolve());
    const f = await fixture(t, { raw: true, store, hold: false, report: error => reports.push(error) });
    hold = true;
    const recovering = progressive.pending(); await entered.promise;
    reports.length = 0;
    let ending;
    if (method === 'pause') progressiveWriteCustody(f.app.client).pause();
    else if (method === 'viewer') t.mock.method(f.app.client, 'viewer', () => 'bob');
    else ending = f.app.client[method]();
    release.resolve(); await recovering; await ending;
    assert.equal(saves, 1, 'damaged text reaches the quarantine save after retirement');
    if (preserves) {
      assert.equal(reports.length, 1, 'successful quarantine must still disclose its saved-byte key');
      assert.match(reports[0].why.rewrite, /\.damaged\./);
      const side = JSON.parse(reports[0].why.rewrite.match(/sessionStore\.get\(("[^"]+")\)/)[1]);
      assert.equal(await memory.get(side), damaged);
    } else {
      assert.deepEqual(reports, [], 'retired opening recovery reports no preservation failure');
      assert.equal(await memory.get(key), damaged, 'failed preservation keeps the original bytes');
    }
    assert.equal(installs, 1, 'retirement stops recovery before nested installation');
    await progressive.pending(); assert.equal(installs, 1);
    assert.deepEqual(f.requests, []);
  });
}
