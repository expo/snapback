//! Generated JSON Schemas for the Snapback-owned shared artifact shapes.
//!
//! The Rust serde types are the single source of truth (LLP 0037, Rust-first).
//! The JSON Schemas committed under `schemas/` are *generated* from those types
//! by [`artifact_schemas`]; nothing is hand-authored. There is exactly one
//! generator and two callers, so the committed files cannot diverge from the
//! checker: the `snapback-schemagen` bin writes the files, and
//! `tests/artifact_schemas_v0.rs` regenerates in-memory and fails on any diff
//! (the CI drift gate LLP 0012 §Versioning requires).
//!
//! Scope fence (LLP 0037): this governs Snapback-owned artifacts only. The
//! Exact-owned `ContractDataManifest` is not derived here.
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — Rust serde types are the source
//!   of truth; JSON Schemas are generated from them and drift-gated.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived, committed, drift-gated.

use serde_json::{Value, json};

use crate::admin::AdminInspect;
use crate::auth::deployment::{
    HostedAdmission, HostedAdmissionEnvelope, HostedAdmissionKeyFile, HostedAuthCapabilities,
};
use crate::auth::handshake::AuthSessionResponse;
use crate::auth::lease::AuthorizedLease;
use crate::auth::logical_transfer::{AuthLogicalExportV1, AuthLogicalImportOutcomeV1};
use crate::auth::rehearsal::{
    AuthRehearsalGrantV1, AuthRehearsalLogicalExportArtifactV1, AuthRehearsalReachabilityV1,
    AuthRehearsalStoreMarkersV1, AuthRehearsalWindowV1, RehearsalExerciseRequestV1,
    RehearsalMintRequestV1, RehearsalMintResultV1, RehearsalRevokeRequestV1,
    RehearsalStatusRequestV1,
};
use crate::auth::wire::{
    CredentialResponse, EmptyAuthRequest, ExchangeRequest, FamilyAlarmResponse, MailboxQuery,
    MailboxResponse, MintSessionRequest, PasswordAttemptAdminRequest, PasswordAttemptAdminResponse,
    PasswordChangeRequest, PasswordCredentialRequest, PasswordResetRequest, PasswordUnlockRequest,
    PasswordUnlockResponse, RecoveryConsumeRequest, RequestCodeRequest, RequestCodeResponse,
    RescueCollidingTableRequest,
};
use crate::commit_envelope::{
    ClientIdentityRangeV1, CommitEnvelopeV1, IdentityEpochV1, OperationCoverageActivationRequestV1,
    OperationCoverageActivationResponseV1, OperationCoverageManifestV1,
    OperationExplanationRequestV1, OperationExplanationResponseV1, OperationExplanationV1,
    OperationIdentityRangeRequestV1, OperationIdentityRangeResponseV1,
    OperationIdentityTombstoneV1, OperationIdentityV1, OperationSuppressionRecordV1,
    PendingOperationLifecycleV1, PendingOperationTerminalSupplementV1,
};
use crate::data_tier::{DataTierCorpusCase, DataTierCorpusManifest, DataTierProfile};
use crate::deploy::{
    AdapterLifecycleRequest, AdapterLifecycleRequestV2, AdapterLifecycleResponse,
    AdapterLifecycleResponseV2, AdapterQualificationManifest, AdapterQueryRequest,
    AdapterQueryResponse, AdapterRequest, AdapterResponse, BackupManifest, BackupPlan,
    CleanupConfirmationV1, CleanupPlanV1, CleanupReceiptV1, ControlAuditEvent, DeployPlan,
    DeployReceipt, ExternalReplayFloorAdvanceReceipt, FlyTargetBindingV2,
    HostedAdmissionProjectionReceipt, HostedAdmissionRefreshReceipt, HostedAdmissionV2,
    HostedAuthDrillReceipt, HostedControlHeadV2, HostedProductJourneyV1, HostedSpendLedgerV1,
    MaintenanceReceipt, PlannedBindingPromotionV1, PreparedReleaseManifest, ProviderEffectIntentV1,
    ProviderEffectObservationV1, ProviderEffectReconciliationV1, ProviderEffectTerminalV1,
    ReleaseManifest, RemoteDrillPlan, RestoreActivationPlan, RestorePlan, RollbackPlan,
    TargetDescriptor,
};
use crate::diagnostic::Diagnostic;
use crate::ephemeral::{
    DeleteRequest, EphemeralAuthorityInstanceV1, EphemeralMessage, HostedEphemeralFactsV1,
    PublishOutcome, PublishRequest, RealtimeEnvelope, SubscribeRequest,
};
use crate::fork_promotion::{
    BranchOperationV1, BranchReapReceiptV1, CapturedEffectIntentV1, DenyAllAttemptMarkerV1,
    ForkDiffReceiptV1, InAppBranchReceiptV1, ManagedInAppBranchReceiptV1, PromotedEffectIntentV1,
    PromotionAdmissionTicketV1, PromotionReceiptV1, PromotionRequestV1, RebaseReplayReceiptV1,
};
use crate::handler_wire::{HandlerHostCallRequest, HandlerInvokeRequest, HandlerInvokeResponse};
use crate::host_ops_contract::{
    DryRunReport, HostOpsResult, HostReadyDescriptor, ManagedBranchCreateHostInputV1,
    ManagedBranchExecuteHostInputV1, ManagedBranchIdHostInputV1, ManagedBranchListHostInputV1,
};
use crate::live_wire::{
    KitSocketReplyFrame, KitSocketRequestFrame, LiveEnvelope, LiveSocketClientMessage,
    LiveSocketServerFrame, OutboxDrainOutput, Receipt, ResumeWire,
};
use crate::local::{
    AuthorizationInvalidationAckInput, AuthorizationInvalidationAckOutput,
    AuthorizationInvalidationManualRetryInput, AuthorizationInvalidationManualRetryOutput,
    EnsureAppRequest, EnsureAppResponse, FunctionRunResult, InspectState, LiveResumeInput,
    LiveResumeOutput, LiveSubscribeOutput, LiveSubscribeRequest, LiveUnsubscribeInput,
    LiveUnsubscribeOutput, PublicInspect,
};
use crate::manifest::{
    CapabilityManifest, FiniteQueryOutput, FiniteQueryRequest, FunctionCallRequest,
    FunctionManifest, FunctionResponse, MutationAcknowledgementRequest,
    MutationAcknowledgementResponse, MutationRequest, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
};
use crate::operational_readiness::{
    ApplicationReadyReceiptV1, ExpectedActivationTargetV1, OperationalReadinessV1,
};
use crate::migration::{
    MigrationAdmissionV1, MigrationApprovalV1, MigrationPlanArtifactV1,
    MigrationPreviewObservationV1, MigrationRehearsalPlanV1,
};
use crate::proof_checkpoint::{
    BoundaryDigestV1, BoundaryProofV1, CheckpointDigestHeaderV1, CheckpointRegistryRecordV1,
    HistoryRetentionPolicyV1, NamedCheckpointReceiptV1, NamedCheckpointRequestV1,
    PromotionApprovedWriteV1, PromotionDigestHeaderV1, ProtectedRecordCheckpointErasureReceiptV1,
    ProtectedRecordErasureAuthorityFactsV1, ProtectedRecordErasureReceiptV1,
    ProtectedRecordErasureWireRequestV1, RecordHistoryPageV1,
};
use crate::remediation::RemediationSetV1;
use crate::remediation::{
    RemediationApplyInputV1, RemediationApplyResultV1, RemediationFixtureCorpusV1,
};
use crate::result_transform::{ResultTransformCorpusCaseV1, ResultTransformCorpusManifestV1};
use crate::seed_identity::{
    ActiveSeedIdentityV1, ExpectedDataVersionStreamV1, InstallSeedRequestV1, ResetSeedRequestV1,
    SeedArtifactV1, SeedAssetFixturesV1, SeedEnsureResultV1, SeedInstallReceiptV1,
    SeedMatchedObservationV1, SeedPreviewRequestV1, SeedPreviewResultV1,
};
use crate::server::{
    AuthorizedLeaseQueryRequest, AuthorizedLeaseQueryResponse, ConnectionGrant, ErrorResponse,
    MutationResponse, OpenConnectionRequest, SessionLiveSocketClientMessage,
};
use crate::service_profile::{
    RemoteAuthCapabilityManifest, RemoteDataCapabilityManifest, RemoteServiceProfile,
};
use crate::storage::{SchemaTransitionEventBodyV1, StorageInfo};

