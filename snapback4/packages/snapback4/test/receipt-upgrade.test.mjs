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

const freshSource = () => fixture('schema.q').split('view unreadCounts:')[0];
const backendFor = async (t, source) => {
  const { url } = await server(t, undefined, source);
  return fetch(`${url}/schema`, { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json());
};
const admitted = (backend, op = 'send') => {
  const device = new WebDevice(JSON.stringify(backend), fixture('memory.json'));
  try {
    const [old] = call(device, { op: 'queued' });
    const entry = { ...old, op, id: 'rp-round2', seq: 8, predictable: true, predicted: [], new_ids: [],
      args: op === 'send' ? old.args : { conversation: 'c' } };
    const q = call(device, { op: 'admit', entry });
    const history = call(device, { op: 'query', name: 'history', viewer: 'alice', args: { conversation: 'c', c: null }, now });
    assert.equal(history.data.filter(row => row.pending).length, q.predictable ? 1 : 0);
    assert.equal(call(device, { op: 'queued' }).length, 2, 'refusal retains the outbox');
    return q;
  } finally { device.free(); }
};

test('wasm retains fixed reservations for online-only receipt views', { timeout: hangBudget(20) }, async t => {
  for (const count of [1, 6]) {
    let source = freshSource() + '\ntable watchers:\n  conversation: conversations\n  cap 50 by conversation\n  read <- exists members[.conversation, viewer]\n';
    for (let n = 0; n < count; n++) source += `\nview online${n}: count messages by watchers w where .conversation = w.conversation and .ordinal > 0\n`;
    const backend = await backendFor(t, source);
    assert.equal(backend.schema.operations.send.predicts, 'eligible');
    const q = admitted(backend);
    assert.equal(q.predictable, count === 1, JSON.stringify(q));
    assert.equal(q.predicted.length, count === 1 ? 1 : 0);
  }
});

test('wasm charges declared null image and video list slots, including bursts', { timeout: hangBudget(30) }, async t => {
  for (const [kind, slots, mode, good] of [['image',480,'row',false], ['video',480,'row',false],
    ['image',32,'ordinary',false], ['image',32,'public',false], ['video',32,'private',false],
    ['image',480,'single',true], ['image',512,'single',false]]) {
    let source = (mode === 'row' ? fixture('schema.q') : freshSource()).replace('  text: text <=2000', `  shots: [${kind} <=1000] <=${slots} ?\n  text: text <=2000`);
    if (mode === 'public') source += '\nview totals: count messages where .recipients >= 0 by .conversation\n';
    if (mode === 'private') {
      source = source.replace('  text: text <=2000', '  shelf: shelves ?\n  text: text <=2000');
      source += '\ntable shelves:\n  total: count messages where .recipients >= 0 by .shelf\n  public\n  sync public\n';
    }
    source += "\nmutation burst(conversation: conversations):\n  for n in range(0, 16):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, shots: null, at: now }\n";
    const backend = await backendFor(t, source);
    const q = admitted(backend, ['row','single'].includes(mode) ? 'send' : 'burst');
    assert.equal(q.predictable, good, `${kind}/${slots}/${mode}: ${JSON.stringify(q)}`);
    assert.equal(q.predicted.length, good ? 1 : 0);
  }
});

test('wasm stripped current projections cannot use the legacy waiver to predict', { timeout: hangBudget(10) }, async t => {
  let source = freshSource().replace('  text: text <=2000', '  shelf: shelves ?\n  text: text <=2000') + '\ntable shelves:\n';
  for (let n = 0; n < 10; n++) source += `  total${n}: count messages where .recipients >= -${n} by .shelf\n`;
  source += "  public\n  sync public\nmutation burst(conversation: conversations):\n  for n in range(0, 30):\n    insert messages { conversation, sender: viewer, text: 'burst', photo: null, at: now }\n";
  const original = await backendFor(t, source);
  assert.equal(original.schema.operations.burst.predicts, 'eligible');
  for (const [stamp, prices] of [[false,false], [false,true], [true,false]]) {
    const backend = structuredClone(original);
    if (!prices) delete backend.schema.receipt_column_costs;
    if (!stamp) for (const table of Object.values(backend.schema.tables)) for (const c of table.constraints) {
      if (c.Capabilities) c.Capabilities = c.Capabilities.filter(name => name !== 'receipt-derived-prediction-v1');
    }
    // Even a small send must queue: the decoder did not merely retain the burst's price.
    assert.equal(admitted(backend).predictable, false, `${stamp}/${prices}`);
    const burst = admitted(backend, 'burst');
    assert.equal(burst.predictable, false);
    assert.deepEqual(burst.predicted, []);
  }
  assert.equal(admitted(original).predictable, true);
});
