use snapback_auth::auth::admission::AdmissionController;
use snapback_kernel::storage::auth_grants::{ExactGrantScope, ScopedFunctionKind};
use snapback_row_attack_fixtures::{NOW, report_observation, setup_callback_authority_attack};
use snapback_sync::auth::invocation::InvocationGate;
use snapback_types::contract_types::AuthMode;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let mut fixture = setup_callback_authority_attack()?;
    let controller = AdmissionController::from_mode_state_with_database_binding(
        &fixture.mode_state,
        fixture.serving.binding(),
    )
    .map_err(|error| format!("controller: {error:?}"))?;
    let admission = controller
        .admit_for_mode(AuthMode::Sessions)
        .map_err(|error| format!("admission: {error:?}"))?;
    let principal = fixture
        .serving
        .ensure_asset_callbacks_service_principal(
            "dependent-selected-app",
            ExactGrantScope {
                function_id: "fn:dependent-selected-callback".to_owned(),
                kind: ScopedFunctionKind::Mutation,
                basis: 17,
                authority_creating: true,
            },
            NOW,
        )
        .map_err(|error| format!("principal: {error:?}"))?;

    // @attack
    let prepared = InvocationGate::prepare_admitted_asset_callbacks(admission, principal)
        .map_err(|error| format!("raw callback authority preparation: {error:?}"));

    report_observation(
        "F145",
        prepared.map(|_| {
            "dependent selected the app/function/scope and prepared callback authority outside LocalSnapback"
                .to_owned()
        }),
    );
    Ok(())
}
