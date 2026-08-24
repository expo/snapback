use snapback_kernel::storage::auth_agent_credentials::ResolvedScopedToken;

fn main() {
    // @attack
    let _token = ResolvedScopedToken {
        token_id: "forged-token".to_owned(),
        grant_id: "forged-grant".to_owned(),
        actor_user_id: "forged-agent".to_owned(),
        effective_user_id: Some("victim-user".to_owned()),
        credential_id: "forged-credential".to_owned(),
        credential_generation: 1,
        scopes: Vec::new(),
        expires_at_ms: u64::MAX,
        grant_expires_at_ms: None,
        integration_status: None,
    };
}
