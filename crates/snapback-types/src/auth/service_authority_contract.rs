//! Shared finite service-authority value shapes.
//!
//! The storage kernel constructs and consumes these carriers, while the sync
//! engine retains the behavior that coordinates their process-local fences.
//!
//! @ref LLP 0225#1-ownership-map — kernel-consumed value shapes are leaf-owned;
//!   the sync engine keeps the behavior that acts on them.

use std::time::Instant;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceAuthorityDisposition {
    Carrier,
    DurableDelete,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceAuthorityWitness {
    pub token_id: String,
    pub grant_id: String,
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub credential_id: String,
    pub credential_generation: u64,
    pub expires_at_ms: u64,
    pub grant_expires_at_ms: Option<u64>,
}

impl ServiceAuthorityWitness {
    pub fn token_id(&self) -> &str {
        &self.token_id
    }

    pub fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub fn grant_id(&self) -> &str {
        &self.grant_id
    }

    pub fn actor_user_id(&self) -> &str {
        &self.actor_user_id
    }

    pub fn effective_user_id(&self) -> Option<&str> {
        self.effective_user_id.as_deref()
    }

    pub fn credential_id(&self) -> &str {
        &self.credential_id
    }

    pub fn credential_generation(&self) -> u64 {
        self.credential_generation
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ServiceAuthorityActResolution {
    Current(ServiceAuthorityWitness),
    Terminal(ServiceAuthorityDisposition),
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceAuthorityDeadlineTerminal {
    pub token_id: String,
    pub grant_id: String,
    pub deadline_ms: u64,
    pub disposition: ServiceAuthorityDisposition,
    /// Hard socket-close deadline selected when expiry is first observed.
    /// Monotonic expiry spends the grace budget from the projected deadline;
    /// a forward wall-clock jump starts that budget at its observation cut.
    pub close_by: Instant,
}
