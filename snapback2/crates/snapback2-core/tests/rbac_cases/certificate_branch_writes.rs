//! Branch-write and receipt-authority containment regressions.
use snapback2_core::engine::{ClosureReceipt, RowRecord};
use snapback2_core::*;
use std::collections::BTreeMap;

fn public_rules() -> Rules {
    let public = RuleExpr::Public {
        reason: "branch-write containment fixture".to_owned(),
    };
    Rules {
        read: public.clone(),
        insert: public.clone(),
        update: public.clone(),
        delete: public,
    }
}

fn by_id() -> BTreeMap<String, Index> {
    BTreeMap::from([(
        "byId".to_owned(),
        Index {
            components: (vec!["id".to_owned()])
                .into_iter()
                .map(snapback2_core::search_key::IndexComponent::Column)
                .collect(),
            unique: true,
        },
    )])
}

fn schema() -> Schema {
    let events = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
            ("label".to_owned(), ColumnType::Text { max: 32 }),
        ]),
        indexes: by_id(),
        rules: public_rules(),
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let counts = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("bucket".to_owned(), ColumnType::Id),
            ("value".to_owned(), ColumnType::Int),
        ]),
        indexes: by_id(),
        rules: public_rules(),
        constraints: Vec::new(),
        retain: Default::default(),
    };
    Schema {
        schedules: Vec::new(),
        tables: BTreeMap::from([("counts".to_owned(), counts), ("events".to_owned(), events)]),
        maintains: vec![Maintain {
            kind: MaintainKind::Count,
            source: "events".to_owned(),
            by: vec!["bucket".to_owned()],
            target: "counts".to_owned(),
            readable: None,
        }],
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn update(id_value: &str, label: &str) -> Stmt {
    Stmt::Update {
        table: "events".to_owned(),
        key: Expr::Literal(Value::Id(id_value.to_owned())),
        patch: Expr::Object(BTreeMap::from([(
            "label".to_owned(),
            Expr::Literal(Value::String(label.to_owned())),
        )])),
    }
}

fn program() -> Program {
    Program {
        name: "events.updateChosenArm".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::If {
            condition: Expr::Literal(Value::Bool(false)),
            then_body: Vec::new(),
            else_body: vec![update("event-1", "after-1"), update("event-2", "after-2")],
        }],
    }
}

#[test]
fn branch_sums_sequential_writes_before_taking_the_arm_maximum() {
    let schema = schema();
    let program = program();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();

    assert_eq!(
        certificate.write_sites,
        vec![WriteSite {
            table: "events".to_owned(),
            kind: WriteKind::Update,
            max_rows: 2,
        }]
    );
    assert_eq!(certificate.maintained_amplification, 4);

    let mut ceilings = Ceilings::default();
    ceilings.write_rows = 5;
    let refusal = Checker::new(&schema, ceilings).check(&program).unwrap_err();
    assert_eq!(refusal.code, "E_BOUND");
    assert!(
        refusal
            .message
            .contains("write amplification 6 exceeds ceiling 5")
    );
}

#[test]
fn branch_certificate_contains_the_executed_physical_writes() {
    let schema = schema();
    let program = program();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    for (id_value, label) in [("event-1", "before-1"), ("event-2", "before-2")] {
        engine
            .seed(
                "events",
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id(id_value.to_owned())),
                        ("bucket".to_owned(), Value::Id("bucket-1".to_owned())),
                        ("label".to_owned(), Value::String(label.to_owned())),
                    ])
                    .into(),
                ),
            )
            .unwrap();
    }

    let execution = engine
        .execute(
            &program,
            &certificate,
            Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();

    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    assert_eq!(execution.trace.writes.get("events"), Some(&2));
    assert_eq!(
        execution.trace.writes.get("counts"),
        None,
        "same-group source edits reserve maintained work but do not change the sparse target"
    );
}

fn insert_and_read_aggregate(aggregate_id: &str) -> Program {
    Program {
        name: "events.insertAndReadAggregate".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Literal(Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("event-new".to_owned())),
                        ("bucket".to_owned(), Value::Id("bucket-new".to_owned())),
                        ("label".to_owned(), Value::String("new".to_owned())),
                    ])
                    .into(),
                )),
            },
            Stmt::Return(Expr::Get(Read {
                site: "events.aggregate".to_owned(),
                table: "counts".to_owned(),
                index: "byId".to_owned(),
                key: vec![Expr::Literal(Value::Id(aggregate_id.to_owned()))],
                provenance: KeyProvenance::Const,
            })),
        ],
    }
}

#[test]
fn receipt_authority_gates_the_local_aggregate_predecessor() {
    let schema = schema();
    let aggregate_id = canonical_json(&vec![Value::Id("bucket-new".to_owned())]);
    let program = insert_and_read_aggregate(&aggregate_id);
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let context = || Context::mutation(Actor::user("u1").unwrap(), BTreeMap::new());

    let mut missing = ClientStore::hydrate(schema.clone(), &ClosureReceipt::default()).unwrap();
    let (state, execution) = missing
        .apply_mutation(&program, &certificate, context())
        .unwrap();
    assert_eq!(
        state,
        LocalState::Partial(vec!["missing-authority".to_owned()])
    );
    assert_eq!(execution.result, Value::Null);
    assert!(missing.rows("events").unwrap().is_empty());
    assert!(missing.rows("counts").unwrap().is_empty());

    let absent = ClosureReceipt {
        schema_hash: Some(schema.hash()),
        absences: vec![(
            "counts".to_owned(),
            "byId".to_owned(),
            vec![Value::Id(aggregate_id.clone())],
        )],
        ..ClosureReceipt::default()
    };
    let mut starts_at_zero = ClientStore::hydrate(schema.clone(), &absent).unwrap();
    let (state, execution) = starts_at_zero
        .apply_mutation(&program, &certificate, context())
        .unwrap();
    assert_eq!(state, LocalState::Predicted);
    assert_eq!(execution.result.field("value"), Ok(&Value::Int(1)));

    let held = ClosureReceipt {
        rows: vec![RowRecord {
            table: "counts".to_owned(),
            id: aggregate_id.clone(),
            row: Value::Row(
                BTreeMap::from([
                    ("id".to_owned(), Value::Id(aggregate_id)),
                    ("bucket".to_owned(), Value::Id("bucket-new".to_owned())),
                    ("value".to_owned(), Value::Int(5)),
                ])
                .into(),
            ),
        }],
        ..ClosureReceipt::default()
    };
    let mut starts_from_held = ClientStore::hydrate(schema, &held).unwrap();
    let (state, execution) = starts_from_held
        .apply_mutation(&program, &certificate, context())
        .unwrap();
    assert_eq!(state, LocalState::Predicted);
    assert_eq!(execution.result.field("value"), Ok(&Value::Int(6)));
}
