//! Protected catalog-v3/v4 guest/password/recovery transition floor.

use super::LocalDatabase;
use super::auth::PasswordIdentifierMode;
use crate::auth::crypto::{
    CanonicalAddress, RandomSource, SessionBearer, StepUpConsumption,
};
use crate::auth::identity_core::{
    AssuranceKind, AssuranceProvenance, AssuranceRecord, AuthClaimsProjection, ClaimsIdentity,
    PasswordSecret, RecoveryCodes,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac as _};
use rusqlite::{OptionalExtension, Transaction, params};
use sha2::Sha256;
use std::collections::BTreeSet;
use std::fmt;
use subtle::ConstantTimeEq as _;
use unicode_normalization::UnicodeNormalization as _;
use uuid::Uuid;

const SESSION_IDLE_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const SESSION_ABSOLUTE_MS: u64 = 90 * 24 * 60 * 60 * 1_000;
const RECOVERY_COUNT: usize = 8;
const COMMON_PASSWORD_LIST_VERSION: u64 = 1;
const COMMON_PASSWORDS: &[&str] = &[
    "123456789012",
    "correcthorsebatterystaple",
    "iloveyou12345",
    "letmein123456",
    "password1234",
    "qwertyuiop12",
];
const RECOVERY_DOMAIN: &[u8] = b"snapback.auth.recovery-code.v1";
const DUMMY_PASSWORD_PHC: &str = "$argon2id$v=19$m=19456,t=2,p=1$HyAhIiMkJSYnKCkqKywtLg$Kwc47BIKhIV7UTbl8eAZf0EL/mFlTXkkO6rPuplXNLc";

pub(crate) const fn dummy_password_phc() -> &'static str {
    DUMMY_PASSWORD_PHC
}

/// Versioned policy authority for newly stored password hashes. PHC strings
/// describe individual stored hashes but never choose the active policy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PasswordHashPolicy {
    version: u64,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt_bytes: usize,
    tag_bytes: usize,
    common_password_list_version: u64,
}

const PASSWORD_HASH_POLICY_V1: PasswordHashPolicy = PasswordHashPolicy {
    version: 1,
    memory_kib: 19_456,
    iterations: 2,
    parallelism: 1,
    salt_bytes: 16,
    tag_bytes: 32,
    common_password_list_version: COMMON_PASSWORD_LIST_VERSION,
};

/// Every password security threshold is selected from sealed server profile
/// state. Non-production profiles deliberately retain generous *finite*
/// resource bounds so conformance and benchmark suites can exercise the
/// ten-attempt lock boundary without tripping an unrelated budget first.
///
/// @ref LLP 0227#lockout-and-rate-posture-a-declared-testable-contract —
///   lockout, ledger custody, and KDF occupancy are declared profile terms.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PasswordSecurityProfile {
    pub(crate) minimum_password_length: usize,
    pub(crate) failure_threshold: u64,
    pub(crate) failure_window_ms: u64,
    pub(crate) lock_duration_ms: u64,
    pub(crate) ledger_max_rows: u64,
    pub(crate) kdf_concurrency: usize,
    pub(crate) verification_floor_ms: u64,
}

impl PasswordSecurityProfile {
    pub(crate) const fn for_provider(profile: crate::contract_types::AuthProviderProfile) -> Self {
        use crate::contract_types::AuthProviderProfile;
        match profile {
            AuthProviderProfile::Dev | AuthProviderProfile::Test => Self {
                minimum_password_length: crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT
                    as usize,
                failure_threshold: 10,
                failure_window_ms: 15 * 60 * 1_000,
                lock_duration_ms: 15 * 60 * 1_000,
                ledger_max_rows: 100_000,
                kdf_concurrency: 8,
                // Debug-build Argon2 under the parallel acceptance runner can
                // exceed 900ms. Keep all invalid classes inside one padded
                // envelope instead of making test-host contention an oracle.
                verification_floor_ms: 1_250,
            },
            AuthProviderProfile::Demo => Self {
                minimum_password_length: crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT
                    as usize,
                failure_threshold: 10,
                failure_window_ms: 15 * 60 * 1_000,
                lock_duration_ms: 15 * 60 * 1_000,
                ledger_max_rows: 50_000,
                kdf_concurrency: 4,
                verification_floor_ms: 350,
            },
            AuthProviderProfile::Prod => Self {
                minimum_password_length: crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT
                    as usize,
                failure_threshold: 10,
                failure_window_ms: 15 * 60 * 1_000,
                lock_duration_ms: 15 * 60 * 1_000,
                ledger_max_rows: 100_000,
                kdf_concurrency: 4,
                verification_floor_ms: 500,
            },
        }
    }

    pub(crate) fn with_minimum_password_length(mut self, minimum: u16) -> SnapbackResult<Self> {
        if !(crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR
            ..=crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_CEILING)
            .contains(&minimum)
        {
            return Err(auth_error(
                "SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID",
                "password minimumLength must be from 8 through 128",
            ));
        }
        self.minimum_password_length = usize::from(minimum);
        Ok(self)
    }
}

/// A PHC value may enter a writer plan only after the bounded KDF pool has
/// completed. Its ordinary Debug representation is permanently redacted.
#[derive(Clone, Eq, PartialEq)]
pub(crate) struct PreparedPasswordHash {
    phc: String,
    algorithm: &'static str,
}

impl fmt::Debug for PreparedPasswordHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PreparedPasswordHash([REDACTED])")
    }
}

impl PreparedPasswordHash {
    pub(crate) fn phc(&self) -> &str {
        &self.phc
    }

    pub(crate) const fn algorithm(&self) -> &'static str {
        self.algorithm
    }
}

/// Result of one real-or-dummy verification performed on the bounded blocking
/// pool. A replacement is computed in the same blocking job, while plaintext
/// is still in its zeroizing owner, and can only be installed by generation
/// CAS in the later writer transaction.
pub(crate) struct PreparedPasswordVerification {
    pub(crate) verified: bool,
    pub(crate) replacement: Option<PreparedPasswordHash>,
}

impl fmt::Debug for PreparedPasswordVerification {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedPasswordVerification")
            .field("verified", &self.verified)
            .field(
                "replacement",
                &self.replacement.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

impl PasswordHashPolicy {
    fn argon2(self) -> Argon2<'static> {
        let params = Params::new(
            self.memory_kib,
            self.iterations,
            self.parallelism,
            Some(self.tag_bytes),
        )
        .expect("ratified password hash policy is a valid Argon2 parameter set");
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
    }

    /// Upgrade-on-verify plugs in here: after a successful verification, a
    /// false result causes a replacement PHC to be prepared outside the writer
    /// lock and swapped under the credential-generation compare-and-swap.
    fn matches_phc(self, hash: &PasswordHash) -> bool {
        let Ok(params) = Params::try_from(hash) else {
            return false;
        };
        hash.algorithm.as_str() == "argon2id"
            && hash.version == Some(19)
            && params.m_cost() == self.memory_kib
            && params.t_cost() == self.iterations
            && params.p_cost() == self.parallelism
            && params.output_len() == Some(self.tag_bytes)
            && hash
                .salt
                .as_ref()
                .is_some_and(|salt| salt.len() == self.salt_bytes)
            && hash
                .hash
                .as_ref()
                .is_some_and(|tag| tag.len() == self.tag_bytes)
    }
}

#[derive(Debug)]
pub(crate) struct IdentitySession {
    pub user_id: String,
    pub session_id: String,
    pub bearer: SessionBearer,
    pub recovery_codes: Option<RecoveryCodes>,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct PasswordSnapshot {
    pub(crate) user_id: String,
    pub(crate) identity_id: String,
    pub(crate) credential_id: String,
    pub(crate) generation: u64,
    pub(crate) hash_phc: String,
    pub(crate) identifier_mode: PasswordIdentifierMode,
}

impl fmt::Debug for PasswordSnapshot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordSnapshot")
            .field("user_id", &self.user_id)
            .field("identity_id", &self.identity_id)
            .field("credential_id", &self.credential_id)
            .field("generation", &self.generation)
            .field("hash_phc", &"[REDACTED]")
            .field("identifier_mode", &self.identifier_mode)
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordAttemptState {
    pub(crate) window_start_ms: u64,
    pub(crate) failed_count: u64,
    pub(crate) locked_until_ms: Option<u64>,
}

/// Internal-only view of the account-existence-blind password-attempt ledger.
/// A route may expose this value only after the admin authentication gate; no
/// password endpoint is allowed to serialize it or vary its refusal by it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordAttemptAdminProjection {
    pub(crate) canonical_identifier: String,
    pub(crate) window_start_ms: u64,
    pub(crate) failed_count: u64,
    pub(crate) locked_until_ms: Option<u64>,
    pub(crate) locked: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordAuthenticationPredecessor {
    pub(crate) credential: Option<PasswordSnapshot>,
    pub(crate) ledger: Option<PasswordAttemptState>,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct PreparedRecoverySet {
    key_id: String,
    digests: Vec<[u8; 32]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordSetPredecessor {
    pub(crate) acting_session_id: String,
    pub(crate) acting_user_id: String,
    pub(crate) acting_generation: u64,
    pub(crate) acting_token_digest: crate::contract_types::TokenDigest,
    pub(crate) email_identity_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DisplacedPasswordPredecessor {
    pub(crate) identity_id: String,
    pub(crate) user_id: String,
    pub(crate) credential_id: String,
    pub(crate) credential_generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordSetPlanning {
    pub(crate) predecessor: PasswordSetPredecessor,
    pub(crate) displaced: Option<DisplacedPasswordPredecessor>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PasswordChangePlanning {
    pub(crate) credential: PasswordSnapshot,
    pub(crate) canonical_identifier: String,
    pub(crate) acting_session_id: String,
    pub(crate) acting_generation: u64,
    pub(crate) acting_token_digest: crate::contract_types::TokenDigest,
    pub(crate) authority_instance_id: String,
    pub(crate) sender_constrained: bool,
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct PasswordChangeCommitPlan {
    pub(crate) credential: PasswordSnapshot,
    pub(crate) canonical_identifier: String,
    pub(crate) verified: bool,
    pub(crate) replacement: PreparedPasswordHash,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct GuestClaimPredecessor {
    pub(crate) session_id: String,
    pub(crate) user_id: String,
    pub(crate) generation: u64,
    pub(crate) token_digest: crate::contract_types::TokenDigest,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RecoveryCodePredecessor {
    pub(crate) user_id: String,
    pub(crate) identity_id: String,
    pub(crate) set_credential_id: String,
    pub(crate) ordinal: u64,
    pub(crate) digest: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RecoveryRotatePredecessor {
    pub(crate) acting_session_id: String,
    pub(crate) acting_generation: u64,
    pub(crate) acting_token_digest: crate::contract_types::TokenDigest,
    pub(crate) credential: PasswordSnapshot,
}

impl fmt::Debug for PasswordChangeCommitPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordChangeCommitPlan")
            .field("credential", &self.credential)
            .field("canonical_identifier", &self.canonical_identifier)
            .field("verified", &self.verified)
            .field("replacement", &"[REDACTED]")
            .finish()
    }
}

impl fmt::Debug for PreparedRecoverySet {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PreparedRecoverySet")
            .field("key_id", &self.key_id)
            .field(
                "digests",
                &format_args!("[REDACTED; {}]", self.digests.len()),
            )
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) enum PasswordIssuanceOperation {
    Register {
        credential_id: String,
        password: PreparedPasswordHash,
        recovery: PreparedRecoverySet,
    },
    Authenticate {
        credential: Option<PasswordSnapshot>,
        admission_ledger: Option<PasswordAttemptState>,
        verified: bool,
        replacement: Option<PreparedPasswordHash>,
    },
    Set {
        predecessor: PasswordSetPredecessor,
        displaced: Option<DisplacedPasswordPredecessor>,
        step_up: crate::auth::crypto::StepUpProof,
        credential_id: String,
        password: PreparedPasswordHash,
        recovery: PreparedRecoverySet,
    },
    GuestClaim {
        predecessor: GuestClaimPredecessor,
        credential_id: String,
        password: PreparedPasswordHash,
        recovery: PreparedRecoverySet,
    },
    RecoveryConsume {
        predecessor: RecoveryCodePredecessor,
        successor_credential_id: String,
        successor_recovery: PreparedRecoverySet,
    },
    RecoveryRotate {
        predecessor: RecoveryRotatePredecessor,
        successor_credential_id: String,
        successor_recovery: PreparedRecoverySet,
    },
    Reset {
        email_identity_id: String,
        credential: PasswordSnapshot,
        replacement: PreparedPasswordHash,
    },
}

impl fmt::Debug for PasswordIssuanceOperation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Register {
                credential_id,
                recovery,
                ..
            } => formatter
                .debug_struct("Register")
                .field("credential_id", credential_id)
                .field("password", &"[REDACTED]")
                .field("recovery", recovery)
                .finish(),
            Self::Authenticate {
                credential,
                admission_ledger,
                verified,
                replacement,
            } => formatter
                .debug_struct("Authenticate")
                .field("credential", credential)
                .field("admission_ledger", admission_ledger)
                .field("verified", verified)
                .field("replacement", &replacement.as_ref().map(|_| "[REDACTED]"))
                .finish(),
            Self::Set {
                predecessor,
                displaced,
                step_up: _,
                credential_id,
                recovery,
                ..
            } => formatter
                .debug_struct("Set")
                .field("predecessor", predecessor)
                .field("displaced", displaced)
                .field("credential_id", credential_id)
                .field("password", &"[REDACTED]")
                .field("recovery", recovery)
                .finish(),
            Self::GuestClaim {
                predecessor,
                credential_id,
                recovery,
                ..
            } => formatter
                .debug_struct("GuestClaim")
                .field("predecessor", predecessor)
                .field("credential_id", credential_id)
                .field("password", &"[REDACTED]")
                .field("recovery", recovery)
                .finish(),
            Self::RecoveryConsume {
                predecessor,
                successor_credential_id,
                successor_recovery,
            } => formatter
                .debug_struct("RecoveryConsume")
                .field("predecessor", predecessor)
                .field("successor_credential_id", successor_credential_id)
                .field("successor_recovery", successor_recovery)
                .finish(),
            Self::RecoveryRotate {
                predecessor,
                successor_credential_id,
                successor_recovery,
            } => formatter
                .debug_struct("RecoveryRotate")
                .field("predecessor", predecessor)
                .field("successor_credential_id", successor_credential_id)
                .field("successor_recovery", successor_recovery)
                .finish(),
            Self::Reset {
                email_identity_id,
                credential,
                ..
            } => formatter
                .debug_struct("Reset")
                .field("email_identity_id", email_identity_id)
                .field("credential", credential)
                .field("replacement", &"[REDACTED]")
                .finish(),
        }
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct PasswordIssuanceCommitPlan {
    pub(crate) canonical_identifier: String,
    pub(crate) identifier_mode: PasswordIdentifierMode,
    pub(crate) identity_id: String,
    pub(crate) user_id: String,
    pub(crate) operation: PasswordIssuanceOperation,
}

impl fmt::Debug for PasswordIssuanceCommitPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordIssuanceCommitPlan")
            .field("canonical_identifier", &self.canonical_identifier)
            .field("identifier_mode", &self.identifier_mode)
            .field("identity_id", &self.identity_id)
            .field("user_id", &self.user_id)
            .field("operation", &self.operation)
            .finish()
    }
}

pub(crate) enum PasswordIssuanceAdmission {
    Proceed {
        create_principal: bool,
    },
    Invalid {
        committed_attempt: Option<PasswordAttemptState>,
    },
    LedgerCapacityExhausted,
    PredecessorChanged,
}

struct PasswordIdentifier {
    canonical: String,
    mode: PasswordIdentifierMode,
}

#[derive(Clone, Copy)]
pub(crate) struct RecoveryKeyMaterial<'a> {
    key_id: &'a str,
    key: &'a [u8; 32],
}

impl<'a> RecoveryKeyMaterial<'a> {
    pub(crate) const fn new(key_id: &'a str, key: &'a [u8; 32]) -> Self {
        Self { key_id, key }
    }
}

/// A prepared authority cannot be decoded from a request or constructed by an
/// app handler. The host supplies server-resolved ids from one verified event.
pub(crate) struct VerifiedProvisioningAuthority {
    hook_id: String,
    hook_digest: [u8; 32],
    provisioning_key: String,
    user_id: String,
    identity_id: String,
    assurance_id: String,
    declared_writes: BTreeSet<String>,
}

pub(crate) struct ProvisioningInsert {
    pub table: String,
    pub columns: Vec<(String, String)>,
}

pub(crate) struct VerifiedEmailClaim {
    canonical: CanonicalAddress,
    event_id: String,
    governing_authority: String,
}
pub(crate) fn prepare_verified_email_claim(
    address: &str,
    event_id: &str,
    governing_authority: &str,
) -> SnapbackResult<VerifiedEmailClaim> {
    let canonical = CanonicalAddress::parse(address).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_IDENTITY_INVALID",
            "verified identity is invalid",
        )
    })?;
    if event_id.is_empty() || governing_authority.is_empty() {
        return Err(auth_error(
            "SNAPBACK_AUTH_VERIFIED_PROOF_INVALID",
            "verified proof is invalid",
        ));
    }
    Ok(VerifiedEmailClaim {
        canonical,
        event_id: event_id.into(),
        governing_authority: governing_authority.into(),
    })
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ProvisioningOutcome {
    Committed,
    AlreadyCommitted,
}

pub(crate) fn prepare_verified_provisioning(
    hook_id: &str,
    hook_digest: [u8; 32],
    provisioning_key: &str,
    user_id: &str,
    identity_id: &str,
    assurance_id: &str,
    declared_writes: impl IntoIterator<Item = String>,
) -> SnapbackResult<VerifiedProvisioningAuthority> {
    if hook_id.is_empty() || provisioning_key.is_empty() {
        return Err(auth_error(
            "SNAPBACK_AUTH_PROVISIONING_INVALID",
            "verified provisioning authority is invalid",
        ));
    }
    Ok(VerifiedProvisioningAuthority {
        hook_id: hook_id.into(),
        hook_digest,
        provisioning_key: provisioning_key.into(),
        user_id: user_id.into(),
        identity_id: identity_id.into(),
        assurance_id: assurance_id.into(),
        declared_writes: declared_writes.into_iter().collect(),
    })
}

fn quoted_identifier(value: &str) -> SnapbackResult<String> {
    if !crate::manifest::is_user_identifier(value) {
        return Err(auth_error(
            "SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN",
            "provisioning write identifier is not declared",
        ));
    }
    Ok(format!("\"{value}\""))
}

fn auth_error(code: &'static str, message: &'static str) -> SnapbackError {
    SnapbackError::error(code, "auth", message)
}
fn opaque_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

fn canonical_username(value: &str) -> SnapbackResult<String> {
    if value.chars().any(|c| c == '\0' || c.is_control()) {
        return Err(auth_error(
            "SNAPBACK_AUTH_USERNAME_INVALID",
            "username is invalid",
        ));
    }
    let trimmed = value.trim_matches(char::is_whitespace);
    let normalized: String = trimmed.nfc().collect();
    let canonical = normalized.to_lowercase();
    if canonical.is_empty()
        || canonical.len() > 128
        || canonical
            .chars()
            .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(auth_error(
            "SNAPBACK_AUTH_USERNAME_INVALID",
            "username is invalid",
        ));
    }
    Ok(canonical)
}

fn canonical_password_identifier(
    mode: PasswordIdentifierMode,
    value: &str,
) -> SnapbackResult<PasswordIdentifier> {
    Ok(PasswordIdentifier {
        canonical: canonical_password_identifier_value(mode, value)?,
        mode,
    })
}

pub(crate) fn canonical_password_identifier_value(
    mode: PasswordIdentifierMode,
    value: &str,
) -> SnapbackResult<String> {
    let canonical = match mode {
        PasswordIdentifierMode::UsernameV1 => canonical_username(value),
        PasswordIdentifierMode::EmailV1 => CanonicalAddress::parse(value)
            .map(|address| address.as_str().to_owned())
            .map_err(|_| {
                auth_error(
                    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                    "password identifier does not satisfy the declared mode",
                )
            }),
    }
    .map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
            "password identifier does not satisfy the declared mode",
        )
    })?;
    Ok(canonical)
}

