use snapback2_core::*;
use std::collections::BTreeMap;

fn table(columns: &[(&str, ColumnType)]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(n, t)| (n.to_string(), t.clone()))
            .collect(),
        BTreeMap::from([(
            "byId".into(),
            Index {
                columns: vec!["id".into()],
                unique: true,
            },
        )]),
    )
}
fn program(name: &str, kind: ProgramKind, body: Vec<Stmt>) -> Program {
    Program {
        name: name.into(),
        kind,
        args: BTreeMap::new(),
        body,
        read_time_granularity_ms: None,
        result_page_site: None,
    }
}
fn get(table: &str, id: &str) -> Expr {
    Expr::Get(Read {
        site: format!("{table}.point"),
        table: table.into(),
        index: "byId".into(),
        key: vec![Expr::Literal(Value::Id(id.into()))],
        provenance: KeyProvenance::Const,
    })
}
fn scan(index: &str, prefix: Vec<Expr>, take: u32) -> Expr {
    Expr::Scan(Scan {
        site: "items.range".into(),
        table: "items".into(),
        index: index.into(),
        prefix,
        order: Order::Asc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    })
}
fn fixture() -> Runtime {
    let mut items = table(&[
        ("id", ColumnType::Id),
        ("scope", ColumnType::Id),
        ("label", ColumnType::Text { max: 40 }),
    ]);
    items.indexes.insert(
        "byScope".into(),
        Index {
            columns: vec!["scope".into(), "id".into()],
            unique: false,
        },
    );
    items.indexes.insert(
        "byLabel".into(),
        Index {
            columns: vec!["label".into()],
            unique: true,
        },
    );
    items.rules.read = RuleExpr::Exists {
        table: "memberships".into(),
        index: "byScopePrincipal".into(),
        key: vec![RuleTerm::Field("scope".into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    items.rules.insert = RuleExpr::Deny;
    items.rules.update = RuleExpr::Deny;
    items.rules.delete = RuleExpr::Deny;
    items.constraints.push(Constraint::Immutable {
        fields: vec!["scope".into()],
    });
    items.constraints.push(Constraint::Unique {
        index: "byLabel".into(),
    });
    let mut memberships = table(&[
        ("id", ColumnType::Id),
        ("scope", ColumnType::Id),
        ("principal", ColumnType::Principal),
    ]);
    memberships.indexes.insert(
        "byScopePrincipal".into(),
        Index {
            columns: vec!["scope".into(), "principal".into()],
            unique: true,
        },
    );
    memberships.rules.read = RuleExpr::Deny;
    let mut totals = table(&[
        ("id", ColumnType::Id),
        ("scope", ColumnType::Id),
        ("value", ColumnType::Int),
    ]);
    totals.indexes.insert(
        "byScope".into(),
        Index {
            columns: vec!["scope".into()],
            unique: true,
        },
    );
    totals.rules.read = items.rules.read.clone();
    totals.rules.insert = RuleExpr::Deny;
    totals.rules.update = RuleExpr::Deny;
    totals.rules.delete = RuleExpr::Deny;
    let update = |name: &str, column: &str, value: Value| {
        program(
            name,
            ProgramKind::Mutation,
            vec![Stmt::Update {
                table: "items".into(),
                key: Expr::Literal(Value::Id("i1".into())),
                patch: Expr::Literal(object([(column, value)])),
            }],
        )
    };
    let project = ProjectJson {
        version: 1,
        auth: Auth::default(),
        effects: vec![],
        schema: Schema {
            tables: BTreeMap::from([
                ("items".into(), items),
                ("memberships".into(), memberships),
                ("totals".into(), totals),
            ]),
            maintains: vec![Maintain {
                source: "items".into(),
                target: "totals".into(),
                by: vec!["scope".into()],
                kind: MaintainKind::Count,
                readable: None,
            }],
            ..Schema::default()
        },
        programs: vec![
            program(
                "all",
                ProgramKind::Query,
                vec![Stmt::Return(scan("byId", vec![], 10))],
            ),
            program(
                "limited",
                ProgramKind::Query,
                vec![Stmt::Return(scan("byId", vec![], 1))],
            ),
            program(
                "scoped",
                ProgramKind::Query,
                vec![Stmt::Return(scan(
                    "byScope",
                    vec![Expr::Literal(Value::Id("s1".into()))],
                    10,
                ))],
            ),
            program(
                "point",
                ProgramKind::Query,
                vec![Stmt::Return(get("items", "i1"))],
            ),
            program(
                "insert",
                ProgramKind::Mutation,
                vec![Stmt::Insert {
                    table: "items".into(),
                    row: Expr::Literal(item("i3", "third")),
                }],
            ),
            update("immutable", "scope", Value::Id("other".into())),
            update("unique", "label", Value::String("second".into())),
            update("update", "label", Value::String("changed".into())),
            program(
                "delete",
                ProgramKind::Mutation,
                vec![Stmt::Delete {
                    table: "items".into(),
                    key: Expr::Literal(Value::Id("i1".into())),
                }],
            ),
        ],
    };
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime
        .seed(&[
            ("items".into(), item("i1", "first")),
            ("items".into(), item("i2", "second")),
        ])
        .unwrap();
    runtime
}
fn item(id: &str, label: &str) -> Value {
    object([
        ("id", Value::Id(id.into())),
        ("scope", Value::Id("s1".into())),
        ("label", Value::String(label.into())),
    ])
}
fn operator(runtime: &mut Runtime, op: &str) -> Execution {
    runtime
        .execute_operator(op, BTreeMap::new(), OperatorId("alice".into()))
        .unwrap()
}
fn viewer(runtime: &mut Runtime, op: &str) -> Execution {
    runtime
        .execute(
            op,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap()
}
#[test]
fn system_range_skips_membership_rules_and_derives_complete_from_exhaustion() {
    let mut runtime = fixture();
    assert_eq!(
        runtime.generation().programs()["all"].1.completeness,
        Completeness::Capped
    );
    assert_eq!(viewer(&mut runtime, "all").result, Value::Array(vec![]));
    for op in ["all", "scoped"] {
        let result = operator(&mut runtime, op);
        assert_eq!(result.state, ExecutionState::Complete);
        assert_eq!(result.result.as_array().unwrap().len(), 2);
        assert_eq!(result.trace.ranges[0].stop, StopReason::Exhausted);
        assert_eq!(result.trace.rows.len(), 2);
        assert!(result.trace.rule_inputs.is_empty());
        assert_eq!(result.trace.rule_probes, 0);
        assert_eq!(result.receipt, Default::default());
    }
    assert_eq!(
        operator(&mut runtime, "limited").state,
        ExecutionState::Capped
    );
}
#[test]
fn system_point_reads_hidden_rows_without_verdicts_or_receipts_and_does_not_commit() {
    let mut runtime = fixture();
    assert_eq!(viewer(&mut runtime, "point").result, Value::Null);
    let seq = runtime.store().commit_seq().unwrap();
    let read = operator(&mut runtime, "point");
    assert_eq!(read.result.field("id").unwrap(), &Value::Id("i1".into()));
    assert_eq!(read.trace.points.len(), 1);
    assert_eq!(read.trace.rows.len(), 1);
    assert_eq!(read.receipt, Default::default());
    assert_eq!(runtime.store().commit_seq().unwrap(), seq);
}
#[test]
fn system_deny_insert_maintains_trace_and_operator_commit_are_atomic() {
    let mut runtime = fixture();
    assert!(matches!(
        viewer(&mut runtime, "insert").state,
        ExecutionState::Rejected { .. }
    ));
    let execution = operator(&mut runtime, "insert");
    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    assert_eq!(execution.trace.writes["items"], 1);
    assert_eq!(execution.trace.writes["totals"], 1);
    assert!(
        execution
            .trace
            .touched
            .iter()
            .any(|key| key.table == "totals")
    );
    let commit = runtime
        .store()
        .commits_since(execution.seq - 1, 1)
        .unwrap()
        .remove(0);
    assert_eq!(commit.kind, "operator");
    assert_eq!(commit.principal, "system");
    assert_eq!(commit.by.as_deref(), Some("alice"));
    assert_eq!(commit.writes, execution.trace.writes);
    assert_eq!(commit.touched, execution.trace.touched);
    assert_eq!(execution.receipt, Default::default());
    let query = program(
        "total",
        ProgramKind::Query,
        vec![Stmt::Return(get("totals", "[\"s1\"]"))],
    );
    // Deterministic maintain ids encode tagged Values, so read the whole bounded target instead.
    let mut query = query;
    if let Stmt::Return(Expr::Get(read)) = &mut query.body[0] {
        read.index = "byScope".into();
        read.key = vec![Expr::Literal(Value::Id("s1".into()))];
    }
    let total = runtime
        .read_operator(&query, BTreeMap::new(), OperatorId("alice".into()), 5)
        .unwrap();
    assert_eq!(total.result.field("value").unwrap(), &Value::Int(3));
    assert_eq!(total.receipt, Default::default());
}
#[test]
fn system_immutable_and_unique_reject_but_rule_denied_update_and_delete_commit() {
    let mut runtime = fixture();
    let seq = runtime.store().commit_seq().unwrap();
    for op in ["immutable", "unique"] {
        let execution = operator(&mut runtime, op);
        assert!(
            matches!(&execution.state, ExecutionState::Rejected { code, .. } if code == "E_CONSTRAINT"),
            "{:?}",
            execution.state
        );
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        assert_eq!(operator(&mut runtime, "point").result, item("i1", "first"));
    }
    for op in ["update", "delete"] {
        assert!(matches!(
            operator(&mut runtime, op).state,
            ExecutionState::Committed { .. }
        ));
    }
    assert_eq!(operator(&mut runtime, "point").result, Value::Null);
}
