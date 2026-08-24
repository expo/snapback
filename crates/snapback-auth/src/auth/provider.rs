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

use hmac::{Hmac, Mac as _};
use sha2::{Digest as _, Sha256};
use tokio::sync::{
    Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard,
    RwLock as AsyncRwLock, Semaphore,
};
use uuid::Uuid;
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, CryptoError, OsRandom,
    RandomSource, SessionBearer, StepUpDigest, StepUpProof, TokenHash, VerificationCode,
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
pub use crate::contract_types::PresentedSessionLookup;
pub use crate::contract_types::{
    AuthProviderProfile, AuthenticatedUse, ResolvedSession, SessionRevocation,
};
use crate::contract_types::{
    AuthSessionRecord as SessionRecord, CatalogIssuanceReconcile, ExchangeChallengeFact,
    PlannedIdentityState, RejectedExchangeOutcome, RequestInsertOutcome, RevocationReason,
    SessionCapFacts, SessionIssuanceFacts, SessionRevocationCandidateFact, TokenDigest,
};
pub use crate::contract_types::{
    DurableRejectedIssuanceReconcile, DurableRevocationReconcile, DurableRotationReconcile,
    PlannedFamilyAlarmCommit, PlannedRevocationCommit, PlannedRotationTransaction,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;
use crate::storage::auth::AuthTransactionAttempt;
use crate::storage::auth_catalog_ops::{
    CatalogChallengeConsumption, CatalogFamilyAlarmPlan, CatalogGuestEntryIdempotencyPlan,
    CatalogIssuanceCommit, CatalogPasswordChangeCommit, CatalogPasswordChangePlan,
    CatalogPasswordChangeReconcile, CatalogProjectedSession, CatalogRejectedExchangePlan,
    CatalogRevocationPlan, CatalogRotationPlan, CatalogSessionIssuancePlan, CatalogStepUpBinding,
    GuestEntryIdempotencyLookup, INTERNAL_AUTH_COLLISION, guest_refusal_correlation_id,
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
    pub guests_reaped: u64,
    pub mailbox_entries_pruned: usize,
    pub retired_keys_pruned: usize,
    pub immediate_retry: bool,
}

impl AuthGcPass {
    pub fn next_delay(self) -> Duration {
        if self.immediate_retry {
            Duration::ZERO
        } else {
            super::lifecycle::AUTH_GC_INTERVAL
        }
    }
}

fn auth_budget_deployment_profile(profile: AuthProviderProfile) -> AuthBudgetDeploymentProfile {
    match profile {
        AuthProviderProfile::Dev => AuthBudgetDeploymentProfile::Dev,
        AuthProviderProfile::Test => AuthBudgetDeploymentProfile::Test,
        AuthProviderProfile::Demo => AuthBudgetDeploymentProfile::Demo,
        AuthProviderProfile::Prod => AuthBudgetDeploymentProfile::Prod,
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
pub struct StepUpBinding {
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

    pub fn grant_approval(
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
    pub fn agent_invitation(
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

    pub fn password_set(
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
    pub fn effect_approval(
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

pub struct StepUpCoordination {
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
pub struct StepUpProofAdmission {
    _admission: AuthAdmission,
    _stripe: OwnedMutexGuard<()>,
    proof: StepUpProof,
}

impl StepUpProofAdmission {
    pub fn proof(&self) -> &StepUpProof {
        &self.proof
    }

    pub fn address(&self) -> &CanonicalAddress {
        &self.proof.address
    }

    pub fn prepare_password_set_plan<'a>(
        &'a self,
        acting: &'a SessionBearer,
        email_identity_id: &'a str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = SnapbackResult<PasswordSetPreparation>> + 'a
    {
        let identifier = self.proof.address.as_str();
        super::database_plan::plan(move |database| {
            self._admission.provider.prepare_password_set(
                database,
                acting,
                email_identity_id,
                identifier,
                now_ms,
                custody,
            )
        })
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
    pub fn address(&self) -> &CanonicalAddress {
        &self.address
    }
}

/// Credential issuance may atomically evict one prior live session. Keeping
/// that fact beside the response lets item 5 update its projection before the
/// plaintext credential is published.
pub struct CredentialIssue {
    response: CredentialResponse,
    #[cfg(any(test, feature = "test-support"))]
    pub committed_revocation: Option<SessionRevocation>,
    #[cfg(not(any(test, feature = "test-support")))]
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
    pub fn recovery_codes(&self) -> Option<&crate::auth::identity_core::RecoveryCodes> {
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

    #[cfg(any(test, feature = "test-support"))]
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
pub enum PasswordIssuanceCustody {
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

#[cfg(any(test, feature = "test-support"))]
pub struct BearerCandidate {
    bearer: Option<SessionBearer>,
    pub token_hash: TokenHash,
}

#[cfg(not(any(test, feature = "test-support")))]
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
pub enum PlannedTokenSource {
    Current,
    Superseded { superseded_at_ms: u64 },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderRevocationPlan {
    session_id: String,
    expected_generation: u64,
    presented_digest: TokenDigest,
    source: PlannedTokenSource,
    reason: RevocationReason,
}

impl ProviderRevocationPlan {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn expected_generation(&self) -> u64 {
        self.expected_generation
    }

    pub fn reason(&self) -> RevocationReason {
        self.reason
    }

    pub fn catalog_plan(&self) -> CatalogRevocationPlan<'_> {
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn for_test(
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

pub struct ProviderTokenRotationPlan {
    session_id: String,
    expected_generation: u64,
    predecessor_digest: TokenDigest,
    successor_digest: TokenDigest,
    superseded_at_ms: u64,
    #[cfg(any(test, feature = "test-support"))]
    pub successor: BearerCandidate,
    #[cfg(not(any(test, feature = "test-support")))]
    successor: BearerCandidate,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderTokenRotationCommitPlan {
    session_id: String,
    expected_generation: u64,
    predecessor_digest: TokenDigest,
    successor_digest: TokenDigest,
    superseded_at_ms: u64,
}

impl ProviderTokenRotationPlan {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn expected_generation(&self) -> u64 {
        self.expected_generation
    }

    pub fn predecessor_digest(&self) -> TokenDigest {
        self.predecessor_digest
    }

    pub fn successor_digest(&self) -> TokenDigest {
        self.successor_digest
    }

    pub fn superseded_at_ms(&self) -> u64 {
        self.superseded_at_ms
    }

    pub fn commit_plan(&self) -> ProviderTokenRotationCommitPlan {
        ProviderTokenRotationCommitPlan {
            session_id: self.session_id.clone(),
            expected_generation: self.expected_generation,
            predecessor_digest: self.predecessor_digest,
            successor_digest: self.successor_digest,
            superseded_at_ms: self.superseded_at_ms,
        }
    }

    pub fn into_issue(mut self, session: SessionResponse) -> CredentialIssue {
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn for_test(
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
    pub fn catalog_plan(&self) -> CatalogRotationPlan<'_> {
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
pub struct ProviderPasswordChangePlan {
    mutation: crate::storage::auth_identity::CredentialRotationMutation,
    rotation: ProviderTokenRotationPlan,
    revocations: Vec<ProviderRevocationPlan>,
    password_profile: crate::storage::auth_identity::PasswordSecurityProfile,
    recovery_codes: Option<crate::auth::identity_core::RecoveryCodes>,
    successor_provider: Option<&'static str>,
    successful_effect_budget: Option<snapback_kernel::auth::throttle::RollingWindowBudgetTerms>,
}

/// Read-only password planning facts captured under the managed Local lane.
/// These carriers contain no caller plaintext; Argon2 consumes them only
/// after the Local guard has been released.
pub struct PasswordRegistrationPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
}

pub struct PasswordAuthenticationPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
    predecessor: crate::storage::auth_identity::PasswordAuthenticationPredecessor,
    revocations: Vec<ProviderRevocationPlan>,
}

pub struct PasswordSetPreparation {
    mode: crate::storage::auth::PasswordIdentifierMode,
    canonical: String,
    address: CanonicalAddress,
    planning: crate::storage::auth_identity::PasswordSetPlanning,
    revocations: Vec<ProviderRevocationPlan>,
}

pub struct PasswordChangePreparation {
    planning: crate::storage::auth_identity::PasswordChangePlanning,
    #[cfg(any(test, feature = "test-support"))]
    pub revocations: Vec<ProviderRevocationPlan>,
    #[cfg(not(any(test, feature = "test-support")))]
    revocations: Vec<ProviderRevocationPlan>,
}

pub struct GuestClaimPasswordPreparation {
    address: CanonicalAddress,
    canonical: String,
    mode: crate::storage::auth::PasswordIdentifierMode,
    predecessor: crate::storage::auth_identity::GuestClaimPredecessor,
    revocations: Vec<ProviderRevocationPlan>,
}

pub enum PasswordResetPreparation {
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
    pub fn canonical_identifier(&self) -> &str {
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
pub struct ProviderPasswordChangeCommitPlan {
    mutation: crate::storage::auth_identity::CredentialRotationMutation,
    rotation: ProviderTokenRotationCommitPlan,
    revocations: Vec<ProviderRevocationPlan>,
    password_profile: crate::storage::auth_identity::PasswordSecurityProfile,
    successor_provider: Option<&'static str>,
    successful_effect_budget: Option<snapback_kernel::auth::throttle::RollingWindowBudgetTerms>,
}

impl fmt::Debug for ProviderPasswordChangePlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderPasswordChangePlan([REDACTED])")
    }
}

#[allow(dead_code)]
impl ProviderPasswordChangePlan {
    pub fn rotation(&self) -> &ProviderTokenRotationPlan {
        &self.rotation
    }

    pub fn revocations(&self) -> &[ProviderRevocationPlan] {
        &self.revocations
    }

    pub fn commit_plan(&self) -> ProviderPasswordChangeCommitPlan {
        ProviderPasswordChangeCommitPlan {
            mutation: self.mutation.clone(),
            rotation: self.rotation.commit_plan(),
            revocations: self.revocations.clone(),
            password_profile: self.password_profile,
            successor_provider: self.successor_provider,
            successful_effect_budget: self.successful_effect_budget,
        }
    }

    pub fn successor_provider(&self) -> Option<&'static str> {
        self.successor_provider
    }

    pub fn into_issue(mut self, session: SessionResponse) -> CredentialIssue {
        self.rotation
            .into_issue(session)
            .with_recovery_codes(self.recovery_codes.take())
    }
}

impl ProviderPasswordChangeCommitPlan {
    pub fn catalog_plan(&self) -> CatalogPasswordChangePlan<'_> {
        CatalogPasswordChangePlan {
            mutation: &self.mutation,
            rotation: self.rotation.catalog_plan(),
            revocations: self
                .revocations
                .iter()
                .map(ProviderRevocationPlan::catalog_plan)
                .collect(),
            password_profile: self.password_profile,
            successor_provider: self.successor_provider,
            successful_effect_budget: self.successful_effect_budget,
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub enum PlannedPasswordChangeCommit {
    Committed {
        session: SessionResponse,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PlannedLogout {
    AuthRequired,
    SessionExpired,
    CredentialSuperseded,
    Revoke(ProviderRevocationPlan),
}

pub enum PlannedRefresh {
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
pub struct ProviderFamilyAlarmPlan {
    session_id: String,
    expected_generation: u64,
    presented_digest: TokenDigest,
    superseded_at_ms: u64,
    observed_at_ms: u64,
    #[cfg(any(test, feature = "test-support"))]
    pub actionable: bool,
    #[cfg(not(any(test, feature = "test-support")))]
    actionable: bool,
    publish_not_before: Instant,
}

impl ProviderFamilyAlarmPlan {
    pub fn revocation_plan(&self) -> Option<ProviderRevocationPlan> {
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

    pub fn publish_not_before(&self) -> Instant {
        self.publish_not_before
    }

    pub fn catalog_plan(&self) -> CatalogFamilyAlarmPlan<'_> {
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

pub enum PlannedRotationCommit {
    Committed { session: SessionResponse },
    CandidateCollision,
    PredecessorChanged,
}

// Guest entry is the only issuance path that needs the successful-effect
// budget and durable idempotency plan. Keep that comparatively large state
// behind one allocation so every ordinary provider/session issuance—and the
// shared host-op dispatcher future that carries it—does not inherit its size.
// @ref LLP 0215#6-idempotency-and-retry-identity — the complete guest retry
// identity remains one owned issuance-plan component through commit.
#[derive(Clone, Eq, PartialEq)]
struct ProviderGuestIssuanceState {
    effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
    idempotency: CatalogGuestEntryIdempotencyPlan,
}

pub struct ProviderSessionIssuancePlan {
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
pub struct ProviderSessionIssuanceCommitPlan {
    address: CanonicalAddress,
    now_ms: u64,
    identity: PlannedIdentityState,
    #[cfg(any(test, feature = "test-support"))]
    pub projected: ProjectedSessionInsert,
    #[cfg(not(any(test, feature = "test-support")))]
    pub(crate) projected: ProjectedSessionInsert,
    revocations: Vec<ProviderRevocationPlan>,
    password: Option<crate::storage::auth_identity::PasswordIssuanceCommitPlan>,
    password_profile: Option<crate::storage::auth_identity::PasswordSecurityProfile>,
    challenge: Option<PlannedChallengeConsumption>,
    pub(crate) sender_issuance: Option<crate::auth::sender_proof::SenderIssuanceCommitment>,
    rehearsal_exercise: Option<crate::storage::auth_rehearsal::RehearsalExercisePlan>,
}

/// Guest-only issuance carrier. The ordinary provider/session plan remains
/// compact for the shared host-op shape; guest effect accounting and
/// idempotency travel beside it only on the guest route.
pub struct ProviderGuestSessionIssuancePlan {
    issuance: ProviderSessionIssuancePlan,
    guest: Box<ProviderGuestIssuanceState>,
}

#[derive(Clone, Eq, PartialEq)]
pub struct ProviderGuestSessionIssuanceCommitPlan {
    issuance: ProviderSessionIssuanceCommitPlan,
    guest: Box<ProviderGuestIssuanceState>,
}

pub struct ProviderGuestIssuanceContext {
    guest: Box<ProviderGuestIssuanceState>,
}

impl fmt::Debug for ProviderGuestSessionIssuancePlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderGuestSessionIssuancePlan([REDACTED])")
    }
}

impl fmt::Debug for ProviderGuestSessionIssuanceCommitPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProviderGuestSessionIssuanceCommitPlan([REDACTED])")
    }
}

impl ProviderGuestSessionIssuancePlan {
    pub fn commit_plan(&self) -> ProviderGuestSessionIssuanceCommitPlan {
        ProviderGuestSessionIssuanceCommitPlan {
            issuance: self.issuance.commit_plan(),
            guest: self.guest.clone(),
        }
    }

    pub fn into_coordinated_parts(
        self,
    ) -> (ProviderSessionIssuancePlan, ProviderGuestIssuanceContext) {
        (
            self.issuance,
            ProviderGuestIssuanceContext { guest: self.guest },
        )
    }

    pub fn into_issue(
        self,
        session: SessionResponse,
        committed_revocations: Vec<SessionRevocation>,
    ) -> CredentialIssue {
        self.issuance.into_issue(session, committed_revocations)
    }
}

impl ProviderGuestIssuanceContext {
    pub fn commit_plan(
        &self,
        issuance: ProviderSessionIssuanceCommitPlan,
    ) -> ProviderGuestSessionIssuanceCommitPlan {
        ProviderGuestSessionIssuanceCommitPlan {
            issuance,
            guest: self.guest.clone(),
        }
    }
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
    pub fn bind_rehearsal_provenance(
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

    pub fn bind_rehearsal_effect(
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

    pub fn creates_identity(&self) -> bool {
        matches!(
            self.identity,
            PlannedIdentityState::Create { .. } | PlannedIdentityState::GuestCreate { .. }
        )
    }

    pub fn planned_identity(&self) -> PlannedIdentityState {
        self.identity.clone()
    }

    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4's first layer: a
    // sender-bound issuance re-mints its candidate bearer in the versioned
    // `sbs2_` spelling before anything derives from the plan (binding runs
    // before premark and before the commit plan is taken), so the projected
    // digest, the durable row, and the returned credential all name the
    // legacy-rejecting spelling.
    pub fn bind_sender_issuance(
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

    pub fn projected_insert(&self) -> ProjectedSessionInsert {
        self.projected.clone()
    }

    pub fn eviction(&self) -> Option<&ProviderRevocationPlan> {
        self.revocations
            .iter()
            .find(|revocation| revocation.reason() == RevocationReason::CapEviction)
    }

    pub fn revocations(&self) -> &[ProviderRevocationPlan] {
        &self.revocations
    }

    pub fn commit_plan(&self) -> ProviderSessionIssuanceCommitPlan {
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

    #[cfg(any(test, feature = "test-support"))]
    pub fn for_test(projected: ProjectedSessionInsert, bearer: SessionBearer) -> Self {
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

    pub fn into_issue(
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
    pub fn catalog_plan(&self) -> CatalogSessionIssuancePlan<'_> {
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
            guest_effect_budget: None,
            guest_idempotency: None,
            live_session_limit: AUTH_SESSION_LIVE_LIMIT as u64,
        }
    }
}

#[derive(Clone, Debug)]
pub enum PlannedIssuanceCommit {
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
    RehearsalDenied(SnapbackError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RejectedExchangeCommit {
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
pub enum PlannedExchange {
    Reject,
    Issue(ProviderSessionIssuancePlan),
}

/// Durable outcomes for the idempotent guest-entry effect. A committed replay
/// reconstructs the original bearer from a keyring-derived PRF seed; the
/// plaintext credential is never written to SQLite.
pub enum ProviderGuestSessionPlan {
    Planned(ProviderGuestSessionIssuancePlan),
    Replay(CredentialIssue),
    Refused {
        budget_name: String,
        retry_after_ms: u64,
        correlation_id: String,
    },
    Conflict,
}

impl fmt::Debug for ProviderGuestSessionPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Planned(_) => {
                formatter.write_str("ProviderGuestSessionPlan::Planned([REDACTED])")
            }
            Self::Replay(_) => formatter.write_str("ProviderGuestSessionPlan::Replay([REDACTED])"),
            Self::Refused { .. } => formatter.write_str("ProviderGuestSessionPlan::Refused"),
            Self::Conflict => formatter.write_str("ProviderGuestSessionPlan::Conflict"),
        }
    }
}

struct DeterministicGuestRandom {
    seed: Zeroizing<[u8; 32]>,
    counter: AtomicU64,
}

impl DeterministicGuestRandom {
    fn new(seed: [u8; 32]) -> Self {
        Self {
            seed: Zeroizing::new(seed),
            counter: AtomicU64::new(0),
        }
    }
}

impl RandomSource for DeterministicGuestRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
        for chunk in destination.chunks_mut(32) {
            let counter = self
                .counter
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| CryptoError::RandomUnavailable)?;
            let mut mac = Hmac::<Sha256>::new_from_slice(self.seed.as_slice())
                .map_err(|_| CryptoError::RandomUnavailable)?;
            mac.update(b"snapback.auth.guest-entry.random.v1\0");
            mac.update(&counter.to_be_bytes());
            let block = mac.finalize().into_bytes();
            chunk.copy_from_slice(&block[..chunk.len()]);
        }
        Ok(())
    }
}

fn guest_entry_digest(domain: &[u8], values: &[&[u8]]) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(domain);
    for value in values {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value);
    }
    digest.finalize().into()
}

fn guest_entry_seed(key: &AuthKeyMaterial, key_digest: &[u8; 32]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
        .expect("fixed-size auth key is a valid HMAC key");
    mac.update(b"snapback.auth.guest-entry.seed.v1\0");
    mac.update(key_digest);
    mac.finalize().into_bytes().into()
}

pub struct AuthProvider {
    profile: AuthProviderProfile,
    budgets: ResolvedCompatibilityAuthBudgetPolicy,
    #[cfg(any(test, feature = "test-support"))]
    pub keyring: Arc<AuthKeyringStore>,
    #[cfg(not(any(test, feature = "test-support")))]
    keyring: Arc<AuthKeyringStore>,
    mailbox: CaptureMailbox,
    #[cfg(any(test, feature = "test-support"))]
    pub random: Arc<dyn RandomSource>,
    #[cfg(not(any(test, feature = "test-support")))]
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
    #[cfg(any(test, feature = "test-support"))]
    pub dummy_token_hash: TokenHash,
    #[cfg(not(any(test, feature = "test-support")))]
    dummy_token_hash: TokenHash,
    maintenance: Arc<AsyncRwLock<()>>,
    address_stripes: Vec<Arc<AsyncMutex<()>>>,
    address_hasher: RandomState,
    #[allow(dead_code)] // Password route registration lands in the adjacent lane.
    #[cfg(any(test, feature = "test-support"))]
    pub password_security: crate::storage::auth_identity::PasswordSecurityProfile,
    #[allow(dead_code)]
    #[cfg(not(any(test, feature = "test-support")))]
    password_security: crate::storage::auth_identity::PasswordSecurityProfile,
    #[allow(dead_code)]
    #[cfg(any(test, feature = "test-support"))]
    pub password_kdf_permits: Arc<Semaphore>,
    #[allow(dead_code)]
    #[cfg(not(any(test, feature = "test-support")))]
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

    pub fn new_with_password_minimum(
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

    pub fn new_with_dependencies_and_password_minimum(
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
            auth_budget_deployment_profile(profile),
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

    /// Plan the policy-derived guest principal and its first session. The
    /// caller contributes no identifiers or lifetime facts.
    /// @ref LLP 0214#81-guest-principal-and-session-creation — CSPRNG minting
    /// and policy expiry precede the atomic catalog transition.
    pub fn plan_guest_session(
        &self,
        database: &mut LocalDatabase,
        observed_now_ms: u64,
        guest_retention_ms: u64,
        effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
        idempotency_key: &str,
        app_id: &str,
        deployment_id: &str,
        policy_digest: &str,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderGuestSessionPlan> {
        require_password_bearer_custody(custody)?;
        validate_now(observed_now_ms).map_err(ProviderError::into_snapback_error)?;
        if idempotency_key.len() < 16
            || idempotency_key.len() > 256
            || idempotency_key
                .bytes()
                .any(|byte| !(0x21..=0x7e).contains(&byte))
            || app_id.is_empty()
            || deployment_id.is_empty()
            || policy_digest.len() != 71
            || !policy_digest.starts_with("sha256:")
            || !policy_digest[7..]
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_IDEMPOTENCY_INVALID",
                "auth",
                "guest-entry idempotency identity is invalid",
            ));
        }
        let profile = match self.profile {
            AuthProviderProfile::Dev => b"dev".as_slice(),
            AuthProviderProfile::Test => b"test".as_slice(),
            AuthProviderProfile::Demo => b"demo".as_slice(),
            AuthProviderProfile::Prod => b"prod".as_slice(),
        };
        let key_digest = guest_entry_digest(
            b"snapback.auth.guest-entry.key.v1\0",
            &[
                app_id.as_bytes(),
                deployment_id.as_bytes(),
                profile,
                idempotency_key.as_bytes(),
            ],
        );
        let request_digest = guest_entry_digest(
            b"snapback.auth.guest-entry.request.v1\0",
            &[policy_digest.as_bytes(), b"{}"],
        );
        let lookup = database.guest_entry_idempotency_lookup(
            &key_digest,
            &request_digest,
            observed_now_ms,
        )?;
        let was_committed = matches!(lookup, GuestEntryIdempotencyLookup::Committed { .. });
        if matches!(lookup, GuestEntryIdempotencyLookup::Conflict) {
            return Ok(ProviderGuestSessionPlan::Conflict);
        }
        if let GuestEntryIdempotencyLookup::Refused {
            budget_name,
            retry_after_ms,
            correlation_id,
            ..
        } = &lookup
        {
            return Ok(ProviderGuestSessionPlan::Refused {
                budget_name: budget_name.clone(),
                retry_after_ms: *retry_after_ms,
                correlation_id: correlation_id.clone(),
            });
        }
        let (key_id, now_ms, seed) = match lookup {
            GuestEntryIdempotencyLookup::Missing => {
                // A first attempt must still cross the injected production
                // CSPRNG boundary. Replays use only the durable key id.
                let mut probe = [0_u8; 1];
                self.random.fill(&mut probe).map_err(|_| {
                    SnapbackError::error(
                        "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                        "auth",
                        "authentication randomness is unavailable",
                    )
                })?;
                self.keyring
                    .with_active_key(observed_now_ms, self.random.as_ref(), |key_id, key| {
                        (
                            key_id.as_str().to_owned(),
                            observed_now_ms,
                            guest_entry_seed(key, &key_digest),
                        )
                    })
                    .map_err(|_| provider_unavailable().into_snapback_error())?
            }
            GuestEntryIdempotencyLookup::Pending {
                key_id,
                created_at_ms,
            }
            | GuestEntryIdempotencyLookup::Committed {
                key_id,
                created_at_ms,
            } => {
                let parsed = AuthKeyId::parse(&key_id)
                    .map_err(|_| provider_unavailable().into_snapback_error())?;
                let seed = self
                    .keyring
                    .with_key(&parsed, |key| guest_entry_seed(key, &key_digest))
                    .map_err(|_| provider_unavailable().into_snapback_error())?;
                (key_id, created_at_ms, seed)
            }
            GuestEntryIdempotencyLookup::Refused { .. } | GuestEntryIdempotencyLookup::Conflict => {
                unreachable!("handled above")
            }
        };
        validate_now(now_ms).map_err(ProviderError::into_snapback_error)?;
        let guest_expires_at_ms = checked_time_add_snapback(now_ms, guest_retention_ms)?;
        if guest_expires_at_ms <= now_ms || guest_expires_at_ms > MAX_SAFE_TIMESTAMP {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_GUEST_POLICY_INVALID",
                "auth",
                "generated guest policy is invalid",
            ));
        }
        let deterministic = DeterministicGuestRandom::new(seed);
        let candidate =
            SessionCandidate::generate_with_random(&deterministic, now_ms).map_err(|_| {
                SnapbackError::error(
                    "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                    "auth",
                    "authentication randomness is unavailable",
                )
            })?;
        let expires_at_ms = checked_time_add_snapback(now_ms, AUTH_SESSION_SLIDING_WINDOW_MS)?
            .min(guest_expires_at_ms);
        let absolute_expires_at_ms =
            checked_time_add_snapback(now_ms, AUTH_SESSION_ABSOLUTE_WINDOW_MS)?
                .min(guest_expires_at_ms);
        let user_id = candidate.user_id.clone();
        let projected = ProjectedSessionInsert {
            session_id: candidate.session_id.clone(),
            user_id: user_id.clone(),
            provider: "guest".to_owned(),
            authority_instance_id: candidate.authority_instance_id.clone(),
            generation: 1,
            token_digest: TokenDigest::from_token_hash(&candidate.token_hash),
            created_at_ms: now_ms,
            expires_at_ms,
            absolute_expires_at_ms,
            rehearsal_provenance: None,
        };
        let idempotency = CatalogGuestEntryIdempotencyPlan {
            key_digest,
            request_digest,
            key_id,
            created_at_ms: now_ms,
            retain_until_ms: guest_expires_at_ms,
            refusal_correlation_id: guest_refusal_correlation_id(&key_digest, &request_digest),
        };
        let plan = ProviderGuestSessionIssuancePlan {
            issuance: ProviderSessionIssuancePlan {
                address: CanonicalAddress::parse("guest@snapback.invalid")
                    .map_err(|_| provider_unavailable().into_snapback_error())?,
                now_ms,
                identity: PlannedIdentityState::GuestCreate {
                    user_id,
                    expires_at_ms: guest_expires_at_ms,
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
            },
            guest: Box::new(ProviderGuestIssuanceState {
                effect_budget,
                idempotency,
            }),
        };
        if was_committed {
            let durable = database
                .auth_catalog_read()
                .lookup_presented_session(&plan.issuance.candidate.token_hash)?;
            let PresentedSessionLookup::Current(durable) = durable else {
                return Err(provider_unavailable().into_snapback_error());
            };
            if durable.session.session_id != plan.issuance.projected.session_id
                || durable.session.user_id != plan.issuance.projected.user_id
                || durable.session.authority_instance_id
                    != plan.issuance.projected.authority_instance_id
                || durable.session.generation != plan.issuance.projected.generation
            {
                return Err(provider_unavailable().into_snapback_error());
            }
            let session = SessionResponse {
                id: durable.session.session_id,
                user_id: durable.session.user_id,
                provider: durable.session.provider,
                created_at: durable.session.created_at_ms,
                expires_at: durable.session.expires_at_ms,
                absolute_expires_at: durable.session.absolute_expires_at_ms,
                authority_instance_id: durable.session.authority_instance_id,
                generation: durable.session.generation,
            };
            return Ok(ProviderGuestSessionPlan::Replay(
                plan.into_issue(session, Vec::new()),
            ));
        }
        Ok(ProviderGuestSessionPlan::Planned(plan))
    }

    pub(crate) fn budget_policy(&self) -> ResolvedCompatibilityAuthBudgetPolicy {
        self.budgets
    }

    pub const fn password_security_profile(
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
    pub async fn hash_password_bounded(
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
    pub fn prepare_password_registration(
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

    pub async fn finish_password_registration_with_active_recovery_key(
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
    pub async fn plan_password_registration(
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
    pub fn prepare_password_authentication(
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

    pub async fn finish_password_authentication(
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
            PlannedIdentityState::GuestCreate { .. } => {
                return Err(internal_state_snapback());
            }
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

    pub async fn plan_password_authentication(
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

    pub async fn finish_password_reset(
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

    pub fn commit_password_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        if plan.password.is_none() || plan.challenge.is_some() || plan.sender_issuance.is_some() {
            return AuthTransactionAttempt::RolledBack(internal_state_snapback());
        }
        attempt_planned_session_issuance(database, plan, None, None)
    }

    pub fn commit_guest_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderGuestSessionIssuanceCommitPlan,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        if !matches!(
            plan.issuance.identity,
            PlannedIdentityState::GuestCreate { .. }
        ) || plan.issuance.password.is_some()
            || plan.issuance.challenge.is_some()
            || plan.issuance.sender_issuance.is_some()
        {
            return AuthTransactionAttempt::RolledBack(internal_state_snapback());
        }
        attempt_planned_session_issuance(database, &plan.issuance, None, Some(plan.guest.as_ref()))
    }

    pub fn prepare_password_set(
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
    pub async fn finish_password_set(
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

    pub async fn finish_password_set_with_active_recovery_key(
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

    pub fn prepare_password_change(
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

    pub async fn finish_password_change(
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
            mutation: crate::storage::auth_identity::CredentialRotationMutation::PasswordChange(
                crate::storage::auth_identity::PasswordChangeCommitPlan {
                    credential: planning.credential,
                    canonical_identifier: planning.canonical_identifier,
                    verified: verification.verified,
                    replacement,
                },
            ),
            rotation,
            revocations,
            password_profile: self.password_security,
            recovery_codes: None,
            successor_provider: None,
            successful_effect_budget: None,
        })
    }

    pub async fn plan_password_change(
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

    pub fn commit_password_change(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderPasswordChangeCommitPlan,
    ) -> AuthTransactionAttempt<PlannedPasswordChangeCommit> {
        attempt_planned_password_change(database, plan)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn plan_guest_claim_password(
        &self,
        database: &LocalDatabase,
        guest: &SessionBearer,
        identifier: &str,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        successful_effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderPasswordChangePlan> {
        require_password_bearer_custody(custody)?;
        let preparation =
            self.prepare_guest_claim_password(database, guest, identifier, now_ms, custody)?;
        self.finish_guest_claim_password(
            preparation,
            password,
            now_ms,
            recovery_key_id,
            recovery_key,
            successful_effect_budget,
            custody,
        )
        .await
    }

    pub fn prepare_guest_claim_password(
        &self,
        database: &LocalDatabase,
        guest: &SessionBearer,
        identifier: &str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<GuestClaimPasswordPreparation> {
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
        // Resolve the presented guest first. A non-guest or invalid bearer
        // must not probe whether a password identifier already exists.
        let predecessor = database.guest_claim_predecessor(guest, now_ms)?;
        // Sample occupancy only after resolving the exact guest, then carry
        // both occupied and available subjects through the same KDF. The
        // writer transaction rechecks the all-provider predicate.
        let _collision_observed = database.password_identity_subject_is_owned(&canonical, mode)?;
        let revocations = plan_user_session_revocations(
            database,
            &predecessor.user_id,
            Some(&predecessor.session_id),
            None,
            now_ms,
        )?;
        Ok(GuestClaimPasswordPreparation {
            address,
            canonical,
            mode,
            predecessor,
            revocations,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn finish_guest_claim_password(
        &self,
        preparation: GuestClaimPasswordPreparation,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        recovery_key_id: &str,
        recovery_key: &[u8; 32],
        successful_effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderPasswordChangePlan> {
        require_password_bearer_custody(custody)?;
        let GuestClaimPasswordPreparation {
            address,
            canonical,
            mode,
            predecessor,
            revocations,
        } = preparation;
        let password = self.hash_password_bounded(password).await?;
        let (recovery_codes, recovery) = crate::storage::auth_identity::prepare_recovery_set(
            self.random.as_ref(),
            recovery_key_id,
            recovery_key,
        )?;
        let successor =
            BearerCandidate::generate(self).map_err(ProviderError::into_snapback_error)?;
        let user_id = predecessor.user_id.clone();
        let identity_id = mint_catalog_id(crate::ids::Kind::Identity, self.random.as_ref(), now_ms)
            .map_err(ProviderError::into_snapback_error)?;
        let rotation = ProviderTokenRotationPlan {
            session_id: predecessor.session_id.clone(),
            expected_generation: predecessor.generation,
            predecessor_digest: predecessor.token_digest,
            successor_digest: TokenDigest::from_token_hash(&successor.token_hash),
            superseded_at_ms: now_ms,
            successor,
        };
        let _ = address;
        Ok(ProviderPasswordChangePlan {
            mutation: crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(
                crate::storage::auth_identity::PasswordIssuanceCommitPlan {
                    canonical_identifier: canonical,
                    identifier_mode: mode,
                    identity_id,
                    user_id,
                    operation:
                        crate::storage::auth_identity::PasswordIssuanceOperation::GuestClaim {
                            predecessor,
                            credential_id: opaque_catalog_component("credential"),
                            password,
                            recovery,
                        },
                },
            ),
            rotation,
            revocations,
            password_profile: self.password_security,
            recovery_codes: Some(recovery_codes),
            successor_provider: Some("local-password"),
            successful_effect_budget: Some(successful_effect_budget),
        })
    }

    pub async fn finish_guest_claim_password_with_active_recovery_key(
        &self,
        preparation: GuestClaimPasswordPreparation,
        password: crate::auth::identity_core::PasswordSecret,
        now_ms: u64,
        successful_effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
        custody: PasswordIssuanceCustody,
    ) -> SnapbackResult<ProviderPasswordChangePlan> {
        let (key_id, key) = self
            .keyring
            .with_active_key(now_ms, self.random.as_ref(), |key_id, key| {
                (
                    key_id.as_str().to_owned(),
                    Zeroizing::new(*key.expose_secret()),
                )
            })
            .map_err(|_| provider_unavailable().into_snapback_error())?;
        self.finish_guest_claim_password(
            preparation,
            password,
            now_ms,
            &key_id,
            &key,
            successful_effect_budget,
            custody,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)] // Recovery proof, replacement set, and custody cross one fence.
    pub fn plan_password_recovery_consume(
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

    pub fn plan_password_recovery_consume_with_active_key(
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

    pub fn plan_password_recovery_rotate_with_active_key(
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
    pub fn agent_random_source(&self) -> &dyn RandomSource {
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
    pub fn seed_session_clock_floor(&self, floor_ms: u64) {
        self.session_clock_floor_ms
            .fetch_max(floor_ms, Ordering::AcqRel);
    }

    pub fn monotonic_now(&self) -> Instant {
        self.clock.monotonic_now()
    }

    /// Authenticate one already-durably-reserved invalidation boot issuer
    /// while the active protocol key remains under the keyring lock.
    ///
    /// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — listener
    /// bind is refused unless the reserved issuer can be authenticated with a
    /// stable protocol key.
    pub fn authenticate_invalidation_boot_issuer(
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
    pub fn issue_authorized_lease_at(
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
    pub fn verify_authorized_lease_at(
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

    /// Serialize identical guest-entry idempotency identities before the
    /// durable pending/committed/refused transaction. Hash collisions only
    /// reduce concurrency; durable digests still decide request equality.
    pub async fn guest_entry_idempotency_guard(
        &self,
        idempotency_key: &str,
    ) -> OwnedMutexGuard<()> {
        let mut hasher = self.address_hasher.build_hasher();
        hasher.write(b"guest-entry\0");
        hasher.write(idempotency_key.as_bytes());
        let index = (hasher.finish() as usize) & (AUTH_ADDRESS_STRIPES - 1);
        self.address_stripes[index].clone().lock_owned().await
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
    pub fn plan_guest_session_plan(
        &self,
        now_ms: u64,
        guest_retention_ms: u64,
        effect_budget: snapback_kernel::auth::throttle::RollingWindowBudgetTerms,
        idempotency_key: &str,
        app_id: &str,
        deployment_id: &str,
        policy_digest: &str,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<ProviderGuestSessionPlan>,
    > + '_ {
        let idempotency_key = idempotency_key.to_owned();
        let app_id = app_id.to_owned();
        let deployment_id = deployment_id.to_owned();
        let policy_digest = policy_digest.to_owned();
        super::database_plan::plan(move |database| {
            self.provider.plan_guest_session(
                database,
                now_ms,
                guest_retention_ms,
                effect_budget,
                &idempotency_key,
                &app_id,
                &deployment_id,
                &policy_digest,
                custody,
            )
        })
    }

    pub fn commit_guest_issuance_plan<'a>(
        &'a self,
        plan: &'a ProviderGuestSessionIssuanceCommitPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedIssuanceCommit>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider.commit_guest_issuance(database, plan)
        })
    }

    pub fn prepare_guest_claim_password_plan<'a>(
        &'a self,
        guest: &'a SessionBearer,
        identifier: &'a str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<GuestClaimPasswordPreparation>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider
                .prepare_guest_claim_password(database, guest, identifier, now_ms, custody)
        })
    }

    pub fn prepare_password_change_plan<'a>(
        &'a self,
        acting: &'a SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<PasswordChangePreparation>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider
                .prepare_password_change(database, acting, now_ms, custody)
        })
    }

    pub fn plan_password_recovery_rotate_plan<'a>(
        &'a self,
        acting: &'a SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<ProviderSessionIssuancePlan>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider
                .plan_password_recovery_rotate_with_active_key(database, acting, now_ms, custody)
        })
    }

    pub fn commit_password_issuance_plan<'a>(
        &'a self,
        plan: &'a ProviderSessionIssuanceCommitPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedIssuanceCommit>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider.commit_password_issuance(database, plan)
        })
    }

    pub fn commit_password_change_plan<'a>(
        &'a self,
        plan: &'a ProviderPasswordChangeCommitPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedPasswordChangeCommit>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider.commit_password_change(database, plan)
        })
    }

    pub fn step_up_address_plan<'a>(
        &'a self,
        binding: &'a StepUpBinding,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<CanonicalAddress>> + 'a
    {
        super::database_plan::plan(move |database| self.step_up_address(database, binding, now_ms))
    }

    pub fn step_up_coordination_plan<'a>(
        &'a self,
        challenge_id: &'a str,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<StepUpCoordination>> + 'a
    {
        super::database_plan::plan(move |database| {
            self.step_up_coordination(database, challenge_id)
        })
    }

    pub fn exchange_coordination_plan<'a>(
        &'a self,
        challenge_id: &'a str,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = ProviderResult<Option<ExchangeCoordination>>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.exchange_coordination(database, challenge_id)
        })
    }

    pub fn exchange_unknown_plan<'a>(
        &'a self,
        challenge_id: &'a str,
        code: &'a str,
        now_ms: u64,
        sender_issuance: Option<&'a crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<CredentialIssue>> + 'a
    {
        super::database_plan::plan(move |database| {
            self.exchange_unknown(database, challenge_id, code, now_ms, sender_issuance)
        })
    }

    pub fn resolve_session_plan<'a>(
        &'a self,
        bearer: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<ResolvedSession>> + 'a
    {
        super::database_plan::plan(move |database| self.resolve_session(database, bearer, now_ms))
    }

    pub fn plan_logout_plan<'a>(
        &'a self,
        bearer: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<PlannedLogout>> + 'a
    {
        super::database_plan::plan(move |database| self.plan_logout(database, bearer, now_ms))
    }

    pub fn plan_refresh_plan<'a>(
        &'a self,
        bearer: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<PlannedRefresh>> + 'a
    {
        super::database_plan::plan(move |database| self.plan_refresh(database, bearer, now_ms))
    }

    pub fn plan_family_alarm_plan<'a>(
        &'a self,
        bearer: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<ProviderFamilyAlarmPlan>> + 'a
    {
        super::database_plan::plan(move |database| self.plan_family_alarm(database, bearer, now_ms))
    }

    pub fn commit_planned_family_alarm_plan<'a>(
        &'a self,
        plan: &'a ProviderFamilyAlarmPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedFamilyAlarmCommit>,
    > + 'a {
        super::database_plan::plan(move |database| self.commit_planned_family_alarm(database, plan))
    }

    pub fn commit_planned_revocation_plan<'a>(
        &'a self,
        plan: &'a ProviderRevocationPlan,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedRevocationCommit>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.commit_planned_revocation(database, plan, now_ms)
        })
    }

    pub fn commit_planned_rotation_plan<'a>(
        &'a self,
        plan: &'a ProviderTokenRotationCommitPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedRotationCommit>,
    > + 'a {
        super::database_plan::plan(move |database| self.commit_planned_rotation(database, plan))
    }

    /// Resolve the human delivery address from the exact still-live session.
    /// The caller keeps this maintenance admission while acquiring the
    /// resulting address stripe, preserving the provider lock order.
    pub fn step_up_address(
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
    pub fn step_up_coordination(
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

    pub async fn for_step_up(
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
    pub fn exchange_unknown(
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
    pub fn plan_logout(
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

    pub fn plan_refresh(
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

    pub fn plan_family_alarm(
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

    pub fn commit_planned_family_alarm(
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
    pub fn commit_planned_revocation(
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

    pub fn commit_planned_rotation(
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
    #[cfg(any(test, feature = "test-support"))]
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
    #[cfg(any(test, feature = "test-support"))]
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
    #[cfg(any(test, feature = "test-support"))]
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
    pub fn plan_exchange_plan<'a>(
        &'a self,
        code: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<PlannedExchange>> + 'a
    {
        super::database_plan::plan(move |database| self.plan_exchange(database, code, now_ms))
    }

    pub fn prepare_password_reset_plan<'a>(
        &'a self,
        code: &'a str,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = ProviderResult<PasswordResetPreparation>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.prepare_password_reset(database, code, now_ms)
        })
    }

    pub fn commit_planned_issuance_plan<'a>(
        &'a self,
        plan: &'a ProviderSessionIssuanceCommitPlan,
        code: &'a str,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedIssuanceCommit>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.commit_planned_issuance(database, plan, code)
        })
    }

    pub fn commit_planned_rejection_plan<'a>(
        &'a self,
        code: &'a str,
        now_ms: u64,
        sender_issuance: Option<&'a crate::auth::sender_proof::SenderIssuanceCommitment>,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<RejectedExchangeCommit>> + 'a
    {
        super::database_plan::plan(move |database| {
            self.commit_planned_rejection(database, code, now_ms, sender_issuance)
        })
    }

    /// Immutable lock-selection facts that may cross the projection Begin
    /// boundary. The guard-bearing admission itself must be dropped first and
    /// reacquired from these facts for the later exact durable CAS.
    pub fn reacquisition_key(&self) -> ExchangeCoordination {
        self.coordination.clone()
    }

    pub fn plan_exchange(
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

    pub fn prepare_password_reset(
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

    pub fn commit_planned_issuance(
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
                attempt_planned_session_issuance(database, plan, Some((key, &code)), None)
            })
            .unwrap_or_else(|_| {
                AuthTransactionAttempt::RolledBack(provider_unavailable().into_snapback_error())
            })
    }

    /// Recheck a read-planned rejection under `BEGIN IMMEDIATE` without any
    /// code path that can create a session. If the predecessor became a live,
    /// correct challenge, the caller replans and enters coordinated issuance.
    pub fn commit_planned_rejection(
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

    pub fn finish_exchange_cleanup(&self) {
        self.admission
            .provider
            .mailbox
            .erase(&self.coordination.challenge_id);
    }

    /// Exchange a known preliminary row. Key material is selected before the
    /// writer and retained through the transaction; all preliminary facts are
    /// then rechecked under `BEGIN IMMEDIATE`.
    #[cfg(any(test, feature = "test-support"))]
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
    pub fn prepare_guest_claim_password_plan<'a>(
        &'a self,
        guest: &'a SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<GuestClaimPasswordPreparation>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider().prepare_guest_claim_password(
                database,
                guest,
                self.address.as_str(),
                now_ms,
                custody,
            )
        })
    }

    pub fn prepare_password_registration_plan(
        &self,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<PasswordRegistrationPreparation>,
    > + '_ {
        super::database_plan::plan(move |database| {
            self.provider()
                .prepare_password_registration(database, self.address.as_str(), custody)
        })
    }

    pub fn prepare_password_authentication_plan(
        &self,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<PasswordAuthenticationPreparation>,
    > + '_ {
        super::database_plan::plan(move |database| {
            self.provider().prepare_password_authentication(
                database,
                self.address.as_str(),
                now_ms,
                custody,
            )
        })
    }

    pub fn plan_password_recovery_consume_plan<'a>(
        &'a self,
        code: &'a str,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<ProviderSessionIssuancePlan>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.provider()
                .plan_password_recovery_consume_with_active_key(
                    database,
                    self.address.as_str(),
                    code,
                    now_ms,
                    custody,
                )
        })
    }

    pub fn prepare_password_change_plan<'a>(
        &'a self,
        acting: &'a SessionBearer,
        now_ms: u64,
        custody: PasswordIssuanceCustody,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = SnapbackResult<PasswordChangePreparation>,
    > + 'a {
        super::database_plan::plan(move |database| {
            self.prepare_password_change(database, acting, now_ms, custody)
        })
    }

    pub fn request_step_up_plan<'a>(
        &'a self,
        binding: &'a StepUpBinding,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<RequestCodeResponse>> + 'a
    {
        super::database_plan::plan(move |database| self.request_step_up(database, binding))
    }

    pub fn request_code_plan(
        &self,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<RequestCodeResponse>> + '_
    {
        super::database_plan::plan(move |database| self.request_code(database, now_ms))
    }

    pub fn request_code_for_rehearsal_window_plan<'a>(
        &'a self,
        now_ms: u64,
        window: &'a crate::auth::rehearsal::AuthRehearsalWindowV1,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<RequestCodeResponse>> + 'a
    {
        super::database_plan::plan(move |database| {
            self.request_code_for_rehearsal_window(database, now_ms, window)
        })
    }

    pub fn plan_mint_session_plan(
        &self,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = ProviderResult<ProviderSessionIssuancePlan>,
    > + '_ {
        super::database_plan::plan(move |database| self.plan_mint_session(database, now_ms))
    }

    pub fn commit_planned_issuance_plan<'a>(
        &'a self,
        plan: &'a ProviderSessionIssuanceCommitPlan,
    ) -> impl super::database_plan::AuthDatabasePlan<
        Output = AuthTransactionAttempt<PlannedIssuanceCommit>,
    > + 'a {
        super::database_plan::plan(move |database| self.commit_planned_issuance(database, plan))
    }

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
    pub fn prepare_password_change(
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
    pub fn request_step_up(
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
    pub fn request_code_for_rehearsal_window(
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
    pub fn plan_mint_session(
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

    pub fn commit_planned_issuance(
        &self,
        database: &mut LocalDatabase,
        plan: &ProviderSessionIssuanceCommitPlan,
    ) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
        attempt_planned_session_issuance(database, plan, None, None)
    }

    /// Reusable host-operation core. Item 4 owns the AdminWrite and
    /// ImpersonationCapability gates; this method owns the identical durable
    /// provisioning, cap, and session issuance semantics used by exchange.
    #[cfg(any(test, feature = "test-support"))]
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
    /// Seal one maintenance pass for execution by the engine that owns the
    /// target database.
    pub fn gc_plan(
        self,
        now_ms: u64,
    ) -> impl super::database_plan::AuthDatabasePlan<Output = ProviderResult<AuthGcPass>> {
        super::database_plan::plan(move |database| self.run_gc_pass(database, now_ms))
    }

    pub fn keyring(&self) -> &AuthKeyringStore {
        &self.provider.keyring
    }

    /// Prepare the only fallible external half of first catalog activation.
    /// The staged-mode consume transaction installs the SQLite catalog marker;
    /// publishing a usable keyring first preserves LLP 0057's one-way ordering
    /// without creating a second provider or escaping this maintenance guard.
    // @ref LLP 0057#activation-ordering — usable key material precedes the catalog marker and is never reminted for a marked catalog.
    pub fn prepare_catalog_activation(&self) -> SnapbackResult<()> {
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
            guests_reaped: lifecycle.guests_reaped,
            mailbox_entries_pruned: lifecycle.mailbox_entries_deleted,
            retired_keys_pruned,
            immediate_retry: lifecycle.immediate_retry,
        })
    }
}

impl SessionCandidate {
    fn generate(provider: &AuthProvider, now_ms: u64) -> ProviderResult<Self> {
        Self::generate_with_random(provider.random.as_ref(), now_ms)
    }

    fn generate_with_random(random: &dyn RandomSource, now_ms: u64) -> ProviderResult<Self> {
        use crate::ids::Kind;
        let user_id = mint_random_catalog_id(Kind::User, random)?;
        let identity_id = mint_catalog_id(Kind::Identity, random, now_ms)?;
        let session_id = mint_catalog_id(Kind::Session, random, now_ms)?;
        let authority_instance_id = mint_catalog_id(Kind::AuthorityInstance, random, now_ms)?;
        let bearer = SessionBearer::generate(random).map_err(|_| provider_unavailable())?;
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
        PlannedIdentityState::GuestCreate { .. } => return Err(internal_state_snapback()),
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
        CatalogPasswordChangeCommit::GuestClaimCollision => {
            PlannedPasswordChangeCommit::GuestClaimCollision
        }
        CatalogPasswordChangeCommit::GuestAlreadyClaimed => {
            PlannedPasswordChangeCommit::GuestAlreadyClaimed
        }
        CatalogPasswordChangeCommit::GuestBudgetRefused {
            budget_name,
            retry_after_ms,
        } => PlannedPasswordChangeCommit::GuestBudgetRefused {
            budget_name,
            retry_after_ms,
        },
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
        | PlannedPasswordChangeCommit::CredentialThrottled
        | PlannedPasswordChangeCommit::GuestClaimCollision
        | PlannedPasswordChangeCommit::GuestAlreadyClaimed
        | PlannedPasswordChangeCommit::GuestBudgetRefused { .. } => {
            AuthTransactionAttempt::Committed(PlannedPasswordChangeCommit::PredecessorChanged)
        }
        PlannedPasswordChangeCommit::CredentialInvalid { committed_attempt } => {
            let canonical_identifier = match &plan.mutation {
                crate::storage::auth_identity::CredentialRotationMutation::PasswordChange(
                    mutation,
                ) => &mutation.canonical_identifier,
                crate::storage::auth_identity::CredentialRotationMutation::GuestClaim(mutation) => {
                    &mutation.canonical_identifier
                }
            };
            let committed = committed_attempt.as_ref().is_none_or(|expected| {
                database
                    .password_attempt_matches(canonical_identifier, expected)
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
    guest: Option<&ProviderGuestIssuanceState>,
) -> AuthTransactionAttempt<PlannedIssuanceCommit> {
    let mut catalog_plan = plan.catalog_plan();
    if let Some(guest) = guest {
        catalog_plan.guest_effect_budget = Some(guest.effect_budget);
        catalog_plan.guest_idempotency = Some(&guest.idempotency);
    }
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
        PlannedIssuanceCommit::GuestIdempotencyConflict => {
            AuthTransactionAttempt::Committed(PlannedIssuanceCommit::GuestIdempotencyConflict)
        }
        refused @ PlannedIssuanceCommit::GuestBudgetRefused { .. } => {
            let Some(idempotency) = guest.map(|guest| &guest.idempotency) else {
                return AuthTransactionAttempt::Committed(
                    PlannedIssuanceCommit::PredecessorChanged,
                );
            };
            match database.guest_entry_idempotency_lookup(
                &idempotency.key_digest,
                &idempotency.request_digest,
                plan.now_ms,
            ) {
                Ok(GuestEntryIdempotencyLookup::Refused { .. }) => {
                    AuthTransactionAttempt::Committed(refused)
                }
                Ok(GuestEntryIdempotencyLookup::Pending { .. })
                | Ok(GuestEntryIdempotencyLookup::Missing) => {
                    AuthTransactionAttempt::RolledBack(commit_error)
                }
                Ok(_) => {
                    AuthTransactionAttempt::Committed(PlannedIssuanceCommit::PredecessorChanged)
                }
                Err(_) => AuthTransactionAttempt::CommitUncertain(commit_error),
            }
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
        CatalogIssuanceCommit::GuestBudgetRefused {
            budget_name,
            retry_after_ms,
            correlation_id,
        } => PlannedIssuanceCommit::GuestBudgetRefused {
            budget_name,
            retry_after_ms,
            correlation_id,
        },
        CatalogIssuanceCommit::GuestIdempotencyConflict => {
            PlannedIssuanceCommit::GuestIdempotencyConflict
        }
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

pub fn fill_random_or_unavailable(
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

pub fn code_invalid() -> ProviderError {
    ProviderError::new(super::throttle::code_invalid())
}

/// The one public credential refusal for absent, wrong, stale, and locked
/// password predecessors. Routes must not attach lock or account-existence
/// detail to this diagnostic.
pub fn credential_invalid() -> ProviderError {
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
pub fn sender_key_bound() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
        "auth",
        "sender proof is not valid for issuance",
    ))
}

pub fn code_locked() -> ProviderError {
    ProviderError::new(super::throttle::code_locked())
}

pub fn auth_required() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_REQUIRED",
        "auth",
        "authentication is required",
    ))
}

pub fn session_expired() -> ProviderError {
    session_expired_with_disposition("carrier")
}

pub fn session_revoked() -> ProviderError {
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

pub fn credential_superseded() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "auth",
        "authentication credential has been superseded",
    ))
}

pub fn refresh_superseded() -> ProviderError {
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
