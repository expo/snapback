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

use tokio::sync::{
    Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard,
    RwLock as AsyncRwLock, Semaphore,
};
use uuid::Uuid;
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, OsRandom, RandomSource,
    SessionBearer, StepUpDigest, StepUpProof, TokenHash, VerificationCode,
};
use super::keyring::AuthKeyringStore;
use super::lease::{
    AuthorizedLease, AuthorizedLeaseAuthenticator, AuthorizedLeaseConfig,
    AuthorizedLeaseExpectation, AuthorizedLeaseIssue, VerifiedAuthorizedLease,
};
use super::lifecycle::KeyringGcResult;
use super::mailbox::{CaptureMailbox, CaptureMailboxEntry};
use super::session_projection::ProjectedSessionInsert;
use super::throttle::{
    AuthBudgetDeploymentProfile, ResolvedCompatibilityAuthBudgetPolicy,
    ServerVerifiedAuthTrustEvidence, derive_auth_trust_tier,
};
use super::wire::{
    CredentialResponse, FamilyAlarmResponse, MailboxResponse, RequestCodeResponse, SessionResponse,
};
pub use crate::contract_types::{
    AuthProviderProfile, AuthenticatedUse, ResolvedSession, SessionRevocation,
};
use crate::contract_types::{
    AuthSessionRecord as SessionRecord, CatalogIssuanceReconcile,
    ExchangeChallengeFact, PlannedIdentityState, RejectedExchangeOutcome, RequestInsertOutcome,
    RevocationReason, SessionCapFacts, SessionIssuanceFacts, SessionRevocationCandidateFact,
    TokenDigest,
};
pub(crate) use crate::contract_types::PresentedSessionLookup;
pub(crate) use crate::contract_types::{
    DurableRejectedIssuanceReconcile, DurableRevocationReconcile, DurableRotationReconcile,
    PlannedFamilyAlarmCommit, PlannedRevocationCommit, PlannedRotationTransaction,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use crate::storage::auth::AuthTransactionAttempt;
use crate::storage::auth_catalog_ops::{
    CatalogChallengeConsumption, CatalogFamilyAlarmPlan, CatalogIssuanceCommit,
    CatalogPasswordChangeCommit, CatalogPasswordChangePlan, CatalogPasswordChangeReconcile,
    CatalogProjectedSession, CatalogRejectedExchangePlan, CatalogRevocationPlan,
    CatalogRotationPlan, CatalogSessionIssuancePlan, CatalogStepUpBinding, INTERNAL_AUTH_COLLISION,
    internal_state_snapback,
};

pub const AUTH_ADDRESS_STRIPES: usize = 256;
pub const AUTH_MAX_COLLISION_ATTEMPTS: usize = 3;
pub const AUTH_CHALLENGE_TTL_MS: u64 = 10 * 60 * 1_000;
// @ref LLP 0039#dated-amendment-operation-bound-step-up-2026-07-15 — the
// non-production proof is deliberately shorter than an ordinary login code.
pub const AUTH_STEP_UP_TTL_MS: u64 = 5 * 60 * 1_000;
pub use super::throttle::{
    AUTH_ADDRESS_REQUEST_LIMIT, AUTH_ADDRESS_REQUEST_WINDOW_MS, AUTH_GLOBAL_REQUEST_LIMIT,
    AUTH_GLOBAL_REQUEST_WINDOW_MS, AUTH_MAXIMUM_ATTEMPTS,
};
pub const AUTH_SESSION_SLIDING_WINDOW_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_ABSOLUTE_WINDOW_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_REFRESH_CADENCE_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
pub const AUTH_SESSION_SUPERSESSION_GRACE_MS: u64 = 10 * 1_000;
pub const AUTH_SESSION_LIVE_LIMIT: usize = 20;
pub const AUTH_SESSION_USE_COALESCE_MS: u64 = 3 * 24 * 60 * 60 * 1_000;
pub const AUTH_FAMILY_ALARM_MINIMUM_MS: u64 = 20;
pub const AUTH_FAMILY_ALARM_JITTER_MAXIMUM_MS: u64 = 5;
const MAX_SAFE_TIMESTAMP: u64 = crate::contract_types::AUTH_MAX_SAFE_TIMESTAMP;

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

impl From<AuthProviderProfile> for AuthBudgetDeploymentProfile {
    fn from(profile: AuthProviderProfile) -> Self {
        match profile {
            AuthProviderProfile::Dev => Self::Dev,
            AuthProviderProfile::Test => Self::Test,
            AuthProviderProfile::Demo => Self::Demo,
            AuthProviderProfile::Prod => Self::Prod,
        }
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
    pub(crate) user_id: String,
    pub(crate) session_id: String,
    pub(crate) session_generation: u64,
    pub(crate) authority_instance_id: String,
    pub(crate) operation: &'static str,
    pub(crate) target_id: String,
}

impl StepUpBinding {
    fn catalog_binding(&self) -> CatalogStepUpBinding<'_> {
        CatalogStepUpBinding {
            user_id: &self.user_id,
            session_id: &self.session_id,
            session_generation: self.session_generation,
            authority_instance_id: &self.authority_instance_id,
        }
    }

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

    /// Bind a fresh-authentication proof to minting one creation invitation
    /// from this exact session. The target is server-derived because the
    /// route never names an existing agent principal.
    ///
    /// @ref LLP 0055#re-credentialing-recovery-and-the-production-profile-invariant — a stolen
    /// session bearer alone must not mint a durable agent-creation secret.
    pub(crate) fn agent_invitation(
        user_id: String,
        session_id: String,
        session_generation: u64,
        authority_instance_id: String,
    ) -> Self {
        Self {
            user_id,
            session_id,
            session_generation,
            authority_instance_id,
            operation: "agentInvitation",
            target_id: "creation".to_owned(),
        }
    }

    pub(crate) fn password_set(
        user_id: String,
        session_id: String,
        session_generation: u64,
        authority_instance_id: String,
        email_identity_id: String,
    ) -> Self {
        Self {
            user_id,
            session_id,
            session_generation,
            authority_instance_id,
            operation: "passwordSet",
            target_id: email_identity_id,
        }
    }

    /// Bind fresh authentication to approval of one exact pending effect.
    // @ref LLP 0204#d95--approval-gated-effects — authority-creating effects
    // reuse the existing operation-bound, single-use step-up ceremony.
    pub(crate) fn effect_approval(
        user_id: String,
        session_id: String,
        session_generation: u64,
        authority_instance_id: String,
        effect_id: String,
    ) -> Self {
        Self {
            user_id,
            session_id,
            session_generation,
            authority_instance_id,
            operation: "effectApproval",
            target_id: effect_id,
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

    pub(crate) fn address(&self) -> &CanonicalAddress {
        &self.proof.address
    }
}

impl fmt::Debug for StepUpProofAdmission {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpProofAdmission([REDACTED])")
    }
}

impl fmt::Debug for ExchangeCoordination {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ExchangeCoordination([REDACTED])")
    }
}

impl ExchangeCoordination {
    pub(crate) fn address(&self) -> &CanonicalAddress {
        &self.address
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

    pub(crate) fn with_recovery_codes(
        mut self,
        recovery_codes: Option<crate::auth::identity_core::RecoveryCodes>,
    ) -> Self {
        self.response = self.response.with_recovery_codes(recovery_codes);
        self
    }

    #[allow(dead_code)] // Staged first-class password routes consume this payload next.
    pub(crate) fn recovery_codes(&self) -> Option<&crate::auth::identity_core::RecoveryCodes> {
        self.response.recovery_codes()
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

impl From<snapback_types::diagnostic::SnapbackError> for ProviderError {
    fn from(error: snapback_types::diagnostic::SnapbackError) -> Self {
        Self::new(error.into())
    }
}

pub type ProviderResult<T> = Result<T, ProviderError>;

#[allow(dead_code)] // Staged first-class password routes select custody next.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PasswordIssuanceCustody {
    Bearer,
    SenderConstrained,
}
pub(crate) struct SessionCandidate {
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

pub(crate) struct BearerCandidate {
    bearer: Option<SessionBearer>,
    token_hash: TokenHash,
}

impl fmt::Debug for BearerCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("BearerCandidate([REDACTED])")
    }
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

    fn catalog_plan(&self) -> CatalogRevocationPlan<'_> {
        CatalogRevocationPlan {
            session_id: &self.session_id,
            expected_generation: self.expected_generation,
            presented_digest: self.presented_digest,
            superseded_at_ms: match self.source {
                PlannedTokenSource::Current => None,
                PlannedTokenSource::Superseded { superseded_at_ms } => Some(superseded_at_ms),
            },
            reason: self.reason,
        }
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

impl ProviderTokenRotationCommitPlan {
    fn catalog_plan(&self) -> CatalogRotationPlan<'_> {
        CatalogRotationPlan {
            session_id: &self.session_id,
            expected_generation: self.expected_generation,
            predecessor_digest: self.predecessor_digest,
            successor_digest: self.successor_digest,
            superseded_at_ms: self.superseded_at_ms,
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

#[allow(dead_code)] // Staged first-class password change route consumes this carrier next.
pub(crate) struct ProviderPasswordChangePlan {
    mutation: crate::storage::auth_identity::PasswordChangeCommitPlan,
    rotation: ProviderTokenRotationPlan,
    revocations: Vec<ProviderRevocationPlan>,
    password_profile: crate::storage::auth_identity::PasswordSecurityProfile,
}

/// Read-only password planning facts captured under the managed Local lane.
/// These carriers contain no caller plaintext; Argon2 consumes them only
/// after the Local guard has been released.
pub(crate) struct PasswordRegistrationPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
}

pub(crate) struct PasswordAuthenticationPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
    predecessor: crate::storage::auth_identity::PasswordAuthenticationPredecessor,
    revocations: Vec<ProviderRevocationPlan>,
}

pub(crate) struct PasswordSetPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
    planning: crate::storage::auth_identity::PasswordSetPlanning,
    revocations: Vec<ProviderRevocationPlan>,
}

pub(crate) struct PasswordChangePreparation {
    planning: crate::storage::auth_identity::PasswordChangePlanning,
    revocations: Vec<ProviderRevocationPlan>,
}

pub(crate) enum PasswordResetPreparation {
    ChallengeRejected,
    PrincipalInvalid,
    Ready {
        plan: ProviderSessionIssuancePlan,
        email_identity_id: String,
        credential: crate::storage::auth_identity::PasswordSnapshot,
    },
}

impl fmt::Debug for PasswordRegistrationPreparation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasswordRegistrationPreparation([REDACTED])")
    }
}

impl fmt::Debug for PasswordAuthenticationPreparation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasswordAuthenticationPreparation([REDACTED])")
    }
}

impl fmt::Debug for PasswordSetPreparation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasswordSetPreparation([REDACTED])")
    }
}

impl fmt::Debug for PasswordChangePreparation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PasswordChangePreparation([REDACTED])")
    }
}

impl PasswordChangePreparation {
    pub(crate) fn canonical_identifier(&self) -> &str {
        &self.planning.canonical_identifier
    }
}

impl fmt::Debug for PasswordResetPreparation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ChallengeRejected => {
                formatter.write_str("PasswordResetPreparation::ChallengeRejected")
            }
            Self::PrincipalInvalid => {
                formatter.write_str("PasswordResetPreparation::PrincipalInvalid")
            }
            Self::Ready { .. } => {
                formatter.write_str("PasswordResetPreparation::Ready([REDACTED])")
            }
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ProviderPasswordChangeCommitPlan {
    mutation: crate::storage::auth_identity::PasswordChangeCommitPlan,
    rotation: ProviderTokenRotationCommitPlan,
    revocations: Vec<ProviderRevocationPlan>,
    password_profile: crate::storage::auth_identity::PasswordSecurityProfile,
}

impl fmt::Debug for ProviderPasswordChangePlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderPasswordChangePlan([REDACTED])")
    }
}

#[allow(dead_code)]
impl ProviderPasswordChangePlan {
    pub(crate) fn rotation(&self) -> &ProviderTokenRotationPlan {
        &self.rotation
    }

    pub(crate) fn revocations(&self) -> &[ProviderRevocationPlan] {
        &self.revocations
    }

    pub(crate) fn commit_plan(&self) -> ProviderPasswordChangeCommitPlan {
        ProviderPasswordChangeCommitPlan {
            mutation: self.mutation.clone(),
            rotation: self.rotation.commit_plan(),
            revocations: self.revocations.clone(),
            password_profile: self.password_profile,
        }
    }

    pub(crate) fn into_issue(self, session: SessionResponse) -> CredentialIssue {
        self.rotation.into_issue(session)
    }
}

impl ProviderPasswordChangeCommitPlan {
    fn catalog_plan(&self) -> CatalogPasswordChangePlan<'_> {
        CatalogPasswordChangePlan {
            mutation: &self.mutation,
            rotation: self.rotation.catalog_plan(),
            revocations: self
                .revocations
                .iter()
                .map(ProviderRevocationPlan::catalog_plan)
                .collect(),
            password_profile: self.password_profile,
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) enum PlannedPasswordChangeCommit {
    Committed {
        session: SessionResponse,
        committed_revocations: Vec<SessionRevocation>,
    },
    CredentialInvalid {
        committed_attempt: Option<crate::storage::auth_identity::PasswordAttemptState>,
    },
    CredentialThrottled,
    CandidateCollision,
    PredecessorChanged,
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

    fn catalog_plan(&self) -> CatalogFamilyAlarmPlan<'_> {
        CatalogFamilyAlarmPlan {
            revocation: CatalogRevocationPlan {
                session_id: &self.session_id,
                expected_generation: self.expected_generation,
                presented_digest: self.presented_digest,
                superseded_at_ms: Some(self.superseded_at_ms),
                reason: RevocationReason::FamilyAlarm,
            },
            observed_at_ms: self.observed_at_ms,
            actionable: self.actionable,
        }
    }
}

pub(crate) enum PlannedRotationCommit {
    Committed { session: SessionResponse },
    CandidateCollision,
    PredecessorChanged,
}

