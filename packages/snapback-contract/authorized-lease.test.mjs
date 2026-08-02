import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  authorizedLeaseActivationHash,
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS,
  SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION,
  validateAuthorizedLease,
  validateAuthorizedLeaseCapability,
} from './authorized-lease.mjs';

assert.equal(authorizedLeaseActivationHash({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: 'app-test',
  schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
  bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
  inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
}), 'snapback.authorized-lease.activation.v1:sha256:d32507a87be992df54d41d42160789787b0759629d5b43cac1b2c829b4e6cc97');
assert.throws(() => authorizedLeaseActivationHash({
  schemaVersion: 'snapback.v1',
  authMode: 'sessions',
  appId: '',
  schemaHash: 'schema',
  bundleHash: 'bundle',
  inputsHash: 'inputs',
}), /non-empty appId/);

const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const LEGACY_AUTHORITY_INSTANCE = '018f0d90-7b12-7a22-8c33-445566778899';
const AUTHORITY_INSTANCE = 'aut_3z3g2wp3bf7gde5jmat82dze4d';
const ACTIVATION_HASH = `snapback.authorized-lease.activation.v1:sha256:${'a'.repeat(64)}`;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const lease = {
  protocolVersion: SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION,
  leaseId: 'lease_1',
  leaseRequestId: 'request_1',
  issuerId: {
    authorizationIncarnation: INCARNATION,
    bootSequence: 7,
    bootNonce: 'AAAAAAAAAAAAAAAAAAAAAA',
  },
  clientStoreId: 'store_1',
  queryKey: 'myHand:{"gameId":"g1"}',
  queryInstanceId: 3,
  principalId: 'user_1',
  sessionIdAtIssue: 'session_1',
  providerKey: 'email-code',
  authorization: { incarnation: INCARNATION, epoch: 4 },
  data: { versionStream: 'stream_1', snapshotCommitVersion: 99 },
  activationHash: ACTIVATION_HASH,
  issuedAtServerMs: 1_000,
  authorizedUntilServerMs: 1_000 + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  sessionNotAfterMs: 1_000 + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  providerNotAfterMs: null,
  authorityInstanceId: AUTHORITY_INSTANCE,
  keyId: 'lease-key-1',
  mac: 'A'.repeat(43),
};

assert.deepEqual(validateAuthorizedLease(lease), lease);
assert.doesNotThrow(() => validateAuthorizedLease({
  ...lease,
  authorityInstanceId: LEGACY_AUTHORITY_INSTANCE,
}));
assert.doesNotThrow(() => validateAuthorizedLease({ ...lease, queryKey: 'é'.repeat(4_096) }));
assert.throws(
  () => validateAuthorizedLease({ ...lease, queryKey: 'é'.repeat(4_097) }),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_CORRUPT' },
);
const expectedHash = createHash('sha256')
  .update(`snapback.authorized-lease.hash.v1\n${JSON.stringify(canonical(lease))}`, 'utf8')
  .digest('hex');
assert.equal(authorizedLeaseHash(lease), `sha256:${expectedHash}`);

const request = {
  leaseRequestId: lease.leaseRequestId,
  queryInstanceId: lease.queryInstanceId,
  queryGeneration: 8,
  startedClientMs: 5_000,
};
const expected = {
  clientStoreId: lease.clientStoreId,
  queryKey: lease.queryKey,
  queryInstanceId: lease.queryInstanceId,
  principalId: lease.principalId,
  authorization: lease.authorization,
  versionStream: lease.data.versionStream,
  activationHash: lease.activationHash,
  authorityInstanceId: lease.authorityInstanceId,
};
assert.deepEqual(deriveAuthorizedLeaseCommit({
  lease,
  request,
  expected,
  clientNowMs: 5_001,
}), {
  lease,
  leaseHash: `sha256:${expectedHash}`,
  clientDeadlineMs: 5_000 + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
});

