// @ref LLP 3000.041#42-w2-the-client-re-evaluates-precisely-and-never-loses-a-notification — the
// truth table of §4.1 and the W2a skip rule over a projected `/changes` body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyChange, watchAffected, watchRevokes, declaredTables, audienceArity } from '../dist/change-evidence.js';
import { intervalChanges } from '../dist/query-dependencies.js';
import { changeFeed } from '../dist/changes.js';

const arity = table => ({ messages: 1, members: 1, posts: 0, notes: undefined })[table];
const watch = (tables, scopes, extra = {}) => ({ tables: new Set(tables), scopes, protectedReads: [], ...extra });
const body = (over = {}) => ({ seq: 7, interest: ['messages', 'members'], tables: ['messages'], preserved: ['messages', 'members'], preservedOthers: true,
  changes: { after: 5, through: 7, writes: { messages: null }, others: false }, partitions: { messages: { own: false, public: false, groups: [['c1']] } }, ...over });
const classify = json => classifyChange(json, intervalChanges(json.changes, 5, 7));

test('an unprojected body keeps today\'s table overlap and revokes nothing on its own', () => {
  const e = classify({ seq: 7, tables: ['messages'], preserved: ['members'], changes: null });
  assert.equal(e.projected, false);
  assert.equal(watchAffected(watch(['messages'], undefined), e, arity), true);
  assert.equal(watchAffected(watch(['members'], undefined), e, arity), false);
  assert.equal(watchRevokes(watch(['messages'], undefined), e), false, 'the caller keeps passing preserved to the classifier');
});

test('a room-A write skips a room-B watch on the same table and re-runs room A', () => {
  const e = classify(body());
  assert.equal(e.projected, true); assert.equal(e.unknown, false);
  assert.equal(watchAffected(watch(['messages'], { messages: [{ 0: 'c2' }] }), e, arity), false, 'disjoint full group skips');
  assert.equal(watchAffected(watch(['messages'], { messages: [{ 0: 'c1' }] }), e, arity), true, 'overlapping group re-runs');
  assert.equal(watchAffected(watch(['members'], { members: [{ 0: 'c2' }] }), e, arity), false, 'an untouched preserved table skips');
});

test('unknown scopes, partial prefixes, own and public bits all re-run', () => {
  const e = classify(body());
  assert.equal(watchAffected(watch(['messages'], undefined), e, arity), true, 'missing scopes');
  assert.equal(watchAffected(watch(['messages'], { messages: [{}] }), e, arity), true, 'empty scope');
  assert.equal(watchAffected(watch(['notes'], { notes: [{ 0: 'x' }] }), classify(body({ interest: ['messages', 'members', 'notes'], tables: ['notes'], preserved: ['messages', 'members', 'notes'], partitions: { notes: { own: false, public: false, groups: [['y']] } } })), e => arity(e)), true, 'unknown arity');
  assert.equal(watchAffected(watch(['messages'], { messages: [{ 0: 'c2' }] }), classify(body({ partitions: { messages: { own: true, public: false, groups: [] } } })), arity), true, 'own bit');
  assert.equal(watchAffected(watch(['messages'], { messages: [{ 0: 'c2' }] }), classify(body({ partitions: { messages: { own: false, public: true, groups: [] } } })), arity), true, 'public bit');
  assert.equal(watchAffected(watch(['messages'], { messages: [{ 0: 'c2' }] }), classify(body({ partitions: '*' })), arity), true, 'saturated projection');
  assert.equal(watchAffected(watch(['members'], { members: [{ 0: 'c2' }] }), classify(body({ preserved: ['messages'] })), arity), true, 'a table the classifier dropped re-runs even when untouched');
});

test('a recorded table outside the interest is judged by the aggregate bits', () => {
  const outside = watch(['rankings'], { rankings: [{}] });
  assert.equal(watchAffected(outside, classify(body()), arity), true, 'outside-interest tables always re-run');
  assert.equal(watchRevokes(outside, classify(body({ preservedOthers: true }))), false);
  assert.equal(watchRevokes(outside, classify(body({ preservedOthers: false }))), true);
  assert.equal(watchRevokes(watch(['messages'], undefined), classify(body({ preserved: ['members'] }))), true, 'inside, not preserved');
  assert.equal(watchRevokes(watch(['messages'], undefined), classify(body())), false, 'inside, preserved');
});

test('interest overflow, a missing bit and null evidence are unknown: re-run, never revoke', () => {
  for (const over of [{ interest: '*' }, { preserved: ['messages', 'members'], preservedOthers: undefined }, { preserved: null }]) {
    const e = classify(body(over));
    assert.equal(watchAffected(watch(['members'], { members: [{ 0: 'c2' }] }), e, arity), true, JSON.stringify(over));
    assert.equal(watchRevokes(watch(['rankings'], undefined), e), false, JSON.stringify(over));
  }
  const noBit = classify(body({ changes: { after: 5, through: 7, writes: {} } }));
  assert.equal(noBit.writes, undefined, 'a projected writes map without its bit is not trusted');
  const outsideWrite = classify(body({ changes: { after: 5, through: 7, writes: {}, others: true } }));
  assert.equal(outsideWrite.writesOthers, true); assert.deepEqual(outsideWrite.writes, {});
});

test('declared interest names online-only tables only and the poll carries it', async () => {
  const synced = table => ({ messages: true, rankings: false })[table];
  assert.deepEqual(declaredTables([watch(['messages', 'rankings']), watch(['unknown'])], synced), ['rankings', 'unknown']);
  assert.equal(audienceArity('Public'), 0); assert.equal(audienceArity({ Column: 'owner' }), 1); assert.equal(audienceArity({ Target: { table: 'm', prefix: ['a', 'b'], principal: 'p' } }), 2); assert.equal(audienceArity(undefined), undefined);
  const urls = [];
  const fetchNow = async url => { urls.push(url); return new Response(JSON.stringify({ seq: 1, tables: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const feed = changeFeed(fetchNow, 'http://h', new AbortController().signal, () => {}, () => {});
  await feed(1, 0, {}, undefined, undefined, undefined, { tables: ['rankings', 'notes'] });
  await feed(1, 0, {}, undefined, undefined, undefined, { tables: [] });
  await feed(1, 0, {}, undefined, undefined, undefined, undefined);
  assert.match(urls[0], /&interest=1&tables=rankings%2Cnotes$/);
  assert.match(urls[1], /&interest=1$/);
  assert.doesNotMatch(urls[2], /interest/);
});
