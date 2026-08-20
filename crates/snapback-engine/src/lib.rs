//! Transport-independent Snapback engine and domain composition point.
//!
//! Adapters call this crate; it orchestrates lower-ranked activation, auth,
//! storage, runtime, services, and sync owners without owning transport.

#![allow(clippy::result_large_err)]

pub(crate) use snapback_activation::{
    agent_safe_publication, bundle, completeness, config, deploy, generation_activation,
    operational_readiness,
};
pub use snapback_kernel::{
    authoring_suggestion, branches, conformance, data_patch, diagnostic, fork_promotion,
    live_matcher, membership_rules, migration, operation_ledger, remediation, seed_identity, vector,
    watches,
};
pub(crate) use snapback_kernel::{operation_detail, proof_checkpoint, search, storage};
pub(crate) use snapback_runtime::{elevated_read_trace, warm_vm};
#[cfg(test)]
pub(crate) use snapback_services::{assets_image, assets_video};
pub use snapback_services::{
    assets_s3, error_tracking, outbound_policy, telemetry_query, webhooks,
};
pub use snapback_sync::{
    bounded_children_cursor, connected_clients, ephemeral, live_coalesce, realtime, rqs,
    snapshot_batch_cursor, snapshot_batch_cursor_v2, spike_trace, stream_attempt,
};
pub use snapback_types::{
    api_envelope, app_data_result, args_contract, commit_envelope, contract_types, exec_guard,
    host_ops_contract, identity, ids, live_wire, network_profile, owner_only_file, result_contract,
    rqs_contract, telemetry_contract, value_expr, visibility_governance, wire_version,
};

pub mod workerd_exec {
    pub(crate) use snapback_runtime::workerd_exec::selected_backend;
    pub use snapback_runtime::workerd_exec::{
        CompatConfig, HandlerBackend, compat_config, default_wall_clock_timeout_ms,
        detect_workerd_binary, with_forced_backend, with_wall_clock_timeout_ms, workerd_version,
    };
}

pub(crate) use snapback_sync::auth;

pub mod assets {
    pub use snapback_kernel::assets::*;
    pub use snapback_services::assets::*;
}

pub mod assets_cut {
    pub use snapback_kernel::assets_cut::*;
    pub use snapback_services::assets_cut::*;
}

pub mod assets_store {
    pub use snapback_kernel::assets_store::*;
    pub use snapback_services::assets_store::*;
}

#[doc(hidden)]
pub mod bench_support;

pub mod cron {
    pub use snapback_services::cron::*;
}

pub mod instance_fork {
    pub use snapback_kernel::instance_fork::*;
    pub use snapback_services::instance_fork::*;
    pub use snapback_types::instance_fork::*;
}

pub mod jobs {
    pub use snapback_kernel::storage::jobs::*;
}

pub mod telemetry {
    pub use snapback_services::telemetry::*;
}

pub mod ask;
pub mod control_catalog;
pub mod host_ops;
pub mod local;
pub mod manifest;
pub mod push;
pub mod runtime;
pub mod schema_export;

#[cfg(feature = "test-support")]
pub mod test_support;
