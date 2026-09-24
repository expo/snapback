import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { ReadObservation } from '../dist/read-observation.js';
const q = { kind: 'query', name: 'page' }, m = { kind: 'mutation', name: 'revoke' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ready = (data, seq = 1) => ({ data, seq, complete: true, tables: ['secrets'] });
const until = async check => { for (let n = 0; n < 300; n++) { if (check()) return; await delay(5); } assert.fail('online read did not settle'); };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error('closed')); else signal.addEventListener('abort', () => reject(Error('closed')), { once: true }); });

test('online reruns publish loading instead of keeping a previous answer', async t => {
  let reads = 0; const next = deferred();
  const client = createClient({ url: 'http://order.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) return blocked(init.signal);
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 1 });
    return Response.json(++reads === 1 ? ready(['private']) : await next.promise);
  } });
  t.after(async () => { next.resolve(ready([])); await client.close(); });
  const watch = client.observe(q, {});
  await until(() => watch.getSnapshot().data);
  await client.mutate(m, {});
  await until(() => reads === 2);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  next.resolve({ loading: true, seq: 1 });
  await delay(10);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
});

for (const observation of [false, true]) for (const source of ['write', 'changes'])
  test(`online ${observation ? 'observation' : 'query'} discards a response older than observed ${source}`, async t => {
    let reads = 0, changes = 0;
    const old = deferred(), changed = deferred(), latest = deferred();
    const client = createClient({ url: 'http://order.test', persona: 'alice', fetch: async (url, init) => {
      if (url.includes('/changes')) {
        if (++changes === 1) return Response.json(await changed.promise);
        return blocked(init.signal);
      }
      if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 2 });
      if (++reads <= (observation ? 1 : 2)) return Response.json(await old.promise);
      return Response.json(await latest.promise);
    } });
    t.after(async () => { old.resolve(ready([])); changed.resolve({ seq: 2, tables: ['secrets'], generation: 1 }); latest.resolve(ready([], 2)); await client.close(); });
    // A separate observer starts the feed for the direct-query variant.
    const watch = client.observe(q, {});
    const values = []; watch.subscribe(() => values.push(watch.getSnapshot()));
    let result;
    const direct = observation ? null : client.query(q, { direct: true }).then(read => { result = read; });
    await until(() => reads >= (observation ? 1 : 2));
    if (source === 'write') await client.mutate(m, {});
    else { changed.resolve({ seq: 2, tables: ['secrets'], generation: 1 }); await until(() => changes >= 2); }
    old.resolve(ready(['revoked'], 1));
    // Direct query's first response is also older than the acknowledged floor.
    latest.resolve(ready([], 2));
    await direct;
    await until(() => watch.getSnapshot().data?.length === 0);
    assert.ok(values.every(read => !read.data?.includes('revoked')), 'pre-commit data must never be published');
    if (!observation) assert.deepEqual(result.data, []);
    assert.ok(reads >= 2, 'stale response is refetched');
  });

test('a generation reset between fetch publication and its caller continuation cannot republish the old answer', async t => {
  let reads = 0, changes = 0;
  const changed = deferred(), resume = deferred(), final = deferred(), published = deferred();
  const original = ReadObservation.prototype.fetch;
  ReadObservation.prototype.fetch = async function (...args) {
    const result = await original.apply(this, args);
    if (result.read.data?.[0] === 'buffered') { published.resolve(); await resume.promise; }
    return result;
  };
  const client = createClient({ url: 'http://order.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++changes === 1) return Response.json({ seq: 0, generation: 1, tables: [] });
      if (changes === 2) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 1 });
    if (++reads === 1) return Response.json(ready(['initial']));
    if (reads === 2) return Response.json(ready(['buffered']));
    return Response.json(await final.promise);
  } });
  t.after(async () => { ReadObservation.prototype.fetch = original; changed.resolve({ seq: 2, generation: 2, tables: [] }); resume.resolve(); final.resolve(ready([], 2)); await client.close(); });
  const watch = client.observe(q, {}), values = [];
  watch.subscribe(() => values.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data?.[0] === 'initial' && changes >= 2);
  await client.mutate(m, {}); await published.promise;
  changed.resolve({ seq: 2, generation: 2, tables: [] });
  await until(() => changes >= 3);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  values.length = 0; resume.resolve();
  await until(() => reads >= 3);
  assert.ok(values.every(read => !read.data?.includes('buffered')), 'the outer refresh must not publish the retired fetch result again');
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  final.resolve(ready([], 2));
  await until(() => watch.getSnapshot().data?.length === 0);
});

test('direct online reads fence a generation change even when its sequence does not advance', async t => {
  let reads = 0, changes = 0;
  const old = deferred(), changed = deferred();
  const client = createClient({ url: 'http://order.test', persona: 'alice', fetch: async (url, init) => {
    if (url.includes('/changes')) {
      if (++changes === 1) return Response.json({ seq: 0, generation: 1, tables: [] });
      if (changes === 2) return Response.json(await changed.promise);
      return blocked(init.signal);
    }
    if (url.includes('/q/feed')) return Response.json(ready([]));
    if (++reads === 1) return Response.json(await old.promise);
    return Response.json(ready([]));
  } });
  t.after(async () => { changed.resolve({ seq: 0, generation: 2, tables: [] }); old.resolve(ready([])); await client.close(); });
  client.observe({ kind: 'query', name: 'feed' }, {});
  await until(() => changes >= 2);
  const read = client.query(q, {});
  await until(() => reads === 1);
  changed.resolve({ seq: 0, generation: 2, tables: [] });
  await until(() => changes >= 3);
  old.resolve(ready(['old generation']));
  assert.deepEqual((await read).data, []);
  assert.equal(reads, 2);
});
