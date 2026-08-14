import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const fixture = JSON.parse(await readFile(
  new URL('../schemas/data-surface-swift-phase0-goldens.v1.json', import.meta.url),
  'utf8',
));

const canonical = (value) => JSON.stringify(value, (_key, child) => (
  child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
    : child
));

test('Phase-0 descriptor and refusal fixtures pin canonical JavaScript bytes', () => {
  assert.equal(canonical(fixture.descriptor), fixture.descriptorCanonical);
  assert.equal(canonical(fixture.refusal), fixture.refusalCanonical);
});