fn require_same_password_identifier_mode(
    conn: &rusqlite::Connection,
    expected: PasswordIdentifierMode,
) -> SnapbackResult<()> {
    if super::auth::identity_floor_password_identifier_mode_on(conn)? == expected {
        return Ok(());
    }
    Err(auth_error(
        "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_IMMUTABLE",
        "password identifier mode cannot change after auth catalog activation",
    ))
}

pub(crate) fn hash_password_on_blocking_pool(
    secret: &PasswordSecret,
    random: &dyn RandomSource,
) -> SnapbackResult<PreparedPasswordHash> {
    hash_password_on_blocking_pool_with_profile(
        secret,
        random,
        PasswordSecurityProfile::for_provider(crate::contract_types::AuthProviderProfile::Prod),
    )
}

pub(crate) fn hash_password_on_blocking_pool_with_profile(
    secret: &PasswordSecret,
    random: &dyn RandomSource,
    profile: PasswordSecurityProfile,
) -> SnapbackResult<PreparedPasswordHash> {
    let password = secret.expose_secret();
    if password.len() < profile.minimum_password_length
        || password.len() > 1_024
        || COMMON_PASSWORDS
            .iter()
            .any(|candidate| candidate == &password)
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_PASSWORD_POLICY",
            "auth",
            format!(
                "password must be {}–1024 UTF-8 bytes and pass common-password screening; configure the minimum with defineAuth mechanisms.<name>.minimumLength (default 12)",
                profile.minimum_password_length,
            ),
        )
        .with_details(serde_json::json!({
            "minimumLength": profile.minimum_password_length,
            "maximumLength": 1_024,
            "configuration": "defineAuth mechanisms.<name>.minimumLength",
            "defaultMinimumLength": crate::contract_types::AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT,
        })));
    }
    let mut salt = [0_u8; PASSWORD_HASH_POLICY_V1.salt_bytes];
    random.fill(&mut salt).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
            "secure randomness is unavailable",
        )
    })?;
    PASSWORD_HASH_POLICY_V1
        .argon2()
        .hash_password_with_salt(password.as_bytes(), &salt)
        .map(|hash| PreparedPasswordHash {
            phc: hash.to_string(),
            algorithm: "argon2id",
        })
        .map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_PASSWORD_HASH_UNAVAILABLE",
                "password hashing is unavailable",
            )
        })
}

// Transitional storage-floor helper. First-class request paths enter through
// `AuthProvider::hash_password_bounded`; the direct floor remains only for
// catalog fixtures until every fixture is migrated to prepared plans.
fn hash_password(secret: &PasswordSecret, random: &dyn RandomSource) -> SnapbackResult<String> {
    Ok(hash_password_on_blocking_pool(secret, random)?.phc)
}

/// Declared cost ceilings for any stored hash we are willing to *verify*.
///
/// @ref LLP 0227#migration-and-import-of-existing-hashes — "Foreign hashes are
///   bounded, not just allowlisted: … every cost parameter … validate against
///   declared caps before storage, so an imported PHC string cannot demand
///   pathological KDF work."
///
/// These bind at verification, not only at import. A PHC string carries its own
/// cost parameters and PHC verification necessarily re-derives from *those*, not
/// from [`PASSWORD_HASH_POLICY_V1`] — so passing a policy-configured `Argon2` to
/// `verify_password` pins hashing, not verifying. Without this gate a single
/// stored hash declaring, say, 4 GiB of Argon2 memory or a bcrypt cost of 31
/// would burn that per attempt. The KDF concurrency permit bounds how *many*
/// verifications run at once; it cannot bound how expensive one of them is.
///
/// Ceilings sit comfortably above the pinned v1 policy (m=19456, t=2, p=1) so
/// legitimately imported credentials still verify once and upgrade on success.
const IMPORTED_HASH_MAX_ARGON2_MEMORY_KIB: u32 = 262_144; // 256 MiB
const IMPORTED_HASH_MAX_ARGON2_ITERATIONS: u32 = 16;
const IMPORTED_HASH_MAX_ARGON2_PARALLELISM: u32 = 8;
const IMPORTED_HASH_MAX_SCRYPT_LOG_N: u8 = 17; // N = 131_072
const IMPORTED_HASH_MAX_SCRYPT_R: u32 = 16;
const IMPORTED_HASH_MAX_SCRYPT_P: u32 = 8;
const IMPORTED_HASH_MAX_BCRYPT_COST: u32 = 13;
const IMPORTED_HASH_MAX_ENCODED_BYTES: usize = 1_024;

/// A bcrypt modular-crypt string is `$2<variant>$<cost>$<53 chars>`; the cost is
/// the second `$`-delimited field. Returns `None` when it is not parseable,
/// which callers treat as refusal.
fn bcrypt_declared_cost(hash_phc: &str) -> Option<u32> {
    hash_phc.split('$').nth(2)?.parse::<u32>().ok()
}

/// Fail-closed: an unparseable or over-budget hash is refused rather than
/// verified. Refusing here cannot become an oracle — the caller answers with the
/// same uniform invalid code it uses for every other failure class.
fn phc_cost_within_declared_caps(hash_phc: &str) -> bool {
    if hash_phc.len() > IMPORTED_HASH_MAX_ENCODED_BYTES {
        return false;
    }
    if hash_phc.starts_with("$2a$")
        || hash_phc.starts_with("$2b$")
        || hash_phc.starts_with("$2x$")
        || hash_phc.starts_with("$2y$")
    {
        return bcrypt_declared_cost(hash_phc)
            .is_some_and(|cost| cost <= IMPORTED_HASH_MAX_BCRYPT_COST);
    }
    let Ok(hash) = PasswordHash::new(hash_phc) else {
        return false;
    };
    match hash.algorithm.as_str() {
        "argon2id" | "argon2i" | "argon2d" => Params::try_from(&hash).is_ok_and(|params| {
            params.m_cost() <= IMPORTED_HASH_MAX_ARGON2_MEMORY_KIB
                && params.t_cost() <= IMPORTED_HASH_MAX_ARGON2_ITERATIONS
                && params.p_cost() <= IMPORTED_HASH_MAX_ARGON2_PARALLELISM
        }),
        "scrypt" => scrypt::Params::try_from(&hash).is_ok_and(|params| {
            params.log_n() <= IMPORTED_HASH_MAX_SCRYPT_LOG_N
                && params.r() <= IMPORTED_HASH_MAX_SCRYPT_R
                && params.p() <= IMPORTED_HASH_MAX_SCRYPT_P
        }),
        _ => false,
    }
}

fn verify_password(secret: &PasswordSecret, hash_phc: &str) -> bool {
    // Bound the work *before* committing to it. See the caps above.
    if !phc_cost_within_declared_caps(hash_phc) {
        return false;
    }
    let plaintext = secret.expose_secret();
    if hash_phc.starts_with("$2a$")
        || hash_phc.starts_with("$2b$")
        || hash_phc.starts_with("$2x$")
        || hash_phc.starts_with("$2y$")
    {
        return bcrypt::verify(plaintext, hash_phc).unwrap_or(false);
    }
    let Ok(hash) = PasswordHash::new(hash_phc) else {
        return false;
    };
    match hash.algorithm.as_str() {
        "argon2id" | "argon2i" | "argon2d" => PASSWORD_HASH_POLICY_V1
            .argon2()
            .verify_password(plaintext.as_bytes(), &hash)
            .is_ok(),
        "scrypt" => scrypt::Scrypt::new()
            .verify_password(plaintext.as_bytes(), &hash)
            .is_ok(),
        _ => false,
    }
}

pub(crate) fn verify_password_on_blocking_pool(
    secret: &PasswordSecret,
    hash_phc: &str,
    prepare_upgrade: bool,
    random: &dyn RandomSource,
) -> SnapbackResult<PreparedPasswordVerification> {
    let verified = verify_password(secret, hash_phc);
    let replacement = if verified && prepare_upgrade && password_hash_needs_upgrade(hash_phc) {
        Some(hash_password_on_blocking_pool(secret, random)?)
    } else {
        None
    };
    Ok(PreparedPasswordVerification {
        verified,
        replacement,
    })
}

fn password_hash_needs_upgrade(hash_phc: &str) -> bool {
    PasswordHash::new(hash_phc)
        .map(|hash| !PASSWORD_HASH_POLICY_V1.matches_phc(&hash))
        .unwrap_or(true)
}

fn recovery_digest(key: &[u8; 32], code: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("fixed-size HMAC key");
    mac.update(RECOVERY_DOMAIN);
    mac.update(code.as_bytes());
    mac.finalize().into_bytes().into()
}

fn generate_recovery(
    random: &dyn RandomSource,
    key: &[u8; 32],
) -> SnapbackResult<(RecoveryCodes, Vec<[u8; 32]>)> {
    let mut codes = Vec::with_capacity(RECOVERY_COUNT);
    let mut digests = Vec::with_capacity(RECOVERY_COUNT);
    for _ in 0..RECOVERY_COUNT {
        let mut bytes = [0_u8; 20];
        random.fill(&mut bytes).map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                "secure randomness is unavailable",
            )
        })?;
        let code = format!("sbrv1_{}", URL_SAFE_NO_PAD.encode(bytes));
        digests.push(recovery_digest(key, &code));
        codes.push(code);
    }
    Ok((RecoveryCodes::new(codes), digests))
}

pub(crate) fn prepare_recovery_set(
    random: &dyn RandomSource,
    key_id: &str,
    key: &[u8; 32],
) -> SnapbackResult<(RecoveryCodes, PreparedRecoverySet)> {
    let (codes, digests) = generate_recovery(random, key)?;
    Ok((
        codes,
        PreparedRecoverySet {
            key_id: key_id.to_owned(),
            digests,
        },
    ))
}

fn mint_session(random: &dyn RandomSource) -> SnapbackResult<(String, String, SessionBearer)> {
    let bearer = SessionBearer::generate(random).map_err(|_| {
        auth_error(
            "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
            "secure randomness is unavailable",
        )
    })?;
    // The legacy fixture/floor path still obeys the canonical authority-id
    // registry. First-class password request paths bypass this helper and use
    // the projection-coordinated provider issuance kernel.
    Ok((
        opaque_id("session"),
        crate::ids::mint_time_ordered(crate::ids::Kind::AuthorityInstance),
        bearer,
    ))
}

fn insert_session(
    tx: &Transaction<'_>,
    user: &str,
    identity: Option<&str>,
    credential: Option<&str>,
    source: &str,
    now: u64,
    random: &dyn RandomSource,
) -> SnapbackResult<(String, SessionBearer)> {
    let (session, authority, bearer) = mint_session(random)?;
    tx.execute("INSERT INTO _auth_sessions(id,user_id,identity_id,credential_id,authn_source,authority_instance_id,token_hash,generation,created_at_ms,last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8,?9,?10,NULL)", params![session, user, identity, credential, source, authority, bearer.token_hash().as_bytes().as_slice(), now, now + SESSION_IDLE_MS, now + SESSION_ABSOLUTE_MS])?;
    Ok((session, bearer))
}

fn insert_assurance(
    tx: &Transaction<'_>,
    user: &str,
    session: &str,
    credential: Option<&str>,
    kind: &str,
    now: u64,
    expiry: Option<u64>,
) -> SnapbackResult<()> {
    tx.execute("INSERT INTO _auth_assurances(id,user_id,session_id,identity_id,credential_id,kind,provenance,issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms) VALUES(?1,?2,?3,NULL,?4,?5,?6,?7,?8,NULL,NULL)", params![opaque_id("assurance"), user, session, credential, kind, if credential.is_some() { "credential" } else { "session" }, now, expiry])?;
    Ok(())
}

