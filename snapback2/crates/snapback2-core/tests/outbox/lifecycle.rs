use super::*;

#[test]
fn store_claim_settle_restart_and_requeue_accessors_are_durable() {
    let generation = Generation::certify(
        &project(
            vec![emit_program(ProgramKind::Mutation, "audit")],
            empty_schema(),
        ),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation.clone()).unwrap();
    let mut context = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    context.now = Some(100);
    context.new_ids = VecDeque::from(["outbox-1".to_owned(), "return-1".to_owned()]);
    runtime.execute("ops.audit", context).unwrap();

    let claimed = runtime
        .store()
        .outbox_claim_next(100, &["audit".to_owned()])
        .unwrap()
        .expect("queued row");
    assert_eq!(claimed.state, "running");
    assert_eq!(claimed.attempts, 1);
    assert_eq!(claimed.payload, Value::String("payload".to_owned()));
    assert_eq!(claimed.generation, Some(generation.effects_hash()));
    assert!(
        runtime
            .store()
            .outbox_claim_next(100, &["audit".to_owned()])
            .unwrap()
            .is_none()
    );

    runtime
        .store()
        .outbox_settle("outbox-1", "failed", None, Some("permanent"), None)
        .unwrap();
    assert!(runtime.store().outbox_requeue("outbox-1").unwrap());
    let requeued = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(requeued.state, "queued");
    assert_eq!(requeued.attempts, 0);
    let claimed = runtime
        .store()
        .outbox_claim_next(i64::MAX, &["audit".to_owned()])
        .unwrap()
        .unwrap();
    assert_eq!(claimed.attempts, 1);
    assert_eq!(runtime.store().outbox_mark_unknown_running().unwrap(), 1);
    assert_eq!(
        runtime
            .store()
            .outbox_get("outbox-1")
            .unwrap()
            .unwrap()
            .state,
        "sent_unknown"
    );
    assert!(
        runtime
            .store()
            .outbox_claim_next(i64::MAX, &["audit".to_owned()])
            .unwrap()
            .is_none()
    );
}

#[test]
fn store_open_adds_then_binding_columns_to_an_existing_outbox() {
    let path = temp_path();
    drop(Store::open(&path).unwrap());
    {
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "ALTER TABLE _outbox DROP COLUMN then_op;
                 ALTER TABLE _outbox DROP COLUMN generation;
                 INSERT INTO _outbox VALUES
                    ('old', 1, 'audit', '\"Null\"', 'queued', 0, 0, NULL, NULL, 0, 0);",
            )
            .unwrap();
    }
    let store = Store::open(&path).unwrap();
    let old = store.outbox_get("old").unwrap().unwrap();
    assert_eq!(old.then_op, None);
    assert_eq!(old.generation, None);
    drop(store);
    cleanup(&path);
}

