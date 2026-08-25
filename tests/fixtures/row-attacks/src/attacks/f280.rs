use snapback_engine::local::LocalSnapback;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::manifest::{
    ArtifactGeneration, AuthorityDescriptor, HandlerInput, MutationSettlement,
};

fn stage_generation_sibling(
    target_engine: &mut LocalSnapback,
    input: HandlerInput,
    descriptor_from_engine_b: AuthorityDescriptor,
    authority_from_engine_a: PreparedAuthority,
    generation: ArtifactGeneration,
) {
    // @attack
    let _ = target_engine.stage_recorded_authorization_mutation_with_wire_version(
        "recordedMutation",
        input,
        Some("attacker-mutation".to_owned()),
        Some(descriptor_from_engine_b),
        &[],
        "dependent-row-attack",
        authority_from_engine_a,
        Some(&generation),
        None,
        MutationSettlement::default(),
        None,
        None,
    );
}

fn main() {
    let _ = stage_generation_sibling;
    report_observation(
        "F280",
        Ok("dependent supplied generation, descriptor, and authority as independent staging inputs".to_owned()),
    );
}
