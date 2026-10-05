// @ref LLP 3000.023#10 — a whole server cut covers repeated evidence, never local authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLocal } from '../dist/local-query.js';
import { LocalReads, localWatch, publishedApplyCut } from '../dist/local-reads.js';

const op = { kind: 'query', name: 'page' };
function fixture() {
  const reads = new LocalReads(), watch = localWatch(undefined, op, {}, 'page', 0, () => false);
  watch.tables = new Set(['rows']); reads.queued([]);
  const version = watch.changeVersion, authority = reads.revision;
  const f = { reads, watch, requests: 0, after: false, seq: 40, during: () => {}, late: () => {},
    outcome: { data: [], unknown: true, speculative: true, tables: ['rows'] } };
  f.env = {
    backend: { programs: [{ name: 'page', body: [{ table: 'rows' }] }],
      schema: { tables: { rows: { sync: {}, leave: 'until-revoked' } } } },
    incarnation: 0, get authority() { return reads.revision; },
    current: () => watch.changeVersion === version, serverCurrent: reads.serverCurrent(watch),
    credentialRevision: 0, partitionCurrent: true, nativeReady: true,
    principal: 'bob', link: 'online', caughtUp: true, identityChecked: true,
    signal: new AbortController().signal, unavailable: () => null,
    deviceNow: () => 1, serverNow: () => 1,
    queued: async () => { if (f.after) f.late(); reads.queued([]); return []; },
    pending: tables => reads.pending(tables),
    call: async () => ({ ok: f.outcome }),
    post: async () => { f.requests++; f.during(); f.after = true;
      return { ok: true, obsoleteAuth: false, json: { data: ['new'], complete: true, seq: f.seq } }; },
    serverAnswers: reads.serverAnswers.view(),
  };
  f.evidence = (cut = 40) => {
    reads.notified(['rows'], cut); reads.changed(watch, cut);
    reads.queued([]); reads.committed([watch], 'apply', ['rows'], [], cut);
    reads.applied([watch], cut);
  };
  f.run = () => evaluateLocal(f.env, op, {}, 0, authority);
  return f;
}

test('a decoded newer whole reply publishes through repeated notifications and published applies', async () => {
  const f = fixture();
  f.during = () => { for (let cut = 1; cut <= 40; cut++) f.evidence(cut); };
  f.late = () => f.evidence(); // Repeat at every post-response prediction checkpoint.
  f.env.followingPending = async () => { f.evidence(); return false; };
  const result = await f.run();
  assert.deepEqual(result.read.data, ['new']); assert.equal(result.serverOnly, true);
  assert.equal(result.publicationCurrent(), true); assert.equal(f.requests, 1);
  f.evidence(); assert.equal(result.publicationCurrent(), true, 'final caller continuation is covered too');
  f.evidence(41); assert.equal(result.publicationCurrent(), false, 'a genuinely newer cut still rejects');
  f.reads.changed(f.watch, 42);
  assert.equal(f.reads.current(f.watch, { read: result.read }), false, 'old replica cannot borrow the server proof');
});

for (const scenario of ['older cut', 'missing cut', 'invalid cut', 'unsequenced change', 'admission', 'settlement', 'store replacement', 'staged apply', 'unknown images', 'newer images', 'scope loss', 'prediction']) {
  test(`whole server progress refuses ${scenario}`, async () => {
    const f = fixture();
    f.during = () => {
      f.evidence();
      if (scenario === 'older cut') f.seq = 39;
      if (scenario === 'missing cut') f.seq = undefined;
      if (scenario === 'invalid cut') f.seq = NaN;
      if (scenario === 'unsequenced change') f.reads.changed(f.watch);
      if (scenario === 'admission') f.reads.admitting(() => [f.watch])();
      if (scenario === 'settlement') f.reads.committed([f.watch], 'settle', []);
      if (scenario === 'store replacement') f.reads.clear([f.watch]);
      if (['staged apply', 'unknown images', 'newer images'].includes(scenario)) {
        f.reads.queued([]);
        const cut = publishedApplyCut({ watermark: 40, images_at: scenario === 'unknown images' ? undefined : 41 }, scenario !== 'staged apply');
        f.reads.committed([f.watch], 'apply', [], [], cut);
      }
      if (scenario === 'scope loss') f.reads.withdrawScopes([f.watch], { watermark: 40, events: [{ kind: 'scope', table: 'rows', data: [] }] }, false)();
      if (scenario === 'prediction') { f.env.queued = async () => [{ predictable: true, predicted: ['rows/own'] }]; f.env.pending = () => true; }
    };
    const result = await f.run();
    assert.ok(!('data' in result.read), JSON.stringify(result.read));
    assert.equal(result.publicationCurrent, undefined);
  });
}

