// Conformance for the Channel A HTML-safe serializer (LLP 0092 §0E.1–§0E.2):
// every byte-pinned fixture in tests/fixtures/rqs-serializer/ must reproduce
// its *.expected.bytes byte-for-byte, and the whole-output byte property (no
// 0x3C / 0x3E / raw U+2028 / raw U+2029) must hold and be enforced.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertHtmlSafeBytes,
  htmlSafeJsonSerialize,
  serializeBootPayload,
} from './rqs-serializer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', '..', 'tests', 'fixtures', 'rqs-serializer');
const cases = JSON.parse(readFileSync(join(fixtureDir, 'cases.json'), 'utf8')).cases;

test('fixture corpus is present and complete', () => {
  assert.ok(Array.isArray(cases) && cases.length >= 9, 'expected the 0E.2 fixture corpus');
});

for (const fixture of cases) {
  test(`fixture ${fixture.name} serializes byte-exactly (${fixture.exercises})`, () => {
    const input = JSON.parse(readFileSync(join(fixtureDir, fixture.input), 'utf8'));
    const expected = readFileSync(join(fixtureDir, fixture.expected));
    const produced = Buffer.from(serializeBootPayload(input), 'utf8');
    assert.deepEqual(
      [...produced],
      [...expected],
      `serializer bytes diverge from ${fixture.expected}`,
    );
    // The expected files themselves must satisfy the byte property — a
    // transport that decoded the escapes would corrupt them detectably.
    assertHtmlSafeBytes(expected.toString('utf8'));
  });
}

test('whole-output byte property rejects reintroduced literals', () => {
  // A post-serialization transform that decoded the escapes back into
  // literal characters (the trap LLP 0092 §0E.1 rule 4 exists for) fails
  // the mechanical check.
  const safe = htmlSafeJsonSerialize({ x: '</script>' });
  const corrupted = safe.replaceAll('\\u003c', '<').replaceAll('\\u003e', '>');
  assert.throws(() => assertHtmlSafeBytes(corrupted), /SNAPBACK_INLINE_SERIALIZER_UNSAFE/);
  const separator = htmlSafeJsonSerialize({ x: '\u2028' });
  assert.throws(
    () => assertHtmlSafeBytes(separator.replaceAll('\\u2028', '\u2028')),
    /SNAPBACK_INLINE_SERIALIZER_UNSAFE/,
  );
});

test('escapes apply to property names, not only values', () => {
  const out = htmlSafeJsonSerialize({ '</script>': 1 });
  assert.equal(out, '{"\\u003c/script\\u003e":1}');
});
