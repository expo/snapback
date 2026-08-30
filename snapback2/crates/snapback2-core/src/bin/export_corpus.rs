use serde::Serialize;
use serde_json::json;
use snapback2_core::engine::{ClosureReceipt, RowRecord};
use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::PathBuf;

const CORPUS_VERSION: u32 = 1;
const RANDOM_SEED: u64 = 0x5eed_0329_0140_0003;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CorpusCase {
    corpus_version: u32,
    name: String,
    category: String,
    random_seed: Option<u64>,
    schema: Schema,
    program: Program,
    context: Context,
    receipt: ClosureReceipt,
    prelude: Vec<PreludeStep>,
    replacement_receipt: Option<ClosureReceipt>,
    expected: Expected,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreludeStep {
    program: Program,
    context: Context,
    expected_state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Expected {
    local_result: Option<Value>,
    error_code: Option<String>,
    local_state: String,
    partial_sites: Vec<String>,
    canonical_result: String,
    digest: String,
    range_stops: BTreeMap<String, Vec<String>>,
    evicted_rows: Option<usize>,
}

struct Fixture {
    schema: Schema,
    engine: Engine,
}

impl Fixture {
    fn new() -> Self {
        let schema = spike_schema();
        let mut engine = Engine::memory(schema.clone()).expect("fixture engine");
        for (table, value) in fixture_rows() {
            engine.seed(table, value).expect("fixture row");
        }
        Self { schema, engine }
    }

    fn snapshot(&self) -> ClosureReceipt {
        let mut rows = Vec::new();
        for table in self.schema.tables.keys() {
            if table == "entitlements" {
                continue;
            }
            for row in self.engine.rows(table).expect("snapshot rows") {
                rows.push(RowRecord {
                    table: table.clone(),
                    id: row
                        .field("id")
                        .and_then(Value::as_str)
                        .expect("row id")
                        .to_owned(),
                    row,
                });
            }
        }
        ClosureReceipt {
            rows,
            ranges: Vec::new(),
            absences: Vec::new(),
            verdicts: Vec::new(),
        }
    }
}

fn main() {
    let mut cases = Vec::new();
    add_named_cases(&mut cases);
    add_client_scenarios(&mut cases);
    add_value_edges(&mut cases);
    add_random_cases(&mut cases);
    assert!(cases.len() >= 60, "brief requires at least 60 corpus cases");

    let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../corpus");
    fs::create_dir_all(&output).expect("create corpus directory");
    for entry in fs::read_dir(&output).expect("read corpus directory") {
        let path = entry.expect("corpus entry").path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            fs::remove_file(path).expect("remove stale generated corpus file");
        }
    }
    for case in &cases {
        let path = output.join(format!("{}.json", case.name));
        let encoded = serde_json::to_string_pretty(case).expect("serialize corpus case");
        fs::write(path, format!("{encoded}\n")).expect("write corpus case");
    }
    let manifest = serde_json::to_string(&cases).expect("serialize corpus manifest");
    fs::write(output.join("manifest.json"), format!("{manifest}\n"))
        .expect("write corpus manifest");
    println!("wrote {} frozen corpus cases", cases.len());
}

fn add_named_cases(cases: &mut Vec<CorpusCase>) {
    for (name, program, context) in [
        (
            "named-thread",
            thread_program(3),
            query_context([("conversationId", id("c1"))]),
        ),
        (
            "named-inbox-count-capped",
            inbox_program(false),
            query_context([]),
        ),
        (
            "named-inbox-maintained",
            inbox_program(true),
            query_context([]),
        ),
        (
            "named-board-view",
            board_view_program(),
            query_context([("boardId", id("board1"))]),
        ),
        (
            "named-board-summary",
            board_summary_program(),
            query_context([("boardId", id("board1"))]),
        ),
        (
            "named-ledger",
            ledger_program(),
            query_context([("groupId", id("g1"))]),
        ),
        (
            "named-ancestors",
            ancestors_program(),
            query_context([("accountId", id("a2"))]),
        ),
        (
            "named-mention-scan",
            mention_scan_program(),
            query_context([("handle", text("bob"))]),
        ),
        (
            "named-helper-wrapped-scan",
            helper_wrapped_scan_program(),
            query_context([("columnId", id("col1"))]),
        ),
        (
            "named-maintained-waitlist",
            maintained_waitlist_count_program(),
            query_context([("resourceId", id("resource1"))]),
        ),
        (
            "named-hidden-rule",
            hidden_rule_program(),
            query_context([("id", id("doc1"))]),
        ),
    ] {
        cases.push(query_case(name, "named", program, context));
    }

    for (name, program, context) in [
        (
            "named-send",
            send_program(false),
            mutation_context(
                [
                    ("conversationId", id("c1")),
                    ("body", text("hello")),
                    ("at", Value::Int(20)),
                ],
                ["named-message"],
            ),
        ),
        (
            "named-send-maintained-unread",
            send_program(true),
            mutation_context(
                [
                    ("conversationId", id("c1")),
                    ("body", text("hello all")),
                    ("at", Value::Int(21)),
                ],
                ["named-unread-message"],
            ),
        ),
        (
            "named-mark-read",
            mark_read_program(),
            mutation_context(
                [("membershipId", id("m1")), ("at", Value::Int(20))],
                Vec::<String>::new(),
            ),
        ),
        (
            "named-start-dm",
            start_dm_program(),
            mutation_context(
                [("lo", id("u1")), ("hi", id("u2"))],
                ["dm-conversation", "dm-key", "dm-lo", "dm-hi"],
            ),
        ),
        (
            "named-add-expense",
            add_expense_program(),
            mutation_context(
                [
                    ("groupId", id("g1")),
                    ("amount", Value::Int(5)),
                    ("recipients", Value::Array(vec![id("u2"), id("u1")])),
                ],
                ["expense-new", "share-u2", "share-u1"],
            ),
        ),
        (
            "named-delete-message",
            delete_message_program(),
            mutation_context([("id", id("message-00004"))], Vec::<String>::new()),
        ),
    ] {
        cases.push(mutation_case(name, "named", program, context));
    }
    cases.push(named_emit_case());
}

// @ref LLP 1001#8-emit-and-the-outbox — the frozen twin case pins the no-op/one-id replay contract after a durable insert.
fn named_emit_case() -> CorpusCase {
    let public = RuleExpr::Public {
        reason: "emit corpus fixture".to_owned(),
    };
    let schema = Schema {
        tables: BTreeMap::from([(
            "events".to_owned(),
            Table {
                columns: BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("body".to_owned(), ColumnType::Text { max: 64 }),
                ]),
                indexes: BTreeMap::from([(
                    "byId".to_owned(),
                    Index {
                        columns: vec!["id".to_owned()],
                        unique: true,
                    },
                )]),
                rules: Rules {
                    read: public.clone(),
                    insert: public.clone(),
                    update: public.clone(),
                    delete: public,
                },
                constraints: Vec::new(),
            },
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: vec!["notifications.notify".to_owned()],
    };
    let event = |id: &str| {
        Expr::Object(BTreeMap::from([
            ("id".to_owned(), Expr::Variable(id.to_owned())),
            ("body".to_owned(), Expr::Variable("body".to_owned())),
        ]))
    };
    let program = Program {
        name: "emitAfterInsert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("body".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Const {
                name: "firstId".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "events".to_owned(),
                row: event("firstId"),
            },
            Stmt::Emit {
                effect: "notifications.notify".to_owned(),
                payload: Expr::Variable("firstId".to_owned()),
            },
            Stmt::Const {
                name: "secondId".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "events".to_owned(),
                row: event("secondId"),
            },
            Stmt::Return(Expr::Array(vec![
                Expr::Variable("firstId".to_owned()),
                Expr::Variable("secondId".to_owned()),
            ])),
        ],
    };
    let context = mutation_context(
        [("body", text("hello with effect"))],
        [
            "named-emit-message",
            "named-emit-outbox",
            "named-emit-followup",
        ],
    );
    let mut server = Engine::memory(schema.clone()).expect("emit fixture engine");
    let execution = authoritative(&mut server, &schema, &program, context.clone());
    assert_eq!(execution.trace.emits.len(), 1);
    assert_eq!(execution.trace.emits[0].id, "named-emit-outbox");
    let case = case_from_parts(
        "named-emit",
        "named",
        schema,
        program,
        context,
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.local_result.as_ref(), Some(&execution.result));
    case
}

