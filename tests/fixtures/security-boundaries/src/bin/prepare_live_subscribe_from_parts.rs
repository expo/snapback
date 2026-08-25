// F283 remains open. Retain this witness for its future closure, but do not
// register it in the rejection-only attacks.v1.json while the attack compiles.

use snapback_engine::local::{
    LiveInvalidationAdmission, LiveSubscribeInput, LocalSnapback,
};
use snapback_server::auth::invocation::PreparedAuthority;

fn attempt_independent_parts(
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
