//! Core Snapback runtime components.
//!
//! # Public API stability
//!
//! [`embed`] is the sole supported Rust embedding API. Public items outside
//! that module remain reachable for source compatibility, but they are hidden
//! from the generated documentation and carry no stability promise.
//!
//! While the crate is `0.x`, patch releases preserve `snapback::embed` source
//! compatibility and a minor release may make a breaking embedding-API change.
//! The Rust crate version and Snapback's wire-protocol version are independent.
//!
//! @ref LLP 0141#d1-curate-the-public-surface-before-anyone-depends-on-it —
//!   one documented façade owns the supported Rust embedding contract.

// SnapbackResult intentionally carries structured diagnostic details across the
// public API; narrowing it is a larger compatibility decision than clippy's
// result-size heuristic.
#![allow(clippy::result_large_err)]

// @ref LLP 0225#1-ownership-map — owner 6 preserves this supported
// façade while non-façade implementation modules become crate-private.
pub mod embed;

pub(crate) use snapback_activation::agent_safe_publication;
pub(crate) use snapback_engine::ask;
#[doc(hidden)]
pub use snapback_server::admin;
pub use snapback_server::admin_agent_destroy;
#[doc(hidden)]
pub use snapback_server::admin_impersonation;
#[doc(hidden)]
pub use snapback_server::admin_link;
#[doc(hidden)]
pub use snapback_server::admin_secret_read;
#[doc(hidden)]
pub use snapback_types::api_envelope;
#[doc(hidden)]
pub use snapback_types::app_data_result;
#[doc(hidden)]
pub use snapback_types::args_contract;
#[doc(hidden)]
pub mod assets {
    pub use snapback_kernel::assets::*;
    pub(crate) use snapback_services::assets::{
        AssetFactsLocalExt, AssetFinalizePreparation, AssetFinalizePrepareError,
        AssetFinalizePrepareFailure, AssetFsStoreLocalExt, AssetPreparedCanonical,
        AssetPreparedCanonicalObject, AssetTusPatchTicketV1, AssetVariantPreparation,
        FinalizeCommitTicketV1, FinalizePhaseAOutcomeV1, FinalizePreflightV1,
        FinalizePreparationV1, FinalizePrepareTicketV1, FinalizePutTicketV1, prepare_asset_variant,
        prepare_required_asset_variants,
    };
    pub use snapback_services::assets::{AssetFsStore, detect_content_type, schema_registrations};
}
#[doc(hidden)]
pub mod assets_cut {
    pub use snapback_kernel::assets_cut::*;
    pub(crate) use snapback_services::assets_cut::resolve_import_blob_path;
    pub use snapback_services::assets_cut::{validate_export_dir, validation_summary};
}
#[doc(hidden)]
pub use snapback_services::assets_image;
#[doc(hidden)]
pub use snapback_services::assets_s3;
#[doc(hidden)]
pub mod assets_store {
    pub use snapback_kernel::assets_store::*;
    pub(crate) use snapback_services::assets_store::{
        AssetStoreBackend, AssetTusPatchGates, hash_path,
    };
}
#[doc(hidden)]
pub use snapback_activation::bundle;
#[doc(hidden)]
pub use snapback_activation::completeness;
#[doc(hidden)]
pub use snapback_activation::config;
#[doc(hidden)]
pub use snapback_cli::cli;
#[doc(hidden)]
pub use snapback_engine::bench_support;
pub(crate) use snapback_kernel::authoring_suggestion;
#[doc(hidden)]
pub use snapback_kernel::branches;
pub use snapback_kernel::conformance;
#[doc(hidden)]
pub mod auth {
    // Preserve the supported façade surface without publishing the server's
    // internal admission, coordinator, or storage-authority modules.
    // @ref LLP 0276#phases — inter-crate carve ports do not become façade
    //   capabilities merely because their owner crates require `pub`.
    pub mod handshake {
        pub use snapback_types::auth::handshake::*;

        pub fn lease_error(
            code: &'static str,
            message: impl Into<String>,
        ) -> crate::diagnostic::SnapbackError {
            snapback_types::auth::handshake::lease_error(code, message).into()
        }
    }