fn journal(tx: &Transaction<'_>, user: &str, kind: &str, now: u64) -> SnapbackResult<()> {
    tx.execute("INSERT INTO _auth_security_events(id,user_id,kind,cause_class,occurred_at_ms,correlation_id,redacted_metadata) VALUES(?1,?2,?3,'public-transition',?4,?5,?6)", params![opaque_id("event"), user, kind, now, opaque_id("correlation"), r#"{"notificationChannel":"unavailable"}"#])?;
    Ok(())
}

fn insert_recovery_set(
    tx: &Transaction<'_>,
    user: &str,
    key_id: &str,
    digests: &[[u8; 32]],
    reason: &str,
    now: u64,
) -> SnapbackResult<String> {
    insert_recovery_set_with_id(
        tx,
        user,
        &opaque_id("recovery"),
        key_id,
        digests,
        reason,
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn insert_recovery_set_with_id(
    tx: &Transaction<'_>,
    user: &str,
    id: &str,
    key_id: &str,
    digests: &[[u8; 32]],
    reason: &str,
    now: u64,
) -> SnapbackResult<String> {
    let generation: u64 = tx.query_row("SELECT COALESCE(MAX(set_generation),0)+1 FROM _auth_recovery_code_sets r JOIN _auth_credentials c ON c.id=r.credential_id WHERE c.user_id=?1", [user], |row| row.get(0))?;
    tx.execute("UPDATE _auth_credentials SET revoked_at_ms=?2 WHERE user_id=?1 AND kind='recovery-code-set' AND revoked_at_ms IS NULL", params![user, now])?;
    tx.execute("UPDATE _auth_recovery_code_sets SET replaced_at_ms=?2 WHERE credential_id IN (SELECT id FROM _auth_credentials WHERE user_id=?1 AND kind='recovery-code-set') AND replaced_at_ms IS NULL", params![user, now])?;
    tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,generation,created_at_ms) VALUES(?1,?2,'recovery-code-set',?3,?4)", params![id, user, generation, now])?;
    tx.execute("INSERT INTO _auth_recovery_code_sets(credential_id,set_generation,reason,issued_at_ms) VALUES(?1,?2,?3,?4)", params![id, generation, reason, now])?;
    for (ordinal, digest) in digests.iter().enumerate() {
        tx.execute("INSERT INTO _auth_recovery_codes(set_credential_id,ordinal,code_digest,key_id) VALUES(?1,?2,?3,?4)", params![id, ordinal as u64, digest.as_slice(), key_id])?;
    }
    Ok(id.to_owned())
}

fn read_password_attempt_on(
    connection: &rusqlite::Connection,
    canonical_identifier: &str,
) -> SnapbackResult<Option<PasswordAttemptState>> {
    connection
        .query_row(
            "SELECT window_start_ms, failed_count, locked_until_ms
             FROM _auth_password_attempts WHERE address = ?1",
            [canonical_identifier],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        )
        .optional()?
        .map(|(window, failures, locked)| {
            Ok(PasswordAttemptState {
                window_start_ms: u64::try_from(window).map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
                failed_count: u64::try_from(failures).map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
                locked_until_ms: locked.map(u64::try_from).transpose().map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
            })
        })
        .transpose()
}

fn password_snapshot_on(
    connection: &rusqlite::Connection,
    canonical_identifier: &str,
    identifier_mode: PasswordIdentifierMode,
) -> SnapbackResult<Option<PasswordSnapshot>> {
    connection
        .query_row(
            "SELECT i.user_id,i.id,c.id,c.generation,p.hash_phc
             FROM _auth_identities i
             JOIN _auth_credentials c
               ON c.user_id=i.user_id
              AND c.kind='password'
              AND c.revoked_at_ms IS NULL
             JOIN _auth_password_credentials p ON p.credential_id=c.id
             JOIN _auth_users u ON u.id=i.user_id
             WHERE i.provider='local-password'
               AND i.subject=?1
               AND i.disabled_at_ms IS NULL
               AND u.deactivated_at_ms IS NULL",
            [canonical_identifier],
            |row| {
                Ok(PasswordSnapshot {
                    user_id: row.get(0)?,
                    identity_id: row.get(1)?,
                    credential_id: row.get(2)?,
                    generation: row.get(3)?,
                    hash_phc: row.get(4)?,
                    identifier_mode,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn normalize_attempt_window(
    state: Option<PasswordAttemptState>,
    now_ms: u64,
    profile: PasswordSecurityProfile,
) -> PasswordAttemptState {
    let Some(state) = state else {
        return PasswordAttemptState {
            window_start_ms: now_ms,
            failed_count: 0,
            locked_until_ms: None,
        };
    };
    let lock_live = state.locked_until_ms.is_some_and(|until| now_ms < until);
    let window_live = now_ms
        < state
            .window_start_ms
            .saturating_add(profile.failure_window_ms);
    if lock_live || window_live {
        state
    } else {
        PasswordAttemptState {
            window_start_ms: now_ms,
            failed_count: 0,
            locked_until_ms: None,
        }
    }
}

fn record_password_failure_in(
    transaction: &Transaction<'_>,
    canonical_identifier: &str,
    current: Option<PasswordAttemptState>,
    now_ms: u64,
    profile: PasswordSecurityProfile,
) -> SnapbackResult<Result<PasswordAttemptState, ()>> {
    let exists = current.is_some();
    if !exists {
        transaction.execute(
            "DELETE FROM _auth_password_attempts
             WHERE (locked_until_ms IS NULL OR locked_until_ms <= ?1)
               AND window_start_ms <= ?2",
            params![
                now_ms as i64,
                now_ms.saturating_sub(profile.failure_window_ms) as i64
            ],
        )?;
        let rows: i64 =
            transaction.query_row("SELECT COUNT(*) FROM _auth_password_attempts", [], |row| {
                row.get(0)
            })?;
        if u64::try_from(rows)
            .ok()
            .is_none_or(|rows| rows >= profile.ledger_max_rows)
        {
            return Ok(Err(()));
        }
    }
    let mut successor = normalize_attempt_window(current, now_ms, profile);
    successor.failed_count = successor.failed_count.checked_add(1).ok_or_else(|| {
        auth_error(
            "INTERNAL_AUTH_STATE",
            "authentication state invariant failed",
        )
    })?;
    if successor.failed_count >= profile.failure_threshold {
        successor.locked_until_ms = Some(now_ms.checked_add(profile.lock_duration_ms).ok_or_else(
            || {
                auth_error(
                    "INTERNAL_AUTH_STATE",
                    "authentication state invariant failed",
                )
            },
        )?);
    }
    transaction.execute(
        "INSERT INTO _auth_password_attempts(
           address, window_start_ms, failed_count, locked_until_ms
         ) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(address) DO UPDATE SET
           window_start_ms=excluded.window_start_ms,
           failed_count=excluded.failed_count,
           locked_until_ms=excluded.locked_until_ms",
        params![
            canonical_identifier,
            successor.window_start_ms as i64,
            successor.failed_count as i64,
            successor.locked_until_ms.map(|value| value as i64),
        ],
    )?;
    Ok(Ok(successor))
}

/// Recheck the exact credential predecessor and the current ledger under the
/// writer serialization point. This function performs no successful issuance
/// mutation; it may only commit account-existence-blind failure accounting.
///
/// @ref LLP 0227#principal-binding-same-sessions-no-parallel-identity — a stale proof neither
///   authorizes nor penalizes, while a lock acquired during KDF is honored.
pub(crate) fn admit_password_issuance_in(
    transaction: &Transaction<'_>,
    plan: &PasswordIssuanceCommitPlan,
    now_ms: u64,
    profile: PasswordSecurityProfile,
) -> SnapbackResult<PasswordIssuanceAdmission> {
    super::auth::require_password_identifier_mode_on(transaction)?;
    require_same_password_identifier_mode(transaction, plan.identifier_mode)?;
    match &plan.operation {
        PasswordIssuanceOperation::Register { .. } => {
            let collision: bool = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _auth_identities
                   WHERE subject=?1 AND disabled_at_ms IS NULL
                 )",
                [&plan.canonical_identifier],
                |row| row.get(0),
            )?;
            if collision {
                return Ok(PasswordIssuanceAdmission::PredecessorChanged);
            }
            let id_collision: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_users WHERE id=?1)
                     OR EXISTS(SELECT 1 FROM _auth_identities WHERE id=?2)",
                params![plan.user_id, plan.identity_id],
                |row| row.get(0),
            )?;
            Ok(if id_collision {
                PasswordIssuanceAdmission::PredecessorChanged
            } else {
                PasswordIssuanceAdmission::Proceed {
                    create_principal: true,
                }
            })
        }
        PasswordIssuanceOperation::Authenticate {
            credential,
            verified,
            ..
        } => {
            let durable = password_snapshot_on(
                transaction,
                &plan.canonical_identifier,
                plan.identifier_mode,
            )?;
            if durable != *credential {
                // The KDF proof was computed against a credential generation
                // that is no longer authoritative.  This is deliberately the
                // same public result as every other bad credential, and it
                // performs no ledger write.
                return Ok(PasswordIssuanceAdmission::Invalid {
                    committed_attempt: None,
                });
            }
            let ledger = read_password_attempt_on(transaction, &plan.canonical_identifier)?;
            let normalized = normalize_attempt_window(ledger.clone(), now_ms, profile);
            if normalized
                .locked_until_ms
                .is_some_and(|until| now_ms < until)
            {
                return Ok(PasswordIssuanceAdmission::Invalid {
                    committed_attempt: None,
                });
            }
            if !*verified || credential.is_none() {
                return match record_password_failure_in(
                    transaction,
                    &plan.canonical_identifier,
                    ledger,
                    now_ms,
                    profile,
                )? {
                    Ok(committed_attempt) => Ok(PasswordIssuanceAdmission::Invalid {
                        committed_attempt: Some(committed_attempt),
                    }),
                    Err(()) => Ok(PasswordIssuanceAdmission::LedgerCapacityExhausted),
                };
            }
            Ok(PasswordIssuanceAdmission::Proceed {
                create_principal: false,
            })
        }
        PasswordIssuanceOperation::Set {
            predecessor,
            displaced,
            step_up,
            ..
        } => {
            let acting: Option<(String, i64, Vec<u8>)> = transaction
                .query_row(
                    "SELECT user_id,generation,token_hash FROM _auth_sessions
                     WHERE id=?1 AND revoked_at_ms IS NULL AND ?2<expires_at_ms",
                    params![predecessor.acting_session_id, now_ms],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if !acting.is_some_and(|(user, generation, digest)| {
                user == predecessor.acting_user_id
                    && u64::try_from(generation).ok() == Some(predecessor.acting_generation)
                    && digest.as_slice() == predecessor.acting_token_digest.as_bytes().as_slice()
            }) {
                return Ok(PasswordIssuanceAdmission::PredecessorChanged);
            }
            let email_owner: Option<(String, String, String)> = transaction
                .query_row(
                    "SELECT user_id,provider,subject FROM _auth_identities
                     WHERE id=?1 AND disabled_at_ms IS NULL",
                    [&predecessor.email_identity_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            if email_owner
                != Some((
                    predecessor.acting_user_id.clone(),
                    "email-code".to_owned(),
                    plan.canonical_identifier.clone(),
                ))
            {
                return Ok(PasswordIssuanceAdmission::PredecessorChanged);
            }
            let live_passwords: i64 = transaction.query_row(
                "SELECT COUNT(*) FROM _auth_credentials
                 WHERE user_id=?1 AND kind='password' AND revoked_at_ms IS NULL",
                [&predecessor.acting_user_id],
                |row| row.get(0),
            )?;
            if live_passwords != 0 {
                return Ok(PasswordIssuanceAdmission::PredecessorChanged);
            }
            let durable_displaced: Option<(String, String, String, i64)> = transaction
                .query_row(
                    "SELECT i.id,i.user_id,c.id,c.generation
                     FROM _auth_identities i
                     JOIN _auth_credentials c
                       ON c.user_id=i.user_id
                      AND c.kind='password'
                      AND c.revoked_at_ms IS NULL
                     WHERE i.provider='local-password'
                       AND i.subject=?1 AND i.disabled_at_ms IS NULL",
                    [&plan.canonical_identifier],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            let expected_displaced = displaced.as_ref().map(|value| {
                (
                    value.identity_id.clone(),
                    value.user_id.clone(),
                    value.credential_id.clone(),
                    value.credential_generation as i64,
                )
            });
            if durable_displaced != expected_displaced {
                return Ok(PasswordIssuanceAdmission::PredecessorChanged);
            }
            if super::auth_catalog_ops::consume_step_up_proof_on(transaction, step_up, now_ms)?
                != StepUpConsumption::Verified
            {
                return Ok(PasswordIssuanceAdmission::Invalid {
                    committed_attempt: None,
                });
            }
            Ok(PasswordIssuanceAdmission::Proceed {
                create_principal: false,
            })
        }
        PasswordIssuanceOperation::GuestClaim { predecessor, .. } => {
            let guest: Option<(String, i64, Vec<u8>)> = transaction
                .query_row(
                    "SELECT s.user_id,s.generation,s.token_hash
                     FROM _auth_sessions s
                     JOIN _auth_users u ON u.id=s.user_id
                     WHERE s.id=?1 AND s.revoked_at_ms IS NULL
                       AND ?2<s.expires_at_ms AND s.authn_source='guest'
                       AND u.guest_state='active'",
                    params![predecessor.session_id, now_ms],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let exact = guest.is_some_and(|(user, generation, digest)| {
                user == predecessor.user_id
                    && u64::try_from(generation).ok() == Some(predecessor.generation)
                    && digest.as_slice() == predecessor.token_digest.as_bytes().as_slice()
            });
            let collision: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_identities
                 WHERE provider='local-password' AND subject=?1
                   AND disabled_at_ms IS NULL)",
                [&plan.canonical_identifier],
                |row| row.get(0),
            )?;
            Ok(if exact && !collision {
                PasswordIssuanceAdmission::Proceed {
                    create_principal: false,
                }
            } else {
                PasswordIssuanceAdmission::PredecessorChanged
            })
        }
        PasswordIssuanceOperation::RecoveryConsume { predecessor, .. } => {
            let exact: bool = transaction.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _auth_recovery_codes r
                   JOIN _auth_recovery_code_sets s
                     ON s.credential_id=r.set_credential_id
                    AND s.replaced_at_ms IS NULL
                   JOIN _auth_credentials c
                     ON c.id=r.set_credential_id
                    AND c.revoked_at_ms IS NULL
                   JOIN _auth_identities i
                     ON i.user_id=c.user_id
                    AND i.id=?5
                    AND i.provider='local-password'
                    AND i.disabled_at_ms IS NULL
                   WHERE r.set_credential_id=?1 AND r.ordinal=?2
                     AND r.code_digest=?3 AND r.consumed_at_ms IS NULL
                     AND c.user_id=?4
                 )",
                params![
                    predecessor.set_credential_id,
                    predecessor.ordinal,
                    predecessor.digest.as_slice(),
                    predecessor.user_id,
                    predecessor.identity_id,
                ],
                |row| row.get(0),
            )?;
            Ok(if exact {
                PasswordIssuanceAdmission::Proceed {
                    create_principal: false,
                }
            } else {
                PasswordIssuanceAdmission::PredecessorChanged
            })
        }
        PasswordIssuanceOperation::RecoveryRotate { predecessor, .. } => {
            let acting: Option<(String, i64, Vec<u8>)> = transaction
                .query_row(
                    "SELECT user_id,generation,token_hash FROM _auth_sessions
                     WHERE id=?1 AND revoked_at_ms IS NULL AND ?2<expires_at_ms",
                    params![predecessor.acting_session_id, now_ms],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let exact_session = acting.is_some_and(|(user, generation, digest)| {
                user == predecessor.credential.user_id
                    && u64::try_from(generation).ok() == Some(predecessor.acting_generation)
                    && digest.as_slice()
                        == predecessor.acting_token_digest.as_bytes().as_slice()
            });
            let exact_credential = password_snapshot_on(
                transaction,
                &plan.canonical_identifier,
                plan.identifier_mode,
            )?
            .as_ref()
                == Some(&predecessor.credential);
            Ok(if exact_session && exact_credential {
                PasswordIssuanceAdmission::Proceed {
                    create_principal: false,
                }
            } else {
                PasswordIssuanceAdmission::PredecessorChanged
            })
        }
        PasswordIssuanceOperation::Reset {
            email_identity_id,
            credential,
            ..
        } => {
            let email_owner: Option<(String, String)> = transaction
                .query_row(
                    "SELECT user_id,subject FROM _auth_identities
                     WHERE id=?1 AND provider='email-code' AND disabled_at_ms IS NULL",
                    [email_identity_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let same_principal = email_owner
                == Some((
                    credential.user_id.clone(),
                    plan.canonical_identifier.clone(),
                ));
            let exact_password = password_snapshot_on(
                transaction,
                &plan.canonical_identifier,
                plan.identifier_mode,
            )?
            .as_ref()
                == Some(credential);
            Ok(if same_principal && exact_password {
                PasswordIssuanceAdmission::Proceed {
                    create_principal: false,
                }
            } else {
                PasswordIssuanceAdmission::PredecessorChanged
            })
        }
    }
}

/// Apply the successful credential transition only after candidate-collision
/// and exact cap admission have succeeded in the shared issuance transaction.
pub(crate) fn apply_password_issuance_in(
    transaction: &Transaction<'_>,
    plan: &PasswordIssuanceCommitPlan,
    now_ms: u64,
) -> SnapbackResult<()> {
    match &plan.operation {
        PasswordIssuanceOperation::Register {
            credential_id,
            password,
            recovery,
        } => {
            transaction.execute(
                "INSERT INTO _auth_users(id,created_at_ms,kind,guest_state)
                 VALUES(?1,?2,'human','never')",
                params![plan.user_id, now_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_identities(
                   id,user_id,kind,provider,subject,canonical_value,
                   created_at_ms,verified_at_ms
                 ) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",
                params![
                    plan.identity_id,
                    plan.user_id,
                    plan.identifier_mode.identity_kind(),
                    plan.canonical_identifier,
                    now_ms
                ],
            )?;
            transaction.execute(
                "INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms)
                 VALUES(?1,?2,'password',?3)",
                params![credential_id, plan.user_id, now_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_password_credentials(
                   credential_id,algorithm,hash_phc,policy_version,
                   common_password_list_version,changed_at_ms
                 ) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    credential_id,
                    password.algorithm(),
                    password.phc(),
                    PASSWORD_HASH_POLICY_V1.version,
                    PASSWORD_HASH_POLICY_V1.common_password_list_version,
                    now_ms
                ],
            )?;
            insert_recovery_set(
                transaction,
                &plan.user_id,
                &recovery.key_id,
                &recovery.digests,
                "initial",
                now_ms,
            )?;
        }
        PasswordIssuanceOperation::Authenticate {
            credential: Some(credential),
            replacement,
            ..
        } => {
            if let Some(replacement) = replacement {
                let swapped = transaction.execute(
                    "UPDATE _auth_password_credentials
                     SET algorithm=?2,hash_phc=?3,policy_version=?4,
                         common_password_list_version=?5,changed_at_ms=?6
                     WHERE credential_id=?1
                       AND EXISTS(
                         SELECT 1 FROM _auth_credentials
                         WHERE id=?1 AND generation=?7 AND revoked_at_ms IS NULL
                       )",
                    params![
                        credential.credential_id,
                        replacement.algorithm(),
                        replacement.phc(),
                        PASSWORD_HASH_POLICY_V1.version,
                        PASSWORD_HASH_POLICY_V1.common_password_list_version,
                        now_ms,
                        credential.generation,
                    ],
                )?;
                if swapped == 1 {
                    let generation_swapped = transaction.execute(
                        "UPDATE _auth_credentials
                         SET generation=generation+1,last_used_at_ms=?2
                         WHERE id=?1 AND generation=?3",
                        params![credential.credential_id, now_ms, credential.generation],
                    )?;
                    if generation_swapped != 1 {
                        return Err(auth_error(
                            "INTERNAL_AUTH_STATE",
                            "authentication state invariant failed",
                        ));
                    }
                } else {
                    return Err(auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    ));
                }
            } else {
                let used = transaction.execute(
                    "UPDATE _auth_credentials SET last_used_at_ms=?2
                     WHERE id=?1 AND generation=?3",
                    params![credential.credential_id, now_ms, credential.generation],
                )?;
                if used != 1 {
                    return Err(auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    ));
                }
            }
            transaction.execute(
                "DELETE FROM _auth_password_attempts WHERE address=?1",
                [&plan.canonical_identifier],
            )?;
        }
        PasswordIssuanceOperation::Authenticate {
            credential: None, ..
        } => {
            return Err(auth_error(
                "INTERNAL_AUTH_STATE",
                "authentication state invariant failed",
            ));
        }
        PasswordIssuanceOperation::Set {
            predecessor,
            displaced,
            step_up: _,
            credential_id,
            password,
            recovery,
        } => {
            if let Some(displaced) = displaced {
                let retired = transaction.execute(
                    "UPDATE _auth_credentials
                     SET revoked_at_ms=?2,generation=generation+1
                     WHERE id=?1 AND user_id=?3 AND generation=?4
                       AND revoked_at_ms IS NULL",
                    params![
                        displaced.credential_id,
                        now_ms,
                        displaced.user_id,
                        displaced.credential_generation,
                    ],
                )?;
                if retired != 1 {
                    return Err(auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    ));
                }
                let retired_subject = format!(
                    "retired:{}:{}",
                    displaced.identity_id, plan.canonical_identifier
                );
                let identity_retired = transaction.execute(
                    "UPDATE _auth_identities
                     SET disabled_at_ms=?2,subject=?3,canonical_value=NULL
                     WHERE id=?1 AND user_id=?4 AND disabled_at_ms IS NULL",
                    params![
                        displaced.identity_id,
                        now_ms,
                        retired_subject,
                        displaced.user_id
                    ],
                )?;
                if identity_retired != 1 {
                    return Err(auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    ));
                }
            }
            transaction.execute(
                "INSERT INTO _auth_identities(
                   id,user_id,kind,provider,subject,canonical_value,
                   created_at_ms,verified_at_ms
                 ) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",
                params![
                    plan.identity_id,
                    predecessor.acting_user_id,
                    plan.identifier_mode.identity_kind(),
                    plan.canonical_identifier,
                    now_ms
                ],
            )?;
            transaction.execute(
                "INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms)
                 VALUES(?1,?2,'password',?3)",
                params![credential_id, predecessor.acting_user_id, now_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_password_credentials(
                   credential_id,algorithm,hash_phc,policy_version,
                   common_password_list_version,changed_at_ms
                 ) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    credential_id,
                    password.algorithm(),
                    password.phc(),
                    PASSWORD_HASH_POLICY_V1.version,
                    PASSWORD_HASH_POLICY_V1.common_password_list_version,
                    now_ms
                ],
            )?;
            insert_recovery_set(
                transaction,
                &predecessor.acting_user_id,
                &recovery.key_id,
                &recovery.digests,
                "initial",
                now_ms,
            )?;
        }
        PasswordIssuanceOperation::GuestClaim {
            predecessor,
            credential_id,
            password,
            recovery,
        } => {
            transaction.execute(
                "INSERT INTO _auth_identities(
                   id,user_id,kind,provider,subject,canonical_value,
                   created_at_ms,verified_at_ms
                 ) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",
                params![
                    plan.identity_id,
                    predecessor.user_id,
                    plan.identifier_mode.identity_kind(),
                    plan.canonical_identifier,
                    now_ms
                ],
            )?;
            transaction.execute(
                "INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms)
                 VALUES(?1,?2,'password',?3)",
                params![credential_id, predecessor.user_id, now_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_password_credentials(
                   credential_id,algorithm,hash_phc,policy_version,
                   common_password_list_version,changed_at_ms
                 ) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    credential_id,
                    password.algorithm(),
                    password.phc(),
                    PASSWORD_HASH_POLICY_V1.version,
                    PASSWORD_HASH_POLICY_V1.common_password_list_version,
                    now_ms
                ],
            )?;
            insert_recovery_set(
                transaction,
                &predecessor.user_id,
                &recovery.key_id,
                &recovery.digests,
                "initial",
                now_ms,
            )?;
            let claimed = transaction.execute(
                "UPDATE _auth_users
                 SET guest_state='claimed',guest_expires_at_ms=NULL,
                     guest_claimed_at_ms=?2
                 WHERE id=?1 AND guest_state='active'",
                params![predecessor.user_id, now_ms],
            )?;
            if claimed != 1 {
                return Err(auth_error(
                    "INTERNAL_AUTH_STATE",
                    "authentication state invariant failed",
                ));
            }
        }
        PasswordIssuanceOperation::RecoveryConsume {
            predecessor,
            successor_credential_id,
            successor_recovery,
        } => {
            let consumed = transaction.execute(
                "UPDATE _auth_recovery_codes SET consumed_at_ms=?4
                 WHERE set_credential_id=?1 AND ordinal=?2 AND code_digest=?3
                   AND consumed_at_ms IS NULL",
                params![
                    predecessor.set_credential_id,
                    predecessor.ordinal,
                    predecessor.digest.as_slice(),
                    now_ms
                ],
            )?;
            if consumed != 1 {
                return Err(auth_error(
                    "INTERNAL_AUTH_STATE",
                    "authentication state invariant failed",
                ));
            }
            insert_recovery_set_with_id(
                transaction,
                &predecessor.user_id,
                successor_credential_id,
                &successor_recovery.key_id,
                &successor_recovery.digests,
                "after-use",
                now_ms,
            )?;
        }
        PasswordIssuanceOperation::RecoveryRotate {
            predecessor,
            successor_credential_id,
            successor_recovery,
        } => {
            insert_recovery_set_with_id(
                transaction,
                &predecessor.credential.user_id,
                successor_credential_id,
                &successor_recovery.key_id,
                &successor_recovery.digests,
                "suspected-disclosure",
                now_ms,
            )?;
        }
        PasswordIssuanceOperation::Reset {
            credential,
            replacement,
            ..
        } => {
            let changed = transaction.execute(
                "UPDATE _auth_password_credentials
                 SET algorithm=?2,hash_phc=?3,policy_version=?4,
                     common_password_list_version=?5,changed_at_ms=?6
                 WHERE credential_id=?1 AND hash_phc=?7",
                params![
                    credential.credential_id,
                    replacement.algorithm(),
                    replacement.phc(),
                    PASSWORD_HASH_POLICY_V1.version,
                    PASSWORD_HASH_POLICY_V1.common_password_list_version,
                    now_ms,
                    credential.hash_phc,
                ],
            )?;
            let generation_changed = transaction.execute(
                "UPDATE _auth_credentials SET generation=generation+1,last_used_at_ms=?2
                 WHERE id=?1 AND generation=?3 AND revoked_at_ms IS NULL",
                params![credential.credential_id, now_ms, credential.generation],
            )?;
            if changed != 1 || generation_changed != 1 {
                return Err(auth_error(
                    "INTERNAL_AUTH_STATE",
                    "authentication state invariant failed",
                ));
            }
            transaction.execute(
                "DELETE FROM _auth_password_attempts WHERE address=?1",
                [&plan.canonical_identifier],
            )?;
        }
    }
    Ok(())
}

pub(crate) fn finish_password_session_in(
    transaction: &Transaction<'_>,
    plan: &PasswordIssuanceCommitPlan,
    session_id: &str,
    now_ms: u64,
) -> SnapbackResult<()> {
    let credential_id = match &plan.operation {
        PasswordIssuanceOperation::Register { credential_id, .. } => credential_id,
        PasswordIssuanceOperation::Authenticate {
            credential: Some(credential),
            ..
        } => &credential.credential_id,
        PasswordIssuanceOperation::Authenticate {
            credential: None, ..
        } => {
            return Err(auth_error(
                "INTERNAL_AUTH_STATE",
                "authentication state invariant failed",
            ));
        }
        PasswordIssuanceOperation::Set { credential_id, .. } => credential_id,
        PasswordIssuanceOperation::GuestClaim { credential_id, .. } => credential_id,
        PasswordIssuanceOperation::RecoveryConsume {
            successor_credential_id,
            ..
        } => successor_credential_id,
        PasswordIssuanceOperation::RecoveryRotate { predecessor, .. } => {
            &predecessor.credential.credential_id
        }
        PasswordIssuanceOperation::Reset { credential, .. } => &credential.credential_id,
    };
    insert_assurance(
        transaction,
        &plan.user_id,
        session_id,
        Some(credential_id.as_str()),
        "authenticated",
        now_ms,
        Some(now_ms + SESSION_IDLE_MS),
    )?;
    insert_assurance(
        transaction,
        &plan.user_id,
        session_id,
        Some(credential_id.as_str()),
        "recent_auth",
        now_ms,
        Some(now_ms + 10 * 60 * 1_000),
    )?;
    journal(
        transaction,
        &plan.user_id,
        match plan.operation {
            PasswordIssuanceOperation::Register { .. } => "password.account-created",
            PasswordIssuanceOperation::Authenticate { .. } => "password.authenticated",
            PasswordIssuanceOperation::Set { .. } => "password.set",
            PasswordIssuanceOperation::GuestClaim { .. } => "guest.claimed",
            PasswordIssuanceOperation::RecoveryConsume { .. } => "recovery-code.used",
            PasswordIssuanceOperation::RecoveryRotate { .. } => "recovery-codes.rotated",
            PasswordIssuanceOperation::Reset { .. } => "password.reset",
        },
        now_ms,
    )?;
    Ok(())
}

pub(crate) fn password_attempt_matches_on(
    connection: &rusqlite::Connection,
    canonical_identifier: &str,
    expected: &PasswordAttemptState,
) -> SnapbackResult<bool> {
    Ok(read_password_attempt_on(connection, canonical_identifier)?.as_ref() == Some(expected))
}

pub(crate) fn password_issuance_is_exact_predecessor_on(
    connection: &rusqlite::Connection,
    plan: &PasswordIssuanceCommitPlan,
) -> SnapbackResult<bool> {
    match &plan.operation {
        PasswordIssuanceOperation::Register { credential_id, .. } => {
            let collisions: bool = connection.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _auth_identities
                   WHERE subject=?1 AND disabled_at_ms IS NULL
                 ) OR EXISTS(SELECT 1 FROM _auth_users WHERE id=?2)
                   OR EXISTS(SELECT 1 FROM _auth_identities WHERE id=?3)
                   OR EXISTS(SELECT 1 FROM _auth_credentials WHERE id=?4)",
                params![
                    plan.canonical_identifier,
                    plan.user_id,
                    plan.identity_id,
                    credential_id
                ],
                |row| row.get(0),
            )?;
            Ok(!collisions)
        }
        PasswordIssuanceOperation::Authenticate { credential, .. } => Ok(password_snapshot_on(
            connection,
            &plan.canonical_identifier,
            plan.identifier_mode,
        )? == *credential),
        PasswordIssuanceOperation::Set {
            predecessor,
            displaced,
            credential_id,
            ..
        } => {
            let acting: Option<(String, i64, Vec<u8>)> = connection
                .query_row(
                    "SELECT user_id,generation,token_hash FROM _auth_sessions
                     WHERE id=?1 AND revoked_at_ms IS NULL",
                    [&predecessor.acting_session_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let actor_matches = acting.is_some_and(|(user, generation, digest)| {
                user == predecessor.acting_user_id
                    && u64::try_from(generation).ok() == Some(predecessor.acting_generation)
                    && digest.as_slice() == predecessor.acting_token_digest.as_bytes().as_slice()
            });
            let candidate_exists: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_identities WHERE id=?1)
                     OR EXISTS(SELECT 1 FROM _auth_credentials WHERE id=?2)",
                params![plan.identity_id, credential_id],
                |row| row.get(0),
            )?;
            let displaced_matches = match displaced {
                Some(displaced) => connection.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _auth_identities i
                       JOIN _auth_credentials c ON c.user_id=i.user_id
                       WHERE i.id=?1 AND i.user_id=?2 AND i.subject=?3
                         AND i.disabled_at_ms IS NULL
                         AND c.id=?4 AND c.generation=?5
                         AND c.revoked_at_ms IS NULL
                     )",
                    params![
                        displaced.identity_id,
                        displaced.user_id,
                        plan.canonical_identifier,
                        displaced.credential_id,
                        displaced.credential_generation,
                    ],
                    |row| row.get(0),
                )?,
                None => !connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM _auth_identities
                     WHERE provider='local-password' AND subject=?1
                       AND disabled_at_ms IS NULL)",
                    [&plan.canonical_identifier],
                    |row| row.get::<_, bool>(0),
                )?,
            };
            Ok(actor_matches && !candidate_exists && displaced_matches)
        }
        PasswordIssuanceOperation::GuestClaim {
            predecessor,
            credential_id,
            ..
        } => {
            let exact: bool = connection.query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM _auth_sessions s
                   JOIN _auth_users u ON u.id=s.user_id
                   WHERE s.id=?1 AND s.user_id=?2 AND s.generation=?3
                     AND s.token_hash=?4 AND s.revoked_at_ms IS NULL
                     AND s.authn_source='guest' AND u.guest_state='active'
                 )",
                params![
                    predecessor.session_id,
                    predecessor.user_id,
                    predecessor.generation,
                    predecessor.token_digest.as_bytes().as_slice(),
                ],
                |row| row.get(0),
            )?;
            let candidates_exist: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_identities WHERE id=?1)
                     OR EXISTS(SELECT 1 FROM _auth_credentials WHERE id=?2)",
                params![plan.identity_id, credential_id],
                |row| row.get(0),
            )?;
            Ok(exact && !candidates_exist)
        }
        PasswordIssuanceOperation::RecoveryConsume { predecessor, .. } => connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_recovery_codes
                 WHERE set_credential_id=?1 AND ordinal=?2 AND code_digest=?3
                   AND consumed_at_ms IS NULL)",
                params![
                    predecessor.set_credential_id,
                    predecessor.ordinal,
                    predecessor.digest.as_slice(),
                ],
                |row| row.get(0),
            )
            .map_err(Into::into),
        PasswordIssuanceOperation::RecoveryRotate { predecessor, .. } => {
            let session_exact: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_sessions
                 WHERE id=?1 AND user_id=?2 AND generation=?3 AND token_hash=?4
                   AND revoked_at_ms IS NULL)",
                params![
                    predecessor.acting_session_id,
                    predecessor.credential.user_id,
                    predecessor.acting_generation,
                    predecessor.acting_token_digest.as_bytes().as_slice(),
                ],
                |row| row.get(0),
            )?;
            Ok(session_exact
                && password_snapshot_on(
                    connection,
                    &plan.canonical_identifier,
                    plan.identifier_mode,
                )?
                .as_ref()
                    == Some(&predecessor.credential))
        }
        PasswordIssuanceOperation::Reset {
            email_identity_id,
            credential,
            ..
        } => {
            let email_exact: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_identities
                 WHERE id=?1 AND user_id=?2 AND provider='email-code'
                   AND subject=?3 AND disabled_at_ms IS NULL)",
                params![
                    email_identity_id,
                    credential.user_id,
                    plan.canonical_identifier,
                ],
                |row| row.get(0),
            )?;
            Ok(email_exact
                && password_snapshot_on(
                    connection,
                    &plan.canonical_identifier,
                    plan.identifier_mode,
                )?
                .as_ref()
                    == Some(credential))
        }
    }
}

