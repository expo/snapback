use snapback_engine::local::LocalSnapback;
use snapback_kernel::manifest::{AuthorityDescriptor, HandlerInput, MutationSettlement};
use snapback_sync::auth::invocation::PreparedAuthority;

fn attack(
    engine: &mut LocalSnapback,
    authority: PreparedAuthority,
    descriptor: AuthorityDescriptor,
) {
    // @attack
    let _ = engine.stage_recorded_authorization_mutation_with_wire_version(
        "effect",
        HandlerInput::default(),
        Some("cm_generation_wrapper".to_owned()),
        Some(descriptor),
        &[],
        "fixture",
        authority,
        None,
        None,
        MutationSettlement::default(),
        None,
        None,
    );
}

fn main() {
    let _ = attack;
}
