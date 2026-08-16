//! Language-neutral shared contract type definitions.
//!
//! This module is a dependency-free leaf. Higher-level manifest and runtime
//! modules may consume these definitions, but contract types must not depend on
//! those owners.
//!
//! @ref LLP 0225#1-ownership-map — the shared contract/types leaf is the
//!   canonical downward dependency for Rust owners and generated artifacts.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

fn is_false(value: &bool) -> bool {
    !*value
}

pub(crate) const AUTH_MAX_SAFE_TIMESTAMP: u64 = 9_007_199_254_740_991;

// @ref LLP 0225#1-ownership-map — the kernel consumes these session and
// terminal value shapes from the leaf; the sync engine keeps
// `SessionProjection` and behavioral impls.
pub(crate) const SESSION_TERMINAL_CAUSE_META_PREFIX: &str = "auth_session_terminal_cause_v1/";

/// Identity outcome carried from provider policy into a storage commit plan.
///
/// @ref LLP 0225#1-ownership-map — cross-owner plan value shapes are leaf-owned;
///   provider policy and canonical-store behavior remain with their owners.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlannedIdentityState {
    Existing {
        identity_id: String,
        user_id: String,
    },
    Create {
        identity_id: String,
        user_id: String,
    },
}

/// Opaque, exact-width digest used to name current and superseded session
/// bearers across provider policy, projection, and catalog commits.
#[derive(Clone, Copy, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct TokenDigest(pub(crate) [u8; 32]);

impl TokenDigest {
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for TokenDigest {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("TokenDigest([REDACTED])")
    }
}

/// Durable session-family revocation published after the owning kernel commit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SessionRevocation {
    pub session_id: String,
    pub generation: u64,
}

/// Provider-neutral durable session row returned by the auth-catalog kernel.
/// Sync policy decides whether this row is live, expired, or usable through a
/// retained predecessor.
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

#[derive(Debug)]
pub(crate) struct AuthSessionRecord {
    pub(crate) session: ResolvedSession,
    pub(crate) revoked: bool,
}

