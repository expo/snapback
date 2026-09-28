import test from 'node:test';
import assert from 'node:assert/strict';
import { answerIdentity, answerObservation } from '../dist/read-observation.js';
import { peekObservation } from '../dist/observe-watch.js';
import { fixture, op, answer, manifest, until, delay, silent } from './helpers/delivery-app-fixture.mjs';

for (const tier of ['online', 'local']) {
  for (const refusal of ['false', 'throw']) test(`createApp ${tier}: ${refusal} authority refusal never collects delivery`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(() => { h.hold(); return answer(); });
    const watch = h.observe(); await until(() => h.pending.length);
    assert.deepEqual(watch.getSnapshot(), { loading: true });
    await silent(h);
    if (refusal === 'throw') h.pending[0].reject(Error('authority failed'));
    else h.pending[0].resolve(false);
    await until(() => watch.getSnapshot().denied);
    assert.equal(watch.getSnapshot().denied.code, refusal === 'throw' ? 'E_CLIENT' : 'E_AUTH');
    h.release(); await silent(h, 'refused answer');
  });

  test(`createApp ${tier}: superseded answer never reports; approved successor reports exactly once`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(n => { h.hold(); return n === 1 ? answer([41], { refresh: 250 }) : answer([43]); });
    const watch = h.observe();
    await until(() => h.pending.length >= 2 && h.queries === 2);
    assert.equal(peekObservation(h.raw, op, {}).data[0].ordinal, 43);
    h.pending[0].resolve(true); await silent(h, 'superseded 41');
    h.pending.at(-1).resolve(true);
    await until(() => watch.getSnapshot().data?.[0]?.ordinal === 43);
    await until(() => h.reports.length === 1);
    assert.deepEqual(h.collections, [manifest([43])]);
    assert.deepEqual(h.reports.map(r => r.args), [{ conversation: 'c', from: 43, through: 43 }]);
  });

  for (const deadline of ['row']) test(`createApp ${tier}: ${deadline} expiry before approval never collects`, async t => {
    const h = await fixture(t, tier), next = Promise.withResolvers();
    t.after(() => next.resolve(answer([])));
    h.onAnswer(n => {
      if (n > 1) return next.promise;
      h.hold(); return answer([41], deadline === 'row' ? { nextExpiry: Date.now() + 500 } : {});
    });
    const watch = h.observe(); await until(() => h.pending.length);
    const read = peekObservation(h.raw, op, {}), owner = answerObservation(read);
    assert.equal(read.data[0].ordinal, 41);
    await delay(550);
    h.release();
    await silent(h, `expired ${deadline}`);
    assert.ok(!('data' in watch.getSnapshot()));
  });

  test(`createApp ${tier}: peer approval shares one collection of the exact manifest`, async t => {
    const h = await fixture(t, tier), response = Promise.withResolvers();
    h.onAnswer(() => response.promise);
    const first = h.observe(), second = h.observe();
    await until(() => h.queries === 1);
    // Let both facades finish opening before the raw answer arrives.
    await delay(20); h.hold(); response.resolve(answer([41, 43]));
    await until(() => h.pending.length >= 2);
    await silent(h);
    h.pending[1].resolve(true);
    await until(() => second.getSnapshot().data?.length === 2);
    assert.equal(first.getSnapshot(), second.getSnapshot(), 'peer publishes shared approval');
    h.pending[0].resolve(true);
    await until(() => h.reports.length === 2); await delay(300);
    assert.deepEqual(h.collections, [manifest([41, 43])], 'collect once, before interval deduplication');
    assert.deepEqual(h.reports.map(r => r.args), [
      { conversation: 'c', from: 41, through: 41 }, { conversation: 'c', from: 43, through: 43 },
    ]);
  });

  test(`createApp ${tier}: temporary session-store failure at raw publication cannot report unseen 41`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(() => { h.failStorage(true); return answer(); });
    const watch = h.observe();
    await until(() => watch.getSnapshot().denied?.code === 'E_CLIENT');
    h.failStorage(false); // Restore before the queue's 250 ms debounce.
    await silent(h, 'Astra E_CLIENT reproduction');
  });

  for (const recovery of ['approve', 'refuse']) test(`createApp ${tier}: a new peer can ${recovery} the same answer after storage recovers`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(() => { h.failStorage(true); return answer(); });
    const first = h.observe();
    await until(() => first.getSnapshot().denied?.code === 'E_CLIENT');
    const identity = answerIdentity(peekObservation(h.raw, op, {}));
    h.failStorage(false);
    await silent(h, 'refusal before recovery');
    h.hold();
    const peer = h.observe();
    await until(() => h.pending.length === 1);
    h.pending[0].resolve(true); // The new facade may attach to the existing raw watch.
    await until(() => h.pending.length === 2);
    await silent(h, 'new approval still pending');
    h.pending[1].resolve(recovery === 'approve');
    if (recovery === 'approve') {
      await until(() => peer.getSnapshot().data?.[0]?.ordinal === 41);
      assert.equal(first.getSnapshot(), peer.getSnapshot(), 'the original facade also recovers');
      await until(() => h.reports.length === 1, 'recovered manifest report');
      await delay(300);
      assert.deepEqual(h.collections, [manifest([41])], 'one collection of the original manifest');
      assert.deepEqual(h.reports.map(r => r.args), [{ conversation: 'c', from: 41, through: 41 }]);
      if (tier === 'local') await until(() => h.debt()[0]?.reported?.[0]?.[0] === 41, 'durable reported coverage');
    } else {
      await until(() => peer.getSnapshot().denied?.code === 'E_AUTH');
      assert.equal(first.getSnapshot(), peer.getSnapshot(), 'the refusal reaches both facades');
      await silent(h, 'answer never approved');
    }
    assert.equal(h.queries, 1, 'no refetch restored the manifest');
    assert.equal(answerIdentity(peekObservation(h.raw, op, {})), identity, 'the raw answer is unchanged');
  });

  for (const outcome of ['approve', 'false', 'throw', 'expired']) test(`createApp ${tier}: query waits for final ${outcome} check before accepting delivery`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(() => { h.hold(); return answer([41], outcome === 'expired' ? { nextExpiry: Date.now() + 500 } : {}); });
    let returned = false;
    const query = h.client.query(op, {}).then(read => { returned = true; return read; });
    await until(() => h.pending.length); assert.equal(returned, false);
    await silent(h);
    if (outcome === 'expired') await delay(220);
    if (outcome === 'throw') h.pending[0].reject(Error('query authority failed'));
    else h.pending[0].resolve(outcome !== 'false');
    const read = await query;
    if (outcome === 'approve') {
      assert.equal(read.data[0].ordinal, 41);
      await until(() => h.reports.length === 1);
      assert.deepEqual(h.collections, [manifest([41])]);
    } else {
      if (outcome === 'expired') assert.deepEqual(read, { loading: true });
      else assert.equal(read.denied.code, outcome === 'throw' ? 'E_CLIENT' : 'E_AUTH');
      h.release(); await silent(h);
    }
  });

  test(`createApp ${tier}: background-only delivery waits for facade approval with changes held`, async t => {
    const h = await fixture(t, tier);
    h.onAnswer(n => {
      if (n === 1) return answer([], { refresh: 250 });
      h.hold(); return answer([47]);
    });
    const watch = h.observe(); await until(() => watch.getSnapshot().data?.length === 0);
    await until(() => h.pending.length && h.queries === 2);
    await silent(h, 'background 47 awaiting approval');
    assert.deepEqual(watch.getSnapshot(), { loading: true }, "different data invalidates the old approval");
    h.pending.at(-1).resolve(true);
    await until(() => watch.getSnapshot().data?.[0]?.ordinal === 47);
    await until(() => h.reports.length === 1);
    assert.deepEqual(h.collections, [manifest([47])]);
    assert.deepEqual(h.reports[0].args, { conversation: 'c', from: 47, through: 47 });
  });
}

