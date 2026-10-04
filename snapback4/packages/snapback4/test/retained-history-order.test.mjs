// @ref LLP 3000.028#3.2 — a server cut cannot outrun current/retained routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLocal } from '../dist/local-query.js';
import { RememberedAnswers } from '../dist/local-reads.js';

const op = { kind: 'query', name: 'history' };
const partial = { data: ['held'], unknown: true, complete: false, tables: ['messages'] };
function fixture() {
  const calls = [], cache = new RememberedAnswers();
  const program = { name: op.name, kind: 'Query', body: [{ table: 'messages' }] };
  const f = { calls, cache, program, watermark: 4, captured: 4, first: partial, second: partial,
    reply: { data: [], complete: true, seq: 5 }, state: async () => ({ ok: { watermark: f.watermark } }) };
  let queries = 0;
  f.env = {
    backend: { programs: [program], schema: { tables: {
      messages: { sync: { audience: {} }, leave: 'delivered-history' },
      other: { sync: { audience: {} }, leave: 'until-revoked' },
    } } },
    principal: 'bob', partitionCurrent: true, nativeReady: true,
    incarnation: 0, authority: 0, credentialRevision: 0,
    link: 'online', caughtUp: true, identityChecked: true, lastSyncAt: 1,
    signal: new AbortController().signal, unavailable: () => null,
    deviceNow: () => 1, serverNow: () => 1, queued: async () => [], pending: () => false,
    call: async request => {
      calls.push(request.op);
      if (request.op === 'state') return f.state();
      assert.equal(request.op, 'query');
      return { ok: queries++ ? f.second : f.first };
    },
    post: async () => ({ ok: true, json: f.reply, obsoleteAuth: false, appliedWatermark: f.captured }),
    serverAnswers: cache.view(),
  };
  f.run = () => evaluateLocal(f.env, op, {}, 0, 0);
  return f;
}

test('ahead server empty is replaced by permitted partial history, never remembered as absence', async () => {
  const f = fixture(), result = await f.run();
  assert.deepEqual(result.read.data, ['held']);
  assert.equal(result.read.complete, false); assert.equal(result.read.fresh, false);
  assert.equal(result.serverOnly, false); assert.equal(result.served, true);
  assert.equal(f.cache.size, 0);
  assert.deepEqual(f.calls, ['query', 'state']);
});

for (const first of [{ loading: true, unknown: true }, { data: [], speculative: true, unknown: true }]) {
  test(`stalled speculative or unavailable history stays loading: ${JSON.stringify(first)}`, async () => {
    const f = fixture(); f.first = first;
    assert.deepEqual((await f.run()).read, { loading: true });
    assert.equal(f.cache.size, 0);
  });
}

for (const kind of ['until-revoked', 'online only', 'disjoint', 'equal cut', 'older cut', 'complete local']) {
  test(`unchanged fast path has no added device call: ${kind}`, async () => {
    const f = fixture();
    if (kind === 'until-revoked') f.env.backend.schema.tables.messages.leave = kind;
    if (kind === 'online only') delete f.env.backend.schema.tables.messages.sync;
    if (kind === 'disjoint') { f.program.body = [{ table: 'other' }]; f.first = { ...partial, tables: ['other'] }; }
    if (kind === 'equal cut') f.reply.seq = 4;
    if (kind === 'older cut') f.reply.seq = 3;
    if (kind === 'complete local') f.first = { ...partial, unknown: false, complete: true };
    const result = await f.run();
    assert.deepEqual(result.read.data, kind === 'complete local' ? ['held'] : []);
    assert.equal(result.read.fresh, true); assert.equal(result.read.complete, true);
    assert.deepEqual(f.calls, ['query']);
  });
}

for (const kind of ['static unexecuted branch', 'native', 'missing watermark', 'invalid watermark', 'missing sequence']) {
  test(`uncertain routing remains provisional: ${kind}`, async () => {
    const f = fixture();
    if (kind === 'static unexecuted branch') f.first = { ...partial, tables: ['other'] };
    if (kind === 'native') { f.program.body = []; f.program.native = true; f.first = { ...partial, tables: [] }; }
    if (kind === 'missing watermark') f.state = async () => ({ ok: {} });
    if (kind === 'invalid watermark') f.watermark = NaN;
    if (kind === 'missing sequence') delete f.reply.seq;
    const result = await f.run();
    assert.deepEqual(result.read.data, ['held']); assert.equal(result.read.complete, false);
    assert.equal(result.read.fresh, false); assert.equal(f.cache.size, 0);
  });
}

for (const kind of ['retained partial', 'retained complete', 'still current', 'new composition', 'new row mask', 'local refusal']) {
  test(`caught-up device reroutes the original fallback: ${kind}`, async () => {
    const f = fixture(); f.watermark = 5;
    f.second = { data: ['held'], retained: true, unknown: false, complete: false, tables: ['messages'] };
    if (kind === 'retained complete') f.second.complete = true;
    if (kind === 'still current') { f.second = partial; f.reply.data = ['current']; }
    if (kind === 'new composition') {
      f.reply.data = { left: [], right: ['current'] };
      f.second = { data: { left: ['held'], right: ['partial'] }, unknown: true, complete: false,
        components: { left: { retained: true, unknown: false, complete: false }, right: { unknown: true } } };
    }
    if (kind === 'new row mask') f.second = { ...partial, retainedRows: [{ source: ['messages', 'held'], retained: true, fields: {} }] };
    if (kind === 'local refusal') f.second = { denied: { code: 'NOT_MEMBER', family: 'rule', message: 'membership required' } };
    const result = await f.run();
    if (kind === 'local refusal') assert.equal(result.read.denied?.code, 'NOT_MEMBER');
    else assert.deepEqual(result.read.data, kind === 'still current' ? ['current'] : kind === 'new composition' ? { left: ['held'], right: ['current'] } : ['held']);
    assert.deepEqual(f.calls, ['query', 'state', 'query']);
    assert.equal(f.cache.size, kind === 'still current' ? 1 : 0);
  });
}

