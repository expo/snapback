//! Snapback background and application services.
//!
//! This crate owns assets and media preparation, durable work policy, cron,
//! push, webhooks, outbound policy, forks, replication, telemetry, and error
//! tracking. Canonical-store commits remain typed operations in
//! `snapback-kernel`; telemetry retains its separately governed sidecar store.

#![allow(clippy::result_large_err)]

pub(crate) use snapback_auth::auth;
pub(crate) use snapback_kernel::services_assets as asset_proof;
pub(crate) use snapback_kernel::{
    diagnostic, operation_detail, operation_ledger, secure_file, seed_identity, storage,
};
pub(crate) use snapback_types::{
    contract_types, identity, ids, local, rqs_contract, telemetry_contract,
};

pub mod assets;
pub mod assets_cut;
pub mod assets_image;
pub mod assets_s3;
pub mod assets_store;
pub mod assets_video;
pub mod cron;
pub mod error_tracking;
pub mod errors_query;
#[cfg(feature = "benchmark-support")]
#[doc(hidden)]
pub mod fork_promotion_bench;
pub mod instance_fork;
pub mod jobs;
pub mod manifest;
pub mod outbound_policy;
pub mod push;
pub mod replication;
pub mod telemetry;
pub mod telemetry_query;
pub mod webhooks;

/// Confined dependencies needed by higher-rank workspace tests.
#[cfg(feature = "remainder-tests")]
pub mod test_support {
    pub use rusqlite;
}

pub(crate) use snapback_kernel::{search, vector};
