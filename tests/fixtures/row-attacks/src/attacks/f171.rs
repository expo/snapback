use snapback_auth::auth::admission::AdmissionController;
use snapback_row_attack_fixtures::{NOW, integration_facts, report_observation, setup_base_attack};
use snapback_sync::auth::invocation::{InvocationSource, WireAuthorityFields};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::contract_types::{AuthMode, ServerProfile};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_base_attack().await?;

    // @attack
    let result = (|| {
        let foreign_controller = AdmissionController::from_mode_state(&fixture.mode_state)
            .map_err(|error| format!("foreign controller refused: {error:?}"))?;
        let foreign_lease = foreign_controller
            .admit_for_mode(AuthMode::Sessions)
            .map_err(|error| format!("foreign lease refused: {error:?}"))?;
        let forged = fixture
            .engine
            .prepare_bearer_authority(
                fixture.route_authority.clone(),
                InvocationSource::AgentGrantManagement,
                AuthMode::Sessions,
                ServerProfile::Test,
                foreign_lease.clone(),
                &WireAuthorityFields::default(),
                NOW,
            )
            .map_err(|error| format!("foreign authority producer refused: {error:?}"))?;
        let credential = fixture
            .engine
            .register_oauth_client(
                &foreign_lease,
                None,
                Some("cross-engine client".to_owned()),
                integration_facts(),
                ServerProfile::Test,
                NOW + 10,
                &OsRandom,
            )
            .map_err(|error| format!("client prerequisite refused: {error:?}"))?;
        let client_id = fixture
            .engine
            .integration_record_if_present(&credential.user_id)
            .map_err(|error| format!("integration readback failed: {error:?}"))?
            .ok_or_else(|| "integration readback was absent".to_owned())?
            .integration_id;
        let begun = fixture
            .engine
            .begin_oauth_authorization(
                &forged,
                &client_id,
                "https://attacker.example/callback",
                &["read".to_owned()],
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                Some("state"),
                NOW + 20,
                &OsRandom,
            )
            .map_err(|error| format!("OAuth consent request refused: {error:?}"))?;
        Ok(format!(
            "forged authority created request {}",
            begun.request_id
        ))
    })();

    report_observation("F171", result);
    Ok(())
}
