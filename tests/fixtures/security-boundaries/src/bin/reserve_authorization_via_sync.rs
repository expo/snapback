use std::sync::Arc;

use snapback_kernel::storage::{
    AuthorizationCommitPreflight, AuthorizationReservationCancellation,
};
use snapback_sync::ephemeral::LocalEphemeralBackend;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let backend = LocalEphemeralBackend::new();
    let cancellation = Arc::new(AuthorizationReservationCancellation::default());
    // @attack
    let _reservation = backend.reserve_authorization_commit(
        AuthorizationCommitPreflight::NoAuthorizationEvent,
        cancellation,
    )?;
    Ok(())
}
