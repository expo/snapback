//! DK-7 / LLP 0037: the Rust serde types are the single source of truth for the
//! Snapback-owned shared artifact shapes. The JSON Schemas under `schemas/` are
//! generated from owner-local registrations assembled by `snapback-tools` and
//! committed. These tests are:
//!   1. the drift gate — committed `schemas/*` byte/value-match the schema the
//!      Rust types generate right now (fails CI on an unregenerated type change);
//!   2. the round-trip gate — a representative value of each artifact serializes
//!      via serde_json and validates against the committed schema, proving the
//!      generated schema matches the actual serde representation;
//!   3. the demo-artifact gate — every committed generated demo manifest
//!      validates against the schema and parses back through the runtime struct.
//!
//! Regenerate the committed schemas with:
//!   DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" \
//!     cargo run -p snapback-tools --bin snapback-schemagen
//!
//! @ref LLP 0037#decision-ratified-2026-07-02 — generated, committed,
//!   drift-gated schemas instead of hand-synced shape definitions.
//! @ref LLP 0032#decision-docket — DK-7 / P3(c): schemars-derived schemas + Rust drift gate.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

use snapback::auth::deployment::{
    AuthenticationBucketPolicy, AuthenticationThrottle, BrowserCredentialPosture,
    BrowserDirectBearerSeam, EffectiveSource, ExternalTls, HOSTED_ADMISSION_MAX_SAFE_INTEGER,
    HostedAdmission, HostedAuthCapabilities, HostedOperatorSurface, SessionInvalidation,
    SharedAuthenticationThrottleConfig,
};
use snapback::commit_envelope::{
    OperationIdentityTombstoneV1, OperationKeyV1, OperationOriginatorClassV1,
    OperationTerminalOutcomeV1,
};
use snapback::cron::{CronInspectState, CronRunOutcome, CronRunRecord, CronRunTrigger};
use snapback::data_tier::{
    DATA_TIER_CORPUS_FORMAT_VERSION, DATA_TIER_CORPUS_NAME, DATA_TIER_PROFILE_FILE,
    DataTierCaseExpectation, DataTierCaseSchema, DataTierCorpusCase, DataTierCorpusCaseEntry,
    DataTierCorpusManifest, DataTierProfile,
};
use snapback::deploy::{
    AdapterEvidenceRef, AdapterLifecycleOperation, AdapterLifecycleRequest,
    AdapterLifecycleRequestVersion, AdapterLifecycleResponse, AdapterLifecycleResponseVersion,
    AdapterOperation, AdapterOperationPlan, AdapterQualificationClaim,
    AdapterQualificationEvidence, AdapterQualificationManifest, AdapterQuery,
    AdapterQueryOperation, AdapterQueryRequest, AdapterQueryRequestVersion, AdapterQueryResponse,
    AdapterQueryResponseVersion, AdapterRequest, AdapterRequestVersion, AdapterResponse,
    AdapterResponseVersion, AdapterSafeDiagnostic, AuthenticatedInspection, BackupComponent,
    BackupManifest, ControlLogEntry, ControlLogPage, ControlOperationSummary, CredentialStatus,
    DeployPlan, DeployPlanArtifactKind, DeployPlanStep, DeployPlanVersion, DeployReceipt,
    DeployReceiptOutcome, DeployStepReceipt, DeployStepState, DeploymentLease, DeploymentState,
    ExternalReplayFloorAdvanceReceipt, ExternalReplayFloorAdvanceVersion,
    HostedAdmissionProjectionReceipt, HostedAdmissionProjectionVersion,
    HostedAdmissionRefreshReceipt, HostedAdmissionRefreshVersion, HostedAuthDrillReceipt,
    HostedAuthLiveHealth, HostedProductJourneyV1, InspectionFact, MaintenanceReceipt,
    MaintenanceReceiptKind, MaintenanceReceiptOutcome, PreparedReleaseEvidence,
    PreparedReleaseEvidenceKind, PreparedReleaseManifest, RedactedLogField, ReleaseArtifactKind,
    ReleaseCompatibility, ReleaseCompatibilityEnvelope, ReleaseComponent, ReleaseGap,
    ReleaseManifest, ReleaseManifestVersion, ReleaseScan, ReleaseSource, ReleaseToolchain,
    RemoteDrillCostBoundary, RemoteDrillCostComponent, RemoteDrillCredentials, RemoteDrillLogs,
    RemoteDrillNonclaim, RemoteDrillPlan, RemoteDrillPlanVersion, RemoteDrillProvisioningAuthority,
    RemoteDrillStorage, RemoteDrillSupervisor, RemoteDrillSupervisorKind, RemoteDrillTls,
    RestoreActivationPlan, RestoreActivationPlanStep, RestorePlan, RestorePlanStep, RestoreResult,
    RollbackMode, RollbackPlan, RollbackPlanStep, TargetDescriptor, TargetDescriptorVersion,
    TargetObservation, TargetProductionClass, VmAdapterDescriptor, VmAdapterKind,
};
use snapback::diagnostic::Diagnostic;
use snapback::ephemeral::{EphemeralDiagnostics, EphemeralRoomDiagnostics, Scope};
use snapback::live_coalesce::LiveCoalesceStats;
use snapback::local::{
    InspectState, LiveAuthorityLaneStats, LiveDeliveryStats, LiveEvaluationStats,
    LiveMatcherDecisionStats, LiveResumeInput, LiveSettlementStats, LiveSubscribeInput,
    LiveUnsubscribeInput, LiveWatermarkStats, MaintenanceDiagnostics, PublicInspect,
};
use snapback::manifest::{
    ArtifactGeneration, AuthInput, AuthorityDescriptor, CLIENT_MUTATION_ACK_MAX_IDS,
    CTX_ANSWER_LEDGER_MAX_IDS, CapabilityManifest, CapabilityManifestLocalExt as _,
    ConfigEntryDefinition, CronJobDefinition, CronSchedule, FunctionManifest, HandlerInput,
    MutationAcknowledgementRequest, MutationAcknowledgementResponse, MutationPlan, MutationRequest,
    REPLAY_OPAQUE_ID_MAX_BYTES, REPLAY_OPAQUE_ID_PATTERN, SNAPBACK_SCHEMA_VERSION, SchemaManifest,
    SchemaManifestValidationExt as _, SettlementLane, SourceSpan,
    TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX,
};
use snapback::result_transform::{
    RESULT_TRANSFORM_V1_CASE_SCHEMA_FILE, RESULT_TRANSFORM_V1_CORPUS,
    RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION, RESULT_TRANSFORM_V1_CORPUS_SCHEMA_FILE,
    RESULT_TRANSFORM_V1_PROFILE_VERSION, ResultTransformCorpusBaselineV1,
    ResultTransformCorpusCaseEntryV1, ResultTransformCorpusCaseV1,
    ResultTransformCorpusExpectationV1, ResultTransformCorpusManifestV1,
    ResultTransformEvaluatorIdentitiesV1,
};
use snapback::runtime::{
    CapabilityState, IbexCliCapability, IbexSubmoduleCapability, RuntimeCapabilities,
};
use snapback::service_profile::{
    PublishedArtifactRef, RemoteAuthCapabilityManifest, RemoteCredentialPolicy,
    RemoteDataCapabilityManifest, RemoteEndpointPolicy, RemoteServiceDataTierIdentity,
    RemoteServiceGitPublication, RemoteServiceOperation, RemoteServiceProfile,
};
use snapback_kernel::storage::{ClientMutationRetentionInfo, StorageInfo};
use snapback_server::schema_export::{
    http_routes_artifact, vite_first_party_auth_relay_routes_artifact,
};
use snapback_types::schema_export::{EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS, SchemaArtifact};

fn artifact_schemas() -> Vec<SchemaArtifact> {
    let mut artifacts = snapback_types::schema_export::schema_registrations();
    artifacts.extend(snapback_kernel::schema_export::schema_registrations());
    artifacts.extend(snapback_auth::schema_export::schema_registrations());
    artifacts.extend(snapback_activation::schema_export::schema_registrations());
    artifacts.extend(snapback_services::schema_export::schema_registrations());
    artifacts.extend(snapback_sync::schema_export::schema_registrations());
    artifacts.extend(snapback_engine::schema_export::schema_registrations());
    artifacts.extend(snapback_server::schema_export::schema_registrations());
    artifacts
}

fn artifact_instances() -> Vec<SchemaArtifact> {
    let mut artifacts = snapback_types::schema_export::artifact_instances();
    artifacts.extend(snapback_kernel::schema_export::artifact_instances());
    artifacts.extend(snapback_services::schema_export::artifact_instances());
    artifacts.extend(snapback_sync::schema_export::artifact_instances());
    artifacts.extend(snapback_server::schema_export::artifact_instances());
    artifacts
}

fn retention_info() -> ClientMutationRetentionInfo {
    ClientMutationRetentionInfo {
        records: 2,
        bytes: 512,
        gc_total: 3,
        max_records: 10_000,
        max_bytes: 67_108_864,
        max_result_bytes: 65_536,
    }
}

#[test]
fn external_run_schema_join_is_intentionally_null_until_executor_promotion() {
    let artifact = http_routes_artifact();
    let rows = artifact["routes"]
        .as_array()
        .expect("HTTP route/schema join rows");
    let matching = rows
        .iter()
        .filter(|row| row["method"] == "POST" && row["path"] == "/api/v1/run")
        .collect::<Vec<_>>();
    assert_eq!(matching.len(), 1, "registered run route has one schema row");
    assert_eq!(matching[0]["inputSchema"], Value::Null);
    assert_eq!(matching[0]["outputSchema"], Value::Null);
}

fn representative_authentication_throttle_config() -> SharedAuthenticationThrottleConfig {
    let policy = AuthenticationBucketPolicy {
        interval_ms: 10,
        burst: 200,
        maximum_denial_debt_attempts: 100,
    };
    SharedAuthenticationThrottleConfig {
        retention_ms: 900_000,
        maximum_key_count: 100_000,
        global: policy,
        source: policy,
        subject: policy,
        source_subject: policy,
        family: policy,
    }
}

fn representative_hosted_admission() -> HostedAdmission {
    HostedAdmission {
        version: 1,
        deployment_id: "deployment-1".to_owned(),
        configuration_sha256: "a".repeat(64),
        support_sha256: "b".repeat(64),
        admission_epoch: 7,
        sender_replay_epoch_floor: 17,
        issued_at_ms: 1_000,
        expires_at_ms: 301_000,
        limiter_epoch: 11,
        authentication_throttle_config: representative_authentication_throttle_config(),
        invalidation_epoch: 13,
        handler_protocol_version: 1,
        handler_incarnation: "handler-1".to_owned(),
        operator_surface: HostedOperatorSurface::Disabled,
        browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
        hosted_auth: HostedAuthCapabilities {
            external_tls: ExternalTls::Enforced,
            effective_source: EffectiveSource::Trusted,
            authentication_throttle: AuthenticationThrottle::SharedEnforced,
            session_invalidation: SessionInvalidation::GloballyFenced,
            client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
        },
    }
}

