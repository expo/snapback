import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import {
  OperatorAuthorityRefusal,
  SUPERVISOR_REQUEST_REGISTRY,
  SUPERVISOR_SCOPE_VOCABULARY,
  SupervisorOperatorAuthority,
  __operatorAuthorityTest,
  operatorRequestBodySha256,
  operatorRequestSigningBytes,
} from './operator-authority.mjs';

const EXPECTED_VARIANTS = [
  'backup.apply',
  'backup.confirm',
  'backup.plan',
  'backup.reconcile',
  'capability.publication.confirm',
  'capability.publication.finalize',
  'capability.publication.plan',
  'capability.publication.provision',
  'capability.publication.reconcile',
  'capability.publication.renew',
  'capability.publication.withdraw',
  'cleanup.apply',
  'cleanup.confirm',
  'cleanup.plan',
  'cleanup.reconcile',
  'deploy.apply',
  'deploy.confirm',
  'deploy.plan',
  'deploy.reconcile',
  'operator.certificate.renew',
  'operator.delegation.apply',
  'operator.delegation.confirm',
  'operator.delegation.plan',
  'operator.device.list',
  'operator.device.rebind',
  'operator.device.revoke',
  'operator.enrollment.consume',
  'operator.enrollment.issue',
  'release.upload',
  'restore.activate',
  'restore.apply',
  'restore.confirm',
  'restore.plan',
  'restore.reconcile',
  'rollback.apply',
  'rollback.confirm',
  'rollback.plan',
  'rollback.reconcile',
  'root.intermediate.issue',
  'root.intermediate.renew',
  'root.intermediate.rotate',
  'root.intermediate.unseal',
  'root.recover.apply',
  'root.recover.confirm',
  'root.recover.plan',
  'root.rotate.apply',
  'root.rotate.confirm',
  'root.rotate.plan',
  'supervisor.cost',
  'supervisor.doctor',
  'supervisor.inspect',
  'supervisor.inspect-admin',
  'supervisor.logs',
  'target.rebind',
  'target.register',
];

const nowMs = 1_800_000_000_000;
const installationId = 'installation-fixture';
const rootKeyId = 'root-fixture';
const certificateSha256 = `sha256:${'a'.repeat(64)}`;
const targetHeadSha256 = `sha256:${'b'.repeat(64)}`;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function makeAuthority(scopes = SUPERVISOR_SCOPE_VOCABULARY) {
  const authority = new SupervisorOperatorAuthority({
    installationId,
    rootKeyId,
    nowMs,
  });
  authority.registerDevice({
    deviceId: 'device-a',
    deviceKeyId: 'device-key-a',
    subject: 'operator@example.test',
    publicKeyPem,
    effectiveScopes: scopes,
    certificateSha256,
    certificateExpiresAtMs: nowMs + 3_600_000,
    nowMs,
  });
  return authority;
}

function signedRequest({
  requestId = 'request-1',
  sequence = 1,
  variant = 'deploy.plan',
  scope = SUPERVISOR_REQUEST_REGISTRY[variant]?.scopes[0] ?? null,
  body = { releaseSha256: `sha256:${'c'.repeat(64)}` },
  issuedAtMs = nowMs - 1_000,
  expiresAtMs = nowMs + 60_000,
  certificateExpiresAtMs = nowMs + 3_600_000,
  certificateRevocationGeneration = 1,
  observedRevocationGeneration = 1,
  credentialBearing = false,
  deviceId = 'device-a',
  deviceKeyId = 'device-key-a',
  subject = 'operator@example.test',
  operatorCertificateSha256 = certificateSha256,
} = {}) {
  const request = {
    schemaVersion: __operatorAuthorityTest.REQUEST_SCHEMA_VERSION,
    installationId,
    rootKeyId,
    deviceId,
    deviceKeyId,
    subject,
    operatorCertificateSha256,
    certificateExpiresAtMs,
    certificateRevocationGeneration,
    observedRevocationGeneration,
    sequence,
    requestId,
    variant,
    scope,
    targetHeadSha256,
    body,
    bodySha256: operatorRequestBodySha256(body),
    credentialBearing,
    issuedAtMs,
    expiresAtMs,
    signature: '',
  };
  request.signature = sign(null, operatorRequestSigningBytes(request), privateKey).toString('base64url');
  return request;
}

