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
const AUTHORITY_INSTANCE = '018f0d90-7b12-7a22-8c33-445566778899';
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
