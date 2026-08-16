//! Closed records for the durable auth-mode transition protocol.
//!
//! Storage owns atomic persistence; this module owns protocol-shaped values and
//! validation that does not require a database connection.

// @ref LLP 0058#exact-mode-state-record — mode authority is one closed,
// generation-stamped record rather than a collection of optional flags.
// @ref LLP 0058#cold-startup-artifact-carrier — one closed carrier contains a
// complete schema/function pair and never credentials.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{AuthMode, FunctionManifest, SchemaManifest, SeedData};
use serde::{Deserialize, Serialize};

pub const AUTH_MODE_FORMAT_VERSION: u32 = 1;
pub const MAX_TRANSITION_GENERATION: u64 = 9_007_199_254_740_991;
pub const STARTUP_ARTIFACT_FORMAT_VERSION: u32 = 1;
pub const STARTUP_ARTIFACT_MAX_BYTES: usize = 32 * 1024 * 1024;
pub const LEGACY_MANIFEST_POISON: &str =
    "\"SNAPBACK_SESSIONS_MANIFEST_RELOCATED: session-aware binary required\"";

pub const SCHEMA_V1_PREFIX: &str = "snapback.v1:sessions:schema:sha256:";
pub const FUNCTION_V1_PREFIX: &str = "snapback.v1:sessions:function:sha256:";
pub const INPUTS_V1_PREFIX: &str = "snapback.v1:sessions:inputs:sha256:";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AuthModeStatus {
    Settled,
    PendingRestart,
    Quarantined,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AppDataAvailability {
    Available,
    RefusedPending,
}

// @ref LLP 0058#exact-response-dto — the served deployment identity preserves
// the same closed mode/version/hash relationship as durable admission.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schemars(extend(
    "oneOf" = [
        {
            "properties": {
                "schemaVersion": { "const": "snapback.v0" },
                "authMode": { "const": "dev" },
                "schemaHash": { "not": { "pattern": "^snapback\\.v1:" } },
                "bundleHash": { "not": { "pattern": "^snapback\\.v1:" } },
                "inputsHash": { "not": { "pattern": "^snapback\\.v1:" } }
            }
        },
        {
            "properties": {
                "schemaVersion": { "const": "snapback.v1" },
                "authMode": { "const": "sessions" },
                "schemaHash": { "pattern": "^snapback\\.v1:sessions:schema:sha256:[0-9a-f]{64}$" },
                "bundleHash": { "pattern": "^snapback\\.v1:sessions:function:sha256:[0-9a-f]{64}$" },
                "inputsHash": { "pattern": "^snapback\\.v1:sessions:inputs:sha256:[0-9a-f]{64}$" }
            }
        }
    ]
))]
pub struct DeploymentIdentity {
    pub schema_version: String,
    pub auth_mode: AuthMode,
    #[schemars(length(min = 1))]
    pub app_id: String,
    #[schemars(length(min = 1))]
    pub schema_hash: String,
    #[schemars(length(min = 1))]
    pub bundle_hash: String,
    #[schemars(length(min = 1))]
    pub inputs_hash: String,
}

impl DeploymentIdentity {
    pub fn from_manifests(
        mode: AuthMode,
        schema: &SchemaManifest,
        functions: &FunctionManifest,
    ) -> SnapbackResult<Self> {
        let schema_hash = required_identity(schema.schema_hash.as_deref(), "schemaHash")?;
        let bundle_hash = required_identity(functions.bundle_hash.as_deref(), "bundleHash")?;
        let schema_inputs = required_identity(schema.inputs_hash.as_deref(), "schema inputsHash")?;
        let function_inputs =
            required_identity(functions.inputs_hash.as_deref(), "function inputsHash")?;

        if schema.schema_version != functions.schema_version
            || schema.schema_version != mode.artifact_version()
            || schema.effective_auth_mode() != mode
        {
            return Err(capability_unsupported(
                "schema/function versions do not form an admissible auth-mode pair",
            ));
        }
        if schema.app_id.is_empty()
            || schema.app_id != functions.app_id
            || schema_inputs != function_inputs
        {
            return Err(capability_unsupported(
                "schema/function deployment identity is not coherent",
            ));
        }

        let identity = Self {
            schema_version: schema.schema_version.clone(),
            auth_mode: mode,
            app_id: schema.app_id.clone(),
            schema_hash: schema_hash.to_owned(),
            bundle_hash: bundle_hash.to_owned(),
            inputs_hash: schema_inputs.to_owned(),
        };
        identity.validate()?;
        Ok(identity)
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        if self.schema_version != self.auth_mode.artifact_version()
            || self.app_id.is_empty()
            || self.schema_hash.is_empty()
            || self.bundle_hash.is_empty()
            || self.inputs_hash.is_empty()
        {
            return Err(mode_corrupt(
                "deployment identity is incomplete or mode-incoherent",
            ));
        }
        if self.auth_mode == AuthMode::Sessions {
            validate_v1_identity(&self.schema_hash, SCHEMA_V1_PREFIX, "schemaHash")?;
            validate_v1_identity(&self.bundle_hash, FUNCTION_V1_PREFIX, "bundleHash")?;
            validate_v1_identity(&self.inputs_hash, INPUTS_V1_PREFIX, "inputsHash")?;
        } else if self.schema_hash.starts_with("snapback.v1:")
            || self.bundle_hash.starts_with("snapback.v1:")
            || self.inputs_hash.starts_with("snapback.v1:")
        {
            return Err(mode_corrupt(
                "a v0-dev identity uses the reserved v1 namespace",
            ));
        }
        Ok(())
    }

