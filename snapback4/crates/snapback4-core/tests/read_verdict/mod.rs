//! Runs the same read with either cut, including matching IR that mutation
//! admission deliberately refuses. Inspect private runner state on errors too.
use super::*;
use crate::{Context, Engine, Schema};
use crate::schema::{ColumnType, IndexComponent, RuleExpr, RuleTerm, Rules};
use crate::meter::{Ceilings, Cut, Meter};
use crate::value::object;
use serde_json::{json, Value as Json};
use std::collections::BTreeMap;

mod round2;
mod round3;
mod merge_continuation;

fn table() -> Table {
    Table { maintained: BTreeMap::new(), recorded: BTreeMap::new(), residency: Default::default(), defaults: BTreeMap::new(),
        columns: BTreeMap::from([("id".into(), ColumnType::Id), ("roomId".into(), ColumnType::Id), ("principal".into(), ColumnType::Principal), ("body".into(), ColumnType::Text { max: 100 })]),
        indexes: BTreeMap::from([("byId".into(), Index::of(&["id"], true)), ("byRoom".into(), Index::of(&["roomId", "id"], false)), ("byRoomPrincipal".into(), Index::of(&["roomId", "principal"], true))]),
        rules: Rules { read: RuleExpr::Deny, insert: RuleExpr::Allow, update: RuleExpr::Allow, delete: RuleExpr::Allow },
        constraints: vec![], leave: Default::default(), sync: None, expire: None }
}
fn probe(name: &str) -> RuleExpr {
    RuleExpr::Exists { table: name.into(), index: "byRoomPrincipal".into(), key: vec![RuleTerm::Field("roomId".into()), RuleTerm::Viewer], equalities: vec![], provenance: KeyProvenance::Const }
}
fn row(id: &str, room: &str, viewer: &str, body: &str) -> Value {
    object([("id", Value::Id(id.into())), ("roomId", Value::Id(room.into())), ("principal", Value::Id(viewer.into())), ("body", Value::String(body.into()))])
}
fn scan(words: bool) -> Scan {
    let mut prefix = vec![IndexKeyExpr::Scalar(Expr::Literal(Value::Id("r".into())))];
    if words { prefix.push(IndexKeyExpr::WordPrefix(Expr::Literal(Value::String("cof".into())))); }
    Scan { site: "page".into(), table: "messages".into(), index: if words { "byWords" } else { "byRoom" }.into(), prefix, order: Order::Asc, take: Bound::Literal(10), existence: false, after: None, before: None, range: None, filter: None, opaque_cursor: true, merge_site: None, provenance: KeyProvenance::Const }
}
fn observation(or: bool, admitted: bool, hidden: bool, words: bool, cut: Cut, remaining: u64) -> Json {
    let mut messages = table();
    messages.indexes.insert("byWords".into(), Index { components: vec![IndexComponent::Column("roomId".into()), IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: json!(crate::words::CONTRACT) }, IndexComponent::Column("id".into())], unique: false });
    let p = probe("secrets");
    let second = if admitted { RuleExpr::Not(Box::new(probe("permits"))) } else { probe("permits") };
    messages.rules.read = if or { RuleExpr::Not(Box::new(RuleExpr::Or(vec![p.clone(), second]))) } else { RuleExpr::And(vec![p.clone(), second]) };
    // AND: false/false or true/true; negated OR: false/false or true/true.
    if admitted && or { messages.rules.read = RuleExpr::Or(vec![p.clone(), RuleExpr::Not(Box::new(probe("permits")))]); }
    let schema = Schema { tables: BTreeMap::from([("messages".into(), messages), ("secrets".into(), table()), ("permits".into(), table())]), ..Schema::default() };
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    let mut seed = vec![("messages".into(), row("visible", "r", "author", "coffee"))];
    let first = if admitted && !or { true } else { hidden };
    if first { seed.push(("secrets".into(), row("secret", "r", "alice", "hidden"))); }
    if or && !admitted || admitted && !or && hidden { seed.push(("permits".into(), row("permit", if admitted { "elsewhere" } else { "r" }, "alice", "hidden"))); }
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut meter = Meter::new(Ceilings::default(), cut);
    meter.at("prelude");
    meter.charge(MeterKind::RuleProbes, Ceilings::default().rule_probes - remaining).unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("alice", BTreeMap::new()).at(100), meter, 0);
    let scan = scan(words);
    let expr = if words { Expr::Merge(Merge { position: None, view: None, order_keys: Vec::new(), site: "merge".into(), lanes: vec![MergeLane { distinct: None, branch: None, project: None, setup: vec![], source: None, binding: String::new(), scan }] }) } else { Expr::Scan(scan) };
    let program = Program { name: "read".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Return(expr)], native: false, returned_shapes: Default::default() };
    let result = runner.run(&program).and_then(|data| { runner.charge_output(&data)?; Ok(data) });
    let (data, error) = match result { Ok(data) => (crate::wire::to_json(&data), Json::Null), Err(error) => (Json::Null, json!(error.refusal())) };
    json!({"data": data, "error": error, "complete": runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.beyond_horizon,
        "next": runner.next_cursor().unwrap(), "capped_at": runner.meter.capped_at, "metered": runner.meter.used, "tables": runner.read_tables, "nextExpiry": runner.next_expiry})
}
#[test]
fn r1a_short_circuit_dependencies_match_complete_observations() { paired(false); }
#[test]
fn r1a_w5_static_allowance_already_matches_every_meter_and_error() { paired(true); }
fn paired(meter_only: bool) {
    for or in [false, true] { for admitted in [false, true] { for words in [false, true] { for cut in [Cut::Cap, Cut::Abort] { for remaining in [8192, 1] {
        let mut left = observation(or, admitted, false, words, cut, remaining);
        let mut right = observation(or, admitted, true, words, cut, remaining);
        if meter_only { left.as_object_mut().unwrap().remove("tables"); right.as_object_mut().unwrap().remove("tables"); }
        assert_eq!(left, right, "or={or}, admitted={admitted}, words={words}, cut={cut:?}, remaining={remaining}");
        if remaining == 8192 { assert_eq!(left["metered"]["rule_probes"], 2); assert_eq!(left["data"].as_array().unwrap().len(), usize::from(admitted)); }
        else { assert_eq!(left["metered"]["rule_probes"], 8193); if cut == Cut::Abort { assert_eq!(left["error"]["code"], "E_BOUND"); } }
    }}}}}
}

