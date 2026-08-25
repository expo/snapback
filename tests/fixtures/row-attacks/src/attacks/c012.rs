use snapback_engine::local::LocalSnapback;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::invocation::PreparedAuthority;
use snapback_types::manifest::{AuthorityDescriptor, HandlerInput};

fn use_forged_wire_descriptor(
    engine: &mut LocalSnapback,
    input: HandlerInput,
    authority: PreparedAuthority,
) {
    // @attack
    let _ = (|| {
        // Wire construction deliberately remains public. The security
        // boundary is whether a trusted consumer accepts this naked value.
        let forged = AuthorityDescriptor {
            descriptor_version: 1,
            authority_instance_id: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            session_generation: 9_007_199_254_740_991,
        };
        engine.stage_recorded_authorization_mutation(
            "recordedMutation",
            input,
            Some("attacker-mutation".to_owned()),
            Some(forged),
            &[],
            "dependent-row-attack",
            authority,
        )
    })();
}

fn main() {
    let _ = use_forged_wire_descriptor;
    report_observation(
        "C012",
        Ok(
            "dependent supplied a forged wire descriptor directly to a trusted mutation consumer"
                .to_owned(),
        ),
    );
}
