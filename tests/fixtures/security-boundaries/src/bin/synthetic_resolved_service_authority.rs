use snapback_sync::auth::service_fence::ServiceAuthorityPublication;
use snapback_engine::local::{LocalSnapback, ResolvedServiceAuthority};
use snapback_sync::auth::invocation::ResolvedAppAuthority;

fn forge(
    snapback: &mut LocalSnapback,
    resolved: ResolvedAppAuthority,
) {
    let binding = snapback_engine::test_support::auth_database_mut(snapback).binding();
    // @attack
    let publication = ServiceAuthorityPublication::synthetic_for_test("caller-token");
    let _ = ResolvedServiceAuthority::synthetic_for_test(binding, resolved, publication);
}

fn main() {
    let _ = forge;
}
