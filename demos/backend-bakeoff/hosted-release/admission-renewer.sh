#!/bin/sh
# @ref LLP 0105#always-on-supervisor-and-canonical-single-writer-head — one
# boot-stable UUIDv7 identifies the target process to the mTLS supervisor.
set -eu

exec node --input-type=module <<'NODE'
import https from 'node:https';
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  createPublicKey,
  randomBytes,
  verify as verifySignature,
} from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MAX_REQUEST_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_AUTHORITY_AGE_MS = 60_000;
const REFRESH_INTERVAL_MS = 25_000;
const EXPECTED_KEYS = [
  'profile',
  'publicOrigin',
  'firstContactTransport',
  'renewal',
  'admission',
  'hostedTargetAdmission',
  'signature',
];
const EDGE_ADMISSION_KEYS = [
  'version',
  'deploymentId',
  'configurationSha256',
  'supportSha256',
  'admissionEpoch',
  'issuedAtMs',
  'expiresAtMs',
  'limiterEpoch',
  'authenticationThrottleConfig',
  'invalidationEpoch',
  'senderReplayEpochFloor',
  'handlerProtocolVersion',
  'handlerIncarnation',
  'operatorSurface',
  'browserDirectBearerSeam',
  'hostedAuth',
];
const TARGET_ADMISSION_KEYS = [
  'schemaVersion',
  'targetId',
  'deploymentId',
  'bindingGeneration',
  'targetBindingSha256',
  'controlHeadSha256',
  'supervisorIncarnation',
  'exactRosterSha256',
  'routedMachineId',
  'hostedAuthExpiresAtMs',
  'routedMachineExpiresAtMs',
  'replayFloor',
  'admissionGeneration',
  'issuedAtMs',
  'signature',
];
const SIGNING_KEY_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function refuse(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requirePortable(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', `${label} is not portable`);
  }
  return value;
}

function readSecret(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    refuse(
      'SNAPBACK_HOSTED_ADMISSION_CLIENT_SECRET_UNSAFE',
      `${path} must be a nonsymlink regular file with no group/other permissions`,
    );
  }
  return readFileSync(path);
}

