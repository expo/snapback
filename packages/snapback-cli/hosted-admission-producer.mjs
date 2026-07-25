// @ref LLP 0072#implemented-target-and-plan-slice — a concrete hosted adapter
// must advance the rollback-external sender floor before boot, then project the
// authenticated admission and provider-held key into strict owner-only files.
// @ref LLP 0077#author-decisions--2026-07-23 — the replay floor is a dedicated
// monotone control-plane counter outside the application backup set.

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { sealHostedAdmissionEnvelope } from './deployment-control.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const KEY_FILE_VERSION = 'snapback.hosted-admission-key.v1';
const FLOOR_ADVANCE_VERSION = 'snapback.external-replay-floor-advance.v1';
const PROJECTION_VERSION = 'snapback.hosted-admission-projection.v1';
const REFRESH_VERSION = 'snapback.hosted-admission-refresh.v1';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_ADMISSION_TTL_MS = 5 * 60 * 1_000;
const ENVELOPE_KEYS = ['schemaVersion', 'keyId', 'publicOrigin', 'admission', 'mac'];
const FLOOR_ADVANCE_KEYS = [
  'schemaVersion',
  'operationId',
  'deploymentId',
  'storeIdentitySha256',
  'previousFloor',
  'senderReplayEpochFloor',
  'advancedAtMs',
  'receiptId',
];
const ADMISSION_TEMPLATE_KEYS = [
  'version',
  'deploymentId',
  'configurationSha256',
  'supportSha256',
  'admissionEpoch',
  'limiterEpoch',
  'authenticationThrottleConfig',
  'invalidationEpoch',
  'handlerProtocolVersion',
  'handlerIncarnation',
  'operatorSurface',
  'browserDirectBearerSeam',
  'hostedAuth',
];

function failure(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'hosted-admission-producer',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function contentIdentity(domain, value) {
  return sha256(Buffer.from(`${domain}\0${canonicalJson(value)}`));
}

function assertClosed(value, keys, name, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw failure(code, `${name} must be one closed object`);
  }
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw failure(code, `${name} has unknown or missing fields`, {
      expected: [...expected].sort(),
      actual: actual.sort(),
    });
  }
}

function assertSafeInteger(value, name, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      `${name} must be a safe integer greater than or equal to ${minimum}`,
    );
  }
}

function assertDigest(value, name) {
  if (!DIGEST.test(value)) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      `${name} must be a sha256 content identity`,
    );
  }
}

function assertId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      `${name} must be a portable identifier`,
    );
  }
}

function readClock(clock) {
  const nowMs = clock === undefined ? Date.now() : clock();
  assertSafeInteger(nowMs, 'clock result');
  return nowMs;
}

function assertTtl(ttlMs) {
  assertSafeInteger(ttlMs, 'admissionTtlMs', { minimum: 1 });
  if (ttlMs > MAX_ADMISSION_TTL_MS) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      'admissionTtlMs exceeds the five-minute hosted admission ceiling',
    );
  }
}

function assertStrictDirectory(path) {
  const absolute = resolve(path);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch (cause) {
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      'hosted admission projection directory is unavailable',
      { path: absolute },
    );
    error.cause = cause;
    throw error;
  }
  const ownerMismatch = typeof process.getuid === 'function' && metadata.uid !== process.getuid();
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || ownerMismatch
      || (metadata.mode & 0o777) !== 0o700) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      'hosted admission projection directory must be an owner-only, owner-owned, non-symlink directory',
      { path: absolute },
    );
  }
  return absolute;
}

function assertProjectionPath(path, name) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      `${name} must be an absolute normalized path`,
    );
  }
  assertStrictDirectory(dirname(path));
  return path;
}

function assertStrictFile(path, name) {
  const absolute = assertProjectionPath(path, name);
  let metadata;
  try {
    metadata = lstatSync(absolute);
  } catch (cause) {
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      `${name} is unavailable`,
      { path: absolute },
    );
    error.cause = cause;
    throw error;
  }
  assertStrictFileMetadata(metadata, name, absolute);
  return absolute;
}

