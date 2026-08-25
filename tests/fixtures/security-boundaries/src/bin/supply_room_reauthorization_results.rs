use snapback_engine::ephemeral::{AuthContext, PendingRoomReauthorization};
use snapback_engine::local::{EphemeralApi, LocalSnapback};

fn supply_results(
    snapback: &LocalSnapback,
    ephemeral: &EphemeralApi,
    pending: PendingRoomReauthorization,
    auth: AuthContext,
) {
    // @attack
    let batch = snapback
        .resolve_pending_ephemeral_room_permissions(pending, vec![Some(auth)])
        .expect("caller-selected room reauthorization results resolve");
    let _ = ephemeral.complete_room_reauthorization(batch);
}

fn main() {}
