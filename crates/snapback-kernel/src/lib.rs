//! Snapback's canonical-store storage and migration kernel.
//!
//! This crate owns SQLite transactions, schema lineage, migration execution,
//! rollback artifacts, durability, and storage-level search/vector machinery.
//! It may depend on the contract leaf and never on a higher workspace crate.

#![allow(clippy::result_large_err)]

pub use snapback_types::{
    api_envelope, app_data_result, args_contract, commit_envelope, completeness, contract_exact,
    contract_types, error_tracking, exec_guard, handler_wire, host_ops_contract, ids, live_wire,
    local, manifest, network_profile, owner_only_file, result_contract, result_transform,
    rqs_contract, runtime, service_profile, stream_attempt, telemetry_contract, value_expr,
    visibility_governance, wire_version,
};

pub mod assets;
pub mod assets_cut;
pub mod assets_store;
pub mod auth;
pub mod authoring_suggestion;
pub mod branches;
pub mod conformance;
pub mod control_catalog;
pub mod data_patch;
pub mod data_tier;
pub mod diagnostic;
pub mod ephemeral;
pub mod fork_promotion;
pub mod fork_promotion_bench;
pub mod identity;
pub mod instance_fork;
pub mod instance_lock;
pub mod jobs {
    pub use crate::storage::jobs::*;
    pub use snapback_types::jobs::*;
}
pub mod live_matcher;
pub mod membership_rules;
pub mod migration;
pub mod migration_presentation;
pub mod operation_detail;
pub mod operation_ledger;
pub mod process_bound_identity;
pub mod proof_checkpoint;
pub mod push;
pub mod remediation;
pub mod replication;
pub mod rqs;
pub mod schema_export;
pub mod search;
pub mod secure_file;
pub mod seed_identity;
#[doc(hidden)]
pub mod services_assets;
pub mod storage;
pub mod vector;
pub mod watches;

#[cfg(test)]
extern crate snapback_build_identity as _;

#[cfg(test)]
// @ref LLP 0316#phase-2--test-currency — generated, gitignored demo fixtures
// stay runtime preconditions of the tests that consume them, not crate inputs.
pub(crate) fn read_generated_demo_fixture(
    source_directory: &str,
    relative_path: &str,
    demo_name: &str,
) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(source_directory)
        .join(relative_path);
    std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "failed to read generated demo fixture at {}: {error}\n\
             run from the repository root: node packages/snapback-codegen/index.mjs demos/{demo_name}/snapback\n\
             generated demo outputs are gitignored; this test reads them at run time so a missing fixture fails only this test instead of breaking the crate's compilation (LLP 0316 Phase 2)",
            path.display()
        )
    })
}
