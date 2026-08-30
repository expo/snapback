use snapback2_core::*;
use std::collections::BTreeMap;

fn public_items() -> Table {
    public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("name".to_owned(), ColumnType::Text { max: 64 }),
        ]),
        BTreeMap::from([
            (
                "byId".to_owned(),
                Index {
                    columns: vec!["id".to_owned()],
                    unique: true,
                },
            ),
            (
                "byGroup".to_owned(),
                Index {
                    columns: vec!["group".to_owned(), "id".to_owned()],
                    unique: false,
                },
            ),
        ]),
    )
}

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn item(id: &str, group: &str, name: &str) -> Value {
    object([
        ("id", Value::Id(id.to_owned())),
        ("group", Value::Id(group.to_owned())),
        ("name", Value::String(name.to_owned())),
    ])
}

#[test]
fn range_point_and_absence_invalidation_is_exact_and_reruns_coalesce() {
    let schema = Schema {
        tables: BTreeMap::from([("items".to_owned(), public_items())]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let by_group = Program {
        name: "items.byGroup".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items.byGroup".to_owned(),
            table: "items".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![var("group")],
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }))],
    };
    let by_id = Program {
        name: "items.byId".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "items.byId".to_owned(),
            table: "items".to_owned(),
            index: "byId".to_owned(),
            key: vec![var("id")],
            provenance: KeyProvenance::Arg,
        }))],
    };
    let capped = Program {
        name: "items.first".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items.first".to_owned(),
            table: "items".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![var("group")],
            order: Order::Asc,
            take: Bound::Literal(1),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }))],
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, vec![by_group, by_id, capped]),
    )
    .unwrap();
    runtime
        .seed(&[("items".to_owned(), item("a1", "a", "first"))])
        .unwrap();
    let (range_id, initial_range) = runtime
        .subscribe(
            "items.byGroup",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("a".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(initial_range.state, ExecutionState::Complete);
    let (point_id, _) = runtime
        .subscribe(
            "items.byId",
            Context::query(
                "u1",
                BTreeMap::from([("id".to_owned(), Value::Id("a1".to_owned()))]),
            ),
        )
        .unwrap();
    let (absence_id, _) = runtime
        .subscribe(
            "items.byId",
            Context::query(
                "u1",
                BTreeMap::from([("id".to_owned(), Value::Id("missing".to_owned()))]),
            ),
        )
        .unwrap();

    let unrelated_seq = runtime
        .seed(&[("items".to_owned(), item("b1", "b", "other"))])
        .unwrap();
    let unrelated = runtime
        .store()
        .commits_since(unrelated_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert!(runtime.invalidated(&unrelated).is_empty());

    let affected_seq = runtime
        .seed(&[("items".to_owned(), item("a2", "a", "second"))])
        .unwrap();
    let affected = runtime
        .store()
        .commits_since(affected_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert_eq!(runtime.invalidated(&affected), vec![range_id]);
    let capped = runtime
        .execute(
            "items.first",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("a".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(
        capped.state,
        ExecutionState::Capped {
            site: Some("items.first".to_owned()),
            take: Some(1),
        }
    );
    let deliveries = runtime.rerun(&[range_id, range_id]);
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].changed);
    assert!(!runtime.rerun(&[range_id])[0].changed);

    let missing_seq = runtime
        .seed(&[("items".to_owned(), item("missing", "z", "arrived"))])
        .unwrap();
    let missing = runtime
        .store()
        .commits_since(missing_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert_eq!(runtime.invalidated(&missing), vec![absence_id]);

    let changed_seq = runtime
        .seed(&[("items".to_owned(), item("a1", "a", "changed"))])
        .unwrap();
    let changed = runtime
        .store()
        .commits_since(changed_seq - 1, 1)
        .unwrap()
        .remove(0);
    assert_eq!(runtime.invalidated(&changed), vec![range_id, point_id]);
}

#[test]
fn exhausted_hidden_range_is_complete_and_membership_addition_redelivers_it() {
    let memberships = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("user".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byGroupUser".to_owned(),
            Index {
                columns: vec!["group".to_owned(), "user".to_owned()],
                unique: true,
            },
        )]),
    );
    let mut docs = public_items();
    docs.rules.read = RuleExpr::Exists {
        table: "memberships".to_owned(),
        index: "byGroupUser".to_owned(),
        key: vec![RuleTerm::Field("group".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        tables: BTreeMap::from([
            ("docs".to_owned(), docs),
            ("memberships".to_owned(), memberships),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let query = Program {
        name: "docs.byGroup".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "docs.byGroup".to_owned(),
            table: "docs".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![var("group")],
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }))],
    };
    let hidden_limit = Program {
        name: "docs.first".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "docs.first".to_owned(),
            table: "docs".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![var("group")],
            order: Order::Asc,
            take: Bound::Literal(1),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Arg,
        }))],
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, vec![query, hidden_limit]),
    )
    .unwrap();
    runtime
        .seed(&[
            ("docs".to_owned(), item("d1", "g1", "private")),
            ("docs".to_owned(), item("d2", "g1", "also private")),
        ])
        .unwrap();
    let (subscription, initial) = runtime
        .subscribe(
            "docs.byGroup",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(initial.state, ExecutionState::Complete);
    assert_eq!(initial.result, Value::Array(Vec::new()));
    assert_eq!(initial.trace.ranges[0].stop, StopReason::Exhausted);
    assert_eq!(initial.trace.ranges[0].examined_ids, vec!["d1", "d2"]);
    assert!(initial.trace.ranges[0].visible_ids.is_empty());

    let hidden_limit = runtime
        .execute(
            "docs.first",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(hidden_limit.state, ExecutionState::Complete);
    assert_eq!(hidden_limit.trace.ranges[0].stop, StopReason::Limit);
    assert!(hidden_limit.receipt.ranges.is_empty());

    let seq = runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m1".to_owned())),
                ("group", Value::Id("g1".to_owned())),
                ("user", Value::Id("u1".to_owned())),
            ]),
        )])
        .unwrap();
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(runtime.invalidated(&commit), vec![subscription]);
    let delivery = runtime.rerun(&[subscription]).remove(0);
    assert!(matches!(
        delivery.execution.as_ref().unwrap().state,
        ExecutionState::Complete
    ));
    assert!(delivery.changed);
}