function assertStrictFileMetadata(metadata, name, path) {
  const ownerMismatch = typeof process.getuid === 'function' && metadata.uid !== process.getuid();
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || ownerMismatch || (metadata.mode & 0o777) !== 0o600
      || metadata.size > MAX_FILE_BYTES) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      `${name} must be a bounded, owner-only, owner-owned, single-link regular file`,
      { path },
    );
  }
}

function fsyncPath(path) {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function createStrictFile(path, bytes) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryExists = false;
  let linked = false;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    temporaryExists = true;
    chmodSync(temporary, 0o600);
    fsyncPath(temporary);
    linkSync(temporary, path);
    linked = true;
    rmSync(temporary);
    temporaryExists = false;
    fsyncPath(dirname(path));
    assertStrictFile(path, 'created hosted admission projection');
  } catch (cause) {
    if (linked) rmSync(path, { force: true });
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      'hosted admission projection refused an existing or unsafe target',
      { path },
    );
    error.cause = cause;
    throw error;
  } finally {
    if (temporaryExists) rmSync(temporary, { force: true });
  }
}

function replaceStrictFile(path, bytes) {
  assertStrictFile(path, 'hosted admission envelope');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    chmodSync(temporary, 0o600);
    fsyncPath(temporary);
    assertStrictFile(path, 'hosted admission envelope');
    renameSync(temporary, path);
    fsyncPath(dirname(path));
  } catch (cause) {
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      'hosted admission envelope could not be replaced atomically',
      { path },
    );
    error.cause = cause;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
  assertStrictFile(path, 'refreshed hosted admission envelope');
}

function readStrictJson(path, name) {
  const absolute = assertProjectionPath(path, name);
  let descriptor;
  let bytes;
  try {
    descriptor = openSync(
      absolute,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_CLOEXEC ?? 0),
    );
    const before = fstatSync(descriptor);
    assertStrictFileMetadata(before, name, absolute);
    bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    assertStrictFileMetadata(after, name, absolute);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw failure(
        'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
        `${name} changed while it was being authenticated`,
        { path: absolute },
      );
    }
  } catch (cause) {
    if (cause?.code?.startsWith?.('SNAPBACK_')) throw cause;
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      `${name} could not be opened without following links`,
      { path: absolute },
    );
    error.cause = cause;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes };
  } catch (cause) {
    const error = failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      `${name} is not valid JSON`,
      { path: absolute },
    );
    error.cause = cause;
    throw error;
  }
}

function keyBytes(keyMaterial) {
  if (!(keyMaterial instanceof Uint8Array) || keyMaterial.byteLength !== 32) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      'keyMaterial must be exactly 32 secret bytes',
    );
  }
  return Buffer.from(keyMaterial);
}

function envelopeBytes(envelope) {
  return Buffer.from(`${canonicalJson(envelope)}\n`);
}

function supportSha256(admission, browserArtifactSha256) {
  assertDigest(browserArtifactSha256, 'browserArtifactSha256');
  const support = {
    hostedAuth: admission.hostedAuth,
    authenticationThrottleConfig: admission.authenticationThrottleConfig,
    operatorSurface: admission.operatorSurface,
    browserDirectBearerSeam: admission.browserDirectBearerSeam,
    browserArtifactSha256,
  };
  return contentIdentity('snapback-hosted-auth-support-v1', support).slice('sha256:'.length);
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength
    && timingSafeEqual(leftBytes, rightBytes);
}

