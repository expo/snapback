use snapback2_core::*;
use std::collections::BTreeMap;

fn var(name: &str) -> Expr { Expr::Variable(name.into()) }
fn text(value: &str) -> Expr { Expr::Literal(Value::String(value.into())) }
fn concat(left: Expr, right: Expr) -> Expr {
    Expr::Builtin { builtin: Builtin::Concat, args: vec![left, right] }
}
fn field(base: Expr, name: &str) -> Expr { Expr::Field { base: Box::new(base), name: name.into() } }
fn projected(value: Expr) -> Expr { field(Expr::Object(BTreeMap::from([("n".into(), value)])), "n") }
fn bind(name: &str, value: Expr) -> Stmt { Stmt::Let { name: name.into(), value } }
fn assign(name: &str, value: Expr) -> Stmt { Stmt::Assign { name: name.into(), value } }

const MODES: [&str; 13] = ["plain", "projected", "alias", "twice", "branch", "nested", "intermediate", "lag", "cross_branch", "let", "let_projected", "const", "triple"];
fn exponential(mode: &str) -> bool { matches!(mode, "twice" | "cross_branch" | "triple") }

fn growth_fixture(mode: &str, take: u32, width: u32) -> (Schema, Program) {
    let mut schema = spike_schema();
    schema.tables.insert("items".into(), public_table(
        BTreeMap::from([("id".into(), ColumnType::Id), ("body".into(), ColumnType::Text { max: width }), ("flag".into(), ColumnType::Bool), ("n".into(), ColumnType::Int)]),
        BTreeMap::from([("byId".into(), Index { components: vec![search_key::IndexComponent::Column("id".into())], unique: true })]),
    ));
    let row_body = field(var("row"), "body");
    let appended = concat(var("result"), row_body.clone());
    let body = match mode {
        "lag" => vec![assign("result", projected(concat(var("other"), row_body))), assign("other", var("result"))],
        "cross_branch" => vec![Stmt::If {
            condition: field(var("row"), "flag"),
            then_body: vec![assign("result", projected(concat(var("other"), concat(var("other"), row_body.clone()))))],
            else_body: vec![assign("other", projected(concat(var("result"), concat(var("result"), row_body))))],
        }],
        "projected" => vec![assign("result", projected(appended))],
        "alias" => vec![bind("next", projected(appended)), assign("result", var("next"))],
        "twice" => vec![assign("result", field(Expr::Object(BTreeMap::from([("next".into(), concat(var("result"), appended))])), "next"))],
        "branch" => vec![Stmt::If { condition: Expr::Binary { op: BinaryOp::Eq, left: Box::new(field(var("row"), "id")), right: Box::new(Expr::Literal(Value::Id("0".into()))) }, then_body: vec![assign("result", appended.clone())], else_body: vec![assign("result", projected(appended))] }],
        "nested" => vec![Stmt::For { binding: "copy".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 3 }, body: vec![assign("result", projected(appended))] }],
        "intermediate" => vec![assign("result", projected(appended)), Stmt::Push { target: "saved".into(), value: var("result") }],
        // The ticket's spelling: the engine overwrites on `let`/`const` exactly as on assignment.
        "let" => vec![bind("result", appended)],
        "let_projected" => vec![bind("result", projected(appended))],
        "const" => vec![Stmt::Const { name: "result".into(), value: appended }],
        // Three carried names in one cycle with a doubling edge: result ← other, other ← third, third ← result + result.
        "triple" => vec![
            assign("result", projected(concat(var("other"), row_body.clone()))),
            assign("other", projected(concat(var("third"), row_body))),
            assign("third", projected(concat(var("result"), var("result")))),
        ],
        "int" => vec![assign("result", Expr::Binary { op: BinaryOp::Add, left: Box::new(var("result")), right: Box::new(field(var("row"), "n")) })],
        _ => vec![assign("result", appended)],
    };
    let initial = if mode == "int" { Expr::Literal(Value::Int(0)) } else { text("") };
    let program = Program {
        name: format!("cost.{mode}"), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None,
        body: vec![bind("other", text("")), bind("third", text("")), bind("result", initial), bind("saved", Expr::Array(vec![])), Stmt::For {
            binding: "row".into(), domain: LoopDomain::Page(Scan {
                site: "cost.rows".into(), table: "items".into(), index: "byId".into(), prefix: vec![],
                order: Order::Asc, take: Bound::Literal(take), after: None, before: None, range: None,
                opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const,
            }), body,
        }, Stmt::Return(var(if mode == "intermediate" { "saved" } else { "result" }))],
    };
    (schema, program)
}
const LOOP: usize = 4;

