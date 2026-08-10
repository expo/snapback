//! Protected companion storage for LLP 0213 auth rehearsal grants.

use super::LocalDatabase;
use crate::auth::crypto::RehearsalBearer;
use crate::auth::rehearsal::{
    AUTH_REHEARSAL_GRANT_KIND, AUTH_REHEARSAL_STATUS_KIND, AuthRehearsalGrantV1,
    MintedRehearsalGrant, RehearsalBindingFacts, RehearsalConsumedV1, RehearsalCounter,
    RehearsalEffect, RehearsalExerciseRequestV1, RehearsalMintRequestV1, authority_ended,
    binding_mismatch, budget_exhausted, expired, idempotency_conflict, request_invalid,
    scope_denied, selector_denied,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use rusqlite::{OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

const GRANTS: &str = "_snapback_auth_rehearsal_grants";
const IDEMPOTENCY: &str = "_snapback_auth_rehearsal_idempotency";
const MINT_IDEMPOTENCY: &str = "_snapback_auth_rehearsal_mint_idempotency";
const AUDIT: &str = "_snapback_auth_rehearsal_audit";
const MARKERS: &str = "_snapback_auth_rehearsal_store_markers";

#[derive(Debug)]
pub(crate) struct RehearsalMintPlan {
    pub request: RehearsalMintRequestV1,
    pub bindings: RehearsalBindingFacts,
    pub carrier: RehearsalBearer,
    pub now_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredIdempotencyOutcome {
    ok: bool,
    code: Option<String>,
    data: serde_json::Value,
}

#[derive(Clone, Debug)]
pub(crate) enum RehearsalExerciseOutcome {
    Fresh(serde_json::Value),
    Replay(serde_json::Value),
}

#[derive(Clone, Debug)]
pub(crate) struct RehearsalExercisePlan {
    pub carrier_hash: [u8; 32],
    pub bindings: RehearsalBindingFacts,
    pub request: RehearsalExerciseRequestV1,
    pub resolved_contact: Option<crate::auth::crypto::CanonicalAddress>,
    pub semantic_success: bool,
    pub outcome: serde_json::Value,
    pub now_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RehearsalRemainingV1 {
    pub challenge_attempts: u64,
    pub identity_creates: u64,
    pub session_mints: u64,
    pub verification_simulations: u64,
    pub window_installs: u64,
    pub clock_advances: u64,
    pub allocation_units: u64,
    pub uses: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RehearsalStatusRowV1 {
    pub grant_id: String,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
    pub terminal_reason: Option<String>,
    pub remaining: RehearsalRemainingV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RehearsalStatusV1 {
    pub kind: String,
    pub grants: Vec<RehearsalStatusRowV1>,
}

impl LocalDatabase {
    /// Pre-activation startup check used by production. It deliberately tests
    /// only for the protected table namespace; it never parses grants or
    /// inspects carrier digests.
    ///
    /// @ref LLP 0213#startup-refusal — production rejects protected
    ///   rehearsal state before provider activation or listener bind.
    pub(crate) fn auth_rehearsal_state_present_at_open(&self) -> SnapbackResult<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE '_snapback_auth_rehearsal_%'",
            [],
            |row| row.get(0),
        )?;
        Ok(count != 0)
    }

    pub(crate) fn auth_rehearsal_resolve(
        &mut self,
        carrier_hash: &[u8; 32],
        bindings: &RehearsalBindingFacts,
        now_ms: u64,
    ) -> SnapbackResult<AuthRehearsalGrantV1> {
        let outcome = self.with_auth_transaction(|transaction| {
            if !table_exists(transaction, GRANTS)? {
                return Ok(Err(crate::auth::rehearsal::carrier_required()));
            }
            let Some(grant) = load_grant_by_carrier(transaction, carrier_hash)? else {
                return Ok(Err(crate::auth::rehearsal::carrier_required()));
            };
            if let Err(error) = bindings.validate_grant(&grant, now_ms) {
                if error.diagnostic.code == "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH" {
                    transaction.execute(
                        &format!("UPDATE {GRANTS} SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), terminal_reason = COALESCE(terminal_reason, 'bindingMismatch') WHERE grant_id = ?1"),
                        params![grant.grant_id, now_ms as i64],
                    )?;
                }
                return Ok(Err(error));
            }
            Ok(Ok(grant))
        })?;
        outcome
    }

    /// Mint one immutable grant, carrier digest, initial counters, marker
    /// substrate, idempotency binding, and audit fact in one IMMEDIATE auth
    /// transaction. Plaintext carrier never enters SQLite.
    ///
    /// @ref LLP 0213#grant-minting — mint is all-or-nothing and storage is
    ///   protected outside the app schema.
    pub(crate) fn auth_rehearsal_mint(
        &mut self,
        plan: RehearsalMintPlan,
    ) -> SnapbackResult<MintedRehearsalGrant> {
        plan.request.validate(plan.now_ms)?;
        if !plan.bindings.deployment_profile.permits_rehearsal() {
            return Err(crate::auth::rehearsal::profile_forbidden());
        }
        if !plan.bindings.sessions_settled_available {
            return Err(binding_mismatch());
        }
        let request_digest = plan.request.normalized_digest()?;
        let carrier_hash = plan.carrier.token_hash();
        let carrier_hash_text = format!(
            "sha256:{:x}",
            Sha256::digest(plan.carrier.expose_secret().as_bytes())
        );
        let grant_id = uuid::Uuid::now_v7().to_string();
        let grant = AuthRehearsalGrantV1 {
            kind: AUTH_REHEARSAL_GRANT_KIND.to_owned(),
            grant_id: grant_id.clone(),
            instance_id: plan.bindings.instance_id.clone(),
            boot_nonce: plan.bindings.boot_nonce.clone(),
            app_id: plan.bindings.app_id.clone(),
            activation_digest: plan.bindings.activation_digest.clone(),
            sessions_mode_generation: plan.bindings.sessions_mode_generation,
            deployment_profile: plan.bindings.deployment_profile,
            scopes: plan.request.scopes.clone(),
            effect_selectors: plan.request.effect_selectors.clone(),
            limits: plan.request.limits.clone(),
            consumed: RehearsalConsumedV1::default(),
            created_at: plan.now_ms,
            expires_at: plan.request.expires_at,
            revoked_at: None,
            created_by: crate::auth::rehearsal::RehearsalCreatedByV1 {
                operator_audit_id: plan.request.operator_audit_id.clone(),
                mint_request_digest: request_digest.clone(),
            },
            carrier_hash: carrier_hash_text,
        };
        grant.validate_record()?;
        let record_json = serde_json::to_string(&grant).map_err(|_| request_invalid())?;
        let idempotency_key = plan.request.idempotency_key.clone();
        let operator_audit_id = plan.request.operator_audit_id.clone();
        let outcome = self.with_auth_transaction(|transaction| {
            ensure_tables(transaction)?;
            let existing: Option<(String, String)> = transaction
                .query_row(
                    &format!("SELECT request_digest, grant_id FROM {MINT_IDEMPOTENCY} WHERE operator_audit_id = ?1 AND idempotency_key = ?2"),
                    params![operator_audit_id, idempotency_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((existing_digest, existing_grant)) = existing {
                return Ok(if existing_digest == request_digest {
                    MintTransactionOutcome::ReplayUnavailable(existing_grant)
                } else {
                    MintTransactionOutcome::Conflict
                });
            }
            transaction.execute(
                &format!("INSERT INTO {GRANTS}(grant_id, carrier_hash, record_json, revoked_at_ms, terminal_reason, challenge_attempts, identity_creates, session_mints, verification_simulations, window_installs, clock_advances, allocation_units, uses_charged) VALUES(?1, ?2, ?3, NULL, NULL, 0, 0, 0, 0, 0, 0, 0, 0)"),
                params![grant_id, carrier_hash.as_bytes().as_slice(), record_json],
            )?;
            transaction.execute(
                &format!("INSERT INTO {MINT_IDEMPOTENCY}(operator_audit_id, idempotency_key, request_digest, grant_id, created_at_ms) VALUES(?1, ?2, ?3, ?4, ?5)"),
                params![operator_audit_id, idempotency_key, request_digest, grant_id, plan.now_ms as i64],
            )?;
            insert_audit(
                transaction,
                &grant_id,
                None,
                "minted",
                "none",
                &request_digest,
                "{}",
                "{}",
                plan.now_ms,
            )?;
            Ok(MintTransactionOutcome::Minted)
        })?;
        match outcome {
            MintTransactionOutcome::Minted => Ok(MintedRehearsalGrant::new(grant, plan.carrier)),
            MintTransactionOutcome::Conflict => Err(idempotency_conflict()),
            // Digest-only-at-rest means a lost mint response cannot be
            // reconstructed into plaintext. Fail closed rather than minting a
            // second carrier or returning a different grant.
            MintTransactionOutcome::ReplayUnavailable(_grant_id) => Err(authority_ended()),
        }
    }

    pub(crate) fn auth_rehearsal_revoke(
        &mut self,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<RehearsalStatusV1> {
        let grant_id = grant_id.to_owned();
        let outcome = self.with_auth_transaction(|transaction| {
            ensure_tables(transaction)?;
            let changed = transaction.execute(
                &format!("UPDATE {GRANTS} SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), terminal_reason = COALESCE(terminal_reason, 'revoked') WHERE grant_id = ?1"),
                params![grant_id, now_ms as i64],
            )?;
            if changed == 0 {
                return Ok(false);
            }
            insert_audit(
                transaction,
                &grant_id,
                None,
                "revoked",
                "none",
                "sha256:operator-revoke",
                "{}",
                "{}",
                now_ms,
            )?;
            Ok(true)
        })?;
        if !outcome {
            return Err(authority_ended());
        }
        self.auth_rehearsal_status(Some(&grant_id), now_ms)
    }

    pub(crate) fn auth_rehearsal_status(
        &self,
        grant_id: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<RehearsalStatusV1> {
        self.with_auth_read(|connection| {
            if !table_exists(connection, GRANTS)? {
                return Ok(RehearsalStatusV1 {
                    kind: AUTH_REHEARSAL_STATUS_KIND.to_owned(),
                    grants: Vec::new(),
                });
            }
            let mut statement = if grant_id.is_some() {
                connection.prepare(&format!("SELECT record_json, revoked_at_ms, terminal_reason, challenge_attempts, identity_creates, session_mints, verification_simulations, window_installs, clock_advances, allocation_units, uses_charged FROM {GRANTS} WHERE grant_id = ?1 ORDER BY grant_id"))?
            } else {
                connection.prepare(&format!("SELECT record_json, revoked_at_ms, terminal_reason, challenge_attempts, identity_creates, session_mints, verification_simulations, window_installs, clock_advances, allocation_units, uses_charged FROM {GRANTS} ORDER BY grant_id"))?
            };
            let mut rows = if let Some(grant_id) = grant_id {
                statement.query(params![grant_id])?
            } else {
                statement.query([])?
            };
            let mut grants = Vec::new();
            while let Some(row) = rows.next()? {
                let mut grant: AuthRehearsalGrantV1 = serde_json::from_str(&row.get::<_, String>(0)?)
                    .map_err(|_| request_invalid())?;
                grant.revoked_at = row
                    .get::<_, Option<i64>>(1)?
                    .and_then(|value| u64::try_from(value).ok());
                grant.consumed = RehearsalConsumedV1 {
                    challenge_attempts: u64_column(row.get(3)?)?,
                    identity_creates: u64_column(row.get(4)?)?,
                    session_mints: u64_column(row.get(5)?)?,
                    verification_simulations: u64_column(row.get(6)?)?,
                    window_installs: u64_column(row.get(7)?)?,
                    clock_advances: u64_column(row.get(8)?)?,
                    allocation_units: u64_column(row.get(9)?)?,
                    uses_charged: u64_column(row.get(10)?)?,
                };
                grant.validate_record()?;
                let terminal_reason = row.get::<_, Option<String>>(2)?.or_else(|| {
                    (now_ms >= grant.expires_at).then(|| "expired".to_owned())
                });
                grants.push(status_row(&grant, terminal_reason));
            }
            Ok(RehearsalStatusV1 {
                kind: AUTH_REHEARSAL_STATUS_KIND.to_owned(),
                grants,
            })
        })
    }

    /// Resolve, bind, idempotency-check, charge, mark, and audit one
    /// process-local or already-linearized slice-1 effect in one IMMEDIATE
    /// transaction. Denials are values rather than transaction errors so their
    /// ATTEMPT debt commits.
    ///
    /// @ref LLP 0213#atomic-charge-at-linearization — no capture secret may be
    ///   released until this durable accounting and first-use marker commits.
    /// @ref LLP 0215#6-idempotency-and-retry-identity — exact retries are free; changed requests
    ///   on the same key are charged denials.
    pub(crate) fn auth_rehearsal_exercise(
        &mut self,
        plan: RehearsalExercisePlan,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        let result =
            self.with_auth_transaction(|transaction| apply_exercise_in(transaction, &plan))?;
        result.into_result()
    }
}

enum MintTransactionOutcome {
    Minted,
    Conflict,
    ReplayUnavailable(String),
}

enum ExerciseTransactionOutcome {
    Fresh(serde_json::Value),
    Replay(serde_json::Value),
    Denied(SnapbackError),
}

impl ExerciseTransactionOutcome {
    fn into_result(self) -> SnapbackResult<RehearsalExerciseOutcome> {
        match self {
            Self::Fresh(value) => Ok(RehearsalExerciseOutcome::Fresh(value)),
            Self::Replay(value) => Ok(RehearsalExerciseOutcome::Replay(value)),
            Self::Denied(error) => Err(error),
        }
    }
}

fn apply_exercise_in(
    transaction: &Transaction<'_>,
    plan: &RehearsalExercisePlan,
) -> SnapbackResult<ExerciseTransactionOutcome> {
    ensure_tables(transaction)?;
    let Some(mut grant) = load_grant_by_carrier(transaction, &plan.carrier_hash)? else {
        return Ok(ExerciseTransactionOutcome::Denied(
            crate::auth::rehearsal::carrier_required(),
        ));
    };
    let request_digest = plan.request.normalized_digest()?;
    let binding_error = match plan.bindings.validate_grant(&grant, plan.now_ms) {
        Ok(()) => None,
        Err(error) => Some(error),
    };
    if let Some(error) = binding_error {
        if error.diagnostic.code == "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH" {
            transaction.execute(
                &format!("UPDATE {GRANTS} SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), terminal_reason = COALESCE(terminal_reason, 'bindingMismatch') WHERE grant_id = ?1"),
                params![grant.grant_id, plan.now_ms as i64],
            )?;
        }
        return Ok(ExerciseTransactionOutcome::Denied(error));
    }
    let stored: Option<(String, String)> = transaction
        .query_row(
            &format!("SELECT request_digest, outcome_json FROM {IDEMPOTENCY} WHERE grant_id = ?1 AND effect = ?2 AND idempotency_key = ?3"),
            params![grant.grant_id, plan.request.effect().as_str(), plan.request.idempotency_key()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((stored_digest, stored_outcome)) = stored {
        if stored_digest == request_digest {
            let outcome: StoredIdempotencyOutcome =
                serde_json::from_str(&stored_outcome).map_err(|_| request_invalid())?;
            if outcome.ok {
                return Ok(ExerciseTransactionOutcome::Replay(outcome.data));
            }
            return Ok(ExerciseTransactionOutcome::Denied(replayed_denial(
                outcome.code.as_deref(),
            )));
        }
        return charge_denial(
            transaction,
            &mut grant,
            plan,
            &request_digest,
            idempotency_conflict(),
            false,
        );
    }
    // Universal and challenge ATTEMPT counters charge before scope/selector
    // checks. A budget denial itself still consumes every earlier applicable
    // attempt counter without exceeding a fixed total.
    let mut charged = grant.consumed.clone();
    if charged.uses_charged >= grant.limits.max_uses {
        return persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            budget_exhausted("maxUses"),
            &charged,
        );
    }
    charged.uses_charged += 1;
    if plan.request.effect().is_attempt_counter() {
        if charged.challenge_attempts >= grant.limits.challenge_attempts {
            write_consumed(transaction, &grant.grant_id, &charged)?;
            return persist_denial(
                transaction,
                &grant,
                plan,
                &request_digest,
                budget_exhausted("challengeAttempts"),
                &charged,
            );
        }
        charged.challenge_attempts += 1;
    }
    write_consumed(transaction, &grant.grant_id, &charged)?;

    if !grant.scopes.contains(&plan.request.effect()) {
        return persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            scope_denied(),
            &charged,
        );
    }
    if !crate::auth::rehearsal::selector_allows(
        &grant,
        &plan.request,
        plan.resolved_contact.as_ref(),
    ) {
        return persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            selector_denied(),
            &charged,
        );
    }
    if plan.semantic_success && !plan.request.effect().is_attempt_counter() {
        let before = charged.for_effect(plan.request.effect());
        let limit = grant.limits.for_effect(plan.request.effect());
        if before >= limit {
            return persist_denial(
                transaction,
                &grant,
                plan,
                &request_digest,
                budget_exhausted(counter_name(plan.request.effect().counter())),
                &charged,
            );
        }
        increment_success_counter(&mut charged, plan.request.effect(), 1)?;
        write_consumed(transaction, &grant.grant_id, &charged)?;
    }
    if !plan.semantic_success {
        return persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            authority_ended(),
            &charged,
        );
    }
    transaction.execute(
        &format!("INSERT INTO {MARKERS}(singleton, rehearsal_admitted, first_admission_grant_digest, admitted_at_ms) VALUES(1, 1, ?1, ?2) ON CONFLICT(singleton) DO NOTHING"),
        params![format!("sha256:{:x}", Sha256::digest(grant.grant_id.as_bytes())), plan.now_ms as i64],
    )?;
    persist_idempotency(
        transaction,
        &grant,
        plan,
        &request_digest,
        StoredIdempotencyOutcome {
            ok: true,
            code: None,
            data: plan.outcome.clone(),
        },
    )?;
    insert_audit(
        transaction,
        &grant.grant_id,
        Some(plan.request.effect()),
        "succeeded",
        selector_class(plan.request.effect()),
        &request_digest,
        &serde_json::to_string(&grant.consumed).map_err(|_| request_invalid())?,
        &serde_json::to_string(&charged).map_err(|_| request_invalid())?,
        plan.now_ms,
    )?;
    Ok(ExerciseTransactionOutcome::Fresh(plan.outcome.clone()))
}

fn charge_denial(
    transaction: &Transaction<'_>,
    grant: &mut AuthRehearsalGrantV1,
    plan: &RehearsalExercisePlan,
    request_digest: &str,
    error: SnapbackError,
    record_idempotency: bool,
) -> SnapbackResult<ExerciseTransactionOutcome> {
    let mut charged = grant.consumed.clone();
    if charged.uses_charged < grant.limits.max_uses {
        charged.uses_charged += 1;
    }
    if plan.request.effect().is_attempt_counter()
        && charged.challenge_attempts < grant.limits.challenge_attempts
    {
        charged.challenge_attempts += 1;
    }
    write_consumed(transaction, &grant.grant_id, &charged)?;
    if !record_idempotency {
        insert_audit(
            transaction,
            &grant.grant_id,
            Some(plan.request.effect()),
            "idempotencyConflict",
            selector_class(plan.request.effect()),
            request_digest,
            &serde_json::to_string(&grant.consumed).map_err(|_| request_invalid())?,
            &serde_json::to_string(&charged).map_err(|_| request_invalid())?,
            plan.now_ms,
        )?;
        return Ok(ExerciseTransactionOutcome::Denied(error));
    }
    persist_denial(transaction, grant, plan, request_digest, error, &charged)
}

fn persist_denial(
    transaction: &Transaction<'_>,
    grant: &AuthRehearsalGrantV1,
    plan: &RehearsalExercisePlan,
    request_digest: &str,
    error: SnapbackError,
    charged: &RehearsalConsumedV1,
) -> SnapbackResult<ExerciseTransactionOutcome> {
    persist_idempotency(
        transaction,
        grant,
        plan,
        request_digest,
        StoredIdempotencyOutcome {
            ok: false,
            code: Some(error.diagnostic.code.clone()),
            data: serde_json::Value::Object(Default::default()),
        },
    )?;
    insert_audit(
        transaction,
        &grant.grant_id,
        Some(plan.request.effect()),
        "denied",
        selector_class(plan.request.effect()),
        request_digest,
        &serde_json::to_string(&grant.consumed).map_err(|_| request_invalid())?,
        &serde_json::to_string(charged).map_err(|_| request_invalid())?,
        plan.now_ms,
    )?;
    Ok(ExerciseTransactionOutcome::Denied(error))
}

fn persist_idempotency(
    transaction: &Transaction<'_>,
    grant: &AuthRehearsalGrantV1,
    plan: &RehearsalExercisePlan,
    request_digest: &str,
    outcome: StoredIdempotencyOutcome,
) -> SnapbackResult<()> {
    transaction.execute(
        &format!("INSERT INTO {IDEMPOTENCY}(grant_id, effect, idempotency_key, request_digest, outcome_json, created_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6)"),
        params![
            grant.grant_id,
            plan.request.effect().as_str(),
            plan.request.idempotency_key(),
            request_digest,
            serde_json::to_string(&outcome).map_err(|_| request_invalid())?,
            plan.now_ms as i64,
        ],
    )?;
    Ok(())
}

fn load_grant_by_carrier(
    transaction: &rusqlite::Connection,
    carrier_hash: &[u8; 32],
) -> SnapbackResult<Option<AuthRehearsalGrantV1>> {
    let row: Option<(String, Option<i64>, Option<String>, i64, i64, i64, i64, i64, i64, i64, i64)> = transaction
        .query_row(
            &format!("SELECT record_json, revoked_at_ms, terminal_reason, challenge_attempts, identity_creates, session_mints, verification_simulations, window_installs, clock_advances, allocation_units, uses_charged FROM {GRANTS} WHERE carrier_hash = ?1"),
            params![carrier_hash.as_slice()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?, row.get(10)?)),
        )
        .optional()?;
    row.map(
        |(
            json,
            revoked,
            _reason,
            challenge,
            identity,
            session,
            verification,
            window,
            clock,
            allocation,
            uses,
        )| {
            let mut grant: AuthRehearsalGrantV1 =
                serde_json::from_str(&json).map_err(|_| request_invalid())?;
            grant.revoked_at = revoked.and_then(|value| u64::try_from(value).ok());
            grant.consumed = RehearsalConsumedV1 {
                challenge_attempts: u64_column(challenge)?,
                identity_creates: u64_column(identity)?,
                session_mints: u64_column(session)?,
                verification_simulations: u64_column(verification)?,
                window_installs: u64_column(window)?,
                clock_advances: u64_column(clock)?,
                allocation_units: u64_column(allocation)?,
                uses_charged: u64_column(uses)?,
            };
            grant.validate_record()?;
            Ok(grant)
        },
    )
    .transpose()
}

fn ensure_tables(transaction: &Transaction<'_>) -> SnapbackResult<()> {
    // Companion names deliberately avoid `_auth_*`: the exact LLP 0057 auth
    // catalog marker/version remains unchanged while these rows are still
    // protected by the same recognized-catalog transaction boundary.
    transaction.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {GRANTS}(
            grant_id TEXT PRIMARY KEY,
            carrier_hash BLOB NOT NULL UNIQUE CHECK(length(carrier_hash) = 32),
            record_json TEXT NOT NULL,
            revoked_at_ms INTEGER,
            terminal_reason TEXT,
            challenge_attempts INTEGER NOT NULL,
            identity_creates INTEGER NOT NULL,
            session_mints INTEGER NOT NULL,
            verification_simulations INTEGER NOT NULL,
            window_installs INTEGER NOT NULL,
            clock_advances INTEGER NOT NULL,
            allocation_units INTEGER NOT NULL,
            uses_charged INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS {IDEMPOTENCY}(
            grant_id TEXT NOT NULL,
            effect TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_digest TEXT NOT NULL,
            outcome_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY(grant_id, effect, idempotency_key),
            FOREIGN KEY(grant_id) REFERENCES {GRANTS}(grant_id)
        );
        CREATE TABLE IF NOT EXISTS {MINT_IDEMPOTENCY}(
            operator_audit_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_digest TEXT NOT NULL,
            grant_id TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            PRIMARY KEY(operator_audit_id, idempotency_key),
            FOREIGN KEY(grant_id) REFERENCES {GRANTS}(grant_id)
        );
        CREATE TABLE IF NOT EXISTS {AUDIT}(
            audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
            grant_id TEXT NOT NULL,
            effect TEXT,
            outcome_class TEXT NOT NULL,
            selector_class TEXT NOT NULL,
            idempotency_digest TEXT NOT NULL,
            counters_before_json TEXT NOT NULL,
            counters_after_json TEXT NOT NULL,
            occurred_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS {MARKERS}(
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            rehearsal_admitted INTEGER NOT NULL CHECK(rehearsal_admitted = 1),
            first_admission_grant_digest TEXT NOT NULL,
            admitted_at_ms INTEGER NOT NULL
        );"
    ))?;
    Ok(())
}

fn table_exists(connection: &rusqlite::Connection, table: &str) -> SnapbackResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn write_consumed(
    transaction: &Transaction<'_>,
    grant_id: &str,
    consumed: &RehearsalConsumedV1,
) -> SnapbackResult<()> {
    let changed = transaction.execute(
        &format!("UPDATE {GRANTS} SET challenge_attempts = ?2, identity_creates = ?3, session_mints = ?4, verification_simulations = ?5, window_installs = ?6, clock_advances = ?7, allocation_units = ?8, uses_charged = ?9 WHERE grant_id = ?1"),
        params![
            grant_id,
            consumed.challenge_attempts as i64,
            consumed.identity_creates as i64,
            consumed.session_mints as i64,
            consumed.verification_simulations as i64,
            consumed.window_installs as i64,
            consumed.clock_advances as i64,
            consumed.allocation_units as i64,
            consumed.uses_charged as i64,
        ],
    )?;
    if changed != 1 {
        return Err(binding_mismatch());
    }
    Ok(())
}

fn increment_success_counter(
    consumed: &mut RehearsalConsumedV1,
    effect: RehearsalEffect,
    quantity: u64,
) -> SnapbackResult<()> {
    let target = match effect.counter() {
        RehearsalCounter::ChallengeAttempts => &mut consumed.challenge_attempts,
        RehearsalCounter::IdentityCreates => &mut consumed.identity_creates,
        RehearsalCounter::SessionMints => &mut consumed.session_mints,
        RehearsalCounter::VerificationSimulations => &mut consumed.verification_simulations,
        RehearsalCounter::WindowInstalls => &mut consumed.window_installs,
        RehearsalCounter::ClockAdvances => &mut consumed.clock_advances,
        RehearsalCounter::AllocationUnits => &mut consumed.allocation_units,
    };
    *target = target.checked_add(quantity).ok_or_else(request_invalid)?;
    Ok(())
}

fn status_row(
    grant: &AuthRehearsalGrantV1,
    terminal_reason: Option<String>,
) -> RehearsalStatusRowV1 {
    let remaining = |limit: u64, consumed: u64| limit.saturating_sub(consumed);
    RehearsalStatusRowV1 {
        grant_id: grant.grant_id.clone(),
        expires_at: grant.expires_at,
        revoked_at: grant.revoked_at,
        terminal_reason,
        remaining: RehearsalRemainingV1 {
            challenge_attempts: remaining(
                grant.limits.challenge_attempts,
                grant.consumed.challenge_attempts,
            ),
            identity_creates: remaining(
                grant.limits.identity_creates,
                grant.consumed.identity_creates,
            ),
            session_mints: remaining(grant.limits.session_mints, grant.consumed.session_mints),
            verification_simulations: remaining(
                grant.limits.verification_simulations,
                grant.consumed.verification_simulations,
            ),
            window_installs: remaining(
                grant.limits.window_installs,
                grant.consumed.window_installs,
            ),
            clock_advances: remaining(grant.limits.clock_advances, grant.consumed.clock_advances),
            allocation_units: remaining(
                grant.limits.allocation_ceiling,
                grant.consumed.allocation_units,
            ),
            uses: remaining(grant.limits.max_uses, grant.consumed.uses_charged),
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn insert_audit(
    transaction: &Transaction<'_>,
    grant_id: &str,
    effect: Option<RehearsalEffect>,
    outcome: &str,
    selector_class: &str,
    idempotency_digest: &str,
    before: &str,
    after: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    // @ref LLP 0213#effect-execution-and-audit — audit contains only ids,
    //   effect/selector/outcome classes, digests, counters, and time; never
    //   carrier, contact, code, session bearer, or raw payload.
    transaction.execute(
        &format!("INSERT INTO {AUDIT}(grant_id, effect, outcome_class, selector_class, idempotency_digest, counters_before_json, counters_after_json, occurred_at_ms) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![grant_id, effect.map(RehearsalEffect::as_str), outcome, selector_class, idempotency_digest, before, after, now_ms as i64],
    )?;
    Ok(())
}

fn selector_class(effect: RehearsalEffect) -> &'static str {
    match effect {
        RehearsalEffect::ChallengeCapture | RehearsalEffect::ChallengeRedeem => "contacts",
        RehearsalEffect::FixtureIdentityCreate | RehearsalEffect::FixtureSessionMint => "fixtures",
        RehearsalEffect::VerificationSimulate => "identities",
        RehearsalEffect::WindowInstall => "windowPlans",
        RehearsalEffect::BudgetRehearsalAllocate => "allocations",
        RehearsalEffect::ClockAuthAdvance => "authClock",
    }
}

fn counter_name(counter: RehearsalCounter) -> &'static str {
    match counter {
        RehearsalCounter::ChallengeAttempts => "challengeAttempts",
        RehearsalCounter::IdentityCreates => "identityCreates",
        RehearsalCounter::SessionMints => "sessionMints",
        RehearsalCounter::VerificationSimulations => "verificationSimulations",
        RehearsalCounter::WindowInstalls => "windowInstalls",
        RehearsalCounter::ClockAdvances => "clockAdvances",
        RehearsalCounter::AllocationUnits => "allocationCeiling",
    }
}

fn u64_column(value: i64) -> SnapbackResult<u64> {
    u64::try_from(value).map_err(|_| request_invalid())
}

fn replayed_denial(code: Option<&str>) -> SnapbackError {
    match code {
        Some("SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT") => idempotency_conflict(),
        Some("SNAPBACK_AUTH_REHEARSAL_SCOPE_DENIED") => scope_denied(),
        Some("SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED") => selector_denied(),
        Some("SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED") => budget_exhausted("recorded"),
        Some("SNAPBACK_AUTH_REHEARSAL_EXPIRED") => expired(),
        Some("SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH") => binding_mismatch(),
        _ => authority_ended(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CanonicalAddress, OsRandom, RehearsalBearer};
    use crate::auth::rehearsal::{
        ContactEffectSelectorV1, ContactSelectorV1, EffectSelectorsV1, RehearsalDeploymentProfile,
    };

    fn binding(boot_nonce: &str) -> RehearsalBindingFacts {
        RehearsalBindingFacts {
            instance_id: uuid::Uuid::now_v7().to_string(),
            boot_nonce: boot_nonce.to_owned(),
            app_id: "acceptance-app".to_owned(),
            activation_digest: format!("sha256:{}", "a".repeat(64)),
            sessions_mode_generation: 7,
            deployment_profile: RehearsalDeploymentProfile::Test,
            sessions_settled_available: true,
        }
    }

    fn mint_request(address: &CanonicalAddress, now_ms: u64) -> RehearsalMintRequestV1 {
        RehearsalMintRequestV1 {
            scopes: vec![RehearsalEffect::ChallengeCapture],
            effect_selectors: EffectSelectorsV1 {
                challenge_capture: Some(ContactEffectSelectorV1 {
                    contacts: vec![ContactSelectorV1::ExactContact {
                        canonical_address_digest: crate::auth::rehearsal::contact_digest(address),
                    }],
                }),
                ..Default::default()
            },
            limits: crate::auth::rehearsal::RehearsalLimitsV1 {
                challenge_attempts: 3,
                max_uses: 3,
                ..Default::default()
            },
            expires_at: now_ms + 60_000,
            idempotency_key: "mint-1".to_owned(),
            operator_audit_id: "operator-acceptance".to_owned(),
        }
    }

    #[test]
    fn rehearsal_mint_refuses_profile_and_unsettled_session_conjuncts() {
        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();

        let mut prod = binding("boot-prod");
        prod.deployment_profile = RehearsalDeploymentProfile::Prod;
        assert_eq!(
            db.auth_rehearsal_mint(RehearsalMintPlan {
                request: mint_request(&address, now_ms),
                bindings: prod,
                carrier: RehearsalBearer::generate(&OsRandom).unwrap(),
                now_ms,
            })
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_PROFILE_FORBIDDEN"
        );

        let mut unsettled = binding("boot-unsettled");
        unsettled.sessions_settled_available = false;
        assert_eq!(
            db.auth_rehearsal_mint(RehearsalMintPlan {
                request: mint_request(&address, now_ms),
                bindings: unsettled,
                carrier: RehearsalBearer::generate(&OsRandom).unwrap(),
                now_ms,
            })
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH"
        );
        assert!(!db.auth_rehearsal_state_present_at_open().unwrap());
    }

    #[test]
    fn protected_accounting_charges_denial_and_exact_replay_is_free() {
        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-a");
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        assert!(!db.auth_rehearsal_state_present_at_open().unwrap());
        let minted = db
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: mint_request(&address, now_ms),
                bindings: bindings.clone(),
                carrier,
                now_ms,
            })
            .unwrap();
        assert!(db.auth_rehearsal_state_present_at_open().unwrap());
        let grant_id = minted.grant.grant_id.clone();
        let hash = *RehearsalBearer::parse(&carrier_text)
            .unwrap()
            .token_hash()
            .as_bytes();
        let request = RehearsalExerciseRequestV1::ChallengeCapture {
            idempotency_key: "capture-1".to_owned(),
            challenge_id: "sbc_AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
            fixture_namespace: None,
        };
        let plan = |request: RehearsalExerciseRequestV1| RehearsalExercisePlan {
            carrier_hash: hash,
            bindings: bindings.clone(),
            request,
            resolved_contact: Some(address.clone()),
            semantic_success: true,
            outcome: serde_json::json!({ "captured": true }),
            now_ms,
        };
        assert!(matches!(
            db.auth_rehearsal_exercise(plan(request.clone())).unwrap(),
            RehearsalExerciseOutcome::Fresh(_)
        ));
        let after_first = db.auth_rehearsal_status(Some(&grant_id), now_ms).unwrap();
        assert_eq!(after_first.grants[0].remaining.uses, 2);
        assert_eq!(after_first.grants[0].remaining.challenge_attempts, 2);

        assert!(matches!(
            db.auth_rehearsal_exercise(plan(request)).unwrap(),
            RehearsalExerciseOutcome::Replay(_)
        ));
        assert_eq!(
            db.auth_rehearsal_status(Some(&grant_id), now_ms)
                .unwrap()
                .grants[0]
                .remaining
                .uses,
            2
        );

        let conflict = RehearsalExerciseRequestV1::ChallengeCapture {
            idempotency_key: "capture-1".to_owned(),
            challenge_id: "sbc_BBBBBBBBBBBBBBBBBBBBBB".to_owned(),
            fixture_namespace: None,
        };
        assert_eq!(
            db.auth_rehearsal_exercise(plan(conflict))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_IDEMPOTENCY_CONFLICT"
        );
        let after_conflict = db.auth_rehearsal_status(Some(&grant_id), now_ms).unwrap();
        assert_eq!(after_conflict.grants[0].remaining.uses, 1);
        assert_eq!(after_conflict.grants[0].remaining.challenge_attempts, 1);

        let mismatched = RehearsalExerciseRequestV1::ChallengeCapture {
            idempotency_key: "capture-selector-mismatch".to_owned(),
            challenge_id: "sbc_CCCCCCCCCCCCCCCCCCCCCC".to_owned(),
            fixture_namespace: None,
        };
        let mismatch_plan = RehearsalExercisePlan {
            resolved_contact: Some(CanonicalAddress::parse("other@example.test").unwrap()),
            ..plan(mismatched)
        };
        assert_eq!(
            db.auth_rehearsal_exercise(mismatch_plan)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_SELECTOR_DENIED"
        );
        let exhausted = RehearsalExerciseRequestV1::ChallengeCapture {
            idempotency_key: "capture-exhausted".to_owned(),
            challenge_id: "sbc_DDDDDDDDDDDDDDDDDDDDDD".to_owned(),
            fixture_namespace: None,
        };
        assert_eq!(
            db.auth_rehearsal_exercise(plan(exhausted.clone()))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED"
        );
        assert_eq!(
            db.auth_rehearsal_exercise(plan(exhausted))
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_BUDGET_EXHAUSTED"
        );
        let final_status = db.auth_rehearsal_status(Some(&grant_id), now_ms).unwrap();
        assert_eq!(final_status.grants[0].remaining.uses, 0);
        assert_eq!(final_status.grants[0].remaining.challenge_attempts, 0);
    }

    #[test]
    fn boot_nonce_mismatch_is_terminal_and_unknown_hash_is_nonenumerating() {
        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-a");
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db.auth_rehearsal_mint(RehearsalMintPlan {
            request: mint_request(&address, now_ms),
            bindings: bindings.clone(),
            carrier,
            now_ms,
        })
        .unwrap();
        let hash = *RehearsalBearer::parse(&carrier_text)
            .unwrap()
            .token_hash()
            .as_bytes();
        let mut restarted = bindings;
        restarted.boot_nonce = "boot-b".to_owned();
        assert_eq!(
            db.auth_rehearsal_resolve(&hash, &restarted, now_ms)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH"
        );
        let mut prod = restarted;
        prod.deployment_profile = RehearsalDeploymentProfile::Prod;
        assert_eq!(
            db.auth_rehearsal_resolve(&[0_u8; 32], &prod, now_ms)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_CARRIER_REQUIRED"
        );
    }
}
