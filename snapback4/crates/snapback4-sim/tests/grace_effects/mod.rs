use super::*;
mod unconfirmed;
mod review;
mod invariant;
#[path = "../common/presence_meter.rs"]
mod presence_meter;
use presence_meter::assert_i1;
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
    assert_eq!(bound.schema.operations["push"].predicts.as_deref(), Some("eligible"), "{:?}", bound.schema.operations["push"]);
    Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}

fn send(engine: &mut Engine) {
    let sent = engine.mutate("push", Some("message"), Context::new("alice", args(&[("p", id("bob"))])).at(11_000)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
}

#[test]
fn w15a_held_poll_records_a_deferred_effect() {
    let mut engine = build(SOURCE, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: Some(16_000) })));
    send(&mut engine);
    let queued = engine.effects(None, 10).unwrap();
    assert_eq!(queued.len(), 1, "a held poll is unconfirmed; the push must be durable at commit");
    assert_eq!(queued[0].next_at, Some(16_000));
    assert!(engine.claim_effects("worker", None, 10, 60_000, 15_999).unwrap().is_empty());
    let claimed = engine.claim_effects("worker", None, 10, 60_000, 16_000).unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].attempts, 1);
    assert!(engine.claim_effects("other", None, 10, 60_000, 16_000).unwrap().is_empty());
}

#[test]
fn w15a_open_poll_without_a_reconnect_record_does_not_satisfy() {
    let mut engine = build(SOURCE, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
    send(&mut engine);
    // No authenticated post-commit arrival was recorded for this effect.
    engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: None })));
    let claimed = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap();
    assert_eq!(claimed.len(), 1, "only the durable reconnect record can satisfy a push");
    assert_eq!(claimed[0].attempts, 1);
}

#[test]
fn w15a_fifty_members_write_one_effect_and_dependency_per_recipient() {
    let mut meters = Vec::new();
    for held in [false, true] {
        let mut engine = effects_engine();
        engine.seed((3..50).map(|n| ("memberships".into(), snapback4_core::value::object([
            ("id", id(&format!("member{n}"))), ("conversationId", id("c1")), ("principal", id(&format!("dev:recipient{n}"))),
        ])))).unwrap();
        let deadline = if held { 16_000 } else { 36_000 };
        engine.set_presence(Some(Arc::new(Grace { live: u64::from(held), deadline: Some(deadline) })));
        let sent = engine.mutate("send", Some("message"), Context::new("dev:alice", args(&[
            ("conversationId", id("c1")), ("body", Value::String("hello".into())),
        ])).at(11_000).with_ids(["msg".into()])).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
        let effects = engine.effects(None, 100).unwrap();
        let tx = engine.store_mut().read_transaction().unwrap();
        let dependencies: i64 = tx.conn().query_row("SELECT count(*) FROM _effect_presence", [], |row| row.get(0)).unwrap();
        tx.rollback().unwrap();
        println!("w15a cost: members=50 held={held} effects={} dependencies={dependencies} meter={:?}", effects.len(), sent.metered);
        assert_eq!((effects.len(), dependencies), (49, 49));
        let m = sent.metered;
        meters.push(unconfirmed::fields(m));
        assert_eq!([m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written], [52, 2, 4, 1356, 69718, 27, 1]);
        for effect in &effects {
            assert_eq!(effect.next_at, Some(deadline));
            let recipient = effect.payload.field("targetUserId").unwrap().as_str().unwrap();
            engine.presence_reconnected(recipient, 12_000).unwrap();
        }
        assert!(engine.claim_effects("worker", None, 100, 60_000, deadline).unwrap().is_empty());
        let satisfied = engine.effects(Some("satisfied"), 100).unwrap();
        assert_eq!(satisfied.len(), 49);
        assert!(satisfied.iter().all(|effect| effect.attempts == 0));
    }
    assert_i1("fifty/sim", meters[1], meters[0], [52, 2, 1, 1367, 69843, 27, 1]);
}

