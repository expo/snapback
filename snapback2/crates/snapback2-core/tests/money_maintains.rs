use snapback2_core::*;
use std::collections::BTreeMap;

fn money() -> ColumnType {
    ColumnType::Money {
        currency: "USD".to_owned(),
        scale: 2,
    }
}

fn table(
    columns: impl IntoIterator<Item = (&'static str, ColumnType)>,
    indexes: impl IntoIterator<Item = (&'static str, Vec<&'static str>, bool)>,
) -> Table {
    public_table(
        columns
            .into_iter()
            .map(|(name, descriptor)| (name.to_owned(), descriptor))
            .collect(),
        indexes
            .into_iter()
            .map(|(name, columns, unique)| {
                (
                    name.to_owned(),
                    Index {
                        columns: columns.into_iter().map(str::to_owned).collect(),
                        unique,
                    },
                )
            })
            .collect(),
    )
}

fn schema(target_value: ColumnType) -> Schema {
    Schema {
        tables: BTreeMap::from([
            (
                "ledger".to_owned(),
                table(
                    [
                        ("id", ColumnType::Id),
                        ("owner", ColumnType::Principal),
                        ("amount", money()),
                    ],
                    [("byId", vec!["id"], true)],
                ),
            ),
            (
                "balances".to_owned(),
                table(
                    [
                        ("id", ColumnType::Id),
                        ("owner", ColumnType::Principal),
                        ("value", target_value),
                    ],
                    [("byId", vec!["id"], true), ("byOwner", vec!["owner"], true)],
                ),
            ),
        ]),
        maintains: vec![Maintain {
            kind: MaintainKind::Sum {
                of: "amount".to_owned(),
            },
            source: "ledger".to_owned(),
            by: vec!["owner".to_owned()],
            target: "balances".to_owned(),
            readable: None,
        }],
        ..Schema::default()
    }
}

fn balance_expr(owner: Expr, site: &str) -> Vec<Stmt> {
    vec![
        Stmt::Let {
            name: "balance".to_owned(),
            value: Expr::Get(Read {
                site: site.to_owned(),
                table: "balances".to_owned(),
                index: "byOwner".to_owned(),
                key: vec![owner],
                provenance: KeyProvenance::Arg,
            }),
        },
        Stmt::If {
            condition: Expr::Binary {
                op: BinaryOp::Ne,
                left: Box::new(var("balance")),
                right: Box::new(Expr::Literal(Value::Null)),
            },
            then_body: vec![Stmt::Return(Expr::Field {
                base: Box::new(var("balance")),
                name: "value".to_owned(),
            })],
            else_body: vec![Stmt::Return(Expr::Literal(Value::Int(0)))],
        },
    ]
}

fn programs() -> Vec<Program> {
    let money_arg = ArgType::Money {
        currency: "USD".to_owned(),
        scale: 2,
    };
    let mut add_body = vec![Stmt::Insert {
        table: "ledger".to_owned(),
        row: Expr::Object(BTreeMap::from([
            ("id".to_owned(), var("id")),
            ("owner".to_owned(), var("owner")),
            ("amount".to_owned(), var("amount")),
        ])),
    }];
    add_body.extend(balance_expr(var("owner"), "balances.afterInsert"));
    vec![
        Program {
            name: "ledger.add".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("id".to_owned(), ArgType::Id),
                ("owner".to_owned(), ArgType::Principal),
                ("amount".to_owned(), money_arg),
            ]),
            read_time_granularity_ms: None,
            body: add_body,
        },
        Program {
            name: "balances.read".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("owner".to_owned(), ArgType::Principal)]),
            read_time_granularity_ms: None,
            body: balance_expr(var("owner"), "balances.read"),
        },
    ]
}

fn project(schema: Schema) -> ProjectJson {
    ProjectJson {
        version: 1,
        schema,
        programs: programs(),
        effects: Vec::new(),
        auth: Auth::default(),
    }
}

fn add_args(id: &str, owner: &str, amount: i64) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("id".to_owned(), Value::Id(id.to_owned())),
        ("owner".to_owned(), Value::Id(owner.to_owned())),
        ("amount".to_owned(), Value::Int(amount)),
    ])
}

#[test]
fn money_sum_maintain_requires_and_preserves_the_exact_descriptor() {
    let valid = schema(money());
    Generation::certify(&project(valid.clone()), Ceilings::default()).unwrap();
    Engine::memory(valid).unwrap();

    let invalid = schema(ColumnType::Int);
    let errors = Generation::certify(&project(invalid.clone()), Ceilings::default())
        .expect_err("Money source with Int target entered certification");
    assert!(errors.iter().any(|(_, error)| {
        error.code == "E_SCHEMA_MAINTAIN"
            && error.message.contains("balances.value")
            && error.message.contains("Money")
            && error.message.contains("Int")
    }));
    let error = match Engine::memory(invalid) {
        Ok(_) => panic!("Money source with Int target entered Engine"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "E_SCHEMA_MAINTAIN");
    assert!(error.to_string().contains("balances.value"));
}

#[test]
fn signed_money_entries_update_the_visible_sum_inside_the_writing_mutation() {
    let generation = Generation::certify(&project(schema(money())), Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let actor = Actor::persona("alice").unwrap();
    for (id, amount, expected) in [
        ("entry-1", 10_000, 10_000),
        ("entry-2", -250, 9_750),
        ("entry-3", -10_000, -250),
    ] {
        let execution = runtime
            .execute(
                "ledger.add",
                Context::mutation(actor.clone(), add_args(id, "dev:alice", amount)),
            )
            .unwrap();
        assert!(matches!(execution.state, ExecutionState::Committed { .. }));
        assert_eq!(execution.result, Value::Int(expected));
    }
}

#[test]
fn missing_money_maintain_group_is_zero_only_through_aggregate_sugar_shape() {
    let generation = Generation::certify(&project(schema(money())), Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let execution = runtime
        .execute(
            "balances.read",
            Context::query(
                Actor::persona("dave").unwrap(),
                BTreeMap::from([("owner".to_owned(), Value::Id("dev:dave".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.result, Value::Int(0));
}
