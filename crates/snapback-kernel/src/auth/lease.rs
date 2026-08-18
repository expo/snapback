//! Exact v1 server-issued authorization lease protocol.
//!
//! An `AuthorizedLease` is deliberately useful only after a fresh full query
//! revalidation.  This module owns the closed envelope, its domain-separated
//! MAC, duration/clamp rules, and exact service binding.  Storage owns the
//! commit-ordered issuance reservation and durable clock high-water.
//!
//! @ref LLP 0053#the-lease-the-only-mechanism-for-the-unreachable-client —
//! every field, the 24-hour ceiling, clamps, rollback posture, and absence of
//! ambient renewal are protocol requirements rather than product defaults.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use hmac::{Hmac, Mac as _};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::auth::crypto::{AuthKeyId, AuthKeyMaterial};
use crate::auth::handshake::lease_error;
pub use crate::auth::handshake::{
    AUTHORIZED_LEASE_DEFAULT_MS, AUTHORIZED_LEASE_HARD_MAX_MS, AUTHORIZED_LEASE_PROTOCOL_VERSION,
    AuthorizedLeaseConfig, AuthorizedLeaseFacts,
};
use crate::auth::invalidation::IssuerId;
use crate::auth::mode::DeploymentIdentity;
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::storage::AuthorizationVersion;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const LEASE_MAC_DOMAIN: &str = "snapback.authorized-lease.v1";
const ACTIVATION_HASH_DOMAIN: &str = "snapback.authorized-lease.activation.v1";
const ACTIVATION_HASH_PREFIX: &str = "snapback.authorized-lease.activation.v1:sha256:";

type HmacSha256 = Hmac<Sha256>;

fn invalid(message: impl Into<String>) -> SnapbackError {
    lease_error("SNAPBACK_AUTHORIZED_LEASE_INVALID", message).into()
}

fn mismatch(message: impl Into<String>) -> SnapbackError {
    lease_error("SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH", message).into()
}

/// Canonical identity of the exact active schema/function pair.  It is kept
/// distinct from any one artifact hash: changing schema, bundle, inputs, mode,
/// or app changes the activation binding.
pub fn authorized_lease_activation_hash(deployment: &DeploymentIdentity) -> String {
    let mut hash = Sha256::new();
    for value in [
        ACTIVATION_HASH_DOMAIN,
        deployment.schema_version.as_str(),
        deployment.auth_mode.as_str(),
        deployment.app_id.as_str(),
        deployment.schema_hash.as_str(),
        deployment.bundle_hash.as_str(),
        deployment.inputs_hash.as_str(),
    ] {
        hash.update((value.len() as u64).to_be_bytes());
        hash.update(value.as_bytes());
    }
    format!("{ACTIVATION_HASH_DOMAIN}:sha256:{:x}", hash.finalize())
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLeaseData {
    pub version_stream: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub snapshot_commit_version: u64,
}

/// Client-selected one-shot identity for a fresh full revalidation.  The
/// query arguments and resolved authority travel through the ordinary query
/// gate; these four values name only the durable client-store reservation.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLeaseRequestIdentity {
    pub lease_request_id: String,
    pub client_store_id: String,
    pub query_key: String,
    #[schemars(range(min = 1, max = MAX_SAFE_INTEGER))]
    pub query_instance_id: u64,
}

impl AuthorizedLeaseRequestIdentity {
    pub fn validate(&self) -> SnapbackResult<()> {
        validate_opaque_id(&self.lease_request_id, "leaseRequestId")?;
        validate_opaque_id(&self.client_store_id, "clientStoreId")?;
        validate_query_key(&self.query_key)?;
        validate_counter(self.query_instance_id, "queryInstanceId", true)
    }
}

/// Exact server-issued envelope.  `deny_unknown_fields` makes protocol v1
/// closed in both directions; additive fields require a new version.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthorizedLease {
    pub protocol_version: u32,
    pub lease_id: String,
    pub lease_request_id: String,
    pub issuer_id: IssuerId,
    pub client_store_id: String,
    pub query_key: String,
    #[schemars(range(min = 1, max = MAX_SAFE_INTEGER))]
    pub query_instance_id: u64,
    pub principal_id: String,
    pub session_id_at_issue: Option<String>,
    pub provider_key: Option<String>,
    pub authorization: AuthorizationVersion,
    pub data: AuthorizedLeaseData,
    pub activation_hash: String,
    pub issued_at_server_ms: u64,
    pub authorized_until_server_ms: u64,
    pub session_not_after_ms: Option<u64>,
    pub provider_not_after_ms: Option<u64>,
    pub authority_instance_id: Option<String>,
    /// Opaque to the client; resolved against the server keyring, where an
    /// unknown key fails closed.
    pub key_id: String,
    /// Server-keyed HMAC-SHA-256 over every field plus target/app identity.
    /// The schema pins only the canonical 256-bit base64url FORM — exactly
    /// what client custody validation checks; cryptographic validity is the
    /// server verifier's (LLP 0053 §The lease, verification locus).
    #[schemars(pattern(r"^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$"))]
    pub mac: String,
}

