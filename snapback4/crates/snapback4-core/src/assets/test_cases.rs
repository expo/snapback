//! Adapter-neutral upload-ledger cases; Postgres can reuse these in P1.
use super::*;

pub(crate) fn reader_is_owner_scoped(reader: &impl AssetIntentReader) {
    assert!(reader.asset_intent_exists("alice", "declared").unwrap());
    assert!(!reader.asset_intent_exists("bob", "declared").unwrap());
    assert!(!reader.asset_intent_exists("alice", "missing").unwrap());
}

/// The adapter seeds alice's declaration and asset `upload` before calling.
pub(crate) fn declarations_and_tombstones(tx: &impl AssetTransaction) {
    reader_is_owner_scoped(tx);
    let declared = tx.intent_declaration("alice", "declared").unwrap().unwrap();
    assert_eq!(declared.fingerprint.as_deref(), Some("original"));
    assert_eq!(declared.placement.as_deref(), Some("{}"));
    assert_eq!(declared.state, "declared");
    assert!(tx.intent_declaration("bob", "declared").unwrap().is_none());
    assert!(tx.intent_placement("bob", "declared").unwrap().is_none());
    assert!(
        replay_intent(tx, "alice", "declared", "original")
            .unwrap()
            .is_none()
    );
    tx.record_uploaded_intent(&UploadedIntent {
        owner: "alice",
        id: "declared",
        fingerprint: "replacement",
        asset: "upload",
        facts: "{}",
        placement: Some("replacement"),
    })
    .unwrap();
    let pending = tx.intent_declaration("alice", "declared").unwrap().unwrap();
    assert_eq!(pending.fingerprint, declared.fingerprint);
    assert_eq!(pending.placement, declared.placement);
    assert_eq!(pending.state, "pending");
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 10);
    tx.cancel_intent("alice", "declared").unwrap();
    tx.settle_intent("alice", "declared").unwrap();
    tx.record_uploaded_intent(&UploadedIntent {
        owner: "alice",
        id: "declared",
        fingerprint: "original",
        asset: "upload",
        facts: "{}",
        placement: None,
    })
    .unwrap();
    assert!(tx.intent_cancelled("alice", "declared").unwrap());
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
    assert!(tx.pending_intents("alice", "").unwrap().is_empty());
    assert_eq!(
        replay_intent(tx, "alice", "declared", "wrong")
            .unwrap_err()
            .refusal()
            .code,
        "E_UPLOAD_CANCELLED"
    );
    tx.cancel_intent("alice", "tombstone").unwrap();
    let tombstone = tx.intent_placement("alice", "tombstone").unwrap().unwrap();
    assert_eq!(tombstone.state, "cancelled");
    assert!(tombstone.placement.is_none());
    tx.declare_intent("bob", "settle", "fp", "{}").unwrap();
    tx.settle_intent("bob", "settle").unwrap();
    assert_eq!(
        tx.intent_placement("bob", "settle").unwrap().unwrap().state,
        "settled"
    );
    assert!(!tx.intent_cancelled("bob", "settle").unwrap());
}

/// Seed 52 `pNN` pending assets at 10 bytes each, plus excluded-state,
/// receipt, released, placed, missing-asset and other-owner fixtures.
pub(crate) fn quota_and_recovery(tx: &impl AssetTransaction) {
    // A released but still unplaced asset counts for quota, as in the old SQL;
    // recovery alone excludes it. A receipt from another owner excludes neither.
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 530);
    assert_eq!(tx.pinned_asset_bytes("bob").unwrap(), 10);
    let first = tx.pending_intents("alice", "").unwrap();
    assert_eq!(first.len(), 51);
    assert_eq!(first.first().unwrap().id, "p00");
    assert_eq!(first.last().unwrap().id, "p50");
    assert!(first.iter().all(|r| r.facts == "{}"));
    let tail = tx.pending_intents("alice", "p49").unwrap();
    assert_eq!(
        tail.into_iter().map(|r| r.id).collect::<Vec<_>>(),
        ["p50", "p51"]
    );
    assert!(tx.pending_intents("nobody", "").unwrap().is_empty());
    let ids = tx.asset_ids().unwrap();
    assert_eq!(ids.len(), 58);
    assert!(ids.contains(&"released".into()));
    assert!(ids.contains(&"placed".into()));
}