fn add_client_scenarios(cases: &mut Vec<CorpusCase>) {
    let schema = spike_schema();
    let thread = thread_program(3);
    let thread_context = query_context([("conversationId", id("c1"))]);

    let mut server = Fixture::new();
    let hydration = authoritative(&mut server.engine, &schema, &thread, thread_context.clone());
    cases.push(case_from_parts(
        "scenario-hydrate",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        Vec::new(),
        None,
        None,
    ));

    let send = PreludeStep {
        program: send_program(false),
        context: mutation_context(
            [
                ("conversationId", id("c1")),
                ("body", text("offline")),
                ("at", Value::Int(100)),
            ],
            ["local-send"],
        ),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-local-send",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send.clone()],
        None,
        None,
    ));

    let first_delete = PreludeStep {
        program: delete_message_program(),
        context: mutation_context([("id", id("message-00004"))], Vec::<String>::new()),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-delete-first",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send.clone(), first_delete.clone()],
        None,
        None,
    ));

    let second_delete = PreludeStep {
        program: delete_message_program(),
        context: mutation_context([("id", id("message-00003"))], Vec::<String>::new()),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-delete-second",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![send, first_delete, second_delete],
        None,
        None,
    ));

    let mention_send = PreludeStep {
        program: send_program(false),
        context: mutation_context(
            [
                ("conversationId", id("c1")),
                ("body", text("hi @bob")),
                ("at", Value::Int(101)),
            ],
            ["local-mention"],
        ),
        expected_state: "predicted".to_owned(),
    };
    cases.push(case_from_parts(
        "scenario-first-mention",
        "scenario",
        schema.clone(),
        thread.clone(),
        thread_context.clone(),
        hydration.receipt.clone(),
        vec![mention_send.clone()],
        None,
        None,
    ));

    let leave = Program {
        name: "leaveConversation".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "memberships".to_owned(),
            key: Expr::Literal(id("m1")),
        }],
    };
    authoritative(
        &mut server.engine,
        &schema,
        &leave,
        mutation_context([], Vec::<String>::new()),
    );
    let revoked = authoritative(&mut server.engine, &schema, &thread, thread_context.clone());
    cases.push(case_from_parts(
        "scenario-revocation-rehydrate",
        "scenario",
        schema,
        thread,
        thread_context,
        hydration.receipt,
        vec![mention_send],
        Some(revoked.receipt),
        None,
    ));
}