    pub use snapback_auth::auth::{
        deployment, effective_source, hosted_edge, invalidation, mailbox, provider, sender_proof,
    };
    pub use snapback_kernel::auth::{crypto, keyring, lease, mode};
    pub use snapback_server::auth::runtime;
    pub use snapback_types::auth::{descriptor, wire};

    pub(crate) use snapback_auth::auth::{admission, backup, lifecycle, service_fence};
    pub(crate) use snapback_kernel::auth::{logical_transfer, rehearsal, rescue, throttle};
    pub(crate) use snapback_server::auth::recovery;
    pub(crate) use snapback_sync::auth::{coordinator, invocation, session_projection};
    pub(crate) use snapback_types::auth::{identity_core, service_authority_contract};
}
#[doc(hidden)]
pub use snapback_services::assets_video;
pub(crate) use snapback_sync::bounded_children_cursor;
pub(crate) use snapback_sync::connected_clients;
#[doc(hidden)]
pub use snapback_types::bench_fixture;
#[doc(hidden)]
pub use snapback_types::commit_envelope;
pub(crate) mod contract_exact {
    pub use snapback_types::contract_exact::*;
    pub fn native_artifacts_unavailable(path: &str) -> crate::diagnostic::SnapbackError {
        snapback_types::contract_exact::native_artifacts_unavailable(path).into()
    }
    pub fn native_artifact_missing(path: &str) -> crate::diagnostic::SnapbackError {
        snapback_types::contract_exact::native_artifact_missing(path).into()
    }
}
// @ref LLP 0225#1-ownership-map — owner 1: crate-private generation
// activation coordinator.
pub(crate) use snapback_activation::generation_activation;
pub(crate) use snapback_runtime::elevated_read_trace;
pub(crate) use snapback_sync::spike_trace;
#[doc(hidden)]
pub use snapback_types::visibility_governance;
// @ref LLP 0225#1-ownership-map — dependency-free shared contract/types
// leaf consumed downward by Rust owners and generated-artifact producers.
#[doc(hidden)]
pub use snapback_server::control_catalog;
#[doc(hidden)]
pub use snapback_types::contract_types;
#[doc(hidden)]
pub mod cron {
    pub use snapback_services::cron::{
        CRON_MAX_ACTIVE_RUNS_PER_JOB, CronActivationState, CronInspectState, CronJobInspect,
        CronListJob, CronListState, CronRunClaim, CronRunMetadata, CronRunOutcome, CronRunRecord,
        CronRunTrigger, LocalCronRuntime, validate_cron_manifest,
    };
    pub(crate) use snapback_services::cron::{
        CronRunMetadataLocalExt, CronRunRecordLocalExt, civil_from_days,
    };
}
#[doc(hidden)]
pub use snapback_activation::deploy;
#[doc(hidden)]
pub use snapback_auth::dev_identity;
#[doc(hidden)]
pub use snapback_kernel::data_patch;
#[doc(hidden)]
pub use snapback_kernel::data_tier;
#[doc(hidden)]
pub use snapback_kernel::diagnostic;
#[doc(hidden)]
pub use snapback_kernel::fork_promotion;
#[doc(hidden)]
pub use snapback_server::guide;
pub(crate) use snapback_server::guide_reference;
#[doc(hidden)]
pub use snapback_server::host_ops;
#[doc(hidden)]
pub use snapback_services::error_tracking;
#[doc(hidden)]
pub use snapback_services::errors_query;
#[doc(hidden)]
pub use snapback_sync::ephemeral;
#[doc(hidden)]
pub use snapback_types::exec_guard;
#[doc(hidden)]
pub use snapback_types::handler_wire;
pub use snapback_types::host_ops_contract;
#[doc(hidden)]
pub use snapback_types::identity;
#[doc(hidden)]
pub use snapback_types::ids;
#[doc(hidden)]
pub mod instance_fork {
    pub use snapback_kernel::instance_fork::{
        CustodyDisposition, CustodyRule, DerivedForkRuntimeExt, ForkMintReceiptV1,
        MINT_RECEIPT_FILE, SERVER_EXPIRED_CODE, SIDECAR_CUSTODY, STAGING_SENTINEL, TABLE_CUSTODY,
        inspect_boot, inspect_boot_at, server_expired_error,
    };
    pub(crate) use snapback_kernel::instance_fork::{source_parent_instance_id, stored_app_id};
    pub use snapback_services::instance_fork::{
        ADMISSION_TIMEOUT_CODE, APP_BINDING_INTENT_FILE, APP_BINDING_MISMATCH_CODE,
        APP_BINDING_RECEIPT_FILE, APP_BINDING_REQUIRED_CODE, APP_ROOT_IDENTITY_FILE,
        ASSET_CUT_INCOMPLETE_CODE, ASSET_CUT_UNSUPPORTED_CODE, BASE_RECEIPT_FILE,
        BASE_SNAPSHOT_FILE, DIFF_ORACLE_MISMATCH_CODE, ExpectedForkAppV1,
        FORK_CREATION_ADMISSION_TIMEOUT_MS, FORK_DIFF_MAX_BYTES, FORK_DIFF_MAX_ROWS,
        ForkAppBindingReceiptV1, ForkBaseReceiptV1, ForkCleanupLock, ForkCreationAdmission,
        ForkDiffCommitBoundaryV1, ForkDiffReceiptV3, ForkDiffRowV1, ForkNetDiffReceiptV3,
        ForkNetDiffRowV1, ForkNetDiffWriterCoverageV1, ForkReapReceiptV1, ForkRegistryEntryV1,
        ForkRenewReceiptV1, ForkResourceLimits, ForkResourceUsageV1, MANAGED_FORK_MAX_COUNT,
        MANAGED_FORK_MAX_FORK_BYTES, MANAGED_FORK_MAX_LIFETIME_MS, MANAGED_FORK_MAX_TOTAL_BYTES,
        ManagedForkTargetV1, NET_DIFF_UNAVAILABLE_CODE, PublicationCut, REGISTRY_DIRECTORY,
        RENEW_EXPIRED_CODE, RENEW_INTENT_FILE, RENEW_RECEIPT_FILE, RESOURCE_LIMIT_REFUSED_CODE,
        RenewCut, WRITER_COVERAGE_INVALID_CODE, admit_creation, arm_derived_fork_app_row_coverage,
        audit_connection, clear_stale_registry_entry, clear_stale_registry_entry_locked,
        diff_receipt, diff_receipt_bounded, drop_managed, drop_managed_locked,
        enforce_creation_limits, ensure_expected_app, expired_managed, list_managed,
        load_expected_app, lock_cleanup, managed_entry, managed_registry_ids, managed_target,
        net_diff_receipt, publish, publish_managed, publish_managed_with_base,
        record_managed_runtime, recover, recover_bound, refreshed_lineage, renew_managed,
        renew_managed_with_crash_cut_for_test, resource_limit_refusal, scrub_and_mint,
        verified_derived_fork_app_row_coverage,
    };
    pub(crate) use snapback_services::instance_fork::{
        arm_open_derived_fork_app_row_coverage, directory_tree_bytes,
    };
    pub use snapback_types::instance_fork::contract;
    pub use snapback_types::instance_fork::*;
}
pub(crate) use snapback_kernel::instance_lock;
#[doc(hidden)]
pub mod jobs {
    pub use snapback_kernel::storage::jobs::*;
    pub(crate) use snapback_kernel::storage::jobs::{
        canonical_push_grant, canonical_rehearsal_provenance,
    };
}
pub(crate) use snapback_services::outbound_policy;
pub use snapback_sync::live_coalesce;
pub(crate) mod watches {
    pub use snapback_kernel::watches::*;
}
pub(crate) use snapback_services::webhooks;