function expectRefusal(code, callback, status = undefined) {
  assert.throws(callback, (error) => {
    assert(error instanceof OperatorAuthorityRefusal);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

async function expectAsyncRefusal(code, promise, status = undefined) {
  await assert.rejects(promise, (error) => {
    assert(error instanceof OperatorAuthorityRefusal);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    return true;
  });
}

assert.deepEqual(Object.keys(SUPERVISOR_REQUEST_REGISTRY).sort(), EXPECTED_VARIANTS);
assert.equal(new Set(SUPERVISOR_SCOPE_VOCABULARY).size, SUPERVISOR_SCOPE_VOCABULARY.length);
assert(Object.isFrozen(SUPERVISOR_REQUEST_REGISTRY));
for (const entry of Object.values(SUPERVISOR_REQUEST_REGISTRY)) {
  assert(Object.isFrozen(entry));
  assert(Object.isFrozen(entry.scopes));
  assert.equal(typeof entry.credentialBearing, 'boolean');
}
assert.deepEqual(
  Object.entries(SUPERVISOR_REQUEST_REGISTRY)
    .filter(([, entry]) => entry.credentialBearing)
    .map(([variant]) => variant)
    .sort(),
  [
    'operator.certificate.renew',
    'operator.device.rebind',
    'operator.enrollment.consume',
    'operator.enrollment.issue',
    'root.intermediate.unseal',
    'root.recover.apply',
  ],
);

{
  const authority = makeAuthority(['deploy.plan', 'operator.enroll']);
  let executions = 0;
  const request = signedRequest();
  const first = authority.handleRequest(request, {
    nowMs,
    execute: () => {
      executions += 1;
      return { z: 1, a: { ok: true } };
    },
  });
  assert.deepEqual(first, { z: 1, a: { ok: true } });
  const afterFirst = authority.snapshot();
  assert.equal(afterFirst.devices['device-a'].lastSequence, 1);
  assert.equal(afterFirst.requestJournal['request-1'].response.kind, 'inline');

  const replayAfterCertificateExpiry = authority.handleRequest(request, {
    nowMs: nowMs + 7_200_000,
    execute: () => {
      executions += 1;
      return { shouldNotRun: true };
    },
  });
  assert.deepEqual(replayAfterCertificateExpiry, first);
  assert.equal(executions, 1);

  const collision = signedRequest({
    requestId: 'request-1',
    body: { releaseSha256: `sha256:${'d'.repeat(64)}` },
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_REQUEST_ID_COLLISION',
    () => authority.handleRequest(collision, { nowMs, execute: () => ({}) }),
  );
}

{
  const authority = makeAuthority(['deploy.plan']);
  let executions = 0;
  const request = signedRequest({ requestId: 'request-null' });
  assert.equal(authority.handleRequest(request, {
    nowMs,
    execute: () => {
      executions += 1;
      return null;
    },
  }), null);
  assert.equal(authority.handleRequest(request, {
    nowMs: nowMs + 1,
    execute: () => {
      executions += 1;
      return { shouldNotRun: true };
    },
  }), null);
  assert.equal(executions, 1);
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 1);
}

{
  const authority = makeAuthority(['deploy.plan']);
  let executions = 0;
  const request = signedRequest({ requestId: 'request-async' });
  const response = await authority.handleRequestAsync(request, {
    nowMs,
    execute: async () => {
      executions += 1;
      await Promise.resolve();
      return { schemaVersion: 'snapback.async-provider-result.v1', ok: true };
    },
  });
  assert.deepEqual(response, {
    schemaVersion: 'snapback.async-provider-result.v1',
    ok: true,
  });
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 1);
  assert.equal(authority.snapshot().requestJournal['request-async'].response.kind, 'inline');
  assert.deepEqual(await authority.handleRequestAsync(request, {
    nowMs: nowMs + 7_200_000,
    execute: async () => {
      executions += 1;
      return { shouldNotRun: true };
    },
  }), response);
  assert.equal(executions, 1);
}

{
  const authority = makeAuthority(['deploy.plan']);
  const request = signedRequest({ requestId: 'request-async-rejected' });
  await expectAsyncRefusal(
    'SNAPBACK_OPERATOR_CANONICAL_VALUE_INVALID',
    authority.handleRequestAsync(request, {
      nowMs,
      execute: async () => undefined,
    }),
  );
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 0);
  assert.equal(authority.snapshot().requestJournal['request-async-rejected'], undefined);
}

{
  const authority = makeAuthority(['deploy.plan']);
  const request = signedRequest({ requestId: 'request-sync-promise' });
  let executions = 0;
  expectRefusal(
    'SNAPBACK_OPERATOR_ASYNC_EXECUTOR_REQUIRED',
    () => authority.handleRequest(request, {
      nowMs,
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
    }),
    500,
  );
  assert.equal(executions, 0);
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 0);
  assert.equal(authority.snapshot().requestJournal['request-sync-promise'], undefined);
}

