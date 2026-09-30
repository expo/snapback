// @ref LLP 3000.023#10 — due-result recovery must preserve newer answers and release slots.
import test from 'node:test';
import assert from 'node:assert/strict';
// Use the same pinned dispatcher as the Node client. Node 24's bundled
// parser timeout can dereference a collected parser after mocked timers reset.
import { defaultFetch as fetch } from '../dist/node-fetch.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { ReadObservation } from '../dist/read-observation.js';
import { ServerClock } from '../dist/clock.js';
import { ReadWork } from '../dist/read-work.js';
import { server, binary, until } from './helpers/app-server.mjs';
const parked = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
const pause = () => new Promise(resolve => setImmediate(resolve));
// Mocking setTimeout also holds undici's zero-delay timers on some hosts (macOS),
// so wait by advancing only zero-delay timers while real I/O completes.
async function pump(t, predicate, label) {
  const end = performance.now() + 60_000;
  while (!predicate() && performance.now() < end) { t.mock.timers.tick(0); await pause(); }
  assert.ok(predicate(), label);
}
// @ref LLP 3000#publication-suite-under-contention — fake time advances only after the device installs its retry.
// Observe the real retry installation; parent turns do not bound device IPC.
function observeRetries(t) {
  const events = [], retry = ReadWork.prototype.retry;
  t.mock.method(ReadWork.prototype, 'retry', function(watch, delay, run) {
    const result = retry.call(this, watch, delay, run);
    events.push({ watch, delay });
    return result;
  });
  return events;
}
async function closeAfterClockAssertions(t, client, mocked) {
  // Stop reads before advancing any retry. A background loop can already be
  // asleep for one second; close joins it, so a frozen clock cannot be left
  // behind after a successful assertion or an assertion failure.
  const closing = client.close();
  if (mocked) { t.mock.timers.tick(1000); t.mock.timers.reset(); }
  await closing;
}
// Startup, first response, retry/capacity and cleanup each get a minute as a
// hang guard. The semantic 25 ms retry and every queue/count assertion remain.
const caseTimeout = 4 * 60_000;
const source = `use personas alice
table rows:
  value: int
  read <- allow
  online only
query remote(id: rows):
  return rows[id]
`;
const op = { kind: 'query', name: 'remote' };
const device = (tier, dir) => tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') })
  : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });

for (const tier of ['online', 'wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: a due completion preserves a newer answer and retries`, { timeout: caseTimeout }, async t => {
    const { url, dir } = await server(t, '', source);
    let now = Date.now(), armed = false, owner, queries = 0, mocked = false;
    const retries = observeRetries(t);
    const deadline = now + 3_600_000, clock = new ServerClock(() => now);
    const original = ReadObservation.prototype.fetch;
    t.mock.method(ReadObservation.prototype, 'fetch', async function(...args) {
      const result = await original.apply(this, args);
      if (armed && !owner && 'data' in result.read) {
        owner = this; now = deadline;
        this.publish({ data: { value: 8 }, complete: true, cut: null, fresh: true });
        this.deadlines = { device: null, server: deadline + 60_000, localWakeup: false };
      }
      return result;
    });
    const options = { url, persona: 'alice', fetch: clock.wrap(async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return parked(init.signal);
      const response = await fetch(input, init), json = await response.json();
      if (armed && path.startsWith('/q/')) {
        queries++;
        return Response.json({ ...json, data: queries === 1 ? { value: 7 } : null, nextExpiry: queries === 1 ? deadline : null });
      }
      return Response.json(json, { status: response.status });
    }) };
    const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: device(tier, dir) });
    t.after(() => closeAfterClockAssertions(t, client, mocked));
    if (client.sync) await client.sync(); else await client.query(op, { id: 'warm' });
    t.mock.timers.enable({ apis: ['setTimeout'] }); mocked = true; armed = true;
    const watch = client.observe(op, { id: 'r' }, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
    await pump(t, () => owner, 'newer answer published in the continuation gap');
    await pump(t, () => retries.some(event => event.watch === owner), 'due-result retry installed');
    assert.deepEqual(retries.map(event => event.delay), [25], 'one retry uses the original 25 ms backoff');
    assert.equal(owner.resetVersion, 0);
    assert.equal(watch.getSnapshot().data?.value, 8, 'the due attempt cannot publish synthetic loading over a newer answer');
    assert.equal(queries, 1, 'retry is paced');
    t.mock.timers.tick(25);
    await pump(t, () => watch.getSnapshot().data === null, 'paced retry publishes the current answer');
    assert.equal(queries, 2);
  });
}