#[test]
fn r1a_repeated_site_cannot_reuse_a_word_verdict_for_a_nested_read() {
    for words in [1, 12] { for allowed in [false, true] {
        let mut messages = table();
        messages.rules.read = probe("permits");
        messages.indexes.insert("byWords".into(), Index { components: vec![IndexComponent::Column("roomId".into()), IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: json!(crate::words::CONTRACT) }, IndexComponent::Column("id".into())], unique: false });
        let mut secrets = table();
        secrets.rules.read = if allowed { RuleExpr::Allow } else { RuleExpr::Deny };
        let schema = Schema { tables: BTreeMap::from([("messages".into(), messages), ("secrets".into(), secrets), ("permits".into(), table())]), ..Schema::default() };
        let mut engine = Engine::memory(schema.clone(), []).unwrap();
        let mut seed = vec![("secrets".into(), row("secret", "r", "alice", "hidden")), ("permits".into(), row("permit", "r", "alice", "permit"))];
        for n in 0..words { seed.push(("messages".into(), row(&format!("m{n}"), "r", &format!("author{n}"), &format!("cof{n:02}")))); }
        engine.seed(seed).unwrap();
        let nested = Scan { table: "secrets".into(), ..scan(false) }; // Deliberately the SAME site.
        let mut outer = scan(true);
        outer.take = Bound::Literal(50);
        outer.filter = Some(Box::new(Expr::Binary { op: BinaryOp::Gt, left: Box::new(Expr::Builtin { builtin: Builtin::Count, args: vec![Expr::Scan(nested)] }), right: Box::new(Expr::Literal(Value::Int(0))) }));
        let tx = engine.store_mut().transaction().unwrap();
        let mut runner = Runner::new(&tx, &schema, Context::new("alice", BTreeMap::new()).at(100), Meter::new(Ceilings::default(), Cut::Cap), 0);
        assert_eq!(runner.scan(&outer).unwrap().len(), if allowed { words } else { 0 }, "words={words}, allowed={allowed}");
    }}
}

