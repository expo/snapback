import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
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
  GateInfrastructureError,
  runAst,
} from '../scripts/security-gates-lib.mjs';
import {
  loadAttacks,
  runAttack,
  validateFixtureInventory,
} from '../scripts/check-security-boundaries.mjs';

const root = resolve(import.meta.dirname, '..');
const fixtureRoot = resolve(root, 'tests/fixtures/security-boundaries');

function manifestedGuideFixture() {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-generated-api-manifest-'));
  const crate = join(scratch, 'crates/snapback-server');
  mkdirSync(join(crate, 'src'), { recursive: true });
  mkdirSync(join(crate, 'generated'), { recursive: true });
  mkdirSync(join(scratch, 'crates'), { recursive: true });
  mkdirSync(join(scratch, 'issues'), { recursive: true });
  writeFileSync(join(scratch, 'Cargo.toml'), [
    '[workspace]',
    'members = ["crates/snapback-server"]',
    'resolver = "2"',
    '',
  ].join('\n'));
  writeFileSync(join(crate, 'Cargo.toml'), [
    '[package]',
    'name = "snapback-server"',
    'version = "0.0.0"',
    'edition = "2024"',
    'build = "build.rs"',
    '',
    '[lib]',
    'name = "snapback_server"',
    'path = "src/lib.rs"',
    '',
    '[features]',
    'default = ["server-owner"]',
    'server-owner = []',
    'test-support = []',
    '',
  ].join('\n'));
  writeFileSync(join(crate, 'src/lib.rs'), 'pub mod guide;\n');
  writeFileSync(
    join(crate, 'src/guide.rs'),
    [
      'pub struct EmbeddedGuideFile;',
      'include!("../generated/embedded_guide_api.rs");',
      '',
    ].join('\n'),
  );
  cpSync(resolve(root, 'crates/snapback-server/build.rs'), join(crate, 'build.rs'));
  cpSync(
    resolve(root, 'crates/snapback-server/generated/embedded_guide_api.rs'),
    join(crate, 'generated/embedded_guide_api.rs'),
  );
  cpSync(
    resolve(root, 'crates/snapback-server/generated/embedded-guide-api-shape.v1.json'),
    join(crate, 'generated/embedded-guide-api-shape.v1.json'),
  );
  cpSync(
    resolve(root, 'crates/privilege-surface-allowlist.v1.json'),
    join(scratch, 'crates/privilege-surface-allowlist.v1.json'),
  );
  cpSync(
    resolve(root, 'issues/20260819-build-generated-guide-api-audit.md'),
    join(scratch, 'issues/20260819-build-generated-guide-api-audit.md'),
  );
  return { scratch, crate };
}

// @ref LLP 0284#64-harness-integrity-the-gate-testing-itself — each proved
// evasion is a committed counterexample against the replacement gate.
test('privilege scanner catches aliases, private re-exports, traits, and structural SQL egress', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  assert(result.violations.length >= 5);
  const output = result.violations.map(({ item, detail }) => `${item}: ${detail}`).join('\n');
  assert.match(output, /synthetic_kernel::leak: public return type exposes rusqlite::Connection/u);
  assert.match(
    output,
    /synthetic_kernel::raw_identifier_leak: public return type exposes rusqlite::Connection/u,
  );
  assert.match(
    output,
    /synthetic_kernel::raw_identifier_seed_leak: returns privilege seed KernelCommitAuthority/u,
  );
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

test('renamed privilege imports seed returns and facade re-exports', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ kind, item, detail }) => `${kind} ${item}: ${detail}`).join('\n');
  assert.match(
    output,
    /reexport synthetic_kernel::RenamedPrivilegeFacade: publicly re-exports privilege seed Root/u,
  );
  assert.match(
    output,
    /seed-obtain synthetic_kernel::leak_renamed_privilege_seed: returns privilege seed KernelCommitAuthority/u,
  );
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

test('the R-2 heuristic retains new opaque return-and-consume candidates', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const heuristic = result.findings.filter(({ detail }) =>
    detail.startsWith('new seed-type heuristic:'));
  assert(
    heuristic.some(({ seedType, item }) => seedType === 'OpaqueReservation'
      && item === 'synthetic_kernel::LocalDatabase::reserve_opaque'),
    'an otherwise identical opaque return/consume carrier must remain a heuristic finding',
  );
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

test('macro- and OUT_DIR-generated public APIs fail closed in every item position', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  const output = result.violations.map(({ kind, item }) => `${kind} ${item}`).join('\n');
  assert.match(output, /macro-generated-api .*generated_privilege_api/u);
  assert.match(output, /generated-api .*generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*qualified_generated_privilege_api\.rs via std::include/u);
  assert.match(output, /generated-api .*raw_generated_privilege_api\.rs via include/u);
  assert.match(
    output,
    /generated-api .*qualified_raw_generated_privilege_api\.rs via std::include/u,
  );
  assert.match(output, /generated-api .*aliased_generated_privilege_api\.rs via imported_include/u);
  assert.match(output, /generated-api .*wrapped_generated_privilege_api\.rs via include_wrapper/u);
  assert.match(output, /generated-api .*GeneratedImplCarrier.*impl_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*GeneratedTraitCarrier.*trait_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*foreign_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*nested_generated_api.*nested_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*cfg_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*cfg_attr_generated_privilege_api\.rs via include/u);
  assert.match(output, /generated-api .*parameterized_wrapper_generated_privilege_api\.rs via invoke_include_parameter/u);
  assert.match(output, /macro-generated-api .*split_macro_invocation::make/u);
  assert.match(output, /macro-generated-api .*literal_public_macro_invocation::paste/u);
});

