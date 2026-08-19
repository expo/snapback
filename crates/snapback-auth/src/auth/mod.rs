//! Authentication policy over the durable kernel substrate.

pub mod admission;
pub mod admin_token;
pub mod backup;
pub mod database_plan;
pub mod deployment;
pub mod effective_source;
pub mod hosted_edge;
pub mod invalidation;
pub mod lifecycle;
pub mod lock_rank;
pub mod mailbox;
pub mod provider;
pub mod provision;
pub mod sender_proof;
pub mod service_fence;

pub mod session_projection {
    pub use super::lock_rank::{
        AUTH_LOCK_RANK_CONNECTION_REGISTRY, AUTH_LOCK_RANK_MODE_ADMISSION, AuthLockRankGuard,
    };
    pub use snapback_kernel::auth::session_projection::*;
    pub use snapback_types::auth::session_projection::*;
    pub use snapback_types::contract_types::TerminalAuthorityDisposition;
}

pub use snapback_kernel::auth::{
    keyring, lease, logical_transfer, rescue, throttle,
};
pub use snapback_types::auth::{
    crypto, descriptor, handshake, identity_core, mode, rehearsal,
    service_authority_contract, wire,
};
