use super::{Context, runner::Runner, presence::Dependencies};
use crate::{ir::*, schema::*, rows::{MemoryRows, Rows}, meter::{Ceilings, Cut, Meter}, value::{Value, object}, smallmap::{SmallMap, SHIFTED}};
use std::{collections::BTreeMap, time::Instant};
fn shuffled(n: usize) -> Vec<usize> {
    let mut values: Vec<_> = (0..n).collect(); let mut seed = 7_u64;
    for i in (1..n).rev() { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; values.swap(i, seed as usize % (i + 1)); } values
}
fn schema() -> Schema {
    Schema { tables: [("rows".into(), public_table(SmallMap::from([("id".into(), ColumnType::Id)]), SmallMap::from([("byId".into(), Index::of(&["id"], true))])))].into(), ..Schema::default() }
}
fn scan(filter: Expr) -> Scan {
    Scan { site: "filtered".into(), table: "rows".into(), index: "byId".into(), prefix: vec![], order: Order::Asc, take: Bound::Literal(8192), after: None, before: None, range: None, filter: Some(Box::new(filter)), opaque_cursor: false, merge_site: None, provenance: KeyProvenance::Const }
}
fn runner<'a>(rows: &'a MemoryRows, schema: &'a Schema, width: usize) -> Runner<'a> {
    let args: BTreeMap<_, _> = (0..width).map(|i| (format!("binding{i:04}"), Value::Int(i as i64))).collect();
    Runner::new(rows, schema, Context::new("alice", args), Meter::new(Ceilings::default(), Cut::Abort), 0)
}
fn median(mut times: Vec<f64>) -> f64 { times.sort_by(f64::total_cmp); times[times.len() / 2] }
#[test]
fn shuffled_presence_dependencies_are_not_small() {
    let (rows, schema) = (MemoryRows::new(), Schema::default()); let mut run = runner(&rows, &schema, 0);
    run.effect_presence.enabled = true; run.env.insert("target".into(), Value::Array(Vec::new()));
    let started = Instant::now();
    for i in shuffled(8192) {
        run.effect_presence.reads.clear(); run.grace_read(&format!("principal{i:05}"), Some(i as i64)).unwrap(); run.push_presence_value("target").unwrap();
    }
    let deps = &run.effect_presence.variables["target"]; assert_eq!(deps.len(), 8192);
    for i in 0..8192 { assert_eq!(deps[&format!("principal{i:05}")], Some(i as i64)); }
    println!("presence principals=8192 ms={:.3} heap={}", started.elapsed().as_secs_f64() * 1000., run.meter.used.heap_bytes);
    assert_eq!(std::any::type_name::<Dependencies>(), std::any::type_name::<BTreeMap<String, Option<i64>>>(), "principal cardinality is data, not program text");
}
#[test]
fn wide_filtered_scan_does_not_shift_environment_per_row() {
    let (rows, schema) = (MemoryRows::new(), schema());
    for i in 0..8192 { rows.put("rows", &schema.tables["rows"], &object([("id", Value::Id(format!("r{i:05}")))]), None).unwrap(); }
    let filter = Expr::Binary { op: BinaryOp::Eq, left: Box::new(field(var("$filter"), "id")), right: Box::new(Expr::Literal(Value::Id("absent".into()))) };
    let mut times = [Vec::new(), Vec::new()]; let mut shifts = 0;
    for trial in 0..7 { for index in if trial % 2 == 0 { [0, 1] } else { [1, 0] } {
        let mut run = runner(&rows, &schema, [8, 768][index]); run.meter.cut = Cut::Cap; SHIFTED.with(|n| n.set(0)); let started = Instant::now();
        assert_eq!(run.expr(&Expr::Scan(scan(filter.clone()))).unwrap(), Value::Array(vec![]));
        times[index].push(started.elapsed().as_secs_f64()); shifts = shifts.max(SHIFTED.with(|n| n.get()));
        assert_eq!(run.filter_depth, 0); assert_eq!(run.meter.used.examined, 8192);
    } }
    let narrow = median(times[0].clone()); let wide = median(times[1].clone());
    println!("filter rows=8192 bindings=8/768 narrow_ms={:.3} wide_ms={:.3} ratio={:.3} shifted={shifts}", narrow*1000., wide*1000., wide/narrow);
    assert!(wide/narrow < 2.0, "a filter row must not make scan cost follow environment width");
    assert_eq!(shifts, 0, "transient filter rows must not shift authored bindings");
}
#[test]
fn wide_loop_replaces_its_binding_without_repeated_shifts() {
    let (rows, schema) = (MemoryRows::new(), Schema::default()); let mut times = [Vec::new(), Vec::new()];
    for trial in 0..7 { for index in if trial % 2 == 0 { [0, 1] } else { [1, 0] } {
        let mut run = runner(&rows, &schema, [8, 768][index]); SHIFTED.with(|n| n.set(0)); let started = Instant::now();
        run.statements(&[Stmt::For { binding: "a".into(), domain: LoopDomain::LiteralRange { start: 0, end_exclusive: 8192 }, body: vec![] }], "loop").unwrap();
        times[index].push(started.elapsed().as_secs_f64()); assert_eq!(run.env["a"], Value::Int(8191));
        assert_eq!(SHIFTED.with(|n| n.get()), 0, "execution bindings never use sorted vectors");
    } }
    let narrow = median(times[0].clone()); let wide = median(times[1].clone());
    println!("loop rows=8192 bindings=8/768 narrow_ms={:.3} wide_ms={:.3} ratio={:.3} shifted=0/0", narrow*1000., wide*1000., wide/narrow); assert!(wide/narrow < 2.5);
}

