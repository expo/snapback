use super::*;
#[test]
fn duplicate_internal_command_and_new_unkeyed_invocation() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table counts:\n  n: int\n  public\n  insert <- allow\n  update <- allow\nmutation increment():\n  c = counts[\"c\"]\n  upsert counts[\"c\"] { n: (c.n ?? 0) + 1 }\n  return counts[\"c\"]\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs = bound
        .programs
        .into_iter()
        .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap());
    let mut engine = Engine::new_at(
        crate::store_port::AnyStore::memory().unwrap(),
        schema,
        programs,
        1000,
    )
    .unwrap();
    let mut first = Invocation::new(
        "increment",
        None,
        Context::new("alice", Default::default()).at(1000),
    )
    .instrument(|run| {
        run();
        run();
    });
    let a = engine.invoke_program(&mut first).unwrap();
    let b = engine.invoke_program(&mut first).unwrap();
    assert_eq!(a.outcome, b.outcome);
    assert_eq!(engine.seq().unwrap(), 1);
    let mut second = Invocation::new(
        "increment",
        None,
        Context::new("alice", Default::default()).at(1000),
    );
    engine.invoke_program(&mut second).unwrap();
    assert_eq!(engine.seq().unwrap(), 2);
    assert_eq!(
        engine
            .store()
            .test_support_conn()
            .query_row("SELECT count(*) FROM _ops", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
