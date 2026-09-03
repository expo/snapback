use super::*;

pub(super) fn add_merge_and_optional_cursor_cases(cases: &mut Vec<CorpusCase>) {
    add_merge_cases(cases);
    add_optional_cursor_cases(cases);
}

fn add_merge_cases(cases: &mut Vec<CorpusCase>) {
    let schema = merge_schema();
    let small_rows = vec![post("a1", "u1", 1), post("b2", "u2", 2)];
    let complete = merge_program(
        "merge.complete",
        "merge.complete",
        vec![
            lane_scan(
                "merge.complete.self",
                Expr::Input(Input::Viewer),
                3,
                None,
                "merge.complete",
            ),
            lane_scan(
                "merge.complete.peer",
                literal_id("u2"),
                3,
                None,
                "merge.complete",
            ),
        ],
        3,
    );
    let complete = frozen_query(
        "merge-complete-small-union",
        schema.clone(),
        small_rows,
        complete,
        query_context([]),
        ExecutionState::Complete,
    );
    assert_eq!(
        row_ids(complete.expected.local_result.as_ref()),
        vec!["a1", "b2"]
    );
    cases.push(complete);

    let four_rows = vec![
        post("a1", "u1", 1),
        post("a3", "u1", 3),
        post("b2", "u2", 2),
        post("b4", "u2", 4),
    ];
    let over = merge_program(
        "merge.over",
        "merge.over",
        vec![
            lane_scan("merge.over.self", literal_id("u1"), 2, None, "merge.over"),
            lane_scan("merge.over.peer", literal_id("u2"), 2, None, "merge.over"),
        ],
        2,
    );
    let over = frozen_query(
        "merge-exhausted-union-over-n",
        schema.clone(),
        four_rows,
        over,
        query_context([]),
        ExecutionState::Capped,
    );
    assert_eq!(
        row_ids(over.expected.local_result.as_ref()),
        vec!["a1", "b2"]
    );
    cases.push(over);

    let overlap = merge_program(
        "merge.overlap",
        "merge.overlap",
        vec![
            lane_scan(
                "merge.overlap.dynamic",
                Expr::Input(Input::Viewer),
                3,
                None,
                "merge.overlap",
            ),
            lane_scan(
                "merge.overlap.literal",
                literal_id("u1"),
                3,
                None,
                "merge.overlap",
            ),
        ],
        3,
    );
    let overlap = frozen_query(
        "merge-runtime-overlap-deduped",
        schema.clone(),
        vec![post("a1", "u1", 1), post("a3", "u1", 3)],
        overlap,
        query_context([]),
        ExecutionState::Complete,
    );
    assert_eq!(
        row_ids(overlap.expected.local_result.as_ref()),
        vec!["a1", "a3"]
    );
    cases.push(overlap);

    let all_rows = vec![
        post("a1", "u1", 1),
        post("a3", "u1", 3),
        post("a5", "u1", 5),
        post("b2", "u2", 2),
        post("b4", "u2", 4),
        post("b6", "u2", 6),
    ];
    let first = merged(
        "merge.pages.first",
        vec![
            lane_scan(
                "merge.pages.first.a",
                literal_id("u1"),
                3,
                None,
                "merge.pages.first",
            ),
            lane_scan(
                "merge.pages.first.b",
                literal_id("u2"),
                3,
                None,
                "merge.pages.first",
            ),
        ],
        3,
    );
    let cursor = Some((3, "a3"));
    let second = merged(
        "merge.pages.second",
        vec![
            lane_scan(
                "merge.pages.second.a",
                literal_id("u1"),
                3,
                cursor,
                "merge.pages.second",
            ),
            lane_scan(
                "merge.pages.second.b",
                literal_id("u2"),
                3,
                cursor,
                "merge.pages.second",
            ),
        ],
        3,
    );
    let pages = Program {
        name: "merge.pages".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Array(vec![first, second]))],
    };
    let pages = frozen_query(
        "merge-shared-cursor-page-two",
        schema.clone(),
        all_rows,
        pages,
        query_context([]),
        ExecutionState::Capped,
    );
    assert_eq!(
        page_row_ids(pages.expected.local_result.as_ref()),
        vec!["a1", "b2", "a3", "b4", "a5", "b6"]
    );
    cases.push(pages);

    cases.push(for_lane_limit_case(schema));
}

