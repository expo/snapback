// @ref LLP 3000.023#7 — counts pin scheduling and dependency work at 1,000 rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadWork, READ_WORK_LIFETIME } from '../dist/read-work.js';
import { observationKey } from '../dist/observe-watch.js';
import { correctReadExpiries, armReadExpiry, holdReadExpiry, readDeadlineWithdrawn } from '../dist/read-expiry.js';
import { ReadObservation } from '../dist/read-observation.js';
import { ServerClock } from '../dist/clock.js';
import { createClient } from '../dist/client.js';
import { until } from './helpers/app-server.mjs';
const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

test('1,000 observations: at most eight starts per turn, duplicate scheduling coalesces', async () => {
  const turns = [], work = new ReadWork(run => { turns.push(run); return turns.length; });
  let starts = 0, previous = 0;
  for (let i = 0; i < 1000; i++) for (let repeat = 0; repeat < 3; repeat++) work.schedule(i, async () => { starts++; });
  await drain(); assert.equal(starts, 8);
  while (turns.length) {
    previous = starts; turns.shift()(); await drain();
    assert.ok(starts - previous <= 8, 'including every microtask continuation');
  }
  assert.equal(starts, 1000);
});
test('eight in flight, cancellation, rejection and rescheduling release capacity', async () => {
  const turns = [], work = new ReadWork(run => { turns.push(run); return turns.length; });
  let started = [], releases = [];
  for (let i = 0; i < 1000; i++) work.schedule(i, () => { started.push(i); return new Promise(resolve => releases.push(resolve)); });
  await drain(); assert.equal(started.length, 8);
  turns.shift()(); await drain(); assert.equal(started.length, 8, 'held jobs keep their slots');
  for (let i = 8; i < 999; i++) work.cancel(i);
  work.schedule(999, async () => { started.push(999); throw Error('read failed'); });
  releases.splice(0).forEach(resolve => resolve()); await drain();
  assert.deepEqual(started, [0,1,2,3,4,5,6,7,999]);
  work.schedule(1000, async () => { started.push(1000); }); await drain();
  assert.equal(started.at(-1), 1000);
  work.clear();
});
test('queued owners progress under continuing arrivals and repeated invalidation', async t => {
  const turns = [], work = new ReadWork(run => { turns.push(run); return turns.length; });
  t.after(() => work.clear());
  const started = [], releases = [];
  const run = id => () => { started.push(id); return new Promise(resolve => releases.push(resolve)); };
  for (let i = 0; i < 16; i++) work.schedule(i, run(i));
  work.schedule('waiting', run('waiting'));
  await drain(); assert.equal(started.length, 8);
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < 8; i++) work.schedule(`arrival-${turn}-${i}`, run(`arrival-${turn}-${i}`));
    // An invalidation can change the work, but cannot surrender its FIFO place.
    for (let repeat = 0; repeat < 3; repeat++) work.schedule('waiting', run('waiting'));
    releases.splice(0).forEach(resolve => resolve());
    await drain(); turns.shift()(); await drain();
    if (started.includes('waiting')) break;
  }
  assert.equal(started.indexOf('waiting'), 16, 'the owner runs after its original predecessors, before later arrivals');
});
test('active cancellation and expiry release slots without waiting for ignored aborts', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = new ReadWork(), signals = [], releases = [];
  t.after(() => work.clear());
  let ready = 0;
  for (let i = 0; i < 8; i++) work.schedule(i, signal => {
    signals.push(signal); return new Promise(resolve => releases.push(resolve));
  });
  work.schedule('later', async () => { ready++; });
  await drain(); t.mock.timers.tick(0); await drain();
  for (let i = 0; i < 8; i++) work.cancel(i);
  await drain(); assert.equal(ready, 1); assert.ok(signals.every(s => s.aborted));
  for (let i = 0; i < 8; i++) work.schedule(i, signal => { signals.push(signal); return new Promise(() => {}); });
  t.mock.timers.tick(0); await drain();
  work.schedule('after-expiry', async () => { ready++; });
  releases.forEach(resolve => resolve()); await drain();
  assert.equal(ready, 1, 'late settlements cannot release replacement attempts');
  t.mock.timers.tick(READ_WORK_LIFETIME); await drain();
  assert.equal(ready, 2); assert.ok(signals.every(s => s.aborted));
});
test('wire-equivalent arguments share a watch, retention policies stay distinct', () => {
  const op = { name: 'row' };
  assert.equal(observationKey(op, { id: 'a', filter: { y: 2, x: 1 } }), observationKey(op, { filter: { x: 1, y: 2 }, id: 'a' }));
  assert.equal(new Set([undefined, false, true].map(keep => observationKey(op, {}, { keep }))).size, 3);
  assert.notEqual(observationKey(op, { ids: [1,2] }), observationKey(op, { ids: [2,1] }));
});

