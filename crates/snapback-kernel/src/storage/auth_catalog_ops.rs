use super::{LocalDatabase, SnapbackResult};
use crate::auth::crypto::{
    AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, StepUpConsumption, StepUpDigest,
    StepUpProof, TokenHash, VerificationCode,
};
use crate::auth::throttle::{
    AUTH_MAXIMUM_ATTEMPTS, AuthBudgetName, AuthBudgetRefusal, RecipientRuleDisposition,
    ResolvedCompatibilityAuthBudgetPolicy, RollingWindowBudgetTerms,
};
use crate::contract_types::{
    AuthSessionRecord as SessionRecord, AuthSessionResponseFact, AuthenticatedUseRow,
    CatalogIssuanceReconcile, DurableRejectedIssuanceReconcile, DurableRevocationReconcile,
    DurableRotationReconcile, EvictionCandidateFact, ExchangeChallengeFact, ExistingIdentityFact,
    PlannedFamilyAlarmCommit, PlannedIdentityState, PlannedRevocationCommit,
    PlannedRotationTransaction, PresentedSessionLookup, RejectedExchangeOutcome,
    RequestInsertOutcome, ResolvedSession, RevocationReason, SessionCapFacts, SessionIssuanceFacts,
    SessionRevocation, SessionRevocationCandidateFact, TokenDigest,
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use sha2::{Digest as _, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

#[cfg(any(test, feature = "test-support"))]
use crate::auth::crypto::SessionBearer;

pub const INTERNAL_AUTH_COLLISION: &str = "INTERNAL_AUTH_COLLISION";
pub(super) const GUEST_IDEMPOTENCY_TABLE: &str = "_snapback_auth_guest_idempotency";

pub fn guest_refusal_correlation_id(key_digest: &[u8; 32], request_digest: &[u8; 32]) -> String {
    let mut digest = Sha256::new();
    digest.update(b"snapback.auth.guest-entry.refusal-correlation.v1\0");
    digest.update(key_digest);
    digest.update(request_digest);
    let digest = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes).to_string()
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CatalogGuestEntryIdempotencyPlan {
    pub key_digest: [u8; 32],
    pub request_digest: [u8; 32],
    pub key_id: String,
    pub created_at_ms: u64,
    pub retain_until_ms: u64,
    pub refusal_correlation_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GuestEntryIdempotencyLookup {
    Missing,
    Pending {
        key_id: String,
        created_at_ms: u64,
    },
    Committed {
        key_id: String,
        created_at_ms: u64,
    },
    Refused {
        key_id: String,
        created_at_ms: u64,
        budget_name: String,
        retry_after_ms: u64,
        correlation_id: String,
    },
    Conflict,
}

pub fn internal_collision_snapback() -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        INTERNAL_AUTH_COLLISION,
        "auth",
        "authentication credential candidate collided",
    )
}

pub fn internal_state_snapback() -> crate::diagnostic::SnapbackError {
    crate::diagnostic::SnapbackError::error(
        "INTERNAL_AUTH_STATE",
        "auth",
        "authentication state invariant failed",
    )
}

pub fn is_constraint_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(sqlite, _)
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn checked_stored_time(value: i64) -> SnapbackResult<u64> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value <= crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)
}

/// Exact durable predecessor selected by sync policy for one revocation CAS.
pub struct CatalogRevocationPlan<'a> {
    pub session_id: &'a str,
    pub expected_generation: u64,
    pub presented_digest: TokenDigest,
    pub superseded_at_ms: Option<u64>,
    pub reason: RevocationReason,
}

/// Fixed-shape family-alarm transaction input. `actionable` is decided by
/// provider policy before the kernel receives this value.
pub struct CatalogFamilyAlarmPlan<'a> {
    pub revocation: CatalogRevocationPlan<'a>,
    pub observed_at_ms: u64,
    pub actionable: bool,
}

/// Exact current-token predecessor and already-minted successor for rotation.
pub struct CatalogRotationPlan<'a> {
    pub session_id: &'a str,
    pub expected_generation: u64,
    pub predecessor_digest: TokenDigest,
    pub successor_digest: TokenDigest,
    pub superseded_at_ms: u64,
}

/// Fully decided password-change durable predecessor. Password verification,
/// replacement hashing, lockout policy, and revocation selection happen in
/// sync policy before the kernel receives this carrier.
pub struct CatalogPasswordChangePlan<'a> {
    pub mutation: &'a crate::storage::auth_identity::CredentialRotationMutation,
    pub rotation: CatalogRotationPlan<'a>,
    pub revocations: Vec<CatalogRevocationPlan<'a>>,
    pub password_profile: crate::storage::auth_identity::PasswordSecurityProfile,
    pub successor_provider: Option<&'static str>,
    pub successful_effect_budget: Option<crate::auth::throttle::RollingWindowBudgetTerms>,
}

#[derive(Clone, Debug)]
pub enum CatalogPasswordChangeCommit {
    Committed {
        session: AuthSessionResponseFact,
        committed_revocations: Vec<SessionRevocation>,
    },
    CredentialInvalid {
        committed_attempt: Option<crate::storage::auth_identity::PasswordAttemptState>,
    },
    CredentialThrottled,
    GuestClaimCollision,
    GuestAlreadyClaimed,
    GuestBudgetRefused {
        budget_name: &'static str,
        retry_after_ms: u64,
    },
    CandidateCollision,
    PredecessorChanged,
}

pub enum CatalogPasswordChangeReconcile {
    ExactPredecessor,
    ExactSuccessor {
        session: AuthSessionResponseFact,
        committed_revocations: Vec<SessionRevocation>,
    },
    DifferentValid,
}

pub struct CatalogChallengeConsumption<'a> {
    pub challenge_id: &'a str,
    pub key_id: &'a str,
    pub code_digest: &'a [u8; 32],
    pub expected_attempts: u32,
    pub max_attempts: u32,
    pub expires_at_ms: u64,
}

pub struct CatalogProjectedSession<'a> {
    pub session_id: &'a str,
    pub user_id: &'a str,
    pub provider: &'a str,
    pub authority_instance_id: &'a str,
    pub generation: u64,
    pub token_digest: TokenDigest,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub absolute_expires_at_ms: u64,
    pub rehearsal_provenance: Option<&'a crate::auth::rehearsal::AuthRehearsalProvenanceV1>,
}

/// Fully decided session issuance predecessor. The kernel rechecks and commits
/// these facts; it does not choose identity ownership, cap eviction, or
/// challenge terminality.
pub struct CatalogSessionIssuancePlan<'a> {
    pub address: &'a CanonicalAddress,
    pub now_ms: u64,
    pub identity: &'a crate::contract_types::PlannedIdentityState,
    pub projected: CatalogProjectedSession<'a>,
    pub revocations: Vec<CatalogRevocationPlan<'a>>,
    pub password: Option<&'a crate::storage::auth_identity::PasswordIssuanceCommitPlan>,
    pub password_profile: Option<crate::storage::auth_identity::PasswordSecurityProfile>,
    pub challenge: Option<CatalogChallengeConsumption<'a>>,
    pub sender_issuance: Option<&'a crate::auth::sender_proof::SenderIssuanceCommitment>,
    pub rehearsal_exercise: Option<&'a crate::storage::auth_rehearsal::RehearsalExercisePlan>,
    pub guest_effect_budget: Option<crate::auth::throttle::RollingWindowBudgetTerms>,
    pub guest_idempotency: Option<&'a CatalogGuestEntryIdempotencyPlan>,
    pub live_session_limit: u64,
}

impl CatalogSessionIssuancePlan<'_> {
    fn eviction(&self) -> Option<&CatalogRevocationPlan<'_>> {
        self.revocations
            .iter()
            .find(|revocation| revocation.reason == RevocationReason::CapEviction)
    }
}

pub struct CatalogRejectedExchangePlan<'a> {
    pub challenge_id: &'a ChallengeId,
    pub address: &'a CanonicalAddress,
    pub key_id: &'a str,
    pub key: &'a AuthKeyMaterial,
    pub code: &'a VerificationCode,
    pub now_ms: u64,
    pub dummy_key: &'a AuthKeyMaterial,
    pub dummy_address: &'a CanonicalAddress,
    pub sender_issuance: Option<&'a crate::auth::sender_proof::SenderIssuanceCommitment>,
}

pub struct CatalogStepUpBinding<'a> {
    pub user_id: &'a str,
    pub session_id: &'a str,
    pub session_generation: u64,
    pub authority_instance_id: &'a str,
    pub operation: &'a str,
}

#[derive(Clone, Debug)]
pub enum CatalogIssuanceCommit {
    Committed {
        session: AuthSessionResponseFact,
        committed_revocations: Vec<SessionRevocation>,
    },
    CodeInvalid,
    CodeLocked,
    CredentialInvalid {
        committed_attempt: Option<crate::storage::auth_identity::PasswordAttemptState>,
    },
    CredentialThrottled,
    GuestBudgetRefused {
        budget_name: &'static str,
        retry_after_ms: u64,
        correlation_id: String,
    },
    GuestIdempotencyConflict,
    // @ref LLP 0077#issuance-refresh-and-recovery — one live family per
    // thumbprint: a valid proof over an already-bound key consumes its proof
    // id and refuses without touching the challenge, session, or nonce state.
    SenderKeyBound,
    CandidateCollision,
    PredecessorChanged,
    RehearsalReplay(serde_json::Value),
    RehearsalDenied(crate::diagnostic::SnapbackError),
}

fn session_live_at(session: &SessionRecord, now_ms: u64) -> bool {
    !session.revoked && now_ms < session.session.expires_at_ms
}

fn session_response_fact(session: &SessionRecord) -> AuthSessionResponseFact {
    AuthSessionResponseFact {
        id: session.session.session_id.clone(),
        user_id: session.session.user_id.clone(),
        provider: session.session.provider.clone(),
        created_at: session.session.created_at_ms,
        expires_at: session.session.expires_at_ms,
        absolute_expires_at: session.session.absolute_expires_at_ms,
        authority_instance_id: session.session.authority_instance_id.clone(),
        generation: session.session.generation,
    }
}

fn ensure_guest_idempotency_table(connection: &Connection) -> SnapbackResult<()> {
    connection.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {GUEST_IDEMPOTENCY_TABLE}(
           key_digest BLOB PRIMARY KEY,
           request_digest BLOB NOT NULL,
           key_id TEXT NOT NULL,
           created_at_ms INTEGER NOT NULL,
           retain_until_ms INTEGER NOT NULL,
           state TEXT NOT NULL CHECK(state IN ('pending','committed','refused')),
           budget_name TEXT,
           retry_after_ms INTEGER,
           refusal_correlation_id TEXT,
           CHECK((state='refused')=(budget_name IS NOT NULL)),
           CHECK((state='refused')=(retry_after_ms IS NOT NULL)),
           CHECK(state!='refused' OR refusal_correlation_id IS NOT NULL),
           CHECK(created_at_ms BETWEEN 0 AND 9007199254740991),
           CHECK(retain_until_ms BETWEEN created_at_ms AND 9007199254740991)
         );"
    ))?;
    // The guest-entry table was introduced on the feature branch before the
    // complete refusal receipt gained its stable public correlation identity.
    // Upgrade such local databases in place rather than making replay depend
    // on whether the process first saw the old or new binary.
    let has_correlation_column = {
        let mut statement =
            connection.prepare(&format!("PRAGMA table_info({GUEST_IDEMPOTENCY_TABLE})"))?;
        let names = statement.query_map([], |row| row.get::<_, String>(1))?;
        let mut found = false;
        for name in names {
            if name? == "refusal_correlation_id" {
                found = true;
            }
        }
        found
    };
    if !has_correlation_column {
        connection.execute_batch(&format!(
            "ALTER TABLE {GUEST_IDEMPOTENCY_TABLE}
               ADD COLUMN refusal_correlation_id TEXT;"
        ))?;
    }
    connection.execute_batch(&format!(
        "CREATE INDEX IF NOT EXISTS _snapback_auth_guest_idempotency_retention
           ON {GUEST_IDEMPOTENCY_TABLE}(retain_until_ms,key_digest);"
    ))?;
    Ok(())
}