pub(crate) struct ProviderSessionIssuancePlan {
    address: CanonicalAddress,
    now_ms: u64,
    identity: PlannedIdentityState,
    candidate: SessionCandidate,
    projected: ProjectedSessionInsert,
    revocations: Vec<ProviderRevocationPlan>,
    password: Option<crate::storage::auth_identity::PasswordIssuanceCommitPlan>,
    password_profile: Option<crate::storage::auth_identity::PasswordSecurityProfile>,
    recovery_codes: Option<crate::auth::identity_core::RecoveryCodes>,
    challenge: Option<PlannedChallengeConsumption>,
    sender_issuance: Option<crate::auth::sender_proof::SenderIssuanceCommitment>,
    rehearsal_exercise: Option<crate::storage::auth_rehearsal::RehearsalExercisePlan>,
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
    pub(crate) projected: ProjectedSessionInsert,
    revocations: Vec<ProviderRevocationPlan>,
    password: Option<crate::storage::auth_identity::PasswordIssuanceCommitPlan>,
    password_profile: Option<crate::storage::auth_identity::PasswordSecurityProfile>,
    challenge: Option<PlannedChallengeConsumption>,
    pub(crate) sender_issuance: Option<crate::auth::sender_proof::SenderIssuanceCommitment>,
    rehearsal_exercise: Option<crate::storage::auth_rehearsal::RehearsalExercisePlan>,
}

impl fmt::Debug for ProviderSessionIssuanceCommitPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderSessionIssuanceCommitPlan([REDACTED])")
    }
}

impl ProviderSessionIssuancePlan {
    /// Bind a planned provider issuance to rehearsal authority before the
    /// coordinator premarks it. The protected companion and the projected
    /// deadline therefore describe the same session at every later phase.
    ///
    /// @ref LLP 0213#derived-sessions — derived expiry is clamped to the
    ///   governing authority and the exact provenance survives projection.
    pub(crate) fn bind_rehearsal_provenance(
        &mut self,
        provenance: crate::auth::rehearsal::AuthRehearsalProvenanceV1,
        governing_not_after_ms: u64,
    ) -> ProviderResult<()> {
        provenance.validate().map_err(ProviderError::from)?;
        if governing_not_after_ms <= self.now_ms || self.projected.rehearsal_provenance.is_some() {
            return Err(ProviderError::from(
                crate::auth::rehearsal::authority_ended(),
            ));
        }
        self.projected.expires_at_ms = self.projected.expires_at_ms.min(governing_not_after_ms);
        self.projected.absolute_expires_at_ms = self
            .projected
            .absolute_expires_at_ms
            .min(governing_not_after_ms);
        self.projected.rehearsal_provenance = Some(provenance);
        Ok(())
    }

    pub(crate) fn bind_rehearsal_effect(
        &mut self,
        exercise: crate::storage::auth_rehearsal::RehearsalExercisePlan,
    ) -> ProviderResult<()> {
        if self.projected.rehearsal_provenance.is_none()
            || self.rehearsal_exercise.replace(exercise).is_some()
        {
            return Err(ProviderError::from(
                crate::auth::rehearsal::authority_ended(),
            ));
        }
        Ok(())
    }

    pub(crate) fn creates_identity(&self) -> bool {
        matches!(self.identity, PlannedIdentityState::Create { .. })
    }

    pub(crate) fn planned_identity(&self) -> PlannedIdentityState {
        self.identity.clone()
    }

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
        let bearer =
            SessionBearer::generate_sender_v2(random).map_err(|_| provider_unavailable())?;
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
        self.revocations
            .iter()
            .find(|revocation| revocation.reason() == RevocationReason::CapEviction)
    }

    pub(crate) fn revocations(&self) -> &[ProviderRevocationPlan] {
        &self.revocations
    }

    pub(crate) fn commit_plan(&self) -> ProviderSessionIssuanceCommitPlan {
        ProviderSessionIssuanceCommitPlan {
            address: self.address.clone(),
            now_ms: self.now_ms,
            identity: self.identity.clone(),
            projected: self.projected.clone(),
            revocations: self.revocations.clone(),
            password: self.password.clone(),
            password_profile: self.password_profile,
            challenge: self.challenge.clone(),
            sender_issuance: self.sender_issuance.clone(),
            rehearsal_exercise: self.rehearsal_exercise.clone(),
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
            revocations: Vec::new(),
            password: None,
            password_profile: None,
            recovery_codes: None,
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        }
    }

    pub(crate) fn into_issue(
        mut self,
        session: SessionResponse,
        committed_revocations: Vec<SessionRevocation>,
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
        let cap_revocation = self.eviction().and_then(|eviction| {
            committed_revocations
                .iter()
                .find(|revocation| revocation.session_id == eviction.session_id())
                .cloned()
        });
        CredentialIssue::new(
            CredentialResponse::new(bearer, refresh_after, session),
            cap_revocation,
        )
        .with_recovery_codes(self.recovery_codes.take())
    }
}