/// Every non-derived field captured by a full revalidation before issuance.
/// `lease_id` is generated server-side; `lease_request_id` is the client's
/// durable one-shot reservation identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizedLeaseIssue {
    pub lease_id: String,
    pub lease_request_id: String,
    pub issuer_id: IssuerId,
    pub client_store_id: String,
    pub query_key: String,
    pub query_instance_id: u64,
    pub principal_id: String,
    pub session_id_at_issue: Option<String>,
    pub provider_key: Option<String>,
    pub authorization: AuthorizationVersion,
    pub data: AuthorizedLeaseData,
    pub activation_hash: String,
    pub session_not_after_ms: Option<u64>,
    pub provider_not_after_ms: Option<u64>,
    pub authority_instance_id: Option<String>,
}

/// Exact server-side binding required before any revalidation-free service.
/// Requiring the caller to supply the complete expected tuple prevents a
/// verifier from accidentally accepting a self-described lease.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizedLeaseExpectation {
    pub lease_id: String,
    pub lease_request_id: String,
    pub issuer_id: IssuerId,
    pub client_store_id: String,
    pub query_key: String,
    pub query_instance_id: u64,
    pub principal_id: String,
    pub session_id_at_issue: Option<String>,
    pub provider_key: Option<String>,
    pub authorization: AuthorizationVersion,
    pub data: AuthorizedLeaseData,
    pub activation_hash: String,
    pub session_not_after_ms: Option<u64>,
    pub provider_not_after_ms: Option<u64>,
    pub authority_instance_id: Option<String>,
}

impl From<&AuthorizedLease> for AuthorizedLeaseExpectation {
    fn from(lease: &AuthorizedLease) -> Self {
        Self {
            lease_id: lease.lease_id.clone(),
            lease_request_id: lease.lease_request_id.clone(),
            issuer_id: lease.issuer_id.clone(),
            client_store_id: lease.client_store_id.clone(),
            query_key: lease.query_key.clone(),
            query_instance_id: lease.query_instance_id,
            principal_id: lease.principal_id.clone(),
            session_id_at_issue: lease.session_id_at_issue.clone(),
            provider_key: lease.provider_key.clone(),
            authorization: lease.authorization.clone(),
            data: lease.data.clone(),
            activation_hash: lease.activation_hash.clone(),
            session_not_after_ms: lease.session_not_after_ms,
            provider_not_after_ms: lease.provider_not_after_ms,
            authority_instance_id: lease.authority_instance_id.clone(),
        }
    }
}

/// One keyring-selected protocol key.  The containing keyring retains old
/// entries as verify-only keys for at least the hard maximum.
pub struct AuthorizedLeaseAuthenticator {
    key_id: AuthKeyId,
    key: [u8; 32],
}

/// Non-forgeable crate-internal proof that the persistent protocol keyring
/// accepted shape, MAC, time, configuration, and a complete expected binding
/// before the app/database lane was acquired.
// The verifier boundary is intentionally staged for the first server service
// that accepts a presented lease; issuance never self-verifies its own output.
#[cfg_attr(not(test), allow(dead_code))]
pub struct VerifiedAuthorizedLease {
    lease: AuthorizedLease,
    verified_at_server_ms: u64,
}

impl std::fmt::Debug for VerifiedAuthorizedLease {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("VerifiedAuthorizedLease([BOUND])")
    }
}

#[cfg_attr(not(test), allow(dead_code))]
impl VerifiedAuthorizedLease {
    pub fn lease(&self) -> &AuthorizedLease {
        &self.lease
    }

    pub fn verified_at_server_ms(&self) -> u64 {
        self.verified_at_server_ms
    }
}

impl Drop for AuthorizedLeaseAuthenticator {
    fn drop(&mut self) {
        use zeroize::Zeroize as _;
        self.key.zeroize();
    }
}

impl std::fmt::Debug for AuthorizedLeaseAuthenticator {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AuthorizedLeaseAuthenticator([REDACTED])")
    }
}

