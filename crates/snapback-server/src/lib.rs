//! Snapback HTTP transport adapters.
//!
//! This crate owns the Axum application, route and operation registries,
//! response envelopes, admin-console serving, hosted-edge transport, instance
//! home, and the OAuth/MCP remotes. Domain policy and commit authority remain
//! in lower-ranked crates.

#![allow(clippy::result_large_err)]

pub use snapback_activation::{bundle, completeness, config, deploy, operational_readiness};
pub use snapback_auth::dev_identity;
pub use snapback_engine::{ask, host_ops, push, runtime};
pub(crate) use snapback_kernel::proof_checkpoint;
pub use snapback_kernel::{
    authoring_suggestion, conformance, data_patch, diagnostic, membership_rules, operation_ledger,
    remediation, secure_file, seed_identity, storage, watches,
};
pub use snapback_services::{errors_query, outbound_policy, telemetry_query, webhooks};
pub use snapback_sync::{ephemeral, live_coalesce, spike_trace, stream_attempt};
pub use snapback_types::{
    api_envelope, args_contract, commit_envelope, contract_types, exec_guard, identity, ids,
    live_wire, network_profile, rqs_contract, telemetry_contract, visibility_governance,
    wire_version,
};

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

pub mod assets_store {
    pub use snapback_kernel::assets_store::*;
    pub(crate) use snapback_services::assets_store::{
        AssetStoreBackend, AssetTusPatchGates, hash_path,
    };
}

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

pub mod contract_exact {
    pub use snapback_types::contract_exact::*;

    pub fn native_artifacts_unavailable(path: &str) -> crate::diagnostic::SnapbackError {
        snapback_types::contract_exact::native_artifacts_unavailable(path).into()
    }

    pub fn native_artifact_missing(path: &str) -> crate::diagnostic::SnapbackError {
        snapback_types::contract_exact::native_artifact_missing(path).into()
    }
}

pub mod instance_fork {
    pub use snapback_kernel::instance_fork::*;
    pub use snapback_services::instance_fork::*;
    pub use snapback_types::instance_fork::*;
}

pub mod jobs {
    pub use snapback_kernel::storage::jobs::*;
    pub(crate) use snapback_kernel::storage::jobs::{
        canonical_push_grant, canonical_rehearsal_provenance,
    };
}

pub mod telemetry {
    pub use snapback_services::telemetry::*;
}

pub mod local {
    pub use snapback_activation::generation_activation::DiagnosticBoundary;
    pub use snapback_engine::local::*;
}

pub mod admin;
pub mod admin_agent_destroy;
pub mod admin_impersonation;
pub mod admin_link;
pub mod admin_secret_read;
pub mod auth;
pub mod control_catalog;
pub mod guide;
pub mod guide_reference;
pub mod manifest;
pub mod server;
