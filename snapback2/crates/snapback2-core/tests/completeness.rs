use serde::Serialize;
use snapback2_core::*;
use std::collections::BTreeMap;

fn documents(index_scope: &str) -> Table {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("group".to_owned(), ColumnType::Id),
            ("owner".to_owned(), ColumnType::Principal),
            ("order".to_owned(), ColumnType::Int),
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
                "byScope".to_owned(),
                Index {
                    columns: vec![index_scope.to_owned(), "order".to_owned(), "id".to_owned()],
                    unique: false,
                },
            ),
        ]),
    );
    table.rules.read = RuleExpr::Eq(RuleTerm::Field("owner".to_owned()), RuleTerm::Viewer);
    table
}

fn schema(index_scope: &str) -> Schema {
    Schema {
        tables: BTreeMap::from([
            ("docs".to_owned(), documents(index_scope)),
            (
                "counts".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("value".to_owned(), ColumnType::Int),
                    ]),
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    )]),
                ),
            ),
            (
                "snapshots".to_owned(),
                public_table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("items".to_owned(), ColumnType::Json { max_bytes: 4_096 }),
                    ]),
                    BTreeMap::from([(
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    )]),
                ),
            ),
        ]),
        schedules: Vec::new(),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn page(after: Option<Expr>, take: u32) -> Scan {
    Scan {
        site: "docs.page".to_owned(),
        table: "docs".to_owned(),
        index: "byScope".to_owned(),
        prefix: vec![var("scope")],
        order: Order::Asc,
        take: Bound::Literal(take),
        after: after.map(Box::new),
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Arg,
    }
}

fn page_program(take: u32, with_after: bool) -> Program {
    let mut args = BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]);
    if with_after {
        args.insert("afterOrder".to_owned(), ArgType::Int);
        args.insert("afterId".to_owned(), ArgType::Id);
    }
    Program {
        name: "docs.page".to_owned(),
        kind: ProgramKind::Query,
        args,
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Scan(page(
            with_after.then(|| Expr::Array(vec![var("afterOrder"), var("afterId")])),
            take,
        )))],
    }
}

fn generation(schema: Schema, program: Program, ceilings: Ceilings) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![program],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        ceilings,
    )
    .unwrap()
}

#[test]
fn words_cannot_erase_capped_page_dependence_through_text_conversion() {
    let schema = schema("group");
    let mut program = page_program(20, false);
    program.body = vec![Stmt::Return(Expr::Builtin {
        builtin: Builtin::Words,
        args: vec![Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![Expr::Literal(Value::String(String::new())), Expr::Scan(page(None, 20))],
        }],
    })];
    let errors = Checker::new(&schema, Ceilings::default()).check_all(&program).unwrap_err();
    assert!(errors.iter().any(|error| error.code == "E_STRUCTURAL_COUNT"), "{errors:?}");
}

fn doc(id: &str, group: &str, owner: &str, order: i64) -> Value {
    object([
        ("id", Value::Id(id.to_owned())),
        ("group", Value::Id(group.to_owned())),
        ("owner", Value::Id(owner.to_owned())),
        ("order", Value::Int(order)),
    ])
}

fn context(scope: &str, after: Option<(i64, &str)>) -> Context {
    let mut args = BTreeMap::from([("scope".to_owned(), Value::Id(scope.to_owned()))]);
    if let Some((order, id)) = after {
        args.insert("afterOrder".to_owned(), Value::Int(order));
        args.insert("afterId".to_owned(), Value::Id(id.to_owned()));
    }
    Context::query(Actor::user("u1").unwrap(), args)
}

fn execute(index_scope: &str, rows: Vec<Value>, take: u32) -> Execution {
    let schema = schema(index_scope);
    let program = page_program(take, false);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema, program, Ceilings::default()),
    )
    .unwrap();
    runtime
        .seed(
            &rows
                .into_iter()
                .map(|row| ("docs".to_owned(), row))
                .collect::<Vec<_>>(),
        )
        .unwrap();
    let scope = if index_scope == "owner" { "u1" } else { "g1" };
    runtime.execute("docs.page", context(scope, None)).unwrap()
}

