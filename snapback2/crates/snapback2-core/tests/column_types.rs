use snapback2_core::*;
use std::collections::BTreeMap;

fn typed_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    (
                        "kind".to_owned(),
                        ColumnType::Enum {
                            variants: vec!["dm".to_owned(), "group".to_owned()],
                        },
                    ),
                    ("amount".to_owned(), ColumnType::Decimal { scale: 2 }),
                    (
                        "price".to_owned(),
                        ColumnType::Money {
                            currency: "USD".to_owned(),
                            scale: 2,
                        },
                    ),
                ]),
                BTreeMap::from([
                    (
                        "byKind".to_owned(),
                        Index {
                            columns: vec!["kind".to_owned()],
                            unique: false,
                        },
                    ),
                    (
                        "byAmount".to_owned(),
                        Index {
                            columns: vec!["amount".to_owned()],
                            unique: false,
                        },
                    ),
                    (
                        "byPrice".to_owned(),
                        Index {
                            columns: vec!["price".to_owned()],
                            unique: false,
                        },
                    ),
                ]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn create_program() -> Program {
    Program {
        name: "items.create".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("id".to_owned(), ArgType::Scalar),
            (
                "kind".to_owned(),
                ArgType::Enum {
                    variants: vec!["dm".to_owned(), "group".to_owned()],
                },
            ),
            ("amount".to_owned(), ArgType::Decimal { scale: 2 }),
            (
                "price".to_owned(),
                ArgType::Money {
                    currency: "USD".to_owned(),
                    scale: 2,
                },
            ),
        ]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("kind".to_owned(), var("kind")),
                    ("amount".to_owned(), var("amount")),
                    ("price".to_owned(), var("price")),
                ])),
            },
            Stmt::Return(var("id")),
        ],
    }
}

fn get_program(name: &str, index: &str, arg: &str, kind: ArgType) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(arg.to_owned(), kind)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: name.to_owned(),
            table: "items".to_owned(),
            index: index.to_owned(),
            key: vec![var(arg)],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn scan_program(name: &str, index: &str, arg: &str, kind: ArgType) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(arg.to_owned(), kind)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: name.to_owned(),
            table: "items".to_owned(),
            index: index.to_owned(),
            prefix: Vec::new(),
            order: Order::Asc,
            take: Bound::Literal(10),
            after: None,
            before: None,
            range: Some(Range {
                gt: None,
                gte: Some(Box::new(var(arg))),
                lt: None,
                lte: None,
            }),
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn generation() -> Generation {
    let enum_arg = ArgType::Enum {
        variants: vec!["dm".to_owned(), "group".to_owned()],
    };
    let decimal_arg = ArgType::Decimal { scale: 2 };
    let money_arg = ArgType::Money {
        currency: "USD".to_owned(),
        scale: 2,
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: typed_schema(),
            programs: vec![
                create_program(),
                get_program("items.getKind", "byKind", "kind", enum_arg.clone()),
                get_program("items.getAmount", "byAmount", "amount", decimal_arg.clone()),
                get_program("items.getPrice", "byPrice", "price", money_arg.clone()),
                scan_program("items.scanKind", "byKind", "kind", enum_arg),
                scan_program("items.scanAmount", "byAmount", "amount", decimal_arg),
                scan_program("items.scanPrice", "byPrice", "price", money_arg),
            ],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn create_args(id: &str, kind: &str, amount: i64, price: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("id".to_owned(), Value::Id(id.to_owned())),
        ("kind".to_owned(), Value::String(kind.to_owned())),
        ("amount".to_owned(), Value::Int(amount)),
        ("price".to_owned(), Value::Int(price)),
    ])
}

fn query_arg(name: &str, value: Value) -> BTreeMap<String, Value> {
    BTreeMap::from([(name.to_owned(), value)])
}

