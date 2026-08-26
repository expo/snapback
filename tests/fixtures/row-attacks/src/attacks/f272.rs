use snapback_kernel::services_assets::AssetAttemptsProofLocalExt;
use snapback_kernel::storage::{LocalDatabase, ServingDatabase};
use snapback_row_attack_fixtures::report_observation;

fn main() -> Result<(), String> {
    let database = LocalDatabase::memory().map_err(|error| format!("memory: {error:?}"))?;
    let mut serving =
        ServingDatabase::adopt(database).map_err(|error| format!("adopt: {error:?}"))?;

    // @attack
    let proof = serving
        .asset_attempts()
        .stage_width_variant_plan_proved_guarded(
            "dependent-selected-app",
            "dependent-selected-asset",
            "width/313",
            &format!("sha256:{}", "a".repeat(64)),
            23,
            || Ok(()),
        )
        .map_err(|error| format!("raw width staging: {error:?}"));

    report_observation(
        "F272",
        proof.map(|proof| {
            format!(
                "dependent staged publication {} without an engine plan or route reservation",
                proof.publication().publication_id
            )
        }),
    );
    Ok(())
}
