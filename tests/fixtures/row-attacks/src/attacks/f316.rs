use snapback_kernel::storage::pending_effects::PendingEffectStatus;
use snapback_row_attack_fixtures::{
    NOW, report_observation, setup_pending_effect_consumer_attack,
};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_pending_effect_consumer_attack().await?;
    let effect_id = fixture.effect_id.clone();

    // @attack
    let result = fixture
        .serving
        .deny_pending_effect_admitted(&effect_id, "human-a", NOW + 201)
        .map_err(|error| format!("raw denial bridge refused: {error:?}"))
        .and_then(|denied| {
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
        });

    report_observation("F316", result);
    Ok(())
}