/// A generated schema artifact: the committed file name (relative to the
/// repo-root `schemas/` directory) and the JSON Schema derived from a Rust type.
pub struct SchemaArtifact {
    /// File name under `schemas/`, e.g. `schema.manifest.schema.json`.
    pub file: &'static str,
    /// The generated JSON Schema, with sorted keys for a stable committed diff.
    pub schema: Value,
}

/// JSON Schemas whose defining authority is a non-Rust compiler. The Rust
/// schemagen must preserve these files, and the DK-7 directory-closure test
/// includes them without pretending `artifact_schemas()` generated them.
///
/// @ref LLP 0184#phase-1--catalog-and-parity-gate — ControlCatalogV1 and its
/// instance projection are owned by the checked cross-registry JS compiler.
/// @ref LLP 0146#oq6-author-ruling--2026-08-10 — the global registry schema
///   remains a data-registry validator while Rust owns the contextual carrier.
/// @ref LLP 0049#deployment-identity-freshness-gate-2026-07-25 — the
///   Cloudflare deploy workflow owns its version-attested success receipt;
///   it is not a Rust server artifact.
pub const EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS: &[&str] = &[
    "cloudflare.deploy-receipt-v1.schema.json",
    "control-catalog-instance.v1.schema.json",
    "control-catalog.v1.schema.json",
    "remediation-kinds.v1.schema.json",
];

