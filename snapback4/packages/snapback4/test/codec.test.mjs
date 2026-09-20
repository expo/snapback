import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initSync, WebDevice } from '../src/wasm/snapback4_device.js';

initSync({ module: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)) });
const backend = JSON.stringify({ generation: 1, schema: { tables: {} }, programs: [] });
const page = { snapshot: true, events: [], watermark: 1, more: false, generation: 1 };

test('the shipped page codec validates unknown JSON values and accepts valid extensions', () => {
  const call = request => {
    const device = new WebDevice(backend, '[]');
    try { return JSON.parse(device.call(request)); } finally { device.free(); }
  };
  assert.deepEqual(call(JSON.stringify({ op: 'apply', first: true, page, extra: [null, true, 1.25, '☃'] })), { ok: { touched: [], published: true } });
  for (const extra of ['1e400', '"\\ud800"', '['.repeat(130) + '0' + ']'.repeat(130)]) {
    for (const request of [
      `{"op":"apply","first":true,"page":${JSON.stringify(page)},"extra":${extra}}`,
      `{"op":"apply","first":true,"page":{"extra":${extra},${JSON.stringify(page).slice(1)}}`,
    ]) assert.equal(call(request).denied?.code, 'E_INPUT', request);
  }
});
