//! Exact v1 encodings and secret-bearing authentication types.

// @ref LLP 0057#binary-and-textual-encodings — auth identifiers, code digests, and bearer spellings are versioned protocol bytes.
// @ref LLP 0009#secrets — secret material crosses Rust boundaries only through explicit redacted, zeroizing wrappers.

use std::fmt;

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac as _};
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;
use unicode_normalization::UnicodeNormalization as _;
use zeroize::{Zeroize as _, Zeroizing};

use crate::diagnostic::SnapbackError;

const CHALLENGE_PREFIX: &str = "sbc_";
const KEY_PREFIX: &str = "sbak_";
const RESUME_KEY_PREFIX: &str = "sbrq_";
const SESSION_PREFIX: &str = "sbs_";
const SENDER_SESSION_PREFIX: &str = "sbs2_";
const IMPERSONATION_PREFIX: &str = "sbic_";
const DEV_IDENTITY_PREFIX: &str = "sbdev_";
const REHEARSAL_CAPABILITY_PREFIX: &str = "sbrc_";
const CODE_DIGEST_DOMAIN: &[u8] = b"snapback.auth.email-code.v1";
// @ref LLP 0039#dated-amendment-operation-bound-step-up-2026-07-15 — login
// and fresh-operation challenges share storage but never a digest domain.
const STEP_UP_DIGEST_DOMAIN: &[u8] = b"snapback.auth.step-up.v1";

// @ref LLP 0055#credentials-and-tokens — the five agent-principal secret
//   classes. They must be mutually prefix-free with every already-minted class
//   (asserted programmatically over `REGISTERED_CREDENTIAL_PREFIXES`); class
//   dispatch is structural on the prefix *before* resolver selection, so a
//   wrong-class credential is a typed mismatch, never an anonymous fall-through.
const AGENT_CREDENTIAL_PREFIX: &str = "sbac_";
const SCOPED_TOKEN_PREFIX: &str = "sbagt_";
const CREATION_INVITATION_PREFIX: &str = "sbagi_";
const RECOVERY_INVITATION_PREFIX: &str = "sbagr_";
const PAIRING_CODE_PREFIX: &str = "sbpc_";

/// Crypto failures deliberately carry no caller-controlled or secret input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    RandomUnavailable,
    InvalidCanonicalAddress,
    InvalidVerificationCode,
    InvalidChallengeId,
    InvalidKeyId,
    InvalidBearer,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RandomUnavailable => "operating-system randomness is unavailable",
            Self::InvalidCanonicalAddress => "invalid canonical address",
            Self::InvalidVerificationCode => "invalid verification code",
            Self::InvalidChallengeId => "invalid challenge id",
            Self::InvalidKeyId => "invalid auth key id",
            Self::InvalidBearer => "invalid auth bearer",
        })
    }
}

impl std::error::Error for CryptoError {}

/// Injectable CSPRNG boundary. Production uses [`OsRandom`]; tests can supply
/// exact byte streams and failure points without weakening production paths.
pub trait RandomSource: Send + Sync {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct OsRandom;

impl RandomSource for OsRandom {
    fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
        getrandom::fill(destination).map_err(|_| CryptoError::RandomUnavailable)
    }
}

/// V1's canonical email identity subject.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CanonicalAddress(String);

impl CanonicalAddress {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        // Controls are rejected before trimming. In particular, CR/LF cannot
        // be smuggled at an edge and then erased by whitespace trimming.
        if input.chars().any(char::is_control) {
            return Err(CryptoError::InvalidCanonicalAddress);
        }

        let trimmed = input.trim_matches(char::is_whitespace);
        let normalized: String = trimmed.nfc().collect();
        // `str::to_lowercase` applies Unicode's context-sensitive default
        // mapping to the complete string (notably Greek final sigma). Mapping
        // one `char` at a time would split canonically equivalent identities
        // and disagree with JavaScript's `String.prototype.toLowerCase`.
        let lowered = normalized.to_lowercase();

        if lowered.is_empty()
            || lowered.len() > 320
            || lowered
                .chars()
                .any(|character| character.is_whitespace() || character.is_control())
        {
            return Err(CryptoError::InvalidCanonicalAddress);
        }

        let mut parts = lowered.split('@');
        let local = parts.next().unwrap_or_default();
        let domain = parts.next().unwrap_or_default();
        if local.is_empty() || domain.is_empty() || parts.next().is_some() {
            return Err(CryptoError::InvalidCanonicalAddress);
        }

        Ok(Self(lowered))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for CanonicalAddress {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CanonicalAddress([REDACTED])")
    }
}

/// Exactly six ASCII digits, zeroized on drop.
pub struct VerificationCode(Zeroizing<[u8; 6]>);

impl VerificationCode {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        let bytes = input.as_bytes();
        if bytes.len() != 6 || !bytes.iter().all(u8::is_ascii_digit) {
            return Err(CryptoError::InvalidVerificationCode);
        }
        let mut code = [0_u8; 6];
        code.copy_from_slice(bytes);
        Ok(Self(Zeroizing::new(code)))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        const RANGE: u64 = 1_000_000;
        const ACCEPT_BELOW: u64 = ((u32::MAX as u64) + 1) / RANGE * RANGE;

        loop {
            let mut bytes = [0_u8; 4];
            if let Err(error) = random.fill(&mut bytes) {
                bytes.zeroize();
                return Err(error);
            }
            let sample = u32::from_be_bytes(bytes) as u64;
            bytes.zeroize();
            if sample >= ACCEPT_BELOW {
                continue;
            }

            let mut value = sample % RANGE;
            let mut code = [b'0'; 6];
            for digit in code.iter_mut().rev() {
                *digit += (value % 10) as u8;
                value /= 10;
            }
            return Ok(Self(Zeroizing::new(code)));
        }
    }

    pub fn expose_secret(&self) -> &str {
        // Construction proves this is always six ASCII digits.
        std::str::from_utf8(self.0.as_ref()).expect("verification code invariant")
    }
}