/// The single generator for every Snapback-owned committed schema.
///
/// Both the `snapback-schemagen` bin (which writes `schemas/`) and the drift
/// gate in `tests/artifact_schemas_v0.rs` (which compares) call this, so the
/// generated output and the gate can never diverge.
pub fn artifact_schemas() -> Vec<SchemaArtifact> {
    let mut artifacts = vec![
        finish(
            "schema.manifest.schema.json",
            schemars::schema_for!(SchemaManifest),
        ),
        finish(
            "functions.manifest.schema.json",
            schemars::schema_for!(FunctionManifest),
        ),
        finish(
            "data-tier.profile.schema.json",
            schemars::schema_for!(DataTierProfile),
        ),
        finish(
            "data-tier.corpus.schema.json",
            schemars::schema_for!(DataTierCorpusManifest),
        ),
        finish(
            "data-tier.case.schema.json",
            schemars::schema_for!(DataTierCorpusCase),
        ),
        // @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract
        // — the result-transform extension follows the same Rust-owned,
        // generated, committed corpus-envelope discipline.
        finish(
            "result-transform-v1.corpus.schema.json",
            schemars::schema_for!(ResultTransformCorpusManifestV1),
        ),
        finish(
            "result-transform-v1.case.schema.json",
            schemars::schema_for!(ResultTransformCorpusCaseV1),
        ),
        finish(
            "capability.manifest.schema.json",
            schemars::schema_for!(CapabilityManifest),
        ),
        // @ref LLP 0163#owned-artifacts — the Rust identity/envelope types are
        // the source of truth; schema presence is not a capability claim.
        finish(
            "operation.identity-v1.schema.json",
            schemars::schema_for!(OperationIdentityV1),
        ),
        finish(
            "commit.envelope-v1.schema.json",
            schemars::schema_for!(CommitEnvelopeV1),
        ),
        finish(
            "operation.identity-range-v1.schema.json",
            schemars::schema_for!(ClientIdentityRangeV1),
        ),
        finish(
            "operation.identity-range-request-v1.schema.json",
            schemars::schema_for!(OperationIdentityRangeRequestV1),
        ),
        finish(
            "operation.identity-range-response-v1.schema.json",
            schemars::schema_for!(OperationIdentityRangeResponseV1),
        ),
        finish(
            "operation.coverage-activation-request-v1.schema.json",
            schemars::schema_for!(OperationCoverageActivationRequestV1),
        ),
        finish(
            "operation.coverage-activation-response-v1.schema.json",
            schemars::schema_for!(OperationCoverageActivationResponseV1),
        ),
        finish(
            "operation.identity-epoch-v1.schema.json",
            schemars::schema_for!(IdentityEpochV1),
        ),
        finish(
            "operation.suppression-v1.schema.json",
            schemars::schema_for!(OperationSuppressionRecordV1),
        ),
        finish(
            "operation.pending-lifecycle-v1.schema.json",
            schemars::schema_for!(PendingOperationLifecycleV1),
        ),
        finish(
            "operation.pending-terminal-supplement-v1.schema.json",
            schemars::schema_for!(PendingOperationTerminalSupplementV1),
        ),
        finish(
            "operation.identity-tombstone-v1.schema.json",
            schemars::schema_for!(OperationIdentityTombstoneV1),
        ),
        finish(
            "operation.explanation-v1.schema.json",
            schemars::schema_for!(OperationExplanationV1),
        ),
        finish(
            "operation.explanation-request-v1.schema.json",
            schemars::schema_for!(OperationExplanationRequestV1),
        ),
        finish(
            "operation.explanation-response-v1.schema.json",
            schemars::schema_for!(OperationExplanationResponseV1),
        ),
        finish(
            "operation.coverage-manifest-v1.schema.json",
            schemars::schema_for!(OperationCoverageManifestV1),
        ),
        // @ref LLP 0165#owned-artifacts — proof/checkpoint/history carriers
        // are Rust-owned and committed before callers wire them in. Schema
        // presence is not capability advertisement.
        finish(
            "promotion.digest-header-v1.schema.json",
            schemars::schema_for!(PromotionDigestHeaderV1),
        ),
        finish(
            "promotion.approved-write-v1.schema.json",
            schemars::schema_for!(PromotionApprovedWriteV1),
        ),
        finish(
            "checkpoint.digest-header-v1.schema.json",
            schemars::schema_for!(CheckpointDigestHeaderV1),
        ),
        finish(
            "boundary.digest-v1.schema.json",
            schemars::schema_for!(BoundaryDigestV1),
        ),
        finish(
            "boundary.proof-v1.schema.json",
            schemars::schema_for!(BoundaryProofV1),
        ),
        finish(
            "checkpoint.request-v1.schema.json",
            schemars::schema_for!(NamedCheckpointRequestV1),
        ),
        finish(
            "checkpoint.receipt-v1.schema.json",
            schemars::schema_for!(NamedCheckpointReceiptV1),
        ),
        finish(
            "checkpoint.registry-record-v1.schema.json",
            schemars::schema_for!(CheckpointRegistryRecordV1),
        ),
        finish(
            "checkpoint.protected-record-erasure-receipt-v1.schema.json",
            schemars::schema_for!(ProtectedRecordCheckpointErasureReceiptV1),
        ),
        finish(
            "protected-record-erasure.authority-facts-v1.schema.json",
            schemars::schema_for!(ProtectedRecordErasureAuthorityFactsV1),
        ),
        finish(
            "protected-record-erasure.request-v1.schema.json",
            schemars::schema_for!(ProtectedRecordErasureWireRequestV1),
        ),
        finish(
            "protected-record-erasure.receipt-v1.schema.json",
            schemars::schema_for!(ProtectedRecordErasureReceiptV1),
        ),
        finish(
            "history.retention-policy-v1.schema.json",
            schemars::schema_for!(HistoryRetentionPolicyV1),
        ),
        finish(
            "history.record-page-v1.schema.json",
            schemars::schema_for!(RecordHistoryPageV1),
        ),
        // @ref LLP 0164#owned-artifacts — Rust owns every fork/promotion
        // carrier. Artifact presence remains substrate evidence, not a
        // capability advertisement.
        finish(
            "branch.operation-v1.schema.json",
            schemars::schema_for!(BranchOperationV1),
        ),
        finish(
            "branch.receipt-v1.schema.json",
            schemars::schema_for!(InAppBranchReceiptV1),
        ),
        finish(
            "branch.managed-receipt-v1.schema.json",
            schemars::schema_for!(ManagedInAppBranchReceiptV1),
        ),
        finish(
            "branch.host-create-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchCreateHostInputV1),
        ),
        finish(
            "branch.host-execute-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchExecuteHostInputV1),
        ),
        finish(
            "branch.host-list-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchListHostInputV1),
        ),
        finish(
            "branch.host-id-input-v1.schema.json",
            schemars::schema_for!(ManagedBranchIdHostInputV1),
        ),
        finish(
            "branch.attempt-marker-v1.schema.json",
            schemars::schema_for!(DenyAllAttemptMarkerV1),
        ),
        finish(
            "branch.effect-intent-v1.schema.json",
            schemars::schema_for!(CapturedEffectIntentV1),
        ),
        finish(
            "branch.diff-receipt-v1.schema.json",
            schemars::schema_for!(ForkDiffReceiptV1),
        ),
        finish(
            "promotion.request-v1.schema.json",
            schemars::schema_for!(PromotionRequestV1),
        ),
        finish(
            "promotion.admission-ticket-v1.schema.json",
            schemars::schema_for!(PromotionAdmissionTicketV1),
        ),
        finish(
            "promotion.receipt-v1.schema.json",
            schemars::schema_for!(PromotionReceiptV1),
        ),
        finish(
            "promotion.effect-intent-v1.schema.json",
            schemars::schema_for!(PromotedEffectIntentV1),
        ),
        finish(
            "branch.reap-receipt-v1.schema.json",
            schemars::schema_for!(BranchReapReceiptV1),
        ),
        finish(
            "branch.rebase-receipt-v1.schema.json",
            schemars::schema_for!(RebaseReplayReceiptV1),
        ),
        // The one exported search request schema (LLP 0131 §The search
        // fixture / LLP 0115 CV-5): the Rust parser owns the AST grammar and
        // every other carrier — codegen-emitted client types, the operation
        // args schema's embedded expansion, the provider projection, and the
        // client package's published typings — derives from or verifies
        // against this artifact. `$defs` embeds `SearchQueryAstV1`, the
        // clause/atom types, and the closed filter op/value vocabulary.
        finish(
            "search.request.schema.json",
            schemars::schema_for!(crate::search::types::SearchRequestV1),
        ),
        // @ref LLP 0132#capabilities-targets-and-staging — the numeric
        // profile is a Rust-owned, generated, committed carrier consumed by
        // every independently qualified target.
        finish(
            "vector.distance-profile.schema.json",
            schemars::schema_for!(crate::vector::profile::VectorDistanceProfileArtifactV1),
        ),
        // LLP 0132's public carrier is independently consumable by
        // client/codegen adapters. Operation-specific argument/result
        // contracts add the index's exact dimension and stored-field
        // projection; target capability admission remains separate.
        finish(
            "vector.request.schema.json",
            schemars::schema_for!(crate::vector::VectorRequestV1),
        ),
        finish(
            "vector.item.schema.json",
            schemars::schema_for!(crate::vector::VectorItemV1),
        ),
        finish(
            "vector.page.schema.json",
            schemars::schema_for!(crate::vector::VectorPageV1),
        ),
        finish(
            "seed.artifact.schema.json",
            schemars::schema_for!(SeedArtifactV1),
        ),
        finish(
            "seed.receipt.schema.json",
            schemars::schema_for!(SeedInstallReceiptV1),
        ),
        finish(
            "seed.identity.schema.json",
            schemars::schema_for!(ActiveSeedIdentityV1),
        ),
        finish(
            "seed.expected-stream.schema.json",
            schemars::schema_for!(ExpectedDataVersionStreamV1),
        ),
        finish(
            "seed.matched-observation.schema.json",
            schemars::schema_for!(SeedMatchedObservationV1),
        ),
        finish(
            "seed.ensure-result.schema.json",
            schemars::schema_for!(SeedEnsureResultV1),
        ),
        finish(
            "seed.install-request.schema.json",
            schemars::schema_for!(InstallSeedRequestV1),
        ),
        finish(
            "seed.reset-request.schema.json",
            schemars::schema_for!(ResetSeedRequestV1),
        ),
        finish(
            "seed.preview-request.schema.json",
            schemars::schema_for!(SeedPreviewRequestV1),
        ),
        finish(
            "seed.preview-result.schema.json",
            schemars::schema_for!(SeedPreviewResultV1),
        ),
        // LLP 0109 SS17: the separately versioned seed asset-fixtures artifact.
        finish(
            "seed.asset-fixtures.schema.json",
            schemars::schema_for!(SeedAssetFixturesV1),
        ),
        // LLP 0081 canonical migration artifacts (the Phase C wave-1 types).
        finish(
            "migration.plan.schema.json",
            schemars::schema_for!(MigrationPlanArtifactV1),
        ),
        finish(
            "migration.observation.schema.json",
            schemars::schema_for!(MigrationPreviewObservationV1),
        ),
        finish(
            "migration.approval.schema.json",
            schemars::schema_for!(MigrationApprovalV1),
        ),
        finish(
            "migration.admission.schema.json",
            schemars::schema_for!(MigrationAdmissionV1),
        ),
        // LLP 0081 §7: the restore-derived rehearsal plan.
        finish(
            "migration.rehearsal.schema.json",
            schemars::schema_for!(MigrationRehearsalPlanV1),
        ),
        finish(
            "migration.receipt.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationReceiptV1),
        ),
        finish(
            "migration.rollback-receipt.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationRollbackReceiptV1),
        ),
        finish(
            "migration.journal-entry.schema.json",
            schemars::schema_for!(crate::storage::migration_executor::MigrationJournalEntryV1),
        ),
        // The migration scan's journal-persisted batch checkpoint
        // (LLP 0081 §3/§5) — the Wave-2 executor's durable contract.
        finish(
            "migration.keyset-scan.checkpoint.schema.json",
            schemars::schema_for!(crate::storage::MigrationKeysetScanCheckpointV1),
        ),
        finish(
            "auth.hosted-capabilities.schema.json",
            schemars::schema_for!(HostedAuthCapabilities),
        ),
        finish(
            "auth.hosted-admission.schema.json",
            schemars::schema_for!(HostedAdmission),
        ),
        finish(
            "auth.hosted-admission-envelope.schema.json",
            schemars::schema_for!(HostedAdmissionEnvelope),
        ),
        finish(
            "auth.hosted-admission-key.schema.json",
            schemars::schema_for!(HostedAdmissionKeyFile),
        ),
        finish(
            "auth.external-replay-floor-advance.schema.json",
            schemars::schema_for!(ExternalReplayFloorAdvanceReceipt),
        ),
        finish(
            "auth.hosted-admission-projection.schema.json",
            schemars::schema_for!(HostedAdmissionProjectionReceipt),
        ),
        finish(
            "auth.hosted-admission-refresh.schema.json",
            schemars::schema_for!(HostedAdmissionRefreshReceipt),
        ),
        finish(
            "remote-service.profile.schema.json",
            schemars::schema_for!(RemoteServiceProfile),
        ),
        finish(
            "remote-service.auth-capability.manifest.schema.json",
            schemars::schema_for!(RemoteAuthCapabilityManifest),
        ),
        finish(
            "remote-service.data-capability.manifest.schema.json",
            schemars::schema_for!(RemoteDataCapabilityManifest),
        ),
        finish("diagnostic.schema.json", schemars::schema_for!(Diagnostic)),
        // The carrier evolves independently inside Diagnostic.details; outer
        // Diagnostic and result-envelope versions remain unchanged.
        // @ref LLP 0146#oq6-author-ruling--2026-08-10
        finish_remediation_set(
            "remediation-set.v1.schema.json",
            schemars::schema_for!(RemediationSetV1),
        ),
        finish_remediation_apply(
            "remediation-apply.input.v1.schema.json",
            schemars::schema_for!(RemediationApplyInputV1),
        ),
        finish_remediation_apply(
            "remediation-apply.result.v1.schema.json",
            schemars::schema_for!(RemediationApplyResultV1),
        ),
        finish_remediation_fixtures(
            "remediation-fixtures.v1.schema.json",
            schemars::schema_for!(RemediationFixtureCorpusV1),
        ),
        finish(
            "release.manifest.schema.json",
            schemars::schema_for!(ReleaseManifest),
        ),
        finish(
            "target.descriptor.schema.json",
            schemars::schema_for!(TargetDescriptor),
        ),
        finish(
            "remote-drill.plan.schema.json",
            schemars::schema_for!(RemoteDrillPlan),
        ),
        finish(
            "vm-adapter.request.schema.json",
            schemars::schema_for!(AdapterRequest),
        ),
        finish(
            "vm-adapter.response.schema.json",
            schemars::schema_for!(AdapterResponse),
        ),
        finish(
            "vm-adapter.lifecycle-request.schema.json",
            schemars::schema_for!(AdapterLifecycleRequest),
        ),
        finish(
            "vm-adapter.lifecycle-response.schema.json",
            schemars::schema_for!(AdapterLifecycleResponse),
        ),
        // LLP 0111 hosted Fly v2 carriers. These stay unavailable as public
        // capabilities until their deterministic and real-provider gates pass.
        finish(
            "fly-target.binding-v2.schema.json",
            schemars::schema_for!(FlyTargetBindingV2),
        ),
        finish(
            "hosted-admission-v2.schema.json",
            schemars::schema_for!(HostedAdmissionV2),
        ),
        finish(
            "vm-adapter.lifecycle-request-v2.schema.json",
            schemars::schema_for!(AdapterLifecycleRequestV2),
        ),
        finish(
            "vm-adapter.lifecycle-response-v2.schema.json",
            schemars::schema_for!(AdapterLifecycleResponseV2),
        ),
        finish(
            "provider-effect.intent-v1.schema.json",
            schemars::schema_for!(ProviderEffectIntentV1),
        ),
        finish(
            "provider-effect.observation-v1.schema.json",
            schemars::schema_for!(ProviderEffectObservationV1),
        ),
        finish(
            "provider-effect.terminal-v1.schema.json",
            schemars::schema_for!(ProviderEffectTerminalV1),
        ),
        finish(
            "provider-effect.reconciliation-v1.schema.json",
            schemars::schema_for!(ProviderEffectReconciliationV1),
        ),
        finish(
            "hosted-control-head-v2.schema.json",
            schemars::schema_for!(HostedControlHeadV2),
        ),
        finish(
            "planned-binding.promotion-v1.schema.json",
            schemars::schema_for!(PlannedBindingPromotionV1),
        ),
        finish(
            "hosted-spend-ledger-v1.schema.json",
            schemars::schema_for!(HostedSpendLedgerV1),
        ),
        finish(
            "vm-adapter.cleanup-plan-v1.schema.json",
            schemars::schema_for!(CleanupPlanV1),
        ),
        finish(
            "vm-adapter.cleanup-confirmation-v1.schema.json",
            schemars::schema_for!(CleanupConfirmationV1),
        ),
        finish(
            "vm-adapter.cleanup-receipt-v1.schema.json",
            schemars::schema_for!(CleanupReceiptV1),
        ),
        finish(
            "hosted-product-journey-v1.schema.json",
            schemars::schema_for!(HostedProductJourneyV1),
        ),
        finish(
            "backup.manifest.schema.json",
            schemars::schema_for!(BackupManifest),
        ),
        finish("backup.plan.schema.json", schemars::schema_for!(BackupPlan)),
        finish(
            "control.audit-event.schema.json",
            schemars::schema_for!(ControlAuditEvent),
        ),
        finish(
            "adapter.qualification.schema.json",
            schemars::schema_for!(AdapterQualificationManifest),
        ),
        finish(
            "hosted-auth.drill-receipt.schema.json",
            schemars::schema_for!(HostedAuthDrillReceipt),
        ),
        finish(
            "prepared-release.manifest.schema.json",
            schemars::schema_for!(PreparedReleaseManifest),
        ),
        finish("deploy.plan.schema.json", schemars::schema_for!(DeployPlan)),
        finish(
            "deploy.receipt.schema.json",
            schemars::schema_for!(DeployReceipt),
        ),
        finish(
            "rollback.plan.schema.json",
            schemars::schema_for!(RollbackPlan),
        ),
        finish(
            "restore.plan.schema.json",
            schemars::schema_for!(RestorePlan),
        ),
        finish(
            "restore.activation-plan.schema.json",
            schemars::schema_for!(RestoreActivationPlan),
        ),
        finish(
            "maintenance.receipt.schema.json",
            schemars::schema_for!(MaintenanceReceipt),
        ),
        finish(
            "vm-adapter.query-request.schema.json",
            schemars::schema_for!(AdapterQueryRequest),
        ),
        finish(
            "vm-adapter.query-response.schema.json",
            schemars::schema_for!(AdapterQueryResponse),
        ),
        finish("inspect.schema.json", schemars::schema_for!(InspectState)),
        // @ref LLP 0154#d5--the-query-contract-typed-operations-projected-everywhere — typed query and
        // export carriers are Rust-owned, generated, committed, and drift-gated.
        finish(
            "telemetry.events.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryEventsRequestV1),
        ),
        finish(
            "telemetry.events.response.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryEventsResponseV1),
        ),
        finish(
            "telemetry.stats.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryStatsRequestV1),
        ),
        finish(
            "telemetry.stats.response.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryStatsResponseV1),
        ),
        finish(
            "telemetry.export.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportRequestV1),
        ),
        finish(
            "telemetry.export.header.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportHeaderV1),
        ),
        finish(
            "telemetry.export.event.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportEventV1),
        ),
        finish(
            "telemetry.export.page.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryExportPageV1),
        ),
        finish(
            "telemetry.agent-export.request.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryAgentExportRequestV1),
        ),
        finish(
            "telemetry.agent-export.page.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetryAgentExportPageV1),
        ),
        finish(
            "telemetry.sql-result.schema.json",
            schemars::schema_for!(crate::telemetry_query::TelemetrySqlResultV1),
        ),
        // @ref LLP 0156#e14--surface-typed-operations-projected-everywhere-d5-discipline —
        //   the issue-triage operations and their two authority-tier response
        //   shapes are Rust-owned, committed, and drift-gated.
        finish(
            "errors.issues.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssuesRequestV1),
        ),
        finish(
            "errors.issues.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssuesResponseV1),
        ),
        finish(
            "errors.issue.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssueRequestV1),
        ),
        finish(
            "errors.issue.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsIssueResponseV1),
        ),
        finish(
            "errors.transition.request.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsTransitionRequestV1),
        ),
        finish(
            "errors.transition.response.schema.json",
            schemars::schema_for!(crate::errors_query::ErrorsTransitionResponseV1),
        ),
        finish(
            "inspect.public.schema.json",
            schemars::schema_for!(PublicInspect),
        ),
        finish(
            "storage-info.schema.json",
            schemars::schema_for!(StorageInfo),
        ),
        // LLP 0081 §4's same-landing LLP 0007 amendment: the typed
        // schema-transition event payload (schema-resync / rollback-resync).
        finish(
            "schema-transition.event.schema.json",
            schemars::schema_for!(SchemaTransitionEventBodyV1),
        ),
        finish(
            "host-ops.result.schema.json",
            schemars::schema_for!(HostOpsResult),
        ),
        finish(
            "host-ready.schema.json",
            schemars::schema_for!(HostReadyDescriptor),
        ),
        finish(
            "expected-activation-target.schema.json",
            schemars::schema_for!(ExpectedActivationTargetV1),
        ),
        finish(
            "operational-readiness.schema.json",
            schemars::schema_for!(OperationalReadinessV1),
        ),
        finish(
            "application-ready.schema.json",
            schemars::schema_for!(ApplicationReadyReceiptV1),
        ),
        // The mutationDryRun report (LLP 0051 D8 / Increment 4): the
        // function.explain result the Exact-side Acto dry-run wraps. Embeds
        // CtxAnswerLedger, putting the D1 ledger wire shape under the DK-7
        // gate (the ENG-23892 deferral).
        finish(
            "dry-run.report.schema.json",
            schemars::schema_for!(DryRunReport),
        ),
        finish(
            "inspect.admin.schema.json",
            schemars::schema_for!(AdminInspect),
        ),
        // The client-visible live wire (LLP 0051 D4 / ENG-23891): fan-out
        // envelopes, socket control frames both directions, receipts, the
        // HTTP polling wrapper, the connection grant, the error envelope,
        // and the live HTTP operation outputs.
        finish(
            "live.envelope.schema.json",
            schemars::schema_for!(LiveEnvelope),
        ),
        finish(
            "live.socket-server.schema.json",
            schemars::schema_for!(LiveSocketServerFrame),
        ),
        finish(
            "live.socket-client.schema.json",
            schemars::schema_for!(LiveSocketClientMessage),
        ),
        finish("receipt.schema.json", schemars::schema_for!(Receipt)),
        finish(
            "realtime.envelope.schema.json",
            schemars::schema_for!(RealtimeEnvelope),
        ),
        finish(
            "connection.grant.schema.json",
            schemars::schema_for!(ConnectionGrant),
        ),
        finish(
            "connection.open.input.schema.json",
            schemars::schema_for!(OpenConnectionRequest),
        ),
        finish(
            "auth.request-code.input.schema.json",
            schemars::schema_for!(RequestCodeRequest),
        ),
        finish(
            "auth.session.output.schema.json",
            schemars::schema_for!(AuthSessionResponse),
        ),
        finish(
            "authorized-lease.schema.json",
            schemars::schema_for!(AuthorizedLease),
        ),
        finish(
            "authorized-lease.query.input.schema.json",
            schemars::schema_for!(AuthorizedLeaseQueryRequest),
        ),
        finish(
            "authorized-lease.query.output.schema.json",
            schemars::schema_for!(AuthorizedLeaseQueryResponse),
        ),
        finish(
            "auth.request-code.output.schema.json",
            schemars::schema_for!(RequestCodeResponse),
        ),
        finish(
            "auth.exchange.input.schema.json",
            schemars::schema_for!(ExchangeRequest),
        ),
        finish(
            "auth.password-credential.input.schema.json",
            schemars::schema_for!(PasswordCredentialRequest),
        ),
        finish(
            "auth.password-change.input.schema.json",
            schemars::schema_for!(PasswordChangeRequest),
        ),
        finish(
            "auth.password-reset.input.schema.json",
            schemars::schema_for!(PasswordResetRequest),
        ),
        finish(
            "auth.recovery-consume.input.schema.json",
            schemars::schema_for!(RecoveryConsumeRequest),
        ),
        finish(
            "auth.password-unlock.input.schema.json",
            schemars::schema_for!(PasswordUnlockRequest),
        ),
        finish(
            "auth.password-unlock.output.schema.json",
            schemars::schema_for!(PasswordUnlockResponse),
        ),
        finish(
            "auth.password-attempt-admin.input.schema.json",
            schemars::schema_for!(PasswordAttemptAdminRequest),
        ),
        finish(
            "auth.password-attempt-admin.output.schema.json",
            schemars::schema_for!(PasswordAttemptAdminResponse),
        ),
        finish(
            "auth.credential.output.schema.json",
            schemars::schema_for!(CredentialResponse),
        ),
        finish(
            "auth.empty.input.schema.json",
            schemars::schema_for!(EmptyAuthRequest),
        ),
        finish(
            "auth.family-alarm.output.schema.json",
            schemars::schema_for!(FamilyAlarmResponse),
        ),
        finish(
            "auth.mailbox.query.schema.json",
            schemars::schema_for!(MailboxQuery),
        ),
        finish(
            "auth.mailbox.output.schema.json",
            schemars::schema_for!(MailboxResponse),
        ),
        finish(
            "auth.mint-session.input.schema.json",
            schemars::schema_for!(MintSessionRequest),
        ),
        finish(
            "auth.logical-export.v1.schema.json",
            schemars::schema_for!(AuthLogicalExportV1),
        ),
        finish(
            "auth.logical-import-result.v1.schema.json",
            schemars::schema_for!(AuthLogicalImportOutcomeV1),
        ),
        finish(
            "auth.rehearsal-grant.v1.schema.json",
            schemars::schema_for!(AuthRehearsalGrantV1),
        ),
        finish(
            "auth.rehearsal-window.v1.schema.json",
            schemars::schema_for!(AuthRehearsalWindowV1),
        ),
        finish(
            "auth.rehearsal-reachability.v1.schema.json",
            schemars::schema_for!(AuthRehearsalReachabilityV1),
        ),
        finish(
            "auth.rehearsal-store-markers.v1.schema.json",
            schemars::schema_for!(AuthRehearsalStoreMarkersV1),
        ),
        finish(
            "auth.rehearsal-logical-export.v1.schema.json",
            schemars::schema_for!(AuthRehearsalLogicalExportArtifactV1),
        ),
        finish(
            "auth.rehearsal-mint.input.v1.schema.json",
            schemars::schema_for!(RehearsalMintRequestV1),
        ),
        finish(
            "auth.rehearsal-mint.output.v1.schema.json",
            schemars::schema_for!(RehearsalMintResultV1),
        ),
        finish(
            "auth.rehearsal-exercise.input.v1.schema.json",
            schemars::schema_for!(RehearsalExerciseRequestV1),
        ),
        finish(
            "auth.rehearsal-revoke.input.v1.schema.json",
            schemars::schema_for!(RehearsalRevokeRequestV1),
        ),
        finish(
            "auth.rehearsal-status.input.v1.schema.json",
            schemars::schema_for!(RehearsalStatusRequestV1),
        ),
        finish(
            "auth.rehearsal-status.output.v1.schema.json",
            schemars::schema_for!(crate::storage::auth_rehearsal::RehearsalStatusV1),
        ),
        finish(
            "auth.rescue-colliding-table.input.schema.json",
            schemars::schema_for!(RescueCollidingTableRequest),
        ),
        finish(
            "auth.rescue-colliding-table.output.schema.json",
            schemars::schema_for!(crate::auth::rescue::CollisionRescueResult),
        ),
        // The snapshot bundle endpoint (LLP 0092 §0D.1): request/response of
        // `POST /app/bundle`, exported through the LLP 0051 drift gates.
        finish(
            "app.bundle.input.schema.json",
            schemars::schema_for!(crate::bundle::BundleRequest),
        ),
        finish(
            "app.bundle.output.schema.json",
            schemars::schema_for!(crate::bundle::BundleResponse),
        ),
        // The route→query manifest artifact (LLP 0092 §0C.1): compiled by
        // codegen from `snapback/routes.mjs`, admitted through ensure, and
        // hashed into `generation` as `routeManifestHash`.
        finish(
            "routes.manifest.schema.json",
            schemars::schema_for!(crate::bundle::RoutesManifest),
        ),
        finish(
            "app.ensure.input.schema.json",
            schemars::schema_for!(EnsureAppRequest),
        ),
        finish(
            "app.ensure.output.schema.json",
            schemars::schema_for!(EnsureAppResponse),
        ),
        finish(
            "error.response.schema.json",
            schemars::schema_for!(ErrorResponse),
        ),
        finish(
            "mutation.output.schema.json",
            schemars::schema_for!(MutationResponse),
        ),
        finish(
            "live.subscribe.output.schema.json",
            schemars::schema_for!(LiveSubscribeOutput),
        ),
        finish(
            "live.subscribe.input.schema.json",
            schemars::schema_for!(LiveSubscribeRequest),
        ),
        finish(
            "live.resume.output.schema.json",
            schemars::schema_for!(LiveResumeOutput),
        ),
        // The RQS token-resume resume object (LLP 0091 §0B.1). Named
        // `resume-token` so the token-resume vocabulary never collides with
        // the reattach operation's `live.resume.*` schemas above (§0B.4).
        finish(
            "live.resume-token.schema.json",
            schemars::schema_for!(ResumeWire),
        ),
        finish(
            "live.resume.input.schema.json",
            schemars::schema_for!(LiveResumeInput),
        ),
        finish(
            "live.unsubscribe.output.schema.json",
            schemars::schema_for!(LiveUnsubscribeOutput),
        ),
        finish(
            "live.unsubscribe.input.schema.json",
            schemars::schema_for!(LiveUnsubscribeInput),
        ),
        finish(
            "authorization-invalidation.ack.input.schema.json",
            schemars::schema_for!(AuthorizationInvalidationAckInput),
        ),
        finish(
            "authorization-invalidation.ack.output.schema.json",
            schemars::schema_for!(AuthorizationInvalidationAckOutput),
        ),
        finish(
            "authorization-invalidation.manual-retry.input.schema.json",
            schemars::schema_for!(AuthorizationInvalidationManualRetryInput),
        ),
        finish(
            "authorization-invalidation.manual-retry.output.schema.json",
            schemars::schema_for!(AuthorizationInvalidationManualRetryOutput),
        ),
        finish(
            "query.input.schema.json",
            schemars::schema_for!(FiniteQueryRequest),
        ),
        finish(
            "action.input.schema.json",
            schemars::schema_for!(FunctionCallRequest),
        ),
        finish(
            "mutation.input.schema.json",
            schemars::schema_for!(MutationRequest),
        ),
        finish(
            "client-mutation.ack.input.schema.json",
            schemars::schema_for!(MutationAcknowledgementRequest),
        ),
        finish(
            "client-mutation.ack.output.schema.json",
            schemars::schema_for!(MutationAcknowledgementResponse),
        ),
        // The LLP 0060 D6 private marker envelopes (LLP 0094 §0F item 1 /
        // LLP 0051 §D4): the coordinator→handler invocation request, the
        // handler→coordinator response envelope, and the handler→host call
        // body. Private but not hand-mirror-exempt; semantics stay owned by
        // LLP 0060, these are the served-shape authorities.
        finish(
            "handler.invoke.input.schema.json",
            schemars::schema_for!(HandlerInvokeRequest),
        ),
        finish(
            "handler.invoke.output.schema.json",
            schemars::schema_for!(HandlerInvokeResponse),
        ),
        finish(
            "handler.host-call.input.schema.json",
            schemars::schema_for!(HandlerHostCallRequest),
        ),
        // The hosted kit-socket in-band request/reply grammars (LLP 0094
        // §0A.1 WS-kinds row / §0F item 2).
        finish(
            "live.kit-socket-request.schema.json",
            schemars::schema_for!(KitSocketRequestFrame),
        ),
        finish(
            "live.kit-socket-reply.schema.json",
            schemars::schema_for!(KitSocketReplyFrame),
        ),
        // The bare-array drain response (LLP 0094 §0A.5).
        finish(
            "live.outbox-drain.output.schema.json",
            schemars::schema_for!(OutboxDrainOutput),
        ),
        // Former §0C gap rows (LLP 0094 §0F item 4): families that were
        // serde-typed but not independently schema-committed.
        finish(
            "query.output.schema.json",
            schemars::schema_for!(FunctionResponse<FiniteQueryOutput>),
        ),
        finish(
            "action.output.schema.json",
            schemars::schema_for!(FunctionResponse<FunctionRunResult>),
        ),
        finish(
            "live.socket-client.sessions.schema.json",
            schemars::schema_for!(SessionLiveSocketClientMessage),
        ),
        finish(
            "ephemeral.publish.input.schema.json",
            schemars::schema_for!(PublishRequest),
        ),
        finish(
            "ephemeral.authority-instance-v1.schema.json",
            schemars::schema_for!(EphemeralAuthorityInstanceV1),
        ),
        finish(
            "hosted-ephemeral.facts-v1.schema.json",
            schemars::schema_for!(HostedEphemeralFactsV1),
        ),
        finish(
            "ephemeral.subscribe.input.schema.json",
            schemars::schema_for!(SubscribeRequest),
        ),
        finish(
            "ephemeral.delete.input.schema.json",
            schemars::schema_for!(DeleteRequest),
        ),
        finish(
            "ephemeral.publish.output.schema.json",
            schemars::schema_for!(PublishOutcome),
        ),
        finish(
            "ephemeral.subscribe.output.schema.json",
            schemars::schema_for!(EphemeralMessage),
        ),
        // `/ephemeral/delete` answers the removed entry's final message, or
        // JSON `null` when nothing was present to delete.
        finish(
            "ephemeral.delete.output.schema.json",
            schemars::schema_for!(Option<EphemeralMessage>),
        ),
    ];
    // @ref LLP 0037#dated-alignment-asset-subsystem-artifacts-2026-07-31 —
    // the asset wire and record shapes register like every other Rust-owned
    // artifact; the drift gate covers them through this single generator.
    artifacts.extend(
        crate::assets::schema_registrations()
            .into_iter()
            .map(|(file, schema)| finish(file, schema)),
    );
    // @ref LLP 0062#5-distribution-the-server-advertises-the-server-is-the-version-authority —
    // Rust owns every DTO the server parses or emits; the envelope is the
    // served surface an engine binds to, so its schema is committed here.
    artifacts.extend(
        crate::api_envelope::schema_registrations()
            .into_iter()
            .map(|(file, schema)| finish(file, schema)),
    );
    // @ref LLP 0024#dated-amendment-shared-app-data-result-core-2026-08-01 —
    // the one shared app-data result core every projection (CLI/HTTP/MCP)
    // carries byte-identically; Rust owns the shape, engines construct it.
    artifacts.extend(
        crate::app_data_result::schema_registrations()
            .into_iter()
            .map(|(file, schema)| finish(file, schema)),
    );
    artifacts
}

