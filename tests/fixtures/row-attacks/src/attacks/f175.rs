use snapback_row_attack_fixtures::{report_observation, setup_f175_attack};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_f175_attack().await?;

    // @attack
    let result = async {
        let stream_publication = fixture
            .coordinator
            .prepare_anonymous_publication()
            .map_err(|error| format!("engine B stream publication refused: {error:?}"))?;
        let original = fixture
            .engine
            .prepare_pending_effect_service_original(
                fixture
                    .approval
                    .as_ref()
                    .ok_or_else(|| "F175 approval was already consumed".to_owned())?,
                fixture.resolution.clone(),
                stream_publication,
                fixture.now_ms,
            )
            .map_err(|error| format!("engine B refused engine A's service carrier: {error:?}"))?;
        let approval = fixture
            .approval
            .take()
            .ok_or_else(|| "F175 approval was already consumed".to_owned())?;
        let dispatch = fixture
            .engine
            .approve_pending_effect(approval, original, None, fixture.now_ms + 1)
            .map_err(|error| format!("engine B durable approval refused: {error:?}"))?;
        let (record, _, _) = dispatch.into_parts();

        #[cfg(feature = "additive")]
        {
            let synthetic = snapback_engine::local::ResolvedServiceAuthority::synthetic_for_test(
                fixture.resolution.resolved().clone(),
                fixture.resolution.publication().clone(),
            );
            let stream_publication = fixture
                .coordinator
                .prepare_anonymous_publication()
                .map_err(|error| format!("additive stream publication refused: {error:?}"))?;
            let synthetic_original = fixture
                .engine
                .prepare_pending_effect_service_original(
                    fixture
                        .synthetic_approval
                        .as_ref()
                        .ok_or_else(|| "synthetic approval was already consumed".to_owned())?,
                    synthetic,
                    stream_publication,
                    fixture.now_ms + 9,
                )
                .map_err(|error| format!("synthetic carrier refused: {error:?}"))?;
            let synthetic_approval = fixture
                .synthetic_approval
                .take()
                .ok_or_else(|| "synthetic approval was already consumed".to_owned())?;
            fixture
                .engine
                .approve_pending_effect(
                    synthetic_approval,
                    synthetic_original,
                    None,
                    fixture.now_ms + 10,
                )
                .map_err(|error| format!("synthetic durable approval refused: {error:?}"))?;
        }

        Ok(format!(
            "engine B accepted engine A carrier; effect={} status={:?}",
            record.id, record.status
        ))
    }
    .await;

    report_observation("F175", result);
    Ok(())
}
