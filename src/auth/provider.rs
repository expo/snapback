//! Durable email-code provider and session-family core.
//!
//! The HTTP and host-operation projections intentionally live elsewhere. This
//! module owns provider state transitions plus the process-local coordination
//! that must be acquired before the outer app-instance/database lock.
//!
//! @ref LLP 0054#email-code-provider — request, exchange, provisioning, and
//! session issuance are one non-enumerating provider state machine.
//! @ref LLP 0054#concurrency-locks-and-linearization — maintenance, address,
//! keyring, and SQLite locks are acquired in that order.
//! @ref LLP 0054#security-and-redaction — provider secrets never enter Debug,
//! diagnostics, the app journal, or generic serializable state.

use std::collections::hash_map::RandomState;
use std::fmt;
use std::hash::{BuildHasher, Hasher as _};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension as _, Transaction, params};
use tokio::sync::{
    Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard,
    RwLock as AsyncRwLock,
};
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, OsRandom, RandomSource,
    SessionBearer, TokenHash, VerificationCode,
};
use super::keyring::{AuthKeyringStore, KeyringError};
use super::mailbox::{CaptureMailbox, CaptureMailboxEntry};
use super::wire::{
    CredentialResponse, FamilyAlarmResponse, MailboxResponse, RequestCodeResponse, SessionResponse,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::LocalDatabase;

pub const AUTH_ADDRESS_STRIPES: usize = 256;
pub const AUTH_MAX_COLLISION_ATTEMPTS: usize = 3;
pub const AUTH_CHALLENGE_TTL_MS: u64 = 10 * 60 * 1_000;
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

impl AuthProviderProfile {
    fn permits_capture(self) -> bool {
        matches!(self, Self::Dev | Self::Test | Self::Demo)
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
pub struct ExchangeCoordination {
    challenge_id: ChallengeId,
    address: CanonicalAddress,
    key_id: AuthKeyId,
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

#[derive(Debug)]
enum ExchangeOutcome {
    Invalid,
    Locked,
    Issued {
        session: SessionResponse,
        committed_revocation: Option<SessionRevocation>,
    },
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

#[derive(Debug)]
enum RefreshOutcome {
    AuthRequired,
    SessionExpired,
    SupersededInsideGrace,
    ReuseRevoked(SessionRevocation),
    Refreshed(SessionResponse),
}

#[derive(Debug)]
enum LogoutOutcome {
    AuthRequired,
    SessionExpired,
    CredentialSuperseded,
    Revoked(SessionRevocation),
}

pub struct AuthProvider {
    profile: AuthProviderProfile,
    keyring: Arc<AuthKeyringStore>,
    mailbox: CaptureMailbox,
    random: Arc<dyn RandomSource>,
    clock: Arc<dyn AuthClock>,
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

    pub fn now_ms(&self) -> u64 {
        self.clock.epoch_ms()
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
    pub fn exchange_unknown(
        &self,
        database: &mut LocalDatabase,
        challenge_id: &str,
        code: &str,
        now_ms: u64,
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
        let bearer = SessionBearer::parse(bearer).map_err(|_| auth_required())?;
        let token_hash = bearer.token_hash();
        let lookup = database
            .with_auth_read(|connection| lookup_presented_session(connection, &token_hash))
            .map_err(|_| provider_unavailable())?;
        resolve_ordinary_lookup(lookup, now_ms)
    }

    /// Rotate a current bearer, or apply the exact predecessor-reuse matrix.
    /// A reuse revocation is returned inside `ProviderError` because its
    /// `SESSION_EXPIRED` response follows a committed family mutation.
    pub fn refresh(
        &self,
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<CredentialIssue> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse(bearer).map_err(|_| auth_required())?;
        let predecessor_hash = bearer.token_hash();
        for _ in 0..AUTH_MAX_COLLISION_ATTEMPTS {
            let mut successor = BearerCandidate::generate(&self.provider)?;
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
                        session_expired().into_snapback_error(),
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
    pub fn logout(
        &self,
        database: &mut LocalDatabase,
        bearer: &str,
        now_ms: u64,
    ) -> ProviderResult<SessionRevocation> {
        validate_now(now_ms)?;
        let bearer = SessionBearer::parse(bearer).map_err(|_| auth_required())?;
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
        let parsed = SessionBearer::parse(bearer).ok();
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
    /// Exchange a known preliminary row. Key material is selected before the
    /// writer and retained through the transaction; all preliminary facts are
    /// then rechecked under `BEGIN IMMEDIATE`.
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
                if address_count >= AUTH_ADDRESS_REQUEST_LIMIT as i64 {
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

    /// Reusable host-operation core. Item 4 owns the AdminWrite and
    /// ImpersonationCapability gates; this method owns the identical durable
    /// provisioning, cap, and session issuance semantics used by exchange.
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
        let durable = database
            .auth_gc(now_ms)
            .map_err(|_| provider_unavailable())?;
        let mailbox_entries_pruned = self.provider.mailbox.prune_expired();
        let retired_keys_pruned = self
            .provider
            .keyring
            .prune_retired(now_ms, self.provider.random.as_ref(), |key_id| {
                database
                    .with_auth_read(|connection| {
                        connection
                            .query_row(
                                "SELECT EXISTS(
                                       SELECT 1 FROM _auth_verification_codes WHERE key_id = ?1
                                     )",
                                params![key_id.as_str()],
                                |row| row.get::<_, bool>(0),
                            )
                            .map_err(SnapbackError::from)
                    })
                    .map_err(|_| KeyringError::Unavailable)
            })
            .map_err(|_| provider_unavailable())?;
        Ok(AuthGcPass {
            challenges_deleted: durable.challenges_deleted,
            sessions_deleted: durable.sessions_deleted,
            mailbox_entries_pruned,
            retired_keys_pruned,
            immediate_retry: durable.immediate_retry,
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
    let generation = u64::try_from(raw.generation).map_err(|_| internal_state_snapback())?;
    let created_at_ms = checked_stored_time(raw.created_at_ms)?;
    let last_used_at_ms = checked_stored_time(raw.last_used_at_ms)?;
    let expires_at_ms = checked_stored_time(raw.expires_at_ms)?;
    let absolute_expires_at_ms = checked_stored_time(raw.absolute_expires_at_ms)?;
    let revoked_at_ms = raw.revoked_at_ms.map(checked_stored_time).transpose()?;
    if generation == 0
        || created_at_ms > last_used_at_ms
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
    let revocation = revoke_live_session(transaction, &session, now_ms)?;
    Ok(RefreshOutcome::ReuseRevoked(revocation))
}

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
                revoke_live_session(transaction, &session, now_ms).map(LogoutOutcome::Revoked)
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
                revoke_live_session(transaction, &session, now_ms).map(LogoutOutcome::Revoked)
            }
        }
    }
}

fn revoke_live_session(
    transaction: &Transaction<'_>,
    session: &SessionRecord,
    now_ms: u64,
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
    Ok(SessionRevocation {
        session_id: session.session.session_id.clone(),
        generation,
    })
}

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
    revoked
        .map(|(session_id, generation)| {
            let generation = u64::try_from(generation).map_err(|_| internal_state_snapback())?;
            if generation < 2 {
                return Err(internal_state_snapback());
            }
            Ok(SessionRevocation {
                session_id,
                generation,
            })
        })
        .transpose()
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
        let generation = u64::try_from(generation).map_err(|_| internal_state_snapback())?;
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
        },
        committed_revocation,
    })
}

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
        },
        committed_revocation,
    ))
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
        .ok_or_else(internal_state_snapback)?;
    let changed = transaction.execute(
        "UPDATE _auth_sessions SET revoked_at_ms = ?1, generation = ?2
         WHERE id = ?3 AND revoked_at_ms IS NULL AND ?1 < expires_at_ms",
        params![now_ms as i64, generation as i64, session_id],
    )?;
    if changed != 1 {
        return Err(internal_state_snapback());
    }
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

