import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE,
  PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION,
  RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  assertPublicPackageBuildIdentity,
} from '../../scripts/runtime-package-authority.mjs';
import { resolveRuntimeBinary } from '../snapback-cli/index.mjs';
import { writeAdminConsoleSnapshotManifest } from '../snapback-cli/admin-snapshot.mjs';
import { prepareDarwinRuntimePackage } from './prepare-runtime.mjs';
import {
  RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  RUNTIME_PACKAGE_LEGACY_CATALOG_PROOF_REASON,
  produceRuntimePackageSeal,
  verifyRuntimePackageSeal,
} from '../snapback-cli/runtime-readiness.mjs';

const PACKAGE_NAME = '@expo/snapback-runtime-darwin-arm64';
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, PACKAGE_NAME);
assert.deepEqual(manifest.os, ['darwin']);
assert.deepEqual(manifest.cpu, ['arm64']);
assert.deepEqual(manifest.files, ['README.md', 'admin', 'bin', 'Frameworks', 'include', 'runtime-readiness.json']);

const ignoreRules = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean);
assert.deepEqual(ignoreRules, ['/bin/', '/admin/', '/Frameworks/', '/include/', '/runtime-readiness.json']);

const sourceRevision = 'a'.repeat(40);
const buildIdentity = {
  schemaVersion: 'snapback.binary-identity.v1',
  binary: {
    crateVersion: '0.1.0',
    gitCommit: sourceRevision,
    gitDirty: false,
    buildProfile: 'release',
    startupNonce: 'build-identity-process',
  },
  buildDistribution: 'public-package',
};
const catalogBuildIdentityProof = {
  schemaVersion: 'snapback.runtime-catalog-build-identity-proof.v1',
  source: 'native-inspection',
  buildIdentity: { sourceCommit: sourceRevision, dirty: false },
};

