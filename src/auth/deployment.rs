//! Target-owned hosted authentication deployment facts.
//!
//! Candidate app artifacts and operator flags may request hosted posture, but
//! they cannot assert any fact in this module. Concrete target constructors
//! publish the closed descriptor and admission derives from its conjunction.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use axum::http;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use clap::ValueEnum;
use hmac::{Hmac, Mac as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fmt;
use std::path::Path;
use std::sync::{Arc, RwLock};
use zeroize::Zeroize as _;

use super::throttle::AuthenticationThrottleKey;
pub use super::throttle::{AuthenticationBucketPolicy, SharedAuthenticationThrottleConfig};

/// The exposure contract an operator asks the serving target to satisfy.
///
/// `hosted` is must-understand. A local listener never treats loopback, a
/// production profile, or an operator-managed reverse proxy as evidence that
/// the target owns the hosted edge.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    Deserialize,
    Eq,
    PartialEq,
    Serialize,
    ValueEnum,
    schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AuthDeploymentTarget {
    #[default]
    Local,
    Hosted,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum ExternalTls {
    #[default]
    Unavailable,
    Enforced,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum EffectiveSource {
    #[default]
    Unavailable,
    Trusted,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum AuthenticationThrottle {
    #[default]
    Unavailable,
    ProcessLocal,
    SharedEnforced,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum SessionInvalidation {
    #[default]
    Unavailable,
    SingleProcess,
    GloballyFenced,
}

/// The strongest browser credential claim the target can honestly advertise.
///
/// A restrictive CSP does not upgrade bearer v1: app-origin script can still
/// read or exercise the coordinator's IndexedDB/page-memory credential.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum BrowserCredentialPosture {
    #[default]
    Unavailable,
    BearerV1XssExposed,
    SenderConstrainedV2,
}

/// Whether the browser artifact can construct a client with a directly
/// supplied bearer instead of coordinator custody.
#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum BrowserDirectBearerSeam {
    #[default]
    Available,
    Excluded,
}

#[derive(
    Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum HostedOperatorSurface {
    #[default]
    Enabled,
    Disabled,
}

/// Closed hosted-auth capability descriptor authored by the serving target.
///
/// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — every deployment fact
/// and the browser credential posture is independent and fail-closed.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HostedAuthCapabilities {
    pub external_tls: ExternalTls,
    pub effective_source: EffectiveSource,
    pub authentication_throttle: AuthenticationThrottle,
    pub session_invalidation: SessionInvalidation,
    pub client_credential_posture: BrowserCredentialPosture,
}

impl Default for HostedAuthCapabilities {
    fn default() -> Self {
        Self::local_target()
    }
}

impl HostedAuthCapabilities {
    /// A target with no authentication surface. This differs from the local
    /// target, which really does have process-local bearer auth mechanisms.
    pub const fn no_auth_target() -> Self {
        Self {
            external_tls: ExternalTls::Unavailable,
            effective_source: EffectiveSource::Unavailable,
            authentication_throttle: AuthenticationThrottle::Unavailable,
            session_invalidation: SessionInvalidation::Unavailable,
            client_credential_posture: BrowserCredentialPosture::Unavailable,
        }
    }

    pub const fn local_target() -> Self {
        Self {
            external_tls: ExternalTls::Unavailable,
            effective_source: EffectiveSource::Unavailable,
            authentication_throttle: AuthenticationThrottle::ProcessLocal,
            session_invalidation: SessionInvalidation::SingleProcess,
            client_credential_posture: BrowserCredentialPosture::BearerV1XssExposed,
        }
    }

    /// Static build support only. Actual hosted admission additionally needs
    /// a deployment-bound attestation, live health, mixed-version proof, and
    /// an isolated/disabled operator surface.
    pub const fn deployment_capable(self) -> bool {
        matches!(self.external_tls, ExternalTls::Enforced)
            && matches!(self.effective_source, EffectiveSource::Trusted)
            && matches!(
                self.authentication_throttle,
                AuthenticationThrottle::SharedEnforced
            )
            && matches!(
                self.session_invalidation,
                SessionInvalidation::GloballyFenced
            )
    }

    pub const fn hosted_auth_capable(self) -> bool {
        self.deployment_capable()
            && matches!(
                self.client_credential_posture,
                BrowserCredentialPosture::SenderConstrainedV2
            )
    }

    /// Safe public blocker names only: never proxy/source material, limiter
    /// keys, session ids, proof ids, or invalidation stream credentials.
    pub fn blockers(self) -> Vec<&'static str> {
        let mut blockers = Vec::new();
        if !matches!(self.external_tls, ExternalTls::Enforced) {
            blockers.push("externalTls");
        }
        if !matches!(self.effective_source, EffectiveSource::Trusted) {
            blockers.push("effectiveSource");
        }
        if !matches!(
            self.authentication_throttle,
            AuthenticationThrottle::SharedEnforced
        ) {
            blockers.push("authenticationThrottle");
        }
        if !matches!(
            self.session_invalidation,
            SessionInvalidation::GloballyFenced
        ) {
            blockers.push("sessionInvalidation");
        }
        if !matches!(
            self.client_credential_posture,
            BrowserCredentialPosture::SenderConstrainedV2
        ) {
            blockers.push("clientCredentialPosture");
        }
        blockers
    }
}

pub const HOSTED_ADMISSION_VERSION: u64 = 1;
pub const HOSTED_ADMISSION_MAX_LIFETIME_MS: u64 = 5 * 60 * 1_000;
/// Largest integer every JavaScript implementation can represent exactly.
pub const HOSTED_ADMISSION_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
// Retained as the Rust schema/test authority for LLP 0072's provider-neutral
// HMAC projection protocol. LLP 0098's concrete runtime seam uses the stronger
// release-bound Ed25519 path, so these are intentionally test-only for now.
#[cfg_attr(not(test), allow(dead_code))]
const HOSTED_ADMISSION_ENVELOPE_MAX_BYTES: usize = 64 * 1024;
#[cfg_attr(not(test), allow(dead_code))]
const HOSTED_ADMISSION_KEY_MAX_BYTES: usize = 4 * 1024;
#[cfg_attr(not(test), allow(dead_code))]
const HOSTED_ADMISSION_ENVELOPE_VERSION: &str = "snapback.hosted-admission-envelope.v1";
#[cfg_attr(not(test), allow(dead_code))]
const HOSTED_ADMISSION_KEY_VERSION: &str = "snapback.hosted-admission-key.v1";
#[cfg_attr(not(test), allow(dead_code))]
const HOSTED_ADMISSION_MAC_DOMAIN: &[u8] = b"snapback-hosted-admission-envelope-v1\0";

/// Closed, deployment-bound facts required before a future hosted target can
/// claim readiness. This is a schema authority only: no current target owns
/// the authenticated producer or live-health authority needed to admit it.
///
/// @ref LLP 0060#d5-hosted-readiness-is-conjunctive — a positive admission
/// includes the exact capability facts and every non-static admission gate.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HostedAdmission {
    #[schemars(range(min = 1, max = 1))]
    pub version: u64,
    #[schemars(length(min = 1))]
    pub deployment_id: String,
    #[schemars(pattern(r"^[0-9a-f]{64}$"))]
    pub configuration_sha256: String,
    #[schemars(pattern(r"^[0-9a-f]{64}$"))]
    pub support_sha256: String,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub admission_epoch: u64,
    #[schemars(range(max = 9007199254740991_i64))]
    pub issued_at_ms: u64,
    #[schemars(range(max = 9007199254740991_i64))]
    pub expires_at_ms: u64,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub limiter_epoch: u64,
    pub authentication_throttle_config: SharedAuthenticationThrottleConfig,
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub invalidation_epoch: u64,
    /// Control-plane monotone floor for the durable `sender_replay_epoch`.
    /// Stored outside the rolled-back durable set and only ever advanced by
    /// the control plane; the serving boot applies
    /// `effective epoch = max(durable, floor)` so a raw backup rollback
    /// cannot resurrect an accepted proof. Zero means "no floor delivered"
    /// (a valid state for targets predating the field).
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — decision 1: the
    /// composition ratchet (LLP 0059 incarnation + control-plane floor).
    #[schemars(range(max = 9007199254740991_i64))]
    #[serde(default)]
    pub sender_replay_epoch_floor: u64,
    #[schemars(range(min = 1, max = 1))]
    pub handler_protocol_version: u64,
    #[schemars(length(min = 1))]
    pub handler_incarnation: String,
    pub operator_surface: HostedOperatorSurface,
    pub browser_direct_bearer_seam: BrowserDirectBearerSeam,
    pub hosted_auth: HostedAuthCapabilities,
}

