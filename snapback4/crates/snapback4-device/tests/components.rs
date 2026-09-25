//! Run the same coverage observation on SQLite and the wasm memory store.
mod common;
#[path = "components/retained_words.rs"]
mod retained_words;
use common::*;
use snapback4_core::{engine::local, error::RuntimeError, meter::Ceilings, rows::{Rows, Bounds, Dir}, schema::{Index, Table}, value::Value};
use snapback4_device::store::{DeviceStore, DeviceTx};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  sync to .principal
table messages:
  room: text <=40
  at: time
  body: text <=1000
  by byTime: room, at, id
  by byWords: room, words(body), at, id
  read <- allow
  sync public last 25 by byTime
fn history(room: text <=40): messages[room] last 50 by byTime
query both():
  left = history('left')
  held = history('held')
  return {left, held}
query capGuard():
  left = history('left')
  require true else NO
  held = history('held')
  return {left, held}
query scalar():
  left = history('left')
  held = history('held')
  return {left: count(left), held: first(held)}
query empty():
  return {left: messages['empty'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query point():
  return {left: messages['absent'], held: messages['held'] last 50 by byTime}
query guard():
  require exists messages['held-25'] else NO
  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query unknownGuard():
  require not exists messages['absent'] else NO
  return {left: messages['left'] last 50 by byTime, held: messages['held'] last 50 by byTime}
query overflow():
  return {left: messages['left'] last 1 by byTime, held: messages['held'] last 50 by byTime}
query words():
  return {left: messages['left'] matching 'co' last 50 by byWords, held: messages['held'] last 50 by byTime}
query discarded():
  ignored = messages['held'] last 50 by byTime
  return {left: messages['left'] last 50 by byTime, other: 1}
"#;

struct Retained<'a>(&'a dyn Rows);
impl Rows for Retained<'_> {
    fn retained_group(&self, _: &str, _: &str, prefix: &[Value]) -> Result<bool, RuntimeError> { Ok(prefix.first().is_some_and(|value| matches!(value.as_str(), Ok("left" | "empty")))) }
    fn get(&self, table: &str, id: &str) -> Result<Option<Value>, RuntimeError> { self.0.get(table, id) }
    fn lookup(&self, table: &str, name: &str, index: &Index, key: &[Value]) -> Result<Option<Value>, RuntimeError> { self.0.lookup(table, name, index, key) }
    fn scan(&self, table: &str, index: &str, prefix: &[Value], bounds: &Bounds, dir: Dir, limit: usize) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.0.scan(table, index, prefix, bounds, dir, limit) }
    fn scan_metered(&self, t: &str, i: &str, p: &[Value], b: &Bounds, d: Dir, l: usize, meter: &mut snapback4_core::meter::Meter) -> Result<Vec<(Value, Vec<u8>)>, RuntimeError> { self.0.scan_metered(t, i, p, b, d, l, meter) }
    fn count_prefix(&self, table: &str, index: &str, prefix: &[Value], limit: u64) -> Result<u64, RuntimeError> { self.0.count_prefix(table, index, prefix, limit) }
    fn put(&self, name: &str, table: &Table, row: &Value, old: Option<&Value>) -> Result<u64, RuntimeError> { self.0.put(name, table, row, old) }
    fn delete(&self, name: &str, table: &Table, old: &Value) -> Result<u64, RuntimeError> { self.0.delete(name, table, old) }
}

