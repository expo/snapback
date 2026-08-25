use snapback_sync::auth::service_fence::ServiceAuthorityWitness;

fn accept_witness(_: ServiceAuthorityWitness) {}

fn main() {
    // @attack
    accept_witness(ServiceAuthorityWitness {
        token_id: "forged-token".to_owned(),
        grant_id: "forged-grant".to_owned(),
        actor_user_id: "forged-agent".to_owned(),
        effective_user_id: Some("forged-user".to_owned()),
        credential_id: "forged-credential".to_owned(),
        credential_generation: 1,
        expires_at_ms: u64::MAX,
        grant_expires_at_ms: None,
    });
}
