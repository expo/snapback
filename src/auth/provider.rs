//! Durable email-code provider and session-family core.
//!
//! The HTTP and host-operation projections intentionally live elsewhere. This
//! module owns provider state transitions plus the process-local coordination
//! that must be acquired before the outer app-instance/database lock.
//!
//! @ref LLP 0057#email-code-provider — request, exchange, provisioning, and
//! session issuance are one non-enumerating provider state machine.
//! @ref LLP 0057#concurrency-locks-and-linearization — maintenance, address,
//! keyring, and SQLite locks are acquired in that order.
//! @ref LLP 0057#security-and-redaction — provider secrets never enter Debug,
//! diagnostics, the app journal, or generic serializable state.

use std::collections::hash_map::RandomState;
use std::fmt;
use std::hash::{BuildHasher, Hasher as _};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension as _, Transaction, params};
use tokio::sync::{
    Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard,
    RwLock as AsyncRwLock,
};
use uuid::Uuid;
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, OsRandom, RandomSource,
    SessionBearer, StepUpDigest, TokenHash, VerificationCode,
};
use super::keyring::AuthKeyringStore;
use super::lease::{
    AuthorizedLease, AuthorizedLeaseAuthenticator, AuthorizedLeaseConfig,
    AuthorizedLeaseExpectation, AuthorizedLeaseIssue, VerifiedAuthorizedLease,
};
use super::lifecycle::KeyringGcResult;
use super::mailbox::{CaptureMailbox, CaptureMailboxEntry};
use super::session_projection::ProjectedSessionInsert;
use super::session_projection::{RevocationReason, TokenDigest};
use super::wire::{
    CredentialResponse, FamilyAlarmResponse, MailboxResponse, RequestCodeResponse, SessionResponse,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use crate::storage::auth::AuthTransactionAttempt;

pub const AUTH_ADDRESS_STRIPES: usize = 256;
pub const AUTH_MAX_COLLISION_ATTEMPTS: usize = 3;
pub const AUTH_CHALLENGE_TTL_MS: u64 = 10 * 60 * 1_000;
// @ref LLP 0039#dated-amendment-operation-bound-step-up-2026-07-15 — the
// non-production proof is deliberately shorter than an ordinary login code.
pub const AUTH_STEP_UP_TTL_MS: u64 = 5 * 60 * 1_000;
pub const AUTH_MAXIMUM_ATTEMPTS: u32 = 5;
pub const AUTH_ADDRESS_REQUEST_LIMIT: usize = 5;
pub const AUTH_ADDRESS_REQUEST_WINDOW_MS: u64 = 10 * 60 * 1_000;
pub const AUTH_GLOBAL_REQUEST_LIMIT: usize = 120;
pub const AUTH_GLOBAL_REQUEST_WINDOW_MS: u64 = 60 * 1_000;
pub const AUTH_SESSION_SLIDING_WINDOW_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_ABSOLUTE_WINDOW_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_REFRESH_CADENCE_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_SUPERSESSION_GRACE_MS: u64 = 10 * 1_000;
pub const AUTH_SESSION_LIVE_LIMIT: usize = 20;
pub const AUTH_SESSION_USE_COALESCE_MS: u64 = 3 * 24 * 60 * 60 * 1_000;
pub const AUTH_FAMILY_ALARM_MINIMUM_MS: u64 = 20;
pub const AUTH_FAMILY_ALARM_JITTER_MAXIMUM_MS: u64 = 5;
const MAX_SAFE_TIMESTAMP: u64 = 9_007_199_254_740_991;
const INTERNAL_AUTH_COLLISION: &str = "INTERNAL_AUTH_COLLISION";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthProviderProfile {
    Dev,
    Test,
    Demo,
    Prod,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthProviderReadiness {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthGcPass {
    pub challenges_deleted: usize,
    pub sessions_deleted: usize,
    pub mailbox_entries_pruned: usize,
    pub retired_keys_pruned: usize,
    pub immediate_retry: bool,
}

impl AuthGcPass {
    pub(crate) fn next_delay(self) -> Duration {
        if self.immediate_retry {
            Duration::ZERO
        } else {
            super::lifecycle::AUTH_GC_INTERVAL
        }
    }
}

impl AuthProviderProfile {
    fn permits_capture(self) -> bool {
        matches!(self, Self::Dev | Self::Test | Self::Demo)
    }

    /// Dev/demo codes never leave the bounded in-process capture mailbox, so
    /// repeated local ceremonies cannot send mail to or otherwise burden the
    /// canonical address. Test deliberately retains the production-shaped
    /// per-address budget so its exact-boundary coverage stays meaningful.
    ///
    /// @ref LLP 0057#request-code-transaction — the capture-only profile
    /// exception leaves the global and mailbox budgets in force.
    fn exempts_capture_address_request_budget(self) -> bool {
        matches!(self, Self::Dev | Self::Demo)
    }
}

/// Both durable and monotonic time are injected so boundary/interleaving tests
/// never need to sleep or substitute wall time for mailbox/alarm time.
pub trait AuthClock: Send + Sync {
    fn epoch_ms(&self) -> u64;
    fn monotonic_now(&self) -> Instant;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SystemAuthClock;

impl AuthClock for SystemAuthClock {
    fn epoch_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(MAX_SAFE_TIMESTAMP as u128) as u64
    }

    fn monotonic_now(&self) -> Instant {
        Instant::now()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRevocation {
    pub session_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedSession {
    pub session_id: String,
    pub user_id: String,
    pub identity_id: String,
    pub provider: String,
    pub generation: u64,
    pub authority_instance_id: String,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub absolute_expires_at_ms: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthenticatedUse {
    Unchanged { expires_at_ms: u64 },
    Extended { expires_at_ms: u64 },
    NotLive,
}

/// Redacted result of the first, read-only exchange lookup. It carries only
/// enough state to select the address stripe and key before the writer starts;
/// the transaction treats every field as untrusted and re-reads the row.
#[derive(Clone)]
pub struct ExchangeCoordination {
    challenge_id: ChallengeId,
    address: CanonicalAddress,
    key_id: AuthKeyId,
}

/// Server-derived identity and one closed operation target. No wire value can
/// construct this binding without first passing the session authority gate.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct StepUpBinding {
    user_id: String,
    session_id: String,
    session_generation: u64,
    authority_instance_id: String,
    operation: &'static str,
    target_id: String,
}

impl StepUpBinding {
    pub(crate) fn grant_approval(
        user_id: String,
        session_id: String,
        session_generation: u64,
        authority_instance_id: String,
        request_id: String,
    ) -> Self {
        Self {
            user_id,
            session_id,
            session_generation,
            authority_instance_id,
            operation: "grantApproval",
            target_id: request_id,
        }
    }
}

impl fmt::Debug for StepUpBinding {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StepUpBinding")
            .field("operation", &self.operation)
            .field("target_id", &self.target_id)
            .field("principal", &"[REDACTED]")
            .finish()
    }
}

pub(crate) struct StepUpCoordination {
    challenge_id: ChallengeId,
    address: CanonicalAddress,
    key_id: Option<AuthKeyId>,
}

impl fmt::Debug for StepUpCoordination {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpCoordination([REDACTED])")
    }
}

/// An HMAC-verified candidate retained with the address stripe until the
/// protected transaction either consumes it or rolls back.
pub(crate) struct StepUpProofAdmission {
    _admission: AuthAdmission,
    _stripe: OwnedMutexGuard<()>,
    proof: StepUpProof,
}

impl StepUpProofAdmission {
    pub(crate) fn proof(&self) -> &StepUpProof {
        &self.proof
    }
}

impl fmt::Debug for StepUpProofAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpProofAdmission([REDACTED])")
    }
}

pub(crate) struct StepUpProof {
    challenge_id: ChallengeId,
    address: CanonicalAddress,
    key_id: Option<AuthKeyId>,
    submitted_digest: StepUpDigest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StepUpConsumption {
    Verified,
    Rejected,
}

impl fmt::Debug for StepUpProof {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpProof([REDACTED])")
    }
}

impl StepUpProof {
    pub(crate) fn reconcile_consumed_on(&self, connection: &Connection) -> SnapbackResult<bool> {
        let Some(expected_key_id) = self.key_id.as_ref() else {
            return Ok(false);
        };
        connection
            .query_row(
                "SELECT canonical_address, key_id,
                        consumed_at_ms IS NOT NULL, superseded_by IS NOT NULL
                 FROM _auth_verification_codes WHERE challenge_id = ?1",
                params![self.challenge_id.as_str()],
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
                    address == self.address.as_str()
                        && key_id == expected_key_id.as_str()
                        && consumed
                        && !superseded
                })
            })
            .map_err(SnapbackError::from)
    }

    pub(crate) fn reconcile_unconsumed_on(&self, connection: &Connection) -> SnapbackResult<bool> {
        let Some(expected_key_id) = self.key_id.as_ref() else {
            return Ok(true);
        };
        connection
            .query_row(
                "SELECT canonical_address, key_id, consumed_at_ms IS NULL
                 FROM _auth_verification_codes WHERE challenge_id = ?1",
                params![self.challenge_id.as_str()],
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
                    address == self.address.as_str()
                        && key_id == expected_key_id.as_str()
                        && unconsumed
                })
            })
            .map_err(SnapbackError::from)
    }

    /// Verify and consume the proof inside the protected operation's writer
    /// transaction. A successful proof can therefore commit at most one
    /// authority-creating effect; rollback leaves both proof and effect
    /// untouched.
    pub(crate) fn consume_on(
        &self,
        transaction: &Transaction<'_>,
        now_ms: u64,
    ) -> SnapbackResult<StepUpConsumption> {
        let row = transaction
            .query_row(
                "SELECT canonical_address, code_digest, key_id, attempts,
                        max_attempts, expires_at_ms,
                        consumed_at_ms IS NOT NULL, superseded_by IS NOT NULL
                 FROM _auth_verification_codes WHERE challenge_id = ?1",
                params![self.challenge_id.as_str()],
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
        let Some((
            address,
            digest,
            key_id,
            attempts,
            max_attempts,
            expires_at,
            consumed,
            superseded,
        )) = row
        else {
            return Ok(StepUpConsumption::Rejected);
        };
        let Some(expected_key_id) = self.key_id.as_ref() else {
            return Ok(StepUpConsumption::Rejected);
        };
        let attempts = u32::try_from(attempts).map_err(|_| internal_state_snapback())?;
        let max_attempts = u32::try_from(max_attempts).map_err(|_| internal_state_snapback())?;
        let expires_at_ms = checked_stored_time(expires_at)?;
        if address != self.address.as_str()
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
        if !self.submitted_digest.verify(&digest) {
            let changed = transaction.execute(
                "UPDATE _auth_verification_codes SET attempts = ?1
                 WHERE challenge_id = ?2 AND attempts = ?3
                   AND code_digest = ?4 AND key_id = ?5 AND expires_at_ms = ?6
                   AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                params![
                    next_attempts as i64,
                    self.challenge_id.as_str(),
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
                self.challenge_id.as_str(),
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
}

impl fmt::Debug for ExchangeCoordination {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ExchangeCoordination([REDACTED])")
    }
}

/// Credential issuance may atomically evict one prior live session. Keeping
/// that fact beside the response lets item 5 update its projection before the
/// plaintext credential is published.
pub struct CredentialIssue {
    response: CredentialResponse,
    committed_revocation: Option<SessionRevocation>,
}

impl CredentialIssue {
    fn new(response: CredentialResponse, committed_revocation: Option<SessionRevocation>) -> Self {
        Self {
            response,
            committed_revocation,
        }
    }

    pub fn response(&self) -> &CredentialResponse {
        &self.response
    }

    pub fn into_parts(self) -> (CredentialResponse, Option<SessionRevocation>) {
        (self.response, self.committed_revocation)
    }
}

impl fmt::Debug for CredentialIssue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CredentialIssue")
            .field("response", &self.response)
            .field("committed_revocation", &self.committed_revocation)
            .finish()
    }
}

/// Family alarm exposes one invariant wire response and a minimum publication
/// instant. Its optional revocation is an internal projection event, never a
/// response fact.
pub struct FamilyAlarmResult {
    response: FamilyAlarmResponse,
    publish_not_before: Instant,
    committed_revocation: Option<SessionRevocation>,
}

impl FamilyAlarmResult {
    pub fn response(&self) -> &FamilyAlarmResponse {
        &self.response
    }

    pub fn publish_not_before(&self) -> Instant {
        self.publish_not_before
    }

    pub fn into_parts(self) -> (FamilyAlarmResponse, Instant, Option<SessionRevocation>) {
        (
            self.response,
            self.publish_not_before,
            self.committed_revocation,
        )
    }
}

impl fmt::Debug for FamilyAlarmResult {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FamilyAlarmResult")
            .field("response", &self.response)
            .field("publish_not_before", &self.publish_not_before)
            .field("committed_effect", &"[OPAQUE]")
            .finish()
    }
}

/// Provider failures may follow a committed revocation (refresh reuse outside
/// grace). The diagnostic and commit fact must travel together until item 5's
/// projection has consumed the latter.
pub struct ProviderError {
    error: SnapbackError,
    committed_revocation: Option<SessionRevocation>,
}

impl ProviderError {
    fn new(error: SnapbackError) -> Self {
        Self {
            error,
            committed_revocation: None,
        }
    }

    #[cfg(test)]
    fn with_committed_revocation(
        error: SnapbackError,
        committed_revocation: SessionRevocation,
    ) -> Self {
        Self {
            error,
            committed_revocation: Some(committed_revocation),
        }
    }

    pub fn diagnostic(&self) -> &crate::diagnostic::Diagnostic {
        &self.error.diagnostic
    }

    pub fn into_parts(self) -> (SnapbackError, Option<SessionRevocation>) {
        (self.error, self.committed_revocation)
    }

    pub fn into_snapback_error(self) -> SnapbackError {
        self.error
    }
}

impl fmt::Debug for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProviderError")
            .field("diagnostic", &self.error.diagnostic)
            .field("committed_revocation", &self.committed_revocation)
            .finish()
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for ProviderError {}

impl From<SnapbackError> for ProviderError {
    fn from(error: SnapbackError) -> Self {
        Self::new(error)
    }
}

pub type ProviderResult<T> = Result<T, ProviderError>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RequestInsertOutcome {
    Inserted,
}

struct SessionCandidate {
    user_id: String,
    identity_id: String,
    session_id: String,
    authority_instance_id: String,
    bearer: Option<SessionBearer>,
    token_hash: TokenHash,
}

impl Drop for SessionCandidate {
    fn drop(&mut self) {
        self.user_id.zeroize();
        self.identity_id.zeroize();
        self.session_id.zeroize();
        self.authority_instance_id.zeroize();
    }
}

impl fmt::Debug for SessionCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionCandidate([REDACTED])")
    }
}

#[cfg(test)]
#[derive(Debug)]
enum ExchangeOutcome {
    Invalid,
    Locked,
    Issued {
        session: SessionResponse,
        committed_revocation: Option<SessionRevocation>,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RejectedExchangeOutcome {
    Invalid,
    Locked,
    PredecessorChanged,
}

struct BearerCandidate {
    bearer: Option<SessionBearer>,
    token_hash: TokenHash,
}

impl fmt::Debug for BearerCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BearerCandidate([REDACTED])")
    }
}

#[cfg(test)]
#[derive(Debug)]
enum RefreshOutcome {
    AuthRequired,
    SessionExpired,
    SupersededInsideGrace,
    ReuseRevoked(SessionRevocation),
    Refreshed(SessionResponse),
}

