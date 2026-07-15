//! Target-owned hosted authentication deployment facts.
//!
//! Candidate app artifacts and operator flags may request hosted posture, but
//! they cannot assert any fact in this module. Concrete target constructors
//! publish the closed descriptor and admission derives from its conjunction.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use clap::ValueEnum;
use serde::{Deserialize, Serialize};

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
    #[schemars(range(min = 1_i64, max = 9007199254740991_i64))]
    pub invalidation_epoch: u64,
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
            && self.invalidation_epoch > 0
            && self.invalidation_epoch <= HOSTED_ADMISSION_MAX_SAFE_INTEGER
            && self.handler_protocol_version == 1
            && !self.handler_incarnation.is_empty()
            && self.operator_surface == HostedOperatorSurface::Disabled
            && self.browser_direct_bearer_seam == BrowserDirectBearerSeam::Excluded
            && self.hosted_auth.hosted_auth_capable()
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
            invalidation_epoch: 13,
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
