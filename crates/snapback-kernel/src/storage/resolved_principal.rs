//! Opaque principal proofs minted only by durable kernel resolvers.

use super::auth_agent_credentials::{
    coalesce_credential_use, live_credential_by_hash, require_agent_active_on,
    require_agent_clock_on,
};
use super::{DatabaseBinding, LocalDatabase};
use crate::auth::crypto::{AgentCredential, TokenHash};
use crate::contract_types::{PresentedSessionLookup, ResolvedSession, TokenDigest};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, params};

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

/// Private, copy-free decision proof extracted only from a kernel-resolved
/// live human principal. The pending-effect command owns this snapshot and
/// revalidates every coordinate in its committing transaction.
#[derive(Clone)]
pub(super) struct ResolvedEffectApprover {
    pub(super) database_binding: DatabaseBinding,
    pub(super) principal_id: String,
    pub(super) session_id: String,
    pub(super) generation: u64,
    pub(super) authority_instance_id: String,
    pub(super) digest: TokenDigest,
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

    pub fn principal_id(&self) -> &str {
        &self.principal_id
    }

    pub fn matches_session(
        &self,
        principal_id: &str,
        session_id: &str,
        generation: u64,
        authority_instance_id: &str,
    ) -> bool {
        self.principal_id == principal_id
            && matches!(self.class, ResolvedPrincipalClass::User)
            && matches!(
                &self.credential,
                ResolvedPrincipalCredential::Session {
                    row_id,
                    generation: resolved_generation,
                    authority_instance_id: resolved_authority,
                    ..
                } if row_id == session_id
                    && *resolved_generation == generation
                    && resolved_authority == authority_instance_id
            )
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

    pub(super) fn effect_approver(&self) -> SnapbackResult<ResolvedEffectApprover> {
        let ResolvedPrincipalCredential::Session {
            row_id,
            generation,
            authority_instance_id,
            digest,
        } = &self.credential
        else {
            return Err(invalid());
        };
        if !matches!(self.class, ResolvedPrincipalClass::User) {
            return Err(invalid());
        }
        Ok(ResolvedEffectApprover {
            database_binding: self.database_binding.clone(),
            principal_id: self.principal_id.clone(),
            session_id: row_id.clone(),
            generation: *generation,
            authority_instance_id: authority_instance_id.clone(),
            digest: *digest,
        })
    }
}

pub(super) fn revalidate_effect_approver_on<'a>(
    transaction: &rusqlite::Transaction<'_>,
    approver: &'a ResolvedEffectApprover,
    database_binding: &DatabaseBinding,
    now_ms: u64,
) -> SnapbackResult<&'a str> {
    if !approver.database_binding.matches(database_binding) {
        return Err(invalid());
    }
    let active_human = transaction
        .query_row(
            "SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'human' AND deactivated_at_ms IS NULL",
            params![approver.principal_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !active_human {
        return Err(invalid());
    }
    let live_session = transaction
        .query_row(
            "SELECT 1 FROM _auth_sessions
             WHERE id = ?1 AND user_id = ?2 AND generation = ?3
               AND authority_instance_id = ?4 AND token_hash = ?5
               AND revoked_at_ms IS NULL
               AND ?6 < expires_at_ms AND ?6 < absolute_expires_at_ms",
            params![
                approver.session_id,
                approver.principal_id,
                approver.generation as i64,
                approver.authority_instance_id,
                approver.digest.as_bytes().as_slice(),
                now_ms as i64,
            ],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !live_session {
        return Err(invalid());
    }
    Ok(&approver.principal_id)
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
        &mut self,
        digest: &TokenDigest,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedPrincipal> {
        if now_ms > crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP {
            return Err(invalid());
        }
        // Persist the observation before the resolving transaction: expiry or
        // any other refusal must not roll the high-water back with that
        // transaction and make the same durable session live again.
        // @ref LLP 0059#durable-session-clock-floor — refused observations
        // advance the same monotone durable floor as successful resolutions.
        let observed_now_ms = self.advance_auth_session_clock_floor(now_ms)?;
        let binding = self.binding();
        self.with_auth_transaction(|transaction| {
            // @ref LLP 0059#durable-session-clock-floor — a caller may sample
            // below the durable high-water, but authorization evaluates at
            // the non-decreasing floor and can never revive expired state.
            let effective_now_ms = super::auth::advance_session_clock_floor_on(
                transaction,
                observed_now_ms,
            )?;
            let token_hash = TokenHash::from_bytes(*digest.as_bytes());
            let PresentedSessionLookup::Current(mut record) =
                super::auth_catalog_ops::lookup_presented_session(transaction, &token_hash)?
            else {
                return Err(invalid());
            };
            if !record.live_at(effective_now_ms)
                || effective_now_ms >= record.session.absolute_expires_at_ms
            {
                return Err(invalid());
            }
            let active_human = transaction
                .query_row(
                    "SELECT 1 FROM _auth_users
                     WHERE id = ?1 AND kind = 'human' AND deactivated_at_ms IS NULL",
                    params![record.session.user_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !active_human {
                return Err(invalid());
            }
            let use_row = super::auth_catalog_ops::authenticated_use_row(
                transaction,
                &record.session.session_id,
                record.session.generation,
            )?
            .ok_or_else(invalid)?;
            if !use_row.live_at(effective_now_ms) {
                return Err(invalid());
            }
            if effective_now_ms.saturating_sub(use_row.last_used_at_ms)
                >= crate::contract_types::AUTH_SESSION_USE_COALESCE_MS
            {
                let expires_at_ms = effective_now_ms
                    .checked_add(crate::contract_types::AUTH_SESSION_SLIDING_WINDOW_MS)
                    .unwrap_or(crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP)
                    .min(use_row.absolute_expires_at_ms);
                let extended = super::auth_catalog_ops::extend_authenticated_use_transaction(
                    transaction,
                    &record.session.session_id,
                    record.session.generation,
                    effective_now_ms,
                    expires_at_ms,
                    crate::contract_types::AUTH_SESSION_USE_COALESCE_MS,
                )?;
                if !extended {
                    return Err(invalid());
                }
                record.session.expires_at_ms = expires_at_ms;
            }
            let resolved_at_version = super::current_version_on(transaction)?;
            Ok(ResolvedPrincipal::from_session(
                binding,
                record.session,
                *digest,
                resolved_at_version,
            ))
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