test('a raw pub identifier remains private macro output', () => {
  const corpus = resolve(root, 'tests/fixtures/privilege-surface/by_value_connection');
  const result = auditPrivilegeSurface(corpus);
  assert.equal(
    result.findings.some(({ kind, item }) => kind === 'macro-generated-api'
      && item.endsWith('private_raw_pub_identifier')),
    false,
    'r#pub is an identifier, not the pub visibility keyword',
  );
});

test('compilation-unit discovery canonicalizes raw include spellings', () => {
  const source = resolve(
    root,
    'tests/fixtures/privilege-surface/by_value_connection/crates/synthetic-kernel/src/lib.rs',
  );
  const references = runAst(['units', '--file', source]);
  for (const [value, expression] of [
    [
      '__SNAPBACK_OUT_DIR__/raw_generated_privilege_api.rs',
      'include!(concat ! (env ! ("OUT_DIR") , "/raw_generated_privilege_api.rs"))',
    ],
    [
      '__SNAPBACK_OUT_DIR__/qualified_raw_generated_privilege_api.rs',
      'std::include!(concat ! (env ! ("OUT_DIR") , "/qualified_raw_generated_privilege_api.rs"))',
    ],
  ]) {
    assert(
      references.some((reference) => reference.kind === 'include'
        && reference.value === value
        && reference.expression === expression),
      `expected compilation-unit reference for ${expression}`,
    );
  }
});

test('a qualified custom env macro makes an include unevaluable and fail closed', () => {
  const corpus = resolve(root, 'tests/fixtures/path-includes');
  const source = resolve(corpus, 'evil-env-include/src/lib.rs');
  const references = runAst(['units', '--file', source]);
  assert(
    references.some(({ kind, expression }) => kind === 'include-unevaluable'
      && expression.includes('evil :: env ! ("OUT_DIR")')),
    'evil::env! must not be evaluated as the built-in env!',
  );
  assert(
    auditCrossCratePathIncludes(corpus).violations.some(({ source: file, kind }) =>
      file === 'evil-env-include/src/lib.rs' && kind === 'include-unevaluable'),
    'the cross-crate include gate must fail the evil::env! fixture',
  );
});

test('the Guide wrapper is committed while generated expressions remain exact review debt', () => {
  const result = auditPrivilegeSurface(root);
  assert(
    !result.findings.some(({ kind, seedType }) => kind === 'seed-obtain'
      && seedType === 'DatabaseBinding'),
    'the audited identity-only DatabaseBinding must not be classified as a privilege seed',
  );
  assert.equal(
    result.findings.some(({ kind, item }) => kind === 'generated-api'
      && item.includes('embedded_guide.rs')),
    false,
    'the public module must no longer include item-generating Rust from OUT_DIR',
  );
  assert.equal(result.generatedApiManifests.length, 1);
  assert(
    result.findings.some(({ kind, item, detail }) => kind === 'generated-api'
      && item === 'snapback_server::guide::generated_data_expressions'
      && detail.includes('uninspected build-generated Rust expressions')),
    'the false expression-position premise must not suppress the generated bytes',
  );
  assert(
    result.allowlisted.some(({ id }) => id === 'embedded-guide-generated-table'),
    'the uninspected expression bytes must remain visible as expiring review debt',
  );
});