fn frames<S: DeviceStore>(mut store: S) {
    let (_, backend) = compile(SOURCE);
    store.install(&backend.schema, &Default::default(), true).unwrap();
    let tx = store.transaction().unwrap();
    for room in ["left", "held"] {
        tx.put("members", &backend.schema.tables["members"], &snapback4_core::value::object([("id", id(&format!("member-{room}"))), ("room", Value::String(room.into())), ("principal", id("viewer"))]), None).unwrap();
    }
    for room in ["left", "held"] { for at in 1..26 {
        let body = if at == 1 { (0..40).map(|n| format!("coffee{n}")).collect::<Vec<_>>().join(" ") } else { "coffee".into() };
        let row = snapback4_core::value::object([("id", id(&format!("{room}-{at}"))), ("room", Value::String(room.into())), ("at", Value::Int(at)), ("body", Value::String(body))]);
        tx.put("messages", &backend.schema.tables["messages"], &row, None).unwrap();
    } }
    let rows = Retained(&tx);
    let mut comparisons = 0;
    for program in &backend.programs {
        let fact = &backend.schema.operations[&program.name];
        if matches!(program.name.as_str(), "discarded" | "guard" | "unknownGuard") {
            assert!(fact.components.is_empty());
            let (_, _, _, components) = local::query_with_components(&rows, &backend.schema, program, context("viewer", &[]).at(100), Ceilings::default());
            assert!(components.is_empty());
            if program.name == "unknownGuard" {
                let mut forced = backend.schema.clone();
                forced.operations.get_mut(&program.name).unwrap().components = vec![snapback4_core::schema::Component { field: "left".into(), statements: vec![] }, snapback4_core::schema::Component { field: "held".into(), statements: vec![] }];
                let (_, _, _, components) = local::query_with_components(&rows, &forced, program, context("viewer", &[]).at(100), Ceilings::default());
                assert!(components.is_empty(), "the shared reading frame still withholds an unclean forced plan");
            }
            continue;
        }
        assert_eq!(fact.components.len(), 2, "{}", program.name);
        let mut stripped = backend.schema.clone();
        stripped.operations.get_mut(&program.name).unwrap().components.clear();
        for ceilings in [Ceilings::default(), Ceilings { examined: 3, ..Ceilings::default() }, Ceilings { examined: 30, ..Ceilings::default() }, Ceilings { heap_bytes: 100, ..Ceilings::default() }, Ceilings { output_bytes: 1, ..Ceilings::default() }] {
            let context = || context("viewer", &[]).at(100);
            let (actual, unknown, retained, components, facts) = local::observe_query(&rows, &backend.schema, program, context(), ceilings, true);
            let (baseline, baseline_unknown, baseline_retained, no_components) = local::query_with_components(&rows, &stripped, program, context(), ceilings);
            assert_eq!((&actual, unknown, retained), (&baseline, baseline_unknown, baseline_retained), "{} {ceilings:?}", program.name);
            assert!(no_components.is_empty());
            comparisons += 1;
            if ceilings != Ceilings::default() {
                if program.name == "both" && matches!(ceilings.examined, 3 | 30) {
                    assert!(!components["held"].complete, "a component after a cap is incomplete");
                    assert_eq!(components["left"].retained, ceilings.examined == 30, "a completed binding survives a later cap");
                    let left = actual.as_ref().unwrap().data.field("left").unwrap().as_array().unwrap().len();
                    assert_eq!(left, if ceilings.examined == 3 { 3 } else { 25 }, "the first or second binding reaches the cap");
                }
                if program.name == "capGuard" && ceilings.examined == 3 { assert!(!components["held"].complete, "a reading binding starting after the cap is incomplete"); }
                if ceilings.output_bytes == 1 { assert!(components.is_empty(), "shared output charging withholds components"); }
                continue;
            }
            assert!(facts.held, "authorized rows/retained groups are provenance even for scalars");
            assert_eq!(facts.speculative, program.name == "point", "only the past-horizon point is a placeholder");
            if program.name != "point" {
                assert!(components["left"].held);
                assert!(!components["left"].speculative);
                assert!(!components["held"].speculative, "a horizon scan is partial data, even when empty");
            }
            match program.name.as_str() {
                "both" | "scalar" | "empty" | "guard" | "capGuard" => { assert!(components["left"].retained); assert!(!components["left"].unknown); assert!(components["held"].unknown); }
                "point" => assert!(components["left"].unknown),
                "unknownGuard" => assert!(components.is_empty(), "an unknown passing guard withholds coverage"),
                "words" => { assert!(components["left"].retained); assert!(!components["left"].unknown); assert!(actual.as_ref().unwrap().word_cut_at.is_none()); }
                "overflow" => { assert!(!components["left"].retained); assert!(!components["left"].complete); }
                _ => unreachable!(),
            }
        }
    }
    // The positive uniform word component above retains its coverage. A row-rule
    // control still loses it to the 32-word cut, with the same readable rows.
    let source = SOURCE.to_owned()
        .replace("  body: text <=1000", "  author: principal default 'viewer'\n  body: text <=1000")
        .replace("read <- allow", "read <- exists members[.room, viewer] and .author = viewer").replace("  sync public last 25 by byTime", "  online only");
    let (_, control) = compile(&source);
    let program = control.programs.iter().find(|p| p.name == "words").unwrap();
    let (page, _, _, components) = local::query_with_components(&rows, &control.schema, program, context("viewer", &[]).at(100), Ceilings::default());
    assert!(page.unwrap().word_cut_at.is_some());
    assert!(!components["left"].retained && !components["left"].complete);
    println!("component differential: {comparisons} comparisons; 0 differences");
    tx.rollback().unwrap();
}

