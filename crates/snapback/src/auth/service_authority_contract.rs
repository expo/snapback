//! Shared finite service-authority value shapes.
//!
//! The storage kernel constructs and consumes these carriers, while the sync
//! engine retains the behavior that coordinates their process-local fences.
//!
//! @ref LLP 0225#1-ownership-map — kernel-consumed value shapes are leaf-owned;
//!   the sync engine keeps the behavior that acts on them.

use std::time::Instant;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ServiceAuthorityDisposition {
    Carrier,
    DurableDelete,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ServiceAuthorityWitness {
    pub(crate) token_id: String,
    pub(crate) grant_id: String,
    pub(crate) actor_user_id: String,
    pub(crate) effective_user_id: Option<String>,
    pub(crate) credential_id: String,
    pub(crate) credential_generation: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) grant_expires_at_ms: Option<u64>,
}

impl ServiceAuthorityWitness {
    pub(crate) fn token_id(&self) -> &str {
        &self.token_id
    }

    pub(crate) fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub(crate) fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub(crate) fn actor_user_id(&self) -> &str {
        &self.actor_user_id
    }

    pub(crate) fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id.as_deref()
    }

    pub(crate) fn credential_id(&self) -> &str {
        &self.credential_id
    }

    pub(crate) fn credential_generation(&self) -> u64 {
        self.credential_generation
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ServiceAuthorityActResolution {
    Current(ServiceAuthorityWitness),
    Terminal(ServiceAuthorityDisposition),
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ServiceAuthorityDeadlineTerminal {
    pub(crate) token_id: String,
    pub(crate) grant_id: String,
    pub(crate) deadline_ms: u64,
    pub(crate) disposition: ServiceAuthorityDisposition,
    /// Hard socket-close deadline selected when expiry is first observed.
    /// Monotonic expiry spends the grace budget from the projected deadline;
    /// a forward wall-clock jump starts that budget at its observation cut.
    pub(crate) close_by: Instant,
}