    pub fn validate_schema_half(&self, schema: &SchemaManifest) -> SnapbackResult<()> {
        if self.schema_version != schema.schema_version
            || self.auth_mode != schema.effective_auth_mode()
            || self.app_id != schema.app_id
            || schema.schema_hash.as_deref() != Some(self.schema_hash.as_str())
            || schema.inputs_hash.as_deref() != Some(self.inputs_hash.as_str())
        {
            return Err(mode_corrupt(
                "schema manifest does not match its deployment identity",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthModeQuarantine {
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub transition_generation: u64,
    pub code: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthModeStateRecord {
    pub format_version: u32,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub transition_generation: u64,
    pub active: AuthMode,
    pub desired: AuthMode,
    pub mode_state: AuthModeStatus,
    pub app_data_availability: AppDataAvailability,
    pub sessions_ever_activated: bool,
    pub active_deployment: Option<DeploymentIdentity>,
    pub requested_deployment: Option<DeploymentIdentity>,
    pub quarantine: Option<AuthModeQuarantine>,
}

impl AuthModeStateRecord {
    pub fn initial_dev(active_deployment: Option<DeploymentIdentity>) -> Self {
        Self {
            format_version: AUTH_MODE_FORMAT_VERSION,
            transition_generation: 0,
            active: AuthMode::Dev,
            desired: AuthMode::Dev,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: false,
            active_deployment,
            requested_deployment: None,
            quarantine: None,
        }
    }

    pub fn next_generation(&self) -> SnapbackResult<u64> {
        if self.transition_generation >= MAX_TRANSITION_GENERATION {
            return Err(mode_corrupt(
                "auth-mode transition generation exhausted the portable range",
            ));
        }
        Ok(self.transition_generation + 1)
    }

    pub fn validate_shape(&self) -> SnapbackResult<()> {
        if self.format_version != AUTH_MODE_FORMAT_VERSION {
            return Err(mode_corrupt("auth-mode record has an unsupported format"));
        }
        if self.transition_generation > MAX_TRANSITION_GENERATION {
            return Err(mode_corrupt(
                "auth-mode transition generation is outside the portable range",
            ));
        }
        if let Some(active) = &self.active_deployment {
            active.validate()?;
            if active.auth_mode != self.active {
                return Err(mode_corrupt(
                    "active deployment mode differs from active mode",
                ));
            }
        }
        if self.active == AuthMode::Sessions
            && (!self.sessions_ever_activated || self.active_deployment.is_none())
        {
            return Err(mode_corrupt(
                "active sessions mode lacks its monotonic activation evidence",
            ));
        }
        if self.sessions_ever_activated && self.active_deployment.is_none() {
            return Err(mode_corrupt(
                "sessions activation evidence lacks an active deployment identity",
            ));
        }

        match self.mode_state {
            AuthModeStatus::Settled => {
                if self.active != self.desired
                    || self.app_data_availability != AppDataAvailability::Available
                    || self.requested_deployment.is_some()
                    || self.quarantine.is_some()
                {
                    return Err(mode_corrupt(
                        "settled auth-mode invariants are not satisfied",
                    ));
                }
            }
            AuthModeStatus::PendingRestart => {
                if self.active == self.desired
                    || self.app_data_availability != AppDataAvailability::RefusedPending
                    || self.quarantine.is_some()
                {
                    return Err(mode_corrupt(
                        "pending auth-mode invariants are not satisfied",
                    ));
                }
                self.validate_requested()?;
            }
            AuthModeStatus::Quarantined => {
                if self.active == self.desired
                    || self.app_data_availability != AppDataAvailability::RefusedPending
                {
                    return Err(mode_corrupt(
                        "quarantined auth-mode invariants are not satisfied",
                    ));
                }
                self.validate_requested()?;
                let Some(quarantine) = &self.quarantine else {
                    return Err(mode_corrupt(
                        "quarantined auth mode lacks a quarantine record",
                    ));
                };
                if quarantine.transition_generation != self.transition_generation
                    || !valid_diagnostic_code(&quarantine.code)
                {
                    return Err(mode_corrupt("auth-mode quarantine record is invalid"));
                }
            }
        }
        Ok(())
    }

    fn validate_requested(&self) -> SnapbackResult<()> {
        let Some(requested) = &self.requested_deployment else {
            return Err(mode_corrupt(
                "pending auth mode lacks a requested deployment",
            ));
        };
        requested.validate()?;
        if requested.auth_mode != self.desired {
            return Err(mode_corrupt(
                "requested deployment mode differs from desired auth mode",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StagedAuthModeRecord {
    pub format_version: u32,
    pub transition_generation: u64,
    pub requested_deployment: DeploymentIdentity,
    pub schema_manifest: SchemaManifest,
}

impl StagedAuthModeRecord {
    pub fn validate_against(&self, state: &AuthModeStateRecord) -> SnapbackResult<()> {
        if self.format_version != AUTH_MODE_FORMAT_VERSION
            || self.transition_generation != state.transition_generation
            || state.requested_deployment.as_ref() != Some(&self.requested_deployment)
        {
            return Err(mode_corrupt(
                "staged auth-mode record is not generation-coherent",
            ));
        }
        self.requested_deployment.validate()?;
        self.requested_deployment
            .validate_schema_half(&self.schema_manifest)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartupArtifacts {
    pub format_version: u32,
    pub schema: SchemaManifest,
    pub functions: FunctionManifest,
    #[serde(default)]
    pub seed: Option<SeedData>,
}

impl StartupArtifacts {
    pub fn parse(bytes: &[u8]) -> SnapbackResult<Self> {
        if bytes.len() > STARTUP_ARTIFACT_MAX_BYTES {
            return Err(startup_mismatch("startup artifact carrier exceeds 32 MiB"));
        }
        let carrier: Self = serde_json::from_slice(bytes).map_err(|_| {
            startup_mismatch("startup artifact carrier is not a closed JSON object")
        })?;
        if carrier.format_version != STARTUP_ARTIFACT_FORMAT_VERSION {
            return Err(startup_mismatch(
                "startup artifact carrier has an unsupported format",
            ));
        }
        Ok(carrier)
    }

    pub fn deployment_identity(&self, mode: AuthMode) -> SnapbackResult<DeploymentIdentity> {
        DeploymentIdentity::from_manifests(mode, &self.schema, &self.functions)
            .map_err(|_| startup_mismatch("startup artifact pair is not coherent"))
    }

    pub fn require_deployment(&self, expected: &DeploymentIdentity) -> SnapbackResult<()> {
        let observed = self.deployment_identity(expected.auth_mode)?;
        if &observed != expected {
            return Err(startup_mismatch(
                "startup artifact pair differs from the pinned deployment",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordProviderReadiness {
    pub ready: bool,
    /// Password sign-in can be ready while production sign-up remains
    /// deliberately unavailable until blind-accept delivery exists.
    pub production_signup_ready: bool,
    pub production_signup_refusal_code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refusal_code: Option<String>,
}

pub const PASSWORD_PROVIDER_REQUIRES_V4_CODE: &str = "SNAPBACK_AUTH_PASSWORD_REQUIRES_V4";
pub const PASSWORD_PRODUCTION_SIGNUP_UNAVAILABLE_CODE: &str =
    "SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE";

impl PasswordProviderReadiness {
    pub fn ready(identifier_mode: &str) -> Self {
        Self {
            ready: true,
            production_signup_ready: false,
            production_signup_refusal_code: PASSWORD_PRODUCTION_SIGNUP_UNAVAILABLE_CODE.to_owned(),
            catalog_version: Some(4),
            identifier_mode: Some(identifier_mode.to_owned()),
            refusal_code: None,
        }
    }

    pub fn requires_v4(catalog_version: Option<u32>) -> Self {
        Self {
            ready: false,
            production_signup_ready: false,
            production_signup_refusal_code: PASSWORD_PRODUCTION_SIGNUP_UNAVAILABLE_CODE.to_owned(),
            catalog_version,
            identifier_mode: None,
            refusal_code: Some(PASSWORD_PROVIDER_REQUIRES_V4_CODE.to_owned()),
        }
    }

    fn validate(&self) -> SnapbackResult<()> {
        let production_signup_coherent = !self.production_signup_ready
            && self.production_signup_refusal_code == PASSWORD_PRODUCTION_SIGNUP_UNAVAILABLE_CODE;
        let coherent = production_signup_coherent
            && if self.ready {
                self.catalog_version == Some(4)
                    && matches!(
                        self.identifier_mode.as_deref(),
                        Some("username-v1" | "email-v1")
                    )
                    && self.refusal_code.is_none()
            } else {
                self.catalog_version.is_none_or(|version| version < 4)
                    && self.identifier_mode.is_none()
                    && self.refusal_code.as_deref() == Some(PASSWORD_PROVIDER_REQUIRES_V4_CODE)
            };
        if coherent {
            Ok(())
        } else {
            Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "password-provider readiness is internally inconsistent",
            ))
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AuthProgramReadiness {
    pub route_registry_enforced: bool,
    pub existing_surface_closure: bool,
    pub admin_secret_read_enforced: bool,
    pub secret_read_process_prerequisites: bool,
    pub provider_core: bool,
    pub shared_invocation_gate: bool,
    pub staged_mode: bool,
    pub connection_binding: bool,
    pub two_phase_revocation: bool,
    pub auth_coordinator: bool,
    pub authorization_invalidation: bool,
    pub authority_descriptor: bool,
    pub authorized_lease: bool,
    pub password_provider: PasswordProviderReadiness,
    pub session_activation_ready: bool,
}

impl AuthProgramReadiness {
    /// Item 4's positive build facts. Sessions deliberately remain impossible
    /// because the three item-5 facts are false.
    pub(crate) fn item4(secret_read_process_prerequisites: bool) -> Self {
        Self::new(
            secret_read_process_prerequisites,
            false,
            false,
            false,
            false,
            false,
            false,
        )
    }

    /// Compose later-item build facts without allowing a caller to assert the
    /// derived activation bit independently.
    pub(crate) fn new(
        secret_read_process_prerequisites: bool,
        connection_binding: bool,
        two_phase_revocation: bool,
        auth_coordinator: bool,
        authorization_invalidation: bool,
        authority_descriptor: bool,
        authorized_lease: bool,
    ) -> Self {
        let session_activation_ready = secret_read_process_prerequisites
            && connection_binding
            && two_phase_revocation
            && auth_coordinator;
        Self {
            route_registry_enforced: true,
            existing_surface_closure: true,
            admin_secret_read_enforced: true,
            secret_read_process_prerequisites,
            provider_core: true,
            shared_invocation_gate: true,
            staged_mode: true,
            connection_binding,
            two_phase_revocation,
            auth_coordinator,
            authorization_invalidation,
            authority_descriptor,
            authorized_lease,
            password_provider: PasswordProviderReadiness::requires_v4(None),
            session_activation_ready,
        }
    }

    pub(crate) fn with_password_provider(
        mut self,
        password_provider: PasswordProviderReadiness,
    ) -> Self {
        self.password_provider = password_provider;
        self
    }

    pub fn derive_session_activation_ready(&self) -> bool {
        self.route_registry_enforced
            && self.existing_surface_closure
            && self.admin_secret_read_enforced
            && self.secret_read_process_prerequisites
            && self.provider_core
            && self.shared_invocation_gate
            && self.staged_mode
            && self.connection_binding
            && self.two_phase_revocation
            && self.auth_coordinator
    }

    pub fn validate(&self) -> SnapbackResult<()> {
        self.password_provider.validate()?;
        if self.session_activation_ready != self.derive_session_activation_ready() {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "session activation readiness is not derived from the required facts",
            ));
        }
        if self.authorized_lease
            && (!self.session_activation_ready
                || !self.authorization_invalidation
                || !self.authority_descriptor)
        {
            return Err(SnapbackError::error(
                "SNAPBACK_AUTH_POLICY_UNAVAILABLE",
                "auth",
                "authorized-lease readiness requires items 5, 6, and 7",
            ));
        }
        Ok(())
    }
}

pub(crate) fn mode_corrupt(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_MODE_STATE_CORRUPT", "auth", message)
}

fn startup_mismatch(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH", "auth", message)
}

fn capability_unsupported(message: &'static str) -> SnapbackError {
    SnapbackError::error("SNAPBACK_CAPABILITY_UNSUPPORTED", "auth", message)
}

fn required_identity<'a>(value: Option<&'a str>, label: &str) -> SnapbackResult<&'a str> {
    value.filter(|value| !value.is_empty()).ok_or_else(|| {
        SnapbackError::error(
            "SNAPBACK_CAPABILITY_UNSUPPORTED",
            "auth",
            format!("{label} must be non-empty"),
        )
    })
}

fn validate_v1_identity(value: &str, prefix: &str, label: &str) -> SnapbackResult<()> {
    let Some(digest) = value.strip_prefix(prefix) else {
        return Err(mode_corrupt(
            "v1 deployment identity has an invalid namespace",
        ));
    };
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(SnapbackError::error(
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT",
            "auth",
            format!("{label} has an invalid v1 SHA-256 spelling"),
        ));
    }
    Ok(())
}

fn valid_diagnostic_code(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix("SNAPBACK_") else {
        return false;
    };
    !suffix.is_empty()
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::AuthMode;

    fn hash(prefix: &str, digit: char) -> String {
        format!("{prefix}{}", digit.to_string().repeat(64))
    }

    fn sessions_identity() -> DeploymentIdentity {
        DeploymentIdentity {
            schema_version: "snapback.v1".to_owned(),
            auth_mode: AuthMode::Sessions,
            app_id: "app".to_owned(),
            schema_hash: hash(SCHEMA_V1_PREFIX, 'a'),
            bundle_hash: hash(FUNCTION_V1_PREFIX, 'b'),
            inputs_hash: hash(INPUTS_V1_PREFIX, 'c'),
        }
    }

    #[test]
    fn exact_v1_namespaces_are_required() {
        sessions_identity().validate().unwrap();
        let mut invalid = sessions_identity();
        invalid.bundle_hash = invalid.bundle_hash.replace(":function:", ":functions:");
        assert_eq!(
            invalid.validate().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
    }

    #[test]
    fn readiness_is_derived_not_asserted() {
        let mut readiness = AuthProgramReadiness {
            route_registry_enforced: true,
            existing_surface_closure: true,
            admin_secret_read_enforced: true,
            secret_read_process_prerequisites: true,
            provider_core: true,
            shared_invocation_gate: true,
            staged_mode: true,
            connection_binding: true,
            two_phase_revocation: true,
            auth_coordinator: true,
            authorization_invalidation: false,
            authority_descriptor: false,
            authorized_lease: false,
            password_provider: PasswordProviderReadiness::requires_v4(None),
            session_activation_ready: true,
        };
        readiness.validate().unwrap();
        readiness.connection_binding = false;
        assert_eq!(
            readiness.validate().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
        );
    }

    #[test]
    fn password_provider_readiness_is_closed_and_serializes_the_v3_refusal() {
        let predecessor = PasswordProviderReadiness::requires_v4(Some(3));
        predecessor.validate().unwrap();
        let json = serde_json::to_value(&predecessor).unwrap();
        assert_eq!(json["ready"], false);
        assert_eq!(json["catalogVersion"], 3);
        assert_eq!(json["refusalCode"], PASSWORD_PROVIDER_REQUIRES_V4_CODE);
        assert!(json.get("identifierMode").is_none());

        PasswordProviderReadiness::ready("email-v1")
            .validate()
            .unwrap();
        assert!(
            PasswordProviderReadiness::ready("future-v2")
                .validate()
                .is_err()
        );
    }

    #[test]
    fn transition_generation_is_portable_and_exhaustion_fails_closed() {
        let mut state = AuthModeStateRecord::initial_dev(None);
        state.transition_generation = MAX_TRANSITION_GENERATION;
        assert_eq!(
            state.next_generation().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
        state.transition_generation = MAX_TRANSITION_GENERATION + 1;
        assert_eq!(
            state.validate_shape().unwrap_err().diagnostic.code,
            "SNAPBACK_AUTH_MODE_STATE_CORRUPT"
        );
    }
}