#[test]
fn component_frames_uniform_words_and_nonuniform_cuts_memory() { frames(snapback4_device::memory::MemoryStore::new()); }
#[test]
fn component_frames_uniform_words_and_nonuniform_cuts_sqlite() {
    let host = Sqlite::new("component-frames");
    let path = host.path("frames");
    let (_, backend) = compile(SOURCE);
    drop(snapback4_device::device::Device::open(&path, Some(backend)).unwrap());
    frames(snapback4_core::Store::open(&path).unwrap());
}

#[test]
fn conformance_programs_keep_whole_query_outcomes_with_plans() {
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../corpus");
    let mut comparisons = 0;
    let mut planned = 0;
    let mut independent = false;
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if matches!(path.file_name().and_then(|name| name.to_str()), Some("manifest.json" | "ir-contract.json")) { continue; }
        if path.extension().is_none_or(|extension| extension != "json") { continue; }
        let case: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        let mut schema: snapback4_core::Schema = serde_json::from_value(case["schema"].clone()).unwrap();
        let program: snapback4_core::Program = match serde_json::from_value(case["program"].clone()) {
            Ok(program) => program,
            Err(error) => {
                let legacy = ["search-people-simple-fold.json", "search-chat-optional-field-union-next.json", "search-held-global-first-page.json", "search-chat-optional-field-union.json", "search-held-global-first-page-next.json", "search-empty-is-not-wildcard.json", "search-people-independent-q.json"];
                assert!(legacy.contains(&path.file_name().unwrap().to_str().unwrap()), "{}: unexpected IR: {error}", path.display());
                println!("component differential excluded {}: legacy IR cannot load: {error}", path.display());
                continue;
            }
        };
        let fact = snapback4_lang::bind::residency::execution(&schema, &program);
        if path.file_name().unwrap() == "component-independent-record.json" { assert_eq!(fact.components.len(), 2); independent = true; }
        if fact.components.is_empty() { continue; }
        planned += 1;
        let rows = snapback4_core::rows::MemoryRows::new();
        for row in case["receipt"]["rows"].as_array().into_iter().flatten() {
            let table = row["table"].as_str().unwrap();
            let value = serde_json::from_value(row["row"].clone()).unwrap();
            rows.put(table, &schema.tables[table], &value, None).unwrap();
        }
        let args: BTreeMap<String, Value> = if case["context"]["args"].is_null() { BTreeMap::new() } else { serde_json::from_value(case["context"]["args"].clone()).unwrap() };
        let mut context = snapback4_core::Context::new(case["context"]["viewer"].as_str().unwrap(), args).at(case["context"]["now"].as_i64().unwrap_or(100));
        context.read_time = case["context"]["read_time"].as_i64();
        schema.operations.insert(program.name.clone(), fact);
        let (result, unknown, retained, _) = local::query_with_components(&rows, &schema, &program, context.clone(), Ceilings::default());
        let before = (result, unknown, retained);
        schema.operations.get_mut(&program.name).unwrap().components.clear();
        let after = local::query_with_coverage(&rows, &schema, &program, context, Ceilings::default());
        assert_eq!(before, after, "{}", path.display());
        comparisons += 1;
        if path.file_name().unwrap() == "component-independent-record.json" { println!("component-independent-record.json: 2 fields; 1 differential comparison; 0 differences"); }
    }
    println!("corpus component differential: {planned} planned programs; {comparisons} comparisons; 0 differences");
    assert!(independent, "component-independent-record.json must participate in the differential");
}

#[test]
fn empty_and_scalar_retained_components_have_provenance_without_row_shaped_values() {
    let (_, backend) = compile(SOURCE);
    let memory = snapback4_core::rows::MemoryRows::new();
    let rows = Retained(&memory);
    for name in ["empty", "scalar"] {
        let program = backend.programs.iter().find(|p| p.name == name).unwrap();
        let (answer, unknown, _, components, facts) = local::observe_query(&rows, &backend.schema, program, context("viewer", &[]).at(100), Ceilings::default(), true);
        assert!(unknown);
        assert!(facts.held && !facts.speculative);
        assert!(components["left"].retained && components["left"].held && !components["left"].speculative);
        assert!(components["held"].unknown && !components["held"].speculative && !components["held"].held);
        let data = answer.unwrap().data;
        assert_eq!(data.field("left").unwrap(), &if name == "empty" { Value::Array(vec![]) } else { Value::Int(0) });
        assert_eq!(data.field("held").unwrap(), &if name == "empty" { Value::Array(vec![]) } else { Value::Null });
    }
}