impl LocalDatabase {
    pub fn guest_entry_idempotency_lookup(
        &mut self,
        key_digest: &[u8; 32],
        request_digest: &[u8; 32],
        now_ms: u64,
    ) -> SnapbackResult<GuestEntryIdempotencyLookup> {
        self.with_auth_transaction(|transaction| {
            ensure_guest_idempotency_table(transaction)?;
            transaction.execute(
                &format!(
                    "DELETE FROM {GUEST_IDEMPOTENCY_TABLE}
                       WHERE key_digest=?1 AND retain_until_ms<=?2"
                ),
                params![key_digest.as_slice(), now_ms as i64],
            )?;
            let row: Option<(
                Vec<u8>,
                String,
                i64,
                i64,
                String,
                Option<String>,
                Option<i64>,
                Option<String>,
            )> =
                transaction
                    .query_row(
                        &format!(
                            "SELECT request_digest,key_id,created_at_ms,retain_until_ms,state,budget_name,retry_after_ms,refusal_correlation_id
                               FROM {GUEST_IDEMPOTENCY_TABLE} WHERE key_digest=?1"
                        ),
                        params![key_digest.as_slice()],
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
            let Some((durable_request, key_id, created_at_ms, retain_until_ms, state, budget, retry, mut correlation_id)) = row
            else {
                return Ok(GuestEntryIdempotencyLookup::Missing);
            };
            if durable_request.as_slice() != request_digest.as_slice() {
                return Ok(GuestEntryIdempotencyLookup::Conflict);
            }
            let created_at_ms =
                u64::try_from(created_at_ms).map_err(|_| internal_state_snapback())?;
            let retain_until_ms =
                u64::try_from(retain_until_ms).map_err(|_| internal_state_snapback())?;
            if retain_until_ms <= created_at_ms || now_ms >= retain_until_ms {
                return Err(internal_state_snapback());
            }
            if state == "refused" && correlation_id.is_none() {
                let repaired = guest_refusal_correlation_id(key_digest, request_digest);
                transaction.execute(
                    &format!(
                        "UPDATE {GUEST_IDEMPOTENCY_TABLE}
                            SET refusal_correlation_id=?1
                          WHERE key_digest=?2 AND request_digest=?3 AND state='refused'
                            AND refusal_correlation_id IS NULL"
                    ),
                    params![repaired, key_digest.as_slice(), request_digest.as_slice()],
                )?;
                correlation_id = Some(repaired);
            }
            Ok(match state.as_str() {
                "pending" => GuestEntryIdempotencyLookup::Pending {
                    key_id,
                    created_at_ms,
                },
                "committed" => GuestEntryIdempotencyLookup::Committed {
                    key_id,
                    created_at_ms,
                },
                "refused" => GuestEntryIdempotencyLookup::Refused {
                    key_id,
                    created_at_ms,
                    budget_name: budget.ok_or_else(internal_state_snapback)?,
                    retry_after_ms: u64::try_from(retry.ok_or_else(internal_state_snapback)?)
                        .map_err(|_| internal_state_snapback())?,
                    correlation_id: correlation_id.ok_or_else(internal_state_snapback)?,
                },
                _ => return Err(internal_state_snapback()),
            })
        })
    }
}

fn catalog_committed_generation(plan: &CatalogRevocationPlan<'_>) -> SnapbackResult<u64> {
    plan.expected_generation
        .checked_add(1)
        .filter(|generation| *generation <= crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)
}

fn execute_candidate(
    transaction: &Transaction<'_>,
    sql: &str,
    parameters: impl rusqlite::Params,
) -> SnapbackResult<usize> {
    match transaction.execute(sql, parameters) {
        Ok(changed) => Ok(changed),
        Err(error) if is_constraint_error(&error) => Err(internal_collision_snapback()),
        Err(error) => Err(error.into()),
    }
}
#[derive(Debug)]
struct RawSessionRecord {
    session_id: String,
    user_id: String,
    identity_id: String,
    provider: String,
    generation: i64,
    authority_instance_id: String,
    created_at_ms: i64,
    last_used_at_ms: i64,
    expires_at_ms: i64,
    absolute_expires_at_ms: i64,
    revoked_at_ms: Option<i64>,
}

pub(crate) fn lookup_presented_session(
    connection: &Connection,
    token_hash: &TokenHash,
) -> SnapbackResult<PresentedSessionLookup> {
    if let Some(current) = lookup_current_session(connection, token_hash)? {
        return Ok(PresentedSessionLookup::Current(current));
    }
    if let Some((session, superseded_at_ms)) = lookup_tombstone_session(connection, token_hash)? {
        return Ok(PresentedSessionLookup::Tombstone {
            session,
            superseded_at_ms,
        });
    }
    Ok(PresentedSessionLookup::Unknown)
}

fn lookup_current_session(
    connection: &Connection,
    token_hash: &TokenHash,
) -> SnapbackResult<Option<SessionRecord>> {
    let raw = connection
        .query_row(
            "SELECT session.id, session.user_id,
                    COALESCE(session.identity_id,session.id),
                    CASE WHEN session.authn_source='guest'
                         THEN 'guest' ELSE identity.provider END,
                    session.generation,
                    session.authority_instance_id, session.created_at_ms,
                    session.last_used_at_ms, session.expires_at_ms,
                    session.absolute_expires_at_ms, session.revoked_at_ms
             FROM _auth_sessions AS session
             LEFT JOIN _auth_identities AS identity
               ON identity.id = session.identity_id AND identity.user_id = session.user_id
             WHERE session.token_hash = ?1",
            params![token_hash.as_bytes().as_slice()],
            raw_session_record,
        )
        .optional()?;
    raw.map(checked_session_record).transpose()
}

fn lookup_tombstone_session(
    connection: &Connection,
    token_hash: &TokenHash,
) -> SnapbackResult<Option<(SessionRecord, u64)>> {
    let raw = connection
        .query_row(
            "SELECT session.id, session.user_id,
                    COALESCE(session.identity_id,session.id),
                    CASE WHEN session.authn_source='guest'
                         THEN 'guest' ELSE identity.provider END,
                    session.generation,
                    session.authority_instance_id, session.created_at_ms,
                    session.last_used_at_ms, session.expires_at_ms,
                    session.absolute_expires_at_ms, session.revoked_at_ms,
                    token.superseded_at_ms
             FROM _auth_session_tokens AS token
             JOIN _auth_sessions AS session ON session.id = token.session_id
             JOIN _auth_identities AS identity
               ON identity.id = session.identity_id AND identity.user_id = session.user_id
             WHERE token.token_hash = ?1",
            params![token_hash.as_bytes().as_slice()],
            |row| Ok((raw_session_record(row)?, row.get::<_, i64>(11)?)),
        )
        .optional()?;
    raw.map(|(raw, superseded_at_ms)| {
        Ok((
            checked_session_record(raw)?,
            checked_stored_time(superseded_at_ms)?,
        ))
    })
    .transpose()
}

fn raw_session_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawSessionRecord> {
    Ok(RawSessionRecord {
        session_id: row.get(0)?,
        user_id: row.get(1)?,
        identity_id: row.get(2)?,
        provider: row.get(3)?,
        generation: row.get(4)?,
        authority_instance_id: row.get(5)?,
        created_at_ms: row.get(6)?,
        last_used_at_ms: row.get(7)?,
        expires_at_ms: row.get(8)?,
        absolute_expires_at_ms: row.get(9)?,
        revoked_at_ms: row.get(10)?,
    })
}

fn checked_session_record(raw: RawSessionRecord) -> SnapbackResult<SessionRecord> {
    let generation = u64::try_from(raw.generation)
        .ok()
        .filter(|generation| {
            *generation != 0 && *generation <= crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
        })
        .ok_or_else(internal_state_snapback)?;
    let created_at_ms = checked_stored_time(raw.created_at_ms)?;
    let last_used_at_ms = checked_stored_time(raw.last_used_at_ms)?;
    let expires_at_ms = checked_stored_time(raw.expires_at_ms)?;
    let absolute_expires_at_ms = checked_stored_time(raw.absolute_expires_at_ms)?;
    let revoked_at_ms = raw.revoked_at_ms.map(checked_stored_time).transpose()?;
    if created_at_ms > last_used_at_ms
        || last_used_at_ms > expires_at_ms
        || expires_at_ms > absolute_expires_at_ms
        || revoked_at_ms.is_some_and(|revoked_at_ms| revoked_at_ms < created_at_ms)
    {
        return Err(internal_state_snapback());
    }
    Ok(SessionRecord {
        session: ResolvedSession {
            session_id: raw.session_id,
            user_id: raw.user_id,
            identity_id: raw.identity_id,
            provider: raw.provider,
            generation,
            authority_instance_id: raw.authority_instance_id,
            created_at_ms,
            expires_at_ms,
            absolute_expires_at_ms,
        },
        revoked: revoked_at_ms.is_some(),
    })
}

#[derive(Debug)]
struct DurableSessionSnapshot {
    record: SessionRecord,
    current_digest: TokenDigest,
    last_used_at_ms: u64,
    revoked_at_ms: Option<u64>,
}

fn lookup_session_snapshot(
    connection: &Connection,
    session_id: &str,
) -> SnapbackResult<Option<DurableSessionSnapshot>> {
    let raw = connection
        .query_row(
            "SELECT session.id, session.user_id,
                    COALESCE(session.identity_id,session.id),
                    CASE WHEN session.authn_source='guest'
                         THEN 'guest' ELSE identity.provider END,
                    session.generation,
                    session.authority_instance_id, session.created_at_ms,
                    session.last_used_at_ms, session.expires_at_ms,
                    session.absolute_expires_at_ms, session.revoked_at_ms,
                    session.token_hash
             FROM _auth_sessions AS session
             LEFT JOIN _auth_identities AS identity
               ON identity.id = session.identity_id AND identity.user_id = session.user_id
             WHERE session.id = ?1",
            params![session_id],
            |row| Ok((raw_session_record(row)?, row.get::<_, Vec<u8>>(11)?)),
        )
        .optional()?;
    raw.map(|(raw, token_hash)| {
        let revoked_at_ms = raw.revoked_at_ms.map(checked_stored_time).transpose()?;
        let last_used_at_ms = checked_stored_time(raw.last_used_at_ms)?;
        let current_digest =
            TokenDigest::from_slice(&token_hash).map_err(|_| internal_state_snapback())?;
        Ok(DurableSessionSnapshot {
            record: checked_session_record(raw)?,
            current_digest,
            last_used_at_ms,
            revoked_at_ms,
        })
    })
    .transpose()
}

fn exact_tombstone_time(
    connection: &Connection,
    session_id: &str,
    digest: TokenDigest,
) -> SnapbackResult<Option<u64>> {
    connection
        .query_row(
            "SELECT superseded_at_ms FROM _auth_session_tokens
             WHERE session_id = ?1 AND token_hash = ?2",
            params![session_id, digest.as_bytes().as_slice()],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .map(checked_stored_time)
        .transpose()
}
pub(crate) fn planned_revocation_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogRevocationPlan,
    now_ms: u64,
) -> SnapbackResult<PlannedRevocationCommit> {
    let committed_generation = catalog_committed_generation(plan)?;
    let changed = match plan.superseded_at_ms {
        None => transaction.execute(
            "UPDATE _auth_sessions
             SET revoked_at_ms = ?1, generation = ?2
             WHERE id = ?3 AND generation = ?4 AND token_hash = ?5
               AND revoked_at_ms IS NULL AND ?1 < expires_at_ms",
            params![
                now_ms as i64,
                committed_generation as i64,
                plan.session_id,
                plan.expected_generation as i64,
                plan.presented_digest.as_bytes().as_slice(),
            ],
        )?,
        Some(superseded_at_ms) => transaction.execute(
            "UPDATE _auth_sessions
             SET revoked_at_ms = ?1, generation = ?2
             WHERE id = ?3 AND generation = ?4 AND revoked_at_ms IS NULL
               AND ?1 < expires_at_ms
               AND EXISTS(
                 SELECT 1 FROM _auth_session_tokens AS token
                 WHERE token.session_id = _auth_sessions.id
                   AND token.token_hash = ?5 AND token.superseded_at_ms = ?6
               )",
            params![
                now_ms as i64,
                committed_generation as i64,
                plan.session_id,
                plan.expected_generation as i64,
                plan.presented_digest.as_bytes().as_slice(),
                superseded_at_ms as i64,
            ],
        )?,
    };
    if changed > 1 {
        return Err(internal_state_snapback());
    }
    if changed == 1 {
        crate::storage::auth::write_session_terminal_cause_in(
            transaction,
            &plan.session_id,
            committed_generation,
            now_ms,
            plan.reason,
        )?;
    }
    let durable: Option<(i64, Option<i64>)> = transaction
        .query_row(
            "SELECT generation, revoked_at_ms
             FROM _auth_sessions WHERE id = ?1",
            params![plan.session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((generation, revoked_at_ms)) = durable else {
        return Ok(PlannedRevocationCommit::PredecessorChanged);
    };
    let generation = u64::try_from(generation)
        .ok()
        .filter(|generation| {
            *generation != 0 && *generation <= crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
        })
        .ok_or_else(internal_state_snapback)?;
    if changed == 1 {
        if revoked_at_ms == Some(now_ms as i64) && generation == committed_generation {
            return Ok(PlannedRevocationCommit::Committed(SessionRevocation {
                session_id: plan.session_id.to_owned(),
                generation,
            }));
        }
        return Err(internal_state_snapback());
    }
    if let Some(revoked_at_ms) = revoked_at_ms
        && generation >= committed_generation
    {
        let revoked_at_ms = u64::try_from(revoked_at_ms).map_err(|_| internal_state_snapback())?;
        let reason = crate::storage::auth::read_session_terminal_cause_on(
            transaction,
            &plan.session_id,
            generation,
            revoked_at_ms,
        )?;
        Ok(PlannedRevocationCommit::AlreadyTerminal { generation, reason })
    } else {
        Ok(PlannedRevocationCommit::PredecessorChanged)
    }
}

pub(crate) fn planned_family_alarm_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogFamilyAlarmPlan,
) -> SnapbackResult<PlannedFamilyAlarmCommit> {
    match planned_revocation_transaction(transaction, &plan.revocation, plan.observed_at_ms)? {
        PlannedRevocationCommit::Committed(revocation) if plan.actionable => {
            Ok(PlannedFamilyAlarmCommit::Revoked(revocation))
        }
        PlannedRevocationCommit::Committed(_) => Err(internal_state_snapback()),
        PlannedRevocationCommit::AlreadyTerminal { .. }
        | PlannedRevocationCommit::PredecessorChanged
            if plan.actionable =>
        {
            Ok(PlannedFamilyAlarmCommit::Retry)
        }
        PlannedRevocationCommit::AlreadyTerminal { .. }
        | PlannedRevocationCommit::PredecessorChanged => Ok(PlannedFamilyAlarmCommit::Noop),
    }
}

pub(crate) fn reconcile_planned_revocation(
    connection: &Connection,
    plan: &CatalogRevocationPlan,
    now_ms: u64,
) -> SnapbackResult<DurableRevocationReconcile> {
    let Some(snapshot) = lookup_session_snapshot(connection, &plan.session_id)? else {
        return Ok(DurableRevocationReconcile::DifferentValid);
    };
    let committed_generation = catalog_committed_generation(plan)?;
    if snapshot.record.session.generation == committed_generation
        && snapshot.revoked_at_ms == Some(now_ms)
        && crate::storage::auth::session_terminal_cause_matches_on(
            connection,
            &plan.session_id,
            committed_generation,
            now_ms,
            plan.reason,
        )?
    {
        return Ok(DurableRevocationReconcile::ExactSuccessor(
            SessionRevocation {
                session_id: plan.session_id.to_owned(),
                generation: committed_generation,
            },
        ));
    }
    let exact_source = match plan.superseded_at_ms {
        None => snapshot.current_digest == plan.presented_digest,
        Some(superseded_at_ms) => {
            exact_tombstone_time(connection, &plan.session_id, plan.presented_digest)?
                == Some(superseded_at_ms)
        }
    };
    if snapshot.record.session.generation == plan.expected_generation
        && !snapshot.record.revoked
        && session_live_at(&snapshot.record, now_ms)
        && exact_source
    {
        Ok(DurableRevocationReconcile::ExactPredecessor)
    } else {
        Ok(DurableRevocationReconcile::DifferentValid)
    }
}

pub(crate) fn reconcile_planned_rotation(
    connection: &Connection,
    plan: &CatalogRotationPlan,
) -> SnapbackResult<DurableRotationReconcile> {
    let Some(snapshot) = lookup_session_snapshot(connection, &plan.session_id)? else {
        return Ok(DurableRotationReconcile::DifferentValid);
    };
    let predecessor_tombstone =
        exact_tombstone_time(connection, &plan.session_id, plan.predecessor_digest)?;
    if snapshot.record.session.generation == plan.expected_generation
        && !snapshot.record.revoked
        && snapshot.current_digest == plan.successor_digest
    {
        if predecessor_tombstone != Some(plan.superseded_at_ms) {
            return Err(internal_state_snapback());
        }
        return Ok(DurableRotationReconcile::ExactSuccessor(
            session_response_fact(&snapshot.record),
        ));
    }
    if snapshot.record.session.generation == plan.expected_generation
        && !snapshot.record.revoked
        && snapshot.current_digest == plan.predecessor_digest
        && predecessor_tombstone.is_none()
    {
        Ok(DurableRotationReconcile::ExactPredecessor)
    } else {
        Ok(DurableRotationReconcile::DifferentValid)
    }
}

pub(crate) fn planned_rotation_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogRotationPlan,
) -> SnapbackResult<PlannedRotationTransaction> {
    let now_ms = plan.superseded_at_ms;
    let predecessor = TokenHash::from_bytes(*plan.predecessor_digest.as_bytes());
    let Some(current) = lookup_current_session(transaction, &predecessor)? else {
        return Ok(PlannedRotationTransaction::PredecessorChanged);
    };
    if current.session.session_id != plan.session_id
        || current.session.generation != plan.expected_generation
        || !session_live_at(&current, now_ms)
    {
        return Ok(PlannedRotationTransaction::PredecessorChanged);
    }
    let successor_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM _auth_sessions WHERE token_hash = ?1)
                OR EXISTS(SELECT 1 FROM _auth_session_tokens WHERE token_hash = ?1)",
        params![plan.successor_digest.as_bytes().as_slice()],
        |row| row.get(0),
    )?;
    if successor_exists {
        return Ok(PlannedRotationTransaction::CandidateCollision);
    }
    execute_candidate(
        transaction,
        "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
         VALUES(?1, ?2, ?3)",
        params![
            plan.predecessor_digest.as_bytes().as_slice(),
            plan.session_id,
            now_ms as i64,
        ],
    )?;
    let changed = execute_candidate(
        transaction,
        "UPDATE _auth_sessions SET token_hash = ?1
         WHERE id = ?2 AND generation = ?3 AND token_hash = ?4
           AND revoked_at_ms IS NULL AND ?5 < expires_at_ms",
        params![
            plan.successor_digest.as_bytes().as_slice(),
            plan.session_id,
            plan.expected_generation as i64,
            plan.predecessor_digest.as_bytes().as_slice(),
            now_ms as i64,
        ],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
    Ok(PlannedRotationTransaction::Refreshed(
        session_response_fact(&current),
    ))
}

pub(crate) fn authenticated_use_row(
    connection: &Connection,
    session_id: &str,
    expected_generation: u64,
) -> SnapbackResult<Option<crate::contract_types::AuthenticatedUseRow>> {
    let raw = connection
        .query_row(
            "SELECT generation, last_used_at_ms, expires_at_ms,
                    absolute_expires_at_ms, revoked_at_ms IS NOT NULL
             FROM _auth_sessions WHERE id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, bool>(4)?,
                ))
            },
        )
        .optional()?;
    raw.map(|(generation, last_used, expires, absolute, revoked)| {
        let generation = u64::try_from(generation)
            .ok()
            .filter(|generation| {
                *generation != 0 && *generation <= crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
            })
            .ok_or_else(internal_state_snapback)?;
        let row = crate::contract_types::AuthenticatedUseRow {
            generation,
            last_used_at_ms: checked_stored_time(last_used)?,
            expires_at_ms: checked_stored_time(expires)?,
            absolute_expires_at_ms: checked_stored_time(absolute)?,
            revoked,
        };
        if row.expires_at_ms > row.absolute_expires_at_ms {
            return Err(internal_state_snapback());
        }
        Ok((row.generation == expected_generation).then_some(row))
    })
    .transpose()
    .map(Option::flatten)
}

