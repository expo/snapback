// @ref LLP 0041#cli-commands — the package-owned commands orchestrate the
// external developer loop; every existing host operation delegates to the
// same native CLI instead of growing a second lifecycle dialect.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createConnection, createServer as createNetServer } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import {
  defineReplay,
  readReplayStatus,
  runReplay,
} from '@expo/snapback-acceptance';
import {
  applyDeclarationSuggestion,
  DECLARATION_SUGGESTION_REASON_CODES,
  formatCodegenSummary,
  formatDeclarationSuggestionPatch,
  generate,
  groupedCodegenSummaryDiagnosticCodes,
  readDeclarationSuggestionFile,
  resolveDeclarationSuggestionTarget,
  suggestDeclarations,
} from '@expo/snapback-codegen';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
} from '@expo/snapback-codegen/review-surface';
import { visibilityGovernanceDevEnvironment } from '@expo/snapback-codegen/visibility-governance-dev-config';
import {
  addTarget,
  applyBackupPlan,
  applyDeployPlan,
  applyRestoreActivationPlan,
  applyRestorePlan,
  applyRollbackPlan,
  createDeployPlan,
  createBackupPlan,
  createHostedAuthDrillReceipt,
  createAdapterQualificationManifest,
  createPreparedReleaseManifest,
  createRemoteDrillPlan,
  createRestoreActivationPlan,
  createRestorePlan,
  createRollbackPlan,
  doctorTarget,
  inspectTargetAdmin,
  inspectTarget,
  listBackups,
  queryControlLogs,
  sealHostedAdmissionEnvelope,
  showTarget,
  validateTargetDescriptor,
  verifyBackupManifest,
  verifyControlAuditLedger,
  verifyPreparedReleaseArtifacts,
  verifyRemoteDrillPlan,
  verifyRestoreReceipt,
} from './deployment-control.mjs';
import { readFileDescriptorSafe } from './file-custody.mjs';
import {
  createRuntimeRecoveryRecord,
  inspectRuntimeBinary,
  qualifyRuntimeBinary,
  readCheckoutRuntimeIdentity,
} from './runtime-recovery.mjs';
import {
  digestRuntimeArtifacts,
  issueRuntimeReadinessReceipt,
  packagedRuntimeArtifactCandidates,
  verifyRuntimeReadinessReceipt,
  verifyRuntimePackageSeal,
} from './runtime-readiness.mjs';
import { maskInitSourceCommentsAndStrings } from './source-mask.mjs';
import { DEV_IDENTITY_ENFORCEMENT_FLIP } from './dev-identity.mjs';
import { createSupervisedBindingPublisher } from './expo-binding-refresh.mjs';
import {
  loadComparatorProfile,
  readComparatorReceipt,
  runComparatorAcceptance,
} from './comparator-profile.mjs';
import {
  VERIFY_RECEIPT_SCHEMA_VERSION,
  defaultVerifyConfig,
  discoverVerifyConfig,
  loadVerifyConfig,
  runVerify,
  writeVerifyReceipt,
} from './verify.mjs';
import { formatGuideReferenceLookup, lookupGuideReference } from './reference-lookup.mjs';
import {
  createHostedPlan,
  HOSTED_LIFECYCLE_VERBS,
  invokeHostedLifecycle,
  runHostedRead,
  submitHostedOperatorRequest,
} from './hosted-control.mjs';
import { spawnLeasedProcess, stopProcessGroup } from './process-teardown.mjs';
import { validateAdminConsoleSnapshot } from './admin-snapshot.mjs';
import {
  devPortPlanOwner,
  materializeDevPortPlan,
  resolveDevPortPlan,
} from './port-plan.mjs';
export {
  DEFAULT_DEV_PORT_RANGE,
  DEV_PORT_ENVIRONMENT,
  devPortPlanOwner,
  materializeDevPortPlan,
  resolveDevPortPlan,
} from './port-plan.mjs';
export {
  addTarget,
  applyBackupPlan,
  applyDeployPlan,
  applyRestoreActivationPlan,
  applyRestorePlan,
  applyRollbackPlan,
  createDeployPlan,
  createBackupPlan,
  createHostedAuthDrillReceipt,
  createAdapterQualificationManifest,
  createPreparedReleaseManifest,
  createRemoteDrillPlan,
  createRestoreActivationPlan,
  createRestorePlan,
  createRollbackPlan,
  doctorTarget,
  inspectTargetAdmin,
  inspectTarget,
  listBackups,
  queryControlLogs,
  sealHostedAdmissionEnvelope,
  showTarget,
  validateTargetDescriptor,
  verifyBackupManifest,
  verifyControlAuditLedger,
  verifyPreparedReleaseArtifacts,
  verifyRemoteDrillPlan,
  verifyRestoreReceipt,
} from './deployment-control.mjs';
export {
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
};
export {
  createExternalReplayFloorAdvanceReceipt,
  prepareHostedAdmissionBoot,
  refreshHostedAdmissionProjection,
} from './hosted-admission-producer.mjs';
export {
  COMPARATOR_CHECKS,
  COMPARATOR_PROFILE_SCHEMA_VERSION,
  COMPARATOR_RECEIPT_SCHEMA_VERSION,
  defineComparatorProfile,
  loadComparatorProfile,
  readComparatorReceipt,
  runComparatorAcceptance,
  validateComparatorReceipt,
  writeComparatorReceipt,
} from './comparator-profile.mjs';
export {
  CLOUDFLARE_ACCEPTANCE_SCHEMA_VERSION,
  VERIFY_CONFIG_SCHEMA_VERSION,
  VERIFY_RECEIPT_SCHEMA_VERSION,
  VERIFY_STAGE_IDS,
  aggregateConformance,
  defaultVerifyConfig,
  defineCloudflareVerifyProfile,
  defineRepositoryVerifyProfiles,
  defineStarterVerifyProfile,
  defineVerifyConfig,
  loadVerifyConfig,
  probeAdmission,
  probeArtifactFreshness,
  probeCapabilities,
  probeServedTarget,
  runVerify,
  validateVerifyReceipt,
  writeVerifyReceipt,
} from './verify.mjs';
export {
  HOSTED_ASSETS,
  HOSTED_COMMAND_REGISTRY,
  HOSTED_LIFECYCLE_VERBS,
  createHostedPlan,
  invokeHostedLifecycle,
  resolveHostedAssets,
  runHostedRead,
  submitHostedOperatorRequest,
} from './hosted-control.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const RUNTIME_PACKAGES = new Map([
  ['darwin-arm64', '@expo/snapback-runtime-darwin-arm64'],
  ['linux-x64', '@expo/snapback-runtime-linux-x64'],
]);

function sourceCheckoutRoot(cliPackageRoot = packageRoot) {
  const candidate = resolve(cliPackageRoot, '..', '..');
  try {
    const expectedCliRoot = join(candidate, 'packages', 'snapback-cli');
    if (!existsSync(join(candidate, 'Cargo.toml'))
        || realpathSync(cliPackageRoot) !== realpathSync(expectedCliRoot)) {
      return null;
    }
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function sourceRuntimeRepairCommands(root, binary) {
  return [
    join(root, 'scripts', 'bootstrap-ibex-runtime'),
    `cargo build --release --bin snapback --manifest-path ${JSON.stringify(join(root, 'Cargo.toml'))}`,
    `node ${JSON.stringify(join(root, 'packages/snapback-cli/runtime-readiness.mjs'))} issue --root ${JSON.stringify(root)} --binary ${JSON.stringify(binary)}`,
  ];
}

// A committed external workspace containing the CLI package is visible repository state, unlike
// `bun link`, but it deliberately does not turn a contributor build into a
// package-production artifact. Select the checkout's own qualified release
// binary and prove its scoped source identity instead. Published installs do
// not have this topology and continue through the sealed platform-package
// path below.
//
// @ref LLP 0010#native-runtime-bootstrap — source custody uses the sibling
// readiness receipt and the checkout's runtime-input identity.
function resolveSourceCheckoutRuntime(platform, options = {}) {
  if (platform !== `${process.platform}-${process.arch}`) return null;
  const root = sourceCheckoutRoot(options.cliPackageRoot ?? packageRoot);
  if (!root) return null;
  const binary = join(
    root,
    'target',
    'release',
    process.platform === 'win32' ? 'snapback.exe' : 'snapback',
  );
  const repairCommands = sourceRuntimeRepairCommands(root, binary);
  if (!existsSync(binary)) {
    throw diagnosticError(
      'SNAPBACK_RUNTIME_BINARY_MISSING',
      `the linked Snapback source checkout has no release runtime at ${binary}`,
      { binary, checkoutRoot: root, repairCommands },
    );
  }
  const expected = readCheckoutRuntimeIdentity(root);
  const inspected = inspectRuntimeBinary(binary, options.env);
  const actual = inspected.stamp;
  const identityMatches = inspected.runnable
    && expected.gitCommit !== null
    && expected.gitDirty === false
    && actual?.gitCommit === expected.gitCommit
    && actual?.gitDirty === false
    && actual?.crateVersion === expected.crateVersion
    && actual?.buildProfile === 'release';
  if (!identityMatches) {
    throw diagnosticError(
      'SNAPBACK_BUILD_IDENTITY_MISMATCH',
      `the linked Snapback source runtime does not match the checkout's scoped build identity: ${binary}`,
      {
        binary,
        checkoutRoot: root,
        expected,
        actual,
        runnable: inspected.runnable,
        reason: inspected.reason,
        repairCommands,
      },
    );
  }
  const readiness = verifyRuntimeReadinessReceipt({ root, binaryPath: binary });
  if (!readiness.ok) {
    throw diagnosticError(
      readiness.diagnostic.code,
      `the linked Snapback source runtime is not qualified: ${readiness.diagnostic.message}`,
      {
        binary,
        checkoutRoot: root,
        reason: readiness.reason,
        readiness: readiness.diagnostic.details,
        repairCommands,
      },
    );
  }
  return { binary, source: 'source-checkout', platform, checkoutRoot: root };
}

export function diagnosticError(code, message, details = undefined) {
  const inferredCommand = code === 'SNAPBACK_CLI_ARGUMENT_INVALID'
    ? message.match(/(?:usage:\s*)?snapback\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)?)/u)?.[1] ?? ''
    : null;
  const selectedDetails = inferredCommand === null
    ? details
    : { command: ['snapback', inferredCommand].filter(Boolean).join(' '), ...(details ?? {}) };
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'cli',
    message,
    ...(selectedDetails === undefined ? {} : { details: selectedDetails }),
  };
  return error;
}

export function scrubDynamicLoaderEnvironment(environment = process.env) {
  const clean = { ...environment };
  for (const key of Object.keys(clean)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete clean[key];
  }
  return clean;
}

const PACKAGED_STORE_QUALIFICATION_RECEIPT_ENV =
  'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT';
const PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE =
  'packaged-store-qualification.receipt.json';
const ADMIN_DIST_ENV = 'SNAPBACK_ADMIN_DIST';

// @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
// — a co-installed receipt is ambient only for the exact adjacent runtime;
// an explicit caller environment always wins.
export function runtimeSpawnEnvironment(binary, environment = process.env) {
  const clean = scrubDynamicLoaderEnvironment(environment);
  const binaryPath = resolve(binary);
  // @ref LLP 0017#serving-model — an installed runtime carries the immutable
  // console snapshot; the CLI supplies its directory without asking a
  // consumer to know package topology or set a contributor override.
  if (!Object.hasOwn(clean, ADMIN_DIST_ENV)
      && basename(dirname(binaryPath)) === 'bin') {
    const runtimeRoot = dirname(dirname(binaryPath));
    const runtimeReceiptPath = join(runtimeRoot, 'runtime-readiness.json');
    try {
      const runtimeReceipt = JSON.parse(readFileSync(runtimeReceiptPath, 'utf8'));
      const adminRoot = join(runtimeRoot, 'admin');
      validateAdminConsoleSnapshot({
        root: adminRoot,
        expectedSourceRevision: runtimeReceipt.sourceRevision,
      });
      clean[ADMIN_DIST_ENV] = adminRoot;
    } catch {
      // Package resolution validates the sealed console fail-closed. An
      // explicit runtime override may have no packaged snapshot; retain the
      // contributor/source fallback instead of treating package layout as
      // ambient authority.
    }
  }
  if (Object.hasOwn(clean, PACKAGED_STORE_QUALIFICATION_RECEIPT_ENV)) return clean;
  const receiptPath = join(dirname(binaryPath), PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE);
  if (!existsSync(receiptPath)) return clean;
  try {
    const metadata = lstatSync(receiptPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return clean;
    const realBinaryDirectory = realpathSync(dirname(binaryPath));
    const realReceipt = realpathSync(receiptPath);
    if (dirname(realReceipt) !== realBinaryDirectory) return clean;
  } catch {
    return clean;
  }
  clean[PACKAGED_STORE_QUALIFICATION_RECEIPT_ENV] = receiptPath;
  return clean;
}

export function resolveRuntimeBinary(options = {}) {
  const override = options.runtimeBinary ?? process.env.SNAPBACK_RUNTIME_BINARY;
  if (override) {
    const binary = resolve(override);
    if (!existsSync(binary)) {
      throw diagnosticError('SNAPBACK_RUNTIME_BINARY_MISSING', `runtime override does not exist: ${binary}`, { binary });
    }
    return { binary, source: 'override', platform: `${process.platform}-${process.arch}` };
  }
  const platform = options.platform ?? `${process.platform}-${process.arch}`;
  const packageName = RUNTIME_PACKAGES.get(platform);
  if (!packageName) {
    throw diagnosticError(
      'SNAPBACK_IBEX_HOST_UNSUPPORTED',
      `no prebuilt Snapback runtime is published for ${platform}`,
      { platform, supported: [...RUNTIME_PACKAGES.keys()] },
    );
  }
  const sourceRuntime = resolveSourceCheckoutRuntime(platform, options);
  if (sourceRuntime) return sourceRuntime;
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_RUNTIME_PACKAGE_MISSING',
      `${packageName} is not installed for ${platform}`,
      { platform, package: packageName },
    );
    error.cause = cause;
    throw error;
  }
  const binary = join(dirname(manifestPath), 'bin', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  if (!existsSync(binary)) {
    throw diagnosticError('SNAPBACK_RUNTIME_BINARY_MISSING', `runtime package has no executable at ${binary}`, {
      package: packageName,
      binary,
    });
  }
  const runtimeRoot = dirname(manifestPath);
  const [runtimePlatform, runtimeArchitecture] = platform.split('-');
  // @ref LLP 0123#package-seal-landing-2026-08-06 — never return a package
  // binary until its production qualification/digest binding reopens.
  const seal = verifyRuntimePackageSeal({
    root: runtimeRoot,
    binaryPath: binary,
    packageName,
    platform: runtimePlatform,
    architecture: runtimeArchitecture,
  });
  if (!seal.ok) {
    throw diagnosticError(
      seal.diagnostic.code,
      `runtime package ${packageName} failed its package-production seal: ${seal.diagnostic.message}`,
      { package: packageName, binary, reason: seal.reason, seal: seal.diagnostic.details },
    );
  }
  return { binary, source: packageName, platform };
}

function runtimeReadinessRoot(runtime, cliPackageRoot = packageRoot) {
  if (runtime.checkoutRoot) return runtime.checkoutRoot;
  const binary = existsSync(runtime.binary)
    ? realpathSync(runtime.binary)
    : resolve(runtime.binary);
  const checkoutRoot = sourceCheckoutRoot(cliPackageRoot);
  if (checkoutRoot !== null) {
    const candidate = relative(checkoutRoot, binary);
    if (
      candidate !== ''
      && candidate !== '..'
      && !candidate.startsWith(`..${sep}`)
    ) return checkoutRoot;
  }
  // @ref LLP 0010#native-runtime-bootstrap — a qualified binary shared from
  // another source checkout must reopen that checkout's digest-bound receipt
  // and Hermes artifacts, not reinterpret target/debug as a package root.
  if (['override', 'qualified-override'].includes(runtime.source)) {
    let candidate = dirname(binary);
    for (;;) {
      const parent = dirname(candidate);
      const targetRelative = relative(join(candidate, 'target'), binary);
      if (
        targetRelative !== ''
        && targetRelative !== '..'
        && !targetRelative.startsWith(`..${sep}`)
        && existsSync(join(candidate, 'Cargo.toml'))
        && existsSync(join(candidate, 'packages', 'snapback-cli', 'package.json'))
      ) {
        return realpathSync(candidate);
      }
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return dirname(dirname(binary));
}

// @ref LLP 0010#native-runtime-bootstrap — the digest binding follows the
// Hermes layout that actually sits beside the selected binary. Selecting the
// candidate set from the `runtime.source` label instead bound a source-checkout
// layout to an explicitly overridden packaged runtime, recorded an empty
// artifact list, and made framework drift undetectable for that binary.
function runtimeReadinessArtifacts(runtime, runtimeRoot) {
  const checkoutLayout = digestRuntimeArtifacts(runtimeRoot);
  if (checkoutLayout.length > 0) return checkoutLayout;
  return digestRuntimeArtifacts(runtimeRoot, {
    candidates: packagedRuntimeArtifactCandidates(runtimeRoot),
  });
}

// @ref LLP 0010#native-runtime-bootstrap — packaged consumers persist the
// same digest-bound readiness schema in app-owned state; the live restricted
// VM qualification remains authoritative and verification recomputes every
// runtime byte instead of trusting receipt presence.
export function packagedRuntimeReadiness(options = {}) {
  const runtime = resolveRuntimeBinary(options);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const receiptPath = resolve(
    options.receiptPath ?? join(projectRoot, '.snapback', 'runtime-readiness.json'),
  );
  const runtimeRoot = runtimeReadinessRoot(runtime);
  const artifacts = runtimeReadinessArtifacts(runtime, runtimeRoot);
  if (options.verify === true) {
    const verdict = verifyRuntimeReadinessReceipt({
      root: runtimeRoot,
      binaryPath: runtime.binary,
      receiptPath,
      artifacts,
    });
    // @ref LLP 0115#cv-3-a-persisted-readiness-receipt-across-doctor-bootstrap-and-harness — a packaged app's first proof, and every proof after
    // a runtime upgrade, has no receipt for the binary in front of it. Running
    // the authoritative live qualification is the honest way to obtain one; a
    // failed qualification still refuses. Tampered, unqualified, and
    // contract-drifted receipts stay loud because a person must read them.
    if (!verdict.ok
        && options.acquire === true
        && ['absent', 'binary-drift', 'framework-drift'].includes(verdict.reason)) {
      return {
        ...packagedRuntimeReadiness({ ...options, verify: false, acquire: false }),
        acquired: verdict.reason,
      };
    }
    return {
      schemaVersion: 'snapback.runtime-readiness-verification.v1',
      operation: 'verify',
      ...verdict,
    };
  }
  const qualification = qualifyRuntimeBinary(runtime.binary, options.env);
  if (!qualification.ok) {
    throw diagnosticError(
      'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED',
      `the packaged runtime could not create its restricted no-eval handler VM: ${qualification.reason}`,
      { qualification: qualification.report, binary: runtime.binary },
    );
  }
  mkdirSync(dirname(receiptPath), { recursive: true });
  issueRuntimeReadinessReceipt({
    root: runtimeRoot,
    binaryPath: runtime.binary,
    receiptPath,
    qualification: {
      probe: 'restricted-no-eval-handler-vm',
      ok: true,
      report: qualification.report,
    },
    issuer: 'snapback-cli-runtime-qualify',
    artifacts,
  });
  const verdict = verifyRuntimeReadinessReceipt({
    root: runtimeRoot,
    binaryPath: runtime.binary,
    receiptPath,
    artifacts,
  });
  return {
    schemaVersion: 'snapback.runtime-readiness-verification.v1',
    operation: 'persist',
    ...verdict,
  };
}

function doctorDiagnostic(code, subsystem, message, details = undefined) {
  return {
    code,
    severity: code.endsWith('_OK') ? 'info' : 'error',
    subsystem,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

function installedRuntimeRecovery(runtime, {
  runnable,
  actualStamp = null,
  diagnostic = null,
  reason = null,
  packageName = null,
} = {}) {
  const installedPackage = runtime?.source === 'override'
    ? null
    : runtime?.source ?? packageName;
  return createRuntimeRecoveryRecord({
    selectedBinary: runtime?.binary ?? null,
    selectionRung: !runtime
      ? 'none'
      : runtime.source === 'override'
        ? 'configured'
        : runtime.source === 'source-checkout'
          ? 'source-checkout-release'
        : 'packaged-runtime',
    actualStamp,
    buildable: null,
    runnable,
    reuseAllowed: runnable === true,
    reuseReason: reason,
    diagnostic,
    producerInputs: runtime
      ? {
          platform: runtime.platform,
          runtimeSource: runtime.source,
          ...(runtime.checkoutRoot ? { checkoutRoot: runtime.checkoutRoot } : {}),
        }
      : null,
    repairCommand: runtime?.source === 'override'
      ? 'unset SNAPBACK_RUNTIME_BINARY && reinstall @expo/snapback-cli'
      : runtime?.source === 'source-checkout'
        ? sourceRuntimeRepairCommands(runtime.checkoutRoot, runtime.binary).join(' && ')
        : installedPackage
          ? `reinstall ${installedPackage} from the consumer project's lockfile`
          : 'reinstall @expo/snapback-cli and its platform runtime package',
    overrideCommand: runtime?.binary
      ? `SNAPBACK_RUNTIME_BINARY=${JSON.stringify(runtime.binary)}`
      : null,
  });
}

// @ref LLP 0074#priority-6-setup-that-fails-rarely-and-diagnostically —
// doctor proves a disposable VM/bundle/query/mutation/live/shutdown slice;
// file-presence and `--help` checks alone cannot certify the installed loop.
export async function doctor(options = {}) {
  let runtime;
  try {
    runtime = resolveRuntimeBinary(options);
  } catch (error) {
    return {
      schemaVersion: 'snapback.cli-doctor.v2',
      ok: false,
      checks: [error.diagnostic],
      runtimeRecovery: installedRuntimeRecovery(null, {
        runnable: false,
        diagnostic: { code: error.diagnostic?.code ?? 'SNAPBACK_RUNTIME_BINARY_MISSING' },
        reason: error.message,
        packageName: error.diagnostic?.details?.package ?? null,
      }),
    };
  }
  const checks = [];
  const launch = spawnSync(runtime.binary, ['--help'], {
    encoding: 'utf8',
    env: runtimeSpawnEnvironment(runtime.binary, options.env),
    timeout: 15_000,
  });
  if (launch.status !== 0) {
    const runtimeRecovery = installedRuntimeRecovery(runtime, {
      runnable: false,
      diagnostic: { code: 'SNAPBACK_IBEX_RUNTIME_LOAD_FAILED' },
      reason: launch.stderr?.slice(0, 2_000) ?? `runtime exited ${launch.status ?? launch.signal}`,
    });
    return {
      schemaVersion: 'snapback.cli-doctor.v2',
      ok: false,
      runtime,
      runtimeRecovery,
      checks: [doctorDiagnostic(
        'SNAPBACK_IBEX_RUNTIME_LOAD_FAILED',
        'runtime',
        'the installed Snapback binary did not launch with dynamic-loader overrides scrubbed',
        { status: launch.status, signal: launch.signal, stderr: launch.stderr?.slice(0, 2_000) ?? '' },
      )],
    };
  }
  const identityProbe = inspectRuntimeBinary(runtime.binary, options.env);
  const runtimeRecovery = installedRuntimeRecovery(runtime, {
    runnable: true,
    actualStamp: identityProbe.stamp,
    diagnostic: {
      code: identityProbe.stamp
        ? 'SNAPBACK_RUNTIME_LAUNCH_OK'
        : 'SNAPBACK_RUNTIME_IDENTITY_UNAVAILABLE',
    },
    reason: identityProbe.stamp
      ? 'selected runtime launched and reported its independent build stamp'
      : `selected runtime launched, but its build stamp was unavailable: ${identityProbe.reason}`,
  });
  checks.push(doctorDiagnostic(
    'SNAPBACK_RUNTIME_LAUNCH_OK',
    'runtime',
    'the packaged Snapback binary launched without ambient dynamic-loader paths',
  ));
  if (options.verticalSlice === false) {
    return {
      schemaVersion: 'snapback.cli-doctor.v2',
      ok: true,
      runtime,
      runtimeRecovery,
      checks,
      probe: 'launch-only',
    };
  }

  const scratch = mkdtempSync(join(tmpdir(), 'snapback-doctor-'));
  const projectRoot = join(scratch, 'probe');
  const backendRoot = join(projectRoot, 'snapback');
  const stateRoot = join(projectRoot, '.snapback');
  const readyFile = join(stateRoot, 'doctor.ready.json');
  const database = join(stateRoot, 'doctor.sqlite3');
  const startupArtifacts = join(stateRoot, 'doctor.startup-artifacts.json');
  let child = null;
  let client = null;
  let authCoordinator = null;
  let live = null;
  let failure = null;
  try {
    cpSync(join(packageRoot, 'templates', 'todo-contract', 'snapback'), backendRoot, { recursive: true });
    const generated = await generateApp(backendRoot);
    if (!generated.ok) {
      throw diagnosticError(
        'SNAPBACK_DOCTOR_GENERATION_FAILED',
        'the disposable doctor bundle did not generate',
        { diagnostics: generated.diagnostics ?? [] },
      );
    }
    mkdirSync(stateRoot, { recursive: true });
    const schemaPath = resolveGeneratedArtifact(
      join(backendRoot, 'generated'),
      'schema.manifest.json',
    );
    const functionsPath = resolveGeneratedArtifact(
      join(backendRoot, 'generated'),
      'functions.manifest.json',
    );
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    const functions = JSON.parse(readFileSync(functionsPath, 'utf8'));
    const requestedMode = schema?.auth?.mode ?? 'dev';
    const needsStartupActivation = requestedMode === 'sessions';
    if (needsStartupActivation) {
      // @ref LLP 0058#cold-startup-artifact-carrier — a sessions deployment
      // activates before listener bind; readiness then proves the seed reset
      // cannot race the staged dev-to-sessions transition.
      writeFileSync(startupArtifacts, `${JSON.stringify({
        formatVersion: 1,
        schema,
        functions,
      })}\n`, { mode: 0o600 });
    }
    const childEnvironment = runtimeSpawnEnvironment(runtime.binary, options.env);
    // @ref LLP 0301#2-origin-admission--the-path-split-implemented — the
    // posture is lifecycle-owner input, never ambient.
    delete childEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE;
    child = spawn(runtime.binary, [
      'start', '--ready-file', readyFile, '--db', database,
      ...(needsStartupActivation ? ['--startup-artifacts', startupArtifacts] : []),
    ], {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    const descriptor = validateDevTarget(
      await waitForReady(readyFile, child, readyTimeoutMs),
      { readyFile, database },
    );
    const adminToken = managedAdminToken(descriptor, database);
    const generatedActivation = await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      adminToken,
      {
        seed: true,
        database,
        skipSchemaFunctions: needsStartupActivation,
        env: options.env,
      },
    );
    // @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — host
    // readiness and completed post-bind generated provisioning are distinct
    // boundaries; sessions ensureApp is also LLP 0058 same-mode activation.
    const activationReadiness = {
      requestedMode,
      startup: {
        signal: 'runtime-ready-file',
        timeoutMs: readyTimeoutMs,
        startupCarrier: needsStartupActivation,
      },
      postBind: {
        signal: 'load-generated-return',
        branch: generatedActivation.branch,
        admissionBoundary: needsStartupActivation
          ? 'sessions-same-mode-activation'
          : 'none',
      },
    };
    checks.push(doctorDiagnostic(
      'SNAPBACK_DOCTOR_BUNDLE_LOAD_OK',
      'runtime',
      'the disposable server created its VM and loaded the generated bundle',
      { activationReadiness },
    ));

    const generatedClientEntry = fileURLToPath(
      import.meta.resolve('@expo/snapback-client/internal/declared-dev-mint'),
    );
    const generatedClientPackage = dirname(dirname(generatedClientEntry));
    const generatedPackageScope = join(projectRoot, 'node_modules', '@expo');
    mkdirSync(generatedPackageScope, { recursive: true });
    symlinkSync(
      generatedClientPackage,
      join(generatedPackageScope, 'snapback-client'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    // @ref LLP 0012#call-time-generation-binding — doctor imports and calls
    // the generated references so kind, args, and generation fences are part
    // of the vertical slice rather than bypassed by string operation names.
    const apiModule = await import(
      `${pathToFileURL(resolveGeneratedArtifact(join(backendRoot, 'generated'), 'api.mjs')).href}?doctor=${Date.now()}`,
    );
    const api = apiModule.default;
    const devIdentityCapability = requestedMode === 'dev'
      ? resolveDevIdentityCapabilityForCli(descriptor, {
          readyFile,
          database,
        })
      : null;
    authCoordinator = requestedMode === 'sessions'
      ? new AuthCoordinator({
          appId: schema.appId,
          storage: createMemoryAuthCustodyStorage(),
          broadcastChannelFactory: null,
          hintStorage: null,
        })
      : null;
    client = new SnapbackClient(descriptor.serverUrl, {
      adminToken,
      ...(devIdentityCapability ? { devIdentityCapability } : {}),
      ...(authCoordinator ? {
        authCoordinator,
        rqsStore: null,
        offlineQueue: false,
      } : {}),
    });
    const userId = 'user_doctor';
    if (authCoordinator) {
      await client.authPasswordSignup({
        email: `doctor-${randomUUID()}@example.invalid`,
        password: `snapback-doctor-${randomUUID()}`,
      });
    }
    const before = await client.query(
      api.listTodos,
      requestedMode === 'dev' ? { userId } : {},
    );
    if (!Array.isArray(before.rows)) {
      throw diagnosticError('SNAPBACK_DOCTOR_QUERY_FAILED', 'the disposable query returned no rows array');
    }
    checks.push(doctorDiagnostic(
      'SNAPBACK_DOCTOR_QUERY_OK',
      'runtime',
      'the disposable generated query executed in the runtime VM',
      { version: before.version, rowCount: before.rows.length },
    ));

    const mutation = await client.mutate(api.createTodo, {
      ...(requestedMode === 'dev' ? { userId } : {}),
      args: { title: 'Snapback doctor vertical slice' },
      clientMutationId: `doctor-${process.pid}-${Date.now()}`,
    });
    if (mutation?.changed_count !== 1) {
      throw diagnosticError(
        'SNAPBACK_DOCTOR_MUTATION_FAILED',
        'the disposable mutation did not commit exactly one row',
        { changedCount: mutation?.changed_count ?? null },
      );
    }
    checks.push(doctorDiagnostic(
      'SNAPBACK_DOCTOR_MUTATION_OK',
      'storage',
      'the disposable mutation committed against an isolated temporary database',
      { version: mutation.version },
    ));

    live = await client.liveQuery(api.listTodos, {
      connectionId: 'doctor',
      ...(requestedMode === 'dev' ? { userId } : {}),
    });
    if (!live.rows.some((row) => row.title === 'Snapback doctor vertical slice')) {
      throw diagnosticError('SNAPBACK_DOCTOR_LIVE_FAILED', 'the disposable live snapshot omitted the committed row');
    }
    live.dispose();
    live = null;
    checks.push(doctorDiagnostic(
      'SNAPBACK_DOCTOR_LIVE_OK',
      'realtime',
      'the disposable live subscription opened with an authoritative snapshot and closed',
    ));
  } catch (error) {
    failure = error?.diagnostic ?? doctorDiagnostic(
      error?.code ?? 'SNAPBACK_DOCTOR_VERTICAL_SLICE_FAILED',
      'doctor',
      error?.message ?? String(error),
    );
  } finally {
    try {
      live?.dispose();
    } catch (error) {
      failure ??= doctorDiagnostic(
        'SNAPBACK_DOCTOR_LIVE_CLOSE_FAILED',
        'realtime',
        'the disposable live subscription did not close cleanly',
        { message: error?.message ?? String(error) },
      );
    }
    try {
      await client?.closeAuth();
      await authCoordinator?.close();
    } catch (error) {
      failure ??= doctorDiagnostic(
        'SNAPBACK_DOCTOR_CLEANUP_FAILED',
        'auth',
        'the disposable doctor auth coordinator did not close cleanly',
        { message: error?.message ?? String(error) },
      );
    }
    if (child?.exitCode === null) {
      const stop = native(runtime.binary, ['stop', '--ready-file', readyFile], {
        cwd: projectRoot,
        env: options.env,
        timeout: 15_000,
      });
      if (stop.status !== 0) {
        failure ??= doctorDiagnostic(
          'SNAPBACK_DOCTOR_SHUTDOWN_FAILED',
          'runtime',
          'the disposable server did not stop through its owned readiness descriptor',
          { status: stop.status, signal: stop.signal, stderr: stop.stderr?.slice(0, 2_000) ?? '' },
        );
      }
      const exited = await stopProcessGroup(child);
      if (!exited) {
        failure ??= doctorDiagnostic(
          'SNAPBACK_DOCTOR_SHUTDOWN_FAILED',
          'runtime',
          'the disposable server did not exit within the shutdown deadline',
        );
      }
    }
    try {
      rmSync(scratch, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
    } catch (error) {
      failure ??= doctorDiagnostic(
        'SNAPBACK_DOCTOR_CLEANUP_FAILED',
        'doctor',
        'the disposable doctor directory could not be removed',
        { path: scratch, message: error?.message ?? String(error) },
      );
    }
  }
  if (failure) {
    return {
      schemaVersion: 'snapback.cli-doctor.v2',
      ok: false,
      runtime,
      runtimeRecovery,
      checks: [...checks, failure],
    };
  }
  checks.push(doctorDiagnostic(
    'SNAPBACK_DOCTOR_SHUTDOWN_OK',
    'runtime',
    'the disposable server stopped and its temporary state was removed',
  ));
  return {
    schemaVersion: 'snapback.cli-doctor.v2',
    ok: true,
    runtime,
    runtimeRecovery,
    checks,
    probe: 'vertical-slice',
  };
}

function safeProjectName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && name !== '.' && name !== '..';
}

function packageVersion() {
  return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;
}

const RELEASE_FILE_MAX = 8_192;
const RELEASE_BYTES_MAX = 256 * 1024 * 1024;
const RELEASE_COMPONENT_PREFIX = 'components/';
const RELEASE_CONTROL_GAPS = [
  ['control-plane.adapter', 'no hosted adapter has completed the target-neutral identity, upload, activation, and interruption contract'],
  ['control-plane.artifact-signature', 'artifact signing and a trusted signing-key identity are not configured'],
  ['control-plane.authenticated-inspection', 'the release has no executed authenticated hosted-inspection receipt'],
  ['control-plane.backup-restore', 'the release has no executed backup read-back and isolated destructive restore drill'],
  ['control-plane.logs', 'the release has no executed structured hosted-log query receipt'],
  ['control-plane.rollback', 'the release has no compatible release pair and executed code-only rollback receipt'],
  ['control-plane.runtime-artifact', 'a hosted runtime/server artifact must be supplied and verified by the selected adapter'],
  ['control-plane.tls-origin', 'the release has no provider-attested public TLS origin'],
  ['release.compatibility-generations', 'minimum and maximum readable schema, retained-client, job, and config generations are not yet modeled'],
  ['release.health-probes', 'generated health and acceptance probe definitions are not yet retained'],
  ['release.migrations', 'no reviewed migration artifact or compatibility plan is retained'],
  ['supply-chain.license-sbom', 'license inventory and SBOM artifacts are not yet retained'],
  ['supply-chain.provenance', 'a separately verifiable build provenance attestation is not yet retained'],
];

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

// RFC 8785 canonical JSON for identities shared with the Rust authority.
// Readiness declarations contain only JSON values, but refusing non-finite or
// otherwise non-JSON members here keeps the cross-language digest fail-closed.
function jcsCanonicalJson(value) {
  if (value === null) return 'null';
  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return JSON.stringify(value);
  if (kind === 'number') {
    if (!Number.isFinite(value)) throw new Error('readiness identity contains a non-finite number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (kind !== 'object') throw new Error(`readiness identity contains a non-JSON ${kind}`);
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${jcsCanonicalJson(value[key])}`,
  ).join(',')}}`;
}

function sha256Jcs(value) {
  return sha256Bytes(Buffer.from(jcsCanonicalJson(value), 'utf8'));
}

function normalizeRelativePath(path) {
  return path.split(sep).join('/');
}

function assertPathInside(parent, child, code = 'SNAPBACK_RELEASE_PATH_INVALID') {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const relation = relative(parentPath, childPath);
  if (relation === '..' || relation.startsWith(`..${sep}`) || relation === '') {
    if (relation === '') return childPath;
    throw diagnosticError(code, 'release input or output escaped its declared root', {
      parent: parentPath,
      child: childPath,
    });
  }
  return childPath;
}

function assertExistingDirectory(path, code = 'SNAPBACK_RELEASE_PATH_INVALID') {
  const absolute = resolve(path);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch (cause) {
    const error = diagnosticError(code, 'release directory does not exist', { path: absolute });
    error.cause = cause;
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw diagnosticError(code, 'release inputs and stores must be non-symlink directories', { path: absolute });
  }
  return realpathSync.native(absolute);
}

function assertDisjointTrees(left, right) {
  const leftPath = resolve(left);
  const rightPath = resolve(right);
  const leftToRight = relative(leftPath, rightPath);
  const rightToLeft = relative(rightPath, leftPath);
  if (
    leftToRight === ''
    || (!leftToRight.startsWith(`..${sep}`) && leftToRight !== '..')
    || (!rightToLeft.startsWith(`..${sep}`) && rightToLeft !== '..')
  ) {
    throw diagnosticError('SNAPBACK_RELEASE_PATH_OVERLAP', 'release output must not contain or be contained by a release input', {
      input: leftPath,
      output: rightPath,
    });
  }
}

function parseJsonFile(path, expectedKind) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_RELEASE_ARTIFACT_INVALID', `could not parse generated artifact ${path}`, { path });
    error.cause = cause;
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.artifactKind !== expectedKind) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_ARTIFACT_INVALID',
      `generated artifact ${path} is not a ${expectedKind}`,
      { path, expectedKind, receivedKind: value?.artifactKind ?? null },
    );
  }
  return value;
}

function runGit(projectRoot, args, code) {
  const result = spawnSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf8',
    env: scrubDynamicLoaderEnvironment(),
    timeout: 15_000,
  });
  if (result.status !== 0) {
    throw diagnosticError(code, 'release source identity could not be resolved from git', {
      operation: args.join(' '),
      status: result.status,
      signal: result.signal ?? null,
      errorCode: result.error?.code ?? null,
      stderr: result.stderr?.slice(0, 2_000) ?? '',
    });
  }
  return result.stdout;
}

function releaseSourceFacts(projectRoot, packageManifest, allowDirty, excludedOutput) {
  const revision = runGit(projectRoot, ['rev-parse', 'HEAD'], 'SNAPBACK_DEPLOY_SOURCE_UNVERSIONED').trim();
  if (!/^[0-9a-f]{40,64}$/i.test(revision)) {
    throw diagnosticError('SNAPBACK_DEPLOY_SOURCE_UNVERSIONED', 'git returned a non-canonical source revision');
  }
  const epochText = runGit(projectRoot, ['show', '-s', '--format=%ct', 'HEAD'], 'SNAPBACK_DEPLOY_SOURCE_UNVERSIONED').trim();
  const sourceDateEpoch = Number(epochText);
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 0) {
    throw diagnosticError('SNAPBACK_DEPLOY_SOURCE_UNVERSIONED', 'git returned an invalid source timestamp');
  }
  const excludedPath = excludedOutput === undefined ? null : normalizeRelativePath(relative(projectRoot, excludedOutput));
  const excludeArguments = excludedPath && excludedPath !== '..' && !excludedPath.startsWith('../')
    ? [`:(exclude)${excludedPath}`, `:(exclude)${excludedPath}/**`]
    : [];
  const status = runGit(
    projectRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ...excludeArguments],
    'SNAPBACK_DEPLOY_SOURCE_STATUS_FAILED',
  );
  const dirtyEntries = status.split('\0').filter(Boolean).sort();
  if (dirtyEntries.length > 0 && !allowDirty) {
    throw diagnosticError(
      'SNAPBACK_DEPLOY_DIRTY_SOURCE',
      'release build refused a dirty source tree; commit the application or pass --allow-dirty for a non-production preview artifact',
      { dirtyEntryCount: dirtyEntries.length },
    );
  }
  const repositoryName = typeof packageManifest.name === 'string' && packageManifest.name.length > 0
    ? packageManifest.name
    : basename(projectRoot);
  return {
    repositoryName,
    revision: revision.toLowerCase(),
    sourceDateEpoch,
    dirty: dirtyEntries.length > 0,
    dirtyPathsSha256: dirtyEntries.length > 0 ? sha256Bytes(Buffer.from(dirtyEntries.join('\0'))) : null,
  };
}

function mediaType(path) {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.mjs') || path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.ts') || path.endsWith('.mts')) return 'text/typescript';
  if (path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

function scanReleaseFile(path, releasePath) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw diagnosticError(
      metadata.isSymbolicLink() ? 'SNAPBACK_RELEASE_SYMLINK_REFUSED' : 'SNAPBACK_RELEASE_FILE_INVALID',
      'release components must be regular, non-symlink files',
      { path: releasePath },
    );
  }
  if (metadata.size > RELEASE_BYTES_MAX) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_BUDGET_EXCEEDED',
      'one release component exceeds the entire v1 byte budget',
      { path: releasePath, bytes: metadata.size, maxBytes: RELEASE_BYTES_MAX },
    );
  }
  const lower = releasePath.toLowerCase();
  const segments = lower.split('/');
  const leaf = segments.at(-1);
  if (
    leaf === '.env'
    || leaf?.startsWith('.env.')
    || leaf === '.npmrc'
    || leaf?.endsWith('.pem')
    || leaf?.endsWith('.key')
    || leaf?.endsWith('.p12')
    || leaf?.endsWith('.sqlite')
    || leaf?.endsWith('.sqlite3')
    || leaf?.endsWith('.db')
    || leaf?.endsWith('.map')
    || lower.includes('admin-token')
    || lower.endsWith('.ready.json')
  ) {
    throw diagnosticError(
      leaf?.endsWith('.map') ? 'SNAPBACK_RELEASE_SOURCE_MAP_REFUSED' : 'SNAPBACK_RELEASE_FORBIDDEN_FILE',
      'release input contains a forbidden secret/state/source-map file class',
      { path: releasePath },
    );
  }
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  // Each pattern demands actual secret material, not the vocabulary around
  // it: a PEM header must be followed by a base64 body (the header string
  // alone is a constant in any code that FORMATS keys — the embedded crypto
  // shim carries one), and a credential assignment must carry a token-shaped
  // value (documentation placeholders like `...` are not credentials). Real
  // keys and real tokens still refuse.
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\r|\\n|\s)+[A-Za-z0-9+/=\\]{40,}/,
    /(?:^|[^A-Za-z0-9_])npm_[A-Za-z0-9]{30,}/,
    /(?:^|[^A-Za-z0-9_])gh[oprsu]_[A-Za-z0-9]{30,}/,
    /(?:CLOUDFLARE_API_TOKEN|NPM_TOKEN)\s*=\s*[A-Za-z0-9_-]{16,}/,
  ];
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_SECRET_SCAN_FAILED',
      'release input matched a forbidden credential pattern',
      { path: releasePath, received: 'redacted credential pattern' },
    );
  }
  return {
    sourcePath: path,
    path: `${RELEASE_COMPONENT_PREFIX}${releasePath}`,
    sha256: sha256Bytes(bytes),
    bytes: bytes.byteLength,
    mediaType: mediaType(releasePath),
  };
}

function collectReleaseTree(root, releasePrefix) {
  const releaseRoot = assertExistingDirectory(root);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = normalizeRelativePath(relative(releaseRoot, path));
      const releasePath = `${releasePrefix}/${relativePath}`;
      if (entry.isSymbolicLink()) {
        throw diagnosticError('SNAPBACK_RELEASE_SYMLINK_REFUSED', 'release trees may not contain symlinks', { path: releasePath });
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        if (files.length >= RELEASE_FILE_MAX) {
          throw diagnosticError(
            'SNAPBACK_RELEASE_BUDGET_EXCEEDED',
            'one release input tree exceeds the v1 file budget',
            { path: releasePrefix, files: files.length + 1, maxFiles: RELEASE_FILE_MAX },
          );
        }
        files.push(scanReleaseFile(path, releasePath));
      }
      else throw diagnosticError('SNAPBACK_RELEASE_FILE_INVALID', 'release trees may contain only directories and regular files', { path: releasePath });
    }
  };
  visit(releaseRoot);
  return files;
}

// EM_X86_64 is 62. The staged hosted runtime is validated by its ELF header
// bytes, never by the packaging host's platform (LLP 0041 runtime
// distribution rule, reused here for release staging).
function elfMachineType(bytes) {
  if (bytes.byteLength < 20 || bytes[0] !== 0x7f || bytes.toString('ascii', 1, 4) !== 'ELF') return null;
  return bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18);
}

const RUNTIME_ARTIFACT_PLATFORMS = new Map([
  // platform → [expected ELF machine, component subpaths]
  ['linux-x64', 62],
]);

// @ref LLP 0072#release-artifact — the hosted runtime/server artifact enters
// the immutable closure as ordinary scanned components plus a closed
// `runtimeArtifact` manifest fact (platform, digests, and the pinned Hermes
// bundle identity), replacing the Dockerfile side-channel. Supplying it
// narrows the `control-plane.runtime-artifact` GAP to the adapter-verification
// half; it never claims on-target verification.
function stageRuntimeArtifact(options) {
  if (!options.runtimeArtifactDirectory) {
    if (options.runtimePlatform || options.hermesBundleIdentity) {
      throw diagnosticError(
        'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
        '--runtime-platform and --runtime-hermes-bundle require --runtime-artifact',
      );
    }
    return { components: [], fact: null };
  }
  const root = assertExistingDirectory(options.runtimeArtifactDirectory, 'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID');
  const platform = options.runtimePlatform ?? null;
  const expectedMachine = RUNTIME_ARTIFACT_PLATFORMS.get(platform);
  if (expectedMachine === undefined) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
      'runtime artifact staging requires --runtime-platform naming an admitted platform',
      { platform, admitted: [...RUNTIME_ARTIFACT_PLATFORMS.keys()] },
    );
  }
  const identity = options.hermesBundleIdentity;
  if (typeof identity !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{3,199}$/.test(identity)) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
      'runtime artifact staging requires --runtime-hermes-bundle with the checksum-verified bundle identity',
      { received: typeof identity },
    );
  }
  const binarySource = join(root, 'bin', 'snapback');
  const hermesSource = join(root, 'lib', 'libhermesvm.so');
  for (const [path, name] of [[binarySource, 'bin/snapback'], [hermesSource, 'lib/libhermesvm.so']]) {
    if (!existsSync(path)) {
      throw diagnosticError(
        'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
        `runtime artifact directory is missing ${name} (expected the @expo/snapback-runtime-${platform} package layout)`,
        { path: name },
      );
    }
    const machine = elfMachineType(readFileSync(path));
    if (machine !== expectedMachine) {
      throw diagnosticError(
        'SNAPBACK_RELEASE_RUNTIME_ARTIFACT_INVALID',
        `runtime artifact ${name} is not a ${platform} ELF executable`,
        { path: name, expectedMachine, observedMachine: machine },
      );
    }
  }
  const binaryComponent = scanReleaseFile(binarySource, `runtime/${platform}/bin/snapback`);
  const hermesComponent = scanReleaseFile(hermesSource, `runtime/${platform}/lib/libhermesvm.so`);
  return {
    components: [binaryComponent, hermesComponent],
    fact: {
      platform,
      hermesBundleIdentity: identity,
      binaryPath: binaryComponent.path,
      binarySha256: binaryComponent.sha256,
      binaryBytes: binaryComponent.bytes,
      hermesLibraryPath: hermesComponent.path,
      hermesLibrarySha256: hermesComponent.sha256,
      hermesLibraryBytes: hermesComponent.bytes,
    },
  };
}

function assertReleaseBudget(components) {
  const totalBytes = components.reduce((sum, component) => sum + component.bytes, 0);
  if (components.length === 0 || components.length > RELEASE_FILE_MAX || totalBytes > RELEASE_BYTES_MAX) {
    throw diagnosticError(
      'SNAPBACK_RELEASE_BUDGET_EXCEEDED',
      'release component closure exceeded the v1 file or byte budget',
      { files: components.length, bytes: totalBytes, maxFiles: RELEASE_FILE_MAX, maxBytes: RELEASE_BYTES_MAX },
    );
  }
  return totalBytes;
}

function digestField(value, name) {
  if (typeof value === 'string' && /^sha256:[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) return `sha256:${value.toLowerCase()}`;
  throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_INVALID', `${name} is not a full SHA-256 digest`, {
    field: name,
    received: typeof value,
  });
}

function releaseContentId(content) {
  return sha256Bytes(Buffer.from(`snapback-release-manifest-v1\0${canonicalJson(content)}`));
}

function assertClosedKeys(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', `${name} must be an object`);
  }
  const expected = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', `${name} has a noncanonical shape`, { unexpected, missing });
  }
}

export function verifyRelease(releaseDirectory) {
  const root = assertExistingDirectory(releaseDirectory, 'SNAPBACK_RELEASE_MANIFEST_INVALID');
  const manifestPath = join(root, 'release.manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release manifest is missing or invalid JSON', { manifestPath });
    error.cause = cause;
    throw error;
  }
  const manifestKeys = [
    'artifactKind', 'schemaVersion', 'releaseId', 'projectId', 'targetProfileId',
    'activationEligible', 'source', 'toolchain', 'compatibility', 'requiredCapabilities',
    'runtimeArtifact', 'components', 'scan', 'gaps',
  ];
  assertClosedKeys(manifest, manifestKeys, 'release manifest');
  assertClosedKeys(manifest.source, ['repositoryName', 'revision', 'sourceDateEpoch', 'dirty', 'dirtyPathsSha256'], 'release source');
  assertClosedKeys(manifest.toolchain, ['snapbackCliVersion', 'nodeVersion', 'packageManager'], 'release toolchain');
  assertClosedKeys(
    manifest.compatibility,
    ['schemaVersion', 'authMode', 'schemaSha256', 'functionsSha256', 'capabilitySha256', 'inputsSha256'],
    'release compatibility',
  );
  assertClosedKeys(manifest.scan, ['secretScan', 'sourceMaps', 'symlinks', 'scannedFiles', 'scannedBytes'], 'release scan');
  if (
    manifest.artifactKind !== 'releaseManifest'
    || manifest.schemaVersion !== 'snapback.release-manifest.v1'
    || !Array.isArray(manifest.components)
    || manifest.activationEligible !== false
  ) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release manifest has an unsupported identity or eligibility posture');
  }
  if (
    typeof manifest.projectId !== 'string'
    || manifest.projectId.length === 0
    || typeof manifest.targetProfileId !== 'string'
    || manifest.targetProfileId.length === 0
    || typeof manifest.source.repositoryName !== 'string'
    || manifest.source.repositoryName.length === 0
    || !/^[0-9a-f]{40,64}$/.test(manifest.source.revision)
    || !Number.isSafeInteger(manifest.source.sourceDateEpoch)
    || manifest.source.sourceDateEpoch < 0
    || typeof manifest.source.dirty !== 'boolean'
    || (manifest.source.dirty ? !/^sha256:[0-9a-f]{64}$/.test(manifest.source.dirtyPathsSha256 ?? '') : manifest.source.dirtyPathsSha256 !== null)
    || typeof manifest.toolchain.snapbackCliVersion !== 'string'
    || typeof manifest.toolchain.nodeVersion !== 'string'
    || !(manifest.toolchain.packageManager === null || typeof manifest.toolchain.packageManager === 'string')
  ) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release identity or toolchain facts are malformed');
  }
  for (const name of ['schemaSha256', 'functionsSha256', 'capabilitySha256', 'inputsSha256']) {
    digestField(manifest.compatibility[name], `compatibility.${name}`);
  }
  if (
    typeof manifest.compatibility.schemaVersion !== 'string'
    || typeof manifest.compatibility.authMode !== 'string'
    || !Array.isArray(manifest.requiredCapabilities)
    || manifest.requiredCapabilities.some((capability) => typeof capability !== 'string' || capability.length === 0)
    || new Set(manifest.requiredCapabilities).size !== manifest.requiredCapabilities.length
    || [...manifest.requiredCapabilities].sort().some((capability, index) => capability !== manifest.requiredCapabilities[index])
    || !Array.isArray(manifest.gaps)
  ) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release compatibility, capability, or GAP facts are malformed');
  }
  const gapIds = new Set();
  for (const gap of manifest.gaps) {
    assertClosedKeys(gap, ['id', 'reason', 'blocking'], 'release GAP');
    if (
      typeof gap.id !== 'string'
      || gap.id.length === 0
      || gapIds.has(gap.id)
      || typeof gap.reason !== 'string'
      || gap.reason.length === 0
      || gap.blocking !== true
    ) {
      throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release GAP is malformed, duplicated, or non-blocking');
    }
    gapIds.add(gap.id);
  }
  const { releaseId, ...content } = manifest;
  if (releaseContentId(content) !== releaseId) {
    throw diagnosticError('SNAPBACK_RELEASE_ID_MISMATCH', 'release id does not match the canonical manifest content', { releaseId });
  }
  const declared = new Set(['release.manifest.json']);
  let totalBytes = 0;
  for (const component of manifest.components) {
    assertClosedKeys(component, ['path', 'sha256', 'bytes', 'mediaType'], 'release component');
    const componentSegments = typeof component.path === 'string' ? component.path.split('/') : [];
    if (
      typeof component.path !== 'string'
      || !component.path.startsWith(RELEASE_COMPONENT_PREFIX)
      || component.path.includes('\\')
      || componentSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
      || declared.has(component.path)
      || !/^sha256:[0-9a-f]{64}$/.test(component.sha256)
      || !Number.isSafeInteger(component.bytes)
      || component.bytes < 0
      || typeof component.mediaType !== 'string'
      || component.mediaType.length === 0
    ) {
      throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release component path is invalid or duplicated', { path: component.path });
    }
    declared.add(component.path);
    const path = assertPathInside(root, join(root, ...componentSegments), 'SNAPBACK_RELEASE_PATH_INVALID');
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch (cause) {
      const error = diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release component is missing', { path: component.path });
      error.cause = cause;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release component is missing or no longer a regular file', { path: component.path });
    }
    const bytes = readFileSync(path);
    if (bytes.byteLength !== component.bytes || sha256Bytes(bytes) !== component.sha256) {
      throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release component bytes do not match the retained digest', { path: component.path });
    }
    totalBytes += bytes.byteLength;
  }
  if (manifest.runtimeArtifact !== null) {
    assertClosedKeys(
      manifest.runtimeArtifact,
      [
        'platform', 'hermesBundleIdentity', 'binaryPath', 'binarySha256', 'binaryBytes',
        'hermesLibraryPath', 'hermesLibrarySha256', 'hermesLibraryBytes',
      ],
      'release runtime artifact',
    );
    const fact = manifest.runtimeArtifact;
    const expectedMachine = RUNTIME_ARTIFACT_PLATFORMS.get(fact.platform);
    const byPath = new Map(manifest.components.map((component) => [component.path, component]));
    if (
      expectedMachine === undefined
      || typeof fact.hermesBundleIdentity !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{3,199}$/.test(fact.hermesBundleIdentity)
    ) {
      throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release runtime artifact has an unsupported platform or bundle identity');
    }
    for (const [pathField, shaField, bytesField] of [
      ['binaryPath', 'binarySha256', 'binaryBytes'],
      ['hermesLibraryPath', 'hermesLibrarySha256', 'hermesLibraryBytes'],
    ]) {
      const component = byPath.get(fact[pathField]);
      if (!component || component.sha256 !== fact[shaField] || component.bytes !== fact[bytesField]) {
        throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release runtime artifact facts do not match a retained component', {
          path: fact[pathField] ?? null,
        });
      }
      // The staged bytes were already digest-verified above; the ELF header
      // re-check keeps the platform claim honest against the actual closure.
      const staged = readFileSync(join(root, ...component.path.split('/')));
      if (elfMachineType(staged) !== expectedMachine) {
        throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release runtime artifact is not the claimed platform ELF', {
          path: component.path,
        });
      }
    }
  }
  const observed = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release closure contains a symlink', { path: normalizeRelativePath(relative(root, path)) });
      }
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) observed.add(normalizeRelativePath(relative(root, path)));
      else throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release closure contains a non-file entry');
    }
  };
  visit(root);
  if (observed.size !== declared.size || [...observed].some((path) => !declared.has(path))) {
    throw diagnosticError('SNAPBACK_RELEASE_ARTIFACT_TAMPERED', 'release closure contains undeclared or missing files', {
      declaredFiles: declared.size,
      observedFiles: observed.size,
    });
  }
  if (
    manifest.scan.secretScan !== 'passed'
    || manifest.scan.sourceMaps !== 'refused'
    || manifest.scan.symlinks !== 'refused'
    || manifest.scan.scannedFiles !== manifest.components.length
    || manifest.scan.scannedBytes !== totalBytes
  ) {
    throw diagnosticError('SNAPBACK_RELEASE_MANIFEST_INVALID', 'release scan facts do not match the retained closure');
  }
  return {
    schemaVersion: 'snapback.release-verification.v1',
    ok: true,
    releaseId,
    manifestPath,
    manifestSha256: sha256Bytes(readFileSync(manifestPath)),
    componentCount: manifest.components.length,
    totalBytes,
    activationEligible: false,
    gaps: manifest.gaps,
  };
}

function makeReadOnlyTree(root) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else chmodSync(path, 0o444);
    }
  };
  visit(root);
}

// @ref LLP 0072#release-artifact — build and retain the target-neutral,
// content-addressed closure before any provider credential or activation
// authority is used.
export async function buildRelease(options = {}) {
  const backendRoot = assertExistingDirectory(options.backendDirectory ?? 'snapback');
  const projectRoot = assertExistingDirectory(options.projectRoot ?? dirname(backendRoot));
  assertPathInside(projectRoot, backendRoot, 'SNAPBACK_RELEASE_PATH_INVALID');
  const requestedOutputRoot = resolve(options.outputDirectory ?? join(projectRoot, '.snapback', 'releases'));
  assertDisjointTrees(backendRoot, requestedOutputRoot);
  if (options.webDirectory) assertDisjointTrees(resolve(options.webDirectory), requestedOutputRoot);
  const targetProfile = options.targetProfile ?? 'local-dev-sqlite-ibex';
  const generated = await generateApp(backendRoot, {
    targetProfile,
    appBindingMode: 'release',
  });
  if (!generated.ok) {
    throw diagnosticError('SNAPBACK_DEPLOY_GENERATION_FAILED', 'release generation failed', { diagnostics: generated.diagnostics ?? [] });
  }
  const generatedRoot = generated.outDir;
  const verifiedGenerated = verifyGeneratedGraph(generatedRoot);
  const schemaPath = resolveGeneratedArtifact(generatedRoot, 'schema.manifest.json');
  const functionsPath = resolveGeneratedArtifact(generatedRoot, 'functions.manifest.json');
  const capabilityPath = resolveGeneratedArtifact(generatedRoot, 'capability.manifest.json');
  const schemaManifest = parseJsonFile(schemaPath, 'schemaManifest');
  const functionsManifest = parseJsonFile(functionsPath, 'functionManifest');
  const capabilityManifest = parseJsonFile(capabilityPath, 'capabilityManifest');
  if (
    typeof schemaManifest.appId !== 'string'
    || schemaManifest.appId.length === 0
    || functionsManifest.appId !== schemaManifest.appId
    || functionsManifest.schemaVersion !== schemaManifest.schemaVersion
    || functionsManifest.inputsHash !== schemaManifest.inputsHash
    || capabilityManifest.schemaVersion !== schemaManifest.schemaVersion
  ) {
    throw diagnosticError(
      'SNAPBACK_DEPLOY_GENERATED_IDENTITY_MISMATCH',
      'generated schema, function, and capability artifacts do not describe one application build',
      {
        schemaAppId: schemaManifest.appId ?? null,
        functionsAppId: functionsManifest.appId ?? null,
        schemaVersion: schemaManifest.schemaVersion ?? null,
        functionsSchemaVersion: functionsManifest.schemaVersion ?? null,
        capabilitySchemaVersion: capabilityManifest.schemaVersion ?? null,
      },
    );
  }
  if (capabilityManifest.targetProfileId !== targetProfile) {
    throw diagnosticError('SNAPBACK_DEPLOY_TARGET_PROFILE_MISMATCH', 'generated capability manifest names a different target profile', {
      expected: targetProfile,
      observed: capabilityManifest.targetProfileId ?? null,
    });
  }

  let packageManifest;
  try {
    packageManifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_DEPLOY_PACKAGE_MANIFEST_INVALID', 'project package.json is required for release identity');
    error.cause = cause;
    throw error;
  }
  const source = releaseSourceFacts(projectRoot, packageManifest, options.allowDirty === true, requestedOutputRoot);
  const requiredCapabilities = [...new Set([
    ...(schemaManifest.requiredCapabilities ?? []),
    ...((functionsManifest.functions ?? []).flatMap((definition) => definition.requiredCapabilities ?? [])),
  ])].sort();
  const supportedCapabilities = new Set(capabilityManifest.supportedCapabilities ?? []);
  const unsupported = requiredCapabilities.filter((capability) => !supportedCapabilities.has(capability));
  if (unsupported.length > 0) {
    throw diagnosticError('SNAPBACK_DEPLOY_CAPABILITY_MISMATCH', 'target profile does not support every generated function requirement', {
      targetProfile,
      unsupported,
    });
  }

  let components = collectReleaseTree(verifiedGenerated.graphRoot, 'app');
  for (const name of ['package.json', 'bun.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    const path = join(projectRoot, name);
    if (existsSync(path)) components.push(scanReleaseFile(path, `meta/${name}`));
  }
  if (options.webDirectory) {
    const webRoot = assertExistingDirectory(options.webDirectory);
    assertPathInside(projectRoot, webRoot, 'SNAPBACK_RELEASE_PATH_INVALID');
    components.push(...collectReleaseTree(webRoot, 'web'));
  }
  const runtimeArtifact = stageRuntimeArtifact(options);
  components.push(...runtimeArtifact.components);
  components = components.sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = assertReleaseBudget(components);
  const gaps = [
    ...(capabilityManifest.capabilityGaps ?? []).map((gap) => ({
      id: `capability.${gap}`,
      reason: `target capability manifest reports ${gap} as unsupported`,
      blocking: true,
    })),
    ...RELEASE_CONTROL_GAPS.map(([id, reason]) => (
      id === 'control-plane.runtime-artifact' && runtimeArtifact.fact !== null
        ? {
          id: 'control-plane.runtime-artifact-adapter-verification',
          reason: 'the staged hosted runtime artifact has not been verified on-target by the selected adapter',
          blocking: true,
        }
        : { id, reason, blocking: true }
    )),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const content = {
    artifactKind: 'releaseManifest',
    schemaVersion: 'snapback.release-manifest.v1',
    projectId: schemaManifest.appId ?? source.repositoryName,
    targetProfileId: targetProfile,
    activationEligible: false,
    source,
    toolchain: {
      snapbackCliVersion: packageVersion(),
      nodeVersion: process.version,
      packageManager: typeof packageManifest.packageManager === 'string' ? packageManifest.packageManager : null,
    },
    compatibility: {
      schemaVersion: schemaManifest.schemaVersion,
      authMode: schemaManifest.auth?.mode ?? 'dev',
      schemaSha256: sha256Bytes(readFileSync(schemaPath)),
      functionsSha256: sha256Bytes(readFileSync(functionsPath)),
      capabilitySha256: sha256Bytes(readFileSync(capabilityPath)),
      inputsSha256: digestField(schemaManifest.inputsHash, 'schemaManifest.inputsHash'),
    },
    requiredCapabilities,
    runtimeArtifact: runtimeArtifact.fact,
    components: components.map(({ sourcePath: _sourcePath, ...component }) => component),
    scan: {
      secretScan: 'passed',
      sourceMaps: 'refused',
      symlinks: 'refused',
      scannedFiles: components.length,
      scannedBytes: totalBytes,
    },
    gaps,
  };
  const releaseId = releaseContentId(content);
  const manifest = { ...content, releaseId };
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`);
  mkdirSync(requestedOutputRoot, { recursive: true });
  const outputRoot = assertExistingDirectory(requestedOutputRoot, 'SNAPBACK_RELEASE_PATH_INVALID');
  assertDisjointTrees(backendRoot, outputRoot);
  if (options.webDirectory) assertDisjointTrees(assertExistingDirectory(options.webDirectory), outputRoot);
  const finalRoot = join(outputRoot, releaseId.slice('sha256:'.length));
  let state = 'built';
  if (existsSync(finalRoot)) {
    const verified = verifyRelease(finalRoot);
    if (verified.releaseId !== releaseId) {
      throw diagnosticError('SNAPBACK_RELEASE_ID_COLLISION', 'an existing release directory has a different identity', { releaseId });
    }
    state = 'reused';
  } else {
    const stageRoot = mkdtempSync(join(outputRoot, '.release-stage-'));
    try {
      for (const component of components) {
        const destination = join(stageRoot, ...component.path.split('/'));
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(component.sourcePath, destination);
        const copied = readFileSync(destination);
        if (copied.byteLength !== component.bytes || sha256Bytes(copied) !== component.sha256) {
          throw diagnosticError('SNAPBACK_RELEASE_COPY_MISMATCH', 'release component changed while it was copied', { path: component.path });
        }
      }
      writeFileSync(join(stageRoot, 'release.manifest.json'), manifestBytes, { flag: 'wx', mode: 0o444 });
      let committed = false;
      try {
        renameSync(stageRoot, finalRoot);
        committed = true;
      } catch (cause) {
        if (!existsSync(finalRoot)) {
          const error = diagnosticError(
            'SNAPBACK_RELEASE_STORE_COMMIT_FAILED',
            'the verified release staging directory could not be committed atomically',
            { releaseId },
          );
          error.cause = cause;
          throw error;
        }
        const concurrentlyRetained = verifyRelease(finalRoot);
        if (concurrentlyRetained.releaseId !== releaseId) {
          throw diagnosticError(
            'SNAPBACK_RELEASE_ID_COLLISION',
            'a concurrently retained release directory has a different identity',
            { releaseId },
          );
        }
        rmSync(stageRoot, { recursive: true, force: true });
        state = 'reused';
      }
      if (committed) makeReadOnlyTree(finalRoot);
    } catch (error) {
      if (existsSync(stageRoot)) rmSync(stageRoot, { recursive: true, force: true });
      throw error;
    }
  }
  const verified = verifyRelease(finalRoot);
  return {
    ...verified,
    schemaVersion: 'snapback.deploy-build.v1',
    ok: true,
    state,
    releaseDirectory: finalRoot,
    sourceDirty: source.dirty,
    targetProfileId: targetProfile,
  };
}

// @ref LLP 0186#w2--context-injection-surface-owned-here — the packaged
// template directory is the single scaffold registry; wrappers such as
// `create-snapback-app` enumerate it instead of carrying their own copy.
export function listTemplates() {
  return readdirSync(join(packageRoot, 'templates'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const scaffoldAuthoringSkillFiles = [
  '.claude/skills/snapback-authoring/SKILL.md',
  '.agents/skills/snapback-authoring/SKILL.md',
  '.cursor/skills/snapback-authoring/SKILL.md',
  '.opencode/skills/snapback-authoring/SKILL.md',
];

export function renderScaffoldAuthoringSkill(canonicalContent) {
  const note = '> Scaffolded app: use `snapback guide <query>` or, while dev runs, `/_snapback/guide/<path>` at the printed server origin.';
  // The diaries/issues bullet is a checkout-only obligation (AGENTS.md); a
  // scaffold has no repository, so the consumer form drops it to stay inside
  // the LLP 0259 per-skill budget without losing any instruction that applies.
  const checkoutOnlyBullet = /^- In this repository, record the build experience[\s\S]*?skip this bullet\.\n/mu;
  return canonicalContent
    .replace(checkoutOnlyBullet, '')
    .replaceAll('](../../guide/', '](/_snapback/guide/')
    .replace('# snapback-authoring\n', `# snapback-authoring\n\n${note}\n`);
}

const SCAFFOLD_LIFECYCLE_STAGES = Object.freeze(['generate', 'dev', 'prove']);

export function validateScaffoldLifecycleManifest(manifest, { template = 'unknown' } = {}) {
  for (const stage of SCAFFOLD_LIFECYCLE_STAGES) {
    if (typeof manifest?.scripts?.[stage] !== 'string' || manifest.scripts[stage].trim() === '') {
      throw diagnosticError(
        'SNAPBACK_SCAFFOLD_LIFECYCLE_STAGE_MISSING',
        `template ${template} is missing scaffold lifecycle stage ${stage}`,
        {
          template,
          stage,
          requiredStages: [...SCAFFOLD_LIFECYCLE_STAGES],
          guideAnchor: '/_snapback/guide/start/index.md',
        },
      );
    }
  }
  return Object.freeze({
    schemaVersion: 'snapback.scaffold-lifecycle.v1',
    stages: Object.freeze(['scaffold', 'install', ...SCAFFOLD_LIFECYCLE_STAGES]),
    scripts: Object.freeze(Object.fromEntries(
      SCAFFOLD_LIFECYCLE_STAGES.map((stage) => [stage, manifest.scripts[stage]]),
    )),
  });
}

export function scaffoldApp(target, options = {}) {
  const template = options.template ?? 'todo-contract';
  const destination = resolve(target);
  if (!safeProjectName(destination.split(/[/\\]/).pop())) {
    throw diagnosticError('SNAPBACK_NEW_NAME_INVALID', `invalid Snapback project name: ${target}`);
  }
  if (existsSync(destination)) {
    throw diagnosticError('SNAPBACK_NEW_TARGET_EXISTS', `refusing to overwrite existing target ${destination}`, { target: destination });
  }
  const templateRoot = join(packageRoot, 'templates', template);
  if (!existsSync(templateRoot)) {
    throw diagnosticError('SNAPBACK_NEW_TEMPLATE_UNKNOWN', `unknown template ${template}`, { template });
  }
  // @ref LLP 0275#d8-explicit-profile-classification-under-llp-0295-d03-2026-08-21
  // — recurring lifecycle wiring is scaffold-owned environment ceremony.
  // Validate the packed template before output so a missing stage is named
  // rather than discovered after install or during a developer's first run.
  const templateManifest = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8'));
  const lifecycle = validateScaffoldLifecycleManifest(templateManifest, { template });
  cpSync(templateRoot, destination, { recursive: true, errorOnExist: true });
  const packedGitignore = join(destination, 'gitignore.template');
  if (existsSync(packedGitignore)) {
    cpSync(packedGitignore, join(destination, '.gitignore'));
    rmSync(packedGitignore);
  }
  const manifestPath = join(destination, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.name = destination.split(/[/\\]/).pop().toLowerCase();
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, value] of Object.entries(manifest[section] ?? {})) {
      if (value === '__SNAPBACK_VERSION__') manifest[section][name] = `^${packageVersion()}`;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // @ref LLP 0186#w2--context-injection-surface-owned-here — the packaged
  // copy is drift-checked against the canonical skill; guide links target the
  // served corpus because a scaffold has no Snapback repository checkout.
  const canonicalSkill = readFileSync(
    join(packageRoot, 'skills', 'snapback-authoring', 'SKILL.md'),
    'utf8',
  );
  const renderedSkill = renderScaffoldAuthoringSkill(canonicalSkill);
  for (const skillFile of scaffoldAuthoringSkillFiles) {
    const skillPath = join(destination, skillFile);
    mkdirSync(dirname(skillPath), { recursive: true });
    writeFileSync(skillPath, renderedSkill);
  }
  return {
    schemaVersion: 'snapback.scaffold.v1',
    ok: true,
    template,
    target: destination,
    lifecycle,
    skillFiles: [...scaffoldAuthoringSkillFiles],
  };
}

function initSiblingScaffoldWorkaround() {
  return [
    `npx --yes @expo/snapback-cli@${packageVersion()} new ../snapback-backend-scaffold --template react`,
    'cp -R ../snapback-backend-scaffold/snapback ./snapback',
  ].join(' && ');
}

const INIT_APP_PROFILES = Object.freeze({
  expo: Object.freeze({
    id: 'create-expo-app',
    dependencies: Object.freeze([
      '@expo/snapback-cli',
      '@expo/snapback-client',
      '@expo/snapback-codegen',
      '@expo/snapback-expo',
      '@expo/snapback-react',
    ]),
    nativeDependencies: Object.freeze([
      'expo-file-system',
      'expo-crypto',
      'expo-image-picker',
    ]),
    supportedDependency: 'expo',
    supportedRange: '>=57.0.0 <58.0.0',
    supportedMajor: 57,
  }),
  react: Object.freeze({
    id: 'packaged-react-scaffold',
    dependencies: Object.freeze([
      '@expo/snapback-cli',
      '@expo/snapback-client',
      '@expo/snapback-codegen',
      '@expo/snapback-react',
      '@expo/snapback-vite',
    ]),
    nativeDependencies: Object.freeze([]),
    supportedDependency: 'vite',
    supportedRange: '^8.0.0',
    supportedMajor: 8,
  }),
});

const INIT_REACT_PROVIDER_FILE = 'src/snapback-init-provider.tsx';
const INIT_REACT_VIRTUAL_MODULE_FILE = 'src/snapback-dev.d.ts';
const INIT_SEAM_MARKER = '@snapback-init seam v1';
const INIT_EXPO_ROUTER_SDK_57_LAYOUT = `import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
`;
const INIT_EXPO_ROUTER_BLANK_LAYOUT = `import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack />;
}
`;
const INIT_REACT_PROVIDER_SOURCE = `import type { PropsWithChildren } from 'react';
import { SnapbackClient } from '@expo/snapback-client';
import { SnapbackProvider, createSnapbackReactProvider } from '@expo/snapback-react';
import { snapbackBasePath } from 'virtual:snapback/dev';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';

const client = new SnapbackClient(snapbackBasePath);
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);

export function SnapbackInitProvider({ children }: PropsWithChildren) {
  return <SnapbackProvider provider={provider}>{children}</SnapbackProvider>;
}
`;
const INIT_REACT_VIRTUAL_MODULE_SOURCE = `declare module 'virtual:snapback/dev' {
  export const snapbackBasePath: string;
  export const snapbackDevState: Readonly<{
    mode: 'off' | 'external' | 'attach' | 'managed' | 'auto';
    shape: string | null;
    ready: boolean;
    basePath: string;
  }>;
}
`;

function initRefusal(code, message, root, details = {}) {
  return diagnosticError(code, message, {
    root,
    ...(code === 'SNAPBACK_INIT_ROOT_UNRECOGNIZED'
      ? { siblingScaffoldWorkaround: initSiblingScaffoldWorkaround() }
      : {}),
    ...details,
  });
}

function isInitRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stripInitJsonComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let hasComments = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === '/' && next === '/') {
      hasComments = true;
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') {
        output += ' ';
        index += 1;
      }
      if (index < source.length) output += source[index];
      continue;
    }
    if (character === '/' && next === '*') {
      hasComments = true;
      output += '  ';
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        output += source[index] === '\n' || source[index] === '\r' ? source[index] : ' ';
        index += 1;
      }
      if (index < source.length) {
        output += '  ';
        index += 1;
      }
      continue;
    }
    output += character;
  }
  return { source: output, hasComments };
}

function stripInitJsonTrailingCommas(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (character === ',') {
      let next = index + 1;
      while (next < source.length && /\s/u.test(source[next])) next += 1;
      if (source[next] === '}' || source[next] === ']') continue;
    }
    output += character;
  }
  return output;
}

function parseInitJsonc(source) {
  const stripped = stripInitJsonComments(source);
  return {
    value: JSON.parse(stripInitJsonTrailingCommas(stripped.source)),
    hasComments: stripped.hasComments,
  };
}

function readInitJson(path, root, description, options = {}) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    const error = initRefusal(
      'SNAPBACK_INIT_CONFIG_INVALID',
      `snapback init could not read ${description}; no files were changed`,
      root,
      { path, config: description },
    );
    error.cause = cause;
    throw error;
  }
  try {
    const parsed = options.jsonc === true
      ? parseInitJsonc(source)
      : { value: JSON.parse(source), hasComments: false };
    return { source, ...parsed };
  } catch (cause) {
    const error = initRefusal(
      'SNAPBACK_INIT_CONFIG_INVALID',
      `snapback init could not parse ${description}${options.jsonc === true ? ' as JSONC' : ' as JSON'}; fix that file and rerun (no files were changed)`,
      root,
      { path, config: description, jsoncAccepted: options.jsonc === true },
    );
    error.cause = cause;
    throw error;
  }
}

function initDependencies(manifest) {
  return {
    ...(isInitRecord(manifest.devDependencies) ? manifest.devDependencies : {}),
    ...(isInitRecord(manifest.dependencies) ? manifest.dependencies : {}),
  };
}

function initFileExists(root, path, kind = 'file') {
  try {
    const metadata = statSync(join(root, path));
    return kind === 'directory' ? metadata.isDirectory() : metadata.isFile();
  } catch {
    return false;
  }
}

function initPathInside(root, path) {
  const offset = relative(root, path);
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`));
}

function initContainedPath(root, path, label) {
  let cursor = path;
  let canonical;
  while (true) {
    try {
      canonical = realpathSync.native(cursor);
      break;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) {
        throw initRefusal(
          'SNAPBACK_INIT_PATH_ESCAPE',
          `snapback init could not resolve a contained path for ${label} (${path}); no files were changed`,
          root,
          { path, label },
        );
      }
      cursor = parent;
    }
  }
  if (!initPathInside(root, canonical)) {
    throw initRefusal(
      'SNAPBACK_INIT_PATH_ESCAPE',
      `snapback init refuses ${label} because ${path} resolves outside the canonical app root ${root}`,
      root,
      { path, canonicalPath: canonical, label },
    );
  }
  if (cursor === path) return canonical;
  return join(canonical, relative(cursor, path));
}

// @ref LLP 0261#design — create-expo-app has shipped both a root `app/` and a
// `src/app/` Router root; each is recognized, and a root carrying both stays
// ambiguous rather than guessing which one owns the layout.
const INIT_EXPO_ROUTER_ROOTS = Object.freeze(['app', 'src/app']);

function detectInitRouterRoots(root) {
  return INIT_EXPO_ROUTER_ROOTS.filter((candidate) => (
    initFileExists(root, candidate, 'directory')
      && initFileExists(root, `${candidate}/_layout.tsx`)
  ));
}

// @ref LLP 0261#design — v1 recognizes only the two evidence-backed root
// shapes; every other frontend refuses instead of receiving guessed edits.
function detectInitApp(root, manifest) {
  const dependencies = initDependencies(manifest);
  const routerRoots = detectInitRouterRoots(root);
  const expoFacts = {
    expoDependency: typeof dependencies.expo === 'string',
    reactNativeDependency: typeof dependencies['react-native'] === 'string',
    appConfig: initFileExists(root, 'app.json'),
    appEntry: initFileExists(root, 'App.tsx'),
    registrationEntry: initFileExists(root, 'index.ts'),
    routerDependency: typeof dependencies['expo-router'] === 'string',
    routerRoots,
    typecheckConfig: initFileExists(root, 'tsconfig.json'),
  };
  const reactFacts = {
    reactDependency: typeof dependencies.react === 'string',
    reactDomDependency: typeof dependencies['react-dom'] === 'string',
    viteDependency: typeof dependencies.vite === 'string',
    reactPluginDependency: typeof dependencies['@vitejs/plugin-react'] === 'string',
    appEntry: initFileExists(root, 'src/App.tsx'),
    renderEntry: initFileExists(root, 'src/main.tsx'),
    viteConfig: initFileExists(root, 'vite.config.ts'),
    typecheckConfig: initFileExists(root, 'tsconfig.json'),
  };
  const expoCommon = expoFacts.expoDependency
    && expoFacts.reactNativeDependency
    && expoFacts.appConfig
    && expoFacts.typecheckConfig;
  const classicShape = expoCommon && expoFacts.appEntry && expoFacts.registrationEntry;
  if (expoCommon && expoFacts.routerDependency && routerRoots.length > 1) {
    initCollision(
      root,
      'router-root ambiguity',
      'tsconfig.json',
      `Both ${routerRoots.join(' and ')} carry a _layout.tsx, so init cannot tell which one owns the route tree. Remove the unused Router root before rerunning.`,
    );
  }
  const routerRoot = routerRoots[0] ?? null;
  const routerShape = expoCommon && expoFacts.routerDependency && routerRoot !== null;
  const declaredMain = typeof manifest.main === 'string' ? manifest.main : null;
  const routerMain = declaredMain === 'expo-router/entry';
  const classicMain = declaredMain === 'index.ts' || declaredMain === './index.ts';
  if (routerMain && routerShape) return { kind: 'expo-router', routerRoot, facts: expoFacts };
  if (classicMain && classicShape) return { kind: 'expo', facts: expoFacts };
  if (classicShape && routerShape) {
    initCollision(
      root,
      'app-entry ambiguity',
      'package.json',
      `Both the classic App.tsx/index.ts and expo-router ${routerRoot}/_layout.tsx shapes are present, but package.json main (${JSON.stringify(declaredMain)}) selects neither. Set main to "index.ts" or "expo-router/entry" before rerunning.`,
    );
  }
  if (!routerMain && classicShape) {
    return { kind: 'expo', facts: expoFacts };
  }
  if (!classicMain && routerShape) {
    return { kind: 'expo-router', routerRoot, facts: expoFacts };
  }
  if (Object.values(reactFacts).every(Boolean)) return { kind: 'react', facts: reactFacts };
  throw initRefusal(
    'SNAPBACK_INIT_ROOT_UNRECOGNIZED',
    `snapback init looked for create-expo-app (classic App.tsx/index.ts or default expo-router app/_layout.tsx or src/app/_layout.tsx) or the packaged React scaffold shape, but this root matched neither. Use the sibling-scaffold workaround: ${initSiblingScaffoldWorkaround()}`,
    root,
    {
      lookedFor: ['create-expo-app', 'packaged-react-scaffold'],
      observed: { expo: expoFacts, react: reactFacts },
    },
  );
}

function initProfile(detected) {
  return INIT_APP_PROFILES[detected.kind === 'react' ? 'react' : 'expo'];
}

function initTypecheckInclude(detected) {
  if (detected.kind === 'expo-router') return [detected.routerRoot, 'snapback/generated/*.d.ts'];
  if (detected.kind === 'expo') return ['App.tsx', 'index.ts', 'snapback/generated/*.d.ts'];
  return ['src', 'snapback/generated/*.d.ts', 'vite.config.ts'];
}

function sameStringSet(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function initCollisionError(root, seam, path, manualSeam) {
  // @ref LLP 0261#design — partial or foreign adoption is never overwritten;
  // the refusal names the exact seam a person must reconcile by hand.
  return initRefusal(
    'SNAPBACK_INIT_COLLISION',
    `snapback init found a collision at the ${seam} seam (${path}). ${manualSeam}`,
    root,
    { seam, path, manualSeam },
  );
}

function initCollision(root, seam, path, manualSeam) {
  throw initCollisionError(root, seam, path, manualSeam);
}

const INIT_LOCKFILES = Object.freeze([
  { manager: 'bun', path: 'bun.lock' },
  { manager: 'bun', path: 'bun.lockb' },
  { manager: 'pnpm', path: 'pnpm-lock.yaml' },
  { manager: 'yarn', path: 'yarn.lock' },
  { manager: 'npm', path: 'package-lock.json' },
  { manager: 'npm', path: 'npm-shrinkwrap.json' },
]);

function initLocksAt(directory) {
  return INIT_LOCKFILES
    .filter(({ path }) => initFileExists(directory, path))
    .map((entry) => ({ ...entry, absolutePath: join(directory, entry.path) }));
}

function initDeclaredPackageManager(root, manifest) {
  if (!Object.hasOwn(manifest, 'packageManager')) return null;
  const declaration = manifest.packageManager;
  const match = typeof declaration === 'string'
    ? declaration.match(/^(bun|npm|pnpm|yarn)(?:@[^\s]+)?$/u)
    : null;
  if (match) return match[1];
  throw initRefusal(
    'SNAPBACK_INIT_PACKAGE_MANAGER_CONFLICT',
    `package.json declares packageManager=${JSON.stringify(declaration)}, but snapback init supports bun, npm, pnpm, or yarn declarations`,
    root,
    {
      declaredPackageManager: declaration,
      supportedPackageManagers: ['bun', 'npm', 'pnpm', 'yarn'],
    },
  );
}

function initWorkspaceMarker(directory) {
  if (initFileExists(directory, 'pnpm-workspace.yaml')) return true;
  const manifestPath = join(directory, 'package.json');
  if (!initFileExists(directory, 'package.json')) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return isInitRecord(manifest) && (Array.isArray(manifest.workspaces) || isInitRecord(manifest.workspaces));
  } catch {
    return false;
  }
}

function initPackageManagerConflict(root, locks, managers, declared = null) {
  throw initRefusal(
    'SNAPBACK_INIT_PACKAGE_MANAGER_CONFLICT',
    `snapback init found conflicting package-manager ownership (${[
      ...locks.map(({ absolutePath }) => relative(root, absolutePath)),
      ...(declared === null ? [] : [`packageManager=${declared}`]),
    ].join(', ')}); keep one authoritative manager and rerun`,
    root,
    {
      lockfiles: locks.map(({ absolutePath }) => relative(root, absolutePath)),
      packageManagers: managers,
      declaredPackageManager: declared,
    },
  );
}

function detectInitPackageManager(root, manifest) {
  const declared = initDeclaredPackageManager(root, manifest);
  let locks = initLocksAt(root);
  let source = 'local';
  if (locks.length === 0) {
    let cursor = dirname(root);
    while (cursor !== dirname(cursor)) {
      const candidate = initLocksAt(cursor);
      if (candidate.length > 0 && initWorkspaceMarker(cursor)) {
        locks = candidate;
        source = 'workspace';
        break;
      }
      cursor = dirname(cursor);
    }
  }
  const managers = [...new Set(locks.map(({ manager }) => manager))];
  if (managers.length > 1) initPackageManagerConflict(root, locks, managers, declared);
  if (managers.length === 1 && declared !== null && declared !== managers[0]) {
    initPackageManagerConflict(root, locks, [...new Set([managers[0], declared])], declared);
  }
  return {
    manager: managers[0] ?? declared ?? 'npm',
    lockfiles: locks.map(({ absolutePath }) => relative(root, absolutePath)),
    source: locks.length > 0 ? source : declared === null ? 'default' : 'packageManager',
  };
}

function expoInstallCommand(manager, profile, version) {
  const launcher = {
    bun: ['bunx', 'expo', 'install'],
    npm: ['npx', 'expo', 'install'],
    pnpm: ['pnpm', 'exec', 'expo', 'install'],
    yarn: ['yarn', 'expo', 'install'],
  }[manager];
  return [
    ...launcher,
    ...profile.dependencies.map((name) => `${name}@${version}`),
    ...profile.nativeDependencies,
  ];
}

function initInstallCommand(manager, profile, version) {
  if (profile.id === 'create-expo-app') return expoInstallCommand(manager, profile, version);
  return manager === 'yarn' ? ['yarn', 'install'] : [manager, 'install'];
}

function initJsonIndent(source) {
  return source.match(/\n([ \t]+)\S/u)?.[1] ?? '  ';
}

function renderInitJson(source, value) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = /(?:\r\n|\n)$/u.test(source) ? newline : '';
  return JSON.stringify(value, null, initJsonIndent(source)).replaceAll('\n', newline) + trailingNewline;
}

function initSupportedVersion(root, manifest, detected) {
  const profile = initProfile(detected);
  const version = initDependencies(manifest)[profile.supportedDependency];
  const admittedRange = typeof version === 'string'
    ? version.trim().match(/^(?:[~^]|>=?|=)?\s*(\d+)(?:\.\d+)?/u)
    : null;
  const major = admittedRange === null ? Number.NaN : Number(admittedRange[1]);
  if (!Number.isInteger(major) || major !== profile.supportedMajor) {
    throw initRefusal(
      'SNAPBACK_INIT_VERSION_UNSUPPORTED',
      `snapback init supports ${profile.supportedDependency} ${profile.supportedRange} for this closure, but the app declares ${JSON.stringify(version)}`,
      root,
      {
        dependency: profile.supportedDependency,
        declared: version ?? null,
        supportedRange: profile.supportedRange,
      },
    );
  }
}

function initOverrideConflicts(manifest, version) {
  const conflicts = [];
  const visit = (value, path) => {
    if (!isInitRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      if (/@expo\/snapback-[a-z0-9-]+/u.test(key)) {
        const selected = typeof child === 'string'
          ? child
          : isInitRecord(child) && typeof child['.'] === 'string' ? child['.'] : null;
        if (selected !== null && selected !== version) conflicts.push({ path: nextPath.join('.'), version: selected });
      }
      visit(child, nextPath);
    }
  };
  visit(manifest.overrides, ['overrides']);
  visit(manifest.resolutions, ['resolutions']);
  return conflicts;
}

const INIT_DEPENDENCY_GROUPS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

function initDependencyEntries(manifest, name) {
  return INIT_DEPENDENCY_GROUPS.flatMap((group) => (
    Object.hasOwn(manifest[group] ?? {}, name)
      ? [{ group, path: `${group}.${name}`, version: manifest[group][name] }]
      : []
  ));
}

function initDependencyState(manifest, profile, version, root) {
  const overrideConflicts = initOverrideConflicts(manifest, version);
  if (overrideConflicts.length > 0) {
    initCollision(
      root,
      'dependency-manifest',
      'package.json',
      `Reconcile overrides/resolutions with the executing CLI's exact ${version} closure: ${overrideConflicts.map(({ path, version: found }) => `${path}=${found}`).join(', ')}.`,
    );
  }
  const closureNames = new Set(profile.nativeDependencies);
  for (const group of INIT_DEPENDENCY_GROUPS) {
    for (const name of Object.keys(manifest[group] ?? {})) {
      if (name.startsWith('@expo/snapback-')) closureNames.add(name);
    }
  }
  for (const name of closureNames) {
    const entries = initDependencyEntries(manifest, name);
    if (entries.length > 1 && new Set(entries.map(({ version: found }) => found)).size > 1) {
      initCollision(
        root,
        'dependency-manifest',
        'package.json',
        `Reconcile conflicting ${name} declarations across dependency groups: ${entries.map(({ path, version: found }) => `${path}=${JSON.stringify(found)}`).join(', ')}.`,
      );
    }
  }
  const added = [];
  for (const name of profile.dependencies) {
    const entries = initDependencyEntries(manifest, name);
    const dependencyEntry = entries.find(({ group }) => group === 'dependencies');
    if (entries.length > 0 && dependencyEntry === undefined) {
      initCollision(
        root,
        'dependency-manifest',
        'package.json',
        `Move ${entries.map(({ path }) => path).join(', ')} to dependencies at the exact ${version} closure version, or reconcile the package roots manually.`,
      );
    }
    if (dependencyEntry !== undefined && dependencyEntry.version !== version) {
      initCollision(
        root,
        'dependency-manifest',
        'package.json',
        `Reconcile ${dependencyEntry.path}=${JSON.stringify(dependencyEntry.version)} with the executing CLI's coherent ${version} closure before rerunning.`,
      );
    }
    if (dependencyEntry === undefined) added.push(name);
  }
  return added;
}

function readInitConfigs(root, detected) {
  const tsconfigPath = join(root, 'tsconfig.json');
  const tsconfig = readInitJson(tsconfigPath, root, 'tsconfig.json', { jsonc: true });
  if (!isInitRecord(tsconfig.value)) {
    throw initRefusal(
      'SNAPBACK_INIT_CONFIG_INVALID',
      'snapback init requires tsconfig.json to contain an object; no files were changed',
      root,
      { path: tsconfigPath, config: 'tsconfig.json' },
    );
  }
  if (detected.kind === 'react') {
    return {
      tsconfig,
      entryPath: join(root, 'src', 'main.tsx'),
      entrySource: readFileSync(join(root, 'src', 'main.tsx'), 'utf8'),
      appSource: readFileSync(join(root, 'src', 'App.tsx'), 'utf8'),
      vitePath: join(root, 'vite.config.ts'),
      viteSource: readFileSync(join(root, 'vite.config.ts'), 'utf8'),
    };
  }
  if (detected.kind === 'expo-router') {
    const entryRelativePath = `${detected.routerRoot}/_layout.tsx`;
    const entryPath = join(root, ...detected.routerRoot.split('/'), '_layout.tsx');
    return {
      tsconfig,
      entryPath,
      entryRelativePath,
      entrySource: readFileSync(entryPath, 'utf8'),
      appConfig: readInitJson(join(root, 'app.json'), root, 'app.json', { jsonc: true }),
    };
  }
  return {
    tsconfig,
    entryPath: join(root, 'index.ts'),
    entryRelativePath: 'index.ts',
    entrySource: readFileSync(join(root, 'index.ts'), 'utf8'),
    appSource: readFileSync(join(root, 'App.tsx'), 'utf8'),
    appConfig: readInitJson(join(root, 'app.json'), root, 'app.json', { jsonc: true }),
  };
}

function validateInitAppConfig(root, document) {
  const appConfig = document.value;
  if (!isInitRecord(appConfig) || !isInitRecord(appConfig.expo)) {
    initCollision(
      root,
      'Expo config plugin',
      'app.json',
      'Restore app.json to an object with an expo object, then add @expo/snapback-expo to expo.plugins manually.',
    );
  }
  const plugins = appConfig.expo.plugins;
  if (plugins !== undefined && (!Array.isArray(plugins) || plugins.some((plugin) => (
    typeof plugin !== 'string'
      && !(Array.isArray(plugin) && typeof plugin[0] === 'string')
  )))) {
    initCollision(
      root,
      'Expo config plugin',
      'app.json',
      'Make expo.plugins an array whose entries are plugin-name strings or [plugin-name, options] tuples, then add @expo/snapback-expo manually.',
    );
  }
  return appConfig;
}

function initExpoPluginEntries(appConfig) {
  return (appConfig.expo.plugins ?? []).filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === '@expo/snapback-expo' || name === '@expo/snapback-expo/app.plugin';
  });
}

function initRefuseCommentEdit(root, document, path, manualSeam) {
  if (!document.hasComments) return;
  initCollision(
    root,
    'comment-preserving configuration',
    path,
    `${manualSeam} snapback init will not reserialize a commented configuration file.`,
  );
}

function plannedInitTypecheck(root, detected, configs) {
  if (Object.hasOwn(configs.tsconfig.value, 'files') || Object.hasOwn(configs.tsconfig.value, 'references')) {
    initCollision(
      root,
      'typecheck-boundary',
      'tsconfig.json',
      `Preserve files/references and add ${JSON.stringify(initTypecheckInclude(detected))} to the appropriate project boundary manually.`,
    );
  }
  // @ref LLP 0261#design — the pristine blank-typescript template omits
  // `include` entirely, which is an implicit whole-root boundary rather than a
  // deliberate one; narrowing it is the same edit as replacing `**/*.ts`.
  const include = Object.hasOwn(configs.tsconfig.value, 'include')
    ? configs.tsconfig.value.include
    : [];
  if (typeof include === 'string') {
    initCollision(
      root,
      'typecheck-boundary',
      'tsconfig.json',
      `Preserve the string include and add ${JSON.stringify(initTypecheckInclude(detected))} to the appropriate project boundary manually.`,
    );
  }
  if (!Array.isArray(include) || include.some((entry) => typeof entry !== 'string')) {
    initCollision(
      root,
      'typecheck-boundary',
      'tsconfig.json',
      `Set include to a string array containing ${JSON.stringify(initTypecheckInclude(detected))} while preserving intentional ambient declaration entries.`,
    );
  }
  const broadEntries = new Set(['**/*.ts', '**/*.tsx', 'snapback/generated/**/*.ts']);
  for (const entry of include) {
    if (broadEntries.has(entry)) continue;
    if (/[*?].*\.(?:ts|tsx)$/u.test(entry)
        && !entry.endsWith('.d.ts')
        && entry !== '.expo/types/**/*.ts') {
      initCollision(
        root,
        'typecheck-boundary',
        'tsconfig.json',
        `Preserve the intentional wildcard ${JSON.stringify(entry)}, then add ${JSON.stringify(initTypecheckInclude(detected))} and remove only the broad Snapback-generated source projection by hand.`,
      );
    }
  }
  const required = initTypecheckInclude(detected);
  const retained = include.filter((entry) => !broadEntries.has(entry));
  const nextInclude = [...required, ...retained.filter((entry) => !required.includes(entry))];
  if (sameStringSet(include, nextInclude)) return null;
  initRefuseCommentEdit(
    root,
    configs.tsconfig,
    'tsconfig.json',
    `Set include to ${JSON.stringify(nextInclude)} manually.`,
  );
  return {
    ...configs.tsconfig.value,
    include: nextInclude,
  };
}


function initImportBindings(source) {
  const bindings = new Set();
  const masked = maskInitSourceCommentsAndStrings(source);
  for (const match of masked.matchAll(/(?:^|[;\n])\s*import\s+(?:type\s+)?([^;]*?)\s+from\b/gu)) {
    const clause = match[1].trim();
    const defaultBinding = clause.match(/^([A-Za-z_$][\w$]*)\b/u)?.[1];
    if (defaultBinding) bindings.add(defaultBinding);
    const namespaceBinding = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)\b/u)?.[1];
    if (namespaceBinding) bindings.add(namespaceBinding);
    const named = clause.match(/\{([\s\S]*?)\}/u)?.[1];
    for (const specifier of named?.split(',') ?? []) {
      const binding = specifier.trim()
        .replace(/^type\s+/u, '')
        .match(/^(?:[A-Za-z_$][\w$]*\s+as\s+)?([A-Za-z_$][\w$]*)$/u)?.[1];
      if (binding) bindings.add(binding);
    }
  }
  return bindings;
}

function initBindingDeclared(source, name) {
  if (initImportBindings(source).has(name)) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const masked = maskInitSourceCommentsAndStrings(source);
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${escaped}\\b`, 'u').test(masked);
}

function assertInitBindingsAvailable(root, source, path, names) {
  const collisions = names.filter((name) => initBindingDeclared(source, name));
  if (collisions.length > 0) {
    initCollision(
      root,
      'lexical binding',
      path,
      `Rename or manually reuse the existing ${collisions.join(', ')} binding(s); init will not insert duplicate imports/declarations.`,
    );
  }
}

// @ref LLP 0261#design — create-expo-app ships explanatory comments inside its
// pristine entry files, so pristine comparison drops comments while keeping
// string literals, which still pin the module specifier the seam rewrites.
function normalizeInitPristineSource(source) {
  return maskInitSourceCommentsAndStrings(source, false).replace(/[\s;]/gu, '');
}

function initClassicExpoEntries() {
  return ["'./App'", "'./App.tsx'", '"./App"', '"./App.tsx"'].map((specifier) => `
import { registerRootComponent } from 'expo';
import App from ${specifier};

registerRootComponent(App);
`);
}

// @ref LLP 0261#design — the descriptor specifier is derived from the Router
// root's depth, so a `src/app/` layout reaches the same `snapback/generated`
// directory as a root `app/` layout instead of one level short.
function initGeneratedAppSpecifier(routerRoot) {
  if (routerRoot === null) return './snapback/generated/app.mjs';
  return `${'../'.repeat(routerRoot.split('/').length)}snapback/generated/app.mjs`;
}

function initExpoEntryImports(routerRoot = null) {
  return [
    `// ${INIT_SEAM_MARKER}`,
    ...(routerRoot === null ? ["import { createElement } from 'react';"] : []),
    "import { Platform } from 'react-native';",
    "import * as FileSystem from 'expo-file-system';",
    "import * as Crypto from 'expo-crypto';",
    "import { registerExpoFileSystemRqsFiles } from '@expo/snapback-client';",
    "import { SnapbackExpoProvider } from '@expo/snapback-expo';",
    `import { app as snapbackApp } from '${initGeneratedAppSpecifier(routerRoot)}';`,
  ].join('\n');
}

function initSourceNewline(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function renderInitSourceFragment(source, fragment) {
  return fragment.replaceAll('\n', initSourceNewline(source));
}

function initClassicExpoRegistration(appIdentifier) {
  return `if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

function SnapbackInitRoot() {
  return createElement(SnapbackExpoProvider, { app: snapbackApp }, createElement(${appIdentifier}));
}

registerRootComponent(SnapbackInitRoot);`;
}

function initRouterExpoTail() {
  return `if (Platform.OS !== 'web') {
  registerExpoFileSystemRqsFiles(FileSystem, { crypto: Crypto });
}

export default function RootLayout() {
  return (
    <SnapbackExpoProvider app={snapbackApp}>
      <SnapbackInitRouterContent />
    </SnapbackExpoProvider>
  );
}
`;
}

function initExpoEntryOwned(source, routerRoot = null) {
  const newline = initSourceNewline(source);
  const imports = renderInitSourceFragment(source, initExpoEntryImports(routerRoot));
  if (!source.startsWith(`${imports}${newline}`)) return false;
  let remainder = source.slice(imports.length + newline.length);
  if (routerRoot !== null) {
    const tail = renderInitSourceFragment(source, initRouterExpoTail());
    if (!remainder.endsWith(`${newline}${newline}${tail}`)) return false;
    remainder = remainder.slice(0, -(`${newline}${newline}${tail}`).length);
    const contentHeaders = [...remainder.matchAll(/function\s+SnapbackInitRouterContent\s*\(\s*\)\s*\{/gu)];
    if (contentHeaders.length !== 1) return false;
    remainder = remainder.replace(contentHeaders[0][0], '');
  } else {
    const appImport = remainder.match(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/App(?:\.tsx)?['"]\s*;?/u);
    if (!appImport) return false;
    const registration = renderInitSourceFragment(source, initClassicExpoRegistration(appImport[1]));
    if (remainder.split(registration).length !== 2) return false;
    remainder = remainder.replace(registration, '');
    if (/registerRootComponent\s*\(/u.test(remainder)) return false;
  }
  return !/@snapback-init|SnapbackExpoProvider|registerExpoFileSystemRqsFiles|\bsnapbackApp\b/u.test(remainder);
}

function plannedClassicExpoEntry(root, configs) {
  if (initExpoEntryOwned(configs.entrySource)) return null;
  const appShellSource = `${configs.entrySource}\n${configs.appSource}`;
  if (appShellSource.includes('SnapbackExpoProvider')
      || appShellSource.includes('@expo/snapback-expo')
      || appShellSource.includes('registerExpoFileSystemRqsFiles')
      || appShellSource.includes(INIT_SEAM_MARKER)) {
    initCollision(
      root,
      'provider',
      'index.ts',
      'Keep the existing provider/store ownership and wrap the registered App with the generated app descriptor manually.',
    );
  }
  assertInitBindingsAvailable(root, configs.entrySource, 'index.ts', [
    'createElement',
    'Platform',
    'FileSystem',
    'Crypto',
    'registerExpoFileSystemRqsFiles',
    'SnapbackExpoProvider',
    'snapbackApp',
    'SnapbackInitRoot',
  ]);
  const appImport = configs.entrySource.match(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]\.\/App(?:\.tsx)?['"]\s*;?/u);
  if (!appImport
      || appImport[1] !== 'App'
      || !initClassicExpoEntries().some((pristine) => (
        normalizeInitPristineSource(pristine) === normalizeInitPristineSource(configs.entrySource)
      ))) {
    initCollision(
      root,
      'provider',
      'index.ts',
      "Expected one pristine create-expo-app registration: `import App from './App'` (or './App.tsx') followed by `registerRootComponent(App)`; wire SnapbackExpoProvider manually around custom registration code.",
    );
  }
  return renderExpoEntry(configs.entrySource, appImport[1]);
}

function plannedRouterExpoEntry(root, configs, routerRoot) {
  if (initExpoEntryOwned(configs.entrySource, routerRoot)) return null;
  if (configs.entrySource.includes('@expo/snapback-expo')
      || configs.entrySource.includes('SnapbackExpoProvider')
      || configs.entrySource.includes(INIT_SEAM_MARKER)) {
    initCollision(
      root,
      'provider',
      configs.entryRelativePath,
      'Keep the existing router provider ownership and wrap its root layout with SnapbackExpoProvider manually.',
    );
  }
  assertInitBindingsAvailable(root, configs.entrySource, configs.entryRelativePath, [
    'Platform',
    'FileSystem',
    'Crypto',
    'registerExpoFileSystemRqsFiles',
    'SnapbackExpoProvider',
    'snapbackApp',
    'SnapbackInitRouterContent',
  ]);
  const normalized = normalizeInitPristineSource(configs.entrySource);
  const pristineLayouts = [
    { source: INIT_EXPO_ROUTER_SDK_57_LAYOUT, functionName: 'TabLayout' },
    { source: INIT_EXPO_ROUTER_BLANK_LAYOUT, functionName: 'RootLayout' },
  ];
  const pristine = pristineLayouts.find(({ source }) => normalizeInitPristineSource(source) === normalized);
  if (pristine === undefined) {
    initCollision(
      root,
      'provider',
      configs.entryRelativePath,
      'The automatic seam expects the pristine Expo 57 create-expo-app TabLayout (ThemeProvider, AnimatedSplashOverlay, AppTabs) or its pristine blank Stack layout. Wrap a customized layout with SnapbackExpoProvider manually.',
    );
  }
  return renderRouterExpoLayout(configs.entrySource, pristine.functionName, routerRoot);
}

function initReactEntryOwned(source) {
  const header = renderInitSourceFragment(
    source,
    `// ${INIT_SEAM_MARKER}\nimport { SnapbackInitProvider } from './snapback-init-provider';\n`,
  );
  const wrapper = '<SnapbackInitProvider><App /></SnapbackInitProvider>';
  if (!source.startsWith(header)) return false;
  const remainder = source.slice(header.length);
  return remainder.split(wrapper).length === 2
    && !/@snapback-init|SnapbackInitProvider|@expo\/snapback-react/u.test(remainder.replace(wrapper, ''));
}

function initReactViteOwned(source) {
  const header = renderInitSourceFragment(
    source,
    `// ${INIT_SEAM_MARKER}\nimport { snapbackDev } from '@expo/snapback-vite';\n`,
  );
  const block = renderInitSourceFragment(source, `snapbackDev({
      server: { mode: 'attach' },
      generatedRoots: ['snapback/generated'],
    })`);
  if (!source.startsWith(header)) return false;
  const remainder = source.slice(header.length);
  return remainder.split(block).length === 2
    && !/@snapback-init|snapbackDev|@expo\/snapback-vite/u.test(remainder.replace(block, ''));
}

function plannedReactEntry(root, configs) {
  if (initReactEntryOwned(configs.entrySource)) return null;
  const appShellSource = `${configs.entrySource}\n${configs.appSource}`;
  const appShellCode = maskInitSourceCommentsAndStrings(appShellSource);
  if (appShellCode.includes('SnapbackProvider')
      || appShellCode.includes('SnapbackInitProvider')
      || appShellSource.includes(INIT_SEAM_MARKER)) {
    initCollision(
      root,
      'provider',
      'src/main.tsx',
      'Keep the existing React provider ownership and bind it to the generated manifests manually.',
    );
  }
  assertInitBindingsAvailable(root, configs.entrySource, 'src/main.tsx', ['SnapbackInitProvider']);
  const appTags = [...maskInitSourceCommentsAndStrings(configs.entrySource)
    .matchAll(/<App\s*(?:\/>|>\s*<\/App>)/gu)];
  if (appTags.length !== 1) {
    initCollision(
      root,
      'provider',
      'src/main.tsx',
      'Wrap the app shell once with <SnapbackInitProvider> and retain the existing provider ordering by hand.',
    );
  }
  return renderReactEntry(configs.entrySource, appTags[0]);
}

function plannedReactVite(root, configs) {
  if (initReactViteOwned(configs.viteSource)) return null;
  const viteCode = maskInitSourceCommentsAndStrings(configs.viteSource);
  if (viteCode.includes('snapbackDev')
      || configs.viteSource.includes(INIT_SEAM_MARKER)) {
    initCollision(
      root,
      'Vite integration',
      'vite.config.ts',
      'Keep the existing Snapback Vite integration and reconcile its generatedRoots/server mode manually.',
    );
  }
  const pluginMatches = [...viteCode.matchAll(/plugins:\s*\[\s*react\(\),?\s*\]/gu)];
  if (pluginMatches.length !== 1) {
    initCollision(
      root,
      'Vite integration',
      'vite.config.ts',
      "Preserve the custom Vite plugin order and add snapbackDev({ server: { mode: 'attach' }, generatedRoots: ['snapback/generated'] }) manually.",
    );
  }
  assertInitBindingsAvailable(root, configs.viteSource, 'vite.config.ts', ['snapbackDev']);
  return renderReactViteConfig(configs.viteSource, pluginMatches[0]);
}

function renderExpoEntry(source, appIdentifier) {
  const newline = initSourceNewline(source);
  const imports = renderInitSourceFragment(source, initExpoEntryImports());
  const registration = new RegExp(`registerRootComponent\\(\\s*${appIdentifier}\\s*\\)\\s*;?`, 'u');
  const replacement = renderInitSourceFragment(source, initClassicExpoRegistration(appIdentifier));
  return `${imports}${newline}${source.replace(registration, replacement)}`;
}

function renderRouterExpoLayout(source, functionName, routerRoot) {
  const newline = initSourceNewline(source);
  const imports = renderInitSourceFragment(source, initExpoEntryImports(routerRoot));
  const content = source.replace(
    new RegExp(`export\\s+default\\s+function\\s+${functionName}\\s*\\(\\s*\\)\\s*\\{`, 'u'),
    'function SnapbackInitRouterContent() {',
  );
  const tail = renderInitSourceFragment(source, initRouterExpoTail());
  return `${imports}${newline}${content.trimEnd()}${newline}${newline}${tail}`;
}

function renderReactEntry(source, appTag) {
  const header = renderInitSourceFragment(
    source,
    `// ${INIT_SEAM_MARKER}\nimport { SnapbackInitProvider } from './snapback-init-provider';\n`,
  );
  const replaced = `${source.slice(0, appTag.index)}<SnapbackInitProvider><App /></SnapbackInitProvider>${source.slice(appTag.index + appTag[0].length)}`;
  return `${header}${replaced}`;
}

function renderReactViteConfig(source, pluginsMatch) {
  const header = renderInitSourceFragment(
    source,
    `// ${INIT_SEAM_MARKER}\nimport { snapbackDev } from '@expo/snapback-vite';\n`,
  );
  const replacement = renderInitSourceFragment(source, `plugins: [
    react(),
    snapbackDev({
      server: { mode: 'attach' },
      generatedRoots: ['snapback/generated'],
    }),
  ]`);
  const replaced = `${source.slice(0, pluginsMatch.index)}${replacement}${source.slice(pluginsMatch.index + pluginsMatch[0].length)}`;
  return `${header}${replaced}`;
}

function initPathMetadata(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function walkInitTree(root, prefix = '') {
  const entries = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      entries.push({ kind: 'directory', relativePath });
      entries.push(...walkInitTree(root, relativePath));
    } else if (entry.isFile()) {
      entries.push({ kind: 'file', relativePath });
    } else {
      entries.push({ kind: 'other', relativePath });
    }
  }
  return entries;
}

function createInitWritePlan(root) {
  return {
    root,
    newEntries: [],
    updates: [],
    unchanged: new Set(),
  };
}

function planInitNewDirectory(plan, relativePath) {
  plan.newEntries.push({
    kind: 'new-directory',
    relativePath: relativePath.endsWith('/') ? relativePath : `${relativePath}/`,
    path: join(plan.root, relativePath),
  });
}

function planInitNewFile(plan, relativePath, content, options = {}) {
  plan.newEntries.push({
    kind: options.copySource === undefined ? 'new-file' : 'copy-file',
    relativePath,
    path: join(plan.root, relativePath),
    content,
    ...(options.copySource === undefined ? {} : { copySource: options.copySource }),
  });
}

function planInitUpdate(plan, relativePath, originalSource, content) {
  if (content === originalSource) {
    plan.unchanged.add(relativePath);
    return;
  }
  const path = join(plan.root, relativePath);
  plan.updates.push({
    kind: 'update',
    relativePath,
    path,
    actualPath: initContainedPath(plan.root, path, relativePath),
    originalSource,
    content,
  });
}

function planInitOwnedFile(plan, root, relativePath, expectedSource, seam) {
  const path = join(root, relativePath);
  const metadata = initPathMetadata(path);
  if (metadata === null) {
    initContainedPath(root, path, relativePath);
    planInitNewFile(plan, relativePath, expectedSource);
    return;
  }
  initContainedPath(root, path, relativePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || readFileSync(path, 'utf8') !== expectedSource) {
    initCollision(
      root,
      seam,
      relativePath,
      `The present seam does not byte-match what snapback init writes. Reconcile ${relativePath} manually or restore the init-owned bytes.`,
    );
  }
  plan.unchanged.add(relativePath);
}

// @ref LLP 0261#design — fresh adoption seeds the packaged tree, but resumed
// ownership stops at the three authored files and never constrains codegen.
function planInitBackend(plan, root) {
  const templateRoot = join(packageRoot, 'templates', 'react', 'snapback');
  const backendRoot = join(root, 'snapback');
  const backendMetadata = initPathMetadata(backendRoot);
  if (backendMetadata === null) {
    const sourceEntries = walkInitTree(templateRoot);
    planInitNewDirectory(plan, 'snapback');
    for (const entry of sourceEntries.filter(({ kind }) => kind === 'directory')) {
      planInitNewDirectory(plan, join('snapback', entry.relativePath));
    }
    for (const entry of sourceEntries.filter(({ kind }) => kind === 'file')) {
      const relativePath = join('snapback', entry.relativePath);
      const sourcePath = join(templateRoot, entry.relativePath);
      planInitNewFile(plan, relativePath, readFileSync(sourcePath), { copySource: sourcePath });
    }
    return;
  }
  initContainedPath(root, backendRoot, 'snapback/');
  if (!backendMetadata.isDirectory() || backendMetadata.isSymbolicLink()) {
    initCollision(root, 'backend child', 'snapback/', 'The backend seam must be an init-owned directory, not a file or symlink.');
  }

  const authoredFiles = ['schema.mjs', 'functions.mjs', 'seed.json'];
  const allowedEntries = new Set([...authoredFiles, 'generated']);
  const actualEntries = readdirSync(backendRoot, { withFileTypes: true });
  for (const entry of actualEntries) {
    if (!allowedEntries.has(entry.name)) {
      initCollision(
        root,
        'backend child',
        join('snapback', entry.name),
        'The present backend entry is not part of the init-authored seed set or the codegen-owned generated/ tree. Preserve it and reconcile the snapback/ child manually.',
      );
    }
  }

  let matchingAuthoredFiles = 0;
  for (const name of authoredFiles) {
    const relativePath = join('snapback', name);
    const path = join(root, relativePath);
    const metadata = initPathMetadata(path);
    const sourcePath = join(templateRoot, name);
    const expectedBytes = readFileSync(sourcePath);
    if (metadata !== null) {
      initContainedPath(root, path, relativePath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || !readFileSync(path).equals(expectedBytes)) {
        initCollision(
          root,
          'backend child',
          relativePath,
          'The present authored backend file differs from the packaged init bytes; reconcile it manually before rerunning.',
        );
      }
      matchingAuthoredFiles += 1;
      plan.unchanged.add(relativePath);
    } else {
      initContainedPath(root, path, relativePath);
      planInitNewFile(plan, relativePath, expectedBytes, { copySource: sourcePath });
    }
  }
  if (matchingAuthoredFiles === 0) {
    initCollision(
      root,
      'backend child',
      'snapback/',
      'The pre-existing snapback/ directory has no byte-matching init-authored schema.mjs, functions.mjs, or seed.json seam, so init will not claim or populate it.',
    );
  }
  plan.unchanged.add('snapback/');
  if (actualEntries.some(({ name }) => name === 'generated')) {
    plan.unchanged.add('snapback/generated/');
  }
}

function initRequiredPaths(root, detected) {
  const common = ['package.json', 'tsconfig.json'];
  if (detected.kind === 'react') {
    return [...common, 'src', 'src/App.tsx', 'src/main.tsx', 'vite.config.ts'];
  }
  if (detected.kind === 'expo-router') {
    return [...common, 'app.json', detected.routerRoot, `${detected.routerRoot}/_layout.tsx`];
  }
  return [...common, 'app.json', 'App.tsx', 'index.ts'];
}

function rollbackInitCreations(created) {
  const rolledBack = [];
  const rollbackFailed = [];
  for (const entry of [...created].reverse()) {
    try {
      if (entry.kind === 'new-directory') rmdirSync(entry.path);
      else rmSync(entry.path, { force: true });
      rolledBack.push(entry.relativePath);
    } catch (error) {
      rollbackFailed.push({ path: entry.relativePath, code: error?.code ?? null });
    }
  }
  return { rolledBack, rollbackFailed };
}

function replaceInitFileAtomically(entry, content, afterTempWrite = () => {}) {
  const mode = statSync(entry.actualPath).mode & 0o777;
  const temporary = join(dirname(entry.actualPath), `.${basename(entry.actualPath)}.snapback-init-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode });
    afterTempWrite();
    renameSync(temporary, entry.actualPath);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function rollbackInitUpdates(updated) {
  const updatedRestored = [];
  const updateRestoreFailed = [];
  for (const entry of [...updated].reverse()) {
    try {
      if (readFileSync(entry.path, 'utf8') !== entry.content) {
        const error = new Error('file changed after snapback init updated it');
        error.code = 'SNAPBACK_INIT_ROLLBACK_CONCURRENT_EDIT';
        throw error;
      }
      replaceInitFileAtomically(entry, entry.originalSource);
      updatedRestored.push(entry.relativePath);
    } catch (error) {
      updateRestoreFailed.push({ path: entry.relativePath, code: error?.code ?? null });
    }
  }
  return { updatedRestored, updateRestoreFailed };
}

function initTransactionFailure(root, cause, created, updated) {
  const updateRollback = rollbackInitUpdates(updated);
  const creationRollback = rollbackInitCreations(created);
  let error = cause;
  if (cause?.code === 'EEXIST') {
    error = initCollisionError(
      root,
      'transaction',
      cause.snapbackInitPath ?? 'planned write',
      'A path appeared after preflight. Preserve the concurrent file and rerun after reconciling it.',
    );
    error.cause = cause;
  } else if (!cause?.diagnostic || !`${cause.code ?? ''}`.startsWith('SNAPBACK_INIT_')) {
    error = initRefusal(
      'SNAPBACK_INIT_TRANSACTION_FAILED',
      `snapback init could not finish the preflighted write plan: ${cause?.message ?? cause}`,
      root,
    );
    error.cause = cause;
  }
  error.diagnostic.details = {
    ...(error.diagnostic.details ?? {}),
    transaction: {
      created: created.map(({ relativePath }) => relativePath),
      updated: updated.map(({ relativePath }) => relativePath),
      rolledBack: creationRollback.rolledBack,
      rollbackFailed: creationRollback.rollbackFailed,
      updatedRestored: updateRollback.updatedRestored,
      updateRestoreFailed: updateRollback.updateRestoreFailed,
    },
  };
  throw error;
}

function commitInitWritePlan(plan, options) {
  const created = [];
  const updated = [];
  let attemptedNewEntry = null;
  const notify = (event, entry) => options.transactionHook?.({ event, path: entry.relativePath });
  try {
    for (const entry of plan.newEntries) {
      notify('before-new', entry);
      attemptedNewEntry = entry;
      if (entry.kind === 'new-directory') {
        mkdirSync(entry.path);
      } else if (entry.kind === 'copy-file') {
        cpSync(entry.copySource, entry.path, { force: false, errorOnExist: true });
        created.push(entry);
        if (!readFileSync(entry.path).equals(entry.content)) {
          throw new Error(`copied bytes changed during commit for ${entry.relativePath}`);
        }
      } else {
        writeFileSync(entry.path, entry.content, { flag: 'wx' });
      }
      if (!created.includes(entry)) created.push(entry);
      attemptedNewEntry = null;
      notify('after-new', entry);
    }
    for (const entry of plan.updates) {
      notify('before-update', entry);
      if (readFileSync(entry.path, 'utf8') !== entry.originalSource) {
        throw initCollisionError(
          plan.root,
          'transaction',
          entry.relativePath,
          'The file changed after preflight; preserve the concurrent edit and rerun.',
        );
      }
      replaceInitFileAtomically(entry, entry.content, () => notify('after-temp-write', entry));
      updated.push(entry);
      notify('after-update', entry);
    }
  } catch (cause) {
    if (attemptedNewEntry !== null
        && cause?.code !== 'EEXIST'
        && initPathMetadata(attemptedNewEntry.path) !== null
        && !created.includes(attemptedNewEntry)) {
      created.push(attemptedNewEntry);
    }
    if (cause && typeof cause === 'object' && cause.code === 'EEXIST' && cause.snapbackInitPath === undefined) {
      cause.snapbackInitPath = plan.newEntries.find(({ path }) => path === cause.path)?.relativePath ?? cause.path;
    }
    initTransactionFailure(plan.root, cause, created, updated);
  }
  return {
    created: created.map(({ relativePath }) => relativePath),
    updated: updated.map(({ relativePath }) => relativePath),
  };
}

function runInitInstall(command, root, options, adoption) {
  const runner = options.installRunner ?? ((executable, args, spawnOptions) => spawnSync(executable, args, spawnOptions));
  const result = runner(command[0], command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  if (result?.error || result?.status !== 0) {
    const cause = result?.error;
    const error = initRefusal(
      'SNAPBACK_INIT_INSTALL_FAILED',
      `snapback init file adoption is complete but the explicit install command failed; rerun ${command.join(' ')}`,
      root,
      {
        command,
        exitCode: result?.status ?? null,
        stderr: `${result?.stderr ?? ''}`.trim().slice(0, 4_000),
        adoption,
        lockfileEffects: 'package-manager-controlled',
      },
    );
    if (cause) error.cause = cause;
    throw error;
  }
}

/** Adopt the packaged React backend into one recognized existing app root. */
export function initApp(target = process.cwd(), options = {}) {
  const requestedRoot = resolve(target);
  let root;
  try {
    root = realpathSync.native(requestedRoot);
    if (!statSync(root).isDirectory()) throw new Error('not a directory');
  } catch (cause) {
    const error = initRefusal(
      'SNAPBACK_INIT_ROOT_UNRECOGNIZED',
      `snapback init requires an existing app directory at ${requestedRoot}`,
      requestedRoot,
      { lookedFor: ['create-expo-app', 'packaged-react-scaffold'] },
    );
    error.cause = cause;
    throw error;
  }
  const manifestPath = join(root, 'package.json');
  if (!initFileExists(root, 'package.json')) {
    throw initRefusal(
      'SNAPBACK_INIT_ROOT_UNRECOGNIZED',
      `snapback init requires package.json and looked for a create-expo-app root or the packaged React scaffold shape. Use the sibling-scaffold workaround: ${initSiblingScaffoldWorkaround()}`,
      root,
      { lookedFor: ['create-expo-app', 'packaged-react-scaffold'] },
    );
  }
  initContainedPath(root, manifestPath, 'package.json');
  const manifestDocument = readInitJson(manifestPath, root, 'package.json');
  const manifest = manifestDocument.value;
  if (!isInitRecord(manifest)) {
    throw initRefusal(
      'SNAPBACK_INIT_ROOT_UNRECOGNIZED',
      'snapback init requires package.json to contain an object; no files were changed',
      root,
      { path: manifestPath, lookedFor: ['create-expo-app', 'packaged-react-scaffold'] },
    );
  }
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'overrides',
    'resolutions',
  ]) {
    if (manifest[section] !== undefined && !isInitRecord(manifest[section])) {
      throw initRefusal(
        'SNAPBACK_INIT_CONFIG_INVALID',
        `snapback init requires package.json ${section} to be an object; no files were changed`,
        root,
        { path: manifestPath, section },
      );
    }
  }
  const detected = detectInitApp(root, manifest);
  for (const path of initRequiredPaths(root, detected)) {
    initContainedPath(root, join(root, path), path);
  }
  initSupportedVersion(root, manifest, detected);
  const profile = initProfile(detected);
  const configs = readInitConfigs(root, detected);
  const packageManager = detectInitPackageManager(root, manifest);
  const version = packageVersion();
  const installCommand = initInstallCommand(packageManager.manager, profile, version);
  const dependenciesAdded = initDependencyState(manifest, profile, version, root);
  const plan = createInitWritePlan(root);
  if (dependenciesAdded.length === 0) {
    plan.unchanged.add('package.json');
  } else {
    const nextManifest = {
      ...manifest,
      dependencies: {
        ...manifest.dependencies,
        ...Object.fromEntries(dependenciesAdded.map((name) => [name, version])),
      },
    };
    planInitUpdate(plan, 'package.json', manifestDocument.source, renderInitJson(manifestDocument.source, nextManifest));
  }
  const nextTsconfig = plannedInitTypecheck(root, detected, configs);
  if (nextTsconfig === null) plan.unchanged.add('tsconfig.json');
  else planInitUpdate(
    plan,
    'tsconfig.json',
    configs.tsconfig.source,
    renderInitJson(configs.tsconfig.source, nextTsconfig),
  );

  if (detected.kind === 'react') {
    const nextEntry = plannedReactEntry(root, configs);
    if (nextEntry === null) plan.unchanged.add('src/main.tsx');
    else planInitUpdate(plan, 'src/main.tsx', configs.entrySource, nextEntry);
    const nextVite = plannedReactVite(root, configs);
    if (nextVite === null) plan.unchanged.add('vite.config.ts');
    else planInitUpdate(plan, 'vite.config.ts', configs.viteSource, nextVite);
    planInitOwnedFile(plan, root, INIT_REACT_PROVIDER_FILE, INIT_REACT_PROVIDER_SOURCE, 'provider');
    planInitOwnedFile(plan, root, INIT_REACT_VIRTUAL_MODULE_FILE, INIT_REACT_VIRTUAL_MODULE_SOURCE, 'Vite client types');
  } else {
    const appConfig = validateInitAppConfig(root, configs.appConfig);
    const pluginEntries = initExpoPluginEntries(appConfig);
    if (pluginEntries.length === 1 && pluginEntries[0] === '@expo/snapback-expo') {
      plan.unchanged.add('app.json');
    } else if (pluginEntries.length > 0) {
      initCollision(
        root,
        'Expo config plugin',
        'app.json',
        'The present Snapback plugin seam does not shape-match the single @expo/snapback-expo string that init writes; reconcile the plugin entry manually.',
      );
    } else {
      initRefuseCommentEdit(
        root,
        configs.appConfig,
        'app.json',
        'Add @expo/snapback-expo to expo.plugins manually.',
      );
      const nextAppConfig = {
        ...appConfig,
        expo: {
          ...appConfig.expo,
          plugins: [...(appConfig.expo.plugins ?? []), '@expo/snapback-expo'],
        },
      };
      planInitUpdate(
        plan,
        'app.json',
        configs.appConfig.source,
        renderInitJson(configs.appConfig.source, nextAppConfig),
      );
    }
    const nextEntry = detected.kind === 'expo-router'
      ? plannedRouterExpoEntry(root, configs, detected.routerRoot)
      : plannedClassicExpoEntry(root, configs);
    if (nextEntry === null) plan.unchanged.add(configs.entryRelativePath);
    else planInitUpdate(plan, configs.entryRelativePath, configs.entrySource, nextEntry);
  }

  // @ref LLP 0261#design — all init-owned files and every replacement are
  // preflighted before the first creation; user-owned replacements commit last.
  planInitBackend(plan, root);
  const adoption = plan.newEntries.length === 0 && plan.updates.length === 0
    ? { created: [], updated: [] }
    : commitInitWritePlan(plan, options);
  const state = adoption.created.length === 0 && adoption.updated.length === 0
    ? 'already-initialized'
    : 'initialized';
  const requestedInstall = options.install === true;
  if (requestedInstall) runInitInstall(installCommand, root, options, adoption);
  return {
    schemaVersion: 'snapback.init.v1',
    ok: true,
    state,
    root,
    appKind: profile.id,
    packageManager: packageManager.manager,
    lockfiles: packageManager.lockfiles,
    packageManagerSource: packageManager.source,
    snapbackVersion: version,
    dependenciesAdded,
    filesCreated: adoption.created,
    filesUpdated: adoption.updated,
    filesUnchanged: [...plan.unchanged].sort(),
    install: {
      requested: requestedInstall,
      ran: requestedInstall,
      command: installCommand,
      lockfileEffects: requestedInstall ? 'package-manager-controlled' : 'not-run',
    },
    next: detected.kind !== 'react'
      ? ['snapback generate snapback --json', 'snapback dev snapback --expo']
      : [
          'snapback generate snapback --json',
          'snapback dev snapback --write-env',
          `${packageManager.manager} run dev`,
        ],
  };
}

async function generateAppThroughNode(backendDirectory, { targetProfile, appBindingMode, check }) {
  const args = [
    require.resolve('@expo/snapback-codegen'),
    resolve(backendDirectory),
    '--json',
    '--target-profile', targetProfile,
    '--app-binding-mode', appBindingMode,
    ...(check ? ['--check'] : []),
  ];
  const allowedEnvironment = new Set([
    'SNAPBACK_OUTBOUND_ACTIONS',
    'SNAPBACK_GENERATED_AT_MS',
    'SOURCE_DATE_EPOCH',
    'PATH',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && allowedEnvironment.has(key.toUpperCase()),
    ),
  );
  return new Promise((resolveResult) => {
    const child = spawn('node', args, {
      cwd: process.cwd(),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stderrBytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => {
      if (stderrBytes >= 4_000) return;
      stderr.push(chunk);
      stderrBytes += chunk.byteLength;
    });
    child.once('error', (error) => finish({
      ok: false,
      diagnostics: [{
        code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
        severity: 'error',
        subsystem: 'codegen',
        message: `could not launch Node 24 for isolated code generation: ${error.message}`,
      }],
    }));
    child.once('close', (code, signal) => {
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
        finish(result);
      } catch (error) {
        finish({
          ok: false,
          diagnostics: [{
            code: 'CODEGEN_ISOLATED_EVALUATOR_FAILED',
            severity: 'error',
            subsystem: 'codegen',
            message: `Node 24 code generation returned no structured result (code ${code}, signal ${signal}): ${error.message}`,
            details: {
              stderr: Buffer.concat(stderr).toString('utf8').slice(0, 4_000),
            },
          }],
        });
      }
    });
  });
}

export async function generateApp(backendDirectory, options = {}) {
  const targetProfile = options.targetProfile ?? 'local-dev-sqlite-ibex';
  const appBindingMode = options.appBindingMode ?? 'development';
  const check = options.check === true;
  // @ref LLP 0010#generated-artifacts — definition evaluation still occurs
  // under Node 24's permission model when a Bun-hosted Vite process owns the
  // canonical dev lifecycle; Bun is only the supervisor of the Node child.
  const canEvaluateIsolatedDefinitions = process.allowedNodeEnvironmentFlags
    ?.has('--permission') === true;
  const result = canEvaluateIsolatedDefinitions
    ? await generate(resolve(backendDirectory), { targetProfile, appBindingMode, check })
    : await generateAppThroughNode(backendDirectory, { targetProfile, appBindingMode, check });
  return {
    schemaVersion: 'snapback.generate.v1',
    ...result,
    targetProfile,
    appBindingMode,
    check,
  };
}

function canonicalFilesystemPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function canonicalFileCarrierPath(path) {
  const absolute = resolve(path);
  return join(canonicalFilesystemPath(dirname(absolute)), basename(absolute));
}

export function readReadyDescriptor(path) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError('SNAPBACK_DEV_READY_FILE_INVALID', `could not parse readiness descriptor ${path}`, { path });
    error.cause = cause;
    throw error;
  }
  if (
    value?.schemaVersion !== 'snapback.v0'
    || value?.descriptorKind !== 'snapbackHostReady'
    || value?.ready !== true
    || !Number.isInteger(value?.pid)
    || typeof value?.serverUrl !== 'string'
  ) {
    throw diagnosticError('SNAPBACK_DEV_READY_FILE_INVALID', `file is not a ready Snapback host descriptor: ${path}`, { path });
  }
  return value;
}

export function validateDevTarget(descriptor, { readyFile, database }) {
  const observed = descriptor?.database?.path ? canonicalFilesystemPath(descriptor.database.path) : null;
  const expected = database ? canonicalFilesystemPath(database) : null;
  if (expected !== observed) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names a different database target',
      { readyFile: resolve(readyFile), expectedDatabase: expected, observedDatabase: observed },
    );
  }
  return descriptor;
}

function normalizeDevPort(value) {
  if (value === undefined || value === null) return null;
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      '--port must be an integer from 1 through 65535',
      { port: value },
    );
  }
  return port;
}

function canonicalDevClientOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username !== ''
    || url.password !== ''
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search !== ''
    || url.hash !== ''
  ) {
    return null;
  }
  return url.origin;
}

function portFromUrl(value) {
  const parsed = new URL(value);
  return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
}

function canonicalExternalClientOrigin(value) {
  const origin = canonicalDevClientOrigin(value);
  if (origin === null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      '--external-client-origin must be an exact HTTP(S) origin without credentials, path, query, or fragment',
      { origin: value },
    );
  }
  return origin;
}

function normalizeExternalClientOrigins(options, port) {
  const raw = options.externalClientOrigins
    ?? (options.externalClientOrigin === undefined || options.externalClientOrigin === null
      ? []
      : [options.externalClientOrigin]);
  if (!Array.isArray(raw)) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'external client origins must be supplied as an array of exact origins',
    );
  }
  const origins = [...new Set(raw.map(canonicalExternalClientOrigin))].sort();
  if (origins.length > 0 && port === null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      '--external-client-origin requires a backend pin (--port or SNAPBACK_DEV_PORT) so attach identity cannot drift with port selection',
      {
        supportedProfile: 'snapback dev --port <backend-port> --external-client-origin <client-origin>',
        environmentEquivalent: 'SNAPBACK_DEV_PORT',
      },
    );
  }
  return origins;
}

function normalizeSupervisedClientOrigins(options) {
  const raw = options.supervisedClientOrigins ?? [];
  if (!Array.isArray(raw)) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'supervised client origins must be supplied as an array of exact origins',
    );
  }
  return [...new Set(raw.map(canonicalExternalClientOrigin))].sort();
}

function withExternalClientOrigins(environment, declaredClientOrigins) {
  const inherited = String(environment.SNAPBACK_DEV_AUTH_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(canonicalExternalClientOrigin);
  const clientOrigins = [...new Set([...inherited, ...declaredClientOrigins])].sort();
  const admissionPosture = clientOrigins.length === 0 ? 'loopback-any' : 'explicit-list';
  const nextEnvironment = {
    ...environment,
    // @ref LLP 0301#2-origin-admission--the-path-split-implemented — this is
    // lifecycle-owned spawn input: a hostile ambient value is always
    // overwritten together with the complete declaration list.
    SNAPBACK_DEV_ADMISSION_POSTURE: admissionPosture,
  };
  if (admissionPosture === 'loopback-any') delete nextEnvironment.SNAPBACK_DEV_AUTH_ORIGINS;
  else nextEnvironment.SNAPBACK_DEV_AUTH_ORIGINS = clientOrigins.join(',');
  return {
    environment: nextEnvironment,
    clientOrigins,
    admissionPosture,
  };
}

const DEV_ENV_BLOCK_START = '# >>> snapback dev >>>';
const DEV_ENV_BLOCK_END = '# <<< snapback dev <<<';

function devBackendUrls(serverUrl) {
  const port = portFromUrl(serverUrl);
  const snapbackUrl = canonicalDevClientOrigin(`http://127.0.0.1:${port}`);
  const androidEmulatorUrl = canonicalDevClientOrigin(`http://10.0.2.2:${port}`);
  return Object.freeze({
    snapbackUrl,
    androidEmulatorUrl,
  });
}

function devEnvironmentBlock({ snapbackUrl, androidEmulatorUrl }, newline = '\n') {
  return [
    DEV_ENV_BLOCK_START,
    `EXPO_PUBLIC_SNAPBACK_URL=${snapbackUrl}`,
    `VITE_SNAPBACK_URL=${snapbackUrl}`,
    `SNAPBACK_URL=${snapbackUrl}`,
    '# Android emulator (copy this value manually; do not uncomment it here):',
    `# EXPO_PUBLIC_SNAPBACK_URL=${androidEmulatorUrl}`,
    DEV_ENV_BLOCK_END,
  ].join(newline);
}

function devEnvironmentWriterConflict(path, reason, details = {}) {
  return diagnosticError(
    'SNAPBACK_DEV_ENV_WRITER_CONFLICT',
    `snapback dev refused to update ${path}: ${reason}`,
    { path: resolve(path), reason, ...details },
  );
}

function exactMarkerMatches(contents, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return [...contents.matchAll(new RegExp(`^${escaped}(?=\\r?$)`, 'gmu'))];
}

function managedEnvironmentKeys(contents) {
  const keys = [];
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?(EXPO_PUBLIC_SNAPBACK_URL|VITE_SNAPBACK_URL|SNAPBACK_URL)\s*=/u);
    if (match) keys.push(match[1]);
  }
  return keys;
}

function environmentFileIgnored(path, projectRoot) {
  const result = spawnSync(
    'git',
    ['check-ignore', '--quiet', '--no-index', '--', resolve(path)],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  return result.status === 0;
}

// @ref LLP 0301#4-snapback-dev-prints-the-url-the-opt-in-writer — one
// marker-owned, credential-free block is replaced atomically without
// normalizing any unrelated byte or changing an existing file's mode.
export function writeDevEnvironmentFile(path, {
  snapbackUrl,
  androidEmulatorUrl,
  projectRoot = dirname(resolve(path)),
  beforeRename = null,
} = {}) {
  if (
    typeof snapbackUrl !== 'string'
    || typeof androidEmulatorUrl !== 'string'
    || canonicalDevClientOrigin(snapbackUrl) !== snapbackUrl
    || canonicalDevClientOrigin(androidEmulatorUrl) !== androidEmulatorUrl
  ) {
    throw new TypeError('writeDevEnvironmentFile requires canonical snapbackUrl and androidEmulatorUrl origins');
  }
  const target = resolve(path);
  const existed = existsSync(target);
  const contents = existed ? readFileSync(target, 'utf8') : '';
  const starts = exactMarkerMatches(contents, DEV_ENV_BLOCK_START);
  const ends = exactMarkerMatches(contents, DEV_ENV_BLOCK_END);
  const markerLikeLines = contents
    .split(/\r?\n/u)
    .filter((line) => line.includes('snapback dev') && /[<>]{2,}/u.test(line));
  if (
    starts.length !== ends.length
    || starts.length > 1
    || markerLikeLines.length !== starts.length + ends.length
    || (starts.length === 1 && starts[0].index >= ends[0].index)
  ) {
    throw devEnvironmentWriterConflict(target, 'duplicate or malformed snapback dev marker blocks', {
      startMarkers: starts.length,
      endMarkers: ends.length,
    });
  }

  let prefix = contents;
  let suffix = '';
  let previousBlock = null;
  if (starts.length === 1) {
    const blockStart = starts[0].index;
    const blockEnd = ends[0].index + ends[0][0].length;
    prefix = contents.slice(0, blockStart);
    previousBlock = contents.slice(blockStart, blockEnd);
    suffix = contents.slice(blockEnd);
    const androidLine = previousBlock.split(/\r?\n/u).find((line) => (
      /^\s*(?:export\s+)?(?:EXPO_PUBLIC_SNAPBACK_URL|VITE_SNAPBACK_URL|SNAPBACK_URL)\s*=\s*https?:\/\/10\.0\.2\.2(?::|$)/u.test(line)
    ));
    if (androidLine !== undefined) {
      throw devEnvironmentWriterConflict(
        target,
        'an Android emulator URL was manually uncommented inside the managed block',
        { line: androidLine },
      );
    }
  }
  const outsideKeys = [...managedEnvironmentKeys(prefix), ...managedEnvironmentKeys(suffix)];
  if (outsideKeys.length > 0) {
    throw devEnvironmentWriterConflict(
      target,
      'managed Snapback URL keys exist outside the managed block',
      { keys: [...new Set(outsideKeys)].sort() },
    );
  }

  const newline = contents.includes('\r\n') ? '\r\n' : '\n';
  const block = devEnvironmentBlock({ snapbackUrl, androidEmulatorUrl }, newline);
  let nextContents;
  let state;
  if (previousBlock === null) {
    const separator = contents.length === 0 || contents.endsWith('\n') ? '' : newline;
    nextContents = `${contents}${separator}${block}${newline}`;
    state = 'inserted';
  } else {
    nextContents = `${prefix}${block}${suffix}`;
    state = previousBlock === block ? 'unchanged' : 'rewritten';
  }
  const gitignored = environmentFileIgnored(target, resolve(projectRoot));
  if (nextContents === contents) {
    return Object.freeze({
      path: target,
      state: 'unchanged',
      changed: false,
      gitignored,
      snapbackUrl,
      androidEmulatorUrl,
    });
  }

  mkdirSync(dirname(target), { recursive: true });
  const mode = existed ? statSync(target).mode & 0o7777 : 0o600;
  const temporary = join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, nextContents, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    beforeRename?.({ target, temporary });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
  return Object.freeze({
    path: target,
    state,
    changed: true,
    gitignored,
    snapbackUrl,
    androidEmulatorUrl,
  });
}

function probeLoopbackPortConnection(port) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(Object.freeze(result));
    };
    socket.setTimeout(500, () => settle({ state: 'indeterminate', error: 'ETIMEDOUT' }));
    socket.once('connect', () => settle({ state: 'accepting' }));
    socket.once('error', (error) => settle(
      error?.code === 'ECONNREFUSED'
        ? { state: 'refused', error: 'ECONNREFUSED' }
        : { state: 'indeterminate', error: error?.code ?? error?.message ?? 'UNKNOWN_SOCKET_ERROR' },
    ));
  });
}

async function fixedPortAttachFailure(error, {
  fixedPort,
  readyFile,
  applicationReadyFile = null,
  message,
  probePort = probeLoopbackPortConnection,
}) {
  const probe = await probePort(fixedPort);
  if (probe.state === 'accepting') {
    return diagnosticError(
      'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER',
      message,
      {
        port: fixedPort,
        readyFile,
        ...(applicationReadyFile === null ? {} : { applicationReadyFile }),
        cause: error.code ?? 'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
        supportedProfile: 'snapback dev --port <backend-port> --external-client-origin <client-origin>',
        safety: 'the listener was not adopted or terminated',
      },
    );
  }
  if (probe.state !== 'refused' || probe.error !== 'ECONNREFUSED') {
    const probeError = probe.error ?? 'UNKNOWN_SOCKET_ERROR';
    return diagnosticError(
      'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
      `the pinned host descriptor could not be verified, and the loopback port probe was indeterminate (${probeError}); preserving the descriptor`,
      {
        port: fixedPort,
        readyFile,
        ...(applicationReadyFile === null ? {} : { applicationReadyFile }),
        cause: error.code ?? 'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
        probeState: 'indeterminate',
        probeError,
        safety: 'the descriptor was preserved and no listener was adopted or terminated',
      },
    );
  }
  return diagnosticError(
    'SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR',
    `the pinned host descriptor appears stale; connection to port ${fixedPort} was refused at probe time`,
    {
      port: fixedPort,
      readyFile,
      ...(applicationReadyFile === null ? {} : { applicationReadyFile }),
      cause: error.code ?? 'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
      remediation: `remove the stale ready descriptor ${readyFile} and rerun snapback dev without --attach to start fresh`,
      safety: 'the connection was refused at probe time, so nothing was adopted or terminated',
    },
  );
}

async function probeLoopbackPort(port) {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') resolvePort(false);
      else rejectPort(error);
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close((error) => {
        if (error) rejectPort(error);
        else resolvePort(true);
      });
    });
  });
}

function describeDevPortHolder(port) {
  const binary = ['/usr/sbin/lsof', '/usr/bin/lsof'].find((path) => existsSync(path));
  if (binary === undefined) return null;
  try {
    const result = spawnSync(binary, [
      '-nP', `-i4TCP:${port}`, '-sTCP:LISTEN', '-Fpcn',
    ], { encoding: 'utf8', timeout: 10_000 });
    if (result.error || ![0, 1].includes(result.status)) return null;
    let pid = null;
    let command = null;
    for (const line of result.stdout.split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('c')) command = line.slice(1);
      else if (line.startsWith('n') && Number.isInteger(pid)) {
        const address = line.slice(1).replace(/\s+\(LISTEN\)$/u, '');
        const separator = address.lastIndexOf(':');
        const host = separator === -1 ? null : address.slice(0, separator);
        if (
          Number(address.slice(separator + 1)) === port
          && (host === '127.0.0.1' || host === '0.0.0.0' || host === '*')
        ) {
          return Object.freeze({ pid, command: command ?? null });
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function backendRangeExhaustionError(range, occupiedPorts) {
  const holders = [...occupiedPorts]
    .sort((left, right) => left - right)
    .map((port) => {
      const holder = describeDevPortHolder(port);
      return Object.freeze({
        port,
        pid: holder?.pid ?? null,
        command: holder?.command ?? null,
      });
    });
  return diagnosticError(
    'SNAPBACK_DEV_PORT_RANGE_EXHAUSTED',
    `the backend listener could not find a free port in ${range.lo}-${range.hi}`,
    { owner: 'backend', range: { lo: range.lo, hi: range.hi }, holders },
  );
}

async function observeBackendRange(plan, { stopAtFirstFree }) {
  const heldBySupervisor = new Set(plan.owners
    .filter(({ owner, port }) => owner !== 'backend' && Number.isInteger(port))
    .map(({ port }) => port));
  const occupied = [];
  for (let port = plan.range.lo; port <= plan.range.hi; port += 1) {
    if (heldBySupervisor.has(port)) continue;
    if (await probeLoopbackPort(port)) {
      if (stopAtFirstFree) return { available: true, occupied };
    } else {
      occupied.push(port);
    }
  }
  return { available: false, occupied };
}

async function assertBackendRangeAvailable(plan) {
  const observed = await observeBackendRange(plan, { stopAtFirstFree: true });
  if (!observed.available) throw backendRangeExhaustionError(plan.range, observed.occupied);
}

async function translateBackendRangeExhaustion(error, plan) {
  if (
    devPortPlanOwner(plan, 'backend')?.source !== 'range'
    || error?.code !== 'SNAPBACK_DEV_SERVER_START_FAILED'
  ) return null;
  const output = `${error?.diagnostic?.details?.stdout ?? ''}\n${error?.diagnostic?.details?.stderr ?? ''}`;
  if (!/no available Snapback port on/u.test(output)) return null;
  const observed = await observeBackendRange(plan, { stopAtFirstFree: false });
  return backendRangeExhaustionError(plan.range, observed.occupied);
}

async function validateReadyDescriptorHealth(descriptor) {
  // @ref LLP 0258#d2-one-bootstrap-owner-constructs-the-auth-bearing-application-client
  // — readiness inspection must not acquire the application's default local
  // store before the bootstrap owner constructs its client.
  const client = new SnapbackClient(descriptor.serverUrl, {
    rqsStore: null,
    offlineQueue: false,
  });
  try {
    const health = await client.health();
    if (
      health?.ok !== true
      || (
        typeof descriptor.startupNonce === 'string'
        && health?.binary?.startupNonce !== descriptor.startupNonce
      )
    ) {
      throw diagnosticError(
        'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
        'ready-file health identity did not match the live server',
        {
          expectedStartupNonce: descriptor.startupNonce ?? null,
          observedStartupNonce: health?.binary?.startupNonce ?? null,
        },
      );
    }
    return health;
  } finally {
    // A close failure must not replace the attach diagnostic; the probe holds
    // no store or queue, so there is nothing to recover from a failed close.
    await client.closeAuth().catch(() => {});
  }
}

// @ref LLP 0192#d-1a-reset-ownership-boundary — dev-fresh removes the
// database plus its registered siblings only for the canonical CLI-owned
// store; arbitrary database directories cannot confer recursive deletion
// authority.
function validateManagedDatabaseResetTarget(database, managedStoreRoot) {
  const selectedDatabase = resolve(database);
  const selectedStoreRoot = resolve(managedStoreRoot);
  const ownedDatabase = join(selectedStoreRoot, 'dev.sqlite3');

  let databaseMetadata = null;
  try {
    databaseMetadata = lstatSync(selectedDatabase);
  } catch (cause) {
    if (cause?.code !== 'ENOENT') {
      const error = diagnosticError(
        'SNAPBACK_RESET_DATABASE_PATH_INVALID',
        'dev-fresh could not validate --db as a regular file or an absent path; no managed state was removed',
        {
          database: selectedDatabase,
          observedType: 'unavailable',
          causeCode: cause?.code ?? null,
          requiredType: 'regular-file-or-absent',
        },
      );
      error.cause = cause;
      throw error;
    }
  }
  if (databaseMetadata !== null && !databaseMetadata.isFile()) {
    throw diagnosticError(
      'SNAPBACK_RESET_DATABASE_PATH_INVALID',
      'dev-fresh requires --db to name a regular file or an absent path; no managed state was removed',
      {
        database: selectedDatabase,
        observedType: databaseMetadata.isSymbolicLink()
          ? 'symbolic-link'
          : databaseMetadata.isDirectory()
            ? 'directory'
            : 'non-regular-file',
        requiredType: 'regular-file-or-absent',
      },
    );
  }

  if (selectedDatabase !== ownedDatabase) {
    throw diagnosticError(
      'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS',
      'dev-fresh cannot reset a custom or shared database directory because its assets and custody keyrings may belong to another database; no managed state was removed',
      {
        database: selectedDatabase,
        databaseDirectory: dirname(selectedDatabase),
        managedStoreRoot: selectedStoreRoot,
        ownedDatabase,
        sharedMembers: [
          'assets/blobs',
          'resume-keyring.json',
          'completeness-proof-keyring.json',
        ],
        recovery: 'use the canonical managed database for dev-fresh; preserve and repair a custom/shared store with store-specific tooling',
      },
    );
  }

  const managedDirectories = [
    [selectedStoreRoot, 'managed-store-root'],
    [join(selectedStoreRoot, 'assets'), 'asset-root'],
    [join(selectedStoreRoot, 'assets', 'blobs'), 'asset-blob-root'],
  ];
  for (const [path, member] of managedDirectories) {
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch (cause) {
      if (cause?.code === 'ENOENT') continue;
      const error = diagnosticError(
        'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS',
        'dev-fresh could not prove exclusive ownership of its managed-store directory; no managed state was removed',
        {
          database: selectedDatabase,
          managedStoreRoot: selectedStoreRoot,
          member,
          path,
          observedType: 'unavailable',
          causeCode: cause?.code ?? null,
        },
      );
      error.cause = cause;
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw diagnosticError(
        'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS',
        'dev-fresh requires its managed-store and asset roots to be non-symlink directories before recursive cleanup; no managed state was removed',
        {
          database: selectedDatabase,
          managedStoreRoot: selectedStoreRoot,
          member,
          path,
          observedType: metadata.isSymbolicLink() ? 'symbolic-link' : 'non-directory',
        },
      );
    }
  }

  return { database: selectedDatabase, storeRoot: selectedStoreRoot };
}

function removeManagedDatabaseState(
  database,
  readyFile = null,
  applicationReadyFile = null,
  managedStoreRoot = null,
) {
  const target = validateManagedDatabaseResetTarget(database, managedStoreRoot);
  for (const path of [
    target.database,
    `${target.database}-wal`,
    `${target.database}-shm`,
    `${target.database}-journal`,
    `${target.database}.auth-keyring.json`,
    `${target.database}.config.json`,
    `${target.database}.operation-detail-keyring.json`,
    `${target.database}.admin-token`,
    `${target.database}.console-credentials`,
    `${target.database}.dev-identity`,
    join(target.storeRoot, 'completeness-proof-keyring.json'),
    join(target.storeRoot, 'resume-keyring.json'),
    ...(readyFile === null ? [] : [readyFile, `${readyFile}.dev-identity`]),
    ...(applicationReadyFile === null ? [] : [applicationReadyFile]),
  ]) {
    rmSync(path, { force: true });
  }
  rmSync(join(target.storeRoot, 'assets', 'blobs'), { force: true, recursive: true });
}

const DEV_FRESH_RESET_ARTIFACTS = 'this is supported only for the canonical CLI-owned `<project>/.snapback/dev.sqlite3`; after validating ownership and refusing custom, shared, or symlink-ambiguous paths before deletion, it removes the managed whole store, including custody keyrings/configuration and asset blobs: the selected database and its `-wal`, `-shm`, `-journal`, `.auth-keyring.json`, `.config.json`, `.operation-detail-keyring.json`, `.admin-token`, `.console-credentials`, and `.dev-identity` siblings; the store\'s `completeness-proof-keyring.json`, `resume-keyring.json`, and `assets/blobs`; plus managed ready/application-ready files. Unregistered files in `.snapback` are preserved';

function shellSingleQuotePath(path) {
  return `'${String(path).replaceAll("'", `'"'"'`)}'`;
}

function devFreshDestructiveRepair(database) {
  return `For disposable local dev data only, run \`snapback reset --dev-fresh --db ${shellSingleQuotePath(database)}\`; ${DEV_FRESH_RESET_ARTIFACTS}`;
}

export function native(binary, args, options = {}) {
  return spawnSync(binary, args, {
    cwd: options.cwd,
    env: runtimeSpawnEnvironment(binary, options.env),
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
  });
}

function requireNativeSuccess(result, code, operation) {
  if (result.status !== 0) {
    throw diagnosticError(code, `${operation} failed`, {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 4_000) ?? '',
      stderr: result.stderr?.slice(0, 4_000) ?? '',
    });
  }
  return result;
}

function parseJsonDocumentStream(stdout) {
  const input = typeof stdout === 'string' ? stdout : String(stdout ?? '');
  const documents = [];
  let documentStart = null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const isWhitespace = (character) => (
    character === ' ' || character === '\t' || character === '\n' || character === '\r'
  );

  for (let cursor = 0; cursor < input.length; cursor += 1) {
    const character = input[cursor];
    if (documentStart === null) {
      if (isWhitespace(character)) continue;
      if (character !== '{') {
        throw new SyntaxError(`native output contained non-JSON content at character ${cursor}`);
      }
      documentStart = cursor;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          documents.push(JSON.parse(input.slice(documentStart, cursor + 1)));
        } catch (cause) {
          throw new SyntaxError(
            `native output contained invalid JSON at character ${documentStart}: ${cause.message}`,
            { cause },
          );
        }
        documentStart = null;
      }
    }
  }
  if (documentStart !== null) {
    throw new SyntaxError(
      `native output ended before the JSON document at character ${documentStart} was complete`,
    );
  }
  if (documents.length === 0) {
    throw new SyntaxError('native output contained no JSON documents');
  }
  return documents;
}

function requireNativeJsonSuccess(result, code, operation) {
  requireNativeSuccess(result, code, operation);
  let documents;
  try {
    documents = parseJsonDocumentStream(result.stdout);
  } catch (cause) {
    const error = diagnosticError(code, `${operation} failed`, {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 4_000) ?? '',
      stderr: result.stderr?.slice(0, 4_000) ?? '',
      framingError: cause.message,
    });
    error.cause = cause;
    throw error;
  }
  const failed = documents.find((document) => document?.ok === false);
  if (failed) {
    throw diagnosticError(code, `${operation} failed`, {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 4_000) ?? '',
      stderr: result.stderr?.slice(0, 4_000) ?? '',
      failedOperation: failed.operation ?? null,
      failedEnvelope: failed,
    });
  }
  return documents;
}

const ARTIFACT_DECODE_EVIDENCE = /(?:unknown|missing|duplicate) field|invalid (?:json|type)|expected (?:struct|map|sequence|string)|did not match any variant|data did not match|SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH|SNAPBACK_STALE_(?:SCHEMA|FUNCTION)_ARTIFACT_(?:KIND|VERSION)/i;

// The auth-mode startup pin refusing a *different* artifact pair is not a
// decode failure: the runtime parsed both manifests and computed a deployment
// identity that differs from the pinned one. Only these identity-refusal
// messages prove that; carrier shape/format failures with the same code stay
// decode-shaped (a genuinely stale runtime emits those).
const AUTH_STARTUP_PIN_EVIDENCE = /startup artifact (?:pair|identity) differs from the (?:pinned|pending) deployment/i;

function failureEvidenceStrings(error) {
  const diagnostic = error?.diagnostic ?? {};
  return [
    error?.message,
    diagnostic.message,
    diagnostic.details?.error,
    diagnostic.details?.stdout,
    diagnostic.details?.stderr,
  ].filter((value) => typeof value === 'string' && value.length > 0).join('\n');
}

// The native runtime prints the complete refusal as one structured
// `snapback.startup-diagnostic.v1` stderr line (LLP 0058: the CLI emits the
// exact expected deployment identity). Recover it so the managed diagnostic
// can carry the expected/observed identities instead of prose fragments.
function structuredStartupDiagnostic(error) {
  const details = error?.diagnostic?.details ?? {};
  const captured = [details.stderr, details.stdout]
    .filter((value) => typeof value === 'string')
    .join('\n');
  for (const line of captured.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed?.schemaVersion === 'snapback.startup-diagnostic.v1'
        && typeof parsed.diagnostic?.code === 'string'
      ) {
        return parsed.diagnostic;
      }
    } catch {
      // Not a structured diagnostic line; keep scanning.
    }
  }
  return null;
}

function authStartupPinRefusal(error) {
  const code = error?.diagnostic?.code;
  if (
    code !== 'SNAPBACK_DEV_SERVER_START_FAILED'
    && code !== 'SNAPBACK_DEV_SERVER_LOAD_FAILED'
  ) {
    return null;
  }
  const structured = structuredStartupDiagnostic(error);
  if (
    structured?.code === 'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH'
    && structured.details?.observedDeployment
  ) {
    // Both identities computed: the pair decoded, the pin refused it.
    return structured;
  }
  if (AUTH_STARTUP_PIN_EVIDENCE.test(failureEvidenceStrings(error))) {
    return structured?.code === 'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH'
      ? structured
      : { code: 'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH', details: {} };
  }
  return null;
}

function generatedArtifactDecodeFailure(error) {
  const diagnostic = error?.diagnostic ?? {};
  const evidence = failureEvidenceStrings(error);
  return (
    diagnostic.code === 'SNAPBACK_REQUEST_JSON_INVALID'
    || (
      (
        diagnostic.code === 'SNAPBACK_DEV_SERVER_LOAD_FAILED'
        || diagnostic.code === 'SNAPBACK_DEV_SERVER_START_FAILED'
      )
      && ARTIFACT_DECODE_EVIDENCE.test(evidence)
    )
  );
}

function refineGeneratedArtifactFailure(error, {
  binary,
  runtime = null,
  runtimeIdentity = null,
  artifacts = [],
  database = null,
} = {}) {
  // issues/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic:
  // surface the auth-mode startup pin as itself. Wrapping it in the
  // runtime-identity mismatch sent consumers reinstalling runtimes that were
  // never at fault; the sanctioned evolution path is a provision through the
  // running server, not a cold start over regenerated artifacts.
  const pin = authStartupPinRefusal(error);
  if (pin) {
    const diagnosticDatabase = database ? resolve(database) : '<database>';
    const quotedDatabase = shellSingleQuotePath(diagnosticDatabase);
    const devFresh = devFreshDestructiveRepair(diagnosticDatabase);
    const refused = diagnosticError(
      'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH',
      'the sessions deployment refused to start because the startup artifact pair differs from the pinned deployment; the runtime and codegen agree — evolve the deployment through the running server instead of cold-starting on regenerated artifacts',
      {
        causeCode: error?.diagnostic?.code ?? null,
        expectedDeployment: pin.details?.expectedDeployment ?? null,
        observedDeployment: pin.details?.observedDeployment ?? null,
        artifacts: artifacts.map((path) => resolve(path)),
        recovery: {
          sanctionedEvolution: 'run the evolved sources through the running dev server (`snapback dev` watch reload or the reload verb): its app.ensure provision moves the pinned deployment forward',
          coldStartRepair: 'to cold-start first, restore the generated artifacts matching the pinned deployment (regenerate from the previous sources if needed), boot, then apply the evolved sources through the running server',
          // issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md:
          // the discard path is a supported procedure, not author intuition —
          // name the exact whole-store preservation/reset commands and the
          // ownership boundary that makes recursive asset cleanup safe.
          freshReseed: 'to discard the managed whole store and reseed from scratch: first preserve the complete durable-state set if needed with '
            + `\`snapback store export --db ${quotedDatabase} --output <ignored-store-export-dir>\`. `
            + `Then use the supported one-shot path: ${devFresh}`,
          safety: 'the refusal compares the startup carrier\'s deployment identity with the active deployment identity stored in the selected database; it is not a keyring, runtime, or codegen mismatch (LLP 0058). The whole-store scope comes from the managed reset and custody contract (LLP 0192), not from keyrings participating in this comparison; do not hand-edit generated artifacts or hashes to match the pin',
        },
      },
    );
    refused.cause = error;
    return refused;
  }
  if (!generatedArtifactDecodeFailure(error)) return error;
  const causeDiagnostic = error?.diagnostic ?? null;
  const mismatch = diagnosticError(
    'SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH',
    'the selected Snapback runtime could not deserialize artifacts emitted by the current codegen; use a runtime built from the same Snapback revision/package closure',
    {
      selectedBinary: resolve(binary),
      selectedRuntimeSource: runtime?.source ?? null,
      selectedRuntimeStamp: runtimeIdentity?.stamp ?? null,
      artifacts: artifacts.map((path) => resolve(path)),
      causeCode: causeDiagnostic?.code ?? error?.code ?? null,
      decoderEvidence: typeof causeDiagnostic?.details?.error === 'string'
        ? causeDiagnostic.details.error.slice(0, 1_000)
        : null,
      recovery: {
        contributorRebuild: 'scripts/bootstrap-ibex-runtime && cargo build --bin snapback',
        compatibleOverride: 'SNAPBACK_RUNTIME_BINARY=/absolute/path/to/compatible/snapback snapback dev <backend>',
        safety: 'do not delete generated fields or hand-edit artifacts to fit an older runtime',
      },
    },
  );
  mismatch.cause = error;
  return mismatch;
}

const MAX_ADMIN_TOKEN_FILE_BYTES = 4 * 1024;
// HTTP field values admit HTAB, visible ASCII, and obs-text. Everything else
// is also unsafe to hand across the environment/header carrier boundary.
const INVALID_ADMIN_TOKEN_CARRIER_VALUE = /[^\t\x20-\x7e\x80-\xff]/u;

function readOwnerOnlyAdminTokenFile(path) {
  const absolute = resolve(path);
  let bytes;
  try {
    bytes = readFileDescriptorSafe(
      absolute,
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      {
        maximumBytes: MAX_ADMIN_TOKEN_FILE_BYTES,
        ownerOnly: true,
        makeFailure: (code, message, details) => diagnosticError(code, message, details),
      },
    );
  } catch (cause) {
    if (cause?.code === 'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID') throw cause;
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the admin-token carrier could not be read safely',
      { path: absolute },
    );
  }
  const text = bytes.toString('utf8');
  const token = text.endsWith('\r\n')
    ? text.slice(0, -2)
    : (text.endsWith('\n') ? text.slice(0, -1) : text);
  if (!token) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the admin-token carrier is empty',
      { path: absolute },
    );
  }
  if (INVALID_ADMIN_TOKEN_CARRIER_VALUE.test(token)) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the admin-token carrier contains characters that cannot be used safely',
      { path: absolute },
    );
  }
  return token;
}

export function managedAdminToken(descriptor, database) {
  const declared = descriptor?.adminTokenFile;
  if (typeof declared !== 'string') return null;
  const expected = canonicalFileCarrierPath(`${resolve(database)}.admin-token`);
  if (canonicalFileCarrierPath(declared) !== expected) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names an unexpected admin-token carrier',
      { expectedAdminTokenFile: expected, observedAdminTokenFile: resolve(declared) },
    );
  }
  return readOwnerOnlyAdminTokenFile(expected);
}

const DEFAULT_DEV_SESSION_EMAIL = 'snapback-dev@localhost.invalid';

function devSessionTargetMissing(paths, cause = null) {
  const error = diagnosticError(
    'SNAPBACK_DEV_SESSION_TARGET_MISSING',
    `no live receipt-verified managed development target was found at ${paths.join(', ')}`,
    {
      triedPaths: paths,
      cause: cause?.code ?? cause?.message ?? null,
    },
  );
  if (cause !== null) error.cause = cause;
  return error;
}

// @ref LLP 0301#5-snapback-auth-dev-session — this explicit operator action
// reuses the managed ready descriptor and its existing store-owned admin
// token; it creates no durable credential carrier of its own.
export async function mintDevSession({
  readyFile = null,
  email = DEFAULT_DEV_SESSION_EMAIL,
  cwd = process.cwd(),
  env = process.env,
  runtimeBinary = null,
} = {}) {
  const requestedReadyFile = resolve(cwd, readyFile ?? join('.snapback', 'dev.ready.json'));
  const triedPaths = [requestedReadyFile];
  const selectedReadyFile = existsSync(requestedReadyFile)
    ? realpathSync.native(requestedReadyFile)
    : requestedReadyFile;
  let descriptor;
  try {
    descriptor = readReadyDescriptor(selectedReadyFile);
    if (typeof descriptor.startupNonce !== 'string' || descriptor.startupNonce.length === 0) {
      throw diagnosticError(
        'SNAPBACK_DEV_READY_FILE_INVALID',
        'the managed development ready descriptor has no startup nonce',
        { readyFile: selectedReadyFile },
      );
    }
    await validateReadyDescriptorHealth(descriptor);
  } catch (error) {
    throw devSessionTargetMissing(triedPaths, error);
  }
  const database = descriptor?.database?.mode === 'file'
    && typeof descriptor?.database?.path === 'string'
    ? descriptor.database.path
    : null;
  if (database === null) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'snapback auth dev-session requires a managed file-store admin-token artifact',
      { readyFile: selectedReadyFile, databaseMode: descriptor?.database?.mode ?? null },
    );
  }
  let operatorToken = managedAdminToken(descriptor, database);
  if (typeof operatorToken !== 'string' || operatorToken.length === 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'snapback auth dev-session requires the existing managed admin-token artifact',
      { readyFile: selectedReadyFile },
    );
  }
  try {
    const runtime = resolveRuntimeBinary({
      runtimeBinary: runtimeBinary ?? env?.SNAPBACK_RUNTIME_BINARY ?? null,
      env,
      projectRoot: cwd,
    });
    const { mintSupervisedOrdinarySession } = await import('./expo-dev.mjs');
    const minted = mintSupervisedOrdinarySession({
      runtimeBinary: runtime.binary,
      readyFile: selectedReadyFile,
      email,
      operatorToken,
      cwd,
      env,
    });
    if (minted.status !== 'ready') {
      const refusal = diagnosticError(
        minted.diagnostic.code,
        minted.diagnostic.message,
        minted.diagnostic.details,
      );
      refusal.diagnostic = minted.diagnostic;
      throw refusal;
    }
    if (!Number.isSafeInteger(minted.expiresAt)) {
      throw diagnosticError(
        'SNAPBACK_EXPO_SESSION_MINT_FAILED',
        'the native session mint omitted the ordinary session expiry',
      );
    }
    return Object.freeze({
      formatVersion: 'snapback.dev-session.v1',
      email,
      bearer: minted.token,
      expiresAt: minted.expiresAt,
    });
  } finally {
    operatorToken = null;
  }
}

function expectedDevIdentityCapabilityPath(descriptor, { readyFile, database = null } = {}) {
  // @ref LLP 0262#d2-carriers-per-shipped-topology — CLI custody follows the
  // server's database-sibling/ready-file-sibling anchor ladder exactly.
  if (descriptor?.database?.mode === 'file') {
    const path = descriptor.database.path ?? database;
    return typeof path === 'string' && path.length > 0
      ? `${resolve(path)}.dev-identity`
      : null;
  }
  if (descriptor?.database?.mode === 'memory') {
    return typeof readyFile === 'string' && readyFile.length > 0
      ? `${resolve(readyFile)}.dev-identity`
      : null;
  }
  return null;
}

/** Resolve a descriptor-advertised dev-identity capability on the admin-token
 * anchor ladder; null keeps Stage 2 compatible with older local binaries. */
export function managedDevIdentityCapability(descriptor, context = {}) {
  const declared = descriptor?.devIdentityCapabilityFile;
  const expected = expectedDevIdentityCapabilityPath(descriptor, context);
  if (typeof declared !== 'string' || expected === null) return null;
  if (canonicalFilesystemPath(declared) !== canonicalFilesystemPath(expected)) return null;
  let metadata;
  try {
    metadata = lstatSync(expected);
  } catch {
    return null;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    return null;
  }
  let capability;
  try {
    capability = readFileSync(expected, 'utf8').trim();
  } catch {
    return null;
  }
  return capability.length > 0
    && capability.length <= 256
    && /^sbdev_[A-Za-z0-9._~-]+$/u.test(capability)
    ? capability
    : null;
}

let missingDevIdentityCapabilityNoted = false;
function resolveDevIdentityCapabilityForCli(descriptor, context) {
  const capability = managedDevIdentityCapability(descriptor, context);
  if (capability !== null || missingDevIdentityCapabilityNoted) return capability;
  missingDevIdentityCapabilityNoted = true;
  const expected = expectedDevIdentityCapabilityPath(descriptor, context);
  // @ref LLP 0262#d5-rollout-stages — Stage 2 proceeds without custody, but
  // the first capability-less CLI assertion is explicit on operator stderr.
  process.stderr.write(
    'SNAPBACK_DEV_IDENTITY_ABSENT: no usable dev-identity capability was found'
      + `${expected ? ` at ${expected}` : ''}; continuing without it during Stage 2; `
      + `enforcement flip ${DEV_IDENTITY_ENFORCEMENT_FLIP} remains acceptance-gated; `
      + 'see LLP 0262#d5-rollout-stages\n',
  );
  return null;
}

function devIdentityClientEnvironment(environment, descriptor, capability) {
  return {
    ...environment,
    ...(capability !== null && typeof descriptor?.devIdentityCapabilityFile === 'string'
      ? { SNAPBACK_DEV_IDENTITY_FILE: descriptor.devIdentityCapabilityFile }
      : {}),
  };
}

export async function waitForReady(path, child, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return readReadyDescriptor(path);
    if (child.exitCode !== null) {
      throw diagnosticError('SNAPBACK_DEV_SERVER_START_FAILED', `Snapback exited before writing ${path}`, {
        status: child.exitCode,
        stdout: child.__snapbackCapturedOutput?.stdout?.slice(-4_000) ?? '',
        stderr: child.__snapbackCapturedOutput?.stderr?.slice(-4_000) ?? '',
      });
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw diagnosticError('SNAPBACK_DEV_SERVER_READY_TIMEOUT', `Snapback did not write ${path} within ${timeoutMs}ms`, { path });
}

export function spawnManagedRuntime(binary, args, {
  cwd,
  env,
  stdio = ['ignore', 2, 2],
} = {}) {
  const requested = Array.isArray(stdio) ? stdio : ['ignore', stdio, stdio];
  const child = spawn(binary, args, {
    cwd,
    env: runtimeSpawnEnvironment(binary, env),
    // Capture bounded startup diagnostics so a strict artifact decoder
    // refusal can be classified. Forwarding below preserves the caller's
    // requested human/test output behavior.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const captured = { stdout: '', stderr: '' };
  Object.defineProperty(child, '__snapbackCapturedOutput', {
    value: captured,
    enumerable: false,
  });
  const attach = (stream, name, destination) => {
    stream?.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      captured[name] = `${captured[name]}${text}`.slice(-8_000);
      if (destination === 'inherit') {
        (name === 'stdout' ? process.stdout : process.stderr).write(chunk);
      } else if (destination === 1) {
        process.stdout.write(chunk);
      } else if (destination === 2) {
        process.stderr.write(chunk);
      } else if (destination && typeof destination.write === 'function') {
        destination.write(chunk);
      }
    });
  };
  attach(child.stdout, 'stdout', requested[1]);
  attach(child.stderr, 'stderr', requested[2]);
  return child;
}

function managedDevRuntimeEnvironment(environment) {
  const childEnvironment = {
    ...scrubDynamicLoaderEnvironment(environment),
    // @ref LLP 0193#program — managed development is the explicit opt-in
    // boundary for bounded handler exception detail. Native `start` and every
    // production launcher remain redacted unless they make the same deliberate
    // choice; an inherited caller value cannot silently change this supervisor.
    SNAPBACK_HANDLER_ERROR_EXPOSURE: 'development',
    // @ref LLP 0267#71-posture-first-redaction-bounded-storage-localhosted —
    // managed development is the recorder's default-on boundary. Native
    // serving remains default-off and requires its own explicit instance flag.
    SNAPBACK_RUNTIME_COST_RECORDER: '1',
  };
  // @ref LLP 0301#2-origin-admission--the-path-split-implemented — the
  // posture and its complete declaration list were constructed immediately
  // before this spawn; neither is caller-pass-through state.
  return childEnvironment;
}

export async function loadGenerated(
  binary,
  projectRoot,
  backendRoot,
  readyFile,
  adminToken,
  {
    seed = false,
    database = null,
    skipSchemaFunctions = false,
    runtime = null,
    runtimeIdentity = null,
    env = process.env,
  } = {},
) {
  const legacyGeneratedDirectory = join(backendRoot, '_generated');
  let legacyGeneratedDirectoryPresent = false;
  try {
    lstatSync(legacyGeneratedDirectory);
    legacyGeneratedDirectoryPresent = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw diagnosticError(
        'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY_UNREADABLE',
        `${legacyGeneratedDirectory} could not be checked: ${error.message}`,
        { path: legacyGeneratedDirectory },
      );
    }
  }
  if (legacyGeneratedDirectoryPresent) {
    const canonicalPath = join(backendRoot, 'generated');
    throw diagnosticError(
      'SNAPBACK_CODEGEN_LEGACY_GENERATED_DIRECTORY',
      `${legacyGeneratedDirectory} is the retired generated-artifact spelling; remove it (including symlinks) and use ${canonicalPath} only`,
      {
        path: legacyGeneratedDirectory,
        canonicalPath,
        reason: 'one-generated-directory-no-watcher-aliases',
      },
    );
  }
  const generated = join(backendRoot, 'generated');
  const targetArgs = ['--ready-file', readyFile];
  const nativeEnvironment = adminToken
    ? { ...env, SNAPBACK_ADMIN_TOKEN: adminToken }
    : env;
  const optionalGeneratedArtifact = (artifactPath) => {
    let resolved;
    try {
      resolved = resolveGeneratedArtifact(generated, artifactPath);
    } catch (error) {
      if (error?.code === 'SNAPBACK_CODEGEN_ARTIFACT_NOT_IN_MANIFEST') return null;
      throw error;
    }
    return existsSync(resolved) ? resolved : null;
  };
  const schemaPath = resolveGeneratedArtifact(generated, 'schema.manifest.json');
  const functionsPath = resolveGeneratedArtifact(generated, 'functions.manifest.json');
  const schemaManifest = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const functionsManifest = JSON.parse(readFileSync(functionsPath, 'utf8'));
  const requestedMode = schemaManifest?.auth?.mode ?? 'dev';
  if (requestedMode !== 'dev' && requestedMode !== 'sessions') {
    throw diagnosticError(
      'SNAPBACK_DEV_AUTH_MODE_INVALID',
      'generated schema manifest does not name a supported auth mode',
      { requestedMode },
    );
  }
  const activation = {
    mode: requestedMode,
    branch: requestedMode === 'sessions' ? 'ensure-app' : 'dev-push',
    generated: {
      deployment: {
        schemaVersion: schemaManifest?.schemaVersion,
        authMode: requestedMode,
        appId: schemaManifest?.appId,
        schemaHash: schemaManifest?.schemaHash,
        bundleHash: functionsManifest?.bundleHash,
        inputsHash: schemaManifest?.inputsHash,
      },
      functionAppId: functionsManifest?.appId,
      functionSchemaVersion: functionsManifest?.schemaVersion,
      functionInputsHash: functionsManifest?.inputsHash,
      targetProfile: schemaManifest?.targetProfile ?? null,
    },
    routes: null,
    apiEnvelope: null,
    seed: null,
  };
  const versionedSeedPath = optionalGeneratedArtifact('seed.artifact.json');
  const routesPath = optionalGeneratedArtifact('routes.manifest.json');
  // @ref LLP 0062#5-distribution-the-server-advertises-the-server-is-the-version-authority — codegen's envelope members ride the provision intent; the server composes.
  const apiEnvelopePath = optionalGeneratedArtifact('api-envelope.members.json');
  const apiEnvelopeMembers = apiEnvelopePath
    ? JSON.parse(readFileSync(apiEnvelopePath, 'utf8'))
    : null;
  const artifact = versionedSeedPath
    ? JSON.parse(readFileSync(versionedSeedPath, 'utf8'))
    : null;
  const routes = routesPath
    ? JSON.parse(readFileSync(routesPath, 'utf8'))
    : null;
  if (artifact) {
    const capabilityManifest = JSON.parse(
      readFileSync(resolveGeneratedArtifact(generated, 'capability.manifest.json'), 'utf8'),
    );
    const capability = seed ? 'versioned_seed_reset_v1' : 'versioned_seed_install_v1';
    if (!(capabilityManifest.supportedCapabilities ?? []).includes(capability)) {
      throw diagnosticError(
        'SNAPBACK_CLIENT_SEED_PROTOCOL_UNSUPPORTED',
        `generated target manifest does not advertise ${capability}; managed CLI will not fall back to legacy reset/seed`,
        { capability },
      );
    }
  }
  if (!skipSchemaFunctions && requestedMode === 'dev') {
    try {
      // @ref LLP 0041#cli-commands — `load` projects one hostOpsResult JSON
      // document per requested host operation, so schema + functions is a
      // sequential document stream rather than one aggregate envelope.
      requireNativeJsonSuccess(native(binary, [
        'load', ...targetArgs,
        '--schema', schemaPath,
        '--functions', functionsPath,
      ], { cwd: projectRoot, env: nativeEnvironment }), 'SNAPBACK_DEV_SERVER_LOAD_FAILED', 'schema/function load');
    } catch (error) {
      throw refineGeneratedArtifactFailure(error, {
        binary,
        runtime,
        runtimeIdentity,
        database,
        artifacts: [schemaPath, functionsPath],
      });
    }
  }
  if (requestedMode === 'sessions' || artifact || routes) {
    const descriptor = validateDevTarget(readReadyDescriptor(readyFile), {
      readyFile,
      database,
    });
    // @ref LLP 0058#kit-ordering — sessions-mode managed tooling establishes
    // real coordinator custody through /auth/session before Public
    // inspection or app-data ensure; adminToken is not caller authority.
    const authCoordinator = requestedMode === 'sessions'
      ? new AuthCoordinator({
          appId: schemaManifest.appId,
          storage: createMemoryAuthCustodyStorage(),
          broadcastChannelFactory: null,
          hintStorage: null,
        })
      : null;
    const client = new SnapbackClient(descriptor.serverUrl, {
      adminToken,
      ...(authCoordinator ? { authCoordinator } : {}),
    });
    try {
      if (authCoordinator) await client.authSession();
      try {
        if (requestedMode === 'sessions') {
          // @ref LLP 0058#cold-startup-artifact-carrier — sessions
          // deployments are established at process start and every later
          // update re-enters through the complete, coordinator-owned
          // provisioning pair; the raw v0 host-load verbs are dev-only.
          const outcome = await client.ensureApp({
            intent: 'provision',
            requestedMode,
            schema: schemaManifest,
            functions: functionsManifest,
            ...(routes ? { routes } : {}),
            ...(apiEnvelopeMembers ? { apiEnvelope: apiEnvelopeMembers } : {}),
          });
          if (routes) {
            activation.routes = {
              sent: true,
              outcome: outcome.routes ?? null,
              routeManifestHash: sha256Jcs(routes),
            };
          }
          if (apiEnvelopeMembers) {
            activation.apiEnvelope = {
              sent: true,
              provisioned: outcome.apiEnvelope === 'composed',
              membersDigest: sha256Jcs(apiEnvelopeMembers),
            };
          }
        } else if (routes) {
          const outcome = await client.ensureApp({ routes });
          activation.routes = {
            sent: true,
            outcome: outcome.routes ?? null,
            routeManifestHash: sha256Jcs(routes),
          };
        }
      } catch (error) {
        throw refineGeneratedArtifactFailure(error, {
          binary,
          runtime,
          runtimeIdentity,
          database,
          artifacts: [
            schemaPath,
            functionsPath,
            ...(routesPath ? [routesPath] : []),
          ],
        });
      }
      // @ref LLP 0109#31-new-appensure-intent — a versioned install/reset
      // names the generated auth mode; tooling must not send the default
      // `dev` for a sessions artifact pair.
      if (artifact && seed) {
        const preview = await client.previewVersionedSeed(artifact, {
          operation: 'install',
          requestedMode,
        });
        const stream = preview?.requested?.dataVersionStream;
        await client.resetInstallVersionedSeed(artifact, {
          requestedMode,
          expectedDataVersionStream: typeof stream === 'string'
            ? { state: 'present', value: stream }
            : { state: 'absent' },
        });
        activation.seed = {
          operation: 'reset-install',
          seedVersion: artifact.seedVersion,
          seedDigest: artifact.seedDigest,
        };
      } else if (artifact) {
        await client.ensureVersionedSeed(artifact, { requestedMode });
        activation.seed = {
          operation: 'ensure',
          seedVersion: artifact.seedVersion,
          seedDigest: artifact.seedDigest,
        };
      }
    } finally {
      await client.closeAuth();
      await authCoordinator?.close();
    }
  }
  const seedPath = join(backendRoot, 'seed.json');
  if (!artifact && seed && existsSync(seedPath)) {
    requireNativeSuccess(
      native(binary, ['reset', ...targetArgs, '--seed', seedPath], {
        cwd: projectRoot,
        env: nativeEnvironment,
      }),
      'SNAPBACK_DEV_SERVER_SEED_FAILED',
      'seed load',
    );
  }
  return activation;
}

function expectedActivationTargetFromActivation(activation, fallbackTargetProfile) {
  const generated = activation?.generated;
  const deployment = generated?.deployment;
  if (
    !generated
    || !deployment
    || (activation.branch !== 'dev-push' && activation.branch !== 'ensure-app')
    || activation.mode !== deployment.authMode
    || Object.values(deployment).some((value) => typeof value !== 'string' || value.length === 0)
    || generated.functionAppId !== deployment.appId
    || generated.functionSchemaVersion !== deployment.schemaVersion
    || generated.functionInputsHash !== deployment.inputsHash
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_READINESS_TARGET_INVALID',
      'generated artifacts do not form a complete application-readiness deployment identity',
    );
  }
  const declaredObligations = [
    { kind: 'schema', schemaHash: deployment.schemaHash },
    { kind: 'functions', bundleHash: deployment.bundleHash },
    ...(activation.branch === 'ensure-app' && activation.routes?.sent === true ? [{
      kind: 'routes',
      routeManifestHash: activation.routes.routeManifestHash,
    }] : []),
    ...(activation.seed ? [{
      kind: 'seed',
      seedVersion: activation.seed.seedVersion,
      seedDigest: activation.seed.seedDigest,
      idempotent: true,
    }] : []),
  ];
  // TODO(LLP 0224 Phase 2): declare apiEnvelope only after ensureApp returns
  // the server-composed envelope identity and a real sessions process test
  // proves it equals OperationalReadinessV1's active envelope fact. The
  // activation summary retains the exact sent-members digest until then.
  return {
    formatVersion: 'snapback.expected-activation-target.v1',
    deployment,
    targetProfile: generated.targetProfile ?? fallbackTargetProfile,
    declaredObligations,
    obligationsDigest: sha256Jcs(declaredObligations),
  };
}

async function requestOperationalReadiness(descriptor, adminToken, expectedTarget = undefined) {
  const url = `${descriptor.serverUrl.replace(/\/$/u, '')}/_snapback/api/host-ops`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
      },
      body: JSON.stringify({
        operation: 'app.readiness.v1',
        ...(expectedTarget === undefined ? {} : { input: { expectedTarget } }),
      }),
    });
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READINESS_FAILED',
      `application-readiness request to ${url} failed`,
      { url },
    );
    error.cause = cause;
    throw error;
  }
  let envelope;
  try {
    envelope = await response.json();
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READINESS_FAILED',
      `application-readiness response was not JSON (HTTP ${response.status})`,
      { url, status: response.status },
    );
    error.cause = cause;
    throw error;
  }
  const readiness = envelope?.data?.operationalReadiness;
  if (envelope?.ok !== true) {
    const serverDiagnostic = envelope?.diagnostics?.[0];
    throw diagnosticError(
      serverDiagnostic?.code ?? 'SNAPBACK_DEV_APPLICATION_READINESS_FAILED',
      serverDiagnostic?.message ?? 'the server refused its operational-readiness fact',
      {
        status: response.status,
        diagnostics: envelope?.diagnostics ?? [],
        unsatisfied: readiness?.unsatisfied ?? [],
        operationalReadiness: readiness ?? null,
      },
    );
  }
  if (
    readiness.formatVersion !== 'snapback.operational-readiness.v1'
    || typeof readiness.startupNonce !== 'string'
    || !Number.isInteger(readiness.evaluatedAtMs)
    || readiness.target == null
    || readiness.artifacts == null
    || readiness.auth == null
    || !Array.isArray(readiness.clientOrigins)
    || ![undefined, null, 'loopback-any', 'explicit-list'].includes(readiness.admissionPosture)
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READINESS_INVALID',
      'server returned an incomplete operational-readiness fact',
    );
  }
  return readiness;
}

async function evaluateApplicationReadiness(descriptor, adminToken, expectedTarget) {
  const readiness = await requestOperationalReadiness(descriptor, adminToken, expectedTarget);
  if (readiness.ready !== true) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_NOT_READY',
      'generated application did not reach operational readiness',
      {
        unsatisfied: readiness.unsatisfied ?? [],
        operationalReadiness: readiness,
      },
    );
  }
  return readiness;
}

export async function readOperationalReadiness(descriptor, adminToken) {
  return requestOperationalReadiness(descriptor, adminToken);
}

function exactRecordKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return sameStringSet(Object.keys(value), expected);
}

function recordKeysWithin(value, allowed) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function normalizedAdmissionPosture(value) {
  return value === undefined || value === null ? 'explicit-list' : value;
}

function admissionContract(admissionPosture, clientOrigins) {
  return Object.freeze({
    admissionPosture: normalizedAdmissionPosture(admissionPosture),
    clientOrigins: Object.freeze([...(clientOrigins ?? [])]),
  });
}

function assertDevAdmissionContractMatches(requested, recorded) {
  const requestedContract = admissionContract(
    requested?.admissionPosture,
    requested?.clientOrigins,
  );
  const recordedContract = admissionContract(
    recorded?.admissionPosture,
    recorded?.clientOrigins,
  );
  if (
    requestedContract.admissionPosture !== recordedContract.admissionPosture
    || !sameStringSet(requestedContract.clientOrigins, recordedContract.clientOrigins)
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_ATTACH_ADMISSION_MISMATCH',
      'the running server admission contract differs from the contract requested by this attaching lifecycle',
      {
        requestedAdmissionContract: requestedContract,
        recordedAdmissionContract: recordedContract,
        safety: 'the listener was not adopted, restarted, or mutated',
      },
    );
  }
  return recordedContract;
}

function receiptReadinessMismatches(receipt, readiness) {
  const mismatch = [];
  const liveTarget = readiness?.target;
  if (readiness?.formatVersion !== 'snapback.operational-readiness.v1') {
    mismatch.push('operationalReadiness.formatVersion');
  }
  if (readiness?.ready !== true || (readiness?.unsatisfied?.length ?? 0) !== 0) {
    mismatch.push('operationalReadiness.ready');
  }
  if (readiness?.startupNonce !== receipt.startupNonce) mismatch.push('startupNonce');
  if (receipt.application?.mode !== 'dev-generated') mismatch.push('application.mode');
  if (canonicalJson(receipt.application?.deployment) !== canonicalJson(liveTarget?.deployment)) {
    mismatch.push('application.deployment');
  }
  if (receipt.application?.obligationsDigest !== liveTarget?.obligationsDigest) {
    mismatch.push('application.obligationsDigest');
  }
  if (receipt.targetProfile !== liveTarget?.targetProfile) mismatch.push('targetProfile');
  if (canonicalJson(receipt.artifacts) !== canonicalJson(readiness?.artifacts)) {
    mismatch.push('artifacts');
  }
  if (receipt.auth?.activeMode !== readiness?.auth?.active) mismatch.push('auth.activeMode');
  if (receipt.auth?.desiredMode !== readiness?.auth?.desired) mismatch.push('auth.desiredMode');
  if (receipt.auth?.modeState !== readiness?.auth?.modeState) mismatch.push('auth.modeState');
  if (receipt.auth?.appDataAvailability !== readiness?.auth?.appDataAvailability) {
    mismatch.push('auth.appDataAvailability');
  }
  if (
    (receipt.auth?.sessionActivationReady ?? null)
      !== (readiness?.auth?.sessionActivationReady ?? null)
  ) mismatch.push('auth.sessionActivationReady');
  if (readiness?.auth?.active !== readiness?.auth?.desired) mismatch.push('auth.activeDesired');
  if (readiness?.auth?.modeState !== 'settled') mismatch.push('auth.settlement');
  if (readiness?.auth?.appDataAvailability !== 'available') mismatch.push('auth.appDataAvailabilityLive');
  if (
    readiness?.auth?.active === 'sessions'
    && readiness?.auth?.sessionActivationReady !== true
  ) mismatch.push('auth.sessionActivationReadyLive');
  if (receipt.capabilityManifestDigest !== readiness?.capabilityManifestDigest) {
    mismatch.push('capabilityManifestDigest');
  }
  if (!sameStringSet(receipt.clientOrigins, readiness?.clientOrigins)) {
    mismatch.push('clientOrigins');
  }
  if (
    normalizedAdmissionPosture(receipt.admissionPosture)
      !== normalizedAdmissionPosture(readiness?.admissionPosture)
  ) mismatch.push('admissionPosture');
  if (receipt.networkProfile !== readiness?.networkProfile) mismatch.push('networkProfile');
  return mismatch;
}

export function verifyApplicationReadyReceiptAgainstReadiness(receipt, readiness) {
  const mismatch = receiptReadinessMismatches(receipt, readiness);
  if (mismatch.length > 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READY_STALE',
      'the application-ready receipt no longer matches the live server-owned operational-readiness fact',
      {
        mismatch,
        receiptApplication: receipt.application ?? null,
        liveTarget: readiness?.target ?? null,
        safety: 'the listener was not mutated, adopted, or terminated',
      },
    );
  }
  return receipt;
}

function writeApplicationReadyReceipt(path, receipt) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return receipt;
}

function readApplicationReadyReceiptWithFormat(path, { legacyFormat = false } = {}) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READY_REQUIRED',
      `the intended server has no application-ready receipt at ${path}`,
      { path: resolve(path) },
    );
    error.cause = cause;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READY_UNSAFE',
      'the application-ready receipt must be an owner-only regular file, never a symlink',
      { path: resolve(path), mode: metadata.mode & 0o777 },
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READY_INVALID',
      `could not parse application-ready receipt ${path}`,
      { path: resolve(path) },
    );
    error.cause = cause;
    throw error;
  }
  const legacyRootKeys = [
    'application',
    'artifacts',
    'auth',
    'binding',
    'capabilityManifestDigest',
    'clientOrigins',
    'formatVersion',
    'hostReadyDescriptorDigest',
    'networkProfile',
    'runtimeIdentity',
    'settledAtMs',
    'startupNonce',
    'targetProfile',
  ];
  const rootKeys = [
    'admissionPosture',
    ...legacyRootKeys,
  ];
  const deploymentKeys = [
    'appId', 'authMode', 'bundleHash', 'inputsHash', 'schemaHash', 'schemaVersion',
  ];
  const binding = receipt?.binding;
  const qualifiedBinary = receipt?.runtimeIdentity?.qualifiedBinary;
  const wrapper = receipt?.runtimeIdentity?.wrapper;
  if (
    receipt?.formatVersion !== 'snapback.application-ready.v1'
    || (legacyFormat
      ? !exactRecordKeys(receipt, legacyRootKeys)
      : !exactRecordKeys(receipt, legacyRootKeys) && !exactRecordKeys(receipt, rootKeys))
    || (!legacyFormat
      && ![undefined, 'loopback-any', 'explicit-list'].includes(receipt.admissionPosture))
    || typeof receipt.startupNonce !== 'string'
    || typeof receipt.hostReadyDescriptorDigest !== 'string'
    || receipt.application?.mode !== 'dev-generated'
    || !exactRecordKeys(receipt.application, ['deployment', 'mode', 'obligationsDigest'])
    || !exactRecordKeys(receipt.application?.deployment, deploymentKeys)
    || Object.values(receipt.application.deployment).some(
      (value) => typeof value !== 'string' || value.length === 0,
    )
    || typeof receipt.application.obligationsDigest !== 'string'
    || typeof receipt.targetProfile !== 'string'
    || !recordKeysWithin(receipt.artifacts, ['bundleHash', 'databaseVersion', 'schemaHash'])
    || !recordKeysWithin(receipt.auth, [
      'activeMode',
      'appDataAvailability',
      'desiredMode',
      'modeState',
      'sessionActivationReady',
    ])
    || typeof receipt.auth.activeMode !== 'string'
    || typeof receipt.auth.desiredMode !== 'string'
    || typeof receipt.auth.modeState !== 'string'
    || typeof receipt.auth.appDataAvailability !== 'string'
    || binding?.format !== 'snapback.app-binding.v1'
    || binding?.source !== 'supervised-dev'
    || !exactRecordKeys(binding, [
      'capabilities',
      'descriptorIdentity',
      'format',
      'integrity',
      'provenance',
      'source',
      'target',
    ])
    || typeof binding.descriptorIdentity !== 'string'
    || !exactRecordKeys(binding.target, ['app', 'functions', 'origin', 'routing', 'schema'])
    || Object.values(binding.target).some((value) => typeof value !== 'string')
    || !exactRecordKeys(binding.capabilities, ['offered'])
    || !Array.isArray(binding.capabilities.offered)
    || binding.capabilities.offered.some((value) => typeof value !== 'string')
    || !exactRecordKeys(binding.provenance, ['expiresAt', 'issuedAt', 'supervisorGeneration'])
    || Object.values(binding.provenance).some((value) => typeof value !== 'string')
    || !exactRecordKeys(binding.integrity, ['channel'])
    || binding.integrity.channel !== 'local-supervised-ipc'
    || !Array.isArray(receipt.clientOrigins)
    || new Set(receipt.clientOrigins).size !== receipt.clientOrigins.length
    || receipt.clientOrigins.some((origin) => canonicalDevClientOrigin(origin) !== origin)
    || !exactRecordKeys(receipt.runtimeIdentity, ['qualifiedBinary', 'wrapper'])
    || !exactRecordKeys(qualifiedBinary, [
      'buildIdentity', 'bytes', 'path', 'platform', 'qualification', 'sha256', 'source',
    ])
    || typeof qualifiedBinary.path !== 'string'
    || typeof qualifiedBinary.source !== 'string'
    || typeof qualifiedBinary.platform !== 'string'
    || !Number.isSafeInteger(qualifiedBinary.bytes)
    || typeof qualifiedBinary.sha256 !== 'string'
    || !recordKeysWithin(qualifiedBinary.buildIdentity, [
      'buildProfile', 'crateVersion', 'gitCommit', 'gitDirty',
    ])
    || !exactRecordKeys(qualifiedBinary.qualification, [
      'probe', 'receiptPath', 'receiptSchemaVersion',
    ])
    || !exactRecordKeys(wrapper, ['package', 'version'])
    || typeof wrapper.package !== 'string'
    || typeof wrapper.version !== 'string'
    || typeof receipt.capabilityManifestDigest !== 'string'
    || typeof receipt.networkProfile !== 'string'
    || !Number.isSafeInteger(receipt.settledAtMs)
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READY_INVALID',
      'the application-ready receipt does not carry the canonical lifecycle identity fields',
      { path: resolve(path) },
    );
  }
  if (legacyFormat) return receipt;
  return {
    ...receipt,
    // @ref LLP 0301#3-receipt-posture--writer-matrix-reader-rule-attach-contract —
    // a missing field is the legacy exact-list contract.
    admissionPosture: normalizedAdmissionPosture(receipt.admissionPosture),
  };
}

export function readApplicationReadyReceipt(path) {
  return readApplicationReadyReceiptWithFormat(path);
}

function readLegacyApplicationReadyReceipt(path) {
  return readApplicationReadyReceiptWithFormat(path, { legacyFormat: true });
}

function qualifiedRuntimeIdentity(
  runtime,
  runtimeIdentity,
  qualifiedBinary = null,
  environment = process.env,
  cliPackageRoot = packageRoot,
) {
  const qualifiedPath = qualifiedBinary === null ? null : resolve(qualifiedBinary);
  const qualifiedPhysicalPath = qualifiedPath !== null && existsSync(qualifiedPath)
    ? realpathSync(qualifiedPath)
    : qualifiedPath;
  const checkoutRoot = sourceCheckoutRoot(cliPackageRoot);
  const checkoutRelative = qualifiedPhysicalPath === null || checkoutRoot === null
    ? null
    : relative(checkoutRoot, qualifiedPhysicalPath);
  const qualifiedCheckoutRoot = checkoutRelative !== null
    && checkoutRelative !== ''
    && checkoutRelative !== '..'
    && !checkoutRelative.startsWith(`..${sep}`)
    ? checkoutRoot
    : null;
  const qualifiedRuntime = qualifiedBinary === null
    ? runtime
    : {
        binary: qualifiedPath,
        source: 'qualified-override',
        platform: runtime.platform,
        ...(qualifiedCheckoutRoot === null ? {} : { checkoutRoot: qualifiedCheckoutRoot }),
      };
  const qualifiedBuildIdentity = qualifiedBinary === null
    ? runtimeIdentity
    : inspectRuntimeBinary(qualifiedRuntime.binary, environment);
  const runtimeRoot = runtimeReadinessRoot(qualifiedRuntime, cliPackageRoot);
  const packaged = !['override', 'qualified-override', 'source-checkout'].includes(
    qualifiedRuntime.source,
  );
  const receiptPath = packaged ? join(runtimeRoot, 'runtime-readiness.json') : null;
  const verdict = verifyRuntimeReadinessReceipt({
    root: runtimeRoot,
    binaryPath: qualifiedRuntime.binary,
    ...(receiptPath === null ? {} : { receiptPath }),
    artifacts: runtimeReadinessArtifacts(qualifiedRuntime, runtimeRoot),
  });
  if (!verdict.ok) {
    throw diagnosticError(
      verdict.diagnostic.code,
      `snapback dev refuses an unqualified runtime: ${verdict.diagnostic.message}`,
      {
        binary: qualifiedRuntime.binary,
        runtimeSource: qualifiedRuntime.source,
        reason: verdict.reason,
        receiptPath: verdict.receiptPath,
      },
    );
  }
  return Object.freeze({
    qualifiedBinary: Object.freeze({
      path: resolve(qualifiedRuntime.binary),
      source: qualifiedRuntime.source,
      platform: qualifiedRuntime.platform,
      bytes: verdict.receipt.binary.bytes,
      sha256: `sha256:${verdict.receipt.binary.sha256}`,
      buildIdentity: Object.freeze({ ...(qualifiedBuildIdentity.stamp ?? {}) }),
      qualification: Object.freeze({
        receiptSchemaVersion: verdict.receipt.schemaVersion,
        receiptPath: verdict.receiptPath,
        probe: verdict.receipt.qualification.probe,
      }),
    }),
    wrapper: Object.freeze({
      package: '@expo/snapback-cli',
      version: packageVersion(),
    }),
  });
}

function publishApplicationReadyReceipt(path, readyFile, readiness, lifecycle) {
  if (!sameStringSet(readiness.clientOrigins, lifecycle.clientOrigins)) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READINESS_INVALID',
      'the running server admission set differs from the lifecycle-declared client origins',
      {
        expectedClientOrigins: lifecycle.clientOrigins,
        observedClientOrigins: readiness.clientOrigins,
      },
    );
  }
  if (
    normalizedAdmissionPosture(readiness.admissionPosture)
      !== lifecycle.admissionPosture
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_READINESS_INVALID',
      'the running server admission posture differs from the lifecycle-owned posture',
      {
        expectedAdmissionPosture: lifecycle.admissionPosture,
        observedAdmissionPosture: readiness.admissionPosture ?? null,
      },
    );
  }
  const readyBytes = readFileSync(readyFile);
  const receipt = {
    formatVersion: 'snapback.application-ready.v1',
    admissionPosture: lifecycle.admissionPosture,
    startupNonce: readiness.startupNonce,
    hostReadyDescriptorDigest: sha256Bytes(readyBytes),
    application: {
      mode: 'dev-generated',
      deployment: readiness.target.deployment,
      obligationsDigest: readiness.target.obligationsDigest,
    },
    targetProfile: readiness.target.targetProfile,
    artifacts: readiness.artifacts,
    auth: {
      activeMode: readiness.auth.active,
      desiredMode: readiness.auth.desired,
      modeState: readiness.auth.modeState,
      appDataAvailability: readiness.auth.appDataAvailability,
      ...(readiness.auth.sessionActivationReady === undefined
        ? {}
        : { sessionActivationReady: readiness.auth.sessionActivationReady }),
    },
    binding: lifecycle.binding,
    clientOrigins: [...readiness.clientOrigins],
    runtimeIdentity: lifecycle.runtimeIdentity,
    capabilityManifestDigest: readiness.capabilityManifestDigest,
    networkProfile: readiness.networkProfile,
    settledAtMs: readiness.evaluatedAtMs,
  };
  return writeApplicationReadyReceipt(path, receipt);
}

function generatedApplicationDescriptor(generatedRoot) {
  const path = join(generatedRoot, 'app.descriptor.json');
  let descriptor;
  try {
    descriptor = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_DESCRIPTOR_INVALID',
      `could not read generated application descriptor ${path}`,
      { path },
    );
    error.cause = cause;
    throw error;
  }
  if (
    typeof descriptor?.identity?.app !== 'string'
    || typeof descriptor.identity.schema !== 'string'
    || typeof descriptor.identity.functions !== 'string'
    || typeof descriptor.identity.descriptor !== 'string'
    || !Array.isArray(descriptor?.capabilities?.required)
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_DESCRIPTOR_INVALID',
      'generated application descriptor lacks its closed identity or capability declaration',
      { path },
    );
  }
  return descriptor;
}

function generatedTargetCapabilityManifest(generatedRoot) {
  const path = join(generatedRoot, 'capability.manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_APPLICATION_DESCRIPTOR_INVALID',
      `could not read generated target capability manifest ${path}`,
      { path },
    );
    error.cause = cause;
    throw error;
  }
  if (
    manifest?.artifactKind !== 'capabilityManifest'
    || typeof manifest.targetProfileId !== 'string'
    || !Array.isArray(manifest.supportedCapabilities)
  ) {
    throw diagnosticError(
      'SNAPBACK_DEV_APPLICATION_DESCRIPTOR_INVALID',
      'generated target capability manifest lacks its closed target support facts',
      { path },
    );
  }
  return manifest;
}

function issueDevBinding(publisher, generatedRoot, descriptor) {
  return publisher.issue({
    descriptor: generatedApplicationDescriptor(generatedRoot),
    capabilityManifest: generatedTargetCapabilityManifest(generatedRoot),
    origin: new URL(descriptor.serverUrl).origin,
    routing: 'loopback',
  });
}

// @ref LLP 0030#backend-setup-ownership — every attach-shaped orchestrator
//   shares this read-only identity cut before the canonical generated load or
//   binding reissue; projections may require their own client origin without
//   reimplementing receipt/readiness predicates.
export async function verifyDevAttach({
  descriptor,
  readyFile,
  applicationReadyFile,
  adminToken,
  generatedRoot,
  clientOrigins = null,
  admissionPosture = null,
  requiredClientOrigins = [],
  runtimeIdentity = null,
  fixedPort = null,
  portPlan = null,
}) {
  const backendOwner = devPortPlanOwner(portPlan, 'backend');
  try {
    await validateReadyDescriptorHealth(descriptor);
  } catch (error) {
    if (fixedPort !== null) {
      throw await fixedPortAttachFailure(error, {
        fixedPort,
        readyFile,
        message: 'the pinned host descriptor does not identify a receipt-verifiable Snapback listener, but the port accepts connections',
      });
    }
    throw error;
  }
  let receipt;
  try {
    receipt = readApplicationReadyReceipt(applicationReadyFile);
  } catch (error) {
    if (fixedPort !== null) {
      throw await fixedPortAttachFailure(error, {
        fixedPort,
        readyFile,
        applicationReadyFile,
        message: 'the pinned Snapback origin accepts connections but has no verifiable application-ready owner receipt',
      });
    }
    throw error;
  }
  if (admissionPosture !== null) {
    assertDevAdmissionContractMatches(
      { admissionPosture, clientOrigins },
      receipt,
    );
  }
  const readiness = await readOperationalReadiness(descriptor, adminToken);
  verifyApplicationReadyReceiptAgainstReadiness(receipt, readiness);
  const generatedDescriptor = generatedApplicationDescriptor(generatedRoot);
  const hostReadyDescriptorDigest = sha256Bytes(readFileSync(readyFile));
  const expectedOrigin = new URL(descriptor.serverUrl).origin;
  const expiresAt = Date.parse(receipt.binding?.provenance?.expiresAt);
  const mismatch = [];
  if (receipt.startupNonce !== descriptor.startupNonce) mismatch.push('startupNonce');
  if (receipt.hostReadyDescriptorDigest !== hostReadyDescriptorDigest) {
    mismatch.push('hostReadyDescriptorDigest');
  }
  if (receipt.binding?.target?.origin !== expectedOrigin) mismatch.push('binding.target.origin');
  if (
    receipt.binding?.descriptorIdentity !== generatedDescriptor.identity.descriptor
  ) mismatch.push('binding.descriptorIdentity');
  if (receipt.binding?.target?.app !== generatedDescriptor.identity.app) mismatch.push('binding.target.app');
  if (receipt.binding?.target?.schema !== generatedDescriptor.identity.schema) {
    mismatch.push('binding.target.schema');
  }
  if (receipt.binding?.target?.functions !== generatedDescriptor.identity.functions) {
    mismatch.push('binding.target.functions');
  }
  if (receipt.binding?.target?.routing !== 'loopback') mismatch.push('binding.target.routing');
  // Expiry says the matching owner must reissue before returning a usable
  // binding; it is not evidence that the live child is foreign. runDev always
  // republishes a fresh lifecycle-issued binding after this identity cut.
  if (!Number.isFinite(expiresAt)) mismatch.push('binding.provenance.expiresAt');
  if (
    admissionPosture === null
    && clientOrigins !== null
    && !sameStringSet(receipt.clientOrigins, clientOrigins)
  ) {
    mismatch.push('clientOrigins');
  }
  for (const requiredOrigin of requiredClientOrigins) {
    if (!receipt.clientOrigins.includes(requiredOrigin)) mismatch.push(`clientOrigins.${requiredOrigin}`);
  }
  if (
    runtimeIdentity !== null
    && canonicalJson(receipt.runtimeIdentity) !== canonicalJson(runtimeIdentity)
  ) {
    mismatch.push('runtimeIdentity');
  }
  if (!(generatedDescriptor.capabilities?.required ?? []).every(
    (capability) => receipt.binding.capabilities.offered.includes(capability),
  )) mismatch.push('binding.capabilities.offered');
  if (fixedPort !== null && portFromUrl(descriptor.serverUrl) !== fixedPort) {
    mismatch.push('serverPort');
  }
  if (mismatch.length > 0) {
    throw diagnosticError(
      fixedPort === null
        ? 'SNAPBACK_DEV_SERVER_BINDING_MISMATCH'
        : 'SNAPBACK_DEV_FIXED_BINDING_MISMATCH',
      'the existing listener is not the receipt-bound development target requested by this lifecycle',
      {
        mismatch,
        expectedOrigin,
        observedOrigin: receipt.binding?.target?.origin ?? null,
        expectedClientOrigins: clientOrigins,
        requiredClientOrigins,
        observedClientOrigins: receipt.clientOrigins ?? null,
        supportedProfile: 'snapback dev --port <backend-port> --external-client-origin <client-origin>',
        safety: 'the listener was not adopted or terminated',
      },
    );
  }
  // @ref LLP 0299#7-the-plan-is-recorded-not-just-applied — adoption records
  // attached provenance but cannot widen a flag/environment range.
  if (
    backendOwner?.source === 'range'
    && portPlan.range.source !== 'default'
  ) {
    const attachedPort = portFromUrl(descriptor.serverUrl);
    if (attachedPort < portPlan.range.lo || attachedPort > portPlan.range.hi) {
      throw diagnosticError(
        'SNAPBACK_DEV_ATTACH_PORT_OUT_OF_RANGE',
        `the receipt-verified backend at port ${attachedPort} is outside the declared range ${portPlan.range.lo}-${portPlan.range.hi}`,
        {
          port: attachedPort,
          range: { lo: portPlan.range.lo, hi: portPlan.range.hi },
          readyFile,
        },
      );
    }
  }
  return receipt;
}

// Resolve the client arm named by `snapback dev --client` / `--client-command`.
// The CLI stays surface-agnostic: it runs the surface's own dev command in the
// surface directory and never embeds frontend dev-server logic — the SC-2a
// plugin inside that command attaches to the CLI-managed server through the
// shared ready file (LLP 0041's boundary with LLP 0030).
//
// @ref LLP 0079#sc-2b-wire-the-client-arm-into-the-dev-loop-watch-process-from-llp-0078-r1-a3 —
//   the client arm is one spawned command in the same watch process; default
//   discovery is the surface package.json `dev` script under the repo runner.
function resolveClientArm(client, projectRoot) {
  if (client === undefined || client === null || client === false) return null;
  const spec = typeof client === 'string' ? { directory: client } : client;
  const directory = resolve(projectRoot, spec.directory ?? '.');
  if (typeof spec.command === 'string' && spec.command.trim()) {
    return { directory, command: spec.command };
  }
  const manifestPath = join(directory, 'package.json');
  let manifest = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = null;
    }
  }
  if (typeof manifest?.scripts?.dev !== 'string') {
    throw diagnosticError(
      'SNAPBACK_DEV_CLIENT_COMMAND_MISSING',
      `no client dev command: ${directory} has no package.json "dev" script; pass --client-command`,
      { directory, manifestPath },
    );
  }
  return { directory, command: 'bun run dev' };
}

// @ref LLP 0181#web-browser — only the Expo supervisor installs the
// credential-free bootstrap rendezvous in Metro's environment. The generic
// client arm remains surface-agnostic, but a direct `expo start` spelling is
// high-confidence enough to warn before the child starts.
export function genericClientCommandAdvisory(command) {
  if (typeof command !== 'string') return null;
  const expoStart = /^(?:(?:npx(?:\s+--(?:no-install|yes))?|bunx|yarn|pnpm(?:\s+exec)?|npm\s+exec(?:\s+--)?)\s+)?expo(?:\.cmd)?\s+start(?:\s|$)/u;
  if (!expoStart.test(command.trim())) return null;
  return Object.freeze({
    code: 'SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED',
    severity: 'warning',
    subsystem: 'cli',
    message: 'expo start is running through the generic client arm; no supervised Expo bootstrap origin was installed',
    details: Object.freeze({
      command,
      genericArm: '--client-command',
      supervisedAlternative: 'snapback dev snapback --expo --expo-platform web',
    }),
  });
}

export async function runDev(options = {}) {
  const spawnRuntime = options.spawnManagedRuntime ?? spawnManagedRuntime;
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const stateRoot = join(projectRoot, '.snapback');
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = resolve(options.readyFile ?? join(stateRoot, 'dev.ready.json'));
  const applicationReadyFile = resolve(
    options.applicationReadyFile ?? `${readyFile}.application-ready`,
  );
  const requestedPortPlan = options.portPlan ?? resolveDevPortPlan({
    profile: options.client ? 'client-command' : 'plain',
    flags: {
      port: options.port,
      portRange: options.portRange,
    },
    env: options.env ?? process.env,
  });
  const requestedBackendOwner = devPortPlanOwner(requestedPortPlan, 'backend');
  if (requestedBackendOwner === null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'the dev port plan must include the backend owner',
    );
  }
  const fixedPort = requestedBackendOwner.source === 'pinned'
    ? normalizeDevPort(requestedBackendOwner.port)
    : null;
  const selectedPortRange = fixedPort === null && requestedPortPlan.range.source !== 'default'
    ? `${requestedPortPlan.range.lo}-${requestedPortPlan.range.hi}`
    : null;
  const runtimePortArguments = () => fixedPort === null
    ? selectedPortRange === null ? [] : ['--port-range', selectedPortRange]
    : ['--port', String(fixedPort)];
  const backendPlanTemplate = Object.freeze({
    range: requestedPortPlan.range,
    owners: Object.freeze([requestedBackendOwner]),
  });
  let backendPortPlan = materializeDevPortPlan(backendPlanTemplate);
  const refreshBackendPortPlan = (currentDescriptor, provenance = null) => {
    const backendPort = portFromUrl(currentDescriptor.serverUrl);
    backendPortPlan = materializeDevPortPlan(
      backendPlanTemplate,
      { backend: backendPort },
      provenance === null ? {} : { backend: provenance },
    );
    return backendPortPlan;
  };
  const externalClientOrigins = normalizeExternalClientOrigins(options, fixedPort);
  const declaredClientOrigins = [...new Set([
    ...externalClientOrigins,
    ...normalizeSupervisedClientOrigins(options),
  ])].sort();
  let clientOrigins = declaredClientOrigins;
  let admissionPosture = null;
  const writeEnvFile = options.writeEnvFile === undefined || options.writeEnvFile === null
    ? null
    : resolve(projectRoot, options.writeEnvFile);
  let environmentFile = null;
  const refreshDevEnvironmentFile = (currentDescriptor) => {
    if (writeEnvFile === null) return null;
    environmentFile = writeDevEnvironmentFile(writeEnvFile, {
      ...devBackendUrls(currentDescriptor.serverUrl),
      projectRoot,
      beforeRename: options.beforeEnvRename ?? null,
    });
    return environmentFile;
  };
  // @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — receipt
  // lifecycle removes the projection before every launch, reload, restart,
  // reset, and shutdown; absence is the honest intermediate state.
  const removeApplicationReadyReceipt = () => {
    rmSync(applicationReadyFile, { force: true });
  };
  const database = resolve(options.database ?? join(stateRoot, 'dev.sqlite3'));
  const databaseExistedBeforeStart = existsSync(database);
  const runtime = resolveRuntimeBinary(options);
  const runtimeIdentity = inspectRuntimeBinary(runtime.binary, options.env);
  const applicationRuntimeIdentity = qualifiedRuntimeIdentity(
    runtime,
    runtimeIdentity,
    options.qualifiedRuntimeBinary ?? null,
    options.env,
  );
  const runtimeRecovery = installedRuntimeRecovery(runtime, {
    runnable: runtimeIdentity.runnable,
    actualStamp: runtimeIdentity.stamp,
    diagnostic: {
      code: runtimeIdentity.runnable
        ? 'SNAPBACK_RUNTIME_LAUNCH_OK'
        : 'SNAPBACK_RUNTIME_IDENTITY_UNAVAILABLE',
    },
    reason: runtimeIdentity.runnable
      ? 'selected dev runtime launched and reported its independent build stamp'
      : runtimeIdentity.reason,
  });
  const clientArm = resolveClientArm(options.client, projectRoot);
  if (externalClientOrigins.length > 0 && clientArm !== null) {
    throw diagnosticError(
      'SNAPBACK_CLI_ARGUMENT_INVALID',
      'the declared external client is owned outside snapback dev and cannot be combined with --client or --client-command',
      {
        clientOrigins: externalClientOrigins,
        supportedProfile: 'snapback dev --port <backend-port> --external-client-origin <client-origin>',
      },
    );
  }
  const generated = await generateApp(backendRoot, { appBindingMode: 'development' });
  if (!generated.ok) return { ...generated, state: 'generation-failed' };
  let devRuntimeEnvironment;
  const prepareVisibilityGovernanceDevEnvironment =
    options.visibilityGovernanceDevEnvironment ?? visibilityGovernanceDevEnvironment;
  const refreshVisibilityGovernanceDevEnvironment = () => {
    const configuredEnvironment = options.env ?? process.env;
    const prepared = prepareVisibilityGovernanceDevEnvironment({
      environment: configuredEnvironment,
      callerEnvironment: options.env === process.env ? {} : (options.env ?? {}),
      backendRoot,
      outputPath: join(stateRoot, 'visibility-governance-dev-target-config.json'),
    });
    const admission = withExternalClientOrigins(prepared.environment, declaredClientOrigins);
    devRuntimeEnvironment = admission.environment;
    clientOrigins = admission.clientOrigins;
    admissionPosture = admission.admissionPosture;
    return prepared;
  };
  try {
    refreshVisibilityGovernanceDevEnvironment();
  } catch (error) {
    const result = {
      schemaVersion: 'snapback.dev.v1',
      ok: false,
      state: 'generated-but-not-loaded',
      runtime,
      runtimeRecovery,
      diagnostics: [{
        code: error.code ?? 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED',
        severity: 'error',
        subsystem: 'auth',
        message: error.message ?? 'visibility governance development config mint refused',
        details: error.details ?? {},
      }],
    };
    options.onEvent?.(result);
    return result;
  }
  const generatedRoot = join(backendRoot, 'generated');
  const bindingPublisher = createSupervisedBindingPublisher({
    generation: `snapback-dev:${randomUUID()}`,
    onEvent(event) {
      options.onEvent?.({
        schemaVersion: 'snapback.dev.v1',
        ok: event.ok !== false,
        state: event.state,
        binding: event,
      });
    },
  });
  const generatedSchemaPath = resolveGeneratedArtifact(
    generatedRoot,
    'schema.manifest.json',
  );
  const generatedFunctionsPath = resolveGeneratedArtifact(
    generatedRoot,
    'functions.manifest.json',
  );
  const generatedAuthMode = JSON.parse(
    readFileSync(generatedSchemaPath, 'utf8'),
  )?.auth?.mode ?? 'dev';
  const forcedStartupArtifacts = options.bootstrapGeneratedAtStart === true;
  let startupArtifacts = forcedStartupArtifacts || generatedAuthMode === 'sessions'
    ? join(dirname(readyFile), 'startup-artifacts.json')
    : null;
  let startupArtifactSources = [generatedSchemaPath, generatedFunctionsPath];
  const refreshStartupArtifacts = () => {
    const currentSchemaPath = resolveGeneratedArtifact(
      generatedRoot,
      'schema.manifest.json',
    );
    const currentFunctionsPath = resolveGeneratedArtifact(
      generatedRoot,
      'functions.manifest.json',
    );
    startupArtifactSources = [currentSchemaPath, currentFunctionsPath];
    const currentAuthMode = JSON.parse(
      readFileSync(currentSchemaPath, 'utf8'),
    )?.auth?.mode ?? 'dev';
    if (!forcedStartupArtifacts && currentAuthMode !== 'sessions') {
      startupArtifacts = null;
      return;
    }
    startupArtifacts = join(dirname(readyFile), 'startup-artifacts.json');
    writeFileSync(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema: JSON.parse(readFileSync(currentSchemaPath, 'utf8')),
      functions: JSON.parse(readFileSync(currentFunctionsPath, 'utf8')),
    })}\n`, { mode: 0o600 });
  };
  // @ref LLP 0058#cold-startup-artifact-carrier — an ordinary dev command
  // infers sessions mode from the generated schema and establishes that
  // deployment before listener bind. Callers do not need a hidden comparator
  // option to avoid the dev-only raw host-load path.
  let managed = false;
  let child = null;
  let descriptor;
  let initialStartupSuccessor = null;
  if (existsSync(readyFile)) {
    descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
    const attachAdminToken = managedAdminToken(descriptor, database);
    await verifyDevAttach({
      descriptor,
      readyFile,
      applicationReadyFile,
      adminToken: attachAdminToken,
      generatedRoot,
      clientOrigins,
      admissionPosture,
      runtimeIdentity: applicationRuntimeIdentity,
      fixedPort,
      portPlan: requestedPortPlan,
    });
  } else {
    if (options.attach === true) {
      throw diagnosticError('SNAPBACK_DEV_READY_FILE_REQUIRED', `--attach requires ${readyFile}`, { readyFile });
    }
    if (
      fixedPort !== null
      && (await probeLoopbackPortConnection(fixedPort)).state === 'accepting'
    ) {
      throw diagnosticError(
        'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER',
        `port ${fixedPort} is already occupied without the requested receipt-bound Snapback lifecycle`,
        {
          port: fixedPort,
          clientOrigins,
          supportedProfile: 'snapback dev --port <backend-port> --external-client-origin <client-origin>',
          safety: 'the listener was not adopted or terminated',
        },
      );
    }
    if (fixedPort === null) {
      // @ref LLP 0299#4-ranges — the lifecycle owner reports backend
      // exhaustion under the same typed refusal as supervisor allocation.
      // The native child captures bounded stderr, so its own uncoded
      // "no available Snapback port on" refusal is translated below as a
      // post-scan defense. This pre-scan supplies the typed lifecycle refusal
      // before spawn in the ordinary exhaustion case; supervisor-held ports
      // are deliberately skipped because this plan already owns them.
      await assertBackendRangeAvailable(requestedPortPlan);
    }
    removeApplicationReadyReceipt();
    refreshStartupArtifacts();
    child = spawnRuntime(runtime.binary, [
      'start',
      '--ready-file', readyFile,
      '--db', database,
      ...runtimePortArguments(),
      ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
    ], {
      cwd: projectRoot,
      env: managedDevRuntimeEnvironment(devRuntimeEnvironment),
      stdio: options.serverStdio ?? ['ignore', 2, 2],
    });
    managed = true;
    try {
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
    } catch (error) {
      await stopProcessGroup(child);
      const rangeExhaustion = await translateBackendRangeExhaustion(
        error,
        requestedPortPlan,
      );
      if (rangeExhaustion !== null) throw rangeExhaustion;
      const startupPin = authStartupPinRefusal(error);
      if (startupPin?.details?.observedDeployment) {
        if (existsSync(readyFile)) rmSync(readyFile, { force: true });
        child = spawnRuntime(runtime.binary, [
          'start',
          '--ready-file', readyFile,
          '--db', database,
          ...runtimePortArguments(),
          ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
          '--activate-startup-successor',
        ], {
          cwd: projectRoot,
          env: managedDevRuntimeEnvironment(devRuntimeEnvironment),
          stdio: options.serverStdio ?? ['ignore', 2, 2],
        });
        try {
          descriptor = validateDevTarget(
            await waitForReady(readyFile, child),
            { readyFile, database },
          );
          initialStartupSuccessor = {
            database,
            fromDeployment: startupPin.details.expectedDeployment,
            toDeployment: startupPin.details.observedDeployment,
          };
        } catch (activationError) {
          await stopProcessGroup(child);
          const rangeExhaustion = await translateBackendRangeExhaustion(
            activationError,
            requestedPortPlan,
          );
          if (rangeExhaustion !== null) throw rangeExhaustion;
          const refinedActivation = refineGeneratedArtifactFailure(activationError, {
            binary: runtime.binary,
            runtime,
            runtimeIdentity,
            database,
            artifacts: startupArtifacts
              ? [startupArtifacts, ...startupArtifactSources]
              : startupArtifactSources,
          });
          throw diagnosticError(
            'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH',
            'the sessions startup pair differs from the pinned deployment and automatic successor activation did not complete; startup remains refused',
            {
              expectedDeployment: startupPin.details.expectedDeployment,
              observedDeployment: startupPin.details.observedDeployment,
              activationFailure: refinedActivation.diagnostic ?? {
                code: refinedActivation.code ?? 'SNAPBACK_DEV_SERVER_START_FAILED',
                message: refinedActivation.message,
              },
              safety: 'the existing database was not discarded; inspect the activation failure and retry with a complete valid successor',
            },
          );
        }
      } else {
        throw refineGeneratedArtifactFailure(error, {
          binary: runtime.binary,
          runtime,
          runtimeIdentity,
          database,
          artifacts: startupArtifacts
            ? [startupArtifacts, ...startupArtifactSources]
            : startupArtifactSources,
        });
      }
    }
  }
  refreshBackendPortPlan(
    descriptor,
    managed ? null : { source: 'attached', declaredBy: null },
  );
  const closeManaged = async () => {
    try {
      if (managed && child?.exitCode === null) {
        native(runtime.binary, ['stop', '--ready-file', readyFile], {
          cwd: projectRoot,
          env: options.env,
        });
        await stopProcessGroup(child);
      }
    } finally {
      if (managed) removeApplicationReadyReceipt();
      bindingPublisher.close();
    }
  };
  let adminToken;
  let devIdentityCapability;
  try {
    adminToken = managedAdminToken(descriptor, database);
    // @ref LLP 0262#d2-carriers-per-shipped-topology — a sessions-first
    //   managed loop may still exercise a dev-identity assertion, so its
    //   supervised client arm receives relay custody in every local auth mode.
    devIdentityCapability = resolveDevIdentityCapabilityForCli(
      descriptor,
      { readyFile, database },
    );
    // `/inspect` becomes the bounded administrative projection when an admin
    // credential is attached, and therefore correctly requires a separately
    // minted secret-read lease. Dev attachment needs only liveness and process
    // identity, so use the public health projection and never upgrade this
    // check into administrative data-read authority.
    await validateReadyDescriptorHealth(descriptor);
    removeApplicationReadyReceipt();
    const activation = await loadGenerated(
      runtime.binary,
      projectRoot,
      backendRoot,
      readyFile,
      adminToken,
      {
        seed: managed && !databaseExistedBeforeStart,
        database,
        skipSchemaFunctions: managed && startupArtifacts !== null,
        runtime,
        runtimeIdentity,
        env: devRuntimeEnvironment,
      },
    );
    const expectedTarget = expectedActivationTargetFromActivation(
      activation,
      generated.targetProfile,
    );
    const readiness = await evaluateApplicationReadiness(
      descriptor,
      adminToken,
      expectedTarget,
    );
    // @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — the receipt is a projection of the server-owned OperationalReadinessV1, bound to the returned nonce and digests; runDev never manufactures readiness from its own promise completions.
    publishApplicationReadyReceipt(applicationReadyFile, readyFile, readiness, {
      binding: issueDevBinding(bindingPublisher, generatedRoot, descriptor),
      clientOrigins,
      admissionPosture,
      runtimeIdentity: applicationRuntimeIdentity,
    });
    refreshDevEnvironmentFile(descriptor);
  } catch (error) {
    await closeManaged();
    throw error;
  }

  const result = {
    schemaVersion: 'snapback.dev.v1',
    ok: true,
    state: 'generated-and-loaded',
    managed,
    readyFile,
    applicationReadyFile,
    serverUrl: descriptor.serverUrl,
    ...devBackendUrls(descriptor.serverUrl),
    lifecycleProfile: fixedPort === null ? 'selected-port' : 'fixed-port',
    get portPlan() { return backendPortPlan; },
    admissionPosture,
    clientOrigins,
    environmentFile,
    runtime,
    runtimeRecovery,
  };
  if (initialStartupSuccessor) {
    options.onEvent?.({
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'startup-successor-activated',
      verb: 'start',
      ...initialStartupSuccessor,
    });
  }
  options.onEvent?.(result);
  if (options.watch === false) {
    return { ...result, child, close: closeManaged };
  }

  let timer = null;
  let closed = false;
  let restarting = false;
  let queuedFilename = null;
  let lastLoad = { state: result.state, changed: null, ok: true };
  const emitDevEvent = (event) => {
    if (event.state === 'generated-and-loaded' || event.state === 'generated-but-not-loaded' || event.state === 'generation-failed') {
      lastLoad = { state: event.state, changed: event.changed ?? null, ok: event.ok === true };
    }
    options.onEvent?.(event);
    return event;
  };

  const regenerateAndLoad = async (
    filename,
    extra = {},
    { seed = false, failureState = null } = {},
  ) => {
    let predecessorReceipt = null;
    if (existsSync(applicationReadyFile)) {
      try {
        predecessorReceipt = readApplicationReadyReceipt(applicationReadyFile);
      } catch {
        // Removal-before-work remains fail-closed; an invalid predecessor can
        // never authorize a lineage claim for the successor.
      }
    }
    removeApplicationReadyReceipt();
    let next;
    try {
      next = await generateApp(backendRoot, { appBindingMode: 'development' });
    } catch (error) {
      const refined = refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        database,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: failureState ?? 'generation-failed',
        changed: filename,
        ...extra,
        diagnostics: [refined.diagnostic ?? {
          code: refined.code ?? 'SNAPBACK_DEV_GENERATION_FAILED',
          severity: 'error',
          subsystem: 'codegen',
          message: refined.message,
        }],
      });
    }
    if (!next.ok) {
      return emitDevEvent({
        ...next,
        schemaVersion: 'snapback.dev.v1',
        state: failureState ?? 'generation-failed',
        changed: filename,
        ...extra,
      });
    }
    if (closed) return null;
    try {
      // @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — regenerate rewrites the complete startup carrier before hot-load; authors and external clients never own this bookkeeping.
      refreshStartupArtifacts();
      refreshVisibilityGovernanceDevEnvironment();
      const activation = await loadGenerated(
        runtime.binary,
        projectRoot,
        backendRoot,
        readyFile,
        adminToken,
        {
          seed,
          database,
          runtime,
          runtimeIdentity,
          env: devRuntimeEnvironment,
        },
      );
      const expectedTarget = expectedActivationTargetFromActivation(
        activation,
        next.targetProfile,
      );
      const readiness = await evaluateApplicationReadiness(
        descriptor,
        adminToken,
        expectedTarget,
      );
      publishApplicationReadyReceipt(applicationReadyFile, readyFile, readiness, {
        binding: issueDevBinding(bindingPublisher, generatedRoot, descriptor),
        clientOrigins,
        admissionPosture,
        runtimeIdentity: applicationRuntimeIdentity,
      });
      refreshDevEnvironmentFile(descriptor);
      const fromDeployment = predecessorReceipt?.application?.deployment ?? null;
      const toDeployment = readiness.target.deployment;
      if (
        generatedAuthMode === 'sessions'
        && fromDeployment !== null
        && canonicalJson(fromDeployment) !== canonicalJson(toDeployment)
      ) {
        emitDevEvent({
          schemaVersion: 'snapback.dev.v1',
          ok: true,
          state: 'startup-successor-activated',
          verb: extra.verb ?? 'regenerate',
          changed: filename,
          ...extra,
          database,
          fromDeployment,
          toDeployment,
          continuity: {
            database: 'preserved',
            accounts: 'preserved',
            sessions: 'preserved',
            stores: 'preserved',
          },
        });
      }
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'generated-and-loaded',
        changed: filename,
        applicationReadyFile,
        ...devBackendUrls(descriptor.serverUrl),
        admissionPosture,
        environmentFile,
        ...extra,
      });
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: failureState === null,
        state: failureState ?? 'generated-but-not-loaded',
        changed: filename,
        ...extra,
        diagnostics: [error.diagnostic ?? {
          code: error.code ?? 'SNAPBACK_DEV_SERVER_LOAD_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: error.message ?? 'generated artifacts could not be loaded',
        }],
      });
    }
  };

  const forceRegenerateAndLoad = async (...args) => {
    const forcedResult = await regenerateAndLoad(...args);
    // @ref LLP 0041#watch-mode — a forced pass supersedes debounce state that
    // was queued before it settled: that disk state was just regenerated and
    // loaded. Clear the filename as well as the timer because the timer may
    // already have stacked a drain on workChain. This runs synchronously before
    // the forced task releases the chain, so a later watch event schedules a
    // fresh timer and filename after this retirement point.
    clearTimeout(timer);
    timer = null;
    queuedFilename = null;
    return forcedResult;
  };

  // One dev operation at a time: watcher passes, forced reloads, and backend
  // restarts serialize on the same chain, so a verb never races a hot-push.
  let workChain = Promise.resolve();
  const withDevLock = (task) => {
    const run = workChain.then(task, task);
    workChain = run.then(() => undefined, () => undefined);
    return run;
  };
  const drainGenerationQueue = () => withDevLock(async () => {
    while (!closed && queuedFilename !== null) {
      const filename = queuedFilename;
      queuedFilename = null;
      await regenerateAndLoad(filename);
    }
  });
  const isGeneratedWatchPath = (filename) => (
    typeof filename === 'string'
    && (filename.startsWith('generated') || filename.startsWith('.generated'))
  );
  const watcher = watch(backendRoot, { recursive: true }, (_event, filename) => {
    // Ignore codegen's own outputs: the committed `generated/` tree and the
    // `.generated.tmp-*` staging directories it renames into place —
    // otherwise every regeneration retriggers the watcher forever.
    if (closed || !filename || isGeneratedWatchPath(filename)) return;
    queuedFilename = filename;
    clearTimeout(timer);
    timer = setTimeout(() => void drainGenerationQueue(), 100);
  });
  watcher.on('error', (error) => {
    const filename = typeof error?.path === 'string' ? relative(backendRoot, error.path) : null;
    // @ref LLP 0041#watch-mode — codegen replaces `generated/` atomically.
    // Node's Linux recursive watcher can race the removal of the staging
    // directory while adding its internal subwatch; that expected ENOENT must
    // not kill the dev loop or prevent recovery from an authoring error.
    if (error?.code === 'ENOENT' && isGeneratedWatchPath(filename)) return;
    emitDevEvent({
      schemaVersion: 'snapback.dev.v1',
      ok: false,
      state: 'watch-failed',
      diagnostics: [{
        code: 'SNAPBACK_DEV_WATCH_FAILED',
        severity: 'error',
        subsystem: 'dev-loop',
        message: error?.message ?? 'backend watcher failed',
        ...(filename ? { path: filename } : {}),
      }],
    });
  });

  const attachExitWatch = (proc) => {
    proc?.once('exit', (code, signal) => {
      if (closed || restarting || proc !== child) return;
      removeApplicationReadyReceipt();
      emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: false, state: 'server-exited', code, signal });
      options.onServerExit?.(code, signal);
    });
  };
  attachExitWatch(child);

  // The client arm: one spawned surface dev command, streamed as events so
  // the machine-readable stdout stays one JSON-line stream.
  let clientProcess = null;
  const startClientArm = () => {
    const advisory = genericClientCommandAdvisory(clientArm.command);
    if (advisory !== null) {
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'client-advisory',
        code: advisory.code,
        diagnostics: [advisory],
      });
    }
    const spawned = spawnLeasedProcess(['/bin/sh', '-c', clientArm.command], {
      cwd: clientArm.directory,
      // Own process group: the shell-spawned tree (runner, Vite, esbuild)
      // tears down as one unit on close.
      env: devIdentityClientEnvironment(
        options.env ?? process.env,
        descriptor,
        devIdentityCapability,
      ),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    clientProcess = {
      child: spawned,
      pid: spawned.pid ?? null,
      command: clientArm.command,
      directory: clientArm.directory,
      exitCode: null,
      signal: null,
    };
    const forward = (stream, name) => {
      let buffer = '';
      stream.setEncoding('utf8');
      const emitLines = (flush) => {
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.length > 0 && !closed) {
            emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'client-output', stream: name, line });
          }
        }
        if (flush && buffer.length > 0 && !closed) {
          emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'client-output', stream: name, line: buffer });
          buffer = '';
        }
      };
      stream.on('data', (chunk) => {
        buffer += chunk;
        emitLines(false);
      });
      stream.on('close', () => emitLines(true));
    };
    forward(spawned.stdout, 'stdout');
    forward(spawned.stderr, 'stderr');
    spawned.once('exit', (code, signal) => {
      clientProcess.exitCode = code;
      clientProcess.signal = signal;
      if (!closed) {
        emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: code === 0, state: 'client-exited', code, signal });
      }
    });
    spawned.once('error', (error) => {
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'client-exited',
        code: null,
        signal: null,
        diagnostics: [{
          code: 'SNAPBACK_DEV_CLIENT_SPAWN_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: `client dev command failed to spawn: ${error.message}`,
          details: { command: clientArm.command, directory: clientArm.directory },
        }],
      });
    });
    emitDevEvent({
      schemaVersion: 'snapback.dev.v1',
      ok: true,
      state: 'client-started',
      pid: clientProcess.pid,
      command: clientArm.command,
      directory: clientArm.directory,
    });
  };
  const closeClientArm = async () => {
    if (!clientProcess || clientProcess.exitCode !== null || clientProcess.signal !== null) return;
    const { child: proc } = clientProcess;
    await stopProcessGroup(proc, { processGroup: true });
  };
  // The client spawns only after the managed server is up and the first
  // generate+load completed, so its plugin's `auto` mode attaches to the
  // CLI-managed server through the ready file instead of racing to spawn one.
  if (clientArm) startClientArm();

  const clientStatus = () => {
    if (clientArm === null && clientProcess === null) return null;
    if (clientProcess === null) return { running: false, pid: null, exitCode: null, signal: null };
    return {
      running: clientProcess.exitCode === null && clientProcess.signal === null,
      pid: clientProcess.pid,
      exitCode: clientProcess.exitCode,
      signal: clientProcess.signal,
      command: clientProcess.command,
      directory: clientProcess.directory,
    };
  };

  // The dev-loop verb slice: status / reload / restart / dev-fresh, each usable from the
  // interactive keybindings and the machine-readable stdin command channel,
  // and available with or without a client arm. Every verb resolves to the
  // event it emitted; none of them throws.
  const statusVerb = ({ requestId } = {}) => Promise.resolve(emitDevEvent({
    schemaVersion: 'snapback.dev.v1',
    ok: true,
    state: 'status',
    verb: 'status',
    ...(requestId === undefined ? {} : { requestId }),
    server: {
      managed,
      pid: descriptor.pid ?? null,
      serverUrl: descriptor.serverUrl,
      readyFile,
      database,
      running: child ? child.exitCode === null : null,
    },
    lastLoad,
    client: clientStatus(),
  }));
  const reloadVerb = ({ requestId } = {}) => withDevLock(
    () => forceRegenerateAndLoad('(reload)', {
      verb: 'reload',
      ...(requestId === undefined ? {} : { requestId }),
    }),
  );
  // Restart stops the managed server (nonce-verified native stop) and starts
  // it again against the same ready file and database, then re-runs the
  // generate+load pass. The client arm keeps running: its relay re-resolves
  // the backend target from the rewritten ready file, so restart never
  // requires restarting the client process.
  const restartVerb = ({ requestId } = {}) => withDevLock(async () => {
    const tag = requestId === undefined ? {} : { requestId };
    if (closed) return null;
    removeApplicationReadyReceipt();
    if (!managed || child === null) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'restart-failed',
        verb: 'restart',
        ...tag,
        diagnostics: [{
          code: 'SNAPBACK_DEV_RESTART_UNMANAGED',
          severity: 'error',
          subsystem: 'cli',
          message: 'dev attached to an externally started server; restart only manages the child this process spawned',
          details: { readyFile },
        }],
      });
    }
    restarting = true;
    let startupPin = null;
    try {
      const previousPid = descriptor.pid ?? null;
      if (child.exitCode === null && child.signalCode === null) {
        native(runtime.binary, ['stop', '--ready-file', readyFile], {
          cwd: projectRoot,
          env: options.env,
        });
        await stopProcessGroup(child);
      }
      if (existsSync(readyFile)) rmSync(readyFile, { force: true });
      removeApplicationReadyReceipt();
      refreshStartupArtifacts();
      refreshVisibilityGovernanceDevEnvironment();
      const startManagedChild = (activateSuccessor = false) => spawnManagedRuntime(runtime.binary, [
        'start',
        '--ready-file', readyFile,
        '--db', database,
        ...runtimePortArguments(),
        ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
        ...(activateSuccessor ? ['--activate-startup-successor'] : []),
      ], {
        cwd: projectRoot,
        env: managedDevRuntimeEnvironment(devRuntimeEnvironment),
        stdio: options.serverStdio ?? ['ignore', 2, 2],
      });
      child = startManagedChild();
      attachExitWatch(child);
      try {
        descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
      } catch (error) {
        startupPin = authStartupPinRefusal(error);
        if (!startupPin?.details?.observedDeployment) throw error;

        // @ref LLP 0058#same-mode-provisioning — only a structured refusal
        // proving that native complete-pair preflight reached the identity pin
        // authorizes the managed loop's explicit successor retry. The native
        // retry repeats preflight and owns the guarded durable activation.
        await stopProcessGroup(child);
        if (existsSync(readyFile)) rmSync(readyFile, { force: true });
        child = startManagedChild(true);
        attachExitWatch(child);
        descriptor = validateDevTarget(
          await waitForReady(readyFile, child),
          { readyFile, database },
        );
      }
      refreshBackendPortPlan(descriptor);
      adminToken = managedAdminToken(descriptor, database);
      devIdentityCapability = resolveDevIdentityCapabilityForCli(
        descriptor,
        { readyFile, database },
      );
      if (startupPin) {
        emitDevEvent({
          schemaVersion: 'snapback.dev.v1',
          ok: true,
          state: 'startup-successor-activated',
          verb: 'restart',
          ...tag,
          database,
          fromDeployment: startupPin.details.expectedDeployment,
          toDeployment: startupPin.details.observedDeployment,
        });
      }
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'server-restarted',
        verb: 'restart',
        ...tag,
        previousPid,
        pid: descriptor.pid ?? null,
        serverUrl: descriptor.serverUrl,
      });
      return await forceRegenerateAndLoad('(restart)', { ...tag });
    } catch (error) {
      let refined = refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        database,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
      if (startupPin) {
        const activationFailure = refined.diagnostic ?? {
          code: refined.code ?? 'SNAPBACK_DEV_SERVER_START_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: refined.message ?? 'the startup successor could not be activated',
        };
        refined = diagnosticError(
          'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH',
          'the sessions startup pair differs from the pinned deployment and automatic successor activation did not complete; startup remains refused',
          {
            expectedDeployment: startupPin.details.expectedDeployment,
            observedDeployment: startupPin.details.observedDeployment,
            activationFailure,
            safety: 'the existing database was not discarded; inspect the activation failure and retry with a complete valid successor',
          },
        );
      }
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'restart-failed',
        verb: 'restart',
        ...tag,
        diagnostics: [refined.diagnostic ?? {
          code: refined.code ?? 'SNAPBACK_DEV_RESTART_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: refined.message,
        }],
      });
    } finally {
      restarting = false;
    }
  });

  const devFreshVerb = ({ requestId } = {}) => withDevLock(async () => {
    const tag = requestId === undefined ? {} : { requestId };
    if (closed) return null;
    if (!managed || child === null) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'dev-fresh-failed',
        verb: 'dev-fresh',
        ...tag,
        diagnostics: [{
          code: 'SNAPBACK_DEV_FRESH_UNMANAGED',
          severity: 'error',
          subsystem: 'cli',
          message: 'dev attached to an externally started server; dev-fresh only manages the child this process spawned',
          details: { readyFile },
        }],
      });
    }
    try {
      validateManagedDatabaseResetTarget(database, stateRoot);
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'dev-fresh-failed',
        verb: 'dev-fresh',
        ...tag,
        diagnostics: [error.diagnostic ?? {
          code: error.code ?? 'SNAPBACK_DEV_FRESH_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: error.message,
        }],
      });
    }
    removeApplicationReadyReceipt();
    restarting = true;
    try {
      const previousPid = descriptor.pid ?? null;
      if (child.exitCode === null && child.signalCode === null) {
        native(runtime.binary, ['stop', '--ready-file', readyFile], {
          cwd: projectRoot,
          env: options.env,
        });
        await stopProcessGroup(child);
      }
      removeManagedDatabaseState(database, readyFile, applicationReadyFile, stateRoot);
      refreshStartupArtifacts();
      refreshVisibilityGovernanceDevEnvironment();
      child = spawnManagedRuntime(runtime.binary, [
        'start',
        '--ready-file', readyFile,
        '--db', database,
        ...runtimePortArguments(),
        ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
      ], {
        cwd: projectRoot,
        env: managedDevRuntimeEnvironment(devRuntimeEnvironment),
        stdio: options.serverStdio ?? ['ignore', 2, 2],
      });
      attachExitWatch(child);
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
      refreshBackendPortPlan(descriptor);
      adminToken = managedAdminToken(descriptor, database);
      devIdentityCapability = resolveDevIdentityCapabilityForCli(
        descriptor,
        { readyFile, database },
      );
      emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'database-refreshed',
        verb: 'dev-fresh',
        ...tag,
        previousPid,
        pid: descriptor.pid ?? null,
        serverUrl: descriptor.serverUrl,
      });
      return await forceRegenerateAndLoad(
        '(dev-fresh)',
        { verb: 'dev-fresh', ...tag },
        { seed: true, failureState: 'dev-fresh-failed' },
      );
    } catch (error) {
      const refined = refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        database,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'dev-fresh-failed',
        verb: 'dev-fresh',
        ...tag,
        diagnostics: [refined.diagnostic ?? {
          code: refined.code ?? 'SNAPBACK_DEV_FRESH_FAILED',
          severity: 'error',
          subsystem: 'cli',
          message: refined.message,
        }],
      });
    } finally {
      restarting = false;
    }
  });

  return {
    ...result,
    get serverUrl() { return descriptor.serverUrl; },
    get snapbackUrl() { return devBackendUrls(descriptor.serverUrl).snapbackUrl; },
    get androidEmulatorUrl() { return devBackendUrls(descriptor.serverUrl).androidEmulatorUrl; },
    get portPlan() { return backendPortPlan; },
    get environmentFile() { return environmentFile; },
    get child() { return child; },
    verbs: {
      status: statusVerb,
      reload: reloadVerb,
      restart: restartVerb,
      'dev-fresh': devFreshVerb,
    },
    async close() {
      if (closed) return;
      closed = true;
      if (managed) removeApplicationReadyReceipt();
      clearTimeout(timer);
      watcher.close();
      await closeClientArm();
      await closeManaged();
    },
  };
}

// The two dev-loop control channels over stdin. A TTY gets single-key verbs
// (s=status, r=reload, R=restart backend, f=dev-fresh, q=quit); anything else is the
// machine-readable channel: newline-delimited JSON commands
// (`{"schemaVersion":"snapback.dev-command.v1","verb":"status"|"reload"|"restart"|"dev-fresh"}`,
// optional `requestId` echoed on the response event). Responses and events
// ride the one `snapback.dev.v1` JSON-line stream on stdout; unknown or
// malformed commands produce a structured `command-error` event, never a
// crash. EOF closes only this optional command channel: a detached agent or
// generated package script must not silently stop the server because its stdin
// was closed. Signals and the TTY q/Ctrl-C controls own process shutdown.
// Returns a detach function.
export function attachDevControlChannel({ verbs, stop, onEvent, stdin = process.stdin }) {
  const emit = (event) => onEvent?.({ schemaVersion: 'snapback.dev.v1', ...event });
  const commandError = (code, message, details) => emit({
    ok: false,
    state: 'command-error',
    diagnostics: [{ code, severity: 'error', subsystem: 'cli', message, ...(details ? { details } : {}) }],
  });
  const invoke = (verb, context) => {
    Promise.resolve(verbs[verb](context)).catch((error) => {
      commandError(error.code ?? 'SNAPBACK_DEV_COMMAND_FAILED', `dev verb ${verb} failed: ${error.message}`, { verb });
    });
  };
  if (stdin.isTTY) {
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onKey = (key) => {
      if (key === 's') invoke('status', {});
      else if (key === 'r') invoke('reload', {});
      else if (key === 'R') invoke('restart', {});
      else if (key === 'f') invoke('dev-fresh', {});
      else if (key === 'q' || key === '\u0003') stop();
    };
    stdin.on('data', onKey);
    emit({
      ok: true,
      state: 'control-ready',
      channel: 'tty',
      keys: {
        s: 'status',
        r: 'regenerate and reload',
        R: 'restart backend',
        f: 'reset the canonical managed whole store, restart, seed, and remint',
        q: 'quit',
      },
    });
    return () => {
      stdin.off('data', onKey);
      stdin.setRawMode?.(false);
      stdin.pause();
    };
  }
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      commandError('SNAPBACK_DEV_COMMAND_INVALID', 'dev commands are newline-delimited JSON objects', { line: line.slice(0, 200) });
      return;
    }
    if (command?.schemaVersion !== 'snapback.dev-command.v1' || typeof command?.verb !== 'string') {
      commandError(
        'SNAPBACK_DEV_COMMAND_INVALID',
        'expected {"schemaVersion":"snapback.dev-command.v1","verb":"..."}',
        { line: line.slice(0, 200) },
      );
      return;
    }
    const context = typeof command.requestId === 'string' ? { requestId: command.requestId } : {};
    if (!Object.hasOwn(verbs, command.verb)) {
      emit({
        ok: false,
        state: 'command-error',
        ...context,
        diagnostics: [{
          code: 'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB',
          severity: 'error',
          subsystem: 'cli',
          message: `unknown dev verb ${command.verb}`,
          details: { verb: command.verb, supported: Object.keys(verbs) },
        }],
      });
      return;
    }
    invoke(command.verb, context);
  });
  emit({
    ok: true,
    state: 'control-ready',
    channel: 'json',
    commandSchemaVersion: 'snapback.dev-command.v1',
    verbs: Object.keys(verbs),
  });
  return () => lines.close();
}

function takeFlag(args, name, fallback = null) {
  const index = args.findIndex((argument) => argument === name || argument.startsWith(`${name}=`));
  if (index === -1) return fallback;
  const value = args[index] === name ? args[index + 1] : args[index].slice(name.length + 1);
  if (!value || (args[index] === name && value.startsWith('--'))) throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', `${name} requires a value`);
  args.splice(index, args[index] === name ? 2 : 1);
  return value;
}

function takeOptionalValueFlag(args, name, defaultValue) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const candidate = args[index + 1];
  if (candidate === undefined || candidate.startsWith('--')) {
    args.splice(index, 1);
    return defaultValue;
  }
  args.splice(index, 2);
  return candidate;
}

function takeBooleanFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function printResult(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok === undefined) console.log(JSON.stringify(result, null, 2));
  else if (result.ok !== false && result.schemaVersion === 'snapback.auth-status.v1') {
    for (const provider of result.providers) {
      console.log(`${provider.provider}: ${provider.resolvedAdapter} (${provider.identityRealm}, ${provider.readiness})`);
      if (provider.nextAction !== null) console.log(`  Next: ${provider.nextAction}`);
    }
    if (result.providers.length === 0) console.log('No provider is declared. Run snapback auth enable apple google.');
    for (const nonclaim of result.nonclaims) console.log(`Note: ${nonclaim}`);
  }
  else if (result.ok !== false && result.schemaVersion === 'snapback.auth-enable.v1') {
    console.log(`Enabled ${result.providers.join(' and ')} in ${result.declaration}.`);
    for (const command of result.next) console.log(`Next: ${command}`);
    for (const nonclaim of result.nonclaims) console.log(`Note: ${nonclaim}`);
  }
  else if (result.ok !== false && result.schemaVersion === 'snapback.auth-configure.v1') {
    console.log(`${result.provider}: ${result.walkthrough.console}`);
    for (const [index, step] of result.walkthrough.steps.entries()) {
      console.log(`  ${index + 1}. ${step}`);
    }
    if (result.operation === 'record') {
      console.log(`Recorded ${result.recorded.join(', ')} in ${result.configFile}.`);
      if (result.missing.length > 0) console.log(`Still missing: ${result.missing.join(', ')}`);
      // Whether the config plugin was written is the difference between a
      // rebuild that carries the native integration and one that silently does
      // not, so it is reported here and not only under --json.
      const native = result.nativeIntegration;
      if (native.pluginConfigured) {
        console.log(`Config plugin ${native.plugin}: ${native.reason === 'added' ? 'added to app.json' : 'already present'}.`);
      } else if (native.reason !== 'configuration-incomplete') {
        console.log(`Config plugin ${native.plugin}: not written (${native.reason}).`);
      }
    }
    for (const command of result.next) console.log(`Next: ${command}`);
    for (const nonclaim of result.nonclaims ?? []) console.log(`Note: ${nonclaim}`);
  }
  else if (result.ok !== false && result.schemaVersion === 'snapback.init.v1') {
    console.log(`snapback.init.v1: ${result.state}`);
    console.log(`Install command: ${result.install.command.join(' ')}`);
    for (const command of result.next) console.log(`Next: ${command}`);
  }
  else if (result.ok !== false && result.schemaVersion === 'snapback.generate.v1' && result.summary) {
    // @ref LLP 0295#1d-current-source-qualification-and-developer-loop-cost —
    // print the grouped repair-class projection once instead of repeating each
    // migration site before the useful generation summary.
    const summaryGroupedCodes = groupedCodegenSummaryDiagnosticCodes(
      result.ok ? result.summary : null,
    );
    for (const diagnostic of result.diagnostics ?? []) {
      if (diagnostic.severity === 'warning' && summaryGroupedCodes.has(diagnostic.code)) continue;
      console.error(`[${diagnostic.severity}] ${diagnostic.code} (${diagnostic.subsystem}) ${diagnostic.message}`);
    }
    console.log(formatCodegenSummary(result.summary));
    if (result.check === true) console.log('codegen preflight ok (no artifacts emitted)');
  }
  else if (result.ok !== false) console.log(`${result.schemaVersion}: ok`);
  else console.error(JSON.stringify(result, null, 2));
}

function printDevEvent(event, { json, plainProfile }) {
  console.log(JSON.stringify(event));
  const urls = typeof event?.snapbackUrl === 'string'
    ? event
    : typeof event?.backend?.snapbackUrl === 'string'
      ? event.backend
      : null;
  if (!json && urls !== null) {
    console.log(`SNAPBACK_URL=${urls.snapbackUrl}`);
    console.log(`Android emulator URL: ${urls.androidEmulatorUrl}`);
    if (plainProfile) {
      console.log('Mint an explicit ordinary session: snapback auth dev-session [--email <address>]');
    }
  }
  const environmentFile = event?.environmentFile ?? event?.backend?.environmentFile ?? null;
  if (environmentFile?.state === 'rewritten') {
    console.error(`Snapback URL changed in ${environmentFile.path}; restart the bundler to read the rewritten environment.`);
  }
  if (environmentFile?.gitignored === false) {
    console.error(`Warning: ${environmentFile.path} is not gitignored; add an ignore rule before committing local URL state.`);
  }
}

function declarationSuggestionCliFailure(message, details = {}) {
  const code = 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID';
  if (!DECLARATION_SUGGESTION_REASON_CODES.includes(code)) {
    throw new Error(`declaration suggestion schema does not admit ${code}`);
  }
  return {
    schemaVersion: 'snapback.declaration-suggestion-result.v1',
    artifactKind: 'declarationSuggestionResult',
    ok: false,
    suggestions: [],
    diagnostics: [{
      schemaVersion: 'snapback.declaration-suggestion-diagnostic.v1',
      code,
      severity: 'error',
      subsystem: 'codegen',
      message,
      details,
    }],
  };
}

// This registry is the package-owned half of the composed CLI surface. Keep it
// data-only: root/per-command help is rendered from it before command dispatch,
// so asking for help can never scaffold, generate, diagnose, verify, deploy, or
// start a long-running process. The delegated half is projected from the
// native binary's clap help at runtime.
//
// @ref LLP 0041#cli-commands — the package owns these orchestration verbs while
// established host operations remain delegated to the native CLI.
export const PACKAGED_CLI_COMMANDS = Object.freeze([
  {
    name: 'author', usage: 'snapback author suggest <operation-or-file> <--format patch|--json> | snapback author suggestion apply <suggestion.json> --json',
    description: 'Derive reviewable result and addition-only dependency declarations, then apply one identity-bound suggestion with stale-safe compare-and-write.', lifecycle: 'one-shot (suggest is read-only; apply writes one exact source patch)',
    output: 'snapback.declaration-suggestion-result.v1 or snapback.declaration-suggestion-apply.v1; unified source patch with --format patch', exits: '0 analysis/application completed (including explicit holes/refused candidate classes); 1 invalid input or stale/refused write',
    recovery: 'Resolve every evidence hole before manual authoring, or regenerate the suggestion after any stale-input refusal.',
  },
  {
    name: 'guide', usage: 'snapback guide <ExactSymbolName|module> [--slice <n>] [--json]',
    description: 'Return a build-bound exact API symbol or bounded module slice; fuzzy queries delegate to the native Guide search.', lifecycle: 'one-shot/read-only',
    output: 'snapback.guide-search.v1 in JSON mode on channels, exact, fuzzy, and zero-match branches', exits: '0 completed lookup (including zero matches); 1 invalid slice or identity mismatch',
    recovery: 'Use the emitted next command for truncated slices, or regenerate the Guide when registry identity mismatches.',
  },
  {
    name: 'init', usage: 'snapback init [--install] [--json]',
    description: 'Adopt Snapback into a recognized existing Expo or packaged-shape React application without overwriting it.', lifecycle: 'one-shot',
    output: 'snapback.init.v1 JSON with --json; adoption/install/next commands otherwise', exits: '0 initialized or already initialized; 1 typed detection, collision, package-manager, or install refusal',
    recovery: 'Follow the named manual seam or sibling-scaffold workaround; reruns of a complete initialization are no-ops.',
  },
  {
    // The template list is enumerated from the packaged template registry
    // (listTemplates), never hardcoded, so help cannot drift when a template
    // is added — the same rule create-snapback-app follows.
    name: 'new', usage: `snapback new <name> [--template ${listTemplates().join('|')}] [--json]`,
    description: 'Scaffold a Snapback application from a packaged template (default: todo-contract).', lifecycle: 'one-shot',
    output: 'snapback.new.v1 JSON with --json; concise success text otherwise', exits: '0 success; 1 structured CLI/scaffold refusal',
    recovery: 'Fix the named argument/path diagnostic and rerun; existing files are not silently replaced.',
    details: Object.freeze([
      'After scaffolding, bun run prove is ordinary completion and the only done-oracle; bun run test:static is no-server coherence; npm test is raw acceptance debugging.',
      'README.md and AGENTS.md list the browser/simulator observation commands available to that template; carrier artifacts never replace the prove receipt.',
    ]),
  },
  {
    name: 'generate', usage: 'snapback generate [<backend-dir>] [--target-profile <id>] [--check] [--json]',
    description: 'Generate and validate reviewable app artifacts, or run the complete preflight without emission.', lifecycle: 'one-shot',
    output: 'snapback.generate.v1', exits: '0 complete generation/preflight; 1 diagnostics contain a refusal',
    recovery: 'Repair the emitted source/artifact diagnostic, then rerun generation.',
  },
  {
    name: 'replay', usage: 'snapback replay [<backend-dir>] --actions <file.jsonl> [--api <generated/api.mjs>] [--ready-file <path>] [--receipts <file>] [--custody minted|none] [--resume] [--detach] [--status] [--status-file <path>] [--json]',
    description: 'Run or watch an ordered, resumable, headless mutation replay through the generated application API.', lifecycle: 'one-shot runner; --detach starts a long-running process group and returns after the child fences the WAL; --status is read-only',
    output: 'snapback.replay-receipt.v1 or snapback.replay-status.v1; --json emits exactly one stdout document', exits: '0 completed/started or readable live/complete status; 1 refusal, failed/dead status, or unsafe preflight',
    recovery: 'Use --status while detached; use --resume only for a dead runner, preserving the receipts and session-custody sidecars.',
  },
  {
    name: 'reset', usage: 'snapback reset [<backend-dir>] --dev-fresh [--db <path>] [--ready-file <path>] [--email <address>] [--json]',
    description: 'One-shot dev-fresh reset of the canonical managed dev target: validate ownership, remove the whole store, re-apply seed, coordinate session re-mint, and report readiness. All other reset forms delegate to the native app.reset.',
    lifecycle: 'one-shot',
    output: 'snapback.dev.v1 JSON-line events followed by one snapback.reset-dev-fresh.v1 report',
    exits: '0 fresh+seeded(+authority) readiness; 1 structured refusal (individual lifecycle refusals are preserved, not bypassed)',
    recovery: 'Act on the surfaced diagnostic; for a live dev loop use its control-channel dev-fresh verb; for a stale supervisor descriptor remove it and rerun.',
    details: Object.freeze([
      'Without --dev-fresh, snapback reset and all of its arguments delegate unchanged to the native app.reset command.',
      '--email is used only by the standalone Sessions verification mint; a running supervisor keeps its configured email.',
      '--db must resolve to the canonical <project>/.snapback/dev.sqlite3; custom/shared and symlink-ambiguous targets refuse before deletion.',
    ]),
  },
  {
    name: 'auth', usage: 'snapback auth dev-session [--ready-file <path>] [--email <address>] [--json]',
    description: 'Mint one explicit ordinary development session from an existing managed ready target; other auth subcommands delegate to the native CLI.',
    lifecycle: 'one-shot',
    output: 'snapback.dev-session.v1 on stdout only',
    exits: '0 session minted; 1 missing/stale target, managed-artifact refusal, or existing mint-mode refusal',
    recovery: 'Start snapback dev for this project, select its ready file when non-conventional, and repair the preserved mint diagnostic.',
    details: Object.freeze([
      'The default ready target is ./.snapback/dev.ready.json; --ready-file takes precedence.',
      'The bearer is never written to .env.local or any other credential file by this command.',
    ]),
  },
  {
    name: 'doctor', usage: 'snapback doctor [--json]', description: 'Diagnose the packaged runtime and local prerequisites.', lifecycle: 'one-shot/read-only',
    output: 'snapback.doctor.v1', exits: '0 healthy; 1 one or more checks failed', recovery: 'Follow the diagnostic recovery record; runtime failures normally name bootstrap or receipt repair.',
  },
  {
    name: 'verify', usage: 'snapback verify [<backend-dir>] [--config <file>] [--receipt <file>] [--runtime-binary <path>] [--runtime-receipt <path>] [--timeout-ms <ms>] [--json]',
    description: 'Run the identity-bound partial done-oracle for a declared app.', lifecycle: 'one-shot',
    output: `${VERIFY_RECEIPT_SCHEMA_VERSION} receipt`, exits: '0 all required stages pass (including machine-distinct passed-without-acceptance); 1 failed/refused stage', recovery: 'Use the failed stage diagnostics and rerun against the same declared app identity.',
  },
  {
    name: 'dev', usage: 'snapback dev [<backend-dir>] [--attach] [--no-watch] [--port <port>] [--client-port <port>] [--bootstrap-port <port>] [--port-range <lo>-<hi>] [--external-client-origin <origin>] [--ready-file <path>] [--application-ready-file <path>] [--db <path>] [--write-env [path]] [--client <dir>] [--client-command <cmd>] [--expo] [--expo-dir <dir>] [--expo-platform ios|android|web] [--email <address>] [--expo-command <cmd>] [--android-serial <serial>] [--ios-udid <udid>] [--native-checkout --expo-app-scheme <scheme> <--ios-bundle-identifier <id>|--android-component <component>>] [--json]',
    description: 'Generate, start or attach, load, watch, and optionally supervise a web or Expo client surface.', lifecycle: 'long-running unless --no-watch (Expo supervision is always long-running)',
    output: 'snapback.dev.v1 JSON-line events; snapback.dev-command.v1 JSON lines are accepted on non-TTY stdin while it remains open', exits: '0 requested signal/TTY quit or successful --no-watch; 1 startup/watch/server failure',
    recovery: 'Act on the event diagnostic. Non-TTY stdin EOF only closes the optional control channel; use SIGINT/SIGTERM to stop the dev loop.',
    details: Object.freeze([
      'Bare snapback is discovery-only root help; use snapback dev for the managed authoring loop.',
      'Use native snapback start only when a lower-level harness owns loading and lifecycle.',
      'Fixed external client: snapback dev snapback --port 3210 --external-client-origin http://localhost:5173; Snapback owns only the backend child.',
      'Supervised Expo iOS: snapback dev snapback --expo --expo-platform ios (ios is the default).',
      'Supervised Expo Android: snapback dev snapback --expo --expo-platform android.',
      'Supervised Expo web: snapback dev snapback --expo --expo-platform web.',
      'Every owned listener uses the stable 4287-4387 range by default; use --port/--client-port/--bootstrap-port for strict pins or --port-range for a constrained lane.',
      'Native dev-identity checkout is default-off and requires the application development client\'s own bundle/component and URL scheme; Expo Go is refused.',
      '--expo owns the bootstrap environment; --client-command is a generic child and does not install the supervised Expo bootstrap.',
      '--write-env defaults to ./.env.local, owns one marked non-secret URL block, and warns when the target is not gitignored.',
    ]),
  },
  {
    name: 'accept', usage: 'snapback accept comparator <--config <file>|--verify-receipt <file>> [--receipt <file>] [--timeout-ms <ms>] [--max-age-ms <ms>] [--json]',
    description: 'Run or verify a comparator acceptance profile.', lifecycle: 'one-shot', output: 'snapback.comparator-acceptance.v1 or snapback.comparator-verification.v1',
    exits: 'profile-defined acceptance exit code', recovery: 'Inspect the failed comparator check/receipt diagnostic and rerun the named profile.',
  },
  {
    name: 'runtime-qualify', usage: 'snapback runtime-qualify [--persist|--verify] [--receipt <path>] [--json]',
    description: 'Run native VM qualification, or persist/verify the packaged runtime-readiness receipt.', lifecycle: 'one-shot', output: 'native runtime qualification or snapback.runtime-readiness result',
    exits: '0 qualified/valid; 1 qualification or receipt failure', recovery: 'Reissue readiness after the exact binary/Hermes artifacts qualify, or run bootstrap for full repair.',
  },
  {
    name: 'mcp-control', usage: 'snapback mcp-control [<backend-dir>] [--ready-file <path>] [--db <path>]',
    description: 'Serve control-plane MCP over newline-delimited JSON-RPC stdio.', lifecycle: 'long-running stdio server; EOF terminates', output: 'JSON-RPC 2.0 on stdout',
    exits: '0 clean EOF; non-zero startup/protocol host failure', recovery: 'Reconnect with a valid private ready-file/database target and resend complete JSON-RPC lines.',
  },
  {
    name: 'agent', usage: 'snapback agent setup <--print <client>|--install <client>|--uninstall <client>> [--server mcp|mcp-control] [--receipt <file>] [--json]',
    description: 'Print, install, or uninstall project-scoped MCP client configuration.', lifecycle: 'one-shot',
    output: 'client config snippet or snapback.agent-setup-receipt.v1; structured envelope with --json',
    exits: '0 printed/installed/uninstalled; 1 invalid arguments, config conflict, or receipt mismatch',
    recovery: 'Choose a supported client/server, preserve existing entries, and resolve the named config or receipt conflict before retrying.',
  },
  {
    name: 'target', usage: 'snapback target <add|show|doctor|inspect> ... [--control-root <dir>] [--json]', description: 'Register or inspect immutable target descriptors.', lifecycle: 'one-shot',
    output: 'structured target/control result JSON', exits: '0 success; 1 refusal/unhealthy target', recovery: 'Repair the descriptor or target diagnostic before retrying.',
  },
  {
    name: 'hosted', usage: 'snapback hosted <plan|inspect|logs|operator-request|lifecycle> ... [--json]', description: 'Plan and operate the hosted control profile.', lifecycle: 'one-shot',
    output: 'structured hosted plan/read/lifecycle result JSON', exits: '0 success; 1 read/plan failure; 2 refused lifecycle operation', recovery: 'Use the returned refusal/recovery record; never infer success from transport status alone.',
  },
  {
    name: 'inspect', usage: 'snapback inspect --target <id> [--since-ms <ms>] [--until-ms <ms>] [--limit <n>] [--cursor <opaque>] [--control-root <dir>] [--json]', description: 'Inspect a registered deployment target.', lifecycle: 'one-shot/read-only',
    output: 'structured target inspection JSON', exits: '0 success; 1 inspection failure', recovery: 'Repair target identity/authority from the diagnostic and retry.',
  },
  {
    name: 'logs', usage: 'snapback logs --target <id> [--since-ms <ms>] [--until-ms <ms>] [--limit <n>] [--cursor <opaque>] [--control-root <dir>] [--json]', description: 'Read bounded target control logs.', lifecycle: 'one-shot/read-only',
    output: 'structured bounded log page JSON', exits: '0 success; 1 read failure', recovery: 'Correct target/cursor/bounds using the diagnostic and retry.',
  },
  {
    name: 'audit', usage: 'snapback audit verify [--control-root <dir>] [--json]', description: 'Verify the control audit ledger.', lifecycle: 'one-shot/read-only', output: 'structured audit verification JSON',
    exits: '0 valid; 1 invalid/incomplete ledger', recovery: 'Preserve the ledger and investigate the first failed integrity diagnostic.',
  },
  {
    name: 'backup', usage: 'snapback backup <create|list|verify> ... --target <id> [--control-root <dir>] [--json]', description: 'Plan/apply, list, or verify target backups.', lifecycle: 'one-shot', output: 'structured backup plan/receipt/list JSON',
    exits: '0 success; 1 failure/refusal', recovery: 'Use the plan/receipt diagnostic; destructive work requires the exact confirmation token.',
  },
  {
    name: 'restore', usage: 'snapback restore <plan|apply|verify|activate> ... --target <id> [--control-root <dir>] [--json]', description: 'Plan, apply, verify, and activate restores.', lifecycle: 'one-shot', output: 'structured restore plan/receipt JSON',
    exits: '0 success; 1 failure; 2 plan is not apply-eligible', recovery: 'Resolve every apply-eligibility diagnostic and use the exact confirmation token.',
  },
  {
    name: 'deploy', usage: 'snapback deploy <build|plan|apply|status|rollback> ... [--json]', description: 'Build immutable releases and operate deployment plans.', lifecycle: 'one-shot', output: 'structured release/deploy plan/receipt JSON',
    exits: '0 success; 1 command failure; 2 plan is not apply-eligible', recovery: 'Repair qualification/identity/plan diagnostics before applying with an exact confirmation.',
  },
]);

const PACKAGED_CLI_COMMAND_BY_NAME = new Map(PACKAGED_CLI_COMMANDS.map((entry) => [entry.name, entry]));

function nestedCliHelp(path, usage, description, details = []) {
  const parent = PACKAGED_CLI_COMMAND_BY_NAME.get(path[0]);
  return Object.freeze({
    name: path.join(' '),
    path: Object.freeze(path),
    usage,
    description,
    lifecycle: parent.lifecycle,
    output: parent.output,
    exits: parent.exits,
    recovery: parent.recovery,
    details: Object.freeze(details),
  });
}

const HOSTED_LIFECYCLE_USAGE = 'snapback hosted lifecycle <closed-verb> --request <lifecycle-v2.json> --operator-request <supervisor-request-v1.json> --supervisor <https-origin> --client-key <mode-0600.pem> --client-cert <pem> --server-ca <pem> --root-public-key <pem> --server-certificate-sha256 <sha256:...> [--json]';
const HOSTED_LIFECYCLE_HELP_DETAILS = Object.freeze([
  `Closed verbs: ${Object.keys(HOSTED_LIFECYCLE_VERBS).join(', ')}`,
  'Availability: disabled until the reviewed lifecycle carrier and live supervisor/provider evidence are complete.',
]);

// Nested wrapper help is data, too. Keeping every positional dispatch path in
// this registry prevents the pre-dispatch help guard from collapsing a precise
// request such as `backup create plan --help` back to top-level backup help.
//
// @ref LLP 0111#closed-request-and-command-registry — hosted lifecycle verb
// spellings are derived from the exhaustive authority registry.
const AUTH_SETUP_HELP_SHELL = Object.freeze({
  lifecycle: 'one-shot',
  output: 'snapback.auth-enable.v1, snapback.auth-configure.v1, or snapback.auth-status.v1',
  exits: '0 completed (including a blocked provider readiness report); 1 typed declaration, staleness, or argument refusal',
  recovery: 'Act on the reported next action; a stale-refused edit is retried after rereading the named file.',
});

function authSetupCliHelp(path, usage, description, details = []) {
  return Object.freeze({
    name: path.join(' '),
    path: Object.freeze(path),
    usage,
    description,
    ...AUTH_SETUP_HELP_SHELL,
    details: Object.freeze(details),
  });
}

export const PACKAGED_CLI_SUBCOMMANDS = Object.freeze([
  // @ref LLP 0151#setup-and-status — the provider setup verbs are package-owned
  // because they edit app source and read generated artifacts. Every other
  // `snapback auth` verb delegates to the native binary, help included.
  authSetupCliHelp(
    ['auth', 'enable'],
    'snapback auth enable <apple|google>... [--backend-dir <dir>] [--json]',
    'Declare identity providers in the app auth declaration itself, with a stale-safe edit.',
    [
      'The declaration is the source of provider policy, so this edits it rather than writing a side-channel file the declaration would not agree with.',
      'Enabling a provider also adds the external-session seam its completion path redeems through; a declaration that sets externalSessionEntry to anything but true is refused.',
      'A hand-written providers block is never reserialized; the refusal names the exact entries to paste.',
      'Local development without app-owned credentials resolves to the Snapback shared development profile, which issues hermetic rehearsal identities — not Apple or Google logins.',
    ],
  ),
  authSetupCliHelp(
    ['auth', 'configure'],
    'snapback auth configure <apple|google> [--<identifier> <value>...] [--app-scheme <scheme>] [--bundle-identifier <id>] [--return-url <url>] [--backend-dir <dir>] [--json]',
    'Record one provider\'s public identifiers and secret references, and print the console work that cannot be automated.',
    [
      'With no identifiers this prints the walkthrough and writes nothing.',
      'Secret values are never accepted here. Each one comes back as an exact snapback config set --entry <name> --value-stdin command.',
      'Apple and Google expose no client-registration API, so the console steps are a deterministic walkthrough carrying this app\'s own bundle identifier, scheme, and return URL.',
      'Recorded configuration is not readiness: the installed client must also carry the matching native integration.',
    ],
  ),
  authSetupCliHelp(
    ['auth', 'status'],
    'snapback auth status [--deployment <profile>] [--platform ios|android|web] [--shared-available] [--backend-dir <dir>] [--json]',
    'Report the requested credential policy, resolved Adapter, configuration readiness, profile generation, and one next action per declared provider.',
    [
      'Resolution uses the same first-party resolver the client uses, so status and runtime cannot disagree.',
      'The CLI never claims native readiness: it cannot observe an installed build, and the installed client reports its own build receipt.',
      'Secret values never appear in this output.',
    ],
  ),
  nestedCliHelp(
    ['auth', 'dev-session'],
    'snapback auth dev-session [--ready-file <path>] [--email <address>] [--json]',
    'Mint an ordinary session from the existing managed development target and print it to stdout without creating another disk credential.',
    ['--email defaults to snapback-dev@localhost.invalid.'],
  ),
  nestedCliHelp(
    ['author', 'suggest'],
    'snapback author suggest <operation-or-file> <--format patch|--json>',
    'Read a stable backend snapshot and derive result plus receipt-witnessed addition-only dependency DeclarationSuggestionV1 records without editing source.',
    [
      'Use <file>#<operation> for one operation, a definition file for all operations in it, or an operation name from inside a backend directory.',
      'When the conventional .snapback/verify-receipt.json exists, only underDeclarations on explicitly registered paths can propose read/write additions; overDeclarations never propose removals.',
      '--format patch includes semantic consequences, unresolved holes, exact post-acceptance checks, and an ordinary unified source diff.',
    ],
  ),
  nestedCliHelp(
    ['author', 'suggestion'],
    'snapback author suggestion apply <suggestion.json> --json',
    'Operate on one retained declaration suggestion.',
  ),
  nestedCliHelp(
    ['author', 'suggestion', 'apply'],
    'snapback author suggestion apply <suggestion.json> --json',
    'Recompute the complete analysis identity and atomically apply exactly one unchanged suggestion.',
    ['Manual paste remains possible, but only this command makes the stale-safe compare-and-write claim.'],
  ),
  nestedCliHelp(['accept', 'comparator'], 'snapback accept comparator <--config <profile.mjs>|--verify-receipt <receipt.json>> [--receipt <receipt.json>] [--timeout-ms <ms>] [--max-age-ms <ms>] [--json]', 'Run a comparator profile or verify its retained receipt.'),
  nestedCliHelp(
    ['agent', 'setup'],
    'snapback agent setup <--print <client>|--install <client>|--uninstall <client>> [--server mcp|mcp-control] [--receipt <file>] [--json]',
    'Configure project-scoped MCP for Codex, Claude, Cursor, VS Code, or a generic client.',
    [
      '--print defaults to both servers; --install and --uninstall require an explicit --server.',
      'generic emits adaptable JSON with --print and has no install target.',
      '--receipt writes an install receipt or verifies it during uninstall.',
    ],
  ),
  nestedCliHelp(['target', 'add'], 'snapback target add --descriptor <target.json> [--control-root <dir>] [--json]', 'Register an immutable target descriptor.'),
  ...['show', 'doctor', 'inspect'].map((verb) => nestedCliHelp(['target', verb], `snapback target ${verb} <target-id> [--control-root <dir>] [--json]`, `${verb[0].toUpperCase()}${verb.slice(1)} a registered target.`)),
  nestedCliHelp(['hosted', 'plan'], 'snapback hosted plan [--target <id>] [--control-root <dir>] [--json]', 'Render the closed hosted command and asset plan.'),
  ...['inspect', 'logs'].map((verb) => nestedCliHelp(['hosted', verb], `snapback hosted ${verb} --target <id> [--since-ms <ms>] [--until-ms <ms>] [--limit <n>] [--cursor <opaque>] [--control-root <dir>] [--json]`, `${verb[0].toUpperCase()}${verb.slice(1)} bounded hosted target facts.`)),
  nestedCliHelp(['hosted', 'operator-request'], 'snapback hosted operator-request --request <supervisor-request-v1.json> --supervisor <https-origin> --client-key <mode-0600.pem> --client-cert <pem> --server-ca <pem> --root-public-key <pem> --server-certificate-sha256 <sha256:...> [--json]', 'Submit a signed, certificate-pinned supervisor request.'),
  nestedCliHelp(['hosted', 'lifecycle'], HOSTED_LIFECYCLE_USAGE, 'Invoke one verb from the closed hosted lifecycle registry.', HOSTED_LIFECYCLE_HELP_DETAILS),
  ...Object.entries(HOSTED_LIFECYCLE_VERBS).map(([verb, operation]) => nestedCliHelp(
    ['hosted', 'lifecycle', verb],
    HOSTED_LIFECYCLE_USAGE.replace('<closed-verb>', verb),
    `Invoke the ${operation} hosted lifecycle operation.`,
    HOSTED_LIFECYCLE_HELP_DETAILS,
  )),
  nestedCliHelp(['audit', 'verify'], 'snapback audit verify [--control-root <dir>] [--json]', 'Verify the control audit ledger.'),
  nestedCliHelp(['backup', 'create'], 'snapback backup create <plan|apply> ... --target <id> [--control-root <dir>] [--json]', 'Plan or apply creation of a retained backup.'),
  nestedCliHelp(['backup', 'create', 'plan'], 'snapback backup create plan --target <id> --reason <text> --retention-policy <policy> [--operation-id <id>] [--control-root <dir>] [--json]', 'Create a confirmation-bound backup plan.'),
  nestedCliHelp(['backup', 'create', 'apply'], 'snapback backup create apply <plan-id> --target <id> --confirm <token> [--control-root <dir>] [--json]', 'Apply an exact confirmed backup plan.'),
  nestedCliHelp(['backup', 'list'], 'snapback backup list --target <id> [--control-root <dir>] [--json]', 'List retained backups for a target.'),
  nestedCliHelp(['backup', 'verify'], 'snapback backup verify <backup-id> --target <id> [--control-root <dir>] [--json]', 'Verify a retained backup manifest.'),
  nestedCliHelp(['restore', 'plan'], 'snapback restore plan <backup-id> --source-target <id> --target <destination-id> --reason <text> [--replace-release <id> --destination-sentinel <sha256>] [--operation-id <id>] [--control-root <dir>] [--json]', 'Create a confirmation-bound restore plan.'),
  nestedCliHelp(['restore', 'apply'], 'snapback restore apply <plan-id> --target <destination-id> --confirm <token> [--control-root <dir>] [--json]', 'Apply an exact confirmed restore plan.'),
  nestedCliHelp(['restore', 'verify'], 'snapback restore verify <receipt-id> --target <destination-id> [--control-root <dir>] [--json]', 'Verify a retained restore receipt.'),
  nestedCliHelp(['restore', 'activate'], 'snapback restore activate <plan|apply> ... --target <destination-id> [--control-root <dir>] [--json]', 'Plan or apply restored-generation activation.'),
  nestedCliHelp(['restore', 'activate', 'plan'], 'snapback restore activate plan <restore-receipt-id> --target <destination-id> --release <restored-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --reason <text> [--operation-id <id>] [--control-root <dir>] [--json]', 'Create a confirmation-bound restored-generation activation plan.'),
  nestedCliHelp(['restore', 'activate', 'apply'], 'snapback restore activate apply <plan-id> --target <destination-id> --release <restored-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>] [--json]', 'Apply an exact confirmed restored-generation activation plan.'),
  nestedCliHelp(['deploy', 'build'], 'snapback deploy build [<backend-dir>] [--target-profile <id>] [--output <dir>] [--web-dist <dir>] [--runtime-artifact <dir>] [--runtime-platform <id>] [--runtime-hermes-bundle <id>] [--allow-dirty] [--json]', 'Build and verify an immutable target-neutral release.'),
  nestedCliHelp(['deploy', 'plan'], 'snapback deploy plan <release-dir> --target <id> --reason <text> [--prepared-release <manifest>] [--adapter-qualification <manifest>] [--operation-id <id>] [--control-root <dir>] [--json]', 'Create a confirmation-bound deployment plan.'),
  nestedCliHelp(['deploy', 'apply'], 'snapback deploy apply <plan-id> --target <id> --release <release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>] [--json]', 'Apply an exact confirmed deployment plan.'),
  nestedCliHelp(['deploy', 'status'], 'snapback deploy status --target <id> [--control-root <dir>] [--json]', 'Inspect current deployment status.'),
  nestedCliHelp(['deploy', 'rollback'], 'snapback deploy rollback <plan|apply> ... --target <id> [--control-root <dir>] [--json]', 'Plan or apply a code-only rollback.'),
  nestedCliHelp(['deploy', 'rollback', 'plan'], 'snapback deploy rollback plan --target <id> --release <destination-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --reason <text> [--operation-id <id>] [--control-root <dir>] [--json]', 'Create a confirmation-bound rollback plan.'),
  nestedCliHelp(['deploy', 'rollback', 'apply'], 'snapback deploy rollback apply <plan-id> --target <id> --release <destination-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>] [--json]', 'Apply an exact confirmed rollback plan.'),
]);

const PACKAGED_CLI_HELP_BY_NAME = new Map([
  ...PACKAGED_CLI_COMMAND_BY_NAME,
  ...PACKAGED_CLI_SUBCOMMANDS.map((entry) => [entry.name, entry]),
]);

function resolvePackagedHelpName(command, args = []) {
  if (!PACKAGED_CLI_COMMAND_BY_NAME.has(command)) return null;
  let match = command;
  for (const entry of PACKAGED_CLI_SUBCOMMANDS) {
    if (entry.path[0] !== command || entry.path.length === 1) continue;
    const suffix = entry.path.slice(1);
    if (suffix.every((part, index) => args[index] === part) && entry.path.length > match.split(' ').length) {
      match = entry.name;
    }
  }
  // `auth` is a delegated native command family with one package-owned leaf.
  // Intercept only that exact leaf; parent and sibling help stay clap-owned.
  return command === 'auth' && match === 'auth' ? null : match;
}

function longestRegisteredNativeCommandPath(options, requestedPath) {
  const structured = nativeCommandInventory(options);
  if (!structured.ok) return requestedPath;
  const resolved = [];
  let command = structured.inventory.root;
  for (const part of requestedPath) {
    const next = command.subcommands?.find((entry) => entry.name === part);
    if (next === undefined) break;
    resolved.push(part);
    command = next;
  }
  return resolved.length > 0 ? resolved : requestedPath;
}

function nativeHelp(options, commandPath = null) {
  try {
    const runtime = resolveRuntimeBinary(options);
    const resolvedCommandPath = commandPath === null
      ? null
      : longestRegisteredNativeCommandPath(options, commandPath);
    const result = spawnSync(runtime.binary, resolvedCommandPath === null ? ['--help'] : [...resolvedCommandPath, '--help'], {
      encoding: 'utf8',
      env: runtimeSpawnEnvironment(runtime.binary, options.env),
    });
    if (result.error) throw result.error;
    return {
      ok: result.status === 0,
      text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
      exitCode: result.status ?? 1,
      commandPath: resolvedCommandPath,
    };
  } catch (error) {
    return { ok: false, text: `native help unavailable: ${error.message}`, exitCode: 1, commandPath };
  }
}

// @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — composed
// root JSON projects the native Clap tree structurally, not as opaque prose.
function nativeCommandInventory(options) {
  try {
    const runtime = resolveRuntimeBinary(options);
    const result = spawnSync(runtime.binary, ['command-inventory'], {
      encoding: 'utf8',
      env: runtimeSpawnEnvironment(runtime.binary, options.env),
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `native inventory exited ${result.status}`);
    const inventory = JSON.parse(result.stdout);
    if (inventory?.schemaVersion !== 'snapback.native-command-inventory.v1' || inventory?.ok !== true || !Array.isArray(inventory?.root?.subcommands)) {
      throw new Error('native command inventory has an unsupported shape');
    }
    return { ok: true, inventory };
  } catch (error) {
    return { ok: false, error: error.message, inventory: null };
  }
}

function printCliHelp(command, { json, options, nativeCommandPath = null }) {
  if (command !== null && PACKAGED_CLI_HELP_BY_NAME.has(command)) {
    const entry = PACKAGED_CLI_HELP_BY_NAME.get(command);
    const scope = entry.path ? 'subcommand' : 'command';
    if (json) {
      console.log(JSON.stringify({ schemaVersion: 'snapback.cli-help.v1', ok: true, scope, command: entry }, null, 2));
    } else {
      console.log([
        `Usage: ${entry.usage}`,
        '',
        entry.description,
        ...(entry.details?.length ? ['', ...entry.details] : []),
        '',
        `Lifecycle: ${entry.lifecycle}`,
        `Machine output: ${entry.output}`,
        `Exit taxonomy: ${entry.exits}`,
        `Recovery: ${entry.recovery}`,
      ].join('\n'));
    }
    return 0;
  }

  if (nativeCommandPath !== null) {
    const native = nativeHelp(options, nativeCommandPath);
    if (native.text) console.log(native.text);
    if (native.commandPath?.join(' ') === 'auth password unlock') {
      console.log('');
      console.log('Wrapper credential carrier:');
      console.log('      --admin-token-file <path>  Read the admin token from an owner-only regular file and pass it to the native verb through SNAPBACK_ADMIN_TOKEN');
    }
    // A natively owned command can still have package-owned verbs (`snapback
    // auth enable|configure|status`). Native help cannot know about them, so
    // name them here rather than leaving them undiscoverable.
    const packagedVerbs = PACKAGED_CLI_SUBCOMMANDS
      .filter((entry) => entry.path[0] === command && !PACKAGED_CLI_COMMAND_BY_NAME.has(command))
      .map((entry) => entry.name);
    if (packagedVerbs.length > 0) {
      console.log('');
      console.log(`Package-owned verbs (use --help on one): ${packagedVerbs.join(', ')}`);
    }
    return native.exitCode;
  }

  const native = nativeHelp(options);
  if (json) {
    const structuredNative = nativeCommandInventory(options);
    console.log(JSON.stringify({
      schemaVersion: 'snapback.cli-help.v1',
      ok: true,
      scope: 'root',
      packagedCommands: PACKAGED_CLI_COMMANDS,
      nativeCommands: structuredNative.inventory?.root?.subcommands ?? [],
      nativeInventory: {
        available: structuredNative.ok,
        schemaVersion: structuredNative.inventory?.schemaVersion ?? null,
        ...(structuredNative.ok ? {} : { error: structuredNative.error }),
      },
      nativeHelp: { available: native.ok, text: native.text },
    }, null, 2));
  } else {
    const width = Math.max(...PACKAGED_CLI_COMMANDS.map(({ name }) => name.length));
    console.log([
      'Usage: snapback <command> [options]',
      '',
      'Packaged commands:',
      ...PACKAGED_CLI_COMMANDS.map(({ name, description }) => `  ${name.padEnd(width)}  ${description}`),
      '  Hidden/deprecated packaged commands: none.',
      '',
      'Delegated native command inventory:',
      native.text,
      '',
      'Run `snapback <command> --help` for flags, lifecycle, machine output, exit taxonomy, and recovery.',
    ].join('\n'));
  }
  return 0;
}

export async function runCli(argv, options = {}) {
  const args = [...argv];
  const command = args.shift();
  if (command === undefined) return printCliHelp(null, { json: false, options });
  if (command === '--version' || command === '-V') {
    console.log(`snapback ${packageVersion()}`);
    return 0;
  }
  const helpIndex = args.findIndex((argument) => argument === '--help' || argument === '-h');
  if (command === '--help' || command === '-h' || command === 'help' || helpIndex !== -1) {
    let target = null;
    let nativeCommandPath = null;
    if (command === 'help') {
      const targetIndex = args.findIndex((argument) => !argument.startsWith('-'));
      if (targetIndex !== -1) {
        const requestedCommand = args[targetIndex];
        const requestedArgs = args.slice(targetIndex + 1).filter((argument) => argument !== '--json');
        target = resolvePackagedHelpName(requestedCommand, requestedArgs);
        if (target === null) nativeCommandPath = [requestedCommand, ...requestedArgs];
      }
    } else if (command !== '--help' && command !== '-h') {
      const requestedArgs = args.slice(0, helpIndex).filter((argument) => argument !== '--json');
      target = resolvePackagedHelpName(command, requestedArgs);
      if (target === null) nativeCommandPath = [command, ...requestedArgs];
    }
    return printCliHelp(target, {
      json: args.includes('--json'),
      options,
      nativeCommandPath,
    });
  }
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const auditActorId = takeFlag(args, '--audit-actor');
  if (auditActorId !== null) options = { ...options, auditActorId };
  if (command === 'auth' && args[0] === 'dev-session') {
    args.shift();
    const readyFile = takeFlag(args, '--ready-file');
    const email = takeFlag(args, '--email', DEFAULT_DEV_SESSION_EMAIL);
    if (args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback auth dev-session [--ready-file <path>] [--email <address>] [--json]',
        { args },
      );
    }
    const mint = typeof options.mintDevSession === 'function'
      ? options.mintDevSession
      : mintDevSession;
    const result = await mint({
      ...(readyFile === null ? {} : { readyFile }),
      email,
      cwd: resolve(options.cwd ?? process.cwd()),
      env: options.env ?? process.env,
      runtimeBinary: options.runtimeBinary ?? null,
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`bearer=${result.bearer}`);
      console.log(`expiresAt=${result.expiresAt}`);
    }
    return 0;
  }
  if (command === 'author') {
    const subcommand = args.shift();
    if (subcommand === 'suggest') {
      const format = takeFlag(args, '--format');
      const target = args.shift();
      if (
        !target
        || args.length > 0
        || (json && format !== null)
        || (!json && format !== 'patch')
      ) {
        const failure = declarationSuggestionCliFailure(
          'usage: snapback author suggest <operation-or-file> <--format patch|--json>',
        );
        process.stdout.write(json ? `${JSON.stringify(failure, null, 2)}\n` : formatDeclarationSuggestionPatch(failure));
        return 1;
      }
      const resolvedTarget = resolveDeclarationSuggestionTarget(target, { cwd: options.cwd ?? process.cwd() });
      const result = resolvedTarget
        ? suggestDeclarations(resolvedTarget)
        : declarationSuggestionCliFailure(
          'operation targets require an existing definition file/path or an operation name from inside a backend directory',
          { target },
        );
      process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : formatDeclarationSuggestionPatch(result));
      return result.ok ? 0 : 1;
    }
    if (subcommand === 'suggestion' && args.shift() === 'apply') {
      const suggestionPath = args.shift();
      if (!json || !suggestionPath || args.length > 0) {
        const result = applyDeclarationSuggestion(null);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 1;
      }
      let input;
      try {
        input = readDeclarationSuggestionFile(suggestionPath, { cwd: options.cwd ?? process.cwd() });
      } catch {
        const result = applyDeclarationSuggestion(null);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 1;
      }
      const result = applyDeclarationSuggestion(input);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.ok ? 0 : 1;
    }
    const failure = declarationSuggestionCliFailure(
      'usage: snapback author suggest <operation-or-file> <--format patch|--json> | snapback author suggestion apply <suggestion.json> --json',
      { subcommand: subcommand ?? null },
    );
    process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
    return 1;
  }
  if (command === 'guide') {
    const lookup = lookupGuideReference(args, options);
    if (lookup !== null) {
      console.log(json ? JSON.stringify({
        schemaVersion: 'snapback.guide-search.v1',
        ok: true,
        query: lookup.query,
        slice: Number(takeFlag([...args], '--slice') ?? 1),
        mode: 'exact-symbol',
        count: 1,
        matches: [{ kind: lookup.match, query: lookup.query }],
        result: lookup,
      }, null, 2) : formatGuideReferenceLookup(lookup));
      return 0;
    }
  }
  if (command === 'doctor') {
    const result = await doctor(options);
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'runtime-qualify' && (args.includes('--persist') || args.includes('--verify'))) {
    const persist = takeBooleanFlag(args, '--persist');
    const verify = takeBooleanFlag(args, '--verify');
    const receiptPath = takeFlag(args, '--receipt');
    if (persist === verify || args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback runtime-qualify <--persist|--verify> [--receipt <path>] [--json]',
      );
    }
    const verdict = packagedRuntimeReadiness({
      ...options,
      verify,
      ...(receiptPath === null ? {} : { receiptPath }),
    });
    printResult(verdict, json);
    return verdict.ok ? 0 : 1;
  }
  if (command === 'reset' && args.includes('--dev-fresh')) {
    const usage = 'usage: snapback reset [<backend-dir>] --dev-fresh [--db <path>] [--ready-file <path>] [--email <address>] [--json]';
    takeBooleanFlag(args, '--dev-fresh');
    const readyFileFlag = takeFlag(args, '--ready-file');
    const databaseFlag = takeFlag(args, '--db');
    const email = takeFlag(args, '--email');
    if (args.some((argument) => argument.startsWith('-'))) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', usage);
    }
    const backendDirectory = args.shift() ?? 'snapback';
    if (args.length > 0) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', usage);
    }
    const backendRoot = resolve(backendDirectory);
    const projectRoot = dirname(backendRoot);
    const stateRoot = join(projectRoot, '.snapback');
    const readyFile = resolve(readyFileFlag ?? join(stateRoot, 'dev.ready.json'));
    const database = resolve(databaseFlag ?? join(stateRoot, 'dev.sqlite3'));
    validateManagedDatabaseResetTarget(database, stateRoot);
    const supervisorFile = join(dirname(readyFile), 'expo-supervisor.json');
    const staleSupervisorError = (cause = null) => {
      const error = diagnosticError(
        'SNAPBACK_RESET_SUPERVISOR_STALE',
        'the Expo supervisor discovery descriptor is stale; remove it and rerun standalone, or restart the supervisor',
        {
          descriptorFile: supervisorFile,
          recovery: {
            standalone: `remove ${supervisorFile} and rerun snapback reset --dev-fresh`,
            supervised: 'restart snapback dev --expo and rerun the reset',
          },
        },
      );
      if (cause !== null) error.cause = cause;
      return error;
    };

    if (existsSync(supervisorFile)) {
      const {
        SUPERVISED_CONTROL_PATH,
        SUPERVISED_EXCHANGE_FORMAT,
        SUPERVISED_EXCHANGE_PATH,
      } = await import('./expo-dev.mjs');
      let supervisor;
      try {
        const metadata = lstatSync(supervisorFile);
        if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
          throw new TypeError('Expo supervisor discovery descriptor is not owner-only');
        }
        supervisor = JSON.parse(readFileSync(supervisorFile, 'utf8'));
        const exchange = new URL(supervisor?.exchangeOrigin);
        const exchangeHost = exchange.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
        if (
          supervisor?.formatVersion !== 1
          || typeof supervisor?.exchangeOrigin !== 'string'
          || supervisor.controlPath !== SUPERVISED_CONTROL_PATH
          || exchange.protocol !== 'http:'
          || exchange.origin !== supervisor.exchangeOrigin
          || !(
            exchangeHost === '::1'
            || exchangeHost === 'localhost'
            || exchangeHost.startsWith('127.')
          )
        ) throw new TypeError('invalid Expo supervisor discovery descriptor');
      } catch (error) {
        throw staleSupervisorError(error);
      }
      try {
        const probe = await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`, {
          redirect: 'error',
          signal: AbortSignal.timeout(1_500),
        });
        const payload = await probe.json();
        if (
          probe.status !== 200
          || payload?.format !== SUPERVISED_EXCHANGE_FORMAT
          || payload?.correlationId !== supervisor.correlationId
        ) throw new TypeError('Expo supervisor discovery probe did not match the descriptor');
      } catch (error) {
        throw staleSupervisorError(error);
      }
      let operatorToken = managedAdminToken(
        readReadyDescriptor(readyFile),
        database,
      );
      let response;
      try {
        response = await fetch(`${supervisor.exchangeOrigin}${supervisor.controlPath}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-snapback-operator-token': operatorToken,
          },
          body: JSON.stringify({ verb: 'dev-fresh' }),
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        throw staleSupervisorError(error);
      } finally {
        operatorToken = null;
      }
      let report;
      try {
        report = await response.json();
      } catch (cause) {
        const error = diagnosticError(
          'SNAPBACK_RESET_SUPERVISOR_RESPONSE_INVALID',
          'the Expo supervisor control route did not return a JSON readiness report',
          { status: response.status, descriptorFile: supervisorFile },
        );
        error.cause = cause;
        throw error;
      }
      printResult(report, json);
      return report?.ok === true ? 0 : 1;
    }

    if (existsSync(readyFile)) {
      try {
        const descriptor = validateDevTarget(readReadyDescriptor(readyFile), {
          readyFile,
          database,
        });
        await validateReadyDescriptorHealth(descriptor);
        throw diagnosticError(
          'SNAPBACK_RESET_DEV_LOOP_ACTIVE',
          'a live dev loop owns this target; use its dev-fresh control verb, or stop it before rerunning',
          {
            readyFile,
            recovery: {
              tty: 'press f in the dev loop terminal',
              json: '{"schemaVersion":"snapback.dev-command.v1","verb":"dev-fresh"}',
              standalone: 'stop the dev loop and rerun snapback reset --dev-fresh',
            },
          },
        );
      } catch (error) {
        if (error?.code === 'SNAPBACK_RESET_DEV_LOOP_ACTIVE') throw error;
        // A descriptor naming a different database is another target's live
        // discovery file, not stale residue of this one — refuse rather than
        // deleting it out from under its owner.
        if (error?.code === 'SNAPBACK_DEV_SERVER_TARGET_MISMATCH') throw error;
        rmSync(readyFile, { force: true });
      }
    }

    removeManagedDatabaseState(database, readyFile, null, stateRoot);
    let dev = null;
    let failedResult = null;
    let report = null;
    try {
      dev = await runDev({
        ...options,
        backendDirectory: backendRoot,
        projectRoot,
        readyFile,
        database,
        watch: false,
        serverStdio: ['ignore', 'ignore', 'ignore'],
        onEvent(event) { console.log(JSON.stringify(event)); },
      });
      if (dev.ok === false) {
        failedResult = dev;
      } else {
        const generatedRoot = join(backendRoot, 'generated');
        const schemaManifest = JSON.parse(readFileSync(
          resolveGeneratedArtifact(generatedRoot, 'schema.manifest.json'),
          'utf8',
        ));
        const authMode = schemaManifest?.auth?.mode ?? 'dev';
        if (authMode === 'sessions') {
          const { mintSupervisedOrdinarySession } = await import('./expo-dev.mjs');
          let operatorToken = managedAdminToken(readReadyDescriptor(readyFile), database);
          let authority;
          try {
            authority = mintSupervisedOrdinarySession({
              runtimeBinary: dev.runtime.binary,
              readyFile,
              email: email ?? 'snapback-dev@localhost.invalid',
              operatorToken,
              cwd: projectRoot,
              env: options.env,
            });
          } finally {
            operatorToken = null;
          }
          if (authority.status !== 'ready') {
            const refusal = new Error(authority.diagnostic.message);
            refusal.code = authority.diagnostic.code;
            refusal.diagnostic = authority.diagnostic;
            throw refusal;
          }
        }
        const seedDeclared = existsSync(join(generatedRoot, 'seed.artifact.json'))
          || existsSync(join(backendRoot, 'seed.json'));
        report = {
          schemaVersion: 'snapback.reset-dev-fresh.v1',
          ok: true,
          mode: 'standalone',
          backend: backendRoot,
          readyFile,
          database: 'fresh',
          seed: seedDeclared ? 'applied' : 'no-seed-declared',
          authority: authMode === 'sessions' ? 'verified' : 'dev-mode',
          server: 'stopped',
        };
      }
    } finally {
      await dev?.close?.();
      rmSync(readyFile, { force: true });
    }
    if (failedResult !== null) {
      printResult(failedResult, json);
      return 1;
    }
    printResult(report, json);
    return 0;
  }
  if (command === 'accept') {
    const subcommand = args.shift();
    if (subcommand !== 'comparator') {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback accept comparator --config <profile.mjs> [--receipt <receipt.json>] [--timeout-ms <ms>] [--json]',
      );
    }
    const verifyReceipt = takeFlag(args, '--verify-receipt');
    const maxAgeRaw = takeFlag(args, '--max-age-ms');
    if (verifyReceipt !== null) {
      if (args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback accept comparator --verify-receipt <receipt.json> [--max-age-ms <ms>] [--json]',
        );
      }
      const maxAgeMs = maxAgeRaw === null ? null : Number(maxAgeRaw);
      if (maxAgeMs !== null && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0)) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--max-age-ms must be a non-negative integer',
        );
      }
      const verified = readComparatorReceipt(verifyReceipt, { maxAgeMs });
      const result = {
        schemaVersion: 'snapback.comparator-verification.v1',
        ok: verified.status === 'passed',
        profileId: verified.profileId,
        receiptSchemaVersion: verified.schemaVersion,
        status: verified.status,
        exitCode: verified.exitCode,
        checks: verified.checks,
        capabilityGaps: verified.capabilityGaps,
        cleanup: verified.cleanup,
        diagnostic: verified.diagnostic,
        identity: verified.identity,
        finishedAtMs: verified.finishedAtMs,
      };
      printResult(result, json);
      return verified.exitCode;
    }
    const config = takeFlag(args, '--config');
    const receiptFile = takeFlag(args, '--receipt');
    const timeoutRaw = takeFlag(args, '--timeout-ms');
    if (!config || maxAgeRaw !== null || args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback accept comparator --config <profile.mjs> [--receipt <receipt.json>] [--timeout-ms <ms>] [--json]',
      );
    }
    const timeoutMs = timeoutRaw === null ? 15_000 : Number(timeoutRaw);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        '--timeout-ms must be a positive integer',
      );
    }
    const profile = await loadComparatorProfile(config);
    const result = await runComparatorAcceptance(profile, {
      timeoutMs,
      receiptFile,
      ...(options.comparatorStartTarget
        ? { startTarget: options.comparatorStartTarget }
        : {}),
    });
    printResult(result, json);
    return result.exitCode;
  }
  if (command === 'verify') {
    const configPath = takeFlag(args, '--config');
    const receiptPath = takeFlag(args, '--receipt');
    const runtimeReceiptPath = takeFlag(args, '--runtime-receipt');
    const runtimeBinary = takeFlag(args, '--runtime-binary');
    const timeoutRaw = takeFlag(args, '--timeout-ms')
      ?? (options.env ?? process.env).SNAPBACK_VERIFY_PROFILE_TIMEOUT
      ?? null;
    const backendDirectory = args.shift() ?? null;
    if (args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback verify [<backend-dir>] [--config <verify.config.mjs>] [--receipt <receipt.json>] [--runtime-binary <path>] [--runtime-receipt <path>] [--timeout-ms <ms>] [--json]',
      );
    }
    const profileTimeoutMs = timeoutRaw === null ? null : Number(timeoutRaw);
    if (profileTimeoutMs !== null && (!Number.isSafeInteger(profileTimeoutMs) || profileTimeoutMs < 1)) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback verify [<backend-dir>] [--timeout-ms <positive-ms>]',
        { environment: 'SNAPBACK_VERIFY_PROFILE_TIMEOUT' },
      );
    }
    const conventionalConfig = configPath === null ? discoverVerifyConfig() : null;
    const config = configPath !== null || conventionalConfig !== null
      ? await loadVerifyConfig(configPath ?? conventionalConfig, { backendDirectory })
      : defaultVerifyConfig({ backendDirectory: backendDirectory ?? 'snapback' });
    const result = await runVerify(config, {
      ...options.verifyOptions,
      ...(profileTimeoutMs === null ? {} : { profileTimeoutMs }),
      runtimeProbe() {
        const verdict = packagedRuntimeReadiness({
          ...options,
          verify: true,
          acquire: true,
          ...(runtimeBinary === null ? {} : { runtimeBinary }),
          ...(runtimeReceiptPath === null ? {} : { receiptPath: runtimeReceiptPath }),
        });
        return {
          ok: verdict.ok,
          receipt: verdict.ok ? {
            receiptPath: verdict.receiptPath,
            receipt: verdict.receipt,
            ...(verdict.acquired === undefined ? {} : { acquiredBecause: verdict.acquired }),
          } : null,
          diagnostics: verdict.ok || verdict.diagnostic === null ? [] : [verdict.diagnostic],
        };
      },
    });
    if (receiptPath !== null) writeVerifyReceipt(receiptPath, result);
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'init') {
    const install = takeBooleanFlag(args, '--install');
    if (args.length > 0) {
      const usage = PACKAGED_CLI_COMMAND_BY_NAME.get('init').usage;
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `usage: ${usage}`,
      );
    }
    const result = initApp(options.cwd ?? process.cwd(), { ...options, install });
    printResult(result, json);
    return 0;
  }
  if (command === 'new') {
    const target = args.shift();
    if (!target) throw diagnosticError('SNAPBACK_NEW_NAME_REQUIRED', `usage: snapback new <name> [--template ${listTemplates().join('|')}]`);
    const template = takeFlag(args, '--template', 'todo-contract');
    const result = scaffoldApp(target, { template });
    printResult(result, json);
    return 0;
  }
  if (command === 'generate') {
    const targetProfile = takeFlag(args, '--target-profile', 'local-dev-sqlite-ibex');
    const check = takeBooleanFlag(args, '--check');
    const backendDirectory = args.shift() ?? 'snapback';
    if (args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback generate [<backend-dir>] [--target-profile <id>] [--check] [--json]',
      );
    }
    const result = await generateApp(backendDirectory, {
      targetProfile,
      appBindingMode: 'development',
      check,
    });
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'replay') {
    const actions = takeFlag(args, '--actions');
    const apiFlag = takeFlag(args, '--api');
    const readyFileFlag = takeFlag(args, '--ready-file');
    const receiptsFlag = takeFlag(args, '--receipts');
    const custody = takeFlag(args, '--custody', 'minted');
    const statusFileFlag = takeFlag(args, '--status-file');
    const resume = takeBooleanFlag(args, '--resume');
    const detach = takeBooleanFlag(args, '--detach');
    const statusOnly = takeBooleanFlag(args, '--status');
    if (args.some((argument) => argument.startsWith('-'))) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `usage: ${PACKAGED_CLI_COMMAND_BY_NAME.get('replay').usage}`,
        { args },
      );
    }
    const cliCwd = options.cwd ?? process.cwd();
    const backendDirectory = resolve(cliCwd, args.shift() ?? 'snapback');
    if (args.length > 0 || !['minted', 'none'].includes(custody)) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `usage: ${PACKAGED_CLI_COMMAND_BY_NAME.get('replay').usage}`,
        { args, custody },
      );
    }
    const projectRoot = dirname(backendDirectory);
    const statusFile = resolve(cliCwd, statusFileFlag ?? join(projectRoot, '.snapback', 'replay-status.json'));
    if (statusOnly) {
      if (actions !== null || apiFlag !== null || receiptsFlag !== null || resume || detach) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'snapback replay --status accepts only [<backend-dir>] [--status-file <path>] [--json]',
        );
      }
      const status = readReplayStatus(statusFile);
      if (json) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`${status.state}: ${status.settled}/${status.total ?? '?'} settled (pid ${status.pid})`);
        if (status.recovery) console.log(`Recovery: ${status.recovery}`);
      }
      return ['failed', 'dead'].includes(status.state) ? 1 : 0;
    }
    if (actions === null) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `usage: ${PACKAGED_CLI_COMMAND_BY_NAME.get('replay').usage}`,
      );
    }
    const definition = defineReplay({
      readyFile: resolve(cliCwd, readyFileFlag ?? join(projectRoot, '.snapback', 'dev.ready.json')),
      api: resolve(cliCwd, apiFlag ?? join(backendDirectory, 'generated', 'api.mjs')),
      actions: resolve(cliCwd, actions),
      actors: { mint: {} },
      transportCustody: custody,
      receiptsFile: resolve(cliCwd, receiptsFlag ?? join(projectRoot, '.snapback', 'replay-receipts.jsonl')),
      statusFile,
    });
    const result = await runReplay(definition, {
      resume,
      detach,
      ...(json || detach ? {} : {
        onPreflight(report) {
          console.log('Replay ceilings:');
          for (const ceiling of report.ceilings) console.log(`  ${ceiling.code}: ${JSON.stringify(ceiling)}`);
        },
      }),
    });
    if (json) console.log(JSON.stringify(result.receipt, null, 2));
    else if (result.receipt.status === 'detached') {
      console.log(`Replay detached as pid ${result.receipt.pid}; status: ${result.receipt.statusFile}`);
    } else {
      console.log(`Replay ${result.receipt.status}: ${result.receipt.actions?.settled ?? 0}/${result.receipt.actions?.total ?? '?'} settled`);
      if (result.receipt.diagnostic) console.error(JSON.stringify(result.receipt.diagnostic, null, 2));
    }
    return result.exitCode;
  }
  // @ref LLP 0151#setup-and-status — the provider setup verbs are package-owned
  // because they edit app source and read generated artifacts. Every other
  // `snapback auth` verb (export, import, backup, restore, rehearse, password,
  // recovery) keeps delegating to the native binary untouched.
  if (command === 'auth' && ['enable', 'configure', 'status'].includes(args[0])) {
    const subcommand = args.shift();
    const { runAuthConfigure, runAuthEnable, runAuthStatus, AUTH_SETUP_PROVIDERS } =
      await import('./auth-setup.mjs');
    const backendFlag = takeFlag(args, '--backend-dir');
    if (subcommand === 'enable') {
      const providers = [];
      while (args.length > 0 && !args[0].startsWith('--')) providers.push(args.shift());
      if (args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          `usage: snapback auth enable <${AUTH_SETUP_PROVIDERS.join('|')}>... [--backend-dir <dir>] [--json]`,
        );
      }
      const result = runAuthEnable({
        ...(backendFlag === null ? {} : { backendDirectory: backendFlag }),
        providers,
        cwd: options.cwd ?? process.cwd(),
      });
      printResult(result, json);
      return 0;
    }
    if (subcommand === 'configure') {
      const provider = args.shift();
      const identifierNames = [
        'servicesId', 'teamId', 'keyId', 'bundleIdentifier',
        'iosClientId', 'androidClientId', 'webClientId',
      ];
      const identifiers = {};
      for (const name of identifierNames) {
        const value = takeFlag(args, `--${name}`);
        if (value !== null) identifiers[name] = value;
      }
      const appScheme = takeFlag(args, '--app-scheme');
      const bundleIdentifier = takeFlag(args, '--bundle-identifier') ?? identifiers.bundleIdentifier ?? null;
      const returnUrl = takeFlag(args, '--return-url');
      if (args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          `usage: snapback auth configure <${AUTH_SETUP_PROVIDERS.join('|')}> [--<identifier> <value>...] [--app-scheme <scheme>] [--return-url <url>] [--backend-dir <dir>] [--json]`,
        );
      }
      const result = runAuthConfigure({
        ...(backendFlag === null ? {} : { backendDirectory: backendFlag }),
        provider,
        identifiers,
        appScheme,
        bundleIdentifier,
        returnUrl,
        cwd: options.cwd ?? process.cwd(),
      });
      printResult(result, json);
      return 0;
    }
    const deployment = takeFlag(args, '--deployment') ?? 'development';
    const platform = takeFlag(args, '--platform') ?? 'ios';
    const sharedAvailable = takeBooleanFlag(args, '--shared-available');
    if (args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback auth status [--deployment <profile>] [--platform ios|android|web] [--shared-available] [--backend-dir <dir>] [--json]',
      );
    }
    const result = runAuthStatus({
      ...(backendFlag === null ? {} : { backendDirectory: backendFlag }),
      deployment,
      platform,
      sharedAvailable,
      cwd: options.cwd ?? process.cwd(),
    });
    printResult(result, json);
    return 0;
  }
  if (command === 'hosted') {
    const subcommand = args.shift();
    if (subcommand === '--help' || subcommand === 'help' || subcommand === undefined) {
      const result = createHostedPlan();
      if (json) printResult(result, true);
      else {
        console.log('usage: snapback hosted <plan|inspect|logs|operator-request|lifecycle> ...');
        console.log(`lifecycle verbs: ${Object.keys(result.commands
          .filter(({ kind }) => kind === 'lifecycle')
          .reduce((verbs, { command }) => ({ ...verbs, [command.replace(/^lifecycle /, '')]: true }), {}))
          .join(', ')}`);
      }
      return 0;
    }
    if (subcommand === 'plan') {
      const targetId = takeFlag(args, '--target');
      const controlRoot = takeFlag(args, '--control-root');
      if (args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback hosted plan [--target <id>] [--control-root <dir>] [--json]',
        );
      }
      const result = createHostedPlan({
        targetId,
        controlRoot: controlRoot ?? undefined,
        ...options,
      });
      printResult(result, json);
      return 0;
    }
    if (subcommand === 'operator-request') {
      const requestPath = takeFlag(args, '--request');
      const endpoint = takeFlag(args, '--supervisor');
      const clientKeyPath = takeFlag(args, '--client-key');
      const clientCertificatePath = takeFlag(args, '--client-cert');
      const serverCaPath = takeFlag(args, '--server-ca');
      const rootPublicKeyPath = takeFlag(args, '--root-public-key');
      const serverCertificateSha256 = takeFlag(args, '--server-certificate-sha256');
      if (
        !requestPath
        || !endpoint
        || !clientKeyPath
        || !clientCertificatePath
        || !serverCaPath
        || !rootPublicKeyPath
        || !serverCertificateSha256
        || args.length > 0
      ) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback hosted operator-request --request <supervisor-request-v1.json> --supervisor <https-origin> --client-key <mode-0600.pem> --client-cert <pem> --server-ca <pem> --root-public-key <pem> --server-certificate-sha256 <sha256:...> [--json]',
        );
      }
      const result = await submitHostedOperatorRequest({
        requestPath,
        endpoint,
        clientKeyPath,
        clientCertificatePath,
        serverCaPath,
        rootPublicKeyPath,
        serverCertificateSha256,
      });
      printResult(result, json);
      return result.body?.ok ? 0 : 2;
    }
    if (subcommand === 'inspect' || subcommand === 'logs') {
      const targetId = takeFlag(args, '--target');
      const controlRoot = takeFlag(args, '--control-root');
      const sinceRaw = takeFlag(args, '--since-ms');
      const untilRaw = takeFlag(args, '--until-ms');
      const limitRaw = takeFlag(args, '--limit');
      const cursor = takeFlag(args, '--cursor');
      if (!targetId || args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          `usage: snapback hosted ${subcommand} --target <id> [--since-ms <ms>] [--until-ms <ms>] [--limit <n>] [--cursor <opaque>] [--control-root <dir>] [--json]`,
        );
      }
      const result = runHostedRead(subcommand, {
        targetId,
        controlRoot: controlRoot ?? undefined,
        ...(sinceRaw === null ? {} : { sinceMs: Number(sinceRaw) }),
        ...(untilRaw === null ? {} : { untilMs: Number(untilRaw) }),
        ...(limitRaw === null ? {} : { limit: Number(limitRaw) }),
        ...(cursor === null ? {} : { cursor }),
        ...options,
      });
      printResult(result, json);
      return result.ok ? 0 : 1;
    }
    if (subcommand === 'lifecycle') {
      const verb = args.shift();
      const requestPath = takeFlag(args, '--request');
      const operatorRequestPath = takeFlag(args, '--operator-request');
      const endpoint = takeFlag(args, '--supervisor');
      const clientKeyPath = takeFlag(args, '--client-key');
      const clientCertificatePath = takeFlag(args, '--client-cert');
      const serverCaPath = takeFlag(args, '--server-ca');
      const rootPublicKeyPath = takeFlag(args, '--root-public-key');
      const serverCertificateSha256 = takeFlag(args, '--server-certificate-sha256');
      if (!verb || !requestPath || args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback hosted lifecycle <closed-verb> --request <lifecycle-v2.json> --operator-request <supervisor-request-v1.json> --supervisor <https-origin> --client-key <mode-0600.pem> --client-cert <pem> --server-ca <pem> --root-public-key <pem> --server-certificate-sha256 <sha256:...> [--json]',
        );
      }
      const result = await invokeHostedLifecycle(verb, {
        requestPath,
        operatorRequestPath,
        endpoint,
        clientKeyPath,
        clientCertificatePath,
        serverCaPath,
        rootPublicKeyPath,
        serverCertificateSha256,
        ...options,
      });
      printResult(result, json);
      return result.ok ? 0 : 2;
    }
    throw diagnosticError(
      'SNAPBACK_HOSTED_COMMAND_UNKNOWN',
      'usage: snapback hosted <plan|inspect|logs|operator-request|lifecycle> ...',
      { subcommand },
    );
  }
  if (command === 'target') {
    const subcommand = args.shift();
    const controlRoot = takeFlag(args, '--control-root');
    if (subcommand === 'add') {
      const descriptor = takeFlag(args, '--descriptor');
      if (!descriptor || args.length > 0) {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback target add --descriptor <target.json> [--control-root <dir>]');
      }
      const result = addTarget(descriptor, { controlRoot: controlRoot ?? undefined });
      if (json) printResult(result, true);
      else console.log(JSON.stringify(result, null, 2));
      return result.ok === false ? 1 : 0;
    }
    const targetId = args.shift();
    if (!targetId || args.length > 0 || !['show', 'doctor', 'inspect'].includes(subcommand)) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback target <show|doctor|inspect> <target-id> [--control-root <dir>]');
    }
    const targetOptions = { controlRoot: controlRoot ?? undefined, ...options };
    const result = subcommand === 'show'
      ? showTarget(targetId, targetOptions)
      : subcommand === 'doctor'
        ? doctorTarget(targetId, targetOptions)
        : inspectTarget(targetId, targetOptions);
    if (json) printResult(result, true);
    else console.log(JSON.stringify(result, null, 2));
    return result.ok === false ? 1 : 0;
  }
  if (command === 'logs' || command === 'inspect') {
    const targetId = takeFlag(args, '--target');
    const controlRoot = takeFlag(args, '--control-root');
    const sinceRaw = takeFlag(args, '--since-ms');
    const untilRaw = takeFlag(args, '--until-ms');
    const limitRaw = takeFlag(args, '--limit');
    const cursor = takeFlag(args, '--cursor');
    if (!targetId || args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `usage: snapback ${command} --target <id> [--since-ms <ms>] [--until-ms <ms>] [--limit <n>] [--cursor <opaque>] [--control-root <dir>]`,
      );
    }
    const queryOptions = {
      targetId,
      controlRoot: controlRoot ?? undefined,
      ...(sinceRaw === null ? {} : { sinceMs: Number(sinceRaw) }),
      ...(untilRaw === null ? {} : { untilMs: Number(untilRaw) }),
      ...(limitRaw === null ? {} : { limit: Number(limitRaw) }),
      ...(cursor === null ? {} : { cursor }),
      ...options,
    };
    const result = command === 'logs'
      ? queryControlLogs(targetId, queryOptions)
      : inspectTargetAdmin(targetId, queryOptions);
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'audit') {
    const subcommand = args.shift();
    const controlRoot = takeFlag(args, '--control-root');
    if (subcommand !== 'verify' || args.length > 0) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback audit verify [--control-root <dir>]');
    }
    const result = verifyControlAuditLedger({ controlRoot: controlRoot ?? undefined, ...options });
    printResult(result, json);
    return result.ok ? 0 : 1;
  }
  if (command === 'restore') {
    const subcommand = args.shift();
    const controlRoot = takeFlag(args, '--control-root');
    const targetId = takeFlag(args, '--target');
    let result;
    if (subcommand === 'plan') {
      const sourceTargetId = takeFlag(args, '--source-target');
      const reason = takeFlag(args, '--reason');
      const operationId = takeFlag(args, '--operation-id');
      const replacementReleaseId = takeFlag(args, '--replace-release');
      const destinationSentinelSha256 = takeFlag(args, '--destination-sentinel');
      const backupId = args.shift();
      if (!backupId || !sourceTargetId || !targetId || !reason || args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback restore plan <backup-id> --source-target <id> --target <destination-id> --reason <text> [--replace-release <id> --destination-sentinel <sha256>] [--operation-id <id>] [--control-root <dir>]',
        );
      }
      result = createRestorePlan({
        sourceTargetId,
        destinationTargetId: targetId,
        backupId,
        reason,
        operationId: operationId ?? undefined,
        replacementReleaseId: replacementReleaseId ?? undefined,
        destinationSentinelSha256: destinationSentinelSha256 ?? undefined,
        controlRoot: controlRoot ?? undefined,
        ...options,
      });
    } else if (subcommand === 'apply') {
      const confirmation = takeFlag(args, '--confirm');
      const planId = args.shift();
      if (!planId || !targetId || !confirmation || args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback restore apply <plan-id> --target <destination-id> --confirm <token> [--control-root <dir>]',
        );
      }
      result = applyRestorePlan(planId, {
        targetId,
        confirmation,
        controlRoot: controlRoot ?? undefined,
        ...options,
      });
    } else if (subcommand === 'verify') {
      const receiptId = args.shift();
      if (!receiptId || !targetId || args.length > 0) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'usage: snapback restore verify <receipt-id> --target <destination-id> [--control-root <dir>]',
        );
      }
      result = verifyRestoreReceipt(receiptId, {
        targetId,
        controlRoot: controlRoot ?? undefined,
        ...options,
      });
    } else if (subcommand === 'activate') {
      const mode = args.shift();
      if (mode === 'plan') {
        const reason = takeFlag(args, '--reason');
        const operationId = takeFlag(args, '--operation-id');
        const releaseDirectory = takeFlag(args, '--release');
        const preparedReleasePath = takeFlag(args, '--prepared-release');
        const qualificationPath = takeFlag(args, '--adapter-qualification');
        const receiptId = args.shift();
        if (!receiptId || !targetId || !reason || !releaseDirectory
            || !preparedReleasePath || !qualificationPath || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback restore activate plan <restore-receipt-id> --target <destination-id> --release <restored-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --reason <text> [--operation-id <id>] [--control-root <dir>]',
          );
        }
        result = createRestoreActivationPlan({
          restoreReceiptId: receiptId,
          targetId,
          reason,
          operationId: operationId ?? undefined,
          releaseDirectory,
          preparedReleasePath,
          qualificationPath,
          verifyRelease,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else if (mode === 'apply') {
        const confirmation = takeFlag(args, '--confirm');
        const releaseDirectory = takeFlag(args, '--release');
        const preparedReleasePath = takeFlag(args, '--prepared-release');
        const qualificationPath = takeFlag(args, '--adapter-qualification');
        const planId = args.shift();
        if (!planId || !targetId || !confirmation || !releaseDirectory
            || !preparedReleasePath || !qualificationPath || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback restore activate apply <plan-id> --target <destination-id> --release <restored-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>]',
          );
        }
        result = applyRestoreActivationPlan(planId, {
          targetId,
          confirmation,
          releaseDirectory,
          preparedReleasePath,
          qualificationPath,
          verifyRelease,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback restore activate <plan|apply> ...');
      }
    } else {
      throw diagnosticError(
        'SNAPBACK_RESTORE_SUBCOMMAND_UNIMPLEMENTED',
        'usage: snapback restore <plan|apply|verify|activate> ...',
        { subcommand: subcommand ?? null },
      );
    }
    printResult(result, json);
    return result.applyEligible === false ? 2 : (result.ok === false ? 1 : 0);
  }
  if (command === 'backup') {
    const subcommand = args.shift();
    const targetId = takeFlag(args, '--target');
    const controlRoot = takeFlag(args, '--control-root');
    if (!targetId) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback backup <create|list|verify> ... --target <id> [--control-root <dir>]');
    }
    let result;
    if (subcommand === 'create') {
      const mode = args.shift();
      if (mode === 'plan') {
        const reason = takeFlag(args, '--reason');
        const retentionPolicy = takeFlag(args, '--retention-policy');
        const operationId = takeFlag(args, '--operation-id');
        if (!reason || !retentionPolicy || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback backup create plan --target <id> --reason <text> --retention-policy <policy> [--operation-id <id>] [--control-root <dir>]',
          );
        }
        result = createBackupPlan({
          targetId,
          reason,
          retentionPolicy,
          operationId: operationId ?? undefined,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else if (mode === 'apply') {
        const confirmation = takeFlag(args, '--confirm');
        const planId = args.shift();
        if (!planId || !confirmation || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback backup create apply <plan-id> --target <id> --confirm <token> [--control-root <dir>]',
          );
        }
        result = applyBackupPlan(planId, {
          targetId,
          confirmation,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback backup create <plan|apply> ...');
      }
    } else if (subcommand === 'list' && args.length === 0) {
      result = listBackups(targetId, { controlRoot: controlRoot ?? undefined, ...options });
    } else if (subcommand === 'verify') {
      const backupId = args.shift();
      if (!backupId || args.length > 0) {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback backup verify <backup-id> --target <id> [--control-root <dir>]');
      }
      result = verifyBackupManifest(backupId, targetId, { controlRoot: controlRoot ?? undefined, ...options });
    } else {
      throw diagnosticError('SNAPBACK_BACKUP_SUBCOMMAND_UNIMPLEMENTED', 'usage: snapback backup <create|list|verify> ...', { subcommand: subcommand ?? null });
    }
    if (json) printResult(result, true);
    else console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }
  if (command === 'deploy') {
    const subcommand = args.shift();
    if (subcommand === 'rollback') {
      const mode = args.shift();
      const targetId = takeFlag(args, '--target');
      const controlRoot = takeFlag(args, '--control-root');
      const releaseDirectory = takeFlag(args, '--release');
      const preparedReleasePath = takeFlag(args, '--prepared-release');
      const qualificationPath = takeFlag(args, '--adapter-qualification');
      let result;
      if (mode === 'plan') {
        const reason = takeFlag(args, '--reason');
        const operationId = takeFlag(args, '--operation-id');
        if (!targetId || !releaseDirectory || !preparedReleasePath || !qualificationPath || !reason || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback deploy rollback plan --target <id> --release <destination-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --reason <text> [--operation-id <id>] [--control-root <dir>]',
          );
        }
        result = createRollbackPlan({
          targetId,
          destinationReleaseDirectory: releaseDirectory,
          preparedReleasePath,
          qualificationPath,
          reason,
          operationId: operationId ?? undefined,
          verifyRelease,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else if (mode === 'apply') {
        const confirmation = takeFlag(args, '--confirm');
        const planId = args.shift();
        if (!planId || !targetId || !releaseDirectory || !preparedReleasePath || !qualificationPath || !confirmation || args.length > 0) {
          throw diagnosticError(
            'SNAPBACK_CLI_ARGUMENT_INVALID',
            'usage: snapback deploy rollback apply <plan-id> --target <id> --release <destination-release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>]',
          );
        }
        result = applyRollbackPlan(planId, {
          targetId,
          destinationReleaseDirectory: releaseDirectory,
          preparedReleasePath,
          qualificationPath,
          confirmation,
          verifyRelease,
          controlRoot: controlRoot ?? undefined,
          ...options,
        });
      } else {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback deploy rollback <plan|apply> ...');
      }
      printResult(result, json);
      return result.applyEligible === false ? 2 : (result.ok === false ? 1 : 0);
    }
    if (subcommand === 'status') {
      const targetId = takeFlag(args, '--target');
      const controlRoot = takeFlag(args, '--control-root');
      if (!targetId || args.length > 0) {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback deploy status --target <id> [--control-root <dir>]');
      }
      const result = inspectTarget(targetId, { controlRoot: controlRoot ?? undefined, ...options });
      if (json) printResult(result, true);
      else console.log(JSON.stringify(result, null, 2));
      return result.ok === false ? 1 : 0;
    }
    if (subcommand === 'apply') {
      const targetId = takeFlag(args, '--target');
      const confirmation = takeFlag(args, '--confirm');
      const releaseDirectory = takeFlag(args, '--release');
      const preparedReleasePath = takeFlag(args, '--prepared-release');
      const qualificationPath = takeFlag(args, '--adapter-qualification');
      const controlRoot = takeFlag(args, '--control-root');
      const planId = args.shift();
      if (!planId || !targetId || !confirmation || !releaseDirectory || args.length > 0) {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback deploy apply <plan-id> --target <id> --release <release-dir> --prepared-release <manifest> --adapter-qualification <manifest> --confirm <token> [--control-root <dir>]');
      }
      const result = applyDeployPlan(planId, {
        targetId,
        confirmation,
        releaseDirectory,
        preparedReleasePath: preparedReleasePath ?? undefined,
        qualificationPath: qualificationPath ?? undefined,
        verifyRelease,
        controlRoot: controlRoot ?? undefined,
        ...options,
      });
      printResult(result, json);
      return result.ok === false ? 1 : 0;
    }
    if (subcommand === 'plan') {
      const targetId = takeFlag(args, '--target');
      const reason = takeFlag(args, '--reason');
      const controlRoot = takeFlag(args, '--control-root');
      const operationId = takeFlag(args, '--operation-id');
      const preparedReleasePath = takeFlag(args, '--prepared-release');
      const qualificationPath = takeFlag(args, '--adapter-qualification');
      const releaseDirectory = args.shift();
      if (!releaseDirectory || !targetId || !reason || args.length > 0) {
        throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'usage: snapback deploy plan <release-dir> --target <id> --reason <text> [--operation-id <id>] [--control-root <dir>]');
      }
      const result = createDeployPlan({
        releaseDirectory,
        targetId,
        reason,
        verifyRelease,
        controlRoot: controlRoot ?? undefined,
        operationId: operationId ?? undefined,
        preparedReleasePath: preparedReleasePath ?? undefined,
        qualificationPath: qualificationPath ?? undefined,
        ...options,
      });
      printResult(result, json);
      return result.applyEligible ? 0 : 2;
    }
    if (subcommand !== 'build') {
      throw diagnosticError(
        'SNAPBACK_DEPLOY_SUBCOMMAND_UNIMPLEMENTED',
        'usage: snapback deploy <build|plan|apply|status|rollback> ...',
        { subcommand: subcommand ?? null },
      );
    }
    const targetProfile = takeFlag(args, '--target-profile', 'local-dev-sqlite-ibex');
    const outputDirectory = takeFlag(args, '--output');
    const webDirectory = takeFlag(args, '--web-dist');
    const runtimeArtifactDirectory = takeFlag(args, '--runtime-artifact');
    const runtimePlatform = takeFlag(args, '--runtime-platform');
    const hermesBundleIdentity = takeFlag(args, '--runtime-hermes-bundle');
    const allowDirty = takeBooleanFlag(args, '--allow-dirty');
    const backendDirectory = args[0]?.startsWith('--') ? 'snapback' : (args.shift() ?? 'snapback');
    if (args.length > 0) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', 'deploy build received unknown arguments', { args });
    }
    const result = await buildRelease({
      backendDirectory,
      targetProfile,
      allowDirty,
      ...(outputDirectory ? { outputDirectory } : {}),
      ...(webDirectory ? { webDirectory } : {}),
      ...(runtimeArtifactDirectory ? { runtimeArtifactDirectory } : {}),
      ...(runtimePlatform ? { runtimePlatform } : {}),
      ...(hermesBundleIdentity ? { hermesBundleIdentity } : {}),
      ...options,
    });
    printResult(result, json);
    return 0;
  }
  if (command === 'dev') {
    const attach = args.includes('--attach');
    if (attach) args.splice(args.indexOf('--attach'), 1);
    const noWatch = args.includes('--no-watch');
    if (noWatch) args.splice(args.indexOf('--no-watch'), 1);
    const readyFile = takeFlag(args, '--ready-file');
    const applicationReadyFile = takeFlag(args, '--application-ready-file');
    const database = takeFlag(args, '--db');
    const writeEnvFile = takeOptionalValueFlag(args, '--write-env', '.env.local');
    const port = takeFlag(args, '--port');
    const clientPort = takeFlag(args, '--client-port');
    const bootstrapPort = takeFlag(args, '--bootstrap-port');
    const portRange = takeFlag(args, '--port-range');
    const externalClientOrigin = takeFlag(args, '--external-client-origin');
    const clientDirectory = takeFlag(args, '--client');
    const clientCommand = takeFlag(args, '--client-command');
    const expo = takeBooleanFlag(args, '--expo');
    const expoDirectory = takeFlag(args, '--expo-dir');
    const expoPlatform = takeFlag(args, '--expo-platform');
    const expoEmail = takeFlag(args, '--email');
    const expoCommand = takeFlag(args, '--expo-command');
    const androidSerial = takeFlag(args, '--android-serial');
    const iosUdid = takeFlag(args, '--ios-udid');
    const nativeCheckout = takeBooleanFlag(args, '--native-checkout');
    const iosBundleIdentifier = takeFlag(args, '--ios-bundle-identifier');
    const androidComponent = takeFlag(args, '--android-component');
    const expoAppScheme = takeFlag(args, '--expo-app-scheme');
    // A leftover flag-shaped token would silently become the backend
    // directory name (`snapback dev --help` "ran" against a directory named
    // --help and exited 1 with no output — 0137 a4-f2). Reject it loudly.
    if (typeof args[0] === 'string' && args[0].startsWith('-')) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `unknown dev option ${args[0]}; usage: snapback dev [<backend-dir>] [--attach] [--no-watch] `
          + '[--ready-file <path>] [--application-ready-file <path>] [--db <path>] [--client <dir>] [--client-command <cmd>] '
          + '[--write-env [path]] '
          + '[--port <port>] [--client-port <port>] [--bootstrap-port <port>] [--port-range <lo>-<hi>] [--external-client-origin <origin>] '
          + '[--expo] [--expo-dir <dir>] [--expo-platform ios|android|web] [--email <address>] '
          + '[--expo-command <cmd>] [--android-serial <serial>] [--ios-udid <udid>] '
          + '[--native-checkout --expo-app-scheme <scheme> <--ios-bundle-identifier <id>|--android-component <component>>] [--json]',
      );
    }
    const backendDirectory = args.shift() ?? 'snapback';
    if (args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `unexpected dev arguments: ${args.join(' ')}`,
        { args },
      );
    }
    if (!expo && (nativeCheckout
      || [expoDirectory, expoPlatform, expoEmail, expoCommand, androidSerial, iosUdid,
        iosBundleIdentifier, androidComponent, expoAppScheme].some((value) => value !== null))) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        '--expo-dir, --expo-platform, --email, --expo-command, --android-serial, --ios-udid, --native-checkout, --ios-bundle-identifier, --android-component, and --expo-app-scheme require --expo',
      );
    }
    let expoSelectedPlatform = expoPlatform ?? 'ios';
    if (expo) {
      if (externalClientOrigin !== null) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--external-client-origin declares a client owned outside Snapback and cannot be combined with --expo',
        );
      }
      if (noWatch || clientDirectory !== null || clientCommand !== null) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          'snapback dev --expo is a long-running supervisor and cannot be combined with --no-watch, --client, or --client-command',
        );
      }
      if (!['ios', 'android', 'web'].includes(expoSelectedPlatform)) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--expo-platform must be ios, android, or web',
          { expoPlatform: expoSelectedPlatform },
        );
      }
      if (androidSerial !== null && expoSelectedPlatform !== 'android') {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--android-serial requires --expo-platform android',
        );
      }
      if (iosUdid !== null && expoSelectedPlatform !== 'ios') {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--ios-udid requires --expo-platform ios',
        );
      }
      if (iosBundleIdentifier !== null && expoSelectedPlatform !== 'ios') {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--ios-bundle-identifier requires --expo-platform ios',
        );
      }
      if (androidComponent !== null && expoSelectedPlatform !== 'android') {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--android-component requires --expo-platform android',
        );
      }
      if (!nativeCheckout && (
        iosBundleIdentifier !== null || androidComponent !== null || expoAppScheme !== null
      )) {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--ios-bundle-identifier, --android-component, and --expo-app-scheme require --native-checkout',
        );
      }
      if (nativeCheckout && expoSelectedPlatform === 'web') {
        throw diagnosticError(
          'SNAPBACK_CLI_ARGUMENT_INVALID',
          '--native-checkout is available only for native Expo targets',
        );
      }
      if (nativeCheckout && expoSelectedPlatform === 'ios' && iosBundleIdentifier === null) {
        throw diagnosticError(
          'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
          '--native-checkout on iOS requires --ios-bundle-identifier for the application development client',
        );
      }
      if (nativeCheckout && expoSelectedPlatform === 'android' && androidComponent === null) {
        throw diagnosticError(
          'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
          '--native-checkout on Android requires --android-component for the application development client',
        );
      }
      if (nativeCheckout && expoAppScheme === null) {
        throw diagnosticError(
          'SNAPBACK_EXPO_NATIVE_CHECKOUT_OWN_BUNDLE_REQUIRED',
          '--native-checkout requires --expo-app-scheme for the application development client',
        );
      }
    }
    const portPlan = resolveDevPortPlan({
      profile: expo
        ? 'expo'
        : externalClientOrigin !== null
          ? 'external-client'
          : clientDirectory !== null || clientCommand !== null
            ? 'client-command'
            : 'plain',
      platform: expoSelectedPlatform,
      flags: { port, clientPort, bootstrapPort, portRange },
      env: options.env ?? process.env,
    });
    if (externalClientOrigin !== null) {
      const backendOwner = devPortPlanOwner(portPlan, 'backend');
      normalizeExternalClientOrigins(
        { externalClientOrigin },
        backendOwner?.source === 'pinned' ? backendOwner.port : null,
      );
    }
    // Advisory only — Metro started outside the supervisor still inherits a
    // truthy CI and serves a stale bundle. The `--expo` owner strips CI from
    // its Metro child, so only caller-owned launch paths need this warning.
    const expoDevModule = await import('./expo-dev.mjs');
    if (!expo) {
      expoDevModule.emitCliMetroWatchInertAdvisory({
        env: options.env ?? process.env,
        clientCommand,
        json,
      });
    }
    if (expo) {
      const runExpoDev = typeof options.runExpoDev === 'function'
        ? options.runExpoDev
        : expoDevModule.runExpoDev;
      let criticalExit = null;
      let result = null;
      let detachInput = () => {};
      let stopping = false;
      let closePromise = null;
      let resolveStop;
      let rejectStop;
      const stopped = new Promise((resolveStopped, rejectStopped) => {
        resolveStop = resolveStopped;
        rejectStop = rejectStopped;
      });
      const interrupt = new AbortController();
      const settle = (failure = null) => {
        if (stopping) return closePromise;
        stopping = true;
        detachInput();
        closePromise = (async () => {
          try {
            await result?.close?.();
            if (failure) rejectStop(failure);
            else resolveStop();
          } catch (error) {
            rejectStop(error);
          }
        })();
        return closePromise;
      };
      let receivedSignal = null;
      const handlers = new Map();
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const handler = () => {
          // Keep every real handler installed through cleanup. Repeated
          // signals latch onto the first interruption instead of restoring
          // Node's default termination while detached groups are reclaimed.
          if (receivedSignal !== null) return;
          receivedSignal = signal;
          const error = diagnosticError(
            'SNAPBACK_EXPO_DEV_INTERRUPTED',
            `the Expo supervisor was interrupted by ${signal}`,
            { signal },
          );
          interrupt.abort(error);
          void settle();
        };
        handlers.set(signal, handler);
        process.on(signal, handler);
      }
      const externalAbort = () => {
        if (!interrupt.signal.aborted) interrupt.abort(options.signal?.reason);
        void settle();
      };
      if (options.signal?.aborted) externalAbort();
      else options.signal?.addEventListener('abort', externalAbort, { once: true });
      try {
        result = await runExpoDev({
          ...options,
          backendDirectory,
          attach,
          devOptions: {
            ...options.devOptions,
            portPlan,
            ...(port === null ? {} : { port }),
            ...(portRange === null ? {} : { portRange }),
          },
          portPlan,
          ...(clientPort === null ? {} : { clientPort }),
          ...(bootstrapPort === null ? {} : { bootstrapPort }),
          ...(portRange === null ? {} : { portRange }),
          ...(readyFile ? { readyFile } : {}),
          ...(applicationReadyFile ? { applicationReadyFile } : {}),
          ...(database ? { database } : {}),
          ...(writeEnvFile === null ? {} : { writeEnvFile }),
          ...(expoDirectory ? { expoDirectory } : {}),
          ...(expoEmail ? { email: expoEmail } : {}),
          ...(expoCommand ? { metroCommand: expoCommand } : {}),
          ...(androidSerial ? { androidSerial } : {}),
          ...(iosUdid ? { iosUdid } : {}),
          ...(nativeCheckout ? { nativeCheckout: true } : {}),
          ...(iosBundleIdentifier ? { iosBundleIdentifier } : {}),
          ...(androidComponent ? { androidComponent } : {}),
          ...(expoAppScheme ? { expoAppScheme } : {}),
          platform: expoSelectedPlatform,
          signal: interrupt.signal,
          onEvent(event) {
            printDevEvent(event, { json, plainProfile: false });
            options.onEvent?.(event);
          },
          onCriticalExit(error) {
            criticalExit = error;
            options.onCriticalExit?.(error);
            if (result !== null) void settle(error);
          },
        });
        if (result.ok === false) {
          printResult(result, json);
          return 1;
        }
        if (interrupt.signal.aborted) {
          await settle();
          return 0;
        }
        detachInput = attachDevControlChannel({
          verbs: result.verbs,
          stop() { void settle(); },
          onEvent(event) { result.reportControlEvent(event); },
          stdin: options.stdin ?? process.stdin,
        });
        if (criticalExit) void settle(criticalExit);
        await stopped;
        return 0;
      } catch (error) {
        if (interrupt.signal.aborted) {
          await closePromise;
          return 0;
        }
        throw error;
      } finally {
        options.signal?.removeEventListener('abort', externalAbort);
        for (const [signal, handler] of handlers) process.off(signal, handler);
      }
    }
    // A restart replaces the managed child, so unexpected-exit detection goes
    // through runDev's onServerExit callback instead of a listener pinned to
    // the first child process.
    let onUnexpectedServerExit = null;
    const startDev = typeof options.runDev === 'function' ? options.runDev : runDev;
    const result = await startDev({
      backendDirectory,
      attach,
      watch: !noWatch,
      ...(readyFile ? { readyFile } : {}),
      ...(applicationReadyFile ? { applicationReadyFile } : {}),
      ...(database ? { database } : {}),
      ...(writeEnvFile === null ? {} : { writeEnvFile }),
      ...(port === null ? {} : { port }),
      ...(portRange === null ? {} : { portRange }),
      portPlan,
      ...(externalClientOrigin === null ? {} : { externalClientOrigin }),
      ...(clientDirectory || clientCommand
        ? {
          client: {
            ...(clientDirectory ? { directory: clientDirectory } : {}),
            ...(clientCommand ? { command: clientCommand } : {}),
          },
        }
        : {}),
      onServerExit(code, signal) { onUnexpectedServerExit?.(code, signal); },
      ...options,
      // The CLI-resolved plan has already applied flag > environment >
      // default precedence. Do not let an embedding option replace it after
      // argument validation.
      portPlan,
      onEvent(event) {
        printDevEvent(event, { json, plainProfile: true });
        options.onEvent?.(event);
      },
    });
    // A failed dev result must reach the terminal through the same
    // printResult path every other command uses — `snapback dev` used to
    // exit 1 with zero bytes of output when the managed loop's first result
    // was not ok (0137 a4-f2), while `snapback generate` printed the full
    // structured diagnostic for the identical failure.
    if (result.ok === false) {
      printResult(result, json);
      return 1;
    }
    if (noWatch) {
      await result.close?.();
    } else if (result.ok) {
      await new Promise((resolveStop, rejectStop) => {
        let stopping = false;
        let detachInput = () => {};
        const settle = async (failure = null) => {
          if (stopping) return;
          stopping = true;
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          process.off('SIGHUP', stop);
          detachInput();
          try {
            await result.close?.();
            if (failure) rejectStop(failure);
            else resolveStop();
          } catch (error) {
            rejectStop(error);
          }
        };
        function stop() {
          void settle();
        }
        onUnexpectedServerExit = (code, signal) => {
          if (stopping) return;
          void settle(diagnosticError(
            'SNAPBACK_DEV_SERVER_EXITED',
            'the managed Snapback server exited while dev watch was active',
            { code, signal },
          ));
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
        process.once('SIGHUP', stop);
        detachInput = attachDevControlChannel({
          verbs: result.verbs,
          stop,
          onEvent(event) { console.log(JSON.stringify(event)); },
          stdin: options.stdin ?? process.stdin,
        });
      });
    }
    return result.ok ? 0 : 1;
  }
  if (command === 'agent') {
    const subcommand = args.shift();
    const printClient = takeFlag(args, '--print');
    const installClient = takeFlag(args, '--install');
    const uninstallClient = takeFlag(args, '--uninstall');
    const server = takeFlag(args, '--server');
    const receiptPath = takeFlag(args, '--receipt');
    const actions = [
      ['print', printClient],
      ['install', installClient],
      ['uninstall', uninstallClient],
    ].filter(([, client]) => client !== null);
    if (subcommand !== 'setup' || actions.length !== 1 || args.length > 0) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        'usage: snapback agent setup <--print <client>|--install <client>|--uninstall <client>> [--server mcp|mcp-control] [--receipt <file>] [--json]',
      );
    }
    const [action, client] = actions[0];
    if (action !== 'print' && server === null) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        `--${action} requires an explicit --server mcp|mcp-control`,
      );
    }
    if (action === 'print' && receiptPath !== null) {
      throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', '--receipt is valid only with --install or --uninstall');
    }
    const {
      installAgentSetup,
      printAgentSetup,
      uninstallAgentSetup,
    } = await import('./agent-setup.mjs');
    const projectRoot = resolve(options.projectRoot ?? process.cwd());
    const launchers = {
      runtimeBinary: () => resolveRuntimeBinary(options).binary,
      packageCli: join(packageRoot, 'cli.mjs'),
    };
    if (action === 'print') {
      const result = printAgentSetup({
        client,
        server,
        projectRoot,
        launchers,
        diagnosticError,
      });
      if (json) console.log(JSON.stringify(result, null, 2));
      else process.stdout.write(result.snippet);
      return 0;
    }
    if (action === 'install') {
      const preview = json ? console.error : console.log;
      const result = installAgentSetup({
        client,
        server,
        projectRoot,
        receiptPath,
        launchers,
        diagnosticError,
        beforeWrite(disclosure) {
          preview(`Target file: ${disclosure.targetFile}`);
          preview(`Server: ${disclosure.server}`);
          preview(disclosure.authoritySentence);
        },
      });
      console.log(JSON.stringify(result, null, json ? 2 : 0));
      return 0;
    }
    const result = uninstallAgentSetup({
      client,
      server,
      projectRoot,
      receiptPath,
      diagnosticError,
    });
    console.log(JSON.stringify(result, null, json ? 2 : 0));
    return 0;
  }
  if (command === 'mcp-control') {
    // @ref LLP 0042#implementation-decisions-recorded-for-sc-1b-2026-07-23 —
    // the control-plane MCP server ships inside @expo/snapback-cli as a JS
    // command, reusing the CLI lifecycle helpers instead of the native
    // binary's guide-only `snapback mcp`.
    const readyFile = takeFlag(args, '--ready-file');
    const database = takeFlag(args, '--db');
    const { runMcpControl } = await import('./mcp-control.mjs');
    return runMcpControl({
      backendDirectory: args.shift() ?? 'snapback',
      ...(readyFile ? { readyFile } : {}),
      ...(database ? { database } : {}),
      ...options,
    });
  }
  let adminTokenFile = null;
  if (command === 'auth' && args[0] === 'password' && args[1] === 'unlock') {
    adminTokenFile = takeFlag(args, '--admin-token-file');
    if (adminTokenFile !== null && args.some((argument) => argument === '--token' || argument.startsWith('--token='))) {
      throw diagnosticError(
        'SNAPBACK_CLI_ARGUMENT_INVALID',
        '--admin-token-file and --token are mutually exclusive admin-token carriers',
      );
    }
  }
  const runtime = resolveRuntimeBinary(options);
  // @ref LLP 0194#design — a cold install with no checkout registry delegates
  // exact Guide lookup to the embedded native registry without losing JSON mode.
  const delegatedArgs = command === undefined
    ? []
    : [command, ...args, ...(command === 'guide' && json ? ['--json'] : [])];
  const delegatedEnvironment = runtimeSpawnEnvironment(runtime.binary, options.env);
  if (adminTokenFile !== null) {
    delegatedEnvironment.SNAPBACK_ADMIN_TOKEN = readOwnerOnlyAdminTokenFile(
      resolve(options.cwd ?? process.cwd(), adminTokenFile),
    );
  }
  if (command === 'start') {
    // @ref LLP 0301#2-origin-admission--the-path-split-implemented — direct
    // native start must not inherit lifecycle posture.
    delete delegatedEnvironment.SNAPBACK_DEV_ADMISSION_POSTURE;
  }
  const result = spawnSync(runtime.binary, delegatedArgs, {
    stdio: 'inherit',
    env: delegatedEnvironment,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export const __test = {
  assertDevAdmissionContractMatches,
  canonicalDevClientOrigin,
  devBackendUrls,
  devIdentityClientEnvironment,
  expectedActivationTargetFromActivation,
  fixedPortAttachFailure,
  loadGenerated,
  portFromUrl,
  qualifiedRuntimeIdentity,
  readLegacyApplicationReadyReceipt,
  readReadyDescriptor,
  refineGeneratedArtifactFailure,
  removeManagedDatabaseState,
  resolveDevIdentityCapabilityForCli,
  runtimePackages: Object.fromEntries(RUNTIME_PACKAGES),
  runtimeReadinessRoot,
  sourceCheckoutRoot,
  runtimeSpawnEnvironment,
  scrubDynamicLoaderEnvironment,
  withExternalClientOrigins,
};
