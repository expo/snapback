//! One upload-ledger contract exercised by SQLite and Postgres.
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
    upload(tx, "alice", "declared", "absent", "changed");
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 10);
    assert_eq!(
        tx.replay_record("alice", "declared")
            .unwrap()
            .unwrap()
            .facts
            .as_deref(),
        Some("{}")
    );
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
    upload(tx, "bob", "settle", "upload", "{}");
    let settled = tx.replay_record("bob", "settle").unwrap().unwrap();
    assert_eq!(settled.state, "settled");
    assert!(settled.facts.is_none());
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

/// Only test-fixture capabilities beyond the production intent port. Both
/// adapters delegate these calls to their ordinary ledger operations.
pub(crate) trait Ledger: AssetTransaction {
    fn record(&self, asset: &Asset) -> Result<(), RuntimeError>;
    fn release(
        &self,
        id: &str,
        table: &str,
        row: &str,
        column: &str,
        now: i64,
    ) -> Result<(), RuntimeError>;
    fn viewed(&self, id: &str, principal: &str) -> Result<bool, RuntimeError>;
    fn view(&self, id: &str, principal: &str, now: i64) -> Result<(), RuntimeError>;
    fn view_at(&self, id: &str, principal: &str) -> Option<i64>;
    fn stale(&self, now: i64) -> Vec<Asset>;
    fn stage(&self, now: i64, budget: std::time::Duration) -> Vec<Asset>;
    fn forget(&self, id: &str);
    fn executed(&self, owner: &str, id: &str);
}

pub(crate) fn asset(id: &str) -> Asset {
    Asset {
        id: id.into(),
        owner: "alice".into(),
        kind: AssetKind::File,
        content_type: "application/pdf".into(),
        bytes: 10,
        width: None,
        height: None,
        duration: None,
        created_at: 1,
        home: None,
        released_at: None,
        name: None,
    }
}

pub(crate) fn upload(tx: &impl AssetTransaction, owner: &str, id: &str, asset: &str, facts: &str) {
    tx.record_uploaded_intent(&UploadedIntent {
        owner,
        id,
        asset,
        fingerprint: "fp",
        facts,
        placement: None,
    })
    .unwrap();
}

pub(crate) fn seed_quota_recovery(tx: &impl Ledger) {
    for id in (0..52).map(|n| format!("p{n:02}")).chain(
        [
            "cancelled",
            "settled",
            "executed",
            "released",
            "placed",
            "other",
        ]
        .map(String::from),
    ) {
        tx.record(&asset(&id)).unwrap();
        upload(
            tx,
            if id == "other" { "bob" } else { "alice" },
            &id,
            &id,
            "{}",
        );
    }
    tx.cancel_intent("alice", "cancelled").unwrap();
    tx.settle_intent("alice", "settled").unwrap();
    tx.place_asset("released", "docs", "row", "doc").unwrap();
    tx.release("released", "docs", "row", "doc", 2).unwrap();
    tx.place_asset("placed", "docs", "row", "doc").unwrap();
    tx.executed("alice", "executed");
    tx.executed("bob", "p00");
    upload(tx, "alice", "missing", "absent", "{}");
}

pub(crate) fn exact_quota_and_wide_integers(tx: &impl Ledger) {
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
    for id in ["left", "right"] {
        let mut a = asset(id);
        a.bytes = 64 << 20;
        a.created_at = i64::MIN;
        tx.record(&a).unwrap();
        upload(tx, "alice", id, id, "{}");
    }
    let exact = tx.pinned_asset_bytes("alice").unwrap();
    assert_eq!(exact, 128 << 20);
    require_upload_quota(exact, 0).unwrap();
    assert_eq!(
        require_upload_quota(exact, 1).unwrap_err().code(),
        "E_UPLOAD_QUOTA"
    );
    require_upload_quota(exact - 1, 1).unwrap();
    assert_eq!(
        require_upload_quota(exact - 1, 2).unwrap_err().code(),
        "E_UPLOAD_QUOTA"
    );
    tx.cancel_intent("alice", "left").unwrap();
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 64 << 20);
    tx.settle_intent("alice", "right").unwrap();
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 0);
    // Both above 2^53 and at the signed BIGINT edge: no f64 rounding or i32 truncation.
    for (owner, bytes) in [("wide", (1_u64 << 53) + 17), ("edge", i64::MAX as u64)] {
        let mut a = asset(owner);
        a.bytes = bytes;
        a.created_at = i64::MAX;
        a.width = Some(u32::MAX);
        a.height = Some(0);
        a.duration = Some((1 << 53) + 3);
        a.name = Some("Résumé.pdf".into());
        tx.record(&a).unwrap();
        upload(tx, owner, owner, owner, "{}");
        assert_eq!(tx.asset(owner).unwrap(), Some(a));
        assert_eq!(tx.pinned_asset_bytes(owner).unwrap(), bytes as i64);
        assert_eq!(
            require_upload_quota(bytes as i64, 1).unwrap_err().code(),
            "E_UPLOAD_QUOTA"
        );
    }
    assert_eq!(
        require_upload_quota(i64::MAX, u64::MAX).unwrap_err().code(),
        "E_UPLOAD_QUOTA"
    );
}