#[cfg(test)]
#[derive(Debug)]
enum LogoutOutcome {
    AuthRequired,
    SessionExpired,
    CredentialSuperseded,
    Revoked(SessionRevocation),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PlannedTokenSource {
    Current,
    Superseded { superseded_at_ms: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProviderRevocationPlan {
    session_id: String,
    expected_generation: u64,
    presented_digest: TokenDigest,
    source: PlannedTokenSource,
    reason: RevocationReason,
}

impl ProviderRevocationPlan {
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn expected_generation(&self) -> u64 {
        self.expected_generation
    }

    pub(crate) fn reason(&self) -> RevocationReason {
        self.reason
    }

    fn committed_generation(&self) -> SnapbackResult<u64> {
        self.expected_generation
            .checked_add(1)
            .filter(|generation| *generation <= MAX_SAFE_TIMESTAMP)
            .ok_or_else(internal_state_snapback)
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        session_id: String,
        expected_generation: u64,
        presented_digest: TokenDigest,
        source: PlannedTokenSource,
        reason: RevocationReason,
    ) -> Self {
        Self {
            session_id,
            expected_generation,
            presented_digest,
            source,
            reason,
        }
    }
}

pub(crate) struct ProviderTokenRotationPlan {
    session_id: String,
    expected_generation: u64,
    predecessor_digest: TokenDigest,
    successor_digest: TokenDigest,
    superseded_at_ms: u64,
    successor: BearerCandidate,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProviderTokenRotationCommitPlan {
    session_id: String,
    expected_generation: u64,
    predecessor_digest: TokenDigest,
    successor_digest: TokenDigest,
    superseded_at_ms: u64,
}

impl ProviderTokenRotationPlan {
    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn expected_generation(&self) -> u64 {
        self.expected_generation
    }

    pub(crate) fn predecessor_digest(&self) -> TokenDigest {
        self.predecessor_digest
    }

    pub(crate) fn successor_digest(&self) -> TokenDigest {
        self.successor_digest
    }

    pub(crate) fn superseded_at_ms(&self) -> u64 {
        self.superseded_at_ms
    }

    pub(crate) fn commit_plan(&self) -> ProviderTokenRotationCommitPlan {
        ProviderTokenRotationCommitPlan {
            session_id: self.session_id.clone(),
            expected_generation: self.expected_generation,
            predecessor_digest: self.predecessor_digest,
            successor_digest: self.successor_digest,
            superseded_at_ms: self.superseded_at_ms,
        }
    }

    pub(crate) fn into_issue(mut self, session: SessionResponse) -> CredentialIssue {
        let token = self
            .successor
            .bearer
            .take()
            .expect("planned rotation retains plaintext until exact finalize");
        let refresh_after = self
            .superseded_at_ms
            .checked_add(AUTH_SESSION_REFRESH_CADENCE_MS)
            .unwrap_or(MAX_SAFE_TIMESTAMP)
            .min(session.expires_at)
            .min(session.absolute_expires_at);
        CredentialIssue::new(CredentialResponse::new(token, refresh_after, session), None)
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        session_id: String,
        expected_generation: u64,
        predecessor_digest: TokenDigest,
        successor_bearer: SessionBearer,
        superseded_at_ms: u64,
    ) -> Self {
        let successor = BearerCandidate {
            token_hash: successor_bearer.token_hash(),
            bearer: Some(successor_bearer),
        };
        let successor_digest = TokenDigest::from_token_hash(&successor.token_hash);
        Self {
            session_id,
            expected_generation,
            predecessor_digest,
            successor_digest,
            superseded_at_ms,
            successor,
        }
    }
}

impl fmt::Debug for ProviderTokenRotationPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProviderTokenRotationPlan")
            .field("session_id", &self.session_id)
            .field("expected_generation", &self.expected_generation)
            .field("predecessor_digest", &self.predecessor_digest)
            .field("successor_digest", &self.successor_digest)
            .field("superseded_at_ms", &self.superseded_at_ms)
            .field("successor", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlannedLogout {
    AuthRequired,
    SessionExpired,
    CredentialSuperseded,
    Revoke(ProviderRevocationPlan),
}

pub(crate) enum PlannedRefresh {
    AuthRequired,
    SessionExpired,
    SupersededInsideGrace,
    Rotate(ProviderTokenRotationPlan),
    ReuseRevoke(ProviderRevocationPlan),
}

/// Closed family-alarm plan. Even malformed/current/unknown inputs carry a
/// dummy exact-shaped plan into one IMMEDIATE transaction; callers never skip
/// the writer based on whether the preliminary lookup found a tombstone.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProviderFamilyAlarmPlan {
    session_id: String,
    expected_generation: u64,
    presented_digest: TokenDigest,
    superseded_at_ms: u64,
    observed_at_ms: u64,
    actionable: bool,
    publish_not_before: Instant,
}

impl ProviderFamilyAlarmPlan {
    pub(crate) fn revocation_plan(&self) -> Option<ProviderRevocationPlan> {
        self.actionable.then(|| ProviderRevocationPlan {
            session_id: self.session_id.clone(),
            expected_generation: self.expected_generation,
            presented_digest: self.presented_digest,
            source: PlannedTokenSource::Superseded {
                superseded_at_ms: self.superseded_at_ms,
            },
            reason: RevocationReason::FamilyAlarm,
        })
    }

    pub(crate) fn publish_not_before(&self) -> Instant {
        self.publish_not_before
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlannedFamilyAlarmCommit {
    Revoked(SessionRevocation),
    Noop,
    Retry,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlannedRevocationCommit {
    Committed(SessionRevocation),
    AlreadyTerminal {
        generation: u64,
        reason: Option<RevocationReason>,
    },
    PredecessorChanged,
}

pub(crate) enum PlannedRotationCommit {
    Committed { session: SessionResponse },
    CandidateCollision,
    PredecessorChanged,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum PlannedIdentityState {
    Existing {
        identity_id: String,
        user_id: String,
    },
    Create {
        identity_id: String,
        user_id: String,
    },
}

pub(crate) struct ProviderSessionIssuancePlan {
    address: CanonicalAddress,
    now_ms: u64,
    identity: PlannedIdentityState,
    candidate: SessionCandidate,
    projected: ProjectedSessionInsert,
    eviction: Option<ProviderRevocationPlan>,
    challenge: Option<PlannedChallengeConsumption>,
    sender_issuance: Option<crate::auth::sender_proof::SenderIssuanceCommitment>,
}

impl fmt::Debug for ProviderSessionIssuancePlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderSessionIssuancePlan([REDACTED])")
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct ProviderSessionIssuanceCommitPlan {
    address: CanonicalAddress,
    now_ms: u64,
    identity: PlannedIdentityState,
    projected: ProjectedSessionInsert,
    eviction: Option<ProviderRevocationPlan>,
    challenge: Option<PlannedChallengeConsumption>,
    sender_issuance: Option<crate::auth::sender_proof::SenderIssuanceCommitment>,
}

impl fmt::Debug for ProviderSessionIssuanceCommitPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderSessionIssuanceCommitPlan([REDACTED])")
    }
}

impl ProviderSessionIssuancePlan {
    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4's first layer: a
    // sender-bound issuance re-mints its candidate bearer in the versioned
    // `sbs2_` spelling before anything derives from the plan (binding runs
    // before premark and before the commit plan is taken), so the projected
    // digest, the durable row, and the returned credential all name the
    // legacy-rejecting spelling.
    pub(crate) fn bind_sender_issuance(
        &mut self,
        commitment: crate::auth::sender_proof::SenderIssuanceCommitment,
        random: &dyn RandomSource,
    ) -> ProviderResult<()> {
        if self.sender_issuance.replace(commitment).is_some() {
            return Err(provider_unavailable());
        }
        let bearer = SessionBearer::generate_sender_v2(random).map_err(|_| provider_unavailable())?;
        let token_hash = bearer.token_hash();
        self.projected.token_digest = TokenDigest::from_token_hash(&token_hash);
        self.candidate.bearer = Some(bearer);
        self.candidate.token_hash = token_hash;
        Ok(())
    }

    pub(crate) fn projected_insert(&self) -> ProjectedSessionInsert {
        self.projected.clone()
    }

    pub(crate) fn eviction(&self) -> Option<&ProviderRevocationPlan> {
        self.eviction.as_ref()
    }

    pub(crate) fn commit_plan(&self) -> ProviderSessionIssuanceCommitPlan {
        ProviderSessionIssuanceCommitPlan {
            address: self.address.clone(),
            now_ms: self.now_ms,
            identity: self.identity.clone(),
            projected: self.projected.clone(),
            eviction: self.eviction.clone(),
            challenge: self.challenge.clone(),
            sender_issuance: self.sender_issuance.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(projected: ProjectedSessionInsert, bearer: SessionBearer) -> Self {
        let token_hash = bearer.token_hash();
        assert_eq!(
            projected.token_digest,
            TokenDigest::from_token_hash(&token_hash),
            "test issuance projection must name its candidate bearer"
        );
        let identity_id = uuid::Uuid::from_u128(0x100).to_string();
        let candidate = SessionCandidate {
            user_id: projected.user_id.clone(),
            identity_id: identity_id.clone(),
            session_id: projected.session_id.clone(),
            authority_instance_id: projected.authority_instance_id.clone(),
            bearer: Some(bearer),
            token_hash,
        };
        Self {
            address: CanonicalAddress::parse("issuance-test@example.com")
                .expect("fixed issuance test address"),
            now_ms: projected.created_at_ms,
            identity: PlannedIdentityState::Existing {
                identity_id,
                user_id: projected.user_id.clone(),
            },
            candidate,
            projected,
            eviction: None,
            challenge: None,
            sender_issuance: None,
        }
    }

    pub(crate) fn into_issue(
        mut self,
        session: SessionResponse,
        committed_revocation: Option<SessionRevocation>,
    ) -> CredentialIssue {
        let bearer = self
            .candidate
            .bearer
            .take()
            .expect("planned issuance retains plaintext until projection finalize");
        let refresh_after = self
            .now_ms
            .checked_add(AUTH_SESSION_REFRESH_CADENCE_MS)
            .unwrap_or(MAX_SAFE_TIMESTAMP)
            .min(session.expires_at)
            .min(session.absolute_expires_at);
        CredentialIssue::new(
            CredentialResponse::new(bearer, refresh_after, session),
            committed_revocation,
        )
    }
}

#[derive(Clone, Debug)]
pub(crate) enum PlannedIssuanceCommit {
    Committed {
        session: SessionResponse,
        committed_revocation: Option<SessionRevocation>,
    },
    CodeInvalid,
    CodeLocked,
    // @ref LLP 0077#issuance-refresh-and-recovery — one live family per
    // thumbprint: a valid proof over an already-bound key consumes its proof
    // id and refuses without touching the challenge, session, or nonce state.
    SenderKeyBound,
    CandidateCollision,
    PredecessorChanged,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RejectedExchangeCommit {
    PredecessorChanged,
}

#[derive(Clone, Eq, PartialEq)]
struct PlannedChallengeConsumption {
    challenge_id: String,
    key_id: String,
    code_digest: [u8; 32],
    expected_attempts: u32,
    max_attempts: u32,
    expires_at_ms: u64,
}

impl fmt::Debug for PlannedChallengeConsumption {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PlannedChallengeConsumption([REDACTED])")
    }
}

// The issue variant intentionally owns the complete secret-bearing plan until
// the coordinator commits or rejects it. Boxing would add an allocation and
// obscure that short-lived ownership boundary solely to shrink the reject
// representation.
#[allow(clippy::large_enum_variant)]
pub(crate) enum PlannedExchange {
    Reject,
    Issue(ProviderSessionIssuancePlan),
}

pub struct AuthProvider {
    profile: AuthProviderProfile,
    keyring: Arc<AuthKeyringStore>,
    mailbox: CaptureMailbox,
    random: Arc<dyn RandomSource>,
    clock: Arc<dyn AuthClock>,
    /// Process-local non-decreasing epoch floor. Every `now_ms()` read is
    /// clamped up to it, so a backward wall-clock move can never lower the
    /// epoch any auth lifetime decision observes. Startup seeds it from the
    /// durable floor and maintenance persists its forward progress.
    ///
    /// @ref LLP 0059#durable-session-clock-floor
    session_clock_floor_ms: AtomicU64,
    dummy_key: AuthKeyMaterial,
    dummy_address: CanonicalAddress,
    dummy_token_hash: TokenHash,
    maintenance: Arc<AsyncRwLock<()>>,
    address_stripes: Vec<Arc<AsyncMutex<()>>>,
    address_hasher: RandomState,
}

impl fmt::Debug for AuthProvider {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthProvider")
            .field("profile", &self.profile)
            .field("keyring", &"[REDACTED]")
            .field("dummy_key", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

impl AuthProvider {
    pub fn new(
        profile: AuthProviderProfile,
        keyring: Arc<AuthKeyringStore>,
    ) -> ProviderResult<Self> {
        Self::new_with_dependencies(
            profile,
            keyring,
            Arc::new(OsRandom),
            Arc::new(SystemAuthClock),
        )
    }

    pub fn new_with_dependencies(
        profile: AuthProviderProfile,
        keyring: Arc<AuthKeyringStore>,
        random: Arc<dyn RandomSource>,
        clock: Arc<dyn AuthClock>,
    ) -> ProviderResult<Self> {
        let dummy_key =
            AuthKeyMaterial::generate(random.as_ref()).map_err(|_| provider_unavailable())?;
        let dummy_address = CanonicalAddress::parse("invalid@snapback.invalid")
            .expect("the fixed dummy auth address is valid");
        let dummy_bearer =
            SessionBearer::generate(random.as_ref()).map_err(|_| provider_unavailable())?;
        let dummy_token_hash = dummy_bearer.token_hash();
        let mailbox_clock = clock.clone();
        let mailbox =
            CaptureMailbox::new_with_clock(Arc::new(move || mailbox_clock.monotonic_now()));
        Ok(Self {
            profile,
            keyring,
            mailbox,
            random,
            clock,
            session_clock_floor_ms: AtomicU64::new(0),
            dummy_key,
            dummy_address,
            dummy_token_hash,
            maintenance: Arc::new(AsyncRwLock::new(())),
            address_stripes: (0..AUTH_ADDRESS_STRIPES)
                .map(|_| Arc::new(AsyncMutex::new(())))
                .collect(),
            address_hasher: RandomState::new(),
        })
    }

    pub fn profile(&self) -> AuthProviderProfile {
        self.profile
    }

    /// CSPRNG dependency shared with the agent-secret storage transactions.
    /// The returned boundary can mint only typed, zeroizing secret wrappers;
    /// callers never receive raw random bytes or provider key material.
    pub(crate) fn agent_random_source(&self) -> &dyn RandomSource {
        self.random.as_ref()
    }

    /// Sample the wall clock clamped up to the process-local floor. The
    /// returned epoch is non-decreasing for the life of the process and never
    /// below the durable floor seeded at startup, so no auth lifetime decision
    /// (session sliding/absolute expiry, superseded-token grace, provider and
    /// challenge deadlines) can observe a rolled-back time.
    ///
    /// @ref LLP 0059#durable-session-clock-floor — time cannot roll back into
    /// a live session; a backward wall move only ever fails closed.
    pub fn now_ms(&self) -> u64 {
        let sample = self.clock.epoch_ms();
        // fetch_max returns the previous value; the observed epoch is the max
        // of that and the fresh sample.
        let previous = self
            .session_clock_floor_ms
            .fetch_max(sample, Ordering::AcqRel);
        previous.max(sample)
    }

    /// Raise the process-local clock floor to at least `floor_ms`. Startup
    /// calls this with the durable floor so request-time reads never sample
    /// below authority the previous process already terminalized.
    ///
    /// @ref LLP 0059#durable-session-clock-floor
    pub(crate) fn seed_session_clock_floor(&self, floor_ms: u64) {
        self.session_clock_floor_ms
            .fetch_max(floor_ms, Ordering::AcqRel);
    }

    pub(crate) fn monotonic_now(&self) -> Instant {
        self.clock.monotonic_now()
    }

    /// Authenticate one already-durably-reserved invalidation boot issuer
    /// while the active protocol key remains under the keyring lock.
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — listener
    /// bind is refused unless the reserved issuer can be authenticated with a
    /// stable protocol key.
    pub(crate) fn authenticate_invalidation_boot_issuer(
        &self,
        issuer_id: crate::auth::invalidation::IssuerId,
        target_profile_id: &str,
        app_id: &str,
    ) -> ProviderResult<crate::auth::invalidation::LiveInvalidationIssuer> {
        self.keyring
            .with_active_key(self.now_ms(), self.random.as_ref(), |key_id, key| {
                crate::auth::invalidation::IssuerAuthenticator::new(
                    key_id.as_str(),
                    *key.expose_secret(),
                )
                .and_then(|authenticator| {
                    let authenticated =
                        authenticator.authenticate(issuer_id, target_profile_id, app_id)?;
                    crate::auth::invalidation::LiveInvalidationIssuer::with_authenticator(
                        authenticated,
                        authenticator,
                        target_profile_id,
                        app_id,
                    )
                })
            })
            .map_err(|_| provider_unavailable())?
            .map_err(|_| provider_unavailable())
    }

    /// Issue an authorization lease with the same persistent owner-only
    /// protocol keyring as invalidation, under a distinct MAC domain.  The
    /// caller supplies the single server-time sample later committed with the
    /// reservation so query, expiry, and rollback checks cannot disagree.
    ///
    /// @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
    /// lease keys rotate persistently and old keys remain verify-only for the
    /// full maximum lease lifetime.
    pub(crate) fn issue_authorized_lease_at(
        &self,
        issue: AuthorizedLeaseIssue,
        config: AuthorizedLeaseConfig,
        now_ms: u64,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<AuthorizedLease> {
        self.keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                AuthorizedLeaseAuthenticator::new(key_id, key).issue(
                    issue,
                    config,
                    now_ms,
                    target_profile_id,
                    app_id,
                )
            })
            .map_err(|_| authorized_lease_key_unavailable())?
    }

    /// Verify a lease with its named active or retired key.  Missing/corrupt
    /// key state is an availability failure, never permission to fall back to
    /// ambient session authority.
    // Staged until a server service accepts a presented AuthorizedLease. Keep
    // this keyring path distinct from issuance so the service must supply its
    // own complete expectation rather than trusting a self-described lease.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn verify_authorized_lease_at(
        &self,
        lease: &AuthorizedLease,
        expectation: &AuthorizedLeaseExpectation,
        config: AuthorizedLeaseConfig,
        now_ms: u64,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<VerifiedAuthorizedLease> {
        lease.validate_shape(config)?;
        let key_id = AuthKeyId::parse(&lease.key_id).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTHORIZED_LEASE_INVALID",
                "auth",
                "authorized lease key id is invalid",
            )
        })?;
        self.keyring
            .with_key(&key_id, |key| {
                AuthorizedLeaseAuthenticator::new(&key_id, key).verify_for_service(
                    lease,
                    expectation,
                    config,
                    now_ms,
                    target_profile_id,
                    app_id,
                )
            })
            .map_err(|_| authorized_lease_key_unavailable())?
    }

    /// Closed, non-secret health fact. Session-digest resolution deliberately
    /// does not consult this state and remains usable when provider issuance is
    /// unavailable.
    pub fn readiness(&self) -> AuthProviderReadiness {
        match self.keyring.load_existing() {
            Ok(_) => AuthProviderReadiness::Available,
            Err(_) => AuthProviderReadiness::Unavailable,
        }
    }

    pub async fn admit(self: &Arc<Self>) -> AuthAdmission {
        let maintenance = self.maintenance.clone().read_owned().await;
        AuthAdmission {
            provider: self.clone(),
            _maintenance: maintenance,
        }
    }

    pub async fn admit_email(self: &Arc<Self>, email: &str) -> ProviderResult<AddressAdmission> {
        let address = CanonicalAddress::parse(email).map_err(|_| request_invalid())?;
        self.admit().await.for_address(address).await
    }

    pub async fn exclusive_maintenance(self: &Arc<Self>) -> AuthMaintenanceGuard {
        let maintenance = self.maintenance.clone().write_owned().await;
        AuthMaintenanceGuard {
            provider: self.clone(),
            _maintenance: maintenance,
        }
    }

    /// Complete mailbox GET choreography: shared maintenance, first map peek,
    /// address stripe, then map re-read. HTTP never receives either lock.
    pub async fn mailbox_entry(
        self: &Arc<Self>,
        challenge_id: &str,
    ) -> ProviderResult<MailboxResponse> {
        let challenge_id = ChallengeId::parse(challenge_id).map_err(|_| request_invalid())?;
        let admission = self.admit().await;
        let peek = self
            .mailbox
            .peek_address(&challenge_id)
            .ok_or_else(mailbox_entry_not_found)?;
        let address = peek.canonical_address().clone();
        let admission = admission.for_address(address).await?;
        self.mailbox
            .with_published(&challenge_id, admission.address(), |view| {
                VerificationCode::parse(view.code).map(|code| {
                    MailboxResponse::new(
                        view.challenge_id.as_str().to_owned(),
                        view.canonical_address.as_str().to_owned(),
                        code,
                        view.expires_at_ms,
                    )
                })
            })
            .transpose()
            .map_err(|_| provider_unavailable())?
            .ok_or_else(mailbox_entry_not_found)
    }

    fn stripe(&self, address: &CanonicalAddress) -> Arc<AsyncMutex<()>> {
        let mut hasher = self.address_hasher.build_hasher();
        hasher.write(address.as_str().as_bytes());
        let index = (hasher.finish() as usize) & (AUTH_ADDRESS_STRIPES - 1);
        self.address_stripes[index].clone()
    }
}

/// Shared-maintenance admission acquired before the outer app-instance lock.
pub struct AuthAdmission {
    provider: Arc<AuthProvider>,
    _maintenance: OwnedRwLockReadGuard<()>,
}

impl fmt::Debug for AuthAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthAdmission(..)")
    }
}

impl AuthAdmission {
    /// Resolve the human delivery address from the exact still-live session.
    /// The caller keeps this maintenance admission while acquiring the
    /// resulting address stripe, preserving the provider lock order.
    pub(crate) fn step_up_address(
        &self,
        database: &LocalDatabase,
        binding: &StepUpBinding,
        now_ms: u64,
    ) -> ProviderResult<CanonicalAddress> {
        validate_now(now_ms)?;
        let address = database
            .with_auth_read(|connection| {
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
                    .map_err(SnapbackError::from)
            })
            .map_err(|_| provider_unavailable())?
            .ok_or_else(auth_required)?;
        CanonicalAddress::parse(&address).map_err(|_| provider_unavailable())
    }

    /// First proof pass selects only the address stripe and digest key. The
    /// protected writer transaction remains the authorization point.
    pub(crate) fn step_up_coordination(
        &self,
        database: &LocalDatabase,
        challenge_id: &str,
    ) -> ProviderResult<StepUpCoordination> {
        let challenge_id = ChallengeId::parse(challenge_id).map_err(|_| request_invalid())?;
        let row = database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT canonical_address, key_id
                         FROM _auth_verification_codes WHERE challenge_id = ?1",
                        params![challenge_id.as_str()],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()
                    .map_err(SnapbackError::from)
            })
            .map_err(|_| provider_unavailable())?;
        match row {
            Some((address, key_id)) => Ok(StepUpCoordination {
                challenge_id,
                address: CanonicalAddress::parse(&address).map_err(|_| provider_unavailable())?,
                key_id: Some(AuthKeyId::parse(&key_id).map_err(|_| provider_unavailable())?),
            }),
            None => Ok(StepUpCoordination {
                challenge_id,
                address: self.provider.dummy_address.clone(),
                key_id: None,
            }),
        }
    }

    pub(crate) async fn for_step_up(
        self,
        coordination: StepUpCoordination,
        binding: StepUpBinding,
        code: &str,
    ) -> ProviderResult<StepUpProofAdmission> {
        let code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        let submitted_digest = match coordination.key_id.as_ref() {
            Some(key_id) => self
                .provider
                .keyring
                .with_key(key_id, |key| {
                    StepUpDigest::compute(
                        key,
                        &coordination.challenge_id,
                        &coordination.address,
                        &binding.user_id,
                        &binding.session_id,
                        binding.session_generation,
                        &binding.authority_instance_id,
                        binding.operation,
                        &binding.target_id,
                        &code,
                    )
                })
                .map_err(|_| provider_unavailable())?,
            None => StepUpDigest::compute(
                &self.provider.dummy_key,
                &coordination.challenge_id,
                &coordination.address,
                &binding.user_id,
                &binding.session_id,
                binding.session_generation,
                &binding.authority_instance_id,
                binding.operation,
                &binding.target_id,
                &code,
            ),
        };
        let stripe = self
            .provider
            .stripe(&coordination.address)
            .lock_owned()
            .await;
        Ok(StepUpProofAdmission {
            _admission: self,
            _stripe: stripe,
            proof: StepUpProof {
                challenge_id: coordination.challenge_id,
                address: coordination.address,
                key_id: coordination.key_id,
                submitted_digest,
            },
        })
    }

    /// First exchange pass. A missing row deliberately returns `None`; the
    /// caller must still run `exchange_unknown` so unknown ids take a writer
    /// transaction and one HMAC just like terminal known challenges.
    pub fn exchange_coordination(
        &self,
        database: &LocalDatabase,
        challenge_id: &str,
    ) -> ProviderResult<Option<ExchangeCoordination>> {
        let challenge_id = ChallengeId::parse(challenge_id).map_err(|_| request_invalid())?;
        database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT canonical_address, key_id
                         FROM _auth_verification_codes
                         WHERE challenge_id = ?1",
                        params![challenge_id.as_str()],
                        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                    )
                    .optional()
                    .map_err(SnapbackError::from)
            })
            .map_err(|_| provider_unavailable())?
            .map(|(address, key_id)| {
                Ok(ExchangeCoordination {
                    challenge_id,
                    address: CanonicalAddress::parse(&address)
                        .map_err(|_| provider_unavailable())?,
                    key_id: AuthKeyId::parse(&key_id).map_err(|_| provider_unavailable())?,
                })
            })
            .transpose()
    }

    /// Uniform absent/deleted-row exchange path. It intentionally enters one
    /// writer transaction and performs one HMAC before returning `CODE_INVALID`.
    pub(crate) fn exchange_unknown(
        &self,
        database: &mut LocalDatabase,
        challenge_id: &str,
        code: &str,
        now_ms: u64,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> ProviderResult<CredentialIssue> {
        validate_now(now_ms)?;
        let challenge_id = ChallengeId::parse(challenge_id).map_err(|_| request_invalid())?;
        let code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        self.provider
            .keyring
            .load_existing()
            .map_err(|_| provider_unavailable())?;
        database
            .with_auth_transaction(|transaction| {
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
                let digest = CodeDigest::compute(
                    &self.provider.dummy_key,
                    &challenge_id,
                    &self.provider.dummy_address,
                    &code,
                );
                let _ = digest.verify(&[0_u8; 32]);
                Ok(())
            })
            .map_err(|_| provider_unavailable())?;
        Err(code_invalid())
    }

    /// Resolve an ordinary session bearer current-first, then through retained
    /// predecessor tombstones. This is read-only; callers separately invoke
    /// `record_authenticated_use` after the authenticated operation succeeds.
    pub fn resolve_session(
        &self,
        database: &LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<ResolvedSession> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let token_hash = bearer.token_hash();
        let lookup = database
            .with_auth_read(|connection| lookup_presented_session(connection, &token_hash))
            .map_err(|_| provider_unavailable())?;
        resolve_ordinary_lookup(lookup, now_ms)
    }

    /// Read and validate every logout precondition without mutating durable or
    /// projected state. The caller releases its database guard, installs the
    /// returned plan in `AuthCoordinator`, then re-enters through
    /// `commit_planned_revocation`.
    pub(crate) fn plan_logout(
        &self,
        database: &LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<PlannedLogout> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let token_hash = bearer.token_hash();
        let digest = TokenDigest::from_token_hash(&token_hash);
        let lookup = database
            .with_auth_read(|connection| lookup_presented_session(connection, &token_hash))
            .map_err(|_| provider_unavailable())?;
        Ok(match lookup {
            PresentedSessionLookup::Unknown => PlannedLogout::AuthRequired,
            PresentedSessionLookup::Current(session) => {
                if !session.live_at(now_ms) {
                    PlannedLogout::SessionExpired
                } else {
                    PlannedLogout::Revoke(revocation_plan(
                        &session,
                        digest,
                        PlannedTokenSource::Current,
                        RevocationReason::Logout,
                    ))
                }
            }
            PresentedSessionLookup::Tombstone {
                session,
                superseded_at_ms,
            } => {
                if !session.live_at(now_ms) {
                    PlannedLogout::SessionExpired
                } else if now_ms
                    .checked_sub(superseded_at_ms)
                    .ok_or_else(provider_unavailable)?
                    > AUTH_SESSION_SUPERSESSION_GRACE_MS
                {
                    PlannedLogout::CredentialSuperseded
                } else {
                    PlannedLogout::Revoke(revocation_plan(
                        &session,
                        digest,
                        PlannedTokenSource::Superseded { superseded_at_ms },
                        RevocationReason::Logout,
                    ))
                }
            }
        })
    }

    pub(crate) fn plan_refresh(
        &self,
        database: &LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<PlannedRefresh> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let token_hash = bearer.token_hash();
        let digest = TokenDigest::from_token_hash(&token_hash);
        let (lookup, sender_bound) = database
            .with_auth_read(|connection| {
                let lookup = lookup_presented_session(connection, &token_hash)?;
                // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: the durable
                // family binding (not the presented spelling) selects the
                // successor spelling, so every successor of a sender-bound
                // family stays `sbs2_`.
                let sender_bound = crate::auth::sender_proof::presented_token_has_sender_family_binding(
                    connection,
                    token_hash.as_bytes(),
                )
                .map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                        "auth",
                        "sender family binding state is unavailable",
                    )
                })?;
                Ok((lookup, sender_bound))
            })
            .map_err(|_| provider_unavailable())?;
        Ok(match lookup {
            PresentedSessionLookup::Unknown => PlannedRefresh::AuthRequired,
            PresentedSessionLookup::Current(session) => {
                if !session.live_at(now_ms) {
                    PlannedRefresh::SessionExpired
                } else {
                    let successor = if sender_bound {
                        BearerCandidate::generate_sender_v2(&self.provider)?
                    } else {
                        BearerCandidate::generate(&self.provider)?
                    };
                    let successor_digest = TokenDigest::from_token_hash(&successor.token_hash);
                    PlannedRefresh::Rotate(ProviderTokenRotationPlan {
                        session_id: session.session.session_id,
                        expected_generation: session.session.generation,
                        predecessor_digest: digest,
                        successor_digest,
                        superseded_at_ms: now_ms,
                        successor,
                    })
                }
            }
            PresentedSessionLookup::Tombstone {
                session,
                superseded_at_ms,
            } => {
                if !session.live_at(now_ms) {
                    PlannedRefresh::SessionExpired
                } else if now_ms
                    .checked_sub(superseded_at_ms)
                    .ok_or_else(provider_unavailable)?
                    <= AUTH_SESSION_SUPERSESSION_GRACE_MS
                {
                    PlannedRefresh::SupersededInsideGrace
                } else {
                    PlannedRefresh::ReuseRevoke(revocation_plan(
                        &session,
                        digest,
                        PlannedTokenSource::Superseded { superseded_at_ms },
                        RevocationReason::RefreshReuse,
                    ))
                }
            }
        })
    }

    pub(crate) fn plan_family_alarm(
        &self,
        database: &LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<ProviderFamilyAlarmPlan> {
        validate_now(now_ms)?;
        let started_at = self.provider.clock.monotonic_now();
        let jitter_ms = uniform_alarm_jitter(self.provider.random.as_ref())?;
        let publish_not_before = minimum_alarm_deadline(started_at, jitter_ms)?;
        let parsed = SessionBearer::parse_any_version(bearer).ok();
        let token_hash = parsed
            .as_ref()
            .map(SessionBearer::token_hash)
            .unwrap_or_else(|| TokenHash::from_bytes(*self.provider.dummy_token_hash.as_bytes()));
        let digest = TokenDigest::from_token_hash(&token_hash);
        let lookup = database
            .with_auth_read(|connection| lookup_presented_session(connection, &token_hash))
            .map_err(|_| provider_unavailable())?;
        Ok(match lookup {
            PresentedSessionLookup::Tombstone {
                session,
                superseded_at_ms,
            } if parsed.is_some() && session.live_at(now_ms) => ProviderFamilyAlarmPlan {
                session_id: session.session.session_id,
                expected_generation: session.session.generation,
                presented_digest: digest,
                superseded_at_ms,
                observed_at_ms: now_ms,
                actionable: true,
                publish_not_before,
            },
            _ => ProviderFamilyAlarmPlan {
                // This canonical value is process-independent but cannot be a
                // provider-minted UUIDv7 session id. It still drives the same
                // statement bindings and exact row-count checks.
                session_id: Uuid::nil().to_string(),
                expected_generation: 1,
                presented_digest: digest,
                superseded_at_ms: 0,
                observed_at_ms: now_ms,
                actionable: false,
                publish_not_before,
            },
        })
    }

    pub(crate) fn commit_planned_family_alarm(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderFamilyAlarmPlan,
    ) -> AuthTransactionAttempt<PlannedFamilyAlarmCommit> {
        let attempt = database.attempt_auth_transaction(|transaction| {
            planned_family_alarm_transaction(transaction, plan)
        });
        let AuthTransactionAttempt::CommitUncertain(error) = attempt else {
            return attempt;
        };
        let Some(revocation) = plan.revocation_plan() else {
            // The dummy statement cannot match a provider-minted session. An
            // ambiguous SQLite commit still ran the fixed writer shape, and
            // no authority successor exists to publish.
            return AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop);
        };
        match database.with_auth_read(|connection| {
            reconcile_planned_revocation(connection, &revocation, plan.observed_at_ms)
        }) {
            Ok(DurableRevocationReconcile::ExactSuccessor(revocation)) => {
                AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(revocation))
            }
            Ok(DurableRevocationReconcile::ExactPredecessor) => {
                AuthTransactionAttempt::RolledBack(error)
            }
            Ok(DurableRevocationReconcile::DifferentValid) => {
                AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Retry)
            }
            Err(_) => AuthTransactionAttempt::CommitUncertain(error),
        }
    }

    /// Enter the SQLite lane with only immutable CAS inputs. The projection
    /// ticket itself is opaque to this function and no topology/fence lock is
    /// held across the transaction.
    pub(crate) fn commit_planned_revocation(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderRevocationPlan,
        now_ms: u64,
    ) -> AuthTransactionAttempt<PlannedRevocationCommit> {
        if let Err(error) = validate_now(now_ms) {
            return AuthTransactionAttempt::RolledBack(error.into_snapback_error());
        }
        let attempt = database.attempt_auth_transaction(|transaction| {
            planned_revocation_transaction(transaction, plan, now_ms)
        });
        let AuthTransactionAttempt::CommitUncertain(commit_error) = attempt else {
            return attempt;
        };
        // The connection is no longer inside the ambiguous transaction. Read
        // the exact predecessor/successor facts before deciding whether the
        // coordinator may unmark or finalize its ticket.
        match database
            .with_auth_read(|connection| reconcile_planned_revocation(connection, plan, now_ms))
        {
            Ok(DurableRevocationReconcile::ExactPredecessor) => {
                AuthTransactionAttempt::RolledBack(commit_error)
            }
            Ok(DurableRevocationReconcile::ExactSuccessor(revocation)) => {
                AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(revocation))
            }
            Ok(DurableRevocationReconcile::DifferentValid) => {
                AuthTransactionAttempt::Committed(PlannedRevocationCommit::PredecessorChanged)
            }
            Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
        }
    }

    pub(crate) fn commit_planned_rotation(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderTokenRotationCommitPlan,
    ) -> AuthTransactionAttempt<PlannedRotationCommit> {
        if let Err(error) = validate_now(plan.superseded_at_ms) {
            return AuthTransactionAttempt::RolledBack(error.into_snapback_error());
        }
        let mut body_outcome = None;
        let attempt = database.attempt_auth_transaction(|transaction| {
            let outcome = planned_rotation_transaction(transaction, plan)?;
            body_outcome = Some(outcome.clone());
            Ok(outcome)
        });
        match attempt {
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::CandidateCollision) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::CandidateCollision)
            }
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::PredecessorChanged) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::Refreshed(session)) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session })
            }
            AuthTransactionAttempt::RolledBack(error) => AuthTransactionAttempt::RolledBack(error),
            AuthTransactionAttempt::CommitUncertain(error) => {
                if matches!(
                    body_outcome,
                    Some(PlannedRotationTransaction::CandidateCollision)
                ) {
                    // Candidate collision is detected before any write. A lost
                    // read-only COMMIT acknowledgement cannot have changed
                    // durable authority, so the coordinator may exact-unmark
                    // and let the route spend its next bounded candidate.
                    return AuthTransactionAttempt::Committed(
                        PlannedRotationCommit::CandidateCollision,
                    );
                }
                match database
                    .with_auth_read(|connection| reconcile_planned_rotation(connection, plan))
                {
                    Ok(DurableRotationReconcile::ExactPredecessor) => {
                        AuthTransactionAttempt::RolledBack(error)
                    }
                    Ok(DurableRotationReconcile::ExactSuccessor(session)) => {
                        AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                            session,
                        })
                    }
                    Ok(DurableRotationReconcile::DifferentValid) => {
                        AuthTransactionAttempt::Committed(PlannedRotationCommit::PredecessorChanged)
                    }
                    Err(_) => AuthTransactionAttempt::CommitUncertain(error),
                }
            }
        }
    }

    /// Rotate a current bearer, or apply the exact predecessor-reuse matrix.
    /// A reuse revocation is returned inside `ProviderError` because its
    /// `SESSION_EXPIRED` response follows a committed family mutation.
    #[cfg(test)]
    pub fn refresh(
        &self,
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let predecessor_hash = bearer.token_hash();
        // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: successors of a
        // sender-bound family stay `sbs2_`, selected by the durable binding.
        let sender_bound = database
            .with_auth_read(|connection| {
                crate::auth::sender_proof::presented_token_has_sender_family_binding(
                    connection,
                    predecessor_hash.as_bytes(),
                )
                .map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                        "auth",
                        "sender family binding state is unavailable",
                    )
                })
            })
            .map_err(|_| provider_unavailable())?;
        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            let mut successor = if sender_bound {
                BearerCandidate::generate_sender_v2(&self.provider)?
            } else {
                BearerCandidate::generate(&self.provider)?
            };
            let outcome = database.with_auth_transaction(|transaction| {
                refresh_transaction(
                    transaction,
                    &predecessor_hash,
                    &successor.token_hash,
                    now_ms,
                )
            });
            match outcome {
                Ok(RefreshOutcome::AuthRequired) => return Err(auth_required()),
                Ok(RefreshOutcome::SessionExpired) => return Err(session_expired()),
                Ok(RefreshOutcome::SupersededInsideGrace) => {
                    return Err(refresh_superseded());
                }
                Ok(RefreshOutcome::ReuseRevoked(revocation)) => {
                    return Err(ProviderError::with_committed_revocation(
                        session_revoked().into_snapback_error(),
                        revocation,
                    ));
                }
                Ok(RefreshOutcome::Refreshed(session)) => {
                    let token = successor.bearer.take().ok_or_else(provider_unavailable)?;
                    let refresh_after = now_ms
                        .checked_add(AUTH_SESSION_REFRESH_CADENCE_MS)
                        .unwrap_or(MAX_SAFE_TIMESTAMP)
                        .min(session.expires_at)
                        .min(session.absolute_expires_at);
                    return Ok(CredentialIssue::new(
                        CredentialResponse::new(token, refresh_after, session),
                        None,
                    ));
                }
                Err(error) if error.diagnostic.code == INTERNAL_AUTH_COLLISION => continue,
                Err(_) => return Err(provider_unavailable()),
            }
        }
        Err(provider_unavailable())
    }

    /// Revoke the family resolved by the presented current or in-grace bearer.
    #[cfg(test)]
    pub fn logout(
        &self,
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<SessionRevocation> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse_any_version(bearer).map_err(|_| auth_required())?;
        let token_hash = bearer.token_hash();
        let outcome = database
            .with_auth_transaction(|transaction| {
                logout_transaction(transaction, &token_hash, now_ms)
            })
            .map_err(|_| provider_unavailable())?;
        match outcome {
            LogoutOutcome::AuthRequired => Err(auth_required()),
            LogoutOutcome::SessionExpired => Err(session_expired()),
            LogoutOutcome::CredentialSuperseded => Err(credential_superseded()),
            LogoutOutcome::Revoked(revocation) => Ok(revocation),
        }
    }

    /// Opaque revoke-only family alarm. Malformed inputs use the process-local
    /// dummy digest but execute the same transaction and SQL statement shape.
    #[cfg(test)]
    pub fn family_alarm(
        &self,
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<FamilyAlarmResult> {
        validate_now(now_ms)?;
        let started_at = self.provider.clock.monotonic_now();
        let jitter_ms = uniform_alarm_jitter(self.provider.random.as_ref())?;
        let publish_not_before = minimum_alarm_deadline(started_at, jitter_ms)?;
        let parsed = SessionBearer::parse_any_version(bearer).ok();
        let parsed_hash = parsed.as_ref().map(SessionBearer::token_hash);
        let token_hash = parsed_hash
            .as_ref()
            .unwrap_or(&self.provider.dummy_token_hash);
        let committed_revocation = database
            .with_auth_transaction(|transaction| {
                family_alarm_transaction(transaction, token_hash, now_ms)
            })
            .map_err(|_| provider_unavailable())?;
        Ok(FamilyAlarmResult {
            response: FamilyAlarmResponse::default(),
            publish_not_before,
            committed_revocation,
        })
    }

    /// Coalesced sliding-expiry mutation. The initial read proves the common
    /// path needs no writer transaction at all.
    pub fn record_authenticated_use(
        &self,
        database: &mut LocalDatabase,
        session_id: &str,
        expected_generation: u64,
        now_ms: u64,
    ) -> ProviderResult<AuthenticatedUse> {
        validate_now(now_ms)?;
        let preliminary = database
            .with_auth_read(|connection| {
                authenticated_use_row(connection, session_id, expected_generation)
            })
            .map_err(|_| provider_unavailable())?;
        let Some(preliminary) = preliminary else {
            return Ok(AuthenticatedUse::NotLive);
        };
        if !preliminary.live_at(now_ms) {
            return Ok(AuthenticatedUse::NotLive);
        }
        if now_ms.saturating_sub(preliminary.last_used_at_ms) < AUTH_SESSION_USE_COALESCE_MS {
            return Ok(AuthenticatedUse::Unchanged {
                expires_at_ms: preliminary.expires_at_ms,
            });
        }
        database
            .with_auth_transaction(|transaction| {
                record_authenticated_use_transaction(
                    transaction,
                    session_id,
                    expected_generation,
                    now_ms,
                )
            })
            .map_err(|_| provider_unavailable())
    }

    pub async fn for_exchange(
        self,
        coordination: ExchangeCoordination,
    ) -> ProviderResult<ExchangeAdmission> {
        let stripe = self
            .provider
            .stripe(&coordination.address)
            .lock_owned()
            .await;
        Ok(ExchangeAdmission {
            admission: self,
            coordination,
            _stripe: stripe,
        })
    }

    pub async fn for_address(self, address: CanonicalAddress) -> ProviderResult<AddressAdmission> {
        let stripe = self.provider.stripe(&address).lock_owned().await;
        Ok(AddressAdmission {
            admission: self,
            address,
            _stripe: stripe,
        })
    }
}

