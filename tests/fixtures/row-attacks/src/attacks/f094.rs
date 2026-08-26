use snapback_kernel::storage::LocalDatabase;
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::auth::admission::AdmissionController;
use snapback_sync::auth::coordinator::{AuthCoordinator, PreparedLocalSessionCoordinator};
use std::time::Instant;

fn relocate_raw_projection(
    source_database: &mut LocalDatabase,
    target_database: &LocalDatabase,
) -> Result<String, String> {
    let source = source_database
        .session_projection_source()
        .map_err(|error| format!("read source projection: {error:?}"))?;
    let admission = AdmissionController::new(0, true)
        .map_err(|error| format!("construct admission controller: {error:?}"))?;

    // @ref LLP 0303#s-a-compile-fail-witness-proves-a-spelling-is-gone-not-a-capability — attempt the public replacement carrier after the old rebuild spelling disappeared.
    // @attack
    let prepared = PreparedLocalSessionCoordinator {
        database_binding: target_database.binding(),
        source,
        admission,
        epoch_now_ms: 0,
        monotonic_now: Instant::now(),
    };
    let _coordinator = AuthCoordinator::from_prepared_local_session_database(prepared)
        .map_err(|error| format!("consume relocated projection: {error:?}"))?;

    Ok(
        "dependent rebuilt database A's raw projection as live authority bound to database B"
            .to_owned(),
    )
}

fn main() -> Result<(), String> {
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let mut source_database = LocalDatabase::open(directory.path().join("source.sqlite3"))
        .map_err(|error| format!("open source database: {error:?}"))?;
    source_database
        .activate_current_auth_catalog()
        .map_err(|error| format!("activate source auth catalog: {error:?}"))?;
    let target_database = LocalDatabase::open(directory.path().join("target.sqlite3"))
        .map_err(|error| format!("open target database: {error:?}"))?;

    let result = relocate_raw_projection(&mut source_database, &target_database);
    report_observation("F094", result);
    Ok(())
}
