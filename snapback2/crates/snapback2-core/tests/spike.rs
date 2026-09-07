use pretty_assertions::assert_eq;
use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};
use std::time::{Duration, Instant};

#[path = "spike/client_authority.rs"]
mod client_authority;

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
    Context::query(Actor::user("u1").unwrap(), map(entries))
}

fn mutation_context(
    entries: impl IntoIterator<Item = (&'static str, Value)>,
    new_ids: impl IntoIterator<Item = impl Into<String>>,
) -> Context {
    let mut context = Context::mutation(Actor::user("u1").unwrap(), map(entries));
    context.new_ids = new_ids.into_iter().map(Into::into).collect::<VecDeque<_>>();
    context
}

fn seed_identity(engine: &mut Engine) {
    engine
        .seed(
            "users",
            row([
                ("id", id("u1")),
                ("principal", id("u1")),
                ("handle", text("alice")),
            ]),
        )
        .unwrap();
    engine
        .seed(
            "users",
            row([
                ("id", id("u2")),
                ("principal", id("u2")),
                ("handle", text("bob")),
            ]),
        )
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
                [
                    ("membershipId", id("m1")),
                    ("at", Value::Int(20)),
                    ("messageId", id("message-00002")),
                ],
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
        .find(|site| site.site == "programs.thread.0")
        .unwrap();
    assert!(message_site.hoist);

    let mut engine = Engine::memory(schema.clone()).unwrap();
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
    assert_eq!(certificate.max_rule_probes, 2);
    assert_eq!(
        execution.trace.rule_probes, 2,
        "outer membership lookup and its self-protected visibility lookup are both metered once"
    );
    let range = execution
        .trace
        .ranges
        .iter()
        .find(|range| range.site == "programs.thread.0")
        .unwrap();
    assert_eq!(range.examined_ids.len(), 22, "take + halo + N+2 key probe");
    assert_eq!(range.stop, StopReason::Limit);
}

#[test]
fn hidden_rule_input_becomes_only_a_scoped_verdict() {
    let schema = spike_schema();
    let program = hidden_rule_program();
    let certificate = checker(&schema).check(&program).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    engine
        .seed(
            "users",
            row([
                ("id", id("u1")),
                ("principal", id("u1")),
                ("handle", text("alice")),
            ]),
        )
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
    assert!(
        execution
            .receipt
            .rows
            .iter()
            .all(|row| row.table != "entitlements")
    );
    assert!(
        execution
            .receipt
            .ranges
            .iter()
            .all(|range| range.table != "entitlements")
    );
    let rule_hash = schema.rule_hash(&schema.tables["secretDocs"].rules.read);
    assert!(
        execution
            .trace
            .rule_inputs
            .iter()
            .any(|input| input.rule_hash == rule_hash && input.hidden)
    );
}

#[test]
fn readable_rule_input_is_derived_from_the_target_table_policy() {
    let schema = spike_schema();
    let program = thread_program(3);
    let certificate = checker(&schema).check(&program).unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    seed_identity(&mut engine);
    seed_messages(&mut engine, 1);

    let execution = engine
        .execute(
            &program,
            &certificate,
            query_context([("conversationId", id("c1"))]),
        )
        .unwrap();
    let rule_hash = schema.rule_hash(&schema.tables["messages"].rules.read);
    let input = execution
        .trace
        .rule_inputs
        .iter()
        .find(|input| input.rule_hash == rule_hash && !input.hidden)
        .expect("message rule must probe memberships");
    assert_eq!(input.table, "memberships");
    assert!(
        execution
            .receipt
            .rows
            .iter()
            .any(|row| { row.table == "memberships" && row.id == "m1" })
    );
}

#[test]
fn scoped_verdict_and_certificate_refuse_a_predecessor_policy() {
    let mut predecessor = spike_schema();
    predecessor
        .tables
        .get_mut("entitlements")
        .unwrap()
        .rules
        .read = RuleExpr::Eq(
        RuleTerm::Field("userId".to_owned()),
        RuleTerm::Literal(id("u2")),
    );
    let program = hidden_rule_program();
    let predecessor_certificate = checker(&predecessor).check(&program).unwrap();
    let predecessor_rule_hash = predecessor.rule_hash(&predecessor.tables["secretDocs"].rules.read);
    let mut engine = Engine::memory(predecessor.clone()).unwrap();
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
    let served = engine
        .execute(
            &program,
            &predecessor_certificate,
            query_context([("id", id("doc1"))]),
        )
        .unwrap();
    assert_eq!(served.receipt.verdicts.len(), 1);
    assert_eq!(served.receipt.verdicts[0].rule_hash, predecessor_rule_hash);

    let mut successor = predecessor.clone();
    successor.tables.get_mut("entitlements").unwrap().rules.read =
        RuleExpr::Eq(RuleTerm::Field("userId".to_owned()), RuleTerm::Viewer);
    let successor_certificate = checker(&successor).check(&program).unwrap();
    assert_ne!(predecessor.hash(), successor.hash());
    assert_ne!(
        predecessor_rule_hash,
        successor.rule_hash(&successor.tables["secretDocs"].rules.read),
        "an enclosing probe hash binds the referenced read policy"
    );

    let stale_error = Engine::memory(successor.clone())
        .unwrap()
        .execute(
            &program,
            &predecessor_certificate,
            query_context([("id", id("doc1"))]),
        )
        .unwrap_err();
    assert_eq!(stale_error.code(), "E_TRACE_SUBSET");

    let mut client = ClientStore::hydrate(successor, &served.receipt).unwrap();
    let (_, replayed) = client
        .reexecute(
            &program,
            &successor_certificate,
            query_context([("id", id("doc1"))]),
        )
        .unwrap();
    assert_eq!(
        replayed.result,
        Value::Null,
        "the successor evaluator must not accept the carried predecessor verdict"
    );
}

#[test]
fn visibility_probe_ceiling_covers_public_deny_system_subject_and_nested_rules() {
    let cases = [
        ("allow", RuleExpr::Allow, true, false, 1, 1),
        ("deny", RuleExpr::Deny, true, true, 1, 1),
        (
            "system",
            RuleExpr::Eq(
                RuleTerm::Viewer,
                RuleTerm::Literal(Value::Id(SYSTEM_PRINCIPAL_ID.to_string())),
            ),
            true,
            true,
            1,
            1,
        ),
        (
            "subject-match",
            RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer),
            true,
            true,
            1,
            1,
        ),
        (
            "subject-miss",
            RuleExpr::Eq(
                RuleTerm::Field("ownerId".to_owned()),
                RuleTerm::Literal(id("u2")),
            ),
            true,
            true,
            1,
            1,
        ),
        (
            "nested-self-exists",
            RuleExpr::Exists {
                table: "relationships".to_owned(),
                index: "byDocViewer".to_owned(),
                key: vec![RuleTerm::Field("documentId".to_owned()), RuleTerm::Viewer],
                provenance: KeyProvenance::Shape,
            },
            true,
            false,
            2,
            2,
        ),
        (
            "and-two-exists",
            RuleExpr::And(vec![
                RuleExpr::Exists {
                    table: "relationships".to_owned(),
                    index: "byDocViewer".to_owned(),
                    key: vec![RuleTerm::Field("documentId".to_owned()), RuleTerm::Viewer],
                    provenance: KeyProvenance::Shape,
                },
                RuleExpr::Exists {
                    table: "relationships".to_owned(),
                    index: "byDocViewer".to_owned(),
                    key: vec![
                        RuleTerm::Field("documentId".to_owned()),
                        RuleTerm::Literal(id("u2")),
                    ],
                    provenance: KeyProvenance::Shape,
                },
            ]),
            true,
            true,
            3,
            3,
        ),
        (
            "or-short-circuit",
            RuleExpr::Or(vec![
                RuleExpr::Exists {
                    table: "relationships".to_owned(),
                    index: "byDocViewer".to_owned(),
                    key: vec![RuleTerm::Field("documentId".to_owned()), RuleTerm::Viewer],
                    provenance: KeyProvenance::Shape,
                },
                RuleExpr::Exists {
                    table: "relationships".to_owned(),
                    index: "byDocViewer".to_owned(),
                    key: vec![
                        RuleTerm::Field("documentId".to_owned()),
                        RuleTerm::Literal(id("u2")),
                    ],
                    provenance: KeyProvenance::Shape,
                },
            ]),
            true,
            false,
            3,
            2,
        ),
        (
            "public-absence",
            RuleExpr::Public {
                reason: "relationship absence is public".to_owned(),
            },
            false,
            false,
            1,
            1,
        ),
        (
            "subject-absence",
            RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer),
            false,
            true,
            1,
            1,
        ),
    ];

    for (name, relationship_read, seed_relationship, hidden, certificate_probes, runtime_probes) in
        cases
    {
        let (certificate, execution) = visibility_probe_case(relationship_read, seed_relationship);
        assert_eq!(
            certificate.max_rule_probes, certificate_probes,
            "{name} certificate"
        );
        assert_eq!(
            execution.trace.rule_probes, runtime_probes,
            "{name} runtime"
        );
        let outer = execution
            .trace
            .rule_inputs
            .iter()
            .rev()
            .find(|input| input.table == "relationships")
            .unwrap_or_else(|| panic!("{name} outer relationship probe"));
        assert_eq!(outer.hidden, hidden, "{name} disclosure");
        if name == "nested-self-exists" {
            assert_eq!(
                execution
                    .trace
                    .rule_inputs
                    .iter()
                    .filter(|input| input.table == "relationships")
                    .count(),
                2,
                "the self-cycle terminates after the visibility-mode lookup"
            );
        }
        if matches!(name, "public-absence" | "subject-absence") {
            // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a hidden point hit cannot retain even otherwise-public rule artifacts.
            assert_eq!(execution.result, Value::Null);
            assert!(execution.receipt.rows.is_empty());
            assert!(execution.receipt.ranges.is_empty());
            assert!(execution.receipt.absences.is_empty());
            assert!(execution.receipt.verdicts.is_empty());
        }
    }
}

