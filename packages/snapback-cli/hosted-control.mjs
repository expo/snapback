// The public package exposes a deliberately closed hosted surface while the
// standing-supervisor transport is completed. Read commands reuse the
// target-neutral control plane. Lifecycle commands accept only the generated
// V2 carrier and route it to the package-owned Fly driver, whose unsupported
// effects return a structured, non-mutating refusal.
//
// @ref LLP 0105#closed-request-and-command-registry — command spellings and
// lifecycle variants are exhaustive; unknown combinations fail closed.
// @ref LLP 0105#public-operator-and-command-authority — provider credentials
// stay behind an adapter/supervisor boundary and never enter CLI output.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  inspectTargetAdmin,
  queryControlLogs,
  showTarget,
} from './deployment-control.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const LIFECYCLE_REQUEST_KEYS = Object.freeze([
  'attempt',
  'confirmationSha256',
  'effectIntent',
  'lease',
  'operation',
  'operationId',
  'planSha256',
  'predecessorHead',
  'requestSha256',
  'schemaVersion',
  'targetBinding',
]);

function lifecycleEntry(operation) {
  return Object.freeze({
    kind: 'lifecycle',
    operation,
    availability: 'fail-closed-until-supervisor-executor',
  });
}

export const HOSTED_LIFECYCLE_VERBS = Object.freeze({
  'acquire-lease': 'acquireLease',
  'renew-lease': 'renewLease',
  'upload-immutable-release': 'uploadImmutableRelease',
  'provision-inactive': 'provisionInactive',
  'compatibility-preflight': 'compatibilityPreflight',
  'create-verified-backup': 'createVerifiedBackup',
  'stage-release': 'stageRelease',
  'activate-generation': 'activateGeneration',
  'verify-served-path': 'verifyServedPath',
  rollback: 'rollback',
  'fence-external-effects': 'fenceExternalEffects',
  'restore-backup-inactive': 'restoreBackupInactive',
  'verify-restored-components': 'verifyRestoredComponents',
  'verify-restored-application': 'verifyRestoredApplication',
  'activate-restored-generation': 'activateRestoredGeneration',
  'reconcile-effect': 'reconcileEffect',
  'release-lease': 'releaseLease',
});

export const HOSTED_COMMAND_REGISTRY = Object.freeze({
  plan: Object.freeze({ kind: 'read', operation: 'plan' }),
  inspect: Object.freeze({ kind: 'read', operation: 'inspectAdmin' }),
  logs: Object.freeze({ kind: 'read', operation: 'logs' }),
  ...Object.fromEntries(
    Object.entries(HOSTED_LIFECYCLE_VERBS)
      .map(([verb, operation]) => [`lifecycle ${verb}`, lifecycleEntry(operation)]),
  ),
});

export const HOSTED_ASSETS = Object.freeze({
  flyDriver: 'adapters/fly-machines-vm-driver.mjs',
  schemas: Object.freeze({
    flyTargetBindingV2: 'hosted-schemas/fly-target.binding-v2.schema.json',
    hostedControlHeadV2: 'hosted-schemas/hosted-control-head-v2.schema.json',
    lifecycleRequestV2: 'hosted-schemas/vm-adapter.lifecycle-request-v2.schema.json',
    lifecycleResponseV2: 'hosted-schemas/vm-adapter.lifecycle-response-v2.schema.json',
  }),
});

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'hosted-control',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertClosed(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw fail('SNAPBACK_HOSTED_REQUEST_INVALID', `${name} must use its exact generated field set`);
  }
}

function readRegularFile(path, code) {
  const absolute = resolve(path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    throw fail(code, 'hosted request file is unavailable', { path: absolute });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) {
    throw fail(code, 'hosted request must be a bounded regular non-symlink file', { path: absolute });
  }
  return { absolute: realpathSync.native(absolute), bytes: readFileSync(absolute) };
}

export function resolveHostedAssets() {
  const flyDriver = realpathSync.native(join(packageRoot, HOSTED_ASSETS.flyDriver));
  const schemas = Object.fromEntries(
    Object.entries(HOSTED_ASSETS.schemas)
      .map(([name, path]) => [name, realpathSync.native(join(packageRoot, path))]),
  );
  return {
    flyDriver,
    flyDriverSha256: sha256(readFileSync(flyDriver)),
    schemas,
    schemaSha256: Object.fromEntries(
      Object.entries(schemas).map(([name, path]) => [name, sha256(readFileSync(path))]),
    ),
  };
}