fn representative_release_manifest() -> ReleaseManifest {
    ReleaseManifest {
        artifact_kind: ReleaseArtifactKind::ReleaseManifest,
        schema_version: ReleaseManifestVersion::V1,
        release_id: format!("sha256:{}", "a".repeat(64)),
        project_id: "checkpoint".to_owned(),
        target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
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
            node_version: "v24.18.0".to_owned(),
            package_manager: Some("bun@1.3.12".to_owned()),
        },
        compatibility: ReleaseCompatibility {
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            auth_mode: "dev".to_owned(),
            schema_sha256: format!("sha256:{}", "c".repeat(64)),
            functions_sha256: format!("sha256:{}", "d".repeat(64)),
            capability_sha256: format!("sha256:{}", "e".repeat(64)),
            inputs_sha256: format!("sha256:{}", "f".repeat(64)),
        },
        required_capabilities: vec!["live_subscriptions".to_owned()],
        components: vec![ReleaseComponent {
            path: "components/app/schema.manifest.json".to_owned(),
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

fn representative_target_descriptor() -> TargetDescriptor {
    TargetDescriptor {
        schema_version: TargetDescriptorVersion::V1,
        target_id: "target-preview-1".to_owned(),
        project_id: "checkpoint".to_owned(),
        environment_id: "preview-1".to_owned(),
        deployment_id: "deployment-1".to_owned(),
        database_id: "database-1".to_owned(),
        stream_incarnation: "stream-1".to_owned(),
        target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
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

fn representative_target_observation() -> TargetObservation {
    let target = representative_target_descriptor();
    TargetObservation {
        target_id: target.target_id,
        environment_id: target.environment_id,
        deployment_id: target.deployment_id,
        database_id: target.database_id,
        stream_incarnation: target.stream_incarnation,
        target_profile_id: target.target_profile_id,
        provider: target.adapter.provider,
        account_fingerprint: target.adapter.account_fingerprint,
        region: target.adapter.region,
        public_origin: target.adapter.public_origin,
        resource_id: "vm-fixture-1".to_owned(),
        state: DeploymentState::Registered,
        activation_generation: 0,
        active_release_id: None,
        application_sentinel_sha256: None,
        credential_status: CredentialStatus::Ready,
        provider_facts_sha256: format!("sha256:{}", "3".repeat(64)),
        observed_at_ms: 2,
        capability_gaps: vec!["hosted-auth".to_owned()],
    }
}

fn representative_deployment_lease() -> DeploymentLease {
    DeploymentLease {
        lease_id: "lease-target-preview-1".to_owned(),
        target_id: "target-preview-1".to_owned(),
        operation_id: "plan-op".to_owned(),
        expected_activation_generation: 0,
        acquired_at_ms: 20,
        expires_at_ms: 120_020,
    }
}

fn representative_backup_manifest() -> BackupManifest {
    BackupManifest {
        schema_version: "snapback.backup-manifest.v1".to_owned(),
        backup_id: format!("sha256:{}", "9".repeat(64)),
        operation_id: "plan-op".to_owned(),
        target_id: "target-preview-1".to_owned(),
        deployment_id: "deployment-1".to_owned(),
        database_id: "database-1".to_owned(),
        stream_incarnation: "stream-1".to_owned(),
        release_id: None,
        schema_identity_sha256: format!("sha256:{}", "a".repeat(64)),
        encryption_class: "external-key".to_owned(),
        storage_class: "object-store".to_owned(),
        retention_policy: "seven-days".to_owned(),
        components: vec![BackupComponent {
            kind: "sqliteSnapshot".to_owned(),
            sha256: format!("sha256:{}", "b".repeat(64)),
            bytes: 64,
            objects: 1,
            verified: true,
        }],
        excluded_secret_classes: vec![
            "application-secrets".to_owned(),
            "control-plane-credentials".to_owned(),
        ],
        created_at_ms: 30,
        verified_at_ms: 31,
    }
}

fn representative_deploy_plan() -> DeployPlan {
    let target = representative_target_descriptor();
    let observation = representative_target_observation();
    DeployPlan {
        artifact_kind: DeployPlanArtifactKind::DeployPlan,
        schema_version: DeployPlanVersion::V1,
        plan_id: format!("sha256:{}", "4".repeat(64)),
        operation_id: "plan-op".to_owned(),
        reason: "representative planning proof".to_owned(),
        target_id: target.target_id,
        project_id: target.project_id,
        environment_id: target.environment_id,
        deployment_id: target.deployment_id,
        database_id: target.database_id,
        stream_incarnation: target.stream_incarnation,
        target_profile_id: target.target_profile_id,
        production_class: target.production_class,
        target_descriptor_sha256: format!("sha256:{}", "5".repeat(64)),
        target_observation_sha256: format!("sha256:{}", "6".repeat(64)),
        observed_activation_generation: observation.activation_generation,
        observed_active_release_id: observation.active_release_id,
        release_id: format!("sha256:{}", "7".repeat(64)),
        release_manifest_sha256: format!("sha256:{}", "8".repeat(64)),
        prepared_release_id: None,
        prepared_release_manifest_sha256: None,
        steps: vec![
            DeployPlanStep::VerifyIdentity,
            DeployPlanStep::AcquireLease,
            DeployPlanStep::UploadImmutableRelease,
            DeployPlanStep::ProvisionInactive,
            DeployPlanStep::CompatibilityPreflight,
            DeployPlanStep::CreateVerifiedBackup,
            DeployPlanStep::StageRelease,
            DeployPlanStep::ActivateGeneration,
            DeployPlanStep::VerifyServedPath,
            DeployPlanStep::ReleaseLease,
            DeployPlanStep::RollbackOnFailure,
        ],
        blockers: vec![ReleaseGap {
            id: "adapter.hosted-auth".to_owned(),
            reason: "hosted auth remains a GAP".to_owned(),
            blocking: true,
        }],
        apply_eligible: false,
        confirmation: format!("confirm:sha256:{}", "4".repeat(64)),
        created_at_ms: 10_000,
        expires_at_ms: 910_000,
    }
}

fn representative_rollback_plan() -> RollbackPlan {
    let target = representative_target_descriptor();
    RollbackPlan {
        schema_version: "snapback.rollback-plan.v1".to_owned(),
        plan_id: format!("sha256:{}", "1".repeat(64)),
        operation_id: "rollback-op".to_owned(),
        reason: "return to the prior compatible release".to_owned(),
        target_id: target.target_id,
        project_id: target.project_id,
        environment_id: target.environment_id,
        deployment_id: target.deployment_id,
        database_id: target.database_id,
        stream_incarnation: target.stream_incarnation,
        target_profile_id: target.target_profile_id,
        production_class: target.production_class,
        target_descriptor_sha256: format!("sha256:{}", "2".repeat(64)),
        target_observation_sha256: format!("sha256:{}", "3".repeat(64)),
        observed_activation_generation: 7,
        observed_active_release_id: format!("sha256:{}", "4".repeat(64)),
        destination_release_id: format!("sha256:{}", "5".repeat(64)),
        destination_prepared_release_id: format!("sha256:{}", "6".repeat(64)),
        compatibility_sha256: format!("sha256:{}", "7".repeat(64)),
        steps: vec![
            RollbackPlanStep::VerifyIdentity,
            RollbackPlanStep::AcquireLease,
            RollbackPlanStep::VerifyCompatibility,
            RollbackPlanStep::Rollback,
            RollbackPlanStep::VerifyServedPath,
            RollbackPlanStep::ReleaseLease,
        ],
        blockers: vec![],
        apply_eligible: true,
        confirmation: format!("confirm:sha256:{}", "1".repeat(64)),
        created_at_ms: 100,
        expires_at_ms: 900_100,
    }
}

fn representative_restore_plan() -> RestorePlan {
    let target = representative_target_descriptor();
    RestorePlan {
        schema_version: "snapback.restore-plan.v1".to_owned(),
        plan_id: format!("sha256:{}", "8".repeat(64)),
        operation_id: "restore-op".to_owned(),
        reason: "isolated restore drill".to_owned(),
        source_target_id: "target-source-1".to_owned(),
        backup_id: format!("sha256:{}", "9".repeat(64)),
        backup_manifest_sha256: format!("sha256:{}", "a".repeat(64)),
        destination_target_id: target.target_id,
        project_id: target.project_id,
        environment_id: target.environment_id,
        deployment_id: target.deployment_id,
        database_id: target.database_id,
        stream_incarnation: target.stream_incarnation,
        target_profile_id: target.target_profile_id,
        production_class: target.production_class,
        target_descriptor_sha256: format!("sha256:{}", "b".repeat(64)),
        target_observation_sha256: format!("sha256:{}", "c".repeat(64)),
        observed_activation_generation: 0,
        observed_active_release_id: None,
        replacement_release_id: None,
        destination_sentinel_sha256: None,
        steps: vec![
            RestorePlanStep::VerifyIdentity,
            RestorePlanStep::AcquireLease,
            RestorePlanStep::FenceExternalEffects,
            RestorePlanStep::RestoreBackupInactive,
            RestorePlanStep::VerifyRestoredComponents,
            RestorePlanStep::VerifyRestoredApplication,
            RestorePlanStep::ReleaseLease,
        ],
        blockers: vec![],
        apply_eligible: true,
        confirmation: format!("destroy-and-restore:sha256:{}", "8".repeat(64)),
        created_at_ms: 100,
        expires_at_ms: 900_100,
    }
}

fn representative_restore_result() -> RestoreResult {
    RestoreResult {
        backup_id: format!("sha256:{}", "9".repeat(64)),
        source_target_id: "target-source-1".to_owned(),
        source_deployment_id: "source-deployment".to_owned(),
        source_database_id: "source-database".to_owned(),
        source_stream_incarnation: "source-stream".to_owned(),
        destination_target_id: "target-preview-1".to_owned(),
        destination_deployment_id: "deployment-1".to_owned(),
        destination_database_id: "database-1".to_owned(),
        destination_stream_incarnation: "stream-1".to_owned(),
        restore_epoch: 1,
        effects_fenced: true,
        components_verified: true,
        application_sentinel_sha256: format!("sha256:{}", "d".repeat(64)),
        acceptance_sha256: format!("sha256:{}", "e".repeat(64)),
        external_effects_disabled: true,
        activated: false,
    }
}

fn representative_restore_activation_plan() -> RestoreActivationPlan {
    RestoreActivationPlan {
        schema_version: "snapback.restore-activation-plan.v1".to_owned(),
        plan_id: format!("sha256:{}", "0".repeat(64)),
        operation_id: "restore-activate-op".to_owned(),
        reason: "activate verified isolated restore".to_owned(),
        restore_receipt_id: format!("sha256:{}", "1".repeat(64)),
        backup_id: format!("sha256:{}", "9".repeat(64)),
        target_id: "target-preview-1".to_owned(),
        deployment_id: "deployment-1".to_owned(),
        database_id: "database-1".to_owned(),
        stream_incarnation: "stream-1".to_owned(),
        target_descriptor_sha256: format!("sha256:{}", "2".repeat(64)),
        target_observation_sha256: format!("sha256:{}", "3".repeat(64)),
        observed_activation_generation: 1,
        restored_release_id: None,
        prepared_release_id: format!("sha256:{}", "4".repeat(64)),
        prepared_release_manifest_sha256: format!("sha256:{}", "5".repeat(64)),
        adapter_qualification_id: format!("sha256:{}", "6".repeat(64)),
        adapter_qualification_sha256: format!("sha256:{}", "7".repeat(64)),
        application_sentinel_sha256: format!("sha256:{}", "d".repeat(64)),
        steps: vec![
            RestoreActivationPlanStep::VerifyIdentity,
            RestoreActivationPlanStep::VerifyPausedRestore,
            RestoreActivationPlanStep::AcquireLease,
            RestoreActivationPlanStep::ActivateRestoredGeneration,
            RestoreActivationPlanStep::VerifyServedPath,
            RestoreActivationPlanStep::ReleaseLease,
        ],
        blockers: vec![],
        apply_eligible: true,
        confirmation: format!("activate-restore:sha256:{}", "0".repeat(64)),
        created_at_ms: 200,
        expires_at_ms: 900_200,
    }
}

fn schemas_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join("schemas")
}

fn committed(file: &str) -> Value {
    let path = schemas_dir().join(file);
    let text = fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "{file} is missing; regenerate with `cargo run -p snapback-tools --bin snapback-schemagen` \
             (LLP 0037 / LLP 0032 P3c)"
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("parse committed {file}: {error}"))
}

fn assert_validates(file: &str, value: &Value) {
    let schema = committed(file);
    let validator = jsonschema::validator_for(&schema)
        .unwrap_or_else(|error| panic!("compile committed {file}: {error}"));
    let errors: Vec<String> = validator
        .iter_errors(value)
        .map(|error| format!("  {}: {error}", error.instance_path()))
        .collect();
    assert!(
        errors.is_empty(),
        "a representative value does not validate against the committed {file} — \
         the generated schema does not match the serde representation (schemars/serde \
         mismatch):\n{}",
        errors.join("\n")
    );
}

fn assert_rejects(file: &str, value: &Value) {
    let schema = committed(file);
    let validator = jsonschema::validator_for(&schema)
        .unwrap_or_else(|error| panic!("compile committed {file}: {error}"));
    assert!(
        !validator.is_valid(value),
        "an out-of-contract value unexpectedly validates against {file}: {value}"
    );
}

#[test]
fn mutation_replay_bounds_match_the_public_data_tier_profile() {
    let schema = committed("mutation.input.schema.json");
    let profile = DataTierProfile::current();
    let client_id = &schema["properties"]["clientMutationId"];
    let acknowledged_ids = &schema["properties"]["acknowledgedClientMutationIds"];
    let ledger_ids = &schema["$defs"]["CtxAnswerLedger"]["properties"]["ids"];
    assert_eq!(
        schema["properties"]["wireVersion"]["type"],
        json!(["string", "null"])
    );

    assert_eq!(client_id["minLength"], json!(1));
    assert_eq!(client_id["maxLength"], json!(REPLAY_OPAQUE_ID_MAX_BYTES));
    assert_eq!(client_id["pattern"], json!(REPLAY_OPAQUE_ID_PATTERN));
    assert_eq!(
        acknowledged_ids["maxItems"],
        json!(CLIENT_MUTATION_ACK_MAX_IDS)
    );
    assert_eq!(acknowledged_ids["items"]["minLength"], json!(1));
    assert_eq!(
        acknowledged_ids["items"]["maxLength"],
        json!(REPLAY_OPAQUE_ID_MAX_BYTES)
    );
    assert_eq!(
        acknowledged_ids["items"]["pattern"],
        json!(REPLAY_OPAQUE_ID_PATTERN)
    );
    assert_eq!(ledger_ids["maxItems"], json!(profile.bounds.max_ledger_ids));
    assert_eq!(
        ledger_ids["items"]["maxLength"],
        json!(profile.bounds.max_ledger_id_bytes)
    );
    assert_eq!(
        ledger_ids["items"]["pattern"],
        json!(profile.bounds.opaque_id_pattern)
    );
    assert_eq!(profile.bounds.max_ledger_ids, CTX_ANSWER_LEDGER_MAX_IDS);

    let base = serde_json::to_value(MutationRequest {
        input: HandlerInput::default(),
        media_command: None,
        settlement: Default::default(),
        expected_generation: None,
        wire_version: Some("snapback.v1".to_owned()),
        client_mutation_id: Some("cm_valid".to_owned()),
        operation_issuance: None,
        authority_descriptor: Some(AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: "018f0d90-7b24-7a22-8c33-445566778899".to_owned(),
            session_generation: 1,
        }),
        acknowledged_client_mutation_ids: Vec::new(),
    })
    .unwrap();
    for invalid in [String::new(), "bad/id".to_owned(), "x".repeat(257)] {
        let mut request = base.clone();
        request["clientMutationId"] = json!(invalid);
        assert_rejects("mutation.input.schema.json", &request);
    }
    for invalid in [String::new(), "bad/id".to_owned(), "x".repeat(257)] {
        let mut request = base.clone();
        request["acknowledgedClientMutationIds"] = json!([invalid.clone()]);
        assert_rejects("mutation.input.schema.json", &request);

        let standalone = json!({
            "auth": {},
            "clientMutationIds": [invalid],
        });
        assert_rejects("client-mutation.ack.input.schema.json", &standalone);
    }

    let mut too_many = base.clone();
    too_many["ctx_ledger"] = json!({
        "version": 1,
        "ids": vec!["id"; CTX_ANSWER_LEDGER_MAX_IDS + 1],
        "now": 1,
    });
    assert_rejects("mutation.input.schema.json", &too_many);

    let mut bad_ledger_id = base;
    bad_ledger_id["ctx_ledger"] = json!({
        "version": 1,
        "ids": ["bad/id"],
        "now": 1,
    });
    assert_rejects("mutation.input.schema.json", &bad_ledger_id);
}

/// Drift gate: what the Rust types generate now must equal what is committed.
#[test]
fn dk7_committed_schemas_match_rust_types() {
    // JSON Schema `$defs` names are scoped to one artifact, not one merged
    // repository namespace. In particular, `EffectSettlementCapabilityV1`
    // intentionally names the five-value commit-envelope vocabulary in
    // `commit.envelope-v1` and the three-value promotion intent vocabulary in
    // `promotion.effect-intent-v1`; this checker compares each independently.
    for SchemaArtifact { file, schema } in artifact_schemas() {
        let on_disk = committed(file);
        assert_eq!(
            on_disk, schema,
            "{file} drifted from the Rust types; regenerate with \
             `cargo run -p snapback-tools --bin snapback-schemagen` (LLP 0037 / LLP 0032 P3c)"
        );
    }

    let declaration_gate = std::process::Command::new("node")
        .current_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .args([
            "scripts/check-agent-safe-publication.mjs",
            "--codegen-declarations-only",
        ])
        .output()
        .expect("run the Node-only AgentSafe codegen declaration drift gate");
    assert!(
        declaration_gate.status.success(),
        "AgentSafe codegen declarations drifted from the committed schemas:\n{}{}",
        String::from_utf8_lossy(&declaration_gate.stdout),
        String::from_utf8_lossy(&declaration_gate.stderr),
    );
}

#[test]
fn dk7_password_minimum_is_owned_by_auth_with_runtime_bounds() {
    let schema = committed("schema.manifest.schema.json");
    let auth_property = &schema["$defs"]["AuthManifest"]["properties"]["passwordMinimumLength"];
    assert_eq!(
        auth_property["minimum"],
        json!(snapback::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR)
    );
    assert_eq!(
        auth_property["maximum"],
        json!(snapback::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_CEILING)
    );
    assert!(
        schema["$defs"]["ApiAskManifest"]["properties"]
            .get("passwordMinimumLength")
            .is_none(),
        "passwordMinimumLength belongs to AuthManifest, never ApiAskManifest",
    );

    let mut manifest = serde_json::to_value(SchemaManifest::default()).unwrap();
    manifest["auth"] = json!({
        "mode": "sessions",
        "passwordMinimumLength": 12,
    });
    assert_validates("schema.manifest.schema.json", &manifest);

    for outside in [
        snapback::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR - 1,
        snapback::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_CEILING + 1,
    ] {
        manifest["auth"]["passwordMinimumLength"] = json!(outside);
        assert_rejects("schema.manifest.schema.json", &manifest);
    }

    manifest["auth"] = json!({ "mode": "sessions" });
    manifest["api"] = json!({
        "ask": {
            "enabled": true,
            "billing": "app",
            "passwordMinimumLength": 12,
        }
    });
    assert_rejects("schema.manifest.schema.json", &manifest);
}

#[test]
fn dk7_committed_public_instances_match_rust_types() {
    for SchemaArtifact { file, schema } in artifact_instances() {
        let on_disk = committed(file);
        assert_eq!(
            on_disk, schema,
            "{file} drifted from the Rust authority; regenerate with `cargo run -p snapback-tools --bin snapback-schemagen`"
        );
        if file == "http.routes.v1.json" {
            let routes = schema["routes"].as_array().expect("HTTP route rows");
            assert_eq!(routes.len(), snapback::server::route_registry().len());
            for route in routes {
                for member in ["inputSchema", "outputSchema"] {
                    let Some(reference) = route[member].get("$ref").and_then(Value::as_str) else {
                        continue;
                    };
                    assert!(
                        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
                            .join("schemas")
                            .join(reference)
                            .is_file(),
                        "{} {} references missing schema {reference}",
                        route["method"],
                        route["path"]
                    );
                }
            }
        }
    }
}

#[test]
fn vite_first_party_auth_relay_routes_match_the_server_route_authority() {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("packages/snapback-vite/first-party-auth-relay-routes.generated.json");
    let committed: Value = serde_json::from_slice(
        &std::fs::read(&path).expect("read committed Vite auth relay route projection"),
    )
    .expect("parse committed Vite auth relay route projection");
    assert_eq!(
        committed,
        vite_first_party_auth_relay_routes_artifact(),
        "Vite password/recovery relay routes drifted from the server authority; regenerate with `cargo run -p snapback-tools --bin snapback-schemagen`"
    );
}

#[test]
fn operation_identity_tombstone_schema_accepts_required_nullable_host_counter() {
    let tombstone = OperationIdentityTombstoneV1 {
        schema_version: 1,
        key: OperationKeyV1 {
            stream_id: "stream-1".to_owned(),
            originator_class: OperationOriginatorClassV1::Host,
            operation_id: "host-operation-1".to_owned(),
        },
        identity_digest: format!("sha256:{}", "a".repeat(64)),
        auth_facts_digest: format!("sha256:{}", "b".repeat(64)),
        audience: "host-audience-1".to_owned(),
        epoch_id: "host-epoch-1".to_owned(),
        counter: None,
        terminal_outcome: OperationTerminalOutcomeV1::Committed,
        receipt_digest: format!("sha256:{}", "c".repeat(64)),
        retained_at_ms: 10,
    };
    let value = serde_json::to_value(tombstone).expect("host tombstone serializes");
    assert_eq!(value.get("counter"), Some(&Value::Null));
    assert_validates("operation.identity-tombstone-v1.schema.json", &value);
    let mut missing_counter = value;
    missing_counter
        .as_object_mut()
        .expect("tombstone object")
        .remove("counter");
    assert!(
        serde_json::from_value::<OperationIdentityTombstoneV1>(missing_counter).is_err(),
        "Rust decoding and the committed schema both require the nullable counter key"
    );
}

#[test]
fn result_transform_d5_extension_envelopes_match_the_generated_schemas() {
    let case = ResultTransformCorpusCaseV1 {
        corpus: RESULT_TRANSFORM_V1_CORPUS.to_owned(),
        corpus_version: RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION,
        name: "empty-base".to_owned(),
        notes: "representative schema value".to_owned(),
        plan: json!({
            "format": "snapback.result-transform.v1",
            "materializationKey": "qmk1.fixture",
            "overlay": "none",
            "filterGrammar": "basic-v1",
            "filter": [],
            "order": [],
            "limit": null,
        }),
        executing_materialization_key: "qmk1.fixture".to_owned(),
        projected_fields: vec!["id".to_owned()],
        base: json!({
            "shape": "row-sequence",
            "mode": "single-page",
            "pages": [{ "version": "v1", "terminal": true, "rows": [] }],
        }),
        client_overlay_rows: None,
        expect: ResultTransformCorpusExpectationV1 {
            transform_hash: Some(format!("sha256:{}", "0".repeat(64))),
            outcome: json!({ "status": "ok", "rows": [] }),
        },
    };
    assert_validates(
        RESULT_TRANSFORM_V1_CASE_SCHEMA_FILE
            .strip_prefix("schemas/")
            .expect("schema path is rooted under schemas"),
        &serde_json::to_value(case).unwrap(),
    );

    let manifest = ResultTransformCorpusManifestV1 {
        artifact_kind: "snapback.result-transform-corpus-manifest.v1".to_owned(),
        corpus: RESULT_TRANSFORM_V1_CORPUS.to_owned(),
        extension_of: ResultTransformCorpusBaselineV1 {
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            manifest_path: "tests/conformance/data-tier/corpus.manifest.json".to_owned(),
            cases: 37,
        },
        profile: "result-transform.v1".to_owned(),
        corpus_format_version: RESULT_TRANSFORM_V1_CORPUS_FORMAT_VERSION,
        profile_version: RESULT_TRANSFORM_V1_PROFILE_VERSION,
        case_schema_path: RESULT_TRANSFORM_V1_CASE_SCHEMA_FILE.to_owned(),
        evaluator_identities: ResultTransformEvaluatorIdentitiesV1 {
            rust: "snapback.result-transform.rust.v1".to_owned(),
            javascript: "snapback.result-transform.javascript.v1".to_owned(),
        },
        cases: vec![ResultTransformCorpusCaseEntryV1 {
            name: "empty-base".to_owned(),
            path: "empty-base.case.json".to_owned(),
            sha256: format!("sha256:{}", "1".repeat(64)),
            transform_hash: Some(format!("sha256:{}", "0".repeat(64))),
            required_capabilities: vec!["resultTransformV1".to_owned()],
            minimum_profile_version: 1,
        }],
    };
    assert_validates(
        RESULT_TRANSFORM_V1_CORPUS_SCHEMA_FILE
            .strip_prefix("schemas/")
            .expect("schema path is rooted under schemas"),
        &serde_json::to_value(manifest).unwrap(),
    );
}

#[test]
fn telemetry_agent_export_fixtures_match_the_pinned_carrier_schemas() {
    let corpus = committed("telemetry.query-fixtures-v1.json");
    let fixture = &corpus["agentExport"];
    assert_validates(
        "telemetry.agent-export.request.schema.json",
        &fixture["request"],
    );
    assert_validates(
        "telemetry.agent-export.request.schema.json",
        &fixture["continuationRequest"],
    );
    assert_validates("telemetry.agent-export.page.schema.json", &fixture["page"]);

    let mut missing_bound = fixture["page"].clone();
    missing_bound
        .as_object_mut()
        .expect("agent export page fixture is an object")
        .remove("declaredBounds");
    assert_rejects("telemetry.agent-export.page.schema.json", &missing_bound);
}

#[test]
fn errors_operation_fixtures_match_the_pinned_authority_split_schemas() {
    let corpus = committed("errors.query-fixtures-v1.json");
    assert_validates(
        "errors.issues.request.schema.json",
        &corpus["issues"]["request"],
    );
    assert_validates(
        "errors.issues.response.schema.json",
        &corpus["issues"]["response"],
    );
    assert_validates(
        "errors.issue.request.schema.json",
        &corpus["issue"]["request"],
    );
    assert_validates(
        "errors.issue.response.schema.json",
        &corpus["issue"]["response"],
    );
    assert_validates(
        "errors.transition.request.schema.json",
        &corpus["transition"]["singleRequest"],
    );
    assert_validates(
        "errors.transition.request.schema.json",
        &corpus["transition"]["bulkRequest"],
    );
    assert_validates(
        "errors.transition.response.schema.json",
        &corpus["transition"]["singleResponse"],
    );
    assert_validates(
        "errors.transition.response.schema.json",
        &corpus["transition"]["bulkResponse"],
    );

    let structural = serde_json::to_string(&corpus["issues"]["response"]).unwrap();
    assert_eq!(
        corpus["issues"]["response"]["variance"]["transitionHistoryFloorSeq"],
        Value::Null,
        "transition sequences are issue-local, so the list has no global floor"
    );
    for forbidden in ["titleTemplate", "stackHead", "message"] {
        assert!(
            !structural.contains(forbidden),
            "OperatorMetadata issues response leaked raw field {forbidden}"
        );
    }
    let raw = serde_json::to_string(&corpus["issue"]["response"]).unwrap();
    assert!(raw.contains("titleTemplate"));
    assert!(raw.contains("stackHead"));
}

#[test]
fn dry_run_read_versions_stay_in_the_portable_storage_domain() {
    let mut report = json!({
        "kind": "mutationDryRun",
        "function": "updateTodo",
        "tier": "hostPlan",
        "wouldCommit": true,
        "denied": false,
        "predictedWrites": [],
        "readSet": [{
            "kind": "row",
            "table": "todos",
            "id": "todo_1",
            "version": snapback::manifest::PORTABLE_STORAGE_VERSION_MAX
        }],
        "writeSet": [],
        "readSetValidation": "valid",
        "sideEffects": [],
        "result": null,
        "snapshotVersion": snapback::manifest::PORTABLE_STORAGE_VERSION_MAX,
        "diagnostics": []
    });
    assert_validates("dry-run.report.schema.json", &report);

    report["readSet"][0]["version"] = json!(snapback::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);
    assert_rejects("dry-run.report.schema.json", &report);
}

/// @ref LLP 0057#routes-operations-and-dtos — provider and operator objects are closed wire contracts. Keep a
/// consumer-side fixture for every schema, not only the Rust schemars drift
/// check, so camelCase or `additionalProperties` drift is caught here too.
/// @ref LLP 0058#exact-response-dto — bootstrap discovery is an independently
/// closed, generated response rather than an ad hoc server object.
#[test]
fn auth_v1_wire_schemas_accept_exact_objects_and_reject_extensions() {
    let max_protocol_counter = snapback::auth::invalidation::MAX_PROTOCOL_COUNTER;
    let authorized_lease = json!({
        "protocolVersion": 1,
        "leaseId": "lease_1",
        "leaseRequestId": "request_1",
        "issuerId": {
            "authorizationIncarnation": "01890f3c-9d5b-7000-8000-000000000001",
            "bootSequence": 7,
            "bootNonce": "AQEBAQEBAQEBAQEBAQEBAQ"
        },
        "clientStoreId": "store_1",
        "queryKey": "todos:{owner=me}",
        "queryInstanceId": max_protocol_counter,
        "principalId": "user_1",
        "sessionIdAtIssue": "session_1",
        "providerKey": "email-code",
        "authorization": {
            "incarnation": "01890f3c-9d5b-7000-8000-000000000001",
            "epoch": 11
        },
        "data": {
            "versionStream": "01890f3c-9d5b-7000-8000-000000000002",
            "snapshotCommitVersion": 19
        },
        "activationHash": concat!(
            "snapback.authorized-lease.activation.v1:sha256:",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ),
        "issuedAtServerMs": 1_800_000_000_000_u64,
        "authorizedUntilServerMs": 1_800_000_060_000_u64,
        "sessionNotAfterMs": 1_800_000_070_000_u64,
        "providerNotAfterMs": 1_800_000_060_000_u64,
        "authorityInstanceId": "01890f3c-9d5b-7000-8000-000000000004",
        "keyId": "sbak_AQEBAQEBAQEBAQEBAQEBAQ",
        "mac": "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE"
    });
    let mut oversized_authorized_lease = authorized_lease.clone();
    oversized_authorized_lease["data"]["snapshotCommitVersion"] =
        json!(snapback::manifest::PORTABLE_STORAGE_VERSION_MAX + 1);
    assert_rejects("authorized-lease.schema.json", &oversized_authorized_lease);
    assert_rejects(
        "authorized-lease.query.output.schema.json",
        &json!({
            "version": 19,
            "rows": [],
            "authorizedLease": oversized_authorized_lease
        }),
    );
    let mut oversized_lease_query_instance = authorized_lease.clone();
    oversized_lease_query_instance["queryInstanceId"] = json!(max_protocol_counter + 1);
    assert_rejects(
        "authorized-lease.schema.json",
        &oversized_lease_query_instance,
    );
    assert_rejects(
        "authorized-lease.query.output.schema.json",
        &json!({
            "version": 19,
            "rows": [],
            "authorizedLease": oversized_lease_query_instance
        }),
    );
    let completeness_fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/conformance/completeness-proof-v1.json"
    ))
    .expect("parse completeness proof fixture");
    assert_validates(
        "authorized-lease.query.output.schema.json",
        &json!({
            "version": 19,
            "rows": [],
            "authorizedLease": authorized_lease.clone(),
            "completenessProof": completeness_fixture["proof"].clone(),
            "authorizationWitness": completeness_fixture["witness"].clone()
        }),
    );
    let cases = [
        (
            "auth.request-code.input.schema.json",
            json!({ "email": "person@example.com" }),
        ),
        (
            "auth.request-code.output.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA", "expiresAt": 10 }),
        ),
        (
            "auth.session.output.schema.json",
            json!({
                "protocolVersion": 1,
                "serverStartupNonce": "startup-1",
                "authorizationStreamIncarnation": "01890f3c-9d5b-7000-8000-000000000001",
                "transitionGeneration": 0,
                "activeMode": "dev",
                "desiredMode": "dev",
                "modeState": "settled",
                "appDataAvailability": "available",
                "quarantineCode": null,
                "clientProtocols": {
                    "authClient": 1,
                    "authInvalidation": null,
                    "authorityDescriptor": null,
                    "authorizedLease": null
                },
                "availability": {
                    "onlineRequestResponse": { "available": true, "reason": null },
                    "authScopedLive": {
                        "available": true,
                        "minimumAuthInvalidationProtocol": null,
                        "reason": null
                    },
                    "retainedReads": {
                        "available": true,
                        "minimumAuthInvalidationProtocol": null,
                        "minimumAuthorizedLeaseProtocol": null,
                        "reason": null
                    },
                    "queuedReplay": {
                        "available": true,
                        "minimumAuthorityDescriptorProtocol": null,
                        "reason": null
                    }
                },
                "provider": { "key": "email-code", "available": false },
                "transports": ["bearer"],
                "authority": {
                    "kind": "anonymous",
                    "userId": null,
                    "sessionId": null,
                    "isAuthenticated": false
                },
                "authorityDescriptor": {
                    "descriptorVersion": 1,
                    "authorityInstanceId": "01890f3c-9d5b-7000-8000-000000000001",
                    "sessionGeneration": 0
                },
                "deploymentIdentity": null,
                "authorizedLease": null
            }),
        ),
        (
            "auth.exchange.input.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA", "code": "012345" }),
        ),
        (
            "auth.credential.output.schema.json",
            json!({
                "tokenType": "Bearer",
                "token": "sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad",
                "refreshAfter": 7,
                "authorityDescriptor": {
                    "descriptorVersion": 1,
                    "authorityInstanceId": "019b0000-0000-7000-8000-000000000003",
                    "sessionGeneration": 1
                },
                "session": {
                    "id": "019b0000-0000-7000-8000-000000000001",
                    "userId": "019b0000-0000-7000-8000-000000000002",
                    "provider": "email-code",
                    "createdAt": 1,
                    "expiresAt": 2,
                    "absoluteExpiresAt": 3
                }
            }),
        ),
        ("auth.empty.input.schema.json", json!({})),
        (
            "auth.family-alarm.output.schema.json",
            json!({ "accepted": true }),
        ),
        (
            "auth.mailbox.query.schema.json",
            json!({ "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA" }),
        ),
        (
            "auth.mailbox.output.schema.json",
            json!({
                "challengeId": "sbc_AAAAAAAAAAAAAAAAAAAAAA",
                "canonicalAddress": "person@example.com",
                "code": "012345",
                "expiresAt": 10
            }),
        ),
        (
            "auth.mint-session.input.schema.json",
            json!({ "email": "person@example.com" }),
        ),
        (
            "auth.rescue-colliding-table.input.schema.json",
            json!({ "sourceTable": "_auth_users", "targetTable": "legacy_auth_users" }),
        ),
        ("authorized-lease.schema.json", authorized_lease.clone()),
        (
            "authorized-lease.query.output.schema.json",
            json!({
                "version": 19,
                "rows": [],
                "authorizedLease": authorized_lease
            }),
        ),
    ];
    for (file, exact) in cases {
        assert_validates(file, &exact);
        let mut extended = exact;
        extended
            .as_object_mut()
            .expect("auth wire fixture is an object")
            .insert("unexpected".to_owned(), json!(true));
        assert_rejects(file, &extended);
    }

    let authorized_lease_input = json!({
        "args": {},
        "leaseRequestId": "request_1",
        "clientStoreId": "store_1",
        "queryKey": "todos:{owner=me}",
        "queryInstanceId": max_protocol_counter
    });
    assert_validates(
        "authorized-lease.query.input.schema.json",
        &authorized_lease_input,
    );
    let mut extended_authorized_lease_input = authorized_lease_input.clone();
    extended_authorized_lease_input
        .as_object_mut()
        .expect("authorized lease input is an object")
        .insert("unexpected".to_owned(), json!(true));
    assert_rejects(
        "authorized-lease.query.input.schema.json",
        &extended_authorized_lease_input,
    );
    let mut oversized_authorized_lease_input = authorized_lease_input;
    oversized_authorized_lease_input["queryInstanceId"] = json!(max_protocol_counter + 1);
    assert_rejects(
        "authorized-lease.query.input.schema.json",
        &oversized_authorized_lease_input,
    );

    use snapback::auth::wire::{
        EmptyAuthRequest, ExchangeRequest, MailboxQuery, MintSessionRequest, RequestCodeRequest,
        RescueCollidingTableRequest,
    };
    assert!(
        serde_json::from_str::<RequestCodeRequest>(r#"{"email":"a@b","email":"duplicate@b"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<ExchangeRequest>(
            r#"{"challengeId":"sbc_x","challengeId":"sbc_y","code":"012345"}"#
        )
        .is_err()
    );
    assert!(serde_json::from_str::<EmptyAuthRequest>(r#"{"x":1,"x":2}"#).is_err());
    assert!(
        serde_json::from_str::<MailboxQuery>(r#"{"challengeId":"sbc_x","challengeId":"sbc_y"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<MintSessionRequest>(r#"{"email":"a@b","email":"duplicate@b"}"#)
            .is_err()
    );
    assert!(
        serde_json::from_str::<RescueCollidingTableRequest>(
            r#"{"sourceTable":"_auth_users","targetTable":"legacy","targetTable":"other"}"#
        )
        .is_err()
    );
}

#[test]
fn auth_invalidation_counter_schemas_match_the_portable_runtime_domain() {
    let max = snapback::auth::invalidation::MAX_PROTOCOL_COUNTER;
    let issuer_id = json!({
        "authorizationIncarnation": "01890f3c-9d5b-7000-8000-000000000001",
        "bootSequence": max,
        "bootNonce": "AQEBAQEBAQEBAQEBAQEBAQ"
    });
    let namespace = json!({
        "clientStoreId": "store_1",
        "queryKey": "todos:{owner=me}",
        "queryInstanceId": max
    });
    let subscription_scope = json!({
        "kind": "subscription",
        "issuerId": issuer_id.clone(),
        "namespace": namespace.clone(),
        "scopeSequence": max,
        "connectionGeneration": max,
        "subscriptionId": "sub_1"
    });
    let witness = json!({
        "authorization": {
            "incarnation": "01890f3c-9d5b-7000-8000-000000000001",
            "epoch": max
        },
        "data": {
            "versionStream": "01890f3c-9d5b-7000-8000-000000000002",
            "minCommitVersion": max
        }
    });
    let live_output = json!({
        "subscription_id": "sub_1",
        "snapshot": { "version": max, "rows": [] },
        "permission_epochs": {},
        "authorizationScope": {
            "kind": "connection",
            "issuerId": issuer_id.clone(),
            "connectionGeneration": max
        },
        "authorizationInvalidation": {
            "obligation": {
                "protocolVersion": 1,
                "scopeId": subscription_scope.clone(),
                "revision": max,
                "maxDisposition": "delete",
                "witness": witness.clone()
            },
            "resolution": {
                "protocolVersion": 1,
                "kind": "snapshot",
                "scopeId": subscription_scope,
                "revision": max,
                "witness": witness,
                "maxDisposition": "delete",
                "ackToken": "ack_1"
            }
        },
        "scopeRetirements": [{
            "issuerId": issuer_id.clone(),
            "namespace": namespace,
            "retireThroughScopeSequence": max,
            "authorizationExpectation": {
                "incarnation": "01890f3c-9d5b-7000-8000-000000000001",
                "epoch": max
            },
            "mac": "retirement_mac"
        }]
    });
    assert_validates("live.subscribe.output.schema.json", &live_output);
    for pointer in [
        "/authorizationScope/connectionGeneration",
        "/authorizationInvalidation/obligation/scopeId/issuerId/bootSequence",
        "/authorizationInvalidation/obligation/scopeId/namespace/queryInstanceId",
        "/authorizationInvalidation/obligation/scopeId/scopeSequence",
        "/authorizationInvalidation/obligation/scopeId/connectionGeneration",
        "/authorizationInvalidation/obligation/revision",
        "/authorizationInvalidation/resolution/revision",
        "/scopeRetirements/0/retireThroughScopeSequence",
    ] {
        let mut oversized = live_output.clone();
        *oversized
            .pointer_mut(pointer)
            .unwrap_or_else(|| panic!("counter fixture path {pointer} exists")) = json!(max + 1);
        assert_rejects("live.subscribe.output.schema.json", &oversized);
    }

    let connection_grant = json!({
        "connectionId": "conn_1",
        "connectionToken": "token_1",
        "authorizationInvalidation": {
            "protocolVersion": 1,
            "issuerId": issuer_id.clone(),
            "connectionGeneration": max,
            "authorization": {
                "incarnation": "01890f3c-9d5b-7000-8000-000000000001",
                "epoch": max
            },
            "versionStream": "01890f3c-9d5b-7000-8000-000000000002",
            "issuerRetirement": {
                "currentIssuer": {
                    "issuerId": issuer_id,
                    "keyId": "key_1",
                    "mac": "issuer_mac"
                },
                "retireThroughBootSequence": max,
                "authorizationExpectation": {
                    "incarnation": "01890f3c-9d5b-7000-8000-000000000001",
                    "epoch": max
                },
                "mac": "retirement_mac"
            }
        }
    });
    assert_validates("connection.grant.schema.json", &connection_grant);
    for pointer in [
        "/authorizationInvalidation/issuerId/bootSequence",
        "/authorizationInvalidation/connectionGeneration",
        "/authorizationInvalidation/issuerRetirement/currentIssuer/issuerId/bootSequence",
        "/authorizationInvalidation/issuerRetirement/retireThroughBootSequence",
    ] {
        let mut oversized = connection_grant.clone();
        *oversized
            .pointer_mut(pointer)
            .unwrap_or_else(|| panic!("counter fixture path {pointer} exists")) = json!(max + 1);
        assert_rejects("connection.grant.schema.json", &oversized);
    }
}

/// ENG-24991: the committed auth.session schema and the executable kit
/// validator (`demos/_kit/client.mjs` `projectAuthSessionResponse`) must agree
/// on every shared corpus case. This test proves the schema half of the pair;
/// `demos/_kit/tests/auth-session-schema-parity.mjs` proves the kit half over
/// the SAME corpus file, so a divergent verdict fails one side of CI.
///
/// @ref LLP 0058#exact-response-dto — the response is one closed Rust/schemars
/// authority; a schema looser than the shipped client is a conformance bug.
const AUTH_SESSION_PARITY_CORPUS: &str =
    include_str!("../../../tests/conformance/auth-session-parity.corpus.json");

fn corpus_case_value(corpus: &Value, case: &Value) -> Value {
    let base_name = case["base"].as_str().expect("corpus case names a base");
    let mut value = corpus["bases"][base_name].clone();
    assert!(
        value.is_object(),
        "corpus base {base_name} must be an object"
    );
    if let Some(removals) = case.get("remove").and_then(Value::as_array) {
        for path in removals {
            let path: Vec<&str> = path
                .as_array()
                .expect("remove path is an array")
                .iter()
                .map(|token| token.as_str().expect("remove path token is a string"))
                .collect();
            let (last, parents) = path.split_last().expect("remove path is non-empty");
            let mut target = &mut value;
            for token in parents {
                target = target
                    .get_mut(token)
                    .unwrap_or_else(|| panic!("remove path parent {token} exists"));
            }
            target
                .as_object_mut()
                .expect("remove path parent is an object")
                .remove(*last)
                .unwrap_or_else(|| panic!("remove path member {last} exists"));
        }
    }
    if let Some(assignments) = case.get("set").and_then(Value::as_array) {
        for assignment in assignments {
            let path: Vec<&str> = assignment["path"]
                .as_array()
                .expect("set path is an array")
                .iter()
                .map(|token| token.as_str().expect("set path token is a string"))
                .collect();
            let (last, parents) = path.split_last().expect("set path is non-empty");
            let mut target = &mut value;
            for token in parents {
                target = target
                    .get_mut(token)
                    .unwrap_or_else(|| panic!("set path parent {token} exists"));
            }
            target
                .as_object_mut()
                .expect("set path parent is an object")
                .insert((*last).to_owned(), assignment["value"].clone());
        }
    }
    value
}

#[test]
fn auth_session_schema_and_kit_cover_structural_and_contextual_constraints() {
    let corpus: Value =
        serde_json::from_str(AUTH_SESSION_PARITY_CORPUS).expect("parse parity corpus");
    let schema_file = corpus["schema"].as_str().expect("corpus names its schema");
    assert_eq!(schema_file, "auth.session.output.schema.json");
    let cases = corpus["cases"].as_array().expect("corpus has cases");
    assert!(
        cases.len() >= 50,
        "the parity corpus lost coverage: {} cases",
        cases.len()
    );
    let mut accepted = 0usize;
    for case in cases {
        let name = case["name"].as_str().expect("corpus case has a name");
        let value = corpus_case_value(&corpus, case);
        // `appId == configured app` is necessarily contextual: the reusable
        // JSON Schema can require a non-empty id, while the kit knows which id
        // this client was constructed for. All other cases share one verdict.
        let expectation = case
            .get("schemaExpect")
            .unwrap_or(&case["expect"])
            .as_str()
            .expect("corpus case has a schema expectation");
        match expectation {
            "accept" => {
                accepted += 1;
                assert_validates(schema_file, &value);
            }
            "reject" => assert_rejects(schema_file, &value),
            other => panic!("case {name} has unknown expectation {other}"),
        }
    }
    assert!(
        accepted >= 3,
        "the parity corpus must keep positive coverage, found {accepted} accepts"
    );
}

/// ENG-24991 acceptance: the demanded negative classes stay covered even if
/// the corpus is edited — every exact root member is load-bearing, nullable
/// members may not be omitted, the protocol set may not be empty, and the
/// version is const 1.
#[test]
fn auth_session_schema_rejects_the_eng_24991_negative_classes() {
    let corpus: Value =
        serde_json::from_str(AUTH_SESSION_PARITY_CORPUS).expect("parse parity corpus");
    let base = &corpus["bases"]["settledDevAnonymous"];
    assert_validates("auth.session.output.schema.json", base);

    // Each omitted exact root member rejects, including the nullable ones.
    let members = base.as_object().expect("base is an object");
    assert_eq!(members.len(), 17, "root member census changed");
    for member in members.keys() {
        let mut omitted = base.clone();
        omitted.as_object_mut().unwrap().remove(member);
        assert_rejects("auth.session.output.schema.json", &omitted);
    }

    // Missing nullable nested members reject.
    for (parent, member) in [
        (vec!["authority"], "kind"),
        (vec!["authority"], "userId"),
        (vec!["authority"], "sessionId"),
        (vec!["authority"], "isAuthenticated"),
        (vec!["availability", "onlineRequestResponse"], "reason"),
        (
            vec!["availability", "authScopedLive"],
            "minimumAuthInvalidationProtocol",
        ),
        (
            vec!["availability", "retainedReads"],
            "minimumAuthorizedLeaseProtocol",
        ),
        (
            vec!["availability", "queuedReplay"],
            "minimumAuthorityDescriptorProtocol",
        ),
    ] {
        let mut omitted = base.clone();
        let mut target = &mut omitted;
        for token in parent {
            target = target.get_mut(token).expect("nested parent exists");
        }
        target.as_object_mut().unwrap().remove(member);
        assert_rejects("auth.session.output.schema.json", &omitted);
    }

    // Empty protocols and each omitted protocol member reject.
    let mut empty_protocols = base.clone();
    empty_protocols["clientProtocols"] = json!({});
    assert_rejects("auth.session.output.schema.json", &empty_protocols);
    for member in [
        "authClient",
        "authInvalidation",
        "authorityDescriptor",
        "authorizedLease",
    ] {
        let mut omitted = base.clone();
        omitted["clientProtocols"]
            .as_object_mut()
            .unwrap()
            .remove(member);
        assert_rejects("auth.session.output.schema.json", &omitted);
    }

    // Version 99 (and any non-1 integer) rejects: protocolVersion is const 1.
    let mut version_99 = base.clone();
    version_99["protocolVersion"] = json!(99);
    assert_rejects("auth.session.output.schema.json", &version_99);

    let mut generation_too_large = base.clone();
    generation_too_large["authorityDescriptor"]["sessionGeneration"] =
        json!(9_007_199_254_740_992_u64);
    assert_rejects("auth.session.output.schema.json", &generation_too_large);
}

#[test]
fn auth_session_schema_closes_mode_authority_and_descriptor_generation_together() {
    let corpus: Value =
        serde_json::from_str(AUTH_SESSION_PARITY_CORPUS).expect("parse parity corpus");
    let dev = &corpus["bases"]["settledDevAnonymous"];
    let human = &corpus["bases"]["settledSessionsAuthenticated"];
    assert_validates("auth.session.output.schema.json", dev);
    assert_validates("auth.session.output.schema.json", human);

    let mut dev_human = human.clone();
    dev_human["activeMode"] = json!("dev");
    assert_rejects("auth.session.output.schema.json", &dev_human);

    let mut service = human.clone();
    service["authority"] = json!({
        "kind": "servicePrincipal",
        "userId": "01890f3c-9d5b-7000-8000-000000000002",
        "sessionId": null,
        "isAuthenticated": true
    });
    service["authorityDescriptor"]["sessionGeneration"] = json!(0);
    assert_validates("auth.session.output.schema.json", &service);

    let mut dev_service = service.clone();
    dev_service["activeMode"] = json!("dev");
    assert_rejects("auth.session.output.schema.json", &dev_service);

    let mut anonymous_sessions = dev.clone();
    anonymous_sessions["activeMode"] = json!("sessions");
    anonymous_sessions["desiredMode"] = json!("sessions");
    assert_validates("auth.session.output.schema.json", &anonymous_sessions);

    let mut anonymous_positive = anonymous_sessions;
    anonymous_positive["authorityDescriptor"]["sessionGeneration"] = json!(1);
    assert_rejects("auth.session.output.schema.json", &anonymous_positive);

    let mut human_zero = human.clone();
    human_zero["authorityDescriptor"]["sessionGeneration"] = json!(0);
    assert_rejects("auth.session.output.schema.json", &human_zero);

    let mut service_positive = service;
    service_positive["authorityDescriptor"]["sessionGeneration"] = json!(1);
    assert_rejects("auth.session.output.schema.json", &service_positive);
}

#[test]
fn auth_credential_schema_requires_a_positive_js_safe_session_generation() {
    let credential = json!({
        "tokenType": "Bearer",
        "token": "sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad",
        "refreshAfter": 7,
        "authorityDescriptor": {
            "descriptorVersion": 1,
            "authorityInstanceId": "019b0000-0000-7000-8000-000000000003",
            "sessionGeneration": 1
        },
        "session": {
            "id": "019b0000-0000-7000-8000-000000000001",
            "userId": "019b0000-0000-7000-8000-000000000002",
            "provider": "email-code",
            "createdAt": 1,
            "expiresAt": 2,
            "absoluteExpiresAt": 3
        }
    });
    assert_validates("auth.credential.output.schema.json", &credential);

    let mut zero = credential.clone();
    zero["authorityDescriptor"]["sessionGeneration"] = json!(0);
    assert_rejects("auth.credential.output.schema.json", &zero);

    let mut too_large = credential;
    too_large["authorityDescriptor"]["sessionGeneration"] = json!(9_007_199_254_740_992_u64);
    assert_rejects("auth.credential.output.schema.json", &too_large);
}

/// Every committed schema file has a corresponding generated artifact and vice
/// versa — a new artifact type without a committed schema (or a stray file) is a
/// failure, not a silent gap.
#[test]
fn dk7_every_artifact_has_a_committed_schema_file() {
    let generated: std::collections::BTreeSet<String> = artifact_schemas()
        .into_iter()
        .map(|a| a.file.to_owned())
        .chain(
            EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS
                .iter()
                .filter(|file| !file.contains('/'))
                .map(|file| (*file).to_owned()),
        )
        .collect();
    let committed: std::collections::BTreeSet<String> = fs::read_dir(schemas_dir())
        .expect("read schemas/ dir")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".schema.json"))
        .collect();
    assert_eq!(
        generated, committed,
        "schemas/ is out of sync with the generator; regenerate with \
         `cargo run -p snapback-tools --bin snapback-schemagen`"
    );
    for path in EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS
        .iter()
        .filter(|path| path.contains('/'))
    {
        assert!(
            schemas_dir().join(path).is_file(),
            "externally managed schema {path} is not present at its owning path"
        );
    }
}

