use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::coordinator::AuthCoordinator;
use snapback_sync::auth::session_projection::SessionProjection;

fn rebuild_raw_projection(database: &mut LocalDatabase) {
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

fn main() {
    let _ = rebuild_raw_projection;
    report_observation(
        "F094",
        Ok(
            "dependent rebuilt live session authority from a caller-readable raw snapshot"
                .to_owned(),
        ),
    );
}
