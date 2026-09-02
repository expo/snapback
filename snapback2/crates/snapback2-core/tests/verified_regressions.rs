use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};
use std::sync::mpsc;
use std::time::Duration;

fn id(value: &str) -> Value {
    Value::Id(value.to_owned())
}

fn public_table_with(columns: &[(&str, ColumnType)], indexes: &[(&str, &[&str])]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(name, kind)| ((*name).to_owned(), kind.clone()))
            .collect(),
        indexes
            .iter()
            .map(|(name, columns)| {
                (
                    (*name).to_owned(),
                    Index {
                        columns: columns.iter().map(|column| (*column).to_owned()).collect(),
                        unique: false,
                    },
                )
            })
            .collect(),
    )
}

fn schema(tables: impl IntoIterator<Item = (&'static str, Table)>) -> Schema {
    Schema {
        tables: tables
            .into_iter()
            .map(|(name, table)| (name.to_owned(), table))
            .collect(),
        ..Schema::default()
    }
}

fn mutation(name: &str, args: BTreeMap<String, ArgType>, body: Vec<Stmt>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args,
        read_time_granularity_ms: None,
        body,
    }
}

fn generation(schema: Schema, programs: Vec<Program>, ceilings: Ceilings) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: schema.auth.clone(),
            schema,
            programs,
            effects: Vec::new(),
        },
        ceilings,
    )
    .unwrap()
}

fn query_get(name: &str, table: &str, index: &str, arg: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(arg.to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: name.to_owned(),
            table: table.to_owned(),
            index: index.to_owned(),
            key: vec![var(arg)],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn user_mutation(args: BTreeMap<String, Value>) -> Context {
    Context::mutation(Actor::user("u1").unwrap(), args)
}

fn user_query(name: &str, value: Value) -> Context {
    Context::query(
        Actor::user("u1").unwrap(),
        BTreeMap::from([(name.to_owned(), value)]),
    )
}

#[test]
fn cap_checks_updates_into_full_multi_column_groups_but_allows_same_group_updates() {
    let mut cards = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("boardId", ColumnType::Id),
            ("laneId", ColumnType::Id),
            ("label", ColumnType::Text { max: 32 }),
        ],
        &[
            ("byId", &["id"]),
            ("byBoardLane", &["boardId", "laneId", "id"]),
        ],
    );
    cards.constraints.push(Constraint::Cap {
        by: vec!["boardId".to_owned(), "laneId".to_owned()],
        max: 2,
    });
    let schema = schema([("cards", cards)]);
    let move_card = mutation(
        "cards.move",
        BTreeMap::new(),
        vec![Stmt::Update {
            table: "cards".to_owned(),
            key: Expr::Literal(id("a")),
            patch: Expr::Literal(object([
                ("boardId", id("board-b")),
                ("laneId", id("lane-1")),
            ])),
        }],
    );
    let relabel = mutation(
        "cards.relabel",
        BTreeMap::new(),
        vec![Stmt::Update {
            table: "cards".to_owned(),
            key: Expr::Literal(id("b1")),
            patch: Expr::Literal(object([("label", Value::String("changed".to_owned()))])),
        }],
    );
    let get = query_get("cards.get", "cards", "byId", "id");
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, vec![move_card, relabel, get], Ceilings::default()),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "cards".to_owned(),
                object([
                    ("id", id("a")),
                    ("boardId", id("board-a")),
                    ("laneId", id("lane-1")),
                    ("label", Value::String("a".to_owned())),
                ]),
            ),
            (
                "cards".to_owned(),
                object([
                    ("id", id("b1")),
                    ("boardId", id("board-b")),
                    ("laneId", id("lane-1")),
                    ("label", Value::String("b1".to_owned())),
                ]),
            ),
            (
                "cards".to_owned(),
                object([
                    ("id", id("b2")),
                    ("boardId", id("board-b")),
                    ("laneId", id("lane-1")),
                    ("label", Value::String("b2".to_owned())),
                ]),
            ),
        ])
        .unwrap();

    let moved = runtime
        .execute("cards.move", user_mutation(BTreeMap::new()))
        .unwrap();
    assert!(matches!(moved.state, ExecutionState::Rejected { .. }));
    let row_a = runtime
        .execute("cards.get", user_query("id", id("a")))
        .unwrap()
        .result;
    assert_eq!(row_a.field("boardId").unwrap(), &id("board-a"));

    let relabeled = runtime
        .execute("cards.relabel", user_mutation(BTreeMap::new()))
        .unwrap();
    assert!(matches!(relabeled.state, ExecutionState::Committed { .. }));
}