fn add_value_edges(cases: &mut Vec<CorpusCase>) {
    let sortable = Value::Array(vec![
        row([("key", text("\u{10000}")), ("position", Value::Int(0))]),
        row([("key", text("\u{e000}")), ("position", Value::Int(1))]),
        row([("key", text("e\u{301}")), ("position", Value::Int(2))]),
        row([("key", text("é")), ("position", Value::Int(3))]),
    ]);
    cases.push(pure_case(
        "edge-codepoint-order",
        Expr::Builtin {
            builtin: Builtin::Sort {
                keys: vec![SortKey {
                    field: "key".to_owned(),
                    order: Order::Asc,
                }],
            },
            args: vec![Expr::Literal(sortable)],
        },
    ));
    cases.push(pure_case(
        "edge-stable-sort-ties",
        Expr::Builtin {
            builtin: Builtin::Sort {
                keys: vec![SortKey {
                    field: "key".to_owned(),
                    order: Order::Asc,
                }],
            },
            args: vec![Expr::Literal(Value::Array(vec![
                row([("key", Value::Int(1)), ("position", Value::Int(2))]),
                row([("key", Value::Int(1)), ("position", Value::Int(1))]),
                row([("key", Value::Int(0)), ("position", Value::Int(3))]),
            ]))],
        },
    ));
    for (name, expression) in [
        ("edge-i53-max", Expr::Literal(Value::Int(I53_MAX))),
        ("edge-i53-min", Expr::Literal(Value::Int(I53_MIN))),
        (
            "edge-i53-add-boundary",
            binary(BinaryOp::Add, Value::Int(I53_MAX - 1), Value::Int(1)),
        ),
        (
            "edge-i53-overflow-add",
            binary(BinaryOp::Add, Value::Int(I53_MAX), Value::Int(1)),
        ),
        (
            "edge-i53-overflow-multiply",
            binary(BinaryOp::Mul, Value::Int(I53_MAX), Value::Int(2)),
        ),
        (
            "edge-negative-divmod",
            Expr::Builtin {
                builtin: Builtin::Divmod {
                    remainder_sink: "sorted-first".to_owned(),
                },
                args: vec![Expr::Literal(Value::Int(-5)), Expr::Literal(Value::Int(3))],
            },
        ),
        (
            "edge-negative-divisor-divmod",
            Expr::Builtin {
                builtin: Builtin::Divmod {
                    remainder_sink: "sorted-first".to_owned(),
                },
                args: vec![Expr::Literal(Value::Int(5)), Expr::Literal(Value::Int(-3))],
            },
        ),
        (
            "edge-map-insertion-roundtrip",
            Expr::Literal(Value::Map(BTreeMap::from([
                ("zeta".to_owned(), Value::Int(1)),
                ("alpha".to_owned(), Value::Int(2)),
                ("middle".to_owned(), Value::Int(3)),
            ]))),
        ),
    ] {
        cases.push(pure_case(name, expression));
    }
    cases.push(query_case(
        "edge-empty-page",
        "edge",
        mention_scan_program(),
        query_context([("handle", text("nobody"))]),
    ));
    cases.push(query_case(
        "edge-has-more-at-bound",
        "edge",
        thread_program(3),
        query_context([("conversationId", id("c1"))]),
    ));
}

