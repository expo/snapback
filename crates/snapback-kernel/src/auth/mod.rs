//! Durable authentication substrate owned by the storage kernel.

pub use snapback_types::auth::*;

pub mod crypto;
pub mod deployment;
pub mod hosted_edge;
pub mod keyring;
pub mod lease;
pub mod logical_transfer;
pub mod mode;
pub mod rehearsal;
pub mod rescue;
pub mod sender_proof;
pub mod service_fence;
pub mod session_projection;
pub mod throttle;
