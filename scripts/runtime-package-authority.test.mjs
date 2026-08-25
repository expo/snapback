import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  assertPublicPackageBuildIdentity,
  assertRuntimeCatalogBuildIdentity,
  assertRuntimePackageBuildIdentity,
  assertRuntimePackageSourceIdentity,
  inspectRuntimeCatalogBuildIdentity,
  installPackagedStoreQualificationReceipt,
} from './runtime-package-authority.mjs';

const valid = {
  schemaVersion: 'snapback.binary-identity.v1',
  buildDistribution: PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
  binary: {
    crateVersion: '0.1.0',
    gitCommit: 'a'.repeat(40),
    gitDirty: false,
    buildProfile: 'release',
    startupNonce: 'fixture',
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
