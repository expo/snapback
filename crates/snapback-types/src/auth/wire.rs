//! Closed wire types for the local v1 authentication provider.
//!
//! Secret-bearing inputs deliberately do not derive `Debug` or `Serialize`.
//! Secret-bearing outputs serialize only through explicit field serializers,
//! so the underlying credential wrappers remain non-serializable and cannot
//! accidentally enter a generic log or diagnostic envelope.
//!
//! @ref LLP 0057#routes-operations-and-dtos — Rust serde + schemars types are
//! the wire authority, and every provider object is closed.

use crate::auth::crypto::{SessionBearer, VerificationCode};
use crate::auth::descriptor::AUTHORITY_DESCRIPTOR_VERSION;
use crate::manifest::AuthorityDescriptor;
use schemars::JsonSchema;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::Zeroizing;

/// Closed password-signup/signin request. The password carrier is neither
/// serializable nor printable and is wiped when the request drops.
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordCredentialRequest {
    pub email: String,
    #[schemars(with = "String")]
    pub password: SecretInput,
}

impl fmt::Debug for PasswordCredentialRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordCredentialRequest")
            .field("email", &"[REDACTED]")
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordResetRequest {
    pub challenge_id: String,
    #[schemars(with = "String")]
    pub code: SecretInput,
    #[schemars(with = "String")]
    pub new_password: SecretInput,
}

impl fmt::Debug for PasswordResetRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordResetRequest")
            .field("challenge_id", &self.challenge_id)
            .field("code", &"[REDACTED]")
            .field("new_password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordSetStepUpRequest {
    pub challenge_id: String,
    #[schemars(with = "String")]
    pub code: SecretInput,
}

impl fmt::Debug for PasswordSetStepUpRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordSetStepUpRequest")
            .field("challenge_id", &self.challenge_id)
            .field("code", &"[REDACTED]")
            .finish()
    }
}

/// The tag is the presence/null value of `currentPassword`: a string selects
/// rotation, while an explicit null selects first-set and requires step-up.
/// The custom visitor is provided by serde's untagged enum while each member
/// remains independently closed.
#[derive(Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum PasswordChangeRequest {
    Rotate(PasswordRotateRequest),
    Set(PasswordSetRequest),
}