test('the Guide manifest refuses an arbitrary OTHER OUT_DIR include and recovers after removal', () => {
  const { scratch, crate } = manifestedGuideFixture();
  try {
    const source = join(crate, 'src/guide.rs');
    const original = readFileSync(source, 'utf8');
    const control = auditPrivilegeSurface(scratch);
    assert.equal(control.generatedApiManifests.length, 1);
    writeFileSync(join(crate, 'src/guide.rs'), [
      original.trimEnd(),
      'include!(concat!(env!("OUT_DIR"), "/hostile_privilege_api.rs"));',
      'std::include!(concat!(env!("OUT_DIR"), "/qualified_hostile_privilege_api.rs"));',
      '',
    ].join('\n'));
    const violations = auditPrivilegeSurface(scratch).violations;
    assert(
      violations.some(({ kind, item }) => kind === 'generated-api'
        && item.endsWith('hostile_privilege_api.rs via include')),
      'a second bare include must fail outside the committed API artifact',
    );
    assert(
      violations.some(({ kind, item }) => kind === 'generated-api'
        && item.endsWith('qualified_hostile_privilege_api.rs via std::include')),
      'std::include! must fail and cannot inherit the committed artifact proof',
    );
    assert(
      violations.some(({ kind, detail }) => kind === 'generated-api-manifest-invalid'
        && detail.includes('source include expression changed')),
      'the committed source-include set must drift closed too',
    );

    writeFileSync(source, original);
    const restored = auditPrivilegeSurface(scratch);
    assert.equal(restored.generatedApiManifests.length, 1);
    assert.equal(
      restored.violations.some(({ kind }) => kind === 'generated-api'
        || kind === 'generated-api-manifest-invalid'),
      false,
      'removing the planted include restores the committed manifest proof',
    );

    writeFileSync(
      source,
      original.replace(
        'include!("../generated/embedded_guide_api.rs");',
        'include!(concat!("../generated/", "embedded_guide_api.rs"));',
      ),
    );
    const respelled = auditPrivilegeSurface(scratch);
    assert(
      respelled.violations.some(({ kind, detail }) => kind === 'generated-api-manifest-invalid'
        && detail.includes('source include expression changed')),
      'a semantically equivalent include respelling must still invalidate the pinned expression',
    );
    writeFileSync(source, original);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('real build producer drift cannot forge committed generated-API evidence', { timeout: 60_000 }, () => {
  const { scratch, crate } = manifestedGuideFixture();
  try {
    const producer = join(crate, 'build.rs');
    const original = readFileSync(producer, 'utf8');
    const control = auditPrivilegeSurface(scratch);
    assert(
      control.generatedApiManifests.length === 1,
      `the copied committed proof must begin valid: ${JSON.stringify(control.violations)}`,
    );

    const oldGateDetection = [
      '',
      '// A forged producer could probe an audit marker, but changing these',
      '// committed bytes invalidates the manifest before the producer runs.',
      '// SNAPBACK_BUILD_GIT_COMMIT=security-gate-expansion-audit',
    ].join('\n');
    writeFileSync(producer, `${original}${oldGateDetection}`);
    const detecting = auditPrivilegeSurface(scratch);
    assert(
      detecting.violations.some(({ kind, detail }) => kind === 'generated-api-manifest-invalid'
        && detail.includes('producer source changed')),
      'a producer that detects the retired gate marker must fail before receiving proof credit',
    );

    writeFileSync(join(crate, 'actual-build.rs'), `${original}\n// alternate malicious producer\n`);
    writeFileSync(
      join(crate, 'Cargo.toml'),
      readFileSync(join(crate, 'Cargo.toml'), 'utf8').replace(
        'build = "build.rs"',
        'build = "actual-build.rs"',
      ),
    );
    const retargeted = auditPrivilegeSurface(scratch);
    assert(
      retargeted.violations.some(({ kind, detail }) => kind === 'generated-api-manifest-invalid'
        && detail.includes('producer is not Cargo custom-build target')),
      'changing Cargo custom-build target must not leave the reviewed build.rs authoritative',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('the committed Guide API artifact rejects raw SQL, seed, and discriminator names', () => {
  const { scratch, crate } = manifestedGuideFixture();
  try {
    const artifact = join(crate, 'generated/embedded_guide_api.rs');
    const original = readFileSync(artifact, 'utf8');
    for (const [label, declaration, identifier] of [
      ['raw SQL handle', 'pub fn hostile() -> rusqlite::Connection { todo!() }', 'Connection'],
      ['raw-identifier SQL handle', 'pub fn hostile() -> r#rusqlite::r#Connection { todo!() }', 'Connection'],
      ['LLP 0284 seed', 'pub fn hostile() -> KernelCommitAuthority { todo!() }', 'KernelCommitAuthority'],
      ['raw-identifier LLP 0284 seed', 'pub fn hostile() -> r#KernelCommitAuthority { todo!() }', 'KernelCommitAuthority'],
      ['authority discriminator', 'pub fn hostile(_: MembershipWriter) {}', 'MembershipWriter'],
    ]) {
      writeFileSync(artifact, `${original}\n${declaration}\n`);
      const result = auditPrivilegeSurface(scratch);
      assert(
        result.violations.some(({ kind, detail }) => kind === 'generated-api-manifest-invalid'
          && detail.includes('artifact bytes changed')
          && detail.includes('parsed public API shape changed')
          && detail.includes(identifier)),
        `${label} must invalidate the committed API proof`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
    assert.match(output, /raw-include\/src\/lib\.rs include-escape/u);
    assert.match(output, /evil-env-include\/src\/lib\.rs include-unevaluable/u);
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