test('1,000 clock-corrected observations: no/future deadlines do no evaluations; due owners coalesce', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 1000;
  const clock = new ServerClock(() => now);
  const watches = Array.from({ length: 1000 }, (_, id) => ({ id, deadlines: undefined, expiryTimer: null }));
  const arm = (w, deadlines) => armReadExpiry(w, deadlines, clock, () => true, () => {});
  const deadline = server => ({ device: null, server, localWakeup: false });
  for (let i = 0; i < 500; i++) arm(watches[i], deadline(2000));
  const evaluations = [], withdrawn = [], delivered = [];
  const noDue = () => correctReadExpiries(watches, clock, () => assert.fail('no deadline due'), arm, w => evaluations.push(w.id));
  noDue(); assert.deepEqual(evaluations, []);
  assert.equal(watches[499].deadlines.server, 2000, 'future deadlines stay armed');
  // Two independently held facade answers for one owner must not duplicate its work.
  for (let i = 0; i < 2; i++) {
    arm(watches[3], deadline(1500));
    holdReadExpiry(watches[3], () => { withdrawn.push('held' + i); return () => delivered.push('held' + i); });
  }
  arm(watches[3], deadline(2000));
  for (let i = 0; i < 3; i++) arm(watches[i], deadline(1500));
  now = 1500;
  correctReadExpiries(watches, clock, w => {
    withdrawn.push(w.id); return () => { assert.equal(withdrawn.length, 5, 'all held/raw withdrawals precede callbacks'); delivered.push(w.id); };
  }, arm, w => { assert.equal(delivered.length, 5); evaluations.push(w.id); });
  assert.deepEqual(new Set(evaluations), new Set([0, 1, 2, 3]));
  assert.equal(evaluations.length, 4, 'one reevaluation per due owner, including held-only expiry');
  assert.equal(watches[3].deadlines.server, 2000, 'held expiry does not erase a newer raw deadline');
  evaluations.length = 0;
  now = 1000;
  noDue(); assert.deepEqual(evaluations, [], 'clock rollback cannot revive due work');
});

test('online 1,000 rows: N relevant evaluations, zero unrelated, eight concurrent requests', async t => {
  let seq = 1, calls = 0, active = 0, peak = 0, release;
  const client = createClient({ url: 'http://per-row.test', persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ generation: 1, schema: { tables: {} }, programs: [] });
    if (path === '/changes') return new Promise((resolve, reject) => {
      release = tables => resolve(Response.json({ seq: ++seq, generation: 1, tables }));
      init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path.startsWith('/q/')) {
      calls++; peak = Math.max(peak, ++active);
      await new Promise(resolve => setImmediate(resolve)); active--;
      return Response.json({ data: { id: JSON.parse(init.body).args.id, seq }, complete: true, seq, tables: ['cards'] });
    }
    throw Error(path);
  } });
  const op = { kind: 'query', name: 'point' };
  await client.query(op, { id: 'warm' }); calls = 0; peak = 0;
  const watches = Array.from({ length: 1000 }, (_, id) => client.observe(op, { id }));
  watches.forEach(w => w.subscribe(() => {}));
  t.after(async () => { watches.forEach(w => w.close()); await client.close(); });
  const ready = () => watches.every(w => w.getSnapshot().data?.seq === seq && !w.getSnapshot().revalidating);
  await until(ready, 'initial rows', 15000);
  assert.equal(calls, 1000); assert.ok(peak <= 8);
  calls = 0;
  let withdrawals = 0;
  watches.forEach(w => w.subscribe(() => { if (w.getSnapshot().loading) withdrawals++; }));
  const change = release; change(['cards']);
  await until(() => release !== change, 'next poll');
  assert.equal(withdrawals, 0, 'queued revalidation preserves every old answer');
  await until(ready, 'replacement rows', 15000);
  assert.equal(calls, 1000); assert.ok(peak <= 8);
  calls = 0; const unrelated = release; unrelated(['notes']);
  await until(() => release !== unrelated, 'unrelated change processed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.ok(watches.every(w => w.getSnapshot().data));
});

