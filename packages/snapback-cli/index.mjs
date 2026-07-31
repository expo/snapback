// @ref LLP 0041#cli-commands — the package-owned commands orchestrate the
// external developer loop; every existing host operation delegates to the
// same native CLI instead of growing a second lifecycle dialect.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import { formatCodegenSummary, generate } from '@expo/snapback-codegen';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import {
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
} from '@expo/snapback-codegen/review-surface';
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
import {
  createRuntimeRecoveryRecord,
  inspectRuntimeBinary,
} from './runtime-recovery.mjs';
import {
  loadComparatorProfile,
  readComparatorReceipt,
  runComparatorAcceptance,
} from './comparator-profile.mjs';
import {
  createHostedPlan,
  invokeHostedLifecycle,
  runHostedRead,
  submitHostedOperatorRequest,
} from './hosted-control.mjs';
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

export function diagnosticError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'cli',
    message,
    ...(details === undefined ? {} : { details }),
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
  return { binary, source: packageName, platform };
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
} = {}) {
  return createRuntimeRecoveryRecord({
    selectedBinary: runtime?.binary ?? null,
    selectionRung: !runtime
      ? 'none'
      : runtime.source === 'override'
        ? 'configured'
        : 'packaged-runtime',
    actualStamp,
    buildable: null,
    runnable,
    reuseAllowed: runnable === true,
    reuseReason: reason,
    diagnostic,
    producerInputs: runtime
      ? { platform: runtime.platform, runtimeSource: runtime.source }
      : null,
    repairCommand: runtime?.source === 'override'
      ? 'unset SNAPBACK_RUNTIME_BINARY && reinstall @expo/snapback-cli'
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
      }),
    };
  }
  const checks = [];
  const launch = spawnSync(runtime.binary, ['--help'], {
    encoding: 'utf8',
    env: scrubDynamicLoaderEnvironment(options.env),
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
  let child = null;
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
    child = spawn(runtime.binary, ['start', '--ready-file', readyFile, '--db', database], {
      cwd: projectRoot,
      env: scrubDynamicLoaderEnvironment(options.env),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const descriptor = validateDevTarget(
      await waitForReady(readyFile, child, options.readyTimeoutMs ?? 15_000),
      { readyFile, database },
    );
    const adminToken = managedAdminToken(descriptor, database);
    await loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken, {
      seed: true,
      database,
    });
    checks.push(doctorDiagnostic(
      'SNAPBACK_DOCTOR_BUNDLE_LOAD_OK',
      'runtime',
      'the disposable server created its VM and loaded the generated bundle',
    ));

    const apiModule = await import(`${pathToFileURL(join(backendRoot, 'generated', 'api.mjs')).href}?doctor=${Date.now()}`);
    const api = apiModule.default;
    const client = new SnapbackClient(descriptor.serverUrl, { adminToken });
    const userId = 'user_doctor';
    const before = await client.query(api.listTodos, { userId });
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
      userId,
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

    live = await client.liveQuery(api.listTodos, { connectionId: 'doctor', userId });
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
    if (child?.exitCode === null) {
      const stop = native(runtime.binary, ['stop', '--ready-file', readyFile], {
        cwd: projectRoot,
        env: options.env,
        timeout: 15_000,
      });
      if (stop.status !== 0) {
        child.kill('SIGTERM');
        failure ??= doctorDiagnostic(
          'SNAPBACK_DOCTOR_SHUTDOWN_FAILED',
          'runtime',
          'the disposable server did not stop through its owned readiness descriptor',
          { status: stop.status, signal: stop.signal, stderr: stop.stderr?.slice(0, 2_000) ?? '' },
        );
      }
    }
    if (child?.exitCode === null) {
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          failure ??= doctorDiagnostic(
            'SNAPBACK_DOCTOR_SHUTDOWN_FAILED',
            'runtime',
            'the disposable server did not exit within the shutdown deadline',
          );
          resolveExit();
        }, 5_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolveExit();
        });
      });
    }
    try {
      rmSync(scratch, { recursive: true, force: true });
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
  const generated = await generateApp(backendRoot, { targetProfile });
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
  cpSync(templateRoot, destination, { recursive: true, errorOnExist: true });
  const manifestPath = join(destination, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.name = destination.split(/[/\\]/).pop().toLowerCase();
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, value] of Object.entries(manifest[section] ?? {})) {
      if (value === '__SNAPBACK_VERSION__') manifest[section][name] = `^${packageVersion()}`;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { schemaVersion: 'snapback.scaffold.v1', ok: true, template, target: destination };
}

