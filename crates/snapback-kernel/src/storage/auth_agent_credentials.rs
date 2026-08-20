//! LLP 0055 G3: agent credential families and scoped token lifecycle.
//!
//! Rotation keeps the live credential row's stable id and moves every prior
//! hash into a revoked row in the same protected table. Those family rows are
//! retained by time only, never by count, so a thief cannot rotate-to-evict an
//! owner's destroy-only `revoke-self` secret.
//!
//! @ref LLP 0055#credentials-and-tokens — one live credential, one-hour
//!   rotation throttle, thirty-day family retention, grant-bound tokens with a
//!   24-hour ceiling, and oldest-token eviction at the live cap.

use super::auth_grants::{ExactGrantScope, current_grant_scopes_on};
use super::auth_invalidation::{AUTH_CLOCK_META_KEY, strict_meta_u64, write_meta_u64};
use super::{LocalDatabase, MAX_AUTHORIZATION_EPOCH, new_id};
use crate::auth::crypto::{AgentCredential, RandomSource, ScopedToken};
use crate::auth::service_authority_contract::{
    ServiceAuthorityDeadlineTerminal, ServiceAuthorityDisposition, ServiceAuthorityWitness,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::auth::{
    AuthCatalogState, AuthTransactionAttempt, ServiceAuthTransactionAttempt,
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::Value;
use std::collections::BTreeSet;

pub const AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS: u64 = 60 * 60 * 1_000;
pub const AGENT_CREDENTIAL_FAMILY_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const SCOPED_TOKEN_DEFAULT_TTL_MS: u64 = 60 * 60 * 1_000;
pub const SCOPED_TOKEN_MAX_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
pub const SCOPED_TOKEN_LIVE_CAP: u64 = 10;
const LAST_USED_COALESCE_MS: u64 = 5 * 60 * 1_000;
const SECRET_COLLISION_RETRY_LIMIT: usize = 3;

#[derive(Debug)]
pub struct IssuedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub generation: u64,
    pub secret: AgentCredential,
}

#[derive(Debug)]
pub struct RotatedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub predecessor_generation: u64,
    pub generation: u64,
    pub invalidated_token_ids: Vec<String>,
    pub secret: AgentCredential,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedAgentCredential {
    pub credential_id: String,
    pub user_id: String,
    pub generation: u64,
}

#[derive(Debug)]
pub struct IssuedScopedToken {
    pub token_id: String,
    pub grant_id: String,
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub credential_id: String,
    pub credential_generation: u64,
    pub expires_at_ms: u64,
    pub grant_expires_at_ms: Option<u64>,
    pub scopes: Value,
    pub evicted_token_ids: Vec<String>,
    pub secret: ScopedToken,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReleasedScopedToken {
    pub token_id: String,
    pub newly_revoked: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedScopedToken {
    pub token_id: String,
    pub grant_id: String,
    pub actor_user_id: String,
    pub effective_user_id: Option<String>,
    pub credential_id: String,
    pub credential_generation: u64,
    pub scopes: Vec<ExactGrantScope>,
    pub expires_at_ms: u64,
    pub grant_expires_at_ms: Option<u64>,
    pub integration_status: Option<super::auth_integrations::IntegrationStatus>,
}

impl ResolvedScopedToken {
    /// Project this kernel-owned token into the leaf-owned fence witness.
    ///
    /// The kernel owns `ResolvedScopedToken`, so it owns the conversion into
    /// the shared shape; callers reach it by method, which keeps them from
    /// naming the leaf module just to build a witness.
    ///
    /// @ref LLP 0225#1-ownership-map — kernel→leaf is the allowed direction
    ///   for this projection; the sync engine keeps the fence behavior.
    pub fn service_authority_witness(&self) -> ServiceAuthorityWitness {
        ServiceAuthorityWitness {
            token_id: self.token_id.clone(),
            grant_id: self.grant_id.clone(),
            actor_user_id: self.actor_user_id.clone(),
            effective_user_id: self.effective_user_id.clone(),
            credential_id: self.credential_id.clone(),
            credential_generation: self.credential_generation,
            expires_at_ms: self.expires_at_ms,
            grant_expires_at_ms: self.grant_expires_at_ms,
        }
    }
}

pub struct RetainedServiceAuthority<'a> {
    pub actor_user_id: &'a str,
    pub credential_id: &'a str,
    pub credential_generation: u64,
    pub grant_id: &'a str,
    pub token_id: &'a str,
    pub effective_user_id: Option<&'a str>,
}

struct StoredScopedToken {
    token_id: String,
    grant_id: String,
    actor_user_id: String,
    effective_user_id: Option<String>,
    credential_id: String,
    credential_generation: i64,
    scopes_json: String,
    expires_at_ms: i64,
    grant_expires_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AgentFamilyRevocation {
    pub user_id: Option<String>,
    pub credential_ids: Vec<String>,
    pub token_ids: Vec<String>,
    pub grant_ids: Vec<String>,
}

impl LocalDatabase {
    /// Create the first live credential for an existing, active agent. The
    /// identity subject is the stable credential id; rotations update the
    /// secret and generation without changing it.
    pub fn issue_initial_agent_credential(
        &mut self,
        user_id: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let credential_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentCredential);
        let identity_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentIdentity);
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|tx| {
            body_outcome = Some(issue_initial_agent_credential_on(
                tx,
                user_id,
                now_ms,
                random,
                &credential_id,
                &identity_id,
            )?);
            Ok(())
        });
        let attempt =
            inject_agent_lifecycle_commit_uncertainty(attempt, "issue-credential", &credential_id);
        match attempt {
            AuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            AuthTransactionAttempt::RolledBack(error) => Err(error),
            AuthTransactionAttempt::CommitUncertain(_) => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                self.with_auth_read(|connection| {
                    reconcile_issued_agent_credential(connection, expected)
                })
                .map_err(|_| agent_lifecycle_commit_uncertain())?;
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
        }
    }

    /// Resolve only the current live generation. Rotated and revoked family
    /// secrets deliberately retain destroy-only attribution but authenticate
    /// nowhere else.
    pub fn resolve_agent_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = credential.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let resolved = live_credential_by_hash(tx, hash.as_bytes())?
                .ok_or_else(agent_credential_invalid)?;
            require_agent_active_on(tx, &resolved.user_id)?;
            coalesce_credential_use(tx, &resolved.credential_id, now_ms)?;
            Ok(resolved)
        })
    }

    /// Read the exact token family that credential rotation must close before
    /// its durable writer enters. The transaction repeats this plan and the
    /// process interlock compares it with the asynchronously drained gate.
    pub fn plan_agent_credential_rotation_service_terminal(
        &self,
        credential: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_agent_credential_rotation_token_ids(connection, credential, now_ms)
        })
    }

    /// Rotate with revocation strength. The predecessor hash becomes a
    /// time-retained revoked family row, every prior-generation token is
    /// terminally revoked, and the live row keeps its stable id.
    pub fn rotate_agent_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<RotatedAgentCredential> {
        self.observe_agent_authorization_clock(now_ms)?;
        let predecessor_hash = credential.token_hash();
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| planned_agent_credential_rotation_token_ids(tx, credential, now_ms),
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                sweep_credential_family_on(tx, now_ms)?;
                let row = credential_row_by_hash(tx, predecessor_hash.as_bytes())?
                    .filter(|row| row.revoked_at_ms.is_none())
                    .ok_or_else(agent_credential_invalid)?;
                require_agent_active_on(tx, &row.user_id)?;
                if now_ms
                    < row
                        .rotated_at_ms
                        .saturating_add(AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS)
                {
                    return Err(agent_credential_rotation_throttled());
                }
                let successor_generation = row
                    .generation
                    .checked_add(1)
                    .filter(|generation| *generation <= i64::MAX as u64)
                    .ok_or_else(agent_credential_state_corrupt)?;
                let successor = generate_unique_agent_credential_on(tx, random)?;
                let successor_hash = successor.token_hash();
                tx.execute(
                    "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        new_id(),
                        row.user_id,
                        predecessor_hash.as_bytes(),
                        row.generation as i64,
                        row.created_at_ms as i64,
                        row.rotated_at_ms as i64,
                        row.last_used_at_ms as i64,
                        now_ms as i64,
                    ],
                )?;
                let invalidated_token_ids = live_token_ids_for_credential(tx, &row.id)?;
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                 WHERE credential_id = ?2 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, row.id],
                )?;
                tx.execute(
                    "UPDATE _auth_agent_credentials
                 SET secret_hash = ?1, generation = ?2, rotated_at_ms = ?3,
                     last_used_at_ms = ?3
                 WHERE id = ?4 AND revoked_at_ms IS NULL",
                    params![
                        successor_hash.as_bytes(),
                        successor_generation as i64,
                        now_ms as i64,
                        row.id,
                    ],
                )?;
                body_outcome = Some(RotatedAgentCredential {
                    credential_id: row.id,
                    user_id: row.user_id,
                    predecessor_generation: row.generation,
                    generation: successor_generation,
                    invalidated_token_ids: invalidated_token_ids.clone(),
                    secret: successor,
                });
                Ok(())
            },
        );
        let operation_key = body_outcome
            .as_ref()
            .map_or("unresolved", |outcome| outcome.credential_id.as_str());
        let attempt = inject_agent_lifecycle_service_commit_uncertainty(
            attempt,
            "rotate-credential",
            operation_key,
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_rotated_agent_credential(
                        connection,
                        predecessor_hash.as_bytes(),
                        expected,
                    )
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(agent_lifecycle_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    rotated_agent_credential_is_predecessor(
                        connection,
                        predecessor_hash.as_bytes(),
                        expected,
                    )
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(agent_lifecycle_commit_uncertain())
            }
        }
    }

    pub fn plan_agent_credential_family_service_terminal(
        &self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_agent_credential_family_token_ids(connection, attributable, now_ms)
        })
    }

    /// Destroy the complete attributable credential family. Any family secret
    /// retained inside the thirty-day horizon reaches this path, including N-2
    /// and older generations; none can authenticate or mint authority.
    pub fn revoke_agent_credential_family(
        &mut self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = attributable.token_hash();
        let manifest = self.schema.clone();
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| planned_agent_credential_family_token_ids(tx, attributable, now_ms),
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                sweep_credential_family_on(tx, now_ms)?;
                let Some(row) = credential_row_by_hash(tx, hash.as_bytes())? else {
                    return Err(agent_credential_invalid());
                };
                let credential_ids = credential_ids_for_user(tx, &row.user_id)?;
                let token_ids = live_token_ids_for_user(tx, &row.user_id)?;
                let grant_ids = live_grant_ids_for_actor(tx, &row.user_id)?;
                tx.execute(
                    "UPDATE _auth_agent_credentials SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE user_id = ?2",
                    params![now_ms as i64, row.user_id],
                )?;
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE credential_id IN (
                   SELECT id FROM _auth_agent_credentials WHERE user_id = ?2
                 )",
                    params![now_ms as i64, row.user_id],
                )?;
                tx.execute(
                    "UPDATE _auth_grants SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE actor_user_id = ?2",
                    params![now_ms as i64, row.user_id],
                )?;
                // Revocation is allowed to end compromised authority, but it may
                // not silently make an unowned production holder permanently
                // unrecoverable. The app must seat a replacement (or use the
                // explicit emergency transfer/quarantine surface) first.
                // @ref LLP 0055#principal-kinds — durable recoverability is shared
                //   with LLP 0056's transaction-final lastHolder invariant.
                super::auth_agents::validate_protected_membership_final_state(
                    tx,
                    &manifest,
                    super::current_version_on(tx)?,
                )?;
                body_outcome = Some(AgentFamilyRevocation {
                    user_id: Some(row.user_id),
                    credential_ids,
                    token_ids: token_ids.clone(),
                    grant_ids,
                });
                Ok(())
            },
        );
        let operation_key = body_outcome
            .as_ref()
            .and_then(|outcome| outcome.user_id.as_deref())
            .unwrap_or("unresolved");
        let attempt = inject_agent_lifecycle_service_commit_uncertainty(
            attempt,
            "revoke-credential-family",
            operation_key,
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_agent_family_revocation(connection, expected)
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(agent_lifecycle_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    agent_family_revocation_is_predecessor(connection, expected)
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(agent_lifecycle_commit_uncertain())
            }
        }
    }

    pub fn plan_integration_credential_family_service_terminal(
        &self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            require_agent_clock_on(connection, now_ms)?;
            let hash = attributable.token_hash();
            let row = credential_row_by_hash(connection, hash.as_bytes())?
                .ok_or_else(agent_credential_invalid)?;
            super::auth_integrations::require_record_on(connection, &row.user_id)?;
            token_ids_for_user(connection, &row.user_id)
        })
    }

    /// Key-holder integration retirement. The integration record transition,
    /// credential-family destruction, token termination witnesses, all-actor
    /// grant revocation, and membership final-state validation share one
    /// serialized auth transaction.
    ///
    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — `integration.retire` is terminal, family-attributable, idempotent, and atomically revokes every installation.
    pub fn retire_integration_credential_family(
        &mut self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = attributable.token_hash();
        let manifest = self.schema.clone();
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let row = credential_row_by_hash(tx, hash.as_bytes())?
                    .ok_or_else(agent_credential_invalid)?;
                super::auth_integrations::require_record_on(tx, &row.user_id)?;
                token_ids_for_user(tx, &row.user_id)
            },
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                sweep_credential_family_on(tx, now_ms)?;
                let row = credential_row_by_hash(tx, hash.as_bytes())?
                    .ok_or_else(agent_credential_invalid)?;
                body_outcome = Some(retire_integration_principal_on(
                    tx,
                    &manifest,
                    &row.user_id,
                    now_ms,
                )?);
                Ok(())
            },
        );
        finish_integration_retirement_attempt(self, attempt, body_outcome)
    }

    pub fn plan_integration_principal_service_terminal(
        &self,
        principal_user_id: &str,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            super::auth_integrations::require_record_on(connection, principal_user_id)?;
            token_ids_for_user(connection, principal_user_id)
        })
    }

    /// Operator retirement reaches the same storage primitive without
    /// manufacturing a credential secret.
    pub fn retire_integration_principal(
        &mut self,
        principal_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let manifest = self.schema.clone();
        let principal_user_id = principal_user_id.to_owned();
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                super::auth_integrations::require_record_on(tx, &principal_user_id)?;
                token_ids_for_user(tx, &principal_user_id)
            },
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                sweep_credential_family_on(tx, now_ms)?;
                body_outcome = Some(retire_integration_principal_on(
                    tx,
                    &manifest,
                    &principal_user_id,
                    now_ms,
                )?);
                Ok(())
            },
        );
        finish_integration_retirement_attempt(self, attempt, body_outcome)
    }

    pub fn plan_scoped_token_service_terminal(
        &self,
        credential: &AgentCredential,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_scoped_token_terminal_token_ids(connection, credential, grant_id, now_ms)
        })
    }

    /// Resolve the exact carrier named by a release request, including an
    /// already-released carrier. Release is deliberately bearer-by-value and
    /// destroy-only: knowledge of one scoped token can end only that token,
    /// and a lost 204 can be retried idempotently with the same value.
    ///
    /// @ref LLP 0055#dated-amendment-app-cli-scoped-token-release-2026-08-01
    ///   — per-invocation CLI tokens leave the bounded family immediately.
    pub fn plan_scoped_token_release(&self, token: &ScopedToken) -> SnapbackResult<String> {
        let hash = token.token_hash();
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT id FROM _auth_grant_tokens WHERE token_hash = ?1",
                    params![hash.as_bytes()],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or_else(|| scoped_token_invalid(ScopedTokenAuthorityDisposition::Carrier))
        })
    }

    /// Idempotently revoke exactly the scoped token presented in the request.
    /// Durable grant/credential authority is untouched; this is a carrier
    /// ending and therefore projects the carrier terminal disposition.
    pub fn release_scoped_token(
        &mut self,
        token: &ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<ReleasedScopedToken> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = token.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let row: Option<(String, bool)> = tx
                .query_row(
                    "SELECT id, revoked_at_ms IS NOT NULL
                     FROM _auth_grant_tokens WHERE token_hash = ?1",
                    params![hash.as_bytes()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((token_id, already_revoked)) = row else {
                return Err(scoped_token_invalid(
                    ScopedTokenAuthorityDisposition::Carrier,
                ));
            };
            if !already_revoked {
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, token_id],
                )?;
            }
            Ok(ReleasedScopedToken {
                token_id,
                newly_revoked: !already_revoked,
            })
        })
    }

    pub fn oauth_revoke_scoped_token(
        &mut self,
        token: &ScopedToken,
        revoke_grant: bool,
        now_ms: u64,
    ) -> SnapbackResult<super::auth_grants::GrantRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = token.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let row = tx
                .query_row(
                    "SELECT t.id, t.grant_id, g.actor_user_id, g.effective_user_id
                     FROM _auth_grant_tokens AS t
                     JOIN _auth_grants AS g ON g.id = t.grant_id
                     WHERE t.token_hash = ?1",
                    params![hash.as_bytes()],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()?
                .ok_or_else(|| scoped_token_invalid(ScopedTokenAuthorityDisposition::Carrier))?;
            tx.execute(
                "UPDATE _auth_grant_tokens SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE id = ?2",
                params![now_ms as i64, row.0],
            )?;
            if !revoke_grant {
                return Ok(super::auth_grants::GrantRevocation {
                    grant_id: row.1,
                    token_ids: vec![row.0],
                });
            }
            if row.3.is_none()
                || super::auth_integrations::record_for_principal_on(tx, &row.2)?.is_none()
            {
                return Err(super::auth_integrations::oauth_grant_invalid());
            }
            let token_ids = live_token_ids_for_grant(tx, &row.1, now_ms)?;
            tx.execute(
                "UPDATE _auth_grant_tokens SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE grant_id = ?2",
                params![now_ms as i64, row.1],
            )?;
            tx.execute(
                "UPDATE _auth_grants SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                 WHERE id = ?2 AND actor_user_id = ?3 AND effective_user_id IS NOT NULL",
                params![now_ms as i64, row.1, row.2],
            )?;
            Ok(super::auth_grants::GrantRevocation {
                grant_id: row.1,
                token_ids,
            })
        })
    }

    /// Exchange one facade authorization code for the same short-lived,
    /// grant-bound scoped token ordinary agents use. Code consumption and
    /// token insertion share this transaction, so a retried code cannot mint
    /// a second carrier.
    ///
    /// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — OAuth is a compatibility facade over existing grant-bound authority.
    pub fn mint_scoped_token_for_oauth_code(
        &mut self,
        code: &str,
        client_id: &str,
        redirect_uri: &str,
        verifier: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        let expires_at_ms = now_ms
            .checked_add(super::auth_integrations::OAUTH_BEARER_TOKEN_TTL_MS)
            .filter(|expiry| *expiry <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(scoped_token_ttl_invalid)?;
        self.observe_agent_authorization_clock(now_ms)?;
        let secret = ScopedToken::generate(random).map_err(|_| secret_generation_failed())?;
        let token_hash = secret.token_hash();
        let token_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentToken);
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let authorization = super::auth_integrations::consume_oauth_authorization_code_on(
                tx,
                code,
                client_id,
                redirect_uri,
                verifier,
                now_ms,
            )?;
            require_agent_active_on(tx, &authorization.principal_user_id)?;
            super::auth_integrations::require_installation_grant_if_integration_on(
                tx,
                &authorization.principal_user_id,
                &authorization.grant_id,
            )?;
            let resolved = tx.query_row(
                "SELECT id, generation FROM _auth_agent_credentials
                 WHERE user_id = ?1 AND revoked_at_ms IS NULL",
                params![authorization.principal_user_id],
                |row| {
                    let generation = row.get::<_, i64>(1)?;
                    Ok((row.get::<_, String>(0)?, generation))
                },
            )?;
            if resolved.1 <= 0 {
                return Err(agent_credential_state_corrupt());
            }
            let grant = require_live_grant_for_actor(
                tx,
                &authorization.grant_id,
                &authorization.principal_user_id,
                now_ms,
            )?;
            let expires_at_ms = grant.expires_at_ms.map_or(expires_at_ms, |grant_expiry| {
                expires_at_ms.min(grant_expiry)
            });
            let mut live = live_token_ids_for_grant(tx, &authorization.grant_id, now_ms)?;
            let mut evicted_token_ids = Vec::new();
            while live.len() as u64 >= SCOPED_TOKEN_LIVE_CAP {
                let evicted = live.remove(0);
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, evicted],
                )?;
                evicted_token_ids.push(evicted);
            }
            tx.execute(
                "INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id,
                   credential_generation, created_at_ms, expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                params![
                    token_id,
                    token_hash.as_bytes(),
                    authorization.grant_id,
                    resolved.0,
                    resolved.1,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            coalesce_credential_use(tx, &resolved.0, now_ms)?;
            body_outcome = Some(IssuedScopedToken {
                token_id: token_id.clone(),
                grant_id: authorization.grant_id,
                actor_user_id: authorization.principal_user_id,
                effective_user_id: grant.effective_user_id,
                credential_id: resolved.0,
                credential_generation: resolved.1 as u64,
                expires_at_ms,
                grant_expires_at_ms: grant.expires_at_ms,
                scopes: grant.scopes,
                evicted_token_ids,
                secret,
            });
            Ok(())
        });
        match attempt {
            AuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            AuthTransactionAttempt::RolledBack(error) => Err(error),
            AuthTransactionAttempt::CommitUncertain(_) => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                self.with_auth_read(|connection| {
                    reconcile_issued_scoped_token(connection, expected)
                })
                .map_err(|_| agent_lifecycle_commit_uncertain())?;
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
        }
    }

    /// Mint one grant-bound scoped token under the current live credential
    /// generation. The eleventh live token atomically revokes the oldest and
    /// returns its id for connection invalidation projection.
    pub fn mint_scoped_token(
        &mut self,
        credential: &AgentCredential,
        grant_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        let ttl_ms = ttl_ms.unwrap_or(SCOPED_TOKEN_DEFAULT_TTL_MS);
        if ttl_ms == 0 || ttl_ms > SCOPED_TOKEN_MAX_TTL_MS {
            return Err(scoped_token_ttl_invalid());
        }
        let expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .filter(|expiry| *expiry <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(scoped_token_ttl_invalid)?;
        self.observe_agent_authorization_clock(now_ms)?;
        let secret = ScopedToken::generate(random).map_err(|_| secret_generation_failed())?;
        let token_hash = secret.token_hash();
        let token_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentToken);
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::Carrier,
            |tx| planned_scoped_token_terminal_token_ids(tx, credential, grant_id, now_ms),
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let resolved = live_credential_by_hash(tx, credential.token_hash().as_bytes())?
                    .ok_or_else(agent_credential_invalid)?;
                require_agent_active_on(tx, &resolved.user_id)?;
                super::auth_integrations::require_installation_grant_if_integration_on(
                    tx,
                    &resolved.user_id,
                    grant_id,
                )?;
                let grant = require_live_grant_for_actor(tx, grant_id, &resolved.user_id, now_ms)?;
                let expires_at_ms = grant.expires_at_ms.map_or(expires_at_ms, |grant_expiry| {
                    expires_at_ms.min(grant_expiry)
                });
                let mut live = live_token_ids_for_grant(tx, grant_id, now_ms)?;
                let mut evicted_token_ids = Vec::new();
                while live.len() as u64 >= SCOPED_TOKEN_LIVE_CAP {
                    let evicted = live.remove(0);
                    tx.execute(
                        "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                        params![now_ms as i64, evicted],
                    )?;
                    evicted_token_ids.push(evicted);
                }
                tx.execute(
                    "INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id,
                   credential_generation, created_at_ms, expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                    params![
                        token_id,
                        token_hash.as_bytes(),
                        grant_id,
                        resolved.credential_id,
                        resolved.generation as i64,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
                coalesce_credential_use(tx, &resolved.credential_id, now_ms)?;
                body_outcome = Some(IssuedScopedToken {
                    token_id: token_id.clone(),
                    grant_id: grant_id.to_owned(),
                    actor_user_id: resolved.user_id,
                    effective_user_id: grant.effective_user_id,
                    credential_id: resolved.credential_id,
                    credential_generation: resolved.generation,
                    expires_at_ms,
                    grant_expires_at_ms: grant.expires_at_ms,
                    scopes: grant.scopes,
                    evicted_token_ids: evicted_token_ids.clone(),
                    secret,
                });
                Ok(())
            },
        );
        let attempt = inject_agent_lifecycle_service_commit_uncertainty(
            attempt,
            "mint-scoped-token",
            grant_id,
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_issued_scoped_token(connection, expected)
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(agent_lifecycle_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    issued_scoped_token_is_predecessor(connection, expected)
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(agent_lifecycle_commit_uncertain())
            }
        }
    }

    pub fn plan_pairing_scoped_token_service_terminal(
        &self,
        credential: &AgentCredential,
        pairing_request_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_pairing_terminal_token_ids(connection, credential, pairing_request_id, now_ms)
        })
    }

    /// Poll an approved pairing request for its first grant token. Every
    /// successful re-poll revokes the prior pairing-poll token before minting
    /// its replacement in the same transaction, so a lost response is
    /// recoverable without retaining plaintext.
    pub fn mint_scoped_token_for_pairing_request(
        &mut self,
        credential: &AgentCredential,
        pairing_request_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        let ttl_ms = ttl_ms.unwrap_or(SCOPED_TOKEN_DEFAULT_TTL_MS);
        if ttl_ms == 0 || ttl_ms > SCOPED_TOKEN_MAX_TTL_MS {
            return Err(scoped_token_ttl_invalid());
        }
        let requested_expires_at_ms = now_ms
            .checked_add(ttl_ms)
            .filter(|expiry| *expiry <= MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(scoped_token_ttl_invalid)?;
        self.observe_agent_authorization_clock(now_ms)?;
        let secret = ScopedToken::generate(random).map_err(|_| secret_generation_failed())?;
        let token_hash = secret.token_hash();
        let token_id = format!("{pairing_request_id}:{}", new_id());
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::Carrier,
            |tx| planned_pairing_terminal_token_ids(tx, credential, pairing_request_id, now_ms),
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let resolved = live_credential_by_hash(tx, credential.token_hash().as_bytes())?
                    .ok_or_else(agent_credential_invalid)?;
                require_agent_active_on(tx, &resolved.user_id)?;
                let pairing = tx
                    .query_row(
                        "SELECT agent_user_id, state, expires_at_ms, grant_id
                     FROM _auth_pairing_requests WHERE id = ?1",
                        params![pairing_request_id],
                        |row| {
                            Ok((
                                row.get::<_, Option<String>>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, i64>(2)?,
                                row.get::<_, Option<String>>(3)?,
                            ))
                        },
                    )
                    .optional()?;
                let Some((bound_agent, state, pairing_expires_at_ms, grant_id)) = pairing else {
                    return Err(grant_invalid());
                };
                let pairing_expires_at_ms = u64::try_from(pairing_expires_at_ms)
                    .map_err(|_| agent_credential_state_corrupt())?;
                if bound_agent.as_deref() != Some(resolved.user_id.as_str())
                    || pairing_expires_at_ms <= now_ms
                {
                    return Err(grant_invalid());
                }
                if state == "pending" && grant_id.is_none() {
                    return Err(grant_pending());
                }
                if state != "approved" {
                    return Err(grant_invalid());
                }
                let grant_id = grant_id.ok_or_else(grant_invalid)?;
                super::auth_integrations::require_installation_grant_if_integration_on(
                    tx,
                    &resolved.user_id,
                    &grant_id,
                )?;
                let grant = require_live_grant_for_actor(tx, &grant_id, &resolved.user_id, now_ms)?;
                let expires_at_ms = grant
                    .expires_at_ms
                    .map_or(requested_expires_at_ms, |expiry| {
                        requested_expires_at_ms.min(expiry)
                    });

                let pairing_prefix = format!("{pairing_request_id}:%");
                let mut replaced_token_ids = collect_token_ids(
                    tx,
                    "SELECT id FROM _auth_grant_tokens
                 WHERE grant_id = ?1 AND id LIKE ?2 AND revoked_at_ms IS NULL
                 ORDER BY created_at_ms, id",
                    params![grant_id, pairing_prefix],
                )?;
                for replaced in &replaced_token_ids {
                    tx.execute(
                        "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                        params![now_ms as i64, replaced],
                    )?;
                }
                let mut live = live_token_ids_for_grant(tx, &grant_id, now_ms)?;
                while live.len() as u64 >= SCOPED_TOKEN_LIVE_CAP {
                    let evicted = live.remove(0);
                    tx.execute(
                        "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                     WHERE id = ?2 AND revoked_at_ms IS NULL",
                        params![now_ms as i64, evicted],
                    )?;
                    replaced_token_ids.push(evicted);
                }
                tx.execute(
                    "INSERT INTO _auth_grant_tokens(
                   id, token_hash, grant_id, credential_id,
                   credential_generation, created_at_ms, expires_at_ms, revoked_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)",
                    params![
                        token_id,
                        token_hash.as_bytes(),
                        grant_id,
                        resolved.credential_id,
                        resolved.generation as i64,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
                coalesce_credential_use(tx, &resolved.credential_id, now_ms)?;
                body_outcome = Some(IssuedScopedToken {
                    token_id: token_id.clone(),
                    grant_id,
                    actor_user_id: resolved.user_id,
                    effective_user_id: grant.effective_user_id,
                    credential_id: resolved.credential_id,
                    credential_generation: resolved.generation,
                    expires_at_ms,
                    grant_expires_at_ms: grant.expires_at_ms,
                    scopes: grant.scopes,
                    evicted_token_ids: replaced_token_ids.clone(),
                    secret,
                });
                Ok(())
            },
        );
        let attempt = inject_agent_lifecycle_service_commit_uncertainty(
            attempt,
            "mint-pairing-scoped-token",
            pairing_request_id,
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_lifecycle_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_lifecycle_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_issued_scoped_token(connection, expected)
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(agent_lifecycle_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    issued_scoped_token_is_predecessor(connection, expected)
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(agent_lifecycle_commit_uncertain())
            }
        }
    }

    /// Per-invocation scoped-token validation. TTL is only a theft-window
    /// bound: every call also proves the grant, credential generation, and
    /// principal remain live.
    pub fn resolve_scoped_token(
        &mut self,
        token: &ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedScopedToken> {
        self.observe_agent_authorization_clock(now_ms)?;
        let hash = token.token_hash();
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let row: Option<StoredScopedToken> = tx
                .query_row(
                    "SELECT t.id, g.id, g.actor_user_id, g.effective_user_id,
                            t.credential_id, t.credential_generation, g.scopes,
                            t.expires_at_ms, g.expires_at_ms
                     FROM _auth_grant_tokens AS t
                     JOIN _auth_grants AS g ON g.id = t.grant_id
                     JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
                     JOIN _auth_users AS u ON u.id = g.actor_user_id
                     WHERE t.token_hash = ?1
                       AND t.revoked_at_ms IS NULL AND t.expires_at_ms > ?2
                       AND g.revoked_at_ms IS NULL
                       AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?2)
                       AND c.revoked_at_ms IS NULL
                       AND c.generation = t.credential_generation
                       AND c.user_id = g.actor_user_id
                       AND u.kind = 'agent' AND u.deactivated_at_ms IS NULL",
                    params![hash.as_bytes(), now_ms as i64],
                    |row| {
                        Ok(StoredScopedToken {
                            token_id: row.get(0)?,
                            grant_id: row.get(1)?,
                            actor_user_id: row.get(2)?,
                            effective_user_id: row.get(3)?,
                            credential_id: row.get(4)?,
                            credential_generation: row.get(5)?,
                            scopes_json: row.get(6)?,
                            expires_at_ms: row.get(7)?,
                            grant_expires_at_ms: row.get(8)?,
                        })
                    },
                )
                .optional()?;
            let Some(StoredScopedToken {
                token_id,
                grant_id,
                actor_user_id,
                effective_user_id,
                credential_id,
                credential_generation,
                scopes_json,
                expires_at_ms,
                grant_expires_at_ms,
            }) = row
            else {
                let authority_disposition =
                    scoped_token_authority_disposition_on(tx, hash.as_bytes(), now_ms)?;
                return Err(scoped_token_invalid(authority_disposition));
            };
            let scopes = current_grant_scopes_on(tx, &scopes_json)?;
            let integration_status =
                super::auth_integrations::record_for_principal_on(tx, &actor_user_id)?
                    .map(|record| record.status);
            coalesce_credential_use(tx, &credential_id, now_ms)?;
            tx.execute(
                "UPDATE _auth_grants SET last_used_at_ms = ?1
                 WHERE id = ?2 AND last_used_at_ms <= ?3",
                params![
                    now_ms as i64,
                    grant_id,
                    now_ms.saturating_sub(LAST_USED_COALESCE_MS) as i64,
                ],
            )?;
            Ok(ResolvedScopedToken {
                token_id,
                grant_id,
                actor_user_id,
                effective_user_id,
                credential_id,
                credential_generation: credential_generation as u64,
                scopes,
                expires_at_ms: expires_at_ms as u64,
                grant_expires_at_ms: grant_expires_at_ms
                    .map(u64::try_from)
                    .transpose()
                    .map_err(|_| agent_credential_state_corrupt())?,
                integration_status,
            })
        })
    }

    /// Revalidate a retained live authority without retaining or recovering
    /// its bearer. Every durable and carrier coordinate must still name the
    /// same live rows; token churn elsewhere on the grant is irrelevant.
    pub fn retained_service_authority_is_live(
        &mut self,
        authority: RetainedServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.retained_service_authority_is_live_readonly(authority, now_ms)
    }

    /// Re-resolve a bearer-free pending-effect snapshot to the complete
    /// current grant scopes and deadlines. Exact ids and generation are
    /// predicates, so token rotation/revocation and grant changes fail closed.
    pub fn resolve_retained_service_authority(
        &mut self,
        authority: RetainedServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedScopedToken> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let generation = i64::try_from(authority.credential_generation)
                .map_err(|_| agent_credential_state_corrupt())?;
            let row = tx
                .query_row(
                    "SELECT t.id, g.id, g.actor_user_id, g.effective_user_id,
                        t.credential_id, t.credential_generation, g.scopes,
                        t.expires_at_ms, g.expires_at_ms
                 FROM _auth_grant_tokens AS t
                 JOIN _auth_grants AS g ON g.id = t.grant_id
                 JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
                 JOIN _auth_users AS u ON u.id = g.actor_user_id
                 WHERE t.id = ?1 AND t.grant_id = ?2 AND t.credential_id = ?3
                   AND t.credential_generation = ?4 AND g.actor_user_id = ?5
                   AND g.effective_user_id IS ?6
                   AND t.revoked_at_ms IS NULL AND t.expires_at_ms > ?7
                   AND g.revoked_at_ms IS NULL
                   AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?7)
                   AND c.revoked_at_ms IS NULL AND c.generation = ?4
                   AND c.user_id = ?5 AND u.kind = 'agent'
                   AND u.deactivated_at_ms IS NULL",
                    params![
                        authority.token_id,
                        authority.grant_id,
                        authority.credential_id,
                        generation,
                        authority.actor_user_id,
                        authority.effective_user_id,
                        now_ms as i64,
                    ],
                    |row| {
                        Ok(StoredScopedToken {
                            token_id: row.get(0)?,
                            grant_id: row.get(1)?,
                            actor_user_id: row.get(2)?,
                            effective_user_id: row.get(3)?,
                            credential_id: row.get(4)?,
                            credential_generation: row.get(5)?,
                            scopes_json: row.get(6)?,
                            expires_at_ms: row.get(7)?,
                            grant_expires_at_ms: row.get(8)?,
                        })
                    },
                )
                .optional()?;
            let Some(row) = row else {
                return Err(scoped_token_invalid(
                    ScopedTokenAuthorityDisposition::Carrier,
                ));
            };
            let scopes = current_grant_scopes_on(tx, &row.scopes_json)?;
            let integration_status =
                super::auth_integrations::record_for_principal_on(tx, &row.actor_user_id)?
                    .map(|record| record.status);
            Ok(ResolvedScopedToken {
                token_id: row.token_id,
                grant_id: row.grant_id,
                actor_user_id: row.actor_user_id,
                effective_user_id: row.effective_user_id,
                credential_id: row.credential_id,
                credential_generation: row.credential_generation as u64,
                scopes,
                expires_at_ms: row.expires_at_ms as u64,
                grant_expires_at_ms: row
                    .grant_expires_at_ms
                    .map(u64::try_from)
                    .transpose()
                    .map_err(|_| agent_credential_state_corrupt())?,
                integration_status,
            })
        })
    }

    /// Exact read-only twin for an invocation that already owns the app lock.
    /// The resolving auth path advanced the durable clock floor; this seam
    /// avoids a second write transaction immediately before an app effect.
    pub fn retained_service_authority_is_live_readonly(
        &self,
        authority: RetainedServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        let high_water = strict_meta_u64(&self.conn, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
        if now_ms < high_water || now_ms > MAX_AUTHORIZATION_EPOCH {
            return Err(auth_clock_rollback());
        }
        let credential_generation = i64::try_from(authority.credential_generation)
            .map_err(|_| agent_credential_state_corrupt())?;
        let now_ms = i64::try_from(now_ms).map_err(|_| auth_clock_rollback())?;
        Ok(self
            .conn
            .query_row(
                "SELECT 1
                 FROM _auth_grant_tokens AS t
                 JOIN _auth_grants AS g ON g.id = t.grant_id
                 JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
                 JOIN _auth_users AS u ON u.id = g.actor_user_id
                 WHERE t.id = ?1 AND t.grant_id = ?2
                   AND t.credential_id = ?3 AND t.credential_generation = ?4
                   AND g.actor_user_id = ?5 AND g.effective_user_id IS ?6
                   AND t.revoked_at_ms IS NULL AND t.expires_at_ms > ?7
                   AND g.revoked_at_ms IS NULL
                   AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?7)
                   AND c.revoked_at_ms IS NULL AND c.generation = ?4
                   AND c.user_id = ?5
                   AND u.kind = 'agent' AND u.deactivated_at_ms IS NULL",
                params![
                    authority.token_id,
                    authority.grant_id,
                    authority.credential_id,
                    credential_generation,
                    authority.actor_user_id,
                    authority.effective_user_id,
                    now_ms,
                ],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    pub fn plan_expired_service_authority_terminal(
        &self,
        deadline: &ServiceAuthorityDeadlineTerminal,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_expired_service_authority_token_ids(connection, deadline)
        })
    }

    /// Persist a monotonic-observed scoped-token/grant deadline before the
    /// process publishes that terminal result. This prevents a backward wall
    /// clock plus restart from reviving authority that this process already
    /// observed expire.
    pub fn terminalize_expired_service_authority(
        &mut self,
        deadline: &ServiceAuthorityDeadlineTerminal,
    ) -> SnapbackResult<()> {
        let disposition = deadline.disposition;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            disposition,
            |tx| planned_expired_service_authority_token_ids(tx, deadline),
            |tx| {
                match disposition {
                    ServiceAuthorityDisposition::Carrier => {
                        tx.execute(
                            "UPDATE _auth_grant_tokens
                         SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                         WHERE id = ?2 AND grant_id = ?3",
                            params![
                                deadline.deadline_ms as i64,
                                deadline.token_id,
                                deadline.grant_id,
                            ],
                        )?;
                    }
                    ServiceAuthorityDisposition::DurableDelete => {
                        tx.execute(
                            "UPDATE _auth_grant_tokens
                         SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                         WHERE grant_id = ?2",
                            params![deadline.deadline_ms as i64, deadline.grant_id],
                        )?;
                        tx.execute(
                            "UPDATE _auth_grants
                         SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
                         WHERE id = ?2",
                            params![deadline.deadline_ms as i64, deadline.grant_id],
                        )?;
                    }
                }
                Ok(())
            },
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => Ok(()),
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let successor = self.with_auth_read(|connection| match disposition {
                    ServiceAuthorityDisposition::Carrier => Ok(connection
                        .query_row(
                            "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens
                             WHERE id = ?1 AND grant_id = ?2",
                            params![deadline.token_id, deadline.grant_id],
                            |row| row.get::<_, bool>(0),
                        )
                        .optional()?
                        == Some(true)),
                    ServiceAuthorityDisposition::DurableDelete => Ok(connection
                        .query_row(
                            "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants WHERE id = ?1",
                            params![deadline.grant_id],
                            |row| row.get::<_, bool>(0),
                        )
                        .optional()?
                        == Some(true)),
                })?;
                if successor {
                    return self.reconcile_ambiguous_service_terminal(terminal, true);
                }
                let predecessor = self.with_auth_read(|connection| match disposition {
                    ServiceAuthorityDisposition::Carrier => Ok(connection
                        .query_row(
                            "SELECT revoked_at_ms IS NULL FROM _auth_grant_tokens
                             WHERE id = ?1 AND grant_id = ?2",
                            params![deadline.token_id, deadline.grant_id],
                            |row| row.get::<_, bool>(0),
                        )
                        .optional()?
                        == Some(true)),
                    ServiceAuthorityDisposition::DurableDelete => Ok(connection
                        .query_row(
                            "SELECT revoked_at_ms IS NULL FROM _auth_grants WHERE id = ?1",
                            params![deadline.grant_id],
                            |row| row.get::<_, bool>(0),
                        )
                        .optional()?
                        == Some(true)),
                })?;
                if predecessor {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                }
                Err(error)
            }
        }
    }

    pub(super) fn observe_agent_authorization_clock(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| advance_agent_clock_on(tx, now_ms))
    }
}

