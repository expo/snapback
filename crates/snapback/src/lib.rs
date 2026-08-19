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

#[doc(hidden)]
pub mod admin;
pub mod admin_agent_destroy;
#[doc(hidden)]
pub mod admin_impersonation;
#[doc(hidden)]
pub mod admin_link;
#[doc(hidden)]
pub mod admin_secret_read;
pub(crate) use snapback_activation::agent_safe_publication;
#[doc(hidden)]
pub use snapback_types::api_envelope;
#[doc(hidden)]
pub use snapback_types::app_data_result;
#[doc(hidden)]
pub use snapback_types::args_contract;
pub(crate) use snapback_engine::ask;
#[doc(hidden)]
pub mod assets;
#[doc(hidden)]
pub mod assets_cut;
#[doc(hidden)]
pub use snapback_services::assets_image;
#[doc(hidden)]
pub use snapback_services::assets_s3;
#[doc(hidden)]
pub mod assets_store;
#[doc(hidden)]
pub use snapback_services::assets_video;
#[doc(hidden)]
pub mod auth;
pub(crate) use snapback_kernel::authoring_suggestion;
#[doc(hidden)]
pub use snapback_engine::bench_support;
#[doc(hidden)]
pub use snapback_types::bench_fixture;
pub(crate) use snapback_sync::bounded_children_cursor;
#[doc(hidden)]
pub use snapback_kernel::branches;
#[doc(hidden)]
pub use snapback_activation::bundle;
#[doc(hidden)]
pub mod cli;
#[doc(hidden)]
pub use snapback_types::commit_envelope;
#[doc(hidden)]
pub use snapback_activation::completeness;
#[doc(hidden)]
pub use snapback_activation::config;
pub use snapback_kernel::conformance;
pub(crate) use snapback_sync::connected_clients;
pub(crate) mod contract_exact;
// @ref LLP 0225#1-ownership-map — owner 1: crate-private generation
// activation coordinator.
pub(crate) use snapback_runtime::elevated_read_trace;
pub(crate) use snapback_activation::generation_activation;
#[doc(hidden)]
pub use snapback_types::visibility_governance;
pub(crate) use snapback_sync::spike_trace;
#[cfg(test)]
mod sync_upward_tests;
// @ref LLP 0225#1-ownership-map — dependency-free shared contract/types
// leaf consumed downward by Rust owners and generated-artifact producers.
#[doc(hidden)]
pub use snapback_types::contract_types;
#[doc(hidden)]
pub mod control_catalog;
#[doc(hidden)]
pub mod cron;
#[doc(hidden)]
pub use snapback_kernel::data_patch;
#[doc(hidden)]
pub use snapback_kernel::data_tier;
#[doc(hidden)]
pub use snapback_activation::deploy;
#[doc(hidden)]
pub use snapback_auth::dev_identity;
#[doc(hidden)]
pub mod diagnostic;
#[doc(hidden)]
pub use snapback_sync::ephemeral;
#[doc(hidden)]
pub use snapback_services::error_tracking;
#[doc(hidden)]
pub use snapback_services::errors_query;
#[doc(hidden)]
pub use snapback_kernel::fork_promotion;
#[doc(hidden)]
pub use snapback_types::exec_guard;
#[doc(hidden)]
pub mod guide;
pub(crate) mod guide_mcp;
pub(crate) mod guide_reference;
#[doc(hidden)]
pub use snapback_types::handler_wire;
#[doc(hidden)]
pub mod host_ops;
pub use snapback_types::host_ops_contract;
#[doc(hidden)]
pub use snapback_types::identity;
#[doc(hidden)]
pub use snapback_types::ids;
#[doc(hidden)]
pub mod instance_fork;
pub(crate) use snapback_kernel::instance_lock;
#[doc(hidden)]
pub mod jobs;
pub use snapback_sync::live_coalesce;
pub(crate) use snapback_services::outbound_policy;
pub(crate) mod watches;
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
pub mod manifest;
pub use snapback_kernel::membership_rules;
#[doc(hidden)]
pub use snapback_kernel::migration;
#[doc(hidden)]
pub use snapback_kernel::migration_presentation;
#[doc(hidden)]
pub mod network_profile;
pub(crate) use snapback_kernel::operation_detail;
#[doc(hidden)]
pub use snapback_kernel::operation_ledger;
#[doc(hidden)]
pub use snapback_activation::operational_readiness;
pub(crate) use snapback_types::owner_only_file;
// The proof/checkpoint implementation contains commit primitives and
// admission carriers. Keep the kernel module available to in-crate adapters
// without publishing it as a forgeable façade surface.
pub(crate) use snapback_kernel::proof_checkpoint;
#[doc(hidden)]
pub mod push {
    pub use snapback_services::push::{
        PushAudienceReferenceV1, PushDeferredGrantV1, PushRegistryInspectionV1,
    };
    pub use snapback_types::push::*;
    pub(crate) use snapback_engine::push::*;
}
pub use snapback_sync::realtime;
#[doc(hidden)]
pub use snapback_kernel::remediation;
pub(crate) mod remainder_adapter;
#[doc(hidden)]
pub use snapback_services::replication;
#[doc(hidden)]
pub use snapback_types::result_contract;
#[doc(hidden)]
pub use snapback_types::result_transform;
#[doc(hidden)]
pub use snapback_sync::rqs;
pub use snapback_types::rqs_contract;
#[doc(hidden)]
pub use snapback_engine::runtime;
#[doc(hidden)]
pub mod schema_export;
#[doc(hidden)]
pub use snapback_kernel::search;
pub(crate) use snapback_kernel::secure_file;
#[doc(hidden)]
pub use snapback_kernel::seed_identity;
#[doc(hidden)]
pub mod server;
#[doc(hidden)]
pub use snapback_types::service_profile;
pub(crate) use snapback_sync::snapshot_batch_cursor;
#[doc(hidden)]
pub use snapback_sync::snapshot_batch_cursor_v2;
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
pub mod store_state;
#[doc(hidden)]
pub use snapback_sync::stream_attempt;
#[doc(hidden)]
pub mod telemetry;
#[doc(hidden)]
pub use snapback_types::telemetry_contract;
#[doc(hidden)]
pub use snapback_services::telemetry_query;
#[doc(hidden)]
pub use snapback_kernel::vector;
pub(crate) use snapback_runtime::warm_vm;
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
