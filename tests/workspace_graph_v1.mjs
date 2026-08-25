import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalRegularFileExists,
  maskRustCommentsAndLiterals,
  rustSourceFiles,
  sharedBuildScriptIncludePaths,
  validateArtifactAndMetadata,
  validateEngineDefinitionDenylist,
  validateModuleMembership,
  validateWorkspacePathModules,
} from '../scripts/check-workspace-graph.mjs';

const artifact = JSON.parse(readFileSync(new URL('../crates/allowed-dependencies.v1.json', import.meta.url)));
const workspaceManifestSource = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');
const cratesRoot = fileURLToPath(new URL('../crates', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRustFiles = rustSourceFiles(cratesRoot);
const rustPaths = workspaceRustFiles
  .map(({ path }) => relative(repositoryRoot, path).split(sep).join('/'))
  .sort();
const sharedBuildScriptIncludes = sharedBuildScriptIncludePaths(workspaceRustFiles);
const generatedSourceHomePrefixes = artifact.generatedSourceHomes
  .map(({ path }) => `${path}/`);
const moduleCount = rustPaths.filter(
  (path) => /^crates\/[a-z0-9-]+\/(?:src|tests|examples|benches)\/.+\.rs$/u.test(path)
    || generatedSourceHomePrefixes.some((prefix) => path.startsWith(prefix)),
).length;

function metadata(name = 'snapback', dependencies = []) {
  const names = new Set(artifact.crates.map((entry) => entry.name));
  names.add(name);
  const packages = [...names].map((packageName) => {
    const id = `${packageName} 0.1.0 (path+file:///fixture/${packageName})`;
    const assigned = artifact.crates.some(({ name: assignedName }) => assignedName === packageName);
    const packageRoot = assigned
      ? fileURLToPath(new URL(`../crates/${packageName}/`, import.meta.url))
      : `/fixture/${packageName}`;
    const target = packageName === 'snapback-engine'
      ? {
        targets: [{
          kind: ['lib'],
          crate_types: ['lib'],
          name: 'snapback_engine',
          src_path: fileURLToPath(new URL('../crates/snapback-engine/src/lib.rs', import.meta.url)),
        }],
        }
      : {
        targets: [{
          kind: ['lib'],
          crate_types: ['lib'],
          name: packageName.replaceAll('-', '_'),
          src_path: join(packageRoot, 'src/lib.rs'),
        }],
      };
    return {
      id,
      name: packageName,
      publish: [],
      manifest_path: join(packageRoot, 'Cargo.toml'),
      dependencies: packageName === name
        ? dependencies.map((dependency) => ({ name: dependency }))
        : [],
      ...target,
    };
  });
  const snapbackId = packages.find((entry) => entry.name === 'snapback').id;
  return {
    packages,
    workspace_members: packages.map((entry) => entry.id),
    workspace_default_members: [snapbackId],
  };
}

function packageNamed(value, name) {
  return value.packages.find((entry) => entry.name === name);
}

test('the Phase 2 facade is assigned with no confined externals', () => {
  assert.deepEqual(validateArtifactAndMetadata(artifact, metadata(), workspaceManifestSource), {
    members: artifact.crates.map((entry) => entry.name).sort(),
    plannedCrates: 14,
  });
  assert.deepEqual(validateModuleMembership(
    artifact,
    rustPaths,
    undefined,
    undefined,
    sharedBuildScriptIncludes,
  ), {
    moduleCount,
    exceptionCount: 0,
    generatedSourceHomeCount: 0,
    sharedBuildScriptIncludeCount: 1,
  });
  assert.doesNotThrow(() => validateWorkspacePathModules(workspaceRustFiles));
});

test('a missing Phase 2 workspace member fails closed', () => {
  const value = metadata();
  const missing = packageNamed(value, 'snapback-conformance');
  value.packages = value.packages.filter((entry) => entry !== missing);
  value.workspace_members = value.workspace_members.filter((id) => id !== missing.id);
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /workspace member set must exactly match the 14-crate Phase 2 matrix/u,
  );
});

test('a Rust file outside the assigned workspace members fails closed', () => {
  const unmatched = [...rustPaths, 'crates/unassigned/src/deliberately-unmatched.rs'].sort();
  assert.throws(
    () => validateModuleMembership(
      artifact,
      unmatched,
      (path) => path === 'crates/unassigned/src/deliberately-unmatched.rs'
        || path.startsWith('issues/')
        || rustPaths.includes(path),
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /not inside an assigned workspace member/u,
  );
});

test('a noncanonical module path cannot escape its assigned owner', () => {
  assert.throws(
    () => validateModuleMembership(
      artifact,
      ['crates/snapback-types/../snapback/src/schema_export.rs'],
      () => true,
      '2026-08-18',
    ),
    /must be canonical/u,
  );
});

function syntheticMembershipException() {
  return {
    name: 'synthetic-membership-exception',
    assignments: [{
      module: 'crates/snapback-tools/src/bench.rs',
      assignedOwner: 'background-services',
    }],
    actualMember: 'snapback-tools',
    expiresAt: '2026-09-15',
    reason: 'negative fixture for the fail-closed membership-exception contract',
    ticket: 'issues/20260819-security-gates-expected-red-until-f1.md',
  };
}

test('a named membership exception cannot appear outside the reviewed inventory', () => {
  const added = structuredClone(artifact);
  added.membershipExceptions.push(syntheticMembershipException());
  assert.throws(
    () => validateModuleMembership(
      added,
      rustPaths,
      undefined,
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /membership exception assignments drifted/u,
  );
});

test('membership exceptions must match their physical member and stay bounded', () => {
  const wrongMember = structuredClone(artifact);
  wrongMember.membershipExceptions.push({
    ...syntheticMembershipException(),
    actualMember: 'snapback',
  });
  assert.throws(
    () => validateModuleMembership(
      wrongMember,
      rustPaths,
      undefined,
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /actualMember does not match/u,
  );

  const expired = structuredClone(artifact);
  expired.membershipExceptions.push({
    ...syntheticMembershipException(),
    expiresAt: '2026-08-17',
  });
  assert.throws(
    () => validateModuleMembership(
      expired,
      rustPaths,
      undefined,
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /expired on 2026-08-17/u,
  );
});

test('a loose Rust file outside the source and build-script homes fails closed', () => {
  assert.throws(
    () => validateModuleMembership(
      artifact,
      [...rustPaths, 'crates/snapback/loose.rs'].sort(),
      (path) => path === 'crates/snapback/loose.rs'
        || path.startsWith('issues/')
        || rustPaths.includes(path),
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /unmatched Rust file outside a member source home/u,
  );
});

test('generated Rust source homes are exact, member-local ownership assignments', () => {
  const widened = structuredClone(artifact);
  widened.generatedSourceHomes.push({
    member: 'snapback-engine',
    path: 'crates/snapback-engine/generated',
  });
  assert.throws(
    () => validateModuleMembership(
      widened,
      rustPaths,
      undefined,
      undefined,
      sharedBuildScriptIncludes,
    ),
    /generated source homes drifted/u,
  );

  const undeclaredGeneratedFile = 'crates/snapback-engine/generated/undeclared.rs';
  assert.throws(
    () => validateModuleMembership(
      artifact,
      [...rustPaths, undeclaredGeneratedFile].sort(),
      (path) => path === undeclaredGeneratedFile || rustPaths.includes(path),
      '2026-08-18',
      sharedBuildScriptIncludes,
    ),
    /unmatched Rust file outside a member source home/u,
  );
});

test('literal build-script includes declare only their resolved member-root Rust file', () => {
  assert.deepEqual(
    [...sharedBuildScriptIncludes],
    ['crates/snapback-types/build_identity.rs'],
  );

  const target = 'crates/snapback-types/synthetic_build_shared.rs';
  const syntheticIncludes = sharedBuildScriptIncludePaths([{
    path: join(repositoryRoot, 'crates/snapback-tools/build.rs'),
    source: [
      '// include!("../snapback-types/commented.rs");',
      'const EXAMPLE: &str = "include!(\\"../snapback-types/string.rs\\")";',
      'include!(/* direct literal */ r#"../snapback-types/synthetic_build_shared.rs"#);',
    ].join('\n'),
  }]);
  assert.deepEqual([...syntheticIncludes], [target]);
  assert.deepEqual(
    validateModuleMembership(
      artifact,
      [target],
      () => true,
      '2026-08-18',
      syntheticIncludes,
    ),
    {
      moduleCount: 0,
      exceptionCount: 0,
      generatedSourceHomeCount: 0,
      sharedBuildScriptIncludeCount: 1,
    },
  );
});

test('an include cannot widen the shared-build-source shape below the member root', () => {
  const nestedTarget = 'crates/snapback-types/support/nested.rs';
  const syntheticIncludes = sharedBuildScriptIncludePaths([{
    path: join(repositoryRoot, 'crates/snapback-tools/build.rs'),
    source: 'include!("../snapback-types/support/nested.rs");\n',
  }]);
  assert.deepEqual([...syntheticIncludes], [nestedTarget]);
  assert.throws(
    () => validateModuleMembership(
      artifact,
      [nestedTarget],
      () => true,
      '2026-08-18',
      syntheticIncludes,
    ),
    /unmatched Rust file outside a member source home/u,
  );
});

test('workspace #[path] mounts cannot escape or hide outside a member home', () => {
  const sourcePath = fileURLToPath(new URL('../crates/snapback-types/src/lib.rs', import.meta.url));
  assert.throws(
    () => validateWorkspacePathModules([{
      path: sourcePath,
      source: '#[path = "../../snapback-auth/src/lib.rs"] mod escaped;\n',
    }]),
    /workspace #\[path\] is not a canonical in-member Rust path/u,
  );
  assert.throws(
    () => validateWorkspacePathModules([{
      path: sourcePath,
      source: '#[cfg_attr(any(), path = "hidden.rs")] mod hidden;\n',
    }]),
    /cfg_attr may not hide a #\[path\] module/u,
  );
});

test('a symlink cannot make an out-of-owner file look physically owned', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-workspace-graph-'));
  try {
    mkdirSync(join(root, 'owner'));
    writeFileSync(join(root, 'outside.rs'), 'pub fn outside() {}\n');
    symlinkSync('../outside.rs', join(root, 'owner', 'borrowed.rs'));
    assert.equal(canonicalRegularFileExists(root, 'owner/borrowed.rs'), false);
    mkdirSync(join(root, 'outside-owner'));
    writeFileSync(join(root, 'outside-owner', 'escaped.rs'), 'pub fn escaped() {}\n');
    symlinkSync('outside-owner', join(root, 'borrowed-owner'));
    assert.equal(canonicalRegularFileExists(root, 'borrowed-owner/escaped.rs'), false);
    writeFileSync(join(root, 'owner', 'owned.rs'), 'pub fn owned() {}\n');
    assert.equal(canonicalRegularFileExists(root, 'owner/owned.rs'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the engine source walk rejects symlinked Rust definitions', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-engine-denylist-')));
  try {
    writeFileSync(join(root, 'outside.rs'), 'pub fn search() {}\n');
    symlinkSync('outside.rs', join(root, 'borrowed.rs'));
    assert.throws(() => rustSourceFiles(root), /Rust source tree contains a symlink/u);
    rmSync(join(root, 'borrowed.rs'));
    mkdirSync(join(root, 'outside-module'));
    writeFileSync(join(root, 'outside-module', 'auth.rs'), 'pub mod auth {}\n');
    symlinkSync('outside-module', join(root, 'borrowed-module'));
    assert.throws(() => rustSourceFiles(root), /Rust source tree contains a symlink/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the engine source walk rejects a symlink used as its root', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-engine-root-denylist-')));
  try {
    mkdirSync(join(root, 'actual-src'));
    writeFileSync(join(root, 'actual-src', 'lib.rs'), 'pub fn search() {}\n');
    symlinkSync('actual-src', join(root, 'linked-src'));
    assert.throws(
      () => rustSourceFiles(join(root, 'linked-src')),
      /Rust source root must be a real directory/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the engine source walk rejects a symlinked package ancestor', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-engine-ancestor-denylist-')));
  try {
    mkdirSync(join(root, 'actual-engine'));
    mkdirSync(join(root, 'actual-engine', 'src'));
    writeFileSync(join(root, 'actual-engine', 'src', 'lib.rs'), 'pub fn search() {}\n');
    symlinkSync('actual-engine', join(root, 'linked-engine'));
    assert.throws(
      () => rustSourceFiles(join(root, 'linked-engine', 'src')),
      /Rust source root may not traverse a symlinked ancestor/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the engine denylist covers qualified functions, unions, and raw identifiers', () => {
  for (const source of [
    'pub const fn search() {}',
    'pub unsafe fn search() {}',
    'pub extern "C" fn r#search() {}',
    'pub /* split visibility */ fn search() {}',
    'pub /* split restricted visibility */ (crate) fn search() {}',
    'pub fn /* split name */ search() {}',
    '#[inline] pub const fn r#search() {}',
    'pub union PreparedAuthProvision { x: u8 }',
    '#[cfg(test)] pub unsafe trait PreparedAuthProvision {}',
    '#[cfg(any())] pub mod auth {}',
    '#[repr(C)] pub struct PreparedAuthProvision;',
    '#[cfg(\n any()\n)] pub fn search() {}',
    '#[cfg_attr(\n any(), inline\n)] pub struct PreparedAuthProvision;',
    '#[doc = concat!(\n "x"\n)] pub mod auth {}',
    'mod hidden { pub fn search() {} }',
    'const OK: () = (); pub struct PreparedAuthProvision;',
    'const _: () = { fn auth() {} };',
    'struct Host; impl Host { pub fn search() {} }',
    'pub static search: u8 = 0;',
    'unsafe extern "C" { safe static search: u8; }',
    'unsafe extern "C" { unsafe static auth: u8; }',
    'thread_local!(static auth: std::cell::Cell<u8> = const { std::cell::Cell::new(0) });',
    'thread_local![static search: std::cell::Cell<u8> = const { std::cell::Cell::new(0) }];',
    'thread_local!(pub static activation: std::cell::Cell<u8> = const { std::cell::Cell::new(0) });',
    'pub const auth: u8 = 0;',
    'pub struct activation;',
    'macro_rules! search { () => {} }',
    'macro_rules /* split bang */ ! auth { () => {} }',
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{ path: '/fixture/engine.rs', source }]),
      /snapback-engine defines forbidden|may not define item-generating macros/u,
      source,
    );
  }
});

test('definition-producing engine includes and macros fail closed', () => {
  for (const source of [
    '#[path = "../../snapback-kernel/src/control_catalog.rs"] mod imported_catalog;',
    '#[path = "hidden.inc"] mod imported_catalog;',
    '#[cfg_attr(all(), path = "../../snapback-kernel/src/control_catalog.rs")] mod imported_catalog;',
    '#[define_item] pub fn harmless() {}',
    '#[derive(DefineSearch)] struct Harmless;',
    'include!("../../snapback-kernel/src/control_catalog.rs");',
    'macro_rules! define_item { ($name:ident) => { pub fn $name() {} } }\ndefine_item!(search);',
    'some_item_macro!(search);',
    'use foreign::define_search as json;\njson!();',
    'use foreign_derive::DefineSearch as Serialize;\n#[derive(Serialize)] struct Harmless;',
    'use foreign_attr::DefineSearch as serde;\n#[serde] struct Harmless;',
    'use foreign_derive::Serialize;\n#[derive(Serialize)] struct Harmless;',
    'use foreign_derive::JsonSchema;\n#[derive(JsonSchema)] struct Harmless;',
    'use foreign_attr::serde;\n#[serde] struct Harmless;',
    'extern crate foreign as serde_json;\nserde_json::json!({});',
    'pub(crate) extern crate foreign as serde_json;\nserde_json::json!({});',
    'mod std { pub use foreign::define_env as env; }\nuse std::env;\nenv!();',
    'use foreign::*;\njson!({});',
    'pub use foreign::*;\n#[derive(Serialize)] struct Harmless;',
    'use foreign::*;\n#[serde] struct Harmless;',
    'use foreign::{*};\nparams![];',
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{ path: '/fixture/engine.rs', source }]),
      /engine #\[path\] escapes|unreviewed macro|unreviewed attribute|unreviewed derive|unreviewed glob|cfg_attr may not hide|may not define item-generating macros|may not alias a trusted macro binding|may not import trusted macro binding|may not alias an extern crate|may not shadow a trusted macro crate binding/u,
      source,
    );
  }
});

test('reviewed engine derives remain bound to their canonical imports', () => {
  assert.doesNotThrow(() => validateEngineDefinitionDenylist(artifact, [{
    path: '/fixture/engine.rs',
    source: 'use schemars::JsonSchema;\n#[derive(JsonSchema)] struct Harmless;',
  }]));
});

test('reviewed engine compatibility globs stay bound to their exact files', () => {
  assert.doesNotThrow(() => validateEngineDefinitionDenylist(artifact, [
    {
      path: join(repositoryRoot, 'crates/snapback-engine/src/local.rs'),
      source: 'mod runtime_cost;\npub use runtime_cost::*;',
    },
    {
      path: join(repositoryRoot, 'crates/snapback-engine/src/local/engine.rs'),
      source: 'use super::runtime_cost::*;',
    },
  ]));

  for (const source of [
    'use super::runtime_cost::*;',
    'pub use runtime_cost::*;',
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{
        path: join(repositoryRoot, 'crates/snapback-engine/src/other.rs'),
        source,
      }]),
      /unreviewed glob/u,
      source,
    );
  }
});