fn retire_integration_principal_on(
    tx: &Transaction<'_>,
    manifest: &crate::manifest::SchemaManifest,
    principal_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<AgentFamilyRevocation> {
    super::auth_integrations::mark_revoked_on(tx, principal_user_id, now_ms)?;
    let credential_ids = credential_ids_for_user(tx, principal_user_id)?;
    let token_ids = live_token_ids_for_user(tx, principal_user_id)?;
    let grant_ids = live_grant_ids_for_actor(tx, principal_user_id)?;
    tx.execute(
        "UPDATE _auth_agent_credentials SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
         WHERE user_id = ?2",
        params![now_ms as i64, principal_user_id],
    )?;
    tx.execute(
        "UPDATE _auth_grant_tokens SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
         WHERE credential_id IN (
           SELECT id FROM _auth_agent_credentials WHERE user_id = ?2
         )",
        params![now_ms as i64, principal_user_id],
    )?;
    tx.execute(
        "UPDATE _auth_grants SET revoked_at_ms = COALESCE(revoked_at_ms, ?1)
         WHERE actor_user_id = ?2",
        params![now_ms as i64, principal_user_id],
    )?;
    super::auth_agents::validate_protected_membership_final_state(
        tx,
        manifest,
        super::current_version_on(tx)?,
    )?;
    Ok(AgentFamilyRevocation {
        user_id: Some(principal_user_id.to_owned()),
        credential_ids,
        token_ids,
        grant_ids,
    })
}

fn finish_integration_retirement_attempt(
    database: &mut LocalDatabase,
    attempt: ServiceAuthTransactionAttempt<()>,
    outcome: Option<AgentFamilyRevocation>,
) -> SnapbackResult<AgentFamilyRevocation> {
    match attempt {
        ServiceAuthTransactionAttempt::Committed(()) => {
            outcome.ok_or_else(agent_lifecycle_commit_uncertain)
        }
        ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
        ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
            let expected = outcome
                .as_ref()
                .ok_or_else(agent_lifecycle_commit_uncertain)?;
            let successor = database.with_auth_read(|connection| {
                let Some(user_id) = expected.user_id.as_deref() else {
                    return Ok(false);
                };
                let record =
                    super::auth_integrations::record_for_principal_on(connection, user_id)?;
                let record_revoked = record.is_some_and(|record| {
                    record.status == super::auth_integrations::IntegrationStatus::Revoked
                });
                let live_credentials: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM _auth_agent_credentials
                     WHERE user_id = ?1 AND revoked_at_ms IS NULL)",
                    params![user_id],
                    |row| row.get(0),
                )?;
                let live_grants: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM _auth_grants
                     WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL)",
                    params![user_id],
                    |row| row.get(0),
                )?;
                Ok(record_revoked && !live_credentials && !live_grants)
            })?;
            if successor {
                database.reconcile_ambiguous_service_terminal(terminal, true)?;
                return outcome.ok_or_else(agent_lifecycle_commit_uncertain);
            }
            database.reconcile_ambiguous_service_terminal(terminal, false)?;
            Err(error)
        }
    }
}