#[test]
fn execute_then_commits_bookkeeping_and_sent_settlement_once() {
    let path = temp_path();
    let generation = then_generation("async () => ({ providerId: 'p1' })");
    {
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
        leave_then_pending(&mut runtime);
        let execution = execute_then(&mut runtime).unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(
            runtime
                .store()
                .outbox_get("outbox-1")
                .unwrap()
                .unwrap()
                .state,
            "sent"
        );
        let then_commit = runtime
            .store()
            .commits_since(execution.seq - 1, 1)
            .unwrap()
            .remove(0);
        assert_eq!(then_commit.principal, "system");
        assert_eq!(then_commit.kind, "system");
    }

    let mut restarted = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    assert!(
        restarted
            .store()
            .outbox_then_pending(16)
            .unwrap()
            .is_empty()
    );
    let listed = restarted
        .execute(
            "notifications.list",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(listed.result.as_array().unwrap().len(), 1);
    assert!(
        execute_then(&mut restarted)
            .unwrap_err()
            .to_string()
            .contains("not then_pending")
    );
    let listed = restarted
        .execute(
            "notifications.list",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(listed.result.as_array().unwrap().len(), 1);
    drop(restarted);
    cleanup(&path);
}

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
        ExecutionState::Rejected { ref code, .. } if code == "E_RULE"
    ));
    let row = runtime.store().outbox_get("outbox-1").unwrap().unwrap();
    assert_eq!(row.state, "sent");
    assert!(
        row.last_error
            .as_deref()
            .is_some_and(|error| error.contains("E_RULE")),
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

fn then_generation(source: &str) -> Generation {
    then_generation_with_rejection(source, false)
}

fn then_generation_with_rejection(source: &str, reject: bool) -> Generation {
    then_generation_with_rule(
        source,
        reject,
        RuleExpr::Eq(
            RuleTerm::Viewer,
            RuleTerm::Literal(Value::Id(SYSTEM_PRINCIPAL_ID.to_owned())),
        ),
    )
}

fn then_generation_with_rule(source: &str, reject: bool, write_rule: RuleExpr) -> Generation {
    let notifications = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("outboxId".to_owned(), ColumnType::Id),
        ]),
        indexes: BTreeMap::from([(
            "byOutbox".to_owned(),
            Index {
                columns: vec!["outboxId".to_owned()],
                unique: true,
            },
        )]),
        rules: Rules {
            read: RuleExpr::Public {
                reason: "test observation".to_owned(),
            },
            insert: write_rule.clone(),
            update: write_rule,
            delete: RuleExpr::Deny,
        },
        constraints: Vec::new(),
    };
    let emit = Program {
        name: "notifications.emit".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "notifications.notify".to_owned(),
            payload: Expr::Literal(Value::Null),
        }],
    };
    let record = Program {
        name: "notifications.record".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("outboxId".to_owned(), ArgType::Id),
            ("effect".to_owned(), ArgType::Text { max: 100 }),
            ("result".to_owned(), ArgType::Json { max_bytes: 1_000 }),
        ]),
        read_time_granularity_ms: None,
        body: if reject {
            vec![Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: "THEN_REFUSED".to_owned(),
            }]
        } else {
            vec![Stmt::Insert {
                table: "notifications".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), Expr::Input(Input::NewId)),
                    ("outboxId".to_owned(), var("outboxId")),
                ])),
            }]
        },
    };
    let list = Program {
        name: "notifications.list".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "notifications.list".to_owned(),
            table: "notifications".to_owned(),
            index: "byOutbox".to_owned(),
            prefix: Vec::new(),
            order: Order::Asc,
            take: Bound::Literal(10),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                tables: BTreeMap::from([("notifications".to_owned(), notifications)]),
                maintains: Vec::new(),
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: vec!["notifications.notify".to_owned()],
            },
            programs: vec![emit, record, list],
            effects: vec![EffectDecl {
                name: "notifications.notify".to_owned(),
                grants: vec!["http://127.0.0.1:1".to_owned()],
                source: source.to_owned(),
                then: Some("notifications.record".to_owned()),
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn leave_then_pending(runtime: &mut Runtime) {
    let mut emit = Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());
    emit.now = Some(10);
    emit.new_ids = VecDeque::from(["outbox-1".to_owned()]);
    runtime.execute("notifications.emit", emit).unwrap();
    runtime
        .store()
        .outbox_claim_next(10, &["notifications.notify".to_owned()])
        .unwrap()
        .unwrap();
    runtime
        .store()
        .outbox_settle(
            "outbox-1",
            "then_pending",
            Some(&serde_json::json!({ "providerId": "provider-1" })),
            None,
            None,
        )
        .unwrap();
}

fn execute_then(runtime: &mut Runtime) -> Result<Execution, RuntimeError> {
    runtime.execute_then(
        "notifications.record",
        BTreeMap::from([
            ("outboxId".to_owned(), Value::Id("outbox-1".to_owned())),
            (
                "effect".to_owned(),
                Value::String("notifications.notify".to_owned()),
            ),
            (
                "result".to_owned(),
                object([("providerId", Value::String("provider-1".to_owned()))]),
            ),
        ]),
        20,
        None,
        VecDeque::from(["notification-1".to_owned()]),
        "outbox-1",
    )
}