fn seed_items(engine: &mut Engine, take: u32, body: impl Fn(u32) -> String, n: i64) {
    seed_flagged(engine, take, body, |i| i % 2 == 0, n)
}
fn seed_flagged(engine: &mut Engine, take: u32, body: impl Fn(u32) -> String, flag: impl Fn(u32) -> bool, n: i64) {
    for i in 0..take {
        engine.seed("items", Value::Row(BTreeMap::from([
            ("id".into(), Value::Id(i.to_string())), ("body".into(), Value::String(body(i))),
            ("flag".into(), Value::Bool(flag(i))), ("n".into(), Value::Int(n)),
        ]).into())).unwrap();
    }
}

fn run_growth(mode: &str, take: u32, width: u32, body: impl Fn(u32) -> String) -> (Certificate, Execution) {
    let (schema, program) = growth_fixture(mode, take, width);
    let ceilings = if exponential(mode) { generous() } else { Ceilings::default() };
    let certificate = Checker::new(&schema, ceilings).check(&program).unwrap_or_else(|errors| panic!("{mode}: {errors:?}"));
    let mut engine = Engine::memory(schema).unwrap();
    seed_items(&mut engine, take, body, 1);
    let execution = engine.execute(&program, &certificate, Context::query(Actor::user("viewer").unwrap(), BTreeMap::new())).unwrap();
    (certificate, execution)
}

fn assert_dominates(mode: &str, certificate: &Certificate, execution: &Execution) {
    let measured = canonical_json(&execution.result).len() as u64;
    let retained_payload = match &execution.result {
        Value::String(value) => canonical_json(value).len() as u64,
        Value::Array(values) => values.iter().map(|value| match value { Value::String(value) => canonical_json(value).len() as u64, _ => panic!("expected saved strings") }).sum(),
        _ => panic!("growth fixture result"),
    };
    assert!(certificate.max_closure_bytes >= retained_payload, "{mode} closure {} < retained {retained_payload}", certificate.max_closure_bytes);
    assert!(certificate.max_output_bytes >= measured, "{mode}: bound {} < measured {measured}", certificate.max_output_bytes);
}

// @ref LLP 1020#a5-recurrence-pricing-is-a-bound — every loop-growth shape at full length: bound ≥ measured, never equality.
#[test]
fn loop_carried_value_bounds_dominate_maximum_width_escaped_executions() {
    for mode in MODES {
        // Exponential shapes run their full 21 iterations on a one-scalar column, so the affine
        // squaring is exercised end to end without a multi-megabyte served value.
        let width = if exponential(mode) { 1 } else { 12 };
        for pattern in ["\n", "\"", "\\", "\u{10ffff}"] {
            // Text maxima count Unicode scalars; four-byte scalars and escaped ASCII fill the declared maximum.
            let (certificate, execution) = run_growth(mode, 21, width, |_| pattern.repeat(width as usize));
            assert_dominates(mode, &certificate, &execution);
        }
    }
}

#[test]
fn ticket_68_vs_1020_is_a_runnable_projected_rebind() {
    let (certificate, execution) = run_growth("projected", 252, 4, |n| if n == 251 { "abc" } else { "abcd" }.into());
    let measured = canonical_json(&execution.result).len() as u64;
    assert_eq!(measured, 1020);
    assert!(certificate.max_output_bytes >= measured);
}

// The ticket's own spelling was `let` rebound in a `for`; the engine overwrites the name exactly
// as an assignment does, so it is priced as the same recurrence.
#[test]
fn ticket_let_rebind_in_a_for_is_priced_as_the_same_recurrence() {
    for mode in ["let", "let_projected", "const"] {
        let (certificate, execution) = run_growth(mode, 252, 4, |_| "\"".repeat(4));
        let measured = canonical_json(&execution.result).len() as u64;
        assert_eq!(measured, canonical_json(&Value::String("\"".repeat(252 * 4))).len() as u64, "{mode}: escaped maximum-width fill");
        assert_dominates(mode, &certificate, &execution);
        let (assigned, _) = run_growth(if mode == "let_projected" { "projected" } else { "plain" }, 252, 4, |_| "\"".repeat(4));
        assert_eq!(certificate.max_output_bytes, assigned.max_output_bytes, "{mode} prices like its assignment form");
    }
}