for (const [field, value] of [
  ['clientStoreId', 'other-store'],
  ['queryKey', 'other:{}'],
  ['queryInstanceId', 4],
  ['principalId', 'other-user'],
  ['authorization', { incarnation: INCARNATION, epoch: 5 }],
  ['data', { versionStream: 'other-stream', snapshotCommitVersion: 99 }],
  ['activationHash', `snapback.authorized-lease.activation.v1:sha256:${'b'.repeat(64)}`],
  ['authorityInstanceId', null],
]) {
  assert.throws(
    () => deriveAuthorizedLeaseCommit({
      lease: { ...lease, [field]: value },
      request,
      expected,
      clientNowMs: 5_001,
    }),
    { code: 'SNAPBACK_AUTHORIZED_LEASE_BINDING_MISMATCH' },
  );
}

assert.throws(
  () => validateAuthorizedLease({
    ...lease,
    authorizedUntilServerMs: lease.issuedAtServerMs + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS + 1,
    sessionNotAfterMs: lease.issuedAtServerMs + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS + 1,
  }),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_CORRUPT' },
);
assert.throws(
  () => deriveAuthorizedLeaseCommit({
    lease,
    request,
    expected,
    clientNowMs: request.startedClientMs + SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  }),
  { code: 'SNAPBACK_AUTHORIZED_LEASE_EXPIRED' },
);

// ENG-24992 verification locus (LLP 0053 §The lease, dated amendment): the
// client holds no verifier key, so custody validation checks canonical MAC
// FORM only. A non-canonical MAC is corruption; a canonically shaped MAC with
// one flipped bit passes custody validation BY DESIGN and is refused by the
// server's keyed verifier (src/auth/lease.rs). The custody hash still pins the
// exact issued bytes, so the flip is detected as substitution after commit.
for (const mac of [
  'A'.repeat(42), // too short for 256 bits
  'A'.repeat(44), // too long
  `${'A'.repeat(42)}B`, // trailing char leaves non-zero padding bits
  `${'A'.repeat(42)}=`, // padded/non-base64url alphabet
  `+${'A'.repeat(42)}`, // base64 (not base64url) alphabet
]) {
  assert.throws(
    () => validateAuthorizedLease({ ...lease, mac }),
    { code: 'SNAPBACK_AUTHORIZED_LEASE_CORRUPT' },
    `mac form ${JSON.stringify(mac)} must be corrupt`,
  );
}
const flippedMacBytes = Buffer.from(lease.mac, 'base64url');
flippedMacBytes[0] ^= 0x01;
const flippedMac = flippedMacBytes.toString('base64url');
assert.notEqual(flippedMac, lease.mac);
const flippedLease = { ...lease, mac: flippedMac };
// Custody validation accepts the canonical shape (documented limitation)...
assert.deepEqual(validateAuthorizedLease(flippedLease), flippedLease);
const flippedCommit = deriveAuthorizedLeaseCommit({
  lease: flippedLease,
  request,
  expected,
  clientNowMs: 5_001,
});
// ...but one flipped MAC bit changes the custody hash, so a lease substituted
// after commit fails the stored-hash equality and deletes before read
// (client-store.mjs getAuthorizedRetainedQuery; exercised end to end in
// authorized-retained-store.test.mjs).
assert.notEqual(flippedCommit.leaseHash, authorizedLeaseHash(lease));

// keyId is opaque to the client: an unknown key cannot be detected here and
// fails closed at the server keyring instead (LLP 0053: unknown keys fail
// closed).
assert.doesNotThrow(() => validateAuthorizedLease({ ...lease, keyId: 'unknown-key-9' }));

assert.deepEqual(validateAuthorizedLeaseCapability({
  protocolVersion: 1,
  defaultMs: SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS,
  hardMaxMs: SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  configuredMs: 60_000,
  clamps: ['session', 'provider'],
  renewal: 'full-revalidation',
  timeBasis: 'server-absolute+client-request-elapsed',
  clockRollback: 'delete-before-read',
}), {
  protocolVersion: 1,
  defaultMs: SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS,
  hardMaxMs: SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  configuredMs: 60_000,
  clamps: ['session', 'provider'],
  renewal: 'full-revalidation',
  timeBasis: 'server-absolute+client-request-elapsed',
  clockRollback: 'delete-before-read',
});

console.log('authorized-lease.test.mjs: all assertions passed');
