use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::{compile, types::Ty};
use std::collections::BTreeMap;

const SOURCE: &str = include_str!("fixtures/shape-overrides.q");

fn checked(source: &str) -> snapback4_lang::Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    bound
}

#[test]
fn replacing_fields_determine_the_inferred_and_generated_types() {
    let bound = compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // @ref LLP 3000.019#3.1 — these two ascending pages still infer their shapes, and now explain their offline order mismatch.
    assert_eq!(bound.notes.iter().map(|note| (note.code.as_str(), note.site.line)).collect::<Vec<_>>(),
        [("N_SYNC_ORDER", 25), ("N_SYNC_ORDER", 30)]);
    let listing = Ty::RowShape(BTreeMap::from([
        ("title".into(), Ty::Text(10000)), ("city".into(), Ty::Text(10000)),
    ])).optional();
    for name in ["page", "named", "spreadShape", "replaced"] {
        let result = &bound.programs.iter().find(|p| p.program.name == name).unwrap().result;
        let Ty::Collection(row, _) = result else { panic!("{result:?}") };
        let Ty::RowShape(fields) = row.as_ref() else { panic!("{row:?}") };
        assert_eq!(fields["listing"], listing);
        if name == "replaced" {
            assert!(matches!(fields["start"], Ty::Text(_)));
            assert_eq!(fields["id"], Ty::Object(BTreeMap::from([("value".into(), Ty::Ref("bookings".into()))])));
        } else { assert_eq!(fields["start"], Ty::Time); }
    }
    let ts = snapback4_lang::emit::typescript(&bound);
    for name in ["page", "named", "spreadShape", "replaced"] {
        let line = ts.lines().find(|line| line.contains(&format!("{name}: Query<"))).unwrap_or_else(|| panic!("{ts}"));
        assert!(line.contains("listing: { city: string; title: string; pending?: boolean; retained?: boolean } | null"), "{line}");
        if name == "replaced" {
            assert!(line.contains("start: string") && line.contains("id: { value: string }"), "{line}");
        }
    }
}

#[test]
fn duplicate_explicit_fields_name_both_sites_in_shapes_objects_and_writes() {
    let schema = "table rows:\n  value: int\n  public\n  insert <- allow\n  update <- allow\n";
    for body in [
        "query bad():\n  return rows first 1 { *, value: 1, value: 2 }\n",
        "query bad():\n  return rows first 1 { value, *, value: 2 }\n",
        "query bad():\n  return { value: 1, value: 2 }\n",
        "query bad():\n  return { value: 1, ...{ value: 3 }, value: 2 }\n",
        "mutation bad():\n  return insert rows { value: 1, value: 2 }\n",
        "mutation bad():\n  return insert rows { value: 1, ...{ value: 3 }, value: 2 }\n",
        "mutation bad(key: rows):\n  return update rows[key] { value: 1, value: 2 }\n",
    ] {
        let source = format!("{schema}{body}");
        let bad = compile(&[("schema.q".into(), source.clone())]);
        let d = bad.diagnostics.iter().find(|d| d.code == "E_QUARRY_DUPLICATE_FIELD").unwrap_or_else(|| panic!("{source}: {:?}", bad.diagnostics));
        let line = source.lines().nth(6).unwrap();
        for column in [line.find("value").unwrap() + 1, line.rfind("value").unwrap() + 1] {
            let site = format!("schema.q:7:{column}");
            assert!(d.message.contains(&site) && d.rewrite.contains(&site), "{d}");
        }
        assert!(!d.mechanical, "the author chooses which value to keep");
    }
    let why = snapback4_lang::guide::explain_code("E_QUARRY_DUPLICATE_FIELD").unwrap();
    assert!(why.contains("snapback4 guide shapes") && !why.contains("No dedicated section"), "{why}");
}

#[test]
fn named_spreads_and_object_shapes_replace_inherited_fields() {
    let source = "shape inherited = { value: .n, keep: true }\nshape second = { value: 'second' }\nquery run():\n  base = { n: 7, value: false }\n  return { star: base { *, value: { n: .n } }, named: base { ...inherited, ...second, value: { n: .n } }, bare: base { *, value } }\n";
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let result = engine.query("run", Context::new("alice", BTreeMap::new())).unwrap();
    assert_eq!(snapback4_core::wire::to_json(&result.data), serde_json::json!({
        "star": {"n":7, "value":{"n":7}}, "named":{"keep":true, "value":{"n":7}}, "bare":{"n":7, "value":false},
    }));
}

#[test]
fn replaced_named_spread_expressions_still_fail_and_pay_the_meter() {
    let bound = checked("shape risky = { value: 1 / .n }\nquery fail(n: int):\n  base = { n }\n  return base { ...risky, value: 42 }\nquery plain(n: int):\n  base = { n }\n  return base { value: 42 }\n");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let context = |n| Context::new("alice", BTreeMap::from([("n".into(), Value::Int(n))]));
    assert_eq!(engine.query("fail", context(0)).unwrap_err().code, "E_DIV_ZERO");
    let result = engine.query("fail", context(1)).unwrap();
    assert_eq!(result.data.field("value").unwrap(), &Value::Int(42));
    let plain = engine.query("plain", context(1)).unwrap();
    assert_eq!(result.data, plain.data);
    assert!(result.metered.steps > plain.metered.steps, "overwritten division is still charged");
    engine.set_ceilings(snapback4_core::Ceilings { steps: plain.metered.steps, ..Default::default() });
    assert!(engine.query("plain", context(1)).unwrap().complete);
    assert_eq!(engine.query("fail", context(1)).unwrap_err().code, "E_BOUND", "replacing the output never bypasses the work ceiling");
}

#[test]
fn replaced_named_shape_helpers_execute_once_in_source_order() {
    let source = "table logs:\n  label: text\n  public\n  insert <- allow\nfn record(label: text):\n  insert logs { label }\n  return label\nshape recorded = { x: record('first'), y: record('second') }\nmutation run():\n  base = { n: 1 }\n  return base { ...recorded, x: record('third') }\nquery rows(c: cursor ?):\n  return logs first 10 after c\n";
    let bound = checked(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let result = engine.mutate("run", None, Context::new("alice", BTreeMap::new()).with_ids(["a".into(), "b".into(), "c".into()])).unwrap();
    let WriteState::Sent { result, .. } = result.state else { panic!("{result:?}") };
    assert_eq!(snapback4_core::wire::to_json(&result), serde_json::json!({"x":"third", "y":"second"}));
    let rows = engine.query("rows", Context::new("alice", BTreeMap::new())).unwrap();
    let labels = rows.data.as_array().unwrap().iter().map(|row| row.field("label").unwrap().as_str().unwrap()).collect::<Vec<_>>();
    assert_eq!(labels, ["first", "second", "third"]);
}
