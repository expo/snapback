import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { ServerClock, onClock, clockDelay } from '../dist/clock.js';
import { ReadObservation, answerIdentity } from '../dist/read-observation.js';

const read = { kind: 'query', name: 'read' };
const backend = { generation: 1, schema: { tables: {} }, programs: [
  { name: 'read', kind: 'Query', args: {}, body: [] },
  { name: 'server', kind: 'Query', args: {}, body: [], runs: 'server' },
] };
// Drain the full microtask queue without advancing the mocked Date/timers.
const drain = () => new Promise(resolve => setImmediate(resolve));
async function close(client, t) {
  let done = false;
  const closing = client.close().finally(() => { done = true; });
  for (let n = 0; n < 10 && !done; n++) { t.mock.timers.tick(1000); await drain(); }
  assert.ok(done, 'close drains bounded in-flight timer work');
  await closing;
}
const parked = signal => new Promise((_, reject) => {
  if (signal?.aborted) reject(signal.reason);
  else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
});

// Real clients and clock, with only wire/device answers controlled. Date and
// timer delivery move together; each turn drains the asynchronous publications.
function fixture(t, tier) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const f = { offset: 120_000, revision: 0, offline: false, requests: 0, deviceReads: 0, meta: new Map(), outcome: undefined, serverOutcome: undefined };
  const core = { async close() {}, async call(request) {
    switch (request.op) {
      case 'meta': return { ok: f.meta.get(request.key) ?? null };
      case 'set_meta': f.meta.set(request.key, request.value); return { ok: null };
      case 'backend': return { ok: backend };
      case 'state': return { ok: { generation: 1, watermark: 0 } };
      case 'sync_state': return { ok: { receipt_outcomes: true, outbox_status: true, acquired: true, backend_required: false, store_id: 'clock', watermark: 0,
        generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [] } };
      case 'next_submission': return { ok: 1 };
      case 'queued': return { ok: [] };
      case 'observe_store': return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {}, adoption_capture: {} } };
      case 'apply': return { ok: { touched: [] } };
      // U remembers a server answer only for an executed speculative local
      // observation, never for a missing program or a withheld observation.
      case 'query': f.deviceReads++; return { ok: request.name === 'server'
        ? { data: [], unknown: true, speculative: true, complete: false, tables: [], nextExpiry: null }
        : await f.outcome?.(request) ?? (tier === 'composition'
        ? { data: { remote: [], kept: [] }, complete: false, tables: [], nextExpiry: null, components: { remote: { unknown: true }, kept: { retained: true, complete: true } } }
        : { data: [], complete: false, unknown: true, tables: [], nextExpiry: null }) };
      case 'keep_write': return { ok: null };
      default: throw Error('unexpected device request: ' + request.op);
    }
  } };
  f.options = { url: 'http://clock.invalid', persona: 'alice', device: { open: async () => core }, fetch: async (input, init) => {
    if (f.offline) throw Error('offline');
    const path = new URL(input).pathname;
    const headers = { 'x-snapback-time': String(Date.now() + f.offset), 'x-snapback-clock': 'host:' + f.revision };
    let body;
    if (path === '/changes') return parked(init.signal);
    if (path === '/schema') body = backend;
    else if (path === '/sync') body = { generation: 1, snapshot: false, events: [], watermark: 0, images_at: 0, more: false, store_id: 'clock' };
    else if (path === '/probe') body = { ok: true, seq: 0, store_id: 'clock' };
    else if (path.startsWith('/q/')) {
      if (path === '/q/read') f.requests++;
      body = f.serverOutcome?.() ?? { data: tier === 'composition' ? { remote: ['live'], kept: ['server'] } : ['live'], complete: true,
        tables: [], seq: 0, store_id: 'clock', nextExpiry: Date.now() + f.offset + 1000 };
    } else throw Error('unexpected path: ' + path);
    return Response.json(body, { headers });
  } };
  f.open = () => tier === 'online' ? createClient(f.options) : createLocalClient(f.options);
  return f;
}

