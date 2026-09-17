use super::*;

pub(super) fn fields(m: snapback4_core::meter::Metered) -> [u64; 7] {
    [m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, m.rows_written]
}

#[test]
fn w15a_aliases_keep_payload_values_and_independent_conditions() {
    for (label, guard, field, expected) in [
        ("direct", "  if not exists connected[p]:", "exists connected[p]", true),
        ("alias", "  b = not exists connected[p]\n  if b:", "not b", true),
        ("count", "  n = connected[p]\n  b = n = 0\n  if b:", "n > 0", true),
        ("and", "  online = exists connected[p]\n  b = force and not online\n  if b:", "online", true),
        ("nested", "  if force:\n    if not exists connected[p]:", "exists connected[p]", true),
        ("else", "  b = exists connected[p]\n  if b:\n    emit audit {online: b}\n  else:", "b", true),
        ("negated-or", "  b = not force or exists connected[p]\n  if not b:", "b", true),
    ] {
        for force in [false, true] {
            let indent = if label == "nested" { "      " } else { "    " };
            let source = format!("effect notify\neffect audit\nmutation push(p: principal, force: bool):\n{guard}\n{indent}emit notify {{online: {field}}}\n");
            let mut engine = build(&source, Store::memory().unwrap());
            engine.set_presence(Some(Arc::new(Grace { live: 2, deadline: Some(16_000) })));
            let outcome = engine.mutate("push", None, Context::new("alice", args(&[("p", id("bob")), ("force", Value::Bool(force))])).at(11_000)).unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{label}: {outcome:?}");
            for deadline in [None, Some(36_000)] {
                let mut control = build(&source, Store::memory().unwrap());
                control.set_presence(Some(Arc::new(Grace { live: 0, deadline })));
                let control = control.mutate("push", None, Context::new("alice", args(&[("p", id("bob")), ("force", Value::Bool(force))])).at(11_000)).unwrap();
                assert_eq!(fields(outcome.metered), fields(control.metered), "{label} force={force} deadline={deadline:?}");
            }
            let effects = engine.effects(None, 10).unwrap();
            let should_emit = force || !["and", "nested", "negated-or"].contains(&label);
            assert_eq!(effects.len(), usize::from(should_emit), "{label} force={force}: {effects:?}");
            if let Some(effect) = effects.first() {
                assert_eq!(effect.effect, "notify", "{label}");
                assert_eq!(effect.next_at, Some(16_000), "{label}");
                assert_eq!(effect.payload.field("online").unwrap(), &Value::Bool(expected), "{label}");
            }
        }
    }
}

#[test]
fn w15a_mixed_dependencies_wait_for_latest_and_any_timely_arrival_satisfies() {
    #[derive(Debug)]
    struct Mixed;
    impl Presence for Mixed {
        fn connections(&self, p: &str) -> u64 { u64::from(p != "absent") }
        fn effect_presence(&self, p: &str) -> (u64, Option<i64>) {
            match p { "held" => (1, Some(16_000)), "graced" => (0, Some(36_000)), _ => (0, None) }
        }
    }
    for guard in [
        "  if not exists connected[p] and not exists connected[q]:\n    if not exists connected[r]:",
        "  if not exists connected[p]:\n    if not exists connected[q]:\n      if not exists connected[r]:",
    ] {
        for who in [None, Some("held"), Some("graced"), Some("absent")] {
            let indent = if guard.contains(" and ") { "      " } else { "        " };
            let source = format!("effect notify\nmutation push(p: principal, q: principal, r: principal):\n{guard}\n{indent}emit notify {{recipient: p}}\n");
            let mut engine = build(&source, Store::memory().unwrap());
            engine.set_presence(Some(Arc::new(Mixed)));
            let sent = engine.mutate("push", None, Context::new("alice", args(&[("p", id("held")), ("q", id("absent")), ("r", id("graced"))])).at(11_000)).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), 1);
            assert_eq!(effects[0].next_at, Some(36_000));
            if let Some(who) = who { engine.presence_reconnected(who, 15_000).unwrap(); }
            assert!(engine.claim_effects("worker", None, 10, 60_000, 35_999).unwrap().is_empty());
            let claimed = engine.claim_effects("worker", None, 10, 60_000, 36_000).unwrap();
            let satisfied = matches!(who, Some("held" | "graced"));
            assert_eq!(claimed.len(), usize::from(!satisfied));
            if satisfied { assert_eq!(engine.effects(Some("satisfied"), 10).unwrap()[0].attempts, 0); }
        }
    }
}