impl fmt::Debug for VerificationCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VerificationCode([REDACTED])")
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ChallengeId(String);

impl ChallengeId {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_prefixed_id(input, CHALLENGE_PREFIX)
            .map(Self)
            .map_err(|_| CryptoError::InvalidChallengeId)
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_prefixed_id(random, CHALLENGE_PREFIX).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ChallengeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_tuple("ChallengeId").field(&self.0).finish()
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct AuthKeyId(String);

impl AuthKeyId {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_prefixed_id(input, KEY_PREFIX)
            .map(Self)
            .map_err(|_| CryptoError::InvalidKeyId)
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_prefixed_id(random, KEY_PREFIX).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for AuthKeyId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Key ids are excluded from diagnostics alongside key material.
        formatter.write_str("AuthKeyId([REDACTED])")
    }
}

/// A resume-keyring key id (LLP 0091 §0A.1): the `AuthKeyId` shape under its
/// own registered prefix, carried inside `sbrt1.` resume-token envelopes. An
/// identifier, never a bearer. (LLP 0091 names `sbrk_` for this class, but
/// that prefix was already registered to the secret-read root key before 0091
/// landed; `sbrq_` is the collision-free spelling — reported as a 0091
/// erratum.)
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ResumeKeyId(String);

impl ResumeKeyId {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_prefixed_id(input, RESUME_KEY_PREFIX)
            .map(Self)
            .map_err(|_| CryptoError::InvalidKeyId)
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_prefixed_id(random, RESUME_KEY_PREFIX).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ResumeKeyId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ResumeKeyId([REDACTED])")
    }
}

pub struct AuthKeyMaterial(Zeroizing<[u8; 32]>);

impl AuthKeyMaterial {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        let mut bytes = [0_u8; 32];
        if let Err(error) = random.fill(&mut bytes) {
            bytes.zeroize();
            return Err(error);
        }
        Ok(Self::from_bytes(bytes))
    }

    pub fn expose_secret(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn encode_base64(&self) -> Zeroizing<String> {
        Zeroizing::new(encode_base64url(self.0.as_ref()))
    }
}

impl fmt::Debug for AuthKeyMaterial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AuthKeyMaterial([REDACTED])")
    }
}

pub struct CodeDigest(Zeroizing<[u8; 32]>);

impl CodeDigest {
    pub fn compute(
        key: &AuthKeyMaterial,
        challenge_id: &ChallengeId,
        address: &CanonicalAddress,
        code: &VerificationCode,
    ) -> Self {
        let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
            .expect("HMAC-SHA-256 accepts every key length");
        update_lp(&mut mac, CODE_DIGEST_DOMAIN);
        update_lp(&mut mac, challenge_id.as_str().as_bytes());
        update_lp(&mut mac, address.as_str().as_bytes());
        update_lp(&mut mac, code.expose_secret().as_bytes());
        let mut output = mac.finalize().into_bytes();
        let mut digest = [0_u8; 32];
        digest.copy_from_slice(&output);
        output.as_mut_slice().zeroize();
        Self(Zeroizing::new(digest))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn verify(&self, expected: &[u8]) -> bool {
        expected.len() == 32 && bool::from(self.0.as_ref().ct_eq(expected))
    }
}

/// A verification-code digest for one exact fresh-authentication operation.
/// The distinct domain makes ordinary login challenges and step-up challenges
/// cryptographically non-interchangeable even though they share the bounded
/// durable challenge table and process-local capture mailbox.
#[derive(Clone, Eq, PartialEq)]
pub struct StepUpDigest(Zeroizing<[u8; 32]>);

#[derive(Clone, Eq, PartialEq)]
pub struct StepUpProof {
    pub challenge_id: ChallengeId,
    pub address: CanonicalAddress,
    pub key_id: Option<AuthKeyId>,
    pub submitted_digest: StepUpDigest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StepUpConsumption {
    Verified,
    Rejected,
}

impl fmt::Debug for StepUpProof {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpProof([REDACTED])")
    }
}

pub fn step_up_required_error() -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_STEP_UP_REQUIRED",
        "auth",
        "authority-creating consent requires fresh step-up authentication",
    )
}

impl StepUpDigest {
    #[allow(clippy::too_many_arguments)]
    pub fn compute(
        key: &AuthKeyMaterial,
        challenge_id: &ChallengeId,
        address: &CanonicalAddress,
        user_id: &str,
        session_id: &str,
        session_generation: u64,
        authority_instance_id: &str,
        operation: &str,
        target_id: &str,
        code: &VerificationCode,
    ) -> Self {
        let mut mac = Hmac::<Sha256>::new_from_slice(key.expose_secret())
            .expect("HMAC-SHA-256 accepts every key length");
        update_lp(&mut mac, STEP_UP_DIGEST_DOMAIN);
        update_lp(&mut mac, challenge_id.as_str().as_bytes());
        update_lp(&mut mac, address.as_str().as_bytes());
        update_lp(&mut mac, user_id.as_bytes());
        update_lp(&mut mac, session_id.as_bytes());
        update_lp(&mut mac, &session_generation.to_be_bytes());
        update_lp(&mut mac, authority_instance_id.as_bytes());
        update_lp(&mut mac, operation.as_bytes());
        update_lp(&mut mac, target_id.as_bytes());
        update_lp(&mut mac, code.expose_secret().as_bytes());
        let mut output = mac.finalize().into_bytes();
        let mut digest = [0_u8; 32];
        digest.copy_from_slice(&output);
        output.as_mut_slice().zeroize();
        Self(Zeroizing::new(digest))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn verify(&self, expected: &[u8]) -> bool {
        expected.len() == 32 && bool::from(self.0.as_ref().ct_eq(expected))
    }
}

impl fmt::Debug for StepUpDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StepUpDigest([REDACTED])")
    }
}

impl fmt::Debug for CodeDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CodeDigest([REDACTED])")
    }
}

pub struct TokenHash(Zeroizing<[u8; 32]>);