impl ProviderSessionIssuanceCommitPlan {
    fn catalog_plan(&self) -> CatalogSessionIssuancePlan<'_> {
        CatalogSessionIssuancePlan {
            address: &self.address,
            now_ms: self.now_ms,
            identity: &self.identity,
            projected: CatalogProjectedSession {
                session_id: &self.projected.session_id,
                user_id: &self.projected.user_id,
                provider: &self.projected.provider,
                authority_instance_id: &self.projected.authority_instance_id,
                generation: self.projected.generation,
                token_digest: self.projected.token_digest,
                created_at_ms: self.projected.created_at_ms,
                expires_at_ms: self.projected.expires_at_ms,
                absolute_expires_at_ms: self.projected.absolute_expires_at_ms,
                rehearsal_provenance: self.projected.rehearsal_provenance.as_ref(),
            },
            revocations: self
                .revocations
                .iter()
                .map(ProviderRevocationPlan::catalog_plan)
                .collect(),
            password: self.password.as_ref(),
            password_profile: self.password_profile,
            challenge: self
                .challenge
                .as_ref()
                .map(|challenge| CatalogChallengeConsumption {
                    challenge_id: &challenge.challenge_id,
                    key_id: &challenge.key_id,
                    code_digest: &challenge.code_digest,
                    expected_attempts: challenge.expected_attempts,
                    max_attempts: challenge.max_attempts,
                    expires_at_ms: challenge.expires_at_ms,
                }),
            sender_issuance: self.sender_issuance.as_ref(),
            rehearsal_exercise: self.rehearsal_exercise.as_ref(),
            live_session_limit: AUTH_SESSION_LIVE_LIMIT as u64,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) enum PlannedIssuanceCommit {
    Committed {
        session: SessionResponse,
        committed_revocations: Vec<SessionRevocation>,
    },
    CodeInvalid,
    CodeLocked,
    CredentialInvalid {
        committed_attempt: Option<crate::storage::auth_identity::PasswordAttemptState>,
    },
    CredentialThrottled,
    // @ref LLP 0077#issuance-refresh-and-recovery — one live family per
    // thumbprint: a valid proof over an already-bound key consumes its proof
    // id and refuses without touching the challenge, session, or nonce state.
    SenderKeyBound,
    CandidateCollision,
    PredecessorChanged,
    RehearsalReplay(serde_json::Value),
    RehearsalDenied(SnapbackError),
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
    budgets: ResolvedCompatibilityAuthBudgetPolicy,
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
    #[allow(dead_code)] // Password route registration lands in the adjacent lane.
    password_security: crate::storage::auth_identity::PasswordSecurityProfile,
    #[allow(dead_code)]
    password_kdf_permits: Arc<Semaphore>,
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

#[allow(dead_code)] // Password route integration consumes the staged core methods next.
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

    pub(crate) fn new_with_password_minimum(
        profile: AuthProviderProfile,
        keyring: Arc<AuthKeyringStore>,
        minimum_password_length: u16,
    ) -> ProviderResult<Self> {
        Self::new_with_dependencies_and_password_minimum(
            profile,
            keyring,
            Arc::new(OsRandom),
            Arc::new(SystemAuthClock),
            minimum_password_length,
        )
    }

    pub fn new_with_dependencies(
        profile: AuthProviderProfile,
        keyring: Arc<AuthKeyringStore>,
        random: Arc<dyn RandomSource>,
        clock: Arc<dyn AuthClock>,
    ) -> ProviderResult<Self> {
        Self::new_with_dependencies_and_password_minimum(
            profile,
            keyring,
            random,
            clock,
            crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT,
        )
    }

    fn new_with_dependencies_and_password_minimum(
        profile: AuthProviderProfile,
        keyring: Arc<AuthKeyringStore>,
        random: Arc<dyn RandomSource>,
        clock: Arc<dyn AuthClock>,
        minimum_password_length: u16,
    ) -> ProviderResult<Self> {
        let dummy_key =
            AuthKeyMaterial::generate(random.as_ref()).map_err(|_| provider_unavailable())?;
        let dummy_address = CanonicalAddress::parse("invalid@snapback.invalid")
            .expect("the fixed dummy auth address is valid");
        let dummy_bearer =
            SessionBearer::generate(random.as_ref()).map_err(|_| provider_unavailable())?;
        let dummy_token_hash = dummy_bearer.token_hash();
        let mailbox_clock = clock.clone();
        // Compatibility starts at the anonymous tier. Stronger server-derived
        // evidence has a sealed derivation seam in the budget layer, but this
        // migration intentionally applies one finite term table to every tier.
        let budgets = ResolvedCompatibilityAuthBudgetPolicy::resolve(
            profile.into(),
            derive_auth_trust_tier(ServerVerifiedAuthTrustEvidence::Anonymous),
        );
        let mailbox = CaptureMailbox::new_with_clock_and_capacity(
            Arc::new(move || mailbox_clock.monotonic_now()),
            budgets.mailbox().limit as usize,
        );
        let password_security =
            crate::storage::auth_identity::PasswordSecurityProfile::for_provider(profile)
                .with_minimum_password_length(minimum_password_length)?;
        Ok(Self {
            profile,
            budgets,
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
            password_security,
            password_kdf_permits: Arc::new(Semaphore::new(password_security.kdf_concurrency)),
        })
    }

    pub fn profile(&self) -> AuthProviderProfile {
        self.profile
    }

    pub(crate) fn budget_policy(&self) -> ResolvedCompatibilityAuthBudgetPolicy {
        self.budgets
    }

    pub(crate) const fn password_security_profile(
        &self,
    ) -> crate::storage::auth_identity::PasswordSecurityProfile {
        self.password_security
    }

    /// Run one password creation hash on the bounded blocking pool. Admission
    /// is non-queueing: resource exhaustion is a typed throttle refusal, so an
    /// attacker cannot turn the async executor into an unbounded 19-MiB/hash
    /// memory queue.
    ///
    /// @ref LLP 0214#73-password-processing-outside-the-storage-lock — no
    ///   SQLite guard is held while Argon2id runs.
    pub(crate) async fn hash_password_bounded(
        &self,
        secret: crate::auth::identity_core::PasswordSecret,
    ) -> SnapbackResult<crate::storage::auth_identity::PreparedPasswordHash> {
        let permit = Arc::clone(&self.password_kdf_permits)
            .try_acquire_owned()
            .map_err(|_| password_kdf_throttled())?;
        let random = Arc::clone(&self.random);
        let password_security = self.password_security;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            crate::storage::auth_identity::hash_password_on_blocking_pool_with_profile(
                &secret,
                random.as_ref(),
                password_security,
            )
        })
        .await
        .map_err(|_| provider_unavailable().into_snapback_error())?
    }

    /// Verify a real or dummy predecessor and, when necessary, prepare the
    /// upgrade hash inside the same bounded blocking job. The caller supplies
    /// only a snapshot string read before this call; the writer transaction is
    /// opened later and must still enforce the exact credential generation.
    pub(crate) async fn verify_password_bounded(
        &self,
        secret: crate::auth::identity_core::PasswordSecret,
        hash_phc: String,
        prepare_upgrade: bool,
    ) -> SnapbackResult<crate::storage::auth_identity::PreparedPasswordVerification> {
        let permit = Arc::clone(&self.password_kdf_permits)
            .try_acquire_owned()
            .map_err(|_| password_kdf_throttled())?;
        let random = Arc::clone(&self.random);
        let verification_floor =
            Duration::from_millis(self.password_security.verification_floor_ms);
        let password_security = self.password_security;
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let started = Instant::now();
            let result = crate::storage::auth_identity::verify_password_on_blocking_pool(
                &secret,
                &hash_phc,
                prepare_upgrade,
                random.as_ref(),
                password_security,
            );
            if let Some(remaining) = verification_floor.checked_sub(started.elapsed()) {
                std::thread::sleep(remaining);
            }
            result
        })
        .await
        .map_err(|_| provider_unavailable().into_snapback_error())?
    }

    /// Prepare first-class local-password signup without opening the writer
    /// transaction. The returned carrier enters the same projection and
    /// durable issuance protocol as email-code exchange.
    pub(crate) fn prepare_password_registration(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<PasswordRegistrationPreparation> {
        require_password_bearer_custody(custody)?;
        let mode = database.auth_password_identifier_mode()?;
        let canonical =
            crate::storage::auth_identity::canonical_password_identifier_value(mode, identifier)?;
        let address = CanonicalAddress::parse(&canonical).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                "auth",
                "password identifier does not satisfy the declared mode",
            )
        })?;
        Ok(PasswordRegistrationPreparation {
            mode,
            canonical,
            address,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn finish_password_registration(
        &self,
        preparation: PasswordRegistrationPreparation,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        validate_now(now_ms).map_err(ProviderError::into_snapback_error)?;
        let PasswordRegistrationPreparation {
            mode,
            canonical,
            address,
        } = preparation;
        let password = self.hash_password_bounded(password).await?;
        let (recovery_codes, recovery) = crate::storage::auth_identity::prepare_recovery_set(
            self.random.as_ref(),
            recovery_key_id,
            recovery_key,
        )?;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let identity = PlannedIdentityState::Create {
            identity_id: candidate.identity_id.clone(),
            user_id: candidate.user_id.clone(),
        };
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: candidate.user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        let password = crate::storage::auth_identity::PasswordIssuanceCommitPlan {
            canonical_identifier: canonical,
            identifier_mode: mode,
            identity_id: candidate.identity_id.clone(),
            user_id: candidate.user_id.clone(),
            operation: crate::storage::auth_identity::PasswordIssuanceOperation::Register {
                credential_id: opaque_catalog_component("credential"),
                password,
                recovery,
            },
        };
        Ok(ProviderSessionIssuancePlan {
            address,
            now_ms,
            identity,
            candidate,
            projected,
            revocations: Vec::new(),
            password: Some(password),
            password_profile: Some(self.password_security),
            recovery_codes: Some(recovery_codes),
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
    }

    pub(crate) async fn finish_password_registration_with_active_recovery_key(
        &self,
        preparation: PasswordRegistrationPreparation,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        let (key_id, key) = self
            .keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                (
                    key_id.as_str().to_owned(),
                    Zeroizing::new(*key.expose_secret()),
                )
            })
            .map_err(|_| provider_unavailable().into_snapback_error())?;
        self.finish_password_registration(preparation, password, now_ms, &key_id, &key, custody)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn plan_password_registration(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        let preparation = self.prepare_password_registration(database, identifier, custody)?;
        self.finish_password_registration(
            preparation,
            password,
            now_ms,
            recovery_key_id,
            recovery_key,
            custody,
        )
        .await
    }

    /// Snapshot, spend exactly one real-or-dummy KDF outside SQLite, then
    /// prepare a credential-fenced issuance. A missing account and a real
    /// predecessor have the same KDF and candidate-allocation envelope.
    pub(crate) fn prepare_password_authentication(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<PasswordAuthenticationPreparation> {
        require_password_bearer_custody(custody)?;
        validate_now(now_ms).map_err(ProviderError::into_snapback_error)?;
        let mode = database.auth_password_identifier_mode()?;
        let canonical =
            crate::storage::auth_identity::canonical_password_identifier_value(mode, identifier)?;
        let address = CanonicalAddress::parse(&canonical).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                "auth",
                "password identifier does not satisfy the declared mode",
            )
        })?;
        let predecessor = database.password_authentication_predecessor(&canonical, mode)?;
        let revocations = match predecessor.credential.as_ref() {
            Some(snapshot) => {
                classify_session_cap(database.auth_catalog_read().session_cap_facts(
                    &snapshot.user_id,
                    now_ms,
                    AUTH_SESSION_LIVE_LIMIT as u64,
                )?)?
                .into_iter()
                .collect()
            }
            None => Vec::new(),
        };
        Ok(PasswordAuthenticationPreparation {
            mode,
            canonical,
            address,
            predecessor,
            revocations,
        })
    }

    pub(crate) async fn finish_password_authentication(
        &self,
        preparation: PasswordAuthenticationPreparation,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        let PasswordAuthenticationPreparation {
            mode,
            canonical,
            address,
            predecessor,
            revocations,
        } = preparation;
        let _lock_observed_at_admission = predecessor
            .ledger
            .as_ref()
            .and_then(|attempt| attempt.locked_until_ms)
            .is_some_and(|until| now_ms < until);
        let credential = predecessor.credential;
        let hash_phc = credential.as_ref().map_or_else(
            || crate::storage::auth_identity::dummy_password_phc().to_owned(),
            |snapshot| snapshot.hash_phc.clone(),
        );
        let verification = self
            .verify_password_bounded(password, hash_phc, credential.is_some())
            .await?;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let identity = match &credential {
            Some(snapshot) => PlannedIdentityState::Existing {
                identity_id: snapshot.identity_id.clone(),
                user_id: snapshot.user_id.clone(),
            },
            None => PlannedIdentityState::Create {
                identity_id: candidate.identity_id.clone(),
                user_id: candidate.user_id.clone(),
            },
        };
        let (user_id, identity_id) = match &identity {
            PlannedIdentityState::Existing {
                identity_id,
                user_id,
            }
            | PlannedIdentityState::Create {
                identity_id,
                user_id,
            } => (user_id.clone(), identity_id.clone()),
        };
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        Ok(ProviderSessionIssuancePlan {
            address,
            now_ms,
            identity,
            candidate,
            projected,
            revocations,
            password: Some(crate::storage::auth_identity::PasswordIssuanceCommitPlan {
                canonical_identifier: canonical,
                identifier_mode: mode,
                identity_id,
                user_id,
                operation: crate::storage::auth_identity::PasswordIssuanceOperation::Authenticate {
                    credential,
                    admission_ledger: predecessor.ledger,
                    verified: verification.verified,
                    replacement: verification.replacement,
                },
            }),
            password_profile: Some(self.password_security),
            recovery_codes: None,
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
    }

    pub(crate) async fn plan_password_authentication(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        let preparation =
            self.prepare_password_authentication(database, identifier, now_ms, custody)?;
        self.finish_password_authentication(preparation, password, now_ms, custody)
            .await
    }

    pub(crate) async fn finish_password_reset(
        &self,
        preparation: PasswordResetPreparation,
        replacement: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<Option<ProviderSessionIssuancePlan>> {
        require_password_bearer_custody(custody)?;
        let PasswordResetPreparation::Ready {
            mut plan,
            email_identity_id,
            credential,
        } = preparation
        else {
            return Ok(None);
        };
        let replacement = self.hash_password_bounded(replacement).await?;
        let user_id = credential.user_id.clone();
        let identity_id = credential.identity_id.clone();
        plan.identity = PlannedIdentityState::Existing {
            identity_id: identity_id.clone(),
            user_id: user_id.clone(),
        };
        plan.projected.user_id = user_id.clone();
        plan.projected.provider = "local-password".to_owned();
        plan.password = Some(crate::storage::auth_identity::PasswordIssuanceCommitPlan {
            canonical_identifier: plan.address.as_str().to_owned(),
            identifier_mode: credential.identifier_mode,
            identity_id,
            user_id,
            operation: crate::storage::auth_identity::PasswordIssuanceOperation::Reset {
                email_identity_id,
                credential,
                replacement,
            },
        });
        plan.password_profile = Some(self.password_security);
        debug_assert_eq!(plan.now_ms, now_ms);
        Ok(Some(plan))
    }

    pub(crate) fn commit_password_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        if plan.password.is_none() || plan.challenge.is_some() || plan.sender_issuance.is_some() {
            return AuthTransactionAttempt::RolledBack(internal_state_snapback());
        }
        attempt_planned_session_issuance(database, plan, None)
    }

    pub(crate) fn prepare_password_set(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        email_identity_id: &str,
        identifier: &str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<PasswordSetPreparation> {
        require_password_bearer_custody(custody)?;
        validate_now(now_ms).map_err(ProviderError::into_snapback_error)?;
        let mode = database.auth_password_identifier_mode()?;
        let canonical =
            crate::storage::auth_identity::canonical_password_identifier_value(mode, identifier)?;
        let address = CanonicalAddress::parse(&canonical).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                "auth",
                "password identifier does not satisfy the declared mode",
            )
        })?;
        let planning =
            database.password_set_planning(acting, email_identity_id, &canonical, now_ms)?;
        let mut revocations = plan_user_session_revocations(
            database,
            &planning.predecessor.acting_user_id,
            None,
            None,
            now_ms,
        )?;
        if let Some(displaced) = &planning.displaced {
            for revocation in plan_user_session_revocations(
                database,
                &displaced.user_id,
                None,
                Some(&displaced.identity_id),
                now_ms,
            )? {
                if !revocations
                    .iter()
                    .any(|existing| existing.session_id() == revocation.session_id())
                {
                    revocations.push(revocation);
                }
            }
        }
        Ok(PasswordSetPreparation {
            mode,
            canonical,
            address,
            planning,
            revocations,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn finish_password_set(
        &self,
        preparation: PasswordSetPreparation,
        step_up: StepUpProof,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        let PasswordSetPreparation {
            mode,
            canonical,
            address,
            planning,
            revocations,
        } = preparation;
        let password = self.hash_password_bounded(password).await?;
        let (recovery_codes, recovery) = crate::storage::auth_identity::prepare_recovery_set(
            self.random.as_ref(),
            recovery_key_id,
            recovery_key,
        )?;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let user_id = planning.predecessor.acting_user_id.clone();
        let identity_id = candidate.identity_id.clone();
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        let password = crate::storage::auth_identity::PasswordIssuanceCommitPlan {
            canonical_identifier: canonical,
            identifier_mode: mode,
            identity_id: identity_id.clone(),
            user_id: user_id.clone(),
            operation: crate::storage::auth_identity::PasswordIssuanceOperation::Set {
                predecessor: planning.predecessor,
                displaced: planning.displaced,
                step_up,
                credential_id: opaque_catalog_component("credential"),
                password,
                recovery,
            },
        };
        Ok(ProviderSessionIssuancePlan {
            address,
            now_ms,
            identity: PlannedIdentityState::Create {
                identity_id,
                user_id,
            },
            candidate,
            projected,
            revocations,
            password: Some(password),
            password_profile: Some(self.password_security),
            recovery_codes: Some(recovery_codes),
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
    }

    pub(crate) async fn finish_password_set_with_active_recovery_key(
        &self,
        preparation: PasswordSetPreparation,
        step_up: StepUpProof,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        let (key_id, key) = self
            .keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                (
                    key_id.as_str().to_owned(),
                    Zeroizing::new(*key.expose_secret()),
                )
            })
            .map_err(|_| provider_unavailable().into_snapback_error())?;
        self.finish_password_set(
            preparation,
            step_up,
            password,
            now_ms,
            &key_id,
            &key,
            custody,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn plan_password_set(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        email_identity_id: &str,
        step_up: StepUpProof,
        identifier: &str,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        let preparation = self.prepare_password_set(
            database,
            acting,
            email_identity_id,
            identifier,
            now_ms,
            custody,
        )?;
        self.finish_password_set(
            preparation,
            step_up,
            password,
            now_ms,
            recovery_key_id,
            recovery_key,
            custody,
        )
        .await
    }

    pub(crate) fn prepare_password_change(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<PasswordChangePreparation> {
        require_password_bearer_custody(custody)?;
        validate_now(now_ms).map_err(ProviderError::into_snapback_error)?;
        let planning = database.password_change_planning(acting, now_ms)?;
        if planning.sender_constrained {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED",
                "auth",
                "password authentication does not support sender-constrained custody",
            ));
        }
        let revocations = plan_user_session_revocations(
            database,
            &planning.credential.user_id,
            Some(&planning.acting_session_id),
            None,
            now_ms,
        )?;
        Ok(PasswordChangePreparation {
            planning,
            revocations,
        })
    }

    pub(crate) async fn finish_password_change(
        &self,
        preparation: PasswordChangePreparation,
        current: crate::auth::identity_core::PasswordSecret,
        replacement: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderPasswordChangePlan> {
        require_password_bearer_custody(custody)?;
        let PasswordChangePreparation {
            planning,
            revocations,
        } = preparation;
        let verification = self
            .verify_password_bounded(current, planning.credential.hash_phc.clone(), false)
            .await?;
        let replacement = self.hash_password_bounded(replacement).await?;
        let successor =
            BearerCandidate::generate(self).map_err(ProviderError::into_snapback_error)?;
        let rotation = ProviderTokenRotationPlan {
            session_id: planning.acting_session_id.clone(),
            expected_generation: planning.acting_generation,
            predecessor_digest: planning.acting_token_digest,
            successor_digest: TokenDigest::from_token_hash(&successor.token_hash),
            superseded_at_ms: now_ms,
            successor,
        };
        Ok(ProviderPasswordChangePlan {
            mutation: crate::storage::auth_identity::PasswordChangeCommitPlan {
                credential: planning.credential,
                canonical_identifier: planning.canonical_identifier,
                verified: verification.verified,
                replacement,
            },
            rotation,
            revocations,
            password_profile: self.password_security,
        })
    }

    pub(crate) async fn plan_password_change(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        current: crate::auth::identity_core::PasswordSecret,
        replacement: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderPasswordChangePlan> {
        let preparation = self.prepare_password_change(database, acting, now_ms, custody)?;
        self.finish_password_change(preparation, current, replacement, now_ms, custody)
            .await
    }

    pub(crate) fn commit_password_change(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderPasswordChangeCommitPlan,
    ) -> AuthTransactionAttempt<PlannedPasswordChangeCommit> {
        attempt_planned_password_change(database, plan)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn plan_guest_claim_password(
        &self,
        database: &LocalDatabase,
        guest: &SessionBearer,
        identifier: &str,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        let mode = database.auth_password_identifier_mode()?;
        let canonical =
            crate::storage::auth_identity::canonical_password_identifier_value(mode, identifier)?;
        let address = CanonicalAddress::parse(&canonical).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                "auth",
                "password identifier does not satisfy the declared mode",
            )
        })?;
        let predecessor = database.guest_claim_predecessor(guest, now_ms)?;
        let password = self.hash_password_bounded(password).await?;
        let (recovery_codes, recovery) = crate::storage::auth_identity::prepare_recovery_set(
            self.random.as_ref(),
            recovery_key_id,
            recovery_key,
        )?;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let user_id = predecessor.user_id.clone();
        let identity_id = candidate.identity_id.clone();
        let revocations = plan_user_session_revocations(database, &user_id, None, None, now_ms)?;
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        Ok(ProviderSessionIssuancePlan {
            address,
            now_ms,
            identity: PlannedIdentityState::Create {
                identity_id: identity_id.clone(),
                user_id: user_id.clone(),
            },
            candidate,
            projected,
            revocations,
            password: Some(crate::storage::auth_identity::PasswordIssuanceCommitPlan {
                canonical_identifier: canonical,
                identifier_mode: mode,
                identity_id,
                user_id,
                operation: crate::storage::auth_identity::PasswordIssuanceOperation::GuestClaim {
                    predecessor,
                    credential_id: opaque_catalog_component("credential"),
                    password,
                    recovery,
                },
            }),
            password_profile: Some(self.password_security),
            recovery_codes: Some(recovery_codes),
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
    }

    #[allow(clippy::too_many_arguments)] // Recovery proof, replacement set, and custody cross one fence.
    pub(crate) fn plan_password_recovery_consume(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        code: &str,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        let mode = database.auth_password_identifier_mode()?;
        let canonical =
            crate::storage::auth_identity::canonical_password_identifier_value(mode, identifier)?;
        let address = CanonicalAddress::parse(&canonical).map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                "auth",
                "password identifier does not satisfy the declared mode",
            )
        })?;
        let predecessor =
            database.recovery_code_predecessor(&canonical, code, recovery_key_id, recovery_key)?;
        let (recovery_codes, successor_recovery) =
            crate::storage::auth_identity::prepare_recovery_set(
                self.random.as_ref(),
                recovery_key_id,
                recovery_key,
            )?;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let revocations =
            plan_user_session_revocations(database, &predecessor.user_id, None, None, now_ms)?;
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: predecessor.user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        let identity_id = predecessor.identity_id.clone();
        let user_id = predecessor.user_id.clone();
        Ok(ProviderSessionIssuancePlan {
            address,
            now_ms,
            identity: PlannedIdentityState::Existing {
                identity_id: identity_id.clone(),
                user_id: user_id.clone(),
            },
            candidate,
            projected,
            revocations,
            password: Some(crate::storage::auth_identity::PasswordIssuanceCommitPlan {
                canonical_identifier: canonical,
                identifier_mode: mode,
                identity_id,
                user_id,
                operation:
                    crate::storage::auth_identity::PasswordIssuanceOperation::RecoveryConsume {
                        predecessor,
                        successor_credential_id: opaque_catalog_component("recovery"),
                        successor_recovery,
                    },
            }),
            password_profile: Some(self.password_security),
            recovery_codes: Some(recovery_codes),
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
    }

    pub(crate) fn plan_password_recovery_consume_with_active_key(
        &self,
        database: &LocalDatabase,
        identifier: &str,
        code: &str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        self.keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                self.plan_password_recovery_consume(
                    database,
                    identifier,
                    code,
                    now_ms,
                    key_id.as_str(),
                    key.expose_secret(),
                    custody,
                )
            })
            .map_err(|_| provider_unavailable().into_snapback_error())?
    }

    pub(crate) fn plan_password_recovery_rotate_with_active_key(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderSessionIssuancePlan> {
        require_password_bearer_custody(custody)?;
        let planning = database.password_change_planning(acting, now_ms)?;
        if planning.sender_constrained {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED",
                "auth",
                "password authentication does not support sender-constrained custody",
            ));
        }
        let (recovery_codes, successor_recovery) = self
            .keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                crate::storage::auth_identity::prepare_recovery_set(
                    self.random.as_ref(),
                    key_id.as_str(),
                    key.expose_secret(),
                )
            })
            .map_err(|_| provider_unavailable().into_snapback_error())??;
        let candidate =
            SessionCandidate::generate(self, now_ms).map_err(ProviderError::into_snapback_error)?;
        let revocations = plan_user_session_revocations(
            database,
            &planning.credential.user_id,
            None,
            None,
            now_ms,
        )?;
        let user_id = planning.credential.user_id.clone();
        let identity_id = planning.credential.identity_id.clone();
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: user_id.clone(),
            provider: "local-password".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms: checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?,
            absolute_expires_at_ms: checked_time_add_snapback(
                now_ms,
                AUTH_SESSION_ABSOLUTE_WINDOW_MS,
            )?,
            rehearsal_provenance: None,
        };
        Ok(ProviderSessionIssuancePlan {
            address: CanonicalAddress::parse(&planning.canonical_identifier).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                    "auth",
                    "password identifier does not satisfy the declared mode",
                )
            })?,
            now_ms,
            identity: PlannedIdentityState::Existing {
                identity_id: identity_id.clone(),
                user_id: user_id.clone(),
            },
            candidate,
            projected,
            revocations,
            password: Some(crate::storage::auth_identity::PasswordIssuanceCommitPlan {
                canonical_identifier: planning.canonical_identifier,
                identifier_mode: planning.credential.identifier_mode,
                identity_id,
                user_id,
                operation:
                    crate::storage::auth_identity::PasswordIssuanceOperation::RecoveryRotate {
                        predecessor: crate::storage::auth_identity::RecoveryRotatePredecessor {
                            acting_session_id: planning.acting_session_id,
                            acting_generation: planning.acting_generation,
                            acting_token_digest: planning.acting_token_digest,
                            credential: planning.credential,
                        },
                        successor_credential_id: opaque_catalog_component("recovery"),
                        successor_recovery,
                    },
            }),
            password_profile: Some(self.password_security),
            recovery_codes: Some(recovery_codes),
            challenge: None,
            sender_issuance: None,
            rehearsal_exercise: None,
        })
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
        let catalog = database.auth_catalog_read();
        let address = if binding.operation == "passwordSet" {
            catalog.password_set_step_up_address(
                &binding.catalog_binding(),
                &binding.target_id,
                now_ms,
            )
        } else {
            catalog.step_up_address(&binding.catalog_binding(), now_ms)
        }
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
            .auth_catalog_read()
            .challenge_coordination(challenge_id.as_str())
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
            .auth_catalog_read()
            .challenge_coordination(challenge_id.as_str())
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
            .auth_catalog()
            .exchange_unknown(
                sender_issuance,
                &challenge_id,
                &code,
                &self.provider.dummy_key,
                &self.provider.dummy_address,
            )
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
            .auth_catalog_read()
            .lookup_presented_session(&token_hash)
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
            .auth_catalog_read()
            .lookup_presented_session(&token_hash)
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
            .auth_catalog_read()
            .lookup_presented_session_with_sender_binding(&token_hash)
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
            .auth_catalog_read()
            .lookup_presented_session(&token_hash)
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
        let catalog_plan = plan.catalog_plan();
        let attempt = database
            .auth_catalog()
            .attempt_planned_family_alarm(&catalog_plan);
        let AuthTransactionAttempt::CommitUncertain(error) = attempt else {
            return attempt;
        };
        let Some(revocation) = plan.revocation_plan() else {
            // The dummy statement cannot match a provider-minted session. An
            // ambiguous SQLite commit still ran the fixed writer shape, and
            // no authority successor exists to publish.
            return AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop);
        };
        let revocation_catalog_plan = revocation.catalog_plan();
        match database
            .auth_catalog_read()
            .reconcile_planned_revocation(&revocation_catalog_plan, plan.observed_at_ms)
        {
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
        let catalog_plan = plan.catalog_plan();
        let attempt = database
            .auth_catalog()
            .attempt_planned_revocation(&catalog_plan, now_ms);
        let AuthTransactionAttempt::CommitUncertain(commit_error) = attempt else {
            return attempt;
        };
        // The connection is no longer inside the ambiguous transaction. Read
        // the exact predecessor/successor facts before deciding whether the
        // coordinator may unmark or finalize its ticket.
        match database
            .auth_catalog_read()
            .reconcile_planned_revocation(&catalog_plan, now_ms)
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
        let catalog_plan = plan.catalog_plan();
        let (attempt, body_outcome) = database
            .auth_catalog()
            .attempt_planned_rotation(&catalog_plan);
        match attempt {
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::CandidateCollision) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::CandidateCollision)
            }
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::PredecessorChanged) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::PredecessorChanged)
            }
            AuthTransactionAttempt::Committed(PlannedRotationTransaction::Refreshed(session)) => {
                AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                    session: session.into(),
                })
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
                    .auth_catalog_read()
                    .reconcile_planned_rotation(&catalog_plan)
                {
                    Ok(DurableRotationReconcile::ExactPredecessor) => {
                        AuthTransactionAttempt::RolledBack(error)
                    }
                    Ok(DurableRotationReconcile::ExactSuccessor(session)) => {
                        AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                            session: session.into(),
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
        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            match self.plan_refresh(database, bearer, now_ms)? {
                PlannedRefresh::AuthRequired => return Err(auth_required()),
                PlannedRefresh::SessionExpired => return Err(session_expired()),
                PlannedRefresh::SupersededInsideGrace => return Err(refresh_superseded()),
                PlannedRefresh::ReuseRevoke(plan) => {
                    return match self.commit_planned_revocation(database, &plan, now_ms) {
                        AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                            revocation,
                        )) => Err(ProviderError::with_committed_revocation(
                            session_revoked().into_snapback_error(),
                            revocation,
                        )),
                        _ => Err(provider_unavailable()),
                    };
                }
                PlannedRefresh::Rotate(rotation) => {
                    let commit_plan = rotation.commit_plan();
                    match self.commit_planned_rotation(database, &commit_plan) {
                        AuthTransactionAttempt::Committed(PlannedRotationCommit::Committed {
                            session,
                        }) => return Ok(rotation.into_issue(session)),
                        AuthTransactionAttempt::Committed(
                            PlannedRotationCommit::CandidateCollision,
                        ) => continue,
                        _ => return Err(provider_unavailable()),
                    }
                }
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
        match self.plan_logout(database, bearer, now_ms)? {
            PlannedLogout::AuthRequired => Err(auth_required()),
            PlannedLogout::SessionExpired => Err(session_expired()),
            PlannedLogout::CredentialSuperseded => Err(credential_superseded()),
            PlannedLogout::Revoke(plan) => {
                match self.commit_planned_revocation(database, &plan, now_ms) {
                    AuthTransactionAttempt::Committed(PlannedRevocationCommit::Committed(
                        revocation,
                    )) => Ok(revocation),
                    _ => Err(provider_unavailable()),
                }
            }
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
        let plan = self.plan_family_alarm(database, bearer, now_ms)?;
        let publish_not_before = plan.publish_not_before();
        let committed_revocation = match self.commit_planned_family_alarm(database, &plan) {
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Revoked(revocation)) => {
                Some(revocation)
            }
            AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Noop)
            | AuthTransactionAttempt::Committed(PlannedFamilyAlarmCommit::Retry) => None,
            _ => return Err(provider_unavailable()),
        };
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
            .auth_catalog_read()
            .authenticated_use_row(session_id, expected_generation)
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
        let expires_at_ms = now_ms
            .checked_add(AUTH_SESSION_SLIDING_WINDOW_MS)
            .unwrap_or(MAX_SAFE_TIMESTAMP)
            .min(preliminary.absolute_expires_at_ms);
        if expires_at_ms < now_ms {
            return Ok(AuthenticatedUse::NotLive);
        }
        let extended = database
            .auth_catalog()
            .extend_authenticated_use(
                session_id,
                expected_generation,
                now_ms,
                expires_at_ms,
                AUTH_SESSION_USE_COALESCE_MS,
            )
            .map_err(|_| provider_unavailable())?;
        Ok(if extended {
            AuthenticatedUse::Extended { expires_at_ms }
        } else {
            AuthenticatedUse::NotLive
        })
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
        let _code = VerificationCode::parse(code).map_err(|_| request_invalid())?;
        let provider = &self.admission.provider;
        provider
            .keyring
            .with_key(&self.coordination.key_id, |_key| {
                let fact = database
                    .auth_catalog_read()
                    .exchange_challenge_fact(&self.coordination.challenge_id)?;
                let Some((address, challenge)) =
                    classify_exchange_challenge(&self.coordination, fact, now_ms)?
                else {
                    return Ok(PlannedExchange::Reject);
                };
                let candidate = SessionCandidate::generate(provider, now_ms)
                    .map_err(ProviderError::into_snapback_error)?;
                let facts = database.auth_catalog_read().session_issuance_facts(
                    &address,
                    &candidate.user_id,
                    now_ms,
                    AUTH_SESSION_LIVE_LIMIT as u64,
                )?;
                let (identity, eviction) = classify_session_issuance(facts, &candidate)?;
                build_session_issuance_plan(
                    address,
                    now_ms,
                    candidate,
                    identity,
                    eviction,
                    Some(challenge),
                )
                .map(PlannedExchange::Issue)
            })
            .map_err(|_| provider_unavailable())?
            .map_err(|_| provider_unavailable())
    }

    pub(crate) fn prepare_password_reset(
        &self,
        database: &LocalDatabase,
        code: &str,
        now_ms: u64,
    ) -> ProviderResult<PasswordResetPreparation> {
        let planned = self.plan_exchange(database, code, now_ms)?;
        let PlannedExchange::Issue(mut plan) = planned else {
            return Ok(PasswordResetPreparation::ChallengeRejected);
        };
        let Some((email_identity_id, credential)) = database
            .password_reset_predecessor(self.coordination.address.as_str())
            .map_err(|_| provider_unavailable())?
        else {
            return Ok(PasswordResetPreparation::PrincipalInvalid);
        };
        let email_plan_matches = matches!(
            &plan.identity,
            PlannedIdentityState::Existing {
                identity_id,
                user_id,
            } if identity_id == &email_identity_id && user_id == &credential.user_id
        );
        if !email_plan_matches {
            return Ok(PasswordResetPreparation::PrincipalInvalid);
        }
        plan.revocations =
            plan_user_session_revocations(database, &credential.user_id, None, None, now_ms)
                .map_err(|_| provider_unavailable())?;
        Ok(PasswordResetPreparation::Ready {
            plan,
            email_identity_id,
            credential,
        })
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
                database
                    .auth_catalog()
                    .commit_planned_rejection(&CatalogRejectedExchangePlan {
                        challenge_id: &self.coordination.challenge_id,
                        address: &self.coordination.address,
                        key_id: self.coordination.key_id.as_str(),
                        key,
                        code: &code,
                        now_ms,
                        dummy_key: &provider.dummy_key,
                        dummy_address: &provider.dummy_address,
                        sender_issuance,
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
        let provider = &self.admission.provider;
        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            match self.plan_exchange(database, code, now_ms)? {
                PlannedExchange::Reject => {
                    return match self.commit_planned_rejection(database, code, now_ms, None) {
                        Ok(RejectedExchangeCommit::PredecessorChanged) => {
                            Err(provider_unavailable())
                        }
                        Err(error) => Err(error),
                    };
                }
                PlannedExchange::Issue(issuance) => {
                    let commit_plan = issuance.commit_plan();
                    match self.commit_planned_issuance(database, &commit_plan, code) {
                        AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                            session,
                            committed_revocations,
                        }) => {
                            provider.mailbox.erase(&self.coordination.challenge_id);
                            return Ok(issuance.into_issue(session, committed_revocations));
                        }
                        AuthTransactionAttempt::Committed(
                            PlannedIssuanceCommit::CandidateCollision,
                        ) => continue,
                        AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeInvalid) => {
                            return Err(code_invalid());
                        }
                        AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CodeLocked) => {
                            return Err(code_locked());
                        }
                        _ => return Err(provider_unavailable()),
                    }
                }
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

    /// Re-read both the password predecessor and the user-scoped revocation
    /// set only after this identifier's issuance stripe is held. Sign-in owns
    /// the same stripe through its session insert, so the returned plan cannot
    /// omit a session minted between address discovery and password change.
    ///
    /// @ref LLP 0227#principal-binding-same-sessions-no-parallel-identity — password change
    ///   revokes every other session for the user in its linearized cut.
    pub(crate) fn prepare_password_change(
        &self,
        database: &LocalDatabase,
        acting: &SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<PasswordChangePreparation> {
        let preparation = self
            .provider()
            .prepare_password_change(database, acting, now_ms, custody)?;
        if preparation.canonical_identifier() != self.address.as_str() {
            return Err(internal_state_snapback());
        }
        Ok(preparation)
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

            let outcome = database.auth_catalog().insert_step_up_challenge(
                &binding.catalog_binding(),
                &self.address,
                &challenge_id,
                &digest,
                &key_id,
                now_ms,
                expires_at_ms,
                &self.provider().budget_policy(),
            );

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
                Ok(RequestInsertOutcome::AuthRequired) => return Err(auth_required()),
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
        self.request_code_inner(database, now_ms, None)
    }

    /// Ordinary request-code choreography with a server-resolved rehearsal
    /// window. The app request remains unchanged; the window is selected from
    /// the canonical contact namespace before this protected mutation.
    pub(crate) fn request_code_for_rehearsal_window(
        &self,
        database: &mut LocalDatabase,
        now_ms: u64,
        window: &crate::auth::rehearsal::AuthRehearsalWindowV1,
    ) -> ProviderResult<RequestCodeResponse> {
        self.request_code_inner(database, now_ms, Some(window))
    }

    fn request_code_inner(
        &self,
        database: &mut LocalDatabase,
        now_ms: u64,
        rehearsal_window: Option<&crate::auth::rehearsal::AuthRehearsalWindowV1>,
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

            let outcome = match rehearsal_window {
                Some(window) => database
                    .auth_catalog()
                    .insert_verification_challenge_for_rehearsal_window(
                        &self.address,
                        &challenge_id,
                        &digest,
                        &key_id,
                        now_ms,
                        expires_at_ms,
                        &self.provider().budget_policy(),
                        window,
                    ),
                None => database.auth_catalog().insert_verification_challenge(
                    &self.address,
                    &challenge_id,
                    &digest,
                    &key_id,
                    now_ms,
                    expires_at_ms,
                    &self.provider().budget_policy(),
                ),
            };

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
                Ok(RequestInsertOutcome::AuthRequired) => return Err(provider_unavailable()),
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
        let facts = database
            .auth_catalog_read()
            .session_issuance_facts(
                &self.address,
                &candidate.user_id,
                now_ms,
                AUTH_SESSION_LIVE_LIMIT as u64,
            )
            .map_err(|_| provider_unavailable())?;
        let (identity, eviction) =
            classify_session_issuance(facts, &candidate).map_err(|_| provider_unavailable())?;
        build_session_issuance_plan(
            self.address.clone(),
            now_ms,
            candidate,
            identity,
            eviction,
            None,
        )
        .map_err(|_| provider_unavailable())
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
            let issuance = self.plan_mint_session(database, now_ms)?;
            let commit_plan = issuance.commit_plan();
            match self.commit_planned_issuance(database, &commit_plan) {
                AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                    session,
                    committed_revocations,
                }) => return Ok(issuance.into_issue(session, committed_revocations)),
                AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CandidateCollision) => {
                    continue;
                }
                _ => return Err(provider_unavailable()),
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
        use crate::ids::Kind;
        let user_id = mint_random_catalog_id(Kind::User, provider.random.as_ref())?;
        let identity_id = mint_catalog_id(Kind::Identity, provider.random.as_ref(), now_ms)?;
        let session_id = mint_catalog_id(Kind::Session, provider.random.as_ref(), now_ms)?;
        let authority_instance_id =
            mint_catalog_id(Kind::AuthorityInstance, provider.random.as_ref(), now_ms)?;
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

