use snapback_auth::auth::admission::AdmissionController;
use snapback_kernel::contract_types::ServerProfile;
use snapback_kernel::manifest::AuthMode;
use snapback_sync::auth::invocation::{
    InvocationGate, InvocationSource, ResolvedAppAuthority, WireAuthorityFields,
};
use snapback_sync::auth::mode::{
    AppDataAvailability, AuthModeStateRecord, AuthModeStatus, DeploymentIdentity,
    AUTH_MODE_FORMAT_VERSION,
};

fn digest(prefix: &str, marker: char) -> String {
    format!("{prefix}{}", marker.to_string().repeat(64))
}

fn main() {
    let deployment = DeploymentIdentity {
        schema_version: "snapback.v1".to_owned(),
        auth_mode: AuthMode::Sessions,
        app_id: "forged-app".to_owned(),
        schema_hash: digest("snapback.v1:sessions:schema:sha256:", '1'),
        bundle_hash: digest("snapback.v1:sessions:function:sha256:", '2'),
        inputs_hash: digest("snapback.v1:sessions:inputs:sha256:", '3'),
    };
    let mode = AuthModeStateRecord {
        format_version: AUTH_MODE_FORMAT_VERSION,
        transition_generation: 7,
        active: AuthMode::Sessions,
        desired: AuthMode::Sessions,
        mode_state: AuthModeStatus::Settled,
        app_data_availability: AppDataAvailability::Available,
        sessions_ever_activated: true,
        active_deployment: Some(deployment),
        requested_deployment: None,
        quarantine: None,
    };
    let controller = AdmissionController::from_mode_state(&mode).unwrap();
    let admission = controller.admit_for_mode(AuthMode::Sessions).unwrap();
    let resolved = ResolvedAppAuthority::Session {
        user_id: "forged-user".to_owned(),
        session_id: "forged-session".to_owned(),
        provider: "forged-provider".to_owned(),
        generation: 1,
        authority_instance_id: "forged-authority".to_owned(),
        session_not_after_ms: u64::MAX,
        provider_not_after_ms: None,
        rehearsal_provenance: None,
    };
    // @attack
    let _prepared = InvocationGate::prepare_admitted_authority(
        InvocationSource::HttpQuery,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission.clone(),
        &WireAuthorityFields::default(),
        resolved.clone(),
        None,
    )
    .unwrap();
    let _second = InvocationGate::prepare_admitted_authority(
        InvocationSource::HttpQuery,
        AuthMode::Sessions,
        ServerProfile::Test,
        admission,
        &WireAuthorityFields::default(),
        resolved,
        None,
    )
    .unwrap();
}
