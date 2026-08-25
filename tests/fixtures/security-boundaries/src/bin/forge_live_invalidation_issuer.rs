use snapback_auth::auth::invalidation::{
    AuthenticatedBootIssuer, IssuerId, LiveInvalidationIssuer,
};

fn main() {
    let fake = AuthenticatedBootIssuer {
        issuer_id: IssuerId {
            authorization_incarnation: "0197f862-f196-7bb2-b3f0-2a67185dfd17".to_owned(),
            boot_sequence: 1_000,
            boot_nonce: "AQEBAQEBAQEBAQEBAQEBAQ".to_owned(),
        },
        key_id: "caller-key".to_owned(),
        mac: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE".to_owned(),
    };
    // @attack
    let _ = LiveInvalidationIssuer::new(fake);
}
