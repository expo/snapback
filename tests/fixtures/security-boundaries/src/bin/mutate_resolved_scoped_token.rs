use snapback_kernel::storage::auth_agent_credentials::ResolvedScopedToken;

fn mutate_resolved_scoped_token(mut token: ResolvedScopedToken) {
    // @attack
    token.actor_user_id = "forged-agent".to_owned();
}

fn main() {}