pub(crate) fn exchange_challenge_fact(
    connection: &Connection,
    challenge_id: &ChallengeId,
) -> SnapbackResult<Option<ExchangeChallengeFact>> {
    let raw = connection
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                    superseded_by IS NOT NULL
             FROM _auth_verification_codes WHERE challenge_id = ?1",
            params![challenge_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Zeroizing::new(row.get::<_, Vec<u8>>(1)?),
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            },
        )
        .optional()?;
    raw.map(
        |(address, digest, key_id, attempts, max_attempts, expires, consumed, superseded)| {
            Ok(ExchangeChallengeFact {
                address,
                code_digest: digest
                    .as_slice()
                    .try_into()
                    .map_err(|_| internal_state_snapback())?,
                key_id,
                attempts: u32::try_from(attempts).map_err(|_| internal_state_snapback())?,
                max_attempts: u32::try_from(max_attempts).map_err(|_| internal_state_snapback())?,
                expires_at_ms: checked_stored_time(expires)?,
                consumed,
                superseded,
            })
        },
    )
    .transpose()
}

pub(crate) fn session_issuance_facts(
    connection: &Connection,
    address: &CanonicalAddress,
    candidate_user_id: &str,
    now_ms: u64,
    live_limit: u64,
) -> SnapbackResult<SessionIssuanceFacts> {
    let existing_identity = connection
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![address.as_str()],
            |row| {
                Ok(ExistingIdentityFact {
                    identity_id: row.get(0)?,
                    user_id: row.get(1)?,
                })
            },
        )
        .optional()?;
    let user_id = existing_identity
        .as_ref()
        .map(|identity| identity.user_id.as_str())
        .unwrap_or(candidate_user_id);
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, now_ms as i64],
        |row| row.get(0),
    )?;
    let live_session_count = u64::try_from(count).map_err(|_| internal_state_snapback())?;
    let oldest_live_session = (live_session_count == live_limit)
        .then(|| {
            connection.query_row(
                "SELECT id, generation, token_hash FROM _auth_sessions
                 WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
                 ORDER BY created_at_ms, id LIMIT 1",
                params![user_id, now_ms as i64],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
        })
        .transpose()?
        .map(
            |(session_id, generation, digest)| -> SnapbackResult<EvictionCandidateFact> {
                Ok(EvictionCandidateFact {
                    session_id,
                    generation: u64::try_from(generation)
                        .ok()
                        .filter(|generation| {
                            *generation != 0
                                && *generation < crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
                        })
                        .ok_or_else(internal_state_snapback)?,
                    token_digest: TokenDigest::from_bytes(
                        digest
                            .as_slice()
                            .try_into()
                            .map_err(|_| internal_state_snapback())?,
                    ),
                })
            },
        )
        .transpose()?;
    Ok(SessionIssuanceFacts {
        existing_identity,
        live_session_count,
        oldest_live_session,
    })
}

pub(crate) fn session_cap_facts(
    connection: &Connection,
    user_id: &str,
    now_ms: u64,
    live_limit: u64,
) -> SnapbackResult<SessionCapFacts> {
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, now_ms as i64],
        |row| row.get(0),
    )?;
    let live_session_count = u64::try_from(count).map_err(|_| internal_state_snapback())?;
    let oldest_live_session = (live_session_count == live_limit)
        .then(|| {
            connection.query_row(
                "SELECT id, generation, token_hash FROM _auth_sessions
                 WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
                 ORDER BY created_at_ms, id LIMIT 1",
                params![user_id, now_ms as i64],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                },
            )
        })
        .transpose()?
        .map(
            |(session_id, generation, digest)| -> SnapbackResult<EvictionCandidateFact> {
                Ok(EvictionCandidateFact {
                    session_id,
                    generation: u64::try_from(generation)
                        .ok()
                        .filter(|generation| {
                            *generation != 0
                                && *generation < crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
                        })
                        .ok_or_else(internal_state_snapback)?,
                    token_digest: TokenDigest::from_bytes(
                        digest
                            .as_slice()
                            .try_into()
                            .map_err(|_| internal_state_snapback())?,
                    ),
                })
            },
        )
        .transpose()?;
    Ok(SessionCapFacts {
        live_session_count,
        oldest_live_session,
    })
}

pub(crate) fn user_session_revocation_facts(
    connection: &Connection,
    user_id: &str,
    excluded_session_id: Option<&str>,
    identity_id: Option<&str>,
    now_ms: u64,
) -> SnapbackResult<Vec<SessionRevocationCandidateFact>> {
    let mut statement = connection.prepare(
        "SELECT id,generation,token_hash
         FROM _auth_sessions
         WHERE user_id=?1
           AND (?2 IS NULL OR id<>?2)
           AND (?3 IS NULL OR identity_id=?3)
           AND revoked_at_ms IS NULL
           AND ?4 < expires_at_ms
         ORDER BY id",
    )?;
    let rows = statement.query_map(
        params![user_id, excluded_session_id, identity_id, now_ms as i64],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        },
    )?;
    let mut facts = Vec::new();
    for row in rows {
        let (session_id, generation, token_hash) = row?;
        facts.push(SessionRevocationCandidateFact {
            session_id,
            generation: u64::try_from(generation)
                .ok()
                .filter(|generation| {
                    *generation != 0 && *generation < crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP
                })
                .ok_or_else(internal_state_snapback)?,
            token_digest: TokenDigest::from_bytes(
                token_hash
                    .as_slice()
                    .try_into()
                    .map_err(|_| internal_state_snapback())?,
            ),
        });
    }
    Ok(facts)
}

/// Commit the expiry chosen by sync policy against the exact durable row.
pub(crate) fn extend_authenticated_use_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    expected_generation: u64,
    now_ms: u64,
    expires_at_ms: u64,
    coalesce_ms: u64,
) -> SnapbackResult<bool> {
    transaction
        .execute(
            "UPDATE _auth_sessions
             SET last_used_at_ms = ?1, expires_at_ms = ?2
             WHERE id = ?3 AND generation = ?4 AND revoked_at_ms IS NULL
               AND ?1 < expires_at_ms AND ?1 < absolute_expires_at_ms
               AND ?1 - last_used_at_ms >= ?5",
            params![
                now_ms as i64,
                expires_at_ms as i64,
                session_id,
                expected_generation as i64,
                coalesce_ms as i64,
            ],
        )
        .map(|changed| changed == 1)
        .map_err(Into::into)
}

