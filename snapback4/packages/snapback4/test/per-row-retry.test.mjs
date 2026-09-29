// @ref LLP 3000.023#10 — due-result recovery must preserve newer answers and release slots.
import test from 'node:test';
import assert from 'node:assert/strict';
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
  const end = performance.now() + 5000;
  while (!predicate() && performance.now() < end) { t.mock.timers.tick(0); await pause(); }
  assert.ok(predicate(), label);
}
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
  test(`${tier} keep=${keep}: a due completion preserves a newer answer and retries`, async t => {
    const { url, dir } = await server(t, '', source);
    let now = Date.now(), armed = false, owner, queries = 0;
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
    t.after(() => client.close());
    if (client.sync) await client.sync(); else await client.query(op, { id: 'warm' });
    t.mock.timers.enable({ apis: ['setTimeout'] }); armed = true;
    const watch = client.observe(op, { id: 'r' }, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
    await pump(t, () => owner, 'newer answer published in the continuation gap');
    for (let i = 0; i < 60; i++) await pause();
    assert.equal(owner.resetVersion, 0);
    assert.equal(watch.getSnapshot().data?.value, 8, 'the due attempt cannot publish synthetic loading over a newer answer');
    assert.equal(queries, 1, 'retry is paced');
    t.mock.timers.tick(25);
    await pump(t, () => watch.getSnapshot().data === null, 'paced retry publishes the current answer');
    assert.equal(queries, 2);
  });
}

for (const tier of ['wasm', 'process']) test(`${tier}: eight expiry backoffs leave capacity for a ninth observation`, async t => {
  const { url, dir } = await server(t, '', source), clock = new ServerClock(() => 10_000);
  let armed = false, due = 0;
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
  t.after(async () => { t.mock.timers.tick(1000); await client.close(); }); await client.sync();
  t.mock.timers.enable({ apis: ['setTimeout'] }); armed = true;
  const watches = Array.from({ length: 8 }, (_, i) => client.observe(op, { id: String(i) }));
  watches.forEach(w => w.subscribe(() => {})); t.after(() => watches.forEach(w => w.close()));
  await pump(t, () => due === 8, 'eight already-due answers');
  for (let i = 0; i < 60; i++) await pause();
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
