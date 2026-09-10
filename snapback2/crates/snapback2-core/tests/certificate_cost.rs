use snapback2_core::*;
use std::collections::BTreeMap;

fn var(name: &str) -> Expr { Expr::Variable(name.into()) }
fn text(value: &str) -> Expr { Expr::Literal(Value::String(value.into())) }
fn concat(left: Expr, right: Expr) -> Expr {
    Expr::Builtin { builtin: Builtin::Concat, args: vec![left, right] }
}
fn field(base: Expr, name: &str) -> Expr { Expr::Field { base: Box::new(base), name: name.into() } }
fn bind(name: &str, value: Expr) -> Stmt { Stmt::Let { name: name.into(), value } }
fn assign(name: &str, value: Expr) -> Stmt { Stmt::Assign { name: name.into(), value } }

fn growth_fixture(mode: &str, take: u32, width: u32) -> (Schema, Program) {
    let mut schema = spike_schema();
    schema.tables.insert("items".into(), public_table(
        BTreeMap::from([("id".into(), ColumnType::Id), ("body".into(), ColumnType::Text { max: width }), ("flag".into(), ColumnType::Bool)]),
        BTreeMap::from([("byId".into(), Index { components: vec![search_key::IndexComponent::Column("id".into())], unique: true })]),
    ));
    let appended = concat(var("result"), field(var("row"), "body"));
    let projected = field(Expr::Object(BTreeMap::from([("n".into(), appended.clone())])), "n");
    let body = match mode {
        "lag" => vec![assign("result", field(Expr::Object(BTreeMap::from([("n".into(), concat(var("other"), field(var("row"), "body")))])), "n")), assign("other", var("result"))],
        "cross_branch" => vec![Stmt::If {
            condition: field(var("row"), "flag"),
            then_body: vec![assign("result", field(Expr::Object(BTreeMap::from([("n".into(), concat(var("other"), concat(var("other"), field(var("row"), "body"))))])), "n"))],
            else_body: vec![assign("other", field(Expr::Object(BTreeMap::from([("n".into(), concat(var("result"), concat(var("result"), field(var("row"), "body"))))])), "n"))],
        }],
        "projected" => vec![assign("result", projected)],
        "alias" => vec![bind("next", projected), assign("result", var("next"))],
        "twice" => vec![assign("result", field(Expr::Object(BTreeMap::from([("next".into(), concat(var("result"), appended))])), "next"))],
        "branch" => vec![Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(field(var("row"), "id")), right: Box::new(Expr::Literal(Value::Id("0".into()))) }, then_body: vec![assign("result", appended)], else_body: vec![assign("result", projected)] }],
        "nested" => vec![Stmt::For { binding: "copy".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 3 }, body: vec![assign("result", projected)] }],
        "intermediate" => vec![assign("result", projected), Stmt::Push { target: "saved".into(), value: var("result") }],
        _ => vec![assign("result", appended)],
    };
    let program = Program {
        name: format!("cost.{mode}"), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![bind("other", text("")), bind("result", text("")), bind("saved", Expr::Array(vec![])), Stmt::For {
            binding: "row".into(), domain: LoopDomain::Page(Scan {
                site: "cost.rows".into(), table: "items".into(), index: "byId".into(), prefix: vec![],
                order: Order::Asc, take: Bound::Literal(take), after: None, before: None, range: None,
                opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const,
            }), body,
        }, Stmt::Return(var(if mode == "intermediate" { "saved" } else { "result" }))],
    };
    (schema, program)
}

#[test]
fn loop_carried_value_bounds_dominate_maximum_width_escaped_executions() {
    for mode in ["plain", "projected", "alias", "twice", "branch", "nested", "intermediate", "lag", "cross_branch"] {
        for pattern in ["\n", "\"", "\\", "\u{10ffff}"] {
            let take = if mode == "twice" || mode == "cross_branch" { 5 } else { 21 };
            let (schema, program) = growth_fixture(mode, take, 12);
            let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
            let mut engine = Engine::memory(schema).unwrap();
            // Text maxima count Unicode scalars; four-byte scalars and escaped ASCII fill the declared maximum.
            let body = pattern.repeat(12);
            for n in 0..take {
                engine.seed("items", Value::Row(BTreeMap::from([
                    ("id".into(), Value::Id(n.to_string())), ("body".into(), Value::String(body.clone())), ("flag".into(), Value::Bool(n % 2 == 0)),
                ]).into())).unwrap();
            }
            let execution = engine.execute(&program, &certificate, Context::query(Actor::user("viewer").unwrap(), BTreeMap::new())).unwrap();
            let measured = canonical_json(&execution.result).len() as u64;
            println!("{mode} {pattern:?}: output bound {}, measured {measured}; closure {}", certificate.max_output_bytes, certificate.max_closure_bytes);
            let retained_payload = match &execution.result {
                Value::String(value) => canonical_json(value).len() as u64,
                Value::Array(values) => values.iter().map(|value| match value { Value::String(value) => canonical_json(value).len() as u64, _ => panic!("expected saved strings") }).sum(),
                _ => panic!("growth fixture result"),
            };
            assert!(certificate.max_closure_bytes >= retained_payload, "{mode} closure {} < retained {retained_payload}", certificate.max_closure_bytes);
            assert!(certificate.max_output_bytes >= measured, "{mode}: bound {} < measured {measured}", certificate.max_output_bytes);
        }
    }
}

