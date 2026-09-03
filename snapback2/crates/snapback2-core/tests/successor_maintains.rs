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

fn generation(tables: BTreeMap<String, Table>, maintains: Vec<Maintain>) -> Generation {
    let programs = if tables.contains_key("totals") {
        vec![Program {
            name: "totals.get".to_owned(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
            read_time_granularity_ms: None,
            result_page_site: None,
            body: vec![Stmt::Return(Expr::Get(Read {
                site: "totals.get".to_owned(),
                table: "totals".to_owned(),
                index: "byId".to_owned(),
                key: vec![var("id")],
                provenance: KeyProvenance::Arg,
            }))],
        }]
    } else {
        Vec::new()
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: Schema {
                tables,
                maintains,
                channels: BTreeMap::new(),
                auth: Auth::default(),
                effects: Vec::new(),
            },
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn get(runtime: &mut Runtime, id: String) -> Value {
    runtime
        .execute(
            "totals.get",
            Context::query(
                Actor::user("u1").unwrap(),
                BTreeMap::from([("id".to_owned(), Value::Id(id))]),
            ),
        )
        .unwrap()
        .result
}

#[test]
fn successor_rebuilds_count_as_sum_then_clears_a_removed_maintain() {
    let expenses = table(
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
        &[("byId", &["id"])],
    );
    let tables = BTreeMap::from([
        ("expenses".to_owned(), expenses),
        ("totals".to_owned(), totals),
    ]);
    let count = Maintain {
        kind: MaintainKind::Count,
        source: "expenses".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(tables.clone(), vec![count]),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "expenses".to_owned(),
                object([
                    ("id", Value::Id("expense-1".to_owned())),
                    ("group", Value::Id("group-1".to_owned())),
                    ("amount", Value::Int(5)),
                ]),
            ),
            (
                "expenses".to_owned(),
                object([
                    ("id", Value::Id("expense-2".to_owned())),
                    ("group", Value::Id("group-1".to_owned())),
                    ("amount", Value::Int(7)),
                ]),
            ),
        ])
        .unwrap();
    let aggregate_id = canonical_json(&vec![Value::Id("group-1".to_owned())]);
    assert_eq!(
        get(&mut runtime, aggregate_id.clone()).field("value"),
        Ok(&Value::Int(2))
    );

    let sum = Maintain {
        kind: MaintainKind::Sum {
            of: "amount".to_owned(),
        },
        source: "expenses".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    runtime
        .apply_successor(generation(tables.clone(), vec![sum]))
        .unwrap();
    assert_eq!(
        get(&mut runtime, aggregate_id.clone()).field("value"),
        Ok(&Value::Int(12))
    );

    runtime
        .apply_successor(generation(tables, Vec::new()))
        .unwrap();
    assert_eq!(get(&mut runtime, aggregate_id), Value::Null);
}

#[test]
fn successor_group_key_change_removes_the_predecessor_projection() {
    let cards = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("bucket", ColumnType::Optional(Box::new(ColumnType::Id))),
        ],
        &[("byId", &["id"])],
    );
    let totals = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let base_tables = BTreeMap::from([
        ("cards".to_owned(), cards.clone()),
        ("totals".to_owned(), totals.clone()),
    ]);
    let count_by_group = Maintain {
        kind: MaintainKind::Count,
        source: "cards".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(base_tables, vec![count_by_group]),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("card-1".to_owned())),
                    ("group", Value::Id("group-1".to_owned())),
                    ("bucket", Value::Id("bucket-1".to_owned())),
                ]),
            ),
            (
                "cards".to_owned(),
                object([
                    ("id", Value::Id("card-2".to_owned())),
                    ("group", Value::Id("group-1".to_owned())),
                    ("bucket", Value::Id("bucket-2".to_owned())),
                ]),
            ),
        ])
        .unwrap();
    let old_id = canonical_json(&vec![Value::Id("group-1".to_owned())]);
    assert_eq!(
        get(&mut runtime, old_id.clone()).field("value"),
        Ok(&Value::Int(2))
    );

    let count_by_group_and_bucket = Maintain {
        kind: MaintainKind::Count,
        source: "cards".to_owned(),
        by: vec!["group".to_owned(), "bucket".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let mut next_totals = totals;
    next_totals.columns.insert(
        "bucket".to_owned(),
        ColumnType::Optional(Box::new(ColumnType::Id)),
    );
    let next_tables = BTreeMap::from([
        ("cards".to_owned(), cards),
        ("totals".to_owned(), next_totals),
    ]);
    runtime
        .apply_successor(generation(next_tables, vec![count_by_group_and_bucket]))
        .unwrap();

    assert_eq!(get(&mut runtime, old_id), Value::Null);
    for bucket in ["bucket-1", "bucket-2"] {
        let id = canonical_json(&vec![
            Value::Id("group-1".to_owned()),
            Value::Id(bucket.to_owned()),
        ]);
        assert_eq!(get(&mut runtime, id).field("value"), Ok(&Value::Int(1)));
    }
}

#[test]
fn migration_rebuilds_an_unchanged_maintain_when_group_types_change() {
    let source = table(
        &[("id", ColumnType::Id), ("group", ColumnType::Id)],
        &[("byId", &["id"])],
    );
    let target = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "events".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let base_tables = BTreeMap::from([
        ("events".to_owned(), source.clone()),
        ("totals".to_owned(), target.clone()),
    ]);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(base_tables, vec![maintain.clone()]),
    )
    .unwrap();
    runtime
        .seed(&[(
            "events".to_owned(),
            object([
                ("id", Value::Id("event-1".to_owned())),
                ("group", Value::Id("group-1".to_owned())),
            ]),
        )])
        .unwrap();
    let old_id = canonical_json(&vec![Value::Id("group-1".to_owned())]);
    assert_eq!(
        get(&mut runtime, old_id.clone()).field("value"),
        Ok(&Value::Int(1))
    );

    let optional_text = ColumnType::Optional(Box::new(ColumnType::Text { max: 20 }));
    let mut next_source = source;
    next_source
        .columns
        .insert("group".to_owned(), optional_text.clone());
    let mut next_target = target;
    next_target
        .columns
        .insert("group".to_owned(), optional_text);
    let next = generation(
        BTreeMap::from([
            ("events".to_owned(), next_source),
            ("totals".to_owned(), next_target),
        ]),
        vec![maintain],
    );
    let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
    runtime.apply_migration(next, &plan, 0).unwrap();

    assert_eq!(get(&mut runtime, old_id), Value::Null);
    let null_id = canonical_json(&vec![Value::Null]);
    assert_eq!(
        get(&mut runtime, null_id).field("value"),
        Ok(&Value::Int(1))
    );
}

