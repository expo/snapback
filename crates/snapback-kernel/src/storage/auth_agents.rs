//! LLP 0055 G1: agent-principal ownership and durable, permanent deactivation
//! on the version-2 auth catalog.
//!
//! This module owns the storage-side machinery the RFC pins as G1: creating a
//! `kind: "agent"` principal with its immutable provenance and owner, the
//! fail-closed deactivation consult that every authority-creating and
//! authority-exercising path must cross, and the eligible-holder predicate that
//! refuses a deactivation which would strand an LLP 0056 protected resource.
//!
//! The full grant/token/credential lifecycle (mint, rotate, recover, consent)
//! is G3/G4 and is deliberately **not** implemented here.
//!
//! @ref LLP 0055#principal-kinds — `kind`/`registration_provenance` are
//!   create-only; deactivation is durable, permanent in v1, and refused when it
//!   would leave a protected resource with no eligible holder.

use super::LocalDatabase;
use super::auth::{
    AuthTransactionAttempt, ServiceAuthTransactionAttempt, ServiceAuthorityTerminalOperation,
};
use super::auth_agent_credentials::{
    IssuedAgentCredential, advance_agent_clock_on, issue_initial_agent_credential_on,
    reconcile_issued_agent_credential, require_agent_clock_on,
};
use crate::auth::crypto::{CreationInvitation, RandomSource};
use crate::auth::crypto::{StepUpConsumption, StepUpProof, step_up_required_error};
use crate::contract_types::ServerProfile;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AgentsMode, AuthMode, MembershipScope, SchemaManifest};
use rusqlite::{Connection, OptionalExtension, Transaction, params, types::Value as SqlValue};
use serde_json::json;

pub const AGENT_INVITATION_TTL_MS: u64 = 24 * 60 * 60 * 1_000;
pub const AGENT_INVITATION_LIVE_CAP: u64 = 10;

#[derive(Clone, Copy)]
struct ProtectedMembershipColumns<'a> {
    table: &'a str,
    principal: &'a str,
    resource: &'a str,
    role: &'a str,
}

/// The immutable registration facts recorded when an agent principal is created.
/// `kind` is always `agent`; `registration_provenance` and `kind` are written
/// once and never updated, which is how their documented immutability is kept.
pub struct AgentRegistration {
    pub display_name: Option<String>,
    pub operator_contact: Option<String>,
    /// Canonical JSON provenance — the tagged minting authority, invitation
    /// class, and creation timestamp; durable, exported, redacted of secrets,
    /// and independent of the sweeping invitation row.
    pub registration_provenance: String,
    /// The owner recorded for the `invitedBy: "users"` production creation path;
    /// `None` for an operator-created or `open` self-registered (unowned) agent.
    pub owner_user_id: Option<String>,
}

#[derive(Debug)]
pub struct IssuedAgentInvitation {
    pub invitation_id: String,
    pub expires_at_ms: u64,
    pub secret: CreationInvitation,
}