fn classify_exchange_challenge(
    coordination: &ExchangeCoordination,
    fact: Option<ExchangeChallengeFact>,
    now_ms: u64,
) -> SnapbackResult<Option<(CanonicalAddress, PlannedChallengeConsumption)>> {
    let Some(fact) = fact else {
        return Ok(None);
    };
    let address = CanonicalAddress::parse(&fact.address).map_err(|_| internal_state_snapback())?;
    if address != coordination.address || fact.key_id != coordination.key_id.as_str() {
        return Err(internal_state_snapback());
    }
    if fact.max_attempts != AUTH_MAXIMUM_ATTEMPTS || fact.attempts > fact.max_attempts {
        return Err(internal_state_snapback());
    }
    if fact.consumed
        || fact.superseded
        || now_ms >= fact.expires_at_ms
        || fact.attempts == fact.max_attempts
    {
        return Ok(None);
    }
    Ok(Some((
        address,
        PlannedChallengeConsumption {
            challenge_id: coordination.challenge_id.as_str().to_owned(),
            key_id: coordination.key_id.as_str().to_owned(),
            code_digest: fact.code_digest,
            expected_attempts: fact.attempts,
            max_attempts: fact.max_attempts,
            expires_at_ms: fact.expires_at_ms,
        },
    )))
}

