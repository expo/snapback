//! LLP 3000.013 lane D: hoisted coverage and retained cursor allowance.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, engine::local, error::MeterKind, meter::Ceilings, rows::{MemoryRows, Rows}, wire};
use std::collections::BTreeMap;

fn aggregate_inputs_need_coverage(saved_local: bool) {
    let (prelude, domain) = if saved_local {
        ("  scope = prefs['p'].scope ?? 'none'\n", "items[] by byScope where .scope = scope")
    } else {
        ("", "items[prefs['p'].scope ?? 'none'] by byScope")
    };
    let source = format!(r#"
table prefs:
  scope: text <=20
  public
  online only
table items:
  scope: text <=20
  n: int
  by byScope: scope, id
  public
  sync
query total():
{prelude}  return count({domain})
query amount():
{prelude}  return sum({domain}, .n)
query any():
{prelude}  return exists {domain}
"#);
    for synced_prefs in [false, true] {
        let source = if synced_prefs { source.replace("online only", "sync") } else { source.clone() };
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let item = wire::row_from_json(&bound.schema.tables["items"], &json!({"id":"i", "scope":"shared", "n":7})).unwrap();
        let pref = wire::row_from_json(&bound.schema.tables["prefs"], &json!({"id":"p", "scope":"shared"})).unwrap();
        let mut server = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        server.load(vec![("items".into(), item.clone()), ("prefs".into(), pref.clone())]).unwrap();
        let rows = MemoryRows::new();
        rows.put("items", &bound.schema.tables["items"], &item, None).unwrap();
        for (op, expected) in [("total", Value::Int(1)), ("amount", Value::Int(7)), ("any", Value::Bool(true))] {
            let ctx = || Context::new("alice", BTreeMap::new()).at(1);
            let program = &bound.programs.iter().find(|p| p.program.name == op).unwrap().program;
            let authoritative = server.query(op, ctx()).unwrap();
            assert!(authoritative.complete);
            assert_eq!(authoritative.data, expected);
            let device = local::query(&rows, &bound.schema, program, ctx(), Ceilings::default()).unwrap();
            if synced_prefs {
                // A known absence may use the fallback and prove an empty domain.
                assert!(device.complete, "{op}: {device:?}");
                assert_eq!(device.data, if op == "any" { Value::Bool(false) } else { Value::Int(0) });
            } else {
                assert!(!device.complete, "{op}: {device:?}");
                assert_eq!(device.data, Value::Null, "unknown input cannot establish a scalar for {op}: {device:?}");
            }
        }
        if synced_prefs {
            rows.put("prefs", &bound.schema.tables["prefs"], &pref, None).unwrap();
            for (op, expected) in [("total", Value::Int(1)), ("amount", Value::Int(7)), ("any", Value::Bool(true))] {
                let program = &bound.programs.iter().find(|p| p.program.name == op).unwrap().program;
                let device = local::query(&rows, &bound.schema, program, Context::new("alice", BTreeMap::new()).at(1), Ceilings::default()).unwrap();
                assert!(device.complete, "{op}: {device:?}");
                assert_eq!(device.data, expected);
            }
        }
    }
}

#[test]
fn hoisted_prefix_coverage_governs_count_sum_and_exists() {
    aggregate_inputs_need_coverage(false);
}

#[test]
fn saved_filter_local_coverage_governs_count_sum_and_exists() {
    aggregate_inputs_need_coverage(true);
}

#[test]
fn a_growing_retained_cursor_can_exhaust_the_heap_allowance() {
    let source = r#"
table entries:
  key: text <=400
  by byKey: key, id
  public
  sync
query total():
  return count(entries[] by byKey)
"#;
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let program = &bound.programs[0].program;
    let table = &bound.schema.tables["entries"];
    let rows = MemoryRows::new();
    for (i, width) in [32, 256].into_iter().enumerate() {
        let row = wire::row_from_json(table, &json!({"id":format!("e{i}"), "key":"x".repeat(width)})).unwrap();
        rows.put("entries", table, &row, None).unwrap();
        let result = local::query(&rows, &bound.schema, program, Context::new("alice", BTreeMap::new()).at(1), Ceilings { heap_bytes: 5_000, ..Ceilings::default() }).unwrap();
        println!("retained cursor, {width}-character key: {result:?}");
        if width == 32 {
            assert!(result.complete);
            assert_eq!(result.data, Value::Int(1));
        } else {
            assert!(!result.complete, "the retained cursor must be charged alongside row scratch");
            assert_eq!(result.data, Value::Null);
            assert!(matches!(result.capped_at, Some((MeterKind::HeapBytes, _))), "{result:?}");
        }
    }
    let complete = local::query(&rows, &bound.schema, program, Context::new("alice", BTreeMap::new()).at(1), Ceilings::default()).unwrap();
    assert!(complete.complete);
    assert_eq!(complete.data, Value::Int(2));
}
