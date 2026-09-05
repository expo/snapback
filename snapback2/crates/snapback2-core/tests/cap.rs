use snapback2_core::*;
use std::collections::BTreeMap;

fn schema(cap: Option<u32>) -> Schema {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "group".into(),
                ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    columns: vec!["id".into()],
                    unique: true,
                },
            ),
            (
                "byGroup".into(),
                Index {
                    columns: vec!["group".into(), "id".into()],
                    unique: false,
                },
            ),
        ]),
    );
    if let Some(max) = cap {
        table.constraints.push(Constraint::Cap {
            by: vec!["group".into()],
            max,
        });
    }
    Schema {
        tables: BTreeMap::from([("memberships".into(), table)]),
        ..Schema::default()
    }
}

fn generation(schema: Schema) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![],
            effects: vec![],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn row(n: usize, group: Option<Value>) -> Value {
    let mut fields = BTreeMap::from([("id".into(), id(&format!("m{n}")))]);
    if let Some(group) = group {
        fields.insert("group".into(), group);
    }
    Value::Row(fields)
}

fn program(body: Vec<Stmt>) -> Program {
    Program {
        name: "cap.test".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        result_page_site: None,
        body,
    }
}

fn context() -> Context {
    Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new())
}

#[test]
fn cap_reserves_every_writer_and_charges_the_refusing_probe() {
    let schema = schema(Some(50));
    for statement in [
        Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(row(49, Some(text("c1")))),
        },
        Stmt::Upsert {
            table: "memberships".into(),
            key: Expr::Literal(id("m49")),
            row: Expr::Literal(row(49, Some(text("c1")))),
        },
        Stmt::Update {
            table: "memberships".into(),
            key: Expr::Literal(id("m49")),
            patch: Expr::Literal(object([("group", text("c1"))])),
        },
    ] {
        let certificate = Checker::new(&schema, Ceilings::default())
            .check(&program(vec![statement]))
            .unwrap();
        assert_eq!(certificate.max_examined, 50);
        assert_eq!(certificate.max_index_entries, 50);
        assert!(
            certificate
                .indexes_required
                .contains(&"memberships.byGroup".to_owned())
        );
    }
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..49 {
        engine
            .seed("memberships", row(n, Some(text("c1"))))
            .unwrap();
    }
    for n in [49, 50] {
        let p = program(vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(row(n, Some(text("c1")))),
        }]);
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&p)
            .unwrap();
        let result = engine.execute(&p, &cert, context());
        if n == 49 {
            let result = result.unwrap();
            assert_eq!(result.trace.examined, 49);
            assert!(matches!(result.state, ExecutionState::Committed { .. }));
        } else {
            let error = result.unwrap_err();
            assert_eq!(error.code(), "E_CONSTRAINT");
            assert!(error.to_string().contains("memberships cap 50 reached"));
        }
    }
    assert_eq!(engine.rows("memberships").unwrap().len(), 50);
}

