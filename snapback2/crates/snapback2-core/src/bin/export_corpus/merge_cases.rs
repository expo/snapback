use super::*;
use snapback2_core::ir::IndexKeyExpr;

pub(super) fn add_merge_and_opaque_cursor_cases(cases: &mut Vec<CorpusCase>) {
    add_merge_cases(cases);
    add_lazy_merge_cases(cases);
    add_review_merge_cases(cases);
    add_opaque_cursor_cases(cases);
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

fn add_opaque_cursor_cases(cases: &mut Vec<CorpusCase>) {
    let schema = merge_schema();
    let rows = vec![
        post("a1", "u1", 1),
        post("a2", "u1", 2),
        post("a3", "u1", 3),
    ];
    let mut complete = frozen_query(
        "opaque-cursor-complete-next-null",
        schema.clone(),
        rows.clone(),
        opaque_cursor_program("opaque-cursor-complete-next-null", Order::Asc, 5),
        cursor_context(Value::Null),
        ExecutionState::Complete,
    );
    complete.category = "cursor".to_owned();
    assert_eq!(complete.expected.next, None);
    cases.push(complete);

    let mut first = frozen_query(
        "opaque-cursor-capped-next-token",
        schema.clone(),
        rows.clone(),
        opaque_cursor_program("opaque-cursor-capped-next-token", Order::Asc, 2),
        cursor_context(Value::Null),
        ExecutionState::Capped,
    );
    first.category = "cursor".to_owned();
    assert_eq!(
        row_ids(first.expected.local_result.as_ref()),
        vec!["a1", "a2"]
    );
    let token = first.expected.next.clone().expect("capped page token");
    cases.push(first);

    let mut second = frozen_query(
        "opaque-cursor-page-two-no-overlap",
        schema.clone(),
        rows.clone(),
        opaque_cursor_program("opaque-cursor-page-two-no-overlap", Order::Asc, 2),
        cursor_context(Value::String(token.clone())),
        ExecutionState::Complete,
    );
    second.category = "cursor".to_owned();
    assert_eq!(row_ids(second.expected.local_result.as_ref()), vec!["a3"]);
    cases.push(second);

    let mut raw = opaque_cursor_program("tuple-cursor-comparison", Order::Asc, 2);
    raw.args.clear();
    let Stmt::Return(Expr::Scan(scan)) = &mut raw.body[0] else {
        unreachable!()
    };
    scan.after = Some(Box::new(Expr::Array(vec![
        Expr::Literal(Value::Int(2)),
        literal_id("a2"),
    ])));
    scan.opaque_cursor = false;
    let raw_page = execute_seeded(&schema, &rows, &raw, query_context([]));
    assert_eq!(
        row_ids(Some(&raw_page.result)),
        vec!["a3"],
        "opaque page two diverged from tuple lowering target"
    );

    let mut hidden_schema = schema.clone();
    hidden_schema.tables.get_mut("posts").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("author".to_owned()),
        RuleTerm::Literal(id("u9")),
    );
    let mut empty = frozen_query(
        "opaque-cursor-empty-capped-next-null",
        hidden_schema,
        rows.clone(),
        opaque_cursor_program("opaque-cursor-empty-capped-next-null", Order::Asc, 2),
        cursor_context(Value::Null),
        ExecutionState::Capped,
    );
    empty.category = "cursor".to_owned();
    assert!(row_ids(empty.expected.local_result.as_ref()).is_empty());
    assert_eq!(empty.expected.next, None);
    cases.push(empty);

    for (name, token) in [
        (
            "opaque-cursor-wrong-order-refused",
            opaque_token("byAt", Order::Desc, 2, "a2"),
        ),
        (
            "opaque-cursor-wrong-index-refused",
            opaque_token("byAuthorAt", Order::Asc, 2, "a2"),
        ),
    ] {
        let refused = case_from_parts(
            name,
            "cursor-refusal",
            schema.clone(),
            opaque_cursor_program(name, Order::Asc, 2),
            cursor_context(Value::String(token)),
            ClosureReceipt::default(),
            Vec::new(),
            None,
            None,
        );
        assert_eq!(refused.expected.error_code.as_deref(), Some("E_INPUT"));
        cases.push(refused);
    }

    add_opaque_merge_pages(cases, schema);
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
        retain: Default::default(),
        tombstones: Vec::new(),
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
                                components: (vec!["id".to_owned()])
                                    .into_iter()
                                    .map(snapback2_core::search_key::IndexComponent::Column)
                                    .collect(),
                                unique: true,
                            },
                        ),
                        (
                            "byAuthorAt".to_owned(),
                            Index {
                                components: (vec![
                                    "author".to_owned(),
                                    "at".to_owned(),
                                    "id".to_owned(),
                                ])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
                                unique: false,
                            },
                        ),
                        (
                            "byAt".to_owned(),
                            Index {
                                components: (vec!["at".to_owned(), "id".to_owned()])
                                    .into_iter()
                                    .map(snapback2_core::search_key::IndexComponent::Column)
                                    .collect(),
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
                                components: (vec!["id".to_owned()])
                                    .into_iter()
                                    .map(snapback2_core::search_key::IndexComponent::Column)
                                    .collect(),
                                unique: true,
                            },
                        ),
                        (
                            "byFollower".to_owned(),
                            Index {
                                components: (vec![
                                    "follower".to_owned(),
                                    "at".to_owned(),
                                    "id".to_owned(),
                                ])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
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
        prefix: (vec![prefix])
            .into_iter()
            .map(IndexKeyExpr::Scalar)
            .collect(),
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
        opaque_cursor: false,
        merge_site: Some(merge_site.to_owned()),
        provenance: KeyProvenance::Const,
    })
}

