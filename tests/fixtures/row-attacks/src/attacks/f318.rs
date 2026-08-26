use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{report_observation, setup_pending_effect_owner_bridge_attack};

fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_owner_bridge_attack()?;

    // @attack
    let result = fixture
        .serving
        .create_pending_effect_admitted(fixture.request)
        .map_err(|error| format!("raw creation bridge refused: {error:?}"))
        .and_then(|record| {
            (record.status == PendingEffectStatus::Pending)
                .then(|| {
                    format!(
                        "caller-authored request became durable Pending id={}",
                        record.id
                    )
                })
                .ok_or_else(|| format!("creation returned unexpected status: {:?}", record.status))
        });

    report_observation("F318", result);
    Ok(())
}