test('reviewed runtime_cost globs cannot be rebound at their canonical path', () => {
  const canonicalPath = join(repositoryRoot, 'crates/snapback-engine/src/local.rs');
  for (const source of [
    'extern crate foreign_macros as runtime_cost;\npub use runtime_cost::*;\n#[derive(JsonSchema)] struct Harmless;',
    'use foreign_macros as runtime_cost;\npub use runtime_cost::*;\n#[derive(JsonSchema)] struct Harmless;',
    'use foreign_macros::{JsonSchema as runtime_cost};\npub use runtime_cost::*;\n#[derive(JsonSchema)] struct Harmless;',
    'use foreign_macros::runtime_cost;\npub use runtime_cost::*;',
    'struct runtime_cost;\npub use runtime_cost::*;',
    'type runtime_cost = foreign_macros::JsonSchema;\npub use runtime_cost::*;',
    'mod runtime_cost {}\npub use runtime_cost::*;',
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{ path: canonicalPath, source }]),
      /may not (?:alias|shadow).*runtime_cost/u,
      source,
    );
  }
  assert.throws(
    () => validateEngineDefinitionDenylist(artifact, [{
      path: join(repositoryRoot, 'crates/snapback-engine/src/other.rs'),
      source: 'mod runtime_cost;',
    }]),
    /may not shadow reviewed glob binding runtime_cost/u,
  );
});

