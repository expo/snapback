use super::*;
use snapback4_core::rows::Rows;

pub(super) fn source(cap: &str) -> String {
    let mut source = SOURCE.replace("  cap 200000", cap);
    for (name, form) in [("add", "insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt }"),
        ("quiet", "insert messages { id: messageId, conversationId: 'chat', ordinal, at, expiresAt } if absent"),
        ("put", "upsert messages[conversationId = 'chat', ordinal = ordinal] { at, expiresAt }"),
        ("putId", "upsert messages[id = messageId] { conversationId: 'chat', ordinal, at, expiresAt }")] {
        source.push_str(&format!("\nmutation {name}(messageId: id, ordinal: int, at: time, expiresAt: time ?):\n  {form}\n"));
    }
    source
}

pub(super) fn args(id: &str, ordinal: i64, at: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([("messageId".into(), Value::Id(id.into())), ("ordinal".into(), Value::Int(ordinal)),
        ("at".into(), Value::Int(at)), ("expiresAt".into(), Value::Null)])
}

pub(super) fn row(e: &Engine, id: &str, ordinal: i64, at: i64, expiry: serde_json::Value) -> (String, Value) {
    ("messages".into(), wire::row_from_json(&e.schema().tables["messages"],
        &json!({"id":id,"conversationId":"chat","ordinal":ordinal,"at":at,"expiresAt":expiry})).unwrap())
}

fn physical(e: &mut Engine, id: &str) -> Option<Value> {
    e.store_mut().transaction().unwrap().get("messages", id).unwrap()
}

#[test]
fn expired_unique_keys_can_be_reused_and_background_sweep_removes_the_old_row() {
    for name in ["add", "quiet", "put", "putId"] {
        let mut e = engine(&source("  cap 2 by conversationId"), 0);
        let old = row(&e, "old", 1, 1, json!(10));
        e.load([old]).unwrap();
        let id = if name == "putId" { "old" } else { "new" };
        let out = e.mutate(name, None, Context::new("alice", args(id, 1, 20)).at(100).with_ids(["new".into()])).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{name}: {out:?}");
        assert_eq!(out.metered.rows_written, if name == "putId" { 2 } else { 1 });
        assert!(out.metered.examined >= 1 && out.metered.examined <= 3, "{name}: {out:?}");
        assert_eq!(e.store().count("messages").unwrap(), if name == "putId" { 1 } else { 2 });
        assert_eq!(e.sweep_expired(100, 2_000).unwrap(), if name == "putId" { 0 } else { 1 });
        assert_eq!(e.store().count("messages").unwrap(), 1);
        if name != "putId" { assert!(physical(&mut e, "old").is_none()); }
        let found = e.query("message", Context::new("alice", BTreeMap::from([
            ("conversationId".into(), Value::Id("chat".into())), ("ordinal".into(), Value::Int(1))])).at(100)).unwrap();
        assert_eq!(found.data.field("at"), Ok(&Value::Int(20)));
    }
}

#[test]
fn secondary_unique_checks_examine_only_their_full_key_collisions() {
    let source = source("  cap 200000").replace("  unique byConversationOrdinal:", "  unique byAt: at\n  unique byConversationOrdinal:");
    let mut e = engine(&source, 3_000);
    let rows = [row(&e, "by-at", 42, 20, json!(10)), row(&e, "by-ordinal", 1, 21, json!(10))];
    e.load(rows).unwrap();
    let out = e.mutate("add", None, Context::new("alice", args("new", 1, 20)).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
    assert_eq!(out.metered.examined, 2);
    assert_eq!(out.metered.rows_written, 1);
    assert!(physical(&mut e, "by-at").is_some());
    assert!(physical(&mut e, "by-ordinal").is_some());
    assert_eq!(e.store().count("messages").unwrap(), 3_003, "cleanup stays with the background sweep");
}

#[test]
fn expiry_caps_count_unswept_rows_until_the_sweep_for_table_and_group_caps() {
    for cap in ["  cap 1", "  cap 1 by conversationId"] {
        let mut e = engine(&source(cap), 0);
        let old = row(&e, "old", 1, 1, json!(10));
        e.load([old]).unwrap();
        let call = |e: &mut Engine| e.mutate("add", None, Context::new("alice", args("new", 2, 20)).at(100)).unwrap();
        let out = call(&mut e);
        assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"), "{cap}: {out:?}");
        assert_eq!(out.metered.examined, 0);
        assert_eq!(e.sweep_expired(100, 2_000).unwrap(), 1);
        assert!(matches!(call(&mut e).state, WriteState::Sent { .. }));
    }
}

#[test]
fn same_key_backlog_is_metered_for_insert_if_absent_and_upsert() {
    for name in ["add", "quiet", "put"] {
        for backlog in [3_000, 9_000] {
            let mut e = engine(&source("  cap 200000"), 0);
            let old: Vec<_> = (0..backlog).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
            e.load(old).unwrap();
            let out = e.mutate(name, None, Context::new("alice", args("new", 1, 20)).at(100).with_ids(["new".into()])).unwrap();
            if backlog == 3_000 {
                assert!(matches!(out.state, WriteState::Sent { .. }), "{name}: {out:?}");
                assert!(out.metered.examined >= 3_000 && out.metered.examined <= 6_001, "{name}: {out:?}");
            } else {
                assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{name}: {out:?}");
                assert_eq!(out.metered.examined, 8_193);
                assert!(physical(&mut e, "new").is_none());
                let tx = e.store_mut().transaction().unwrap();
                assert_eq!(tx.cap_count("messages", &[], &[]).unwrap(), backlog);
            }
        }
    }
}

#[test]
fn hidden_live_collision_and_denied_insert_keep_their_refusals() {
    let source = source("  cap 1").replace("  public", "  read <- deny").replace("  sync public", "  online only");
    let mut e = engine(&source, 0);
    let old = row(&e, "hidden", 1, 1, json!(null));
    e.load([old]).unwrap();
    let out = e.mutate("add", None, Context::new("alice", args("new", 1, 20)).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{out:?}");
    assert_eq!(e.store().count("messages").unwrap(), 1);
    let mut e = engine(&source.replace("insert <- allow", "insert <- deny"), 0);
    let old = row(&e, "expired", 1, 1, json!(10));
    e.load([old]).unwrap();
    let out = e.mutate("quiet", None, Context::new("alice", args("new", 1, 20)).at(100)).unwrap();
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"));
    assert!(physical(&mut e, "expired").is_some(), "authorization precedes cleanup");
}
