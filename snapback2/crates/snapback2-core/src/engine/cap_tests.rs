use super::*;
use crate::{Ceilings, Checker, Constraint, Index, public_table};

#[path = "maintained_boundary_tests.rs"]
mod maintained_boundary_tests;

#[test]
fn omitted_parent_rows_share_the_null_cap_group_and_remain_visible_after_refusal() {
    // @ref LLP 1011#null-keys-and-id-literals-2026-09-05 — omission and literal-null probes address the same capped group.
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "parent".into(),
                ColumnType::Optional(Box::new(ColumnType::Id)),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: (vec!["id".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byParent".into(),
                Index {
                    components: (vec!["parent".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["parent".into()],
        max: 2,
    });
    let schema = Schema {
        tables: BTreeMap::from([("buckets".into(), table)]),
        ..Schema::default()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let mut insert = Program {
        name: "buckets.insert".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "buckets".into(),
            row: Expr::Object(BTreeMap::from([("id".into(), Expr::Input(Input::NewId))])),
        }],
    };
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    let context = |key: &str| {
        let mut context = Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new());
        context.new_ids.push_back(key.into());
        context
    };
    engine.execute(&insert, &cert, context("one")).unwrap();
    engine.execute(&insert, &cert, context("two")).unwrap();
    let error = engine
        .execute(&insert, &cert, context("three"))
        .unwrap_err();
    assert_eq!(error.code(), "E_CONSTRAINT");
    let message = error.to_string();
    assert!(
        message.contains("cap 2") && message.contains("parent") && message.contains("Null"),
        "{message}"
    );
    let probe = Program {
        name: "buckets.exists".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Exists(Read {
            site: "buckets.null".into(),
            table: "buckets".into(),
            index: "byParent".into(),
            key: vec![Expr::Literal(Value::Null)],
            provenance: KeyProvenance::Const,
        }))],
    };
    let probe_cert = Checker::new(&schema, Ceilings::default())
        .check(&probe)
        .unwrap();
    assert_eq!(
        engine
            .execute(&probe, &probe_cert, context("unused"))
            .unwrap()
            .result,
        Value::Bool(true)
    );
    assert_eq!(engine.rows("buckets").unwrap().len(), 2);
    if let Stmt::Insert {
        row: Expr::Object(fields),
        ..
    } = &mut insert.body[0]
    {
        fields.insert("parent".into(), Expr::Literal(Value::Id("post".into())));
    }
    let cert = Checker::new(&schema, Ceilings::default())
        .check(&insert)
        .unwrap();
    engine
        .execute(&insert, &cert, context("present-one"))
        .unwrap();
    engine
        .execute(&insert, &cert, context("present-two"))
        .unwrap();
    assert_eq!(engine.rows("buckets").unwrap().len(), 4);
}