test('reviewed local glob roots cannot be rebound', () => {
  for (const { path, source } of [
    {
      path: join(repositoryRoot, 'crates/snapback-engine/src/local/engine.rs'),
      source: 'use foreign_bridge as config_types;\npub use config_types::*;\n#[derive(JsonSchema)] struct Harmless;',
    },
    {
      path: join(repositoryRoot, 'crates/snapback-engine/src/local.rs'),
      source: 'use foreign_bridge::{payload as engine};\npub use engine::*;',
    },
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{ path, source }]),
      /may not alias reviewed glob binding (?:config_types|engine)/u,
      source,
    );
  }
});

test('reviewed crate-qualified glob roots cannot be rebound', () => {
  const canonicalPath = join(repositoryRoot, 'crates/snapback-engine/src/lib.rs');
  for (const source of [
    'extern crate foreign_bridge as snapback_kernel;\npub use snapback_kernel::assets::*;',
    'use foreign_bridge::{payload as snapback_types};\npub use snapback_types::instance_fork::*;',
  ]) {
    assert.throws(
      () => validateEngineDefinitionDenylist(artifact, [{ path: canonicalPath, source }]),
      /may not (?:alias or shadow|alias) reviewed glob binding snapback_(?:kernel|types)/u,
      source,
    );
  }
});

