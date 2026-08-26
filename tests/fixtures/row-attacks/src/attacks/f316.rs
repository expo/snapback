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
            .map_err(|error| format!("denial setup creation: {error:?}"))?;
        let denied = fixture
            .serving
            .deny_pending_effect_admitted(&created.id, "human-a", NOW + 1)
            .map_err(|error| format!("raw denial bridge refused: {error:?}"))?;
        if denied.status != PendingEffectStatus::Refused
            || denied.outcome_code.as_deref() != Some("SNAPBACK_EFFECT_APPROVAL_DENIED")
        {
            return Err(format!(
                "denial did not persist expected state/code: {:?} {:?}",
                denied.status, denied.outcome_code
            ));
        }
        Ok(format!(
            "dependent denied durable pending effect id={}",
            denied.id
        ))
    })();

    report_observation("F316", result);
    Ok(())
}
