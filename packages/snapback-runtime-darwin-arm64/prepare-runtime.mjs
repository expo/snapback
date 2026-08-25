#!/usr/bin/env node

// @ref LLP 0041#runtime-distribution — assemble the relocatable native
// package from a bootstrapped release binary; never compile Hermes on install.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE,
  RUNTIME_CATALOG_INSPECTION_FAILED_CODE,
  assertPublicPackageBuildIdentity,
  assertRuntimePackageBuildIdentity,
  assertRuntimePackageSourceIdentity,
  createRuntimeCatalogBuildIdentityProof,
  inspectRuntimeCatalogBuildIdentity,
  installPackagedStoreQualificationReceipt,
} from '../../scripts/runtime-package-authority.mjs';
import { installAdminConsoleSnapshot } from '../snapback-cli/admin-snapshot.mjs';
import {
  produceRuntimePackageSeal,
  verifyRuntimePackageSeal,
} from '../snapback-cli/runtime-readiness.mjs';

const defaultPackageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(defaultPackageRoot, '..', '..');
const defaultSourceBinary = resolve(
  process.env.SNAPBACK_RUNTIME_SOURCE_BINARY
    ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
const defaultSourceFramework = resolve(
  process.env.SNAPBACK_RUNTIME_HERMES_FRAMEWORK
    ?? join(repositoryRoot, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework'),
);
const defaultSourceHermesHeader = resolve(
  process.env.SNAPBACK_RUNTIME_HERMES_HEADER
    ?? join(repositoryRoot, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'),
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

function inventoriedCatalogInspectionError(error) {
  if (error?.code === RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE) {
    return codedError(
      'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH',
      error.message,
      error,
    );
  }
  if (error?.code === RUNTIME_CATALOG_INSPECTION_FAILED_CODE) {
    return codedError(
      'SNAPBACK_RUNTIME_CATALOG_INSPECTION_FAILED',
      error.message,
      error,
    );
  }
  return error;
}

// @ref LLP 0041#runtime-distribution — a failed assembly may not destroy a
// previously valid runtime package; only a fully sealed staging tree may swap.
function swapStagedAssembly({ packageRoot, stagingRoot }) {
  const backupRoot = mkdtempSync(join(packageRoot, '.assembly-backup-'));
  const states = [];
  // @ref LLP 0123#package-seal-landing-2026-08-06 — land the seal last so an
  // interrupted mixed-layout swap is visibly absent/drifted, never trusted.
  const entries = ['bin', 'Frameworks', 'include', 'admin', 'runtime-readiness.json'];
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

export function prepareDarwinRuntimePackage({
  packageRoot = defaultPackageRoot,
  sourceBinary = defaultSourceBinary,
  sourceFramework = defaultSourceFramework,
  sourceHermesHeader = defaultSourceHermesHeader,
  sourceAdminDist = defaultSourceAdminDist,
  args = process.argv.slice(2),
  environment = process.env,
  platform = process.platform,
  architecture = process.arch,
} = {}) {
  packageRoot = resolve(packageRoot);
  sourceBinary = resolve(sourceBinary);
  sourceFramework = resolve(sourceFramework);
  sourceHermesHeader = resolve(sourceHermesHeader);
  sourceAdminDist = resolve(sourceAdminDist);
  const sourceHermesRuntime = join(sourceFramework, 'Versions', '1', 'hermesvm');

  if (platform !== 'darwin' || architecture !== 'arm64') {
    throw codedError(
      'SNAPBACK_IBEX_HOST_UNSUPPORTED',
      `runtime-darwin-arm64 can only be prepared on darwin-arm64 (observed ${platform}-${architecture})`,
    );
  }
  if (!existsSync(sourceBinary)) {
    throw codedError(
      'SNAPBACK_RUNTIME_BINARY_MISSING',
      `release binary is missing at ${sourceBinary}; run scripts/bootstrap-ibex-runtime and cargo build --release`,
    );
  }
  if (!existsSync(sourceHermesRuntime)) {
    throw codedError(
      'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
      `Hermes framework is missing at ${sourceFramework}; run scripts/bootstrap-ibex-runtime`,
    );
  }
  if (!existsSync(sourceHermesHeader)) {
    throw codedError(
      'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
      `Hermes header is missing at ${sourceHermesHeader}; run scripts/bootstrap-ibex-runtime`,
    );
  }

  const sourceTestStaging = args.includes('--source-test-staging');
  const nativeArtifactStaging = args.includes('--native-artifact-staging');
  const strictCleanRelease = args.includes('--strict-clean-release');
  const identityResult = spawnSync(sourceBinary, ['build-identity'], {
    encoding: 'utf8',
    env: {
      ...environment,
      DYLD_FRAMEWORK_PATH: [
        dirname(sourceFramework),
        environment.DYLD_FRAMEWORK_PATH,
      ].filter(Boolean).join(':'),
    },
    timeout: 15_000,
  });
  if (identityResult.status !== 0) {
    throw codedError(
      'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
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
  let identity;
  let catalogBuildIdentityProof;
  try {
    identity = JSON.parse(identityResult.stdout);
    assertRuntimePackageSourceIdentity(identity);
    if (strictCleanRelease) assertRuntimePackageBuildIdentity(identity);
    if (!sourceTestStaging) assertPublicPackageBuildIdentity(identity);
    let catalogBuildIdentity;
    try {
      catalogBuildIdentity = inspectRuntimeCatalogBuildIdentity({
        binaryPath: sourceBinary,
        binaryIdentity: identity,
        environment: {
          ...environment,
          DYLD_FRAMEWORK_PATH: [
            dirname(sourceFramework),
            environment.DYLD_FRAMEWORK_PATH,
          ].filter(Boolean).join(':'),
        },
      });
    } catch (error) {
      throw inventoriedCatalogInspectionError(error);
    }
    catalogBuildIdentityProof = createRuntimeCatalogBuildIdentityProof({
      binaryIdentity: identity,
      catalogBuildIdentity,
      source: 'native-inspection',
    });
  } catch (error) {
    throw diagnosticError(
      error,
      'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
      'runtime build identity was malformed',
    );
  }

  // Native-artifact staging transports only the binary/Hermes inputs to the
  // final publication assembler; that assembler adds and seals the console.
  // Source-test staging admits contributor debug/dirty binaries for local
  // proof. Manufacturing adds --strict-clean-release; neither mode may omit
  // the console.
  const allowMissingAdminConsole = nativeArtifactStaging;
  const stagingRoot = mkdtempSync(join(packageRoot, '.staging-'));
  const binDirectory = join(stagingRoot, 'bin');
  const frameworksDirectory = join(stagingRoot, 'Frameworks');
  const includeDirectory = join(stagingRoot, 'include');
  const adminDirectory = join(stagingRoot, 'admin');
  try {
    mkdirSync(binDirectory, { recursive: true });
    mkdirSync(frameworksDirectory, { recursive: true });
    mkdirSync(join(includeDirectory, 'hermes'), { recursive: true });
    cpSync(sourceBinary, join(binDirectory, 'snapback'));
    chmodSync(join(binDirectory, 'snapback'), 0o755);
    // @ref LLP 0123#package-seal-landing-2026-08-06 — seal the real versioned
    // file that dyld opens and npm preserves, not the framework's pack-time alias.
    // The binary loads the versioned framework file directly. Stage that real
    // npm-delivered tree, without the conventional framework symlinks that npm
    // omits from packed and installed packages.
    cpSync(join(sourceFramework, 'Versions', '1'), join(
      frameworksDirectory,
      'hermesvm.framework',
      'Versions',
      '1',
    ), {
      recursive: true,
      preserveTimestamps: true,
    });
    cpSync(sourceHermesHeader, join(includeDirectory, 'hermes', 'hermes.h.artifact'));

    if (!nativeArtifactStaging && existsSync(sourceAdminDist)) {
      try {
        installAdminConsoleSnapshot({
          sourceRoot: sourceAdminDist,
          destinationRoot: adminDirectory,
          expectedSourceRevision: identity.binary.gitCommit,
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
      const receiptInstall = installPackagedStoreQualificationReceipt({
        sourceBinary,
        binDirectory,
        receiptEnvironmentName:
          'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE',
        environment,
      });
      if (!receiptInstall.installed
          && environment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS !== '1') {
        console.error(
          '@expo/snapback-runtime-darwin-arm64: packaged-store qualification receipt is absent; the package will not advertise single_table_v1',
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
      // @ref LLP 0123#package-seal-landing-2026-08-06 — qualify only after the
      // staged tree has the exact final bin/../Frameworks loader-relative shape.
      produceRuntimePackageSeal({
        root: stagingRoot,
        binaryPath: join(binDirectory, 'snapback'),
        packageName: '@expo/snapback-runtime-darwin-arm64',
        platform: 'darwin',
        architecture: 'arm64',
        buildIdentity: identity,
        sourceRevision: identity.binary.gitCommit,
        environment,
        adminConsoleRequired: !allowMissingAdminConsole,
        catalogBuildIdentityProof,
      });
      const stagedSeal = verifyRuntimePackageSeal({
        root: stagingRoot,
        binaryPath: join(binDirectory, 'snapback'),
        packageName: '@expo/snapback-runtime-darwin-arm64',
        platform: 'darwin',
        architecture: 'arm64',
        adminConsoleRequired: !allowMissingAdminConsole,
      });
      if (!stagedSeal.ok) {
        throw codedError(stagedSeal.diagnostic.code, stagedSeal.diagnostic.message);
      }
    } catch (error) {
      throw diagnosticError(
        error,
        'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
        'assembled macOS runtime package could not be sealed',
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
    const prepared = prepareDarwinRuntimePackage();
    console.log(`prepared ${prepared.binaryPath}`);
  } catch (error) {
    const failure = diagnosticError(
      error,
      'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
      'assembled macOS runtime package could not be prepared',
    );
    console.error(`${failure.code}: ${failure.message}`);
    process.exitCode = 1;
  }
}