pub(crate) fn aggregate_overflow_is_terminal(tx: &impl Ledger) {
    for (id, bytes) in [("max", i64::MAX as u64), ("one", 1)] {
        let mut a = asset(id);
        a.bytes = bytes;
        tx.record(&a).unwrap();
        upload(tx, "alice", id, id, "{}");
    }
    assert!(tx.pinned_asset_bytes("alice").is_err());
    // The harness drops/rolls back immediately; SQLite must not continue after
    // its SUM error simply because its connection still permits statements.
}

pub(crate) fn inventory_byte_order(tx: &impl Ledger) {
    let mut ids: Vec<_> = (0..60).map(|n| format!("k{n:02}")).collect();
    ids.extend(["A", "a", "a' OR true --", "é", "😀"].map(String::from));
    ids.sort();
    for id in ids.iter().rev() {
        tx.record(&asset(id)).unwrap();
        upload(tx, "alice", id, id, "{}");
    }
    let page = tx.pending_intents("alice", "").unwrap();
    assert_eq!(
        page.iter().map(|r| &r.id).collect::<Vec<_>>(),
        ids[..51].iter().collect::<Vec<_>>()
    );
    let next = tx.pending_intents("alice", &page[49].id).unwrap();
    assert_eq!(
        next.iter().map(|r| &r.id).collect::<Vec<_>>(),
        ids[50..].iter().collect::<Vec<_>>()
    );
    assert!(tx.pending_intents("alice", "😀").unwrap().is_empty());
    // Against NUL-free stored keys these bounds are equivalent on both stores.
    assert_eq!(
        tx.pending_intents("alice", "a\0cursor")
            .unwrap()
            .iter()
            .map(|r| &r.id)
            .collect::<Vec<_>>(),
        tx.pending_intents("alice", "a")
            .unwrap()
            .iter()
            .map(|r| &r.id)
            .collect::<Vec<_>>()
    );
    assert_eq!(tx.asset_ids().unwrap(), ids);
}

