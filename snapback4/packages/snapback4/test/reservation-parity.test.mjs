// Shared with the Rust seeded differential. Its fixture is regenerated against
// the server engine in reservation_wasm_corpus_matches_engine on every suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';
import { server } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
import { openLocalDevice } from '../dist/local-backend.js';
import { memoryPersistence, webDevice } from '../dist/web.js';

const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
initSync({ module: wasm });
const root = new URL('../../../crates/snapback4-lang/tests/fixtures/', import.meta.url);
const cases = ['rp-reservation-cases.json', 'rp-runtime-reservation-cases.json'].flatMap(name => JSON.parse(readFileSync(new URL(name, root), 'utf8')));
const now = 4_000_000_000_000;
const entry = (op, args, seq = 1) => ({ id: `rp-r3-${seq}`, seq, op, args, viewer: 'alice', now, new_ids: [], predicted: [], predictable: true });
const call = (device, request) => JSON.parse(device.call(JSON.stringify(request)));
const ok = answer => { assert.ok(!answer.denied, JSON.stringify(answer)); return answer.ok; };
const backendFor = async (t, source) => {
  const { url } = await server(t, undefined, source);
  return fetch(`${url}/schema`, { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json());
};

for (const c of cases) test(`wasm reservation parity: ${c.label}`, { timeout: hangBudget(10) }, async t => {
  const backend = await backendFor(t, c.source);
  const device = new WebDevice(JSON.stringify(backend), '[]');
  try {
    c.pages.forEach((page, i) => ok(call(device, { op: 'apply', first: i === 0, page })));
    const result = call(device, { op: 'admit', entry: entry('burst', c.args) });
    assert.equal(Boolean(result.denied), c.denied, JSON.stringify(result));
    const predicted = Boolean(result.ok?.predictable);
    assert.equal(predicted, c.predicted, JSON.stringify(result));
    assert.ok(!predicted || c.serverCommitted, 'a predicted write passes server resource admission');
    if (c.mustQueue) {
      assert.equal(predicted, false);
      assert.deepEqual(ok(result).predicted, []);
      assert.equal(ok(call(device, { op: 'queued' })).length, 1);
      const receipt = Object.hasOwn(c.args, 'conversation');
      const rows = ok(call(device, { op: 'query', name: receipt ? 'history' : 'rows', viewer: 'alice',
        args: receipt ? { conversation: 'c', c: null } : {}, now }));
      assert.deepEqual(rows.data, [], 'a refused burst leaves no provisional history');
    }
  } finally { device.free(); }
});

test('SDK Kept opening preserves unrelated offline predictions in an unstamped receipt backend', { timeout: hangBudget(10) }, async t => {
  const source = readFileSync(new URL('rp-predecessor/schema.q', root), 'utf8') + `
table ordinary:
  body: text <=20
  public
  insert <- allow
  sync public
mutation post():
  insert ordinary { body: 'post' }
mutation title(conversation: conversations):
  update conversations[conversation] { title: 'offline title' }
`;
  const current = await backendFor(t, source);
  const legacy = structuredClone(current);
  delete legacy.schema.source_reservations;
  assert.ok(Object.values(legacy.schema.tables).every(table => Object.keys(table.maintained ?? {}).length === 0), 'the app-wide absence of private owners permits the zero proof for unrelated writers');
  for (const table of Object.values(legacy.schema.tables)) for (const c of table.constraints) {
    if (c.Capabilities) c.Capabilities = c.Capabilities.filter(name => !['receipt-derived-prediction-v1', 'source-write-reservations-v1', 'source-write-reservations-v2'].includes(name));
  }
  const kept = JSON.parse(readFileSync(new URL('rp-predecessor/memory.json', root), 'utf8'));
  kept.push({ s: 'm', k: 'device:backend', v: JSON.stringify(legacy) });
  const persist = memoryPersistence();
  await persist.save('rp-kept', kept);
  const opener = webDevice({ wasm, persist });
  // The actual SDK helper must open the kept backend first even with the new
  // app backend supplied. No network/adoption is needed for unrelated writes.
  const core = await openLocalDevice(opener, 'rp-kept', current);
  try {
    for (const [op, args, seq] of [['post', {}, 8], ['title', { conversation: 'c' }, 9]]) {
      const q = ok(await core.call({ op: 'admit', entry: entry(op, args, seq) }));
      assert.equal(q.predictable, true, JSON.stringify(q));
    }
    const q = ok(await core.call({ op: 'admit', entry: entry('send', { conversation: 'c', text: 'queued' }, 10) }));
    assert.equal(q.predictable, false);
    assert.deepEqual(q.predicted, []);
    const history = ok(await core.call({ op: 'query', name: 'history', viewer: 'alice', args: { conversation: 'c', c: null }, now }));
    assert.equal(history.data.filter(row => row.pending).length, 0);
    assert.equal(ok(await core.call({ op: 'queued' })).length, 4);
  } finally { await core.close(); }
});

test('wasm predicts new explicit-zero and old provably-zero source prices', { timeout: hangBudget(10) }, async t => {
  const backend = await backendFor(t, `table items:
  body: text <=20
  public
  insert <- allow
  sync public
mutation post():
  insert items { body: 'offline' }
`);
  const plan = backend.schema.source_reservations.items;
  assert.deepEqual(plan.prices, Array.from({ length: 8 }, () => Array(7).fill(0)));
  assert.deepEqual(plan.birth, Array(7).fill(0));
  for (const legacy of [false, true]) {
    const b = structuredClone(backend);
    if (legacy) {
      delete b.schema.source_reservations;
      for (const table of Object.values(b.schema.tables)) table.constraints = table.constraints.filter(c => !c.Capabilities);
    }
    const device = new WebDevice(JSON.stringify(b), '[]');
    try {
      ok(call(device, { op: 'apply', first: true, page: { snapshot: true, generation: b.generation, events: [], watermark: 0, more: false } }));
      const q = ok(call(device, { op: 'admit', entry: entry('post', {}) }));
      assert.equal(q.predictable, true, JSON.stringify(q));
      assert.equal(q.predicted.length, 1);
    } finally { device.free(); }
  }
});

// A kept compiler may have proved the slice before payload prices existed.
test('wasm keeps small omitted effects eligible without obsolete payload prices', { timeout: hangBudget(10) }, async t => {
  const c = cases.find(c => c.label === 'r4-hidden-payload-1');
  const backend = await backendFor(t, c.source);
  delete backend.schema.operations.burst.effect_reservations;
  const device = new WebDevice(JSON.stringify(backend), '[]');
  try {
    c.pages.forEach((page, i) => ok(call(device, { op: 'apply', first: i === 0, page })));
    const q = ok(call(device, { op: 'admit', entry: entry('burst', {}) }));
    assert.equal(q.predictable, true);
    assert.equal(q.predicted.length, 1);
    assert.equal(ok(call(device, { op: 'queued' })).length, 1);
    assert.equal(ok(call(device, { op: 'query', name: 'rows', args: {}, viewer: 'alice', now })).data.length, 1);
  } finally { device.free(); }
});

// Explicit actual-value exception, re-executed by the Rust engine in the suite.
// issues/20261004-snapback4-omitted-effect-payload-resource-gap.md
// This counterexample is separate from the passing reservation differential.
test('wasm reproduces the documented pathological payload gap', { timeout: hangBudget(10) }, async t => {
  const c = JSON.parse(readFileSync(new URL('rp-effect-payload-gap.json', root), 'utf8'));
  assert.equal(c.serverCommitted, false);
  assert.equal(c.predicted, true);
  const backend = await backendFor(t, c.source);
  const device = new WebDevice(JSON.stringify(backend), '[]');
  try {
    c.pages.forEach((page, i) => ok(call(device, { op: 'apply', first: i === 0, page })));
    const q = ok(call(device, { op: 'admit', entry: entry('burst', c.args) }));
    assert.equal(q.predictable, true);
    assert.equal(q.predicted.length, 1);
  } finally { device.free(); }
});

test('receipt payload exception keeps custody until terminal refusal, then rolls back across restart', { timeout: hangBudget(10) }, async t => {
  const c = JSON.parse(readFileSync(new URL('rp-receipt-payload-gap.json', root), 'utf8'));
  assert.equal(c.serverCommitted, false);
  assert.equal(c.predicted, true);
  assert.match(JSON.stringify(c.state), /E_BOUND/);
  assert.equal(c.meter.steps, 1_000_680);
  const backend = await backendFor(t, c.source);
  let device = new WebDevice(JSON.stringify(backend), '[]');
  let kept = [];
  const reopen = () => {
    kept.push(...JSON.parse(device.drain()));
    device.free();
    device = new WebDevice(undefined, JSON.stringify(kept));
  };
  const history = () => ok(call(device, { op: 'query', name: 'history', args: { conversation: 'c', c: null }, viewer: 'alice', now })).data;
  try {
    c.pages.forEach((page, i) => ok(call(device, { op: 'apply', first: i === 0, page })));
    const q = ok(call(device, { op: 'admit', entry: entry('sendGap', c.args) }));
    assert.equal(q.predictable, true);
    assert.equal(q.predicted.length, 1);
    assert.equal(history().filter(row => row.pending).length, 1);
    reopen();
    assert.equal(ok(call(device, { op: 'queued' }))[0].id, q.id);
    assert.equal(history().filter(row => row.pending).length, 1);
    // Rust re-executes this exact source on the server, verifies the durable
    // terminal refusal (including replay), and exports this refusal oracle.
    ok(call(device, { op: 'settle', id: q.id }));
    assert.deepEqual(ok(call(device, { op: 'queued' })), []);
    assert.deepEqual(history(), []);
    const count = ok(call(device, { op: 'query', name: 'badge', args: { member: 'b' }, viewer: 'alice', now }));
    assert.equal(count.data, 0);
    assert.equal(count.complete, true);
    reopen();
    assert.deepEqual(ok(call(device, { op: 'queued' })), []);
    assert.deepEqual(history(), []);
  } finally { device.free(); }
});