impl TokenHash {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn verify(&self, expected: &[u8]) -> bool {
        expected.len() == 32 && bool::from(self.0.as_ref().ct_eq(expected))
    }
}

impl fmt::Debug for TokenHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TokenHash([REDACTED])")
    }
}

pub struct SessionBearer(Zeroizing<String>);

impl SessionBearer {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_bearer(input, SESSION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_bearer(random, SESSION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn parse_sender_v2(input: &str) -> Result<Self, CryptoError> {
        parse_bearer(input, SENDER_SESSION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4: accepts both session
    // spellings. `sbs_` is the plain bearer class; `sbs2_` is the
    // sender-constrained class the exchange mints for sender-bound issuance.
    // Which spelling a surface actually honors is decided by the durable
    // family binding plus the spelling checks in `sender_proof.rs`, not here.
    pub fn parse_any_version(input: &str) -> Result<Self, CryptoError> {
        Self::parse(input).or_else(|_| Self::parse_sender_v2(input))
    }

    // @ref LLP 0077#author-decisions--2026-07-23 — decision 4's first layer: the
    // production exchange mints sender-bound sessions with the structurally
    // distinct `sbs2_` spelling a v1 verifier cannot accept.
    pub fn generate_sender_v2(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_bearer(random, SENDER_SESSION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    pub fn token_hash(&self) -> TokenHash {
        hash_bearer(self.expose_secret().as_bytes())
    }
}

impl fmt::Debug for SessionBearer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionBearer([REDACTED])")
    }
}

pub struct ImpersonationBearer(Zeroizing<String>);

impl ImpersonationBearer {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_bearer(input, IMPERSONATION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_bearer(random, IMPERSONATION_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    pub fn token_hash(&self) -> TokenHash {
        hash_bearer(self.expose_secret().as_bytes())
    }
}

impl fmt::Debug for ImpersonationBearer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ImpersonationBearer([REDACTED])")
    }
}

/// One process-bound developer-identity custody capability.
///
/// @ref LLP 0262#d1-the-dev-identity-capability — dev identity uses its own
///   registered `sbdev_` credential class and the shared 256-bit bearer
///   spelling; it is never an `Authorization` credential.
pub struct DevIdentityBearer(Zeroizing<String>);

impl DevIdentityBearer {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_bearer(input, DEV_IDENTITY_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_bearer(random, DEV_IDENTITY_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    pub fn token_hash(&self) -> TokenHash {
        hash_bearer(self.expose_secret().as_bytes())
    }
}

impl fmt::Debug for DevIdentityBearer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DevIdentityBearer([REDACTED])")
    }
}

/// One auth-rehearsal grant capability. The request resolver retains only the
/// SHA-256 digest; plaintext exists in this zeroizing, redacted carrier long
/// enough to publish the mint response or its owner-only local sidecar.
///
/// @ref LLP 0213#local-wave-1-carrier-custody — rehearsal capabilities use a
///   dedicated prefix, 256 CSPRNG bits, the shared lowercase CRC-32 spelling,
///   and never serialize through an ordinary DTO.
pub struct RehearsalBearer(Zeroizing<String>);

impl RehearsalBearer {
    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        parse_bearer(input, REHEARSAL_CAPABILITY_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
        mint_bearer(random, REHEARSAL_CAPABILITY_PREFIX).map(|value| Self(Zeroizing::new(value)))
    }

    pub fn expose_secret(&self) -> &str {
        &self.0
    }

    pub fn token_hash(&self) -> TokenHash {
        hash_bearer(self.expose_secret().as_bytes())
    }
}

impl fmt::Debug for RehearsalBearer {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RehearsalBearer([REDACTED])")
    }
}

/// Declares one LLP 0055 credential newtype that rides the shared 32-byte +
/// CRC-32 bearer spelling under a dedicated, prefix-free class prefix. Every
/// class carries a distinct prefix so structural dispatch is unambiguous, a
/// redacted `Debug`, and a zeroizing buffer — the same secret-hygiene contract
/// as `SessionBearer`.
macro_rules! agent_secret_bearer {
    ($name:ident, $prefix:ident, $debug:literal) => {
        pub struct $name(Zeroizing<String>);

        impl $name {
            pub fn parse(input: &str) -> Result<Self, CryptoError> {
                parse_bearer(input, $prefix).map(|value| Self(Zeroizing::new(value)))
            }

            pub fn generate(random: &dyn RandomSource) -> Result<Self, CryptoError> {
                mint_bearer(random, $prefix).map(|value| Self(Zeroizing::new(value)))
            }

            #[cfg_attr(not(test), allow(dead_code))]
            pub fn expose_secret(&self) -> &str {
                &self.0
            }

            #[cfg_attr(not(test), allow(dead_code))]
            pub fn token_hash(&self) -> TokenHash {
                hash_bearer(self.expose_secret().as_bytes())
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str($debug)
            }
        }
    };
}

// @ref LLP 0055#credentials-and-tokens — long-lived agent credential (`sbac_`),
//   short-lived scoped token (`sbagt_`), single-use creation (`sbagi_`) and
//   recovery (`sbagr_`) invitations, and the user-minted pairing code
//   (`sbpc_`). All stored hashed; the lifecycle that consumes them is G3/G4.
agent_secret_bearer!(
    AgentCredential,
    AGENT_CREDENTIAL_PREFIX,
    "AgentCredential([REDACTED])"
);
agent_secret_bearer!(ScopedToken, SCOPED_TOKEN_PREFIX, "ScopedToken([REDACTED])");
agent_secret_bearer!(
    CreationInvitation,
    CREATION_INVITATION_PREFIX,
    "CreationInvitation([REDACTED])"
);
agent_secret_bearer!(
    RecoveryInvitation,
    RECOVERY_INVITATION_PREFIX,
    "RecoveryInvitation([REDACTED])"
);
agent_secret_bearer!(PairingCode, PAIRING_CODE_PREFIX, "PairingCode([REDACTED])");

/// Every credential/secret class the repository mints, named for structural
/// prefix dispatch. Classification runs on the registered prefix **before** any
/// resolver is selected: a bearer of one class reaching another's surface is a
/// typed `CREDENTIAL_CLASS_MISMATCH`, never a fall-through and never a
/// retry-as-anonymous.
///
/// @ref LLP 0055#credentials-and-tokens — the registered, collision-checked,
///   prefix-free namespace; `sbrp_`/`sbrm_` are a nonce and a MAC that never
///   authenticate.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CredentialClass {
    /// `sbs_` — human/app session bearer (LLP 0057/0039).
    Session,
    /// `sbs2_` — sender-constrained browser session bearer. The v1 parser for
    /// `sbs_` cannot accept this versioned spelling.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — decision 4's first layer (the
    /// legacy-rejecting versioned prefix): the exchange mints sender-bound
    /// sessions with this spelling, refresh keeps successors in it, and the
    /// sender-proof verifier refuses the `sbs_` spelling for sender-bound
    /// families, so a pre-sender v1 server presented an `sbs2_` bearer fails
    /// structurally instead of honoring it as a plain bearer.
    SenderSession,
    /// `sbic_` — the operator-plane impersonation-capability carrier (LLP 0057).
    ImpersonationCapability,
    /// `sbdev_` — app-plane developer-identity custody capability (LLP 0262).
    DevIdentityCapability,
    /// `sbrc_` — finite auth-rehearsal grant authority (LLP 0213).
    RehearsalCapability,
    /// `sbac_` — long-lived agent credential (LLP 0055).
    AgentCredential,
    /// `sbagt_` — short-lived scoped token (LLP 0055).
    ScopedToken,
    /// `sbagi_` — single-use creation invitation (LLP 0055).
    CreationInvitation,
    /// `sbagr_` — single-use recovery invitation (LLP 0055).
    RecoveryInvitation,
    /// `sbpc_` — the user-minted pairing code (LLP 0055).
    PairingCode,
    /// `sbc_` — an email-code challenge id; an identifier, not a bearer.
    ChallengeId,
    /// `sbak_` — an auth key id; an identifier, not a bearer.
    AuthKeyId,
    /// `sbat_` — the local admin token.
    AdminToken,
    /// `sbcc_` — a browser console client credential.
    ConsoleCredential,
    /// `sct_` — a WebSocket connection token.
    ConnectionToken,
    /// `sct2_` — a sender-constrained v2 connection token. A v1 connection
    /// token parser cannot accept this structurally distinct spelling.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — decision 4, issued exactly as
    /// `SenderSession` above: sender-bound connection-open mints `sct2_`
    /// grants, and the sender grant lane requires the v2 spelling.
    SenderConnectionToken,
    /// `sbrk_` — the secret-read root key.
    SecretReadRootKey,
    /// `sbrl_` — a secret-read lease bearer.
    SecretReadLease,
    /// `sbrp_` — a secret-read startup-proof nonce. **Never authenticates.**
    SecretReadProofNonce,
    /// `sbrm_` — a secret-read startup-proof MAC. **Never authenticates.**
    SecretReadProofMac,
    /// `sbrq_` — a resume-keyring key id (LLP 0091 §0A.1); an identifier,
    /// not a bearer.
    ResumeKeyId,
}

impl CredentialClass {
    /// The exact registered prefix for this class.
    pub fn prefix(self) -> &'static str {
        match self {
            Self::Session => SESSION_PREFIX,
            Self::SenderSession => SENDER_SESSION_PREFIX,
            Self::ImpersonationCapability => IMPERSONATION_PREFIX,
            Self::DevIdentityCapability => DEV_IDENTITY_PREFIX,
            Self::RehearsalCapability => REHEARSAL_CAPABILITY_PREFIX,
            Self::AgentCredential => AGENT_CREDENTIAL_PREFIX,
            Self::ScopedToken => SCOPED_TOKEN_PREFIX,
            Self::CreationInvitation => CREATION_INVITATION_PREFIX,
            Self::RecoveryInvitation => RECOVERY_INVITATION_PREFIX,
            Self::PairingCode => PAIRING_CODE_PREFIX,
            Self::ChallengeId => CHALLENGE_PREFIX,
            Self::AuthKeyId => KEY_PREFIX,
            Self::AdminToken => "sbat_",
            Self::ConsoleCredential => "sbcc_",
            Self::ConnectionToken => "sct_",
            Self::SenderConnectionToken => "sct2_",
            Self::SecretReadRootKey => "sbrk_",
            Self::SecretReadLease => "sbrl_",
            Self::SecretReadProofNonce => "sbrp_",
            Self::SecretReadProofMac => "sbrm_",
            Self::ResumeKeyId => RESUME_KEY_PREFIX,
        }
    }

    // NOTE: there is deliberately no `is_session()` fold over `Session` and
    // `SenderSession`. Such a fold would pre-declare that a v1 `sbs_` bearer
    // satisfies any check written against the sender-constrained class — the
    // opposite of what the class exists for
    // (issues/closed/20260725-sender-constrained-classes-unwired.md). Call
    // sites that admit both classes match both explicitly.

    /// Whether a value of this class can ever resolve to live authority when
    /// presented as a bearer. Identifiers (`sbc_`, `sbak_`) and the secret-read
    /// proof nonce/MAC (`sbrp_`, `sbrm_`) are structurally non-authenticating —
    /// presenting one at any authenticating surface is a class mismatch, never
    /// authority.
    ///
    /// @ref LLP 0055#credentials-and-tokens — `sbrp_`/`sbrm_` are a nonce and a
    ///   MAC; they must NEVER authenticate.
    pub fn is_authenticating(self) -> bool {
        !matches!(
            self,
            Self::ChallengeId
                | Self::AuthKeyId
                | Self::ResumeKeyId
                | Self::SecretReadProofNonce
                | Self::SecretReadProofMac
        )
    }
}

/// The complete registered credential namespace. Every entry is asserted
/// mutually prefix-free (`credential_prefixes_are_mutually_prefix_free`) as a
/// protocol invariant. Classification also chooses the longest match so a
/// versioned extension cannot be swallowed during a staged namespace change.
pub const REGISTERED_CREDENTIAL_PREFIXES: &[(&str, CredentialClass)] = &[
    (SESSION_PREFIX, CredentialClass::Session),
    (SENDER_SESSION_PREFIX, CredentialClass::SenderSession),
    (
        IMPERSONATION_PREFIX,
        CredentialClass::ImpersonationCapability,
    ),
    (DEV_IDENTITY_PREFIX, CredentialClass::DevIdentityCapability),
    (
        REHEARSAL_CAPABILITY_PREFIX,
        CredentialClass::RehearsalCapability,
    ),
    (AGENT_CREDENTIAL_PREFIX, CredentialClass::AgentCredential),
    (SCOPED_TOKEN_PREFIX, CredentialClass::ScopedToken),
    (
        CREATION_INVITATION_PREFIX,
        CredentialClass::CreationInvitation,
    ),
    (
        RECOVERY_INVITATION_PREFIX,
        CredentialClass::RecoveryInvitation,
    ),
    (PAIRING_CODE_PREFIX, CredentialClass::PairingCode),
    (CHALLENGE_PREFIX, CredentialClass::ChallengeId),
    (KEY_PREFIX, CredentialClass::AuthKeyId),
    ("sbat_", CredentialClass::AdminToken),
    ("sbcc_", CredentialClass::ConsoleCredential),
    ("sct_", CredentialClass::ConnectionToken),
    ("sct2_", CredentialClass::SenderConnectionToken),
    ("sbrk_", CredentialClass::SecretReadRootKey),
    ("sbrl_", CredentialClass::SecretReadLease),
    ("sbrp_", CredentialClass::SecretReadProofNonce),
    ("sbrm_", CredentialClass::SecretReadProofMac),
    (RESUME_KEY_PREFIX, CredentialClass::ResumeKeyId),
];

fn classify_credential_from(
    input: &str,
    prefixes: &[(&str, CredentialClass)],
) -> Option<CredentialClass> {
    prefixes
        .iter()
        .filter(|(prefix, _)| input.starts_with(prefix))
        .max_by_key(|(prefix, _)| prefix.len())
        .map(|(_, class)| *class)
}

/// Structurally classify a presented credential by its longest registered
/// prefix. An unregistered spelling returns `None` (an unknown class, which
/// callers must still refuse — never treat as anonymous).
///
/// @ref LLP 0077#credential-classes — v2 sender credentials retain their
/// structurally distinct `sbs2_`/`sct2_` spellings through class dispatch.
pub fn classify_credential(input: &str) -> Option<CredentialClass> {
    classify_credential_from(input, REGISTERED_CREDENTIAL_PREFIXES)
}

/// The outcome of asserting a presented credential belongs to the class a
/// resolver expects. Carries only class tags — never caller-controlled or
/// secret bytes — so it is safe to surface in a typed diagnostic.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CredentialClassMismatch {
    pub expected: CredentialClass,
    /// The structurally-detected class, or `None` for an unregistered prefix.
    pub actual: Option<CredentialClass>,
}