for (const tier of ['online', 'fallback', 'composition']) test(`${tier}: a deadline behind the issued floor does not loop server refetches`, { timeout: hangBudget(6) }, async t => {
  const f = fixture(t, tier), client = await f.open();
  t.after(() => close(client, t));
  await client.query(read, {});
  const floor = client.now();
  f.offset = 0; f.revision++;
  await client.query({ kind: 'query', name: 'clockProbe' }, {});
  assert.equal(client.now(), floor, 'device time stays frozen above the live server deadline');
  f.requests = 0;
  const watch = client.observe(read, {}); watch.subscribe(() => {});
  await drain();
  assert.ok('data' in watch.getSnapshot());
  for (let n = 0; n < 120; n++) { t.mock.timers.tick(1); await drain(); }
  assert.equal(f.requests, 1, 'no expiry request before the unfloored server deadline');
  t.mock.timers.tick(1000); await drain();
  assert.ok(f.requests >= 2 && f.requests <= 3, 'the server deadline refetches with at most one clock-correction rerun');
  watch.close();
});

test('syncedAt, device since and remembered server since remain wall time under +25h skew', async t => {
  const f = fixture(t, 'fallback'); f.offset = 90_000_000;
  const client = await f.open(); t.after(() => close(client, t));
  assert.equal(Number(f.meta.get('syncedAt:wall:1')), Date.now());
  const remote = { kind: 'query', name: 'server', runs: 'server' };
  const remoteAnswer = await client.query(remote, {});
  assert.ok('data' in remoteAnswer);
  const observation = new ReadObservation(); observation.publish(remoteAnswer);
  let release;
  const replacing = observation.fetch(() => new Promise(resolve => { release = resolve; }), () => {}, { retain: true });
  assert.equal(observation.snapshot.since, remoteAnswer.since, 'retention leaves the original freshness age unchanged');
  assert.equal(observation.snapshot.fresh, remoteAnswer.fresh);
  assert.equal(observation.snapshot.revalidating, true);
  release({ read: remoteAnswer }); await replacing;
  f.outcome = () => ({ data: ['kept'], complete: true, tables: [], nextExpiry: null });
  f.offline = true; await client.sync();
  const local = await client.query(read, {}), remembered = await client.query(remote, {});
  assert.deepEqual(remembered.data, ['live']); assert.equal(remembered.fresh, false);
  assert.equal(local.since, Date.now());
  assert.equal(remembered.since, Date.now());
  assert.equal(client.now() - local.since, 90_000_000, 'execution time is independent of freshness age');
});

test('held device publication enforces the 16.7ms frame bound with controlled scheduling', async t => {
  const f = fixture(t, 'fallback'), deadline = Date.now() + f.offset + 300;
  f.outcome = request => ({ data: request.now < deadline ? ['typing'] : [], complete: true, tables: [], nextExpiry: request.now < deadline ? deadline : null });
  const client = await f.open(); t.after(() => close(client, t));
  const watch = client.observe({ ...read, held: true }, {}), removals = [];
  watch.subscribe(() => { if (watch.getSnapshot().data?.length === 0) removals.push(client.now() - deadline); });
  await drain(); assert.deepEqual(watch.getSnapshot().data, ['typing']);
  t.mock.timers.tick(299); await drain(); assert.deepEqual(watch.getSnapshot().data, ['typing']);
  t.mock.timers.tick(1); await drain();
  t.mock.timers.tick(16); await drain();
  assert.equal(removals.length, 1, 'the deadline must publish before the next frame, not 500ms later');
  assert.ok(removals[0] >= 0 && removals[0] <= 16.7, String(removals));
  watch.close();
});

