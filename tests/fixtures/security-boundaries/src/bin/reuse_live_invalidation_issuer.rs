use snapback_auth::auth::invalidation::{LiveInvalidationIssuer, ObligationRegistry};

fn attack(issuer: LiveInvalidationIssuer) {
    let _first = ObligationRegistry::new(issuer).unwrap();
    // @attack
    let _second = ObligationRegistry::new(issuer).unwrap();
}

fn main() {}