fn classify_session_issuance(
    facts: SessionIssuanceFacts,
    candidate: &SessionCandidate,
) -> SnapbackResult<(PlannedIdentityState, Option<ProviderRevocationPlan>)> {
    let identity = match facts.existing_identity {
        Some(existing) => PlannedIdentityState::Existing {
            identity_id: existing.identity_id,
            user_id: existing.user_id,
        },
        None => PlannedIdentityState::Create {
            identity_id: candidate.identity_id.clone(),
            user_id: candidate.user_id.clone(),
        },
    };
    if facts.live_session_count > AUTH_SESSION_LIVE_LIMIT as u64 {
        return Err(internal_state_snapback());
    }
    let eviction = if facts.live_session_count == AUTH_SESSION_LIVE_LIMIT as u64 {
        let oldest = facts
            .oldest_live_session
            .ok_or_else(internal_state_snapback)?;
        Some(ProviderRevocationPlan {
            session_id: oldest.session_id,
            expected_generation: oldest.generation,
            presented_digest: oldest.token_digest,
            source: PlannedTokenSource::Current,
            reason: RevocationReason::CapEviction,
        })
    } else {
        if facts.oldest_live_session.is_some() {
            return Err(internal_state_snapback());
        }
        None
    };
    Ok((identity, eviction))
}

fn classify_session_cap(facts: SessionCapFacts) -> SnapbackResult<Option<ProviderRevocationPlan>> {
    if facts.live_session_count > AUTH_SESSION_LIVE_LIMIT as u64 {
        return Err(internal_state_snapback());
    }
    if facts.live_session_count == AUTH_SESSION_LIVE_LIMIT as u64 {
        let oldest = facts
            .oldest_live_session
            .ok_or_else(internal_state_snapback)?;
        return Ok(Some(ProviderRevocationPlan {
            session_id: oldest.session_id,
            expected_generation: oldest.generation,
            presented_digest: oldest.token_digest,
            source: PlannedTokenSource::Current,
            reason: RevocationReason::CapEviction,
        }));
    }
    if facts.oldest_live_session.is_some() {
        return Err(internal_state_snapback());
    }
    Ok(None)
}

fn classify_user_session_revocations(
    facts: Vec<SessionRevocationCandidateFact>,
) -> Vec<ProviderRevocationPlan> {
    facts
        .into_iter()
        .map(|fact| ProviderRevocationPlan {
            session_id: fact.session_id,
            expected_generation: fact.generation,
            presented_digest: fact.token_digest,
            source: PlannedTokenSource::Current,
            reason: RevocationReason::DurableRevocation,
        })
        .collect()
}

fn plan_user_session_revocations(
    database: &LocalDatabase,
    user_id: &str,
    excluded_session_id: Option<&str>,
    identity_id: Option<&str>,
    now_ms: u64,
) -> SnapbackResult<Vec<ProviderRevocationPlan>> {
    database
        .auth_catalog_read()
        .user_session_revocation_facts(user_id, excluded_session_id, identity_id, now_ms)
        .map(classify_user_session_revocations)
}

fn build_session_issuance_plan(
    address: CanonicalAddress,
    now_ms: u64,
    candidate: SessionCandidate,
    identity: PlannedIdentityState,
    eviction: Option<ProviderRevocationPlan>,
    challenge: Option<PlannedChallengeConsumption>,
) -> SnapbackResult<ProviderSessionIssuancePlan> {
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
        rehearsal_provenance: None,
    };
    Ok(ProviderSessionIssuancePlan {
        address,
        now_ms,
        identity,
        candidate,
        projected,
        revocations: eviction.into_iter().collect(),
        password: None,
        password_profile: None,
        recovery_codes: None,
        challenge,
        sender_issuance: None,
        rehearsal_exercise: None,
    })
}

fn planned_password_change_from_catalog(
    outcome: CatalogPasswordChangeCommit,
) -> PlannedPasswordChangeCommit {
    match outcome {
        CatalogPasswordChangeCommit::Committed {
            session,
            committed_revocations,
        } => PlannedPasswordChangeCommit::Committed {
            session: session.into(),
            committed_revocations,
        },
        CatalogPasswordChangeCommit::CredentialInvalid { committed_attempt } => {
            PlannedPasswordChangeCommit::CredentialInvalid { committed_attempt }
        }
        CatalogPasswordChangeCommit::CredentialThrottled => {
            PlannedPasswordChangeCommit::CredentialThrottled
        }
        CatalogPasswordChangeCommit::CandidateCollision => {
            PlannedPasswordChangeCommit::CandidateCollision
        }
        CatalogPasswordChangeCommit::PredecessorChanged => {
            PlannedPasswordChangeCommit::PredecessorChanged
        }
    }
}

#[allow(dead_code)]
fn attempt_planned_password_change(
    database: &mut LocalDatabase,
    plan: &ProviderPasswordChangeCommitPlan,
) -> AuthTransactionAttempt<PlannedPasswordChangeCommit> {
    let catalog_plan = plan.catalog_plan();
    let (attempt, body_outcome) = database
        .auth_catalog()
        .attempt_password_change(&catalog_plan);
    let attempt = match attempt {
        AuthTransactionAttempt::Committed(outcome) => {
            AuthTransactionAttempt::Committed(planned_password_change_from_catalog(outcome))
        }
        AuthTransactionAttempt::RolledBack(error) => AuthTransactionAttempt::RolledBack(error),
        AuthTransactionAttempt::CommitUncertain(error) => {
            AuthTransactionAttempt::CommitUncertain(error)
        }
    };
    let body_outcome = body_outcome.map(planned_password_change_from_catalog);
    let AuthTransactionAttempt::CommitUncertain(commit_error) = attempt else {
        return attempt;
    };
    let Some(body_outcome) = body_outcome else {
        return AuthTransactionAttempt::CommitUncertain(commit_error);
    };
    match body_outcome {
        PlannedPasswordChangeCommit::CandidateCollision
        | PlannedPasswordChangeCommit::PredecessorChanged
        | PlannedPasswordChangeCommit::CredentialThrottled => {
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::PredecessorChanged)
        }
        PlannedPasswordChangeCommit::CredentialInvalid { committed_attempt } => {
            let committed = committed_attempt.as_ref().is_none_or(|expected| {
                database
                    .password_attempt_matches(&plan.mutation.canonical_identifier, expected)
                    .unwrap_or(false)
            });
            if committed {
                AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::CredentialInvalid {
                    committed_attempt,
                })
            } else {
                AuthTransactionAttempt::RolledBack(commit_error)
            }
        }
        PlannedPasswordChangeCommit::Committed { .. } => {
            match database
                .auth_catalog_read()
                .reconcile_password_change(&catalog_plan)
            {
                Ok(CatalogPasswordChangeReconcile::ExactSuccessor {
                    session,
                    committed_revocations,
                }) => AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::Committed {
                    session: session.into(),
                    committed_revocations,
                }),
                Ok(CatalogPasswordChangeReconcile::ExactPredecessor) => {
                    AuthTransactionAttempt::RolledBack(commit_error)
                }
                Ok(CatalogPasswordChangeReconcile::DifferentValid) => {
                    AuthTransactionAttempt::Committed(
                        PlannedPasswordChangeCommit::PredecessorChanged,
                    )
                }
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
    }
}

fn attempt_planned_session_issuance(
    database: &mut LocalDatabase,
    plan: &ProviderSessionIssuanceCommitPlan,
    exchange_proof: Option<(&AuthKeyMaterial, &VerificationCode)>,
) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
    let catalog_plan = plan.catalog_plan();
    let (attempt, body_outcome) = database
        .auth_catalog()
        .attempt_planned_session_issuance(&catalog_plan, exchange_proof);
    let attempt = match attempt {
        AuthTransactionAttempt::Committed(outcome) => {
            AuthTransactionAttempt::Committed(planned_issuance_from_catalog(outcome))
        }
        AuthTransactionAttempt::RolledBack(error) => AuthTransactionAttempt::RolledBack(error),
        AuthTransactionAttempt::CommitUncertain(error) => {
            AuthTransactionAttempt::CommitUncertain(error)
        }
    };
    let body_outcome = body_outcome.map(planned_issuance_from_catalog);
    let AuthTransactionAttempt::CommitUncertain(commit_error) = attempt else {
        return attempt;
    };
    let Some(body_outcome) = body_outcome else {
        return AuthTransactionAttempt::CommitUncertain(commit_error);
    };
    match body_outcome {
        PlannedIssuanceCommit::CandidateCollision
        | PlannedIssuanceCommit::PredecessorChanged
        | PlannedIssuanceCommit::CredentialThrottled => {
            // The transaction performs no write before this outcome. Authority
            // therefore remained at the projection predecessor even if the
            // final COMMIT acknowledgement was lost.
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
        }
        rejected @ (PlannedIssuanceCommit::CodeInvalid | PlannedIssuanceCommit::CodeLocked) => {
            match database
                .auth_catalog_read()
                .reconcile_rejected_issuance(&catalog_plan)
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
        PlannedIssuanceCommit::CredentialInvalid { committed_attempt } => {
            let committed = match (plan.password.as_ref(), committed_attempt.as_ref()) {
                (Some(password), Some(expected)) => database
                    .password_attempt_matches(&password.canonical_identifier, expected)
                    .unwrap_or(false),
                (Some(_), None) => true,
                _ => false,
            };
            if committed {
                AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CredentialInvalid {
                    committed_attempt,
                })
            } else {
                AuthTransactionAttempt::RolledBack(commit_error)
            }
        }
        PlannedIssuanceCommit::SenderKeyBound => {
            // The only durable write on this outcome is the proof-id
            // consumption; its presence (with our exact expiry) alongside the
            // absent binding and the pre-existing family's nonce cell is the
            // committed witness.
            match database
                .auth_catalog_read()
                .sender_key_bound_successor(&catalog_plan)
            {
                Ok(true) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::SenderKeyBound)
                }
                Ok(false) => AuthTransactionAttempt::RolledBack(commit_error),
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
        PlannedIssuanceCommit::Committed { .. } => {
            match database
                .auth_catalog_read()
                .reconcile_planned_issuance(&catalog_plan)
            {
                Ok(CatalogIssuanceReconcile::ExactSuccessor {
                    session,
                    committed_revocations,
                }) => AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                    session: session.into(),
                    committed_revocations,
                }),
                Ok(CatalogIssuanceReconcile::ExactPredecessor) => {
                    AuthTransactionAttempt::RolledBack(commit_error)
                }
                Ok(CatalogIssuanceReconcile::DifferentValid) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
                }
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
        }
        PlannedIssuanceCommit::RehearsalReplay(_) | PlannedIssuanceCommit::RehearsalDenied(_) => {
            // Rehearsal accounting may have committed without a session.
            // Its request-bound receipt cannot prove COMMIT certainty through
            // the provider catalog, so retain the conservative uncertainty.
            AuthTransactionAttempt::CommitUncertain(commit_error)
        }
    }
}