test('a one-millisecond recovered floor crossing republishes a held deadline immediately', async t => {
  const f = fixture(t, 'fallback'), open = f.options.device.open;
  f.options.device.open = async () => ({ ...await open(), onOutbox(listener) { f.recover = listener; return () => {}; } });
  const deadline = Date.now() + f.offset + 4000;
  f.outcome = request => ({ data: request.now < deadline ? ['typing'] : [], complete: true, tables: [], nextExpiry: request.now < deadline ? deadline : null });
  const client = await f.open(); t.after(() => close(client, t));
  f.recover(deadline - 1);
  const watch = client.observe({ ...read, held: true }, {}); watch.subscribe(() => {});
  await drain(); assert.deepEqual(watch.getSnapshot().data, ['typing']);
  const wall = Date.now();
  f.recover(deadline); await drain();
  assert.equal(Date.now(), wall, 'no wall-time timer was delivered');
  assert.equal(client.now(), deadline);
  assert.deepEqual(watch.getSnapshot().data, [], 'even a 1ms recovered shift reschedules the frozen deadline');
  watch.close();
});

for (const earlier of ['device', 'server']) test(`composition publishes at both deadlines, ${earlier} first`, async t => {
  const f = fixture(t, 'composition');
  const start = Date.now() + f.offset;
  const deviceDeadline = start + (earlier === 'device' ? 300 : 600);
  const serverDeadline = start + (earlier === 'server' ? 300 : 600);
  f.outcome = request => ({ data: { remote: [], kept: request.now < deviceDeadline ? ['typing'] : [] }, complete: false,
    tables: [], nextExpiry: request.now < deviceDeadline ? deviceDeadline : null,
    components: { remote: { unknown: true }, kept: { retained: true, complete: true } } });
  f.serverOutcome = () => ({ data: { remote: Date.now() + f.offset < serverDeadline ? ['live'] : [], kept: ['server'] },
    complete: true, tables: [], seq: 0, store_id: 'clock', nextExpiry: Date.now() + f.offset < serverDeadline ? serverDeadline : null });
  const client = await f.open(); t.after(() => close(client, t));
  const watch = client.observe(read, {}); watch.subscribe(() => {});
  await drain(); assert.deepEqual(watch.getSnapshot().data, { remote: ['live'], kept: ['typing'] });
  t.mock.timers.tick(299); await drain();
  assert.deepEqual(watch.getSnapshot().data, { remote: ['live'], kept: ['typing'] });
  t.mock.timers.tick(1); await drain();
  assert.deepEqual(watch.getSnapshot().data, earlier === 'device' ? { remote: ['live'], kept: [] } : { remote: [], kept: ['typing'] });
  t.mock.timers.tick(300); await drain();
  assert.deepEqual(watch.getSnapshot().data, { remote: [], kept: [] });
  watch.close();
});

test('offline upgrades omit ambiguous round-zero syncedAt until a wall-time resync', async t => {
  const f = fixture(t, 'fallback'); f.offset = 90_000_000; f.offline = true;
  f.meta.set('syncedAt', String(Date.now() + f.offset));
  f.meta.set('server-clock', JSON.stringify({ offset: f.offset, last: 0 }));
  f.outcome = () => ({ data: ['kept'], complete: true, tables: [], nextExpiry: null });
  const client = await f.open(); t.after(() => close(client, t));
  const readback = await client.query(read, {});
  assert.deepEqual(readback.data, ['kept']);
  assert.equal(readback.fresh, false);
  assert.equal(readback.since, undefined, 'legacy metadata has no unambiguous clock domain');
  f.offline = false; await client.sync();
  assert.equal(Number(f.meta.get('syncedAt:wall:1')), Date.now());
  f.offline = true; await client.sync();
  assert.equal((await client.query(read, {})).since, Date.now());
});