pub(crate) fn placement_and_replay(tx: &impl Ledger) {
    let a = asset("upload");
    tx.record(&a).unwrap();
    let facts = crate::json_codec::to_text(&a).unwrap();
    let binding = serde_json::json!({"op":"save","args":{"note":"a\0b"},"argument":"doc"});
    let encoded = crate::json_codec::to_text(&binding).unwrap();
    tx.declare_intent("alice", "intent", "fp", &encoded)
        .unwrap();
    assert_eq!(
        require_placement(tx, "alice", "intent", "save", &serde_json::json!({}))
            .unwrap_err()
            .code(),
        "E_UPLOAD_PENDING"
    );
    upload(tx, "alice", "intent", "upload", &facts);
    assert_eq!(
        replay_intent(tx, "alice", "intent", "fp").unwrap(),
        Some(a.clone())
    );
    assert_eq!(
        replay_intent(tx, "alice", "intent", "different")
            .unwrap_err()
            .code(),
        "E_ASSET_INTENT_REUSE"
    );
    let expected = serde_json::json!({"note":"a\0b","doc":{"id":"upload","type":"application/pdf","bytes":10,"width":null,"height":null,"duration":null}});
    require_placement(tx, "alice", "intent", "save", &expected).unwrap();
    assert_eq!(
        require_placement(tx, "alice", "intent", "changed", &expected)
            .unwrap_err()
            .code(),
        "E_ASSET_INTENT_REUSE"
    );
    let mut changed = expected.clone();
    changed["doc"]["bytes"] = 11.into();
    assert_eq!(
        require_placement(tx, "alice", "intent", "save", &changed)
            .unwrap_err()
            .code(),
        "E_ASSET_INTENT_REUSE"
    );
    assert_eq!(
        claim_asset(tx, "upload", "bob", "docs", "r", "doc")
            .unwrap_err()
            .code(),
        "E_ASSET_UNKNOWN"
    );
    claim_asset(tx, "upload", "alice", "docs", "r", "doc").unwrap();
    claim_asset(tx, "upload", "alice", "docs", "r", "doc").unwrap();
    assert_eq!(
        claim_asset(tx, "upload", "alice", "docs", "other", "doc")
            .unwrap_err()
            .code(),
        "E_ASSET_PLACED"
    );
    assert_eq!(
        claim_asset(tx, "absent", "alice", "docs", "r", "doc")
            .unwrap_err()
            .code(),
        "E_ASSET_UNKNOWN"
    );
    tx.release("upload", "docs", "wrong", "doc", 2).unwrap();
    assert!(tx.asset("upload").unwrap().unwrap().home.is_some());
    tx.release("upload", "docs", "r", "doc", i64::MAX).unwrap();
    let released = tx.asset("upload").unwrap().unwrap();
    assert_eq!(released.released_at, Some(i64::MAX));
    assert!(released.home.is_none());
    claim_asset(tx, "upload", crate::SYSTEM_PRINCIPAL, "docs", "new", "doc").unwrap();
    assert_eq!(tx.asset("upload").unwrap().unwrap().released_at, None);
    assert!(!tx.viewed("upload", "alice").unwrap());
    tx.view("upload", "alice", i64::MIN).unwrap();
    tx.view("upload", "alice", i64::MAX).unwrap();
    assert_eq!(tx.view_at("upload", "alice"), Some(i64::MIN));
    assert!(!tx.viewed("upload", "bob").unwrap());
    tx.forget("upload");
    tx.forget("upload");
    assert!(!tx.viewed("upload", "alice").unwrap());
    assert_eq!(
        replay_intent(tx, "alice", "intent", "fp")
            .unwrap_err()
            .code(),
        "E_ASSET_INTENT_EXPIRED"
    );
    assert!(tx.asset_intent_exists("alice", "intent").unwrap());
    tx.executed("alice", "executed");
    assert_eq!(
        replay_intent(tx, "alice", "executed", "fp")
            .unwrap_err()
            .code(),
        "E_WRITE_ID_REUSE"
    );
    assert!(!tx.mutation_executed("bob", "executed").unwrap());
}

pub(crate) fn nulls_and_absence(tx: &impl Ledger) {
    assert!(tx.intent_declaration("alice", "absent").unwrap().is_none());
    assert!(tx.intent_placement("alice", "absent").unwrap().is_none());
    assert!(tx.replay_record("alice", "absent").unwrap().is_none());
    assert!(tx.placement_record("alice", "absent").unwrap().is_none());
    tx.cancel_intent("alice", "nulls").unwrap();
    let declaration = tx.intent_declaration("alice", "nulls").unwrap().unwrap();
    assert!(declaration.fingerprint.is_none());
    assert!(declaration.placement.is_none());
    let record = tx.replay_record("alice", "nulls").unwrap().unwrap();
    assert!(record.binding.is_none());
    assert!(record.facts.is_none());
    assert_eq!(record.state, "cancelled");
    assert!(
        tx.placement_record("alice", "nulls")
            .unwrap()
            .unwrap()
            .binding
            .is_none()
    );
    tx.record(&asset("upload")).unwrap();
    upload(tx, "alice", "literal-null", "upload", "null");
    assert_eq!(
        tx.replay_record("alice", "literal-null")
            .unwrap()
            .unwrap()
            .facts
            .as_deref(),
        Some("null")
    );
    assert_eq!(
        require_placement(tx, "alice", "literal-null", "save", &serde_json::json!({}))
            .unwrap_err()
            .code(),
        "E_UPLOAD_INTENT"
    );
    let mut a = asset("upload");
    a.id = "ignored-home".into();
    a.home = Some(("t".into(), "r".into(), "c".into()));
    a.released_at = Some(1);
    tx.record(&a).unwrap();
    a.home = None;
    a.released_at = None;
    assert_eq!(tx.asset("ignored-home").unwrap(), Some(a));
    tx.settle_intent("alice", "absent").unwrap();
    assert!(!tx.asset_intent_exists("alice", "absent").unwrap());
}

