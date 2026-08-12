use super::{LocalDatabase, SnapbackResult};
use crate::auth::crypto::{
    AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, StepUpDigest, TokenHash,
    VerificationCode,
};
use crate::auth::provider::{
    AuthProvider, AuthenticatedUse, AuthenticatedUseRow, DurableIssuanceReconcile,
    DurableRejectedIssuanceReconcile, DurableRevocationReconcile, DurableRotationReconcile,
    ExchangeCoordination, PlannedExchange, PlannedFamilyAlarmCommit, PlannedIssuanceCommit,
    PlannedRevocationCommit, PlannedRotationTransaction, ProviderFamilyAlarmPlan,
    ProviderRevocationPlan, ProviderSessionIssuanceCommitPlan, ProviderTokenRotationCommitPlan,
    RejectedExchangeOutcome, RequestInsertOutcome, SessionCandidate, StepUpBinding,
};
use crate::auth::throttle::{
    AuthBudgetName, AuthBudgetRefusal, RecipientRuleDisposition,
    ResolvedCompatibilityAuthBudgetPolicy, RollingWindowBudgetTerms,
};
use rusqlite::{OptionalExtension, Transaction, params};

/// Resolve the two LLP 0057 rolling-window rules from the named compatibility
/// policy. Both are successful-effect counters: this helper runs inside the
/// same transaction that will insert the challenge, and a refusal rolls back
/// without charging either rule.
///
/// @ref LLP 0215#12-llp-0057-migration — compatibility preserves the existing
/// half-open windows and request-code commit boundary exactly.
fn request_code_budget_refusal(
    transaction: &Transaction<'_>,
    address: &CanonicalAddress,
    now_ms: u64,
    policy: ResolvedCompatibilityAuthBudgetPolicy,
) -> SnapbackResult<Option<AuthBudgetRefusal>> {
    fn exhausted_rule(
        transaction: &Transaction<'_>,
        sql: &str,
        parameters: impl rusqlite::Params,
        now_ms: u64,
        terms: RollingWindowBudgetTerms,
        budget_name: AuthBudgetName,
    ) -> SnapbackResult<Option<(u64, AuthBudgetName)>> {
        let (count, oldest): (i64, Option<i64>) =
            transaction.query_row(sql, parameters, |row| Ok((row.get(0)?, row.get(1)?)))?;
        if count < terms.limit as i64 {
            return Ok(None);
        }
        let oldest = oldest
            .and_then(|value| u64::try_from(value).ok())
            .ok_or_else(crate::auth::provider::internal_state_snapback)?;
        let retry_after_ms = oldest
            .checked_add(terms.window_ms)
            .ok_or_else(crate::auth::provider::internal_state_snapback)?
            .saturating_sub(now_ms)
            .max(1);
        Ok(Some((retry_after_ms, budget_name)))
    }

    let global = policy.global();
    let global_lower = now_ms as i64 - global.window_ms as i64;
    let mut exhausted = exhausted_rule(
        transaction,
        "SELECT COUNT(*), MIN(requested_at_ms) FROM _auth_verification_codes
         WHERE requested_at_ms > ?1 AND requested_at_ms <= ?2",
        params![global_lower, now_ms as i64],
        now_ms,
        global,
        AuthBudgetName::ChallengeAllocation,
    )?;

    if let RecipientRuleDisposition::Applied(recipient) = policy.recipient() {
        let recipient_lower = now_ms as i64 - recipient.window_ms as i64;
        let recipient_exhausted = exhausted_rule(
            transaction,
            "SELECT COUNT(*), MIN(requested_at_ms) FROM _auth_verification_codes
             WHERE canonical_address = ?1
               AND requested_at_ms > ?2 AND requested_at_ms <= ?3",
            params![address.as_str(), recipient_lower, now_ms as i64],
            now_ms,
            recipient,
            AuthBudgetName::Delivery,
        )?;
        if recipient_exhausted
            .is_some_and(|candidate| exhausted.is_none_or(|selected| candidate.0 > selected.0))
        {
            exhausted = recipient_exhausted;
        }
    }

    Ok(exhausted.map(|(retry_after_ms, budget_name)| {
        AuthBudgetRefusal::rate_duration(budget_name, retry_after_ms)
    }))
}

#[cfg(test)]
use rusqlite::Connection;

