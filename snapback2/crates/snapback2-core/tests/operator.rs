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
fn fixture_project() -> ProjectJson {
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
    ProjectJson {
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
    }
}
fn fixture() -> Runtime {
    let project = fixture_project();
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
        assert!(execution.trace.steps > 0);
        let attempt = execution.trace.last_write_attempt.as_ref().unwrap();
        assert_eq!(attempt.table, "items");
        assert_eq!(attempt.kind, WriteKind::Update);
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

#[test]
fn operator_sweep_baseline_nonuniform_range_fill_refuses_ordinary_certification() {
    let mut project = fixture_project();
    let Expr::Scan(range) = scan("byId", vec![], 10) else {
        unreachable!()
    };
    let fill = program(
        "operator_sweep_baseline",
        ProgramKind::Mutation,
        vec![Stmt::For {
            binding: "row".into(),
            domain: LoopDomain::Page(range),
            body: vec![Stmt::Update {
                table: "items".into(),
                key: Expr::Field {
                    base: Box::new(Expr::Variable("row".into())),
                    name: "id".into(),
                },
                patch: Expr::Literal(object([("label", Value::String("filled".into()))])),
            }],
        }],
    );
    let viewer_refusal = Checker::new(&project.schema, Ceilings::default())
        .check(&fill)
        .unwrap_err();
    // @ref LLP 1017#32-the-rule — a mutation looping over an uncapped page refuses as a
    // fan-out first; the count refusal it also earns is second.
    assert_eq!(viewer_refusal.code, "E_STRUCTURAL_FANOUT");
    project.programs = vec![fill];
    let operator_refusals = Generation::certify(&project, Ceilings::default()).unwrap_err();
    assert!(
        operator_refusals
            .iter()
            .any(|(op, error)| op == "operator_sweep_baseline" && error == &viewer_refusal)
    );
}

#[test]
fn operator_sweep_baseline_explicit_key_fill_certifies_and_commits_on_same_nonuniform_table() {
    let mut runtime = fixture();
    let (program, _) = &runtime.generation().programs()["update"];
    Checker::new(runtime.generation().schema(), Ceilings::default())
        .check(program)
        .unwrap();
    let before = runtime.store().commit_seq().unwrap();
    let filled = operator(&mut runtime, "update");
    assert_eq!(filled.state, ExecutionState::Committed { seq: before + 1 });
    assert_eq!(filled.trace.writes["items"], 1);
    assert_eq!(
        operator(&mut runtime, "point").result,
        item("i1", "changed")
    );
}

#[test]
fn viewer_still_probes_exists_and_transaction_local_created_rules() {
    let mut project = fixture_project();
    project.schema.tables.get_mut("items").unwrap().rules.insert = RuleExpr::Created {
        table: "memberships".into(),
        index: "byScopePrincipal".into(),
        key: vec![RuleTerm::Field("scope".into()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let insert = project
        .programs
        .iter()
        .find(|p| p.name == "insert")
        .unwrap()
        .body
        .clone();
    let mut body = vec![Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(object([
            ("id", Value::Id("member".into())),
            ("scope", Value::Id("s1".into())),
            ("principal", Value::Id("alice".into())),
        ])),
    }];
    body.extend(insert);
    project
        .programs
        .push(program("created", ProgramKind::Mutation, body));
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        Generation::certify(&project, Ceilings::default()).unwrap(),
    )
    .unwrap();
    assert!(matches!(
        viewer(&mut runtime, "insert").state,
        ExecutionState::Rejected { .. }
    ));
    let created = viewer(&mut runtime, "created");
    assert!(
        matches!(created.state, ExecutionState::Committed { .. }),
        "{created:?}"
    );
    assert!(created.trace.rule_probes > 0);
    assert!(!created.trace.rule_inputs.is_empty());
    let visible = viewer(&mut runtime, "all");
    assert_eq!(visible.result.as_array().unwrap().len(), 1);
    assert!(visible.trace.rule_probes > 0);
    assert!(!visible.trace.rule_inputs.is_empty());
    // An existing membership is insufficient for Created: it must be inserted in this transaction.
    let refused = viewer(&mut runtime, "insert");
    assert!(matches!(refused.state, ExecutionState::Rejected { ref code, .. } if code == "E_RULE"));
}

#[test]
fn system_insert_still_binds_final_exists_postcondition() {
    let mut project = fixture_project();
    project
        .schema
        .tables
        .get_mut("items")
        .unwrap()
        .constraints
        .push(Constraint::FinalExistsOnInsert {
            table: "memberships".into(),
            index: "byId".into(),
            key: vec![RuleTerm::Field("scope".into())],
        });
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        Generation::certify(&project, Ceilings::default()).unwrap(),
    )
    .unwrap();
    let failed = operator(&mut runtime, "insert");
    assert!(
        matches!(failed.state, ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"),
        "{failed:?}"
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    runtime
        .seed(&[(
            "memberships".into(),
            object([
                ("id", Value::Id("s1".into())),
                ("scope", Value::Id("s1".into())),
                ("principal", Value::Id("alice".into())),
            ]),
        )])
        .unwrap();
    let inserted = operator(&mut runtime, "insert");
    assert!(
        matches!(inserted.state, ExecutionState::Committed { .. }),
        "{inserted:?}"
    );
    assert!(
        inserted
            .trace
            .constraint_inputs
            .iter()
            .any(|input| input.table == "memberships")
    );
}

#[test]
fn system_range_exhausts_examined_ceiling_and_reports_capped() {
    let mut project = fixture_project();
    project.programs = vec![program(
        "ceiling",
        ProgramKind::Query,
        vec![Stmt::Return(scan("byId", vec![], 3))],
    )];
    let generation = Generation::certify(
        &project,
        Ceilings {
            examined: 5,
            ..Ceilings::default()
        },
    )
    .unwrap();
    assert_eq!(generation.programs()["ceiling"].1.max_examined, 5);
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime
        .seed(
            &(0..7)
                .map(|i| {
                    (
                        "items".into(),
                        item(&format!("i{i}"), &format!("label-{i}")),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
    let execution = operator(&mut runtime, "ceiling");
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(execution.trace.examined, 5);
    assert_eq!(execution.trace.rule_probes, 0);
    assert_eq!(execution.trace.ranges[0].stop, StopReason::Limit);
    assert_eq!(execution.result.as_array().unwrap().len(), 3);
}