impl CredentialClassMismatch {
    /// The typed refusal a resolver returns for a wrong-class credential. It
    /// carries only class prefixes (never caller bytes) so it is safe to
    /// surface. This is the single producer of the code — a wrong-class
    /// credential is always this, never an anonymous fall-through.
    ///
    /// @ref LLP 0055#credentials-and-tokens — a credential of one class
    ///   reaching another's surface is a typed `CREDENTIAL_CLASS_MISMATCH`.
    pub fn into_snapback_error(self) -> crate::diagnostic::SnapbackError {
        crate::diagnostic::SnapbackError::error(
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH",
            "auth",
            "a credential was presented on a surface that resolves a different class",
        )
        .with_details(serde_json::json!({
            "expectedPrefix": self.expected.prefix(),
            "presentedPrefix": self.actual.map(CredentialClass::prefix),
        }))
    }
}

/// Assert, structurally and before any resolver runs, that `input` is of the
/// `expected` class. A wrong or unknown class is a [`CredentialClassMismatch`]
/// that the caller maps to `SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH` — the
/// resolver is never invoked and there is no anonymous fall-through.
///
/// @ref LLP 0055#credentials-and-tokens — class dispatch is structural on
///   the prefix before resolver selection; a wrong-class credential is a typed
///   mismatch.
pub fn dispatch_credential_class(
    input: &str,
    expected: CredentialClass,
) -> Result<CredentialClass, CredentialClassMismatch> {
    match classify_credential(input) {
        Some(actual) if actual == expected => Ok(actual),
        actual => Err(CredentialClassMismatch { expected, actual }),
    }
}

