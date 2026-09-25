use super::*;
use super::constraints::{args, row, source};

#[test]
fn readable_but_unwritable_targets_hide_expired_siblings_in_the_whole_reply() {
    readable_but_denied("update", &["patch", "put"]);
}

#[test]
fn readable_but_undeletable_targets_hide_expired_siblings_in_the_whole_reply() {
    readable_but_denied("delete", &["erase"]);
}

fn readable_but_denied(effect: &str, operations: &[&str]) {
    let source = format!("{}\nmutation patch(ordinal: int):\n  update messages[conversationId = 'chat', ordinal = ordinal] {{ at: 20 }}\nmutation erase(ordinal: int):\n  delete messages[conversationId = 'chat', ordinal = ordinal]\n", source("  cap 200000"))
        .replace("  ordinal: int", "  ordinal: int\n  reader: principal ?")
        .replace("  expire at .expiresAt\n  public", "  expire at .expiresAt\n  read <- .reader = viewer").replace("  sync public", "  online only")
        .replace(&format!("{effect} <- allow"), &format!("{effect} <- deny"));
    for &name in operations {
        let mut previous = None;
        for backlog in [0, 3_000] {
            let mut e = engine(&source, 0);
            let mut rows: Vec<_> = (0..backlog).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
            let mut live = row(&e, "z-live", 1, 1, json!(null));
            if let Value::Row(fields) = &mut live.1 { fields.insert("reader".into(), Value::Id("alice".into())); }
            rows.push(live);
            e.load(rows).unwrap();
            let before = e.store().rows("messages").unwrap();
            let read = e.query("message", Context::new("alice", BTreeMap::from([("conversationId".into(), Value::Id("chat".into())), ("ordinal".into(), Value::Int(1))])).at(100)).unwrap();
            assert_eq!(read.data.field("id"), Ok(&Value::Id("z-live".into())), "positive read control");
            let arguments = if name == "put" { args("z-live", 1, 20) } else { BTreeMap::from([("ordinal".into(), Value::Int(1))]) };
            let out = e.mutate(name, None, Context::new("alice", arguments).at(100)).unwrap();
            assert!(matches!(&out.state, WriteState::Failed { why, .. } if why.code == "E_RULE"), "{out:?}");
            assert_eq!(out.metered.examined, 0, "read authority does not permit charging hidden expiry work");
            assert_eq!(e.store().rows("messages").unwrap(), before);
            let whole = serde_json::to_value(out).unwrap();
            if let Some(previous) = previous.replace(whole.clone()) { assert_eq!(whole, previous, "{name}"); }
        }
    }
}

#[test]
fn denied_expiry_targets_have_identical_whole_replies_in_both_worlds() {
    let source = format!("{}\n{}", source("  cap 200000"), r#"
mutation patch(messageId: id, ordinal: int, at: time, expiresAt: time ?):
  update messages[conversationId = 'chat', ordinal = ordinal] { at }
mutation erase(messageId: id, ordinal: int, at: time, expiresAt: time ?):
  delete messages[conversationId = 'chat', ordinal = ordinal]
mutation eraseId(messageId: id, ordinal: int, at: time, expiresAt: time ?):
  delete messages[messageId]
"#).replace("  public", "  read <- deny").replace("  sync public", "  online only")
        .replace("insert <- allow", "insert <- deny").replace("update <- allow", "update <- deny")
        .replace("delete <- allow", "delete <- deny");
    for name in ["patch", "put", "putId", "quiet", "erase", "eraseId"] {
        let mut replies = Vec::new();
        for backlog in [0, 3_000] {
            let mut e = engine(&source, 0);
            let rows: Vec<_> = (0..backlog).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
            e.load(rows).unwrap();
            let out = e.mutate(name, None, Context::new("alice", args("old00000", 1, 20)).at(100).with_ids(["new".into()])).unwrap();
            let WriteState::Failed { why, .. } = out.state else { panic!("{name}: {out:?}") };
            assert_ne!(why.code, "E_BOUND", "{name}, backlog={backlog}: {why:?}");
            replies.push(json!({"refusal": why, "meter": out.metered}));
        }
        assert_eq!(replies[0], replies[1], "{name}: denied callers must not distinguish expired populations");
    }
}

#[test]
fn five_thousand_expired_siblings_charge_upsert_target_and_constraint_work() {
    let mut e = engine(&source("  cap 200000"), 0);
    let rows: Vec<_> = (0..5_000).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
    e.load(rows).unwrap();
    let out = e.mutate("put", None, Context::new("alice", args("new", 1, 20)).at(100).with_ids(["new".into()])).unwrap();
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{out:?}");
    assert_eq!(out.metered.examined, 0, "B2 physical exhaustion carries no hidden count");
    assert!(e.store_mut().transaction().unwrap().get("messages", "new").unwrap().is_none());
    assert_eq!(e.store().count("messages").unwrap(), 5_000);
}

#[test]
fn full_expiring_cap_defers_secondary_replacement_until_the_documented_sweep() {
    let mut e = engine(&source("  cap 1"), 0);
    let old = row(&e, "old", 1, 1, json!(10));
    e.load([old]).unwrap();
    let call = |e: &mut Engine| e.mutate("add", None, Context::new("alice", args("new", 1, 20)).at(100)).unwrap();
    let out = call(&mut e);
    assert!(matches!(out.state, WriteState::Sent { .. }), "B2 counts live occupants: {out:?}");
    assert!(e.store_mut().transaction().unwrap().get("messages", "old").unwrap().is_some());
    assert_eq!(e.sweep_expired(100, 2_000).unwrap(), 1);
    assert!(matches!(call(&mut e).state, WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"));
    assert!(e.store_mut().transaction().unwrap().get("messages", "old").unwrap().is_none());
}

#[test]
fn private_resolution_cut_cannot_turn_a_later_live_target_into_an_insert() {
    let mut e = engine(&source("  cap 200000"), 0);
    let mut rows: Vec<_> = (0..9_000).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
    rows.push(row(&e, "z-live", 1, 1, json!(null)));
    e.load(rows).unwrap();
    let out = e.mutate("put", None, Context::new("alice", args("new", 1, 20)).at(100).with_ids(["new".into()])).unwrap();
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_RULE"), "{out:?}");
    assert_eq!(out.metered.examined, 0, "B2 physical exhaustion carries no hidden count");
    assert_eq!(e.store().count("messages").unwrap(), 9_001);
    assert!(e.store_mut().transaction().unwrap().get("messages", "new").unwrap().is_none());
}

#[test]
fn authorized_update_and_delete_charge_their_expired_target_siblings() {
    let source = format!("{}\n{}", source("  cap 200000"), r#"
mutation patch(ordinal: int):
  update messages[conversationId = 'chat', ordinal = ordinal] { at: 20 }
mutation erase(ordinal: int):
  delete messages[conversationId = 'chat', ordinal = ordinal]
"#);
    for name in ["patch", "erase"] {
        let mut e = engine(&source, 0);
        let mut rows: Vec<_> = (0..3_000).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
        rows.push(row(&e, "z-live", 1, 1, json!(null)));
        e.load(rows).unwrap();
        let out = e.mutate(name, None, Context::new("alice", BTreeMap::from([("ordinal".into(), Value::Int(1))])).at(100)).unwrap();
        assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
        assert_eq!(out.metered.examined, 1, "only the authorized target is disclosed");
    }
}
