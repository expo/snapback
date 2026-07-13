//! Server-owned authentication primitives.

#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod backup;
pub mod crypto;
pub mod keyring;
#[allow(dead_code)] // Wired by the auth lifecycle/operator composition lane.
pub(crate) mod lifecycle;
pub mod mailbox;
pub mod wire;
