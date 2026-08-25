// Hand-authored declarations for deployment-control.mjs — the target-neutral
// deployment, backup, restore, rollback, and audit control plane. Keep in
// sync with the runtime module's exports.

/** Closed adapter/hosted diagnostic: exactly code, severity, and message. */
export interface AdapterDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
}

/** Blocking GAP fact retained on plans, receipts, and artifacts. */
export interface ControlPlaneGap {
  readonly id: string;
  readonly reason: string;
  readonly blocking: true;
}

/**
 * Common option bag threaded through every control-plane entry point.
 * `controlRoot` selects the owner-only on-disk control store (default
 * `.snapback/control` under the working directory).
 */
export interface ControlPlaneOptions {
  readonly controlRoot?: string;
  readonly auditActorId?: string;
  readonly auditClock?: () => number;
  readonly clock?: () => number;
  readonly nowMs?: number;
  readonly operationId?: string;
  readonly adapterTimeoutMs?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Bounded time-range/limit/cursor query facts for logs and inspection. */
export interface AdapterQueryOptions {
  readonly sinceMs?: number;
  readonly untilMs?: number;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface VmAdapterDescriptor {
  readonly kind: 'singleInstanceContainerVm';
  readonly version: string;
  readonly driverPath: string;
  readonly driverSha256: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly credentialRef: string;
  readonly stateStoreRef: string;
}

export interface TargetDescriptor {
  readonly schemaVersion: 'snapback.target-descriptor.v1';
  readonly targetId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly adapter: VmAdapterDescriptor;
  readonly createdAtMs: number;
}

export type TargetLifecycleState =
  | 'registered'
  | 'provisioning'
  | 'inactive'
  | 'staging'
  | 'ready'
  | 'active'
  | 'degraded'
  | 'draining'
  | 'failed'
  | 'restoring'
  | 'retired';

export type TargetCredentialStatus = 'ready' | 'missing' | 'invalid' | 'unknown';

export interface TargetObservation {
  readonly targetId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly resourceId: string;
  readonly state: TargetLifecycleState;
  readonly activationGeneration: number;
  readonly activeReleaseId: string | null;
  readonly applicationSentinelSha256: string | null;
  readonly credentialStatus: TargetCredentialStatus;
  readonly providerFactsSha256: string;
  readonly observedAtMs: number;
  readonly capabilityGaps: readonly string[];
}

export interface AdapterEvidenceRef {
  readonly kind: string;
  readonly uri: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly verified: true;
}

/** Minimal release-verification facts the control plane consumes. */
export interface ReleaseVerificationSummary {
  readonly releaseId: string;
  readonly manifestSha256: string;
  readonly activationEligible?: boolean;
}

/** Injected release verifier (usually `verifyRelease` from the package root). */
export type ReleaseVerifier = (releaseDirectory: string) => ReleaseVerificationSummary;

// ---------------------------------------------------------------------------
// Hosted admission envelope
// ---------------------------------------------------------------------------

export interface AuthenticationBucketPolicy {
  readonly intervalMs: number;
  readonly burst: number;
  readonly maximumDenialDebtAttempts: number;
}

export interface SharedAuthenticationThrottleConfig {
  readonly retentionMs: number;
  readonly maximumKeyCount: number;
  readonly global: AuthenticationBucketPolicy;
  readonly source: AuthenticationBucketPolicy;
  readonly subject: AuthenticationBucketPolicy;
  readonly sourceSubject: AuthenticationBucketPolicy;
  readonly family: AuthenticationBucketPolicy;
}

export interface HostedAuthSupport {
  readonly externalTls: 'enforced';
  readonly effectiveSource: 'trusted';
  readonly authenticationThrottle: 'sharedEnforced';
  readonly sessionInvalidation: 'globallyFenced';
  readonly clientCredentialPosture: 'senderConstrainedV2';
}

export interface HostedAdmission {
  readonly version: 1;
  readonly deploymentId: string;
  readonly configurationSha256: string;
  readonly supportSha256: string;
  readonly admissionEpoch: number;
  readonly senderReplayEpochFloor: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly limiterEpoch: number;
  readonly authenticationThrottleConfig: SharedAuthenticationThrottleConfig;
  readonly invalidationEpoch: number;
  readonly handlerProtocolVersion: 1;
  readonly handlerIncarnation: string;
  readonly operatorSurface: 'disabled';
  readonly browserDirectBearerSeam: 'excluded';
  readonly hostedAuth: HostedAuthSupport;
}

export interface HostedAdmissionEnvelope {
  readonly schemaVersion: 'snapback.hosted-admission-envelope.v1';
  readonly keyId: string;
  readonly publicOrigin: string;
  readonly admission: HostedAdmission;
  readonly mac: string;
}

/**
 * Produce the exact MAC-authenticated, non-secret envelope consumed by the
 * native hosted-startup gate. `keyMaterial` must be exactly 32 secret bytes;
 * it is zeroed after use and never retained in the returned JSON.
 */
export function sealHostedAdmissionEnvelope(options: {
  readonly keyId: string;
  readonly keyMaterial: Uint8Array;
  readonly publicOrigin: string;
  readonly admission: HostedAdmission;
}): HostedAdmissionEnvelope;

// ---------------------------------------------------------------------------
// Target registration and read-only observation
// ---------------------------------------------------------------------------

/** Validate a parsed target descriptor (including driver digest read-back). */
export function validateTargetDescriptor(target: unknown): TargetDescriptor;

export interface TargetAddResult {
  readonly schemaVersion: 'snapback.target-add.v1';
  readonly ok: true;
  readonly state: 'registered' | 'reused';
  readonly targetId: string;
  readonly descriptorSha256: string;
}

export function addTarget(
  descriptorOrPath: string | TargetDescriptor,
  options?: ControlPlaneOptions,
): TargetAddResult;

export function showTarget(targetId: string, options?: ControlPlaneOptions): TargetDescriptor;

export interface TargetInspectResult {
  readonly schemaVersion: 'snapback.target-inspect.v1';
  readonly ok: true;
  readonly operationId: string;
  readonly targetDescriptorSha256: string;
  readonly observation: TargetObservation;
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export function inspectTarget(targetId: string, options?: ControlPlaneOptions): TargetInspectResult;

export interface TargetDoctorResult {
  readonly schemaVersion: 'snapback.target-doctor.v1';
  readonly ok: boolean;
  readonly operationId: string;
  readonly targetId: string;
  readonly state: TargetLifecycleState;
  readonly credentialStatus: TargetCredentialStatus;
  readonly activationGeneration: number;
  readonly activeReleaseId: string | null;
  readonly capabilityGaps: readonly string[];
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export function doctorTarget(targetId: string, options?: ControlPlaneOptions): TargetDoctorResult;

// ---------------------------------------------------------------------------
// Authenticated logs and inspection
// ---------------------------------------------------------------------------

export interface RedactedLogField {
  readonly name: string;
  readonly value: string;
}

export interface ControlLogEntry {
  readonly timestampMs: number;
  readonly severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  readonly deploymentId: string;
  readonly releaseId: string | null;
  readonly activationGeneration: number;
  readonly streamIncarnation: string;
  readonly correlationId: string;
  readonly eventCode: string;
  readonly eventVersion: number;
  readonly payload: readonly RedactedLogField[];
}

export interface ControlLogPage {
  readonly entries: readonly ControlLogEntry[];
  readonly nextCursor: string | null;
  readonly retentionClass: string;
  readonly indexingClass: string;
  readonly deliveryLatencyMs: number;
  readonly droppedEvents: number;
  readonly backpressure: boolean;
}

export interface ControlLogsResult {
  readonly schemaVersion: 'snapback.control-logs.v1';
  readonly ok: true;
  readonly operationId: string;
  readonly remoteEvidence: boolean;
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observation: TargetObservation;
  readonly evidence: readonly AdapterEvidenceRef[];
  readonly logs: ControlLogPage;
}

export function queryControlLogs(
  targetId: string,
  options?: ControlPlaneOptions & AdapterQueryOptions,
): ControlLogsResult;

export interface InspectionFact {
  readonly name: string;
  readonly status: string;
  readonly valueSha256: string;
}

export interface ControlOperationSummary {
  readonly operationId: string;
  readonly kind: string;
  readonly outcome: string;
  readonly finishedAtMs: number;
  readonly receiptId: string;
}

export interface AuthenticatedInspection {
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly activeReleaseId: string | null;
  readonly inactiveReleaseIds: readonly string[];
  readonly activationGeneration: number;
  readonly schemaGeneration: number;
  readonly configGeneration: number;
  readonly authGeneration: number;
  readonly workerGeneration: number;
  readonly capabilityManifestSha256: string;
  readonly capabilityGaps: readonly string[];
  readonly health: readonly InspectionFact[];
  readonly dependencies: readonly InspectionFact[];
  readonly migration: readonly InspectionFact[];
  readonly backups: readonly InspectionFact[];
  readonly queues: readonly InspectionFact[];
  readonly connections: readonly InspectionFact[];
  readonly resources: readonly InspectionFact[];
  readonly operations: readonly ControlOperationSummary[];
  readonly diagnostics: readonly AdapterDiagnostic[];
}

export interface AuthenticatedInspectionResult {
  readonly schemaVersion: 'snapback.authenticated-inspection.v1';
  readonly ok: true;
  readonly operationId: string;
  readonly remoteEvidence: boolean;
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observation: TargetObservation;
  readonly evidence: readonly AdapterEvidenceRef[];
  readonly inspection: AuthenticatedInspection;
}

export function inspectTargetAdmin(
  targetId: string,
  options?: ControlPlaneOptions & AdapterQueryOptions,
): AuthenticatedInspectionResult;

// ---------------------------------------------------------------------------
// Control audit ledger
// ---------------------------------------------------------------------------

export interface ControlAuditVerification {
  readonly schemaVersion: 'snapback.control-audit-verification.v1';
  readonly ok: true;
  readonly events: number;
  readonly headEventId: string | null;
}

export function verifyControlAuditLedger(options?: ControlPlaneOptions): ControlAuditVerification;

// ---------------------------------------------------------------------------
// Remote drill planning
// ---------------------------------------------------------------------------

export interface RemoteDrillStorage {
  readonly computeClass: string;
  readonly persistentVolumeClass: string;
  readonly persistentVolumeEncrypted: true;
  readonly artifactStoreRef: string;
  readonly artifactStorageClass: string;
  readonly backupStoreRef: string;
  readonly backupStorageClass: string;
  readonly backupPermissionBoundary: 'separateWriteGrant';
}

export interface RemoteDrillPlan {
  readonly schemaVersion: 'snapback.remote-drill-plan.v1';
  readonly reason: string;
  readonly targetId: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly targetDescriptorSha256: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly driverSha256: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly storage: RemoteDrillStorage;
  readonly tls: Readonly<{
    issuer: string;
    automatedRenewal: true;
    independentlyAttestedOrigin: true;
  }>;
  readonly supervisor: Readonly<{
    kind: 'providerSupervisor' | 'systemd';
    restartEvidenceRequired: true;
    interruptionResumeRequired: true;
  }>;
  readonly logs: Readonly<{ sinkRef: string; retentionClass: string; redactionProfile: string }>;
  readonly credentials: Readonly<{
    controlCredentialRef: string;
    controlStateStoreRef: string;
    admissionKeyRef: string;
    replayFloorStoreRef: string;
  }>;
  readonly cost: Readonly<{
    currency: string;
    estimatedMonthlyMinorUnits: number;
    maximumMonthlyMinorUnits: number;
    estimateBasisSha256: string;
    includedComponents: readonly string[];
  }>;
  readonly nonclaims: readonly string[];
  readonly provisioningAuthority: 'confirmationRequired';
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly planId: string;
  readonly confirmation: string;
}

export function createRemoteDrillPlan(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly reason: string;
  readonly storage: RemoteDrillStorage;
  readonly tls: Readonly<{ issuer: string }>;
  readonly supervisor: Readonly<{ kind: 'providerSupervisor' | 'systemd' }>;
  readonly logs: Readonly<{ sinkRef: string; retentionClass: string; redactionProfile: string }>;
  readonly credentials: Readonly<{ admissionKeyRef: string; replayFloorStoreRef: string }>;
  readonly cost: Readonly<{
    currency: string;
    estimatedMonthlyMinorUnits: number;
    maximumMonthlyMinorUnits: number;
    estimateBasisSha256: string;
  }>;
}): RemoteDrillPlan;

export function verifyRemoteDrillPlan(planId: string, options: ControlPlaneOptions & {
  readonly confirmation: string;
  readonly targetId?: string;
}): RemoteDrillPlan;

// ---------------------------------------------------------------------------
// Hosted auth drill, adapter qualification, prepared releases
// ---------------------------------------------------------------------------

export interface HostedAuthLiveHealth {
  readonly admissionEpoch: number;
  readonly senderReplayEpochFloor: number;
  readonly senderReplayEpochFloorCurrent: true;
  readonly limiterReachable: true;
  readonly invalidationCurrent: true;
  readonly serializedAuthorityCurrent: true;
  readonly handlerCompatible: true;
  readonly servingAdmitted: true;
  readonly observedAtMs: number;
}

export interface HostedAuthDrillReceipt {
  readonly schemaVersion: 'snapback.hosted-auth-drill-receipt.v1';
  readonly receiptId: string;
  readonly targetId: string;
  readonly targetProfileId: string;
  readonly deploymentId: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly browserArtifactSha256: string;
  readonly admission: HostedAdmission;
  readonly liveHealth: HostedAuthLiveHealth;
  readonly evidence: readonly AdapterEvidenceRef[];
  readonly gaps: readonly ControlPlaneGap[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export function createHostedAuthDrillReceipt(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly browserArtifactSha256: string;
  readonly admission: HostedAdmission;
  readonly liveHealth: HostedAuthLiveHealth;
  readonly evidence: readonly AdapterEvidenceRef[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}): HostedAuthDrillReceipt;

export type QualificationClaim =
  | 'identityFencing'
  | 'immutableUploadReadBack'
  | 'tlsOrigin'
  | 'hostedAuth'
  | 'healthAcceptance'
  | 'logsInspection'
  | 'compatibilityRollback'
  | 'backupRestore'
  | 'interruptionResume'
  | 'secretScan'
  | 'costCapacity';

export interface AdapterQualificationManifest {
  readonly schemaVersion: 'snapback.adapter-qualification.v1';
  readonly qualificationId: string;
  readonly targetId: string;
  readonly targetProfileId: string;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly driverSha256: string;
  readonly provider: string;
  readonly accountFingerprint: string;
  readonly region: string;
  readonly publicOrigin: string;
  readonly remoteEvidence: true;
  readonly hostedAuthDrill: HostedAuthDrillReceipt;
  readonly claims: readonly Readonly<{
    claim: QualificationClaim;
    evidence: readonly AdapterEvidenceRef[];
  }>[];
  readonly gaps: readonly ControlPlaneGap[];
  readonly qualifiedAtMs: number;
}

export function createAdapterQualificationManifest(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly qualifiedAtMs: number;
  readonly hostedAuthDrill: HostedAuthDrillReceipt;
  readonly claimEvidence: Readonly<Record<QualificationClaim, readonly AdapterEvidenceRef[]>>;
}): AdapterQualificationManifest;

export type PreparedEvidenceKind =
  | 'runtimeArtifact'
  | 'serverArtifact'
  | 'artifactSignature'
  | 'licenseSbom'
  | 'buildProvenance'
  | 'compatibilityGenerations'
  | 'migrationPlan'
  | 'healthProbes'
  | 'acceptanceProbes'
  | 'configRequirements';

export interface ReleaseCompatibilityEnvelope {
  readonly minimumReadableSchemaGeneration: number;
  readonly maximumReadableSchemaGeneration: number;
  readonly writeSchemaGeneration: number;
  readonly minimumRetainedClientGeneration: number;
  readonly minimumJobGeneration: number;
  readonly minimumConfigGeneration: number;
  readonly migrationSha256: string;
  readonly migrationTransactional: boolean;
  readonly irreversibleBoundary: string | null;
  readonly rollbackMode: 'codeOnly' | 'forwardFix' | 'restoreRequired';
}

export interface PreparedReleaseManifest {
  readonly schemaVersion: 'snapback.prepared-release.v1';
  readonly preparedReleaseId: string;
  readonly baseReleaseId: string;
  readonly baseReleaseManifestSha256: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly targetProfileId: string;
  readonly adapterQualificationId: string;
  readonly adapterQualificationSha256: string;
  readonly compatibility: ReleaseCompatibilityEnvelope;
  readonly evidence: readonly Readonly<{
    kind: PreparedEvidenceKind;
    evidence: readonly AdapterEvidenceRef[];
  }>[];
  readonly gaps: readonly ControlPlaneGap[];
  readonly activationEligible: true;
  readonly preparedAtMs: number;
}

export function createPreparedReleaseManifest(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly releaseDirectory: string;
  readonly qualificationPath: string;
  readonly verifyRelease: ReleaseVerifier;
  readonly compatibility: ReleaseCompatibilityEnvelope;
  readonly releaseEvidence: Readonly<Record<PreparedEvidenceKind, readonly AdapterEvidenceRef[]>>;
  readonly preparedAtMs: number;
}): PreparedReleaseManifest;

export interface PreparedReleaseVerification {
  readonly schemaVersion: 'snapback.prepared-release-verification.v1';
  readonly ok: true;
  readonly preparedReleaseId: string;
  readonly preparedReleaseManifestSha256: string;
  readonly qualificationId: string;
  readonly qualificationManifestSha256: string;
  readonly baseReleaseId: string;
  readonly baseReleaseManifestSha256: string;
  readonly compatibility: ReleaseCompatibilityEnvelope;
  readonly activationEligible: true;
}

export function verifyPreparedReleaseArtifacts(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly releaseDirectory: string;
  readonly qualificationPath: string;
  readonly preparedReleasePath: string;
  readonly verifyRelease: ReleaseVerifier;
}): PreparedReleaseVerification;

// ---------------------------------------------------------------------------
// Deploy planning and apply
// ---------------------------------------------------------------------------

export interface DeployPlan {
  readonly artifactKind: 'deployPlan';
  readonly schemaVersion: 'snapback.deploy-plan.v1';
  readonly operationId: string;
  readonly reason: string;
  readonly targetId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observedActivationGeneration: number;
  readonly observedActiveReleaseId: string | null;
  readonly releaseId: string;
  readonly releaseManifestSha256: string;
  readonly preparedReleaseId: string | null;
  readonly preparedReleaseManifestSha256: string | null;
  readonly steps: readonly string[];
  readonly blockers: readonly ControlPlaneGap[];
  readonly applyEligible: boolean;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly planId: string;
  readonly confirmation: string;
}

export function createDeployPlan(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly reason: string;
  readonly releaseDirectory: string;
  readonly verifyRelease: ReleaseVerifier;
  readonly preparedReleasePath?: string;
  readonly qualificationPath?: string;
}): DeployPlan;

export interface DeployStepFact {
  readonly sequence: number;
  readonly operation: string;
  readonly state: string;
  readonly inputSha256: string;
  readonly outputSha256: string;
  readonly evidence: readonly AdapterEvidenceRef[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly idempotentReplay: boolean;
  readonly previousFactSha256: string | null;
  readonly factSha256: string;
}

export interface BackupComponent {
  readonly kind: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly objects: number;
  readonly verified: true;
}

export interface BackupManifest {
  readonly schemaVersion: 'snapback.backup-manifest.v1';
  readonly backupId: string;
  readonly operationId: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly releaseId: string | null;
  readonly schemaIdentitySha256: string;
  readonly encryptionClass: string;
  readonly storageClass: string;
  readonly retentionPolicy: string;
  readonly components: readonly BackupComponent[];
  readonly excludedSecretClasses: readonly string[];
  readonly createdAtMs: number;
  readonly verifiedAtMs: number;
}

export interface DeployReceipt {
  readonly schemaVersion: 'snapback.deploy-receipt.v1';
  readonly receiptId: string;
  readonly planId: string;
  readonly operationId: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly releaseId: string;
  readonly previousReleaseId: string | null;
  readonly activationGenerationBefore: number;
  readonly activationGenerationAfter: number;
  readonly outcome: 'activated' | 'rolledBack' | 'failed';
  readonly remoteEvidence: boolean;
  readonly adapterKind: string;
  readonly adapterVersion: string;
  readonly providerFactsSha256: string;
  readonly backup: BackupManifest | null;
  readonly steps: readonly DeployStepFact[];
  readonly gaps: readonly ControlPlaneGap[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export function applyDeployPlan(planId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly confirmation: string;
  readonly releaseDirectory: string;
  readonly verifyRelease: ReleaseVerifier;
  readonly preparedReleasePath?: string;
  readonly qualificationPath?: string;
}): DeployReceipt;

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

export interface BackupSummary {
  readonly backupId: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly releaseId: string | null;
  readonly components: number;
  readonly createdAtMs: number;
  readonly verifiedAtMs: number;
}

export interface BackupListResult {
  readonly schemaVersion: 'snapback.backup-list.v1';
  readonly ok: true;
  readonly targetId: string;
  readonly backups: readonly BackupSummary[];
}

export function listBackups(targetId: string, options?: ControlPlaneOptions): BackupListResult;

export interface BackupVerificationResult {
  readonly schemaVersion: 'snapback.backup-verification.v1';
  readonly ok: true;
  readonly backupId: string;
  readonly targetId: string;
  readonly manifestSha256: string;
  readonly componentCount: number;
  readonly componentBytes: number;
  readonly componentObjects: number;
  readonly adapterReadBackAttested: boolean;
  readonly excludedSecretClasses: readonly string[];
}

export function verifyBackupManifest(
  backupId: string,
  targetId: string,
  options?: ControlPlaneOptions,
): BackupVerificationResult;

export interface BackupPlan {
  readonly schemaVersion: 'snapback.backup-plan.v1';
  readonly planId: string;
  readonly operationId: string;
  readonly reason: string;
  readonly targetId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observedActivationGeneration: number;
  readonly observedActiveReleaseId: string | null;
  readonly observedSchemaGeneration: number;
  readonly retentionPolicy: string;
  readonly steps: readonly string[];
  readonly blockers: readonly ControlPlaneGap[];
  readonly applyEligible: boolean;
  readonly confirmation: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function createBackupPlan(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly reason: string;
  readonly retentionPolicy: string;
}): BackupPlan;

export interface RestoreResult {
  readonly backupId: string;
  readonly sourceTargetId: string;
  readonly sourceDeploymentId: string;
  readonly sourceDatabaseId: string;
  readonly sourceStreamIncarnation: string;
  readonly destinationTargetId: string;
  readonly destinationDeploymentId: string;
  readonly destinationDatabaseId: string;
  readonly destinationStreamIncarnation: string;
  readonly restoreEpoch: number;
  readonly effectsFenced: boolean;
  readonly componentsVerified: boolean;
  readonly applicationSentinelSha256: string;
  readonly acceptanceSha256: string;
  readonly externalEffectsDisabled: boolean;
  readonly activated: boolean;
}

export interface MaintenanceReceipt {
  readonly schemaVersion: 'snapback.maintenance-receipt.v1';
  readonly receiptId: string;
  readonly kind: 'backup' | 'codeOnlyRollback' | 'restore' | 'restoreActivation';
  readonly planId: string;
  readonly operationId: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly activationGenerationBefore: number;
  readonly activationGenerationAfter: number;
  readonly releaseIdBefore: string | null;
  readonly releaseIdAfter: string | null;
  readonly backupId: string | null;
  readonly restore: RestoreResult | null;
  readonly outcome: 'backedUp' | 'rolledBack' | 'restoredPaused' | 'restoreActivated';
  readonly remoteEvidence: boolean;
  readonly steps: readonly DeployStepFact[];
  readonly gaps: readonly ControlPlaneGap[];
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export function applyBackupPlan(planId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly confirmation: string;
  readonly backupWorkspace?: string;
}): MaintenanceReceipt;

// ---------------------------------------------------------------------------
// Code-only rollback
// ---------------------------------------------------------------------------

export interface RollbackPlan {
  readonly schemaVersion: 'snapback.rollback-plan.v1';
  readonly planId: string;
  readonly operationId: string;
  readonly reason: string;
  readonly targetId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observedActivationGeneration: number;
  readonly observedActiveReleaseId: string | null;
  readonly destinationReleaseId: string;
  readonly destinationPreparedReleaseId: string;
  readonly compatibilitySha256: string;
  readonly steps: readonly string[];
  readonly blockers: readonly ControlPlaneGap[];
  readonly applyEligible: boolean;
  readonly confirmation: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function createRollbackPlan(options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly reason: string;
  readonly destinationReleaseDirectory: string;
  readonly preparedReleasePath: string;
  readonly qualificationPath: string;
  readonly verifyRelease: ReleaseVerifier;
}): RollbackPlan;

export function applyRollbackPlan(planId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly confirmation: string;
  readonly destinationReleaseDirectory: string;
  readonly preparedReleasePath: string;
  readonly qualificationPath: string;
  readonly verifyRelease: ReleaseVerifier;
}): MaintenanceReceipt;

// ---------------------------------------------------------------------------
// Destructive restore and restore activation
// ---------------------------------------------------------------------------

export interface RestorePlan {
  readonly schemaVersion: 'snapback.restore-plan.v1';
  readonly planId: string;
  readonly operationId: string;
  readonly reason: string;
  readonly sourceTargetId: string;
  readonly backupId: string;
  readonly backupManifestSha256: string;
  readonly destinationTargetId: string;
  readonly projectId: string;
  readonly environmentId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetProfileId: string;
  readonly productionClass: 'preview' | 'production';
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observedActivationGeneration: number;
  readonly observedActiveReleaseId: string | null;
  readonly replacementReleaseId: string | null;
  readonly destinationSentinelSha256: string | null;
  readonly steps: readonly string[];
  readonly blockers: readonly ControlPlaneGap[];
  readonly applyEligible: boolean;
  readonly confirmation: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function createRestorePlan(options: ControlPlaneOptions & {
  readonly sourceTargetId: string;
  readonly destinationTargetId: string;
  readonly backupId: string;
  readonly reason: string;
  readonly replacementReleaseId?: string;
  readonly destinationSentinelSha256?: string;
}): RestorePlan;

export function applyRestorePlan(planId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly confirmation: string;
  readonly restoreWorkspace?: string;
}): MaintenanceReceipt;

export interface RestoreVerification {
  readonly schemaVersion: 'snapback.restore-verification.v1';
  readonly ok: true;
  readonly receiptId: string;
  readonly targetId: string;
  readonly backupId: string;
  readonly restoreEpoch: number;
  readonly componentsVerified: boolean;
  readonly applicationSentinelSha256: string;
  readonly acceptanceSha256: string;
  readonly effectsFenced: boolean;
  readonly externalEffectsDisabled: boolean;
  readonly activated: boolean;
  readonly remoteEvidence: boolean;
}

export function verifyRestoreReceipt(receiptId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
}): RestoreVerification;

export interface RestoreActivationPlan {
  readonly schemaVersion: 'snapback.restore-activation-plan.v1';
  readonly planId: string;
  readonly operationId: string;
  readonly reason: string;
  readonly restoreReceiptId: string;
  readonly backupId: string;
  readonly targetId: string;
  readonly deploymentId: string;
  readonly databaseId: string;
  readonly streamIncarnation: string;
  readonly targetDescriptorSha256: string;
  readonly targetObservationSha256: string;
  readonly observedActivationGeneration: number;
  readonly restoredReleaseId: string;
  readonly preparedReleaseId: string;
  readonly preparedReleaseManifestSha256: string;
  readonly adapterQualificationId: string;
  readonly adapterQualificationSha256: string;
  readonly applicationSentinelSha256: string;
  readonly steps: readonly string[];
  readonly blockers: readonly ControlPlaneGap[];
  readonly applyEligible: boolean;
  readonly confirmation: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

export function createRestoreActivationPlan(options: ControlPlaneOptions & {
  readonly restoreReceiptId: string;
  readonly targetId: string;
  readonly reason: string;
  readonly releaseDirectory: string;
  readonly preparedReleasePath: string;
  readonly qualificationPath: string;
  readonly verifyRelease: ReleaseVerifier;
}): RestoreActivationPlan;

export function applyRestoreActivationPlan(planId: string, options: ControlPlaneOptions & {
  readonly targetId: string;
  readonly confirmation: string;
  readonly releaseDirectory: string;
  readonly preparedReleasePath: string;
  readonly qualificationPath: string;
  readonly verifyRelease: ReleaseVerifier;
  readonly restoreWorkspace?: string;
}): MaintenanceReceipt;

// ---------------------------------------------------------------------------
// Test seam (deterministic harnesses; not part of the supported surface)
// ---------------------------------------------------------------------------

export const __deploymentTest: {
  canonicalJson(value: unknown): string;
  sha256(bytes: string | Uint8Array): string;
  readFileDescriptorSafeHarness(
    path: string,
    code: string,
    options?: {
      readonly maximumBytes?: number;
      readonly ownerOnly?: boolean;
      readonly ownerUid?: number | null;
    },
  ): Uint8Array;
  closedKeySchemaBindings: readonly Readonly<{
    name: string;
    keys: readonly string[];
    schemaFile: string;
    definition?: string;
  }>[];
  nonSchemaKeySets: readonly string[];
  createBackupPlanHarness(options?: Parameters<typeof createBackupPlan>[0]): BackupPlan;
  applyBackupPlanHarness(
    planId: string,
    options?: Parameters<typeof applyBackupPlan>[1],
  ): MaintenanceReceipt;
  createRollbackPlanHarness(options?: Parameters<typeof createRollbackPlan>[0]): RollbackPlan;
  applyRollbackPlanHarness(
    planId: string,
    options?: Parameters<typeof applyRollbackPlan>[1],
  ): MaintenanceReceipt;
  createRestorePlanHarness(options?: Parameters<typeof createRestorePlan>[0]): RestorePlan;
  applyRestorePlanHarness(
    planId: string,
    options?: Parameters<typeof applyRestorePlan>[1],
  ): MaintenanceReceipt;
  createRestoreActivationPlanHarness(
    options?: Parameters<typeof createRestoreActivationPlan>[0],
  ): RestoreActivationPlan;
  applyRestoreActivationPlanHarness(
    planId: string,
    options?: Parameters<typeof applyRestoreActivationPlan>[1],
  ): MaintenanceReceipt;
  logsHarness(
    targetId: string,
    options?: ControlPlaneOptions & AdapterQueryOptions,
  ): ControlLogsResult;
  inspectAdminHarness(
    targetId: string,
    options?: ControlPlaneOptions & AdapterQueryOptions,
  ): AuthenticatedInspectionResult;
  applyHarness(
    planId: string,
    options?: Parameters<typeof applyDeployPlan>[1] & {
      readonly simulateInterruptionAfter?: string;
    },
  ): DeployReceipt;
};