impl LocalDatabase {
    /// Create a `kind: "agent"` principal. The caller has already minted the id
    /// and validated the owner. Fails closed on the catalog checks the direct
    /// auth lane always crosses.
    ///
    /// @ref LLP 0055#principal-kinds — an agent created from a user's session
    ///   records that user as owner; `registration_provenance` is immutable.
    pub(crate) fn create_agent_principal(
        &mut self,
        user_id: &str,
        created_at_ms: u64,
        registration: &AgentRegistration,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            create_agent_principal_on(tx, user_id, created_at_ms, registration)
        })
    }

    /// Create a principal, its stable identity, and its initial credential in
    /// one auth transaction. Invited registration also consumes the exact
    /// creation invitation in that commit, so neither a credential-less agent
    /// nor a consumed-without-agent invitation can become durable.
    ///
    /// @ref LLP 0055#registration — registration is gated by app policy and
    /// atomically returns the one-time initial credential.
    /// @ref LLP 0055#routes-and-credential-classes — invited creation consumes
    /// one `sbagi_`, records its user minter as owner, and fences operator
    /// invitations against non-prod-to-prod laundering.
    #[allow(clippy::too_many_arguments)] // Stable registration boundary; regrouping is out of scope here.
    pub fn register_agent_principal(
        &mut self,
        invitation: Option<&CreationInvitation>,
        display_name: Option<String>,
        operator_contact: Option<String>,
        profile: ServerProfile,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        self.register_agent_principal_with_class(
            invitation,
            display_name,
            operator_contact,
            super::auth_integrations::AgentRegistrationClass::Agent,
            super::auth_integrations::IntegrationRegistrationFacts::default(),
            profile,
            now_ms,
            random,
        )
    }

    /// Typed registration-class entry used by the public registration route
    /// and the future DCR facade. Both classes share one transaction; only the
    /// integration class displaces ownership and writes the companion record.
    ///
    /// @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — integration registration is delegation-only, never seats an owner, and records inviter provenance only.
    #[allow(clippy::too_many_arguments)]
    pub fn register_agent_principal_with_class(
        &mut self,
        invitation: Option<&CreationInvitation>,
        display_name: Option<String>,
        operator_contact: Option<String>,
        class: super::auth_integrations::AgentRegistrationClass,
        integration_facts: super::auth_integrations::IntegrationRegistrationFacts,
        profile: ServerProfile,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        let user_id = crate::ids::mint(crate::ids::Kind::User)?;
        let credential_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentCredential);
        let identity_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentIdentity);
        let mut body_outcome = None;
        let mut consumed_invitation_id = None;
        let attempt = self.attempt_auth_transaction_with_schema(|tx, schema| {
            // @ref LLP 0303#the-governing-principle — the database borrows
            // its current manifest only after beginning the same transaction
            // that validates/consumes invitations and creates the principal.
            let mode = schema.effective_agents_manifest().mode;
            if mode == AgentsMode::Disabled {
                return Err(agent_registration_disabled());
            }
            if (mode == AgentsMode::Open) != invitation.is_none() {
                return Err(if mode == AgentsMode::Invited {
                    agent_invitation_required()
                } else {
                    agent_invitation_unexpected()
                });
            }
            advance_agent_clock_on(tx, now_ms)?;
            let (ordinary_owner_user_id, invitation_id, source, inviter) = match invitation {
                Some(invitation) => {
                    let row = creation_invitation_on(tx, invitation, now_ms)?;
                    if profile == ServerProfile::Prod
                        && row.minted_profile != ServerProfile::Prod.as_str()
                        && row.created_by.starts_with("hostOps:")
                    {
                        return Err(agent_invitation_profile_mismatch());
                    }
                    let owner =
                        (!row.created_by.starts_with("hostOps:")).then_some(row.created_by.clone());
                    let changed = tx.execute(
                        "UPDATE _auth_agent_invitations
                         SET consumed_at_ms = ?1, consumed_by = ?2
                         WHERE id = ?3 AND class = 'creation'
                           AND revoked_at_ms IS NULL AND consumed_at_ms IS NULL
                           AND expires_at_ms > ?1",
                        params![now_ms as i64, user_id, row.id],
                    )?;
                    if changed != 1 {
                        return Err(agent_invitation_invalid());
                    }
                    let source = if owner.is_some() {
                        "user-invitation"
                    } else {
                        "operator-invitation"
                    };
                    let inviter = Some(row.created_by.clone());
                    (owner, Some(row.id), source, inviter)
                }
                None => (None, None, "self-register", None),
            };
            let owner_user_id = (class == super::auth_integrations::AgentRegistrationClass::Agent)
                .then_some(ordinary_owner_user_id)
                .flatten();
            consumed_invitation_id = invitation_id.clone();
            let provenance = if mode == AgentsMode::Open {
                json!({
                    "class": class.as_str(),
                    "source": source,
                    "mode": mode.as_str(),
                    "profile": profile.as_str(),
                    "createdAtMs": now_ms,
                })
                .to_string()
            } else {
                json!({
                    "class": class.as_str(),
                    "source": source,
                    "mode": mode.as_str(),
                    "profile": profile.as_str(),
                    "createdAtMs": now_ms,
                    "invitationClass": "creation",
                    "invitationId": invitation_id,
                    "inviter": inviter,
                })
                .to_string()
            };
            create_agent_principal_on(
                tx,
                &user_id,
                now_ms,
                &AgentRegistration {
                    display_name: display_name.clone(),
                    operator_contact: operator_contact.clone(),
                    registration_provenance: provenance.clone(),
                    owner_user_id,
                },
            )?;
            if class == super::auth_integrations::AgentRegistrationClass::Integration {
                // @ref LLP 0071#upgrade-creates-a-fresh-identity — registration
                // mints fresh key-bound integration identity and deliberately
                // neither reads, consumes, blesses, nor transfers a matching
                // declared-client row.
                // @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — registration-time template application is forbidden for integration-class principals.
                super::auth_integrations::validate_registration_template_suppressed_on(
                    tx, &user_id,
                )?;
                super::auth_integrations::create_record_on(
                    tx,
                    &user_id,
                    display_name.as_deref(),
                    &integration_facts,
                    &provenance,
                    mode == AgentsMode::Open,
                    now_ms,
                )?;
            } else if integration_facts
                != super::auth_integrations::IntegrationRegistrationFacts::default()
            {
                return Err(super::auth_integrations::integration_facts_for_agent());
            }
            body_outcome = Some(issue_initial_agent_credential_on(
                tx,
                &user_id,
                now_ms,
                random,
                &credential_id,
                &identity_id,
            )?);
            Ok(())
        });
        match attempt {
            AuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_registration_commit_uncertain)
            }
            AuthTransactionAttempt::RolledBack(error) => Err(error),
            AuthTransactionAttempt::CommitUncertain(_) => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_registration_commit_uncertain)?;
                self.with_auth_read(|connection| {
                    reconcile_registered_agent(
                        connection,
                        expected,
                        consumed_invitation_id.as_deref(),
                        class,
                    )
                })?;
                body_outcome.ok_or_else(agent_registration_commit_uncertain)
            }
        }
    }

    /// Mint one user-owned creation invitation only after consuming the
    /// operation-bound step-up proof in the same transaction.
    pub fn mint_agent_invitation(
        &mut self,
        user_id: &str,
        profile: ServerProfile,
        proof: &StepUpProof,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentInvitation> {
        self.mint_agent_invitation_guarded(user_id, profile, proof, now_ms, random, || Ok(()))
    }

    pub fn mint_agent_invitation_guarded<G, BeforeCommit>(
        &mut self,
        user_id: &str,
        profile: ServerProfile,
        proof: &StepUpProof,
        now_ms: u64,
        random: &dyn RandomSource,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<IssuedAgentInvitation>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        let invitation_id = crate::ids::mint_time_ordered(crate::ids::Kind::AgentInvitation);
        let expires_at_ms = now_ms
            .checked_add(AGENT_INVITATION_TTL_MS)
            .filter(|expires| *expires <= super::MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(agent_invitation_invalid)?;
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_guarded(
            |tx| {
                advance_agent_clock_on(tx, now_ms)?;
                require_human_user_on(tx, user_id)?;
                if super::auth_catalog_ops::consume_step_up_proof_on(tx, proof, now_ms)?
                    != StepUpConsumption::Verified
                {
                    return Err(step_up_required_error());
                }
                let live: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM _auth_agent_invitations
                 WHERE class = 'creation' AND created_by = ?1
                   AND revoked_at_ms IS NULL AND consumed_at_ms IS NULL
                   AND expires_at_ms > ?2",
                    params![user_id, now_ms as i64],
                    |row| row.get(0),
                )?;
                if live < 0 || live as u64 >= AGENT_INVITATION_LIVE_CAP {
                    return Err(agent_invitation_cap());
                }
                let secret = CreationInvitation::generate(random)
                    .map_err(|_| agent_invitation_secret_generation_failed())?;
                let hash = secret.token_hash();
                tx.execute(
                    "INSERT INTO _auth_agent_invitations(
                   id, token_hash, class, created_by, minted_profile,
                   agent_user_id, created_at_ms, expires_at_ms,
                   revoked_at_ms, consumed_at_ms, consumed_by
                 ) VALUES(?1, ?2, 'creation', ?3, ?4, NULL, ?5, ?6, NULL, NULL, NULL)",
                    params![
                        invitation_id,
                        hash.as_bytes(),
                        user_id,
                        profile.as_str(),
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
                body_outcome = Some(IssuedAgentInvitation {
                    invitation_id: invitation_id.clone(),
                    expires_at_ms,
                    secret,
                });
                Ok(())
            },
            before_commit,
        );
        match attempt {
            AuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(agent_invitation_commit_uncertain)
            }
            AuthTransactionAttempt::RolledBack(error) => Err(error),
            AuthTransactionAttempt::CommitUncertain(_) => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(agent_invitation_commit_uncertain)?;
                let exact = self.with_auth_read(|connection| {
                    let hash = expected.secret.token_hash();
                    Ok(connection
                        .query_row(
                            "SELECT created_by, minted_profile, expires_at_ms,
                                    revoked_at_ms, consumed_at_ms
                             FROM _auth_agent_invitations WHERE id = ?1 AND token_hash = ?2",
                            params![expected.invitation_id, hash.as_bytes()],
                            |row| {
                                Ok((
                                    row.get::<_, String>(0)?,
                                    row.get::<_, String>(1)?,
                                    row.get::<_, i64>(2)?,
                                    row.get::<_, Option<i64>>(3)?,
                                    row.get::<_, Option<i64>>(4)?,
                                ))
                            },
                        )
                        .optional()?
                        == Some((
                            user_id.to_owned(),
                            profile.as_str().to_owned(),
                            expires_at_ms as i64,
                            None,
                            None,
                        )))
                })?;
                if !exact {
                    return Err(agent_invitation_commit_uncertain());
                }
                body_outcome.ok_or_else(agent_invitation_commit_uncertain)
            }
        }
    }

    /// The `owner_user_id` recorded for an agent, or `None` when the principal is
    /// unowned or not an agent. Ownership is what lets an owner re-credential
    /// their own agent from an ordinary session (the production path; G3).
    pub fn agent_owner(&self, user_id: &str) -> SnapbackResult<Option<String>> {
        self.with_auth_read(|conn| {
            Ok(conn
                .query_row(
                    "SELECT owner_user_id FROM _auth_users WHERE id = ?1 AND kind = 'agent'",
                    params![user_id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten())
        })
    }

    /// Fail-closed deactivation consult: `true` iff `user_id` is a principal with
    /// a durable `deactivated_at_ms`. This is the read every authority path
    /// crosses; [`Self::require_agent_not_deactivated`] is its typed-refusal twin.
    pub fn agent_is_deactivated(&self, user_id: &str) -> SnapbackResult<bool> {
        self.with_auth_read(|conn| Ok(is_deactivated_on(conn, user_id)?))
    }

    /// Refuse, typed, when `user_id` is a permanently deactivated agent. Every
    /// authority-creating and authority-exercising agent path calls this before
    /// acting, so deactivation closes every door fail-closed.
    ///
    /// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — deactivation is consulted fail-closed by
    ///   token mint, invocation validation, pairing, approval, template
    ///   application, and recovery consumption.
    pub fn require_agent_not_deactivated(&self, user_id: &str) -> SnapbackResult<()> {
        if self.agent_is_deactivated(user_id)? {
            return Err(agent_deactivated(user_id));
        }
        Ok(())
    }

    /// Permanently deactivate an agent (v1: no reactivation path). Refused,
    /// typed, when it would leave any `lastHolder`-protected LLP 0056 resource
    /// with no eligible holder — naming the resources so the app can seat a
    /// replacement first. Re-deactivating an already-deactivated agent is an
    /// idempotent success.
    ///
    /// @ref LLP 0055#principal-kinds — the predicate is durable eligibility,
    ///   not sole-ness (a two-step schedule defeats sole-ness). The typed
    ///   precheck is followed by the same transaction-final evaluator used by
    ///   membership and credential-lifecycle commits.
    pub fn deactivate_agent(
        &mut self,
        user_id: &str,
        now_ms: u64,
        manifest: &SchemaManifest,
    ) -> SnapbackResult<()> {
        self.observe_agent_authorization_clock(now_ms)?;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            ServiceAuthorityTerminalOperation::AgentDeactivation { user_id, now_ms },
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let existing: Option<(String, Option<i64>)> = tx
                    .query_row(
                        "SELECT kind, deactivated_at_ms FROM _auth_users WHERE id = ?1",
                        params![user_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()?;
                let Some((kind, deactivated_at_ms)) = existing else {
                    return Err(agent_unknown(user_id));
                };
                if kind != "agent" {
                    return Err(agent_unknown(user_id));
                }
                if deactivated_at_ms.is_some() {
                    // Already terminal; permanent state is idempotent.
                    return Ok(());
                }

                let maximum = super::current_version_on(tx)?;
                let stranded = stranded_protected_resources(tx, user_id, manifest, maximum)?;
                if !stranded.is_empty() {
                    return Err(deactivation_would_strand(&stranded));
                }

                tx.execute(
                    "UPDATE _auth_users
                 SET deactivated_at_ms = ?1
                 WHERE id = ?2 AND kind = 'agent' AND deactivated_at_ms IS NULL",
                    params![now_ms as i64, user_id],
                )?;
                validate_protected_membership_final_state(tx, manifest, maximum)?;
                Ok(())
            },
        );
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => Ok(()),
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let exact = self.with_auth_read(|connection| {
                    Ok(connection
                        .query_row(
                            "SELECT deactivated_at_ms FROM _auth_users
                             WHERE id = ?1 AND kind = 'agent'",
                            params![user_id],
                            |row| row.get::<_, Option<i64>>(0),
                        )
                        .optional()?
                        .flatten()
                        == Some(now_ms as i64))
                })?;
                if !exact {
                    let predecessor = self.with_auth_read(|connection| {
                        Ok(connection
                            .query_row(
                                "SELECT deactivated_at_ms FROM _auth_users
                                 WHERE id = ?1 AND kind = 'agent'",
                                params![user_id],
                                |row| row.get::<_, Option<i64>>(0),
                            )
                            .optional()?
                            == Some(None))
                    })?;
                    if predecessor {
                        self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    }
                    return Err(error);
                }
                self.reconcile_ambiguous_service_terminal(terminal, true)?;
                Ok(())
            }
        }
    }
}