impl HostedAdmission {
    /// Validate the closed facts carried by the snapshot. Provider
    /// authentication, rollback state, and live health are separate serving
    /// checks and intentionally cannot be inferred from this object alone.
    pub fn closed_admission_facts_hold(&self) -> bool {
        self.version == HOSTED_ADMISSION_VERSION
            && !self.deployment_id.is_empty()
            && is_sha256_hex(&self.configuration_sha256)
            && is_sha256_hex(&self.support_sha256)
            && self.admission_epoch > 0
            && self.admission_epoch <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.issued_at_ms <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.expires_at_ms <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.issued_at_ms <= self.expires_at_ms
            && self.expires_at_ms - self.issued_at_ms <= HOSTED_ADMISSION_MAX_LIFETIME_MS
            && self.limiter_epoch > 0
            && self.limiter_epoch <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.authentication_throttle_config.validate().is_ok()
            && self.invalidation_epoch > 0
            && self.invalidation_epoch <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.sender_replay_epoch_floor <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.handler_protocol_version == 1
            && !self.handler_incarnation.is_empty()
            && self.operator_surface == HostedOperatorSurface::Disabled
            && self.browser_direct_bearer_seam == BrowserDirectBearerSeam::Excluded
            && self.hosted_auth.hosted_auth_capable()
    }
}

/// Closed, MAC-authenticated handoff from the target control plane to one
/// handler boot. The envelope contains no key material and is safe to retain
/// as evidence; the sibling key file is a provider-secret-manager projection
/// and is never copied into release, backup, log, or receipt artifacts.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct HostedAdmissionEnvelope {
    schema_version: String,
    #[schemars(pattern(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"))]
    key_id: String,
    #[schemars(length(min = 1, max = 512))]
    public_origin: String,
    admission: HostedAdmission,
    #[schemars(pattern(r"^[A-Za-z0-9_-]{43}$"))]
    mac: String,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct HostedAdmissionKeyFile {
    schema_version: String,
    #[schemars(pattern(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"))]
    key_id: String,
    #[schemars(pattern(r"^[A-Za-z0-9_-]{43}$"))]
    material: String,
}

fn hosted_admission_invalid(message: &'static str) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
        "auth-deployment",
        message,
    )
}