#[cfg(test)]
fn test_catalog_v3(conn: &Connection) -> SnapbackResult<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info('_auth_sessions')")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        if row.get::<_, String>(1)? == "authn_source" {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
pub(crate) fn insert_test_email_identity(
    conn: &Connection,
    id: &str,
    user: &str,
    address: &str,
    now: u64,
    ignore: bool,
) -> SnapbackResult<()> {
    let verb = if ignore { "INSERT OR IGNORE" } else { "INSERT" };
    if test_catalog_v3(conn)? {
        conn.execute(&format!("{verb} INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,'email','email-code',?3,?3,?4,?4)"), params![id,user,address,now])?;
    } else {
        conn.execute(&format!("{verb} INTO _auth_identities(id,user_id,provider,subject,verified_at_ms) VALUES(?1,?2,'email-code',?3,?4)"), params![id,user,address,now])?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn insert_test_external_identity(
    conn: &Connection,
    id: &str,
    user: &str,
    provider: &str,
    subject: &str,
    now: u64,
) -> SnapbackResult<()> {
    if test_catalog_v3(conn)? {
        conn.execute(
            "INSERT INTO _auth_identities(
               id, user_id, kind, provider, issuer, subject, canonical_value,
               created_at_ms, verified_at_ms, disabled_at_ms
             ) VALUES(?1, ?2, 'external', ?3, NULL, ?4, NULL, ?5, ?5, NULL)",
            params![id, user, provider, subject, now],
        )?;
    } else {
        conn.execute(
            "INSERT INTO _auth_identities(
               id, user_id, provider, subject, verified_at_ms
             ) VALUES(?1, ?2, ?3, ?4, ?5)",
            params![id, user, provider, subject, now],
        )?;
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(crate) fn insert_test_identity_session(
    conn: &Connection,
    id: &str,
    user: &str,
    identity: &str,
    authority: &str,
    token: &[u8],
    created: u64,
    last: u64,
    expires: u64,
    absolute: u64,
) -> SnapbackResult<()> {
    if test_catalog_v3(conn)? {
        conn.execute("INSERT INTO _auth_sessions(id,user_id,identity_id,credential_id,authn_source,authority_instance_id,token_hash,generation,created_at_ms,last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms) VALUES(?1,?2,?3,NULL,'identity',?4,?5,1,?6,?7,?8,?9,NULL)",params![id,user,identity,authority,token,created,last,expires,absolute])?;
    } else {
        conn.execute("INSERT INTO _auth_sessions(id,user_id,identity_id,authority_instance_id,token_hash,generation,created_at_ms,last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms) VALUES(?1,?2,?3,?4,?5,1,?6,?7,?8,?9,NULL)",params![id,user,identity,authority,token,created,last,expires,absolute])?;
    }
    Ok(())
}

impl LocalDatabase {
    pub(super) fn auth_step_up_address(
        &self,
        binding: &StepUpBinding,
        now_ms: u64,
    ) -> SnapbackResult<Option<String>> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT identity.subject
                     FROM _auth_sessions AS session
                     JOIN _auth_identities AS identity
                       ON identity.id = session.identity_id
                      AND identity.user_id = session.user_id
                     WHERE session.id = ?1 AND session.user_id = ?2
                       AND session.generation = ?3
                       AND session.authority_instance_id = ?4
                       AND session.revoked_at_ms IS NULL
                       AND session.expires_at_ms > ?5
                       AND session.absolute_expires_at_ms > ?5
                       AND identity.provider = 'email-code'",
                    params![
                        binding.session_id,
                        binding.user_id,
                        binding.session_generation as i64,
                        binding.authority_instance_id,
                        now_ms as i64,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    pub(super) fn auth_challenge_coordination(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<Option<(String, String)>> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT canonical_address, key_id
                     FROM _auth_verification_codes WHERE challenge_id = ?1",
                    params![challenge_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_exchange_unknown(
        &mut self,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
        challenge_id: &ChallengeId,
        code: &VerificationCode,
        dummy_key: &AuthKeyMaterial,
        dummy_address: &CanonicalAddress,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            if let Some(sender_issuance) = sender_issuance {
                sender_issuance
                    .consume_rejected_outcome(transaction)
                    .map_err(|_| crate::auth::provider::internal_state_snapback())?;
            }
            let _: Option<i64> = transaction
                .query_row(
                    "SELECT 1 FROM _auth_verification_codes WHERE challenge_id = ?1",
                    params![challenge_id.as_str()],
                    |row| row.get(0),
                )
                .optional()?;
            let digest = CodeDigest::compute(dummy_key, challenge_id, dummy_address, code);
            let _ = digest.verify(&[0_u8; 32]);
            Ok(())
        })
    }

    pub(super) fn auth_lookup_presented_session(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<crate::auth::provider::PresentedSessionLookup> {
        self.with_auth_read(|connection| {
            crate::auth::provider::lookup_presented_session(connection, token_hash)
        })
    }

    pub(super) fn auth_lookup_presented_session_with_sender_binding(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<(crate::auth::provider::PresentedSessionLookup, bool)> {
        self.with_auth_read(|connection| {
            let lookup = crate::auth::provider::lookup_presented_session(connection, token_hash)?;
            // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: the durable
            // family binding (not the presented spelling) selects the
            // successor spelling, so every successor of a sender-bound
            // family stays `sbs2_`.
            let sender_bound =
                crate::auth::sender_proof::presented_token_has_sender_family_binding(
                    connection,
                    token_hash.as_bytes(),
                )
                .map_err(|_| {
                    crate::diagnostic::SnapbackError::error(
                        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                        "auth",
                        "sender family binding state is unavailable",
                    )
                })?;
            Ok((lookup, sender_bound))
        })
    }

    pub(super) fn auth_attempt_planned_family_alarm(
        &mut self,
        plan: &ProviderFamilyAlarmPlan,
    ) -> super::auth::AuthTransactionAttempt<PlannedFamilyAlarmCommit> {
        self.attempt_auth_transaction(|transaction| {
            crate::auth::provider::planned_family_alarm_transaction(transaction, plan)
        })
    }

    pub(super) fn auth_attempt_planned_revocation(
        &mut self,
        plan: &ProviderRevocationPlan,
        now_ms: u64,
    ) -> super::auth::AuthTransactionAttempt<PlannedRevocationCommit> {
        self.attempt_auth_transaction(|transaction| {
            crate::auth::provider::planned_revocation_transaction(transaction, plan, now_ms)
        })
    }

    pub(super) fn auth_reconcile_planned_revocation(
        &self,
        plan: &ProviderRevocationPlan,
        now_ms: u64,
    ) -> SnapbackResult<DurableRevocationReconcile> {
        self.with_auth_read(|connection| {
            crate::auth::provider::reconcile_planned_revocation(connection, plan, now_ms)
        })
    }

    pub(super) fn auth_attempt_planned_rotation(
        &mut self,
        plan: &ProviderTokenRotationCommitPlan,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedRotationTransaction>,
        Option<PlannedRotationTransaction>,
    ) {
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|transaction| {
            let outcome = crate::auth::provider::planned_rotation_transaction(transaction, plan)?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        (attempt, body_outcome)
    }

    pub(super) fn auth_reconcile_planned_rotation(
        &self,
        plan: &ProviderTokenRotationCommitPlan,
    ) -> SnapbackResult<DurableRotationReconcile> {
        self.with_auth_read(|connection| {
            crate::auth::provider::reconcile_planned_rotation(connection, plan)
        })
    }

    pub(super) fn auth_authenticated_use_row(
        &self,
        session_id: &str,
        expected_generation: u64,
    ) -> SnapbackResult<Option<AuthenticatedUseRow>> {
        self.with_auth_read(|connection| {
            crate::auth::provider::authenticated_use_row(
                connection,
                session_id,
                expected_generation,
            )
        })
    }

    pub(super) fn auth_record_authenticated_use(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        now_ms: u64,
    ) -> SnapbackResult<AuthenticatedUse> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::record_authenticated_use_transaction(
                transaction,
                session_id,
                expected_generation,
                now_ms,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_plan_exchange(
        &self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        now_ms: u64,
    ) -> SnapbackResult<PlannedExchange> {
        self.with_auth_read(|connection| {
            crate::auth::provider::plan_exchange_read(
                connection,
                provider,
                coordination,
                key,
                code,
                now_ms,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_commit_planned_rejection(
        &mut self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        now_ms: u64,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> SnapbackResult<RejectedExchangeOutcome> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::rejected_exchange_transaction(
                transaction,
                provider,
                coordination,
                key,
                code,
                now_ms,
                sender_issuance,
            )
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_step_up_challenge(
        &mut self,
        binding: &StepUpBinding,
        address: &CanonicalAddress,
        challenge_id: &ChallengeId,
        digest: &StepUpDigest,
        key_id: &str,
        now_ms: u64,
        expires_at_ms: u64,
        budget_policy: &ResolvedCompatibilityAuthBudgetPolicy,
    ) -> SnapbackResult<RequestInsertOutcome> {
        self.with_auth_transaction(|transaction| {
            let live_address = transaction
                .query_row(
                    "SELECT identity.subject
                     FROM _auth_sessions AS session
                     JOIN _auth_identities AS identity
                       ON identity.id = session.identity_id
                      AND identity.user_id = session.user_id
                     WHERE session.id = ?1 AND session.user_id = ?2
                       AND session.generation = ?3
                       AND session.authority_instance_id = ?4
                       AND session.revoked_at_ms IS NULL
                       AND session.expires_at_ms > ?5
                       AND session.absolute_expires_at_ms > ?5
                       AND identity.provider = 'email-code'",
                    params![
                        binding.session_id,
                        binding.user_id,
                        binding.session_generation as i64,
                        binding.authority_instance_id,
                        now_ms as i64,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if live_address.as_deref() != Some(address.as_str()) {
                return Err(crate::auth::provider::auth_required().into_snapback_error());
            }

            if let Some(refusal) =
                request_code_budget_refusal(transaction, address, now_ms, *budget_policy)?
            {
                return Err(crate::auth::provider::throttled_snapback(refusal));
            }

            transaction.execute(
                "UPDATE _auth_verification_codes SET superseded_by = ?1
                 WHERE canonical_address = ?2
                   AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                params![challenge_id.as_str(), address.as_str()],
            )?;
            match transaction.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, NULL, NULL)",
                params![
                    challenge_id.as_str(),
                    address.as_str(),
                    digest.as_bytes().as_slice(),
                    key_id,
                    budget_policy.challenge_attempts().limit as i64,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            ) {
                Ok(_) => Ok(RequestInsertOutcome::Inserted),
                Err(error) if crate::auth::provider::is_constraint_error(&error) => {
                    Err(crate::auth::provider::internal_collision_snapback())
                }
                Err(error) => Err(error.into()),
            }
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_verification_challenge(
        &mut self,
        address: &CanonicalAddress,
        challenge_id: &ChallengeId,
        digest: &CodeDigest,
        key_id: &str,
        now_ms: u64,
        expires_at_ms: u64,
        budget_policy: &ResolvedCompatibilityAuthBudgetPolicy,
        rehearsal_window: Option<&crate::auth::rehearsal::AuthRehearsalWindowV1>,
    ) -> SnapbackResult<RequestInsertOutcome> {
        self.with_auth_transaction(|transaction| {
            if let Some(refusal) =
                request_code_budget_refusal(transaction, address, now_ms, *budget_policy)?
            {
                return Err(crate::auth::provider::throttled_snapback(refusal));
            }

            transaction.execute(
                "UPDATE _auth_verification_codes
                 SET superseded_by = ?1
                 WHERE canonical_address = ?2
                   AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                params![challenge_id.as_str(), address.as_str()],
            )?;
            match transaction.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, NULL, NULL)",
                params![
                    challenge_id.as_str(),
                    address.as_str(),
                    digest.as_bytes().as_slice(),
                    key_id,
                    budget_policy.challenge_attempts().limit as i64,
                    now_ms as i64,
                    expires_at_ms as i64,
                ],
            ) {
                Ok(_) => {
                    if let Some(window) = rehearsal_window {
                        crate::storage::auth_rehearsal::consume_rehearsal_window_challenge_in(
                            transaction,
                            window,
                            challenge_id.as_str(),
                            address,
                            now_ms,
                        )?;
                    }
                    Ok(RequestInsertOutcome::Inserted)
                }
                Err(error) if crate::auth::provider::is_constraint_error(&error) => {
                    Err(crate::auth::provider::internal_collision_snapback())
                }
                Err(error) => Err(error.into()),
            }
        })
    }

    pub(super) fn auth_plan_session_issuance(
        &self,
        address: &CanonicalAddress,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<(
        crate::contract_types::PlannedIdentityState,
        Option<ProviderRevocationPlan>,
    )> {
        self.with_auth_read(|connection| {
            crate::auth::provider::plan_session_issuance_read(
                connection, address, candidate, now_ms,
            )
        })
    }

    pub(super) fn auth_attempt_planned_session_issuance(
        &mut self,
        plan: &ProviderSessionIssuanceCommitPlan,
        exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedIssuanceCommit>,
        Option<PlannedIssuanceCommit>,
    ) {
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|transaction| {
            let outcome = crate::auth::provider::planned_session_issuance_transaction(
                transaction,
                plan,
                exchange_proof,
            )?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        (attempt, body_outcome)
    }

    pub(super) fn auth_reconcile_rejected_issuance(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<DurableRejectedIssuanceReconcile> {
        self.with_auth_read(|connection| {
            crate::auth::provider::reconcile_rejected_issuance(connection, plan)
        })
    }

    pub(super) fn auth_sender_key_bound_successor(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<bool> {
        self.with_auth_read(|connection| {
            let Some(sender_issuance) = plan.sender_issuance.as_ref() else {
                return Err(crate::auth::provider::internal_state_snapback());
            };
            sender_issuance
                .is_key_bound_successor(connection, &plan.projected.session_id)
                .map_err(|_| crate::auth::provider::internal_state_snapback())
        })
    }

    pub(super) fn auth_reconcile_planned_issuance(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<DurableIssuanceReconcile> {
        self.with_auth_read(|connection| {
            crate::auth::provider::reconcile_planned_issuance(connection, plan)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_presented_token_sender_bound_for_test(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<bool> {
        self.with_auth_read(|connection| {
            crate::auth::sender_proof::presented_token_has_sender_family_binding(
                connection,
                token_hash.as_bytes(),
            )
            .map_err(|_| {
                crate::diagnostic::SnapbackError::error(
                    "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                    "auth",
                    "sender family binding state is unavailable",
                )
            })
        })
    }

    #[cfg(test)]
    pub(super) fn auth_refresh_for_test(
        &mut self,
        predecessor_hash: &TokenHash,
        successor_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::RefreshOutcome> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::refresh_transaction(
                transaction,
                predecessor_hash,
                successor_hash,
                now_ms,
            )
        })
    }

    #[cfg(test)]
    pub(super) fn auth_logout_for_test(
        &mut self,
        token_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::LogoutOutcome> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::logout_transaction(transaction, token_hash, now_ms)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_family_alarm_for_test(
        &mut self,
        token_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::auth::provider::SessionRevocation>> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::family_alarm_transaction(transaction, token_hash, now_ms)
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_exchange_for_test(
        &mut self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::ExchangeOutcome> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::exchange_transaction(
                transaction,
                provider,
                coordination,
                key,
                code,
                candidate,
                now_ms,
            )
        })
    }

    #[cfg(test)]
    pub(super) fn auth_mint_session_for_test(
        &mut self,
        address: &CanonicalAddress,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<(
        crate::auth::wire::SessionResponse,
        Option<crate::auth::provider::SessionRevocation>,
    )> {
        self.with_auth_transaction(|transaction| {
            crate::auth::provider::mint_session_transaction(transaction, address, candidate, now_ms)
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_verification_code_for_test(
        &mut self,
        challenge_id: &str,
        address: &str,
        digest: &[u8],
        key_id: &str,
        requested_at_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, ?4, 0, 5, ?5, ?6, NULL, NULL)",
                params![
                    challenge_id,
                    address,
                    digest,
                    key_id,
                    requested_at_ms as i64,
                    expires_at_ms as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_catalog_version_for_test(&self) -> SnapbackResult<String> {
        self.with_auth_read(|connection| {
            Ok(connection.query_row(
                "SELECT value FROM _snapback_meta WHERE key = 'auth_catalog_version'",
                [],
                |row| row.get::<_, String>(0),
            )?)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_set_verification_key_id_for_test(
        &mut self,
        key_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_verification_codes SET key_id = ?1",
                params![key_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_restore_fixture_for_test(
        &mut self,
        session_id: &str,
        authority_instance_id: &str,
        token_hash: &[u8],
        challenge_id: &str,
        address: &str,
        code_digest: &[u8],
        key_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT OR IGNORE INTO _auth_users(id, created_at_ms) VALUES('user-1', 0)",
                [],
            )?;
            insert_test_email_identity(tx, "identity-1", "user-1", "user@example.com", 0, true)?;
            insert_test_identity_session(
                tx,
                session_id,
                "user-1",
                "identity-1",
                authority_instance_id,
                token_hash,
                0,
                0,
                1000,
                2000,
            )?;
            tx.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, ?4, 0, 5, 0, 1000, NULL, NULL)",
                params![challenge_id, address, code_digest, key_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_session_generation_revoked_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, Option<i64>)> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT generation, revoked_at_ms FROM _auth_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
            )?)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_verification_challenge_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM _auth_verification_codes", [], |row| {
                    row.get(0)
                })?,
            )
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_expired_challenges_for_test(
        &mut self,
        count: usize,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            let mut insert = transaction.prepare(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, 'missing-key', 0, 5, 0, 1, NULL, NULL)",
            )?;
            let digest = [0_u8; 32];
            for index in 0..count {
                insert.execute(params![
                    format!("expired-challenge-{index}"),
                    format!("expired-{index}@example.com"),
                    digest.as_slice(),
                ])?;
            }
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_email_session_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        address: &str,
        token_hash: &[u8],
        created_at_ms: u64,
        last_used_at_ms: u64,
        expires_at_ms: u64,
        absolute_expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![user_id, created_at_ms as i64],
            )?;
            insert_test_email_identity(
                transaction,
                identity_id,
                user_id,
                address,
                created_at_ms,
                false,
            )?;
            insert_test_identity_session(
                transaction,
                session_id,
                user_id,
                identity_id,
                authority_instance_id,
                token_hash,
                created_at_ms,
                last_used_at_ms,
                expires_at_ms,
                absolute_expires_at_ms,
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_email_session_and_push_token_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![user_id],
            )?;
            insert_test_email_identity(tx, identity_id, user_id, "push@example.com", 0, false)?;
            insert_test_identity_session(
                tx,
                session_id,
                user_id,
                identity_id,
                authority_instance_id,
                &[0; 32],
                0,
                0,
                expires_at_ms,
                expires_at_ms,
            )?;
            tx.execute(
                "INSERT INTO _snapback_push_tokens_v1(
                   id, app_scope, principal_id, installation_id, token_hash, token_bytes,
                   session_id, session_generation, registered_at_ms, last_registered_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 1, 1)",
                params![
                    crate::ids::mint_time_ordered(crate::ids::Kind::PushToken),
                    "15:eas-maintenance|23:com.example.maintenance|4:test",
                    user_id,
                    crate::ids::mint(crate::ids::Kind::Installation)?,
                    vec![8_u8; 32],
                    "ExponentPushToken[idle_maintenance_secret]",
                    session_id,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_restore_cli_fixture_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        key_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, 0)",
                params![user_id],
            )?;
            insert_test_email_identity(
                transaction,
                identity_id,
                user_id,
                "person@example.com",
                0,
                false,
            )?;
            insert_test_identity_session(
                transaction,
                session_id,
                user_id,
                identity_id,
                authority_instance_id,
                &[1; 32],
                0,
                0,
                2_000_000_000_000,
                2_000_000_000_000,
            )?;
            transaction.execute(
                "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES('sbc_AAAAAAAAAAAAAAAAAAAAAA', 'person@example.com', ?1, ?2,
                              0, 5, 0, 2000000000000, NULL, NULL)",
                params![vec![2_u8; 32], key_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_restored_counts_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT COUNT(*) FROM _auth_sessions WHERE id = ?1",
                    params![session_id],
                    |row| row.get::<_, i64>(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes",
                    [],
                    |row| row.get::<_, i64>(0),
                )?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_session_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_change_journal_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_challenge_issue_facts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT attempts FROM _auth_verification_codes WHERE challenge_id = ?1",
                    params![challenge_id],
                    |row| row.get::<_, i64>(0),
                )?,
                connection.query_row("SELECT COUNT(*) FROM _auth_users", [], |row| {
                    row.get::<_, i64>(0)
                })?,
                connection.query_row("SELECT COUNT(*) FROM _auth_identities", [], |row| {
                    row.get::<_, i64>(0)
                })?,
                connection.query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| {
                    row.get::<_, i64>(0)
                })?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_challenge_attempts_and_sessions_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT attempts FROM _auth_verification_codes WHERE challenge_id = ?1",
                    params![challenge_id],
                    |row| row.get(0),
                )?,
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_provision_counts_for_test(&self) -> SnapbackResult<(i64, i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row("SELECT COUNT(*) FROM _auth_users", [], |row| row.get(0))?,
                connection.query_row("SELECT COUNT(*) FROM _auth_identities", [], |row| {
                    row.get(0)
                })?,
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_current_and_tombstone_counts_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT COUNT(*) FROM _auth_sessions WHERE revoked_at_ms IS NULL",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row("SELECT COUNT(*) FROM _auth_session_tokens", [], |row| {
                    row.get(0)
                })?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_session_cap_facts_for_test(
        &self,
        now_ms: u64,
        revoked_session_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT COUNT(*) FROM _auth_sessions
                     WHERE revoked_at_ms IS NULL AND ?1 < expires_at_ms",
                    params![now_ms as i64],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _auth_sessions
                     WHERE id = ?1 AND revoked_at_ms IS NOT NULL AND generation = 2",
                    params![revoked_session_id],
                    |row| row.get(0),
                )?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_tombstone_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _auth_session_tokens", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_sole_session_generation_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT generation FROM _auth_sessions", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_sole_session_generation_revoked_for_test(
        &self,
    ) -> SnapbackResult<(i64, bool)> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT generation, revoked_at_ms IS NOT NULL FROM _auth_sessions",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_generation_and_tombstones_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row("SELECT generation FROM _auth_sessions", [], |row| {
                    row.get(0)
                })?,
                connection.query_row("SELECT COUNT(*) FROM _auth_session_tokens", [], |row| {
                    row.get(0)
                })?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_session_lifetime_facts_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, bool)> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT last_used_at_ms, expires_at_ms, generation,
                        revoked_at_ms IS NOT NULL
                     FROM _auth_sessions WHERE id = ?1",
                    params![session_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_delete_terminal_cause_witness_for_test(
        &mut self,
        session_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![
                    crate::contract_types::SessionTerminalCauseRecord::meta_key(
                        session_id
                    )?
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_session_revoked_for_test(&self, session_id: &str) -> SnapbackResult<i64> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )?)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_session_tombstone_for_test(
        &mut self,
        token_hash: &[u8],
        session_id: &str,
        superseded_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                 VALUES(?1, ?2, ?3)",
                params![token_hash, session_id, superseded_at_ms as i64],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_identity_subject_count_for_test(
        &self,
        subject: &str,
    ) -> SnapbackResult<i64> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT COUNT(*) FROM _auth_identities WHERE subject = ?1",
                params![subject],
                |row| row.get(0),
            )?)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_sender_issuance_facts_for_test(
        &self,
    ) -> SnapbackResult<(i64, i64, i64, String)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_family_binding",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_proof_replay",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT generation FROM _snapback_sender_nonce",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row("SELECT nonce FROM _snapback_sender_nonce", [], |row| {
                    row.get(0)
                })?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_sender_refusal_facts_for_test(
        &self,
    ) -> SnapbackResult<(i64, i64, i64, String, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_family_binding",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_proof_replay",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row("SELECT COUNT(*) FROM _snapback_sender_nonce", [], |row| {
                    row.get(0)
                })?,
                connection.query_row("SELECT nonce FROM _snapback_sender_nonce", [], |row| {
                    row.get(0)
                })?,
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_oldest_live_session_for_test(&self) -> SnapbackResult<String> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT id FROM _auth_sessions
                     WHERE revoked_at_ms IS NULL ORDER BY created_at_ms, id LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_live_session_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM _auth_sessions WHERE revoked_at_ms IS NULL",
                    [],
                    |row| row.get(0),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_human_user_for_test(
        &mut self,
        user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES(?1, ?2, 'human', NULL, NULL, NULL, NULL, NULL)",
                params![user_id, now_ms as i64],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_activation_live_grant_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT OR IGNORE INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:unrelatedLive', 'liveQuery', 0, 1, 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('activation-grant', 'activation-agent', 'activation-owner', ?1,
                          ?2, ?3, NULL, 'test', NULL, NULL, ?2)",
                params![
                    r#"[{"fn":"fn:listItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:unrelatedLive","kind":"liveQuery","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    now_ms.saturating_add(60_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_tombstone_scope_basis_for_test(
        &mut self,
        function_id: &str,
        kind: &str,
        authority_creating: bool,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_scope_bases
                 SET generation = generation + 1, present = 0
                 WHERE function_id = ?1 AND kind = ?2 AND authority_creating = ?3",
                params![function_id, kind, i64::from(authority_creating)],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_tombstone_allowed_query_scope_basis_for_test(
        &mut self,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_scope_bases
                 SET generation = generation + 1, present = 0
                 WHERE function_id = 'fn:allowed' AND kind = 'query'",
                [],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_install_service_replay_authority_for_test(
        &mut self,
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('user-a', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('agent-a', ?1, 'agent', 'Agent A', NULL, 'test', NULL, NULL)",
                params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_agent_credentials(
                   id, user_id, secret_hash, generation, created_at_ms,
                   rotated_at_ms, last_used_at_ms, revoked_at_ms
                 ) VALUES('credential-a', 'agent-a', ?1, 1, ?2, ?2, ?2, NULL)",
                params![vec![0x41_u8; 32], now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:hostInsert', 'mutation', 0, 1, 0)",
                [],
            )?;
            for grant_id in ["grant-a", "grant-b"] {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes, created_at_ms,
                       expires_at_ms, revoked_at_ms, created_by, request_id,
                       consent_digest, last_used_at_ms
                     ) VALUES(?1, 'agent-a', 'user-a', ?2, ?3, ?4, NULL,
                              'test', NULL, NULL, ?3)",
                    params![
                        grant_id,
                        r#"[{"fn":"fn:hostInsert","kind":"mutation","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
            }
            for (index, (token_id, grant_id)) in [
                ("token-a", "grant-a"),
                ("token-b", "grant-a"),
                ("token-c", "grant-a"),
                ("token-e", "grant-b"),
                ("token-x", "grant-b"),
                ("token-y", "grant-a"),
            ]
            .into_iter()
            .enumerate()
            {
                tx.execute(
                    "INSERT INTO _auth_grant_tokens(
                       id, token_hash, grant_id, credential_id,
                       credential_generation, created_at_ms, expires_at_ms,
                       revoked_at_ms
                     ) VALUES(?1, ?2, ?3, 'credential-a', 1, ?4, ?5, NULL)",
                    params![
                        token_id,
                        vec![u8::try_from(index + 1).expect("small token fixture index"); 32],
                        grant_id,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
            }
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_finite_authority_grant_for_test(
        &mut self,
        grant_id: &str,
        agent_user_id: &str,
        effective_user_id: &str,
        start_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6,
                          NULL, 'test', NULL, NULL, ?5)",
                params![
                    grant_id,
                    agent_user_id,
                    effective_user_id,
                    r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false},{"fn":"fn:liveItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:queuedWrite","kind":"mutation","basis":0,"authorityCreating":false},{"fn":"fn:writeAction","kind":"action","basis":0,"authorityCreating":false}]"#,
                    start_ms as i64,
                    (start_ms + 48 * 60 * 60 * 1_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_set_grant_expiry_for_test(
        &mut self,
        grant_id: &str,
        grant_deadline_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_grants SET expires_at_ms = ?1 WHERE id = ?2",
                params![grant_deadline_ms as i64, grant_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_sender_issuance_durable_counts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64, i64)> {
        self.with_auth_read(|connection| {
            Ok((
                connection.query_row(
                    "SELECT attempts FROM _auth_verification_codes
                     WHERE challenge_id = ?1",
                    [challenge_id],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_proof_replay",
                    [],
                    |row| row.get(0),
                )?,
                connection.query_row(
                    "SELECT COUNT(*) FROM _snapback_sender_family_binding",
                    [],
                    |row| row.get(0),
                )?,
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
                connection.query_row("SELECT COUNT(*) FROM _snapback_sender_nonce", [], |row| {
                    row.get(0)
                })?,
            ))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_sender_replay_for_test(
        &mut self,
        replay_id: &[u8],
        expires_at_seconds: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            // Seed under the durable sender replay namespace, not the
            // short-lived serving admission epoch (defect 10:
            // the two are distinct namespaces).
            transaction.execute(
                "INSERT INTO _snapback_sender_proof_replay(
                        admission_epoch, proof_id, expires_at_seconds
                     ) SELECT epoch, ?1, ?2
                       FROM _snapback_sender_replay_epoch
                       WHERE singleton = 1",
                params![replay_id, expires_at_seconds as i64],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_advance_sender_replay_epoch_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "UPDATE _snapback_sender_replay_epoch
                 SET epoch = epoch + 1 WHERE singleton = 1",
                [],
            )?;
            transaction.execute("DELETE FROM _snapback_sender_proof_replay", [])?;
            transaction.execute("DELETE FROM _snapback_sender_nonce", [])?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_query_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('018f0d90-7b30-7a22-8c33-445566778899', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:allowed', 'query', 0, 1, 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:liveItems', 'liveQuery', 0, 1, 0)",
                [],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:queuedWrite', 'mutation', 0, 1, 0)",
                [],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_query_carrier_grant_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('018f0d90-7b32-7a22-8c33-445566778899',
                          '018f0d90-7b31-7a22-8c33-445566778899',
                          '018f0d90-7b30-7a22-8c33-445566778899', ?1, ?2, ?3,
                          NULL, 'test', NULL, NULL, ?2)",
                params![
                    r#"[{"fn":"fn:allowed","kind":"query","basis":0,"authorityCreating":false},{"fn":"fn:liveItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:queuedWrite","kind":"mutation","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    (now_ms + 60_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_live_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_users(
                   id, created_at_ms, kind, display_name, operator_contact,
                   registration_provenance, deactivated_at_ms, owner_user_id
                 ) VALUES('018f0d90-7b30-7a22-8c33-445566778899', ?1, 'human', NULL, NULL, NULL, NULL, NULL)",
                params![now_ms as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES('fn:liveItems', 'liveQuery', 0, 1, 0)",
                [],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_live_carrier_grant_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('018f0d90-7b32-7a22-8c33-445566778899',
                          '018f0d90-7b31-7a22-8c33-445566778899',
                          '018f0d90-7b30-7a22-8c33-445566778899', ?1, ?2, ?3,
                          NULL, 'test', NULL, NULL, ?2)",
                params![
                    r#"[{"fn":"fn:liveItems","kind":"liveQuery","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    (now_ms + 60 * 60 * 1_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_set_agent_credential_rotated_at_for_test(
        &mut self,
        user_id: &str,
        rotated_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "UPDATE _auth_agent_credentials SET rotated_at_ms = ?1
                 WHERE user_id = ?2 AND revoked_at_ms IS NULL",
                params![rotated_at_ms as i64, user_id],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    #[allow(clippy::type_complexity)]
    pub(super) fn auth_agent_registration_facts_for_test(
        &self,
        user_id: &str,
    ) -> SnapbackResult<((String, Option<String>, String), i64, i64)> {
        self.with_auth_read(|connection| {
            let principal: (String, Option<String>, String) = connection.query_row(
                "SELECT kind, owner_user_id, registration_provenance
                 FROM _auth_users WHERE id = ?1",
                params![user_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            let credentials: i64 = connection.query_row(
                "SELECT COUNT(*) FROM _auth_agent_credentials WHERE user_id = ?1",
                params![user_id],
                |row| row.get(0),
            )?;
            let identities: i64 = connection.query_row(
                "SELECT COUNT(*) FROM _auth_identities
                 WHERE user_id = ?1 AND provider = 'agent-credential'",
                params![user_id],
                |row| row.get(0),
            )?;
            Ok((principal, credentials, identities))
        })
    }

    #[cfg(test)]
    pub(super) fn auth_invitation_consumption_for_test(
        &self,
        invitation_id: &str,
    ) -> SnapbackResult<(String, Option<String>)> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT created_by, consumed_by FROM _auth_agent_invitations WHERE id = ?1",
                    params![invitation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_agent_token_route_fixtures_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            let scopes =
                r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#;
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('route-grant', 'route-agent', 'grant-user', ?1, ?2, ?3,
                          NULL, 'test', 'route-pairing', NULL, ?2)",
                params![scopes, now_ms as i64, (now_ms + 60_000) as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES('route-pairing', zeroblob(32), 'grant-user', 'route-agent',
                          ?1, 'approved', 0, ?2, ?3, ?2, 'route-grant')",
                params![scopes, now_ms as i64, (now_ms + 60_000) as i64],
            )?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES('route-pending',
                          X'0101010101010101010101010101010101010101010101010101010101010101',
                          'grant-user', 'route-agent',
                          ?1, 'pending', 0, ?2, ?3, NULL, NULL)",
                params![scopes, now_ms as i64, (now_ms + 60_000) as i64],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_bulk_route_grants_for_test(
        &mut self,
        owner_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            for (grant_id, request_id) in [
                ("bulk-route-grant-a", "bulk-route-request-a"),
                ("bulk-route-grant-b", "bulk-route-request-b"),
            ] {
                tx.execute(
                    "INSERT INTO _auth_grants(
                       id, actor_user_id, effective_user_id, scopes,
                       created_at_ms, expires_at_ms, revoked_at_ms,
                       created_by, request_id, consent_digest, last_used_at_ms
                     ) VALUES(?1, 'bulk-route-agent', ?2, ?3, ?4, ?5,
                              NULL, 'test', ?6, NULL, ?4)",
                    params![
                        grant_id,
                        owner_id,
                        r#"[{"fn":"fn:listItems","kind":"query","basis":0,"authorityCreating":false}]"#,
                        now_ms as i64,
                        (now_ms + 60_000) as i64,
                        request_id,
                    ],
                )?;
            }
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_insert_step_up_scope_bases_for_test(&mut self) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_scope_bases(
                   function_id, kind, generation, present, authority_creating
                 ) VALUES
                   ('fn:seatRole', 'mutation', 0, 1, 1),
                   ('fn:listItems', 'query', 0, 1, 0)",
                [],
            )?;
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_assert_step_up_consumption_for_test(
        &self,
        bound_request: &str,
        challenge_id: &str,
        code: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_read(|connection| {
            let grants: i64 = connection.query_row(
                "SELECT COUNT(*) FROM _auth_grants WHERE request_id = ?1",
                params![bound_request],
                |row| row.get(0),
            )?;
            let plaintext_matches: i64 = connection.query_row(
                "SELECT COUNT(*) FROM _auth_verification_codes
                 WHERE challenge_id = ?1 AND code_digest = CAST(?2 AS BLOB)",
                params![challenge_id, code],
                |row| row.get(0),
            )?;
            let (attempts, consumed): (i64, bool) = connection.query_row(
                "SELECT attempts, consumed_at_ms IS NOT NULL
                 FROM _auth_verification_codes WHERE challenge_id = ?1",
                params![challenge_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!(grants, 1);
            assert_eq!(plaintext_matches, 0);
            assert_eq!(attempts, 3);
            assert!(consumed);
            Ok(())
        })
    }

    #[cfg(test)]
    pub(super) fn auth_verification_address_count_for_test(
        &self,
        address: &str,
    ) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE canonical_address = ?1",
                    [address],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }
}

enum AuthCatalogAccess<'a> {
    Read(&'a LocalDatabase),
    Write(&'a mut LocalDatabase),
}

/// Narrow typed access to protected auth-catalog operations.
///
/// @ref LLP 0225#1-ownership-map — auth services enter the storage
/// kernel through typed operations instead of a raw auth-catalog transaction.
pub struct AuthCatalogKernel<'a> {
    db: AuthCatalogAccess<'a>,
}

#[allow(private_interfaces)]
impl<'a> AuthCatalogKernel<'a> {
    pub(super) fn new(db: &'a mut LocalDatabase) -> Self {
        Self {
            db: AuthCatalogAccess::Write(db),
        }
    }

    pub(super) fn new_read(db: &'a LocalDatabase) -> Self {
        Self {
            db: AuthCatalogAccess::Read(db),
        }
    }

    fn read_db(&self) -> &LocalDatabase {
        match &self.db {
            AuthCatalogAccess::Read(db) => db,
            AuthCatalogAccess::Write(db) => db,
        }
    }

    fn write_db(&mut self) -> &mut LocalDatabase {
        match &mut self.db {
            AuthCatalogAccess::Write(db) => db,
            AuthCatalogAccess::Read(_) => {
                unreachable!("a mutating auth-catalog operation requires auth_catalog()")
            }
        }
    }

    pub fn step_up_address(
        &self,
        binding: &StepUpBinding,
        now_ms: u64,
    ) -> SnapbackResult<Option<String>> {
        self.read_db().auth_step_up_address(binding, now_ms)
    }

    pub fn challenge_coordination(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<Option<(String, String)>> {
        self.read_db().auth_challenge_coordination(challenge_id)
    }

    pub fn exchange_unknown(
        &mut self,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
        challenge_id: &ChallengeId,
        code: &VerificationCode,
        dummy_key: &AuthKeyMaterial,
        dummy_address: &CanonicalAddress,
    ) -> SnapbackResult<()> {
        self.write_db().auth_exchange_unknown(
            sender_issuance,
            challenge_id,
            code,
            dummy_key,
            dummy_address,
        )
    }

    pub fn lookup_presented_session(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<crate::auth::provider::PresentedSessionLookup> {
        self.read_db().auth_lookup_presented_session(token_hash)
    }

    pub fn lookup_presented_session_with_sender_binding(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<(crate::auth::provider::PresentedSessionLookup, bool)> {
        self.read_db()
            .auth_lookup_presented_session_with_sender_binding(token_hash)
    }

    pub fn attempt_planned_family_alarm(
        &mut self,
        plan: &ProviderFamilyAlarmPlan,
    ) -> super::auth::AuthTransactionAttempt<PlannedFamilyAlarmCommit> {
        self.write_db().auth_attempt_planned_family_alarm(plan)
    }

    pub fn attempt_planned_revocation(
        &mut self,
        plan: &ProviderRevocationPlan,
        now_ms: u64,
    ) -> super::auth::AuthTransactionAttempt<PlannedRevocationCommit> {
        self.write_db()
            .auth_attempt_planned_revocation(plan, now_ms)
    }

    pub fn reconcile_planned_revocation(
        &self,
        plan: &ProviderRevocationPlan,
        now_ms: u64,
    ) -> SnapbackResult<DurableRevocationReconcile> {
        self.read_db()
            .auth_reconcile_planned_revocation(plan, now_ms)
    }

    pub fn attempt_planned_rotation(
        &mut self,
        plan: &ProviderTokenRotationCommitPlan,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedRotationTransaction>,
        Option<PlannedRotationTransaction>,
    ) {
        self.write_db().auth_attempt_planned_rotation(plan)
    }

    pub fn reconcile_planned_rotation(
        &self,
        plan: &ProviderTokenRotationCommitPlan,
    ) -> SnapbackResult<DurableRotationReconcile> {
        self.read_db().auth_reconcile_planned_rotation(plan)
    }

    pub fn authenticated_use_row(
        &self,
        session_id: &str,
        expected_generation: u64,
    ) -> SnapbackResult<Option<AuthenticatedUseRow>> {
        self.read_db()
            .auth_authenticated_use_row(session_id, expected_generation)
    }

    pub fn record_authenticated_use(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        now_ms: u64,
    ) -> SnapbackResult<AuthenticatedUse> {
        self.write_db()
            .auth_record_authenticated_use(session_id, expected_generation, now_ms)
    }

    pub fn plan_exchange(
        &self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        now_ms: u64,
    ) -> SnapbackResult<PlannedExchange> {
        self.read_db()
            .auth_plan_exchange(provider, coordination, key, code, now_ms)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn commit_planned_rejection(
        &mut self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        now_ms: u64,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> SnapbackResult<RejectedExchangeOutcome> {
        self.write_db().auth_commit_planned_rejection(
            provider,
            coordination,
            key,
            code,
            now_ms,
            sender_issuance,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_step_up_challenge(
        &mut self,
        binding: &StepUpBinding,
        address: &CanonicalAddress,
        challenge_id: &ChallengeId,
        digest: &StepUpDigest,
        key_id: &str,
        now_ms: u64,
        expires_at_ms: u64,
        budget_policy: &ResolvedCompatibilityAuthBudgetPolicy,
    ) -> SnapbackResult<RequestInsertOutcome> {
        self.write_db().auth_insert_step_up_challenge(
            binding,
            address,
            challenge_id,
            digest,
            key_id,
            now_ms,
            expires_at_ms,
            budget_policy,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_verification_challenge(
        &mut self,
        address: &CanonicalAddress,
        challenge_id: &ChallengeId,
        digest: &CodeDigest,
        key_id: &str,
        now_ms: u64,
        expires_at_ms: u64,
        budget_policy: &ResolvedCompatibilityAuthBudgetPolicy,
    ) -> SnapbackResult<RequestInsertOutcome> {
        self.write_db().auth_insert_verification_challenge(
            address,
            challenge_id,
            digest,
            key_id,
            now_ms,
            expires_at_ms,
            budget_policy,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn insert_verification_challenge_for_rehearsal_window(
        &mut self,
        address: &CanonicalAddress,
        challenge_id: &ChallengeId,
        digest: &CodeDigest,
        key_id: &str,
        now_ms: u64,
        expires_at_ms: u64,
        budget_policy: &ResolvedCompatibilityAuthBudgetPolicy,
        window: &crate::auth::rehearsal::AuthRehearsalWindowV1,
    ) -> SnapbackResult<RequestInsertOutcome> {
        self.write_db().auth_insert_verification_challenge(
            address,
            challenge_id,
            digest,
            key_id,
            now_ms,
            expires_at_ms,
            budget_policy,
            Some(window),
        )
    }

    pub fn plan_session_issuance(
        &self,
        address: &CanonicalAddress,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<(
        crate::contract_types::PlannedIdentityState,
        Option<ProviderRevocationPlan>,
    )> {
        self.read_db()
            .auth_plan_session_issuance(address, candidate, now_ms)
    }

    pub fn attempt_planned_session_issuance(
        &mut self,
        plan: &ProviderSessionIssuanceCommitPlan,
        exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedIssuanceCommit>,
        Option<PlannedIssuanceCommit>,
    ) {
        self.write_db()
            .auth_attempt_planned_session_issuance(plan, exchange_proof)
    }

    pub fn reconcile_rejected_issuance(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<DurableRejectedIssuanceReconcile> {
        self.read_db().auth_reconcile_rejected_issuance(plan)
    }

    pub fn sender_key_bound_successor(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<bool> {
        self.read_db().auth_sender_key_bound_successor(plan)
    }

    pub fn reconcile_planned_issuance(
        &self,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> SnapbackResult<DurableIssuanceReconcile> {
        self.read_db().auth_reconcile_planned_issuance(plan)
    }

    #[cfg(test)]
    pub fn presented_token_sender_bound_for_test(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<bool> {
        self.read_db()
            .auth_presented_token_sender_bound_for_test(token_hash)
    }

    #[cfg(test)]
    pub fn refresh_for_test(
        &mut self,
        predecessor_hash: &TokenHash,
        successor_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::RefreshOutcome> {
        self.write_db()
            .auth_refresh_for_test(predecessor_hash, successor_hash, now_ms)
    }

    #[cfg(test)]
    pub fn logout_for_test(
        &mut self,
        token_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::LogoutOutcome> {
        self.write_db().auth_logout_for_test(token_hash, now_ms)
    }

    #[cfg(test)]
    pub fn family_alarm_for_test(
        &mut self,
        token_hash: &TokenHash,
        now_ms: u64,
    ) -> SnapbackResult<Option<crate::auth::provider::SessionRevocation>> {
        self.write_db()
            .auth_family_alarm_for_test(token_hash, now_ms)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn exchange_for_test(
        &mut self,
        provider: &AuthProvider,
        coordination: &ExchangeCoordination,
        key: &AuthKeyMaterial,
        code: &VerificationCode,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::provider::ExchangeOutcome> {
        self.write_db()
            .auth_exchange_for_test(provider, coordination, key, code, candidate, now_ms)
    }

    #[cfg(test)]
    pub fn mint_session_for_test(
        &mut self,
        address: &CanonicalAddress,
        candidate: &SessionCandidate,
        now_ms: u64,
    ) -> SnapbackResult<(
        crate::auth::wire::SessionResponse,
        Option<crate::auth::provider::SessionRevocation>,
    )> {
        self.write_db()
            .auth_mint_session_for_test(address, candidate, now_ms)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn insert_verification_code_for_test(
        &mut self,
        challenge_id: &str,
        address: &str,
        digest: &[u8],
        key_id: &str,
        requested_at_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_verification_code_for_test(
            challenge_id,
            address,
            digest,
            key_id,
            requested_at_ms,
            expires_at_ms,
        )
    }

    #[cfg(test)]
    pub fn catalog_version_for_test(&self) -> SnapbackResult<String> {
        self.read_db().auth_catalog_version_for_test()
    }

    #[cfg(test)]
    pub fn set_verification_key_id_for_test(&mut self, key_id: &str) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_verification_key_id_for_test(key_id)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn insert_restore_fixture_for_test(
        &mut self,
        session_id: &str,
        authority_instance_id: &str,
        token_hash: &[u8],
        challenge_id: &str,
        address: &str,
        code_digest: &[u8],
        key_id: &str,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_restore_fixture_for_test(
            session_id,
            authority_instance_id,
            token_hash,
            challenge_id,
            address,
            code_digest,
            key_id,
        )
    }

    #[cfg(test)]
    pub fn session_generation_revoked_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, Option<i64>)> {
        self.read_db()
            .auth_session_generation_revoked_for_test(session_id)
    }

    #[cfg(test)]
    pub fn verification_challenge_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_verification_challenge_count_for_test()
    }

    #[cfg(test)]
    pub fn insert_expired_challenges_for_test(&mut self, count: usize) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_expired_challenges_for_test(count)
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub fn insert_email_session_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        address: &str,
        token_hash: &[u8],
        created_at_ms: u64,
        last_used_at_ms: u64,
        expires_at_ms: u64,
        absolute_expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_email_session_for_test(
            user_id,
            identity_id,
            session_id,
            authority_instance_id,
            address,
            token_hash,
            created_at_ms,
            last_used_at_ms,
            expires_at_ms,
            absolute_expires_at_ms,
        )
    }

    #[cfg(test)]
    pub fn insert_email_session_and_push_token_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_email_session_and_push_token_for_test(
                user_id,
                identity_id,
                session_id,
                authority_instance_id,
                expires_at_ms,
            )
    }

    #[cfg(test)]
    pub fn insert_restore_cli_fixture_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        key_id: &str,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_restore_cli_fixture_for_test(
            user_id,
            identity_id,
            session_id,
            authority_instance_id,
            key_id,
        )
    }

    #[cfg(test)]
    pub fn restored_counts_for_test(&self, session_id: &str) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_restored_counts_for_test(session_id)
    }

    #[cfg(test)]
    pub fn session_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_session_count_for_test()
    }

    #[cfg(test)]
    pub fn change_journal_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_change_journal_count_for_test()
    }

    #[cfg(test)]
    pub fn challenge_issue_facts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64)> {
        self.read_db()
            .auth_challenge_issue_facts_for_test(challenge_id)
    }

    #[cfg(test)]
    pub fn challenge_attempts_and_sessions_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.read_db()
            .auth_challenge_attempts_and_sessions_for_test(challenge_id)
    }

    #[cfg(test)]
    pub fn provision_counts_for_test(&self) -> SnapbackResult<(i64, i64, i64)> {
        self.read_db().auth_provision_counts_for_test()
    }

    #[cfg(test)]
    pub fn current_and_tombstone_counts_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_current_and_tombstone_counts_for_test()
    }

    #[cfg(test)]
    pub fn session_cap_facts_for_test(
        &self,
        now_ms: u64,
        revoked_session_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.read_db()
            .auth_session_cap_facts_for_test(now_ms, revoked_session_id)
    }

    #[cfg(test)]
    pub fn tombstone_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_tombstone_count_for_test()
    }

    #[cfg(test)]
    pub fn sole_session_generation_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_sole_session_generation_for_test()
    }

    #[cfg(test)]
    pub fn sole_session_generation_revoked_for_test(&self) -> SnapbackResult<(i64, bool)> {
        self.read_db()
            .auth_sole_session_generation_revoked_for_test()
    }

    #[cfg(test)]
    pub fn generation_and_tombstones_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_generation_and_tombstones_for_test()
    }

    #[cfg(test)]
    pub fn session_lifetime_facts_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, bool)> {
        self.read_db()
            .auth_session_lifetime_facts_for_test(session_id)
    }

    #[cfg(test)]
    pub fn delete_terminal_cause_witness_for_test(
        &mut self,
        session_id: &str,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_delete_terminal_cause_witness_for_test(session_id)
    }

    #[cfg(test)]
    pub fn session_revoked_for_test(&self, session_id: &str) -> SnapbackResult<i64> {
        self.read_db().auth_session_revoked_for_test(session_id)
    }

    #[cfg(test)]
    pub fn insert_session_tombstone_for_test(
        &mut self,
        token_hash: &[u8],
        session_id: &str,
        superseded_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_session_tombstone_for_test(
            token_hash,
            session_id,
            superseded_at_ms,
        )
    }

    #[cfg(test)]
    pub fn identity_subject_count_for_test(&self, subject: &str) -> SnapbackResult<i64> {
        self.read_db().auth_identity_subject_count_for_test(subject)
    }

    #[cfg(test)]
    pub fn sender_issuance_facts_for_test(&self) -> SnapbackResult<(i64, i64, i64, String)> {
        self.read_db().auth_sender_issuance_facts_for_test()
    }

    #[cfg(test)]
    pub fn sender_refusal_facts_for_test(&self) -> SnapbackResult<(i64, i64, i64, String, i64)> {
        self.read_db().auth_sender_refusal_facts_for_test()
    }

    #[cfg(test)]
    pub fn oldest_live_session_for_test(&self) -> SnapbackResult<String> {
        self.read_db().auth_oldest_live_session_for_test()
    }

    #[cfg(test)]
    pub fn live_session_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_live_session_count_for_test()
    }

    #[cfg(test)]
    pub fn insert_human_user_for_test(&mut self, user_id: &str, now_ms: u64) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_human_user_for_test(user_id, now_ms)
    }

    #[cfg(test)]
    pub fn insert_activation_live_grant_for_test(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_activation_live_grant_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn tombstone_scope_basis_for_test(
        &mut self,
        function_id: &str,
        kind: &str,
        authority_creating: bool,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_tombstone_scope_basis_for_test(function_id, kind, authority_creating)
    }

    #[cfg(test)]
    pub fn tombstone_allowed_query_scope_basis_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db()
            .auth_tombstone_allowed_query_scope_basis_for_test()
    }

    #[cfg(test)]
    pub fn install_service_replay_authority_for_test(
        &mut self,
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_install_service_replay_authority_for_test(now_ms, expires_at_ms)
    }

    #[cfg(test)]
    pub fn insert_finite_authority_grant_for_test(
        &mut self,
        grant_id: &str,
        agent_user_id: &str,
        effective_user_id: &str,
        start_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_finite_authority_grant_for_test(
            grant_id,
            agent_user_id,
            effective_user_id,
            start_ms,
        )
    }

    #[cfg(test)]
    pub fn set_grant_expiry_for_test(
        &mut self,
        grant_id: &str,
        grant_deadline_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_grant_expiry_for_test(grant_id, grant_deadline_ms)
    }

    #[cfg(test)]
    pub fn sender_issuance_durable_counts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64, i64)> {
        self.read_db()
            .auth_sender_issuance_durable_counts_for_test(challenge_id)
    }

    #[cfg(test)]
    pub fn insert_sender_replay_for_test(
        &mut self,
        replay_id: &[u8],
        expires_at_seconds: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_sender_replay_for_test(replay_id, expires_at_seconds)
    }

    #[cfg(test)]
    pub fn advance_sender_replay_epoch_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db().auth_advance_sender_replay_epoch_for_test()
    }

    #[cfg(test)]
    pub fn insert_query_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_query_carrier_prerequisites_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn insert_query_carrier_grant_for_test(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_query_carrier_grant_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn insert_live_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_live_carrier_prerequisites_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn insert_live_carrier_grant_for_test(&mut self, now_ms: u64) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_live_carrier_grant_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn set_agent_credential_rotated_at_for_test(
        &mut self,
        user_id: &str,
        rotated_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_agent_credential_rotated_at_for_test(user_id, rotated_at_ms)
    }

    #[cfg(test)]
    #[allow(clippy::type_complexity)]
    pub fn agent_registration_facts_for_test(
        &self,
        user_id: &str,
    ) -> SnapbackResult<((String, Option<String>, String), i64, i64)> {
        self.read_db()
            .auth_agent_registration_facts_for_test(user_id)
    }

    #[cfg(test)]
    pub fn invitation_consumption_for_test(
        &self,
        invitation_id: &str,
    ) -> SnapbackResult<(String, Option<String>)> {
        self.read_db()
            .auth_invitation_consumption_for_test(invitation_id)
    }

    #[cfg(test)]
    pub fn insert_agent_token_route_fixtures_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_agent_token_route_fixtures_for_test(now_ms)
    }

    #[cfg(test)]
    pub fn insert_bulk_route_grants_for_test(
        &mut self,
        owner_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_bulk_route_grants_for_test(owner_id, now_ms)
    }

    #[cfg(test)]
    pub fn insert_step_up_scope_bases_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db().auth_insert_step_up_scope_bases_for_test()
    }

    #[cfg(test)]
    pub fn assert_step_up_consumption_for_test(
        &self,
        bound_request: &str,
        challenge_id: &str,
        code: &str,
    ) -> SnapbackResult<()> {
        self.read_db()
            .auth_assert_step_up_consumption_for_test(bound_request, challenge_id, code)
    }

    #[cfg(test)]
    pub fn verification_address_count_for_test(&self, address: &str) -> SnapbackResult<i64> {
        self.read_db()
            .auth_verification_address_count_for_test(address)
    }
}