fn merged(site: &str, lanes: Vec<Expr>, take: u32) -> Expr {
    Expr::Merge(Merge {
        held_search: None,
        site: site.to_owned(),
        lanes: lanes
            .into_iter()
            .map(|lane| {
                let Expr::Scan(scan) = lane else {
                    panic!("merge lane must be a scan")
                };
                assert_eq!(scan.take.maximum(), u64::from(take));
                MergeLane {
                    setup: Vec::new(),
                    scan,
                    source: None,
                    binding: String::new(),
                }
            })
            .collect(),
    })
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
        prefix: (vec![literal_id("u1")])
            .into_iter()
            .map(IndexKeyExpr::Scalar)
            .collect(),
        order: Order::Asc,
        take: Bound::Literal(1),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: None,
        provenance: KeyProvenance::Const,
    };
    let lane = Scan {
        site: "merge.for-limit.lane".to_owned(),
        table: "posts".to_owned(),
        index: "byAuthorAt".to_owned(),
        prefix: (vec![Expr::Field {
            base: Box::new(var("follow")),
            name: "followed".to_owned(),
        }])
        .into_iter()
        .map(IndexKeyExpr::Scalar)
        .collect(),
        order: Order::Asc,
        take: Bound::Literal(3),
        after: None,
        before: None,
        range: None,
        opaque_cursor: false,
        merge_site: Some(site.to_owned()),
        provenance: KeyProvenance::Shape,
    };
    let program = Program {
        name: site.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Merge(Merge {
            held_search: None,
            site: site.into(),
            lanes: vec![MergeLane {
                setup: Vec::new(),
                scan: lane,
                source: Some(domain),
                binding: "follow".into(),
            }],
        }))],
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

fn opaque_cursor_program(name: &str, order: Order, take: u32) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("c".to_owned(), ArgType::Optional(Box::new(ArgType::Cursor)))]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: name.to_owned(),
            table: "posts".to_owned(),
            index: "byAt".to_owned(),
            prefix: (Vec::new()).into_iter().map(IndexKeyExpr::Scalar).collect(),
            order,
            take: Bound::Literal(take),
            after: Some(Box::new(Expr::Variable("c".to_owned()))),
            before: None,
            range: None,
            opaque_cursor: true,
            merge_site: None,
            provenance: KeyProvenance::Arg,
        }))],
    }
}