/// Transactional primitive shared with registration so the principal, stable
/// identity, and first credential cannot commit independently.
///
/// @ref LLP 0055#registration — registration publishes exactly one live
/// credential and its `agent-credential` identity in the principal commit.
pub(super) fn issue_initial_agent_credential_on(
    tx: &Transaction<'_>,
    user_id: &str,
    now_ms: u64,
    random: &dyn RandomSource,
    credential_id: &str,
    identity_id: &str,
) -> SnapbackResult<IssuedAgentCredential> {
    require_agent_active_on(tx, user_id)?;
    require_agent_clock_on(tx, now_ms)?;
    let secret = generate_unique_agent_credential_on(tx, random)?;
    let hash = secret.token_hash();
    tx.execute(
        "INSERT INTO _auth_agent_credentials(
           id, user_id, secret_hash, generation, created_at_ms,
           rotated_at_ms, last_used_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, 1, ?4, ?4, ?4, NULL)",
        params![credential_id, user_id, hash.as_bytes(), now_ms as i64],
    )
    .map_err(map_live_credential_constraint)?;
    if matches!(
        super::auth::inspect_auth_catalog_on(tx)?,
        AuthCatalogState::ReadyV3 | AuthCatalogState::ReadyV4
    ) {
        // @ref LLP 0214#35-identity-link-relation — the carried LLP 0055
        // agent-credential link is an external identity in v3; the actual
        // credential material remains in `_auth_agent_credentials`.
        tx.execute(
            "INSERT INTO _auth_identities(
               id, user_id, kind, provider, issuer, subject, canonical_value,
               created_at_ms, verified_at_ms, disabled_at_ms
             ) VALUES(?1, ?2, 'external', 'agent-credential', NULL, ?3, NULL,
                      ?4, ?4, NULL)",
            params![identity_id, user_id, credential_id, now_ms as i64],
        )?;
    } else {
        tx.execute(
            "INSERT INTO _auth_identities(
               id, user_id, provider, subject, verified_at_ms
             ) VALUES(?1, ?2, 'agent-credential', ?3, ?4)",
            params![identity_id, user_id, credential_id, now_ms as i64],
        )?;
    }
    Ok(IssuedAgentCredential {
        credential_id: credential_id.to_owned(),
        user_id: user_id.to_owned(),
        generation: 1,
        secret,
    })
}