function uuidV7() {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(Date.now());
  bytes[0] = Number((milliseconds >> 40n) & 0xffn);
  bytes[1] = Number((milliseconds >> 32n) & 0xffn);
  bytes[2] = Number((milliseconds >> 24n) & 0xffn);
  bytes[3] = Number((milliseconds >> 16n) & 0xffn);
  bytes[4] = Number((milliseconds >> 8n) & 0xffn);
  bytes[5] = Number(milliseconds & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactObject(value, keys, label) {
  if (
    value === null
    || Array.isArray(value)
    || typeof value !== 'object'
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', `${label} is not closed`);
  }
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function canonicalSignature(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(value)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', `${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== 64 || decoded.toString('base64url') !== value) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', `${label} is not a 64-byte signature`);
  }
  return decoded;
}

function lengthPrefixedSigningInput(parts) {
  return Buffer.concat(parts.flatMap((part) => {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    return [length, bytes];
  }));
}

function admissionPublicKey() {
  let config;
  try {
    config = JSON.parse(readFileSync(
      process.env.SNAPBACK_HOSTED_CONFIG_PATH ?? '/app/etc/hosted-edge.json',
      'utf8',
    ));
  } catch {
    refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', 'hosted-edge config is unavailable');
  }
  const encoded = config?.admissionPublicKey;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(encoded)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', 'admission public key is invalid');
  }
  const raw = Buffer.from(encoded, 'base64url');
  if (raw.byteLength !== 32 || raw.toString('base64url') !== encoded) {
    refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', 'admission public key is not canonical');
  }
  return createPublicKey({
    key: Buffer.concat([SIGNING_KEY_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function validateBucket(value, label) {
  exactObject(value, ['intervalMs', 'burst', 'maximumDenialDebtAttempts'], label);
  if (
    !positiveSafeInteger(value.intervalMs)
    || !positiveSafeInteger(value.burst)
    || !positiveSafeInteger(value.maximumDenialDebtAttempts)
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', `${label} is invalid`);
  }
}

function validateEnvelope(value, {
  targetId,
  deploymentId,
  machineId,
  nowMs,
  publicKey,
}) {
  exactObject(value, EXPECTED_KEYS, 'admission envelope');
  if (
    value.profile !== 'loopback-terminated-single-instance.v1'
    || value.renewal !== 'online'
    || value.firstContactTransport !== 'hstsPreloadedSuffix'
    || typeof value.publicOrigin !== 'string'
    || !/^https:\/\/[a-z0-9.-]+$/u.test(value.publicOrigin)
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'envelope identity is invalid');
  }
  const admission = value.admission;
  exactObject(admission, EDGE_ADMISSION_KEYS, 'edge admission');
  if (
    admission.version !== 1
    || admission.deploymentId !== deploymentId
    || !/^[0-9a-f]{64}$/u.test(admission.configurationSha256)
    || !/^[0-9a-f]{64}$/u.test(admission.supportSha256)
    || !positiveSafeInteger(admission.admissionEpoch)
    || !positiveSafeInteger(admission.issuedAtMs)
    || !positiveSafeInteger(admission.expiresAtMs)
    || admission.expiresAtMs <= nowMs
    || admission.expiresAtMs <= admission.issuedAtMs
    || admission.expiresAtMs - admission.issuedAtMs > MAX_AUTHORITY_AGE_MS
    || admission.issuedAtMs > nowMs + 5_000
    || admission.limiterEpoch !== admission.admissionEpoch
    || admission.invalidationEpoch !== admission.admissionEpoch
    || !positiveSafeInteger(admission.senderReplayEpochFloor)
    || admission.handlerProtocolVersion !== 1
    || typeof admission.handlerIncarnation !== 'string'
    || admission.handlerIncarnation.length < 1
    || admission.operatorSurface !== 'disabled'
    || admission.browserDirectBearerSeam !== 'excluded'
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'admission lifetime or deployment is invalid');
  }
  exactObject(admission.authenticationThrottleConfig, [
    'retentionMs',
    'maximumKeyCount',
    'global',
    'source',
    'subject',
    'sourceSubject',
    'family',
  ], 'authentication throttle config');
  if (
    !positiveSafeInteger(admission.authenticationThrottleConfig.retentionMs)
    || !positiveSafeInteger(admission.authenticationThrottleConfig.maximumKeyCount)
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'authentication throttle config is invalid');
  }
  for (const bucket of ['global', 'source', 'subject', 'sourceSubject', 'family']) {
    validateBucket(admission.authenticationThrottleConfig[bucket], `authentication throttle ${bucket}`);
  }
  exactObject(admission.hostedAuth, [
    'externalTls',
    'effectiveSource',
    'authenticationThrottle',
    'sessionInvalidation',
    'clientCredentialPosture',
  ], 'hosted auth posture');
  if (
    admission.hostedAuth.externalTls !== 'enforced'
    || admission.hostedAuth.effectiveSource !== 'trusted'
    || admission.hostedAuth.authenticationThrottle !== 'sharedEnforced'
    || admission.hostedAuth.sessionInvalidation !== 'globallyFenced'
    || admission.hostedAuth.clientCredentialPosture !== 'senderConstrainedV2'
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'hosted auth posture is invalid');
  }

  const target = value.hostedTargetAdmission;
  exactObject(target, TARGET_ADMISSION_KEYS, 'hosted target admission');
  if (
    target.schemaVersion !== 'snapback.hosted-admission.v2'
    || target.targetId !== targetId
    || target.deploymentId !== deploymentId
    || !positiveSafeInteger(target.bindingGeneration)
    || !/^sha256:[0-9a-f]{64}$/u.test(target.targetBindingSha256)
    || !/^sha256:[0-9a-f]{64}$/u.test(target.controlHeadSha256)
    || !/^sha256:[0-9a-f]{64}$/u.test(target.exactRosterSha256)
    || typeof target.supervisorIncarnation !== 'string'
    || target.supervisorIncarnation.length < 1
    || target.routedMachineId !== machineId
    || target.hostedAuthExpiresAtMs !== admission.expiresAtMs
    || !positiveSafeInteger(target.routedMachineExpiresAtMs)
    || target.routedMachineExpiresAtMs < target.hostedAuthExpiresAtMs
    || target.replayFloor !== admission.senderReplayEpochFloor
    || target.admissionGeneration !== admission.admissionEpoch
    || target.issuedAtMs !== admission.issuedAtMs
  ) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'hosted target admission is invalid');
  }
  const targetSignature = canonicalSignature(target.signature, 'hosted target admission signature');
  const targetInput = lengthPrefixedSigningInput([
    'snapback.hosted-admission.v2',
    target.schemaVersion,
    target.targetId,
    target.deploymentId,
    String(target.bindingGeneration),
    target.targetBindingSha256,
    target.controlHeadSha256,
    target.supervisorIncarnation,
    target.exactRosterSha256,
    target.routedMachineId,
    String(target.hostedAuthExpiresAtMs),
    String(target.routedMachineExpiresAtMs),
    String(target.replayFloor),
    String(target.admissionGeneration),
    String(target.issuedAtMs),
  ]);
  if (!verifySignature(null, targetInput, publicKey, targetSignature)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'hosted target admission signature is invalid');
  }
  const envelopeSignature = canonicalSignature(value.signature, 'edge admission signature');
  const envelopeInput = lengthPrefixedSigningInput([
    'snapback.hosted-admission.v1',
    value.profile,
    value.publicOrigin,
    value.firstContactTransport,
    value.renewal,
    JSON.stringify(admission),
  ]);
  if (!verifySignature(null, envelopeInput, publicKey, envelopeSignature)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_RESPONSE_INVALID', 'edge admission signature is invalid');
  }
  return admission.expiresAtMs;
}