/// Generated public artifact instances owned by the Rust authority. These are
/// committed beside the schemas so a pinned git checkout is sufficient for a
/// non-Rust consumer.
pub fn artifact_instances() -> Vec<SchemaArtifact> {
    let mut artifacts = vec![
        // The registry-to-wire-schema join is a generated instance, not a
        // second route registry. Every row starts at route_registry(); this
        // projection only attaches committed schema references where a
        // route-specific request or success envelope exists.
        // @ref LLP 0031#enforcement — installed route metadata is the path authority.
        // @ref LLP 0037#decision-ratified-2026-07-02 — referenced wire schemas
        //   are generated Rust-owned artifacts in this same directory.
        SchemaArtifact {
            file: "http.routes.v1.json",
            schema: sorted_keys(http_routes_artifact()),
        },
        // The LLP 0148 id-prefix registry. Codegen reads this to refuse an app
        // table whose derived prefix would shadow a system one, and the client
        // packages read it to mint client-side ids with the same spellings the
        // runtime uses.
        SchemaArtifact {
            file: "id-registry.v1.json",
            schema: sorted_keys(crate::ids::id_registry_artifact()),
        },
        // One Rust-owned global registry shared by every contextual refusal;
        // it is intentionally not keyed by diagnostic code.
        // @ref LLP 0146#oq6-author-ruling--2026-08-10
        SchemaArtifact {
            file: "remediation-kinds.v1.registry.json",
            schema: sorted_keys(crate::remediation::remediation_kind_registry_artifact()),
        },
        SchemaArtifact {
            file: "remediation.wire-fixtures.v1.json",
            schema: sorted_keys(
                serde_json::to_value(crate::remediation::remediation_fixture_corpus())
                    .expect("remediation fixtures serialize to JSON"),
            ),
        },
        // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
        // telemetry and metering consume one versioned class vocabulary and
        // one CI-pinned projection corpus, without sharing a transport.
        SchemaArtifact {
            file: crate::telemetry_contract::OPERATION_CLASS_REGISTRY_FILE,
            schema: sorted_keys(crate::telemetry_contract::operation_class_registry_artifact()),
        },
        SchemaArtifact {
            file: crate::telemetry_contract::PROJECTION_FIXTURE_CORPUS_FILE,
            schema: sorted_keys(crate::telemetry_contract::projection_fixture_corpus()),
        },
        SchemaArtifact {
            file: crate::telemetry_query::QUERY_FIXTURE_CORPUS_FILE,
            schema: sorted_keys(crate::telemetry_query::query_fixture_corpus()),
        },
        SchemaArtifact {
            file: crate::errors_query::ERRORS_FIXTURE_CORPUS_FILE,
            schema: sorted_keys(crate::errors_query::errors_fixture_corpus()),
        },
        SchemaArtifact {
            file: "data-tier.profile.json",
            schema: sorted_keys(
                serde_json::to_value(DataTierProfile::current())
                    .expect("data-tier profile serializes to JSON"),
            ),
        },
        // RelationalResultEncodingV1 golden vectors (LLP 0080 §2): the
        // committed vectors are generated through the encoder itself, so
        // this file, the drift gate, and the runtime cannot diverge.
        SchemaArtifact {
            file: "relational.result-encoding-v1.json",
            schema: sorted_keys(crate::rqs::relational_result_encoding_artifact()),
        },
        // LLP 0081 §2/§3 golden vectors: plan digest/id, canonical step
        // IDs, observation/approval/admission digests, and the synthesized
        // UUIDv7 conformance vectors — generated through the
        // The closed migration state machine and transition relation
        // (LLP 0081 §4), generated through the executor module so the
        // committed enumeration cannot drift from the append-time refusal.
        SchemaArtifact {
            file: "migration.journal-machine.v1.json",
            schema: sorted_keys(crate::storage::migration_executor::migration_journal_artifact()),
        },
        // implementation, byte-pinned in migration::tests.
        SchemaArtifact {
            file: "migration.vectors-v1.json",
            schema: sorted_keys(crate::migration::migration_vectors_artifact()),
        },
        // ContentDigestV1 golden vectors (LLP 0081 §5), generated through
        // the streaming implementation (resume-equality is asserted during
        // generation, so a committed file implies the property).
        SchemaArtifact {
            file: "content-digest.v1.json",
            schema: sorted_keys(crate::rqs::content_digest_artifact()),
        },
        SchemaArtifact {
            file: "boundary-digest.golden-v1.json",
            schema: sorted_keys(crate::proof_checkpoint::boundary_digest_golden_artifact()),
        },
        // The LLP 0093 P-1 conformance fixture corpus (LLP 0095 §2-§3):
        // canonical frames + expected state-machine transitions, generated
        // through the live-wire serde types so fixtures cannot drift from
        // the wire. tests/wire_fixtures_v1.rs proves each fixture's
        // schemaValid claim against the committed family schema.
        SchemaArtifact {
            file: crate::wire_fixtures::WIRE_FIXTURES_FILE,
            schema: sorted_keys(crate::wire_fixtures::wire_fixture_corpus()),
        },
        // The LLP 0131/CV-5 search-AST conformance corpus: accepted/rejected
        // request fixtures generated through the Rust parser (deserialization
        // agreement is asserted during generation), then re-proved against
        // the exported schema and both TypeScript carriers in
        // packages/snapback-codegen/search-ast-fixtures.test.mjs.
        SchemaArtifact {
            file: crate::search::fixtures::SEARCH_AST_FIXTURES_FILE,
            schema: sorted_keys(crate::search::fixtures::search_ast_fixture_corpus()),
        },
        // @ref LLP 0132#distance-profile--the-portable-exactness-answer — the
        // generated instance pins the profile payload, independent expected
        // bits, and its canonical content digest for non-Rust consumers.
        SchemaArtifact {
            file: crate::vector::profile::VECTOR_DISTANCE_PROFILE_FILE,
            schema: sorted_keys(crate::vector::profile::vector_distance_profile_artifact()),
        },
    ];
    // @ref LLP 0156#e01--the-failure-classifier-and-issue-eligibility —
    // committed pure-contract fixtures let Rust and package consumers prove
    // classification, carrier allocation, and fingerprint bytes before any
    // storage or runtime wiring lands.
    artifacts.extend(crate::error_tracking::artifact_instances().into_iter().map(
        |(file, schema)| SchemaArtifact {
            file,
            schema: sorted_keys(schema),
        },
    ));
    artifacts
}

