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
        .refuse_pending_effect_admitted(&effect_id, "CALLER_SELECTED_REFUSAL", NOW + 201)
        .map_err(|error| format!("raw refusal bridge refused: {error:?}"))
        .and_then(|()| {
            let durable = fixture
                .serving
                .pending_effect(&effect_id, NOW + 201)
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
        });

    report_observation("F314", result);
    Ok(())
}
