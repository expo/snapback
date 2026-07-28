import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import { HostedSupervisor, sha256 } from './index.mjs';
import {
  OperatorAuthorityRefusal,
  SupervisorOperatorAuthority,
  __operatorAuthorityTest,
  operatorRequestBodySha256,
  operatorRequestSigningBytes,
} from './operator-authority.mjs';
import {
  __operatorAuthorityTransactionTest,
  executeOperatorAuthorityTransaction,
} from './operator-authority-transaction.mjs';

const nowMs = 1_800_000_000_000;
const installationId = 'shared-supervisor-sjc-transaction';
const rootKeyId = 'root-transaction';
const certificateSha256 = `sha256:${'a'.repeat(64)}`;
const targetHeadSha256 = `sha256:${'b'.repeat(64)}`;
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const installationReceipt = {
  installationId,
  standingRootAuthorizationSha256: sha256(Buffer.from('standing-root')),
};

function provisionedAuthority() {
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
    effectiveScopes: ['supervisor.read'],
    certificateSha256,
    certificateExpiresAtMs: nowMs + 3_600_000,
    nowMs,
  });
  return authority.snapshot();
}

function createSupervisor({ withAuthority = true } = {}) {
  const initial = new HostedSupervisor({
    installationReceipt,
    incarnation: 'incarnation-transaction',
  });
  const database = structuredClone(initial.database);
  if (withAuthority) database.operatorAuthority = provisionedAuthority();
  return new HostedSupervisor({
    installationReceipt,
    incarnation: initial.incarnation,
    database,
    anchor: initial.anchor,
  });
}