/// Exchange admission retains the preliminary row solely for lock/key
/// selection. Authorization comes only from the rechecked transaction.
pub struct ExchangeAdmission {
    admission: AuthAdmission,
    coordination: ExchangeCoordination,
    _stripe: OwnedMutexGuard<()>,
}

impl fmt::Debug for ExchangeAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ExchangeAdmission([REDACTED])")
    }
}

impl ExchangeAdmission {
    /// Immutable lock-selection facts that may cross the projection Begin
    /// boundary. The guard-bearing admission itself must be dropped first and
    /// reacquired from these facts for the later exact durable CAS.
    pub(crate) fn reacquisition_key(&self) -> ExchangeCoordination {
        self.coordination.clone()
    }

    pub(crate) fn plan_exchange(
        &self,
        database: &LocalDatabase,
        code: &str,
        now_ms: u64,
    ) -> ProviderResult<PlannedExchange> {
        validate_now(now_ms)?;
        let code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        let provider = &self.admission.provider;
        provider
            .keyring
            .with_key(&self.coordination.key_id, |key| {
                database.with_auth_read(|connection| {
                    plan_exchange_read(connection, provider, &self.coordination, key, &code, now_ms)
                })
            })
            .map_err(|_| provider_unavailable())?
            .map_err(|_| provider_unavailable())
    }

    pub(crate) fn commit_planned_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderSessionIssuanceCommitPlan,
        code: &str,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        let code = match VerificationCode::parse(code) {
            Ok(code) => code,
            Err(_) => {
                return AuthTransactionAttempt::RolledBack(request_invalid().into_snapback_error());
            }
        };
        let Some(challenge) = &plan.challenge else {
            return AuthTransactionAttempt::RolledBack(internal_state_snapback());
        };
        if challenge.challenge_id != self.coordination.challenge_id.as_str()
            || challenge.key_id != self.coordination.key_id.as_str()
        {
            return AuthTransactionAttempt::RolledBack(internal_state_snapback());
        }
        self.admission
            .provider
            .keyring
            .with_key(&self.coordination.key_id, |key| {
                attempt_planned_session_issuance(database, plan, Some((key, &code)))
            })
            .unwrap_or_else(|_| {
                AuthTransactionAttempt::RolledBack(provider_unavailable().into_snapback_error())
            })
    }

    /// Recheck a read-planned rejection under `BEGIN IMMEDIATE` without any
    /// code path that can create a session. If the predecessor became a live,
    /// correct challenge, the caller replans and enters coordinated issuance.
    pub(crate) fn commit_planned_rejection(
        &self,
        database: &mut LocalDatabase,
        code: &str,
        now_ms: u64,
        sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> ProviderResult<RejectedExchangeCommit> {
        validate_now(now_ms)?;
        let code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        let provider = &self.admission.provider;
        let outcome = provider
            .keyring
            .with_key(&self.coordination.key_id, |key| {
                database.with_auth_transaction(|transaction| {
                    rejected_exchange_transaction(
                        transaction,
                        provider,
                        &self.coordination,
                        key,
                        &code,
                        now_ms,
                        sender_issuance,
                    )
                })
            })
            .map_err(|_| provider_unavailable())?
            .map_err(|_| provider_unavailable())?;
        match outcome {
            RejectedExchangeOutcome::Invalid => Err(code_invalid()),
            RejectedExchangeOutcome::Locked => Err(code_locked()),
            RejectedExchangeOutcome::PredecessorChanged => {
                Ok(RejectedExchangeCommit::PredecessorChanged)
            }
        }
    }

    pub(crate) fn finish_exchange_cleanup(&self) {
        self.admission
            .provider
            .mailbox
            .erase(&self.coordination.challenge_id);
    }

    /// Exchange a known preliminary row. Key material is selected before the
    /// writer and retained through the transaction; all preliminary facts are
    /// then rechecked under `BEGIN IMMEDIATE`.
    #[cfg(test)]
    pub fn exchange(
        &self,
        database: &mut LocalDatabase,
        code: &str,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        validate_now(now_ms)?;
        let code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        let provider = &self.admission.provider;

        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            // Candidate generation is outside the writer and independent of
            // preliminary row state. Only the single in-transaction HMAC may
            // authorize its insertion.
            let mut candidate = SessionCandidate::generate(provider, now_ms)?;
            let transaction = provider
                .keyring
                .with_key(&self.coordination.key_id, |key| {
                    database.with_auth_transaction(|transaction| {
                        exchange_transaction(
                            transaction,
                            provider,
                            &self.coordination,
                            key,
                            &code,
                            &candidate,
                            now_ms,
                        )
                    })
                })
                .map_err(|_| provider_unavailable())?;

            match transaction {
                Ok(ExchangeOutcome::Invalid) => return Err(code_invalid()),
                Ok(ExchangeOutcome::Locked) => return Err(code_locked()),
                Ok(ExchangeOutcome::Issued {
                    session,
                    committed_revocation,
                }) => {
                    provider.mailbox.erase(&self.coordination.challenge_id);
                    let bearer = candidate.bearer.take().ok_or_else(provider_unavailable)?;
                    let refresh_after = session
                        .created_at
                        .checked_add(AUTH_SESSION_REFRESH_CADENCE_MS)
                        .unwrap_or(session.expires_at)
                        .min(session.expires_at)
                        .min(session.absolute_expires_at);
                    return Ok(CredentialIssue::new(
                        CredentialResponse::new(bearer, refresh_after, session),
                        committed_revocation,
                    ));
                }
                Err(error) if error.diagnostic.code == INTERNAL_AUTH_COLLISION => continue,
                Err(_) => return Err(provider_unavailable()),
            }
        }
        Err(provider_unavailable())
    }
}

/// Shared-maintenance plus one canonical-address stripe. This guard may be
/// moved into `with_snapback`; no method acquires an earlier lock from it.
pub struct AddressAdmission {
    admission: AuthAdmission,
    address: CanonicalAddress,
    _stripe: OwnedMutexGuard<()>,
}

impl fmt::Debug for AddressAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AddressAdmission([REDACTED])")
    }
}

impl AddressAdmission {
    pub fn address(&self) -> &CanonicalAddress {
        &self.address
    }

    fn provider(&self) -> &AuthProvider {
        &self.admission.provider
    }

    /// Mint one five-minute, operation-bound challenge. The plaintext is
    /// published only to the existing bounded capture mailbox after the
    /// durable row commits; production refuses until LLP 0045 supplies a
    /// human-delivery adapter.
    pub(crate) fn request_step_up(
        &self,
        database: &mut LocalDatabase,
        binding: &StepUpBinding,
    ) -> ProviderResult<RequestCodeResponse> {
        // Sample after every asynchronous admission/stripe wait, immediately
        // before the durable effect, so the five-minute window cannot be
        // lengthened by request-queue delay.
        let now_ms = self.provider().now_ms();
        validate_now(now_ms)?;
        if !self.provider().profile.permits_capture() {
            return Err(step_up_delivery_unavailable());
        }
        let expires_at_ms = checked_time_add(now_ms, AUTH_STEP_UP_TTL_MS)?;
        let expires_at = self
            .provider()
            .clock
            .monotonic_now()
            .checked_add(Duration::from_millis(AUTH_STEP_UP_TTL_MS))
            .ok_or_else(provider_unavailable)?;

        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            let challenge_id = ChallengeId::generate(self.provider().random.as_ref())
                .map_err(|_| provider_unavailable())?;
            let code = VerificationCode::generate(self.provider().random.as_ref())
                .map_err(|_| provider_unavailable())?;
            let (key_id, digest) = self
                .provider()
                .keyring
                .with_active_key(now_ms, self.provider().random.as_ref(), |key_id, key| {
                    (
                        key_id.as_str().to_owned(),
                        StepUpDigest::compute(
                            key,
                            &challenge_id,
                            &self.address,
                            &binding.user_id,
                            &binding.session_id,
                            binding.session_generation,
                            &binding.authority_instance_id,
                            binding.operation,
                            &binding.target_id,
                            &code,
                        ),
                    )
                })
                .map_err(|_| provider_unavailable())?;
            let entry = CaptureMailboxEntry::new(
                challenge_id.clone(),
                self.address.clone(),
                code,
                expires_at,
                expires_at_ms,
            )
            .map_err(ProviderError::from)?;
            let reservation = match self.provider().mailbox.reserve(entry) {
                Ok(reservation) => reservation,
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_THROTTLED" => {
                    return Err(ProviderError::new(error));
                }
                Err(_) => continue,
            };

            let outcome = database.with_auth_transaction(|transaction| {
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
                if live_address.as_deref() != Some(self.address.as_str()) {
                    return Err(auth_required().into_snapback_error());
                }

                let global_lower = now_ms as i64 - AUTH_GLOBAL_REQUEST_WINDOW_MS as i64;
                let global_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE requested_at_ms > ?1 AND requested_at_ms <= ?2",
                    params![global_lower, now_ms as i64],
                    |row| row.get(0),
                )?;
                if global_count >= AUTH_GLOBAL_REQUEST_LIMIT as i64 {
                    return Err(throttled_snapback());
                }

                let address_lower = now_ms as i64 - AUTH_ADDRESS_REQUEST_WINDOW_MS as i64;
                let address_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE canonical_address = ?1
                       AND requested_at_ms > ?2 AND requested_at_ms <= ?3",
                    params![self.address.as_str(), address_lower, now_ms as i64],
                    |row| row.get(0),
                )?;
                if !self
                    .provider()
                    .profile
                    .exempts_capture_address_request_budget()
                    && address_count >= AUTH_ADDRESS_REQUEST_LIMIT as i64
                {
                    return Err(throttled_snapback());
                }