#[test]
fn write_identity_is_certified_and_runtime_rejections_leave_primary_and_secondary_indexes_intact() {
    let items = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("label", ColumnType::Text { max: 32 }),
        ],
        &[("byId", &["id"]), ("byLabel", &["label"])],
    );
    let schema = schema([("items", items)]);
    let explicit_id_patch = mutation(
        "items.badStaticUpdate",
        BTreeMap::new(),
        vec![Stmt::Update {
            table: "items".to_owned(),
            key: Expr::Literal(id("a")),
            patch: Expr::Object(BTreeMap::from([("id".to_owned(), Expr::Literal(id("b")))])),
        }],
    );
    let error = Checker::new(&schema, Ceilings::default())
        .check(&explicit_id_patch)
        .unwrap_err();
    assert_eq!(error.code, "E_SCHEMA_ID_RESERVED");

    let dynamic_update = mutation(
        "items.dynamicUpdate",
        BTreeMap::from([("patch".to_owned(), ArgType::Json { max_bytes: 1024 })]),
        vec![Stmt::Update {
            table: "items".to_owned(),
            key: Expr::Literal(id("a")),
            patch: var("patch"),
        }],
    );
    let dynamic_upsert = mutation(
        "items.dynamicUpsert",
        BTreeMap::from([
            ("key".to_owned(), ArgType::Id),
            ("row".to_owned(), ArgType::Json { max_bytes: 1024 }),
        ]),
        vec![Stmt::Upsert {
            table: "items".to_owned(),
            key: var("key"),
            row: var("row"),
        }],
    );
    let by_id = query_get("items.byId", "items", "byId", "id");
    let by_label = Program {
        name: "items.byLabel".to_owned(),
        args: BTreeMap::from([("label".to_owned(), ArgType::Text { max: 32 })]),
        ..query_get("items.byLabel", "items", "byLabel", "label")
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            schema,
            vec![dynamic_update, dynamic_upsert, by_id, by_label],
            Ceilings::default(),
        ),
    )
    .unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([("id", id("a")), ("label", Value::String("old".to_owned()))]),
        )])
        .unwrap();

    for (operation, args) in [
        (
            "items.dynamicUpdate",
            BTreeMap::from([(
                "patch".to_owned(),
                object([("id", id("b")), ("label", Value::String("new".to_owned()))]),
            )]),
        ),
        (
            "items.dynamicUpsert",
            BTreeMap::from([
                ("key".to_owned(), id("a")),
                (
                    "row".to_owned(),
                    object([("id", id("b")), ("label", Value::String("new".to_owned()))]),
                ),
            ]),
        ),
        (
            "items.dynamicUpsert",
            BTreeMap::from([
                ("key".to_owned(), id("c")),
                (
                    "row".to_owned(),
                    object([
                        ("id", id("d")),
                        ("label", Value::String("inserted".to_owned())),
                    ]),
                ),
            ]),
        ),
    ] {
        let execution = runtime.execute(operation, user_mutation(args)).unwrap();
        assert!(matches!(execution.state, ExecutionState::Rejected { .. }));
    }

    let old = runtime
        .execute("items.byId", user_query("id", id("a")))
        .unwrap();
    assert_eq!(
        old.result.field("label").unwrap(),
        &Value::String("old".to_owned())
    );
    for missing in ["b", "c", "d"] {
        assert_eq!(
            runtime
                .execute("items.byId", user_query("id", id(missing)))
                .unwrap()
                .result,
            Value::Null
        );
    }
    assert_eq!(
        runtime
            .execute(
                "items.byLabel",
                user_query("label", Value::String("new".to_owned())),
            )
            .unwrap()
            .result,
        Value::Null
    );
}