#[cfg_attr(not(test), allow(dead_code))]
fn write_canonical_json(
    output: &mut Vec<u8>,
    value: &serde_json::Value,
) -> Result<(), serde_json::Error> {
    match value {
        serde_json::Value::Null
        | serde_json::Value::Bool(_)
        | serde_json::Value::Number(_)
        | serde_json::Value::String(_) => serde_json::to_writer(output, value)?,
        serde_json::Value::Array(items) => {
            output.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical_json(output, item)?;
            }
            output.push(b']');
        }
        serde_json::Value::Object(object) => {
            output.push(b'{');
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                serde_json::to_writer(&mut *output, key)?;
                output.push(b':');
                write_canonical_json(
                    output,
                    object
                        .get(key)
                        .expect("canonical JSON key came from the same object"),
                )?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
fn hosted_admission_mac_input(envelope: &HostedAdmissionEnvelope) -> SnapbackResult<Vec<u8>> {
    let content = serde_json::json!({
        "schemaVersion": envelope.schema_version,
        "keyId": envelope.key_id,
        "publicOrigin": envelope.public_origin,
        "admission": envelope.admission,
    });
    let mut encoded = Vec::new();
    write_canonical_json(&mut encoded, &content)
        .map_err(|_| hosted_admission_invalid("hosted admission could not be canonicalized"))?;
    let mut input = Vec::with_capacity(HOSTED_ADMISSION_MAC_DOMAIN.len() + encoded.len());
    input.extend_from_slice(HOSTED_ADMISSION_MAC_DOMAIN);
    input.extend_from_slice(&encoded);
    Ok(input)
}

#[cfg_attr(not(test), allow(dead_code))]
fn parse_hosted_admission_envelope(bytes: &[u8]) -> SnapbackResult<HostedAdmissionEnvelope> {
    serde_json::from_slice(bytes).map_err(|_| {
        hosted_admission_invalid("hosted admission envelope is not the closed version-1 shape")
    })
}

/// Owning custody for the 32-byte hosted admission MAC key. The key outlives
/// every individual verification, so it holds its own material and zeroizes on
/// drop rather than leaving it resident in a shared handle.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct HostedAdmissionMacKey([u8; 32]);

impl HostedAdmissionMacKey {
    #[cfg_attr(not(test), allow(dead_code))]
    fn new(material: &[u8; 32]) -> Self {
        Self(*material)
    }

    fn mac(&self) -> Hmac<Sha256> {
        Hmac::<Sha256>::new_from_slice(&self.0).expect("HMAC-SHA-256 accepts every key length")
    }
}

impl Drop for HostedAdmissionMacKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[cfg_attr(not(test), allow(dead_code))]
fn verify_hosted_admission_envelope(
    envelope: HostedAdmissionEnvelope,
    expected_key_id: &str,
    verification_key: &HostedAdmissionMacKey,
) -> SnapbackResult<HostedAdmissionEnvelope> {
    if envelope.schema_version != HOSTED_ADMISSION_ENVELOPE_VERSION
        || envelope.key_id != expected_key_id
        || !is_portable_identifier(&envelope.key_id)
    {
        return Err(hosted_admission_invalid(
            "hosted admission envelope has an unsupported identity",
        ));
    }
    let provided = URL_SAFE_NO_PAD
        .decode(&envelope.mac)
        .map_err(|_| hosted_admission_invalid("hosted admission MAC is not canonical base64url"))?;
    if provided.len() != 32 || URL_SAFE_NO_PAD.encode(&provided) != envelope.mac {
        return Err(hosted_admission_invalid(
            "hosted admission MAC is not a canonical 32-byte value",
        ));
    }
    let input = hosted_admission_mac_input(&envelope)?;
    let mut mac = verification_key.mac();
    mac.update(&input);
    mac.verify_slice(&provided)
        .map_err(|_| hosted_admission_invalid("hosted admission MAC verification failed"))?;
    Ok(envelope)
}

#[cfg_attr(not(test), allow(dead_code))]
fn read_hosted_admission_envelope(path: &Path) -> SnapbackResult<HostedAdmissionEnvelope> {
    let bytes =
        crate::secure_file::read_strict_owner_only(path, HOSTED_ADMISSION_ENVELOPE_MAX_BYTES)
            .map_err(|_| {
                hosted_admission_invalid(
                    "hosted admission envelope is not a strict owner-only regular file",
                )
            })?;
    parse_hosted_admission_envelope(&bytes)
}

/// Provider-authenticated serving authority retained by one hosted target.
///
/// The public origin is target configuration, never a request forwarding
/// header. Construction is crate-private so an HTTP embedder cannot turn an
/// arbitrary `Host`/`Forwarded` value into proof-verification authority.
/// A hot-swappable slot holding the deployment's current serving authority.
///
/// An admission lives at most five minutes (D5), so a deployment that serves
/// longer than one snapshot needs its authority replaced in place — every
/// `AppState` clone must observe the successor. The slot is that shared
/// reference.
///
/// **This cannot widen the serving window.** Each installed authority still
/// carries its own `issuedAtMs`/`expiresAtMs` and every request re-checks them
/// through `admission_epoch_at`. Renewal only ever replaces a snapshot with
/// another independently verified one; if no valid successor exists the
/// incumbent expires and serving withdraws exactly as it does today.
///
/// @ref LLP 0098#5-live-health-and-withdrawal — renewal composes with
/// withdrawal, it does not suppress it.
#[derive(Clone)]
pub(crate) struct HostedServingHandle {
    current: Arc<std::sync::RwLock<Arc<HostedServingAuthority>>>,
}

impl fmt::Debug for HostedServingHandle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("HostedServingHandle").finish()
    }
}

impl HostedServingHandle {
    pub(crate) fn new(authority: HostedServingAuthority) -> Self {
        Self {
            current: Arc::new(std::sync::RwLock::new(Arc::new(authority))),
        }
    }

    /// The authority in force right now. A poisoned lock is treated as a lost
    /// authority by the caller rather than panicking a request thread.
    pub(crate) fn current(&self) -> Option<Arc<HostedServingAuthority>> {
        self.current.read().ok().map(|guard| guard.clone())
    }

    pub(crate) fn hosted_target_authority_instance_at(
        &self,
        now_ms: u64,
        authorization_incarnation: &str,
        boot_nonce: &str,
    ) -> SnapbackResult<Option<String>> {
        self.current()
            .ok_or_else(|| hosted_admission_invalid("hosted serving authority is unavailable"))?
            .hosted_target_authority_instance_at(now_ms, authorization_incarnation, boot_nonce)
    }

    /// Replace the incumbent with an independently verified successor.
    pub(crate) fn install(&self, authority: HostedServingAuthority) -> bool {
        match self.current.write() {
            Ok(mut guard) => {
                if !guard.same_hosted_target_process(&authority) {
                    return false;
                }
                *guard = Arc::new(authority);
                true
            }
            Err(_) => false,
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone)]
pub(crate) struct HostedServingAuthority {
    admission: Arc<RwLock<HostedAdmission>>,
    public_origin: Arc<str>,
    admission_key_id: Option<Arc<str>>,
    admission_verification_key: Option<Arc<HostedAdmissionMacKey>>,
    authentication_throttle_key: Arc<AuthenticationThrottleKey>,
    hosted_target_admission: Option<Arc<crate::deploy::HostedAdmissionV2>>,
}

impl fmt::Debug for HostedServingAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let admission = self.admission.read().ok();
        formatter
            .debug_struct("HostedServingAuthority")
            .field(
                "admission_epoch",
                &admission
                    .as_ref()
                    .map(|admission| admission.admission_epoch),
            )
            .field(
                "expires_at_ms",
                &admission.as_ref().map(|admission| admission.expires_at_ms),
            )
            .field("public_origin", &"[REDACTED]")
            .finish()
    }
}

