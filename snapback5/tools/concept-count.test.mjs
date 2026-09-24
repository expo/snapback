import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkConcepts, proposedSurface, runtimeStates } from './concept-count.mjs';
import { extractGuide } from './extract-guide.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const entryNames = entries => entries.map(item => item.entry);

test('RFC entries come from bullets, normalize wrapping, include Work, and deduplicate', () => {
  const doc = `### 3.1 What a program is
Example \`not-a-bullet\`.
\`\`\`quarry
- **Fake:** \`not-an-entry\`.
\`\`\`
- **Program:** \`effect\`.
- **Rules:** \`update\`, \`(old, next)\`, \`through
  .ref\`.
- **Writes:** \`update\`, \`if absent\`.
- **Work:** \`job\`, \`schedule\`, \`emit … once\`.
### 3.2 What leaves, and what stays
- **Elsewhere:** \`outside\`.
`;
  assert.deepEqual(entryNames(proposedSurface(doc)), [
    '(old, next)', 'effect', 'emit … once', 'if absent', 'job', 'schedule', 'through .ref', 'update',
  ]);
  const changed = doc.replace('`effect`.', '`effect`, `new form`.');
  assert.equal(proposedSurface(changed).length, proposedSurface(doc).length + 1);
});

test('runtime counts actual variants, both sent outcomes, auth and only enumerated refusals', () => {
  const contract = read('snapback4/packages/snapback4/src/contract.ts');
  const app = read('snapback4/packages/snapback4/src/app.ts');
  const api = 'import type { Query } from "snapback4/contract";\n'
    + '/** Require codes: NOT_FOUND, CUSTOM. */\n'
    + '/** Require codes: NOT_FOUND. E_QUERY_HELD. */\n'
    + 'export type Row = { role: "ADMIN" };\n';
  const entries = entryNames(runtimeStates(api, contract, app));
  assert.deepEqual(entries, [
    'AuthState.restoring', 'AuthState.signed-in', 'AuthState.signed-out', 'CUSTOM',
    'E_GENERATION', 'E_QUERY_HELD', 'NOT_FOUND', 'Read.data', 'Read.denied', 'Read.loading',
    'Write.failed', 'Write.pending', 'Write.sent (replayed=false)', 'Write.sent (replayed=true)',
  ]);
  assert.equal(runtimeStates(api.replace('CUSTOM.', 'CUSTOM, NEW_REFUSAL.'), contract, app).length,
    entries.length + 1);
  assert.throws(() => runtimeStates(api, contract.replace('export type Read<', 'export type Lost<'), app),
    /Cannot find the Read union/);
  const duplicate = contract.replace('readonly replayed: true', 'readonly replayed: false');
  assert.throws(() => runtimeStates(api, duplicate, app), /Indistinguishable variants/);
});

test('guide extraction ignores names, strings, comments and JS; includes inline default forms', () => {
  const work = join(root, 'snapback5/.work');
  mkdirSync(work, { recursive: true });
  const scratch = mkdtempSync(join(work, 'extractor-test-'));
  const dir = join(scratch, 'snapback4/crates/snapback4-lang/src/guide');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '../guide.rs'), '');
  const source = `\`retain until-revoked\` is the default; statements include \`else:\`.
\`\`\`quarry
table notices:
  body: text <=500
  read <- true
  sync last 100 by .at -- sync by .recipient; E_FAKE
query noticesFor(c: cursor ?):
  return notices last 20 by .at after c
mutation add():
  insert notices { body: 'sync to a; E_FAKE; max(2, 3)' }
\`\`\`
\`\`\`js
query pretend():
  return min(3, 5)
\`\`\`
`;
  try {
    writeFileSync(join(dir, 'language.rs'), source);
    const before = extractGuide(scratch).entries;
    const names = entryNames(before);
    assert(names.includes('retain until-revoked'));
    assert(names.includes('else'));
    assert(names.includes('sync last N by'));
    assert(!names.includes('sync by .col'));
    assert(!names.includes('sync to'));
    assert(!names.includes('max(…)'));
    assert(!names.includes('min(…)'));
    assert(!names.includes('notices'));
    assert(!names.includes('E_FAKE'));
    assert(before.every(item => item.sources.every(at => /:\d+$/.test(at))));
    writeFileSync(join(dir, 'language.rs'), source.replaceAll('notices', 'renamed').replaceAll('500', '3000'));
    assert.deepEqual(entryNames(extractGuide(scratch).entries), names);
    writeFileSync(join(dir, 'language.rs'), `${source}\n\`\`\`quarry\nquery added():\n  return sha256('hello')\n\`\`\`\n`);
    assert.deepEqual(entryNames(extractGuide(scratch).entries).filter(name => !names.includes(name)), ['sha256(…)']);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test('a missing commissioned residency note refuses measurement rather than lowering the count', () => {
  const rfc = read('llp/4000-snapback5.rfc.md');
  assert.throws(() => checkConcepts('snapback4', rfc.replaceAll('N_HORIZON_GUARD', 'N_CHANGED')),
    /five residency notes changed/);
});
