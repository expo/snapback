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
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicPackageBuildIdentity,
  assertRuntimePackageBuildIdentity,
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
import {
  produceRuntimePackageSeal,
  verifyRuntimePackageSeal,
} from '../snapback-cli/runtime-readiness.mjs';

const defaultPackageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(defaultPackageRoot, '..', '..');
const defaultSourceBinary = join(repositoryRoot, 'target', 'release', 'snapback');
const defaultSourceHermes = join(
  repositoryRoot,
  'vendor',
  'ibex',
  'linux',
  'lib',
  'libhermesvm.so',
);
const defaultSourceHermesHeader = join(
  repositoryRoot,
  'vendor',
  'ibex',
  'linux',
  'hermes-headers',
  'hermes',
  'hermes.h',
);
const defaultSourceAdminDist = resolve(repositoryRoot, 'admin-ui', 'dist');

function codedError(code, message, cause = undefined) {
  const error = new Error(message, { cause });
  error.code = code;
  return error;
}

function diagnosticError(error, fallbackCode, fallbackMessage) {
  if (typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_')) {
    return error;
  }
  return codedError(fallbackCode, error?.message ?? fallbackMessage, error);
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

// @ref LLP 0041#runtime-distribution — a failed assembly may not destroy a
// previously valid runtime package; only a fully sealed staging tree may swap.
function swapStagedAssembly({ packageRoot, stagingRoot }) {
  const backupRoot = mkdtempSync(join(packageRoot, '.assembly-backup-'));
  const states = [];
  // @ref LLP 0123#package-seal-landing-2026-08-06 — land the seal last so an
  // interrupted mixed-layout swap is visibly absent/drifted, never trusted.
  const entries = ['bin', 'lib', 'include', 'admin', 'runtime-readiness.json'];
  try {
    for (const entry of entries) {
      const staged = join(stagingRoot, entry);
      const current = join(packageRoot, entry);
      const backup = join(backupRoot, entry);
      const state = { current, backup, previousMoved: false, replacementMoved: false };
      states.push(state);
      if (existsSync(current)) {
        renameSync(current, backup);
        state.previousMoved = true;
      }
      if (existsSync(staged)) {
        renameSync(staged, current);
        state.replacementMoved = true;
      }
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const state of states.reverse()) {
      try {
        if (state.replacementMoved && existsSync(state.current)) {
          rmSync(state.current, { recursive: true, force: true });
        }
        if (state.previousMoved) renameSync(state.backup, state.current);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError.message);
      }
    }
    if (rollbackFailures.length > 0) {
      throw codedError(
        'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
        `runtime package swap failed and rollback was incomplete; prior artifacts remain under ${backupRoot}: ${rollbackFailures.join('; ')}`,
        error,
      );
    }
    rmSync(backupRoot, { recursive: true, force: true });
    throw codedError(
      'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
      `runtime package swap failed; the prior assembly was restored: ${error.message}`,
      error,
    );
  }
  rmSync(backupRoot, { recursive: true, force: true });
}