{
  const authority = makeAuthority(['deploy.plan']);
  const tampered = signedRequest();
  tampered.body = { releaseSha256: `sha256:${'e'.repeat(64)}` };
  expectRefusal(
    'SNAPBACK_OPERATOR_BODY_DIGEST_MISMATCH',
    () => authority.handleRequest(tampered, { nowMs, execute: () => ({}) }),
    400,
  );
  const unknown = signedRequest({ variant: 'deploy.magic', scope: 'deploy.plan' });
  expectRefusal(
    'SNAPBACK_OPERATOR_VARIANT_UNKNOWN',
    () => authority.handleRequest(unknown, { nowMs, execute: () => ({}) }),
    400,
  );
  const wrongScope = signedRequest({ scope: 'backup.plan' });
  expectRefusal(
    'SNAPBACK_OPERATOR_SCOPE_DENIED',
    () => authority.handleRequest(wrongScope, { nowMs, execute: () => ({}) }),
    403,
  );
  const skipped = signedRequest({ sequence: 2 });
  expectRefusal(
    'SNAPBACK_OPERATOR_SEQUENCE_CONFLICT',
    () => authority.handleRequest(skipped, { nowMs, execute: () => ({}) }),
  );
  const badSignature = signedRequest({ requestId: 'request-bad-signature' });
  badSignature.signature = `${badSignature.signature.slice(0, -2)}aa`;
  expectRefusal(
    'SNAPBACK_OPERATOR_SIGNATURE_INVALID',
    () => authority.handleRequest(badSignature, { nowMs, execute: () => ({}) }),
    403,
  );
  const noncanonicalSignature = signedRequest({ requestId: 'request-noncanonical-signature' });
  noncanonicalSignature.signature += '=';
  expectRefusal(
    'SNAPBACK_OPERATOR_SIGNATURE_INVALID',
    () => authority.handleRequest(noncanonicalSignature, { nowMs, execute: () => ({}) }),
    403,
  );
  const substitutedExpiry = signedRequest({
    requestId: 'request-substituted-expiry',
    certificateExpiresAtMs: nowMs + 7_200_000,
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_CERTIFICATE_MISMATCH',
    () => authority.handleRequest(substitutedExpiry, { nowMs, execute: () => ({}) }),
    403,
  );
}

{
  const authority = makeAuthority(['deploy.plan']);
  const request = signedRequest();
  assert.throws(
    () => authority.handleRequest(request, {
      nowMs,
      execute: ({ state }) => {
        state.devices['device-a'].lastSequence = 99;
        throw new Error('provider failed');
      },
    }),
    /provider failed/,
  );
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 0);
  assert.equal(authority.snapshot().requestJournal['request-1'], undefined);
  const retry = authority.handleRequest(request, {
    nowMs,
    execute: () => ({ ok: true }),
  });
  assert.deepEqual(retry, { ok: true });
}

