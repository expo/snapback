use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{
    NOW, report_observation, setup_pending_effect_consumer_attack,
};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_consumer_attack().await?;
    let effect_id = fixture.effect_id.clone();
    let owner = fixture.resolve_owner(NOW + 201)?;
    let preparation = fixture
        .serving
        .prepare_pending_effect_approval(&owner, &effect_id, NOW + 201)
        .map_err(|error| format!("approval preparation: {error:?}"))?;

    // @attack
    let approved = fixture
        .serving
        .approve_pending_effect_admitted(preparation, false, None, NOW + 202)
        .map_err(|error| format!("raw approval bridge refused: {error:?}"))?;
    let result = if approved.record.status == PendingEffectStatus::Approved {
        Ok(format!(
            "dependent approved durable pending effect id={}",
            approved.record.id
        ))
    } else {
        Err(format!(
            "approval returned unexpected status: {:?}",
            approved.record.status
        ))
    };

    report_observation("F315", result);
    Ok(())
}