fn aggregate_fixture() -> (Schema, Maintain) {
    let cards = public_table_with(
        &[("id", ColumnType::Id), ("group", ColumnType::Id)],
        &[("byId", &["id"])],
    );
    let comments = cards.clone();
    let counts = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    let schema = schema([("cards", cards), ("comments", comments), ("counts", counts)]);
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "cards".to_owned(),
        by: vec!["group".to_owned()],
        target: "counts".to_owned(),
        readable: None,
    };
    (schema, maintain)
}

fn aggregate_value(runtime: &mut Runtime, group: &str) -> Value {
    runtime
        .execute("counts.get", user_query("group", id(group)))
        .unwrap()
        .result
}

#[test]
fn successor_removes_stale_maintains_and_combines_shared_target_sources() {
    let (mut base_schema, cards_maintain) = aggregate_fixture();
    base_schema.maintains = vec![cards_maintain.clone()];
    let get = query_get("counts.get", "counts", "byGroup", "group");
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(base_schema.clone(), vec![get.clone()], Ceilings::default()),
    )
    .unwrap();
    let mut rows = Vec::new();
    for (table, prefix, count) in [("cards", "card", 2), ("comments", "comment", 3)] {
        for offset in 0..count {
            rows.push((
                table.to_owned(),
                object([
                    ("id", id(&format!("{prefix}-{offset}"))),
                    ("group", id("g")),
                ]),
            ));
        }
    }
    runtime.seed(&rows).unwrap();
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(2))
    );

    let comments_maintain = Maintain {
        source: "comments".to_owned(),
        ..cards_maintain.clone()
    };
    let mut shared_schema = base_schema.clone();
    shared_schema.maintains.push(comments_maintain);
    runtime
        .apply_successor(generation(
            shared_schema.clone(),
            vec![get.clone()],
            Ceilings::default(),
        ))
        .unwrap();
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(5))
    );

    let mut destructive_runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            shared_schema.clone(),
            vec![get.clone()],
            Ceilings::default(),
        ),
    )
    .unwrap();
    destructive_runtime.seed(&rows).unwrap();
    let mut without_target = shared_schema;
    without_target.maintains.clear();
    without_target.tables.remove("counts");
    let destructive_successor = generation(without_target, Vec::new(), Ceilings::default());
    let refusal = destructive_runtime
        .apply_successor(destructive_successor.clone())
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    destructive_runtime
        .apply_migration(destructive_successor, &refusal.plan)
        .unwrap();
    assert!(
        destructive_runtime
            .generation()
            .schema()
            .table("counts")
            .is_none()
    );

    let mut removed_schema = base_schema;
    removed_schema.maintains.clear();
    runtime
        .apply_successor(generation(removed_schema, vec![get], Ceilings::default()))
        .unwrap();
    assert_eq!(aggregate_value(&mut runtime, "g"), Value::Null);
}

#[test]
fn successor_maintain_rebuild_preserves_rows_outside_projected_ids() {
    let (mut base_schema, cards_maintain) = aggregate_fixture();
    base_schema.maintains = vec![cards_maintain.clone()];
    base_schema
        .tables
        .get_mut("counts")
        .unwrap()
        .indexes
        .insert(
            "byId".to_owned(),
            Index {
                columns: vec!["id".to_owned()],
                unique: false,
            },
        );
    let get_by_group = query_get("counts.get", "counts", "byGroup", "group");
    let get_by_id = query_get("counts.byId", "counts", "byId", "id");
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            base_schema.clone(),
            vec![get_by_group.clone(), get_by_id.clone()],
            Ceilings::default(),
        ),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "cards".to_owned(),
                object([("id", id("card-1")), ("group", id("g"))]),
            ),
            (
                "comments".to_owned(),
                object([("id", id("comment-1")), ("group", id("g"))]),
            ),
            (
                "counts".to_owned(),
                object([
                    ("id", id("baseline")),
                    ("group", id("baseline")),
                    ("value", Value::Int(99)),
                ]),
            ),
        ])
        .unwrap();

    let mut next_schema = base_schema;
    next_schema.maintains.push(Maintain {
        source: "comments".to_owned(),
        ..cards_maintain
    });
    runtime
        .apply_successor(generation(
            next_schema,
            vec![get_by_group, get_by_id],
            Ceilings::default(),
        ))
        .unwrap();

    let baseline = runtime
        .execute("counts.byId", user_query("id", id("baseline")))
        .unwrap()
        .result;
    assert_eq!(baseline.field("value"), Ok(&Value::Int(99)));
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(2))
    );
}