function signedRequest({
  requestId = 'request-1',
  sequence = 1,
  body = { detail: 'safe' },
} = {}) {
  const request = {
    schemaVersion: __operatorAuthorityTest.REQUEST_SCHEMA_VERSION,
    installationId,
    rootKeyId,
    deviceId: 'device-a',
    deviceKeyId: 'device-key-a',
    subject: 'operator@example.test',
    operatorCertificateSha256: certificateSha256,
    certificateExpiresAtMs: nowMs + 3_600_000,
    certificateRevocationGeneration: 1,
    observedRevocationGeneration: 1,
    sequence,
    requestId,
    variant: 'supervisor.doctor',
    scope: 'supervisor.read',
    targetHeadSha256,
    body,
    bodySha256: operatorRequestBodySha256(body),
    credentialBearing: false,
    issuedAtMs: nowMs - 1_000,
    expiresAtMs: nowMs + 60_000,
    signature: '',
  };
  request.signature = sign(
    null,
    operatorRequestSigningBytes(request),
    privateKey,
  ).toString('base64url');
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

{
  const supervisor = createSupervisor();
  let executions = 0;
  const request = signedRequest();
  const first = executeOperatorAuthorityTransaction(supervisor, request, {
    nowMs,
    execute: () => {
      executions += 1;
      return {
        schemaVersion: 'snapback.supervisor-doctor-result.v1',
        ok: true,
        privateCredential: 'retained-but-not-journaled',
      };
    },
  });
  assert.equal(first.committed, true);
  assert.equal(first.generation, 1);
  assert.equal(supervisor.database.floors.replay, 1);
  assert.equal(supervisor.anchor.replayFloor, 1);
  assert.equal(supervisor.database.operatorAuthority.devices['device-a'].lastSequence, 1);
  assert.equal(supervisor.database.operatorAuthority.requestJournal['request-1'].response.kind, 'inline');

  const [entry] = supervisor.database.journal;
  assert.equal(entry.schemaVersion, __operatorAuthorityTransactionTest.JOURNAL_SCHEMA_VERSION);
  assert.equal(entry.kind, 'operatorRequest');
  assert.equal(entry.requestId, 'request-1');
  assert.equal(entry.variant, 'supervisor.doctor');
  assert.equal(entry.privateCredential, undefined);
  assert.equal(entry.responseSha256, supervisor.database.operatorAuthority
    .requestJournal['request-1'].response.sha256);

  const replay = executeOperatorAuthorityTransaction(supervisor, request, {
    nowMs: nowMs + 120_000,
    execute: () => {
      executions += 1;
      return { shouldNotRun: true };
    },
  });
  assert.deepEqual(replay.response, first.response);
  assert.equal(replay.committed, false);
  assert.equal(replay.generation, 1);
  assert.equal(supervisor.database.journal.length, 1);
  assert.equal(supervisor.database.floors.replay, 1);
  assert.equal(executions, 1);

  const recovered = new HostedSupervisor({
    installationReceipt,
    incarnation: supervisor.incarnation,
    database: supervisor.database,
    mirror: supervisor.mirror,
    anchor: supervisor.anchor,
  });
  const recoveredReplay = executeOperatorAuthorityTransaction(recovered, request, {
    nowMs: nowMs + 180_000,
    execute: () => {
      executions += 1;
      return { shouldNotRun: true };
    },
  });
  assert.deepEqual(recoveredReplay.response, first.response);
  assert.equal(recoveredReplay.committed, false);
  assert.equal(executions, 1);
}

{
  const supervisor = createSupervisor();
  const request = signedRequest();
  assert.throws(
    () => executeOperatorAuthorityTransaction(supervisor, request, {
      nowMs,
      execute: () => {
        throw new Error('provider failed before response retention');
      },
    }),
    /provider failed before response retention/,
  );
  assert.equal(supervisor.database.generation, 0);
  assert.equal(supervisor.database.floors.replay, 0);
  assert.equal(supervisor.database.journal.length, 0);
  assert.equal(supervisor.database.operatorAuthority.devices['device-a'].lastSequence, 0);

  const retry = executeOperatorAuthorityTransaction(supervisor, request, {
    nowMs,
    execute: () => ({
      schemaVersion: 'snapback.supervisor-command-refusal.v1',
      ok: false,
      code: 'SNAPBACK_HOSTED_OPERATOR_EXECUTOR_UNAVAILABLE',
    }),
  });
  assert.equal(retry.committed, true);
  assert.equal(retry.response.ok, false);
  assert.equal(supervisor.database.operatorAuthority.devices['device-a'].lastSequence, 1);
}

{
  const supervisor = createSupervisor({ withAuthority: false });
  expectRefusal(
    'SNAPBACK_OPERATOR_AUTHORITY_UNINITIALIZED',
    () => executeOperatorAuthorityTransaction(supervisor, signedRequest(), {
      nowMs,
      execute: () => ({ ok: true }),
    }),
    503,
  );
  assert.equal(supervisor.database.generation, 0);
}

{
  const supervisor = createSupervisor();
  supervisor.database.floors.replay = -1;
  expectRefusal(
    'SNAPBACK_OPERATOR_SUPERVISOR_INVALID',
    () => executeOperatorAuthorityTransaction(supervisor, signedRequest(), {
      nowMs,
      execute: () => ({ ok: true }),
    }),
    500,
  );
  assert.equal(supervisor.database.generation, 0);
}

{
  const supervisor = createSupervisor();
  const invalid = signedRequest();
  invalid.signature = `${invalid.signature.slice(0, -2)}aa`;
  expectRefusal(
    'SNAPBACK_OPERATOR_SIGNATURE_INVALID',
    () => executeOperatorAuthorityTransaction(supervisor, invalid, {
      nowMs,
      execute: () => ({ ok: true }),
    }),
    403,
  );
  assert.equal(supervisor.database.generation, 0);
  assert.equal(supervisor.database.journal.length, 0);
  assert.equal(supervisor.database.operatorAuthority.devices['device-a'].lastSequence, 0);
}

{
  const supervisor = createSupervisor();
  executeOperatorAuthorityTransaction(supervisor, signedRequest(), {
    nowMs,
    execute: () => ({ ok: true }),
  });
  expectRefusal(
    'SNAPBACK_OPERATOR_REQUEST_ID_COLLISION',
    () => executeOperatorAuthorityTransaction(
      supervisor,
      signedRequest({ body: { detail: 'different' } }),
      { nowMs, execute: () => ({ ok: true }) },
    ),
  );
  assert.equal(supervisor.database.generation, 1);
  assert.equal(supervisor.database.journal.length, 1);
}

console.log('snapback-hosted-supervisor: durable operator transaction corpus passed');