#[derive(Debug)]
struct CredentialRow {
    id: String,
    user_id: String,
    generation: u64,
    created_at_ms: u64,
    rotated_at_ms: u64,
    last_used_at_ms: u64,
    revoked_at_ms: Option<u64>,
}

pub(super) fn advance_agent_clock_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    if now_ms > MAX_AUTHORIZATION_EPOCH {
        return Err(auth_clock_rollback());
    }
    let high_water = strict_meta_u64(tx, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
    if now_ms < high_water {
        return Err(auth_clock_rollback());
    }
    write_meta_u64(tx, AUTH_CLOCK_META_KEY, now_ms)
}

pub(super) fn require_agent_clock_on(connection: &Connection, now_ms: u64) -> SnapbackResult<()> {
    let high_water = strict_meta_u64(connection, AUTH_CLOCK_META_KEY)?.unwrap_or(0);
    if now_ms < high_water || now_ms > MAX_AUTHORIZATION_EPOCH {
        return Err(auth_clock_rollback());
    }
    Ok(())
}

pub(super) fn require_agent_active_on(
    connection: &Connection,
    user_id: &str,
) -> SnapbackResult<()> {
    let active = connection
        .query_row(
            "SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'agent' AND deactivated_at_ms IS NULL",
            params![user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if active {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_DEACTIVATED",
            "auth",
            "the agent principal is absent or permanently deactivated",
        ))
    }
}