fn planned_revocation_set_is_exact_predecessor(
    connection: &Connection,
    revocations: &[CatalogRevocationPlan<'_>],
    now_ms: u64,
) -> SnapbackResult<bool> {
    for revocation in revocations {
        if !matches!(
            reconcile_planned_revocation(connection, revocation, now_ms)?,
            DurableRevocationReconcile::ExactPredecessor
        ) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn commit_planned_revocation_set(
    transaction: &Transaction<'_>,
    revocations: &[CatalogRevocationPlan<'_>],
    now_ms: u64,
) -> SnapbackResult<Vec<SessionRevocation>> {
    let mut committed = Vec::with_capacity(revocations.len());
    for revocation in revocations {
        let generation = catalog_committed_generation(revocation)?;
        let changed = transaction.execute(
            "UPDATE _auth_sessions
             SET revoked_at_ms=?1,generation=?2
             WHERE id=?3 AND generation=?4 AND token_hash=?5
               AND revoked_at_ms IS NULL AND ?1<expires_at_ms",
            params![
                now_ms as i64,
                generation as i64,
                revocation.session_id,
                revocation.expected_generation as i64,
                revocation.presented_digest.as_bytes().as_slice(),
            ],
        )?;
        if changed != 1 {
            return Err(internal_state_snapback());
        }
        crate::storage::auth::write_session_terminal_cause_in(
            transaction,
            revocation.session_id,
            generation,
            now_ms,
            revocation.reason,
        )?;
        committed.push(SessionRevocation {
            session_id: revocation.session_id.to_owned(),
            generation,
        });
    }
    Ok(committed)
}

pub(crate) fn planned_password_change_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogPasswordChangePlan<'_>,
) -> SnapbackResult<CatalogPasswordChangeCommit> {
    let admission = match plan.mutation {
        crate::storage::auth_identity::CredentialRotationMutation::PasswordChange(mutation) => {
            crate::storage::auth_identity::admit_password_change_in(
                transaction,
                mutation,
                plan.rotation.superseded_at_ms,
                plan.password_profile,
            )?
        }
        crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(mutation) => {
            crate::storage::auth_identity::admit_password_issuance_in(
                transaction,
                mutation,
                plan.rotation.superseded_at_ms,
                plan.password_profile,
            )?
        }
    };
    match admission {
        crate::storage::auth_identity::PasswordIssuanceAdmission::Proceed { .. } => {}
        crate::storage::auth_identity::PasswordIssuanceAdmission::Invalid { committed_attempt } => {
            return Ok(CatalogPasswordChangeCommit::CredentialInvalid { committed_attempt });
        }
        crate::storage::auth_identity::PasswordIssuanceAdmission::LedgerCapacityExhausted => {
            return Ok(CatalogPasswordChangeCommit::CredentialThrottled);
        }
        crate::storage::auth_identity::PasswordIssuanceAdmission::GuestClaimCollision => {
            return Ok(CatalogPasswordChangeCommit::GuestClaimCollision);
        }
        crate::storage::auth_identity::PasswordIssuanceAdmission::GuestAlreadyClaimed => {
            return Ok(CatalogPasswordChangeCommit::GuestAlreadyClaimed);
        }
        crate::storage::auth_identity::PasswordIssuanceAdmission::PredecessorChanged => {
            return Ok(CatalogPasswordChangeCommit::PredecessorChanged);
        }
    }
    if !planned_revocation_set_is_exact_predecessor(
        transaction,
        &plan.revocations,
        plan.rotation.superseded_at_ms,
    )? {
        return Ok(CatalogPasswordChangeCommit::PredecessorChanged);
    }
    if let crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(mutation) =
        plan.mutation
    {
        let Some(terms) = plan.successful_effect_budget else {
            return Err(crate::diagnostic::SnapbackError::error(
                "SNAPBACK_AUTH_BUDGET_POLICY_INVALID",
                "auth",
                "authentication budget policy is invalid",
            ));
        };
        if let Some((budget_name, retry_after_ms)) =
            crate::auth::throttle::admit_local_successful_auth_effects_in(
                transaction,
                plan.rotation.superseded_at_ms,
                terms,
                &[
                    crate::auth::throttle::AuthBudgetName::AccountCreate,
                    crate::auth::throttle::AuthBudgetName::SessionMint,
                ],
                &mutation.identity_id,
            )?
        {
            return Ok(CatalogPasswordChangeCommit::GuestBudgetRefused {
                budget_name: budget_name.as_str(),
                retry_after_ms,
            });
        }
    }
    let session = match planned_rotation_transaction(transaction, &plan.rotation)? {
        PlannedRotationTransaction::Refreshed(session) => session,
        PlannedRotationTransaction::CandidateCollision => {
            return Ok(CatalogPasswordChangeCommit::CandidateCollision);
        }
        PlannedRotationTransaction::PredecessorChanged => {
            return Ok(CatalogPasswordChangeCommit::PredecessorChanged);
        }
    };
    let session = match plan.mutation {
        crate::storage::auth_identity::CredentialRotationMutation::PasswordChange(mutation) => {
            crate::storage::auth_identity::apply_password_change_in(
                transaction,
                mutation,
                plan.rotation.superseded_at_ms,
            )?;
            session
        }
        crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(mutation) => {
            crate::storage::auth_identity::apply_password_issuance_in(
                transaction,
                mutation,
                plan.rotation.superseded_at_ms,
            )?;
            crate::storage::auth_identity::finish_guest_claim_rotation_in(
                transaction,
                mutation,
                plan.rotation.session_id,
                plan.rotation.superseded_at_ms,
            )?;
            super::auth_stream::advance_authorization_epoch_in(transaction)?;
            let token_hash = TokenHash::from_bytes(*plan.rotation.successor_digest.as_bytes());
            let refreshed = lookup_current_session(transaction, &token_hash)?
                .ok_or_else(internal_state_snapback)?;
            session_response_fact(&refreshed)
        }
    };
    let committed_revocations = commit_planned_revocation_set(
        transaction,
        &plan.revocations,
        plan.rotation.superseded_at_ms,
    )?;
    Ok(CatalogPasswordChangeCommit::Committed {
        session,
        committed_revocations,
    })
}

pub(crate) fn reconcile_password_change(
    connection: &Connection,
    plan: &CatalogPasswordChangePlan<'_>,
) -> SnapbackResult<CatalogPasswordChangeReconcile> {
    let rotation = reconcile_planned_rotation(connection, &plan.rotation)?;
    let (mutation_successor, mutation_predecessor) = match plan.mutation {
        crate::storage::auth_identity::CredentialRotationMutation::PasswordChange(mutation) => (
            crate::storage::auth_identity::password_change_is_exact_successor_on(
                connection,
                mutation,
                plan.rotation.superseded_at_ms,
            )?,
            crate::storage::auth_identity::password_change_is_exact_predecessor_on(
                connection, mutation,
            )?,
        ),
        crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(mutation) => (
            crate::storage::auth_identity::password_issuance_is_exact_successor_on(
                connection,
                mutation,
                plan.rotation.superseded_at_ms,
            )?,
            crate::storage::auth_identity::password_issuance_is_exact_predecessor_on(
                connection, mutation,
            )?,
        ),
    };
    let mut revocation_successors = Vec::with_capacity(plan.revocations.len());
    let mut all_revocation_successors = true;
    let mut all_revocation_predecessors = true;
    for revocation in &plan.revocations {
        match reconcile_planned_revocation(connection, revocation, plan.rotation.superseded_at_ms)?
        {
            DurableRevocationReconcile::ExactSuccessor(committed) => {
                revocation_successors.push(committed);
                all_revocation_predecessors = false;
            }
            DurableRevocationReconcile::ExactPredecessor => {
                all_revocation_successors = false;
            }
            DurableRevocationReconcile::DifferentValid => {
                all_revocation_successors = false;
                all_revocation_predecessors = false;
            }
        }
    }
    match rotation {
        DurableRotationReconcile::ExactSuccessor(session)
            if mutation_successor && all_revocation_successors =>
        {
            Ok(CatalogPasswordChangeReconcile::ExactSuccessor {
                session,
                committed_revocations: revocation_successors,
            })
        }
        DurableRotationReconcile::ExactPredecessor
            if mutation_predecessor && all_revocation_predecessors =>
        {
            Ok(CatalogPasswordChangeReconcile::ExactPredecessor)
        }
        _ => Ok(CatalogPasswordChangeReconcile::DifferentValid),
    }
}

pub(crate) fn planned_session_issuance_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogSessionIssuancePlan,
    exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
) -> SnapbackResult<CatalogIssuanceCommit> {
    if let Some(idempotency) = plan.guest_idempotency {
        if !matches!(plan.identity, PlannedIdentityState::GuestCreate { .. }) {
            return Err(internal_state_snapback());
        }
        ensure_guest_idempotency_table(transaction)?;
        let durable: Option<(
            Vec<u8>,
            String,
            i64,
            i64,
            String,
            Option<String>,
            Option<i64>,
            Option<String>,
        )> =
            transaction
                .query_row(
                    &format!(
                        "SELECT request_digest,key_id,created_at_ms,retain_until_ms,state,budget_name,retry_after_ms,refusal_correlation_id
                           FROM {GUEST_IDEMPOTENCY_TABLE} WHERE key_digest=?1"
                    ),
                    params![idempotency.key_digest.as_slice()],
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
        match durable {
            Some((request_digest, _, _, _, _, _, _, _))
                if request_digest.as_slice() != idempotency.request_digest.as_slice() =>
            {
                return Ok(CatalogIssuanceCommit::GuestIdempotencyConflict);
            }
            Some((
                _,
                key_id,
                created_at_ms,
                retain_until_ms,
                state,
                budget_name,
                retry_after_ms,
                refusal_correlation_id,
            )) => {
                if key_id != idempotency.key_id
                    || u64::try_from(created_at_ms).ok() != Some(idempotency.created_at_ms)
                    || u64::try_from(retain_until_ms).ok() != Some(idempotency.retain_until_ms)
                {
                    return Err(internal_state_snapback());
                }
                if state == "refused" {
                    let budget_name = budget_name
                        .as_deref()
                        .and_then(AuthBudgetName::parse)
                        .ok_or_else(internal_state_snapback)?;
                    return Ok(CatalogIssuanceCommit::GuestBudgetRefused {
                        budget_name: budget_name.as_str(),
                        retry_after_ms: u64::try_from(
                            retry_after_ms.ok_or_else(internal_state_snapback)?,
                        )
                        .map_err(|_| internal_state_snapback())?,
                        correlation_id: refusal_correlation_id
                            .ok_or_else(internal_state_snapback)?,
                    });
                }
                if state == "committed" {
                    let token_hash = TokenHash::from_bytes(*plan.projected.token_digest.as_bytes());
                    let session = lookup_current_session(transaction, &token_hash)?
                        .ok_or_else(internal_state_snapback)?;
                    if session.session.session_id != plan.projected.session_id
                        || session.session.user_id != plan.projected.user_id
                    {
                        return Err(internal_state_snapback());
                    }
                    return Ok(CatalogIssuanceCommit::Committed {
                        session: session_response_fact(&session),
                        committed_revocations: Vec::new(),
                    });
                }
                if state != "pending" {
                    return Err(internal_state_snapback());
                }
            }
            None => {
                transaction.execute(
                    &format!(
                        "INSERT INTO {GUEST_IDEMPOTENCY_TABLE}(
                           key_digest,request_digest,key_id,created_at_ms,retain_until_ms,state,
                           refusal_correlation_id
                         ) VALUES(?1,?2,?3,?4,?5,'pending',?6)"
                    ),
                    params![
                        idempotency.key_digest.as_slice(),
                        idempotency.request_digest.as_slice(),
                        idempotency.key_id,
                        idempotency.created_at_ms as i64,
                        idempotency.retain_until_ms as i64,
                        idempotency.refusal_correlation_id,
                    ],
                )?;
            }
        }
    }
    let mut prepared_rehearsal = None;
    if let Some(challenge) = &plan.challenge {
        let Some((key, submitted_code)) = exchange_proof else {
            return Err(internal_state_snapback());
        };
        let durable = transaction
            .query_row(
                "SELECT canonical_address, code_digest, key_id, attempts,
                        max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                        superseded_by IS NOT NULL
                 FROM _auth_verification_codes WHERE challenge_id = ?1",
                params![challenge.challenge_id],
                |row| {
                    Ok(ChallengeTransactionRow {
                        address: row.get(0)?,
                        code_digest: Zeroizing::new(row.get(1)?),
                        key_id: row.get(2)?,
                        attempts: row.get(3)?,
                        max_attempts: row.get(4)?,
                        expires_at_ms: row.get(5)?,
                        consumed: row.get(6)?,
                        superseded: row.get(7)?,
                    })
                },
            )
            .optional()?;
        let Some(durable) = durable else {
            return Ok(CatalogIssuanceCommit::PredecessorChanged);
        };
        if durable.address != plan.address.as_str()
            || durable.code_digest.as_slice() != challenge.code_digest
            || durable.key_id != challenge.key_id
            || u32::try_from(durable.attempts).ok() != Some(challenge.expected_attempts)
            || u32::try_from(durable.max_attempts).ok() != Some(challenge.max_attempts)
            || u64::try_from(durable.expires_at_ms).ok() != Some(challenge.expires_at_ms)
            || durable.consumed
            || durable.superseded
            || plan.now_ms >= challenge.expires_at_ms
            || challenge.expected_attempts >= challenge.max_attempts
        {
            return Ok(CatalogIssuanceCommit::PredecessorChanged);
        }
        let challenge_id =
            ChallengeId::parse(&challenge.challenge_id).map_err(|_| internal_state_snapback())?;
        if let Some(exercise) = &plan.rehearsal_exercise {
            match crate::storage::auth_rehearsal::prepare_rehearsal_atomic_effect_in(
                transaction,
                exercise,
            )? {
                crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Admitted(
                    prepared,
                ) => prepared_rehearsal = Some(prepared),
                crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Replay(value) => {
                    return Ok(CatalogIssuanceCommit::RehearsalReplay(value));
                }
                crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Denied(error) => {
                    return Ok(CatalogIssuanceCommit::RehearsalDenied(error));
                }
            }
        }
        let submitted = CodeDigest::compute(key, &challenge_id, &plan.address, submitted_code);
        if !submitted.verify(challenge.code_digest) {
            let next_attempts = challenge
                .expected_attempts
                .checked_add(1)
                .ok_or_else(internal_state_snapback)?;
            let changed = transaction.execute(
                "UPDATE _auth_verification_codes
                 SET attempts = ?1
                 WHERE challenge_id = ?2 AND attempts = ?3
                   AND code_digest = ?4 AND key_id = ?5
                   AND expires_at_ms = ?6
                   AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                params![
                    next_attempts as i64,
                    challenge.challenge_id,
                    challenge.expected_attempts as i64,
                    challenge.code_digest.as_slice(),
                    challenge.key_id,
                    challenge.expires_at_ms as i64,
                ],
            )?;
            if changed != 1 {
                return Err(internal_state_snapback());
            }
            if let Some(sender_issuance) = &plan.sender_issuance {
                sender_issuance
                    .consume_rejected_outcome(transaction)
                    .map_err(|_| internal_state_snapback())?;
            }
            if let (Some(exercise), Some(prepared)) =
                (&plan.rehearsal_exercise, prepared_rehearsal.take())
            {
                let denial = if next_attempts == challenge.max_attempts {
                    crate::auth::throttle::code_locked()
                } else {
                    crate::auth::throttle::code_invalid()
                };
                crate::storage::auth_rehearsal::finish_rehearsal_atomic_effect_denial_in(
                    transaction,
                    exercise,
                    prepared,
                    denial,
                )?;
            }
            return Ok(if next_attempts == challenge.max_attempts {
                CatalogIssuanceCommit::CodeLocked
            } else {
                CatalogIssuanceCommit::CodeInvalid
            });
        }
    } else if exchange_proof.is_some() {
        return Err(internal_state_snapback());
    }
    if prepared_rehearsal.is_none()
        && let Some(exercise) = &plan.rehearsal_exercise
    {
        match crate::storage::auth_rehearsal::prepare_rehearsal_atomic_effect_in(
            transaction,
            exercise,
        )? {
            crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Admitted(prepared) => {
                prepared_rehearsal = Some(prepared)
            }
            crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Replay(value) => {
                return Ok(CatalogIssuanceCommit::RehearsalReplay(value));
            }
            crate::storage::auth_rehearsal::RehearsalAtomicEffectAdmission::Denied(error) => {
                return Ok(CatalogIssuanceCommit::RehearsalDenied(error));
            }
        }
    }
    if let Some(sender_issuance) = &plan.sender_issuance
        && sender_issuance
            .thumbprint_has_live_family(transaction)
            .map_err(|_| internal_state_snapback())?
    {
        // The code was correct, so no attempt is charged and the challenge
        // stays live for a retry under a fresh key; the valid proof still
        // consumes its `jti` (the LLP 0077 issuance-outcome rule). This check
        // and `install`'s nonce insert run under the same immediate write
        // transaction, so a concurrent same-key exchange serializes here
        // rather than surfacing the nonce-table constraint as a 500.
        sender_issuance
            .consume_rejected_outcome(transaction)
            .map_err(|_| internal_state_snapback())?;
        return Ok(CatalogIssuanceCommit::SenderKeyBound);
    }
    let (identity_id, user_id, create_identity, guest_expires_at_ms) =
        if let PlannedIdentityState::GuestCreate {
            user_id,
            expires_at_ms,
        } = plan.identity
        {
            if plan.password.is_some()
                || plan.challenge.is_some()
                || plan.sender_issuance.is_some()
                || plan.guest_effect_budget.is_none()
            {
                return Err(internal_state_snapback());
            }
            let collision: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_users WHERE id=?1)",
                [user_id],
                |row| row.get(0),
            )?;
            if collision {
                return Ok(CatalogIssuanceCommit::CandidateCollision);
            }
            (
                plan.projected.session_id.to_owned(),
                user_id.to_owned(),
                false,
                Some(*expires_at_ms),
            )
        } else if let Some(password) = plan.password {
            let Some(profile) = plan.password_profile else {
                return Err(internal_state_snapback());
            };
            match crate::storage::auth_identity::admit_password_issuance_in(
            transaction,
            password,
            plan.now_ms,
            profile,
        )? {
            crate::storage::auth_identity::PasswordIssuanceAdmission::Proceed {
                create_principal,
            } => (
                password.identity_id.clone(),
                password.user_id.clone(),
                create_principal,
                None,
            ),
            crate::storage::auth_identity::PasswordIssuanceAdmission::Invalid {
                committed_attempt,
            } => {
                return Ok(CatalogIssuanceCommit::CredentialInvalid { committed_attempt });
            }
            crate::storage::auth_identity::PasswordIssuanceAdmission::LedgerCapacityExhausted => {
                return Ok(CatalogIssuanceCommit::CredentialThrottled);
            }
            crate::storage::auth_identity::PasswordIssuanceAdmission::PredecessorChanged => {
                return Ok(CatalogIssuanceCommit::PredecessorChanged);
            }
            crate::storage::auth_identity::PasswordIssuanceAdmission::GuestClaimCollision
            | crate::storage::auth_identity::PasswordIssuanceAdmission::GuestAlreadyClaimed => {
                return Ok(CatalogIssuanceCommit::PredecessorChanged);
            }
        }
        } else {
            let durable_identity: Option<(String, String)> = transaction
                .query_row(
                    "SELECT id, user_id FROM _auth_identities
                 WHERE provider = 'email-code' AND subject = ?1",
                    params![plan.address.as_str()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            match (&plan.identity, durable_identity) {
                (
                    PlannedIdentityState::Existing {
                        identity_id,
                        user_id,
                    },
                    Some((durable_identity_id, durable_user_id)),
                ) if identity_id == &durable_identity_id && user_id == &durable_user_id => {
                    (identity_id.clone(), user_id.clone(), false, None)
                }
                (
                    PlannedIdentityState::Create {
                        identity_id,
                        user_id,
                    },
                    None,
                ) => (identity_id.clone(), user_id.clone(), true, None),
                _ => return Ok(CatalogIssuanceCommit::PredecessorChanged),
            }
        };
    let derived_identity: bool = guest_expires_at_ms.is_none() && transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM _snapback_auth_rehearsal_identities WHERE identity_id = ?1)",
        params![identity_id],
        |row| row.get(0),
    ).unwrap_or(false);
    if derived_identity && plan.projected.rehearsal_provenance.is_none() {
        // @ref LLP 0213#derived-identities — retained rehearsal identities are
        //   inert on ordinary mint paths; only a newly authorized rehearsal
        //   effect may use one under a new governor.
        return Ok(CatalogIssuanceCommit::PredecessorChanged);
    }
    if plan.projected.user_id != user_id || plan.projected.generation != 1 {
        return Err(internal_state_snapback());
    }
    let token_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM _auth_sessions WHERE token_hash = ?1)
                OR EXISTS(SELECT 1 FROM _auth_session_tokens WHERE token_hash = ?1)",
        params![plan.projected.token_digest.as_bytes().as_slice()],
        |row| row.get(0),
    )?;
    if token_exists {
        // This branch precedes identity creation, cap eviction, challenge
        // consumption, and session insertion. The caller can therefore
        // discard this plaintext candidate and retry without changing any
        // durable predecessor fact.
        return Ok(CatalogIssuanceCommit::CandidateCollision);
    }
    let live_count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, plan.now_ms as i64],
        |row| row.get(0),
    )?;
    if !planned_revocation_set_is_exact_predecessor(transaction, &plan.revocations, plan.now_ms)? {
        return Ok(CatalogIssuanceCommit::PredecessorChanged);
    }
    let mut projected_user_revocations = 0_i64;
    for (index, revocation) in plan.revocations.iter().enumerate() {
        if plan.revocations[..index]
            .iter()
            .any(|earlier| earlier.session_id == revocation.session_id)
        {
            return Err(internal_state_snapback());
        }
        let revoked_user: String = transaction.query_row(
            "SELECT user_id FROM _auth_sessions WHERE id=?1",
            [revocation.session_id],
            |row| row.get(0),
        )?;
        if revoked_user == user_id {
            projected_user_revocations += 1;
        }
    }
    if let Some(eviction) = plan.eviction() {
        if live_count != plan.live_session_limit as i64 {
            return Ok(CatalogIssuanceCommit::PredecessorChanged);
        }
        let oldest: Option<(String, i64, Vec<u8>)> = transaction
            .query_row(
                "SELECT id, generation, token_hash FROM _auth_sessions
                 WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
                 ORDER BY created_at_ms, id LIMIT 1",
                params![user_id, plan.now_ms as i64],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((session_id, generation, token_hash)) = oldest else {
            return Ok(CatalogIssuanceCommit::PredecessorChanged);
        };
        if session_id != eviction.session_id
            || u64::try_from(generation).ok() != Some(eviction.expected_generation)
            || token_hash.as_slice() != eviction.presented_digest.as_bytes().as_slice()
        {
            return Ok(CatalogIssuanceCommit::PredecessorChanged);
        }
    } else if live_count.saturating_sub(projected_user_revocations)
        >= plan.live_session_limit as i64
    {
        return Ok(CatalogIssuanceCommit::PredecessorChanged);
    }

    if let Some(guest_expires_at_ms) = guest_expires_at_ms {
        let Some(budget) = plan.guest_effect_budget else {
            return Err(internal_state_snapback());
        };
        if let Some((budget_name, retry_after_ms)) =
            crate::auth::throttle::admit_local_successful_auth_effects_in(
                transaction,
                plan.now_ms,
                budget,
                &[
                    crate::auth::throttle::AuthBudgetName::GuestCreate,
                    crate::auth::throttle::AuthBudgetName::SessionMint,
                ],
                plan.projected.session_id,
            )?
        {
            if let Some(idempotency) = plan.guest_idempotency {
                transaction.execute(
                    &format!(
                        "UPDATE {GUEST_IDEMPOTENCY_TABLE}
                            SET state='refused',budget_name=?1,retry_after_ms=?2,
                                refusal_correlation_id=?3
                          WHERE key_digest=?4 AND request_digest=?5 AND state='pending'"
                    ),
                    params![
                        budget_name.as_str(),
                        retry_after_ms as i64,
                        idempotency.refusal_correlation_id,
                        idempotency.key_digest.as_slice(),
                        idempotency.request_digest.as_slice(),
                    ],
                )?;
            }
            return Ok(CatalogIssuanceCommit::GuestBudgetRefused {
                budget_name: budget_name.as_str(),
                retry_after_ms,
                correlation_id: plan
                    .guest_idempotency
                    .ok_or_else(internal_state_snapback)?
                    .refusal_correlation_id
                    .clone(),
            });
        }
        execute_candidate(
            transaction,
            "INSERT INTO _auth_users(id,created_at_ms,kind,guest_state,guest_expires_at_ms)
             VALUES(?1,?2,'human','active',?3)",
            params![user_id, plan.now_ms as i64, guest_expires_at_ms as i64],
        )?;
    } else if let Some(password) = plan.password {
        crate::storage::auth_identity::apply_password_issuance_in(
            transaction,
            password,
            plan.now_ms,
        )?;
    } else if create_identity {
        execute_candidate(
            transaction,
            "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
            params![user_id, plan.now_ms as i64],
        )?;
        insert_email_code_identity(
            transaction,
            &identity_id,
            &user_id,
            plan.address.as_str(),
            plan.now_ms,
        )?;
    }

    let committed_revocations =
        commit_planned_revocation_set(transaction, &plan.revocations, plan.now_ms)?;

    if guest_expires_at_ms.is_some() {
        insert_guest_session(transaction, plan)?;
        transaction.execute(
            "INSERT INTO _auth_assurances(
               id,user_id,session_id,identity_id,credential_id,kind,provenance,
               issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms
             ) VALUES(?1,?2,?3,NULL,NULL,'authenticated','session',?4,?5,NULL,NULL)",
            params![
                uuid::Uuid::now_v7().to_string(),
                user_id,
                plan.projected.session_id,
                plan.now_ms as i64,
                guest_expires_at_ms.map(|value| value as i64),
            ],
        )?;
        transaction.execute(
            "INSERT INTO _auth_security_events(
               id,user_id,kind,cause_class,session_id,occurred_at_ms,
               correlation_id,redacted_metadata
             ) VALUES(?1,?2,'guest.created','public-transition',?3,?4,?5,?6)",
            params![
                uuid::Uuid::now_v7().to_string(),
                user_id,
                plan.projected.session_id,
                plan.now_ms as i64,
                uuid::Uuid::now_v7().to_string(),
                crate::storage::auth_identity::DEFAULT_GUEST_TOMBSTONE_EVENT_METADATA,
            ],
        )?;
    } else {
        insert_identity_session(
            transaction,
            &plan.projected.session_id,
            &user_id,
            &identity_id,
            &plan.projected.authority_instance_id,
            plan.projected.token_digest.as_bytes(),
            plan.now_ms,
            plan.projected.expires_at_ms,
            plan.projected.absolute_expires_at_ms,
        )?;
    }
    if let Some(password) = plan.password {
        crate::storage::auth_identity::finish_password_session_in(
            transaction,
            password,
            plan.projected.session_id,
            plan.now_ms,
        )?;
    }
    if let Some(provenance) = &plan.projected.rehearsal_provenance {
        let governing_not_after_ms = plan
            .projected
            .expires_at_ms
            .min(plan.projected.absolute_expires_at_ms);
        crate::storage::auth_rehearsal::insert_rehearsal_session_provenance_in(
            transaction,
            &plan.projected.session_id,
            provenance,
            governing_not_after_ms,
            plan.now_ms,
        )?;
        if create_identity {
            crate::storage::auth_rehearsal::insert_rehearsal_identity_provenance_for_provider_in(
                transaction,
                &identity_id,
                provenance,
                governing_not_after_ms,
                plan.now_ms,
            )?;
        }
    }
    if let Some(sender_issuance) = &plan.sender_issuance {
        // @ref LLP 0077#issuance-refresh-and-recovery — family key binding,
        // issuance-proof consumption, and the initial nonce are one atomic cut
        // with session creation. There is no post-hoc bearer upgrade.
        sender_issuance
            .install(transaction, &plan.projected.session_id)
            .map_err(|_| internal_state_snapback())?;
    }
    if let Some(challenge) = &plan.challenge {
        let next_attempts = challenge
            .expected_attempts
            .checked_add(1)
            .ok_or_else(internal_state_snapback)?;
        let changed = transaction.execute(
            "UPDATE _auth_verification_codes
             SET attempts = ?1, consumed_at_ms = ?2
             WHERE challenge_id = ?3 AND attempts = ?4
               AND code_digest = ?5 AND key_id = ?6
               AND expires_at_ms = ?7
               AND consumed_at_ms IS NULL AND superseded_by IS NULL",
            params![
                next_attempts as i64,
                plan.now_ms as i64,
                challenge.challenge_id,
                challenge.expected_attempts as i64,
                challenge.code_digest.as_slice(),
                challenge.key_id,
                challenge.expires_at_ms as i64,
            ],
        )?;
        if changed != 1 {
            return Err(internal_state_snapback());
        }
    }
    if let (Some(exercise), Some(prepared)) = (&plan.rehearsal_exercise, prepared_rehearsal) {
        crate::storage::auth_rehearsal::finish_rehearsal_atomic_effect_success_in(
            transaction,
            exercise,
            prepared,
            exercise.outcome.clone(),
        )?;
    }
    if let Some(idempotency) = plan.guest_idempotency
        && transaction.execute(
            &format!(
                "UPDATE {GUEST_IDEMPOTENCY_TABLE}
                    SET state='committed'
                  WHERE key_digest=?1 AND request_digest=?2 AND state='pending'"
            ),
            params![
                idempotency.key_digest.as_slice(),
                idempotency.request_digest.as_slice(),
            ],
        )? != 1
    {
        return Err(internal_state_snapback());
    }
    Ok(CatalogIssuanceCommit::Committed {
        session: AuthSessionResponseFact {
            id: plan.projected.session_id.to_owned(),
            user_id,
            provider: plan.projected.provider.to_owned(),
            created_at: plan.projected.created_at_ms,
            expires_at: plan.projected.expires_at_ms,
            absolute_expires_at: plan.projected.absolute_expires_at_ms,
            authority_instance_id: plan.projected.authority_instance_id.to_owned(),
            generation: plan.projected.generation,
        },
        committed_revocations,
    })
}

