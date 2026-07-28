// Online admission minting for the one routed Fly target.
//
// @ref LLP 0111#always-on-supervisor-and-canonical-single-writer-head — the
// shared supervisor owns the signing half and mints only after an exact,
// read-back-verified routed-Machine observation.
// @ref LLP 0098#2-producing-an-admission-the-control-plane-contract — the
// release carries only the Ed25519 public half and independently verifies the
// exact length-prefixed signing input below.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from 'node:crypto';

import { SupervisorRefusal } from './index.mjs';

const HOSTED_EDGE_PROFILE = 'loopback-terminated-single-instance.v1';
const SIGNING_DOMAIN = Buffer.from('snapback.hosted-admission.v1');
const TARGET_SIGNING_DOMAIN = Buffer.from('snapback.hosted-admission.v2');
const PRIVATE_KEY_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const MAX_TTL_MS = 60_000;
const EXACT_PROFILE_KEYS = [
  'schemaVersion',
  'targetId',
  'deploymentId',
  'publicOrigin',
  'firstContactTransport',
  'admissionPublicKey',
  'supportSha256',
  'signingSeedCredentialRef',
  'clientCertificateSha256',
];

function refuse(code, message) {
  throw new SupervisorRefusal(code, message);
}

function requireClosed(value, keys, label) {
  if (
    !value
    || Array.isArray(value)
    || typeof value !== 'object'
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    refuse('SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID', `${label} is not closed`);
  }
}

function requirePortableId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)) {
    refuse('SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID', `${label} is not portable`);
  }
}