fn add_random_cases(cases: &mut Vec<CorpusCase>) {
    let mut random = XorShift64(RANDOM_SEED);
    for index in 0..40 {
        let seed = random.next();
        let left = (seed % 20_001) as i64 - 10_000;
        let right = ((seed >> 17) % 997) as i64 + 1;
        let (expression, args): (Expr, BTreeMap<&str, Value>) = match index % 8 {
            0 => (
                Expr::Binary {
                    op: BinaryOp::Add,
                    left: Box::new(var("left")),
                    right: Box::new(var("right")),
                },
                [("left", Value::Int(left)), ("right", Value::Int(right))]
                    .into_iter()
                    .collect(),
            ),
            1 => (
                Expr::Binary {
                    op: BinaryOp::Mul,
                    left: Box::new(var("left")),
                    right: Box::new(var("right")),
                },
                [
                    ("left", Value::Int(left)),
                    ("right", Value::Int((right % 17) - 8)),
                ]
                .into_iter()
                .collect(),
            ),
            2 => (
                Expr::Builtin {
                    builtin: Builtin::Divmod {
                        remainder_sink: "random".to_owned(),
                    },
                    args: vec![var("left"), var("right")],
                },
                [("left", Value::Int(left)), ("right", Value::Int(right))]
                    .into_iter()
                    .collect(),
            ),
            3 => (
                Expr::Builtin {
                    builtin: Builtin::Slice,
                    args: vec![
                        var("text"),
                        Expr::Literal(Value::Int(1)),
                        Expr::Literal(Value::Int(4)),
                    ],
                },
                [("text", text(format!("a\u{10000}{:x}e\u{301}", seed % 256)))]
                    .into_iter()
                    .collect(),
            ),
            4 => (
                Expr::Builtin {
                    builtin: Builtin::DeterministicShare,
                    args: vec![var("amount"), var("recipients"), var("recipient")],
                },
                [
                    ("amount", Value::Int(left.unsigned_abs() as i64)),
                    (
                        "recipients",
                        Value::Array(vec![id("u3"), id("u1"), id("u2")]),
                    ),
                    ("recipient", id(["u1", "u2", "u3"][(seed % 3) as usize])),
                ]
                .into_iter()
                .collect(),
            ),
            5 => (
                Expr::Builtin {
                    builtin: Builtin::Min,
                    args: vec![var("left"), var("right")],
                },
                [
                    ("left", text(format!("\u{e000}-{}", seed % 7))),
                    ("right", text(format!("\u{10000}-{}", seed % 5))),
                ]
                .into_iter()
                .collect(),
            ),
            6 => (
                Expr::Builtin {
                    builtin: Builtin::Concat,
                    args: vec![var("left"), var("right")],
                },
                [
                    (
                        "left",
                        Value::Array(vec![Value::Int(left), Value::Int(right)]),
                    ),
                    ("right", Value::Array(vec![Value::Int((seed % 13) as i64)])),
                ]
                .into_iter()
                .collect(),
            ),
            _ => {
                let tie = (seed % 3) as i64;
                (
                    Expr::Builtin {
                        builtin: Builtin::Sort {
                            keys: vec![SortKey {
                                field: "key".to_owned(),
                                order: Order::Asc,
                            }],
                        },
                        args: vec![var("rows")],
                    },
                    [(
                        "rows",
                        Value::Array(vec![
                            row([("key", Value::Int(tie)), ("position", Value::Int(0))]),
                            row([("key", Value::Int(tie)), ("position", Value::Int(1))]),
                            row([("key", Value::Int(tie - 1)), ("position", Value::Int(2))]),
                        ]),
                    )]
                    .into_iter()
                    .collect(),
                )
            }
        };
        let args: BTreeMap<String, Value> = args
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect();
        let program = pure_program(&format!("random{index:02}"), expression, &args);
        let context = Context::query("u1", args);
        cases.push(case_from_parts(
            &format!("random-{index:02}"),
            "random",
            spike_schema(),
            program,
            context,
            ClosureReceipt::default(),
            Vec::new(),
            None,
            Some(seed),
        ));
    }
}

