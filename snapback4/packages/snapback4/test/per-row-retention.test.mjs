// @ref LLP 3000.023#10 — queue wait, remembered dependencies and the final reset fence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalClient } from '../dist/local.js';
import { createClient } from '../dist/client.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { ReadObservation, answerIdentity, answerObservation } from '../dist/read-observation.js';
import { LocalReads } from '../dist/local-reads.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { ReadApprovals } from '../dist/read-approval.js';
import { armReadExpiry, correctReadExpiries, holdReadExpiry } from '../dist/read-expiry.js';
import { ServerClock } from '../dist/clock.js';
import { ReadWork } from '../dist/read-work.js';
import { server, binary, until } from './helpers/app-server.mjs';

const source = `use personas alice
table remoteRows:
  value: int
  read <- allow
  online only
query remote():
  return exists remoteRows['r']
table notes:
  owner: principal
  body: text
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add():
  insert notes { owner: viewer, body: 'unrelated' }
`;
const op = { kind: 'query', name: 'remote' };
const ready = data => ({ data, complete: true, cut: null, fresh: true });
const pause = () => new Promise(resolve => setImmediate(resolve));
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error('closed'));
  else signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
});
const device = (tier, dir) => tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') })
  : webDevice({ wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence() });

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) test(`${tier} keep=${keep}: sign-out never replaces its denial with loading`, async t => {
  const { url, dir } = await server(t, '', source);
  let queries = 0;
  const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: (input, init) => {
    if (new URL(input).pathname === '/changes') return parked(init.signal);
    if (new URL(input).pathname.startsWith('/q/')) queries++;
    return fetch(input, init);
  } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(op, {}, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => 'data' in watch.getSnapshot() && !watch.getSnapshot().revalidating);
  const seen = [], before = queries, owner = answerObservation(watch.getSnapshot());
  // Inspect the notification's source snapshot, before getSnapshot's terminal
  // accessor can repair an accidental intermediate loading publication.
  watch.subscribe(() => seen.push(owner.snapshot));
  await client.signOut();
  assert.ok(seen.some(read => read.denied?.code === 'E_AUTH'));
  assert.ok(seen.every(read => 'denied' in read), 'sign-out and close keep their terminal denial');
  assert.equal(queries, before, 'no signed-out read attempt');
});

for (const keep of [undefined, false, true]) test(`online keep=${keep}: held-only expiry preserves the newer raw answer beyond one second`, async t => {
  const wall = Date.now(), deadline = wall + 3_600_000, clock = new ServerClock(() => wall);
  const live = clock; let calls = 0;
  const client = createClient({ url: 'http://pq-held.test', persona: 'alice', fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
    if (path === '/changes') return parked(init.signal);
    calls++; return Response.json({ data: 7, nextExpiry: deadline, seq: 1, tables: ['rows'] });
  }) });
  t.after(() => client.close());
  const watch = client.observe(op, {}, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 7 && !watch.getSnapshot().revalidating);
  const owner = answerObservation(watch.getSnapshot()), before = calls;
  const held = holdReadExpiry(owner, () => () => live.sample(wall, wall, wall, 'clock:2'));
  t.after(() => held.release());
  owner.deadlines = { device: null, server: deadline + 60_000, localWakeup: false };
  owner.publish(ready(8)); const newer = watch.getSnapshot();
  live.sample(deadline, wall, wall, 'clock:1');
  await until(() => calls > before);
  for (let i = 0; i < 60; i++) await pause();
  assert.equal(owner.resetVersion, 0);
  assert.equal(owner.expiredServerDeadline, deadline);
  assert.equal(watch.getSnapshot(), newer, 'refresh of an expired hold does not invalidate a newer raw answer');
  const later = Date.now() + 1001; t.mock.method(Date, 'now', () => later);
  assert.equal(watch.getSnapshot(), newer, 'no new episode was started by the held-only sweep');
});

