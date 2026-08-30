use snapback2_core::*;
use std::collections::BTreeMap;

const TAKE: u32 = 9_405;
const ROW_BYTES: u64 = 446;

fn schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("amount".to_owned(), ColumnType::Int),
                    ("body".to_owned(), ColumnType::Text { max: 220 }),
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
    }
}

fn scan() -> Expr {
    Expr::Scan(Scan {
        site: "items.page".to_owned(),
        table: "items".to_owned(),
        index: "byId".to_owned(),
        prefix: Vec::new(),
        order: Order::Asc,
        take: Bound::Literal(TAKE),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Const,
    })
}

fn program(name: &str, body: Vec<Stmt>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}

fn bound_page() -> Stmt {
    Stmt::Let {
        name: "page".to_owned(),
        value: scan(),
    }
}

fn count_page() -> Expr {
    Expr::Builtin {
        builtin: Builtin::Count,
        args: vec![Expr::Variable("page".to_owned())],
    }
}

fn permissive_checker(schema: &Schema) -> Checker<'_> {
    Checker::new(
        schema,
        Ceilings {
            output_bytes: u64::MAX,
            closure_bytes: u64::MAX,
            ..Ceilings::default()
        },
    )
}

#[test]
fn closure_retention_follows_page_data_flow() {
    let schema = schema();
    assert_eq!(declared_serialized_row_max(&schema, "items"), ROW_BYTES);

    let inline_count = program(
        "items.inlineCount",
        vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Count,
            args: vec![scan()],
        })],
    );
    let bound_count = program(
        "items.boundCount",
        vec![bound_page(), Stmt::Return(count_page())],
    );
    let reduce_sum = program(
        "items.reduceSum",
        vec![
            bound_page(),
            Stmt::Let {
                name: "sum".to_owned(),
                value: Expr::Literal(Value::Int(0)),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::DerivedArray {
                    value: Expr::Variable("page".to_owned()),
                    max: TAKE,
                    bound_source: "items.page take".to_owned(),
                },
                body: vec![Stmt::Assign {
                    name: "sum".to_owned(),
                    value: Expr::Binary {
                        op: BinaryOp::Add,
                        left: Box::new(Expr::Variable("sum".to_owned())),
                        right: Box::new(Expr::Field {
                            base: Box::new(Expr::Variable("item".to_owned())),
                            name: "amount".to_owned(),
                        }),
                    },
                }],
            },
            Stmt::Return(Expr::Variable("sum".to_owned())),
        ],
    );
    let pushed_rows = program(
        "items.pushedRows",
        vec![
            bound_page(),
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::DerivedArray {
                    value: Expr::Variable("page".to_owned()),
                    max: TAKE,
                    bound_source: "items.page take".to_owned(),
                },
                body: vec![Stmt::Push {
                    target: "result".to_owned(),
                    value: Expr::Variable("item".to_owned()),
                }],
            },
            Stmt::Return(Expr::Variable("result".to_owned())),
        ],
    );
    let mixed_slice = program(
        "items.mixedSlice",
        vec![
            bound_page(),
            Stmt::Let {
                name: "count".to_owned(),
                value: count_page(),
            },
            Stmt::Return(Expr::Object(BTreeMap::from([
                ("count".to_owned(), Expr::Variable("count".to_owned())),
                (
                    "rows".to_owned(),
                    Expr::Builtin {
                        builtin: Builtin::Slice,
                        args: vec![
                            Expr::Variable("page".to_owned()),
                            Expr::Literal(Value::Int(0)),
                            Expr::Literal(Value::Int(3)),
                        ],
                    },
                ),
            ]))),
        ],
    );

    let estimates = [
        ("inline count", inline_count, 64),
        ("let-bound count", bound_count, 64),
        ("reduce sum", reduce_sum, 64),
        (
            "pushed rows",
            pushed_rows.clone(),
            u64::from(TAKE) * ROW_BYTES,
        ),
        ("count plus returned slice", mixed_slice, 3 * ROW_BYTES),
    ];
    for (shape, program, expected) in estimates {
        let certificate = permissive_checker(&schema).check(&program).unwrap();
        assert_eq!(certificate.max_closure_bytes, expected, "{shape}");
    }

    let errors = Checker::new(&schema, Ceilings::default())
        .check_all(&pushed_rows)
        .unwrap_err();
    assert!(
        errors.iter().any(|error| error
            .message
            .starts_with("closure bytes 4194630 exceeds ceiling")),
        "pushing every page row no longer preserves the full-page refusal: {errors:?}"
    );
}

#[test]
fn heap_only_program_names_the_heap_ceiling() {
    let work = (0..2)
        .map(|number| Stmt::Let {
            name: format!("temporary{number}"),
            value: Expr::Literal(Value::Null),
        })
        .collect();
    let program = program(
        "items.heapOnly",
        vec![
            Stmt::For {
                binding: "number".to_owned(),
                domain: LoopDomain::LiteralRange {
                    start: 0,
                    end_exclusive: 100_000,
                },
                body: work,
            },
            Stmt::Return(Expr::Literal(Value::Null)),
        ],
    );
    let errors = Checker::new(&schema(), Ceilings::default())
        .check_all(&program)
        .unwrap_err();
    assert_eq!(errors.len(), 1, "heap-only fixture crossed another ceiling");
    assert!(errors[0].message.starts_with("heap bytes "), "{errors:?}");
}