                transaction.execute(
                    "UPDATE _auth_verification_codes SET superseded_by = ?1
                     WHERE canonical_address = ?2
                       AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                    params![challenge_id.as_str(), self.address.as_str()],
                )?;
                match transaction.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, NULL, NULL)",
                    params![
                        challenge_id.as_str(),
                        self.address.as_str(),
                        digest.as_bytes().as_slice(),
                        key_id,
                        AUTH_MAXIMUM_ATTEMPTS as i64,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                ) {
                    Ok(_) => Ok(RequestInsertOutcome::Inserted),
                    Err(error) if is_constraint_error(&error) => Err(internal_collision_snapback()),
                    Err(error) => Err(error.into()),
                }
            });

            match outcome {
                Ok(RequestInsertOutcome::Inserted) => {
                    self.provider()
                        .mailbox
                        .erase_address_except(&self.address, &challenge_id);
                    reservation.publish().map_err(|_| provider_unavailable())?;
                    return Ok(RequestCodeResponse {
                        challenge_id: challenge_id.as_str().to_owned(),
                        expires_at: expires_at_ms,
                    });
                }
                Err(error) if error.diagnostic.code == INTERNAL_AUTH_COLLISION => continue,
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_THROTTLED" => {
                    return Err(ProviderError::new(error));
                }
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_REQUIRED" => {
                    return Err(ProviderError::new(error));
                }
                Err(_) => return Err(provider_unavailable()),
            }
        }
        Err(provider_unavailable())
    }

    /// Create, durably supersede, and publish one capture-provider challenge.
    /// The address stripe is held for this entire method.
    pub fn request_code(
        &self,
        database: &mut LocalDatabase,
        now_ms: u64,
    ) -> ProviderResult<RequestCodeResponse> {
        validate_now(now_ms)?;
        if !self.provider().profile.permits_capture() {
            return Err(provider_unavailable());
        }
        let expires_at_ms = checked_time_add(now_ms, AUTH_CHALLENGE_TTL_MS)?;
        let expires_at = self
            .provider()
            .clock
            .monotonic_now()
            .checked_add(Duration::from_millis(AUTH_CHALLENGE_TTL_MS))
            .ok_or_else(provider_unavailable)?;

        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            let challenge_id = ChallengeId::generate(self.provider().random.as_ref())
                .map_err(|_| provider_unavailable())?;
            let code = VerificationCode::generate(self.provider().random.as_ref())
                .map_err(|_| provider_unavailable())?;
            let (key_id, digest) = self
                .provider()
                .keyring
                .with_active_key(now_ms, self.provider().random.as_ref(), |key_id, key| {
                    (
                        key_id.as_str().to_owned(),
                        CodeDigest::compute(key, &challenge_id, &self.address, &code),
                    )
                })
                .map_err(|_| provider_unavailable())?;
            let entry = CaptureMailboxEntry::new(
                challenge_id.clone(),
                self.address.clone(),
                code,
                expires_at,
                expires_at_ms,
            )
            .map_err(ProviderError::from)?;
            let reservation = match self.provider().mailbox.reserve(entry) {
                Ok(reservation) => reservation,
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_THROTTLED" => {
                    return Err(ProviderError::new(error));
                }
                // The only reachable non-capacity refusal for a freshly
                // bounded entry is an observable challenge-id collision.
                // Retry with a completely fresh id/code candidate.
                Err(_) => continue,
            };

            let outcome = database.with_auth_transaction(|transaction| {
                let global_lower = now_ms as i64 - AUTH_GLOBAL_REQUEST_WINDOW_MS as i64;
                let global_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE requested_at_ms > ?1 AND requested_at_ms <= ?2",
                    params![global_lower, now_ms as i64],
                    |row| row.get(0),
                )?;
                if global_count >= AUTH_GLOBAL_REQUEST_LIMIT as i64 {
                    return Err(throttled_snapback());
                }

                let address_lower = now_ms as i64 - AUTH_ADDRESS_REQUEST_WINDOW_MS as i64;
                let address_count: i64 = transaction.query_row(
                    "SELECT COUNT(*) FROM _auth_verification_codes
                     WHERE canonical_address = ?1
                       AND requested_at_ms > ?2 AND requested_at_ms <= ?3",
                    params![self.address.as_str(), address_lower, now_ms as i64],
                    |row| row.get(0),
                )?;
                if !self
                    .provider()
                    .profile
                    .exempts_capture_address_request_budget()
                    && address_count >= AUTH_ADDRESS_REQUEST_LIMIT as i64
                {
                    return Err(throttled_snapback());
                }

                transaction.execute(
                    "UPDATE _auth_verification_codes
                     SET superseded_by = ?1
                     WHERE canonical_address = ?2
                       AND consumed_at_ms IS NULL AND superseded_by IS NULL",
                    params![challenge_id.as_str(), self.address.as_str()],
                )?;
                match transaction.execute(
                    "INSERT INTO _auth_verification_codes(
                       challenge_id, canonical_address, code_digest, key_id,
                       attempts, max_attempts, requested_at_ms, expires_at_ms,
                       consumed_at_ms, superseded_by
                     ) VALUES(?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, NULL, NULL)",
                    params![
                        challenge_id.as_str(),
                        self.address.as_str(),
                        digest.as_bytes().as_slice(),
                        key_id,
                        AUTH_MAXIMUM_ATTEMPTS as i64,
                        now_ms as i64,
                        expires_at_ms as i64,
                    ],
                ) {
                    Ok(_) => Ok(RequestInsertOutcome::Inserted),
                    Err(error) if is_constraint_error(&error) => Err(internal_collision_snapback()),
                    Err(error) => Err(error.into()),
                }
            });

            match outcome {
                Ok(RequestInsertOutcome::Inserted) => {
                    self.provider()
                        .mailbox
                        .erase_address_except(&self.address, &challenge_id);
                    reservation.publish().map_err(|_| provider_unavailable())?;
                    return Ok(RequestCodeResponse {
                        challenge_id: challenge_id.as_str().to_owned(),
                        expires_at: expires_at_ms,
                    });
                }
                Err(error) if error.diagnostic.code == INTERNAL_AUTH_COLLISION => continue,
                Err(error) if error.diagnostic.code == "SNAPBACK_AUTH_THROTTLED" => {
                    return Err(ProviderError::new(error));
                }
                Err(_) => return Err(provider_unavailable()),
            }
        }
        Err(provider_unavailable())
    }

    /// Plan the exact new authority and, when the live cap is full, the exact
    /// oldest session generation/digest to evict. Plaintext remains owned by
    /// the returned redacted plan until projection finalization succeeds.
    pub(crate) fn plan_mint_session(
        &self,
        database: &LocalDatabase,
        now_ms: u64,
    ) -> ProviderResult<ProviderSessionIssuancePlan> {
        validate_now(now_ms)?;
        if !self.provider().profile.permits_capture() {
            return Err(provider_unavailable());
        }
        let candidate = SessionCandidate::generate(self.provider(), now_ms)?;
        let (identity, eviction) = database
            .with_auth_read(|connection| {
                plan_session_issuance_read(connection, &self.address, &candidate, now_ms)
            })
            .map_err(|_| provider_unavailable())?;
        let (user_id, provider) = match &identity {
            PlannedIdentityState::Existing { user_id, .. }
            | PlannedIdentityState::Create { user_id, .. } => {
                (user_id.clone(), "email-code".to_owned())
            }
        };
        let expires_at_ms = checked_time_add(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?;
        let absolute_expires_at_ms = checked_time_add(now_ms, AUTH_SESSION_ABSOLUTE_WINDOW_MS)?;
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id,
            provider,
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms,
            absolute_expires_at_ms,
        };
        Ok(ProviderSessionIssuancePlan {
            address: self.address.clone(),
            now_ms,
            identity,
            candidate,
            projected,
            eviction,
            challenge: None,
            sender_issuance: None,
        })
    }

    pub(crate) fn commit_planned_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        attempt_planned_session_issuance(database, plan, None)
    }

    /// Reusable host-operation core. Item 4 owns the AdminWrite and
    /// ImpersonationCapability gates; this method owns the identical durable
    /// provisioning, cap, and session issuance semantics used by exchange.
    #[cfg(test)]
    pub fn mint_session(
        &self,
        database: &mut LocalDatabase,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        validate_now(now_ms)?;
        if !self.provider().profile.permits_capture() {
            return Err(provider_unavailable());
        }
        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            let mut candidate = SessionCandidate::generate(self.provider(), now_ms)?;
            let outcome = database.with_auth_transaction(|transaction| {
                mint_session_transaction(transaction, &self.address, &candidate, now_ms)
            });
            match outcome {
                Ok((session, committed_revocation)) => {
                    let token = candidate.bearer.take().ok_or_else(provider_unavailable)?;
                    let refresh_after = checked_time_add(now_ms, AUTH_SESSION_REFRESH_CADENCE_MS)?
                        .min(session.expires_at)
                        .min(session.absolute_expires_at);
                    return Ok(CredentialIssue::new(
                        CredentialResponse::new(token, refresh_after, session),
                        committed_revocation,
                    ));
                }
                Err(error) if error.diagnostic.code == INTERNAL_AUTH_COLLISION => continue,
                Err(_) => return Err(provider_unavailable()),
            }
        }
        Err(provider_unavailable())
    }
}

/// Exclusive maintenance is acquired before the outer app-instance lock and
/// then moved through the blocking database closure for activation/reset/
/// restore/backup/rescue. The guard deliberately exposes no address stripe.
pub struct AuthMaintenanceGuard {
    provider: Arc<AuthProvider>,
    _maintenance: OwnedRwLockWriteGuard<()>,
}

impl fmt::Debug for AuthMaintenanceGuard {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthMaintenanceGuard(..)")
    }
}

impl AuthMaintenanceGuard {
    pub fn keyring(&self) -> &AuthKeyringStore {
        &self.provider.keyring
    }

    /// Prepare the only fallible external half of first catalog activation.
    /// The staged-mode consume transaction installs the SQLite catalog marker;
    /// publishing a usable keyring first preserves LLP 0057's one-way ordering
    /// without creating a second provider or escaping this maintenance guard.
    // @ref LLP 0057#activation-ordering — usable key material precedes the catalog marker and is never reminted for a marked catalog.
    pub(crate) fn prepare_catalog_activation(&self) -> SnapbackResult<()> {
        self.provider
            .keyring
            .load_or_mint_initial(self.provider.now_ms(), self.provider.random.as_ref())
            .map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                    "auth",
                    "email-code auth provider is unavailable",
                )
            })?;
        Ok(())
    }

    pub fn mailbox(&self) -> &CaptureMailbox {
        &self.provider.mailbox
    }

    pub fn clear_mailbox_after_committed_reset(&self) {
        self.provider.mailbox.clear_after_committed_reset();
    }

    pub fn clear_mailbox_after_declared_restore(&self) {
        self.provider.mailbox.clear_after_declared_restore();
    }

    pub fn prune_mailbox_expired(&self) -> usize {
        self.provider.mailbox.prune_expired()
    }

    /// One startup/periodic maintenance pass under exclusive admission. The
    /// provider's own clock dependencies, keyring, mailbox, and RNG stay
    /// inseparable so lifecycle wiring cannot accidentally use ambient state.
    pub fn run_gc_pass(
        &self,
        database: &mut LocalDatabase,
        now_ms: u64,
    ) -> ProviderResult<AuthGcPass> {
        validate_now(now_ms)?;
        let lifecycle = super::lifecycle::run_gc_pass(
            database,
            &self.provider.keyring,
            &self.provider.mailbox,
            now_ms,
            self.provider.random.as_ref(),
        )?;
        let retired_keys_pruned = match lifecycle.keyring {
            KeyringGcResult::Available {
                retired_keys_deleted,
            } => retired_keys_deleted,
            KeyringGcResult::Unavailable => 0,
        };
        Ok(AuthGcPass {
            challenges_deleted: lifecycle.challenges_deleted,
            sessions_deleted: lifecycle.sessions_deleted,
            mailbox_entries_pruned: lifecycle.mailbox_entries_deleted,
            retired_keys_pruned,
            immediate_retry: lifecycle.immediate_retry,
        })
    }
}

impl SessionCandidate {
    fn generate(provider: &AuthProvider, now_ms: u64) -> ProviderResult<Self> {
        let user_id = mint_uuid_v7(provider.random.as_ref(), now_ms)?;
        let identity_id = mint_uuid_v7(provider.random.as_ref(), now_ms)?;
        let session_id = mint_uuid_v7(provider.random.as_ref(), now_ms)?;
        let authority_instance_id = mint_uuid_v7(provider.random.as_ref(), now_ms)?;
        let bearer = SessionBearer::generate(provider.random.as_ref())
            .map_err(|_| provider_unavailable())?;
        let token_hash = bearer.token_hash();
        Ok(Self {
            user_id,
            identity_id,
            session_id,
            authority_instance_id,
            bearer: Some(bearer),
            token_hash,
        })
    }
}

impl BearerCandidate {
    fn generate(provider: &AuthProvider) -> ProviderResult<Self> {
        let bearer = SessionBearer::generate(provider.random.as_ref())
            .map_err(|_| provider_unavailable())?;
        let token_hash = bearer.token_hash();
        Ok(Self {
            bearer: Some(bearer),
            token_hash,
        })
    }

    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: every successor of
    // a sender-bound family stays in the `sbs2_` spelling; the durable family
    // binding, not the presented spelling, selects this mint.
    fn generate_sender_v2(provider: &AuthProvider) -> ProviderResult<Self> {
        let bearer = SessionBearer::generate_sender_v2(provider.random.as_ref())
            .map_err(|_| provider_unavailable())?;
        let token_hash = bearer.token_hash();
        Ok(Self {
            bearer: Some(bearer),
            token_hash,
        })
    }
}

#[derive(Debug)]
struct SessionRecord {
    session: ResolvedSession,
    revoked: bool,
}

impl SessionRecord {
    fn live_at(&self, now_ms: u64) -> bool {
        !self.revoked && now_ms < self.session.expires_at_ms
    }

    fn response(&self) -> SessionResponse {
        SessionResponse {
            id: self.session.session_id.clone(),
            user_id: self.session.user_id.clone(),
            provider: self.session.provider.clone(),
            created_at: self.session.created_at_ms,
            expires_at: self.session.expires_at_ms,
            absolute_expires_at: self.session.absolute_expires_at_ms,
            authority_instance_id: self.session.authority_instance_id.clone(),
            generation: self.session.generation,
        }
    }
}

#[derive(Debug)]
enum PresentedSessionLookup {
    Current(SessionRecord),
    Tombstone {
        session: SessionRecord,
        superseded_at_ms: u64,
    },
    Unknown,
}

#[derive(Clone, Copy, Debug)]
struct AuthenticatedUseRow {
    generation: u64,
    last_used_at_ms: u64,
    expires_at_ms: u64,
    absolute_expires_at_ms: u64,
    revoked: bool,
}