fn result_ids(execution: &Execution) -> Vec<String> {
    execution
        .result
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn enum_decimal_and_money_serde_spellings_are_exact() {
    assert_eq!(
        serde_json::to_value(ColumnType::Enum {
            variants: vec!["dm".to_owned(), "group".to_owned()]
        })
        .unwrap(),
        serde_json::json!({ "Enum": { "variants": ["dm", "group"] } })
    );
    assert_eq!(
        serde_json::to_value(ColumnType::Decimal { scale: 2 }).unwrap(),
        serde_json::json!({ "Decimal": { "scale": 2 } })
    );
    assert_eq!(
        serde_json::to_value(ColumnType::Money {
            currency: "USD".to_owned(),
            scale: 2
        })
        .unwrap(),
        serde_json::json!({ "Money": { "currency": "USD", "scale": 2 } })
    );
}

#[test]
fn enum_decimal_and_money_write_read_index_and_scan() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation()).unwrap();
    for args in [
        create_args("i1", "dm", 123, 500),
        create_args("i2", "group", 456, 900),
    ] {
        let execution = runtime
            .execute(
                "items.create",
                Context::mutation(Actor::user("u1").unwrap(), args),
            )
            .unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    }

    for (op, name, value, expected) in [
        (
            "items.getKind",
            "kind",
            Value::String("dm".to_owned()),
            "i1",
        ),
        ("items.getAmount", "amount", Value::Int(456), "i2"),
        ("items.getPrice", "price", Value::Int(500), "i1"),
    ] {
        let execution = runtime
            .execute(
                op,
                Context::query(Actor::user("u1").unwrap(), query_arg(name, value)),
            )
            .unwrap();
        assert_eq!(
            execution.result.field("id").unwrap().as_str().unwrap(),
            expected
        );
    }

    let enum_scan = runtime
        .execute(
            "items.scanKind",
            Context::query(
                Actor::user("u1").unwrap(),
                query_arg("kind", Value::String("dm".to_owned())),
            ),
        )
        .unwrap();
    assert_eq!(result_ids(&enum_scan), vec!["i1", "i2"]);
    let decimal_scan = runtime
        .execute(
            "items.scanAmount",
            Context::query(
                Actor::user("u1").unwrap(),
                query_arg("amount", Value::Int(124)),
            ),
        )
        .unwrap();
    assert_eq!(result_ids(&decimal_scan), vec!["i2"]);
    let money_scan = runtime
        .execute(
            "items.scanPrice",
            Context::query(
                Actor::user("u1").unwrap(),
                query_arg("price", Value::Int(501)),
            ),
        )
        .unwrap();
    assert_eq!(result_ids(&money_scan), vec!["i2"]);
}

#[test]
fn out_of_list_enum_write_is_rejected_as_input() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation()).unwrap();
    let execution = runtime
        .execute(
            "items.create",
            Context::mutation(
                Actor::user("u1").unwrap(),
                create_args("bad", "broadcast", 100, 100),
            ),
        )
        .unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_INPUT"
    ));

    let error = runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("bad-row".to_owned())),
                ("kind", Value::String("broadcast".to_owned())),
                ("amount", Value::Int(100)),
                ("price", Value::Int(100)),
            ]),
        )])
        .unwrap_err();
    assert!(matches!(error, RuntimeError::Input(_)));
}

#[test]
fn principal_schema_and_argument_types_keep_the_id_scalar_wire_encoding() {
    assert_eq!(
        serde_json::to_value(ColumnType::Principal).unwrap(),
        serde_json::json!("Principal")
    );
    assert_eq!(
        serde_json::to_value(ArgType::Principal).unwrap(),
        serde_json::json!("Principal")
    );
    let context = Context::query(Actor::persona("alice").unwrap(), BTreeMap::new());
    let encoded = serde_json::to_value(&context).unwrap();
    assert_eq!(encoded["viewer"], serde_json::json!("dev:alice"));
    assert_eq!(context.viewer(), "dev:alice");

    let schema = Schema {
        tables: BTreeMap::from([(
            "grants".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("principal".to_owned(), ColumnType::Principal),
                ]),
                BTreeMap::from([(
                    "byId".to_owned(),
                    Index {
                        columns: vec!["id".to_owned()],
                        unique: true,
                    },
                )]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let program = Program {
        name: "grants.echoPrincipal".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("target".to_owned(), ArgType::Principal)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(var("target"))],
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![program],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();

    let execution = runtime
        .execute(
            "grants.echoPrincipal",
            Context::query(
                Actor::persona("alice").unwrap(),
                BTreeMap::from([("target".to_owned(), Value::Id("dev:bob".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.result, Value::Id("dev:bob".to_owned()));

    let refusal = runtime
        .execute(
            "grants.echoPrincipal",
            Context::query(
                Actor::persona("alice").unwrap(),
                BTreeMap::from([("target".to_owned(), Value::String("dev:bob".to_owned()))]),
            ),
        )
        .unwrap_err();
    assert!(matches!(refusal, RuntimeError::Input(_)));

    runtime
        .seed(&[(
            "grants".to_owned(),
            object([
                ("id", Value::Id("g1".to_owned())),
                ("principal", Value::Id("dev:bob".to_owned())),
            ]),
        )])
        .unwrap();
    let refusal = runtime
        .seed(&[(
            "grants".to_owned(),
            object([
                ("id", Value::Id("g2".to_owned())),
                ("principal", Value::String("dev:bob".to_owned())),
            ]),
        )])
        .unwrap_err();
    assert!(matches!(refusal, RuntimeError::Input(_)));
}

fn bytes_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "blobs".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("payload".to_owned(), ColumnType::Bytes { max: 4 }),
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
                        "byPayload".to_owned(),
                        Index {
                            columns: vec!["payload".to_owned(), "id".to_owned()],
                            unique: false,
                        },
                    ),
                ]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn bytes_programs() -> Vec<Program> {
    vec![
        Program {
            name: "blobs.create".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                ("payload".to_owned(), ArgType::Bytes { max: 8 }),
            ]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Insert {
                table: "blobs".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("payload".to_owned(), var("payload")),
                ])),
            }],
        },
        Program {
            name: "blobs.update".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                ("payload".to_owned(), ArgType::Bytes { max: 8 }),
            ]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Update {
                table: "blobs".to_owned(),
                key: var("id"),
                patch: Expr::Object(BTreeMap::from([("payload".to_owned(), var("payload"))])),
            }],
        },
        Program {
            name: "blobs.scan".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(Expr::Scan(Scan {
                site: "blobs.scan".to_owned(),
                table: "blobs".to_owned(),
                index: "byPayload".to_owned(),
                prefix: Vec::new(),
                order: Order::Asc,
                take: Bound::Literal(10),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }))],
        },
    ]
}