fn visibility_probe_case(
    relationship_read: RuleExpr,
    seed_relationship: bool,
) -> (Certificate, Execution) {
    let public = RuleExpr::Public {
        reason: "fixture".to_owned(),
    };
    let documents = Table {
        columns: BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
        indexes: BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
        rules: Rules {
            read: RuleExpr::Exists {
                table: "relationships".to_owned(),
                index: "byDocViewer".to_owned(),
                key: vec![RuleTerm::Field("id".to_owned()), RuleTerm::Viewer],
                provenance: KeyProvenance::Shape,
            },
            insert: public.clone(),
            update: public.clone(),
            delete: public.clone(),
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let relationships = Table {
        columns: BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("documentId".to_owned(), ColumnType::Id),
            ("viewerId".to_owned(), ColumnType::Id),
            ("ownerId".to_owned(), ColumnType::Id),
        ]),
        indexes: BTreeMap::from([
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
                "byDocViewer".to_owned(),
                Index {
                    components: (vec!["documentId".to_owned(), "viewerId".to_owned()])
                        .into_iter()
                        .map(snapback2_core::search_key::IndexComponent::Column)
                        .collect(),
                    unique: true,
                },
            ),
        ]),
        rules: Rules {
            read: relationship_read,
            insert: public.clone(),
            update: public.clone(),
            delete: public,
        },
        constraints: Vec::new(),
        retain: Default::default(),
    };
    let schema = Schema {
        schedules: Vec::new(),
        tables: BTreeMap::from([
            ("documents".to_owned(), documents),
            ("relationships".to_owned(), relationships),
        ]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    };
    let program = Program {
        name: "documents.get".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("id".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "documents.get".to_owned(),
            table: "documents".to_owned(),
            index: "byId".to_owned(),
            key: vec![var("id")],
            provenance: KeyProvenance::Arg,
        }))],
    };
    let certificate = checker(&schema).check(&program).unwrap();
    let mut engine = Engine::memory(schema).unwrap();
    engine.seed("documents", row([("id", id("doc1"))])).unwrap();
    if seed_relationship {
        engine
            .seed(
                "relationships",
                row([
                    ("id", id("relationship1")),
                    ("documentId", id("doc1")),
                    ("viewerId", id("u1")),
                    ("ownerId", id("u1")),
                ]),
            )
            .unwrap();
    }
    let execution = engine
        .execute(&program, &certificate, query_context([("id", id("doc1"))]))
        .unwrap();
    (certificate, execution)
}

