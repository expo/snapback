// @ref LLP 0072#identities-and-objects — registrations bind every hosted
// operation to exact, never-reused identities and a digest-pinned adapter.
// @ref LLP 0072#cli-and-automation-contract — planning is read-only,
// content-addressed, expiring, and fenced by provider read-back.

import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  chmodSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { readFileDescriptorSafe as readFileDescriptorSafeInternal } from './file-custody.mjs';

const TARGET_KEYS = [
  'schemaVersion', 'targetId', 'projectId', 'environmentId', 'deploymentId',
  'databaseId', 'streamIncarnation', 'targetProfileId', 'productionClass',
  'adapter', 'createdAtMs',
];
const ADAPTER_KEYS = [
  'kind', 'version', 'driverPath', 'driverSha256', 'provider',
  'accountFingerprint', 'region', 'publicOrigin', 'credentialRef',
  'stateStoreRef',
];
const OBSERVATION_KEYS = [
  'targetId', 'environmentId', 'deploymentId', 'databaseId',
  'streamIncarnation', 'targetProfileId', 'provider', 'accountFingerprint',
  'region', 'publicOrigin', 'resourceId', 'state', 'activationGeneration',
  'activeReleaseId', 'applicationSentinelSha256', 'credentialStatus', 'providerFactsSha256',
  'observedAtMs', 'capabilityGaps',
];
const PLAN_KEYS = [
  'artifactKind', 'schemaVersion', 'operationId', 'reason', 'targetId',
  'projectId', 'environmentId', 'deploymentId', 'databaseId',
  'streamIncarnation', 'targetProfileId', 'productionClass',
  'targetDescriptorSha256', 'targetObservationSha256',
  'observedActivationGeneration', 'observedActiveReleaseId', 'releaseId',
  'releaseManifestSha256', 'preparedReleaseId',
  'preparedReleaseManifestSha256', 'steps', 'blockers', 'applyEligible',
  'createdAtMs', 'expiresAtMs', 'planId', 'confirmation',
];
const LIFECYCLE_RESPONSE_KEYS = [
  'schemaVersion', 'operation', 'operationId', 'ok', 'idempotentReplay',
  'remoteEvidence', 'inputSha256', 'outputSha256', 'lease', 'observation',
  'evidence', 'backup', 'restore', 'diagnostics',
];
const LEASE_KEYS = ['leaseId', 'targetId', 'operationId', 'expectedActivationGeneration', 'acquiredAtMs', 'expiresAtMs'];
const EVIDENCE_KEYS = ['kind', 'uri', 'sha256', 'bytes', 'verified'];
const BACKUP_KEYS = [
  'schemaVersion', 'backupId', 'operationId', 'targetId', 'deploymentId',
  'databaseId', 'streamIncarnation', 'releaseId', 'schemaIdentitySha256',
  'encryptionClass', 'storageClass', 'retentionPolicy', 'components',
  'excludedSecretClasses', 'createdAtMs', 'verifiedAtMs',
];
const BACKUP_COMPONENT_KEYS = ['kind', 'sha256', 'bytes', 'objects', 'verified'];
const BACKUP_PLAN_KEYS = [
  'schemaVersion', 'planId', 'operationId', 'reason', 'targetId', 'projectId',
  'environmentId', 'deploymentId', 'databaseId', 'streamIncarnation',
  'targetProfileId', 'productionClass', 'targetDescriptorSha256',
  'targetObservationSha256', 'observedActivationGeneration',
  'observedActiveReleaseId', 'observedSchemaGeneration', 'retentionPolicy',
  'steps', 'blockers', 'applyEligible', 'confirmation', 'createdAtMs',
  'expiresAtMs',
];
const AUDIT_EVENT_KEYS = [
  'schemaVersion', 'eventId', 'sequence', 'eventType', 'eventVersion',
  'outcome', 'actorAuthority', 'actorId', 'targetId', 'deploymentId',
  'databaseId', 'streamIncarnation', 'operationId', 'planId', 'receiptId',
  'reasonCode', 'payload', 'retentionClass', 'recordedAtMs',
  'previousEventId',
];
const CONTROL_AUDIT_LOCK_MAX_AGE_MS = 30_000;
const RESTORE_RESULT_KEYS = [
  'backupId', 'sourceTargetId', 'sourceDeploymentId', 'sourceDatabaseId',
  'sourceStreamIncarnation', 'destinationTargetId', 'destinationDeploymentId',
  'destinationDatabaseId', 'destinationStreamIncarnation', 'restoreEpoch',
  'effectsFenced', 'componentsVerified', 'applicationSentinelSha256',
  'acceptanceSha256', 'externalEffectsDisabled', 'activated',
];
const ROLLBACK_PLAN_KEYS = [
  'schemaVersion', 'planId', 'operationId', 'reason', 'targetId', 'projectId',
  'environmentId', 'deploymentId', 'databaseId', 'streamIncarnation',
  'targetProfileId', 'productionClass', 'targetDescriptorSha256',
  'targetObservationSha256', 'observedActivationGeneration',
  'observedActiveReleaseId', 'destinationReleaseId',
  'destinationPreparedReleaseId', 'compatibilitySha256', 'steps', 'blockers',
  'applyEligible', 'confirmation', 'createdAtMs', 'expiresAtMs',
];
const RESTORE_PLAN_KEYS = [
  'schemaVersion', 'planId', 'operationId', 'reason', 'sourceTargetId',
  'backupId', 'backupManifestSha256', 'destinationTargetId', 'projectId',
  'environmentId', 'deploymentId', 'databaseId', 'streamIncarnation',
  'targetProfileId', 'productionClass', 'targetDescriptorSha256',
  'targetObservationSha256', 'observedActivationGeneration',
  'observedActiveReleaseId', 'replacementReleaseId',
  'destinationSentinelSha256', 'steps', 'blockers', 'applyEligible',
  'confirmation', 'createdAtMs', 'expiresAtMs',
];
const RESTORE_ACTIVATION_PLAN_KEYS = [
  'schemaVersion', 'planId', 'operationId', 'reason', 'restoreReceiptId',
  'backupId', 'targetId', 'deploymentId', 'databaseId', 'streamIncarnation',
  'targetDescriptorSha256', 'targetObservationSha256',
  'observedActivationGeneration', 'restoredReleaseId',
  'preparedReleaseId', 'preparedReleaseManifestSha256',
  'adapterQualificationId', 'adapterQualificationSha256',
  'applicationSentinelSha256', 'steps', 'blockers', 'applyEligible',
  'confirmation', 'createdAtMs', 'expiresAtMs',
];
const MAINTENANCE_RECEIPT_KEYS = [
  'schemaVersion', 'receiptId', 'kind', 'planId', 'operationId', 'targetId',
  'deploymentId', 'databaseId', 'streamIncarnation',
  'activationGenerationBefore', 'activationGenerationAfter',
  'releaseIdBefore', 'releaseIdAfter', 'backupId', 'restore', 'outcome',
  'remoteEvidence', 'steps', 'gaps', 'startedAtMs', 'finishedAtMs',
];
const QUERY_RESPONSE_KEYS = [
  'schemaVersion', 'operation', 'operationId', 'ok', 'remoteEvidence',
  'inputSha256', 'outputSha256', 'observation', 'logs', 'inspection',
  'evidence', 'diagnostics',
];
const LOG_PAGE_KEYS = [
  'entries', 'nextCursor', 'retentionClass', 'indexingClass',
  'deliveryLatencyMs', 'droppedEvents', 'backpressure',
];
const LOG_ENTRY_KEYS = [
  'timestampMs', 'severity', 'deploymentId', 'releaseId',
  'activationGeneration', 'streamIncarnation', 'correlationId', 'eventCode',
  'eventVersion', 'payload',
];
const LOG_FIELD_KEYS = ['name', 'value'];
const INSPECTION_KEYS = [
  'targetId', 'deploymentId', 'databaseId', 'streamIncarnation',
  'activeReleaseId', 'inactiveReleaseIds', 'activationGeneration',
  'schemaGeneration', 'configGeneration', 'authGeneration',
  'workerGeneration', 'capabilityManifestSha256', 'capabilityGaps', 'health',
  'dependencies', 'migration', 'backups', 'queues', 'connections', 'resources',
  'operations', 'diagnostics',
];
const INSPECTION_FACT_KEYS = ['name', 'status', 'valueSha256'];
const OPERATION_SUMMARY_KEYS = ['operationId', 'kind', 'outcome', 'finishedAtMs', 'receiptId'];
const QUALIFICATION_KEYS = [
  'schemaVersion', 'qualificationId', 'targetId', 'targetProfileId',
  'adapterKind', 'adapterVersion', 'driverSha256', 'provider',
  'accountFingerprint', 'region', 'publicOrigin', 'remoteEvidence',
  'hostedAuthDrill', 'claims', 'gaps', 'qualifiedAtMs',
];
const HOSTED_AUTH_DRILL_KEYS = [
  'schemaVersion', 'receiptId', 'targetId', 'targetProfileId', 'deploymentId',
  'provider', 'accountFingerprint', 'region', 'publicOrigin',
  'browserArtifactSha256', 'admission', 'liveHealth', 'evidence', 'gaps',
  'startedAtMs', 'finishedAtMs',
];
const HOSTED_ADMISSION_KEYS = [
  'version', 'deploymentId', 'configurationSha256', 'supportSha256',
  'admissionEpoch', 'senderReplayEpochFloor', 'issuedAtMs', 'expiresAtMs',
  'limiterEpoch', 'authenticationThrottleConfig',
  'invalidationEpoch', 'handlerProtocolVersion', 'handlerIncarnation',
  'operatorSurface', 'browserDirectBearerSeam', 'hostedAuth',
];
const AUTHENTICATION_THROTTLE_CONFIG_KEYS = [
  'retentionMs', 'maximumKeyCount', 'global', 'source', 'subject',
  'sourceSubject', 'family',
];
const AUTHENTICATION_BUCKET_POLICY_KEYS = [
  'intervalMs', 'burst', 'maximumDenialDebtAttempts',
];
const HOSTED_AUTH_CAPABILITY_KEYS = [
  'externalTls', 'effectiveSource', 'authenticationThrottle',
  'sessionInvalidation', 'clientCredentialPosture',
];
const HOSTED_AUTH_HEALTH_KEYS = [
  'admissionEpoch', 'senderReplayEpochFloor', 'senderReplayEpochFloorCurrent',
  'limiterReachable', 'invalidationCurrent',
  'serializedAuthorityCurrent', 'handlerCompatible', 'servingAdmitted',
  'observedAtMs',
];
const QUALIFICATION_CLAIMS = [
  'identityFencing', 'immutableUploadReadBack', 'tlsOrigin', 'hostedAuth',
  'healthAcceptance', 'logsInspection', 'compatibilityRollback',
  'backupRestore', 'interruptionResume', 'secretScan', 'costCapacity',
];
const PREPARED_RELEASE_KEYS = [
  'schemaVersion', 'preparedReleaseId', 'baseReleaseId',
  'baseReleaseManifestSha256', 'projectId', 'targetId', 'targetProfileId',
  'adapterQualificationId', 'adapterQualificationSha256', 'compatibility',
  'evidence', 'gaps', 'activationEligible', 'preparedAtMs',
];
const REMOTE_DRILL_STORAGE_KEYS = [
  'computeClass', 'persistentVolumeClass', 'persistentVolumeEncrypted',
  'artifactStoreRef', 'artifactStorageClass', 'backupStoreRef',
  'backupStorageClass', 'backupPermissionBoundary',
];
const REMOTE_DRILL_LOG_KEYS = ['sinkRef', 'retentionClass', 'redactionProfile'];
const REMOTE_DRILL_CREDENTIAL_INPUT_KEYS = ['admissionKeyRef', 'replayFloorStoreRef'];
const REMOTE_DRILL_CREDENTIAL_KEYS = [
  'controlCredentialRef', 'controlStateStoreRef',
  'admissionKeyRef', 'replayFloorStoreRef',
];
const REMOTE_DRILL_COST_INPUT_KEYS = [
  'currency', 'estimatedMonthlyMinorUnits', 'maximumMonthlyMinorUnits',
  'estimateBasisSha256',
];
const REMOTE_DRILL_COST_KEYS = [
  ...REMOTE_DRILL_COST_INPUT_KEYS, 'includedComponents',
];
const REMOTE_DRILL_PLAN_KEYS = [
  'schemaVersion', 'reason', 'targetId', 'targetProfileId', 'productionClass',
  'targetDescriptorSha256', 'adapterKind', 'adapterVersion', 'driverSha256',
  'provider', 'accountFingerprint', 'region', 'publicOrigin', 'storage', 'tls',
  'supervisor', 'logs', 'credentials', 'cost', 'nonclaims',
  'provisioningAuthority', 'createdAtMs', 'expiresAtMs', 'planId',
  'confirmation',
];
const REMOTE_DRILL_COST_COMPONENTS = [
  'compute', 'persistentVolume', 'objectStorage', 'logs', 'dns', 'tls',
];
const REMOTE_DRILL_NONCLAIMS = [
  'highAvailability', 'autoscaling', 'multiRegion', 'zeroDowntime',
  'untrustedMultiTenancy', 'managedServiceSla',
];
const HOSTED_ADMISSION_ENVELOPE_VERSION = 'snapback.hosted-admission-envelope.v1';
const HOSTED_ADMISSION_MAC_DOMAIN = Buffer.from('snapback-hosted-admission-envelope-v1\0');
const PREPARED_EVIDENCE_KINDS = [
  'runtimeArtifact', 'serverArtifact', 'artifactSignature', 'licenseSbom',
  'buildProvenance', 'compatibilityGenerations', 'migrationPlan',
  'healthProbes', 'acceptanceProbes', 'configRequirements',
];
const COMPATIBILITY_ENVELOPE_KEYS = [
  'minimumReadableSchemaGeneration', 'maximumReadableSchemaGeneration',
  'writeSchemaGeneration', 'minimumRetainedClientGeneration',
  'minimumJobGeneration', 'minimumConfigGeneration', 'migrationSha256',
  'migrationTransactional', 'irreversibleBoundary', 'rollbackMode',
];
// @ref LLP 0037#decision-ratified-2026-07-02 — Rust-owned schemas are the shared-artifact
// authority; this explicit registry lets the package test bind every
// hand-maintained JS closed-key validator to its generated property set.
const CLOSED_KEY_SCHEMA_BINDINGS = [
  { name: 'TARGET_KEYS', keys: TARGET_KEYS, schemaFile: 'target.descriptor.schema.json' },
  { name: 'ADAPTER_KEYS', keys: ADAPTER_KEYS, schemaFile: 'target.descriptor.schema.json', definition: 'VmAdapterDescriptor' },
  { name: 'OBSERVATION_KEYS', keys: OBSERVATION_KEYS, schemaFile: 'vm-adapter.response.schema.json', definition: 'TargetObservation' },
  { name: 'PLAN_KEYS', keys: PLAN_KEYS, schemaFile: 'deploy.plan.schema.json' },
  { name: 'LIFECYCLE_RESPONSE_KEYS', keys: LIFECYCLE_RESPONSE_KEYS, schemaFile: 'vm-adapter.lifecycle-response.schema.json' },
  { name: 'LEASE_KEYS', keys: LEASE_KEYS, schemaFile: 'vm-adapter.lifecycle-response.schema.json', definition: 'DeploymentLease' },
  { name: 'EVIDENCE_KEYS', keys: EVIDENCE_KEYS, schemaFile: 'vm-adapter.lifecycle-response.schema.json', definition: 'AdapterEvidenceRef' },
  { name: 'BACKUP_KEYS', keys: BACKUP_KEYS, schemaFile: 'backup.manifest.schema.json' },
  { name: 'BACKUP_COMPONENT_KEYS', keys: BACKUP_COMPONENT_KEYS, schemaFile: 'backup.manifest.schema.json', definition: 'BackupComponent' },
  { name: 'BACKUP_PLAN_KEYS', keys: BACKUP_PLAN_KEYS, schemaFile: 'backup.plan.schema.json' },
  { name: 'AUDIT_EVENT_KEYS', keys: AUDIT_EVENT_KEYS, schemaFile: 'control.audit-event.schema.json' },
  { name: 'RESTORE_RESULT_KEYS', keys: RESTORE_RESULT_KEYS, schemaFile: 'maintenance.receipt.schema.json', definition: 'RestoreResult' },
  { name: 'ROLLBACK_PLAN_KEYS', keys: ROLLBACK_PLAN_KEYS, schemaFile: 'rollback.plan.schema.json' },
  { name: 'RESTORE_PLAN_KEYS', keys: RESTORE_PLAN_KEYS, schemaFile: 'restore.plan.schema.json' },
  { name: 'RESTORE_ACTIVATION_PLAN_KEYS', keys: RESTORE_ACTIVATION_PLAN_KEYS, schemaFile: 'restore.activation-plan.schema.json' },
  { name: 'MAINTENANCE_RECEIPT_KEYS', keys: MAINTENANCE_RECEIPT_KEYS, schemaFile: 'maintenance.receipt.schema.json' },
  { name: 'QUERY_RESPONSE_KEYS', keys: QUERY_RESPONSE_KEYS, schemaFile: 'vm-adapter.query-response.schema.json' },
  { name: 'LOG_PAGE_KEYS', keys: LOG_PAGE_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'ControlLogPage' },
  { name: 'LOG_ENTRY_KEYS', keys: LOG_ENTRY_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'ControlLogEntry' },
  { name: 'LOG_FIELD_KEYS', keys: LOG_FIELD_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'RedactedLogField' },
  { name: 'INSPECTION_KEYS', keys: INSPECTION_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'AuthenticatedInspection' },
  { name: 'INSPECTION_FACT_KEYS', keys: INSPECTION_FACT_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'InspectionFact' },
  { name: 'OPERATION_SUMMARY_KEYS', keys: OPERATION_SUMMARY_KEYS, schemaFile: 'vm-adapter.query-response.schema.json', definition: 'ControlOperationSummary' },
  { name: 'QUALIFICATION_KEYS', keys: QUALIFICATION_KEYS, schemaFile: 'adapter.qualification.schema.json' },
  { name: 'HOSTED_AUTH_DRILL_KEYS', keys: HOSTED_AUTH_DRILL_KEYS, schemaFile: 'hosted-auth.drill-receipt.schema.json' },
  { name: 'HOSTED_ADMISSION_KEYS', keys: HOSTED_ADMISSION_KEYS, schemaFile: 'auth.hosted-admission.schema.json' },
  { name: 'AUTHENTICATION_THROTTLE_CONFIG_KEYS', keys: AUTHENTICATION_THROTTLE_CONFIG_KEYS, schemaFile: 'auth.hosted-admission.schema.json', definition: 'SharedAuthenticationThrottleConfig' },
  { name: 'AUTHENTICATION_BUCKET_POLICY_KEYS', keys: AUTHENTICATION_BUCKET_POLICY_KEYS, schemaFile: 'auth.hosted-admission.schema.json', definition: 'AuthenticationBucketPolicy' },
  { name: 'HOSTED_AUTH_CAPABILITY_KEYS', keys: HOSTED_AUTH_CAPABILITY_KEYS, schemaFile: 'auth.hosted-capabilities.schema.json' },
  { name: 'HOSTED_AUTH_HEALTH_KEYS', keys: HOSTED_AUTH_HEALTH_KEYS, schemaFile: 'hosted-auth.drill-receipt.schema.json', definition: 'HostedAuthLiveHealth' },
  { name: 'PREPARED_RELEASE_KEYS', keys: PREPARED_RELEASE_KEYS, schemaFile: 'prepared-release.manifest.schema.json' },
  { name: 'REMOTE_DRILL_STORAGE_KEYS', keys: REMOTE_DRILL_STORAGE_KEYS, schemaFile: 'remote-drill.plan.schema.json', definition: 'RemoteDrillStorage' },
  { name: 'REMOTE_DRILL_LOG_KEYS', keys: REMOTE_DRILL_LOG_KEYS, schemaFile: 'remote-drill.plan.schema.json', definition: 'RemoteDrillLogs' },
  { name: 'REMOTE_DRILL_CREDENTIAL_KEYS', keys: REMOTE_DRILL_CREDENTIAL_KEYS, schemaFile: 'remote-drill.plan.schema.json', definition: 'RemoteDrillCredentials' },
  { name: 'REMOTE_DRILL_COST_KEYS', keys: REMOTE_DRILL_COST_KEYS, schemaFile: 'remote-drill.plan.schema.json', definition: 'RemoteDrillCostBoundary' },
  { name: 'REMOTE_DRILL_PLAN_KEYS', keys: REMOTE_DRILL_PLAN_KEYS, schemaFile: 'remote-drill.plan.schema.json' },
  { name: 'COMPATIBILITY_ENVELOPE_KEYS', keys: COMPATIBILITY_ENVELOPE_KEYS, schemaFile: 'prepared-release.manifest.schema.json', definition: 'ReleaseCompatibilityEnvelope' },
];
const NON_SCHEMA_KEY_SETS = [
  'ADAPTER_ENV_KEYS',
  'REMOTE_DRILL_COST_INPUT_KEYS',
  'REMOTE_DRILL_CREDENTIAL_INPUT_KEYS',
];
const EXPECTED_PLAN_STEPS = [
  'verifyIdentity', 'acquireLease', 'uploadImmutableRelease',
  'provisionInactive', 'compatibilityPreflight', 'createVerifiedBackup',
  'stageRelease', 'activateGeneration', 'verifyServedPath', 'releaseLease',
  'rollbackOnFailure',
];
const APPLY_OPERATIONS = EXPECTED_PLAN_STEPS.filter((step) => !['verifyIdentity', 'rollbackOnFailure'].includes(step));
const EXPECTED_ROLLBACK_STEPS = [
  'verifyIdentity', 'acquireLease', 'verifyCompatibility', 'rollback',
  'verifyServedPath', 'releaseLease',
];
const EXPECTED_BACKUP_STEPS = [
  'verifyIdentity', 'acquireLease', 'createVerifiedBackup', 'releaseLease',
];
const EXPECTED_RESTORE_STEPS = [
  'verifyIdentity', 'acquireLease', 'fenceExternalEffects',
  'restoreBackupInactive', 'verifyRestoredComponents',
  'verifyRestoredApplication', 'releaseLease',
];
const EXPECTED_RESTORE_ACTIVATION_STEPS = [
  'verifyIdentity', 'verifyPausedRestore', 'acquireLease',
  'activateRestoredGeneration', 'verifyServedPath', 'releaseLease',
];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;
const MAX_ADAPTER_OUTPUT_BYTES = 256 * 1024;
const MAX_LOG_LIMIT = 500;
const MAX_LOG_FIELDS = 32;
const MAX_INSPECTION_FACTS = 256;
const MAX_AUDIT_FIELDS = 24;
const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const FORBIDDEN_LOG_FIELD = /(?:secret|token|credential|authorization|cookie|private|body|document|message|payment|webhook|query|args|result)/i;
const FORBIDDEN_LOG_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[^A-Za-z0-9_])(?:npm_|gh[oprsu]_)[A-Za-z0-9]{20,}|(?:CLOUDFLARE_API_TOKEN|NPM_TOKEN)\s*=/;
const ACTIVE_STATES = new Set(['registered', 'provisioning', 'inactive', 'staging', 'ready', 'active', 'degraded', 'draining', 'failed', 'restoring', 'retired']);
const CREDENTIAL_STATES = new Set(['ready', 'missing', 'invalid', 'unknown']);
const ADAPTER_ENV_KEYS = ['HOME', 'LANG', 'LC_ALL', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER'];
const DETERMINISTIC_HARNESS = Symbol('snapback-deterministic-lifecycle-harness');

function fail(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'deploy',
    message,
    ...(details === undefined ? {} : { details }),
  };
  return error;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function assertClosed(value, keys, name, code = 'SNAPBACK_TARGET_DESCRIPTOR_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(code, `${name} must be an object`);
  }
  const expected = new Set(keys);
  const observed = Object.keys(value);
  if (observed.length !== expected.size || observed.some((key) => !expected.has(key))) {
    throw fail(code, `${name} has missing or unexpected fields`, { fields: observed.sort() });
  }
}