test('a crate-root alias cannot poison a reviewed glob in another file', () => {
  assert.throws(
    () => validateEngineDefinitionDenylist(artifact, [
      {
        path: join(repositoryRoot, 'crates/snapback-engine/src/local.rs'),
        source: 'pub use runtime_cost::*;',
      },
      {
        path: join(repositoryRoot, 'crates/snapback-engine/src/lib.rs'),
        source: 'extern crate foreign_bridge as runtime_cost;',
      },
    ]),
    /may not alias or shadow reviewed glob binding runtime_cost/u,
  );
});

test('comment and literal examples do not count as engine definitions', () => {
  const source = [
    '// pub fn search() {}',
    '/* pub union PreparedAuthProvision { x: u8 } */',
    'const EXAMPLE: &str = "pub mod auth {};";',
    'const RAW: &str = r###"pub fn search() {}"###;',
    'const BYTES: &[u8] = br#"pub struct AuthProvisionCommit;"#;',
    'const MULTILINE: &str = "pub fn search()',
    'still literal text";',
    "const QUOTE: char = 's';",
    "fn lifetime<'auth>(value: &'auth str) -> &'auth str { value }",
  ].join('\n');
  assert.doesNotThrow(() => validateEngineDefinitionDenylist(
    artifact,
    [{ path: '/fixture/engine.rs', source }],
  ));
  const masked = maskRustCommentsAndLiterals(source);
  assert.equal(masked.includes('pub fn search'), false);
  assert.match(masked, /fn lifetime<'auth>/u);
  assert.throws(
    () => validateEngineDefinitionDenylist(artifact, [{
      path: '/fixture/engine.rs',
      source: 'const TEXT: &str = "multiline\ntext";\npub fn search() {}',
    }]),
    /snapback-engine defines forbidden/u,
  );
});

test('an unassigned workspace member fails closed', () => {
  assert.throws(
    () => validateArtifactAndMetadata(artifact, metadata('surprise'), workspaceManifestSource),
    /has no owner\/rank assignment/u,
  );
});

test('a confined external outside its owner fails closed', () => {
  assert.throws(
    () => validateArtifactAndMetadata(
      artifact,
      metadata('snapback-types', ['axum']),
      workspaceManifestSource,
    ),
    /may not depend on confined external axum/u,
  );
});

test('the engine cannot rename a dependency over a trusted macro crate binding', () => {
  const value = metadata('snapback-engine', ['foreign-macros']);
  packageNamed(value, 'snapback-engine').dependencies[0].rename = 'serde';
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /may not rename foreign-macros to trusted macro crate binding serde/u,
  );
});

