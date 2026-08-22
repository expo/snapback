//! Server-owned application operational-readiness contracts and evaluation.
//!
//! One core fact is evaluated by Rust and projected through authenticated
//! host-operations; the application-ready file is a thin receipt over that
//! fact and carries no bearer or sidecar authority.
//!
//! @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — one
//!   server-owned fact feeds thin authenticated/file projections, while the
//!   receipt carries no independent authority.

use crate::auth::mode::{
    AppDataAvailability, AuthModeStateRecord, AuthModeStatus, AuthProgramReadiness,
    DeploymentIdentity,
};
use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::host_ops_contract::HostOpsArtifacts;
use crate::manifest::{AuthMode, CapabilityManifest};
use crate::seed_identity::ActiveSeedIdentityV1;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const EXPECTED_ACTIVATION_TARGET_FORMAT_V1: &str = "snapback.expected-activation-target.v1";
pub const OPERATIONAL_READINESS_FORMAT_V1: &str = "snapback.operational-readiness.v1";
pub const APPLICATION_READY_FORMAT_V1: &str = "snapback.application-ready.v1";

pub const READINESS_DECLARATION_INVALID_CODE: &str = "SNAPBACK_APP_READINESS_DECLARATION_INVALID";
pub const READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE: &str =
    "SNAPBACK_APP_READINESS_OBLIGATIONS_DIGEST_MISMATCH";
pub const READINESS_MIGRATION_UNRESOLVED_CODE: &str = "SNAPBACK_APP_READINESS_MIGRATION_UNRESOLVED";
pub const READINESS_SEED_NOT_IDEMPOTENT_CODE: &str = "SNAPBACK_APP_READINESS_SEED_NOT_IDEMPOTENT";
pub const READINESS_FACTS_UNAVAILABLE_CODE: &str = "SNAPBACK_APP_READINESS_FACTS_UNAVAILABLE";