/// A representative InspectState literal exercising the full runtime/inspect
/// closure (manifests, runtime capabilities, cron, ephemeral, diagnostics).
fn representative_inspect() -> InspectState {
    InspectState {
        artifact_kind: "inspectState".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        target_profile_id: TARGET_PROFILE_LOCAL_DEV_SQLITE_IBEX.to_owned(),
        target: "local".to_owned(),
        storage: StorageInfo {
            sqlite_path: None,
            version: 7,
            tables: vec!["todos".to_owned()],
            client_mutation_retention: retention_info(),
        },
        runtime: RuntimeCapabilities {
            canonical_engine: "ibex".to_owned(),
            ibex_submodule: IbexSubmoduleCapability {
                present: true,
                path: Some(PathBuf::from("/secret/runtime/ibex-submodule")),
            },
            ibex_cli: IbexCliCapability {
                available: false,
                path: Some(PathBuf::from("/secret/runtime/ibex-cli")),
                version: None,
            },
            host_plan_runtime: true,
            ibex_ctx_db_host_bridge: CapabilityState::Available,
            async_handler_completion: CapabilityState::Available,
            sqlite_lock_held_across_async: CapabilityState::NotYetWired,
            mutation_dry_run: true,
        },
        schema: SchemaManifest {
            artifact_diagnostics: vec![
                Diagnostic::warning(
                    "SNAPBACK_SECRET_SCHEMA_ARTIFACT",
                    "schema",
                    "schema artifact diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/schema/artifact.ts" })),
            ],
            ..SchemaManifest::default()
        },
        functions: FunctionManifest {
            unsupported_dependency_diagnostics: vec![
                Diagnostic::error(
                    "SNAPBACK_SECRET_DEPENDENCY",
                    "codegen",
                    "raw diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/diagnostic/details.ts" })),
            ],
            cron_jobs: vec![CronJobDefinition {
                name: "publicCron".to_owned(),
                schedule: CronSchedule {
                    every_ms: Some(1_000),
                    cron: None,
                },
                action: "runPublicCron".to_owned(),
                enabled: true,
                activation: Default::default(),
                jitter_policy: Default::default(),
                overlap_policy: Default::default(),
                retry_policy: Default::default(),
                required_capabilities: vec![],
                target_wakeup: None,
                source_span: Some(SourceSpan {
                    file: "/secret/source/cron.ts".to_owned(),
                    line: 1,
                    column: 1,
                }),
            }],
            config: vec![ConfigEntryDefinition {
                name: "PUBLIC_CONFIG_DECLARATION".to_owned(),
                description: None,
                purpose: None,
                secret: true,
                required: false,
                pool: false,
                probe: None,
                how_to_get: None,
                acquisition: None,
                default: None,
                source_span: Some(SourceSpan {
                    file: "/secret/source/config.ts".to_owned(),
                    line: 2,
                    column: 3,
                }),
            }],
            ..FunctionManifest::default()
        },
        capability_manifest: CapabilityManifest::local_v0(vec!["postgres".to_owned()]),
        route_manifest_hash: "sha256:route-manifest-fixture".to_owned(),
        subscriptions: vec![],
        active_connections: 0,
        reaped_connections: 0,
        live_delivery: LiveDeliveryStats::default(),
        live_matcher: LiveMatcherDecisionStats::default(),
        live_evaluation: LiveEvaluationStats::default(),
        live_coalesce: LiveCoalesceStats::default(),
        live_settlement: LiveSettlementStats::default(),
        live_authority: LiveAuthorityLaneStats::default(),
        live_watermarks: LiveWatermarkStats::default(),
        ephemeral: EphemeralDiagnostics {
            room_count: 1,
            entry_count: 1,
            subscriber_count: 1,
            value_bytes: 12,
            active_rooms: vec![EphemeralRoomDiagnostics {
                collection: "secretCursors".to_owned(),
                routing_key: "secret-routing-key".to_owned(),
                scope: Scope::from_pairs([("secretTenantId", "tenant-secret")]),
                scope_epoch: 9,
                entries: 1,
                subscribers: 1,
                value_bytes: 12,
                retained_bytes: 256,
            }],
            ..EphemeralDiagnostics::default()
        },
        cron: CronInspectState {
            artifact_kind: "cronInspectState".to_owned(),
            schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
            jobs: vec![],
            recent_runs: vec![CronRunRecord {
                run_id: "run-public-shape".to_owned(),
                job_name: "publicCron".to_owned(),
                scheduled_at_ms: Some(1),
                due_at_ms: 2,
                started_at_ms: 3,
                finished_at_ms: Some(4),
                trigger: CronRunTrigger::Scheduled,
                attempt: 1,
                outcome: CronRunOutcome::Failed,
                duration_ms: Some(1),
                idempotency_key: "public-idempotency-shape".to_owned(),
                slot_key: "public-slot-shape".to_owned(),
                diagnostic: Some(
                    Diagnostic::error(
                        "SNAPBACK_SECRET_CRON_RUN",
                        "cron",
                        "cron run diagnostic secret text",
                    )
                    .with_details(json!({ "sourcePath": "/secret/cron/run.ts" })),
                ),
                result: Some(json!({ "applicationSecret": "cron result secret value" })),
            }],
            diagnostics: vec![
                Diagnostic::warning(
                    "SNAPBACK_SECRET_CRON_STATE",
                    "cron",
                    "cron state diagnostic secret text",
                )
                .with_details(json!({ "sourcePath": "/secret/cron/state.ts" })),
            ],
        },
        maintenance: MaintenanceDiagnostics {
            permission_resolution_failures: 2,
            journal_prune_failures: 1,
            last_permission_resolution_failure_ms: Some(7),
            last_journal_prune_failure_ms: Some(8),
        },
        telemetry: Default::default(),
        push_registry: snapback::push::PushRegistryInspectionV1 {
            live_tokens: 1,
            retired_tokens: 2,
            retirement_reasons: std::collections::BTreeMap::from([
                ("explicit-unregister".to_owned(), 1),
                ("session-ended".to_owned(), 1),
            ]),
        },
        recent_diagnostics: vec![
            Diagnostic::info("SNAPBACK_READY", "server", "recent diagnostic secret text")
                .with_details(json!({ "path": "/secret/recent/details.ts" })),
        ],
        capability_gaps: vec!["postgres".to_owned()],
    }
}

