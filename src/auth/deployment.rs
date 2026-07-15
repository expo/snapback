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

pub fn deployment_unsupported(capabilities: HostedAuthCapabilities) -> SnapbackError {
    let mut blockers = capabilities.blockers();
    blockers.extend([
        "deploymentAttestation",
        "liveHealth",
        "handlerCompatibility",
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