/// Current-first durable bearer lookup. The kernel reports only row facts;
/// supersession-grace and expiry classification remain provider policy.
#[derive(Debug)]
pub(crate) enum PresentedSessionLookup {
    Current(AuthSessionRecord),
    Tombstone {
        session: AuthSessionRecord,
        superseded_at_ms: u64,
    },
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthenticatedUse {
    Unchanged { expires_at_ms: u64 },
    Extended { expires_at_ms: u64 },
    NotLive,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct AuthenticatedUseRow {
    pub(crate) generation: u64,
    pub(crate) last_used_at_ms: u64,
    pub(crate) expires_at_ms: u64,
    pub(crate) absolute_expires_at_ms: u64,
    pub(crate) revoked: bool,
}

/// Wire-neutral session response facts used by kernel transaction outcomes.
/// The sync owner converts this shape into the public auth wire DTO.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthSessionResponseFact {
    pub(crate) id: String,
    pub(crate) user_id: String,
    pub(crate) provider: String,
    pub(crate) created_at: u64,
    pub(crate) expires_at: u64,
    pub(crate) absolute_expires_at: u64,
    pub(crate) authority_instance_id: String,
    pub(crate) generation: u64,
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

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PlannedFamilyAlarmCommit {
    Revoked(SessionRevocation),
    Noop,
    Retry,
}

#[derive(Clone)]
pub(crate) enum PlannedRotationTransaction {
    Refreshed(AuthSessionResponseFact),
    CandidateCollision,
    PredecessorChanged,
}

pub(crate) enum DurableRevocationReconcile {
    ExactPredecessor,
    ExactSuccessor(SessionRevocation),
    DifferentValid,
}

pub(crate) enum DurableRotationReconcile {
    ExactPredecessor,
    ExactSuccessor(AuthSessionResponseFact),
    DifferentValid,
}

/// Unclassified durable verification-code row. Provider policy decides
/// terminality, lockout, and whether an issuance may be planned.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExchangeChallengeFact {
    pub(crate) address: String,
    pub(crate) code_digest: [u8; 32],
    pub(crate) key_id: String,
    pub(crate) attempts: u32,
    pub(crate) max_attempts: u32,
    pub(crate) expires_at_ms: u64,
    pub(crate) consumed: bool,
    pub(crate) superseded: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExistingIdentityFact {
    pub(crate) identity_id: String,
    pub(crate) user_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct EvictionCandidateFact {
    pub(crate) session_id: String,
    pub(crate) generation: u64,
    pub(crate) token_digest: TokenDigest,
}

/// Unclassified durable session row that sync policy may turn into a
/// revocation plan. The kernel does not choose the revocation reason.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionRevocationCandidateFact {
    pub(crate) session_id: String,
    pub(crate) generation: u64,
    pub(crate) token_digest: TokenDigest,
}

/// Durable live-session cap facts. Sync policy decides whether the oldest
/// row becomes a cap-eviction plan.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionCapFacts {
    pub(crate) live_session_count: u64,
    pub(crate) oldest_live_session: Option<EvictionCandidateFact>,
}

/// Unclassified catalog facts for session issuance. Provider policy owns the
/// Create/Existing identity choice and the live-cap eviction decision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionIssuanceFacts {
    pub(crate) existing_identity: Option<ExistingIdentityFact>,
    pub(crate) live_session_count: u64,
    pub(crate) oldest_live_session: Option<EvictionCandidateFact>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RequestInsertOutcome {
    Inserted,
    AuthRequired,
}

pub(crate) enum CatalogIssuanceReconcile {
    ExactPredecessor,
    ExactSuccessor {
        session: AuthSessionResponseFact,
        committed_revocations: Vec<SessionRevocation>,
    },
    DifferentValid,
}

pub(crate) enum DurableRejectedIssuanceReconcile {
    ExactPredecessor,
    ExactSuccessor,
    DifferentValid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RejectedExchangeOutcome {
    Invalid,
    Locked,
    PredecessorChanged,
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) enum ExchangeOutcome {
    Invalid,
    Locked,
    Issued {
        session: AuthSessionResponseFact,
        committed_revocation: Option<SessionRevocation>,
    },
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) enum RefreshOutcome {
    AuthRequired,
    SessionExpired,
    SupersededInsideGrace,
    ReuseRevoked(SessionRevocation),
    Refreshed(AuthSessionResponseFact),
}

#[cfg(test)]
#[allow(dead_code)]
#[derive(Debug)]
pub(crate) enum LogoutOutcome {
    AuthRequired,
    SessionExpired,
    CredentialSuperseded,
    Revoked(SessionRevocation),
}

/// Durable sender-proof replay outcomes shared by policy and the storage
/// authority that enforces them.
///
/// @ref LLP 0225#1-ownership-map — cross-owner result shapes are leaf-owned;
///   replay policy and SQLite behavior remain with their respective owners.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayConsumeError {
    Replay,
    Capacity,
    Unavailable,
    Invalid,
    /// The thumbprint already holds a live family nonce cell under the current
    /// epoch; a second family cannot be installed for the same key.
    KeyBound,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SenderNonceError {
    Required,
    Replay,
    Capacity,
    Unavailable,
    Invalid,
}

#[derive(Clone, Eq, PartialEq)]
pub struct VerifiedSenderProof {
    pub proof_id: [u8; 16],
    pub jwk_thumbprint: String,
    pub issued_at_seconds: u64,
}

impl std::fmt::Debug for VerifiedSenderProof {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("VerifiedSenderProof([REDACTED])")
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderNonce {
    pub(crate) nonce: String,
    pub generation: u64,
    pub expires_at_seconds: u64,
}

impl SenderNonce {
    pub fn expose_for_transport(&self) -> &str {
        &self.nonce
    }
}

impl std::fmt::Debug for SenderNonce {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SenderNonce")
            .field("nonce", &"[REDACTED]")
            .field("generation", &self.generation)
            .field("expires_at_seconds", &self.expires_at_seconds)
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderNonceChallenge(pub(crate) String);

impl SenderNonceChallenge {
    pub fn expose_for_transport(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SenderNonceChallenge {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SenderNonceChallenge([REDACTED])")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SenderAdmissionRejectionKind {
    Required,
    Invalid,
    Replayed,
    Unavailable,
    /// A committed logout (or another durable-delete-class revocation) left
    /// this custody stranded: the post-logout signed request resolved against
    /// the bounded revoked-family tombstone and must receive the terminal
    /// `durableDelete` outcome instead of a nonce challenge.
    TerminalDurableDelete,
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderAdmissionRejection {
    pub kind: SenderAdmissionRejectionKind,
    pub(crate) challenge: Option<SenderNonceChallenge>,
}

impl SenderAdmissionRejection {
    pub fn challenge(&self) -> Option<&SenderNonceChallenge> {
        self.challenge.as_ref()
    }
}

impl std::fmt::Debug for SenderAdmissionRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SenderAdmissionRejection")
            .field("kind", &self.kind)
            .field("challenge", &self.challenge)
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct SenderAdmission {
    pub verified: VerifiedSenderProof,
    pub(crate) next_nonce: SenderNonce,
    /// The durable sender replay namespace this admission verified under —
    /// what a sender-bound grant records as its issuance epoch
    /// (`BoundGrantAuthorityV2.senderReplayEpochAtIssuance`).
    pub sender_replay_epoch: u64,
}

impl SenderAdmission {
    pub fn next_nonce_for_transport(&self) -> &str {
        self.next_nonce.expose_for_transport()
    }

    pub fn next_nonce_generation(&self) -> u64 {
        self.next_nonce.generation
    }
}

impl std::fmt::Debug for SenderAdmission {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SenderAdmission")
            .field("verified", &self.verified)
            .field("next_nonce", &self.next_nonce)
            .finish()
    }
}

/// Purpose key for the deterministic unknown-carrier cover nonce. The bytes
/// are a domain-separated derivation owned by the hosted serving authority;
/// this type never exposes them through `Debug`.
pub struct SenderCoverNonceKey([u8; 32]);

impl SenderCoverNonceKey {
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for SenderCoverNonceKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SenderCoverNonceKey([REDACTED])")
    }
}

/// Already-composed input for one durable sender nonce lookup.
pub(crate) struct SenderNonceRead<'a> {
    pub(crate) sender_replay_epoch: u64,
    pub(crate) family_jwk_thumbprint: &'a str,
    pub(crate) now_seconds: u64,
}

/// Already-composed input for installing or replacing one durable sender
/// nonce generation.
pub(crate) struct SenderNonceIssue<'a> {
    pub(crate) sender_replay_epoch: u64,
    pub(crate) family_jwk_thumbprint: &'a str,
    pub(crate) nonce: &'a str,
    pub(crate) now_seconds: u64,
    pub(crate) expires_at_seconds: u64,
    pub(crate) capacity: Option<u64>,
}

/// Already-composed input for the atomic verified-proof replay consumption
/// and nonce rotation cut.
pub(crate) struct SenderProofNonceRotation<'a> {
    pub(crate) sender_replay_epoch: u64,
    pub(crate) family_jwk_thumbprint: &'a str,
    pub(crate) current: &'a SenderNonce,
    pub(crate) verified: &'a VerifiedSenderProof,
    pub(crate) now_seconds: u64,
    pub(crate) replay_expires_at_seconds: u64,
    pub(crate) next_nonce: &'a str,
    pub(crate) next_nonce_expires_at_seconds: u64,
    pub(crate) replay_capacity: Option<u64>,
}

/// Already-composed input for consuming one verified proof id without a nonce
/// transition (the bounded terminal tombstone path).
pub(crate) struct SenderProofIdConsumption {
    pub(crate) sender_replay_epoch: u64,
    pub(crate) proof_id: [u8; 16],
    pub(crate) now_seconds: u64,
    pub(crate) expires_at_seconds: u64,
    pub(crate) capacity: Option<u64>,
}

/// Already-composed durable lookup for a live presented-token sender binding.
pub(crate) struct SenderConstraintLookup<'a> {
    pub(crate) token_hash: &'a [u8],
    pub(crate) now_ms: u64,
    pub(crate) supersession_grace_ms: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SenderConstraintFact {
    pub(crate) jwk_thumbprint: String,
}

/// Already-composed durable lookup for a bounded revoked-family tombstone.
pub(crate) struct SenderFamilyTombstoneLookup<'a> {
    pub(crate) token_hash: &'a [u8],
    pub(crate) now_ms: u64,
    pub(crate) retention_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SenderFamilyTombstoneFact {
    pub(crate) jwk_thumbprint: String,
    pub(crate) terminal_reason: Option<RevocationReason>,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct AuthorizationStreamIncarnation(pub(crate) String);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RevocationReason {
    DurableRevocation,
    Logout,
    CapEviction,
    FamilyAlarm,
    RefreshReuse,
    Reset,
    Restore,
    ModeTransition,
    Expired,
    Uncertain,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PersistedSessionTerminalReason {
    DurableRevocation,
    Logout,
    CapEviction,
    FamilyAlarm,
    RefreshReuse,
    Reset,
    Restore,
    ModeTransition,
}

/// Versioned durable witness for the cause that advanced one session into a
/// revoked generation. The auth catalog's frozen v1/v2 table shapes carry only
/// `revoked_at_ms`; this exact metadata record supplies the independent client
/// disposition axis without mutating either recognized catalog schema.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionTerminalCauseRecord {
    pub(crate) format_version: u32,
    pub(crate) session_id: String,
    pub(crate) generation: u64,
    pub(crate) revoked_at_ms: u64,
    pub(crate) reason: PersistedSessionTerminalReason,
}

/// Deployment posture for the built-in authentication provider.
///
/// @ref LLP 0225#1-ownership-map — deployment-profile vocabulary is leaf-owned;
///   budget-policy conversion remains with the provider service.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthProviderProfile {
    Dev,
    Test,
    Demo,
    Prod,
}

impl AuthProviderProfile {
    pub(crate) fn permits_capture(self) -> bool {
        matches!(self, Self::Dev | Self::Test | Self::Demo)
    }
}

/// The positive environment/profile capability (LLP 0034 §5 D4 residual,
/// ENG-22527): auth (`AdminWrite`) answers "may this principal?"; the profile
/// answers "is this operation appropriate in this environment?". Destructive
/// and provisioning operations require BOTH. Resolution: `SNAPBACK_PROFILE`
/// (dev|demo|test|prod) wins; otherwise loopback binds default to `dev` (the
/// zero-config local posture — OQ7 stands; since ENG-23443 the AdminWrite side
/// of that posture is a minted token rather than loopback-open) and
/// non-loopback binds default to `prod`.
///
/// @ref LLP 0225#1-ownership-map — deployment-posture vocabulary is leaf-owned;
///   environment and bind-address resolution remain in the transport adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerProfile {
    Dev,
    Demo,
    Test,
    Prod,
}

impl ServerProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Demo => "demo",
            Self::Test => "test",
            Self::Prod => "prod",
        }
    }

    pub fn allows_provisioning(self) -> bool {
        !matches!(self, Self::Prod)
    }
}