#[test]
fn successor_maintain_diff_respects_duplicate_multiplicity() {
    let (mut base_schema, cards_maintain) = aggregate_fixture();
    base_schema.maintains = vec![cards_maintain.clone(), cards_maintain.clone()];
    let get = query_get("counts.get", "counts", "byGroup", "group");
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(base_schema.clone(), vec![get.clone()], Ceilings::default()),
    )
    .unwrap();
    runtime
        .seed(&[(
            "cards".to_owned(),
            object([("id", id("card-1")), ("group", id("g"))]),
        )])
        .unwrap();
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(2))
    );

    let mut next_schema = base_schema;
    next_schema.maintains = vec![cards_maintain];
    let report = runtime
        .apply_successor(generation(next_schema, vec![get], Ceilings::default()))
        .unwrap();
    assert_eq!(report.backfilled_maintains, 1);
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(1))
    );

    runtime
        .seed(&[(
            "cards".to_owned(),
            object([("id", id("card-2")), ("group", id("g"))]),
        )])
        .unwrap();
    assert_eq!(
        aggregate_value(&mut runtime, "g").field("value"),
        Ok(&Value::Int(2))
    );
}

#[test]
fn maintained_update_writes_are_charged_twice_and_exact_ceiling_matches_runtime() {
    let source = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let counts = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    let mut schema = schema([("source", source), ("counts", counts)]);
    schema.maintains.push(Maintain {
        kind: MaintainKind::Count,
        source: "source".to_owned(),
        by: vec!["group".to_owned()],
        target: "counts".to_owned(),
        readable: None,
    });
    let update = mutation(
        "source.updateAll",
        BTreeMap::from([(
            "ids".to_owned(),
            ArgType::List {
                of: Some(Box::new(ArgType::Id)),
                max: 1024,
            },
        )]),
        vec![Stmt::For {
            binding: "sourceId".to_owned(),
            domain: LoopDomain::ArgList {
                name: "ids".to_owned(),
                max: 1024,
            },
            body: vec![Stmt::Update {
                table: "source".to_owned(),
                key: var("sourceId"),
                patch: Expr::Literal(object([("value", Value::Int(1))])),
            }],
        }],
    );
    let default_error = Checker::new(&schema, Ceilings::default())
        .check(&update)
        .unwrap_err();
    assert_eq!(default_error.code, "E_BOUND");
    assert!(default_error.message.contains("3072"));

    let ceilings = Ceilings {
        write_rows: 3072,
        ..Ceilings::default()
    };
    let certificate = Checker::new(&schema, ceilings.clone())
        .check(&update)
        .unwrap();
    assert_eq!(certificate.maintained_amplification, 2048);
    assert_eq!(certificate.maintained_writes.get("counts"), Some(&2048));
    let mut engine = Engine::memory(schema).unwrap();
    let mut rows = Vec::new();
    let mut ids = Vec::new();
    for offset in 0..1024 {
        let row_id = format!("row-{offset:04}");
        ids.push(id(&row_id));
        engine
            .seed(
                "source",
                object([
                    ("id", id(&row_id)),
                    ("group", id("g")),
                    ("value", Value::Int(0)),
                ]),
            )
            .unwrap();
    }
    rows.push(("ids".to_owned(), Value::Array(ids)));
    let execution = engine
        .execute(
            &update,
            &certificate,
            user_mutation(rows.into_iter().collect()),
        )
        .unwrap();
    assert_eq!(execution.trace.writes.get("source"), Some(&1024));
    assert_eq!(execution.trace.writes.get("counts"), Some(&2048));
}