impl HostedServingAuthority {
    fn validate_target_facts(
        public_origin: &str,
        admission: &HostedAdmission,
        observed_at_ms: u64,
    ) -> SnapbackResult<()> {
        let parsed = public_origin.parse::<http::Uri>().map_err(|_| {
            hosted_admission_invalid(
                "hosted serving authority has an invalid canonical public origin",
            )
        })?;
        let authority = parsed.authority().ok_or_else(|| {
            hosted_admission_invalid("hosted serving authority has no canonical public authority")
        })?;
        let origin_is_canonical = parsed.scheme_str() == Some("https")
            && parsed.path() == "/"
            && parsed.query().is_none()
            && !authority.as_str().contains('@')
            && authority
                .host()
                .bytes()
                .all(|byte| !byte.is_ascii_uppercase())
            && authority.port_u16() != Some(443)
            && public_origin == format!("https://{authority}");
        if !origin_is_canonical
            || !admission.closed_admission_facts_hold()
            || observed_at_ms < admission.issued_at_ms
            || observed_at_ms > admission.expires_at_ms
        {
            return Err(hosted_admission_invalid(
                "hosted serving authority is incomplete, expired, or non-canonical",
            ));
        }
        Ok(())
    }

    /// Install facts only after the target adapter authenticated its
    /// admission producer, live health, and canonical public origin.
    #[allow(dead_code)] // Consumed by the first concrete hosted adapter.
    pub(crate) fn from_authenticated_target(
        public_origin: impl Into<String>,
        admission: HostedAdmission,
        observed_at_ms: u64,
        authentication_throttle_key: [u8; 32],
    ) -> SnapbackResult<Self> {
        let public_origin = public_origin.into();
        Self::validate_target_facts(&public_origin, &admission, observed_at_ms)?;
        Ok(Self {
            admission: Arc::new(RwLock::new(admission)),
            public_origin: Arc::from(public_origin),
            admission_key_id: None,
            admission_verification_key: None,
            authentication_throttle_key: Arc::new(AuthenticationThrottleKey::from_bytes(
                authentication_throttle_key,
            )),
            hosted_target_admission: None,
        })
    }

    pub(crate) fn install_hosted_target_admission(
        &mut self,
        admission: Option<crate::deploy::HostedAdmissionV2>,
    ) {
        self.hosted_target_admission = admission.map(Arc::new);
    }

    fn same_hosted_target_process(&self, successor: &Self) -> bool {
        match (
            self.hosted_target_admission.as_deref(),
            successor.hosted_target_admission.as_deref(),
        ) {
            (None, None) => true,
            (Some(current), Some(next)) => {
                current.target_id == next.target_id
                    && current.deployment_id == next.deployment_id
                    && current.binding_generation == next.binding_generation
                    && current.target_binding_sha256 == next.target_binding_sha256
                    && current.control_head_sha256 == next.control_head_sha256
                    && current.supervisor_incarnation == next.supervisor_incarnation
                    && current.exact_roster_sha256 == next.exact_roster_sha256
                    && current.routed_machine_id == next.routed_machine_id
                    && current.replay_floor == next.replay_floor
                    && current.admission_generation == next.admission_generation
                    && next.issued_at_ms >= current.issued_at_ms
                    && next.hosted_auth_expires_at_ms >= current.hosted_auth_expires_at_ms
                    && next.routed_machine_expires_at_ms >= current.routed_machine_expires_at_ms
            }
            _ => false,
        }
    }

    pub(crate) fn hosted_target_authority_instance_at(
        &self,
        now_ms: u64,
        authorization_incarnation: &str,
        boot_nonce: &str,
    ) -> SnapbackResult<Option<String>> {
        self.admission_epoch_at(now_ms)?;
        let Some(target) = self.hosted_target_admission.as_deref() else {
            return Ok(None);
        };
        if now_ms < target.issued_at_ms
            || now_ms > target.hosted_auth_expires_at_ms
            || now_ms > target.routed_machine_expires_at_ms
        {
            return Err(SnapbackError::error(
                "SNAPBACK_HOSTED_ADMISSION_V2_STALE",
                "auth-deployment",
                "hosted routed-Machine authority is not current",
            ));
        }
        let facts = serde_json::json!({
            "targetId": target.target_id,
            "deploymentId": target.deployment_id,
            "machineId": target.routed_machine_id,
            "authorizationIncarnation": authorization_incarnation,
            "bootSequence": target.admission_generation,
            "bootNonce": boot_nonce,
            "profile": "single-instance-sticky-memory.v1",
        });
        let mut canonical = Vec::new();
        write_canonical_json(&mut canonical, &facts).map_err(|_| {
            hosted_admission_invalid("ephemeral authority instance could not be canonicalized")
        })?;
        let mut digest = Sha256::new();
        digest.update(b"snapback:ephemeral-authority-instance:v1\n");
        digest.update(canonical);
        Ok(Some(format!(
            "eai1.{}",
            URL_SAFE_NO_PAD.encode(digest.finalize())
        )))
    }