fn query_case(name: &str, category: &str, program: Program, context: Context) -> CorpusCase {
    let mut fixture = Fixture::new();
    let execution = authoritative(
        &mut fixture.engine,
        &fixture.schema,
        &program,
        context.clone(),
    );
    let case = case_from_parts(
        name,
        category,
        fixture.schema,
        program,
        context,
        execution.receipt,
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.local_result.as_ref(), Some(&execution.result));
    case
}

fn mutation_case(name: &str, category: &str, program: Program, context: Context) -> CorpusCase {
    let fixture = Fixture::new();
    let receipt = fixture.snapshot();
    let mut server = Fixture::new();
    let execution = authoritative(
        &mut server.engine,
        &server.schema,
        &program,
        context.clone(),
    );
    let case = case_from_parts(
        name,
        category,
        fixture.schema,
        program,
        context,
        receipt,
        Vec::new(),
        None,
        None,
    );
    assert_eq!(case.expected.local_result.as_ref(), Some(&execution.result));
    case
}

#[allow(clippy::too_many_arguments)]
fn case_from_parts(
    name: &str,
    category: &str,
    schema: Schema,
    program: Program,
    context: Context,
    receipt: ClosureReceipt,
    prelude: Vec<PreludeStep>,
    replacement_receipt: Option<ClosureReceipt>,
    random_seed: Option<u64>,
) -> CorpusCase {
    let expected = evaluate_local(
        &schema,
        &program,
        context.clone(),
        &receipt,
        &prelude,
        replacement_receipt.as_ref(),
    );
    CorpusCase {
        corpus_version: CORPUS_VERSION,
        name: name.to_owned(),
        category: category.to_owned(),
        random_seed,
        schema,
        program,
        context,
        receipt,
        prelude,
        replacement_receipt,
        expected,
    }
}

