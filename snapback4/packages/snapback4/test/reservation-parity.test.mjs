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
const cases = JSON.parse(readFileSync(new URL('rp-reservation-cases.json', root), 'utf8'));
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
  for (const table of Object.values(legacy.schema.tables)) for (const c of table.constraints) {
    if (c.Capabilities) c.Capabilities = c.Capabilities.filter(name => !['receipt-derived-prediction-v1', 'source-write-reservations-v1'].includes(name));
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
