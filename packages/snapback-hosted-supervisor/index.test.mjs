import assert from 'node:assert/strict';
import {
  HostedSupervisor,
  SupervisorRefusal,
  createCertificateRecipient,
  lifecycleRequestDigest,
  machineIsProductionRouted,
  openCertificateTransfer,
  plannedBindingDigest,
  sealCertificateTransfer,
  semanticEffectId,
  sha256,
  verifyBoundFlyMachineRoster,
} from './index.mjs';

const digest = (label) => sha256(Buffer.from(label));
const installationReceipt = {
  installationId: 'shared-supervisor-sjc-1',
  standingRootAuthorizationSha256: digest('standing-root'),
  machineId: 'supervisor-machine',
  volumeId: 'supervisor-volume',
  tigrisPrefix: 'control/shared/',
  tariffAllocation: 'measured-active-ms-and-stored-bytes',
};
const create = (options = {}) => new HostedSupervisor({
  installationReceipt,
  incarnation: 'incarnation-a',
  ...options,
});

assert.equal(machineIsProductionRouted({ config: { services: [] } }, ['app']), false);
assert.equal(machineIsProductionRouted({
  config: { services: [{ internal_port: 8443, processes: ['app'] }] },
}, ['app']), true);
assert.equal(machineIsProductionRouted({
  config: { containers: [{ services: [{ internal_port: 8443, processes: ['worker'] }] }] },
}, ['app']), false);

function refusal(code, callback) {
  assert.throws(callback, (error) => error instanceof SupervisorRefusal && error.code === code);
}

{
  const binding = {
    machineRoster: ['machine-1'],
    activeMachineId: 'machine-1',
    region: 'sjc',
    ociRepository: 'registry.fly.io/app',
    ociDigest: 'sha256:'.concat('a'.repeat(64)),
    volumeId: 'vol-1',
    serviceProcessGroups: ['app'],
    autostopEnabled: true,
    autostartEnabled: false,
  };
  const machine = {
    id: 'machine-1',
    state: 'started',
    region: 'sjc',
    config: {
      image: `${binding.ociRepository}@${binding.ociDigest}`,
      mounts: [{ volume: 'vol-1', path: '/data' }],
      services: [{
        internal_port: 8443,
        processes: ['app'],
        autostop: 'stop',
        autostart: false,
      }],
    },
  };
  assert.equal(verifyBoundFlyMachineRoster(binding, [machine]), machine);
  refusal(
    'SNAPBACK_EPHEMERAL_ROUTING_UNSAFE',
    () => verifyBoundFlyMachineRoster(binding, [machine, { ...machine, id: 'machine-2' }]),
  );
  for (const drifted of [
    { ...machine, region: 'iad' },
    { ...machine, config: { ...machine.config, image: 'registry.fly.io/app@sha256:bad' } },
    {
      ...machine,
      config: { ...machine.config, mounts: [{ volume: 'vol-2', path: '/data' }] },
    },
    {
      ...machine,
      config: {
        ...machine.config,
        services: [{ ...machine.config.services[0], autostart: true }],
      },
    },
  ]) {
    refusal(
      'SNAPBACK_HOSTED_ACTIVE_MACHINE_CONFIG_DRIFTED',
      () => verifyBoundFlyMachineRoster(binding, [drifted]),
    );
  }
}

// Exact digest domains are stable and bearer-independent.
{
  const planned = plannedBindingDigest({
    journeyId: 'journey-1',
    planDigest: digest('plan'),
    logicalResourceNames: ['app', 'machine', 'volume'],
    provider: 'fly',
    region: 'sjc',
    ownershipSentinel: 'sentinel-1',
  });
  assert.match(planned, /^sha256:[0-9a-f]{64}$/);
  const request = { operationId: 'op-1', operation: 'renewLease', transportBearer: 'secret' };
  assert.equal(
    lifecycleRequestDigest(request),
    lifecycleRequestDigest({ ...request, transportBearer: 'different-secret' }),
  );
  const id = semanticEffectId({
    operationId: 'op-1',
    operation: 'provisionInactive',
    targetBindingDigest: planned,
    planDigest: digest('plan'),
    effectKind: 'create',
    resourceIdentity: 'machine',
    desiredProviderState: { state: 'stopped' },
  });
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(id, semanticEffectId({
    operationId: 'op-1',
    operation: 'provisionInactive',
    targetBindingDigest: planned,
    planDigest: digest('plan'),
    effectKind: 'create',
    resourceIdentity: 'machine',
    desiredProviderState: { state: 'stopped' },
    retry: 99,
  }));
}

