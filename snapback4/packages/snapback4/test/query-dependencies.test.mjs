// @ref LLP 3000.023#11 — unknown is conservative, and observation cannot lose a wakeup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dependencies, intersects, QueryChanges, QueryCuts, waitForQueryWrites } from '../dist/query-dependencies.js';

test('column proofs distinguish receipt watermarks from membership authorization', () => {
  const membership = { members: ['conversation', 'principal'] };
  assert.equal(intersects(membership, { members: ['seenOrdinal'] }), false);
  assert.equal(intersects(membership, { members: null }), true, 'insert/delete changes existence');
  assert.equal(intersects({ members: null }, { members: ['seenOrdinal'] }), true, 'returned rows see watermarks');
  assert.equal(intersects(membership, undefined), true);
  assert.equal(intersects(undefined, {}), true);
  assert.equal(intersects(membership, {}), false, 'proved empty effect');
  for (const settlement of [undefined, null, {}, { reads: {}, writes: { t: 7 } }]) {
    assert.equal(dependencies({ programs: [{ name: 'x', settlement }] }, 'x'), undefined);
  }
});
test('unrelated commits preserve captures; unknown changes and relevant cuts fence them', () => {
  const changes = new QueryChanges(), captured = changes.capture(), tables = new Set(['messages']);
  changes.change(['likes']); assert.equal(captured(tables), true);
  changes.change(); assert.equal(captured(tables), false);
  const cuts = new QueryCuts(); cuts.change(4); cuts.change(5, ['likes']);
  assert.equal(cuts.current(4, tables), true);
  cuts.change(6, ['messages']); assert.equal(cuts.current(4, tables), false);
  assert.equal(cuts.current(6, tables), true);
});
test('an observation during asynchronous custody inspection cannot be missed', { timeout: 1000 }, async () => {
  const first = Promise.withResolvers(); let notify, reads = 0, removed = false;
  const wait = waitForQueryWrites(() => ++reads === 1 ? first.promise : false,
    callback => { notify = callback; return () => { removed = true; }; }, new AbortController().signal);
  notify(); first.resolve(true);
  await wait;
  assert.equal(reads, 2); assert.equal(removed, true);
});
test('custody wait cancellation releases its subscription without an observation', async () => {
  const abort = new AbortController(); let removed = false;
  const wait = waitForQueryWrites(() => true, () => () => { removed = true; }, abort.signal);
  abort.abort(Error('deadline'));
  await assert.rejects(wait); assert.equal(removed, true);
});
