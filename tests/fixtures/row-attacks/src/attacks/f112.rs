use snapback_auth::auth::service_authority_contract::ServiceAuthorityDisposition;
use snapback_auth::auth::service_fence::ServiceAuthorityFenceRegistry;
use snapback_row_attack_fixtures::report_observation;

async fn acquire_raw_terminal_gate(registry: &ServiceAuthorityFenceRegistry) {
    // @attack
    let _ = registry
        .acquire_terminal_gate(
            &["victim-token".to_owned()],
            ServiceAuthorityDisposition::DurableDelete,
        )
        .await;
}

fn main() {
    let _ = acquire_raw_terminal_gate;
    report_observation(
        "F112",
        Ok("dependent selected raw terminal token IDs and disposition".to_owned()),
    );
}
