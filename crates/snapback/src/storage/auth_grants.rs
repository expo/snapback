//! Pairing-code consent and immutable delegated grants.
//!
//! @ref LLP 0055#grants — users mint single-use pairing codes; agents present
//!   closed scope requests; delegated tiers expand to exact function bases;
//!   approval atomically consumes the request and creates one immutable grant.

use super::LocalDatabase;
use super::auth_agent_credentials::{
    coalesce_credential_use, live_credential_by_hash, require_agent_active_on,
    require_agent_clock_on,
};
use crate::auth::crypto::{AgentCredential, PairingCode, RandomSource};
use crate::auth::crypto::{StepUpConsumption, StepUpProof, step_up_required_error};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::FunctionKind;
use crate::storage::auth::{AuthTransactionAttempt, ServiceAuthTransactionAttempt};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use subtle::ConstantTimeEq as _;

pub const PAIRING_CODE_TTL_MS: u64 = 10 * 60 * 1_000;
pub const PAIRING_CODE_LIVE_CAP_PER_USER: u64 = 10;
pub const PAIRING_CODE_ATTEMPT_LIMIT: u64 = 5;
pub const PAIRING_REQUEST_LIVE_CAP_PER_AGENT: u64 = 10;
pub const GRANT_LIVE_CAP_PER_ACTOR: u64 = 50;
pub const DELEGATED_GRANT_LIVE_CAP_PER_USER: u64 = 50;
pub const DELEGATED_GRANT_DEFAULT_TTL_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const DELEGATED_GRANT_MAX_TTL_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
pub const GRANT_SCOPE_ENTRY_CAP: usize = 128;
pub const GRANT_SCOPE_BYTES_CAP: usize = 16 * 1_024;
const OTHER_OWNER_AGENT_WARNING: &str = "You do not own this agent. Its owner can re-credential it and use memberships or roles that this grant creates for the agent.";
const UNOWNED_AGENT_WARNING: &str = "This agent is unowned. Where the deployment profile permits operator recovery, a replacement credential can use memberships or roles that this grant creates for the agent.";

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ScopedFunctionKind {
    Query,
    Mutation,
    LiveQuery,
    Action,
}

