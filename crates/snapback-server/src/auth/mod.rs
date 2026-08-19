//! Server-owned authentication composition.

pub use snapback_auth::auth::{
    admission, backup, deployment, effective_source, hosted_edge, invalidation, lifecycle, mailbox,
    provider, sender_proof, service_fence,
};
pub use snapback_kernel::auth::{
    crypto, keyring, lease, logical_transfer, mode, rehearsal, rescue, throttle,
};
pub use snapback_sync::auth::{coordinator, invocation, session_projection};
pub use snapback_types::auth::{descriptor, identity_core, service_authority_contract, wire};

pub mod handshake {
    pub use snapback_types::auth::handshake::*;

    pub fn lease_error(
        code: &'static str,
        message: impl Into<String>,
    ) -> crate::diagnostic::SnapbackError {
        snapback_types::auth::handshake::lease_error(code, message).into()
    }
}

#[cfg(test)]
mod admission_tests;
#[cfg(test)]
mod backup_confined_tests;
#[cfg(test)]
mod provider_tests;
#[cfg(test)]
mod sender_proof_tests;

pub mod recovery;
pub mod runtime;
