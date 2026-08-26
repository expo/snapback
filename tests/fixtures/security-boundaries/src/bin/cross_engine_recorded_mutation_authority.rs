use snapback_auth::auth::deployment::AuthDeploymentTarget;
use snapback_engine::contract_types::{AuthMode, ServerProfile};
use snapback_engine::local::LocalSnapback;
use snapback_kernel::manifest::{AuthorityDescriptor, HandlerInput};
use snapback_sync::auth::invocation::{
    InvocationSource, PreparedAuthority, ResolvedAppAuthority, WireAuthorityFields,
};

fn genuine_engine_authority(engine: &mut LocalSnapback) -> PreparedAuthority {
    let bindings = engine
        .claim_app_state_graph(ServerProfile::Test, AuthDeploymentTarget::Local)
        .unwrap();
    let (admission, _, _, _, _, _, _, _) = bindings.into_parts_for_app_state(engine).unwrap();
    engine
        .prepare_dev_authority(
            InvocationSource::HttpMutation,
            ServerProfile::Test,
            admission.admit_for_mode(AuthMode::Dev).unwrap(),
            &WireAuthorityFields::default(),
            ResolvedAppAuthority::Anonymous,
            0,
        )
        .unwrap()
}

fn main() {
    let mut first = LocalSnapback::memory().unwrap();
    let first_authority = genuine_engine_authority(&mut first);

    let mut second = LocalSnapback::memory().unwrap();
    let second_authority = genuine_engine_authority(&mut second);
    let second_descriptor = AuthorityDescriptor {
        descriptor_version: 1,
        authority_instance_id: second_authority
            .authorization_stream_incarnation()
            .unwrap()
            .to_owned(),
        session_generation: 0,
    };

    // @attack
    let _ = second.stage_recorded_authorization_mutation(
        "effect",
        HandlerInput::default(),
        Some("cm_cross_engine_authority".to_owned()),
        Some(second_descriptor),
        &[],
        "fixture",
        first_authority,
    );
}
