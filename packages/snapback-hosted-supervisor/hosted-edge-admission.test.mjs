import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  verify,
} from 'node:crypto';

import {
  certificateSha256,
  configurationDigest,
  mintOnlineHostedAdmission,
  publicKeyForSeed,
  validateHostedTargetEnrollment,
} from './hosted-edge-admission.mjs';

const PRIVATE_KEY_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
// Fixed cross-language vector: this exact envelope was also minted by the
// Rust `snapback-hosted-admission` binary and compared byte-for-byte.
const seed = Buffer.alloc(32, 7).toString('base64url');
const enrollment = {
  schemaVersion: 'snapback.hosted-target-enrollment.v1',
  targetId: 'snapback-drill-hosted-v2-20260728',
  deploymentId: 'snapback-drill-hosted-v2-1',
  publicOrigin: 'https://snapback-drill.fly.dev',
  firstContactTransport: 'hstsPreloadedSuffix',
  admissionPublicKey: publicKeyForSeed(seed),
  supportSha256: 'a'.repeat(64),
  signingSeedCredentialRef: '/run/secrets/target-snapback-drill-admission-seed',
  clientCertificateSha256: `sha256:${'b'.repeat(64)}`,
};

assert.deepEqual(validateHostedTargetEnrollment(enrollment, seed), enrollment);
assert.equal(
  enrollment.admissionPublicKey,
  '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw',
);
assert.equal(
  configurationDigest(enrollment),
  '7058c322a10ba68fea43a4d7c02a7346f2c1bd424782ef033d63f71e4def4470',
);
assert.equal(
  certificateSha256(Buffer.from('certificate')),
  'sha256:03d66dd08835c1ca3f128cceacd1f31ac94163096b20f445ae84285bc0832d72',
);

const envelope = mintOnlineHostedAdmission({
  enrollment,
  signingSeed: seed,
  targetAuthority: {
    bindingGeneration: 3,
    targetBindingSha256: `sha256:${'c'.repeat(64)}`,
    controlHeadSha256: `sha256:${'d'.repeat(64)}`,
    supervisorIncarnation: 'supervisor-1',
    exactRosterSha256: `sha256:${'e'.repeat(64)}`,
    routedMachineId: 'machine-1',
    routedMachineExpiresAtMs: 61_000,
  },
  admissionEpoch: 7,
  senderReplayEpochFloor: 11,
  issuedAtMs: 1_000,
  expiresAtMs: 61_000,
});
assert.equal(envelope.renewal, 'online');
assert.equal(envelope.admission.expiresAtMs - envelope.admission.issuedAtMs, 60_000);
assert.equal(envelope.admission.configurationSha256, configurationDigest(enrollment));
assert.equal(envelope.hostedTargetAdmission.schemaVersion, 'snapback.hosted-admission.v2');
assert.equal(envelope.hostedTargetAdmission.targetId, enrollment.targetId);
assert.equal(envelope.hostedTargetAdmission.bindingGeneration, 3);
assert.equal(envelope.hostedTargetAdmission.replayFloor, 11);
assert.equal(envelope.hostedTargetAdmission.admissionGeneration, 7);
assert.match(envelope.hostedTargetAdmission.signature, /^[A-Za-z0-9_-]{86}$/);
assert.equal(
  envelope.signature,
  'JsYc9EH-9Ih5xWxDfgpxAhnljlke1ZCitFkRoqrahsBdyP-3lwKYwG2QwIZjQp1qg9VKYCAI3UoJgnedrhXxCA',
);

function lengthPrefix(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([length, bytes]);
}

const signingInput = Buffer.concat([
  Buffer.from('snapback.hosted-admission.v1'),
  Buffer.from('loopback-terminated-single-instance.v1'),
  Buffer.from(enrollment.publicOrigin),
  Buffer.from(enrollment.firstContactTransport),
  Buffer.from('online'),
  Buffer.from(JSON.stringify(envelope.admission)),
].map(lengthPrefix));
const privateKey = createPrivateKey({
  key: Buffer.concat([PRIVATE_KEY_PREFIX, Buffer.from(seed, 'base64url')]),
  format: 'der',
  type: 'pkcs8',
});
assert.equal(
  verify(
    null,
    signingInput,
    createPublicKey(privateKey),
    Buffer.from(envelope.signature, 'base64url'),
  ),
  true,
);

