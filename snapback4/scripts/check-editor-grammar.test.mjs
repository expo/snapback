import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { walk } from './check-editor-grammar.mjs';
function scratch(run) {
  const dir = mkdtempSync(join(tmpdir(), 'quarry-walk-'));
  try { run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('corpus walk includes .snapback and excludes only target and node_modules', () => scratch(dir => {
  for (const name of ['.snapback', 'target', 'node_modules']) { mkdirSync(join(dir, name)); writeFileSync(join(dir, name, 'example.q'), 'return 1'); }
  assert.deepEqual(walk(dir), [join(dir, '.snapback/example.q')]);
}));
test('corpus walk refuses symlink files, directories, cycles and dangling links loudly', () => {
  for (const kind of ['file', 'directory', 'cycle', 'dangling']) scratch(dir => {
    const target = join(dir, kind === 'cycle' ? '.' : 'target-path');
    if (kind === 'file') writeFileSync(target, 'return 1');
    if (kind === 'directory') { mkdirSync(target); writeFileSync(join(target, 'example.q'), 'return 1'); }
    symlinkSync(target, join(dir, 'linked.q'));
    assert.throws(() => walk(dir), /symlink.*linked.q/, kind);
  });
});