function writeFixture(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

const sealRoot = mkdtempSync(join(tmpdir(), 'snapback-darwin-package-seal-'));
try {
  const binary = join(sealRoot, 'bin', 'snapback');
  const frameworkRoot = join(sealRoot, 'Frameworks', 'hermesvm.framework');
  const framework = join(frameworkRoot, 'Versions', '1', 'hermesvm');
  const frameworkAlias = join(frameworkRoot, 'hermesvm');
  const header = join(sealRoot, 'include', 'hermes', 'hermes.h.artifact');
  const binarySource = `#!/usr/bin/env node
if (process.argv[2] !== 'runtime-qualify') process.exit(2);
const ok = process.env.FIXTURE_QUALIFICATION_FAIL !== '1';
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1',
  probe: 'restricted-no-eval-handler-vm',
  ok,
  binary: {
    crateVersion: '0.1.0', gitCommit: '${sourceRevision}', gitDirty: false,
    buildProfile: 'release', startupNonce: 'qualification-process'
  },
  ...(ok ? {} : { diagnostic: { code: 'SNAPBACK_RUNTIME_CREATE_FAILED', message: 'fixture refusal' } })
}));
process.exit(ok ? 0 : 1);
`;
  writeFixture(binary, binarySource);
  chmodSync(binary, 0o755);
  writeFixture(framework, 'darwin Hermes runtime bytes');
  symlinkSync('Versions/1/hermesvm', frameworkAlias);
  writeFixture(header, 'darwin Hermes compile header bytes');
  const adminIndex = join(sealRoot, 'admin', 'index.html');
  writeFixture(adminIndex, '<title>Snapback Admin Console</title>');
  writeFixture(
    join(sealRoot, 'admin', '__exact', 'platform-manifest.json'),
    '{}\n',
  );
  writeAdminConsoleSnapshotManifest({
    root: join(sealRoot, 'admin'),
    sourceRevision,
    sourceDirty: false,
  });

  const receiptPath = join(sealRoot, 'runtime-readiness.json');
  assert.throws(
    () => produceRuntimePackageSeal({
      root: sealRoot,
      binaryPath: binary,
      packageName: PACKAGE_NAME,
      platform: 'darwin',
      architecture: 'arm64',
      buildIdentity,
      sourceRevision,
    }),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
  assert.equal(existsSync(receiptPath), false);
  assert.throws(
    () => produceRuntimePackageSeal({
      root: sealRoot,
      binaryPath: binary,
      packageName: PACKAGE_NAME,
      platform: 'darwin',
      architecture: 'arm64',
      buildIdentity,
      sourceRevision,
      catalogBuildIdentityProof: {
        ...catalogBuildIdentityProof,
        buildIdentity: { sourceCommit: 'b'.repeat(40), dirty: false },
      },
    }),
    (error) => error.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );
  assert.equal(existsSync(receiptPath), false);

  const sealed = produceRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
    buildIdentity,
    sourceRevision,
    catalogBuildIdentityProof,
  });
  assert.equal(sealed.receipt.qualification.report.schemaVersion, 'snapback.runtime-qualify.v1');
  assert.equal(sealed.receipt.qualification.report.ok, true);
  assert.equal(sealed.receipt.sourceRevision, sourceRevision);
  assert.equal(sealed.receipt.buildIdentity.buildDistribution, 'public-package');
  assert.equal(sealed.receipt.artifacts.length, 5);
  assert.deepEqual(
    sealed.receipt.artifacts.map((artifact) => artifact.path),
    [
      'include/hermes/hermes.h.artifact',
      'Frameworks/hermesvm.framework/Versions/1/hermesvm',
      'admin/__exact/platform-manifest.json',
      'admin/index.html',
      'admin/snapback-admin-snapshot.json',
    ],
  );

  // npm omits framework symlinks. Removing the pre-pack convenience alias
  // must leave an installed-package-shaped closure whose seal still opens.
  rmSync(frameworkAlias);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  }).ok, true);

  const originalReceipt = readFileSync(receiptPath, 'utf8');
  const mismatchedProofReceipt = JSON.parse(originalReceipt);
  mismatchedProofReceipt.catalogBuildIdentityProof.buildIdentity.sourceCommit = 'b'.repeat(40);
  writeFileSync(receiptPath, `${JSON.stringify(mismatchedProofReceipt, null, 2)}\n`);
  const mismatchedProof = verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(mismatchedProof.reason, 'catalog-build-identity-proof-drift');
  assert.equal(
    mismatchedProof.diagnostic.code,
    RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  );

  const legacyReceipt = JSON.parse(originalReceipt);
  delete legacyReceipt.catalogBuildIdentityProof;
  writeFileSync(receiptPath, `${JSON.stringify(legacyReceipt, null, 2)}\n`);
  const legacySeal = verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(legacySeal.ok, true);
  assert.equal(legacySeal.reason, RUNTIME_PACKAGE_LEGACY_CATALOG_PROOF_REASON);
  writeFileSync(receiptPath, originalReceipt);

  writeFileSync(framework, 'swapped Darwin Hermes runtime bytes');
  const frameworkDrift = verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(frameworkDrift.reason, 'framework-drift');
  assert.equal(frameworkDrift.diagnostic.details.custody, 'runtime-package');
  assert.equal(
    frameworkDrift.diagnostic.details.repairCommand,
    `reinstall ${PACKAGE_NAME} from the consumer project's lockfile`,
  );
  assert.equal(
    Object.hasOwn(frameworkDrift.diagnostic.details, 'requalifyCommand'),
    false,
  );
  writeFileSync(framework, 'darwin Hermes runtime bytes');
  writeFileSync(adminIndex, '<title>tampered admin</title>');
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  }).reason, 'admin-console-drift');
  writeFileSync(adminIndex, '<title>Snapback Admin Console</title>');
  writeFileSync(binary, `${binarySource}\n// swapped binary`);
  chmodSync(binary, 0o755);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  }).reason, 'binary-drift');

  rmSync(join(sealRoot, 'runtime-readiness.json'), { force: true });
  assert.throws(
    () => produceRuntimePackageSeal({
      root: sealRoot,
      binaryPath: binary,
      packageName: PACKAGE_NAME,
      platform: 'darwin',
      architecture: 'arm64',
      buildIdentity,
      sourceRevision,
      catalogBuildIdentityProof,
      environment: { ...process.env, FIXTURE_QUALIFICATION_FAIL: '1' },
    }),
    (error) => error.code === RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  );
  assert.equal(existsSync(join(sealRoot, 'runtime-readiness.json')), false);
} finally {
  rmSync(sealRoot, { recursive: true, force: true });
}

