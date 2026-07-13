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

use rusqlite::{OptionalExtension as _, Transaction, params};
use tokio::sync::{
    Mutex as AsyncMutex, OwnedMutexGuard, OwnedRwLockReadGuard, OwnedRwLockWriteGuard,
    RwLock as AsyncRwLock,
};
use zeroize::{Zeroize as _, Zeroizing};

use super::crypto::{
    AuthKeyId, AuthKeyMaterial, CanonicalAddress, ChallengeId, CodeDigest, OsRandom, RandomSource,
    SessionBearer, TokenHash, VerificationCode,
};
use super::keyring::AuthKeyringStore;
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
const INTERNAL_AUTH_COLLISION: &str = "SNAPBACK_INTERNAL_AUTH_COLLISION";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthProviderProfile {
    Dev,
    Test,
    Demo,
    Prod,
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

pub struct AuthProvider {
    profile: AuthProviderProfile,
    keyring: Arc<AuthKeyringStore>,
    mailbox: CaptureMailbox,
    random: Arc<dyn RandomSource>,
    clock: Arc<dyn AuthClock>,
    dummy_key: AuthKeyMaterial,
    dummy_address: CanonicalAddress,
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
            let reservation = self
                .provider()
                .mailbox
                .reserve(entry)
                .map_err(ProviderError::from)?;

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
    random
        .fill(&mut random_bytes)
        .map_err(|_| provider_unavailable())?;
    let id = uuid::Builder::from_unix_timestamp_millis(now_ms, &random_bytes)
        .into_uuid()
        .hyphenated()
        .to_string();
    random_bytes.zeroize();
    Ok(id)
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
        "SNAPBACK_INTERNAL_AUTH_STATE",
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

fn _minimum_alarm_deadline(started_at: Instant, jitter_ms: u64) -> Instant {
    started_at + Duration::from_millis(AUTH_FAMILY_ALARM_MINIMUM_MS.saturating_add(jitter_ms))
}

fn _snapback<T>(result: SnapbackResult<T>) -> ProviderResult<T> {
    result.map_err(ProviderError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

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
    async fn twenty_first_live_session_revokes_deterministic_oldest_in_same_commit() {
        let start_ms = 1_700_000_000_000;
        let (provider, mut database) = provider_database(start_ms);
        let mut first_session_id = None;
        let mut final_revocation = None;

        for index in 0..=AUTH_SESSION_LIVE_LIMIT {
            let now_ms = start_ms + index as u64 * AUTH_ADDRESS_REQUEST_WINDOW_MS;
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
        assert_eq!(direct_stream_facts(&database), (0, 0));
    }
}
