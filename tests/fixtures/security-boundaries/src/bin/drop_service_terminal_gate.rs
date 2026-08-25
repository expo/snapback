use snapback_sync::auth::service_fence::{
    ServiceAuthorityFenceRegistry, ServiceAuthorityPublication,
};
use snapback_sync::auth::service_authority_contract::ServiceAuthorityDisposition;

async fn drop_without_settlement(
    registry: ServiceAuthorityFenceRegistry,
    publication: ServiceAuthorityPublication,
) {
    // @attack
    let gate = registry
        .acquire_terminal_gate(
            &["caller-selected-token".to_owned()],
            ServiceAuthorityDisposition::Carrier,
        )
        .await
        .unwrap();
    drop(gate);
    let _still_current = publication;
}

fn main() {
    let _ = drop_without_settlement;
}
