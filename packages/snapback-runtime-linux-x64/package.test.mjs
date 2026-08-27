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
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE,
  PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION,
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
  assertLinuxPackagePortability,
  LINUX_PORTABLE_HOST_SONAMES,
  readElfDynamicInfo,
  verifyLinuxPackagePortability,
} from './elf-portability.mjs';
import { prepareLinuxRuntimePackage } from './prepare-runtime.mjs';
import {
  RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  produceRuntimePackageSeal,
  verifyRuntimePackageSeal,
} from '../snapback-cli/runtime-readiness.mjs';
import { writeAdminConsoleSnapshotManifest } from '../snapback-cli/admin-snapshot.mjs';

const PACKAGE_NAME = '@expo/snapback-runtime-linux-x64';
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
assert.equal(manifest.name, PACKAGE_NAME);
assert.deepEqual(manifest.os, ['linux']);
assert.deepEqual(manifest.cpu, ['x64']);
assert.deepEqual(manifest.files, ['README.md', 'admin', 'bin', 'lib', 'include', 'runtime-readiness.json']);

// @ref LLP 0041#runtime-distribution — prepared native payloads are package
// outputs, while the source-side package contract remains reviewable.
const ignoreRules = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8')
  .split(/\r?\n/u)
  .filter(Boolean);
assert.deepEqual(ignoreRules, ['/bin/', '/admin/', '/lib/', '/include/', '/runtime-readiness.json']);
assert.equal(Object.isFrozen(LINUX_PORTABLE_HOST_SONAMES), true);
assert.deepEqual([...LINUX_PORTABLE_HOST_SONAMES], [
  'ld-linux-x86-64.so.2',
  'libc.so.6',
  'libm.so.6',
  'libpthread.so.0',
  'libdl.so.2',
  'librt.so.1',
  'libresolv.so.2',
  'libutil.so.1',
  'libgcc_s.so.1',
  'libstdc++.so.6',
]);