#[test]
fn hidden_rows_before_a_visible_row_still_produce_capped_from_trace() {
    let grants = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("doc".to_owned(), ColumnType::Id),
            ("user".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byDocUser".to_owned(),
            Index {
                columns: vec!["doc".to_owned(), "user".to_owned()],
                unique: true,
            },
        )]),
    );
    let mut docs = public_items();
    docs.rules.read = RuleExpr::Exists {
        table: "grants".to_owned(),
        index: "byDocUser".to_owned(),
        key: vec![RuleTerm::Field("id".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let schema = Schema {
        tables: BTreeMap::from([("docs".to_owned(), docs), ("grants".to_owned(), grants)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let query = Program {
        name: "docs.firstVisible".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "docs.firstVisible".to_owned(),
            table: "docs".to_owned(),
            index: "byGroup".to_owned(),
            prefix: vec![Expr::Literal(Value::Id("g1".to_owned()))],
            order: Order::Asc,
            take: Bound::Literal(1),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema, vec![query])).unwrap();
    runtime
        .seed(&[
            ("docs".to_owned(), item("d1", "g1", "hidden one")),
            ("docs".to_owned(), item("d2", "g1", "hidden two")),
            ("docs".to_owned(), item("d3", "g1", "hidden three")),
            ("docs".to_owned(), item("d4", "g1", "visible later")),
            (
                "grants".to_owned(),
                object([
                    ("id", Value::Id("grant-d4".to_owned())),
                    ("doc", Value::Id("d4".to_owned())),
                    ("user", Value::Id("u1".to_owned())),
                ]),
            ),
        ])
        .unwrap();

    let execution = runtime
        .execute("docs.firstVisible", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert_eq!(execution.result, Value::Array(Vec::new()));
    assert_eq!(
        execution.trace.ranges[0].examined_ids,
        vec!["d1", "d2", "d3"]
    );
    assert_eq!(execution.trace.ranges[0].stop, StopReason::Limit);
    assert!(execution.receipt.ranges.is_empty());
    assert_eq!(
        execution.state,
        ExecutionState::Capped {
            site: None,
            take: None,
        }
    );
}

#[test]
fn denied_subscription_keeps_rule_trace_and_is_readmitted() {
    let memberships = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("user".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byGroupUser".to_owned(),
            Index {
                columns: vec!["group".to_owned(), "user".to_owned()],
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("memberships".to_owned(), memberships)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let query = Program {
        name: "groups.requireMembership".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Require {
                condition: Expr::Exists(Read {
                    site: "groups.requireMembership".to_owned(),
                    table: "memberships".to_owned(),
                    index: "byGroupUser".to_owned(),
                    key: vec![var("group"), Expr::Input(Input::Viewer)],
                    provenance: KeyProvenance::Shape,
                }),
                code: "MEMBERSHIP_REQUIRED".to_owned(),
            },
            Stmt::Return(Expr::Literal(Value::String("admitted".to_owned()))),
        ],
    };
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema, vec![query])).unwrap();
    let context = Context::query(
        "u1",
        BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
    );
    let (id, denied) = runtime
        .subscribe("groups.requireMembership", context)
        .unwrap();
    assert_eq!(
        denied.state,
        ExecutionState::Denied {
            rule: "MEMBERSHIP_REQUIRED".to_owned(),
        }
    );
    assert_eq!(denied.trace.points.len(), 1);
    assert_eq!(denied.trace.absences.len(), 1);

    let seq = runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m1".to_owned())),
                ("group", Value::Id("g1".to_owned())),
                ("user", Value::Id("u1".to_owned())),
            ]),
        )])
        .unwrap();
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(runtime.invalidated(&commit), vec![id]);
    let delivery = runtime.rerun(&[id]).remove(0);
    let execution = delivery.execution.unwrap();
    assert_eq!(execution.state, ExecutionState::Complete);
    assert_eq!(execution.result, Value::String("admitted".to_owned()));
}