// Spend is reserved before an effect. Original terminals are immutable and an
// uncertain attempt is resolved only by a distinct reconciliation record.
{
  const supervisor = create();
  supervisor.createSpendLedger({
    journeyId: 'journey-1',
    currency: 'USD',
    tariffSource: 'fly-public-pricing',
    tariffObservedAtMs: 10,
    maximumMicros: 1_000_000,
    cleanupReserveMicros: 100_000,
  });
  const semanticEffectId = 'effect-machine-create';
  supervisor.reserveSpend({
    journeyId: 'journey-1',
    grantId: 'grant-1',
    planDigest: digest('plan'),
    targetOrPlannedBindingDigest: digest('planned-binding'),
    semanticEffectIds: [semanticEffectId],
    maximumMicros: 200_000,
  });
  const intent = {
    requestDigest: digest('request'),
    semanticEffectId,
    operationId: 'op-1',
    operation: 'provisionInactive',
    predecessorHead: digest('head-0'),
  };
  supervisor.appendIntent(intent, { journeyId: 'journey-1', grantId: 'grant-1' });
  supervisor.markEffecting(semanticEffectId, { providerRequestDigest: digest('provider-request') });
  supervisor.appendTerminal(semanticEffectId, {
    outcome: 'commitUncertain',
    lastObservation: digest('last-observation'),
    recoveryClass: 'provider-timeout',
  }, { journeyId: 'journey-1', grantId: 'grant-1' });
  refusal('SNAPBACK_PROVIDER_EFFECT_TERMINAL_IMMUTABLE', () => {
    supervisor.appendTerminal(semanticEffectId, {
      outcome: 'applied',
      providerVersion: 'v2',
    }, { journeyId: 'journey-1', grantId: 'grant-1' });
  });
  const original = structuredClone(supervisor.database.effects[semanticEffectId].terminal);
  supervisor.reconcileEffect(semanticEffectId, {
    reconciliationId: 'reconcile-1',
    uncertainTerminalSha256: digest('uncertain-terminal'),
    freshProviderObservationSha256: digest('fresh-provider'),
    freshControlHeadSha256: digest('fresh-head'),
    resolvedOutcome: 'applied',
  });
  assert.deepEqual(supervisor.database.effects[semanticEffectId].terminal, original);
  assert.equal(supervisor.database.reconciliations.length, 1);
  assert.equal(
    supervisor.database.spendLedgers['journey-1'].grants[0].state,
    'commitUncertain',
    'uncertainty retains the maximum reservation',
  );
}

// Mirror/anchor ordering: unanchored SQLite is never effect-capable; an
// anchor-ahead restart reconstructs from its matching mirror; stale
// incarnations cannot mint or effect.
{
  const interrupted = create();
  refusal('SNAPBACK_SUPERVISOR_INTERRUPTED', () => interrupted.commit(
    (db) => { db.floors.replay = 2; },
    { interruptAt: 'afterSqlite' },
  ));
  refusal('SNAPBACK_SUPERVISOR_UNCOMMITTED_DATABASE', () => interrupted.assertEffectAuthority());

  const afterAnchor = create();
  refusal('SNAPBACK_SUPERVISOR_INTERRUPTED', () => afterAnchor.commit(
    (db) => { db.floors.replay = 3; },
    { interruptAt: 'afterAnchor' },
  ));
  const reconstructed = create({
    database: {
      generation: 0,
      journal: [],
      effects: {},
      reconciliations: [],
      promotions: {},
      spendLedgers: {},
      cleanupPlans: {},
      heads: {},
      floors: { spend: 0, cleanup: 0, replay: 0 },
    },
    mirror: afterAnchor.mirror,
    anchor: afterAnchor.anchor,
  });
  assert.equal(reconstructed.database.floors.replay, 3);
  refusal('SNAPBACK_SUPERVISOR_INCARNATION_FENCED', () => new HostedSupervisor({
    installationReceipt,
    incarnation: 'stale-incarnation',
    database: reconstructed.database,
    mirror: reconstructed.mirror,
    anchor: reconstructed.anchor,
  }));
}

