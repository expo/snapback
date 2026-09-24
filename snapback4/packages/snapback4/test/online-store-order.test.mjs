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

test('replacement store resets the floor and cursor and fences outstanding reads and write receipts', async t => {
  const replacement = deferred(), oldRead = deferred(), oldWrite = deferred();
  const polls = [], values = []; let store = 'A', directStarted = false, writeStarted = false;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      polls.push(new URL(url));
      if (polls.length === 1) return Response.json(head('A', 100));
      if (polls.length === 2) return Response.json(await replacement.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) { writeStarted = true; await oldWrite.promise; return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 200 }); }
    if (JSON.parse(init.body).args.direct && !directStarted) { directStarted = true; return Response.json(await oldRead.promise); }
    return Response.json(ready([store], store === 'A' ? 100 : 1));
  } });
  t.after(async () => { replacement.resolve(head('B', 1)); oldRead.resolve(ready(['A'], 100)); oldWrite.resolve(); await client.close(); });
  const watch = client.observe(q, {}); watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => polls.length === 2 && watch.getSnapshot().data?.[0] === 'A');
  const direct = client.query(q, { direct: true }), write = client.mutate(m, {});
  await until(() => directStarted && writeStarted);
  values.length = 0; store = 'B'; replacement.resolve(head('B', 1));
  await until(() => polls.length === 3 && watch.getSnapshot().data?.[0] === 'B');
  assert.equal(polls[1].searchParams.get('since'), '100');
  assert.equal(polls[1].searchParams.get('store_id'), 'A');
  assert.equal(polls[2].searchParams.get('since'), '1');
  assert.equal(polls[2].searchParams.get('store_id'), 'B');
  oldRead.resolve(ready(['A'], 100)); oldWrite.resolve();
  assert.deepEqual((await direct).data, ['B']); await write;
  assert.deepEqual((await client.query(q, {})).data, ['B'], 'late A receipt must not raise B floor');
  assert.ok(values.every(read => !read.data?.includes('A')));
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

for (const observe of [false, true]) test(`${observe ? 'observed' : 'direct'} stale reads back off and stop after four requests`, async t => {
  const changed = deferred(); const times = []; let current = false, polls = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
    times.push(Date.now()); return Response.json({ ...ready([], current ? 3 : 1), nextExpiry: current ? null : Date.now() - 1 });
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

test('reconnect probe verifies a replacement before restarting reads and the change cursor', async t => {
  const disconnect = deferred(); const polls = []; let store = 'A', probes = 0;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      polls.push(new URL(url));
      if (polls.length === 1) return Response.json(head('A', 100));
      if (polls.length === 2) { await disconnect.promise; throw Error('disconnected'); }
      return blocked(init.signal);
    }
    if (url.includes('/probe')) { probes++; return Response.json({ ok: true, store_id: 'B', seq: 1 }); }
    return Response.json(ready([store], store === 'A' ? 100 : 1));
  } });
  t.after(async () => { disconnect.resolve(); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => polls.length === 2 && watch.getSnapshot().data?.[0] === 'A');
  store = 'B'; disconnect.resolve();
  // Poll failure and offline reconnect each have a one-second backoff.
  for (let n = 0; n < 600 && polls.length < 3; n++) await delay(5);
  await until(() => watch.getSnapshot().data?.[0] === 'B');
  assert.equal(probes, 1); assert.equal(polls.length, 3);
  assert.equal(polls[2].searchParams.get('store_id'), 'B');
  assert.equal(polls[2].searchParams.get('since'), '1');
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

for (const failProbe of [false, true]) test(`a write crossing first identity discovery verifies its store before reading (probe failure: ${failProbe})`, async t => {
  const first = deferred(), receipt = deferred(), probe = deferred(), changed = deferred(), confirmed = deferred();
  let polls = 0, probes = 0, direct = 0, writing = false, current = 1;
  const client = createClient({ url: 'http://store.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++polls === 1) return Response.json(await first.promise);
      if (polls === 2) return Response.json(await changed.promise);
      if (polls === 3) return Response.json(await confirmed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) { writing = true; await receipt.promise; current = 2; return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 }); }
    if (url.includes('/probe')) { probes++; await probe.promise; if (failProbe) throw Error('offline'); return Response.json({ ok: true, store_id: 'A', seq: 2 }); }
    if (JSON.parse(init.body).args.direct && ++direct === 1) return Response.json(ready(['revoked'], 1));
    return Response.json(ready([], current));
  } });
  t.after(async () => { first.resolve(head('A', 1)); receipt.resolve(); probe.resolve(); changed.resolve(head('A', 2)); confirmed.resolve(head('A', 2)); await client.close(); });
  const watch = client.observe(q, {}), write = client.mutate(m, {});
  await until(() => writing && polls === 1);
  first.resolve(head('A', 1));
  await until(() => polls === 2 && watch.getSnapshot().data);
  receipt.resolve(); await until(() => probes === 1);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.deepEqual(await client.query(q, {}), { loading: true }, 'the unverified write cannot be silently omitted from the floor');
  probe.resolve(); await write;
  if (failProbe) {
    assert.deepEqual(await client.query(q, {}), { loading: true });
    // This poll started before the receipt; it cannot verify that write.
    changed.resolve(head('A', 2)); await until(() => polls === 3);
    assert.deepEqual(await client.query(q, {}), { loading: true });
    confirmed.resolve(head('A', 2));
    await until(() => watch.getSnapshot().data);
    assert.deepEqual(watch.getSnapshot().data, []);
  } else {
    assert.deepEqual((await client.query(q, { direct: true })).data, []);
    assert.equal(direct, 2);
  }
});
