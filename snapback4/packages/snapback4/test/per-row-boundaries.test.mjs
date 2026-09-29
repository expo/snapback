// @ref LLP 3000.023#10 — queueing never postpones policy transitions or expiry floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { answerObservation } from '../dist/read-observation.js';
import { RememberedAnswers } from '../dist/local-reads.js';
import { ServerClock } from '../dist/clock.js';
import { holdReadExpiry } from '../dist/read-expiry.js';
import { server, binary, until } from './helpers/app-server.mjs';

const source = `use personas alice, bob
table rows:
  owner: principal
  value: int
  read <- .owner = viewer
  update <- allow
  online only
query remote(id: rows):
  return rows[id]
mutation transfer(id: rows):
  update rows[id] { owner: 'dev:bob' }
mutation edit(id: rows):
  update rows[id] { value: 8 }
`;
const op = { kind: 'query', name: 'remote' };
const pause = () => new Promise(resolve => setImmediate(resolve));
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error('closed'));
  else signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
});
const device = (tier, dir) => tier === 'process'
  ? processDevice({ binary, dir: join(dir, 'device') })
  : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
async function fixture(t) {
  const f = await server(t, '', source);
  const seeded = await fetch(f.url + '/seed', { method: 'POST', body: JSON.stringify([
    { table: 'rows', row: { id: 'r', owner: 'dev:alice', value: 7 } },
  ]) }).then(r => r.json());
  assert.equal(seeded.seeded, 1);
  return f;
}

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) for (const boundary of ['response', 'callback']) {
  test(`${tier} keep=${keep}: queued presence checks a second change at the ${boundary} boundary`, async t => {
    const { url, dir } = await fixture(t), watches = [];
    const body = Promise.withResolvers(), sync = Promise.withResolvers();
    let change, blocked = 0, rowQueries = 0, holdSync = false, refresh, memory, refreshing = false;
    const later = setTimeout, write = RememberedAnswers.prototype.set;
    t.mock.method(globalThis, 'setTimeout', (run, delay, ...args) => {
      if (delay === 54321) refresh = run;
      return later(run, delay, ...args);
    });
    t.mock.method(RememberedAnswers.prototype, 'set', function(...args) {
      if (args[0] === 'remote:{"id":"r"}') memory = this;
      return write.apply(this, args);
    });
    const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((resolve, reject) => {
        change = json => resolve(Response.json(json));
        init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
      if (path === '/sync' && holdSync) await sync.promise;
      if (path.startsWith('/q/')) {
        if (JSON.parse(init.body).args.id.startsWith('hold')) { blocked++; return parked(init.signal); }
        const response = await fetch(input, init), json = await response.json();
        rowQueries++;
        if (refreshing) await body.promise;
        return Response.json({ ...json, refresh: 54321 }, { status: response.status });
      }
      return fetch(input, init);
    } });
    t.after(async () => { watches.forEach(w => w.close()); body.resolve(); sync.resolve(); await client.close(); });
    await client.sync();
    const mount = id => {
      const w = client.observe(op, { id }, { keep }); watches.push(w); w.subscribe(() => {}); return w;
    };
    const row = mount('r');
    await until(() => row.getSnapshot().data?.value === 7 && refresh && memory);
    const owner = answerObservation(row.getSnapshot());
    for (let i = 0; i < 8; i++) mount('hold' + i);
    await until(() => blocked === 8);
    const mutate = async name => {
      const result = await fetch(url + '/m/' + name, { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
        body: JSON.stringify({ id: crypto.randomUUID(), args: { id: 'r' } }) }).then(r => r.json());
      assert.equal(result.state, 'sent'); return result;
    };
    const first = await mutate('edit'), previous = change;
    change({ seq: first.seq, generation: 1, tables: ['rows'] });
    await until(() => change !== previous, 'first change and sync finished with all slots held');
    const shown = row.getSnapshot(), version = owner.changeVersion;
    assert.equal(owner.running, false, 'the replacement is queued');
    assert.equal(rowQueries, 1);
    if (keep === false) assert.deepEqual(shown, { loading: true });
    else assert.equal(shown.revalidating, true);
    const remembered = memory.get('remote:{"id":"r"}');
    refreshing = true; clearTimeout(owner.presenceRefresh); refresh();
    await until(() => rowQueries === 2, 'presence captured the pre-removal server body');
    const second = await mutate('transfer'); holdSync = true;
    if (boundary === 'response') {
      change({ seq: second.seq, generation: 1, tables: ['rows'] });
      await until(() => owner.changeVersion !== version, 'second change processed before the presence reply');
    }
    assert.equal(owner.snapshot, shown, 'the second invalidation keeps the same queued snapshot object');
    assert.equal(owner.running, false);
    let running = owner.running, checks = 0, reached = false;
    Object.defineProperty(owner, 'running', { configurable: true, set(value) { running = value; }, get() {
      // The first check follows completed evaluation. The second is inside
      // publishLocal's callback, after every earlier check has passed.
      if (++checks === (boundary === 'response' ? 1 : 2)) {
        reached = true;
        if (boundary === 'callback') owner.changeVersion = (owner.changeVersion ?? 0) + 1;
      }
      return running;
    } });
    let published = 0;
    t.mock.method(owner, 'publish', (...args) => { published++; return Object.getPrototypeOf(owner).publish.apply(owner, args); });
    body.resolve();
    await until(() => reached, 'the presence result reached its final publication checks');
    if (boundary === 'response') assert.equal(memory.get('remote:{"id":"r"}'), remembered, 'the pre-change presence body must not enter fallback memory');
    else assert.notEqual(owner.changeVersion, version, 'the final callback boundary was reached');
    assert.equal(published, 0, 'no stale finished answer or synthetic loading publication');
    assert.equal(owner.snapshot, shown, 'queued policy state is unchanged by the retired refresh');
    assert.equal(rowQueries, 2, 'the observation replacement still has no slot');
    refreshing = false; watches.slice(1).forEach(w => w.close());
    await until(() => row.getSnapshot().data === null, 'the queued replacement still makes progress');
  });
}

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: a full queue cannot postpone the change transition`, async t => {
    const { url, dir } = await fixture(t), held = [], watches = [];
    let change, blocked = 0, rowQueries = 0;
    const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return new Promise((resolve, reject) => {
        change = json => resolve(Response.json(json));
        init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
      if (path.startsWith('/q/')) {
        if (JSON.parse(init.body).args.id.startsWith('hold')) {
          blocked++;
          return new Promise(resolve => held.push(() => resolve(Response.json({ data: null, seq: 1, tables: ['rows'] }))));
        }
        rowQueries++;
      }
      return fetch(input, init);
    } });
    t.after(async () => { watches.forEach(w => w.close()); held.splice(0).forEach(f => f()); await client.close(); });
    await client.sync();
    const mount = (id, policy) => { const w = client.observe(op, { id }, { keep: policy }); watches.push(w); w.subscribe(() => {}); return w; };
    const row = mount('r', keep);
    await until(() => row.getSnapshot().data?.value === 7 && !row.getSnapshot().revalidating);
    // Isolate the synchronous transition from the independently owned episode timeout.
    const wall = Date.now(); t.mock.method(Date, 'now', () => wall);
    for (let i = 0; i < 8; i++) mount('hold' + i, undefined);
    await until(() => blocked === 8);
    const before = rowQueries, published = [];
    row.subscribe(() => published.push(row.getSnapshot()));
    const result = await fetch(url + '/m/transfer', { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
      body: JSON.stringify({ id: crypto.randomUUID(), args: { id: 'r' } }) }).then(r => r.json());
    assert.equal(result.state, 'sent');
    const previous = change; change({ seq: result.seq, generation: 1, tables: ['rows'] });
    await until(() => change !== previous, 'change processed with all slots still held');
    assert.equal(rowQueries, before, 'no slot has opened for the replacement');
    assert.ok(published.length > 0, 'the policy transition notifies before queue service');
    if (keep === false) {
      assert.deepEqual(row.getSnapshot(), { loading: true });
      assert.ok(published.every(read => !('data' in read)), 'visibility ends when the change is processed');
    } else {
      assert.equal(row.getSnapshot().data?.value, 7);
      assert.equal(row.getSnapshot().revalidating, true);
    }
    watches.slice(1, 9).forEach(w => w.close());
    await until(() => row.getSnapshot().data === null, 'replacement reflects the owner transfer');
  });
}

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) for (const path of ['queued', 'presence']) {
  test(`${tier} keep=${keep}: ${path} publication rechecks a floor raised after evaluation`, async t => {
    const { url, dir } = await fixture(t), wall = Date.now(), deadline = wall + 3_600_000;
    const clock = new ServerClock(() => wall); let live;
    const fork = clock.fork.bind(clock); clock.fork = () => live = fork();
    let armed = false, crossed = false, owner, expiryOwner, hold, queries = 0;
    const original = RememberedAnswers.prototype.set;
    t.mock.method(RememberedAnswers.prototype, 'set', function(...args) {
      original.apply(this, args);
      if (!armed || crossed) return;
      // This is after evaluateLocal's floor check, before its promise unwinds to
      // the client's final publication. It requires no counted microtask delay.
      crossed = true;
      assert.equal(expiryOwner.expiredServerDeadline, undefined);
      const d = server => ({ device: null, server, localWakeup: false });
      expiryOwner.deadlines = d(deadline);
      hold = holdReadExpiry(expiryOwner, () => () => live.sample(wall, wall, wall, 'clock:2'));
      expiryOwner.deadlines = d(deadline + 60_000);
      if (path === 'queued') owner.publish({ data: { value: 8 }, complete: true, cut: null, fresh: true });
      live.sample(deadline, wall, wall, 'clock:1');
      hold.release();
      assert.equal(expiryOwner.expiredServerDeadline, deadline, 'the real sweep recorded the held deadline');
      assert.equal(live.estimatedServerNow(), wall, 'held withdrawal rolled server time back');
    });
    const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: clock.wrap(async (input, init) => {
      const endpoint = new URL(input).pathname;
      if (endpoint === '/changes') return parked(init.signal);
      const reply = await fetch(input, init), json = await reply.json();
      if (endpoint.startsWith('/q/')) { queries++; json.nextExpiry = deadline; if (path === 'presence') json.refresh = 20; }
      return Response.json(json, { status: reply.status }); // The fixture owns clock samples.
    }) });
    t.after(async () => { hold?.release(); await client.close(); }); await client.sync();
    const watch = client.observe(op, { id: 'r' }, { keep }), forbidden = [];
    watch.subscribe(() => { if (crossed && watch.getSnapshot().data?.value === 7) forbidden.push(watch.getSnapshot()); });
    t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.value === 7 && !watch.getSnapshot().revalidating);
    owner = answerObservation(watch.getSnapshot());
    assert.ok(owner);
    expiryOwner = owner;
    if (path === 'presence') {
      // Expire a matching policy peer, leaving this presence watch's snapshot
      // unchanged. Its ordinary snapshot fence must not mask the floor check.
      const peer = client.observe(op, { id: 'r' }, { keep: keep === true ? false : true });
      peer.subscribe(() => {}); t.after(() => peer.close());
      await until(() => peer.getSnapshot().data?.value === 7 && !peer.getSnapshot().revalidating);
      expiryOwner = answerObservation(peer.getSnapshot());
      clearTimeout(expiryOwner.presenceRefresh); expiryOwner.presenceRefresh = null; expiryOwner.presenceEvery = undefined;
      owner.deadlines = { device: null, server: deadline + 60_000, localWakeup: false };
      owner.publish({ data: { value: 8 }, complete: true, cut: null, fresh: true });
    }
    const newer = watch.getSnapshot();
    armed = true;
    if (path === 'queued') await client.sync();
    await until(() => crossed, 'evaluation passed its earlier floor check');
    for (let i = 0; i < 60; i++) await pause();
    assert.equal(owner.resetVersion, 0, 'a scope reset cannot mask the final floor check');
    assert.equal(forbidden.length, 0, 'the withdrawn deadline never returns to subscribers');
    assert.equal(watch.getSnapshot().data?.value, 8, 'the preserved raw answer survives the sweep and rejected body');
    if (path === 'queued') {
      const later = Date.now() + 1001; t.mock.method(Date, 'now', () => later);
      assert.equal(watch.getSnapshot().data?.value, 8, 'held expiry never starts an episode on a newer raw answer');
    }
    if (path === 'presence') assert.equal(watch.getSnapshot(), newer, 'rejection leaves the displayed answer untouched');
    assert.ok(queries >= 2);
  });
}
