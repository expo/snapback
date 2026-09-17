use super::*;
mod fixture;
use fixture::{SOURCE, NOW};

fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
fn cx(input: &[(&str, Value)]) -> Context { Context::new("dev:alice", args(input)).at(NOW) }

#[test]
fn w13c2_ranking_range_matches_typed_lanes_and_oracle() {
    let mut engine = engine(SOURCE);
    engine.seed(fixture::seed(30, 40, true)).unwrap();
    let typed = engine.query("typedRanking", cx(&[])).unwrap();
    let range = engine.query("ranking", cx(&[])).unwrap();
    assert_eq!(range.data, typed.data);
    assert_eq!(range.next, typed.next);
    assert!(range.complete && range.next.is_some());
    let ids = range.data.as_array().unwrap().iter().map(|row| row.field("postId").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    assert_eq!(ids, fixture::oracle(30, 40));
    assert!(range.metered.examined.abs_diff(typed.metered.examined) <= 3);
    println!("ranking: typed={} range={} posts=1200 lanes=25", typed.metered.examined, range.metered.examined);
}

#[test]
fn w13c2_lists_empty_domains_duplicates_and_range_setup() {
    let mut engine = engine(SOURCE);
    engine.seed(fixture::seed(30, 4, false)).unwrap();
    let literal = engine.query("literalAuthors", cx(&[])).unwrap();
    let list = engine.query("byAuthors", cx(&[("authors", Value::Array(vec![id("dev:alice"), id("dev:bob"), id("dev:alice")]))])).unwrap();
    assert_eq!(list.data, literal.data);
    assert_eq!(list.next, literal.next);
    let expr = engine.query("listExpression", cx(&[])).unwrap();
    assert_eq!(expr.data, engine.query("alice", cx(&[])).unwrap().data);
    for (op, input) in [("byAuthors", vec![("authors", Value::Array(vec![]))]), ("ranged", vec![("start", Value::Int(3)), ("end", Value::Int(3))]), ("ranged", vec![("start", Value::Int(4)), ("end", Value::Int(3))])] {
        let empty = engine.query(op, cx(&input)).unwrap();
        assert!(empty.data.as_array().unwrap().is_empty() && empty.complete && empty.next.is_none(), "{empty:?}");
    }
    let expected = engine.query("ranged", cx(&[("start", Value::Int(5)), ("end", Value::Int(30))])).unwrap();
    for (op, input) in [("inline", vec![("at", Value::Int(NOW))]), ("bound", vec![("at", Value::Int(NOW))]), ("clockRange", vec![("delta", Value::Int(24))])] {
        let result = engine.query(op, cx(&input)).unwrap();
        assert_eq!(result.data, expected.data, "{op}");
        assert!(result.complete && result.next.is_some());
    }
}

#[test]
fn w13c2_five_thousand_lanes_cut_without_cursor() {
    let mut engine = engine(SOURCE);
    engine.seed(fixture::seed(5000, 4, false)).unwrap();
    let result = engine.query("ranged", cx(&[("start", Value::Int(0)), ("end", Value::Int(5000))])).unwrap();
    assert!(!result.complete && result.next.is_none());
    assert_eq!(result.cut, Some(snapback4_core::engine::ReadCut::Meter));
    println!("5000 lanes: examined={} index_entries={} heap_bytes={} steps={} rows={} cut={:?}", result.metered.examined, result.metered.index_entries, result.metered.heap_bytes, result.metered.steps, result.data.as_array().unwrap().len(), result.cut);
}

#[test]
fn w13c2_empty_billion_lane_range_stops_at_descriptor_heap_ceiling() {
    let mut engine = engine(SOURCE);
    let result = engine.query("ranged", cx(&[("start", Value::Int(0)), ("end", Value::Int(1_000_000_000))])).unwrap();
    assert!(!result.complete && result.next.is_none());
    assert_eq!(result.cut, Some(snapback4_core::engine::ReadCut::Meter));
    assert_eq!(result.capped_at.unwrap().0, snapback4_core::error::MeterKind::HeapBytes);
    assert!(result.metered.steps < 100_000);
}

#[test]
fn w13c2_nonuniform_hidden_absent_pages_match_and_operator_meter_counts_physical_work() {
    let source = SOURCE.replace("  public 'posts'\n  sync public", "  read <- .author = viewer\n  online only");
    let mut observations = Vec::new();
    for hidden in [false, true] {
        let mut engine = engine(&source);
        let rows = fixture::seed(25, 4, false).into_iter().filter(|(_, row)| hidden || row.field("author").unwrap() == &id("dev:alice"));
        engine.seed(rows).unwrap();
        let result = engine.query("ranged", cx(&[("start", Value::Int(0)), ("end", Value::Int(25))])).unwrap();
        assert!(!result.complete && result.next.is_none());
        assert_eq!(result.metered.examined, if hidden { 100 } else { 50 });
        observations.push(serde_json::to_vec(&(result.data, result.complete, result.cut, result.next)).unwrap());
    }
    assert_eq!(observations[0], observations[1]);
}

#[test]
fn w13c2_nonuniform_hidden_images_have_byte_identical_pages_and_meters() {
    let source = SOURCE.replace("  public 'posts'\n  sync public", "  read <- .author = viewer\n  online only");
    let mut observations = Vec::new();
    for hidden_viewer in ["dev:bob", "dev:carol"] {
        let mut engine = engine(&source);
        let rows = fixture::seed(25, 4, false).into_iter().map(|(table, row)| {
            let mut fields = row.as_object().unwrap().clone();
            if fields["author"] != id("dev:alice") { fields.insert("author".into(), id(hidden_viewer)); }
            (table, Value::Row(fields.into()))
        });
        engine.seed(rows).unwrap();
        let result = engine.query("ranged", cx(&[("start", Value::Int(0)), ("end", Value::Int(25))])).unwrap();
        assert!(!result.complete && result.next.is_none());
        observations.push(serde_json::to_vec(&(result.data, result.complete, result.cut, result.next, result.metered)).unwrap());
    }
    assert_eq!(observations[0], observations[1]);
}
