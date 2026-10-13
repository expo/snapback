use super::*;

#[test]
fn jobs_catch_up_sweep_includes_rows_before_the_latest_period_and_repeats() {
    let source = quarry(card("jobs").unwrap()).into_iter().find(|block| block.contains("job releaseDue(")).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new(snapback4_core::Store::memory().unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([100, 500, 2000].into_iter().enumerate().map(|(n, due)| ("embargoes".into(), Value::Row(BTreeMap::from([
        ("id".into(), id(&format!("due{n}"))), ("dueAt".into(), Value::Int(due)), ("released".into(), Value::Bool(false)),
    ]).into())))).unwrap();
    for _ in 0..2 {
        let run = engine.run_job("releaseDue", args(&[("periodStart", Value::Int(400)), ("periodEnd", Value::Int(1000))]), 1000).unwrap();
        assert_eq!(run.state, JobState::Done, "{run:?}");
        let rows = engine.store().rows("embargoes").unwrap();
        for row in rows { assert_eq!(row.field("released").unwrap(), &Value::Bool(row.field("dueAt").unwrap().as_int().unwrap() < 1000)); }
    }
}
