use super::*;
use snapback2_core::{Ceilings, Checker, Engine, RuntimeError};

#[test]
fn startup_cleanup_guard_reaps_the_child_and_removes_every_test_path() {
    let root = std::env::temp_dir().join(format!(
        "snapback2-startup-cleanup-{}-{}",
        std::process::id(),
        timestamp()
    ));
    let scratch = root.join(".snapback/test-run-failed");
    let store = root.join(".snapback/test-failed.sqlite");
    fs::create_dir_all(&scratch).unwrap();
    fs::write(&store, b"test").unwrap();
    let child = Command::new("node")
        .args(["-e", "setInterval(() => {}, 1000)"])
        .spawn()
        .unwrap();
    let mut cleanup = OwnerCleanup {
        child: Some(child),
        scratch: scratch.clone(),
        store: store.clone(),
    };

    cleanup.clean();

    assert!(cleanup.child.is_none());
    assert!(!scratch.exists());
    assert!(!store.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn generated_args_exercises_every_arg_type_variant() {
    let program = Program {
        name: "all.args".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([
            ("id".to_owned(), ArgType::Id),
            ("text".to_owned(), ArgType::Text { max: 20 }),
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

    let args = generated_args(&program, &SeedData::default());

    assert_eq!(args.as_object().unwrap().len(), 12);
    assert_eq!(args["enum"], "first");
    assert_eq!(args["list"], json!([]));
    assert_eq!(args["decimal"], 100);
    assert_eq!(args["money"], 100);
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
fn bounds_failure_fixture_gets_e_trace_subset_from_the_engine() {
    let schema = snapback2_core::spike_schema();
    let program = snapback2_core::thread_program(10);
    let mut certificate = Checker::new(&schema, Ceilings::default())
        .check(&program)
        .unwrap();
    certificate.read_sites.clear();
    let mut engine = Engine::memory(schema).unwrap();
    let mut context = Context::query(
        "dev:alice",
        BTreeMap::from([(
            "conversationId".to_owned(),
            Value::Id("conversation-1".to_owned()),
        )]),
    );
    context.principal_kind = "persona".to_owned();

    let error = engine.execute(&program, &certificate, context).unwrap_err();

    assert_eq!(error.code(), "E_TRACE_SUBSET");
    assert!(matches!(error, RuntimeError::TraceSubset(_)));
}
