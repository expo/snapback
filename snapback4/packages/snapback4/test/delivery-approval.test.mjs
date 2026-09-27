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
    h.pending[1].resolve(true);
    await until(() => watch.getSnapshot().data?.[0]?.ordinal === 43);
    await until(() => h.reports.length === 1);
    assert.deepEqual(h.collections, [manifest([43])]);
    assert.deepEqual(h.reports.map(r => r.args), [{ conversation: 'c', from: 43, through: 43 }]);
  });

  for (const deadline of ['episode', 'row']) test(`createApp ${tier}: ${deadline} expiry before approval never collects`, async t => {
    const h = await fixture(t, tier), next = Promise.withResolvers();
    t.after(() => next.resolve(answer([])));
    h.onAnswer(n => {
      if (n > 1) return next.promise;
      h.hold(); return answer([41], deadline === 'row' ? { nextExpiry: Date.now() + 500 } : {});
    });
    const watch = h.observe(); await until(() => h.pending.length);
    const read = peekObservation(h.raw, op, {}), owner = answerObservation(read);
    assert.equal(read.data[0].ordinal, 41);
    if (deadline === 'episode') {
      // Begin the real raw watch's retention episode without delivering its timer.
      // The delayed approval must consult the same identity's deadline latch.
      owner.reload();
      assert.equal(answerIdentity(owner.snapshot), answerIdentity(read));
    }
    await delay(deadline === 'episode' ? 1050 : 550);
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
    assert.equal(watch.getSnapshot().data?.length, 0);
    h.pending[0].resolve(true);
    await until(() => watch.getSnapshot().data?.[0]?.ordinal === 47);
    await until(() => h.reports.length === 1);
    assert.deepEqual(h.collections, [manifest([47])]);
    assert.deepEqual(h.reports[0].args, { conversation: 'c', from: 47, through: 47 });
  });
}
