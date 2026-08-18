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
pub(crate) mod agent_safe_publication;
#[doc(hidden)]
pub use snapback_types::api_envelope;
#[doc(hidden)]
pub use snapback_types::app_data_result;
#[doc(hidden)]
pub use snapback_types::args_contract;
pub(crate) mod ask;
#[doc(hidden)]
pub mod assets;
#[doc(hidden)]
pub mod assets_cut;
#[doc(hidden)]
pub mod assets_image;
#[doc(hidden)]
pub mod assets_s3;
#[doc(hidden)]
pub mod assets_store;
#[doc(hidden)]
pub mod assets_video;
#[doc(hidden)]
pub mod auth;
pub(crate) mod authoring_suggestion;
#[doc(hidden)]
pub mod bench;
#[doc(hidden)]
pub mod bench_fixture;
pub(crate) mod bounded_children_cursor;
#[doc(hidden)]
pub use snapback_kernel::branches;
#[doc(hidden)]
pub mod bundle;
#[doc(hidden)]
pub mod cli;
#[doc(hidden)]
pub use snapback_types::commit_envelope;
#[doc(hidden)]
pub mod completeness;
#[doc(hidden)]
pub mod config;
pub use snapback_kernel::conformance;
pub(crate) mod connected_clients;
pub(crate) mod contract_exact;
// @ref LLP 0225#1-ownership-map — owner 1: crate-private generation
// activation coordinator.
pub(crate) mod elevated_read_trace;
pub(crate) mod generation_activation;
#[doc(hidden)]
pub use snapback_types::visibility_governance;
pub(crate) mod spike_trace;
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
pub mod deploy;
#[doc(hidden)]
pub use snapback_auth::dev_identity;
#[doc(hidden)]
pub mod diagnostic;
#[doc(hidden)]
pub mod ephemeral;
#[doc(hidden)]
pub mod error_tracking;
#[doc(hidden)]
pub mod errors_query;
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
pub mod live_coalesce;
pub(crate) mod outbound_policy;
pub(crate) mod watches;
pub(crate) mod webhooks;

pub use snapback_kernel::live_matcher;
#[doc(hidden)]
pub use snapback_types::live_wire;
#[doc(hidden)]
pub mod local;
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
pub mod operational_readiness;
pub(crate) use snapback_types::owner_only_file;
// The proof/checkpoint implementation contains commit primitives and
// admission carriers. Keep the kernel module available to in-crate adapters
// without publishing it as a forgeable façade surface.
pub(crate) use snapback_kernel::proof_checkpoint;
#[doc(hidden)]
pub mod push;
pub mod realtime;
#[doc(hidden)]
pub mod remediation;
#[doc(hidden)]
pub mod replication;
#[doc(hidden)]
pub use snapback_types::result_contract;
#[doc(hidden)]
pub use snapback_types::result_transform;
#[doc(hidden)]
pub mod rqs;
pub use snapback_types::rqs_contract;
#[doc(hidden)]
pub mod runtime;
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
pub(crate) mod snapshot_batch_cursor;
#[doc(hidden)]
pub mod snapshot_batch_cursor_v2;
#[doc(hidden)]
pub use snapback_kernel::storage;
#[doc(hidden)]
pub mod store_state;
#[doc(hidden)]
pub mod stream_attempt;
#[doc(hidden)]
pub mod telemetry;
#[doc(hidden)]
pub use snapback_types::telemetry_contract;
#[doc(hidden)]
pub mod telemetry_query;
#[doc(hidden)]
pub use snapback_kernel::vector;
#[doc(hidden)]
pub use snapback_types::value_expr;
pub(crate) mod warm_vm;
#[doc(hidden)]
pub mod wire_fixtures;
#[doc(hidden)]
pub use snapback_types::wire_version;
#[doc(hidden)]
pub mod workerd_exec;