impl AuthenticatedUseRow {
    fn live_at(self, now_ms: u64) -> bool {
        !self.revoked && now_ms < self.expires_at_ms && now_ms < self.absolute_expires_at_ms
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

fn lookup_presented_session(
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
            "SELECT session.id, session.user_id, session.identity_id,
                    identity.provider, session.generation,
                    session.authority_instance_id, session.created_at_ms,
                    session.last_used_at_ms, session.expires_at_ms,
                    session.absolute_expires_at_ms, session.revoked_at_ms
             FROM _auth_sessions AS session
             JOIN _auth_identities AS identity
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
            "SELECT session.id, session.user_id, session.identity_id,
                    identity.provider, session.generation,
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
        .filter(|generation| *generation != 0 && *generation <= MAX_SAFE_TIMESTAMP)
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

fn checked_stored_time(value: i64) -> SnapbackResult<u64> {
    u64::try_from(value)
        .ok()
        .filter(|value| *value <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)
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
            "SELECT session.id, session.user_id, session.identity_id,
                    identity.provider, session.generation,
                    session.authority_instance_id, session.created_at_ms,
                    session.last_used_at_ms, session.expires_at_ms,
                    session.absolute_expires_at_ms, session.revoked_at_ms,
                    session.token_hash
             FROM _auth_sessions AS session
             JOIN _auth_identities AS identity
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

fn resolve_ordinary_lookup(
    lookup: PresentedSessionLookup,
    now_ms: u64,
) -> ProviderResult<ResolvedSession> {
    match lookup {
        PresentedSessionLookup::Unknown => Err(auth_required()),
        PresentedSessionLookup::Current(session) => {
            if session.live_at(now_ms) {
                Ok(session.session)
            } else {
                // The frozen v1/v2 durable row has only `revoked_at_ms`, not
                // the cause. Cap eviction is carrier-only while logout and
                // family revocation are durable, so this restart/provider
                // fallback must remain non-destructive.
                Err(session_expired())
            }
        }
        PresentedSessionLookup::Tombstone {
            session,
            superseded_at_ms,
        } => {
            if !session.live_at(now_ms) {
                return Err(session_expired());
            }
            let age = now_ms
                .checked_sub(superseded_at_ms)
                .ok_or_else(provider_unavailable)?;
            if age <= AUTH_SESSION_SUPERSESSION_GRACE_MS {
                Ok(session.session)
            } else {
                Err(credential_superseded())
            }
        }
    }
}

fn revocation_plan(
    session: &SessionRecord,
    presented_digest: TokenDigest,
    source: PlannedTokenSource,
    reason: RevocationReason,
) -> ProviderRevocationPlan {
    ProviderRevocationPlan {
        session_id: session.session.session_id.clone(),
        expected_generation: session.session.generation,
        presented_digest,
        source,
        reason,
    }
}

fn planned_revocation_transaction(
    transaction: &Transaction<'_>,
    plan: &ProviderRevocationPlan,
    now_ms: u64,
) -> SnapbackResult<PlannedRevocationCommit> {
    let committed_generation = plan.committed_generation()?;
    let changed = match plan.source {
        PlannedTokenSource::Current => transaction.execute(
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
        PlannedTokenSource::Superseded { superseded_at_ms } => transaction.execute(
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
        .filter(|generation| *generation != 0 && *generation <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)?;
    if changed == 1 {
        if revoked_at_ms == Some(now_ms as i64) && generation == committed_generation {
            return Ok(PlannedRevocationCommit::Committed(SessionRevocation {
                session_id: plan.session_id.clone(),
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

fn planned_family_alarm_transaction(
    transaction: &Transaction<'_>,
    plan: &ProviderFamilyAlarmPlan,
) -> SnapbackResult<PlannedFamilyAlarmCommit> {
    let exact = ProviderRevocationPlan {
        session_id: plan.session_id.clone(),
        expected_generation: plan.expected_generation,
        presented_digest: plan.presented_digest,
        source: PlannedTokenSource::Superseded {
            superseded_at_ms: plan.superseded_at_ms,
        },
        reason: RevocationReason::FamilyAlarm,
    };
    match planned_revocation_transaction(transaction, &exact, plan.observed_at_ms)? {
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

enum DurableRevocationReconcile {
    ExactPredecessor,
    ExactSuccessor(SessionRevocation),
    DifferentValid,
}

fn reconcile_planned_revocation(
    connection: &Connection,
    plan: &ProviderRevocationPlan,
    now_ms: u64,
) -> SnapbackResult<DurableRevocationReconcile> {
    let Some(snapshot) = lookup_session_snapshot(connection, &plan.session_id)? else {
        return Ok(DurableRevocationReconcile::DifferentValid);
    };
    let committed_generation = plan.committed_generation()?;
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
                session_id: plan.session_id.clone(),
                generation: committed_generation,
            },
        ));
    }
    let exact_source = match plan.source {
        PlannedTokenSource::Current => snapshot.current_digest == plan.presented_digest,
        PlannedTokenSource::Superseded { superseded_at_ms } => {
            exact_tombstone_time(connection, &plan.session_id, plan.presented_digest)?
                == Some(superseded_at_ms)
        }
    };
    if snapshot.record.session.generation == plan.expected_generation
        && !snapshot.record.revoked
        && snapshot.record.live_at(now_ms)
        && exact_source
    {
        Ok(DurableRevocationReconcile::ExactPredecessor)
    } else {
        Ok(DurableRevocationReconcile::DifferentValid)
    }
}

#[derive(Clone)]
enum PlannedRotationTransaction {
    Refreshed(SessionResponse),
    CandidateCollision,
    PredecessorChanged,
}

enum DurableRotationReconcile {
    ExactPredecessor,
    ExactSuccessor(SessionResponse),
    DifferentValid,
}

fn reconcile_planned_rotation(
    connection: &Connection,
    plan: &ProviderTokenRotationCommitPlan,
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
            snapshot.record.response(),
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

fn planned_rotation_transaction(
    transaction: &Transaction<'_>,
    plan: &ProviderTokenRotationCommitPlan,
) -> SnapbackResult<PlannedRotationTransaction> {
    let now_ms = plan.superseded_at_ms;
    let predecessor = TokenHash::from_bytes(*plan.predecessor_digest.as_bytes());
    let Some(current) = lookup_current_session(transaction, &predecessor)? else {
        return Ok(PlannedRotationTransaction::PredecessorChanged);
    };
    if current.session.session_id != plan.session_id
        || current.session.generation != plan.expected_generation
        || !current.live_at(now_ms)
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
    Ok(PlannedRotationTransaction::Refreshed(current.response()))
}

#[cfg(test)]
fn refresh_transaction(
    transaction: &Transaction<'_>,
    predecessor_hash: &TokenHash,
    successor_hash: &TokenHash,
    now_ms: u64,
) -> SnapbackResult<RefreshOutcome> {
    if let Some(current) = lookup_current_session(transaction, predecessor_hash)? {
        if !current.live_at(now_ms) {
            return Ok(RefreshOutcome::SessionExpired);
        }
        let successor_exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM _auth_sessions WHERE token_hash = ?1)
                    OR EXISTS(SELECT 1 FROM _auth_session_tokens WHERE token_hash = ?1)",
            params![successor_hash.as_bytes().as_slice()],
            |row| row.get(0),
        )?;
        if successor_exists {
            return Err(internal_collision_snapback());
        }
        execute_candidate(
            transaction,
            "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
             VALUES(?1, ?2, ?3)",
            params![
                predecessor_hash.as_bytes().as_slice(),
                current.session.session_id,
                now_ms as i64,
            ],
        )?;
        let changed = execute_candidate(
            transaction,
            "UPDATE _auth_sessions SET token_hash = ?1
             WHERE id = ?2 AND token_hash = ?3 AND revoked_at_ms IS NULL
               AND ?4 < expires_at_ms",
            params![
                successor_hash.as_bytes().as_slice(),
                current.session.session_id,
                predecessor_hash.as_bytes().as_slice(),
                now_ms as i64,
            ],
        )?;
        if changed != 1 {
            return Err(internal_state_snapback());
        }
        return Ok(RefreshOutcome::Refreshed(current.response()));
    }

    let Some((session, superseded_at_ms)) =
        lookup_tombstone_session(transaction, predecessor_hash)?
    else {
        return Ok(RefreshOutcome::AuthRequired);
    };
    if !session.live_at(now_ms) {
        return Ok(RefreshOutcome::SessionExpired);
    }
    let age = now_ms
        .checked_sub(superseded_at_ms)
        .ok_or_else(internal_state_snapback)?;
    if age <= AUTH_SESSION_SUPERSESSION_GRACE_MS {
        return Ok(RefreshOutcome::SupersededInsideGrace);
    }
    let revocation = revoke_live_session(
        transaction,
        &session,
        now_ms,
        RevocationReason::RefreshReuse,
    )?;
    Ok(RefreshOutcome::ReuseRevoked(revocation))
}

#[cfg(test)]
fn logout_transaction(
    transaction: &Transaction<'_>,
    token_hash: &TokenHash,
    now_ms: u64,
) -> SnapbackResult<LogoutOutcome> {
    match lookup_presented_session(transaction, token_hash)? {
        PresentedSessionLookup::Unknown => Ok(LogoutOutcome::AuthRequired),
        PresentedSessionLookup::Current(session) => {
            if !session.live_at(now_ms) {
                Ok(LogoutOutcome::SessionExpired)
            } else {
                revoke_live_session(transaction, &session, now_ms, RevocationReason::Logout)
                    .map(LogoutOutcome::Revoked)
            }
        }
        PresentedSessionLookup::Tombstone {
            session,
            superseded_at_ms,
        } => {
            if !session.live_at(now_ms) {
                return Ok(LogoutOutcome::SessionExpired);
            }
            let age = now_ms
                .checked_sub(superseded_at_ms)
                .ok_or_else(internal_state_snapback)?;
            if age > AUTH_SESSION_SUPERSESSION_GRACE_MS {
                Ok(LogoutOutcome::CredentialSuperseded)
            } else {
                revoke_live_session(transaction, &session, now_ms, RevocationReason::Logout)
                    .map(LogoutOutcome::Revoked)
            }
        }
    }
}

#[cfg(test)]
fn revoke_live_session(
    transaction: &Transaction<'_>,
    session: &SessionRecord,
    now_ms: u64,
    reason: RevocationReason,
) -> SnapbackResult<SessionRevocation> {
    let generation = session
        .session
        .generation
        .checked_add(1)
        .and_then(|generation| i64::try_from(generation).ok().map(|_| generation))
        .ok_or_else(internal_state_snapback)?;
    let changed = transaction.execute(
        "UPDATE _auth_sessions SET revoked_at_ms = ?1, generation = ?2
         WHERE id = ?3 AND generation = ?4 AND revoked_at_ms IS NULL
           AND ?1 < expires_at_ms",
        params![
            now_ms as i64,
            generation as i64,
            session.session.session_id,
            session.session.generation as i64,
        ],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
    crate::storage::auth::write_session_terminal_cause_in(
        transaction,
        &session.session.session_id,
        generation,
        now_ms,
        reason,
    )?;
    Ok(SessionRevocation {
        session_id: session.session.session_id.clone(),
        generation,
    })
}

#[cfg(test)]
fn family_alarm_transaction(
    transaction: &Transaction<'_>,
    token_hash: &TokenHash,
    now_ms: u64,
) -> SnapbackResult<Option<SessionRevocation>> {
    let revoked = transaction
        .query_row(
            "UPDATE _auth_sessions
             SET revoked_at_ms = ?2, generation = generation + 1
             WHERE id = (
               SELECT session_id FROM _auth_session_tokens WHERE token_hash = ?1
             )
               AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
             RETURNING id, generation",
            params![token_hash.as_bytes().as_slice(), now_ms as i64],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let revocation = revoked
        .map(|(session_id, generation)| {
            let generation = u64::try_from(generation)
                .ok()
                .filter(|generation| (2..=MAX_SAFE_TIMESTAMP).contains(generation))
                .ok_or_else(internal_state_snapback)?;
            if generation < 2 {
                return Err(internal_state_snapback());
            }
            Ok(SessionRevocation {
                session_id,
                generation,
            })
        })
        .transpose()?;
    if let Some(revocation) = &revocation {
        crate::storage::auth::write_session_terminal_cause_in(
            transaction,
            &revocation.session_id,
            revocation.generation,
            now_ms,
            RevocationReason::FamilyAlarm,
        )?;
    }
    Ok(revocation)
}

fn authenticated_use_row(
    connection: &Connection,
    session_id: &str,
    expected_generation: u64,
) -> SnapbackResult<Option<AuthenticatedUseRow>> {
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
            .filter(|generation| *generation != 0 && *generation <= MAX_SAFE_TIMESTAMP)
            .ok_or_else(internal_state_snapback)?;
        let row = AuthenticatedUseRow {
            generation,
            last_used_at_ms: checked_stored_time(last_used)?,
            expires_at_ms: checked_stored_time(expires)?,
            absolute_expires_at_ms: checked_stored_time(absolute)?,
            revoked,
        };
        if row.generation == 0 || row.expires_at_ms > row.absolute_expires_at_ms {
            return Err(internal_state_snapback());
        }
        Ok((row.generation == expected_generation).then_some(row))
    })
    .transpose()
    .map(Option::flatten)
}

fn record_authenticated_use_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    expected_generation: u64,
    now_ms: u64,
) -> SnapbackResult<AuthenticatedUse> {
    let Some(row) = authenticated_use_row(transaction, session_id, expected_generation)? else {
        return Ok(AuthenticatedUse::NotLive);
    };
    if !row.live_at(now_ms) {
        return Ok(AuthenticatedUse::NotLive);
    }
    if now_ms.saturating_sub(row.last_used_at_ms) < AUTH_SESSION_USE_COALESCE_MS {
        return Ok(AuthenticatedUse::Unchanged {
            expires_at_ms: row.expires_at_ms,
        });
    }
    let expires_at_ms = now_ms
        .checked_add(AUTH_SESSION_SLIDING_WINDOW_MS)
        .unwrap_or(MAX_SAFE_TIMESTAMP)
        .min(row.absolute_expires_at_ms);
    if expires_at_ms < now_ms {
        return Ok(AuthenticatedUse::NotLive);
    }
    let changed = transaction.execute(
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
            AUTH_SESSION_USE_COALESCE_MS as i64,
        ],
    )?;
    if changed == 1 {
        Ok(AuthenticatedUse::Extended { expires_at_ms })
    } else {
        Ok(AuthenticatedUse::NotLive)
    }
}

#[allow(clippy::too_many_arguments)]
fn plan_exchange_read(
    connection: &Connection,
    provider: &AuthProvider,
    coordination: &ExchangeCoordination,
    _key: &AuthKeyMaterial,
    _code: &VerificationCode,
    now_ms: u64,
) -> SnapbackResult<PlannedExchange> {
    let row = connection
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                    superseded_by IS NOT NULL
             FROM _auth_verification_codes
             WHERE challenge_id = ?1",
            params![coordination.challenge_id.as_str()],
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
        return Ok(PlannedExchange::Reject);
    };
    let address = CanonicalAddress::parse(&row.address).map_err(|_| internal_state_snapback())?;
    if address != coordination.address || row.key_id != coordination.key_id.as_str() {
        return Err(internal_state_snapback());
    }
    let code_digest: [u8; 32] = row
        .code_digest
        .as_slice()
        .try_into()
        .map_err(|_| internal_state_snapback())?;
    let expected_attempts = u32::try_from(row.attempts).map_err(|_| internal_state_snapback())?;
    let max_attempts = u32::try_from(row.max_attempts).map_err(|_| internal_state_snapback())?;
    let expires_at_ms = checked_stored_time(row.expires_at_ms)?;
    if max_attempts != AUTH_MAXIMUM_ATTEMPTS || expected_attempts > max_attempts {
        return Err(internal_state_snapback());
    }
    if row.consumed
        || row.superseded
        || now_ms >= expires_at_ms
        || expected_attempts == max_attempts
    {
        return Ok(PlannedExchange::Reject);
    }

    let candidate =
        SessionCandidate::generate(provider, now_ms).map_err(ProviderError::into_snapback_error)?;
    let (identity, eviction) =
        plan_session_issuance_read(connection, &address, &candidate, now_ms)?;
    let user_id = match &identity {
        PlannedIdentityState::Existing { user_id, .. }
        | PlannedIdentityState::Create { user_id, .. } => user_id.clone(),
    };
    let expires_at_ms = checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?;
    let absolute_expires_at_ms =
        checked_time_add_snapback(now_ms, AUTH_SESSION_ABSOLUTE_WINDOW_MS)?;
    let projected = ProjectedSessionInsert {
        session_id: candidate.session_id.clone(),
        user_id,
        provider: "email-code".to_owned(),
        authority_instance_id: candidate.authority_instance_id.clone(),
        generation: 1,
        token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
        created_at_ms: now_ms,
        expires_at_ms,
        absolute_expires_at_ms,
    };
    Ok(PlannedExchange::Issue(ProviderSessionIssuancePlan {
        address,
        now_ms,
        identity,
        candidate,
        projected,
        eviction,
        challenge: Some(PlannedChallengeConsumption {
            challenge_id: coordination.challenge_id.as_str().to_owned(),
            key_id: coordination.key_id.as_str().to_owned(),
            code_digest,
            expected_attempts,
            max_attempts,
            expires_at_ms: checked_stored_time(row.expires_at_ms)?,
        }),
        sender_issuance: None,
    }))
}

#[allow(clippy::too_many_arguments)]
fn rejected_exchange_transaction(
    transaction: &Transaction<'_>,
    provider: &AuthProvider,
    coordination: &ExchangeCoordination,
    key: &AuthKeyMaterial,
    code: &VerificationCode,
    now_ms: u64,
    sender_issuance: Option<&crate::auth::sender_proof::SenderIssuanceCommitment>,
) -> SnapbackResult<RejectedExchangeOutcome> {
    let row = transaction
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                    superseded_by IS NOT NULL
             FROM _auth_verification_codes
             WHERE challenge_id = ?1",
            params![coordination.challenge_id.as_str()],
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
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        if let Some(sender_issuance) = sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Invalid);
    };
    let address = CanonicalAddress::parse(&row.address).map_err(|_| internal_state_snapback())?;
    if address != coordination.address || row.key_id != coordination.key_id.as_str() {
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
    if row.consumed || row.superseded || now_ms >= expires_at_ms {
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        if let Some(sender_issuance) = sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Invalid);
    }
    if attempts == max_attempts {
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        if let Some(sender_issuance) = sender_issuance {
            sender_issuance
                .consume_rejected_outcome(transaction)
                .map_err(|_| internal_state_snapback())?;
        }
        return Ok(RejectedExchangeOutcome::Locked);
    }

    let submitted = CodeDigest::compute(key, &coordination.challenge_id, &address, code);
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
            coordination.challenge_id.as_str(),
            attempts as i64,
            stored.as_slice(),
            coordination.key_id.as_str(),
            expires_at_ms as i64,
        ],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
    if let Some(sender_issuance) = sender_issuance {
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

#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn exchange_transaction(
    transaction: &Transaction<'_>,
    provider: &AuthProvider,
    coordination: &ExchangeCoordination,
    key: &AuthKeyMaterial,
    code: &VerificationCode,
    candidate: &SessionCandidate,
    now_ms: u64,
) -> SnapbackResult<ExchangeOutcome> {
    let row = transaction
        .query_row(
            "SELECT canonical_address, code_digest, key_id, attempts,
                    max_attempts, expires_at_ms, consumed_at_ms IS NOT NULL,
                    superseded_by IS NOT NULL
             FROM _auth_verification_codes
             WHERE challenge_id = ?1",
            params![coordination.challenge_id.as_str()],
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
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        return Ok(ExchangeOutcome::Invalid);
    };

    let address = CanonicalAddress::parse(&row.address).map_err(|_| internal_state_snapback())?;
    if address != coordination.address || row.key_id != coordination.key_id.as_str() {
        return Err(internal_state_snapback());
    }
    if row.code_digest.len() != 32 {
        return Err(internal_state_snapback());
    }
    let mut stored_bytes = Zeroizing::new([0_u8; 32]);
    stored_bytes.copy_from_slice(&row.code_digest);
    let attempts = u32::try_from(row.attempts).map_err(|_| internal_state_snapback())?;
    let max_attempts = u32::try_from(row.max_attempts).map_err(|_| internal_state_snapback())?;
    let expires_at_ms = u64::try_from(row.expires_at_ms).map_err(|_| internal_state_snapback())?;
    if max_attempts != AUTH_MAXIMUM_ATTEMPTS || attempts > max_attempts {
        return Err(internal_state_snapback());
    }

    if row.consumed || row.superseded || now_ms >= expires_at_ms {
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        return Ok(ExchangeOutcome::Invalid);
    }
    if attempts == max_attempts {
        perform_dummy_hmac(provider, &coordination.challenge_id, code);
        return Ok(ExchangeOutcome::Locked);
    }

    let submitted = CodeDigest::compute(key, &coordination.challenge_id, &address, code);
    let correct = submitted.verify(&stored_bytes[..]);
    let next_attempts = attempts
        .checked_add(1)
        .ok_or_else(internal_state_snapback)?;
    if !correct {
        let changed = transaction.execute(
            "UPDATE _auth_verification_codes
             SET attempts = ?1
             WHERE challenge_id = ?2 AND attempts = ?3
               AND consumed_at_ms IS NULL AND superseded_by IS NULL",
            params![
                next_attempts as i64,
                coordination.challenge_id.as_str(),
                attempts as i64,
            ],
        )?;
        if changed != 1 {
            return Err(internal_state_snapback());
        }
        return Ok(if next_attempts == max_attempts {
            ExchangeOutcome::Locked
        } else {
            ExchangeOutcome::Invalid
        });
    }

    let changed = transaction.execute(
        "UPDATE _auth_verification_codes
         SET attempts = ?1, consumed_at_ms = ?2
         WHERE challenge_id = ?3 AND attempts = ?4
           AND consumed_at_ms IS NULL AND superseded_by IS NULL",
        params![
            next_attempts as i64,
            now_ms as i64,
            coordination.challenge_id.as_str(),
            attempts as i64,
        ],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }

    let existing_identity = transaction
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![address.as_str()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let (identity_id, user_id) = match existing_identity {
        Some((identity_id, user_id)) => (identity_id, user_id),
        None => {
            execute_candidate(
                transaction,
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![candidate.user_id, now_ms as i64],
            )?;
            execute_candidate(
                transaction,
                "INSERT INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES(?1, ?2, 'email-code', ?3, ?4)",
                params![
                    candidate.identity_id,
                    candidate.user_id,
                    address.as_str(),
                    now_ms as i64,
                ],
            )?;
            (candidate.identity_id.clone(), candidate.user_id.clone())
        }
    };

    let committed_revocation = enforce_session_cap(transaction, &user_id, now_ms)?;
    let expires_at_ms = checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?;
    let absolute_expires_at_ms =
        checked_time_add_snapback(now_ms, AUTH_SESSION_ABSOLUTE_WINDOW_MS)?;
    execute_candidate(
        transaction,
        "INSERT INTO _auth_sessions(
           id, user_id, identity_id, authority_instance_id, token_hash,
           generation, created_at_ms, last_used_at_ms, expires_at_ms,
           absolute_expires_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)",
        params![
            candidate.session_id,
            user_id,
            identity_id,
            candidate.authority_instance_id,
            candidate.token_hash.as_bytes().as_slice(),
            now_ms as i64,
            expires_at_ms as i64,
            absolute_expires_at_ms as i64,
        ],
    )?;

    Ok(ExchangeOutcome::Issued {
        session: SessionResponse {
            id: candidate.session_id.clone(),
            user_id,
            provider: "email-code".to_owned(),
            created_at: now_ms,
            expires_at: expires_at_ms,
            absolute_expires_at: absolute_expires_at_ms,
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
        },
        committed_revocation,
    })
}

#[cfg(test)]
fn mint_session_transaction(
    transaction: &Transaction<'_>,
    address: &CanonicalAddress,
    candidate: &SessionCandidate,
    now_ms: u64,
) -> SnapbackResult<(SessionResponse, Option<SessionRevocation>)> {
    let existing_identity = transaction
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![address.as_str()],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let (identity_id, user_id) = match existing_identity {
        Some(identity) => identity,
        None => {
            execute_candidate(
                transaction,
                "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
                params![candidate.user_id, now_ms as i64],
            )?;
            execute_candidate(
                transaction,
                "INSERT INTO _auth_identities(
                   id, user_id, provider, subject, verified_at_ms
                 ) VALUES(?1, ?2, 'email-code', ?3, ?4)",
                params![
                    candidate.identity_id,
                    candidate.user_id,
                    address.as_str(),
                    now_ms as i64,
                ],
            )?;
            (candidate.identity_id.clone(), candidate.user_id.clone())
        }
    };
    let committed_revocation = enforce_session_cap(transaction, &user_id, now_ms)?;
    let expires_at_ms = checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?;
    let absolute_expires_at_ms =
        checked_time_add_snapback(now_ms, AUTH_SESSION_ABSOLUTE_WINDOW_MS)?;
    execute_candidate(
        transaction,
        "INSERT INTO _auth_sessions(
           id, user_id, identity_id, authority_instance_id, token_hash,
           generation, created_at_ms, last_used_at_ms, expires_at_ms,
           absolute_expires_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)",
        params![
            candidate.session_id,
            user_id,
            identity_id,
            candidate.authority_instance_id,
            candidate.token_hash.as_bytes().as_slice(),
            now_ms as i64,
            expires_at_ms as i64,
            absolute_expires_at_ms as i64,
        ],
    )?;
    Ok((
        SessionResponse {
            id: candidate.session_id.clone(),
            user_id,
            provider: "email-code".to_owned(),
            created_at: now_ms,
            expires_at: expires_at_ms,
            absolute_expires_at: absolute_expires_at_ms,
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
        },
        committed_revocation,
    ))
}

fn plan_session_issuance_read(
    connection: &Connection,
    address: &CanonicalAddress,
    candidate: &SessionCandidate,
    now_ms: u64,
) -> SnapbackResult<(PlannedIdentityState, Option<ProviderRevocationPlan>)> {
    let existing_identity: Option<(String, String)> = connection
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![address.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let identity = match existing_identity {
        Some((identity_id, user_id)) => PlannedIdentityState::Existing {
            identity_id,
            user_id,
        },
        None => PlannedIdentityState::Create {
            identity_id: candidate.identity_id.clone(),
            user_id: candidate.user_id.clone(),
        },
    };
    let user_id = match &identity {
        PlannedIdentityState::Existing { user_id, .. }
        | PlannedIdentityState::Create { user_id, .. } => user_id,
    };
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, now_ms as i64],
        |row| row.get(0),
    )?;
    if count > AUTH_SESSION_LIVE_LIMIT as i64 {
        return Err(internal_state_snapback());
    }
    let eviction = if count == AUTH_SESSION_LIVE_LIMIT as i64 {
        let (session_id, generation, token_hash): (String, i64, Vec<u8>) = connection.query_row(
            "SELECT id, generation, token_hash FROM _auth_sessions
             WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
             ORDER BY created_at_ms, id LIMIT 1",
            params![user_id, now_ms as i64],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let expected_generation = u64::try_from(generation)
            .ok()
            .filter(|generation| *generation != 0 && *generation < MAX_SAFE_TIMESTAMP)
            .ok_or_else(internal_state_snapback)?;
        Some(ProviderRevocationPlan {
            session_id,
            expected_generation,
            presented_digest: TokenDigest::from_slice(&token_hash)
                .map_err(|_| internal_state_snapback())?,
            source: PlannedTokenSource::Current,
            reason: RevocationReason::CapEviction,
        })
    } else {
        None
    };
    Ok((identity, eviction))
}

fn attempt_planned_session_issuance(
    database: &mut LocalDatabase,
    plan: &ProviderSessionIssuanceCommitPlan,
    exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
    let mut body_outcome = None;
    let attempt = database.attempt_auth_transaction(|transaction| {
        let outcome = planned_session_issuance_transaction(transaction, plan, exchange_proof)?;
        body_outcome = Some(outcome.clone());
        Ok(outcome)
    });
    let AuthTransactionAttempt::CommitUncertain(commit_error) = attempt else {
        return attempt;
    };
    let Some(body_outcome) = body_outcome else {
        return AuthTransactionAttempt::CommitUncertain(commit_error);
    };
    match body_outcome {
        PlannedIssuanceCommit::CandidateCollision | PlannedIssuanceCommit::PredecessorChanged => {
            // The transaction performs no write before this outcome. Authority
            // therefore remained at the projection predecessor even if the
            // final COMMIT acknowledgement was lost.
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
        }
        rejected @ (PlannedIssuanceCommit::CodeInvalid | PlannedIssuanceCommit::CodeLocked) => {
            match database
                .with_auth_read(|connection| reconcile_rejected_issuance(connection, plan))
            {
                Ok(DurableRejectedIssuanceReconcile::ExactSuccessor) => {
                    AuthTransactionAttempt::Committed(rejected)
                }
                Ok(DurableRejectedIssuanceReconcile::ExactPredecessor) => {
                    AuthTransactionAttempt::RolledBack(commit_error)
                }
                Ok(DurableRejectedIssuanceReconcile::DifferentValid) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
                }
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
        PlannedIssuanceCommit::SenderKeyBound => {
            // The only durable write on this outcome is the proof-id
            // consumption; its presence (with our exact expiry) alongside the
            // absent binding and the pre-existing family's nonce cell is the
            // committed witness.
            let Some(sender_issuance) = plan.sender_issuance.as_ref() else {
                return AuthTransactionAttempt::CommitUncertain(commit_error);
            };
            match database.with_auth_read(|connection| {
                sender_issuance
                    .is_key_bound_successor(connection, &plan.projected.session_id)
                    .map_err(|_| internal_state_snapback())
            }) {
                Ok(true) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::SenderKeyBound)
                }
                Ok(false) => AuthTransactionAttempt::RolledBack(commit_error),
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
        PlannedIssuanceCommit::Committed { .. } => {
            match database.with_auth_read(|connection| reconcile_planned_issuance(connection, plan))
            {
                Ok(DurableIssuanceReconcile::ExactSuccessor {
                    session,
                    committed_revocation,
                }) => AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                    session,
                    committed_revocation,
                }),
                Ok(DurableIssuanceReconcile::ExactPredecessor) => {
                    AuthTransactionAttempt::RolledBack(commit_error)
                }
                Ok(DurableIssuanceReconcile::DifferentValid) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
                }
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
    }
}

fn planned_session_issuance_transaction(
    transaction: &Transaction<'_>,
    plan: &ProviderSessionIssuanceCommitPlan,
    exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
) -> SnapbackResult<PlannedIssuanceCommit> {
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
            return Ok(PlannedIssuanceCommit::PredecessorChanged);
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
            return Ok(PlannedIssuanceCommit::PredecessorChanged);
        }
        let challenge_id =
            ChallengeId::parse(&challenge.challenge_id).map_err(|_| internal_state_snapback())?;
        let submitted = CodeDigest::compute(key, &challenge_id, &plan.address, submitted_code);
        if !submitted.verify(&challenge.code_digest) {
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
            return Ok(if next_attempts == challenge.max_attempts {
                PlannedIssuanceCommit::CodeLocked
            } else {
                PlannedIssuanceCommit::CodeInvalid
            });
        }
    } else if exchange_proof.is_some() {
        return Err(internal_state_snapback());
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
        return Ok(PlannedIssuanceCommit::SenderKeyBound);
    }
    let durable_identity: Option<(String, String)> = transaction
        .query_row(
            "SELECT id, user_id FROM _auth_identities
             WHERE provider = 'email-code' AND subject = ?1",
            params![plan.address.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (identity_id, user_id, create_identity) = match (&plan.identity, durable_identity) {
        (
            PlannedIdentityState::Existing {
                identity_id,
                user_id,
            },
            Some((durable_identity_id, durable_user_id)),
        ) if identity_id == &durable_identity_id && user_id == &durable_user_id => {
            (identity_id.clone(), user_id.clone(), false)
        }
        (
            PlannedIdentityState::Create {
                identity_id,
                user_id,
            },
            None,
        ) => (identity_id.clone(), user_id.clone(), true),
        _ => return Ok(PlannedIssuanceCommit::PredecessorChanged),
    };
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
        return Ok(PlannedIssuanceCommit::CandidateCollision);
    }
    let live_count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, plan.now_ms as i64],
        |row| row.get(0),
    )?;
    match &plan.eviction {
        None if live_count < AUTH_SESSION_LIVE_LIMIT as i64 => {}
        Some(eviction) if live_count == AUTH_SESSION_LIVE_LIMIT as i64 => {
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
                return Ok(PlannedIssuanceCommit::PredecessorChanged);
            };
            if session_id != eviction.session_id
                || u64::try_from(generation).ok() != Some(eviction.expected_generation)
                || token_hash.as_slice() != eviction.presented_digest.as_bytes().as_slice()
            {
                return Ok(PlannedIssuanceCommit::PredecessorChanged);
            }
        }
        _ => return Ok(PlannedIssuanceCommit::PredecessorChanged),
    }

    if create_identity {
        execute_candidate(
            transaction,
            "INSERT INTO _auth_users(id, created_at_ms) VALUES(?1, ?2)",
            params![user_id, plan.now_ms as i64],
        )?;
        execute_candidate(
            transaction,
            "INSERT INTO _auth_identities(
               id, user_id, provider, subject, verified_at_ms
             ) VALUES(?1, ?2, 'email-code', ?3, ?4)",
            params![
                identity_id,
                user_id,
                plan.address.as_str(),
                plan.now_ms as i64,
            ],
        )?;
    }

    let committed_revocation = match &plan.eviction {
        Some(eviction) => {
            let generation = eviction.committed_generation()?;
            let changed = transaction.execute(
                "UPDATE _auth_sessions
                 SET revoked_at_ms = ?1, generation = ?2
                 WHERE id = ?3 AND generation = ?4 AND token_hash = ?5
                   AND revoked_at_ms IS NULL AND ?1 < expires_at_ms",
                params![
                    plan.now_ms as i64,
                    generation as i64,
                    eviction.session_id,
                    eviction.expected_generation as i64,
                    eviction.presented_digest.as_bytes().as_slice(),
                ],
            )?;
            if changed != 1 {
                return Err(internal_state_snapback());
            }
            crate::storage::auth::write_session_terminal_cause_in(
                transaction,
                &eviction.session_id,
                generation,
                plan.now_ms,
                RevocationReason::CapEviction,
            )?;
            Some(SessionRevocation {
                session_id: eviction.session_id.clone(),
                generation,
            })
        }
        None => None,
    };

    execute_candidate(
        transaction,
        "INSERT INTO _auth_sessions(
           id, user_id, identity_id, authority_instance_id, token_hash,
           generation, created_at_ms, last_used_at_ms, expires_at_ms,
           absolute_expires_at_ms, revoked_at_ms
         ) VALUES(?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?7, ?8, NULL)",
        params![
            plan.projected.session_id,
            user_id,
            identity_id,
            plan.projected.authority_instance_id,
            plan.projected.token_digest.as_bytes().as_slice(),
            plan.now_ms as i64,
            plan.projected.expires_at_ms as i64,
            plan.projected.absolute_expires_at_ms as i64,
        ],
    )?;
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
    Ok(PlannedIssuanceCommit::Committed {
        session: SessionResponse {
            id: plan.projected.session_id.clone(),
            user_id,
            provider: plan.projected.provider.clone(),
            created_at: plan.projected.created_at_ms,
            expires_at: plan.projected.expires_at_ms,
            absolute_expires_at: plan.projected.absolute_expires_at_ms,
            authority_instance_id: plan.projected.authority_instance_id.clone(),
            generation: plan.projected.generation,
        },
        committed_revocation,
    })
}

