use snapback_auth::auth::admission::AdmissionController;
use snapback_kernel::storage::auth_integrations::AgentRegistrationClass;
use snapback_row_attack_fixtures::{NOW, integration_facts, report_observation, setup_base_attack};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::contract_types::{AuthMode, ServerProfile};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_base_attack().await?;

    // Positive control: the target graph's own lease still registers and the
    // target engine observes the complete durable effect.
    let bindings = fixture
        .engine
        .claim_app_state_graph(
            ServerProfile::Test,
            snapback_types::auth::deployment::AuthDeploymentTarget::Local,
        )
        .map_err(|error| format!("claim target graph failed: {error:?}"))?;
    let (target_controller, _, _, _, _, _, _, _) = bindings
        .into_parts_for_app_state(&fixture.engine)
        .map_err(|error| format!("bind target graph failed: {error:?}"))?;
    let target_lease = target_controller
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|error| format!("target admission failed: {error:?}"))?;
    let legitimate = fixture
        .engine
        .register_oauth_client(
            &target_lease,
            None,
            Some("same-engine positive control".to_owned()),
            integration_facts(),
            ServerProfile::Test,
            NOW + 9,
            &OsRandom,
        )
        .map_err(|error| format!("same-engine registration failed: {error:?}"))?;
    fixture
        .engine
        .integration_record_if_present(&legitimate.user_id)
        .map_err(|error| format!("same-engine integration readback failed: {error:?}"))?
        .ok_or_else(|| "same-engine integration readback was absent".to_owned())?;

    // @attack
    let result = (|| {
        let foreign_controller = AdmissionController::from_mode_state(&fixture.mode_state)
            .map_err(|error| format!("foreign controller refused: {error:?}"))?;
        let foreign_lease = foreign_controller
            .admit_for_mode(AuthMode::Sessions)
            .map_err(|error| format!("foreign lease refused: {error:?}"))?;
        let foreign_refusal = match fixture.engine.register_oauth_client(
            &foreign_lease,
            None,
            Some("cross-engine client".to_owned()),
            integration_facts(),
            ServerProfile::Test,
            NOW + 10,
            &OsRandom,
        ) {
            Ok(credential) => {
                let client_id = fixture
                    .engine
                    .integration_record_if_present(&credential.user_id)
                    .map_err(|error| format!("foreign integration readback failed: {error:?}"))?
                    .ok_or_else(|| "foreign integration readback was absent".to_owned())?
                    .integration_id;
                return Ok(format!(
                    "foreign lease issued credential {} and durable client {client_id}",
                    credential.credential_id
                ));
            }
            Err(error) => format!("{error:?}"),
        };

        // The engine route is ownership-checked, but the same durable effect
        // remains reachable through a second public handle to its resource.
        let credential = fixture
            .catalog
            .register_agent_principal_with_class(
                None,
                Some("second-handle client".to_owned()),
                None,
                AgentRegistrationClass::Integration,
                integration_facts(),
                ServerProfile::Test,
                NOW + 11,
                &OsRandom,
            )
            .map_err(|error| format!("second-handle registration refused: {error:?}"))?;
        let client_id = fixture
            .engine
            .integration_record_if_present(&credential.user_id)
            .map_err(|error| format!("integration readback failed: {error:?}"))?
            .ok_or_else(|| "integration readback was absent".to_owned())?
            .integration_id;
        Ok(format!(
            "foreign lease refused ({foreign_refusal}); second handle issued credential {} and durable client {client_id}",
            credential.credential_id,
        ))
    })();

    report_observation("F170", result);
    Ok(())
}