    /// Authenticate the provider-produced boot envelope before database open
    /// or listener bind. Both files are strict 0600, single-link, owner-owned
    /// regular files; key material is zeroized after the in-memory authorities
    /// are constructed.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — the serving process
    /// consumes the external monotone floor only through authenticated
    /// control-plane authority outside the application backup set.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn from_authenticated_envelope_files(
        envelope_path: &Path,
        key_path: &Path,
        observed_at_ms: u64,
    ) -> SnapbackResult<Self> {
        let mut key_bytes =
            crate::secure_file::read_strict_owner_only(key_path, HOSTED_ADMISSION_KEY_MAX_BYTES)
                .map_err(|_| {
                    hosted_admission_invalid(
                        "hosted admission key is not a strict owner-only regular file",
                    )
                })?;
        let parsed_key_file = serde_json::from_slice(&key_bytes);
        key_bytes.zeroize();
        let mut key_file: HostedAdmissionKeyFile = parsed_key_file.map_err(|_| {
            hosted_admission_invalid("hosted admission key is not the closed version-1 shape")
        })?;
        if key_file.schema_version != HOSTED_ADMISSION_KEY_VERSION
            || !is_portable_identifier(&key_file.key_id)
        {
            key_file.material.zeroize();
            return Err(hosted_admission_invalid(
                "hosted admission key has an unsupported identity",
            ));
        }
        let decoded_material = URL_SAFE_NO_PAD.decode(&key_file.material);
        let mut canonical_material = key_file.material.clone();
        key_file.material.zeroize();
        let mut material = match decoded_material {
            Ok(material) => material,
            Err(_) => {
                canonical_material.zeroize();
                return Err(hosted_admission_invalid(
                    "hosted admission key material is not canonical base64url",
                ));
            }
        };
        let material_is_canonical =
            material.len() == 32 && URL_SAFE_NO_PAD.encode(&material) == canonical_material;
        canonical_material.zeroize();
        if !material_is_canonical {
            material.zeroize();
            return Err(hosted_admission_invalid(
                "hosted admission key material is not a canonical 32-byte value",
            ));
        }
        let mut key_array = [0_u8; 32];
        key_array.copy_from_slice(&material);
        material.zeroize();
        let verification_key = HostedAdmissionMacKey::new(&key_array);
        let envelope_result = read_hosted_admission_envelope(envelope_path).and_then(|envelope| {
            verify_hosted_admission_envelope(envelope, &key_file.key_id, &verification_key)
        });
        let envelope = match envelope_result {
            Ok(envelope) => envelope,
            Err(error) => {
                key_array.zeroize();
                return Err(error);
            }
        };
        if envelope.admission.sender_replay_epoch_floor == 0 {
            key_array.zeroize();
            return Err(hosted_admission_invalid(
                "hosted admission boot requires an external sender replay floor",
            ));
        }
        let authority_result = Self::from_authenticated_target(
            envelope.public_origin,
            envelope.admission,
            observed_at_ms,
            key_array,
        );
        key_array.zeroize();
        let mut authority = authority_result?;
        authority.admission_key_id = Some(Arc::from(key_file.key_id));
        authority.admission_verification_key = Some(Arc::new(verification_key));
        Ok(authority)
    }

    /// Refresh one short-lived admission without changing the handler-boot
    /// incarnation or its external replay floor. A next boot must allocate a
    /// strictly newer floor; a live refresh may only extend authenticated
    /// serving health for the already-reconciled boot.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn refresh_from_authenticated_envelope_file(
        &self,
        envelope_path: &Path,
        observed_at_ms: u64,
    ) -> SnapbackResult<()> {
        let key_id = self.admission_key_id.as_deref().ok_or_else(|| {
            hosted_admission_invalid("hosted admission authority is not refreshable")
        })?;
        let verification_key = self.admission_verification_key.as_deref().ok_or_else(|| {
            hosted_admission_invalid("hosted admission authority is not refreshable")
        })?;
        let envelope = verify_hosted_admission_envelope(
            read_hosted_admission_envelope(envelope_path)?,
            key_id,
            verification_key,
        )?;
        if envelope.public_origin.as_str() != self.public_origin.as_ref() {
            return Err(hosted_admission_invalid(
                "hosted admission refresh changed the canonical public origin",
            ));
        }
        Self::validate_target_facts(&envelope.public_origin, &envelope.admission, observed_at_ms)?;
        let mut current = self
            .admission
            .write()
            .map_err(|_| hosted_admission_invalid("hosted admission authority is unavailable"))?;
        let next = envelope.admission;
        if next.deployment_id != current.deployment_id
            || next.configuration_sha256 != current.configuration_sha256
            || next.support_sha256 != current.support_sha256
            || next.authentication_throttle_config != current.authentication_throttle_config
            || next.handler_protocol_version != current.handler_protocol_version
            || next.handler_incarnation != current.handler_incarnation
            || next.operator_surface != current.operator_surface
            || next.browser_direct_bearer_seam != current.browser_direct_bearer_seam
            || next.hosted_auth != current.hosted_auth
            || next.sender_replay_epoch_floor != current.sender_replay_epoch_floor
            || next.admission_epoch < current.admission_epoch
            || next.limiter_epoch < current.limiter_epoch
            || next.invalidation_epoch < current.invalidation_epoch
            || next.issued_at_ms < current.issued_at_ms
            || next.expires_at_ms < current.expires_at_ms
        {
            return Err(hosted_admission_invalid(
                "hosted admission refresh is stale or changes handler-boot identity",
            ));
        }
        *current = next;
        Ok(())
    }

    /// The capability tuple this verified admission attests.
    pub(crate) fn capabilities(&self) -> HostedAuthCapabilities {
        self.admission
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .hosted_auth
    }

    pub(crate) fn admission_epoch_at(&self, now_ms: u64) -> SnapbackResult<u64> {
        let admission = self
            .admission
            .read()
            .map_err(|_| hosted_admission_invalid("hosted admission authority is unavailable"))?;
        if now_ms < admission.issued_at_ms || now_ms > admission.expires_at_ms {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED",
                "auth-deployment",
                "hosted serving admission is not current",
            ));
        }
        Ok(admission.admission_epoch)
    }

    pub(crate) fn authentication_throttle_at(
        &self,
        now_ms: u64,
    ) -> SnapbackResult<HostedAuthenticationThrottle> {
        self.admission_epoch_at(now_ms)?;
        let admission = self
            .admission
            .read()
            .map_err(|_| hosted_admission_invalid("hosted admission authority is unavailable"))?;
        Ok(HostedAuthenticationThrottle {
            limiter_epoch: admission.limiter_epoch,
            deployment_id: admission.deployment_id.clone(),
            config: admission.authentication_throttle_config.clone(),
            key: self.authentication_throttle_key.clone(),
        })
    }

    /// The control-plane monotone floor for the durable sender replay
    /// namespace, applied at authority install (decision 1's anti-rollback
    /// composition).
    pub(crate) fn sender_replay_epoch_floor(&self) -> u64 {
        self.admission
            .read()
            .map(|admission| admission.sender_replay_epoch_floor)
            .unwrap_or(0)
    }

    /// Purpose key for the deterministic unknown-carrier cover nonce.
    ///
    /// @ref LLP 0077#author-decisions--2026-07-23 — decision 3: the cover
    /// nonce is `HMAC(server secret, sender_replay_epoch ‖ token_digest ‖
    /// time_bucket)`; the secret here is a domain-separated derivation of the
    /// target-attested key, valid only while admission is valid.
    pub(crate) fn sender_cover_key_at(
        &self,
        now_ms: u64,
    ) -> SnapbackResult<crate::auth::sender_proof::SenderCoverNonceKey> {
        self.admission_epoch_at(now_ms)?;
        Ok(crate::auth::sender_proof::SenderCoverNonceKey::from_bytes(
            self.authentication_throttle_key.derive_sender_cover_key(),
        ))
    }

    /// Derive the proof target solely from authenticated target origin plus
    /// the already-routed absolute path. Query and all forwarding headers are
    /// excluded from the proof identity.
    pub(crate) fn canonical_external_uri(
        &self,
        request_uri: &http::Uri,
        now_ms: u64,
    ) -> SnapbackResult<String> {
        self.admission_epoch_at(now_ms)?;
        let path = request_uri.path();
        let normalized = path.starts_with('/')
            && path.is_ascii()
            && !path.contains('%')
            && !path.contains('\\')
            && !path.contains("//")
            && !path.split('/').any(|segment| matches!(segment, "." | ".."));
        if !normalized {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_SENDER_PROOF_INVALID",
                "auth",
                "sender proof target is invalid",
            ));
        }
        Ok(format!("{}{}", self.public_origin, path))
    }
}