/// The closed audience reference carried by push requests and deferred jobs.
///
/// @ref LLP 0143#d2-the-send-lane — deferred sends bind the exact audience
///   arguments into the captured producer-principal grant.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PushAudienceReferenceV1 {
    pub audience: String,
    #[serde(default)]
    pub args: Map<String, Value>,
}

/// A mutation-captured authority grant for one exact deferred push send.
///
/// Kept in the shared contract leaf so the storage-owned durable-job row can
/// carry the closed grant shape without depending upward on push execution.
///
/// @ref LLP 0143#d2-the-send-lane — the later system action can consume this
///   grant only for the same audience arguments and dedupe key.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PushDeferredGrantV1 {
    pub(crate) producer_principal: String,
    pub(crate) to: PushAudienceReferenceV1,
    pub(crate) dedupe_key: String,
}

/// Stable identity of an ephemeral branch within one logical app.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct BranchId(pub String);

/// Closed outbound-effect posture for a managed in-app branch.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum ForkEgressPolicyV1 {
    #[default]
    DenyAll,
    CaptureOnly,
}

/// The authority mode declared by a schema artifact. The enum is deliberately
/// closed: a mode changes who is allowed to supply invocation authority and an
/// unknown spelling therefore cannot be treated as an additive field.
///
/// @ref LLP 0058#closed-auth-mode — auth mode is a must-understand closed value.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Deserialize,
    Eq,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    #[default]
    Dev,
    Sessions,
}

impl AuthMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Sessions => "sessions",
        }
    }

    pub const fn artifact_version(self) -> &'static str {
        match self {
            Self::Dev => "snapback.v0",
            Self::Sessions => "snapback.v1",
        }
    }
}