fn execute_with_examined_ceiling(
    index_scope: &str,
    scope: &str,
    rows: Vec<Value>,
    take: u32,
    examined: u64,
) -> Execution {
    let schema = schema(index_scope);
    let program = page_program(take, false);
    let ceilings = Ceilings {
        examined,
        index_entries: examined,
        rule_probes: examined,
        ..Ceilings::default()
    };
    let certificate = Checker::new(&schema, ceilings).check(&program).unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    for row in rows {
        engine.seed("docs", row).unwrap();
    }
    engine
        .execute(&program, &certificate, context(scope, None))
        .unwrap()
}

#[derive(Serialize, PartialEq, Debug)]
struct ViewerObservable<'a> {
    result: &'a Value,
    receipt: &'a snapback2_core::engine::ClosureReceipt,
    state: &'a ExecutionState,
    seq: u64,
}

fn observable(execution: &Execution) -> Vec<u8> {
    serde_json::to_vec(&ViewerObservable {
        result: &execution.result,
        receipt: &execution.receipt,
        state: &execution.state,
        seq: execution.seq,
    })
    .unwrap()
}

#[test]
fn full_pages_do_not_oracle_hidden_rows_through_result_label_or_receipt() {
    let visible = vec![doc("d3", "g1", "u1", 3), doc("d4", "g1", "u1", 4)];
    let plain = execute("group", visible.clone(), 2);
    let mixed = execute(
        "group",
        vec![
            doc("d1", "g1", "u2", 1),
            doc("d2", "g1", "u2", 2),
            visible[0].clone(),
            visible[1].clone(),
        ],
        2,
    );

    assert_eq!(plain.state, ExecutionState::Capped);
    assert_eq!(observable(&plain), observable(&mixed));
    assert_eq!(plain.trace.ranges[0].examined_ids.len(), 2);
    assert_eq!(mixed.trace.ranges[0].examined_ids.len(), 4);
}

#[test]
fn visible_only_take_reaches_rows_within_the_certified_examined_budget() {
    let non_uniform_schema = schema("group");
    let program = page_program(2, true);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(non_uniform_schema, program, Ceilings::default()),
    )
    .unwrap();
    let mut rows = (1..=128)
        .map(|order| doc(&format!("h{order:03}"), "g1", "u2", order))
        .collect::<Vec<_>>();
    rows.extend([
        doc("v129", "g1", "u1", 129),
        doc("v130", "g1", "u1", 130),
        doc("v131", "g1", "u1", 131),
    ]);
    runtime
        .seed(
            &rows
                .into_iter()
                .map(|row| ("docs".to_owned(), row))
                .collect::<Vec<_>>(),
        )
        .unwrap();

    let mut after = (0, String::new());
    let mut delivered = Vec::new();
    for _ in 0..3 {
        let execution = runtime
            .execute("docs.page", context("g1", Some((after.0, &after.1))))
            .unwrap();
        let page = execution.result.as_array().unwrap();
        delivered.extend(
            page.iter()
                .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()),
        );
        if let Some(row) = page.last() {
            after = (
                row.field("order").unwrap().as_int().unwrap(),
                row.field("id").unwrap().as_str().unwrap().to_owned(),
            );
        }
        if page.len() < 2 {
            break;
        }
    }
    assert_eq!(delivered, ["v129", "v130", "v131"]);
}

