use snapback_kernel::storage::AuthorizationExpectationView;

fn main() {
    // @attack
    let _ = AuthorizationExpectationView {
        registry: panic!("compile-only private registry"),
        registry_generation: 1,
        activation: panic!("compile-only private activation"),
        issuer_incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".into(),
    };
}
