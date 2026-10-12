// Fixtures are compiled and compared to authorized snapshots by the device suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/word-expansion.json', import.meta.url)));
function wordsScan(program) {
  const scans = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.Scan?.prefix.some(key => 'WordPrefix' in key)) scans.push(value.Scan);
    for (const child of Object.values(value)) visit(child);
  }
  visit(program);
  assert.equal(scans.length, 1, 'the budget prelude copies the search alternative');
  return scans[0];
}
function open(key) {
  const { backend, pages } = fixtures[key];
  const device = new WebDevice(JSON.stringify(backend), '[]');
  for (const [i, page] of pages.entries()) {
    const reply = JSON.parse(device.call(JSON.stringify({ op: 'apply', page, first: i === 0 })));
    assert.ok('ok' in reply, JSON.stringify(reply));
  }
  return device;
}
const query = (device, name = 'search', c = null) => device.call(JSON.stringify({ op: 'query', name, viewer: 'dev:alice', args: { q: 'kx', c }, now: 100_000 }));
function walk(device, name = 'search', requireNext = false) {
  let cursor = null;
  const ids = [], replies = [], sizes = [];
  do {
    const text = query(device, name, cursor);
    const { ok } = JSON.parse(text);
    assert.ok(Array.isArray(ok?.data), text);
    if (name !== 'nonuniform') { assert.equal(ok.complete, true); assert.equal(ok.cut, null); }
    if (requireNext && ok.data.length === 20) assert.ok(ok.next, text);
    replies.push(text);
    sizes.push(ok.data.length);
    ids.push(...ok.data.map(row => row.id));
    cursor = ok.next;
    assert.ok(replies.length < 1000);
  } while (cursor);
  return { ids, replies, sizes };
}
for (const n of [0, 1, 31, 32, 33, 45, 200, 1000]) test(`wasm uniform search walks ${n} distinct words`, () => {
  const device = open(`${n}-0`);
  try {
    const result = walk(device, 'search', n === 45);
    assert.deepEqual(result.ids, Array.from({ length: n }, (_, i) => `room-${String(n - 1 - i).padStart(5, '0')}`));
    if (n === 45) assert.deepEqual(result.sizes, [20, 20, 5]);
    if (n >= 200) assert.equal(result.replies.length, n / 20);
  } finally { device.free(); }
});
test('wasm admitted non-uniform scope retains the 32-word cut', () => {
  const device = open('45-0');
  try {
    const { ok } = JSON.parse(query(device, 'nonuniform'));
    assert.equal(ok.complete, false);
    assert.equal(ok.cut, 'words');
    assert.ok(!ok.next);
    assert.equal(ok.data.length, 20);
  } finally { device.free(); }
});
for (const expired of [false, true]) test(`wasm ${expired ? 'expired sub-pair (i), both traversals fit' : 'denied scope after legitimate acquisition'} worlds have byte-identical replies`, () => {
  const worlds = [];
  for (const key of expired ? ['expired-false', 'expired-true'] : ['45-0', '45-9000']) {
    const device = open(key);
    try { worlds.push((expired ? ['search', 'pair'] : ['search', 'pair', 'nonuniform']).flatMap(name => walk(device, name).replies)); }
    finally { device.free(); }
  }
  assert.deepEqual(worlds[0], worlds[1]);
  assert.equal(worlds[0].length, expired ? 6 : 7);
});

// The production wasm boundary has no ceiling override. Spend all but the
// requested allowance in an ordinary IR prelude, then exercise the same
// discovery/opening/heap phases without changing defaults or the boundary.
for (const phase of ['index', 'examined', 'heap']) test(`wasm ${phase} budget exhaustion is false/meter/no-next`, () => {
  const fixture = structuredClone(fixtures['45-0']);
  const program = fixture.backend.programs.find(p => p.name === 'search');
  const scan = wordsScan(program);
  const constant = value => ({ Const: { name: 'budget', value } });
  if (phase === 'heap') {
    // Literal cloning and the binding each charge the body; args cost two
    // bytes. That leaves 10,000 of the unchanged 16 MiB heap allowance.
    program.body.unshift(constant({ Literal: { String: 'x'.repeat(((16 << 20) - 10_002) / 2) } }));
  } else {
    const value = phase === 'index' ? { Scan: { ...structuredClone(scan), site: 'budget.empty', opaque_cursor: false,
      after: null, index: 'byWords', prefix: [{ WordPrefix: { Literal: { String: 'absent' } } }] } }
      : { Get: { site: 'budget.point', table: 'members', index: 'byId', key: [{ Literal: { Id: 'member' } }], provenance: 'Const' } };
    program.body.unshift({ For: { binding: 'i', domain: { LiteralRange: { start: 0, end_exclusive: phase === 'index' ? 16_384 - 32 : 8192 - 10 } }, body: [constant(value)] } });
  }
  const device = new WebDevice(JSON.stringify(fixture.backend), '[]');
  try {
    for (const [i, page] of fixture.pages.entries()) assert.ok('ok' in JSON.parse(device.call(JSON.stringify({ op: 'apply', page, first: i === 0 }))));
    const { ok } = JSON.parse(query(device));
    assert.equal(ok.complete, false);
    assert.equal(ok.cut, 'meter');
    assert.ok(!ok.next);
    if (phase === 'heap') {
      assert.equal(ok.loading, true);
      assert.ok(!('data' in ok), 'an aborted page has no ready null placeholder');
    }
    else assert.equal(ok.data.length, phase === 'examined' ? 10 : 0);
  } finally { device.free(); }
});