fn width_schema(width: usize) -> Schema {
    let mut columns = BTreeMap::from([("id".to_owned(), ColumnType::Id)]);
    let mut index_columns = Vec::new();
    for offset in 0..width {
        let name = format!("c{offset}");
        columns.insert(name.clone(), ColumnType::Int);
        index_columns.push(name);
    }
    schema([(
        "rows",
        public_table(
            columns,
            BTreeMap::from([(
                "wide".to_owned(),
                Index {
                    columns: index_columns,
                    unique: false,
                },
            )]),
        ),
    )])
}

#[test]
fn schema_admission_accepts_eight_index_columns_and_rejects_zero_or_nine() {
    assert!(validate_schema(&width_schema(8)).is_ok());
    for width in [0, 9] {
        let errors = validate_schema(&width_schema(width)).unwrap_err();
        assert!(errors.iter().any(|error| error.code() == "E_SCHEMA"));
        let project = ProjectJson {
            version: 1,
            schema: width_schema(width),
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        };
        let errors = Generation::certify(&project, Ceilings::default()).unwrap_err();
        assert!(
            errors
                .iter()
                .any(|(_, error)| error.code == "E_SCHEMA_INDEX_COLUMN")
        );
    }
}

#[test]
fn huge_recurse_depth_is_refused_within_a_short_deadline() {
    let nodes = public_table_with(
        &[
            ("id", ColumnType::Id),
            ("parentId", ColumnType::Optional(Box::new(ColumnType::Id))),
        ],
        &[("byId", &["id"])],
    );
    let schema = schema([("nodes", nodes)]);
    let program = Program {
        name: "nodes.ancestors".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::For {
            binding: "node".to_owned(),
            domain: LoopDomain::Recurse(Recurse {
                site: "nodes.ancestors.0".to_owned(),
                table: "nodes".to_owned(),
                index: "byId".to_owned(),
                seed: Box::new(Expr::Literal(id("root"))),
                next_field: "parentId".to_owned(),
                depth: u32::MAX,
                fanout: 1,
                provenance: KeyProvenance::Const,
            }),
            body: Vec::new(),
        }],
    };
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let result = Checker::new(&schema, Ceilings::default()).check(&program);
        let _ = send.send(result);
    });
    let result = receive
        .recv_timeout(Duration::from_millis(250))
        .expect("huge recurse depth hung certification");
    assert_eq!(result.unwrap_err().code, "E_UNBOUND_LOOP");
}

#[test]
fn malformed_builtin_arities_are_refused_before_execution() {
    for (builtin, args) in [
        (
            Builtin::Slice,
            vec![Expr::Literal(Value::Array(Vec::new()))],
        ),
        (
            Builtin::Max,
            vec![
                Expr::Literal(Value::Int(1)),
                Expr::Literal(Value::Int(2)),
                Expr::Input(Input::NewId),
            ],
        ),
    ] {
        let program = Program {
            name: "invalid.arity".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Return(Expr::Builtin { builtin, args })],
        };
        let error = Checker::new(&Schema::default(), Ceilings::default())
            .check(&program)
            .unwrap_err();
        assert_eq!(error.code, "E_OPAQUE");
        assert!(error.message.contains("requires"));
    }
}

#[test]
fn nested_out_of_i53_literals_are_refused_by_certification() {
    let program = Program {
        name: "invalid.literal".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Array(vec![Value::Row(
            BTreeMap::from([("unsafe".to_owned(), Value::Int(I53_MAX + 1))]),
        )])))],
    };
    let error = Checker::new(&Schema::default(), Ceilings::default())
        .check(&program)
        .unwrap_err();
    assert_eq!(error.code, "E_OPAQUE");
    assert!(error.message.contains("i53"));
}

