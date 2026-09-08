//! A nullable point-read shape preserves a non-uniform page's capped state.
use super::*;
use snapback2_core::ir::IndexKeyExpr;

pub(super) fn add_enriched_page_case(cases: &mut Vec<CorpusCase>) {
    add_conditional_page_cases(cases);
    let mut items = table(
        [
            ("group", ColumnType::Id),
            ("owner", ColumnType::Principal),
            ("at", ColumnType::Time),
        ],
        [("byGroup", vec!["group", "at", "id"], false)],
    );
    items.rules.read = RuleExpr::Exists {
        table: "shares".to_owned(),
        index: "byItemViewer".to_owned(),
        key: vec![RuleTerm::Field("id".to_owned()), RuleTerm::Viewer],
        provenance: KeyProvenance::Shape,
    };
    let mut profiles = table([("name", ColumnType::Text { max: 20 })], []);
    profiles.rules.read = RuleExpr::Eq(RuleTerm::Field("id".to_owned()), RuleTerm::Viewer);
    let schema = Schema {
        tables: BTreeMap::from([
            ("items".to_owned(), items),
            ("profiles".to_owned(), profiles),
            (
                "shares".to_owned(),
                table(
                    [("item", ColumnType::Id), ("viewer", ColumnType::Principal)],
                    [("byItemViewer", vec!["item", "viewer"], true)],
                ),
            ),
        ]),
        ..Schema::default()
    };
    let program = Program {
        name: "items.enriched".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "rows".to_owned(),
                value: Expr::Array(Vec::new()),
            },
            Stmt::For {
                binding: "item".to_owned(),
                domain: LoopDomain::Page(Scan {
                    site: "items.page".to_owned(),
                    table: "items".to_owned(),
                    index: "byGroup".to_owned(),
                    prefix: (vec![lit(id("g1"))])
                        .into_iter()
                        .map(IndexKeyExpr::Scalar)
                        .collect(),
                    order: Order::Asc,
                    take: Bound::Literal(50),
                    after: None,
                    before: None,
                    range: None,
                    opaque_cursor: false,
                    merge_site: None,
                    // Fixed corpus prefix; the engine regression also covers Arg provenance.
                    provenance: KeyProvenance::Const,
                }),
                body: vec![
                    Stmt::Const {
                        name: "profile".to_owned(),
                        value: Expr::Get(Read {
                            site: "profiles.byId".to_owned(),
                            table: "profiles".to_owned(),
                            index: "byId".to_owned(),
                            key: vec![field(var("item"), "owner")],
                            provenance: KeyProvenance::Shape,
                        }),
                    },
                    Stmt::Let {
                        name: "shape".to_owned(),
                        value: lit(Value::Null),
                    },
                    Stmt::If {
                        condition: Expr::Binary {
                            op: BinaryOp::Ne,
                            left: Box::new(var("profile")),
                            right: Box::new(lit(Value::Null)),
                        },
                        then_body: vec![Stmt::Assign {
                            name: "shape".to_owned(),
                            value: Expr::Object(BTreeMap::from([(
                                "name".to_owned(),
                                field(var("profile"), "name"),
                            )])),
                        }],
                        else_body: Vec::new(),
                    },
                    Stmt::Push {
                        target: "rows".to_owned(),
                        value: Expr::Object(BTreeMap::from([
                            ("id".to_owned(), field(var("item"), "id")),
                            ("owner".to_owned(), var("shape")),
                        ])),
                    },
                ],
            },
            Stmt::Return(var("rows")),
        ],
    };
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for (item, owner, at) in [("i1", "u1", 1), ("i2", "u2", 2), ("i3", "u1", 3)] {
        engine
            .seed(
                "items",
                row([
                    ("id", id(item)),
                    ("group", id("g1")),
                    ("owner", id(owner)),
                    ("at", Value::Int(at)),
                ]),
            )
            .unwrap();
        if item != "i3" {
            engine
                .seed(
                    "shares",
                    row([
                        ("id", id(&format!("s-{item}"))),
                        ("item", id(item)),
                        ("viewer", id("u1")),
                    ]),
                )
                .unwrap();
        }
    }
    for (owner, name) in [("u1", "Visible"), ("u2", "Secret")] {
        engine
            .seed("profiles", row([("id", id(owner)), ("name", text(name))]))
            .unwrap();
    }
    let context = query_context([]);
    let execution = authoritative(&mut engine, &schema, &program, context.clone());
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(
        execution.result,
        Value::Array(vec![
            row([
                ("id", id("i1")),
                ("owner", row([("name", text("Visible"))]))
            ]),
            row([("id", id("i2")), ("owner", Value::Null)]),
        ])
    );
    assert!(
        execution
            .trace
            .points
            .iter()
            .any(|point| point.table == "profiles"
                && point.key == vec![id("u2")]
                && !point.visible)
    );
    let receipt = serde_json::to_value(&execution.receipt).unwrap();
    for set in ["rows", "ranges", "absences", "verdicts"] {
        for record in receipt[set].as_array().unwrap() {
            let mut keys = record.clone();
            if set == "rows" {
                keys.as_object_mut().unwrap().remove("row");
            }
            assert!(!keys.to_string().contains("\"u2\""), "{set}: {keys}");
        }
    }
    assert!(!receipt.to_string().contains("Secret"));
    assert!(
        !serde_json::to_string(&execution.result)
            .unwrap()
            .contains("Secret")
    );
    let mut conditional = program.clone();
    conditional.args = BTreeMap::from([
        ("global".into(), ArgType::Bool),
        ("c".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
    ]);
    let Stmt::For {
        domain: LoopDomain::Page(scan),
        ..
    } = &mut conditional.body[1]
    else {
        unreachable!()
    };
    scan.opaque_cursor = true;
    scan.after = Some(Box::new(var("c")));
    conditional.body = vec![Stmt::If {
        condition: var("global"),
        then_body: conditional.body,
        else_body: vec![Stmt::Return(Expr::Array(vec![]))],
    }];
    let mut page_context = query_context([("global", Value::Bool(true)), ("c", Value::Null)]);
    for page in 1..=2 {
        let served = authoritative(&mut engine, &schema, &conditional, page_context.clone());
        assert_eq!(served.state, ExecutionState::Capped);
        if page == 1 {
            assert_eq!(served.result, execution.result);
            let token = served.next.as_ref().unwrap();
            let position = snapback2_core::cursor::decode_cursor(&schema, token).unwrap();
            assert_eq!(
                position.values.last(),
                Some(&id("i2")),
                "hidden i3 is never a cursor anchor"
            );
        } else {
            assert_eq!(served.result, Value::Array(vec![]));
            assert_eq!(served.next, None);
        }
        let case = case_from_parts(
            &format!("conditional-enriched-hidden-page-{page}"),
            "scenario",
            schema.clone(),
            conditional.clone(),
            page_context.clone(),
            served.receipt,
            vec![],
            None,
            None,
        );
        assert_eq!(
            case.expected.next, None,
            "incomplete local authorization cannot mint a cursor"
        );
        cases.push(case);
        let mut composite = conditional.clone();
        let Stmt::If { then_body, .. } = &mut composite.body[0] else {
            unreachable!()
        };
        *then_body.last_mut().unwrap() = Stmt::Return(Expr::Object(BTreeMap::from([(
            "messages".into(),
            var("rows"),
        )])));
        let wrapped = authoritative(&mut engine, &schema, &composite, page_context.clone());
        assert_eq!(wrapped.result.field("messages").unwrap(), &served.result);
        assert_eq!(
            wrapped.next, served.next,
            "wrapping cannot expose an examined position"
        );
        let case = case_from_parts(
            &format!("composite-hidden-page-{page}"),
            "scenario",
            schema.clone(),
            composite,
            page_context.clone(),
            wrapped.receipt,
            vec![],
            None,
            None,
        );
        assert_eq!(
            case.expected.next, None,
            "partial composite cannot mint a cursor"
        );
        cases.push(case);
        page_context.args.insert(
            "c".into(),
            served.next.map(Value::String).unwrap_or(Value::Null),
        );
    }
    let case = case_from_parts(
        "enriched-capped-page-hidden-point-null",
        "scenario",
        schema,
        program,
        context,
        execution.receipt,
        Vec::new(),
        None,
        None,
    );
    // Opaque capped ranges and hidden points carry no complete coverage claims.
    // The local coverage state is partial; the query's read state remains capped.
    assert_eq!(case.expected.local_state, "partial");
    assert_eq!(case.expected.local_result, Some(execution.result));
    cases.push(case);
}

