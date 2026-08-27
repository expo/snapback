//! Dependency-free workspace contract leaf.
//!
//! This crate owns Snapback's language-neutral schema, wire, identifier,
//! value, and generation contracts. It has no workspace dependencies.

#![allow(clippy::result_large_err)]

pub mod api_compat;
pub mod api_envelope;
pub mod app_data_result;
pub mod args_contract;
pub mod assets;
pub mod auth;
pub mod authoring_suggestion;
#[doc(hidden)]
pub mod bench_fixture;
pub mod commit_envelope;
pub mod completeness;
pub mod contract_exact;
pub mod contract_types;
pub mod diagnostic;
pub mod ephemeral;
pub mod error_tracking;
pub mod exec_guard;
pub mod guide_artifact;
pub mod handler_wire;
pub mod host_ops_contract;
pub mod identity;
pub mod ids;
pub mod instance_fork;
pub mod jobs;
pub mod live_wire;
pub mod local;
pub mod manifest;
pub mod network_profile;
pub mod owner_only_file;
pub mod push;
pub mod remediation;
pub mod result_contract;
pub mod result_transform;
pub mod rqs_contract;
pub mod runtime;
pub mod schema_export;
pub mod search;
pub mod service_profile;
pub mod storage;
pub mod stream_attempt;
pub mod telemetry_contract;
pub mod value_expr;
pub mod vector;
pub mod visibility_governance;
pub mod watches;
#[doc(hidden)]
pub mod wire_fixtures;
pub mod wire_version;
