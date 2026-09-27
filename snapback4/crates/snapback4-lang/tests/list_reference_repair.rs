use snapback4_core::{Context, Engine, Value, wire};
use snapback4_lang::{compile, guide};
use std::collections::BTreeMap;

const TABLES: &str = "table a:\n  n: int\n  public\ntable b:\n  n: int\n  public\n";

#[test]
fn mixed_reference_diagnostic_teaches_the_value_preserving_repair() {
    for (expression, path) in [("[x, y]", "[]"), ("[{ id: x }, { id: y }]", "[].id")] {
        let source = format!("{TABLES}query run(x: a, y: b):\n  return {expression}\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert_eq!(bound.diagnostics.len(), 1, "{:?}", bound.diagnostics);
        let error = &bound.diagnostics[0];
        assert_eq!(error.code, "E_QUARRY_TYPE");
        assert!(error.message.contains(&format!("field path {path}:")), "{error:?}");
        assert!(error.rewrite.contains("fn exposedId(value: id): value"), "{error:?}");
        assert!(error.rewrite.contains("exposedId(x)"), "{error:?}");
        assert!(error.rewrite.contains("exposedId(row.id)"), "{error:?}");
        assert!(error.rewrite.contains("[].id"), "{error:?}");
        assert_eq!(error.site.line, 8);
    }
}

#[test]
fn generic_id_repair_preserves_flat_nested_and_projected_values() {
    for (setup, expression, expected) in [
        ("", "[exposedId(x), exposedId(y)]", serde_json::json!(["first", "second"])),
        ("", "[{ id: exposedId(x) }, { id: exposedId(y) }]", serde_json::json!([{"id":"first"}, {"id":"second"}])),
        ("  rx = a[x] ! else NOT_FOUND\n  ry = b[y] ! else NOT_FOUND\n", "[{ id: exposedId(rx.id) }, { id: exposedId(ry.id) }]", serde_json::json!([{"id":"first"}, {"id":"second"}])),
    ] {
        let source = format!("{TABLES}fn exposedId(value: id): value\nquery run(x: a, y: b):\n{setup}  return {expression}\n");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        for (table, id) in [("a", "first"), ("b", "second")] {
            let row = wire::row_from_json(&engine.schema().tables[table], &serde_json::json!({"id":id,"n":1})).unwrap();
            engine.load(vec![(table.into(), row)]).unwrap();
        }
        let read = engine.query("run", Context::new("alice", BTreeMap::from([("x".into(), Value::Id("first".into())), ("y".into(), Value::Id("second".into()))]))).unwrap();
        assert!(read.complete);
        assert_eq!(wire::to_json(&read.data), expected);
    }
}

#[test]
fn types_card_teaches_flat_and_nested_id_widening() {
    let card = guide::card("types").unwrap();
    assert!(card.contains("[].id"));
    let example = guide::quarry(card).into_iter().find(|block| block.contains("fn exposedId(value: id): value")).expect("executable ID repair");
    let bound = compile(&[("schema.q".into(), example)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert!(card.contains("exposedId(row.id)"));
}
