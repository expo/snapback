import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicPackageBuildIdentity,
  installPackagedStoreQualificationReceipt,
} from '../../scripts/runtime-package-authority.mjs';
import { resolveRuntimeBinary } from '../snapback-cli/index.mjs';
import {
  createLinuxRuntimeArtifactAttestation,
  readLinuxRuntimeArtifactAttestation,
  readLinuxRuntimeBuildIdentity,
  validateLinuxRuntimeArtifactAttestation,
} from './artifact-attestation.mjs';
import {
  RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  produceRuntimePackageSeal,
  verifyRuntimePackageSeal,
} from '../snapback-cli/runtime-readiness.mjs';

const PACKAGE_NAME = '@expo/snapback-runtime-linux-x64';
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, PACKAGE_NAME);
assert.deepEqual(manifest.os, ['linux']);
assert.deepEqual(manifest.cpu, ['x64']);
assert.deepEqual(manifest.files, ['README.md', 'bin', 'lib', 'include', 'runtime-readiness.json']);

// @ref LLP 0041#runtime-distribution — prepared native payloads are package
// outputs, while the source-side package contract remains reviewable.
const ignoreRules = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean);
assert.deepEqual(ignoreRules, ['/bin/', '/lib/', '/include/', '/runtime-readiness.json']);

const receiptRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-package-receipt-'));
try {
  const receiptEnvironmentName =
    'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT';
  const sourceBinary = join(receiptRoot, 'source', 'snapback');
  const siblingReceipt = join(
    receiptRoot,
    'source',
    'packaged-store-qualification.receipt.json',
  );
  const explicitReceipt = join(receiptRoot, 'explicit-receipt.json');
  const binDirectory = join(receiptRoot, 'package', 'bin');
  const installedReceipt = join(
    binDirectory,
    'packaged-store-qualification.receipt.json',
  );
  const validReceiptBytes = `${JSON.stringify({
    schemaVersion: 'snapback.packaged-store-qualification.v1',
    fixture: 'preserve these exact bytes',
  }, null, 2)}\n`;
  const siblingReceiptBytes = `${JSON.stringify({
    schemaVersion: 'snapback.packaged-store-qualification.v1',
    fixture: 'sibling fallback',
  })}\n`;
  mkdirSync(join(receiptRoot, 'source'), { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(sourceBinary, 'fixture binary');

  writeFileSync(explicitReceipt, validReceiptBytes);
  writeFileSync(siblingReceipt, siblingReceiptBytes);
  installPackagedStoreQualificationReceipt({
    sourceBinary,
    binDirectory,
    receiptEnvironmentName,
    environment: { [receiptEnvironmentName]: explicitReceipt },
  });
  assert.equal(readFileSync(installedReceipt, 'utf8'), validReceiptBytes);

  rmSync(installedReceipt);
  installPackagedStoreQualificationReceipt({
    sourceBinary,
    binDirectory,
    receiptEnvironmentName,
    environment: {},
  });
  assert.equal(readFileSync(installedReceipt, 'utf8'), siblingReceiptBytes);

  rmSync(installedReceipt);
  rmSync(siblingReceipt);
  assert.deepEqual(
    installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName,
      environment: {},
    }),
    { installed: false, reason: 'absent' },
  );
  assert.equal(existsSync(installedReceipt), false);

  assert.throws(
    () => installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName,
      environment: { [receiptEnvironmentName]: join(receiptRoot, 'missing.json') },
    }),
    (error) => error.code
      === 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_UNREADABLE',
  );
  assert.equal(existsSync(installedReceipt), false);

  writeFileSync(explicitReceipt, '{invalid json');
  assert.throws(
    () => installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName,
      environment: { [receiptEnvironmentName]: explicitReceipt },
    }),
    (error) => error.code
      === 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
  );
  assert.equal(existsSync(installedReceipt), false);

  writeFileSync(explicitReceipt, '{"schemaVersion":"wrong"}\n');
  assert.throws(
    () => installPackagedStoreQualificationReceipt({
      sourceBinary,
      binDirectory,
      receiptEnvironmentName,
      environment: { [receiptEnvironmentName]: explicitReceipt },
    }),
    (error) => error.code
      === 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
  );
  assert.equal(existsSync(installedReceipt), false);
} finally {
  rmSync(receiptRoot, { recursive: true, force: true });
}

const attestationRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-attestation-'));
try {
  const sourceRevision = 'a'.repeat(40);
  const attestedBinary = join(attestationRoot, 'snapback');
  const attestedHermes = join(attestationRoot, 'libhermesvm.so');
  const attestedHermesHeader = join(attestationRoot, 'hermes.h');
  const attestationPath = join(attestationRoot, 'build-attestation.json');
  const cliAttestationPath = join(attestationRoot, 'cli-build-attestation.json');
  const identityPath = join(attestationRoot, 'build-identity.json');
  const attestedBinarySource = `#!/usr/bin/env node
if (process.argv[2] !== 'runtime-qualify') process.exit(2);
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1', probe: 'restricted-no-eval-handler-vm', ok: true,
  binary: {
    crateVersion: '0.1.0', gitCommit: '${sourceRevision}', gitDirty: false,
    buildProfile: 'release', startupNonce: 'qualification-process'
  }
}));
`;
  writeFileSync(attestedBinary, attestedBinarySource);
  chmodSync(attestedBinary, 0o755);
  writeFileSync(attestedHermes, 'linux-hermes-bytes');
  writeFileSync(attestedHermesHeader, 'linux-hermes-header-bytes');
  const buildIdentity = {
    schemaVersion: 'snapback.binary-identity.v1',
    binary: {
      crateVersion: '0.1.0',
      gitCommit: sourceRevision,
      gitDirty: false,
      buildProfile: 'release',
      startupNonce: '0198f865-9f71-7d7a-9bab-7ae3637b7d58',
    },
    buildDistribution: 'public-package',
  };
  writeFileSync(identityPath, `${JSON.stringify(buildIdentity)}\n`);
  assert.deepEqual(
    readLinuxRuntimeBuildIdentity(identityPath, sourceRevision),
    buildIdentity,
  );
  const attestation = createLinuxRuntimeArtifactAttestation({
    binaryPath: attestedBinary,
    hermesPath: attestedHermes,
    hermesHeaderPath: attestedHermesHeader,
    buildIdentity,
    qualificationVerdict: {
      schemaVersion: 'snapback.runtime-qualify.v1',
      probe: 'restricted-no-eval-handler-vm',
      ok: true,
      binary: {
        ...buildIdentity.binary,
        startupNonce: 'qualification-process',
      },
    },
    sourceRevision,
  });
  writeFileSync(attestationPath, `${JSON.stringify(attestation)}\n`);
  assert.deepEqual(
    validateLinuxRuntimeArtifactAttestation({
      attestation: readLinuxRuntimeArtifactAttestation(attestationPath),
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      sourceRevision,
    }),
    attestation,
  );
  const attestationCli = fileURLToPath(
    new URL('../../scripts/snapback-create-runtime-artifact-attestation.mjs', import.meta.url),
  );
  const created = spawnSync(process.execPath, [
    attestationCli,
    '--binary', attestedBinary,
    '--hermes', attestedHermes,
    '--hermes-header', attestedHermesHeader,
    '--identity', identityPath,
    '--source-revision', sourceRevision,
    '--out', cliAttestationPath,
  ], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  assert.deepEqual(
    readLinuxRuntimeArtifactAttestation(cliAttestationPath),
    attestation,
  );
  writeFileSync(attestedBinary, 'tampered-linux-runtime-bytes');
  assert.throws(
    () => validateLinuxRuntimeArtifactAttestation({
      attestation,
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      sourceRevision,
    }),
    /attestation digest drifted/u,
  );
  assert.throws(
    () => createLinuxRuntimeArtifactAttestation({
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      buildIdentity,
      qualificationVerdict: attestation.qualificationVerdict,
      sourceRevision: 'b'.repeat(40),
    }),
    /source revision drifted/u,
  );
} finally {
  rmSync(attestationRoot, { recursive: true, force: true });
}

const sealRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-package-seal-'));
try {
  const sourceRevision = 'b'.repeat(40);
  const sealedBinary = join(sealRoot, 'bin', 'snapback');
  const sealedHermes = join(sealRoot, 'lib', 'libhermesvm.so');
  const sealedHeader = join(sealRoot, 'include', 'hermes', 'hermes.h.artifact');
  mkdirSync(join(sealRoot, 'bin'), { recursive: true });
  mkdirSync(join(sealRoot, 'lib'), { recursive: true });
  mkdirSync(join(sealRoot, 'include', 'hermes'), { recursive: true });
  const binarySource = `#!/usr/bin/env node
if (process.argv[2] !== 'runtime-qualify') process.exit(2);
const ok = process.env.FIXTURE_QUALIFICATION_FAIL !== '1';
console.log(JSON.stringify({
  schemaVersion: 'snapback.runtime-qualify.v1', probe: 'restricted-no-eval-handler-vm', ok,
  binary: {
    crateVersion: '0.1.0', gitCommit: '${sourceRevision}', gitDirty: false,
    buildProfile: 'release', startupNonce: 'qualification-process'
  },
  ...(ok ? {} : { diagnostic: { code: 'SNAPBACK_RUNTIME_CREATE_FAILED', message: 'fixture refusal' } })
}));
process.exit(ok ? 0 : 1);
`;
  writeFileSync(sealedBinary, binarySource);
  chmodSync(sealedBinary, 0o755);
  writeFileSync(sealedHermes, 'sealed Linux Hermes bytes');
  writeFileSync(sealedHeader, 'sealed Linux Hermes header bytes');
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
  const sealed = produceRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
    buildIdentity,
    sourceRevision,
  });
  assert.equal(sealed.receipt.qualification.report.schemaVersion, 'snapback.runtime-qualify.v1');
  assert.equal(sealed.receipt.qualification.report.ok, true);
  assert.equal(sealed.receipt.sourceRevision, sourceRevision);
  assert.equal(sealed.receipt.artifacts.length, 2);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).ok, true);

  writeFileSync(sealedHermes, 'swapped Linux Hermes bytes');
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).reason, 'framework-drift');
  writeFileSync(sealedHermes, 'sealed Linux Hermes bytes');
  writeFileSync(sealedBinary, `${binarySource}\n// swapped binary`);
  chmodSync(sealedBinary, 0o755);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).reason, 'binary-drift');

  rmSync(join(sealRoot, 'runtime-readiness.json'), { force: true });
  assert.throws(
    () => produceRuntimePackageSeal({
      root: sealRoot,
      binaryPath: sealedBinary,
      packageName: PACKAGE_NAME,
      platform: 'linux',
      architecture: 'x64',
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

const binary = fileURLToPath(new URL('./bin/snapback', import.meta.url));
const hermes = fileURLToPath(new URL('./lib/libhermesvm.so', import.meta.url));
if (existsSync(binary) || existsSync(hermes)) {
  assert.equal(existsSync(binary), true, 'prepared package must contain the binary');
  assert.equal(existsSync(hermes), true, 'prepared package must contain libhermesvm.so');
  const environment = { ...process.env };
  delete environment.LD_LIBRARY_PATH;
  const launched = spawnSync(binary, ['--help'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(
    launched.status,
    0,
    `packaged Linux binary must launch via its loader-relative rpath: ${launched.stderr}`,
  );
  const identity = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    env: environment,
    timeout: 15_000,
  });
  assert.equal(identity.status, 0, identity.stderr);
  assertPublicPackageBuildIdentity(JSON.parse(identity.stdout));
  const packageRoot = fileURLToPath(new URL('.', import.meta.url));
  const seal = verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  });
  assert.equal(seal.ok, true, JSON.stringify(seal.diagnostic));
  assert.equal(resolveRuntimeBinary().binary, binary);
}
console.log('package.test.mjs: Linux x64 seal verdict + framework-drift + binary-drift + qualification refusal pass');
