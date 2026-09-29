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

test('empty publication cannot prove absence when pending storage fails or the incarnation changes', async () => {
  const env = environment(null, { complete: true, cut: null, next: null }, true, 'none');
  const failure = Error('pending storage unavailable');
  env.queued = async () => { throw failure; };
  await assert.rejects(evaluateLocal(env, { kind: 'query', name: 'point' }, {}, 0, 0), error => error === failure);
  for (const reject of [false, true]) {
    env.incarnation = 0;
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    env.queued = () => { entered(); return new Promise((resolve, fail) => { release = () => reject ? fail(failure) : resolve([]); }); };
    const result = evaluateLocal(env, { kind: 'query', name: 'point' }, {}, 0, 0);
    await started; env.incarnation++; release();
    assert.equal(presence((await result).read), 'loading', 'both success and rejection recheck incarnation');
  }
});

test('queued presence cache propagates failure and fences stale results before notifying', async () => {
  const reads = new LocalReads();
  reads.queued([{ predictable: true, predicted: ['rows/pending'] }]);
  let updates = 0, notifications = 0;
  const watches = [{ updatePresence() { updates++; return true; }, subscribers: new Set([() => notifications++]) }];
  const failure = Error('receipt storage unavailable');
  await assert.rejects(reads.readQueued(async () => { throw failure; }, watches), error => error === failure);
  assert.equal(reads.pending(new Set(['rows'])), true);
  assert.equal(updates, 0); assert.equal(notifications, 0);
  let release;
  const stale = reads.readQueued(() => new Promise(resolve => { release = resolve; }), watches);
  reads.clear([]);
  release([]); await stale;
  assert.equal(reads.predictions, null, 'stale empty queue cannot certify absence after a commit');
  assert.equal(updates, 0); assert.equal(notifications, 0);
  await reads.readQueued(async () => [], watches);
  assert.equal(reads.pending(new Set(['rows'])), false);
  assert.equal(updates, 1); assert.equal(notifications, 1);
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

test('completed empty page chains use pending facts, not a predecessor cursor partial', async t => {
  const reads = new LocalReads(); reads.queued([]);
  const op = { kind: 'query', name: 'page' };
  const make = table => {
    const watch = localWatch(true, op, {}, table, 0, tables => reads.pending(tables));
    watch.setPresenceTables(new Set([table])); return watch;
  };
  const first = make('rows'), last = make('tail');
  first.publish(readyRead({ data: [], complete: true, cut: null, next: 'cursor', fresh: false }));
  last.publish(readyRead({ data: [], complete: true, cut: null, next: null, fresh: false }));
  const client = { observe: (_op, args) => {
    const watch = args.c === null ? first : last;
    return { getSnapshot: () => watch.read(null), subscribe: fn => { watch.subscribers.add(fn); return () => watch.subscribers.delete(fn); }, close() {} };
  } };
  const pages = new Pages(client, op, {}); let notifications = 0;
  const stop = pages.subscribe(() => notifications++);
  t.after(() => { stop(); first.retire(); last.retire(); });
  assert.equal(pages.getSnapshot().read.presence, 'partial');
  pages.loadMore();
  assert.equal(pages.getSnapshot().read.presence, 'absent', 'the final cursor proves the empty chain complete');
  first.reload();
  const identity = answerIdentity(first.snapshot);
  for (const [entries, expected] of [
    [[{ predictable: true, predicted: ['rows/new'] }], 'partial'],
    [[], 'absent'],
    [[{ predictable: true }], 'partial'],
    [[{ predictable: true, predicted: ['unrelated/new'] }], 'absent'],
  ]) {
    const before = notifications;
    await reads.readQueued(async () => entries, [first, last]);
    assert.ok(notifications > before, 'pending changes notify even when the predecessor stays partial');
    assert.equal(first.snapshot.presence, 'partial');
    assert.equal(first.snapshot.revalidating, true);
    assert.equal(answerIdentity(first.snapshot), identity);
    assert.equal(pages.getSnapshot().read.presence, expected);
    assert.deepEqual(pages.getSnapshot().items, []);
  }
});

test('two-page presence combines coverage and the final cursor with actual pending predicates', () => {
  let cases = 0;
  for (const a of [[], ['a']]) for (const b of [[], ['b']])
  for (const ca of [false, true]) for (const cb of [false, true])
  for (const xa of [null, 'meter']) for (const xb of [null, 'words'])
  for (const next of [null, 'more']) for (const pa of [false, true]) for (const pb of [false, true]) for (const fresh of [false, true]) {
    const first = readyRead({ data: a, complete: ca, cut: xa, next: 'cursor', fresh }, pa);
    const last = readyRead({ data: b, complete: cb, cut: xb, next, fresh }, pb);
    const client = { observe: (_op, args) => ({ getSnapshot: () => args.c === null ? first : last, subscribe: () => () => {}, close() {} }) };
    const pages = new Pages(client, { kind: 'query', name: 'page' }, {}), stop = pages.subscribe(() => {});
    pages.loadMore();
    const { items, read } = pages.getSnapshot();
    assert.deepEqual(items, [...a, ...b]);
    assert.equal(read.presence, items.length ? 'present' : ca && cb && xa === null && xb === null && next === null && !pa && !pb ? 'absent' : 'partial');
    assert.equal(read.fresh, fresh); stop(); cases++;
  }
  assert.equal(cases, 1024);
});

test('published replacements recompute presence even when a caller spreads the predecessor', t => {
  for (const keep of [undefined, true, false]) {
    const watch = new ReadObservation(keep);
    t.after(() => watch.retire());
    watch.publish(readyRead({ data: null, complete: true, cut: null, fresh: true }));
    const absent = watch.snapshot;
    watch.publish({ ...absent, data: { id: 'arrived' } });
    assert.equal(watch.snapshot.presence, 'present');
    assert.notEqual(answerIdentity(watch.snapshot), answerIdentity(absent));
    const present = watch.snapshot;
    watch.publish({ ...present, data: null });
    assert.equal(watch.snapshot.presence, 'absent');
    assert.notEqual(answerIdentity(watch.snapshot), answerIdentity(present));
  }
});
