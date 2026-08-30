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
            .execute("items.create", Context::mutation("u1", args))
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
            .execute(op, Context::query("u1", query_arg(name, value)))
            .unwrap();
        assert_eq!(
            execution.result.field("id").unwrap().as_str().unwrap(),
            expected
        );
    }

    let enum_scan = runtime
        .execute(
            "items.scanKind",
            Context::query("u1", query_arg("kind", Value::String("dm".to_owned()))),
        )
        .unwrap();
    assert_eq!(result_ids(&enum_scan), vec!["i1", "i2"]);
    let decimal_scan = runtime
        .execute(
            "items.scanAmount",
            Context::query("u1", query_arg("amount", Value::Int(124))),
        )
        .unwrap();
    assert_eq!(result_ids(&decimal_scan), vec!["i2"]);
    let money_scan = runtime
        .execute(
            "items.scanPrice",
            Context::query("u1", query_arg("price", Value::Int(501))),
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
            Context::mutation("u1", create_args("bad", "broadcast", 100, 100)),
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