// Planned promotion maps the exact logical inventory once. Provider ids may
// not add or rename resources.
{
  const supervisor = create();
  const planned = digest('planned');
  supervisor.promotePlannedBinding({
    journeyId: 'journey-1',
    plannedBindingDigest: planned,
    logicalResourceNames: ['machine', 'volume'],
    provider: 'fly',
    region: 'sjc',
    ownershipSentinel: 'sentinel-1',
    logicalResourceIds: [
      { logicalName: 'machine', providerId: 'machine-provider-1' },
      { logicalName: 'volume', providerId: 'volume-provider-1' },
    ],
    targetBindingDigest: digest('target'),
  });
  refusal('SNAPBACK_PLANNED_BINDING_PROMOTION_INVALID', () => supervisor.promotePlannedBinding({
    journeyId: 'journey-2',
    plannedBindingDigest: digest('planned-2'),
    logicalResourceNames: ['machine', 'volume'],
    provider: 'fly',
    region: 'sjc',
    ownershipSentinel: 'sentinel-2',
    logicalResourceIds: [{ logicalName: 'machine', providerId: 'machine-provider-2' }],
    targetBindingDigest: digest('target-2'),
  }));
}

// Target bindings are closed, generation-fenced, and cannot authorize a
// second routed Machine or autoscaler.
{
  const supervisor = create();
  const binding = {
    schemaVersion: 'snapback.fly-target-binding.v2',
    targetId: 'target-1',
    bindingGeneration: 1,
    predecessorBindingSha256: null,
    organizationId: 'personal',
    appId: 'app-1',
    region: 'sjc',
    publicOrigin: 'https://app-1.fly.dev',
    activeMachineId: 'machine-1',
    machineRoster: ['machine-1'],
    routedMachineIds: ['machine-1'],
    serviceProcessGroups: ['app'],
    autostopEnabled: false,
    autostartEnabled: true,
    autoscaleEnabled: false,
    volumeId: 'volume-1',
    ociRepository: 'registry.fly.io/app-1',
    ociDigest: digest('app-image'),
    tigrisBucket: 'bucket-1',
    artifactPrefix: 'artifacts/',
    backupPrefix: 'backups/',
    controlStatePrefix: 'control/',
    auditPrefix: 'audit/',
    logPrefix: 'logs/',
    cleanupPrefix: 'cleanup/',
    tlsIssuer: 'letsencrypt-staging',
    certificatePosture: 'same-volume-loopback-caddy',
    externalHeadKey: 'control/head.json',
    ownershipSentinel: 'sentinel-1',
    supervisorInstallationId: installationReceipt.installationId,
    supervisorOciDigest: digest('supervisor-image'),
    credentials: [{
      role: 'flyRead',
      credentialRef: 'provider-secret://supervisor/fly-read',
      fingerprint: digest('fly-read'),
      allowedVerbs: ['read'],
      resourcePrefixes: ['app-1'],
    }],
    observedAtMs: 1,
    expiresAtMs: 60_001,
  };
  const registered = supervisor.registerTargetBinding(binding);
  assert.match(registered.bindingSha256, /^sha256:[0-9a-f]{64}$/);
  refusal('SNAPBACK_FLY_TARGET_BINDING_INVALID', () => supervisor.registerTargetBinding({
    ...binding,
    bindingGeneration: 2,
    predecessorBindingSha256: registered.bindingSha256,
    autoscaleEnabled: true,
  }));
  const second = supervisor.registerTargetBinding({
    ...binding,
    bindingGeneration: 2,
    predecessorBindingSha256: registered.bindingSha256,
    observedAtMs: 2,
    expiresAtMs: 60_002,
  });
  assert.equal(second.binding.bindingGeneration, 2);
  const enrollment = supervisor.registerHostedTargetEnrollment({
    schemaVersion: 'snapback.hosted-target-enrollment.v1',
    targetId: 'target-1',
    deploymentId: 'deployment-1',
    publicOrigin: binding.publicOrigin,
    firstContactTransport: 'hstsPreloadedSuffix',
    admissionPublicKey: 'A'.repeat(43),
    supportSha256: 'a'.repeat(64),
    signingSeedCredentialRef: '/run/secrets/target-1-admission-seed',
    clientCertificateSha256: digest('target-1-client-certificate'),
  });
  assert.equal(enrollment.deploymentId, 'deployment-1');
  const firstAdmission = supervisor.reserveOnlineAdmission({
    targetId: 'target-1',
    machineId: 'machine-1',
    processBootId: '01965f5e-1234-7abc-8def-0123456789ab',
    providerFactsSha256: digest('provider-roster-1'),
    issuedAtMs: 100,
  });
  const renewedAdmission = supervisor.reserveOnlineAdmission({
    targetId: 'target-1',
    machineId: 'machine-1',
    processBootId: '01965f5e-1234-7abc-8def-0123456789ab',
    providerFactsSha256: digest('provider-roster-2'),
    issuedAtMs: 101,
  });
  assert.equal(renewedAdmission.admissionEpoch, firstAdmission.admissionEpoch);
  assert.equal(
    renewedAdmission.senderReplayEpochFloor,
    firstAdmission.senderReplayEpochFloor,
  );
  const nextBootAdmission = supervisor.reserveOnlineAdmission({
    targetId: 'target-1',
    machineId: 'machine-1',
    processBootId: '01965f5e-5678-7abc-8def-0123456789ab',
    providerFactsSha256: digest('provider-roster-3'),
    issuedAtMs: 102,
  });
  assert.ok(nextBootAdmission.admissionEpoch > renewedAdmission.admissionEpoch);
  refusal('SNAPBACK_HOSTED_TARGET_ENROLLMENT_IMMUTABLE', () => {
    supervisor.registerHostedTargetEnrollment({
      ...enrollment,
      deploymentId: 'deployment-other',
    });
  });
  refusal('SNAPBACK_FLY_TARGET_BINDING_INVALID', () => supervisor.registerTargetBinding({
    ...binding,
    bindingGeneration: 3,
    predecessorBindingSha256: second.bindingSha256,
    machineRoster: ['machine-1', 'machine-2'],
    routedMachineIds: ['machine-1', 'machine-2'],
  }));
}

