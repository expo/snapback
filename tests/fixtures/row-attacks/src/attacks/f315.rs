use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{
    NOW, report_observation, setup_pending_effect_owner_bridge_attack,
};

fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_owner_bridge_attack()?;

    // @attack
    let result = (|| {
        let created = fixture
            .serving
            .create_pending_effect_admitted(fixture.request)
            .map_err(|error| format!("approval setup creation: {error:?}"))?;
        let preparation = fixture
            .serving
            .prepare_pending_effect_approval(&created.id, "human-a", NOW + 1)
            .map_err(|error| format!("approval preparation: {error:?}"))?;
        let approved = fixture
            .serving
            .approve_pending_effect_admitted(preparation, false, None, NOW + 2)
            .map_err(|error| format!("raw approval bridge refused: {error:?}"))?;
        if approved.record.status != PendingEffectStatus::Approved {
            return Err(format!(
                "approval returned unexpected status: {:?}",
                approved.record.status
            ));
        }
        Ok(format!(
            "dependent approved durable pending effect id={}",
            approved.record.id
        ))
    })();

    report_observation("F315", result);
    Ok(())
}
