#[path = "common/topn.rs"]
mod fixture;
use snapback4_core::{engine::{Context, Engine}, Value};

#[test]
fn cursorless_top_n_and_composed_preview_are_complete() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), fixture::SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(fixture::rows()).unwrap();
    for op in fixture::OPS { fixture::check(op, engine.query(op, Context::new("alice", Default::default())).unwrap()); }
    fixture::check("top", engine.query("top", Context::new("alice", [("slow".into(), Value::Bool(false))].into())).unwrap());
    let cut = engine.query("top", Context::new("alice", [("slow".into(), Value::Bool(true))].into())).unwrap();
    assert!(!cut.complete && cut.capped_at.is_some() && cut.next.is_none(), "{cut:?}");
    assert_eq!(cut.cut, Some(snapback4_core::engine::ReadCut::Meter));
}
