import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../packages/snapback-harness/allowlist-install.js', import.meta.url),
  'utf8',
);

// Model the narrow native boundary that motivated ENG-24375: byte decoding is
// present and correct, but the host constructor recognizes only canonical
// `utf-8`. The compatibility layer must own alias/Web-IDL behavior rather than
// accidentally delegating it back to that host.
const nativeLabels = [];
class CanonicalUtf8Decoder {
  constructor(label) {
    nativeLabels.push(label);
    if (label !== 'utf-8') throw new RangeError(`unsupported native label: ${label}`);
    this.encoding = 'utf-8';
  }

  decode() {
    return '';
  }
}

const realm = vm.createContext({ TextDecoder: CanonicalUtf8Decoder });
vm.runInContext(source, realm, { filename: 'allowlist-install.js' });

for (const label of [
  'utf-8',
  'UTF8',
  'unicode-1-1-utf-8',
  'unicode11utf8',
  'unicode20utf8',
  'x-unicode20utf8',
  ' \t\nutf-8\r\f ',
]) {
  assert.equal(new realm.TextDecoder(label).encoding, 'utf-8', label);
}
assert.deepEqual(nativeLabels, Array(nativeLabels.length).fill('utf-8'));
const decoder = new realm.TextDecoder();
assert.equal(decoder.constructor, realm.TextDecoder);
assert.throws(
  () => new decoder.constructor('windows-1252'),
  (error) => error.name === 'RangeError',
);
assert.throws(() => new realm.TextDecoder('\u000Butf-8'), (error) => error.name === 'RangeError');
assert.throws(() => new realm.TextDecoder('\u00A0utf-8'), (error) => error.name === 'RangeError');
assert.throws(() => new realm.TextDecoder(Symbol('utf-8')), (error) => error.name === 'TypeError');

console.log('allowlist_install_v0.mjs: TextDecoder aliases canonicalize before native construction');