#[test]
fn refusing_cap_probe_is_charged_before_returning_constraint_error() {
    let mut table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (
                "group".into(),
                ColumnType::Optional(Box::new(ColumnType::Id)),
            ),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: (vec!["id".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byGroup".into(),
                Index {
                    components: (vec!["group".into(), "id".into()])
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    table.constraints.push(Constraint::Cap {
        by: vec!["group".into()],
        max: 50,
    });
    let schema = Schema {
        tables: BTreeMap::from([("memberships".into(), table)]),
        ..Schema::default()
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..50 {
        engine
            .seed(
                "memberships",
                crate::object([("id", Value::Id(format!("m{n}")))]),
            )
            .unwrap();
    }
    let program = Program {
        name: "cap.refusing".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Literal(crate::object([("id", Value::Id("over".into()))])),
        }],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let tx = engine.store.conn.transaction().unwrap();
    let hashes = hashes::PolicyHashes::new(&schema);
    let mut runner = Runner::new(
        &tx,
        &schema,
        &hashes,
        &certificate,
        Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        &[],
        &[],
        RuleAuthority::StoreAuthoritative,
        1,
    );
    assert_eq!(
        runner.statements(&program.body).unwrap_err().code(),
        "E_CONSTRAINT"
    );
    assert_eq!(runner.trace.examined, 50);
    assert_eq!(
        runner
            .trace
            .constraint_inputs
            .iter()
            .find(|c| c.check.starts_with("Cap("))
            .unwrap()
            .examined_ids
            .len(),
        50
    );
    runner.assert_bounds().unwrap();
}

#[test]
fn same_key_count_tracks_writes_inside_one_program_and_refuses_after_max() {
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into(), "id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 3,
    });
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("membershipCounts".into(), counts),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "memberships".into(),
            by: vec!["principal".into()],
            target: "membershipCounts".into(),
            readable: None,
        }],
        ..Schema::default()
    };
    let insert = |id: &str| Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(crate::object([
            ("id", Value::Id(id.into())),
            ("principal", Value::Id("alice".into())),
        ])),
    };
    let fill = Program {
        name: "memberships.fill".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![insert("m1"), insert("m2"), insert("m3")],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&fill)
        .unwrap();
    assert_eq!(certificate.max_examined, 3);
    assert_eq!(certificate.max_index_entries, 3);
    assert!(
        certificate
            .indexes_required
            .contains(&"memberships.byPrincipal".to_owned())
    );
    assert!(
        certificate
            .indexes_required
            .contains(&"membershipCounts.byId".to_owned())
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let execution = engine
        .execute(
            &fill,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(execution.trace.examined, 3);
    let cap_inputs: Vec<_> = execution
        .trace
        .constraint_inputs
        .iter()
        .filter(|input| input.check.starts_with("Cap("))
        .collect();
    assert_eq!(cap_inputs.len(), 3);
    assert!(cap_inputs.iter().all(|input| {
        input.table == "membershipCounts"
            && input.index == "byId"
            && matches!(input.prefix.as_slice(), [Value::Id(_)])
    }));
    let count_id = canonical_json(&vec![Value::Id("alice".into())]);
    assert_eq!(
        engine.rows("membershipCounts").unwrap()[0]
            .field("value")
            .unwrap(),
        &Value::Int(3)
    );
    assert_eq!(
        engine.rows("membershipCounts").unwrap()[0]
            .field("id")
            .unwrap(),
        &Value::Id(count_id)
    );

    let over = Program {
        name: "memberships.over".into(),
        body: vec![insert("m4")],
        ..fill
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&over)
        .unwrap();
    assert_eq!(
        engine
            .execute(
                &over,
                &certificate,
                Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap_err()
            .code(),
        "E_CONSTRAINT"
    );
    assert_eq!(engine.rows("memberships").unwrap().len(), 3);
}

#[test]
fn count_backed_probe_refuses_inside_one_program_and_rolls_the_earlier_writes_back() {
    // Four inserts under `cap 3 by principal` in ONE program: the fourth probe
    // sees this program's own three earlier inserts through the maintained
    // count and refuses; the refusal rolls the whole program back, so neither
    // the three rows nor the count row survive.
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into(), "id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    memberships
        .columns
        .insert("label".into(), ColumnType::Text { max: 20 });
    memberships.indexes.insert(
        "byWords".into(),
        Index {
            unique: false,
            components: vec![
                crate::search_key::IndexComponent::Column("principal".into()),
                crate::search_key::IndexComponent::WordPrefixes {
                    fields: vec!["label".into()],
                    contract: crate::search_key::SearchContract::Unicode17,
                },
                crate::search_key::IndexComponent::Column("id".into()),
            ],
        },
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 3,
    });
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("membershipCounts".into(), counts),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "memberships".into(),
            by: vec!["principal".into()],
            target: "membershipCounts".into(),
            readable: None,
        }],
        ..Schema::default()
    };
    let insert = |id: &str| Stmt::Insert {
        table: "memberships".into(),
        row: Expr::Literal(crate::object([
            ("id", Value::Id(id.into())),
            ("principal", Value::Id("alice".into())),
            ("label", Value::String("Café".into())),
        ])),
    };
    let overfill = Program {
        name: "memberships.overfill".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![insert("m1"), insert("m2"), insert("m3"), insert("m4")],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&overfill)
        .unwrap();
    assert_eq!(
        certificate.max_examined, 4,
        "one examined row per count-backed probe"
    );
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let error = engine
        .execute(
            &overfill,
            &certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap_err();
    assert_eq!(error.code(), "E_CONSTRAINT");
    assert!(error.to_string().contains("cap 3"), "{error}");
    let probe = Program {
        name: "memberships.probe".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Exists(Read {
            site: "memberships.first".into(),
            table: "memberships".into(),
            index: "byId".into(),
            key: vec![Expr::Literal(Value::Id("m1".into()))],
            provenance: KeyProvenance::Const,
        }))],
    };
    let probe_certificate = Checker::new(&schema, Ceilings::default())
        .check(&probe)
        .unwrap();
    let outcome = engine
        .execute(
            &probe,
            &probe_certificate,
            Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(
        outcome.result,
        Value::Bool(false),
        "the refused program left no membership row behind"
    );
    assert!(engine.rows("membershipCounts").unwrap().is_empty());
    // The count-backed refusal also rolls back the derived postings; a later
    // successful program must maintain both representations in the same transaction.
    let search = Program {
        name: "memberships.search".into(),
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "memberships.words".into(),
            table: "memberships".into(),
            index: "byWords".into(),
            prefix: vec![
                IndexKeyExpr::Scalar(Expr::Literal(Value::Id("alice".into()))),
                IndexKeyExpr::WordPrefix {
                    source: Expr::Literal(Value::String("CAFE\u{301}".into())),
                    source_max: 5, // exact literal bound, independent of label max 20
                    contract: crate::search_key::SearchContract::Unicode17,
                },
            ],
            order: Order::Asc,
            take: Bound::Literal(4),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
        ..probe
    };
    let search_certificate = Checker::new(&schema, Ceilings::default())
        .check(&search)
        .unwrap();
    let read = |engine: &mut Engine| {
        engine
            .execute(
                &search,
                &search_certificate,
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new()),
            )
            .unwrap()
    };
    assert!(read(&mut engine).result.as_array().unwrap().is_empty());
    let fill = Program {
        body: vec![insert("m1"), insert("m2"), insert("m3")],
        ..overfill
    };
    let fill_certificate = Checker::new(&schema, Ceilings::default())
        .check(&fill)
        .unwrap();
    assert_eq!(fill_certificate.max_examined, 3);
    engine
        .execute(
            &fill,
            &fill_certificate,
            Context::mutation(Actor::user("alice").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    let result = read(&mut engine);
    assert_eq!(
        row_ids(result.result.as_array().unwrap()).unwrap(),
        ["m1", "m2", "m3"]
    );
    assert_eq!(
        engine.rows("membershipCounts").unwrap()[0]
            .field("value")
            .unwrap(),
        &Value::Int(3)
    );
}

#[test]
fn maintained_identity_boundary_runtime() {
    // Synthetic input derived from the existing count-cap fixture, through
    // Generation::certify and Runtime::execute (no raw store writes).
    let schema = maintained_boundary_schema();
    let principal = "a".repeat(135);
    let count_id = canonical_json(&vec![Value::Id(principal.clone())]);
    assert_eq!(canonical_json(&Value::Id(principal.clone())).len(), 144);
    assert_eq!(canonical_json(&Value::Id(count_id.clone())).len(), 159);
    let insert = Program {
        name: "memberships.boundary".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "memberships".into(),
            row: Expr::Object(BTreeMap::from([
                ("id".into(), Expr::Input(Input::NewId)),
                ("principal".into(), Expr::Input(Input::Viewer)),
            ])),
        }],
    };
    let project = crate::ProjectJson {
        version: 1,
        schema,
        programs: vec![insert],
        effects: vec![],
        auth: crate::Auth::default(),
    };
    let generation = crate::Generation::certify(&project, Ceilings::default()).unwrap();
    println!("synthetic_project={}", canonical_json(&project));
    println!(
        "certificate={}",
        canonical_json(&generation.programs()["memberships.boundary"].1)
    );
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let generation_hash = runtime.generation().hash();
    for n in 1..=4 {
        let before = runtime.store().commit_seq().unwrap();
        let mut context =
            Context::mutation(Actor::user(principal.clone()).unwrap(), BTreeMap::new());
        context.new_ids.push_back(format!("m{n}"));
        let result = runtime.execute("memberships.boundary", context);
        println!(
            "attempt={n} result={result:?} seq_before={before} seq_after={} rows={:?}",
            runtime.store().commit_seq().unwrap(),
            runtime.engine.rows("memberships")
        );
        assert_eq!(runtime.generation().hash(), generation_hash);
        println!(
            "maintained_rows_after_attempt={:?}",
            runtime.engine.rows("membershipCounts")
        );
        if n <= 3 {
            if result
                .as_ref()
                .is_ok_and(|e| matches!(e.state, ExecutionState::Rejected { .. }))
                || result.is_err()
            {
                assert_eq!(runtime.store().commit_seq().unwrap(), before);
                assert_eq!(
                    runtime.engine.rows("memberships").unwrap().len(),
                    (n - 1) as usize
                );
                println!(
                    "rollback_count_rows={:?}",
                    runtime.engine.rows("membershipCounts")
                );
            }
            let execution = result.expect("Runtime must return an execution state");
            assert!(
                matches!(execution.state, ExecutionState::Committed { .. }),
                "{execution:?}"
            );
            assert_eq!(runtime.store().commit_seq().unwrap(), before + 1);
            assert_eq!(execution.trace.examined, 1);
            let cap = execution
                .trace
                .constraint_inputs
                .iter()
                .find(|c| c.check.starts_with("Cap("))
                .unwrap();
            assert_eq!(cap.table, "membershipCounts");
            assert_eq!(cap.index, "byId");
            assert_eq!(cap.prefix, [Value::Id(count_id.clone())]);
            assert_eq!(cap.examined_ids.len(), usize::from(n > 1));
            assert_eq!(
                runtime.engine.rows("membershipCounts").unwrap()[0]
                    .field("id")
                    .unwrap(),
                &Value::Id(count_id.clone())
            );
            assert_eq!(
                runtime.engine.rows("membershipCounts").unwrap()[0]
                    .field("value")
                    .unwrap(),
                &Value::Int(n)
            );
        } else {
            let execution = result.unwrap();
            assert!(
                matches!(&execution.state, ExecutionState::Rejected { code, .. } if code == "E_CONSTRAINT"),
                "{execution:?}"
            );
            assert_eq!(runtime.store().commit_seq().unwrap(), before);
            assert_eq!(runtime.engine.rows("memberships").unwrap().len(), 3);
            assert_eq!(
                runtime.engine.rows("membershipCounts").unwrap()[0]
                    .field("value")
                    .unwrap(),
                &Value::Int(3)
            );
        }
    }
}