/// Round-trip gate: a representative value of every artifact serializes and
/// validates against its committed schema — the direct proof that the generated
/// schema matches the serde output.
#[test]
fn dk7_representative_values_validate_against_committed_schemas() {
    assert_validates(
        "schema.manifest.schema.json",
        &serde_json::to_value(SchemaManifest::default()).unwrap(),
    );
    assert_validates(
        "functions.manifest.schema.json",
        &serde_json::to_value(FunctionManifest::default()).unwrap(),
    );
    assert_validates(
        "release.manifest.schema.json",
        &serde_json::to_value(representative_release_manifest()).unwrap(),
    );
    let target = representative_target_descriptor();
    let observation = representative_target_observation();
    assert_validates(
        "target.descriptor.schema.json",
        &serde_json::to_value(&target).unwrap(),
    );
    assert_validates(
        "vm-adapter.request.schema.json",
        &serde_json::to_value(AdapterRequest {
            schema_version: AdapterRequestVersion::V1,
            operation: AdapterOperation::Inspect,
            operation_id: "inspect-op".to_owned(),
            target: target.clone(),
        })
        .unwrap(),
    );
    assert_validates(
        "vm-adapter.response.schema.json",
        &serde_json::to_value(AdapterResponse {
            schema_version: AdapterResponseVersion::V1,
            operation: AdapterOperation::Inspect,
            operation_id: "inspect-op".to_owned(),
            ok: true,
            observation: Some(observation.clone()),
            diagnostics: vec![AdapterSafeDiagnostic {
                code: "SNAPBACK_FIXTURE_OK".to_owned(),
                severity: "info".to_owned(),
                message: "fixture read-back completed".to_owned(),
            }],
        })
        .unwrap(),
    );
    assert_validates(
        "deploy.plan.schema.json",
        &serde_json::to_value(representative_deploy_plan()).unwrap(),
    );
    let lease = representative_deployment_lease();
    let backup = representative_backup_manifest();
    let evidence = AdapterEvidenceRef {
        kind: "fixtureEvidence".to_owned(),
        uri: "fixture://provider/acquireLease".to_owned(),
        sha256: format!("sha256:{}", "c".repeat(64)),
        bytes: 0,
        verified: true,
    };
    assert_validates(
        "vm-adapter.lifecycle-request.schema.json",
        &serde_json::to_value(AdapterLifecycleRequest {
            schema_version: AdapterLifecycleRequestVersion::V1,
            operation: AdapterLifecycleOperation::AcquireLease,
            operation_id: "plan-op".to_owned(),
            attempt: 1,
            target: target.clone(),
            plan: AdapterOperationPlan::Deploy(representative_deploy_plan()),
            release_directory: "/var/lib/snapback/releases/example".to_owned(),
            lease: None,
        })
        .unwrap(),
    );
    assert_validates(
        "vm-adapter.lifecycle-response.schema.json",
        &serde_json::to_value(AdapterLifecycleResponse {
            schema_version: AdapterLifecycleResponseVersion::V1,
            operation: AdapterLifecycleOperation::AcquireLease,
            operation_id: "plan-op".to_owned(),
            ok: true,
            idempotent_replay: false,
            remote_evidence: false,
            input_sha256: format!("sha256:{}", "d".repeat(64)),
            output_sha256: format!("sha256:{}", "e".repeat(64)),
            lease: Some(lease.clone()),
            observation: Some(observation.clone()),
            evidence: vec![evidence.clone()],
            backup: None,
            restore: None,
            diagnostics: vec![],
        })
        .unwrap(),
    );
    assert_validates(
        "backup.manifest.schema.json",
        &serde_json::to_value(&backup).unwrap(),
    );
    assert_validates(
        "deploy.receipt.schema.json",
        &serde_json::to_value(DeployReceipt {
            schema_version: "snapback.deploy-receipt.v1".to_owned(),
            receipt_id: format!("sha256:{}", "f".repeat(64)),
            plan_id: representative_deploy_plan().plan_id,
            operation_id: "plan-op".to_owned(),
            target_id: target.target_id,
            deployment_id: target.deployment_id,
            database_id: target.database_id,
            stream_incarnation: target.stream_incarnation,
            release_id: representative_deploy_plan().release_id,
            previous_release_id: None,
            activation_generation_before: 0,
            activation_generation_after: 1,
            outcome: DeployReceiptOutcome::Activated,
            remote_evidence: false,
            adapter_kind: target.adapter.kind,
            adapter_version: target.adapter.version,
            provider_facts_sha256: observation.provider_facts_sha256,
            backup: Some(backup),
            steps: vec![DeployStepReceipt {
                sequence: 1,
                operation: AdapterLifecycleOperation::AcquireLease,
                state: DeployStepState::Completed,
                input_sha256: format!("sha256:{}", "d".repeat(64)),
                output_sha256: format!("sha256:{}", "e".repeat(64)),
                evidence: vec![evidence],
                started_at_ms: 40,
                finished_at_ms: 41,
                idempotent_replay: false,
                previous_fact_sha256: None,
                fact_sha256: format!("sha256:{}", "0".repeat(64)),
            }],
            gaps: vec![ReleaseGap {
                id: "control-plane.remote-evidence".to_owned(),
                reason: "fixture is not remote evidence".to_owned(),
                blocking: true,
            }],
            started_at_ms: 40,
            finished_at_ms: 50,
        })
        .unwrap(),
    );
    let rollback_plan = representative_rollback_plan();
    assert_validates(
        "rollback.plan.schema.json",
        &serde_json::to_value(&rollback_plan).unwrap(),
    );
    let restore_plan = representative_restore_plan();
    assert_validates(
        "restore.plan.schema.json",
        &serde_json::to_value(&restore_plan).unwrap(),
    );
    assert_validates(
        "restore.activation-plan.schema.json",
        &serde_json::to_value(representative_restore_activation_plan()).unwrap(),
    );
    let restore = representative_restore_result();
    assert_validates(
        "maintenance.receipt.schema.json",
        &serde_json::to_value(MaintenanceReceipt {
            schema_version: "snapback.maintenance-receipt.v1".to_owned(),
            receipt_id: format!("sha256:{}", "f".repeat(64)),
            kind: MaintenanceReceiptKind::Restore,
            plan_id: restore_plan.plan_id,
            operation_id: restore_plan.operation_id,
            target_id: restore_plan.destination_target_id,
            deployment_id: restore_plan.deployment_id,
            database_id: restore_plan.database_id,
            stream_incarnation: restore_plan.stream_incarnation,
            activation_generation_before: 0,
            activation_generation_after: 1,
            release_id_before: None,
            release_id_after: None,
            backup_id: Some(restore.backup_id.clone()),
            restore: Some(restore),
            outcome: MaintenanceReceiptOutcome::RestoredPaused,
            remote_evidence: false,
            steps: vec![],
            gaps: vec![ReleaseGap {
                id: "control-plane.remote-evidence".to_owned(),
                reason: "fixture is not remote evidence".to_owned(),
                blocking: true,
            }],
            started_at_ms: 100,
            finished_at_ms: 200,
        })
        .unwrap(),
    );
    let inspection_fact = InspectionFact {
        name: "publicHealth".to_owned(),
        status: "ready".to_owned(),
        value_sha256: format!("sha256:{}", "1".repeat(64)),
    };
    assert_validates(
        "vm-adapter.query-request.schema.json",
        &serde_json::to_value(AdapterQueryRequest {
            schema_version: AdapterQueryRequestVersion::V1,
            operation: AdapterQueryOperation::Logs,
            operation_id: "logs-op".to_owned(),
            target: representative_target_descriptor(),
            query: AdapterQuery {
                since_ms: 1,
                until_ms: 2,
                limit: 10,
                cursor: None,
            },
        })
        .unwrap(),
    );
    assert_validates(
        "vm-adapter.query-response.schema.json",
        &serde_json::to_value(AdapterQueryResponse {
            schema_version: AdapterQueryResponseVersion::V1,
            operation: AdapterQueryOperation::Logs,
            operation_id: "logs-op".to_owned(),
            ok: true,
            remote_evidence: false,
            input_sha256: format!("sha256:{}", "4".repeat(64)),
            output_sha256: format!("sha256:{}", "5".repeat(64)),
            observation: Some(representative_target_observation()),
            logs: Some(ControlLogPage {
                entries: vec![ControlLogEntry {
                    timestamp_ms: 1,
                    severity: "info".to_owned(),
                    deployment_id: "deployment-1".to_owned(),
                    release_id: None,
                    activation_generation: 0,
                    stream_incarnation: "stream-1".to_owned(),
                    correlation_id: "logs-op".to_owned(),
                    event_code: "SNAPBACK_FIXTURE_EVENT".to_owned(),
                    event_version: 1,
                    payload: vec![RedactedLogField {
                        name: "result".to_owned(),
                        value: "verified".to_owned(),
                    }],
                }],
                next_cursor: None,
                retention_class: "fixture-seven-days".to_owned(),
                indexing_class: "deployment-and-operation".to_owned(),
                delivery_latency_ms: 1,
                dropped_events: 0,
                backpressure: false,
            }),
            inspection: Some(AuthenticatedInspection {
                target_id: "target-preview-1".to_owned(),
                deployment_id: "deployment-1".to_owned(),
                database_id: "database-1".to_owned(),
                stream_incarnation: "stream-1".to_owned(),
                active_release_id: None,
                inactive_release_ids: vec![],
                activation_generation: 0,
                schema_generation: 1,
                config_generation: 1,
                auth_generation: 1,
                worker_generation: 1,
                capability_manifest_sha256: format!("sha256:{}", "2".repeat(64)),
                capability_gaps: vec!["hosted-auth".to_owned()],
                health: vec![inspection_fact.clone()],
                dependencies: vec![],
                migration: vec![],
                backups: vec![],
                queues: vec![],
                connections: vec![],
                resources: vec![],
                operations: vec![ControlOperationSummary {
                    operation_id: "logs-op".to_owned(),
                    kind: "logs".to_owned(),
                    outcome: "completed".to_owned(),
                    finished_at_ms: 2,
                    receipt_id: format!("sha256:{}", "3".repeat(64)),
                }],
                diagnostics: vec![],
            }),
            evidence: vec![],
            diagnostics: vec![],
        })
        .unwrap(),
    );
    let qualification_target = representative_target_descriptor();
    assert_validates(
        "remote-drill.plan.schema.json",
        &serde_json::to_value(RemoteDrillPlan {
            schema_version: RemoteDrillPlanVersion::V1,
            plan_id: format!("sha256:{}", "0".repeat(64)),
            reason: "pin provider facts before provisioning".to_owned(),
            target_id: qualification_target.target_id.clone(),
            target_profile_id: "trusted-single-tenant-app-complete.v1".to_owned(),
            production_class: qualification_target.production_class,
            target_descriptor_sha256: format!("sha256:{}", "1".repeat(64)),
            adapter_kind: qualification_target.adapter.kind,
            adapter_version: qualification_target.adapter.version.clone(),
            driver_sha256: qualification_target.adapter.driver_sha256.clone(),
            provider: qualification_target.adapter.provider.clone(),
            account_fingerprint: qualification_target.adapter.account_fingerprint.clone(),
            region: qualification_target.adapter.region.clone(),
            public_origin: qualification_target.adapter.public_origin.clone(),
            storage: RemoteDrillStorage {
                compute_class: "fixture-small".to_owned(),
                persistent_volume_class: "fixture-encrypted".to_owned(),
                persistent_volume_encrypted: true,
                artifact_store_ref: "object://fixture/artifacts".to_owned(),
                artifact_storage_class: "immutable".to_owned(),
                backup_store_ref: "object://fixture/backups".to_owned(),
                backup_storage_class: "retained".to_owned(),
                backup_permission_boundary: "separateWriteGrant".to_owned(),
            },
            tls: RemoteDrillTls {
                issuer: "fixture-acme".to_owned(),
                automated_renewal: true,
                independently_attested_origin: true,
            },
            supervisor: RemoteDrillSupervisor {
                kind: RemoteDrillSupervisorKind::Systemd,
                restart_evidence_required: true,
                interruption_resume_required: true,
            },
            logs: RemoteDrillLogs {
                sink_ref: "logs://fixture/control".to_owned(),
                retention_class: "thirty-days".to_owned(),
                redaction_profile: "snapback-secret-private-v1".to_owned(),
            },
            credentials: RemoteDrillCredentials {
                control_credential_ref: "secret-store://fixture/control".to_owned(),
                control_state_store_ref: "object://fixture/state".to_owned(),
                admission_key_ref: "provider-secret://fixture/admission".to_owned(),
                replay_floor_store_ref: "object://fixture/replay-floor".to_owned(),
            },
            cost: RemoteDrillCostBoundary {
                currency: "USD".to_owned(),
                estimated_monthly_minor_units: 1200,
                maximum_monthly_minor_units: 2000,
                estimate_basis_sha256: format!("sha256:{}", "2".repeat(64)),
                included_components: vec![
                    RemoteDrillCostComponent::Compute,
                    RemoteDrillCostComponent::PersistentVolume,
                    RemoteDrillCostComponent::ObjectStorage,
                    RemoteDrillCostComponent::Logs,
                    RemoteDrillCostComponent::Dns,
                    RemoteDrillCostComponent::Tls,
                ],
            },
            nonclaims: vec![
                RemoteDrillNonclaim::HighAvailability,
                RemoteDrillNonclaim::Autoscaling,
                RemoteDrillNonclaim::MultiRegion,
                RemoteDrillNonclaim::ZeroDowntime,
                RemoteDrillNonclaim::UntrustedMultiTenancy,
                RemoteDrillNonclaim::ManagedServiceSla,
            ],
            provisioning_authority: RemoteDrillProvisioningAuthority::ConfirmationRequired,
            confirmation: format!("confirm:sha256:{}", "0".repeat(64)),
            created_at_ms: 1,
            expires_at_ms: 3_600_001,
        })
        .unwrap(),
    );
    let qualification_evidence = AdapterEvidenceRef {
        kind: "remoteProviderAttestation".to_owned(),
        uri: "fixture://remote/provider-attestation".to_owned(),
        sha256: format!("sha256:{}", "1".repeat(64)),
        bytes: 128,
        verified: true,
    };
    let hosted_auth_drill = HostedAuthDrillReceipt {
        schema_version: "snapback.hosted-auth-drill-receipt.v1".to_owned(),
        receipt_id: format!("sha256:{}", "9".repeat(64)),
        target_id: qualification_target.target_id.clone(),
        target_profile_id: "trusted-single-tenant-app-complete.v1".to_owned(),
        deployment_id: qualification_target.deployment_id.clone(),
        provider: qualification_target.adapter.provider.clone(),
        account_fingerprint: qualification_target.adapter.account_fingerprint.clone(),
        region: qualification_target.adapter.region.clone(),
        public_origin: qualification_target.adapter.public_origin.clone(),
        browser_artifact_sha256: format!("sha256:{}", "8".repeat(64)),
        admission: HostedAdmission {
            version: 1,
            deployment_id: qualification_target.deployment_id.clone(),
            configuration_sha256: "a".repeat(64),
            support_sha256: "b".repeat(64),
            admission_epoch: 1,
            sender_replay_epoch_floor: 1,
            issued_at_ms: 1,
            expires_at_ms: 101,
            limiter_epoch: 1,
            authentication_throttle_config: representative_authentication_throttle_config(),
            invalidation_epoch: 1,
            handler_protocol_version: 1,
            handler_incarnation: "handler-1".to_owned(),
            operator_surface: HostedOperatorSurface::Disabled,
            browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
            hosted_auth: HostedAuthCapabilities {
                external_tls: ExternalTls::Enforced,
                effective_source: EffectiveSource::Trusted,
                authentication_throttle: AuthenticationThrottle::SharedEnforced,
                session_invalidation: SessionInvalidation::GloballyFenced,
                client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
            },
        },
        live_health: HostedAuthLiveHealth {
            admission_epoch: 1,
            sender_replay_epoch_floor: 1,
            sender_replay_epoch_floor_current: true,
            limiter_reachable: true,
            invalidation_current: true,
            serialized_authority_current: true,
            handler_compatible: true,
            serving_admitted: true,
            observed_at_ms: 3,
        },
        evidence: vec![qualification_evidence.clone()],
        gaps: vec![],
        started_at_ms: 2,
        finished_at_ms: 4,
    };
    assert_validates(
        "hosted-auth.drill-receipt.schema.json",
        &serde_json::to_value(hosted_auth_drill.clone()).unwrap(),
    );
    assert_validates(
        "adapter.qualification.schema.json",
        &serde_json::to_value(AdapterQualificationManifest {
            schema_version: "snapback.adapter-qualification.v1".to_owned(),
            qualification_id: format!("sha256:{}", "2".repeat(64)),
            target_id: qualification_target.target_id.clone(),
            target_profile_id: "trusted-single-tenant-app-complete.v1".to_owned(),
            adapter_kind: qualification_target.adapter.kind,
            adapter_version: qualification_target.adapter.version.clone(),
            driver_sha256: qualification_target.adapter.driver_sha256.clone(),
            provider: qualification_target.adapter.provider.clone(),
            account_fingerprint: qualification_target.adapter.account_fingerprint.clone(),
            region: qualification_target.adapter.region.clone(),
            public_origin: qualification_target.adapter.public_origin.clone(),
            remote_evidence: true,
            hosted_auth_drill,
            claims: vec![AdapterQualificationEvidence {
                claim: AdapterQualificationClaim::IdentityFencing,
                evidence: vec![qualification_evidence.clone()],
            }],
            gaps: vec![],
            qualified_at_ms: 100,
        })
        .unwrap(),
    );
    assert_validates(
        "prepared-release.manifest.schema.json",
        &serde_json::to_value(PreparedReleaseManifest {
            schema_version: "snapback.prepared-release.v1".to_owned(),
            prepared_release_id: format!("sha256:{}", "3".repeat(64)),
            base_release_id: format!("sha256:{}", "4".repeat(64)),
            base_release_manifest_sha256: format!("sha256:{}", "5".repeat(64)),
            project_id: qualification_target.project_id,
            target_id: qualification_target.target_id,
            target_profile_id: "trusted-single-tenant-app-complete.v1".to_owned(),
            adapter_qualification_id: format!("sha256:{}", "2".repeat(64)),
            adapter_qualification_sha256: format!("sha256:{}", "6".repeat(64)),
            compatibility: ReleaseCompatibilityEnvelope {
                minimum_readable_schema_generation: 0,
                maximum_readable_schema_generation: 0,
                write_schema_generation: 0,
                minimum_retained_client_generation: 0,
                minimum_job_generation: 0,
                minimum_config_generation: 0,
                migration_sha256: format!("sha256:{}", "7".repeat(64)),
                migration_transactional: true,
                irreversible_boundary: None,
                rollback_mode: RollbackMode::CodeOnly,
            },
            evidence: vec![PreparedReleaseEvidence {
                kind: PreparedReleaseEvidenceKind::RuntimeArtifact,
                evidence: vec![qualification_evidence],
            }],
            gaps: vec![],
            activation_eligible: true,
            prepared_at_ms: 101,
        })
        .unwrap(),
    );
    assert_validates(
        "data-tier.profile.schema.json",
        &serde_json::to_value(DataTierProfile::current()).unwrap(),
    );
    assert_validates(
        "data-tier.corpus.schema.json",
        &serde_json::to_value(DataTierCorpusManifest {
            artifact_kind: "dataTierCorpusManifest".to_owned(),
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            corpus_format_version: DATA_TIER_CORPUS_FORMAT_VERSION,
            profile_version: snapback::value_expr::DATA_TIER_PROFILE_VERSION,
            ledger_version: snapback::manifest::CTX_ANSWER_LEDGER_VERSION,
            profile_path: DATA_TIER_PROFILE_FILE.to_owned(),
            cases: vec![DataTierCorpusCaseEntry {
                name: "empty".to_owned(),
                path: "empty.case.json".to_owned(),
                sha256: "sha256:test".to_owned(),
                required_capabilities: vec!["irEvaluator".to_owned()],
                minimum_profile_version: 1,
            }],
        })
        .unwrap(),
    );
    assert_validates(
        "data-tier.case.schema.json",
        &serde_json::to_value(DataTierCorpusCase {
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            corpus_version: DATA_TIER_CORPUS_FORMAT_VERSION,
            name: "empty".to_owned(),
            notes: None,
            required_capabilities: vec!["irEvaluator".to_owned()],
            minimum_profile_version: 1,
            schema: DataTierCaseSchema { tables: Vec::new() },
            seed: Default::default(),
            plan: MutationPlan {
                owner_write_checks: Vec::new(),
                steps: Vec::new(),
                return_value: None,
            },
            args: json!({}),
            auth_user_id: None,
            ctx_ledger: None,
            expect: DataTierCaseExpectation::default(),
        })
        .unwrap(),
    );
    assert_validates(
        "capability.manifest.schema.json",
        &serde_json::to_value(CapabilityManifest::local_v0(vec!["postgres".to_owned()])).unwrap(),
    );
    let artifact_ref = PublishedArtifactRef {
        path: "schemas/example.json".to_owned(),
        sha256: format!("sha256:{}", "0".repeat(64)),
    };
    let auth_manifest = RemoteAuthCapabilityManifest {
        artifact_kind: "remoteAuthCapabilityManifest".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        manifest_version: 1,
        capability_id: "snapback.auth.todo-v2".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        credential_policy: RemoteCredentialPolicy {
            presentation: "authorization-bearer".to_owned(),
            authority: "host-private".to_owned(),
            value_in_artifacts: false,
            value_in_arguments: false,
            value_in_environment: false,
            value_in_info_plist: false,
            supports_rotation: true,
        },
    };
    assert_validates(
        "remote-service.auth-capability.manifest.schema.json",
        &serde_json::to_value(&auth_manifest).unwrap(),
    );
    let operation = RemoteServiceOperation {
        name: "createTodo".to_owned(),
        function_id: "todo-v2:createTodo".to_owned(),
        kind: "Mutation".to_owned(),
        auth_requirement: "optional-user".to_owned(),
        arguments_schema: artifact_ref.clone(),
        request_schema: artifact_ref.clone(),
        response_schema: artifact_ref.clone(),
        receipt_schema: artifact_ref.clone(),
        error_schema: artifact_ref.clone(),
    };
    let data_manifest = RemoteDataCapabilityManifest {
        artifact_kind: "remoteDataCapabilityManifest".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        manifest_version: 1,
        capability_id: "snapback.data.todo-v2".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        schema_manifest: artifact_ref.clone(),
        function_manifest: artifact_ref.clone(),
        capability_manifest: artifact_ref.clone(),
        wire_schemas: std::collections::BTreeMap::from([(
            "mutationInput".to_owned(),
            artifact_ref.clone(),
        )]),
        operations: vec![operation],
    };
    assert_validates(
        "remote-service.data-capability.manifest.schema.json",
        &serde_json::to_value(&data_manifest).unwrap(),
    );
    let profile = RemoteServiceProfile {
        artifact_kind: "remoteServiceProfile".to_owned(),
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        profile_version: 1,
        profile_id: "remote-service-sqlite-ibex".to_owned(),
        app_id: "todo-v2".to_owned(),
        target_profile_id: "remote-service-sqlite-ibex".to_owned(),
        local_server_lifecycle: false,
        publication: RemoteServiceGitPublication {
            kind: "gitPinnedCheckout".to_owned(),
            addressing: "commitSha".to_owned(),
            repository: "https://github.com/ccheever/snapback.git".to_owned(),
            profile_path:
                "demos/todo-v2/snapback/generated-remote-service/remote-service.profile.json"
                    .to_owned(),
        },
        endpoint_policy: RemoteEndpointPolicy {
            scheme: "https".to_owned(),
            authority: "host-private".to_owned(),
            value_in_artifacts: false,
            value_in_arguments: false,
            value_in_environment: false,
            value_in_info_plist: false,
            allow_redirects: false,
            allow_ambient_proxy: false,
        },
        server_capability_manifest: artifact_ref.clone(),
        auth_capability_manifest: artifact_ref.clone(),
        data_capability_manifest: artifact_ref.clone(),
        data_tier: RemoteServiceDataTierIdentity {
            corpus: DATA_TIER_CORPUS_NAME.to_owned(),
            profile_version: 1,
            corpus_format_version: 1,
            ledger_version: 1,
            case_count: 29,
            profile: artifact_ref.clone(),
            corpus_manifest: artifact_ref,
        },
    };
    assert_validates(
        "remote-service.profile.schema.json",
        &serde_json::to_value(&profile).unwrap(),
    );
    assert_validates(
        "auth.hosted-capabilities.schema.json",
        &serde_json::to_value(HostedAuthCapabilities::local_target()).unwrap(),
    );
    assert_validates(
        "auth.hosted-admission.schema.json",
        &serde_json::to_value(representative_hosted_admission()).unwrap(),
    );
    assert_validates(
        "diagnostic.schema.json",
        &serde_json::to_value(
            Diagnostic::error("SNAPBACK_TEST", "storage", "boom")
                .with_details(json!({ "table": "todos" })),
        )
        .unwrap(),
    );
    assert_validates(
        "storage-info.schema.json",
        &serde_json::to_value(StorageInfo {
            sqlite_path: Some(PathBuf::from("/tmp/app.sqlite")),
            version: 3,
            tables: vec!["todos".to_owned()],
            client_mutation_retention: retention_info(),
        })
        .unwrap(),
    );
    let inspect = representative_inspect();
    assert_validates(
        "inspect.schema.json",
        &serde_json::to_value(&inspect).unwrap(),
    );
    assert_validates(
        "inspect.public.schema.json",
        &serde_json::to_value(PublicInspect::from(inspect)).unwrap(),
    );
}

