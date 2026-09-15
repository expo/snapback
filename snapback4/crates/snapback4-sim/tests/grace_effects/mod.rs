use super::*;
use snapback4_core::{Presence, Settled, Store};
use std::sync::Arc;

#[derive(Debug)]
struct Grace { live: u64, deadline: Option<i64> }
impl Presence for Grace {
    fn connections(&self, _: &str) -> u64 { self.live.max(u64::from(self.deadline.is_some())) }
    fn effect_presence(&self, _: &str) -> (u64, Option<i64>) { (self.live, self.deadline) }
}

const SOURCE: &str = "effect notify\neffect audit\nmutation push(p: principal):\n  if not exists connected[p]:\n    emit notify {recipient: p}\nquery online(p: principal):\n  return connected[p]\n";

fn build(source: &str, store: Store) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert_eq!(bound.schema.operations["push"].predicts.as_deref(), Some("eligible"));
    Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn send(engine: &mut Engine) {
    let sent = engine.mutate("push", Some("message"), Context::new("alice", args(&[("p", id("bob"))])).at(11_000)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
}

#[test]
fn grace_effects_live_absent_and_grace_have_distinct_admission() {
    for (live, deadline, count, due) in [(1, None, 0, false), (0, None, 1, true), (0, Some(36_000), 1, false)] {
        let mut engine = build(SOURCE, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live, deadline })));
        send(&mut engine);
        let queued = engine.effects(None, 10).unwrap();
        assert_eq!(queued.len(), count);
        assert_eq!(engine.effects_due(None, 11_000).unwrap(), due);
        if count == 1 { assert_eq!(queued[0].next_at, deadline); }
        // Grace still answers connected to an ordinary query.
        let online = engine.query("online", Context::new("alice", args(&[("p", id("bob"))])).at(11_000)).unwrap();
        assert_eq!(online.data, Value::Int(if live > 0 || deadline.is_some() { 1 } else { 0 }));
    }
}

#[test]
fn grace_effects_deadline_and_replay_deliver_once() {
    let mut engine = build(SOURCE, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
    send(&mut engine);
    assert!(engine.mutate("push", Some("message"), Context::new("alice", BTreeMap::new()).at(12_000)).unwrap().replayed);
    assert!(engine.claim_effects("worker", None, 10, 60_000, 35_999).unwrap().is_empty());
    engine.set_presence(None);
    let claimed = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].attempts, 1);
    assert!(engine.claim_effects("other", None, 10, 60_000, 36_000).unwrap().is_empty());
    engine.settle_effect(&claimed[0].id, "worker", Settled::Done { result: None }, 36_001).unwrap();
    assert!(engine.claim_effects("worker", None, 10, 60_000, 100_000).unwrap().is_empty());
    println!("grace boundary: remaining_ms=25000 early_claims=0 delivered=1 duplicate_claims=0");
}

#[test]
fn grace_effects_reconnect_and_restart_preserve_the_decision() {
    for (label, reconnect_at, live_at_claim, delivered) in [
        ("absent", None, false, 1), ("window", Some(20_000), false, 0),
        ("live", None, true, 0), ("late-ended", Some(40_000), false, 1),
    ] {
        let path = std::env::temp_dir().join(format!("sb4-grace-{}-{label}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        let file = path.join("store.sqlite");
        let mut engine = build(SOURCE, Store::open(&file).unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
        send(&mut engine);
        if let Some(at) = reconnect_at { engine.presence_reconnected("bob", at).unwrap(); }
        drop(engine);
        let mut engine = Engine::open(Store::open(&file).unwrap()).unwrap();
        assert_eq!(engine.effects(None, 10).unwrap()[0].next_at, Some(36_000));
        if live_at_claim { engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: None }))); }
        let claimed = engine.claim_effects("worker", None, 10, 60_000, 50_000).unwrap();
        assert_eq!(claimed.len(), delivered, "{label}");
        if delivered == 0 {
            let run = engine.effects(Some("satisfied"), 10).unwrap().remove(0);
            assert_eq!(run.result.unwrap().field("outcome").unwrap().as_str().unwrap(), "presence_reconnected");
            assert_eq!(run.attempts, 0);
        } else { engine.settle_effect(&claimed[0].id, "worker", Settled::Done { result: None }, 50_001).unwrap(); }
        drop(engine);
        let mut engine = Engine::open(Store::open(&file).unwrap()).unwrap();
        assert!(engine.claim_effects("worker", None, 10, 60_000, 200_000).unwrap().is_empty());
        drop(engine);
        std::fs::remove_dir_all(path).unwrap();
        println!("grace restart: case={label} restarts=2 delivered={delivered}");
    }
}

#[test]
fn grace_effects_aliases_short_circuit_and_unrelated_emits_keep_ownership() {
    for guard in ["  online = exists connected[p]\n  send = p != viewer and not online\n  if send:", "  if not (exists connected[p] and p != viewer):"] {
        let source = SOURCE.replace("  if not exists connected[p]:", guard);
        let source = source.replace("    emit notify {recipient: p}", "    emit notify {recipient: p}\n  emit audit {recipient: p}");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
        send(&mut engine);
        let queued = engine.effects(None, 10).unwrap();
        assert_eq!(queued.len(), 2);
        assert_eq!(queued.iter().find(|e| e.effect == "notify").unwrap().next_at, Some(36_000));
        assert_eq!(queued.iter().find(|e| e.effect == "audit").unwrap().next_at, None);
        let immediate = engine.claim_effects("worker", None, 10, 60_000, 11_000).unwrap();
        assert_eq!(immediate.len(), 1);
        assert_eq!(immediate[0].effect, "audit");
        engine.presence_reconnected("bob", 12_000).unwrap();
        assert!(engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap().is_empty());
        assert_eq!(engine.effect_counts().unwrap().get("satisfied"), Some(&1));
    }
}

#[test]
fn grace_effects_first_claim_consumes_presence_and_retries_keep_the_same_effect() {
    let mut engine = build(SOURCE, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
    send(&mut engine);
    engine.set_presence(None);
    let first = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap().remove(0);
    engine.presence_reconnected("bob", 36_001).unwrap();
    engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: None })));
    engine.settle_effect(&first.id, "worker", Settled::Failed { error: "retry".into(), retry: true }, 36_001).unwrap();
    let retry = engine.claim_effects("worker", None, 10, 60_000, 40_001).unwrap().remove(0);
    assert_eq!(retry.id, first.id);
    assert_eq!(retry.attempts, 2);
}

#[test]
fn grace_effects_clique_send_keeps_each_recipients_push_separate() {
    let mut engine = effects_engine();
    engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
    let sent = engine.mutate("send", Some("message"), Context::new("dev:alice", args(&[("conversationId", id("c1")), ("body", Value::String("hello".into()))])).at(11_000).with_ids(["msg".into()])).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
    assert_eq!(engine.store().rows("messages").unwrap().len(), 1);
    let queued = engine.effects(None, 10).unwrap();
    assert_eq!(queued.len(), 2);
    assert!(queued.iter().all(|e| e.next_at == Some(36_000)));
    engine.presence_reconnected("dev:bob", 20_000).unwrap();
    engine.set_presence(None);
    let claimed = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].payload.field("targetUserId").unwrap(), &id("dev:carol"));
    assert_eq!(engine.effects(Some("satisfied"), 10).unwrap()[0].payload.field("targetUserId").unwrap(), &id("dev:bob"));
    println!("grace Clique: message_rows=1 recipients=2 delivered=1 satisfied=1");
}
