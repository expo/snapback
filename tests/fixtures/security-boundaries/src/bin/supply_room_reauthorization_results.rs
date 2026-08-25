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
            .enumerate()
            .map(|(index, subscriber)| {
                if index == 0 {
                    snapback_sync::ephemeral::RoomSubscriberResolution::Authorized {
                        connection_id: subscriber.connection_id.clone(),
                        expected_effect_fence: subscriber.effect_fence.clone(),
                        auth: auth.clone(),
                    }
                } else {
                    snapback_sync::ephemeral::RoomSubscriberResolution::Denied {
                        connection_id: subscriber.connection_id.clone(),
                        expected_effect_fence: subscriber.effect_fence.clone(),
                    }
                }
            })
            .collect(),
    );
}

fn main() {}