fn evaluate_local(
    schema: &Schema,
    program: &Program,
    context: Context,
    receipt: &ClosureReceipt,
    prelude: &[PreludeStep],
    replacement_receipt: Option<&ClosureReceipt>,
) -> Expected {
    let mut client = ClientStore::hydrate(schema.clone(), receipt).expect("hydrate client");
    for step in prelude {
        let certificate = Checker::new(schema, Ceilings::default())
            .check(&step.program)
            .expect("prelude certificate");
        let (state, _) = client
            .apply_mutation(&step.program, &certificate, step.context.clone())
            .expect("prelude mutation");
        let (state, _) = local_state(state);
        assert_eq!(state, step.expected_state);
    }
    let evicted_rows = replacement_receipt.map(|replacement| {
        client
            .rehydrate(replacement)
            .expect("replacement hydration")
    });
    let certificate = Checker::new(schema, Ceilings::default())
        .check(program)
        .expect("case certificate");
    let outcome = match program.kind {
        ProgramKind::Query => client.reexecute(program, &certificate, context),
        ProgramKind::Mutation => client.apply_mutation(program, &certificate, context),
    };
    match outcome {
        Ok((state, execution)) => {
            let (local_state, partial_sites) = local_state(state);
            let canonical_result = canonical_json(&execution.result);
            let range_stops = execution.trace.ranges.iter().fold(
                BTreeMap::<String, Vec<String>>::new(),
                |mut ranges, range| {
                    ranges
                        .entry(range.site.clone())
                        .or_default()
                        .push(stop_name(range.stop).to_owned());
                    ranges
                },
            );
            Expected {
                local_result: Some(execution.result.clone()),
                error_code: None,
                local_state,
                partial_sites,
                canonical_result,
                digest: digest(&execution.result),
                range_stops,
                evicted_rows,
            }
        }
        Err(error) => {
            let rendered = error.to_string();
            let error_code = rendered.split(':').next().unwrap_or("E_UNKNOWN").to_owned();
            let envelope = json!({ "Error": error_code });
            Expected {
                local_result: None,
                error_code: Some(error_code),
                local_state: "refused".to_owned(),
                partial_sites: Vec::new(),
                canonical_result: serde_json::to_string(&envelope).expect("error envelope"),
                digest: digest(&envelope),
                range_stops: BTreeMap::new(),
                evicted_rows,
            }
        }
    }
}

fn authoritative(
    engine: &mut Engine,
    schema: &Schema,
    program: &Program,
    context: Context,
) -> Execution {
    let certificate = Checker::new(schema, Ceilings::default())
        .check(program)
        .expect("authoritative certificate");
    engine
        .execute(program, &certificate, context)
        .expect("authoritative execution")
}

fn pure_case(name: &str, expression: Expr) -> CorpusCase {
    let args = BTreeMap::new();
    case_from_parts(
        name,
        "edge",
        spike_schema(),
        pure_program(name, expression, &args),
        Context::query("u1", args),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    )
}

fn pure_program(name: &str, expression: Expr, args: &BTreeMap<String, Value>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: args
            .keys()
            .map(|name| (name.clone(), ArgType::Scalar))
            .collect(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(expression)],
    }
}

fn local_state(state: LocalState) -> (String, Vec<String>) {
    match state {
        LocalState::Fresh => ("fresh".to_owned(), Vec::new()),
        LocalState::Predicted => ("predicted".to_owned(), Vec::new()),
        LocalState::Partial(sites) => ("partial".to_owned(), sites),
    }
}

fn stop_name(stop: StopReason) -> &'static str {
    match stop {
        StopReason::Limit => "limit",
        StopReason::Exhausted => "exhausted",
    }
}

fn binary(op: BinaryOp, left: Value, right: Value) -> Expr {
    Expr::Binary {
        op,
        left: Box::new(Expr::Literal(left)),
        right: Box::new(Expr::Literal(right)),
    }
}