// @ref LLP 3000.007#20.24.6 — a word held only by an expired row is store work, so the worlds agree.
test('wasm expired sub-pair (ii), meter boundary no longer carries the time-hidden work bit', () => {
  const worlds = [];
  for (const key of ['expired-false', 'expired-true']) {
    const fixture = structuredClone(fixtures[key]);
    const program = fixture.backend.programs.find(p => p.name === 'search');
    const scan = wordsScan(program);
    // Private discovery prepays 33 word seeks. Fill the remainder with
    // three uniform misses to leave exactly 46 seeks for the expired pair.
    program.body.unshift({ For: { binding: 'i', domain: { LiteralRange: { start: 0, end_exclusive: Math.floor((16_384 - 46) / 33) } }, body: [
      { Const: { name: 'budget', value: { Scan: { ...structuredClone(scan), site: 'budget.empty', index: 'byWords', opaque_cursor: false,
        after: null, prefix: [{ WordPrefix: { Literal: { String: 'absent' } } }] } } } }
    ] } });
    program.body.splice(1, 0, { For: { binding: 'j', domain: { LiteralRange: { start: 0, end_exclusive: (16_384 - 46) % 33 } }, body: [
      { Const: { name: 'remainder', value: { Scan: { ...structuredClone(scan), site: 'budget.remainder', opaque_cursor: false, after: null,
        prefix: [structuredClone(scan.prefix[0]), { WordPrefix: { Literal: { String: 'absent' } } }] } } } }
    ] } });
    const device = new WebDevice(JSON.stringify(fixture.backend), '[]');
    try {
      // Acquire at zero while the extra row is live, then advance only query time.
      for (const [i, page] of fixture.pages.entries()) assert.ok('ok' in JSON.parse(device.call(JSON.stringify({ op: 'apply', page, first: i === 0 }))));
      worlds.push(JSON.parse(query(device)).ok);
    } finally { device.free(); }
  }
  const [a, b] = worlds;
  assert.equal(a.complete, true); assert.equal(a.cut, null); assert.ok(a.next);
  assert.equal(a.data.length, 20);
  assert.deepEqual(b, a);
});

test('wasm hidden-only words cannot change an admitted non-uniform page or cut', () => {
  const worlds = [];
  for (const population of [0, 33]) {
    const { backend, rows } = fixtures[`round3-${population}`];
    const kept = rows.map(({ table, id, data }) => ({ s: 'r', k: JSON.stringify([table, id]), v: JSON.stringify(data) }));
    const device = new WebDevice(JSON.stringify(backend), JSON.stringify(kept));
    try { worlds.push(JSON.parse(device.call(JSON.stringify({ op: 'query', name: 'matching', viewer: 'dev:alice', args: {}, now: 100_000 }))).ok); }
    finally { device.free(); }
  }
  const [a, b] = worlds;
  assert.deepEqual(a.data.map(r => r.id), ['shown']);
  assert.deepEqual([b.data, b.complete, b.next], [a.data, a.complete, a.next]);
  assert.equal(a.complete, false); assert.ok(!a.next);
  assert.equal(a.cut, null);
  assert.deepEqual(b, a);
});

test('wasm admitted non-uniform pair through legitimate acquisition has identical full envelopes', () => {
  const worlds = [];
  for (const population of [0, 33]) {
    const device = open(`round3-${population}`);
    try {
      const text = device.call(JSON.stringify({ op: 'query', name: 'matching', viewer: 'dev:alice', args: {}, now: 100_000 }));
      assert.deepEqual(JSON.parse(text).ok.data, [], 'online-only candidates are never acquired');
      worlds.push(text);
    } finally { device.free(); }
  }
  assert.equal(worlds[0], worlds[1]);
});
