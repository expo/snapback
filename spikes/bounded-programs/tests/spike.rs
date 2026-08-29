use bounded_programs_spike::*;
use pretty_assertions::assert_eq;
use std::collections::{BTreeMap, VecDeque};
use std::time::{Duration, Instant};

fn id(value: impl Into<String>) -> Value {
    Value::Id(value.into())
}

fn text(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

fn row(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    object(entries)
}

fn map(entries: impl IntoIterator<Item = (&'static str, Value)>) -> BTreeMap<String, Value> {
    entries
        .into_iter()
        .map(|(key, value)| (key.to_owned(), value))
        .collect()
}

fn query_context(entries: impl IntoIterator<Item = (&'static str, Value)>) -> Context {
    Context::query("u1", map(entries))
}

fn mutation_context(
    entries: impl IntoIterator<Item = (&'static str, Value)>,
    new_ids: impl IntoIterator<Item = impl Into<String>>,
) -> Context {
    let mut context = Context::mutation("u1", map(entries));
    context.new_ids = new_ids.into_iter().map(Into::into).collect::<VecDeque<_>>();
    context
}

fn seed_identity(engine: &mut Engine) {
    engine
        .seed("users", row([("id", id("u1")), ("handle", text("alice"))]))
        .unwrap();
    engine
        .seed("users", row([("id", id("u2")), ("handle", text("bob"))]))
        .unwrap();
    engine
        .seed(
            "conversations",
            row([("id", id("c1")), ("title", text("General"))]),
        )
        .unwrap();
    engine
        .seed(
            "memberships",
            row([
                ("id", id("m1")),
                ("conversationId", id("c1")),
                ("userId", id("u1")),
                ("lastReadAt", Value::Int(0)),
                ("activity", Value::Int(100)),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "memberships",
            row([
                ("id", id("m2")),
                ("conversationId", id("c1")),
                ("userId", id("u2")),
                ("lastReadAt", Value::Int(0)),
                ("activity", Value::Int(90)),
            ]),
        )
        .unwrap();
}

fn seed_messages(engine: &mut Engine, count: usize) {
    for number in 0..count {
        engine
            .seed(
                "messages",
                row([
                    ("id", id(format!("message-{number:05}"))),
                    ("conversationId", id("c1")),
                    ("authorId", id("u1")),
                    ("body", text(format!("message {number}"))),
                    ("at", Value::Int(number as i64 + 1)),
                ]),
            )
            .unwrap();
    }
}

fn checker(schema: &Schema) -> Checker<'_> {
    Checker::new(schema, Ceilings::default())
}

#[test]
fn ir_json_round_trip_and_named_programs_certify_and_execute() {
    let schema = spike_schema();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    seed_identity(&mut engine);
    seed_messages(&mut engine, 6);
    engine
        .seed(
            "columns",
            row([
                ("id", id("col1")),
                ("boardId", id("board1")),
                ("order", Value::Int(1)),
                ("title", text("Todo")),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "cards",
            row([
                ("id", id("card1")),
                ("columnId", id("col1")),
                ("order", Value::Int(1)),
                ("title", text("Ship")),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "cardCounts",
            row([
                ("id", id("[\"col1\"]")),
                ("columnId", id("col1")),
                ("value", Value::Int(1)),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "accounts",
            row([
                ("id", id("a1")),
                ("groupId", id("g1")),
                ("parentId", id("none")),
                ("name", text("Root")),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "accounts",
            row([
                ("id", id("a2")),
                ("groupId", id("g1")),
                ("parentId", id("a1")),
                ("name", text("Child")),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "unreads",
            row([
                ("id", id("c1:u1")),
                ("conversationId", id("c1")),
                ("userId", id("u1")),
                ("value", Value::Int(6)),
            ]),
        )
        .unwrap();

    let thread = thread_program(3);
    let encoded = serde_json::to_string_pretty(&thread).unwrap();
    let decoded: Program = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, thread);

    let cases: Vec<(Program, Context)> = vec![
        (thread, query_context([("conversationId", id("c1"))])),
        (
            send_program(false),
            mutation_context(
                [
                    ("conversationId", id("c1")),
                    ("body", text("hello")),
                    ("at", Value::Int(20)),
                ],
                ["message-new"],
            ),
        ),
        (
            mark_read_program(),
            mutation_context(
                [("membershipId", id("m1")), ("at", Value::Int(20))],
                Vec::<String>::new(),
            ),
        ),
        (inbox_program(false), query_context([])),
        (inbox_program(true), query_context([])),
        (
            start_dm_program(),
            mutation_context(
                [("lo", id("u1")), ("hi", id("u2"))],
                ["dm-conv", "dm-key", "dm-lo", "dm-hi"],
            ),
        ),
        (
            board_view_program(),
            query_context([("boardId", id("board1"))]),
        ),
        (
            board_summary_program(),
            query_context([("boardId", id("board1"))]),
        ),
        (ledger_program(), query_context([("groupId", id("g1"))])),
        (
            add_expense_program(),
            mutation_context(
                [
                    ("groupId", id("g1")),
                    ("amount", Value::Int(5)),
                    ("recipients", Value::Array(vec![id("u2"), id("u1")])),
                ],
                ["expense1", "share1", "share2"],
            ),
        ),
        (
            ancestors_program(),
            query_context([("accountId", id("a2"))]),
        ),
        (
            mention_scan_program(),
            query_context([("handle", text("bob"))]),
        ),
    ];

    for (program, context) in cases {
        let certificate = checker(&schema)
            .check(&program)
            .unwrap_or_else(|error| panic!("{} did not certify: {error}", program.name));
        let execution = engine
            .execute(&program, &certificate, context)
            .unwrap_or_else(|error| panic!("{} did not execute: {error}", program.name));
        assert!(
            execution.trace.examined <= certificate.max_examined,
            "{}",
            program.name
        );
    }

    let owed = engine.rows("owed").unwrap();
    let mut values: Vec<_> = owed
        .iter()
        .map(|row| row.field("value").unwrap().as_int().unwrap())
        .collect();
    values.sort();
    assert_eq!(
        values,
        vec![2, 3],
        "deterministic remainder goes to sorted first id"
    );
}

#[test]
fn ten_thousand_messages_stay_below_certificate_and_membership_hoists() {
    let schema = spike_schema();
    let program = thread_program(20);
    let certificate = checker(&schema).check(&program).unwrap();
    let message_site = certificate
        .read_sites
        .iter()
        .find(|site| site.site == "thread.messages")
        .unwrap();
    assert!(message_site.hoist);

    let mut engine = Engine::memory(schema).unwrap();
    seed_identity(&mut engine);
    seed_messages(&mut engine, 10_000);
    let execution = engine
        .execute(
            &program,
            &certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    eprintln!(
        "thread rows=10000 actual_examined={} certificate_examined={} rule_probes={}",
        execution.trace.examined, certificate.max_examined, execution.trace.rule_probes
    );
    assert!(execution.trace.examined <= certificate.max_examined);
    assert_eq!(
        execution.trace.rule_probes, 1,
        "membership probe is memoized and hoisted"
    );
    let range = execution
        .trace
        .ranges
        .iter()
        .find(|range| range.site == "thread.messages")
        .unwrap();
    assert_eq!(range.examined_ids.len(), 22, "take + halo + N+2 key probe");
    assert_eq!(range.stop, StopReason::Limit);
}

#[test]
fn hidden_rule_input_becomes_only_a_scoped_verdict() {
    let schema = spike_schema();
    let program = hidden_rule_program();
    let certificate = checker(&schema).check(&program).unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    engine
        .seed("users", row([("id", id("u1")), ("handle", text("alice"))]))
        .unwrap();
    engine
        .seed(
            "entitlements",
            row([("id", id("ent1")), ("userId", id("u1"))]),
        )
        .unwrap();
    engine
        .seed(
            "secretDocs",
            row([("id", id("doc1")), ("title", text("Private"))]),
        )
        .unwrap();
    let execution = engine
        .execute(&program, &certificate, query_context([("id", id("doc1"))]))
        .unwrap();
    assert_ne!(execution.result, Value::Null);
    assert_eq!(execution.receipt.verdicts.len(), 1);
    assert!(execution
        .receipt
        .rows
        .iter()
        .all(|row| row.table != "entitlements"));
    assert!(execution
        .receipt
        .ranges
        .iter()
        .all(|range| range.table != "entitlements"));
    assert!(execution.trace.rule_inputs.iter().any(|input| input.hidden));
}

#[test]
fn bound_products_helpers_and_structural_counts_are_checked() {
    let schema = spike_schema();
    let error = checker(&schema)
        .check(&nested_expenses_program())
        .unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    assert!(error
        .message
        .contains("expenses take 500 × shares take 50 = 25000"));
    assert!(error.rewrite.contains("maintain.count/sum"));

    let helper_certificate = checker(&schema)
        .check(&helper_wrapped_scan_program())
        .unwrap();
    let helper = helper_certificate
        .read_sites
        .iter()
        .find(|site| site.site == "helper.cards")
        .unwrap();
    assert_eq!(helper.take, 37);
    assert_eq!(helper.max_calls, 1);

    let recurse = checker(&schema).check(&ancestors_program()).unwrap();
    assert_eq!(
        recurse
            .read_sites
            .iter()
            .find(|site| site.site == "ancestors.step")
            .unwrap()
            .max_calls,
        9,
        "depth 8, fanout 1 uses the geometric sum"
    );

    let structural = checker(&schema)
        .check(&structural_waitlist_count_program())
        .unwrap_err();
    assert_eq!(structural.code, "E_STRUCTURAL_COUNT");
    assert!(structural.rewrite.contains("maintain.count(waitlist"));

    let maintained = checker(&schema)
        .check(&maintained_waitlist_count_program())
        .unwrap();
    assert!(maintained
        .disclosures
        .iter()
        .any(|item| item.contains("waitlist") && item.contains("waitCounts")));
}

#[test]
fn maintained_count_handles_insert_group_move_delete_and_constraints_bind_writes() {
    let mut schema = spike_schema();
    schema
        .tables
        .get_mut("cards")
        .unwrap()
        .constraints
        .push(Constraint::Cap {
            by: vec!["columnId".to_owned()],
            max: 1,
        });
    schema
        .tables
        .get_mut("shares")
        .unwrap()
        .constraints
        .push(Constraint::Immutable {
            fields: vec!["amount".to_owned()],
        });
    schema
        .tables
        .get_mut("expenses")
        .unwrap()
        .constraints
        .push(Constraint::AppendOnly);
    let mut engine = Engine::memory(schema.clone()).unwrap();

    let insert_card = write_program(
        "insertCard",
        vec![Stmt::Insert {
            table: "cards".to_owned(),
            row: literal_row(row([
                ("id", id("card1")),
                ("columnId", id("col1")),
                ("order", Value::Int(1)),
                ("title", text("A")),
            ])),
        }],
    );
    execute_empty(&mut engine, &schema, &insert_card).unwrap();
    assert_aggregate(&engine, "cardCounts", "col1", 1);

    let second_card = write_program(
        "secondCard",
        vec![Stmt::Insert {
            table: "cards".to_owned(),
            row: literal_row(row([
                ("id", id("card2")),
                ("columnId", id("col1")),
                ("order", Value::Int(2)),
                ("title", text("B")),
            ])),
        }],
    );
    assert!(matches!(
        execute_empty(&mut engine, &schema, &second_card),
        Err(RuntimeError::Constraint(message)) if message.contains("cap")
    ));

    let move_card = write_program(
        "moveCard",
        vec![Stmt::Update {
            table: "cards".to_owned(),
            key: Expr::Literal(id("card1")),
            patch: Expr::Object(BTreeMap::from([(
                "columnId".to_owned(),
                Expr::Literal(id("col2")),
            )])),
        }],
    );
    execute_empty(&mut engine, &schema, &move_card).unwrap();
    assert_aggregate(&engine, "cardCounts", "col1", 0);
    assert_aggregate(&engine, "cardCounts", "col2", 1);

    let delete_card = write_program(
        "deleteCard",
        vec![Stmt::Delete {
            table: "cards".to_owned(),
            key: Expr::Literal(id("card1")),
        }],
    );
    execute_empty(&mut engine, &schema, &delete_card).unwrap();
    assert_aggregate(&engine, "cardCounts", "col2", 0);

    engine
        .seed(
            "expenses",
            row([
                ("id", id("expense-locked")),
                ("groupId", id("g1")),
                ("amount", Value::Int(10)),
                ("payerId", id("u1")),
            ]),
        )
        .unwrap();
    let mutate_expense = write_program(
        "mutateAppendOnlyExpense",
        vec![Stmt::Update {
            table: "expenses".to_owned(),
            key: Expr::Literal(id("expense-locked")),
            patch: Expr::Object(BTreeMap::from([(
                "amount".to_owned(),
                Expr::Literal(Value::Int(11)),
            )])),
        }],
    );
    assert!(matches!(
        execute_empty(&mut engine, &schema, &mutate_expense),
        Err(RuntimeError::Constraint(message)) if message.contains("appendOnly")
    ));

    engine
        .seed(
            "shares",
            row([
                ("id", id("share-locked")),
                ("expenseId", id("expense-locked")),
                ("groupId", id("g1")),
                ("userId", id("u1")),
                ("amount", Value::Int(10)),
            ]),
        )
        .unwrap();
    let mutate_share = write_program(
        "mutateImmutableShare",
        vec![Stmt::Update {
            table: "shares".to_owned(),
            key: Expr::Literal(id("share-locked")),
            patch: Expr::Object(BTreeMap::from([(
                "amount".to_owned(),
                Expr::Literal(Value::Int(9)),
            )])),
        }],
    );
    assert!(matches!(
        execute_empty(&mut engine, &schema, &mutate_share),
        Err(RuntimeError::Constraint(message)) if message.contains("immutable")
    ));
}

#[test]
fn receipt_only_client_replays_prediction_halo_computed_partial_and_revocation() {
    let schema = spike_schema();
    let thread = thread_program(3);
    let thread_certificate = checker(&schema).check(&thread).unwrap();
    let send = send_program(false);
    let send_certificate = checker(&schema).check(&send).unwrap();
    let delete = delete_message_program();
    let delete_certificate = checker(&schema).check(&delete).unwrap();
    let pair = checker(&schema).check_pair(&thread, &send).unwrap();
    let partial_prediction = pair
        .prediction_sites
        .iter()
        .find(|site| site.mode == PredictionMode::Partial)
        .unwrap();
    assert_eq!(partial_prediction.reads, vec!["thread.mentionUser"]);
    assert!(pair
        .prediction_sites
        .iter()
        .find(|site| site.mode == PredictionMode::Closed)
        .unwrap()
        .reads
        .contains(&"thread.author".to_owned()));

    let mut server = Engine::memory(schema.clone()).unwrap();
    seed_identity(&mut server);
    seed_messages(&mut server, 5);
    let hydration = server
        .execute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    let thread_range = hydration
        .receipt
        .ranges
        .iter()
        .find(|range| range.site == "thread.messages")
        .unwrap();
    assert!(thread_range.halo.is_some());
    assert!(thread_range.n2_key.is_some());

    let mut client = ClientStore::hydrate(schema.clone(), &hydration.receipt).unwrap();
    let (state, _) = client
        .apply_mutation(
            &send,
            &send_certificate,
            mutation_context(
                [
                    ("conversationId", id("c1")),
                    ("body", text("offline")),
                    ("at", Value::Int(100)),
                ],
                ["local-send"],
            ),
        )
        .unwrap();
    assert_eq!(state, LocalState::Predicted);
    let (state, replay) = client
        .reexecute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    assert_eq!(state, LocalState::Fresh);
    assert!(replay.result.as_array().unwrap().iter().any(|entry| {
        entry.field("message").unwrap().field("id").unwrap() == &id("local-send")
    }));

    client
        .apply_mutation(
            &delete,
            &delete_certificate,
            mutation_context([("id", id("message-00004"))], Vec::<String>::new()),
        )
        .unwrap();
    let (state, _) = client
        .reexecute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    assert_eq!(
        state,
        LocalState::Fresh,
        "one deletion is covered by the halo"
    );

    client
        .apply_mutation(
            &delete,
            &delete_certificate,
            mutation_context([("id", id("message-00003"))], Vec::<String>::new()),
        )
        .unwrap();
    let (state, _) = client
        .reexecute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    assert_eq!(
        state,
        LocalState::Partial(vec!["thread.messages".to_owned()])
    );

    let mut mention_client = ClientStore::hydrate(schema.clone(), &hydration.receipt).unwrap();
    mention_client
        .apply_mutation(
            &send,
            &send_certificate,
            mutation_context(
                [
                    ("conversationId", id("c1")),
                    ("body", text("hi @bob")),
                    ("at", Value::Int(101)),
                ],
                ["local-mention"],
            ),
        )
        .unwrap();
    let (state, _) = mention_client
        .reexecute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    assert_eq!(
        state,
        LocalState::Partial(vec!["thread.mentionUser".to_owned()])
    );

    let delete_membership = write_program(
        "leaveConversation",
        vec![Stmt::Delete {
            table: "memberships".to_owned(),
            key: Expr::Literal(id("m1")),
        }],
    );
    execute_empty(&mut server, &schema, &delete_membership).unwrap();
    let revoked = server
        .execute(
            &thread,
            &thread_certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    assert!(revoked.result.as_array().unwrap().is_empty());
    let evicted = mention_client.rehydrate(&revoked.receipt).unwrap();
    assert!(evicted > 0);
    assert!(mention_client.rows("messages").unwrap().is_empty());
}

#[test]
fn maintained_unread_256_member_fanout_records_p95() {
    let schema = spike_schema();
    let program = send_program(true);
    let certificate = checker(&schema).check(&program).unwrap();
    assert!(certificate
        .write_sites
        .iter()
        .any(|site| { site.table == "unreads" && site.max_rows == 256 }));
    let mut engine = Engine::memory(schema).unwrap();
    engine
        .seed(
            "conversations",
            row([("id", id("large")), ("title", text("Large"))]),
        )
        .unwrap();
    for number in 0..255 {
        let user = format!("fan-{number:03}");
        engine
            .seed("users", row([("id", id(&user)), ("handle", text(&user))]))
            .unwrap();
        engine
            .seed(
                "memberships",
                row([
                    ("id", id(format!("member-{number:03}"))),
                    ("conversationId", id("large")),
                    ("userId", id(user)),
                    ("lastReadAt", Value::Int(0)),
                    ("activity", Value::Int(0)),
                ]),
            )
            .unwrap();
    }
    engine
        .seed("users", row([("id", id("u1")), ("handle", text("sender"))]))
        .unwrap();
    engine
        .seed(
            "memberships",
            row([
                ("id", id("sender-member")),
                ("conversationId", id("large")),
                ("userId", id("u1")),
                ("lastReadAt", Value::Int(0)),
                ("activity", Value::Int(1)),
            ]),
        )
        .unwrap();

    let mut samples = Vec::new();
    for iteration in 0..9 {
        let started = Instant::now();
        engine
            .execute(
                &program,
                &certificate,
                mutation_context(
                    [
                        ("conversationId", id("large")),
                        ("body", text("fanout")),
                        ("at", Value::Int(iteration)),
                    ],
                    [format!("fanout-message-{iteration}")],
                ),
            )
            .unwrap();
        samples.push(started.elapsed());
    }
    samples.sort();
    let p95 = samples[((samples.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)];
    eprintln!("maintained-unread fanout=256 p95_us={}", p95.as_micros());
    let unread_rows = engine.rows("unreads").unwrap();
    assert_eq!(unread_rows.len(), 256);
    assert!(unread_rows
        .iter()
        .all(|row| row.field("value").unwrap() == &Value::Int(9)));
    assert!(p95 > Duration::ZERO);
}

fn literal_row(value: Value) -> Expr {
    Expr::Literal(value)
}

fn write_program(name: &str, body: Vec<Stmt>) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body,
    }
}

fn execute_empty(
    engine: &mut Engine,
    schema: &Schema,
    program: &Program,
) -> Result<Execution, RuntimeError> {
    let certificate = checker(schema).check(program).unwrap();
    engine.execute(
        program,
        &certificate,
        mutation_context([], Vec::<String>::new()),
    )
}

fn assert_aggregate(engine: &Engine, table: &str, group: &str, expected: i64) {
    let found = engine
        .rows(table)
        .unwrap()
        .into_iter()
        .find(|row| {
            row.as_object()
                .unwrap()
                .values()
                .any(|value| value == &id(group))
        })
        .unwrap();
    assert_eq!(found.field("value").unwrap(), &Value::Int(expected));
}