pub use snapback_kernel::live_matcher;
#[doc(hidden)]
pub use snapback_types::live_wire;
#[doc(hidden)]
pub mod local {
    pub use snapback_activation::generation_activation::DiagnosticBoundary;
    pub use snapback_engine::local::*;
}
#[doc(hidden)]
pub mod manifest {
    pub use snapback_engine::manifest::*;
    pub use snapback_services::manifest::SchemaManifestValidationExt;
    pub use snapback_types::contract_types::{
        AgentsManifest, AgentsMode, ApiAskBilling, ApiAskBudgets, ApiAskManifest,
        ApiAskModelManifest, ApiAskPerPrincipalDayBudget, ApiAskPerRequestBudget,
        ApiAskResultVolumeBudget, ApiAskTokenBudget, ApiBudgetsManifest, ApiDisclosure,
        ApiFunctionApproval, ApiFunctionExposure, ApiManifest, ApiOAuthBundle, ApiOAuthManifest,
        AppIdentity, AssetCollectionMutationPlanV1, AssetCollectionOperationV1, AuthManifest,
        AuthMode, AuthPasswordIdentifierMode, AuthRequirement, BoundedParentVisibility,
        BoundedProjectionField, DependencySummary, EffectCeiling, EffectCeilingRead,
        EffectCeilingWrite, FieldManifest, FieldType, FunctionArgsContract, FunctionKind,
        FunctionResultContract, IbexModule, IndexManifest, InvitedBy, JoinEquality, JoinKind,
        MediaKindV1, PermissionScopeExpr, ProjectionLeaf, ProjectionOutputKey, ProjectionSource,
        ProjectionVisibility, ResultObjectFieldContract, ResultRowsBound, ResultValueContract,
        STORED_STRUCTURED_CONTRACT_VERSION_V1, STORED_STRUCTURED_ENCODING_V1, SchemaRefAuthority,
        SequenceDeclaration, SequenceExistingOwnerAccess, SequenceScopeAccess, SourceSpan,
        StandardPatternIdentity, StandardPatternMembershipIdentity, StoredStructuredContractV1,
        WriteActivityProvenanceFields, WriteActivityRelation, WriteWithActivityEffectFormula,
        WriteWithActivityMode, WriteWithActivitySourceOperation,
    };
    pub use snapback_types::manifest::*;
    pub use snapback_types::search::types::{
        FullTextSearchFactsV1, SearchClauseV1, SearchCursorLimitsV1, SearchCursorV1,
        SearchFieldClassV1, SearchFilterV1, SearchHighlightV1, SearchIndexManifestV1, SearchItemV1,
        SearchLiveLimitsV1, SearchMaintenanceLimitsV1, SearchMatchAtomV1, SearchMatchRangeV1,
        SearchPageV1, SearchPhraseV1, SearchQueryAstV1, SearchQueryLimitsV1, SearchQueryPlanV1,
        SearchRequestV1, SearchSourceLimitsV1, SearchTermV1, SearchTextFieldV1, SearchVisibilityV1,
    };
    pub use snapback_types::vector::types::{
        VectorFieldClassV1, VectorFilterOpV1, VectorFilterV1, VectorFilterValueV1,
        VectorIndexManifestV1, VectorItemV1, VectorMaintenanceLimitsV1, VectorMetricV1,
        VectorPageV1, VectorQueryPlanV1, VectorRequestV1, VectorSearchFactsV1, VectorTieBreakV1,
        VectorVisibilityV1,
    };
}
#[doc(hidden)]
pub use snapback_activation::operational_readiness;
pub use snapback_kernel::membership_rules;
#[doc(hidden)]
pub use snapback_kernel::migration;
#[doc(hidden)]
pub use snapback_kernel::migration_presentation;
pub(crate) use snapback_kernel::operation_detail;
#[doc(hidden)]
pub use snapback_kernel::operation_ledger;
#[doc(hidden)]
pub use snapback_types::network_profile;
pub(crate) use snapback_types::owner_only_file;
// The proof/checkpoint implementation contains commit primitives and
// admission carriers. Keep the kernel module available to in-crate adapters
// without publishing it as a forgeable façade surface.
pub(crate) use snapback_kernel::proof_checkpoint;
#[doc(hidden)]
pub mod push {
    pub(crate) use snapback_engine::push::*;
    pub use snapback_services::push::{
        PushAudienceReferenceV1, PushDeferredGrantV1, PushRegistryInspectionV1,
    };
    pub use snapback_types::push::*;
}
#[doc(hidden)]
pub use snapback_engine::runtime;
#[doc(hidden)]
pub use snapback_kernel::remediation;
#[doc(hidden)]
pub use snapback_services::replication;
pub use snapback_sync::realtime;
#[doc(hidden)]
pub use snapback_sync::rqs;
#[doc(hidden)]
pub use snapback_types::result_contract;
#[doc(hidden)]
pub use snapback_types::result_transform;
pub use snapback_types::rqs_contract;
#[doc(hidden)]
pub mod schema_export;
#[doc(hidden)]
pub use snapback_cli::store_state;
#[doc(hidden)]
pub use snapback_kernel::search;
pub(crate) use snapback_kernel::secure_file;
#[doc(hidden)]
pub use snapback_kernel::seed_identity;
#[doc(hidden)]
/// The services-only asset continuity capability is intentionally absent.
///
/// ```compile_fail
/// use snapback::storage::AssetAttemptCurrentProof;
/// ```
///
/// @ref LLP 0276#phases — raw lower-layer capability carriers must not be
/// re-exported by the supported façade.
pub use snapback_kernel::storage;
#[doc(hidden)]
pub use snapback_server::server;
pub(crate) use snapback_sync::snapshot_batch_cursor;
#[doc(hidden)]
pub use snapback_sync::snapshot_batch_cursor_v2;
#[doc(hidden)]
pub use snapback_sync::stream_attempt;
#[doc(hidden)]
pub use snapback_types::service_profile;
#[doc(hidden)]
#[cfg(feature = "telemetry-phase1-proof")]
#[path = "telemetry_bench.rs"]
mod telemetry_phase1_bench;
#[doc(hidden)]
pub mod telemetry {
    #[cfg(feature = "telemetry-phase1-proof")]
    pub use crate::telemetry_phase1_bench::{
        Phase1BenchmarkConfig, Phase1BenchmarkReport, run_phase1_benchmark,
    };
    pub use snapback_services::telemetry::{
        BufferDiagnostics, DEFAULT_BATCH_SIZE, DEFAULT_BUFFER_CAPACITY, DEFAULT_DAILY_DAYS,
        DEFAULT_FILE_SIZE_CAP_BYTES, DEFAULT_HOURLY_DAYS, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_DAYS,
        DEFAULT_PRIORITY_RESERVE, DEFAULT_ROLLUP_ROW_CAP, DEFAULT_SWEEP_INTERVAL_MS,
        DEFAULT_TOP_NAMES_PER_HOUR, MAX_MAX_DAYS, ObservationSpan, Phase, Priority, Telemetry,
        TelemetryConfig,
    };
    pub(crate) use snapback_services::telemetry::{
        CallerAttributionLocalExt, CallerAttributionV1, ObservationSpanLocalExt, TelemetryLocalExt,
        TelemetryStoreIdentity, TelemetryStoreIdentityLocalExt,
    };
}
#[doc(hidden)]
pub use snapback_kernel::vector;
pub(crate) use snapback_runtime::warm_vm;
#[doc(hidden)]
pub use snapback_services::telemetry_query;
#[doc(hidden)]
pub use snapback_types::telemetry_contract;
#[doc(hidden)]
pub use snapback_types::value_expr;
#[doc(hidden)]
pub use snapback_types::wire_fixtures;
#[doc(hidden)]
pub use snapback_types::wire_version;
#[doc(hidden)]
pub mod workerd_exec {
    pub(crate) use snapback_runtime::workerd_exec::selected_backend;
    pub use snapback_runtime::workerd_exec::{
        CapturedHandlerWire, CompatConfig, HandlerBackend, HostCallTestMode, InvokeAuthTestMode,
        compat_config, default_wall_clock_timeout_ms, detect_workerd_binary, refuse_node_compat,
        with_forced_backend, with_handler_wire_capture, with_host_call_test_mode,
        with_invoke_auth_test_mode, with_wall_clock_timeout_ms, workerd_missing_error,
        workerd_version,
    };
}
