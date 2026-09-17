use super::*;

#[test]
fn d58_non_owner_drain_candidate_is_raw_position_loss() {
    // D5.1 arithmetic: 12 openings x 100 + 69 refills x 100; refill 70 cuts at 8,193.
    // The returned value deliberately discards the merge: inspect raw loss, since the
    // meter independently makes the public answer incomplete and could mask this defect.
    let mut source = "table messages:\n  lane: int\n  at: int\n  hit: bool\n  by byLane: lane, at, id\n  public 'fixture'\nquery read(c: cursor ?):\n  discarded = merge messages after c last 100 by byLane where .hit:\n".to_owned();
    for lane in 0..12 { source.push_str(&format!("    [{lane}]\n")); }
    source.push_str("  return []\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: Schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let program: Program = serde_json::from_value(serde_json::to_value(&bound.programs[0].program).unwrap()).unwrap();
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    let mut seed = Vec::new();
    for lane in 0..12 { for n in 0..1000 {
        seed.push(("messages".into(), object([("id", Value::Id(format!("r{n:04}-{lane:02}"))), ("lane", Value::Int(lane)), ("at", Value::Int(1000 - n)), ("hit", Value::Bool(n % 100 == 99))])));
    } }
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("alice", [("c".into(), Value::Null)].into()), Meter::new(Ceilings::default(), Cut::Cap), 0);
    runner.run(&program).unwrap();
    assert_eq!(runner.meter.used.examined, 8193);
    assert!(runner.next_cursor().unwrap().is_none(), "the non-owner cannot publish next");
    assert!(runner.page_position_lost(), "the drain candidate must remain visible to raw loss accounting");
    assert!(runner.pages.values().any(|page| page.next.is_some()));
}

#[test]
fn a_predicate_error_restores_both_depths_and_binding() {
    let mut messages = table();
    messages.rules.read = RuleExpr::Allow;
    let schema = Schema { tables: BTreeMap::from([("messages".into(), messages)]), ..Schema::default() };
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    engine.seed([("messages".into(), row("m", "r", "alice", "hello"))]).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("alice", Default::default()), Meter::new(Ceilings::default(), Cut::Cap), 0);
    runner.env.insert("$filter".into(), Value::Int(42));
    for filter in [Expr::Variable("undefined".into()), Expr::Literal(Value::Int(7))] {
        let mut scan = scan(false);
        scan.filter = Some(Box::new(filter));
        assert!(runner.scan(&scan).is_err());
        assert_eq!((runner.page_depth, runner.filter_depth), (0, 0));
        assert_eq!(runner.env.get("$filter"), Some(&Value::Int(42)));
    }
}