for (const tier of ['wasm', 'process']) test(`${tier}: an unrelated replicated write preserves online-only memory offline`, async t => {
  const { url, dir } = await server(t, '', source);
  assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'remoteRows', row: { id: 'r', value: 7 } }]) }).then(r => r.json())).seeded, 1);
  let online = true, queries = 0, localQueries = 0;
  const base = device(tier, dir);
  const client = await createLocalClient({ url, persona: 'alice', device: { async open(...args) {
    const core = await base.open(...args);
    return { ...core, call(request, commit) { if (request.op === 'query') localQueries++; return core.call(request, commit); } };
  } }, fetch: (input, init) => {
    if (new URL(input).pathname === '/changes') return parked(init.signal);
    if (!online) return Promise.reject(Error('offline'));
    if (new URL(input).pathname.startsWith('/q/')) queries++;
    return fetch(input, init);
  } });
  t.after(() => client.close()); await client.sync();
  const watch = client.observe(op, {}, { keep: true }); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === true && !watch.getSnapshot().revalidating);
  const before = { queries, localQueries };
  assert.equal((await fetch(url + '/m/add', { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
    body: JSON.stringify({ id: crypto.randomUUID(), args: {} }) }).then(r => r.json())).state, 'sent');
  await client.sync();
  for (let i = 0; i < 30; i++) await pause();
  assert.deepEqual({ queries, localQueries }, before, 'unrelated applies do no replacement query');
  online = false; await client.sync();
  await until(() => client.link() === 'offline');
  await until(() => watch.getSnapshot().data === true && watch.getSnapshot().fresh === false && watch.getSnapshot().revalidating === true,
    'offline observation retains remembered memory while revalidating');
  assert.equal(watch.getSnapshot().data, true, 'the observed fallback survives the unrelated write');
  assert.equal((await client.query(op, {})).data, true, 'direct fallback uses the same remembered answer');
});

for (const operation of ['apply', 'admit', 'settle', 'clear_rows']) for (const footprint of [[], ['notes'], ['remoteRows'], ['members'], undefined]) {
  test(`${operation}: remembered dependencies with footprint ${JSON.stringify(footprint)}`, () => {
    const reads = new LocalReads(), memory = reads.serverAnswers;
    for (const [key, tables] of [['remote', ['remoteRows', 'members']], ['note', ['notes']], ['opaque', []]])
      memory.set(key, { read: ready(true), at: 0, nextExpiry: null, tables: new Set(tables) }, { seq: 2, ticket: memory.begin() });
    reads.committed([], operation, footprint);
    const cleared = operation === 'clear_rows' || footprint === undefined;
    assert.equal(!!memory.get('remote'), !cleared && !footprint.some(table => ['remoteRows', 'members'].includes(table)));
    assert.equal(!!memory.get('note'), !cleared && !footprint.includes('notes'));
    assert.equal(!!memory.get('opaque'), !cleared && footprint.length === 0);
    // Selective invalidation must also preserve a disjoint entry's ordering.
    memory.set('remote', { read: ready(false), at: 0, nextExpiry: null, tables: new Set(['remoteRows']) }, { seq: 1, ticket: memory.begin() });
    if (!cleared && !footprint.some(table => ['remoteRows', 'members'].includes(table))) assert.equal(memory.get('remote').read.data, true);
  });
}

for (const keep of [undefined, false, true]) test(`queued keep=${keep}: episode starts at attempt; retries never renew it`, t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const watch = new ReadObservation(keep), approvals = new ReadApprovals();
  t.after(() => { approvals.close(); watch.retire(); });
  watch.publish(ready('A')); approvals.approve(watch.snapshot);
  const identity = answerIdentity(watch.snapshot);
  watch.reload(true, { queued: true }); now = 5000;
  t.mock.timers.tick(4000);
  if (keep === false) {
    assert.deepEqual(watch.read(null), { loading: true });
    assert.deepEqual(approvals.get(watch.snapshot).read(), { loading: true }); return;
  }
  assert.equal(watch.read(null).data, 'A');
  assert.equal(watch.snapshot.revalidating, true);
  assert.equal(answerIdentity(watch.snapshot), identity);
  assert.equal(episodeDeadline(watch.snapshot), undefined);
  assert.equal(episodeDeadline(approvals.get(watch.snapshot).read()), undefined);
  const queued = watch.snapshot;
  watch.reload(); // The queued attempt starts now.
  assert.equal(watch.snapshot, queued, 'starting the hidden deadline is not another visible transition');
  const deadline = 6000; // Change evidence bounds both retaining policies.
  assert.equal(episodeDeadline(watch.snapshot), deadline);
  assert.equal(episodeDeadline(approvals.get(watch.snapshot).read()), deadline);
  now = 5500; watch.reload(true, { queued: true }); watch.reload();
  assert.equal(episodeDeadline(watch.snapshot), deadline, 'a later queue wait cannot renew an existing episode');
  now = 6000;
  assert.deepEqual(watch.read(null), { loading: true });
  assert.deepEqual(approvals.get(watch.snapshot).read(), { loading: true });
});

