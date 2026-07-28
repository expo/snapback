import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';

import {
  SupervisorOperatorAuthority,
  __operatorAuthorityTest,
  canonicalAuthorityJson,
  operatorRequestBodySha256,
  operatorRequestSigningBytes,
} from './operator-authority.mjs';
import {
  __operatorServiceTest,
  createOperatorRequestService,
} from './operator-service.mjs';
import {
  createSupervisorResponseSigner,
  verifySupervisorResponse,
} from './supervisor-response.mjs';
import { certificateSha256 } from './hosted-edge-admission.mjs';
import { HostedSupervisor, canonicalJson, sha256 } from './index.mjs';
import { __providerExecutorTest } from './provider-executor.mjs';
import { __supervisorResponseTest } from './supervisor-response.mjs';

const nowMs = 1_800_000_000_000;
const digest = (value) => sha256(Buffer.from(value));
const installationReceipt = {
  installationId: 'installation-a',
  standingRootAuthorizationSha256: digest('standing-root-a'),
};
const peerCertificateRaw = Buffer.from('fixture-operator-certificate-der');
const operatorCertificateSha256 = certificateSha256(peerCertificateRaw);
const { privateKey: devicePrivate, publicKey: devicePublic } = generateKeyPairSync('ed25519');
const { privateKey: rootPrivate, publicKey: rootPublic } = generateKeyPairSync('ed25519');
const { privateKey: responsePrivate, publicKey: responsePublic } = generateKeyPairSync('ed25519');

const intermediateContent = {
  schemaVersion: __supervisorResponseTest.INTERMEDIATE_VERSION,
  installationId: installationReceipt.installationId,
  intermediateKeyId: 'response-key-a',
  publicKeyEd25519: responsePublic.export({ format: 'der', type: 'spki' })
    .subarray(-32).toString('base64url'),
  purpose: 'supervisor-response',
  serial: 1,
  revocationGeneration: 1,
  issuedAt: new Date(nowMs - 1_000).toISOString(),
  notBefore: new Date(nowMs - 1_000).toISOString(),
  expiresAt: new Date(nowMs + 60_000).toISOString(),
  rootKeyId: 'root-a',
};
const intermediate = {
  ...intermediateContent,
  signature: sign(
    null,
    Buffer.concat([
      __supervisorResponseTest.INTERMEDIATE_DOMAIN,
      Buffer.from(canonicalAuthorityJson(intermediateContent)),
    ]),
    rootPrivate,
  ).toString('base64url'),
};
const responseSigner = createSupervisorResponseSigner({
  intermediate,
  privateKeyPem: responsePrivate.export({ format: 'pem', type: 'pkcs8' }),
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  installationId: installationReceipt.installationId,
  rootKeyId: 'root-a',
});
assert.deepEqual(
  [...new Set(Object.values(__operatorServiceTest.VARIANT_OPERATIONS).flat())].sort(),
  [
    'acquireLease',
    'activateGeneration',
    'activateRestoredGeneration',
    'compatibilityPreflight',
    'createVerifiedBackup',
    'fenceExternalEffects',
    'provisionInactive',
    'reconcileEffect',
    'releaseLease',
    'renewLease',
    'restoreBackupInactive',
    'rollback',
    'stageRelease',
    'uploadImmutableRelease',
    'verifyRestoredApplication',
    'verifyRestoredComponents',
    'verifyServedPath',
  ].sort(),
);

const binding = {
  schemaVersion: 'snapback.fly-target-binding.v2',
  targetId: 'target-a',
  bindingGeneration: 1,
  predecessorBindingSha256: null,
  organizationId: 'organization-a',
  appId: 'app-a',
  region: 'sjc',
  publicOrigin: 'https://app-a.example.test',
  activeMachineId: 'machine-a',
  machineRoster: ['machine-a'],
  routedMachineIds: ['machine-a'],
  serviceProcessGroups: ['app'],
  autostopEnabled: false,
  autostartEnabled: true,
  autoscaleEnabled: false,
  volumeId: 'volume-a',
  ociRepository: 'registry.fly.io/app-a',
  ociDigest: digest('image-a'),
  tigrisBucket: 'bucket-a',
  artifactPrefix: 'target-a/artifacts/',
  backupPrefix: 'target-a/backups/',
  controlStatePrefix: 'target-a/control/',
  auditPrefix: 'target-a/audit/',
  logPrefix: 'target-a/logs/',
  cleanupPrefix: 'target-a/cleanup/',
  tlsIssuer: 'letsencrypt-staging',
  certificatePosture: 'same-volume-loopback-caddy',
  externalHeadKey: 'target-a/control/head.json',
  ownershipSentinel: 'sentinel-a',
  supervisorInstallationId: installationReceipt.installationId,
  supervisorOciDigest: digest('supervisor-a'),
  credentials: [{
    role: 'flyControl',
    credentialRef: 'provider-secret://supervisor/target-a-fly-control-token',
    fingerprint: digest('fly-control-a'),
    allowedVerbs: ['control'],
    resourcePrefixes: ['app-a'],
  }],
  observedAtMs: nowMs - 1_000,
  expiresAtMs: nowMs + 60_000,
};