#[test]
fn grace_effects_live_absent_and_grace_have_distinct_admission() {
    for (live, deadline, count, due) in [(1, Some(16_000), 1, false), (0, None, 1, true), (0, Some(36_000), 1, false)] {
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
    // Replay keeps W7's one-effect behavior only for the same admitted input.
    // A1 binds the id to its arguments before it considers the new program.
    assert_eq!(engine.mutate("push", Some("message"), Context::new("alice", BTreeMap::new()).at(12_000)).unwrap_err().code(), "E_ID_REUSED");
    assert!(engine.mutate("push", Some("message"), Context::new("alice", args(&[("p", id("bob"))])).at(12_000)).unwrap().replayed);
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
        ("live", None, true, 1), ("late-ended", Some(40_000), false, 1),
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
    for (guard, deferred) in [("  online = exists connected[p]\n  send = p != viewer and not online\n  if send:", true), ("  if not (exists connected[p] and p != viewer):", false)] {
        let source = SOURCE.replace("  if not exists connected[p]:", guard);
        let source = source.replace("    emit notify {recipient: p}", "    emit notify {recipient: p}\n  emit audit {recipient: p}");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
        send(&mut engine);
        let queued = engine.effects(None, 10).unwrap();
        assert_eq!(queued.len(), 2);
        assert_eq!(queued.iter().find(|e| e.effect == "notify").unwrap().next_at, deferred.then_some(36_000), "{guard}");
        assert_eq!(queued.iter().find(|e| e.effect == "audit").unwrap().next_at, None);
        let immediate = engine.claim_effects("worker", None, 10, 60_000, 11_000).unwrap();
        assert_eq!(immediate.len(), if deferred { 1 } else { 2 });
        assert!(immediate.iter().any(|e| e.effect == "audit"));
        engine.presence_reconnected("bob", 12_000).unwrap();
        assert!(engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap().is_empty());
        assert_eq!(engine.effect_counts().unwrap().get("satisfied"), if deferred { Some(&1) } else { None });
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

#[test]
fn w7r1_heap_boundary_is_independent_of_grace() {
    let source = format!("{SOURCE}\ntable notes:\n  n: int\n  public 'test'\n  insert <- allow\nmutation post(p: principal):\n  insert notes {{n: 1}}\n  online = exists connected[p]\n  if not online:\n    emit notify {{recipient: p, online}}\n");
    let run = |grace: bool, ceiling| {
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: grace.then_some(36_000) })));
        engine.set_ceilings(snapback4_core::Ceilings { heap_bytes: ceiling, ..Default::default() });
        let sent = engine.mutate("post", None, Context::new("alice", args(&[("p", id("bob"))])).at(11_000).with_ids(["note".into()])).unwrap();
        (sent, engine.store().rows("notes").unwrap())
    };
    let minimum = |grace| {
        let (mut low,mut high)=(0,16 << 20);
        while low<high {
            let mid=(low+high)/2;
            if matches!(run(grace,mid).0.state,WriteState::Sent {..}) { high=mid; } else { low=mid+1; }
        }
        low
    };
    let absent = minimum(false);
    let grace = minimum(true);
    println!("w7r1 server heap: absent={absent} grace={grace}");
    let mut mismatches = Vec::new();
    for ceiling in [absent - 1, absent, grace - 1, grace] {
        let (a, ar) = run(false, ceiling);
        let (b, br) = run(true, ceiling);
        println!("w7r1 server ceiling={ceiling}: absent={:?} grace={:?}", a.state, b.state);
        if a.state != b.state || ar != br { mismatches.push(ceiling); }
        if ceiling >= absent.max(grace) { assert_eq!(ar.len(), 1); assert_eq!(br.len(), 1); }
    }
    assert!(mismatches.is_empty(), "grace changed mutation outcomes at {mismatches:?}");
}

