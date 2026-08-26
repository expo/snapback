use snapback_auth::auth::admission::AdmissionController;
use snapback_kernel::storage::auth_grants::{GrantApproval, PairingPresentation};
use snapback_row_attack_fixtures::{
    NOW, exact_query_scope, integration_facts, report_observation, setup_base_attack,
};
use snapback_sync::auth::invocation::{InvocationSource, WireAuthorityFields};
use snapback_types::auth::crypto::OsRandom;
use snapback_types::contract_types::{AuthMode, ServerProfile};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_base_attack().await?;

    // @attack
    let result = async {
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
        let effect = forged
            .effect_guard("dependent witness pairing setup")
            .map_err(|error| format!("pairing guard refused: {error:?}"))?;
        let pairing = fixture
            .engine
            .mint_pairing_code(&effect, &fixture.victim_user_id, NOW + 38, &OsRandom)
            .map_err(|error| format!("pairing mint refused: {error:?}"))?;
        let presentation = fixture
            .engine
            .present_pairing_code(
                &effect,
                &credential.secret,
                &pairing.request_id,
                &pairing.secret,
                &[exact_query_scope()],
                NOW + 39,
            )
            .map_err(|error| format!("pairing presentation refused: {error:?}"))?;
        drop(effect);
        let request_id = match presentation {
            PairingPresentation::Created(request) | PairingPresentation::Existing(request) => {
                request.request_id
            }
        };
        let grant = match fixture
            .engine
            .approve_grant_request(&forged, &request_id, None, None, NOW + 40)
            .map_err(|error| format!("grant prerequisite refused: {error:?}"))?
        {
            GrantApproval::Created(grant) | GrantApproval::Existing(grant) => grant,
        };
        let token = fixture
            .engine
            .mint_scoped_token(
                &credential.secret,
                &grant.grant_id,
                Some(60_000),
                NOW + 41,
                &OsRandom,
            )
            .map_err(|error| format!("token prerequisite refused: {error:?}"))?;
        let plan = fixture
            .engine
            .plan_bulk_grant_revocation_service_terminal(&forged, &credential.user_id, NOW + 42)
            .map_err(|error| format!("bulk terminal planner refused: {error:?}"))?;
        if !plan.token_ids().contains(&token.token_id) {
            return Err("bulk planner omitted the controlled token".to_owned());
        }
        let gate = plan
            .acquire_gate()
            .await
            .map_err(|error| format!("bulk terminal gate refused: {error:?}"))?;
        snapback_auth::auth::service_fence::with_service_authority_terminal_gate(gate, || {
            fixture
                .engine
                .revoke_grants_by_actor_for_user(&forged, &credential.user_id, NOW + 43)
        })
        .map_err(|error| format!("bulk durable writer refused: {error:?}"))?;
        Ok(format!(
            "forged authority planned token {} and committed bulk revocation",
            token.token_id
        ))
    }
    .await;

    report_observation("F191", result);
    Ok(())
}