export async function generateApp(backendDirectory, options = {}) {
  const targetProfile = options.targetProfile ?? 'local-dev-sqlite-ibex';
  const result = await generate(resolve(backendDirectory), { targetProfile });
  return {
    schemaVersion: 'snapback.generate.v1',
    ...result,
    targetProfile,
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

export function native(binary, args, options = {}) {
  return spawnSync(binary, args, {
    cwd: options.cwd,
    env: scrubDynamicLoaderEnvironment(options.env),
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

const ARTIFACT_DECODE_EVIDENCE = /(?:unknown|missing|duplicate) field|invalid (?:json|type)|expected (?:struct|map|sequence|string)|did not match any variant|data did not match|SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH|SNAPBACK_STALE_(?:SCHEMA|FUNCTION)_ARTIFACT_(?:KIND|VERSION)/i;

function generatedArtifactDecodeFailure(error) {
  const diagnostic = error?.diagnostic ?? {};
  const evidence = [
    error?.message,
    diagnostic.message,
    diagnostic.details?.error,
    diagnostic.details?.stdout,
    diagnostic.details?.stderr,
  ].filter((value) => typeof value === 'string' && value.length > 0).join('\n');
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
} = {}) {
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

export function managedAdminToken(descriptor, database) {
  const declared = descriptor?.adminTokenFile;
  if (typeof declared !== 'string') return null;
  const expected = canonicalFilesystemPath(`${resolve(database)}.admin-token`);
  if (canonicalFilesystemPath(declared) !== expected) {
    throw diagnosticError(
      'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
      'the readiness descriptor names an unexpected admin-token carrier',
      { expectedAdminTokenFile: expected, observedAdminTokenFile: resolve(declared) },
    );
  }
  let metadata;
  try {
    metadata = lstatSync(expected);
  } catch (cause) {
    const error = diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the managed database admin-token carrier is missing or unreadable',
      { path: expected },
    );
    error.cause = cause;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw diagnosticError(
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      'the managed database admin-token carrier must be an owner-only regular file',
      { path: expected },
    );
  }
  const token = readFileSync(expected, 'utf8').trim();
  if (!token) {
    throw diagnosticError('SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID', 'the managed database admin-token carrier is empty', { path: expected });
  }
  return token;
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

function spawnManagedRuntime(binary, args, {
  cwd,
  env,
  stdio = ['ignore', 2, 2],
} = {}) {
  const requested = Array.isArray(stdio) ? stdio : ['ignore', stdio, stdio];
  const child = spawn(binary, args, {
    cwd,
    env: scrubDynamicLoaderEnvironment(env),
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
  } = {},
) {
  const generated = join(backendRoot, 'generated');
  const targetArgs = ['--ready-file', readyFile, ...(adminToken ? ['--token', adminToken] : [])];
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
  const versionedSeedPath = optionalGeneratedArtifact('seed.artifact.json');
  const routesPath = optionalGeneratedArtifact('routes.manifest.json');
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
      requireNativeSuccess(native(binary, [
        'load', ...targetArgs,
        '--schema', schemaPath,
        '--functions', functionsPath,
      ], { cwd: projectRoot }), 'SNAPBACK_DEV_SERVER_LOAD_FAILED', 'schema/function load');
    } catch (error) {
      throw refineGeneratedArtifactFailure(error, {
        binary,
        runtime,
        runtimeIdentity,
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
          await client.ensureApp({
            intent: 'provision',
            requestedMode,
            schema: schemaManifest,
            functions: functionsManifest,
            ...(routes ? { routes } : {}),
          });
        } else if (routes) {
          await client.ensureApp({ routes });
        }
      } catch (error) {
        throw refineGeneratedArtifactFailure(error, {
          binary,
          runtime,
          runtimeIdentity,
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
      } else if (artifact) {
        await client.ensureVersionedSeed(artifact, { requestedMode });
      }
    } finally {
      await client.closeAuth();
      await authCoordinator?.close();
    }
  }
  const seedPath = join(backendRoot, 'seed.json');
  if (!artifact && seed && existsSync(seedPath)) {
    requireNativeSuccess(
      native(binary, ['reset', ...targetArgs, '--seed', seedPath], { cwd: projectRoot }),
      'SNAPBACK_DEV_SERVER_SEED_FAILED',
      'seed load',
    );
  }
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

export async function runDev(options = {}) {
  const backendRoot = resolve(options.backendDirectory ?? 'snapback');
  const projectRoot = resolve(options.projectRoot ?? dirname(backendRoot));
  const stateRoot = join(projectRoot, '.snapback');
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = resolve(options.readyFile ?? join(stateRoot, 'dev.ready.json'));
  const database = resolve(options.database ?? join(stateRoot, 'dev.sqlite3'));
  const databaseExistedBeforeStart = existsSync(database);
  const runtime = resolveRuntimeBinary(options);
  const runtimeIdentity = inspectRuntimeBinary(runtime.binary, options.env);
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
  const generated = await generateApp(backendRoot);
  if (!generated.ok) return { ...generated, state: 'generation-failed' };
  const generatedRoot = join(backendRoot, 'generated');
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
  if (existsSync(readyFile)) {
    descriptor = validateDevTarget(readReadyDescriptor(readyFile), { readyFile, database });
  } else {
    if (options.attach === true) {
      throw diagnosticError('SNAPBACK_DEV_READY_FILE_REQUIRED', `--attach requires ${readyFile}`, { readyFile });
    }
    refreshStartupArtifacts();
    child = spawnManagedRuntime(runtime.binary, [
      'start',
      '--ready-file', readyFile,
      '--db', database,
      ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
    ], {
      cwd: projectRoot,
      env: scrubDynamicLoaderEnvironment(options.env),
      stdio: options.serverStdio ?? ['ignore', 2, 2],
    });
    managed = true;
    try {
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
    } catch (error) {
      if (child.exitCode === null) child.kill('SIGTERM');
      throw refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
    }
  }
  const closeManaged = () => {
    if (managed && child?.exitCode === null) {
      native(runtime.binary, ['stop', '--ready-file', readyFile], { cwd: projectRoot });
    }
  };
  let adminToken;
  try {
    adminToken = managedAdminToken(descriptor, database);
    // `/inspect` becomes the bounded administrative projection when an admin
    // credential is attached, and therefore correctly requires a separately
    // minted secret-read lease. Dev attachment needs only liveness and process
    // identity, so use the public health projection and never upgrade this
    // check into administrative data-read authority.
    const health = await new SnapbackClient(descriptor.serverUrl).health();
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
    await loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken, {
      seed: managed && !databaseExistedBeforeStart,
      database,
      skipSchemaFunctions: managed && startupArtifacts !== null,
      runtime,
      runtimeIdentity,
    });
  } catch (error) {
    closeManaged();
    throw error;
  }

  const result = {
    schemaVersion: 'snapback.dev.v1',
    ok: true,
    state: 'generated-and-loaded',
    managed,
    readyFile,
    serverUrl: descriptor.serverUrl,
    runtime,
    runtimeRecovery,
  };
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

  const regenerateAndLoad = async (filename, extra = {}) => {
    let next;
    try {
      next = await generateApp(backendRoot);
    } catch (error) {
      const refined = refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: false,
        state: 'generation-failed',
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
      return emitDevEvent({ ...next, schemaVersion: 'snapback.dev.v1', state: 'generation-failed', changed: filename, ...extra });
    }
    if (closed) return null;
    try {
      await loadGenerated(runtime.binary, projectRoot, backendRoot, readyFile, adminToken, {
        database,
        runtime,
        runtimeIdentity,
      });
      return emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: true, state: 'generated-and-loaded', changed: filename, ...extra });
    } catch (error) {
      return emitDevEvent({
        schemaVersion: 'snapback.dev.v1',
        ok: true,
        state: 'generated-but-not-loaded',
        changed: filename,
        ...extra,
        diagnostics: [error.diagnostic],
      });
    }
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
      emitDevEvent({ schemaVersion: 'snapback.dev.v1', ok: false, state: 'server-exited', code, signal });
      options.onServerExit?.(code, signal);
    });
  };
  attachExitWatch(child);

  // The client arm: one spawned surface dev command, streamed as events so
  // the machine-readable stdout stays one JSON-line stream.
  let clientProcess = null;
  const startClientArm = () => {
    const spawned = spawn(clientArm.command, {
      shell: true,
      cwd: clientArm.directory,
      // Own process group: the shell-spawned tree (runner, Vite, esbuild)
      // tears down as one unit on close.
      detached: true,
      env: options.env ?? process.env,
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
  const closeClientArm = () => {
    if (!clientProcess || clientProcess.exitCode !== null || clientProcess.signal !== null) return;
    const { child: proc } = clientProcess;
    const signalGroup = (signal) => {
      try {
        process.kill(-proc.pid, signal);
      } catch {
        try {
          proc.kill(signal);
        } catch {
          // already gone
        }
      }
    };
    signalGroup('SIGTERM');
    const escalate = setTimeout(() => {
      if (clientProcess.exitCode === null && clientProcess.signal === null) signalGroup('SIGKILL');
    }, 5_000);
    escalate.unref?.();
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

  // The dev-loop verb slice: status / reload / restart, each usable from the
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
    () => regenerateAndLoad('(reload)', {
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
    try {
      const previousPid = descriptor.pid ?? null;
      if (child.exitCode === null && child.signalCode === null) {
        const stop = native(runtime.binary, ['stop', '--ready-file', readyFile], { cwd: projectRoot });
        if (stop.status !== 0 && child.exitCode === null) child.kill('SIGTERM');
      }
      const deadline = Date.now() + 10_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (existsSync(readyFile)) rmSync(readyFile, { force: true });
      refreshStartupArtifacts();
      child = spawnManagedRuntime(runtime.binary, [
        'start',
        '--ready-file', readyFile,
        '--db', database,
        ...(startupArtifacts ? ['--startup-artifacts', startupArtifacts] : []),
      ], {
        cwd: projectRoot,
        env: scrubDynamicLoaderEnvironment(options.env),
        stdio: options.serverStdio ?? ['ignore', 2, 2],
      });
      attachExitWatch(child);
      descriptor = validateDevTarget(await waitForReady(readyFile, child), { readyFile, database });
      adminToken = managedAdminToken(descriptor, database);
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
      return await regenerateAndLoad('(restart)', { ...tag });
    } catch (error) {
      const refined = refineGeneratedArtifactFailure(error, {
        binary: runtime.binary,
        runtime,
        runtimeIdentity,
        artifacts: startupArtifacts
          ? [startupArtifacts, ...startupArtifactSources]
          : startupArtifactSources,
      });
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

  return {
    ...result,
    child,
    verbs: { status: statusVerb, reload: reloadVerb, restart: restartVerb },
    close() {
      closed = true;
      clearTimeout(timer);
      watcher.close();
      closeClientArm();
      closeManaged();
    },
  };
}

// The two dev-loop control channels over stdin. A TTY gets single-key verbs
// (s=status, r=reload, R=restart backend, q=quit); anything else is the
// machine-readable channel: newline-delimited JSON commands
// (`{"schemaVersion":"snapback.dev-command.v1","verb":"status"|"reload"|"restart"}`,
// optional `requestId` echoed on the response event). Responses and events
// ride the one `snapback.dev.v1` JSON-line stream on stdout; unknown or
// malformed commands produce a structured `command-error` event, never a
// crash. Returns a detach function.
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
      else if (key === 'q' || key === '\u0003') stop();
    };
    stdin.on('data', onKey);
    emit({
      ok: true,
      state: 'control-ready',
      channel: 'tty',
      keys: { s: 'status', r: 'regenerate and reload', R: 'restart backend', q: 'quit' },
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
  lines.on('close', () => stop());
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
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw diagnosticError('SNAPBACK_CLI_ARGUMENT_INVALID', `${name} requires a value`);
  args.splice(index, 2);
  return value;
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
  else if (result.ok !== false && result.schemaVersion === 'snapback.generate.v1' && result.summary) {
    for (const diagnostic of result.diagnostics ?? []) {
      console.error(`[${diagnostic.severity}] ${diagnostic.code} (${diagnostic.subsystem}) ${diagnostic.message}`);
    }
    console.log(formatCodegenSummary(result.summary));
  }
  else if (result.ok !== false) console.log(`${result.schemaVersion}: ok`);
  else console.error(JSON.stringify(result, null, 2));
}

export async function runCli(argv, options = {}) {
  const args = [...argv];
  const command = args.shift();
  const json = args.includes('--json');
  if (json) args.splice(args.indexOf('--json'), 1);
  const auditActorId = takeFlag(args, '--audit-actor');
  if (auditActorId !== null) options = { ...options, auditActorId };
  if (command === 'doctor') {
    const result = await doctor(options);
    printResult(result, json);
    return result.ok ? 0 : 1;
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
  if (command === 'new') {
    const target = args.shift();
    if (!target) throw diagnosticError('SNAPBACK_NEW_NAME_REQUIRED', 'usage: snapback new <name> [--template todo-contract|react]');
    const template = takeFlag(args, '--template', 'todo-contract');
    const result = scaffoldApp(target, { template });
    printResult(result, json);
    return 0;
  }
  if (command === 'generate') {
    const targetProfile = takeFlag(args, '--target-profile', 'local-dev-sqlite-ibex');
    const result = await generateApp(args.shift() ?? 'snapback', { targetProfile });
    printResult(result, json);
    return result.ok ? 0 : 1;
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
      return 0;
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
      ...(sinceRaw === undefined ? {} : { sinceMs: Number(sinceRaw) }),
      ...(untilRaw === undefined ? {} : { untilMs: Number(untilRaw) }),
      ...(limitRaw === undefined ? {} : { limit: Number(limitRaw) }),
      ...(cursor === undefined ? {} : { cursor }),
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
      return result.applyEligible === false ? 2 : 0;
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
      return 0;
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
      return 0;
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
    const database = takeFlag(args, '--db');
    const clientDirectory = takeFlag(args, '--client');
    const clientCommand = takeFlag(args, '--client-command');
    // A restart replaces the managed child, so unexpected-exit detection goes
    // through runDev's onServerExit callback instead of a listener pinned to
    // the first child process.
    let onUnexpectedServerExit = null;
    const result = await runDev({
      backendDirectory: args.shift() ?? 'snapback',
      attach,
      watch: !noWatch,
      ...(readyFile ? { readyFile } : {}),
      ...(database ? { database } : {}),
      ...(clientDirectory || clientCommand
        ? {
          client: {
            ...(clientDirectory ? { directory: clientDirectory } : {}),
            ...(clientCommand ? { command: clientCommand } : {}),
          },
        }
        : {}),
      onEvent(event) { console.log(JSON.stringify(event)); },
      onServerExit(code, signal) { onUnexpectedServerExit?.(code, signal); },
      ...options,
    });
    if (noWatch) {
      result.close?.();
    } else if (result.ok) {
      await new Promise((resolveStop, rejectStop) => {
        let stopping = false;
        let detachInput = () => {};
        const settle = () => {
          stopping = true;
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          detachInput();
          result.close?.();
        };
        function stop() {
          if (stopping) return;
          settle();
          resolveStop();
        }
        onUnexpectedServerExit = (code, signal) => {
          if (stopping) return;
          settle();
          rejectStop(diagnosticError(
            'SNAPBACK_DEV_SERVER_EXITED',
            'the managed Snapback server exited while dev watch was active',
            { code, signal },
          ));
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
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
  const runtime = resolveRuntimeBinary(options);
  const delegatedArgs = command === undefined ? [] : [command, ...args];
  const result = spawnSync(runtime.binary, delegatedArgs, {
    stdio: 'inherit',
    env: scrubDynamicLoaderEnvironment(options.env),
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export const __test = {
  loadGenerated,
  readReadyDescriptor,
  runtimePackages: Object.fromEntries(RUNTIME_PACKAGES),
  scrubDynamicLoaderEnvironment,
};