fn update_lp(mac: &mut Hmac<Sha256>, bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("auth digest component length fits u32");
    mac.update(&length.to_be_bytes());
    mac.update(bytes);
}

fn parse_prefixed_id(input: &str, prefix: &str) -> Result<String, ()> {
    let encoded = input.strip_prefix(prefix).ok_or(())?;
    let mut bytes = decode_canonical_base64url::<16>(encoded).map_err(|_| ())?;
    bytes.zeroize();
    Ok(input.to_owned())
}

fn mint_prefixed_id(random: &dyn RandomSource, prefix: &str) -> Result<String, CryptoError> {
    let mut bytes = [0_u8; 16];
    if let Err(error) = random.fill(&mut bytes) {
        bytes.zeroize();
        return Err(error);
    }
    let encoded = encode_base64url(&bytes);
    bytes.zeroize();
    Ok(format!("{prefix}{encoded}"))
}

fn mint_bearer(random: &dyn RandomSource, prefix: &str) -> Result<String, CryptoError> {
    let mut bytes = [0_u8; 32];
    if let Err(error) = random.fill(&mut bytes) {
        bytes.zeroize();
        return Err(error);
    }
    let encoded = Zeroizing::new(encode_base64url(&bytes));
    let checksum = crc32fast::hash(&bytes);
    bytes.zeroize();
    Ok(format!("{prefix}{}.{checksum:08x}", encoded.as_str()))
}

