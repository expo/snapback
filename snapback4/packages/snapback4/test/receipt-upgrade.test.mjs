import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';
import { server } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';

initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const fixture = name => readFileSync(new URL(`../../../crates/snapback4-lang/tests/fixtures/rp-predecessor/${name}`, import.meta.url), 'utf8');
const now = 4_000_000_000_000;
const call = (device, request) => {
  const answer = JSON.parse(device.call(JSON.stringify(request)));
  assert.ok(!answer.denied, JSON.stringify(answer));
  return answer.ok;
};
const owed = device => {
  const debt = call(device, { op: 'delivery', action: 'read', viewer: 'alice', now });
  return Object.values(JSON.parse(debt.value).groups)[0].owed;
};

// These persisted changes were emitted by the a8c20c40e9 memory device, with
// its real old backend, outbox and delivery debt. No capability editing.
test('wasm opens real predecessor stores through every opening mode and keeps custody on adoption', { timeout: hangBudget(10) }, async t => {
  const { url } = await server(t, undefined, fixture('schema.q'));
  const backend = await fetch(`${url}/schema`, { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json());
  assert.match(JSON.stringify(backend), /receipt-derived-prediction-v1/);
  assert.doesNotMatch(fixture('backend.json'), /receipt-derived-prediction-v1/);
  for (const opening of [undefined, JSON.stringify({ initial_backend: backend }), JSON.stringify(backend)]) {
    const kept = fixture('memory.json');
    const device = new WebDevice(opening, kept);
    try {
      const original = call(device, { op: 'queued' });
      assert.equal(original.length, 1);
      assert.equal(original[0].predictable, false);
      assert.deepEqual(owed(device), [[1, 1]]);
      call(device, { op: 'adopt', backend });
      assert.deepEqual(call(device, { op: 'queued' }), original);
      assert.deepEqual(owed(device), [[1, 1]]);
      const next = call(device, { op: 'admit', entry: { ...original[0], id: 'wasm-rp-new', seq: 8, predictable: true, new_ids: [], predicted: [] } });
      assert.equal(next.predictable, true, JSON.stringify(next));
      const badge = call(device, { op: 'query', name: 'badge', viewer: 'alice', args: { member: 'b' }, now });
      assert.equal(badge.data, 1);
      assert.equal(badge.complete, false);
      const history = call(device, { op: 'query', name: 'history', viewer: 'alice', args: { conversation: 'c', c: null }, now });
      assert.equal(history.data.filter(row => row.pending === true).length, 1);
      assert.deepEqual(owed(device), [[1, 1]], 'a provisional message adds no delivery debt');
      const reopened = new WebDevice(undefined, JSON.stringify([...JSON.parse(kept), ...JSON.parse(device.drain())]));
      try {
        assert.equal(call(reopened, { op: 'queued' }).length, 2);
        assert.deepEqual(owed(reopened), [[1, 1]]);
      } finally { reopened.free(); }
    } finally { device.free(); }
  }
});

test('wasm charges projected private receipt column reservations before a burst', { timeout: hangBudget(10) }, async t => {
  // Remove the public row view so it cannot mask missing private-column work.
  let source = fixture('schema.q').split('view unreadCounts:')[0].replace('  text: text <=2000', '  shelf: shelves ?\n  text: text <=2000');
  source += '\ntable shelves:\n';
  for (let n = 0; n < 10; n++) source += `  total${n}: count messages where .recipients >= -${n} by .shelf\n`;
  source += `  public
  sync public
mutation burst(conversation: conversations):
  for n in range(0, 30):
    insert messages { conversation, shelf: 's', sender: viewer, text: 'burst', photo: null, at: now }
`;
  const { url } = await server(t, undefined, source);
  const backend = await fetch(`${url}/schema`, { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json());
  assert.equal(backend.schema.receipt_column_costs.messages[3], 40);
  assert.ok(backend.schema.maintains.every(m => !m.private));
  const device = new WebDevice(JSON.stringify(backend), fixture('memory.json'));
  try {
    const [old] = call(device, { op: 'queued' });
    const single = call(device, { op: 'admit', entry: { ...old, id: 'private-single', seq: 8, predictable: true, predicted: [], new_ids: [] } });
    assert.equal(single.predictable, true, JSON.stringify(single));
    const burst = call(device, { op: 'admit', entry: { ...old, op: 'burst', args: { conversation: 'c' }, id: 'private-burst', seq: 9, predictable: true, predicted: [], new_ids: [] } });
    assert.equal(burst.predictable, false);
    assert.deepEqual(burst.predicted, []);
    assert.equal(call(device, { op: 'queued' }).length, 3);
  } finally { device.free(); }
});
