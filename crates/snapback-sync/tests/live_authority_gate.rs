use snapback_sync::live_coalesce::LiveFanoutCoalescer;
use snapback_types::storage::AuthorizationVersion;

#[test]
fn fenced_subscription_discards_predecessor_epoch_at_delivery() {
    let coalescer = LiveFanoutCoalescer::new();
    let evaluated_at_epoch_n_minus_one = AuthorizationVersion {
        incarnation: "incarnation-a".to_owned(),
        epoch: 7,
    };
    let fenced_at_epoch_n = AuthorizationVersion {
        incarnation: evaluated_at_epoch_n_minus_one.incarnation.clone(),
        epoch: 8,
    };

    coalescer.fence_authority("removed-member", fenced_at_epoch_n.clone());
    assert!(
        !coalescer.authorize_delivery("removed-member", &evaluated_at_epoch_n_minus_one),
        "a frame evaluated at epoch N-1 must not cross an epoch-N delivery fence",
    );
    assert!(
        coalescer.authority_is_stale("removed-member"),
        "discarding the predecessor frame must leave delivery fenced",
    );
    assert!(coalescer.authorize_delivery("removed-member", &fenced_at_epoch_n));
    assert!(
        !coalescer.authority_is_stale("removed-member"),
        "an exact epoch-N authority proof restores delivery",
    );
}
