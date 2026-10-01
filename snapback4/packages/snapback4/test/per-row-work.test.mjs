import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.023#10 — counts pin scheduling and dependency work at 1,000 rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadWork, READ_WORK_LIFETIME, withReadSignal } from '../dist/read-work.js';
import { getEventListeners } from 'node:events';
import { observationKey } from '../dist/observe-watch.js';
import { correctReadExpiries, armReadExpiry, holdReadExpiry, readDeadlineWithdrawn } from '../dist/read-expiry.js';
import { ReadObservation } from '../dist/read-observation.js';
import { ServerClock } from '../dist/clock.js';
import { createClient } from '../dist/client.js';
import { until } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function installGlobal(t, name, value) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name]; });
}

test('rejected postTask turns recover through host tasks and remain cancellable', async t => {
  installGlobal(t, 'scheduler', { postTask: () => Promise.reject(Error('host rejected task')) });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = new ReadWork(); t.after(() => work.clear());
  let starts = 0, active = 0, peak = 0;
  for (let i = 0; i < 24; i++) work.schedule(i, async () => {
    starts++; peak = Math.max(peak, ++active); await Promise.resolve(); active--;
  });
  await drain(); assert.equal(starts, 8, 'a rejection microtask grants no extra starts');
  for (const expected of [16, 24]) {
    t.mock.timers.tick(0); await drain();
    assert.equal(starts, expected, 'a fallback host turn resets and re-arms capacity');
  }
  assert.ok(peak <= 8);
  work.schedule('cancelled', async () => { assert.fail('cleared work ran'); });
  work.clear(); t.mock.timers.tick(0); await drain();
  work.schedule('replacement', async () => { starts++; });
  await drain(); assert.equal(starts, 24, 'clear cannot grant a fresh allowance');
  t.mock.timers.tick(0); await drain(); assert.equal(starts, 25);
});