#[test]
fn w7r1_payload_and_alternative_guards_do_not_cancel() {
    let mut failures = Vec::new();
    for (label, body) in [
        ("payload", "  emit audit {recipient: p, online: exists connected[p]}"),
        ("or-direct", "  if not exists connected[p] or force:\n    emit audit {recipient: p}"),
        ("or-force", "  online = exists connected[p]\n  if not online or force:\n    emit audit {recipient: p}"),
        ("negated-and", "  if not (exists connected[p] and force):\n    emit audit {recipient: p}"),
    ] {
        let source = format!("{SOURCE}\nmutation probe(p: principal, force: bool):\n{body}\n");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 0, deadline: Some(36_000) })));
        let sent = engine.mutate("probe", None, Context::new("alice", args(&[("p", id("bob")), ("force", Value::Bool(label != "negated-and"))])).at(11_000)).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
        engine.presence_reconnected("bob", 12_000).unwrap();
        engine.set_presence(None);
        let queued = engine.effects(None, 10).unwrap();
        let claimed = engine.claim_effects("worker", Some("audit"), 10, 60_000, 36_000).unwrap();
        println!("w7r1 {label}: next_at={:?} claimed={} satisfied={:?}", queued[0].next_at, claimed.len(), engine.effect_counts().unwrap().get("satisfied"));
        if queued[0].next_at.is_some() || claimed.len() != 1 { failures.push(label); }
        if let Some(effect) = claimed.first() { assert_eq!(effect.attempts, 1); }
    }
    assert!(failures.is_empty(), "unconditional effects cancelled: {failures:?}");
}

#[test]
fn w7r1_multiple_necessary_absences_respect_each_deadline() {
    #[derive(Debug)]
    struct Pair;
    impl Presence for Pair {
        fn connections(&self, _: &str) -> u64 { 1 }
        fn effect_presence(&self, p: &str) -> (u64, Option<i64>) { (0, Some(if p == "bob" { 20_000 } else { 36_000 })) }
    }
    for (who, at, cancelled) in [("bob", 19_999, true), ("bob", 20_001, false), ("carol", 25_000, true)] {
        let source = format!("{SOURCE}\nmutation both(p: principal, q: principal):\n  if not exists connected[p] and not exists connected[q]:\n    emit audit {{recipient: p}}\n");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Pair)));
        let sent = engine.mutate("both", None, Context::new("alice", args(&[("p", id("bob")), ("q", id("carol"))])).at(11_000)).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
        assert_eq!(engine.effects(None, 10).unwrap()[0].next_at, Some(36_000));
        engine.presence_reconnected(who, at).unwrap();
        assert!(engine.claim_effects("worker", None, 10, 60_000, 35_999).unwrap().is_empty());
        engine.set_presence(None);
        let claimed = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap();
        assert_eq!(claimed.len(), usize::from(!cancelled));
        if cancelled { assert_eq!(engine.effects(Some("satisfied"), 10).unwrap()[0].attempts, 0); }
    }
}

#[test]
fn w7r1_payload_dependency_cannot_extend_or_satisfy_an_absence_guard() {
    #[derive(Debug)]
    struct Pair;
    impl Presence for Pair {
        fn connections(&self, _: &str) -> u64 { 1 }
        fn effect_presence(&self, p: &str) -> (u64, Option<i64>) { (0, Some(if p == "bob" { 20_000 } else { 36_000 })) }
    }
    for (who, cancelled) in [("bob", true), ("carol", false)] {
        let source = format!("{SOURCE}\nmutation probe(p: principal, q: principal):\n  if not exists connected[p]:\n    emit audit {{recipient: p, otherOnline: exists connected[q]}}\n");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Pair)));
        let sent = engine.mutate("probe", None, Context::new("alice", args(&[("p", id("bob")), ("q", id("carol"))])).at(11_000)).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }));
        assert_eq!(engine.effects(None, 10).unwrap()[0].next_at, Some(20_000));
        engine.presence_reconnected(who, 19_000).unwrap();
        engine.set_presence(None);
        let claimed = engine.claim_effects("worker", None, 10, 60_000, 20_000).unwrap();
        assert_eq!(claimed.len(), usize::from(!cancelled));
        if cancelled { assert_eq!(engine.effects(Some("satisfied"), 10).unwrap()[0].attempts, 0); }
        else { assert_eq!(claimed[0].attempts, 1); }
    }
}