#[test]
fn hosted_auth_capability_descriptor_is_closed() {
    let local = serde_json::to_value(HostedAuthCapabilities::local_target()).unwrap();
    assert_validates("auth.hosted-capabilities.schema.json", &local);

    let mut unknown_field = local.clone();
    unknown_field["operatorAssertedTls"] = json!(true);
    assert_rejects("auth.hosted-capabilities.schema.json", &unknown_field);
    assert!(serde_json::from_value::<HostedAuthCapabilities>(unknown_field).is_err());

    let mut unknown_value = local;
    unknown_value["externalTls"] = json!("proxyConfigured");
    assert_rejects("auth.hosted-capabilities.schema.json", &unknown_value);
    assert!(serde_json::from_value::<HostedAuthCapabilities>(unknown_value).is_err());
}

#[test]
fn hosted_admission_schema_requires_the_browser_seam_exclusion_fact() {
    let admission = serde_json::to_value(representative_hosted_admission()).unwrap();
    assert_validates("auth.hosted-admission.schema.json", &admission);

    let mut missing = admission.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("browserDirectBearerSeam");
    assert_rejects("auth.hosted-admission.schema.json", &missing);
    assert!(serde_json::from_value::<HostedAdmission>(missing).is_err());

    let mut available = admission.clone();
    available["browserDirectBearerSeam"] = json!("available");
    assert_validates("auth.hosted-admission.schema.json", &available);
    let available: HostedAdmission = serde_json::from_value(available).unwrap();
    assert!(!available.closed_admission_facts_hold());

    let mut unknown = admission;
    unknown["operatorOverride"] = json!(true);
    assert_rejects("auth.hosted-admission.schema.json", &unknown);
    assert!(serde_json::from_value::<HostedAdmission>(unknown).is_err());
}

#[test]
fn hosted_admission_schema_rejects_non_js_safe_numeric_facts() {
    let admission = serde_json::to_value(representative_hosted_admission()).unwrap();
    for field in [
        "admissionEpoch",
        "issuedAtMs",
        "expiresAtMs",
        "limiterEpoch",
        "invalidationEpoch",
    ] {
        let mut unsafe_admission = admission.clone();
        unsafe_admission[field] = json!(HOSTED_ADMISSION_MAX_SAFE_INTEGER + 1);
        assert_rejects("auth.hosted-admission.schema.json", &unsafe_admission);
    }
}

#[test]
fn hosted_admission_producer_receipt_schemas_are_closed_and_js_safe() {
    let floor = ExternalReplayFloorAdvanceReceipt {
        schema_version: ExternalReplayFloorAdvanceVersion::V1,
        operation_id: "boot-operation-1".to_owned(),
        deployment_id: "deployment-1".to_owned(),
        store_identity_sha256: format!("sha256:{}", "d".repeat(64)),
        previous_floor: 16,
        sender_replay_epoch_floor: 17,
        advanced_at_ms: 999,
        receipt_id: format!("sha256:{}", "e".repeat(64)),
    };
    let projection = HostedAdmissionProjectionReceipt {
        schema_version: HostedAdmissionProjectionVersion::V1,
        operation_id: "boot-operation-1".to_owned(),
        deployment_id: "deployment-1".to_owned(),
        public_origin: "https://app.example.test".to_owned(),
        key_id: "hosted-key-1".to_owned(),
        browser_artifact_sha256: format!("sha256:{}", "c".repeat(64)),
        configuration_sha256: "a".repeat(64),
        support_sha256: "b".repeat(64),
        handler_protocol_version: 1,
        handler_incarnation: "handler-1".to_owned(),
        sender_replay_epoch_floor: 17,
        admission_epoch: 7,
        limiter_epoch: 11,
        invalidation_epoch: 13,
        issued_at_ms: 1_000,
        expires_at_ms: 121_000,
        external_floor_store_identity_sha256: format!("sha256:{}", "d".repeat(64)),
        external_floor_advance_receipt_id: format!("sha256:{}", "e".repeat(64)),
        envelope_sha256: format!("sha256:{}", "f".repeat(64)),
        key_projection_created: true,
        remote_evidence: false,
        projection_id: format!("sha256:{}", "1".repeat(64)),
    };
    let refresh = HostedAdmissionRefreshReceipt {
        schema_version: HostedAdmissionRefreshVersion::V1,
        deployment_id: "deployment-1".to_owned(),
        public_origin: "https://app.example.test".to_owned(),
        key_id: "hosted-key-1".to_owned(),
        configuration_sha256: "a".repeat(64),
        support_sha256: "b".repeat(64),
        handler_protocol_version: 1,
        handler_incarnation: "handler-1".to_owned(),
        sender_replay_epoch_floor: 17,
        admission_epoch: 8,
        limiter_epoch: 12,
        invalidation_epoch: 14,
        issued_at_ms: 16_000,
        expires_at_ms: 136_000,
        envelope_sha256: format!("sha256:{}", "2".repeat(64)),
        remote_evidence: false,
        refresh_id: format!("sha256:{}", "3".repeat(64)),
    };

    let floor_json = serde_json::to_value(&floor).unwrap();
    let projection_json = serde_json::to_value(&projection).unwrap();
    let refresh_json = serde_json::to_value(&refresh).unwrap();
    assert_validates(
        "auth.external-replay-floor-advance.schema.json",
        &floor_json,
    );
    assert_validates(
        "auth.hosted-admission-projection.schema.json",
        &projection_json,
    );
    assert_validates("auth.hosted-admission-refresh.schema.json", &refresh_json);

    let mut leaked_key = projection_json;
    leaked_key["keyMaterial"] = json!("forbidden");
    assert_rejects("auth.hosted-admission-projection.schema.json", &leaked_key);
    assert!(serde_json::from_value::<HostedAdmissionProjectionReceipt>(leaked_key).is_err());

    for (schema, mut unsafe_value) in [
        ("auth.external-replay-floor-advance.schema.json", floor_json),
        ("auth.hosted-admission-refresh.schema.json", refresh_json),
    ] {
        unsafe_value["senderReplayEpochFloor"] = json!(HOSTED_ADMISSION_MAX_SAFE_INTEGER + 1);
        assert_rejects(schema, &unsafe_value);
    }
}

