use snapback_row_attack_fixtures::{report_observation, setup_f157_attack};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_f157_attack().await?;

    // @attack
    let result = async {
        #[cfg(feature = "additive")]
        {
            let _ = fixture.carrier.clone().into_parts();
        }
        let original = fixture
            .engine
            .prepare_pending_effect_session_original(
                fixture
                    .approval
                    .as_ref()
                    .ok_or_else(|| "F157 approval was already consumed".to_owned())?,
                fixture.carrier.clone(),
                fixture.now_ms,
            )
            .map_err(|error| format!("engine B refused engine A's session carrier: {error:?}"))?;
        let approval = fixture
            .approval
            .take()
            .ok_or_else(|| "F157 approval was already consumed".to_owned())?;
        let dispatch = fixture
            .engine
            .approve_pending_effect(approval, original, None, fixture.now_ms + 1)
            .map_err(|error| format!("engine B durable approval refused: {error:?}"))?;
        let (record, _, _) = dispatch.into_parts();
        Ok(format!(
            "engine B accepted engine A carrier; effect={} status={:?}",
            record.id, record.status
        ))
    }
    .await;

    report_observation("F157", result);
    Ok(())
}