function decodeBase64Url(value, bytes, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    refuse('SNAPBACK_HOSTED_ADMISSION_SIGNING_KEY_INVALID', `${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.byteLength !== bytes || decoded.toString('base64url') !== value) {
    refuse('SNAPBACK_HOSTED_ADMISSION_SIGNING_KEY_INVALID', `${label} has the wrong size`);
  }
  return decoded;
}

function lengthPrefix(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([length, bytes]);
}

function firstContactWire(value) {
  const values = new Set([
    'hstsPreloadedHost',
    'hstsPreloadedSuffix',
    'installTimeHttpsOnlyBinding',
  ]);
  if (!values.has(value)) {
    refuse(
      'SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID',
      'first-contact transport is unsupported',
    );
  }
  return value;
}

export function publicKeyForSeed(seedBase64Url) {
  const seed = decodeBase64Url(seedBase64Url, 32, 'admission signing seed');
  const privateKey = createPrivateKey({
    key: Buffer.concat([PRIVATE_KEY_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return Buffer.from(publicDer).subarray(-32).toString('base64url');
}

export function validateHostedTargetEnrollment(enrollment, signingSeed = null) {
  requireClosed(enrollment, EXACT_PROFILE_KEYS, 'hosted target enrollment');
  if (enrollment.schemaVersion !== 'snapback.hosted-target-enrollment.v1') {
    refuse('SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID', 'unknown enrollment version');
  }
  requirePortableId(enrollment.targetId, 'targetId');
  requirePortableId(enrollment.deploymentId, 'deploymentId');
  if (
    typeof enrollment.publicOrigin !== 'string'
    || !/^https:\/\/[a-z0-9.-]+$/.test(enrollment.publicOrigin)
    || new URL(enrollment.publicOrigin).origin !== enrollment.publicOrigin
  ) {
    refuse('SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID', 'public origin is not canonical HTTPS');
  }
  firstContactWire(enrollment.firstContactTransport);
  decodeBase64Url(enrollment.admissionPublicKey, 32, 'admission public key');
  if (!/^[0-9a-f]{64}$/.test(enrollment.supportSha256)) {
    refuse('SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID', 'support digest is not lowercase SHA-256');
  }
  if (
    typeof enrollment.signingSeedCredentialRef !== 'string'
    || !enrollment.signingSeedCredentialRef.startsWith('/run/secrets/')
    || enrollment.signingSeedCredentialRef.includes('..')
  ) {
    refuse(
      'SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID',
      'signing seed must be a projected supervisor secret',
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(enrollment.clientCertificateSha256)) {
    refuse(
      'SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID',
      'client certificate fingerprint is not lowercase SHA-256',
    );
  }
  if (signingSeed !== null && publicKeyForSeed(signingSeed) !== enrollment.admissionPublicKey) {
    refuse(
      'SNAPBACK_HOSTED_ADMISSION_SIGNING_KEY_INVALID',
      'signing seed does not match the release-bound public key',
    );
  }
  return structuredClone(enrollment);
}

export function configurationDigest(enrollment) {
  validateHostedTargetEnrollment(enrollment);
  const parts = [
    'snapback.hosted-configuration.v1',
    HOSTED_EDGE_PROFILE,
    enrollment.publicOrigin,
    firstContactWire(enrollment.firstContactTransport),
    'loopback',
    'operator-disabled',
    decodeBase64Url(enrollment.admissionPublicKey, 32, 'admission public key'),
  ];
  const digest = createHash('sha256');
  for (const part of parts) digest.update(lengthPrefix(part));
  return digest.digest('hex');
}

function bucket(burst) {
  return {
    intervalMs: 1_000,
    burst,
    maximumDenialDebtAttempts: 64,
  };
}

function admissionSigningInput(enrollment, admission) {
  const parts = [
    SIGNING_DOMAIN,
    HOSTED_EDGE_PROFILE,
    enrollment.publicOrigin,
    firstContactWire(enrollment.firstContactTransport),
    'online',
    JSON.stringify(admission),
  ];
  return Buffer.concat(parts.map(lengthPrefix));
}

function targetAdmissionSigningInput(admission) {
  const parts = [
    TARGET_SIGNING_DOMAIN,
    admission.schemaVersion,
    admission.targetId,
    admission.deploymentId,
    String(admission.bindingGeneration),
    admission.targetBindingSha256,
    admission.controlHeadSha256,
    admission.supervisorIncarnation,
    admission.exactRosterSha256,
    admission.routedMachineId,
    String(admission.hostedAuthExpiresAtMs),
    String(admission.routedMachineExpiresAtMs),
    String(admission.replayFloor),
    String(admission.admissionGeneration),
    String(admission.issuedAtMs),
  ];
  return Buffer.concat(parts.map(lengthPrefix));
}

function requireDigest(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? '')) {
    refuse('SNAPBACK_HOSTED_ADMISSION_V2_INVALID', `${label} is not lowercase SHA-256`);
  }
}

function mintHostedTargetAdmission({
  enrollment,
  signingSeed,
  targetAuthority,
  admissionEpoch,
  senderReplayEpochFloor,
  issuedAtMs,
  expiresAtMs,
}) {
  requireClosed(targetAuthority, [
    'bindingGeneration',
    'targetBindingSha256',
    'controlHeadSha256',
    'supervisorIncarnation',
    'exactRosterSha256',
    'routedMachineId',
    'routedMachineExpiresAtMs',
  ], 'hosted target authority');
  requireDigest(targetAuthority.targetBindingSha256, 'targetBindingSha256');
  requireDigest(targetAuthority.controlHeadSha256, 'controlHeadSha256');
  requireDigest(targetAuthority.exactRosterSha256, 'exactRosterSha256');
  for (const [label, value] of [
    ['bindingGeneration', targetAuthority.bindingGeneration],
    ['routedMachineExpiresAtMs', targetAuthority.routedMachineExpiresAtMs],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      refuse('SNAPBACK_HOSTED_ADMISSION_V2_INVALID', `${label} is not positive`);
    }
  }
  for (const [label, value] of [
    ['supervisorIncarnation', targetAuthority.supervisorIncarnation],
    ['routedMachineId', targetAuthority.routedMachineId],
  ]) requirePortableId(value, label);
  if (
    targetAuthority.routedMachineExpiresAtMs < expiresAtMs
    || expiresAtMs <= issuedAtMs
  ) {
    refuse(
      'SNAPBACK_HOSTED_ADMISSION_V2_STALE',
      'routed Machine authority does not cover the hosted auth envelope',
    );
  }
  const admission = {
    schemaVersion: 'snapback.hosted-admission.v2',
    targetId: enrollment.targetId,
    deploymentId: enrollment.deploymentId,
    bindingGeneration: targetAuthority.bindingGeneration,
    targetBindingSha256: targetAuthority.targetBindingSha256,
    controlHeadSha256: targetAuthority.controlHeadSha256,
    supervisorIncarnation: targetAuthority.supervisorIncarnation,
    exactRosterSha256: targetAuthority.exactRosterSha256,
    routedMachineId: targetAuthority.routedMachineId,
    hostedAuthExpiresAtMs: expiresAtMs,
    routedMachineExpiresAtMs: targetAuthority.routedMachineExpiresAtMs,
    replayFloor: senderReplayEpochFloor,
    admissionGeneration: admissionEpoch,
    issuedAtMs,
  };
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      PRIVATE_KEY_PREFIX,
      decodeBase64Url(signingSeed, 32, 'admission signing seed'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    ...admission,
    signature: sign(null, targetAdmissionSigningInput(admission), privateKey)
      .toString('base64url'),
  };
}

export function mintOnlineHostedAdmission({
  enrollment,
  signingSeed,
  targetAuthority,
  admissionEpoch,
  senderReplayEpochFloor,
  issuedAtMs,
  expiresAtMs,
}) {
  validateHostedTargetEnrollment(enrollment, signingSeed);
  for (const [name, value] of [
    ['admissionEpoch', admissionEpoch],
    ['senderReplayEpochFloor', senderReplayEpochFloor],
    ['issuedAtMs', issuedAtMs],
    ['expiresAtMs', expiresAtMs],
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      refuse('SNAPBACK_HOSTED_ADMISSION_INVALID', `${name} is not a positive safe integer`);
    }
  }
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > MAX_TTL_MS) {
    refuse(
      'SNAPBACK_HOSTED_ADMISSION_INVALID',
      'online admission lifetime must be positive and at most 60 seconds',
    );
  }
  const admission = {
    version: 1,
    deploymentId: enrollment.deploymentId,
    configurationSha256: configurationDigest(enrollment),
    supportSha256: enrollment.supportSha256,
    admissionEpoch,
    issuedAtMs,
    expiresAtMs,
    limiterEpoch: admissionEpoch,
    authenticationThrottleConfig: {
      retentionMs: 600_000,
      maximumKeyCount: 100_000,
      global: bucket(2_000),
      source: bucket(600),
      subject: bucket(300),
      sourceSubject: bucket(200),
      family: bucket(300),
    },
    invalidationEpoch: admissionEpoch,
    senderReplayEpochFloor,
    handlerProtocolVersion: 1,
    handlerIncarnation: `incarnation-${admissionEpoch}`,
    operatorSurface: 'disabled',
    browserDirectBearerSeam: 'excluded',
    hostedAuth: {
      externalTls: 'enforced',
      effectiveSource: 'trusted',
      authenticationThrottle: 'sharedEnforced',
      sessionInvalidation: 'globallyFenced',
      clientCredentialPosture: 'senderConstrainedV2',
    },
  };
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      PRIVATE_KEY_PREFIX,
      decodeBase64Url(signingSeed, 32, 'admission signing seed'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    profile: HOSTED_EDGE_PROFILE,
    publicOrigin: enrollment.publicOrigin,
    firstContactTransport: enrollment.firstContactTransport,
    renewal: 'online',
    admission,
    hostedTargetAdmission: mintHostedTargetAdmission({
      enrollment,
      signingSeed,
      targetAuthority,
      admissionEpoch,
      senderReplayEpochFloor,
      issuedAtMs,
      expiresAtMs,
    }),
    signature: sign(null, admissionSigningInput(enrollment, admission), privateKey)
      .toString('base64url'),
  };
}

export function certificateSha256(rawCertificate) {
  if (!Buffer.isBuffer(rawCertificate) || rawCertificate.byteLength === 0) {
    refuse(
      'SNAPBACK_HOSTED_TARGET_CLIENT_CERTIFICATE_INVALID',
      'target client certificate bytes are unavailable',
    );
  }
  return `sha256:${createHash('sha256').update(rawCertificate).digest('hex')}`;
}
