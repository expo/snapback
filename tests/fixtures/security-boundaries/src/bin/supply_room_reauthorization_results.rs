use snapback_kernel::storage::{
    AuthorizationCommitParticipant, ResolvedRoomReauthorizationBatch,
    RoomReauthorizationDatabase, RoomReauthorizationDisposition,
};

fn forge_terminal_disposition(
    participant: &AuthorizationCommitParticipant,
    database: &RoomReauthorizationDatabase,
    batch: ResolvedRoomReauthorizationBatch,
    disposition: RoomReauthorizationDisposition,
) {
    // @attack
    let _ = participant.run_room_reauthorization_completion_off_local(
        database,
        batch,
        |_| Ok((disposition, ())),
    );
}

fn main() {}
