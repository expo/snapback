use snapback_sync::auth::service_fence::ServiceAuthorityFenceRegistry;
use snapback_kernel::storage::auth_agent_credentials::DurablyResolvedServiceAuthority;
use snapback_sync::auth::invocation::PreparedAuthority;
use std::time::Instant;

fn substitute(
    prepared_for_another_service: PreparedAuthority,
    durable_from_one_database: DurablyResolvedServiceAuthority,
) {
    // @attack
    let detached_registry = ServiceAuthorityFenceRegistry::default();
    let detached_publication = detached_registry
        .register_resolved(&durable_from_one_database, 1, Instant::now())
        .unwrap();
    let _ = prepared_for_another_service.with_service_publication(detached_publication);
}

fn main() {
    let _ = substitute;
}
