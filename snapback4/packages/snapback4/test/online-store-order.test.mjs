import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
const q = { kind: 'query', name: 'page' }, m = { kind: 'mutation', name: 'change' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ready = (data, seq) => ({ data, seq, complete: true, tables: ['secrets'] });
const head = (store_id, seq) => ({ store_id, seq, generation: 1, tables: ['secrets'] });
const until = async check => { for (let n = 0; n < 300; n++) { if (check()) return; await delay(5); } assert.fail('online read did not settle'); };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error('closed')); else signal.addEventListener('abort', () => reject(Error('closed')), { once: true }); });

for (const observation of [false, true]) test(`replayed mutation cannot lower the ${observation ? 'observation' : 'query'} floor`, async t => {
  const stale = deferred(); let writes = 0, reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: ++writes === 1 ? 10 : 1, ...(writes === 2 ? { replayed: true } : {}) });
    return Response.json(++reads === 1 ? await stale.promise : ready([], 10));
  } });
  t.after(async () => { stale.resolve(ready(['revoked'], 1)); await client.close(); });
  await client.mutate(m, {});
  const replay = await client.mutate(m, {}, { id: '00000000000000000000000001' });
  assert.equal(replay.replayed, true); assert.equal(replay.seq, 1);
  // Start after replay so no dirty rerun can hide the stale publication.
  const watch = observation ? client.observe(q, {}) : null, values = [];
  watch?.subscribe(() => values.push(watch.getSnapshot()));
  const pending = observation ? null : client.query(q, {});
  await until(() => reads === 1); stale.resolve(ready(['revoked'], 1));
  if (observation) {
    await until(() => watch.getSnapshot().data?.length === 0);
    assert.ok(values.every(read => !read.data?.includes('revoked')));
  } else assert.deepEqual((await pending).data, []);
  assert.equal(reads, 2, 'the replay does not make sequence 1 acceptable again');
});

test('closing while a stale HTTP body is in flight prevents publication and refetch', async t => {
  const body = deferred(), parsed = deferred(); let reads = 0, entered = false;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    reads++;
    const response = Response.json(ready(['revoked'], 1)), json = response.json.bind(response);
    response.json = async () => { entered = true; await body.promise; const value = await json(); parsed.resolve(); return value; };
    return response;
  } });
  t.after(async () => { body.resolve(); await client.close(); });
  await client.mutate(m, {});
  const watch = client.observe(q, {}), values = [];
  watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => entered); watch.close();
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  body.resolve(); await parsed.promise; await delay(250);
  assert.equal(reads, 1);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.ok(values.every(read => !('data' in read)));
});

test('same-store head regression reports E_STORE_RESTORE and stops polling and reading', async t => {
  const restored = deferred(); let polls = 0, reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(head('A', 100));
      if (polls === 2) return Response.json(await restored.promise);
      return blocked(init.signal);
    }
    reads++; return Response.json(ready(['private'], 100));
  } });
  t.after(async () => { restored.resolve(head('A', 1)); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => polls === 2 && watch.getSnapshot().data);
  restored.resolve(head('A', 1));
  await until(() => watch.getSnapshot().denied?.code === 'E_STORE_RESTORE');
  const before = reads;
  assert.equal((await client.query(q, {})).denied.code, 'E_STORE_RESTORE');
  await delay(100);
  assert.equal(polls, 2); assert.equal(reads, before);
});

test('a change response captured before a write is not evidence of a same-store restore', async t => {
  const changed = deferred(); let polls = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(head('A', 1));
      if (polls === 2) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    return Response.json(ready([], 2));
  } });
  t.after(async () => { changed.resolve(head('A', 1)); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => polls === 2 && watch.getSnapshot().data);
  await client.mutate(m, {}); changed.resolve(head('A', 1));
  await until(() => polls === 3);
  assert.deepEqual((await client.query(q, {})).data, []);
});

for (const observe of [false, true]) test(`${observe ? 'observed' : 'direct'} stale-sequence reads back off and stop after four requests`, async t => {
  const changed = deferred(); const times = []; let current = false, polls = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    // Observed expiry has its own paced recovery (per-row-progress); this round
    // exercises sequence exhaustion. Direct expired reads still settle here.
    times.push(Date.now()); return Response.json({ ...ready([], current ? 3 : 1), nextExpiry: current || observe ? null : Date.now() - 1 });
  } });
  t.after(async () => { changed.resolve({ seq: 3, tables: ['secrets'] }); await client.close(); });
  await client.mutate(m, {});
  const watch = observe ? client.observe(q, {}) : null;
  const result = observe ? null : client.query(q, {});
  await until(() => times.length >= 4); await delay(250);
  assert.equal(times.length, 4, 'exhaustion must not rearm an expired timer or a dirty rerun');
  for (let n = 1; n < times.length; n++) assert.ok(times[n] - times[n - 1] >= 15 * 2 ** (n - 1), 'retries back off');
  assert.deepEqual(observe ? watch.getSnapshot() : await Promise.race([result, delay(500).then(() => assert.fail('retry round did not settle'))]), { loading: true });
  if (observe) {
    current = true; changed.resolve({ seq: 3, tables: ['secrets'] });
    await until(() => watch.getSnapshot().data);
    assert.equal(times.length, 5, 'the next change notification starts a new round');
  }
});