function syntheticElf64({
  machine = 62,
  needed = [],
  soname = null,
  rpath = null,
  runpath = null,
} = {}) {
  const stringChunks = [Buffer.from([0])];
  const stringOffsets = new Map();
  let stringBytes = 1;
  const addString = (value) => {
    if (stringOffsets.has(value)) return stringOffsets.get(value);
    const offset = stringBytes;
    const bytes = Buffer.from(`${value}\0`);
    stringChunks.push(bytes);
    stringOffsets.set(value, offset);
    stringBytes += bytes.byteLength;
    return offset;
  };
  const tags = needed.map((value) => [1n, addString(value)]);
  if (soname !== null) tags.push([14n, addString(soname)]);
  if (rpath !== null) tags.push([15n, addString(rpath)]);
  if (runpath !== null) tags.push([29n, addString(runpath)]);
  tags.push([0n, 0]);

  const sectionTableOffset = 64;
  const dynamicOffset = sectionTableOffset + (2 * 64);
  const dynamicBytes = tags.length * 16;
  const stringTableOffset = dynamicOffset + dynamicBytes;
  const stringTable = Buffer.concat(stringChunks);
  const bytes = Buffer.alloc(stringTableOffset + stringTable.byteLength);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  bytes.writeUInt16LE(3, 16);
  bytes.writeUInt16LE(machine, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(BigInt(sectionTableOffset), 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(2, 60);
  bytes.writeUInt16LE(1, 62);

  bytes.writeUInt32LE(6, sectionTableOffset + 4);
  bytes.writeBigUInt64LE(BigInt(dynamicOffset), sectionTableOffset + 24);
  bytes.writeBigUInt64LE(BigInt(dynamicBytes), sectionTableOffset + 32);
  bytes.writeUInt32LE(1, sectionTableOffset + 40);
  bytes.writeBigUInt64LE(8n, sectionTableOffset + 48);
  bytes.writeBigUInt64LE(16n, sectionTableOffset + 56);

  const stringSectionOffset = sectionTableOffset + 64;
  bytes.writeUInt32LE(3, stringSectionOffset + 4);
  bytes.writeBigUInt64LE(BigInt(stringTableOffset), stringSectionOffset + 24);
  bytes.writeBigUInt64LE(BigInt(stringTable.byteLength), stringSectionOffset + 32);
  bytes.writeBigUInt64LE(1n, stringSectionOffset + 48);

  for (const [index, [tag, value]] of tags.entries()) {
    bytes.writeBigInt64LE(tag, dynamicOffset + (index * 16));
    bytes.writeBigUInt64LE(BigInt(value), dynamicOffset + (index * 16) + 8);
  }
  stringTable.copy(bytes, stringTableOffset);
  return bytes;
}

const elfRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-elf-portability-'));
try {
  const binaryPath = join(elfRoot, 'bin', 'snapback');
  const libDirectory = join(elfRoot, 'lib');
  const bundledIcu = join(libDirectory, 'libicuuc.so.78');
  mkdirSync(join(elfRoot, 'bin'), { recursive: true });
  mkdirSync(libDirectory, { recursive: true });

  writeFileSync(binaryPath, syntheticElf64({
    needed: ['libc.so.6', 'libm.so.6'],
    rpath: '$ORIGIN/../lib',
  }));
  assert.deepEqual(readElfDynamicInfo(binaryPath), {
    machine: 62,
    needed: ['libc.so.6', 'libm.so.6'],
    soname: null,
    rpath: ['$ORIGIN/../lib'],
    runpath: [],
  });
  assert.deepEqual(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }),
    { ok: true, violations: [] },
  );

  writeFileSync(binaryPath, syntheticElf64({
    needed: ['libicuuc.so.78'],
    rpath: '$ORIGIN/../lib',
  }));
  assert(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }).violations
      .some((violation) => violation.includes('libicuuc.so.78')),
  );
  writeFileSync(bundledIcu, 'bundled ICU fixture');
  assert.deepEqual(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }),
    { ok: true, violations: [] },
  );
  rmSync(bundledIcu);

  writeFileSync(binaryPath, syntheticElf64({
    needed: ['libc.so.6'],
    runpath: '$ORIGIN/../lib',
  }));
  assert(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }).violations
      .some((violation) => violation.includes('DT_RUNPATH')),
  );

  writeFileSync(binaryPath, syntheticElf64({ needed: ['libc.so.6'] }));
  assert(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }).violations
      .some((violation) => violation.includes('missing DT_RPATH')),
  );

  writeFileSync(binaryPath, syntheticElf64({
    needed: ['libicuuc.so.78'],
    rpath: '$ORIGIN/../lib',
  }));
  writeFileSync(bundledIcu, syntheticElf64({
    needed: ['libc.so.6'],
    runpath: '$ORIGIN',
  }));
  assert(
    verifyLinuxPackagePortability({ binaryPath, libDirectory }).violations
      .some((violation) => violation.includes('bundled ELF carrying DT_RUNPATH')),
  );
  rmSync(bundledIcu);

  writeFileSync(binaryPath, syntheticElf64({
    machine: 183,
    needed: ['libc.so.6'],
    rpath: '$ORIGIN/../lib',
  }));
  const wrongMachine = verifyLinuxPackagePortability({ binaryPath, libDirectory });
  assert(wrongMachine.violations.some((violation) => violation.includes('e_machine 183')));
  assert.throws(
    () => assertLinuxPackagePortability({ binaryPath, libDirectory }),
    (error) => error.code === 'SNAPBACK_RUNTIME_LINUX_PORTABILITY_VIOLATION',
  );
} finally {
  rmSync(elfRoot, { recursive: true, force: true });
}

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
  const cliBundledAttestationPath = join(
    attestationRoot,
    'cli-bundled-build-attestation.json',
  );
  const identityPath = join(attestationRoot, 'build-identity.json');
  const bundledLibsDirectory = join(attestationRoot, 'bundled-libs');
  const bundledIcu = join(bundledLibsDirectory, 'libicuuc.so.78');
  const catalogBuildIdentity = {
    sourceCommit: sourceRevision,
    dirty: false,
  };
  const attestedBinarySource = `#!/usr/bin/env node
if (process.argv[2] === 'controls' && process.argv[3] === 'list' && process.argv[4] === '--json') {
  console.log(JSON.stringify({
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: { sourceCommit: '${sourceRevision}', dirty: false }
  }));
  process.exit(0);
}
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
  mkdirSync(bundledLibsDirectory, { recursive: true });
  writeFileSync(bundledIcu, 'linux-icu-bytes');
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
  const unstampedBuildIdentity = structuredClone(buildIdentity);
  unstampedBuildIdentity.binary.gitCommit = 'unknown';
  unstampedBuildIdentity.binary.gitDirty = true;
  writeFileSync(identityPath, `${JSON.stringify(unstampedBuildIdentity)}\n`);
  assert.throws(
    () => readLinuxRuntimeBuildIdentity(identityPath, sourceRevision),
    (error) => error.code === 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
  );
  writeFileSync(identityPath, `${JSON.stringify(buildIdentity)}\n`);
  const attestation = createLinuxRuntimeArtifactAttestation({
    binaryPath: attestedBinary,
    hermesPath: attestedHermes,
    hermesHeaderPath: attestedHermesHeader,
    buildIdentity,
    catalogBuildIdentity,
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
    bundledLibraries: [],
  });
  assert.equal(attestation.schemaVersion, 'snapback.runtime-artifact-attestation.v4');
  assert.deepEqual(attestation.catalogBuildIdentity, catalogBuildIdentity);
  assert.deepEqual(attestation.bundledLibrariesSha256, {});
  assert.throws(
    () => createLinuxRuntimeArtifactAttestation({
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      buildIdentity,
      catalogBuildIdentity: { sourceCommit: 'b'.repeat(40), dirty: false },
      qualificationVerdict: attestation.qualificationVerdict,
      sourceRevision,
      bundledLibraries: [],
    }),
    (error) => error.code === 'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH',
  );
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
  const bundledAttestation = createLinuxRuntimeArtifactAttestation({
    binaryPath: attestedBinary,
    hermesPath: attestedHermes,
    hermesHeaderPath: attestedHermesHeader,
    buildIdentity,
    catalogBuildIdentity,
    qualificationVerdict: attestation.qualificationVerdict,
    sourceRevision,
    bundledLibraries: [{ soname: 'libicuuc.so.78', path: bundledIcu }],
  });
  assert.match(
    bundledAttestation.bundledLibrariesSha256['libicuuc.so.78'],
    /^[0-9a-f]{64}$/u,
  );
  assert.deepEqual(
    validateLinuxRuntimeArtifactAttestation({
      attestation: bundledAttestation,
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      sourceRevision,
      bundledLibsDirectory,
    }),
    bundledAttestation,
  );
  assert.throws(
    () => validateLinuxRuntimeArtifactAttestation({
      attestation: bundledAttestation,
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      sourceRevision,
      bundledLibsDirectory: null,
    }),
    /requires a bundled libraries directory/u,
  );
  writeFileSync(bundledIcu, 'tampered-linux-icu-bytes');
  assert.throws(
    () => validateLinuxRuntimeArtifactAttestation({
      attestation: bundledAttestation,
      binaryPath: attestedBinary,
      hermesPath: attestedHermes,
      hermesHeaderPath: attestedHermesHeader,
      sourceRevision,
      bundledLibsDirectory,
    }),
    /attestation digest drifted/u,
  );
  writeFileSync(bundledIcu, 'linux-icu-bytes');
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
  const createdWithBundledLibraries = spawnSync(process.execPath, [
    attestationCli,
    '--binary', attestedBinary,
    '--hermes', attestedHermes,
    '--hermes-header', attestedHermesHeader,
    '--identity', identityPath,
    '--source-revision', sourceRevision,
    '--bundled-libs-dir', bundledLibsDirectory,
    '--out', cliBundledAttestationPath,
  ], { encoding: 'utf8' });
  assert.equal(
    createdWithBundledLibraries.status,
    0,
    createdWithBundledLibraries.stderr,
  );
  assert.deepEqual(
    readLinuxRuntimeArtifactAttestation(cliBundledAttestationPath),
    bundledAttestation,
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
      catalogBuildIdentity,
      qualificationVerdict: attestation.qualificationVerdict,
      sourceRevision: 'b'.repeat(40),
      bundledLibraries: [],
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
  const adminIndex = join(sealRoot, 'admin', 'index.html');
  mkdirSync(join(sealRoot, 'admin', '__exact'), { recursive: true });
  writeFileSync(adminIndex, '<title>Snapback Admin Console</title>');
  writeFileSync(join(sealRoot, 'admin', '__exact', 'platform-manifest.json'), '{}\n');
  writeAdminConsoleSnapshotManifest({
    root: join(sealRoot, 'admin'),
    sourceRevision,
    sourceDirty: false,
  });
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
  const sealed = produceRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
    buildIdentity,
    sourceRevision,
    catalogBuildIdentityProof,
  });
  assert.equal(sealed.receipt.qualification.report.schemaVersion, 'snapback.runtime-qualify.v1');
  assert.equal(sealed.receipt.qualification.report.ok, true);
  assert.equal(sealed.receipt.sourceRevision, sourceRevision);
  assert.equal(sealed.receipt.artifacts.length, 5);
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
  writeFileSync(adminIndex, '<title>tampered admin</title>');
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).reason, 'admin-console-drift');
  writeFileSync(adminIndex, '<title>Snapback Admin Console</title>');
  writeFileSync(sealedBinary, `${binarySource}\n// swapped binary`);
  chmodSync(sealedBinary, 0o755);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).reason, 'binary-drift');

  writeFileSync(sealedBinary, binarySource);
  chmodSync(sealedBinary, 0o755);
  const extraBundledLibrary = join(sealRoot, 'lib', 'libicuuc.so.78');
  writeFileSync(extraBundledLibrary, 'extra bundled library bytes');
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).reason, 'framework-drift');
  rmSync(extraBundledLibrary);
  assert.equal(verifyRuntimePackageSeal({
    root: sealRoot,
    binaryPath: sealedBinary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  }).ok, true);

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
      catalogBuildIdentityProof,
      environment: { ...process.env, FIXTURE_QUALIFICATION_FAIL: '1' },
    }),
    (error) => error.code === RUNTIME_PACKAGE_QUALIFICATION_FAILED_CODE,
  );
  assert.equal(existsSync(join(sealRoot, 'runtime-readiness.json')), false);
} finally {
  rmSync(sealRoot, { recursive: true, force: true });
}