export function prepareLinuxRuntimePackage(options = {}) {
  const environment = options.environment ?? process.env;
  const packageRoot = resolve(options.packageRoot ?? defaultPackageRoot);
  const explicitBinary = options.sourceBinary
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_SOURCE_BINARY;
  const explicitHermes = options.sourceHermes
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_HERMES_LIBRARY;
  const explicitHermesHeader = options.sourceHermesHeader
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_HERMES_HEADER;
  const explicitAttestation = options.sourceAttestation
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_BUILD_ATTESTATION;
  const explicitRevision = options.sourceRevision
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_SOURCE_REVISION;
  const explicitBundledLibsDir = options.sourceBundledLibsDirectory
    ?? environment.SNAPBACK_RUNTIME_LINUX_X64_BUNDLED_LIBS_DIR;
  const sourceBinary = resolve(explicitBinary ?? defaultSourceBinary);
  const sourceHermes = resolve(explicitHermes ?? defaultSourceHermes);
  const sourceHermesHeader = resolve(
    explicitHermesHeader ?? defaultSourceHermesHeader,
  );
  const sourceAdminDist = resolve(options.sourceAdminDist ?? defaultSourceAdminDist);
  const args = options.args ?? process.argv.slice(2);
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;

  // Native preparation is the default on Linux. A release job may assemble the
  // package on another host only when it supplies both explicit CI artifacts;
  // their ELF headers remain the authority, not the packaging host.
  const crossHost = platform !== 'linux' || architecture !== 'x64';
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
    throw codedError(
      'SNAPBACK_IBEX_HOST_UNSUPPORTED',
      'runtime-linux-x64 requires a linux-x64 host or explicit Linux binary, '
        + 'Hermes library/header, build-attestation, and source-revision artifacts '
        + `(observed ${platform}-${architecture})`,
    );
  }
  if (!existsSync(sourceBinary)) {
    throw codedError(
      'SNAPBACK_RUNTIME_BINARY_MISSING',
      `Linux release binary is missing at ${sourceBinary}; build snapback --release on linux-x64`,
    );
  }
  if (!existsSync(sourceHermes)) {
    throw codedError(
      'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
      `Linux Hermes shared library is missing at ${sourceHermes}; run scripts/bootstrap-ibex-runtime on linux-x64`,
    );
  }
  if (!existsSync(sourceHermesHeader)) {
    throw codedError(
      'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
      `Linux Hermes header is missing at ${sourceHermesHeader}; run scripts/bootstrap-ibex-runtime on linux-x64`,
    );
  }
  // EM_X86_64 is 62. Reject a wrong-architecture artifact before it can be
  // published under an npm cpu selector that promises x64.
  if (elfMachine(sourceBinary) !== 62 || elfMachine(sourceHermes) !== 62) {
    throw codedError(
      'SNAPBACK_RUNTIME_ARTIFACT_PLATFORM_MISMATCH',
      'runtime-linux-x64 inputs must both be x86-64 ELF artifacts',
    );
  }

  const sourceTestStaging = args.includes('--source-test-staging');
  const nativeArtifactStaging = args.includes('--native-artifact-staging');
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
          ...environment,
          LD_LIBRARY_PATH: [
            dirname(sourceHermes),
            environment.LD_LIBRARY_PATH,
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
    assertRuntimePackageBuildIdentity(identity);
    if (!sourceTestStaging) assertPublicPackageBuildIdentity(identity);
  } catch (error) {
    throw diagnosticError(
      error,
      'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
      'runtime build identity was malformed',
    );
  }

  // Native-artifact staging transports only the binary/Hermes inputs to the
  // final publication assembler; that assembler adds and seals the console.
  // Source-test staging bypasses only public-package distribution, never a
  // clean release identity or the console.
  const allowMissingAdminConsole = nativeArtifactStaging;
  const stagingRoot = mkdtempSync(join(packageRoot, '.staging-'));
  const binDirectory = join(stagingRoot, 'bin');
  const libDirectory = join(stagingRoot, 'lib');
  const includeDirectory = join(stagingRoot, 'include');
  const adminDirectory = join(stagingRoot, 'admin');
  try {
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
        throw diagnosticError(
          error,
          'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID',
          'admin console snapshot could not be installed',
        );
      }
    } else if (!allowMissingAdminConsole) {
      throw codedError(
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
      throw diagnosticError(
        error,
        'SNAPBACK_RUNTIME_LINUX_BUNDLE_RESOLUTION_FAILED',
        'Linux runtime shared libraries could not be bundled',
      );
    }
    try {
      assertLinuxPackagePortability({
        binaryPath: join(binDirectory, 'snapback'),
        libDirectory,
      });
    } catch (error) {
      throw diagnosticError(
        error,
        'SNAPBACK_RUNTIME_LINUX_PORTABILITY_VIOLATION',
        'Linux runtime package portability could not be verified',
      );
    }

    try {
      const receiptInstall = installPackagedStoreQualificationReceipt({
        sourceBinary,
        binDirectory,
        receiptEnvironmentName:
          'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
        environment,
      });
      if (!receiptInstall.installed
          && environment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS !== '1') {
        console.error(
          '@expo/snapback-runtime-linux-x64: packaged-store qualification receipt is absent; the package will not advertise single_table_v1',
        );
      }
    } catch (error) {
      throw diagnosticError(
        error,
        'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
        'packaged-store qualification receipt could not be installed',
      );
    }

    try {
      // @ref LLP 0123#package-seal-landing-2026-08-06 — native production
      // qualifies this staged final RPATH layout; cross-host assembly reuses
      // only the byte-bound verdict produced on the native Linux builder.
      produceRuntimePackageSeal({
        root: stagingRoot,
        binaryPath: join(binDirectory, 'snapback'),
        packageName: '@expo/snapback-runtime-linux-x64',
        platform: 'linux',
        architecture: 'x64',
        buildIdentity: identity,
        sourceRevision: crossHost ? explicitRevision : identity.binary.gitCommit,
        ...(transportedQualification === null
          ? { environment }
          : { qualification: transportedQualification }),
        adminConsoleRequired: !allowMissingAdminConsole,
      });
      const stagedSeal = verifyRuntimePackageSeal({
        root: stagingRoot,
        binaryPath: join(binDirectory, 'snapback'),
        packageName: '@expo/snapback-runtime-linux-x64',
        platform: 'linux',
        architecture: 'x64',
        adminConsoleRequired: !allowMissingAdminConsole,
      });
      if (!stagedSeal.ok) {
        throw codedError(stagedSeal.diagnostic.code, stagedSeal.diagnostic.message);
      }
    } catch (error) {
      throw diagnosticError(
        error,
        'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
        'assembled Linux runtime package could not be sealed',
      );
    }

    swapStagedAssembly({ packageRoot, stagingRoot });
    return { binaryPath: join(packageRoot, 'bin', 'snapback'), identity };
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const prepared = prepareLinuxRuntimePackage();
    console.log(`prepared ${prepared.binaryPath}`);
  } catch (error) {
    const failure = diagnosticError(
      error,
      'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
      'assembled Linux runtime package could not be prepared',
    );
    console.error(`${failure.code}: ${failure.message}`);
    process.exitCode = 1;
  }
}