export function createExternalReplayFloorAdvanceReceipt(input) {
  const code = 'SNAPBACK_EXTERNAL_REPLAY_FLOOR_INVALID';
  const content = {
    schemaVersion: FLOOR_ADVANCE_VERSION,
    operationId: input?.operationId,
    deploymentId: input?.deploymentId,
    storeIdentitySha256: input?.storeIdentitySha256,
    previousFloor: input?.previousFloor,
    senderReplayEpochFloor: input?.senderReplayEpochFloor,
    advancedAtMs: input?.advancedAtMs,
  };
  assertId(content.operationId, 'operationId');
  assertId(content.deploymentId, 'deploymentId');
  assertDigest(content.storeIdentitySha256, 'storeIdentitySha256');
  assertSafeInteger(content.previousFloor, 'previousFloor');
  assertSafeInteger(content.senderReplayEpochFloor, 'senderReplayEpochFloor', { minimum: 1 });
  assertSafeInteger(content.advancedAtMs, 'advancedAtMs');
  if (content.senderReplayEpochFloor <= content.previousFloor) {
    throw failure(code, 'external replay floor did not advance monotonically');
  }
  return {
    ...content,
    receiptId: contentIdentity('snapback-external-replay-floor-advance-v1', content),
  };
}

function validateFloorAdvanceReceipt(receipt, expected) {
  const code = 'SNAPBACK_EXTERNAL_REPLAY_FLOOR_INVALID';
  assertClosed(receipt, FLOOR_ADVANCE_KEYS, 'external replay floor advance receipt', code);
  const { receiptId, ...content } = receipt;
  const derived = contentIdentity('snapback-external-replay-floor-advance-v1', content);
  if (receipt.schemaVersion !== FLOOR_ADVANCE_VERSION
      || receipt.operationId !== expected.operationId
      || receipt.deploymentId !== expected.deploymentId
      || receipt.previousFloor !== expected.previousFloor
      || receiptId !== derived
      || receipt.senderReplayEpochFloor <= receipt.previousFloor
      || !DIGEST.test(receipt.storeIdentitySha256)
      || !Number.isSafeInteger(receipt.advancedAtMs)
      || receipt.advancedAtMs < 0) {
    throw failure(
      code,
      'external replay floor advance receipt is stale, malformed, or bound to another boot',
    );
  }
  return receipt;
}

function validateAdmissionTemplate(template, browserArtifactSha256) {
  const code = 'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID';
  assertClosed(template, ADMISSION_TEMPLATE_KEYS, 'hosted admission template', code);
  if ('senderReplayEpochFloor' in template || 'issuedAtMs' in template || 'expiresAtMs' in template) {
    throw failure(code, 'hosted admission template may not pre-author producer-owned dynamic facts');
  }
  if (template.supportSha256 !== supportSha256(template, browserArtifactSha256)) {
    throw failure(
      code,
      'hosted admission support digest does not match the exact browser and support facts',
    );
  }
  return template;
}