// Exact roster admission is fail-closed for every protected hosted path.
{
  const supervisor = create();
  const admitted = supervisor.admitRoster({
    targetId: 'target-1',
    expectedMachineId: 'machine-1',
    machines: [{ id: 'machine-1', productionRouted: true }],
    autoscaleEnabled: false,
    observedAtMs: 10,
    expiresAtMs: 70,
  });
  assert.equal(admitted.allProtectedServingAdmitted, true);
  for (const input of [
    { machines: [], autoscaleEnabled: false },
    { machines: [{ id: 'machine-1', productionRouted: true }, { id: 'machine-2', productionRouted: true }], autoscaleEnabled: false },
    { machines: [{ id: 'machine-1', productionRouted: true }], autoscaleEnabled: true },
    { machines: [{ id: 'machine-other', productionRouted: true }], autoscaleEnabled: false },
    {
      machines: [{ id: 'machine-1', productionRouted: true }],
      autoscaleEnabled: false,
      expiresAtMs: 70_011,
    },
  ]) {
    refusal('SNAPBACK_EPHEMERAL_ROUTING_UNSAFE', () => supervisor.admitRoster({
      targetId: 'target-1',
      expectedMachineId: 'machine-1',
      observedAtMs: 10,
      expiresAtMs: 70,
      ...input,
    }));
  }
}

