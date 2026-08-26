use snapback_auth::auth::invalidation::{ObligationRegistry, ScopeId};
use snapback_row_attack_fixtures::report_observation;
use snapback_sync::local::live_protocol::LiveUnsubscribeOutput;

fn publish_retirement_without_committing(registry: &ObligationRegistry, scope: &ScopeId) {
    // @attack
    let output = {
        let prepared = registry
            .prepare_scope_retirement_authenticated(scope)
            .expect("the public preparation retains a private retirement");
        assert!(
            registry.preview_scope_retirement(scope).is_some(),
            "the target scope remains live before commit"
        );
        LiveUnsubscribeOutput {
            subscription_id: "attacker-selected-subscription".to_owned(),
            disposed: true,
            receipt: None,
            scope_retirement: Some(prepared),
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