fn execute_pure(expression: Expr) -> Result<Execution, RuntimeError> {
    let schema = Schema::default();
    let program = Program {
        name: "regression.pure".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(expression)],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    Engine::memory(schema)?.execute(
        &program,
        &certificate,
        Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
    )
}

#[test]
fn duplicate_deterministic_share_rejects_atomically_and_unique_shares_conserve_amount() {
    let schema = spike_schema();
    let program = add_expense_program();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    let mut duplicate = user_mutation(BTreeMap::from([
        ("groupId".to_owned(), id("g1")),
        ("amount".to_owned(), Value::Int(1)),
        (
            "recipients".to_owned(),
            Value::Array(vec![id("u1"), id("u1")]),
        ),
    ]));
    duplicate.new_ids = VecDeque::from([
        "expense-duplicate".to_owned(),
        "share-duplicate-1".to_owned(),
        "share-duplicate-2".to_owned(),
    ]);
    assert!(matches!(
        engine.execute(&program, &certificate, duplicate),
        Err(RuntimeError::Input(message)) if message.contains("unique")
    ));
    assert!(engine.rows("expenses").unwrap().is_empty());
    assert!(engine.rows("shares").unwrap().is_empty());

    let mut unique = user_mutation(BTreeMap::from([
        ("groupId".to_owned(), id("g1")),
        ("amount".to_owned(), Value::Int(1)),
        (
            "recipients".to_owned(),
            Value::Array(vec![id("u1"), id("u2")]),
        ),
    ]));
    unique.new_ids = VecDeque::from([
        "expense-unique".to_owned(),
        "share-unique-1".to_owned(),
        "share-unique-2".to_owned(),
    ]);
    engine
        .execute(&program, &certificate, unique)
        .expect("unique recipients commit");
    let allocated: i64 = engine
        .rows("shares")
        .unwrap()
        .iter()
        .map(|row| row.field("amount").unwrap().as_int().unwrap())
        .sum();
    assert_eq!(allocated, 1);
}

#[test]
fn id_concat_uses_an_injective_tuple_encoding() {
    let execution = execute_pure(Expr::Array(vec![
        Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![Expr::Literal(id("a:b")), Expr::Literal(id("c"))],
        },
        Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![Expr::Literal(id("a")), Expr::Literal(id("b:c"))],
        },
    ]))
    .unwrap();
    let values = execution.result.as_array().unwrap();
    assert_ne!(values[0], values[1]);
    assert_eq!(values[0], id("[{\"Id\":\"a:b\"},{\"Id\":\"c\"}]"));
    assert_eq!(values[1], id("[{\"Id\":\"a\"},{\"Id\":\"b:c\"}]"));
}

#[test]
fn mention_tokens_uses_the_explicit_unicode_whitespace_set() {
    let execution = execute_pure(Expr::Builtin {
        builtin: Builtin::MentionTokens,
        args: vec![Expr::Literal(Value::String(
            "@a\u{0085}@b\u{00a0}@c\u{2028}@d\u{2029}@e\t@f".to_owned(),
        ))],
    })
    .unwrap();
    assert_eq!(
        execution.result,
        Value::Array(
            ["a", "b", "c", "d", "e", "f"]
                .into_iter()
                .map(|value| Value::String(value.to_owned()))
                .collect()
        )
    );
}

#[test]
fn sort_refuses_a_missing_key_instead_of_treating_the_comparison_as_equal() {
    let error = execute_pure(Expr::Builtin {
        builtin: Builtin::Sort {
            keys: vec![SortKey {
                field: "key".to_owned(),
                order: Order::Asc,
            }],
        },
        args: vec![Expr::Literal(Value::Array(vec![
            object([("other", Value::Int(1))]),
            object([("key", Value::Int(0))]),
        ]))],
    })
    .unwrap_err();
    assert!(matches!(
        error,
        RuntimeError::Value(ValueError::MissingField(field)) if field == "key"
    ));
}
