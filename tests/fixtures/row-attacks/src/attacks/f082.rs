use snapback_auth::auth::invalidation::{ObligationRegistry, ScopeId};
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::local::live_protocol::LiveUnsubscribeOutput;

fn publish_retirement_without_committing(registry: &ObligationRegistry, scope: &ScopeId) {
    // @attack
    let output = {
        let (_candidate, retirement) = registry
            .prepare_scope_retirement_authenticated(scope)
            .expect("the public preparation signs a retirement");
        let retirement = retirement.expect("the last live blocker yields a retirement proof");
        assert!(
            registry.preview_scope_retirement(scope).is_some(),
            "preparation returned a proof while the scope was still live"
        );
        LiveUnsubscribeOutput {
            subscription_id: "attacker-selected-subscription".to_owned(),
            disposed: true,
            receipt: None,
            scope_retirement: Some(retirement),
        }
    };
    let _client_visible_wire = serde_json::to_value(output).expect("serialize usable proof");
}

fn main() {
    let _ = publish_retirement_without_committing;
    report_observation(
        "F082",
        Ok("dependent can publish a usable authenticated retirement while the registry still previews the live scope".to_owned()),
    );
}