{
  const authority = makeAuthority(['deploy.plan', 'operator.enroll']);
  authority.registerDevice({
    deviceId: 'device-b',
    deviceKeyId: 'device-key-b',
    subject: 'other@example.test',
    publicKeyPem,
    effectiveScopes: ['deploy.plan'],
    certificateSha256: `sha256:${'f'.repeat(64)}`,
    certificateExpiresAtMs: nowMs + 3_600_000,
    nowMs,
  });
  const credentialRequest = signedRequest({
    variant: 'operator.enrollment.issue',
    credentialBearing: true,
  });
  authority.handleRequest(credentialRequest, {
    nowMs,
    execute: () => ({ credential: 'sealed-once' }),
  });
  const revoked = authority.revokeDevice('device-a', { nowMs: nowMs + 1 });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedAtGeneration, 2);
  expectRefusal(
    'SNAPBACK_OPERATOR_CREDENTIAL_REPLAY_GONE',
    () => authority.handleRequest(credentialRequest, { nowMs: nowMs + 2 }),
    410,
  );
  const callerClassified = signedRequest({
    requestId: 'request-caller-classified',
    sequence: 1,
    credentialBearing: true,
    deviceId: 'device-b',
    deviceKeyId: 'device-key-b',
    subject: 'other@example.test',
    operatorCertificateSha256: `sha256:${'f'.repeat(64)}`,
    certificateRevocationGeneration: 1,
    observedRevocationGeneration: 2,
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_RESPONSE_CLASS_MISMATCH',
    () => authority.handleRequest(callerClassified, {
      nowMs: nowMs + 2,
      execute: () => ({}),
    }),
    400,
  );
  const behind = signedRequest({
    requestId: 'request-behind',
    sequence: 2,
    observedRevocationGeneration: 1,
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_REVOCATION_HEAD_BEHIND',
    () => authority.handleRequest(behind, { nowMs: nowMs + 2, execute: () => ({}) }),
  );
  const unaffected = signedRequest({
    requestId: 'request-unaffected',
    deviceId: 'device-b',
    deviceKeyId: 'device-key-b',
    subject: 'other@example.test',
    operatorCertificateSha256: `sha256:${'f'.repeat(64)}`,
    certificateRevocationGeneration: 1,
    observedRevocationGeneration: 2,
  });
  assert.deepEqual(authority.handleRequest(unaffected, {
    nowMs: nowMs + 2,
    execute: () => ({ unaffected: true }),
  }), { unaffected: true });
  assert.equal(authority.snapshot().devices['device-b'].certificateRevocationGeneration, 1);
}

{
  const authority = makeAuthority(['deploy.plan']);
  const request = signedRequest();
  authority.handleRequest(request, {
    nowMs,
    execute: () => ({ noncredential: true }),
  });
  authority.revokeDevice('device-a', { nowMs: nowMs + 1 });
  assert.deepEqual(
    authority.handleRequest(request, { nowMs: nowMs + 2 }),
    { noncredential: true },
  );
}

{
  const authority = makeAuthority(['operator.admin']);
  const request = signedRequest({
    variant: 'operator.device.revoke',
    scope: 'operator.admin',
  });
  assert.deepEqual(authority.handleRequest(request, {
    nowMs,
    execute: () => ({ ok: true }),
  }), { ok: true });
  const special = signedRequest({
    requestId: 'request-special',
    sequence: 2,
    variant: 'root.recover.plan',
    scope: null,
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_SPECIAL_AUTHORITY_REQUIRED',
    () => authority.handleRequest(special, { nowMs, execute: () => ({}) }),
    403,
  );
  assert.deepEqual(authority.handleRequest(special, {
    nowMs,
    verifySpecialAuthority: ({ authority: kind }) => kind === 'recovery-threshold',
    execute: () => ({ accepted: true }),
  }), { accepted: true });
}

{
  const authority = makeAuthority(['release.upload']);
  const bytes = Buffer.from('immutable release bytes');
  const request = signedRequest({
    variant: 'release.upload',
    scope: 'release.upload',
    body: {
      declaredBytes: bytes.length,
      declaredSha256: digest(bytes),
    },
  });
  const upload = {
    attemptId: 'attempt-1',
    declaredBytes: bytes.length,
    declaredSha256: digest(bytes),
    spendReservationId: 'spend-1',
    temporaryObjectKey: `${`uploads/${installationId}`}/request-1/attempt-1`,
  };
  const reservation = authority.beginReleaseUpload(request, upload, { nowMs });
  assert.equal(reservation.ok, true);
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 0);
  const competing = signedRequest({
    requestId: 'request-competing',
    variant: 'release.upload',
    scope: 'release.upload',
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_SEQUENCE_PENDING',
    () => authority.beginReleaseUpload(competing, {
      ...upload,
      attemptId: 'attempt-competing',
      temporaryObjectKey: `uploads/${installationId}/request-competing/attempt-competing`,
    }, { nowMs }),
  );
  assert.equal(authority.appendReleaseUploadChunk({
    requestId: 'request-1',
    bytes: bytes.subarray(0, 5),
    nowMs: nowMs + 1,
  }).receivedBytes, 5);
  authority.appendReleaseUploadChunk({
    requestId: 'request-1',
    bytes: bytes.subarray(5),
    nowMs: nowMs + 2,
  });
  const receipt = authority.finishReleaseUpload({
    requestId: 'request-1',
    nowMs: nowMs + 3,
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.releaseSha256, digest(bytes));
  assert.equal(authority.snapshot().uploads['request-1'].state, 'complete');
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 1);
  assert.deepEqual(authority.beginReleaseUpload(request, upload, { nowMs: nowMs + 4 }), receipt);
}

{
  const authority = makeAuthority(['deploy.plan']);
  const request = signedRequest({ requestId: 'request-large-response' });
  const response = { payload: 'x'.repeat(__operatorAuthorityTest.INLINE_RESPONSE_BYTES + 1) };
  assert.deepEqual(authority.handleRequest(request, {
    nowMs,
    execute: () => response,
  }), response);
  const retained = authority.snapshot().requestJournal['request-large-response'];
  assert.equal(retained.response.kind, 'object');
  assert.deepEqual(authority.handleRequest(request, {
    nowMs: nowMs + 1,
  }), response);
  const tombstone = authority.garbageCollectResponse('request-large-response', {
    nowMs: retained.response.retainUntilMs,
  });
  assert.equal(tombstone.terminal, true);
  expectRefusal(
    'SNAPBACK_OPERATOR_REPLAY_TOMBSTONED',
    () => authority.handleRequest(request, { nowMs: retained.response.retainUntilMs + 1 }),
    410,
  );
}

{
  const authority = makeAuthority(['release.upload']);
  const request = signedRequest({
    variant: 'release.upload',
    scope: 'release.upload',
    body: {
      declaredBytes: 1,
      declaredSha256: digest(Buffer.from('x')),
    },
  });
  expectRefusal(
    'SNAPBACK_RELEASE_UPLOAD_BODY_MISMATCH',
    () => authority.beginReleaseUpload(request, {
      attemptId: 'attempt-body-mismatch',
      declaredBytes: 2,
      declaredSha256: digest(Buffer.from('xx')),
      spendReservationId: 'spend-body-mismatch',
      temporaryObjectKey: `uploads/${installationId}/request-1/attempt-body-mismatch`,
    }, { nowMs }),
  );
  assert.equal(authority.snapshot().pendingUploads['request-1'], undefined);
}

{
  const authority = makeAuthority(['release.upload']);
  const bytes = Buffer.from('wrong');
  const request = signedRequest({
    variant: 'release.upload',
    scope: 'release.upload',
    body: {
      declaredBytes: bytes.length,
      declaredSha256: `sha256:${'0'.repeat(64)}`,
    },
  });
  const upload = {
    attemptId: 'attempt-2',
    declaredBytes: bytes.length,
    declaredSha256: `sha256:${'0'.repeat(64)}`,
    spendReservationId: 'spend-2',
    temporaryObjectKey: `uploads/${installationId}/request-1/attempt-2`,
  };
  authority.beginReleaseUpload(request, upload, { nowMs });
  authority.appendReleaseUploadChunk({ requestId: 'request-1', bytes, nowMs: nowMs + 1 });
  const receipt = authority.finishReleaseUpload({ requestId: 'request-1', nowMs: nowMs + 2 });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.code, 'SNAPBACK_RELEASE_UPLOAD_HASH_MISMATCH');
  assert.equal(receipt.cleanupOnly, true);
  assert.equal(authority.snapshot().devices['device-a'].lastSequence, 1);
}

{
  const authority = makeAuthority(['release.upload']);
  const request = signedRequest({
    variant: 'release.upload',
    scope: 'release.upload',
    body: {
      declaredBytes: 1,
      declaredSha256: digest(Buffer.from('x')),
    },
  });
  authority.beginReleaseUpload(request, {
    attemptId: 'attempt-timeout',
    declaredBytes: 1,
    declaredSha256: digest(Buffer.from('x')),
    spendReservationId: 'spend-timeout',
    temporaryObjectKey: `uploads/${installationId}/request-1/attempt-timeout`,
  }, { nowMs });
  const timeout = authority.appendReleaseUploadChunk({
    requestId: 'request-1',
    bytes: Buffer.from('x'),
    nowMs: nowMs + __operatorAuthorityTest.MAX_UPLOAD_IDLE_MS + 1,
  });
  assert.equal(timeout.code, 'SNAPBACK_RELEASE_UPLOAD_TIMEOUT');
  assert.equal(authority.snapshot().uploads['request-1'].state, 'cleanupOnly');
}

{
  const authority = makeAuthority(['release.upload']);
  const request = signedRequest({
    variant: 'release.upload',
    scope: 'release.upload',
    body: {
      declaredBytes: 1,
      declaredSha256: digest(Buffer.from('x')),
    },
  });
  authority.beginReleaseUpload(request, {
    attemptId: 'attempt-restart',
    declaredBytes: 1,
    declaredSha256: digest(Buffer.from('x')),
    spendReservationId: 'spend-restart',
    temporaryObjectKey: `uploads/${installationId}/request-1/attempt-restart`,
  }, { nowMs });
  const restarted = new SupervisorOperatorAuthority({
    installationId,
    rootKeyId,
    state: authority.snapshot(),
  });
  const [receipt] = restarted.reconcileOpenUploads({ nowMs: nowMs + 1 });
  assert.equal(receipt.code, 'SNAPBACK_RELEASE_UPLOAD_STREAM_LOST');
  assert.equal(restarted.snapshot().uploads['request-1'].state, 'cleanupOnly');
}

console.log('operator authority tests passed');
