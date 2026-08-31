use super::*;

#[test]
fn changed_effect_source_fails_pending_then_without_running_new_target() {
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        then_generation("async () => ({ providerId: 'old' })"),
    )
    .unwrap();
    leave_then_pending(&mut runtime);
    runtime
        .apply_successor(then_generation("async () => ({ providerId: 'new' })"))
        .unwrap();
    let execution = execute_then(&mut runtime).unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_EFFECT_THEN_CHANGED"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "failed");
    assert_eq!(row.last_error.as_deref(), Some("E_EFFECT_THEN_CHANGED"));
    let listed = runtime
        .execute(
            "notifications.list",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(listed.result.as_array().unwrap().is_empty());
}

#[test]
fn rejected_then_is_sent_with_error_across_an_unchanged_effect_declaration() {
    let source = "async () => ({ providerId: 'same' })";
    let mut runtime = Runtime::open(Store::memory().unwrap(), then_generation(source)).unwrap();
    leave_then_pending(&mut runtime);
    runtime
        .apply_successor(then_generation_with_rejection(source, true))
        .unwrap();

    let execution = execute_then(&mut runtime).unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "THEN_REFUSED"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("THEN_REFUSED"))
    );
}

#[test]
fn rule_denied_then_is_rejected_and_settled_sent_in_the_same_transaction() {
    let source = "async () => ({ providerId: 'denied' })";
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        then_generation_with_rule(source, false, RuleExpr::Deny),
    )
    .unwrap();
    leave_then_pending(&mut runtime);

    let execution = execute_then(&mut runtime).unwrap();

    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "rule"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("rule")),
        "the rejected then must remain visible on its outbox trace row"
    );
    let listed = runtime
        .execute(
            "notifications.list",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert!(listed.result.as_array().unwrap().is_empty());
}

#[test]
fn undeclared_effect_is_failed_without_ever_becoming_running() {
    let generation = Generation::certify(
        &project(
            vec![emit_program(ProgramKind::Mutation, "audit")],
            empty_schema(),
        ),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    context.now = Some(10);
    context.new_ids = VecDeque::from(["unknown-outbox".to_owned(), "return-id".to_owned()]);
    runtime.execute("ops.audit", context).unwrap();

    let mut successor = empty_schema();
    successor.effects = vec!["kept".to_owned()];
    let successor = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: successor,
            programs: vec![emit_program(ProgramKind::Mutation, "kept")],
            effects: vec![EffectDecl {
                name: "kept".to_owned(),
                grants: vec!["network".to_owned()],
                source: "effects/kept.ts".to_owned(),
                then: None,
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    runtime.apply_successor(successor).unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    context.now = Some(11);
    context.new_ids = VecDeque::from(["kept-outbox".to_owned(), "kept-return".to_owned()]);
    runtime.execute("ops.kept", context).unwrap();

    let claimed = runtime
        .store()
        .outbox_claim_next(11, &["kept".to_owned()])
        .unwrap()
        .expect("the declared row is claimed in the unknown-settlement transaction");
    assert_eq!(claimed.id, "kept-outbox");
    assert_eq!(claimed.state, "running");
    assert_eq!(claimed.attempts, 1);
    assert!(
        runtime
            .store()
            .outbox_claim_next(11, &["kept".to_owned()])
            .unwrap()
            .is_none()
    );
    let row = runtime
        .store()
        .outbox_get("unknown-outbox")
        .unwrap()
        .unwrap();
    assert_eq!(row.state, "failed");
    assert_eq!(row.attempts, 0);
    assert_eq!(row.then_op, None);
    assert_eq!(row.generation, None);
    assert_eq!(row.last_error.as_deref(), Some("E_EFFECT_UNKNOWN"));
}