impl ScopedFunctionKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Mutation => "mutation",
            Self::LiveQuery => "liveQuery",
            Self::Action => "action",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "query" => Some(Self::Query),
            "mutation" => Some(Self::Mutation),
            "liveQuery" => Some(Self::LiveQuery),
            "action" => Some(Self::Action),
            _ => None,
        }
    }

    pub(crate) fn into_function_kind(self) -> FunctionKind {
        match self {
            Self::Query => FunctionKind::Query,
            Self::Mutation => FunctionKind::Mutation,
            Self::LiveQuery => FunctionKind::LiveQuery,
            Self::Action => FunctionKind::Action,
        }
    }

    pub(crate) fn from_function_kind(kind: &FunctionKind) -> Option<Self> {
        match kind {
            FunctionKind::Query => Some(Self::Query),
            FunctionKind::Mutation => Some(Self::Mutation),
            FunctionKind::LiveQuery => Some(Self::LiveQuery),
            FunctionKind::Action => Some(Self::Action),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GrantTier {
    Query,
    Mutation,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GrantSurface {
    Ask,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged, deny_unknown_fields)]
pub(crate) enum GrantScopeRequest {
    Exact {
        #[serde(rename = "fn")]
        function_id: String,
        kind: ScopedFunctionKind,
    },
    Tier {
        tier: GrantTier,
    },
    Surface {
        surface: GrantSurface,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExactGrantScope {
    #[serde(rename = "fn")]
    pub function_id: String,
    pub kind: ScopedFunctionKind,
    pub basis: u64,
    pub authority_creating: bool,
}

#[derive(Debug)]
pub(crate) struct MintedPairingCode {
    pub request_id: String,
    pub expires_at_ms: u64,
    pub secret: PairingCode,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingGrantRequest {
    pub request_id: String,
    pub effective_user_id: String,
    pub agent_user_id: String,
    pub agent_display_name: Option<String>,
    pub registration_provenance: String,
    pub owner_assumption: AgentOwnershipAssumption,
    pub owner_assumption_warning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_egress_disclosure: Option<String>,
    pub scopes: Vec<ExactGrantScope>,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentOwnershipAssumption {
    OwnedByGrantor,
    OwnedByAnotherUser,
    Unowned,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PairingPresentation {
    Created(PendingGrantRequest),
    Existing(PendingGrantRequest),
}

#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
enum PairingAttemptOutcome {
    Presented(PairingPresentation),
    Invalid,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovedGrant {
    pub grant_id: String,
    pub request_id: String,
    pub actor_user_id: String,
    pub effective_user_id: String,
    pub scopes: Vec<ExactGrantScope>,
    pub expires_at_ms: u64,
    pub consent_digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum GrantApproval {
    Created(ApprovedGrant),
    Existing(ApprovedGrant),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserGrant {
    pub grant_id: String,
    pub actor_user_id: String,
    pub scopes: Vec<ExactGrantScope>,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub revoked_at_ms: Option<u64>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct GrantRevocation {
    pub grant_id: String,
    pub token_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BulkGrantRevocation {
    pub grant_ids: Vec<String>,
    pub token_ids: Vec<String>,
}

impl LocalDatabase {
    /// Mint a short-lived, single-use consent secret for a human principal.
    /// The plaintext exists only in the returned wrapper.
    pub(crate) fn mint_pairing_code(
        &mut self,
        user_id: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<MintedPairingCode> {
        self.observe_agent_authorization_clock(now_ms)?;
        let expires_at_ms = now_ms
            .checked_add(PAIRING_CODE_TTL_MS)
            .filter(|expires_at_ms| *expires_at_ms <= super::MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(grant_state_corrupt)?;
        let secret = PairingCode::generate(random).map_err(|_| provider_unavailable())?;
        let hash = secret.token_hash();
        let request_id = crate::ids::mint_time_ordered(crate::ids::Kind::GrantRequest);
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            require_human_user_on(tx, user_id)?;
            sweep_pairing_requests_on(tx, now_ms)?;
            let live = count_on(
                tx,
                "SELECT COUNT(*) FROM _auth_pairing_requests
                 WHERE minted_by_user_id = ?1 AND consumed_at_ms IS NULL
                   AND expires_at_ms > ?2",
                params![user_id, now_ms as i64],
            )?;
            if live >= PAIRING_CODE_LIVE_CAP_PER_USER {
                return Err(pairing_code_cap());
            }
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES(?1, ?2, ?3, NULL, NULL, 'pending', 0, ?4, ?5, NULL, NULL)",
                params![
                    request_id,
                    hash.as_bytes(),
                    user_id,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            Ok(())
        })?;
        Ok(MintedPairingCode {
            request_id,
            expires_at_ms,
            secret,
        })
    }

    /// Consume a pairing code and bind its request to this exact live agent.
    /// Re-presenting the same code by the same agent with the same canonical
    /// scopes is idempotent; every other reuse is the same non-enumerating
    /// invalid outcome.
    pub(crate) fn present_pairing_code(
        &mut self,
        credential: &AgentCredential,
        pairing_request_id: &str,
        pairing_code: &PairingCode,
        requested_scopes: &[GrantScopeRequest],
        now_ms: u64,
    ) -> SnapbackResult<PairingPresentation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let credential_hash = credential.token_hash();
        let code_hash = pairing_code.token_hash();
        let outcome = self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let credential = live_credential_by_hash(tx, credential_hash.as_bytes())?
                .ok_or_else(agent_credential_invalid)?;
            require_agent_active_on(tx, &credential.user_id)?;
            // @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — suspension blocks the integration side of a new installation ceremony while leaving existing installations untouched.
            super::auth_integrations::require_active_if_integration_on(tx, &credential.user_id)?;
            coalesce_credential_use(tx, &credential.credential_id, now_ms)?;
            sweep_pairing_requests_on(tx, now_ms)?;
            let row = tx
                .query_row(
                    "SELECT code_hash, minted_by_user_id, agent_user_id,
                            requested_scopes, state, attempts, created_at_ms,
                            expires_at_ms, consumed_at_ms
                     FROM _auth_pairing_requests WHERE id = ?1",
                    params![pairing_request_id],
                    |row| {
                        Ok((
                            row.get::<_, Vec<u8>>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, i64>(5)?,
                            row.get::<_, i64>(6)?,
                            row.get::<_, i64>(7)?,
                            row.get::<_, Option<i64>>(8)?,
                        ))
                    },
                )
                .optional()?;
            let Some(row) = row else {
                constant_time_pairing_hash_match(&[0; 32], code_hash.as_bytes())?;
                record_failed_pairing_attempt_on(tx, pairing_request_id, now_ms)?;
                return Ok(PairingAttemptOutcome::Invalid);
            };
            let (
                stored_code_hash,
                effective_user_id,
                bound_agent,
                stored_scopes,
                state,
                attempts,
                created_at_ms,
                expires_at_ms,
                consumed_at_ms,
            ) = row;
            let attempts = u64::try_from(attempts).map_err(|_| grant_state_corrupt())?;
            let created_at_ms = u64::try_from(created_at_ms).map_err(|_| grant_state_corrupt())?;
            let expires_at_ms = u64::try_from(expires_at_ms).map_err(|_| grant_state_corrupt())?;
            let consumed_at_ms = consumed_at_ms
                .map(u64::try_from)
                .transpose()
                .map_err(|_| grant_state_corrupt())?;
            if attempts > PAIRING_CODE_ATTEMPT_LIMIT {
                return Err(grant_state_corrupt());
            }
            let code_matches =
                constant_time_pairing_hash_match(&stored_code_hash, code_hash.as_bytes())?;
            if !code_matches {
                record_failed_pairing_attempt_on(tx, pairing_request_id, now_ms)?;
                return Ok(PairingAttemptOutcome::Invalid);
            }
            if attempts >= PAIRING_CODE_ATTEMPT_LIMIT
                || expires_at_ms <= now_ms
                || state != "pending"
            {
                record_failed_pairing_attempt_on(tx, pairing_request_id, now_ms)?;
                return Ok(PairingAttemptOutcome::Invalid);
            }
            if let Some(bound_agent) = bound_agent.as_ref()
                && bound_agent != &credential.user_id
            {
                record_failed_pairing_attempt_on(tx, pairing_request_id, now_ms)?;
                return Ok(PairingAttemptOutcome::Invalid);
            }
            let scopes = resolve_delegated_scopes_on(tx, requested_scopes)?;
            let scopes_json = canonical_scopes_json(&scopes)?;
            let request = pending_request_on(
                tx,
                pairing_request_id,
                &effective_user_id,
                &credential.user_id,
                &scopes,
                created_at_ms,
                expires_at_ms,
            )?;
            if let (Some(bound_agent), Some(stored_scopes), Some(_)) =
                (bound_agent.as_ref(), stored_scopes.as_ref(), consumed_at_ms)
            {
                if bound_agent == &credential.user_id && stored_scopes == &scopes_json {
                    return Ok(PairingAttemptOutcome::Presented(
                        PairingPresentation::Existing(request),
                    ));
                }
                record_failed_pairing_attempt_on(tx, pairing_request_id, now_ms)?;
                return Ok(PairingAttemptOutcome::Invalid);
            }
            if bound_agent.is_some() || stored_scopes.is_some() || consumed_at_ms.is_some() {
                return Err(grant_state_corrupt());
            }
            let pending = count_on(
                tx,
                "SELECT COUNT(*) FROM _auth_pairing_requests
                 WHERE agent_user_id = ?1 AND state = 'pending'
                   AND expires_at_ms > ?2",
                params![credential.user_id, now_ms as i64],
            )?;
            if pending >= PAIRING_REQUEST_LIVE_CAP_PER_AGENT {
                return Err(pairing_request_cap());
            }
            let changed = tx.execute(
                "UPDATE _auth_pairing_requests
                 SET agent_user_id = ?1, requested_scopes = ?2,
                     consumed_at_ms = ?3
                 WHERE id = ?4 AND agent_user_id IS NULL
                   AND requested_scopes IS NULL AND consumed_at_ms IS NULL
                   AND state = 'pending' AND expires_at_ms > ?3",
                params![
                    credential.user_id,
                    scopes_json,
                    now_ms as i64,
                    pairing_request_id,
                ],
            )?;
            if changed != 1 {
                return Ok(PairingAttemptOutcome::Invalid);
            }
            Ok(PairingAttemptOutcome::Presented(
                PairingPresentation::Created(request),
            ))
        })?;
        match outcome {
            PairingAttemptOutcome::Presented(presentation) => Ok(presentation),
            PairingAttemptOutcome::Invalid => Err(grant_invalid()),
        }
    }

    /// Approve exactly one pending request. Retrying an already-approved
    /// request owned by the same user returns the immutable grant; a concurrent
    /// approval can never create a second row.
    pub(crate) fn approve_grant_request(
        &mut self,
        effective_user_id: &str,
        session_id: &str,
        request_id: &str,
        requested_ttl_ms: Option<u64>,
        step_up_proof: Option<&StepUpProof>,
        now_ms: u64,
    ) -> SnapbackResult<GrantApproval> {
        self.observe_agent_authorization_clock(now_ms)?;
        let ttl = requested_ttl_ms.unwrap_or(DELEGATED_GRANT_DEFAULT_TTL_MS);
        if ttl == 0 || ttl > DELEGATED_GRANT_MAX_TTL_MS {
            return Err(grant_expiry_invalid());
        }
        let grant_expires_at_ms = now_ms
            .checked_add(ttl)
            .filter(|expires_at_ms| *expires_at_ms <= super::MAX_AUTHORIZATION_EPOCH)
            .ok_or_else(grant_expiry_invalid)?;
        let grant_id_candidate = crate::ids::mint_time_ordered(crate::ids::Kind::Grant);
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            require_human_user_on(tx, effective_user_id)?;
            let request = approval_request_on(tx, request_id, effective_user_id, now_ms)?;
            if request.state == "approved" {
                let grant_id = request.grant_id.ok_or_else(grant_state_corrupt)?;
                let outcome = Ok(GrantApproval::Existing(load_approved_grant_on(
                    tx, &grant_id, request_id,
                )?));
                body_outcome = Some(outcome.clone());
                return Ok(outcome);
            }
            if request.state != "pending" || request.grant_id.is_some() {
                return Err(grant_invalid());
            }
            let actor_user_id = request.agent_user_id.ok_or_else(grant_invalid)?;
            require_agent_active_on(tx, &actor_user_id)?;
            // @ref LLP 0055#dated-amendment-llp-0204-integration-registrations-and-watch-anchors-2026-08-08 — suspension refuses the approval half of every new installation ceremony without revoking existing consent.
            super::auth_integrations::require_active_if_integration_on(tx, &actor_user_id)?;
            let scopes_json = request.requested_scopes.ok_or_else(grant_invalid)?;
            let scopes = parse_scopes_json(&scopes_json)?;
            // @ref LLP 0039#dated-amendment-operation-bound-step-up-2026-07-15
            // — verification/attempt accounting/consume and grant creation
            // share this transaction; no boolean trust seam survives.
            if scopes.iter().any(|scope| scope.authority_creating) {
                let Some(proof) = step_up_proof else {
                    body_outcome = Some(Err(()));
                    return Ok(Err(()));
                };
                if super::auth_catalog_ops::consume_step_up_proof_on(tx, proof, now_ms)?
                    != StepUpConsumption::Verified
                {
                    body_outcome = Some(Err(()));
                    return Ok(Err(()));
                }
            }
            require_scope_bases_current_on(tx, &scopes)?;
            enforce_grant_caps_on(tx, &actor_user_id, effective_user_id, now_ms)?;

            let agent = agent_consent_identity_on(tx, &actor_user_id)?;
            let (owner_assumption, owner_assumption_warning) =
                owner_assumption(&agent.2, effective_user_id);
            let expires_at_ms = grant_expires_at_ms;
            let consent_digest = consent_digest(
                &actor_user_id,
                agent.0.as_deref(),
                &agent.1,
                owner_assumption,
                owner_assumption_warning.as_deref(),
                &scopes,
                expires_at_ms,
            )?;
            let grant_id = grant_id_candidate.clone();
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, ?5)",
                params![
                    grant_id,
                    actor_user_id,
                    effective_user_id,
                    scopes_json,
                    now_ms as i64,
                    expires_at_ms as i64,
                    format!("session:{session_id}"),
                    request_id,
                    consent_digest.as_slice(),
                ],
            )?;
            let changed = tx.execute(
                "UPDATE _auth_pairing_requests SET state = 'approved', grant_id = ?1
                 WHERE id = ?2 AND minted_by_user_id = ?3
                   AND state = 'pending' AND grant_id IS NULL",
                params![grant_id, request_id, effective_user_id],
            )?;
            if changed != 1 {
                return Err(grant_invalid());
            }
            let outcome = Ok(GrantApproval::Created(ApprovedGrant {
                grant_id,
                request_id: request_id.to_owned(),
                actor_user_id,
                effective_user_id: effective_user_id.to_owned(),
                scopes,
                expires_at_ms,
                consent_digest,
            }));
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        let (attempt, inject_reconciliation_failure) =
            inject_grant_commit_uncertainty(attempt, request_id);
        match attempt {
            AuthTransactionAttempt::Committed(outcome) => {
                outcome.map_err(|()| step_up_required_error())
            }
            AuthTransactionAttempt::RolledBack(error) => Err(error),
            AuthTransactionAttempt::CommitUncertain(_commit_error) => match body_outcome {
                Some(Ok(GrantApproval::Existing(grant))) => {
                    // The existing branch performs no write, so a lost COMMIT
                    // acknowledgement cannot change its durable outcome.
                    Ok(GrantApproval::Existing(grant))
                }
                Some(Ok(GrantApproval::Created(expected))) => {
                    if inject_reconciliation_failure {
                        Err(grant_commit_uncertain())
                    } else {
                        self.with_auth_read(|connection| {
                            reconcile_created_grant_approval(
                                connection,
                                effective_user_id,
                                request_id,
                                &expected,
                                step_up_proof,
                            )
                        })
                        .map(GrantApproval::Created)
                        .map_err(|_| grant_commit_uncertain())
                    }
                }
                Some(Err(())) => {
                    let reconciled = self.with_auth_read(|connection| {
                        reconcile_rejected_grant_approval(
                            connection,
                            effective_user_id,
                            request_id,
                            step_up_proof,
                        )
                    });
                    match reconciled {
                        Ok(()) => Err(step_up_required_error()),
                        Err(_) => Err(grant_commit_uncertain()),
                    }
                }
                None => Err(grant_commit_uncertain()),
            },
        }
    }

    pub(crate) fn deny_grant_request(
        &mut self,
        effective_user_id: &str,
        request_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            let state = tx
                .query_row(
                    "SELECT state FROM _auth_pairing_requests
                     WHERE id = ?1 AND minted_by_user_id = ?2",
                    params![request_id, effective_user_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(grant_invalid)?;
            if state == "denied" {
                return Ok(());
            }
            if state != "pending" {
                return Err(grant_invalid());
            }
            tx.execute(
                "UPDATE _auth_pairing_requests SET state = 'denied'
                 WHERE id = ?1 AND minted_by_user_id = ?2 AND state = 'pending'",
                params![request_id, effective_user_id],
            )?;
            Ok(())
        })
    }

    pub(crate) fn pending_grant_requests(
        &mut self,
        effective_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<PendingGrantRequest>> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.with_auth_transaction(|tx| {
            require_agent_clock_on(tx, now_ms)?;
            require_human_user_on(tx, effective_user_id)?;
            sweep_pairing_requests_on(tx, now_ms)?;
            let mut statement = tx.prepare(
                "SELECT id, agent_user_id, requested_scopes, created_at_ms, expires_at_ms
                 FROM _auth_pairing_requests
                 WHERE minted_by_user_id = ?1 AND state = 'pending'
                   AND agent_user_id IS NOT NULL AND requested_scopes IS NOT NULL
                   AND consumed_at_ms IS NOT NULL AND expires_at_ms > ?2
                 ORDER BY created_at_ms, id",
            )?;
            let rows = statement.query_map(params![effective_user_id, now_ms as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?;
            let rows = rows.collect::<Result<Vec<_>, _>>()?;
            rows.into_iter()
                .map(
                    |(request_id, agent_user_id, scopes, created_at_ms, expires_at_ms)| {
                        pending_request_on(
                            tx,
                            &request_id,
                            effective_user_id,
                            &agent_user_id,
                            &parse_scopes_json(&scopes)?,
                            u64::try_from(created_at_ms).map_err(|_| grant_state_corrupt())?,
                            u64::try_from(expires_at_ms).map_err(|_| grant_state_corrupt())?,
                        )
                    },
                )
                .collect()
        })
    }

    pub(crate) fn grants_for_user(
        &mut self,
        effective_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<UserGrant>> {
        self.observe_agent_authorization_clock(now_ms)?;
        self.with_auth_read(|conn| {
            let mut statement = conn.prepare(
                "SELECT id, actor_user_id, scopes, created_at_ms, expires_at_ms, revoked_at_ms
                 FROM _auth_grants WHERE effective_user_id = ?1
                 ORDER BY created_at_ms, id",
            )?;
            let rows = statement.query_map(params![effective_user_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })?;
            rows.map(|row| {
                let (grant_id, actor_user_id, scopes, created_at_ms, expires_at_ms, revoked_at_ms) =
                    row?;
                Ok(UserGrant {
                    grant_id,
                    actor_user_id,
                    scopes: parse_scopes_json(&scopes)?,
                    created_at_ms: u64::try_from(created_at_ms)
                        .map_err(|_| grant_state_corrupt())?,
                    expires_at_ms: u64::try_from(expires_at_ms)
                        .map_err(|_| grant_state_corrupt())?,
                    revoked_at_ms: revoked_at_ms
                        .map(u64::try_from)
                        .transpose()
                        .map_err(|_| grant_state_corrupt())?,
                })
            })
            .collect()
        })
    }

    /// Read the exact token set that a later single-grant revocation must
    /// close before it enters the durable writer lane. The mutation replans
    /// the same query inside its transaction and the process interlock
    /// refuses a mismatch.
    pub(crate) fn plan_grant_revocation_service_terminal(
        &self,
        effective_user_id: &str,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_grant_revocation_token_ids(connection, effective_user_id, grant_id, now_ms)
        })
    }

    /// Read the exact token set affected by a later revoke-by-actor write.
    pub(crate) fn plan_bulk_grant_revocation_service_terminal(
        &self,
        effective_user_id: &str,
        actor_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<Vec<String>> {
        self.with_auth_read(|connection| {
            planned_bulk_grant_revocation_token_ids(
                connection,
                effective_user_id,
                actor_user_id,
                now_ms,
            )
        })
    }

    pub(crate) fn revoke_grant_for_user(
        &mut self,
        effective_user_id: &str,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<GrantRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| planned_grant_revocation_token_ids(tx, effective_user_id, grant_id, now_ms),
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let revoked_at_ms = tx
                    .query_row(
                        "SELECT revoked_at_ms FROM _auth_grants
                     WHERE id = ?1 AND effective_user_id = ?2",
                        params![grant_id, effective_user_id],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .optional()?
                    .ok_or_else(grant_invalid)?;
                if revoked_at_ms.is_some() {
                    body_outcome = Some(GrantRevocation {
                        grant_id: grant_id.to_owned(),
                        token_ids: Vec::new(),
                    });
                    return Ok(());
                }
                let mut statement = tx.prepare(
                    "SELECT id FROM _auth_grant_tokens
                 WHERE grant_id = ?1 AND revoked_at_ms IS NULL ORDER BY id",
                )?;
                let token_ids = statement
                    .query_map(params![grant_id], |row| row.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                drop(statement);
                tx.execute(
                    "UPDATE _auth_grants SET revoked_at_ms = ?1
                 WHERE id = ?2 AND effective_user_id = ?3 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, grant_id, effective_user_id],
                )?;
                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                 WHERE grant_id = ?2 AND revoked_at_ms IS NULL",
                    params![now_ms as i64, grant_id],
                )?;
                super::watches::mark_watches_dead_for_grant_on(tx, grant_id, now_ms)?;
                body_outcome = Some(GrantRevocation {
                    grant_id: grant_id.to_owned(),
                    token_ids: token_ids.clone(),
                });
                Ok(())
            },
        );
        let attempt =
            inject_grant_revocation_service_commit_uncertainty(attempt, "single", grant_id);
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(grant_revocation_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(grant_revocation_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_grant_revocation(connection, effective_user_id, expected)
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(grant_revocation_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    grant_revocation_is_predecessor(connection, effective_user_id, expected)
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(grant_revocation_commit_uncertain())
            }
        }
    }

    /// Revoke every live grant from one effective user to one actor. The
    /// effective-user predicate is repeated in every read and write so an
    /// actor id learned elsewhere cannot become a cross-user revocation or
    /// enumeration oracle.
    ///
    /// @ref LLP 0055#ending-authority-revocation-expiry-deactivation — bulk
    /// revoke-by-actor ends every grant from this user without disturbing the
    /// user's own session.
    pub(crate) fn revoke_grants_by_actor_for_user(
        &mut self,
        effective_user_id: &str,
        actor_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<BulkGrantRevocation> {
        self.observe_agent_authorization_clock(now_ms)?;
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction_with_service_terminal(
            crate::auth::service_authority_contract::ServiceAuthorityDisposition::DurableDelete,
            |tx| {
                planned_bulk_grant_revocation_token_ids(
                    tx,
                    effective_user_id,
                    actor_user_id,
                    now_ms,
                )
            },
            |tx| {
                require_agent_clock_on(tx, now_ms)?;
                let mut grant_statement = tx.prepare(
                    "SELECT id FROM _auth_grants
                 WHERE effective_user_id = ?1 AND actor_user_id = ?2
                   AND revoked_at_ms IS NULL
                 ORDER BY id",
                )?;
                let grant_ids = grant_statement
                    .query_map(params![effective_user_id, actor_user_id], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                drop(grant_statement);

                let mut token_statement = tx.prepare(
                    "SELECT tokens.id
                 FROM _auth_grant_tokens AS tokens
                 JOIN _auth_grants AS grants ON grants.id = tokens.grant_id
                 WHERE grants.effective_user_id = ?1
                   AND grants.actor_user_id = ?2
                   AND grants.revoked_at_ms IS NULL
                   AND tokens.revoked_at_ms IS NULL
                 ORDER BY tokens.id",
                )?;
                let token_ids = token_statement
                    .query_map(params![effective_user_id, actor_user_id], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                drop(token_statement);

                tx.execute(
                    "UPDATE _auth_grant_tokens SET revoked_at_ms = ?1
                 WHERE revoked_at_ms IS NULL AND grant_id IN (
                   SELECT id FROM _auth_grants
                   WHERE effective_user_id = ?2 AND actor_user_id = ?3
                     AND revoked_at_ms IS NULL
                 )",
                    params![now_ms as i64, effective_user_id, actor_user_id],
                )?;
                tx.execute(
                    "UPDATE _auth_grants SET revoked_at_ms = ?1
                 WHERE effective_user_id = ?2 AND actor_user_id = ?3
                   AND revoked_at_ms IS NULL",
                    params![now_ms as i64, effective_user_id, actor_user_id],
                )?;
                for grant_id in &grant_ids {
                    super::watches::mark_watches_dead_for_grant_on(tx, grant_id, now_ms)?;
                }
                body_outcome = Some(BulkGrantRevocation {
                    grant_ids,
                    token_ids: token_ids.clone(),
                });
                Ok(())
            },
        );
        let operation_key = format!("{effective_user_id}\0{actor_user_id}");
        let attempt =
            inject_grant_revocation_service_commit_uncertainty(attempt, "bulk", &operation_key);
        match attempt {
            ServiceAuthTransactionAttempt::Committed(()) => {
                body_outcome.ok_or_else(grant_revocation_commit_uncertain)
            }
            ServiceAuthTransactionAttempt::RolledBack(error) => Err(error),
            ServiceAuthTransactionAttempt::CommitUncertain { error, terminal } => {
                let expected = body_outcome
                    .as_ref()
                    .ok_or_else(grant_revocation_commit_uncertain)?;
                let successor = self.with_auth_read(|connection| {
                    reconcile_bulk_grant_revocation(
                        connection,
                        effective_user_id,
                        actor_user_id,
                        expected,
                    )
                });
                if successor.is_ok() {
                    self.reconcile_ambiguous_service_terminal(terminal, true)?;
                    return body_outcome.ok_or_else(grant_revocation_commit_uncertain);
                }
                if self.with_auth_read(|connection| {
                    bulk_grant_revocation_is_predecessor(
                        connection,
                        effective_user_id,
                        actor_user_id,
                        expected,
                    )
                })? {
                    self.reconcile_ambiguous_service_terminal(terminal, false)?;
                    return Err(error);
                }
                Err(grant_revocation_commit_uncertain())
            }
        }
    }
}

fn planned_grant_revocation_token_ids(
    connection: &Connection,
    effective_user_id: &str,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let revoked_at_ms = connection
        .query_row(
            "SELECT revoked_at_ms FROM _auth_grants
             WHERE id = ?1 AND effective_user_id = ?2",
            params![grant_id, effective_user_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .ok_or_else(grant_invalid)?;
    if revoked_at_ms.is_some() {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "SELECT id FROM _auth_grant_tokens
         WHERE grant_id = ?1 ORDER BY id",
    )?;
    Ok(statement
        .query_map(params![grant_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn planned_bulk_grant_revocation_token_ids(
    connection: &Connection,
    effective_user_id: &str,
    actor_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<Vec<String>> {
    require_agent_clock_on(connection, now_ms)?;
    let mut statement = connection.prepare(
        "SELECT tokens.id
         FROM _auth_grant_tokens AS tokens
         JOIN _auth_grants AS grants ON grants.id = tokens.grant_id
         WHERE grants.effective_user_id = ?1
           AND grants.actor_user_id = ?2
           AND grants.revoked_at_ms IS NULL
         ORDER BY tokens.id",
    )?;
    Ok(statement
        .query_map(params![effective_user_id, actor_user_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

struct ApprovalRequestRow {
    agent_user_id: Option<String>,
    requested_scopes: Option<String>,
    state: String,
    expires_at_ms: u64,
    grant_id: Option<String>,
}

fn approval_request_on(
    tx: &Transaction<'_>,
    request_id: &str,
    effective_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<ApprovalRequestRow> {
    let row = tx
        .query_row(
            "SELECT agent_user_id, requested_scopes, state, expires_at_ms, grant_id
             FROM _auth_pairing_requests
             WHERE id = ?1 AND minted_by_user_id = ?2",
            params![request_id, effective_user_id],
            |row| {
                Ok(ApprovalRequestRow {
                    agent_user_id: row.get(0)?,
                    requested_scopes: row.get(1)?,
                    state: row.get(2)?,
                    expires_at_ms: row.get::<_, i64>(3)? as u64,
                    grant_id: row.get(4)?,
                })
            },
        )
        .optional()?
        .ok_or_else(grant_invalid)?;
    if row.state == "pending" && row.expires_at_ms <= now_ms {
        return Err(grant_invalid());
    }
    Ok(row)
}

pub(super) fn resolve_delegated_scopes_on(
    tx: &Transaction<'_>,
    requested: &[GrantScopeRequest],
) -> SnapbackResult<Vec<ExactGrantScope>> {
    if requested.is_empty() || requested.len() > GRANT_SCOPE_ENTRY_CAP {
        return Err(grant_scope_invalid());
    }
    let mut scopes = BTreeSet::new();
    for request in requested {
        match request {
            GrantScopeRequest::Exact { function_id, kind } => {
                let scope =
                    exact_scope_on(tx, function_id, *kind)?.ok_or_else(grant_scope_invalid)?;
                scopes.insert(scope);
            }
            GrantScopeRequest::Tier { tier } => {
                let kinds: &[&str] = match tier {
                    GrantTier::Query => &["query", "liveQuery"],
                    GrantTier::Mutation => &["mutation"],
                };
                for kind in kinds {
                    let mut statement = tx.prepare(
                        "SELECT function_id, kind, generation
                         FROM _auth_scope_bases
                         WHERE present = 1 AND authority_creating = 0 AND kind = ?1
                         ORDER BY function_id",
                    )?;
                    let rows = statement.query_map(params![kind], |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    })?;
                    for row in rows {
                        let (function_id, stored_kind, basis) = row?;
                        if basis < 0 {
                            return Err(grant_state_corrupt());
                        }
                        scopes.insert(ExactGrantScope {
                            function_id,
                            kind: ScopedFunctionKind::parse(&stored_kind)
                                .ok_or_else(grant_state_corrupt)?,
                            basis: basis as u64,
                            authority_creating: false,
                        });
                    }
                }
            }
            GrantScopeRequest::Surface {
                surface: GrantSurface::Ask,
            } => {
                let scope = exact_scope_on(
                    tx,
                    super::auth_scope_bases::ASK_SCOPE_ID,
                    ScopedFunctionKind::Query,
                )?
                .ok_or_else(grant_scope_invalid)?;
                scopes.insert(scope);
            }
        }
    }
    if scopes.is_empty() || scopes.len() > GRANT_SCOPE_ENTRY_CAP {
        return Err(grant_scope_invalid());
    }
    Ok(scopes.into_iter().collect())
}

pub(super) fn resolve_exact_function_names_on(
    tx: &Transaction<'_>,
    app_id: &str,
    function_names: &[String],
) -> SnapbackResult<Vec<ExactGrantScope>> {
    if function_names.is_empty() || function_names.len() > GRANT_SCOPE_ENTRY_CAP {
        return Err(grant_scope_invalid());
    }
    let mut scopes = BTreeSet::new();
    for function_name in function_names {
        let generated_id = format!("{app_id}:{function_name}");
        let constructor_id = format!("fn:{function_name}");
        let row = tx
            .query_row(
                "SELECT function_id, kind, generation, authority_creating
                 FROM _auth_scope_bases
                 WHERE function_id IN (?1, ?2, ?3) AND present = 1
                 ORDER BY CASE function_id WHEN ?1 THEN 0 WHEN ?2 THEN 1 ELSE 2 END
                 LIMIT 1",
                params![function_name, generated_id, constructor_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(grant_scope_invalid)?;
        if row.2 < 0 || !matches!(row.3, 0 | 1) {
            return Err(grant_state_corrupt());
        }
        scopes.insert(ExactGrantScope {
            function_id: row.0,
            kind: ScopedFunctionKind::parse(&row.1).ok_or_else(grant_state_corrupt)?,
            basis: row.2 as u64,
            authority_creating: row.3 == 1,
        });
    }
    Ok(scopes.into_iter().collect())
}

fn exact_scope_on(
    tx: &Transaction<'_>,
    function_id: &str,
    kind: ScopedFunctionKind,
) -> SnapbackResult<Option<ExactGrantScope>> {
    if function_id.is_empty() {
        return Ok(None);
    }
    tx.query_row(
        "SELECT generation, authority_creating FROM _auth_scope_bases
         WHERE function_id = ?1 AND kind = ?2 AND present = 1",
        params![function_id, kind.as_str()],
        |row| {
            let basis = row.get::<_, i64>(0)?;
            let authority_creating = row.get::<_, i64>(1)?;
            Ok((basis, authority_creating))
        },
    )
    .optional()?
    .map(|(basis, authority_creating)| {
        if basis < 0 || !matches!(authority_creating, 0 | 1) {
            return Err(grant_state_corrupt());
        }
        Ok(ExactGrantScope {
            function_id: function_id.to_owned(),
            kind,
            basis: basis as u64,
            authority_creating: authority_creating == 1,
        })
    })
    .transpose()
}

fn require_scope_bases_current_on(
    tx: &Transaction<'_>,
    scopes: &[ExactGrantScope],
) -> SnapbackResult<()> {
    for scope in scopes {
        let current = exact_scope_on(tx, &scope.function_id, scope.kind)?;
        if current.as_ref() != Some(scope) {
            return Err(grant_scope_stale());
        }
    }
    Ok(())
}

pub(super) fn canonical_scopes_json(scopes: &[ExactGrantScope]) -> SnapbackResult<String> {
    let encoded = serde_json::to_string(scopes).map_err(|_| grant_state_corrupt())?;
    if encoded.len() > GRANT_SCOPE_BYTES_CAP {
        return Err(grant_scope_invalid());
    }
    Ok(encoded)
}

fn constant_time_pairing_hash_match(stored: &[u8], presented: &[u8]) -> SnapbackResult<bool> {
    let matches = bool::from(stored.ct_eq(presented));
    if stored.len() != 32 || presented.len() != 32 {
        Err(grant_state_corrupt())
    } else {
        Ok(matches)
    }
}

fn record_failed_pairing_attempt_on(
    tx: &Transaction<'_>,
    pairing_request_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    tx.execute(
        "UPDATE _auth_pairing_requests SET attempts = attempts + 1
         WHERE id = ?1 AND state = 'pending' AND expires_at_ms > ?2
           AND consumed_at_ms IS NULL AND attempts < ?3",
        params![
            pairing_request_id,
            now_ms as i64,
            PAIRING_CODE_ATTEMPT_LIMIT as i64,
        ],
    )?;
    Ok(())
}

pub(super) fn parse_scopes_json(encoded: &str) -> SnapbackResult<Vec<ExactGrantScope>> {
    let scopes: Vec<ExactGrantScope> =
        serde_json::from_str(encoded).map_err(|_| grant_state_corrupt())?;
    if scopes.is_empty()
        || scopes.len() > GRANT_SCOPE_ENTRY_CAP
        || canonical_scopes_json(&scopes)? != encoded
    {
        return Err(grant_state_corrupt());
    }
    Ok(scopes)
}

/// Resolve the still-live entries of an immutable grant against the durable
/// scope-basis tombstones. A stale entry is terminally invalid but does not
/// erase unrelated entries from the same grant.
///
/// @ref LLP 0055#grants — scope basis generations prevent remove/re-add ABA;
///   the tombstone is consulted again when authority is exercised, not only
///   when a token is minted.
pub(super) fn current_grant_scopes_on(
    tx: &Transaction<'_>,
    encoded: &str,
) -> SnapbackResult<Vec<ExactGrantScope>> {
    let mut scopes = parse_scopes_json(encoded)?;
    let mut current = Vec::with_capacity(scopes.len());
    for scope in scopes.drain(..) {
        if exact_scope_on(tx, &scope.function_id, scope.kind)?.as_ref() == Some(&scope) {
            current.push(scope);
        }
    }
    Ok(current)
}

fn pending_request_on(
    tx: &Transaction<'_>,
    request_id: &str,
    effective_user_id: &str,
    agent_user_id: &str,
    scopes: &[ExactGrantScope],
    created_at_ms: u64,
    expires_at_ms: u64,
) -> SnapbackResult<PendingGrantRequest> {
    let (display_name, provenance, owner_user_id) = agent_consent_identity_on(tx, agent_user_id)?;
    let (owner_assumption, owner_assumption_warning) =
        owner_assumption(&owner_user_id, effective_user_id);
    let data_egress_disclosure = scopes
        .iter()
        .any(|scope| scope.function_id == super::auth_scope_bases::ASK_SCOPE_ID)
        .then(|| {
            "Allows application data returned by separately granted query scopes to be sent to the app-declared third-party model provider; call receipts are provenance, not proof of answer derivation."
                .to_owned()
        });
    Ok(PendingGrantRequest {
        request_id: request_id.to_owned(),
        effective_user_id: effective_user_id.to_owned(),
        agent_user_id: agent_user_id.to_owned(),
        agent_display_name: display_name,
        registration_provenance: provenance,
        owner_assumption,
        owner_assumption_warning,
        data_egress_disclosure,
        scopes: scopes.to_vec(),
        created_at_ms,
        expires_at_ms,
    })
}

fn agent_consent_identity_on(
    tx: &Transaction<'_>,
    agent_user_id: &str,
) -> SnapbackResult<(Option<String>, String, Option<String>)> {
    tx.query_row(
        "SELECT display_name, registration_provenance, owner_user_id FROM _auth_users
         WHERE id = ?1 AND kind = 'agent' AND deactivated_at_ms IS NULL",
        params![agent_user_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()?
    .ok_or_else(grant_invalid)
}

/// Consent must disclose that a grantor who does not own the agent cannot
/// prevent its owner/operator from replacing the credential and ending the
/// delegation.
///
/// @ref LLP 0055#re-credentialing-recovery-and-the-production-profile-invariant
///   — ownership and re-credentialing have authorization consequences.
fn owner_assumption(
    owner_user_id: &Option<String>,
    effective_user_id: &str,
) -> (AgentOwnershipAssumption, Option<String>) {
    match owner_user_id.as_deref() {
        Some(owner_user_id) if owner_user_id == effective_user_id => {
            (AgentOwnershipAssumption::OwnedByGrantor, None)
        }
        Some(_) => (
            AgentOwnershipAssumption::OwnedByAnotherUser,
            Some(OTHER_OWNER_AGENT_WARNING.to_owned()),
        ),
        None => (
            AgentOwnershipAssumption::Unowned,
            Some(UNOWNED_AGENT_WARNING.to_owned()),
        ),
    }
}

fn consent_digest(
    agent_user_id: &str,
    display_name: Option<&str>,
    provenance: &str,
    owner_assumption: AgentOwnershipAssumption,
    owner_assumption_warning: Option<&str>,
    scopes: &[ExactGrantScope],
    expires_at_ms: u64,
) -> SnapbackResult<[u8; 32]> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Consent<'a> {
        agent_user_id: &'a str,
        display_name: Option<&'a str>,
        registration_provenance: &'a str,
        owner_assumption: AgentOwnershipAssumption,
        owner_assumption_warning: Option<&'a str>,
        scopes: &'a [ExactGrantScope],
        expires_at_ms: u64,
    }
    let encoded = serde_json::to_vec(&Consent {
        agent_user_id,
        display_name,
        registration_provenance: provenance,
        owner_assumption,
        owner_assumption_warning,
        scopes,
        expires_at_ms,
    })
    .map_err(|_| grant_state_corrupt())?;
    Ok(Sha256::digest(encoded).into())
}

fn enforce_grant_caps_on(
    tx: &Transaction<'_>,
    actor_user_id: &str,
    effective_user_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let actor = count_on(
        tx,
        "SELECT COUNT(*) FROM _auth_grants
         WHERE actor_user_id = ?1 AND revoked_at_ms IS NULL
           AND (expires_at_ms IS NULL OR expires_at_ms > ?2)",
        params![actor_user_id, now_ms as i64],
    )?;
    let effective = count_on(
        tx,
        "SELECT COUNT(*) FROM _auth_grants
         WHERE effective_user_id = ?1 AND revoked_at_ms IS NULL
           AND expires_at_ms > ?2",
        params![effective_user_id, now_ms as i64],
    )?;
    if actor >= GRANT_LIVE_CAP_PER_ACTOR || effective >= DELEGATED_GRANT_LIVE_CAP_PER_USER {
        Err(grant_cap())
    } else {
        Ok(())
    }
}

fn load_approved_grant_on(
    tx: &Connection,
    grant_id: &str,
    request_id: &str,
) -> SnapbackResult<ApprovedGrant> {
    tx.query_row(
        "SELECT actor_user_id, effective_user_id, scopes, expires_at_ms,
                consent_digest
         FROM _auth_grants WHERE id = ?1 AND request_id = ?2",
        params![grant_id, request_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? as u64,
                row.get::<_, Vec<u8>>(4)?,
            ))
        },
    )
    .optional()?
    .ok_or_else(grant_state_corrupt)
    .and_then(
        |(actor_user_id, effective_user_id, scopes, expires_at_ms, digest)| {
            let consent_digest: [u8; 32] = digest.try_into().map_err(|_| grant_state_corrupt())?;
            Ok(ApprovedGrant {
                grant_id: grant_id.to_owned(),
                request_id: request_id.to_owned(),
                actor_user_id,
                effective_user_id,
                scopes: parse_scopes_json(&scopes)?,
                expires_at_ms,
                consent_digest,
            })
        },
    )
}

fn sweep_pairing_requests_on(tx: &Transaction<'_>, now_ms: u64) -> SnapbackResult<()> {
    tx.execute(
        "DELETE FROM _auth_pairing_requests
         WHERE expires_at_ms <= ?1 AND grant_id IS NULL",
        params![now_ms as i64],
    )?;
    Ok(())
}

fn require_human_user_on(tx: &Transaction<'_>, user_id: &str) -> SnapbackResult<()> {
    let exists = tx
        .query_row(
            "SELECT 1 FROM _auth_users WHERE id = ?1 AND kind = 'human'",
            params![user_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists { Ok(()) } else { Err(grant_invalid()) }
}

fn count_on<P: rusqlite::Params>(
    tx: &Transaction<'_>,
    sql: &str,
    params: P,
) -> SnapbackResult<u64> {
    let count: i64 = tx.query_row(sql, params, |row| row.get(0))?;
    if count < 0 {
        Err(grant_state_corrupt())
    } else {
        Ok(count as u64)
    }
}

fn grant_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_INVALID",
        "auth",
        "agent grant is invalid",
    )
}

fn agent_credential_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_AGENT_CREDENTIAL_INVALID",
        "auth",
        "agent credential is invalid",
    )
}

fn grant_scope_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_SCOPE_INVALID",
        "auth",
        "requested grant scopes are invalid",
    )
}

fn grant_scope_stale() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_SCOPE_STALE",
        "auth",
        "requested grant scopes changed before consent",
    )
}

fn grant_cap() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_CAP",
        "auth",
        "live grant capacity is exhausted",
    )
}

fn pairing_code_cap() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PAIRING_CODE_CAP",
        "auth",
        "live pairing-code capacity is exhausted",
    )
}

fn pairing_request_cap() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PAIRING_REQUEST_CAP",
        "auth",
        "pending pairing-request capacity is exhausted",
    )
}

fn reconcile_created_grant_approval(
    connection: &rusqlite::Connection,
    effective_user_id: &str,
    request_id: &str,
    expected: &ApprovedGrant,
    proof: Option<&StepUpProof>,
) -> SnapbackResult<ApprovedGrant> {
    let request = connection
        .query_row(
            "SELECT state, grant_id FROM _auth_pairing_requests
             WHERE id = ?1 AND minted_by_user_id = ?2",
            params![request_id, effective_user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    if request.as_ref() != Some(&("approved".to_owned(), Some(expected.grant_id.clone()))) {
        return Err(grant_commit_uncertain());
    }
    if let Some(proof) = proof
        && !super::auth_catalog_ops::reconcile_step_up_consumed_on(connection, proof)?
    {
        return Err(grant_commit_uncertain());
    }
    let durable = load_approved_grant_on(connection, &expected.grant_id, request_id)?;
    if &durable != expected || durable.effective_user_id != effective_user_id {
        return Err(grant_commit_uncertain());
    }
    Ok(durable)
}

fn reconcile_rejected_grant_approval(
    connection: &rusqlite::Connection,
    effective_user_id: &str,
    request_id: &str,
    proof: Option<&StepUpProof>,
) -> SnapbackResult<()> {
    let request = connection
        .query_row(
            "SELECT state, grant_id FROM _auth_pairing_requests
             WHERE id = ?1 AND minted_by_user_id = ?2",
            params![request_id, effective_user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    if request != Some(("pending".to_owned(), None)) {
        return Err(grant_commit_uncertain());
    }
    if let Some(proof) = proof
        && !super::auth_catalog_ops::reconcile_step_up_unconsumed_on(connection, proof)?
    {
        return Err(grant_commit_uncertain());
    }
    Ok(())
}

fn reconcile_grant_revocation(
    connection: &Connection,
    effective_user_id: &str,
    expected: &GrantRevocation,
) -> SnapbackResult<()> {
    let revoked = connection
        .query_row(
            "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants
             WHERE id = ?1 AND effective_user_id = ?2",
            params![expected.grant_id, effective_user_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?;
    if revoked != Some(true) {
        return Err(grant_revocation_commit_uncertain());
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens
                 WHERE id = ?1 AND grant_id = ?2",
                params![token_id, expected.grant_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(grant_revocation_commit_uncertain());
        }
    }
    let live_tokens: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grant_tokens
         WHERE grant_id = ?1 AND revoked_at_ms IS NULL",
        params![expected.grant_id],
        |row| row.get(0),
    )?;
    if live_tokens != 0 {
        return Err(grant_revocation_commit_uncertain());
    }
    Ok(())
}

fn grant_revocation_is_predecessor(
    connection: &Connection,
    effective_user_id: &str,
    expected: &GrantRevocation,
) -> SnapbackResult<bool> {
    let grant_revoked = connection
        .query_row(
            "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants
             WHERE id = ?1 AND effective_user_id = ?2",
            params![expected.grant_id, effective_user_id],
            |row| row.get::<_, bool>(0),
        )
        .optional()?;
    if grant_revoked != Some(false) {
        return Ok(false);
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grant_tokens
                 WHERE id = ?1 AND grant_id = ?2",
                params![token_id, expected.grant_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn reconcile_bulk_grant_revocation(
    connection: &Connection,
    effective_user_id: &str,
    actor_user_id: &str,
    expected: &BulkGrantRevocation,
) -> SnapbackResult<()> {
    for grant_id in &expected.grant_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants
                 WHERE id = ?1 AND effective_user_id = ?2 AND actor_user_id = ?3",
                params![grant_id, effective_user_id, actor_user_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(grant_revocation_commit_uncertain());
        }
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT tokens.revoked_at_ms IS NOT NULL
                 FROM _auth_grant_tokens AS tokens
                 JOIN _auth_grants AS grants ON grants.id = tokens.grant_id
                 WHERE tokens.id = ?1 AND grants.effective_user_id = ?2
                   AND grants.actor_user_id = ?3",
                params![token_id, effective_user_id, actor_user_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(true) {
            return Err(grant_revocation_commit_uncertain());
        }
    }
    let live_grants: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grants
         WHERE effective_user_id = ?1 AND actor_user_id = ?2
           AND revoked_at_ms IS NULL",
        params![effective_user_id, actor_user_id],
        |row| row.get(0),
    )?;
    let live_tokens: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_grant_tokens AS tokens
         JOIN _auth_grants AS grants ON grants.id = tokens.grant_id
         WHERE grants.effective_user_id = ?1 AND grants.actor_user_id = ?2
           AND tokens.revoked_at_ms IS NULL",
        params![effective_user_id, actor_user_id],
        |row| row.get(0),
    )?;
    if live_grants != 0 || live_tokens != 0 {
        return Err(grant_revocation_commit_uncertain());
    }
    Ok(())
}

fn bulk_grant_revocation_is_predecessor(
    connection: &Connection,
    effective_user_id: &str,
    actor_user_id: &str,
    expected: &BulkGrantRevocation,
) -> SnapbackResult<bool> {
    for grant_id in &expected.grant_ids {
        let revoked = connection
            .query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_grants
                 WHERE id = ?1 AND effective_user_id = ?2 AND actor_user_id = ?3",
                params![grant_id, effective_user_id, actor_user_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    for token_id in &expected.token_ids {
        let revoked = connection
            .query_row(
                "SELECT tokens.revoked_at_ms IS NOT NULL
                 FROM _auth_grant_tokens AS tokens
                 JOIN _auth_grants AS grants ON grants.id = tokens.grant_id
                 WHERE tokens.id = ?1 AND grants.effective_user_id = ?2
                   AND grants.actor_user_id = ?3",
                params![token_id, effective_user_id, actor_user_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?;
        if revoked != Some(false) {
            return Ok(false);
        }
    }
    Ok(!expected.grant_ids.is_empty() || !expected.token_ids.is_empty())
}

#[cfg(test)]
static INJECT_GRANT_REVOCATION_COMMIT_UNCERTAIN: std::sync::Mutex<Option<(String, String)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) fn inject_next_grant_revocation_commit_uncertain(operation: &str, key: &str) {
    *INJECT_GRANT_REVOCATION_COMMIT_UNCERTAIN
        .lock()
        .expect("grant revocation commit uncertainty injector lock") =
        Some((operation.to_owned(), key.to_owned()));
}

fn inject_grant_revocation_commit_uncertainty<T>(
    attempt: AuthTransactionAttempt<T>,
    _operation: &str,
    _key: &str,
) -> AuthTransactionAttempt<T> {
    #[cfg(test)]
    {
        let should_inject = {
            let mut target = INJECT_GRANT_REVOCATION_COMMIT_UNCERTAIN
                .lock()
                .expect("grant revocation commit uncertainty injector lock");
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
                        "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
                        "auth",
                        "grant revocation commit acknowledgement was unavailable",
                    ))
                }
                other => other,
            };
        }
    }
    attempt
}

fn inject_grant_revocation_service_commit_uncertainty<T>(
    attempt: ServiceAuthTransactionAttempt<T>,
    _operation: &str,
    _key: &str,
) -> ServiceAuthTransactionAttempt<T> {
    #[cfg(test)]
    {
        let should_inject = {
            let mut target = INJECT_GRANT_REVOCATION_COMMIT_UNCERTAIN
                .lock()
                .expect("grant revocation commit uncertainty injector lock");
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
                            "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
                            "auth",
                            "grant revocation commit acknowledgement was unavailable",
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

fn grant_revocation_commit_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
        "auth",
        "grant revocation outcome could not be reconciled",
    )
}

#[cfg(test)]
static INJECT_GRANT_COMMIT_UNCERTAIN: std::sync::Mutex<Option<(String, bool)>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) fn inject_next_grant_commit_uncertain(request_id: &str) {
    *INJECT_GRANT_COMMIT_UNCERTAIN
        .lock()
        .expect("grant commit uncertainty injector lock") = Some((request_id.to_owned(), false));
}

#[cfg(test)]
pub(crate) fn inject_next_grant_reconciliation_failure(request_id: &str) {
    *INJECT_GRANT_COMMIT_UNCERTAIN
        .lock()
        .expect("grant commit uncertainty injector lock") = Some((request_id.to_owned(), true));
}

fn inject_grant_commit_uncertainty<T>(
    attempt: AuthTransactionAttempt<T>,
    _request_id: &str,
) -> (AuthTransactionAttempt<T>, bool) {
    #[cfg(test)]
    if let Some(inject_reconciliation_failure) = {
        let mut target = INJECT_GRANT_COMMIT_UNCERTAIN
            .lock()
            .expect("grant commit uncertainty injector lock");
        if target
            .as_ref()
            .is_some_and(|(request_id, _)| request_id == _request_id)
        {
            target
                .take()
                .map(|(_, fail_reconciliation)| fail_reconciliation)
        } else {
            None
        }
    } {
        let uncertain = match attempt {
            AuthTransactionAttempt::Committed(_) => {
                AuthTransactionAttempt::CommitUncertain(SnapbackError::error(
                    "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
                    "auth",
                    "delegated grant commit acknowledgement was unavailable",
                ))
            }
            other => other,
        };
        return (uncertain, inject_reconciliation_failure);
    }
    (attempt, false)
}

fn grant_commit_uncertain() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_COMMIT_UNCERTAIN",
        "auth",
        "delegated grant outcome could not be reconciled",
    )
}

fn grant_expiry_invalid() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_EXPIRY_INVALID",
        "auth",
        "delegated grant expiry must be between one millisecond and 90 days",
    )
}

fn grant_state_corrupt() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_GRANT_STATE_CORRUPT",
        "auth",
        "stored grant state is corrupt",
    )
}

fn provider_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "agent secret generation is unavailable",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::CryptoError;
    use crate::storage::auth_agents::AgentRegistration;
    use std::sync::atomic::{AtomicU8, Ordering};

    struct CounterRandom(AtomicU8);

    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU8::new(1))
        }
    }

    impl RandomSource for CounterRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0.fetch_add(1, Ordering::SeqCst));
            Ok(())
        }
    }

    fn ready(random: &dyn RandomSource) -> (LocalDatabase, AgentCredential) {
        configure(LocalDatabase::memory().unwrap(), random)
    }

    fn configure(
        mut db: LocalDatabase,
        random: &dyn RandomSource,
    ) -> (LocalDatabase, AgentCredential) {
        db.activate_current_auth_catalog().unwrap();
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', 0, 'human', 'User A', NULL, NULL, NULL, NULL)",
                [],
            )
            .unwrap();
        db.create_agent_principal(
            "agent-a",
            0,
            &AgentRegistration {
                display_name: Some("Agent A".to_owned()),
                operator_contact: None,
                registration_provenance: r#"{"source":"test"}"#.to_owned(),
                owner_user_id: Some("user-a".to_owned()),
            },
        )
        .unwrap();
        let credential = db
            .issue_initial_agent_credential("agent-a", 1_000, random)
            .unwrap()
            .secret;
        (db, credential)
    }

    fn scope_basis(db: &LocalDatabase, function_id: &str, kind: &str, authority_creating: bool) {
        db.conn
            .execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES(?1, ?2, 0, 1, ?3)",
                params![function_id, kind, i64::from(authority_creating)],
            )
            .unwrap();
    }

    #[test]
    fn pairing_expands_tiers_and_requires_a_real_step_up_proof() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        scope_basis(&db, "fn:read", "query", false);
        scope_basis(&db, "fn:live", "liveQuery", false);
        scope_basis(&db, "fn:ordinary-write", "mutation", false);
        scope_basis(&db, "fn:seat-role", "mutation", true);

        let pairing = db.mint_pairing_code("user-a", 1_100, &random).unwrap();
        let presented = db
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &[
                    GrantScopeRequest::Tier {
                        tier: GrantTier::Query,
                    },
                    GrantScopeRequest::Exact {
                        function_id: "fn:seat-role".to_owned(),
                        kind: ScopedFunctionKind::Mutation,
                    },
                ],
                1_101,
            )
            .unwrap();
        let PairingPresentation::Created(request) = presented else {
            panic!("first presentation must create");
        };
        assert_eq!(request.request_id, pairing.request_id);
        assert_eq!(
            request.owner_assumption,
            AgentOwnershipAssumption::OwnedByGrantor
        );
        assert_eq!(request.owner_assumption_warning, None);
        assert_eq!(
            request
                .scopes
                .iter()
                .map(|scope| scope.function_id.as_str())
                .collect::<Vec<_>>(),
            vec!["fn:live", "fn:read", "fn:seat-role"]
        );
        assert!(
            !request
                .scopes
                .iter()
                .any(|scope| scope.function_id == "fn:ordinary-write")
        );

        let repeated = db
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &[
                    GrantScopeRequest::Tier {
                        tier: GrantTier::Query,
                    },
                    GrantScopeRequest::Exact {
                        function_id: "fn:seat-role".to_owned(),
                        kind: ScopedFunctionKind::Mutation,
                    },
                ],
                1_102,
            )
            .unwrap();
        assert!(matches!(repeated, PairingPresentation::Existing(_)));

        let error = db
            .approve_grant_request(
                "user-a",
                "session-a",
                &pairing.request_id,
                None,
                None,
                1_103,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_STEP_UP_REQUIRED");

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _auth_grants", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn ask_surface_scope_renders_the_data_egress_disclosure() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        scope_basis(
            &db,
            super::super::auth_scope_bases::ASK_SCOPE_ID,
            "query",
            false,
        );
        scope_basis(&db, "fn:read", "query", false);

        let pairing = db.mint_pairing_code("user-a", 1_200, &random).unwrap();
        let PairingPresentation::Created(request) = db
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &[
                    GrantScopeRequest::Surface {
                        surface: GrantSurface::Ask,
                    },
                    GrantScopeRequest::Exact {
                        function_id: "fn:read".to_owned(),
                        kind: ScopedFunctionKind::Query,
                    },
                ],
                1_201,
            )
            .unwrap()
        else {
            panic!("first presentation must create");
        };
        assert!(
            request
                .scopes
                .iter()
                .any(|scope| scope.function_id == super::super::auth_scope_bases::ASK_SCOPE_ID)
        );
        let disclosure = request
            .data_egress_disclosure
            .expect("ask consent must describe third-party model egress");
        assert!(disclosure.contains("third-party model"));
        assert!(disclosure.contains("provenance, not proof"));
    }

    #[test]
    fn non_owner_consent_discloses_and_binds_the_owner_assumption() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        db.conn
            .execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-b', 0, 'human', 'User B', NULL, NULL, NULL, NULL)",
                [],
            )
            .unwrap();
        scope_basis(&db, "fn:read", "query", false);

        let pairing = db.mint_pairing_code("user-b", 1_100, &random).unwrap();
        let PairingPresentation::Created(request) = db
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &[GrantScopeRequest::Exact {
                    function_id: "fn:read".to_owned(),
                    kind: ScopedFunctionKind::Query,
                }],
                1_101,
            )
            .unwrap()
        else {
            panic!("first presentation must create");
        };
        assert_eq!(
            request.owner_assumption,
            AgentOwnershipAssumption::OwnedByAnotherUser
        );
        assert_eq!(
            request.owner_assumption_warning.as_deref(),
            Some(OTHER_OWNER_AGENT_WARNING)
        );

        let GrantApproval::Created(grant) = db
            .approve_grant_request(
                "user-b",
                "session-b",
                &pairing.request_id,
                None,
                None,
                1_102,
            )
            .unwrap()
        else {
            panic!("first approval must create");
        };
        let disclosed_digest = consent_digest(
            "agent-a",
            Some("Agent A"),
            r#"{"source":"test"}"#,
            AgentOwnershipAssumption::OwnedByAnotherUser,
            Some(OTHER_OWNER_AGENT_WARNING),
            &grant.scopes,
            grant.expires_at_ms,
        )
        .unwrap();
        let owner_digest = consent_digest(
            "agent-a",
            Some("Agent A"),
            r#"{"source":"test"}"#,
            AgentOwnershipAssumption::OwnedByGrantor,
            None,
            &grant.scopes,
            grant.expires_at_ms,
        )
        .unwrap();
        assert_eq!(grant.consent_digest, disclosed_digest);
        assert_ne!(grant.consent_digest, owner_digest);

        db.conn
            .execute(
                "UPDATE _auth_users SET owner_user_id = NULL WHERE id = 'agent-a'",
                [],
            )
            .unwrap();
        let unowned_pairing = db.mint_pairing_code("user-b", 1_103, &random).unwrap();
        let PairingPresentation::Created(unowned_request) = db
            .present_pairing_code(
                &credential,
                &unowned_pairing.request_id,
                &unowned_pairing.secret,
                &[GrantScopeRequest::Exact {
                    function_id: "fn:read".to_owned(),
                    kind: ScopedFunctionKind::Query,
                }],
                1_104,
            )
            .unwrap()
        else {
            panic!("unowned presentation must create");
        };
        assert_eq!(
            unowned_request.owner_assumption,
            AgentOwnershipAssumption::Unowned
        );
        assert_eq!(
            unowned_request.owner_assumption_warning.as_deref(),
            Some(UNOWNED_AGENT_WARNING)
        );
        let GrantApproval::Created(unowned_grant) = db
            .approve_grant_request(
                "user-b",
                "session-b",
                &unowned_pairing.request_id,
                None,
                None,
                1_105,
            )
            .unwrap()
        else {
            panic!("unowned approval must create");
        };
        let unowned_digest = consent_digest(
            "agent-a",
            Some("Agent A"),
            r#"{"source":"test"}"#,
            AgentOwnershipAssumption::Unowned,
            Some(UNOWNED_AGENT_WARNING),
            &unowned_grant.scopes,
            unowned_grant.expires_at_ms,
        )
        .unwrap();
        let other_owner_digest = consent_digest(
            "agent-a",
            Some("Agent A"),
            r#"{"source":"test"}"#,
            AgentOwnershipAssumption::OwnedByAnotherUser,
            Some(OTHER_OWNER_AGENT_WARNING),
            &unowned_grant.scopes,
            unowned_grant.expires_at_ms,
        )
        .unwrap();
        assert_eq!(unowned_grant.consent_digest, unowned_digest);
        assert_ne!(unowned_grant.consent_digest, other_owner_digest);
    }

    #[test]
    fn basis_change_between_pairing_and_consent_is_terminally_stale() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        scope_basis(&db, "fn:read", "query", false);
        let pairing = db.mint_pairing_code("user-a", 2_000, &random).unwrap();
        db.present_pairing_code(
            &credential,
            &pairing.request_id,
            &pairing.secret,
            &[GrantScopeRequest::Exact {
                function_id: "fn:read".to_owned(),
                kind: ScopedFunctionKind::Query,
            }],
            2_001,
        )
        .unwrap();
        db.conn
            .execute(
                "UPDATE _auth_scope_bases
                 SET generation = generation + 1, present = 0
                 WHERE function_id = 'fn:read'",
                [],
            )
            .unwrap();
        let error = db
            .approve_grant_request(
                "user-a",
                "session-a",
                &pairing.request_id,
                None,
                None,
                2_002,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GRANT_SCOPE_STALE");
        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM _auth_grants", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn invalid_pairing_code_does_not_reveal_scope_validity() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        let unknown = PairingCode::generate(&random).unwrap();
        let error = db
            .present_pairing_code(
                &credential,
                "missing-request",
                &unknown,
                &[GrantScopeRequest::Exact {
                    function_id: "fn:not-real".to_owned(),
                    kind: ScopedFunctionKind::Action,
                }],
                3_000,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GRANT_INVALID");
    }

    #[test]
    fn wrong_pairing_attempts_commit_and_fifth_failure_survives_restart() {
        let random = CounterRandom::new();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pairing.sqlite3");
        let (credential, pairing, wrong) = {
            let db = LocalDatabase::open(&path).unwrap();
            let (mut db, credential) = configure(db, &random);
            scope_basis(&db, "fn:read", "query", false);
            let pairing = db.mint_pairing_code("user-a", 4_000, &random).unwrap();
            let wrong = PairingCode::generate(&random).unwrap();
            for attempt in 1..=PAIRING_CODE_ATTEMPT_LIMIT {
                let error = db
                    .present_pairing_code(
                        &credential,
                        &pairing.request_id,
                        &wrong,
                        &[GrantScopeRequest::Exact {
                            function_id: "fn:not-real".to_owned(),
                            kind: ScopedFunctionKind::Action,
                        }],
                        4_000 + attempt,
                    )
                    .unwrap_err();
                assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GRANT_INVALID");
                let durable_attempts: i64 = db
                    .conn
                    .query_row(
                        "SELECT attempts FROM _auth_pairing_requests WHERE id = ?1",
                        params![pairing.request_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(durable_attempts as u64, attempt);
            }
            (credential, pairing, wrong)
        };

        let mut reopened = LocalDatabase::open(&path).unwrap();
        let error = reopened
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &[GrantScopeRequest::Exact {
                    function_id: "fn:read".to_owned(),
                    kind: ScopedFunctionKind::Query,
                }],
                4_006,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GRANT_INVALID");

        let missing_error = reopened
            .present_pairing_code(
                &credential,
                "missing-request",
                &wrong,
                &[GrantScopeRequest::Exact {
                    function_id: "fn:not-real".to_owned(),
                    kind: ScopedFunctionKind::Action,
                }],
                4_007,
            )
            .unwrap_err();
        assert_eq!(missing_error.diagnostic.code, "SNAPBACK_AUTH_GRANT_INVALID");
    }

    #[test]
    fn correct_fifth_pairing_attempt_succeeds_before_the_ceiling() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        scope_basis(&db, "fn:read", "query", false);
        let pairing = db.mint_pairing_code("user-a", 4_000, &random).unwrap();
        let wrong = PairingCode::generate(&random).unwrap();
        let scopes = [GrantScopeRequest::Exact {
            function_id: "fn:read".to_owned(),
            kind: ScopedFunctionKind::Query,
        }];
        for attempt in 1..PAIRING_CODE_ATTEMPT_LIMIT {
            db.present_pairing_code(
                &credential,
                &pairing.request_id,
                &wrong,
                &scopes,
                4_000 + attempt,
            )
            .unwrap_err();
        }
        let presentation = db
            .present_pairing_code(
                &credential,
                &pairing.request_id,
                &pairing.secret,
                &scopes,
                4_000 + PAIRING_CODE_ATTEMPT_LIMIT,
            )
            .unwrap();
        assert!(matches!(presentation, PairingPresentation::Created(_)));
    }

    #[test]
    fn missing_expired_and_foreign_pairing_requests_share_the_invalid_outcome() {
        let random = CounterRandom::new();
        let (mut db, credential_a) = ready(&random);
        db.create_agent_principal(
            "agent-b",
            0,
            &AgentRegistration {
                display_name: None,
                operator_contact: None,
                registration_provenance: "test".to_owned(),
                owner_user_id: None,
            },
        )
        .unwrap();
        let credential_b = db
            .issue_initial_agent_credential("agent-b", 1_001, &random)
            .unwrap()
            .secret;
        scope_basis(&db, "fn:read", "query", false);
        let pairing = db.mint_pairing_code("user-a", 5_000, &random).unwrap();
        db.present_pairing_code(
            &credential_a,
            &pairing.request_id,
            &pairing.secret,
            &[GrantScopeRequest::Exact {
                function_id: "fn:read".to_owned(),
                kind: ScopedFunctionKind::Query,
            }],
            5_001,
        )
        .unwrap();
        let invalid_scope = [GrantScopeRequest::Exact {
            function_id: "fn:not-real".to_owned(),
            kind: ScopedFunctionKind::Action,
        }];

        let foreign = db
            .present_pairing_code(
                &credential_b,
                &pairing.request_id,
                &pairing.secret,
                &invalid_scope,
                5_002,
            )
            .unwrap_err();
        let missing = db
            .present_pairing_code(
                &credential_b,
                "missing-request",
                &pairing.secret,
                &invalid_scope,
                5_003,
            )
            .unwrap_err();
        let expired_pairing = db.mint_pairing_code("user-a", 6_000, &random).unwrap();
        let expired = db
            .present_pairing_code(
                &credential_b,
                &expired_pairing.request_id,
                &expired_pairing.secret,
                &invalid_scope,
                6_000 + PAIRING_CODE_TTL_MS,
            )
            .unwrap_err();

        assert_eq!(foreign.diagnostic.code, "SNAPBACK_AUTH_GRANT_INVALID");
        assert_eq!(missing.diagnostic.code, foreign.diagnostic.code);
        assert_eq!(expired.diagnostic.code, foreign.diagnostic.code);
    }

    #[test]
    fn approved_pairing_poll_replaces_the_prior_plaintext_free_token() {
        let random = CounterRandom::new();
        let (mut db, credential) = ready(&random);
        scope_basis(&db, "fn:read", "query", false);
        let pairing = db.mint_pairing_code("user-a", 7_000, &random).unwrap();
        db.present_pairing_code(
            &credential,
            &pairing.request_id,
            &pairing.secret,
            &[GrantScopeRequest::Exact {
                function_id: "fn:read".to_owned(),
                kind: ScopedFunctionKind::Query,
            }],
            7_001,
        )
        .unwrap();

        let pending = db
            .mint_scoped_token_for_pairing_request(
                &credential,
                &pairing.request_id,
                None,
                7_002,
                &random,
            )
            .unwrap_err();
        assert_eq!(pending.diagnostic.code, "SNAPBACK_AUTH_GRANT_PENDING");
        let pending_requests = db.pending_grant_requests("user-a", 7_002).unwrap();
        assert_eq!(pending_requests.len(), 1);
        assert_eq!(pending_requests[0].request_id, pairing.request_id);
        db.approve_grant_request(
            "user-a",
            "session-a",
            &pairing.request_id,
            Some(1_000),
            None,
            7_003,
        )
        .unwrap();

        let first = db
            .mint_scoped_token_for_pairing_request(
                &credential,
                &pairing.request_id,
                None,
                7_004,
                &random,
            )
            .unwrap();
        assert_eq!(first.expires_at_ms, 8_003);
        assert_eq!(first.grant_expires_at_ms, Some(8_003));
        assert!(first.evicted_token_ids.is_empty());
        let first_id = first.token_id.clone();
        let first_secret = first.secret;

        let replacement = db
            .mint_scoped_token_for_pairing_request(
                &credential,
                &pairing.request_id,
                None,
                7_005,
                &random,
            )
            .unwrap();
        assert_eq!(replacement.evicted_token_ids, vec![first_id]);
        assert_eq!(
            db.resolve_scoped_token(&first_secret, 7_005)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        let resolved = db.resolve_scoped_token(&replacement.secret, 7_005).unwrap();
        assert_eq!(resolved.grant_id, replacement.grant_id);
        assert_eq!(
            replacement.scopes,
            serde_json::to_value(&resolved.scopes).unwrap()
        );
        db.conn
            .execute(
                "UPDATE _auth_scope_bases
                 SET generation = generation + 1, present = 0
                 WHERE function_id = 'fn:read' AND kind = 'query'",
                [],
            )
            .unwrap();
        let stale_basis = db.resolve_scoped_token(&replacement.secret, 7_005).unwrap();
        assert!(
            stale_basis.scopes.is_empty(),
            "an already-issued token cannot revive a terminally invalid scope"
        );
        assert!(
            db.pending_grant_requests("user-a", 7_005)
                .unwrap()
                .is_empty()
        );
        let grants = db.grants_for_user("user-a", 7_005).unwrap();
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].grant_id, replacement.grant_id);

        let foreign = db
            .revoke_grants_by_actor_for_user("user-b", "agent-a", 7_006)
            .unwrap();
        assert!(foreign.grant_ids.is_empty());
        assert!(foreign.token_ids.is_empty());
        let wrong_actor = db
            .revoke_grants_by_actor_for_user("user-a", "agent-b", 7_006)
            .unwrap();
        assert_eq!(wrong_actor, foreign);

        let revoked = db
            .revoke_grants_by_actor_for_user("user-a", "agent-a", 7_006)
            .unwrap();
        assert_eq!(revoked.grant_ids, vec![replacement.grant_id]);
        assert_eq!(revoked.token_ids, vec![replacement.token_id]);
        assert_eq!(
            db.resolve_scoped_token(&replacement.secret, 7_006)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_SCOPED_TOKEN_INVALID"
        );
        let repeated = db
            .revoke_grants_by_actor_for_user("user-a", "agent-a", 7_006)
            .unwrap();
        assert!(repeated.grant_ids.is_empty());
        assert!(repeated.token_ids.is_empty());
    }

    #[test]
    fn lost_commit_acknowledgements_reconcile_single_and_bulk_grant_revocation() {
        let random = CounterRandom::new();
        let (mut db, _credential) = ready(&random);
        let credential_id: String = db
            .conn
            .query_row(
                "SELECT id FROM _auth_agent_credentials
                 WHERE user_id = 'agent-a' AND revoked_at_ms IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        for (grant, token, hash_byte) in [
            ("grant-one", "token-one", 1_u8),
            ("grant-two", "token-two", 2_u8),
        ] {
            db.conn
                .execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES(?1, 'agent-a', 'user-a', '[]', 1000, 10000, NULL,
                              'test', NULL, NULL, 1000)",
                    params![grant],
                )
                .unwrap();
            db.conn
                .execute(
                    "INSERT INTO _auth_grant_tokens(
                       id, token_hash, grant_id, credential_id,
                       credential_generation, created_at_ms, expires_at_ms, revoked_at_ms
                     ) VALUES(?1, ?2, ?3, ?4, 1, 1000, 10000, NULL)",
                    params![token, vec![hash_byte; 32], grant, credential_id],
                )
                .unwrap();
        }

        inject_next_grant_revocation_commit_uncertain("single", "grant-one");
        let single = db
            .revoke_grant_for_user("user-a", "grant-one", 1_001)
            .expect("single revocation reconciles");
        assert_eq!(single.token_ids, ["token-one"]);

        let bulk_key = "user-a\0agent-a";
        inject_next_grant_revocation_commit_uncertain("bulk", bulk_key);
        let bulk = db
            .revoke_grants_by_actor_for_user("user-a", "agent-a", 1_002)
            .expect("bulk revocation reconciles");
        assert_eq!(bulk.grant_ids, ["grant-two"]);
        assert_eq!(bulk.token_ids, ["token-two"]);
    }
}
