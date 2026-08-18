use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
pub enum HostedAdmissionV2Version {
    #[serde(rename = "snapback.hosted-admission.v2")]
    V2,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAdmissionV2 {
    pub schema_version: HostedAdmissionV2Version,
    pub target_id: String,
    pub deployment_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub binding_generation: u64,
    pub target_binding_sha256: String,
    pub control_head_sha256: String,
    pub supervisor_incarnation: String,
    pub exact_roster_sha256: String,
    pub routed_machine_id: String,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub hosted_auth_expires_at_ms: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub routed_machine_expires_at_ms: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub replay_floor: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub admission_generation: u64,
    #[schemars(range(max = crate::manifest::PORTABLE_STORAGE_VERSION_MAX))]
    pub issued_at_ms: u64,
    pub signature: String,
}

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