#[test]
fn public_inspect_projection_drops_handler_controlled_diagnostic_text() {
    const SECRET_SENTINEL: &str = "configured-secret-must-not-be-public";
    let mut inspect = representative_inspect();
    inspect.recent_diagnostics.push(
        Diagnostic::error("SNAPBACK_HANDLER_FAILED", "runtime", SECRET_SENTINEL)
            .with_details(json!({ "vendorBody": SECRET_SENTINEL })),
    );
    inspect.cron.diagnostics.push(
        Diagnostic::error("SNAPBACK_CRON_FAILED", "cron", SECRET_SENTINEL)
            .with_details(json!({ "reason": SECRET_SENTINEL })),
    );
    assert!(
        serde_json::to_string(&inspect)
            .unwrap()
            .contains(SECRET_SENTINEL),
        "fixture must prove the gated source contains the sentinel"
    );
    let public = serde_json::to_string(&PublicInspect::from(inspect)).unwrap();
    assert!(!public.contains(SECRET_SENTINEL), "{public}");
    assert!(
        public.contains("SNAPBACK_HANDLER_FAILED"),
        "codes remain useful"
    );
}

#[test]
fn public_inspect_drops_private_storage_and_ephemeral_room_facts() {
    let public = serde_json::to_value(PublicInspect::from(representative_inspect())).unwrap();
    assert!(public.pointer("/storage/clientMutationRetention").is_none());
    assert!(public.pointer("/ephemeral/activeRooms").is_none());
    assert!(public.pointer("/runtime/ibexSubmodule/path").is_none());
    assert!(public.pointer("/runtime/ibexCli/path").is_none());
    assert!(public.pointer("/functions/cronJobs/0/sourceSpan").is_none());
    assert!(public.pointer("/functions/config/0/sourceSpan").is_none());
    assert!(
        public
            .pointer("/functions/unsupportedDependencyDiagnostics/0/message")
            .is_none()
    );
    assert!(
        public
            .pointer("/functions/unsupportedDependencyDiagnostics/0/details")
            .is_none()
    );
    assert!(public.pointer("/recentDiagnostics/0/message").is_none());
    assert!(public.pointer("/recentDiagnostics/0/details").is_none());
    assert!(
        public
            .pointer("/schema/artifactDiagnostics/0/message")
            .is_none()
    );
    assert!(
        public
            .pointer("/schema/artifactDiagnostics/0/details")
            .is_none()
    );
    assert!(public.pointer("/cron/jobs").is_none());
    assert!(public.pointer("/cron/recentRuns").is_none());
    assert!(public.pointer("/cron/diagnostics").is_none());
    assert_eq!(public.pointer("/cron/jobCount"), Some(&json!(0)));
    assert_eq!(public.pointer("/cron/failedJobCount"), Some(&json!(0)));
    assert_eq!(public.pointer("/cron/inFlightJobCount"), Some(&json!(0)));
    assert_eq!(
        public["functions"]["unsupportedDependencyDiagnostics"][0]["code"],
        "SNAPBACK_SECRET_DEPENDENCY"
    );

    let encoded = serde_json::to_string(&public).unwrap();
    for secret in [
        "secretCursors",
        "secret-routing-key",
        "secretTenantId",
        "tenant-secret",
        "/secret/runtime/ibex-submodule",
        "/secret/runtime/ibex-cli",
        "/secret/source/cron.ts",
        "/secret/source/config.ts",
        "raw diagnostic secret text",
        "/secret/diagnostic/details.ts",
        "recent diagnostic secret text",
        "/secret/recent/details.ts",
        "schema artifact diagnostic secret text",
        "/secret/schema/artifact.ts",
        "cron state diagnostic secret text",
        "/secret/cron/state.ts",
        "cron run diagnostic secret text",
        "/secret/cron/run.ts",
        "cron result secret value",
    ] {
        assert!(
            !encoded.contains(secret),
            "public inspect leaked ephemeral room sentinel {secret}"
        );
    }
}

/// ENG-23964 publication gate: a clean consumer can trust the committed
/// profile + corpus manifest + cases without compiling Rust.
#[test]
fn data_tier_publication_validates_against_committed_schemas() {
    assert_validates(
        "data-tier.profile.schema.json",
        &committed("data-tier.profile.json"),
    );

    let corpus_dir = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("tests")
        .join("conformance")
        .join("data-tier");
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(corpus_dir.join("corpus.manifest.json")).expect("read corpus manifest"),
    )
    .expect("parse corpus manifest");
    assert_validates("data-tier.corpus.schema.json", &manifest);

    for entry in manifest["cases"].as_array().expect("manifest cases") {
        let path = corpus_dir.join(entry["path"].as_str().expect("case path"));
        let case: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read case"))
            .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
        assert_validates("data-tier.case.schema.json", &case);
    }
}

#[test]
fn remote_service_publication_is_closed_digest_bound_and_host_private() {
    let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let generated = root.join("demos/todo-v2/snapback/generated-remote-service");
    let read_json = |path: &std::path::Path| -> Value {
        serde_json::from_str(
            &fs::read_to_string(path)
                .unwrap_or_else(|_| panic!("missing remote publication {}", path.display())),
        )
        .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()))
    };
    let profile_value = read_json(&generated.join("remote-service.profile.json"));
    let auth_value = read_json(&generated.join("remote-auth-capability.manifest.json"));
    let data_value = read_json(&generated.join("remote-data-capability.manifest.json"));
    assert_validates("remote-service.profile.schema.json", &profile_value);
    assert_validates(
        "remote-service.auth-capability.manifest.schema.json",
        &auth_value,
    );
    assert_validates(
        "remote-service.data-capability.manifest.schema.json",
        &data_value,
    );

    let profile: RemoteServiceProfile =
        serde_json::from_value(profile_value).expect("parse remote service profile type");
    let auth: RemoteAuthCapabilityManifest =
        serde_json::from_value(auth_value).expect("parse remote auth manifest type");
    let data: RemoteDataCapabilityManifest =
        serde_json::from_value(data_value).expect("parse remote data manifest type");
    assert!(!profile.local_server_lifecycle);
    assert_eq!(profile.endpoint_policy.scheme, "https");
    assert_eq!(profile.endpoint_policy.authority, "host-private");
    assert!(!profile.endpoint_policy.value_in_artifacts);
    assert!(!profile.endpoint_policy.value_in_arguments);
    assert!(!profile.endpoint_policy.value_in_environment);
    assert!(!profile.endpoint_policy.value_in_info_plist);
    assert!(!profile.endpoint_policy.allow_redirects);
    assert!(!profile.endpoint_policy.allow_ambient_proxy);
    assert_eq!(auth.credential_policy.authority, "host-private");
    assert!(auth.credential_policy.supports_rotation);
    assert!(!auth.credential_policy.value_in_artifacts);
    assert!(!auth.credential_policy.value_in_arguments);
    assert!(!auth.credential_policy.value_in_environment);
    assert!(!auth.credential_policy.value_in_info_plist);

    let verify_ref = |reference: &PublishedArtifactRef| {
        let bytes = fs::read(root.join(&reference.path))
            .unwrap_or_else(|_| panic!("missing published ref {}", reference.path));
        let actual = format!("sha256:{:x}", Sha256::digest(bytes));
        assert_eq!(
            reference.sha256, actual,
            "digest mismatch for {}",
            reference.path
        );
    };
    verify_ref(&profile.server_capability_manifest);
    verify_ref(&profile.auth_capability_manifest);
    verify_ref(&profile.data_capability_manifest);
    verify_ref(&profile.data_tier.profile);
    verify_ref(&profile.data_tier.corpus_manifest);
    verify_ref(&data.schema_manifest);
    verify_ref(&data.function_manifest);
    verify_ref(&data.capability_manifest);
    for reference in data.wire_schemas.values() {
        verify_ref(reference);
    }
    for operation in &data.operations {
        verify_ref(&operation.arguments_schema);
        verify_ref(&operation.request_schema);
        verify_ref(&operation.response_schema);
        verify_ref(&operation.receipt_schema);
        verify_ref(&operation.error_schema);
    }

    let operation_names = data
        .operations
        .iter()
        .map(|operation| operation.name.as_str())
        .collect::<Vec<_>>();
    assert_eq!(
        operation_names,
        ["createTodo", "setCompleted", "deleteTodo"]
    );
    let corpus = read_json(&root.join(&profile.data_tier.corpus_manifest.path));
    assert_eq!(
        profile.data_tier.case_count,
        corpus["cases"].as_array().expect("corpus cases").len()
    );
    assert!(profile.data_tier.case_count >= 29);
}

