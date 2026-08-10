#!/usr/bin/env node

// @ref LLP 0041#runtime-distribution — assemble one relocatable Linux native
// package from a bootstrapped release binary and its Hermes shared library;
// never compile Hermes during npm installation.

import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicPackageBuildIdentity,
  installPackagedStoreQualificationReceipt,
} from '../../scripts/runtime-package-authority.mjs';
import { installAdminConsoleSnapshot } from '../snapback-cli/admin-snapshot.mjs';
import {
  readLinuxRuntimeArtifactAttestation,
  validateLinuxRuntimeArtifactAttestation,
} from './artifact-attestation.mjs';
import {
  assertLinuxPackagePortability,
  bundleLinuxRuntimeSharedLibraries,
} from './elf-portability.mjs';
import { produceRuntimePackageSeal } from '../snapback-cli/runtime-readiness.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const explicitBinary = process.env.SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY;
const explicitHermes = process.env.SNAPBACK_RUNTIME_LINUX_X64_HERMES_LIBRARY;
const explicitHermesHeader =
  process.env.SNAPBACK_RUNTIME_LINUX_X64_HERMES_HEADER;
const explicitAttestation =
  process.env.SNAPBACK_RUNTIME_LINUX_X64_BUILD_ATTESTATION;
const explicitRevision =
  process.env.SNAPBACK_RUNTIME_LINUX_X64_SOURCE_REVISION;
const explicitBundledLibsDir =
  process.env.SNAPBACK_RUNTIME_LINUX_X64_BUNDLED_LIBS_DIR;
const sourceBinary = resolve(
  explicitBinary ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
const sourceHermes = resolve(
  explicitHermes ?? join(repositoryRoot, 'vendor', 'ibex', 'linux', 'lib', 'libhermesvm.so'),
);
const sourceHermesHeader = resolve(
  explicitHermesHeader
    ?? join(repositoryRoot, 'vendor', 'ibex', 'linux', 'hermes-headers', 'hermes', 'hermes.h'),
);
const sourceAdminDist = resolve(repositoryRoot, 'admin-ui', 'dist');

function fail(code, message) {
  console.error(`${code}: ${message}`);
  process.exit(1);
}

function elfMachine(path) {
  const descriptor = openSync(path, 'r');
  try {
    const header = Buffer.alloc(20);
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length
        || header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') {
      return null;
    }
    const littleEndian = header[5] === 1;
    return littleEndian ? header.readUInt16LE(18) : header.readUInt16BE(18);
  } finally {
    closeSync(descriptor);
  }
}

// Native preparation is the default on Linux. A release job may assemble the
// package on another host only when it supplies both explicit CI artifacts;
// their ELF headers remain the authority, not the packaging host.
const crossHost = process.platform !== 'linux' || process.arch !== 'x64';
if (
  crossHost
  && !(
    explicitBinary
    && explicitHermes
    && explicitHermesHeader
    && explicitAttestation
    && explicitRevision
  )
) {
  fail(
    'SNAPBACK_IBEX_HOST_UNSUPPORTED',
    'runtime-linux-x64 requires a linux-x64 host or explicit Linux binary, '
      + 'Hermes library/header, build-attestation, and source-revision artifacts '
      + `(observed ${process.platform}-${process.arch})`,
  );
}
if (!existsSync(sourceBinary)) {
  fail(
    'SNAPBACK_RUNTIME_BINARY_MISSING',
    `Linux release binary is missing at ${sourceBinary}; build snapback --release on linux-x64`,
  );
}
if (!existsSync(sourceHermes)) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Linux Hermes shared library is missing at ${sourceHermes}; run scripts/bootstrap-ibex-runtime on linux-x64`,
  );
}
if (!existsSync(sourceHermesHeader)) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Linux Hermes header is missing at ${sourceHermesHeader}; run scripts/bootstrap-ibex-runtime on linux-x64`,
  );
}
// EM_X86_64 is 62. Reject a wrong-architecture artifact before it can be
// published under an npm cpu selector that promises x64.
if (elfMachine(sourceBinary) !== 62 || elfMachine(sourceHermes) !== 62) {
  fail(
    'SNAPBACK_RUNTIME_ARTIFACT_PLATFORM_MISMATCH',
    'runtime-linux-x64 inputs must both be x86-64 ELF artifacts',
  );
}