#[test]
fn hidden_run_past_the_examined_ceiling_is_an_empty_capped_terminal_page() {
    let exhausted = execute_with_examined_ceiling("group", "g1", Vec::new(), 2, 8);
    let mut beyond_budget = (1..=20)
        .map(|order| doc(&format!("h{order:02}"), "g1", "u2", order))
        .collect::<Vec<_>>();
    beyond_budget.extend([
        doc("v21", "g1", "u1", 21),
        doc("v22", "g1", "u1", 22),
        doc("v23", "g1", "u1", 23),
    ]);
    let capped = execute_with_examined_ceiling("group", "g1", beyond_budget, 2, 8);

    assert_eq!(exhausted.state, ExecutionState::Capped);
    assert_eq!(capped.state, ExecutionState::Capped);
    assert_eq!(exhausted.result, Value::Array(Vec::new()));
    assert_eq!(capped.result, Value::Array(Vec::new()));
    assert_eq!(observable(&exhausted), observable(&capped));
    assert_eq!(exhausted.trace.ranges[0].stop, StopReason::Exhausted);
    assert_eq!(capped.trace.ranges[0].stop, StopReason::Limit);
    assert_eq!(capped.trace.ranges[0].examined_ids.len(), 8);
}

#[test]
fn hoisted_uniform_false_is_identical_for_empty_small_and_over_ceiling_ranges() {
    let empty = execute_with_examined_ceiling("owner", "u2", Vec::new(), 2, 8);
    let two_hidden = execute_with_examined_ceiling(
        "owner",
        "u2",
        vec![doc("h1", "g1", "u2", 1), doc("h2", "g1", "u2", 2)],
        2,
        8,
    );
    let many_hidden = execute_with_examined_ceiling(
        "owner",
        "u2",
        (1..=20)
            .map(|order| doc(&format!("h{order:02}"), "g1", "u2", order))
            .collect(),
        2,
        8,
    );

    assert_eq!(observable(&empty), observable(&two_hidden));
    assert_eq!(observable(&empty), observable(&many_hidden));
    let expected_schema_hash = schema("owner").hash();
    for execution in [&empty, &two_hidden, &many_hidden] {
        assert_eq!(execution.state, ExecutionState::Complete);
        assert_eq!(
            execution.receipt.schema_hash.as_deref(),
            Some(expected_schema_hash.as_str())
        );
        assert_eq!(execution.trace.ranges[0].stop, StopReason::Exhausted);
        assert!(execution.receipt.ranges[0].absence);
    }
    assert_eq!(empty.trace.ranges[0].examined_ids.len(), 0);
    assert_eq!(two_hidden.trace.ranges[0].examined_ids.len(), 1);
    assert_eq!(many_hidden.trace.ranges[0].examined_ids.len(), 1);
}

#[test]
fn complete_requires_hoisted_uniformity_for_the_same_program_shape() {
    let program = page_program(10, false);
    let uniform = Checker::new(&schema("owner"), Ceilings::default())
        .check(&program)
        .unwrap();
    let non_uniform = Checker::new(&schema("group"), Ceilings::default())
        .check(&program)
        .unwrap();
    assert!(uniform.read_sites[0].hoist);
    assert!(!non_uniform.read_sites[0].hoist);
    assert_eq!(uniform.completeness, Completeness::Page);
    assert_eq!(non_uniform.completeness, Completeness::Capped);

    let uniform_execution = execute("owner", vec![doc("d1", "g1", "u1", 1)], 10);
    let capped_execution = execute(
        "group",
        vec![doc("d1", "g1", "u1", 1), doc("d2", "g1", "u2", 2)],
        10,
    );
    assert_eq!(uniform_execution.state, ExecutionState::Complete);
    assert_eq!(capped_execution.state, ExecutionState::Capped);
}