fn parse_bearer(input: &str, prefix: &str) -> Result<String, CryptoError> {
    let expected_len = prefix.len() + 43 + 1 + 8;
    if input.len() != expected_len {
        return Err(CryptoError::InvalidBearer);
    }
    let body = input
        .strip_prefix(prefix)
        .ok_or(CryptoError::InvalidBearer)?;
    let (encoded, checksum_text) = body.rsplit_once('.').ok_or(CryptoError::InvalidBearer)?;
    if checksum_text.len() != 8
        || !checksum_text
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(CryptoError::InvalidBearer);
    }

    let mut bytes = decode_canonical_base64url::<32>(encoded)?;
    let expected_checksum =
        u32::from_str_radix(checksum_text, 16).map_err(|_| CryptoError::InvalidBearer)?;
    let actual_checksum = crc32fast::hash(&bytes);
    bytes.zeroize();
    if actual_checksum != expected_checksum {
        return Err(CryptoError::InvalidBearer);
    }
    Ok(input.to_owned())
}

fn hash_bearer(bytes: &[u8]) -> TokenHash {
    let mut output = Sha256::digest(bytes);
    let mut digest = [0_u8; 32];
    digest.copy_from_slice(&output);
    output.as_mut_slice().zeroize();
    TokenHash::from_bytes(digest)
}