fn table<const N: usize, const M: usize>(
    columns: [(&str, ColumnType); N],
    indexes: [(&str, Vec<&str>, bool); M],
) -> Table {
    public_table(
        columns
            .into_iter()
            .map(|(name, kind)| (name.to_owned(), kind))
            .chain([("id".to_owned(), ColumnType::Id)])
            .collect(),
        indexes
            .into_iter()
            .chain([("byId", vec!["id"], true)])
            .map(|(name, columns, unique)| {
                (
                    name.to_owned(),
                    Index {
                        components: (columns.into_iter().map(str::to_owned).collect::<Vec<_>>())
                            .into_iter()
                            .map(snapback2_core::search_key::IndexComponent::Column)
                            .collect(),
                        unique,
                    },
                )
            })
            .collect(),
    )
}

// @ref LLP 1011#b1-opaque-cursors — both engines use the selected return's
// certified origin, including branch aliases, shapes and an auxiliary page.
fn add_conditional_page_cases(cases: &mut Vec<CorpusCase>) {
    let schema = Schema {
        tables: BTreeMap::from([
            (
                "posts".into(),
                table(
                    [
                        ("author", ColumnType::Principal),
                        ("at", ColumnType::Time),
                        ("body", ColumnType::Text { max: 20 }),
                    ],
                    [
                        ("byAt", vec!["at", "id"], false),
                        ("byAuthorAt", vec!["author", "at", "id"], false),
                    ],
                ),
            ),
            (
                "follows".into(),
                table(
                    [
                        ("follower", ColumnType::Principal),
                        ("followed", ColumnType::Principal),
                    ],
                    [("byFollower", vec!["follower", "id"], false)],
                ),
            ),
        ]),
        ..Schema::default()
    };
    let range = Scan {
        site: "feed.global".into(),
        table: "posts".into(),
        index: "byAt".into(),
        prefix: (vec![]).into_iter().map(IndexKeyExpr::Scalar).collect(),
        order: Order::Desc,
        take: Bound::Literal(20),
        after: Some(Box::new(var("position"))),
        before: None,
        range: None,
        opaque_cursor: true,
        merge_site: None,
        provenance: KeyProvenance::Const,
    };
    let merge = Merge {
        held_search: None,
        site: "feed.following".into(),
        lanes: vec![MergeLane {
            source: Some(Scan {
                site: "feed.follows".into(),
                table: "follows".into(),
                index: "byFollower".into(),
                prefix: (vec![lit(id("u1"))])
                    .into_iter()
                    .map(IndexKeyExpr::Scalar)
                    .collect(),
                order: Order::Asc,
                take: Bound::Literal(500),
                after: None,
                before: None,
                range: None,
                opaque_cursor: false,
                merge_site: None,
                provenance: KeyProvenance::Const,
            }),
            binding: "follow".into(),
            setup: vec![],
            scan: Scan {
                site: "feed.following.lane".into(),
                index: "byAuthorAt".into(),
                prefix: (vec![field(var("follow"), "followed")])
                    .into_iter()
                    .map(IndexKeyExpr::Scalar)
                    .collect(),
                merge_site: Some("feed.following".into()),
                provenance: KeyProvenance::Shape,
                ..range.clone()
            },
        }],
    };
    let shaped = |page| {
        vec![
            Stmt::Const {
                name: "page".into(),
                value: page,
            },
            Stmt::Const {
                name: "alias".into(),
                value: var("page"),
            },
            Stmt::Let {
                name: "rows".into(),
                value: Expr::Array(vec![]),
            },
            Stmt::For {
                binding: "item".into(),
                domain: LoopDomain::DerivedArray {
                    value: var("alias"),
                    max: 20,
                    bound_source: "page".into(),
                },
                body: vec![Stmt::Push {
                    target: "rows".into(),
                    value: Expr::Object(BTreeMap::from([(
                        "body".into(),
                        field(var("item"), "body"),
                    )])),
                }],
            },
            Stmt::Return(var("rows")),
        ]
    };
    let program = Program {
        name: "feed.conditional".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([
            ("global".into(), ArgType::Bool),
            ("c".into(), ArgType::Optional(Box::new(ArgType::Cursor))),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Const {
                name: "position".into(),
                value: var("c"),
            },
            Stmt::If {
                condition: var("global"),
                then_body: shaped(Expr::Scan(range.clone())),
                else_body: shaped(Expr::Merge(merge)),
            },
        ],
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.result_pages.len(), 2);
    let mut engine = Engine::memory(schema.clone()).unwrap();
    for n in 0..47 {
        engine
            .seed(
                "posts",
                row([
                    ("id", id(&format!("p{n}"))),
                    ("author", id(if n < 43 { "u2" } else { "u3" })),
                    ("at", Value::Int(n)),
                    ("body", text(&format!("entry-{n}"))),
                ]),
            )
            .unwrap();
    }
    engine
        .seed(
            "follows",
            row([
                ("id", id("f1")),
                ("follower", id("u1")),
                ("followed", id("u2")),
            ]),
        )
        .unwrap();
    add_composite_page_cases(cases, &schema, &mut engine, &program, &range);
    let mut tokens = Vec::new();
    for global in [true, false] {
        let mut context = query_context([("global", Value::Bool(global)), ("c", Value::Null)]);
        for page in 0..3 {
            let execution = authoritative(&mut engine, &schema, &program, context.clone());
            let total = if global { 47 } else { 43 };
            let expected = (page * 20..std::cmp::min((page + 1) * 20, total))
                .map(|n| row([("body", text(&format!("entry-{}", total - 1 - n)))]))
                .collect::<Vec<_>>();
            assert_eq!(execution.result, Value::Array(expected));
            assert_eq!(
                execution.state,
                if page < 2 {
                    ExecutionState::Capped
                } else {
                    ExecutionState::Complete
                }
            );
            assert_eq!(execution.next.is_some(), page < 2);
            let case = case_from_parts(
                &format!(
                    "conditional-{}-page-{}",
                    if global { "range" } else { "merge" },
                    page + 1
                ),
                "scenario",
                schema.clone(),
                program.clone(),
                context.clone(),
                execution.receipt.clone(),
                vec![],
                None,
                None,
            );
            assert_eq!(case.expected.local_result, Some(execution.result.clone()));
            assert_eq!(case.expected.next, execution.next);
            cases.push(case);
            if page == 0 {
                tokens.push(execution.next.clone().unwrap());
                let deletion = case_from_parts(
                    &format!(
                        "conditional-{}-partial-clears-next",
                        if global { "range" } else { "merge" }
                    ),
                    "scenario",
                    schema.clone(),
                    program.clone(),
                    context.clone(),
                    execution.receipt,
                    (0..3)
                        .map(|offset| PreludeStep {
                            program: Program {
                                name: "remove".into(),
                                kind: ProgramKind::Mutation,
                                args: BTreeMap::new(),
                                read_time_granularity_ms: None,
                                body: vec![Stmt::Delete {
                                    table: "posts".into(),
                                    key: lit(id(&format!("p{}", total - 1 - offset))),
                                }],
                            },
                            context: mutation_context([], Vec::<String>::new()),
                            expected_state: "predicted".into(),
                        })
                        .collect(),
                    None,
                    None,
                );
                assert_eq!(deletion.expected.local_state, "partial");
                assert_eq!(deletion.expected.next, None);
                cases.push(deletion);
            }
            context.args.insert(
                "c".into(),
                execution.next.map(Value::String).unwrap_or(Value::Null),
            );
        }
    }
    for (name, global, token) in [
        ("range-token-in-merge", false, tokens[0].clone()),
        ("merge-token-in-range", true, tokens[1].clone()),
        ("noncanonical-token", true, format!("{}=", tokens[0])),
    ] {
        let context = query_context([("global", Value::Bool(global)), ("c", Value::String(token))]);
        assert!(matches!(
            engine.execute(&program, &certificate, context.clone()),
            Err(RuntimeError::Input(_))
        ));
        let case = case_from_parts(
            &format!("conditional-{name}"),
            "scenario",
            schema.clone(),
            program.clone(),
            context,
            ClosureReceipt::default(),
            vec![],
            None,
            None,
        );
        assert_eq!(case.expected.error_code.as_deref(), Some("E_INPUT"));
        cases.push(case);
    }
    // Evaluate an auxiliary page after the returned page. A trace-order guess
    // would mint from the auxiliary row and skip the rest of the real page.
    let mut auxiliary = program.clone();
    let Stmt::If { then_body, .. } = &mut auxiliary.body[1] else {
        unreachable!()
    };
    let mut aux_scan = range.clone();
    aux_scan.site = "feed.auxiliary".into();
    aux_scan.take = Bound::Literal(1);
    then_body.insert(
        1,
        Stmt::Const {
            name: "auxiliary".into(),
            value: Expr::Scan(aux_scan),
        },
    );
    let context = query_context([("global", Value::Bool(true)), ("c", Value::Null)]);
    let execution = authoritative(&mut engine, &schema, &auxiliary, context.clone());
    assert_eq!(execution.next, Some(tokens[0].clone()));
    cases.push(case_from_parts(
        "conditional-auxiliary-page-is-not-result",
        "scenario",
        schema.clone(),
        auxiliary,
        context,
        execution.receipt,
        vec![],
        None,
        None,
    ));
}

// Shared native/evaluator/twin witness: one atomic object carries one page's
// cursor even when the count and fixed preview execute after that page.
fn add_composite_page_cases(
    cases: &mut Vec<CorpusCase>,
    schema: &Schema,
    engine: &mut Engine,
    original: &Program,
    range: &Scan,
) {
    let object = |fields: Vec<(&str, Expr)>| {
        Expr::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
    };
    let mut program = original.clone();
    program.name = "feed.composite".into();
    let Stmt::If {
        then_body,
        else_body,
        ..
    } = &mut program.body[1]
    else {
        unreachable!()
    };
    for (arm, body) in [("range", then_body), ("merge", else_body)] {
        body.pop();
        body.extend([
            Stmt::Let {
                name: "view".into(),
                value: object(vec![("nested", object(vec![("entries", var("rows"))]))]),
            },
            Stmt::Const {
                name: "snapshot".into(),
                value: var("view"),
            },
            Stmt::Assign {
                name: "view".into(),
                value: object(vec![(
                    "nested",
                    object(vec![("entries", Expr::Array(vec![]))]),
                )]),
            },
            Stmt::Const {
                name: "count".into(),
                value: Expr::Builtin {
                    builtin: Builtin::Len,
                    args: vec![Expr::Scan(Scan {
                        site: format!("feed.composite.{arm}.count"),
                        take: Bound::Literal(50),
                        after: None,
                        opaque_cursor: false,
                        ..range.clone()
                    })],
                },
            },
            Stmt::Const {
                name: "preview".into(),
                value: Expr::Scan(Scan {
                    site: format!("feed.composite.{arm}.preview"),
                    take: Bound::Literal(1),
                    after: None,
                    opaque_cursor: false,
                    ..range.clone()
                }),
            },
            Stmt::Return(object(vec![
                (
                    "messages",
                    field(field(var("snapshot"), "nested"), "entries"),
                ),
                ("page", var("rows")),
                ("count", var("count")),
                ("preview", var("preview")),
            ])),
        ]);
    }
    let certificate = Checker::new(schema, Ceilings::default())
        .check(&program)
        .unwrap();
    assert_eq!(certificate.result_pages.len(), 2);
    assert_eq!(
        snapback2_core::certificate::resumable_log_cursor(&program, &certificate),
        Err("cursor-binding")
    );
    for global in [true, false] {
        let total = if global { 47 } else { 43 };
        let mut context = query_context([("global", Value::Bool(global)), ("c", Value::Null)]);
        let mut previous = None;
        for page in 0..4 {
            let execution = authoritative(engine, schema, &program, context.clone());
            let rows = Value::Array(
                (page * 20..std::cmp::min((page + 1) * 20, total))
                    .map(|n| row([("body", text(&format!("entry-{}", total - 1 - n)))]))
                    .collect(),
            );
            assert_eq!(execution.result.field("messages").unwrap(), &rows);
            assert_eq!(execution.result.field("page").unwrap(), &rows);
            assert_eq!(execution.result.field("count").unwrap(), &Value::Int(47));
            let preview = execution
                .result
                .field("preview")
                .unwrap()
                .as_array()
                .unwrap();
            assert_eq!(preview.len(), 1);
            assert_eq!(preview[0].field("id").unwrap(), &id("p46"));
            assert_eq!(
                execution.state,
                ExecutionState::Capped,
                "the fixed preview stays capped"
            );
            assert_eq!(execution.next.is_some(), page < 3);
            if let Some(token) = &execution.next {
                assert_ne!(
                    Some(token),
                    previous.as_ref(),
                    "continuation must make progress"
                );
                let position = snapback2_core::cursor::decode_cursor(schema, token).unwrap();
                assert_eq!(
                    position.values.last(),
                    Some(&id(&format!("p{}", (total - (page + 1) * 20).max(0))))
                );
            }
            let case = case_from_parts(
                &format!(
                    "composite-{}-page-{}",
                    if global { "range" } else { "merge" },
                    page + 1
                ),
                "scenario",
                schema.clone(),
                program.clone(),
                context.clone(),
                execution.receipt,
                vec![],
                None,
                None,
            );
            assert_eq!(case.expected.local_result, Some(execution.result));
            assert_eq!(case.expected.next, execution.next);
            cases.push(case);
            previous = execution.next.clone();
            context.args.insert(
                "c".into(),
                execution.next.map(Value::String).unwrap_or(Value::Null),
            );
        }
    }
    for return_mutated in [false, true] {
        let mut pushed = program.clone();
        let Stmt::If {
            then_body,
            else_body,
            ..
        } = &mut pushed.body[1]
        else {
            unreachable!()
        };
        for body in [then_body, else_body] {
            let Stmt::Return(Expr::Object(mut fields)) = body.pop().unwrap() else {
                unreachable!()
            };
            fields.remove("page");
            if return_mutated {
                fields.insert("messages".into(), var("extracted"));
            }
            body.extend([
                Stmt::Let {
                    name: "extracted".into(),
                    value: field(field(var("snapshot"), "nested"), "entries"),
                },
                Stmt::Push {
                    target: "extracted".into(),
                    value: lit(row([("body", text("appended"))])),
                },
                Stmt::Return(Expr::Object(fields)),
            ]);
        }
        let certificate = Checker::new(schema, Ceilings::default())
            .check(&pushed)
            .unwrap();
        assert_eq!(certificate.result_pages.is_empty(), return_mutated);
        let context = query_context([("global", Value::Bool(true)), ("c", Value::Null)]);
        let execution = authoritative(engine, schema, &pushed, context.clone());
        assert_eq!(
            execution
                .result
                .field("messages")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            if return_mutated { 21 } else { 20 }
        );
        assert_eq!(execution.next.is_none(), return_mutated);
        cases.push(case_from_parts(
            if return_mutated {
                "composite-pushed-page-no-next"
            } else {
                "composite-copied-page-survives-push"
            },
            "scenario",
            schema.clone(),
            pushed,
            context,
            execution.receipt,
            vec![],
            None,
            None,
        ));
    }
    let mut ambiguous = program.clone();
    let Stmt::If {
        then_body,
        else_body,
        ..
    } = &mut ambiguous.body[1]
    else {
        unreachable!()
    };
    for (arm, body) in [("range", then_body), ("merge", else_body)] {
        let Stmt::Return(Expr::Object(fields)) = body.last_mut().unwrap() else {
            unreachable!()
        };
        fields.insert(
            "other".into(),
            Expr::Scan(Scan {
                site: format!("feed.composite.{arm}.other"),
                take: Bound::Literal(1),
                ..range.clone()
            }),
        );
    }
    let certificate = Checker::new(schema, Ceilings::default())
        .check(&ambiguous)
        .unwrap();
    assert!(certificate.result_pages.is_empty());
    let context = query_context([("global", Value::Bool(true)), ("c", Value::Null)]);
    let execution = authoritative(engine, schema, &ambiguous, context.clone());
    assert_eq!(execution.state, ExecutionState::Capped);
    assert_eq!(execution.next, None);
    cases.push(case_from_parts(
        "composite-ambiguous-pages-no-next",
        "scenario",
        schema.clone(),
        ambiguous,
        context,
        execution.receipt,
        vec![],
        None,
        None,
    ));
}