fn fixture_rows() -> Vec<(&'static str, Value)> {
    let mut rows = vec![
        ("users", row([("id", id("u1")), ("handle", text("alice"))])),
        ("users", row([("id", id("u2")), ("handle", text("bob"))])),
        (
            "conversations",
            row([("id", id("c1")), ("title", text("General"))]),
        ),
        (
            "memberships",
            row([
                ("id", id("m1")),
                ("conversationId", id("c1")),
                ("userId", id("u1")),
                ("lastReadAt", Value::Int(0)),
                ("activity", Value::Int(100)),
            ]),
        ),
        (
            "memberships",
            row([
                ("id", id("m2")),
                ("conversationId", id("c1")),
                ("userId", id("u2")),
                ("lastReadAt", Value::Int(0)),
                ("activity", Value::Int(90)),
            ]),
        ),
        (
            "columns",
            row([
                ("id", id("col1")),
                ("boardId", id("board1")),
                ("order", Value::Int(1)),
                ("title", text("Todo")),
            ]),
        ),
        (
            "cards",
            row([
                ("id", id("card1")),
                ("columnId", id("col1")),
                ("order", Value::Int(1)),
                ("title", text("Ship")),
            ]),
        ),
        (
            "cardCounts",
            row([
                ("id", id("[{\"Id\":\"col1\"}]")),
                ("columnId", id("col1")),
                ("value", Value::Int(1)),
            ]),
        ),
        (
            "accounts",
            row([
                ("id", id("a1")),
                ("groupId", id("g1")),
                ("parentId", id("none")),
                ("name", text("Root")),
            ]),
        ),
        (
            "accounts",
            row([
                ("id", id("a2")),
                ("groupId", id("g1")),
                ("parentId", id("a1")),
                ("name", text("Child")),
            ]),
        ),
        (
            "unreads",
            row([
                ("id", id("c1:u1")),
                ("conversationId", id("c1")),
                ("userId", id("u1")),
                ("value", Value::Int(5)),
            ]),
        ),
        (
            "owed",
            row([
                ("id", id("[{\"Id\":\"g1\"},{\"Id\":\"u1\"}]")),
                ("groupId", id("g1")),
                ("userId", id("u1")),
                ("value", Value::Int(3)),
            ]),
        ),
        (
            "owed",
            row([
                ("id", id("[{\"Id\":\"g1\"},{\"Id\":\"u2\"}]")),
                ("groupId", id("g1")),
                ("userId", id("u2")),
                ("value", Value::Int(2)),
            ]),
        ),
        (
            "waitCounts",
            row([
                ("id", id("[{\"Id\":\"resource1\"}]")),
                ("resourceId", id("resource1")),
                ("value", Value::Int(7)),
            ]),
        ),
        (
            "entitlements",
            row([("id", id("ent1")), ("userId", id("u1"))]),
        ),
        (
            "secretDocs",
            row([("id", id("doc1")), ("title", text("Private"))]),
        ),
    ];
    for number in 0..5 {
        rows.push((
            "messages",
            row([
                ("id", id(format!("message-{number:05}"))),
                ("conversationId", id("c1")),
                ("authorId", id("u1")),
                ("body", text(format!("message {number}"))),
                ("at", Value::Int(number + 1)),
            ]),
        ));
    }
    rows
}

fn id(value: impl Into<String>) -> Value {
    Value::Id(value.into())
}

fn text(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

fn row<const N: usize>(entries: [(&str, Value); N]) -> Value {
    object(entries)
}

fn var(name: &str) -> Expr {
    Expr::Variable(name.to_owned())
}

fn query_context<const N: usize>(entries: [(&str, Value); N]) -> Context {
    Context::query(
        "u1",
        entries
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

fn mutation_context<const N: usize, I, S>(entries: [(&str, Value); N], new_ids: I) -> Context
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut context = Context::mutation(
        "u1",
        entries
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    );
    context.new_ids = new_ids.into_iter().map(Into::into).collect::<VecDeque<_>>();
    context
}

struct XorShift64(u64);

impl XorShift64 {
    fn next(&mut self) -> u64 {
        let mut value = self.0;
        value ^= value << 13;
        value ^= value >> 7;
        value ^= value << 17;
        self.0 = value;
        value
    }
}