const sourceTestStaging = process.argv.includes('--source-test-staging');
const nativeArtifactStaging = process.argv.includes('--native-artifact-staging');
let identity;
let transportedQualification = null;
let artifactAttestation = null;
try {
  if (crossHost) {
    const attestation = readLinuxRuntimeArtifactAttestation(
      resolve(explicitAttestation),
    );
    validateLinuxRuntimeArtifactAttestation({
      attestation,
      binaryPath: sourceBinary,
      hermesPath: sourceHermes,
      hermesHeaderPath: sourceHermesHeader,
      sourceRevision: explicitRevision,
      bundledLibsDirectory: explicitBundledLibsDir
        ? resolve(explicitBundledLibsDir)
        : null,
    });
    artifactAttestation = attestation;
    identity = attestation.buildIdentity;
    transportedQualification = {
      ok: true,
      report: attestation.qualificationVerdict,
      reason: null,
    };
  } else {
    const identityResult = spawnSync(sourceBinary, ['build-identity'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [
          dirname(sourceHermes),
          process.env.LD_LIBRARY_PATH,
        ].filter(Boolean).join(':'),
      },
      timeout: 15_000,
    });
    if (identityResult.status !== 0) {
      throw new Error(
        'could not inspect the runtime build distribution: '
          + (
            identityResult.error?.message
            ?? identityResult.stderr?.trim()
            ?? identityResult.signal
            ?? identityResult.status
            ?? 'unknown failure'
          ),
      );
    }
    identity = JSON.parse(identityResult.stdout);
  }
  if (!sourceTestStaging) assertPublicPackageBuildIdentity(identity);
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    error?.message ?? 'runtime build identity was malformed',
  );
}

const binDirectory = join(packageRoot, 'bin');
const libDirectory = join(packageRoot, 'lib');
const includeDirectory = join(packageRoot, 'include');
const adminDirectory = join(packageRoot, 'admin');
// Native-artifact staging transports only the binary/Hermes inputs to the
// final publication assembler; that assembler adds and seals the console.
const allowMissingAdminConsole = sourceTestStaging || nativeArtifactStaging;
rmSync(binDirectory, { recursive: true, force: true });
rmSync(libDirectory, { recursive: true, force: true });
rmSync(includeDirectory, { recursive: true, force: true });
rmSync(adminDirectory, { recursive: true, force: true });
rmSync(join(packageRoot, 'runtime-readiness.json'), { force: true });
mkdirSync(binDirectory, { recursive: true });
mkdirSync(libDirectory, { recursive: true });
mkdirSync(join(includeDirectory, 'hermes'), { recursive: true });
cpSync(sourceBinary, join(binDirectory, 'snapback'));
chmodSync(join(binDirectory, 'snapback'), 0o755);
cpSync(sourceHermes, join(libDirectory, 'libhermesvm.so'));
chmodSync(join(libDirectory, 'libhermesvm.so'), 0o755);
cpSync(sourceHermesHeader, join(includeDirectory, 'hermes', 'hermes.h.artifact'));
if (!nativeArtifactStaging && existsSync(sourceAdminDist)) {
  try {
    installAdminConsoleSnapshot({
      sourceRoot: sourceAdminDist,
      destinationRoot: adminDirectory,
      expectedSourceRevision: crossHost ? explicitRevision : identity.binary.gitCommit,
    });
  } catch (error) {
    fail(
      error?.code ?? 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
      error?.message ?? 'admin console snapshot could not be installed',
    );
  }
} else if (!allowMissingAdminConsole) {
  fail(
    'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
    `build-matched admin console snapshot is missing at ${sourceAdminDist}; run bun install --frozen-lockfile --cwd admin-ui && bun run --cwd admin-ui build`,
  );
}
try {
  if (crossHost) {
    for (const soname of Object.keys(
      artifactAttestation.bundledLibrariesSha256,
    ).sort()) {
      const destination = join(libDirectory, soname);
      cpSync(join(resolve(explicitBundledLibsDir), soname), destination);
      chmodSync(destination, 0o755);
    }
  } else {
    bundleLinuxRuntimeSharedLibraries({
      binaryPath: join(binDirectory, 'snapback'),
      libDirectory,
    });
  }
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_RUNTIME_LINUX_BUNDLE_RESOLUTION_FAILED',
    error?.message ?? 'Linux runtime shared libraries could not be bundled',
  );
}
try {
  assertLinuxPackagePortability({
    binaryPath: join(binDirectory, 'snapback'),
    libDirectory,
  });
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_RUNTIME_LINUX_PORTABILITY_VIOLATION',
    error?.message ?? 'Linux runtime package portability could not be verified',
  );
}
try {
  const receiptInstall = installPackagedStoreQualificationReceipt({
    sourceBinary,
    binDirectory,
    receiptEnvironmentName:
      'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
  });
  if (!receiptInstall.installed
      && process.env.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS !== '1') {
    console.error(
      '@expo/snapback-runtime-linux-x64: packaged-store qualification receipt is absent; the package will not advertise single_table_v1',
    );
  }
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
    error?.message ?? 'packaged-store qualification receipt could not be installed',
  );
}
try {
  // @ref LLP 0123#package-seal-landing-2026-08-06 — native production
  // qualifies this final RPATH layout; cross-host assembly reuses only the
  // byte-bound verdict produced on the native Linux builder.
  produceRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(binDirectory, 'snapback'),
    packageName: '@expo/snapback-runtime-linux-x64',
    platform: 'linux',
    architecture: 'x64',
    buildIdentity: identity,
    sourceRevision: crossHost ? explicitRevision : identity.binary.gitCommit,
    ...(transportedQualification === null
      ? { environment: process.env }
      : { qualification: transportedQualification }),
    adminConsoleRequired: !allowMissingAdminConsole,
  });
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
    error?.message ?? 'assembled Linux runtime package could not be sealed',
  );
}
console.log(`prepared ${join(binDirectory, 'snapback')}`);
