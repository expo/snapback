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
            .map_err(|error| format!("settlement setup creation: {error:?}"))?;
        let preparation = fixture
            .serving
            .prepare_pending_effect_approval(&created.id, "human-a", NOW + 1)
            .map_err(|error| format!("settlement approval preparation: {error:?}"))?;
        let approved = fixture
            .serving
            .approve_pending_effect_admitted(preparation, false, None, NOW + 2)
            .map_err(|error| format!("settlement approval: {error:?}"))?;
        let (_, genuine_ticket) = approved.into_parts();
        let settled = fixture
            .serving
            .settle_pending_effect_admitted(
                genuine_ticket,
                true,
                Some("CALLER_SELECTED_OUTCOME"),
                NOW + 3,
            )
            .map_err(|error| format!("raw settlement bridge refused: {error:?}"))?;
        if settled.status != PendingEffectStatus::Executed
            || settled.outcome_code.as_deref() != Some("CALLER_SELECTED_OUTCOME")
        {
            return Err(format!(
                "settlement did not persist selected state/code: {:?} {:?}",
                settled.status, settled.outcome_code
            ));
        }
        Ok(format!(
            "genuine ticket accepted independent executed=true and outcome for id={}",
            settled.id
        ))
    })();

    report_observation("F317", result);
    Ok(())
}
