import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { docLeaks, lintPackagedDocs } from '../../../scripts/packaged-docs.mjs';

test('publication rejects internal ownership text while allowing product ownership', () => {
  for (const text of ['DX2 owns starter recipes.', 'DX owns integration; HAND owns wire.', 'QDIAG owns the note.', 'Exact implements its adapter in its workstream.']) {
    assert.ok(docLeaks(text).length, text);
  }
  assert.deepEqual(docLeaks('The SDK owns retries. An account owns its profile. HANDLER is a code.'), []);
  assert.equal(docLeaks('Title\nDX2 owns starter recipes.')[0].line, 2);
});

test('packaged cards and references carry no workstream ownership', () => {
  lintPackagedDocs(fileURLToPath(new URL('../../../', import.meta.url)));
});
