import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadObservation } from '../dist/read-observation.js';
const ready = data => ({ data, complete: true, cut: null, fresh: true });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

for (const outcome of ['answer', 'loading', 'denied', 'failure']) test(`replacing fetch outcome: ${outcome}`, async () => {
  const watch = new ReadObservation(), gate = deferred();
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => {}, { retain: true });
  assert.deepEqual(watch.snapshot.data, ['private']);
  assert.equal(watch.snapshot.fresh, true);
  assert.equal(watch.snapshot.revalidating, true);
  if (outcome === 'failure') {
    gate.reject(Error('transport failed'));
    await assert.rejects(work, /transport failed/);
    assert.deepEqual(watch.snapshot, { ...ready(['private']), revalidating: true });
  } else {
    const read = outcome === 'answer' ? ready([]) : outcome === 'loading' ? { loading: true } : { denied: { code: 'E_RULE', family: 'rule', message: 'withdrawn' } };
    gate.resolve({ read }); await work;
    assert.deepEqual(watch.snapshot, read);
  }
  if (outcome !== 'answer' && outcome !== 'failure') {
    const next = deferred(), work = watch.fetch(() => next.promise, () => {});
    assert.ok(!('data' in watch.snapshot), 'the next fetch cannot reuse the previous private answer');
    next.resolve({ read: { loading: true } }); await work;
    assert.deepEqual(watch.snapshot, { loading: true });
  }
});

test('reset during a fetch clears its answer immediately and fences the returned publication', async () => {
  const watch = new ReadObservation(), gate = deferred();
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => {}, { retain: true });
  watch.reset({ loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
  gate.resolve({ read: ready(['private']) });
  assert.deepEqual((await work).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});

test('composition retains the previous answer through successful HTTP settlement', async () => {
  const watch = new ReadObservation(), gate = deferred(), publications = [];
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => publications.push(watch.snapshot), { retain: true, publishResult: false });
  assert.deepEqual(watch.snapshot.data, ['private']);
  gate.resolve({ read: ready(['remote']) });
  const result = await work;
  assert.deepEqual(result.read.data, ['remote'], 'caller can compose the new HTTP answer');
  assert.deepEqual(watch.snapshot, { ...ready(['private']), revalidating: true }, 'composition remains in flight');
  assert.equal(publications.at(-1), watch.snapshot);
  watch.retire();
  assert.ok(publications.every(read => !read.data?.includes('remote')), 'raw uncomposed HTTP answer is never published');
});

test('a reset during stale-response backoff prevents the next request', async () => {
  const watch = new ReadObservation(), rejected = deferred(); let requests = 0;
  const work = watch.fetch(async () => { requests++; return { read: ready(['old']) }; }, () => {}, {
    accept: () => { rejected.resolve(); return false; },
  });
  await rejected.promise;
  watch.reset({ loading: true });
  assert.deepEqual((await work).read, { loading: true });
  assert.equal(requests, 1);
});
