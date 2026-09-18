use super::*;

#[test]
fn w15a6_composition_inherits_only_conjunction_excess() {
    presence_meter::inherited_excess_witness(Store::memory().unwrap(), "sim");
}

#[test]
fn w15a5_minimal_and_conjunction_fit_final_i1() {
    for (label, source, input) in [
        ("minimal", SOURCE, args(&[("p", id("bob"))])),
        ("conjunction", "effect notify\nmutation push(p: principal, q: principal):\n  if not exists connected[p] and not exists connected[q]:\n    emit notify {}\n", args(&[("p", id("bob")), ("q", id("carol"))])),
    ] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let program = &bound.programs.iter().find(|p| p.program.name == "push").unwrap().program;
        let mut store = Store::memory().unwrap();
        snapback4_device::store::DeviceStore::install(&mut store, &bound.schema, &Default::default(), false).unwrap();
        let ctx = || Context::new("alice", input.clone()).at(11_000);
        let prediction = presence_meter::prediction_meter(&mut store, &bound.schema, program, ctx());
        let mut meters = Vec::new();
        for (live, deadline) in [(1, 16_000), (0, 36_000)] {
            let mut engine = build(source, Store::memory().unwrap());
            engine.set_presence(Some(Arc::new(Grace { live, deadline: Some(deadline) })));
            let sent = engine.mutate("push", None, ctx()).unwrap();
            assert!(matches!(sent.state, WriteState::Sent { .. }), "{sent:?}");
            let effects = engine.effects(None, 10).unwrap();
            assert_eq!(effects.len(), 1);
            assert_eq!(effects[0].next_at, Some(deadline));
            meters.push(unconfirmed::fields(sent.metered));
        }
        assert_i1(&format!("{label}/sim"), meters[0], meters[1], std::array::from_fn(|i| prediction[i].1));
    }
}

#[test]
fn w15a5_live_alias_families_preserve_deferred_effects_and_payloads() {
    for shape in ["siblings", "loop", "nested"] {
        let mut body = "  a0 = exists connected[p]\n".to_string();
        for n in 1..=25 { body.push_str(&format!("  a{n} = a{}\n", n - 1)); }
        let mut guards = "  if flag:\n    emit audit {}\n".repeat(25);
        if shape == "nested" { for _ in 0..3 { guards = format!("  if flag:\n{}", guards.lines().map(|l| format!("  {l}\n")).collect::<String>()); } }
        body.push_str(&guards);
        body.push_str("  if not a25:\n    emit notify {online: a25}\n");
        if shape == "loop" { body = format!("  for i in range(0, 1):\n{}", body.lines().map(|l| format!("  {l}\n")).collect::<String>()); }
        let source = format!("effect notify\neffect audit\nmutation push(p: principal, flag: bool):\n{body}");
        let mut engine = build(&source, Store::memory().unwrap());
        engine.set_presence(Some(Arc::new(Grace { live: 1, deadline: Some(16_000) })));
        let sent = engine.mutate("push", None, Context::new("alice", args(&[("p", id("bob")), ("flag", Value::Bool(false))])).at(11_000)).unwrap();
        assert!(matches!(sent.state, WriteState::Sent { .. }), "{shape}: {sent:?}");
        let effects = engine.effects(None, 10).unwrap();
        assert_eq!(effects.len(), 1, "{shape}");
        assert_eq!(effects[0].next_at, Some(16_000));
        assert_eq!(effects[0].payload.field("online").unwrap(), &Value::Bool(true));
    }
}