/// Build the versioned route/schema join served to agents beside the Guide.
/// A JSON null is an honest declaration that no route-specific input/success
/// schema is committed; it must not be interpreted as an unconstrained body.
pub fn http_routes_artifact() -> Value {
    let mut routes = crate::server::route_registry();
    routes.sort_by(|left, right| {
        left.path
            .cmp(right.path)
            .then_with(|| left.method.cmp(right.method))
    });
    let routes = routes
        .into_iter()
        .map(|route| {
            let (input, output) = route_schema_refs(route.method, route.path);
            json!({
                "method": route.method,
                "path": route.path,
                "class": format!("{:?}", route.class),
                "path_policy": format!("{:?}", route.path_policy),
                "credential_resolution": format!("{:?}", route.credential_resolution),
                "inputSchema": input.map(schema_ref),
                "outputSchema": output.map(schema_ref),
            })
        })
        .collect::<Vec<_>>();
    json!({
        "formatVersion": "snapback.http-routes.v1",
        "routes": routes,
    })
}

fn schema_ref(file: &str) -> Value {
    json!({ "$ref": file })
}

fn route_schema_refs(method: &str, path: &str) -> (Option<&'static str>, Option<&'static str>) {
    match (method, path) {
        ("GET", "/inspect") => (None, Some("inspect.public.schema.json")),
        ("GET", "/app-api/current") => (None, Some("app-api.discovery.schema.json")),
        // LLP 0204 D2/D9.2: these are envelope-derived presentation
        // projections, not committed Rust-owned wire DTOs. Null is honest.
        ("GET", "/app-api/openapi.json" | "/app-api/agent-skill") => (None, None),
        // LLP 0204 D3: MCP is a JSON-RPC protocol projection generated from
        // the current envelope, not a Rust-owned route DTO. Null is honest.
        ("POST" | "GET" | "DELETE", "/mcp") => (None, None),
        // LLP 0204 D5/D6: these handler-owned v1 DTOs do not yet have a
        // committed standalone artifact schema. Null is honest.
        ("POST", "/api/v1/run" | "/api/v1/ask") => (None, None),
        // LLP 0204 D9.4: v1 capability-link management, inert landing, and
        // invocation use closed handler-owned DTOs. No committed standalone
        // schema artifact exists yet, so both references are honestly null.
        (
            "POST" | "GET" | "DELETE",
            "/capability-links"
            | "/capability-links/{token}"
            | "/capability-links/{token}/invoke"
            | "/capability-links/{id}",
        ) => (None, None),
        // LLP 0204 D9.3: v1 watch management uses closed handler-owned DTOs.
        // No committed standalone artifact schema exists, so null is honest.
        (
            "POST" | "GET" | "DELETE",
            "/watches" | "/watches/{id}" | "/watches/{id}/suspend" | "/watches/{id}/resume",
        ) => (None, None),
        ("GET", "/auth/session") => (None, Some("auth.session.output.schema.json")),
        ("POST", "/auth/request-code") => (
            Some("auth.request-code.input.schema.json"),
            Some("auth.request-code.output.schema.json"),
        ),
        ("POST", "/auth/exchange") => (
            Some("auth.exchange.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/signup" | "/auth/password/signin") => (
            Some("auth.password-credential.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/change") => (
            Some("auth.password-change.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/password/reset") => (
            Some("auth.password-reset.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/recovery/consume") => (
            Some("auth.recovery-consume.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/auth/recovery/rotate") => (
            Some("auth.empty.input.schema.json"),
            Some("auth.credential.output.schema.json"),
        ),
        ("POST", "/_snapback/api/auth/password/unlock") => (
            Some("auth.password-unlock.input.schema.json"),
            Some("auth.password-unlock.output.schema.json"),
        ),
        ("POST", "/_snapback/api/auth/password/attempt") => (
            Some("auth.password-attempt-admin.input.schema.json"),
            Some("auth.password-attempt-admin.output.schema.json"),
        ),
        // LLP 0204 S2 Landing A uses handler-owned closed DTOs; no committed
        // standalone schema artifacts exist yet, so null is honest.
        ("POST", "/auth/integrations/retire") => (None, None),
        ("POST", "/query/{name}" | "/api/v1/query/{name}") => (
            Some("query.input.schema.json"),
            Some("query.output.schema.json"),
        ),
        ("POST", "/query/{name}/authorized-lease") => (
            Some("authorized-lease.query.input.schema.json"),
            Some("authorized-lease.query.output.schema.json"),
        ),
        ("POST", "/mutation/{name}" | "/api/v1/mutation/{name}") => (
            Some("mutation.input.schema.json"),
            Some("mutation.output.schema.json"),
        ),
        ("POST", "/action/{name}" | "/api/v1/action/{name}") => (
            Some("action.input.schema.json"),
            Some("action.output.schema.json"),
        ),
        ("POST", "/client-mutations/acknowledge") => (
            Some("client-mutation.ack.input.schema.json"),
            Some("client-mutation.ack.output.schema.json"),
        ),
        ("POST", "/client-mutations/identity-range") => (
            Some("operation.identity-range-request-v1.schema.json"),
            Some("operation.identity-range-response-v1.schema.json"),
        ),
        ("POST", "/app/bundle") => (
            Some("app.bundle.input.schema.json"),
            Some("app.bundle.output.schema.json"),
        ),
        ("POST", "/app/ensure") => (
            Some("app.ensure.input.schema.json"),
            Some("app.ensure.output.schema.json"),
        ),
        ("POST", "/connection/open") => (
            Some("connection.open.input.schema.json"),
            Some("connection.grant.schema.json"),
        ),
        ("POST", "/live/{name}/subscribe") => (
            Some("live.subscribe.input.schema.json"),
            Some("live.subscribe.output.schema.json"),
        ),
        ("POST", "/live/{name}/unsubscribe") => (
            Some("live.unsubscribe.input.schema.json"),
            Some("live.unsubscribe.output.schema.json"),
        ),
        ("POST", "/live/{name}/resume") => (
            Some("live.resume.input.schema.json"),
            Some("live.resume.output.schema.json"),
        ),
        ("GET", "/outbox/{connection_id}") => (None, Some("live.outbox-drain.output.schema.json")),
        ("POST", "/live/authorization-invalidation/acknowledge") => (
            Some("authorization-invalidation.ack.input.schema.json"),
            Some("authorization-invalidation.ack.output.schema.json"),
        ),
        ("POST", "/live/authorization-invalidation/manual-retry") => (
            Some("authorization-invalidation.manual-retry.input.schema.json"),
            Some("authorization-invalidation.manual-retry.output.schema.json"),
        ),
        ("POST", "/ephemeral/publish") => (
            Some("ephemeral.publish.input.schema.json"),
            Some("ephemeral.publish.output.schema.json"),
        ),
        ("POST", "/ephemeral/subscribe") => (
            Some("ephemeral.subscribe.input.schema.json"),
            Some("ephemeral.subscribe.output.schema.json"),
        ),
        ("POST", "/ephemeral/delete") => (
            Some("ephemeral.delete.input.schema.json"),
            Some("ephemeral.delete.output.schema.json"),
        ),
        ("GET", "/_snapback/api/inspect") => (None, Some("inspect.admin.schema.json")),
        ("GET", "/_snapback/api/control-catalog") => (None, Some("control-catalog.v1.schema.json")),
        (
            "POST",
            "/_snapback/api/auth/integrations/{id}/retire"
            | "/_snapback/api/auth/integrations/{id}/suspend"
            | "/_snapback/api/auth/integrations/{id}/resume",
        ) => (None, None),
        _ => (None, None),
    }
}

/// Convert a derived schema to a stable committed value: serialize it, stamp the
/// Snapback schema version onto its `$id`, and sort keys.
fn finish(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut value = serde_json::to_value(&schema).expect("derived schema serializes to JSON");
    stamp_schema_version(&mut value, file);
    SchemaArtifact {
        file,
        schema: sorted_keys(value),
    }
}

/// Tighten the derive-owned carrier with the ruled literal identities and
/// hard bounds. These constraints are wire semantics, not Rust construction
/// conveniences, so they must be visible to non-Rust validators too.
///
/// @ref LLP 0146#oq6-author-ruling--2026-08-10 — the nested carrier has an
///   independent exact version, at most eight items, and artifact hashes that
///   identify the refusal-time generation.
fn finish_remediation_set(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "schemaVersion",
        crate::remediation::REMEDIATION_SET_SCHEMA_VERSION,
    );
    constrain_root_string(
        &mut artifact.schema,
        "registryVersion",
        crate::remediation::REMEDIATION_KIND_REGISTRY_VERSION,
    );
    if let Some(items) = artifact
        .schema
        .pointer_mut("/properties/items")
        .and_then(Value::as_object_mut)
    {
        items.insert(
            "maxItems".to_owned(),
            Value::from(crate::remediation::REMEDIATION_SET_MAX_ITEMS),
        );
    }
    constrain_artifact_hashes(&mut artifact.schema);
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn finish_remediation_apply(file: &'static str, schema: impl serde::Serialize) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "schemaVersion",
        crate::remediation::REMEDIATION_APPLY_SCHEMA_VERSION,
    );
    constrain_artifact_hashes(&mut artifact.schema);
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn finish_remediation_fixtures(
    file: &'static str,
    schema: impl serde::Serialize,
) -> SchemaArtifact {
    let mut artifact = finish(file, schema);
    constrain_root_string(
        &mut artifact.schema,
        "formatVersion",
        crate::remediation::REMEDIATION_FIXTURE_FORMAT_VERSION,
    );
    artifact.schema = sorted_keys(artifact.schema);
    artifact
}

fn constrain_root_string(schema: &mut Value, name: &str, exact: &str) {
    if let Some(property) = schema
        .pointer_mut(&format!("/properties/{name}"))
        .and_then(Value::as_object_mut)
    {
        property.insert("const".to_owned(), Value::String(exact.to_owned()));
    }
}

fn constrain_artifact_hashes(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if let Some(property) = object
                .get_mut("artifactHash")
                .and_then(Value::as_object_mut)
            {
                property.insert(
                    "pattern".to_owned(),
                    Value::String("^sha256:(?:[0-9a-f]{16}|[0-9a-f]{64})$".to_owned()),
                );
            }
            for child in object.values_mut() {
                constrain_artifact_hashes(child);
            }
        }
        Value::Array(array) => {
            for child in array {
                constrain_artifact_hashes(child);
            }
        }
        _ => {}
    }
}

/// Stamp the Snapback schema version onto the schema's top-level `$id` so every
/// committed file carries its version and can be read without a cargo toolchain.
/// A `SNAPBACK_SCHEMA_VERSION` bump therefore shows up as a reviewable diff on
/// every schema and trips the drift gate — the versioning behavior LLP 0037 and
/// LLP 0012 §Versioning call for. The `$id` uses only same-document fragment
/// `$ref`s below it, so setting a base URI does not change validation.
fn stamp_schema_version(value: &mut Value, file: &str) {
    if let Value::Object(map) = value {
        let stem = file.strip_suffix(".schema.json").unwrap_or(file);
        map.insert(
            "$id".to_owned(),
            Value::String(format!(
                "https://schemas.snapback.dev/{SNAPBACK_SCHEMA_VERSION}/{stem}.schema.json"
            )),
        );
    }
}

/// Recursively sort object keys. `serde_json` runs with `preserve_order` in this
/// workspace (a transitive feature), so without this the committed files would
/// churn on derive/field-order changes; sorting makes the output canonical.
fn sorted_keys(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<(String, Value)> = map.into_iter().collect();
            entries.sort_by(|(a, _), (b, _)| a.cmp(b));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, inner)| (key, sorted_keys(inner)))
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sorted_keys).collect()),
        other => other,
    }
}
