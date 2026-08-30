use snapback2_core::*;
use std::collections::BTreeMap;

const TAKE: u32 = 9_405;
const ROW_BYTES: u64 = 446;
const GROWTH_TAKE: u32 = 7_000;
const GROWTH_ROW_BYTES: u64 = 796;

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

fn growth_schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("amount".to_owned(), ColumnType::Int),
                    ("body".to_owned(), ColumnType::Text { max: 570 }),
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

fn growth_scan(take: u32) -> Scan {
    Scan {
        site: "items.growth".to_owned(),
        table: "items".to_owned(),
        index: "byId".to_owned(),
        prefix: Vec::new(),
        order: Order::Asc,
        take: Bound::Literal(take),
        after: None,
        before: None,
        range: None,
        provenance: KeyProvenance::Const,
    }
}

fn spread_append(target: &str, value: Expr) -> Stmt {
    Stmt::Assign {
        name: target.to_owned(),
        value: Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![Expr::Variable(target.to_owned()), Expr::Array(vec![value])],
        },
    }
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
fn collection_reassignment_growth_tracks_loop_cardinality() {
    let schema = growth_schema();
    assert_eq!(
        declared_serialized_row_max(&schema, "items"),
        GROWTH_ROW_BYTES
    );

    // Exact lowering of `result = [...result, item]` over 7,000 declared
    // 796-byte rows.
    let spread_loop = program(
        "items.spreadLoop",
        vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(growth_scan(GROWTH_TAKE)),
                body: vec![spread_append("result", Expr::Variable("item".to_owned()))],
            },
            Stmt::Return(Expr::Variable("result".to_owned())),
        ],
    );
    let spread = permissive_checker(&schema).check(&spread_loop).unwrap();
    assert_eq!(spread.max_closure_bytes, 5_572_000);
    assert_eq!(spread.max_output_bytes, 5_593_002);
    let spread_errors = Checker::new(&schema, Ceilings::default())
        .check_all(&spread_loop)
        .unwrap_err();
    assert!(
        spread_errors.iter().any(|error| error
            .message
            .starts_with("output bytes 5593002 exceeds ceiling")),
        "spread append did not cross the output ceiling: {spread_errors:?}"
    );
    assert!(
        spread_errors.iter().any(|error| error
            .message
            .starts_with("closure bytes 5572000 exceeds ceiling")),
        "spread append did not cross the closure ceiling: {spread_errors:?}"
    );

    let nested_loop = program(
        "items.nestedSpreadLoop",
        vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(growth_scan(400)),
                body: vec![Stmt::For {
                    binding: "copy".to_owned(),
                    domain: LoopDomain::LiteralRange {
                        start: 0,
                        end_exclusive: 20,
                    },
                    body: vec![spread_append("result", Expr::Variable("item".to_owned()))],
                }],
            },
            Stmt::Return(Expr::Variable("result".to_owned())),
        ],
    );
    let nested = permissive_checker(&schema).check(&nested_loop).unwrap();
    assert_eq!(nested.max_closure_bytes, 6_368_000);
    assert_eq!(nested.max_output_bytes, 6_392_002);
    let nested_errors = Checker::new(&schema, Ceilings::default())
        .check_all(&nested_loop)
        .unwrap_err();
    assert!(
        nested_errors.iter().any(|error| error
            .message
            .starts_with("output bytes 6392002 exceeds ceiling")),
        "nested append did not multiply the output width: {nested_errors:?}"
    );
    assert!(
        nested_errors.iter().any(|error| error
            .message
            .starts_with("closure bytes 6368000 exceeds ceiling")),
        "nested append did not multiply the retained width: {nested_errors:?}"
    );

    let scalar_reassignment = program(
        "items.scalarReassignment",
        vec![
            Stmt::Let {
                name: "sum".to_owned(),
                value: Expr::Literal(Value::Int(0)),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(growth_scan(GROWTH_TAKE)),
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
    let scalar = permissive_checker(&schema)
        .check(&scalar_reassignment)
        .unwrap();
    assert_eq!(scalar.max_closure_bytes, 64);
    assert_eq!(scalar.max_output_bytes, 32);

    let fresh_array = program(
        "items.freshArray",
        vec![
            Stmt::Let {
                name: "result".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(growth_scan(GROWTH_TAKE)),
                body: vec![Stmt::Assign {
                    name: "result".to_owned(),
                    value: Expr::Array(vec![Expr::Variable("item".to_owned())]),
                }],
            },
            Stmt::Return(Expr::Variable("result".to_owned())),
        ],
    );
    let fresh = permissive_checker(&schema).check(&fresh_array).unwrap();
    assert_eq!(fresh.max_closure_bytes, GROWTH_ROW_BYTES);
    assert_eq!(fresh.max_output_bytes, 799);
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