/// App-declared canonicalization contract for local-password identities.
/// The catalog stores the versioned value on first activation and refuses a
/// contradictory declaration thereafter.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
pub enum AuthPasswordIdentifierMode {
    #[default]
    #[serde(rename = "username-v1")]
    UsernameV1,
    #[serde(rename = "email-v1")]
    EmailV1,
}

pub const AUTH_PASSWORD_MINIMUM_LENGTH_DEFAULT: u16 = 12;
pub const AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR: u16 = 8;
pub const AUTH_PASSWORD_MINIMUM_LENGTH_CEILING: u16 = 128;

/// Closed schema-manifest auth declaration. Unknown members are rejected so a
/// future authority-changing field cannot be silently ignored by this parser.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AuthManifest {
    pub mode: AuthMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<AgentsManifest>,
    #[serde(
        default,
        rename = "passwordIdentifierMode",
        skip_serializing_if = "Option::is_none"
    )]
    pub password_identifier_mode: Option<AuthPasswordIdentifierMode>,
    #[serde(
        default,
        rename = "passwordMinimumLength",
        skip_serializing_if = "Option::is_none"
    )]
    #[schemars(range(
        min = AUTH_PASSWORD_MINIMUM_LENGTH_FLOOR,
        max = AUTH_PASSWORD_MINIMUM_LENGTH_CEILING
    ))]
    pub password_minimum_length: Option<u16>,
}

/// App-owned declaration of the outward-facing function surface. Absence (or
/// `enabled: false`) preserves the existing first-party/grant behavior; when
/// enabled, every function is closed unless its named entry opts in.
///
/// @ref LLP 0204#d1--the-exposure-declaration-keystone — exposure is one
/// declaration governing callability and public projections.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiManifest {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub disclosure: ApiDisclosure,
    #[serde(default)]
    pub functions: BTreeMap<String, ApiFunctionExposure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth: Option<ApiOAuthManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask: Option<ApiAskManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budgets: Option<ApiBudgetsManifest>,
}

/// Host-managed near-data AI surface. `model.secret` is a declaration name,
/// never secret material; caller-key material exists only for one request.
///
/// @ref LLP 0204#d5--surface-4-the-near-data-ai-interface — ask is opt-in,
///   names who pays, and reuses LLP 0036 declarations for app-paid keys.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskManifest {
    pub enabled: bool,
    pub billing: ApiAskBilling,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<ApiAskModelManifest>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ApiAskBilling {
    App,
    CallerKey,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskModelManifest {
    pub provider: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiBudgetsManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask: Option<ApiAskBudgets>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskBudgets {
    pub per_request: ApiAskPerRequestBudget,
    pub per_principal_day: ApiAskPerPrincipalDayBudget,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_integration_day: Option<ApiAskTokenBudget>,
    pub app_monthly: ApiAskTokenBudget,
    pub result_volume: ApiAskResultVolumeBudget,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskPerRequestBudget {
    pub max_tokens: u64,
    pub max_steps: u64,
    pub max_wall_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskPerPrincipalDayBudget {
    pub max_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskTokenBudget {
    pub max_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiAskResultVolumeBudget {
    pub max_bytes: u64,
    pub max_rows: u64,
    pub per_principal_day_bytes: u64,
}

/// Standards-interoperability projection over the native LLP 0150 ceremony.
/// Bundle names are the public OAuth scope vocabulary; activation resolves
/// their function names to the same stable id/kind pairs used by grants.
///
/// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — the
///   generated facade has no independent authority and bearer is an explicit
///   per-app weakening.
/// @ref LLP 0204#open-questions — OQ3 selects named bundles compiled at
///   activation rather than exposing canonical grant scopes as OAuth strings.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiOAuthManifest {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub bearer: bool,
    #[serde(default)]
    pub bundles: BTreeMap<String, ApiOAuthBundle>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiOAuthBundle {
    #[serde(default)]
    pub functions: Vec<String>,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum ApiDisclosure {
    #[default]
    ExposedOnly,
    Full,
}

/// Approval posture for externally reachable durable effects.
///
/// `required` gates every caller. `external` preserves direct first-party
/// session calls while gating service-principal, integration, and link lanes.
// @ref LLP 0204#d95--approval-gated-effects — this closed fact is compiled
// onto the function definition and therefore cannot diverge by ingress lane.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ApiFunctionApproval {
    Required,
    External,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApiFunctionExposure {
    #[serde(default)]
    pub expose: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApiFunctionApproval>,
}

/// App policy for creating new agent principals. Absence is deliberately
/// equivalent to `disabled` rather than opening an ambient signup surface.
///
/// @ref LLP 0055#registration — registration is sessions-only, disabled by
/// default, and user invitations require an explicit `invitedBy` opt-in.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentsManifest {
    #[serde(default)]
    pub mode: AgentsMode,
    #[serde(default)]
    pub invited_by: InvitedBy,
    /// Parse-time presence bit used only by declarations, never emitted on
    /// the wire. `api.enabled` needs to distinguish omitted mode (whose
    /// ordinary registration behavior still defaults closed) from an author
    /// explicitly selecting `disabled`.
    // @ref LLP 0204#d1--the-exposure-declaration-keystone — enabled external
    // surfaces require an explicit registration posture, including disabled.
    #[serde(skip)]
    #[schemars(skip)]
    pub mode_explicit: bool,
}

impl AgentsManifest {
    pub const fn explicit(mode: AgentsMode, invited_by: InvitedBy) -> Self {
        Self {
            mode,
            invited_by,
            mode_explicit: true,
        }
    }
}

impl<'de> Deserialize<'de> for AgentsManifest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct WireAgentsManifest {
            #[serde(default)]
            mode: Option<AgentsMode>,
            #[serde(default)]
            invited_by: InvitedBy,
        }

        let wire = WireAgentsManifest::deserialize(deserializer)?;
        Ok(Self {
            mode: wire.mode.unwrap_or_default(),
            invited_by: wire.invited_by,
            mode_explicit: wire.mode.is_some(),
        })
    }
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum AgentsMode {
    #[default]
    Disabled,
    Invited,
    Open,
}

impl AgentsMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Invited => "invited",
            Self::Open => "open",
        }
    }
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum InvitedBy {
    #[default]
    Operators,
    Users,
}

impl InvitedBy {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Operators => "operators",
            Self::Users => "users",
        }
    }
}

/// Function-level requirement applied after caller authority has been resolved.
/// Absence in a legacy function is represented by
/// [`FunctionDefinition::effective_auth_requirement`] as `optional-user`.
///
/// @ref LLP 0058#closed-function-requirement — closed values fail at manifest parse.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Deserialize,
    Eq,
    Ord,
    PartialEq,
    PartialOrd,
    Serialize,
    schemars::JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum AuthRequirement {
    Public,
    #[default]
    OptionalUser,
    Authenticated,
}

impl AuthRequirement {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::OptionalUser => "optional-user",
            Self::Authenticated => "authenticated",
        }
    }
}

