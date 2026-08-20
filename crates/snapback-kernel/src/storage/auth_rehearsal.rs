//! Protected companion storage for LLP 0213 auth rehearsal grants.

use super::LocalDatabase;
use crate::auth::crypto::RehearsalBearer;
use crate::auth::rehearsal::{
    AUTH_REHEARSAL_GRANT_KIND, AUTH_REHEARSAL_STATUS_KIND, AUTH_REHEARSAL_STORE_MARKERS_KIND,
    AUTH_REHEARSAL_WINDOW_KIND, AuthRehearsalExportEnvelopeV1, AuthRehearsalGrantV1,
    AuthRehearsalLogicalExportArtifactV1, AuthRehearsalLogicalExportPayloadV1,
    AuthRehearsalSnapshotWitnessV1, AuthRehearsalStoreMarkersV1, AuthRehearsalWindowV1,
    MintedRehearsalGrant, MintedWindowNamespaceV1, RehearsalBindingFacts, RehearsalConsumedV1,
    RehearsalCounter, RehearsalEffect, RehearsalExerciseRequestV1, RehearsalMintRequestV1,
    RehearsalReachabilityAdmissionV1, authority_ended, binding_mismatch, budget_exhausted,
    disposable_required, expired, export_key_unavailable, idempotency_conflict, namespace_consumed,
    namespace_unavailable, request_invalid, scope_denied, selector_denied, state_present,
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
const DERIVED_IDENTITIES: &str = "_snapback_auth_rehearsal_identities";
const DERIVED_SESSIONS: &str = "_snapback_auth_rehearsal_sessions";
const WINDOW_RESERVATIONS: &str = "_snapback_auth_rehearsal_window_reservations";
const WINDOWS: &str = "_snapback_auth_rehearsal_windows";
const WINDOW_CHALLENGES: &str = "_snapback_auth_rehearsal_window_challenges";

pub struct RehearsalMintPlan {
    pub request: RehearsalMintRequestV1,
    pub bindings: RehearsalBindingFacts,
    pub carrier: RehearsalBearer,
    pub window_namespace_candidates: Vec<[zeroize::Zeroizing<String>; 3]>,
    pub now_ms: u64,
}

#[derive(Clone, Debug)]
pub struct RehearsalWindowInstallPlan {
    pub exercise: RehearsalExercisePlan,
    pub reachability: RehearsalReachabilityAdmissionV1,
}

#[derive(Clone, Debug)]
pub struct RehearsalWindowChallengeDerivation {
    pub window: AuthRehearsalWindowV1,
    pub carrier_hash: [u8; 32],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredIdempotencyOutcome {
    ok: bool,
    code: Option<String>,
    data: serde_json::Value,
}

#[derive(Clone, Debug)]
pub enum RehearsalExerciseOutcome {
    Fresh(serde_json::Value),
    Replay(serde_json::Value),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RehearsalExercisePlan {
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
pub struct RehearsalRemainingV1 {
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
pub struct RehearsalStatusRowV1 {
    pub grant_id: String,
    pub expires_at: u64,
    pub revoked_at: Option<u64>,
    pub terminal_reason: Option<String>,
    pub remaining: RehearsalRemainingV1,
}

#[derive(Clone, Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RehearsalStatusV1 {
    pub kind: String,
    pub grants: Vec<RehearsalStatusRowV1>,
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
impl LocalDatabase {
    /// Pre-activation startup check used by production. It deliberately tests
    /// only for the protected table namespace; it never parses grants or
    /// inspects carrier digests.
    ///
    /// @ref LLP 0213#startup-refusal — production rejects protected
    ///   rehearsal state before provider activation or listener bind.
    pub fn auth_rehearsal_state_present_at_open(&self) -> SnapbackResult<bool> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name LIKE '_snapback_auth_rehearsal_%'",
            [],
            |row| row.get(0),
        )?;
        Ok(count != 0)
    }

    pub fn auth_rehearsal_resolve(
        &mut self,
        carrier_hash: &[u8; 32],
        bindings: &RehearsalBindingFacts,
        now_ms: u64,
    ) -> SnapbackResult<AuthRehearsalGrantV1> {
        self.with_auth_transaction(|transaction| {
            if !table_exists(transaction, GRANTS)? {
                return Ok(Err(crate::auth::rehearsal::carrier_required()));
            }
            let Some(grant) = load_grant_by_carrier(transaction, carrier_hash)? else {
                return Ok(Err(crate::auth::rehearsal::carrier_required()));
            };
            if let Err(error) = bindings.validate_grant(&grant, now_ms) {
                let error: SnapbackError = error.into();
                if error.diagnostic.code == "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH" {
                    transaction.execute(
                        &format!("UPDATE {GRANTS} SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), terminal_reason = COALESCE(terminal_reason, 'bindingMismatch') WHERE grant_id = ?1"),
                        params![grant.grant_id, now_ms as i64],
                    )?;
                }
                if matches!(
                    error.diagnostic.code.as_str(),
                    "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH"
                        | "SNAPBACK_AUTH_REHEARSAL_EXPIRED"
                        | "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
                ) {
                    terminalize_grant_windows_in(transaction, &grant.grant_id, now_ms)?;
                }
                return Ok(Err(error));
            }
            Ok(Ok(grant))
        })?
    }

    /// Mint one immutable grant, carrier digest, initial counters, marker
    /// substrate, idempotency binding, and audit fact in one IMMEDIATE auth
    /// transaction. Plaintext carrier never enters SQLite.
    ///
    /// @ref LLP 0213#grant-minting — mint is all-or-nothing and storage is
    ///   protected outside the app schema.
    pub fn auth_rehearsal_mint(
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
        let idempotency_key = plan.request.idempotency_key.clone();
        let operator_audit_id = plan.request.operator_audit_id.clone();
        let outcome = self.with_auth_transaction(|transaction| {
            ensure_tables(transaction)?;
            let _ = ensure_store_markers_in(transaction, false)?;
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
            let (effect_selectors, window_namespaces) = reserve_window_namespaces_in(
                transaction,
                &grant_id,
                &plan.request,
                &plan.window_namespace_candidates,
            )?;
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
                effect_selectors,
                limits: plan.request.limits.clone(),
                consumed: RehearsalConsumedV1::default(),
                created_at: plan.now_ms,
                expires_at: plan.request.expires_at,
                revoked_at: None,
                created_by: crate::auth::rehearsal::RehearsalCreatedByV1 {
                    operator_audit_id: plan.request.operator_audit_id.clone(),
                    mint_request_digest: request_digest.clone(),
                },
                carrier_hash: carrier_hash_text.clone(),
            };
            grant.validate_record()?;
            let record_json = serde_json::to_string(&grant).map_err(|_| request_invalid())?;
            transaction.execute(
                &format!("INSERT INTO {GRANTS}(grant_id, carrier_hash, record_json, revoked_at_ms, terminal_reason, challenge_attempts, identity_creates, session_mints, verification_simulations, window_installs, clock_advances, allocation_units, uses_charged) VALUES(?1, ?2, ?3, NULL, NULL, 0, 0, 0, 0, 0, 0, 0, 0)"),
                params![grant_id, carrier_hash.as_bytes().as_slice(), record_json],
            )?;
            insert_window_reservations_in(transaction, &grant, plan.now_ms)?;
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
            Ok(MintTransactionOutcome::Minted {
                grant,
                window_namespaces,
            })
        })?;
        match outcome {
            MintTransactionOutcome::Minted {
                grant,
                window_namespaces,
            } => Ok(MintedRehearsalGrant::new(
                grant,
                plan.carrier,
                window_namespaces,
            )),
            MintTransactionOutcome::Conflict => Err(idempotency_conflict()),
            // Digest-only-at-rest means a lost mint response cannot be
            // reconstructed into plaintext. Fail closed rather than minting a
            // second carrier or returning a different grant.
            MintTransactionOutcome::ReplayUnavailable(_grant_id) => Err(authority_ended()),
        }
    }

    pub fn auth_rehearsal_revoke(
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
            terminalize_grant_windows_in(transaction, &grant_id, now_ms)?;
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

    pub fn auth_rehearsal_status(
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
    pub fn auth_rehearsal_exercise(
        &mut self,
        plan: RehearsalExercisePlan,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        let result =
            self.with_auth_transaction(|transaction| apply_exercise_in(transaction, &plan))?;
        result.into_result()
    }

    pub fn auth_rehearsal_create_identity(
        &mut self,
        exercise: RehearsalExercisePlan,
        identity: crate::contract_types::PlannedIdentityState,
        address: &crate::auth::crypto::CanonicalAddress,
        provenance: &crate::auth::rehearsal::AuthRehearsalProvenanceV1,
        governing_not_after_ms: u64,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        let address = address.clone();
        let provenance = provenance.clone();
        let result = self.with_auth_transaction(|transaction| {
            let admission = prepare_rehearsal_atomic_effect_in(transaction, &exercise)?;
            let prepared = match admission {
                RehearsalAtomicEffectAdmission::Replay(value) => {
                    return Ok(ExerciseTransactionOutcome::Replay(value));
                }
                RehearsalAtomicEffectAdmission::Denied(error) => {
                    return Ok(ExerciseTransactionOutcome::Denied(error));
                }
                RehearsalAtomicEffectAdmission::Admitted(prepared) => prepared,
            };
            let (identity_id, user_id) = match &identity {
                crate::contract_types::PlannedIdentityState::Create {
                    identity_id,
                    user_id,
                } => (identity_id.clone(), user_id.clone()),
                crate::contract_types::PlannedIdentityState::Existing { .. } => {
                    finish_rehearsal_atomic_effect_denial_in(
                        transaction,
                        &exercise,
                        prepared,
                        authority_ended(),
                    )?;
                    return Ok(ExerciseTransactionOutcome::Denied(authority_ended()));
                }
            };
            let durable: Option<String> = transaction
                .query_row(
                    "SELECT id FROM _auth_identities WHERE provider = 'email-code' AND subject = ?1",
                    params![address.as_str()],
                    |row| row.get(0),
                )
                .optional()?;
            if durable.is_some() {
                finish_rehearsal_atomic_effect_denial_in(
                    transaction,
                    &exercise,
                    prepared,
                    authority_ended(),
                )?;
                return Ok(ExerciseTransactionOutcome::Denied(authority_ended()));
            }
            transaction.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![user_id, exercise.now_ms as i64],
            )?;
            if matches!(
                super::auth::inspect_auth_catalog_on(transaction)?,
                super::auth::AuthCatalogState::ReadyV3
                    | super::auth::AuthCatalogState::ReadyV4
            ) {
                // @ref LLP 0214#35-identity-link-relation — rehearsal-created
                // email links carry the same complete v3 descriptor as the
                // ordinary email-code provider.
                transaction.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, kind, provider, issuer, subject,
                       canonical_value, created_at_ms, verified_at_ms,
                       disabled_at_ms
                     ) VALUES(?1, ?2, 'email', 'email-code', NULL, ?3, ?3,
                              ?4, ?4, NULL)",
                    params![identity_id, user_id, address.as_str(), exercise.now_ms as i64],
                )?;
            } else {
                transaction.execute(
                    "INSERT INTO _auth_identities(
                       id, user_id, provider, subject, verified_at_ms
                     ) VALUES(?1, ?2, 'email-code', ?3, ?4)",
                    params![identity_id, user_id, address.as_str(), exercise.now_ms as i64],
                )?;
            }
            insert_rehearsal_identity_provenance_for_provider_in(
                transaction,
                &identity_id,
                &provenance,
                governing_not_after_ms,
                exercise.now_ms,
            )?;
            let outcome = serde_json::json!({
                "kind": "authRehearsalIdentity.v1",
                "identityId": identity_id,
                "userId": user_id,
            });
            finish_rehearsal_atomic_effect_success_in(
                transaction,
                &exercise,
                prepared,
                outcome.clone(),
            )?;
            Ok(ExerciseTransactionOutcome::Fresh(outcome))
        })?;
        result.into_result()
    }

    /// Install one precommitted namespace. The reservation consumption,
    /// window row, separate counters, parent accounting, audit, idempotency,
    /// and first-use marker share this transaction.
    ///
    /// @ref LLP 0213#installation — installation consumes, rather than
    ///   returns-and-reaccepts, the mint-time namespace reservation.
    pub fn auth_rehearsal_install_window(
        &mut self,
        plan: RehearsalWindowInstallPlan,
    ) -> SnapbackResult<(RehearsalExerciseOutcome, AuthRehearsalWindowV1)> {
        let result = self.with_auth_transaction(|transaction| {
            let admission = prepare_rehearsal_atomic_effect_in(transaction, &plan.exercise)?;
            let prepared = match admission {
                RehearsalAtomicEffectAdmission::Replay(value) => {
                    let window: AuthRehearsalWindowV1 = serde_json::from_value(value.clone())
                        .map_err(|_| request_invalid())?;
                    window.validate_record()?;
                    return Ok(WindowInstallTransactionOutcome::Replay(value, window));
                }
                RehearsalAtomicEffectAdmission::Denied(error) => {
                    return Ok(WindowInstallTransactionOutcome::Denied(error));
                }
                RehearsalAtomicEffectAdmission::Admitted(prepared) => prepared,
            };
            if let Err(error) = plan.reachability.validate_for_install() {
                let error: SnapbackError = error.into();
                finish_rehearsal_atomic_effect_denial_in(
                    transaction,
                    &plan.exercise,
                    prepared,
                    error.clone(),
                )?;
                return Ok(WindowInstallTransactionOutcome::Denied(error));
            }
            let RehearsalExerciseRequestV1::WindowInstall {
                window_plan_id, ..
            } = &plan.exercise.request
            else {
                return Err(request_invalid());
            };
            let selector = prepared
                .grant
                .effect_selectors
                .window_install
                .as_ref()
                .and_then(|selector| {
                    selector
                        .window_plans
                        .iter()
                        .find(|candidate| candidate.window_plan_id == *window_plan_id)
                })
                .ok_or_else(selector_denied)?;
            let state: Option<String> = transaction
                .query_row(
                    &format!("SELECT state FROM {WINDOW_RESERVATIONS} WHERE window_plan_id = ?1 AND grant_id = ?2"),
                    params![window_plan_id, prepared.grant.grant_id],
                    |row| row.get(0),
                )
                .optional()?;
            if state.as_deref() != Some("reserved") {
                let error = namespace_consumed();
                finish_rehearsal_atomic_effect_denial_in(
                    transaction,
                    &plan.exercise,
                    prepared,
                    error.clone(),
                )?;
                return Ok(WindowInstallTransactionOutcome::Denied(error));
            }
            let window = AuthRehearsalWindowV1 {
                kind: AUTH_REHEARSAL_WINDOW_KIND.to_owned(),
                window_id: uuid::Uuid::now_v7().to_string(),
                grant_id: prepared.grant.grant_id.clone(),
                window_plan_id: selector.window_plan_id.clone(),
                namespace_digest: selector.namespace_digest.clone(),
                instance_id: prepared.grant.instance_id.clone(),
                boot_nonce: prepared.grant.boot_nonce.clone(),
                app_id: prepared.grant.app_id.clone(),
                activation_digest: prepared.grant.activation_digest.clone(),
                created_at: plan.exercise.now_ms,
                expires_at: selector.expires_no_later_than.min(prepared.grant.expires_at),
                revoked_at: None,
            };
            window.validate_record()?;
            let changed = transaction.execute(
                &format!("UPDATE {WINDOW_RESERVATIONS} SET state = 'installed', window_id = ?2 WHERE window_plan_id = ?1 AND state = 'reserved'"),
                params![window_plan_id, window.window_id],
            )?;
            if changed != 1 {
                return Err(namespace_consumed());
            }
            transaction.execute(
                &format!("INSERT INTO {WINDOWS}(window_id, grant_id, window_plan_id, record_json, revoked_at_ms, challenge_attempts, verification_simulations, session_mints) VALUES(?1, ?2, ?3, ?4, NULL, 0, 0, 0)"),
                params![
                    window.window_id,
                    window.grant_id,
                    window.window_plan_id,
                    serde_json::to_string(&window).map_err(|_| request_invalid())?,
                ],
            )?;
            let outcome = serde_json::to_value(&window).map_err(|_| request_invalid())?;
            finish_rehearsal_atomic_effect_success_in(
                transaction,
                &plan.exercise,
                prepared,
                outcome.clone(),
            )?;
            Ok(WindowInstallTransactionOutcome::Fresh(outcome, window))
        })?;
        match result {
            WindowInstallTransactionOutcome::Fresh(value, window) => {
                Ok((RehearsalExerciseOutcome::Fresh(value), window))
            }
            WindowInstallTransactionOutcome::Replay(value, window) => {
                Ok((RehearsalExerciseOutcome::Replay(value), window))
            }
            WindowInstallTransactionOutcome::Denied(error) => Err(error),
        }
    }

    /// Match an ordinary canonical contact to one live installed window. The
    /// request supplies no rehearsal authority; equality against the 192-bit
    /// namespace commitment is the sole selector input.
    pub fn auth_rehearsal_window_for_contact(
        &self,
        address: &crate::auth::crypto::CanonicalAddress,
        bindings: &RehearsalBindingFacts,
        now_ms: u64,
    ) -> SnapbackResult<Option<AuthRehearsalWindowV1>> {
        self.with_auth_read(|connection| {
            if !table_exists(connection, WINDOWS)? {
                return Ok(None);
            }
            let Some((_, domain)) = address.as_str().rsplit_once('@') else {
                return Ok(None);
            };
            if !crate::auth::rehearsal::valid_window_namespace(domain) {
                return Ok(None);
            }
            let digest = crate::auth::rehearsal::window_namespace_digest(domain)?;
            let row: Option<(String, Option<i64>)> = connection
                .query_row(
                    &format!("SELECT window.record_json, window.revoked_at_ms FROM {WINDOWS} AS window JOIN {WINDOW_RESERVATIONS} AS reservation ON reservation.window_plan_id = window.window_plan_id WHERE reservation.namespace_digest = ?1 AND reservation.state = 'installed'"),
                    params![digest],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((json, revoked_at)) = row else {
                return Ok(None);
            };
            let mut window: AuthRehearsalWindowV1 =
                serde_json::from_str(&json).map_err(|_| request_invalid())?;
            window.revoked_at = revoked_at.and_then(|value| u64::try_from(value).ok());
            window.validate_record()?;
            if window.revoked_at.is_some()
                || now_ms >= window.expires_at
                || window.instance_id != bindings.instance_id
                || window.boot_nonce != bindings.boot_nonce
                || window.app_id != bindings.app_id
                || window.activation_digest != bindings.activation_digest
                || !bindings.deployment_profile.permits_rehearsal()
                || !bindings.sessions_settled_available
            {
                return Ok(None);
            }
            let grant = load_grant_by_id(connection, &window.grant_id)?
                .ok_or_else(authority_ended)?;
            if bindings.validate_grant(&grant, now_ms).is_err() {
                return Ok(None);
            }
            Ok(Some(window))
        })
    }

    /// Recover the server-only window authority attached to an ordinary
    /// challenge. The challenge id is a durable provider predecessor, not an
    /// authority supplied by the client.
    pub fn auth_rehearsal_window_for_challenge(
        &self,
        challenge_id: &str,
        bindings: &RehearsalBindingFacts,
        now_ms: u64,
    ) -> SnapbackResult<Option<RehearsalWindowChallengeDerivation>> {
        self.with_auth_read(|connection| {
            if !table_exists(connection, WINDOW_CHALLENGES)? {
                return Ok(None);
            }
            let row: Option<(String, Vec<u8>)> = connection
                .query_row(
                    &format!(
                        "SELECT window.record_json, grant.carrier_hash
                         FROM {WINDOW_CHALLENGES} AS challenge
                         JOIN {WINDOWS} AS window ON window.window_id = challenge.window_id
                         JOIN {GRANTS} AS grant ON grant.grant_id = window.grant_id
                         WHERE challenge.challenge_id = ?1
                           AND window.revoked_at_ms IS NULL
                           AND grant.revoked_at_ms IS NULL
                           AND grant.terminal_reason IS NULL"
                    ),
                    params![challenge_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let Some((window_json, carrier_hash)) = row else {
                return Ok(None);
            };
            let window: AuthRehearsalWindowV1 =
                serde_json::from_str(&window_json).map_err(|_| request_invalid())?;
            window.validate_record()?;
            if now_ms >= window.expires_at
                || window.instance_id != bindings.instance_id
                || window.boot_nonce != bindings.boot_nonce
                || window.app_id != bindings.app_id
                || window.activation_digest != bindings.activation_digest
                || !bindings.deployment_profile.permits_rehearsal()
                || !bindings.sessions_settled_available
            {
                return Ok(None);
            }
            let grant =
                load_grant_by_id(connection, &window.grant_id)?.ok_or_else(authority_ended)?;
            if bindings.validate_grant(&grant, now_ms).is_err() {
                return Ok(None);
            }
            let carrier_hash: [u8; 32] = carrier_hash.try_into().map_err(|_| request_invalid())?;
            Ok(Some(RehearsalWindowChallengeDerivation {
                window,
                carrier_hash,
            }))
        })
    }

    pub fn auth_rehearsal_store_markers(&mut self) -> SnapbackResult<AuthRehearsalStoreMarkersV1> {
        self.with_auth_transaction(|transaction| {
            ensure_tables(transaction)?;
            ensure_store_markers_in(transaction, false)
        })
    }

    /// Mark a truly empty store disposable. This creation-time choice cannot
    /// be applied after app/auth rows or an earlier marker exist.
    pub fn auth_rehearsal_mark_disposable_at_creation(
        &mut self,
    ) -> SnapbackResult<AuthRehearsalStoreMarkersV1> {
        self.with_auth_transaction(|transaction| {
            ensure_tables(transaction)?;
            if load_store_markers_in(transaction)?.is_some()
                || !store_is_creation_empty(transaction)?
            {
                return Err(state_present());
            }
            ensure_store_markers_in(transaction, true)
        })
    }

    pub fn auth_rehearsal_require_production_eligible(&self) -> SnapbackResult<()> {
        self.with_auth_read(|connection| {
            let Some(markers) = load_store_markers_in(connection)? else {
                return Ok(());
            };
            markers.validate()?;
            if markers.production_ineligible() {
                return Err(state_present());
            }
            Ok(())
        })
    }

    /// Advance only this disposable store's durable auth floor. The selector,
    /// marker check, counter charge, first-admission transition, prior/successor
    /// witness, and floor write share one transaction.
    ///
    /// @ref LLP 0213#disposable-at-creation-stores-and-auth-clock — ordinary
    ///   stores never accept a clock-lab input into LLP 0059's durable floor.
    pub fn auth_rehearsal_advance_auth_clock(
        &mut self,
        exercise: RehearsalExercisePlan,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        let outcome = self.with_auth_transaction(|transaction| {
            let admission = prepare_rehearsal_atomic_effect_in(transaction, &exercise)?;
            let prepared = match admission {
                RehearsalAtomicEffectAdmission::Replay(value) => {
                    return Ok(ExerciseTransactionOutcome::Replay(value));
                }
                RehearsalAtomicEffectAdmission::Denied(error) => {
                    return Ok(ExerciseTransactionOutcome::Denied(error));
                }
                RehearsalAtomicEffectAdmission::Admitted(prepared) => prepared,
            };
            let RehearsalExerciseRequestV1::ClockAuthAdvance { advance_ms, .. } = exercise.request
            else {
                return Err(request_invalid());
            };
            let markers = ensure_store_markers_in(transaction, false)?;
            let selector = prepared
                .grant
                .effect_selectors
                .clock_auth_advance
                .as_ref()
                .ok_or_else(selector_denied)?;
            if !markers.disposable_at_creation
                || markers.store_id != selector.auth_clock.store_id
                || markers.disposable_marker_id.as_deref()
                    != Some(selector.auth_clock.disposable_marker_id.as_str())
            {
                let error = disposable_required();
                finish_rehearsal_atomic_effect_denial_in(
                    transaction,
                    &exercise,
                    prepared,
                    error.clone(),
                )?;
                return Ok(ExerciseTransactionOutcome::Denied(error));
            }
            let prior = super::auth::read_session_clock_floor_on(transaction)?;
            let successor = prior
                .checked_add(advance_ms)
                .filter(|value| *value <= crate::auth::rehearsal::MAX_REHEARSAL_COUNT)
                .ok_or_else(request_invalid)?;
            super::auth::advance_session_clock_floor_on(transaction, successor)?;
            let value = serde_json::json!({
                "kind": "authRehearsalAuthClockAdvance.v1",
                "priorAuthClockMs": prior,
                "successorAuthClockMs": successor,
            });
            finish_rehearsal_atomic_effect_success_in(
                transaction,
                &exercise,
                prepared,
                value.clone(),
            )?;
            Ok(ExerciseTransactionOutcome::Fresh(value))
        })?;
        outcome.into_result()
    }

    /// Produce a closed logical payload and MAC envelope from one marker
    /// snapshot. Key use stays under the LLP 0057 keyring lock.
    pub fn auth_rehearsal_logical_export(
        &mut self,
        keyring: &crate::auth::keyring::AuthKeyringStore,
        body: serde_json::Value,
        snapshot_witness: AuthRehearsalSnapshotWitnessV1,
        now_ms: u64,
        random: &dyn crate::auth::crypto::RandomSource,
    ) -> SnapbackResult<AuthRehearsalLogicalExportArtifactV1> {
        let markers = self.auth_rehearsal_store_markers()?;
        let payload = serde_json::to_vec(&AuthRehearsalLogicalExportPayloadV1 {
            kind: crate::auth::rehearsal::AUTH_REHEARSAL_LOGICAL_EXPORT_KIND.to_owned(),
            source_store_id: markers.store_id.clone(),
            snapshot_witness: snapshot_witness.clone(),
            body,
        })
        .map_err(|_| crate::auth::rehearsal::envelope_invalid())?;
        let envelope = keyring
            .with_active_key(now_ms, random, |key_id, auth_key| {
                let key = crate::auth::rehearsal::derive_export_verification_key(
                    auth_key.expose_secret(),
                    &markers.store_id,
                    key_id.as_str(),
                )?;
                crate::auth::rehearsal::seal_export_envelope(
                    &payload,
                    &markers,
                    snapshot_witness,
                    key_id.as_str().to_owned(),
                    &key,
                )
            })
            .map_err(|_| export_key_unavailable())??;
        Ok(AuthRehearsalLogicalExportArtifactV1 { envelope, payload })
    }

    pub fn auth_rehearsal_export_verification_key(
        keyring: &crate::auth::keyring::AuthKeyringStore,
        envelope: &AuthRehearsalExportEnvelopeV1,
    ) -> SnapbackResult<crate::auth::rehearsal::RehearsalExportVerificationKey> {
        let key_id = crate::auth::crypto::AuthKeyId::parse(&envelope.source_key_id)
            .map_err(|_| export_key_unavailable())?;
        keyring
            .with_key(&key_id, |auth_key| {
                crate::auth::rehearsal::derive_export_verification_key(
                    auth_key.expose_secret(),
                    &envelope.source_store_id,
                    &envelope.source_key_id,
                )
            })
            .map_err(|_| export_key_unavailable())?
    }

    pub fn auth_rehearsal_import_logical_export(
        &mut self,
        artifact: &AuthRehearsalLogicalExportArtifactV1,
        verification_key: &crate::auth::rehearsal::RehearsalExportVerificationKey,
        destination_profile: crate::contract_types::ServerProfile,
    ) -> SnapbackResult<serde_json::Value> {
        let payload = crate::auth::rehearsal::verify_export_envelope(
            &artifact.envelope,
            &artifact.payload,
            verification_key,
        )?;
        if destination_profile == crate::contract_types::ServerProfile::Prod
            && (artifact.envelope.marker_state.disposable_at_creation
                || artifact.envelope.marker_state.rehearsal_admitted)
        {
            return Err(state_present());
        }
        if destination_profile != crate::contract_types::ServerProfile::Prod {
            self.with_auth_transaction(|transaction| {
                ensure_tables(transaction)?;
                preserve_imported_markers_in(transaction, &artifact.envelope)?;
                Ok(())
            })?;
        }
        Ok(payload.body)
    }
}

/// Join an ordinary provider challenge to its server-resolved window. The
/// provider row, child/parent counters, challenge lineage, audit, and marker
/// commit or roll back together.
///
/// @ref LLP 0213#window-behavior — namespace matches never grant unbounded
///   ordinary auth behavior; every honored capture consumes both finite
///   window and parent accounting.
pub(super) fn consume_rehearsal_window_challenge_in(
    transaction: &Transaction<'_>,
    expected_window: &AuthRehearsalWindowV1,
    challenge_id: &str,
    address: &crate::auth::crypto::CanonicalAddress,
    now_ms: u64,
) -> SnapbackResult<()> {
    ensure_tables(transaction)?;
    expected_window.validate_record()?;
    let durable: Option<(String, Option<i64>, i64)> = transaction
        .query_row(
            &format!(
                "SELECT record_json, revoked_at_ms, challenge_attempts
                 FROM {WINDOWS} WHERE window_id = ?1"
            ),
            params![expected_window.window_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((durable_json, revoked_at, window_attempts)) = durable else {
        return Err(authority_ended());
    };
    let durable_window: AuthRehearsalWindowV1 =
        serde_json::from_str(&durable_json).map_err(|_| request_invalid())?;
    durable_window.validate_record()?;
    if durable_window != *expected_window
        || revoked_at.is_some()
        || now_ms >= durable_window.expires_at
    {
        return Err(authority_ended());
    }
    let mut grant =
        load_grant_by_id(transaction, &durable_window.grant_id)?.ok_or_else(authority_ended)?;
    if grant.revoked_at.is_some() || now_ms >= grant.expires_at {
        return Err(authority_ended());
    }
    let window_plan = grant
        .effect_selectors
        .window_install
        .as_ref()
        .and_then(|selector| {
            selector
                .window_plans
                .iter()
                .find(|plan| plan.window_plan_id == durable_window.window_plan_id)
        })
        .ok_or_else(selector_denied)?;
    if !window_plan
        .enabled_effects
        .contains(&RehearsalEffect::ChallengeCapture)
        || !grant.scopes.contains(&RehearsalEffect::ChallengeCapture)
    {
        return Err(scope_denied());
    }
    let window_attempts = u64::try_from(window_attempts).map_err(|_| request_invalid())?;
    if window_attempts >= window_plan.window_budget_limits.challenge_attempts {
        return Err(budget_exhausted("window.challengeAttempts"));
    }
    if grant.consumed.uses_charged >= grant.limits.max_uses {
        return Err(budget_exhausted("maxUses"));
    }
    if grant.consumed.challenge_attempts >= grant.limits.challenge_attempts {
        return Err(budget_exhausted("challengeAttempts"));
    }
    let before = grant.consumed.clone();
    grant.consumed.uses_charged += 1;
    grant.consumed.challenge_attempts += 1;
    write_consumed(transaction, &grant.grant_id, &grant.consumed)?;
    let changed = transaction.execute(
        &format!(
            "UPDATE {WINDOWS} SET challenge_attempts = challenge_attempts + 1
             WHERE window_id = ?1 AND challenge_attempts = ?2"
        ),
        params![durable_window.window_id, window_attempts as i64],
    )?;
    if changed != 1 {
        return Err(authority_ended());
    }
    transaction.execute(
        &format!(
            "INSERT INTO {WINDOW_CHALLENGES}(challenge_id, window_id, created_at_ms)
             VALUES(?1, ?2, ?3)"
        ),
        params![challenge_id, durable_window.window_id, now_ms as i64],
    )?;
    mark_store_admitted_in(
        transaction,
        &grant.grant_id,
        RehearsalEffect::ChallengeCapture,
        now_ms,
    )?;
    let audit_digest = crate::auth::rehearsal::digest_serializable(
        b"snapback.auth-rehearsal.window-capture.v1\0",
        &(
            durable_window.window_id.as_str(),
            challenge_id,
            crate::auth::rehearsal::contact_digest(address),
        ),
    )?;
    insert_audit(
        transaction,
        &grant.grant_id,
        Some(RehearsalEffect::ChallengeCapture),
        "succeeded",
        "windowNamespace",
        &audit_digest,
        &serde_json::to_string(&before).map_err(|_| request_invalid())?,
        &serde_json::to_string(&grant.consumed).map_err(|_| request_invalid())?,
        now_ms,
    )
}

/// Preserve the non-reuse ledger and permanent store markers while ending all
/// boot/activation-bound rehearsal authority before ordinary auth reset rows
/// are removed.
///
/// @ref LLP 0213#collision-and-reuse — reset terminalizes reservations and
///   windows; it never recreates a namespace or clears the store marker.
pub(super) fn terminalize_rehearsal_authority_for_reset_in(
    transaction: &Transaction<'_>,
) -> SnapbackResult<()> {
    if !table_exists(transaction, GRANTS)? {
        return Ok(());
    }
    transaction.execute(
        &format!(
            "UPDATE {GRANTS}
             SET revoked_at_ms = COALESCE(
                    revoked_at_ms,
                    CAST(json_extract(record_json, '$.createdAt') AS INTEGER)
                 ),
                 terminal_reason = COALESCE(terminal_reason, 'reset')"
        ),
        [],
    )?;
    transaction.execute(
        &format!(
            "UPDATE {WINDOWS}
             SET revoked_at_ms = COALESCE(
                    revoked_at_ms,
                    CAST(json_extract(record_json, '$.createdAt') AS INTEGER)
                 )"
        ),
        [],
    )?;
    transaction.execute(
        &format!(
            "UPDATE {WINDOW_RESERVATIONS}
             SET state = 'terminal',
                 terminal_at_ms = COALESCE(terminal_at_ms, created_at_ms)
             WHERE state != 'terminal'"
        ),
        [],
    )?;
    Ok(())
}

fn terminalize_grant_windows_in(
    transaction: &Transaction<'_>,
    grant_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    transaction.execute(
        &format!(
            "UPDATE {WINDOWS}
             SET revoked_at_ms = COALESCE(revoked_at_ms, ?2)
             WHERE grant_id = ?1"
        ),
        params![grant_id, now_ms as i64],
    )?;
    transaction.execute(
        &format!(
            "UPDATE {WINDOW_RESERVATIONS}
             SET state = 'terminal', terminal_at_ms = COALESCE(terminal_at_ms, ?2)
             WHERE grant_id = ?1 AND state != 'terminal'"
        ),
        params![grant_id, now_ms as i64],
    )?;
    Ok(())
}

#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
enum MintTransactionOutcome {
    Minted {
        grant: AuthRehearsalGrantV1,
        window_namespaces: Vec<MintedWindowNamespaceV1>,
    },
    Conflict,
    ReplayUnavailable(String),
}

enum ExerciseTransactionOutcome {
    Fresh(serde_json::Value),
    Replay(serde_json::Value),
    Denied(SnapbackError),
}

enum WindowInstallTransactionOutcome {
    Fresh(serde_json::Value, AuthRehearsalWindowV1),
    Replay(serde_json::Value, AuthRehearsalWindowV1),
    Denied(SnapbackError),
}

#[allow(clippy::large_enum_variant)] // transient resolution value; boxing the hot arm buys nothing
pub enum RehearsalAtomicEffectAdmission {
    Admitted(PreparedRehearsalAtomicEffect),
    Replay(serde_json::Value),
    Denied(SnapbackError),
}

pub struct PreparedRehearsalAtomicEffect {
    grant: AuthRehearsalGrantV1,
    request_digest: String,
    charged: RehearsalConsumedV1,
    window: Option<PreparedRehearsalWindowEffect>,
}

pub struct PreparedRehearsalWindowEffect {
    window_id: String,
    verification_simulations: u64,
    session_mints: u64,
}

fn prepare_rehearsal_window_effect_in(
    transaction: &Transaction<'_>,
    grant: &AuthRehearsalGrantV1,
    plan: &RehearsalExercisePlan,
) -> SnapbackResult<Option<PreparedRehearsalWindowEffect>> {
    let RehearsalExerciseRequestV1::VerificationSimulate {
        idempotency_key,
        identity_id,
    } = &plan.request
    else {
        return Ok(None);
    };
    let selector_matches = grant
        .effect_selectors
        .verification_simulate
        .as_ref()
        .is_some_and(|selector| {
            selector.identities.iter().any(|identity| {
                matches!(
                    identity,
                    crate::auth::rehearsal::IdentitySelectorV1::WindowNamespace {
                        window_plan_id
                    } if window_plan_id == identity_id
                )
            })
        });
    if !selector_matches {
        return Ok(None);
    }
    let Some(address) = plan.resolved_contact.as_ref() else {
        return Ok(None);
    };
    let row: Option<(String, Option<i64>, i64, i64)> = transaction
        .query_row(
            &format!(
                "SELECT window.record_json, window.revoked_at_ms,
                        window.verification_simulations, window.session_mints
                 FROM {WINDOW_CHALLENGES} AS lineage
                 JOIN {WINDOWS} AS window ON window.window_id = lineage.window_id
                 JOIN _auth_verification_codes AS challenge
                   ON challenge.challenge_id = lineage.challenge_id
                 WHERE lineage.challenge_id = ?1
                   AND window.window_plan_id = ?2
                   AND window.grant_id = ?3
                   AND challenge.canonical_address = ?4"
            ),
            params![
                idempotency_key,
                identity_id,
                grant.grant_id,
                address.as_str()
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let Some((window_json, revoked_at, verification_simulations, session_mints)) = row else {
        return Ok(None);
    };
    let window: AuthRehearsalWindowV1 =
        serde_json::from_str(&window_json).map_err(|_| request_invalid())?;
    window.validate_record()?;
    if revoked_at.is_some()
        || plan.now_ms >= window.expires_at
        || window.grant_id != grant.grant_id
        || window.window_plan_id != *identity_id
        || window.instance_id != plan.bindings.instance_id
        || window.boot_nonce != plan.bindings.boot_nonce
        || window.app_id != plan.bindings.app_id
        || window.activation_digest != plan.bindings.activation_digest
    {
        return Err(authority_ended());
    }
    let window_plan = grant
        .effect_selectors
        .window_install
        .as_ref()
        .and_then(|selector| {
            selector
                .window_plans
                .iter()
                .find(|candidate| candidate.window_plan_id == window.window_plan_id)
        })
        .ok_or_else(selector_denied)?;
    if !window_plan
        .enabled_effects
        .contains(&RehearsalEffect::VerificationSimulate)
    {
        return Err(scope_denied());
    }
    let verification_simulations =
        u64::try_from(verification_simulations).map_err(|_| request_invalid())?;
    let session_mints = u64::try_from(session_mints).map_err(|_| request_invalid())?;
    if verification_simulations >= window_plan.window_budget_limits.verification_simulations {
        return Err(budget_exhausted("window.verificationSimulations"));
    }
    if session_mints >= window_plan.window_budget_limits.session_mints {
        return Err(budget_exhausted("window.sessionMints"));
    }
    Ok(Some(PreparedRehearsalWindowEffect {
        window_id: window.window_id,
        verification_simulations,
        session_mints,
    }))
}

/// Charge and authorize an effect inside a caller-owned auth transaction,
/// leaving success/semantic-denial publication to the caller after its own
/// durable write has been decided. This is the join point used by provider
/// session issuance and first-login identity provisioning.
///
/// @ref LLP 0213#atomic-charge-at-linearization — accounting, provenance
///   companions, and provider rows share one IMMEDIATE transaction.
pub(crate) fn prepare_rehearsal_atomic_effect_in(
    transaction: &Transaction<'_>,
    plan: &RehearsalExercisePlan,
) -> SnapbackResult<RehearsalAtomicEffectAdmission> {
    ensure_tables(transaction)?;
    let Some(mut grant) = load_grant_by_carrier(transaction, &plan.carrier_hash)? else {
        return Ok(RehearsalAtomicEffectAdmission::Denied(
            crate::auth::rehearsal::carrier_required(),
        ));
    };
    let request_digest = plan.request.normalized_digest()?;
    if let Err(error) = plan.bindings.validate_grant(&grant, plan.now_ms) {
        let error: SnapbackError = error.into();
        if error.diagnostic.code == "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH" {
            transaction.execute(
                &format!("UPDATE {GRANTS} SET revoked_at_ms = COALESCE(revoked_at_ms, ?2), terminal_reason = COALESCE(terminal_reason, 'bindingMismatch') WHERE grant_id = ?1"),
                params![grant.grant_id, plan.now_ms as i64],
            )?;
        }
        if matches!(
            error.diagnostic.code.as_str(),
            "SNAPBACK_AUTH_REHEARSAL_BINDING_MISMATCH"
                | "SNAPBACK_AUTH_REHEARSAL_EXPIRED"
                | "SNAPBACK_AUTH_REHEARSAL_AUTHORITY_ENDED"
        ) {
            terminalize_grant_windows_in(transaction, &grant.grant_id, plan.now_ms)?;
        }
        return Ok(RehearsalAtomicEffectAdmission::Denied(error));
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
            return Ok(if outcome.ok {
                RehearsalAtomicEffectAdmission::Replay(outcome.data)
            } else {
                RehearsalAtomicEffectAdmission::Denied(replayed_denial(outcome.code.as_deref()))
            });
        }
        return Ok(
            match charge_denial(
                transaction,
                &mut grant,
                plan,
                &request_digest,
                idempotency_conflict(),
                false,
            )? {
                ExerciseTransactionOutcome::Denied(error) => {
                    RehearsalAtomicEffectAdmission::Denied(error)
                }
                _ => return Err(request_invalid()),
            },
        );
    }
    let mut charged = grant.consumed.clone();
    if charged.uses_charged >= grant.limits.max_uses {
        return atomic_persist_denial(
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
            return atomic_persist_denial(
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
        return atomic_persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            scope_denied(),
            &charged,
        );
    }
    let window = prepare_rehearsal_window_effect_in(transaction, &grant, plan)?;
    if window.is_none()
        && !crate::auth::rehearsal::selector_allows(
            &grant,
            &plan.request,
            plan.resolved_contact.as_ref(),
        )
    {
        return atomic_persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            selector_denied(),
            &charged,
        );
    }
    let before = charged.for_effect(plan.request.effect());
    let limit = grant.limits.for_effect(plan.request.effect());
    if !plan.request.effect().is_attempt_counter() && before >= limit {
        return atomic_persist_denial(
            transaction,
            &grant,
            plan,
            &request_digest,
            budget_exhausted(counter_name(plan.request.effect().counter())),
            &charged,
        );
    }
    Ok(RehearsalAtomicEffectAdmission::Admitted(
        PreparedRehearsalAtomicEffect {
            grant,
            request_digest,
            charged,
            window,
        },
    ))
}

fn atomic_persist_denial(
    transaction: &Transaction<'_>,
    grant: &AuthRehearsalGrantV1,
    plan: &RehearsalExercisePlan,
    request_digest: &str,
    error: SnapbackError,
    charged: &RehearsalConsumedV1,
) -> SnapbackResult<RehearsalAtomicEffectAdmission> {
    match persist_denial(transaction, grant, plan, request_digest, error, charged)? {
        ExerciseTransactionOutcome::Denied(error) => {
            Ok(RehearsalAtomicEffectAdmission::Denied(error))
        }
        _ => Err(request_invalid()),
    }
}

pub(crate) fn finish_rehearsal_atomic_effect_success_in(
    transaction: &Transaction<'_>,
    plan: &RehearsalExercisePlan,
    mut prepared: PreparedRehearsalAtomicEffect,
    outcome: serde_json::Value,
) -> SnapbackResult<()> {
    if let Some(window) = prepared.window.take() {
        let changed = transaction.execute(
            &format!(
                "UPDATE {WINDOWS}
                 SET verification_simulations = verification_simulations + 1,
                     session_mints = session_mints + 1
                 WHERE window_id = ?1
                   AND verification_simulations = ?2
                   AND session_mints = ?3"
            ),
            params![
                window.window_id,
                window.verification_simulations as i64,
                window.session_mints as i64,
            ],
        )?;
        if changed != 1 {
            return Err(authority_ended());
        }
    }
    if !plan.request.effect().is_attempt_counter() {
        increment_success_counter(&mut prepared.charged, plan.request.effect(), 1)?;
        write_consumed(transaction, &prepared.grant.grant_id, &prepared.charged)?;
    }
    mark_store_admitted_in(
        transaction,
        &prepared.grant.grant_id,
        plan.request.effect(),
        plan.now_ms,
    )?;
    persist_idempotency(
        transaction,
        &prepared.grant,
        plan,
        &prepared.request_digest,
        StoredIdempotencyOutcome {
            ok: true,
            code: None,
            data: outcome,
        },
    )?;
    insert_audit(
        transaction,
        &prepared.grant.grant_id,
        Some(plan.request.effect()),
        "succeeded",
        selector_class(plan.request.effect()),
        &prepared.request_digest,
        &serde_json::to_string(&prepared.grant.consumed).map_err(|_| request_invalid())?,
        &serde_json::to_string(&prepared.charged).map_err(|_| request_invalid())?,
        plan.now_ms,
    )
}

pub(crate) fn finish_rehearsal_atomic_effect_denial_in(
    transaction: &Transaction<'_>,
    plan: &RehearsalExercisePlan,
    prepared: PreparedRehearsalAtomicEffect,
    error: SnapbackError,
) -> SnapbackResult<()> {
    let _ = persist_denial(
        transaction,
        &prepared.grant,
        plan,
        &prepared.request_digest,
        error,
        &prepared.charged,
    )?;
    Ok(())
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
    let binding_error = plan.bindings.validate_grant(&grant, plan.now_ms).err();
    if let Some(error) = binding_error {
        let error: SnapbackError = error.into();
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
    mark_store_admitted_in(
        transaction,
        &grant.grant_id,
        plan.request.effect(),
        plan.now_ms,
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
    type StoredGrantRow = (
        String,
        Option<i64>,
        Option<String>,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    );
    let row: Option<StoredGrantRow> = transaction
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

fn reserve_window_namespaces_in(
    transaction: &rusqlite::Connection,
    _grant_id: &str,
    request: &RehearsalMintRequestV1,
    candidates: &[[zeroize::Zeroizing<String>; 3]],
) -> SnapbackResult<(
    crate::auth::rehearsal::EffectSelectorsV1,
    Vec<MintedWindowNamespaceV1>,
)> {
    let mut selectors = request.effect_selectors.clone();
    let Some(window_selector) = selectors.window_install.as_mut() else {
        if !candidates.is_empty() {
            return Err(request_invalid());
        }
        return Ok((selectors, Vec::new()));
    };
    if candidates.len() != window_selector.window_plans.len() {
        return Err(namespace_unavailable());
    }
    let mut selected_digests = std::collections::BTreeSet::new();
    let mut output = Vec::with_capacity(window_selector.window_plans.len());
    for (plan, candidates) in window_selector.window_plans.iter_mut().zip(candidates) {
        let mut selected = None;
        for candidate in candidates {
            let digest = crate::auth::rehearsal::window_namespace_digest(candidate)?;
            let durable_collision: bool = transaction.query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {WINDOW_RESERVATIONS} WHERE namespace_digest = ?1)"
                ),
                params![digest],
                |row| row.get(0),
            )?;
            if !durable_collision && selected_digests.insert(digest.clone()) {
                selected = Some((candidate.to_string(), digest));
                break;
            }
        }
        let Some((namespace, digest)) = selected else {
            return Err(namespace_unavailable());
        };
        plan.namespace_digest = digest;
        output.push(MintedWindowNamespaceV1 {
            window_plan_id: plan.window_plan_id.clone(),
            namespace,
        });
    }
    Ok((selectors, output))
}

fn insert_window_reservations_in(
    transaction: &Transaction<'_>,
    grant: &AuthRehearsalGrantV1,
    created_at_ms: u64,
) -> SnapbackResult<()> {
    let Some(selector) = grant.effect_selectors.window_install.as_ref() else {
        return Ok(());
    };
    for plan in &selector.window_plans {
        transaction.execute(
            &format!("INSERT INTO {WINDOW_RESERVATIONS}(window_plan_id, grant_id, namespace_digest, state, window_id, created_at_ms, terminal_at_ms) VALUES(?1, ?2, ?3, 'reserved', NULL, ?4, NULL)"),
            params![
                plan.window_plan_id,
                grant.grant_id,
                plan.namespace_digest,
                created_at_ms as i64,
            ],
        )?;
    }
    Ok(())
}

fn load_grant_by_id(
    connection: &rusqlite::Connection,
    grant_id: &str,
) -> SnapbackResult<Option<AuthRehearsalGrantV1>> {
    let carrier_hash: Option<Vec<u8>> = connection
        .query_row(
            &format!("SELECT carrier_hash FROM {GRANTS} WHERE grant_id = ?1"),
            params![grant_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(carrier_hash) = carrier_hash else {
        return Ok(None);
    };
    let carrier_hash: [u8; 32] = carrier_hash.try_into().map_err(|_| request_invalid())?;
    load_grant_by_carrier(connection, &carrier_hash)
}

/// Resolve the durable governor named by a rehearsal assurance. A window is
/// live only while both it and its parent grant are unrevoked and unexpired;
/// a grant-governed assurance is bounded directly by the grant.
///
/// @ref LLP 0214#49-rehearsal-provenance — expiry or revocation of the exact
/// window (or its parent grant) makes the assurance inadmissible.
pub(super) fn rehearsal_assurance_governor_is_live_on(
    connection: &rusqlite::Connection,
    governing_authority: &str,
    now_ms: u64,
) -> SnapbackResult<bool> {
    if !table_exists(connection, GRANTS)? || !table_exists(connection, WINDOWS)? {
        return Ok(false);
    }
    if let Some(grant) = load_grant_by_id(connection, governing_authority)? {
        return Ok(grant.revoked_at.is_none() && now_ms < grant.expires_at);
    }
    let window: Option<(String, Option<i64>)> = connection
        .query_row(
            &format!("SELECT record_json, revoked_at_ms FROM {WINDOWS} WHERE window_id = ?1"),
            params![governing_authority],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((window_json, revoked_at)) = window else {
        return Ok(false);
    };
    let mut window: AuthRehearsalWindowV1 =
        serde_json::from_str(&window_json).map_err(|_| request_invalid())?;
    window.revoked_at = revoked_at.and_then(|value| u64::try_from(value).ok());
    window.validate_record()?;
    if window.revoked_at.is_some() || now_ms >= window.expires_at {
        return Ok(false);
    }
    let Some(parent) = load_grant_by_id(connection, &window.grant_id)? else {
        return Ok(false);
    };
    Ok(parent.revoked_at.is_none() && now_ms < parent.expires_at)
}

fn ensure_store_markers_in(
    transaction: &Transaction<'_>,
    disposable_at_creation: bool,
) -> SnapbackResult<AuthRehearsalStoreMarkersV1> {
    if let Some(markers) = load_store_markers_in(transaction)? {
        if disposable_at_creation && !markers.disposable_at_creation {
            return Err(state_present());
        }
        markers.validate()?;
        return Ok(markers);
    }
    let markers = AuthRehearsalStoreMarkersV1 {
        kind: AUTH_REHEARSAL_STORE_MARKERS_KIND.to_owned(),
        store_id: uuid::Uuid::now_v7().to_string(),
        disposable_at_creation,
        disposable_marker_id: disposable_at_creation.then(|| uuid::Uuid::now_v7().to_string()),
        rehearsal_admitted: false,
        first_admission_at: None,
        first_admission_grant_digest: None,
        first_admission_effect: None,
    };
    markers.validate()?;
    transaction.execute(
        &format!("INSERT INTO {MARKERS}(singleton, kind, store_id, disposable_at_creation, disposable_marker_id, rehearsal_admitted, first_admission_at_ms, first_admission_grant_digest, first_admission_effect) VALUES(1, ?1, ?2, ?3, ?4, 0, NULL, NULL, NULL)"),
        params![
            markers.kind,
            markers.store_id,
            i64::from(markers.disposable_at_creation),
            markers.disposable_marker_id,
        ],
    )?;
    Ok(markers)
}

fn load_store_markers_in(
    connection: &rusqlite::Connection,
) -> SnapbackResult<Option<AuthRehearsalStoreMarkersV1>> {
    if !table_exists(connection, MARKERS)? {
        return Ok(None);
    }
    type MarkerRow = (
        String,
        String,
        i64,
        Option<String>,
        i64,
        Option<i64>,
        Option<String>,
        Option<String>,
    );
    let row: Option<MarkerRow> = connection
        .query_row(
            &format!("SELECT kind, store_id, disposable_at_creation, disposable_marker_id, rehearsal_admitted, first_admission_at_ms, first_admission_grant_digest, first_admission_effect FROM {MARKERS} WHERE singleton = 1"),
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(
            kind,
            store_id,
            disposable,
            disposable_marker_id,
            admitted,
            first_admission_at,
            first_admission_grant_digest,
            first_admission_effect,
        )| {
            let first_admission_effect = first_admission_effect
                .map(|value| {
                    serde_json::from_value::<RehearsalEffect>(serde_json::Value::String(value))
                        .map_err(|_| request_invalid())
                })
                .transpose()?;
            let markers = AuthRehearsalStoreMarkersV1 {
                kind,
                store_id,
                disposable_at_creation: disposable == 1,
                disposable_marker_id,
                rehearsal_admitted: admitted == 1,
                first_admission_at: first_admission_at.and_then(|value| u64::try_from(value).ok()),
                first_admission_grant_digest,
                first_admission_effect,
            };
            markers.validate()?;
            Ok(markers)
        },
    )
    .transpose()
}

fn mark_store_admitted_in(
    transaction: &Transaction<'_>,
    grant_id: &str,
    effect: RehearsalEffect,
    now_ms: u64,
) -> SnapbackResult<()> {
    let _ = ensure_store_markers_in(transaction, false)?;
    // @ref LLP 0213#same-transaction-rule — the monotone first-admission
    // marker is written in the exact transaction that linearizes the effect.
    transaction.execute(
        &format!("UPDATE {MARKERS} SET rehearsal_admitted = 1, first_admission_at_ms = ?1, first_admission_grant_digest = ?2, first_admission_effect = ?3 WHERE singleton = 1 AND rehearsal_admitted = 0"),
        params![
            now_ms as i64,
            format!(
                "sha256:{:x}",
                Sha256::digest(
                    [b"snapback.auth-rehearsal.first-admission-grant.v1\0".as_slice(), grant_id.as_bytes()].concat()
                )
            ),
            effect.as_str(),
        ],
    )?;
    Ok(())
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn store_is_creation_empty(connection: &rusqlite::Connection) -> SnapbackResult<bool> {
    for table in ["_auth_users", "_auth_identities", "_auth_sessions"] {
        if table_exists(connection, table)? {
            let count: i64 =
                connection.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })?;
            if count != 0 {
                return Ok(false);
            }
        }
    }
    let application_tables: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_snapback_%' AND name NOT LIKE '_auth_%'",
        [],
        |row| row.get(0),
    )?;
    Ok(application_tables == 0)
}

#[allow(dead_code)] // LLP 0213 slice C staged export surface; consumers land with the following rehearsal slices
fn preserve_imported_markers_in(
    transaction: &Transaction<'_>,
    envelope: &AuthRehearsalExportEnvelopeV1,
) -> SnapbackResult<()> {
    let incoming = AuthRehearsalStoreMarkersV1 {
        kind: AUTH_REHEARSAL_STORE_MARKERS_KIND.to_owned(),
        store_id: envelope.source_store_id.clone(),
        disposable_at_creation: envelope.marker_state.disposable_at_creation,
        disposable_marker_id: envelope.marker_state.disposable_marker_id.clone(),
        rehearsal_admitted: envelope.marker_state.rehearsal_admitted,
        first_admission_at: envelope.marker_state.first_admission_at,
        first_admission_grant_digest: envelope.marker_state.first_admission_grant_digest.clone(),
        first_admission_effect: envelope.marker_state.first_admission_effect,
    };
    incoming.validate()?;
    if let Some(existing) = load_store_markers_in(transaction)? {
        if existing.store_id != incoming.store_id
            || (existing.production_ineligible() && !incoming.production_ineligible())
        {
            return Err(state_present());
        }
        if existing == incoming {
            return Ok(());
        }
        return Err(state_present());
    }
    transaction.execute(
        &format!("INSERT INTO {MARKERS}(singleton, kind, store_id, disposable_at_creation, disposable_marker_id, rehearsal_admitted, first_admission_at_ms, first_admission_grant_digest, first_admission_effect) VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![
            incoming.kind,
            incoming.store_id,
            i64::from(incoming.disposable_at_creation),
            incoming.disposable_marker_id,
            i64::from(incoming.rehearsal_admitted),
            incoming.first_admission_at.map(|value| value as i64),
            incoming.first_admission_grant_digest,
            incoming.first_admission_effect.map(RehearsalEffect::as_str),
        ],
    )?;
    Ok(())
}

fn ensure_tables(transaction: &Transaction<'_>) -> SnapbackResult<()> {
    if table_exists(transaction, MARKERS)? {
        let has_current_shape: bool = transaction.query_row(
            &format!(
                "SELECT EXISTS(
                   SELECT 1 FROM pragma_table_info('{MARKERS}') WHERE name = 'kind'
                 )"
            ),
            [],
            |row| row.get(0),
        )?;
        if !has_current_shape {
            // The inherited marker did not record a store identity or exact
            // first effect. Inventing either would weaken provenance. Keep the
            // old row intact and fail closed until an explicit migration can
            // supply a reviewed lineage rule.
            return Err(state_present());
        }
    }
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
            kind TEXT NOT NULL,
            store_id TEXT NOT NULL UNIQUE,
            disposable_at_creation INTEGER NOT NULL CHECK(disposable_at_creation IN (0, 1)),
            disposable_marker_id TEXT,
            rehearsal_admitted INTEGER NOT NULL CHECK(rehearsal_admitted IN (0, 1)),
            first_admission_at_ms INTEGER,
            first_admission_grant_digest TEXT,
            first_admission_effect TEXT,
            CHECK((disposable_at_creation = 1) = (disposable_marker_id IS NOT NULL)),
            CHECK((rehearsal_admitted = 1) = (first_admission_at_ms IS NOT NULL)),
            CHECK((rehearsal_admitted = 1) = (first_admission_grant_digest IS NOT NULL)),
            CHECK((rehearsal_admitted = 1) = (first_admission_effect IS NOT NULL))
        );
        CREATE TABLE IF NOT EXISTS {WINDOW_RESERVATIONS}(
            window_plan_id TEXT PRIMARY KEY,
            grant_id TEXT NOT NULL,
            namespace_digest TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL CHECK(state IN ('reserved', 'installed', 'terminal')),
            window_id TEXT UNIQUE,
            created_at_ms INTEGER NOT NULL,
            terminal_at_ms INTEGER,
            FOREIGN KEY(grant_id) REFERENCES {GRANTS}(grant_id)
        );
        CREATE TABLE IF NOT EXISTS {WINDOWS}(
            window_id TEXT PRIMARY KEY,
            grant_id TEXT NOT NULL,
            window_plan_id TEXT NOT NULL UNIQUE,
            record_json TEXT NOT NULL,
            revoked_at_ms INTEGER,
            challenge_attempts INTEGER NOT NULL,
            verification_simulations INTEGER NOT NULL,
            session_mints INTEGER NOT NULL,
            FOREIGN KEY(grant_id) REFERENCES {GRANTS}(grant_id),
            FOREIGN KEY(window_plan_id) REFERENCES {WINDOW_RESERVATIONS}(window_plan_id)
        );
        CREATE TABLE IF NOT EXISTS {WINDOW_CHALLENGES}(
            challenge_id TEXT PRIMARY KEY,
            window_id TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(challenge_id) REFERENCES _auth_verification_codes(challenge_id) ON DELETE CASCADE,
            FOREIGN KEY(window_id) REFERENCES {WINDOWS}(window_id)
        );
        CREATE TABLE IF NOT EXISTS {DERIVED_IDENTITIES}(
            identity_id TEXT PRIMARY KEY,
            provenance_json TEXT NOT NULL,
            governing_not_after_ms INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(identity_id) REFERENCES _auth_identities(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS {DERIVED_SESSIONS}(
            session_id TEXT PRIMARY KEY,
            provenance_json TEXT NOT NULL,
            governing_not_after_ms INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES _auth_sessions(id) ON DELETE CASCADE
        );"
    ))?;
    Ok(())
}

pub(super) fn rehearsal_session_provenance_by_id(
    connection: &rusqlite::Connection,
) -> SnapbackResult<
    std::collections::BTreeMap<String, crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
> {
    if !table_exists(connection, DERIVED_SESSIONS)? {
        return Ok(std::collections::BTreeMap::new());
    }
    let mut statement = connection.prepare(&format!(
        "SELECT session_id, provenance_json FROM {DERIVED_SESSIONS} ORDER BY session_id"
    ))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut provenances = std::collections::BTreeMap::new();
    for (session_id, json) in rows {
        let provenance: crate::auth::rehearsal::AuthRehearsalProvenanceV1 =
            serde_json::from_str(&json)
                .map_err(|_| crate::auth::rehearsal::provenance_invalid())?;
        provenance.validate()?;
        if provenances.insert(session_id, provenance).is_some() {
            return Err(crate::auth::rehearsal::provenance_invalid());
        }
    }
    Ok(provenances)
}

pub(crate) fn insert_rehearsal_session_provenance_in(
    transaction: &Transaction<'_>,
    session_id: &str,
    provenance: &crate::auth::rehearsal::AuthRehearsalProvenanceV1,
    governing_not_after_ms: u64,
    created_at_ms: u64,
) -> SnapbackResult<()> {
    ensure_tables(transaction)?;
    provenance.validate()?;
    transaction.execute(
        &format!("INSERT INTO {DERIVED_SESSIONS}(session_id, provenance_json, governing_not_after_ms, created_at_ms) VALUES(?1, ?2, ?3, ?4)"),
        params![
            session_id,
            serde_json::to_string(provenance).map_err(|_| crate::auth::rehearsal::provenance_invalid())?,
            governing_not_after_ms as i64,
            created_at_ms as i64,
        ],
    )?;
    Ok(())
}

pub(crate) fn insert_rehearsal_identity_provenance_for_provider_in(
    transaction: &Transaction<'_>,
    identity_id: &str,
    provenance: &crate::auth::rehearsal::AuthRehearsalProvenanceV1,
    governing_not_after_ms: u64,
    created_at_ms: u64,
) -> SnapbackResult<()> {
    ensure_tables(transaction)?;
    provenance.validate()?;
    transaction.execute(
        &format!("INSERT INTO {DERIVED_IDENTITIES}(identity_id, provenance_json, governing_not_after_ms, created_at_ms) VALUES(?1, ?2, ?3, ?4)"),
        params![
            identity_id,
            serde_json::to_string(provenance).map_err(|_| crate::auth::rehearsal::provenance_invalid())?,
            governing_not_after_ms as i64,
            created_at_ms as i64,
        ],
    )?;
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
        Some("SNAPBACK_AUTH_CODE_INVALID") => crate::auth::throttle::code_invalid(),
        Some("SNAPBACK_AUTH_CODE_LOCKED") => crate::auth::throttle::code_locked(),
        _ => authority_ended(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CanonicalAddress, OsRandom, RehearsalBearer};
    use crate::auth::rehearsal::{
        AuthClockDomainV1, ClockEffectSelectorV1, ContactEffectSelectorV1, ContactSelectorV1,
        EffectSelectorsV1, IdentityEffectSelectorV1, IdentitySelectorV1,
        RehearsalDeploymentProfile, RehearsalReachabilityExposureV1, RehearsalTargetClassV1,
        WindowBudgetLimitsV1, WindowEffectSelectorV1, WindowPlanSelectorV1,
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
                window_namespace_candidates: Vec::new(),
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
                window_namespace_candidates: Vec::new(),
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
                window_namespace_candidates: Vec::new(),
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
            window_namespace_candidates: Vec::new(),
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

    fn window_mint_request(address: &CanonicalAddress, now_ms: u64) -> RehearsalMintRequestV1 {
        let window_plan_id = uuid::Uuid::now_v7().to_string();
        RehearsalMintRequestV1 {
            scopes: vec![
                RehearsalEffect::ChallengeCapture,
                RehearsalEffect::VerificationSimulate,
                RehearsalEffect::WindowInstall,
            ],
            effect_selectors: EffectSelectorsV1 {
                challenge_capture: Some(ContactEffectSelectorV1 {
                    contacts: vec![ContactSelectorV1::ExactContact {
                        canonical_address_digest: crate::auth::rehearsal::contact_digest(address),
                    }],
                }),
                verification_simulate: Some(IdentityEffectSelectorV1 {
                    identities: vec![IdentitySelectorV1::WindowNamespace {
                        window_plan_id: window_plan_id.clone(),
                    }],
                }),
                window_install: Some(WindowEffectSelectorV1 {
                    window_plans: vec![WindowPlanSelectorV1 {
                        window_plan_id,
                        namespace_digest: String::new(),
                        enabled_effects: vec![
                            RehearsalEffect::ChallengeCapture,
                            RehearsalEffect::VerificationSimulate,
                        ],
                        window_budget_limits: WindowBudgetLimitsV1 {
                            challenge_attempts: 3,
                            verification_simulations: 1,
                            session_mints: 1,
                        },
                        expires_no_later_than: now_ms + 30_000,
                    }],
                }),
                ..Default::default()
            },
            limits: crate::auth::rehearsal::RehearsalLimitsV1 {
                challenge_attempts: 3,
                verification_simulations: 2,
                window_installs: 1,
                max_uses: 6,
                ..Default::default()
            },
            expires_at: now_ms + 60_000,
            idempotency_key: uuid::Uuid::now_v7().to_string(),
            operator_audit_id: "operator-window".to_owned(),
        }
    }

    #[test]
    fn window_namespace_is_precommitted_consumed_and_matches_only_by_entropy() {
        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-window");
        let request = window_mint_request(&address, now_ms);
        let plan_id = request
            .effect_selectors
            .window_install
            .as_ref()
            .unwrap()
            .window_plans[0]
            .window_plan_id
            .clone();
        let candidates =
            crate::auth::rehearsal::generate_window_namespace_candidates(&request, &OsRandom)
                .unwrap();
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let minted = db
            .auth_rehearsal_mint(RehearsalMintPlan {
                request,
                bindings: bindings.clone(),
                carrier,
                window_namespace_candidates: candidates,
                now_ms,
            })
            .unwrap()
            .into_value();
        let namespace = minted["windowNamespaces"][0]["namespace"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(crate::auth::rehearsal::valid_window_namespace(&namespace));
        let carrier_hash = *RehearsalBearer::parse(&carrier_text)
            .unwrap()
            .token_hash()
            .as_bytes();
        let exercise = RehearsalExercisePlan {
            carrier_hash,
            bindings: bindings.clone(),
            request: RehearsalExerciseRequestV1::WindowInstall {
                idempotency_key: "install-window".to_owned(),
                window_plan_id: plan_id,
            },
            resolved_contact: None,
            semantic_success: true,
            outcome: serde_json::Value::Null,
            now_ms,
        };
        let (first, window) = db
            .auth_rehearsal_install_window(RehearsalWindowInstallPlan {
                exercise: exercise.clone(),
                reachability: RehearsalReachabilityAdmissionV1 {
                    target_class: RehearsalTargetClassV1::Wave1Local,
                    expected_target_build_digest: bindings.activation_digest.clone(),
                    fact: None,
                },
            })
            .unwrap();
        assert!(matches!(first, RehearsalExerciseOutcome::Fresh(_)));
        let replay = db
            .auth_rehearsal_install_window(RehearsalWindowInstallPlan {
                exercise,
                reachability: RehearsalReachabilityAdmissionV1 {
                    target_class: RehearsalTargetClassV1::Wave1Local,
                    expected_target_build_digest: bindings.activation_digest.clone(),
                    fact: None,
                },
            })
            .unwrap();
        assert!(matches!(replay.0, RehearsalExerciseOutcome::Replay(_)));
        assert_eq!(replay.1.window_id, window.window_id);
        assert!(
            db.with_auth_read(|connection| rehearsal_assurance_governor_is_live_on(
                connection,
                &window.window_id,
                now_ms,
            ))
            .unwrap(),
            "an unrevoked window and parent grant admit their governed assurance"
        );

        let guessed = CanonicalAddress::parse("browser@example.invalid").unwrap();
        assert!(
            db.auth_rehearsal_window_for_contact(&guessed, &bindings, now_ms)
                .unwrap()
                .is_none()
        );
        let matching = CanonicalAddress::parse(&format!("browser@{namespace}")).unwrap();
        assert_eq!(
            db.auth_rehearsal_window_for_contact(&matching, &bindings, now_ms)
                .unwrap()
                .unwrap()
                .window_id,
            window.window_id
        );

        let challenge_id = "sbc_AAAAAAAAAAAAAAAAAAAAAA";
        db.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_verification_codes(
                   challenge_id, canonical_address, code_digest, key_id,
                   attempts, max_attempts, requested_at_ms, expires_at_ms,
                   consumed_at_ms, superseded_by
                 ) VALUES(?1, ?2, ?3, 'sbak_test', 0, 5, ?4, ?5, NULL, NULL)",
                params![
                    challenge_id,
                    matching.as_str(),
                    [0_u8; 32].as_slice(),
                    now_ms as i64,
                    (now_ms + 10_000) as i64,
                ],
            )?;
            consume_rehearsal_window_challenge_in(
                transaction,
                &window,
                challenge_id,
                &matching,
                now_ms,
            )
        })
        .unwrap();
        let derivation = db
            .auth_rehearsal_window_for_challenge(challenge_id, &bindings, now_ms)
            .unwrap()
            .unwrap();
        assert_eq!(derivation.window.window_id, window.window_id);
        assert_eq!(derivation.carrier_hash, carrier_hash);
        let simulate = RehearsalExercisePlan {
            carrier_hash,
            bindings: bindings.clone(),
            request: RehearsalExerciseRequestV1::VerificationSimulate {
                idempotency_key: challenge_id.to_owned(),
                identity_id: window.window_plan_id.clone(),
            },
            resolved_contact: Some(matching),
            semantic_success: true,
            outcome: serde_json::json!({ "session": "simulated" }),
            now_ms,
        };
        db.with_auth_transaction(|transaction| {
            let prepared = match prepare_rehearsal_atomic_effect_in(transaction, &simulate)? {
                RehearsalAtomicEffectAdmission::Admitted(prepared) => prepared,
                _ => return Err(request_invalid()),
            };
            finish_rehearsal_atomic_effect_success_in(
                transaction,
                &simulate,
                prepared,
                simulate.outcome.clone(),
            )
        })
        .unwrap();
        let (challenge_attempts, verification_simulations, session_mints): (i64, i64, i64) = db
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        &format!(
                            "SELECT challenge_attempts, verification_simulations, session_mints
                         FROM {WINDOWS} WHERE window_id = ?1"
                        ),
                        params![window.window_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                    )
                    .map_err(Into::into)
            })
            .unwrap();
        assert_eq!(
            (challenge_attempts, verification_simulations, session_mints),
            (1, 1, 1)
        );
        let markers = db.auth_rehearsal_store_markers().unwrap();
        assert!(markers.rehearsal_admitted);
        assert_eq!(
            markers.first_admission_effect,
            Some(RehearsalEffect::WindowInstall)
        );
        db.auth_rehearsal_revoke(&window.grant_id, now_ms + 1)
            .unwrap();
        assert!(
            !db.with_auth_read(|connection| rehearsal_assurance_governor_is_live_on(
                connection,
                &window.window_id,
                now_ms + 1,
            ))
            .unwrap(),
            "parent revocation ends the window-governed assurance"
        );
        assert!(
            db.auth_rehearsal_window_for_contact(
                &CanonicalAddress::parse(&format!("after@{namespace}")).unwrap(),
                &bindings,
                now_ms + 1,
            )
            .unwrap()
            .is_none()
        );
        let reservation_state: String = db
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        &format!(
                            "SELECT state FROM {WINDOW_RESERVATIONS} WHERE window_plan_id = ?1"
                        ),
                        params![window.window_plan_id],
                        |row| row.get(0),
                    )
                    .map_err(Into::into)
            })
            .unwrap();
        assert_eq!(reservation_state, "terminal");
    }

    #[test]
    fn window_namespace_collision_retries_without_reusing_a_commitment() {
        struct Filled(u8);
        impl crate::auth::crypto::RandomSource for Filled {
            fn fill(&self, destination: &mut [u8]) -> Result<(), crate::auth::crypto::CryptoError> {
                destination.fill(self.0);
                Ok(())
            }
        }

        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-collision");
        let collision = crate::auth::rehearsal::generate_window_namespace(&Filled(0x11)).unwrap();
        let successor = crate::auth::rehearsal::generate_window_namespace(&Filled(0x22)).unwrap();
        let fallback = crate::auth::rehearsal::generate_window_namespace(&Filled(0x33)).unwrap();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let first = db
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: window_mint_request(&address, now_ms),
                bindings: bindings.clone(),
                carrier: RehearsalBearer::generate(&OsRandom).unwrap(),
                window_namespace_candidates: vec![[
                    collision.clone(),
                    successor.clone(),
                    fallback.clone(),
                ]],
                now_ms,
            })
            .unwrap()
            .into_value();
        assert_eq!(
            first["windowNamespaces"][0]["namespace"].as_str(),
            Some(collision.as_str())
        );
        let second = db
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: window_mint_request(&address, now_ms),
                bindings,
                carrier: RehearsalBearer::generate(&OsRandom).unwrap(),
                window_namespace_candidates: vec![[collision, successor.clone(), fallback]],
                now_ms,
            })
            .unwrap()
            .into_value();
        assert_eq!(
            second["windowNamespaces"][0]["namespace"].as_str(),
            Some(successor.as_str())
        );
    }

    #[test]
    fn declared_public_refusal_charges_attempt_without_consuming_install_or_tainting() {
        let now_ms = 1_700_000_000_000;
        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-public");
        let request = window_mint_request(&address, now_ms);
        let plan_id = request
            .effect_selectors
            .window_install
            .as_ref()
            .unwrap()
            .window_plans[0]
            .window_plan_id
            .clone();
        let candidates =
            crate::auth::rehearsal::generate_window_namespace_candidates(&request, &OsRandom)
                .unwrap();
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        let grant_id = db
            .auth_rehearsal_mint(RehearsalMintPlan {
                request,
                bindings: bindings.clone(),
                carrier,
                window_namespace_candidates: candidates,
                now_ms,
            })
            .unwrap()
            .grant
            .grant_id;
        let exercise = RehearsalExercisePlan {
            carrier_hash: *RehearsalBearer::parse(&carrier_text)
                .unwrap()
                .token_hash()
                .as_bytes(),
            bindings: bindings.clone(),
            request: RehearsalExerciseRequestV1::WindowInstall {
                idempotency_key: "public-refusal".to_owned(),
                window_plan_id: plan_id,
            },
            resolved_contact: None,
            semantic_success: true,
            outcome: serde_json::Value::Null,
            now_ms,
        };
        let error = db
            .auth_rehearsal_install_window(RehearsalWindowInstallPlan {
                exercise,
                reachability: RehearsalReachabilityAdmissionV1 {
                    target_class: RehearsalTargetClassV1::PublicByDesign,
                    expected_target_build_digest: bindings.activation_digest.clone(),
                    fact: Some(crate::auth::rehearsal::AuthRehearsalReachabilityV1 {
                        kind: crate::auth::rehearsal::AUTH_REHEARSAL_REACHABILITY_KIND.to_owned(),
                        target_class: RehearsalTargetClassV1::PublicByDesign,
                        exposure: RehearsalReachabilityExposureV1::PublishedPublic,
                        producer_version: 1,
                        target_build_digest: bindings.activation_digest,
                        deployment_config_digest: format!("sha256:{}", "d".repeat(64)),
                    }),
                },
            })
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_REHEARSAL_REACHABILITY_PUBLIC"
        );
        let status = db.auth_rehearsal_status(Some(&grant_id), now_ms).unwrap();
        assert_eq!(status.grants[0].remaining.uses, 5);
        assert_eq!(status.grants[0].remaining.window_installs, 1);
        assert!(
            !db.auth_rehearsal_store_markers()
                .unwrap()
                .rehearsal_admitted
        );
    }

    fn clock_mint_request(
        markers: &AuthRehearsalStoreMarkersV1,
        now_ms: u64,
    ) -> RehearsalMintRequestV1 {
        RehearsalMintRequestV1 {
            scopes: vec![RehearsalEffect::ClockAuthAdvance],
            effect_selectors: EffectSelectorsV1 {
                clock_auth_advance: Some(ClockEffectSelectorV1 {
                    auth_clock: crate::auth::rehearsal::AuthClockSelectorV1 {
                        store_id: markers.store_id.clone(),
                        clock_domain: AuthClockDomainV1::Auth,
                        disposable_marker_id: markers
                            .disposable_marker_id
                            .clone()
                            .unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
                    },
                }),
                ..Default::default()
            },
            limits: crate::auth::rehearsal::RehearsalLimitsV1 {
                clock_advances: 1,
                max_uses: 1,
                ..Default::default()
            },
            expires_at: now_ms + 60_000,
            idempotency_key: uuid::Uuid::now_v7().to_string(),
            operator_audit_id: "operator-clock".to_owned(),
        }
    }

    #[test]
    fn disposable_marker_bars_pre_effect_promotion_and_confines_auth_clock() {
        let now_ms = 1_700_000_000_000;
        let mut disposable = LocalDatabase::memory().unwrap();
        disposable.activate_current_auth_catalog().unwrap();
        let markers = disposable
            .auth_rehearsal_mark_disposable_at_creation()
            .unwrap();
        assert!(markers.disposable_at_creation);
        assert_eq!(
            disposable
                .auth_rehearsal_require_production_eligible()
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT"
        );
        let bindings = binding("boot-clock");
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        disposable
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: clock_mint_request(&markers, now_ms),
                bindings: bindings.clone(),
                carrier,
                window_namespace_candidates: Vec::new(),
                now_ms,
            })
            .unwrap();
        let outcome = disposable
            .auth_rehearsal_advance_auth_clock(RehearsalExercisePlan {
                carrier_hash: *RehearsalBearer::parse(&carrier_text)
                    .unwrap()
                    .token_hash()
                    .as_bytes(),
                bindings,
                request: RehearsalExerciseRequestV1::ClockAuthAdvance {
                    idempotency_key: "advance-once".to_owned(),
                    advance_ms: 86_400_000,
                },
                resolved_contact: None,
                semantic_success: true,
                outcome: serde_json::Value::Null,
                now_ms,
            })
            .unwrap();
        let value = match outcome {
            RehearsalExerciseOutcome::Fresh(value) => value,
            RehearsalExerciseOutcome::Replay(_) => panic!("first advance is fresh"),
        };
        assert_eq!(value["priorAuthClockMs"], 0);
        assert_eq!(value["successorAuthClockMs"], 86_400_000);
        assert_eq!(disposable.auth_session_clock_floor().unwrap(), 86_400_000);
        let after = disposable.auth_rehearsal_store_markers().unwrap();
        assert!(after.disposable_at_creation && after.rehearsal_admitted);

        let mut ordinary = LocalDatabase::memory().unwrap();
        ordinary.activate_current_auth_catalog().unwrap();
        let ordinary_markers = ordinary.auth_rehearsal_store_markers().unwrap();
        let ordinary_bindings = binding("boot-ordinary-clock");
        let ordinary_carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let ordinary_text = ordinary_carrier.expose_secret().to_owned();
        ordinary
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: clock_mint_request(&ordinary_markers, now_ms),
                bindings: ordinary_bindings.clone(),
                carrier: ordinary_carrier,
                window_namespace_candidates: Vec::new(),
                now_ms,
            })
            .unwrap();
        assert_eq!(
            ordinary
                .auth_rehearsal_advance_auth_clock(RehearsalExercisePlan {
                    carrier_hash: *RehearsalBearer::parse(&ordinary_text)
                        .unwrap()
                        .token_hash()
                        .as_bytes(),
                    bindings: ordinary_bindings,
                    request: RehearsalExerciseRequestV1::ClockAuthAdvance {
                        idempotency_key: "ordinary-refused".to_owned(),
                        advance_ms: 9_000_000_000,
                    },
                    resolved_contact: None,
                    semantic_success: true,
                    outcome: serde_json::Value::Null,
                    now_ms,
                })
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_DISPOSABLE_REQUIRED"
        );
        assert_eq!(ordinary.auth_session_clock_floor().unwrap(), 0);
    }

    #[test]
    fn permanent_marker_survives_reset_and_physical_backup_clone() {
        let source_directory = tempfile::tempdir().unwrap();
        let source_path = source_directory.path().join("source.sqlite3");
        let mut source = LocalDatabase::open(&source_path).unwrap();
        source.activate_current_auth_catalog().unwrap();
        let before = source.auth_rehearsal_mark_disposable_at_creation().unwrap();
        source.schema_seed().reset().unwrap();
        let after = source.auth_rehearsal_store_markers().unwrap();
        assert_eq!(after, before);
        assert!(after.production_ineligible());

        let clone_path = source_directory.path().join("clone.sqlite3");
        let mut clone = rusqlite::Connection::open(&clone_path).unwrap();
        {
            let backup = rusqlite::backup::Backup::new(&source.conn, &mut clone).unwrap();
            backup
                .run_to_completion(128, std::time::Duration::from_millis(1), None)
                .unwrap();
        }
        let cloned: (String, i64, Option<String>, i64) = clone
            .query_row(
                &format!(
                    "SELECT store_id, disposable_at_creation, disposable_marker_id,
                            rehearsal_admitted
                     FROM {MARKERS} WHERE singleton = 1"
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(cloned.0, before.store_id);
        assert_eq!(cloned.1, 1);
        assert_eq!(cloned.2, before.disposable_marker_id);
        assert_eq!(cloned.3, 0);
    }

    #[test]
    fn export_envelope_refuses_edits_splices_substitution_and_admits_old_clean_snapshot() {
        let now_ms = 1_700_000_000_000;
        let keyring = crate::auth::keyring::AuthKeyringStore::in_memory();
        keyring.load_or_mint_initial(now_ms, &OsRandom).unwrap();
        let witness = AuthRehearsalSnapshotWitnessV1 {
            authorization_incarnation: uuid::Uuid::now_v7().to_string(),
            database_version: 7,
        };
        let mut source = LocalDatabase::memory().unwrap();
        source.activate_current_auth_catalog().unwrap();
        let clean = source
            .auth_rehearsal_logical_export(
                &keyring,
                serde_json::json!({ "rows": ["clean"] }),
                witness.clone(),
                now_ms,
                &OsRandom,
            )
            .unwrap();
        let clean_key =
            LocalDatabase::auth_rehearsal_export_verification_key(&keyring, &clean.envelope)
                .unwrap();
        let capsule_directory = tempfile::tempdir().unwrap();
        let capsule = capsule_directory.path().join("source-store.export-key");
        crate::auth::rehearsal::write_export_verification_key_capsule(
            &capsule,
            &clean.envelope.source_store_id,
            &clean.envelope.source_key_id,
            &clean_key,
        )
        .unwrap();
        let transferred_key = crate::auth::rehearsal::read_export_verification_key_capsule(
            &capsule,
            &clean.envelope.source_store_id,
            &clean.envelope.source_key_id,
        )
        .unwrap();
        assert_eq!(
            crate::auth::rehearsal::read_export_verification_key_capsule(
                &capsule,
                &uuid::Uuid::now_v7().to_string(),
                &clean.envelope.source_key_id,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_REHEARSAL_EXPORT_KEY_UNAVAILABLE"
        );

        let address = CanonicalAddress::parse("fixture@example.test").unwrap();
        let bindings = binding("boot-envelope");
        let carrier = RehearsalBearer::generate(&OsRandom).unwrap();
        let carrier_text = carrier.expose_secret().to_owned();
        source
            .auth_rehearsal_mint(RehearsalMintPlan {
                request: mint_request(&address, now_ms),
                bindings: bindings.clone(),
                carrier,
                window_namespace_candidates: Vec::new(),
                now_ms,
            })
            .unwrap();
        source
            .auth_rehearsal_exercise(RehearsalExercisePlan {
                carrier_hash: *RehearsalBearer::parse(&carrier_text)
                    .unwrap()
                    .token_hash()
                    .as_bytes(),
                bindings,
                request: RehearsalExerciseRequestV1::ChallengeCapture {
                    idempotency_key: "taint-source".to_owned(),
                    challenge_id: "sbc_AAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                    fixture_namespace: None,
                },
                resolved_contact: Some(address),
                semantic_success: true,
                outcome: serde_json::json!({ "captured": true }),
                now_ms,
            })
            .unwrap();
        let tainted = source
            .auth_rehearsal_logical_export(
                &keyring,
                serde_json::json!({ "rows": ["tainted"] }),
                witness,
                now_ms,
                &OsRandom,
            )
            .unwrap();
        let tainted_key =
            LocalDatabase::auth_rehearsal_export_verification_key(&keyring, &tainted.envelope)
                .unwrap();

        // S-26: later source taint does not travel backward into the exact
        // clean payload/envelope snapshot.
        let mut production = LocalDatabase::memory().unwrap();
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &clean,
                    &transferred_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap(),
            serde_json::json!({ "rows": ["clean"] })
        );
        // Import replay of the same immutable clean artifact is admissible and
        // cannot acquire the source store's later marker transition.
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &clean,
                    &transferred_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap(),
            serde_json::json!({ "rows": ["clean"] })
        );
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &tainted,
                    &tainted_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_STATE_PRESENT"
        );

        let mut payload_edit = clean.clone();
        payload_edit.payload[0] ^= 1;
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &payload_edit,
                    &clean_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID"
        );
        assert!(
            serde_json::from_value::<AuthRehearsalLogicalExportArtifactV1>(
                serde_json::json!({ "payload": [] })
            )
            .is_err()
        );
        let splice = AuthRehearsalLogicalExportArtifactV1 {
            envelope: clean.envelope.clone(),
            payload: tainted.payload.clone(),
        };
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &splice,
                    &clean_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID"
        );
        let mut envelope_edit = clean.clone();
        envelope_edit.envelope.marker_state.disposable_at_creation = true;
        envelope_edit.envelope.marker_state.disposable_marker_id =
            Some(uuid::Uuid::now_v7().to_string());
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &envelope_edit,
                    &clean_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID"
        );
        let wrong_key =
            crate::auth::rehearsal::RehearsalExportVerificationKey::from_bytes([0x55; 32]);
        assert_eq!(
            production
                .auth_rehearsal_import_logical_export(
                    &clean,
                    &wrong_key,
                    crate::contract_types::ServerProfile::Prod,
                )
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_REHEARSAL_ENVELOPE_INVALID"
        );
    }
}
impl super::ServingDatabase {
    pub fn auth_rehearsal_resolve(
        &mut self,
        carrier_hash: &[u8; 32],
        bindings: &RehearsalBindingFacts,
        now_ms: u64,
    ) -> SnapbackResult<AuthRehearsalGrantV1> {
        self.db
            .auth_rehearsal_resolve(carrier_hash, bindings, now_ms)
    }
    pub fn auth_rehearsal_mint(
        &mut self,
        plan: RehearsalMintPlan,
    ) -> SnapbackResult<MintedRehearsalGrant> {
        self.db.auth_rehearsal_mint(plan)
    }
    pub fn auth_rehearsal_revoke(
        &mut self,
        grant_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<RehearsalStatusV1> {
        self.db.auth_rehearsal_revoke(grant_id, now_ms)
    }
    pub fn auth_rehearsal_exercise(
        &mut self,
        plan: RehearsalExercisePlan,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        self.db.auth_rehearsal_exercise(plan)
    }
    pub fn auth_rehearsal_create_identity(
        &mut self,
        exercise: RehearsalExercisePlan,
        identity: crate::contract_types::PlannedIdentityState,
        address: &crate::auth::crypto::CanonicalAddress,
        provenance: &crate::auth::rehearsal::AuthRehearsalProvenanceV1,
        governing_not_after_ms: u64,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        self.db.auth_rehearsal_create_identity(
            exercise,
            identity,
            address,
            provenance,
            governing_not_after_ms,
        )
    }
    pub fn auth_rehearsal_install_window(
        &mut self,
        plan: RehearsalWindowInstallPlan,
    ) -> SnapbackResult<(RehearsalExerciseOutcome, AuthRehearsalWindowV1)> {
        self.db.auth_rehearsal_install_window(plan)
    }
    pub fn auth_rehearsal_advance_auth_clock(
        &mut self,
        exercise: RehearsalExercisePlan,
    ) -> SnapbackResult<RehearsalExerciseOutcome> {
        self.db.auth_rehearsal_advance_auth_clock(exercise)
    }
}
