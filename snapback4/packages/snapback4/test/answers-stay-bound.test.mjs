import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadObservation, answerIdentity } from '../dist/read-observation.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { createClient } from '../dist/client.js';
import { parked, until, q } from './helpers/answers-stay.mjs';
const ready = data => ({ data, complete: true, fresh: true, cut: null });
for (const keep of [undefined, true]) for (const end of ['late answer', 'throw', 'offline', 'exhausted']) {
  test(`online evidence while already revalidating: keep=${keep}, ${end}`, async t => {
    let now = 1000; t.mock.method(Date, 'now', () => now);
    const w = new ReadObservation(keep), gate = Promise.withResolvers(); t.after(() => w.retire());
    w.publish(ready('A')); const identity = answerIdentity(w.snapshot);
    w.reload(); assert.equal(episodeDeadline(w.snapshot), undefined);
    now = 4000; w.reload(true); assert.equal(episodeDeadline(w.snapshot), 5000);
    const result = w.fetch(() => gate.promise, () => {}, end === 'exhausted' ? { accept: () => false } : {});
    now = 4500; w.reload(); w.reload(true);
    assert.equal(episodeDeadline(w.snapshot), 5000); assert.equal(answerIdentity(w.snapshot), identity);
    if (end === 'late answer') {
      now = 5000; const loading = w.read(null); assert.deepEqual(loading, { loading: true }); assert.equal(w.read(null), loading);
      gate.resolve({ read: ready('B') }); await result; assert.equal(w.read(null).data, 'B');
    } else {
      if (end === 'throw') { gate.reject(Error('failed')); await assert.rejects(result); }
      else { gate.resolve({ read: ready('B'), transportOffline: end === 'offline' }); await result; }
      assert.deepEqual(w.read(null), { loading: true });
    }
  });
}
for (const keep of [undefined, true]) for (const failure of [false, true]) test(`actual /changes bounds the online answer: keep=${keep}, failed=${failure}`, async t => {
  let reads = 0;
  const change = Promise.withResolvers(), reply = Promise.withResolvers();
  const client = createClient({ url: 'http://rl-change.test', persona: 'bob', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') { await Promise.race([change.promise, parked(init.signal)]); return reads < 2 ? Response.json({ seq: 2, tables: ['rows'] }) : parked(init.signal); }
    if (path === '/probe') return parked(init.signal);
    assert.equal(path, '/q/item');
    if (++reads > 1) { await Promise.race([reply.promise, parked(init.signal)]); if (failure) throw Error('offline'); }
    return Response.json({ data: reads === 1 ? 'A' : 'B', complete: true, seq: reads === 1 ? 1 : 2, tables: ['rows'] });
  } });
  t.after(async () => { reply.resolve(); change.resolve(); await client.close(); });
  const watch = client.observe(q('item'), {}, { keep });
  await until(() => watch.getSnapshot().data === 'A');
  change.resolve(); await until(() => reads > 1);
  assert.equal(watch.getSnapshot().data, 'A'); assert.equal(watch.getSnapshot().revalidating, true);
  if (failure) reply.resolve();
  await until(() => watch.getSnapshot().loading);
  if (!failure) { reply.resolve(); await until(() => watch.getSnapshot().data === 'B'); }
});