const supervisor = new HostedSupervisor({
  installationReceipt,
  incarnation: 'incarnation-a',
});
const registered = supervisor.registerTargetBinding(binding);
const authority = new SupervisorOperatorAuthority({
  installationId: installationReceipt.installationId,
  rootKeyId: 'root-a',
  nowMs,
});
authority.registerDevice({
  deviceId: 'device-a',
  deviceKeyId: 'device-key-a',
  subject: 'operator@example.test',
  publicKeyPem: devicePublic.export({ format: 'pem', type: 'spki' }),
  effectiveScopes: ['deploy.apply'],
  certificateSha256: operatorCertificateSha256,
  certificateExpiresAtMs: nowMs + 60_000,
  nowMs,
});
supervisor.commit((database) => {
  database.operatorAuthority = authority.snapshot();
});
supervisor.createSpendLedger({
  journeyId: 'journey-a',
  currency: 'USD',
  tariffSource: 'fixture',
  tariffObservedAtMs: nowMs,
  maximumMicros: 100,
  cleanupReserveMicros: 10,
});
supervisor.reserveSpend({
  journeyId: 'journey-a',
  grantId: 'grant-a',
  planDigest: digest('plan-a'),
  targetOrPlannedBindingDigest: registered.bindingSha256,
  semanticEffectIds: ['effect-a'],
  maximumMicros: 10,
});

const predecessorHead = {
  schemaVersion: 'snapback.hosted-control-head.v2',
  targetId: binding.targetId,
  generation: 1,
  bindingSha256: registered.bindingSha256,
  activationGeneration: 0,
  activeReleaseId: null,
  journalRootSha256: digest('journal-a'),
  admissionGeneration: 0,
  spendFloor: 0,
  cleanupFloor: 0,
  replayFloor: 0,
  supervisorIncarnation: supervisor.incarnation,
  predecessorSha256: null,
  committedAtMs: nowMs,
};
const lifecycleRequest = {
  schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2',
  operation: 'provisionInactive',
  operationId: 'operation-a',
  attempt: 0,
  targetBinding: binding,
  planSha256: digest('plan-a'),
  requestSha256: digest('request-a'),
  predecessorHead,
  effectIntent: {
    schemaVersion: 'snapback.provider-effect-intent.v1',
    operationId: 'operation-a',
    operation: 'provisionInactive',
    requestSha256: digest('request-a'),
    semanticEffectId: 'effect-a',
    targetBindingSha256: __providerExecutorTest.bindingSha256(binding),
    planSha256: digest('plan-a'),
    effectKind: 'create',
    logicalResourceName: 'machine',
    desiredProviderStateSha256: digest('desired-a'),
    predecessorHeadSha256: __providerExecutorTest.headSha256(predecessorHead),
  },
  lease: null,
  confirmationSha256: null,
};
const body = {
  schemaVersion: 'snapback.supervisor-lifecycle-execution.v1',
  journeyId: 'journey-a',
  grantId: 'grant-a',
  lifecycleRequest,
};
const request = {
  schemaVersion: __operatorAuthorityTest.REQUEST_SCHEMA_VERSION,
  installationId: installationReceipt.installationId,
  rootKeyId: 'root-a',
  deviceId: 'device-a',
  deviceKeyId: 'device-key-a',
  subject: 'operator@example.test',
  operatorCertificateSha256,
  certificateExpiresAtMs: nowMs + 60_000,
  certificateRevocationGeneration: 1,
  observedRevocationGeneration: 1,
  sequence: 1,
  requestId: 'request-a',
  variant: 'deploy.apply',
  scope: 'deploy.apply',
  targetHeadSha256: __providerExecutorTest.headSha256(predecessorHead),
  bodySha256: operatorRequestBodySha256(body),
  body,
  credentialBearing: false,
  issuedAtMs: nowMs - 1_000,
  expiresAtMs: nowMs + 10_000,
  signature: '',
};
request.signature = sign(
  null,
  operatorRequestSigningBytes(request),
  devicePrivate,
).toString('base64url');