fn credential_row_by_hash(
    connection: &Connection,
    hash: &[u8],
) -> SnapbackResult<Option<CredentialRow>> {
    let mut statement = connection.prepare(
        "SELECT id, user_id, generation, created_at_ms, rotated_at_ms,
                last_used_at_ms, revoked_at_ms
         FROM _auth_agent_credentials WHERE secret_hash = ?1
         ORDER BY revoked_at_ms IS NULL DESC, id LIMIT 2",
    )?;
    let rows = statement.query_map(params![hash], |row| {
        Ok(CredentialRow {
            id: row.get(0)?,
            user_id: row.get(1)?,
            generation: row.get::<_, i64>(2)? as u64,
            created_at_ms: row.get::<_, i64>(3)? as u64,
            rotated_at_ms: row.get::<_, i64>(4)? as u64,
            last_used_at_ms: row.get::<_, i64>(5)? as u64,
            revoked_at_ms: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
        })
    })?;
    one_credential_row(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn live_credential_by_hash(
    connection: &Connection,
    hash: &[u8],
) -> SnapbackResult<Option<ResolvedAgentCredential>> {
    let mut statement = connection.prepare(
        "SELECT id, user_id, generation, revoked_at_ms FROM _auth_agent_credentials
         WHERE secret_hash = ?1
         ORDER BY id LIMIT 2",
    )?;
    let rows = statement.query_map(params![hash], |row| {
        Ok((
            ResolvedAgentCredential {
                credential_id: row.get(0)?,
                user_id: row.get(1)?,
                generation: row.get::<_, i64>(2)? as u64,
            },
            row.get::<_, Option<i64>>(3)?,
        ))
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    match rows.len() {
        0 => Ok(None),
        1 => {
            let (resolved, revoked_at_ms) = rows.into_iter().next().expect("one row");
            Ok(revoked_at_ms.is_none().then_some(resolved))
        }
        _ => Err(agent_credential_state_corrupt()),
    }
}

fn one_credential_row(rows: Vec<CredentialRow>) -> SnapbackResult<Option<CredentialRow>> {
    match rows.len() {
        0 => Ok(None),
        1 => Ok(rows.into_iter().next()),
        _ => Err(agent_credential_state_corrupt()),
    }
}

/// The auth transaction is an immediate, serialized writer lane. Checking all
/// retained family rows and inserting/updating before its commit therefore
/// provides the uniqueness invariant without changing the deployed catalog
/// shape.
fn generate_unique_agent_credential_on(
    tx: &Transaction<'_>,
    random: &dyn RandomSource,
) -> SnapbackResult<AgentCredential> {
    for _ in 0..SECRET_COLLISION_RETRY_LIMIT {
        let secret = AgentCredential::generate(random).map_err(|_| secret_generation_failed())?;
        let hash = secret.token_hash();
        let collision = tx
            .query_row(
                "SELECT 1 FROM _auth_agent_credentials WHERE secret_hash = ?1 LIMIT 1",
                params![hash.as_bytes()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !collision {
            return Ok(secret);
        }
    }
    Err(secret_generation_failed())
}

pub(super) fn coalesce_credential_use(
    tx: &Transaction<'_>,
    credential_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _auth_agent_credentials SET last_used_at_ms = ?1
         WHERE id = ?2 AND last_used_at_ms <= ?3",
        params![
            now_ms as i64,
            credential_id,
            now_ms.saturating_sub(LAST_USED_COALESCE_MS) as i64,
        ],
    )?;
    Ok(())
}

struct LiveGrant {
    scopes: Value,
    expires_at_ms: Option<u64>,
    effective_user_id: Option<String>,
}

fn require_live_grant_for_actor(
    connection: &Connection,
    grant_id: &str,
    actor_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<LiveGrant> {
    let grant = connection
        .query_row(
            "SELECT scopes, expires_at_ms, effective_user_id FROM _auth_grants
             WHERE id = ?1 AND actor_user_id = ?2 AND revoked_at_ms IS NULL
               AND (expires_at_ms IS NULL OR expires_at_ms > ?3)",
            params![grant_id, actor_user_id, now_ms as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let (scopes, expires_at_ms, effective_user_id) = grant.ok_or_else(grant_invalid)?;
    let scopes = serde_json::from_str(&scopes).map_err(|_| agent_credential_state_corrupt())?;
    let expires_at_ms = expires_at_ms
        .map(u64::try_from)
        .transpose()
        .map_err(|_| agent_credential_state_corrupt())?;
    Ok(LiveGrant {
        scopes,
        expires_at_ms,
        effective_user_id,
    })
}

fn live_token_ids_for_grant(
    connection: &Connection,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT id FROM _auth_grant_tokens
         WHERE grant_id = ?1 AND revoked_at_ms IS NULL AND expires_at_ms > ?2
         ORDER BY created_at_ms, id",
    )?;
    let rows = statement.query_map(params![grant_id, now_ms as i64], |row| {
        row.get::<_, String>(0)
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn planned_agent_credential_rotation_token_ids(
    connection: &Connection,
    credential: &AgentCredential,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let hash = credential.token_hash();
    let row = credential_row_by_hash(connection, hash.as_bytes())?
        .filter(|row| row.revoked_at_ms.is_none())
        .ok_or_else(agent_credential_invalid)?;
    require_agent_active_on(connection, &row.user_id)?;
    token_ids_for_credential(connection, &row.id)
}

fn planned_agent_credential_family_token_ids(
    connection: &Connection,
    attributable: &AgentCredential,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let hash = attributable.token_hash();
    let row = credential_row_by_hash(connection, hash.as_bytes())?
        .ok_or_else(agent_credential_invalid)?;
    token_ids_for_user(connection, &row.user_id)
}

fn planned_scoped_token_terminal_token_ids(
    connection: &Connection,
    credential: &AgentCredential,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let resolved = live_credential_by_hash(connection, credential.token_hash().as_bytes())?
        .ok_or_else(agent_credential_invalid)?;
    require_agent_active_on(connection, &resolved.user_id)?;
    super::auth_integrations::require_installation_grant_if_integration_on(
        connection,
        &resolved.user_id,
        grant_id,
    )?;
    require_live_grant_for_actor(connection, grant_id, &resolved.user_id, now_ms)?;
    let live = live_token_ids_for_grant(connection, grant_id, now_ms)?;
    let evict_count = live
        .len()
        .saturating_sub(SCOPED_TOKEN_LIVE_CAP as usize - 1);
    Ok(live.into_iter().take(evict_count).collect())
}

fn planned_pairing_terminal_token_ids(
    connection: &Connection,
    credential: &AgentCredential,
    pairing_request_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let resolved = live_credential_by_hash(connection, credential.token_hash().as_bytes())?
        .ok_or_else(agent_credential_invalid)?;
    require_agent_active_on(connection, &resolved.user_id)?;
    let pairing = connection
        .query_row(
            "SELECT agent_user_id, state, expires_at_ms, grant_id
             FROM _auth_pairing_requests WHERE id = ?1",
            params![pairing_request_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((bound_agent, state, pairing_expires_at_ms, grant_id)) = pairing else {
        return Err(grant_invalid());
    };
    let pairing_expires_at_ms =
        u64::try_from(pairing_expires_at_ms).map_err(|_| agent_credential_state_corrupt())?;
    if bound_agent.as_deref() != Some(resolved.user_id.as_str()) || pairing_expires_at_ms <= now_ms
    {
        return Err(grant_invalid());
    }
    if state == "pending" && grant_id.is_none() {
        return Err(grant_pending());
    }
    if state != "approved" {
        return Err(grant_invalid());
    }
    let grant_id = grant_id.ok_or_else(grant_invalid)?;
    require_live_grant_for_actor(connection, &grant_id, &resolved.user_id, now_ms)?;

    let pairing_prefix = format!("{pairing_request_id}:%");
    let mut terminal = collect_token_ids(
        connection,
        "SELECT id FROM _auth_grant_tokens
         WHERE grant_id = ?1 AND id LIKE ?2 AND revoked_at_ms IS NULL
         ORDER BY created_at_ms, id",
        params![grant_id, pairing_prefix],
    )?;
    let replaced = terminal.iter().cloned().collect::<BTreeSet<_>>();
    let remaining_live = live_token_ids_for_grant(connection, &grant_id, now_ms)?
        .into_iter()
        .filter(|token_id| !replaced.contains(token_id))
        .collect::<Vec<_>>();
    let evict_count = remaining_live
        .len()
        .saturating_sub(SCOPED_TOKEN_LIVE_CAP as usize - 1);
    terminal.extend(remaining_live.into_iter().take(evict_count));
    terminal.sort();
    terminal.dedup();
    Ok(terminal)
}

fn planned_expired_service_authority_token_ids(
    connection: &Connection,
    deadline: &ServiceAuthorityDeadlineTerminal,
) -> SnapbackResult<Vec<String>> {
    match deadline.disposition {
        ServiceAuthorityDisposition::Carrier => Ok(vec![deadline.token_id.clone()]),
        ServiceAuthorityDisposition::DurableDelete => collect_token_ids(
            connection,
            "SELECT id FROM _auth_grant_tokens WHERE grant_id = ?1 ORDER BY id",
            params![deadline.grant_id],
        ),
    }
}

fn live_token_ids_for_credential(
    tx: &Transaction<'_>,
    credential_id: &str,
) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_grant_tokens
         WHERE credential_id = ?1 AND revoked_at_ms IS NULL ORDER BY id",
        credential_id,
    )
}

fn token_ids_for_credential(
    connection: &Connection,
    credential_id: &str,
) -> SnapbackResult<Vec<String>> {
    collect_token_ids(
        connection,
        "SELECT id FROM _auth_grant_tokens
         WHERE credential_id = ?1 ORDER BY created_at_ms, id",
        params![credential_id],
    )
}

fn credential_ids_for_user(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_agent_credentials WHERE user_id = ?1 ORDER BY id",
        user_id,
    )
}

pub(super) fn live_token_ids_for_user(
    tx: &Transaction<'_>,
    user_id: &str,
) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT t.id FROM _auth_grant_tokens AS t
         JOIN _auth_agent_credentials AS c ON c.id = t.credential_id
         WHERE c.user_id = ?1 AND t.revoked_at_ms IS NULL ORDER BY t.id",
        user_id,
    )
}

pub(super) fn token_ids_for_user(
    connection: &Connection,
    user_id: &str,
) -> SnapbackResult<Vec<String>> {
    collect_token_ids(
        connection,
        "SELECT tokens.id
         FROM _auth_grant_tokens AS tokens
         JOIN _auth_agent_credentials AS credentials
           ON credentials.id = tokens.credential_id
         WHERE credentials.user_id = ?1
         ORDER BY tokens.created_at_ms, tokens.id",
        params![user_id],
    )
}

fn live_grant_ids_for_actor(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<Vec<String>> {
    collect_ids(
        tx,
        "SELECT id FROM _auth_grants
         WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL ORDER BY id",
        user_id,
    )
}

fn collect_ids(tx: &Transaction<'_>, sql: &str, value: &str) -> SnapbackResult<Vec<String>> {
    collect_token_ids(tx, sql, params![value])
}

fn collect_token_ids<P: rusqlite::Params>(
    connection: &Connection,
    sql: &str,
    params: P,
) -> SnapbackResult<Vec<String>> {
    let mut statement = connection.prepare(sql)?;
    let rows = statement.query_map(params, |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub(super) fn reconcile_issued_agent_credential(
    connection: &Connection,
    expected: &IssuedAgentCredential,
) -> SnapbackResult<()> {
    let stored = connection
        .query_row(
            "SELECT user_id, secret_hash, generation, revoked_at_ms
             FROM _auth_agent_credentials WHERE id = ?1",
            params![expected.credential_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?;
    let hash = expected.secret.token_hash();
    if stored
        != Some((
            expected.user_id.clone(),
            hash.as_bytes().to_vec(),
            expected.generation as i64,
            None,
        ))
    {
        return Err(agent_lifecycle_commit_uncertain());
    }
    let identity_exists = connection
        .query_row(
            "SELECT 1 FROM _auth_identities
             WHERE user_id = ?1 AND provider = 'agent-credential' AND subject = ?2",
            params![expected.user_id, expected.credential_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !identity_exists {
        return Err(agent_lifecycle_commit_uncertain());
    }
    Ok(())
}

fn reconcile_rotated_agent_credential(
    connection: &Connection,
    predecessor_hash: &[u8],
    expected: &RotatedAgentCredential,
) -> SnapbackResult<()> {
    let live = connection
        .query_row(
            "SELECT user_id, secret_hash, generation, revoked_at_ms
             FROM _auth_agent_credentials WHERE id = ?1",
            params![expected.credential_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?;
    let successor_hash = expected.secret.token_hash();
    if live
        != Some((
            expected.user_id.clone(),
            successor_hash.as_bytes().to_vec(),
            expected.generation as i64,
            None,
        ))
    {
        return Err(agent_lifecycle_commit_uncertain());
    }
    let predecessor_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_agent_credentials
         WHERE user_id = ?1 AND secret_hash = ?2 AND generation = ?3
           AND revoked_at_ms IS NOT NULL",
        params![
            expected.user_id,
            predecessor_hash,
            expected.predecessor_generation as i64,
        ],
        |row| row.get(0),
    )?;
    if predecessor_count != 1 {
        return Err(agent_lifecycle_commit_uncertain());
    }
    for token_id in &expected.invalidated_token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(agent_lifecycle_commit_uncertain());
        }
    }
    let old_generation_live: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grant_tokens
         WHERE credential_id = ?1 AND credential_generation = ?2
           AND revoked_at_ms IS NULL",
        params![
            expected.credential_id,
            expected.predecessor_generation as i64,
        ],
        |row| row.get(0),
    )?;
    if old_generation_live != 0 {
        return Err(agent_lifecycle_commit_uncertain());
    }
    Ok(())
}

fn rotated_agent_credential_is_predecessor(
    connection: &Connection,
    predecessor_hash: &[u8],
    expected: &RotatedAgentCredential,
) -> SnapbackResult<bool> {
    let credential = connection
        .query_row(
            "SELECT user_id, secret_hash, generation, revoked_at_ms
             FROM _auth_agent_credentials WHERE id = ?1",
            params![expected.credential_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            },
        )
        .optional()?;
    if credential
        != Some((
            expected.user_id.clone(),
            predecessor_hash.to_vec(),
            expected.predecessor_generation as i64,
            None,
        ))
    {
        return Ok(false);
    }
    for token_id in &expected.invalidated_token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn reconcile_issued_scoped_token(
    connection: &Connection,
    expected: &IssuedScopedToken,
) -> SnapbackResult<()> {
    let stored = connection
        .query_row(
            "SELECT token_hash, grant_id, credential_id, credential_generation,
                    expires_at_ms, revoked_at_ms
             FROM _auth_grant_tokens WHERE id = ?1",
            params![expected.token_id],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            },
        )
        .optional()?;
    let hash = expected.secret.token_hash();
    if stored
        != Some((
            hash.as_bytes().to_vec(),
            expected.grant_id.clone(),
            expected.credential_id.clone(),
            expected.credential_generation as i64,
            expected.expires_at_ms as i64,
            None,
        ))
    {
        return Err(agent_lifecycle_commit_uncertain());
    }
    let grant = connection
        .query_row(
            "SELECT scopes, expires_at_ms, revoked_at_ms FROM _auth_grants WHERE id = ?1",
            params![expected.grant_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((scopes, grant_expires_at_ms, grant_revoked_at_ms)) = grant else {
        return Err(agent_lifecycle_commit_uncertain());
    };
    let scopes: Value =
        serde_json::from_str(&scopes).map_err(|_| agent_lifecycle_commit_uncertain())?;
    if scopes != expected.scopes
        || grant_expires_at_ms.map(|value| value as u64) != expected.grant_expires_at_ms
        || grant_revoked_at_ms.is_some()
    {
        return Err(agent_lifecycle_commit_uncertain());
    }
    for token_id in &expected.evicted_token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(agent_lifecycle_commit_uncertain());
        }
    }
    Ok(())
}

fn issued_scoped_token_is_predecessor(
    connection: &Connection,
    expected: &IssuedScopedToken,
) -> SnapbackResult<bool> {
    let candidate_exists = connection
        .query_row(
            "SELECT 1 FROM _auth_grant_tokens WHERE id = ?1",
            params![expected.token_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if candidate_exists {
        return Ok(false);
    }
    for token_id in &expected.evicted_token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn reconcile_agent_family_revocation(
    connection: &Connection,
    expected: &AgentFamilyRevocation,
) -> SnapbackResult<()> {
    let user_id = expected
        .user_id
        .as_deref()
        .ok_or_else(agent_lifecycle_commit_uncertain)?;
    let mut statement = connection.prepare(
        "SELECT id, revoked_at_ms IS NOT NULL FROM _auth_agent_credentials
         WHERE user_id = ?1 ORDER BY id",
    )?;
    let credential_rows = statement
        .query_map(params![user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if credential_rows.iter().any(|(_, revoked)| !revoked)
        || credential_rows
            .iter()
            .map(|(id, _)| id)
            .ne(expected.credential_ids.iter())
    {
        return Err(agent_lifecycle_commit_uncertain());
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(agent_lifecycle_commit_uncertain());
        }
    }
    for grant_id in &expected.grant_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants WHERE id = ?1",
                params![grant_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(agent_lifecycle_commit_uncertain());
        }
    }
    let live_tokens: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grant_tokens AS token
         JOIN _auth_agent_credentials AS credential ON credential.id = token.credential_id
         WHERE credential.user_id = ?1 AND token.revoked_at_ms IS NULL",
        params![user_id],
        |row| row.get(0),
    )?;
    let live_grants: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grants
         WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL",
        params![user_id],
        |row| row.get(0),
    )?;
    if live_tokens != 0 || live_grants != 0 {
        return Err(agent_lifecycle_commit_uncertain());
    }
    Ok(())
}

fn agent_family_revocation_is_predecessor(
    connection: &Connection,
    expected: &AgentFamilyRevocation,
) -> SnapbackResult<bool> {
    let Some(user_id) = expected.user_id.as_deref() else {
        return Ok(false);
    };
    let live_credentials: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_agent_credentials
         WHERE user_id = ?1 AND revoked_at_ms IS NULL",
        params![user_id],
        |row| row.get(0),
    )?;
    if live_credentials == 0 {
        return Ok(false);
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens WHERE id = ?1",
                params![token_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    for grant_id in &expected.grant_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants WHERE id = ?1",
                params![grant_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn sweep_credential_family_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    let cutoff = now_ms.saturating_sub(AGENT_CREDENTIAL_FAMILY_RETENTION_MS);
    tx.execute(
        "DELETE FROM _auth_agent_credentials
         WHERE revoked_at_ms IS NOT NULL AND revoked_at_ms <= ?1",
        params![cutoff as i64],
    )?;
    Ok(())
}

fn map_live_credential_constraint(error: rusqlite::Error) -> SnapbackError {
    if matches!(error, rusqlite::Error::SqliteFailure(ref code, _)
        if code.code == rusqlite::ErrorCode::ConstraintViolation)
    {
        SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_EXISTS",
            "auth",
            "the agent already has a live credential",
        )
    } else {
        error.into()
    }
}

#[cfg(any(test, feature = "test-support"))]
static INJECT_AGENT_LIFECYCLE_COMMIT_UNCERTAIN: std::sync::Mutex<Option<(String, String)>> =
    std::sync::Mutex::new(None);

#[cfg(any(test, feature = "test-support"))]
pub fn inject_next_agent_lifecycle_commit_uncertain(operation: &str, key: &str) {
    *INJECT_AGENT_LIFECYCLE_COMMIT_UNCERTAIN
        .lock()
        .expect("agent lifecycle commit uncertainty injector lock") =
        Some((operation.to_owned(), key.to_owned()));
}

fn inject_agent_lifecycle_commit_uncertainty<T>(
    attempt: AuthTransactionAttempt<T>,
    _operation: &str,
    _key: &str,
) -> AuthTransactionAttempt<T> {
    #[cfg(any(test, feature = "test-support"))]
    {
        let should_inject = {
            let mut target = INJECT_AGENT_LIFECYCLE_COMMIT_UNCERTAIN
                .lock()
                .expect("agent lifecycle commit uncertainty injector lock");
            if target
                .as_ref()
                .is_some_and(|(operation, key)| operation == _operation && key == _key)
            {
                target.take();
                true
            } else {
                false
            }
        };
        if should_inject {
            return match attempt {
                AuthTransactionAttempt::Committed(_) => {
                    AuthTransactionAttempt::CommitUncertain(SnapbackError::error(
                        "SNAPBACK_AUTH_AGENT_COMMIT_UNCERTAIN",
                        "auth",
                        "agent lifecycle commit acknowledgement was unavailable",
                    ))
                }
                other => other,
            };
        }
    }
    attempt
}

fn inject_agent_lifecycle_service_commit_uncertainty<T>(
    attempt: ServiceAuthTransactionAttempt<T>,
    _operation: &str,
    _key: &str,
) -> ServiceAuthTransactionAttempt<T> {
    #[cfg(any(test, feature = "test-support"))]
    {
        let should_inject = {
            let mut target = INJECT_AGENT_LIFECYCLE_COMMIT_UNCERTAIN
                .lock()
                .expect("agent lifecycle commit uncertainty injector lock");
            if target
                .as_ref()
                .is_some_and(|(operation, key)| operation == _operation && key == _key)
            {
                target.take();
                true
            } else {
                false
            }
        };
        if should_inject {
            return match attempt {
                ServiceAuthTransactionAttempt::Committed(_) => {
                    ServiceAuthTransactionAttempt::CommitUncertain {
                        error: SnapbackError::error(
                            "SNAPBACK_AUTH_AGENT_COMMIT_UNCERTAIN",
                            "auth",
                            "agent lifecycle commit acknowledgement was unavailable",
                        ),
                        terminal: None,
                    }
                }
                other => other,
            };
        }
    }
    attempt
}

fn agent_lifecycle_commit_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_COMMIT_UNCERTAIN",
        "auth",
        "agent lifecycle outcome could not be reconciled",
    )
}

fn secret_generation_failed() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "agent secret generation is unavailable",
    )
}

fn agent_credential_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
        "auth",
        "agent credential is invalid",
    )
}

fn agent_credential_rotation_throttled() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED",
        "auth",
        "agent credential rotation is limited to once per hour",
    )
}

fn agent_credential_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT",
        "auth",
        "agent credential state is corrupt",
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ScopedTokenAuthorityDisposition {
    Carrier,
    DurableDelete,
}

impl ScopedTokenAuthorityDisposition {
    fn wire_name(self) -> &'static str {
        match self {
            Self::Carrier => "carrier",
            Self::DurableDelete => "durableDelete",
        }
    }
}

/// Classify a failed scoped-token resolution without trusting the bearer as a
/// durable-authority tombstone. An unknown hash is only a bad carrier. For a
/// known token, token-local expiry/revocation is also carrier churn so long as
/// its grant, credential generation, and actor principal remain live. Only a
/// failed durable axis authorizes clients to delete retained agent authority.
///
/// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — bearer
///   expiry is a carrier event; grant, credential, and principal termination
///   end durable authority.
fn scoped_token_authority_disposition_on(
    connection: &Connection,
    token_hash: &[u8],
    now_ms: u64,
) -> SnapbackResult<ScopedTokenAuthorityDisposition> {
    let token_basis = connection
        .query_row(
            "SELECT grant_id, credential_id, credential_generation
             FROM _auth_grant_tokens
             WHERE token_hash = ?1",
            params![token_hash],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((grant_id, credential_id, credential_generation)) = token_basis else {
        return Ok(ScopedTokenAuthorityDisposition::Carrier);
    };
    let durable_axes_live = connection.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM _auth_grants AS g
           JOIN _auth_agent_credentials AS c ON c.id = ?2
           JOIN _auth_users AS u ON u.id = g.actor_user_id
           WHERE g.id = ?1
             AND g.revoked_at_ms IS NULL
             AND (g.expires_at_ms IS NULL OR g.expires_at_ms > ?4)
             AND c.revoked_at_ms IS NULL
             AND c.generation = ?3
             AND c.user_id = g.actor_user_id
             AND u.kind = 'agent'
             AND u.deactivated_at_ms IS NULL
         )",
        params![
            grant_id,
            credential_id,
            credential_generation,
            now_ms as i64
        ],
        |row| row.get::<_, bool>(0),
    )?;
    Ok(if durable_axes_live {
        ScopedTokenAuthorityDisposition::Carrier
    } else {
        ScopedTokenAuthorityDisposition::DurableDelete
    })
}

fn scoped_token_invalid(authority_disposition: ScopedTokenAuthorityDisposition) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID",
        "auth",
        "scoped agent token is invalid",
    )
    .with_details(serde_json::json!({
        "authorityDisposition": authority_disposition.wire_name(),
    }))
}

fn scoped_token_ttl_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_SCOPED_TOKEN_TTL_INVALID",
        "auth",
        "scoped agent token TTL must be between one millisecond and 24 hours",
    )
}

