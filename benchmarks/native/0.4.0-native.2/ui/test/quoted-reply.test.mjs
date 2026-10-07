import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/QuotedReply.tsx', import.meta.url), 'utf8');

test('QuotedReply defaults to the quoted-excerpt preview contract ID', () => {
  // The default must be the destructured-parameter default (the form the
  // component actually applies), not merely a string somewhere in the file.
  const parameterDefaults = source.match(/\btestID\s*=\s*'[^']+',/gu) ?? [];
  assert.deepEqual(parameterDefaults, ["testID = 'sm-convo-quote-preview',"]);
  // The prop documentation must state the same default.
  assert.match(source, /Contract testID\. Default `sm-convo-quote-preview`\./u);
  // The legacy ID must not appear anywhere in the component source.
  assert.ok(!/['"`]sm-convo-quote['"`]/u.test(source));
});