fn observe_read(schema: Schema, seed: Vec<(String, Value)>, expr: Expr, cut: Cut) -> Json {
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, &schema, Context::new("alice", BTreeMap::new()).at(100), Meter::new(Ceilings::default(), cut), 0);
    let program = Program { name: "read".into(), kind: ProgramKind::Query, args: BTreeMap::new(), read_time_granularity_ms: None, body: vec![Stmt::Return(expr)], native: false, returned_shapes: Default::default() };
    let result = runner.run(&program).and_then(|data| { runner.charge_output(&data)?; Ok(data) });
    let (data, error) = match result { Ok(data) => (crate::wire::to_json(&data), Json::Null), Err(error) => (Json::Null, json!(error.refusal())) };
    json!({"data":data,"error":error,"complete":runner.meter.capped_at.is_none() && !runner.non_uniform && !runner.page_overflow,"next":runner.next_cursor().unwrap(),"capped_at":runner.meter.capped_at,"metered":runner.meter.used,"tables":runner.read_tables,"nextExpiry":runner.next_expiry})
}

#[test]
fn r1a_prefix_conjunction_denial_matches_with_cap_and_abort() {
    for cut in [Cut::Cap, Cut::Abort] { for words in [false, true] {
        let mut observations = Vec::new();
        for population in [0, 33] {
            let mut messages = table();
            messages.rules.read = RuleExpr::And(vec![probe("permits"), RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer)]);
            messages.indexes.insert("byWords".into(), Index { components: vec![IndexComponent::Column("roomId".into()), IndexComponent::WordPrefixes { fields: vec!["body".into()], contract: json!(crate::words::CONTRACT) }, IndexComponent::Column("id".into())], unique: false });
            let schema = Schema { tables: BTreeMap::from([("messages".into(), messages), ("permits".into(), table())]), ..Schema::default() };
            let mut seed = vec![("permits".into(), row("permit", "visible", "alice", "permit")), ("messages".into(), row("shown", "visible", "alice", "coffee")), ("messages".into(), row("private", "visible", "bob", "coffee"))];
            for n in 0..population { seed.push(("messages".into(), row(&format!("m{n}"), "r", &format!("other{n}"), &format!("cof{n:02}")))); }
            let hidden = scan(words);
            let mut visible = hidden.clone();
            visible.prefix[0] = IndexKeyExpr::Scalar(Expr::Literal(Value::Id("visible".into())));
            let lanes = [hidden, visible].into_iter().map(|scan| MergeLane { distinct: None, branch: None, project: None, scan, setup: vec![], source: None, binding: String::new() }).collect();
            observations.push(observe_read(schema, seed, Expr::Merge(Merge { position: None, view: None, order_keys: Vec::new(), site: "merge".into(), lanes }), cut));
        }
        assert_eq!(observations[0], observations[1], "words={words}, cut={cut:?}");
        assert_eq!(observations[0]["data"].as_array().unwrap().len(), 1);
        assert_eq!(observations[0]["data"][0]["id"], "shown");
        assert_eq!(observations[0]["complete"], false);
        println!("R1a prefix denial words={words}, cut={cut:?}: {}", observations[0]["metered"]);
    }}
}

#[test]
fn r1a_per_row_rules_register_all_dependency_tables() {
    for point in [false, true] {
        let mut observations = Vec::new();
        for hidden in [false, true] {
            let mut messages = table();
            messages.rules.read = RuleExpr::And(vec![probe("secrets"), probe("permits"), RuleExpr::Eq(RuleTerm::Field("principal".into()), RuleTerm::Viewer)]);
            let schema = Schema { tables: BTreeMap::from([("messages".into(), messages), ("secrets".into(), table()), ("permits".into(), table())]), ..Schema::default() };
            let mut seed = vec![("messages".into(), row("hidden", "r", "alice", "coffee"))];
            if hidden { seed.push(("secrets".into(), row("secret", "r", "alice", "hidden"))); }
            let expr = if point { Expr::Get(Read { site: "point".into(), table: "messages".into(), index: "byId".into(), key: vec![Expr::Literal(Value::Id("hidden".into()))], provenance: KeyProvenance::Const }) } else { Expr::Scan(Scan { index: "byId".into(), prefix: vec![], ..scan(false) }) };
            let observed = observe_read(schema, seed, expr, Cut::Cap);
            assert_eq!(observed["tables"], json!(["messages", "permits", "secrets"]));
            observations.push(observed);
        }
        assert_eq!(observations[0]["data"], observations[1]["data"]);
    }
}
