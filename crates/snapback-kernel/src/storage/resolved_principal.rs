//! Opaque principal proofs minted only by durable kernel resolvers.

use super::auth_agent_credentials::{
    coalesce_credential_use, live_credential_by_hash, require_agent_active_on,
    require_agent_clock_on,
};
use super::{DatabaseBinding, LocalDatabase};
use crate::auth::crypto::{AgentCredential, TokenHash};
use crate::contract_types::{PresentedSessionLookup, ResolvedSession, TokenDigest};
use crate::diagnostic::{SnapbackError, SnapbackResult};

/// A principal identity proved by a kernel read of this database's durable
/// authorization rows.
///
/// Every field and constructor is private to this resolver module. Callers can
/// obtain the public opaque value only from the durable methods below; later
/// commit operations must still revalidate the retained row identity and
/// generation inside their transaction.
///
/// @ref LLP 0285#51-defect-1--the-publicly-claimable-authority-root — durable
/// principal proof is a type property, while commit-time revalidation closes
/// revocation races.
pub struct ResolvedPrincipal {
    database_binding: DatabaseBinding,
    principal_id: String,
    credential: ResolvedPrincipalCredential,
    resolved_at_version: u64,
    class: ResolvedPrincipalClass,
}

pub(super) enum ResolvedPrincipalClass {
    User,
    ServicePrincipal,
    InternalService,
}

enum ResolvedPrincipalCredential {
    Session {
        row_id: String,
        generation: u64,
        authority_instance_id: String,
        digest: TokenDigest,
    },
    AgentCredential {
        row_id: String,
        generation: u64,
        digest: TokenDigest,
    },
}

impl ResolvedPrincipal {
    fn from_session(
        database_binding: DatabaseBinding,
        session: ResolvedSession,
        digest: TokenDigest,
        resolved_at_version: u64,
    ) -> Self {
        Self {
            database_binding,
            principal_id: session.user_id,
            credential: ResolvedPrincipalCredential::Session {
                row_id: session.session_id,
                generation: session.generation,
                authority_instance_id: session.authority_instance_id,
                digest,
            },
            resolved_at_version,
            class: ResolvedPrincipalClass::User,
        }
    }

    fn from_agent_credential(
        database_binding: DatabaseBinding,
        principal_id: String,
        credential_id: String,
        generation: u64,
        digest: TokenDigest,
        resolved_at_version: u64,
    ) -> Self {
        Self {
            database_binding,
            principal_id,
            credential: ResolvedPrincipalCredential::AgentCredential {
                row_id: credential_id,
                generation,
                digest,
            },
            resolved_at_version,
            // Ordinary agent credentials are externally issuable and must
            // never acquire System authority merely by resolving successfully.
            // No current durable resolver issues InternalService.
            class: ResolvedPrincipalClass::ServicePrincipal,
        }
    }

    pub(super) fn database_binding(&self) -> &DatabaseBinding {
        &self.database_binding
    }

    pub(super) fn principal_id(&self) -> &str {
        &self.principal_id
    }

    pub(super) fn resolved_at_version(&self) -> u64 {
        self.resolved_at_version
    }

    pub(super) fn class(&self) -> &ResolvedPrincipalClass {
        &self.class
    }

    pub(super) fn session_proof(&self) -> Option<(&str, u64, &str, &TokenDigest)> {
        match &self.credential {
            ResolvedPrincipalCredential::Session {
                row_id,
                generation,
                authority_instance_id,
                digest,
            } => Some((row_id, *generation, authority_instance_id, digest)),
            ResolvedPrincipalCredential::AgentCredential { .. } => None,
        }
    }

    pub(super) fn agent_credential_proof(&self) -> Option<(&str, u64, &TokenDigest)> {
        match &self.credential {
            ResolvedPrincipalCredential::Session { .. } => None,
            ResolvedPrincipalCredential::AgentCredential {
                row_id,
                generation,
                digest,
            } => Some((row_id, *generation, digest)),
        }
    }
}

fn invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PRINCIPAL_INVALID",
        "auth",
        "the durable principal proof is absent, expired, or revoked",
    )
}

impl LocalDatabase {
    /// Resolve a current human session from its cryptographic bearer digest.
    /// The session row, its liveness, and the storage version are read from one
    /// SQLite snapshot; callers cannot substitute the projected user or
    /// generation recorded in the returned opaque proof.
    pub fn resolve_principal_from_session(
        &self,
        digest: &TokenDigest,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedPrincipal> {
        if now_ms > crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP {
            return Err(invalid());
        }
        let binding = self.binding();
        self.with_auth_read(|connection| {
            super::with_pinned_read_snapshot(connection, |connection| {
                let token_hash = TokenHash::from_bytes(*digest.as_bytes());
                let PresentedSessionLookup::Current(record) =
                    super::auth_catalog_ops::lookup_presented_session(connection, &token_hash)?
                else {
                    return Err(invalid());
                };
                if !record.live_at(now_ms) {
                    return Err(invalid());
                }
                let resolved_at_version = super::current_version_on(connection)?;
                Ok(ResolvedPrincipal::from_session(
                    binding,
                    record.session,
                    *digest,
                    resolved_at_version,
                ))
            })
        })
    }

    /// Resolve a live agent credential into the kernel's opaque durable
    /// principal proof. Verification, active-principal checking, use
    /// coalescing, and the captured storage version share the committing auth
    /// transaction.
    pub fn resolve_principal_from_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedPrincipal> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = credential.token_hash();
        let digest = TokenDigest::from_token_hash(&hash);
        let binding = self.binding();
        self.with_auth_transaction(|transaction| {
            require_agent_clock_on(transaction, now_ms)?;
            let resolved =
                live_credential_by_hash(transaction, hash.as_bytes())?.ok_or_else(invalid)?;
            require_agent_active_on(transaction, &resolved.user_id)?;
            coalesce_credential_use(transaction, &resolved.credential_id, now_ms)?;
            let resolved_at_version = super::current_version_on(transaction)?;
            Ok(ResolvedPrincipal::from_agent_credential(
                binding,
                resolved.user_id,
                resolved.credential_id,
                resolved.generation,
                digest,
                resolved_at_version,
            ))
        })
    }
}