struct DurableChallengeSnapshot {
    address: String,
    code_digest: Vec<u8>,
    key_id: String,
    attempts: u32,
    max_attempts: u32,
    expires_at_ms: u64,
    consumed_at_ms: Option<u64>,
    superseded: bool,
}

fn lookup_planned_challenge(
    connection: &Connection,
    challenge: &CatalogChallengeConsumption,
) -> SnapbackResult<Option<DurableChallengeSnapshot>> {
    connection
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms, superseded_by IS NOT NULL
             FROM _auth_verification_codes WHERE challenge_id = ?1",
            params![challenge.challenge_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            },
        )
        .optional()?
        .map(
            |(
                address,
                code_digest,
                key_id,
                attempts,
                max_attempts,
                expires,
                consumed,
                superseded,
            )| {
                Ok(DurableChallengeSnapshot {
                    address,
                    code_digest,
                    key_id,
                    attempts: u32::try_from(attempts).map_err(|_| internal_state_snapback())?,
                    max_attempts: u32::try_from(max_attempts)
                        .map_err(|_| internal_state_snapback())?,
                    expires_at_ms: checked_stored_time(expires)?,
                    consumed_at_ms: consumed.map(checked_stored_time).transpose()?,
                    superseded,
                })
            },
        )
        .transpose()
}

fn challenge_base_matches(
    durable: &DurableChallengeSnapshot,
    plan: &CatalogSessionIssuancePlan,
    challenge: &CatalogChallengeConsumption,
) -> bool {
    durable.address == plan.address.as_str()
        && durable.code_digest.as_slice() == challenge.code_digest
        && durable.key_id == challenge.key_id
        && durable.max_attempts == challenge.max_attempts
        && durable.expires_at_ms == challenge.expires_at_ms
        && !durable.superseded
}

fn challenge_is_exact_predecessor(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<bool> {
    let Some(challenge) = &plan.challenge else {
        return Ok(true);
    };
    let Some(durable) = lookup_planned_challenge(connection, challenge)? else {
        return Ok(false);
    };
    Ok(challenge_base_matches(&durable, plan, challenge)
        && durable.attempts == challenge.expected_attempts
        && durable.consumed_at_ms.is_none())
}

fn challenge_is_exact_successor(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
    consumed: bool,
) -> SnapbackResult<bool> {
    let Some(challenge) = &plan.challenge else {
        return Ok(true);
    };
    let Some(durable) = lookup_planned_challenge(connection, challenge)? else {
        return Ok(false);
    };
    let next_attempts = challenge
        .expected_attempts
        .checked_add(1)
        .ok_or_else(internal_state_snapback)?;
    Ok(challenge_base_matches(&durable, plan, challenge)
        && durable.attempts == next_attempts
        && durable.consumed_at_ms == consumed.then_some(plan.now_ms))
}

fn issuance_identity_is_exact_predecessor(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<bool> {
    if let Some(password) = plan.password {
        return crate::storage::auth_identity::password_issuance_is_exact_predecessor_on(
            connection, password,
        );
    }
    let by_address: Option<(String, String)> = connection
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![plan.address.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(match &plan.identity {
        PlannedIdentityState::Existing {
            identity_id,
            user_id,
        } => by_address.as_ref() == Some(&(identity_id.clone(), user_id.clone())),
        PlannedIdentityState::Create {
            identity_id,
            user_id,
        } => {
            if by_address.is_some() {
                return Ok(false);
            }
            let collisions: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_users WHERE id = ?1)
                     OR EXISTS(SELECT 1 FROM _auth_identities WHERE id = ?2)",
                params![user_id, identity_id],
                |row| row.get(0),
            )?;
            !collisions
        }
        PlannedIdentityState::GuestCreate { user_id, .. } => {
            let collision: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_users WHERE id=?1)",
                [user_id],
                |row| row.get(0),
            )?;
            !collision
        }
    })
}

