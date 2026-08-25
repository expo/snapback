use snapback_auth::auth::invalidation::LiveInvalidationIssuer;

fn attack(issuer: LiveInvalidationIssuer) {
    // @attack
    let _ = issuer.clone();
}

fn main() {}