#[test]
fn omitted_optional_cap_key_is_null_and_same_group_updates_do_not_probe() {
    let schema = schema(Some(1));
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let insert = program(vec![Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(row(0, None)),
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    assert!(matches!(
        engine.execute(&insert, &cert, context()).unwrap().state,
        ExecutionState::Committed { .. }
    ));
    let same = program(vec![Stmt::Update {
        table: "memberships".into(),
        key: Expr::Literal(id("m0")),
        patch: Expr::Literal(object([("group", Value::Null)])),
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&same)
        .unwrap();
    let same = engine.execute(&same, &cert, context()).unwrap();
    assert!(matches!(same.state, ExecutionState::Committed { .. }));
    assert_eq!(same.trace.examined, 0);
    let insert = program(vec![Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(row(1, Some(Value::Null))),
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    assert_eq!(
        engine
            .execute(&insert, &cert, context())
            .unwrap_err()
            .code(),
        "E_CONSTRAINT"
    );
}

#[test]
fn product_seed_waives_metering_ceilings_but_enforces_every_cap() {
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema(Some(50)))).unwrap();
    let rows = (0..205)
        .map(|n| {
            (
                "memberships".into(),
                row(n, Some(text(&format!("c{}", n / 41)))),
            )
        })
        .collect::<Vec<_>>();
    runtime.seed(&rows).unwrap();
    let full = (0..51)
        .map(|n| ("memberships".into(), row(1000 + n, Some(text("full")))))
        .collect::<Vec<_>>();
    let error = runtime.seed(&full).unwrap_err();
    assert_eq!(error.code(), "E_CONSTRAINT");
    assert!(error.to_string().contains("memberships cap 50 reached"));
    println!("seed refusal: {error}");
}

#[test]
fn successor_checks_added_raised_lowered_and_removed_caps() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(schema(None))).unwrap();
    runtime
        .seed(
            &(0..51)
                .map(|n| ("memberships".into(), row(n, Some(text("c1")))))
                .collect::<Vec<_>>(),
        )
        .unwrap();
    let refusal = runtime
        .apply_successor(generation(schema(Some(50))))
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_CAP");
    assert_eq!(refusal.cap_conflicts.len(), 1);
    assert_eq!(refusal.cap_conflicts[0].count, 51);
    assert_eq!(refusal.cap_conflicts[0].key, vec![text("c1")]);
    println!(
        "successor refusal: {}",
        serde_json::to_string(&refusal).unwrap()
    );
    runtime
        .apply_successor(generation(schema(Some(60))))
        .unwrap();
    assert_eq!(
        runtime
            .apply_successor(generation(schema(Some(50))))
            .unwrap_err()
            .code,
        "E_SUCCESSOR_CAP"
    );
    runtime.apply_successor(generation(schema(None))).unwrap();
}

#[test]
fn unchanged_successor_cap_detects_type_drop_collapsing_groups_and_rolls_back() {
    let old = schema(Some(1));
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(old.clone())).unwrap();
    runtime
        .seed(&[
            ("memberships".into(), row(0, Some(text("a")))),
            ("memberships".into(), row(1, Some(text("b")))),
        ])
        .unwrap();
    let mut next = old;
    next.tables.get_mut("memberships").unwrap().columns.insert(
        "group".into(),
        ColumnType::Optional(Box::new(ColumnType::Int)),
    );
    let next = generation(next);
    let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
    let error = runtime.apply_migration(next, &plan, 0).unwrap_err();
    assert_eq!(error.code(), "E_SUCCESSOR_CAP");
    let RuntimeError::Successor(refusal) = error else {
        panic!("expected successor refusal");
    };
    assert_eq!(refusal.cap_conflicts[0].key, vec![Value::Null]);
    assert_eq!(refusal.cap_conflicts[0].count, 2);
    assert_eq!(
        runtime.generation().schema().tables["memberships"].columns["group"],
        ColumnType::Optional(Box::new(ColumnType::Text { max: 64 }))
    );
}

#[test]
fn cap_admission_runs_without_writers_and_limits_conflict_payload() {
    let mut bad = schema(Some(50));
    bad.tables
        .get_mut("memberships")
        .unwrap()
        .indexes
        .remove("byGroup");
    let errors = engine::validate_schema(&bad).unwrap_err();
    assert_eq!(errors[0].code(), "E_SCHEMA_CONSTRAINT");
    assert!(
        errors[0]
            .to_string()
            .contains("needs an index that begins with group")
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(schema(None))).unwrap();
    runtime
        .seed(
            &(0..24)
                .map(|n| {
                    (
                        "memberships".into(),
                        row(n, Some(text(&format!("g{}", n / 2)))),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
    let error = runtime
        .apply_successor(generation(schema(Some(1))))
        .unwrap_err();
    assert_eq!(error.cap_conflicts.len(), 10);
    assert!(error.message.contains("12 group(s)"));
}

fn scan() -> Scan {
    Scan {
        site: "members".into(),
        table: "memberships".into(),
        index: "byGroup".into(),
        prefix: vec![Expr::Literal(Value::Null)],
        order: Order::Asc,
        take: Bound::Literal(50),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    }
}

#[test]
fn complete_loop_tests_capacity_even_when_a_small_group_exhausts() {
    let schema = schema(Some(50));
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine.seed("memberships", row(0, None)).unwrap();
    let p = program(vec![Stmt::For {
        binding: "m".into(),
        domain: LoopDomain::Page(scan()),
        body: vec![Stmt::Delete {
            table: "memberships".into(),
            key: field(var("m"), "id"),
        }],
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert!(cert.read_sites[0].complete);
    let mut unpinned = p.clone();
    if let Stmt::For {
        domain: LoopDomain::Page(scan),
        ..
    } = &mut unpinned.body[0]
    {
        scan.prefix.clear();
    }
    let refusal = Checker::new(&schema, Ceilings::default())
        .check(&unpinned)
        .unwrap_err();
    assert_eq!(refusal.code, "E_STRUCTURAL_FANOUT");
    assert!(refusal.rewrite.starts_with("pin a declared group"));
    assert!(
        !refusal.rewrite.starts_with("cap "),
        "a cap alone cannot repair an unpinned loop"
    );
    let mut cut = cert.clone();
    cut.max_examined = 1;
    let error = engine.execute(&p, &cut, context()).unwrap_err();
    assert_eq!(error.code(), "E_TRACE_SUBSET");
    assert!(
        error
            .to_string()
            .contains("complete loop at members was budget-cut")
    );
    assert_eq!(engine.rows("memberships").unwrap().len(), 1);
    assert!(matches!(
        engine.execute(&p, &cert, context()).unwrap().state,
        ExecutionState::Committed { .. }
    ));
    assert!(engine.rows("memberships").unwrap().is_empty());
}

fn id(value: &str) -> Value {
    Value::Id(value.to_owned())
}
fn text(value: &str) -> Value {
    Value::String(value.to_owned())
}

#[test]
fn complete_loop_rejects_rule_probe_starvation_before_fetching() {
    let mut schema = schema(Some(50));
    let mut grants = schema.tables["memberships"].clone();
    grants.constraints.clear();
    grants.indexes.get_mut("byGroup").unwrap().columns = vec!["group".into()];
    schema.tables.insert("grants".into(), grants);
    schema.tables.get_mut("memberships").unwrap().rules.read = RuleExpr::Exists {
        table: "grants".into(),
        index: "byGroup".into(),
        key: vec![RuleTerm::Field("group".into())],
        provenance: KeyProvenance::Shape,
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine.seed("memberships", row(0, None)).unwrap();
    engine.seed("grants", row(0, None)).unwrap();
    let p = program(vec![Stmt::For {
        binding: "m".into(),
        domain: LoopDomain::Page(scan()),
        body: vec![Stmt::Delete {
            table: "memberships".into(),
            key: field(var("m"), "id"),
        }],
    }]);
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&p)
        .unwrap();
    assert!(cert.max_rule_probes > 0);
    let mut cut = cert.clone();
    cut.max_rule_probes = 0;
    let error = engine.execute(&p, &cut, context()).unwrap_err();
    assert_eq!(error.code(), "E_TRACE_SUBSET");
    assert!(error.to_string().contains("budget-cut"));
    assert_eq!(engine.rows("memberships").unwrap().len(), 1);
    engine.execute(&p, &cert, context()).unwrap();
}

#[test]
fn loop_back_edge_cannot_hide_a_page_transformation() {
    let schema = schema(Some(50));
    let p = program(vec![
        Stmt::Let {
            name: "page".into(),
            value: Expr::Scan(scan()),
        },
        Stmt::For {
            binding: "round".into(),
            domain: LoopDomain::LiteralRange {
                start: 0,
                end_exclusive: 2,
            },
            body: vec![
                Stmt::For {
                    binding: "m".into(),
                    domain: LoopDomain::DerivedArray {
                        value: var("page"),
                        max: 50,
                        bound_source: "page".into(),
                    },
                    body: vec![],
                },
                Stmt::Assign {
                    name: "page".into(),
                    value: Expr::Builtin {
                        builtin: Builtin::Slice,
                        args: vec![
                            var("page"),
                            Expr::Literal(Value::Int(0)),
                            Expr::Literal(Value::Int(1)),
                        ],
                    },
                },
            ],
        },
    ]);
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&p)
        .unwrap_err();
    assert!(
        errors.iter().any(
            |e| e.code == "E_STRUCTURAL_FANOUT" && e.message.contains("not a single page scan")
        )
    );
}

#[path = "cap/review.rs"]
mod review;