for (const scenario of ['retained dependency', 'retained component', 'retained rows', 'local reobservation']) {
  test(`server proof never qualifies ${scenario}`, async () => {
    const f = fixture();
    if (scenario === 'retained dependency') f.env.backend.schema.tables.rows.leave = 'delivered-history';
    if (scenario === 'retained component') f.outcome.components = { old: { retained: true }, current: { unknown: true } };
    if (scenario === 'retained rows') f.outcome.retainedRows = [{ source: ['rows', 'old'], retained: true, fields: {} }];
    if (scenario === 'local reobservation') f.env.post = async () => { f.evidence(); return { ok: false }; };
    else f.during = () => f.evidence();
    assert.ok(!('data' in (await f.run()).read));
  });
}

test('image publication metadata must certify the whole apply', () => {
  assert.equal(publishedApplyCut({ watermark: 4, images_at: 7 }, true), 7);
  for (const page of [{ watermark: 4 }, { watermark: 4, images_at: 3 }, { watermark: 4, images_at: NaN },
    { watermark: 4, images_at: 7, snapshot: true }, { watermark: 4, images_at: 7, snapshot_catchup: true }])
    assert.equal(publishedApplyCut(page, true), undefined);
  assert.equal(publishedApplyCut({ watermark: 4, images_at: 7 }, undefined), undefined);
  assert.equal(publishedApplyCut({ watermark: 4, images_at: 7 }, false), undefined);
});

test('publication proof expires at a hard boundary even after evaluation has finished', async () => {
  for (const change of [f => f.reads.changed(f.watch), f => f.reads.clear([f.watch]),
    f => f.reads.admitting(() => [f.watch])(), f => f.reads.committed([f.watch], 'settle')]) {
    const f = fixture(); f.during = () => f.evidence();
    const result = await f.run(); assert.equal(result.publicationCurrent(), true);
    change(f); assert.equal(result.publicationCurrent(), false);
  }
});

test('a published apply with existing predictions keeps its hard boundary', async () => {
  const f = fixture();
  f.during = () => {
    f.reads.predictions = ['other'];
    f.reads.committed([f.watch], 'apply', [], [], 40);
  };
  assert.ok(!('data' in (await f.run()).read));
});

for (const retained of [false, true]) test(`disjoint evidence preserves the actual local evaluation (retained: ${retained})`, async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
  if (retained) f.env.backend.schema.tables.rows.leave = 'delivered-history';
  f.outcome = { data: ['local'], complete: true, unknown: false, retained, tables: ['rows'], watermark: 1 };
  const disjoint = () => {
    f.reads.notified(['other'], 80); f.reads.queued([]);
    f.reads.committed([], 'apply', ['other'], [], 80); f.reads.applied([], 80);
  };
  f.env.call = async () => { disjoint(); return { ok: f.outcome }; };
  f.env.followingPending = async () => { disjoint(); return false; };
  const result = await f.run();
  assert.deepEqual(result.read.data, ['local']); assert.equal(f.requests, 0);
  assert.equal(result.publicationCurrent(), true);
  f.reads.notified(['rows'], 81);
  assert.equal(result.publicationCurrent(), false, 'intersecting evidence still retires the local result');
});

