import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { auditCrossCratePathIncludes } from '../scripts/check-cross-crate-path-includes.mjs';
import { auditPrivilegeSurface } from '../scripts/check-kernel-raw-sql-api.mjs';
import {
  loadAttacks,
  runAttack,
  validateFixtureInventory,
} from '../scripts/check-security-boundaries.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tests/fixtures/security-boundaries');

// @ref LLP 0284#64-harness-integrity-the-gate-testing-itself — each proved
// evasion is a committed counterexample against the replacement gate.
test('privilege scanner catches by-value and structural SQL egress without a product fixture', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  assert(result.violations.length >= 5);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /synthetic_kernel::leak: public return type exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::Handle: public type alias exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::Wrap::conn: public field exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::LeakingTrait::conn/u);
  assert.match(output, /synthetic_kernel::Associated::LEAK/u);
});

test('raw strings, cfg_attr, includes, and symlinks cannot cross compilation-unit ownership', () => {
  const parent = mkdtempSync(join(tmpdir(), 'snapback-path-gate-'));
  const corpus = join(parent, 'fixture');
  try {
    cpSync(resolve(root, 'tests/fixtures/path-includes'), corpus, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const result = auditCrossCratePathIncludes(corpus);
    const output = result.violations
      .map(({ source, kind, target }) => `${source} ${kind} ${target}`)
      .join('\n');
    assert.match(output, /raw-string\/src\/lib\.rs path-escape/u);
    assert.match(output, /raw-hash-string\/src\/lib\.rs path-escape/u);
    assert.match(output, /cfg-attr\/src\/lib\.rs path-escape/u);
    assert.match(output, /include\/src\/lib\.rs include-escape/u);
    assert.match(output, /symlink-source\/src\/stolen\.rs symlink-source/u);
    assert.match(output, /symlink-target\/src\/lib\.rs path-escape/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('an ordinary in-crate path module remains allowed', () => {
  const control = auditCrossCratePathIncludes(
    resolve(root, 'tests/fixtures/path-includes-control'),
  );
  assert.deepEqual(control.violations, []);
});

test('an unrelated compiler error cannot satisfy a compile-fail attack', () => {
  const outcomes = runAttack({
    fixtureRoot,
    attack: {
      id: 'unrelated-error-satisfies-regex',
      bin: 'unrelated-error-satisfies-regex',
      source: 'src/harness/unrelated_error_satisfies_regex.rs',
      mount: 'snapback-kernel',
      featureSets: [[]],
    },
  });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].passed, false);
  assert.match(outcomes[0].line, /no primary span overlapped @attack/u);
});

test('a claimed mount absent from cargo metadata dependency keys fails inventory honesty', () => {
  const parent = mkdtempSync(join(tmpdir(), 'snapback-security-inventory-'));
  const copy = join(parent, 'fixture');
  try {
    cpSync(fixtureRoot, copy, { recursive: true });
    const manifestPath = join(copy, 'Cargo.toml');
    const manifest = readFileSync(manifestPath, 'utf8').replaceAll(
      /path = "\.\.\/\.\.\/\.\.\/crates\/([^"]+)"/gu,
      (_match, name) => `path = "${resolve(root, 'crates', name)}"`,
    );
    writeFileSync(manifestPath, manifest);
    const attacks = loadAttacks(fixtureRoot);
    attacks.push({
      ...attacks[0],
      id: 'named-but-not-depended-on',
      mount: 'snapback-conformance',
    });
    // The counterexample targets the manifest/attack join. Production runs
    // separately supply the scanner-derived privilege-crate closure.
    const errors = validateFixtureInventory(root, copy, attacks, []);
    assert.match(errors.join('\n'), /snapback-conformance/u);
    assert.match(errors.join('\n'), /absent from cargo metadata dependencies/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
