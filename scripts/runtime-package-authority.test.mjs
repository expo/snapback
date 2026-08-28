import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  REQUIRED_PRODUCTION_BUILD_RECIPE,
  RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  RUNTIME_CATALOG_INSPECTION_FAILED_CODE,
  assertPublicPackageBuildIdentity,
  assertRuntimeCatalogBuildIdentity,
  assertRuntimeCatalogBuildIdentityProof,
  assertRuntimePackageBuildIdentity,
  assertRuntimePackageSourceIdentity,
  createRuntimeCatalogBuildIdentityProof,
  inspectRuntimeCatalogBuildIdentity,
  installPackagedStoreQualificationReceipt,
} from './runtime-package-authority.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const valid = {
  schemaVersion: 'snapback.binary-identity.v1',
  buildDistribution: PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  binary: {
    crateVersion: '0.1.0',
    gitCommit: 'a'.repeat(40),
    gitDirty: false,
    // A production binary genuinely reports `release` here, because
    // BinaryIdentity.build_profile is derived from cfg!(debug_assertions).
    // That is the gap buildRecipe below exists to close.
    buildProfile: 'release',
    startupNonce: 'fixture',
  },
  buildRecipe: {
    profile: 'production',
    cargoProfileClass: 'release',
    optLevel: '3',
    lto: 'fat',
    codegenUnits: 1,
    incremental: false,
    strip: 'symbols',
  },
};

test('admits only a clean release binary compiled for public packaging', () => {
  assert.equal(assertPublicPackageBuildIdentity(valid), valid);
});

test('admits a control catalog minted from the enclosing binary identity', () => {
  const catalog = {
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: {
      sourceCommit: valid.binary.gitCommit,
      dirty: valid.binary.gitDirty,
    },
  };
  assert.deepEqual(
    assertRuntimeCatalogBuildIdentity(valid, catalog),
    catalog.buildIdentity,
  );
});

test('refuses a control catalog minted from another source state', () => {
  assert.throws(
    () => assertRuntimeCatalogBuildIdentity(valid, {
      schemaVersion: 'snapback.control-catalog.v1',
      buildIdentity: { sourceCommit: 'b'.repeat(40), dirty: true },
    }),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
});

test('inspects the build-bound catalog through the runtime binary', () => {
  const catalog = {
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: {
      sourceCommit: valid.binary.gitCommit,
      dirty: valid.binary.gitDirty,
    },
  };
  assert.deepEqual(inspectRuntimeCatalogBuildIdentity({
    binaryPath: '/fixture/snapback',
    binaryIdentity: valid,
    runBinary: (command, args) => {
      assert.equal(command, '/fixture/snapback');
      assert.deepEqual(args, ['controls', 'list', '--json']);
      return { status: 0, stdout: JSON.stringify(catalog), stderr: '' };
    },
  }), catalog.buildIdentity);
});

test('distinguishes runtime catalog inspection failures from identity mismatches', () => {
  for (const result of [
    { status: 1, stdout: '', stderr: 'fixture command failed' },
    { status: 0, stdout: '{not json', stderr: '' },
  ]) {
    assert.throws(
      () => inspectRuntimeCatalogBuildIdentity({
        binaryPath: '/fixture/snapback',
        binaryIdentity: valid,
        runBinary: () => result,
      }),
      (error) => error.code === RUNTIME_CATALOG_INSPECTION_FAILED_CODE,
    );
  }
  assert.throws(
    () => inspectRuntimeCatalogBuildIdentity({
      binaryPath: '/fixture/snapback',
      binaryIdentity: valid,
      runBinary: () => { throw new Error('fixture spawn failed'); },
    }),
    (error) => error.code === RUNTIME_CATALOG_INSPECTION_FAILED_CODE,
  );
  assert.throws(
    () => inspectRuntimeCatalogBuildIdentity({
      binaryPath: '/fixture/snapback',
      binaryIdentity: valid,
      runBinary: () => ({
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 'snapback.control-catalog.v1',
          buildIdentity: { sourceCommit: 'b'.repeat(40), dirty: false },
        }),
        stderr: '',
      }),
    }),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
});