test('createApp local: superseding an approved answer fences its delayed collection commit', async t => {
  const gate = Promise.withResolvers(), finished = Promise.withResolvers(), successor = Promise.withResolvers();
  t.after(() => { gate.resolve(); successor.resolve(answer([43])); });
  let held;
  const h = await fixture(t, 'local', { async collect(commit, request, current) {
    if (held) return commit();
    held = { request, current };
    await gate.promise;
    try { return await commit(); } finally { finished.resolve(); }
  } });
  h.onAnswer(n => {
    if (n === 1) return answer([41], { refresh: 250 });
    h.hold(); return successor.promise;
  });
  const watch = h.observe();
  await until(() => watch.getSnapshot().data?.[0]?.ordinal === 41 && held);
  const original = peekObservation(h.raw, op, {}), owner = answerObservation(original);
  const session = h.raw.session(), incarnation = owner.incarnation, resetVersion = owner.resetVersion;
  assert.ok(Number.isInteger(incarnation), 'the real local watch records its client incarnation');
  assert.equal(held.current(), true, '41 is approved and current before the delay');
  assert.deepEqual(Object.values(JSON.parse(held.request.value).groups).map(g => g.owed), [[[41, 41]]]);
  assert.deepEqual(h.debt(), [], 'the held collection has not committed');
  successor.resolve(answer([43]));
  await until(() => h.pending.length && peekObservation(h.raw, op, {}).data?.[0]?.ordinal === 43);
  assert.notEqual(answerIdentity(peekObservation(h.raw, op, {})), answerIdentity(original));
  assert.equal(answerObservation(peekObservation(h.raw, op, {})), owner);
  assert.deepEqual(h.raw.session(), session, 'credentials stay unchanged');
  assert.equal(owner.incarnation, incarnation, 'the client incarnation stays unchanged');
  assert.equal(owner.resetVersion, resetVersion, 'no reset supplied the fence');
  gate.resolve(); await finished.promise; await delay(320);
  assert.deepEqual(h.debt(), [], 'superseded 41 writes no debt');
  assert.deepEqual(h.reports, [], 'neither stale 41 nor unapproved 43 reports');
  h.pending[0].resolve(true);
  await until(() => watch.getSnapshot().data?.[0]?.ordinal === 43 && h.reports.length === 1);
  assert.deepEqual(h.collections, [manifest([41]), manifest([43])]);
  assert.deepEqual(h.reports.map(r => r.args), [{ conversation: 'c', from: 43, through: 43 }]);
  await until(() => h.debt()[0]?.reported?.[0]?.[0] === 43, 'successor debt commits normally');
});