export function createHostedPlan({
  targetId = null,
  controlRoot = undefined,
  ...options
} = {}) {
  const assets = resolveHostedAssets();
  const target = targetId === null ? null : showTarget(targetId, { controlRoot, ...options });
  if (target && target.adapter.provider !== 'fly-machines') {
    throw fail(
      'SNAPBACK_HOSTED_PROVIDER_UNSUPPORTED',
      'the packaged first hosted driver supports only fly-machines targets',
      { provider: target.adapter.provider },
    );
  }
  return {
    schemaVersion: 'snapback.hosted-command-plan.v1',
    ok: true,
    targetId,
    targetDescriptorSha256: target === null
      ? null
      : sha256(Buffer.from(canonicalJson(target))),
    driver: {
      kind: 'fly-machines',
      sha256: assets.flyDriverSha256,
      lifecycleAvailability: 'fail-closed-until-supervisor-executor',
    },
    commands: Object.entries(HOSTED_COMMAND_REGISTRY).map(([command, entry]) => ({
      command,
      ...entry,
    })),
    schemas: assets.schemaSha256,
  };
}

export function runHostedRead(operation, {
  targetId,
  controlRoot = undefined,
  ...options
}) {
  if (operation === 'inspect') {
    return inspectTargetAdmin(targetId, { controlRoot, ...options });
  }
  if (operation === 'logs') {
    return queryControlLogs(targetId, { controlRoot, ...options });
  }
  throw fail('SNAPBACK_HOSTED_COMMAND_UNKNOWN', 'hosted read command is not in the closed registry');
}

export function invokeHostedLifecycle(verb, {
  requestPath,
  env = process.env,
  timeoutMs = 15_000,
} = {}) {
  const operation = HOSTED_LIFECYCLE_VERBS[verb];
  if (!operation) {
    throw fail('SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN', 'hosted lifecycle verb is not in the closed registry');
  }
  const requestFile = readRegularFile(requestPath, 'SNAPBACK_HOSTED_REQUEST_UNAVAILABLE');
  let request;
  try {
    request = JSON.parse(requestFile.bytes);
  } catch {
    throw fail('SNAPBACK_HOSTED_REQUEST_INVALID', 'hosted lifecycle request is not one JSON value');
  }
  assertClosed(request, LIFECYCLE_REQUEST_KEYS, 'AdapterLifecycleRequestV2');
  if (request.schemaVersion !== 'snapback.vm-adapter-lifecycle-request.v2'
      || request.operation !== operation
      || typeof request.operationId !== 'string'
      || !SAFE_ID.test(request.operationId)
      || typeof request.attempt !== 'number'
      || !Number.isSafeInteger(request.attempt)
      || request.attempt < 0
      || !DIGEST.test(request.planSha256)
      || !DIGEST.test(request.requestSha256)) {
    throw fail(
      'SNAPBACK_HOSTED_REQUEST_INVALID',
      'hosted lifecycle request identity, operation, attempt, or digests are invalid',
    );
  }
  const assets = resolveHostedAssets();
  const child = spawnSync(process.execPath, [assets.flyDriver], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    env: {
      PATH: env.PATH ?? '',
      HOME: env.HOME ?? '',
      LANG: env.LANG ?? 'C',
      LC_ALL: env.LC_ALL ?? 'C',
    },
    timeout: timeoutMs,
    maxBuffer: MAX_REQUEST_BYTES,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    return {
      schemaVersion: 'snapback.hosted-lifecycle-refusal.v1',
      ok: false,
      operation,
      operationId: request.operationId,
      code: 'SNAPBACK_HOSTED_LIFECYCLE_DRIVER_REFUSED',
      driverStatus: child.status,
      driverSignal: child.signal,
      requestFileSha256: sha256(requestFile.bytes),
      driverStderrSha256: sha256(Buffer.from(child.stderr ?? '')),
      diagnostics: [{
        code: 'SNAPBACK_HOSTED_LIFECYCLE_DRIVER_REFUSED',
        severity: 'error',
        message: 'the packaged driver refused this lifecycle effect without mutating provider state',
      }],
    };
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw fail('SNAPBACK_HOSTED_LIFECYCLE_RESPONSE_INVALID', 'packaged driver did not return one JSON response');
  }
  if (response.schemaVersion !== 'snapback.vm-adapter-lifecycle-response.v2'
      || response.operation !== operation
      || response.operationId !== request.operationId
      || typeof response.ok !== 'boolean') {
    throw fail('SNAPBACK_HOSTED_LIFECYCLE_RESPONSE_INVALID', 'packaged driver response identity does not match the request');
  }
  return response;
}

export const __hostedControlTest = Object.freeze({
  LIFECYCLE_REQUEST_KEYS,
  MAX_REQUEST_BYTES,
});
