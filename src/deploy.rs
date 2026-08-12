//! Target-neutral release artifacts for the trusted single-tenant control
//! plane.  The package CLI produces this shape before any adapter is allowed
//! to upload, activate, roll back, or restore a deployment.
//!
//! @ref LLP 0072#release-artifact — a release binds source, toolchain,
//! compatibility, target requirements, immutable component digests, scans,
//! and explicit GAPs.
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types own the
//! shared artifact shape; committed JSON Schema is generated from this file.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ReleaseArtifactKind {
    #[serde(rename = "releaseManifest")]
    ReleaseManifest,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ReleaseManifestVersion {
    #[serde(rename = "snapback.release-manifest.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseSource {
    pub repository_name: String,
    pub revision: String,
    pub source_date_epoch: u64,
    pub dirty: bool,
    pub dirty_paths_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseToolchain {
    pub snapback_cli_version: String,
    pub node_version: String,
    pub package_manager: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseCompatibility {
    pub schema_version: String,
    pub auth_mode: String,
    pub schema_sha256: String,
    pub functions_sha256: String,
    pub capability_sha256: String,
    pub inputs_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseComponent {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseGap {
    pub id: String,
    pub reason: String,
    pub blocking: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseScan {
    pub secret_scan: String,
    pub source_maps: String,
    pub symlinks: String,
    pub scanned_files: u64,
    pub scanned_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseManifest {
    pub artifact_kind: ReleaseArtifactKind,
    pub schema_version: ReleaseManifestVersion,
    pub release_id: String,
    pub project_id: String,
    pub target_profile_id: String,
    pub activation_eligible: bool,
    pub source: ReleaseSource,
    pub toolchain: ReleaseToolchain,
    pub compatibility: ReleaseCompatibility,
    pub required_capabilities: Vec<String>,
    pub components: Vec<ReleaseComponent>,
    pub scan: ReleaseScan,
    pub gaps: Vec<ReleaseGap>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum VmAdapterKind {
    #[serde(rename = "singleInstanceContainerVm")]
    SingleInstanceContainerVm,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum TargetDescriptorVersion {
    #[serde(rename = "snapback.target-descriptor.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TargetProductionClass {
    Preview,
    Production,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VmAdapterDescriptor {
    pub kind: VmAdapterKind,
    pub version: String,
    pub driver_path: String,
    pub driver_sha256: String,
    pub provider: String,
    pub account_fingerprint: String,
    pub region: String,
    pub public_origin: String,
    pub credential_ref: String,
    pub state_store_ref: String,
}

/// Owner-only local registration of one never-reused hosted target.
/// Credential values are deliberately absent; `credential_ref` identifies an
/// OS/provider secret-store handle resolved by the adapter process.
///
/// @ref LLP 0072#identities-and-objects — every operation binds exact target,
/// environment, deployment, database, stream, profile, and adapter identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetDescriptor {
    pub schema_version: TargetDescriptorVersion,
    pub target_id: String,
    pub project_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub adapter: VmAdapterDescriptor,
    pub created_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum RemoteDrillPlanVersion {
    #[serde(rename = "snapback.remote-drill-plan.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDrillSupervisorKind {
    ProviderSupervisor,
    Systemd,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDrillProvisioningAuthority {
    ConfirmationRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDrillCostComponent {
    Compute,
    PersistentVolume,
    ObjectStorage,
    Logs,
    Dns,
    Tls,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RemoteDrillNonclaim {
    HighAvailability,
    Autoscaling,
    MultiRegion,
    ZeroDowntime,
    UntrustedMultiTenancy,
    ManagedServiceSla,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillStorage {
    pub compute_class: String,
    pub persistent_volume_class: String,
    pub persistent_volume_encrypted: bool,
    pub artifact_store_ref: String,
    pub artifact_storage_class: String,
    pub backup_store_ref: String,
    pub backup_storage_class: String,
    pub backup_permission_boundary: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillTls {
    pub issuer: String,
    pub automated_renewal: bool,
    pub independently_attested_origin: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillSupervisor {
    pub kind: RemoteDrillSupervisorKind,
    pub restart_evidence_required: bool,
    pub interruption_resume_required: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillLogs {
    pub sink_ref: String,
    pub retention_class: String,
    pub redaction_profile: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillCredentials {
    pub control_credential_ref: String,
    pub control_state_store_ref: String,
    pub admission_key_ref: String,
    pub replay_floor_store_ref: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillCostBoundary {
    pub currency: String,
    pub estimated_monthly_minor_units: u64,
    pub maximum_monthly_minor_units: u64,
    pub estimate_basis_sha256: String,
    pub included_components: Vec<RemoteDrillCostComponent>,
}

/// Content-addressed, confirmation-fenced selection of every provider-specific
/// input LLP 0072 requires before the first remote drill may provision
/// anything. It carries handles and cost bounds, never credential values.
///
/// @ref LLP 0072#adapter-contract-and-first-profile — provider, account,
/// region, stores, TLS, supervisor, logs, credentials, cost, and nonclaims are
/// execution facts with no portable or ambient defaults.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteDrillPlan {
    pub schema_version: RemoteDrillPlanVersion,
    pub plan_id: String,
    pub reason: String,
    pub target_id: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub target_descriptor_sha256: String,
    pub adapter_kind: VmAdapterKind,
    pub adapter_version: String,
    pub driver_sha256: String,
    pub provider: String,
    pub account_fingerprint: String,
    pub region: String,
    pub public_origin: String,
    pub storage: RemoteDrillStorage,
    pub tls: RemoteDrillTls,
    pub supervisor: RemoteDrillSupervisor,
    pub logs: RemoteDrillLogs,
    pub credentials: RemoteDrillCredentials,
    pub cost: RemoteDrillCostBoundary,
    pub nonclaims: Vec<RemoteDrillNonclaim>,
    pub provisioning_authority: RemoteDrillProvisioningAuthority,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DeploymentState {
    Registered,
    Provisioning,
    Inactive,
    Staging,
    Ready,
    Active,
    Degraded,
    Draining,
    Failed,
    Restoring,
    Retired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CredentialStatus {
    Ready,
    Missing,
    Invalid,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterOperation {
    #[serde(rename = "doctor")]
    Doctor,
    #[serde(rename = "inspect")]
    Inspect,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterRequestVersion {
    #[serde(rename = "snapback.vm-adapter-request.v1")]
    V1,
}

/// Secret-free request sent to the adapter over stdin. Nothing credential
/// bearing is placed in argv or the environment by the control-plane CLI.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterRequest {
    pub schema_version: AdapterRequestVersion,
    pub operation: AdapterOperation,
    pub operation_id: String,
    pub target: TargetDescriptor,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterSafeDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetObservation {
    pub target_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub provider: String,
    pub account_fingerprint: String,
    pub region: String,
    pub public_origin: String,
    pub resource_id: String,
    pub state: DeploymentState,
    pub activation_generation: u64,
    pub active_release_id: Option<String>,
    pub application_sentinel_sha256: Option<String>,
    pub credential_status: CredentialStatus,
    pub provider_facts_sha256: String,
    pub observed_at_ms: u64,
    pub capability_gaps: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterResponseVersion {
    #[serde(rename = "snapback.vm-adapter-response.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterResponse {
    pub schema_version: AdapterResponseVersion,
    pub operation: AdapterOperation,
    pub operation_id: String,
    pub ok: bool,
    pub observation: Option<TargetObservation>,
    pub diagnostics: Vec<AdapterSafeDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AdapterLifecycleOperation {
    AcquireLease,
    UploadImmutableRelease,
    ProvisionInactive,
    CompatibilityPreflight,
    CreateVerifiedBackup,
    StageRelease,
    ActivateGeneration,
    VerifyServedPath,
    Rollback,
    FenceExternalEffects,
    RestoreBackupInactive,
    VerifyRestoredComponents,
    VerifyRestoredApplication,
    ActivateRestoredGeneration,
    ReleaseLease,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterLifecycleRequestVersion {
    #[serde(rename = "snapback.vm-adapter-lifecycle-request.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterLifecycleResponseVersion {
    #[serde(rename = "snapback.vm-adapter-lifecycle-response.v1")]
    V1,
}

/// Provider-enforced lease over one deployment mutation train. The lease id is
/// an opaque fence, not a credential; provider credentials remain behind the
/// descriptor's external secret-store handle.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentLease {
    pub lease_id: String,
    pub target_id: String,
    pub operation_id: String,
    pub expected_activation_generation: u64,
    pub acquired_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterEvidenceRef {
    pub kind: String,
    pub uri: String,
    pub sha256: String,
    pub bytes: u64,
    pub verified: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupComponent {
    pub kind: String,
    pub sha256: String,
    pub bytes: u64,
    pub objects: u64,
    pub verified: bool,
}

/// Secret-free, read-back-verified backup identity. Required secret names and
/// generations may be recorded by a later prepared-release artifact, but
/// credential values and control-plane handles never enter this manifest.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupManifest {
    pub schema_version: String,
    pub backup_id: String,
    pub operation_id: String,
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub release_id: Option<String>,
    pub schema_identity_sha256: String,
    pub encryption_class: String,
    pub storage_class: String,
    pub retention_policy: String,
    pub components: Vec<BackupComponent>,
    pub excluded_secret_classes: Vec<String>,
    pub created_at_ms: u64,
    pub verified_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum BackupPlanStep {
    VerifyIdentity,
    AcquireLease,
    CreateVerifiedBackup,
    ReleaseLease,
}

/// Exact proposal for creating and read-back-verifying one immutable backup.
///
/// @ref LLP 0072#backup-and-restore — backup identity, consistency, component
/// verification, secret exclusion, and retention are explicit control facts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupPlan {
    pub schema_version: String,
    pub plan_id: String,
    pub operation_id: String,
    pub reason: String,
    pub target_id: String,
    pub project_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub target_descriptor_sha256: String,
    pub target_observation_sha256: String,
    pub observed_activation_generation: u64,
    pub observed_active_release_id: String,
    pub observed_schema_generation: u64,
    pub retention_policy: String,
    pub steps: Vec<BackupPlanStep>,
    pub blockers: Vec<ReleaseGap>,
    pub apply_eligible: bool,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RollbackPlanStep {
    VerifyIdentity,
    AcquireLease,
    VerifyCompatibility,
    Rollback,
    VerifyServedPath,
    ReleaseLease,
}

/// Exact, content-addressed proposal for switching code and traffic to a
/// previously prepared compatible release without rewinding application data.
///
/// @ref LLP 0072#migrations-and-rollback — code-only rollback is distinct
/// from destructive data restore and must retain its compatibility proof.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RollbackPlan {
    pub schema_version: String,
    pub plan_id: String,
    pub operation_id: String,
    pub reason: String,
    pub target_id: String,
    pub project_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub target_descriptor_sha256: String,
    pub target_observation_sha256: String,
    pub observed_activation_generation: u64,
    pub observed_active_release_id: String,
    pub destination_release_id: String,
    pub destination_prepared_release_id: String,
    pub compatibility_sha256: String,
    pub steps: Vec<RollbackPlanStep>,
    pub blockers: Vec<ReleaseGap>,
    pub apply_eligible: bool,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RestorePlanStep {
    VerifyIdentity,
    AcquireLease,
    FenceExternalEffects,
    RestoreBackupInactive,
    VerifyRestoredComponents,
    VerifyRestoredApplication,
    ReleaseLease,
}

/// Destructive restore proposal. Restore and activation are deliberately
/// separate artifacts: a successful apply leaves the destination inactive and
/// all external effects fenced until an explicit activation consumes its
/// receipt.
///
/// @ref LLP 0072#backup-and-restore — source backup, exact destination,
/// replacement sentinel, effect fence, verification, and later activation are
/// independent must-understand facts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestorePlan {
    pub schema_version: String,
    pub plan_id: String,
    pub operation_id: String,
    pub reason: String,
    pub source_target_id: String,
    pub backup_id: String,
    pub backup_manifest_sha256: String,
    pub destination_target_id: String,
    pub project_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub target_descriptor_sha256: String,
    pub target_observation_sha256: String,
    pub observed_activation_generation: u64,
    pub observed_active_release_id: Option<String>,
    pub replacement_release_id: Option<String>,
    pub destination_sentinel_sha256: Option<String>,
    pub steps: Vec<RestorePlanStep>,
    pub blockers: Vec<ReleaseGap>,
    pub apply_eligible: bool,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RestoreActivationPlanStep {
    VerifyIdentity,
    VerifyPausedRestore,
    AcquireLease,
    ActivateRestoredGeneration,
    VerifyServedPath,
    ReleaseLease,
}

/// Explicit second-stage activation of one verified, effects-fenced restore.
/// It binds the paused restore receipt and a fresh destination observation,
/// giving activation its own operation id, lease, expiry, and confirmation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreActivationPlan {
    pub schema_version: String,
    pub plan_id: String,
    pub operation_id: String,
    pub reason: String,
    pub restore_receipt_id: String,
    pub backup_id: String,
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_descriptor_sha256: String,
    pub target_observation_sha256: String,
    pub observed_activation_generation: u64,
    pub restored_release_id: Option<String>,
    pub prepared_release_id: String,
    pub prepared_release_manifest_sha256: String,
    pub adapter_qualification_id: String,
    pub adapter_qualification_sha256: String,
    pub application_sentinel_sha256: String,
    pub steps: Vec<RestoreActivationPlanStep>,
    pub blockers: Vec<ReleaseGap>,
    pub apply_eligible: bool,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum AdapterOperationPlan {
    Deploy(DeployPlan),
    Backup(BackupPlan),
    Rollback(RollbackPlan),
    Restore(RestorePlan),
    RestoreActivation(RestoreActivationPlan),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ControlAuditAuthorityClass {
    LocalOperator,
    AutomationGrant,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ControlAuditOutcome {
    Began,
    Succeeded,
    Failed,
    Read,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlAuditField {
    pub name: String,
    pub value: String,
}

/// Secret-free append-only control-operation fact. The local ledger detects
/// loss or modification; it deliberately does not claim independence from the
/// operator who owns the control store.
///
/// @ref LLP 0071#audit-ledger — privileged control actions carry exact actor,
/// target, request, redacted payload, retention, and hash-chain identities.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlAuditEvent {
    pub schema_version: String,
    pub event_id: String,
    pub sequence: u64,
    pub event_type: String,
    pub event_version: u32,
    pub outcome: ControlAuditOutcome,
    pub actor_authority: ControlAuditAuthorityClass,
    pub actor_id: String,
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub operation_id: String,
    pub plan_id: Option<String>,
    pub receipt_id: Option<String>,
    pub reason_code: String,
    pub payload: Vec<ControlAuditField>,
    pub retention_class: String,
    pub recorded_at_ms: u64,
    pub previous_event_id: Option<String>,
}

/// One closed, secret-free mutating adapter call. The control CLI supplies the
/// complete retained plan on stdin; no target selector, release id, or
/// credential is inferred from argv or ambient variables.
///
/// @ref LLP 0072#deployment-state-machine — every step is idempotent under the
/// operation id, lease-fenced, generation-compared, and digest-recorded.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterLifecycleRequest {
    pub schema_version: AdapterLifecycleRequestVersion,
    pub operation: AdapterLifecycleOperation,
    pub operation_id: String,
    pub attempt: u32,
    pub target: TargetDescriptor,
    pub plan: AdapterOperationPlan,
    pub release_directory: String,
    pub lease: Option<DeploymentLease>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterLifecycleResponse {
    pub schema_version: AdapterLifecycleResponseVersion,
    pub operation: AdapterLifecycleOperation,
    pub operation_id: String,
    pub ok: bool,
    pub idempotent_replay: bool,
    pub remote_evidence: bool,
    pub input_sha256: String,
    pub output_sha256: String,
    pub lease: Option<DeploymentLease>,
    pub observation: Option<TargetObservation>,
    pub evidence: Vec<AdapterEvidenceRef>,
    pub backup: Option<BackupManifest>,
    pub restore: Option<RestoreResult>,
    pub diagnostics: Vec<AdapterSafeDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DeployStepState {
    Completed,
    RolledBack,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeployStepReceipt {
    pub sequence: u32,
    pub operation: AdapterLifecycleOperation,
    pub state: DeployStepState,
    pub input_sha256: String,
    pub output_sha256: String,
    pub evidence: Vec<AdapterEvidenceRef>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
    pub idempotent_replay: bool,
    pub previous_fact_sha256: Option<String>,
    pub fact_sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DeployReceiptOutcome {
    Activated,
    RolledBack,
    Failed,
}

/// Final bounded control-plane receipt. `remote_evidence` is an explicit claim
/// bit: deterministic/local harnesses must leave it false, so their success
/// cannot be confused with LLP 0072 hosted-profile evidence.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeployReceipt {
    pub schema_version: String,
    pub receipt_id: String,
    pub plan_id: String,
    pub operation_id: String,
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub release_id: String,
    pub previous_release_id: Option<String>,
    pub activation_generation_before: u64,
    pub activation_generation_after: u64,
    pub outcome: DeployReceiptOutcome,
    pub remote_evidence: bool,
    pub adapter_kind: VmAdapterKind,
    pub adapter_version: String,
    pub provider_facts_sha256: String,
    pub backup: Option<BackupManifest>,
    pub steps: Vec<DeployStepReceipt>,
    pub gaps: Vec<ReleaseGap>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreResult {
    pub backup_id: String,
    pub source_target_id: String,
    pub source_deployment_id: String,
    pub source_database_id: String,
    pub source_stream_incarnation: String,
    pub destination_target_id: String,
    pub destination_deployment_id: String,
    pub destination_database_id: String,
    pub destination_stream_incarnation: String,
    pub restore_epoch: u64,
    pub effects_fenced: bool,
    pub components_verified: bool,
    pub application_sentinel_sha256: String,
    pub acceptance_sha256: String,
    pub external_effects_disabled: bool,
    pub activated: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MaintenanceReceiptKind {
    CodeOnlyRollback,
    Restore,
    RestoreActivation,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MaintenanceReceiptOutcome {
    RolledBack,
    RestoredPaused,
    RestoreActivated,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintenanceReceipt {
    pub schema_version: String,
    pub receipt_id: String,
    pub kind: MaintenanceReceiptKind,
    pub plan_id: String,
    pub operation_id: String,
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub activation_generation_before: u64,
    pub activation_generation_after: u64,
    pub release_id_before: Option<String>,
    pub release_id_after: Option<String>,
    pub backup_id: Option<String>,
    pub restore: Option<RestoreResult>,
    pub outcome: MaintenanceReceiptOutcome,
    pub remote_evidence: bool,
    pub steps: Vec<DeployStepReceipt>,
    pub gaps: Vec<ReleaseGap>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AdapterQueryOperation {
    Logs,
    InspectAdmin,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterQueryRequestVersion {
    #[serde(rename = "snapback.vm-adapter-query-request.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterQuery {
    pub since_ms: u64,
    pub until_ms: u64,
    pub limit: u32,
    pub cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterQueryRequest {
    pub schema_version: AdapterQueryRequestVersion,
    pub operation: AdapterQueryOperation,
    pub operation_id: String,
    pub target: TargetDescriptor,
    pub query: AdapterQuery,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RedactedLogField {
    pub name: String,
    pub value: String,
}

/// Bounded structured application/control-plane event. Payload fields are
/// scalar and redacted; arbitrary JSON, request bodies, and query results are
/// structurally unavailable in this protocol.
///
/// @ref LLP 0072#logs-metrics-and-inspection — default logs bind deployment
/// identity and correlation while rejecting private or credential payloads.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlLogEntry {
    pub timestamp_ms: u64,
    pub severity: String,
    pub deployment_id: String,
    pub release_id: Option<String>,
    pub activation_generation: u64,
    pub stream_incarnation: String,
    pub correlation_id: String,
    pub event_code: String,
    pub event_version: u32,
    pub payload: Vec<RedactedLogField>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlLogPage {
    pub entries: Vec<ControlLogEntry>,
    pub next_cursor: Option<String>,
    pub retention_class: String,
    pub indexing_class: String,
    pub delivery_latency_ms: u64,
    pub dropped_events: u64,
    pub backpressure: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectionFact {
    pub name: String,
    pub status: String,
    pub value_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlOperationSummary {
    pub operation_id: String,
    pub kind: String,
    pub outcome: String,
    pub finished_at_ms: u64,
    pub receipt_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthenticatedInspection {
    pub target_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub active_release_id: Option<String>,
    pub inactive_release_ids: Vec<String>,
    pub activation_generation: u64,
    pub schema_generation: u64,
    pub config_generation: u64,
    pub auth_generation: u64,
    pub worker_generation: u64,
    pub capability_manifest_sha256: String,
    pub capability_gaps: Vec<String>,
    pub health: Vec<InspectionFact>,
    pub dependencies: Vec<InspectionFact>,
    pub migration: Vec<InspectionFact>,
    pub backups: Vec<InspectionFact>,
    pub queues: Vec<InspectionFact>,
    pub connections: Vec<InspectionFact>,
    pub resources: Vec<InspectionFact>,
    pub operations: Vec<ControlOperationSummary>,
    pub diagnostics: Vec<AdapterSafeDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterQueryResponseVersion {
    #[serde(rename = "snapback.vm-adapter-query-response.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterQueryResponse {
    pub schema_version: AdapterQueryResponseVersion,
    pub operation: AdapterQueryOperation,
    pub operation_id: String,
    pub ok: bool,
    pub remote_evidence: bool,
    pub input_sha256: String,
    pub output_sha256: String,
    pub observation: Option<TargetObservation>,
    pub logs: Option<ControlLogPage>,
    pub inspection: Option<AuthenticatedInspection>,
    pub evidence: Vec<AdapterEvidenceRef>,
    pub diagnostics: Vec<AdapterSafeDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AdapterQualificationClaim {
    IdentityFencing,
    ImmutableUploadReadBack,
    TlsOrigin,
    HostedAuth,
    HealthAcceptance,
    LogsInspection,
    CompatibilityRollback,
    BackupRestore,
    InterruptionResume,
    SecretScan,
    CostCapacity,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterQualificationEvidence {
    pub claim: AdapterQualificationClaim,
    pub evidence: Vec<AdapterEvidenceRef>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAuthLiveHealth {
    pub admission_epoch: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub sender_replay_epoch_floor: u64,
    pub sender_replay_epoch_floor_current: bool,
    pub limiter_reachable: bool,
    pub invalidation_current: bool,
    pub serialized_authority_current: bool,
    pub handler_compatible: bool,
    pub serving_admitted: bool,
    pub observed_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ExternalReplayFloorAdvanceVersion {
    #[serde(rename = "snapback.external-replay-floor-advance.v1")]
    V1,
}

/// Content-addressed result of the concrete adapter's atomic advancement of
/// the rollback-external sender replay floor. The receipt identifies the
/// external store operation; adapter qualification separately proves that the
/// store is remote and outside the application backup set.
///
/// @ref LLP 0077#author-decisions--2026-07-23 — a dedicated monotone
/// control-plane counter supplies the anti-rollback floor.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExternalReplayFloorAdvanceReceipt {
    pub schema_version: ExternalReplayFloorAdvanceVersion,
    pub operation_id: String,
    pub deployment_id: String,
    pub store_identity_sha256: String,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub previous_floor: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub sender_replay_epoch_floor: u64,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub advanced_at_ms: u64,
    pub receipt_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HostedAdmissionProjectionVersion {
    #[serde(rename = "snapback.hosted-admission-projection.v1")]
    V1,
}

/// Non-secret result of projecting one fresh hosted boot authority. The key
/// bytes and file paths are intentionally absent; the exact authenticated
/// envelope and external-floor receipt remain content-addressed.
///
/// @ref LLP 0072#implemented-target-and-plan-slice — the adapter advances the
/// external floor before writing strict owner-only boot projections.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAdmissionProjectionReceipt {
    pub schema_version: HostedAdmissionProjectionVersion,
    pub operation_id: String,
    pub deployment_id: String,
    pub public_origin: String,
    pub key_id: String,
    pub browser_artifact_sha256: String,
    pub configuration_sha256: String,
    pub support_sha256: String,
    pub handler_protocol_version: u64,
    pub handler_incarnation: String,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub sender_replay_epoch_floor: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub admission_epoch: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub limiter_epoch: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub invalidation_epoch: u64,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub issued_at_ms: u64,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub expires_at_ms: u64,
    pub external_floor_store_identity_sha256: String,
    pub external_floor_advance_receipt_id: String,
    pub envelope_sha256: String,
    pub key_projection_created: bool,
    pub remote_evidence: bool,
    pub projection_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HostedAdmissionRefreshVersion {
    #[serde(rename = "snapback.hosted-admission-refresh.v1")]
    V1,
}

/// Non-secret result of atomically refreshing the authenticated envelope for
/// one already-reconciled boot. Deployment, handler, support, configuration,
/// and external floor remain immutable across this transition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAdmissionRefreshReceipt {
    pub schema_version: HostedAdmissionRefreshVersion,
    pub deployment_id: String,
    pub public_origin: String,
    pub key_id: String,
    pub configuration_sha256: String,
    pub support_sha256: String,
    pub handler_protocol_version: u64,
    pub handler_incarnation: String,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub sender_replay_epoch_floor: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub admission_epoch: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub limiter_epoch: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub invalidation_epoch: u64,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub issued_at_ms: u64,
    #[schemars(range(min = 0_i64, max = 9007199254740991_i64))]
    pub expires_at_ms: u64,
    pub envelope_sha256: String,
    pub remote_evidence: bool,
    pub refresh_id: String,
}

/// Executed hosted-auth drill bound to one target and one short-lived
/// deployment admission. This proves qualification-time behavior only; an
/// activation must still obtain a fresh admission and live-health snapshot.
///
/// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — static support,
/// deployment attestation, live health, browser-seam exclusion, handler
/// compatibility, and operator isolation are independent positive facts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAuthDrillReceipt {
    pub schema_version: String,
    pub receipt_id: String,
    pub target_id: String,
    pub target_profile_id: String,
    pub deployment_id: String,
    pub provider: String,
    pub account_fingerprint: String,
    pub region: String,
    pub public_origin: String,
    pub browser_artifact_sha256: String,
    pub admission: crate::auth::deployment::HostedAdmission,
    pub live_health: HostedAuthLiveHealth,
    pub evidence: Vec<AdapterEvidenceRef>,
    pub gaps: Vec<ReleaseGap>,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
}

/// Target-specific result of the complete remote adapter drill. This cannot be
/// minted by release build: it binds provider/account/region/origin, driver
/// bytes, remote evidence for every qualification claim, and every remaining
/// GAP.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterQualificationManifest {
    pub schema_version: String,
    pub qualification_id: String,
    pub target_id: String,
    pub target_profile_id: String,
    pub adapter_kind: VmAdapterKind,
    pub adapter_version: String,
    pub driver_sha256: String,
    pub provider: String,
    pub account_fingerprint: String,
    pub region: String,
    pub public_origin: String,
    pub remote_evidence: bool,
    pub hosted_auth_drill: HostedAuthDrillReceipt,
    pub claims: Vec<AdapterQualificationEvidence>,
    pub gaps: Vec<ReleaseGap>,
    pub qualified_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PreparedReleaseEvidenceKind {
    RuntimeArtifact,
    ServerArtifact,
    ArtifactSignature,
    LicenseSbom,
    BuildProvenance,
    CompatibilityGenerations,
    MigrationPlan,
    HealthProbes,
    AcceptanceProbes,
    ConfigRequirements,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedReleaseEvidence {
    pub kind: PreparedReleaseEvidenceKind,
    pub evidence: Vec<AdapterEvidenceRef>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RollbackMode {
    CodeOnly,
    ForwardFix,
    RestoreRequired,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReleaseCompatibilityEnvelope {
    pub minimum_readable_schema_generation: u64,
    pub maximum_readable_schema_generation: u64,
    pub write_schema_generation: u64,
    pub minimum_retained_client_generation: u64,
    pub minimum_job_generation: u64,
    pub minimum_config_generation: u64,
    pub migration_sha256: String,
    pub migration_transactional: bool,
    pub irreversible_boundary: Option<String>,
    pub rollback_mode: RollbackMode,
}

/// Target-bound augmentation of one immutable base release. Production apply
/// consumes this artifact, never a caller-supplied boolean, to decide whether
/// all release-specific and previously drilled adapter obligations are met.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedReleaseManifest {
    pub schema_version: String,
    pub prepared_release_id: String,
    pub base_release_id: String,
    pub base_release_manifest_sha256: String,
    pub project_id: String,
    pub target_id: String,
    pub target_profile_id: String,
    pub adapter_qualification_id: String,
    pub adapter_qualification_sha256: String,
    pub compatibility: ReleaseCompatibilityEnvelope,
    pub evidence: Vec<PreparedReleaseEvidence>,
    pub gaps: Vec<ReleaseGap>,
    pub activation_eligible: bool,
    pub prepared_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum DeployPlanArtifactKind {
    #[serde(rename = "deployPlan")]
    DeployPlan,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum DeployPlanVersion {
    #[serde(rename = "snapback.deploy-plan.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DeployPlanStep {
    VerifyIdentity,
    AcquireLease,
    UploadImmutableRelease,
    ProvisionInactive,
    CompatibilityPreflight,
    CreateVerifiedBackup,
    StageRelease,
    ActivateGeneration,
    VerifyServedPath,
    ReleaseLease,
    RollbackOnFailure,
}

/// Content-addressed, non-mutating deployment proposal. `apply_eligible` is a
/// derived fact; a plan retaining any blocker cannot be applied.
///
/// @ref LLP 0072#cli-and-automation-contract — production and destructive
/// operations consume an immutable plan digest and exact confirmation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeployPlan {
    pub artifact_kind: DeployPlanArtifactKind,
    pub schema_version: DeployPlanVersion,
    pub plan_id: String,
    pub operation_id: String,
    pub reason: String,
    pub target_id: String,
    pub project_id: String,
    pub environment_id: String,
    pub deployment_id: String,
    pub database_id: String,
    pub stream_incarnation: String,
    pub target_profile_id: String,
    pub production_class: TargetProductionClass,
    pub target_descriptor_sha256: String,
    pub target_observation_sha256: String,
    pub observed_activation_generation: u64,
    pub observed_active_release_id: Option<String>,
    pub release_id: String,
    pub release_manifest_sha256: String,
    pub prepared_release_id: Option<String>,
    pub prepared_release_manifest_sha256: Option<String>,
    pub steps: Vec<DeployPlanStep>,
    pub blockers: Vec<ReleaseGap>,
    pub apply_eligible: bool,
    pub confirmation: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

// --- Hosted Fly v2 control-plane carriers ---------------------------------
//
// These shapes are deliberately defined in Rust even though the first
// supervisor implementation is JavaScript. LLP 0037 makes Rust the authority
// for every shared Snapback artifact and the generated schemas are consumed by
// the supervisor and provider-driver conformance tests.

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FlyTargetBindingVersion {
    #[serde(rename = "snapback.fly-target-binding.v2")]
    V2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlyCredentialBindingV2 {
    pub role: String,
    pub credential_ref: String,
    pub fingerprint: String,
    pub allowed_verbs: Vec<String>,
    pub resource_prefixes: Vec<String>,
}

/// Closed, generation-fenced binding for one Fly target.
///
/// @ref LLP 0111#expiring-routed-machine-authority — effect-time discovery is
/// forbidden; the control plane pins the complete roster, routes, storage,
/// certificate posture, supervisor, and separated credential roles.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlyTargetBindingV2 {
    pub schema_version: FlyTargetBindingVersion,
    pub target_id: String,
    pub binding_generation: u64,
    pub predecessor_binding_sha256: Option<String>,
    pub organization_id: String,
    pub app_id: String,
    pub region: String,
    pub public_origin: String,
    pub active_machine_id: String,
    pub machine_roster: Vec<String>,
    pub routed_machine_ids: Vec<String>,
    pub service_process_groups: Vec<String>,
    pub autostop_enabled: bool,
    pub autostart_enabled: bool,
    pub autoscale_enabled: bool,
    pub volume_id: String,
    pub oci_repository: String,
    pub oci_digest: String,
    pub tigris_bucket: String,
    pub artifact_prefix: String,
    pub backup_prefix: String,
    pub control_state_prefix: String,
    pub audit_prefix: String,
    pub log_prefix: String,
    pub cleanup_prefix: String,
    pub tls_issuer: String,
    pub certificate_posture: String,
    pub external_head_key: String,
    pub ownership_sentinel: String,
    pub supervisor_installation_id: String,
    pub supervisor_oci_digest: String,
    pub credentials: Vec<FlyCredentialBindingV2>,
    pub observed_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HostedAdmissionV2Version {
    #[serde(rename = "snapback.hosted-admission.v2")]
    V2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAdmissionV2 {
    pub schema_version: HostedAdmissionV2Version,
    pub target_id: String,
    pub deployment_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub binding_generation: u64,
    pub target_binding_sha256: String,
    pub control_head_sha256: String,
    pub supervisor_incarnation: String,
    pub exact_roster_sha256: String,
    pub routed_machine_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub hosted_auth_expires_at_ms: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub routed_machine_expires_at_ms: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub replay_floor: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub admission_generation: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub issued_at_ms: u64,
    pub signature: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProviderEffectIntentVersion {
    #[serde(rename = "snapback.provider-effect-intent.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderEffectIntentV1 {
    pub schema_version: ProviderEffectIntentVersion,
    pub operation_id: String,
    pub operation: String,
    pub request_sha256: String,
    pub semantic_effect_id: String,
    pub target_binding_sha256: String,
    pub plan_sha256: String,
    pub effect_kind: String,
    pub logical_resource_name: String,
    pub desired_provider_state_sha256: String,
    pub predecessor_head_sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProviderEffectObservationVersion {
    #[serde(rename = "snapback.provider-effect-observation.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderEffectObservationV1 {
    pub schema_version: ProviderEffectObservationVersion,
    pub semantic_effect_id: String,
    pub provider_request_sha256: String,
    pub provider_uri: String,
    pub provider_revision: Option<String>,
    pub observed_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProviderEffectTerminalVersion {
    #[serde(rename = "snapback.provider-effect-terminal.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProviderEffectTerminalOutcome {
    NotApplied,
    Applied,
    CommitUncertain,
}

/// Immutable terminal for one original effect attempt. Reconciliation appends
/// a separate `ProviderEffectReconciliationV1`; it never edits this record.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderEffectTerminalV1 {
    pub schema_version: ProviderEffectTerminalVersion,
    pub semantic_effect_id: String,
    pub outcome: ProviderEffectTerminalOutcome,
    pub reason: Option<String>,
    pub provider_version: Option<String>,
    pub redacted_evidence_sha256: Option<String>,
    pub retained_result_sha256: Option<String>,
    pub last_observation_sha256: Option<String>,
    pub recovery_class: Option<String>,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderEffectReconciliationV1 {
    pub schema_version: String,
    pub reconciliation_id: String,
    pub semantic_effect_id: String,
    pub uncertain_terminal_sha256: String,
    pub fresh_provider_observation_sha256: String,
    pub fresh_control_head_sha256: String,
    pub resolved_outcome: ProviderEffectTerminalOutcome,
    pub retained_result_sha256: Option<String>,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HostedControlHeadVersion {
    #[serde(rename = "snapback.hosted-control-head.v2")]
    V2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedControlHeadV2 {
    pub schema_version: HostedControlHeadVersion,
    pub target_id: String,
    pub generation: u64,
    pub predecessor_sha256: Option<String>,
    pub binding_sha256: String,
    pub active_release_id: Option<String>,
    pub activation_generation: u64,
    pub journal_root_sha256: String,
    pub admission_generation: u64,
    pub spend_floor: u64,
    pub cleanup_floor: u64,
    pub replay_floor: u64,
    pub supervisor_incarnation: String,
    pub committed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannedBindingPromotionV1 {
    pub schema_version: String,
    pub journey_id: String,
    pub planned_binding_sha256: String,
    pub provider: String,
    pub region: String,
    pub ownership_sentinel: String,
    pub logical_resource_ids: Vec<LogicalResourcePromotionV1>,
    pub target_binding_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogicalResourcePromotionV1 {
    pub logical_name: String,
    pub provider_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum SpendLedgerVersion {
    #[serde(rename = "snapback.hosted-spend-ledger.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SpendGrantState {
    Planned,
    Reserved,
    Effecting,
    Consumed,
    Released,
    CommitUncertain,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedSpendGrantV1 {
    pub grant_id: String,
    pub journey_id: String,
    pub plan_sha256: String,
    pub target_or_planned_binding_sha256: String,
    pub semantic_effect_ids: Vec<String>,
    pub maximum_micros: u64,
    pub held_micros: u64,
    pub state: SpendGrantState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedSpendLedgerV1 {
    pub schema_version: SpendLedgerVersion,
    pub journey_id: String,
    pub currency: String,
    pub tariff_source: String,
    pub tariff_observed_at_ms: u64,
    pub maximum_micros: u64,
    pub remaining_micros: u64,
    pub cleanup_reserve_micros: u64,
    pub grants: Vec<HostedSpendGrantV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AdapterLifecycleOperationV2 {
    AcquireLease,
    RenewLease,
    UploadImmutableRelease,
    ProvisionInactive,
    CompatibilityPreflight,
    CreateVerifiedBackup,
    StageRelease,
    ActivateGeneration,
    VerifyServedPath,
    Rollback,
    FenceExternalEffects,
    RestoreBackupInactive,
    VerifyRestoredComponents,
    VerifyRestoredApplication,
    ActivateRestoredGeneration,
    ReconcileEffect,
    ReleaseLease,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterLifecycleRequestV2Version {
    #[serde(rename = "snapback.vm-adapter-lifecycle-request.v2")]
    V2,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum AdapterLifecycleResponseV2Version {
    #[serde(rename = "snapback.vm-adapter-lifecycle-response.v2")]
    V2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterLifecycleRequestV2 {
    pub schema_version: AdapterLifecycleRequestV2Version,
    pub operation: AdapterLifecycleOperationV2,
    pub operation_id: String,
    pub attempt: u32,
    pub target_binding: FlyTargetBindingV2,
    pub plan_sha256: String,
    pub request_sha256: String,
    pub predecessor_head: HostedControlHeadV2,
    pub lease: Option<DeploymentLease>,
    pub effect_intent: ProviderEffectIntentV1,
    pub confirmation_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AdapterLifecycleResponseV2 {
    pub schema_version: AdapterLifecycleResponseV2Version,
    pub operation: AdapterLifecycleOperationV2,
    pub operation_id: String,
    pub ok: bool,
    pub idempotent_replay: bool,
    pub remote_evidence: bool,
    pub request_sha256: String,
    pub observation: Option<ProviderEffectObservationV1>,
    pub terminal: ProviderEffectTerminalV1,
    pub control_head: HostedControlHeadV2,
    pub diagnostics: Vec<AdapterSafeDiagnostic>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum CleanupPlanVersion {
    #[serde(rename = "snapback.vm-adapter-cleanup-plan.v1")]
    V1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupResourceV1 {
    pub logical_name: String,
    pub provider_id: String,
    pub resource_kind: String,
    pub ownership_sentinel: String,
    pub disposition: String,
    pub continuing_cost_micros_per_hour: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupPlanV1 {
    pub schema_version: CleanupPlanVersion,
    pub cleanup_plan_id: String,
    pub journey_id: String,
    pub target_or_planned_binding_sha256: String,
    pub ownership_sentinel: String,
    pub resources: Vec<CleanupResourceV1>,
    pub cleanup_reserve_micros: u64,
    pub inventory_sha256: String,
    pub confirmation_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupConfirmationV1 {
    pub schema_version: String,
    pub cleanup_plan_id: String,
    pub inventory_sha256: String,
    pub confirmation_sha256: String,
    pub confirmed_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CleanupReceiptV1 {
    pub schema_version: String,
    pub cleanup_plan_id: String,
    pub journey_id: String,
    pub deleted_provider_ids: Vec<String>,
    pub retained_evidence_prefixes: Vec<String>,
    pub revoked_credential_fingerprints: Vec<String>,
    pub absence_proof_sha256: String,
    pub continuing_cost_micros_per_hour: u64,
    pub completed: bool,
    pub recorded_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum HostedProductJourneyVersion {
    #[serde(rename = "snapback.hosted-product-journey.v1")]
    V1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum HostedJourneyStatus {
    Passed,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyProviderV1 {
    pub organization: String,
    pub app: String,
    pub region: String,
    pub public_origin: String,
    pub predecessor_machine_id: String,
    pub predecessor_volume_id: String,
    pub release_image_digest: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneySourceV1 {
    pub package_tarball_sha256: Option<String>,
    pub repository: String,
    pub revision: String,
    pub dirty: bool,
    pub target_triple: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyIdentitiesV1 {
    pub target_id: Option<String>,
    pub release_id: Option<String>,
    pub deployment_id: Option<String>,
    pub database_id: Option<String>,
    pub stream_id: Option<String>,
    pub restore_id: Option<String>,
    pub ephemeral_authority_instance: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum HostedJourneyExitClass {
    Passed,
    Failed,
    Refused,
    Interrupted,
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum HostedJourneyOperation {
    GenerateRelease,
    SelectTarget,
    DoctorMigrationPreflight,
    PlanDeploy,
    FollowLogs,
    VerifyServedPath,
    VerifyLiveData,
    VerifyHostedEphemeral,
    CreateBackup,
    RestoreAndActivate,
    RollbackAndReactivate,
    InspectCostCapacity,
    Cleanup,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyCommandV1 {
    pub operation: HostedJourneyOperation,
    pub exit_class: HostedJourneyExitClass,
    pub exit_code: Option<i32>,
    pub diagnostic_code: Option<String>,
    pub receipt_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyEvidenceRefV1 {
    pub artifact_kind: String,
    pub artifact_id: String,
    pub sha256: String,
    pub bytes: u64,
    pub media_type: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyEvidenceV1 {
    pub logs: Option<HostedJourneyEvidenceRefV1>,
    pub migration: Option<HostedJourneyEvidenceRefV1>,
    pub backup: Option<HostedJourneyEvidenceRefV1>,
    pub restore: Option<HostedJourneyEvidenceRefV1>,
    pub rollback: Option<HostedJourneyEvidenceRefV1>,
    pub tls: Option<HostedJourneyEvidenceRefV1>,
    pub cost: Option<HostedJourneyEvidenceRefV1>,
    pub relation_activity: Option<HostedJourneyEvidenceRefV1>,
    pub ephemeral_corpus: Option<HostedJourneyEvidenceRefV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyComparatorV1 {
    pub receipt_sha256: String,
    pub status: HostedJourneyStatus,
    pub required_checks: u64,
    pub passed_checks: u64,
    pub hosted_parity_claimed: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneySingleRouteV1 {
    pub status: HostedJourneyStatus,
    pub routed_machine_ids: Vec<String>,
    pub autoscale_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyBackupV1 {
    pub status: HostedJourneyStatus,
    pub object_key: String,
    pub bytes: u64,
    pub backup_sha256: String,
    pub readback_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyIsolatedRestoreV1 {
    pub status: HostedJourneyStatus,
    pub helper_machine_id: String,
    pub helper_volume_id: String,
    pub helper_production_services: u64,
    pub volume_encrypted: bool,
    pub sqlite_integrity: String,
    pub sqlite_table_count: u64,
    pub activated: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyServedPathV1 {
    pub status: HostedJourneyStatus,
    pub http_status: u16,
    pub diagnostic_code: String,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyPackedLifecycleV1 {
    pub status: HostedJourneyStatus,
    pub diagnostic_code: String,
    pub missing: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyRowsV1 {
    pub single_production_route: HostedJourneySingleRouteV1,
    pub application_consistent_backup: HostedJourneyBackupV1,
    pub isolated_restore: HostedJourneyIsolatedRestoreV1,
    pub public_served_path: HostedJourneyServedPathV1,
    pub packed_lifecycle: HostedJourneyPackedLifecycleV1,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyDeletedMachineV1 {
    pub id: String,
    pub provider_state: String,
    pub absent_from_live_roster: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyDeletedVolumeV1 {
    pub id: String,
    pub provider_state: String,
    pub absent_from_live_inventory: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyDeletedObjectV1 {
    pub key: String,
    pub readback_status: u16,
    pub absent: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyCleanupV1 {
    pub temporary_machine: HostedJourneyDeletedMachineV1,
    pub temporary_volume: HostedJourneyDeletedVolumeV1,
    pub temporary_backup_object: HostedJourneyDeletedObjectV1,
    pub live_roster_after_cleanup: Vec<String>,
    pub live_volumes_after_cleanup: Vec<String>,
    pub live_temporary_lease_ids: Vec<String>,
    pub live_temporary_route_ids: Vec<String>,
    pub pending_certificate_request_ids: Vec<String>,
    pub active_temporary_credential_fingerprints: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedJourneyClaimBoundaryV1 {
    pub supervisor_installation_ready: bool,
    pub isolated_backup_restore_drill_passed: bool,
    pub hosted_product_journey_passed: bool,
    pub hosted_ephemeral_capability_advertised: bool,
}

/// Machine-readable packed product-journey receipt. A failed receipt is a
/// first-class artifact: it retains every completed remote row and closed
/// cleanup inventory without becoming capability evidence.
///
/// @ref LLP 0111#4-public-cli-product-journey — the public journey is one
/// Rust-owned closed receipt, including coded failure and cleanup posture.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedProductJourneyV1 {
    pub schema_version: HostedProductJourneyVersion,
    pub receipt_sha256: String,
    pub status: HostedJourneyStatus,
    pub observed_at: String,
    pub source: HostedJourneySourceV1,
    pub identities: HostedJourneyIdentitiesV1,
    pub commands: Vec<HostedJourneyCommandV1>,
    pub evidence: HostedJourneyEvidenceV1,
    pub comparator: HostedJourneyComparatorV1,
    pub provider: HostedJourneyProviderV1,
    pub rows: HostedJourneyRowsV1,
    pub cleanup: HostedJourneyCleanupV1,
    pub claim_boundary: HostedJourneyClaimBoundaryV1,
}

impl HostedProductJourneyV1 {
    /// Validate a receipt which carries no retained evidence objects. This is
    /// sufficient for an honest early-failure receipt; a passing receipt must
    /// use [`Self::validate_claim_boundary_with_artifacts`] so every evidence
    /// digest is reopened.
    ///
    /// @ref LLP 0111#4-public-cli-product-journey — a passing receipt binds the
    /// package, source, remote identities, command outcomes, and lifecycle
    /// evidence instead of relying on an unstructured narrative.
    pub fn validate_claim_boundary(&self) -> Result<(), Vec<String>> {
        self.validate_claim_boundary_with_artifacts(&BTreeMap::new())
    }

    /// Reopen every evidence object by its opaque artifact id and verify its
    /// declared length and digest before accepting either a retained partial
    /// receipt or the complete hosted capability claim.
    pub fn validate_claim_boundary_with_artifacts(
        &self,
        artifacts: &BTreeMap<String, Vec<u8>>,
    ) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        if self.expected_receipt_sha256().as_deref() != Ok(self.receipt_sha256.as_str()) {
            errors.push("receiptSha256".to_owned());
        }

        let value = serde_json::to_value(self).expect("hosted journey receipt serializes");
        collect_private_material(&value, "$", &mut errors);

        if self.status == HostedJourneyStatus::Failed
            && (self.claim_boundary.hosted_product_journey_passed
                || self.claim_boundary.hosted_ephemeral_capability_advertised
                || self.comparator.hosted_parity_claimed)
        {
            errors.push("failedReceipt.claimBoundary".to_owned());
        }

        for (index, command) in self.commands.iter().enumerate() {
            if !is_sha256(&command.receipt_sha256) {
                errors.push(format!("commands[{index}].receiptSha256"));
            }
            match command.exit_class {
                HostedJourneyExitClass::Passed => {
                    if command.exit_code != Some(0) || command.diagnostic_code.is_some() {
                        errors.push(format!("commands[{index}].passedExit"));
                    }
                }
                _ => {
                    if command.exit_code == Some(0) || command.diagnostic_code.is_none() {
                        errors.push(format!("commands[{index}].failedExit"));
                    }
                }
            }
        }

        for (name, evidence) in self.evidence_refs() {
            if !valid_artifact_id(&evidence.artifact_id)
                || !is_sha256(&evidence.sha256)
                || evidence.bytes == 0
                || evidence.media_type.is_empty()
            {
                errors.push(format!("{name}.shape"));
                continue;
            }
            let Some(bytes) = artifacts.get(&evidence.artifact_id) else {
                errors.push(format!("{name}.artifactMissing"));
                continue;
            };
            if bytes.len() as u64 != evidence.bytes
                || hosted_sha256_prefixed(bytes) != evidence.sha256
            {
                errors.push(format!("{name}.artifactMismatch"));
            }
        }

        if self.status == HostedJourneyStatus::Passed {
            self.validate_passed_claim(&mut errors);
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    fn evidence_refs(&self) -> Vec<(&'static str, &HostedJourneyEvidenceRefV1)> {
        [
            ("evidence.logs", self.evidence.logs.as_ref()),
            ("evidence.migration", self.evidence.migration.as_ref()),
            ("evidence.backup", self.evidence.backup.as_ref()),
            ("evidence.restore", self.evidence.restore.as_ref()),
            ("evidence.rollback", self.evidence.rollback.as_ref()),
            ("evidence.tls", self.evidence.tls.as_ref()),
            ("evidence.cost", self.evidence.cost.as_ref()),
            (
                "evidence.relationActivity",
                self.evidence.relation_activity.as_ref(),
            ),
            (
                "evidence.ephemeralCorpus",
                self.evidence.ephemeral_corpus.as_ref(),
            ),
        ]
        .into_iter()
        .filter_map(|(name, value)| value.map(|value| (name, value)))
        .collect()
    }

    fn validate_passed_claim(&self, errors: &mut Vec<String>) {
        if self.source.dirty
            || self.source.repository.trim().is_empty()
            || !is_hex_revision(&self.source.revision)
            || !self
                .source
                .package_tarball_sha256
                .as_deref()
                .is_some_and(is_sha256)
            || !self
                .source
                .target_triple
                .as_deref()
                .is_some_and(valid_identity)
        {
            errors.push("source.releaseEligible".to_owned());
        }
        for (name, value) in [
            ("identities.targetId", &self.identities.target_id),
            ("identities.releaseId", &self.identities.release_id),
            ("identities.deploymentId", &self.identities.deployment_id),
            ("identities.databaseId", &self.identities.database_id),
            ("identities.streamId", &self.identities.stream_id),
            ("identities.restoreId", &self.identities.restore_id),
            (
                "identities.ephemeralAuthorityInstance",
                &self.identities.ephemeral_authority_instance,
            ),
        ] {
            if !value.as_deref().is_some_and(valid_identity) {
                errors.push(name.to_owned());
            }
        }

        let required_operations = BTreeSet::from([
            HostedJourneyOperation::GenerateRelease,
            HostedJourneyOperation::SelectTarget,
            HostedJourneyOperation::DoctorMigrationPreflight,
            HostedJourneyOperation::PlanDeploy,
            HostedJourneyOperation::FollowLogs,
            HostedJourneyOperation::VerifyServedPath,
            HostedJourneyOperation::VerifyLiveData,
            HostedJourneyOperation::VerifyHostedEphemeral,
            HostedJourneyOperation::CreateBackup,
            HostedJourneyOperation::RestoreAndActivate,
            HostedJourneyOperation::RollbackAndReactivate,
            HostedJourneyOperation::InspectCostCapacity,
            HostedJourneyOperation::Cleanup,
        ]);
        let observed_operations = self
            .commands
            .iter()
            .map(|command| command.operation)
            .collect::<BTreeSet<_>>();
        if self.commands.len() != required_operations.len()
            || observed_operations != required_operations
            || self
                .commands
                .iter()
                .any(|command| command.exit_class != HostedJourneyExitClass::Passed)
        {
            errors.push("commands.completePassedFamily".to_owned());
        }
        if self.evidence_refs().len() != 9 {
            errors.push("evidence.completeFamily".to_owned());
        }
        if self.comparator.status != HostedJourneyStatus::Passed
            || !self.comparator.hosted_parity_claimed
            || self.comparator.required_checks == 0
            || self.comparator.required_checks != self.comparator.passed_checks
            || !is_sha256(&self.comparator.receipt_sha256)
        {
            errors.push("comparator.hostedParity".to_owned());
        }
        if self.rows.single_production_route.status != HostedJourneyStatus::Passed
            || self.rows.single_production_route.routed_machine_ids.len() != 1
            || self.rows.single_production_route.autoscale_enabled
        {
            errors.push("rows.singleProductionRoute".to_owned());
        }
        if self.rows.application_consistent_backup.status != HostedJourneyStatus::Passed
            || self.rows.application_consistent_backup.bytes == 0
            || !is_sha256(&self.rows.application_consistent_backup.backup_sha256)
            || self.rows.application_consistent_backup.backup_sha256
                != self.rows.application_consistent_backup.readback_sha256
        {
            errors.push("rows.applicationConsistentBackup".to_owned());
        }
        if self.rows.isolated_restore.status != HostedJourneyStatus::Passed
            || self.rows.isolated_restore.helper_production_services != 0
            || !self.rows.isolated_restore.volume_encrypted
            || self.rows.isolated_restore.sqlite_integrity != "ok"
            || self.rows.isolated_restore.sqlite_table_count == 0
            || !self.rows.isolated_restore.activated
        {
            errors.push("rows.isolatedRestore".to_owned());
        }
        if self.rows.public_served_path.status != HostedJourneyStatus::Passed
            || !(200..300).contains(&self.rows.public_served_path.http_status)
            || !self.rows.public_served_path.diagnostic_code.is_empty()
        {
            errors.push("rows.publicServedPath".to_owned());
        }
        if self.rows.packed_lifecycle.status != HostedJourneyStatus::Passed
            || !self.rows.packed_lifecycle.missing.is_empty()
        {
            errors.push("rows.packedLifecycle".to_owned());
        }
        if !self.cleanup.temporary_machine.absent_from_live_roster
            || self
                .cleanup
                .live_roster_after_cleanup
                .contains(&self.cleanup.temporary_machine.id)
            || !self.cleanup.temporary_volume.absent_from_live_inventory
            || self
                .cleanup
                .live_volumes_after_cleanup
                .contains(&self.cleanup.temporary_volume.id)
            || !self.cleanup.temporary_backup_object.absent
            || !self.cleanup.live_temporary_lease_ids.is_empty()
            || !self.cleanup.live_temporary_route_ids.is_empty()
            || !self.cleanup.pending_certificate_request_ids.is_empty()
            || !self
                .cleanup
                .active_temporary_credential_fingerprints
                .is_empty()
        {
            errors.push("cleanup.closedInventory".to_owned());
        }
        if !self.claim_boundary.supervisor_installation_ready
            || !self.claim_boundary.isolated_backup_restore_drill_passed
            || !self.claim_boundary.hosted_product_journey_passed
            || !self.claim_boundary.hosted_ephemeral_capability_advertised
        {
            errors.push("claimBoundary.complete".to_owned());
        }
    }

    fn expected_receipt_sha256(&self) -> Result<String, String> {
        let mut value =
            serde_json::to_value(self).map_err(|_| "receipt serialization failed".to_owned())?;
        value
            .as_object_mut()
            .ok_or_else(|| "receipt must serialize as an object".to_owned())?
            .remove("receiptSha256");
        let canonical = crate::rqs_contract::jcs(&value)
            .map_err(|_| "receipt is outside canonical JSON limits".to_owned())?;
        Ok(hosted_sha256_prefixed(canonical.as_bytes()))
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn hosted_sha256_prefixed(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn is_hex_revision(value: &str) -> bool {
    (value.len() == 40 || value.len() == 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_identity(value: &str) -> bool {
    (1..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/-".contains(&byte))
}

fn valid_artifact_id(value: &str) -> bool {
    (8..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn collect_private_material(value: &Value, path: &str, errors: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let private = text.len() > 1_024
                || text.contains("Bearer ")
                || text.contains("-----BEGIN ")
                || text.contains("/Users/")
                || text.contains("/home/")
                || text.contains("/private/")
                || text.contains("/tmp/")
                || text.contains(".snapback/")
                || text.contains(":\\");
            let credentialed_url = text
                .split_once("://")
                .and_then(|(_, remainder)| remainder.split('/').next())
                .is_some_and(|authority| authority.contains('@'));
            if private || credentialed_url {
                errors.push(format!("{path}.privateMaterial"));
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                collect_private_material(item, &format!("{path}[{index}]"), errors);
            }
        }
        Value::Object(fields) => {
            for (name, item) in fields {
                collect_private_material(item, &format!("{path}.{name}"), errors);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> ReleaseManifest {
        ReleaseManifest {
            artifact_kind: ReleaseArtifactKind::ReleaseManifest,
            schema_version: ReleaseManifestVersion::V1,
            release_id: format!("sha256:{}", "a".repeat(64)),
            project_id: "checkpoint".to_owned(),
            target_profile_id: "cloudflare-do-sqlite-v8".to_owned(),
            activation_eligible: false,
            source: ReleaseSource {
                repository_name: "checkpoint".to_owned(),
                revision: "b".repeat(40),
                source_date_epoch: 1,
                dirty: false,
                dirty_paths_sha256: None,
            },
            toolchain: ReleaseToolchain {
                snapback_cli_version: "0.1.0".to_owned(),
                node_version: "v24.0.0".to_owned(),
                package_manager: Some("bun@1.3.12".to_owned()),
            },
            compatibility: ReleaseCompatibility {
                schema_version: "snapback.v0".to_owned(),
                auth_mode: "dev".to_owned(),
                schema_sha256: format!("sha256:{}", "c".repeat(64)),
                functions_sha256: format!("sha256:{}", "d".repeat(64)),
                capability_sha256: format!("sha256:{}", "e".repeat(64)),
                inputs_sha256: format!("sha256:{}", "f".repeat(64)),
            },
            required_capabilities: vec!["live_subscriptions".to_owned()],
            components: vec![ReleaseComponent {
                path: "app/schema.manifest.json".to_owned(),
                sha256: format!("sha256:{}", "1".repeat(64)),
                bytes: 10,
                media_type: "application/json".to_owned(),
            }],
            scan: ReleaseScan {
                secret_scan: "passed".to_owned(),
                source_maps: "refused".to_owned(),
                symlinks: "refused".to_owned(),
                scanned_files: 1,
                scanned_bytes: 10,
            },
            gaps: vec![ReleaseGap {
                id: "control-plane.adapter".to_owned(),
                reason: "no hosted adapter has completed the profile".to_owned(),
                blocking: true,
            }],
        }
    }

    fn target_fixture() -> TargetDescriptor {
        TargetDescriptor {
            schema_version: TargetDescriptorVersion::V1,
            target_id: "target-preview-1".to_owned(),
            project_id: "checkpoint".to_owned(),
            environment_id: "preview-1".to_owned(),
            deployment_id: "deployment-1".to_owned(),
            database_id: "database-1".to_owned(),
            stream_incarnation: "stream-1".to_owned(),
            target_profile_id: "trusted-single-tenant-app-complete.v1".to_owned(),
            production_class: TargetProductionClass::Preview,
            adapter: VmAdapterDescriptor {
                kind: VmAdapterKind::SingleInstanceContainerVm,
                version: "1.0.0".to_owned(),
                driver_path: "/opt/snapback/vm-adapter".to_owned(),
                driver_sha256: format!("sha256:{}", "2".repeat(64)),
                provider: "fixture-provider".to_owned(),
                account_fingerprint: "account-1".to_owned(),
                region: "test-1".to_owned(),
                public_origin: "https://preview.example.invalid".to_owned(),
                credential_ref: "secret-store://snapback/preview-1".to_owned(),
                state_store_ref: "object://snapback-control/preview-1".to_owned(),
            },
            created_at_ms: 1,
        }
    }

    #[test]
    fn release_manifest_is_closed_and_round_trips() {
        let fixture = fixture();
        let mut value = serde_json::to_value(&fixture).expect("serialize release manifest");
        assert_eq!(value["artifactKind"], "releaseManifest");
        assert_eq!(value["schemaVersion"], "snapback.release-manifest.v1");
        assert_eq!(
            serde_json::from_value::<ReleaseManifest>(value.clone())
                .expect("parse release manifest"),
            fixture
        );
        value["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ReleaseManifest>(value).is_err());
    }

    #[test]
    fn target_adapter_and_plan_artifacts_are_closed() {
        let target = target_fixture();
        let observation = TargetObservation {
            target_id: target.target_id.clone(),
            environment_id: target.environment_id.clone(),
            deployment_id: target.deployment_id.clone(),
            database_id: target.database_id.clone(),
            stream_incarnation: target.stream_incarnation.clone(),
            target_profile_id: target.target_profile_id.clone(),
            provider: target.adapter.provider.clone(),
            account_fingerprint: target.adapter.account_fingerprint.clone(),
            region: target.adapter.region.clone(),
            public_origin: target.adapter.public_origin.clone(),
            resource_id: "vm-1".to_owned(),
            state: DeploymentState::Registered,
            activation_generation: 0,
            active_release_id: None,
            application_sentinel_sha256: None,
            credential_status: CredentialStatus::Ready,
            provider_facts_sha256: format!("sha256:{}", "3".repeat(64)),
            observed_at_ms: 2,
            capability_gaps: vec!["hosted-auth".to_owned()],
        };
        let response = AdapterResponse {
            schema_version: AdapterResponseVersion::V1,
            operation: AdapterOperation::Inspect,
            operation_id: "operation-1".to_owned(),
            ok: true,
            observation: Some(observation),
            diagnostics: vec![],
        };
        let mut response_value = serde_json::to_value(&response).expect("serialize response");
        assert_eq!(
            serde_json::from_value::<AdapterResponse>(response_value.clone())
                .expect("parse response"),
            response
        );
        response_value["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<AdapterResponse>(response_value).is_err());

        let plan = DeployPlan {
            artifact_kind: DeployPlanArtifactKind::DeployPlan,
            schema_version: DeployPlanVersion::V1,
            plan_id: format!("sha256:{}", "4".repeat(64)),
            operation_id: "operation-1".to_owned(),
            reason: "checkpoint preview".to_owned(),
            target_id: target.target_id.clone(),
            project_id: target.project_id.clone(),
            environment_id: target.environment_id.clone(),
            deployment_id: target.deployment_id.clone(),
            database_id: target.database_id.clone(),
            stream_incarnation: target.stream_incarnation.clone(),
            target_profile_id: target.target_profile_id.clone(),
            production_class: target.production_class,
            target_descriptor_sha256: format!("sha256:{}", "5".repeat(64)),
            target_observation_sha256: format!("sha256:{}", "6".repeat(64)),
            observed_activation_generation: 0,
            observed_active_release_id: None,
            release_id: format!("sha256:{}", "7".repeat(64)),
            release_manifest_sha256: format!("sha256:{}", "8".repeat(64)),
            prepared_release_id: None,
            prepared_release_manifest_sha256: None,
            steps: vec![DeployPlanStep::VerifyIdentity],
            blockers: vec![ReleaseGap {
                id: "control-plane.hosted-auth".to_owned(),
                reason: "hosted auth is not ready".to_owned(),
                blocking: true,
            }],
            apply_eligible: false,
            confirmation: format!("confirm:sha256:{}", "4".repeat(64)),
            created_at_ms: 3,
            expires_at_ms: 303,
        };
        let mut plan_value = serde_json::to_value(&plan).expect("serialize plan");
        assert_eq!(
            serde_json::from_value::<DeployPlan>(plan_value.clone()).expect("parse plan"),
            plan
        );
        plan_value["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<DeployPlan>(plan_value).is_err());
    }
}
