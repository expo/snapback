// The complete unchanged calibration backends are compiled and the server's
// exact base headroom checked by reservation_app_headroom.rs on every suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';
initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const root = new URL('../../../crates/snapback4-lang/tests/fixtures/rp-calibrations/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const call = (d, request) => {
  const result = JSON.parse(d.call(JSON.stringify(request)));
  assert.ok(!result.denied, JSON.stringify(result));
  return result.ok;
};
for (const version of ['0411', '0412']) for (const kind of ['hello', 'realistic', 'near-max']) {
  test(`wasm real calibration ${version}: 50-member ${kind} send keeps server headroom`, () => {
    const c = read(`${version}-${kind}.json`);
    assert.equal(c.serverCommitted, true);
    assert.equal(c.predicted, false);
    const baseline = read('base-meters.json')[c.label];
    for (const [name, used] of Object.entries(c.meter)) assert.ok(used <= baseline[name], `${name}: ${used}`);
    const snapshot = read(`${version}/pages.json`);
    const backend = { generation: snapshot.generation, schema: read(`${version}/schema.json`), programs: read(`${version}/programs.json`) };
    const d = new WebDevice(JSON.stringify(backend), '[]');
    try {
      snapshot.pages.forEach((page, i) => call(d, { op: 'apply', first: i === 0, page }));
      const q = call(d, { op: 'admit', entry: { id: c.label, seq: 1, op: 'send', args: c.args,
        viewer: 'alice', now: c.now, new_ids: [], predicted: [], predictable: true } });
      // The authentic app supplies the id of an expiring, referenced row.
      // Only the server can exclude a hidden expired same-id predecessor.
      assert.equal(q.predictable, false, JSON.stringify(q));
      assert.deepEqual(q.predicted, []);
      const history = call(d, { op: 'query', name: 'history', args: { conversation: 'c', c: null }, viewer: 'alice', now: c.now });
      const message = history.data.find(row => row.id === 'm');
      assert.equal(message, undefined);
    } finally { d.free(); }
  });
}