fn add_optional_cursor_cases(cases: &mut Vec<CorpusCase>) {
    let schema = merge_schema();
    let rows = vec![
        post("a1", "u1", 1),
        post("a2", "u1", 2),
        post("a3", "u1", 3),
    ];
    for (name, order, context, expected, state) in [
        (
            "optional-cursor-absent-last",
            Order::Desc,
            optional_context(Value::Null, Value::Null),
            vec!["a3", "a2"],
            ExecutionState::Capped,
        ),
        (
            "optional-cursor-absent-first",
            Order::Asc,
            optional_context(Value::Null, Value::Null),
            vec!["a1", "a2"],
            ExecutionState::Capped,
        ),
        (
            "optional-cursor-present-pages",
            Order::Asc,
            optional_context(Value::Int(1), id("a1")),
            vec!["a2", "a3"],
            ExecutionState::Complete,
        ),
    ] {
        let case = frozen_query(
            name,
            schema.clone(),
            rows.clone(),
            optional_cursor_program(name, order),
            context,
            state,
        );
        assert_eq!(row_ids(case.expected.local_result.as_ref()), expected);
        cases.push(case);
    }

    let mixed = case_from_parts(
        "optional-cursor-mixed-input-refused",
        "merge",
        schema,
        optional_cursor_program("optional-cursor-mixed-input-refused", Order::Asc),
        optional_context(Value::Int(1), Value::Null),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    );
    assert_eq!(mixed.expected.error_code.as_deref(), Some("E_INPUT"));
    cases.push(mixed);
}

fn merge_schema() -> Schema {
    let public = RuleExpr::Public {
        reason: "merge corpus fixture".to_owned(),
    };
    let table = |columns, indexes| Table {
        columns,
        indexes,
        rules: Rules {
            read: public.clone(),
            insert: public.clone(),
            update: public.clone(),
            delete: public.clone(),
        },
        constraints: Vec::new(),
    };
    Schema {
        tables: BTreeMap::from([
            (
                "posts".to_owned(),
                table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("author".to_owned(), ColumnType::Principal),
                        ("at".to_owned(), ColumnType::Int),
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
                            "byAuthorAt".to_owned(),
                            Index {
                                columns: vec![
                                    "author".to_owned(),
                                    "at".to_owned(),
                                    "id".to_owned(),
                                ],
                                unique: false,
                            },
                        ),
                        (
                            "byAt".to_owned(),
                            Index {
                                columns: vec!["at".to_owned(), "id".to_owned()],
                                unique: false,
                            },
                        ),
                    ]),
                ),
            ),
            (
                "follows".to_owned(),
                table(
                    BTreeMap::from([
                        ("id".to_owned(), ColumnType::Id),
                        ("follower".to_owned(), ColumnType::Principal),
                        ("followed".to_owned(), ColumnType::Principal),
                        ("at".to_owned(), ColumnType::Int),
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
                            "byFollower".to_owned(),
                            Index {
                                columns: vec![
                                    "follower".to_owned(),
                                    "at".to_owned(),
                                    "id".to_owned(),
                                ],
                                unique: false,
                            },
                        ),
                    ]),
                ),
            ),
        ]),
        ..Schema::default()
    }
}

fn post(id_value: &str, author: &str, at: i64) -> (&'static str, Value) {
    (
        "posts",
        row([
            ("id", id(id_value)),
            ("author", id(author)),
            ("at", Value::Int(at)),
        ]),
    )
}

fn literal_id(value: &str) -> Expr {
    Expr::Literal(id(value))
}

fn lane_scan(
    site: &str,
    prefix: Expr,
    take: u32,
    cursor: Option<(i64, &str)>,
    merge_site: &str,
) -> Expr {
    Expr::Scan(Scan {
        site: site.to_owned(),
        table: "posts".to_owned(),
        index: "byAuthorAt".to_owned(),
        prefix: vec![prefix],
        order: Order::Asc,
        take: Bound::Literal(take),
        after: cursor.map(|(at, id_value)| {
            Box::new(Expr::Array(vec![
                Expr::Literal(Value::Int(at)),
                literal_id(id_value),
            ]))
        }),
        before: None,
        range: None,
        optional_cursor_args: Vec::new(),
        merge_site: Some(merge_site.to_owned()),
        provenance: KeyProvenance::Const,
    })
}

fn merged(site: &str, lanes: Vec<Expr>, take: u32) -> Expr {
    let union = lanes
        .into_iter()
        .reduce(|left, right| Expr::Builtin {
            builtin: Builtin::Concat,
            args: vec![left, right],
        })
        .unwrap_or_else(|| Expr::Array(Vec::new()));
    let sorted = Expr::Builtin {
        builtin: Builtin::Sort {
            keys: vec![
                SortKey {
                    field: "at".to_owned(),
                    order: Order::Asc,
                },
                SortKey {
                    field: "id".to_owned(),
                    order: Order::Asc,
                },
            ],
        },
        args: vec![union],
    };
    let deduped = Expr::Builtin {
        builtin: Builtin::DedupeById {
            site: site.to_owned(),
            table: "posts".to_owned(),
        },
        args: vec![sorted],
    };
    Expr::Builtin {
        builtin: Builtin::Slice,
        args: vec![
            deduped,
            Expr::Literal(Value::Int(0)),
            Expr::Literal(Value::Int(i64::from(take))),
        ],
    }
}