test('closing the last owner during backoff cancels the next stale-response request', async t => {
  let reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    reads++; return Response.json(ready(['old'], 1));
  } });
  t.after(() => client.close());
  await client.mutate(m, {});
  const watch = client.observe(q, {}); watch.subscribe(() => {});
  await until(() => reads === 1);
  await delay(0); // Let the first response be rejected and enter its backoff.
  watch.close();
  await delay(250);
  assert.equal(reads, 1); assert.deepEqual(watch.getSnapshot(), { loading: true });
});

test('closing one of two subscribed owners does not cancel their shared fetch', async t => {
  const first = deferred(); let reads = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    return Response.json(++reads === 1 ? await first.promise : ready([], 2));
  } });
  t.after(async () => { first.resolve(ready([], 1)); await client.close(); });
  await client.mutate(m, {});
  const left = client.observe(q, {}), right = client.observe(q, {});
  left.subscribe(() => {}); right.subscribe(() => {});
  left.close(); first.resolve(ready(['old'], 1));
  await until(() => right.getSnapshot().data);
  assert.deepEqual(right.getSnapshot().data, []); assert.equal(reads, 2);
});

test('a buffered first identity reply cannot lower a newer write floor', async t => {
  const first = deferred(); let polls = 0, direct = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await first.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    if (JSON.parse(init.body).args.direct && ++direct === 1) return Response.json(ready(['revoked'], 1));
    return Response.json(ready([], 2));
  } });
  t.after(async () => { first.resolve(head('A', 1)); await client.close(); });
  client.observe(q, {});
  await until(() => polls === 1);
  await client.mutate(m, {}); first.resolve(head('A', 1));
  await until(() => polls === 2);
  assert.deepEqual((await client.query(q, { direct: true })).data, []);
  assert.equal(direct, 2);
});

for (const receiptIdentity of [false, true]) test(`first poll after a completed write refuses a lower head (${receiptIdentity ? 'known' : 'new'} identity)`, async t => {
  const old = deferred(), changed = deferred(); let polls = 0, reads = 0, requests = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    requests++;
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2, ...(receiptIdentity ? { store_id: 'A' } : {}) });
    reads++; return Response.json(await old.promise);
  } });
  t.after(async () => { changed.resolve(head('A', 1)); old.resolve(ready(['revoked'], 1)); await client.close(); });
  // This evaluated response predates the revocation. No observation has
  // started polling, and the legacy receipt variant has not learned an id.
  const direct = client.query(q, {});
  await until(() => reads === 1);
  assert.equal((await client.mutate(m, {})).seq, 2);
  assert.equal(polls, 0, 'the first poll must start after the write has settled');
  const watch = client.observe(q, {}), values = [];
  watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => polls === 1 && reads === 2);
  changed.resolve(head('A', 1));
  await until(() => watch.getSnapshot().denied || polls > 1);
  old.resolve({ ...ready(['revoked'], 1), store_id: 'A' });
  assert.equal((await direct).denied?.code, 'E_STORE_RESTORE');
  assert.ok(values.every(read => !('data' in read)), 'the buffered private row must never publish');
  const before = requests;
  assert.equal((await client.query(q, {})).denied?.code, 'E_STORE_RESTORE');
  assert.equal((await client.mutate(m, {})).why?.code, 'E_STORE_RESTORE');
  await delay(50);
  assert.equal(requests, before, 'regression is terminal, with no retry or re-verification');
  assert.equal(polls, 1);
});

test('first identity discovery remembers the acknowledged receipt for later heads', async t => {
  const first = deferred(), next = deferred(); let polls = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await first.promise);
      if (polls === 2) return Response.json(await next.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    return Response.json({ loading: true, seq: 2 });
  } });
  t.after(async () => { first.resolve(head('A', 1)); next.resolve(head('A', 1)); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => polls === 1);
  await client.mutate(m, {});
  // The first request predates the receipt, so it can discover A without
  // declaring a restore. The subsequent request has to remember that receipt.
  first.resolve(head('A', 1));
  await until(() => polls === 2);
  assert.equal(watch.getSnapshot().denied, undefined);
  next.resolve(head('A', 1));
  await until(() => watch.getSnapshot().denied || polls > 2);
  assert.equal(watch.getSnapshot().denied?.code, 'E_STORE_RESTORE');
  assert.equal(polls, 2);
});