for (const tier of ['wasm', 'process']) test(`${tier}: eight expiry backoffs leave capacity for a ninth observation`, { timeout: caseTimeout }, async t => {
  const { url, dir } = await server(t, '', source), clock = new ServerClock(() => 10_000);
  let armed = false, due = 0, mocked = false;
  const retries = observeRetries(t);
  const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') return parked(init.signal);
    const response = await fetch(input, init), json = await response.json();
    if (armed && path.startsWith('/q/')) {
      const id = JSON.parse(init.body).args.id;
      if (id !== 'ninth') { due++; return Response.json({ ...json, data: { value: 7 }, nextExpiry: 9_000 }); }
      return Response.json({ ...json, data: { value: 9 }, nextExpiry: null });
    }
    return Response.json(json, { status: response.status });
  }) });
  t.after(() => closeAfterClockAssertions(t, client, mocked)); await client.sync();
  t.mock.timers.enable({ apis: ['setTimeout'] }); mocked = true; armed = true;
  const watches = Array.from({ length: 8 }, (_, i) => client.observe(op, { id: String(i) }));
  watches.forEach(w => w.subscribe(() => {})); t.after(() => watches.forEach(w => w.close()));
  await pump(t, () => due === 8, 'eight already-due answers');
  await pump(t, () => retries.length === 8, 'all eight expiry backoffs installed');
  assert.equal(new Set(retries.map(event => event.watch)).size, 8, 'each distinct read owns a backoff');
  assert.deepEqual(retries.map(event => event.delay), Array(8).fill(25));
  const ninth = client.observe(op, { id: 'ninth' }); ninth.subscribe(() => {}); t.after(() => ninth.close());
  t.mock.timers.tick(0); // A new queue turn, without advancing any retry delay.
  await pump(t, () => ninth.getSnapshot().data?.value === 9, 'ninth read before the backoffs elapse');
  assert.equal(due, 8);
});

for (const keep of [undefined, false, true]) test(`online keep=${keep}: the accept-time floor does not install deadlines or retry`, async t => {
  let queries = 0, owner;
  const original = ReadObservation.prototype.fetch;
  t.mock.method(ReadObservation.prototype, 'fetch', function(run, notify, options) {
    owner = this;
    return original.call(this, async () => {
      const result = await run();
      this.expiredServerDeadline = result.nextExpiry;
      return result;
    }, notify, options);
  });
  const client = createClient({ url: 'http://accept-floor.test', persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ generation: 1, schema: { tables: {} }, programs: [] });
    if (path === '/changes') return parked(init.signal);
    if (path.startsWith('/q/')) { queries++; return Response.json({ data: 7, seq: 1, tables: [], nextExpiry: Date.now() + 3_600_000 }); }
    throw Error(path);
  } });
  t.after(() => client.close());
  const watch = client.observe(op, { id: 'r' }, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => queries === 1 && !owner.inFlight);
  assert.equal(owner.deadlines, undefined, 'the accept-time guard must precede deadline installation');
  assert.equal(queries, 1, 'floor rejection is not an acceptance retry');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
});

test('delayed retries cancel on close, yield to invalidation and rejoin FIFO', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const work = new ReadWork(), ran = []; t.after(() => work.clear());
  work.retry('closed', 25, async () => ran.push('closed'));
  assert.equal(work.cancel('closed'), true);
  work.retry('changed', 25, async () => ran.push('obsolete'));
  work.schedule('changed', async () => ran.push('current'));
  work.retry('retry', 25, async () => ran.push('retry'));
  work.schedule('queued', async () => ran.push('queued'));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(ran, ['current', 'queued']);
  t.mock.timers.tick(25);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(ran, ['current', 'queued', 'retry']);
});
