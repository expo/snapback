use snapback_sync::auth::invocation::ResolvedAppAuthority;

fn main() {
    // @attack
    let _authority = ResolvedAppAuthority::ServicePrincipal {
        actor_user_id: "forged-agent".to_owned(),
        credential_id: "forged-credential".to_owned(),
        credential_generation: 1,
        grant_id: "forged-grant".to_owned(),
        token_id: "forged-token".to_owned(),
        effective_user_id: Some("victim-user".to_owned()),
        scopes: Vec::new(),
        token_expires_at_ms: u64::MAX,
        integration_status: None,
    };
}
