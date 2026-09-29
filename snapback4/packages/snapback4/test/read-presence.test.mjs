// @ref LLP 3000.031#4 — total publication table, retention and page semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { presence, isReady, isLoading, isDenied } from '../dist/contract.js';
import { readyRead } from '../dist/read-presence.js';
import { evaluateLocal } from '../dist/local-query.js';
import { LocalReads, RememberedAnswers, localWatch, pendingTables } from '../dist/local-reads.js';
import { ReadObservation, revalidatingAnswer, answerIdentity } from '../dist/read-observation.js';
import { ReadApprovals } from '../dist/read-approval.js';
import { Pages } from '../dist/react-pages.js';
import { coldReadControl } from '../dist/device-control.js';

function environment(data, metadata, fresh, predicted) {
  return {
    backend: { schema: { tables: {} }, programs: [{ name: 'point', kind: 'Query', body: [{ table: 'rows' }, { table: 'unexecuted' }] }] },
    principal: 'alice', partitionCurrent: true, nativeReady: true, incarnation: 0, authority: 0, credentialRevision: 0,
    link: fresh ? 'online' : 'offline', caughtUp: fresh, identityChecked: fresh, lastSyncAt: 1,
    unavailable: () => null, deviceNow: () => 1, serverNow: () => 1,
    queued: async () => predicted === 'none' ? [] : [{ predictable: true, ...(predicted === 'unknown' ? {} : { predicted: [`${predicted}/id`] }) }],
    call: async () => ({ ok: { data, unknown: false, tables: ['rows'], ...metadata } }),
    post: async () => { throw Error('this answer is locally known'); },
    serverAnswers: new RememberedAnswers().view(), notify: () => {},
  };
}
test('publication decision table: top level × completeness/cut/next × freshness × pending footprint', async () => {
  let cases = 0;
  for (const [shape, values] of [['nullable', [null, { id: 'row', optional: null }]], ['array', [[], [null], [{ id: 'row' }]]], ['scalar', [false, 0, '', { liked: false }]]]) {
    for (const data of values) for (const complete of [false, true]) for (const cut of [null, 'meter', 'words']) for (const next of [null, 'cursor']) for (const fresh of [false, true]) for (const predicted of ['none', 'rows', 'unknown', 'unexecuted', 'other']) {
      const env = environment(data, { complete, cut, next }, fresh, predicted);
      const { read } = await evaluateLocal(env, { kind: 'query', name: 'point' }, {}, 0, 0);
      const empty = data === null || Array.isArray(data) && data.length === 0;
      // Complete local execution narrows away the unexecuted branch only then.
      const blocked = predicted === 'unknown' || predicted === 'rows' || !complete && predicted === 'unexecuted';
      const expected = !empty ? 'present' : complete && cut === null && next === null && !blocked ? 'absent' : 'partial';
      assert.equal(presence(read), expected, JSON.stringify({ shape, data, complete, cut, next, fresh, predicted }));
      assert.equal(read.fresh, fresh); assert.deepEqual(read.data, data); cases++;
    }
  }
  assert.equal(cases, 1080);
});

test('whole-union helper and cold pending predicate use the same five words', () => {
  assert.equal(presence({ loading: true }), 'loading'); assert.ok(isLoading({ loading: true }));
  const denied = { denied: { code: 'X', family: 'test', message: 'no' } };
  assert.equal(presence(denied), 'denied'); assert.ok(isDenied(denied));
  for (const predictions of [null, [], ['rows'], ['other']]) for (const tables of [null, new Set(), new Set(['rows'])]) {
    const captured = { predictions };
    assert.equal(coldReadControl(() => captured, captured).pending(tables), pendingTables(predictions, tables));
  }
});

test('pending inserts recompute retained absence, including already revalidating and facade-held answers', t => {
  const reads = new LocalReads(), watch = new ReadObservation(true), approvals = new ReadApprovals();
  t.after(() => { approvals.close(); watch.retire(); });
  watch.pending = () => reads.pending(new Set(['rows']));
  reads.queued([]);
  watch.publish(readyRead({ data: null, complete: true, cut: null, next: null, fresh: false, since: 1 }));
  const identity = answerIdentity(watch.snapshot), held = approvals.approve(watch.snapshot);
  watch.reload(); assert.equal(watch.read(null).presence, 'absent');
  reads.queued([{ predictable: true, predicted: ['rows/inserted'] }]);
  assert.equal(held.read().presence, 'partial');
  assert.equal(watch.read(null).revalidating, true);
  assert.equal(watch.snapshot.fresh, false); assert.equal(watch.snapshot.since, 1);
  assert.equal(answerIdentity(watch.snapshot), identity);
  assert.equal(revalidatingAnswer(watch.snapshot, false, true).presence, 'partial');
  reads.queued([{ predictable: true, predicted: ['other/row'] }]);
  assert.equal(held.read().presence, 'absent');
  reads.queued([{ predictable: true }]);
  assert.equal(held.read().presence, 'partial');
  watch.publish(readyRead({ data: { id: 'inserted' }, complete: true, cut: null, fresh: false }, true));
  assert.equal(presence(watch.read(null)), 'present');
  watch.publish({ loading: true }); assert.equal(presence(watch.read(null)), 'loading');
});

test('facade-held answers keep their own dependency set before replacement approval', t => {
  const reads = new LocalReads(), approvals = new ReadApprovals();
  reads.queued([]);
  const watch = localWatch(true, { kind: 'query', name: 'point' }, {}, 'point', 0, tables => reads.pending(tables));
  t.after(() => { approvals.close(); watch.retire(); });
  watch.setPresenceTables(new Set(['a']));
  watch.publish(readyRead({ data: null, complete: true, cut: null, fresh: false }));
  const held = approvals.approve(watch.snapshot);
  watch.setPresenceTables(new Set(['b']));
  watch.publish(readyRead({ data: null, complete: true, cut: null, fresh: false }));
  reads.queued([{ predictable: true, predicted: ['a/row'] }]);
  assert.equal(watch.read(null).presence, 'absent', 'B reads b only');
  assert.equal(held.read().presence, 'partial', 'A still reads a until B is approved');
  assert.equal(held.read().revalidating, true);
  approvals.approve(watch.snapshot);
  assert.equal(held.read().presence, 'absent');
  reads.queued([{ predictable: true, predicted: ['b/row'] }]);
  assert.equal(held.read().presence, 'partial', 'approval installs B dependencies');
});

test('usePage publishes presence on the combined read; items alone prove nothing', t => {
  const watch = new ReadObservation(true);
  const client = { observe: () => ({ getSnapshot: () => watch.read(null), subscribe: () => () => {}, close() {} }) };
  const pages = new Pages(client, { kind: 'query', name: 'page' }, {});
  const stop = pages.subscribe(() => {}); t.after(() => { stop(); watch.retire(); });
  assert.deepEqual(pages.getSnapshot().items, []); assert.equal(presence(pages.getSnapshot().read), 'loading');
  for (const data of [[], ['row']]) for (const complete of [false, true]) for (const next of [null, 'more']) for (const cut of [null, 'meter']) for (const pending of [false, true]) {
    watch.publish(readyRead({ data, complete, next, cut, fresh: false }, pending));
    const result = pages.getSnapshot();
    assert.ok(isReady(result.read)); assert.deepEqual(result.items, data);
    assert.equal(result.read.presence, data.length ? 'present' : complete && next === null && cut === null && !pending ? 'absent' : 'partial');
  }
});