let retained = {
  installationReceipt,
  incarnation: supervisor.incarnation,
  database: supervisor.database,
  mirror: supervisor.mirror,
  anchor: supervisor.anchor,
};
let persistenceCount = 0;
const persistSupervisor = async (current) => {
  persistenceCount += 1;
  retained = {
    installationReceipt,
    incarnation: current.incarnation,
    database: structuredClone(current.database),
    mirror: structuredClone(current.mirror),
    anchor: structuredClone(current.anchor),
  };
};
const providerExecutor = {
  async execute(input) {
    assert.equal(input.operation, 'provisionInactive');
    return {
      schemaVersion: 'snapback.vm-adapter-lifecycle-response.v2',
      operation: input.operation,
      operationId: input.operationId,
      ok: false,
      idempotentReplay: false,
      remoteEvidence: false,
      requestSha256: input.requestSha256,
      terminal: {
        schemaVersion: 'snapback.provider-effect-terminal.v1',
        semanticEffectId: input.effectIntent.semanticEffectId,
        outcome: 'notApplied',
        recordedAtMs: nowMs,
        reason: 'closedCarrierPrerequisiteMissing',
        recoveryClass: null,
        providerVersion: null,
        lastObservationSha256: null,
        redactedEvidenceSha256: null,
        retainedResultSha256: null,
      },
      controlHead: input.predecessorHead,
      observation: null,
      diagnostics: [{
        code: 'SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE',
        severity: 'error',
        message: 'fixture refusal',
      }],
    };
  },
};
const service = () => createOperatorRequestService({
  responseSigner,
  providerExecutor,
  createSupervisor: () => new HostedSupervisor(retained),
  persistSupervisor,
});

const first = await service().execute(request, { peerCertificateRaw, nowMs });
assert.equal(first.body.ok, true);
assert.equal(first.body.result.terminal.outcome, 'notApplied');
assert.equal(persistenceCount, 3, 'intent, terminal, and response each persist before the next boundary');
verifySupervisorResponse(first, {
  rootPublicKeyPem: rootPublic.export({ format: 'pem', type: 'spki' }),
  expectedInstallationId: installationReceipt.installationId,
  expectedRootKeyId: 'root-a',
  expectedRequest: request,
  nowMs,
});

// A reconstructed supervisor exact-replays the byte-identical signed response
// without provider execution or another canonical generation.
const generationAfterFirst = retained.database.generation;
const replay = await service().execute(request, { peerCertificateRaw, nowMs });
assert.equal(canonicalJson(replay), canonicalJson(first));
assert.equal(retained.database.generation, generationAfterFirst);
assert.equal(persistenceCount, 3);

// Retained replay remains available after the current response intermediate
// expires; it does not need access to a live signer or mint new authority.
const expiredReplay = await service().execute(request, {
  peerCertificateRaw,
  nowMs: nowMs + 120_000,
});
assert.equal(canonicalJson(expiredReplay), canonicalJson(first));
assert.equal(retained.database.generation, generationAfterFirst);
assert.equal(persistenceCount, 3);

await assert.rejects(
  service().execute(request, {
    peerCertificateRaw: Buffer.from('wrong-certificate'),
    nowMs,
  }),
  (error) => error.code === 'SNAPBACK_OPERATOR_MTLS_CERTIFICATE_MISMATCH',
);
assert.equal(retained.database.generation, generationAfterFirst);

// Retained response tampering is detected after recovery and never invokes the
// provider executor.
const tampered = structuredClone(retained);
const retainedResponse = tampered.database.operatorAuthority.requestJournal[request.requestId].response;
retainedResponse.bytes = Buffer.from('{"tampered":true}').toString('base64url');
const tamperedService = createOperatorRequestService({
  responseSigner,
  providerExecutor,
  createSupervisor: () => new HostedSupervisor(tampered),
  persistSupervisor: async () => assert.fail('tampered replay must not persist'),
});
await assert.rejects(
  tamperedService.execute(request, { peerCertificateRaw, nowMs }),
  (error) => error.code === 'SNAPBACK_OPERATOR_REPLAY_BYTES_INVALID',
);

console.log('operator mTLS transaction service tests passed');