#[test]
fn complete_to_denied_with_the_same_result_is_a_changed_delivery() {
    let memberships = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("user".to_owned(), ColumnType::Id),
        ]),
        BTreeMap::from([(
            "byGroupUser".to_owned(),
            Index {
                columns: vec!["group".to_owned(), "user".to_owned()],
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("memberships".to_owned(), memberships)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let query = Program {
        name: "groups.requireMembership".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("group".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Require {
                condition: Expr::Exists(Read {
                    site: "groups.requireMembership".to_owned(),
                    table: "memberships".to_owned(),
                    index: "byGroupUser".to_owned(),
                    key: vec![var("group"), Expr::Input(Input::Viewer)],
                    provenance: KeyProvenance::Shape,
                }),
                code: "MEMBERSHIP_REQUIRED".to_owned(),
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    };
    let revoke = Program {
        name: "memberships.revoke".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "memberships".to_owned(),
            key: Expr::Literal(Value::Id("m1".to_owned())),
        }],
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, vec![query, revoke]),
    )
    .unwrap();
    runtime
        .seed(&[(
            "memberships".to_owned(),
            object([
                ("id", Value::Id("m1".to_owned())),
                ("group", Value::Id("g1".to_owned())),
                ("user", Value::Id("u1".to_owned())),
            ]),
        )])
        .unwrap();
    let (id, initial) = runtime
        .subscribe(
            "groups.requireMembership",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(initial.state, ExecutionState::Complete);
    assert_eq!(initial.result, Value::Null);

    let execution = runtime
        .execute(
            "memberships.revoke",
            Context::mutation("u1", BTreeMap::new()),
        )
        .unwrap();
    let seq = execution.seq;
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(runtime.invalidated(&commit), vec![id]);
    let delivery = runtime.rerun(&[id]).remove(0);
    let denied = delivery.execution.unwrap();
    assert_eq!(
        denied.state,
        ExecutionState::Denied {
            rule: "MEMBERSHIP_REQUIRED".to_owned(),
        }
    );
    assert_eq!(denied.result, Value::Null);
    assert!(delivery.changed);
}

#[test]
fn rerun_runtime_value_error_is_delivered_as_error() {
    let counters = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("divisor".to_owned(), ColumnType::Int),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([("counters".to_owned(), counters)]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let query = Program {
        name: "counters.divide".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "counter".to_owned(),
                value: Expr::Get(Read {
                    site: "counters.divide".to_owned(),
                    table: "counters".to_owned(),
                    index: "byId".to_owned(),
                    key: vec![Expr::Literal(Value::Id("only".to_owned()))],
                    provenance: KeyProvenance::Const,
                }),
            },
            Stmt::Return(Expr::Builtin {
                builtin: Builtin::Divmod {
                    remainder_sink: "counter".to_owned(),
                },
                args: vec![
                    Expr::Literal(Value::Int(1)),
                    field(var("counter"), "divisor"),
                ],
            }),
        ],
    };
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema, vec![query])).unwrap();
    runtime
        .seed(&[(
            "counters".to_owned(),
            object([
                ("id", Value::Id("only".to_owned())),
                ("divisor", Value::Int(1)),
            ]),
        )])
        .unwrap();
    let (id, initial) = runtime
        .subscribe("counters.divide", Context::query("u1", BTreeMap::new()))
        .unwrap();
    assert_eq!(initial.state, ExecutionState::Complete);

    let seq = runtime
        .seed(&[(
            "counters".to_owned(),
            object([
                ("id", Value::Id("only".to_owned())),
                ("divisor", Value::Int(0)),
            ]),
        )])
        .unwrap();
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(runtime.invalidated(&commit), vec![id]);
    let delivery = runtime.rerun(&[id]).remove(0);
    assert!(delivery.changed);
    assert!(matches!(
        delivery.execution,
        Err(RuntimeError::Value(ValueError::DivideByZero))
    ));

    runtime
        .seed(&[(
            "counters".to_owned(),
            object([
                ("id", Value::Id("only".to_owned())),
                ("divisor", Value::Int(1)),
            ]),
        )])
        .unwrap();
    let recovery = runtime.rerun(&[id]).remove(0);
    assert!(recovery.changed, "recovery from an error must be delivered");
    assert_eq!(recovery.execution.unwrap().result, initial.result);
}