function writeAtomic0600(path, bytes) {
  const temporary = `${path}.new.${process.pid}`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function requestEnvelope({ endpoint, tls, body }) {
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: 'POST',
      cert: tls.cert,
      key: tls.key,
      ca: tls.ca,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      rejectUnauthorized: true,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 10_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          response.destroy(new Error('response exceeds the admission byte limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(Object.assign(new Error(`supervisor returned HTTP ${response.statusCode}`), {
            code: 'SNAPBACK_HOSTED_ADMISSION_HTTP_REFUSED',
          }));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    request.once('timeout', () => request.destroy(new Error('supervisor request timed out')));
    request.once('error', reject);
    request.end(body);
  });
}

const targetId = requirePortable(process.env.SNAPBACK_HOSTED_TARGET_ID, 'targetId');
const deploymentId = requirePortable(process.env.SNAPBACK_HOSTED_DEPLOYMENT_ID, 'deploymentId');
const machineId = requirePortable(process.env.FLY_MACHINE_ID, 'machineId');
const endpoint = new URL(
  process.env.SNAPBACK_SUPERVISOR_ADMISSION_URL
    ?? 'https://snapback-hosted-supervisor-sjc.internal:8444/v1/target/admission',
);
if (
  endpoint.protocol !== 'https:'
  || endpoint.username !== ''
  || endpoint.password !== ''
  || endpoint.search !== ''
  || endpoint.hash !== ''
  || endpoint.pathname !== '/v1/target/admission'
) {
  refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', 'supervisor URL is not the exact HTTPS endpoint');
}

const outputPath = process.env.SNAPBACK_HOSTED_ADMISSION_PATH ?? '/data/control/admission.json';
const readyPath = '/run/snapback/admission-ready';
const publicKey = admissionPublicKey();
if (process.env.SNAPBACK_HOSTED_ADMISSION_VALIDATE_FIXTURE) {
  const fixture = JSON.parse(readFileSync(
    process.env.SNAPBACK_HOSTED_ADMISSION_VALIDATE_FIXTURE,
    'utf8',
  ));
  validateEnvelope(fixture, {
    targetId,
    deploymentId,
    machineId,
    nowMs: Date.now(),
    publicKey,
  });
  process.exit(0);
}
const tls = {
  key: readSecret('/run/secrets/supervisor-target-client-key.pem'),
  cert: readSecret('/run/secrets/supervisor-target-client-cert.pem'),
  ca: readSecret('/run/secrets/supervisor-server-ca.pem'),
};
const processBootId = uuidV7();
const requestBody = JSON.stringify({
  schemaVersion: 'snapback.hosted-target-admission-request.v1',
  targetId,
  machineId,
  processBootId,
});
if (Buffer.byteLength(requestBody) > MAX_REQUEST_BYTES) {
  refuse('SNAPBACK_HOSTED_ADMISSION_CLIENT_CONFIG_INVALID', 'admission request exceeds 4 KiB');
}

let authorityDeadline = performance.now() + MAX_AUTHORITY_AGE_MS;
let authorityWatchdog;
function armAuthorityWatchdog() {
  clearTimeout(authorityWatchdog);
  authorityWatchdog = setTimeout(() => {
    process.stderr.write('SNAPBACK_HOSTED_ADMISSION_EXPIRED: no valid renewal before the watchdog deadline\n');
    process.exit(75);
  }, Math.max(0, authorityDeadline - performance.now()));
}
armAuthorityWatchdog();
let first = true;
while (true) {
  try {
    const response = await requestEnvelope({ endpoint, tls, body: requestBody });
    const parsed = JSON.parse(response.toString('utf8'));
    const nowMs = Date.now();
    const expiresAtMs = validateEnvelope(parsed, {
      targetId,
      deploymentId,
      machineId,
      nowMs,
      publicKey,
    });
    const canonicalBytes = Buffer.from(`${JSON.stringify(parsed)}\n`);
    writeAtomic0600(outputPath, canonicalBytes);
    const remainingMs = Math.max(0, expiresAtMs - nowMs);
    authorityDeadline = performance.now() + Math.min(MAX_AUTHORITY_AGE_MS, remainingMs);
    armAuthorityWatchdog();
    if (first) {
      writeAtomic0600(readyPath, Buffer.from('ready\n'));
      first = false;
    }
  } catch (error) {
    const code = typeof error?.code === 'string'
      ? error.code
      : 'SNAPBACK_HOSTED_ADMISSION_REFRESH_FAILED';
    process.stderr.write(`${code}: admission refresh failed\n`);
  }

  const waitMs = Math.min(REFRESH_INTERVAL_MS, authorityDeadline - performance.now());
  if (waitMs <= 0) {
    process.stderr.write('SNAPBACK_HOSTED_ADMISSION_EXPIRED: no valid renewal before the watchdog deadline\n');
    process.exit(75);
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
NODE
