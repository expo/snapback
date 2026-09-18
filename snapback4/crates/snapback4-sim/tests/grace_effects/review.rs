use super::*;
use std::time::{Duration, Instant};

fn alias_dag(operand: bool) {
    // Depth 24 is the bounded before/after measurement; never run the
    // exponential implementation at the default regression depth of 200.
    let depth = std::env::var("W15A_ALIAS_DEPTH").map(|s| s.parse::<usize>().unwrap()).unwrap_or(200);
    let budget = std::env::var("W15A_ALIAS_BUDGET_MS").map(|s| s.parse::<u64>().unwrap()).unwrap_or(5000);
    let mut source = "effect audit\nmutation push(p: principal):\n  a0 = true\n".to_string();
    for n in 1..=depth { source.push_str(&format!("  a{n} = a{} = a{}\n", n - 1, n - 1)); }
    let guard = if operand { format!("a{depth} and not exists connected[p]") } else { format!("a{depth}") };
    source.push_str(&format!("  if {guard}:\n    emit audit {{ online: exists connected[p] }}\n"));
    let mut engine = build(&source, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: Some(16_000) })));
    let start = Instant::now();
    let sent = engine.mutate("push", None, Context::new("alice", args(&[("p", id("bob"))])).at(11_000)).unwrap();
    let elapsed = start.elapsed();
    println!("w15a4 alias operand={operand} depth={depth}: {:.3} ms", elapsed.as_secs_f64() * 1000.0);
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].payload.field("online").unwrap(), &Value::Bool(true));
    assert_eq!(effects[0].next_at, if operand { Some(16_000) } else { None });
    assert!(elapsed < Duration::from_millis(budget), "alias DAG held the engine for {elapsed:?}");
}

#[test]
fn w15a4_alias_dag_independent_guard_is_bounded() { alias_dag(false); }

#[test]
fn w15a4_alias_dag_independent_operand_is_bounded() { alias_dag(true); }

fn composition(op: &str, prediction: [u64; 7]) {
    let source = include_str!("compositions.q");
    let mut outcomes = Vec::new();
    let mut meters = Vec::new();
    for (state, live, deadline) in [("held", 1, 16_000), ("graced", 0, 36_000)] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(bound.schema.operations[op].predicts.as_deref(), Some("eligible"));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.set_presence(Some(Arc::new(Grace { live, deadline: Some(deadline) })));
        let ctx = Context::new("alice", args(&[("p", id("bob"))])).at(11_000).with_ids(["note".into()]);
        let sent = engine.mutate(op, None, ctx).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { result: Value::Int(7), .. }), "{sent:?}");
        let effects = engine.effects(None, 10).unwrap();
        assert_eq!(effects.len(), if op == "complementary" && live > 0 { 2 } else { 1 });
        assert_eq!(effects.iter().filter(|e| e.next_at == Some(deadline)).count(), 1);
        if op == "sharedPayload" { assert_eq!(effects[0].payload.field("online").unwrap(), &Value::Bool(live > 0)); }
        let tx = engine.store_mut().read_transaction().unwrap();
        let deps: Vec<(String, i64)> = tx.conn().prepare("SELECT principal, deadline FROM _effect_presence").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
        tx.rollback().unwrap();
        assert_eq!(deps, [("bob".into(), deadline)]);
        let used = super::unconfirmed::fields(sent.metered);
        println!("w15a4 {op} sim {state}: {used:?}; prediction={prediction:?}");
        meters.push(used);
        outcomes.push((sent.state, engine.store().rows("notes").unwrap()));
        engine.presence_reconnected("bob", 12_000).unwrap();
        let claims = engine.claim_effects("worker", None, 10, 60_000, deadline).unwrap();
        assert_eq!(claims.len(), usize::from(op == "complementary" && live > 0));
        let satisfied = engine.effects(Some("satisfied"), 10).unwrap();
        assert_eq!(satisfied.len(), 1);
        assert_eq!(satisfied[0].attempts, 0);
    }
    assert_i1(&format!("{op}/sim"), meters[0], meters[1], prediction);
    assert_eq!(outcomes[0], outcomes[1], "presence cannot change the rows or result");
}

#[test]
fn w15a4_complementary_guards_hedge_without_changing_rows_or_result() {
    composition("complementary", [0, 1, 0, 25, 2737, 9, 1]);
}

#[test]
fn w15a4_shared_payload_keeps_the_ordinary_boolean() {
    composition("sharedPayload", [0, 1, 0, 28, 3857, 9, 1]);
}

#[test]
fn w15a4_setup_marks_are_per_definition_across_reassignment() {
    let source = "effect notify\nmutation push(p: principal, q: principal, force: bool):\n  b = force and not exists connected[p]\n  if b:\n    emit notify {recipient: p}\n  b = force and not exists connected[q]\n  if b:\n    emit notify {recipient: q}\n  b = false\n  if b:\n    emit notify {}\n";
    let mut engine = build(source, Store::memory().unwrap());
    engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: Some(16_000) })));
    let sent = engine.mutate("push", None, Context::new("alice", args(&[("p", id("bob")), ("q", id("carol")), ("force", Value::Bool(true))])).at(11_000)).unwrap();
    assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
    let effects = engine.effects(None, 10).unwrap();
    assert_eq!(effects.len(), 2);
    assert!(effects.iter().all(|e| e.next_at == Some(16_000)));
    let mut recipients: Vec<_> = effects.iter().map(|e| e.payload.field("recipient").unwrap().as_str().unwrap()).collect();
    recipients.sort_unstable();
    assert_eq!(recipients, ["bob", "carol"]);
}
