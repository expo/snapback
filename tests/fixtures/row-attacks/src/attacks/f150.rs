use snapback_engine::local::LocalSnapback;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::manifest::{AuthorityDescriptor, HandlerInput};

fn stage_descriptor_from_another_resolution(
    engine: &mut LocalSnapback,
    input: HandlerInput,
    prepared_for_effect: PreparedAuthority,
    descriptor_from_another_resolution: AuthorityDescriptor,
) {
    // @attack
    let _ = engine.stage_recorded_authorization_mutation(
        "recordedMutation",
        input,
        Some("attacker-mutation".to_owned()),
        Some(descriptor_from_another_resolution),
        &[],
        "dependent-row-attack",
        prepared_for_effect,
    );
}

fn main() {
    let _ = stage_descriptor_from_another_resolution;
    report_observation(
        "F150",
        Ok(
            "dependent combined one prepared authority with another resolution's descriptor"
                .to_owned(),
        ),
    );
}