async function readyBatch(t, count, firstListener = () => {}) {
  let seq = 1, change;
  const replies = [], seen = [], observations = [];
  const client = createClient({ url: 'http://ready-listeners.test', persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
    if (path === '/changes') return new Promise((resolve, reject) => {
      change = () => resolve(Response.json({ seq, generation: 1, tables: ['cards'] }));
      init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path.startsWith('/q/')) {
      if (seq === 1) return Response.json({ data: 1, seq, tables: ['cards'] });
      return new Promise((resolve, reject) => {
        replies.push(() => resolve(Response.json({ data: 2, seq: 2, tables: ['cards'] })));
        init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
    }
    throw Error(path);
  } });
  t.after(async () => { observations.forEach(w => w.close()); await client.close(); });
  const op = { kind: 'query', name: 'row' };
  await client.query(op, {});
  for (let id = 0; id < count; id++) {
    const w = client.observe(op, { id }); observations.push(w);
    if (id === 0) w.subscribe(() => firstListener(w.getSnapshot()));
    w.subscribe(() => { seen[id] = w.getSnapshot(); });
  }
  await until(() => seen.filter(r => r?.data === 1).length === count && change, 'initial batch');
  const spin = async predicate => {
    for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(setImmediate);
    assert.ok(predicate(), 'fixture reached the requested boundary');
  };
  return { seen, observations, async replace() {
    seq = 2; change(); await spin(() => replies.length === 8);
    replies.splice(0, 8).forEach(resolve => resolve());
    await spin(() => observations.slice(0, 8).every(w => w.getSnapshot().data === 2));
  } };
}

for (const flush of ['timer', 'drained']) test(`throwing ready subscriber: ${flush} flush delivers every callback and reports the error`, async t => {
  const failure = Error('subscriber failed'), errors = [];
  const batch = await readyBatch(t, flush === 'timer' ? 32 : 8, read => { if (read.data === 2) throw failure; });
  t.mock.method(console, 'error', (...args) => errors.push(args));
  installGlobal(t, 'window', globalThis); installGlobal(t, 'document', {});
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  await batch.replace();
  if (flush === 'timer') {
    assert.ok(batch.seen.slice(0, 8).every(r => r.data === 1));
    assert.doesNotThrow(() => t.mock.timers.tick(50), 'raw listener errors cannot escape the host timer');
  }
  assert.deepEqual(batch.seen.slice(0, 8).map(r => r.data), Array(8).fill(2), 'same-watch and later-row listeners all receive publication');
  assert.deepEqual(errors, [['snapback4 client listener:', failure]], 'use the existing facade listener error channel');
  t.mock.timers.tick(1000); await drain();
  assert.ok(batch.seen.slice(0, 8).every(r => r.data === 2), 'accepted replacements remain visible after the original deadline');
});

for (const api of ['postTask', 'MessageChannel', 'timer']) test(`React Native ready notifications use one timer turn with ${api}`, async t => {
  const batch = await readyBatch(t, 32);
  installGlobal(t, 'window', globalThis);
  installGlobal(t, 'navigator', { product: 'ReactNative' });
  installGlobal(t, 'document', undefined);
  installGlobal(t, 'scheduler', api === 'postTask' ? { postTask(run) {
    return new Promise(resolve => setTimeout(() => { run(); resolve(); }, 0));
  } } : undefined);
  if (api !== 'MessageChannel') installGlobal(t, 'MessageChannel', undefined);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  await batch.replace();
  assert.ok(batch.seen.slice(0, 8).every(r => r.data === 1), 'callbacks coalesce while a backlog remains');
  t.mock.timers.tick(0); await drain();
  assert.deepEqual(batch.seen.slice(0, 8).map(r => r.data), Array(8).fill(2), 'window = global must not add the browser 50 ms window');
});

for (const host of ['postTask', 'MessageChannel']) test(`${host}: browser turns preserve eight starts and cancel queued service`, async t => {
  const turns = [];
  const install = (name, value) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name]; });
  };
  if (host === 'postTask') install('scheduler', { postTask(run, { signal }) {
    return new Promise((resolve, reject) => {
      const stopped = () => reject(signal.reason);
      signal.addEventListener('abort', stopped, { once: true });
      turns.push({ cancelled: () => signal.aborted, run() {
        signal.removeEventListener('abort', stopped);
        if (!signal.aborted) { run(); resolve(); }
      } });
    });
  } });
  else {
    install('scheduler', undefined); install('window', {});
    install('MessageChannel', class {
      closed = 0;
      port1 = { onmessage: null, close: () => { this.closed++; } };
      port2 = { close: () => { this.closed++; }, postMessage: () => turns.push({
        cancelled: () => this.closed === 2,
        run: () => this.port1.onmessage?.(),
      }) };
    });
  }
  const work = new ReadWork(); t.after(() => work.clear());
  let starts = 0;
  for (let i = 0; i < 1000; i++) work.schedule(i, async () => { starts++; });
  await drain(); assert.equal(starts, 8);
  while (starts < 1000) {
    assert.equal(turns.length, 1, 'one host task owns the next allowance');
    const before = starts; turns.shift().run(); await drain();
    assert.ok(starts - before <= 8, 'promise continuations cannot exceed the task allowance');
  }
  assert.equal(starts, 1000);
  assert.equal(turns.length, 1);
  work.clear(); assert.equal(turns[0].cancelled(), true);
  turns.shift().run(); await drain(); assert.equal(starts, 1000, 'clear cancels service');
});

// Deliberately hold capacity and the browser's positive notification window.
// Publication must not retire the displayed predecessor's withdrawal boundary.
for (const boundary of ['episode', 'old-row', 'new-row', 'empty', 'null']) test(`ready batching respects ${boundary} withdrawal evidence`, async t => {
  let seq = 1, change;
  const replies = [], seen = [], observations = [];
  const expiry = Date.now() + 60_000;
  const spin = async predicate => {
    for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(setImmediate);
    assert.ok(predicate(), 'fixture reached the requested boundary');
  };
  const client = createClient({ url: 'http://ready-boundary.test', persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
    if (path === '/changes') return new Promise((resolve, reject) => {
      change = () => resolve(Response.json({ seq, generation: 1, tables: ['cards'] }));
      init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
    });
    if (path.startsWith('/q/')) {
      if (seq === 1) return Response.json({ data: 1, seq, tables: ['cards'], nextExpiry: boundary === 'old-row' ? expiry : null });
      return new Promise((resolve, reject) => {
        replies.push(() => resolve(Response.json({ data: boundary === 'empty' ? [] : boundary === 'null' ? null : 2,
          seq: 2, tables: ['cards'], nextExpiry: boundary === 'new-row' ? expiry : null })));
        init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
      });
    }
    throw Error(path);
  } });
  t.after(async () => { observations.forEach(w => w.close()); await client.close(); });
  const op = { kind: 'query', name: 'row' };
  await client.query(op, {});
  for (let id = 0; id < 32; id++) {
    const w = client.observe(op, { id }); observations.push(w);
    w.subscribe(() => { seen[id] = w.getSnapshot(); });
  }
  await until(() => seen.filter(r => r?.data === 1).length === 32 && change, 'initial rows');
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  installGlobal(t, 'document', {});
  t.after(() => { if (prior) Object.defineProperty(globalThis, 'window', prior); else delete globalThis.window; });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  seq = 2; change(); await spin(() => replies.length === 8);
  if (boundary === 'episode') t.mock.timers.tick(975);
  replies.splice(0, 8).forEach(resolve => resolve());
  await spin(() => observations.slice(0, 8).every(w => 'data' in w.getSnapshot() && w.getSnapshot().data !== 1));
  if (boundary === 'episode') {
    assert.equal(seen[0].data, 1, 'positive callbacks can coalesce before the boundary');
    t.mock.timers.tick(25); await drain();
    assert.equal(seen[0].data, 2, 'retiring the episode timer cannot extend the displayed old answer');
    assert.ok(seen.slice(16).every(r => r.loading), 'unanswered owners still withdraw at the original second');
  } else {
    assert.deepEqual(seen[0].data, boundary === 'empty' ? [] : boundary === 'null' ? null : 2,
      'empty results and either side of a row deadline notify without entering a ready batch');
  }
});