for (const boundary of ['row expiry', 'reset']) test(`queued observation still withdraws at ${boundary}`, t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const watch = new ReadObservation(), clock = new ServerClock(() => now);
  const approvals = new ReadApprovals(), arm = (w, deadlines) => armReadExpiry(w, deadlines, clock, () => true, sweep);
  function sweep() { correctReadExpiries([watch], clock, w => w.expire(), arm, () => {}); }
  t.after(() => { approvals.close(); watch.retire(); clearTimeout(watch.expiryTimer); });
  watch.publish(ready('A'));
  arm(watch, { device: null, server: 1500, localWakeup: false }); approvals.approve(watch.snapshot);
  watch.reload(true, { queued: true });
  if (boundary === 'row expiry') { now = 1500; sweep(); } else watch.reset({ loading: true });
  assert.deepEqual(watch.read(null), { loading: true });
  assert.deepEqual(approvals.get(watch.snapshot).read(), { loading: true });
  assert.equal(watch.resetVersion, 1);
  now = 1000; watch.reload(); assert.deepEqual(watch.read(null), { loading: true });
  watch.publish(ready('B')); watch.reload(true, { queued: true });
  assert.equal(episodeDeadline(watch.snapshot), undefined, 'the reset retired the prior episode');
});

for (const tier of ['wasm', 'process']) test(`${tier}: a local active attempt has its own bounded episode and accepts late success`, async t => {
  const { url, dir } = await server(t, '', readFileSync(new URL('../../../witness/per-row.q', import.meta.url), 'utf8'));
  await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'cards', row: { id: 'c0', slot: 0, owner: 'dev:alice', label: 'original' } }]) });
  const base = device(tier, dir), gate = Promise.withResolvers(); let hold = false, started;
  const client = await createLocalClient({ url, persona: 'alice', device: { async open(...args) {
    const core = await base.open(...args);
    return { ...core, async call(request, commit) {
      const result = await core.call(request, commit);
      if (hold && request.op === 'query') { started = Date.now(); await gate.promise; }
      return result;
    } };
  } }, fetch: (input, init) => new URL(input).pathname === '/changes' ? parked(init.signal) : fetch(input, init) });
  t.after(async () => { gate.resolve(); await client.close(); }); await client.sync();
  const watch = client.observe({ kind: 'query', name: 'point' }, { id: 'c0' });
  watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data?.label === 'original' && !watch.getSnapshot().revalidating);
  const owner = answerObservation(watch.getSnapshot());
  let wall = Date.now(); t.mock.method(Date, 'now', () => wall);
  await fetch(url + '/m/edit', { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
    body: JSON.stringify({ id: crypto.randomUUID(), args: { id: 'c0', label: 'changed' } }) });
  hold = true; await client.sync(); await until(() => started !== undefined);
  assert.equal(episodeDeadline(watch.getSnapshot()), started + 1000);
  const reset = owner.resetVersion;
  wall = started + 999; assert.equal(watch.getSnapshot().data?.label, 'original');
  wall++; assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.equal(owner.resetVersion, reset, 'episode withdrawal does not reset the active attempt');
  hold = false; gate.resolve();
  await until(() => watch.getSnapshot().data?.label === 'changed' && !watch.getSnapshot().revalidating);
});

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: reset after the early fence is rejected by the publication callback`, async t => {
    const { url, dir } = await server(t, '', source);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'remoteRows', row: { id: 'r', value: 7 } }]) });
    let armed = false, reset = false, queries = 0;
    const gate = Promise.withResolvers();
    const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: async (input, init) => {
      if (new URL(input).pathname === '/changes') return parked(init.signal);
      if (armed && new URL(input).pathname.startsWith('/q/') && ++queries > 1) await gate.promise;
      return fetch(input, init);
    } });
    t.after(async () => { gate.resolve(); await client.close(); }); await client.sync();
    const watch = client.observe(op, {}, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data === true && !watch.getSnapshot().revalidating);
    const owner = answerObservation(watch.getSnapshot()), before = owner.resetVersion, seen = [];
    // The retry counter is cleared after the early reset comparison, immediately
    // before publishLocal's synchronous currentness predicate and callback.
    Object.defineProperty(owner, 'expiredRetries', { configurable: true, get: () => 0, set() {
      if (!armed || reset) return;
      reset = true; owner.reset({ loading: true });
    } });
    watch.subscribe(() => { if (reset) seen.push(watch.getSnapshot()); });
    armed = true; await client.sync();
    await until(() => reset);
    for (let i = 0; i < 60; i++) await pause();
    assert.equal(owner.resetVersion, before + 1);
    assert.deepEqual(watch.getSnapshot(), { loading: true });
    assert.ok(seen.every(read => !('data' in read)), 'the old body never publishes after the final reset');
    gate.resolve(); await until(() => watch.getSnapshot().data === true && !watch.getSnapshot().revalidating);
  });
}

for (const tier of ['wasm', 'process']) for (const keep of [undefined, false, true]) {
  test(`${tier} keep=${keep}: cancellation after checkRead leaves publication and watch state untouched`, async t => {
    const { url, dir } = await server(t, '', source);
    await fetch(url + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'remoteRows', row: { id: 'r', value: 7 } }]) });
    let armed = false, cancelled = false, queries = 0, owner, work, attempt, before;
    const gate = Promise.withResolvers(), completed = Promise.withResolvers();
    const schedule = ReadWork.prototype.schedule;
    t.mock.method(ReadWork.prototype, 'schedule', function(watch, run) {
      const queue = this;
      return schedule.call(this, watch, async signal => {
        if (armed && cancelled && watch === owner) await gate.promise;
        const target = armed && !cancelled && watch === owner;
        if (target) { work = queue; attempt = signal; }
        try { await run(signal); } finally { if (target) completed.resolve(); }
      });
    });
    const client = await createLocalClient({ url, persona: 'alice', device: device(tier, dir), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/changes') return parked(init.signal);
      if (armed && path.startsWith('/q/') && ++queries > 1) await gate.promise;
      return fetch(input, init);
    } });
    t.after(async () => { gate.resolve(); await client.close(); }); await client.sync();
    const watch = client.observe(op, {}, { keep }); watch.subscribe(() => {}); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data === true && !watch.getSnapshot().revalidating);
    owner = answerObservation(watch.getSnapshot());
    const fields = ['snapshot', 'tables', 'deadlines', 'incarnation', 'serverRead', 'serverOnly', 'presenceEvery', 'presenceRefresh', 'expiryTimer', 'resetVersion'];
    const state = () => Object.fromEntries(fields.map(key => [key, owner[key]]));
    const seen = [], publish = t.mock.method(owner, 'publish');
    watch.subscribe(() => { if (cancelled) seen.push(owner.snapshot); });
    // This setter runs after checkRead(signal) and the early fences, just before
    // publishLocal. Cancel the actual attempt without closing/removing/resetting
    // its watch, so those independent guards cannot mask the signal comparison.
    Object.defineProperty(owner, 'expiredRetries', { configurable: true, get: () => 0, set() {
      if (!armed || cancelled) return;
      assert.ok(attempt && !attempt.aborted);
      before = state(); publish.mock.resetCalls(); cancelled = true;
      assert.equal(work.cancel(owner), true);
      assert.equal(attempt.aborted, true);
    } });
    armed = true; await client.sync();
    await until(() => cancelled); await completed.promise;
    assert.equal(publish.mock.callCount(), 0, 'the cancelled body never reaches publish');
    assert.deepEqual(seen, [], 'no subscriber sees a cancelled completion');
    for (const field of fields) assert.equal(owner[field], before[field], `no cancelled watch update: ${field}`);
    gate.resolve();
    await until(() => watch.getSnapshot().data === true && !watch.getSnapshot().revalidating);
  });
}

for (const keep of [undefined, true]) for (const end of ['failure', 'timeout']) {
  test(`plain refresh followed by queued change keeps its bound: keep=${keep}, ${end}`, t => {
    let now = 1000; t.mock.method(Date, 'now', () => now);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const watch = new ReadObservation(keep), approvals = new ReadApprovals();
    t.after(() => { approvals.close(); watch.retire(); });
    watch.publish(ready('A')); approvals.approve(watch.snapshot);
    watch.reload(); now = 5000; watch.failed(true);
    assert.equal(watch.read(null).data, 'A');
    assert.equal(watch.snapshot.fresh, false); assert.equal(watch.snapshot.since, 1000);
    assert.equal(episodeDeadline(watch.snapshot), undefined);
    watch.reload(true, { queued: true }); now = 9000;
    watch.reload(false, { queued: true });
    assert.equal(watch.read(null).data, 'A');
    assert.equal(episodeDeadline(watch.snapshot), undefined, 'plain reload cannot start the queued change attempt');
    watch.reload(); const deadline = 10000;
    assert.equal(episodeDeadline(watch.snapshot), deadline);
    now = 9500; watch.reload(true, { queued: true }); watch.reload(false, { queued: true });
    assert.equal(episodeDeadline(watch.snapshot), deadline, 'another queue wait cannot extend the active bound');
    assert.equal(episodeDeadline(approvals.get(watch.snapshot).read()), deadline);
    if (end === 'failure') watch.failed(true); else now = deadline;
    assert.deepEqual(watch.read(null), { loading: true });
    assert.deepEqual(approvals.get(watch.snapshot).read(), { loading: true });
    watch.publish(ready('B'));
    assert.equal(watch.read(null).data, 'B', 'withdrawal still accepts a later replacement');
  });
}