test('the engine cannot rename an external proc-macro dependency to runtime_cost', () => {
  const value = metadata('snapback-engine', ['foreign-macros']);
  packageNamed(value, 'snapback-engine').dependencies[0].rename = 'runtime_cost';
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /may not rename foreign-macros to trusted macro crate binding runtime_cost/u,
  );
});

test('the engine cannot rename dependencies over any reviewed glob root class', () => {
  for (const binding of ['config_types', 'engine', 'snapback_kernel']) {
    const value = metadata('snapback-engine', ['foreign-bridge']);
    packageNamed(value, 'snapback-engine').dependencies[0].rename = binding;
    assert.throws(
      () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
      new RegExp(`may not rename foreign-bridge to trusted macro crate binding ${binding}`, 'u'),
      binding,
    );
  }
});

test('the engine cannot hyphen-rename a dependency over a trusted crate binding', () => {
  const value = metadata('snapback-engine', ['foreign-macros']);
  packageNamed(value, 'snapback-engine').dependencies[0].rename = 'serde-json';
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /may not rename foreign-macros to trusted macro crate binding serde_json/u,
  );
});

test('the engine definition scan is bound to its canonical lib target', () => {
  const value = metadata('snapback-engine');
  packageNamed(value, 'snapback-engine').targets[0].src_path = fileURLToPath(
    new URL('../crates/snapback-engine/src/local.rs', import.meta.url),
  );
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /only its canonical physical/u,
  );

  const extra = metadata('snapback-engine');
  packageNamed(extra, 'snapback-engine').targets.push({
    kind: ['bin'],
    crate_types: ['bin'],
    name: 'unscanned-engine-bin',
    src_path: fileURLToPath(new URL('../crates/snapback-engine/src/local.rs', import.meta.url)),
  });
  assert.throws(
    () => validateArtifactAndMetadata(artifact, extra, workspaceManifestSource),
    /only its canonical physical/u,
  );
});