#[test]
fn bound_products_helpers_and_structural_counts_are_checked() {
    let schema = spike_schema();
    let error = checker(&schema)
        .check(&nested_expenses_program())
        .unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    assert!(
        error
            .message
            .contains("programs.expensesByShares.1 take 50 (+2 reserve) × 500 calls")
    );
    assert!(error.rewrite.contains("maintain.count/sum"));

    let helper_certificate = checker(&schema)
        .check(&helper_wrapped_scan_program())
        .unwrap();
    let helper = helper_certificate
        .read_sites
        .iter()
        .find(|site| site.site == "programs.helperWrappedScan.0")
        .unwrap();
    assert_eq!(helper.take, 37);
    assert_eq!(helper.max_calls, 1);

    let recurse = checker(&schema).check(&ancestors_program()).unwrap();
    assert_eq!(
        recurse
            .read_sites
            .iter()
            .find(|site| site.site == "programs.ancestors.0")
            .unwrap()
            .max_calls,
        9,
        "depth 8, fanout 1 uses the geometric sum"
    );

    let structural = checker(&schema)
        .check(&structural_waitlist_count_program())
        .unwrap_err();
    assert_eq!(structural.code, "E_STRUCTURAL_COUNT");
    assert!(
        structural
            .rewrite
            .contains("maintain totals = count waitlist by")
    );

    let maintained = checker(&schema)
        .check(&maintained_waitlist_count_program())
        .unwrap();
    assert!(
        maintained
            .disclosures
            .iter()
            .any(|item| item.contains("waitlist") && item.contains("waitCounts"))
    );
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
    let move_certificate = checker(&schema).check(&move_card).unwrap();
    assert_eq!(move_certificate.maintained_amplification, 2);
    let move_execution = engine
        .execute(
            &move_card,
            &move_certificate,
            mutation_context([], Vec::<String>::new()),
        )
        .unwrap();
    assert_eq!(move_execution.trace.writes.get("cards"), Some(&1));
    assert_eq!(move_execution.trace.writes.get("cardCounts"), Some(&2));
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
fn maintained_update_and_upsert_charge_both_target_applications() {
    let schema = spike_schema();
    let ceilings = Ceilings {
        write_rows: 2,
        ..Ceilings::default()
    };
    let update = write_program(
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
    let upsert = write_program(
        "upsertMovedCard",
        vec![Stmt::Upsert {
            table: "cards".to_owned(),
            key: Expr::Literal(id("card1")),
            row: literal_row(row([
                ("id", id("card1")),
                ("columnId", id("col2")),
                ("order", Value::Int(1)),
                ("title", text("A")),
            ])),
        }],
    );

    for program in [&update, &upsert] {
        let error = Checker::new(&schema, ceilings.clone())
            .check(program)
            .unwrap_err();
        assert_eq!(error.code, "E_BOUND");
        assert!(
            error
                .message
                .contains("write amplification 3 exceeds ceiling 2"),
            "{}",
            error.message
        );
    }

    let bulk_update = write_program(
        "moveManyCards",
        vec![Stmt::For {
            binding: "iteration".to_owned(),
            domain: LoopDomain::LiteralRange {
                start: 0,
                end_exclusive: 1_024,
            },
            body: update.body.clone(),
        }],
    );
    let error = checker(&schema).check(&bulk_update).unwrap_err();
    assert_eq!(error.code, "E_BOUND");
    assert!(
        error
            .message
            .contains("write amplification 3072 exceeds ceiling 2048"),
        "{}",
        error.message
    );
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
    assert_eq!(partial_prediction.reads, vec!["programs.thread.2"]);
    assert!(
        pair.prediction_sites
            .iter()
            .find(|site| site.mode == PredictionMode::Closed)
            .unwrap()
            .reads
            .contains(&"programs.thread.1".to_owned())
    );

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
        .find(|range| range.site == "programs.thread.0")
        .unwrap();
    assert!(thread_range.halo.is_some());
    assert!(thread_range.n2_suffix.is_some());

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
        LocalState::Partial(vec!["programs.thread.0".to_owned()])
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
        LocalState::Partial(vec!["programs.thread.2".to_owned()])
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
    assert!(
        certificate
            .write_sites
            .iter()
            .any(|site| { site.table == "unreads" && site.max_rows == 256 })
    );
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
            .seed(
                "users",
                row([
                    ("id", id(&user)),
                    ("principal", id(&user)),
                    ("handle", text(&user)),
                ]),
            )
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
        .seed(
            "users",
            row([
                ("id", id("u1")),
                ("principal", id("u1")),
                ("handle", text("sender")),
            ]),
        )
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
        let mut new_ids = vec![format!("fanout-message-{iteration}")];
        if iteration == 0 {
            new_ids.extend((0..256).map(|number| format!("fanout-unread-{number:03}")));
        }
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
                    new_ids,
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
    assert!(
        unread_rows
            .iter()
            .all(|row| row.field("value").unwrap() == &Value::Int(9))
    );
    assert!(p95 > Duration::ZERO);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertificationCorpusCase {
    name: String,
    schema: Schema,
    program: Program,
    certificate: Option<serde_json::Value>,
    expected: CertificationExpected,
    #[serde(default)]
    prelude: Vec<CertificationPrelude>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertificationExpected {
    error_reason: Option<String>,
    error_code: Option<String>,
    local_state: String,
}

#[derive(serde::Deserialize)]
struct CertificationPrelude {
    program: Program,
}

#[test]
fn every_frozen_corpus_case_replays_its_certification_outcome() {
    let cases: Vec<CertificationCorpusCase> =
        serde_json::from_str(include_str!("../../../corpus/manifest.json")).unwrap();
    let mut refusals = Vec::new();
    for case in &cases {
        if case.expected.local_state == "certification-refused" {
            let result = Generation::certify(
                &ProjectJson {
                    version: 1,
                    schema: case.schema.clone(),
                    programs: vec![case.program.clone()],
                    effects: Vec::new(),
                    auth: Auth::default(),
                },
                Ceilings::default(),
            );
            let expected = case.expected.error_code.as_deref();
            match result {
                Err(errors)
                    if errors.iter().any(|(_, error)| {
                        Some(error.code.as_str()) == expected
                            && case
                                .expected
                                .error_reason
                                .as_ref()
                                .is_none_or(|reason| error.message.contains(reason))
                    }) => {}
                outcome => refusals.push(format!(
                    "{}: expected certification refusal {:?}, got {outcome:?}",
                    case.name, expected
                )),
            }
            continue;
        }
        if case.certificate.is_none() {
            refusals.push(format!(
                "{}: certified case omitted its certificate",
                case.name
            ));
            continue;
        }
        let checker = Checker::new(&case.schema, Ceilings::default());
        if let Err(errors) = checker.check_all(&case.program) {
            refusals.push(format!("{}: {errors:?}", case.name));
        }
        for (index, prelude) in case.prelude.iter().enumerate() {
            if let Err(errors) = checker.check_all(&prelude.program) {
                refusals.push(format!("{} prelude {index}: {errors:?}", case.name));
            }
        }
    }
    assert_eq!(
        cases.len(),
        252,
        "the complete frozen corpus must be checked"
    );
    assert!(
        refusals.is_empty(),
        "corpus programs flipped from certified to refused:\n{}",
        refusals.join("\n")
    );
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