function assertId(value, name, code = 'SNAPBACK_TARGET_DESCRIPTOR_INVALID') {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw fail(code, `${name} must be a portable, non-empty identifier`);
  }
}

function assertText(value, name, code = 'SNAPBACK_TARGET_DESCRIPTOR_INVALID') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw fail(code, `${name} must be bounded, non-empty text`);
  }
}

function validateAuthenticationThrottleConfig(config, code) {
  assertClosed(
    config,
    AUTHENTICATION_THROTTLE_CONFIG_KEYS,
    'hosted authentication throttle config',
    code,
  );
  if (!Number.isSafeInteger(config.retentionMs)
      || config.retentionMs < 1
      || config.retentionMs > 365 * 86_400_000
      || !Number.isSafeInteger(config.maximumKeyCount)
      || config.maximumKeyCount < 2) {
    throw fail(code, 'hosted authentication throttle retention or key bound is invalid');
  }
  for (const name of ['global', 'source', 'subject', 'sourceSubject', 'family']) {
    const policy = config[name];
    assertClosed(policy, AUTHENTICATION_BUCKET_POLICY_KEYS, `${name} authentication bucket policy`, code);
    if (!Number.isSafeInteger(policy.intervalMs)
        || policy.intervalMs < 1
        || policy.intervalMs > 86_400_000
        || !Number.isSafeInteger(policy.burst)
        || policy.burst < 1
        || policy.burst > 1_000_000
        || !Number.isSafeInteger(policy.maximumDenialDebtAttempts)
        || policy.maximumDenialDebtAttempts < 1
        || policy.maximumDenialDebtAttempts > 1_000_000
        || !Number.isSafeInteger(
          (policy.burst + policy.maximumDenialDebtAttempts) * policy.intervalMs,
        )) {
      throw fail(code, `${name} authentication bucket policy is invalid`);
    }
  }
}

function validateHostedAdmissionShape(admission, code = 'SNAPBACK_HOSTED_ADMISSION_INVALID') {
  assertClosed(admission, HOSTED_ADMISSION_KEYS, 'hosted admission', code);
  assertClosed(admission.hostedAuth, HOSTED_AUTH_CAPABILITY_KEYS, 'hosted auth support', code);
  validateAuthenticationThrottleConfig(admission.authenticationThrottleConfig, code);
  const numericFacts = [
    admission.admissionEpoch,
    admission.senderReplayEpochFloor,
    admission.issuedAtMs,
    admission.expiresAtMs,
    admission.limiterEpoch,
    admission.invalidationEpoch,
  ];
  if (admission.version !== 1
      || !SAFE_ID.test(admission.deploymentId)
      || !/^[0-9a-f]{64}$/.test(admission.configurationSha256)
      || !/^[0-9a-f]{64}$/.test(admission.supportSha256)
      || numericFacts.some((value) => !Number.isSafeInteger(value) || value < 0)
      || admission.admissionEpoch < 1
      || admission.senderReplayEpochFloor < 1
      || admission.limiterEpoch < 1
      || admission.invalidationEpoch < 1
      || admission.issuedAtMs > admission.expiresAtMs
      || admission.expiresAtMs - admission.issuedAtMs > 5 * 60 * 1_000
      || admission.handlerProtocolVersion !== 1
      || !SAFE_ID.test(admission.handlerIncarnation)
      || admission.operatorSurface !== 'disabled'
      || admission.browserDirectBearerSeam !== 'excluded'
      || admission.hostedAuth.externalTls !== 'enforced'
      || admission.hostedAuth.effectiveSource !== 'trusted'
      || admission.hostedAuth.authenticationThrottle !== 'sharedEnforced'
      || admission.hostedAuth.sessionInvalidation !== 'globallyFenced'
      || admission.hostedAuth.clientCredentialPosture !== 'senderConstrainedV2') {
    throw fail(code, 'hosted admission is incomplete or unsafe');
  }
  return admission;
}

/// Produce the exact MAC-authenticated, non-secret envelope consumed by the
/// native hosted-startup gate. Concrete adapters obtain keyMaterial from
/// their provider secret backend and must never retain it in returned JSON.
export function sealHostedAdmissionEnvelope(options = {}) {
  const code = 'SNAPBACK_HOSTED_ADMISSION_INVALID';
  const admission = validateHostedAdmissionShape(options.admission, code);
  assertId(options.keyId, 'keyId', code);
  assertText(options.publicOrigin, 'publicOrigin', code);
  let parsedOrigin;
  try {
    parsedOrigin = new URL(options.publicOrigin);
  } catch {
    throw fail(code, 'publicOrigin must be one canonical HTTPS origin');
  }
  if (parsedOrigin.protocol !== 'https:'
      || parsedOrigin.username !== ''
      || parsedOrigin.password !== ''
      || parsedOrigin.pathname !== '/'
      || parsedOrigin.search !== ''
      || parsedOrigin.hash !== ''
      || parsedOrigin.origin !== options.publicOrigin) {
    throw fail(code, 'publicOrigin must be one canonical HTTPS origin');
  }
  if (!(options.keyMaterial instanceof Uint8Array) || options.keyMaterial.byteLength !== 32) {
    throw fail(code, 'keyMaterial must be exactly 32 secret bytes');
  }
  const content = {
    schemaVersion: HOSTED_ADMISSION_ENVELOPE_VERSION,
    keyId: options.keyId,
    publicOrigin: options.publicOrigin,
    admission,
  };
  const key = Buffer.from(options.keyMaterial);
  let mac;
  try {
    mac = createHmac('sha256', key)
      .update(HOSTED_ADMISSION_MAC_DOMAIN)
      .update(Buffer.from(canonicalJson(content)))
      .digest('base64url');
  } finally {
    key.fill(0);
  }
  return { ...content, mac };
}

function assertSecureDirectory(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw fail('SNAPBACK_CONTROL_STORE_UNSAFE', 'the control store must be a non-symlink directory', { path: absolute });
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw fail('SNAPBACK_CONTROL_STORE_UNSAFE', 'the control store must be owner-only (mode 0700)', { path: absolute });
  }
  return realpathSync.native(absolute);
}

function assertSecureFile(path, code = 'SNAPBACK_CONTROL_STORE_UNSAFE') {
  const metadata = lstatSync(path);
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : metadata.uid;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1
      || metadata.uid !== expectedUid || (metadata.mode & 0o077) !== 0) {
    throw fail(code, 'control-plane artifacts must be regular, single-link, owner-only files', { path });
  }
}

// @ref LLP 0017#security-defaults — owner-only credential carriers are
// opened once without following links, validated on that descriptor, and
// bounded-read before the same descriptor is revalidated.
function readFileDescriptorSafe(path, code, options = {}) {
  return readFileDescriptorSafeInternal(path, code, {
    ...options,
    maximumBytes: options.maximumBytes ?? MAX_CONTROL_FILE_BYTES,
    makeFailure: (failureCode, message, details) => fail(failureCode, message, details),
  });
}

function readBoundedJson(path, code) {
  const bytes = readFileDescriptorSafe(path, code, { ownerOnly: true });
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (cause) {
    const error = fail(code, 'control-plane artifact is not valid JSON', { path });
    error.cause = cause;
    throw error;
  }
}

function syncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeOwnerOnly(path, value) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  let created = true;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    try {
      linkSync(temporary, path);
    } catch (cause) {
      if (cause?.code !== 'EEXIST') throw cause;
      assertSecureFile(path);
      if (!readFileSync(path).equals(bytes)) throw cause;
      created = false;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
  syncDirectory(dirname(path));
  assertSecureFile(path);
  return created;
}