fn create_agent_principal_on(
    tx: &Transaction<'_>,
    user_id: &str,
    created_at_ms: u64,
    registration: &AgentRegistration,
) -> SnapbackResult<()> {
    tx.execute(
        "INSERT INTO _auth_users(
           id, created_at_ms, kind, display_name, operator_contact,
           registration_provenance, deactivated_at_ms, owner_user_id
         ) VALUES(?1, ?2, 'agent', ?3, ?4, ?5, NULL, ?6)",
        params![
            user_id,
            created_at_ms as i64,
            registration.display_name,
            registration.operator_contact,
            registration.registration_provenance,
            registration.owner_user_id,
        ],
    )?;
    Ok(())
}

struct CreationInvitationRow {
    id: String,
    created_by: String,
    minted_profile: String,
}

fn creation_invitation_on(
    tx: &Transaction<'_>,
    invitation: &CreationInvitation,
    now_ms: u64,
) -> SnapbackResult<CreationInvitationRow> {
    let hash = invitation.token_hash();
    tx.query_row(
        "SELECT id, created_by, minted_profile
         FROM _auth_agent_invitations
         WHERE token_hash = ?1 AND class = 'creation'
           AND revoked_at_ms IS NULL AND consumed_at_ms IS NULL
           AND expires_at_ms > ?2",
        params![hash.as_bytes(), now_ms as i64],
        |row| {
            Ok(CreationInvitationRow {
                id: row.get(0)?,
                created_by: row.get(1)?,
                minted_profile: row.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(agent_invitation_invalid)
}

fn require_human_user_on(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<()> {
    let human = tx
        .query_row(
            "SELECT 1 FROM _auth_users WHERE id = ?1 AND kind = 'human'",
            params![user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if human {
        Ok(())
    } else {
        Err(SnapbackError::error(
            "SNAPBACK_AUTH_AGENT_INVITATION_USER_INVALID",
            "auth",
            "agent invitations require an active human session principal",
        ))
    }
}

fn reconcile_registered_agent(
    connection: &Connection,
    expected: &IssuedAgentCredential,
    invitation_id: Option<&str>,
    class: super::auth_integrations::AgentRegistrationClass,
) -> SnapbackResult<()> {
    reconcile_issued_agent_credential(connection, expected)
        .map_err(|_| agent_registration_commit_uncertain())?;
    let agent_exists = connection
        .query_row(
            "SELECT 1 FROM _auth_users
             WHERE id = ?1 AND kind = 'agent' AND registration_provenance IS NOT NULL",
            params![expected.user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let invitation_exact = match invitation_id {
        Some(invitation_id) => {
            connection
                .query_row(
                    "SELECT consumed_by = ?1 AND consumed_at_ms IS NOT NULL
                 FROM _auth_agent_invitations WHERE id = ?2",
                    params![expected.user_id, invitation_id],
                    |row| row.get::<_, bool>(0),
                )
                .optional()?
                == Some(true)
        }
        None => true,
    };
    let integration_exact = match class {
        super::auth_integrations::AgentRegistrationClass::Agent => true,
        super::auth_integrations::AgentRegistrationClass::Integration => {
            super::auth_integrations::record_for_principal_on(connection, &expected.user_id)?
                .is_some()
        }
    };
    if agent_exists && invitation_exact && integration_exact {
        Ok(())
    } else {
        Err(agent_registration_commit_uncertain())
    }
}

fn agent_registration_disabled() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED",
        "auth",
        "agent registration is disabled by the active schema manifest",
    )
}

fn agent_invitation_required() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_REQUIRED",
        "auth",
        "invited agent registration requires a creation invitation",
    )
}

fn agent_invitation_unexpected() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_UNEXPECTED",
        "auth",
        "open agent registration does not accept an invitation",
    )
}

fn agent_invitation_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_INVALID",
        "auth",
        "agent creation invitation is invalid, expired, revoked, or already consumed",
    )
}

fn agent_invitation_profile_mismatch() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_PROFILE_MISMATCH",
        "auth",
        "operator-minted agent invitation cannot be consumed after promotion to prod",
    )
}

