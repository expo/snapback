//! Server-owned authentication primitives.

pub mod admission;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod backup;
pub mod crypto;
pub mod handshake;
pub mod invocation;
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
pub mod wire;