#[test]
fn integer_accumulation_is_priced_at_its_serialized_width_and_overflow_is_refused() {
    let (schema, program) = growth_fixture("int", 21, 12);
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    let context = || Context::query(Actor::user("viewer").unwrap(), BTreeMap::new());
    let mut engine = Engine::memory(schema.clone()).unwrap();
    seed_items(&mut engine, 21, |_| "x".into(), I53_MAX / 21);
    let execution = engine.execute(&program, &certificate, context()).unwrap();
    assert_eq!(execution.result, Value::Int((I53_MAX / 21) * 21));
    assert!(certificate.max_output_bytes >= canonical_json(&execution.result).len() as u64);
    // A sum past the i53 range is a runtime refusal, never a served value wider than its price.
    let mut engine = Engine::memory(schema).unwrap();
    seed_items(&mut engine, 21, |_| "x".into(), I53_MAX);
    let overflow = engine.execute(&program, &certificate, context());
    assert!(matches!(overflow, Err(RuntimeError::Value(ValueError::Overflow(_)))), "{overflow:?}");
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

    // A uniform `first 3` page and a non-uniform page of a restricted table, both returned.
    let (mut schema, mut mixed) = growth_fixture("plain", 3, 12);
    let mut restricted = schema.tables["items"].clone();
    restricted.rules.read = RuleExpr::Eq(RuleTerm::Field("body".into()), RuleTerm::Literal(Value::String("visible".into())));
    schema.tables.insert("restricted".into(), restricted);
    let Stmt::For { domain: LoopDomain::Page(uniform), .. } = &mixed.body[LOOP] else { panic!("fixture loop") };
    let uniform = uniform.clone();
    let mut nonuniform = uniform.clone();
    nonuniform.site = "cost.nonuniform".into(); nonuniform.table = "restricted".into();
    mixed.body = vec![bind("uniform", Expr::Scan(uniform)), bind("nonuniform", Expr::Scan(nonuniform)),
        Stmt::Return(Expr::Object(BTreeMap::from([("uniform".into(), var("uniform")), ("nonuniform".into(), var("nonuniform"))])))];
    let analysis = Checker::new(&schema, Ceilings::default()).inspect(&mixed);
    assert!(analysis.errors.is_empty(), "{:?}", analysis.errors);
    let certificate = analysis.certificate.unwrap();
    reconcile(&certificate);
    let site = |name: &str| certificate.read_sites.iter().find(|site| site.site == name).unwrap_or_else(|| panic!("{name}"));
    assert!(site("cost.rows").hoist);
    assert!(!site("cost.nonuniform").hoist);
    assert_eq!(certificate.max_examined, Ceilings::default().examined);
    let reserve = "rule evaluation / non-uniform budget reserve";
    for meter in ["examined entries", "index entries", "rule probes", "steps"] {
        assert!(certificate.cost_terms.iter().any(|term| term.meter == meter && term.source == reserve), "{meter}: {:?}", certificate.cost_terms);
    }
    // The refusal's product names the same reserve term the priced plan carries.
    let mut limits = Ceilings::default();
    limits.steps = certificate.max_steps - 1;
    let refused = Checker::new(&schema, limits).inspect(&mixed);
    let error = refused.errors.iter().find(|error| error.code == "E_STEPS").unwrap_or_else(|| panic!("{:?}", refused.errors));
    assert!(error.message.contains(&format!("{reserve} = ")), "{}", error.message);
    assert_eq!(refused.certificate.unwrap().cost_terms, certificate.cost_terms);
}

#[test]
fn first_argument_below_group_cap_keeps_declared_bound_and_measured_page_cut() {
    // `first n` with `n <= 20` over a group capped at 21: the certificate prices the
    // argument's maximum, not the cap, and the runtime value cuts the page short or
    // exhausts the five stored rows as complete.
    let (mut schema, mut program) = growth_fixture("plain", 21, 12);
    let items = schema.tables.get_mut("items").unwrap();
    items.constraints.push(Constraint::Cap { by: vec!["flag".into()], max: 21 });
    items.indexes.insert("byFlag".into(), Index {
        components: vec![search_key::IndexComponent::Column("flag".into()), search_key::IndexComponent::Column("id".into())],
        unique: false,
    });
    let Stmt::For { domain: LoopDomain::Page(mut scan), .. } = program.body.remove(LOOP) else { panic!("fixture scan") };
    scan.index = "byFlag".into();
    scan.prefix = vec![search_key::IndexKeyExpr::Scalar(Expr::Literal(Value::Bool(false)))];
    scan.take = Bound::Arg { name: "n".into(), max: 20 };
    program.args.insert("n".into(), ArgType::Int);
    program.body = vec![Stmt::Return(Expr::Scan(scan))];
    let certificate = Checker::new(&schema, Ceilings::default()).check(&program).unwrap();
    reconcile(&certificate);
    assert_eq!(certificate.read_sites[0].take, 20);
    let mut engine = Engine::memory(schema).unwrap();
    seed_flagged(&mut engine, 5, |_| "wide".into(), |_| false, 1);
    for (n, rows_returned, state) in [(2, 2, ExecutionState::Capped), (20, 5, ExecutionState::Complete)] {
        let execution = engine.execute(&program, &certificate, Context::query(Actor::user("viewer").unwrap(), BTreeMap::from([("n".into(), Value::Int(n))]))).unwrap();
        let Value::Array(rows) = &execution.result else { panic!("page") };
        assert_eq!(rows.len(), rows_returned);
        assert_eq!(execution.state, state, "first {n} over five rows");
        assert!(execution.trace.examined <= certificate.max_examined);
        assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
    }
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
