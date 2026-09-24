import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadObservation } from '../dist/read-observation.js';
const ready = data => ({ data, complete: true, cut: null, fresh: true });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

for (const outcome of ['answer', 'loading', 'denied', 'failure']) test(`one replacing fetch ends retention: ${outcome}`, async () => {
  const watch = new ReadObservation(), gate = deferred();
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => {}, { retain: true });
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
  const work = watch.fetch(() => gate.promise, () => {}, { retain: true });
  watch.reset({ loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
  gate.resolve({ read: ready(['private']) });
  assert.deepEqual((await work).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});

test('composition retires the previous answer at HTTP settlement before device composition finishes', async () => {
  const watch = new ReadObservation(), gate = deferred(), publications = [];
  watch.publish(ready(['private']));
  const work = watch.fetch(() => gate.promise, () => publications.push(watch.snapshot), { retain: true, publishResult: false });
  assert.deepEqual(watch.snapshot.data, ['private']);
  gate.resolve({ read: ready(['remote']) });
  const result = await work;
  assert.deepEqual(result.read.data, ['remote'], 'caller can compose the new HTTP answer');
  assert.deepEqual(watch.snapshot, { loading: true }, 'old answer is gone before further device work');
  assert.deepEqual(publications.at(-1), { loading: true });
  assert.ok(publications.every(read => !read.data?.includes('remote')), 'raw uncomposed HTTP answer is never published');
});