enum DurableIssuanceReconcile {
    ExactPredecessor,
    ExactSuccessor {
        session: SessionResponse,
        committed_revocation: Option<SessionRevocation>,
    },
    DifferentValid,
}

enum DurableRejectedIssuanceReconcile {
    ExactPredecessor,
    ExactSuccessor,
    DifferentValid,
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
    challenge: &PlannedChallengeConsumption,
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
    plan: &ProviderSessionIssuanceCommitPlan,
    challenge: &PlannedChallengeConsumption,
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
    plan: &ProviderSessionIssuanceCommitPlan,
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
    plan: &ProviderSessionIssuanceCommitPlan,
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
    plan: &ProviderSessionIssuanceCommitPlan,
) -> SnapbackResult<bool> {
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
    })
}

fn issuance_identity_is_exact_successor(
    connection: &Connection,
    plan: &ProviderSessionIssuanceCommitPlan,
) -> SnapbackResult<bool> {
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
    };
    Ok(ids_match && provider == "email-code" && subject == plan.address.as_str())
}

fn issuance_cap_is_exact_predecessor(
    connection: &Connection,
    plan: &ProviderSessionIssuanceCommitPlan,
) -> SnapbackResult<bool> {
    let user_id = &plan.projected.user_id;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, plan.now_ms as i64],
        |row| row.get(0),
    )?;
    Ok(match &plan.eviction {
        None => count < AUTH_SESSION_LIVE_LIMIT as i64,
        Some(eviction) if count == AUTH_SESSION_LIVE_LIMIT as i64 => {
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

fn issuance_eviction_is_exact_successor(
    connection: &Connection,
    plan: &ProviderSessionIssuanceCommitPlan,
) -> SnapbackResult<Option<SessionRevocation>> {
    let Some(eviction) = &plan.eviction else {
        return Ok(None);
    };
    let Some(snapshot) = lookup_session_snapshot(connection, &eviction.session_id)? else {
        return Err(internal_state_snapback());
    };
    let generation = eviction.committed_generation()?;
    if snapshot.record.session.generation != generation
        || !snapshot.record.revoked
        || snapshot.revoked_at_ms != Some(plan.now_ms)
        || snapshot.current_digest != eviction.presented_digest
        || !crate::storage::auth::session_terminal_cause_matches_on(
            connection,
            &eviction.session_id,
            generation,
            plan.now_ms,
            RevocationReason::CapEviction,
        )?
    {
        return Err(internal_state_snapback());
    }
    Ok(Some(SessionRevocation {
        session_id: eviction.session_id.clone(),
        generation,
    }))
}

fn reconcile_rejected_issuance(
    connection: &Connection,
    plan: &ProviderSessionIssuanceCommitPlan,
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

fn reconcile_planned_issuance(
    connection: &Connection,
    plan: &ProviderSessionIssuanceCommitPlan,
) -> SnapbackResult<DurableIssuanceReconcile> {
    if let Some(snapshot) = lookup_session_snapshot(connection, &plan.projected.session_id)? {
        let expected_identity_id = match &plan.identity {
            PlannedIdentityState::Existing { identity_id, .. }
            | PlannedIdentityState::Create { identity_id, .. } => identity_id,
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
        let committed_revocation = issuance_eviction_is_exact_successor(connection, plan)?;
        return Ok(DurableIssuanceReconcile::ExactSuccessor {
            session: SessionResponse {
                id: session.session_id.clone(),
                user_id: session.user_id.clone(),
                provider: session.provider.clone(),
                created_at: session.created_at_ms,
                expires_at: session.expires_at_ms,
                absolute_expires_at: session.absolute_expires_at_ms,
                authority_instance_id: session.authority_instance_id.clone(),
                generation: session.generation,
            },
            committed_revocation,
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
        return Ok(DurableIssuanceReconcile::ExactPredecessor);
    }
    if plan.eviction.is_some() && !cap_predecessor {
        // This carrier owns an existing authority leaf. It is unsafe to unmark
        // unless that leaf is still exactly the planned predecessor.
        return Err(internal_state_snapback());
    }
    Ok(DurableIssuanceReconcile::DifferentValid)
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

#[cfg(test)]
fn enforce_session_cap(
    transaction: &Transaction<'_>,
    user_id: &str,
    now_ms: u64,
) -> SnapbackResult<Option<SessionRevocation>> {
    let count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms",
        params![user_id, now_ms as i64],
        |row| row.get(0),
    )?;
    if count < AUTH_SESSION_LIVE_LIMIT as i64 {
        return Ok(None);
    }
    if count > AUTH_SESSION_LIVE_LIMIT as i64 {
        return Err(internal_state_snapback());
    }
    let (session_id, generation): (String, i64) = transaction.query_row(
        "SELECT id, generation FROM _auth_sessions
         WHERE user_id = ?1 AND revoked_at_ms IS NULL AND ?2 < expires_at_ms
         ORDER BY created_at_ms, id LIMIT 1",
        params![user_id, now_ms as i64],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let generation = u64::try_from(generation)
        .ok()
        .and_then(|generation| generation.checked_add(1))
        .filter(|generation| *generation <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)?;
    let changed = transaction.execute(
        "UPDATE _auth_sessions SET revoked_at_ms = ?1, generation = ?2
         WHERE id = ?3 AND revoked_at_ms IS NULL AND ?1 < expires_at_ms",
        params![now_ms as i64, generation as i64, session_id],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
    crate::storage::auth::write_session_terminal_cause_in(
        transaction,
        &session_id,
        generation,
        now_ms,
        RevocationReason::CapEviction,
    )?;
    Ok(Some(SessionRevocation {
        session_id,
        generation,
    }))
}

fn perform_dummy_hmac(
    provider: &AuthProvider,
    challenge_id: &ChallengeId,
    code: &VerificationCode,
) {
    let digest = CodeDigest::compute(
        &provider.dummy_key,
        challenge_id,
        &provider.dummy_address,
        code,
    );
    let _ = digest.verify(&[0_u8; 32]);
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

fn mint_uuid_v7(random: &dyn RandomSource, now_ms: u64) -> ProviderResult<String> {
    if now_ms > 0x0000_FFFF_FFFF_FFFF {
        return Err(provider_unavailable());
    }
    let mut random_bytes = [0_u8; 10];
    fill_random_or_unavailable(random, &mut random_bytes)?;
    let id = uuid::Builder::from_unix_timestamp_millis(now_ms, &random_bytes)
        .into_uuid()
        .hyphenated()
        .to_string();
    random_bytes.zeroize();
    Ok(id)
}

fn uniform_alarm_jitter(random: &dyn RandomSource) -> ProviderResult<u64> {
    const ACCEPT_BELOW: u8 = 252;
    loop {
        let mut byte = [0_u8; 1];
        fill_random_or_unavailable(random, &mut byte)?;
        if byte[0] < ACCEPT_BELOW {
            let jitter = u64::from(byte[0] % (AUTH_FAMILY_ALARM_JITTER_MAXIMUM_MS as u8 + 1));
            byte.zeroize();
            return Ok(jitter);
        }
        byte.zeroize();
    }
}

fn fill_random_or_unavailable(
    random: &dyn RandomSource,
    destination: &mut [u8],
) -> ProviderResult<()> {
    if random.fill(destination).is_err() {
        destination.zeroize();
        return Err(provider_unavailable());
    }
    Ok(())
}

fn request_invalid() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_REQUEST_INVALID",
        "auth",
        "authentication request is invalid",
    ))
}

fn provider_unavailable() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
        "auth",
        "authentication provider is unavailable",
    ))
}

fn step_up_delivery_unavailable() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE",
        "auth",
        "fresh authentication delivery is unavailable for this deployment profile",
    ))
}

pub(crate) fn step_up_required_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_STEP_UP_REQUIRED",
        "auth",
        "authority-creating consent requires fresh step-up authentication",
    )
}

fn authorized_lease_key_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE",
        "auth",
        "authorized lease protocol key is unavailable",
    )
}

pub(crate) fn code_invalid() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CODE_INVALID",
        "auth",
        "verification code is invalid",
    ))
}

// @ref LLP 0077#diagnostics-and-redaction — the public refusal set is closed;
// an already-bound key folds into SNAPBACK_AUTH_SENDER_PROOF_INVALID with no
// distinguishing detail. Only the key holder can reach this outcome (it
// requires a valid signature), so the fold leaks nothing and is not an oracle.
pub(crate) fn sender_key_bound() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
        "auth",
        "sender proof is not valid for issuance",
    ))
}

pub(crate) fn code_locked() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CODE_LOCKED",
        "auth",
        "verification code attempt budget is exhausted",
    ))
}

pub(crate) fn auth_required() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_REQUIRED",
        "auth",
        "authentication is required",
    ))
}

pub(crate) fn session_expired() -> ProviderError {
    session_expired_with_disposition("carrier")
}

pub(crate) fn session_revoked() -> ProviderError {
    session_expired_with_disposition("durableDelete")
}

fn session_expired_with_disposition(authority_disposition: &'static str) -> ProviderError {
    ProviderError::new(
        SnapbackError::error(
            "SNAPBACK_AUTH_SESSION_EXPIRED",
            "auth",
            "authentication session is expired",
        )
        .with_details(serde_json::json!({
            "authorityDisposition": authority_disposition,
        })),
    )
}

pub(crate) fn credential_superseded() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "auth",
        "authentication credential has been superseded",
    ))
}

pub(crate) fn refresh_superseded() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_REFRESH_SUPERSEDED",
        "auth",
        "authentication refresh was superseded",
    ))
}

fn mailbox_entry_not_found() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND",
        "auth-mailbox",
        "capture mailbox entry was not found",
    ))
}

fn throttled_snapback() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_THROTTLED",
        "auth",
        "authentication request rate limit exceeded",
    )
}

fn internal_collision_snapback() -> SnapbackError {
    SnapbackError::error(
        INTERNAL_AUTH_COLLISION,
        "auth",
        "authentication credential candidate collided",
    )
}

fn internal_state_snapback() -> SnapbackError {
    SnapbackError::error(
        "INTERNAL_AUTH_STATE",
        "auth",
        "authentication state invariant failed",
    )
}

fn is_constraint_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(sqlite, _)
            if sqlite.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn validate_now(now_ms: u64) -> ProviderResult<()> {
    if now_ms > MAX_SAFE_TIMESTAMP {
        return Err(request_invalid());
    }
    Ok(())
}

