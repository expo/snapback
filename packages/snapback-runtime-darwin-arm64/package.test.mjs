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

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';
import { resolveRuntimeBinary } from '../snapback-cli/index.mjs';
import { writeAdminConsoleSnapshotManifest } from '../snapback-cli/admin-snapshot.mjs';
import { prepareDarwinRuntimePackage } from './prepare-runtime.mjs';
import {
  RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
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

  const sealed = produceRuntimePackageSeal({
    root: sealRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
    buildIdentity,
    sourceRevision,
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
    buildDistribution: 'public-package',
  };
  const fixtureBinarySource = `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'build-identity') {
  console.log(${JSON.stringify(JSON.stringify(fixtureIdentity))});
  process.exit(0);
}
if (command !== 'runtime-qualify') process.exit(2);
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
  prepareDarwinRuntimePackage(preparation);
  const verifyAssembly = () => verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(packageRoot, 'bin', 'snapback'),
    packageName: PACKAGE_NAME,
    platform: 'darwin',
    architecture: 'arm64',
  });
  assert.equal(verifyAssembly().ok, true);
  const originalReceipt = readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8');
  const originalBinary = readFileSync(join(packageRoot, 'bin', 'snapback'), 'utf8');

  // The source-test seam bypasses only the public-package distribution class;
  // it must still reject an executable whose owning crate emitted no commit or
  // clean-tree stamp. This is the exact identity shape produced when
  // `binary_identity()` is compiled in a crate without its build contract.
  const unstampedBinary = join(sourceRoot, 'snapback-unstamped');
  const unstampedIdentity = {
    ...fixtureIdentity,
    binary: {
      ...fixtureIdentity.binary,
      gitCommit: 'unknown',
      gitDirty: true,
    },
    buildDistribution: 'contributor-source',
  };
  writeFixture(unstampedBinary, `#!/usr/bin/env node
const command = process.argv[2];
if (command === 'build-identity') {
  console.log(${JSON.stringify(JSON.stringify(unstampedIdentity))});
  process.exit(0);
}
if (command === 'runtime-qualify') {
  console.log(JSON.stringify({
    schemaVersion: 'snapback.runtime-qualify.v1',
    probe: 'restricted-no-eval-handler-vm',
    ok: true,
    binary: ${JSON.stringify(unstampedIdentity.binary)},
  }));
  process.exit(0);
}
process.exit(2);
`);
  chmodSync(unstampedBinary, 0o755);
  assert.throws(
    () => prepareDarwinRuntimePackage({
      ...preparation,
      sourceBinary: unstampedBinary,
      args: ['--source-test-staging', '--native-artifact-staging'],
    }),
    (error) => error.code === 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'), originalReceipt);
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
  assert.equal(resolveRuntimeBinary().binary, binary);
}
console.log('package.test.mjs: stamped assembly accepted; unstamped executable rejected; Darwin arm64 seal + custody repair pass');