#[test]
fn filters_restore_nested_rows_helpers_shadowing_and_depth_on_error() {
    let (rows, schema) = (MemoryRows::new(), schema());
    rows.put("rows", &schema.tables["rows"], &object([("id", Value::Id("r".into()))]), None).unwrap();
    let mut run = runner(&rows, &schema, 0); run.meter.cut = Cut::Cap;
    run.env.insert("$filter".into(), Value::String("outer binding".into()));
    // Helpers are lowered to blocks; the inner scan must restore the row
    // before the helper's result borrows the outer filter's id.
    let inner = Expr::Scan(scan(Expr::Literal(Value::Bool(true))));
    let helper = Expr::Block { body: vec![Stmt::Let { name: "inner".into(), value: inner }], value: Box::new(Expr::Binary { op: BinaryOp::Eq, left: Box::new(field(var("$filter"), "id")), right: Box::new(Expr::Literal(Value::Id("r".into()))) }) };
    assert_eq!(run.expr(&Expr::Scan(scan(helper))).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(run.expr(&var("$filter")).unwrap(), Value::String("outer binding".into())); assert_eq!(run.filter_depth, 0);
    let err = Expr::Scan(scan(var("missing")));
    assert!(run.expr(&err).is_err()); assert_eq!(run.filter_depth, 0);
    assert_eq!(run.expr(&var("$filter")).unwrap(), Value::String("outer binding".into()));
    let shadow = Expr::Block { body: vec![Stmt::Let { name: "$filter".into(), value: Expr::Literal(Value::Bool(true)) }], value: Box::new(var("$filter")) };
    assert_eq!(run.expr(&Expr::Scan(scan(shadow))).unwrap().as_array().unwrap().len(), 1);
    assert_eq!(run.expr(&var("$filter")).unwrap(), Value::String("outer binding".into())); assert_eq!(run.filter_depth, 0);
}

#[test]
fn untaken_arm_bindings_never_shift_vectors() {
    let (rows, schema) = (MemoryRows::new(), Schema::default()); let mut times = [Vec::new(), Vec::new()];
    for trial in 0..7 { for index in if trial % 2 == 0 { [0, 1] } else { [1, 0] } {
        let width = [8, 768][index]; let mut run = runner(&rows, &schema, width);
        SHIFTED.with(|n| n.set(0)); let started = Instant::now();
        for _ in 0..8192 { run.charge_untaken(&[Stmt::Let { name: "a".into(), value: Expr::Literal(Value::Int(1)) }], "untaken").unwrap(); }
        times[index].push(started.elapsed().as_secs_f64());
        assert!(!run.env.contains_key("a")); assert_eq!(SHIFTED.with(|n| n.get()), 0);
    } }
    let narrow = median(times[0].clone()); let wide = median(times[1].clone());
    println!("untaken rows=8192 bindings=8/768 narrow_ms={:.3} wide_ms={:.3} ratio={:.3} max_shifts_per_binding_per_row=0 entry_bytes={}", narrow*1000., wide*1000., wide/narrow, std::mem::size_of::<(String, Value)>());
}

#[test]
fn execution_state_uses_btrees() {
    let (rows, schema) = (MemoryRows::new(), Schema::default());
    let run = runner(&rows, &schema, 8);
    assert_eq!(std::any::type_name_of_val(&run.env), std::any::type_name::<BTreeMap<String, Value>>(), "execution bindings are runtime state even when authored names bound their count");
    assert_eq!(std::any::type_name_of_val(&run.consts), std::any::type_name::<std::collections::BTreeSet<String>>());
    assert_eq!(std::any::type_name_of_val(&run.read_tables), std::any::type_name::<std::collections::BTreeSet<String>>());
    assert_eq!(std::any::type_name_of_val(&run.written_tables), std::any::type_name::<std::collections::BTreeSet<String>>());
    assert!(std::any::type_name_of_val(&run.pages).contains("btree"));
    assert!(std::any::type_name_of_val(&run.effect_presence.variables).contains("btree"));
    assert_eq!(run.env["binding0007"], Value::Int(7));
}

#[test]
fn reversed_program_activation_appends_without_shifts() {
    let programs: Vec<_> = (0..1000).rev().map(|n| Program { name: format!("p{n:04}"), kind: ProgramKind::Query, args: SmallMap::new(), body: vec![Stmt::Return(Expr::Literal(Value::Int(n)))], native: false, read_time_granularity_ms: None }).collect();
    SHIFTED.with(|n| n.set(0));
    let mut engine = super::Engine::new(crate::store::Store::memory().unwrap(), Schema::default(), programs).unwrap();
    assert_eq!(SHIFTED.with(|n| n.get()), 0, "server-provided programs must sort once before collecting");
    assert_eq!(engine.query("p0999", Context::new("alice", BTreeMap::new())).unwrap().data, Value::Int(999));
}
