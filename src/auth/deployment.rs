//! Target-owned hosted authentication deployment facts.
//!
//! Candidate app artifacts and operator flags may request hosted posture, but
//! they cannot assert any fact in this module. Concrete target constructors
//! publish the closed descriptor and admission derives from its conjunction.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use axum::http;
use clap::ValueEnum;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::Arc;

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

    /// Replace the incumbent with an independently verified successor.
    pub(crate) fn install(&self, authority: HostedServingAuthority) -> bool {
        match self.current.write() {
            Ok(mut guard) => {
                *guard = Arc::new(authority);
                true
            }
            Err(_) => false,
        }
    }
}

#[derive(Clone)]
pub(crate) struct HostedServingAuthority {
    admission: HostedAdmission,
    public_origin: String,
    authentication_throttle_key: Arc<AuthenticationThrottleKey>,
}

impl fmt::Debug for HostedServingAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HostedServingAuthority")
            .field("admission_epoch", &self.admission.admission_epoch)
            .field("expires_at_ms", &self.admission.expires_at_ms)
            .field("public_origin", &"[REDACTED]")
            .finish()
    }
}

impl HostedServingAuthority {
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
        let parsed = public_origin.parse::<http::Uri>().map_err(|_| {
            SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "auth-deployment",
                "hosted serving authority has an invalid canonical public origin",
            )
        })?;
        let authority = parsed.authority().ok_or_else(|| {
            SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "auth-deployment",
                "hosted serving authority has no canonical public authority",
            )
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
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_INVALID",
                "auth-deployment",
                "hosted serving authority is incomplete, expired, or non-canonical",
            ));
        }
        Ok(Self {
            admission,
            public_origin,
            authentication_throttle_key: Arc::new(AuthenticationThrottleKey::from_bytes(
                authentication_throttle_key,
            )),
        })
    }

    /// The capability tuple this verified admission attests.
    pub(crate) fn capabilities(&self) -> HostedAuthCapabilities {
        self.admission.hosted_auth
    }

    pub(crate) fn admission_epoch_at(&self, now_ms: u64) -> SnapbackResult<u64> {
        if now_ms < self.admission.issued_at_ms || now_ms > self.admission.expires_at_ms {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_HOSTED_ADMISSION_EXPIRED",
                "auth-deployment",
                "hosted serving admission is not current",
            ));
        }
        Ok(self.admission.admission_epoch)
    }

    pub(crate) fn authentication_throttle_at(
        &self,
        now_ms: u64,
    ) -> SnapbackResult<HostedAuthenticationThrottle> {
        self.admission_epoch_at(now_ms)?;
        Ok(HostedAuthenticationThrottle {
            limiter_epoch: self.admission.limiter_epoch,
            deployment_id: self.admission.deployment_id.clone(),
            config: self.admission.authentication_throttle_config.clone(),
            key: self.authentication_throttle_key.clone(),
        })
    }

    /// The control-plane monotone floor for the durable sender replay
    /// namespace, applied at authority install (decision 1's anti-rollback
    /// composition).
    pub(crate) fn sender_replay_epoch_floor(&self) -> u64 {
        self.admission.sender_replay_epoch_floor
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
