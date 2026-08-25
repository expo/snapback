use snapback_auth::auth::invalidation::ObligationRegistry;
use snapback_kernel::storage::AuthorizationVersion;

fn attack(registry: &mut ObligationRegistry, supplied: AuthorizationVersion) {
    // @attack
    let _ = registry.advance_authenticated_authorization(supplied);
}

fn main() {}