fn issuance_identity_is_exact_successor(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<bool> {
    if let PlannedIdentityState::GuestCreate {
        user_id,
        expires_at_ms,
    } = &plan.identity
    {
        let durable = connection
            .query_row(
                "SELECT created_at_ms,kind,guest_state,guest_expires_at_ms
                 FROM _auth_users WHERE id=?1",
                [user_id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()?;
        return Ok(durable.is_some_and(|(created, kind, state, expires)| {
            u64::try_from(created).ok() == Some(plan.now_ms)
                && kind == "human"
                && state == "active"
                && expires.and_then(|value| u64::try_from(value).ok()) == Some(*expires_at_ms)
        }));
    }
    if let Some(password) = plan.password {
        return crate::storage::auth_identity::password_issuance_is_exact_successor_on(
            connection,
            password,
            plan.now_ms,
        );
    }
    let durable: Option<(String, String, String, String, i64, i64)> = connection
        .query_row(
            "SELECT identity.id, identity.user_id, identity.provider,
                    identity.subject, identity.verified_at_ms, user.created_at_ms
             FROM _auth_identities AS identity
             JOIN _auth_users AS user ON user.id = identity.user_id
             WHERE identity.provider = 'email-code' AND identity.subject = ?1",
            params![plan.address.as_str()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()?;
    let Some((identity_id, user_id, provider, subject, verified_at, user_created_at)) = durable
    else {
        return Ok(false);
    };
    let _ = checked_stored_time(verified_at)?;
    let _ = checked_stored_time(user_created_at)?;
    let ids_match = match &plan.identity {
        PlannedIdentityState::Existing {
            identity_id: expected_identity,
            user_id: expected_user,
        } => identity_id == *expected_identity && user_id == *expected_user,
        PlannedIdentityState::Create {
            identity_id: expected_identity,
            user_id: expected_user,
        } => {
            identity_id == *expected_identity
                && user_id == *expected_user
                && u64::try_from(verified_at).ok() == Some(plan.now_ms)
                && u64::try_from(user_created_at).ok() == Some(plan.now_ms)
        }
        PlannedIdentityState::GuestCreate { .. } => return Ok(false),
    };
    Ok(ids_match && provider == "email-code" && subject == plan.address.as_str())
}

fn issuance_cap_is_exact_predecessor(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<bool> {
    let user_id = &plan.projected.user_id;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, plan.now_ms as i64],
        |row| row.get(0),
    )?;
    let mut projected_user_revocations = 0_i64;
    for revocation in &plan.revocations {
        if !matches!(
            reconcile_planned_revocation(connection, revocation, plan.now_ms)?,
            DurableRevocationReconcile::ExactPredecessor
        ) {
            return Ok(false);
        }
        let Some(snapshot) = lookup_session_snapshot(connection, revocation.session_id)? else {
            return Ok(false);
        };
        if snapshot.record.session.user_id == *user_id {
            projected_user_revocations += 1;
        }
    }
    Ok(match plan.eviction() {
        None => count.saturating_sub(projected_user_revocations) < plan.live_session_limit as i64,
        Some(eviction) if count == plan.live_session_limit as i64 => {
            let oldest: Option<(String, i64, Vec<u8>)> = connection
                .query_row(
                    "SELECT id, generation, token_hash FROM _auth_sessions
                     WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
                     ORDER BY created_at_ms, id LIMIT 1",
                    params![user_id, plan.now_ms as i64],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            oldest.is_some_and(|(session_id, generation, digest)| {
                session_id == eviction.session_id
                    && u64::try_from(generation).ok() == Some(eviction.expected_generation)
                    && digest.as_slice() == eviction.presented_digest.as_bytes().as_slice()
            })
        }
        Some(_) => false,
    })
}

fn issuance_revocations_are_exact_successors(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<Vec<SessionRevocation>> {
    let mut committed = Vec::with_capacity(plan.revocations.len());
    for revocation in &plan.revocations {
        let Some(snapshot) = lookup_session_snapshot(connection, revocation.session_id)? else {
            return Err(internal_state_snapback());
        };
        let generation = catalog_committed_generation(revocation)?;
        if snapshot.record.session.generation != generation
            || !snapshot.record.revoked
            || snapshot.revoked_at_ms != Some(plan.now_ms)
            || snapshot.current_digest != revocation.presented_digest
            || !crate::storage::auth::session_terminal_cause_matches_on(
                connection,
                revocation.session_id,
                generation,
                plan.now_ms,
                revocation.reason,
            )?
        {
            return Err(internal_state_snapback());
        }
        committed.push(SessionRevocation {
            session_id: revocation.session_id.to_owned(),
            generation,
        });
    }
    Ok(committed)
}

pub(crate) fn reconcile_rejected_issuance(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<DurableRejectedIssuanceReconcile> {
    if lookup_session_snapshot(connection, &plan.projected.session_id)?.is_some() {
        return Err(internal_state_snapback());
    }
    let sender_successor = match &plan.sender_issuance {
        Some(sender) => sender
            .is_rejected_successor(connection, &plan.projected.session_id)
            .map_err(|_| internal_state_snapback())?,
        None => true,
    };
    if challenge_is_exact_successor(connection, plan, false)? && sender_successor {
        return Ok(DurableRejectedIssuanceReconcile::ExactSuccessor);
    }
    let sender_predecessor = match &plan.sender_issuance {
        Some(sender) => sender
            .is_exact_predecessor(connection, &plan.projected.session_id)
            .map_err(|_| internal_state_snapback())?,
        None => true,
    };
    if challenge_is_exact_predecessor(connection, plan)? && sender_predecessor {
        return Ok(DurableRejectedIssuanceReconcile::ExactPredecessor);
    }
    Ok(DurableRejectedIssuanceReconcile::DifferentValid)
}

pub(crate) fn reconcile_planned_issuance(
    connection: &Connection,
    plan: &CatalogSessionIssuancePlan,
) -> SnapbackResult<CatalogIssuanceReconcile> {
    if let Some(snapshot) = lookup_session_snapshot(connection, &plan.projected.session_id)? {
        let expected_identity_id = match &plan.identity {
            PlannedIdentityState::Existing { identity_id, .. }
            | PlannedIdentityState::Create { identity_id, .. } => identity_id,
            PlannedIdentityState::GuestCreate { .. } => plan.projected.session_id,
        };
        let session = &snapshot.record.session;
        if session.session_id != plan.projected.session_id
            || session.user_id != plan.projected.user_id
            || session.identity_id != *expected_identity_id
            || session.provider != plan.projected.provider
            || session.generation != plan.projected.generation
            || session.authority_instance_id != plan.projected.authority_instance_id
            || session.created_at_ms != plan.projected.created_at_ms
            || snapshot.last_used_at_ms != plan.projected.created_at_ms
            || session.expires_at_ms != plan.projected.expires_at_ms
            || session.absolute_expires_at_ms != plan.projected.absolute_expires_at_ms
            || snapshot.record.revoked
            || snapshot.revoked_at_ms.is_some()
            || snapshot.current_digest != plan.projected.token_digest
            || !issuance_identity_is_exact_successor(connection, plan)?
            || !challenge_is_exact_successor(connection, plan, true)?
            || match &plan.sender_issuance {
                Some(sender) => !sender
                    .is_exact_successor(connection, &plan.projected.session_id)
                    .map_err(|_| internal_state_snapback())?,
                None => false,
            }
        {
            return Err(internal_state_snapback());
        }
        let committed_revocations = issuance_revocations_are_exact_successors(connection, plan)?;
        return Ok(CatalogIssuanceReconcile::ExactSuccessor {
            session: AuthSessionResponseFact {
                id: session.session_id.clone(),
                user_id: session.user_id.clone(),
                provider: session.provider.clone(),
                created_at: session.created_at_ms,
                expires_at: session.expires_at_ms,
                absolute_expires_at: session.absolute_expires_at_ms,
                authority_instance_id: session.authority_instance_id.clone(),
                generation: session.generation,
            },
            committed_revocations,
        });
    }

    let identity_predecessor = issuance_identity_is_exact_predecessor(connection, plan)?;
    let cap_predecessor = issuance_cap_is_exact_predecessor(connection, plan)?;
    let challenge_predecessor = challenge_is_exact_predecessor(connection, plan)?;
    let sender_predecessor = match &plan.sender_issuance {
        Some(sender) => sender
            .is_exact_predecessor(connection, &plan.projected.session_id)
            .map_err(|_| internal_state_snapback())?,
        None => true,
    };
    if identity_predecessor && cap_predecessor && challenge_predecessor && sender_predecessor {
        return Ok(CatalogIssuanceReconcile::ExactPredecessor);
    }
    if plan.eviction().is_some() && !cap_predecessor {
        // This carrier owns an existing authority leaf. It is unsafe to unmark
        // unless that leaf is still exactly the planned predecessor.
        return Err(internal_state_snapback());
    }
    Ok(CatalogIssuanceReconcile::DifferentValid)
}

struct ChallengeTransactionRow {
    address: String,
    code_digest: Zeroizing<Vec<u8>>,
    key_id: String,
    attempts: i64,
    max_attempts: i64,
    expires_at_ms: i64,
    consumed: bool,
    superseded: bool,
}
pub(crate) fn rejected_exchange_transaction(
    transaction: &Transaction<'_>,
    plan: &CatalogRejectedExchangePlan<'_>,
) -> SnapbackResult<RejectedExchangeOutcome> {
    let row = transaction
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                    superseded_by IS NOT NULL
             FROM _auth_verification_codes
             WHERE challenge_id = ?1",
            params![plan.challenge_id.as_str()],
            |row| {
                Ok(ChallengeTransactionRow {
                    address: row.get(0)?,
                    code_digest: Zeroizing::new(row.get(1)?),
                    key_id: row.get(2)?,
                    attempts: row.get(3)?,
                    max_attempts: row.get(4)?,
                    expires_at_ms: row.get(5)?,
                    consumed: row.get(6)?,
                    superseded: row.get(7)?,
                })
            },
        )
        .optional()?;
    let Some(row) = row else {
        perform_rejected_dummy_hmac(plan);
        if let Some(sender_issuance) = plan.sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Invalid);
    };
    let address = CanonicalAddress::parse(&row.address).map_err(|_| internal_state_snapback())?;
    if address != *plan.address || row.key_id != plan.key_id {
        return Err(internal_state_snapback());
    }
    let stored: [u8; 32] = row
        .code_digest
        .as_slice()
        .try_into()
        .map_err(|_| internal_state_snapback())?;
    let attempts = u32::try_from(row.attempts).map_err(|_| internal_state_snapback())?;
    let max_attempts = u32::try_from(row.max_attempts).map_err(|_| internal_state_snapback())?;
    let expires_at_ms = checked_stored_time(row.expires_at_ms)?;
    if max_attempts != AUTH_MAXIMUM_ATTEMPTS || attempts > max_attempts {
        return Err(internal_state_snapback());
    }
    if row.consumed || row.superseded || plan.now_ms >= expires_at_ms {
        perform_rejected_dummy_hmac(plan);
        if let Some(sender_issuance) = plan.sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Invalid);
    }
    if attempts == max_attempts {
        perform_rejected_dummy_hmac(plan);
        if let Some(sender_issuance) = plan.sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Locked);
    }

    let submitted = CodeDigest::compute(plan.key, plan.challenge_id, &address, plan.code);
    if submitted.verify(&stored) {
        return Ok(RejectedExchangeOutcome::PredecessorChanged);
    }
    let next_attempts = attempts
        .checked_add(1)
        .ok_or_else(internal_state_snapback)?;
    let changed = transaction.execute(
        "UPDATE _auth_verification_codes
         SET attempts = ?1
         WHERE challenge_id = ?2 AND attempts = ?3
           AND code_digest = ?4 AND key_id = ?5
           AND expires_at_ms = ?6
           AND consumed_at_ms IS NULL AND superseded_by IS NULL",
        params![
            next_attempts as i64,
            plan.challenge_id.as_str(),
            attempts as i64,
            stored.as_slice(),
            plan.key_id,
            expires_at_ms as i64,
        ],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
    if let Some(sender_issuance) = plan.sender_issuance {
        sender_issuance
            .consume_rejected_outcome(transaction)
            .map_err(|_| internal_state_snapback())?;
    }
    Ok(if next_attempts == max_attempts {
        RejectedExchangeOutcome::Locked
    } else {
        RejectedExchangeOutcome::Invalid
    })
}

fn perform_rejected_dummy_hmac(plan: &CatalogRejectedExchangePlan<'_>) {
    let digest = CodeDigest::compute(
        plan.dummy_key,
        plan.challenge_id,
        plan.dummy_address,
        plan.code,
    );
    let _ = digest.verify(&[0_u8; 32]);
}

fn transaction_uses_identity_core_v3(transaction: &Transaction<'_>) -> SnapbackResult<bool> {
    transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM pragma_table_info('_auth_sessions')
               WHERE name = 'authn_source'
             )",
            [],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

/// Keep the LLP 0057 email-code provider operational on every recognized
/// catalog while writing the expanded v3 identity/session descriptors only
/// when the marked catalog actually carries them.
///
/// @ref LLP 0214#31-version-policy — v1/v2 behavior is retained without rewriting
/// predecessor rows; fresh v3 uses explicit identity provenance columns.
fn insert_email_code_identity(
    transaction: &Transaction<'_>,
    identity_id: &str,
    user_id: &str,
    address: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let sql = if transaction_uses_identity_core_v3(transaction)? {
        "INSERT INTO _auth_identities(
           id, user_id, kind, provider, issuer, subject, canonical_value,
           created_at_ms, verified_at_ms, disabled_at_ms
         ) VALUES(?1, ?2, 'email', 'email-code', NULL, ?3, ?3, ?4, ?4, NULL)"
    } else {
        "INSERT INTO _auth_identities(
           id, user_id, provider, subject, verified_at_ms
         ) VALUES(?1, ?2, 'email-code', ?3, ?4)"
    };
    execute_candidate(
        transaction,
        sql,
        params![identity_id, user_id, address, now_ms as i64],
    )?;
    Ok(())
}

fn insert_guest_session(
    transaction: &Transaction<'_>,
    plan: &CatalogSessionIssuancePlan<'_>,
) -> SnapbackResult<()> {
    if !transaction_uses_identity_core_v3(transaction)? {
        return Err(crate::diagnostic::SnapbackError::error(
            "SNAPBACK_AUTH_GUEST_CATALOG_UNAVAILABLE",
            "auth",
            "guest sessions require the current identity catalog",
        ));
    }
    execute_candidate(
        transaction,
        "INSERT INTO _auth_sessions(
           id,user_id,identity_id,credential_id,authn_source,
           authority_instance_id,token_hash,generation,created_at_ms,
           last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms
         ) VALUES(?1,?2,NULL,NULL,'guest',?3,?4,1,?5,?5,?6,?7,NULL)",
        params![
            plan.projected.session_id,
            plan.projected.user_id,
            plan.projected.authority_instance_id,
            plan.projected.token_digest.as_bytes().as_slice(),
            plan.now_ms as i64,
            plan.projected.expires_at_ms as i64,
            plan.projected.absolute_expires_at_ms as i64,
        ],
    )?;
    Ok(())
}

fn insert_identity_session(
    transaction: &Transaction<'_>,
    session_id: &str,
    user_id: &str,
    identity_id: &str,
    authority_instance_id: &str,
    token_hash: &[u8; 32],
    now_ms: u64,
    expires_at_ms: u64,
    absolute_expires_at_ms: u64,
) -> SnapbackResult<()> {
    let sql = if transaction_uses_identity_core_v3(transaction)? {
        "INSERT INTO _auth_sessions(
           id, user_id, identity_id, credential_id, authn_source,
           authority_instance_id, token_hash, generation, created_at_ms,
           last_used_at_ms, expires_at_ms, absolute_expires_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, NULL, 'identity', ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)"
    } else {
        "INSERT INTO _auth_sessions(
           id, user_id, identity_id, authority_instance_id, token_hash,
           generation, created_at_ms, last_used_at_ms, expires_at_ms,
           absolute_expires_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)"
    };
    execute_candidate(
        transaction,
        sql,
        params![
            session_id,
            user_id,
            identity_id,
            authority_instance_id,
            token_hash.as_slice(),
            now_ms as i64,
            expires_at_ms as i64,
            absolute_expires_at_ms as i64,
        ],
    )?;
    Ok(())
}

pub(crate) fn reconcile_step_up_consumed_on(
    connection: &Connection,
    proof: &StepUpProof,
) -> SnapbackResult<bool> {
    let Some(expected_key_id) = proof.key_id.as_ref() else {
        return Ok(false);
    };
    connection
        .query_row(
            "SELECT canonical_address, key_id,
                    consumed_at_ms IS NOT NULL, superseded_by IS NOT NULL
             FROM _auth_verification_codes WHERE challenge_id = ?1",
            params![proof.challenge_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            },
        )
        .optional()
        .map(|row| {
            row.is_some_and(|(address, key_id, consumed, superseded)| {
                address == proof.address.as_str()
                    && key_id == expected_key_id.as_str()
                    && consumed
                    && !superseded
            })
        })
        .map_err(crate::diagnostic::SnapbackError::from)
}

pub(crate) fn reconcile_step_up_unconsumed_on(
    connection: &Connection,
    proof: &StepUpProof,
) -> SnapbackResult<bool> {
    let Some(expected_key_id) = proof.key_id.as_ref() else {
        return Ok(true);
    };
    connection
        .query_row(
            "SELECT canonical_address, key_id, consumed_at_ms IS NULL
             FROM _auth_verification_codes WHERE challenge_id = ?1",
            params![proof.challenge_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, bool>(2)?,
                ))
            },
        )
        .optional()
        .map(|row| {
            row.is_some_and(|(address, key_id, unconsumed)| {
                address == proof.address.as_str()
                    && key_id == expected_key_id.as_str()
                    && unconsumed
            })
        })
        .map_err(crate::diagnostic::SnapbackError::from)
}

/// Verify and consume one operation-bound proof inside the protected kernel
/// transaction. The sync owner has already selected the proof and operation;
/// this primitive only rechecks and commits its exact durable predecessor.
pub(crate) fn consume_step_up_proof_on(
    transaction: &Transaction<'_>,
    proof: &StepUpProof,
    now_ms: u64,
) -> SnapbackResult<StepUpConsumption> {
    let row = transaction
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms,
                    consumed_at_ms IS NOT NULL, superseded_by IS NOT NULL
             FROM _auth_verification_codes WHERE challenge_id = ?1",
            params![proof.challenge_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Zeroizing::new(row.get::<_, Vec<u8>>(1)?),
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, bool>(6)?,
                    row.get::<_, bool>(7)?,
                ))
            },
        )
        .optional()?;
    let Some((address, digest, key_id, attempts, max_attempts, expires_at, consumed, superseded)) =
        row
    else {
        return Ok(StepUpConsumption::Rejected);
    };
    let Some(expected_key_id) = proof.key_id.as_ref() else {
        return Ok(StepUpConsumption::Rejected);
    };
    let attempts = u32::try_from(attempts).map_err(|_| internal_state_snapback())?;
    let max_attempts = u32::try_from(max_attempts).map_err(|_| internal_state_snapback())?;
    let expires_at_ms = checked_stored_time(expires_at)?;
    if address != proof.address.as_str()
        || key_id != expected_key_id.as_str()
        || digest.len() != 32
        || max_attempts != AUTH_MAXIMUM_ATTEMPTS
        || attempts > max_attempts
    {
        return Err(internal_state_snapback());
    }
    if consumed || superseded || now_ms >= expires_at_ms || attempts == max_attempts {
        return Ok(StepUpConsumption::Rejected);
    }

    let next_attempts = attempts
        .checked_add(1)
        .ok_or_else(internal_state_snapback)?;
    if !proof.submitted_digest.verify(&digest) {
        let changed = transaction.execute(
            "UPDATE _auth_verification_codes SET attempts = ?1
             WHERE challenge_id = ?2 AND attempts = ?3
               AND code_digest = ?4 AND key_id = ?5 AND expires_at_ms = ?6
               AND consumed_at_ms IS NULL AND superseded_by IS NULL",
            params![
                next_attempts as i64,
                proof.challenge_id.as_str(),
                attempts as i64,
                digest.as_slice(),
                expected_key_id.as_str(),
                expires_at_ms as i64,
            ],
        )?;
        if changed != 1 {
            return Ok(StepUpConsumption::Rejected);
        }
        return Ok(StepUpConsumption::Rejected);
    }

    let changed = transaction.execute(
        "UPDATE _auth_verification_codes
         SET attempts = ?1, consumed_at_ms = ?2
         WHERE challenge_id = ?3 AND attempts = ?4
           AND code_digest = ?5 AND key_id = ?6 AND expires_at_ms = ?7
           AND consumed_at_ms IS NULL AND superseded_by IS NULL",
        params![
            next_attempts as i64,
            now_ms as i64,
            proof.challenge_id.as_str(),
            attempts as i64,
            digest.as_slice(),
            expected_key_id.as_str(),
            expires_at_ms as i64,
        ],
    )?;
    if changed != 1 {
        return Ok(StepUpConsumption::Rejected);
    }
    Ok(StepUpConsumption::Verified)
}

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
            .ok_or_else(internal_state_snapback)?;
        let retry_after_ms = oldest
            .checked_add(terms.window_ms)
            .ok_or_else(internal_state_snapback)?
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

#[cfg(any(test, feature = "test-support"))]
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

#[cfg(any(test, feature = "test-support"))]
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

impl LocalDatabase {
    /// Seed one closed human/email logical-transfer fixture.
    ///
    /// @ref LLP 0285#53-defect-3--the-caller-selectable-raw-sqlite-feature —
    /// cross-crate tests describe identity facts without receiving a database
    /// connection or caller-selected SQL authority.
    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_logical_email_identity_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        address: &str,
        created_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![user_id, created_at_ms],
            )?;
            insert_test_email_identity(
                transaction,
                identity_id,
                user_id,
                address,
                created_at_ms,
                false,
            )
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_email_code_identity_for_live_session_for_test(
        &mut self,
        bearer: &str,
        address: &str,
        now_ms: u64,
    ) -> SnapbackResult<String> {
        let bearer =
            SessionBearer::parse_any_version(bearer).map_err(|_| internal_state_snapback())?;
        let token_hash = bearer.token_hash();
        let identity_id = crate::ids::mint_time_ordered(crate::ids::Kind::Identity);
        self.with_auth_transaction(|transaction| {
            // @ref LLP 0285#1-what-closed-means-here — the test-support seam
            // derives the identity owner from a live durable predecessor; it
            // never accepts a caller-selected principal id.
            let user_id = transaction
                .query_row(
                    "SELECT user_id FROM _auth_sessions
                     WHERE token_hash = ?1 AND revoked_at_ms IS NULL
                       AND expires_at_ms > ?2 AND absolute_expires_at_ms > ?2",
                    params![token_hash.as_bytes().as_slice(), now_ms as i64],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(internal_state_snapback)?;
            insert_test_email_identity(transaction, &identity_id, &user_id, address, now_ms, false)
        })?;
        Ok(identity_id)
    }
}

