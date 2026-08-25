use snapback_sync::ephemeral::{AuthContext, LocalEphemeralBackend, PendingRoomReauthorization};

fn supply_results(
    backend: &LocalEphemeralBackend,
    pending: &PendingRoomReauthorization,
    auth: AuthContext,
) {
    // @attack
    let _ = backend.complete_room_reauthorization(
        &pending.room,
        pending.obligation.room_authority_generation,
        pending
            .subscribers
            .iter()
            .map(
                |subscriber| snapback_sync::ephemeral::RoomSubscriberResolution::Authorized {
                    connection_id: subscriber.connection_id.clone(),
                    expected_effect_fence: subscriber.effect_fence.clone(),
                    auth: auth.clone(),
                },
            )
            .collect(),
    );
}

fn main() {}