test('an offline reopen clamps versioned freshness saved before a wall rollback', async t => {
  const f = fixture(t, 'fallback'); f.offline = true;
  f.meta.set('syncedAt:wall:1', String(Date.now() + 4000));
  f.outcome = () => ({ data: ['kept'], complete: true, tables: [], nextExpiry: null });
  const client = await f.open(); t.after(() => close(client, t));
  assert.equal((await client.query(read, {})).since, Date.now());
});

test('freshness is clamped at publication after wall time rolls back', async t => {
  const f = fixture(t, 'fallback');
  const client = await f.open(); t.after(() => close(client, t));
  const remote = { kind: 'query', name: 'server', runs: 'server' };
  const response = await client.query(remote, {});
  const observation = new ReadObservation(); observation.publish(response);
  f.outcome = () => ({ data: ['kept'], complete: true, tables: [], nextExpiry: null });
  f.offline = true; await client.sync();
  t.mock.timers.setTime(Date.now() - 4000);
  assert.equal((await client.query(read, {})).since, Date.now());
  const remembered = await client.query(remote, {});
  assert.deepEqual(remembered.data, ['live']); assert.equal(remembered.fresh, false);
  assert.equal(remembered.since, Date.now());
  let release;
  const replacing = observation.fetch(() => new Promise(resolve => { release = resolve; }), () => {}, { retain: true });
  assert.equal(observation.snapshot.since, response.since, 'revalidation does not synthesize a freshness age after rollback');
  assert.equal(observation.snapshot.fresh, response.fresh);
  assert.equal(observation.snapshot.revalidating, true);
  release({ read: response }); await replacing;
  observation.publish({ ...response, fresh: false, since: Date.now() + 4000 });
  assert.equal(observation.snapshot.since, Date.now(), 'explicit since is also clamped on publication');
});

// Execute the actual hook with React's render and effect installation separated.
// The browser suite separately owns real React/Strict Mode lifecycle coverage.
for (const gap of ['deadline', 'correction', 'correction-before-deadline']) test(`useNow catches ${gap} between render and effect installation`, () => {
  let wall = 1000, effect, updates = 0;
  const clock = new ServerClock(() => wall), timers = new Map();
  const source = readFileSync(new URL('../src/react.tsx', import.meta.url), 'utf8').match(/export function useNow[\s\S]*?\n}/)[0].replace('export ', '');
  const hook = runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + '\nuseNow;', {
    useClient: () => ({ now: clock.issuedDeviceNow }), useState: () => [0, () => updates++], useEffect: setup => { effect = setup; },
    onClock, clockDelay, setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; }, clearTimeout: id => timers.delete(id),
  });
  assert.equal(hook(gap === 'correction-before-deadline' ? 1100 : 1001), 1000);
  if (gap === 'deadline') wall = 1002;
  else clock.sample(gap === 'correction-before-deadline' ? 1050 : 1200, 1000, 1000, 'host:0');
  const cleanup = effect();
  assert.equal(updates, 1, 'exactly one catch-up render is requested');
  assert.equal(timers.size, gap === 'correction-before-deadline' ? 1 : 0);
  if (timers.size) assert.deepEqual([...timers.values()], [50], 'the timer uses the correction missed before subscription');
  cleanup(); clock.sample(1500, wall, wall, 'host:1');
  assert.equal(timers.size, 0);
  assert.equal(updates, 1, 'cleanup retires the subscription');
});