fn cursor_context(cursor: Value) -> Context {
    query_context([("c", cursor)])
}

fn opaque_token(index: &str, order: Order, at: i64, id_value: &str) -> String {
    encode_cursor(
        &Schema::default(),
        &CursorPosition {
            table: "posts".to_owned(),
            index: index.to_owned(),
            order,
            suffix: vec![
                CursorColumn {
                    name: "at".to_owned(),
                    kind: ColumnType::Int,
                },
                CursorColumn {
                    name: "id".to_owned(),
                    kind: ColumnType::Id,
                },
            ],
            values: vec![Value::Int(at), id(id_value)],
        },
    )
    .expect("opaque cursor token")
}

fn execute_seeded(
    schema: &Schema,
    rows: &[(&str, Value)],
    program: &Program,
    context: Context,
) -> Execution {
    let mut engine = Engine::memory(schema.clone()).expect("cursor engine");
    for (table, value) in rows {
        engine.seed(table, value.clone()).expect("cursor row");
    }
    authoritative(&mut engine, schema, program, context)
}

fn add_opaque_merge_pages(cases: &mut Vec<CorpusCase>, schema: Schema) {
    let rows = vec![
        post("a1", "u1", 1),
        post("a3", "u1", 3),
        post("b2", "u2", 2),
        post("b4", "u2", 4),
    ];
    let program = |name: &str| {
        let lanes = [(format!("{name}.a"), "u1"), (format!("{name}.b"), "u2")]
            .into_iter()
            .map(|(site, author)| {
                Expr::Scan(Scan {
                    site,
                    table: "posts".to_owned(),
                    index: "byAuthorAt".to_owned(),
                    prefix: (vec![literal_id(author)])
                        .into_iter()
                        .map(IndexKeyExpr::Scalar)
                        .collect(),
                    order: Order::Asc,
                    take: Bound::Literal(2),
                    after: Some(Box::new(Expr::Variable("c".to_owned()))),
                    before: None,
                    range: None,
                    opaque_cursor: true,
                    merge_site: Some(name.to_owned()),
                    provenance: KeyProvenance::Arg,
                })
            })
            .collect();
        let mut program = merge_program(name, name, lanes, 2);
        program
            .args
            .insert("c".to_owned(), ArgType::Optional(Box::new(ArgType::Cursor)));
        program
    };
    let first_name = "opaque-cursor-merge-capped-token";
    let mut first = frozen_query(
        first_name,
        schema.clone(),
        rows.clone(),
        program(first_name),
        cursor_context(Value::Null),
        ExecutionState::Capped,
    );
    first.category = "cursor".to_owned();
    assert_eq!(
        row_ids(first.expected.local_result.as_ref()),
        vec!["a1", "b2"]
    );
    let token = first.expected.next.clone().expect("merge token");
    cases.push(first);

    let second_name = "opaque-cursor-merge-page-two";
    let mut second = frozen_query(
        second_name,
        schema,
        rows,
        program(second_name),
        cursor_context(Value::String(token)),
        ExecutionState::Complete,
    );
    second.category = "cursor".to_owned();
    assert_eq!(
        row_ids(second.expected.local_result.as_ref()),
        vec!["a3", "b4"]
    );
    assert_eq!(second.expected.next, None);
    cases.push(second);
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
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert!(
        execution.trace.examined <= certificate.max_examined,
        "{name} examined"
    );
    assert!(
        execution.trace.examined <= certificate.max_index_entries,
        "{name} index entries"
    );
    assert!(
        execution.trace.steps <= certificate.max_steps,
        "{name} steps"
    );
    assert!(
        execution.trace.rule_probes <= certificate.max_rule_probes,
        "{name} rule probes"
    );
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

fn add_lazy_merge_cases(cases: &mut Vec<CorpusCase>) {
    let schema = merge_schema();
    let make = |site: &str, take| {
        merge_program(
            site,
            site,
            ["u1", "u2", "empty"]
                .into_iter()
                .enumerate()
                .map(|(n, author)| {
                    lane_scan(&format!("{site}.{n}"), literal_id(author), take, None, site)
                })
                .collect(),
            take,
        )
    };
    let tied = vec![
        post("a", "u1", 1),
        post("c", "u1", 1),
        post("b", "u2", 1),
        post("d", "u2", 2),
    ];
    let case = frozen_query(
        "merge-ties-and-empty-lane",
        schema.clone(),
        tied,
        make("merge.ties", 2),
        query_context([]),
        ExecutionState::Capped,
    );
    assert_eq!(row_ids(case.expected.local_result.as_ref()), ["a", "b"]);
    cases.push(case);

    let mut large = for_lane_limit_case(schema.clone()).program;
    large.name = "merge.large".into();
    let Stmt::Return(Expr::Merge(merge)) = &mut large.body[0] else {
        unreachable!()
    };
    merge.lanes[0].source.as_mut().unwrap().take = Bound::Literal(500);
    merge.lanes[0].scan.take = Bound::Literal(20);
    let mut own = merge.lanes[0].clone();
    own.scan.site = "merge.large.self".into();
    own.scan.prefix = vec![Expr::Input(Input::Viewer)]
        .into_iter()
        .map(IndexKeyExpr::Scalar)
        .collect();
    own.source = None;
    own.binding.clear();
    merge.lanes.insert(0, own);
    let mut rows = vec![post("own", "u1", 1)];
    for n in 0..500 {
        let author = format!("actor{n:04}");
        rows.push((
            "follows",
            row([
                ("id", id(&format!("f{n:04}"))),
                ("follower", id("u1")),
                ("followed", id(&author)),
                ("at", Value::Int(n)),
            ]),
        ));
        rows.push(post(&format!("p{n:04}"), &author, n % 37));
    }
    let large = frozen_query(
        "merge-500-lanes-take-20",
        schema.clone(),
        rows,
        large,
        query_context([]),
        ExecutionState::Capped,
    );
    assert_eq!(large.certificate.as_ref().unwrap().max_examined, 1025);
    assert_eq!(
        large.certificate.as_ref().unwrap().merge_sites[0].max_lanes,
        501
    );
    cases.push(large);

    let mut hidden_schema = schema;
    hidden_schema
        .tables
        .get_mut("posts")
        .unwrap()
        .columns
        .insert("visible".into(), ColumnType::Bool);
    hidden_schema.tables.get_mut("posts").unwrap().rules.read = RuleExpr::Eq(
        RuleTerm::Field("visible".into()),
        RuleTerm::Literal(Value::Bool(true)),
    );
    let visible_post = |id: &str, author: &str, visible: bool| {
        let (table, mut value) = post(id, author, 1);
        if let Value::Row(fields) | Value::Map(fields) = &mut value {
            fields.insert("visible".into(), Value::Bool(visible));
        }
        (table, value)
    };
    let mut hidden_program = make("merge.hidden", 2);
    hidden_program
        .args
        .insert("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)));
    let Stmt::Return(Expr::Merge(merge)) = &mut hidden_program.body[0] else {
        unreachable!()
    };
    for lane in &mut merge.lanes {
        lane.scan.after = Some(Box::new(var("c")));
        lane.scan.opaque_cursor = true;
    }
    let before = vec![
        visible_post("hidden", "u1", false),
        visible_post("a", "u1", true),
        visible_post("b", "u2", true),
        visible_post("c", "u2", true),
    ];
    let first_context = query_context([("c", Value::Null)]);
    let first = execute_seeded(
        &hidden_schema,
        &before,
        &hidden_program,
        first_context.clone(),
    );
    assert_eq!(row_ids(Some(&first.result)), ["a", "b"]);
    assert!(!first.receipt.rows.iter().any(|row| row.id == "hidden"));
    let token = first.next.clone().unwrap();
    cases.push(case_from_parts(
        "merge-hidden-candidates-capped",
        "merge",
        hidden_schema.clone(),
        hidden_program.clone(),
        first_context,
        first.receipt,
        vec![],
        None,
        None,
    ));
    // The remaining row loses visibility before the next page; the old cursor grants no authority.
    let revoked = vec![
        visible_post("hidden", "u1", false),
        visible_post("a", "u1", true),
        visible_post("b", "u2", true),
        visible_post("c", "u2", false),
    ];
    let second_context = query_context([("c", Value::String(token))]);
    let second = execute_seeded(
        &hidden_schema,
        &revoked,
        &hidden_program,
        second_context.clone(),
    );
    assert!(row_ids(Some(&second.result)).is_empty());
    assert!(
        second
            .trace
            .ranges
            .iter()
            .any(|r| r.examined_ids.iter().any(|id| id == "c"))
    );
    cases.push(case_from_parts(
        "merge-revocation-between-pages",
        "merge",
        hidden_schema,
        hidden_program,
        second_context,
        second.receipt,
        vec![],
        None,
        None,
    ));
}

fn add_review_merge_cases(cases: &mut Vec<CorpusCase>) {
    let schema = merge_schema();
    let mut page = merge_program(
        "merge.review",
        "merge.review",
        ["u1", "u2"]
            .into_iter()
            .enumerate()
            .map(|(i, author)| {
                lane_scan(
                    &format!("merge.review.{i}"),
                    literal_id(author),
                    2,
                    None,
                    "merge.review",
                )
            })
            .collect(),
        2,
    );
    page.args
        .insert("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)));
    let Stmt::Return(Expr::Merge(merge)) = &mut page.body[0] else {
        unreachable!()
    };
    for lane in &mut merge.lanes {
        lane.scan.after = Some(Box::new(var("c")));
        lane.scan.opaque_cursor = true;
    }
    let rows: Vec<_> = (0..6)
        .map(|n| post(&format!("p{n}"), if n % 2 == 0 { "u1" } else { "u2" }, n))
        .collect();
    let context = cursor_context(Value::Null);
    let first = execute_seeded(&schema, &rows, &page, context.clone());
    assert!(first.next.is_some());
    let delete = |id_value: &str| PreludeStep {
        program: Program {
            name: "remove".into(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::new(),
            read_time_granularity_ms: None,
            body: vec![Stmt::Delete {
                table: "posts".into(),
                key: literal_id(id_value),
            }],
        },
        context: mutation_context([], Vec::<String>::new()),
        expected_state: "predicted".into(),
    };
    let deleted = case_from_parts(
        "merge-multilane-local-deletion",
        "merge",
        schema.clone(),
        page.clone(),
        context.clone(),
        first.receipt,
        vec![delete("p0")],
        None,
        None,
    );
    assert_eq!(deleted.expected.local_state, "fresh");
    assert_eq!(
        row_ids(deleted.expected.local_result.as_ref()),
        ["p1", "p2"]
    );
    assert!(deleted.expected.next.is_some());
    cases.push(deleted);

    // Global local-pagination rule: a plain scan, with two covered deletions,
    // still has a nonempty capped result but may no longer mint a continuation.
    let scan = opaque_cursor_program("local.partial", Order::Asc, 2);
    let mut first = execute_seeded(&schema, &rows, &scan, context.clone());
    // Later rows are held from another page, but its range was not retained.
    // Enough rows remain to mint a cursor internally after the two deletions.
    for (table, row) in &rows[3..] {
        first.receipt.rows.push(RowRecord {
            table: (*table).into(),
            id: row.field("id").unwrap().as_str().unwrap().into(),
            row: row.clone(),
        });
    }
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&scan)
        .unwrap();
    let mut client = ClientStore::hydrate(schema.clone(), &first.receipt).unwrap();
    for id_value in ["p0", "p1"] {
        let step = delete(id_value);
        let cert = Checker::new(&schema, Ceilings::default())
            .check(&step.program)
            .unwrap();
        client
            .apply_mutation(&step.program, &cert, step.context)
            .unwrap();
    }
    let (state, replay) = client
        .reexecute(&scan, &certificate, context.clone())
        .unwrap();
    assert!(matches!(state, LocalState::Partial(_)));
    assert_eq!(row_ids(Some(&replay.result)), ["p2", "p3"]);
    assert_eq!(replay.state, ExecutionState::Capped);
    assert_eq!(replay.next, None);
    let partial = case_from_parts(
        "local-pagination-partial-clears-next",
        "scenario",
        schema.clone(),
        scan,
        context.clone(),
        first.receipt,
        vec![delete("p0"), delete("p1")],
        None,
        None,
    );
    assert_eq!(partial.expected.local_state, "partial");
    assert_eq!(partial.expected.next, None);
    cases.push(partial);

    let mut argument = page.clone();
    argument.args.insert("n".into(), ArgType::Int);
    let Stmt::Return(Expr::Merge(merge)) = &mut argument.body[0] else {
        unreachable!()
    };
    for lane in &mut merge.lanes {
        lane.scan.take = Bound::Arg {
            name: "n".into(),
            max: 20,
        };
    }
    for (n, state) in [(2, ExecutionState::Capped), (3, ExecutionState::Complete)] {
        let mut context = context.clone();
        context.args.insert("n".into(), Value::Int(n));
        let case = frozen_query(
            &format!("merge-argument-take-{n}"),
            schema.clone(),
            rows[..3].to_vec(),
            argument.clone(),
            context,
            state,
        );
        assert_eq!(
            row_ids(case.expected.local_result.as_ref()).len(),
            n as usize
        );
        assert_eq!(case.expected.next.is_some(), n == 2);
        cases.push(case);
    }

    let mut repeated = for_lane_limit_case(schema.clone()).program;
    repeated
        .args
        .insert("c".into(), ArgType::Optional(Box::new(ArgType::Cursor)));
    let Stmt::Return(Expr::Merge(merge)) = &mut repeated.body[0] else {
        unreachable!()
    };
    let lane = &mut merge.lanes[0];
    lane.source.as_mut().unwrap().take = Bound::Literal(500);
    lane.scan.take = Bound::Literal(20);
    lane.scan.after = Some(Box::new(var("c")));
    lane.scan.opaque_cursor = true;
    let authors = ["u1", "u2", "u3"];
    let mut rows = Vec::new();
    for n in 0..500 {
        rows.push((
            "follows",
            row([
                ("id", id(&format!("f{n:03}"))),
                ("follower", id("u1")),
                ("followed", id(authors[n % 3])),
                ("at", Value::Int(n as i64)),
            ]),
        ));
    }
    for n in 0..90 {
        rows.push(post(&format!("p{n:03}"), authors[n % 3], n as i64));
    }
    let mut context = context;
    for page in 0..2 {
        let execution = execute_seeded(&schema, &rows, &repeated, context.clone());
        assert_eq!(execution.trace.examined, 500 + 3 + 22);
        assert_eq!(
            execution
                .trace
                .ranges
                .iter()
                .filter(|r| r.table == "posts")
                .count(),
            3
        );
        let expected: Vec<_> = (page * 20..page * 20 + 20)
            .map(|n| format!("p{n:03}"))
            .collect();
        assert_eq!(row_ids(Some(&execution.result)), expected);
        let next = execution.next.clone().unwrap();
        let case = case_from_parts(
            &format!("merge-500-prefixes-three-authors-page-{}", page + 1),
            "merge",
            schema.clone(),
            repeated.clone(),
            context.clone(),
            execution.receipt,
            vec![],
            None,
            None,
        );
        assert_eq!(row_ids(case.expected.local_result.as_ref()), expected);
        cases.push(case);
        context.args.insert("c".into(), Value::String(next));
    }
}