pub(crate) fn missing_cancellation_state(tx: &impl AssetTransaction) {
    assert_eq!(
        tx.intent_cancelled("alice", "missing").unwrap_err().code(),
        "E_STORE"
    );
}

pub(crate) fn nul_admission(tx: &impl Ledger) {
    for (owner, id, fp) in [
        ("a\0b", "id", "fp"),
        ("alice", "i\0d", "fp"),
        ("alice", "id", "f\0p"),
    ] {
        assert_eq!(
            tx.declare_intent(owner, id, fp, "{}").unwrap_err().code(),
            "E_INPUT"
        );
    }
    for (owner, id, fp, asset_id) in [
        ("a\0b", "i", "fp", "a"),
        ("alice", "i\0d", "fp", "a"),
        ("alice", "i", "f\0p", "a"),
        ("alice", "i", "fp", "a\0b"),
    ] {
        assert_eq!(
            tx.record_uploaded_intent(&UploadedIntent {
                owner,
                id,
                fingerprint: fp,
                asset: asset_id,
                facts: "{}",
                placement: None
            })
            .unwrap_err()
            .code(),
            "E_INPUT"
        );
    }
    for (owner, id) in [("a\0b", "id"), ("alice", "i\0d")] {
        assert_eq!(tx.cancel_intent(owner, id).unwrap_err().code(), "E_INPUT");
        assert!(!tx.asset_intent_exists(owner, id).unwrap());
        assert!(tx.intent_declaration(owner, id).unwrap().is_none());
        assert!(tx.intent_placement(owner, id).unwrap().is_none());
        assert!(tx.replay_record(owner, id).unwrap().is_none());
        assert!(tx.placement_record(owner, id).unwrap().is_none());
        assert!(!tx.mutation_executed(owner, id).unwrap());
        tx.settle_intent(owner, id).unwrap();
    }
    for field in 0..4 {
        let mut a = asset("new");
        match field {
            0 => a.id = "a\0b".into(),
            1 => a.owner = "a\0b".into(),
            2 => a.content_type = "a\0b".into(),
            _ => a.name = Some("a\0b".into()),
        }
        assert_eq!(tx.record(&a).unwrap_err().code(), "E_INPUT");
    }
    tx.record(&asset("upload")).unwrap();
    for (table, row, column) in [("t\0x", "r", "c"), ("t", "r\0x", "c"), ("t", "r", "c\0x")] {
        assert_eq!(
            tx.place_asset("upload", table, row, column)
                .unwrap_err()
                .code(),
            "E_INPUT"
        );
    }
    assert_eq!(tx.view("upload", "a\0b", 1).unwrap_err().code(), "E_INPUT");
    assert_eq!(tx.asset_ids().unwrap(), ["upload"]);
    assert!(tx.asset("a\0b").unwrap().is_none());
    assert!(!tx.asset_reserved("a\0b").unwrap());
    assert!(!tx.viewed("a\0b", "alice").unwrap());
    // JSON carries a literal escaped NUL safely on both adapters.
    let a = asset("upload");
    let mut json = serde_json::to_value(&a).unwrap();
    json["name"] = "a\0b".into();
    let facts = crate::json_codec::to_text(&json).unwrap();
    upload(tx, "alice", "json", "upload", &facts);
    assert_eq!(
        replay_intent(tx, "alice", "json", "fp")
            .unwrap()
            .unwrap()
            .name
            .as_deref(),
        Some("a\0b")
    );
}

