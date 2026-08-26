use snapback_engine::ephemeral::{AuthContext, PendingRoomReauthorization};
use snapback_engine::local::{EphemeralApi, LocalSnapback};
use snapback_row_attack_fixtures::report_observation;

fn supply_room_reauthorization_results(
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

fn main() {
    let _ = supply_room_reauthorization_results;
    report_observation(
        "F244",
        Ok("caller supplied room reauthorization results beside a pending carrier".to_owned()),
    );
}