// Cleanup is sentinel-limited, confirmation-bound, absence-proven, and keeps
// immutable evidence objects out of the deletion set.
{
  const supervisor = create();
  const inventory = [
    {
      logicalName: 'temporary-machine',
      providerId: 'machine-temp',
      resourceKind: 'machine',
      ownershipSentinel: 'sentinel-1',
      disposition: 'delete',
      continuingCostMicrosPerHour: 40,
    },
    {
      logicalName: 'journey-evidence',
      providerId: 'evidence-prefix',
      resourceKind: 'object-prefix',
      ownershipSentinel: 'sentinel-1',
      disposition: 'retain',
      continuingCostMicrosPerHour: 0,
    },
  ];
  const plan = supervisor.planCleanup({
    cleanupPlanId: 'cleanup-1',
    journeyId: 'journey-1',
    targetOrPlannedBindingDigest: digest('target'),
    ownershipSentinel: 'sentinel-1',
    inventory,
    cleanupReserveMicros: 100,
    confirmationSha256: digest('confirm'),
  });
  supervisor.confirmCleanup('cleanup-1', {
    inventorySha256: plan.inventorySha256,
    confirmationSha256: digest('confirm'),
  });
  refusal('SNAPBACK_CLEANUP_INCOMPLETE', () => supervisor.applyCleanup('cleanup-1', []));
  const completed = supervisor.applyCleanup('cleanup-1', [{ providerId: 'machine-temp', absent: true }]);
  assert.equal(completed.applied, true);
}

// X25519 recipient custody: persisted transfer contains only ciphertext and a
// successor-only wrapped key. A different successor cannot unwrap it.
{
  const recipient = createCertificateRecipient({
    journeyId: 'journey-1',
    plannedBindingDigest: digest('planned'),
    successorMachineId: 'machine-new',
    successorVolumeId: 'volume-new',
    bindingGeneration: 2,
    expiresAtMs: 10_000,
  });
  const plaintext = Buffer.from('secret certificate bundle');
  const transfer = sealCertificateTransfer({
    attestation: recipient.attestation,
    manifest: { files: [{ path: 'cert.pem', mode: 0o600, sha256: digest('cert') }] },
    plaintextBundle: plaintext,
    nowMs: 100,
    predecessorMachineId: 'machine-old',
    expected: {
      successorMachineId: 'machine-new',
      successorVolumeId: 'volume-new',
      bindingGeneration: 2,
      successorRouted: false,
    },
  });
  assert.equal(JSON.stringify(transfer).includes(plaintext.toString()), false);
  assert.deepEqual(openCertificateTransfer({
    transfer,
    successorPrivateKey: recipient.privateKey,
    nowMs: 200,
  }), plaintext);
  const stranger = createCertificateRecipient({
    journeyId: 'journey-1',
    plannedBindingDigest: digest('planned'),
    successorMachineId: 'machine-other',
    successorVolumeId: 'volume-other',
    bindingGeneration: 2,
    expiresAtMs: 10_000,
  });
  assert.throws(() => openCertificateTransfer({
    transfer,
    successorPrivateKey: stranger.privateKey,
    nowMs: 200,
  }));
  refusal('SNAPBACK_TLS_RECIPIENT_INVALID', () => sealCertificateTransfer({
    attestation: recipient.attestation,
    manifest: { files: [] },
    plaintextBundle: plaintext,
    nowMs: 100,
    predecessorMachineId: 'machine-old',
    expected: {
      successorMachineId: 'machine-new',
      successorVolumeId: 'volume-new',
      bindingGeneration: 2,
      successorRouted: true,
    },
  }));
}

console.log('snapback-hosted-supervisor: deterministic protocol corpus passed');