fn maintained_boundary_schema() -> Schema {
    let mut memberships = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into(), "id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: false,
                },
            ),
        ]),
    );
    memberships.constraints.push(Constraint::Cap {
        by: vec!["principal".into()],
        max: 3,
    });
    let counts = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("principal".into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec!["id".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
            (
                "byPrincipal".into(),
                Index {
                    components: vec!["principal".into()]
                        .into_iter()
                        .map(crate::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("memberships".into(), memberships),
            ("membershipCounts".into(), counts),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "memberships".into(),
            by: vec!["principal".into()],
            target: "membershipCounts".into(),
            readable: None,
        }],
        ..Schema::default()
    };

    schema
}

#[test]
fn maintained_references_receipts_and_cursors_use_the_declared_group_domain() {
    use crate::search_key::IndexComponent;
    let mut schema = maintained_boundary_schema();
    for table in ["memberships", "membershipCounts"] {
        schema.tables.get_mut(table).unwrap().columns.insert(
            "realm".into(),
            ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
        );
        let components = &mut schema
            .tables
            .get_mut(table)
            .unwrap()
            .indexes
            .get_mut("byPrincipal")
            .unwrap()
            .components;
        components.insert(1, IndexComponent::Column("realm".into()));
    }
    schema.maintains[0].by.push("realm".into());
    schema.tables.get_mut("memberships").unwrap().constraints = vec![Constraint::Cap {
        by: vec!["principal".into(), "realm".into()],
        max: 3,
    }];
    let principal = "a".repeat(135);
    let reference = ArgType::Ref {
        table: "membershipCounts".into(),
    };
    let read = Program {
        name: "counts.byAddress".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("address".into(), reference.clone())]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "count".into(),
            table: "membershipCounts".into(),
            index: "byId".into(),
            key: vec![Expr::Variable("address".into())],
            provenance: KeyProvenance::Arg,
        }))],
    };
    let page = Program {
        name: "counts.page".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(
            "cursor".into(),
            ArgType::Optional(Box::new(ArgType::Cursor)),
        )]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "page".into(),
            table: "membershipCounts".into(),
            index: "byId".into(),
            prefix: vec![],
            take: Bound::Literal(1),
            order: Order::Asc,
            after: Some(Box::new(Expr::Variable("cursor".into()))),
            before: None,
            range: None,
            opaque_cursor: true,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    let parent = ColumnType::Optional(Box::new(ColumnType::Ref {
        table: "membershipCounts".into(),
    }));
    let indexes = BTreeMap::from([
        (
            "byId".into(),
            Index {
                components: vec![IndexComponent::Column("id".into())],
                unique: true,
            },
        ),
        (
            "byParent".into(),
            Index {
                components: vec![
                    IndexComponent::Column("parent".into()),
                    IndexComponent::Column("id".into()),
                ],
                unique: false,
            },
        ),
    ]);
    schema.tables.insert(
        "links".into(),
        public_table(
            BTreeMap::from([
                ("id".into(), ColumnType::Id),
                ("parent".into(), parent.clone()),
                (
                    "parents".into(),
                    ColumnType::List {
                        of: Box::new(parent.clone()),
                        max: 2,
                    },
                ),
            ]),
            indexes.clone(),
        ),
    );
    schema.tables.insert(
        "linkCounts".into(),
        public_table(
            BTreeMap::from([
                ("id".into(), ColumnType::Id),
                ("parent".into(), parent),
                ("value".into(), ColumnType::Int),
            ]),
            BTreeMap::from([
                ("byId".into(), indexes["byId"].clone()),
                (
                    "byParent".into(),
                    Index {
                        components: vec![IndexComponent::Column("parent".into())],
                        unique: true,
                    },
                ),
            ]),
        ),
    );
    schema.maintains.push(Maintain {
        source: "links".into(),
        target: "linkCounts".into(),
        by: vec!["parent".into()],
        kind: MaintainKind::Count,
        readable: None,
    });
    let linked = Program {
        name: "links.count".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("address".into(), reference.clone())]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "linked".into(),
            table: "linkCounts".into(),
            index: "byParent".into(),
            key: vec![Expr::Variable("address".into())],
            provenance: KeyProvenance::Arg,
        }))],
    };
    let project = crate::ProjectJson {
        version: 1,
        schema: schema.clone(),
        programs: vec![read.clone(), page.clone(), linked.clone()],
        effects: vec![],
        auth: crate::Auth::default(),
    };
    let generation = crate::Generation::certify(&project, Ceilings::default()).unwrap();
    let certificate = generation.programs()[&read.name].1.clone();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let realms = [Value::Null, Value::String("é\\\"".repeat(16))];
    let mut addresses = vec![];
    for (i, realm) in realms.into_iter().enumerate() {
        let address = Value::Id(canonical_json(&vec![
            Value::Id(principal.clone()),
            realm.clone(),
        ]));
        let args = BTreeMap::from([("address".into(), address.clone())]);
        let empty = runtime
            .execute(
                &read.name,
                Context::query(Actor::user("alice").unwrap(), args.clone()),
            )
            .unwrap();
        assert_eq!(empty.result, Value::Null);
        assert!(empty.receipt.absences.contains(&(
            "membershipCounts".into(),
            "byId".into(),
            vec![address.clone()]
        )));
        empty.receipt.validate_pool(&schema).unwrap();
        let mut source = BTreeMap::from([
            ("id".into(), Value::Id(format!("m{i}"))),
            ("principal".into(), Value::Id(principal.clone())),
        ]);
        if realm != Value::Null {
            source.insert("realm".into(), realm);
        }
        // Product seed uses the same certified transactional maintain path;
        // omission in the first row and explicit null have the same address.
        runtime
            .seed(&[("memberships".into(), Value::Row(source.into()))])
            .unwrap();
        let execution = runtime
            .execute(
                &read.name,
                Context::query(Actor::user("alice").unwrap(), args.clone()),
            )
            .unwrap();
        assert_eq!(execution.result.field("id").unwrap(), &address);
        assert!(canonical_json(&execution.result).len() as u64 <= certificate.max_output_bytes);
        assert!(canonical_json(&execution.receipt).len() as u64 <= certificate.max_closure_bytes);
        let mut held = crate::ClientStore::hydrate(schema.clone(), &execution.receipt).unwrap();
        let (state, replay) = held
            .reexecute(
                &read,
                &certificate,
                Context::query(Actor::user("alice").unwrap(), args.clone()),
            )
            .unwrap();
        assert_eq!(state, crate::LocalState::Fresh);
        assert_eq!(replay.result, execution.result);
        let projected = crate::project_delivery(
            &execution,
            &crate::DeliveryProjectionContext {
                schema: &schema,
                read_time: None,
                op: &read.name,
                args: &args,
                generation: runtime.generation().program_hash(),
                schema_hash: &certificate.schema_hash,
                plan_hash: &certificate.plan_hash,
                principal: "alice",
                auth_epoch: 1,
            },
        )
        .unwrap();
        println!(
            "parity_witness={}",
            serde_json::json!({"project":project,"program":read.name,"args":args,"certificate":certificate,"execution":execution,"delivery":projected})
        );
        let mut forged = execution.receipt.clone();
        let mut fields = forged.rows[0].row.as_object().unwrap().clone();
        fields.insert("principal".into(), Value::Id("different".into()));
        forged.rows[0].row = Value::Row(fields.into());
        assert!(crate::ClientStore::hydrate(schema.clone(), &forged).is_err());
        assert!(validate_arg_value(&ArgType::Id, &address, "untyped").is_err());
        assert!(
            validate_typed_arg_value(
                &schema,
                &ArgType::Ref {
                    table: "memberships".into()
                },
                &address,
                "wrong target"
            )
            .is_err()
        );
        let nested = ArgType::Optional(Box::new(ArgType::List {
            max: 2,
            of: Some(Box::new(reference.clone())),
        }));
        validate_typed_arg_value(
            &schema,
            &nested,
            &Value::Array(vec![address.clone(), address.clone()]),
            "nested",
        )
        .unwrap();
        assert!(
            crate::retention::argument_max(&schema, &nested)
                >= canonical_json(&Value::Array(vec![address.clone(), address.clone()])).len()
                    as u64
        );
        runtime
            .seed(&[(
                "links".into(),
                crate::object([
                    ("id", Value::Id(format!("link{i}"))),
                    ("parent", address.clone()),
                    ("parents", Value::Array(vec![Value::Null, address.clone()])),
                ]),
            )])
            .unwrap();
        let linked_result = runtime
            .execute(
                &linked.name,
                Context::query(Actor::user("alice").unwrap(), args.clone()),
            )
            .unwrap();
        assert_eq!(linked_result.result.field("value").unwrap(), &Value::Int(1));
        assert_eq!(
            linked_result.result.field("id").unwrap(),
            &Value::Id(canonical_json(&vec![address.clone()]))
        );
        let linked_certificate = &runtime.generation().programs()[&linked.name].1;
        assert!(
            canonical_json(&linked_result.result).len() as u64
                <= linked_certificate.max_output_bytes
        );
        linked_result.receipt.validate_pool(&schema).unwrap();
        println!(
            "parity_witness={}",
            serde_json::json!({"project":project,"program":linked.name,"args":args,"certificate":linked_certificate,"execution":linked_result})
        );
        addresses.push(address);
    }
    let first = runtime
        .execute(
            &page.name,
            Context::query(
                Actor::user("alice").unwrap(),
                BTreeMap::from([("cursor".into(), Value::Null)]),
            ),
        )
        .unwrap();
    let token = first
        .next
        .clone()
        .expect("two groups require a second one-row page");
    let decoded = crate::decode_cursor(&schema, &token).unwrap();
    assert!(addresses.contains(&decoded.values[0]));
    assert!(crate::decode_cursor(&Schema::default(), &token).is_err());
    let second = runtime
        .execute(
            &page.name,
            Context::query(
                Actor::user("alice").unwrap(),
                BTreeMap::from([("cursor".into(), Value::String(token))]),
            ),
        )
        .unwrap();
    let ids = [
        first.result.as_array().unwrap()[0]
            .field("id")
            .unwrap()
            .clone(),
        second.result.as_array().unwrap()[0]
            .field("id")
            .unwrap()
            .clone(),
    ];
    assert_ne!(ids[0], ids[1]);
    assert!(ids.iter().all(|id| addresses.contains(id)));
}