test('an explicit original-query refusal wins without waiting for the replica', async () => {
  const f = fixture(); f.reply = { denied: { code: 'NOT_MEMBER', family: 'rule', message: 'membership required' }, seq: 5 };
  assert.deepEqual((await f.run()).read, { denied: f.reply.denied });
  assert.deepEqual(f.calls, ['query']);
});

for (const boundary of ['authority', 'incarnation', 'credentials', 'prediction', 'abort', 'closed']) {
  test(`the watermark await preserves the ${boundary} publication fence`, async () => {
    const f = fixture(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.state = async () => { entered.resolve(); await release.promise; return { ok: { watermark: 4 } }; };
    const pending = f.run(); await entered.promise;
    if (boundary === 'authority') f.env.authority++;
    if (boundary === 'incarnation') f.env.incarnation++;
    if (boundary === 'credentials') f.env.credentialRevision++;
    if (boundary === 'prediction') f.env.pending = () => true;
    if (boundary === 'closed') f.env.unavailable = () => ({ code: 'E_CLOSED', family: 'client', message: 'closed' });
    if (boundary === 'abort') f.env.signal = AbortSignal.abort(new Error('stopped'));
    release.resolve();
    if (boundary === 'abort') await assert.rejects(pending, /stopped/);
    else {
      const result = await pending;
      if (boundary === 'prediction') assert.deepEqual(result.read.data, ['held']);
      else if (boundary === 'closed') assert.equal(result.read.denied?.code, 'E_CLOSED');
      else assert.deepEqual(result.read, { loading: true });
    }
    assert.equal(f.cache.size, 0);
  });
}

for (const kind of ['rows', 'components', 'lost retention', 'withheld']) {
  test(`known retained composition at an ahead cut: ${kind}`, async () => {
    const f = fixture();
    if (kind === 'rows') {
      f.first = f.second = { ...partial, retainedRows: [{ source: ['messages', 'held'], retained: true, fields: {} }] };
      f.reply = { data: ['new'], seq: 5, rowProvenance: [{ source: ['messages', 'new'], retained: false, fields: {} }] };
    } else {
      f.first = f.second = { data: { left: ['held'], right: ['partial'] }, unknown: true,
        components: { left: { retained: true, complete: true }, right: { unknown: true } } };
      f.reply.data = { left: [], right: ['new'] };
      if (kind === 'lost retention') f.second = partial;
      if (kind === 'withheld') f.second = { loading: true, unknown: true };
    }
    const result = await f.run();
    if (kind === 'withheld') assert.deepEqual(result.read, { loading: true });
    else {
      assert.deepEqual(result.read.data, kind === 'rows' ? ['new', 'held'] : kind === 'components' ? { left: ['held'], right: ['new'] } : ['held']);
      assert.equal(result.read.fresh, false);
      assert.equal(result.read.complete, kind === 'components');
    }
    assert.deepEqual(f.calls, ['query', 'query', ...(['lost retention', 'withheld'].includes(kind) ? ['state'] : [])]);
    assert.equal(f.cache.size, 0);
  });
}

for (const changed of [false, true]) {
  test(`a rejected watermark read withholds publication (authority changed: ${changed})`, async () => {
    const f = fixture();
    f.state = async () => { if (changed) f.env.authority++; throw new Error('state unavailable'); };
    if (changed) assert.deepEqual((await f.run()).read, { loading: true });
    else await assert.rejects(f.run(), /state unavailable/);
    assert.equal(f.cache.size, 0);
  });
}

for (const localData of [[], ['held']]) {
  test(`ahead positive server page stays useful and provisional (local rows: ${localData.length})`, async () => {
    const f = fixture(); f.first = { ...partial, data: localData };
    f.reply = { data: ['new'], complete: true, seq: 5, nextExpiry: 100, decorationExpiry: 80 };
    const result = await f.run();
    assert.deepEqual(result.read.data, ['new']);
    assert.equal(result.read.complete, false); assert.equal(result.read.fresh, false);
    assert.equal(result.serverExpiry, 100); assert.equal(result.valueServer, 80);
    assert.equal(result.serverOnly, false); assert.equal(result.served, true);
    assert.equal(result.delivery, undefined); assert.equal(f.cache.size, 0);
  });
}

test('structured empty siblings cannot replace pending local history', async () => {
  const f = fixture(); f.first = { ...partial, data: { history: ['held'], count: 1 } };
  f.reply.data = { history: [], count: 0 };
  const result = await f.run();
  assert.deepEqual(result.read.data, f.first.data);
  assert.equal(result.read.complete, false); assert.equal(result.read.fresh, false);
});
