use snapback_auth::auth::admission::AdmissionController;
use snapback_kernel::storage::auth_grants::{GrantApproval, PairingPresentation};
use snapback_row_attack_fixtures::{
    NOW, exact_query_scope, integration_facts, report_observation, setup_base_attack,
};
use snapback_sync::auth::invocation::{InvocationSource, WireAuthorityFields};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::contract_types::{AgentsMode, AuthMode, ServerProfile};

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
                AgentsMode::Open,
                None,
                Some("cross-engine client".to_owned()),
                integration_facts(),
                ServerProfile::Test,
                NOW + 10,
                &OsRandom,
            )
            .map_err(|error| format!("client prerequisite refused: {error:?}"))?;
        let effect = forged
            .effect_guard("dependent witness pairing setup")
            .map_err(|error| format!("pairing guard refused: {error:?}"))?;
        let pairing = fixture
            .engine
            .mint_pairing_code(&effect, &fixture.victim_user_id, NOW + 30, &OsRandom)
            .map_err(|error| format!("pairing mint refused: {error:?}"))?;
        let presentation = fixture
            .engine
            .present_pairing_code(
                &effect,
                &credential.secret,
                &pairing.request_id,
                &pairing.secret,
                &[exact_query_scope()],
                NOW + 31,
            )
            .map_err(|error| format!("pairing presentation refused: {error:?}"))?;
        drop(effect);
        let request_id = match presentation {
            PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
                request.request_id
            }
        };
        let approval = fixture
            .engine
            .approve_grant_request(&forged, &request_id, None, None, NOW + 32)
            .map_err(|error| format!("grant approval refused: {error:?}"))?;
        let grant = match approval {
            GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
        };
        Ok(format!(
            "forged authority approved durable grant {} for {}",
            grant.grant_id, grant.effective_user_id
        ))
    })();

    report_observation("F188", result);
    Ok(())
}