export async function prepareHostedAdmissionBoot(options = {}) {
  const operationId = options.operationId ?? randomUUID();
  assertId(operationId, 'operationId');
  assertSafeInteger(options.previousSenderReplayEpochFloor, 'previousSenderReplayEpochFloor');
  if (typeof options.advanceExternalReplayFloor !== 'function') {
    throw failure(
      'SNAPBACK_EXTERNAL_REPLAY_FLOOR_INVALID',
      'advanceExternalReplayFloor must be the adapter-owned atomic store operation',
    );
  }
  const admissionTtlMs = options.admissionTtlMs ?? 120_000;
  assertTtl(admissionTtlMs);
  if (options.previousSenderReplayEpochFloor === Number.MAX_SAFE_INTEGER) {
    throw failure(
      'SNAPBACK_EXTERNAL_REPLAY_FLOOR_INVALID',
      'external replay floor is exhausted and cannot authorize another boot',
    );
  }
  const template = validateAdmissionTemplate(
    options.admissionTemplate,
    options.browserArtifactSha256,
  );
  const envelopePath = assertProjectionPath(options.envelopePath, 'envelopePath');
  const keyPath = assertProjectionPath(options.keyPath, 'keyPath');
  if (envelopePath === keyPath || existsSync(envelopePath) || existsSync(keyPath)) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PROJECTION_UNSAFE',
      'each boot requires distinct, previously unused admission and key projection paths',
    );
  }
  const preflightKey = keyBytes(options.keyMaterial);
  try {
    sealHostedAdmissionEnvelope({
      keyId: options.keyId,
      keyMaterial: preflightKey,
      publicOrigin: options.publicOrigin,
      admission: {
        ...template,
        senderReplayEpochFloor: options.previousSenderReplayEpochFloor + 1,
        issuedAtMs: 0,
        expiresAtMs: 1,
      },
    });
  } finally {
    preflightKey.fill(0);
  }

  const advanceResult = await options.advanceExternalReplayFloor(Object.freeze({
    schemaVersion: 'snapback.external-replay-floor-advance-request.v1',
    operationId,
    deploymentId: template.deploymentId,
    previousFloor: options.previousSenderReplayEpochFloor,
  }));
  const floorReceipt = validateFloorAdvanceReceipt(advanceResult, {
    operationId,
    deploymentId: template.deploymentId,
    previousFloor: options.previousSenderReplayEpochFloor,
  });
  const issuedAtMs = readClock(options.clock);
  if (!Number.isSafeInteger(issuedAtMs + admissionTtlMs)) {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_PRODUCER_INVALID',
      'hosted admission expiry exceeds the safe integer range',
    );
  }
  const admission = {
    ...template,
    senderReplayEpochFloor: floorReceipt.senderReplayEpochFloor,
    issuedAtMs,
    expiresAtMs: issuedAtMs + admissionTtlMs,
  };
  const key = keyBytes(options.keyMaterial);
  let envelope;
  let keyCreated = false;
  try {
    envelope = sealHostedAdmissionEnvelope({
      keyId: options.keyId,
      keyMaterial: key,
      publicOrigin: options.publicOrigin,
      admission,
    });
    const keyFile = {
      schemaVersion: KEY_FILE_VERSION,
      keyId: options.keyId,
      material: key.toString('base64url'),
    };
    createStrictFile(keyPath, Buffer.from(`${canonicalJson(keyFile)}\n`));
    keyCreated = true;
    createStrictFile(envelopePath, envelopeBytes(envelope));
  } catch (cause) {
    if (keyCreated && !existsSync(envelopePath)) rmSync(keyPath, { force: true });
    throw cause;
  } finally {
    key.fill(0);
  }

  const content = {
    schemaVersion: PROJECTION_VERSION,
    operationId,
    deploymentId: admission.deploymentId,
    publicOrigin: envelope.publicOrigin,
    keyId: envelope.keyId,
    browserArtifactSha256: options.browserArtifactSha256,
    configurationSha256: admission.configurationSha256,
    supportSha256: admission.supportSha256,
    handlerProtocolVersion: admission.handlerProtocolVersion,
    handlerIncarnation: admission.handlerIncarnation,
    senderReplayEpochFloor: admission.senderReplayEpochFloor,
    admissionEpoch: admission.admissionEpoch,
    limiterEpoch: admission.limiterEpoch,
    invalidationEpoch: admission.invalidationEpoch,
    issuedAtMs: admission.issuedAtMs,
    expiresAtMs: admission.expiresAtMs,
    externalFloorStoreIdentitySha256: floorReceipt.storeIdentitySha256,
    externalFloorAdvanceReceiptId: floorReceipt.receiptId,
    envelopeSha256: sha256(envelopeBytes(envelope)),
    keyProjectionCreated: true,
    remoteEvidence: false,
  };
  return Object.freeze({
    ...content,
    projectionId: contentIdentity('snapback-hosted-admission-projection-v1', content),
  });
}

