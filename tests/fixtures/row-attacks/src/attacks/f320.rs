use snapback_kernel::storage::{LocalDatabase, ServingDatabase};
use snapback_row_attack_fixtures::report_observation;

fn main() -> Result<(), String> {
    let database = LocalDatabase::memory().map_err(|error| format!("memory: {error:?}"))?;
    let mut database =
        ServingDatabase::adopt(database).map_err(|error| format!("adopt: {error:?}"))?;
    database
        .ensure_promotion_contention_infra_for_bench()
        .map_err(|error| format!("bench infrastructure: {error:?}"))?;

    // @attack
    let result = (|| {
        let reservation = database
            .prepare_promotion_contention_reservation_for_bench("caller-selected-stream", 2, 500)
            .map_err(|error| format!("prepare reservation: {error:?}"))?;
        let policy = database
            .activate_promotion_contention_reservation_for_bench(reservation, 501)
            .map_err(|error| format!("activate reservation: {error:?}"))?;
        Ok(format!(
            "activated interval_ms={} max_commit_ms={}",
            policy.reservation_interval_ms, policy.maximum_promotion_commit_duration_ms
        ))
    })();

    report_observation("F320", result);
    Ok(())
}