#[test]
fn w15a_held_deadline_reconnect_and_replay_survive_restart() {
    for reconnect in [false, true] {
        let dir = std::env::temp_dir().join(format!("sb4-w15a-restart-{}-{reconnect}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let mut engine = build(SOURCE, Store::open(&path).unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: Some(16_000) })));
        engine.presence_reconnected("bob", 10_000).unwrap();
        send(&mut engine);
        assert_eq!(engine.effects(None, 10).unwrap().len(), 1);
        if reconnect { engine.presence_reconnected("bob", 12_000).unwrap(); }
        drop(engine);
        let mut engine = Engine::open(Store::open(&path).unwrap()).unwrap();
        let ctx = Context::new("alice", args(&[("p", id("bob"))])).at(17_000);
        assert!(engine.mutate("push", Some("message"), ctx).unwrap().replayed);
        assert_eq!(engine.effects(None, 10).unwrap()[0].next_at, Some(16_000));
        let claims = engine.claim_effects("worker", None, 10, 60_000, 17_000).unwrap();
        assert_eq!(claims.len(), usize::from(!reconnect));
        if reconnect {
            let effect = engine.effects(Some("satisfied"), 10).unwrap().remove(0);
            assert_eq!(effect.attempts, 0);
            assert_eq!(effect.result.unwrap().field("outcome").unwrap().as_str().unwrap(), "presence_reconnected");
        } else { assert_eq!(claims[0].attempts, 1); }
        assert!(engine.claim_effects("other", None, 10, 60_000, 17_000).unwrap().is_empty());
        drop(engine);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn w15a_unchanged_forms_keep_base_values_arms_and_all_meter_fields() {
    for (label, body) in [
        ("payload", "  emit notify {online: exists connected[p]}"),
        ("or", "  if not exists connected[p] or force:\n    emit notify {online: force}"),
        ("and-or", "  b = force and not exists connected[p]\n  if b or force:\n    emit notify {online: force}"),
        ("negated-and", "  if not (exists connected[p] and not force):\n    emit notify {online: force}"),
    ] {
        for (live, deadline) in [(0, None), (0, Some(36_000)), (1, Some(16_000))] {
            let source = format!("effect notify\nmutation push(p: principal, force: bool):\n{body}\n");
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
            let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
            engine.set_presence(Some(Arc::new(Grace { live, deadline })));
            let sent = engine.mutate("push", None, Context::new("alice", args(&[("p", id("bob")), ("force", Value::Bool(true))])).at(11_000)).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }));
            println!("w15a unchanged {label} live={live} deadline={deadline:?}: {:?}", fields(sent.metered));
            let (steps, heap) = match label {
                "payload" => (6, 235),
                "or" => (if live > 0 || deadline.is_some() { 15 } else { 13 }, 132),
                "and-or" => (if live > 0 || deadline.is_some() { 23 } else { 21 }, 132),
                "negated-and" => if live > 0 { (16, 1698) } else { (13, 1561) },
                _ => unreachable!(),
            };
            assert_eq!(fields(sent.metered), [0, 0, 0, steps, heap, 6, 0]);
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), 1);
            assert_eq!(effects[0].next_at, None);
            assert_eq!(effects[0].payload.field("online").unwrap(), &Value::Bool(label != "payload" || live > 0));
            engine.presence_reconnected("bob", 12_000).unwrap();
            assert_eq!(engine.claim_effects("worker", None, 10, 60_000, 16_000).unwrap().len(), 1);
        }
    }
}

#[test]
fn w15a_queries_and_row_or_result_decisions_keep_base_values_and_meters() {
    let source = "table notes:\n  n: int\n  public 'test'\n  insert <- allow\nquery online(p: principal):\n  return connected[p]\nmutation write(p: principal):\n  if exists connected[p]:\n    insert notes {n: 1}\nmutation result(p: principal):\n  return connected[p]\n";
    for (live, deadline, count) in [(0, None, 0), (0, Some(36_000), 1), (2, Some(16_000), 2)] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert_eq!(bound.schema.operations["write"].predicts.as_deref(), Some("never"));
        assert_eq!(bound.schema.operations["result"].predicts.as_deref(), Some("never"));
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        engine.set_presence(Some(Arc::new(Grace { live, deadline })));
        let ctx = || Context::new("alice", args(&[("p", id("bob"))])).at(11_000).with_ids(["note".into()]);
        let query = engine.query("online", ctx()).unwrap();
        assert_eq!(query.data, Value::Int(count));
        let result = engine.mutate("result", None, ctx()).unwrap();
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == count));
        let write = engine.mutate("write", None, ctx()).unwrap();
        assert!(matches!(write.state, WriteState::Sent { .. }));
        assert_eq!(engine.store().rows("notes").unwrap().len(), usize::from(count > 0));
        println!("w15a unchanged decisions live={live} deadline={deadline:?}: query={:?} result={:?} write={:?}", fields(query.metered), fields(result.metered), fields(write.metered));
        assert_eq!(fields(query.metered), [0, 0, 0, 3, 6, 9, 0]);
        assert_eq!(fields(result.metered), [0, 0, 0, 3, 6, 9, 0]);
        assert_eq!(fields(write.metered), if count == 0 { [0, 0, 0, 5, 6, 6, 0] } else { [0, 1, 0, 15, 432, 42, 1] });
    }
}
