import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { diagnosticCodeMatches } from './diagnostics-registry-source.mjs';

const root = resolve(import.meta.dirname, '..');
const generator = resolve(root, 'scripts/generate-diagnostics-registry.mjs');

function runFixture(name) {
  return spawnSync(
    process.execPath,
    [
      generator,
      '--check',
      '--guide-fixture-root',
      `scripts/fixtures/diagnostics-registry/${name}`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

test('rejects a diagnostic-primary marker for an unknown code', () => {
  const result = runFixture('unknown-primary');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /SNAPBACK_DIAGNOSTIC_PRIMARY_UNKNOWN_CODE/u,
  );
  assert.match(result.stderr, /SNAPBACK_NOT_A_PRODUCTION_DIAGNOSTIC/u);
});

test('rejects multiple diagnostic-primary markers for one diagnostic', () => {
  const result = runFixture('multiple-primary');
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(
    result.stderr,
    /SNAPBACK_DIAGNOSTIC_PRIMARY_MULTIPLE/u,
  );
  assert.match(result.stderr, /SNAPBACK_AUTH_STALE_RESULT/u);
});

test('diagnostic source classifier excludes environment reads and reference-only sites', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/non-emitting-reference-sites.txt',
  ), 'utf8');

  assert.deepEqual(
    [...diagnosticCodeMatches(fixture)].map((match) => match[0]),
    [
      'SNAPBACK_FIXTURE_RUST_MISMATCH',
      'SNAPBACK_FIXTURE_JS_EMITTED',
    ],
  );
});