function replaceOwnerOnly(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, `${canonicalJson(value)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
  syncDirectory(dirname(path));
  assertSecureFile(path);
}

function driverDigest(path) {
  const absolute = resolve(path);
  let canonical;
  let metadata;
  try {
    canonical = realpathSync.native(absolute);
    metadata = lstatSync(absolute);
  } catch (cause) {
    const error = fail('SNAPBACK_ADAPTER_DRIVER_INVALID', 'adapter driver does not exist or cannot be inspected', { path: absolute });
    error.cause = cause;
    throw error;
  }
  if (!isAbsolute(path) || canonical !== absolute) {
    throw fail('SNAPBACK_ADAPTER_DRIVER_INVALID', 'adapter driverPath must be an absolute, canonical, non-symlink path', { path });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o111) === 0) {
    throw fail('SNAPBACK_ADAPTER_DRIVER_INVALID', 'adapter driver must be a regular executable file', { path: absolute });
  }
  return sha256(readFileSync(absolute));
}

export function validateTargetDescriptor(target) {
  assertClosed(target, TARGET_KEYS, 'target descriptor');
  assertClosed(target.adapter, ADAPTER_KEYS, 'target adapter');
  if (target.schemaVersion !== 'snapback.target-descriptor.v1') {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'target descriptor schemaVersion is unsupported');
  }
  for (const name of ['targetId', 'projectId', 'environmentId', 'deploymentId', 'databaseId', 'streamIncarnation', 'targetProfileId']) {
    assertId(target[name], name);
  }
  if (!['preview', 'production'].includes(target.productionClass)) {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'productionClass must be preview or production');
  }
  if (!Number.isSafeInteger(target.createdAtMs) || target.createdAtMs < 0) {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'createdAtMs must be a non-negative safe integer');
  }
  const adapter = target.adapter;
  if (adapter.kind !== 'singleInstanceContainerVm' || !/^\d+\.\d+\.\d+$/.test(adapter.version)) {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'adapter kind or semantic version is unsupported');
  }
  for (const name of ['provider', 'accountFingerprint', 'region']) assertId(adapter[name], `adapter.${name}`);
  if (!DIGEST.test(adapter.driverSha256)) throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'adapter.driverSha256 is malformed');
  let origin;
  try {
    origin = new URL(adapter.publicOrigin);
  } catch {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'adapter.publicOrigin must be an HTTPS origin');
  }
  if (origin.protocol !== 'https:' || origin.origin !== adapter.publicOrigin) {
    throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'adapter.publicOrigin must be an HTTPS origin without path, query, or fragment');
  }
  for (const name of ['credentialRef', 'stateStoreRef']) assertText(adapter[name], `adapter.${name}`);
  assertSecretFreeReference(
    adapter.credentialRef,
    'adapter.credentialRef',
    'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
    ['keychain://', 'secret-store://', 'provider-secret://'],
  );
  assertSecretFreeReference(
    adapter.stateStoreRef,
    'adapter.stateStoreRef',
    'SNAPBACK_TARGET_DESCRIPTOR_INVALID',
  );
  const observedDigest = driverDigest(adapter.driverPath);
  if (observedDigest !== adapter.driverSha256) {
    throw fail('SNAPBACK_ADAPTER_DRIVER_TAMPERED', 'adapter driver bytes do not match the registered digest', {
      expected: adapter.driverSha256,
      observed: observedDigest,
    });
  }
  return target;
}

function roots(options = {}) {
  const root = assertSecureDirectory(options.controlRoot ?? join(process.cwd(), '.snapback', 'control'));
  const targets = assertSecureDirectory(join(root, 'targets'));
  const plans = assertSecureDirectory(join(root, 'plans'));
  const operations = assertSecureDirectory(join(root, 'operations'));
  const receipts = assertSecureDirectory(join(root, 'receipts'));
  const backups = assertSecureDirectory(join(root, 'backups'));
  const maintenancePlans = assertSecureDirectory(join(root, 'maintenance-plans'));
  const maintenanceReceipts = assertSecureDirectory(join(root, 'maintenance-receipts'));
  const remoteDrillPlans = assertSecureDirectory(join(root, 'remote-drill-plans'));
  const auditEvents = assertSecureDirectory(join(root, 'audit-events'));
  return {
    root,
    targets,
    plans,
    operations,
    receipts,
    backups,
    maintenancePlans,
    maintenanceReceipts,
    remoteDrillPlans,
    auditEvents,
  };
}

function assertSecretFreeReference(value, name, code, prefixes = null) {
  assertText(value, name, code);
  let reference;
  try {
    reference = new URL(value);
  } catch {
    throw fail(code, `${name} must be one absolute secret-free reference`);
  }
  if (reference.username || reference.password || reference.search || reference.hash
      || (prefixes !== null && !prefixes.some((prefix) => value.startsWith(prefix)))) {
    throw fail(code, `${name} contains credentials, mutable selectors, or an unsupported scheme`);
  }
  return value;
}

// @ref LLP 0072#adapter-contract-and-first-profile — the first remote drill
// has no provider defaults: all infrastructure, credential, cost, and nonclaim
// facts are content-addressed before any provisioning request exists.
export function createRemoteDrillPlan(options = {}) {
  const code = 'SNAPBACK_REMOTE_DRILL_PLAN_INVALID';
  const target = showTarget(options.targetId, options);
  if (target.targetProfileId !== 'trusted-single-tenant-app-complete.v1'
      || target.adapter.kind !== 'singleInstanceContainerVm') {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_PROFILE_INVALID',
      'remote drill planning requires the exact complete single-instance container/VM profile',
    );
  }
  assertText(options.reason, 'reason', code);
  assertClosed(options.storage, REMOTE_DRILL_STORAGE_KEYS, 'remote drill storage selection', code);
  for (const name of [
    'computeClass',
    'persistentVolumeClass',
    'artifactStorageClass',
    'backupStorageClass',
  ]) {
    assertText(options.storage[name], `storage.${name}`, code);
  }
  if (options.storage.persistentVolumeEncrypted !== true
      || options.storage.backupPermissionBoundary !== 'separateWriteGrant') {
    throw fail(
      code,
      'remote drill storage requires an encrypted volume and separately permissioned backups',
    );
  }
  const artifactStoreRef = assertSecretFreeReference(
    options.storage.artifactStoreRef,
    'storage.artifactStoreRef',
    code,
  );
  const backupStoreRef = assertSecretFreeReference(
    options.storage.backupStoreRef,
    'storage.backupStoreRef',
    code,
  );
  if (artifactStoreRef === backupStoreRef) {
    throw fail(code, 'artifact and backup stores must be distinct permission boundaries');
  }

  assertClosed(options.tls, ['issuer'], 'remote drill TLS selection', code);
  assertText(options.tls.issuer, 'tls.issuer', code);
  assertClosed(options.supervisor, ['kind'], 'remote drill supervisor selection', code);
  if (!['providerSupervisor', 'systemd'].includes(options.supervisor.kind)) {
    throw fail(code, 'remote drill supervisor must be providerSupervisor or systemd');
  }
  assertClosed(options.logs, REMOTE_DRILL_LOG_KEYS, 'remote drill log selection', code);
  const sinkRef = assertSecretFreeReference(options.logs.sinkRef, 'logs.sinkRef', code);
  assertText(options.logs.retentionClass, 'logs.retentionClass', code);
  assertId(options.logs.redactionProfile, 'logs.redactionProfile', code);

  assertClosed(
    options.credentials,
    REMOTE_DRILL_CREDENTIAL_INPUT_KEYS,
    'remote drill credential handles',
    code,
  );
  const admissionKeyRef = assertSecretFreeReference(
    options.credentials.admissionKeyRef,
    'credentials.admissionKeyRef',
    code,
    ['keychain://', 'secret-store://', 'provider-secret://'],
  );
  const replayFloorStoreRef = assertSecretFreeReference(
    options.credentials.replayFloorStoreRef,
    'credentials.replayFloorStoreRef',
    code,
  );
  if ([artifactStoreRef, backupStoreRef, sinkRef].includes(replayFloorStoreRef)) {
    throw fail(code, 'the replay-floor store must be distinct from artifacts, backups, and logs');
  }
  if (admissionKeyRef === target.adapter.credentialRef) {
    throw fail(code, 'the hosted-admission MAC key must not reuse the control credential handle');
  }
  if ([artifactStoreRef, backupStoreRef].includes(target.adapter.stateStoreRef)) {
    throw fail(code, 'control state must be distinct from release artifacts and application backups');
  }

  assertClosed(options.cost, REMOTE_DRILL_COST_INPUT_KEYS, 'remote drill cost boundary', code);
  if (!/^[A-Z]{3}$/.test(options.cost.currency)
      || !Number.isSafeInteger(options.cost.estimatedMonthlyMinorUnits)
      || options.cost.estimatedMonthlyMinorUnits < 0
      || !Number.isSafeInteger(options.cost.maximumMonthlyMinorUnits)
      || options.cost.maximumMonthlyMinorUnits < 1
      || options.cost.maximumMonthlyMinorUnits < options.cost.estimatedMonthlyMinorUnits
      || !DIGEST.test(options.cost.estimateBasisSha256)) {
    throw fail(code, 'remote drill cost boundary or estimate provenance is invalid');
  }
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    throw fail(code, 'remote drill plan time must be a non-negative safe integer');
  }
  const content = {
    schemaVersion: 'snapback.remote-drill-plan.v1',
    reason: options.reason,
    targetId: target.targetId,
    targetProfileId: target.targetProfileId,
    productionClass: target.productionClass,
    targetDescriptorSha256: sha256(Buffer.from(canonicalJson(target))),
    adapterKind: target.adapter.kind,
    adapterVersion: target.adapter.version,
    driverSha256: target.adapter.driverSha256,
    provider: target.adapter.provider,
    accountFingerprint: target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
    storage: canonicalValue(options.storage),
    tls: {
      issuer: options.tls.issuer,
      automatedRenewal: true,
      independentlyAttestedOrigin: true,
    },
    supervisor: {
      kind: options.supervisor.kind,
      restartEvidenceRequired: true,
      interruptionResumeRequired: true,
    },
    logs: {
      sinkRef,
      retentionClass: options.logs.retentionClass,
      redactionProfile: options.logs.redactionProfile,
    },
    credentials: {
      controlCredentialRef: target.adapter.credentialRef,
      controlStateStoreRef: target.adapter.stateStoreRef,
      admissionKeyRef,
      replayFloorStoreRef,
    },
    cost: {
      ...canonicalValue(options.cost),
      includedComponents: [...REMOTE_DRILL_COST_COMPONENTS],
    },
    nonclaims: [...REMOTE_DRILL_NONCLAIMS],
    provisioningAuthority: 'confirmationRequired',
    createdAtMs,
    expiresAtMs: createdAtMs + 60 * 60 * 1_000,
  };
  const planId = sha256(Buffer.from(
    `snapback-remote-drill-plan-v1\0${canonicalJson(content)}`,
  ));
  const plan = { ...content, planId, confirmation: `confirm:${planId}` };
  const path = join(roots(options).remoteDrillPlans, `${planId.slice('sha256:'.length)}.json`);
  if (existsSync(path)) {
    const retained = readFileDescriptorSafe(path, code, { ownerOnly: true }).toString('utf8');
    if (retained !== `${canonicalJson(plan)}\n`) {
      throw fail('SNAPBACK_REMOTE_DRILL_PLAN_COLLISION', 'remote drill plan identity is bound to different bytes');
    }
  } else {
    writeOwnerOnly(path, plan);
  }
  return plan;
}

export function verifyRemoteDrillPlan(planId, options = {}) {
  const code = 'SNAPBACK_REMOTE_DRILL_PLAN_INVALID';
  if (!DIGEST.test(planId)) {
    throw fail(code, 'remote drill plan id must be a sha256 content identity');
  }
  const path = join(roots(options).remoteDrillPlans, `${planId.slice('sha256:'.length)}.json`);
  if (!existsSync(path)) {
    throw fail('SNAPBACK_REMOTE_DRILL_PLAN_NOT_FOUND', 'remote drill plan is not retained', { planId });
  }
  const plan = readBoundedJson(path, code);
  assertClosed(plan, REMOTE_DRILL_PLAN_KEYS, 'remote drill plan', code);
  const {
    planId: observedPlanId,
    confirmation,
    ...content
  } = plan;
  const derivedPlanId = sha256(Buffer.from(
    `snapback-remote-drill-plan-v1\0${canonicalJson(content)}`,
  ));
  if (observedPlanId !== planId || derivedPlanId !== planId
      || confirmation !== `confirm:${planId}`) {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_PLAN_TAMPERED',
      'retained remote drill plan does not match its content identity',
      { planId },
    );
  }
  if (options.targetId !== undefined && options.targetId !== plan.targetId) {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_IDENTITY_MISMATCH',
      'remote drill consumption named a different target than the retained plan',
      { expected: plan.targetId, observed: options.targetId },
    );
  }
  if (options.confirmation !== confirmation) {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_CONFIRMATION_REQUIRED',
      'remote drill consumption requires the exact retained confirmation',
      { planId },
    );
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0
      || !Number.isSafeInteger(plan.createdAtMs) || plan.createdAtMs < 0
      || !Number.isSafeInteger(plan.expiresAtMs) || plan.expiresAtMs <= plan.createdAtMs
      || nowMs > plan.expiresAtMs) {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_PLAN_EXPIRED',
      'remote drill plan is expired or has an invalid validity interval',
      { planId },
    );
  }
  const target = showTarget(plan.targetId, options);
  const targetBindings = {
    targetProfileId: target.targetProfileId,
    productionClass: target.productionClass,
    targetDescriptorSha256: sha256(Buffer.from(canonicalJson(target))),
    adapterKind: target.adapter.kind,
    adapterVersion: target.adapter.version,
    driverSha256: target.adapter.driverSha256,
    provider: target.adapter.provider,
    accountFingerprint: target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
  };
  if (plan.schemaVersion !== 'snapback.remote-drill-plan.v1'
      || plan.provisioningAuthority !== 'confirmationRequired'
      || Object.entries(targetBindings).some(([key, expected]) => plan[key] !== expected)) {
    throw fail(
      'SNAPBACK_REMOTE_DRILL_IDENTITY_MISMATCH',
      'remote drill plan no longer matches the exact registered target',
      { planId },
    );
  }
  assertClosed(plan.storage, REMOTE_DRILL_STORAGE_KEYS, 'remote drill storage selection', code);
  assertClosed(
    plan.tls,
    ['issuer', 'automatedRenewal', 'independentlyAttestedOrigin'],
    'remote drill TLS selection',
    code,
  );
  assertClosed(
    plan.supervisor,
    ['kind', 'restartEvidenceRequired', 'interruptionResumeRequired'],
    'remote drill supervisor selection',
    code,
  );
  assertClosed(plan.logs, REMOTE_DRILL_LOG_KEYS, 'remote drill log selection', code);
  assertClosed(
    plan.credentials,
    REMOTE_DRILL_CREDENTIAL_KEYS,
    'remote drill credential handles',
    code,
  );
  assertClosed(
    plan.cost,
    REMOTE_DRILL_COST_KEYS,
    'remote drill cost boundary',
    code,
  );
  if (plan.storage.persistentVolumeEncrypted !== true
      || plan.storage.backupPermissionBoundary !== 'separateWriteGrant'
      || plan.tls.automatedRenewal !== true
      || plan.tls.independentlyAttestedOrigin !== true
      || !['providerSupervisor', 'systemd'].includes(plan.supervisor.kind)
      || plan.supervisor.restartEvidenceRequired !== true
      || plan.supervisor.interruptionResumeRequired !== true
      || plan.credentials.controlCredentialRef !== target.adapter.credentialRef
      || plan.credentials.controlStateStoreRef !== target.adapter.stateStoreRef
      || canonicalJson(plan.cost.includedComponents) !== canonicalJson(REMOTE_DRILL_COST_COMPONENTS)
      || canonicalJson(plan.nonclaims) !== canonicalJson(REMOTE_DRILL_NONCLAIMS)
      || !/^[A-Z]{3}$/.test(plan.cost.currency)
      || !Number.isSafeInteger(plan.cost.estimatedMonthlyMinorUnits)
      || plan.cost.estimatedMonthlyMinorUnits < 0
      || !Number.isSafeInteger(plan.cost.maximumMonthlyMinorUnits)
      || plan.cost.maximumMonthlyMinorUnits < 1
      || plan.cost.maximumMonthlyMinorUnits < plan.cost.estimatedMonthlyMinorUnits
      || !DIGEST.test(plan.cost.estimateBasisSha256)) {
    throw fail(code, 'remote drill plan has incomplete infrastructure, cost, or nonclaim facts');
  }
  for (const [name, reference] of [
    ['storage.artifactStoreRef', plan.storage.artifactStoreRef],
    ['storage.backupStoreRef', plan.storage.backupStoreRef],
    ['logs.sinkRef', plan.logs.sinkRef],
    ['credentials.admissionKeyRef', plan.credentials.admissionKeyRef],
    ['credentials.replayFloorStoreRef', plan.credentials.replayFloorStoreRef],
  ]) {
    assertSecretFreeReference(
      reference,
      name,
      code,
      name === 'credentials.admissionKeyRef'
        ? ['keychain://', 'secret-store://', 'provider-secret://']
        : null,
    );
  }
  if (plan.storage.artifactStoreRef === plan.storage.backupStoreRef
      || plan.credentials.admissionKeyRef === target.adapter.credentialRef
      || [
        plan.storage.artifactStoreRef,
        plan.storage.backupStoreRef,
        plan.logs.sinkRef,
      ].includes(plan.credentials.replayFloorStoreRef)
      || [
        plan.storage.artifactStoreRef,
        plan.storage.backupStoreRef,
      ].includes(target.adapter.stateStoreRef)) {
    throw fail(code, 'remote drill authority or storage boundaries overlap');
  }
  return plan;
}

function validateControlAuditEvent(event, expectedSequence, previousEventId) {
  assertClosed(event, AUDIT_EVENT_KEYS, 'control audit event', 'SNAPBACK_CONTROL_AUDIT_INVALID');
  const { eventId, ...content } = event;
  const derived = sha256(Buffer.from(`snapback-control-audit-event-v1\0${canonicalJson(content)}`));
  if (event.schemaVersion !== 'snapback.control-audit-event.v1'
      || eventId !== derived || event.sequence !== expectedSequence
      || event.previousEventId !== previousEventId
      || !SAFE_ID.test(event.eventType) || event.eventVersion !== 1
      || !['began', 'succeeded', 'failed', 'read'].includes(event.outcome)
      || !['localOperator', 'automationGrant'].includes(event.actorAuthority)
      || !SAFE_ID.test(event.actorId) || !SAFE_ID.test(event.targetId)
      || !SAFE_ID.test(event.deploymentId) || !SAFE_ID.test(event.databaseId)
      || !SAFE_ID.test(event.streamIncarnation) || !SAFE_ID.test(event.operationId)
      || (event.planId !== null && !DIGEST.test(event.planId))
      || (event.receiptId !== null && !DIGEST.test(event.receiptId))
      || !SAFE_ID.test(event.reasonCode) || event.retentionClass !== 'security'
      || !Number.isSafeInteger(event.recordedAtMs) || event.recordedAtMs < 0
      || !Array.isArray(event.payload) || event.payload.length > MAX_AUDIT_FIELDS) {
    throw fail('SNAPBACK_CONTROL_AUDIT_INVALID', 'control audit event identity, authority, or chain is invalid');
  }
  for (const field of event.payload) {
    assertClosed(field, LOG_FIELD_KEYS, 'control audit field', 'SNAPBACK_CONTROL_AUDIT_INVALID');
    if (!SAFE_ID.test(field.name) || FORBIDDEN_LOG_FIELD.test(field.name)) {
      throw fail('SNAPBACK_CONTROL_AUDIT_REDACTION_REQUIRED', 'control audit field name is forbidden', { name: field.name });
    }
    assertText(field.value, `audit.${field.name}`, 'SNAPBACK_CONTROL_AUDIT_INVALID');
    if (FORBIDDEN_LOG_VALUE.test(field.value)) {
      throw fail('SNAPBACK_CONTROL_AUDIT_REDACTION_REQUIRED', 'control audit field resembles credential material', { name: field.name });
    }
  }
  return event;
}

function readControlAuditChain(options = {}, allowAppendLock = false) {
  const events = [];
  let previousEventId = null;
  const observedEntries = readdirSync(roots(options).auditEvents, { withFileTypes: true });
  const entries = [];
  for (const entry of observedEntries) {
    if (allowAppendLock && entry.name === '.append.lock' && entry.isFile()) continue;
    if (!entry.isFile() || !/^\d{12}-[0-9a-f]{64}\.json$/.test(entry.name)) {
      throw fail('SNAPBACK_CONTROL_AUDIT_INVALID', 'control audit directory contains an unexpected entry', { name: entry.name });
    }
    entries.push(entry);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (let index = 0; index < entries.length; index += 1) {
    const event = readBoundedJson(join(roots(options).auditEvents, entries[index].name), 'SNAPBACK_CONTROL_AUDIT_INVALID');
    validateControlAuditEvent(event, index + 1, previousEventId);
    const expectedName = `${String(event.sequence).padStart(12, '0')}-${event.eventId.slice('sha256:'.length)}.json`;
    if (entries[index].name !== expectedName) {
      throw fail('SNAPBACK_CONTROL_AUDIT_INVALID', 'control audit filename does not match event identity');
    }
    events.push(event);
    previousEventId = event.eventId;
  }
  return events;
}

function appendControlAuditEvent(input, options = {}) {
  const auditRoot = roots(options).auditEvents;
  const lockPath = join(auditRoot, '.append.lock');
  let acquired = false;
  let cause = null;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { flag: 'wx', mode: 0o600 });
      acquired = true;
    } catch (error) {
      cause = error;
      if (error?.code !== 'EEXIST' || attempt > 0) break;
      let metadata;
      let ownerPid = null;
      try {
        metadata = lstatSync(lockPath);
        const value = readFileSync(lockPath, 'utf8').trim();
        if (/^[1-9]\d*$/.test(value)) {
          const parsed = Number(value);
          if (Number.isSafeInteger(parsed)) ownerPid = parsed;
        }
      } catch {
        continue;
      }
      let ownerAlive = false;
      if (Number.isSafeInteger(ownerPid)) {
        try {
          process.kill(ownerPid, 0);
          ownerAlive = true;
        } catch (livenessError) {
          ownerAlive = livenessError?.code === 'EPERM';
        }
      }
      const ageMs = Math.max(0, Date.now() - metadata.mtimeMs);
      if (ownerAlive && ageMs <= CONTROL_AUDIT_LOCK_MAX_AGE_MS) break;
      if (ownerPid === null && ageMs <= CONTROL_AUDIT_LOCK_MAX_AGE_MS) break;
      rmSync(lockPath, { force: true });
    }
  }
  if (!acquired) {
    const error = fail(
      'SNAPBACK_CONTROL_AUDIT_UNAVAILABLE',
      `mandatory control audit intake lock ${lockPath} is held or unavailable; privileged action refused`,
      { lockPath },
    );
    error.cause = cause;
    throw error;
  }
  try {
    const events = readControlAuditChain(options, true);
    const previousEventId = events.at(-1)?.eventId ?? null;
    const actorId = options.auditActorId
      ?? (SAFE_ID.test(process.env.USER ?? '') ? process.env.USER : 'local-operator');
    assertId(actorId, 'auditActorId', 'SNAPBACK_CONTROL_AUDIT_INVALID');
    const content = {
      schemaVersion: 'snapback.control-audit-event.v1',
      sequence: events.length + 1,
      eventType: input.eventType,
      eventVersion: 1,
      outcome: input.outcome,
      actorAuthority: 'localOperator',
      actorId,
      targetId: input.target.targetId,
      deploymentId: input.target.deploymentId,
      databaseId: input.target.databaseId,
      streamIncarnation: input.target.streamIncarnation,
      operationId: input.operationId,
      planId: input.planId ?? null,
      receiptId: input.receiptId ?? null,
      reasonCode: input.reasonCode,
      payload: input.payload ?? [],
      retentionClass: 'security',
      recordedAtMs: (options.auditClock ?? Date.now)(),
      previousEventId,
    };
    const eventId = sha256(Buffer.from(`snapback-control-audit-event-v1\0${canonicalJson(content)}`));
    const event = { ...content, eventId };
    validateControlAuditEvent(event, content.sequence, previousEventId);
    const path = join(auditRoot, `${String(content.sequence).padStart(12, '0')}-${eventId.slice('sha256:'.length)}.json`);
    writeOwnerOnly(path, event);
    return event;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

export function verifyControlAuditLedger(options = {}) {
  const events = readControlAuditChain(options);
  return {
    schemaVersion: 'snapback.control-audit-verification.v1',
    ok: true,
    events: events.length,
    headEventId: events.at(-1)?.eventId ?? null,
  };
}

function auditMutationBegin(eventType, target, plan, options, payload = []) {
  return appendControlAuditEvent({
    eventType,
    outcome: 'began',
    target,
    operationId: plan.operationId,
    planId: plan.planId,
    reasonCode: 'operatorRequested',
    payload,
  }, options);
}

function auditMutationSucceeded(eventType, target, plan, receipt, options) {
  return appendControlAuditEvent({
    eventType,
    outcome: 'succeeded',
    target,
    operationId: plan.operationId,
    planId: plan.planId,
    receiptId: receipt.receiptId,
    reasonCode: 'verified',
    payload: [],
  }, options);
}

function auditMutationFailed(eventType, target, plan, error, options, receiptId = null) {
  try {
    appendControlAuditEvent({
      eventType,
      outcome: 'failed',
      target,
      operationId: plan.operationId,
      planId: plan.planId,
      receiptId,
      reasonCode: SAFE_ID.test(error?.code ?? '') ? error.code : 'operationFailed',
      payload: [],
    }, options);
  } catch (auditError) {
    if (error?.diagnostic) {
      error.diagnostic.details = {
        ...(error.diagnostic.details ?? {}),
        auditFailureCode: auditError?.code ?? 'SNAPBACK_CONTROL_AUDIT_UNAVAILABLE',
      };
    }
  }
}

function targetPath(targetId, options = {}) {
  assertId(targetId, 'targetId');
  return join(roots(options).targets, `${targetId}.json`);
}

export function addTarget(descriptorOrPath, options = {}) {
  let descriptor = descriptorOrPath;
  if (typeof descriptorOrPath === 'string') {
    const path = resolve(descriptorOrPath);
    let metadata;
    try {
      metadata = lstatSync(path);
    } catch (cause) {
      const error = fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'target descriptor input does not exist', { path });
      error.cause = cause;
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_CONTROL_FILE_BYTES) {
      throw fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'target descriptor input must be a bounded regular file', { path });
    }
    try {
      descriptor = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      const error = fail('SNAPBACK_TARGET_DESCRIPTOR_INVALID', 'target descriptor input is not valid JSON', { path });
      error.cause = cause;
      throw error;
    }
  }
  validateTargetDescriptor(descriptor);
  const path = targetPath(descriptor.targetId, options);
  const expected = `${canonicalJson(descriptor)}\n`;
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== expected) {
      throw fail('SNAPBACK_TARGET_ALREADY_REGISTERED', 'targetId is already bound to a different immutable descriptor', { targetId: descriptor.targetId });
    }
    return { schemaVersion: 'snapback.target-add.v1', ok: true, state: 'reused', targetId: descriptor.targetId, descriptorSha256: sha256(Buffer.from(canonicalJson(descriptor))) };
  }
  try {
    const created = writeOwnerOnly(path, descriptor);
    if (!created) {
      return { schemaVersion: 'snapback.target-add.v1', ok: true, state: 'reused', targetId: descriptor.targetId, descriptorSha256: sha256(Buffer.from(canonicalJson(descriptor))) };
    }
  } catch (cause) {
    if (cause?.code === 'EEXIST' && existsSync(path)) {
      assertSecureFile(path);
      if (readFileSync(path, 'utf8') === expected) {
        return { schemaVersion: 'snapback.target-add.v1', ok: true, state: 'reused', targetId: descriptor.targetId, descriptorSha256: sha256(Buffer.from(canonicalJson(descriptor))) };
      }
    }
    throw cause;
  }
  return { schemaVersion: 'snapback.target-add.v1', ok: true, state: 'registered', targetId: descriptor.targetId, descriptorSha256: sha256(Buffer.from(canonicalJson(descriptor))) };
}

export function showTarget(targetId, options = {}) {
  const path = targetPath(targetId, options);
  if (!existsSync(path)) throw fail('SNAPBACK_TARGET_NOT_FOUND', 'target is not registered', { targetId });
  return validateTargetDescriptor(readBoundedJson(path, 'SNAPBACK_TARGET_DESCRIPTOR_INVALID'));
}

function adapterEnvironment(environment = process.env) {
  return Object.fromEntries(ADAPTER_ENV_KEYS.filter((key) => environment[key] !== undefined).map((key) => [key, environment[key]]));
}

function validateObservation(observation, target) {
  assertClosed(observation, OBSERVATION_KEYS, 'adapter observation', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  for (const name of ['targetId', 'environmentId', 'deploymentId', 'databaseId', 'streamIncarnation', 'targetProfileId', 'provider', 'accountFingerprint', 'region', 'resourceId']) {
    assertId(observation[name], `observation.${name}`, 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  }
  assertText(observation.publicOrigin, 'observation.publicOrigin', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  if (!ACTIVE_STATES.has(observation.state) || !CREDENTIAL_STATES.has(observation.credentialStatus)) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter returned an unsupported deployment or credential state');
  }
  if (!Number.isSafeInteger(observation.activationGeneration) || observation.activationGeneration < 0
      || !Number.isSafeInteger(observation.observedAtMs) || observation.observedAtMs < 0
      || !(observation.activeReleaseId === null || DIGEST.test(observation.activeReleaseId))
      || !(observation.applicationSentinelSha256 === null || DIGEST.test(observation.applicationSentinelSha256))
      || !DIGEST.test(observation.providerFactsSha256)
      || !Array.isArray(observation.capabilityGaps)
      || observation.capabilityGaps.some((gap) => typeof gap !== 'string' || !SAFE_ID.test(gap))
      || new Set(observation.capabilityGaps).size !== observation.capabilityGaps.length) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter observation has malformed generation, digest, release, or GAP facts');
  }
  const bindings = {
    targetId: target.targetId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    provider: target.adapter.provider,
    accountFingerprint: target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
  };
  const mismatches = Object.entries(bindings).filter(([name, expected]) => observation[name] !== expected).map(([name, expected]) => ({ name, expected, observed: observation[name] }));
  if (mismatches.length > 0) {
    throw fail('SNAPBACK_TARGET_IDENTITY_MISMATCH', 'provider read-back does not match the registered target identity', { mismatches });
  }
  return observation;
}

function invokeAdapter(operation, targetId, options = {}) {
  const target = showTarget(targetId, options);
  const operationId = options.operationId ?? randomUUID();
  assertId(operationId, 'operationId', 'SNAPBACK_ADAPTER_REQUEST_INVALID');
  const request = {
    schemaVersion: 'snapback.vm-adapter-request.v1',
    operation,
    operationId,
    target,
  };
  const child = spawnSync(target.adapter.driverPath, [], {
    input: `${canonicalJson(request)}\n`,
    encoding: 'utf8',
    env: adapterEnvironment(options.env),
    timeout: options.adapterTimeoutMs ?? 15_000,
    maxBuffer: MAX_ADAPTER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw fail('SNAPBACK_ADAPTER_EXEC_FAILED', 'adapter process did not complete successfully', {
      status: child.status,
      signal: child.signal,
      error: child.error?.code ?? null,
      stderrBytes: Buffer.byteLength(child.stderr ?? ''),
      stderrSha256: sha256(Buffer.from(child.stderr ?? '')),
    });
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter stdout was not one JSON response');
  }
  assertClosed(response, ['schemaVersion', 'operation', 'operationId', 'ok', 'observation', 'diagnostics'], 'adapter response', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  if (response.schemaVersion !== 'snapback.vm-adapter-response.v1' || response.operation !== operation || response.operationId !== operationId
      || typeof response.ok !== 'boolean' || !Array.isArray(response.diagnostics) || response.diagnostics.length > 64) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter response identity does not match the request');
  }
  for (const diagnostic of response.diagnostics) {
    assertClosed(diagnostic, ['code', 'severity', 'message'], 'adapter diagnostic', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertId(diagnostic.code, 'diagnostic.code', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertText(diagnostic.severity, 'diagnostic.severity', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertText(diagnostic.message, 'diagnostic.message', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  }
  if (!response.ok || !response.observation) {
    throw fail('SNAPBACK_ADAPTER_REJECTED', 'adapter refused the read-only operation', { diagnostics: response.diagnostics });
  }
  return { target, operationId, observation: validateObservation(response.observation, target), diagnostics: response.diagnostics };
}

export function inspectTarget(targetId, options = {}) {
  const result = invokeAdapter('inspect', targetId, options);
  return {
    schemaVersion: 'snapback.target-inspect.v1',
    ok: true,
    operationId: result.operationId,
    targetDescriptorSha256: sha256(Buffer.from(canonicalJson(result.target))),
    observation: result.observation,
    diagnostics: result.diagnostics,
  };
}

export function doctorTarget(targetId, options = {}) {
  const result = invokeAdapter('doctor', targetId, options);
  return {
    schemaVersion: 'snapback.target-doctor.v1',
    ok: result.observation.credentialStatus === 'ready' && !['restoring', 'retired'].includes(result.observation.state),
    operationId: result.operationId,
    targetId,
    state: result.observation.state,
    credentialStatus: result.observation.credentialStatus,
    activationGeneration: result.observation.activationGeneration,
    activeReleaseId: result.observation.activeReleaseId,
    capabilityGaps: result.observation.capabilityGaps,
    diagnostics: result.diagnostics,
  };
}

function normalizeAdapterQuery(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const query = {
    sinceMs: options.sinceMs ?? 0,
    untilMs: options.untilMs ?? nowMs,
    limit: options.limit ?? 100,
    cursor: options.cursor ?? null,
  };
  if (!Number.isSafeInteger(query.sinceMs) || query.sinceMs < 0
      || !Number.isSafeInteger(query.untilMs) || query.untilMs < query.sinceMs
      || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_LOG_LIMIT
      || !(query.cursor === null || (typeof query.cursor === 'string' && query.cursor.length > 0 && query.cursor.length <= 512 && !/[\0\r\n]/.test(query.cursor)))) {
    throw fail('SNAPBACK_ADAPTER_QUERY_INVALID', 'adapter query requires a bounded time range, limit, and optional opaque cursor');
  }
  return query;
}

function validateControlLogs(logs, target, observation, query) {
  assertClosed(logs, LOG_PAGE_KEYS, 'adapter log page', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
  if (!Array.isArray(logs.entries) || logs.entries.length > query.limit
      || !(logs.nextCursor === null || (typeof logs.nextCursor === 'string' && logs.nextCursor.length > 0 && logs.nextCursor.length <= 512 && !/[\0\r\n]/.test(logs.nextCursor)))
      || !Number.isSafeInteger(logs.deliveryLatencyMs) || logs.deliveryLatencyMs < 0
      || !Number.isSafeInteger(logs.droppedEvents) || logs.droppedEvents < 0
      || typeof logs.backpressure !== 'boolean') {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'adapter log page exceeds its closed bounds');
  }
  assertText(logs.retentionClass, 'logs.retentionClass', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
  assertText(logs.indexingClass, 'logs.indexingClass', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
  for (const entry of logs.entries) {
    assertClosed(entry, LOG_ENTRY_KEYS, 'adapter log entry', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    if (!Number.isSafeInteger(entry.timestampMs) || entry.timestampMs < query.sinceMs || entry.timestampMs > query.untilMs
        || !['debug', 'info', 'warning', 'error', 'critical'].includes(entry.severity)
        || entry.deploymentId !== target.deploymentId
        || !(entry.releaseId === null || DIGEST.test(entry.releaseId))
        || !Number.isSafeInteger(entry.activationGeneration) || entry.activationGeneration < 0
        || entry.streamIncarnation !== target.streamIncarnation
        || typeof entry.correlationId !== 'string' || !SAFE_ID.test(entry.correlationId)
        || typeof entry.eventCode !== 'string' || !SAFE_ID.test(entry.eventCode)
        || !Number.isSafeInteger(entry.eventVersion) || entry.eventVersion < 1
        || !Array.isArray(entry.payload) || entry.payload.length > MAX_LOG_FIELDS) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'adapter log entry has an invalid identity, timestamp, or bound');
    }
    const names = new Set();
    for (const field of entry.payload) {
      assertClosed(field, LOG_FIELD_KEYS, 'adapter log field', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
      if (typeof field.name !== 'string' || !SAFE_ID.test(field.name) || names.has(field.name)
          || FORBIDDEN_LOG_FIELD.test(field.name)
          || typeof field.value !== 'string' || field.value.length > 512 || /[\0\r\n]/.test(field.value)
          || FORBIDDEN_LOG_VALUE.test(field.value)) {
        throw fail('SNAPBACK_ADAPTER_LOG_REDACTION_INVALID', 'adapter log payload contains a duplicate, private, credential-like, or unbounded field');
      }
      names.add(field.name);
    }
  }
  if (observation.state === 'active' && (logs.droppedEvents > 0 || logs.backpressure)) {
    throw fail('SNAPBACK_ADAPTER_LOG_HEALTH_DEGRADED', 'active target reports dropped or backpressured control logs', {
      droppedEvents: logs.droppedEvents,
      backpressure: logs.backpressure,
    });
  }
  return logs;
}

function validateInspectionFacts(facts, name) {
  if (!Array.isArray(facts) || facts.length > MAX_INSPECTION_FACTS) {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', `${name} inspection facts exceed their bound`);
  }
  const names = new Set();
  for (const fact of facts) {
    assertClosed(fact, INSPECTION_FACT_KEYS, `${name} inspection fact`, 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    if (typeof fact.name !== 'string' || !SAFE_ID.test(fact.name) || names.has(fact.name)
        || typeof fact.status !== 'string' || fact.status.length === 0 || fact.status.length > 128 || /[\0\r\n]/.test(fact.status)
        || !DIGEST.test(fact.valueSha256)) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', `${name} inspection fact is malformed or duplicated`);
    }
    names.add(fact.name);
  }
  return facts;
}

function validateAuthenticatedInspection(inspection, target, observation) {
  assertClosed(inspection, INSPECTION_KEYS, 'authenticated inspection', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
  if (inspection.targetId !== target.targetId || inspection.deploymentId !== target.deploymentId
      || inspection.databaseId !== target.databaseId || inspection.streamIncarnation !== target.streamIncarnation
      || inspection.activeReleaseId !== observation.activeReleaseId
      || !Array.isArray(inspection.inactiveReleaseIds)
      || inspection.inactiveReleaseIds.some((releaseId) => !DIGEST.test(releaseId))
      || new Set(inspection.inactiveReleaseIds).size !== inspection.inactiveReleaseIds.length
      || inspection.activationGeneration !== observation.activationGeneration
      || !DIGEST.test(inspection.capabilityManifestSha256)
      || !Array.isArray(inspection.capabilityGaps)
      || inspection.capabilityGaps.some((gap) => typeof gap !== 'string' || !SAFE_ID.test(gap))
      || new Set(inspection.capabilityGaps).size !== inspection.capabilityGaps.length) {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'authenticated inspection does not match the target observation');
  }
  for (const generation of ['schemaGeneration', 'configGeneration', 'authGeneration', 'workerGeneration']) {
    if (!Number.isSafeInteger(inspection[generation]) || inspection[generation] < 0) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'authenticated inspection generations must be non-negative safe integers', { generation });
    }
  }
  for (const lane of ['health', 'dependencies', 'migration', 'backups', 'queues', 'connections', 'resources']) {
    validateInspectionFacts(inspection[lane], lane);
  }
  if (!Array.isArray(inspection.operations) || inspection.operations.length > MAX_INSPECTION_FACTS) {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'authenticated inspection operation history exceeds its bound');
  }
  for (const operation of inspection.operations) {
    assertClosed(operation, OPERATION_SUMMARY_KEYS, 'inspection operation summary', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    assertId(operation.operationId, 'inspection.operationId', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    assertId(operation.kind, 'inspection.kind', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    assertId(operation.outcome, 'inspection.outcome', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
    if (!Number.isSafeInteger(operation.finishedAtMs) || operation.finishedAtMs < 0 || !DIGEST.test(operation.receiptId)) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'inspection operation summary is malformed');
    }
  }
  validateAdapterDiagnostics(inspection.diagnostics);
  return inspection;
}

function invokeQueryAdapterCore(operation, targetId, options = {}) {
  const target = showTarget(targetId, options);
  const operationId = options.operationId ?? randomUUID();
  assertId(operationId, 'operationId', 'SNAPBACK_ADAPTER_QUERY_INVALID');
  const query = normalizeAdapterQuery(options);
  const request = {
    schemaVersion: 'snapback.vm-adapter-query-request.v1',
    operation,
    operationId,
    target,
    query,
  };
  const inputSha256 = sha256(Buffer.from(`snapback-vm-adapter-query-input-v1\0${canonicalJson(request)}`));
  const child = spawnSync(target.adapter.driverPath, [], {
    input: `${canonicalJson(request)}\n`,
    encoding: 'utf8',
    env: adapterEnvironment(options.env),
    timeout: options.adapterTimeoutMs ?? 15_000,
    maxBuffer: MAX_ADAPTER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw fail('SNAPBACK_ADAPTER_QUERY_EXEC_FAILED', 'adapter query process did not complete successfully', {
      operation,
      status: child.status,
      signal: child.signal,
      error: child.error?.code ?? null,
      stderrBytes: Buffer.byteLength(child.stderr ?? ''),
      stderrSha256: sha256(Buffer.from(child.stderr ?? '')),
    });
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'adapter query stdout was not one JSON response', { operation });
  }
  assertClosed(response, QUERY_RESPONSE_KEYS, 'adapter query response', 'SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID');
  const { outputSha256, ...outputContent } = response;
  const derivedOutputSha256 = sha256(Buffer.from(`snapback-vm-adapter-query-output-v1\0${canonicalJson(outputContent)}`));
  if (response.schemaVersion !== 'snapback.vm-adapter-query-response.v1'
      || response.operation !== operation || response.operationId !== operationId
      || typeof response.ok !== 'boolean' || typeof response.remoteEvidence !== 'boolean'
      || response.inputSha256 !== inputSha256 || outputSha256 !== derivedOutputSha256
      || !DIGEST.test(outputSha256)) {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'adapter query response identity or digest does not match the request');
  }
  validateAdapterDiagnostics(response.diagnostics);
  validateEvidence(response.evidence);
  if (!response.ok || !response.observation) {
    throw fail('SNAPBACK_ADAPTER_QUERY_REJECTED', 'adapter refused the authenticated query', { operation, diagnostics: response.diagnostics });
  }
  const observation = validateObservation(response.observation, target);
  if (response.remoteEvidence && !response.evidence.some((item) => item.kind === 'remoteProviderAttestation')) {
    throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'remote query evidence requires a verified provider attestation');
  }
  if (options.requireRemoteEvidence !== false && !response.remoteEvidence) {
    throw fail('SNAPBACK_ADAPTER_REMOTE_EVIDENCE_REQUIRED', 'production logs and inspection require remote provider evidence', { operation });
  }
  if (operation === 'logs') {
    if (response.inspection !== null || response.logs === null) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'logs response must contain only a log page');
    }
    validateControlLogs(response.logs, target, observation, query);
  } else if (operation === 'inspectAdmin') {
    if (response.logs !== null || response.inspection === null) {
      throw fail('SNAPBACK_ADAPTER_QUERY_RESPONSE_INVALID', 'admin inspection response must contain only inspection facts');
    }
    validateAuthenticatedInspection(response.inspection, target, observation);
  } else {
    throw fail('SNAPBACK_ADAPTER_QUERY_INVALID', 'adapter query operation is unsupported', { operation });
  }
  appendControlAuditEvent({
    eventType: operation === 'logs' ? 'controlLogsRead' : 'adminInspect',
    outcome: 'read',
    target,
    operationId,
    reasonCode: 'authorizedRead',
    payload: operation === 'logs'
      ? [{ name: 'entryCount', value: String(response.logs.entries.length) }]
      : [{ name: 'operationCount', value: String(response.inspection.operations.length) }],
  }, options);
  return {
    schemaVersion: operation === 'logs' ? 'snapback.control-logs.v1' : 'snapback.authenticated-inspection.v1',
    ok: true,
    operationId,
    remoteEvidence: response.remoteEvidence,
    targetDescriptorSha256: sha256(Buffer.from(canonicalJson(target))),
    targetObservationSha256: sha256(Buffer.from(canonicalJson(observation))),
    observation,
    evidence: response.evidence,
    ...(operation === 'logs' ? { logs: response.logs } : { inspection: response.inspection }),
  };
}

export function queryControlLogs(targetId, options = {}) {
  return invokeQueryAdapterCore('logs', targetId, { ...options, requireRemoteEvidence: true });
}

export function inspectTargetAdmin(targetId, options = {}) {
  return invokeQueryAdapterCore('inspectAdmin', targetId, { ...options, requireRemoteEvidence: true });
}

function addBlocker(blockers, id, reason) {
  if (!blockers.some((blocker) => blocker.id === id)) blockers.push({ id, reason, blocking: true });
}

function readExternalArtifact(path, code) {
  const absolute = resolve(path);
  const bytes = readFileDescriptorSafe(absolute, code);
  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes, path: absolute };
  } catch (cause) {
    const error = fail(code, 'artifact is not valid JSON', { path: absolute });
    error.cause = cause;
    throw error;
  }
}

function validateGapArray(gaps, code) {
  if (!Array.isArray(gaps)) throw fail(code, 'artifact GAPs must be an array');
  const seen = new Set();
  for (const gap of gaps) {
    assertClosed(gap, ['id', 'reason', 'blocking'], 'artifact GAP', code);
    if (typeof gap.id !== 'string' || !SAFE_ID.test(gap.id) || seen.has(gap.id)
        || typeof gap.reason !== 'string' || gap.reason.length === 0 || gap.blocking !== true) {
      throw fail(code, 'artifact GAP is malformed, duplicated, or non-blocking');
    }
    seen.add(gap.id);
  }
  return gaps;
}

function validateHostedAuthDrill(drill, target, qualifiedAtMs) {
  const code = 'SNAPBACK_HOSTED_AUTH_DRILL_INVALID';
  assertClosed(drill, HOSTED_AUTH_DRILL_KEYS, 'hosted auth drill receipt', code);
  const { receiptId, ...receiptContent } = drill;
  const derivedReceiptId = sha256(Buffer.from(`snapback-hosted-auth-drill-receipt-v1\0${canonicalJson(receiptContent)}`));
  if (drill.schemaVersion !== 'snapback.hosted-auth-drill-receipt.v1'
      || receiptId !== derivedReceiptId
      || drill.targetId !== target.targetId
      || drill.targetProfileId !== target.targetProfileId
      || drill.deploymentId !== target.deploymentId
      || drill.provider !== target.adapter.provider
      || drill.accountFingerprint !== target.adapter.accountFingerprint
      || drill.region !== target.adapter.region
      || drill.publicOrigin !== target.adapter.publicOrigin
      || !DIGEST.test(drill.browserArtifactSha256)
      || !Number.isSafeInteger(drill.startedAtMs) || drill.startedAtMs < 0
      || !Number.isSafeInteger(drill.finishedAtMs) || drill.finishedAtMs < drill.startedAtMs
      || drill.finishedAtMs > qualifiedAtMs) {
    throw fail(code, 'hosted auth drill identity, content address, or time range is invalid');
  }
  const admission = validateHostedAdmissionShape(drill.admission, code);
  const supportContent = {
    hostedAuth: admission.hostedAuth,
    authenticationThrottleConfig: admission.authenticationThrottleConfig,
    operatorSurface: admission.operatorSurface,
    browserDirectBearerSeam: admission.browserDirectBearerSeam,
    browserArtifactSha256: drill.browserArtifactSha256,
  };
  const supportSha256 = sha256(Buffer.from(`snapback-hosted-auth-support-v1\0${canonicalJson(supportContent)}`)).slice('sha256:'.length);
  const numericFacts = [
    admission.admissionEpoch,
    admission.senderReplayEpochFloor,
    admission.issuedAtMs,
    admission.expiresAtMs,
    admission.limiterEpoch,
    admission.invalidationEpoch,
  ];
  if (admission.version !== 1 || admission.deploymentId !== target.deploymentId
      || !/^[0-9a-f]{64}$/.test(admission.configurationSha256)
      || admission.supportSha256 !== supportSha256
      || numericFacts.some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_INTEGER)
      || admission.admissionEpoch < 1 || admission.senderReplayEpochFloor < 1
      || admission.limiterEpoch < 1 || admission.invalidationEpoch < 1
      || admission.issuedAtMs > admission.expiresAtMs
      || admission.expiresAtMs - admission.issuedAtMs > 5 * 60 * 1_000
      || drill.startedAtMs < admission.issuedAtMs || drill.finishedAtMs > admission.expiresAtMs
      || admission.handlerProtocolVersion !== 1
      || !SAFE_ID.test(admission.handlerIncarnation)
      || admission.operatorSurface !== 'disabled'
      || admission.browserDirectBearerSeam !== 'excluded'
      || admission.hostedAuth.externalTls !== 'enforced'
      || admission.hostedAuth.effectiveSource !== 'trusted'
      || admission.hostedAuth.authenticationThrottle !== 'sharedEnforced'
      || admission.hostedAuth.sessionInvalidation !== 'globallyFenced'
      || admission.hostedAuth.clientCredentialPosture !== 'senderConstrainedV2') {
    throw fail(code, 'hosted admission does not prove every static and deployment-bound gate');
  }
  assertClosed(drill.liveHealth, HOSTED_AUTH_HEALTH_KEYS, 'hosted auth live health', code);
  if (drill.liveHealth.admissionEpoch !== admission.admissionEpoch
      || drill.liveHealth.senderReplayEpochFloor !== admission.senderReplayEpochFloor
      || drill.liveHealth.senderReplayEpochFloorCurrent !== true
      || drill.liveHealth.limiterReachable !== true
      || drill.liveHealth.invalidationCurrent !== true
      || drill.liveHealth.serializedAuthorityCurrent !== true
      || drill.liveHealth.handlerCompatible !== true
      || drill.liveHealth.servingAdmitted !== true
      || !Number.isSafeInteger(drill.liveHealth.observedAtMs)
      || drill.liveHealth.observedAtMs < drill.startedAtMs
      || drill.liveHealth.observedAtMs > drill.finishedAtMs) {
    throw fail(code, 'hosted auth live health is stale, incomplete, or bound to another admission epoch');
  }
  validateGapArray(drill.gaps, code);
  validateEvidence(drill.evidence);
  if (drill.gaps.length > 0
      || !drill.evidence.some((item) => item.kind === 'remoteProviderAttestation')) {
    throw fail('SNAPBACK_HOSTED_AUTH_DRILL_INCOMPLETE', 'hosted auth drill retains GAPs or lacks remote provider evidence');
  }
  return drill;
}

function exactEvidenceMap(value, kinds, options = {}) {
  const code = options.code ?? 'SNAPBACK_ADAPTER_QUALIFICATION_INVALID';
  const name = options.name ?? 'evidence map';
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(code, `${name} must be an object keyed by the complete required kind set`);
  }
  const expected = [...kinds].sort();
  const observed = Object.keys(value).sort();
  if (observed.length !== expected.length
      || observed.some((kind, index) => kind !== expected[index])) {
    throw fail(code, `${name} must name every required kind exactly once`, {
      expected,
      observed,
    });
  }
  return kinds.map((kind) => {
    const evidence = canonicalValue(value[kind]);
    validateEvidence(evidence);
    if (evidence.length === 0
        || (options.requireRemote === true
          && !evidence.some((item) => item.kind === 'remoteProviderAttestation'))) {
      throw fail(
        options.incompleteCode ?? code,
        `${name} entry is empty or lacks required remote provider evidence`,
        { kind },
      );
    }
    return options.entryKey === 'claim'
      ? { claim: kind, evidence }
      : { kind, evidence };
  });
}

// @ref LLP 0072#implemented-target-and-plan-slice — positive hosted
// qualification is minted from closed, content-addressed drill facts rather
// than an activation boolean supplied by a deploy caller.
export function createHostedAuthDrillReceipt(options = {}) {
  const target = showTarget(options.targetId, options);
  if (target.targetProfileId !== 'trusted-single-tenant-app-complete.v1') {
    throw fail(
      'SNAPBACK_HOSTED_AUTH_DRILL_PROFILE_INVALID',
      'hosted auth drill production requires the exact trusted-single-tenant-app-complete.v1 target profile',
    );
  }
  const content = {
    schemaVersion: 'snapback.hosted-auth-drill-receipt.v1',
    targetId: target.targetId,
    targetProfileId: target.targetProfileId,
    deploymentId: target.deploymentId,
    provider: target.adapter.provider,
    accountFingerprint: target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
    browserArtifactSha256: options.browserArtifactSha256,
    admission: canonicalValue(options.admission),
    liveHealth: canonicalValue(options.liveHealth),
    evidence: canonicalValue(options.evidence),
    gaps: [],
    startedAtMs: options.startedAtMs,
    finishedAtMs: options.finishedAtMs,
  };
  const receiptId = sha256(Buffer.from(
    `snapback-hosted-auth-drill-receipt-v1\0${canonicalJson(content)}`,
  ));
  const receipt = { ...content, receiptId };
  validateHostedAuthDrill(receipt, target, options.finishedAtMs);
  return receipt;
}

export function createAdapterQualificationManifest(options = {}) {
  const target = showTarget(options.targetId, options);
  if (target.targetProfileId !== 'trusted-single-tenant-app-complete.v1') {
    throw fail(
      'SNAPBACK_ADAPTER_QUALIFICATION_PROFILE_INVALID',
      'adapter qualification production requires the exact trusted-single-tenant-app-complete.v1 target profile',
    );
  }
  if (!Number.isSafeInteger(options.qualifiedAtMs) || options.qualifiedAtMs < 0) {
    throw fail(
      'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
      'adapter qualification time must be a non-negative safe integer',
    );
  }
  const hostedAuthDrill = canonicalValue(options.hostedAuthDrill);
  validateHostedAuthDrill(hostedAuthDrill, target, options.qualifiedAtMs);
  const claims = exactEvidenceMap(options.claimEvidence, QUALIFICATION_CLAIMS, {
    code: 'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
    incompleteCode: 'SNAPBACK_ADAPTER_QUALIFICATION_INCOMPLETE',
    name: 'adapter qualification claim evidence',
    requireRemote: true,
    entryKey: 'claim',
  });
  const content = {
    schemaVersion: 'snapback.adapter-qualification.v1',
    targetId: target.targetId,
    targetProfileId: target.targetProfileId,
    adapterKind: target.adapter.kind,
    adapterVersion: target.adapter.version,
    driverSha256: target.adapter.driverSha256,
    provider: target.adapter.provider,
    accountFingerprint: target.adapter.accountFingerprint,
    region: target.adapter.region,
    publicOrigin: target.adapter.publicOrigin,
    remoteEvidence: true,
    hostedAuthDrill,
    claims,
    gaps: [],
    qualifiedAtMs: options.qualifiedAtMs,
  };
  return {
    ...content,
    qualificationId: sha256(Buffer.from(
      `snapback-adapter-qualification-v1\0${canonicalJson(content)}`,
    )),
  };
}

function validateAdapterQualificationArtifact(qualificationArtifact, target) {
  const qualification = qualificationArtifact.value;
  assertClosed(
    qualification,
    QUALIFICATION_KEYS,
    'adapter qualification',
    'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
  );
  const { qualificationId, ...qualificationContent } = qualification;
  const derivedQualificationId = sha256(Buffer.from(
    `snapback-adapter-qualification-v1\0${canonicalJson(qualificationContent)}`,
  ));
  if (qualification.schemaVersion !== 'snapback.adapter-qualification.v1'
      || qualificationId !== derivedQualificationId
      || qualification.targetId !== target.targetId
      || qualification.targetProfileId !== target.targetProfileId
      || qualification.adapterKind !== target.adapter.kind
      || qualification.adapterVersion !== target.adapter.version
      || qualification.driverSha256 !== target.adapter.driverSha256
      || qualification.provider !== target.adapter.provider
      || qualification.accountFingerprint !== target.adapter.accountFingerprint
      || qualification.region !== target.adapter.region
      || qualification.publicOrigin !== target.adapter.publicOrigin
      || qualification.remoteEvidence !== true
      || !Number.isSafeInteger(qualification.qualifiedAtMs)
      || qualification.qualifiedAtMs < 0) {
    throw fail(
      'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
      'adapter qualification identity is malformed or does not match the registered target',
    );
  }
  validateGapArray(qualification.gaps, 'SNAPBACK_ADAPTER_QUALIFICATION_INVALID');
  validateHostedAuthDrill(qualification.hostedAuthDrill, target, qualification.qualifiedAtMs);
  if (qualification.gaps.length > 0
      || !Array.isArray(qualification.claims)
      || qualification.claims.length !== QUALIFICATION_CLAIMS.length) {
    throw fail(
      'SNAPBACK_ADAPTER_QUALIFICATION_INCOMPLETE',
      'adapter qualification retains GAPs or misses required remote claims',
    );
  }
  const observedClaims = new Set();
  for (const claim of qualification.claims) {
    assertClosed(
      claim,
      ['claim', 'evidence'],
      'adapter qualification claim',
      'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
    );
    if (!QUALIFICATION_CLAIMS.includes(claim.claim) || observedClaims.has(claim.claim)) {
      throw fail(
        'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
        'adapter qualification claim is unknown or duplicated',
        { claim: claim.claim },
      );
    }
    validateEvidence(claim.evidence);
    if (claim.evidence.length === 0
        || !claim.evidence.some((item) => item.kind === 'remoteProviderAttestation')) {
      throw fail(
        'SNAPBACK_ADAPTER_QUALIFICATION_INCOMPLETE',
        'every qualification claim requires a remote provider attestation',
        { claim: claim.claim },
      );
    }
    observedClaims.add(claim.claim);
  }
  return {
    qualification,
    qualificationId,
    qualificationManifestSha256: sha256(qualificationArtifact.bytes),
  };
}

export function createPreparedReleaseManifest(options = {}) {
  if (typeof options.verifyRelease !== 'function' || !options.releaseDirectory
      || !options.qualificationPath) {
    throw fail(
      'SNAPBACK_PREPARED_RELEASE_INVALID',
      'prepared release production requires a base release, qualification artifact, and verifier',
    );
  }
  const target = showTarget(options.targetId, options);
  if (target.targetProfileId !== 'trusted-single-tenant-app-complete.v1') {
    throw fail(
      'SNAPBACK_PREPARED_RELEASE_PROFILE_INVALID',
      'prepared production release requires the exact trusted-single-tenant-app-complete.v1 target profile',
    );
  }
  const qualificationArtifact = readExternalArtifact(
    options.qualificationPath,
    'SNAPBACK_ADAPTER_QUALIFICATION_INVALID',
  );
  const { qualification, qualificationManifestSha256 } =
    validateAdapterQualificationArtifact(qualificationArtifact, target);

  const baseVerification = options.verifyRelease(options.releaseDirectory);
  const baseManifest = JSON.parse(readFileSync(
    join(resolve(options.releaseDirectory), 'release.manifest.json'),
    'utf8',
  ));
  if (baseManifest.projectId !== target.projectId
      || baseManifest.targetProfileId !== target.targetProfileId
      || baseVerification.releaseId !== baseManifest.releaseId) {
    throw fail(
      'SNAPBACK_PREPARED_RELEASE_INVALID',
      'base release identity or target profile does not match the registered target',
    );
  }
  const compatibility = canonicalValue(options.compatibility);
  assertClosed(
    compatibility,
    COMPATIBILITY_ENVELOPE_KEYS,
    'release compatibility envelope',
    'SNAPBACK_PREPARED_RELEASE_INVALID',
  );
  for (const field of [
    'minimumReadableSchemaGeneration',
    'maximumReadableSchemaGeneration',
    'writeSchemaGeneration',
    'minimumRetainedClientGeneration',
    'minimumJobGeneration',
    'minimumConfigGeneration',
  ]) {
    if (!Number.isSafeInteger(compatibility[field]) || compatibility[field] < 0) {
      throw fail(
        'SNAPBACK_PREPARED_RELEASE_INVALID',
        'compatibility generations must be non-negative safe integers',
        { field },
      );
    }
  }
  if (compatibility.minimumReadableSchemaGeneration > compatibility.writeSchemaGeneration
      || compatibility.maximumReadableSchemaGeneration < compatibility.writeSchemaGeneration
      || !DIGEST.test(compatibility.migrationSha256)
      || typeof compatibility.migrationTransactional !== 'boolean'
      || !(compatibility.irreversibleBoundary === null
        || typeof compatibility.irreversibleBoundary === 'string')
      || !['codeOnly', 'forwardFix', 'restoreRequired'].includes(compatibility.rollbackMode)) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'compatibility or rollback envelope is unsafe');
  }
  const evidence = exactEvidenceMap(options.releaseEvidence, PREPARED_EVIDENCE_KINDS, {
    code: 'SNAPBACK_PREPARED_RELEASE_INVALID',
    incompleteCode: 'SNAPBACK_PREPARED_RELEASE_INCOMPLETE',
    name: 'prepared release evidence',
  });
  if (!Number.isSafeInteger(options.preparedAtMs)
      || options.preparedAtMs < qualification.qualifiedAtMs) {
    throw fail(
      'SNAPBACK_PREPARED_RELEASE_INVALID',
      'prepared release time must follow qualification',
    );
  }
  const content = {
    schemaVersion: 'snapback.prepared-release.v1',
    baseReleaseId: baseVerification.releaseId,
    baseReleaseManifestSha256: baseVerification.manifestSha256,
    projectId: target.projectId,
    targetId: target.targetId,
    targetProfileId: target.targetProfileId,
    adapterQualificationId: qualification.qualificationId,
    adapterQualificationSha256: qualificationManifestSha256,
    compatibility,
    evidence,
    gaps: [],
    activationEligible: true,
    preparedAtMs: options.preparedAtMs,
  };
  return {
    ...content,
    preparedReleaseId: sha256(Buffer.from(
      `snapback-prepared-release-v1\0${canonicalJson(content)}`,
    )),
  };
}

export function verifyPreparedReleaseArtifacts(options = {}) {
  if (typeof options.verifyRelease !== 'function' || !options.releaseDirectory
      || !options.qualificationPath || !options.preparedReleasePath) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'prepared release verification requires base release, qualification, prepared artifact, and verifier');
  }
  const target = showTarget(options.targetId, options);
  if (target.targetProfileId !== 'trusted-single-tenant-app-complete.v1') {
    throw fail('SNAPBACK_PREPARED_RELEASE_PROFILE_INVALID', 'prepared production release requires the exact trusted-single-tenant-app-complete.v1 target profile');
  }
  const qualificationArtifact = readExternalArtifact(options.qualificationPath, 'SNAPBACK_ADAPTER_QUALIFICATION_INVALID');
  const {
    qualification,
    qualificationId,
    qualificationManifestSha256,
  } = validateAdapterQualificationArtifact(qualificationArtifact, target);
  const preparedArtifact = readExternalArtifact(options.preparedReleasePath, 'SNAPBACK_PREPARED_RELEASE_INVALID');
  const prepared = preparedArtifact.value;
  assertClosed(prepared, PREPARED_RELEASE_KEYS, 'prepared release', 'SNAPBACK_PREPARED_RELEASE_INVALID');
  const { preparedReleaseId, ...preparedContent } = prepared;
  const derivedPreparedReleaseId = sha256(Buffer.from(`snapback-prepared-release-v1\0${canonicalJson(preparedContent)}`));
  const baseVerification = options.verifyRelease(options.releaseDirectory);
  const baseManifest = JSON.parse(readFileSync(join(resolve(options.releaseDirectory), 'release.manifest.json'), 'utf8'));
  if (prepared.schemaVersion !== 'snapback.prepared-release.v1'
      || preparedReleaseId !== derivedPreparedReleaseId
      || prepared.baseReleaseId !== baseVerification.releaseId
      || prepared.baseReleaseManifestSha256 !== baseVerification.manifestSha256
      || prepared.projectId !== baseManifest.projectId || prepared.projectId !== target.projectId
      || prepared.targetId !== target.targetId || prepared.targetProfileId !== target.targetProfileId
      || baseManifest.targetProfileId !== target.targetProfileId
      || prepared.adapterQualificationId !== qualification.qualificationId
      || prepared.adapterQualificationSha256 !== qualificationManifestSha256
      || prepared.activationEligible !== true
      || !Number.isSafeInteger(prepared.preparedAtMs) || prepared.preparedAtMs < qualification.qualifiedAtMs) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'prepared release identity, base release, profile, or qualification binding is invalid');
  }
  validateGapArray(prepared.gaps, 'SNAPBACK_PREPARED_RELEASE_INVALID');
  if (prepared.gaps.length > 0 || !Array.isArray(prepared.evidence)
      || prepared.evidence.length !== PREPARED_EVIDENCE_KINDS.length) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INCOMPLETE', 'prepared release retains GAPs or misses required release evidence');
  }
  const observedEvidenceKinds = new Set();
  for (const entry of prepared.evidence) {
    assertClosed(entry, ['kind', 'evidence'], 'prepared release evidence', 'SNAPBACK_PREPARED_RELEASE_INVALID');
    if (!PREPARED_EVIDENCE_KINDS.includes(entry.kind) || observedEvidenceKinds.has(entry.kind)) {
      throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'prepared release evidence kind is unknown or duplicated', { kind: entry.kind });
    }
    validateEvidence(entry.evidence);
    if (entry.evidence.length === 0) throw fail('SNAPBACK_PREPARED_RELEASE_INCOMPLETE', 'prepared release evidence entry is empty', { kind: entry.kind });
    observedEvidenceKinds.add(entry.kind);
  }
  assertClosed(prepared.compatibility, COMPATIBILITY_ENVELOPE_KEYS, 'release compatibility envelope', 'SNAPBACK_PREPARED_RELEASE_INVALID');
  const compatibility = prepared.compatibility;
  for (const field of ['minimumReadableSchemaGeneration', 'maximumReadableSchemaGeneration', 'writeSchemaGeneration', 'minimumRetainedClientGeneration', 'minimumJobGeneration', 'minimumConfigGeneration']) {
    if (!Number.isSafeInteger(compatibility[field]) || compatibility[field] < 0) {
      throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'compatibility generations must be non-negative safe integers', { field });
    }
  }
  if (compatibility.minimumReadableSchemaGeneration > compatibility.writeSchemaGeneration
      || compatibility.maximumReadableSchemaGeneration < compatibility.writeSchemaGeneration
      || !DIGEST.test(compatibility.migrationSha256)
      || typeof compatibility.migrationTransactional !== 'boolean'
      || !(compatibility.irreversibleBoundary === null || typeof compatibility.irreversibleBoundary === 'string')
      || !['codeOnly', 'forwardFix', 'restoreRequired'].includes(compatibility.rollbackMode)) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'compatibility or rollback envelope is unsafe');
  }
  return {
    schemaVersion: 'snapback.prepared-release-verification.v1',
    ok: true,
    preparedReleaseId,
    preparedReleaseManifestSha256: sha256(preparedArtifact.bytes),
    qualificationId,
    qualificationManifestSha256,
    baseReleaseId: baseVerification.releaseId,
    baseReleaseManifestSha256: baseVerification.manifestSha256,
    compatibility: { ...compatibility },
    activationEligible: true,
  };
}

export function createDeployPlan(options = {}) {
  if (typeof options.verifyRelease !== 'function') throw fail('SNAPBACK_DEPLOY_PLAN_INVALID', 'release verifier was not supplied');
  assertText(options.reason, 'reason', 'SNAPBACK_DEPLOY_PLAN_INVALID');
  const inspection = invokeAdapter('inspect', options.targetId, options);
  const verification = options.verifyRelease(options.releaseDirectory);
  const manifestPath = join(resolve(options.releaseDirectory), 'release.manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const target = inspection.target;
  const observation = inspection.observation;
  const preparedRequested = options.preparedReleasePath !== undefined || options.qualificationPath !== undefined;
  if (preparedRequested && (!options.preparedReleasePath || !options.qualificationPath)) {
    throw fail('SNAPBACK_PREPARED_RELEASE_INVALID', 'planning requires both prepared release and adapter qualification artifacts');
  }
  const preparedVerification = preparedRequested
    ? verifyPreparedReleaseArtifacts({ ...options, targetId: target.targetId })
    : null;
  if (manifest.projectId !== target.projectId || manifest.targetProfileId !== target.targetProfileId) {
    throw fail('SNAPBACK_DEPLOY_IDENTITY_MISMATCH', 'release project/profile identity does not match the registered target', {
      releaseProjectId: manifest.projectId,
      targetProjectId: target.projectId,
      releaseTargetProfileId: manifest.targetProfileId,
      targetProfileId: target.targetProfileId,
    });
  }
  const blockers = preparedVerification === null ? manifest.gaps.map((gap) => ({ ...gap })) : [];
  for (const gap of observation.capabilityGaps) addBlocker(blockers, `adapter.${gap}`, `provider read-back reports the adapter capability GAP ${gap}`);
  if (observation.credentialStatus !== 'ready') addBlocker(blockers, 'adapter.credentials', `adapter credential status is ${observation.credentialStatus}`);
  if (['restoring', 'retired'].includes(observation.state)) addBlocker(blockers, 'target.lifecycle-state', `target state ${observation.state} cannot be planned for activation`);
  if (manifest.source.dirty && target.productionClass === 'production') addBlocker(blockers, 'release.dirty-production-source', 'dirty-source releases cannot target production');
  if (preparedVerification === null && !manifest.activationEligible) addBlocker(blockers, 'release.activation-ineligible', 'the retained release is not activation eligible');
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw fail('SNAPBACK_DEPLOY_PLAN_INVALID', 'plan time must be a non-negative safe integer');
  const content = {
    artifactKind: 'deployPlan',
    schemaVersion: 'snapback.deploy-plan.v1',
    operationId: inspection.operationId,
    reason: options.reason,
    targetId: target.targetId,
    projectId: target.projectId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    productionClass: target.productionClass,
    targetDescriptorSha256: sha256(Buffer.from(canonicalJson(target))),
    targetObservationSha256: sha256(Buffer.from(canonicalJson(observation))),
    observedActivationGeneration: observation.activationGeneration,
    observedActiveReleaseId: observation.activeReleaseId,
    releaseId: verification.releaseId,
    releaseManifestSha256: verification.manifestSha256,
    preparedReleaseId: preparedVerification?.preparedReleaseId ?? null,
    preparedReleaseManifestSha256: preparedVerification?.preparedReleaseManifestSha256 ?? null,
    steps: ['verifyIdentity', 'acquireLease', 'uploadImmutableRelease', 'provisionInactive', 'compatibilityPreflight', 'createVerifiedBackup', 'stageRelease', 'activateGeneration', 'verifyServedPath', 'releaseLease', 'rollbackOnFailure'],
    blockers,
    applyEligible: (preparedVerification?.activationEligible ?? manifest.activationEligible) && blockers.length === 0,
    createdAtMs,
    expiresAtMs: createdAtMs + 15 * 60 * 1_000,
  };
  const planId = sha256(Buffer.from(`snapback-deploy-plan-v1\0${canonicalJson(content)}`));
  const plan = { ...content, planId, confirmation: `confirm:${planId}` };
  const path = join(roots(options).plans, `${planId.slice('sha256:'.length)}.json`);
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== `${canonicalJson(plan)}\n`) throw fail('SNAPBACK_DEPLOY_PLAN_COLLISION', 'plan digest is already bound to different bytes', { planId });
  } else {
    writeOwnerOnly(path, plan);
  }
  return plan;
}

function readDeployPlan(planId, options = {}) {
  if (!DIGEST.test(planId)) throw fail('SNAPBACK_DEPLOY_PLAN_INVALID', 'plan id must be a sha256 content identity');
  const path = join(roots(options).plans, `${planId.slice('sha256:'.length)}.json`);
  if (!existsSync(path)) throw fail('SNAPBACK_DEPLOY_PLAN_NOT_FOUND', 'deploy plan is not retained', { planId });
  const plan = readBoundedJson(path, 'SNAPBACK_DEPLOY_PLAN_INVALID');
  assertClosed(plan, PLAN_KEYS, 'deploy plan', 'SNAPBACK_DEPLOY_PLAN_INVALID');
  const { planId: observedPlanId, confirmation, ...content } = plan;
  const derivedPlanId = sha256(Buffer.from(`snapback-deploy-plan-v1\0${canonicalJson(content)}`));
  if (observedPlanId !== planId || derivedPlanId !== planId || confirmation !== `confirm:${planId}`) {
    throw fail('SNAPBACK_DEPLOY_PLAN_TAMPERED', 'retained deploy plan does not match its content identity', { planId });
  }
  if (!Array.isArray(plan.steps) || plan.steps.length !== EXPECTED_PLAN_STEPS.length
      || plan.steps.some((step, index) => step !== EXPECTED_PLAN_STEPS[index])) {
    throw fail('SNAPBACK_DEPLOY_PLAN_INVALID', 'deploy plan lifecycle sequence is unsupported', { steps: plan.steps });
  }
  return plan;
}

function validateAdapterDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics) || diagnostics.length > 64) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter diagnostics exceed the closed response bound');
  }
  for (const diagnostic of diagnostics) {
    assertClosed(diagnostic, ['code', 'severity', 'message'], 'adapter diagnostic', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertId(diagnostic.code, 'diagnostic.code', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertText(diagnostic.severity, 'diagnostic.severity', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertText(diagnostic.message, 'diagnostic.message', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  }
}

function validateLease(lease, target, plan) {
  assertClosed(lease, LEASE_KEYS, 'deployment lease', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  assertId(lease.leaseId, 'lease.leaseId', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  if (lease.targetId !== target.targetId || lease.operationId !== plan.operationId
      || lease.expectedActivationGeneration !== plan.observedActivationGeneration
      || !Number.isSafeInteger(lease.acquiredAtMs) || lease.acquiredAtMs < 0
      || !Number.isSafeInteger(lease.expiresAtMs) || lease.expiresAtMs <= lease.acquiredAtMs) {
    throw fail('SNAPBACK_DEPLOY_LEASE_INVALID', 'adapter lease is malformed or bound to a different target, operation, or generation');
  }
  return lease;
}

function validateEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length > 64) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter evidence exceeds the closed response bound');
  }
  for (const item of evidence) {
    assertClosed(item, EVIDENCE_KEYS, 'adapter evidence', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertId(item.kind, 'evidence.kind', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertText(item.uri, 'evidence.uri', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    let location;
    try {
      location = new URL(item.uri);
    } catch {
      throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'evidence URI is malformed');
    }
    if (location.username || location.password || location.search || location.hash
        || !DIGEST.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0
        || item.verified !== true) {
      throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'evidence reference is unverified, credential-bearing, or malformed');
    }
  }
  return evidence;
}

function validateBackup(backup, target, plan) {
  assertClosed(backup, BACKUP_KEYS, 'backup manifest', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  const { backupId, ...backupContent } = backup;
  const derivedBackupId = sha256(Buffer.from(`snapback-backup-manifest-v1\0${canonicalJson(backupContent)}`));
  if (backup.schemaVersion !== 'snapback.backup-manifest.v1' || backupId !== derivedBackupId
      || backup.operationId !== plan.operationId || backup.targetId !== target.targetId
      || backup.deploymentId !== target.deploymentId || backup.databaseId !== target.databaseId
      || backup.streamIncarnation !== target.streamIncarnation
      || backup.releaseId !== plan.observedActiveReleaseId
      || (plan.retentionPolicy !== undefined && backup.retentionPolicy !== plan.retentionPolicy)
      || !DIGEST.test(backup.schemaIdentitySha256)) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'backup manifest content identity does not match the pre-deploy target state');
  }
  for (const name of ['encryptionClass', 'storageClass', 'retentionPolicy']) {
    assertText(backup[name], `backup.${name}`, 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  }
  if (!Array.isArray(backup.components) || backup.components.length === 0 || backup.components.length > 64
      || !Array.isArray(backup.excludedSecretClasses)
      || !backup.excludedSecretClasses.includes('application-secrets')
      || !backup.excludedSecretClasses.includes('control-plane-credentials')
      || !Number.isSafeInteger(backup.createdAtMs) || backup.createdAtMs < 0
      || !Number.isSafeInteger(backup.verifiedAtMs) || backup.verifiedAtMs < backup.createdAtMs) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'backup manifest lacks verified components, secret exclusions, or valid timestamps');
  }
  for (const component of backup.components) {
    assertClosed(component, BACKUP_COMPONENT_KEYS, 'backup component', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    assertId(component.kind, 'backup.component.kind', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
    if (!DIGEST.test(component.sha256) || !Number.isSafeInteger(component.bytes) || component.bytes < 0
        || !Number.isSafeInteger(component.objects) || component.objects < 0 || component.verified !== true) {
      throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'backup component did not pass read-back verification');
    }
  }
  return backup;
}

function validateRestoreResult(restore, target, sourceTarget, backup, expectedActivated) {
  assertClosed(restore, RESTORE_RESULT_KEYS, 'restore result', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  if (restore.backupId !== backup.backupId
      || restore.sourceTargetId !== sourceTarget.targetId
      || restore.sourceDeploymentId !== backup.deploymentId
      || restore.sourceDatabaseId !== backup.databaseId
      || restore.sourceStreamIncarnation !== backup.streamIncarnation
      || restore.destinationTargetId !== target.targetId
      || restore.destinationDeploymentId !== target.deploymentId
      || restore.destinationDatabaseId !== target.databaseId
      || restore.destinationStreamIncarnation !== target.streamIncarnation
      || !Number.isSafeInteger(restore.restoreEpoch) || restore.restoreEpoch < 1
      || restore.effectsFenced !== !expectedActivated || restore.componentsVerified !== true
      || !DIGEST.test(restore.applicationSentinelSha256)
      || !DIGEST.test(restore.acceptanceSha256)
      || restore.externalEffectsDisabled !== !expectedActivated
      || restore.activated !== expectedActivated) {
    throw fail('SNAPBACK_RESTORE_RESULT_INVALID', 'adapter restore result is incomplete or bound to different source/destination identities');
  }
  return restore;
}

function invokeLifecycleAdapter(operation, target, plan, releaseDirectory, lease, attempt, options = {}) {
  validateTargetDescriptor(target);
  const request = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v1',
    operation,
    operationId: plan.operationId,
    attempt,
    target,
    plan,
    releaseDirectory: resolve(releaseDirectory),
    lease,
  };
  const inputSha256 = sha256(Buffer.from(`snapback-vm-adapter-lifecycle-input-v1\0${canonicalJson(request)}`));
  const child = spawnSync(target.adapter.driverPath, [], {
    input: `${canonicalJson(request)}\n`,
    encoding: 'utf8',
    env: adapterEnvironment(options.env),
    timeout: options.adapterTimeoutMs ?? 30_000,
    maxBuffer: MAX_ADAPTER_OUTPUT_BYTES,
    windowsHide: true,
  });
  if (child.error || child.status !== 0) {
    throw fail('SNAPBACK_ADAPTER_EXEC_FAILED', 'adapter lifecycle process did not complete successfully', {
      operation,
      status: child.status,
      signal: child.signal,
      error: child.error?.code ?? null,
      stderrBytes: Buffer.byteLength(child.stderr ?? ''),
      stderrSha256: sha256(Buffer.from(child.stderr ?? '')),
    });
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter lifecycle stdout was not one JSON response', { operation });
  }
  assertClosed(response, LIFECYCLE_RESPONSE_KEYS, 'adapter lifecycle response', 'SNAPBACK_ADAPTER_RESPONSE_INVALID');
  const { outputSha256, ...outputContent } = response;
  const derivedOutputSha256 = sha256(Buffer.from(`snapback-vm-adapter-lifecycle-output-v1\0${canonicalJson(outputContent)}`));
  if (response.schemaVersion !== 'snapback.vm-adapter-lifecycle-response.v1'
      || response.operation !== operation || response.operationId !== plan.operationId
      || typeof response.ok !== 'boolean' || typeof response.idempotentReplay !== 'boolean'
      || typeof response.remoteEvidence !== 'boolean' || response.inputSha256 !== inputSha256
      || outputSha256 !== derivedOutputSha256 || !DIGEST.test(outputSha256)) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'adapter lifecycle response identity or digest does not match the request', { operation });
  }
  validateAdapterDiagnostics(response.diagnostics);
  validateEvidence(response.evidence);
  if (!response.ok || !response.observation) {
    throw fail('SNAPBACK_ADAPTER_REJECTED', 'adapter refused a lifecycle operation', { operation, diagnostics: response.diagnostics });
  }
  validateObservation(response.observation, target);
  if (response.lease !== null) validateLease(response.lease, target, plan);
  if (response.backup !== null) validateBackup(response.backup, target, plan);
  if (response.restore !== null && options.restoreValidation) {
    validateRestoreResult(
      response.restore,
      target,
      options.restoreValidation.sourceTarget,
      options.restoreValidation.backup,
      options.restoreValidation.expectedActivated,
    );
  }
  if (operation === 'acquireLease' && response.lease === null) {
    throw fail('SNAPBACK_DEPLOY_LEASE_INVALID', 'adapter did not return the acquired deployment lease');
  }
  if (operation === 'createVerifiedBackup' && response.backup === null) {
    throw fail('SNAPBACK_DEPLOY_BACKUP_REQUIRED', 'adapter did not return a read-back-verified backup manifest');
  }
  if (response.remoteEvidence && !response.evidence.some((item) => item.kind === 'remoteProviderAttestation')) {
    throw fail('SNAPBACK_ADAPTER_RESPONSE_INVALID', 'remoteEvidence requires a verified remote provider attestation');
  }
  return response;
}

function stepReceipt(sequence, operation, response, previousFactSha256, startedAtMs, finishedAtMs, state = 'completed') {
  const content = {
    sequence,
    operation,
    state,
    inputSha256: response.inputSha256,
    outputSha256: response.outputSha256,
    evidence: response.evidence,
    startedAtMs,
    finishedAtMs,
    idempotentReplay: response.idempotentReplay,
    previousFactSha256,
  };
  return {
    ...content,
    factSha256: sha256(Buffer.from(`snapback-deploy-step-fact-v1\0${canonicalJson(content)}`)),
  };
}

function persistApplyJournal(plan, target, attempt, state, lease, backup, steps, startedAtMs, options) {
  const journal = {
    schemaVersion: 'snapback.deploy-apply-journal.v1',
    planId: plan.planId,
    operationId: plan.operationId,
    targetId: target.targetId,
    releaseId: plan.releaseId,
    attempt,
    state,
    lease,
    backup,
    steps,
    startedAtMs,
    updatedAtMs: (options.clock ?? Date.now)(),
  };
  const path = join(roots(options).operations, `${plan.operationId}.json`);
  replaceOwnerOnly(path, journal);
  return { journal, path };
}

function retainDeployReceipt(plan, target, inspection, finalObservation, backup, steps, outcome, remoteEvidence, startedAtMs, options) {
  const finishedAtMs = (options.clock ?? Date.now)();
  const content = {
    schemaVersion: 'snapback.deploy-receipt.v1',
    planId: plan.planId,
    operationId: plan.operationId,
    targetId: target.targetId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    releaseId: plan.releaseId,
    previousReleaseId: plan.observedActiveReleaseId,
    activationGenerationBefore: plan.observedActivationGeneration,
    activationGenerationAfter: finalObservation.activationGeneration,
    outcome,
    remoteEvidence,
    adapterKind: target.adapter.kind,
    adapterVersion: target.adapter.version,
    providerFactsSha256: finalObservation.providerFactsSha256,
    backup,
    steps,
    gaps: remoteEvidence ? [] : [{ id: 'control-plane.remote-evidence', reason: 'deterministic lifecycle harness is not remote hosted evidence', blocking: true }],
    startedAtMs,
    finishedAtMs,
  };
  const receiptId = sha256(Buffer.from(`snapback-deploy-receipt-v1\0${canonicalJson(content)}`));
  const receipt = { ...content, receiptId };
  const path = join(roots(options).receipts, `${receiptId.slice('sha256:'.length)}.json`);
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== `${canonicalJson(receipt)}\n`) {
      throw fail('SNAPBACK_DEPLOY_RECEIPT_COLLISION', 'deploy receipt id is bound to different bytes', { receiptId });
    }
  } else {
    writeOwnerOnly(path, receipt);
  }
  return receipt;
}

function retainBackupManifest(backup, options) {
  const path = join(roots(options).backups, `${backup.backupId.slice('sha256:'.length)}.json`);
  const expected = `${canonicalJson(backup)}\n`;
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== expected) {
      throw fail('SNAPBACK_BACKUP_ID_COLLISION', 'backup id is already bound to different manifest bytes', { backupId: backup.backupId });
    }
  } else {
    writeOwnerOnly(path, backup);
  }
  return path;
}

function readBackupManifest(backupId, targetId, options = {}) {
  if (!DIGEST.test(backupId)) throw fail('SNAPBACK_BACKUP_ID_INVALID', 'backup id must be a sha256 content identity');
  const target = showTarget(targetId, options);
  const path = join(roots(options).backups, `${backupId.slice('sha256:'.length)}.json`);
  if (!existsSync(path)) throw fail('SNAPBACK_BACKUP_NOT_FOUND', 'backup manifest is not retained', { backupId });
  const backup = readBoundedJson(path, 'SNAPBACK_BACKUP_MANIFEST_INVALID');
  validateBackup(backup, target, {
    operationId: backup.operationId,
    observedActiveReleaseId: backup.releaseId,
  });
  return { backup, path };
}

export function listBackups(targetId, options = {}) {
  const target = showTarget(targetId, options);
  const summaries = [];
  for (const entry of readdirSync(roots(options).backups, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[0-9a-f]{64}\.json$/.test(entry.name)) continue;
    const path = join(roots(options).backups, entry.name);
    const candidate = readBoundedJson(path, 'SNAPBACK_BACKUP_MANIFEST_INVALID');
    if (candidate.targetId !== targetId) continue;
    const { backup } = readBackupManifest(candidate.backupId, targetId, options);
    summaries.push({
      backupId: backup.backupId,
      targetId: backup.targetId,
      deploymentId: backup.deploymentId,
      databaseId: backup.databaseId,
      streamIncarnation: backup.streamIncarnation,
      releaseId: backup.releaseId,
      components: backup.components.length,
      createdAtMs: backup.createdAtMs,
      verifiedAtMs: backup.verifiedAtMs,
    });
  }
  summaries.sort((left, right) => left.createdAtMs - right.createdAtMs || left.backupId.localeCompare(right.backupId));
  appendControlAuditEvent({
    eventType: 'backupList',
    outcome: 'read',
    target,
    operationId: options.operationId ?? randomUUID(),
    reasonCode: 'authorizedRead',
    payload: [{ name: 'backupCount', value: String(summaries.length) }],
  }, options);
  return { schemaVersion: 'snapback.backup-list.v1', ok: true, targetId, backups: summaries };
}

export function verifyBackupManifest(backupId, targetId, options = {}) {
  const { backup, path } = readBackupManifest(backupId, targetId, options);
  const result = {
    schemaVersion: 'snapback.backup-verification.v1',
    ok: true,
    backupId,
    targetId,
    manifestSha256: sha256(readFileSync(path)),
    componentCount: backup.components.length,
    componentBytes: backup.components.reduce((total, component) => total + component.bytes, 0),
    componentObjects: backup.components.reduce((total, component) => total + component.objects, 0),
    adapterReadBackAttested: backup.components.every((component) => component.verified),
    excludedSecretClasses: backup.excludedSecretClasses,
  };
  appendControlAuditEvent({
    eventType: 'backupVerify',
    outcome: 'read',
    target: showTarget(targetId, options),
    operationId: options.operationId ?? randomUUID(),
    reasonCode: 'authorizedRead',
    payload: [
      { name: 'backupId', value: backupId },
      { name: 'componentCount', value: String(result.componentCount) },
    ],
  }, options);
  return result;
}

function retainMaintenancePlan(content, domain, confirmationPrefix, options = {}) {
  const planId = sha256(Buffer.from(`${domain}\0${canonicalJson(content)}`));
  const plan = { ...content, planId, confirmation: `${confirmationPrefix}${planId}` };
  const path = join(roots(options).maintenancePlans, `${planId.slice('sha256:'.length)}.json`);
  const expected = `${canonicalJson(plan)}\n`;
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== expected) {
      throw fail('SNAPBACK_MAINTENANCE_PLAN_COLLISION', 'maintenance plan id is bound to different bytes', { planId });
    }
  } else {
    writeOwnerOnly(path, plan);
  }
  return plan;
}

function readMaintenancePlan(planId, shape, schemaVersion, domain, confirmationPrefix, expectedSteps, options = {}) {
  if (!DIGEST.test(planId)) throw fail('SNAPBACK_MAINTENANCE_PLAN_INVALID', 'maintenance plan id must be a sha256 content identity');
  const path = join(roots(options).maintenancePlans, `${planId.slice('sha256:'.length)}.json`);
  if (!existsSync(path)) throw fail('SNAPBACK_MAINTENANCE_PLAN_NOT_FOUND', 'maintenance plan is not retained', { planId });
  const plan = readBoundedJson(path, 'SNAPBACK_MAINTENANCE_PLAN_INVALID');
  assertClosed(plan, shape, 'maintenance plan', 'SNAPBACK_MAINTENANCE_PLAN_INVALID');
  const { planId: observedPlanId, confirmation, ...content } = plan;
  const derivedPlanId = sha256(Buffer.from(`${domain}\0${canonicalJson(content)}`));
  if (plan.schemaVersion !== schemaVersion || observedPlanId !== planId || derivedPlanId !== planId
      || confirmation !== `${confirmationPrefix}${planId}`) {
    throw fail('SNAPBACK_MAINTENANCE_PLAN_TAMPERED', 'retained maintenance plan does not match its content identity', { planId });
  }
  if (!Array.isArray(plan.steps) || plan.steps.length !== expectedSteps.length
      || plan.steps.some((step, index) => step !== expectedSteps[index])) {
    throw fail('SNAPBACK_MAINTENANCE_PLAN_INVALID', 'maintenance plan lifecycle sequence is unsupported', { steps: plan.steps });
  }
  validateGapArray(plan.blockers, 'SNAPBACK_MAINTENANCE_PLAN_INVALID');
  return plan;
}

function enforceMaintenanceApplyBoundary(plan, options, targetField = 'targetId') {
  if (options.targetId !== plan[targetField]) {
    throw fail('SNAPBACK_MAINTENANCE_IDENTITY_MISMATCH', 'apply target does not match the retained maintenance plan', {
      expected: plan[targetField],
      observed: options.targetId ?? null,
    });
  }
  if (options.confirmation !== plan.confirmation) {
    throw fail('SNAPBACK_MAINTENANCE_CONFIRMATION_REQUIRED', 'apply requires the exact retained maintenance confirmation token', { planId: plan.planId });
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > plan.expiresAtMs) {
    throw fail('SNAPBACK_MAINTENANCE_PLAN_EXPIRED', 'maintenance plan is expired and must be regenerated from fresh provider read-back', { planId: plan.planId });
  }
  if (!plan.applyEligible || plan.blockers.length > 0) {
    throw fail('SNAPBACK_MAINTENANCE_PLAN_BLOCKED', 'maintenance plan retains blocking GAPs and cannot be applied', {
      planId: plan.planId,
      blockerIds: plan.blockers.map((blocker) => blocker.id),
    });
  }
}

function retainMaintenanceReceipt(content, options = {}) {
  const receiptId = sha256(Buffer.from(`snapback-maintenance-receipt-v1\0${canonicalJson(content)}`));
  const receipt = { ...content, receiptId };
  const path = join(roots(options).maintenanceReceipts, `${receiptId.slice('sha256:'.length)}.json`);
  const expected = `${canonicalJson(receipt)}\n`;
  if (existsSync(path)) {
    assertSecureFile(path);
    if (readFileSync(path, 'utf8') !== expected) {
      throw fail('SNAPBACK_MAINTENANCE_RECEIPT_COLLISION', 'maintenance receipt id is bound to different bytes', { receiptId });
    }
  } else {
    writeOwnerOnly(path, receipt);
  }
  return receipt;
}

function readMaintenanceReceipt(receiptId, options = {}) {
  if (!DIGEST.test(receiptId)) throw fail('SNAPBACK_MAINTENANCE_RECEIPT_INVALID', 'maintenance receipt id must be a sha256 content identity');
  const path = join(roots(options).maintenanceReceipts, `${receiptId.slice('sha256:'.length)}.json`);
  if (!existsSync(path)) throw fail('SNAPBACK_MAINTENANCE_RECEIPT_NOT_FOUND', 'maintenance receipt is not retained', { receiptId });
  const receipt = readBoundedJson(path, 'SNAPBACK_MAINTENANCE_RECEIPT_INVALID');
  assertClosed(receipt, MAINTENANCE_RECEIPT_KEYS, 'maintenance receipt', 'SNAPBACK_MAINTENANCE_RECEIPT_INVALID');
  const { receiptId: observedReceiptId, ...content } = receipt;
  const derived = sha256(Buffer.from(`snapback-maintenance-receipt-v1\0${canonicalJson(content)}`));
  if (observedReceiptId !== receiptId || derived !== receiptId) {
    throw fail('SNAPBACK_MAINTENANCE_RECEIPT_TAMPERED', 'maintenance receipt does not match its content identity', { receiptId });
  }
  return receipt;
}

function assertRemoteLifecycleEvidence(response, options, operation) {
  if (options.requireRemoteEvidence !== false && !response.remoteEvidence) {
    throw fail('SNAPBACK_ADAPTER_REMOTE_EVIDENCE_REQUIRED', 'production maintenance requires remote provider evidence', { operation });
  }
}

function maintenanceStep(steps, operation, response, startedAtMs, finishedAtMs, state = 'completed') {
  const previous = steps.at(-1)?.factSha256 ?? null;
  const receipt = stepReceipt(steps.length + 1, operation, response, previous, startedAtMs, finishedAtMs, state);
  steps.push(receipt);
  return receipt;
}

function createBackupPlanCore(options = {}) {
  assertText(options.reason, 'reason', 'SNAPBACK_BACKUP_PLAN_INVALID');
  assertText(options.retentionPolicy, 'retentionPolicy', 'SNAPBACK_BACKUP_PLAN_INVALID');
  if (!options.targetId) {
    throw fail('SNAPBACK_BACKUP_PLAN_INVALID', 'backup planning requires an exact target, reason, and retention policy');
  }
  const target = showTarget(options.targetId, options);
  const query = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: options.operationId ?? randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  const observation = query.observation;
  const inspection = query.inspection;
  const blockers = [];
  if (observation.activeReleaseId === null) {
    addBlocker(blockers, 'backup.no-active-release', 'target has no active release to bind to the backup');
  }
  if (!['active', 'degraded'].includes(observation.state)) {
    addBlocker(blockers, 'backup.target-state', `target state ${observation.state} cannot create an application-consistent backup`);
  }
  if (observation.credentialStatus !== 'ready') {
    addBlocker(blockers, 'backup.credentials', 'target credentials are not ready');
  }
  const logSink = inspection.health.find((fact) => fact.name === 'logSink');
  if (!logSink || logSink.status !== 'ready') {
    addBlocker(blockers, 'backup.log-sink', 'mandatory control log sink is not ready');
  }
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
    throw fail('SNAPBACK_BACKUP_PLAN_INVALID', 'plan time must be a non-negative safe integer');
  }
  const content = {
    schemaVersion: 'snapback.backup-plan.v1',
    operationId: query.operationId,
    reason: options.reason,
    targetId: target.targetId,
    projectId: target.projectId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    productionClass: target.productionClass,
    targetDescriptorSha256: query.targetDescriptorSha256,
    targetObservationSha256: query.targetObservationSha256,
    observedActivationGeneration: observation.activationGeneration,
    observedActiveReleaseId: observation.activeReleaseId,
    observedSchemaGeneration: inspection.schemaGeneration,
    retentionPolicy: options.retentionPolicy,
    steps: EXPECTED_BACKUP_STEPS,
    blockers,
    applyEligible: blockers.length === 0,
    createdAtMs,
    expiresAtMs: createdAtMs + 15 * 60 * 1_000,
  };
  return retainMaintenancePlan(content, 'snapback-backup-plan-v1', 'create-backup:', options);
}

export function createBackupPlan(options = {}) {
  return createBackupPlanCore({ ...options, requireRemoteEvidence: true });
}

function applyBackupPlanCore(planId, options = {}) {
  const plan = readMaintenancePlan(
    planId,
    BACKUP_PLAN_KEYS,
    'snapback.backup-plan.v1',
    'snapback-backup-plan-v1',
    'create-backup:',
    EXPECTED_BACKUP_STEPS,
    options,
  );
  enforceMaintenanceApplyBoundary(plan, options);
  const target = showTarget(plan.targetId, options);
  const fresh = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  if (fresh.observation.activationGeneration !== plan.observedActivationGeneration
      || fresh.observation.activeReleaseId !== plan.observedActiveReleaseId
      || fresh.inspection.schemaGeneration !== plan.observedSchemaGeneration) {
    throw fail('SNAPBACK_BACKUP_STALE_PLAN', 'target generation, active release, or schema changed after backup planning');
  }
  appendControlAuditEvent({
    eventType: 'backupCreate',
    outcome: 'began',
    target,
    operationId: plan.operationId,
    planId: plan.planId,
    reasonCode: 'operatorRequested',
    payload: [
      { name: 'productionClass', value: plan.productionClass },
      { name: 'retentionPolicy', value: plan.retentionPolicy },
    ],
  }, options);
  const steps = [];
  const startedAtMs = (options.clock ?? Date.now)();
  let lease = null;
  let backup = null;
  let finalObservation = fresh.observation;
  let remoteEvidence = true;
  try {
    for (const operation of ['acquireLease', 'createVerifiedBackup', 'releaseLease']) {
      const stepStartedAtMs = (options.clock ?? Date.now)();
      const response = invokeLifecycleAdapter(
        operation,
        target,
        plan,
        options.backupWorkspace ?? process.cwd(),
        lease,
        1,
        options,
      );
      assertRemoteLifecycleEvidence(response, options, operation);
      remoteEvidence = remoteEvidence && response.remoteEvidence;
      if (operation === 'acquireLease') lease = response.lease;
      if (response.backup !== null) {
        backup = response.backup;
        retainBackupManifest(backup, options);
      }
      finalObservation = response.observation;
      maintenanceStep(steps, operation, response, stepStartedAtMs, (options.clock ?? Date.now)());
      if (operation === 'releaseLease') lease = null;
    }
    if (backup === null) {
      throw fail('SNAPBACK_DEPLOY_BACKUP_REQUIRED', 'backup operation completed without a verified backup manifest');
    }
    if (finalObservation.activationGeneration !== plan.observedActivationGeneration
        || finalObservation.activeReleaseId !== plan.observedActiveReleaseId) {
      throw fail('SNAPBACK_BACKUP_STATE_CHANGED', 'backup operation changed the target activation generation or active release');
    }
    const content = {
      schemaVersion: 'snapback.maintenance-receipt.v1',
      kind: 'backup',
      planId: plan.planId,
      operationId: plan.operationId,
      targetId: target.targetId,
      deploymentId: target.deploymentId,
      databaseId: target.databaseId,
      streamIncarnation: target.streamIncarnation,
      activationGenerationBefore: plan.observedActivationGeneration,
      activationGenerationAfter: finalObservation.activationGeneration,
      releaseIdBefore: plan.observedActiveReleaseId,
      releaseIdAfter: finalObservation.activeReleaseId,
      backupId: backup.backupId,
      restore: null,
      outcome: 'backedUp',
      remoteEvidence,
      steps,
      gaps: remoteEvidence ? [] : [{
        id: 'control-plane.remote-evidence',
        reason: 'deterministic backup harness is not remote hosted evidence',
        blocking: true,
      }],
      startedAtMs,
      finishedAtMs: (options.clock ?? Date.now)(),
    };
    const receipt = retainMaintenanceReceipt(content, options);
    appendControlAuditEvent({
      eventType: 'backupCreate',
      outcome: 'succeeded',
      target,
      operationId: plan.operationId,
      planId: plan.planId,
      receiptId: receipt.receiptId,
      reasonCode: 'verified',
      payload: [{ name: 'backupId', value: backup.backupId }],
    }, options);
    return receipt;
  } catch (error) {
    if (lease !== null) {
      try {
        const response = invokeLifecycleAdapter(
          'releaseLease',
          target,
          plan,
          options.backupWorkspace ?? process.cwd(),
          lease,
          1,
          options,
        );
        maintenanceStep(steps, 'releaseLease', response, (options.clock ?? Date.now)(), (options.clock ?? Date.now)(), 'failed');
      } catch {
        // Preserve the original failure; the provider lease expires.
      }
    }
    try {
      appendControlAuditEvent({
        eventType: 'backupCreate',
        outcome: 'failed',
        target,
        operationId: plan.operationId,
        planId: plan.planId,
        reasonCode: SAFE_ID.test(error?.code ?? '') ? error.code : 'operationFailed',
        payload: [],
      }, options);
    } catch (auditError) {
      if (error?.diagnostic) {
        error.diagnostic.details = {
          ...(error.diagnostic.details ?? {}),
          auditFailureCode: auditError?.code ?? 'SNAPBACK_CONTROL_AUDIT_UNAVAILABLE',
        };
      }
    }
    throw error;
  }
}

export function applyBackupPlan(planId, options = {}) {
  return applyBackupPlanCore(planId, { ...options, requireRemoteEvidence: true });
}

function createRollbackPlanCore(options = {}) {
  assertText(options.reason, 'reason', 'SNAPBACK_ROLLBACK_PLAN_INVALID');
  if (!options.targetId || !options.destinationReleaseDirectory
      || !options.preparedReleasePath || !options.qualificationPath
      || typeof options.verifyRelease !== 'function') {
    throw fail('SNAPBACK_ROLLBACK_PLAN_INVALID', 'rollback planning requires target, destination release, prepared release, qualification, reason, and verifier');
  }
  const target = showTarget(options.targetId, options);
  const query = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: options.operationId ?? randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  const observation = query.observation;
  const inspection = query.inspection;
  const prepared = verifyPreparedReleaseArtifacts({
    ...options,
    targetId: target.targetId,
    releaseDirectory: options.destinationReleaseDirectory,
  });
  const blockers = [];
  if (observation.activeReleaseId === null) {
    addBlocker(blockers, 'rollback.no-active-release', 'target has no active release to roll back');
  } else if (observation.activeReleaseId === prepared.baseReleaseId) {
    addBlocker(blockers, 'rollback.destination-already-active', 'destination release is already active');
  }
  if (prepared.compatibility.rollbackMode !== 'codeOnly') {
    addBlocker(blockers, 'rollback.mode', `prepared destination declares rollback mode ${prepared.compatibility.rollbackMode}, not codeOnly`);
  }
  if (inspection.schemaGeneration < prepared.compatibility.minimumReadableSchemaGeneration
      || inspection.schemaGeneration > prepared.compatibility.maximumReadableSchemaGeneration) {
    addBlocker(blockers, 'rollback.schema-incompatible', 'destination release cannot read the live schema generation');
  }
  if (!['active', 'degraded'].includes(observation.state)) {
    addBlocker(blockers, 'rollback.target-state', `target state ${observation.state} cannot perform code-only rollback`);
  }
  const logSink = inspection.health.find((fact) => fact.name === 'logSink');
  if (!logSink || logSink.status !== 'ready') addBlocker(blockers, 'rollback.log-sink', 'mandatory control log sink is not ready');
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw fail('SNAPBACK_ROLLBACK_PLAN_INVALID', 'plan time must be a non-negative safe integer');
  const content = {
    schemaVersion: 'snapback.rollback-plan.v1',
    operationId: query.operationId,
    reason: options.reason,
    targetId: target.targetId,
    projectId: target.projectId,
    environmentId: target.environmentId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetProfileId: target.targetProfileId,
    productionClass: target.productionClass,
    targetDescriptorSha256: query.targetDescriptorSha256,
    targetObservationSha256: query.targetObservationSha256,
    observedActivationGeneration: observation.activationGeneration,
    observedActiveReleaseId: observation.activeReleaseId,
    destinationReleaseId: prepared.baseReleaseId,
    destinationPreparedReleaseId: prepared.preparedReleaseId,
    compatibilitySha256: sha256(Buffer.from(canonicalJson(prepared.compatibility))),
    steps: EXPECTED_ROLLBACK_STEPS,
    blockers,
    applyEligible: blockers.length === 0,
    createdAtMs,
    expiresAtMs: createdAtMs + 15 * 60 * 1_000,
  };
  return retainMaintenancePlan(content, 'snapback-rollback-plan-v1', 'confirm:', options);
}

export function createRollbackPlan(options = {}) {
  return createRollbackPlanCore({ ...options, requireRemoteEvidence: true });
}

function applyRollbackPlanCore(planId, options = {}) {
  const plan = readMaintenancePlan(
    planId,
    ROLLBACK_PLAN_KEYS,
    'snapback.rollback-plan.v1',
    'snapback-rollback-plan-v1',
    'confirm:',
    EXPECTED_ROLLBACK_STEPS,
    options,
  );
  enforceMaintenanceApplyBoundary(plan, options);
  if (!options.destinationReleaseDirectory || !options.preparedReleasePath
      || !options.qualificationPath || typeof options.verifyRelease !== 'function') {
    throw fail('SNAPBACK_ROLLBACK_RELEASE_REQUIRED', 'rollback apply requires the exact destination release and qualification artifacts');
  }
  const target = showTarget(plan.targetId, options);
  const prepared = verifyPreparedReleaseArtifacts({
    ...options,
    targetId: target.targetId,
    releaseDirectory: options.destinationReleaseDirectory,
  });
  if (prepared.baseReleaseId !== plan.destinationReleaseId
      || prepared.preparedReleaseId !== plan.destinationPreparedReleaseId
      || sha256(Buffer.from(canonicalJson(prepared.compatibility))) !== plan.compatibilitySha256
      || prepared.compatibility.rollbackMode !== 'codeOnly') {
    throw fail('SNAPBACK_ROLLBACK_RELEASE_MISMATCH', 'rollback destination or compatibility proof differs from the retained plan');
  }
  const fresh = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  if (fresh.observation.activationGeneration !== plan.observedActivationGeneration
      || fresh.observation.activeReleaseId !== plan.observedActiveReleaseId
      || fresh.inspection.schemaGeneration < prepared.compatibility.minimumReadableSchemaGeneration
      || fresh.inspection.schemaGeneration > prepared.compatibility.maximumReadableSchemaGeneration) {
    throw fail('SNAPBACK_ROLLBACK_STALE_PLAN', 'target generation, active release, or schema compatibility changed after rollback planning');
  }
  auditMutationBegin('codeOnlyRollback', target, plan, options, [
    { name: 'destinationReleaseId', value: plan.destinationReleaseId },
  ]);
  const steps = [];
  const startedAtMs = (options.clock ?? Date.now)();
  let lease = null;
  let finalObservation = fresh.observation;
  let remoteEvidence = true;
  try {
    for (const operation of ['acquireLease', 'compatibilityPreflight', 'rollback', 'verifyServedPath', 'releaseLease']) {
      const stepStartedAtMs = (options.clock ?? Date.now)();
      const response = invokeLifecycleAdapter(
        operation,
        target,
        plan,
        options.destinationReleaseDirectory,
        lease,
        1,
        options,
      );
      assertRemoteLifecycleEvidence(response, options, operation);
      remoteEvidence = remoteEvidence && response.remoteEvidence;
      if (operation === 'acquireLease') lease = response.lease;
      finalObservation = response.observation;
      if (operation === 'rollback'
          && (finalObservation.activeReleaseId !== plan.destinationReleaseId
            || finalObservation.activationGeneration <= plan.observedActivationGeneration)) {
        throw fail('SNAPBACK_ROLLBACK_SWITCH_INVALID', 'adapter did not switch to the destination release under a new generation');
      }
      maintenanceStep(steps, operation, response, stepStartedAtMs, (options.clock ?? Date.now)());
      if (operation === 'releaseLease') lease = null;
    }
    const content = {
      schemaVersion: 'snapback.maintenance-receipt.v1',
      kind: 'codeOnlyRollback',
      planId: plan.planId,
      operationId: plan.operationId,
      targetId: target.targetId,
      deploymentId: target.deploymentId,
      databaseId: target.databaseId,
      streamIncarnation: target.streamIncarnation,
      activationGenerationBefore: plan.observedActivationGeneration,
      activationGenerationAfter: finalObservation.activationGeneration,
      releaseIdBefore: plan.observedActiveReleaseId,
      releaseIdAfter: finalObservation.activeReleaseId,
      backupId: null,
      restore: null,
      outcome: 'rolledBack',
      remoteEvidence,
      steps,
      gaps: remoteEvidence ? [] : [{ id: 'control-plane.remote-evidence', reason: 'deterministic rollback harness is not remote hosted evidence', blocking: true }],
      startedAtMs,
      finishedAtMs: (options.clock ?? Date.now)(),
    };
    const receipt = retainMaintenanceReceipt(content, options);
    auditMutationSucceeded('codeOnlyRollback', target, plan, receipt, options);
    return receipt;
  } catch (error) {
    if (lease !== null) {
      try {
        const response = invokeLifecycleAdapter('releaseLease', target, plan, options.destinationReleaseDirectory, lease, 1, options);
        maintenanceStep(steps, 'releaseLease', response, (options.clock ?? Date.now)(), (options.clock ?? Date.now)(), 'failed');
      } catch {
        // Preserve the original rollback failure; the provider lease expires.
      }
    }
    auditMutationFailed('codeOnlyRollback', target, plan, error, options);
    throw error;
  }
}

export function applyRollbackPlan(planId, options = {}) {
  return applyRollbackPlanCore(planId, { ...options, requireRemoteEvidence: true });
}

function createRestorePlanCore(options = {}) {
  assertText(options.reason, 'reason', 'SNAPBACK_RESTORE_PLAN_INVALID');
  if (!options.sourceTargetId || !options.destinationTargetId || !options.backupId) {
    throw fail('SNAPBACK_RESTORE_PLAN_INVALID', 'restore planning requires exact source target, destination target, backup, and reason');
  }
  const sourceTarget = showTarget(options.sourceTargetId, options);
  const destinationTarget = showTarget(options.destinationTargetId, options);
  const { backup, path: backupPath } = readBackupManifest(options.backupId, sourceTarget.targetId, options);
  const query = invokeQueryAdapterCore('inspectAdmin', destinationTarget.targetId, {
    ...options,
    operationId: options.operationId ?? randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  const observation = query.observation;
  const inspection = query.inspection;
  const blockers = [];
  if (destinationTarget.productionClass === 'production') {
    addBlocker(blockers, 'restore.production-refused', 'v1 destructive restore drill refuses production destinations');
  }
  if (sourceTarget.projectId !== destinationTarget.projectId
      || sourceTarget.targetProfileId !== destinationTarget.targetProfileId) {
    addBlocker(blockers, 'restore.project-profile-mismatch', 'source backup and destination must share exact project and target profile');
  }
  if (backup.releaseId === null) {
    addBlocker(blockers, 'restore.release-identity-missing', 'backup does not name the release required for compatibility activation');
  }
  if (observation.activeReleaseId === null) {
    if (options.replacementReleaseId !== undefined || options.destinationSentinelSha256 !== undefined) {
      addBlocker(blockers, 'restore.unexpected-replacement', 'empty destination must not carry replacement release or sentinel');
    }
    if (!['registered', 'inactive', 'failed'].includes(observation.state)) {
      addBlocker(blockers, 'restore.destination-state', `empty destination state ${observation.state} is not isolated for restore`);
    }
  } else if (options.replacementReleaseId !== observation.activeReleaseId
      || options.destinationSentinelSha256 !== observation.applicationSentinelSha256
      || !DIGEST.test(options.destinationSentinelSha256 ?? '')) {
    addBlocker(blockers, 'restore.replacement-proof', 'nonempty destination requires its exact active release and fresh application sentinel');
  }
  const logSink = inspection.health.find((fact) => fact.name === 'logSink');
  if (!logSink || logSink.status !== 'ready') addBlocker(blockers, 'restore.log-sink', 'mandatory control log sink is not ready');
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw fail('SNAPBACK_RESTORE_PLAN_INVALID', 'plan time must be a non-negative safe integer');
  const content = {
    schemaVersion: 'snapback.restore-plan.v1',
    operationId: query.operationId,
    reason: options.reason,
    sourceTargetId: sourceTarget.targetId,
    backupId: backup.backupId,
    backupManifestSha256: sha256(readFileSync(backupPath)),
    destinationTargetId: destinationTarget.targetId,
    projectId: destinationTarget.projectId,
    environmentId: destinationTarget.environmentId,
    deploymentId: destinationTarget.deploymentId,
    databaseId: destinationTarget.databaseId,
    streamIncarnation: destinationTarget.streamIncarnation,
    targetProfileId: destinationTarget.targetProfileId,
    productionClass: destinationTarget.productionClass,
    targetDescriptorSha256: query.targetDescriptorSha256,
    targetObservationSha256: query.targetObservationSha256,
    observedActivationGeneration: observation.activationGeneration,
    observedActiveReleaseId: observation.activeReleaseId,
    replacementReleaseId: options.replacementReleaseId ?? null,
    destinationSentinelSha256: options.destinationSentinelSha256 ?? null,
    steps: EXPECTED_RESTORE_STEPS,
    blockers,
    applyEligible: blockers.length === 0,
    createdAtMs,
    expiresAtMs: createdAtMs + 15 * 60 * 1_000,
  };
  return retainMaintenancePlan(content, 'snapback-restore-plan-v1', 'destroy-and-restore:', options);
}

export function createRestorePlan(options = {}) {
  return createRestorePlanCore({ ...options, requireRemoteEvidence: true });
}

function applyRestorePlanCore(planId, options = {}) {
  const plan = readMaintenancePlan(
    planId,
    RESTORE_PLAN_KEYS,
    'snapback.restore-plan.v1',
    'snapback-restore-plan-v1',
    'destroy-and-restore:',
    EXPECTED_RESTORE_STEPS,
    options,
  );
  enforceMaintenanceApplyBoundary(plan, options, 'destinationTargetId');
  const sourceTarget = showTarget(plan.sourceTargetId, options);
  const target = showTarget(plan.destinationTargetId, options);
  const { backup, path: backupPath } = readBackupManifest(plan.backupId, sourceTarget.targetId, options);
  if (sha256(readFileSync(backupPath)) !== plan.backupManifestSha256) {
    throw fail('SNAPBACK_RESTORE_BACKUP_MISMATCH', 'source backup manifest differs from the retained restore plan');
  }
  const fresh = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  if (fresh.observation.activationGeneration !== plan.observedActivationGeneration
      || fresh.observation.activeReleaseId !== plan.observedActiveReleaseId
      || fresh.observation.applicationSentinelSha256 !== plan.destinationSentinelSha256) {
    throw fail('SNAPBACK_RESTORE_STALE_PLAN', 'destination generation, active release, or sentinel changed after restore planning');
  }
  auditMutationBegin('destructiveRestore', target, plan, options, [
    { name: 'backupId', value: plan.backupId },
    { name: 'sourceTargetId', value: plan.sourceTargetId },
  ]);
  const steps = [];
  const startedAtMs = (options.clock ?? Date.now)();
  let lease = null;
  let restore = null;
  let finalObservation = fresh.observation;
  let remoteEvidence = true;
  const restoreValidation = { sourceTarget, backup, expectedActivated: false };
  try {
    for (const operation of [
      'acquireLease',
      'fenceExternalEffects',
      'restoreBackupInactive',
      'verifyRestoredComponents',
      'verifyRestoredApplication',
      'releaseLease',
    ]) {
      const stepStartedAtMs = (options.clock ?? Date.now)();
      const response = invokeLifecycleAdapter(
        operation,
        target,
        plan,
        options.restoreWorkspace ?? process.cwd(),
        lease,
        1,
        { ...options, restoreValidation },
      );
      assertRemoteLifecycleEvidence(response, options, operation);
      remoteEvidence = remoteEvidence && response.remoteEvidence;
      if (operation === 'acquireLease') lease = response.lease;
      if (response.restore !== null) restore = response.restore;
      finalObservation = response.observation;
      maintenanceStep(steps, operation, response, stepStartedAtMs, (options.clock ?? Date.now)());
      if (operation === 'releaseLease') lease = null;
    }
    if (restore === null || finalObservation.state !== 'inactive'
        || finalObservation.applicationSentinelSha256 !== restore.applicationSentinelSha256) {
      throw fail('SNAPBACK_RESTORE_PAUSE_INVALID', 'restore did not finish verified, inactive, and effects-fenced');
    }
    const content = {
      schemaVersion: 'snapback.maintenance-receipt.v1',
      kind: 'restore',
      planId: plan.planId,
      operationId: plan.operationId,
      targetId: target.targetId,
      deploymentId: target.deploymentId,
      databaseId: target.databaseId,
      streamIncarnation: target.streamIncarnation,
      activationGenerationBefore: plan.observedActivationGeneration,
      activationGenerationAfter: finalObservation.activationGeneration,
      releaseIdBefore: plan.observedActiveReleaseId,
      releaseIdAfter: backup.releaseId,
      backupId: backup.backupId,
      restore,
      outcome: 'restoredPaused',
      remoteEvidence,
      steps,
      gaps: remoteEvidence ? [] : [{ id: 'control-plane.remote-evidence', reason: 'deterministic restore harness is not remote hosted evidence', blocking: true }],
      startedAtMs,
      finishedAtMs: (options.clock ?? Date.now)(),
    };
    const receipt = retainMaintenanceReceipt(content, options);
    auditMutationSucceeded('destructiveRestore', target, plan, receipt, options);
    return receipt;
  } catch (error) {
    if (lease !== null) {
      try {
        const response = invokeLifecycleAdapter(
          'releaseLease',
          target,
          plan,
          options.restoreWorkspace ?? process.cwd(),
          lease,
          1,
          { ...options, restoreValidation },
        );
        maintenanceStep(steps, 'releaseLease', response, (options.clock ?? Date.now)(), (options.clock ?? Date.now)(), 'failed');
      } catch {
        // Preserve the original restore failure; the provider lease expires.
      }
    }
    auditMutationFailed('destructiveRestore', target, plan, error, options);
    throw error;
  }
}

export function applyRestorePlan(planId, options = {}) {
  return applyRestorePlanCore(planId, { ...options, requireRemoteEvidence: true });
}

export function verifyRestoreReceipt(receiptId, options = {}) {
  const receipt = readMaintenanceReceipt(receiptId, options);
  if (!['restore', 'restoreActivation'].includes(receipt.kind) || receipt.restore === null
      || receipt.backupId === null || receipt.targetId !== options.targetId) {
    throw fail('SNAPBACK_RESTORE_RECEIPT_INVALID', 'receipt is not a restore result for the exact requested target');
  }
  const target = showTarget(receipt.targetId, options);
  const sourceTarget = showTarget(receipt.restore.sourceTargetId, options);
  const { backup } = readBackupManifest(receipt.backupId, sourceTarget.targetId, options);
  const activated = receipt.kind === 'restoreActivation';
  validateRestoreResult(receipt.restore, target, sourceTarget, backup, activated);
  if ((activated && receipt.outcome !== 'restoreActivated')
      || (!activated && receipt.outcome !== 'restoredPaused')) {
    throw fail('SNAPBACK_RESTORE_RECEIPT_INVALID', 'restore receipt outcome does not match its activation state');
  }
  const result = {
    schemaVersion: 'snapback.restore-verification.v1',
    ok: true,
    receiptId,
    targetId: target.targetId,
    backupId: backup.backupId,
    restoreEpoch: receipt.restore.restoreEpoch,
    componentsVerified: receipt.restore.componentsVerified,
    applicationSentinelSha256: receipt.restore.applicationSentinelSha256,
    acceptanceSha256: receipt.restore.acceptanceSha256,
    effectsFenced: receipt.restore.effectsFenced,
    externalEffectsDisabled: receipt.restore.externalEffectsDisabled,
    activated: receipt.restore.activated,
    remoteEvidence: receipt.remoteEvidence,
  };
  appendControlAuditEvent({
    eventType: 'restoreVerify',
    outcome: 'read',
    target,
    operationId: options.operationId ?? randomUUID(),
    receiptId,
    reasonCode: 'authorizedRead',
    payload: [
      { name: 'backupId', value: backup.backupId },
      { name: 'activated', value: String(result.activated) },
    ],
  }, options);
  return result;
}

function createRestoreActivationPlanCore(options = {}) {
  assertText(options.reason, 'reason', 'SNAPBACK_RESTORE_ACTIVATION_PLAN_INVALID');
  if (!options.releaseDirectory || !options.preparedReleasePath
      || !options.qualificationPath || typeof options.verifyRelease !== 'function') {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_PLAN_INVALID', 'restore activation planning requires the restored release, prepared release, qualification, reason, and verifier');
  }
  const receipt = readMaintenanceReceipt(options.restoreReceiptId, options);
  if (receipt.kind !== 'restore' || receipt.outcome !== 'restoredPaused' || receipt.restore === null
      || receipt.restore.activated || !receipt.restore.componentsVerified
      || !receipt.restore.effectsFenced || !receipt.restore.externalEffectsDisabled) {
    throw fail('SNAPBACK_RESTORE_RECEIPT_NOT_PAUSED', 'restore activation requires a verified paused restore receipt');
  }
  if (options.targetId !== receipt.targetId) {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_IDENTITY_MISMATCH', 'activation target does not match the paused restore receipt');
  }
  const target = showTarget(receipt.targetId, options);
  const prepared = verifyPreparedReleaseArtifacts({
    ...options,
    targetId: target.targetId,
  });
  if (prepared.baseReleaseId !== receipt.releaseIdAfter) {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_RELEASE_MISMATCH', 'prepared release does not match the release restored from backup');
  }
  const sourceTarget = showTarget(receipt.restore.sourceTargetId, options);
  const { backup } = readBackupManifest(receipt.backupId, sourceTarget.targetId, options);
  validateRestoreResult(receipt.restore, target, sourceTarget, backup, false);
  const query = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: options.operationId ?? randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  const blockers = [];
  if (query.observation.state !== 'inactive') addBlocker(blockers, 'restore.activation-state', 'restored destination is not inactive');
  if (query.observation.activationGeneration !== receipt.activationGenerationAfter) {
    addBlocker(blockers, 'restore.activation-generation', 'restored destination generation changed after verification');
  }
  if (query.observation.applicationSentinelSha256 !== receipt.restore.applicationSentinelSha256) {
    addBlocker(blockers, 'restore.activation-sentinel', 'restored application sentinel changed after verification');
  }
  const logSink = query.inspection.health.find((fact) => fact.name === 'logSink');
  if (!logSink || logSink.status !== 'ready') addBlocker(blockers, 'restore.log-sink', 'mandatory control log sink is not ready');
  blockers.sort((left, right) => left.id.localeCompare(right.id));
  const createdAtMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) throw fail('SNAPBACK_RESTORE_ACTIVATION_PLAN_INVALID', 'plan time must be a non-negative safe integer');
  const content = {
    schemaVersion: 'snapback.restore-activation-plan.v1',
    operationId: query.operationId,
    reason: options.reason,
    restoreReceiptId: receipt.receiptId,
    backupId: receipt.backupId,
    targetId: target.targetId,
    deploymentId: target.deploymentId,
    databaseId: target.databaseId,
    streamIncarnation: target.streamIncarnation,
    targetDescriptorSha256: query.targetDescriptorSha256,
    targetObservationSha256: query.targetObservationSha256,
    observedActivationGeneration: query.observation.activationGeneration,
    restoredReleaseId: receipt.releaseIdAfter,
    preparedReleaseId: prepared.preparedReleaseId,
    preparedReleaseManifestSha256: prepared.preparedReleaseManifestSha256,
    adapterQualificationId: prepared.qualificationId,
    adapterQualificationSha256: prepared.qualificationManifestSha256,
    applicationSentinelSha256: receipt.restore.applicationSentinelSha256,
    steps: EXPECTED_RESTORE_ACTIVATION_STEPS,
    blockers,
    applyEligible: blockers.length === 0,
    createdAtMs,
    expiresAtMs: createdAtMs + 15 * 60 * 1_000,
  };
  return retainMaintenancePlan(content, 'snapback-restore-activation-plan-v1', 'activate-restore:', options);
}

export function createRestoreActivationPlan(options = {}) {
  return createRestoreActivationPlanCore({ ...options, requireRemoteEvidence: true });
}

function applyRestoreActivationPlanCore(planId, options = {}) {
  const plan = readMaintenancePlan(
    planId,
    RESTORE_ACTIVATION_PLAN_KEYS,
    'snapback.restore-activation-plan.v1',
    'snapback-restore-activation-plan-v1',
    'activate-restore:',
    EXPECTED_RESTORE_ACTIVATION_STEPS,
    options,
  );
  enforceMaintenanceApplyBoundary(plan, options);
  if (!options.releaseDirectory || !options.preparedReleasePath
      || !options.qualificationPath || typeof options.verifyRelease !== 'function') {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_RELEASE_REQUIRED', 'restore activation requires the exact restored release and qualification artifacts');
  }
  const pausedReceipt = readMaintenanceReceipt(plan.restoreReceiptId, options);
  if (pausedReceipt.kind !== 'restore' || pausedReceipt.outcome !== 'restoredPaused'
      || pausedReceipt.backupId !== plan.backupId || pausedReceipt.restore === null
      || pausedReceipt.restore.applicationSentinelSha256 !== plan.applicationSentinelSha256) {
    throw fail('SNAPBACK_RESTORE_RECEIPT_MISMATCH', 'paused restore receipt differs from the activation plan');
  }
  const target = showTarget(plan.targetId, options);
  const prepared = verifyPreparedReleaseArtifacts({
    ...options,
    targetId: target.targetId,
  });
  if (prepared.baseReleaseId !== plan.restoredReleaseId
      || prepared.preparedReleaseId !== plan.preparedReleaseId
      || prepared.preparedReleaseManifestSha256 !== plan.preparedReleaseManifestSha256
      || prepared.qualificationId !== plan.adapterQualificationId
      || prepared.qualificationManifestSha256 !== plan.adapterQualificationSha256) {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_RELEASE_MISMATCH', 'restored release or qualification differs from the activation plan');
  }
  const sourceTarget = showTarget(pausedReceipt.restore.sourceTargetId, options);
  const { backup } = readBackupManifest(plan.backupId, sourceTarget.targetId, options);
  const fresh = invokeQueryAdapterCore('inspectAdmin', target.targetId, {
    ...options,
    operationId: randomUUID(),
    requireRemoteEvidence: options.requireRemoteEvidence !== false,
  });
  if (fresh.observation.state !== 'inactive'
      || fresh.observation.activationGeneration !== plan.observedActivationGeneration
      || fresh.observation.applicationSentinelSha256 !== plan.applicationSentinelSha256) {
    throw fail('SNAPBACK_RESTORE_ACTIVATION_STALE_PLAN', 'paused restore state changed after activation planning');
  }
  auditMutationBegin('restoreActivation', target, plan, options, [
    { name: 'backupId', value: plan.backupId },
    { name: 'restoredReleaseId', value: plan.restoredReleaseId },
  ]);
  const steps = [];
  const startedAtMs = (options.clock ?? Date.now)();
  let lease = null;
  let restore = null;
  let finalObservation = fresh.observation;
  let remoteEvidence = true;
  const restoreValidation = { sourceTarget, backup, expectedActivated: true };
  try {
    for (const operation of ['acquireLease', 'activateRestoredGeneration', 'verifyServedPath', 'releaseLease']) {
      const stepStartedAtMs = (options.clock ?? Date.now)();
      const response = invokeLifecycleAdapter(
        operation,
        target,
        plan,
        options.restoreWorkspace ?? process.cwd(),
        lease,
        1,
        { ...options, restoreValidation },
      );
      assertRemoteLifecycleEvidence(response, options, operation);
      remoteEvidence = remoteEvidence && response.remoteEvidence;
      if (operation === 'acquireLease') lease = response.lease;
      if (response.restore !== null) restore = response.restore;
      finalObservation = response.observation;
      maintenanceStep(steps, operation, response, stepStartedAtMs, (options.clock ?? Date.now)());
      if (operation === 'releaseLease') lease = null;
    }
    if (restore === null || !restore.activated || finalObservation.state !== 'active'
        || finalObservation.activeReleaseId !== plan.restoredReleaseId
        || finalObservation.activationGeneration <= plan.observedActivationGeneration) {
      throw fail('SNAPBACK_RESTORE_ACTIVATION_INVALID', 'adapter did not activate the verified restored release under a new generation');
    }
    const content = {
      schemaVersion: 'snapback.maintenance-receipt.v1',
      kind: 'restoreActivation',
      planId: plan.planId,
      operationId: plan.operationId,
      targetId: target.targetId,
      deploymentId: target.deploymentId,
      databaseId: target.databaseId,
      streamIncarnation: target.streamIncarnation,
      activationGenerationBefore: plan.observedActivationGeneration,
      activationGenerationAfter: finalObservation.activationGeneration,
      releaseIdBefore: null,
      releaseIdAfter: finalObservation.activeReleaseId,
      backupId: backup.backupId,
      restore,
      outcome: 'restoreActivated',
      remoteEvidence,
      steps,
      gaps: remoteEvidence ? [] : [{ id: 'control-plane.remote-evidence', reason: 'deterministic restore activation harness is not remote hosted evidence', blocking: true }],
      startedAtMs,
      finishedAtMs: (options.clock ?? Date.now)(),
    };
    const receipt = retainMaintenanceReceipt(content, options);
    auditMutationSucceeded('restoreActivation', target, plan, receipt, options);
    return receipt;
  } catch (error) {
    if (lease !== null) {
      try {
        const response = invokeLifecycleAdapter(
          'releaseLease',
          target,
          plan,
          options.restoreWorkspace ?? process.cwd(),
          lease,
          1,
          { ...options, restoreValidation },
        );
        maintenanceStep(steps, 'releaseLease', response, (options.clock ?? Date.now)(), (options.clock ?? Date.now)(), 'failed');
      } catch {
        // Preserve the original activation failure; the provider lease expires.
      }
    }
    auditMutationFailed('restoreActivation', target, plan, error, options);
    throw error;
  }
}

export function applyRestoreActivationPlan(planId, options = {}) {
  return applyRestoreActivationPlanCore(planId, { ...options, requireRemoteEvidence: true });
}

function applyDeployPlanCore(planId, options = {}) {
  const plan = readDeployPlan(planId, options);
  if (options.targetId !== plan.targetId) {
    throw fail('SNAPBACK_DEPLOY_IDENTITY_MISMATCH', 'apply target does not match the retained plan', {
      expected: plan.targetId,
      observed: options.targetId ?? null,
    });
  }
  if (options.confirmation !== plan.confirmation) {
    throw fail('SNAPBACK_DEPLOY_CONFIRMATION_REQUIRED', 'apply requires the exact retained plan confirmation token', { planId });
  }
  const nowMs = options.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > plan.expiresAtMs) {
    throw fail('SNAPBACK_DEPLOY_PLAN_EXPIRED', 'deploy plan is expired and must be regenerated from fresh provider read-back', { planId });
  }
  if (!plan.applyEligible || !Array.isArray(plan.blockers) || plan.blockers.length > 0) {
    throw fail('SNAPBACK_DEPLOY_PLAN_BLOCKED', 'deploy plan retains blocking GAPs and cannot be applied', {
      planId,
      blockerIds: Array.isArray(plan.blockers) ? plan.blockers.map((blocker) => blocker.id) : [],
    });
  }
  if (typeof options.verifyRelease !== 'function' || !options.releaseDirectory) {
    throw fail('SNAPBACK_DEPLOY_RELEASE_REQUIRED', 'apply requires the exact retained release directory and verifier');
  }
  if (options.requireRemoteEvidence !== false
      && (!DIGEST.test(plan.preparedReleaseId ?? '') || !DIGEST.test(plan.preparedReleaseManifestSha256 ?? ''))) {
    throw fail('SNAPBACK_PREPARED_RELEASE_REQUIRED', 'production apply requires a qualified prepared-release artifact bound into the plan');
  }
  const verification = options.verifyRelease(options.releaseDirectory);
  if (verification.releaseId !== plan.releaseId || verification.manifestSha256 !== plan.releaseManifestSha256) {
    throw fail('SNAPBACK_DEPLOY_RELEASE_MISMATCH', 'apply release is changed or different from the retained plan', {
      plannedReleaseId: plan.releaseId,
      observedReleaseId: verification.releaseId,
      activationEligible: verification.activationEligible,
    });
  }
  if (options.requireRemoteEvidence !== false) {
    const prepared = verifyPreparedReleaseArtifacts({ ...options, targetId: plan.targetId });
    if (prepared.preparedReleaseId !== plan.preparedReleaseId
        || prepared.preparedReleaseManifestSha256 !== plan.preparedReleaseManifestSha256
        || prepared.baseReleaseId !== plan.releaseId
        || prepared.baseReleaseManifestSha256 !== plan.releaseManifestSha256) {
      throw fail('SNAPBACK_PREPARED_RELEASE_MISMATCH', 'prepared release or adapter qualification differs from the retained plan');
    }
  } else if (verification.activationEligible !== true) {
    throw fail('SNAPBACK_DEPLOY_RELEASE_MISMATCH', 'deterministic harness requires an explicitly eligible injected release verifier');
  }
  const inspection = invokeAdapter('inspect', plan.targetId, options);
  if (inspection.observation.activationGeneration !== plan.observedActivationGeneration
      || inspection.observation.activeReleaseId !== plan.observedActiveReleaseId) {
    throw fail('SNAPBACK_DEPLOY_PLAN_STALE', 'target activation state changed after planning', {
      plannedGeneration: plan.observedActivationGeneration,
      observedGeneration: inspection.observation.activationGeneration,
      plannedReleaseId: plan.observedActiveReleaseId,
      observedReleaseId: inspection.observation.activeReleaseId,
    });
  }
  const target = inspection.target;
  const startedAtMs = (options.clock ?? Date.now)();
  const journalPath = join(roots(options).operations, `${plan.operationId}.json`);
  let attempt = 1;
  if (existsSync(journalPath)) {
    const prior = readBoundedJson(journalPath, 'SNAPBACK_DEPLOY_JOURNAL_INVALID');
    if (prior.planId !== plan.planId || prior.targetId !== plan.targetId || prior.releaseId !== plan.releaseId) {
      throw fail('SNAPBACK_DEPLOY_OPERATION_REUSED', 'operationId is already bound to a different plan, target, or release');
    }
    attempt = prior.attempt + 1;
  }
  let lease = null;
  let backup = null;
  let finalObservation = inspection.observation;
  let previousFactSha256 = null;
  const steps = [];
  auditMutationBegin('deployApply', target, plan, options, [
    { name: 'releaseId', value: plan.releaseId },
    { name: 'attempt', value: String(attempt) },
  ]);
  persistApplyJournal(plan, target, attempt, 'applying', lease, backup, steps, startedAtMs, options);
  try {
    for (const operation of APPLY_OPERATIONS) {
      const stepStartedAtMs = (options.clock ?? Date.now)();
      if (lease !== null && stepStartedAtMs > lease.expiresAtMs) {
        throw fail('SNAPBACK_DEPLOY_LEASE_EXPIRED', 'deployment lease expired before the next lifecycle step', { operation });
      }
      const response = invokeLifecycleAdapter(
        operation,
        target,
        plan,
        options.releaseDirectory,
        lease,
        attempt,
        options,
      );
      const stepFinishedAtMs = (options.clock ?? Date.now)();
      lease = operation === 'releaseLease' ? response.lease : (response.lease ?? lease);
      backup = response.backup ?? backup;
      if (response.backup !== null) retainBackupManifest(response.backup, options);
      finalObservation = response.observation;
      const receipt = stepReceipt(steps.length + 1, operation, response, previousFactSha256, stepStartedAtMs, stepFinishedAtMs);
      previousFactSha256 = receipt.factSha256;
      steps.push(receipt);
      persistApplyJournal(plan, target, attempt, 'applying', lease, backup, steps, startedAtMs, options);
      if (!response.remoteEvidence && options.requireRemoteEvidence !== false) {
        throw fail('SNAPBACK_DEPLOY_REMOTE_EVIDENCE_REQUIRED', 'adapter lifecycle step returned no remote provider evidence', { operation });
      }
      if (options[DETERMINISTIC_HARNESS] === true && attempt === 1 && options.simulateInterruptionAfter === operation) {
        const interruption = fail('SNAPBACK_TEST_SIMULATED_INTERRUPTION', 'deterministic harness interrupted after retaining the completed step', { operation });
        interruption.simulatedInterruption = true;
        throw interruption;
      }
    }
    if (finalObservation.activationGeneration !== plan.observedActivationGeneration + 1
        || finalObservation.activeReleaseId !== plan.releaseId || finalObservation.state !== 'active') {
      throw fail('SNAPBACK_DEPLOY_ACTIVATION_UNVERIFIED', 'served-path verification did not attest the planned active release and next generation');
    }
    const remoteEvidence = steps.every((step) => step.evidence.some((item) => item.kind === 'remoteProviderAttestation'));
    const receipt = retainDeployReceipt(plan, target, inspection, finalObservation, backup, steps, 'activated', remoteEvidence, startedAtMs, options);
    persistApplyJournal(plan, target, attempt, 'completed', lease, backup, steps, startedAtMs, options);
    auditMutationSucceeded('deployApply', target, plan, receipt, options);
    return receipt;
  } catch (cause) {
    if (cause?.simulatedInterruption === true && options[DETERMINISTIC_HARNESS] === true) {
      persistApplyJournal(plan, target, attempt, 'interrupted', lease, backup, steps, startedAtMs, options);
      auditMutationFailed('deployApply', target, plan, cause, options);
      throw cause;
    }
    let outcome = 'failed';
    if (lease !== null) {
      try {
        for (const operation of ['rollback', 'releaseLease']) {
          const stepStartedAtMs = (options.clock ?? Date.now)();
          const response = invokeLifecycleAdapter(
            operation,
            target,
            plan,
            options.releaseDirectory,
            lease,
            attempt,
            options,
          );
          const stepFinishedAtMs = (options.clock ?? Date.now)();
          lease = operation === 'releaseLease' ? response.lease : (response.lease ?? lease);
          backup = response.backup ?? backup;
          finalObservation = response.observation;
          const receipt = stepReceipt(
            steps.length + 1,
            operation,
            response,
            previousFactSha256,
            stepStartedAtMs,
            stepFinishedAtMs,
            operation === 'rollback' ? 'rolledBack' : 'completed',
          );
          previousFactSha256 = receipt.factSha256;
          steps.push(receipt);
          persistApplyJournal(plan, target, attempt, 'rollingBack', lease, backup, steps, startedAtMs, options);
        }
        if (finalObservation.activeReleaseId === plan.observedActiveReleaseId) outcome = 'rolledBack';
      } catch (rollbackCause) {
        if (cause?.diagnostic) {
          cause.diagnostic.details = {
            ...(cause.diagnostic.details ?? {}),
            rollbackFailureCode: rollbackCause?.code ?? 'SNAPBACK_DEPLOY_ROLLBACK_FAILED',
          };
        }
      }
    }
    const remoteEvidence = steps.length > 0 && steps.every((step) => step.evidence.some((item) => item.kind === 'remoteProviderAttestation'));
    const failureReceipt = retainDeployReceipt(plan, target, inspection, finalObservation, backup, steps, outcome, remoteEvidence, startedAtMs, options);
    persistApplyJournal(plan, target, attempt, outcome, lease, backup, steps, startedAtMs, options);
    if (cause?.diagnostic) {
      cause.diagnostic.details = { ...(cause.diagnostic.details ?? {}), receiptId: failureReceipt.receiptId, outcome };
    }
    auditMutationFailed('deployApply', target, plan, cause, options, failureReceipt.receiptId);
    throw cause;
  }
}

export function applyDeployPlan(planId, options = {}) {
  return applyDeployPlanCore(planId, { ...options, requireRemoteEvidence: true });
}

export const __deploymentTest = {
  canonicalJson,
  sha256,
  readFileDescriptorSafeHarness(path, code, options = {}) {
    return readFileDescriptorSafe(path, code, options);
  },
  closedKeySchemaBindings: CLOSED_KEY_SCHEMA_BINDINGS,
  nonSchemaKeySets: NON_SCHEMA_KEY_SETS,
  createBackupPlanHarness(options = {}) {
    return createBackupPlanCore({ ...options, requireRemoteEvidence: false });
  },
  applyBackupPlanHarness(planId, options = {}) {
    return applyBackupPlanCore(planId, { ...options, requireRemoteEvidence: false });
  },
  createRollbackPlanHarness(options = {}) {
    return createRollbackPlanCore({ ...options, requireRemoteEvidence: false });
  },
  applyRollbackPlanHarness(planId, options = {}) {
    return applyRollbackPlanCore(planId, { ...options, requireRemoteEvidence: false });
  },
  createRestorePlanHarness(options = {}) {
    return createRestorePlanCore({ ...options, requireRemoteEvidence: false });
  },
  applyRestorePlanHarness(planId, options = {}) {
    return applyRestorePlanCore(planId, { ...options, requireRemoteEvidence: false });
  },
  createRestoreActivationPlanHarness(options = {}) {
    return createRestoreActivationPlanCore({ ...options, requireRemoteEvidence: false });
  },
  applyRestoreActivationPlanHarness(planId, options = {}) {
    return applyRestoreActivationPlanCore(planId, { ...options, requireRemoteEvidence: false });
  },
  logsHarness(targetId, options = {}) {
    return invokeQueryAdapterCore('logs', targetId, { ...options, requireRemoteEvidence: false });
  },
  inspectAdminHarness(targetId, options = {}) {
    return invokeQueryAdapterCore('inspectAdmin', targetId, { ...options, requireRemoteEvidence: false });
  },
  applyHarness(planId, options = {}) {
    return applyDeployPlanCore(planId, {
      ...options,
      requireRemoteEvidence: false,
      [DETERMINISTIC_HARNESS]: true,
    });
  },
};