fn agent_invitation_cap() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_CAP",
        "auth",
        "the user already has ten live unconsumed agent invitations",
    )
}

fn agent_registration_commit_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_REGISTRATION_COMMIT_UNCERTAIN",
        "auth",
        "agent registration commit outcome could not be reconciled",
    )
}

fn agent_invitation_commit_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_COMMIT_UNCERTAIN",
        "auth",
        "agent invitation commit outcome could not be reconciled",
    )
}

fn agent_invitation_secret_generation_failed() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_INVITATION_SECRET_UNAVAILABLE",
        "auth",
        "agent invitation secret generation is unavailable",
    )
}

fn is_deactivated_on(conn: &Connection, user_id: &str) -> rusqlite::Result<bool> {
    let deactivated: Option<Option<i64>> = conn
        .query_row(
            "SELECT deactivated_at_ms FROM _auth_users WHERE id = ?1",
            params![user_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(matches!(deactivated, Some(Some(_))))
}

/// The shared durable-recoverability predicate. In sessions mode a principal
/// must exist. Humans remain recoverable through their provider identity; an
/// agent must be active and either owned (the owner re-credential path) or have
/// a live credential family. Agent-held recovery keys are not yet a catalog
/// fact, so they cannot be guessed into eligibility. Dev impersonation is the
/// deliberate exception: it asserts principal existence by fiat.
///
/// @ref LLP 0055#principal-kinds — eligibility, not sole-ness; same predicate as
///   LLP 0056 M2's eligible-holder rule.
pub(crate) fn principal_is_eligible_on(
    conn: &Connection,
    principal: &str,
    require_catalog_principal: bool,
) -> SnapbackResult<bool> {
    if !table_exists(conn, "_auth_users")? {
        return Ok(!require_catalog_principal);
    }
    let principal_row = conn
        .query_row(
            "SELECT kind, deactivated_at_ms, owner_user_id
             FROM _auth_users WHERE id = ?1",
            params![principal],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((kind, deactivated_at_ms, owner_user_id)) = principal_row else {
        return Ok(!require_catalog_principal);
    };
    if deactivated_at_ms.is_some() {
        return Ok(false);
    }
    // Dev impersonation is an explicit local recovery carrier: a live agent
    // or human principal remains reachable without production credential
    // material. Sessions/network modes have no such escape hatch and therefore
    // require one of the durable carriers below.
    if !require_catalog_principal {
        return Ok(true);
    }
    if kind == "human" {
        if !table_exists(conn, "_auth_identities")? {
            return Ok(false);
        }
        return Ok(conn
            .query_row(
                "SELECT 1 FROM _auth_identities
                 WHERE user_id = ?1 AND provider <> 'agent-credential' LIMIT 1",
                params![principal],
                |_| Ok(()),
            )
            .optional()?
            .is_some());
    }
    if kind != "agent" {
        return Ok(false);
    }
    if let Some(owner_user_id) = owner_user_id {
        let owner_can_recover = conn
            .query_row(
                "SELECT 1 FROM _auth_users AS owner
                 JOIN _auth_identities AS identity ON identity.user_id = owner.id
                 WHERE owner.id = ?1 AND owner.kind = 'human'
                   AND owner.deactivated_at_ms IS NULL
                   AND identity.provider <> 'agent-credential'
                 LIMIT 1",
                params![owner_user_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if owner_can_recover {
            return Ok(true);
        }
    }
    if !table_exists(conn, "_auth_agent_credentials")? {
        return Ok(false);
    }
    Ok(conn
        .query_row(
            "SELECT 1 FROM _auth_agent_credentials
             WHERE user_id = ?1 AND revoked_at_ms IS NULL LIMIT 1",
            params![principal],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

/// The **eligible** holder member rows of the protected role on one resource,
/// excluding `excluding_principal` (the acting/target principal). Each entry is
/// `(member_row_id, member_row_version, principal)`. LLP 0056 M2 captures one of
/// these rows as a snapshot-bound dependency so two concurrent removals of the
/// final two eligible holders cannot both commit — the same eligibility filter
/// (`NOT IN` the deactivated set) `has_other_eligible_holder` applies, but
/// returning the row identity the write path must capture.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   holder-set read is captured; the survivor row linearizes the race.
#[allow(clippy::too_many_arguments)]
pub(crate) fn eligible_protected_holder_rows(
    conn: &Connection,
    table: &str,
    principal_column: &str,
    resource_column: &str,
    role_column: &str,
    resource: &str,
    protect: &str,
    excluding_principal: &str,
    require_catalog_principal: bool,
    maximum: u64,
) -> SnapbackResult<Vec<(String, u64, String)>> {
    super::validate_managed_table_versions_by_name(conn, table, maximum)?;
    let sql = format!(
        "SELECT m._id, m._version, m.{principal} FROM {table} AS m
         WHERE m.{resource} = ?1 AND m.{role} = ?2 AND m.{principal} <> ?3
         ORDER BY m._id",
        table = quote_ident(table),
        resource = quote_ident(resource_column),
        role = quote_ident(role_column),
        principal = quote_ident(principal_column),
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![resource, protect, excluding_principal], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, SqlValue>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let candidates = rows.collect::<Result<Vec<_>, _>>()?;
    let mut eligible = Vec::new();
    for (id, version, principal) in candidates {
        let version = super::decode_required_committed_version(
            version,
            "protected holder membership row version",
        )?;
        super::validate_storage_version_at_most(
            version,
            maximum,
            "protected holder membership row version",
        )?;
        if principal_is_eligible_on(conn, &principal, require_catalog_principal)? {
            eligible.push((id, version, principal));
        }
    }
    Ok(eligible)
}

/// The `lastHolder`-protected resources that deactivating `principal` would
/// strand: for each membership declaration with `lastHolder`, every resource in
/// which `principal` holds the protected role and no **other eligible** holder
/// remains. Reads the app membership tables and the auth deactivation state in
/// the same transaction.
fn stranded_protected_resources(
    conn: &Connection,
    principal: &str,
    manifest: &SchemaManifest,
    maximum: u64,
) -> SnapbackResult<Vec<String>> {
    let require_catalog_principal = manifest.effective_auth_mode() == AuthMode::Sessions;
    let mut stranded = Vec::new();
    for table in &manifest.tables {
        let Some(membership) = &table.membership else {
            continue;
        };
        let Some(last_holder) = &membership.last_holder else {
            continue;
        };
        // `lastHolder` is valid only on resource scope (M1 refuses it on app
        // scope), so a resource column is always present here.
        if membership.scope != MembershipScope::Resource {
            continue;
        }
        let Some(resource_column) = membership.resource.as_deref() else {
            continue;
        };
        if !table_exists(conn, &table.name)? {
            continue;
        }
        super::validate_managed_row_versions(conn, table, maximum)?;
        let resource_table = membership.resource_table.as_deref().ok_or_else(|| {
            protected_membership_final_state_invalid(
                &table.name,
                "lastHolder requires a resourceTable binding",
            )
        })?;
        if !table_exists(conn, resource_table)? {
            return Err(protected_membership_final_state_invalid(
                &table.name,
                "resource table is absent at the lifecycle check",
            ));
        }
        super::validate_managed_table_versions_by_name(conn, resource_table, maximum)?;
        let protect = last_holder.protect.as_str();
        let columns = ProtectedMembershipColumns {
            table: &table.name,
            principal: &membership.principal,
            resource: resource_column,
            role: &membership.role,
        };
        let held = resources_held_by(conn, columns, principal, protect, maximum)?;
        for resource in held {
            if !has_other_eligible_holder(
                conn,
                columns,
                principal,
                &resource,
                protect,
                require_catalog_principal,
                maximum,
            )? {
                stranded.push(format!("{}:{resource}", table.name));
            }
        }
    }
    stranded.sort();
    stranded.dedup();
    Ok(stranded)
}

fn table_exists(conn: &Connection, table: &str) -> SnapbackResult<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            params![table],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn resources_held_by(
    conn: &Connection,
    columns: ProtectedMembershipColumns<'_>,
    principal: &str,
    protect: &str,
    maximum: u64,
) -> SnapbackResult<Vec<String>> {
    let sql = format!(
        "SELECT {resource}, _version FROM {table}
         WHERE {principal} = ?1 AND {role} = ?2",
        resource = quote_ident(columns.resource),
        table = quote_ident(columns.table),
        principal = quote_ident(columns.principal),
        role = quote_ident(columns.role),
    );
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(params![principal, protect], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, SqlValue>(1)?))
    })?;
    let mut resources = Vec::new();
    for row in rows {
        let (resource, version) = row?;
        validate_managed_version(version, maximum, "protected membership row version")?;
        resources.push(resource);
    }
    resources.sort();
    resources.dedup();
    Ok(resources)
}

/// Whether `resource` still has a holder of the protected role other than
/// `principal` (about to be deactivated) that satisfies the shared durable-
/// recoverability predicate. In sessions mode an absent catalog principal is
/// ineligible; dev impersonation is the deliberate catalog-free exception.
fn has_other_eligible_holder(
    conn: &Connection,
    columns: ProtectedMembershipColumns<'_>,
    principal: &str,
    resource: &str,
    protect: &str,
    require_catalog_principal: bool,
    maximum: u64,
) -> SnapbackResult<bool> {
    // Validate the complete relation before candidate ordering/eligibility can
    // return early on one healthy row and hide a later corrupt holder.
    super::validate_managed_table_versions_by_name(conn, columns.table, maximum)?;
    let sql = format!(
        "SELECT m.{principal}, m._version FROM {table} AS m
         WHERE m.{resource} = ?1 AND m.{role} = ?2 AND m.{principal} <> ?3
         ORDER BY m.{principal}",
        table = quote_ident(columns.table),
        resource = quote_ident(columns.resource),
        role = quote_ident(columns.role),
        principal = quote_ident(columns.principal),
    );
    let mut statement = conn.prepare(&sql)?;
    let candidates = statement
        .query_map(params![resource, protect, principal], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, SqlValue>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (candidate, version) in candidates {
        validate_managed_version(version, maximum, "protected holder membership row version")?;
        if principal_is_eligible_on(conn, &candidate, require_catalog_principal)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Validate the transaction-final protected-holder invariant across every live
/// resource. Membership writers call this after applying their effects and auth
/// lifecycle writers use the same predicate from their serialized transaction.
///
/// @ref LLP 0056#writes-a-declared-transition-policy-closed-by-default — the
///   complete eligible-holder set is a commit-stage property shared with LLP
///   0055 lifecycle changes, not a planning-time approximation.
pub(crate) fn validate_protected_membership_final_state(
    conn: &Connection,
    manifest: &SchemaManifest,
    maximum: u64,
) -> SnapbackResult<()> {
    let require_catalog_principal = manifest.effective_auth_mode() == AuthMode::Sessions;
    let mut stranded = Vec::new();
    for table in &manifest.tables {
        let profile = table.authority_profile.as_ref();
        let membership = match (&table.membership, profile) {
            (Some(membership), _) => membership,
            (None, Some(profile)) => {
                return Err(declared_protected_membership_final_state_invalid(
                    &table.name,
                    &profile.membership.declaration,
                    "authority profile requires a membership declaration",
                ));
            }
            (None, None) => continue,
        };
        let declaration = membership.effective_id(&table.name);
        let last_holder = match &membership.last_holder {
            Some(last_holder) => last_holder,
            None if profile.is_some() => {
                return Err(declared_protected_membership_final_state_invalid(
                    &table.name,
                    declaration,
                    "authority profile requires lastHolder",
                ));
            }
            None => continue,
        };
        let resource_column = membership.resource.as_deref().ok_or_else(|| {
            declared_protected_membership_final_state_invalid(
                &table.name,
                declaration,
                "lastHolder requires a resource axis",
            )
        })?;
        let resource_table = membership.resource_table.as_deref().ok_or_else(|| {
            declared_protected_membership_final_state_invalid(
                &table.name,
                declaration,
                "lastHolder requires a resourceTable binding",
            )
        })?;
        if !table_exists(conn, &table.name)? {
            return Err(declared_protected_membership_final_state_invalid(
                &table.name,
                declaration,
                "membership table is absent at the final-state check",
            ));
        }
        if !table_exists(conn, resource_table)? {
            return Err(declared_protected_membership_final_state_invalid(
                &table.name,
                declaration,
                "resource table is absent at the final-state check",
            ));
        }
        // Both relations are authorization inputs. Prove their complete
        // version domain before per-resource/per-holder loops can stop at an
        // eligible row or otherwise omit a corrupt row from SQL results.
        super::validate_managed_row_versions(conn, table, maximum)?;
        super::validate_managed_table_versions_by_name(conn, resource_table, maximum)?;
        let mut resources_statement = conn.prepare(&format!(
            "SELECT _id, _version FROM {} ORDER BY _id",
            quote_ident(resource_table)
        ))?;
        let resources = resources_statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, SqlValue>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let holder_sql = format!(
            "SELECT {principal}, _version FROM {table}
             WHERE {resource} = ?1 AND {role} = ?2
             ORDER BY {principal}",
            principal = quote_ident(&membership.principal),
            table = quote_ident(&table.name),
            resource = quote_ident(resource_column),
            role = quote_ident(&membership.role),
        );
        for (resource, resource_version) in resources {
            validate_managed_version(resource_version, maximum, "protected resource row version")?;
            let mut holder_statement = conn.prepare(&holder_sql)?;
            let principals = holder_statement
                .query_map(params![resource, last_holder.protect], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, SqlValue>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            // @ref LLP 0240#d1-declare-an-application-authority-profile-at-the-scoped-relation
            //   — a live profile scope has exactly one owner; every writer
            //   class reaches this commit-stage boundary.
            if let Some(profile) = profile {
                if profile.owner_bootstrap_invariant.role != last_holder.protect {
                    return Err(declared_protected_membership_final_state_invalid(
                        &table.name,
                        declaration,
                        "authority profile owner role does not match lastHolder.protect",
                    ));
                }
                if principals.len() != 1 {
                    return Err(SnapbackError::error(
                        "SNAPBACK_AUTHORITY_OWNER_COUNT_INVALID",
                        "auth",
                        format!(
                            "authority profile declaration {declaration:?} requires exactly one active owner for live resource {resource:?}; found {}",
                            principals.len()
                        ),
                    )
                    .with_details(json!({
                        "declaration": declaration,
                        "resource": resource,
                        "ownerRole": profile.owner_bootstrap_invariant.role,
                        "activeOwnerCount": principals.len(),
                    })));
                }
            }
            let mut eligible = false;
            for (principal, version) in principals {
                validate_managed_version(
                    version,
                    maximum,
                    "protected holder membership row version",
                )?;
                if principal_is_eligible_on(conn, &principal, require_catalog_principal)? {
                    eligible = true;
                }
            }
            if !eligible {
                stranded.push(format!("{}:{resource}", table.name));
            }
        }
    }
    if stranded.is_empty() {
        return Ok(());
    }
    Err(SnapbackError::error(
        "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND",
        "auth",
        "the transaction would leave a protected resource with no durably recoverable holder",
    )
    .with_details(json!({ "resources": stranded })))
}

fn validate_managed_version(value: SqlValue, maximum: u64, context: &str) -> SnapbackResult<u64> {
    let version = super::decode_required_committed_version(value, context)?;
    super::validate_storage_version_at_most(version, maximum, context)?;
    Ok(version)
}

fn protected_membership_final_state_invalid(table: &str, message: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MEMBERSHIP_FINAL_STATE_SCHEMA_INVALID",
        "auth",
        format!("membership declaration {table:?} cannot be evaluated: {message}"),
    )
    .with_details(json!({ "table": table }))
}

fn declared_protected_membership_final_state_invalid(
    table: &str,
    declaration: &str,
    message: &str,
) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_MEMBERSHIP_FINAL_STATE_SCHEMA_INVALID",
        "auth",
        format!("membership declaration {table:?} cannot be evaluated: {message}"),
    )
    .with_details(json!({ "table": table, "declaration": declaration }))
}

/// Quote a SQLite identifier. Membership table/column names are validated
/// identifiers by schema validation; doubling any embedded quote keeps this
/// injection-safe even if that ever changes.
fn quote_ident(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn agent_unknown(user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_UNKNOWN",
        "auth",
        "no agent principal exists for the named user id",
    )
    .with_details(json!({ "userId": user_id }))
}

fn agent_deactivated(user_id: &str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_DEACTIVATED",
        "auth",
        "the agent principal is permanently deactivated",
    )
    .with_details(json!({ "userId": user_id }))
}

fn deactivation_would_strand(resources: &[String]) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND",
        "auth",
        "deactivation would leave a protected resource with no eligible holder",
    )
    .with_details(json!({ "resources": resources }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::{AgentsManifest, AuthManifest, InvitedBy, SchemaManifest};
    use crate::storage::auth::AUTH_CATALOG_VERSION;
    use std::path::{Path, PathBuf};

    fn ready_database() -> LocalDatabase {
        let mut db = LocalDatabase::memory().expect("memory database");
        db.activate_current_auth_catalog()
            .expect("activate catalog v2");
        db
    }

    fn empty_manifest() -> SchemaManifest {
        serde_json::from_value(json!({ "tables": [] })).expect("empty manifest")
    }

    fn dev_schema_with_agents(mode: AgentsMode) -> SchemaManifest {
        SchemaManifest {
            app_id: "f182-registration-policy".to_owned(),
            auth: Some(AuthManifest {
                mode: AuthMode::Dev,
                agents: Some(AgentsManifest::explicit(mode, InvitedBy::Operators)),
                password_identifier_mode: None,
                password_minimum_length: None,
            }),
            ..SchemaManifest::default()
        }
    }

    fn file_database_with_agents(mode: AgentsMode) -> (tempfile::TempDir, PathBuf, LocalDatabase) {
        let directory = tempfile::tempdir().expect("registration policy tempdir");
        let path = directory.path().join("registration-policy.sqlite3");
        let mut database = LocalDatabase::open(&path).expect("open registration policy database");
        database
            .activate_current_auth_catalog()
            .expect("activate registration policy auth catalog");
        database
            .schema_seed()
            .apply_schema(dev_schema_with_agents(mode))
            .expect("publish registration policy schema");
        (directory, path, database)
    }

    fn publish_agents_mode(path: &Path, mode: AgentsMode) {
        let mut publisher = LocalDatabase::open(path).expect("open registration policy publisher");
        publisher
            .schema_seed()
            .apply_schema(dev_schema_with_agents(mode))
            .expect("publish successor registration policy schema");
    }

    fn register_open_agent(
        database: &mut LocalDatabase,
        display_name: &str,
        now_ms: u64,
    ) -> IssuedAgentCredential {
        database
            .register_agent_principal(
                None,
                Some(display_name.to_owned()),
                None,
                ServerProfile::Test,
                now_ms,
                &crate::auth::crypto::OsRandom,
            )
            .expect("open-mode registration")
    }

    fn assert_credential_resolves(
        database: &mut LocalDatabase,
        issued: &IssuedAgentCredential,
        now_ms: u64,
    ) {
        let resolved = database
            .resolve_agent_credential(&issued.secret, now_ms)
            .expect("resolve issued credential");
        assert_eq!(resolved.user_id, issued.user_id);
        assert_eq!(resolved.credential_id, issued.credential_id);
        assert_eq!(resolved.generation, issued.generation);
    }

    fn registration_row_counts(database: &LocalDatabase) -> (i64, i64) {
        let agents = database
            .conn
            .query_row(
                "SELECT COUNT(*) FROM _auth_users WHERE kind = 'agent'",
                [],
                |row| row.get(0),
            )
            .expect("count agent principals");
        let credentials = database
            .conn
            .query_row("SELECT COUNT(*) FROM _auth_agent_credentials", [], |row| {
                row.get(0)
            })
            .expect("count agent credentials");
        (agents, credentials)
    }

    #[test]
    fn registration_policy_single_handle_open_flow_remains_live() {
        let (_directory, _path, mut database) = file_database_with_agents(AgentsMode::Open);
        let issued = register_open_agent(&mut database, "single handle", 10);
        assert_credential_resolves(&mut database, &issued, 11);
    }

    #[test]
    fn stale_disabled_handle_accepts_legitimate_registration_after_open_mode_change() {
        let (_directory, path, mut stale) = file_database_with_agents(AgentsMode::Disabled);
        publish_agents_mode(&path, AgentsMode::Open);
        assert_eq!(
            stale.schema().effective_agents_manifest().mode,
            AgentsMode::Disabled,
            "the caller remains genuinely stale before the legitimate operation"
        );

        let issued = register_open_agent(&mut stale, "post-change registration", 20);
        let mut readback = LocalDatabase::open(&path).expect("open post-change readback");
        assert_credential_resolves(&mut readback, &issued, 21);
    }

    #[test]
    fn concurrent_open_mode_registrations_on_distinct_handles_both_commit() {
        let (_directory, path, database) = file_database_with_agents(AgentsMode::Open);
        drop(database);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let workers: Vec<_> = (0..2)
            .map(|ordinal| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let mut database =
                        LocalDatabase::open(path).expect("open concurrent registration handle");
                    barrier.wait();
                    register_open_agent(&mut database, &format!("concurrent handle {ordinal}"), 30)
                })
            })
            .collect();
        barrier.wait();
        let issued: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().expect("registration worker did not panic"))
            .collect();
        assert_ne!(issued[0].user_id, issued[1].user_id);

        let mut readback = LocalDatabase::open(&path).expect("open concurrent readback");
        for (ordinal, credential) in issued.iter().enumerate() {
            assert_credential_resolves(&mut readback, credential, 40 + ordinal as u64);
        }
    }

    #[test]
    fn registration_policy_survives_reopen_and_credential_readback_restart() {
        let (_directory, path, database) = file_database_with_agents(AgentsMode::Open);
        drop(database);

        let issued = {
            let mut reopened = LocalDatabase::open(&path).expect("reopen for registration");
            register_open_agent(&mut reopened, "restarted registration", 50)
        };
        let mut restarted = LocalDatabase::open(&path).expect("restart for credential readback");
        assert_credential_resolves(&mut restarted, &issued, 51);
    }

    #[test]
    fn stale_open_handle_refuses_registration_after_disabled_publication() {
        let (_directory, path, mut stale) = file_database_with_agents(AgentsMode::Open);
        publish_agents_mode(&path, AgentsMode::Disabled);
        assert_eq!(
            stale.schema().effective_agents_manifest().mode,
            AgentsMode::Open,
            "the attacking handle must retain the historical stale view"
        );

        let before = registration_row_counts(&stale);
        let error = stale
            .register_agent_principal(
                None,
                Some("stale registration".to_owned()),
                None,
                ServerProfile::Test,
                60,
                &crate::auth::crypto::OsRandom,
            )
            .expect_err("durable Disabled mode must refuse the stale Open handle");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED"
        );
        assert_eq!(registration_row_counts(&stale), before);
        let readback = LocalDatabase::open(&path).expect("open refused-effect readback");
        assert_eq!(registration_row_counts(&readback), before);
    }

    #[test]
    fn alternate_integration_registration_route_uses_the_same_resource_policy() {
        let (_directory, path, mut stale) = file_database_with_agents(AgentsMode::Open);
        publish_agents_mode(&path, AgentsMode::Disabled);
        let before = registration_row_counts(&stale);

        let error = stale
            .register_agent_principal_with_class(
                None,
                Some("stale integration registration".to_owned()),
                None,
                super::super::auth_integrations::AgentRegistrationClass::Integration,
                super::super::auth_integrations::IntegrationRegistrationFacts::default(),
                ServerProfile::Test,
                70,
                &crate::auth::crypto::OsRandom,
            )
            .expect_err("alternate integration route must derive durable Disabled mode");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_REGISTRATION_DISABLED"
        );
        let readback = LocalDatabase::open(&path).expect("open alternate-route readback");
        assert_eq!(registration_row_counts(&readback), before);
    }

    fn seed_human(db: &LocalDatabase, id: &str) {
        db.conn
            .execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![id],
            )
            .expect("seed human user");
    }

    fn create_agent(db: &mut LocalDatabase, id: &str, owner: Option<&str>) {
        db.create_agent_principal(
            id,
            0,
            &AgentRegistration {
                display_name: Some(format!("agent {id}")),
                operator_contact: None,
                registration_provenance: json!({
                    "invitedBy": "users",
                    "class": "creation",
                    "createdAtMs": 0,
                })
                .to_string(),
                owner_user_id: owner.map(str::to_owned),
            },
        )
        .expect("create agent principal");
    }

    /// A `.membership()` on `eventMembers` protecting the `host` role, plus the
    /// physical app table the eligibility scan reads.
    fn host_membership(db: &LocalDatabase) -> SchemaManifest {
        db.conn
            .execute(
                "CREATE TABLE events (
                   _id TEXT PRIMARY KEY,
                   _version INTEGER NOT NULL DEFAULT 1
                 )",
                [],
            )
            .expect("create resource table");
        db.conn
            .execute(
                "CREATE TABLE eventMembers (
                   principal TEXT,
                   resource TEXT,
                   role TEXT,
                   _version INTEGER NOT NULL DEFAULT 1
                 )",
                [],
            )
            .expect("create membership table");
        db.conn
            .execute("UPDATE _snapback_version SET version = 1 WHERE id = 1", [])
            .expect("advance fixture storage head");
        serde_json::from_value(json!({
            "tables": [{
                "name": "eventMembers",
                "membership": {
                    "principal": "principal",
                    "resource": "resource",
                    "role": "role",
                    "roles": ["host"],
                    "lastHolder": { "protect": "host" },
                    "resourceTable": "events"
                }
            }]
        }))
        .expect("membership manifest")
    }

    fn seat(db: &LocalDatabase, principal: &str, resource: &str, role: &str) {
        db.conn
            .execute(
                "INSERT OR IGNORE INTO events(_id) VALUES(?1)",
                params![resource],
            )
            .expect("seat resource");
        db.conn
            .execute(
                "INSERT INTO eventMembers(principal, resource, role) VALUES(?1, ?2, ?3)",
                params![principal, resource, role],
            )
            .expect("seat membership");
    }

    #[test]
    fn create_records_kind_owner_and_immutable_provenance() {
        let mut db = ready_database();
        seed_human(&db, "owner-1");
        create_agent(&mut db, "agent-1", Some("owner-1"));

        let (kind, owner, provenance, deactivated): (String, Option<String>, String, Option<i64>) =
            db.conn
                .query_row(
                    "SELECT kind, owner_user_id, registration_provenance, deactivated_at_ms
                     FROM _auth_users WHERE id = 'agent-1'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .expect("agent row");
        assert_eq!(kind, "agent");
        assert_eq!(owner.as_deref(), Some("owner-1"));
        assert!(provenance.contains("\"invitedBy\":\"users\""));
        assert_eq!(deactivated, None);
        assert_eq!(
            db.agent_owner("agent-1").unwrap().as_deref(),
            Some("owner-1")
        );
        assert!(!db.agent_is_deactivated("agent-1").unwrap());
    }

    #[test]
    fn deactivation_is_durable_permanent_and_closes_doors() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("app.sqlite");
        {
            let mut db = LocalDatabase::open(&path).expect("open db");
            db.activate_current_auth_catalog().expect("activate");
            create_agent(&mut db, "agent-1", None);
            // No memberships → deactivation strands nothing.
            db.deactivate_agent("agent-1", 100, &empty_manifest())
                .expect("deactivate");
            assert!(db.agent_is_deactivated("agent-1").unwrap());
            // Every door is closed fail-closed.
            let error = db.require_agent_not_deactivated("agent-1").unwrap_err();
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_AGENT_DEACTIVATED");
            // Permanent + idempotent: re-deactivating does not move the timestamp
            // and there is no reactivation path.
            db.deactivate_agent("agent-1", 999, &empty_manifest())
                .expect("idempotent redeactivate");
            let at: i64 = db
                .conn
                .query_row(
                    "SELECT deactivated_at_ms FROM _auth_users WHERE id = 'agent-1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(at, 100, "deactivation timestamp must not move");
        }
        // Survives restart: reopen the same file and the state is still terminal.
        let db = LocalDatabase::open(&path).expect("reopen db");
        assert!(db.agent_is_deactivated("agent-1").unwrap());
        assert!(
            db.require_agent_not_deactivated("agent-1").is_err(),
            "deactivation must survive restart"
        );
    }

    #[test]
    fn deactivation_refused_when_it_would_strand_the_sole_holder() {
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        seat(&db, "agent-a", "event-1", "host");

        let error = db
            .deactivate_agent("agent-a", 100, &manifest)
            .expect_err("sole holder deactivation must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert_eq!(
            error.diagnostic.details["resources"][0],
            "eventMembers:event-1"
        );
        // Refusal leaves the principal live.
        assert!(!db.agent_is_deactivated("agent-a").unwrap());
    }

    #[test]
    fn two_step_deactivation_schedule_cannot_strand_a_resource() {
        // The review-caught trap: a sole-holder check is defeated by deactivating
        // A (not sole) then B (now the last *eligible* holder). Eligibility, not
        // sole-ness, closes it.
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        create_agent(&mut db, "agent-b", None);
        seat(&db, "agent-a", "event-1", "host");
        seat(&db, "agent-b", "event-1", "host");

        // Deactivating A is allowed — B is still an eligible holder.
        db.deactivate_agent("agent-a", 100, &manifest)
            .expect("A is not the last eligible holder");
        assert!(db.agent_is_deactivated("agent-a").unwrap());

        // Deactivating B is refused — A is now ineligible, so B is the last
        // eligible holder and the resource would strand permanently.
        let error = db
            .deactivate_agent("agent-b", 200, &manifest)
            .expect_err("second-step deactivation must be refused");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert!(!db.agent_is_deactivated("agent-b").unwrap());
    }

    #[test]
    fn deactivation_allowed_while_another_eligible_holder_remains() {
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        create_agent(&mut db, "agent-b", None);
        seat(&db, "agent-a", "event-1", "host");
        seat(&db, "agent-b", "event-1", "host");

        db.deactivate_agent("agent-a", 100, &manifest)
            .expect("another eligible holder remains");
        assert!(db.agent_is_deactivated("agent-a").unwrap());
    }

    #[test]
    fn production_does_not_count_a_nonexistent_principal_as_a_surviving_holder() {
        let mut db = ready_database();
        let mut manifest = host_membership(&db);
        manifest.auth = Some(crate::manifest::AuthManifest {
            mode: AuthMode::Sessions,
            agents: None,
            password_identifier_mode: None,
            password_minimum_length: None,
        });
        create_agent(&mut db, "agent-a", None);
        seat(&db, "agent-a", "event-1", "host");
        seat(&db, "missing-agent", "event-1", "host");

        let error = db
            .deactivate_agent("agent-a", 100, &manifest)
            .expect_err("an absent catalog row is not durable recovery");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_AGENT_DEACTIVATION_WOULD_STRAND"
        );
        assert!(!db.agent_is_deactivated("agent-a").unwrap());
    }

    #[test]
    fn sessions_eligibility_requires_a_durable_human_provider_identity() {
        let mut db = ready_database();
        seed_human(&db, "human-1");
        assert!(
            !principal_is_eligible_on(&db.conn, "human-1", true).unwrap(),
            "a catalog row alone cannot prove that a human can authenticate"
        );

        db.conn
            .execute(
                "INSERT INTO _auth_identities(
                   id, user_id, kind, provider, subject, created_at_ms, verified_at_ms
                 ) VALUES('wrong-class', 'human-1', 'external', 'agent-credential', 'credential-x', 0, 0)",
                [],
            )
            .unwrap();
        assert!(
            !principal_is_eligible_on(&db.conn, "human-1", true).unwrap(),
            "an agent-credential identity cannot authenticate a human principal"
        );
        db.conn
            .execute("DELETE FROM _auth_identities WHERE id = 'wrong-class'", [])
            .unwrap();

        db.conn
            .execute(
                "INSERT INTO _auth_identities(
                   id, user_id, kind, provider, subject, canonical_value, created_at_ms, verified_at_ms
                 ) VALUES('identity-1', 'human-1', 'email', 'email-code', 'human@example.com', 'human@example.com', 0, 0)",
                [],
            )
            .unwrap();
        assert!(principal_is_eligible_on(&db.conn, "human-1", true).unwrap());

        create_agent(&mut db, "owned-agent", Some("human-1"));
        assert!(
            principal_is_eligible_on(&db.conn, "owned-agent", true).unwrap(),
            "a live owner's provider identity is the owned-agent recovery carrier"
        );

        db.conn
            .execute("DELETE FROM _auth_identities WHERE id = 'identity-1'", [])
            .unwrap();
        assert!(!principal_is_eligible_on(&db.conn, "human-1", true).unwrap());
        assert!(
            !principal_is_eligible_on(&db.conn, "owned-agent", true).unwrap(),
            "ownership without an authenticating owner identity is not durable recovery"
        );
    }

    #[test]
    fn deactivation_runs_the_shared_transaction_final_holder_evaluator() {
        let mut db = ready_database();
        let manifest = host_membership(&db);
        create_agent(&mut db, "agent-a", None);
        db.conn
            .execute("INSERT INTO events(_id) VALUES('already-unprotected')", [])
            .unwrap();

        let error = db
            .deactivate_agent("agent-a", 100, &manifest)
            .expect_err("transaction-final evaluator sees every live resource");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_MEMBERSHIP_LAST_HOLDER_STRAND"
        );
        assert!(
            !db.agent_is_deactivated("agent-a").unwrap(),
            "final-state refusal rolls the UPDATE back"
        );
    }

    #[test]
    fn deactivating_a_non_agent_or_unknown_principal_is_typed() {
        let mut db = ready_database();
        seed_human(&db, "human-1");
        for id in ["human-1", "nobody"] {
            let error = db
                .deactivate_agent(id, 100, &empty_manifest())
                .expect_err("non-agent must be refused");
            assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_AGENT_UNKNOWN");
        }
    }

    #[test]
    fn catalog_refuses_a_version_above_this_binary_understanding() {
        // Refuse-at-open: a fresh catalog is v4 and recognized; a marker naming a
        // higher version must fail closed rather than reopen "without agents".
        let db = ready_database();
        assert_eq!(
            db.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV4
        );
        assert_eq!(AUTH_CATALOG_VERSION, "4");
        db.conn
            .execute(
                "UPDATE _snapback_meta SET value = '5' WHERE key = 'auth_catalog_version'",
                [],
            )
            .expect("bump marker above understanding");
        let error = db
            .inspect_auth_catalog()
            .expect_err("a higher catalog version must be refused at open");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CATALOG_VERSION_UNSUPPORTED"
        );
    }
}
impl super::ServingDatabase {
    #[allow(clippy::too_many_arguments)]
    pub fn register_agent_principal_with_class(
        &mut self,
        invitation: Option<&CreationInvitation>,
        display_name: Option<String>,
        operator_contact: Option<String>,
        class: super::auth_integrations::AgentRegistrationClass,
        integration_facts: super::auth_integrations::IntegrationRegistrationFacts,
        profile: ServerProfile,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentCredential> {
        self.db.register_agent_principal_with_class(
            invitation,
            display_name,
            operator_contact,
            class,
            integration_facts,
            profile,
            now_ms,
            random,
        )
    }
    pub fn mint_agent_invitation(
        &mut self,
        user_id: &str,
        profile: ServerProfile,
        proof: &StepUpProof,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IssuedAgentInvitation> {
        self.db
            .mint_agent_invitation(user_id, profile, proof, now_ms, random)
    }
    pub fn mint_agent_invitation_guarded<G, BeforeCommit>(
        &mut self,
        user_id: &str,
        profile: ServerProfile,
        proof: &StepUpProof,
        now_ms: u64,
        random: &dyn RandomSource,
        before_commit: BeforeCommit,
    ) -> SnapbackResult<IssuedAgentInvitation>
    where
        BeforeCommit: FnOnce() -> SnapbackResult<G>,
    {
        self.db.mint_agent_invitation_guarded(
            user_id,
            profile,
            proof,
            now_ms,
            random,
            before_commit,
        )
    }
}
impl super::ServingDatabase {
    pub fn deactivate_agent(
        &mut self,
        user_id: &str,
        now_ms: u64,
        manifest: &SchemaManifest,
    ) -> SnapbackResult<()> {
        self.db.deactivate_agent(user_id, now_ms, manifest)
    }
}