fn checked_time_add(now_ms: u64, delta_ms: u64) -> ProviderResult<u64> {
    let value = now_ms
        .checked_add(delta_ms)
        .filter(|value| *value <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(request_invalid)?;
    Ok(value)
}

fn checked_time_add_snapback(now_ms: u64, delta_ms: u64) -> SnapbackResult<u64> {
    now_ms
        .checked_add(delta_ms)
        .filter(|value| *value <= MAX_SAFE_TIMESTAMP)
        .ok_or_else(internal_state_snapback)
}

fn _credential_response(
    token: super::crypto::SessionBearer,
    refresh_after: u64,
    session: SessionResponse,
    committed_revocation: Option<SessionRevocation>,
) -> CredentialIssue {
    CredentialIssue::new(
        CredentialResponse::new(token, refresh_after, session),
        committed_revocation,
    )
}

fn _family_alarm_result(
    response: FamilyAlarmResponse,
    publish_not_before: Instant,
    committed_revocation: Option<SessionRevocation>,
) -> FamilyAlarmResult {
    FamilyAlarmResult {
        response,
        publish_not_before,
        committed_revocation,
    }
}

fn minimum_alarm_deadline(started_at: Instant, jitter_ms: u64) -> ProviderResult<Instant> {
    started_at
        .checked_add(Duration::from_millis(
            AUTH_FAMILY_ALARM_MINIMUM_MS.saturating_add(jitter_ms),
        ))
        .ok_or_else(provider_unavailable)
}

fn _snapback<T>(result: SnapbackResult<T>) -> ProviderResult<T> {
    result.map_err(ProviderError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::sender_proof::{SenderIssuanceCommitment, VerifiedSenderIssuance};
    use crate::auth::session_projection::{
        ProjectedTokenResolution, SessionProjection, TerminalAuthorityDisposition,
    };
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::Value;
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

    struct CountingConstantRandom {
        fills: AtomicUsize,
        byte: u8,
    }

    impl CountingConstantRandom {
        fn new(byte: u8) -> Self {
            Self {
                fills: AtomicUsize::new(0),
                byte,
            }
        }

        fn fills(&self) -> usize {
            self.fills.load(Ordering::SeqCst)
        }
    }

    impl RandomSource for CountingConstantRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), super::super::crypto::CryptoError> {
            self.fills.fetch_add(1, Ordering::SeqCst);
            destination.fill(self.byte);
            Ok(())
        }
    }

    struct PartialFailureRandom;

    impl RandomSource for PartialFailureRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), super::super::crypto::CryptoError> {
            let partial = destination.len().div_ceil(2);
            destination[..partial].fill(0xa5);
            Err(super::super::crypto::CryptoError::RandomUnavailable)
        }
    }

    #[test]
    fn partial_rng_failure_zeroizes_the_candidate_buffer() {
        let mut candidate = [0x5a; 10];
        let error = fill_random_or_unavailable(&PartialFailureRandom, &mut candidate)
            .expect_err("partial fill must fail closed");
        assert_eq!(
            error.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(candidate, [0_u8; 10]);
    }

    struct ManualClock {
        epoch_ms: AtomicU64,
        monotonic_origin: Instant,
    }

    impl ManualClock {
        fn new(epoch_ms: u64) -> Self {
            Self {
                epoch_ms: AtomicU64::new(epoch_ms),
                monotonic_origin: Instant::now(),
            }
        }

        fn set(&self, epoch_ms: u64) {
            self.epoch_ms.store(epoch_ms, Ordering::SeqCst);
        }
    }

    impl AuthClock for ManualClock {
        fn epoch_ms(&self) -> u64 {
            self.epoch_ms.load(Ordering::SeqCst)
        }

        fn monotonic_now(&self) -> Instant {
            self.monotonic_origin + Duration::from_millis(self.epoch_ms())
        }
    }

    fn provider_database_for_profile(
        now_ms: u64,
        profile: AuthProviderProfile,
    ) -> (Arc<AuthProvider>, LocalDatabase) {
        let mut database = LocalDatabase::memory().expect("memory database");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let provider = Arc::new(AuthProvider::new(profile, keyring).expect("auth provider"));
        (provider, database)
    }

    fn provider_database(now_ms: u64) -> (Arc<AuthProvider>, LocalDatabase) {
        provider_database_for_profile(now_ms, AuthProviderProfile::Test)
    }

    fn projected_terminal_reason_after_restart(
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> RevocationReason {
        let source = database
            .session_projection_source()
            .expect("restart projection source");
        let monotonic_now = Instant::now();
        let projection =
            SessionProjection::rebuild_with_fresh_startup_id(source, now_ms, monotonic_now)
                .expect("restart projection");
        let digest = TokenDigest::from_token_hash(
            &SessionBearer::parse(bearer)
                .expect("test bearer")
                .token_hash(),
        );
        match projection
            .resolve_token(&digest, now_ms, monotonic_now)
            .expect("restart token resolution")
        {
            ProjectedTokenResolution::Terminal { reason } => reason,
            resolution => panic!("expected terminal restart resolution, got {resolution:?}"),
        }
    }

    fn provider_database_with_random(
        now_ms: u64,
        random: Arc<dyn RandomSource>,
    ) -> (Arc<AuthProvider>, LocalDatabase) {
        let mut database = LocalDatabase::memory().expect("memory database");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                random,
                Arc::new(SystemAuthClock),
            )
            .expect("auth provider"),
        );
        (provider, database)
    }

    #[tokio::test]
    async fn frozen_v1_catalog_keeps_email_code_and_session_provider_usable() {
        let mut database = LocalDatabase::memory().expect("memory database");
        crate::storage::auth::install_frozen_v1_catalog_fixture(&mut database)
            .expect("install exact frozen v1 fixture");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV1
        );

        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(0, &OsRandom)
            .expect("initial keyring");
        let provider =
            Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).expect("auth provider"));
        let (challenge, code) =
            request_and_code(&provider, &mut database, "legacy@example.com", 0).await;
        let issued = exchange(&provider, &mut database, &challenge.challenge_id, &code, 1)
            .await
            .expect("frozen v1 exchange");

        assert_eq!(issued.response().session.provider, "email-code");
        assert_eq!(
            database.inspect_auth_catalog().unwrap(),
            crate::storage::auth::AuthCatalogState::ReadyV1
        );
        let session_count: i64 = database
            .with_auth_read(|connection| {
                Ok(connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?)
            })
            .unwrap();
        assert_eq!(session_count, 1);
    }

    #[test]
    fn file_backed_keyring_reopens_and_verifies_an_independently_bound_authorized_lease() {
        let now_ms = 1_800_000_000_000;
        let directory = tempfile::tempdir().expect("keyring directory");
        let database_path = directory.path().join("provider.sqlite");
        let issuing_keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
        issuing_keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial file-backed keyring");
        let issuing_provider = AuthProvider::new(AuthProviderProfile::Test, issuing_keyring)
            .expect("issuing auth provider");
        let incarnation = "01890f3c-9d5b-7000-8000-000000000001".to_owned();
        let lease = issuing_provider
            .issue_authorized_lease_at(
                AuthorizedLeaseIssue {
                    lease_id: "lease_provider_1".to_owned(),
                    lease_request_id: "request_provider_1".to_owned(),
                    issuer_id: crate::auth::invalidation::IssuerId {
                        authorization_incarnation: incarnation.clone(),
                        boot_sequence: 1,
                        boot_nonce: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
                    },
                    client_store_id: "store_provider_1".to_owned(),
                    query_key: "myHand:{game=1}".to_owned(),
                    query_instance_id: 1,
                    principal_id: "user_provider_1".to_owned(),
                    session_id_at_issue: None,
                    provider_key: Some("email-code".to_owned()),
                    authorization: crate::storage::AuthorizationVersion {
                        incarnation,
                        epoch: 1,
                    },
                    data: crate::auth::lease::AuthorizedLeaseData {
                        version_stream: "01890f3c-9d5b-7000-8000-000000000002".to_owned(),
                        snapshot_commit_version: 7,
                    },
                    activation_hash: format!(
                        "snapback.authorized-lease.activation.v1:sha256:{}",
                        "a".repeat(64)
                    ),
                    session_not_after_ms: None,
                    provider_not_after_ms: None,
                    authority_instance_id: None,
                },
                AuthorizedLeaseConfig::default(),
                now_ms,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect("issue through file-backed keyring");
        drop(issuing_provider);

        let verifying_keyring = Arc::new(AuthKeyringStore::file_for_database(&database_path));
        verifying_keyring
            .load_existing()
            .expect("reopen file-backed keyring");
        let verifying_provider = AuthProvider::new(AuthProviderProfile::Test, verifying_keyring)
            .expect("verifying auth provider");
        let expectation = AuthorizedLeaseExpectation::from(&lease);
        let verified = verifying_provider
            .verify_authorized_lease_at(
                &lease,
                &expectation,
                AuthorizedLeaseConfig::default(),
                now_ms + 1,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect("verify with independently supplied service binding");
        assert_eq!(verified.lease(), &lease);
        assert_eq!(verified.verified_at_server_ms(), now_ms + 1);

        let mut wrong_binding = expectation;
        wrong_binding.query_key = "myHand:{game=2}".to_owned();
        let error = verifying_provider
            .verify_authorized_lease_at(
                &lease,
                &wrong_binding,
                AuthorizedLeaseConfig::default(),
                now_ms + 1,
                "local-dev-sqlite-ibex",
                "provider-test",
            )
            .expect_err("service binding must not be self-described by the lease");
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH"
        );
    }

    async fn request_and_code(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        email: &str,
        now_ms: u64,
    ) -> (RequestCodeResponse, String) {
        let admission = provider
            .admit_email(email)
            .await
            .expect("address admission");
        let response = admission
            .request_code(database, now_ms)
            .expect("request code");
        drop(admission);
        let mailbox = provider
            .mailbox_entry(&response.challenge_id)
            .await
            .expect("mailbox entry");
        let value = serde_json::to_value(mailbox).expect("serialize mailbox entry");
        let code = value
            .get("code")
            .and_then(Value::as_str)
            .expect("mailbox code")
            .to_owned();
        (response, code)
    }

    async fn exchange(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        challenge_id: &str,
        code: &str,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(database, challenge_id)?
            .expect("known challenge");
        admission
            .for_exchange(coordination)
            .await?
            .exchange(database, code, now_ms)
    }

    fn different_code(code: &str) -> String {
        let replacement = if code.as_bytes()[0] == b'0' { '1' } else { '0' };
        format!("{replacement}{}", &code[1..])
    }

    fn issue_token(issue: &CredentialIssue) -> String {
        let value = serde_json::to_value(issue.response()).expect("serialize credential");
        value
            .get("token")
            .and_then(Value::as_str)
            .expect("credential token")
            .to_owned()
    }

    async fn mint(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        email: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        provider
            .admit_email(email)
            .await
            .expect("mint admission")
            .mint_session(database, now_ms)
            .expect("mint session")
    }

    fn direct_stream_facts(database: &LocalDatabase) -> (u64, i64) {
        let version = database.current_version().expect("app version");
        let changes = database
            .with_auth_read(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM _snapback_changes", [], |row| {
                        row.get(0)
                    })
                    .map_err(SnapbackError::from)
            })
            .expect("journal count");
        (version, changes)
    }

    #[tokio::test]
    async fn request_code_has_exact_window_supersession_and_no_app_stream_effect() {
        let (provider, mut database) = provider_database(0);
        let mut responses = Vec::new();
        for _ in 0..AUTH_ADDRESS_REQUEST_LIMIT {
            let admission = provider
                .admit_email("Person@Example.com")
                .await
                .expect("admission");
            responses.push(
                admission
                    .request_code(&mut database, 0)
                    .expect("request inside limit"),
            );
        }
        let admission = provider
            .admit_email("person@example.com")
            .await
            .expect("admission");
        let error = admission
            .request_code(&mut database, 0)
            .expect_err("sixth rolling-window request must throttle");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        drop(admission);

        let first = provider
            .mailbox_entry(&responses[0].challenge_id)
            .await
            .expect_err("superseded plaintext must be erased");
        assert_eq!(
            first.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );
        provider
            .mailbox_entry(&responses.last().unwrap().challenge_id)
            .await
            .expect("newest entry remains published");

        let admission = provider
            .admit_email("PERSON@example.com")
            .await
            .expect("admission");
        admission
            .request_code(&mut database, AUTH_ADDRESS_REQUEST_WINDOW_MS)
            .expect("lower boundary is excluded");
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn capture_only_profiles_keep_global_budget_but_not_address_budget() {
        for profile in [AuthProviderProfile::Dev, AuthProviderProfile::Demo] {
            let (provider, mut database) = provider_database_for_profile(0, profile);
            for request in 0..(AUTH_ADDRESS_REQUEST_LIMIT + 2) {
                provider
                    .admit_email("repeat-demo@example.com")
                    .await
                    .expect("address admission")
                    .request_code(&mut database, 0)
                    .unwrap_or_else(|error| {
                        panic!(
                            "{profile:?} capture ceremony {request} unexpectedly failed: {}",
                            error.diagnostic().code
                        )
                    });
            }
        }

        // Test remains the production-shaped boundary fixture.
        let (provider, mut database) = provider_database_for_profile(0, AuthProviderProfile::Test);
        for _ in 0..AUTH_ADDRESS_REQUEST_LIMIT {
            provider
                .admit_email("bounded-test@example.com")
                .await
                .expect("address admission")
                .request_code(&mut database, 0)
                .expect("request inside test budget");
        }
        let error = provider
            .admit_email("bounded-test@example.com")
            .await
            .expect("address admission")
            .request_code(&mut database, 0)
            .expect_err("test profile must retain the exact address budget");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
    }

    #[tokio::test]
    async fn challenge_exchanges_through_its_retired_key_after_rotation() {
        let (provider, mut database) = provider_database(0);
        let rotation_at = super::super::keyring::AUTH_KEY_ROTATION_AGE_MS;
        let requested_at = rotation_at - 1;
        let (request, code) = request_and_code(
            &provider,
            &mut database,
            "pre-rotation@example.com",
            requested_at,
        )
        .await;

        assert!(
            provider
                .keyring
                .rotate_if_due(rotation_at, provider.random.as_ref())
                .expect("rotate keyring")
        );
        let issue = exchange(
            &provider,
            &mut database,
            &request.challenge_id,
            &code,
            rotation_at + 1,
        )
        .await
        .expect("stored challenge key remains usable after rotation");
        assert_eq!(issue.response().session.provider, "email-code");
    }

    #[tokio::test]
    async fn global_and_capture_budgets_hit_exact_boundaries_without_durable_overrun() {
        let (provider, mut database) = provider_database(0);
        for index in 0..AUTH_GLOBAL_REQUEST_LIMIT {
            provider
                .admit_email(&format!("global-{index}@example.com"))
                .await
                .expect("admission")
                .request_code(&mut database, 0)
                .expect("global request inside limit");
        }
        let global = provider
            .admit_email("global-over@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, 0)
            .expect_err("global overrun throttles");
        assert_eq!(global.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        provider
            .admit_email("global-recovered@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, AUTH_GLOBAL_REQUEST_WINDOW_MS)
            .expect("exact lower boundary is excluded");

        let (capacity_provider, mut capacity_database) = provider_database(0);
        for index in 0..super::super::mailbox::CAPTURE_MAILBOX_CAPACITY {
            capacity_provider
                .admit_email(&format!("capacity-{index}@example.com"))
                .await
                .expect("capacity admission")
                .request_code(
                    &mut capacity_database,
                    index as u64 * AUTH_GLOBAL_REQUEST_WINDOW_MS,
                )
                .expect("mailbox request inside capacity");
        }
        let capacity = capacity_provider
            .admit_email("capacity-over@example.com")
            .await
            .expect("capacity admission")
            .request_code(
                &mut capacity_database,
                super::super::mailbox::CAPTURE_MAILBOX_CAPACITY as u64
                    * AUTH_GLOBAL_REQUEST_WINDOW_MS,
            )
            .expect_err("mailbox overrun throttles");
        assert_eq!(capacity.diagnostic().code, "SNAPBACK_AUTH_THROTTLED");
        let durable: i64 = capacity_database
            .with_auth_read(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_verification_codes", [], |row| {
                        row.get(0)
                    })
                    .map_err(SnapbackError::from)
            })
            .expect("durable challenge count");
        assert_eq!(
            durable,
            super::super::mailbox::CAPTURE_MAILBOX_CAPACITY as i64
        );
        assert_eq!(direct_stream_facts(&capacity_database), (0, 0));
    }

    #[tokio::test]
    async fn exchange_commits_wrong_attempts_and_allows_correct_fifth_attempt() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let wrong = different_code(&code);

        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        for attempt in 1..AUTH_MAXIMUM_ATTEMPTS {
            let error = exchange
                .exchange(&mut database, &wrong, now_ms + attempt as u64)
                .expect_err("wrong attempt");
            assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        }
        let issue = exchange
            .exchange(&mut database, &code, now_ms + AUTH_MAXIMUM_ATTEMPTS as u64)
            .expect("correct fifth attempt");
        assert!(issue.committed_revocation.is_none());

        let error = exchange
            .exchange(
                &mut database,
                &code,
                now_ms + AUTH_MAXIMUM_ATTEMPTS as u64 + 1,
            )
            .expect_err("consumed challenge is uniformly invalid");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        drop(exchange);
        let mailbox = provider
            .mailbox_entry(&request.challenge_id)
            .await
            .expect_err("consume erases plaintext");
        assert_eq!(
            mailbox.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let facts = database
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT attempts FROM _auth_verification_codes WHERE challenge_id = ?1",
                        params![request.challenge_id],
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
            .expect("durable facts");
        assert_eq!(facts, (5, 1, 1, 1));
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn incorrect_fifth_attempt_commits_lock_and_later_attempts_do_not_mutate() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let wrong = different_code(&code);
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        for attempt in 1..AUTH_MAXIMUM_ATTEMPTS {
            let error = exchange
                .exchange(&mut database, &wrong, now_ms + attempt as u64)
                .expect_err("wrong attempt");
            assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        }
        let fifth = exchange
            .exchange(&mut database, &wrong, now_ms + AUTH_MAXIMUM_ATTEMPTS as u64)
            .expect_err("wrong fifth attempt locks");
        assert_eq!(fifth.diagnostic().code, "SNAPBACK_AUTH_CODE_LOCKED");
        let later = exchange
            .exchange(
                &mut database,
                &code,
                now_ms + AUTH_MAXIMUM_ATTEMPTS as u64 + 1,
            )
            .expect_err("locked challenge remains locked");
        assert_eq!(later.diagnostic().code, "SNAPBACK_AUTH_CODE_LOCKED");
        let (attempts, sessions): (i64, i64) = database
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT attempts FROM _auth_verification_codes WHERE challenge_id = ?1",
                        params![request.challenge_id],
                        |row| row.get(0),
                    )?,
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
                ))
            })
            .expect("locked facts");
        assert_eq!((attempts, sessions), (5, 0));
    }

    #[tokio::test]
    async fn observable_id_and_session_collisions_exhaust_exactly_three_candidates() {
        let now_ms = 1_700_000_000_000;
        let random = Arc::new(CountingConstantRandom::new(0x42));
        let (provider, mut database) = provider_database_with_random(now_ms, random.clone());
        let first = provider
            .admit_email("person@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, now_ms)
            .expect("first request");
        let fills_before_collision = random.fills();
        let collision = provider
            .admit_email("person@example.com")
            .await
            .expect("admission")
            .request_code(&mut database, now_ms + 1)
            .expect_err("constant challenge id exhausts retries");
        assert_eq!(
            collision.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(random.fills() - fills_before_collision, 6);
        provider
            .mailbox_entry(&first.challenge_id)
            .await
            .expect("colliding request did not supersede first");

        let session_random = Arc::new(CountingConstantRandom::new(0x24));
        let (session_provider, mut session_database) =
            provider_database_with_random(now_ms, session_random.clone());
        mint(
            &session_provider,
            &mut session_database,
            "person@example.com",
            now_ms,
        )
        .await;
        let fills_before_collision = session_random.fills();
        let collision = session_provider
            .admit_email("person@example.com")
            .await
            .expect("mint admission")
            .mint_session(&mut session_database, now_ms + 1)
            .expect_err("constant session ids exhaust retries");
        assert_eq!(
            collision.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(session_random.fills() - fills_before_collision, 15);
        let sessions: i64 = session_database
            .with_auth_read(|connection| {
                connection
                    .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))
                    .map_err(SnapbackError::from)
            })
            .expect("session count");
        assert_eq!(sessions, 1);
    }

    #[tokio::test]
    async fn superseded_and_unknown_challenges_share_uniform_invalid_outcome() {
        let now_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(now_ms);
        let (older, older_code) =
            request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
        let _ = request_and_code(&provider, &mut database, "PERSON@example.com", now_ms + 1).await;
        let error = exchange(
            &provider,
            &mut database,
            &older.challenge_id,
            &older_code,
            now_ms + 2,
        )
        .await
        .expect_err("superseded challenge");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");

        let unknown_id = ChallengeId::generate(&OsRandom).expect("unknown challenge id");
        let admission = provider.admit().await;
        assert!(
            admission
                .exchange_coordination(&database, unknown_id.as_str())
                .expect("unknown lookup")
                .is_none()
        );
        let error = admission
            .exchange_unknown(
                &mut database,
                unknown_id.as_str(),
                "123456",
                now_ms + 2,
                None,
            )
            .expect_err("unknown challenge");
        assert_eq!(error.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn stale_concurrent_exchange_and_refresh_admissions_linearize_once() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let (request, code) =
            request_and_code(&provider, &mut database, "person@example.com", start_ms).await;

        // Both preliminary reads happen before either exchange owns the
        // address stripe, modeling two outer requests admitted concurrently.
        let first_admission = provider.admit().await;
        let first_coordination = first_admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("first coordination")
            .expect("known challenge");
        let second_admission = provider.admit().await;
        let second_coordination = second_admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("second coordination")
            .expect("known challenge");
        let first_exchange = first_admission
            .for_exchange(first_coordination)
            .await
            .expect("first exchange lock");
        let first_issue = first_exchange
            .exchange(&mut database, &code, start_ms + 1)
            .expect("first exchange wins");
        drop(first_exchange);
        let second_exchange = second_admission
            .for_exchange(second_coordination)
            .await
            .expect("second exchange lock");
        let second = second_exchange
            .exchange(&mut database, &code, start_ms + 1)
            .expect_err("stale exchange recheck loses");
        assert_eq!(second.diagnostic().code, "SNAPBACK_AUTH_CODE_INVALID");
        drop(second_exchange);
        let counts: (i64, i64, i64) = database
            .with_auth_read(|connection| {
                Ok((
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_users", [], |row| row.get(0))?,
                    connection.query_row("SELECT COUNT(*) FROM _auth_identities", [], |row| {
                        row.get(0)
                    })?,
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
                ))
            })
            .expect("provision counts");
        assert_eq!(counts, (1, 1, 1));

        let predecessor = issue_token(&first_issue);
        let refresh_admission_a = provider.admit().await;
        let refresh_admission_b = provider.admit().await;
        let winner = refresh_admission_a
            .refresh(&mut database, &predecessor, start_ms + 2)
            .expect("first refresh wins");
        let successor = issue_token(&winner);
        let loser = refresh_admission_b
            .refresh(&mut database, &predecessor, start_ms + 2)
            .expect_err("second refresh observes tombstone");
        assert_eq!(loser.diagnostic().code, "SNAPBACK_AUTH_REFRESH_SUPERSEDED");
        let resolved = refresh_admission_b
            .resolve_session(&database, &successor, start_ms + 2)
            .expect("losing refresh did not revoke");
        assert_eq!(resolved.generation, 1);
        let (current, tombstones): (i64, i64) = database
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_sessions WHERE revoked_at_ms IS NULL",
                        [],
                        |row| row.get(0),
                    )?,
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_session_tokens",
                        [],
                        |row| row.get(0),
                    )?,
                ))
            })
            .expect("refresh facts");
        assert_eq!((current, tombstones), (1, 1));
    }

    #[tokio::test]
    async fn twenty_first_live_session_revokes_deterministic_oldest_in_same_commit() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let mut first_session_id = None;
        let mut first_token = None;
        let mut refreshed_oldest = None;
        let mut final_revocation = None;

        for index in 0..=AUTH_SESSION_LIVE_LIMIT {
            let now_ms = start_ms + index as u64 * AUTH_ADDRESS_REQUEST_WINDOW_MS;
            if index == AUTH_SESSION_LIVE_LIMIT {
                let admission = provider.admit().await;
                let refreshed = admission
                    .refresh(
                        &mut database,
                        first_token.as_deref().expect("first token"),
                        now_ms - 1,
                    )
                    .expect("refresh oldest immediately before cap race");
                refreshed_oldest = Some(issue_token(&refreshed));
            }
            let (request, code) =
                request_and_code(&provider, &mut database, "person@example.com", now_ms).await;
            let issue = exchange(
                &provider,
                &mut database,
                &request.challenge_id,
                &code,
                now_ms + 1,
            )
            .await
            .expect("exchange");
            if first_session_id.is_none() {
                first_session_id = Some(issue.response().session.id.clone());
                first_token = Some(issue_token(&issue));
            }
            final_revocation = issue.committed_revocation.clone();
        }

        let revocation = final_revocation.expect("21st session evicts oldest");
        assert_eq!(revocation.session_id, first_session_id.unwrap());
        assert_eq!(revocation.generation, 2);
        let now_ms = start_ms + AUTH_SESSION_LIVE_LIMIT as u64 * AUTH_ADDRESS_REQUEST_WINDOW_MS + 1;
        let (live, oldest_revoked): (i64, i64) = database
            .with_auth_read(|connection| {
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
                        params![revocation.session_id],
                        |row| row.get(0),
                    )?,
                ))
            })
            .expect("session cap facts");
        assert_eq!((live, oldest_revoked), (20, 1));
        let admission = provider.admit().await;
        let successor = refreshed_oldest.expect("oldest successor");
        let expired = admission
            .resolve_session(&database, &successor, now_ms)
            .expect_err("cap eviction wins after refresh");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let logout = admission
            .logout(&mut database, &successor, now_ms)
            .expect_err("logout loses to cap eviction");
        assert_eq!(logout.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &successor, now_ms);
        assert_eq!(restart_reason, RevocationReason::CapEviction);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::Carrier,
        );
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn refresh_and_ordinary_resolution_pin_the_supersession_matrix() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let initial = admission
            .resolve_session(&database, &predecessor, start_ms)
            .expect("current resolution");

        let rotated_at = start_ms + 1;
        let refreshed = admission
            .refresh(&mut database, &predecessor, rotated_at)
            .expect("refresh current bearer");
        let successor = issue_token(&refreshed);
        assert_ne!(predecessor, successor);
        let current = admission
            .resolve_session(&database, &successor, rotated_at)
            .expect("successor resolution");
        assert_eq!(current.session_id, initial.session_id);
        assert_eq!(current.user_id, initial.user_id);
        assert_eq!(current.identity_id, initial.identity_id);
        assert_eq!(current.generation, initial.generation);
        assert_eq!(current.authority_instance_id, initial.authority_instance_id);
        assert_eq!(current.expires_at_ms, initial.expires_at_ms);

        admission
            .resolve_session(
                &database,
                &predecessor,
                rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS,
            )
            .expect("ordinary use at exact grace is accepted");
        let inside = admission
            .refresh(
                &mut database,
                &predecessor,
                rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS,
            )
            .expect_err("refresh at exact grace is superseded without revoke");
        assert_eq!(inside.diagnostic().code, "SNAPBACK_AUTH_REFRESH_SUPERSEDED");
        admission
            .resolve_session(&database, &successor, rotated_at + 10_000)
            .expect("inside-grace refresh did not revoke successor");

        let after_grace = rotated_at + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let ordinary = admission
            .resolve_session(&database, &predecessor, after_grace)
            .expect_err("old ordinary credential after grace");
        assert_eq!(
            ordinary.diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        );
        let reuse = admission
            .refresh(&mut database, &predecessor, after_grace)
            .expect_err("old refresh after grace revokes family");
        assert_eq!(reuse.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (_, committed) = reuse.into_parts();
        let committed = committed.expect("reuse revocation fact");
        assert_eq!(committed.session_id, initial.session_id);
        assert_eq!(committed.generation, 2);
        let expired = admission
            .resolve_session(&database, &successor, after_grace)
            .expect_err("successor family was revoked");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        let malformed = admission
            .resolve_session(&database, "not-a-bearer", after_grace)
            .expect_err("malformed bearer");
        assert_eq!(malformed.diagnostic().code, "SNAPBACK_AUTH_REQUIRED");
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn generated_n_minus_two_and_three_traces_keep_all_predecessors_attributable() {
        let start_ms = 1_700_000_000_000;
        for depth in [2_u64, 3] {
            let (provider, mut database) = provider_database(start_ms);
            let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
            let oldest = issue_token(&issue);
            let admission = provider.admit().await;
            let initial = admission
                .resolve_session(&database, &oldest, start_ms)
                .expect("initial session");
            let mut current_token = oldest.clone();
            for generation in 1..=depth {
                let refreshed = admission
                    .refresh(&mut database, &current_token, start_ms + generation)
                    .expect("trace refresh");
                assert_eq!(refreshed.response().session.id, initial.session_id);
                assert_eq!(
                    refreshed.response().session.expires_at,
                    initial.expires_at_ms
                );
                current_token = issue_token(&refreshed);
                let current = admission
                    .resolve_session(&database, &current_token, start_ms + generation)
                    .expect("trace successor");
                assert_eq!(current.authority_instance_id, initial.authority_instance_id);
                assert_eq!(current.generation, 1);
            }

            // `oldest` is now N-2 or N-3. Its own tombstone age, not its
            // distance from current, controls the inclusive grace boundary.
            let superseded_at = start_ms + 1;
            let inside = superseded_at + AUTH_SESSION_SUPERSESSION_GRACE_MS;
            admission
                .resolve_session(&database, &oldest, inside)
                .expect("old predecessor ordinary use inside grace");
            let refresh_inside = admission
                .refresh(&mut database, &oldest, inside)
                .expect_err("old predecessor refresh inside grace");
            assert_eq!(
                refresh_inside.diagnostic().code,
                "SNAPBACK_AUTH_REFRESH_SUPERSEDED"
            );
            admission
                .resolve_session(&database, &current_token, inside)
                .expect("inside-grace reuse did not revoke current");

            let outside = inside + 1;
            let ordinary = admission
                .resolve_session(&database, &oldest, outside)
                .expect_err("old predecessor ordinary use outside grace");
            assert_eq!(
                ordinary.diagnostic().code,
                "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
            );
            let refresh_outside = admission
                .refresh(&mut database, &oldest, outside)
                .expect_err("old predecessor refresh outside grace");
            assert_eq!(
                refresh_outside.diagnostic().code,
                "SNAPBACK_AUTH_SESSION_EXPIRED"
            );
            let (_, revocation) = refresh_outside.into_parts();
            assert_eq!(
                revocation.expect("committed reuse revocation").generation,
                2
            );
            let expired = admission
                .resolve_session(&database, &current_token, outside)
                .expect_err("current revoked by attributable predecessor");
            assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
            let tombstones: i64 = database
                .with_auth_read(|connection| {
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_session_tokens", [], |row| {
                            row.get(0)
                        })
                        .map_err(SnapbackError::from)
                })
                .expect("tombstone count");
            assert_eq!(tombstones, depth as i64);
        }
    }

    #[tokio::test]
    async fn family_alarm_is_opaque_fixed_delay_and_attributable_only_to_tombstones() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let refreshed = admission
            .refresh(&mut database, &predecessor, start_ms + 1)
            .expect("refresh");
        let successor = issue_token(&refreshed);

        let before = Instant::now();
        let alarm = admission
            .family_alarm(&mut database, &predecessor, start_ms + 2)
            .expect("family alarm");
        let (response, deadline, committed) = alarm.into_parts();
        assert!(response.accepted);
        assert!(deadline >= before + Duration::from_millis(AUTH_FAMILY_ALARM_MINIMUM_MS));
        assert!(
            deadline
                <= before
                    + Duration::from_millis(
                        AUTH_FAMILY_ALARM_MINIMUM_MS + AUTH_FAMILY_ALARM_JITTER_MAXIMUM_MS + 5,
                    )
        );
        assert_eq!(committed.expect("alarm revocation").generation, 2);
        let expired = admission
            .resolve_session(&database, &successor, start_ms + 2)
            .expect_err("alarm revoked family");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        for suspect in [&predecessor[..], &successor[..], "malformed"] {
            let repeated = admission
                .family_alarm(&mut database, suspect, start_ms + 3)
                .expect("opaque repeated alarm");
            let (response, _, committed) = repeated.into_parts();
            assert!(response.accepted);
            assert!(committed.is_none());
        }
        let generation: i64 = database
            .with_auth_read(|connection| {
                connection
                    .query_row("SELECT generation FROM _auth_sessions", [], |row| {
                        row.get(0)
                    })
                    .map_err(SnapbackError::from)
            })
            .expect("alarm generation");
        assert_eq!(generation, 2, "duplicates never increment a revoked family");
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn lost_refresh_and_alarm_responses_preserve_attribution_and_idempotence() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;

        // Commit refresh and deliberately discard the only successor
        // plaintext, modeling a lost successful response.
        drop(
            admission
                .refresh(&mut database, &predecessor, start_ms + 1)
                .expect("lost refresh commit"),
        );
        let delayed_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let ordinary = admission
            .resolve_session(&database, &predecessor, delayed_at)
            .expect_err("lost successor cannot reconcile after grace");
        assert_eq!(
            ordinary.diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED"
        );

        // Treat the first opaque alarm response as lost too. Retrying the same
        // attributable predecessor is a no-op, but the first commit survives.
        let first_alarm = admission
            .family_alarm(&mut database, &predecessor, delayed_at)
            .expect("delayed alarm");
        assert_eq!(
            first_alarm
                .into_parts()
                .2
                .expect("delayed alarm revocation")
                .generation,
            2
        );
        let retry = admission
            .family_alarm(&mut database, &predecessor, delayed_at + 1)
            .expect("alarm retry after lost response");
        assert!(retry.into_parts().2.is_none());
        let (generation, revoked): (i64, bool) = database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT generation, revoked_at_ms IS NOT NULL FROM _auth_sessions",
                        [],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .map_err(SnapbackError::from)
            })
            .expect("lost-response facts");
        assert_eq!((generation, revoked), (2, true));
    }

    #[tokio::test]
    async fn logout_and_refresh_races_have_only_serializable_family_outcomes() {
        let start_ms = 1_700_000_000_000;

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "logout-first@example.com",
            start_ms,
        )
        .await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        assert_eq!(
            admission
                .logout(&mut database, &token, start_ms + 1)
                .expect("logout wins")
                .generation,
            2
        );
        let refresh = admission
            .refresh(&mut database, &token, start_ms + 1)
            .expect_err("refresh loses to logout");
        assert_eq!(refresh.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "refresh-first@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let refreshed = admission
            .refresh(&mut database, &predecessor, start_ms + 1)
            .expect("refresh wins");
        let successor = issue_token(&refreshed);
        assert_eq!(
            admission
                .logout(&mut database, &predecessor, start_ms + 1)
                .expect("logout resolves in-grace predecessor")
                .generation,
            2
        );
        let expired = admission
            .resolve_session(&database, &successor, start_ms + 1)
            .expect_err("logout revokes refreshed successor");
        assert_eq!(expired.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (generation, tombstones): (i64, i64) = database
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row("SELECT generation FROM _auth_sessions", [], |row| {
                        row.get(0)
                    })?,
                    connection.query_row(
                        "SELECT COUNT(*) FROM _auth_session_tokens",
                        [],
                        |row| row.get(0),
                    )?,
                ))
            })
            .expect("refresh-first facts");
        assert_eq!((generation, tombstones), (2, 1));
    }

    #[tokio::test]
    async fn sliding_use_coalesces_refresh_does_not_extend_and_logout_is_monotone() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        let resolved = admission
            .resolve_session(&database, &token, start_ms)
            .expect("resolve minted session");

        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + AUTH_SESSION_USE_COALESCE_MS - 1,
                )
                .expect("coalesced use"),
            AuthenticatedUse::Unchanged {
                expires_at_ms: resolved.expires_at_ms,
            }
        );
        let use_at = start_ms + AUTH_SESSION_USE_COALESCE_MS;
        let extended_expiry = use_at + AUTH_SESSION_SLIDING_WINDOW_MS;
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    use_at,
                )
                .expect("exact coalescing boundary"),
            AuthenticatedUse::Extended {
                expires_at_ms: extended_expiry,
            }
        );

        let refreshed = admission
            .refresh(&mut database, &token, use_at + 1)
            .expect("refresh after sliding use");
        assert_eq!(refreshed.response().session.expires_at, extended_expiry);
        let successor = issue_token(&refreshed);
        let revocation = admission
            .logout(&mut database, &successor, use_at + 2)
            .expect("logout current");
        assert_eq!(revocation.session_id, resolved.session_id);
        assert_eq!(revocation.generation, 2);
        let repeated = admission
            .logout(&mut database, &successor, use_at + 3)
            .expect_err("repeated logout");
        assert_eq!(repeated.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    use_at + 4,
                )
                .expect("revoked use"),
            AuthenticatedUse::NotLive
        );
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn generated_sliding_boundaries_cap_at_absolute_expiry_without_revival() {
        let start_ms = 1_700_000_000_000;
        for (delta, extends) in [
            (AUTH_SESSION_USE_COALESCE_MS - 1, false),
            (AUTH_SESSION_USE_COALESCE_MS, true),
            (AUTH_SESSION_USE_COALESCE_MS + 1, true),
        ] {
            let (provider, mut database) = provider_database(start_ms);
            let issue = mint(&provider, &mut database, "person@example.com", start_ms).await;
            let token = issue_token(&issue);
            let admission = provider.admit().await;
            let resolved = admission
                .resolve_session(&database, &token, start_ms)
                .expect("boundary session");
            let outcome = admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + delta,
                )
                .expect("boundary use");
            assert_eq!(
                matches!(outcome, AuthenticatedUse::Extended { .. }),
                extends
            );
        }

        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(&provider, &mut database, "absolute@example.com", start_ms).await;
        let token = issue_token(&issue);
        let admission = provider.admit().await;
        let resolved = admission
            .resolve_session(&database, &token, start_ms)
            .expect("absolute session");
        let day = 24 * 60 * 60 * 1_000;
        for day_offset in [29_u64, 58, 87] {
            let outcome = admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    start_ms + day_offset * day,
                )
                .expect("periodic sliding use");
            assert!(matches!(outcome, AuthenticatedUse::Extended { .. }));
        }
        let absolute = start_ms + AUTH_SESSION_ABSOLUTE_WINDOW_MS;
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    absolute,
                )
                .expect("exact absolute use"),
            AuthenticatedUse::NotLive
        );
        assert_eq!(
            admission
                .record_authenticated_use(
                    &mut database,
                    &resolved.session_id,
                    resolved.generation,
                    absolute + 1,
                )
                .expect("post-absolute use"),
            AuthenticatedUse::NotLive
        );
        let refresh = admission
            .refresh(&mut database, &token, absolute)
            .expect_err("refresh cannot revive at absolute expiry");
        assert_eq!(refresh.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let logout = admission
            .logout(&mut database, &token, absolute)
            .expect_err("logout sees expired session without mutation");
        assert_eq!(logout.diagnostic().code, "SNAPBACK_AUTH_SESSION_EXPIRED");
        let (last_used, expires, generation, revoked): (i64, i64, i64, bool) = database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT last_used_at_ms, expires_at_ms, generation,
                            revoked_at_ms IS NOT NULL
                     FROM _auth_sessions WHERE id = ?1",
                        params![resolved.session_id],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                    )
                    .map_err(SnapbackError::from)
            })
            .expect("absolute row");
        assert_eq!(last_used, (start_ms + 87 * day) as i64);
        assert_eq!(expires, absolute as i64);
        assert_eq!((generation, revoked), (1, false));
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn readiness_is_non_secret_resolution_survives_and_gc_uses_injected_dependencies() {
        let start_ms = 0;
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog()
            .expect("activate catalog");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(start_ms, &OsRandom)
            .expect("initial keyring");
        let clock = Arc::new(ManualClock::new(start_ms));
        let provider = Arc::new(
            AuthProvider::new_with_dependencies(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                clock.clone(),
            )
            .expect("provider"),
        );
        assert_eq!(provider.readiness(), AuthProviderReadiness::Available);

        let issue = provider
            .admit_email("person@example.com")
            .await
            .expect("mint admission")
            .mint_session(&mut database, start_ms)
            .expect("mint session");
        let token = issue_token(&issue);
        let challenge = provider
            .admit_email("gc@example.com")
            .await
            .expect("request admission")
            .request_code(&mut database, start_ms)
            .expect("request challenge");
        clock.set(AUTH_CHALLENGE_TTL_MS);
        let maintenance = provider.exclusive_maintenance().await;
        let gc = maintenance
            .run_gc_pass(&mut database, clock.epoch_ms())
            .expect("gc pass");
        assert_eq!(gc.challenges_deleted, 1);
        assert_eq!(gc.sessions_deleted, 0);
        assert_eq!(gc.mailbox_entries_pruned, 1);
        assert_eq!(gc.retired_keys_pruned, 0);
        assert!(!gc.immediate_retry);
        drop(maintenance);
        let mailbox = provider
            .mailbox_entry(&challenge.challenge_id)
            .await
            .expect_err("gc pruned capture plaintext");
        assert_eq!(
            mailbox.diagnostic().code,
            "SNAPBACK_AUTH_MAILBOX_ENTRY_NOT_FOUND"
        );

        let unavailable = Arc::new(
            AuthProvider::new(
                AuthProviderProfile::Test,
                Arc::new(AuthKeyringStore::in_memory()),
            )
            .expect("provider can bind for digest-only resolution"),
        );
        assert_eq!(unavailable.readiness(), AuthProviderReadiness::Unavailable);
        unavailable
            .admit()
            .await
            .resolve_session(&database, &token, start_ms)
            .expect("session digest resolution is keyring independent");
        let request = unavailable
            .admit_email("unavailable@example.com")
            .await
            .expect("request admission")
            .request_code(&mut database, start_ms)
            .expect_err("issuance fails closed without keyring");
        assert_eq!(
            request.diagnostic().code,
            "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE"
        );
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }

    #[tokio::test]
    async fn planned_logout_uses_exact_generation_and_token_cas() {
        let start_ms = 10_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "planned-logout@example.com",
            start_ms,
        )
        .await;
        let bearer = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedLogout::Revoke(plan) = admission
            .plan_logout(&database, &bearer, start_ms + 1)
            .expect("logout plan")
        else {
            panic!("current bearer must plan a revocation");
        };
        let committed = admission.commit_planned_revocation(&mut database, &plan, start_ms + 1);
        assert!(matches!(
            committed,
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &bearer, start_ms + 1);
        assert_eq!(restart_reason, RevocationReason::Logout);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
        let loser = admission.commit_planned_revocation(&mut database, &plan, start_ms + 1);
        assert!(matches!(
            loser,
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: Some(RevocationReason::Logout),
            })
        ));
        database
            .with_auth_transaction(|transaction| {
                transaction.execute(
                    "DELETE FROM _snapback_meta WHERE key = ?1",
                    params![
                        crate::auth::session_projection::SessionTerminalCauseRecord::meta_key(
                            plan.session_id()
                        )?
                    ],
                )?;
                Ok(())
            })
            .expect("simulate a legacy terminal row without a cause witness");
        assert!(matches!(
            admission.commit_planned_revocation(&mut database, &plan, start_ms + 1),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: None,
            })
        ));
    }

    #[tokio::test]
    async fn planned_refresh_returns_plaintext_only_after_exact_rotation_commit() {
        let start_ms = 20_000;
        let (provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "planned-refresh@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(plan) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("refresh plan")
        else {
            panic!("current bearer must plan rotation");
        };
        let successor_digest = plan.successor_digest();
        let superseded_at_ms = plan.superseded_at_ms();
        let attempt = admission.commit_planned_rotation(&mut database, &plan.commit_plan());
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            attempt
        else {
            panic!("exact rotation must commit");
        };
        assert_eq!(superseded_at_ms, start_ms + 1);
        let issue = plan.into_issue(session);
        let successor = issue_token(&issue);
        assert_eq!(
            TokenDigest::from_token_hash(&SessionBearer::parse(&successor).unwrap().token_hash()),
            successor_digest
        );
        admission
            .resolve_session(&database, &successor, start_ms + 2)
            .expect("successor resolves after commit");
        assert!(matches!(
            admission
                .plan_refresh(&database, &predecessor, start_ms + 2)
                .expect("predecessor refresh plan"),
            PlannedRefresh::SupersededInsideGrace
        ));
        let reuse_at = superseded_at_ms + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let PlannedRefresh::ReuseRevoke(reuse) = admission
            .plan_refresh(&database, &predecessor, reuse_at)
            .expect("reuse revocation plan")
        else {
            panic!("out-of-grace predecessor must revoke its family");
        };
        assert!(matches!(
            admission.commit_planned_revocation(&mut database, &reuse, reuse_at),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &successor, reuse_at);
        assert_eq!(restart_reason, RevocationReason::RefreshReuse);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
    }

    #[tokio::test]
    async fn planned_family_alarm_never_skips_the_dummy_writer_shape() {
        let start_ms = 30_000;
        let (provider, mut database) = provider_database(start_ms);
        let admission = provider.admit().await;
        let dummy = admission
            .plan_family_alarm(&database, "malformed", start_ms)
            .expect("dummy plan");
        assert!(!dummy.actionable);
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &dummy),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
        ));

        let issue = mint(
            &provider,
            &mut database,
            "planned-alarm@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("rotation plan")
        else {
            panic!("current bearer must rotate");
        };
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan())
        else {
            panic!("rotation commit");
        };
        drop(rotation.into_issue(session));
        let alarm_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let alarm = admission
            .plan_family_alarm(&database, &predecessor, alarm_at)
            .expect("actionable alarm plan");
        assert!(alarm.actionable);
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &alarm),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(
                SessionRevocation { generation: 2, .. }
            ))
        ));
        let restart_reason =
            projected_terminal_reason_after_restart(&mut database, &predecessor, alarm_at);
        assert_eq!(restart_reason, RevocationReason::FamilyAlarm);
        assert_eq!(
            restart_reason.authority_disposition(),
            TerminalAuthorityDisposition::DurableDelete,
        );
    }

    #[tokio::test]
    async fn malformed_family_alarm_is_non_actionable_even_if_dummy_digest_is_a_tombstone() {
        let start_ms = 35_000;
        let (mut provider, mut database) = provider_database(start_ms);
        let issue = mint(
            &provider,
            &mut database,
            "dummy-collision@example.com",
            start_ms,
        )
        .await;
        let predecessor = issue_token(&issue);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &predecessor, start_ms + 1)
            .expect("rotation plan")
        else {
            panic!("current bearer must rotate");
        };
        let AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed { session }) =
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan())
        else {
            panic!("rotation commit");
        };
        drop(rotation.into_issue(session));
        drop(admission);

        let predecessor_hash = SessionBearer::parse(&predecessor).unwrap().token_hash();
        Arc::get_mut(&mut provider)
            .expect("test owns the provider")
            .dummy_token_hash = predecessor_hash;
        let admission = provider.admit().await;
        let alarm_at = start_ms + 1 + AUTH_SESSION_SUPERSESSION_GRACE_MS + 1;
        let alarm = admission
            .plan_family_alarm(&database, "malformed", alarm_at)
            .expect("malformed alarm plan");
        assert!(!alarm.actionable, "parse failure dominates digest lookup");
        assert!(matches!(
            admission.commit_planned_family_alarm(&mut database, &alarm),
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
        ));
        let revoked: i64 = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT revoked_at_ms IS NOT NULL FROM _auth_sessions WHERE id = ?1",
                    params![issue.response().session.id],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(revoked, 0, "malformed alarm did not revoke the family");
    }

    #[tokio::test]
    async fn planned_issuance_and_rotation_report_cross_table_candidate_collisions_without_writes()
    {
        let now_ms = 36_000;
        let (provider, mut database) = provider_database(now_ms);
        let first = mint(&provider, &mut database, "first@example.com", now_ms).await;
        let first_id = first.response().session.id.clone();

        let issuance = provider.admit_email("second@example.com").await.unwrap();
        let issuance_plan = issuance.plan_mint_session(&database, now_ms + 1).unwrap();
        let issuance_commit = issuance_plan.commit_plan();
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                     VALUES(?1, ?2, ?3)",
                    params![
                        issuance_commit.projected.token_digest.as_bytes().as_slice(),
                        first_id,
                        now_ms as i64,
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            issuance.commit_planned_issuance(&mut database, &issuance_commit),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CandidateCollision)
        ));
        let second_exists: i64 = database
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT COUNT(*) FROM _auth_identities WHERE subject = 'second@example.com'",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(second_exists, 0, "collision precedes every issuance write");

        let bearer = issue_token(&first);
        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, &bearer, now_ms + 2)
            .unwrap()
        else {
            panic!("rotation plan");
        };
        database
            .with_auth_transaction(|tx| {
                tx.execute(
                    "INSERT INTO _auth_session_tokens(token_hash, session_id, superseded_at_ms)
                     VALUES(?1, ?2, ?3)",
                    params![
                        rotation.successor.token_hash.as_bytes().as_slice(),
                        first.response().session.id,
                        (now_ms + 1) as i64,
                    ],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            admission.commit_planned_rotation(&mut database, &rotation.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedRotationCommit::CandidateCollision)
        ));
        admission
            .resolve_session(&database, &bearer, now_ms + 3)
            .expect("collision leaves the rotation predecessor current");
    }

    #[tokio::test]
    async fn planned_issuance_reconciles_exact_predecessor_and_successor() {
        let now_ms = 40_000;
        let (provider, mut database) = provider_database(now_ms);
        let admission = provider
            .admit_email("planned-issuance@example.com")
            .await
            .expect("issuance admission");
        let plan = admission
            .plan_mint_session(&database, now_ms)
            .expect("issuance plan");
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_planned_issuance(connection, &commit_plan))
                .expect("predecessor reconciliation"),
            DurableIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(&mut database, &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                committed_revocation: None,
                ..
            })
        ));
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_planned_issuance(connection, &commit_plan))
                .expect("successor reconciliation"),
            DurableIssuanceReconcile::ExactSuccessor {
                committed_revocation: None,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn planned_issuance_atomically_binds_sender_key_proof_and_initial_nonce() {
        let now_ms = 45_000;
        let (provider, mut database) = provider_database(now_ms);
        database
            .initialize_sender_proof_after_hosted_preflight()
            .expect("initialize hosted sender authority");
        let admission = provider
            .admit_email("sender-issuance@example.com")
            .await
            .expect("issuance admission");
        let mut plan = admission
            .plan_mint_session(&database, now_ms)
            .expect("issuance plan");
        let commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [3; 16],
                jwk_thumbprint: URL_SAFE_NO_PAD.encode([4_u8; 32]),
                issued_at_seconds: now_ms / 1_000,
            },
            now_ms / 1_000,
            120,
        )
        .expect("sender commitment");
        let expected_nonce = commitment.initial_nonce_for_transport().to_owned();
        plan.bind_sender_issuance(commitment, &OsRandom)
            .expect("bind sender issuance to plan");
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_planned_issuance(connection, &commit_plan))
                .expect("sender predecessor reconciliation"),
            DurableIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(&mut database, &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_planned_issuance(connection, &commit_plan))
                .expect("sender successor reconciliation"),
            DurableIssuanceReconcile::ExactSuccessor { .. }
        ));
        let facts: (i64, i64, i64, String) = database
            .with_auth_read(|connection| {
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
                    connection.query_row(
                        "SELECT nonce FROM _snapback_sender_nonce",
                        [],
                        |row| row.get(0),
                    )?,
                ))
            })
            .expect("atomic sender issuance facts");
        assert_eq!(facts, (1, 1, 1, expected_nonce));
    }

    // @ref LLP 0077#issuance-refresh-and-recovery — one live family per
    // thumbprint. A second valid issuance over an already-bound key must
    // refuse with a committed SenderKeyBound outcome (not a nonce-table
    // constraint surfaced as INTERNAL_AUTH_STATE), consume only its proof id,
    // and leave the incumbent family untouched; once the incumbent's nonce
    // cell expires the same thumbprint issues again.
    #[tokio::test]
    async fn planned_issuance_refuses_a_second_family_for_a_live_thumbprint() {
        let now_ms = 45_000;
        let (provider, mut database) = provider_database(now_ms);
        database
            .initialize_sender_proof_after_hosted_preflight()
            .expect("initialize hosted sender authority");
        let thumbprint = URL_SAFE_NO_PAD.encode([4_u8; 32]);

        let first_admission = provider
            .admit_email("sender-key-bound-first@example.com")
            .await
            .expect("first issuance admission");
        let mut first_plan = first_admission
            .plan_mint_session(&database, now_ms)
            .expect("first issuance plan");
        let first_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [3; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: now_ms / 1_000,
            },
            now_ms / 1_000,
            120,
        )
        .expect("first sender commitment");
        let incumbent_nonce = first_commitment.initial_nonce_for_transport().to_owned();
        first_plan
            .bind_sender_issuance(first_commitment, &OsRandom)
            .expect("bind first sender issuance");
        assert!(matches!(
            first_admission.commit_planned_issuance(&mut database, &first_plan.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));

        let second_admission = provider
            .admit_email("sender-key-bound-second@example.com")
            .await
            .expect("second issuance admission");
        let mut second_plan = second_admission
            .plan_mint_session(&database, now_ms + 1)
            .expect("second issuance plan");
        let second_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [5; 16],
                jwk_thumbprint: thumbprint.clone(),
                issued_at_seconds: (now_ms + 1) / 1_000,
            },
            (now_ms + 1) / 1_000,
            120,
        )
        .expect("second sender commitment");
        second_plan
            .bind_sender_issuance(second_commitment, &OsRandom)
            .expect("bind second sender issuance");
        let second_commit_plan = second_plan.commit_plan();
        assert!(matches!(
            second_admission.commit_planned_issuance(&mut database, &second_commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::SenderKeyBound)
        ));

        let facts: (i64, i64, i64, String, i64) = database
            .with_auth_read(|connection| {
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
                        "SELECT COUNT(*) FROM _snapback_sender_nonce",
                        [],
                        |row| row.get(0),
                    )?,
                    connection.query_row(
                        "SELECT nonce FROM _snapback_sender_nonce",
                        [],
                        |row| row.get(0),
                    )?,
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
                ))
            })
            .expect("key-bound refusal facts");
        // One binding and one session (the incumbent's), both proof ids
        // consumed, and the incumbent's generation-one nonce untouched.
        assert_eq!(
            facts,
            (1, 2, 1, incumbent_nonce, 1),
            "a key-bound refusal consumes only its proof id"
        );

        // Past the incumbent nonce's lifetime the cell is expired: the same
        // thumbprint issues a fresh family again (install garbage-collects the
        // expired cell ahead of its insert).
        let later_ms = now_ms + 200_000;
        let third_admission = provider
            .admit_email("sender-key-bound-third@example.com")
            .await
            .expect("third issuance admission");
        let mut third_plan = third_admission
            .plan_mint_session(&database, later_ms)
            .expect("third issuance plan");
        let third_commitment = SenderIssuanceCommitment::new(
            VerifiedSenderIssuance {
                proof_id: [7; 16],
                jwk_thumbprint: thumbprint,
                issued_at_seconds: later_ms / 1_000,
            },
            later_ms / 1_000,
            120,
        )
        .expect("third sender commitment");
        third_plan
            .bind_sender_issuance(third_commitment, &OsRandom)
            .expect("bind third sender issuance");
        assert!(matches!(
            third_admission.commit_planned_issuance(&mut database, &third_plan.commit_plan()),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
    }

    #[tokio::test]
    async fn planned_exchange_verifies_and_accounts_inside_the_issuance_transaction() {
        let now_ms = 50_000;
        let (provider, mut database) = provider_database(now_ms);
        let (request, code) = request_and_code(
            &provider,
            &mut database,
            "planned-exchange@example.com",
            now_ms,
        )
        .await;
        let wrong = different_code(&code);
        let admission = provider.admit().await;
        let coordination = admission
            .exchange_coordination(&database, &request.challenge_id)
            .expect("coordination")
            .expect("known challenge");
        let exchange = admission
            .for_exchange(coordination)
            .await
            .expect("exchange admission");
        let PlannedExchange::Issue(plan) = exchange
            .plan_exchange(&database, &wrong, now_ms + 1)
            .expect("live challenge plans a coordinated attempt")
        else {
            panic!("a wrong code is not authorized by the read-only planning pass");
        };
        let commit_plan = plan.commit_plan();
        assert!(matches!(
            exchange.commit_planned_issuance(&mut database, &commit_plan, &wrong),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeInvalid)
        ));
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_rejected_issuance(connection, &commit_plan))
                .expect("rejected successor reconciliation"),
            DurableRejectedIssuanceReconcile::ExactSuccessor
        ));
        let facts: (i64, i64) = database
            .with_auth_read(|connection| {
                Ok((
                    connection.query_row(
                        "SELECT attempts FROM _auth_verification_codes WHERE challenge_id = ?1",
                        params![request.challenge_id],
                        |row| row.get(0),
                    )?,
                    connection
                        .query_row("SELECT COUNT(*) FROM _auth_sessions", [], |row| row.get(0))?,
                ))
            })
            .expect("rejected exchange facts");
        assert_eq!(facts, (1, 0));

        let PlannedExchange::Issue(retry) = exchange
            .plan_exchange(&database, &code, now_ms + 2)
            .expect("correct retry plan")
        else {
            panic!("live correct retry plans issuance");
        };
        assert!(matches!(
            exchange.commit_planned_issuance(&mut database, &retry.commit_plan(), &code),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
    }

    #[tokio::test]
    async fn planned_twenty_first_session_revokes_the_exact_oldest_predecessor() {
        let start_ms = 60_000;
        let (provider, mut database) = provider_database(start_ms);
        let mut oldest_token = None;
        for offset in 0..AUTH_SESSION_LIVE_LIMIT {
            let issue = mint(
                &provider,
                &mut database,
                "planned-cap@example.com",
                start_ms + offset as u64,
            )
            .await;
            if offset == 0 {
                oldest_token = Some(issue_token(&issue));
            }
        }
        let oldest: String = database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT id FROM _auth_sessions
                         WHERE revoked_at_ms IS NULL ORDER BY created_at_ms, id LIMIT 1",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(SnapbackError::from)
            })
            .expect("oldest session");
        let admission = provider
            .admit_email("planned-cap@example.com")
            .await
            .expect("cap admission");
        let plan = admission
            .plan_mint_session(&database, start_ms + AUTH_SESSION_LIVE_LIMIT as u64)
            .expect("cap issuance plan");
        let logout_admission = provider.admit().await;
        let PlannedLogout::Revoke(losing_logout) = logout_admission
            .plan_logout(
                &database,
                oldest_token.as_deref().expect("oldest bearer"),
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            )
            .expect("plan concurrent logout of oldest")
        else {
            panic!("oldest bearer must still be current before cap commit");
        };
        assert_eq!(
            plan.eviction().map(ProviderRevocationPlan::session_id),
            Some(oldest.as_str())
        );
        let commit_plan = plan.commit_plan();
        let AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
            committed_revocation: Some(revocation),
            ..
        }) = admission.commit_planned_issuance(&mut database, &commit_plan)
        else {
            panic!("twenty-first issuance must commit exact cap eviction");
        };
        assert_eq!(revocation.session_id, oldest);
        assert_eq!(revocation.generation, 2);
        assert!(matches!(
            logout_admission.commit_planned_revocation(
                &mut database,
                &losing_logout,
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            ),
            AuthTransactionAttempt::Committed(PlannedRevocationCommit::AlreadyTerminal {
                generation: 2,
                reason: Some(RevocationReason::CapEviction),
            })
        ));
        assert!(matches!(
            database
                .with_auth_read(|connection| reconcile_planned_issuance(connection, &commit_plan))
                .expect("cap successor reconciliation"),
            DurableIssuanceReconcile::ExactSuccessor {
                committed_revocation: Some(SessionRevocation { generation: 2, .. }),
                ..
            }
        ));
        let live: i64 = database
            .with_auth_read(|connection| {
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM _auth_sessions WHERE revoked_at_ms IS NULL",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(SnapbackError::from)
            })
            .expect("live session count");
        assert_eq!(live, AUTH_SESSION_LIVE_LIMIT as i64);
    }
}
