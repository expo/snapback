//! Native on/off records for the web gates, plus explicit refusal boundaries.
mod common;
use common::*;
use serde_json::{json, Value as Json};
use snapback4_core::{Ceilings, Context, Value};
use snapback4_core::ir::{ArgType, Expr, ProgramKind, Stmt};
use snapback4_device::{device::{Backend, Device}, memory::MemoryStore};
use std::collections::BTreeMap;
use std::path::Path;

#[test]
fn structural_admission_stays_on_the_server_and_native_device() {
    let source = "query answer():\n  return 7\n";
    let (mut server, mut backend) = compile(source);
    let scan = snapback4_core::ir::Scan { site: "missing".into(), table: "missing".into(), index: "byId".into(), prefix: vec![], order: snapback4_core::ir::Order::Asc, take: snapback4_core::ir::Bound::Literal(1), after: None, before: None, range: None, filter: None, opaque_cursor: false, merge_site: None, provenance: snapback4_core::ir::KeyProvenance::Const };
    backend.programs[0].body.insert(0, Stmt::If { condition: Expr::Literal(Value::Bool(false)), then_body: vec![Stmt::Return(Expr::Scan(scan))], else_body: vec![] });
    let program = &backend.programs[0];
    assert_eq!(snapback4_core::engine::admission::check(&backend.schema, program).unwrap_err().code(), "E_UNBOUND_SCAN");
    assert_eq!(snapback4_core::engine::validate::validate_inputs(&backend.schema, program, &mut BTreeMap::new()).unwrap_err().code(), "E_UNBOUND_SCAN");
    assert_eq!(server.query("answer", Context::new("A", BTreeMap::new())).unwrap().data, Value::Int(7));
    for host in ["memory", "sqlite"] {
        let sqlite = Sqlite::new("diet-admission");
        let request = json!({"op":"query","name":"answer","viewer":"A","now":1});
        let reply = if host == "memory" {
            let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
            snapback4_device::call::call(&mut device, request)
        } else {
            let mut device = Device::open(&sqlite.path("device"), Some(backend.clone())).unwrap();
            snapback4_device::call::call(&mut device, request)
        };
        if cfg!(feature = "web-device-check") { assert_eq!(reply["ok"]["data"], 7, "{reply}"); }
        else { assert_eq!(reply["ok"]["denied"]["code"], "E_UNBOUND_SCAN", "{reply}"); }
    }
}

fn input(kind: &ArgType, world: usize) -> Value {
    match kind {
        ArgType::Bool => Value::Bool(world != 0),
        ArgType::Int => Value::Int(world as i64),
        ArgType::Text { min, .. } => Value::String("x".repeat((*min).max(1) as usize)),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => id("A"),
        ArgType::Time => Value::Int(1000),
        ArgType::Optional(inner) => if world == 0 { Value::Null } else { input(inner, world) },
        ArgType::List { .. } => Value::Array(vec![]),
        ArgType::Enum { variants } => Value::String(variants[0].clone()),
        _ => Value::Null,
    }
}

fn files(path: &Path, extension: &str, out: &mut Vec<std::path::PathBuf>) {
    let mut entries = std::fs::read_dir(path).unwrap().map(|entry| entry.unwrap().path()).collect::<Vec<_>>();
    entries.sort();
    for path in entries {
        if path.file_name().is_some_and(|name| ["node_modules", "target", "generated", ".snapback4"].contains(&name.to_string_lossy().as_ref())) { continue; }
        if path.is_dir() { files(&path, extension, out); }
        else if path.extension().is_some_and(|ext| ext == extension) { out.push(path); }
    }
}

fn sources() -> BTreeMap<String, Vec<(String, String)>> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut sources: BTreeMap<String, Vec<(String, String)>> = include_str!("../../snapback4-lang/tests/lowering/r1p-sources.jsonl").lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    let mut quarry = Vec::new();
    files(&root.join("apps"), "q", &mut quarry);
    files(&root.join("crates/snapback4-device/tests"), "q", &mut quarry);
    for path in quarry {
        let group = path.parent().unwrap().strip_prefix(&root).unwrap().to_string_lossy().into_owned();
        sources.entry(format!("current:{group}")).or_default().push((path.file_name().unwrap().to_string_lossy().into_owned(), std::fs::read_to_string(path).unwrap()));
    }
    sources
}

