use snapback_row_attack_fixtures::{NOW, report_observation, setup_base_attack};

#[cfg(feature = "additive")]
use snapback_types::auth::crypto::{OsRandom, SessionBearer};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_base_attack().await?;

    // @attack
    let result = async {
        #[cfg(not(feature = "additive"))]
        {
            let plan = fixture
                .provider
                .admit()
                .await
                .record_authenticated_use_plan(
                    fixture.victim_session_id.clone(),
                    fixture.victim_session_generation,
                    NOW + 1,
                );
            let outcome = fixture
                .engine
                .execute_auth_plan(plan)
                .map_err(|error| format!("raw authenticated-use plan refused: {error:?}"))?;
            Ok(format!(
                "caller-selected session tuple reached authenticated use: {outcome:?}"
            ))
        }

        #[cfg(feature = "additive")]
        {
            let forged_bearer = SessionBearer::generate(&OsRandom)
                .map_err(|error| format!("forge bearer: {error:?}"))?;
            fixture
                .catalog
                .auth_catalog()
                .insert_session_tombstone_for_test(
                    forged_bearer.token_hash().as_bytes(),
                    &fixture.victim_session_id,
                    NOW,
                )
                .map_err(|error| format!("plant forged tombstone: {error:?}"))?;
            Ok(format!(
                "dependent planted fresh bearer digest as a tombstone for unrelated live session {}",
                fixture.victim_session_id
            ))
        }
    }
    .await;

    report_observation("F053", result);
    Ok(())
}