const targetSigningInput = Buffer.concat([
  Buffer.from('snapback.hosted-admission.v2'),
  envelope.hostedTargetAdmission.schemaVersion,
  envelope.hostedTargetAdmission.targetId,
  envelope.hostedTargetAdmission.deploymentId,
  String(envelope.hostedTargetAdmission.bindingGeneration),
  envelope.hostedTargetAdmission.targetBindingSha256,
  envelope.hostedTargetAdmission.controlHeadSha256,
  envelope.hostedTargetAdmission.supervisorIncarnation,
  envelope.hostedTargetAdmission.exactRosterSha256,
  envelope.hostedTargetAdmission.routedMachineId,
  String(envelope.hostedTargetAdmission.hostedAuthExpiresAtMs),
  String(envelope.hostedTargetAdmission.routedMachineExpiresAtMs),
  String(envelope.hostedTargetAdmission.replayFloor),
  String(envelope.hostedTargetAdmission.admissionGeneration),
  String(envelope.hostedTargetAdmission.issuedAtMs),
].map(lengthPrefix));
assert.equal(
  verify(
    null,
    targetSigningInput,
    createPublicKey(privateKey),
    Buffer.from(envelope.hostedTargetAdmission.signature, 'base64url'),
  ),
  true,
);
const tamperedTargetSigningInput = Buffer.from(targetSigningInput);
tamperedTargetSigningInput[tamperedTargetSigningInput.length - 1] ^= 1;
assert.equal(
  verify(
    null,
    tamperedTargetSigningInput,
    createPublicKey(privateKey),
    Buffer.from(envelope.hostedTargetAdmission.signature, 'base64url'),
  ),
  false,
);

assert.throws(
  () => mintOnlineHostedAdmission({
    enrollment,
    signingSeed: seed,
    targetAuthority: {
      bindingGeneration: 3,
      targetBindingSha256: `sha256:${'c'.repeat(64)}`,
      controlHeadSha256: `sha256:${'d'.repeat(64)}`,
      supervisorIncarnation: 'supervisor-1',
      exactRosterSha256: `sha256:${'e'.repeat(64)}`,
      routedMachineId: 'machine-1',
      routedMachineExpiresAtMs: 61_001,
    },
    admissionEpoch: 8,
    senderReplayEpochFloor: 11,
    issuedAtMs: 1_000,
    expiresAtMs: 61_001,
  }),
  (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_INVALID',
);
assert.throws(
  () => mintOnlineHostedAdmission({
    enrollment,
    signingSeed: seed,
    targetAuthority: {
      bindingGeneration: 3,
      targetBindingSha256: `sha256:${'c'.repeat(64)}`,
      controlHeadSha256: `sha256:${'d'.repeat(64)}`,
      supervisorIncarnation: 'supervisor-1',
      exactRosterSha256: `sha256:${'e'.repeat(64)}`,
      routedMachineId: 'machine-1',
      routedMachineExpiresAtMs: 60_999,
    },
    admissionEpoch: 8,
    senderReplayEpochFloor: 11,
    issuedAtMs: 1_000,
    expiresAtMs: 61_000,
  }),
  (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_V2_STALE',
);
assert.throws(
  () => validateHostedTargetEnrollment({ ...enrollment, unknown: true }),
  (error) => error.code === 'SNAPBACK_HOSTED_TARGET_ENROLLMENT_INVALID',
);
assert.throws(
  () => validateHostedTargetEnrollment(enrollment, randomBytes(32).toString('base64url')),
  (error) => error.code === 'SNAPBACK_HOSTED_ADMISSION_SIGNING_KEY_INVALID',
);

console.log('snapback-hosted-supervisor: hosted edge online admission corpus passed');
