use super::*;

fn messages(rule: RuleExpr) -> Table {
    let mut messages = table();
    messages.rules.read = rule;
    messages.indexes.insert("byWords".into(), Index { components: vec![IndexComponent::Column("roomId".into()), IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: json!(crate::words::CONTRACT) }, IndexComponent::Column("id".into())], unique: false });
    messages
}

fn observe(rule: RuleExpr, hidden: bool, author: &str, scan: Scan, cut: Cut, examined: u64) -> Json {
    let mut permits = table();
    permits.columns.insert("until".into(), ColumnType::Time);
    permits.indexes.insert("byExpiry".into(), Index::of(&["until"], false));
    permits.expire = Some("until".into());
    let schema = Schema { tables: BTreeMap::from([("messages".into(), messages(rule)), ("permits".into(), permits)]).into(), ..Schema::default() };
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    let mut seed = vec![("messages".into(), row("message", "r", author, "coffee"))];
    if hidden {
        let mut permit = row("permit", "r", "alice", "hidden");
        if let Value::Row(fields) = &mut permit { fields.insert("until".into(), Value::Int(200)); }
        seed.push(("permits".into(), permit));
    }
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("alice", BTreeMap::new()).at(100), Meter::new(Ceilings { examined, ..Ceilings::default() }, cut), 0);
    let program = Program { name: "read".into(), kind: ProgramKind::Query, args: BTreeMap::new().into(), read_time_granularity_ms: None, body: vec![Stmt::Return(Expr::Scan(scan))], native: false };
    let result = runner.run(&program).and_then(|data| { runner.charge_output(&data)?; Ok(data) });
    let (data, error) = match result { Ok(data) => (crate::wire::to_json(&data), Json::Null), Err(error) => (Json::Null, json!(error.refusal())) };
    json!({"data":data,"error":error,"complete":runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.beyond_horizon,
        "next":runner.next_cursor().unwrap(),"capped_at":runner.meter.capped_at,"metered":runner.meter.used,"tables":runner.read_tables,"nextExpiry":runner.next_expiry})
}

fn principal() -> RuleExpr { RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer) }
fn rule(leading: bool) -> RuleExpr {
    RuleExpr::And(if leading { vec![probe("permits"), principal()] } else { vec![principal(), probe("permits")] })
}

fn paired(examined: impl Fn(Cut) -> u64, malformed: bool, leading: bool) {
    let mut failures = Vec::new();
    for words in [false, true] { for cut in [Cut::Cap, Cut::Abort] {
        let mut scan = scan(words);
        if malformed { scan.after = Some(Box::new(Expr::Literal(Value::String("malformed".into())))); }
        let left = observe(rule(leading), false, "bob", scan.clone(), cut, examined(cut));
        let right = observe(rule(leading), true, "bob", scan, cut, examined(cut));
        println!("R2 N1 words={words} cut={cut:?} ceiling={} malformed={malformed} leading={leading}: W0={left} W1={right}", examined(cut));
        if left != right { failures.push(format!("words={words}, cut={cut:?}: W0={left}; W1={right}")); }
        if malformed { assert_eq!(right["error"]["code"], "E_INPUT"); }
        else if examined(cut) == 8192 {
            assert_eq!(left["data"], json!([]));
            assert_eq!(left["error"], Json::Null);
        }
    }}
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn r2_n1_reversed_conjunct_complete_observation() { paired(|_| 8192, false, false); }
#[test]
fn r2_n1_reversed_conjunct_at_examined_boundary() { paired(|cut| if cut == Cut::Cap { 0 } else { 1 }, false, false); }
#[test]
fn r2_n1_malformed_cursor_precedes_any_prefix_verdict() {
    paired(|_| 8192, true, false);
    paired(|_| 8192, true, true);
}

#[test]
fn r2_n1_partial_true_verdict_keeps_only_admitted_expiries() {
    for words in [false, true] { for cut in [Cut::Cap, Cut::Abort] {
        let hidden = observe(rule(true), true, "bob", scan(words), cut, 8192);
        assert_eq!(hidden["data"], json!([]));
        assert_eq!(hidden["nextExpiry"], Json::Null, "words={words}, cut={cut:?}: {hidden}");
        let admitted = observe(rule(true), true, "alice", scan(words), cut, 8192);
        assert_eq!(admitted["data"].as_array().unwrap().len(), 1);
        assert_eq!(admitted["nextExpiry"], 200);
        let uniform = observe(probe("permits"), true, "bob", scan(words), cut, 8192);
        assert_eq!(uniform["data"].as_array().unwrap().len(), 1);
        assert_eq!(uniform["nextExpiry"], 200);
    }}
}

#[test]
fn r2_n1_input_checks_precede_denied_matching_scope() {
    for words in [false, true] { for hidden in [false, true] {
        let mut scan = scan(words);
        scan.take = Bound::Arg { name: "missing".into(), max: 10 };
        let result = observe(rule(true), hidden, "bob", scan, Cut::Cap, 8192);
        assert_eq!(result["error"]["code"], "E_INPUT", "words={words}, hidden={hidden}: {result}");
    }}
}

#[test]
fn r2_n2_self_witness_is_simplified_before_partial_precheck() {
    for words in [false, true] { for cut in [Cut::Cap, Cut::Abort] {
        let mut witness = probe("messages");
        if let RuleExpr::Exists { key, .. } = &mut witness { key[1] = RuleTerm::Field("principal".into()); }
        let rule = RuleExpr::And(vec![witness, RuleExpr::Eq(RuleTerm::Field("body".into()), RuleTerm::Literal(Value::String("coffee".into())))]);
        let schema = Schema { tables: BTreeMap::from([("messages".into(), messages(rule))]).into(), ..Schema::default() };
        let seed = vec![("messages".into(), row("coffee", "r", "alice", "coffee")), ("messages".into(), row("other", "r", "bob", "coffers"))];
        let result = observe_read(schema, seed, Expr::Scan(scan(words)), cut);
        assert_eq!(result["error"], Json::Null);
        assert_eq!(result["data"].as_array().unwrap().len(), 1, "words={words}, cut={cut:?}: {result}");
        assert_eq!(result["data"][0]["id"], "coffee");
        assert_eq!(result["complete"], false);
    }}
}