#[test]
fn examined_ceiling_and_visible_take_stops_are_viewer_identical() {
    let program = page_program(2, false);
    let non_uniform_schema = schema("group");
    let mut certificate = Checker::new(&non_uniform_schema, Ceilings::default())
        .check(&program)
        .unwrap();

    let mut take_engine = Engine::memory(non_uniform_schema.clone()).unwrap();
    for row in [
        doc("d1", "other", "u2", 1),
        doc("d2", "other", "u2", 2),
        doc("d3", "g1", "u1", 3),
        doc("d4", "g1", "u1", 4),
    ] {
        take_engine.seed("docs", row).unwrap();
    }
    let take_stop = take_engine
        .execute(&program, &certificate, context("g1", None))
        .unwrap();

    let mut ceiling_engine = Engine::memory(non_uniform_schema).unwrap();
    for row in [
        doc("d1", "g1", "u2", 1),
        doc("d2", "g1", "u2", 2),
        doc("d3", "g1", "u1", 3),
        doc("d4", "g1", "u1", 4),
    ] {
        ceiling_engine.seed("docs", row).unwrap();
    }
    certificate.max_examined = 4;
    certificate.max_index_entries = 4;
    let ceiling_stop = ceiling_engine
        .execute(&program, &certificate, context("g1", None))
        .unwrap();

    assert_eq!(observable(&take_stop), observable(&ceiling_stop));
    assert_eq!(take_stop.trace.ranges[0].examined_ids.len(), 2);
    assert_eq!(ceiling_stop.trace.ranges[0].examined_ids.len(), 4);
}

#[test]
fn capped_only_counts_branches_and_writes_reuse_the_structural_fact_refusal() {
    let non_uniform_schema = schema("group");
    let scan = Expr::Scan(page(None, 10));
    let count = Program {
        name: "docs.count".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Count,
            args: vec![scan.clone()],
        })],
    };
    let branch = Program {
        name: "docs.empty".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Let {
                name: "page".to_owned(),
                value: scan.clone(),
            },
            Stmt::If {
                condition: Expr::Binary {
                    op: BinaryOp::Eq,
                    left: Box::new(Expr::Builtin {
                        builtin: Builtin::Len,
                        args: vec![var("page")],
                    }),
                    right: Box::new(Expr::Literal(Value::Int(0))),
                },
                then_body: vec![Stmt::Return(Expr::Literal(Value::Bool(true)))],
                else_body: vec![Stmt::Return(Expr::Literal(Value::Bool(false)))],
            },
        ],
    };
    let has_more = Program {
        name: "docs.hasMore".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![
            Stmt::Let {
                name: "page".to_owned(),
                value: scan.clone(),
            },
            Stmt::If {
                condition: Expr::Field {
                    base: Box::new(var("page")),
                    name: "hasMore".to_owned(),
                },
                then_body: vec![Stmt::Return(Expr::Literal(Value::Bool(true)))],
                else_body: vec![Stmt::Return(Expr::Literal(Value::Bool(false)))],
            },
        ],
    };
    let write = Program {
        name: "docs.writeCount".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Insert {
            table: "counts".to_owned(),
            row: Expr::Object(BTreeMap::from([
                (
                    "id".to_owned(),
                    Expr::Literal(Value::Id("count".to_owned())),
                ),
                (
                    "value".to_owned(),
                    Expr::Builtin {
                        builtin: Builtin::Count,
                        args: vec![scan.clone()],
                    },
                ),
            ])),
        }],
    };
    let len_items = Program {
        name: "docs.lenItems".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: vec![Stmt::Return(Expr::Builtin {
            builtin: Builtin::Len,
            args: vec![Expr::Field {
                base: Box::new(scan.clone()),
                name: "items".to_owned(),
            }],
        })],
    };

    for (program, minimum) in [(count, 1), (branch, 2), (write, 1)] {
        let errors = Checker::new(&non_uniform_schema, Ceilings::default())
            .check_all(&program)
            .unwrap_err();
        assert!(errors.len() >= minimum, "missing all refusals: {errors:?}");
        assert!(
            errors
                .iter()
                .all(|error| error.code == "E_STRUCTURAL_COUNT")
        );
        assert!(errors.iter().all(|error| {
            error
                .rewrite
                .contains("denormalize the authorization scope")
                && error.rewrite.contains("maintained aggregate")
        }));
    }

    for (program, structural_count, field) in [(has_more, 2, "hasMore"), (len_items, 1, "items")] {
        let errors = Checker::new(&non_uniform_schema, Ceilings::default())
            .check_all(&program)
            .expect_err("a statically known page has no fields");
        assert_eq!(
            errors.len(),
            structural_count + 1,
            "the list-type refusal must not hide structural refusals: {errors:?}"
        );
        assert_eq!(
            errors
                .iter()
                .filter(|error| error.code == "E_STRUCTURAL_COUNT")
                .count(),
            structural_count,
            "every structural refusal must remain visible: {errors:?}"
        );
        let list_error = errors
            .iter()
            .find(|error| error.code == "E_ARGS_TYPE")
            .expect("page field access needs E_ARGS_TYPE");
        assert_eq!(
            list_error.message,
            format!(".{field} is read from a list (a page); lists have no fields")
        );
        assert!(list_error.rewrite.contains("iterate the page"));
    }

    let uniform = Checker::new(&schema("owner"), Ceilings::default())
        .check(&Program {
            name: "docs.count".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(Expr::Builtin {
                builtin: Builtin::Count,
                args: vec![Expr::Scan(page(None, 10))],
            })],
        })
        .unwrap();
    assert_eq!(uniform.completeness, Completeness::Page);
}