pub(crate) fn collection_bounds(tx: &impl Ledger) {
    let now = UNCLAIMED_TTL_MS + 100;
    for n in (0..258).rev() {
        let mut a = asset(&format!("s{n:03}"));
        a.created_at = if n == 257 { 0 } else { 1 };
        tx.record(&a).unwrap();
    }
    let a = asset("pin");
    tx.record(&a).unwrap();
    upload(tx, "alice", "pin", "pin", "{}");
    let mut a = asset("boundary");
    a.created_at = 100;
    tx.record(&a).unwrap();
    let a = asset("home");
    tx.record(&a).unwrap();
    tx.place_asset("home", "t", "r", "c").unwrap();
    let stale = tx.stale(now);
    assert_eq!(stale.len(), 256);
    assert_eq!(stale[0].id, "s257");
    assert_eq!(stale[1].id, "s000");
    assert_eq!(stale[255].id, "s254");
    let batch = tx.stage(now, std::time::Duration::ZERO);
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].id, "s257");
    assert!(tx.asset_reserved("s257").unwrap());
    assert_eq!(tx.asset("s257").unwrap().unwrap().released_at, Some(now));
    assert_eq!(
        claim_asset(tx, "s257", "alice", "t", "r", "c")
            .unwrap_err()
            .code(),
        "E_ASSET_UNKNOWN"
    );
    tx.forget("s257");
    assert!(!tx.asset_reserved("s257").unwrap());
    let batch = tx.stage(now, std::time::Duration::MAX);
    assert_eq!(batch.len(), 256);
    for a in batch {
        tx.forget(&a.id);
    }
    assert_eq!(
        tx.stale(now)
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        ["s256"]
    );
    tx.cancel_intent("alice", "pin").unwrap();
    assert_eq!(
        tx.stale(now)
            .iter()
            .map(|a| a.id.as_str())
            .collect::<Vec<_>>(),
        ["pin", "s256"]
    );
    let reserved = tx.stage(now, std::time::Duration::MAX);
    assert_eq!(reserved.len(), 2);
    assert!(tx.asset_reserved("pin").unwrap());
    // Forgetting a collected upload leaves its immutable cancellation receipt.
    tx.forget("pin");
    assert!(tx.intent_cancelled("alice", "pin").unwrap());
}

pub(crate) fn duplicate_declaration_is_terminal(tx: &impl AssetTransaction) {
    tx.declare_intent("alice", "duplicate", "fp", "{}").unwrap();
    assert!(tx.declare_intent("alice", "duplicate", "fp", "{}").is_err());
}

/// The holder/contender harness retains the physical fence before calling
/// this policy. Publication rechecks replay in the same adapter transaction.
pub(crate) fn race_step(tx: &impl Ledger, cancel: bool) -> bool {
    if cancel {
        tx.cancel_intent("alice", "race").unwrap();
        return false;
    }
    match replay_intent(tx, "alice", "race", "fp") {
        Err(e) => {
            assert_eq!(e.code(), "E_UPLOAD_CANCELLED");
            false
        }
        Ok(None) => {
            let a = asset("race-asset");
            let facts = crate::json_codec::to_text(&a).unwrap();
            require_upload_quota(tx.pinned_asset_bytes("alice").unwrap(), a.bytes).unwrap();
            upload(tx, "alice", "race", "race-asset", &facts);
            tx.record(&a).unwrap();
            true
        }
        other => panic!("unexpected race replay {other:?}"),
    }
}

pub(crate) fn partial_legacy_row(tx: &impl AssetTransaction) {
    let a = tx.asset("legacy").unwrap().unwrap();
    assert_eq!(a.kind, AssetKind::Image);
    assert_eq!(a.bytes, u64::MAX);
    assert_eq!(a.width, Some(u32::MAX));
    assert_eq!(a.height, None);
    assert_eq!(a.duration, Some(u64::MAX));
    assert!(a.home.is_none());
}

pub(crate) fn cached_read_contract(tx: &impl Ledger) {
    assert!(tx.asset("cached").unwrap().is_some());
    assert!(tx.asset_intent_exists("alice", "cached").unwrap());
    assert_eq!(
        tx.intent_declaration("alice", "cached")
            .unwrap()
            .unwrap()
            .state,
        "pending"
    );
    assert!(
        tx.intent_placement("alice", "cached")
            .unwrap()
            .unwrap()
            .placement
            .is_none()
    );
    assert_eq!(
        tx.replay_record("alice", "cached")
            .unwrap()
            .unwrap()
            .binding
            .as_deref(),
        Some("fp")
    );
    assert!(
        tx.placement_record("alice", "cached")
            .unwrap()
            .unwrap()
            .binding
            .is_none()
    );
    assert_eq!(tx.pending_intents("alice", "").unwrap().len(), 1);
    assert_eq!(tx.pinned_asset_bytes("alice").unwrap(), 10);
    assert_eq!(tx.asset_ids().unwrap(), ["cached"]);
    assert!(!tx.intent_cancelled("alice", "cached").unwrap());
    assert!(tx.viewed("cached", "alice").unwrap());
    assert!(!tx.asset_reserved("cached").unwrap());
    assert!(tx.stale(UNCLAIMED_TTL_MS + 2).is_empty());
}
