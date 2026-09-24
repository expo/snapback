import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ReadObservation } from '../dist/read-observation.js';
import { createClient } from '../dist/client.js';
const ready = data => ({ data, complete: true, cut: null, fresh: true });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const until = async read => { for (let n = 0; n < 500; n++) { if (read()) return; await delay(10); } assert.fail('observation did not settle'); };

for (const outcome of ['answer', 'loading', 'denied', 'failure']) test(`one replacing fetch ends retention: ${outcome}`, async () => {
  const watch = new ReadObservation(), gate = deferred();
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => {});
  assert.deepEqual(watch.snapshot.data, ['private']);
  assert.equal(watch.snapshot.fresh, false);
  assert.ok(Number.isFinite(watch.snapshot.since));
  if (outcome === 'failure') {
    gate.reject(Error('transport failed'));
    await assert.rejects(work, /transport failed/);
    assert.deepEqual(watch.snapshot, { loading: true });
  } else {
    const read = outcome === 'answer' ? ready([]) : outcome === 'loading' ? { loading: true } : { denied: { code: 'E_RULE', family: 'rule', message: 'withdrawn' } };
    gate.resolve({ read }); await work;
    assert.deepEqual(watch.snapshot, read);
  }
  if (outcome !== 'answer') {
    const next = deferred(), work = watch.fetch(() => next.promise, () => {});
    assert.ok(!('data' in watch.snapshot), 'the next fetch cannot reuse the previous private answer');
    next.resolve({ read: { loading: true } }); await work;
    assert.deepEqual(watch.snapshot, { loading: true });
  }
});

test('reset during a fetch clears its answer immediately and fences the returned publication', async () => {
  const watch = new ReadObservation(), gate = deferred();
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => {});
  watch.reset({ loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
  gate.resolve({ read: ready(['private']) });
  assert.deepEqual((await work).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});

test('online generation change clears an in-flight kept answer and fences its old response', async t => {
  let queries = 0, changes = 0;
  const old = deferred(), change = deferred();
  const client = createClient({ url: 'http://generation.test', persona: 'alice', fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/changes') {
      if (++changes === 1) return Response.json({ seq: 1, generation: 1, tables: [] });
      if (changes === 2) return Response.json(await change.promise);
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true }));
    }
    if (path.startsWith('/m/')) return Response.json({ state: 'sent', id: JSON.parse(init.body).id, seq: 1 });
    if (++queries === 1) return Response.json({ data: ['private'], complete: true, seq: 1, tables: ['secrets'] });
    if (queries === 2) return Response.json(await old.promise);
    return Response.json({ loading: true });
  } });
  t.after(async () => { change.resolve({ seq: 2, generation: 2, tables: [] }); old.resolve({ loading: true }); await client.close(); });
  const watch = client.observe({ kind: 'query', name: 'page' }, {});
  await until(() => watch.getSnapshot().data && changes >= 2);
  await client.mutate({ kind: 'mutation', name: 'rerun' }, {});
  await until(() => queries === 2 && watch.getSnapshot().fresh === false);
  change.resolve({ seq: 2, generation: 2, tables: [] });
  // Entering the next change request proves the generation was applied. Check
  // now: waiting for loading could accidentally pass on the link watchdog.
  await until(() => changes >= 3);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  old.resolve({ data: ['private'], complete: true, seq: 1 });
  await until(() => queries >= 3);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  watch.close();
});