fn grant_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_INVALID",
        "auth",
        "agent grant is invalid",
    )
}

fn grant_pending() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_PENDING",
        "auth",
        "agent grant consent is still pending",
    )
}

fn auth_clock_rollback() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_CLOCK_ROLLBACK",
        "auth",
        "server auth clock moved behind its durable high-water",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::storage::auth_agents::AgentRegistration;
    use std::sync::atomic::{AtomicU8, Ordering};

    struct CounterRandom(AtomicU8);

    struct FixedRandom(u8);

    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl RandomSource for CounterRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            let byte = self.0.fetch_add(1, Ordering::SeqCst);
            destination.fill(byte);
            Ok(())
        }
    }

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    fn create_agent(db: &mut LocalDatabase, user_id: &str) {
        db.create_agent_principal(
            user_id,
            0,
            &AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: "test".to_owned(),
                owner_user_id: None,
            },
        )
        .expect("agent principal");
    }

    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog().expect("auth catalog v2");
        db.create_agent_principal(
            "agent-a",
            0,
            &AgentRegistration {
                display_name: Some("Agent A".to_owned()),
                operator_contact: None,
                registration_provenance: "test".to_owned(),
                owner_user_id: None,
            },
        )
        .expect("agent principal");
        db
    }

    fn seed_grant(db: &LocalDatabase, id: &str, now_ms: u64) {
        db.conn
            .execute(
                "INSERT OR IGNORE INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('query-a', 'query', 0, 1, 0)",
                [],
            )
            .expect("live query scope basis");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
               id, actor_user_id, effective_user_id, scopes, created_at_ms,
               expires_at_ms, revoked_at_ms, created_by, request_id,
               consent_digest, last_used_at_ms
             ) VALUES(?1, 'agent-a', NULL, ?2, ?3, NULL, NULL, 'test', NULL, NULL, ?3)",
                params![
                    id,
                    r#"[{"fn":"query-a","kind":"query","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64
                ],
            )
            .expect("grant");
    }

    fn seed_expiring_grant(db: &LocalDatabase, id: &str, now_ms: u64, expires_at_ms: u64) {
        db.conn
            .execute(
                "INSERT OR IGNORE INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('query-a', 'query', 0, 1, 0)",
                [],
            )
            .expect("live query scope basis");
        db.conn
            .execute(
                "INSERT INTO _auth_grants(
               id, actor_user_id, effective_user_id, scopes, created_at_ms,
               expires_at_ms, revoked_at_ms, created_by, request_id,
               consent_digest, last_used_at_ms
             ) VALUES(?1, 'agent-a', 'user-a', ?2, ?3, ?4, NULL, 'test', NULL, NULL, ?3)",
                params![
                    id,
                    r#"[{"fn":"query-a","kind":"query","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )
            .expect("expiring grant");
    }

    fn assert_scoped_token_disposition(error: SnapbackError, expected: &str) {
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID");
        assert_eq!(error.diagnostic.details["authorityDisposition"], expected);
    }

    fn scoped_token_fixture(ttl_ms: u64) -> (LocalDatabase, IssuedScopedToken) {
        let random = CounterRandom::new();
        let mut db = ready();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .expect("credential")
            .secret;
        seed_grant(&db, "grant-a", 1_000);
        let token = db
            .mint_scoped_token(&credential, "grant-a", Some(ttl_ms), 1_000, &random)
            .expect("scoped token");
        (db, token)
    }

    #[test]
    fn thief_rotates_n_but_original_secret_still_destroys_the_family() {
        let random = CounterRandom::new();
        let mut db = ready();
        let start = 1_000;
        let issued = db
            .issue_initial_agent_credential("agent-a", start, &random)
            .unwrap();
        let original = issued.secret.expose_secret().to_owned();
        let mut live = issued.secret;
        for turn in 1..=24 {
            let now = start + turn * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
            let rotated = db.rotate_agent_credential(&live, now, &random).unwrap();
            assert_eq!(rotated.generation, turn + 1);
            assert_eq!(
                db.resolve_agent_credential(&live, now)
                    .unwrap_err()
                    .diagnostic
                    .code,
                "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
            );
            live = rotated.secret;
        }
        let original = AgentCredential::parse(&original).unwrap();
        let revoked = db
            .revoke_agent_credential_family(
                &original,
                start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
            )
            .unwrap();
        assert_eq!(revoked.user_id.as_deref(), Some("agent-a"));
        assert_eq!(
            db.resolve_agent_credential(
                &live,
                start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID"
        );
        db.revoke_agent_credential_family(
            &original,
            start + 24 * AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS,
        )
        .expect("destroy-only alarm is idempotent while attributable");
    }

    #[test]
    fn repeated_rng_output_cannot_alias_issue_or_rotation() {
        let random = FixedRandom(7);
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        create_agent(&mut db, "agent-b");

        let issue_error = db
            .issue_initial_agent_credential("agent-b", 1_001, &random)
            .unwrap_err();
        assert_eq!(
            issue_error.diagnostic.code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        let agent_b_credentials: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _auth_agent_credentials WHERE user_id = 'agent-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_b_credentials, 0);

        let rotation_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        let rotate_error = db
            .rotate_agent_credential(&issued.secret, rotation_at, &random)
            .unwrap_err();
        assert_eq!(
            rotate_error.diagnostic.code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        let resolved = db
            .resolve_agent_credential(&issued.secret, rotation_at)
            .expect("failed collision retries leave the predecessor live");
        assert_eq!(resolved.generation, 1);
    }

    #[test]
    fn revoked_agent_hash_cannot_alias_a_different_live_agent() {
        let random = CounterRandom::new();
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        let rotation_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        db.rotate_agent_credential(&issued.secret, rotation_at, &random)
            .unwrap();
        create_agent(&mut db, "agent-b");
        let hash = issued.secret.token_hash();
        db.conn
            .execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES('credential-b', 'agent-b', ?1, 1, ?2, ?2, ?2, NULL)",
                params![hash.as_bytes(), rotation_at as i64],
            )
            .unwrap();

        let resolve_error = db
            .resolve_agent_credential(&issued.secret, rotation_at + 1)
            .unwrap_err();
        assert_eq!(
            resolve_error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT"
        );
        let revoke_error = db
            .revoke_agent_credential_family(&issued.secret, rotation_at + 1)
            .unwrap_err();
        assert_eq!(
            revoke_error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_STATE_CORRUPT"
        );
        let agent_b_live: i64 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _auth_agent_credentials
                 WHERE user_id = 'agent-b' AND revoked_at_ms IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(agent_b_live, 1);
    }

    #[test]
    fn rotation_throttle_and_family_retention_survive_restart() {
        let random = CounterRandom::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("agent.sqlite3");
        let original = {
            let mut db = LocalDatabase::open(&path).unwrap();
            db.activate_current_auth_catalog().unwrap();
            db.create_agent_principal(
                "agent-a",
                0,
                &AgentRegistration {
                    display_name: None,
                    operator_contact: None,
                    registration_provenance: "test".to_owned(),
                    owner_user_id: None,
                },
            )
            .unwrap();
            db.issue_initial_agent_credential("agent-a", 1_000, &random)
                .unwrap()
                .secret
        };
        let mut db = LocalDatabase::open(&path).unwrap();
        let throttled = db
            .rotate_agent_credential(&original, 2_000, &random)
            .unwrap_err();
        assert_eq!(
            throttled.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_CREDENTIAL_ROTATION_THROTTLED"
        );
        let rotated_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        let rotated = db
            .rotate_agent_credential(&original, rotated_at, &random)
            .unwrap();
        drop(db);
        let mut reopened = LocalDatabase::open(&path).unwrap();
        reopened
            .revoke_agent_credential_family(&original, rotated_at + 1)
            .expect("predecessor survives reopen");
        assert!(
            reopened
                .resolve_agent_credential(&rotated.secret, rotated_at + 1)
                .is_err()
        );
    }

    #[test]
    fn token_cap_evicts_oldest_and_resolution_checks_every_live_axis() {
        let random = CounterRandom::new();
        let mut db = ready();
        let now = 1_000;
        let credential = db
            .issue_initial_agent_credential("agent-a", now, &random)
            .unwrap()
            .secret;
        seed_grant(&db, "grant-a", now);
        let mut tokens = Vec::new();
        for offset in 0..=SCOPED_TOKEN_LIVE_CAP {
            tokens.push(
                db.mint_scoped_token(&credential, "grant-a", None, now + offset, &random)
                    .unwrap(),
            );
        }
        assert_eq!(tokens.last().unwrap().evicted_token_ids.len(), 1);
        assert_scoped_token_disposition(
            db.resolve_scoped_token(&tokens.remove(0).secret, now + SCOPED_TOKEN_LIVE_CAP)
                .unwrap_err(),
            "carrier",
        );
        let current = tokens.last().unwrap();
        let resolved = db
            .resolve_scoped_token(&current.secret, now + SCOPED_TOKEN_LIVE_CAP)
            .unwrap();
        assert_eq!(resolved.grant_id, "grant-a");
        assert_eq!(resolved.actor_user_id, "agent-a");
    }

    #[test]
    fn exact_scoped_token_release_is_idempotent_and_carrier_only() {
        let (mut db, issued) = scoped_token_fixture(10_000);
        assert_eq!(
            db.plan_scoped_token_release(&issued.secret).unwrap(),
            issued.token_id
        );
        let released = db.release_scoped_token(&issued.secret, 1_001).unwrap();
        assert_eq!(released.token_id, issued.token_id);
        assert!(released.newly_revoked);
        let repeated = db.release_scoped_token(&issued.secret, 1_002).unwrap();
        assert_eq!(repeated.token_id, issued.token_id);
        assert!(!repeated.newly_revoked);
        assert_scoped_token_disposition(
            db.resolve_scoped_token(&issued.secret, 1_002).unwrap_err(),
            "carrier",
        );

        let unknown = ScopedToken::generate(&FixedRandom(99)).unwrap();
        assert_scoped_token_disposition(
            db.release_scoped_token(&unknown, 1_003).unwrap_err(),
            "carrier",
        );
    }

    #[test]
    fn scoped_token_failures_classify_carrier_churn_and_durable_authority_loss() {
        let (mut unknown_db, _) = scoped_token_fixture(100);
        let unknown = ScopedToken::generate(&FixedRandom(99)).expect("well-formed unknown token");
        assert_scoped_token_disposition(
            unknown_db
                .resolve_scoped_token(&unknown, 1_001)
                .unwrap_err(),
            "carrier",
        );

        let (mut expired_db, expired) = scoped_token_fixture(10);
        assert_scoped_token_disposition(
            expired_db
                .resolve_scoped_token(&expired.secret, 1_010)
                .unwrap_err(),
            "carrier",
        );

        let (mut revoked_grant_db, revoked_grant) = scoped_token_fixture(100);
        revoked_grant_db
            .conn
            .execute(
                "UPDATE _auth_grants SET revoked_at_ms = 1001 WHERE id = 'grant-a'",
                [],
            )
            .expect("revoke grant");
        assert_scoped_token_disposition(
            revoked_grant_db
                .resolve_scoped_token(&revoked_grant.secret, 1_001)
                .unwrap_err(),
            "durableDelete",
        );

        let (mut rotated_credential_db, rotated_credential) = scoped_token_fixture(100);
        rotated_credential_db
            .conn
            .execute(
                "UPDATE _auth_agent_credentials SET generation = generation + 1
                 WHERE user_id = 'agent-a' AND revoked_at_ms IS NULL",
                [],
            )
            .expect("rotate credential generation");
        assert_scoped_token_disposition(
            rotated_credential_db
                .resolve_scoped_token(&rotated_credential.secret, 1_001)
                .unwrap_err(),
            "durableDelete",
        );

        let (mut revoked_credential_db, revoked_credential) = scoped_token_fixture(100);
        revoked_credential_db
            .conn
            .execute(
                "UPDATE _auth_agent_credentials SET revoked_at_ms = 1001
                 WHERE user_id = 'agent-a' AND revoked_at_ms IS NULL",
                [],
            )
            .expect("revoke credential");
        assert_scoped_token_disposition(
            revoked_credential_db
                .resolve_scoped_token(&revoked_credential.secret, 1_001)
                .unwrap_err(),
            "durableDelete",
        );

        let (mut inactive_principal_db, inactive_principal) = scoped_token_fixture(100);
        inactive_principal_db
            .conn
            .execute(
                "UPDATE _auth_users SET deactivated_at_ms = 1001 WHERE id = 'agent-a'",
                [],
            )
            .expect("deactivate principal");
        assert_scoped_token_disposition(
            inactive_principal_db
                .resolve_scoped_token(&inactive_principal.secret, 1_001)
                .unwrap_err(),
            "durableDelete",
        );
    }

    #[test]
    fn retained_live_validation_checks_exact_carrier_and_committed_durable_state() {
        let random = CounterRandom::new();
        let mut db = ready();
        let now = 1_000;
        let credential = db
            .issue_initial_agent_credential("agent-a", now, &random)
            .unwrap()
            .secret;
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                params![now as i64],
            )
            .unwrap();
        seed_expiring_grant(&db, "grant-live", now, now + 10_000);
        let issued = db
            .mint_scoped_token(&credential, "grant-live", Some(5_000), now, &random)
            .unwrap();
        let resolved = db.resolve_scoped_token(&issued.secret, now + 1).unwrap();

        assert!(
            db.retained_service_authority_is_live(
                RetainedServiceAuthority {
                    actor_user_id: &resolved.actor_user_id,
                    credential_id: &resolved.credential_id,
                    credential_generation: resolved.credential_generation,
                    grant_id: &resolved.grant_id,
                    token_id: &resolved.token_id,
                    effective_user_id: resolved.effective_user_id.as_deref(),
                },
                now + 1,
            )
            .unwrap()
        );
        assert!(
            !db.retained_service_authority_is_live(
                RetainedServiceAuthority {
                    actor_user_id: &resolved.actor_user_id,
                    credential_id: &resolved.credential_id,
                    credential_generation: resolved.credential_generation,
                    grant_id: &resolved.grant_id,
                    token_id: "another-token",
                    effective_user_id: resolved.effective_user_id.as_deref(),
                },
                now + 1,
            )
            .unwrap()
        );

        db.revoke_grant_for_user("user-a", "grant-live", now + 2)
            .unwrap();
        assert!(
            !db.retained_service_authority_is_live(
                RetainedServiceAuthority {
                    actor_user_id: &resolved.actor_user_id,
                    credential_id: &resolved.credential_id,
                    credential_generation: resolved.credential_generation,
                    grant_id: &resolved.grant_id,
                    token_id: &resolved.token_id,
                    effective_user_id: resolved.effective_user_id.as_deref(),
                },
                now + 2,
            )
            .unwrap()
        );
    }

    #[test]
    fn expired_token_observation_prevents_clock_rollback_revival() {
        let random = CounterRandom::new();
        let mut db = ready();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap()
            .secret;
        seed_grant(&db, "grant-a", 1_000);
        let token = db
            .mint_scoped_token(&credential, "grant-a", Some(10), 1_000, &random)
            .unwrap()
            .secret;
        assert_eq!(
            db.resolve_scoped_token(&token, 1_010)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        assert_eq!(
            db.resolve_scoped_token(&token, 1_009)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_CLOCK_ROLLBACK"
        );
    }

    #[test]
    fn monotonic_token_expiry_is_durable_before_terminal_publication_and_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("service-expiry.sqlite3");
        let random = CounterRandom::new();
        let token;
        {
            let mut db = LocalDatabase::open(&path).expect("open durable database");
            db.activate_current_auth_catalog()
                .expect("activate auth catalog");
            create_agent(&mut db, "agent-a");
            let credential = db
                .issue_initial_agent_credential("agent-a", 1_000, &random)
                .unwrap()
                .secret;
            seed_grant(&db, "grant-a", 1_000);
            let issued = db
                .mint_scoped_token(&credential, "grant-a", Some(10), 1_000, &random)
                .unwrap();
            let resolved = db.resolve_scoped_token(&issued.secret, 1_001).unwrap();
            let monotonic = std::time::Instant::now();
            let interlock =
                crate::auth::service_fence::RecordingServiceAuthorityCommitInterlock::default();
            let authority = db
                .claim_kernel_commit_authority()
                .expect("kernel authority");
            db.install_service_authority_commit_interlock(
                &authority.binding(),
                interlock.bind(&authority),
            )
            .expect("bind service terminal interlock");
            let deadline = ServiceAuthorityDeadlineTerminal {
                token_id: resolved.token_id.clone(),
                grant_id: resolved.grant_id.clone(),
                deadline_ms: resolved.expires_at_ms,
                disposition: ServiceAuthorityDisposition::Carrier,
                close_by: monotonic + std::time::Duration::from_millis(9),
            };
            db.terminalize_expired_service_authority(&deadline)
                .expect("persist expiry and settle exact fence");
            assert_eq!(
                interlock.plans(),
                vec![(
                    vec![resolved.token_id],
                    ServiceAuthorityDisposition::Carrier,
                )]
            );
            assert_eq!(interlock.committed(), 1);
            token = issued.secret;
        }

        let mut reopened = LocalDatabase::open(&path).expect("reopen durable database");
        let error = reopened
            .resolve_scoped_token(&token, 1_001)
            .expect_err("a backward wall sample after restart cannot revive the token");
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID");
        assert_eq!(error.diagnostic.details["authorityDisposition"], "carrier");
    }

    #[test]
    fn token_receipt_and_durable_expiry_are_clamped_to_the_grant() {
        let random = CounterRandom::new();
        let mut db = ready();
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', 0, 'human', NULL, NULL, NULL, NULL, NULL)",
                [],
            )
            .unwrap();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap()
            .secret;
        seed_expiring_grant(&db, "grant-short", 1_000, 1_010);
        let issued = db
            .mint_scoped_token(&credential, "grant-short", Some(1_000), 1_001, &random)
            .unwrap();
        assert_eq!(issued.expires_at_ms, 1_010);
        db.resolve_scoped_token(&issued.secret, 1_009)
            .expect("token remains live strictly before the grant expiry");
        assert_scoped_token_disposition(
            db.resolve_scoped_token(&issued.secret, 1_010).unwrap_err(),
            "durableDelete",
        );
    }

    #[test]
    fn lost_commit_acknowledgements_reconcile_rotation_mint_and_family_revocation() {
        let random = CounterRandom::new();
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        let original = issued.secret.expose_secret().to_owned();
        inject_next_agent_lifecycle_commit_uncertain("rotate-credential", &issued.credential_id);
        let rotation_at = 1_000 + AGENT_CREDENTIAL_ROTATION_MIN_INTERVAL_MS;
        let rotated = db
            .rotate_agent_credential(&issued.secret, rotation_at, &random)
            .expect("durable successor is reconciled and returned");
        assert_eq!(rotated.generation, 2);
        db.resolve_agent_credential(&rotated.secret, rotation_at)
            .expect("reconciled successor authenticates");

        seed_grant(&db, "grant-a", rotation_at);
        inject_next_agent_lifecycle_commit_uncertain("mint-scoped-token", "grant-a");
        let token = db
            .mint_scoped_token(&rotated.secret, "grant-a", None, rotation_at + 1, &random)
            .expect("durable token is reconciled with its plaintext secret");
        db.resolve_scoped_token(&token.secret, rotation_at + 1)
            .expect("reconciled token authenticates");

        inject_next_agent_lifecycle_commit_uncertain("revoke-credential-family", "agent-a");
        let original = AgentCredential::parse(&original).unwrap();
        let revoked = db
            .revoke_agent_credential_family(&original, rotation_at + 2)
            .expect("durable revocation returns its exact topology witness");
        assert!(revoked.token_ids.contains(&token.token_id));
        assert!(revoked.grant_ids.contains(&"grant-a".to_owned()));
        assert!(
            db.resolve_agent_credential(&rotated.secret, rotation_at + 2)
                .is_err()
        );
    }

    #[test]
    fn sole_unowned_production_holder_cannot_destroy_its_last_credential_family() {
        let random = CounterRandom::new();
        let mut db = ready();
        let issued = db
            .issue_initial_agent_credential("agent-a", 1_000, &random)
            .unwrap();
        db.conn
            .execute(
                "CREATE TABLE events (
                   _id TEXT PRIMARY KEY,
                   _version INTEGER NOT NULL DEFAULT 1
                 )",
                [],
            )
            .unwrap();
        db.conn
            .execute(
                "CREATE TABLE event_members (
                   userId TEXT,
                   eventId TEXT,
                   role TEXT,
                   _version INTEGER NOT NULL DEFAULT 1
                 )",
                [],
            )
            .unwrap();
        db.conn
            .execute("UPDATE _snapback_version SET version = 1 WHERE id = 1", [])
            .unwrap();
        db.conn
            .execute("INSERT INTO events(_id) VALUES('event-1')", [])
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO event_members(userId, eventId, role)
                 VALUES('agent-a', 'event-1', 'host')",
                [],
            )
            .unwrap();
        let schema = serde_json::from_value(serde_json::json!({
            "auth": { "mode": "sessions" },
            "tables": [
                { "name": "events" },
                {
                    "name": "event_members",
                    "membership": {
                        "principal": "userId",
                        "resource": "eventId",
                        "resourceTable": "events",
                        "role": "role",
                        "roles": ["host"],
                        "bootstrapRole": "host",
                        "lastHolder": { "protect": "host" }
                    }
                }
            ]
        }))
        .unwrap();
        db.replace_active_schema(schema);

        let error = db
            .revoke_agent_credential_family(&issued.secret, 1_001)
            .expect_err("revoke-self must not strand a protected resource");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        db.resolve_agent_credential(&issued.secret, 1_001)
            .expect("refused revocation rolls the family back");

        let restore_error = db
            .apply_auth_restore_declaration("0197f862-f196-7bb2-b3f0-2a67185dfd20", 1_002)
            .expect_err("restore must not purge the sole recovery carrier");
        assert_eq!(
            restore_error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        db.resolve_agent_credential(&issued.secret, 1_002)
            .expect("refused restore rolls the authority purge back");
    }
}
impl super::ServingDatabase {
    pub fn rotate_agent_credential(
        &mut self,
        credential: &AgentCredential,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<RotatedAgentCredential> {
        self.db.rotate_agent_credential(credential, now_ms, random)
    }
    pub fn revoke_agent_credential_family(
        &mut self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.db.revoke_agent_credential_family(attributable, now_ms)
    }
    pub fn retire_integration_credential_family(
        &mut self,
        attributable: &AgentCredential,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.db
            .retire_integration_credential_family(attributable, now_ms)
    }
    pub fn retire_integration_principal(
        &mut self,
        principal_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<AgentFamilyRevocation> {
        self.db
            .retire_integration_principal(principal_user_id, now_ms)
    }
    pub fn release_scoped_token(
        &mut self,
        token: &ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<ReleasedScopedToken> {
        self.db.release_scoped_token(token, now_ms)
    }
    pub fn oauth_revoke_scoped_token(
        &mut self,
        token: &ScopedToken,
        revoke_grant: bool,
        now_ms: u64,
    ) -> SnapbackResult<super::auth_grants::GrantRevocation> {
        self.db
            .oauth_revoke_scoped_token(token, revoke_grant, now_ms)
    }
    pub fn mint_scoped_token_for_oauth_code(
        &mut self,
        code: &str,
        client_id: &str,
        redirect_uri: &str,
        verifier: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        self.db.mint_scoped_token_for_oauth_code(
            code,
            client_id,
            redirect_uri,
            verifier,
            now_ms,
            random,
        )
    }
    pub fn mint_scoped_token(
        &mut self,
        credential: &AgentCredential,
        grant_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        self.db
            .mint_scoped_token(credential, grant_id, ttl_ms, now_ms, random)
    }
    pub fn mint_scoped_token_for_pairing_request(
        &mut self,
        credential: &AgentCredential,
        pairing_request_id: &str,
        ttl_ms: Option<u64>,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedScopedToken> {
        self.db.mint_scoped_token_for_pairing_request(
            credential,
            pairing_request_id,
            ttl_ms,
            now_ms,
            random,
        )
    }
    pub fn resolve_scoped_token(
        &mut self,
        token: &ScopedToken,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedScopedToken> {
        self.db.resolve_scoped_token(token, now_ms)
    }
    pub fn retained_service_authority_is_live(
        &mut self,
        authority: RetainedServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<bool> {
        self.db
            .retained_service_authority_is_live(authority, now_ms)
    }
    pub fn resolve_retained_service_authority(
        &mut self,
        authority: RetainedServiceAuthority<'_>,
        now_ms: u64,
    ) -> SnapbackResult<ResolvedScopedToken> {
        self.db
            .resolve_retained_service_authority(authority, now_ms)
    }
    pub fn terminalize_expired_service_authority(
        &mut self,
        deadline: &ServiceAuthorityDeadlineTerminal,
    ) -> SnapbackResult<()> {
        self.db.terminalize_expired_service_authority(deadline)
    }
}
impl super::ServingDatabase {
    pub fn issue_initial_agent_credential(
        &mut self,
        user_id: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        self.db
            .issue_initial_agent_credential(user_id, now_ms, random)
    }
}