fn merge_program(name: &str, site: &str, lanes: Vec<Expr>, take: u32) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(merged(site, lanes, take))],
    }
}

fn for_lane_limit_case(schema: Schema) -> CorpusCase {
    let site = "merge.for-limit";
    let domain = Scan {
        site: "merge.for-limit.domain".to_owned(),
        table: "follows".to_owned(),
        index: "byFollower".to_owned(),
        prefix: vec![literal_id("u1")],
        order: Order::Asc,
        take: Bound::Literal(1),
        after: None,
        before: None,
        range: None,
        optional_cursor_args: Vec::new(),
        merge_site: None,
        provenance: KeyProvenance::Const,
    };
    let lane = Scan {
        site: "merge.for-limit.lane".to_owned(),
        table: "posts".to_owned(),
        index: "byAuthorAt".to_owned(),
        prefix: vec![Expr::Field {
            base: Box::new(var("follow")),
            name: "followed".to_owned(),
        }],
        order: Order::Asc,
        take: Bound::Literal(3),
        after: None,
        before: None,
        range: None,
        optional_cursor_args: Vec::new(),
        merge_site: Some(site.to_owned()),
        provenance: KeyProvenance::Shape,
    };
    let program = Program {
        name: site.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "union".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "follow".to_owned(),
                domain: LoopDomain::Page(domain),
                body: vec![Stmt::For {
                    binding: "post".to_owned(),
                    domain: LoopDomain::Page(lane),
                    body: vec![Stmt::Push {
                        target: "union".to_owned(),
                        value: var("post"),
                    }],
                }],
            },
            Stmt::Return(merged(site, vec![var("union")], 3)),
        ],
    };
    let rows = vec![
        post("a1", "u2", 1),
        (
            "follows",
            row([
                ("id", id("f1")),
                ("follower", id("u1")),
                ("followed", id("u2")),
                ("at", Value::Int(1)),
            ]),
        ),
        (
            "follows",
            row([
                ("id", id("f2")),
                ("follower", id("u1")),
                ("followed", id("u3")),
                ("at", Value::Int(2)),
            ]),
        ),
    ];
    frozen_query(
        "merge-for-lane-domain-limit",
        schema,
        rows,
        program,
        query_context([]),
        ExecutionState::Capped,
    )
}

fn optional_cursor_program(name: &str, order: Order) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([
            (
                "cursorAt".to_owned(),
                ArgType::Optional(Box::new(ArgType::Int)),
            ),
            (
                "cursorId".to_owned(),
                ArgType::Optional(Box::new(ArgType::Ref {
                    table: "posts".to_owned(),
                })),
            ),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: name.to_owned(),
            table: "posts".to_owned(),
            index: "byAt".to_owned(),
            prefix: Vec::new(),
            order,
            take: Bound::Literal(2),
            after: Some(Box::new(Expr::Array(vec![
                Expr::Variable("cursorAt".to_owned()),
                Expr::Variable("cursorId".to_owned()),
            ]))),
            before: None,
            range: None,
            optional_cursor_args: vec!["cursorAt".to_owned(), "cursorId".to_owned()],
            merge_site: None,
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn optional_context(cursor_at: Value, cursor_id: Value) -> Context {
    query_context([("cursorAt", cursor_at), ("cursorId", cursor_id)])
}

fn frozen_query(
    name: &str,
    schema: Schema,
    rows: Vec<(&str, Value)>,
    program: Program,
    context: Context,
    expected_state: ExecutionState,
) -> CorpusCase {
    let mut engine = Engine::memory(schema.clone()).expect("merge corpus engine");
    for (table, value) in rows {
        engine.seed(table, value).expect("merge corpus row");
    }
    let execution = authoritative(&mut engine, &schema, &program, context.clone());
    assert_eq!(execution.state, expected_state, "{name} state");
    let result = execution.result.clone();
    let case = case_from_parts(
        name,
        "merge",
        schema,
        program,
        context,
        execution.receipt,
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.local_result.as_ref(), Some(&result));
    case
}

fn row_ids(value: Option<&Value>) -> Vec<&str> {
    match value {
        Some(Value::Array(rows)) => rows
            .iter()
            .map(|row| row.field("id").and_then(Value::as_str).expect("row id"))
            .collect(),
        other => panic!("expected rows, got {other:?}"),
    }
}

fn page_row_ids(value: Option<&Value>) -> Vec<&str> {
    match value {
        Some(Value::Array(pages)) => pages
            .iter()
            .flat_map(|page| match page {
                Value::Array(rows) => rows
                    .iter()
                    .map(|row| row.field("id").and_then(Value::as_str).expect("row id"))
                    .collect::<Vec<_>>(),
                other => panic!("expected page, got {other:?}"),
            })
            .collect(),
        other => panic!("expected pages, got {other:?}"),
    }
}
