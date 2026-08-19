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
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalRegularFileExists,
  maskRustCommentsAndLiterals,
  rustSourceFiles,
  validateArtifactAndMetadata,
  validateEngineDefinitionDenylist,
  validateModuleOwnership,
} from '../scripts/check-workspace-graph.mjs';

const artifact = JSON.parse(readFileSync(new URL('../crates/allowed-dependencies.v1.json', import.meta.url)));
const ownership = JSON.parse(readFileSync(new URL('../ownership.manifest.json', import.meta.url)));
const workspaceManifestSource = readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8');

function metadata(name = 'snapback', dependencies = []) {
  const names = new Set(artifact.crates.map((entry) => entry.name));
  names.add(name);
  const packages = [...names].map((packageName) => {
    const id = `${packageName} 0.1.0 (path+file:///fixture/${packageName})`;
    const engine = packageName === 'snapback-engine'
      ? {
        manifest_path: fileURLToPath(new URL('../crates/snapback-engine/Cargo.toml', import.meta.url)),
        targets: [{
          kind: ['lib'],
          crate_types: ['lib'],
          name: 'snapback_engine',
          src_path: fileURLToPath(new URL('../crates/snapback-engine/src/lib.rs', import.meta.url)),
        }],
        }
      : {};
    return {
      id,
      name: packageName,
      publish: [],
      dependencies: packageName === name
        ? dependencies.map((dependency) => ({ name: dependency }))
        : [],
      ...engine,
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
    plannedCrates: 13,
  });
});

test('a missing Phase 2 workspace member fails closed', () => {
  const value = metadata();
  const missing = packageNamed(value, 'snapback-conformance');
  value.packages = value.packages.filter((entry) => entry !== missing);
  value.workspace_members = value.workspace_members.filter((id) => id !== missing.id);
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /workspace member set must exactly match the 13-crate Phase 2 matrix/u,
  );
});

test('a deliberately misplaced manifest module fails closed without an exception', () => {
  const misplaced = structuredClone(ownership);
  misplaced.modulesByOwner['shared-contract-types-leaf'][0] =
    'crates/snapback/src/deliberately-misplaced.rs';
  misplaced.modulesByOwner['shared-contract-types-leaf'].sort();
  assert.throws(
    () => validateModuleOwnership(
      artifact,
      misplaced,
      (path) => path === 'crates/snapback/src/deliberately-misplaced.rs'
        || path.startsWith('issues/')
        || Object.values(ownership.modulesByOwner).flat().includes(path),
      '2026-08-18',
    ),
    /outside assigned owner shared-contract-types-leaf and has no named membership exception/u,
  );
});

test('a noncanonical module path cannot escape its assigned owner', () => {
  const escaped = structuredClone(ownership);
  escaped.modulesByOwner['shared-contract-types-leaf'][0] =
    'crates/snapback-types/../snapback/src/schema_export.rs';
  escaped.modulesByOwner['shared-contract-types-leaf'].sort();
  assert.throws(
    () => validateModuleOwnership(artifact, escaped, () => true, '2026-08-18'),
    /must be canonical/u,
  );
});

test('the Phase 2 flip rejects any remaining mixed module scope', () => {
  const mixed = structuredClone(ownership);
  mixed.mixedModuleScopes = {
    'crates/snapback/src/deliberately-mixed.rs': ['auth-substrate', 'embed-facade'],
  };
  assert.throws(
    () => validateModuleOwnership(artifact, mixed, () => true, '2026-08-18'),
    /mixedModuleScopes must be empty/u,
  );
});

test('the Phase 2 ownership inventory cannot disappear or admit non-modules', () => {
  const empty = structuredClone(ownership);
  empty.modulesByOwner = {};
  assert.throws(
    () => validateModuleOwnership(artifact, empty, () => true, '2026-08-18'),
    /complete Phase 2 owner-bucket schema/u,
  );

  const nonModule = structuredClone(ownership);
  nonModule.modulesByOwner['shared-contract-types-leaf'][0] =
    'crates/snapback-types/Cargo.toml';
  nonModule.modulesByOwner['shared-contract-types-leaf'].sort();
  assert.throws(
    () => validateModuleOwnership(artifact, nonModule, () => true, '2026-08-18'),
    /only Rust module source paths/u,
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
  packageNamed(value, 'snapback-engine').targets[0].src_path = '/fixture/outside.rs';
  assert.throws(
    () => validateArtifactAndMetadata(artifact, value, workspaceManifestSource),
    /only its canonical physical/u,
  );

  const extra = metadata('snapback-engine');
  packageNamed(extra, 'snapback-engine').targets.push({
    kind: ['bin'],
    crate_types: ['bin'],
    name: 'unscanned-engine-bin',
    src_path: '/fixture/activation.rs',
  });
  assert.throws(
    () => validateArtifactAndMetadata(artifact, extra, workspaceManifestSource),
    /only its canonical physical/u,
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