#[cfg(test)]
mod live_session_email_fixture_tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};

    struct FixedRandom(u8);

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(self.0);
            Ok(())
        }
    }

    #[test]
    fn live_session_email_fixture_cannot_attach_to_unrelated_user() {
        let mut database = LocalDatabase::memory().expect("fixture database");
        database
            .activate_current_auth_catalog()
            .expect("current auth catalog");
        let bearer = SessionBearer::generate(&FixedRandom(7)).expect("fixture bearer");
        let token_hash = bearer.token_hash();
        database
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?3), (?2, ?3)",
                    params!["fixture-user", "unrelated-user", 10_i64],
                )?;
                insert_test_email_identity(
                    transaction,
                    "fixture-identity",
                    "fixture-user",
                    "primary@example.com",
                    10,
                    false,
                )?;
                insert_test_identity_session(
                    transaction,
                    "fixture-session",
                    "fixture-user",
                    "fixture-identity",
                    "fixture-authority",
                    token_hash.as_bytes(),
                    10,
                    10,
                    1_000,
                    2_000,
                )
            })
            .expect("live session predecessor");

        let identity_id = database
            .insert_email_code_identity_for_live_session_for_test(
                bearer.expose_secret(),
                "sibling@example.com",
                20,
            )
            .expect("derived-user sibling identity");
        let attached_user = database
            .with_auth_read(|connection| {
                Ok(connection.query_row(
                    "SELECT user_id FROM _auth_identities WHERE id = ?1",
                    [&identity_id],
                    |row| row.get::<_, String>(0),
                )?)
            })
            .expect("attached identity owner");
        assert_eq!(attached_user, "fixture-user");
        assert_ne!(attached_user, "unrelated-user");

        let expired = database.insert_email_code_identity_for_live_session_for_test(
            bearer.expose_secret(),
            "must-not-attach@example.com",
            1_000,
        );
        assert_eq!(
            expired
                .expect_err("expired predecessor must refuse")
                .diagnostic
                .code,
            "INTERNAL_AUTH_STATE",
        );
        assert_eq!(
            database
                .auth_catalog_read()
                .identity_subject_count_for_test("must-not-attach@example.com")
                .expect("refused identity count"),
            0,
        );
    }
}

#[cfg(any(test, feature = "test-support"))]
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