impl fmt::Debug for PasswordChangeRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rotate(_) => formatter.write_str("PasswordChangeRequest::Rotate([REDACTED])"),
            Self::Set(_) => formatter.write_str("PasswordChangeRequest::Set([REDACTED])"),
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordRotateRequest {
    #[schemars(with = "String")]
    pub current_password: SecretInput,
    #[schemars(with = "String")]
    pub new_password: SecretInput,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordSetRequest {
    /// Must be present and null; omission is rejected by serde.
    pub current_password: (),
    #[schemars(with = "String")]
    pub new_password: SecretInput,
    pub step_up: PasswordSetStepUpRequest,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryConsumeRequest {
    pub email: String,
    #[schemars(with = "String")]
    pub code: SecretInput,
}

impl fmt::Debug for RecoveryConsumeRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RecoveryConsumeRequest")
            .field("email", &"[REDACTED]")
            .field("code", &"[REDACTED]")
            .finish()
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordUnlockRequest {
    pub email: String,
}

impl fmt::Debug for PasswordUnlockRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordUnlockRequest")
            .field("email", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordUnlockResponse {
    pub unlocked: bool,
}

#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordAttemptAdminRecord {
    pub canonical_identifier: String,
    pub window_start_ms: u64,
    pub failed_count: u64,
    pub locked_until_ms: Option<u64>,
    pub locked: bool,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordAttemptAdminRequest {
    pub email: String,
}

impl fmt::Debug for PasswordAttemptAdminRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PasswordAttemptAdminRequest")
            .field("email", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordAttemptAdminResponse {
    pub attempt: Option<PasswordAttemptAdminRecord>,
    pub failure_threshold: u64,
    pub failure_window_ms: u64,
    pub lock_duration_ms: u64,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestCodeRequest {
    pub email: String,
}

impl fmt::Debug for RequestCodeRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RequestCodeRequest")
            .field("email", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestCodeResponse {
    pub challenge_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub expires_at: u64,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangeRequest {
    pub challenge_id: String,
    #[schemars(with = "String")]
    pub code: SecretInput,
    /// Hosted browser exchange binds a fresh non-extractable key before the
    /// credential can be published. Local bearer-v1 exchange omits this
    /// member; a hosted target requires it at the route boundary.
    ///
    /// @ref LLP 0077#issuance-refresh-and-recovery — an existing bearer is
    /// never upgraded by attaching a key after issuance.
    pub sender_constraint: Option<SenderExchangeConstraint>,
}

impl fmt::Debug for ExchangeRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ExchangeRequest")
            .field("challenge_id", &self.challenge_id)
            .field("code", &"[REDACTED]")
            .field(
                "sender_constraint",
                &self.sender_constraint.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Clone, Deserialize, Eq, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SenderPublicJwk {
    pub crv: String,
    pub kty: String,
    pub x: String,
    pub y: String,
}

impl fmt::Debug for SenderPublicJwk {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SenderPublicJwk([REDACTED])")
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SenderExchangeConstraint {
    pub protocol: String,
    pub public_jwk: SenderPublicJwk,
    #[schemars(with = "String")]
    pub proof: SecretInput,
}

impl fmt::Debug for SenderExchangeConstraint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SenderExchangeConstraint([REDACTED])")
    }
}

/// Owned request plaintext that may contain a verification code or bearer.
/// It deliberately supports neither cloning, display, nor serialization, and
/// its allocation is wiped when the last owner drops it.
pub struct SecretInput(Zeroizing<String>);

impl SecretInput {
    pub fn new(value: String) -> Self {
        Self(Zeroizing::new(value))
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl<'de> Deserialize<'de> for SecretInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

impl fmt::Debug for SecretInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretInput([REDACTED])")
    }
}

/// The exact `{}` body used by refresh, logout, and family-alarm.
#[derive(Clone, Debug, Default, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyAuthRequest {}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionResponse {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub created_at: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub expires_at: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub absolute_expires_at: u64,
    /// Server-only issuance facts used to construct the adjacent public
    /// descriptor. They cannot accidentally enlarge the `session` wire shape.
    #[serde(skip)]
    #[schemars(skip)]
    pub authority_instance_id: String,
    #[serde(skip)]
    #[schemars(skip)]
    pub generation: u64,
}

impl From<crate::contract_types::AuthSessionResponseFact> for SessionResponse {
    fn from(fact: crate::contract_types::AuthSessionResponseFact) -> Self {
        Self {
            id: fact.id,
            user_id: fact.user_id,
            provider: fact.provider,
            created_at: fact.created_at,
            expires_at: fact.expires_at,
            absolute_expires_at: fact.absolute_expires_at,
            authority_instance_id: fact.authority_instance_id,
            generation: fact.generation,
        }
    }
}

impl SessionResponse {
    pub fn authority_descriptor(&self) -> AuthorityDescriptor {
        AuthorityDescriptor {
            descriptor_version: AUTHORITY_DESCRIPTOR_VERSION,
            authority_instance_id: self.authority_instance_id.clone(),
            session_generation: self.generation,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize)]
pub enum AuthTokenType {
    Bearer,
}

/// Credential issuance always describes a live session, so unlike the shared
/// handshake descriptor (where zero is the anonymous sentinel) its generation
/// is strictly positive.
#[derive(JsonSchema)]
#[schemars(rename_all = "camelCase", deny_unknown_fields)]
#[allow(dead_code)]
struct CredentialAuthorityDescriptorSchema {
    #[schemars(range(min = 1, max = 1))]
    descriptor_version: u32,
    #[schemars(pattern(crate::ids::ID_WIRE_PATTERN))]
    authority_instance_id: String,
    #[schemars(range(
        min = 1,
        max = crate::manifest::AUTHORITY_DESCRIPTOR_MAX_SESSION_GENERATION
    ))]
    session_generation: u64,
}

/// A freshly issued session credential. The token is intentionally private:
/// callers may return the complete response, but cannot pluck the bearer into
/// an arbitrary serializable structure.
#[derive(JsonSchema)]
#[schemars(rename = "AuthCredentialResponse")]
#[schemars(rename_all = "camelCase")]
#[schemars(deny_unknown_fields)]
pub struct CredentialResponse {
    #[schemars(with = "String")]
    token: SessionBearer,
    token_type: AuthTokenType,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub refresh_after: u64,
    pub session: SessionResponse,
    #[schemars(with = "CredentialAuthorityDescriptorSchema")]
    pub authority_descriptor: AuthorityDescriptor,
    /// One-time recovery custody. Ordinary exchange/signin/reset/refresh
    /// responses omit this member byte-for-byte; signup and recovery consume
    /// attach it to this same credential DTO rather than minting a parallel
    /// credential response shape.
    #[schemars(with = "Option<Vec<String>>")]
    recovery_codes: Option<crate::auth::identity_core::RecoveryCodes>,
}

impl CredentialResponse {
    pub fn new(token: SessionBearer, refresh_after: u64, session: SessionResponse) -> Self {
        let authority_descriptor = session.authority_descriptor();
        Self {
            token,
            token_type: AuthTokenType::Bearer,
            refresh_after,
            session,
            authority_descriptor,
            recovery_codes: None,
        }
    }

    pub fn with_recovery_codes(
        mut self,
        recovery_codes: Option<crate::auth::identity_core::RecoveryCodes>,
    ) -> Self {
        self.recovery_codes = recovery_codes;
        self
    }

    pub fn recovery_codes(&self) -> Option<&crate::auth::identity_core::RecoveryCodes> {
        self.recovery_codes.as_ref()
    }

    #[allow(dead_code)] // Later session/client projection consumes this without serializing it.
    pub fn token(&self) -> &SessionBearer {
        &self.token
    }
}

impl fmt::Debug for CredentialResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CredentialResponse")
            .field("token_type", &self.token_type)
            .field("token", &"[REDACTED]")
            .field("refresh_after", &self.refresh_after)
            .field("session", &self.session)
            .field("authority_descriptor", &self.authority_descriptor)
            .field("recovery_codes", &self.recovery_codes)
            .finish()
    }
}

impl Serialize for CredentialResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut output = serializer.serialize_struct(
            "AuthCredentialResponse",
            if self.recovery_codes.is_some() { 6 } else { 5 },
        )?;
        output.serialize_field("tokenType", &self.token_type)?;
        output.serialize_field("token", self.token.expose_secret())?;
        output.serialize_field("refreshAfter", &self.refresh_after)?;
        output.serialize_field("session", &self.session)?;
        output.serialize_field("authorityDescriptor", &self.authority_descriptor)?;
        if let Some(recovery_codes) = &self.recovery_codes {
            output.serialize_field("recoveryCodes", recovery_codes.expose_once())?;
        }
        output.end()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FamilyAlarmResponse {
    pub accepted: bool,
}

impl Default for FamilyAlarmResponse {
    fn default() -> Self {
        Self { accepted: true }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MailboxQuery {
    pub challenge_id: String,
}

impl fmt::Debug for MailboxQuery {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MailboxQuery")
            .field("challenge_id", &self.challenge_id)
            .finish()
    }
}

#[derive(JsonSchema)]
#[schemars(rename_all = "camelCase")]
#[schemars(deny_unknown_fields)]
pub struct MailboxResponse {
    pub challenge_id: String,
    #[schemars(with = "String")]
    canonical_address: String,
    #[schemars(with = "String")]
    code: VerificationCode,
    #[schemars(range(max = crate::manifest::PORTABLE_TIMESTAMP_MAX_MS))]
    pub expires_at: u64,
}

impl MailboxResponse {
    pub fn new(
        challenge_id: String,
        canonical_address: String,
        code: VerificationCode,
        expires_at: u64,
    ) -> Self {
        Self {
            challenge_id,
            canonical_address,
            code,
            expires_at,
        }
    }

    pub fn canonical_address(&self) -> &str {
        &self.canonical_address
    }
}

impl fmt::Debug for MailboxResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MailboxResponse")
            .field("challenge_id", &self.challenge_id)
            .field("canonical_address", &"[REDACTED]")
            .field("code", &"[REDACTED]")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl Serialize for MailboxResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut output = serializer.serialize_struct("MailboxResponse", 4)?;
        output.serialize_field("challengeId", &self.challenge_id)?;
        output.serialize_field("canonicalAddress", &self.canonical_address)?;
        output.serialize_field("code", self.code.expose_secret())?;
        output.serialize_field("expiresAt", &self.expires_at)?;
        output.end()
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MintSessionRequest {
    pub email: String,
}

impl fmt::Debug for MintSessionRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MintSessionRequest")
            .field("email", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RescueCollidingTableRequest {
    pub source_table: String,
    pub target_table: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};

    struct FixedRandom;

    impl RandomSource for FixedRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            destination.fill(7);
            Ok(())
        }
    }

    #[test]
    fn closed_requests_reject_unknown_fields() {
        assert!(
            serde_json::from_str::<RequestCodeRequest>(r#"{"email":"a@b","extra":1}"#).is_err()
        );
        assert!(
            serde_json::from_str::<ExchangeRequest>(
                r#"{"challengeId":"sbc_x","code":"123456","auth":{}}"#
            )
            .is_err()
        );
        assert!(serde_json::from_str::<EmptyAuthRequest>(r#"{"token":"body-alias"}"#).is_err());
    }

    #[test]
    fn secret_request_debug_is_redacted() {
        let request: ExchangeRequest =
            serde_json::from_str(r#"{"challengeId":"sbc_public","code":"987654"}"#).unwrap();
        let debug = format!("{request:?}");
        assert!(debug.contains("sbc_public"));
        assert!(!debug.contains("987654"));
        assert_eq!(format!("{:?}", request.code), "SecretInput([REDACTED])");
    }

    #[test]
    fn credential_serialization_is_explicit_and_debug_redacted() {
        let token = SessionBearer::generate(&FixedRandom).unwrap();
        let planted = token.expose_secret().to_owned();
        let response = CredentialResponse::new(
            token,
            7,
            SessionResponse {
                id: "session".to_owned(),
                user_id: "user".to_owned(),
                provider: "email-code".to_owned(),
                created_at: 1,
                expires_at: 2,
                absolute_expires_at: 3,
                authority_instance_id: "018f0d90-7b24-7a22-8c33-445566778899".to_owned(),
                generation: 1,
            },
        );
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["tokenType"], "Bearer");
        assert_eq!(value["token"], planted);
        assert_eq!(value["refreshAfter"], 7);
        assert_eq!(value["session"]["userId"], "user");
        assert_eq!(value["authorityDescriptor"]["descriptorVersion"], 1);
        assert_eq!(
            value["authorityDescriptor"]["authorityInstanceId"],
            "018f0d90-7b24-7a22-8c33-445566778899"
        );
        assert!(!format!("{response:?}").contains(&planted));
    }
}