fn planned_issuance_from_catalog(outcome: CatalogIssuanceCommit) -> PlannedIssuanceCommit {
    match outcome {
        CatalogIssuanceCommit::Committed {
            session,
            committed_revocations,
        } => PlannedIssuanceCommit::Committed {
            session: session.into(),
            committed_revocations,
        },
        CatalogIssuanceCommit::CodeInvalid => PlannedIssuanceCommit::CodeInvalid,
        CatalogIssuanceCommit::CodeLocked => PlannedIssuanceCommit::CodeLocked,
        CatalogIssuanceCommit::CredentialInvalid { committed_attempt } => {
            PlannedIssuanceCommit::CredentialInvalid { committed_attempt }
        }
        CatalogIssuanceCommit::CredentialThrottled => PlannedIssuanceCommit::CredentialThrottled,
        CatalogIssuanceCommit::SenderKeyBound => PlannedIssuanceCommit::SenderKeyBound,
        CatalogIssuanceCommit::CandidateCollision => PlannedIssuanceCommit::CandidateCollision,
        CatalogIssuanceCommit::PredecessorChanged => PlannedIssuanceCommit::PredecessorChanged,
        CatalogIssuanceCommit::RehearsalReplay(value) => {
            PlannedIssuanceCommit::RehearsalReplay(value)
        }
        CatalogIssuanceCommit::RehearsalDenied(error) => {
            PlannedIssuanceCommit::RehearsalDenied(error)
        }
    }
}

/// A time-ordered catalog id, spelled through the LLP 0148 registry.
///
/// Keeps this Spec's injected `RandomSource` rather than reaching for the OS
/// directly, so the CSPRNG-or-refuse contract stays testable and the buffer
/// still zeroizes.
///
/// @ref LLP 0148#d5-one-registry-one-minting-helper — the prefix comes from the
/// registry, not from a `format!` here
fn mint_catalog_id(
    kind: crate::ids::Kind,
    random: &dyn RandomSource,
    now_ms: u64,
) -> ProviderResult<String> {
    if now_ms > 0x0000_FFFF_FFFF_FFFF {
        return Err(provider_unavailable());
    }
    let mut random_bytes = [0_u8; 10];
    fill_random_or_unavailable(random, &mut random_bytes)?;
    let uuid = uuid::Builder::from_unix_timestamp_millis(now_ms, &random_bytes).into_uuid();
    random_bytes.zeroize();
    Ok(crate::ids::format_id(kind, uuid.as_bytes()))
}

/// A random-body catalog id. Only `Kind::User` takes one, because a
/// time-ordered user id would tell every other user when an account was
/// created (LLP 0148 §D3).
fn mint_random_catalog_id(
    kind: crate::ids::Kind,
    random: &dyn RandomSource,
) -> ProviderResult<String> {
    debug_assert_eq!(kind.spec().body, crate::ids::Body::Random);
    let mut bytes = [0_u8; 16];
    fill_random_or_unavailable(random, &mut bytes)?;
    let id = crate::ids::format_id(kind, &bytes);
    bytes.zeroize();
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

#[allow(dead_code)]
fn opaque_catalog_component(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
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

#[allow(dead_code)]
fn password_kdf_throttled() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_THROTTLED",
        "auth",
        "authentication request rate limit exceeded",
    )
}

#[allow(dead_code)]
fn require_password_bearer_custody(custody: PasswordIssuanceCustody) -> SnapbackResult<()> {
    match custody {
        PasswordIssuanceCustody::Bearer => Ok(()),
        PasswordIssuanceCustody::SenderConstrained => Err(SnapbackError::error(
            "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED",
            "auth",
            "password authentication does not support sender-constrained custody",
        )),
    }
}

fn step_up_delivery_unavailable() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_STEP_UP_DELIVERY_UNAVAILABLE",
        "auth",
        "fresh authentication delivery is unavailable for this deployment profile",
    ))
}

fn authorized_lease_key_unavailable() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTHORIZED_LEASE_KEY_UNAVAILABLE",
        "auth",
        "authorized lease protocol key is unavailable",
    )
}

pub(crate) fn code_invalid() -> ProviderError {
    ProviderError::new(super::throttle::code_invalid())
}

