use snapback_auth::auth::invalidation::{IssuerId, QueryNamespace, ScopeRetirement};
use snapback_kernel::storage::AuthorizationVersion;
use snapback_sync::local::live_protocol::LiveResumeOutput;
use std::collections::BTreeMap;

fn main() {
    // Different producer from the marked F082 witness: rebuild the public
    // wire proof field by field, without preparing or committing a registry.
    let forged = ScopeRetirement {
        issuer_id: IssuerId {
            authorization_incarnation: "018f0d90-7b11-7a22-8c33-445566778899".to_owned(),
            boot_sequence: 7,
            boot_nonce: "ABCDEFGHIJKLMNOPQRSTUV".to_owned(),
        },
        namespace: QueryNamespace {
            client_store_id: "store-A".to_owned(),
            query_key: "todos:{}".to_owned(),
            query_instance_id: 19,
        },
        retire_through_scope_sequence: 9_007_199_254_740_991,
        authorization_expectation: AuthorizationVersion {
            incarnation: "018f0d90-7b11-7a22-8c33-445566778899".to_owned(),
            epoch: 4,
        },
        mac: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
    };

    // Different consumer from the marked unsubscribe-output witness: publish
    // through the resume response family used by the client retirement loop.
    // @attack
    let output = LiveResumeOutput {
        subscription_id: "attacker-selected-subscription".to_owned(),
        mode: "snapshot".to_owned(),
        reason: None,
        snapshot: None,
        permission_epochs: BTreeMap::new(),
        authorization_scope: None,
        authorization_invalidation: None,
        scope_retirements: vec![forged],
        attribution: None,
    };
    let wire = serde_json::to_value(output).expect("serialize rebuilt retirement publication");
    assert_eq!(
        wire["scopeRetirements"][0]["retireThroughScopeSequence"],
        9_007_199_254_740_991_u64,
    );
    println!("F082_ALTERNATE_SURVIVED rebuilt ScopeRetirement reached LiveResumeOutput");
}
