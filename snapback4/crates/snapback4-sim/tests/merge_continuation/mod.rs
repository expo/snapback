use snapback4_core::{Context, Engine, Value, engine::QueryOutcome, error::Refusal};

const DEVICE: bool = false;
type Query<'a> = dyn FnMut(&str, Context) -> Result<QueryOutcome, Refusal> + 'a;

fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows).unwrap();
    check(&mut |name, context| engine.query(name, context));
}

#[path = "../common/merge_continuation.rs"] mod cases;

#[path = "../common/shape_pages.rs"] mod shape_pages;

#[test]
fn w13h_a_shape_that_cannot_finish_under_a_fresh_meter_makes_no_progress() {
    let source = "table items:\n  lane: int\n  by byLane: lane, id\n  public 'fixture'\n  sync public\nquery feed(c: cursor ?):\n  return items[0] after c first 1 by byLane { id, n: count(items[1] first 9000 by byLane) }\n";
    let rows = std::iter::once(("a".to_owned(), 0)).chain((0..9000).map(|n| (format!("x{n:05}"), 1)))
        .map(|(id, lane)| ("items".into(), snapback4_core::value::object([("id", Value::Id(id)), ("lane", Value::Int(lane))]))).collect();
    with_fixture(source, rows, |q| {
        let first = q("feed", Context::new("dev:alice", [("c".into(), Value::Null)].into())).unwrap();
        assert!(first.data.as_array().unwrap().is_empty());
        assert_eq!((first.complete, first.cut), (false, Some(snapback4_core::engine::ReadCut::Meter)));
        let cursor = first.next.expect("retry the first unfinished row");
        let second = q("feed", Context::new("dev:alice", [("c".into(), Value::String(cursor.clone()))].into())).unwrap();
        assert!(second.data.as_array().unwrap().is_empty());
        assert_eq!((second.complete, second.cut), (false, Some(snapback4_core::engine::ReadCut::Meter)));
        assert_eq!(second.next.as_deref(), Some(cursor.as_str()));
    });
}