fn bytes_args(id: &str, payload: &[u8]) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("id".to_owned(), Value::Id(id.to_owned())),
        ("payload".to_owned(), Value::Bytes(payload.to_vec())),
    ])
}

#[test]
fn bytes_json_and_certificate_version_are_exact() {
    let value = Value::Bytes(vec![0x00, 0x7f, 0x80, 0xff]);
    assert_eq!(
        serde_json::to_value(&value).unwrap(),
        serde_json::json!({ "Bytes": "007f80ff" })
    );
    assert_eq!(
        serde_json::from_value::<Value>(serde_json::json!({ "Bytes": "007f80ff" })).unwrap(),
        value
    );
    for invalid in ["0", "00FF", "0g"] {
        assert!(serde_json::from_value::<Value>(serde_json::json!({ "Bytes": invalid })).is_err());
    }
    assert!(
        serde_json::from_value::<Value>(serde_json::json!({ "Bytes": "00ff", "extra": 1 }))
            .is_err()
    );
    assert_eq!(
        serde_json::to_value(ColumnType::Bytes { max: 4 }).unwrap(),
        serde_json::json!({ "Bytes": { "max": 4 } })
    );
    let certificate = Checker::new(&bytes_schema(), Ceilings::default())
        .check(&bytes_programs().pop().unwrap())
        .unwrap();
    assert_eq!(
        certificate.value_model_version,
        CURRENT_VALUE_MODEL_VERSION.as_str()
    );
}

#[test]
fn stale_value_model_certificate_is_refused() {
    let program = bytes_programs().pop().unwrap();
    let mut certificate = Checker::new(&bytes_schema(), Ceilings::default())
        .check(&program)
        .unwrap();
    certificate.value_model_version = "i53-codepoint-v1".to_owned();
    let error = Engine::memory(bytes_schema())
        .unwrap()
        .execute(
            &program,
            &certificate,
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap_err();
    assert!(matches!(
        error,
        RuntimeError::TraceSubset(message) if message.contains("value model version")
    ));
}

#[test]
fn bytes_insert_update_round_trip_bounds_and_unsigned_index_order() {
    let project = ProjectJson {
        version: 1,
        schema: bytes_schema(),
        programs: bytes_programs(),
        effects: Vec::new(),
        auth: Auth::default(),
    };
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    for args in [
        bytes_args("high", &[0xff, 0x00]),
        bytes_args("low", &[0x00, 0xff]),
        bytes_args("prefix", &[0x00]),
    ] {
        let execution = runtime
            .execute(
                "blobs.create",
                Context::mutation(Actor::user("u1").unwrap(), args),
            )
            .unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    }

    let ordered = runtime
        .execute(
            "blobs.scan",
            Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
        )
        .unwrap();
    assert_eq!(result_ids(&ordered), vec!["prefix", "low", "high"]);
    assert_eq!(
        ordered.result.as_array().unwrap()[1]
            .field("payload")
            .unwrap(),
        &Value::Bytes(vec![0x00, 0xff])
    );

    let updated = runtime
        .execute(
            "blobs.update",
            Context::mutation(
                Actor::user("u1").unwrap(),
                bytes_args("high", &[0x01, 0x02]),
            ),
        )
        .unwrap();
    assert!(matches!(updated.state, ExecutionState::Committed { .. }));

    for op in ["blobs.create", "blobs.update"] {
        let refused = runtime
            .execute(
                op,
                Context::mutation(
                    Actor::user("u1").unwrap(),
                    bytes_args("high", &[0, 1, 2, 3, 4]),
                ),
            )
            .unwrap();
        assert!(matches!(
            refused.state,
            ExecutionState::Rejected { ref code, .. } if code == "E_INPUT"
        ));
    }
}
