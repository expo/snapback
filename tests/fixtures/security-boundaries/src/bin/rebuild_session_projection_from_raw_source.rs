use snapback_kernel::storage::LocalDatabase;
use snapback_sync::auth::coordinator::AuthCoordinator;
use snapback_sync::auth::session_projection::SessionProjection;

fn attempt_raw_rebuild(database: &mut LocalDatabase) {
    // @attack
    let _ = (|| {
        let source = database.session_projection_source()?;
        let projection = SessionProjection::rebuild(
            source,
            "018f1000-0000-7000-8000-000000000000",
            0,
            std::time::Instant::now(),
        )?;
        AuthCoordinator::new(projection)
    })();
}

fn main() {}
