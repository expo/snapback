//! Server-owned authentication primitives.

#[allow(dead_code)] // Server composition consumes the closed crate-private gate.
pub(crate) mod admission;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod backup;
#[allow(dead_code)] // Published by the ENG-24603 server integration lane.
pub(crate) mod coordinator;
pub mod crypto;
pub mod deployment;
pub use snapback_types::auth::descriptor;
pub mod effective_source;
pub mod handshake;
#[allow(dead_code)] // Composed by the hosted-edge adapter startup lane (LLP 0098).
pub mod hosted_edge;
pub(crate) use snapback_types::auth::identity_core;
pub mod invalidation;
#[allow(dead_code)] // Server composition consumes crate-private prepared authority.
pub(crate) mod invocation;
pub use snapback_kernel::auth::keyring;
pub use snapback_kernel::auth::lease;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod lifecycle;
pub(crate) use snapback_kernel::auth::logical_transfer;
pub mod mailbox;
pub mod mode;
pub mod provider;
pub(crate) mod recovery;
pub(crate) mod rehearsal;
#[allow(dead_code)] // Wired by the collision-recovery/operator composition lane.
pub(crate) use snapback_kernel::auth::rescue;
pub mod runtime;
pub mod sender_proof;
pub(crate) use snapback_types::auth::service_authority_contract;
pub(crate) mod service_fence;
#[allow(dead_code)] // Published by the ENG-24603 coordinator integration lane.
pub(crate) mod session_projection;
pub(crate) use snapback_kernel::auth::throttle;
pub use snapback_types::auth::wire;