#[test]
fn migration_accepts_dropping_a_removed_maintained_target_table() {
    let events = table(
        &[("id", ColumnType::Id), ("group", ColumnType::Id)],
        &[("byId", &["id"])],
    );
    let totals = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Id),
            ("value", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "events".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            BTreeMap::from([
                ("events".to_owned(), events.clone()),
                ("totals".to_owned(), totals),
            ]),
            vec![maintain],
        ),
    )
    .unwrap();
    runtime
        .seed(&[(
            "events".to_owned(),
            object([
                ("id", Value::Id("event-1".to_owned())),
                ("group", Value::Id("group-1".to_owned())),
            ]),
        )])
        .unwrap();

    let next = generation(BTreeMap::from([("events".to_owned(), events)]), Vec::new());
    let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
    runtime.apply_migration(next, &plan, 0).unwrap();
    assert!(runtime.generation().schema().table("totals").is_none());
}

#[test]
fn rebuilt_target_clears_stale_rows_before_a_new_unique_index_binds() {
    let expenses = table(
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
        &[("byId", &["id"])],
    );
    let count = Maintain {
        kind: MaintainKind::Count,
        source: "expenses".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    let base_tables = BTreeMap::from([
        ("expenses".to_owned(), expenses.clone()),
        ("totals".to_owned(), totals.clone()),
    ]);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(base_tables, vec![count]),
    )
    .unwrap();
    runtime
        .seed(&[
            (
                "expenses".to_owned(),
                object([
                    ("id", Value::Id("expense-a".to_owned())),
                    ("group", Value::Id("group-a".to_owned())),
                    ("amount", Value::Int(5)),
                ]),
            ),
            (
                "expenses".to_owned(),
                object([
                    ("id", Value::Id("expense-b".to_owned())),
                    ("group", Value::Id("group-b".to_owned())),
                    ("amount", Value::Int(7)),
                ]),
            ),
        ])
        .unwrap();

    let mut next_totals = totals;
    next_totals.indexes.insert(
        "byValue".to_owned(),
        Index {
            columns: vec!["value".to_owned()],
            unique: true,
        },
    );
    let sum = Maintain {
        kind: MaintainKind::Sum {
            of: "amount".to_owned(),
        },
        source: "expenses".to_owned(),
        by: vec!["group".to_owned()],
        target: "totals".to_owned(),
        readable: None,
    };
    runtime
        .apply_successor(generation(
            BTreeMap::from([
                ("expenses".to_owned(), expenses),
                ("totals".to_owned(), next_totals),
            ]),
            vec![sum],
        ))
        .unwrap();

    for (group, value) in [("group-a", 5), ("group-b", 7)] {
        let id = canonical_json(&vec![Value::Id(group.to_owned())]);
        assert_eq!(get(&mut runtime, id).field("value"), Ok(&Value::Int(value)));
    }
}