/// Live-wire round trips (LLP 0051 D4 / ENG-23891): a representative value of
/// every client-visible live-wire shape — as the SERVER actually constructs
/// it — validates against its committed schema.
#[test]
fn dk7_live_wire_values_validate_against_committed_schemas() {
    use snapback::ephemeral::{
        DeleteRequest, DurableMessage, EphemeralMessage, RealtimeEnvelope, ResyncReason, Scope,
        SubscribeRequest,
    };
    use snapback::live_wire::{
        LiveDeltaOpKind, LiveDeltaWireOp, LiveEnvelope, LiveSocketClientMessage,
        LiveSocketServerFrame, MutationReceiptOutcome, Receipt, SubscriptionReceiptEvent,
    };
    use snapback::local::{LiveResumeOutput, LiveSubscribeOutput, LiveUnsubscribeOutput};
    use snapback::manifest::QueryOutput;
    use snapback::server::{
        ConnectionGrant, ErrorResponse, ErrorResponseFormatVersion, MutationResponse,
        OpenConnectionRequest,
    };
    use snapback_kernel::storage::SequenceAllocationFact;

    for envelope in [
        LiveEnvelope::LiveReplace {
            network_profile: None,
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 7,
            rows: vec![json!({ "_id": "a", "title": "x" })],
            resume: None,
        },
        LiveEnvelope::LiveDelta {
            network_profile: None,
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 8,
            ops: vec![
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Add,
                    id: "b".to_owned(),
                    row: Some(json!({ "_id": "b" })),
                },
                LiveDeltaWireOp {
                    op: LiveDeltaOpKind::Remove,
                    id: "a".to_owned(),
                    row: None,
                },
            ],
            resume: None,
        },
        LiveEnvelope::CurrentAsOf {
            network_profile: None,
            subscription_id: "sub_1".to_owned(),
            function: "listTodos".to_owned(),
            version: 9,
            resume: None,
        },
        LiveEnvelope::ResyncRequired {
            network_profile: None,
            reason: "outbox_overflow".to_owned(),
            subscription_id: None,
            scope: None,
            epoch: None,
            clear_retained: true,
        },
        LiveEnvelope::ResyncRequired {
            network_profile: None,
            reason: "permission_epoch_changed".to_owned(),
            subscription_id: Some("sub_1".to_owned()),
            scope: Some("user:alice".to_owned()),
            epoch: Some(2),
            clear_retained: true,
        },
    ] {
        assert_validates(
            "live.envelope.schema.json",
            &serde_json::to_value(&envelope).unwrap(),
        );
    }
    assert_rejects(
        "live.envelope.schema.json",
        &serde_json::to_value(LiveEnvelope::ResyncRequired {
            network_profile: None,
            reason: "permission_epoch_changed".to_owned(),
            subscription_id: Some("sub_1".to_owned()),
            scope: Some("user:alice".to_owned()),
            epoch: Some(snapback::manifest::PORTABLE_STORAGE_VERSION_MAX + 1),
            clear_retained: true,
        })
        .unwrap(),
    );

    for frame in [
        LiveSocketServerFrame::Pong {
            request_id: Some("r1".to_owned()),
            server_time_ms: 123,
        },
        LiveSocketServerFrame::EphemeralAck {
            request_id: None,
            operation: "publish".to_owned(),
            body: json!({ "outcome": { "entry_version": 1 } })
                .as_object()
                .unwrap()
                .clone(),
        },
        LiveSocketServerFrame::EphemeralError {
            request_id: Some("r2".to_owned()),
            operation: "subscribe".to_owned(),
            diagnostic: Diagnostic::error("SNAPBACK_TEST", "realtime", "boom"),
        },
        LiveSocketServerFrame::Ephemeral {
            message: EphemeralMessage::ResyncRequired {
                ephemeral_authority_instance: None,
                room: snapback::ephemeral::RoomId {
                    collection: "cursors".to_owned(),
                    scope: Scope::from_pairs([("doc", "d1")]),
                    routing_key: "cursors|3:doc=2:d1".to_owned(),
                },
                scope_epoch: 1,
                room_authority_generation: 0,
                reason: ResyncReason::Restarted,
            },
        },
    ] {
        assert_validates(
            "live.socket-server.schema.json",
            &serde_json::to_value(&frame).unwrap(),
        );
    }

    for message in [
        LiveSocketClientMessage::Ping {
            request_id: Some("p1".to_owned()),
        },
        LiveSocketClientMessage::EphemeralSubscribe {
            request_id: None,
            request: SubscribeRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                connection_id: "conn_1".to_owned(),
                auth: Default::default(),
                since_chunk: None,
            },
        },
        LiveSocketClientMessage::EphemeralDelete {
            request_id: Some("d1".to_owned()),
            request: DeleteRequest {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                connection_id: "conn_1".to_owned(),
                session_id: None,
                user_id: None,
                custom_key: None,
                expected_scope_epoch: None,
                expected_entry_generation: None,
                auth: Default::default(),
            },
        },
    ] {
        assert_validates(
            "live.socket-client.schema.json",
            &serde_json::to_value(&message).unwrap(),
        );
    }

    for receipt in [
        Receipt::Mutation {
            enqueues: Vec::new(),
            sequence_allocations: vec![SequenceAllocationFact {
                counter: "jobNumber".to_owned(),
                scope_table: "orgs".to_owned(),
                scope_row_id: "org_1".to_owned(),
                scope_incarnation: "incarnation_1".to_owned(),
                value: 4,
            }],
            mutation_id: "mut_1".to_owned(),
            mutation: "addTodo".to_owned(),
            outcome: MutationReceiptOutcome::Confirmed,
            settlement_lane: SettlementLane::ReplayAccept,
            claim_ledger: Some(Vec::new()),
            id_map: None,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".to_owned()]),
            snapshot_version: Some(9),
            transport: "http".to_owned(),
            correlation: Value::Null,
            received_at_ms: 1,
        },
        Receipt::Subscription {
            event: SubscriptionReceiptEvent::Established,
            reason: None,
            subscription_id: Some("sub_1".to_owned()),
            superseded_by: None,
            lane: None,
            binding_id: None,
            collection: None,
            removed: None,
            scope: json!({ "listId": "l1" }),
            snapshot_version: Some(7),
            correlation: Some(Value::Null),
            received_at_ms: 2,
        },
        Receipt::Subscription {
            event: SubscriptionReceiptEvent::Disposed,
            reason: Some("unsubscribed".to_owned()),
            subscription_id: None,
            superseded_by: None,
            lane: Some("ephemeral".to_owned()),
            binding_id: Some("cursors".to_owned()),
            collection: Some("cursors".to_owned()),
            removed: Some(true),
            scope: json!({ "doc": "d1" }),
            snapshot_version: None,
            correlation: None,
            received_at_ms: 3,
        },
    ] {
        assert_validates("receipt.schema.json", &receipt.into_value());
    }
    let nullable_mutation_snapshot = Receipt::Mutation {
        enqueues: Vec::new(),
        sequence_allocations: Vec::new(),
        mutation_id: "mut_cursor_unavailable".to_owned(),
        mutation: "addTodo".to_owned(),
        outcome: MutationReceiptOutcome::Rejected,
        settlement_lane: SettlementLane::ReplayAccept,
        claim_ledger: Some(Vec::new()),
        id_map: None,
        rollback_reason: Some("SNAPBACK_STORAGE_VERSION_CORRUPT".to_owned()),
        affected_tables: Some(vec!["todos".to_owned()]),
        snapshot_version: None,
        transport: "http".to_owned(),
        correlation: Value::Null,
        received_at_ms: 4,
    }
    .into_value();
    assert_validates("receipt.schema.json", &nullable_mutation_snapshot);
    let mut impossible_confirmed_snapshot = nullable_mutation_snapshot.clone();
    impossible_confirmed_snapshot["outcome"] = json!("confirmed");
    impossible_confirmed_snapshot["rollbackReason"] = Value::Null;
    assert_rejects("receipt.schema.json", &impossible_confirmed_snapshot);
    let mut missing_mutation_snapshot = nullable_mutation_snapshot;
    missing_mutation_snapshot
        .as_object_mut()
        .unwrap()
        .remove("snapshotVersion");
    assert_rejects("receipt.schema.json", &missing_mutation_snapshot);

    for envelope in [
        RealtimeEnvelope::Durable(DurableMessage::new(b"{\"kind\":\"live_replace\"}".to_vec())),
        RealtimeEnvelope::Ephemeral(EphemeralMessage::ResyncRequired {
            ephemeral_authority_instance: None,
            room: snapback::ephemeral::RoomId {
                collection: "cursors".to_owned(),
                scope: Scope::from_pairs([("doc", "d1")]),
                routing_key: "cursors|3:doc=2:d1".to_owned(),
            },
            scope_epoch: 1,
            room_authority_generation: 0,
            reason: ResyncReason::QueueOverflow,
        }),
    ] {
        assert_validates(
            "realtime.envelope.schema.json",
            &serde_json::to_value(&envelope).unwrap(),
        );
    }

    assert_validates(
        "connection.grant.schema.json",
        &serde_json::to_value(ConnectionGrant {
            connection_id: "conn_1".to_owned(),
            connection_token: "tok_1".to_owned(),
            authorization_invalidation: None,
            wire_version: None,
            ephemeral_authority_protocol: None,
            ephemeral_authority_instance: None,
            hosted_ephemeral_authority_required: false,
            ephemeral_expiry_protocol: None,
        })
        .unwrap(),
    );
    // The LLP 0094 §0B.3 bound-version echo is additive: a grant carrying it
    // still validates, and its absence (a legacy lineage) stays valid above.
    assert_validates(
        "connection.grant.schema.json",
        &serde_json::to_value(ConnectionGrant {
            connection_id: "conn_1".to_owned(),
            connection_token: "tok_1".to_owned(),
            authorization_invalidation: None,
            wire_version: Some("snapback.v1".to_owned()),
            ephemeral_authority_protocol: Some(
                snapback::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1,
            ),
            ephemeral_authority_instance: Some(format!("eai1.{}", "a".repeat(43))),
            hosted_ephemeral_authority_required: true,
            ephemeral_expiry_protocol: Some(snapback::ephemeral::EPHEMERAL_EXPIRY_PROTOCOL_V1),
        })
        .unwrap(),
    );
    let open_request = serde_json::to_value(OpenConnectionRequest {
        connection_id: Some("conn_1".to_owned()),
        previous_token: Some("sct_prior_bearer".to_owned()),
        auth_invalidation_protocol: None,
        wire_version: Some("snapback.v1".to_owned()),
        ephemeral_authority_protocol: Some(snapback::ephemeral::EPHEMERAL_AUTHORITY_PROTOCOL_V1),
        ephemeral_expiry_protocol: Some(snapback::ephemeral::EPHEMERAL_EXPIRY_PROTOCOL_V1),
    })
    .unwrap();
    assert_validates("connection.open.input.schema.json", &open_request);
    assert_validates("connection.open.input.schema.json", &json!({}));
    let mut unknown_open_field = open_request.clone();
    unknown_open_field["logPreviousToken"] = json!(true);
    assert_rejects("connection.open.input.schema.json", &unknown_open_field);
    assert_rejects(
        "connection.open.input.schema.json",
        &json!({ "previousToken": 7 }),
    );
    assert_rejects(
        "connection.open.input.schema.json",
        &json!({ "wireVersion": 1 }),
    );

    let mutation_response = MutationResponse {
        version: 9,
        changed_count: 1,
        result: json!({ "id": "todo_1" }),
        authority_transitions: Vec::new(),
        ctx_ledger: None,
        authority_descriptor: AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: "018f0d90-7b24-7a22-8c33-445566778899".to_owned(),
            session_generation: 1,
        },
        receipt: Receipt::Mutation {
            enqueues: Vec::new(),
            sequence_allocations: Vec::new(),
            mutation_id: "mut_direct_1".to_owned(),
            mutation: "addTodo".to_owned(),
            outcome: MutationReceiptOutcome::Confirmed,
            settlement_lane: SettlementLane::ReplayAccept,
            claim_ledger: Some(Vec::new()),
            id_map: None,
            rollback_reason: None,
            affected_tables: Some(vec!["todos".to_owned()]),
            snapshot_version: Some(9),
            transport: "http".to_owned(),
            correlation: json!({ "actionInvocationId": "act_1" }),
            received_at_ms: 1,
        },
        attribution: None,
        facts: None,
    };
    let mutation_response = serde_json::to_value(mutation_response).unwrap();
    assert_validates("mutation.output.schema.json", &mutation_response);
    assert!(mutation_response.get("previousToken").is_none());
    assert!(mutation_response.get("connectionToken").is_none());
    // The served sessions-mode envelope carries attribution directly; the
    // closed schema admits exactly that member (LLP 0094 §0C.6 item 4).
    let mut attributed_response = mutation_response.clone();
    attributed_response["attribution"] = json!({
        "actorUserId": "user_1",
        "grantId": "grant_1",
        "dryRun": false,
    });
    assert_validates("mutation.output.schema.json", &attributed_response);
    let mut missing_receipt = mutation_response.clone();
    missing_receipt.as_object_mut().unwrap().remove("receipt");
    assert_rejects("mutation.output.schema.json", &missing_receipt);
    let mut unknown_output_field = mutation_response;
    unknown_output_field["connectionToken"] = json!("must-not-appear");
    assert_rejects("mutation.output.schema.json", &unknown_output_field);

    assert_validates(
        "error.response.schema.json",
        &serde_json::to_value(ErrorResponse {
            format_version: ErrorResponseFormatVersion::V1,
            diagnostic: Diagnostic::error("SNAPBACK_TEST", "realtime", "boom"),
            receipt: None,
            attribution: None,
            ephemeral_authority_instance: None,
        })
        .unwrap(),
    );
    let additive_error = json!({
        "formatVersion": "snapback.error-response.v1",
        "diagnostic": Diagnostic::error("SNAPBACK_TEST", "server", "forward additive"),
        "futureMember": { "safeToIgnore": true },
    });
    assert_validates("error.response.schema.json", &additive_error);
    assert!(
        serde_json::from_value::<ErrorResponse>(additive_error).is_ok(),
        "v1 receivers ignore unknown top-level members"
    );
    let unknown_version = json!({
        "formatVersion": "snapback.error-response.v2",
        "diagnostic": Diagnostic::error("SNAPBACK_TEST", "server", "unknown version"),
    });
    assert_rejects("error.response.schema.json", &unknown_version);
    assert!(
        serde_json::from_value::<ErrorResponse>(unknown_version).is_err(),
        "formatVersion is must-understand"
    );
    assert_validates(
        "error.response.schema.json",
        &serde_json::to_value(ErrorResponse {
            format_version: ErrorResponseFormatVersion::V1,
            diagnostic: Diagnostic::error("SNAPBACK_REJECTED", "mutation", "rejected"),
            receipt: Some(Receipt::Mutation {
                enqueues: Vec::new(),
                sequence_allocations: Vec::new(),
                mutation_id: "mut_rejected_1".to_owned(),
                mutation: "addTodo".to_owned(),
                outcome: MutationReceiptOutcome::Rejected,
                settlement_lane: SettlementLane::ReplayAccept,
                claim_ledger: Some(Vec::new()),
                id_map: None,
                rollback_reason: Some("SNAPBACK_REJECTED".to_owned()),
                affected_tables: Some(vec!["todos".to_owned()]),
                snapshot_version: Some(9),
                transport: "http".to_owned(),
                correlation: Value::Null,
                received_at_ms: 2,
            }),
            attribution: None,
            ephemeral_authority_instance: None,
        })
        .unwrap(),
    );

    let snapshot = QueryOutput {
        version: 7,
        rows: vec![json!({ "_id": "a" })],
        cursor: None,
    };
    assert_validates(
        "live.subscribe.output.schema.json",
        &serde_json::to_value(LiveSubscribeOutput {
            subscription_id: "sub_1".to_owned(),
            snapshot: Some(snapshot.clone()),
            completeness_proof: None,
            authorization_witness: None,
            resume: None,
            resume_refusal: None,
            superseded: None,
            supersession_refusal: None,
            permission_epochs: std::collections::BTreeMap::new(),
            receipt: Some(Receipt::Subscription {
                event: SubscriptionReceiptEvent::Established,
                reason: None,
                subscription_id: Some("sub_1".to_owned()),
                superseded_by: None,
                lane: None,
                binding_id: None,
                collection: None,
                removed: None,
                scope: json!({ "listId": "l1" }),
                snapshot_version: Some(7),
                correlation: Some(Value::Null),
                received_at_ms: 3,
            }),
            authorization_scope: None,
            authorization_invalidation: None,
            scope_retirements: Vec::new(),
            attribution: None,
            facts: None,
        })
        .unwrap(),
    );
    // The live establishment/renewal seam admits the LLP 0055 §Audit block:
    // a service-principal establishment answers with `attribution`, and the
    // committed schemas must accept exactly its four registered members.
    let live_attribution = json!({
        "actorUserId": "018f0d90-7b31-7a22-8c33-445566778899",
        "effectiveUserId": "018f0d90-7b30-7a22-8c33-445566778899",
        "grantId": "018f0d90-7b32-7a22-8c33-445566778899",
        "dryRun": false
    });
    assert_validates(
        "live.subscribe.output.schema.json",
        &json!({
            "subscription_id": "sub_1",
            "snapshot": { "version": 7, "rows": [] },
            "permission_epochs": {},
            "attribution": live_attribution
        }),
    );
    assert_validates(
        "live.resume.output.schema.json",
        &json!({
            "subscription_id": "sub_1",
            "mode": "retained",
            "permission_epochs": {},
            "attribution": live_attribution
        }),
    );
    let input = HandlerInput {
        args: json!({ "listId": "l1" }),
        auth: AuthInput {
            principal: Some("user_1".to_owned()),
            session_id: None,
            user_id: Some("user_1".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    };
    assert_validates(
        "query.input.schema.json",
        &serde_json::to_value(&input).unwrap(),
    );
    assert_validates(
        "mutation.input.schema.json",
        &serde_json::to_value(MutationRequest {
            input: input.clone(),
            media_command: None,
            settlement: Default::default(),
            expected_generation: Some(ArtifactGeneration {
                schema_version: "snapback.v1".to_owned(),
                app_id: "schema-roundtrip-app".to_owned(),
                schema_hash: "schema-build-hash".to_owned(),
                bundle_hash: "bundle-build-hash".to_owned(),
                inputs_hash: "inputs-build-hash".to_owned(),
            }),
            wire_version: Some("snapback.v1".to_owned()),
            client_mutation_id: Some("cm_schema_roundtrip".to_owned()),
            operation_issuance: None,
            authority_descriptor: Some(AuthorityDescriptor {
                descriptor_version: 1,
                authority_instance_id: "018f0d90-7b24-7a22-8c33-445566778899".to_owned(),
                session_generation: 1,
            }),
            acknowledged_client_mutation_ids: vec!["cm_acknowledged".to_owned()],
        })
        .unwrap(),
    );
    assert_validates(
        "client-mutation.ack.input.schema.json",
        &serde_json::to_value(MutationAcknowledgementRequest {
            auth: input.auth.clone(),
            authority_descriptor: None,
            client_mutation_ids: vec!["cm_acknowledged".to_owned()],
        })
        .unwrap(),
    );
    assert_validates(
        "client-mutation.ack.output.schema.json",
        &serde_json::to_value(MutationAcknowledgementResponse { acknowledged: 1 }).unwrap(),
    );
    assert_validates(
        "live.subscribe.input.schema.json",
        &serde_json::to_value(LiveSubscribeInput {
            connection_id: "conn_1".to_owned(),
            input: input.clone(),
            authorization_namespace: None,
            supersedes: None,
            resume_from_token: None,
        })
        .unwrap(),
    );
    assert_validates(
        "live.resume.output.schema.json",
        &serde_json::to_value(LiveResumeOutput {
            subscription_id: "sub_1".to_owned(),
            mode: "retained".to_owned(),
            reason: None,
            snapshot: Some(snapshot),
            permission_epochs: std::collections::BTreeMap::new(),
            authorization_scope: None,
            authorization_invalidation: None,
            scope_retirements: Vec::new(),
            attribution: None,
        })
        .unwrap(),
    );
    assert_validates(
        "live.resume.input.schema.json",
        &serde_json::to_value(LiveResumeInput {
            subscription_id: "sub_1".to_owned(),
            connection_id: "conn_1".to_owned(),
            auth: input.auth.clone(),
            recorded_permission_epochs: Default::default(),
        })
        .unwrap(),
    );
    assert_validates(
        "live.unsubscribe.output.schema.json",
        &serde_json::to_value(LiveUnsubscribeOutput {
            subscription_id: "sub_1".to_owned(),
            disposed: true,
            receipt: None,
            scope_retirement: None,
        })
        .unwrap(),
    );
    assert_validates(
        "live.unsubscribe.input.schema.json",
        &serde_json::to_value(LiveUnsubscribeInput {
            subscription_id: "sub_1".to_owned(),
            connection_id: "conn_1".to_owned(),
            auth: input.auth,
        })
        .unwrap(),
    );
}

#[test]
fn agent_safe_capability_schema_rejects_axis_and_extension_tampering() {
    let mut manifest =
        serde_json::to_value(CapabilityManifest::local_v0_declared()).expect("manifest JSON");
    assert_validates("capability.manifest.schema.json", &manifest);

    manifest["agentSafe"]["target"]["forks"]["inApp"]["egress"] = json!({
        "denyAll": true,
        "captureOnly": true,
    });
    assert_rejects("capability.manifest.schema.json", &manifest);

    let mut unknown =
        serde_json::to_value(CapabilityManifest::local_v0_declared()).expect("manifest JSON");
    unknown["agentSafe"]["target"]["aggregate"]["inventedTier"] = json!("Supported");
    assert_rejects("capability.manifest.schema.json", &unknown);

    let mut version =
        serde_json::to_value(CapabilityManifest::local_v0_declared()).expect("manifest JSON");
    version["agentSafe"]["schemaVersion"] = json!("agentSafe.v2");
    assert_rejects("capability.manifest.schema.json", &version);
}

const GENERATED_BACKENDS: [&str; 7] = [
    "demos/todo/snapback/generated",
    "demos/todo-v2/snapback/generated",
    "demos/all-aboard/snapback/generated",
    "demos/all-aboard/tests/egress-probe/generated",
    "demos/cursors-web/snapback/generated",
    "demos/graffiti/snapback/generated",
    "demos/card-game/snapback/generated",
];

/// Demo-artifact gate: every committed generated demo manifest validates against
/// the Rust-derived schema (the codegen output the schema is meant to describe).
#[test]
fn dk7_committed_demo_manifests_validate_against_schemas() {
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    let pairs = [
        ("schema.manifest.schema.json", "schema.manifest.json"),
        ("functions.manifest.schema.json", "functions.manifest.json"),
        (
            "capability.manifest.schema.json",
            "capability.manifest.json",
        ),
    ];
    for (schema_file, manifest_file) in pairs {
        let schema = committed(schema_file);
        let validator = jsonschema::validator_for(&schema)
            .unwrap_or_else(|error| panic!("compile {schema_file}: {error}"));
        for backend in GENERATED_BACKENDS {
            let path = repo.join(backend).join(manifest_file);
            let text = fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            let manifest: Value = serde_json::from_str(&text)
                .unwrap_or_else(|error| panic!("parse {}: {error}", path.display()));
            let errors: Vec<String> = validator
                .iter_errors(&manifest)
                .map(|error| format!("  {}: {error}", error.instance_path()))
                .collect();
            assert!(
                errors.is_empty(),
                "{backend}/{manifest_file} does not validate against {schema_file}:\n{}",
                errors.join("\n")
            );
        }
    }
}

/// The committed demo manifests also parse back through the runtime structs and
/// pass their artifact-header validation — the schema and the parser agree.
#[test]
fn dk7_committed_demo_manifests_parse_through_runtime_structs() {
    let repo = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
    for backend in GENERATED_BACKENDS {
        let dir = repo.join(backend);
        let schema: SchemaManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("schema.manifest.json")).expect("read schema manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: schema manifest rejected: {error}"));
        schema.validate_artifact().expect("schema artifact header");
        let functions: FunctionManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("functions.manifest.json"))
                .expect("read functions manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: functions manifest rejected: {error}"));
        functions
            .validate_artifact()
            .expect("functions artifact header");
        let _capability: CapabilityManifest = serde_json::from_str(
            &fs::read_to_string(dir.join("capability.manifest.json"))
                .expect("read capability manifest"),
        )
        .unwrap_or_else(|error| panic!("{backend}: capability manifest rejected: {error}"));
    }
}

/// LLP 0094 §0F items 1–2 / LLP 0051 §D4: positive and negative instances for
/// the private handler-boundary marker envelopes and the hosted kit-socket
/// in-band request grammar. The REAL produced bytes are additionally proven
/// against the same schemas by the local twin capture test
/// (`tests/workerd_twin_v0.rs`) and the hosted capture suite
/// (`targets/cloudflare/test/wire-schema-gate.mjs`); these fixtures pin the accept /
/// reject envelope of each family.
#[test]
fn handler_marker_envelope_schemas_accept_served_shapes_and_reject_extensions() {
    // Invocation request — local-arm shape (no token/hostHeaders; the
    // capability rides the generated workerd config).
    let local_invoke = serde_json::to_value(snapback::handler_wire::HandlerInvokeRequest {
        export: "addNote".to_owned(),
        args_json: "{\"text\":\"hi\"}".to_owned(),
        auth_json: "{}".to_owned(),
        mode: snapback::handler_wire::HandlerInvocationMode::Mutation,
        run_json: None,
        secrets_json: None,
        epoch: "42".to_owned(),
        token: None,
        settlement_timeout_ms: 9_750,
        host_headers: None,
    })
    .expect("serialize local invoke request");
    assert_validates("handler.invoke.input.schema.json", &local_invoke);
    // Hosted-arm shape (coordinator.js invokeHandler): body token + DO
    // routing header, action run metadata and secret grants.
    let hosted_invoke = json!({
        "export": "sendDigest",
        "argsJson": "{}",
        "authJson": "{}",
        "mode": "action",
        "runJson": "{\"runId\":\"r1\",\"trigger\":\"manual\",\"jobName\":null}",
        "secretsJson": "{\"MAIL_KEY\":\"k\"}",
        "epoch": "1753500000000-tok",
        "token": "6f9619ff-8b86-d011-b42d-00cf4fc964ff",
        "settlementTimeoutMs": 30_000,
        "hostHeaders": { "x-snapback-do-id": "abc123" }
    });
    assert_validates("handler.invoke.input.schema.json", &hosted_invoke);
    // Unknown member (the closed-emission drift catch).
    let mut extended = hosted_invoke.clone();
    extended["protocolVersion"] = json!(1);
    assert_rejects("handler.invoke.input.schema.json", &extended);
    // Missing epoch.
    let mut missing_epoch = hosted_invoke.clone();
    missing_epoch.as_object_mut().unwrap().remove("epoch");
    assert_rejects("handler.invoke.input.schema.json", &missing_epoch);
    // Mode outside the closed set.
    let mut bad_mode = hosted_invoke.clone();
    bad_mode["mode"] = json!("subscription");
    assert_rejects("handler.invoke.input.schema.json", &bad_mode);
    // Explicit null token (never emitted; optional-by-absence).
    let mut null_token = hosted_invoke.clone();
    null_token["token"] = Value::Null;
    assert_rejects("handler.invoke.input.schema.json", &null_token);

    // Response envelope — the three served shapes.
    let settled = json!({
        "envelope": "{\"r\":{\"__snapbackOk\":true,\"value\":{\"id\":\"n1\"}}}",
        "unhandledRejections": [],
        "rejectionDetectionSupported": true
    });
    let did_not_settle = json!({
        "didNotSettle": true,
        "deadlinePhase": "quiescence",
        "unhandledRejections": [],
        "rejectionDetectionSupported": true
    });
    let fatal = json!({ "fatal": "invoke transport authentication failed" });
    assert_validates("handler.invoke.output.schema.json", &settled);
    assert_validates("handler.invoke.output.schema.json", &did_not_settle);
    assert_validates("handler.invoke.output.schema.json", &fatal);
    let mut extended_settled = settled.clone();
    extended_settled["marker"] = json!("SNAPBACK_AUTH_HANDLER_V1");
    assert_rejects("handler.invoke.output.schema.json", &extended_settled);
    let mut bad_phase = did_not_settle.clone();
    bad_phase["deadlinePhase"] = json!("startup");
    assert_rejects("handler.invoke.output.schema.json", &bad_phase);
    assert_rejects("handler.invoke.output.schema.json", &json!({}));
    let mut sweepless = settled;
    sweepless
        .as_object_mut()
        .unwrap()
        .remove("unhandledRejections");
    assert_rejects("handler.invoke.output.schema.json", &sweepless);

    // Host-call body.
    let host_call = serde_json::to_value(snapback::handler_wire::HandlerHostCallRequest {
        raw_op: "42|db.insert".to_owned(),
        args_json: "{\"table\":\"notes\",\"values\":{}}".to_owned(),
    })
    .expect("serialize host call");
    assert_validates("handler.host-call.input.schema.json", &host_call);
    let mut extended_call = host_call.clone();
    extended_call["hostHeaders"] = json!({});
    assert_rejects("handler.host-call.input.schema.json", &extended_call);
    let mut argsless = host_call;
    argsless.as_object_mut().unwrap().remove("argsJson");
    assert_rejects("handler.host-call.input.schema.json", &argsless);
}

/// The kit-socket in-band request grammar (LLP 0094 §0A.1 WS-kinds row): the
/// schema's verdicts mirror `validateLiveSocketFrame` (`coordinator.js`);
/// `targets/cloudflare/test/wire-schema-gate.mjs` proves the same corpus against the
/// served validator.
#[test]
fn kit_socket_request_schema_matches_the_served_validator_grammar() {
    const FILE: &str = "live.kit-socket-request.schema.json";
    let accepted = [
        json!({ "type": "subscribe", "name": "listNotes", "args": {} }),
        json!({ "type": "subscribe", "name": "listNotes", "args": { "boardId": "b1" },
                "supersedes": "sub_1" }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": { "token": "sbrt1.abc", "meta": { "app": "notes" } } } }),
        // membershipWitness is accepted at any shape on this arm (rung 2
        // deferred): the transport check is presence-only.
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": { "token": "sbrt1.abc" },
                                      "membershipWitness": { "unvalidated": true } } }),
        json!({ "type": "unsubscribe", "subscriptionId": "sub_1" }),
        json!({ "type": "ping" }),
        json!({ "type": "ping", "requestId": "req-1" }),
    ];
    for frame in &accepted {
        assert_validates(FILE, frame);
    }
    let rejected = [
        json!("subscribe"),
        json!({ "type": "snapshot" }),
        json!({ "type": "subscribe", "name": "listNotes" }),
        json!({ "type": "subscribe", "name": "", "args": {} }),
        json!({ "type": "subscribe", "name": "listNotes", "args": [] }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {}, "supersedes": "" }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {}, "supersedes": null }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {}, "extra": 1 }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": { "token": "" } } }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": { "token": "x".repeat(1025) } } }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": {} } }),
        json!({ "type": "subscribe", "name": "listNotes", "args": {},
                "resumeFromToken": { "resume": { "token": "t" }, "extra": 1 } }),
        json!({ "type": "unsubscribe", "subscriptionId": "" }),
        json!({ "type": "unsubscribe" }),
        json!({ "type": "unsubscribe", "subscriptionId": "sub_1", "extra": 1 }),
        json!({ "type": "ping", "requestId": 7 }),
        json!({ "type": "ping", "requestId": null }),
        json!({ "type": "ping", "extra": true }),
    ];
    for frame in &rejected {
        assert_rejects(FILE, frame);
    }
}