#[test]
fn ticket_68_vs_1020_is_a_runnable_projected_rebind() {
    let (schema, program) = growth_fixture("projected", 252, 4);
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..252 {
        engine.seed("items", Value::Row(BTreeMap::from([
            ("id".into(), Value::Id(n.to_string())),
            ("body".into(), Value::String(if n == 251 { "abc" } else { "abcd" }.into())), ("flag".into(), Value::Bool(false)),
        ]).into())).unwrap();
    }
    let execution = engine.execute(&program, &certificate, Context::query(Actor::user("viewer").unwrap(), BTreeMap::new())).unwrap();
    let measured = canonical_json(&execution.result).len() as u64;
    println!("ticket: output bound {}, measured {measured}; closure {}", certificate.max_output_bytes, certificate.max_closure_bytes);
    assert_eq!(measured, 1020);
    assert!(certificate.max_output_bytes >= measured);
}

fn generous() -> Ceilings {
    Ceilings { examined: u64::MAX, index_entries: u64::MAX, rule_probes: u64::MAX, steps: u64::MAX,
        heap_bytes: u64::MAX, output_bytes: u64::MAX, closure_bytes: u64::MAX, write_rows: u64::MAX }
}
fn totals(c: &Certificate) -> [(&'static str, u64); 8] {
    [("examined entries", c.max_examined), ("index entries", c.max_index_entries), ("rule probes", c.max_rule_probes),
        ("steps", c.max_steps), ("heap bytes", c.max_heap_bytes), ("output bytes", c.max_output_bytes), ("closure bytes", c.max_closure_bytes),
        ("write rows", c.write_sites.iter().fold(c.maintained_amplification, |n, w| n.saturating_add(w.max_rows)))]
}
fn ceiling<'a>(c: &'a mut Ceilings, meter: &str) -> &'a mut u64 {
    match meter { "examined entries" => &mut c.examined, "index entries" => &mut c.index_entries, "rule probes" => &mut c.rule_probes,
        "steps" => &mut c.steps, "heap bytes" => &mut c.heap_bytes, "output bytes" => &mut c.output_bytes,
        "closure bytes" => &mut c.closure_bytes, "write rows" => &mut c.write_rows, _ => unreachable!() }
}
fn reconcile(c: &Certificate) {
    for (meter, total) in totals(c) {
        let sum = c.cost_terms.iter().filter(|t| t.meter == meter).map(|t| t.value).sum::<i128>();
        assert_eq!(sum, i128::from(total), "{} {meter}: {:?}", c.program, c.cost_terms);
    }
}

#[test]
fn every_meter_has_an_admitted_refused_pair_with_identical_pricing() {
    let schema = spike_schema();
    let programs = [thread_program(20), send_program(true), board_view_program(), nested_expenses_program()];
    let mut covered = std::collections::BTreeSet::new();
    for program in programs {
        let Some(priced) = Checker::new(&schema, generous()).inspect(&program).certificate else { panic!("missing partial {}", program.name) };
        reconcile(&priced);
        // Only admitted structurally sound fixtures qualify as the admitted half.
        if Checker::new(&schema, generous()).check(&program).is_err() { continue; }
        for (meter, total) in totals(&priced).into_iter().filter(|(_, n)| *n > 0) {
            let mut limits = generous();
            *ceiling(&mut limits, meter) = total;
            let at = Checker::new(&schema, limits.clone()).check(&program).unwrap();
            assert_eq!(totals(&at), totals(&priced));
            *ceiling(&mut limits, meter) = total - 1;
            let below = Checker::new(&schema, limits).inspect(&program);
            assert!(!below.errors.is_empty(), "{meter} at {total}");
            let partial = below.certificate.unwrap();
            reconcile(&partial);
            assert_eq!(totals(&partial), totals(&at));
            assert_eq!(partial.cost_terms, at.cost_terms);
            let name = if meter == "write rows" { "write amplification" } else { meter };
            assert!(below.errors.iter().any(|error| error.message.starts_with(&format!("{name} {total} exceeds ceiling {}", total - 1))), "{meter}: {:?}", below.errors);
            covered.insert(meter);
        }
    }
    assert_eq!(covered.len(), 8, "missing meter: {covered:?}");
}