test('every Cargo target and manifest stays in its assigned member home', () => {
  const escapedTarget = metadata();
  packageNamed(escapedTarget, 'snapback-types').targets[0].src_path = fileURLToPath(
    new URL('../crates/snapback-auth/src/lib.rs', import.meta.url),
  );
  assert.throws(
    () => validateArtifactAndMetadata(artifact, escapedTarget, workspaceManifestSource),
    /snapback-types target src_path escapes its assigned member home/u,
  );

  const escapedManifest = metadata();
  packageNamed(escapedManifest, 'snapback-types').manifest_path = fileURLToPath(
    new URL('../crates/snapback-auth/Cargo.toml', import.meta.url),
  );
  assert.throws(
    () => validateArtifactAndMetadata(artifact, escapedManifest, workspaceManifestSource),
    /snapback-types package manifest must be the canonical physical/u,
  );
});

test('publishable workspace crates fail closed', () => {
  const value = metadata();
  packageNamed(value, 'snapback').publish = null;
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /publish = false/u,
  );
});

test('the committed matrix cannot widen without amending its checked projection', () => {
  const widened = structuredClone(artifact);
  widened.crates.find((entry) => entry.name === 'snapback-kernel')
    .allowedWorkspaceDependencies.push('snapback-auth');
  assert.throws(
    () => validateArtifactAndMetadata(widened, metadata(), workspaceManifestSource),
    /matrix crate rows drifted/u,
  );

  const generatedHomeWidening = structuredClone(artifact);
  generatedHomeWidening.generatedSourceHomes.push({
    member: 'snapback-engine',
    path: 'crates/snapback-engine/generated',
  });
  assert.throws(
    () => validateArtifactAndMetadata(
      generatedHomeWidening,
      metadata(),
      workspaceManifestSource,
    ),
    /generated source homes drifted/u,
  );
});

test('scratch manifest copies cannot drop either workspace trap', () => {
  const withoutDefaultMembers = workspaceManifestSource.replace(/^default-members\s*=.*\n/mu, '');
  assert.notEqual(withoutDefaultMembers, workspaceManifestSource);
  assert.throws(
    () => validateArtifactAndMetadata(artifact, metadata(), withoutDefaultMembers),
    /workspace\.default-members/u,
  );

  const withoutExclude = workspaceManifestSource.replace(/^exclude\s*=.*\n/mu, '');
  assert.notEqual(withoutExclude, workspaceManifestSource);
  assert.throws(
    () => validateArtifactAndMetadata(artifact, metadata(), withoutExclude),
    /workspace\.exclude/u,
  );
});