/// Derive the application-ready receipt's default path by appending one
/// literal suffix to the host ready-file path. The JS supervisor uses the
/// same deliberately trivial cross-language rule.
// @ref LLP 0224#layered-readiness-not-one-overloaded-boolean — the default
//   application receipt is the deterministic `<ready-file>.application-ready`
//   sibling unless the operator supplies an explicit override.
pub fn application_ready_sibling(ready_file: &Path) -> PathBuf {
    let mut sibling = ready_file.as_os_str().to_os_string();
    sibling.push(".application-ready");
    PathBuf::from(sibling)
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExpectedActivationTargetV1 {
    pub format_version: String,
    pub deployment: DeploymentIdentity,
    pub target_profile: String,
    pub declared_obligations: Vec<DeclaredObligationV1>,
    pub obligations_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_migration: Option<PendingMigrationDeclarationV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DeclaredObligationV1 {
    Schema {
        schema_hash: String,
    },
    Functions {
        bundle_hash: String,
    },
    Routes {
        route_manifest_hash: String,
    },
    ApiEnvelope {
        envelope_hash: String,
    },
    Seed {
        seed_version: String,
        seed_digest: String,
        idempotent: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PendingMigrationDeclarationV1 {
    pub identifier: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationalReadinessHostInputV1 {
    pub expected_target: ExpectedActivationTargetV1,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationalReadinessV1 {
    pub format_version: String,
    pub ready: bool,
    pub startup_nonce: String,
    pub evaluated_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<OperationalReadinessTargetV1>,
    pub unsatisfied: Vec<UnsatisfiedConditionV1>,
    pub auth: OperationalReadinessAuthV1,
    pub capability_manifest_digest: String,
    pub artifacts: HostOpsArtifacts,
    pub network_profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationalReadinessTargetV1 {
    pub deployment: DeploymentIdentity,
    pub obligations_digest: String,
    pub target_profile: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnsatisfiedConditionV1 {
    pub condition: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationalReadinessAuthV1 {
    pub active: AuthMode,
    pub desired: AuthMode,
    pub mode_state: AuthModeStatus,
    pub app_data_availability: AppDataAvailability,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_activation_ready: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationReadyReceiptV1 {
    pub format_version: String,
    pub startup_nonce: String,
    pub host_ready_descriptor_digest: String,
    pub application: ApplicationIdentityV1,
    pub target_profile: String,
    pub artifacts: HostOpsArtifacts,
    pub auth: ApplicationReadyAuthV1,
    pub binding: AppBindingV1,
    pub client_origins: Vec<String>,
    pub runtime_identity: ApplicationReadyRuntimeIdentityV1,
    pub capability_manifest_digest: String,
    pub network_profile: String,
    pub settled_at_ms: u64,
}

/// Bearer-free client admission issued by the lifecycle owner. The
/// application-ready receipt embeds the closed binding rather than pointing
/// at a launcher-private environment or log line.
// @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — attach admission is one receipt-bound identity cut: server, app, authority, client binding, and qualified launcher.
#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBindingV1 {
    pub format: String,
    pub source: String,
    pub descriptor_identity: String,
    pub target: AppBindingTargetV1,
    pub capabilities: AppBindingCapabilitiesV1,
    pub provenance: AppBindingProvenanceV1,
    pub integrity: AppBindingIntegrityV1,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBindingTargetV1 {
    pub app: String,
    pub schema: String,
    pub functions: String,
    pub origin: String,
    pub routing: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBindingCapabilitiesV1 {
    pub offered: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBindingProvenanceV1 {
    pub supervisor_generation: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppBindingIntegrityV1 {
    pub channel: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationReadyRuntimeIdentityV1 {
    pub qualified_binary: QualifiedBinaryIdentityV1,
    pub wrapper: CliWrapperIdentityV1,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualifiedBinaryIdentityV1 {
    pub path: String,
    pub source: String,
    pub platform: String,
    pub bytes: u64,
    pub sha256: String,
    pub build_identity: RuntimeBuildIdentityV1,
    pub qualification: RuntimeQualificationIdentityV1,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeBuildIdentityV1 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_commit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub git_dirty: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crate_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_profile: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeQualificationIdentityV1 {
    pub receipt_schema_version: String,
    pub receipt_path: String,
    pub probe: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CliWrapperIdentityV1 {
    pub package: String,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ApplicationIdentityV1 {
    #[serde(rename = "dev-generated")]
    DevGenerated {
        deployment: DeploymentIdentity,
        obligations_digest: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, JsonSchema, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApplicationReadyAuthV1 {
    pub active_mode: AuthMode,
    pub mode_state: AuthModeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_activation_ready: Option<bool>,
}

/// Owned inputs to the pure operational-readiness evaluator. Server adapters
/// capture these facts under their existing AppState/LocalSnapback cuts.
#[derive(Clone, Debug)]
pub struct OperationalReadinessFactsV1 {
    pub startup_nonce: String,
    pub evaluated_at_ms: u64,
    pub auth_mode_state: AuthModeStateRecord,
    pub effective_active_deployment: Option<DeploymentIdentity>,
    pub auth_program_readiness: AuthProgramReadiness,
    pub capability_manifest_digest: String,
    pub artifacts: HostOpsArtifacts,
    pub network_profile: String,
    pub app_id: Option<String>,
    pub route_manifest_hash: Option<String>,
    pub api_envelope_hash: Option<String>,
    pub active_seed_identity: Option<ActiveSeedIdentityV1>,
}

#[derive(Clone, Debug)]
pub struct OperationalReadinessRuntimeFactsV1 {
    pub startup_nonce: String,
    pub evaluated_at_ms: u64,
    pub auth_mode_state: AuthModeStateRecord,
    pub auth_program_readiness: AuthProgramReadiness,
    pub network_profile: String,
}

pub fn derive_effective_active_deployment(
    state: &AuthModeStateRecord,
    loaded_schema_manifest: &crate::manifest::SchemaManifest,
    loaded_function_manifest: &crate::manifest::FunctionManifest,
) -> Option<DeploymentIdentity> {
    state.active_deployment.clone().or_else(|| {
        if state.active == AuthMode::Dev {
            DeploymentIdentity::from_manifests(
                AuthMode::Dev,
                loaded_schema_manifest,
                loaded_function_manifest,
            )
            .ok()
        } else {
            None
        }
    })
}

pub fn declared_obligations_digest(obligations: &[DeclaredObligationV1]) -> SnapbackResult<String> {
    let value = serde_json::to_value(obligations)
        .map_err(|_| readiness_facts_unavailable("declared obligations could not be serialized"))?;
    crate::rqs_contract::sha256_identity(&value).map_err(|_| {
        readiness_facts_unavailable("declared obligations could not be canonically hashed")
    })
}

pub fn capability_manifest_digest(manifest: &CapabilityManifest) -> SnapbackResult<String> {
    let value = serde_json::to_value(manifest)
        .map_err(|_| readiness_facts_unavailable("capability manifest could not be serialized"))?;
    crate::rqs_contract::sha256_identity(&value).map_err(|_| {
        readiness_facts_unavailable("capability manifest could not be canonically hashed")
    })
}

/// Validate a declaration completely before it can replace process-local
/// target authority. The caller stores only `Ok` declarations.
pub fn validate_expected_activation_target(
    target: &ExpectedActivationTargetV1,
) -> SnapbackResult<()> {
    if target.format_version != EXPECTED_ACTIVATION_TARGET_FORMAT_V1 {
        return Err(readiness_declaration_invalid(
            "expected activation target formatVersion is unsupported",
        ));
    }
    target.deployment.validate().map_err(|_| {
        readiness_declaration_invalid("expected activation deployment identity is invalid")
    })?;
    if target.target_profile.trim().is_empty() {
        return Err(readiness_declaration_invalid(
            "expected activation targetProfile must be non-empty",
        ));
    }
    for obligation in &target.declared_obligations {
        validate_obligation_identity(obligation)?;
    }
    let observed_digest = declared_obligations_digest(&target.declared_obligations)?;
    if target.obligations_digest != observed_digest {
        return Err(SnapbackError::error(
            READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE,
            "app-readiness",
            "obligationsDigest does not match the canonical declaredObligations array",
        ));
    }
    if target.pending_migration.is_some() {
        // @ref LLP 0224#prepared-release-capability-story — OQ2 variant (a):
        //   an unresolved migration is refused before target authority moves.
        return Err(SnapbackError::error(
            READINESS_MIGRATION_UNRESOLVED_CODE,
            "app-readiness",
            "the expected activation target declares an unresolved migration",
        ));
    }
    if target.declared_obligations.iter().any(|obligation| {
        matches!(
            obligation,
            DeclaredObligationV1::Seed {
                idempotent: false,
                ..
            }
        )
    }) {
        // @ref LLP 0224#prepared-release-capability-story — OQ2 variant (a):
        //   only an explicitly idempotent seed may become a readiness gate.
        return Err(SnapbackError::error(
            READINESS_SEED_NOT_IDEMPOTENT_CODE,
            "app-readiness",
            "the expected activation target declares a non-idempotent seed obligation",
        ));
    }
    Ok(())
}

fn validate_obligation_identity(obligation: &DeclaredObligationV1) -> SnapbackResult<()> {
    let present = match obligation {
        DeclaredObligationV1::Schema { schema_hash } => !schema_hash.trim().is_empty(),
        DeclaredObligationV1::Functions { bundle_hash } => !bundle_hash.trim().is_empty(),
        DeclaredObligationV1::Routes {
            route_manifest_hash,
        } => !route_manifest_hash.trim().is_empty(),
        DeclaredObligationV1::ApiEnvelope { envelope_hash } => !envelope_hash.trim().is_empty(),
        DeclaredObligationV1::Seed {
            seed_version,
            seed_digest,
            ..
        } => !seed_version.trim().is_empty() && !seed_digest.trim().is_empty(),
    };
    if present {
        Ok(())
    } else {
        Err(readiness_declaration_invalid(
            "declared obligation identities must be non-empty",
        ))
    }
}

/// Evaluate every conjunct independently so a false result lists the complete
/// operator-actionable set rather than stopping at the first mismatch.
pub fn evaluate_operational_readiness(
    facts: &OperationalReadinessFactsV1,
    expected: Option<&ExpectedActivationTargetV1>,
) -> OperationalReadinessV1 {
    let state = &facts.auth_mode_state;
    let mut unsatisfied = Vec::new();
    let mut push = |condition: &str, detail: &str| {
        unsatisfied.push(UnsatisfiedConditionV1 {
            condition: condition.to_owned(),
            detail: detail.to_owned(),
        });
    };

    let target = match expected {
        None => {
            push(
                "expected-target-undeclared",
                "no expected activation target has been declared for this process",
            );
            None
        }
        Some(expected) => {
            if facts.effective_active_deployment.as_ref() != Some(&expected.deployment) {
                push(
                    "active-deployment-mismatch",
                    "the active deployment identity does not match the declared target",
                );
            }
            for obligation in &expected.declared_obligations {
                match obligation {
                    DeclaredObligationV1::Schema { schema_hash }
                        if facts.artifacts.schema_hash.as_ref() != Some(schema_hash) =>
                    {
                        push(
                            "schema-obligation-unsatisfied",
                            "the loaded schema identity does not match the declared obligation",
                        );
                    }
                    DeclaredObligationV1::Functions { bundle_hash }
                        if facts.artifacts.bundle_hash.as_ref() != Some(bundle_hash) =>
                    {
                        push(
                            "functions-obligation-unsatisfied",
                            "the loaded function bundle identity does not match the declared obligation",
                        );
                    }
                    DeclaredObligationV1::Routes {
                        route_manifest_hash,
                    } if facts.route_manifest_hash.as_ref() != Some(route_manifest_hash) => {
                        push(
                            "routes-obligation-unsatisfied",
                            "the active route manifest identity does not match the declared obligation",
                        );
                    }
                    DeclaredObligationV1::ApiEnvelope { envelope_hash }
                        if facts.api_envelope_hash.as_ref() != Some(envelope_hash) =>
                    {
                        push(
                            "api-envelope-obligation-unsatisfied",
                            "the active API envelope identity does not match the declared obligation",
                        );
                    }
                    DeclaredObligationV1::Seed {
                        seed_version,
                        seed_digest,
                        ..
                    } => match facts.active_seed_identity.as_ref() {
                        None => push(
                            "seed-obligation-uninstalled",
                            "the declared versioned seed is not installed for the active data stream",
                        ),
                        Some(active)
                            if active.seed_version != *seed_version
                                || active.seed_digest != *seed_digest =>
                        {
                            push(
                                "seed-obligation-mismatched",
                                "the installed versioned seed identity does not match the declared obligation",
                            );
                        }
                        Some(_) => {}
                    },
                    _ => {}
                }
            }
            Some(OperationalReadinessTargetV1 {
                deployment: expected.deployment.clone(),
                obligations_digest: expected.obligations_digest.clone(),
                target_profile: expected.target_profile.clone(),
            })
        }
    };

    if state.active != state.desired {
        push(
            "auth-active-desired-mismatch",
            "the active and desired auth modes have not converged",
        );
    }
    if state.mode_state != AuthModeStatus::Settled {
        push("auth-mode-unsettled", "the auth mode state is not settled");
    }
    if state.app_data_availability != AppDataAvailability::Available {
        push(
            "app-data-unavailable",
            "application data admission is not available",
        );
    }
    if state.requested_deployment.is_some() {
        push(
            "auth-requested-deployment-present",
            "a requested deployment transition remains pending",
        );
    }
    if state.quarantine.is_some() {
        push(
            "auth-quarantine-present",
            "the auth mode transition has a quarantine record",
        );
    }
    let session_activation_ready = (state.active == AuthMode::Sessions)
        .then_some(facts.auth_program_readiness.session_activation_ready);
    if session_activation_ready == Some(false) {
        push(
            "sessions-activation-not-ready",
            "sessions mode has not reached session activation readiness",
        );
    }

    OperationalReadinessV1 {
        format_version: OPERATIONAL_READINESS_FORMAT_V1.to_owned(),
        ready: unsatisfied.is_empty(),
        startup_nonce: facts.startup_nonce.clone(),
        evaluated_at_ms: facts.evaluated_at_ms,
        target,
        unsatisfied,
        auth: OperationalReadinessAuthV1 {
            active: state.active,
            desired: state.desired,
            mode_state: state.mode_state,
            app_data_availability: state.app_data_availability,
            session_activation_ready,
        },
        capability_manifest_digest: facts.capability_manifest_digest.clone(),
        artifacts: facts.artifacts.clone(),
        network_profile: facts.network_profile.clone(),
        app_id: facts.app_id.clone(),
    }
}

fn readiness_declaration_invalid(message: &'static str) -> SnapbackError {
    SnapbackError::error(READINESS_DECLARATION_INVALID_CODE, "app-readiness", message)
}

fn readiness_facts_unavailable(message: &'static str) -> SnapbackError {
    SnapbackError::error(READINESS_FACTS_UNAVAILABLE_CODE, "app-readiness", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::mode::{
        AUTH_MODE_FORMAT_VERSION, FUNCTION_V1_PREFIX, INPUTS_V1_PREFIX, SCHEMA_V1_PREFIX,
    };
    use crate::manifest::{AuthManifest, FunctionManifest, SchemaManifest};

    #[test]
    fn application_ready_path_appends_the_literal_cross_language_suffix() {
        assert_eq!(
            application_ready_sibling(Path::new("state/host.ready.json")),
            PathBuf::from("state/host.ready.json.application-ready")
        );
    }

    fn deployment(mode: AuthMode, marker: char) -> DeploymentIdentity {
        let digest = marker.to_string().repeat(64);
        match mode {
            AuthMode::Dev => DeploymentIdentity {
                schema_version: "snapback.v0".to_owned(),
                auth_mode: mode,
                app_id: "todo".to_owned(),
                schema_hash: format!("sha256:schema-{marker}"),
                bundle_hash: format!("sha256:functions-{marker}"),
                inputs_hash: format!("sha256:inputs-{marker}"),
            },
            AuthMode::Sessions => DeploymentIdentity {
                schema_version: "snapback.v1".to_owned(),
                auth_mode: mode,
                app_id: "todo".to_owned(),
                schema_hash: format!("{SCHEMA_V1_PREFIX}{digest}"),
                bundle_hash: format!("{FUNCTION_V1_PREFIX}{digest}"),
                inputs_hash: format!("{INPUTS_V1_PREFIX}{digest}"),
            },
        }
    }

    fn obligations(active: &DeploymentIdentity) -> Vec<DeclaredObligationV1> {
        vec![
            DeclaredObligationV1::Schema {
                schema_hash: active.schema_hash.clone(),
            },
            DeclaredObligationV1::Functions {
                bundle_hash: active.bundle_hash.clone(),
            },
            DeclaredObligationV1::Routes {
                route_manifest_hash: "sha256:routes".to_owned(),
            },
            DeclaredObligationV1::ApiEnvelope {
                envelope_hash: "envelope-hash".to_owned(),
            },
            DeclaredObligationV1::Seed {
                seed_version: "seed-v1".to_owned(),
                seed_digest: "sha256:seed".to_owned(),
                idempotent: true,
            },
        ]
    }

    fn manifests(active: &DeploymentIdentity) -> (SchemaManifest, FunctionManifest) {
        (
            SchemaManifest {
                schema_version: active.schema_version.clone(),
                app_id: active.app_id.clone(),
                auth: Some(AuthManifest {
                    mode: active.auth_mode,
                    agents: None,
                    password_identifier_mode: None,
                    password_minimum_length: None,
                }),
                schema_hash: Some(active.schema_hash.clone()),
                inputs_hash: Some(active.inputs_hash.clone()),
                ..SchemaManifest::default()
            },
            FunctionManifest {
                schema_version: active.schema_version.clone(),
                app_id: active.app_id.clone(),
                bundle_hash: Some(active.bundle_hash.clone()),
                inputs_hash: Some(active.inputs_hash.clone()),
                ..FunctionManifest::default()
            },
        )
    }

    fn target(active: &DeploymentIdentity) -> ExpectedActivationTargetV1 {
        let declared_obligations = obligations(active);
        ExpectedActivationTargetV1 {
            format_version: EXPECTED_ACTIVATION_TARGET_FORMAT_V1.to_owned(),
            deployment: active.clone(),
            target_profile: "local-dev-sqlite-ibex".to_owned(),
            obligations_digest: declared_obligations_digest(&declared_obligations)
                .expect("fixture obligations digest"),
            declared_obligations,
            pending_migration: None,
        }
    }

    fn facts(active: DeploymentIdentity) -> OperationalReadinessFactsV1 {
        OperationalReadinessFactsV1 {
            startup_nonce: "startup-test".to_owned(),
            evaluated_at_ms: 42,
            auth_mode_state: AuthModeStateRecord::initial_dev(Some(active.clone())),
            effective_active_deployment: Some(active.clone()),
            auth_program_readiness: AuthProgramReadiness::item4(false),
            capability_manifest_digest: "sha256:capabilities".to_owned(),
            artifacts: HostOpsArtifacts {
                schema_hash: Some(active.schema_hash.clone()),
                bundle_hash: Some(active.bundle_hash.clone()),
                database_version: Some(7),
            },
            network_profile: "normal".to_owned(),
            app_id: Some(active.app_id.clone()),
            route_manifest_hash: Some("sha256:routes".to_owned()),
            api_envelope_hash: Some("envelope-hash".to_owned()),
            active_seed_identity: Some(ActiveSeedIdentityV1 {
                app_id: active.app_id,
                seed_version: "seed-v1".to_owned(),
                seed_digest: "sha256:seed".to_owned(),
                data_version_stream: "stream".to_owned(),
                schema_hash: active.schema_hash,
                direct_application_rows: 1,
                derived_projection_rows: 0,
                total_application_effects: 1,
            }),
        }
    }

    fn conditions(readiness: &OperationalReadinessV1) -> Vec<&str> {
        readiness
            .unsatisfied
            .iter()
            .map(|entry| entry.condition.as_str())
            .collect()
    }

    #[test]
    fn settled_matching_target_is_ready() {
        let active = deployment(AuthMode::Dev, 'a');
        let target = target(&active);
        validate_expected_activation_target(&target).expect("valid target");
        let readiness = evaluate_operational_readiness(&facts(active), Some(&target));
        assert!(readiness.ready);
        assert!(readiness.unsatisfied.is_empty());
        assert_eq!(
            readiness.target.unwrap().obligations_digest,
            target.obligations_digest
        );
    }

    #[test]
    fn deployment_mismatch_is_unsatisfied() {
        let active = deployment(AuthMode::Dev, 'a');
        let expected = target(&deployment(AuthMode::Dev, 'b'));
        let readiness = evaluate_operational_readiness(&facts(active), Some(&expected));
        assert!(!readiness.ready);
        assert!(conditions(&readiness).contains(&"active-deployment-mismatch"));
    }

    #[test]
    fn dev_record_null_uses_matching_loaded_manifest_identity() {
        let active = deployment(AuthMode::Dev, 'a');
        let target = target(&active);
        let mut facts = facts(active.clone());
        facts.auth_mode_state.active_deployment = None;
        let (schema, functions) = manifests(&active);
        facts.effective_active_deployment =
            derive_effective_active_deployment(&facts.auth_mode_state, &schema, &functions);

        let readiness = evaluate_operational_readiness(&facts, Some(&target));
        assert!(readiness.ready);
        assert!(readiness.unsatisfied.is_empty());
    }

    #[test]
    fn dev_record_null_rejects_mismatched_declared_identity() {
        let active = deployment(AuthMode::Dev, 'a');
        let expected = target(&deployment(AuthMode::Dev, 'b'));
        let mut facts = facts(active.clone());
        facts.auth_mode_state.active_deployment = None;
        let (schema, functions) = manifests(&active);
        facts.effective_active_deployment =
            derive_effective_active_deployment(&facts.auth_mode_state, &schema, &functions);

        let readiness = evaluate_operational_readiness(&facts, Some(&expected));
        assert!(!readiness.ready);
        assert!(conditions(&readiness).contains(&"active-deployment-mismatch"));
    }

    #[test]
    fn sessions_record_null_does_not_use_matching_loaded_manifest_identity() {
        let active = deployment(AuthMode::Sessions, 'a');
        let target = target(&active);
        let mut facts = facts(active.clone());
        facts.auth_mode_state = AuthModeStateRecord {
            format_version: AUTH_MODE_FORMAT_VERSION,
            transition_generation: 1,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: None,
            requested_deployment: None,
            quarantine: None,
        };
        let (schema, functions) = manifests(&active);
        facts.effective_active_deployment =
            derive_effective_active_deployment(&facts.auth_mode_state, &schema, &functions);
        assert_eq!(facts.effective_active_deployment, None);
        facts.auth_program_readiness =
            AuthProgramReadiness::new(true, true, true, true, true, true, true);

        let readiness = evaluate_operational_readiness(&facts, Some(&target));
        assert!(!readiness.ready);
        assert!(conditions(&readiness).contains(&"active-deployment-mismatch"));
    }

    #[test]
    fn each_unsettled_auth_conjunct_is_reported() {
        let active = deployment(AuthMode::Dev, 'a');
        let target = target(&active);
        let mut facts = facts(active.clone());
        facts.auth_mode_state.desired = AuthMode::Sessions;
        facts.auth_mode_state.mode_state = AuthModeStatus::PendingRestart;
        facts.auth_mode_state.app_data_availability = AppDataAvailability::RefusedPending;
        facts.auth_mode_state.requested_deployment = Some(deployment(AuthMode::Sessions, 'c'));
        facts.auth_mode_state.quarantine = Some(crate::auth::mode::AuthModeQuarantine {
            transition_generation: 1,
            code: "SNAPBACK_TEST_QUARANTINE".to_owned(),
        });
        let readiness = evaluate_operational_readiness(&facts, Some(&target));
        let observed = conditions(&readiness);
        for condition in [
            "auth-active-desired-mismatch",
            "auth-mode-unsettled",
            "app-data-unavailable",
            "auth-requested-deployment-present",
            "auth-quarantine-present",
        ] {
            assert!(observed.contains(&condition), "missing {condition}");
        }
    }

    #[test]
    fn sessions_requires_positive_session_activation_readiness() {
        let active = deployment(AuthMode::Sessions, 'a');
        let target = target(&active);
        let mut facts = facts(active.clone());
        facts.auth_mode_state = AuthModeStateRecord {
            format_version: AUTH_MODE_FORMAT_VERSION,
            transition_generation: 1,
            active: AuthMode::Sessions,
            desired: AuthMode::Sessions,
            mode_state: AuthModeStatus::Settled,
            app_data_availability: AppDataAvailability::Available,
            sessions_ever_activated: true,
            active_deployment: Some(active),
            requested_deployment: None,
            quarantine: None,
        };
        facts.auth_program_readiness = AuthProgramReadiness::item4(false);
        let readiness = evaluate_operational_readiness(&facts, Some(&target));
        assert_eq!(readiness.auth.session_activation_ready, Some(false));
        assert!(conditions(&readiness).contains(&"sessions-activation-not-ready"));
    }

    #[test]
    fn seed_uninstalled_and_mismatched_are_distinct() {
        let active = deployment(AuthMode::Dev, 'a');
        let target = target(&active);
        let mut facts = facts(active);
        facts.active_seed_identity = None;
        let uninstalled = evaluate_operational_readiness(&facts, Some(&target));
        assert!(conditions(&uninstalled).contains(&"seed-obligation-uninstalled"));

        facts.active_seed_identity = Some(ActiveSeedIdentityV1 {
            app_id: "todo".to_owned(),
            seed_version: "wrong".to_owned(),
            seed_digest: "sha256:wrong".to_owned(),
            data_version_stream: "stream".to_owned(),
            schema_hash: "sha256:schema".to_owned(),
            direct_application_rows: 0,
            derived_projection_rows: 0,
            total_application_effects: 0,
        });
        let mismatched = evaluate_operational_readiness(&facts, Some(&target));
        assert!(conditions(&mismatched).contains(&"seed-obligation-mismatched"));
        assert!(!conditions(&mismatched).contains(&"seed-obligation-uninstalled"));
    }

    #[test]
    fn undeclared_target_fails_closed_with_own_condition() {
        let readiness =
            evaluate_operational_readiness(&facts(deployment(AuthMode::Dev, 'a')), None);
        assert!(!readiness.ready);
        assert_eq!(readiness.target, None);
        assert_eq!(conditions(&readiness), vec!["expected-target-undeclared"]);
    }

    #[test]
    fn digest_mismatch_refusal_helper_is_stable() {
        let mut target = target(&deployment(AuthMode::Dev, 'a'));
        target.obligations_digest = "sha256:wrong".to_owned();
        let error = validate_expected_activation_target(&target).unwrap_err();
        assert_eq!(
            error.diagnostic.code,
            READINESS_OBLIGATIONS_DIGEST_MISMATCH_CODE
        );
    }

    #[test]
    fn migration_declaration_refusal_helper_is_stable() {
        let mut target = target(&deployment(AuthMode::Dev, 'a'));
        target.pending_migration = Some(PendingMigrationDeclarationV1 {
            identifier: "migration-1".to_owned(),
        });
        let error = validate_expected_activation_target(&target).unwrap_err();
        assert_eq!(error.diagnostic.code, READINESS_MIGRATION_UNRESOLVED_CODE);
    }

    #[test]
    fn non_idempotent_seed_declaration_is_refused() {
        let mut target = target(&deployment(AuthMode::Dev, 'a'));
        if let Some(DeclaredObligationV1::Seed { idempotent, .. }) = target
            .declared_obligations
            .iter_mut()
            .find(|obligation| matches!(obligation, DeclaredObligationV1::Seed { .. }))
        {
            *idempotent = false;
        }
        target.obligations_digest =
            declared_obligations_digest(&target.declared_obligations).unwrap();
        let error = validate_expected_activation_target(&target).unwrap_err();
        assert_eq!(error.diagnostic.code, READINESS_SEED_NOT_IDEMPOTENT_CODE);
    }
}