/// Optional presentation identity for the loaded app: how the instance should
/// introduce itself to a human. Everything here is public by construction — it
/// is rendered on the public root page and flows into the public inspect
/// projection — so apps must not put secrets in it. The icon/wordmark URLs are
/// ordinary app-served or absolute URLs; the root page renders them as plain
/// `<img>` references with attribute escaping.
///
/// @ref LLP 0017#instance-home-page — the root page renders this identity when
///   the manifest declares it; absent, the page is Snapback-branded only.
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct AppIdentity {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "iconUrl", alias = "icon_url")]
    pub icon_url: Option<String>,
    #[serde(default, rename = "wordmarkUrl", alias = "wordmark_url")]
    pub wordmark_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct FieldManifest {
    pub name: String,
    pub field_type: FieldType,
    #[serde(default)]
    pub optional: bool,
}

/// The persisted logical descriptor and physical encoding identity for one
/// typed opaque structured field.
///
/// @ref LLP 0211#representation-and-write-path — the complete recursive
///   descriptor is durable validation authority; the encoding id is a
///   separately versioned storage-generation input.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredStructuredContractV1 {
    pub version: u8,
    pub descriptor: ResultValueContract,
    pub encoding: String,
}

pub const STORED_STRUCTURED_CONTRACT_VERSION_V1: u8 = 1;
pub const STORED_STRUCTURED_ENCODING_V1: &str = "canonical-json-text.v1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FieldType {
    String,
    /// A closed, declaration-ordered domain of two through eight exact string
    /// values. The authored order is part of manifest identity and generated
    /// TypeScript projection; storage remains the ordinary portable text
    /// representation.
    ///
    /// @ref LLP 0004#dated-alignment-stored-literal-union-domains-2026-08-08
    Enum {
        values: Vec<String>,
    },
    Boolean,
    Integer,
    Real,
    /// `v.vector(dimensions)` — an exact fixed-dimension binary64 vector.
    /// Ordinary arrays keep their separate 1,024-item contract ceiling.
    ///
    /// @ref LLP 0132#the-vvectordimensions-value
    Vector {
        dimensions: u32,
    },
    Json,
    /// One closed, schema-declared plain-data value stored as RFC 8785
    /// canonical JSON text. Its interior is intentionally opaque to indexes,
    /// filters, ordering, matchers, search, and maintained projections.
    ///
    /// The externally tagged variant keeps the carrier physically inside the
    /// field manifest, so both `contractHash` and `contract.encoding` enter
    /// schema/storage-generation identity.
    ///
    /// @ref LLP 0211#declaration-closed-dispatch-closed-interior — only the
    ///   closed structured-position leaf profile may reach this variant.
    Structured {
        contract: StoredStructuredContractV1,
        #[serde(rename = "contractHash", alias = "contract_hash")]
        contract_hash: String,
    },
    /// `v.principal()` — nominal typing over the auth-principal id string space
    /// (the same space as `ctx.auth.userId`, including LLP 0055 agent
    /// principals). It stores and compares exactly like [`FieldType::String`];
    /// the distinct variant lets the schema surface *name* an axis as a
    /// principal reference. It is validated by **shape**, never by a
    /// foreign-key existence check, because memberships may outlive a
    /// principal's deactivation and LLP 0055 recovery preserves the id.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — `v.principal()` is nominal
    ///   typing over the principal-id string space, not an existence check.
    Principal,
    /// `v.id("table")` — a nominal application-table id. The value remains a
    /// string on SQLite and the public wire, while the target table travels in
    /// the manifest so membership resource bindings and helper arguments can
    /// be checked rather than inferred from a bare string.
    ///
    /// @ref LLP 0056#rule-helpers — resource references must name the same
    ///   declared resource type; a plain string cannot prove that equality.
    Id {
        table: String,
    },
    /// Framework-owned relation-incarnation stamp. It is stored as a string,
    /// but unlike an application string it is never writable by application
    /// arguments. The paired required foreign-key field is the complete
    /// relationship declaration.
    ///
    /// @ref LLP 0110#protected-relation-incarnation-and-stamping — central
    ///   writers overwrite the stamp from the active parent registry.
    RelationIncarnation {
        #[serde(rename = "foreignKeyField", alias = "foreign_key_field")]
        foreign_key_field: String,
        #[serde(rename = "parentTable", alias = "parent_table")]
        parent_table: String,
    },
    /// `v.assetRef({ upload? })` — a typed asset reference (LLP 0044 §Typed
    /// references; LLP 0007 dated amendment 2026-07-31). Stored as the opaque
    /// asset id string; the commit boundary validates every write's
    /// admission, so a raw string assignment fails there rather than by
    /// shape. The optional `upload` restriction names the upload-intent
    /// binding whose assets the field admits and is what lets write paths
    /// without handler execution derive a commit-boundary admission.
    AssetRef {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        upload: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        media: Option<MediaFieldDescriptorV1>,
    },
}

