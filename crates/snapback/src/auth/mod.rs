//! Server-owned authentication primitives.

#[allow(dead_code)] // Server composition consumes the closed crate-private gate.
pub(crate) use snapback_auth::auth::admission;
#[cfg(test)]
mod admission_tests;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) use snapback_auth::auth::backup;
#[cfg(test)]
mod backup_confined_tests;
#[cfg(not(test))]
#[allow(dead_code)] // Published by the ENG-24603 server integration lane.
pub(crate) use snapback_sync::auth::coordinator;
#[cfg(test)]
#[path = "../../../snapback-sync/src/auth/coordinator.rs"]
pub(crate) mod coordinator;
pub mod crypto;
pub use snapback_auth::auth::deployment;
pub use snapback_types::auth::descriptor;
pub use snapback_auth::auth::effective_source;
pub mod handshake;
#[allow(dead_code)] // Composed by the hosted-edge adapter startup lane (LLP 0098).
pub use snapback_auth::auth::hosted_edge;
pub(crate) use snapback_types::auth::identity_core;
pub use snapback_auth::auth::invalidation;
#[cfg(not(test))]
#[allow(dead_code)] // Server composition consumes crate-private prepared authority.
pub(crate) use snapback_sync::auth::invocation;
// Remainder-owned tests keep the original crate-private invocation/coordinator
// relationship.  The production crate uses the extracted sync modules above;
// raw inclusion here avoids publishing authority-minting test shims merely to
// let the higher-layer acceptance suite exercise its old private hooks.
#[cfg(test)]
#[path = "../../../snapback-sync/src/auth/invocation.rs"]
pub(crate) mod invocation;
pub use snapback_kernel::auth::keyring;
pub use snapback_kernel::auth::lease;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) use snapback_auth::auth::lifecycle;
pub(crate) use snapback_kernel::auth::logical_transfer;
pub use snapback_auth::auth::mailbox;
pub mod mode;
pub use snapback_auth::auth::provider;
#[cfg(test)]
mod provider_tests;
pub(crate) mod recovery;
pub(crate) mod rehearsal;
#[allow(dead_code)] // Wired by the collision-recovery/operator composition lane.
pub(crate) use snapback_kernel::auth::rescue;
pub mod runtime;
pub use snapback_auth::auth::sender_proof;
#[cfg(test)]
mod sender_proof_tests;
pub(crate) use snapback_types::auth::service_authority_contract;
pub(crate) use snapback_auth::auth::service_fence;
#[allow(dead_code)] // Published by the ENG-24603 coordinator integration lane.
pub(crate) use snapback_sync::auth::session_projection;
pub(crate) use snapback_kernel::auth::throttle;
pub use snapback_types::auth::wire;
