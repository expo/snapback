use snapback_kernel::storage::auth_integrations::IntegrationStatus;
use snapback_kernel::storage::watches::WatchAnchorAuthority;

fn main() {
    // @attack
    let _authority = WatchAnchorAuthority {
        actor_user_id: "forged-actor".to_owned(),
        effective_user_id: "forged-user".to_owned(),
        grant_id: "forged-grant".to_owned(),
        scopes: Vec::new(),
        expires_at_ms: u64::MAX,
        integration_status: IntegrationStatus::Active,
    };
}
