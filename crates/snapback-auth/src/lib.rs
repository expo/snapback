//! Snapback authentication policy and published substrate surfaces.
//!
//! Durable auth operations remain in `snapback-kernel`; this crate owns the
//! provider, credential, lease, custody, revocation-publication, sender-proof,
//! identity, lifecycle, and hosted-edge policy that composes those operations.

#![allow(clippy::result_large_err)]

pub(crate) use snapback_kernel::storage;
pub use snapback_kernel::{conformance, diagnostic, instance_lock, manifest, secure_file};
pub use snapback_types::{contract_types, exec_guard, ids, owner_only_file, remediation};

pub mod auth;
pub mod dev_identity;
pub mod schema_export;

pub mod deploy {
    pub use snapback_types::auth::deployment::{HostedAdmissionV2, HostedAdmissionV2Version};
}