#[derive(Clone)]
pub(crate) struct HostedAuthenticationThrottle {
    pub(crate) limiter_epoch: u64,
    pub(crate) deployment_id: String,
    pub(crate) config: SharedAuthenticationThrottleConfig,
    pub(crate) key: Arc<AuthenticationThrottleKey>,
}

impl fmt::Debug for HostedAuthenticationThrottle {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostedAuthenticationThrottle")
            .field("limiter_epoch", &self.limiter_epoch)
            .field("deployment_id", &self.deployment_id)
            .field("config", &self.config)
            .field("key", &"[REDACTED]")
            .finish()
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg_attr(not(test), allow(dead_code))]
fn is_portable_identifier(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.bytes().enumerate().all(|(index, byte)| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' => true,
            b'.' | b'_' | b'-' => index > 0,
            _ => false,
        })
}

pub fn deployment_unsupported(capabilities: HostedAuthCapabilities) -> SnapbackError {
    let mut blockers = capabilities.blockers();
    blockers.extend([
        "deploymentAttestation",
        "liveHealth",
        "handlerCompatibility",
        "browserDirectBearerSeam",
        "operatorSurface",
    ]);
    SnapbackError::error(
        "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED",
        "auth-deployment",
        "the selected target cannot enforce the complete hosted authentication contract",
    )
    .with_details(serde_json::json!({
        "requestedDeployment": "hosted",
        "blockers": blockers,
    }))
}