#[test]
fn collected_capped_page_may_return_but_cannot_cross_a_durable_sink() {
    let non_uniform_schema = schema("group");
    let collect = || {
        vec![
            Stmt::Let {
                name: "collected".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(page(None, 10)),
                body: vec![Stmt::If {
                    condition: Expr::Binary {
                        op: BinaryOp::Gt,
                        left: Box::new(Expr::Field {
                            base: Box::new(var("item")),
                            name: "order".to_owned(),
                        }),
                        right: Box::new(Expr::Literal(Value::Int(0))),
                    },
                    then_body: vec![Stmt::Push {
                        target: "collected".to_owned(),
                        value: Expr::Object(BTreeMap::from([(
                            "id".to_owned(),
                            Expr::Field {
                                base: Box::new(var("item")),
                                name: "id".to_owned(),
                            },
                        )])),
                    }],
                    else_body: Vec::new(),
                }],
            },
        ]
    };

    let mut returning_body = collect();
    returning_body.push(Stmt::Return(var("collected")));
    let returning = Program {
        name: "docs.returnCollected".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: returning_body,
    };
    let certificate = Checker::new(&non_uniform_schema, Ceilings::default())
        .check(&returning)
        .expect("returning the visible collection stays legal");
    assert_eq!(certificate.completeness, Completeness::Capped);

    let mut inserting_body = collect();
    inserting_body.push(Stmt::Insert {
        table: "snapshots".to_owned(),
        row: Expr::Object(BTreeMap::from([
            (
                "id".to_owned(),
                Expr::Literal(Value::Id("snapshot".to_owned())),
            ),
            ("items".to_owned(), var("collected")),
        ])),
    });
    let inserting = Program {
        name: "docs.insertCollected".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("scope".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        result_page_site: None,
        body: inserting_body,
    };
    let errors = Checker::new(&non_uniform_schema, Ceilings::default())
        .check_all(&inserting)
        .expect_err("a durable sink must not erase capped-page provenance");
    assert_eq!(errors.len(), 2, "unexpected checker refusals: {errors:?}");
    assert_eq!(errors[0].code, "E_STRUCTURAL_FANOUT");
    assert_eq!(errors[1].code, "E_STRUCTURAL_COUNT");
    assert!(
        errors[1]
            .message
            .starts_with("inserted value depends on capped-only site docs.page")
    );
    assert!(
        errors[1]
            .rewrite
            .contains("denormalize the authorization scope")
    );
    assert!(errors[1].rewrite.contains("maintained aggregate"));
}
