#!/usr/bin/env node

// @ref LLP 0041#runtime-distribution — assemble the relocatable native
// package from a bootstrapped release binary; never compile Hermes on install.

import { cpSync, existsSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPublicPackageBuildIdentity } from '../../scripts/runtime-package-authority.mjs';
import { produceRuntimePackageSeal } from '../snapback-cli/runtime-readiness.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const sourceBinary = resolve(
  process.env.SNAPBACK_RUNTIME_SOURCE_BINARY
    ?? join(repositoryRoot, 'target', 'release', 'snapback'),
);
const sourceFramework = resolve(
  process.env.SNAPBACK_RUNTIME_HERMES_FRAMEWORK
    ?? join(repositoryRoot, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework'),
);
const sourceHermesHeader = resolve(
  process.env.SNAPBACK_RUNTIME_HERMES_HEADER
    ?? join(repositoryRoot, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'),
);

function fail(code, message) {
  console.error(`${code}: ${message}`);
  process.exit(1);
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  fail(
    'SNAPBACK_IBEX_HOST_UNSUPPORTED',
    `runtime-darwin-arm64 can only be prepared on darwin-arm64 (observed ${process.platform}-${process.arch})`,
  );
}
if (!existsSync(sourceBinary)) {
  fail(
    'SNAPBACK_RUNTIME_BINARY_MISSING',
    `release binary is missing at ${sourceBinary}; run scripts/bootstrap-ibex-runtime and cargo build --release`,
  );
}
if (!existsSync(join(sourceFramework, 'Versions'))) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Hermes framework is missing at ${sourceFramework}; run scripts/bootstrap-ibex-runtime`,
  );
}
if (!existsSync(sourceHermesHeader)) {
  fail(
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING',
    `Hermes header is missing at ${sourceHermesHeader}; run scripts/bootstrap-ibex-runtime`,
  );
}

const sourceTestStaging = process.argv.includes('--source-test-staging');
const identityResult = spawnSync(sourceBinary, ['build-identity'], {
  encoding: 'utf8',
  env: {
    ...process.env,
    DYLD_FRAMEWORK_PATH: [
      dirname(sourceFramework),
      process.env.DYLD_FRAMEWORK_PATH,
    ].filter(Boolean).join(':'),
  },
  timeout: 15_000,
});
if (identityResult.status !== 0) {
  fail(
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
try {
  identity = JSON.parse(identityResult.stdout);
  if (!sourceTestStaging) assertPublicPackageBuildIdentity(identity);
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED',
    error?.message ?? 'runtime build identity was malformed',
  );
}

const binDirectory = join(packageRoot, 'bin');
const frameworksDirectory = join(packageRoot, 'Frameworks');
const includeDirectory = join(packageRoot, 'include');
rmSync(binDirectory, { recursive: true, force: true });
rmSync(frameworksDirectory, { recursive: true, force: true });
rmSync(includeDirectory, { recursive: true, force: true });
rmSync(join(packageRoot, 'runtime-readiness.json'), { force: true });
mkdirSync(binDirectory, { recursive: true });
mkdirSync(frameworksDirectory, { recursive: true });
mkdirSync(join(includeDirectory, 'hermes'), { recursive: true });
cpSync(sourceBinary, join(binDirectory, 'snapback'));
chmodSync(join(binDirectory, 'snapback'), 0o755);
cpSync(sourceFramework, join(frameworksDirectory, 'hermesvm.framework'), {
  recursive: true,
  preserveTimestamps: true,
});
cpSync(sourceHermesHeader, join(includeDirectory, 'hermes', 'hermes.h.artifact'));
try {
  // @ref LLP 0123#package-seal-landing-2026-08-06 — qualify only after the
  // binary and framework occupy the exact loader-relative package layout.
  produceRuntimePackageSeal({
    root: packageRoot,
    binaryPath: join(binDirectory, 'snapback'),
    packageName: '@expo/snapback-runtime-darwin-arm64',
    platform: 'darwin',
    architecture: 'arm64',
    buildIdentity: identity,
    sourceRevision: identity.binary.gitCommit,
    environment: process.env,
  });
} catch (error) {
  fail(
    error?.code ?? 'SNAPBACK_RUNTIME_PACKAGE_QUALIFICATION_FAILED',
    error?.message ?? 'assembled macOS runtime package could not be sealed',
  );
}
console.log(`prepared ${join(binDirectory, 'snapback')}`);
