//! Function-generation composition and atomic successor activation.
//!
//! The storage kernel retains transaction authority. This crate owns the
//! ordering that composes kernel commits with process-local publication.

#![allow(clippy::result_large_err)]

pub use snapback_auth::auth;
pub(crate) use snapback_kernel::storage;
pub use snapback_kernel::{diagnostic, identity, secure_file, seed_identity};
pub use snapback_types::{
    contract_types, error_tracking, host_ops_contract, live_wire, manifest, rqs_contract,
};

pub mod telemetry {
    pub use snapback_types::telemetry_contract::TelemetryConfig;
}

pub mod agent_safe_publication;
pub mod bundle;
pub mod completeness;
pub mod config;
pub mod deploy;
pub mod generation_activation;
pub mod operational_readiness;
pub mod schema_export;
