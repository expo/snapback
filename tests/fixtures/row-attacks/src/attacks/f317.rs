use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{
    NOW, report_observation, setup_pending_effect_consumer_attack,
};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_consumer_attack().await?;
    let effect_id = fixture.effect_id.clone();
    let preparation_owner = fixture.resolve_owner(NOW + 201)?;
    let preparation = fixture
        .serving
        .prepare_pending_effect_approval(&preparation_owner, &effect_id, NOW + 201)
        .map_err(|error| format!("settlement approval preparation: {error:?}"))?;
    let approval_owner = fixture.resolve_owner(NOW + 202)?;
    let approved = fixture
        .serving
        .approve_pending_effect_admitted(approval_owner, preparation, None, NOW + 202)
        .map_err(|error| format!("settlement approval: {error:?}"))?;
    let (_, genuine_ticket) = approved.into_parts();

    // @attack
    let result = fixture.serving.settle_pending_effect_admitted(
        genuine_ticket,
        true,
        Some("CALLER_SELECTED_OUTCOME"),
        NOW + 203,
    );
    let result = result
        .map_err(|error| format!("raw settlement bridge refused: {error:?}"))
        .and_then(|settled| {
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
        });

    report_observation("F317", result);
    Ok(())
}