impl AuthorizedLeaseAuthenticator {
    pub fn new(key_id: &AuthKeyId, key: &AuthKeyMaterial) -> Self {
        Self {
            key_id: key_id.clone(),
            key: *key.expose_secret(),
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn from_test_key(key_id: &str, key: [u8; 32]) -> Self {
        Self {
            key_id: AuthKeyId::parse(key_id).expect("test key id"),
            key,
        }
    }

    pub fn issue(
        &self,
        issue: AuthorizedLeaseIssue,
        config: AuthorizedLeaseConfig,
        issued_at_server_ms: u64,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<AuthorizedLease> {
        validate_issue(&issue)?;
        validate_timestamp(issued_at_server_ms, "issuedAtServerMs")?;
        let configured_until = issued_at_server_ms
            .checked_add(config.configured_ms())
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("configured lease duration overflows canonical time"))?;
        let hard_until = issued_at_server_ms
            .checked_add(AUTHORIZED_LEASE_HARD_MAX_MS)
            .filter(|value| *value <= MAX_SAFE_INTEGER)
            .ok_or_else(|| invalid("hard lease duration overflows canonical time"))?;
        let mut authorized_until_server_ms = configured_until.min(hard_until);
        for (value, field) in [
            (issue.session_not_after_ms, "sessionNotAfterMs"),
            (issue.provider_not_after_ms, "providerNotAfterMs"),
        ] {
            if let Some(value) = value {
                validate_timestamp(value, field)?;
                if value <= issued_at_server_ms {
                    return Err(invalid(format!(
                        "{field} is already expired at lease issuance",
                    )));
                }
                authorized_until_server_ms = authorized_until_server_ms.min(value);
            }
        }
        if authorized_until_server_ms <= issued_at_server_ms {
            return Err(invalid(
                "authorized lease has no positive validity interval",
            ));
        }
        let mut lease = AuthorizedLease {
            protocol_version: AUTHORIZED_LEASE_PROTOCOL_VERSION,
            lease_id: issue.lease_id,
            lease_request_id: issue.lease_request_id,
            issuer_id: issue.issuer_id,
            client_store_id: issue.client_store_id,
            query_key: issue.query_key,
            query_instance_id: issue.query_instance_id,
            principal_id: issue.principal_id,
            session_id_at_issue: issue.session_id_at_issue,
            provider_key: issue.provider_key,
            authorization: issue.authorization,
            data: issue.data,
            activation_hash: issue.activation_hash,
            issued_at_server_ms,
            authorized_until_server_ms,
            session_not_after_ms: issue.session_not_after_ms,
            provider_not_after_ms: issue.provider_not_after_ms,
            authority_instance_id: issue.authority_instance_id,
            key_id: self.key_id.as_str().to_owned(),
            mac: String::new(),
        };
        lease.mac = self.mac(&lease, target_profile_id, app_id)?;
        Ok(lease)
    }

    /// Verify shape, MAC, time, configuration, and every caller-provided
    /// equality axis.  The durable server clock high-water must be checked by
    /// storage immediately before this method is used for service admission.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn verify_for_service(
        &self,
        lease: &AuthorizedLease,
        expectation: &AuthorizedLeaseExpectation,
        config: AuthorizedLeaseConfig,
        now_ms: u64,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<VerifiedAuthorizedLease> {
        lease.validate_shape(config)?;
        if lease.key_id != self.key_id.as_str() {
            return Err(invalid("authorized lease names another protocol key"));
        }
        let provided = URL_SAFE_NO_PAD
            .decode(&lease.mac)
            .map_err(|_| invalid("authorized lease MAC is not canonical base64url"))?;
        let mac = self.base_mac(lease, target_profile_id, app_id)?;
        mac.verify_slice(&provided)
            .map_err(|_| invalid("authorized lease MAC verification failed"))?;
        validate_timestamp(now_ms, "serverNowMs")?;
        if now_ms < lease.issued_at_server_ms {
            return Err(lease_error(
                "SNAPBACK_AUTH_CLOCK_ROLLBACK",
                "server clock is behind the lease issuance sample",
            )
            .into());
        }
        if now_ms >= lease.authorized_until_server_ms {
            return Err(lease_error(
                "SNAPBACK_AUTHORIZED_LEASE_EXPIRED",
                "authorized lease is expired",
            )
            .into());
        }
        lease.require_expectation(expectation)?;
        Ok(VerifiedAuthorizedLease {
            lease: lease.clone(),
            verified_at_server_ms: now_ms,
        })
    }

    fn mac(
        &self,
        lease: &AuthorizedLease,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<String> {
        let mac = self.base_mac(lease, target_profile_id, app_id)?;
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn base_mac(
        &self,
        lease: &AuthorizedLease,
        target_profile_id: &str,
        app_id: &str,
    ) -> SnapbackResult<HmacSha256> {
        validate_opaque_id(target_profile_id, "targetProfileId")?;
        validate_opaque_id(app_id, "appId")?;
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .map_err(|_| invalid("authorized lease protocol key has invalid length"))?;
        put_string(&mut mac, LEASE_MAC_DOMAIN);
        put_string(&mut mac, target_profile_id);
        put_string(&mut mac, app_id);
        put_u64(&mut mac, u64::from(lease.protocol_version));
        put_string(&mut mac, &lease.lease_id);
        put_string(&mut mac, &lease.lease_request_id);
        put_string(&mut mac, &lease.issuer_id.authorization_incarnation);
        put_u64(&mut mac, lease.issuer_id.boot_sequence);
        put_string(&mut mac, &lease.issuer_id.boot_nonce);
        put_string(&mut mac, &lease.client_store_id);
        put_string(&mut mac, &lease.query_key);
        put_u64(&mut mac, lease.query_instance_id);
        put_string(&mut mac, &lease.principal_id);
        put_optional_string(&mut mac, lease.session_id_at_issue.as_deref());
        put_optional_string(&mut mac, lease.provider_key.as_deref());
        put_string(&mut mac, &lease.authorization.incarnation);
        put_u64(&mut mac, lease.authorization.epoch);
        put_string(&mut mac, &lease.data.version_stream);
        put_u64(&mut mac, lease.data.snapshot_commit_version);
        put_string(&mut mac, &lease.activation_hash);
        put_u64(&mut mac, lease.issued_at_server_ms);
        put_u64(&mut mac, lease.authorized_until_server_ms);
        put_optional_u64(&mut mac, lease.session_not_after_ms);
        put_optional_u64(&mut mac, lease.provider_not_after_ms);
        put_optional_string(&mut mac, lease.authority_instance_id.as_deref());
        put_string(&mut mac, &lease.key_id);
        Ok(mac)
    }
}

impl AuthorizedLease {
    pub fn validate_shape(&self, config: AuthorizedLeaseConfig) -> SnapbackResult<()> {
        if self.protocol_version != AUTHORIZED_LEASE_PROTOCOL_VERSION {
            return Err(invalid("unsupported authorized lease protocol version"));
        }
        self.issuer_id.validate()?;
        validate_opaque_id(&self.lease_id, "leaseId")?;
        validate_opaque_id(&self.lease_request_id, "leaseRequestId")?;
        validate_opaque_id(&self.client_store_id, "clientStoreId")?;
        validate_query_key(&self.query_key)?;
        validate_counter(self.query_instance_id, "queryInstanceId", true)?;
        validate_opaque_id(&self.principal_id, "principalId")?;
        validate_optional_opaque_id(self.session_id_at_issue.as_deref(), "sessionIdAtIssue")?;
        validate_optional_opaque_id(self.provider_key.as_deref(), "providerKey")?;
        validate_opaque_id(&self.authorization.incarnation, "authorization.incarnation")?;
        validate_counter(self.authorization.epoch, "authorization.epoch", false)?;
        validate_opaque_id(&self.data.version_stream, "data.versionStream")?;
        validate_counter(
            self.data.snapshot_commit_version,
            "data.snapshotCommitVersion",
            false,
        )?;
        validate_activation_hash(&self.activation_hash)?;
        validate_timestamp(self.issued_at_server_ms, "issuedAtServerMs")?;
        validate_timestamp(self.authorized_until_server_ms, "authorizedUntilServerMs")?;
        if self.authorized_until_server_ms <= self.issued_at_server_ms {
            return Err(invalid("authorized lease interval is empty or negative"));
        }
        let duration = self
            .authorized_until_server_ms
            .checked_sub(self.issued_at_server_ms)
            .ok_or_else(|| invalid("authorized lease duration underflowed"))?;
        if duration > AUTHORIZED_LEASE_HARD_MAX_MS || duration > config.configured_ms() {
            return Err(invalid(
                "authorized lease duration exceeds its configured ceiling",
            ));
        }
        for (value, field) in [
            (self.session_not_after_ms, "sessionNotAfterMs"),
            (self.provider_not_after_ms, "providerNotAfterMs"),
        ] {
            if let Some(value) = value {
                validate_timestamp(value, field)?;
                if value < self.authorized_until_server_ms {
                    return Err(invalid(format!(
                        "authorized lease exceeds its {field} clamp",
                    )));
                }
            }
        }
        if self.session_id_at_issue.is_some() && self.session_not_after_ms.is_none() {
            return Err(invalid(
                "sessionNotAfterMs is required when sessionIdAtIssue is present",
            ));
        }
        validate_optional_uuid_v7(self.authority_instance_id.as_deref(), "authorityInstanceId")?;
        validate_opaque_id(&self.key_id, "keyId")?;
        let mac = URL_SAFE_NO_PAD
            .decode(&self.mac)
            .map_err(|_| invalid("authorized lease MAC is not canonical base64url"))?;
        if mac.len() != 32 || URL_SAFE_NO_PAD.encode(mac) != self.mac {
            return Err(invalid(
                "authorized lease MAC is not a canonical SHA-256 value",
            ));
        }
        Ok(())
    }

    #[cfg_attr(not(test), allow(dead_code))]
    fn require_expectation(&self, expected: &AuthorizedLeaseExpectation) -> SnapbackResult<()> {
        let actual = AuthorizedLeaseExpectation::from(self);
        if &actual != expected {
            return Err(mismatch(
                "authorized lease does not match the requested service authority/query/witness binding",
            ));
        }
        Ok(())
    }
}

fn validate_issue(issue: &AuthorizedLeaseIssue) -> SnapbackResult<()> {
    // Reuse the exact envelope validator by constructing a temporary
    // well-shaped interval and canonical placeholder MAC/key.
    issue.issuer_id.validate()?;
    validate_opaque_id(&issue.lease_id, "leaseId")?;
    validate_opaque_id(&issue.lease_request_id, "leaseRequestId")?;
    validate_opaque_id(&issue.client_store_id, "clientStoreId")?;
    validate_query_key(&issue.query_key)?;
    validate_counter(issue.query_instance_id, "queryInstanceId", true)?;
    validate_opaque_id(&issue.principal_id, "principalId")?;
    validate_optional_opaque_id(issue.session_id_at_issue.as_deref(), "sessionIdAtIssue")?;
    validate_optional_opaque_id(issue.provider_key.as_deref(), "providerKey")?;
    validate_opaque_id(
        &issue.authorization.incarnation,
        "authorization.incarnation",
    )?;
    validate_counter(issue.authorization.epoch, "authorization.epoch", false)?;
    validate_opaque_id(&issue.data.version_stream, "data.versionStream")?;
    validate_counter(
        issue.data.snapshot_commit_version,
        "data.snapshotCommitVersion",
        false,
    )?;
    validate_activation_hash(&issue.activation_hash)?;
    if issue.session_id_at_issue.is_some() && issue.session_not_after_ms.is_none() {
        return Err(invalid(
            "sessionNotAfterMs is required when sessionIdAtIssue is present",
        ));
    }
    validate_optional_uuid_v7(
        issue.authority_instance_id.as_deref(),
        "authorityInstanceId",
    )?;
    Ok(())
}

impl AuthorizedLeaseIssue {
    /// Exhaustive binding check used when the app lock is released for
    /// provider-before-app keyring signing and later reacquired for the
    /// atomic reservation. This prevents the second phase from accepting a
    /// signed lease for any capture other than the one it is finalizing.
    pub fn require_issued_lease(
        &self,
        lease: &AuthorizedLease,
        issued_at_server_ms: u64,
    ) -> SnapbackResult<()> {
        let matches = lease.protocol_version == AUTHORIZED_LEASE_PROTOCOL_VERSION
            && lease.lease_id == self.lease_id
            && lease.lease_request_id == self.lease_request_id
            && lease.issuer_id == self.issuer_id
            && lease.client_store_id == self.client_store_id
            && lease.query_key == self.query_key
            && lease.query_instance_id == self.query_instance_id
            && lease.principal_id == self.principal_id
            && lease.session_id_at_issue == self.session_id_at_issue
            && lease.provider_key == self.provider_key
            && lease.authorization == self.authorization
            && lease.data == self.data
            && lease.activation_hash == self.activation_hash
            && lease.issued_at_server_ms == issued_at_server_ms
            && lease.session_not_after_ms == self.session_not_after_ms
            && lease.provider_not_after_ms == self.provider_not_after_ms
            && lease.authority_instance_id == self.authority_instance_id;
        if !matches {
            return Err(mismatch(
                "signed authorized lease does not match its full-query capture",
            ));
        }
        Ok(())
    }
}

fn validate_optional_opaque_id(value: Option<&str>, field: &str) -> SnapbackResult<()> {
    if let Some(value) = value {
        validate_opaque_id(value, field)?;
    }
    Ok(())
}

fn validate_opaque_id(value: &str, field: &str) -> SnapbackResult<()> {
    let bytes = value.as_bytes();
    if bytes.is_empty()
        || bytes.len() > 256
        || !bytes[0].is_ascii_alphanumeric()
        || !bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(invalid(format!("{field} is not a canonical opaque id")));
    }
    Ok(())
}

fn validate_query_key(value: &str) -> SnapbackResult<()> {
    if value.is_empty() || value.len() > 8_192 {
        return Err(invalid("queryKey is not non-empty and bounded"));
    }
    Ok(())
}

fn validate_activation_hash(value: &str) -> SnapbackResult<()> {
    let Some(digest) = value.strip_prefix(ACTIVATION_HASH_PREFIX) else {
        return Err(invalid("activationHash is not canonical"));
    };
    if digest.len() != 64
        || !digest
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(invalid("activationHash is not canonical"));
    }
    Ok(())
}

fn validate_optional_uuid_v7(value: Option<&str>, field: &str) -> SnapbackResult<()> {
    let Some(value) = value else {
        return Ok(());
    };
    if crate::ids::is_minted_identifier(value) {
        return Ok(());
    }
    Err(invalid(format!("{field} is not a Snapback identifier")))
}

fn validate_counter(value: u64, field: &str, positive: bool) -> SnapbackResult<()> {
    if value > MAX_SAFE_INTEGER || (positive && value == 0) {
        return Err(invalid(format!(
            "{field} is outside the canonical integer range"
        )));
    }
    Ok(())
}

fn validate_timestamp(value: u64, field: &str) -> SnapbackResult<()> {
    validate_counter(value, field, false)
}

fn put_u64(mac: &mut HmacSha256, value: u64) {
    mac.update(&value.to_be_bytes());
}

fn put_string(mac: &mut HmacSha256, value: &str) {
    put_u64(mac, value.len() as u64);
    mac.update(value.as_bytes());
}

fn put_optional_string(mac: &mut HmacSha256, value: Option<&str>) {
    match value {
        Some(value) => {
            mac.update(&[1]);
            put_string(mac, value);
        }
        None => mac.update(&[0]),
    }
}

fn put_optional_u64(mac: &mut HmacSha256, value: Option<u64>) {
    match value {
        Some(value) => {
            mac.update(&[1]);
            put_u64(mac, value);
        }
        None => mac.update(&[0]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::crypto::{CryptoError, RandomSource};
    use crate::auth::invalidation::IssuerId;
    use crate::auth::keyring::{AUTH_KEY_ROTATION_AGE_MS, AuthKeyringStore, KeyringError};
    use serde_json::Value;
    use std::sync::Mutex;

    const NOW: u64 = 1_800_000_000_000;
    const TARGET: &str = "local-dev-sqlite-ibex";
    const APP: &str = "app-test";
    const AUTHORITY_INSTANCE: &str = "01890f3c-9d5b-7000-8000-000000000004";

    fn signer() -> AuthorizedLeaseAuthenticator {
        AuthorizedLeaseAuthenticator::from_test_key("sbak_AQEBAQEBAQEBAQEBAQEBAQ", [0x31; 32])
    }

    fn issue() -> AuthorizedLeaseIssue {
        AuthorizedLeaseIssue {
            lease_id: "lease_1".to_owned(),
            lease_request_id: "request_1".to_owned(),
            issuer_id: IssuerId {
                authorization_incarnation: "01890f3c-9d5b-7000-8000-000000000001".to_owned(),
                boot_sequence: 7,
                boot_nonce: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
            },
            client_store_id: "store_1".to_owned(),
            query_key: "todos:{owner=me}".to_owned(),
            query_instance_id: 9,
            principal_id: "user_1".to_owned(),
            session_id_at_issue: Some("session_1".to_owned()),
            provider_key: Some("email-code".to_owned()),
            authorization: AuthorizationVersion {
                incarnation: "01890f3c-9d5b-7000-8000-000000000001".to_owned(),
                epoch: 11,
            },
            data: AuthorizedLeaseData {
                version_stream: "01890f3c-9d5b-7000-8000-000000000002".to_owned(),
                snapshot_commit_version: 19,
            },
            activation_hash: format!("{ACTIVATION_HASH_PREFIX}{}", "a".repeat(64)),
            session_not_after_ms: Some(NOW + 70_000),
            provider_not_after_ms: Some(NOW + 60_000),
            authority_instance_id: Some(AUTHORITY_INSTANCE.to_owned()),
        }
    }

    fn lease() -> AuthorizedLease {
        signer()
            .issue(issue(), AuthorizedLeaseConfig::default(), NOW, TARGET, APP)
            .unwrap()
    }

    #[test]
    fn exact_envelope_is_closed_and_capability_facts_are_pinned() {
        let facts = AuthorizedLeaseFacts::from(AuthorizedLeaseConfig::default());
        assert_eq!(facts.protocol_version, 1);
        assert_eq!(facts.default_ms, 86_400_000);
        assert_eq!(facts.hard_max_ms, 86_400_000);
        assert_eq!(facts.configured_ms, 86_400_000);
        assert_eq!(facts.clamps, ["session", "provider"]);
        let mut value = serde_json::to_value(lease()).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .insert("futureField".to_owned(), Value::Bool(true));
        assert!(serde_json::from_value::<AuthorizedLease>(value).is_err());
    }

    #[test]
    fn earlier_session_and_provider_expiry_clamp_and_expired_clamps_refuse() {
        let lease = lease();
        assert_eq!(lease.authorized_until_server_ms, NOW + 60_000);
        let mut expired = issue();
        expired.provider_not_after_ms = Some(NOW);
        let error = signer()
            .issue(expired, AuthorizedLeaseConfig::default(), NOW, TARGET, APP)
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_INVALID");
    }

    #[test]
    fn configuration_and_time_addition_fail_closed() {
        assert!(AuthorizedLeaseConfig::new(0).is_err());
        assert!(AuthorizedLeaseConfig::new(AUTHORIZED_LEASE_HARD_MAX_MS + 1).is_err());
        let error = signer()
            .issue(
                issue(),
                AuthorizedLeaseConfig::default(),
                MAX_SAFE_INTEGER - 1,
                TARGET,
                APP,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_INVALID");
    }

    #[test]
    fn cross_language_identity_activation_and_context_grammar_is_exact() {
        let signer = signer();
        let mut invalid_opaque = issue();
        invalid_opaque.principal_id = "user/one".to_owned();
        assert!(
            signer
                .issue(
                    invalid_opaque,
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    APP,
                )
                .is_err()
        );

        let mut exact_query_limit = issue();
        exact_query_limit.query_key = "🦀".repeat(2_048);
        signer
            .issue(
                exact_query_limit,
                AuthorizedLeaseConfig::default(),
                NOW,
                TARGET,
                APP,
            )
            .unwrap();
        let mut over_query_limit = issue();
        over_query_limit.query_key = "🦀".repeat(2_049);
        assert!(
            signer
                .issue(
                    over_query_limit,
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    APP,
                )
                .is_err()
        );

        let mut bad_activation = issue();
        bad_activation.activation_hash = format!("{ACTIVATION_HASH_PREFIX}{}", "A".repeat(64));
        assert!(
            signer
                .issue(
                    bad_activation,
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    APP,
                )
                .is_err()
        );
        let mut bad_authority_instance = issue();
        bad_authority_instance.authority_instance_id = Some("authority_1".to_owned());
        assert!(
            signer
                .issue(
                    bad_authority_instance,
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    APP,
                )
                .is_err()
        );
        let mut missing_session_expiry = issue();
        missing_session_expiry.session_not_after_ms = None;
        assert!(
            signer
                .issue(
                    missing_session_expiry,
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    APP,
                )
                .is_err()
        );
        assert!(
            signer
                .issue(
                    issue(),
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    "target/invalid",
                    APP,
                )
                .is_err()
        );
        assert!(
            signer
                .issue(
                    issue(),
                    AuthorizedLeaseConfig::default(),
                    NOW,
                    TARGET,
                    "app invalid",
                )
                .is_err()
        );

        // keyId is frozen as OpaqueId on the wire. Provider lookup applies
        // the narrower local keyring grammar only after cross-language shape
        // validation.
        let mut opaque_unknown_key = lease();
        opaque_unknown_key.key_id = "unknown-key".to_owned();
        opaque_unknown_key
            .validate_shape(AuthorizedLeaseConfig::default())
            .unwrap();
    }

    #[test]
    fn configured_duration_and_activation_hash_have_stable_vectors() {
        let configured = AuthorizedLeaseConfig::new(30_000).unwrap();
        let mut unclamped = issue();
        unclamped.session_not_after_ms = Some(NOW + 70_000);
        unclamped.provider_not_after_ms = Some(NOW + 60_000);
        let lease = signer()
            .issue(unclamped, configured, NOW, TARGET, APP)
            .unwrap();
        assert_eq!(lease.authorized_until_server_ms, NOW + 30_000);

        let deployment = DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: crate::manifest::AuthMode::Sessions,
            app_id: APP.to_owned(),
            schema_hash: format!("snapback.v1:sessions:schema:sha256:{}", "1".repeat(64)),
            bundle_hash: format!("snapback.v1:sessions:function:sha256:{}", "2".repeat(64)),
            inputs_hash: format!("snapback.v1:sessions:inputs:sha256:{}", "3".repeat(64)),
        };
        assert_eq!(
            authorized_lease_activation_hash(&deployment),
            "snapback.authorized-lease.activation.v1:sha256:d32507a87be992df54d41d42160789787b0759629d5b43cac1b2c829b4e6cc97"
        );
    }

    #[test]
    fn exact_mac_field_tamper_matrix_and_target_app_domains_fail() {
        let signer = signer();
        let original = lease();
        let expected = AuthorizedLeaseExpectation::from(&original);
        signer
            .verify_for_service(
                &original,
                &expected,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                TARGET,
                APP,
            )
            .unwrap();

        let value = serde_json::to_value(&original).unwrap();
        let replacements = [
            ("protocolVersion", serde_json::json!(2)),
            ("leaseId", serde_json::json!("lease_2")),
            ("leaseRequestId", serde_json::json!("request_2")),
            ("clientStoreId", serde_json::json!("store_2")),
            ("queryKey", serde_json::json!("other")),
            ("queryInstanceId", serde_json::json!(10)),
            ("principalId", serde_json::json!("user_2")),
            ("sessionIdAtIssue", serde_json::json!("session_2")),
            ("providerKey", serde_json::json!("other-provider")),
            (
                "activationHash",
                serde_json::json!(format!("{ACTIVATION_HASH_PREFIX}{}", "b".repeat(64))),
            ),
            ("issuedAtServerMs", serde_json::json!(NOW + 1)),
            ("authorizedUntilServerMs", serde_json::json!(NOW + 50_000)),
            ("sessionNotAfterMs", serde_json::json!(NOW + 71_000)),
            ("providerNotAfterMs", serde_json::json!(NOW + 61_000)),
            (
                "authorityInstanceId",
                serde_json::json!("01890f3c-9d5b-7000-8000-000000000005"),
            ),
            ("keyId", serde_json::json!("sbak_AgICAgICAgICAgICAgICAg")),
            (
                "mac",
                serde_json::json!("AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI"),
            ),
        ];
        for (field, replacement) in replacements {
            let mut tampered = value.clone();
            tampered
                .as_object_mut()
                .unwrap()
                .insert(field.to_owned(), replacement);
            let lease: AuthorizedLease = serde_json::from_value(tampered).unwrap();
            assert!(
                signer
                    .verify_for_service(
                        &lease,
                        &AuthorizedLeaseExpectation::from(&lease),
                        AuthorizedLeaseConfig::default(),
                        NOW + 1,
                        TARGET,
                        APP,
                    )
                    .is_err(),
                "field {field} was not bound",
            );
        }

        for mutate in [
            |lease: &mut AuthorizedLease| {
                lease.issuer_id.authorization_incarnation =
                    "01890f3c-9d5b-7000-8000-000000000003".to_owned()
            },
            |lease: &mut AuthorizedLease| lease.issuer_id.boot_sequence += 1,
            |lease: &mut AuthorizedLease| {
                lease.issuer_id.boot_nonce = "AgICAgICAgICAgICAgICAg".to_owned()
            },
            |lease: &mut AuthorizedLease| {
                lease.authorization.incarnation = "01890f3c-9d5b-7000-8000-000000000003".to_owned()
            },
            |lease: &mut AuthorizedLease| lease.authorization.epoch += 1,
            |lease: &mut AuthorizedLease| {
                lease.data.version_stream = "01890f3c-9d5b-7000-8000-000000000003".to_owned()
            },
            |lease: &mut AuthorizedLease| lease.data.snapshot_commit_version += 1,
        ] {
            let mut tampered = original.clone();
            mutate(&mut tampered);
            assert!(
                signer
                    .verify_for_service(
                        &tampered,
                        &AuthorizedLeaseExpectation::from(&tampered),
                        AuthorizedLeaseConfig::default(),
                        NOW + 1,
                        TARGET,
                        APP,
                    )
                    .is_err()
            );
        }
        assert!(
            signer
                .verify_for_service(
                    &original,
                    &expected,
                    AuthorizedLeaseConfig::default(),
                    NOW + 1,
                    "other-target",
                    APP,
                )
                .is_err()
        );
        assert!(
            signer
                .verify_for_service(
                    &original,
                    &expected,
                    AuthorizedLeaseConfig::default(),
                    NOW + 1,
                    TARGET,
                    "other-app",
                )
                .is_err()
        );
    }

    #[test]
    fn exact_expected_binding_and_expiry_are_enforced() {
        let signer = signer();
        let lease = lease();
        let mut expected = AuthorizedLeaseExpectation::from(&lease);
        expected.query_instance_id += 1;
        let error = signer
            .verify_for_service(
                &lease,
                &expected,
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                TARGET,
                APP,
            )
            .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTHORIZED_LEASE_BOUNDARY_MISMATCH"
        );
        let error = signer
            .verify_for_service(
                &lease,
                &AuthorizedLeaseExpectation::from(&lease),
                AuthorizedLeaseConfig::default(),
                lease.authorized_until_server_ms,
                TARGET,
                APP,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_EXPIRED");
    }

    /// ENG-24992 (LLP 0053 §The lease, verification locus): a single flipped
    /// MAC bit keeps the envelope canonically shaped — shape/custody
    /// validation accepts it by design, exactly like the client-side analogue
    /// pinned in packages/snapback-contract/authorized-lease.test.mjs — and
    /// only the server's keyed verifier refuses it.
    #[test]
    fn one_flipped_mac_bit_passes_shape_but_fails_the_keyed_verifier() {
        let original = lease();
        let mut bytes = URL_SAFE_NO_PAD.decode(&original.mac).unwrap();
        bytes[0] ^= 0x01;
        let mut tampered = original.clone();
        tampered.mac = URL_SAFE_NO_PAD.encode(&bytes);
        assert_ne!(tampered.mac, original.mac);
        tampered
            .validate_shape(AuthorizedLeaseConfig::default())
            .unwrap();
        let error = signer()
            .verify_for_service(
                &tampered,
                &AuthorizedLeaseExpectation::from(&tampered),
                AuthorizedLeaseConfig::default(),
                NOW + 1,
                TARGET,
                APP,
            )
            .unwrap_err();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_INVALID");
    }

    /// ENG-24992: "an unknown key fails closed" is a server-keyring rule (the
    /// client treats keyId as opaque). A lease naming a key the keyring never
    /// held cannot resolve verifier material, and a resolved key with another
    /// id refuses the foreign lease before any MAC arithmetic.
    #[test]
    fn unknown_lease_key_fails_closed_at_the_keyring() {
        let random = IncrementingRandom::default();
        let ring = AuthKeyringStore::in_memory();
        ring.load_or_mint_initial(NOW, &random).unwrap();
        let lease = lease();
        let key_id = AuthKeyId::parse(&lease.key_id).unwrap();
        assert_eq!(
            ring.with_key(&key_id, |_| ()).unwrap_err(),
            KeyringError::MissingKey,
        );
        let error = ring
            .with_active_key(NOW, &random, |key_id, key| {
                AuthorizedLeaseAuthenticator::new(key_id, key)
                    .verify_for_service(
                        &lease,
                        &AuthorizedLeaseExpectation::from(&lease),
                        AuthorizedLeaseConfig::default(),
                        NOW + 1,
                        TARGET,
                        APP,
                    )
                    .unwrap_err()
            })
            .unwrap();
        assert_eq!(error.diagnostic.code, "SNAPBACK_AUTHORIZED_LEASE_INVALID");
    }

    #[derive(Default)]
    struct IncrementingRandom(Mutex<u8>);

    impl RandomSource for IncrementingRandom {
        fn fill(&self, destination: &mut [u8]) -> Result<(), CryptoError> {
            let mut next = self.0.lock().expect("test random lock");
            for byte in destination {
                *next = next.wrapping_add(1);
                *byte = *next;
            }
            Ok(())
        }
    }

    #[test]
    fn persistent_keyring_verifies_old_leases_for_the_full_hard_maximum() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("protocol-keyring.json");
        let random = IncrementingRandom::default();
        let ring = AuthKeyringStore::file_at_path(path.clone());
        ring.load_or_mint_initial(NOW, &random).unwrap();
        let issued_at = NOW + AUTH_KEY_ROTATION_AGE_MS - 1;
        let mut issue = issue();
        issue.session_not_after_ms = Some(issued_at + AUTHORIZED_LEASE_HARD_MAX_MS);
        issue.provider_not_after_ms = None;
        let lease = ring
            .with_active_key(issued_at, &random, |key_id, key| {
                AuthorizedLeaseAuthenticator::new(key_id, key)
                    .issue(
                        issue,
                        AuthorizedLeaseConfig::default(),
                        issued_at,
                        TARGET,
                        APP,
                    )
                    .unwrap()
            })
            .unwrap();

        let retired_at = NOW + AUTH_KEY_ROTATION_AGE_MS;
        assert!(ring.rotate_if_due(retired_at, &random).unwrap());
        assert_eq!(
            ring.prune_retired(
                retired_at + AUTHORIZED_LEASE_HARD_MAX_MS - 1,
                &random,
                |_| Ok(false),
            )
            .unwrap(),
            0,
        );

        // A process restart reopens the owner-only sidecar and selects the
        // retired verify-only key named by the lease.
        let reopened = AuthKeyringStore::file_at_path(path);
        let key_id = AuthKeyId::parse(&lease.key_id).unwrap();
        reopened
            .with_key(&key_id, |key| {
                AuthorizedLeaseAuthenticator::new(&key_id, key)
                    .verify_for_service(
                        &lease,
                        &AuthorizedLeaseExpectation::from(&lease),
                        AuthorizedLeaseConfig::default(),
                        lease.authorized_until_server_ms - 1,
                        TARGET,
                        APP,
                    )
                    .unwrap();
            })
            .unwrap();

        assert_eq!(
            reopened
                .prune_retired(retired_at + AUTHORIZED_LEASE_HARD_MAX_MS, &random, |_| Ok(
                    false
                ),)
                .unwrap(),
            1,
        );
    }
}
