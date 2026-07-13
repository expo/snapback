//! Server-owned authentication primitives.

#[allow(dead_code)] // Server composition consumes the closed crate-private gate.
pub(crate) mod admission;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod backup;
pub mod crypto;
pub mod handshake;
#[allow(dead_code)] // Server composition consumes crate-private prepared authority.
pub(crate) mod invocation;
pub mod keyring;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod lifecycle;
pub mod mailbox;
pub mod mode;
pub mod provider;
pub(crate) mod recovery;
#[allow(dead_code)] // Wired by the collision-recovery/operator composition lane.
pub(crate) mod rescue;
pub mod runtime;
#[allow(dead_code)] // Published by the ENG-24603 coordinator integration lane.
pub(crate) mod session_projection;
pub mod wire;