#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum MediaKindV1 {
    Image,
    Video,
    Audio,
    File,
}

/// Closed operation vocabulary carried by generated collection mutations.
/// Application handlers cannot construct this plan through the public IR.
/// @ref LLP 0239#d2-assetcollection-is-the-zero-to-many-application-relation
#[derive(
    Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum AssetCollectionOperationV1 {
    Append,
    Replace,
    Remove,
    Reorder,
}

/// Digest-bound host instruction embedded in an ordinary MutationPlan. The
/// runtime revalidates every field against the paired schema descriptor before
/// it enters the transaction, so generated bytes cannot widen the collection.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetCollectionMutationPlanV1 {
    pub collection: String,
    pub generation: String,
    pub operation: AssetCollectionOperationV1,
    pub owner_table: String,
    pub owner_field: String,
    pub child_table: String,
    pub parent_id_arg: String,
    pub items_arg: String,
    pub max_items: u8,
    pub order: String,
    pub intent: String,
    pub kinds: Vec<MediaKindV1>,
    pub duplicate_policy: String,
    pub policy_generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sharing_arg: Option<String>,
    pub default_sharing_plan: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sharing_derivation_tables: Vec<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub sharing_grant_capable: bool,
}

/// Semantic facts for the finalized-only member of the AssetRef family.
/// The application column still contains only the opaque asset id.
/// @ref LLP 0244#d1-one-authoritative-media-result-materialization-cut
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaFieldDescriptorV1 {
    pub intent: String,
    pub policy: String,
    pub kinds: Vec<MediaKindV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delivery: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<String>,
    pub classification_profile: String,
    pub retention_class: String,
    pub target_capability: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IndexManifest {
    pub name: String,
    pub fields: Vec<String>,
    /// A true unique index. It is total when all key fields are required and
    /// unique-where-present when `where_applicable` is set.
    ///
    /// @ref LLP 0056#declaring-a-membership-table — the generated membership
    ///   index is true-unique; today's `IndexManifest` had no uniqueness flag.
    #[serde(default, skip_serializing_if = "is_false")]
    pub unique: bool,
    /// The portable unique-where-present profile. Every key component must be
    /// non-null for a row to participate; the carrier states this explicitly
    /// instead of asking adapters to infer it from field declarations.
    ///
    /// @ref LLP 0007#index-contract — optional unique keys use the all-present
    ///   compound rule and target partial unique indexes.
    #[serde(
        default,
        rename = "whereApplicable",
        alias = "where_applicable",
        skip_serializing_if = "is_false"
    )]
    pub where_applicable: bool,
}

/// The schema-expanded value grammar used to validate handler results at the
/// Rust publication boundary.
///
/// @ref LLP 0108#final-author-reconciliation-after-round-3 — result contracts
/// are Rust-owned, bounded, and carried by every generated function.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ResultValueContract {
    Null,
    Boolean,
    String {
        #[serde(rename = "maxBytes", alias = "max_bytes")]
        max_bytes: usize,
    },
    Integer {
        min: i64,
        max: i64,
    },
    FiniteReal {
        min: f64,
        max: f64,
    },
    Principal,
    /// A typed asset reference in a handler result. Its post-JSON wire image
    /// is the non-empty opaque asset id string; attachment authority remains
    /// a storage-commit concern rather than an egress-shape concern.
    AssetRef,
    /// The same-snapshot projection of one distinguished media field.
    #[serde(rename = "mediaRef.v1")]
    MediaRefV1 {
        #[serde(rename = "sourceTable")]
        source_table: String,
        #[serde(rename = "sourceField")]
        source_field: String,
        #[serde(rename = "sourceFieldGeneration")]
        source_field_generation: String,
        optional: bool,
        #[serde(rename = "classMTreatment")]
        class_m_treatment: String,
        #[serde(rename = "uploadIntent")]
        upload_intent: String,
        #[serde(rename = "policyGeneration")]
        policy_generation: String,
        kinds: Vec<MediaKindV1>,
        delivery: Option<String>,
        variants: Vec<String>,
        #[serde(rename = "classificationProfile")]
        classification_profile: String,
        #[serde(rename = "retentionClass")]
        retention_class: String,
    },
    Id {
        table: String,
    },
    Literal {
        value: Value,
    },
    Json {
        #[serde(rename = "maxDepth", alias = "max_depth")]
        max_depth: usize,
        #[serde(rename = "maxBytes", alias = "max_bytes")]
        max_bytes: usize,
    },
    Array {
        element: Box<ResultValueContract>,
        #[serde(rename = "maxItems", alias = "max_items")]
        max_items: usize,
    },
    /// A declaration-ordered heterogeneous fixed tuple. Snapshot-batch uses
    /// this closed node so each visible child page keeps its own projection
    /// contract instead of being widened to a homogeneous array.
    ///
    /// @ref LLP 0135#23-seal-entirely-partial-refusal — visible composite
    ///   nodes are an exact static tuple, not a bag of widened values.
    Tuple {
        elements: Vec<ResultValueContract>,
    },
    /// One exact fixed-dimension binary64 vector. This is intentionally not
    /// encoded as an ordinary array: dimensions may reach 4,096 while the
    /// general collection node remains capped at 1,024.
    ///
    /// @ref LLP 0132#the-vvectordimensions-value
    Vector {
        dimensions: u32,
    },
    Union {
        variants: Vec<ResultValueContract>,
    },
    Object {
        fields: Vec<ResultObjectFieldContract>,
        #[serde(rename = "allowExtra", alias = "allow_extra")]
        allow_extra: bool,
    },
    /// A reference to an entry in the closed, platform-owned registry of
    /// exported Rust-owned schemas. Valid only at argument positions in v1;
    /// not an app-authorable spelling — `defineSearchQuery` constructs it
    /// internally and no `v.*` builder emits it. The node contributes its
    /// authority class and reference id (never the referenced artifact's
    /// bytes) to the canonical hash form; artifact drift is gated by the
    /// schema-export drift test. The explicit `authority` member is a closed
    /// enum with exactly one admitted value in v1, so a future app-schema
    /// reference (option E) is a distinct authority class with
    /// digest-carrying identity rather than a silent reinterpretation.
    ///
    /// @ref LLP 0131#the-argument-contract-descriptor — PlatformSchemaRef is
    /// the one new node kind; v1's registry has exactly
    /// `snapback:search-query-ast:v1`.
    PlatformSchemaRef {
        authority: SchemaRefAuthority,
        schema: String,
    },
}