pub(crate) fn password_issuance_is_exact_successor_on(
    connection: &rusqlite::Connection,
    plan: &PasswordIssuanceCommitPlan,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let identity: Option<(String, String, String, i64)> = connection
        .query_row(
            "SELECT id,user_id,provider,verified_at_ms
             FROM _auth_identities
             WHERE id=?1 AND subject=?2 AND disabled_at_ms IS NULL",
            params![plan.identity_id, plan.canonical_identifier],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    if !identity.is_some_and(|(identity_id, user_id, provider, _)| {
        identity_id == plan.identity_id && user_id == plan.user_id && provider == "local-password"
    }) {
        return Ok(false);
    }
    match &plan.operation {
        PasswordIssuanceOperation::Register {
            credential_id,
            password,
            ..
        } => {
            let credential: Option<(String, i64, String, String)> = connection
                .query_row(
                    "SELECT c.user_id,c.generation,p.algorithm,p.hash_phc
                     FROM _auth_credentials c
                     JOIN _auth_password_credentials p ON p.credential_id=c.id
                     WHERE c.id=?1 AND c.revoked_at_ms IS NULL",
                    [credential_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            Ok(
                credential.is_some_and(|(user, generation, algorithm, phc)| {
                    user == plan.user_id
                        && generation == 1
                        && algorithm == password.algorithm()
                        && phc == password.phc()
                }),
            )
        }
        PasswordIssuanceOperation::Authenticate {
            credential: Some(predecessor),
            replacement,
            ..
        } => {
            let durable: Option<(i64, String, Option<i64>)> = connection
                .query_row(
                    "SELECT c.generation,p.hash_phc,c.last_used_at_ms
                     FROM _auth_credentials c
                     JOIN _auth_password_credentials p ON p.credential_id=c.id
                     WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL",
                    params![predecessor.credential_id, predecessor.user_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let matches = durable.is_some_and(|(generation, phc, last_used)| {
                let expected_generation = predecessor.generation + u64::from(replacement.is_some());
                u64::try_from(generation).ok() == Some(expected_generation)
                    && phc
                        == replacement
                            .as_ref()
                            .map_or(predecessor.hash_phc.as_str(), PreparedPasswordHash::phc)
                    && last_used.and_then(|value| u64::try_from(value).ok()) == Some(now_ms)
            });
            Ok(matches
                && read_password_attempt_on(connection, &plan.canonical_identifier)?.is_none())
        }
        PasswordIssuanceOperation::Authenticate {
            credential: None, ..
        } => Ok(false),
        PasswordIssuanceOperation::Set {
            displaced,
            credential_id,
            password,
            ..
        } => {
            let credential: Option<(String, i64, String)> = connection
                .query_row(
                    "SELECT c.user_id,c.generation,p.hash_phc
                     FROM _auth_credentials c
                     JOIN _auth_password_credentials p ON p.credential_id=c.id
                     WHERE c.id=?1 AND c.revoked_at_ms IS NULL",
                    [credential_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            let new_matches = credential.is_some_and(|(user, generation, phc)| {
                user == plan.user_id && generation == 1 && phc == password.phc()
            });
            let displaced_retired = match displaced {
                Some(displaced) => connection.query_row(
                    "SELECT EXISTS(
                       SELECT 1 FROM _auth_identities i
                       JOIN _auth_credentials c ON c.id=?2
                       WHERE i.id=?1 AND i.disabled_at_ms=?3
                         AND c.revoked_at_ms=?3
                     )",
                    params![displaced.identity_id, displaced.credential_id, now_ms],
                    |row| row.get(0),
                )?,
                None => true,
            };
            Ok(new_matches && displaced_retired)
        }
        PasswordIssuanceOperation::GuestClaim {
            credential_id,
            password,
            predecessor,
            ..
        } => {
            let durable: Option<(String, i64, String, String)> = connection
                .query_row(
                    "SELECT c.user_id,c.generation,p.hash_phc,u.guest_state
                     FROM _auth_credentials c
                     JOIN _auth_password_credentials p ON p.credential_id=c.id
                     JOIN _auth_users u ON u.id=c.user_id
                     WHERE c.id=?1 AND c.revoked_at_ms IS NULL",
                    [credential_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            Ok(durable.is_some_and(|(user, generation, phc, guest_state)| {
                user == predecessor.user_id
                    && generation == 1
                    && phc == password.phc()
                    && guest_state == "claimed"
            }))
        }
        PasswordIssuanceOperation::RecoveryConsume {
            predecessor,
            successor_credential_id,
            ..
        } => {
            let consumed: Option<Option<i64>> = connection
                .query_row(
                    "SELECT consumed_at_ms FROM _auth_recovery_codes
                     WHERE set_credential_id=?1 AND ordinal=?2 AND code_digest=?3",
                    params![
                        predecessor.set_credential_id,
                        predecessor.ordinal,
                        predecessor.digest.as_slice(),
                    ],
                    |row| row.get(0),
                )
                .optional()?;
            let successor_live: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_credentials c
                 JOIN _auth_recovery_code_sets s ON s.credential_id=c.id
                 WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL
                   AND s.replaced_at_ms IS NULL)",
                params![successor_credential_id, predecessor.user_id],
                |row| row.get(0),
            )?;
            Ok(consumed
                .flatten()
                .and_then(|value| u64::try_from(value).ok())
                == Some(now_ms)
                && successor_live)
        }
        PasswordIssuanceOperation::RecoveryRotate {
            predecessor,
            successor_credential_id,
            ..
        } => connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_credentials c
                 JOIN _auth_recovery_code_sets s ON s.credential_id=c.id
                 WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL
                   AND s.replaced_at_ms IS NULL)",
                params![successor_credential_id, predecessor.credential.user_id],
                |row| row.get(0),
            )
            .map_err(Into::into),
        PasswordIssuanceOperation::Reset {
            credential,
            replacement,
            ..
        } => {
            let durable: Option<(i64, String, Option<i64>)> = connection
                .query_row(
                    "SELECT c.generation,p.hash_phc,c.last_used_at_ms
                     FROM _auth_credentials c
                     JOIN _auth_password_credentials p ON p.credential_id=c.id
                     WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL",
                    params![credential.credential_id, credential.user_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;
            Ok(durable.is_some_and(|(generation, phc, last_used)| {
                u64::try_from(generation).ok() == credential.generation.checked_add(1)
                    && phc == replacement.phc()
                    && last_used.and_then(|value| u64::try_from(value).ok()) == Some(now_ms)
            }) && read_password_attempt_on(connection, &plan.canonical_identifier)?.is_none())
        }
    }
}

pub(crate) fn admit_password_change_in(
    transaction: &Transaction<'_>,
    plan: &PasswordChangeCommitPlan,
    now_ms: u64,
    profile: PasswordSecurityProfile,
) -> SnapbackResult<PasswordIssuanceAdmission> {
    let durable = password_snapshot_on(
        transaction,
        &plan.canonical_identifier,
        plan.credential.identifier_mode,
    )?;
    if durable.as_ref() != Some(&plan.credential) {
        return Ok(PasswordIssuanceAdmission::Invalid {
            committed_attempt: None,
        });
    }
    let ledger = read_password_attempt_on(transaction, &plan.canonical_identifier)?;
    let normalized = normalize_attempt_window(ledger.clone(), now_ms, profile);
    if normalized
        .locked_until_ms
        .is_some_and(|until| now_ms < until)
    {
        return Ok(PasswordIssuanceAdmission::Invalid {
            committed_attempt: None,
        });
    }
    if !plan.verified {
        return match record_password_failure_in(
            transaction,
            &plan.canonical_identifier,
            ledger,
            now_ms,
            profile,
        )? {
            Ok(committed_attempt) => Ok(PasswordIssuanceAdmission::Invalid {
                committed_attempt: Some(committed_attempt),
            }),
            Err(()) => Ok(PasswordIssuanceAdmission::LedgerCapacityExhausted),
        };
    }
    Ok(PasswordIssuanceAdmission::Proceed {
        create_principal: false,
    })
}

pub(crate) fn apply_password_change_in(
    transaction: &Transaction<'_>,
    plan: &PasswordChangeCommitPlan,
    now_ms: u64,
) -> SnapbackResult<()> {
    let changed = transaction.execute(
        "UPDATE _auth_password_credentials
         SET algorithm=?2,hash_phc=?3,policy_version=?4,
             common_password_list_version=?5,changed_at_ms=?6
         WHERE credential_id=?1 AND hash_phc=?7",
        params![
            plan.credential.credential_id,
            plan.replacement.algorithm(),
            plan.replacement.phc(),
            PASSWORD_HASH_POLICY_V1.version,
            PASSWORD_HASH_POLICY_V1.common_password_list_version,
            now_ms,
            plan.credential.hash_phc,
        ],
    )?;
    let generation_changed = transaction.execute(
        "UPDATE _auth_credentials
         SET generation=generation+1,last_used_at_ms=?2
         WHERE id=?1 AND generation=?3 AND revoked_at_ms IS NULL",
        params![
            plan.credential.credential_id,
            now_ms,
            plan.credential.generation,
        ],
    )?;
    if changed != 1 || generation_changed != 1 {
        return Err(auth_error(
            "INTERNAL_AUTH_STATE",
            "authentication state invariant failed",
        ));
    }
    transaction.execute(
        "DELETE FROM _auth_password_attempts WHERE address=?1",
        [&plan.canonical_identifier],
    )?;
    journal(
        transaction,
        &plan.credential.user_id,
        "password.changed",
        now_ms,
    )?;
    Ok(())
}

pub(crate) fn password_change_is_exact_predecessor_on(
    connection: &rusqlite::Connection,
    plan: &PasswordChangeCommitPlan,
) -> SnapbackResult<bool> {
    Ok(password_snapshot_on(
        connection,
        &plan.canonical_identifier,
        plan.credential.identifier_mode,
    )?
    .as_ref()
        == Some(&plan.credential))
}

pub(crate) fn password_change_is_exact_successor_on(
    connection: &rusqlite::Connection,
    plan: &PasswordChangeCommitPlan,
    now_ms: u64,
) -> SnapbackResult<bool> {
    let durable: Option<(i64, String, Option<i64>)> = connection
        .query_row(
            "SELECT c.generation,p.hash_phc,c.last_used_at_ms
             FROM _auth_credentials c
             JOIN _auth_password_credentials p ON p.credential_id=c.id
             WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL",
            params![plan.credential.credential_id, plan.credential.user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    Ok(durable.is_some_and(|(generation, phc, last_used)| {
        u64::try_from(generation).ok() == plan.credential.generation.checked_add(1)
            && phc == plan.replacement.phc()
            && last_used.and_then(|value| u64::try_from(value).ok()) == Some(now_ms)
    }) && read_password_attempt_on(connection, &plan.canonical_identifier)?.is_none())
}

impl LocalDatabase {
    pub(crate) fn password_attempt_matches(
        &self,
        canonical_identifier: &str,
        expected: &PasswordAttemptState,
    ) -> SnapbackResult<bool> {
        self.with_auth_read(|connection| {
            password_attempt_matches_on(connection, canonical_identifier, expected)
        })
    }

    pub(crate) fn password_set_planning(
        &self,
        acting: &SessionBearer,
        email_identity_id: &str,
        canonical_identifier: &str,
        now_ms: u64,
    ) -> SnapbackResult<PasswordSetPlanning> {
        self.with_auth_read(|connection| {
            let mode = super::auth::require_password_identifier_mode_on(connection)?;
            if mode != PasswordIdentifierMode::EmailV1 {
                return Err(auth_error(
                    "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID",
                    "password identifier does not satisfy the declared mode",
                ));
            }
            let acting_row: Option<(String, String, i64, Vec<u8>)> = connection
                .query_row(
                    "SELECT s.id,s.user_id,s.generation,s.token_hash
                     FROM _auth_sessions s
                     JOIN _auth_users u ON u.id=s.user_id
                     WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL
                       AND ?2<s.expires_at_ms AND u.deactivated_at_ms IS NULL",
                    params![acting.token_hash().as_bytes().as_slice(), now_ms],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            let (acting_session_id, acting_user_id, acting_generation, acting_digest) = acting_row
                .ok_or_else(|| auth_error("SNAPBACK_AUTH_SESSION_INVALID", "session is invalid"))?;
            let target: Option<(String, String)> = connection
                .query_row(
                    "SELECT user_id,subject FROM _auth_identities
                     WHERE id=?1 AND provider='email-code' AND disabled_at_ms IS NULL",
                    [email_identity_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if target != Some((acting_user_id.clone(), canonical_identifier.to_owned())) {
                return Err(auth_error(
                    "SNAPBACK_AUTH_PASSWORD_SET_AUTHORITY_INVALID",
                    "password set authority is invalid",
                ));
            }
            let displaced = connection
                .query_row(
                    "SELECT i.id,i.user_id,c.id,c.generation
                     FROM _auth_identities i
                     JOIN _auth_credentials c
                       ON c.user_id=i.user_id
                      AND c.kind='password'
                      AND c.revoked_at_ms IS NULL
                     WHERE i.provider='local-password' AND i.subject=?1
                       AND i.disabled_at_ms IS NULL",
                    [canonical_identifier],
                    |row| {
                        Ok(DisplacedPasswordPredecessor {
                            identity_id: row.get(0)?,
                            user_id: row.get(1)?,
                            credential_id: row.get(2)?,
                            credential_generation: row.get(3)?,
                        })
                    },
                )
                .optional()?;
            Ok(PasswordSetPlanning {
                predecessor: PasswordSetPredecessor {
                    acting_session_id,
                    acting_user_id,
                    acting_generation: u64::try_from(acting_generation).map_err(|_| {
                        auth_error(
                            "INTERNAL_AUTH_STATE",
                            "authentication state invariant failed",
                        )
                    })?,
                    acting_token_digest: crate::contract_types::TokenDigest::from_slice(
                        &acting_digest,
                    )
                    .map_err(|_| {
                        auth_error(
                            "INTERNAL_AUTH_STATE",
                            "authentication state invariant failed",
                        )
                    })?,
                    email_identity_id: email_identity_id.to_owned(),
                },
                displaced,
            })
        })
    }

    pub(crate) fn password_change_planning(
        &self,
        acting: &SessionBearer,
        now_ms: u64,
    ) -> SnapbackResult<PasswordChangePlanning> {
        self.with_auth_read(|connection| {
            let mode = super::auth::require_password_identifier_mode_on(connection)?;
            let row: Option<(String, String, String, i64, Vec<u8>, String)> = connection
                .query_row(
                    "SELECT s.id,s.user_id,s.identity_id,s.generation,s.token_hash,
                            s.authority_instance_id
                     FROM _auth_sessions s
                     JOIN _auth_identities i ON i.id=s.identity_id
                     JOIN _auth_users u ON u.id=s.user_id
                     WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL
                       AND ?2<s.expires_at_ms
                       AND i.provider='local-password'
                       AND i.disabled_at_ms IS NULL
                       AND u.deactivated_at_ms IS NULL",
                    params![acting.token_hash().as_bytes().as_slice(), now_ms],
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
            let (session_id, user_id, identity_id, generation, token_digest, authority) = row
                .ok_or_else(|| auth_error("SNAPBACK_AUTH_SESSION_INVALID", "session is invalid"))?;
            let (canonical_identifier, credential_id, credential_generation, hash_phc): (
                String,
                String,
                i64,
                String,
            ) = connection.query_row(
                "SELECT i.subject,c.id,c.generation,p.hash_phc
                 FROM _auth_identities i
                 JOIN _auth_credentials c
                   ON c.user_id=i.user_id
                  AND c.kind='password'
                  AND c.revoked_at_ms IS NULL
                 JOIN _auth_password_credentials p ON p.credential_id=c.id
                 WHERE i.id=?1 AND i.user_id=?2",
                params![identity_id, user_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )?;
            let sender_constrained =
                crate::auth::sender_proof::presented_token_has_sender_family_binding(
                    connection,
                    acting.token_hash().as_bytes(),
                )
                .map_err(|_| {
                    auth_error(
                        "SNAPBACK_AUTH_PROVIDER_UNAVAILABLE",
                        "authentication provider is unavailable",
                    )
                })?;
            Ok(PasswordChangePlanning {
                credential: PasswordSnapshot {
                    user_id,
                    identity_id,
                    credential_id,
                    generation: u64::try_from(credential_generation).map_err(|_| {
                        auth_error(
                            "INTERNAL_AUTH_STATE",
                            "authentication state invariant failed",
                        )
                    })?,
                    hash_phc,
                    identifier_mode: mode,
                },
                canonical_identifier,
                acting_session_id: session_id,
                acting_generation: u64::try_from(generation).map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
                acting_token_digest: crate::contract_types::TokenDigest::from_slice(
                    &token_digest,
                )
                .map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
                authority_instance_id: authority,
                sender_constrained,
            })
        })
    }

    pub(crate) fn guest_claim_predecessor(
        &self,
        guest: &SessionBearer,
        now_ms: u64,
    ) -> SnapbackResult<GuestClaimPredecessor> {
        self.with_auth_read(|connection| {
            let row: Option<(String, String, i64, Vec<u8>)> = connection
                .query_row(
                    "SELECT s.id,s.user_id,s.generation,s.token_hash
                     FROM _auth_sessions s
                     JOIN _auth_users u ON u.id=s.user_id
                     WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL
                       AND ?2<s.expires_at_ms AND s.authn_source='guest'
                       AND u.guest_state='active'",
                    params![guest.token_hash().as_bytes().as_slice(), now_ms],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                )
                .optional()?;
            let (session_id, user_id, generation, digest) = row.ok_or_else(|| {
                auth_error(
                    "SNAPBACK_AUTH_GUEST_SESSION_INVALID",
                    "guest session is invalid",
                )
            })?;
            Ok(GuestClaimPredecessor {
                session_id,
                user_id,
                generation: u64::try_from(generation).map_err(|_| {
                    auth_error(
                        "INTERNAL_AUTH_STATE",
                        "authentication state invariant failed",
                    )
                })?,
                token_digest: crate::contract_types::TokenDigest::from_slice(&digest)
                    .map_err(|_| {
                        auth_error(
                            "INTERNAL_AUTH_STATE",
                            "authentication state invariant failed",
                        )
                    })?,
            })
        })
    }

    pub(crate) fn recovery_code_predecessor(
        &self,
        identifier: &str,
        code: &str,
        key_id: &str,
        key: &[u8; 32],
    ) -> SnapbackResult<RecoveryCodePredecessor> {
        let mode = self.auth_password_identifier_mode()?;
        let canonical = canonical_password_identifier_value(mode, identifier)?;
        let digest = recovery_digest(key, code);
        let candidates = self.with_auth_read(|connection| {
            let mut statement = connection.prepare(
                "SELECT i.user_id,i.id,r.set_credential_id,r.ordinal,r.code_digest
                 FROM _auth_identities i
                 JOIN _auth_credentials c
                   ON c.user_id=i.user_id
                  AND c.kind='recovery-code-set'
                  AND c.revoked_at_ms IS NULL
                 JOIN _auth_recovery_codes r ON r.set_credential_id=c.id
                 JOIN _auth_recovery_code_sets s
                   ON s.credential_id=c.id AND s.replaced_at_ms IS NULL
                 WHERE i.provider='local-password' AND i.subject=?1
                   AND i.disabled_at_ms IS NULL
                   AND r.key_id=?2 AND r.consumed_at_ms IS NULL
                 ORDER BY r.ordinal",
            )?;
            statement
                .query_map(params![canonical, key_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, u64>(3)?,
                        row.get::<_, Vec<u8>>(4)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()
                .map_err(Into::into)
        })?;
        let mut matched = None;
        let mut compared = false;
        for (user_id, identity_id, set_credential_id, ordinal, stored) in candidates {
            compared = true;
            let candidate = <[u8; 32]>::try_from(stored.as_slice()).unwrap_or([0; 32]);
            if bool::from(candidate.ct_eq(&digest)) {
                matched = Some(RecoveryCodePredecessor {
                    user_id,
                    identity_id,
                    set_credential_id,
                    ordinal,
                    digest,
                });
            }
        }
        if !compared {
            let _ = bool::from(<[u8; 32]>::default().ct_eq(&digest));
        }
        matched.ok_or_else(|| {
            auth_error(
                "SNAPBACK_AUTH_RECOVERY_CODE_INVALID",
                "recovery code is invalid",
            )
        })
    }

    /// @ref LLP 0214#53-sealed-invocation-authority — declared app inserts and the
    /// protected idempotency receipt commit in one host-only transaction.
    pub(crate) fn execute_verified_provisioning(
        &mut self,
        authority: &VerifiedProvisioningAuthority,
        inserts: &[ProvisioningInsert],
        now: u64,
    ) -> SnapbackResult<ProvisioningOutcome> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            if let Some(existing)=tx.query_row("SELECT hook_digest FROM _auth_provisioning_receipts WHERE provisioning_key=?1",[&authority.provisioning_key],|r|r.get::<_,Vec<u8>>(0)).optional()?{
                if existing.as_slice()==authority.hook_digest{return Ok(ProvisioningOutcome::AlreadyCommitted);}
                return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH","provisioning key was already used by a different hook digest"));
            }
            for insert in inserts{
                if !authority.declared_writes.contains(&insert.table){return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN","provisioning attempted an undeclared table"));}
                let table=quoted_identifier(&insert.table)?; if insert.columns.is_empty(){return Err(auth_error("SNAPBACK_AUTH_PROVISIONING_WRITE_FORBIDDEN","provisioning insert has no declared columns"));}
                let columns=insert.columns.iter().map(|(name,_)|quoted_identifier(name)).collect::<SnapbackResult<Vec<_>>>()?;
                let binds=(1..=columns.len()).map(|n|format!("?{n}")).collect::<Vec<_>>().join(",");
                let sql=format!("INSERT INTO {table}({}) VALUES({binds})",columns.join(","));
                tx.execute(&sql,rusqlite::params_from_iter(insert.columns.iter().map(|(_,value)|value)))?;
            }
            let app_commit_version=super::current_version_on(tx)?;
            tx.execute("INSERT INTO _auth_provisioning_receipts(provisioning_key,hook_id,hook_digest,user_id,identity_id,assurance_id,committed_at_ms,app_commit_version) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![authority.provisioning_key,authority.hook_id,authority.hook_digest.as_slice(),authority.user_id,authority.identity_id,authority.assurance_id,now,app_commit_version])?;
            journal(tx,&authority.user_id,"identity.provisioned",now)?;
            Ok(ProvisioningOutcome::Committed)
        })
    }
    /// @ref LLP 0214#81-guest-principal-and-session-creation — no caller-selected
    /// principal enters this atomic guest/session/assurance transition.
    pub(crate) fn identity_guest_create(
        &mut self,
        expires_at: u64,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let user = opaque_id("user");
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            tx.execute("INSERT INTO _auth_users(id,created_at_ms,kind,guest_state,guest_expires_at_ms) VALUES(?1,?2,'human','active',?3)", params![user, now, expires_at])?;
            let (session, bearer) = insert_session(tx, &user, None, None, "guest", now, random)?;
            insert_assurance(tx, &user, &session, None, "authenticated", now, Some(expires_at))?;
            journal(tx, &user, "guest.created", now)?;
            Ok(IdentitySession { user_id: user, session_id: session, bearer, recovery_codes: None })
        })
    }

    pub(crate) fn identity_guest_claim_verified_email(
        &mut self,
        guest: &SessionBearer,
        proof: &VerifiedEmailClaim,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            let user:Option<String>=tx.query_row("SELECT s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.authn_source='guest' AND u.guest_state='active'",[guest.token_hash().as_bytes().as_slice()],|r|r.get(0)).optional()?;
            let user=user.ok_or_else(||auth_error("SNAPBACK_AUTH_GUEST_SESSION_INVALID","guest session is invalid"))?;
            if tx.query_row("SELECT user_id FROM _auth_identities WHERE provider='email-code' AND subject=?1",[proof.canonical.as_str()],|r|r.get::<_,String>(0)).optional()?.is_some_and(|owner|owner!=user){return Err(auth_error("SNAPBACK_AUTH_GUEST_CLAIM_COLLISION","guest claim collides with an existing principal"));}
            let identity=opaque_id("identity");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,'email','email-code',?3,?3,?4,?4)",params![identity,user,proof.canonical.as_str(),now])?;
            tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=?2 WHERE id=?1 AND guest_state='active'",params![user,now])?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;
            let(session,bearer)=insert_session(tx,&user,Some(&identity),None,"identity",now,random)?;
            insert_assurance(tx,&user,&session,None,"authenticated",now,Some(now+SESSION_IDLE_MS))?;
            tx.execute("INSERT INTO _auth_assurances(id,user_id,session_id,identity_id,credential_id,kind,provenance,issued_at_ms,expires_at_ms,governing_authority,revoked_at_ms) VALUES(?1,?2,?3,?4,NULL,'email_verified','delivery',?5,NULL,?6,NULL)",params![opaque_id("assurance"),user,session,identity,now,proof.governing_authority])?;
            journal(tx,&user,"guest.claimed",now)?; let _=&proof.event_id;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:None})
        })
    }

    /// Local-password claiming preserves the guest user id and refuses an
    /// existing username without merging or switching principals.
    #[cfg(test)]
    pub(crate) fn identity_guest_claim_password(
        &mut self,
        guest: &SessionBearer,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        recovery: RecoveryKeyMaterial<'_>,
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?; // intentionally outside writer lock
        let (codes, digests) = generate_recovery(random, recovery.key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            let row: Option<(String,String)> = tx.query_row("SELECT s.id,s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.authn_source='guest' AND u.guest_state='active'", [guest.token_hash().as_bytes().as_slice()], |r| Ok((r.get(0)?,r.get(1)?))).optional()?;
            let (old_session, user) = row.ok_or_else(|| auth_error("SNAPBACK_AUTH_GUEST_SESSION_INVALID", "guest session is invalid"))?;
            if tx.query_row("SELECT 1 FROM _auth_identities WHERE provider='local-password' AND subject=?1", [&identifier.canonical], |_| Ok(())).optional()?.is_some() { return Err(auth_error("SNAPBACK_AUTH_GUEST_CLAIM_COLLISION", "guest claim collides with an existing principal")); }
            let identity = opaque_id("identity"); let credential = opaque_id("credential");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)", params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)", params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials(credential_id,algorithm,hash_phc,policy_version,common_password_list_version,changed_at_ms) VALUES(?1,'argon2id',?2,?3,?4,?5)", params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx, &user, recovery.key_id, &digests, "initial", now)?;
            tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=?2 WHERE id=?1 AND guest_state='active'", params![user,now])?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL", params![user,now])?;
            let (session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?;
            insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+10*60*1_000))?;
            journal(tx,&user,"guest.claimed",now)?; let _=old_session;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    #[cfg(test)]
    pub(crate) fn identity_password_register(
        &mut self,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        recovery_key: &[u8; 32],
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?;
        let (codes, digests) = generate_recovery(random, recovery_key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            if tx.query_row("SELECT 1 FROM _auth_identities WHERE provider='local-password' AND subject=?1",[&identifier.canonical], |_| Ok(())).optional()?.is_some(){return Err(auth_error("SNAPBACK_AUTH_IDENTITY_COLLISION","identity already exists"));}
            let user=opaque_id("user"); let identity=opaque_id("identity"); let credential=opaque_id("credential");
            tx.execute("INSERT INTO _auth_users(id,created_at_ms,kind,guest_state) VALUES(?1,?2,'human','never')",params![user,now])?;
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)",params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials VALUES(?1,'argon2id',?2,?3,?4,?5)",params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx,&user,key_id,&digests,"initial",now)?;
            let(session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?; insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+600_000))?; journal(tx,&user,"password.account-created",now)?; journal(tx,&user,"recovery-codes.issued",now)?;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    #[cfg(test)]
    pub(crate) fn identity_password_set(
        &mut self,
        acting: &SessionBearer,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
        recovery: RecoveryKeyMaterial<'_>,
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let phc = hash_password(password, random)?;
        let (codes, digests) = generate_recovery(random, recovery.key)?;
        self.with_auth_transaction(|tx| {
            super::auth::require_identity_core_v3_on(tx)?;
            require_same_password_identifier_mode(tx, identifier.mode)?;
            let user: String = tx.query_row(
                "SELECT s.user_id FROM _auth_sessions s JOIN _auth_users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.revoked_at_ms IS NULL AND s.expires_at_ms>?2 AND u.guest_state<>'active' AND u.deactivated_at_ms IS NULL",
                params![acting.token_hash().as_bytes().as_slice(), now],
                |row| row.get(0),
            ).map_err(|_| auth_error("SNAPBACK_AUTH_SESSION_INVALID", "session is invalid"))?;
            let collision = tx.query_row("SELECT user_id FROM _auth_identities WHERE provider='local-password' AND subject=?1", [&identifier.canonical], |row| row.get::<_,String>(0)).optional()?;
            if collision.is_some_and(|owner| owner != user) {
                return Err(auth_error("SNAPBACK_AUTH_IDENTITY_COLLISION", "identity already exists"));
            }
            let live: u64 = tx.query_row("SELECT COUNT(*) FROM _auth_credentials WHERE user_id=?1 AND kind='password' AND revoked_at_ms IS NULL", [&user], |row| row.get(0))?;
            if live != 0 { return Err(auth_error("SNAPBACK_AUTH_PASSWORD_ALREADY_SET", "principal already has a password")); }
            let identity=opaque_id("identity"); let credential=opaque_id("credential");
            tx.execute("INSERT INTO _auth_identities(id,user_id,kind,provider,subject,canonical_value,created_at_ms,verified_at_ms) VALUES(?1,?2,?3,'local-password',?4,?4,?5,?5)",params![identity,user,identifier.mode.identity_kind(),identifier.canonical,now])?;
            tx.execute("INSERT INTO _auth_credentials(id,user_id,kind,created_at_ms) VALUES(?1,?2,'password',?3)",params![credential,user,now])?;
            tx.execute("INSERT INTO _auth_password_credentials VALUES(?1,'argon2id',?2,?3,?4,?5)",params![credential,phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now])?;
            insert_recovery_set(tx,&user,recovery.key_id,&digests,"initial",now)?;
            tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;
            let(session,bearer)=insert_session(tx,&user,None,Some(&credential),"credential",now,random)?;
            insert_assurance(tx,&user,&session,Some(&credential),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&user,&session,Some(&credential),"recent_auth",now,Some(now+600_000))?; journal(tx,&user,"password.set",now)?;
            Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})
        })
    }

    pub(crate) fn identity_reap_guests_default_tombstone(
        &mut self,
        now: u64,
    ) -> SnapbackResult<u64> {
        self.with_auth_transaction(|tx|{
            super::auth::require_identity_core_v3_on(tx)?;
            let mut stmt=tx.prepare("SELECT id FROM _auth_users WHERE guest_state='active' AND guest_expires_at_ms<=?1 ORDER BY id")?;
            let users=stmt.query_map([now],|row|row.get::<_,String>(0))?.collect::<Result<Vec<_>,_>>()?; drop(stmt);
            for user in &users { tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?; tx.execute("UPDATE _auth_users SET guest_state='reaped',guest_expires_at_ms=NULL WHERE id=?1 AND guest_state='active'",[user])?; journal(tx,user,"guest.reaped",now)?; }
            Ok(users.len() as u64)
        })
    }

    pub(crate) fn password_snapshot(
        &self,
        username: &str,
    ) -> SnapbackResult<Option<PasswordSnapshot>> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        self.with_auth_read(|conn| { super::auth::require_identity_core_v3_on(conn)?; require_same_password_identifier_mode(conn, identifier.mode)?; Ok(conn.query_row("SELECT i.user_id,i.id,c.id,c.generation,p.hash_phc FROM _auth_identities i JOIN _auth_credentials c ON c.user_id=i.user_id AND c.kind='password' AND c.revoked_at_ms IS NULL JOIN _auth_password_credentials p ON p.credential_id=c.id JOIN _auth_users u ON u.id=i.user_id WHERE i.provider='local-password' AND i.subject=?1 AND i.disabled_at_ms IS NULL AND u.deactivated_at_ms IS NULL",[identifier.canonical],|r|Ok(PasswordSnapshot{user_id:r.get(0)?,identity_id:r.get(1)?,credential_id:r.get(2)?,generation:r.get(3)?,hash_phc:r.get(4)?,identifier_mode:identifier.mode})).optional()?) })
    }

    pub(crate) fn password_authentication_predecessor(
        &self,
        canonical_identifier: &str,
        identifier_mode: PasswordIdentifierMode,
    ) -> SnapbackResult<PasswordAuthenticationPredecessor> {
        self.with_auth_read(|connection| {
            super::auth::require_password_identifier_mode_on(connection)?;
            require_same_password_identifier_mode(connection, identifier_mode)?;
            Ok(PasswordAuthenticationPredecessor {
                credential: password_snapshot_on(
                    connection,
                    canonical_identifier,
                    identifier_mode,
                )?,
                ledger: read_password_attempt_on(connection, canonical_identifier)?,
            })
        })
    }

    pub(crate) fn password_reset_predecessor(
        &self,
        canonical_identifier: &str,
    ) -> SnapbackResult<Option<(String, PasswordSnapshot)>> {
        let mode = self.auth_password_identifier_mode()?;
        self.with_auth_read(|connection| {
            let email_identity: Option<(String, String)> = connection
                .query_row(
                    "SELECT id,user_id FROM _auth_identities
                     WHERE provider='email-code' AND subject=?1
                       AND disabled_at_ms IS NULL",
                    [canonical_identifier],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let password = password_snapshot_on(connection, canonical_identifier, mode)?;
            Ok(match (email_identity, password) {
                (Some((email_identity_id, email_user)), Some(password))
                    if email_user == password.user_id =>
                {
                    Some((email_identity_id, password))
                }
                _ => None,
            })
        })
    }

    /// Storage seam for the authenticated admin/readiness projection. Public
    /// credential flows deliberately receive only the uniform invalid result.
    pub(crate) fn password_attempt_admin_projection(
        &self,
        username: &str,
        now_ms: u64,
    ) -> SnapbackResult<Option<PasswordAttemptAdminProjection>> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        self.with_auth_read(|connection| {
            super::auth::require_password_identifier_mode_on(connection)?;
            require_same_password_identifier_mode(connection, identifier.mode)?;
            Ok(
                read_password_attempt_on(connection, &identifier.canonical)?.map(|attempt| {
                    PasswordAttemptAdminProjection {
                        canonical_identifier: identifier.canonical,
                        window_start_ms: attempt.window_start_ms,
                        failed_count: attempt.failed_count,
                        locked_until_ms: attempt.locked_until_ms,
                        locked: attempt.locked_until_ms.is_some_and(|until| now_ms < until),
                    }
                }),
            )
        })
    }

    pub(crate) fn clear_password_lockout(
        &mut self,
        identifier: &str,
    ) -> SnapbackResult<bool> {
        let mode = self.auth_password_identifier_mode()?;
        let canonical = canonical_password_identifier_value(mode, identifier)?;
        self.with_auth_transaction(|transaction| {
            super::auth::require_identity_core_v3_on(transaction)?;
            require_same_password_identifier_mode(transaction, mode)?;
            Ok(transaction.execute(
                "DELETE FROM _auth_password_attempts WHERE address=?1",
                [&canonical],
            )? == 1)
        })
    }

    #[cfg(test)]
    pub(crate) fn install_imported_password_hash_for_test(
        &mut self,
        username: &str,
        _algorithm: &str,
        hash_phc: &str,
    ) -> SnapbackResult<()> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        self.with_auth_transaction(|transaction| {
            let changed = transaction.execute(
                "UPDATE _auth_password_credentials
                 SET hash_phc=?2
                 WHERE credential_id=(
                   SELECT c.id FROM _auth_credentials c
                   JOIN _auth_identities i ON i.user_id=c.user_id
                   WHERE i.provider='local-password' AND i.subject=?1
                     AND i.disabled_at_ms IS NULL
                     AND c.kind='password' AND c.revoked_at_ms IS NULL
                 )",
                params![identifier.canonical, hash_phc],
            )?;
            if changed == 1 {
                Ok(())
            } else {
                Err(auth_error(
                    "INTERNAL_AUTH_STATE",
                    "authentication state invariant failed",
                ))
            }
        })
    }

    #[cfg(test)]
    pub(crate) fn password_hash_facts_for_test(
        &self,
        username: &str,
    ) -> SnapbackResult<(u64, String, String)> {
        let snapshot = self
            .password_snapshot(username)?
            .ok_or_else(|| auth_error("INTERNAL_AUTH_STATE", "missing password fixture"))?;
        self.with_auth_read(|connection| {
            let algorithm: String = connection.query_row(
                "SELECT algorithm FROM _auth_password_credentials WHERE credential_id=?1",
                [&snapshot.credential_id],
                |row| row.get(0),
            )?;
            Ok((snapshot.generation, algorithm, snapshot.hash_phc))
        })
    }

    #[cfg(test)]
    pub(crate) fn identity_id_for_provider_subject_for_test(
        &self,
        provider: &str,
        subject: &str,
    ) -> SnapbackResult<String> {
        self.with_auth_read(|connection| {
            connection
                .query_row(
                    "SELECT id FROM _auth_identities
                     WHERE provider=?1 AND subject=?2 AND disabled_at_ms IS NULL",
                    params![provider, subject],
                    |row| row.get(0),
                )
                .map_err(Into::into)
        })
    }

    #[cfg(test)]
    pub(crate) fn insert_other_identity_session_for_test(
        &mut self,
        user_id: &str,
        subject: &str,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<(String, String, SessionBearer)> {
        let identity_id = crate::ids::mint_time_ordered(crate::ids::Kind::Identity);
        let session_id = crate::ids::mint_time_ordered(crate::ids::Kind::Session);
        let authority_instance_id =
            crate::ids::mint_time_ordered(crate::ids::Kind::AuthorityInstance);
        let bearer = SessionBearer::generate(random).map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                "secure randomness is unavailable",
            )
        })?;
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_identities(
                   id,user_id,kind,provider,subject,canonical_value,
                   created_at_ms,verified_at_ms
                 ) VALUES(?1,?2,'email','email-code',?3,?3,?4,?4)",
                params![identity_id, user_id, subject, now_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_sessions(
                   id,user_id,identity_id,credential_id,authn_source,
                   authority_instance_id,token_hash,generation,created_at_ms,
                   last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms
                 ) VALUES(?1,?2,?3,NULL,'identity',?4,?5,1,?6,?6,?7,?8,NULL)",
                params![
                    session_id,
                    user_id,
                    identity_id,
                    authority_instance_id,
                    bearer.token_hash().as_bytes().as_slice(),
                    now_ms,
                    now_ms + SESSION_IDLE_MS,
                    now_ms + SESSION_ABSOLUTE_MS,
                ],
            )?;
            Ok(())
        })?;
        Ok((identity_id, session_id, bearer))
    }

    #[cfg(test)]
    pub(crate) fn insert_typed_guest_session_for_test(
        &mut self,
        expires_at_ms: u64,
        now_ms: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let user_id = crate::ids::mint(crate::ids::Kind::User)?;
        let session_id = crate::ids::mint_time_ordered(crate::ids::Kind::Session);
        let authority_instance_id =
            crate::ids::mint_time_ordered(crate::ids::Kind::AuthorityInstance);
        let bearer = SessionBearer::generate(random).map_err(|_| {
            auth_error(
                "SNAPBACK_AUTH_RANDOM_UNAVAILABLE",
                "secure randomness is unavailable",
            )
        })?;
        self.with_auth_transaction(|transaction| {
            transaction.execute(
                "INSERT INTO _auth_users(
                   id,created_at_ms,kind,guest_state,guest_expires_at_ms
                 ) VALUES(?1,?2,'human','active',?3)",
                params![user_id, now_ms, expires_at_ms],
            )?;
            transaction.execute(
                "INSERT INTO _auth_sessions(
                   id,user_id,identity_id,credential_id,authn_source,
                   authority_instance_id,token_hash,generation,created_at_ms,
                   last_used_at_ms,expires_at_ms,absolute_expires_at_ms,revoked_at_ms
                 ) VALUES(?1,?2,NULL,NULL,'guest',?3,?4,1,?5,?5,?6,?6,NULL)",
                params![
                    session_id,
                    user_id,
                    authority_instance_id,
                    bearer.token_hash().as_bytes().as_slice(),
                    now_ms,
                    expires_at_ms,
                ],
            )?;
            Ok(())
        })?;
        Ok(IdentitySession {
            user_id,
            session_id,
            bearer,
            recovery_codes: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn displacement_facts_for_test(
        &self,
        identity_id: &str,
        credential_id: &str,
        user_id: &str,
    ) -> SnapbackResult<(bool, bool, bool)> {
        self.with_auth_read(|connection| {
            let identity_retired: bool = connection.query_row(
                "SELECT disabled_at_ms IS NOT NULL FROM _auth_identities WHERE id=?1",
                [identity_id],
                |row| row.get(0),
            )?;
            let credential_retired: bool = connection.query_row(
                "SELECT revoked_at_ms IS NOT NULL FROM _auth_credentials WHERE id=?1",
                [credential_id],
                |row| row.get(0),
            )?;
            let user_survives: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM _auth_users WHERE id=?1)",
                [user_id],
                |row| row.get(0),
            )?;
            Ok((identity_retired, credential_retired, user_survives))
        })
    }

    #[cfg(test)]
    pub(crate) fn identity_password_authenticate(
        &mut self,
        username: &str,
        password: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let snapshot = self.password_snapshot(username)?;
        let valid = verify_password(
            password,
            snapshot
                .as_ref()
                .map_or(DUMMY_PASSWORD_PHC, |s| s.hash_phc.as_str()),
        );
        if !valid {
            return Err(auth_error(
                "SNAPBACK_AUTH_CREDENTIAL_INVALID",
                "credential is invalid",
            ));
        }
        let s = snapshot.unwrap();
        let _upgrade_on_verify_required = password_hash_needs_upgrade(&s.hash_phc);
        // A later lane prepares the replacement hash here, still outside the
        // writer lock, then swaps it below only if `s.generation` remains the
        // exact predecessor.
        self.with_auth_transaction(|tx| { super::auth::require_identity_core_v3_on(tx)?; require_same_password_identifier_mode(tx, s.identifier_mode)?; let current:Option<(u64,String)>=tx.query_row("SELECT c.generation,p.hash_phc FROM _auth_credentials c JOIN _auth_password_credentials p ON p.credential_id=c.id WHERE c.id=?1 AND c.user_id=?2 AND c.revoked_at_ms IS NULL",params![s.credential_id,s.user_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?; if current.as_ref()!=Some(&(s.generation,s.hash_phc.clone())) { return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid")); } let(session,bearer)=insert_session(tx,&s.user_id,None,Some(&s.credential_id),"credential",now,random)?; tx.execute("UPDATE _auth_credentials SET last_used_at_ms=?2 WHERE id=?1",params![s.credential_id,now])?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"recent_auth",now,Some(now+600_000))?; journal(tx,&s.user_id,"password.authenticated",now)?; Ok(IdentitySession{user_id:s.user_id,session_id:session,bearer,recovery_codes:None}) })
    }

    #[cfg(test)]
    pub(crate) fn identity_password_change(
        &mut self,
        username: &str,
        current: &PasswordSecret,
        replacement: &PasswordSecret,
        now: u64,
        random: &dyn RandomSource,
    ) -> SnapbackResult<IdentitySession> {
        let snapshot = self.password_snapshot(username)?;
        if !snapshot
            .as_ref()
            .is_some_and(|s| verify_password(current, &s.hash_phc))
        {
            return Err(auth_error(
                "SNAPBACK_AUTH_CREDENTIAL_INVALID",
                "credential is invalid",
            ));
        }
        let new_phc = hash_password(replacement, random)?;
        let s = snapshot.unwrap();
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?; require_same_password_identifier_mode(tx, s.identifier_mode)?; let changed=tx.execute("UPDATE _auth_password_credentials SET hash_phc=?2,policy_version=?3,common_password_list_version=?4,changed_at_ms=?5 WHERE credential_id=?1 AND hash_phc=?6",params![s.credential_id,new_phc,PASSWORD_HASH_POLICY_V1.version,PASSWORD_HASH_POLICY_V1.common_password_list_version,now,s.hash_phc])?; if changed!=1{return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid"));} let generation_changed=tx.execute("UPDATE _auth_credentials SET generation=generation+1 WHERE id=?1 AND generation=?2",params![s.credential_id,s.generation])?; if generation_changed!=1{return Err(auth_error("SNAPBACK_AUTH_CREDENTIAL_INVALID","credential is invalid"));} tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![s.user_id,now])?; let(session,bearer)=insert_session(tx,&s.user_id,None,Some(&s.credential_id),"credential",now,random)?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"authenticated",now,Some(now+SESSION_IDLE_MS))?; insert_assurance(tx,&s.user_id,&session,Some(&s.credential_id),"recent_auth",now,Some(now+600_000))?; journal(tx,&s.user_id,"password.changed",now)?; Ok(IdentitySession{user_id:s.user_id,session_id:session,bearer,recovery_codes:None})})
    }

    pub(crate) fn identity_recovery_rotate(
        &mut self,
        user: &str,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        key: &[u8; 32],
    ) -> SnapbackResult<RecoveryCodes> {
        let (codes, digests) = generate_recovery(random, key)?;
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;insert_recovery_set(tx,user,key_id,&digests,"suspected-disclosure",now)?;tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;journal(tx,user,"recovery-codes.rotated",now)?;Ok(codes)})
    }

    #[cfg(test)]
    pub(crate) fn identity_recovery_consume(
        &mut self,
        username: &str,
        code: &str,
        now: u64,
        random: &dyn RandomSource,
        key_id: &str,
        key: &[u8; 32],
    ) -> SnapbackResult<IdentitySession> {
        let identifier = canonical_password_identifier(
            self.identity_floor_password_identifier_mode()?,
            username,
        )?;
        let digest = recovery_digest(key, code);
        let (codes, digests) = generate_recovery(random, key)?;
        let candidates = self.with_auth_read(|conn| {
            super::auth::require_identity_core_v3_on(conn)?;
            require_same_password_identifier_mode(conn, identifier.mode)?;
            let mut stmt = conn.prepare(
                "SELECT i.user_id,r.set_credential_id,r.ordinal,r.code_digest
                 FROM _auth_identities i
                 JOIN _auth_credentials c
                   ON c.user_id=i.user_id
                  AND c.kind='recovery-code-set'
                  AND c.revoked_at_ms IS NULL
                 JOIN _auth_recovery_codes r ON r.set_credential_id=c.id
                 JOIN _auth_recovery_code_sets s
                   ON s.credential_id=c.id AND s.replaced_at_ms IS NULL
                 WHERE i.provider='local-password'
                   AND i.subject=?1
                   AND r.key_id=?2
                   AND r.consumed_at_ms IS NULL
                 ORDER BY r.ordinal",
            )?;
            stmt.query_map(params![identifier.canonical, key_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, Vec<u8>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
        })?;
        let mut matched = None;
        let mut comparison_count = 0_u64;
        for (user, set, ordinal, stored) in candidates {
            let candidate = <[u8; 32]>::try_from(stored.as_slice()).unwrap_or([0; 32]);
            comparison_count += 1;
            if bool::from(candidate.ct_eq(&digest)) {
                matched = Some((user, set, ordinal));
            }
        }
        if comparison_count == 0 {
            let _ = bool::from(<[u8; 32]>::default().ct_eq(&digest));
        }
        let (user, set, ordinal) = matched.ok_or_else(|| {
            auth_error(
                "SNAPBACK_AUTH_RECOVERY_CODE_INVALID",
                "recovery code is invalid",
            )
        })?;
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;require_same_password_identifier_mode(tx,identifier.mode)?;let changed=tx.execute("UPDATE _auth_recovery_codes SET consumed_at_ms=?4 WHERE set_credential_id=?1 AND ordinal=?2 AND code_digest=?3 AND consumed_at_ms IS NULL",params![set,ordinal,digest.as_slice(),now])?;if changed!=1{return Err(auth_error("SNAPBACK_AUTH_RECOVERY_CODE_INVALID","recovery code is invalid"));}let successor=insert_recovery_set(tx,&user,key_id,&digests,"after-use",now)?;tx.execute("UPDATE _auth_sessions SET revoked_at_ms=?2,generation=generation+1 WHERE user_id=?1 AND revoked_at_ms IS NULL",params![user,now])?;let(session,bearer)=insert_session(tx,&user,None,Some(&successor),"credential",now,random)?;insert_assurance(tx,&user,&session,Some(&successor),"authenticated",now,Some(now+SESSION_IDLE_MS))?;insert_assurance(tx,&user,&session,Some(&successor),"recent_auth",now,Some(now+600_000))?;journal(tx,&user,"recovery-code.used",now)?;Ok(IdentitySession{user_id:user,session_id:session,bearer,recovery_codes:Some(codes)})})
    }

    pub(crate) fn identity_revoke_password(&mut self, user: &str, now: u64) -> SnapbackResult<()> {
        self.with_auth_transaction(|tx|{super::auth::require_identity_core_v3_on(tx)?;let usable:u64=tx.query_row("SELECT COUNT(*) FROM _auth_recovery_codes r JOIN _auth_credentials c ON c.id=r.set_credential_id JOIN _auth_recovery_code_sets s ON s.credential_id=c.id WHERE c.user_id=?1 AND c.revoked_at_ms IS NULL AND s.replaced_at_ms IS NULL AND r.consumed_at_ms IS NULL",[user],|r|r.get(0))?;if usable==0{return Err(auth_error("SNAPBACK_AUTH_LAST_AUTHENTICATOR","cannot remove the last usable authenticator"));}tx.execute("UPDATE _auth_credentials SET revoked_at_ms=?2 WHERE user_id=?1 AND kind='password' AND revoked_at_ms IS NULL",params![user,now])?;Ok(())})
    }

    pub(crate) fn identity_claims(
        &self,
        session_id: &str,
        now: u64,
    ) -> SnapbackResult<AuthClaimsProjection> {
        self.with_auth_read(|conn|{super::auth::require_identity_core_v3_on(conn)?;let user:String=conn.query_row("SELECT user_id FROM _auth_sessions WHERE id=?1 AND revoked_at_ms IS NULL AND expires_at_ms>?2",params![session_id,now],|r|r.get(0))?;let mut identities=vec![];let mut stmt=conn.prepare("SELECT kind,provider,issuer,subject,canonical_value FROM _auth_identities WHERE user_id=?1 AND disabled_at_ms IS NULL ORDER BY kind,provider,subject")?;for row in stmt.query_map([&user],|r|Ok(ClaimsIdentity{kind:r.get(0)?,provider_key:r.get(1)?,issuer:r.get(2)?,subject:r.get(3)?,value:r.get(4)?}))?{identities.push(row?);}let mut assurances=vec![];let mut stmt=conn.prepare("SELECT kind,provenance,issued_at_ms,expires_at_ms,governing_authority FROM _auth_assurances WHERE user_id=?1 AND session_id=?2 AND revoked_at_ms IS NULL AND (expires_at_ms IS NULL OR expires_at_ms>?3)")?;for row in stmt.query_map(params![user,session_id,now],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get(2)?,r.get(3)?,r.get(4)?)))?{let(k,p,issued,expires,governing)=row?;let kind=match k.as_str(){"authenticated"=>AssuranceKind::Authenticated,"email_verified"=>AssuranceKind::EmailVerified,"phone_verified"=>AssuranceKind::PhoneVerified,"recent_auth"=>AssuranceKind::RecentAuth,_=>AssuranceKind::PhishingResistant};let provenance=match p.as_str(){"session"=>AssuranceProvenance::Session,"credential"=>AssuranceProvenance::Credential,"delivery"=>AssuranceProvenance::Delivery,"federation"=>AssuranceProvenance::Federation,"import"=>AssuranceProvenance::Import,_=>AssuranceProvenance::Rehearsal};assurances.push(AssuranceRecord{kind,provenance,issued_at:issued,expires_at:expires,governing_authority:governing});}Ok(AuthClaimsProjection::server_derived(identities,assurances))})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct CounterRandom(AtomicU64);
    impl CounterRandom {
        fn new() -> Self {
            Self(AtomicU64::new(1))
        }
    }
    impl RandomSource for CounterRandom {
        fn fill(&self, out: &mut [u8]) -> Result<(), CryptoError> {
            let call = self.0.fetch_add(1, Ordering::Relaxed);
            for (index, byte) in out.iter_mut().enumerate() {
                *byte = call.wrapping_mul(31).wrapping_add(index as u64) as u8;
            }
            Ok(())
        }
    }
    fn ready() -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog().unwrap();
        db
    }
    fn ready_with_mode(mode: PasswordIdentifierMode) -> LocalDatabase {
        let mut db = LocalDatabase::memory().unwrap();
        db.activate_current_auth_catalog_with_password_identifier_mode(mode)
            .unwrap();
        db
    }
    fn password(value: &str) -> PasswordSecret {
        PasswordSecret::new(value.into())
    }

    #[test]
    fn declared_password_minimum_changes_admission_and_refusal_details() {
        let random = CounterRandom::new();
        let default =
            PasswordSecurityProfile::for_provider(crate::contract_types::AuthProviderProfile::Test);
        let default_error =
            hash_password_on_blocking_pool_with_profile(&password("eight888"), &random, default)
                .unwrap_err();
        assert_eq!(
            default_error.diagnostic.code,
            "SNAPBACK_AUTH_PASSWORD_POLICY"
        );
        assert_eq!(default_error.diagnostic.details["minimumLength"], 12);
        assert!(
            default_error
                .diagnostic
                .message
                .contains("mechanisms.<name>.minimumLength")
        );

        let configured = default.with_minimum_password_length(8).unwrap();
        hash_password_on_blocking_pool_with_profile(&password("eight888"), &random, configured)
            .expect("the declared eight-byte minimum admits an eight-byte password");
        let short =
            hash_password_on_blocking_pool_with_profile(&password("seven77"), &random, configured)
                .unwrap_err();
        assert_eq!(short.diagnostic.details["minimumLength"], 8);
        assert_eq!(
            default
                .with_minimum_password_length(7)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID",
        );
    }

    /// @ref LLP 0227#migration-and-import-of-existing-hashes — cost parameters
    ///   are bounded before any KDF work, at verification and not only at
    ///   import. The concurrency permit bounds how many verifications run; only
    ///   this bounds how expensive one is.
    #[test]
    fn stored_hash_cost_parameters_are_bounded_before_any_kdf_work() {
        // The uniform-timing dummy MUST stay admissible. If it ever fell outside
        // the caps, a nonexistent-identifier signin would refuse early and fast
        // while a real one spent full KDF — reintroducing exactly the
        // enumeration oracle the dummy exists to close.
        assert!(
            phc_cost_within_declared_caps(dummy_password_phc()),
            "the dummy PHC must remain within caps or it becomes a timing oracle"
        );

        // A credential written under the pinned policy verifies normally.
        let pinned =
            hash_password_on_blocking_pool(&password("a-strong-password-123"), &CounterRandom::new())
                .expect("pinned policy hash")
                .phc;
        assert!(phc_cost_within_declared_caps(&pinned));
        assert!(verify_password(&password("a-strong-password-123"), &pinned));

        // Over-budget hashes are refused rather than verified, per algorithm.
        // Each of these is a well-formed hash whose declared cost is hostile.
        let hostile_argon2 =
            "$argon2id$v=19$m=4194304,t=2,p=1$HyAhIiMkJSYnKCkqKywtLg$Kwc47BIKhIV7UTbl8eAZf0EL/mFlTXkkO6rPuplXNLc";
        assert!(
            !phc_cost_within_declared_caps(hostile_argon2),
            "4 GiB argon2 memory must be refused"
        );
        assert!(!verify_password(&password("a-strong-password-123"), hostile_argon2));

        assert!(
            !phc_cost_within_declared_caps("$2b$31$abcdefghijklmnopqrstuuLYQoZLnCLpYLnCLpYLnCLpYLnCLpY"),
            "bcrypt cost 31 must be refused"
        );

        // A bcrypt hash at an admissible cost is still accepted, so importing a
        // real foreign credential keeps working.
        let admissible_bcrypt = bcrypt::hash("a-strong-password-123", 4).expect("bcrypt fixture");
        assert!(phc_cost_within_declared_caps(&admissible_bcrypt));
        assert!(verify_password(&password("a-strong-password-123"), &admissible_bcrypt));

        // Unparseable and unknown-algorithm inputs fail closed.
        assert!(!phc_cost_within_declared_caps("not-a-hash"));
        assert!(!phc_cost_within_declared_caps("$2b$notanumber$xxxx"));
        assert!(!phc_cost_within_declared_caps(&"x".repeat(
            IMPORTED_HASH_MAX_ENCODED_BYTES + 1
        )));
    }

    #[test]
    fn guest_create_claim_is_continuous_and_collision_is_atomic() {
        let random = CounterRandom::new();
        let key = [7; 32];
        let mut db = ready();
        let existing = db
            .identity_password_register(
                "taken",
                &password("strong-existing-secret-1"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        let guest = db.identity_guest_create(50_000, 2, &random).unwrap();
        let error = db
            .identity_guest_claim_password(
                &guest.bearer,
                "taken",
                &password("strong-guest-secret-22"),
                3,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION");
        let claimed = db
            .identity_guest_claim_password(
                &guest.bearer,
                "new-name",
                &password("strong-guest-secret-22"),
                4,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap();
        assert_eq!(claimed.user_id, guest.user_id);
        assert_ne!(claimed.user_id, existing.user_id);

        let email_guest = db.identity_guest_create(50_000, 4, &random).unwrap();
        let proof =
            prepare_verified_email_claim("Verified@Example.com", "event-1", "email-code:built-in")
                .unwrap();
        let email_claimed = db
            .identity_guest_claim_verified_email(&email_guest.bearer, &proof, 5, &random)
            .unwrap();
        assert_eq!(email_claimed.user_id, email_guest.user_id);
        let collision_guest = db.identity_guest_create(50_000, 5, &random).unwrap();
        assert_eq!(
            db.identity_guest_claim_verified_email(&collision_guest.bearer, &proof, 6, &random)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_GUEST_CLAIM_COLLISION"
        );

        let settable = db.identity_guest_create(60, 7, &random).unwrap();
        db.with_auth_transaction(|tx|{tx.execute("UPDATE _auth_users SET guest_state='claimed',guest_expires_at_ms=NULL,guest_claimed_at_ms=7 WHERE id=?1",[&settable.user_id])?;Ok(())}).unwrap();
        let set = db
            .identity_password_set(
                &settable.bearer,
                "set-name",
                &password("strong-password-set-123"),
                8,
                &random,
                RecoveryKeyMaterial::new("key-1", &key),
            )
            .unwrap();
        assert_eq!(set.user_id, settable.user_id);

        let reapable = db.identity_guest_create(8, 7, &random).unwrap();
        assert_eq!(db.identity_reap_guests_default_tombstone(9).unwrap(), 1);
        assert_eq!(
            db.identity_guest_claim_password(
                &reapable.bearer,
                "too-late",
                &password("strong-too-late-secret"),
                10,
                &random,
                RecoveryKeyMaterial::new("key-1", &key)
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_GUEST_SESSION_INVALID"
        );
    }

    #[test]
    fn password_auth_change_recovery_rotation_and_claims_floor() {
        let random = CounterRandom::new();
        let key = [9; 32];
        let mut db = ready();
        let registered = db
            .identity_password_register(
                "Person",
                &password("strong-register-secret-1"),
                10,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        assert_eq!(
            db.identity_password_authenticate(
                "missing",
                &password("strong-register-secret-1"),
                11,
                &random
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        );
        let authenticated = db
            .identity_password_authenticate(
                "person",
                &password("strong-register-secret-1"),
                12,
                &random,
            )
            .unwrap();
        let claims = db.identity_claims(&authenticated.session_id, 12).unwrap();
        assert_eq!(claims.identities[0].provider_key, "local-password");
        assert_eq!(
            claims.assurances[0].provenance,
            AssuranceProvenance::Credential
        );
        db.identity_password_change(
            "person",
            &password("strong-register-secret-1"),
            &password("strong-replacement-secret-2"),
            13,
            &random,
        )
        .unwrap();
        assert_eq!(
            db.identity_password_authenticate(
                "person",
                &password("strong-register-secret-1"),
                14,
                &random
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_CREDENTIAL_INVALID"
        );
        let first_code = registered.recovery_codes.as_ref().unwrap().expose_once()[0].clone();
        let recovered = db
            .identity_recovery_consume("person", &first_code, 15, &random, "key-1", &key)
            .unwrap();
        assert!(recovered.recovery_codes.is_some());
        assert_eq!(
            db.identity_recovery_consume("person", &first_code, 16, &random, "key-1", &key)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_RECOVERY_CODE_INVALID"
        );
        assert_eq!(
            db.identity_recovery_rotate(&registered.user_id, 17, &random, "key-1", &key)
                .unwrap()
                .expose_once()
                .len(),
            RECOVERY_COUNT
        );
    }

    #[test]
    fn email_v1_is_provider_scoped_and_never_confers_email_verified_assurance() {
        let random = CounterRandom::new();
        let key = [11; 32];
        let mut db = ready_with_mode(PasswordIdentifierMode::EmailV1);
        let registered = db
            .identity_password_register(
                "  TÉST@Example.COM  ",
                &password("strong-email-password-1"),
                10,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        assert_eq!(
            db.identity_password_register(
                "te\u{301}st@example.com",
                &password("strong-email-password-2"),
                11,
                &random,
                "key-1",
                &key,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_IDENTITY_COLLISION"
        );
        let authenticated = db
            .identity_password_authenticate(
                "TÉST@EXAMPLE.COM",
                &password("strong-email-password-1"),
                12,
                &random,
            )
            .unwrap();
        let claims = db.identity_claims(&authenticated.session_id, 12).unwrap();
        let local = claims
            .identities
            .iter()
            .find(|identity| identity.provider_key == "local-password")
            .unwrap();
        assert_eq!(local.kind, "email");
        assert_eq!(local.subject, "tést@example.com");
        assert!(
            claims
                .assurances
                .iter()
                .all(|assurance| assurance.kind != AssuranceKind::EmailVerified),
            "password possession must not create email-verified assurance"
        );
        let (local_verified_at, local_user): (u64, String) = db
            .with_auth_read(|conn| {
                Ok(conn.query_row(
                    "SELECT verified_at_ms,user_id FROM _auth_identities
                     WHERE provider='local-password' AND subject='tést@example.com'",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!(
            local_verified_at, 10,
            "local verified_at is creation time only"
        );
        assert_eq!(local_user, registered.user_id);

        let email_guest = db.identity_guest_create(50_000, 13, &random).unwrap();
        let proof = prepare_verified_email_claim(
            "TE\u{301}ST@example.com",
            "email-event-1",
            "email-code:built-in",
        )
        .unwrap();
        let email_claimed = db
            .identity_guest_claim_verified_email(&email_guest.bearer, &proof, 14, &random)
            .expect("local-password identity must not satisfy email-code lookup");
        assert_ne!(email_claimed.user_id, registered.user_id);
        let providers = db
            .with_auth_read(|conn| {
                let mut statement = conn.prepare(
                    "SELECT provider,user_id FROM _auth_identities
                     WHERE subject='tést@example.com' ORDER BY provider",
                )?;
                Ok(statement
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?)
            })
            .unwrap();
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].0, "email-code");
        assert_eq!(providers[0].1, email_claimed.user_id);
        assert_eq!(providers[1].0, "local-password");
        assert_eq!(providers[1].1, registered.user_id);

        assert_eq!(
            db.identity_password_authenticate(
                "not-an-email",
                &password("strong-email-password-1"),
                15,
                &random,
            )
            .unwrap_err()
            .diagnostic
            .code,
            "SNAPBACK_AUTH_PASSWORD_IDENTIFIER_INVALID"
        );
    }

    #[test]
    fn password_hash_policy_v1_is_explicit_in_every_new_phc() {
        let phc =
            hash_password(&password("strong-policy-password-1"), &CounterRandom::new()).unwrap();
        let hash = PasswordHash::new(&phc).unwrap();
        let params = Params::try_from(&hash).unwrap();
        assert_eq!(hash.algorithm.as_str(), "argon2id");
        assert_eq!(hash.version, Some(19));
        assert_eq!(params.m_cost(), 19_456);
        assert_eq!(params.t_cost(), 2);
        assert_eq!(params.p_cost(), 1);
        assert_eq!(params.output_len(), Some(32));
        assert_eq!(hash.salt.as_ref().unwrap().len(), 16);
        assert_eq!(hash.hash.as_ref().unwrap().len(), 32);
        assert!(!password_hash_needs_upgrade(&phc));
        assert!(!password_hash_needs_upgrade(DUMMY_PASSWORD_PHC));
    }

    #[test]
    fn last_authenticator_refusal_rolls_back() {
        let random = CounterRandom::new();
        let key = [3; 32];
        let mut db = ready();
        let account = db
            .identity_password_register(
                "sole",
                &password("strong-sole-secret-123"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        db.with_auth_transaction(|tx| { tx.execute("UPDATE _auth_credentials SET revoked_at_ms=2 WHERE user_id=?1 AND kind='recovery-code-set'",[&account.user_id])?; Ok(()) }).unwrap();
        assert_eq!(
            db.identity_revoke_password(&account.user_id, 3)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_LAST_AUTHENTICATOR"
        );
        assert!(
            db.identity_password_authenticate(
                "sole",
                &password("strong-sole-secret-123"),
                4,
                &random
            )
            .is_ok()
        );
    }

    #[test]
    fn verified_provisioning_is_sealed_idempotent_and_atomic() {
        let random = CounterRandom::new();
        let key = [4; 32];
        let mut db = ready();
        let account = db
            .identity_password_register(
                "provision",
                &password("strong-provision-secret-1"),
                1,
                &random,
                "key-1",
                &key,
            )
            .unwrap();
        let (identity, assurance) = db
            .with_auth_read(|conn| {
                Ok((
                    conn.query_row(
                        "SELECT id FROM _auth_identities WHERE user_id=?1",
                        [&account.user_id],
                        |r| r.get::<_, String>(0),
                    )?,
                    conn.query_row(
                        "SELECT id FROM _auth_assurances WHERE user_id=?1 ORDER BY id LIMIT 1",
                        [&account.user_id],
                        |r| r.get::<_, String>(0),
                    )?,
                ))
            })
            .unwrap();
        db.with_auth_transaction(|tx| {
            tx.execute_batch("CREATE TABLE profile(id TEXT PRIMARY KEY, owner TEXT NOT NULL)")?;
            Ok(())
        })
        .unwrap();
        let authority = prepare_verified_provisioning(
            "hook-1",
            [1; 32],
            "provision-1",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        let insert = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p1".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        assert_eq!(
            db.execute_verified_provisioning(&authority, &[insert], 2)
                .unwrap(),
            ProvisioningOutcome::Committed
        );
        assert_eq!(
            db.execute_verified_provisioning(&authority, &[], 3)
                .unwrap(),
            ProvisioningOutcome::AlreadyCommitted
        );
        let mismatch = prepare_verified_provisioning(
            "hook-1",
            [2; 32],
            "provision-1",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        assert_eq!(
            db.execute_verified_provisioning(&mismatch, &[], 4)
                .unwrap_err()
                .diagnostic
                .code,
            "SNAPBACK_AUTH_PROVISIONING_REPLAY_MISMATCH"
        );
        let atomic = prepare_verified_provisioning(
            "hook-1",
            [3; 32],
            "provision-atomic",
            &account.user_id,
            &identity,
            &assurance,
            ["profile".into()],
        )
        .unwrap();
        let first = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p2".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        let duplicate = ProvisioningInsert {
            table: "profile".into(),
            columns: vec![
                ("id".into(), "p2".into()),
                ("owner".into(), account.user_id.clone()),
            ],
        };
        assert!(
            db.execute_verified_provisioning(&atomic, &[first, duplicate], 5)
                .is_err()
        );
        let count: u64 = db
            .with_auth_read(|conn| {
                Ok(
                    conn.query_row("SELECT COUNT(*) FROM profile WHERE id='p2'", [], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}
