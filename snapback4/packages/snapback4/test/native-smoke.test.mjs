import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSmoke } from '../../snapback4-expo/src/smoke.ts';

const prime = { origin: 'http://127.0.0.1:4400', viewer: 'dev:alice', rows: { messages: 3, empty: 0 },
  acquired: true, backendRequired: false, watermark: 7, generation: 1, storeId: 'store-one' };
function fixture(segment, options = {}) {
  const lines = [], calls = [], reads = [];
  let clock = 0, handler = () => {}, forwarded = 0;
  handler = () => { forwarded++; };
  const previous = handler;
  const state = { ...prime, watermark: segment === 'restart' ? 8 : 7, ...options.state };
  const client = { viewer: () => prime.viewer, link: () => segment === 'offline' ? 'offline' : 'online', acquired: true,
    query: async (op, args) => { reads.push([op, args]); if (options.query) return options.query(op, args);
      return { data: [{ body: 'PRIVATE ROW CONTENT' }], complete: true, fresh: false, cut: null }; } };
  const device = { call: async req => {
    calls.push(req);
    if (req.op === 'witness_state') return { ok: state };
    if (req.op === 'backend') return { ok: { programs: [
      { name: 'inbox', kind: 'Query', args: {} },
      { name: 'page', kind: 'Query', args: { c: { Optional: 'Cursor' }, filter: { Optional: { Text: { max: 100 } } } } },
      { name: 'required', kind: 'Query', args: { id: 'Id', c: { Optional: 'Cursor' } } },
      { name: 'write', kind: 'Mutation', args: {} }, { name: 'job', kind: 'job', args: {} },
    ], schema: { operations: { page: { held: true, runs: 'device' } } } } };
    throw Error('unexpected device call ' + req.op);
  } };
  const runner = createSmoke({ witnessLaunch: JSON.stringify({ smoke: true, segment, timeoutMs: 500, baseline: prime }),
    witnessAppend: line => lines.push(JSON.parse(line)), witnessSignaled: () => false }, {
    errors: { getGlobalHandler: () => handler, setGlobalHandler: value => { handler = value; } },
    now: () => clock, pause: async () => { clock += 100; options.pause?.(client, state); },
  });
  return { runner, client, device, state, lines, calls, reads, previous, handler: () => handler,
    forwarded: () => forwarded, run: () => runner.run(client, device, prime.origin) };
}
test('ordinary and application witness launches never install the smoke runner', () => {
  assert.equal(createSmoke({ witnessLaunch: null }), null);
  assert.equal(createSmoke({ witnessLaunch: JSON.stringify({ segment: 'offline' }) }), null);
});
test('prime waits for acquisition and records device counts, identity and link, without rows', async () => {
  const f = fixture('prime', { state: { acquired: false }, pause: (_, state) => { state.acquired = true; } });
  await f.run();
  assert.equal(f.lines.at(-1).witness.step, 'primed');
  assert.deepEqual(f.lines[0].smoke.rows, prime.rows);
  assert.equal(f.lines[0].smoke.storeId, prime.storeId);
  assert.equal(f.reads.length, 0);
  assert.ok(f.calls.every(c => c.op === 'witness_state'));
});
test('offline calls precisely all optional-argument queries on the own client and records counts only', async () => {
  const f = fixture('offline'); await f.run();
  assert.deepEqual(f.reads.map(([op]) => op.name), ['inbox', 'page']);
  assert.deepEqual(f.reads[1], [{ kind: 'query', name: 'page', held: true, runs: 'device' }, {}]);
  assert.deepEqual(f.lines[0].smoke.queries.map(q => [q.state, q.count]), [['ready', 1], ['ready', 1]]);
  assert.equal(JSON.stringify(f.lines).includes('PRIVATE ROW CONTENT'), false);
  assert.equal(f.lines.at(-1).witness.step, 'offline-done');
  assert.ok(f.calls.every(c => ['witness_state', 'backend'].includes(c.op)));
});
test('explained refusals are results; loading and crashes are failures with receipts', async () => {
  const refusal = fixture('offline', { query: () => ({ denied: { code: 'E_OFFLINE', message: 'requires the server' } }) });
  await refusal.run(); assert.equal(refusal.lines[0].smoke.queries[0].state, 'refused');
  for (const query of [() => ({ loading: true }), () => { throw Error('broken device query'); }]) {
    const f = fixture('offline', { query }); await assert.rejects(f.run());
    assert.equal(f.lines[0].smoke.pass, false); assert.equal(f.lines.at(-1).witness.step, 'offline-done:failed');
  }
});
test('lost persisted rows, changed backend identity and stale restart watermarks fail', async () => {
  for (const [segment, state, reason] of [
    ['offline', { rows: { messages: 2, empty: 0 } }, /counts/],
    ['offline', { storeId: 'other-store' }, /identity/],
    ['restart', { watermark: 7 }, /watermark/],
  ]) {
    const f = fixture(segment, { state }); await assert.rejects(f.run(), reason);
    assert.equal(f.lines[0].smoke.pass, false);
  }
  const f = fixture('restart'); await f.run(); assert.equal(f.lines[0].smoke.watermark, 8);
});
test('uncaught errors before attachment and after completion persist before forwarding the original handler', async () => {
  const early = fixture('offline'); early.handler()(Error('deliberate offline start throw'), true);
  assert.equal(early.lines[0].witness.step, 'smoke:failed'); assert.equal(early.forwarded(), 1);
  await assert.rejects(early.run(), /uncaught/);
  const late = fixture('prime'); await late.run(); late.handler()(Error('late crash'), true);
  assert.equal(late.lines.at(-1).smoke.errors[0].message, 'late crash');
  late.runner.dispose(); assert.equal(late.handler(), late.previous);
});
