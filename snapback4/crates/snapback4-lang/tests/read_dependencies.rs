// @ref LLP 3000.029#9 — the dependency oracle reads compiled declarations,
// not the production footprint walker or its cached execution facts.
use serde_json::{Value as Json, json};
use snapback4_core::{engine::{Context, Engine}, ir::ProgramKind, value::Value};
use snapback4_device::{device::{Backend, Device}, memory::MemoryStore};
use std::collections::{BTreeMap, BTreeSet};
#[allow(dead_code)]
#[path = "../../snapback4/src/sync_wire.rs"]
mod sync_wire;

fn table_fields(value: &Json, out: &mut BTreeSet<String>) {
    match value {
        Json::Object(fields) => {
            if let Some(Json::String(table)) = fields.get("table") { out.insert(table.clone()); }
            for value in fields.values() { table_fields(value, out); }
        }
        Json::Array(values) => for value in values { table_fields(value, out); },
        _ => {}
    }
}
fn expected(schema: &Json, body: &Json) -> BTreeSet<String> {
    let mut graph = BTreeMap::<String, BTreeSet<String>>::new();
    for (name, table) in schema["tables"].as_object().unwrap() {
        let edges = graph.entry(name.clone()).or_default();
        table_fields(&table["rules"]["read"], edges);
        if let Some(parent) = table["through"]["parent"].as_str() { edges.insert(parent.into()); }
    }
    for maintain in schema["maintains"].as_array().unwrap() {
        let target = maintain["private"]["table"].as_str().unwrap_or_else(|| maintain["target"].as_str().unwrap());
        let edges = graph.entry(target.into()).or_default();
        edges.insert(maintain["source"].as_str().unwrap().into());
        for key in [&maintain["row_key"]["table"], &maintain["parent_key"]["parent"]] {
            if let Some(table) = key.as_str() { edges.insert(table.into()); }
        }
    }
    for timeline in schema["timelines"].as_array().into_iter().flatten() {
        let owned: Vec<_> = timeline["owned"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_owned()).collect();
        let mut sources = owned.clone();
        for role in ["posts", "reposts", "edges", "authors"] {
            if let Some(source) = timeline[role][0].as_str().filter(|s| !s.is_empty()) { sources.push(source.into()); }
        }
        for table in owned { graph.entry(table).or_default().extend(sources.iter().cloned()); }
    }
    let mut reachable = BTreeSet::new(); table_fields(body, &mut reachable);
    loop {
        let before = reachable.len();
        for name in reachable.clone() { reachable.extend(graph.get(&name).into_iter().flatten().cloned()); }
        if reachable.len() == before { return reachable; }
    }
}

fn row_key_census(source: &str, inherited: bool) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::to_value(&bound.schema).unwrap();
    let programs: Vec<_> = bound.programs.iter().map(|p| p.program.clone()).collect();
    let mut server = Engine::memory(bound.schema.clone(), programs.clone()).unwrap();
    let mut device = Device::open_store(MemoryStore::new(), Some(Backend { generation: 1, schema: bound.schema.public_projection(), programs: programs.clone() })).unwrap();
    let snapshot = server.snapshot_acquisition_page_at("alice", None, 1000, 1000).unwrap();
    assert!(snapshot.next.is_none());
    let page = serde_json::from_slice(&serde_json::to_vec(&sync_wire::SnapshotReply {
        now: 1000, sent: Default::default(), acknowledged: server.acknowledged("alice", &[], snapshot.watermark).unwrap(),
        acquisitions: snapshot.acquisitions, events: sync_wire::SyncEvents::Snapshot(snapshot.events),
        generation: server.generation(), store_id: server.store().meta("store_id").unwrap().unwrap(),
        held: snapshot.held, more: false, next: None, after: None, snapshot: true, watermark: snapshot.watermark,
    }).unwrap()).unwrap();
    device.apply(&page, true).unwrap();
    for program in programs.iter().filter(|p| p.kind == ProgramKind::Query) {
        let want = expected(&schema, &serde_json::to_value(&program.body).unwrap());
        if matches!(program.name.as_str(), "countFor" | "unreadFor" | "unreadRows") {
            let mut named = BTreeSet::from(["members".into(), "messages".into(), "unread".into()]);
            if inherited { named.insert("rooms".into()); }
            assert_eq!(want, named, "independent oracle must exercise the row-key edge");
        }
        let args = if program.name == "unreadFor" { json!({"member":"missing"}) } else { json!({}) };
        let context = Context::new("alice", if program.name == "unreadFor" { BTreeMap::from([("member".into(), Value::Id("missing".into()))]) } else { BTreeMap::new() }).at(1000);
        let remote: BTreeSet<_> = server.query(&program.name, context).unwrap().tables.into_iter().collect();
        let local: BTreeSet<_> = device.query(&program.name, "alice", &args, 1000).unwrap().tables.into_iter().collect();
        let compiled: BTreeSet<_> = bound.schema.operations[&program.name].reads.as_ref().unwrap().iter().cloned().collect();
        for (host, got) in [("compiler", compiled), ("server", remote.clone()), ("device", local.clone())] {
            assert!(want.is_subset(&got), "{host}:{} expected {want:?}, got {got:?}", program.name);
        }
        assert_eq!(remote, local, "{}: server/device metadata agrees", program.name);
    }
}