for (const kind of ['unknown notification', 'unknown apply', 'authorization input', 'native', 'staged apply', 'admission']) {
  test(`unchanged-input proof refuses ${kind}`, async () => {
    const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
    f.outcome = { data: ['old'], complete: true, unknown: false, tables: ['rows'] };
    if (kind === 'authorization input') f.env.backend.schema.tables.rows.rules = { read: { table: 'members' } };
    if (kind === 'native') f.env.backend.programs[0].native = true;
    f.env.call = async () => {
      if (kind === 'unknown notification') f.reads.notified(undefined, 40);
      else if (kind === 'unknown apply') f.reads.committed([], 'apply', undefined, [], 40);
      else if (kind === 'authorization input') f.reads.notified(['members'], 40);
      else if (kind === 'staged apply') f.reads.committed([], 'apply', ['other'], []);
      else if (kind === 'admission') f.reads.admitting(() => [])();
      else f.reads.notified(['other'], 40);
      return { ok: f.outcome };
    };
    assert.ok(!('data' in (await f.run()).read));
  });
}

for (const composed of [false, true]) test(`a disjoint replica footprint cannot certify an older external answer (composed: ${composed})`, async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
  if (composed) {
    f.env.backend.schema.tables.rows.leave = 'delivered-history';
    f.outcome = { data: ['local'], unknown: true, speculative: false, tables: ['rows'], watermark: 1 };
  }
  f.during = () => {
    f.reads.queued([]);
    // A server-only policy change can be absent from this replica footprint.
    f.reads.committed([], 'apply', ['other'], [], 41);
  };
  assert.ok(!('data' in (await f.run()).read), 'only the local inputs are proved unchanged');
});

for (const composed of [false, true]) test(`independent unchanged inputs and a covering external cut permit progress (composed: ${composed})`, async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
  if (composed) {
    f.env.backend.schema.tables.rows.leave = 'delivered-history';
    f.outcome = { data: ['local'], unknown: true, speculative: false, tables: ['rows'], watermark: 1 };
  }
  const disjoint = () => { f.reads.queued([]); f.reads.committed([], 'apply', ['other'], [], 40); };
  f.during = disjoint; f.late = disjoint;
  const result = await f.run(); assert.deepEqual(result.read.data, ['new']);
  assert.equal(result.publicationCurrent(), true);
  f.reads.queued([]); f.reads.committed([], 'apply', [], [], 41);
  assert.equal(result.publicationCurrent(), false, 'the final continuation rechecks the external cut');
});

test('a composed reply needs unchanged local inputs even when its server cut covers the change', async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
  f.env.backend.schema.tables.rows.leave = 'delivered-history';
  f.outcome = { data: ['local'], unknown: true, speculative: false, tables: ['rows'], watermark: 1 };
  f.during = () => { f.reads.queued([]); f.reads.committed([], 'apply', ['rows'], [], 40); };
  assert.ok(!('data' in (await f.run()).read));
});

test('remembered recovery cannot use a disjoint replica footprint to renew external authority', async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch); f.env.link = 'offline';
  f.reads.serverAnswers.view().set('page:{}', { read: { data: ['old'], complete: true, cut: null },
    at: 1, nextExpiry: null, tables: new Set(['rows']) }, 1);
  f.env.followingPending = async () => { f.reads.queued([]); f.reads.committed([], 'apply', ['other'], [], 40); return false; };
  assert.ok(!('data' in (await f.run()).read));
});

for (const local of [false, true]) test(`unaccounted watch versions cannot borrow later cut evidence (local: ${local})`, async () => {
  const f = fixture(); f.env.inputsCurrent = f.reads.inputsCurrent(f.watch);
  if (local) f.outcome = { data: ['local'], complete: true, unknown: false, tables: ['rows'] };
  else f.during = () => f.evidence();
  const result = await f.run(); assert.equal(result.publicationCurrent(), true);
  f.watch.changeVersion = (f.watch.changeVersion ?? 0) + 1;
  assert.equal(result.publicationCurrent(), false, 'the final callback must account for every version change');
  f.reads.changed(f.watch, 40);
  assert.equal(result.publicationCurrent(), false, 'later known evidence cannot hide the unknown boundary');
});
