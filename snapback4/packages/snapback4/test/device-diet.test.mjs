import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

initSync({ module: readFileSync(process.env.SNAPBACK4_DIET_WASM ?? new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const literal = value => ({ Literal: value });
const scan = { site: 'unbound', table: 'missing', index: 'byId', prefix: [], order: 'Asc', take: { Literal: 1 }, provenance: 'Const' };
const program = (name, body, args = {}) => ({ name, kind: 'Query', body, args });
function call(programs, name, args = {}) {
  const device = new WebDevice(JSON.stringify({ generation: 1, schema: { tables: {} }, programs }), '[]', 'dev:alice');
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
