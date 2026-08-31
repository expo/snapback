use snapback2_core::*;
use std::collections::BTreeMap;

fn project(handle_column: ColumnType, min: u32) -> ProjectJson {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("handle".to_owned(), handle_column),
            (
                "link".to_owned(),
                ColumnType::Optional(Box::new(ColumnType::Text { max: 200 })),
            ),
        ]),
        BTreeMap::new(),
    );
    table.constraints = vec![
        Constraint::Text {
            field: "handle".to_owned(),
            min,
            format: Some(TextFormat::Handle),
        },
        Constraint::Text {
            field: "link".to_owned(),
            min: 0,
            format: Some(TextFormat::Url),
        },
    ];
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([("profiles".to_owned(), table)]),
            ..Schema::default()
        },
        programs: vec![Program {
            name: "profiles.create".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                ("handle".to_owned(), ArgType::Text { max: 20 }),
                (
                    "link".to_owned(),
                    ArgType::Optional(Box::new(ArgType::Text { max: 200 })),
                ),
            ]),
            read_time_granularity_ms: None,
            body: vec![
                Stmt::Insert {
                    table: "profiles".to_owned(),
                    row: Expr::Object(BTreeMap::from([
                        ("id".to_owned(), Expr::Input(Input::NewId)),
                        ("handle".to_owned(), var("handle")),
                        ("link".to_owned(), var("link")),
                    ])),
                },
                Stmt::Return(Expr::Literal(Value::Null)),
            ],
        }],
        effects: Vec::new(),
        auth: Auth::default(),
    }
}

fn execute(handle: &str, link: Value) -> Execution {
    let generation = Generation::certify(
        &project(ColumnType::Text { max: 20 }, 3),
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let mut context = Context::mutation(
        Actor::user("user:one").unwrap(),
        BTreeMap::from([
            ("handle".to_owned(), Value::String(handle.to_owned())),
            ("link".to_owned(), link),
        ]),
    );
    context.new_ids.push_back("profile-1".to_owned());
    runtime.execute("profiles.create", context).unwrap()
}

#[test]
fn text_constraints_enforce_minimum_handle_alphabet_and_absolute_urls() {
    for (handle, link) in [
        ("alice_1", Value::String("https://example.com/a".to_owned())),
        ("bob", Value::Null),
    ] {
        assert!(matches!(
            execute(handle, link).state,
            ExecutionState::Committed { .. }
        ));
    }

    for (handle, link) in [
        ("ab", Value::Null),
        ("Alice", Value::Null),
        ("alice-dash", Value::Null),
        ("alice", Value::String("example.com".to_owned())),
        (
            "alice",
            Value::String("https://example.com/has space".to_owned()),
        ),
        (
            "alice",
            Value::String("https://example.com/has\u{00a0}space".to_owned()),
        ),
        (
            "alice",
            Value::String("https://example.com/has\u{0085}control".to_owned()),
        ),
    ] {
        assert!(matches!(
            execute(handle, link).state,
            ExecutionState::Rejected { ref code, .. } if code == "E_CONSTRAINT"
        ));
    }
}

#[test]
fn raw_schema_certification_rejects_non_text_and_impossible_minimums() {
    for project in [
        project(ColumnType::Int, 3),
        project(ColumnType::Text { max: 2 }, 3),
    ] {
        let errors = Generation::certify(&project, Ceilings::default()).unwrap_err();
        assert!(
            errors
                .iter()
                .any(|(_, error)| error.code == "E_SCHEMA_CONSTRAINT")
        );
    }
}
