use snapback_auth::auth::invalidation::{ObligationRegistry, ScopeId};
use snapback_sync::local::live_protocol::LiveUnsubscribeOutput;

fn attack(registry: &ObligationRegistry, scope: &ScopeId) {
    // @attack
    let _client_visible = {
        let (_candidate, retirement) = registry
            .prepare_scope_retirement_authenticated(scope)
            .unwrap();
        assert!(registry.preview_scope_retirement(scope).is_some());
        LiveUnsubscribeOutput {
            subscription_id: "attacker-selected-subscription".to_owned(),
            disposed: true,
            receipt: None,
            scope_retirement: retirement,
        }
    };
}

fn main() {}
