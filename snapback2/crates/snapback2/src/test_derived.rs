use super::*;
use snapback2_core::{Ceilings, Checker, Engine, RuntimeError, Value};

#[test]
fn generated_args_exercises_every_arg_type_variant() {
    let program = Program {
        name: "all.args".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([
            ("outboxId".to_owned(), ArgType::Id),
            (
                "todoRef".to_owned(),
                ArgType::Ref {
                    table: "todos".to_owned(),
                },
            ),
            ("text".to_owned(), ArgType::Text { max: 20 }),
            ("bytes".to_owned(), ArgType::Bytes { max: 20 }),
            ("int".to_owned(), ArgType::Int),
            ("bool".to_owned(), ArgType::Bool),
            ("time".to_owned(), ArgType::Time),
            ("json".to_owned(), ArgType::Json { max_bytes: 100 }),
            (
                "optional".to_owned(),
                ArgType::Optional(Box::new(ArgType::Text { max: 20 })),
            ),
            (
                "list".to_owned(),
                ArgType::List {
                    of: Some(Box::new(ArgType::Int)),
                    max: 4,
                },
            ),
            (
                "enum".to_owned(),
                ArgType::Enum {
                    variants: vec!["first".to_owned(), "second".to_owned()],
                },
            ),
            ("decimal".to_owned(), ArgType::Decimal { scale: 2 }),
            (
                "money".to_owned(),
                ArgType::Money {
                    currency: "USD".to_owned(),
                    scale: 2,
                },
            ),
            ("scalar".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![snapback2_core::Stmt::Return(snapback2_core::Expr::Literal(
            Value::Null,
        ))],
    };

    let seed = SeedData {
        personas: Vec::new(),
        rows: BTreeMap::from([("todos".to_owned(), vec![json!({ "id": "todo-1" })])]),
    };
    let args = generated_args(&program, &seed).unwrap();

    assert_eq!(args.as_object().unwrap().len(), 14);
    assert_eq!(args["todoRef"], "todo-1");
    assert_eq!(args["enum"], "first");
    assert_eq!(args["list"], json!([]));
    assert_eq!(args["decimal"], 100);
    assert_eq!(args["money"], 100);
}

#[test]
fn asset_probe_skip_recognizes_nested_asset_arguments_and_records_the_reason() {
    let program = Program {
        name: "assets.send".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([(
            "photos".to_owned(),
            ArgType::Optional(Box::new(ArgType::List {
                of: Some(Box::new(ArgType::Image { max: 5_000_000 })),
                max: 4,
            })),
        )]),
        read_time_granularity_ms: None,
        body: Vec::new(),
    };

    assert!(program_has_asset_arguments(&program));
    assert_eq!(
        asset_probe_skip(&program.name),
        json!({
            "op": "assets.send",
            "reason": "E_ASSET_PROBE_NEEDS_UPLOAD",
            "note": "asset-typed arguments are proven by an upload journey, not the generic prover",
        })
    );
}

#[test]
fn bare_named_id_uses_the_matching_seed_table_instead_of_btree_first() {
    let program = Program {
        name: "todos.byId".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("todoId".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![snapback2_core::Stmt::Return(snapback2_core::Expr::Literal(
            Value::Null,
        ))],
    };
    let seed = SeedData {
        personas: vec!["alice".to_owned()],
        rows: BTreeMap::from([
            (
                "conversations".to_owned(),
                vec![json!({ "id": "conversation-1" })],
            ),
            ("todos".to_owned(), vec![json!({ "id": "todo-1" })]),
        ]),
    };

    assert_eq!(generated_args(&program, &seed).unwrap()["todoId"], "todo-1");
}

#[test]
fn unmatched_named_id_blocks_instead_of_guessing_an_unrelated_seed_table() {
    let program = Program {
        name: "todos.byId".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("ownerId".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![snapback2_core::Stmt::Return(snapback2_core::Expr::Literal(
            Value::Null,
        ))],
    };
    let seed = SeedData {
        personas: Vec::new(),
        rows: BTreeMap::from([("todos".to_owned(), vec![json!({ "id": "todo-1" })])]),
    };

    assert_eq!(
        generated_args(&program, &seed).unwrap_err(),
        "cannot choose a seed id for todos.byId.ownerId"
    );
}

#[test]
fn bounds_failure_preserves_the_engine_error_code() {
    let failure = engine_failure(
        "todos.list",
        "alice",
        json!({ "code": "E_AUTH_PERSONA_UNKNOWN", "message": "unknown persona" }),
    );

    assert_eq!(failure["code"], "E_AUTH_PERSONA_UNKNOWN");
    assert!(failure.get("failureCode").is_none(), "{failure}");
}

#[test]
fn rules_equality_rejects_extra_and_missing_visible_rows() {
    let expected = BTreeSet::from(["seed".to_owned()]);
    assert!(!rule_id_sets_match(
        &BTreeSet::from(["ghost".to_owned(), "seed".to_owned()]),
        &expected,
    ));
    assert!(!rule_id_sets_match(&BTreeSet::new(), &expected));
}

#[test]
fn maintained_rule_probe_requires_a_seeded_declared_source() {
    let maintain = snapback2_core::Maintain {
        kind: snapback2_core::MaintainKind::Count,
        source: "messages".to_owned(),
        by: vec!["conversationId".to_owned()],
        target: "messageCounts".to_owned(),
        readable: None,
    };
    let seeded = SeedData {
        personas: Vec::new(),
        rows: BTreeMap::from([(
            "messages".to_owned(),
            vec![json!({ "id": "message-1", "conversationId": "conversation-1" })],
        )]),
    };
    assert!(test_policy::rule_table_has_probe_rows(
        "messageCounts",
        &seeded,
        std::slice::from_ref(&maintain),
    ));
    assert!(!test_policy::rule_table_has_probe_rows(
        "unmaintained",
        &seeded,
        std::slice::from_ref(&maintain),
    ));
    assert!(!test_policy::rule_table_has_probe_rows(
        "messageCounts",
        &SeedData::default(),
        &[maintain],
    ));
}

#[test]
fn invalidation_probe_selects_a_recipient_from_the_selected_conversation() {
    let program = Program {
        name: "messages.send".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            (
                "conversationId".to_owned(),
                ArgType::Ref {
                    table: "conversations".to_owned(),
                },
            ),
            (
                "recipientId".to_owned(),
                ArgType::Ref {
                    table: "profiles".to_owned(),
                },
            ),
        ]),
        read_time_granularity_ms: None,
        body: Vec::new(),
    };
    let seeded = SeedData {
        personas: vec!["alice".to_owned(), "bob".to_owned()],
        rows: BTreeMap::from([
            (
                "memberships".to_owned(),
                vec![json!({ "conversationId": "conversation-2", "principal": "dev:alice" })],
            ),
            (
                "profiles".to_owned(),
                vec![
                    json!({ "id": "profile-alice", "principal": "dev:alice" }),
                    json!({ "id": "profile-bob", "principal": "dev:bob" }),
                ],
            ),
        ]),
    };
    let mut related = json!({
        "conversationId": "conversation-2",
        "recipientId": "profile-bob",
    });
    specialize_probe_args(&program, &seeded, 0, "alice", &mut related).unwrap();
    assert_eq!(related["recipientId"], "profile-alice");

    let mut fallback = json!({
        "conversationId": "conversation-unknown",
        "recipientId": "profile-bob",
    });
    specialize_probe_args(&program, &seeded, 0, "alice", &mut fallback).unwrap();
    assert_eq!(fallback["recipientId"], "profile-bob");
}

#[test]
fn bounds_failure_fixture_gets_e_trace_subset_from_the_engine() {
    let schema = snapback2_core::spike_schema();
    let program = snapback2_core::thread_program(10);
    let mut certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    certificate.read_sites.clear();
    let mut engine = Engine::memory(schema).unwrap();
    let context = Context::query(
        Actor::persona("alice").unwrap(),
        BTreeMap::from([(
            "conversationId".to_owned(),
            Value::Id("conversation-1".to_owned()),
        )]),
    );

    let error = engine.execute(&program, &certificate, context).unwrap_err();

    assert_eq!(error.code(), "E_TRACE_SUBSET");
    assert!(matches!(error, RuntimeError::TraceSubset(_)));
}