/// Validate a must-understand deployment request before target state is opened
/// or any listener is bound.
pub fn validate_auth_deployment(
    requested: AuthDeploymentTarget,
    capabilities: HostedAuthCapabilities,
) -> SnapbackResult<()> {
    if requested == AuthDeploymentTarget::Hosted {
        // No current Snapback target owns the deployment-attestation and
        // live-health authorities required by LLP 0060. Static build support
        // is deliberately insufficient to authorize serving.
        return Err(deployment_unsupported(capabilities));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed_envelope(
        admission: HostedAdmission,
        key_id: &str,
        key: &[u8; 32],
    ) -> HostedAdmissionEnvelope {
        let mut envelope = HostedAdmissionEnvelope {
            schema_version: HOSTED_ADMISSION_ENVELOPE_VERSION.to_owned(),
            key_id: key_id.to_owned(),
            public_origin: "https://app.example.test".to_owned(),
            admission,
            mac: String::new(),
        };
        let input = hosted_admission_mac_input(&envelope).unwrap();
        let mut mac = HostedAdmissionMacKey::new(key).mac();
        mac.update(&input);
        envelope.mac = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        envelope
    }

    fn positive_throttle_config() -> SharedAuthenticationThrottleConfig {
        let policy = AuthenticationBucketPolicy {
            interval_ms: 10,
            burst: 200,
            maximum_denial_debt_attempts: 100,
        };
        SharedAuthenticationThrottleConfig {
            retention_ms: 900_000,
            maximum_key_count: 100_000,
            global: policy,
            source: policy,
            subject: policy,
            source_subject: policy,
            family: policy,
        }
    }

    fn positive_hosted_admission() -> HostedAdmission {
        HostedAdmission {
            version: HOSTED_ADMISSION_VERSION,
            deployment_id: "deployment-1".into(),
            configuration_sha256: "a".repeat(64),
            support_sha256: "b".repeat(64),
            admission_epoch: 7,
            issued_at_ms: 1_000,
            expires_at_ms: 301_000,
            limiter_epoch: 11,
            authentication_throttle_config: positive_throttle_config(),
            invalidation_epoch: 13,
            sender_replay_epoch_floor: 0,
            handler_protocol_version: 1,
            handler_incarnation: "handler-1".into(),
            operator_surface: HostedOperatorSurface::Disabled,
            browser_direct_bearer_seam: BrowserDirectBearerSeam::Excluded,
            hosted_auth: HostedAuthCapabilities {
                external_tls: ExternalTls::Enforced,
                effective_source: EffectiveSource::Trusted,
                authentication_throttle: AuthenticationThrottle::SharedEnforced,
                session_invalidation: SessionInvalidation::GloballyFenced,
                client_credential_posture: BrowserCredentialPosture::SenderConstrainedV2,
            },
        }
    }

    #[test]
    fn hosted_auth_support_is_the_exact_five_fact_conjunction() {
        for mask in 0_u8..32 {
            let capabilities = HostedAuthCapabilities {
                external_tls: if mask & 1 != 0 {
                    ExternalTls::Enforced
                } else {
                    ExternalTls::Unavailable
                },
                effective_source: if mask & 2 != 0 {
                    EffectiveSource::Trusted
                } else {
                    EffectiveSource::Unavailable
                },
                authentication_throttle: if mask & 4 != 0 {
                    AuthenticationThrottle::SharedEnforced
                } else {
                    AuthenticationThrottle::ProcessLocal
                },
                session_invalidation: if mask & 8 != 0 {
                    SessionInvalidation::GloballyFenced
                } else {
                    SessionInvalidation::Unavailable
                },
                client_credential_posture: if mask & 16 != 0 {
                    BrowserCredentialPosture::SenderConstrainedV2
                } else {
                    BrowserCredentialPosture::BearerV1XssExposed
                },
            };
            assert_eq!(capabilities.deployment_capable(), mask & 0b01111 == 0b01111);
            assert_eq!(capabilities.hosted_auth_capable(), mask == 0b11111);
            assert!(validate_auth_deployment(AuthDeploymentTarget::Hosted, capabilities).is_err());
        }
    }

    #[test]
    fn no_auth_target_does_not_claim_local_auth_mechanisms() {
        assert_eq!(
            serde_json::to_value(HostedAuthCapabilities::no_auth_target()).unwrap(),
            serde_json::json!({
                "externalTls": "unavailable",
                "effectiveSource": "unavailable",
                "authenticationThrottle": "unavailable",
                "sessionInvalidation": "unavailable",
                "clientCredentialPosture": "unavailable",
            })
        );
    }

    #[test]
    fn hosted_admission_requires_the_closed_browser_seam_exclusion_fact() {
        let admission = positive_hosted_admission();
        assert!(admission.closed_admission_facts_hold());

        let mut direct_bearer_available = admission.clone();
        direct_bearer_available.browser_direct_bearer_seam = BrowserDirectBearerSeam::Available;
        assert!(!direct_bearer_available.closed_admission_facts_hold());

        let mut operator_enabled = admission.clone();
        operator_enabled.operator_surface = HostedOperatorSurface::Enabled;
        assert!(!operator_enabled.closed_admission_facts_hold());

        let mut handler_incompatible = admission.clone();
        handler_incompatible.handler_protocol_version = 2;
        assert!(!handler_incompatible.closed_admission_facts_hold());

        let mut bearer_v1 = admission.clone();
        bearer_v1.hosted_auth.client_credential_posture =
            BrowserCredentialPosture::BearerV1XssExposed;
        assert!(!bearer_v1.closed_admission_facts_hold());

        let mut too_long = admission.clone();
        too_long.expires_at_ms += 1;
        assert!(!too_long.closed_admission_facts_hold());

        let mut json = serde_json::to_value(&admission).unwrap();
        assert_eq!(json["browserDirectBearerSeam"], "excluded");
        json.as_object_mut()
            .unwrap()
            .remove("browserDirectBearerSeam");
        assert!(serde_json::from_value::<HostedAdmission>(json).is_err());

        let mut json = serde_json::to_value(&admission).unwrap();
        json["operatorOverride"] = serde_json::json!(true);
        assert!(serde_json::from_value::<HostedAdmission>(json).is_err());
    }

    #[test]
    fn authenticated_hosted_origin_is_closed_and_request_headers_cannot_retarget_it() {
        let authority = HostedServingAuthority::from_authenticated_target(
            "https://app.example.test",
            positive_hosted_admission(),
            1_000,
            [7; 32],
        )
        .expect("canonical hosted origin");
        let request_uri: http::Uri = "/query/items?ignored=attacker"
            .parse()
            .expect("request URI");
        assert_eq!(
            authority
                .canonical_external_uri(&request_uri, 1_000)
                .expect("canonical proof URI"),
            "https://app.example.test/query/items",
        );

        for origin in [
            "http://app.example.test",
            "https://APP.example.test",
            "https://app.example.test:443",
            "https://app.example.test/path",
            "https://user@app.example.test",
        ] {
            assert!(
                HostedServingAuthority::from_authenticated_target(
                    origin,
                    positive_hosted_admission(),
                    1_000,
                    [7; 32],
                )
                .is_err(),
                "{origin}",
            );
        }
        for uri in ["/a//b", "/a/../b", "/a/%2e/b", "/a\\b"] {
            let uri: http::Uri = uri.parse().expect("syntactically valid test URI");
            assert!(authority.canonical_external_uri(&uri, 1_000).is_err());
        }
    }

    #[test]
    fn strict_authenticated_envelope_installs_and_refreshes_without_changing_boot_floor() {
        let directory = tempfile::tempdir().unwrap();
        let key_path = directory.path().join("hosted-admission-key.json");
        let envelope_path = directory.path().join("hosted-admission.json");
        let refresh_path = directory.path().join("hosted-admission-refresh.json");
        let key = [29_u8; 32];
        let key_id = "hosted-key-1";
        let key_file = serde_json::json!({
            "schemaVersion": HOSTED_ADMISSION_KEY_VERSION,
            "keyId": key_id,
            "material": URL_SAFE_NO_PAD.encode(key),
        });
        crate::secure_file::write_owner_only(&key_path, &serde_json::to_vec(&key_file).unwrap())
            .unwrap();
        let mut initial_admission = positive_hosted_admission();
        initial_admission.sender_replay_epoch_floor = 17;
        let initial = signed_envelope(initial_admission, key_id, &key);
        assert_eq!(
            initial.mac, "tb12sK-_E81LB_DCFs2h4ZSwDewruaUk9S2LFU1RsRo",
            "Rust and Node must share the exact canonical hosted-admission MAC vector",
        );
        crate::secure_file::write_owner_only(
            &envelope_path,
            &serde_json::to_vec(&initial).unwrap(),
        )
        .unwrap();

        let authority = HostedServingAuthority::from_authenticated_envelope_files(
            &envelope_path,
            &key_path,
            1_000,
        )
        .unwrap();
        assert_eq!(authority.admission_epoch_at(1_000).unwrap(), 7);
        assert_eq!(authority.sender_replay_epoch_floor(), 17);

        let mut refreshed_admission = positive_hosted_admission();
        refreshed_admission.sender_replay_epoch_floor = 17;
        refreshed_admission.admission_epoch = 8;
        refreshed_admission.limiter_epoch = 12;
        refreshed_admission.invalidation_epoch = 14;
        refreshed_admission.issued_at_ms = 2_000;
        refreshed_admission.expires_at_ms = 302_000;
        let refreshed = signed_envelope(refreshed_admission, key_id, &key);
        crate::secure_file::write_owner_only(
            &refresh_path,
            &serde_json::to_vec(&refreshed).unwrap(),
        )
        .unwrap();
        authority
            .refresh_from_authenticated_envelope_file(&refresh_path, 2_000)
            .unwrap();
        assert_eq!(authority.admission_epoch_at(2_000).unwrap(), 8);

        let mut changed_floor_admission = positive_hosted_admission();
        changed_floor_admission.admission_epoch = 9;
        changed_floor_admission.sender_replay_epoch_floor = 18;
        changed_floor_admission.issued_at_ms = 3_000;
        changed_floor_admission.expires_at_ms = 303_000;
        let changed_floor = signed_envelope(changed_floor_admission, key_id, &key);
        let changed_floor_path = directory.path().join("changed-floor.json");
        crate::secure_file::write_owner_only(
            &changed_floor_path,
            &serde_json::to_vec(&changed_floor).unwrap(),
        )
        .unwrap();
        assert!(
            authority
                .refresh_from_authenticated_envelope_file(&changed_floor_path, 3_000)
                .is_err(),
            "a live refresh must not advance the handler-boot floor without database reconciliation",
        );

        let mut changed_policy_admission = positive_hosted_admission();
        changed_policy_admission.sender_replay_epoch_floor = 17;
        changed_policy_admission.admission_epoch = 9;
        changed_policy_admission.limiter_epoch = 13;
        changed_policy_admission.invalidation_epoch = 15;
        changed_policy_admission.issued_at_ms = 3_000;
        changed_policy_admission.expires_at_ms = 303_000;
        changed_policy_admission
            .authentication_throttle_config
            .global
            .burst += 1;
        let changed_policy = signed_envelope(changed_policy_admission, key_id, &key);
        let changed_policy_path = directory.path().join("changed-policy.json");
        crate::secure_file::write_owner_only(
            &changed_policy_path,
            &serde_json::to_vec(&changed_policy).unwrap(),
        )
        .unwrap();
        assert!(
            authority
                .refresh_from_authenticated_envelope_file(&changed_policy_path, 3_000)
                .is_err(),
            "a live refresh must not change policy facts bound to the handler boot",
        );

        let mut tampered = initial;
        tampered.admission.admission_epoch += 1;
        let tampered_path = directory.path().join("tampered.json");
        crate::secure_file::write_owner_only(
            &tampered_path,
            &serde_json::to_vec(&tampered).unwrap(),
        )
        .unwrap();
        assert!(
            HostedServingAuthority::from_authenticated_envelope_files(
                &tampered_path,
                &key_path,
                1_000,
            )
            .is_err(),
        );

        let mut no_floor_admission = positive_hosted_admission();
        no_floor_admission.sender_replay_epoch_floor = 0;
        let no_floor = signed_envelope(no_floor_admission, key_id, &key);
        let no_floor_path = directory.path().join("no-floor.json");
        crate::secure_file::write_owner_only(
            &no_floor_path,
            &serde_json::to_vec(&no_floor).unwrap(),
        )
        .unwrap();
        assert!(
            HostedServingAuthority::from_authenticated_envelope_files(
                &no_floor_path,
                &key_path,
                1_000,
            )
            .is_err(),
            "a hosted boot must never admit the legacy zero replay floor",
        );
    }

    #[test]
    fn hosted_admission_rejects_every_non_js_safe_numeric_fact() {
        let admission = positive_hosted_admission();
        for field in [
            "admissionEpoch",
            "issuedAtMs",
            "expiresAtMs",
            "limiterEpoch",
            "invalidationEpoch",
        ] {
            let mut json = serde_json::to_value(&admission).unwrap();
            json[field] = serde_json::json!(HOSTED_ADMISSION_MAX_SAFE_INTEGER + 1);
            let unsafe_admission: HostedAdmission = serde_json::from_value(json).unwrap();
            assert!(
                !unsafe_admission.closed_admission_facts_hold(),
                "{field} above JavaScript's safe-integer ceiling was admitted"
            );
        }
    }

    #[test]
    fn local_target_refusal_exposes_only_closed_blocker_names() {
        let error = validate_auth_deployment(
            AuthDeploymentTarget::Hosted,
            HostedAuthCapabilities::local_target(),
        )
        .unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            "SNAPBACK_AUTH_DEPLOYMENT_UNSUPPORTED"
        );
        assert_eq!(
            error.diagnostic.details,
            serde_json::json!({
                "requestedDeployment": "hosted",
                "blockers": [
                    "externalTls",
                    "effectiveSource",
                    "authenticationThrottle",
                    "sessionInvalidation",
                    "clientCredentialPosture",
                    "deploymentAttestation",
                    "liveHealth",
                    "handlerCompatibility",
                    "browserDirectBearerSeam",
                    "operatorSurface",
                ],
            }),
        );
        validate_auth_deployment(
            AuthDeploymentTarget::Local,
            HostedAuthCapabilities::local_target(),
        )
        .unwrap();
    }
}