fn code_invalid() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CODE_INVALID",
        "auth",
        "verification code is invalid",
    ))
}

fn code_locked() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CODE_LOCKED",
        "auth",
        "verification code attempt budget is exhausted",
    ))
}

fn auth_required() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_REQUIRED",
        "auth",
        "authentication is required",
    ))
}

fn session_expired() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_SESSION_EXPIRED",
        "auth",
        "authentication session is expired",
    ))
}

fn credential_superseded() -> ProviderError {
    ProviderError::new(SnapbackError::error(
        "SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED",
        "auth",
        "authentication credential has been superseded",
    ))
}

fn refresh_superseded() -> ProviderError {
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

    fn provider_database(now_ms: u64) -> (Arc<AuthProvider>, LocalDatabase) {
        let mut database = LocalDatabase::memory().expect("memory database");
        let keyring = Arc::new(AuthKeyringStore::in_memory());
        keyring
            .load_or_mint_initial(now_ms, &OsRandom)
            .expect("initial keyring");
        database
            .activate_auth_catalog_v1()
            .expect("activate catalog");
        let provider =
            Arc::new(AuthProvider::new(AuthProviderProfile::Test, keyring).expect("auth provider"));
        (provider, database)
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
            .activate_auth_catalog_v1()
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
            .exchange_unknown(&mut database, unknown_id.as_str(), "123456", now_ms + 2)
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
            .activate_auth_catalog_v1()
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
}