/// The closed authority classes a schema-reference node may name. V1 admits
/// exactly `platform`; hash-by-reference-id is a property of this class.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
pub enum SchemaRefAuthority {
    #[default]
    #[serde(rename = "platform")]
    Platform,
}

/// One closed object contract over a function's declared arguments:
/// declaration-ordered fields, each carrying a value node from the same node
/// vocabulary the result manifest uses (LLP 0131 — one node vocabulary, two
/// contract roots).
#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FunctionArgsContract {
    pub fields: Vec<ResultObjectFieldContract>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultObjectFieldContract {
    pub name: String,
    pub required: bool,
    pub value: ResultValueContract,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ResultRowsBound {
    #[serde(rename = "minItems", alias = "min_items")]
    pub min_items: usize,
    #[serde(rename = "maxItems", alias = "max_items")]
    pub max_items: usize,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum FunctionResultContract {
    #[default]
    Unknown,
    Documents {
        table: String,
        document: ResultValueContract,
    },
    Records {
        record: ResultValueContract,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows: Option<ResultRowsBound>,
    },
    Document {
        table: String,
        document: ResultValueContract,
    },
    Value {
        value: ResultValueContract,
    },
    LegacyQueryRowsV0 {
        row: ResultValueContract,
    },
}

/// One declared sequence counter and the structural proof that an invocation
/// may observe its allocation count. `public.v1` is deliberately a string on
/// the wire because it is the reviewed disclosure spelling pinned by LLP
/// 0135; non-public access names the membership declaration and exact roles
/// the host evaluates against the supplied scope row.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum SequenceScopeAccess {
    Public(String),
    Membership {
        declaration: String,
        roles: Vec<String>,
    },
    ExistingOwner(SequenceExistingOwnerAccess),
}

/// Generated-plan access proof. The function's normalized
/// `write-with-activity.v1` plan must carry the same scope table, owner field,
/// scope expression, and parent-unavailable refusal before this profile is
/// admitted; handlers cannot author this variant.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceExistingOwnerAccess {
    pub kind: String,
    pub owner_field: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceDeclaration {
    pub name: String,
    pub scope_table: String,
    pub scope_access: SequenceScopeAccess,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum PermissionScopeExpr {
    AuthUser,
    Arg(String),
    Literal(String),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SourceSpan {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

/// EffectCeilingV1 (LLP 0065 §1): the versioned conservative effect ceiling —
/// operations, tables, index ranges, host operations, and authorization
/// dependencies — recorded per generated function. `basis` is `"static"`
/// when the ceiling was proved by codegen's total default-deny traversal of
/// the closed plan vocabulary and `"declared"` when it restates author
/// declarations for an opaque handler.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeiling {
    pub version: String,
    pub basis: String,
    #[serde(default)]
    pub reads: Vec<EffectCeilingRead>,
    #[serde(default)]
    pub writes: Vec<EffectCeilingWrite>,
    #[serde(default, rename = "hostOperations", alias = "host_operations")]
    pub host_operations: Vec<String>,
    #[serde(
        default,
        rename = "authorizationInputs",
        alias = "authorization_inputs"
    )]
    pub authorization_inputs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeilingRead {
    pub table: String,
    /// `"point"` or `"query"`.
    pub access: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCeilingWrite {
    pub table: String,
    pub operations: Vec<String>,
}

/// The closed root-to-output key expression of a maintained projection
/// (LLP 0080 §5): the root `_id`, or the complete ordered tuple of a
/// declared unique root index whose fields the plan marks immutable, so an
/// output key cannot move under maintenance. Either form is injective over
/// roots by the uniqueness proof.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionOutputKey {
    RootId,
    RootUniqueIndex {
        index: String,
        /// The exact index fields, restated so the plan is self-describing
        /// and validation can prove the restatement matches the schema.
        fields: Vec<String>,
    },
}

/// Source/output visibility declaration for a maintained projection —
/// declarative (unlike the callable plan's executable filter lists) because
/// maintenance runs under internal projection-maintenance authority and the
/// declarations constrain information flow and the output's read
/// enforcement, not a caller (LLP 0080 §3/§5).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionVisibility {
    #[serde(rename = "public-read")]
    PublicRead,
    #[serde(rename = "owner")]
    Owner { field: String },
}

/// The versioned helper/profile identity a standard-pattern function carries
/// (LLP 0065 §3).
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternIdentity {
    pub helper: String,
    pub profile: String,
    /// Membership-specific generation facts for callable keyset pages. This
    /// block is closed and is admitted only for the exact
    /// `membership-keyset-pages.v1` / `membership.v1` pair.
    ///
    /// @ref LLP 0100#5-index-and-continuation-contract — membership cursor
    ///   custody binds the declaration, resource argument/field, and canonical
    ///   role set; other helpers must not smuggle an uninterpreted block.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub membership: Option<StandardPatternMembershipIdentity>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StandardPatternMembershipIdentity {
    pub declaration: String,
    #[serde(rename = "resourceArg", alias = "resource_arg")]
    pub resource_arg: String,
    #[serde(rename = "resourceField", alias = "resource_field")]
    pub resource_field: String,
    pub roles: Vec<String>,
}

#[derive(
    Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum BoundedParentVisibility {
    PublicRead,
    Owner { field: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BoundedProjectionField {
    pub name: String,
    pub field: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WriteActivityRelation {
    pub table: String,
    #[serde(rename = "scopeForeignKey", alias = "scope_foreign_key")]
    pub scope_foreign_key: String,
    #[serde(rename = "scopeIncarnation", alias = "scope_incarnation")]
    pub scope_incarnation: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WriteWithActivityMode {
    ExistingOwnerV1,
    CreateOwnerV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WriteWithActivitySourceOperation {
    Insert,
    Patch,
    Delete,
}

impl WriteWithActivitySourceOperation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Insert => "insert",
            Self::Patch => "patch",
            Self::Delete => "delete",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteActivityProvenanceFields {
    pub scope_id: String,
    pub source_table: String,
    pub source_id: String,
    pub operation: String,
    pub effective_subject: String,
    pub actual_actor: String,
    pub actor_kind: String,
    pub grant: String,
    pub occurred_at: String,
    pub mutation: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteWithActivityEffectFormula {
    pub scope_reads: u8,
    pub scope_patches: u8,
    pub auxiliary_point_reads: u8,
    pub source_writes: u8,
    pub activity_inserts: u8,
    pub runtime_ids: u8,
    pub runtime_now: u8,
    pub settlement_lookups: u8,
    pub settlement_writes: u8,
    /// Fixed host bookkeeping; v1 admits zero or one allocation.
    #[serde(default)]
    pub sequence_allocations: u8,
    pub maximum_application_writes: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum JoinKind {
    Inner,
    Left,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct JoinEquality {
    #[serde(rename = "rootField", alias = "root_field")]
    pub root_field: String,
    #[serde(rename = "joinedField", alias = "joined_field")]
    pub joined_field: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectionLeaf {
    pub name: String,
    pub source: ProjectionSource,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub enum ProjectionSource {
    RootField(String),
    JoinedField(String),
    Literal(Value),
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub struct DependencySummary {
    #[serde(default, rename = "primaryTable", alias = "primary_table")]
    pub primary_table: Option<String>,
    #[serde(default)]
    pub tables: Vec<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default, rename = "authScopeField", alias = "auth_scope_field")]
    pub auth_scope_field: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum FunctionKind {
    Query,
    Mutation,
    LiveQuery,
    Action,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
pub struct IbexModule {
    pub source: String,
    pub export: String,
}

// --- Completeness-proof wire shapes (LLP 0157 D2/D3 vocabulary) ---
//
// Pure page/proof identity records shared by the sync live protocol, the
// activation manifest, and the transport response types. Derivation,
// validation, and Ed25519 issuance live in `crate::completeness`
// (generation-activation-coordinator); only the shapes live on this leaf.

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CursorEndV1 {
    First,
    Cursor {
        #[serde(rename = "profileId")]
        profile_id: String,
        digest: String,
    },
    Terminal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum PageIdentityV1 {
    SealedTerminal {
        input: CursorEndV1,
        output: CursorEndV1,
    },
    Visible {
        input: CursorEndV1,
        #[serde(rename = "boundaryVectorDigest")]
        boundary_vector_digest: String,
        output: CursorEndV1,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofVersionV1 {
    pub stream: String,
    pub commit: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProofNodeIdentityV1 {
    pub position: u64,
    pub class_id: String,
    pub class_version: u64,
    pub node_plan_hash: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnsignedCompletenessProofV1 {
    pub format: String,
    pub materialization_key: String,
    pub query_instance_id: u64,
    pub activation_hash: String,
    pub plan_hash: String,
    pub version: ProofVersionV1,
    pub authorization_witness_digest: String,
    pub page: PageIdentityV1,
    pub nodes: Vec<ProofNodeIdentityV1>,
    pub batch_identity: String,
    pub result_digest: String,
    pub proof_key_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompletenessProofV1 {
    pub format: String,
    pub materialization_key: String,
    pub query_instance_id: u64,
    pub activation_hash: String,
    pub plan_hash: String,
    pub version: ProofVersionV1,
    pub authorization_witness_digest: String,
    pub page: PageIdentityV1,
    pub nodes: Vec<ProofNodeIdentityV1>,
    pub batch_identity: String,
    pub result_digest: String,
    pub proof_key_id: String,
    pub signature: String,
}

impl From<CompletenessProofV1> for UnsignedCompletenessProofV1 {
    fn from(proof: CompletenessProofV1) -> Self {
        Self {
            format: proof.format,
            materialization_key: proof.materialization_key,
            query_instance_id: proof.query_instance_id,
            activation_hash: proof.activation_hash,
            plan_hash: proof.plan_hash,
            version: proof.version,
            authorization_witness_digest: proof.authorization_witness_digest,
            page: proof.page,
            nodes: proof.nodes,
            batch_identity: proof.batch_identity,
            result_digest: proof.result_digest,
            proof_key_id: proof.proof_key_id,
        }
    }
}