// A remembered local deadline schedules observation; its server deadline
// independently guards the page even when that observation has not returned.
for (const [serverDelay, early] of [[null, false], [null, true], [300, false], [600, false]]) test(`remembered wakeup retains data until its own server deadline (${serverDelay}, early=${early})`, async t => {
  const f = fixture(t, 'fallback'), start = Date.now() + f.offset, localDeadline = start + 300;
  const serverDeadline = serverDelay === null ? null : start + serverDelay;
  f.outcome = request => ({ data: false, unknown: true, speculative: true, complete: false, tables: [],
    nextExpiry: request.now < localDeadline ? localDeadline : null });
  f.serverOutcome = () => ({ data: true, complete: true, tables: [], nextExpiry: serverDeadline });
  let release, entered = false;
  const client = await f.open(); t.after(async () => { release?.(); await close(client, t); });
  assert.equal((await client.query(read, {})).data, true);
  f.offline = true; await client.sync();
  let earlyArm = early;
  if (early) {
    const deviceDelay = ServerClock.prototype.deviceDelay;
    t.mock.method(ServerClock.prototype, 'deviceDelay', function(at) {
      const delay = deviceDelay.call(this, at);
      if (earlyArm && at === localDeadline) { earlyArm = false; return 100; }
      return delay;
    });
  }
  const watch = client.observe(read, {}), publications = [];
  watch.subscribe(() => publications.push(watch.getSnapshot()));
  await drain(); const before = watch.getSnapshot();
  assert.equal(before.data, true); assert.equal(before.fresh, false);
  const count = publications.length;
  const held = new Promise(resolve => { release = resolve; });
  const outcome = f.outcome;
  f.outcome = async request => { entered = true; await held; return outcome(request); };
  if (early) {
    assert.equal(earlyArm, false, 'the first timer was intentionally armed before its real deadline');
    t.mock.timers.tick(100); await drain();
    assert.equal(entered, false, 'an early timer re-arms without observing');
    assert.equal(watch.getSnapshot(), before);
    t.mock.timers.tick(200);
  } else t.mock.timers.tick(300);
  await drain();
  assert.equal(entered, true, 'the due local timer starts a reobservation');
  if (serverDelay === 300) {
    assert.deepEqual(watch.getSnapshot(), { loading: true }, 'simultaneous server expiry must reset');
  } else {
    assert.equal(watch.getSnapshot(), before, 'a local wakeup preserves the valid remembered answer without invalidating it');
    assert.equal(answerIdentity(watch.getSnapshot()), answerIdentity(before));
    assert.equal(publications.length, count, 'a non-invalidating wakeup has no visible transition before its result');
    if (serverDelay === 600) {
      t.mock.timers.tick(300); await drain();
      assert.deepEqual(watch.getSnapshot(), { loading: true }, 'the server cutoff stays armed during the local call');
    }
  }
  release(); await drain();
  if (serverDelay === null) {
    assert.equal(watch.getSnapshot().data, true);
    assert.ok(publications.every(value => value.data === true));
  } else assert.deepEqual(watch.getSnapshot(), { loading: true });
  watch.close();
});

test('composed data with no server deadline still withdraws at its local row deadline', async t => {
  const f = fixture(t, 'composition'), deadline = Date.now() + f.offset + 300;
  f.outcome = request => ({ data: { remote: [], kept: request.now < deadline ? ['private'] : [] },
    complete: false, unknown: true, speculative: false, tables: [], nextExpiry: request.now < deadline ? deadline : null,
    components: { remote: { unknown: true }, kept: { retained: true, complete: true } } });
  f.serverOutcome = () => ({ data: { remote: ['live'], kept: [] }, complete: true, tables: [], nextExpiry: null });
  let release, entered = false;
  const client = await f.open(); t.after(async () => { release?.(); await close(client, t); });
  const watch = client.observe(read, {}), publications = [];
  watch.subscribe(() => publications.push(watch.getSnapshot()));
  await drain(); assert.deepEqual(watch.getSnapshot().data, { remote: ['live'], kept: ['private'] });
  const held = new Promise(resolve => { release = resolve; });
  const outcome = f.outcome;
  f.outcome = async request => { entered = true; await held; return outcome(request); };
  t.mock.timers.tick(300); await drain();
  assert.equal(entered, true);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, 'no server deadline does not identify a remembered wakeup');
  assert.deepEqual(publications.at(-1), { loading: true });
  release(); await drain();
  assert.deepEqual(watch.getSnapshot().data, { remote: ['live'], kept: [] });
  watch.close();
});
