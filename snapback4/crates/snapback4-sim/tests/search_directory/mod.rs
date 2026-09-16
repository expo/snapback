use snapback4_core::{Context, Engine, Value, value::object};
use std::collections::BTreeMap;

#[test]
fn w10c_directory_uses_the_cards_queries_and_separate_cursors() {
    let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("search").unwrap()).remove(0);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed((0..25).map(|n| ("profiles".into(), object([
        ("id", Value::Id(format!("p{n:02}"))), ("principal", Value::Id(format!("person{n}"))),
        ("displayName", Value::String(if n == 24 { "Dave".into() } else { format!("Person {n}") })),
        ("handle", Value::String(format!("person{n}"))),
    ])))).unwrap();
    for needle in ["", "   ", "!!!"] {
        let page = engine.query("people", Context::new("dev:alice", BTreeMap::from([("q".into(), Value::String(needle.into()))]))).unwrap();
        assert!(page.data.as_array().unwrap().is_empty() && page.complete && page.next.is_none());
    }
    for needle in ["", "person"] {
        let mut cursor = None;
        let mut ids = Vec::new();
        let mut sizes = Vec::new();
        loop {
            let mut args = BTreeMap::new();
            let op = if needle.is_empty() { "allPeople" } else { args.insert("q".into(), Value::String(needle.into())); "people" };
            if let Some(c) = cursor { args.insert("c".into(), Value::String(c)); }
            let page = engine.query(op, Context::new("dev:alice", args)).unwrap();
            let rows = page.data.as_array().unwrap();
            sizes.push(rows.len());
            ids.extend(rows.iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
            cursor = page.next;
            if cursor.is_none() { assert!(page.complete, "needle={needle:?}, page sizes={sizes:?}, complete={}, next=None", page.complete); break; }
            assert!(sizes.len() <= 2);
        }
        assert_eq!(ids, (0..25).map(|n| format!("p{n:02}")).collect::<Vec<_>>());
        assert_eq!(sizes, [20, 5]);
    }
    let typed = engine.query("people", Context::new("dev:alice", BTreeMap::from([("q".into(), Value::String("dav".into()))]))).unwrap();
    assert_eq!(typed.data.as_array().unwrap().len(), 1);
    assert_eq!(typed.data.as_array().unwrap()[0].field("id").unwrap().as_str().unwrap(), "p24");
    assert!(typed.complete && typed.next.is_none());
    println!("directory: empty needles=3, empty matches=0, browse rows=25, typed rows=25, pages=20+5 each, dav matches=1");
}
