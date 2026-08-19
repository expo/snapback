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
import { GateInfrastructureError } from '../scripts/security-gates-lib.mjs';
import {
  loadAttacks,
  runAttack,
  validateFixtureInventory,
} from '../scripts/check-security-boundaries.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tests/fixtures/security-boundaries');

// @ref LLP 0284#64-harness-integrity-the-gate-testing-itself — each proved
// evasion is a committed counterexample against the replacement gate.
test('privilege scanner catches aliases, private re-exports, traits, and structural SQL egress', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  assert(result.violations.length >= 5);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /synthetic_kernel::leak: public return type exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::Handle: public type alias exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::Wrap::conn: public field exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::LeakingTrait::conn/u);
  assert.match(output, /synthetic_kernel::Associated::LEAK/u);
  assert.match(output, /synthetic_kernel::leak_renamed_import/u);
  assert.match(output, /synthetic_kernel::leak_private_reexport/u);
  assert.match(output, /synthetic_kernel::ReexportedStructLeak::conn/u);
  assert.match(output, /synthetic_kernel::glob_leak/u);
  assert.match(output, /synthetic_kernel::AsRefWrapper::AsRef/u);
});

test('local re-exports resolve crate and super prefixes', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /synthetic_kernel::crate_path_fn_leak: public return type exposes rusqlite::Connection/u);
  assert.match(output, /synthetic_kernel::super_path_fn_leak: public return type exposes rusqlite::Connection/u);
});

test('From impls expose a raw foreign self type', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /synthetic_kernel::Connection::From: public trait implementation exposes rusqlite::Connection/u);
});

test('privilege sink registry resolves real items and fails closed when one disappears', () => {
  const source = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(source);
  assert.equal(
    result.violations.some(({ kind }) => kind === 'sink-registry-unresolved'),
    false,
  );
  assert(
    result.violations.some(({ item }) => item.includes('record_membership_transition')),
    'the real transition provenance writer must be registered',
  );
  assert.equal(
    result.violations.some(({ item, seedType }) => item.includes('record_membership_transition')
      && seedType === 'ChangeOp'),
    false,
    'the transition operation label is not an authority discriminator',
  );

  const parent = mkdtempSync(join(tmpdir(), 'snapback-sink-registry-'));
  const corpus = join(parent, 'fixture');
  try {
    cpSync(source, corpus, { recursive: true });
    const lib = join(corpus, 'crates/synthetic-kernel/src/lib.rs');
    writeFileSync(
      lib,
      readFileSync(lib, 'utf8').replace(
        'fn record_membership_transition(_op: ChangeOp, _writer: &MembershipWriter) {}',
        'fn renamed_membership_transition(_op: ChangeOp, _writer: &MembershipWriter) {}',
      ),
    );
    const missing = auditPrivilegeSurface(corpus).violations;
    assert(
      missing.some(({ kind, item }) => kind === 'sink-registry-unresolved'
        && item === 'record_membership_transition'),
      'a registered sink that no longer resolves must produce a distinct violation',
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('direct sink signatures naming caller-constructible discriminants are ratcheted', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /MembershipWriter.*caller-constructible.*named directly/u);
  assert.match(output, /plan_privileged_membership_insert/u);
  assert.match(output, /sanctioned/u);
});

test('obtainability propagates through obtainable seed receivers in the default cell', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const findings = new Map(result.findings
    .filter(({ kind }) => kind === 'seed-obtain')
    .map((finding) => [finding.item, finding]));
  for (const item of [
    'synthetic_kernel::Db::authority',
    'synthetic_kernel::KernelCommitAuthority::service_authority_terminal_factory',
    'synthetic_kernel::ServiceAuthorityTerminalFactory::prepared',
    'synthetic_kernel::KernelCommitAuthority::authorization_commit_carriers',
    'synthetic_kernel::AuthorizationCommitCarrierFactory::reservation',
  ]) {
    assert(findings.has(item), `expected receiver closure finding for ${item}`);
    assert.deepEqual(findings.get(item).features, ['default']);
  }
});

test('caller feature predicates are scanned without assuming default features', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const leak = result.violations.find(({ item }) => item.includes('no_default_rusqlite'));
  assert(leak, 'expected the default-features=false re-export to be found');
  assert.deepEqual(leak.features, ['caller-features']);
});

test('target predicates retain both unix and non-unix public APIs', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const leak = result.violations.find(({ item }) => item === 'synthetic_kernel::non_unix_leak');
  assert(leak, 'expected the #[cfg(not(unix))] return to be found');
  assert.deepEqual(leak.features, ['default']);
});

test('macro- and OUT_DIR-generated public APIs fail closed', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ kind, item }) => `${kind} ${item}`).join('\n');
  assert.match(output, /macro-generated-api .*generated_privilege_api/u);
  assert.match(output, /generated-api .*generated_privilege_api\.rs/u);
});

test('seed egress requires an obtainable receiver', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const items = result.findings
    .filter(({ kind }) => kind === 'seed-obtain')
    .map(({ item }) => item);
  assert(!items.includes('synthetic_kernel::LockedScope::take'));
  assert(items.includes('synthetic_kernel::ObtainableScope::take'));
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
    assert.match(output, /nested-cfg-attr\/src\/lib\.rs path-escape/u);
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
  assert.match(outcomes[0].diagnostics.join('\n'), /AuthorizationCommitInterlock/u);
});

test('a Cargo failure without a rustc compiler-message is infrastructure', () => {
  const attack = loadAttacks(fixtureRoot)[0];
  assert.throws(
    () => runAttack({
      fixtureRoot,
      attack,
      spawnCargo: () => ({
        status: 101,
        stdout: '',
        stderr: 'error: failed to open .cargo-build-lock',
        error: undefined,
      }),
    }),
    GateInfrastructureError,
  );
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

test('privilege-bearing dependencies must each have an attack mount', () => {
  const attacks = loadAttacks(fixtureRoot).filter(({ mount }) => mount !== 'snapback-sync');
  const errors = validateFixtureInventory(root, fixtureRoot, attacks, [{
    crate: 'snapback-sync',
    kind: 'seed-obtain',
  }]);
  assert.match(errors.join('\n'), /snapback-sync/u);
  assert.match(errors.join('\n'), /no attack mounts/u);
});

test('an attack source must actually reference the crate it claims to mount', () => {
  const attacks = loadAttacks(fixtureRoot);
  const claim = attacks.find(({ id }) => id === 'claim-kernel-commit-authority');
  const swapped = attacks.map((attack) => attack.id === 'reserve-authorization-via-sync'
    ? {
      ...attack,
      bin: claim.bin,
      source: claim.source,
    }
    : attack);
  const errors = validateFixtureInventory(root, fixtureRoot, swapped, [{
    crate: 'snapback-sync',
    kind: 'seed-obtain',
  }]);
  assert.match(errors.join('\n'), /reserve-authorization-via-sync/u);
  assert.match(errors.join('\n'), /does not reference claimed mount snapback-sync/u);
});