test('closes the catalog identity proof over its native evidence source', () => {
  const proof = createRuntimeCatalogBuildIdentityProof({
    binaryIdentity: valid,
    catalogBuildIdentity: {
      sourceCommit: valid.binary.gitCommit,
      dirty: valid.binary.gitDirty,
    },
    source: 'snapback.runtime-artifact-attestation.v4',
  });
  assert.deepEqual(assertRuntimeCatalogBuildIdentityProof(valid, proof), proof);
  const mismatched = structuredClone(proof);
  mismatched.buildIdentity.sourceCommit = 'b'.repeat(40);
  assert.throws(
    () => assertRuntimeCatalogBuildIdentityProof(valid, mismatched),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
  const skipped = structuredClone(proof);
  skipped.source = 'foreign-architecture-skip';
  assert.throws(
    () => assertRuntimeCatalogBuildIdentityProof(valid, skipped),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
});

test('assembler strict mode admits a clean release contributor binary', () => {
  const contributor = structuredClone(valid);
  contributor.buildDistribution = 'contributor-source';
  assert.equal(assertRuntimePackageBuildIdentity(contributor), contributor);
});

test('assembler strict mode rejects a source-test debug/dirty contributor binary', () => {
  const contributor = structuredClone(valid);
  contributor.buildDistribution = 'contributor-source';
  contributor.binary.gitDirty = true;
  contributor.binary.buildProfile = 'debug';
  assert.throws(
    () => assertRuntimePackageBuildIdentity(contributor),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
  );
});

test('source-test staging admits a known-commit debug/dirty contributor binary', () => {
  const contributor = structuredClone(valid);
  contributor.buildDistribution = 'contributor-source';
  contributor.binary.gitDirty = true;
  contributor.binary.buildProfile = 'debug';
  assert.equal(assertRuntimePackageSourceIdentity(contributor), contributor);
});

test('source-test staging rejects an unstamped contributor binary', () => {
  const contributor = structuredClone(valid);
  contributor.buildDistribution = 'contributor-source';
  contributor.binary.gitCommit = 'unknown';
  contributor.binary.gitDirty = true;
  assert.throws(
    () => assertRuntimePackageSourceIdentity(contributor),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
  );
});

// @ref LLP 0314.000#phase-1--ship-the-ship-profile-and-strip-it — 1c: the
// required recipe is a claim about the build, so it may not drift silently
// away from what the root manifest declares. If someone weakens
// [profile.production], this fails until the requirement is updated in review.
test('the required ship recipe matches the root manifest declaration', () => {
  const manifest = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8');
  const header = manifest.indexOf('[profile.production]');
  assert(header >= 0, 'root Cargo.toml must declare [profile.production]');
  const next = manifest.indexOf('\n[', header + 1);
  const declared = (next < 0 ? manifest.slice(header) : manifest.slice(header, next))
    .split('\n')
    .map((line) => line.trim());
  for (const line of [
    'lto = "fat"',
    'codegen-units = 1',
    'incremental = false',
    'strip = "symbols"',
  ]) {
    assert(
      declared.includes(line),
      `root Cargo.toml [profile.production] must declare ${line}`,
    );
  }
  assert.deepEqual(REQUIRED_PRODUCTION_BUILD_RECIPE, {
    profile: 'production',
    optLevel: '3',
    lto: 'fat',
    codegenUnits: 1,
    incremental: false,
    strip: 'symbols',
  });
});

// One negative per way a build could claim the ship profile without being it.
test('refuses an ordinary release binary at public-package assembly', () => {
  const ordinaryRelease = structuredClone(valid);
  ordinaryRelease.buildRecipe = {
    profile: 'release',
    cargoProfileClass: 'release',
    optLevel: '3',
    lto: null,
    codegenUnits: null,
    incremental: null,
    strip: null,
  };
  // It is a clean release public-package binary by every pre-1c test, which is
  // exactly why the ceremony could previously claim production for it.
  assert.equal(assertRuntimePackageBuildIdentity(ordinaryRelease), ordinaryRelease);
  assert.throws(
    () => assertPublicPackageBuildIdentity(ordinaryRelease),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED'
      && /profile="release"/u.test(error.message),
  );
});

for (const [name, recipe] of [
  ['an absent recipe', undefined],
  ['a null recipe', null],
  ['an unstripped recipe', { ...valid.buildRecipe, strip: 'none' }],
  ['a thin-LTO recipe', { ...valid.buildRecipe, lto: 'thin' }],
  ['a split-codegen recipe', { ...valid.buildRecipe, codegenUnits: 16 }],
  ['an incremental recipe', { ...valid.buildRecipe, incremental: true }],
  ['a size-optimized recipe', { ...valid.buildRecipe, optLevel: 'z' }],
]) {
  test(`refuses ${name} at public-package assembly`, () => {
    const attempted = structuredClone(valid);
    if (recipe === undefined) delete attempted.buildRecipe;
    else attempted.buildRecipe = recipe;
    assert.throws(
      () => assertPublicPackageBuildIdentity(attempted),
      (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    );
  });
}

for (const [name, mutate] of [
  ['source-build substitution', (value) => { value.buildDistribution = 'contributor-source'; }],
  ['unknown distribution', (value) => { value.buildDistribution = 'candidate'; }],
  ['dirty binary', (value) => { value.binary.gitDirty = true; }],
  ['unknown source', (value) => { value.binary.gitCommit = 'unknown'; }],
  ['debug binary', (value) => { value.binary.buildProfile = 'debug'; }],
  ['tampered identity shape', (value) => { value.schemaVersion = 'snapback.binary-identity.v2'; }],
]) {
  test(`refuses ${name} before runtime package assembly`, () => {
    const attempted = structuredClone(valid);
    mutate(attempted);
    assert.throws(
      () => assertPublicPackageBuildIdentity(attempted),
      (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    );
  });
}

test('store receipt installation returns a discriminated result', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-package-authority-test-'));
  try {
    const sourceRoot = join(root, 'source');
    const binDirectory = join(root, 'package', 'bin');
    const sourceBinary = join(sourceRoot, 'snapback');
    const receiptPath = join(root, 'receipt.json');
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(sourceBinary, 'fixture binary');

    assert.deepEqual(
      installPackagedStoreQualificationReceipt({
        sourceBinary,
        binDirectory,
        receiptEnvironmentName: 'SNAPBACK_FIXTURE_RECEIPT',
        environment: {},
      }),
      { installed: false, reason: 'absent' },
    );

    writeFileSync(receiptPath, `${JSON.stringify({
      schemaVersion: 'snapback.packaged-store-qualification.v1',
    })}\n`);
    const installed = installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName: 'SNAPBACK_FIXTURE_RECEIPT',
      environment: { SNAPBACK_FIXTURE_RECEIPT: receiptPath },
    });
    assert.equal(installed.installed, true);
    assert.equal(installed.source, receiptPath);
    assert.equal(
      installed.destination,
      join(binDirectory, 'packaged-store-qualification.receipt.json'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('platform capability evidence is retained outside the installed runtime receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'runtime-package-capability-receipt-test-'));
  try {
    const sourceRoot = join(root, 'source');
    const binDirectory = join(root, 'package', 'bin');
    const sourceBinary = join(sourceRoot, 'snapback');
    const receiptPath = join(root, 'receipt.json');
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(sourceBinary, 'fixture binary');
    writeFileSync(receiptPath, `${JSON.stringify({
      schemaVersion: 'snapback.packaged-store-qualification.v1',
      capabilityId: 'single_table_v1',
      publicationCapabilityQualification: {
        schemaVersion: 'snapback.publication-capability-qualification.v1',
      },
    })}\n`);

    const installed = installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName: 'SNAPBACK_FIXTURE_RECEIPT',
      environment: { SNAPBACK_FIXTURE_RECEIPT: receiptPath },
    });
    const runtimeReceipt = JSON.parse(readFileSync(installed.destination, 'utf8'));
    assert.equal(runtimeReceipt.capabilityId, 'single_table_v1');
    assert.equal(
      Object.hasOwn(runtimeReceipt, 'publicationCapabilityQualification'),
      false,
      'the deny-unknown Rust receipt receives only its native schema',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
