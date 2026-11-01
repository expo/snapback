import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lexicalFacts } from '../../../scripts/generate-editor-grammar.mjs';
test('firstLine recognizes every exported declaration and comment with a word boundary', () => {
  const { facts } = lexicalFacts(process.env.QUARRY_EDITOR_BINARY);
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const pattern = new RegExp(manifest.contributes.languages.find(l => l.id === 'quarry').firstLine);
  for (const head of facts.declaration_words) {
    assert(pattern.test(`${head} example:`), `firstLine misses ${head}`);
    assert(!pattern.test(`${head}ish example:`), `firstLine lacks boundary for ${head}`);
  }
  assert(pattern.test(`  ${facts.comment} example`));
});