for (const tier of ['wasm', 'process']) test(`${tier} 1,000 rows: known apply, empty apply, unrelated apply and duplicate hooks`, { timeout: 30000 }, async t => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { server, binary } = await import('./helpers/app-server.mjs');
  const { createLocalClient } = await import('../dist/local.js');
  const { processDevice } = await import('../dist/native.js');
  const { webDevice, memoryPersistence } = await import('../dist/web.js');
  const { url, dir } = await server(t, '', readFileSync(new URL('../../../witness/per-row.q', import.meta.url), 'utf8'));
  const rows = Array.from({ length: 1000 }, (_, slot) => ({ table: 'cards', row: { id: 'c' + slot, slot, owner: 'dev:alice', label: 'original' } }));
  assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json())).seeded, 1000);
  const underlying = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });
  let calls = 0;
  const client = await createLocalClient({ url, persona: 'alice', device: { async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, call(request, committed) { if (request.op === 'query') calls++; return core.call(request, committed); } };
  } }, fetch: async (input, init) => {
    if (new URL(input).pathname === '/changes') return new Promise((_, reject) => {
      if (init.signal.aborted) reject(Error('closed'));
      else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    return fetch(input, init);
  } });
  t.after(() => client.close());
  await client.sync(); calls = 0;
  const op = { kind: 'query', name: 'point' };
  const watches = Array.from({ length: 1000 }, (_, i) => client.observe(op, { id: 'c' + i }));
  watches.forEach(w => w.subscribe(() => {})); t.after(() => watches.forEach(w => w.close()));
  const ready = () => watches.every(w => w.getSnapshot().data && !w.getSnapshot().revalidating);
  await until(ready, 'mount 1000', 15000); assert.equal(calls, 1000);
  calls = 0; await client.sync(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 0, 'empty apply does no query work');
  const write = (name, args) => fetch(url + '/m/' + name, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ id: crypto.randomUUID(), args }) }).then(r => r.json());
  assert.equal((await write('unrelated', {})).state, 'sent');
  await client.sync(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 0, 'known unrelated write does no query work');
  assert.equal((await write('edit', { id: 'c0', label: 'changed' })).state, 'sent');
  await client.sync(); await until(() => ready() && watches[0].getSnapshot().data.label === 'changed', 'relevant apply', 15000);
  assert.equal(calls, 1000, 'one reevaluation per distinct table-dependent observation');
  calls = 0;
  const duplicates = Array.from({ length: 1000 }, () => client.observe(op, { id: 'c0' }));
  duplicates.forEach(w => w.subscribe(() => {}));
  assert.ok(duplicates.every(w => w.getSnapshot().data.label === 'changed'));
  duplicates.forEach(w => w.close());
  assert.equal(calls, 0, 'duplicates attach to the existing observation');
});

test('withdrawn server deadlines survive revalidation and held expiry, but real resets clear them', () => {
  let now = 0;
  const clock = new ServerClock(() => now), watch = new ReadObservation();
  const arm = (w, d) => armReadExpiry(w, d, clock, () => true, () => {});
  const d = server => ({ device: null, server, localWakeup: false });
  arm(watch, d(1000));
  const held = holdReadExpiry(watch, () => () => {});
  arm(watch, d(2000));
  now = 1000;
  correctReadExpiries([watch], clock, w => w.expire(), arm, () => {});
  assert.equal(readDeadlineWithdrawn([watch], 1000), true, 'held answers also record the withdrawn deadline');
  assert.equal(readDeadlineWithdrawn([watch], 2000), false, 'a newer raw deadline remains valid');
  watch.reload();
  assert.equal(readDeadlineWithdrawn([watch], 999), true);
  watch.reset({ loading: true });
  assert.equal(readDeadlineWithdrawn([watch], 1000), false, 'changed authority starts a new deadline scope');
  held.release(); clearTimeout(watch.expiryTimer);
});