// With DIET_RECORD set, run once normally and once with web-device-check,
// then compare the files. Compiler-refused source bundles are counted
// separately, not counted as executions. Empty-store calls supplement, rather than replace, the seeded
// scenarios in device.rs and the web client suite.
#[test]
#[ignore = "explicit native on/off differential: set DIET_RECORD and use --include-ignored"]
fn fixture_outcomes_and_query_meters() {
    let mut records = BTreeMap::new();
    let mut programs = 0;
    let mut observations = 0;
    let mut success = 0;
    let mut refused_sources = 0;
    for (label, sources) in sources() {
        let compiled = snapback4_lang::compile(&sources);
        if !compiled.diagnostics.is_empty() { refused_sources += 1; continue; }
        let backend = Backend { generation: 1, schema: compiled.schema, programs: compiled.programs.into_iter().map(|bound| bound.program).collect() };
        for program in &backend.programs {
            if program.native || !matches!(program.kind, ProgramKind::Query | ProgramKind::Mutation) { continue; }
            programs += 1;
            for world in 0..2 {
                let mut device = Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap();
                let acquired = snapback4_device::call::call(&mut device, json!({"op":"apply","first":true,"page":{"snapshot":true,"events":[],"held":{},"watermark":1,"generation":1,"more":false}}));
                assert!(acquired.get("denied").is_none(), "{label}: {acquired}");
                device.store().drain();
                let args = Json::Object(program.args.iter().map(|(name, kind)| (name.clone(), snapback4_core::wire::to_json(&input(kind, world)))).collect());
                let outcome = if program.kind == ProgramKind::Query {
                    let (result, unknown, retained, components) = device.query_with_components(&program.name, "A", &args, 1000);
                    if result.is_ok() { success += 1; }
                    json!({"query":result,"unknown":unknown,"retained":retained,"components":components})
                } else {
                    let result = device.predict(&program.name, "A", &args, 1000, (0..2048).map(|n| format!("{n:026}")).collect(), 1).map_err(|error| error.refusal());
                    if result.is_ok() { success += 1; }
                    json!({"prediction":result,"changes":device.store().drain()})
                };
                records.insert(format!("{label}:{}:{world}", program.name), outcome);
                observations += 1;
            }
        }
    }
    assert!(programs > 100 && success > 50, "{programs} programs, {success} positive observations");
    if let Ok(path) = std::env::var("DIET_RECORD") { std::fs::write(path, serde_json::to_vec(&records).unwrap()).unwrap(); }
    println!("device diet differential: {programs} programs; {observations} observations; {success} successes; {refused_sources} source bundles with compiler diagnostics excluded");
}

#[test]
fn partition_accounting_keeps_the_step_refusal_boundary() {
    use snapback4_device::store::{DeviceStore, DeviceTx};
    let (_, backend) = compile("table notes:\n  n: int\n  public 'notes'\n  sync public\n  insert <- allow\nmutation add():\n  insert notes { n: 1 }\n");
    fn boundaries<S: DeviceStore>(mut store: S, backend: &Backend) -> Vec<Result<Json, snapback4_core::error::Refusal>> {
        store.install(&backend.schema, &BTreeMap::new(), false).unwrap();
        let mut records = Vec::new();
        for steps in 0..24 {
            let tx = store.transaction().unwrap();
            let outcome = snapback4_core::engine::local::predict(&tx, &backend.schema, &backend.programs[0], Context::new("A", BTreeMap::new()).at(1000).with_ids(["new-row".into()]), Ceilings { steps, ..Ceilings::default() });
            records.push(outcome.map(|prediction| json!({"result":prediction.result,"written":prediction.written,"read":prediction.read})).map_err(|error| error.refusal()));
            tx.rollback().unwrap();
        }
        records
    }
    let records = boundaries(snapback4_core::store::Store::memory().unwrap(), &backend);
    assert_eq!(records, boundaries(MemoryStore::new(), &backend));
    assert_eq!(records.iter().position(Result::is_ok), Some(11), "the discarded partition event still costs one step");
    assert!(records.iter().any(|outcome| outcome.as_ref().is_err_and(|why| why.code == "E_BOUND")), "{records:?}");
    if let Ok(path) = std::env::var("DIET_RECORD") { std::fs::write(format!("{path}.bounds"), serde_json::to_vec(&records).unwrap()).unwrap(); }
}