#[cfg(any(test, feature = "test-support"))]
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
        binding: &CatalogStepUpBinding<'_>,
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
                       AND identity.provider = 'email-code'
                       AND (?6 != 'passwordSet' OR identity.disabled_at_ms IS NULL)",
                    params![
                        binding.session_id,
                        binding.user_id,
                        binding.session_generation as i64,
                        binding.authority_instance_id,
                        now_ms as i64,
                        binding.operation,
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
                    .map_err(|_| internal_state_snapback())?;
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
    ) -> SnapbackResult<PresentedSessionLookup> {
        self.with_auth_read(|connection| lookup_presented_session(connection, token_hash))
    }

    pub(super) fn auth_lookup_presented_session_with_sender_binding(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<(PresentedSessionLookup, bool)> {
        self.with_auth_read(|connection| {
            let lookup = lookup_presented_session(connection, token_hash)?;
            // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: the durable
            // family binding (not the presented spelling) selects the
            // successor spelling, so every successor of a sender-bound
            // family stays `sbs2_`.
            let sender_bound = super::auth_sender::presented_token_has_sender_family_binding_on(
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
        plan: &CatalogFamilyAlarmPlan<'_>,
    ) -> super::auth::AuthTransactionAttempt<PlannedFamilyAlarmCommit> {
        self.attempt_auth_transaction(|transaction| {
            planned_family_alarm_transaction(transaction, plan)
        })
    }

    pub(super) fn auth_attempt_planned_revocation(
        &mut self,
        plan: &CatalogRevocationPlan<'_>,
        now_ms: u64,
    ) -> super::auth::AuthTransactionAttempt<PlannedRevocationCommit> {
        self.attempt_auth_transaction(|transaction| {
            planned_revocation_transaction(transaction, plan, now_ms)
        })
    }

    pub(super) fn auth_reconcile_planned_revocation(
        &self,
        plan: &CatalogRevocationPlan<'_>,
        now_ms: u64,
    ) -> SnapbackResult<DurableRevocationReconcile> {
        self.with_auth_read(|connection| reconcile_planned_revocation(connection, plan, now_ms))
    }

    pub(super) fn auth_attempt_planned_rotation(
        &mut self,
        plan: &CatalogRotationPlan<'_>,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedRotationTransaction>,
        Option<PlannedRotationTransaction>,
    ) {
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|transaction| {
            let outcome = planned_rotation_transaction(transaction, plan)?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        (attempt, body_outcome)
    }

    pub(super) fn auth_reconcile_planned_rotation(
        &self,
        plan: &CatalogRotationPlan<'_>,
    ) -> SnapbackResult<DurableRotationReconcile> {
        self.with_auth_read(|connection| reconcile_planned_rotation(connection, plan))
    }

    pub(super) fn auth_authenticated_use_row(
        &self,
        session_id: &str,
        expected_generation: u64,
    ) -> SnapbackResult<Option<AuthenticatedUseRow>> {
        self.with_auth_read(|connection| {
            authenticated_use_row(connection, session_id, expected_generation)
        })
    }

    pub(super) fn auth_extend_authenticated_use(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        now_ms: u64,
        expires_at_ms: u64,
        coalesce_ms: u64,
    ) -> SnapbackResult<bool> {
        self.with_auth_transaction(|transaction| {
            extend_authenticated_use_transaction(
                transaction,
                session_id,
                expected_generation,
                now_ms,
                expires_at_ms,
                coalesce_ms,
            )
        })
    }

    pub(super) fn auth_exchange_challenge_fact(
        &self,
        challenge_id: &ChallengeId,
    ) -> SnapbackResult<Option<ExchangeChallengeFact>> {
        self.with_auth_read(|connection| exchange_challenge_fact(connection, challenge_id))
    }

    pub(super) fn auth_commit_planned_rejection(
        &mut self,
        plan: &CatalogRejectedExchangePlan<'_>,
    ) -> SnapbackResult<RejectedExchangeOutcome> {
        self.with_auth_transaction(|transaction| rejected_exchange_transaction(transaction, plan))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_step_up_challenge(
        &mut self,
        binding: &CatalogStepUpBinding<'_>,
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
                       AND identity.provider = 'email-code'
                       AND (?6 != 'passwordSet' OR identity.disabled_at_ms IS NULL)",
                    params![
                        binding.session_id,
                        binding.user_id,
                        binding.session_generation as i64,
                        binding.authority_instance_id,
                        now_ms as i64,
                        binding.operation,
                    ],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            if live_address.as_deref() != Some(address.as_str()) {
                return Ok(RequestInsertOutcome::AuthRequired);
            }

            if let Some(refusal) =
                request_code_budget_refusal(transaction, address, now_ms, *budget_policy)?
            {
                return Err(crate::auth::throttle::throttled_snapback(refusal));
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
                Err(error) if is_constraint_error(&error) => Err(internal_collision_snapback()),
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
                return Err(crate::auth::throttle::throttled_snapback(refusal));
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
                Err(error) if is_constraint_error(&error) => Err(internal_collision_snapback()),
                Err(error) => Err(error.into()),
            }
        })
    }

    pub(super) fn auth_session_issuance_facts(
        &self,
        address: &CanonicalAddress,
        candidate_user_id: &str,
        now_ms: u64,
        live_limit: u64,
    ) -> SnapbackResult<SessionIssuanceFacts> {
        self.with_auth_read(|connection| {
            session_issuance_facts(connection, address, candidate_user_id, now_ms, live_limit)
        })
    }

    pub(super) fn auth_session_cap_facts(
        &self,
        user_id: &str,
        now_ms: u64,
        live_limit: u64,
    ) -> SnapbackResult<SessionCapFacts> {
        self.with_auth_read(|connection| session_cap_facts(connection, user_id, now_ms, live_limit))
    }

    pub(super) fn auth_user_session_revocation_facts(
        &self,
        user_id: &str,
        excluded_session_id: Option<&str>,
        identity_id: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<Vec<SessionRevocationCandidateFact>> {
        self.with_auth_read(|connection| {
            user_session_revocation_facts(
                connection,
                user_id,
                excluded_session_id,
                identity_id,
                now_ms,
            )
        })
    }

    pub(super) fn auth_attempt_planned_session_issuance(
        &mut self,
        plan: &CatalogSessionIssuancePlan<'_>,
        exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
    ) -> (
        super::auth::AuthTransactionAttempt<CatalogIssuanceCommit>,
        Option<CatalogIssuanceCommit>,
    ) {
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|transaction| {
            let outcome = planned_session_issuance_transaction(transaction, plan, exchange_proof)?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        (attempt, body_outcome)
    }

    #[allow(dead_code)] // Staged password route invokes this kernel next.
    pub(super) fn auth_attempt_password_change(
        &mut self,
        plan: &CatalogPasswordChangePlan<'_>,
    ) -> (
        super::auth::AuthTransactionAttempt<CatalogPasswordChangeCommit>,
        Option<CatalogPasswordChangeCommit>,
    ) {
        let mut body_outcome = None;
        let attempt = self.attempt_auth_transaction(|transaction| {
            let outcome = planned_password_change_transaction(transaction, plan)?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        (attempt, body_outcome)
    }

    #[allow(dead_code)]
    pub(super) fn auth_reconcile_password_change(
        &self,
        plan: &CatalogPasswordChangePlan<'_>,
    ) -> SnapbackResult<CatalogPasswordChangeReconcile> {
        self.with_auth_read(|connection| reconcile_password_change(connection, plan))
    }

    pub(super) fn auth_reconcile_rejected_issuance(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<DurableRejectedIssuanceReconcile> {
        self.with_auth_read(|connection| reconcile_rejected_issuance(connection, plan))
    }

    pub(super) fn auth_sender_key_bound_successor(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<bool> {
        self.with_auth_read(|connection| {
            let Some(sender_issuance) = plan.sender_issuance else {
                return Err(internal_state_snapback());
            };
            sender_issuance
                .is_key_bound_successor(connection, plan.projected.session_id)
                .map_err(|_| internal_state_snapback())
        })
    }

    pub(super) fn auth_reconcile_planned_issuance(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<CatalogIssuanceReconcile> {
        self.with_auth_read(|connection| reconcile_planned_issuance(connection, plan))
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_presented_token_sender_bound_for_test(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<bool> {
        self.with_auth_read(|connection| {
            super::auth_sender::presented_token_has_sender_family_binding_on(
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_catalog_version_for_test(&self) -> SnapbackResult<String> {
        self.with_auth_read(|connection| {
            Ok(connection.query_row(
                "SELECT value FROM _snapback_meta WHERE key = 'auth_catalog_version'",
                [],
                |row| row.get::<_, String>(0),
            )?)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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
                "INSERT OR IGNORE INTO _auth_users(
                   id, kind, registration_provenance, created_at_ms
                 ) VALUES(
                   'user-1', 'agent', '{\"class\":\"nonprincipal-test-fixture\"}', 0
                 )",
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_verification_challenge_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|conn| {
            Ok(
                conn.query_row("SELECT COUNT(*) FROM _auth_verification_codes", [], |row| {
                    row.get(0)
                })?,
            )
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    /// Cross-crate remainder fixture. The caller may choose projection
    /// coordinates, but the durable user is deliberately non-human, so neither
    /// principal resolution nor attributed effect approval can consume it.
    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_nonprincipal_email_session_for_test(
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
                "INSERT INTO _auth_users(id, kind, registration_provenance, created_at_ms)
                 VALUES(?1, 'agent', '{\"class\":\"nonprincipal-test-fixture\"}', ?2)",
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

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_bind_email_session_bearer_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        address: &str,
        token_hash: &[u8],
        generation: u64,
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            let present = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_sessions WHERE id = ?1)",
                params![session_id],
                |row| row.get::<_, i64>(0),
            )? != 0;
            if present {
                transaction.execute(
                    "UPDATE _auth_sessions
                     SET token_hash = ?1, expires_at_ms = ?2, absolute_expires_at_ms = ?2,
                         authority_instance_id = ?3, generation = ?4
                     WHERE id = ?5",
                    params![
                        token_hash,
                        expires_at_ms as i64,
                        authority_instance_id,
                        generation as i64,
                        session_id
                    ],
                )?;
                return Ok(());
            }
            transaction.execute(
                "INSERT OR IGNORE INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![user_id, now_ms as i64],
            )?;
            insert_test_email_identity(transaction, identity_id, user_id, address, now_ms, false)?;
            insert_test_identity_session(
                transaction,
                session_id,
                user_id,
                identity_id,
                authority_instance_id,
                token_hash,
                now_ms,
                now_ms,
                expires_at_ms,
                expires_at_ms,
            )?;
            if generation != 1 {
                transaction.execute(
                    "UPDATE _auth_sessions SET generation = ?1 WHERE id = ?2",
                    params![generation as i64, session_id],
                )?;
            }
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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
                "INSERT INTO _auth_users(id, kind, registration_provenance, created_at_ms)
                 VALUES(?1, 'agent', '{\"class\":\"nonprincipal-test-fixture\"}', 0)",
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

    #[cfg(any(test, feature = "test-support"))]
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
                "INSERT INTO _auth_users(id, kind, registration_provenance, created_at_ms)
                 VALUES(?1, 'agent', '{\"class\":\"nonprincipal-test-fixture\"}', 0)",
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_session_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_change_journal_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_tombstone_count_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT COUNT(*) FROM _auth_session_tokens", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_sole_session_generation_for_test(&self) -> SnapbackResult<i64> {
        self.with_auth_read(|connection| {
            connection
                .query_row("SELECT generation FROM _auth_sessions", [], |row| {
                    row.get(0)
                })
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_delete_terminal_cause_witness_for_test(
        &mut self,
        session_id: &str,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "DELETE FROM _snapback_meta WHERE key = ?1",
                params![crate::contract_types::SessionTerminalCauseRecord::meta_key(
                    session_id
                )?],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_session_revoked_for_test(&self, session_id: &str) -> SnapbackResult<i64> {
        self.with_auth_read(|conn| {
            Ok(conn.query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_sessions WHERE id = ?1",
                params![session_id],
                |row| row.get(0),
            )?)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_insert_activation_live_grant_for_test(
        &mut self,
        agent_user_id: &str,
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
                 ) VALUES('activation-grant', ?1, 'activation-owner', ?2,
                          ?3, ?4, NULL, 'test', NULL, NULL, ?3)",
                params![
                    agent_user_id,
                    r#"[{"fn":"fn:listItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:unrelatedLive","kind":"liveQuery","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    now_ms.saturating_add(60_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_install_service_replay_authority_for_test(
        &mut self,
        now_ms: u64,
        expires_at_ms: u64,
        tokens: &[(String, String, Vec<u8>, u64)],
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
            for (token_id, grant_id, token_hash, credential_generation) in tokens {
                tx.execute(
                    "INSERT INTO _auth_grant_tokens(
                       id, token_hash, grant_id, credential_id,
                       credential_generation, created_at_ms, expires_at_ms,
                       revoked_at_ms
                     ) VALUES(?1, ?2, ?3, 'credential-a', ?4, ?5, ?6, NULL)",
                    params![
                        token_id,
                        token_hash,
                        grant_id,
                        credential_generation,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                )?;
            }
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn auth_insert_exact_grant_for_test(
        &mut self,
        grant_id: &str,
        actor_user_id: &str,
        effective_user_id: Option<&str>,
        scopes: &[super::auth_grants::ExactGrantScope],
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        let scopes_json = serde_json::to_string(scopes).map_err(|error| {
            crate::diagnostic::SnapbackError::error(
                "SNAPBACK_AUTH_GRANT_INVALID",
                "auth",
                format!("could not encode exact test grant scopes: {error}"),
            )
        })?;
        self.with_auth_transaction(|tx| {
            for scope in scopes {
                tx.execute(
                    "INSERT OR REPLACE INTO _auth_scope_bases(
                       function_id, kind, generation, present, authority_creating
                     ) VALUES(?1, ?2, ?3, 1, ?4)",
                    params![
                        scope.function_id,
                        scope.kind.as_str(),
                        scope.basis as i64,
                        i64::from(scope.authority_creating)
                    ],
                )?;
            }
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, NULL, 'test', NULL, NULL, ?5)",
                params![
                    grant_id,
                    actor_user_id,
                    effective_user_id,
                    scopes_json,
                    now_ms as i64,
                    expires_at_ms as i64
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_insert_query_carrier_grant_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('018f0d90-7b32-7a22-8c33-445566778899',
                          ?1,
                          '018f0d90-7b30-7a22-8c33-445566778899', ?2, ?3, ?4,
                          NULL, 'test', NULL, NULL, ?3)",
                params![
                    agent_user_id,
                    r#"[{"fn":"fn:allowed","kind":"query","basis":0,"authorityCreating":false},{"fn":"fn:liveItems","kind":"liveQuery","basis":0,"authorityCreating":false},{"fn":"fn:queuedWrite","kind":"mutation","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    (now_ms + 60_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_insert_live_carrier_grant_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx| {
            tx.execute(
                "INSERT INTO _auth_grants(
                   id, actor_user_id, effective_user_id, scopes, created_at_ms,
                   expires_at_ms, revoked_at_ms, created_by, request_id,
                   consent_digest, last_used_at_ms
                 ) VALUES('018f0d90-7b32-7a22-8c33-445566778899',
                          ?1,
                          '018f0d90-7b30-7a22-8c33-445566778899', ?2, ?3, ?4,
                          NULL, 'test', NULL, NULL, ?3)",
                params![
                    agent_user_id,
                    r#"[{"fn":"fn:liveItems","kind":"liveQuery","basis":0,"authorityCreating":false}]"#,
                    now_ms as i64,
                    (now_ms + 60 * 60 * 1_000) as i64,
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_invitation_count_for_test(&self, user_id: &str) -> SnapbackResult<u64> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM _auth_agent_invitations WHERE created_by = ?1",
                    params![user_id],
                    |row| row.get(0),
                )
                .map_err(crate::diagnostic::SnapbackError::from)
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_insert_agent_token_route_fixtures_for_test(
        &mut self,
        agent_user_id: &str,
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
                 ) VALUES('route-grant', ?1, 'grant-user', ?2, ?3, ?4,
                          NULL, 'test', 'route-pairing', NULL, ?3)",
                params![
                    agent_user_id,
                    scopes,
                    now_ms as i64,
                    (now_ms + 60_000) as i64
                ],
            )?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES('route-pairing', zeroblob(32), 'grant-user', ?1,
                          ?2, 'approved', 0, ?3, ?4, ?3, 'route-grant')",
                params![
                    agent_user_id,
                    scopes,
                    now_ms as i64,
                    (now_ms + 60_000) as i64
                ],
            )?;
            tx.execute(
                "INSERT INTO _auth_pairing_requests(
                   id, code_hash, minted_by_user_id, agent_user_id,
                   requested_scopes, state, attempts, created_at_ms,
                   expires_at_ms, consumed_at_ms, grant_id
                 ) VALUES('route-pending',
                          X'0101010101010101010101010101010101010101010101010101010101010101',
                          'grant-user', ?1,
                          ?2, 'pending', 0, ?3, ?4, NULL, NULL)",
                params![
                    agent_user_id,
                    scopes,
                    now_ms as i64,
                    (now_ms + 60_000) as i64
                ],
            )?;
            Ok(())
        })
    }

    #[cfg(any(test, feature = "test-support"))]
    pub(super) fn auth_insert_bulk_route_grants_for_test(
        &mut self,
        agent_user_id: &str,
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
                     ) VALUES(?1, ?2, ?3, ?4, ?5, ?6,
                              NULL, 'test', ?7, NULL, ?5)",
                    params![
                        grant_id,
                        agent_user_id,
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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
        binding: &CatalogStepUpBinding<'_>,
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
    ) -> SnapbackResult<PresentedSessionLookup> {
        self.read_db().auth_lookup_presented_session(token_hash)
    }

    pub fn lookup_presented_session_with_sender_binding(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<(PresentedSessionLookup, bool)> {
        self.read_db()
            .auth_lookup_presented_session_with_sender_binding(token_hash)
    }

    pub fn attempt_planned_family_alarm(
        &mut self,
        plan: &CatalogFamilyAlarmPlan<'_>,
    ) -> super::auth::AuthTransactionAttempt<PlannedFamilyAlarmCommit> {
        self.write_db().auth_attempt_planned_family_alarm(plan)
    }

    pub fn attempt_planned_revocation(
        &mut self,
        plan: &CatalogRevocationPlan<'_>,
        now_ms: u64,
    ) -> super::auth::AuthTransactionAttempt<PlannedRevocationCommit> {
        self.write_db()
            .auth_attempt_planned_revocation(plan, now_ms)
    }

    pub fn reconcile_planned_revocation(
        &self,
        plan: &CatalogRevocationPlan<'_>,
        now_ms: u64,
    ) -> SnapbackResult<DurableRevocationReconcile> {
        self.read_db()
            .auth_reconcile_planned_revocation(plan, now_ms)
    }

    pub fn attempt_planned_rotation(
        &mut self,
        plan: &CatalogRotationPlan<'_>,
    ) -> (
        super::auth::AuthTransactionAttempt<PlannedRotationTransaction>,
        Option<PlannedRotationTransaction>,
    ) {
        self.write_db().auth_attempt_planned_rotation(plan)
    }

    pub fn reconcile_planned_rotation(
        &self,
        plan: &CatalogRotationPlan<'_>,
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

    pub fn extend_authenticated_use(
        &mut self,
        session_id: &str,
        expected_generation: u64,
        now_ms: u64,
        expires_at_ms: u64,
        coalesce_ms: u64,
    ) -> SnapbackResult<bool> {
        self.write_db().auth_extend_authenticated_use(
            session_id,
            expected_generation,
            now_ms,
            expires_at_ms,
            coalesce_ms,
        )
    }

    pub fn exchange_challenge_fact(
        &self,
        challenge_id: &ChallengeId,
    ) -> SnapbackResult<Option<ExchangeChallengeFact>> {
        self.read_db().auth_exchange_challenge_fact(challenge_id)
    }

    pub fn commit_planned_rejection(
        &mut self,
        plan: &CatalogRejectedExchangePlan<'_>,
    ) -> SnapbackResult<RejectedExchangeOutcome> {
        self.write_db().auth_commit_planned_rejection(plan)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_step_up_challenge(
        &mut self,
        binding: &CatalogStepUpBinding<'_>,
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
    pub fn insert_verification_challenge_for_rehearsal_window(
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

    pub fn session_issuance_facts(
        &self,
        address: &CanonicalAddress,
        candidate_user_id: &str,
        now_ms: u64,
        live_limit: u64,
    ) -> SnapbackResult<SessionIssuanceFacts> {
        self.read_db()
            .auth_session_issuance_facts(address, candidate_user_id, now_ms, live_limit)
    }

    pub fn session_cap_facts(
        &self,
        user_id: &str,
        now_ms: u64,
        live_limit: u64,
    ) -> SnapbackResult<SessionCapFacts> {
        self.read_db()
            .auth_session_cap_facts(user_id, now_ms, live_limit)
    }

    pub fn user_session_revocation_facts(
        &self,
        user_id: &str,
        excluded_session_id: Option<&str>,
        identity_id: Option<&str>,
        now_ms: u64,
    ) -> SnapbackResult<Vec<SessionRevocationCandidateFact>> {
        self.read_db().auth_user_session_revocation_facts(
            user_id,
            excluded_session_id,
            identity_id,
            now_ms,
        )
    }

    pub fn attempt_planned_session_issuance(
        &mut self,
        plan: &CatalogSessionIssuancePlan<'_>,
        exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
    ) -> (
        super::auth::AuthTransactionAttempt<CatalogIssuanceCommit>,
        Option<CatalogIssuanceCommit>,
    ) {
        self.write_db()
            .auth_attempt_planned_session_issuance(plan, exchange_proof)
    }

    #[allow(dead_code)]
    pub fn attempt_password_change(
        &mut self,
        plan: &CatalogPasswordChangePlan<'_>,
    ) -> (
        super::auth::AuthTransactionAttempt<CatalogPasswordChangeCommit>,
        Option<CatalogPasswordChangeCommit>,
    ) {
        self.write_db().auth_attempt_password_change(plan)
    }

    #[allow(dead_code)]
    pub fn reconcile_password_change(
        &self,
        plan: &CatalogPasswordChangePlan<'_>,
    ) -> SnapbackResult<CatalogPasswordChangeReconcile> {
        self.read_db().auth_reconcile_password_change(plan)
    }

    pub fn reconcile_rejected_issuance(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<DurableRejectedIssuanceReconcile> {
        self.read_db().auth_reconcile_rejected_issuance(plan)
    }

    pub fn sender_key_bound_successor(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<bool> {
        self.read_db().auth_sender_key_bound_successor(plan)
    }

    pub fn reconcile_planned_issuance(
        &self,
        plan: &CatalogSessionIssuancePlan<'_>,
    ) -> SnapbackResult<CatalogIssuanceReconcile> {
        self.read_db().auth_reconcile_planned_issuance(plan)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn presented_token_sender_bound_for_test(
        &self,
        token_hash: &TokenHash,
    ) -> SnapbackResult<bool> {
        self.read_db()
            .auth_presented_token_sender_bound_for_test(token_hash)
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn catalog_version_for_test(&self) -> SnapbackResult<String> {
        self.read_db().auth_catalog_version_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_verification_key_id_for_test(&mut self, key_id: &str) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_verification_key_id_for_test(key_id)
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn session_generation_revoked_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, Option<i64>)> {
        self.read_db()
            .auth_session_generation_revoked_for_test(session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn verification_challenge_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_verification_challenge_count_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_expired_challenges_for_test(&mut self, count: usize) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_expired_challenges_for_test(count)
    }

    // This arbitrary durable identity/session/digest mint is confined to this
    // crate's unit-test compilation. Additive features are part of the public
    // attacker surface and must not expose a ResolvedPrincipal seed.
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

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub fn bind_email_session_bearer_for_test(
        &mut self,
        user_id: &str,
        identity_id: &str,
        session_id: &str,
        authority_instance_id: &str,
        address: &str,
        token_hash: &[u8],
        generation: u64,
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_bind_email_session_bearer_for_test(
            user_id,
            identity_id,
            session_id,
            authority_instance_id,
            address,
            token_hash,
            generation,
            now_ms,
            expires_at_ms,
        )
    }

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub fn insert_nonprincipal_email_session_for_test(
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
        self.write_db()
            .auth_insert_nonprincipal_email_session_for_test(
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn restored_counts_for_test(&self, session_id: &str) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_restored_counts_for_test(session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn session_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_session_count_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn change_journal_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_change_journal_count_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn challenge_issue_facts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64)> {
        self.read_db()
            .auth_challenge_issue_facts_for_test(challenge_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn challenge_attempts_and_sessions_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.read_db()
            .auth_challenge_attempts_and_sessions_for_test(challenge_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn provision_counts_for_test(&self) -> SnapbackResult<(i64, i64, i64)> {
        self.read_db().auth_provision_counts_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn current_and_tombstone_counts_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_current_and_tombstone_counts_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn session_cap_facts_for_test(
        &self,
        now_ms: u64,
        revoked_session_id: &str,
    ) -> SnapbackResult<(i64, i64)> {
        self.read_db()
            .auth_session_cap_facts_for_test(now_ms, revoked_session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn tombstone_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_tombstone_count_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn sole_session_generation_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_sole_session_generation_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn sole_session_generation_revoked_for_test(&self) -> SnapbackResult<(i64, bool)> {
        self.read_db()
            .auth_sole_session_generation_revoked_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn generation_and_tombstones_for_test(&self) -> SnapbackResult<(i64, i64)> {
        self.read_db().auth_generation_and_tombstones_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn session_lifetime_facts_for_test(
        &self,
        session_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, bool)> {
        self.read_db()
            .auth_session_lifetime_facts_for_test(session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn delete_terminal_cause_witness_for_test(
        &mut self,
        session_id: &str,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_delete_terminal_cause_witness_for_test(session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn session_revoked_for_test(&self, session_id: &str) -> SnapbackResult<i64> {
        self.read_db().auth_session_revoked_for_test(session_id)
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn identity_subject_count_for_test(&self, subject: &str) -> SnapbackResult<i64> {
        self.read_db().auth_identity_subject_count_for_test(subject)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn sender_issuance_facts_for_test(&self) -> SnapbackResult<(i64, i64, i64, String)> {
        self.read_db().auth_sender_issuance_facts_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn sender_refusal_facts_for_test(&self) -> SnapbackResult<(i64, i64, i64, String, i64)> {
        self.read_db().auth_sender_refusal_facts_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn oldest_live_session_for_test(&self) -> SnapbackResult<String> {
        self.read_db().auth_oldest_live_session_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn live_session_count_for_test(&self) -> SnapbackResult<i64> {
        self.read_db().auth_live_session_count_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_human_user_for_test(&mut self, user_id: &str, now_ms: u64) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_human_user_for_test(user_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_activation_live_grant_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_activation_live_grant_for_test(agent_user_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn tombstone_scope_basis_for_test(
        &mut self,
        function_id: &str,
        kind: &str,
        authority_creating: bool,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_tombstone_scope_basis_for_test(function_id, kind, authority_creating)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn tombstone_allowed_query_scope_basis_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db()
            .auth_tombstone_allowed_query_scope_basis_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn install_service_replay_authority_for_test(
        &mut self,
        now_ms: u64,
        expires_at_ms: u64,
        tokens: &[(String, String, Vec<u8>, u64)],
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_install_service_replay_authority_for_test(now_ms, expires_at_ms, tokens)
    }

    #[cfg(any(test, feature = "test-support"))]
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

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::too_many_arguments)]
    pub fn insert_exact_grant_for_test(
        &mut self,
        grant_id: &str,
        actor_user_id: &str,
        effective_user_id: Option<&str>,
        scopes: &[super::auth_grants::ExactGrantScope],
        now_ms: u64,
        expires_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db().auth_insert_exact_grant_for_test(
            grant_id,
            actor_user_id,
            effective_user_id,
            scopes,
            now_ms,
            expires_at_ms,
        )
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_grant_expiry_for_test(
        &mut self,
        grant_id: &str,
        grant_deadline_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_grant_expiry_for_test(grant_id, grant_deadline_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn sender_issuance_durable_counts_for_test(
        &self,
        challenge_id: &str,
    ) -> SnapbackResult<(i64, i64, i64, i64, i64)> {
        self.read_db()
            .auth_sender_issuance_durable_counts_for_test(challenge_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_sender_replay_for_test(
        &mut self,
        replay_id: &[u8],
        expires_at_seconds: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_sender_replay_for_test(replay_id, expires_at_seconds)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn advance_sender_replay_epoch_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db().auth_advance_sender_replay_epoch_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_query_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_query_carrier_prerequisites_for_test(now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_query_carrier_grant_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_query_carrier_grant_for_test(agent_user_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_live_carrier_prerequisites_for_test(
        &mut self,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_live_carrier_prerequisites_for_test(now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_live_carrier_grant_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_live_carrier_grant_for_test(agent_user_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn set_agent_credential_rotated_at_for_test(
        &mut self,
        user_id: &str,
        rotated_at_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_set_agent_credential_rotated_at_for_test(user_id, rotated_at_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    #[allow(clippy::type_complexity)]
    pub fn agent_registration_facts_for_test(
        &self,
        user_id: &str,
    ) -> SnapbackResult<((String, Option<String>, String), i64, i64)> {
        self.read_db()
            .auth_agent_registration_facts_for_test(user_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn invitation_consumption_for_test(
        &self,
        invitation_id: &str,
    ) -> SnapbackResult<(String, Option<String>)> {
        self.read_db()
            .auth_invitation_consumption_for_test(invitation_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn invitation_count_for_test(&self, user_id: &str) -> SnapbackResult<u64> {
        self.read_db().auth_invitation_count_for_test(user_id)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_agent_token_route_fixtures_for_test(
        &mut self,
        agent_user_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_agent_token_route_fixtures_for_test(agent_user_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_bulk_route_grants_for_test(
        &mut self,
        agent_user_id: &str,
        owner_id: &str,
        now_ms: u64,
    ) -> SnapbackResult<()> {
        self.write_db()
            .auth_insert_bulk_route_grants_for_test(agent_user_id, owner_id, now_ms)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn insert_step_up_scope_bases_for_test(&mut self) -> SnapbackResult<()> {
        self.write_db().auth_insert_step_up_scope_bases_for_test()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn assert_step_up_consumption_for_test(
        &self,
        bound_request: &str,
        challenge_id: &str,
        code: &str,
    ) -> SnapbackResult<()> {
        self.read_db()
            .auth_assert_step_up_consumption_for_test(bound_request, challenge_id, code)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn verification_address_count_for_test(&self, address: &str) -> SnapbackResult<i64> {
        self.read_db()
            .auth_verification_address_count_for_test(address)
    }
}
