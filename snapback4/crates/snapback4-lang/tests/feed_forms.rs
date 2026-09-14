use snapback4_core::{Context, Engine, Value};
use snapback4_core::value::object;
use std::collections::BTreeMap;

fn source() -> String {
    let table = |name, rule| format!("table {name}:\n  owner: principal\n  at: time\n  body: text <=500\n  by byOwnerTime: owner, at, id\n  cap 100\n  read <- {rule}\n");
    format!("{}{}query page(c: cursor ?):\n  return merge inbox after c last 2 by byOwnerTime:\n    [viewer]\n    shared[viewer]\n", table("inbox", ".owner = viewer"), table("shared", "allow"))
}

#[test]
fn named_table_merge_pages_both_sources_and_keeps_cursor_scope() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..6).map(|n| (if n % 2 == 0 { "inbox" } else { "shared" }.into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id("dev:a".into())), ("at", Value::Int(n / 2)), ("body", Value::String(format!("row {n}")))])))).unwrap();
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let page = engine.query("page", Context::new("dev:a", BTreeMap::from([("c".into(), cursor.clone().map(Value::String).unwrap_or(Value::Null))]))).unwrap();
        assert!(page.complete);
        ids.extend(page.data.as_array().unwrap().iter().map(|v| v.field("id").unwrap().as_str().unwrap().to_owned()));
        match page.next { Some(next) => cursor = Some(next), None => break }
    }
    assert_eq!(ids, ["r5", "r4", "r3", "r2", "r1", "r0"]);
    let mut position = snapback4_core::cursor::decode_cursor(engine.schema(), cursor.as_deref().unwrap()).unwrap();
    position.table = "shared".into();
    let foreign = snapback4_core::cursor::encode_cursor(engine.schema(), &position).unwrap();
    assert!(engine.query("page", Context::new("dev:nobody", BTreeMap::from([("c".into(), Value::String(foreign))]))).is_err(), "empty lanes cannot accept a foreign cursor");
}

#[test]
fn named_table_merge_requires_the_same_columns_and_index() {
    for bad in [source().replacen("  body: text <=500", "  body: int", 1), source().replacen("owner, at, id", "owner, id, at", 1), source().replace("    [viewer]", "    shared[viewer]")] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), bad)]);
        assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_TYPE"), "{:?}", bound.diagnostics);
    }
}

#[test]
fn whole_table_cap_is_enforced_across_different_owners() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table items:\n  owner: principal\n  cap 2\n  public 'bounded public items'\n  sync public\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, []).unwrap();
    let row = |n| ("items".into(), object([("id", Value::Id(format!("r{n}"))), ("owner", Value::Id(format!("dev:{n}")))]));
    assert_eq!(engine.seed([row(0), row(1)]).unwrap(), 2);
    assert_eq!(engine.seed([row(2)]).unwrap_err().code(), "E_CONSTRAINT");
    assert_eq!(engine.snapshot("dev:reader").unwrap().0.len(), 2);
}
