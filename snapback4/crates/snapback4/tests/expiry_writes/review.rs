use super::*;
use super::constraints::{args, row, source};

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
        for backlog in [0, 9_000] {
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
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{out:?}");
    assert_eq!(out.metered.examined, 8_193);
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
    let WriteState::Failed { why, .. } = out.state else { panic!("{out:?}") };
    assert_eq!(why.code, "E_CONSTRAINT");
    assert!(why.site.is_some(), "{why:?}");
    let rewrite = why.rewrite.expect("expiry refusal names the sweep policy");
    assert!(rewrite.contains("1-second") && rewrite.contains("2,000"), "{rewrite}");
    assert!(e.store_mut().transaction().unwrap().get("messages", "old").unwrap().is_some());
    assert_eq!(e.sweep_expired(100, 2_000).unwrap(), 1);
    assert!(matches!(call(&mut e).state, WriteState::Sent { .. }));
    assert!(e.store_mut().transaction().unwrap().get("messages", "old").unwrap().is_none());
}

#[test]
fn private_resolution_cut_cannot_turn_a_later_live_target_into_an_insert() {
    let mut e = engine(&source("  cap 200000"), 0);
    let mut rows: Vec<_> = (0..9_000).map(|n| row(&e, &format!("old{n:05}"), 1, 1, json!(10))).collect();
    rows.push(row(&e, "z-live", 1, 1, json!(null)));
    e.load(rows).unwrap();
    let out = e.mutate("put", None, Context::new("alice", args("new", 1, 20)).at(100).with_ids(["new".into()])).unwrap();
    assert!(matches!(out.state, WriteState::Failed { ref why, .. } if why.code == "E_BOUND"), "{out:?}");
    assert_eq!(out.metered.examined, 8_193);
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
        assert_eq!(out.metered.examined, if name == "patch" { 6_003 } else { 3_001 });
    }
}