/// The kit-socket in-band reply grammar after LLP 0094 §0C.6 item 6's
/// convergence. The Cloudflare wire-schema gate validates real served bytes
/// for all four variants against the same committed schema.
#[test]
fn kit_socket_reply_schema_accepts_only_the_converged_kit_dialect() {
    const FILE: &str = "live.kit-socket-reply.schema.json";
    let resume = json!({
        "token": "sbrt1.opaque",
        "meta": {
            "app": "notes",
            "version": 7,
            "contentDigest": "mset1:opaque",
            "generation": "gen1:opaque",
            "versionStream": "stream-1",
            "queryArtifact": "query-1",
            "argsHash": "args-1"
        }
    });
    let accepted = [
        json!({ "kind": "pong" }),
        json!({ "kind": "pong", "requestId": "req-1" }),
        json!({
            "kind": "current_as_of",
            "subscription_id": "sub_1",
            "function": "boardNotes",
            "version": 7,
            "resume": resume.clone()
        }),
        json!({
            "kind": "snapshot",
            "subscription_id": "sub_2",
            "function": "boardNotes",
            "version": 7,
            "rows": [{ "_id": "note_1", "text": "hello" }]
        }),
        json!({
            "kind": "snapshot",
            "subscription_id": "sub_3",
            "function": "boardNotes",
            "version": 7,
            "rows": [],
            "resume": resume,
            "resumeRefusal": "SNAPBACK_RESUME_STREAM_MISMATCH"
        }),
        json!({
            "kind": "error",
            "diagnostic": {
                "code": "SNAPBACK_LIVE_NOT_A_LIVE_QUERY",
                "severity": "error",
                "subsystem": "realtime",
                "message": "missing is not a live query",
                "details": { "function": "missing" }
            }
        }),
    ];
    for frame in &accepted {
        assert_validates(FILE, frame);
    }

    let rejected = [
        // Proof-socket and broader local-socket families are not kit replies.
        json!({ "type": "snapshot", "subscriptionId": "sub_1", "function": "boardNotes",
                "version": 7, "rows": [], "connectionKey": "conn_1" }),
        json!({ "kind": "live_replace", "subscription_id": "sub_1",
                "function": "boardNotes", "version": 7, "rows": [] }),
        json!({ "kind": "unsubscribe" }),
        json!({ "kind": "pong", "requestId": null }),
        json!({ "kind": "pong", "requestId": 7 }),
        json!({ "kind": "pong", "serverTimeMs": 1 }),
        json!({ "kind": "current_as_of", "subscription_id": "sub_1",
                "function": "boardNotes", "version": 7 }),
        json!({ "kind": "current_as_of", "subscriptionId": "sub_1",
                "function": "boardNotes", "version": 7,
                "resume": { "token": "sbrt1.opaque" } }),
        json!({ "kind": "snapshot", "subscription_id": "sub_1",
                "function": "boardNotes", "version": 7 }),
        json!({ "kind": "snapshot", "subscription_id": "sub_1",
                "function": "boardNotes", "version": 9_007_199_254_740_992_u64,
                "rows": [] }),
        json!({ "kind": "snapshot", "subscription_id": "sub_1",
                "function": "boardNotes", "version": 7, "rows": [],
                "resumeRefusal": null }),
        json!({ "kind": "error", "code": "SNAPBACK_LIVE_NOT_A_LIVE_QUERY" }),
        json!({ "kind": "error", "diagnostic": {
            "code": "SNAPBACK_LIVE_NOT_A_LIVE_QUERY",
            "message": "missing is not a live query"
        } }),
        json!({ "kind": "error", "diagnostic": {
            "code": "SNAPBACK_LIVE_NOT_A_LIVE_QUERY",
            "severity": "error",
            "subsystem": "realtime",
            "message": "missing is not a live query",
            "details": {}
        }, "operation": "subscribe" }),
    ];
    for frame in &rejected {
        assert_rejects(FILE, frame);
    }
}

/// LLP 0094 §0A.5: the drain response is a bare array of `RealtimeEnvelope`.
/// Positive instances cover the empty drain and the synthesized
/// unknown-or-reaped batch, built through the SAME constructors
/// `drain_outbox` uses so the fixture cannot drift from the served bytes.
#[test]
fn outbox_drain_schema_accepts_the_served_batches_and_rejects_wrappers() {
    use snapback::ephemeral::{DurableMessage, RealtimeEnvelope};
    use snapback::live_wire::{LiveEnvelope, OutboxDrainOutput};

    const FILE: &str = "live.outbox-drain.output.schema.json";
    let empty = serde_json::to_value(OutboxDrainOutput(Vec::new())).expect("serialize empty drain");
    assert_eq!(empty, json!([]));
    assert_validates(FILE, &empty);

    // The admitted-but-unknown/reaped single-element batch (the
    // `admitted.is_none()` arm of `drain_outbox`, LLP 0094 §0A.5).
    let synthesized = OutboxDrainOutput(vec![RealtimeEnvelope::Durable(DurableMessage::new(
        serde_json::to_vec(&LiveEnvelope::ResyncRequired {
            network_profile: None,
            reason: "unknown_or_reaped".to_owned(),
            subscription_id: None,
            scope: None,
            epoch: None,
            clear_retained: true,
        })
        .expect("serialize resync envelope"),
    ))]);
    let synthesized = serde_json::to_value(synthesized).expect("serialize synthesized batch");
    assert_validates(FILE, &synthesized);

    // Never an object wrapper, never NDJSON-ish strings, never bare payloads.
    assert_rejects(FILE, &json!({ "batch": [] }));
    assert_rejects(FILE, &json!([{ "kind": "live_replace" }]));
    assert_rejects(FILE, &json!(["{\"Durable\":{\"payload\":[]}}"]));
}

/// LLP 0094 §0F item 4: the former §0C gap rows now have standalone committed
/// schemas — `QueryOutput`, the action output, the ephemeral HTTP
/// request/outcome families, and the sessions-mode socket family.
#[test]
fn gap_row_schemas_accept_representative_values() {
    // QueryOutput: the served `FunctionResponse<T>` admits only the exact
    // server-derived attribution block beside the flattened query fields.
    let query_output = json!({ "version": 7, "rows": [{ "_id": "n1", "text": "hi" }] });
    assert_validates("query.output.schema.json", &query_output);
    let mut with_cursor = query_output.clone();
    with_cursor["cursor"] = json!("cursor.v1.abc");
    assert_validates("query.output.schema.json", &with_cursor);
    let mut attributed = query_output.clone();
    attributed["attribution"] = json!({
        "actorUserId": "agent_1",
        "effectiveUserId": "user_1",
        "grantId": "grant_1",
        "dryRun": false
    });
    assert_validates("query.output.schema.json", &attributed);
    let completeness_fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/conformance/completeness-proof-v1.json"
    ))
    .expect("parse completeness proof fixture");
    let finite_carrier = json!({
        "version": 43,
        "rows": [{ "_id": "r1", "n": 1 }],
        "completenessProof": completeness_fixture["proof"].clone(),
        "authorizationWitness": completeness_fixture["witness"].clone(),
        "pageSetManifest": {
            "identity": concat!(
                "sha256:",
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            ),
            "orderedProofDigests": [concat!(
                "sha256:",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            )]
        }
    });
    assert_validates("query.output.schema.json", &finite_carrier);
    assert_validates(
        "query.input.schema.json",
        &json!({
            "args": {},
            "completenessNamespace": {
                "clientStoreId": "store_1",
                "queryKey": completeness_fixture["proof"]["materializationKey"].clone(),
                "queryInstanceId": 17
            },
            "priorCompletenessProofs": [completeness_fixture["proof"].clone()]
        }),
    );
    let mut oversized = query_output.clone();
    oversized["version"] = json!(9_007_199_254_740_992_u64);
    assert_rejects("query.output.schema.json", &oversized);
    assert_rejects("query.output.schema.json", &json!({ "rows": [] }));

    // The action output (`FunctionResponse<FunctionRunResult>` minus the
    // flattened attribution, which the open family likewise admits).
    let action_output = serde_json::to_value(snapback::local::FunctionRunResult {
        ok: true,
        function: "sendDigest".to_owned(),
        kind: Some(snapback::manifest::FunctionKind::Action),
        reads: vec![],
        writes: vec!["notes".to_owned()],
        captured_reads: vec![],
        captured_writes: vec![],
        conformance: Some(
            snapback::conformance::DeclarationConformance::without_capture(
                snapback::conformance::DependencyProvenance::Unsupported,
            ),
        ),
        admin_bypass: false,
        elapsed_ms: 12,
        version: Some(7),
        changed_count: Some(1),
        rows: None,
        result: Some(json!({ "sent": true })),
        diagnostic: None,
    })
    .expect("serialize action output");
    assert_validates("action.output.schema.json", &action_output);
    assert_rejects("action.output.schema.json", &json!({ "ok": true }));

    // Ephemeral HTTP requests (dev wire shape; sessions mode substitutes the
    // closed Session* DTOs of the sessions socket family below).
    let publish = json!({
        "collection": "presence",
        "scope": { "board": "b1" },
        "connection_id": "conn_1",
        "session_id": null,
        "user_id": null,
        "custom_key": null,
        "value": [123, 34, 120, 34, 58, 49, 125],
        "ttl_ms": 30_000,
        "auth": { "principal": null, "session_id": null, "user_id": null, "permissions": [] }
    });
    assert_validates("ephemeral.publish.input.schema.json", &publish);
    let subscribe = json!({
        "collection": "presence",
        "scope": { "board": "b1" },
        "connection_id": "conn_1",
        "auth": { "principal": null, "session_id": null, "user_id": null, "permissions": [] }
    });
    assert_validates("ephemeral.subscribe.input.schema.json", &subscribe);
    let mut delete = publish.clone();
    delete.as_object_mut().unwrap().remove("value");
    delete.as_object_mut().unwrap().remove("ttl_ms");
    assert_validates("ephemeral.delete.input.schema.json", &delete);
    let mut authless = subscribe.clone();
    authless.as_object_mut().unwrap().remove("auth");
    assert_rejects("ephemeral.subscribe.input.schema.json", &authless);

    // Ephemeral HTTP outcomes.
    let room = json!({
        "collection": "presence",
        "scope": { "board": "b1" },
        "routing_key": "board=b1"
    });
    let publish_outcome = json!({
        "room": room,
        "key": "connection:conn_1",
        "scope_epoch": 1,
        "entry_version": 3,
        "expires_at_ms": 1_753_500_030_000_u64
    });
    assert_validates("ephemeral.publish.output.schema.json", &publish_outcome);
    let mut versionless_outcome = publish_outcome.clone();
    versionless_outcome
        .as_object_mut()
        .unwrap()
        .remove("entry_version");
    assert_rejects("ephemeral.publish.output.schema.json", &versionless_outcome);
    let snapshot = json!({
        "Snapshot": {
            "room": room,
            "scope_epoch": 1,
            "room_authority_generation": 1,
            "high_water_version": 3,
            "entries": [{
                "key": "connection:conn_1",
                "value": [1, 2, 3],
                "received_at_ms": 1_753_500_000_000_u64,
                "expires_at_ms": 1_753_500_030_000_u64,
                "scope_epoch": 1,
                "entry_version": 3
            }]
        }
    });
    assert_validates("ephemeral.subscribe.output.schema.json", &snapshot);
    assert_rejects(
        "ephemeral.subscribe.output.schema.json",
        &json!({ "Snapshot": {}, "Upsert": {} }),
    );
    // `/ephemeral/delete` answers the removed entry's final message, or
    // `null` when nothing was present.
    assert_validates("ephemeral.delete.output.schema.json", &Value::Null);

    // Sessions-mode socket family: closed, identity-free.
    let session_publish = json!({
        "type": "ephemeral_publish",
        "requestId": "req-1",
        "request": {
            "collection": "presence",
            "scope": { "board": "b1" },
            "connection_id": "conn_1",
            "value": [1, 2, 3],
            "ttl_ms": null
        }
    });
    assert_validates("live.socket-client.sessions.schema.json", &session_publish);
    let session_ping = json!({ "type": "ping" });
    assert_validates("live.socket-client.sessions.schema.json", &session_ping);
    let mut asserted_identity = session_publish.clone();
    asserted_identity["request"]["user_id"] = json!("user_1");
    assert_rejects(
        "live.socket-client.sessions.schema.json",
        &asserted_identity,
    );
    let mut unknown_kind = session_publish;
    unknown_kind["type"] = json!("ephemeral_broadcast");
    assert_rejects("live.socket-client.sessions.schema.json", &unknown_kind);
}

#[test]
fn hosted_product_journey_receipt_is_rust_owned_and_closed() {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .join("demos/signal-desk/hosted-product-journey.v1.json");
    let bytes = fs::read(&path).expect("hosted product journey receipt");
    let value: Value = serde_json::from_slice(&bytes).expect("journey receipt JSON");
    assert_validates("hosted-product-journey-v1.schema.json", &value);
    let parsed: HostedProductJourneyV1 =
        serde_json::from_value(value.clone()).expect("journey receipt Rust carrier");
    parsed
        .validate_claim_boundary()
        .expect("failed receipts may retain partial remote evidence");
    assert_eq!(
        serde_json::to_value(parsed).expect("serialize journey receipt"),
        value
    );
    let mut unsupported_success = value.clone();
    unsupported_success["status"] = json!("passed");
    let unsupported_success: HostedProductJourneyV1 =
        serde_json::from_value(unsupported_success).expect("success-shaped receipt");
    let missing = unsupported_success
        .validate_claim_boundary()
        .expect_err("shape alone must not create a hosted capability claim");
    assert!(
        missing
            .iter()
            .any(|error| error == "source.releaseEligible")
    );
    assert!(
        missing
            .iter()
            .any(|error| error == "evidence.completeFamily")
    );
    assert!(
        missing
            .iter()
            .any(|error| error == "claimBoundary.complete")
    );

    let mut failed_overclaim = value.clone();
    failed_overclaim["claimBoundary"]["hostedProductJourneyPassed"] = json!(true);
    failed_overclaim["claimBoundary"]["hostedEphemeralCapabilityAdvertised"] = json!(true);
    let failed_overclaim: HostedProductJourneyV1 =
        serde_json::from_value(failed_overclaim).expect("failed overclaim-shaped receipt");
    let errors = failed_overclaim
        .validate_claim_boundary()
        .expect_err("failed receipts cannot retain positive hosted claims");
    assert!(
        errors
            .iter()
            .any(|error| error == "failedReceipt.claimBoundary")
    );

    let mut missing_artifact = value.clone();
    missing_artifact["evidence"]["logs"] = json!({
        "artifactKind": "structuredLogs",
        "artifactId": "logs-receipt-1",
        "sha256": format!("sha256:{}", "a".repeat(64)),
        "bytes": 1,
        "mediaType": "application/json"
    });
    let missing_artifact: HostedProductJourneyV1 =
        serde_json::from_value(missing_artifact).expect("evidence-shaped receipt");
    let errors = missing_artifact
        .validate_claim_boundary()
        .expect_err("unreopenable evidence cannot validate");
    assert!(
        errors
            .iter()
            .any(|error| error == "evidence.logs.artifactMissing")
    );

    let mut private_material = value.clone();
    private_material["rows"]["publicServedPath"]["reason"] =
        json!("debug output retained under /tmp/private-receipt");
    let private_material: HostedProductJourneyV1 =
        serde_json::from_value(private_material).expect("private-material-shaped receipt");
    let errors = private_material
        .validate_claim_boundary()
        .expect_err("private paths cannot enter the retained receipt");
    assert!(
        errors
            .iter()
            .any(|error| error.ends_with(".privateMaterial"))
    );
    let mut unknown = value;
    unknown["unexpected"] = json!(true);
    assert_rejects("hosted-product-journey-v1.schema.json", &unknown);
    assert!(serde_json::from_value::<HostedProductJourneyV1>(unknown).is_err());
}

/// @ref LLP 0037#dated-alignment-asset-subsystem-artifacts-2026-07-31 — the
/// asset wire shapes round-trip through their committed schemas: Rust-built
/// representative values serialize, validate, and reject unknown members.
#[test]
fn asset_wire_schemas_accept_rust_values_and_reject_extensions() {
    use snapback::assets::{
        ASSET_DIGEST_ALGORITHM_SHA256, ASSET_UPLOAD_REFERENCE_KIND, AssetAttemptState,
        AssetAvailability, AssetIntegrityGrade, AssetLifecycleMessageV1, AssetReceiptEventV1,
        AssetReceiptV1, AssetTaskStateV1, AssetTusInstructionV1, AssetUploadReference,
    };

    let reference = AssetUploadReference {
        artifact_kind: ASSET_UPLOAD_REFERENCE_KIND.to_owned(),
        schema_version: "snapback.v0".to_owned(),
        app_id: "app_1".to_owned(),
        id: "avatarUpload".to_owned(),
        name: "avatarUpload".to_owned(),
        implementation_hash: "sha256:aa".to_owned(),
        args_contract_hash: "sha256:bb".to_owned(),
        argument_schema: json!({"type": "object"}),
        intent_policy_hash: "sha256:cc".to_owned(),
        policy_generation: 3,
        required_capabilities: vec!["asset_lifecycle_v1".to_owned()],
    };
    let mut reference_value = serde_json::to_value(&reference).unwrap();
    assert_validates("asset.upload-reference.schema.json", &reference_value);
    reference_value["expectedOperation"] = json!({});
    assert_rejects("asset.upload-reference.schema.json", &reference_value);

    let task = AssetTaskStateV1 {
        asset_id: "01890f3c-9d5b-7000-8000-000000000010".to_owned(),
        attempt_id: "01890f3c-9d5b-7000-8000-000000000011".to_owned(),
        attempt_state: AssetAttemptState::Transferring,
        availability: AssetAvailability::Pending,
        acknowledged_offset: 1024,
        total_bytes: 4096,
        expires_at_ms: 1_800_000_000_000,
        integrity_grade: AssetIntegrityGrade::EndToEndVerified,
        primary_rendition_id: None,
        diagnostic: None,
    };
    assert_validates(
        "asset.task-state.schema.json",
        &serde_json::to_value(&task).unwrap(),
    );

    let transfer = AssetTusInstructionV1 {
        upload_url: "/_snapback/api/assets/tus/01890f3c".to_owned(),
        tus_resumable: "1.0.0".to_owned(),
        upload_length: 4096,
        expires_at_ms: 1_800_000_000_000,
        checksum_algorithms: vec![ASSET_DIGEST_ALGORITHM_SHA256.to_owned()],
        max_chunk_bytes: 1_048_576,
    };
    assert_validates(
        "asset.tus-instruction.schema.json",
        &serde_json::to_value(&transfer).unwrap(),
    );

    let message = AssetLifecycleMessageV1::Availability {
        asset_id: task.asset_id.clone(),
        availability: AssetAvailability::Ready,
        lifecycle_generation: 4,
    };
    assert_validates(
        "asset.lifecycle-message.schema.json",
        &serde_json::to_value(&message).unwrap(),
    );

    let receipt = AssetReceiptV1 {
        receipt_id: "01890f3c-9d5b-7000-8000-000000000012".to_owned(),
        operation_lineage: "01890f3c-9d5b-7000-8000-000000000013".to_owned(),
        event: AssetReceiptEventV1::AssetReady,
        asset_id: Some(task.asset_id.clone()),
        attempt_id: Some(task.attempt_id.clone()),
        at_ms: 1_800_000_000_000,
        details: json!({"lifecycleGeneration": 4}),
    };
    assert_validates(
        "asset.receipt.schema.json",
        &serde_json::to_value(&receipt).unwrap(),
    );
}
