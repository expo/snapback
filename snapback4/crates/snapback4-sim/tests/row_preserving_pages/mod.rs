use snapback4_core::{Context, Engine, Value, engine::QueryOutcome, error::Refusal};

const DEVICE: bool = false;
type Query<'a> = dyn FnMut(&str, Context) -> Result<QueryOutcome, Refusal> + 'a;

fn with_fixture(source: &str, rows: Vec<(String, Value)>, check: impl Fn(&mut Query<'_>)) {
    let bound = cases::compile(source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed(rows).unwrap();
    check(&mut |name, context| engine.query(name, context));
}

#[path = "../common/row_preserving_pages.rs"] mod cases;