for (const outcome of ['success', 'rejection']) test(`request abort listeners are removed after ${outcome}`, async () => {
  const lifetime = new AbortController();
  for (let request = 0; request < 3; request++) {
    const attempt = new AbortController(), pending = Promise.withResolvers();
    let combined;
    const result = withReadSignal(attempt.signal, lifetime.signal, signal => {
      combined = signal; return pending.promise;
    });
    assert.equal(getEventListeners(attempt.signal, 'abort').length, 1);
    assert.equal(getEventListeners(lifetime.signal, 'abort').length, 1);
    if (outcome === 'success') {
      pending.resolve(request); assert.equal(await result, request);
    } else {
      const failure = Error('request rejected');
      pending.reject(failure); await assert.rejects(result, error => error === failure);
    }
    assert.equal(getEventListeners(attempt.signal, 'abort').length, 0, 'attempt listener removed');
    assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0, 'lifetime listener removed');
    attempt.abort(); assert.equal(combined.aborted, false, 'finished request is detached');
  }
});

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
  await until(ready, 'initial rows', { work: 1000 });
  assert.equal(calls, 1000); assert.ok(peak <= 8);
  calls = 0;
  let withdrawals = 0;
  watches.forEach(w => w.subscribe(() => { if (w.getSnapshot().loading) withdrawals++; }));
  const change = release; change(['cards']);
  await until(() => release !== change, 'next poll');
  assert.equal(withdrawals, 0, 'queued revalidation preserves every old answer');
  await until(ready, 'replacement rows', { work: 1000 });
  assert.equal(calls, 1000); assert.ok(peak <= 8);
  calls = 0; const unrelated = release; unrelated(['notes']);
  await until(() => release !== unrelated, 'unrelated change processed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.ok(watches.every(w => w.getSnapshot().data));
});

for (const tier of ['wasm', 'process']) test(`${tier} 1,000 rows: known apply, empty apply, unrelated apply and duplicate hooks`, { timeout: hangBudget(1000) }, async t => {
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
    // This test owns sync explicitly. Keep its parked feed healthy while
    // 1,000 real device calls run, independent of host scheduling.
    if (new URL(input).pathname === '/changes') return parkedChanges(init.signal);
    return fetch(input, init);
  } });
  t.after(() => client.close());
  await client.sync(); calls = 0;
  const op = { kind: 'query', name: 'point' };
  const watches = Array.from({ length: 1000 }, (_, i) => client.observe(op, { id: 'c' + i }));
  watches.forEach(w => w.subscribe(() => {})); t.after(() => watches.forEach(w => w.close()));
  const ready = () => watches.every(w => w.getSnapshot().data && !w.getSnapshot().revalidating);
  await until(ready, 'mount 1000', { work: 1000 }); assert.equal(calls, 1000);
  calls = 0; await client.sync(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 0, 'empty apply does no query work');
  const write = (name, args) => fetch(url + '/m/' + name, { method: 'POST', headers: { 'x-snapback-persona': 'alice' }, body: JSON.stringify({ id: crypto.randomUUID(), args }) }).then(r => r.json());
  assert.equal((await write('unrelated', {})).state, 'sent');
  await client.sync(); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 0, 'known unrelated write does no query work');
  assert.equal((await write('edit', { id: 'c0', label: 'changed' })).state, 'sent');
  await client.sync(); await until(() => ready() && watches[0].getSnapshot().data.label === 'changed', 'relevant apply', { work: 1000 });
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
