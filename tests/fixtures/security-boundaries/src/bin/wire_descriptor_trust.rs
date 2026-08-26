use snapback_engine::local::LocalSnapback;
use snapback_kernel::manifest::{AuthorityDescriptor, HandlerInput};
use snapback_sync::auth::invocation::PreparedAuthority;

fn attack(engine: &mut LocalSnapback, authority: PreparedAuthority, raw: &str) {
    let descriptor: AuthorityDescriptor = serde_json::from_str(raw).unwrap();
    // @attack
    let _ = engine.stage_recorded_authorization_mutation(
        "effect",
        HandlerInput::default(),
        Some("cm_wire_descriptor".to_owned()),
        Some(descriptor),
        &[],
        "fixture",
        authority,
    );
}

fn main() {
    let _ = attack;
}
