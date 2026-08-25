// F283 remains open. Retain this witness for its future closure, but do not
// register it in the rejection-only attacks.v1.json while the attack compiles.

use snapback_server::auth::invocation::PreparedAuthority;
use snapback_server::local::{
    LiveInvalidationAdmission, LiveSubscribeInput, LocalSnapback,
};

fn attempt_generation_none_through_server_surface(
    snapback: &mut LocalSnapback,
    name: String,
    input: LiveSubscribeInput,
    authority: PreparedAuthority,
    invalidation: LiveInvalidationAdmission,
) {
    // @attack
    let _ = snapback.prepare_subscribe_live_for_transport_generation(
        name,
        input,
        authority,
        invalidation,
        None,
    );
}

fn main() {}
