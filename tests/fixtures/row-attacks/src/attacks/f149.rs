use snapback_engine::local::LocalSnapback;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::manifest::{AuthorityDescriptor, HandlerInput};

fn stage_with_caller_stream(
    engine: &mut LocalSnapback,
    input: HandlerInput,
    authority: PreparedAuthority,
    attacker_stream: String,
) {
    // @attack
    let _ = (|| {
        // Construct the capability directly instead of naming a helper that a
        // lane could delete or rename while leaving the composition open.
        let descriptor = AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: attacker_stream,
            session_generation: 0,
        };
        engine.stage_recorded_authorization_mutation(
            "recordedMutation",
            input,
            Some("attacker-mutation".to_owned()),
            Some(descriptor),
            &[],
            "dependent-row-attack",
            authority,
        )
    })();
}

fn main() {
    let _ = stage_with_caller_stream;
    report_observation(
        "F149",
        Ok("dependent supplied a caller-selected stream descriptor to mutation staging".to_owned()),
    );
}
