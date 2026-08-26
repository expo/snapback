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
            .map_err(|error| format!("refusal setup creation: {error:?}"))?;
        fixture
            .serving
            .refuse_pending_effect_admitted(&created.id, "CALLER_SELECTED_REFUSAL", NOW + 1)
            .map_err(|error| format!("raw refusal bridge refused: {error:?}"))?;
        let durable = fixture
            .serving
            .pending_effect(&created.id, NOW + 1)
            .map_err(|error| format!("read refusal: {error:?}"))?;
        if durable.status != PendingEffectStatus::Refused
            || durable.outcome_code.as_deref() != Some("CALLER_SELECTED_REFUSAL")
        {
            return Err(format!(
                "refusal did not persist selected state/code: {:?} {:?}",
                durable.status, durable.outcome_code
            ));
        }
        Ok(format!(
            "caller selected durable refusal id={} code=CALLER_SELECTED_REFUSAL",
            durable.id
        ))
    })();

    report_observation("F314", result);
    Ok(())
}
