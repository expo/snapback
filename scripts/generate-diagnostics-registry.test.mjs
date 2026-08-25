import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  diagnosticCodeMatches,
  diagnosticSourceSites,
  environmentVariableSites,
} from './diagnostics-registry-source.mjs';

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

test('diagnostic source classifier excludes environment reads per site and retains emissions', () => {
  const fixture = readFileSync(resolve(
    import.meta.dirname,
    '../tests/fixtures/diagnostics-registry/non-emitting-reference-sites.txt',
  ), 'utf8');

  assert.equal([...fixture.matchAll(/SNAPBACK_[A-Z0-9_]+/gu)].length, 31);

  assert.deepEqual(
    [...diagnosticCodeMatches(fixture)].map((match) => match[0]),
    [
      'SNAPBACK_FIXTURE_RUST_MISMATCH',
      'SNAPBACK_FIXTURE_JS_EMITTED',
      'SNAPBACK_FIXTURE_JS_URL_EMITTED',
      'SNAPBACK_FIXTURE_JS_MESSAGE_ENV',
      'SNAPBACK_FIXTURE_JS_MESSAGE_OWNER',
      'SNAPBACK_FIXTURE_DUAL_ROLE',
      'SNAPBACK_FIXTURE_DUAL_ROLE',
    ],
  );

  const dualRoleSites = diagnosticSourceSites(fixture)
    .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_DUAL_ROLE');
  assert.equal(dualRoleSites.length, 2);
  assert.ok(dualRoleSites.every(({ kind }) => kind === 'emission'));
  assert.deepEqual(
    dualRoleSites.map(({ match }) => fixture.slice(
      fixture.lastIndexOf('\n', match.index - 1) + 1,
      fixture.indexOf('\n', match.index),
    )),
    [
      "throw new Error('SNAPBACK_FIXTURE_DUAL_ROLE');",
      'eprintln!("SNAPBACK_FIXTURE_DUAL_ROLE detail={detail}");',
    ],
  );

  const dualRoleEnvironmentSites = environmentVariableSites(fixture)
    .filter(({ match }) => match[0] === 'SNAPBACK_FIXTURE_DUAL_ROLE');
  assert.deepEqual(
    dualRoleEnvironmentSites.map(({ match, kind }) => ({
      line: fixture.slice(
        fixture.lastIndexOf('\n', match.index - 1) + 1,
        fixture.indexOf('\n', match.index),
      ),
      kind,
    })),
    [{ line: "const dualRole = env('SNAPBACK_FIXTURE_DUAL_ROLE');", kind: 'read' }],
  );

  const classifiedNames = [
    ...diagnosticSourceSites(fixture),
    ...environmentVariableSites(fixture),
  ].map(({ match }) => match[0]);
  assert.ok(!classifiedNames.includes('SNAPBACK_FIXTURE_NESTED__'));
  assert.ok(!classifiedNames.includes('SNAPBACK_FIXTURE_ORIGIN'));
});

test('diagnostic source classifier retains explicit historical reservations', () => {
  const source = [
    '// diagnostics-registry: reserved',
    '// `SNAPBACK_FIXTURE_RETIRED` is retained for historical records.',
  ].join('\n');

  assert.deepEqual(
    diagnosticSourceSites(source).map(({ match, kind }) => ({ code: match[0], kind })),
    [{ code: 'SNAPBACK_FIXTURE_RETIRED', kind: 'reserved' }],
  );
});
