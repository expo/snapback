//! Snapback's canonical-store storage and migration kernel.
//!
//! This crate owns SQLite transactions, schema lineage, migration execution,
//! rollback artifacts, durability, and storage-level search/vector machinery.
//! It may depend on the contract leaf and never on a higher workspace crate.

#![allow(clippy::result_large_err)]

pub use snapback_types::{
    api_envelope, app_data_result, args_contract,
    commit_envelope, completeness, contract_exact, contract_types,
    error_tracking, exec_guard, handler_wire, host_ops_contract, identity, ids,
    live_wire, local, manifest, network_profile, owner_only_file,
    result_contract, result_transform, rqs_contract, runtime, service_profile, stream_attempt,
    telemetry_contract, value_expr, visibility_governance, wire_version,
};

pub mod authoring_suggestion;
pub mod auth;
pub mod assets;
pub mod assets_cut;
pub mod assets_store;
pub mod branches;
pub mod conformance;
pub mod data_patch;
pub mod data_tier;
pub mod diagnostic;
pub mod ephemeral;
pub mod fork_promotion;
pub mod instance_lock;
pub mod instance_fork;
pub mod jobs {
    pub use crate::storage::jobs::*;
    pub use snapback_types::jobs::*;
}
pub mod live_matcher;
pub mod migration;
pub mod migration_presentation;
pub mod membership_rules;
pub mod operation_detail;
pub mod operation_ledger;
pub mod proof_checkpoint;
pub mod push;
pub mod remediation;
pub mod replication;
pub mod rqs;
pub mod search;
pub mod secure_file;
pub mod seed_identity;
#[doc(hidden)]
pub mod services_assets;
pub mod storage;
pub mod vector;
pub mod watches;