pub fn encode_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode_canonical_base64url<const N: usize>(
    encoded: &str,
) -> Result<[u8; N], CryptoError> {
    if encoded.is_empty() || encoded.contains('=') {
        return Err(CryptoError::InvalidBearer);
    }
    let mut decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| CryptoError::InvalidBearer)?;
    let canonical = Zeroizing::new(encode_base64url(&decoded));
    if decoded.len() != N || canonical.as_str() != encoded {
        decoded.zeroize();
        return Err(CryptoError::InvalidBearer);
    }
    let mut output = [0_u8; N];
    output.copy_from_slice(&decoded);
    decoded.zeroize();
    Ok(output)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::*;

    #[derive(Debug)]
    struct ScriptedRandom {
        chunks: Mutex<VecDeque<Result<Vec<u8>, CryptoError>>>,
    }

    impl ScriptedRandom {
        fn new(chunks: impl IntoIterator<Item = Vec<u8>>) -> Self {
            Self {
                chunks: Mutex::new(chunks.into_iter().map(Ok).collect()),
            }
        }

        fn failing() -> Self {
            Self {
                chunks: Mutex::new(VecDeque::from([Err(CryptoError::RandomUnavailable)])),
            }
        }
    }

    impl RandomSource for ScriptedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            let chunk = self
                .chunks
                .lock()
                .unwrap()
                .pop_front()
                .expect("scripted random exhausted")?;
            assert_eq!(chunk.len(), destination.len());
            destination.copy_from_slice(&chunk);
            Ok(())
        }
    }

    #[test]
    fn canonical_address_pins_order_and_boundaries() {
        let address = CanonicalAddress::parse("\u{00a0}CAFE\u{301}@EXAMPLE.COM\u{00a0}").unwrap();
        assert_eq!(address.as_str(), "café@example.com");

        let dotted_i = CanonicalAddress::parse("İ@EXAMPLE.COM").unwrap();
        assert_eq!(dotted_i.as_str(), "i\u{307}@example.com");

        let final_sigma_upper = CanonicalAddress::parse("ΟΣ@EXAMPLE.COM").unwrap();
        let final_sigma_lower = CanonicalAddress::parse("ος@example.com").unwrap();
        assert_eq!(final_sigma_upper.as_str(), "ος@example.com");
        assert_eq!(final_sigma_upper, final_sigma_lower);

        assert!(CanonicalAddress::parse("person\n@example.com").is_err());
        assert!(CanonicalAddress::parse("person @example.com").is_err());
        assert!(CanonicalAddress::parse("person@example.com@example.net").is_err());
        assert!(CanonicalAddress::parse("@example.com").is_err());
        assert!(CanonicalAddress::parse("person@").is_err());

        let exact_limit = format!("{}@x", "a".repeat(318));
        assert_eq!(exact_limit.len(), 320);
        assert!(CanonicalAddress::parse(&exact_limit).is_ok());
        let too_long = format!("{}@x", "a".repeat(319));
        assert!(CanonicalAddress::parse(&too_long).is_err());
    }

    #[test]
    fn login_and_step_up_digest_domains_are_not_interchangeable() {
        let random = ScriptedRandom::new([vec![7_u8; 16]]);
        let challenge = ChallengeId::generate(&random).unwrap();
        let address = CanonicalAddress::parse("person@example.com").unwrap();
        let code = VerificationCode::parse("123456").unwrap();
        let key = AuthKeyMaterial::from_bytes([9_u8; 32]);
        let login = CodeDigest::compute(&key, &challenge, &address, &code);
        let step_up = StepUpDigest::compute(
            &key,
            &challenge,
            &address,
            "user-a",
            "session-a",
            1,
            "authority-a",
            "grantApproval",
            "request-a",
            &code,
        );
        assert!(!step_up.verify(login.as_bytes()));
        assert!(!login.verify(step_up.as_bytes()));
    }

    #[test]
    fn six_digit_sampling_rejects_modulo_bias_and_propagates_rng_failure() {
        let random = ScriptedRandom::new([
            u32::MAX.to_be_bytes().to_vec(),
            42_u32.to_be_bytes().to_vec(),
        ]);
        let code = VerificationCode::generate(&random).unwrap();
        assert_eq!(code.expose_secret(), "000042");
        assert_eq!(format!("{code:?}"), "VerificationCode([REDACTED])");
        assert!(VerificationCode::parse("12345").is_err());
        assert!(VerificationCode::parse("12345x").is_err());
        assert_eq!(
            VerificationCode::generate(&ScriptedRandom::failing()).unwrap_err(),
            CryptoError::RandomUnavailable
        );
    }

    #[test]
    fn ids_require_canonical_unpadded_base64url() {
        let random = ScriptedRandom::new([vec![0_u8; 16], vec![0_u8; 16]]);
        let challenge = ChallengeId::generate(&random).unwrap();
        let key_id = AuthKeyId::generate(&random).unwrap();
        assert_eq!(challenge.as_str(), "sbc_AAAAAAAAAAAAAAAAAAAAAA");
        assert_eq!(key_id.as_str(), "sbak_AAAAAAAAAAAAAAAAAAAAAA");
        assert!(ChallengeId::parse(challenge.as_str()).is_ok());
        assert!(AuthKeyId::parse(key_id.as_str()).is_ok());
        assert!(ChallengeId::parse("sbc_AAAAAAAAAAAAAAAAAAAAAA==").is_err());
        assert!(AuthKeyId::parse("sbak_AAAAAAAAAAAAAAAAAAAAA_").is_err());
    }

    #[test]
    fn length_prefix_and_hmac_fixed_vector() {
        let key = AuthKeyMaterial::from_bytes(std::array::from_fn(|index| index as u8));
        let challenge = ChallengeId::parse("sbc_AAAAAAAAAAAAAAAAAAAAAA").unwrap();
        let address = CanonicalAddress::parse("CAFÉ@EXAMPLE.COM").unwrap();
        let code = VerificationCode::parse("012345").unwrap();
        let digest = CodeDigest::compute(&key, &challenge, &address, &code);

        assert_eq!(
            hex(digest.as_bytes()),
            "a20020496edbc0952087cb4053d12f5cd8a2a800335046cafaae36597d6fbd47"
        );
        assert!(digest.verify(digest.as_bytes()));
        assert!(!digest.verify(&[0_u8; 32]));
        assert_eq!(format!("{digest:?}"), "CodeDigest([REDACTED])");
        assert_eq!(format!("{key:?}"), "AuthKeyMaterial([REDACTED])");
    }

    #[test]
    fn bearer_crc_shape_and_hash_fixed_vectors() {
        let random = ScriptedRandom::new([vec![0_u8; 32], vec![0_u8; 32], vec![0_u8; 32]]);
        let session = SessionBearer::generate(&random).unwrap();
        assert_eq!(
            session.expose_secret(),
            "sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad"
        );
        assert_eq!(session.expose_secret().len(), 56);
        assert_eq!(
            hex(session.token_hash().as_bytes()),
            "9d1a7107cb91bc1fe07a5a9222f52e48cbf1c226fb0f9ebf4937e703819abbeb"
        );
        let sender = SessionBearer::generate_sender_v2(&random).unwrap();
        assert!(sender.expose_secret().starts_with("sbs2_"));
        assert!(SessionBearer::parse(sender.expose_secret()).is_err());
        assert!(SessionBearer::parse_sender_v2(session.expose_secret()).is_err());
        assert!(SessionBearer::parse_sender_v2(sender.expose_secret()).is_ok());
        assert!(SessionBearer::parse(session.expose_secret()).is_ok());

        let impersonation = ImpersonationBearer::generate(&random).unwrap();
        assert_eq!(
            impersonation.expose_secret(),
            "sbic_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ad"
        );
        assert_eq!(impersonation.expose_secret().len(), 57);
        assert!(ImpersonationBearer::parse(impersonation.expose_secret()).is_ok());

        assert!(
            SessionBearer::parse("sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190A55AD")
                .is_err()
        );
        assert!(
            SessionBearer::parse("sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.190a55ae")
                .is_err()
        );
        assert!(
            SessionBearer::parse("sbs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=.190a55ad")
                .is_err()
        );
        assert!(ImpersonationBearer::parse(session.expose_secret()).is_err());
        assert_eq!(format!("{session:?}"), "SessionBearer([REDACTED])");
        assert_eq!(
            format!("{impersonation:?}"),
            "ImpersonationBearer([REDACTED])"
        );
    }

    #[test]
    fn crc32_uses_iso_hdlc_parameters() {
        assert_eq!(crc32fast::hash(b"123456789"), 0xcbf4_3926);
    }

    // ---- LLP 0055 credential-class prefix namespace (the collision trap) ----

    /// The whole registered namespace remains mutually prefix-free. Longest
    /// matching makes dispatch robust while versioned spellings are introduced;
    /// strict prefix-freedom remains the protocol-level collision invariant.
    #[test]
    fn credential_prefixes_are_mutually_prefix_free() {
        let prefixes: Vec<&str> = REGISTERED_CREDENTIAL_PREFIXES
            .iter()
            .map(|(prefix, _)| *prefix)
            .collect();
        for (i, left) in prefixes.iter().enumerate() {
            for (j, right) in prefixes.iter().enumerate() {
                if i == j {
                    continue;
                }
                assert!(
                    !right.starts_with(left),
                    "credential prefix {left:?} is a prefix of {right:?}; the namespace is not \
                     prefix-free and structural class dispatch is unsound"
                );
            }
        }
        // Every class's own `prefix()` round-trips through the registry.
        for (prefix, class) in REGISTERED_CREDENTIAL_PREFIXES {
            assert_eq!(class.prefix(), *prefix);
            assert_eq!(classify_credential(prefix), Some(*class));
        }
    }

    #[test]
    fn classify_credential_prefers_longest_prefix_and_pins_v1_v2_sender_classes() {
        let overlapping = [
            ("sct", CredentialClass::ConnectionToken),
            ("sct2_", CredentialClass::SenderConnectionToken),
        ];
        assert_eq!(
            classify_credential_from("sct2_example", &overlapping),
            Some(CredentialClass::SenderConnectionToken),
        );

        for (value, expected) in [
            ("sbs_example", CredentialClass::Session),
            ("sbs2_example", CredentialClass::SenderSession),
            ("sct_example", CredentialClass::ConnectionToken),
            ("sct2_example", CredentialClass::SenderConnectionToken),
        ] {
            assert_eq!(classify_credential(value), Some(expected));
            assert_eq!(dispatch_credential_class(value, expected), Ok(expected));
        }
    }

    /// The five LLP 0055 classes plus the two pre-existing CRC bearers each
    /// parse only their own spelling and reject every other class's sample.
    /// This is the cross-class sweep: no bearer class is accepted by any other
    /// class's resolver.
    #[test]
    fn every_crc_bearer_class_rejects_every_other_class() {
        let random = ScriptedRandom::new(vec![vec![7_u8; 32]; 16]);
        // One concrete sample per CRC-bearer class, minted through its own type.
        let session = SessionBearer::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let sender_session = SessionBearer::generate_sender_v2(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let impersonation = ImpersonationBearer::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let dev_identity = DevIdentityBearer::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let rehearsal = RehearsalBearer::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let credential = AgentCredential::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let token = ScopedToken::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let creation = CreationInvitation::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let recovery = RecoveryInvitation::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();
        let pairing = PairingCode::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();

        let samples: [(CredentialClass, &str); 10] = [
            (CredentialClass::Session, &session),
            (CredentialClass::SenderSession, &sender_session),
            (CredentialClass::ImpersonationCapability, &impersonation),
            (CredentialClass::DevIdentityCapability, &dev_identity),
            (CredentialClass::RehearsalCapability, &rehearsal),
            (CredentialClass::AgentCredential, &credential),
            (CredentialClass::ScopedToken, &token),
            (CredentialClass::CreationInvitation, &creation),
            (CredentialClass::RecoveryInvitation, &recovery),
            (CredentialClass::PairingCode, &pairing),
        ];

        // Each sample classifies as exactly its own class.
        for (class, sample) in &samples {
            assert_eq!(classify_credential(sample), Some(*class));
        }

        // Each class's own parser accepts only its own sample and rejects the
        // other six — never a fall-through.
        for (class, _sample) in &samples {
            for (other_class, other) in &samples {
                let accepts = match class {
                    CredentialClass::Session => SessionBearer::parse(other).is_ok(),
                    CredentialClass::SenderSession => SessionBearer::parse_sender_v2(other).is_ok(),
                    CredentialClass::ImpersonationCapability => {
                        ImpersonationBearer::parse(other).is_ok()
                    }
                    CredentialClass::DevIdentityCapability => {
                        DevIdentityBearer::parse(other).is_ok()
                    }
                    CredentialClass::RehearsalCapability => RehearsalBearer::parse(other).is_ok(),
                    CredentialClass::AgentCredential => AgentCredential::parse(other).is_ok(),
                    CredentialClass::ScopedToken => ScopedToken::parse(other).is_ok(),
                    CredentialClass::CreationInvitation => CreationInvitation::parse(other).is_ok(),
                    CredentialClass::RecoveryInvitation => RecoveryInvitation::parse(other).is_ok(),
                    CredentialClass::PairingCode => PairingCode::parse(other).is_ok(),
                    _ => unreachable!("sweep only covers CRC-bearer classes"),
                };
                assert_eq!(
                    accepts,
                    class == other_class,
                    "{class:?} parser wrongly {} {other_class:?}",
                    if accepts { "accepted" } else { "rejected" }
                );
            }
        }
    }

    /// The secret-read proof nonce (`sbrp_`) and MAC (`sbrm_`) — and the pure
    /// identifiers `sbc_`/`sbak_` — are structurally non-authenticating, and no
    /// authenticating CRC-bearer parser accepts one.
    #[test]
    fn nonce_mac_and_identifier_classes_never_authenticate() {
        for class in [
            CredentialClass::SecretReadProofNonce,
            CredentialClass::SecretReadProofMac,
            CredentialClass::ChallengeId,
            CredentialClass::AuthKeyId,
        ] {
            assert!(
                !class.is_authenticating(),
                "{class:?} must not authenticate"
            );
        }
        // A well-formed `sbrp_`/`sbrm_` value is refused by every bearer parser.
        for value in ["sbrp_00000000-0000-0000-0000-000000000000", "sbrm_deadbeef"] {
            assert!(
                !classify_credential(value)
                    .map(CredentialClass::is_authenticating)
                    .unwrap_or(false)
            );
            assert!(SessionBearer::parse(value).is_err());
            assert!(ScopedToken::parse(value).is_err());
            assert!(AgentCredential::parse(value).is_err());
        }
    }

    /// A wrong-class or unregistered credential presented where one class is
    /// expected is a typed mismatch carrying only class tags — never resolved,
    /// never anonymous.
    #[test]
    fn dispatch_refuses_wrong_and_unknown_classes() {
        let random = ScriptedRandom::new(vec![vec![3_u8; 32]; 4]);
        let token = ScopedToken::generate(&random)
            .unwrap()
            .expose_secret()
            .to_string();

        // Right class → ok.
        assert_eq!(
            dispatch_credential_class(&token, CredentialClass::ScopedToken),
            Ok(CredentialClass::ScopedToken)
        );
        // Wrong (but registered) class → mismatch naming both classes.
        assert_eq!(
            dispatch_credential_class(&token, CredentialClass::Session),
            Err(CredentialClassMismatch {
                expected: CredentialClass::Session,
                actual: Some(CredentialClass::ScopedToken),
            })
        );
        // Unregistered spelling → mismatch with `actual: None`, still refused.
        assert_eq!(
            dispatch_credential_class("totally-unknown", CredentialClass::Session),
            Err(CredentialClassMismatch {
                expected: CredentialClass::Session,
                actual: None,
            })
        );

        // The mismatch maps to the typed refusal, carrying only class prefixes.
        let error = dispatch_credential_class(&token, CredentialClass::Session)
            .unwrap_err()
            .into_snapback_error();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_CREDENTIAL_CLASS_MISMATCH"
        );
        assert_eq!(error.diagnostic.details["expectedPrefix"], "sbs_");
        assert_eq!(error.diagnostic.details["presentedPrefix"], "sbagt_");
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