export function refreshHostedAdmissionProjection(options = {}) {
  const admissionTtlMs = options.admissionTtlMs ?? 120_000;
  assertTtl(admissionTtlMs);
  const envelopePath = assertProjectionPath(options.envelopePath, 'envelopePath');
  const current = readStrictJson(envelopePath, 'hosted admission envelope').value;
  assertClosed(
    current,
    ENVELOPE_KEYS,
    'hosted admission envelope',
    'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
  );
  if (typeof current.mac !== 'string') {
    throw failure(
      'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
      'current hosted admission envelope has a malformed MAC',
    );
  }
  const key = keyBytes(options.keyMaterial);
  let authenticated;
  let nextEnvelope;
  try {
    authenticated = sealHostedAdmissionEnvelope({
      keyId: options.keyId,
      keyMaterial: key,
      publicOrigin: options.publicOrigin,
      admission: current.admission,
    });
    if (current.schemaVersion !== authenticated.schemaVersion
        || current.keyId !== authenticated.keyId
        || current.publicOrigin !== authenticated.publicOrigin
        || !constantTimeEqual(current.mac ?? '', authenticated.mac)
        || canonicalJson(current.admission) !== canonicalJson(authenticated.admission)) {
      throw failure(
        'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
        'current hosted admission envelope is not authenticated by the supplied provider key',
      );
    }
    const issuedAtMs = readClock(options.clock);
    if (issuedAtMs < current.admission.issuedAtMs
        || !Number.isSafeInteger(issuedAtMs + admissionTtlMs)
        || issuedAtMs + admissionTtlMs <= current.admission.expiresAtMs) {
      throw failure(
        'SNAPBACK_HOSTED_ADMISSION_REFRESH_INVALID',
        'hosted admission refresh must move time and expiry monotonically forward',
      );
    }
    const nextEpochs = {
      admissionEpoch: options.admissionEpoch ?? current.admission.admissionEpoch,
      limiterEpoch: options.limiterEpoch ?? current.admission.limiterEpoch,
      invalidationEpoch: options.invalidationEpoch ?? current.admission.invalidationEpoch,
    };
    for (const [name, value] of Object.entries(nextEpochs)) {
      assertSafeInteger(value, name, { minimum: current.admission[name] });
    }
    const nextAdmission = {
      ...current.admission,
      ...nextEpochs,
      issuedAtMs,
      expiresAtMs: issuedAtMs + admissionTtlMs,
    };
    nextEnvelope = sealHostedAdmissionEnvelope({
      keyId: options.keyId,
      keyMaterial: key,
      publicOrigin: options.publicOrigin,
      admission: nextAdmission,
    });
    replaceStrictFile(envelopePath, envelopeBytes(nextEnvelope));
  } finally {
    key.fill(0);
  }

  const content = {
    schemaVersion: REFRESH_VERSION,
    deploymentId: nextEnvelope.admission.deploymentId,
    publicOrigin: nextEnvelope.publicOrigin,
    keyId: nextEnvelope.keyId,
    configurationSha256: nextEnvelope.admission.configurationSha256,
    supportSha256: nextEnvelope.admission.supportSha256,
    handlerProtocolVersion: nextEnvelope.admission.handlerProtocolVersion,
    handlerIncarnation: nextEnvelope.admission.handlerIncarnation,
    senderReplayEpochFloor: nextEnvelope.admission.senderReplayEpochFloor,
    admissionEpoch: nextEnvelope.admission.admissionEpoch,
    limiterEpoch: nextEnvelope.admission.limiterEpoch,
    invalidationEpoch: nextEnvelope.admission.invalidationEpoch,
    issuedAtMs: nextEnvelope.admission.issuedAtMs,
    expiresAtMs: nextEnvelope.admission.expiresAtMs,
    envelopeSha256: sha256(envelopeBytes(nextEnvelope)),
    remoteEvidence: false,
  };
  return Object.freeze({
    ...content,
    refreshId: contentIdentity('snapback-hosted-admission-refresh-v1', content),
  });
}
