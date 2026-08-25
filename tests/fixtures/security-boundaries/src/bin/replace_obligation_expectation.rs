use snapback_auth::auth::invalidation::{ObligationExpectation, ObligationRegistry};

fn attack(registry: &mut ObligationRegistry, supplied: ObligationExpectation) {
    // @attack
    let _ = registry.replace_authenticated_expectation(supplied);
}

fn main() {}