#[test]
fn unbounded_maintained_reference_domain_refuses_only_its_consumers() {
    let mut schema = maintained_boundary_schema();
    for name in ["memberships", "membershipCounts"] {
        schema.tables.get_mut(name).unwrap().columns.insert(
            "principal".into(),
            ColumnType::Ref {
                table: "membershipCounts".into(),
            },
        );
    }
    let ordinary = Program {
        name: "ordinary".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Int(7)))],
    };
    let consumer = Program {
        name: "unbounded".into(),
        args: BTreeMap::from([(
            "address".into(),
            ArgType::Ref {
                table: "membershipCounts".into(),
            },
        )]),
        body: vec![Stmt::Return(Expr::Variable("address".into()))],
        ..ordinary.clone()
    };
    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&consumer)
        .unwrap_err();
    println!("cyclic_domain_refusal={errors:?}");
    assert!(errors.iter().any(|error| error.code == "E_BOUND"));
    let project = crate::ProjectJson {
        version: 1,
        schema,
        programs: vec![ordinary],
        effects: vec![],
        auth: crate::Auth::default(),
    };
    let generation = crate::Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    assert_eq!(
        runtime
            .execute(
                "ordinary",
                Context::query(Actor::user("alice").unwrap(), BTreeMap::new())
            )
            .unwrap()
            .result,
        Value::Int(7)
    );
}

#[test]
fn maintained_enum_addresses_price_canonical_escaping() {
    let mut schema = maintained_boundary_schema();
    let variant = "\u{7}".repeat(64);
    for table in ["memberships", "membershipCounts"] {
        schema.tables.get_mut(table).unwrap().columns.insert(
            "principal".into(),
            ColumnType::Enum {
                variants: vec![variant.clone()],
            },
        );
    }
    let generation = crate::Generation::certify(
        &crate::ProjectJson {
            version: 1,
            schema: schema.clone(),
            programs: vec![],
            effects: vec![],
            auth: crate::Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = crate::Runtime::open(Store::memory().unwrap(), generation).unwrap();
    runtime
        .seed(&[(
            "memberships".into(),
            crate::object([
                ("id", Value::Id("e1".into())),
                ("principal", Value::String(variant)),
            ]),
        )])
        .unwrap();
    let row = &runtime.engine.rows("membershipCounts").unwrap()[0];
    assert!(
        canonical_json(row.field("id").unwrap()).len() as u64
            <= crate::bounds::declared_identity_max(&schema, "membershipCounts")
    );
    assert!(
        canonical_json(row).len() as u64
            <= crate::bounds::declared_serialized_row_max(&schema, "membershipCounts")
    );
}
