use snapback2_core::*;
use std::collections::BTreeMap;

fn table(columns: &[(&str, ColumnType)], indexes: &[(&str, &[&str])]) -> Table {
    public_table(
        columns
            .iter()
            .map(|(name, kind)| ((*name).to_owned(), kind.clone()))
            .collect(),
        indexes
            .iter()
            .map(|(name, columns)| {
                (
                    (*name).to_owned(),
                    Index {
                        columns: columns.iter().map(|column| (*column).to_owned()).collect(),
                        unique: false,
                    },
                )
            })
            .collect(),
    )
}

fn schema(tables: BTreeMap<String, Table>, maintains: Vec<Maintain>) -> Schema {
    Schema {
        tables,
        maintains,
        channels: BTreeMap::new(),
        auth: Auth::default(),
        effects: Vec::new(),
    }
}

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn get_program(name: &str, table: &str, index: &str, key: &str) -> Program {
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([(key.to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: name.to_owned(),
            table: table.to_owned(),
            index: index.to_owned(),
            key: vec![var(key)],
            provenance: KeyProvenance::Arg,
        }))],
    }
}

#[test]
fn additive_successor_adds_table_column_index_and_program_in_place() {
    let base_items = table(
        &[
            ("id", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ],
        &[("byId", &["id"])],
    );
    let base_schema = schema(
        BTreeMap::from([("items".to_owned(), base_items.clone())]),
        Vec::new(),
    );
    let base = generation(
        base_schema,
        vec![get_program("items.get", "items", "byId", "id")],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("i1".to_owned())),
                ("name", Value::String("one".to_owned())),
            ]),
        )])
        .unwrap();

    let mut next_items = base_items;
    next_items.columns.insert(
        "note".to_owned(),
        ColumnType::Optional(Box::new(ColumnType::Text { max: 64 })),
    );
    next_items.indexes.insert(
        "byName".to_owned(),
        Index {
            columns: vec!["name".to_owned()],
            unique: false,
        },
    );
    let logs = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let next_schema = schema(
        BTreeMap::from([("items".to_owned(), next_items), ("logs".to_owned(), logs)]),
        Vec::new(),
    );
    let next = generation(
        next_schema,
        vec![
            get_program("items.get", "items", "byId", "id"),
            get_program("items.byName", "items", "byName", "name"),
            Program {
                name: "items.addNote".to_owned(),
                kind: ProgramKind::Mutation,
                args: BTreeMap::new(),
                read_time_granularity_ms: None,
                body: vec![Stmt::Update {
                    table: "items".to_owned(),
                    key: Expr::Literal(Value::Id("i1".to_owned())),
                    patch: Expr::Literal(object([(
                        "note",
                        Value::String("added later".to_owned()),
                    )])),
                }],
            },
        ],
    );
    let report = runtime.apply_successor(next).unwrap();
    assert_eq!(report.added_tables, vec!["logs"]);
    assert!(report.added_columns.contains(&"items.note".to_owned()));
    assert!(report.added_indexes.contains(&"items.byName".to_owned()));

    let updated = runtime
        .execute("items.addNote", Context::mutation("u1", BTreeMap::new()))
        .unwrap();
    assert!(matches!(updated.state, ExecutionState::Committed { .. }));

    let execution = runtime
        .execute(
            "items.byName",
            Context::query(
                "u1",
                BTreeMap::from([("name".to_owned(), Value::String("one".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(
        execution.result.field("id").unwrap(),
        &Value::Id("i1".to_owned())
    );
    assert_eq!(
        execution.result.field("note").unwrap(),
        &Value::String("added later".to_owned())
    );
}

#[test]
fn new_maintained_aggregate_is_backfilled_from_existing_rows() {
    let cards = table(
        &[("id", ColumnType::Id), ("group", ColumnType::Id)],
        &[("byId", &["id"])],
    );
    let counts = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    let tables = BTreeMap::from([("cards".to_owned(), cards), ("counts".to_owned(), counts)]);
    let base = generation(schema(tables.clone(), Vec::new()), Vec::new());
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("c1".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                ]),
            ),
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("c2".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                ]),
            ),
        ])
        .unwrap();
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "cards".to_owned(),
        by: vec!["group".to_owned()],
        target: "counts".to_owned(),
        readable: None,
    };
    let next = generation(
        schema(tables, vec![maintain]),
        vec![get_program("counts.get", "counts", "byGroup", "group")],
    );
    let report = runtime.apply_successor(next).unwrap();
    assert_eq!(report.backfilled_maintains, 1);
    let execution = runtime
        .execute(
            "counts.get",
            Context::query(
                "u1",
                BTreeMap::from([("group".to_owned(), Value::Id("g1".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(execution.result.field("value").unwrap(), &Value::Int(2));

    let seq = runtime
        .seed(&[(
            "cards".to_owned(),
            object([
                ("id", Value::Id("c3".to_owned())),
                ("group", Value::Id("g1".to_owned())),
            ]),
        )])
        .unwrap();
    let commit = runtime.store().commits_since(seq - 1, 1).unwrap().remove(0);
    assert_eq!(commit.kind, "seed");
    assert_eq!(commit.writes.get("counts"), Some(&1));
    assert_eq!(
        commit
            .touched
            .iter()
            .filter(|key| key.table == "counts" && key.index == "byGroup")
            .count(),
        2,
        "maintained updates trace the aggregate's before and after keys"
    );
}

#[test]
fn destructive_successor_reports_all_drops_and_applies_only_that_plan() {
    let items = table(
        &[
            ("id", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ],
        &[("byId", &["id"])],
    );
    let base = generation(
        schema(BTreeMap::from([("items".to_owned(), items)]), Vec::new()),
        Vec::new(),
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("i1".to_owned())),
                ("name", Value::String("one".to_owned())),
            ]),
        )])
        .unwrap();
    let next = generation(schema(BTreeMap::new(), Vec::new()), Vec::new());
    let refusal = runtime.apply_successor(next.clone()).unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    assert_eq!(
        refusal.plan.drops,
        vec![Drop::Table {
            name: "items".to_owned(),
            rows: 1,
        }]
    );
    runtime.apply_migration(next, &refusal.plan).unwrap();
    assert!(runtime.generation().schema.tables.is_empty());
}

#[test]
fn required_column_on_populated_table_is_refused() {
    let items = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let base = generation(
        schema(
            BTreeMap::from([("items".to_owned(), items.clone())]),
            Vec::new(),
        ),
        Vec::new(),
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([("id", Value::Id("i1".to_owned()))]),
        )])
        .unwrap();
    let mut next_items = items;
    next_items
        .columns
        .insert("name".to_owned(), ColumnType::Text { max: 64 });
    let refusal = runtime
        .apply_successor(generation(
            schema(
                BTreeMap::from([("items".to_owned(), next_items)]),
                Vec::new(),
            ),
            Vec::new(),
        ))
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_COLUMN_REQUIRED");
    assert!(refusal.message.contains("items.name"));
    assert!(refusal.rewrite.contains("t.optional"));
}