#[test]
fn branch_terms_select_each_meters_maximum_and_mixed_reads_keep_budget_reserve() {
    let schema = spike_schema();
    let query = thread_program(20);
    let mut branch = query.clone();
    branch.body = vec![Stmt::If { condition: Expr::Literal(Value::Bool(true)), then_body: query.body.clone(), else_body: vec![Stmt::Return(text(&"x".repeat(10000)))] }];
    let c = Checker::new(&schema, generous()).check(&branch).unwrap();
    reconcile(&c);
    let c1 = Checker::new(&schema, generous()).check(&query).unwrap();
    assert_eq!(c.max_examined, c1.max_examined);
    assert!(c.max_output_bytes >= canonical_json(&Value::String("x".repeat(10000))).len() as u64);

    let (mut schema, mut mixed) = growth_fixture("plain", 3, 12);
    let mut restricted = schema.tables["items"].clone();
    restricted.rules.read = RuleExpr::Eq(RuleTerm::Field("body".into()), RuleTerm::Literal(Value::String("visible".into())));
    schema.tables.insert("restricted".into(), restricted);
    let Stmt::For { domain: LoopDomain::Page(scan), .. } = &mixed.body[3] else { panic!("fixture loop") };
    let mut scan = scan.clone();
    scan.site = "cost.nonuniform".into(); scan.table = "restricted".into();
    mixed.body.insert(0, bind("nonuniform", Expr::Scan(scan)));
    let analysis = Checker::new(&schema, Ceilings::default()).inspect(&mixed);
    let certificate = analysis.certificate.unwrap();
    reconcile(&certificate);
    assert_eq!(certificate.max_examined, Ceilings::default().examined);
    assert!(certificate.read_sites.iter().any(|site| site.hoist));
    assert!(certificate.read_sites.iter().any(|site| !site.hoist));
}

#[test]
fn first_argument_below_group_cap_keeps_declared_bound_and_measured_page_cut() {
    // `first n` with `n <= 20` over a group capped at 21: the certificate prices the
    // argument's maximum, not the cap, and a smaller runtime value cuts the page short.
    let (mut schema, mut program) = growth_fixture("plain", 21, 12);
    let items = schema.tables.get_mut("items").unwrap();
    items.constraints.push(Constraint::Cap { by: vec!["flag".into()], max: 21 });
    items.indexes.insert("byFlag".into(), Index {
        components: vec![search_key::IndexComponent::Column("flag".into()), search_key::IndexComponent::Column("id".into())],
        unique: false,
    });
    let Stmt::For { domain: LoopDomain::Page(mut scan), .. } = program.body.remove(3) else { panic!("fixture scan") };
    scan.index = "byFlag".into();
    scan.prefix = vec![search_key::IndexKeyExpr::Scalar(Expr::Literal(Value::Bool(false)))];
    scan.take = Bound::Arg { name: "n".into(), max: 20 };
    program.args.insert("n".into(), ArgType::Int);
    program.body = vec![Stmt::Return(Expr::Scan(scan))];
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    reconcile(&certificate);
    assert_eq!(certificate.read_sites[0].take, 20);
    let mut engine = Engine::memory(schema).unwrap();
    for n in 0..5 {
        engine.seed("items", Value::Row(BTreeMap::from([
            ("id".into(), Value::Id(n.to_string())), ("body".into(), Value::String("wide".into())), ("flag".into(), Value::Bool(false)),
        ]).into())).unwrap();
    }
    let execution = engine.execute(&program, &certificate, Context::query(Actor::user("viewer").unwrap(), BTreeMap::from([("n".into(), Value::Int(2))]))).unwrap();
    let Value::Array(rows) = &execution.result else { panic!("page") };
    assert_eq!(rows.len(), 2);
    assert_eq!(execution.state, ExecutionState::Capped);
    assert!(execution.trace.examined <= certificate.max_examined);
    assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
}

#[test]
fn priced_certificate_round_trips_inside_flattened_source_snapshot() {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Located { #[serde(flatten)] certificate: Certificate }
    let certificate = Checker::new(&spike_schema(), Ceilings::default()).check(&thread_program(20)).unwrap();
    let located = Located { certificate: certificate.clone() };
    let wire = serde_json::to_string(&located).unwrap();
    let decoded: Located = serde_json::from_str(&wire).unwrap();
    assert_eq!(decoded.certificate, certificate);
}
