import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const moduleUrl = process.env.S3_WASM_MODULE ? pathToFileURL(process.env.S3_WASM_MODULE) : new URL('../src/wasm/snapback4_device.js', import.meta.url);
const { initSync, WebDevice } = await import(moduleUrl.href);
const bytes = process.env.S3_WASM_MODULE ? process.env.S3_WASM_MODULE.replace(/\.js$/, '.wasm') : new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url);
initSync({ module: readFileSync(bytes) });

test('web word folding delegates only non-ASCII NFC, with Rust lowercase and identical ASCII fast path', () => {
  const normalize = String.prototype.normalize, lower = String.prototype.toLowerCase;
  let normalized = 0, lowered = 0;
  String.prototype.normalize = function (form) { assert.equal(form, 'NFC'); normalized++; return normalize.call(this, form); };
  String.prototype.toLowerCase = function () { lowered++; return lower.call(this); };
  try {
    for (const text of ['CAFE\u0301', 'ΟΣ', 'ΟΣΑ', 'I İ ı i', '𐐀', '\0\ufdd0\u{10ffff}']) {
      assert.equal(WebDevice.word_fold(text), lower.call(normalize.call(text, 'NFC')));
    }
    assert.equal(normalized, 6); assert.equal(lowered, 0);
    for (let a = 0; a < 128; a++) for (let b = 0; b < 128; b++) {
      const text = String.fromCharCode(a, b);
      assert.equal(WebDevice.word_fold(text), lower.call(normalize.call(text, 'NFC')));
    }
    assert.equal(WebDevice.word_fold(''), '');
    assert.equal(normalized, 6); assert.equal(lowered, 0);
  } finally { String.prototype.normalize = normalize; String.prototype.toLowerCase = lower; }
});

const canaries = [['A\u030A', '\u00C5'], ['d\u0323\u0307', '\u1E0D\u0307'], ['\u1E9B\u0323', '\u1E9B\u0323'], ['\u1100\u1161', '\uAC00']];
const originalNormalize = String.prototype.normalize;
const emptyBackend = JSON.stringify({ generation: 1, programs: [], schema: { tables: {} } });

for (const [name, replacement] of [
  ['missing', undefined], ['non-function', 42], ['identity', function () { return String(this); }],
  ['throwing', () => { throw new Error('unicode host unavailable'); }],
  ...canaries.map(([input], i) => [`canary ${i + 1}`, function (form) { return String(this) === input ? 'wrong' : originalNormalize.call(this, form); }]),
]) {
  test(`web open refuses ${name} normalization before loading and opens after restoration`, () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, 'normalize');
    try {
      if (replacement === undefined) delete String.prototype.normalize;
      else String.prototype.normalize = replacement;
      for (const backend of [emptyBackend, '{bad backend']) {
        assert.throws(() => new WebDevice(backend, '[]'), error => {
          const { denied } = JSON.parse(error.message);
          assert.equal(denied.code, 'E_HOST_UNICODE');
          assert.equal(denied.family, 'store');
          assert.match(denied.message, /standard String\.prototype\.normalize/);
          return true;
        });
      }
    } finally { Object.defineProperty(String.prototype, 'normalize', descriptor); }
    const device = new WebDevice(emptyBackend, '[]');
    try {
      for (const [input, nfc] of canaries) assert.equal(WebDevice.word_fold(input), nfc.toLowerCase());
    } finally { device.free(); }
  });
}

test('host normalization failure is loud and never falls back to another tokenizer', () => {
  const normalize = String.prototype.normalize;
  String.prototype.normalize = () => { throw new Error('unicode host unavailable'); };
  try {
    assert.throws(() => WebDevice.word_fold('é'), /unicode host unavailable/);
    assert.equal(WebDevice.word_fold('COFFEE'), 'coffee');
  } finally { String.prototype.normalize = normalize; }
});

test('page apply and reopen use that fold without changing kept row text', () => {
  const backend = { generation: 1, programs: [], schema: { tables: { notes: {
    columns: { id: 'Id', body: { Text: { max: 4000 } } },
    indexes: { byId: { components: [{ Column: 'id' }], unique: true }, byWords: { components: [{ WordPrefixes: { fields: ['body'], contract: 'nfc-lower-alnum-1' } }, { Column: 'id' }], unique: false } },
    rules: { read: 'Allow', insert: 'Allow', update: 'Deny', delete: 'Deny' }, constraints: [], leave: 'until-revoked', sync: { audience: 'Public' },
  } } } };
  const normalize = String.prototype.normalize;
  let calls = 0;
  String.prototype.normalize = function (form) { calls++; return normalize.call(this, form); };
  let device;
  try {
    device = new WebDevice(JSON.stringify(backend), '[]');
    const opened = calls;
    const body = 'CAFE\u0301 ΟΣ 𐐀';
    const result = JSON.parse(device.call(JSON.stringify({ op: 'apply', first: true, page: { snapshot: true, events: [{ table: 'notes', kind: 'put', id: 'n1', data: { id: 'n1', body } }], watermark: 1, generation: 1, more: false } })));
    assert.ok(result.ok, JSON.stringify(result)); assert.ok(calls > opened);
    const kept = device.drain();
    assert.equal(JSON.parse(JSON.parse(kept).find(c => c.s === 'r').v).Row.body.String, body);
    device.free(); device = undefined;
    const before = calls;
    device = new WebDevice(undefined, kept);
    assert.ok(calls > before + 4, 'reopen rebuilds word keys with the host fold');
    assert.equal(JSON.parse(device.drain()).filter(c => c.s === 'r').length, 0);
  } finally { device?.free(); String.prototype.normalize = normalize; }
});