#[test]
fn new_unique_index_reports_conflicting_keys_without_changing_generation() {
    let items = table(
        &[
            ("id", ColumnType::Id),
            ("name", ColumnType::Text { max: 64 }),
        ],
        &[("byId", &["id"])],
    );
    let base = generation(
        schema(
            BTreeMap::from([("items".to_owned(), items.clone())]),
            Vec::new(),
        ),
        Vec::new(),
    );
    let original_hash = base.hash.clone();
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[
            (
                "items".to_owned(),
                object([
                    ("id", Value::Id("i1".to_owned())),
                    ("name", Value::String("same".to_owned())),
                ]),
            ),
            (
                "items".to_owned(),
                object([
                    ("id", Value::Id("i2".to_owned())),
                    ("name", Value::String("same".to_owned())),
                ]),
            ),
        ])
        .unwrap();
    let mut next_items = items;
    next_items.indexes.insert(
        "byName".to_owned(),
        Index {
            columns: vec!["name".to_owned()],
            unique: true,
        },
    );
    let refusal = runtime
        .apply_successor(generation(
            schema(
                BTreeMap::from([("items".to_owned(), next_items)]),
                Vec::new(),
            ),
            Vec::new(),
        ))
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_UNIQUE");
    assert_eq!(
        refusal.conflicts,
        vec![UniqueConflict {
            table: "items".to_owned(),
            index: "byName".to_owned(),
            key: vec![Value::String("same".to_owned())],
        }]
    );
    assert!(refusal.rewrite.contains("non-unique"));
    assert_eq!(runtime.generation().hash, original_hash);
}