const assemblyRoot = mkdtempSync(join(tmpdir(), 'snapback-darwin-staged-assembly-'));
try {
  const packageRoot = join(assemblyRoot, 'package');
  const sourceRoot = join(assemblyRoot, 'source');
  const sourceBinary = join(sourceRoot, 'snapback');
  const sourceFramework = join(sourceRoot, 'hermesvm.framework');
  const sourceHeader = join(sourceRoot, 'hermes.h');
  const sourceAdmin = join(sourceRoot, 'admin');
  const sourceRevision = 'c'.repeat(40);
  const fixtureIdentity = {
    schemaVersion: 'snapback.binary-identity.v1',
    binary: {
      crateVersion: '0.1.0',
      gitCommit: sourceRevision,
      gitDirty: false,
      buildProfile: 'release',
      startupNonce: 'build-identity-process',
    },
    buildDistribution: 'contributor-source',
  };
  const fixtureBinarySourceFor = (
    identity,
    catalogBuildIdentity = {
      sourceCommit: identity.binary.gitCommit,
      dirty: identity.binary.gitDirty,
    },
  ) => {
    const catalog = {
      schemaVersion: 'snapback.control-catalog.v1',
      catalogDigest: `sha256:${'f'.repeat(64)}`,
      buildIdentity: catalogBuildIdentity,
      generatedAtCommit: sourceRevision,
      entries: [],
    };
    return `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'build-identity') {
  console.log(${JSON.stringify(JSON.stringify(identity))});
  process.exit(0);
}
if (command === 'controls' && process.argv[3] === 'list' && process.argv[4] === '--json') {
  console.log(${JSON.stringify(JSON.stringify(catalog))});
  process.exit(0);
}
if (command !== 'runtime-qualify') process.exit(2);
const ok = process.env.FIXTURE_QUALIFICATION_FAIL !== '1';
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1',
  probe: 'restricted-no-eval-handler-vm',
  ok,
  binary: ${JSON.stringify({
    ...identity.binary,
    startupNonce: 'qualification-process',
  })},
  ...(ok ? {} : { diagnostic: { code: 'SNAPBACK_RUNTIME_CREATE_FAILED', message: 'fixture refusal' } })
}));
process.exit(ok ? 0 : 1);
`;
  };
  const fixtureBinarySource = fixtureBinarySourceFor(fixtureIdentity);
  mkdirSync(packageRoot, { recursive: true });
  writeFixture(sourceBinary, fixtureBinarySource);
  chmodSync(sourceBinary, 0o755);
  writeFixture(
    join(sourceFramework, 'Versions', '1', 'hermesvm'),
    'candidate Darwin Hermes runtime bytes',
  );
  writeFixture(sourceHeader, 'candidate Darwin Hermes compile header bytes');
  writeFixture(join(sourceAdmin, 'index.html'), '<title>Candidate Admin Console</title>');
  writeFixture(join(sourceAdmin, '__exact', 'platform-manifest.json'), '{}\n');
  writeAdminConsoleSnapshotManifest({
    root: sourceAdmin,
    sourceRevision,
    sourceDirty: false,
  });

  const preparation = {
    packageRoot,
    sourceBinary,
    sourceFramework,
    sourceHermesHeader: sourceHeader,
    sourceAdminDist: sourceAdmin,
    args: ['--source-test-staging'],
    environment: { ...process.env, SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS: '1' },
    platform: 'darwin',
    architecture: 'arm64',
  };
  const prepared = prepareDarwinRuntimePackage(preparation);
  assert.deepEqual(prepared.identity, fixtureIdentity);
  const verifyAssembly = () => verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(packageRoot, 'bin', 'snapback'),
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(verifyAssembly().ok, true);
  let originalReceipt;
  const originalBinary = readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8');

  const receiptlessEnvironment = { ...process.env };
  delete receiptlessEnvironment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS;
  delete receiptlessEnvironment.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE;
  const receiptlessSourceTest = prepareDarwinRuntimePackage({
    ...preparation,
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    receiptlessSourceTest.identity,
    fixtureIdentity,
    'source-test staging must remain receiptless without an override',
  );

  const publicPackageIdentity = structuredClone(fixtureIdentity);
  publicPackageIdentity.buildDistribution = 'public-package';
  writeFileSync(sourceBinary, fixtureBinarySourceFor(publicPackageIdentity));
  chmodSync(sourceBinary, 0o755);
  const nativePrepared = prepareDarwinRuntimePackage({
    ...preparation,
    args: ['--native-artifact-staging'],
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    nativePrepared.identity,
    publicPackageIdentity,
    'native-artifact staging must remain receiptless without an override',
  );
  const nativeAssembly = verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(packageRoot, 'bin', 'snapback'),
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
    adminConsoleRequired: false,
  });
  assert.equal(nativeAssembly.ok, true);
  const nativeAssemblyReceipt = readFileSync(
    join(packageRoot, 'runtime-readiness.json'),
    'utf8',
  );

  assert.throws(
    () => prepareDarwinRuntimePackage({
      ...preparation,
      args: [],
      environment: receiptlessEnvironment,
    }),
    (error) => error.code === 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
    'final package assembly must not silently omit single_table_v1 evidence',
  );
  assert.equal(
    readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'),
    nativeAssemblyReceipt,
  );

  const packagedStoreReceipt = join(
    sourceRoot,
    PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE,
  );
  writeFixture(packagedStoreReceipt, `${JSON.stringify({
    schemaVersion: PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION,
  })}\n`);
  const finalPrepared = prepareDarwinRuntimePackage({
    ...preparation,
    args: [],
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    finalPrepared.identity,
    publicPackageIdentity,
    'final public-package assembly with a receipt must succeed without the override',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(
    existsSync(join(packageRoot, 'bin', PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE)),
    true,
  );
  rmSync(packagedStoreReceipt, { force: true });

  const debugDirtyIdentity = structuredClone(fixtureIdentity);
  debugDirtyIdentity.binary.gitDirty = true;
  debugDirtyIdentity.binary.buildProfile = 'debug';
  writeFileSync(sourceBinary, fixtureBinarySourceFor(debugDirtyIdentity));
  chmodSync(sourceBinary, 0o755);
  const sourceTestPrepared = prepareDarwinRuntimePackage(preparation);
  assert.deepEqual(sourceTestPrepared.identity, debugDirtyIdentity);
  assert.equal(verifyAssembly().ok, true);
  const sourceTestReceipt = readFileSync(
    join(packageRoot, 'runtime-readiness.json'),
    'utf8',
  );
  const sourceTestBinary = readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8');
  assert.throws(
    () => prepareDarwinRuntimePackage({
      ...preparation,
      args: [...preparation.args, '--strict-clean-release'],
    }),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
  );
  assert.equal(
    readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'),
    sourceTestReceipt,
  );
  assert.equal(
    readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8'),
    sourceTestBinary,
  );
  const mismatchedCatalogIdentity = {
    sourceCommit: 'd'.repeat(40),
    dirty: false,
  };
  writeFileSync(
    sourceBinary,
    fixtureBinarySourceFor(debugDirtyIdentity, mismatchedCatalogIdentity),
  );
  chmodSync(sourceBinary, 0o755);
  assert.throws(
    () => prepareDarwinRuntimePackage(preparation),
    (error) => error.code === 'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH',
  );
  assert.equal(
    readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'),
    sourceTestReceipt,
  );
  assert.equal(
    readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8'),
    sourceTestBinary,
  );
  // Source-test staging admits known-commit contributor debug/dirty builds,
  // but it must still reject the exact commitless identity produced when the
  // owning crate has no package-local build stamp.
  const unstampedIdentity = structuredClone(fixtureIdentity);
  unstampedIdentity.binary.gitCommit = 'unknown';
  unstampedIdentity.binary.gitDirty = true;
  writeFileSync(sourceBinary, fixtureBinarySourceFor(unstampedIdentity));
  chmodSync(sourceBinary, 0o755);
  assert.throws(
    () => prepareDarwinRuntimePackage(preparation),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(
    readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'),
    sourceTestReceipt,
  );
  assert.equal(
    readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8'),
    sourceTestBinary,
  );
  writeFileSync(sourceBinary, fixtureBinarySource);
  chmodSync(sourceBinary, 0o755);
  prepareDarwinRuntimePackage(preparation);
  originalReceipt = readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8');
  assert.equal(readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8'), originalBinary);

  assert.throws(
    () => prepareDarwinRuntimePackage({
      ...preparation,
      environment: {
        ...preparation.environment,
        FIXTURE_QUALIFICATION_FAIL: '1',
      },
    }),
    (error) => error.code === RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'), originalReceipt);
  assert.equal(readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8'), originalBinary);

  assert.throws(
    () => prepareDarwinRuntimePackage({
      ...preparation,
      sourceAdminDist: join(sourceRoot, 'missing-admin'),
    }),
    (error) => error.code === 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'), originalReceipt);
  assert.deepEqual(
    readdirSync(packageRoot).filter((name) => (
      name.startsWith('.staging-') || name.startsWith('.assembly-backup-')
    )),
    [],
  );
} finally {
  rmSync(assemblyRoot, { recursive: true, force: true });
}

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const binary = join(packageRoot, 'bin', 'snapback');
if (existsSync(binary)) {
  const seal = verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(seal.ok, true, JSON.stringify(seal.diagnostic));
  const identity = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(identity.status, 0, identity.stderr);
  assertPublicPackageBuildIdentity(JSON.parse(identity.stdout));
  // Passing a non-CLI package root models packed/installed custody and keeps
  // this package proof independent of the source checkout's release binary.
  assert.equal(
    resolveRuntimeBinary({ cliPackageRoot: packageRoot }).binary,
    binary,
  );
}
console.log('package.test.mjs: stamped assembly accepted; unstamped executable rejected; Darwin arm64 seal + custody repair pass');
