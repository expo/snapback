// @ref LLP 3000.023#10 — invalidated attempts retire; replacement queue wait precedes its episode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalClient } from '../dist/local.js';
import { createClient } from '../dist/client.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { answerObservation } from '../dist/read-observation.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { ReadWork } from '../dist/read-work.js';
import { server, binary, until } from './helpers/app-server.mjs';

const source = `use personas alice, bob
table rows:
  owner: principal
  value: int
  read <- .owner = viewer
  update <- allow
  online only
table notes:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
table blockers:
  read <- allow
  online only
query remote():
  return { row: rows['r'], count: count(notes where .owner = viewer) }
query block(id: blockers):
  return exists blockers[id]
mutation transfer():
  update rows['r'] { owner: 'dev:bob' }
mutation add():
  insert notes { owner: viewer }
`;
const op = { kind: 'query', name: 'remote' };
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error('closed'));
  else signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
});

async function fixture(t, tier, keep) {
  const { url, dir } = await server(t, '', source);
  await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([
    { table: 'rows', row: { id: 'r', owner: 'dev:alice', value: 7 } },
  ]) });
  const old = Promise.withResolvers(), replacement = Promise.withResolvers(), sync = Promise.withResolvers();
  let armed = false, changes, holdSync = false, reads = 0, blocked = 0, queue, run, owner, blocking = false;
  const attempts = new Map();
  const schedule = ReadWork.prototype.schedule;
  t.mock.method(ReadWork.prototype, 'schedule', function(watch, attempt) {
    attempts.set(watch, [this, attempt]);
    if (watch.op?.name === 'remote') { queue = this; run = attempt; }
    return schedule.call(this, watch, attempt);
  });
  const base = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') })
    : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  const options = { url, persona: 'alice', device: base, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') return new Promise((resolve, reject) => {
      changes = json => resolve(Response.json(json));
      init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (holdSync && path === '/sync') await sync.promise;
    if (blocking && path === '/q/block') { blocked++; return parked(init.signal); }
    const response = await fetch(input, init);
    if (armed && path === '/q/remote') { if (++reads === 1) await old.promise; else await replacement.promise; }
    return response;
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient(options);
  t.after(async () => { old.resolve(); replacement.resolve(); sync.resolve(); await client.close(); });
  if (client.sync) await client.sync(); else await client.query(op, {});
  const watch = client.observe(op, {}, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.row?.value === 7 && !watch.getSnapshot().revalidating);
  owner = answerObservation(watch.getSnapshot());
  return { client, watch, owner, old, replacement,
    get reads() { return reads; }, get blocked() { return blocked; },
    // Start the same acquisition callback used by the sweep, without invalidation.
    acquire() { armed = true; queue.schedule(owner, run); },
    async fill() {
      const blocks = Array.from({ length: 8 }, (_, i) => {
        const w = client.observe({ kind: 'query', name: 'block' }, { id: 'b' + i });
        w.subscribe(() => {}); t.after(() => w.close()); return w;
      });
      await until(() => blocks.every(w => 'data' in w.getSnapshot() && !w.getSnapshot().revalidating));
      // Established dependencies keep the notes apply from invalidating the blockers.
      blocking = true;
      for (const w of blocks) {
        const heldOwner = answerObservation(w.getSnapshot()), [work, attempt] = attempts.get(heldOwner);
        work.schedule(heldOwner, attempt);
      }
      return blocks;
    },
    change(json) { holdSync = true; changes(json); },
    async mutate(name) {
      const result = await fetch(url + '/m/' + name, { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
        body: JSON.stringify({ id: crypto.randomUUID(), args: {} }) }).then(r => r.json());
      assert.equal(result.state, 'sent'); return result;
    },
  };
}

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: changes retire an in-flight local server body before replacement`, async t => {
    const f = await fixture(t, tier, keep), seen = [];
    f.acquire(); await until(() => f.reads === 1);
    const result = await f.mutate('transfer');
    f.watch.subscribe(() => seen.push(f.owner.snapshot));
    f.change({ seq: result.seq, generation: 1, tables: ['rows'] });
    await until(() => f.owner.dirty || f.reads > 1, 'change processed');
    f.old.resolve(); await until(() => f.reads > 1, 'replacement started and held');
    assert.ok(seen.every(read => read.data?.row?.value !== 7 || read.revalidating), 'no completed pre-change body returns');
    if (keep === false) assert.deepEqual(f.watch.getSnapshot(), { loading: true });
    else assert.equal(f.watch.getSnapshot().revalidating, true);
    f.replacement.resolve(); await until(() => f.watch.getSnapshot().data?.row === null);
  });
}

for (const tier of ['online', 'wasm', 'process']) for (const keep of [undefined, true]) test(`${tier} keep=${keep}: invalidating an acquisition leaves replacement queue wait outside the episode`, async t => {
  const f = await fixture(t, tier, keep);
  f.acquire(); await until(() => f.reads === 1);
  assert.equal(episodeDeadline(f.watch.getSnapshot()), undefined);
  const blocks = await f.fill();
  await until(() => f.blocked === 7);
  const result = await f.mutate('add');
  if (f.client.sync) await f.client.sync();
  else { f.change({ seq: result.seq, generation: 1, tables: ['notes'] }); await until(() => f.owner.dirty); }
  const wall = Date.now(); t.mock.method(Date, 'now', () => wall + 1001);
  const queued = f.watch.getSnapshot();
  assert.equal(queued.data?.row?.value, 7, 'the replacement has not received a slot');
  assert.equal(queued.revalidating, true);
  assert.equal(episodeDeadline(queued), undefined, 'a retired attempt cannot start the new episode');
  assert.equal(f.reads, 1);
  f.old.resolve(); if (tier !== 'online') await until(() => f.blocked === 8);
  blocks.forEach(w => w.close()); await until(() => f.reads > 1);
  assert.equal(episodeDeadline(f.watch.getSnapshot()), wall + 2001);
  f.replacement.resolve();
  await until(() => f.watch.getSnapshot().data?.count === 1 && !f.watch.getSnapshot().revalidating);
});

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: the final callback checks a change version raised after evaluation`, async t => {
    const f = await fixture(t, tier, keep), seen = []; let changed = false;
    Object.defineProperty(f.owner, 'expiredRetries', { configurable: true, get: () => 0, set() {
      if (changed) return;
      // Isolate the final callback from the evaluation and early version checks.
      changed = true; f.owner.changeVersion = (f.owner.changeVersion ?? 0) + 1;
      f.owner.reload(true, { queued: true });
    } });
    f.watch.subscribe(() => { if (changed) seen.push(f.owner.snapshot); });
    f.acquire(); await until(() => f.reads === 1); f.old.resolve();
    await until(() => changed);
    for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve));
    assert.ok(seen.every(read => !('data' in read) || read.revalidating), 'no old completed body reaches subscribers');
    if (keep === false) assert.deepEqual(f.watch.getSnapshot(), { loading: true });
    else assert.equal(f.watch.getSnapshot().revalidating, true);
    f.replacement.resolve(); await until(() => f.watch.getSnapshot().data?.row?.value === 7 && !f.watch.getSnapshot().revalidating);
  });
}
