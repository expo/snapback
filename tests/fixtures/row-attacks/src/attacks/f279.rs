use snapback_engine::local::LocalSnapback;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::manifest::{AuthorityDescriptor, HandlerInput};

fn stage_cross_engine_authority(
    target_engine: &mut LocalSnapback,
    input: HandlerInput,
    client_mutation_id: String,
    descriptor_from_engine_b: AuthorityDescriptor,
    authority_from_engine_a: PreparedAuthority,
) {
    // @attack
    let _ = target_engine.stage_recorded_authorization_mutation(
        "recordedMutation",
        input,
        Some(client_mutation_id),
        Some(descriptor_from_engine_b),
        &[],
        "dependent-row-attack",
        authority_from_engine_a,
    );
}

fn main() {
    let _ = stage_cross_engine_authority;
    report_observation(
        "F279",
        Ok(
            "dependent staged independently supplied mutation identity, descriptor, and authority"
                .to_owned(),
        ),
    );
}
