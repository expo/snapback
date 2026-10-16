import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

initSync({ module: readFileSync(process.env.SNAPBACK4_DIET_WASM ?? new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const literal = value => ({ Literal: value });
const scan = { site: 'unbound', table: 'missing', index: 'byId', prefix: [], order: 'Asc', take: { Literal: 1 }, provenance: 'Const' };
const program = (name, body, args = {}) => ({ name, kind: 'Query', body, args });
function call(programs, name, args = {}) {
  const device = new WebDevice(JSON.stringify({ generation: 1, schema: { tables: {} }, programs }), '[]');
  try { return JSON.parse(device.call(JSON.stringify({ op: 'query', name, viewer: 'A', args, now: 1 }))); }
  finally { device.free(); }
}

test('web trusts structural admission of its backend but still validates arguments and executed reads', () => {
  const body = [{ If: { condition: literal({ Bool: false }), then_body: [{ Return: { Scan: scan } }], else_body: [] } }, { Return: literal({ Int: 7 }) }];
  const programs = [program('trusted', body, { count: 'Int' }), program('executed', [{ Return: { Scan: scan } }])];
  const good = call(programs, 'trusted', { count: 1 });
  assert.equal(good.ok?.data, 7, JSON.stringify(good));
  assert.equal(good.ok.complete, true);
  assert.equal(call(programs, 'trusted', { count: 'bad' }).ok?.denied?.code, 'E_INPUT');
  const executed = call(programs, 'executed');
  assert.ok(executed.ok?.denied, JSON.stringify(executed));
});

test('wasm field-authority refusals carry the owner-specific repair and rules guide', () => {
  for (const owner of ['owner', 'recipient']) {
    const table = {
      columns: { id: 'Id', [owner]: 'Principal', secret: 'Int' },
      defaults: { secret: { Literal: { Int: 0 } } },
      written_by: { secret: { owner } },
      indexes: { byId: { components: [{ Column: 'id' }], unique: true } },
      rules: { read: 'Allow', insert: 'Allow', update: 'Deny', delete: 'Deny' },
      sync: { audience: 'Public' },
      constraints: [{ Capabilities: ['field-authority'] }],
    };
    const mutation = { name: 'patch', kind: 'Mutation', args: {}, body: [
      { Update: { table: 'records', key: literal({ Id: 'row' }), patch: literal({ Row: { secret: { Int: 7 } } }) } },
    ] };
    const device = new WebDevice(JSON.stringify({ generation: 1, schema: { tables: { records: table } }, programs: [mutation] }), '[]');
    const request = value => JSON.parse(device.call(JSON.stringify(value)));
    try {
      const applied = request({ op: 'apply', first: true, page: { snapshot: true, events: [
        { table: 'records', kind: 'put', id: 'row', data: { id: 'row', [owner]: 'bob' } },
      ], watermark: 1, more: false, generation: 1 } });
      assert.ok('ok' in applied, JSON.stringify(applied));
      const reply = request({ op: 'predict', name: 'patch', viewer: 'alice', args: {}, now: 1 });
      const refusal = reply.ok?.denied;
      assert.equal(refusal?.code, 'E_FIELD_AUTHORITY', JSON.stringify(reply));
      assert.equal(refusal.guide, 'rules');
      assert.ok(refusal.rewrite.includes('omit secret'), JSON.stringify(refusal));
      assert.ok(refusal.rewrite.includes(`write as the principal in .${owner}`), JSON.stringify(refusal));
    } finally { device.free(); }
  }
});

// @ref LLP 3000.000.001#4-verification — exercise the shipped WASM allocator, not a host-language replacement.
test('WASM predictions mint in allocation order across equal milliseconds and rollback', () => {
  const table = {
    columns: { id: 'Id', label: { Text: { max: 40 } } },
    indexes: { byId: { components: [{ Column: 'id' }], unique: true } },
    rules: { read: 'Allow', insert: 'Allow', update: 'Deny', delete: 'Deny' },
    sync: { audience: 'Public' },
  };
  const mutation = { name: 'add', kind: 'Mutation', args: { label: { Text: { max: 40 } } }, body: [
    { Insert: { table: 'entries', row: { Object: { id: { Input: 'NewId' }, label: { Variable: 'label' } } } } },
  ] };
  const device = new WebDevice(JSON.stringify({ generation: 1, schema: { tables: { entries: table } }, programs: [mutation] }), '[]');
  const request = value => JSON.parse(device.call(JSON.stringify(value)));
  try {
    const applied = request({ op: 'apply', first: true, page: { snapshot: true, events: [], watermark: 1, more: false, generation: 1 } });
    assert.ok('ok' in applied, JSON.stringify(applied));
    const ids = [];
    for (let n = 0; n < 16; n++) {
      const reply = request({ op: 'predict', name: 'add', viewer: 'alice', args: { label: `row${n}` }, now: n < 8 ? 2000 : 1000 });
      assert.equal(reply.ok?.new_ids?.length, 1, JSON.stringify(reply));
      ids.push(reply.ok.new_ids[0]);
    }
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every(id => id.slice(0, 10) === ids[0].slice(0, 10)), 'clock rollback retains the logical timestamp');
  } finally { device.free(); }
});