const assemblyRoot = mkdtempSync(join(tmpdir(), 'snapback-linux-staged-assembly-'));
try {
  const packageRoot = join(assemblyRoot, 'package');
  const sourceRoot = join(assemblyRoot, 'source');
  const sourceBinary = join(sourceRoot, 'snapback');
  const sourceHermes = join(sourceRoot, 'libhermesvm.so');
  const sourceHeader = join(sourceRoot, 'hermes.h');
  const sourceAttestation = join(sourceRoot, 'build-attestation.json');
  const sourceAdmin = join(sourceRoot, 'admin');
  const sourceRevision = 'e'.repeat(40);
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
  const qualificationVerdict = {
    schemaVersion: 'snapback.runtime-qualify.v1',
    probe: 'restricted-no-eval-handler-vm',
    ok: true,
    binary: {
      ...buildIdentity.binary,
      startupNonce: 'qualification-process',
    },
  };
  const catalogBuildIdentity = {
    sourceCommit: sourceRevision,
    dirty: false,
  };
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(sourceBinary, syntheticElf64({
    needed: ['libc.so.6'],
    rpath: '$ORIGIN/../lib',
  }));
  writeFileSync(sourceHermes, syntheticElf64({
    needed: ['libc.so.6'],
    soname: 'libhermesvm.so',
  }));
  writeFileSync(sourceHeader, 'candidate Linux Hermes header bytes');
  writeFileSync(sourceAttestation, `${JSON.stringify(createLinuxRuntimeArtifactAttestation({
    binaryPath: sourceBinary,
    hermesPath: sourceHermes,
    hermesHeaderPath: sourceHeader,
    buildIdentity,
    catalogBuildIdentity,
    qualificationVerdict,
    sourceRevision,
    bundledLibraries: [],
  }))}\n`);
  mkdirSync(join(sourceAdmin, '__exact'), { recursive: true });
  writeFileSync(join(sourceAdmin, 'index.html'), '<title>Candidate Admin Console</title>');
  writeFileSync(join(sourceAdmin, '__exact', 'platform-manifest.json'), '{}\n');
  writeAdminConsoleSnapshotManifest({
    root: sourceAdmin,
    sourceRevision,
    sourceDirty: false,
  });

  const preparation = {
    packageRoot,
    sourceBinary,
    sourceHermes,
    sourceHermesHeader: sourceHeader,
    sourceAttestation,
    sourceRevision,
    sourceAdminDist: sourceAdmin,
    args: ['--source-test-staging'],
    environment: { ...process.env, SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS: '1' },
    platform: 'darwin',
    architecture: 'arm64',
  };
  prepareLinuxRuntimePackage(preparation);
  const verifyAssembly = () => verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(packageRoot, 'bin', 'snapback'),
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  });
  assert.equal(verifyAssembly().ok, true);
  const allowOverrideReceipt = readFileSync(
    join(packageRoot, 'runtime-readiness.json'),
    'utf8',
  );
  assert.deepEqual(
    JSON.parse(allowOverrideReceipt).catalogBuildIdentityProof,
    {
      schemaVersion: 'snapback.runtime-catalog-build-identity-proof.v1',
      source: 'snapback.runtime-artifact-attestation.v4',
      buildIdentity: catalogBuildIdentity,
    },
  );

  const receiptlessEnvironment = { ...process.env };
  delete receiptlessEnvironment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS;
  delete receiptlessEnvironment.SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT;
  const receiptlessSourceTest = prepareLinuxRuntimePackage({
    ...preparation,
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    receiptlessSourceTest.identity,
    buildIdentity,
    'source-test staging must remain receiptless without an override',
  );

  const nativePrepared = prepareLinuxRuntimePackage({
    ...preparation,
    args: ['--native-artifact-staging'],
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    nativePrepared.identity,
    buildIdentity,
    'native-artifact staging must remain receiptless without an override',
  );
  const nativeAssembly = verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(packageRoot, 'bin', 'snapback'),
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
    adminConsoleRequired: false,
  });
  assert.equal(nativeAssembly.ok, true);
  const nativeAssemblyReceipt = readFileSync(
    join(packageRoot, 'runtime-readiness.json'),
    'utf8',
  );

  assert.throws(
    () => prepareLinuxRuntimePackage({
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
  writeFileSync(packagedStoreReceipt, `${JSON.stringify({
    schemaVersion: PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION,
  })}\n`);
  const finalPrepared = prepareLinuxRuntimePackage({
    ...preparation,
    args: [],
    environment: receiptlessEnvironment,
  });
  assert.deepEqual(
    finalPrepared.identity,
    buildIdentity,
    'final public-package assembly with a receipt must succeed without the override',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(
    existsSync(join(packageRoot, 'bin', PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE)),
    true,
  );
  const originalReceipt = readFileSync(
    join(packageRoot, 'runtime-readiness.json'),
    'utf8',
  );
  rmSync(packagedStoreReceipt, { force: true });

  // Same-host Linux preparation must execute the binary's catalog projection,
  // just as the Darwin preparer does, before any staged package can replace
  // the previously sealed assembly.
  assert.throws(
    () => prepareLinuxRuntimePackage({
      ...preparation,
      platform: 'linux',
      architecture: 'x64',
      runBinary: (_command, commandArgs) => {
        if (commandArgs[0] === 'build-identity') {
          return { status: 0, stdout: JSON.stringify(buildIdentity), stderr: '' };
        }
        if (commandArgs.join(' ') === 'controls list --json') {
          return {
            status: 0,
            stdout: JSON.stringify({
              schemaVersion: 'snapback.control-catalog.v1',
              buildIdentity: { sourceCommit: 'd'.repeat(40), dirty: false },
            }),
            stderr: '',
          };
        }
        throw new Error(`unexpected fixture command: ${commandArgs.join(' ')}`);
      },
    }),
    (error) => error.code === 'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'), originalReceipt);

  assert.throws(
    () => prepareLinuxRuntimePackage({
      ...preparation,
      sourceAdminDist: join(sourceRoot, 'missing-admin'),
    }),
    (error) => error.code === 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.equal(readFileSync(join(packageRoot, 'runtime-readiness.json'), 'utf8'), originalReceipt);

  const nonPortableBinary = join(sourceRoot, 'snapback-non-portable');
  const nonPortableAttestation = join(sourceRoot, 'non-portable-attestation.json');
  writeFileSync(nonPortableBinary, syntheticElf64({ needed: ['libc.so.6'] }));
  writeFileSync(nonPortableAttestation, `${JSON.stringify(createLinuxRuntimeArtifactAttestation({
    binaryPath: nonPortableBinary,
    hermesPath: sourceHermes,
    hermesHeaderPath: sourceHeader,
    buildIdentity,
    catalogBuildIdentity,
    qualificationVerdict,
    sourceRevision,
    bundledLibraries: [],
  }))}\n`);
  assert.throws(
    () => prepareLinuxRuntimePackage({
      ...preparation,
      sourceBinary: nonPortableBinary,
      sourceAttestation: nonPortableAttestation,
    }),
    (error) => error.code === 'SNAPBACK_RUNTIME_LINUX_PORTABILITY_VIOLATION',
  );
  assert.equal(verifyAssembly().ok, true);
  assert.deepEqual(
    readdirSync(packageRoot).filter((name) => (
      name.startsWith('.staging-') || name.startsWith('.assembly-backup-')
    )),
    [],
  );
} finally {
  rmSync(assemblyRoot, { recursive: true, force: true });
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
  assertLinuxPackagePortability({
    binaryPath: binary,
    libDirectory: join(packageRoot, 'lib'),
  });
  const seal = verifyRuntimePackageSeal({
    root: packageRoot,
    binaryPath: binary,
    packageName: PACKAGE_NAME,
    platform: 'linux',
    architecture: 'x64',
  });
  assert.equal(seal.ok, true, JSON.stringify(seal.diagnostic));
  const sealedArtifactPaths = new Set(
    seal.receipt.artifacts.map((artifact) => artifact.path),
  );
  for (const name of readdirSync(join(packageRoot, 'lib')).sort()) {
    if (statSync(join(packageRoot, 'lib', name)).isFile()) {
      assert(sealedArtifactPaths.has(`lib/${name}`));
    }
  }
  // The repository-linked CLI and an installed CLI are distinct custody
  // shapes. The former must reopen the release binary's sibling source
  // receipt; the latter must independently reopen this package-owned seal.
  // @ref LLP 0010#native-runtime-bootstrap — source-checkout resolution never
  // accepts a package seal in place of the sibling release-binary receipt.
  const sourceRuntime = resolveRuntimeBinary();
  assert.equal(
    sourceRuntime.binary,
    fileURLToPath(new URL('../../target/release/snapback', import.meta.url)),
  );
  assert.equal(sourceRuntime.source, 'source-checkout');

  // Passing a non-CLI package root models the topology of a packed/installed
  // CLI, which has no owning source checkout and must select the sealed
  // platform package.
  // @ref LLP 0123#package-seal-landing-2026-08-06 — installed resolution
  // reopens the immutable package-owned seal before returning the binary.
  const installedRuntime = resolveRuntimeBinary({ cliPackageRoot: packageRoot });
  assert.equal(installedRuntime.binary, binary);
  assert.equal(installedRuntime.source, PACKAGE_NAME);
}
console.log('package.test.mjs: Linux x64 portability + attestation v4 + non-destructive staged assembly pass');
