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
mod api_compat;
#[doc(hidden)]
pub mod api_envelope;
#[doc(hidden)]
pub mod app_data_result;
#[doc(hidden)]
pub mod args_contract;
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
pub mod branches;
#[doc(hidden)]
pub mod bundle;
#[doc(hidden)]
pub mod cli;
#[doc(hidden)]
pub mod commit_envelope;
#[doc(hidden)]
pub mod completeness;
#[doc(hidden)]
pub mod config;
pub mod conformance;
pub(crate) mod connected_clients;
pub(crate) mod contract_exact;
// @ref LLP 0225#1-ownership-map — owner 1: crate-private generation
// activation coordinator.
pub(crate) mod elevated_read_trace;
pub(crate) mod generation_activation;
#[doc(hidden)]
pub mod visibility_governance;
pub(crate) mod spike_trace;
// @ref LLP 0225#1-ownership-map — dependency-free shared contract/types
// leaf consumed downward by Rust owners and generated-artifact producers.
#[doc(hidden)]
pub mod contract_types;
#[doc(hidden)]
pub mod control_catalog;
#[doc(hidden)]
pub mod cron;
#[doc(hidden)]
pub mod data_patch;
#[doc(hidden)]
pub mod data_tier;
#[doc(hidden)]
pub mod deploy;
#[doc(hidden)]
pub mod dev_identity;
#[doc(hidden)]
pub mod diagnostic;
#[doc(hidden)]
pub mod ephemeral;
#[doc(hidden)]
pub mod error_tracking;
#[doc(hidden)]
pub mod errors_query;
#[doc(hidden)]
pub mod exec_guard;
#[doc(hidden)]
pub mod fork_promotion;
#[doc(hidden)]
pub mod guide;
pub(crate) mod guide_mcp;
pub(crate) mod guide_reference;
#[doc(hidden)]
pub mod handler_wire;
#[doc(hidden)]
pub mod host_ops;
pub mod host_ops_contract;
#[doc(hidden)]
pub mod identity;
#[doc(hidden)]
pub mod ids;
#[doc(hidden)]
pub mod instance_fork;
pub(crate) mod instance_lock;
#[doc(hidden)]
pub mod jobs;
pub mod live_coalesce;
pub(crate) mod outbound_policy;
pub(crate) mod watches;
pub(crate) mod webhooks;

pub(crate) mod live_matcher;
#[doc(hidden)]
pub mod live_wire;
#[doc(hidden)]
pub mod local;
#[doc(hidden)]
pub mod manifest;
pub(crate) mod membership_rules;
#[doc(hidden)]
pub mod migration;
#[doc(hidden)]
pub mod migration_presentation;
#[doc(hidden)]
pub mod network_profile;
pub(crate) mod operation_detail;
#[doc(hidden)]
pub mod operation_ledger;
#[doc(hidden)]
pub mod operational_readiness;
pub(crate) mod owner_only_file;
#[doc(hidden)]
pub mod proof_checkpoint;
#[doc(hidden)]
pub mod push;
pub mod realtime;
#[doc(hidden)]
pub mod remediation;
#[doc(hidden)]
pub mod replication;
#[doc(hidden)]
pub mod result_contract;
#[doc(hidden)]
pub mod result_transform;
#[doc(hidden)]
pub mod rqs;
pub mod rqs_contract;
#[doc(hidden)]
pub mod runtime;
#[doc(hidden)]
pub mod schema_export;
#[doc(hidden)]
pub mod search;
pub(crate) mod secure_file;
#[doc(hidden)]
pub mod seed_identity;
#[doc(hidden)]
pub mod server;
#[doc(hidden)]
pub mod service_profile;
pub(crate) mod snapshot_batch_cursor;
#[doc(hidden)]
pub mod snapshot_batch_cursor_v2;
#[doc(hidden)]
pub mod storage;
#[doc(hidden)]
pub mod store_state;
#[doc(hidden)]
pub mod stream_attempt;
#[doc(hidden)]
pub mod telemetry;
#[doc(hidden)]
pub mod telemetry_contract;
#[doc(hidden)]
pub mod telemetry_query;
#[doc(hidden)]
pub mod value_expr;
#[doc(hidden)]
pub mod vector;
pub(crate) mod warm_vm;
#[doc(hidden)]
pub mod wire_fixtures;
#[doc(hidden)]
pub mod wire_version;
#[doc(hidden)]
pub mod workerd_exec;