#[test]
fn row_keyed_view_census() { row_key_census(include_str!("fixtures/row-keyed-view.q"), false); }

#[test]
fn row_view_inherited_member_census() { row_key_census(include_str!("fixtures/row-view-inherited-member.q"), true); }

#[test]
fn timeline_reads_include_all_maintained_inputs_before_any_row_exists() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("fixtures/following-view.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::to_value(&bound.schema).unwrap();
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    for p in bound.programs.iter().filter(|p| p.program.kind == ProgramKind::Query) {
        let want = expected(&schema, &serde_json::to_value(&p.program.body).unwrap());
        for table in ["posts", "reposts", "follows", "feedWork"] { assert!(want.contains(table), "{}: {table}", p.program.name); }
        let compiled: BTreeSet<_> = bound.schema.operations[&p.program.name].reads.as_ref().unwrap().iter().cloned().collect();
        let output = engine.query(&p.program.name, Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(1000)).unwrap();
        assert!(want.is_subset(&compiled));
        assert!(want.is_subset(&output.tables.into_iter().collect()));
    }
}
#[test]
fn compiled_schema_census_preserves_private_maintained_sources_in_device_projection() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("fixtures/maintained-columns.q").into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::to_value(&bound.schema).unwrap();
    let programs: Vec<_> = bound.programs.iter().map(|p| p.program.clone()).collect();
    let mut server = Engine::memory(bound.schema.clone(), programs.clone()).unwrap();
    let mut device = Device::open_store(MemoryStore::new(), Some(Backend { generation: 1, schema: bound.schema.public_projection(), programs: programs.clone() })).unwrap();
    for program in programs.iter().filter(|p| p.kind == ProgramKind::Query) {
        let want = expected(&schema, &serde_json::to_value(&program.body).unwrap());
        assert_eq!(want, BTreeSet::from(["likes".into(), "posts".into()]));
        let args = if program.name == "postRow" { json!({"id":"missing"}) } else { json!({"c":null}) };
        let context = Context::new("alice", if program.name == "postRow" { BTreeMap::from([("id".into(), Value::Id("missing".into()))]) } else { BTreeMap::from([("c".into(), Value::Null)]) }).at(1000);
        let remote: BTreeSet<_> = server.query(&program.name, context).unwrap().tables.into_iter().collect();
        let local: BTreeSet<_> = device.query(&program.name, "alice", &args, 1000).unwrap().tables.into_iter().collect();
        let compiled: BTreeSet<_> = bound.schema.operations[&program.name].reads.as_ref().unwrap().iter().cloned().collect();
        for (host, got) in [("server", remote), ("device", local), ("compiler", compiled)] {
            assert!(want.is_subset(&got), "{host}:{} expected {want:?}, got {got:?}", program.name);
        }
    }
}


#[test]
fn transitive_sources_parent_authority_and_cycles_have_a_compiled_footprint() {
    let source = r#"table permits:
  root: roots
  principal: principal
  unique root, principal
  read <- allow
  online only
table roots:
  count: count votes by root
  read <- exists permits[.id, viewer]
  online only
table docs:
  root: roots
  immutable root
  read through .root
  online only
table children:
  doc: docs
  immutable doc
  read through .doc
  online only
table votes:
  root: roots
  immutable root
  read through .root
  online only
view totals: count children by .doc
fn child(): children['C']
query helper():
  return child()
query alternate():
  return children where .doc = 'D' first 10 by .id
query joined():
  return children where .doc = 'D' first 10 by .id { id, parent: docs[.doc] }
query conditional():
  return child() if false else null
query total():
  return totals['D']
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::to_value(&bound.schema).unwrap();
    let programs: Vec<_> = bound.programs.iter().map(|p| p.program.clone()).collect();
    let mut server = Engine::memory(bound.schema.clone(), programs.clone()).unwrap();
    let mut device = Device::open_store(MemoryStore::new(), Some(Backend { generation: 1, schema: bound.schema.public_projection(), programs: programs.clone() })).unwrap();
    for program in &programs {
        let want = expected(&schema, &serde_json::to_value(&program.body).unwrap());
        for table in ["children", "docs", "roots", "permits", "votes"] {
            assert!(want.contains(table), "{} must follow transitive sources through parents to {table}", program.name);
        }
        let remote: BTreeSet<_> = server.query(&program.name, Context::new("alice", BTreeMap::new()).at(1000)).unwrap().tables.into_iter().collect();
        let local: BTreeSet<_> = device.query(&program.name, "alice", &json!({}), 1000).unwrap().tables.into_iter().collect();
        assert!(want.is_subset(&remote), "{}: {want:?} > {remote:?}", program.name);
        assert_eq!(remote, local, "{}: projection preserves private source dependencies", program.name);
    }
}
