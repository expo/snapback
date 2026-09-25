import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalReads } from '../dist/local-reads.js';
import { ReadObservation } from '../dist/read-observation.js';

test('a local commit unconditionally retires retained answers and in-flight publication', async () => {
  const reads = new LocalReads(), watch = Object.assign(new ReadObservation(), { expiryTimer: null });
  watch.publish({ data: ['private'], complete: true, cut: null, fresh: true });
  let release;
  const fetch = watch.fetch(() => new Promise(resolve => { release = resolve; }), () => {}, { retain: true });
  assert.equal(watch.kept, true);
  reads.clear([watch]);
  assert.equal(reads.revision, 1);
  assert.deepEqual(watch.snapshot, { loading: true });
  release({ read: { data: ['private'], complete: true, cut: null, fresh: true } });
  assert.deepEqual((await fetch).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});