/// The one public credential refusal for absent, wrong, stale, and locked
/// password predecessors. Routes must not attach lock or account-existence
/// detail to this diagnostic.
pub(crate) fn credential_invalid() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CREDENTIAL_INVALID",
        "auth",
        "credential is invalid",
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
    ProviderError::new(super::throttle::code_locked())
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
    use crate::auth::coordinator::{
        AuthCoordinator, CommittedRevocationTarget, IssuanceFinish, PasswordChangeFinish,
        RotationFinish,
    };
    use crate::auth::identity_core::{AssuranceKind, PasswordSecret};
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

    fn password_provider_database_coordinator(
        now_ms: u64,
    ) -> (Arc<AuthProvider>, LocalDatabase, Arc<AuthCoordinator>) {
        password_provider_database_coordinator_with_minimum(
            now_ms,
            crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT,
        )
    }

    fn password_provider_database_coordinator_with_minimum(
        now_ms: u64,
        minimum_password_length: u16,
    ) -> (Arc<AuthProvider>, LocalDatabase, Arc<AuthCoordinator>) {
        let mut database = LocalDatabase::memory().expect("memory database");
        database
            .activate_current_auth_catalog_with_password_identifier_mode(
                crate::storage::auth::PasswordIdentifierMode::EmailV1,
            )
            .expect("activate catalog v4");
        database
            .ensure_authorization_stream_incarnation()
            .expect("authorization stream");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        // Password-set tests mint their email step-up session two milliseconds
        // after the fixture epoch. Keep provider-sampled challenge time in the
        // same deterministic epoch instead of consulting the wall clock.
        let provider = Arc::new(
            AuthProvider::new_with_dependencies_and_password_minimum(
                AuthProviderProfile::Test,
                keyring,
                Arc::new(OsRandom),
                Arc::new(ManualClock::new(now_ms + 2)),
                minimum_password_length,
            )
            .expect("auth provider"),
        );
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            database
                .session_projection_source()
                .expect("projection source"),
            now_ms,
            provider.monotonic_now(),
        )
        .expect("session projection");
        let coordinator = Arc::new(AuthCoordinator::new(projection).expect("coordinator"));
        (provider, database, coordinator)
    }

    async fn commit_password_issuance_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        plan: ProviderSessionIssuancePlan,
        now_ms: u64,
    ) -> (
        IssuanceFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let carrier = coordinator
            .premark_issuance(plan)
            .await
            .expect("premark password issuance");
        let commit_plan = carrier.plan().commit_plan();
        let attempt = provider.commit_password_issuance(database, &commit_plan);
        let (outcome, targets) = coordinator
            .finish_issuance(carrier, attempt, now_ms, provider.monotonic_now())
            .into_parts();
        (outcome.expect("finish issuance"), targets)
    }

    async fn register_password_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        identifier: &str,
        password: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        let plan = provider
            .plan_password_registration(
                database,
                identifier,
                PasswordSecret::new(password.to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password registration plan");
        let (finish, targets) =
            commit_password_issuance_for_test(provider, database, coordinator, plan, now_ms).await;
        assert!(targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish else {
            panic!("password registration must commit");
        };
        issue
    }

    async fn password_signin_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        identifier: &str,
        password: &str,
        now_ms: u64,
    ) -> (
        IssuanceFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let plan = provider
            .plan_password_authentication(
                database,
                identifier,
                PasswordSecret::new(password.to_owned()),
                now_ms,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password signin plan");
        commit_password_issuance_for_test(provider, database, coordinator, plan, now_ms).await
    }

    async fn email_issue_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        address: &str,
        now_ms: u64,
    ) -> CredentialIssue {
        let admission = provider
            .admit_email(address)
            .await
            .expect("email issuance admission");
        let plan = admission
            .plan_mint_session(database, now_ms)
            .expect("email issuance plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_issuance(plan)
            .await
            .expect("premark email issuance");
        let attempt = admission.commit_planned_issuance(database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_issuance(carrier, attempt, now_ms, provider.monotonic_now())
            .into_parts();
        assert!(targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish.expect("finish email issuance") else {
            panic!("email issuance must commit");
        };
        issue
    }

    async fn password_change_for_test(
        provider: &Arc<AuthProvider>,
        database: &mut LocalDatabase,
        coordinator: &Arc<AuthCoordinator>,
        acting: &SessionBearer,
        current: &str,
        replacement: &str,
        now_ms: u64,
    ) -> (
        PasswordChangeFinish,
        Vec<crate::auth::coordinator::CommittedRevocationTarget>,
    ) {
        let plan = provider
            .plan_password_change(
                database,
                acting,
                PasswordSecret::new(current.to_owned()),
                PasswordSecret::new(replacement.to_owned()),
                now_ms,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password change plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_password_change(plan)
            .await
            .expect("premark password change");
        let attempt = provider.commit_password_change(database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_password_change(carrier, attempt)
            .into_parts();
        (finish.expect("finish password change"), targets)
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
            .auth_catalog_read()
            .session_count_for_test()
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
        let version = database
            .versions_read()
            .current_version()
            .expect("app version");
        let changes = database
            .auth_catalog_read()
            .change_journal_count_for_test()
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
        assert_eq!(error.diagnostic().details["budgetName"], "auth.delivery");
        assert_eq!(error.diagnostic().details["retryAfter"]["kind"], "duration");
        assert_eq!(
            error.diagnostic().details["retryAfter"]["milliseconds"],
            AUTH_ADDRESS_REQUEST_WINDOW_MS
        );
        assert!(
            error.diagnostic().details["correlationId"]
                .as_str()
                .is_some_and(|value| !value.is_empty())
        );
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
        assert_eq!(
            global.diagnostic().details["budgetName"],
            "auth.challenge-allocation"
        );
        assert_eq!(
            global.diagnostic().details["retryAfter"]["milliseconds"],
            AUTH_GLOBAL_REQUEST_WINDOW_MS
        );
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
        assert_eq!(
            capacity.diagnostic().details["budgetName"],
            "auth.challenge-allocation"
        );
        assert_eq!(
            capacity.diagnostic().details["retryAfter"]["kind"],
            "resource-release"
        );
        let durable: i64 = capacity_database
            .auth_catalog_read()
            .verification_challenge_count_for_test()
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
            .auth_catalog_read()
            .challenge_issue_facts_for_test(&request.challenge_id)
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
        assert_eq!(fifth.diagnostic().details["budgetName"], "auth.guessing");
        assert_eq!(
            fifth.diagnostic().details["retryAfter"]["kind"],
            "new-authority-required"
        );
        let later = exchange
            .exchange(
                &mut database,
                &code,
                now_ms + AUTH_MAXIMUM_ATTEMPTS as u64 + 1,
            )
            .expect_err("locked challenge remains locked");
        assert_eq!(later.diagnostic().code, "SNAPBACK_AUTH_CODE_LOCKED");
        let (attempts, sessions): (i64, i64) = database
            .auth_catalog_read()
            .challenge_attempts_and_sessions_for_test(&request.challenge_id)
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
            .auth_catalog_read()
            .session_count_for_test()
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
            .auth_catalog_read()
            .provision_counts_for_test()
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
            .auth_catalog_read()
            .current_and_tombstone_counts_for_test()
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
            .auth_catalog_read()
            .session_cap_facts_for_test(now_ms, &revocation.session_id)
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
                .auth_catalog_read()
                .tombstone_count_for_test()
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
            .auth_catalog_read()
            .sole_session_generation_for_test()
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
            .auth_catalog_read()
            .sole_session_generation_revoked_for_test()
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
            .auth_catalog_read()
            .generation_and_tombstones_for_test()
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
            .auth_catalog_read()
            .session_lifetime_facts_for_test(&resolved.session_id)
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
            .auth_catalog()
            .delete_terminal_cause_witness_for_test(plan.session_id())
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
            .auth_catalog_read()
            .session_revoked_for_test(&issue.response().session.id)
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
            .auth_catalog()
            .insert_session_tombstone_for_test(
                issuance_commit.projected.token_digest.as_bytes(),
                &first_id,
                now_ms,
            )
            .unwrap();
        assert!(matches!(
            issuance.commit_planned_issuance(&mut database, &issuance_commit),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::CandidateCollision)
        ));
        let second_exists: i64 = database
            .auth_catalog_read()
            .identity_subject_count_for_test("second@example.com")
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
            .auth_catalog()
            .insert_session_tombstone_for_test(
                rotation.successor.token_hash.as_bytes(),
                &first.response().session.id,
                now_ms + 1,
            )
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
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("predecessor reconciliation"),
            CatalogIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(&mut database, &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed {
                committed_revocations,
                ..
            }) if committed_revocations.is_empty()
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor {
                ref committed_revocations,
                ..
            } if committed_revocations.is_empty()
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
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("sender predecessor reconciliation"),
            CatalogIssuanceReconcile::ExactPredecessor
        ));
        assert!(matches!(
            admission.commit_planned_issuance(&mut database, &commit_plan),
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::Committed { .. })
        ));
        assert!(matches!(
            database
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("sender successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor { .. }
        ));
        let facts: (i64, i64, i64, String) = database
            .auth_catalog_read()
            .sender_issuance_facts_for_test()
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
        // Address admissions retain their stripe guard. Release it before
        // admitting another address: the randomized stripe assignment may
        // legitimately collide, and holding both would deadlock this test.
        drop(first_admission);

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
        drop(second_admission);

        let facts: (i64, i64, i64, String, i64) = database
            .auth_catalog_read()
            .sender_refusal_facts_for_test()
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
                .auth_catalog_read()
                .reconcile_rejected_issuance(&commit_plan.catalog_plan())
                .expect("rejected successor reconciliation"),
            DurableRejectedIssuanceReconcile::ExactSuccessor
        ));
        let facts: (i64, i64) = database
            .auth_catalog_read()
            .challenge_attempts_and_sessions_for_test(&request.challenge_id)
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
            .auth_catalog_read()
            .oldest_live_session_for_test()
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
            committed_revocations,
            ..
        }) = admission.commit_planned_issuance(&mut database, &commit_plan)
        else {
            panic!("twenty-first issuance must commit exact cap eviction");
        };
        assert_eq!(committed_revocations.len(), 1);
        assert_eq!(committed_revocations[0].session_id, oldest);
        assert_eq!(committed_revocations[0].generation, 2);
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
                .auth_catalog_read()
                .reconcile_planned_issuance(&commit_plan.catalog_plan())
                .expect("cap successor reconciliation"),
            CatalogIssuanceReconcile::ExactSuccessor {
                ref committed_revocations,
                ..
            } if committed_revocations.len() == 1 && committed_revocations[0].generation == 2
        ));
        let live: i64 = database
            .auth_catalog_read()
            .live_session_count_for_test()
            .expect("live session count");
        assert_eq!(live, AUTH_SESSION_LIVE_LIMIT as i64);
    }

    #[tokio::test]
    async fn password_issuance_finalizes_projection_and_returns_complete_typed_session() {
        let now_ms = 1_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let plan = provider
            .plan_password_registration(
                &database,
                "Person@Example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password registration plan");
        let (finish, terminal_targets) =
            commit_password_issuance_for_test(&provider, &mut database, &coordinator, plan, now_ms)
                .await;
        assert!(terminal_targets.is_empty());
        let IssuanceFinish::Committed { issue, .. } = finish else {
            panic!("password registration must commit");
        };
        let response = issue.response();
        assert_eq!(response.session.provider, "local-password");
        assert!(response.session.authority_instance_id.starts_with("aut_"));
        assert!(response.session.id.starts_with("ses_"));
        assert_eq!(response.session.generation, 1);
        assert_eq!(response.session.created_at, now_ms);
        assert!(response.session.expires_at > now_ms);
        assert!(response.session.absolute_expires_at > response.session.expires_at);
        assert_eq!(
            response.authority_descriptor.authority_instance_id,
            response.session.authority_instance_id
        );
        assert!(issue.recovery_codes().is_some());
        coordinator
            .resolve_required_bearer(
                response.token().expose_secret(),
                now_ms,
                provider.monotonic_now(),
            )
            .expect("password bearer resolves immediately without rebuild");
        let claims = database
            .identity_claims(
                &response.session.id,
                now_ms,
                crate::contract_types::ServerProfile::Test,
            )
            .expect("password claims");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified),
            "password possession never confers email-verified assurance"
        );

        let admission = provider.admit().await;
        let PlannedRefresh::Rotate(rotation) = admission
            .plan_refresh(&database, response.token().expose_secret(), now_ms + 1)
            .expect("plan password-session refresh")
        else {
            panic!("fresh password session must rotate");
        };
        let commit_plan = rotation.commit_plan();
        let carrier = coordinator
            .premark_rotation(rotation)
            .await
            .expect("premark password-session refresh");
        let attempt = admission.commit_planned_rotation(&mut database, &commit_plan);
        let RotationFinish::Committed {
            issue: refreshed, ..
        } = coordinator
            .finish_rotation(carrier, attempt)
            .expect("finalize password-session refresh")
        else {
            panic!("password-session refresh must commit");
        };
        assert_eq!(refreshed.response().session.provider, "local-password");
        assert_eq!(
            refreshed
                .response()
                .authority_descriptor
                .authority_instance_id,
            response.authority_descriptor.authority_instance_id,
            "refresh preserves the password authority descriptor"
        );
    }

    #[tokio::test]
    async fn password_session_cap_evicts_oldest_with_terminal_cause() {
        let start_ms = 2_000_000;
        let (provider, mut database, coordinator) =
            password_provider_database_coordinator(start_ms);
        let first = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "cap@example.com",
            "a-strong-password-123",
            start_ms,
        )
        .await;
        let oldest = first.response().session.id.clone();
        let oldest_bearer = issue_token(&first);
        let mut cap_targets = Vec::new();
        for offset in 1..=AUTH_SESSION_LIVE_LIMIT {
            let (finish, targets) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "cap@example.com",
                "a-strong-password-123",
                start_ms + offset as u64,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::Committed { .. }));
            cap_targets = targets;
        }
        assert_eq!(cap_targets.len(), 1);
        assert_eq!(cap_targets[0].session_id(), oldest);
        assert!(
            coordinator
                .resolve_required_bearer(
                    &oldest_bearer,
                    start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
                    provider.monotonic_now(),
                )
                .is_err()
        );
        assert_eq!(
            projected_terminal_reason_after_restart(
                &mut database,
                &oldest_bearer,
                start_ms + AUTH_SESSION_LIVE_LIMIT as u64,
            ),
            RevocationReason::CapEviction
        );
    }

    #[tokio::test]
    async fn password_change_rotates_same_authority_and_revokes_only_same_user_others() {
        let now_ms = 3_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "actor@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let acting_session = acting.response().session.id.clone();
        let acting_authority = acting
            .response()
            .authority_descriptor
            .authority_instance_id
            .clone();
        let (other_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "actor@example.com",
            "a-strong-password-123",
            now_ms + 1,
        )
        .await;
        let IssuanceFinish::Committed { issue: other, .. } = other_finish else {
            panic!("second actor session must issue");
        };
        let other_bearer = issue_token(&other);
        let bystander = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "bystander@example.com",
            "another-strong-password-456",
            now_ms + 2,
        )
        .await;
        let bystander_bearer = issue_token(&bystander);
        let (finish, targets) = password_change_for_test(
            &provider,
            &mut database,
            &coordinator,
            acting.response().token(),
            "a-strong-password-123",
            "replacement-password-456",
            now_ms + 3,
        )
        .await;
        let PasswordChangeFinish::Committed(changed) = finish else {
            panic!("password change must commit");
        };
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].session_id(), other.response().session.id);
        assert_eq!(changed.response().session.id, acting_session);
        assert_eq!(
            changed
                .response()
                .authority_descriptor
                .authority_instance_id,
            acting_authority,
            "same-authority credential rotation must preserve authority identity"
        );
        assert_ne!(issue_token(&changed), issue_token(&acting));
        assert_eq!(changed.response().session.provider, "local-password");
        assert!(
            coordinator
                .resolve_required_bearer(
                    changed.response().token().expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
        assert!(
            coordinator
                .resolve_required_bearer(&other_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err()
        );
        assert_eq!(
            projected_terminal_reason_after_restart(&mut database, &other_bearer, now_ms + 3),
            RevocationReason::DurableRevocation,
            "credential change records the durable-delete terminal cause"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&bystander_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_ok(),
            "another principal's session must survive user-scoped revocation"
        );
    }

    #[tokio::test]
    async fn stale_password_proof_is_uniform_invalid_without_failure_accounting() {
        let now_ms = 4_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "fence@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let stale = provider
            .plan_password_authentication(
                &database,
                "fence@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("stale KDF plan");
        let (changed, _) = password_change_for_test(
            &provider,
            &mut database,
            &coordinator,
            acting.response().token(),
            "a-strong-password-123",
            "replacement-password-456",
            now_ms + 2,
        )
        .await;
        assert!(matches!(changed, PasswordChangeFinish::Committed(_)));
        let (finish, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            stale,
            now_ms + 1,
        )
        .await;
        assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        assert!(
            database
                .password_attempt_admin_projection("fence@example.com", now_ms + 2)
                .expect("admin projection")
                .is_none(),
            "stale proof must not penalize the credential ledger"
        );
    }

    #[tokio::test]
    async fn password_change_replans_sessions_after_identifier_admission() {
        let now_ms = 4_500_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let acting = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "change-race@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;

        // Phase 1 is the old broken cut: change discovered the credential and
        // planned the then-current revocation set before a racing sign-in
        // inserted its session.
        let discovery = provider
            .prepare_password_change(
                &database,
                acting.response().token(),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("password change discovery");
        let identifier = discovery.canonical_identifier().to_owned();
        let (racing_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            &identifier,
            "a-strong-password-123",
            now_ms + 2,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: racing_issue,
            ..
        } = racing_finish
        else {
            panic!("racing predecessor-password sign-in must commit before change");
        };
        let racing_session_id = racing_issue.response().session.id.clone();
        let racing_bearer = issue_token(&racing_issue);
        assert!(
            discovery
                .revocations
                .iter()
                .all(|target| target.session_id() != racing_session_id),
            "the pre-race discovery must reproduce the stale revocation snapshot"
        );

        // Phase 2 is the production repair: acquire the identifier stripe and
        // re-plan while sign-in issuance is excluded. The raced-in session is
        // therefore part of this exact change transaction's revocation set.
        let admission = provider
            .admit_email(&identifier)
            .await
            .expect("password identifier admission");
        let preparation = admission
            .prepare_password_change(
                &database,
                acting.response().token(),
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("password change re-plan");
        let plan = provider
            .finish_password_change(
                preparation,
                PasswordSecret::new("a-strong-password-123".to_owned()),
                PasswordSecret::new("replacement-password-456".to_owned()),
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("password change plan");
        let commit_plan = plan.commit_plan();
        let carrier = coordinator
            .premark_password_change(plan)
            .await
            .expect("premark password change");
        let attempt = provider.commit_password_change(&mut database, &commit_plan);
        let (finish, targets) = coordinator
            .finish_password_change(carrier, attempt)
            .into_parts();
        drop(admission);

        assert!(matches!(
            finish.expect("finish password change"),
            PasswordChangeFinish::Committed(_)
        ));
        assert!(
            targets
                .iter()
                .any(|target| target.session_id() == racing_session_id),
            "fresh planning under the identifier stripe must include the raced-in session"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&racing_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err(),
            "the predecessor-password session must be terminal after change"
        );
        assert_eq!(
            projected_terminal_reason_after_restart(&mut database, &racing_bearer, now_ms + 3,),
            RevocationReason::DurableRevocation,
            "the raced-in session must also be durably terminal"
        );
    }

    #[tokio::test]
    async fn password_lockout_is_uniform_resets_decays_and_expires() {
        let now_ms = 5_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        for offset in 1..=10 {
            let (finish, targets) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "locked@example.com",
                "wrong-password-123",
                now_ms + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
            assert!(targets.is_empty());
        }
        let locked = database
            .password_attempt_admin_projection("locked@example.com", now_ms + 10)
            .expect("admin lock projection")
            .expect("attempt row");
        assert_eq!(locked.failed_count, 10);
        assert!(locked.locked);
        let locked_until = locked.locked_until_ms.expect("lock deadline");
        let locked_started = Instant::now();
        let (locked_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            now_ms + 11,
        )
        .await;
        let locked_elapsed = locked_started.elapsed();
        assert!(matches!(locked_finish, IssuanceFinish::CredentialInvalid));

        let missing_started = Instant::now();
        let (missing_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "missing@example.com",
            "a-strong-password-123",
            now_ms + 11,
        )
        .await;
        let missing_elapsed = missing_started.elapsed();
        assert!(matches!(missing_finish, IssuanceFinish::CredentialInvalid));
        let timing_delta = locked_elapsed.abs_diff(missing_elapsed);
        assert!(
            timing_delta <= Duration::from_millis(250),
            "real locked and nonexistent KDF paths exceeded the declared 250ms test envelope: {locked_elapsed:?} vs {missing_elapsed:?}"
        );
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "wrong@example.com",
            "another-strong-password-456",
            now_ms + 12,
        )
        .await;
        let wrong_started = Instant::now();
        let (wrong_finish, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "wrong@example.com",
            "a-strong-password-123",
            now_ms + 13,
        )
        .await;
        let wrong_elapsed = wrong_started.elapsed();
        assert!(matches!(wrong_finish, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            credential_invalid().diagnostic().code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID",
            "every internal invalid outcome maps to the one public credential code"
        );
        assert!(
            wrong_elapsed.abs_diff(missing_elapsed) <= Duration::from_millis(250),
            "wrong-account and nonexistent KDF paths exceeded the declared 250ms test envelope: {wrong_elapsed:?} vs {missing_elapsed:?}"
        );

        let (reopened, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            locked_until,
        )
        .await;
        assert!(matches!(reopened, IssuanceFinish::Committed { .. }));
        assert!(
            database
                .password_attempt_admin_projection("locked@example.com", locked_until)
                .expect("success reset")
                .is_none()
        );

        for offset in 0..3 {
            let (finish, _) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "locked@example.com",
                "wrong-password-123",
                locked_until + 1 + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        }
        let rolled_at = locked_until + provider.password_security.failure_window_ms + 2;
        let (rolled, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "wrong-password-123",
            rolled_at,
        )
        .await;
        assert!(matches!(rolled, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            database
                .password_attempt_admin_projection("locked@example.com", rolled_at)
                .expect("rolled admin state")
                .expect("rolled row")
                .failed_count,
            1
        );

        let (owner_success, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "locked@example.com",
            "a-strong-password-123",
            rolled_at + 1,
        )
        .await;
        assert!(matches!(owner_success, IssuanceFinish::Committed { .. }));
        assert!(
            database
                .password_attempt_admin_projection("locked@example.com", rolled_at + 1)
                .expect("owner reset")
                .is_none()
        );
    }

    #[tokio::test]
    async fn lock_acquired_while_kdf_is_in_flight_blocks_the_precomputed_success() {
        let now_ms = 5_500_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "ledger-fence@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        for offset in 1..=9 {
            let (finish, _) = password_signin_for_test(
                &provider,
                &mut database,
                &coordinator,
                "ledger-fence@example.com",
                "wrong-password-123",
                now_ms + offset,
            )
            .await;
            assert!(matches!(finish, IssuanceFinish::CredentialInvalid));
        }
        let precomputed_success = provider
            .plan_password_authentication(
                &database,
                "ledger-fence@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 10,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("success proof computed outside writer");
        let (tenth, _) = password_signin_for_test(
            &provider,
            &mut database,
            &coordinator,
            "ledger-fence@example.com",
            "wrong-password-123",
            now_ms + 10,
        )
        .await;
        assert!(matches!(tenth, IssuanceFinish::CredentialInvalid));
        let (blocked, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            precomputed_success,
            now_ms + 10,
        )
        .await;
        assert!(matches!(blocked, IssuanceFinish::CredentialInvalid));
        let locked = database
            .password_attempt_admin_projection("ledger-fence@example.com", now_ms + 10)
            .expect("admin projection")
            .expect("ledger row");
        assert_eq!(locked.failed_count, 10);
        assert!(locked.locked);
    }

    #[tokio::test]
    async fn password_kdf_cap_and_sender_custody_refuse_with_typed_codes() {
        let now_ms = 6_000_000;
        let (provider, database, _) = password_provider_database_coordinator(now_ms);
        let permits = Arc::clone(&provider.password_kdf_permits)
            .try_acquire_many_owned(provider.password_security.kdf_concurrency as u32)
            .expect("hold entire password KDF capacity");
        let throttled = provider
            .hash_password_bounded(PasswordSecret::new("a-strong-password-123".to_owned()))
            .await
            .expect_err("KDF saturation must not queue");
        assert_eq!(throttled.diagnostic.code, "SNAPBACK_AUTH_THROTTLED");
        drop(permits);
        let refused = provider
            .plan_password_registration(
                &database,
                "sender@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::SenderConstrained,
            )
            .await
            .expect_err("sender-constrained password issuance is typed-refused");
        assert_eq!(
            refused.diagnostic.code,
            "SNAPBACK_AUTH_PASSWORD_SENDER_CONSTRAINED_UNSUPPORTED"
        );
    }

    #[tokio::test]
    async fn imported_hash_upgrades_by_generation_cas_and_lost_race_does_not_overwrite() {
        let now_ms = 7_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "upgrade@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let imported = bcrypt::hash("a-strong-password-123", 4).expect("bcrypt fixture");
        database
            .install_imported_password_hash_for_test("upgrade@example.com", "bcrypt", &imported)
            .expect("install imported hash");
        let first = provider
            .plan_password_authentication(
                &database,
                "upgrade@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("first upgrade plan");
        let losing = provider
            .plan_password_authentication(
                &database,
                "upgrade@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 2,
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("racing upgrade plan");
        let (winner, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            first,
            now_ms + 1,
        )
        .await;
        assert!(matches!(winner, IssuanceFinish::Committed { .. }));
        let (generation, algorithm, phc) = database
            .password_hash_facts_for_test("upgrade@example.com")
            .expect("upgraded hash facts");
        assert_eq!(generation, 2);
        assert_eq!(algorithm, "argon2id");
        assert!(phc.starts_with("$argon2id$"));
        let (loser, _) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            losing,
            now_ms + 2,
        )
        .await;
        assert!(matches!(loser, IssuanceFinish::CredentialInvalid));
        assert_eq!(
            database
                .password_hash_facts_for_test("upgrade@example.com")
                .expect("winner remains authoritative")
                .0,
            2
        );
        assert!(
            database
                .password_attempt_admin_projection("upgrade@example.com", now_ms + 2)
                .expect("lost upgrade ledger")
                .is_none()
        );
    }

    #[tokio::test]
    async fn password_upgrade_uses_declared_minimum_profile() {
        let low_now_ms = 7_100_000;
        let (low_provider, mut low_database, low_coordinator) =
            password_provider_database_coordinator_with_minimum(low_now_ms, 8);
        register_password_for_test(
            &low_provider,
            &mut low_database,
            &low_coordinator,
            "minimum-eight@example.com",
            "eight888",
            low_now_ms,
        )
        .await;
        let low_imported = bcrypt::hash("eight888", 4).expect("bcrypt fixture");
        low_database
            .install_imported_password_hash_for_test(
                "minimum-eight@example.com",
                "bcrypt",
                &low_imported,
            )
            .expect("install imported hash");
        let (low_finish, _) = password_signin_for_test(
            &low_provider,
            &mut low_database,
            &low_coordinator,
            "minimum-eight@example.com",
            "eight888",
            low_now_ms + 1,
        )
        .await;
        assert!(matches!(low_finish, IssuanceFinish::Committed { .. }));
        let (low_generation, _, low_phc) = low_database
            .password_hash_facts_for_test("minimum-eight@example.com")
            .expect("upgraded low-minimum hash");
        assert_eq!(low_generation, 2);
        assert!(low_phc.starts_with("$argon2id$"));

        let high_now_ms = 7_200_000;
        let (high_provider, mut high_database, high_coordinator) =
            password_provider_database_coordinator_with_minimum(high_now_ms, 20);
        register_password_for_test(
            &high_provider,
            &mut high_database,
            &high_coordinator,
            "minimum-twenty@example.com",
            "a-strong-password-123",
            high_now_ms,
        )
        .await;
        let high_imported = bcrypt::hash("fifteen-char-pw", 4).expect("bcrypt fixture");
        high_database
            .install_imported_password_hash_for_test(
                "minimum-twenty@example.com",
                "bcrypt",
                &high_imported,
            )
            .expect("install imported hash");
        let (high_finish, _) = password_signin_for_test(
            &high_provider,
            &mut high_database,
            &high_coordinator,
            "minimum-twenty@example.com",
            "fifteen-char-pw",
            high_now_ms + 1,
        )
        .await;
        assert!(matches!(high_finish, IssuanceFinish::Committed { .. }));
        let (high_generation, _, high_phc) = high_database
            .password_hash_facts_for_test("minimum-twenty@example.com")
            .expect("retained high-minimum legacy hash");
        assert_eq!(
            high_generation, 1,
            "a skipped upgrade must not bump generation"
        );
        assert_eq!(high_phc, high_imported);
    }

    #[tokio::test]
    async fn password_set_displaces_only_local_password_identity_sessions() {
        let now_ms = 8_000_000;
        let (provider, mut database, coordinator) = password_provider_database_coordinator(now_ms);
        let squatter = register_password_for_test(
            &provider,
            &mut database,
            &coordinator,
            "claimed@example.com",
            "a-strong-password-123",
            now_ms,
        )
        .await;
        let squatter_password_bearer = issue_token(&squatter);
        let squatter_user = squatter.response().session.user_id.clone();
        let displaced = database
            .password_snapshot("claimed@example.com")
            .expect("password snapshot")
            .expect("displaced credential");
        let (_, _, squatter_other_bearer) = database
            .insert_other_identity_session_for_test(
                &squatter_user,
                "other@example.com",
                now_ms + 1,
                provider.random.as_ref(),
            )
            .expect("other-identity session fixture");
        let actor = email_issue_for_test(
            &provider,
            &mut database,
            &coordinator,
            "claimed@example.com",
            now_ms + 2,
        )
        .await;
        let actor_old_bearer = issue_token(&actor);
        let actor_identity = database
            .identity_id_for_provider_subject_for_test("email-code", "claimed@example.com")
            .expect("actor email identity");
        let actor_session = &actor.response().session;
        let password_set_binding = StepUpBinding::password_set(
            actor_session.user_id.clone(),
            actor_session.id.clone(),
            actor_session.generation,
            actor_session.authority_instance_id.clone(),
            actor_identity.clone(),
        );
        let admission = provider.admit().await;
        let step_up_address = admission
            .step_up_address(&database, &password_set_binding, now_ms + 2)
            .expect("password-set step-up address");
        let step_up_request = admission
            .for_address(step_up_address)
            .await
            .expect("password-set address admission")
            .request_step_up(&mut database, &password_set_binding)
            .expect("password-set step-up challenge");
        let mailbox = serde_json::to_value(
            provider
                .mailbox_entry(&step_up_request.challenge_id)
                .await
                .expect("password-set step-up mailbox"),
        )
        .expect("serialize password-set step-up mailbox");
        let step_up_code = mailbox["code"]
            .as_str()
            .expect("password-set step-up code")
            .to_owned();
        let admission = provider.admit().await;
        let coordination = admission
            .step_up_coordination(&database, &step_up_request.challenge_id)
            .expect("password-set step-up coordination");
        let step_up = admission
            .for_step_up(coordination, password_set_binding, &step_up_code)
            .await
            .expect("password-set proof admission");

        // Pull the test-only fixture session into the same memory-only
        // projection before exercising exact displacement finalization.
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            database
                .session_projection_source()
                .expect("projection source"),
            now_ms + 2,
            provider.monotonic_now(),
        )
        .expect("rebuilt projection");
        let coordinator = Arc::new(AuthCoordinator::new(projection).expect("coordinator"));
        let preparation = provider
            .prepare_password_set(
                &database,
                actor.response().token(),
                &actor_identity,
                "claimed@example.com",
                now_ms + 3,
                PasswordIssuanceCustody::Bearer,
            )
            .expect("displacing password-set preparation");
        let plan = provider
            .finish_password_set(
                preparation,
                step_up.proof().clone(),
                PasswordSecret::new("rightful-password-456".to_owned()),
                now_ms + 3,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("displacing password-set plan");
        let (finish, targets) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            plan,
            now_ms + 3,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: new_password,
            ..
        } = finish
        else {
            panic!("password set must commit");
        };
        assert_eq!(targets.len(), 2);
        let terminated_session_ids = targets
            .iter()
            .map(CommittedRevocationTarget::session_id)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            terminated_session_ids,
            [
                squatter.response().session.id.as_str(),
                actor.response().session.id.as_str(),
            ]
            .into_iter()
            .collect(),
            "displacement terminates exactly the displaced password session and actor predecessor"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    &squatter_password_bearer,
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_err(),
            "session minted through displaced password identity must terminate"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    squatter_other_bearer.expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok(),
            "displaced principal's other-identity session must survive"
        );
        assert!(
            coordinator
                .resolve_required_bearer(&actor_old_bearer, now_ms + 3, provider.monotonic_now(),)
                .is_err(),
            "password set rotates the authenticated actor to the new issuance"
        );
        assert_eq!(
            projected_terminal_reason_after_restart(
                &mut database,
                &squatter_password_bearer,
                now_ms + 3,
            ),
            RevocationReason::DurableRevocation,
            "displaced password authority carries durable-delete terminal semantics"
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    new_password.response().token().expose_secret(),
                    now_ms + 3,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
        assert_eq!(
            database
                .displacement_facts_for_test(
                    &displaced.identity_id,
                    &displaced.credential_id,
                    &squatter_user,
                )
                .expect("displacement facts"),
            (true, true, true),
            "credential and identity retire without deleting the principal"
        );
        let claims = database
            .identity_claims(
                &new_password.response().session.id,
                now_ms + 3,
                crate::contract_types::ServerProfile::Test,
            )
            .expect("new password claims");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified)
        );
    }

    #[tokio::test]
    async fn guest_claim_and_recovery_consume_use_shared_issuance_finalization() {
        let now_ms = 9_000_000;
        let (provider, mut database, _) = password_provider_database_coordinator(now_ms);
        let guest = database
            .insert_typed_guest_session_for_test(now_ms + 60_000, now_ms, provider.random.as_ref())
            .expect("guest fixture");
        let projection = SessionProjection::rebuild_with_fresh_startup_id(
            database
                .session_projection_source()
                .expect("guest projection source"),
            now_ms,
            provider.monotonic_now(),
        )
        .expect("guest projection");
        let coordinator = Arc::new(AuthCoordinator::new(projection).expect("coordinator"));
        let claim = provider
            .plan_guest_claim_password(
                &database,
                &guest.bearer,
                "guest@example.com",
                PasswordSecret::new("a-strong-password-123".to_owned()),
                now_ms + 1,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .await
            .expect("guest password claim plan");
        let (claim_finish, claim_targets) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            claim,
            now_ms + 1,
        )
        .await;
        let claimed = match claim_finish {
            IssuanceFinish::Committed { issue: claimed, .. } => claimed,
            other => panic!("guest claim must commit, got {other:?}"),
        };
        assert_eq!(claim_targets.len(), 1);
        assert_eq!(claimed.response().session.user_id, guest.user_id);
        assert!(
            coordinator
                .resolve_required_bearer(
                    guest.bearer.expose_secret(),
                    now_ms + 1,
                    provider.monotonic_now(),
                )
                .is_err()
        );
        let recovery_code = claimed
            .recovery_codes()
            .expect("initial recovery codes")
            .expose_once()[0]
            .clone();
        let recovery = provider
            .plan_password_recovery_consume(
                &database,
                "guest@example.com",
                &recovery_code,
                now_ms + 2,
                "recovery-key-1",
                &[7; 32],
                PasswordIssuanceCustody::Bearer,
            )
            .expect("recovery consume plan");
        let claimed_bearer = issue_token(&claimed);
        let (recovery_finish, recovery_targets) = commit_password_issuance_for_test(
            &provider,
            &mut database,
            &coordinator,
            recovery,
            now_ms + 2,
        )
        .await;
        let IssuanceFinish::Committed {
            issue: recovered, ..
        } = recovery_finish
        else {
            panic!("recovery consume must commit");
        };
        assert_eq!(recovery_targets.len(), 1);
        assert!(recovered.recovery_codes().is_some());
        assert!(
            coordinator
                .resolve_required_bearer(&claimed_bearer, now_ms + 2, provider.monotonic_now(),)
                .is_err()
        );
        assert!(
            coordinator
                .resolve_required_bearer(
                    recovered.response().token().expose_secret(),
                    now_ms + 2,
                    provider.monotonic_now(),
                )
                .is_ok()
        );
    }
}
