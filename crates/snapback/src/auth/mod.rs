//! Server-owned authentication primitives.

#[allow(dead_code)] // Server composition consumes the closed crate-private gate.
pub(crate) use snapback_auth::auth::admission;
#[cfg(test)]
mod admission_tests;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) use snapback_auth::auth::backup;
#[cfg(test)]
mod backup_confined_tests;
#[allow(dead_code)] // Published by the ENG-24603 server integration lane.
pub(crate) use snapback_sync::auth::coordinator;
pub mod crypto;
pub use snapback_auth::auth::deployment;
pub use snapback_auth::auth::effective_source;
pub use snapback_types::auth::descriptor;
pub mod handshake;
#[allow(dead_code)] // Composed by the hosted-edge adapter startup lane (LLP 0098).
pub use snapback_auth::auth::hosted_edge;
pub use snapback_auth::auth::invalidation;
#[allow(dead_code)] // Server composition consumes crate-private prepared authority.
pub(crate) use snapback_sync::auth::invocation;
pub(crate) use snapback_types::auth::identity_core;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) use snapback_auth::auth::lifecycle;
pub use snapback_auth::auth::mailbox;
pub use snapback_kernel::auth::keyring;
pub use snapback_kernel::auth::lease;
pub(crate) use snapback_kernel::auth::logical_transfer;
pub mod mode;
pub use snapback_auth::auth::provider;
#[cfg(test)]
mod provider_tests;
#[cfg(not(test))]
pub(crate) use snapback_server::auth::recovery;
#[cfg(test)]
#[path = "../../../snapback-server/src/auth/recovery.rs"]
pub(crate) mod recovery;
pub(crate) mod rehearsal;
#[allow(dead_code)] // Wired by the collision-recovery/operator composition lane.
pub(crate) use snapback_kernel::auth::rescue;
#[cfg(not(test))]
pub use snapback_server::auth::runtime;
#[cfg(test)]
#[path = "../../../snapback-server/src/auth/runtime.rs"]
pub mod runtime;
pub use snapback_auth::auth::sender_proof;
#[cfg(test)]
mod sender_proof_tests;
pub(crate) use snapback_auth::auth::service_fence;
pub(crate) use snapback_kernel::auth::throttle;
#[allow(dead_code)] // Published by the ENG-24603 coordinator integration lane.
pub(crate) use snapback_sync::auth::session_projection;
pub(crate) use snapback_types::auth::service_authority_contract;
pub use snapback_types::auth::wire;
