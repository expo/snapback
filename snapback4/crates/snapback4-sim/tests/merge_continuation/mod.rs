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