#[test]
fn failed_migration_rolls_back_drops_backfill_and_generation_metadata() {
    let archive = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let amounts = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("amount", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let totals = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byGroup", &["group"])],
    );
    let base = generation(
        schema(
            BTreeMap::from([
                ("archive".to_owned(), archive),
                ("amounts".to_owned(), amounts.clone()),
                ("totals".to_owned(), totals.clone()),
            ]),
            Vec::new(),
        ),
        vec![get_program("archive.get", "archive", "byId", "id")],
    );
    let original_hash = base.hash.clone();
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    runtime
        .seed(&[
            (
                "archive".to_owned(),
                object([("id", Value::Id("kept".to_owned()))]),
            ),
            (
                "amounts".to_owned(),
                object([
                    ("id", Value::Id("a1".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                    ("amount", Value::Int(I53_MAX)),
                ]),
            ),
            (
                "amounts".to_owned(),
                object([
                    ("id", Value::Id("a2".to_owned())),
                    ("group", Value::Id("g1".to_owned())),
                    ("amount", Value::Int(I53_MAX)),
                ]),
            ),
        ])
        .unwrap();
    let next = generation(
        schema(
            BTreeMap::from([
                ("amounts".to_owned(), amounts),
                ("totals".to_owned(), totals),
            ]),
            vec![Maintain {
                kind: MaintainKind::Sum {
                    of: "amount".to_owned(),
                },
                source: "amounts".to_owned(),
                by: vec!["group".to_owned()],
                target: "totals".to_owned(),
                readable: None,
            }],
        ),
        Vec::new(),
    );
    let refusal = runtime.apply_successor(next.clone()).unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
    let error = runtime.apply_migration(next, &refusal.plan).unwrap_err();
    assert!(matches!(error, RuntimeError::Constraint(message) if message.contains("overflow")));
    assert_eq!(runtime.generation().hash, original_hash);
    assert_eq!(
        runtime.store().meta("generation").unwrap().as_deref(),
        Some(original_hash.as_str())
    );
    let kept = runtime
        .execute(
            "archive.get",
            Context::query(
                "u1",
                BTreeMap::from([("id".to_owned(), Value::Id("kept".to_owned()))]),
            ),
        )
        .unwrap();
    assert_eq!(
        kept.result.field("id").unwrap(),
        &Value::Id("kept".to_owned())
    );
}

#[test]
fn optional_and_list_column_types_validate_and_list_indexes_are_refused() {
    let optional = ColumnType::Optional(Box::new(ColumnType::Text { max: 8 }));
    let list = ColumnType::List {
        of: Box::new(ColumnType::Int),
        max: 2,
    };
    assert_eq!(
        serde_json::to_value(&optional).unwrap(),
        serde_json::json!({ "Optional": { "Text": { "max": 8 } } })
    );
    assert_eq!(
        serde_json::to_value(&list).unwrap(),
        serde_json::json!({ "List": { "of": "Int", "max": 2 } })
    );

    let rows = table(
        &[
            ("id", ColumnType::Id),
            ("note", optional.clone()),
            ("values", list.clone()),
        ],
        &[("byId", &["id"]), ("byNote", &["note"])],
    );
    let rows_schema = schema(BTreeMap::from([("rows".to_owned(), rows)]), Vec::new());
    let mut engine = Engine::memory(rows_schema.clone()).unwrap();
    engine
        .seed(
            "rows",
            object([
                ("id", Value::Id("r1".to_owned())),
                ("values", Value::Array(vec![Value::Int(1), Value::Int(2)])),
            ]),
        )
        .unwrap();
    let get_null = Program {
        name: "rows.byNullNote".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Get(Read {
            site: "rows.byNullNote".to_owned(),
            table: "rows".to_owned(),
            index: "byNote".to_owned(),
            key: vec![Expr::Literal(Value::Null)],
            provenance: KeyProvenance::Const,
        }))],
    };
    let certificate = Checker::new(&rows_schema, Ceilings::default())
        .check(&get_null)
        .unwrap();
    let null_indexed = engine
        .execute(
            &get_null,
            &certificate,
            Context::query("u1", BTreeMap::new()),
        )
        .unwrap();
    assert_ne!(null_indexed.result, Value::Null);
    engine
        .seed(
            "rows",
            object([
                ("id", Value::Id("r2".to_owned())),
                ("note", Value::Null),
                ("values", Value::Array(Vec::new())),
            ]),
        )
        .unwrap();
    assert!(
        engine
            .seed(
                "rows",
                object([
                    ("id", Value::Id("too-many".to_owned())),
                    (
                        "values",
                        Value::Array(vec![Value::Int(1), Value::Int(2), Value::Int(3)]),
                    ),
                ]),
            )
            .is_err()
    );
    assert!(
        engine
            .seed(
                "rows",
                object([
                    ("id", Value::Id("wrong-element".to_owned())),
                    (
                        "values",
                        Value::Array(vec![Value::String("not an int".to_owned())]),
                    ),
                ]),
            )
            .is_err()
    );

    let indexed_list = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("values".to_owned(), ColumnType::Optional(Box::new(list))),
        ]),
        BTreeMap::from([(
            "byValues".to_owned(),
            Index {
                columns: vec!["values".to_owned()],
                unique: false,
            },
        )]),
    );
    let invalid = schema(
        BTreeMap::from([("rows".to_owned(), indexed_list)]),
        Vec::new(),
    );
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: invalid.clone(),
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap_err();
    assert!(
        errors
            .iter()
            .any(|(_, error)| error.code == "E_SCHEMA_INDEX_COLUMN")
    );
    assert!(matches!(
        Engine::memory(invalid),
        Err(RuntimeError::SchemaIndexColumn { .. })
    ));
}
