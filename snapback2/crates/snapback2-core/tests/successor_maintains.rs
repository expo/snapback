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
                schedules: Vec::new(),
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
fn widening_a_maintained_text_group_preserves_the_projection_and_its_identity() {
    let source = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Text { max: 80 }),
        ],
        &[("byId", &["id"])],
    );
    let target = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Text { max: 80 }),
            ("value", ColumnType::Int),
        ],
        &[("byId", &["id"])],
    );
    let maintain = Maintain {
        kind: MaintainKind::Count,
        source: "events".into(),
        by: vec!["group".into()],
        target: "totals".into(),
        readable: None,
    };
    let mut tables = BTreeMap::from([("events".into(), source), ("totals".into(), target)]);
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(tables.clone(), vec![maintain.clone()]),
    )
    .unwrap();
    let group = Value::String("x".repeat(80));
    runtime
        .seed(&[(
            "events".into(),
            object([
                ("id", Value::Id("event-1".into())),
                ("group", group.clone()),
            ]),
        )])
        .unwrap();
    let id = canonical_json(&vec![group]);
    let before = get(&mut runtime, id.clone());
    let seq = runtime.store().commit_seq().unwrap();
    for table in tables.values_mut() {
        table
            .columns
            .insert("group".into(), ColumnType::Text { max: 2000 });
    }
    runtime
        .apply_successor(generation(tables, vec![maintain]))
        .unwrap();
    assert_eq!(get(&mut runtime, id), before);
    assert_eq!(runtime.store().commit_seq().unwrap(), seq);
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

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — a rebuild
// preserves non-projection rows, which must still pass successor admission.
fn survivor_fixture(group: &str) -> (Runtime, BTreeMap<String, Table>, Maintain) {
    let source = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Text { max: 80 }),
        ],
        &[("byId", &["id"])],
    );
    let mut target = source.clone();
    target.columns.insert("value".into(), ColumnType::Int);
    target.indexes.insert(
        "byGroup".into(),
        Index {
            columns: vec!["group".into()],
            unique: true,
        },
    );
    let tables = BTreeMap::from([
        ("events".into(), source.clone()),
        ("archive".into(), source),
        ("totals".into(), target),
    ]);
    let maintain = Maintain {
        source: "events".into(),
        target: "totals".into(),
        by: vec!["group".into()],
        kind: MaintainKind::Count,
        readable: None,
    };
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    runtime
        .seed(&[
            (
                "events".into(),
                object([
                    ("id", Value::Id("event".into())),
                    ("group", Value::String("valid".into())),
                ]),
            ),
            (
                "archive".into(),
                object([
                    ("id", Value::Id("archived".into())),
                    ("group", Value::String("history".into())),
                ]),
            ),
            (
                "totals".into(),
                object([
                    ("id", Value::Id("legacy".into())),
                    ("group", Value::String(group.into())),
                    ("value", Value::Int(9)),
                ]),
            ),
        ])
        .unwrap();
    runtime
        .apply_successor(generation(tables.clone(), vec![maintain.clone()]))
        .unwrap();
    (runtime, tables, maintain)
}

// A read-only backup observes durable metadata and every base/target/archive
// row and index entry, including entries not exercised by the byId query.
fn stored_observations(runtime: &Runtime) -> Vec<Vec<Vec<String>>> {
    store_observations(runtime.store())
}

fn store_observations(store: &Store) -> Vec<Vec<Vec<String>>> {
    let path = std::env::temp_dir().join(format!(
        "s2-survivor-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    store.snapshot_to(&path).unwrap();
    let connection =
        rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let observations = [
        "SELECT key, value FROM _meta ORDER BY key",
        "SELECT table_name, row_id, data FROM rows ORDER BY table_name, row_id",
        "SELECT table_name, index_name, row_id, quote(c0), quote(c1), quote(c2), quote(c3), quote(c4), quote(c5), quote(c6), quote(c7) FROM index_entries ORDER BY table_name, index_name, row_id",
    ].into_iter().map(|sql| {
        let mut statement = connection.prepare(sql).unwrap();
        let count = statement.column_count();
        statement.query_map([], |row| (0..count).map(|i| row.get::<_, String>(i)).collect()).unwrap()
            .collect::<Result<Vec<_>, _>>().unwrap()
    }).collect();
    drop(connection);
    std::fs::remove_file(path).unwrap();
    observations
}

fn constrained_groups(
    tables: &BTreeMap<String, Table>,
    max: u32,
    format: Option<TextFormat>,
) -> BTreeMap<String, Table> {
    let mut next = tables.clone();
    for name in ["events", "totals"] {
        let table = next.get_mut(name).unwrap();
        table
            .columns
            .insert("group".into(), ColumnType::Text { max });
        table.constraints.push(Constraint::Text {
            field: "group".into(),
            min: 2,
            format,
        });
    }
    next
}

#[test]
fn additive_rebuild_refuses_invalid_survivors_with_and_without_widening() {
    for (group, format) in [("x", None), ("bad handle", Some(TextFormat::Handle))] {
        let (mut runtime, tables, maintain) = survivor_fixture(group);
        let before = stored_observations(&runtime);
        let hash = runtime.generation().hash();
        let seq = runtime.store().commit_seq().unwrap();
        for max in [80, 2000] {
            let next = generation(
                constrained_groups(&tables, max, format),
                vec![maintain.clone()],
            );
            let refusal = runtime
                .apply_successor(next)
                .expect_err("an invalid non-projection survivor must refuse");
            assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
            assert_eq!(refusal.site.as_deref(), Some("totals.legacy"));
            assert_eq!(runtime.generation().hash(), hash);
            assert_eq!(runtime.store().commit_seq().unwrap(), seq);
            assert_eq!(stored_observations(&runtime), before);
        }
    }
}

#[test]
fn exact_archive_drop_rolls_back_when_a_rebuilt_target_survivor_is_invalid() {
    let (mut runtime, tables, maintain) = survivor_fixture("x");
    let before = stored_observations(&runtime);
    let hash = runtime.generation().hash();
    let seq = runtime.store().commit_seq().unwrap();
    let mut next = constrained_groups(&tables, 2000, None);
    next.remove("archive");
    let next = generation(next, vec![maintain]);
    let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
    assert_eq!(
        plan.drops,
        vec![Drop::Table {
            name: "archive".into(),
            rows: 1
        }]
    );
    let error = runtime
        .apply_migration(next, &plan, 123)
        .expect_err("survivor refusal must roll back the archive drop");
    let RuntimeError::Successor(refusal) = error else {
        panic!("{error}")
    };
    assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
    assert_eq!(refusal.site.as_deref(), Some("totals.legacy"));
    assert_eq!(runtime.generation().hash(), hash);
    assert_eq!(runtime.store().commit_seq().unwrap(), seq);
    assert_eq!(stored_observations(&runtime), before);
}

#[test]
fn valid_survivors_keep_projection_ids_and_unrelated_historical_fields() {
    for migration in [false, true] {
        let (runtime, tables, maintain) = survivor_fixture("legacy_ok");
        // Synthetic historical fixture only: same-generation reopening must not
        // reinterpret an undeclared old field, even on a future rebuilt target.
        let path = std::env::temp_dir().join(format!(
            "s2-historical-target-{}-{migration}.sqlite",
            std::process::id()
        ));
        runtime.store().snapshot_to(&path).unwrap();
        let generation_before = runtime.generation().clone();
        drop(runtime);
        let connection = rusqlite::Connection::open(&path).unwrap();
        let data: String = connection
            .query_row(
                "SELECT data FROM rows WHERE table_name = 'totals' AND row_id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let mut value: Value = serde_json::from_str(&data).unwrap();
        let Value::Row(fields) = &mut value else {
            panic!("expected row")
        };
        fields.insert("historical".into(), Value::Id("system".into()));
        connection
            .execute(
                "UPDATE rows SET data = ?1 WHERE table_name = 'totals' AND row_id = 'legacy'",
                [canonical_json(&value)],
            )
            .unwrap();
        drop(connection);
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation_before).unwrap();
        let before = stored_observations(&runtime);
        let seq = runtime.store().commit_seq().unwrap();
        let projection_id = canonical_json(&vec![Value::String("valid".into())]);
        let projection = get(&mut runtime, projection_id.clone());
        let legacy = get(&mut runtime, "legacy".into());
        let mut next = constrained_groups(&tables, 2000, Some(TextFormat::Handle));
        if migration {
            next.remove("archive");
        }
        let next = generation(next, vec![maintain]);
        let next_hash = next.hash();
        if migration {
            let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
            runtime.apply_migration(next, &plan, 123).unwrap();
        } else {
            runtime.apply_successor(next).unwrap();
        }
        assert_eq!(runtime.generation().hash(), next_hash);
        assert_eq!(
            runtime.store().meta("generation").unwrap().as_deref(),
            Some(next_hash.as_str())
        );
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        assert_eq!(get(&mut runtime, projection_id), projection);
        assert_eq!(get(&mut runtime, "legacy".into()), legacy);
        let after = stored_observations(&runtime);
        for index in [1, 2] {
            let retained = before[index]
                .iter()
                .filter(|row| !migration || row[0] != "archive")
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(after[index], retained);
        }
        drop(runtime);
        std::fs::remove_file(path).unwrap();
    }
}

#[test]
fn new_required_target_fields_exempt_only_replaced_projection_ids() {
    for migration in [false, true] {
        for survivor in [false, true] {
            let source = table(
                &[
                    ("id", ColumnType::Id),
                    ("group", ColumnType::Text { max: 80 }),
                ],
                &[("byId", &["id"])],
            );
            let tables = BTreeMap::from([
                ("events".into(), source.clone()),
                ("totals".into(), source.clone()),
                ("archive".into(), source),
            ]);
            let mut runtime =
                Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![]))
                    .unwrap();
            let id = canonical_json(&vec![Value::String("valid".into())]);
            let mut rows = vec![
                (
                    "events".into(),
                    object([
                        ("id", Value::Id("event".into())),
                        ("group", Value::String("valid".into())),
                    ]),
                ),
                (
                    "archive".into(),
                    object([
                        ("id", Value::Id("archived".into())),
                        ("group", Value::String("history".into())),
                    ]),
                ),
                // The successor projection owns this ID, although the ordinary
                // predecessor row lacks value and fails the new group minimum.
                (
                    "totals".into(),
                    object([
                        ("id", Value::Id(id.clone())),
                        ("group", Value::String("x".into())),
                    ]),
                ),
            ];
            if survivor {
                rows.push((
                    "totals".into(),
                    object([
                        ("id", Value::Id("legacy".into())),
                        ("group", Value::String("legacy_ok".into())),
                    ]),
                ));
            }
            runtime.seed(&rows).unwrap();
            let before = stored_observations(&runtime);
            let hash = runtime.generation().hash();
            let seq = runtime.store().commit_seq().unwrap();
            let mut next = constrained_groups(&tables, 2000, None);
            next.get_mut("totals")
                .unwrap()
                .columns
                .insert("value".into(), ColumnType::Int);
            if migration {
                next.remove("archive");
            }
            let next = generation(
                next,
                vec![Maintain {
                    source: "events".into(),
                    target: "totals".into(),
                    by: vec!["group".into()],
                    kind: MaintainKind::Count,
                    readable: None,
                }],
            );
            let result = if migration {
                let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
                runtime.apply_migration(next, &plan, 123).map_err(|error| {
                    let RuntimeError::Successor(refusal) = error else {
                        panic!("{error}")
                    };
                    *refusal
                })
            } else {
                runtime.apply_successor(next)
            };
            if survivor {
                assert_eq!(result.unwrap_err().code, "E_SUCCESSOR_COLUMN_REQUIRED");
                assert_eq!(runtime.generation().hash(), hash);
                assert_eq!(stored_observations(&runtime), before);
            } else {
                result.unwrap();
                assert_eq!(
                    get(&mut runtime, id),
                    object([
                        (
                            "id",
                            Value::Id(canonical_json(&vec![Value::String("valid".into())]))
                        ),
                        ("group", Value::String("valid".into())),
                        ("value", Value::Int(1)),
                    ])
                );
            }
            assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        }
    }
}

#[test]
fn required_source_admission_precedes_successor_projection() {
    let empty = table(&[("id", ColumnType::Id)], &[("byId", &["id"])]);
    let mut tables = BTreeMap::from([("events".into(), empty.clone()), ("totals".into(), empty)]);
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    runtime
        .seed(&[("events".into(), object([("id", Value::Id("event".into()))]))])
        .unwrap();
    let before = stored_observations(&runtime);
    for table in tables.values_mut() {
        table
            .columns
            .insert("group".into(), ColumnType::Text { max: 80 });
    }
    tables
        .get_mut("totals")
        .unwrap()
        .columns
        .insert("value".into(), ColumnType::Int);
    let next = generation(
        tables,
        vec![Maintain {
            source: "events".into(),
            target: "totals".into(),
            by: vec!["group".into()],
            kind: MaintainKind::Count,
            readable: None,
        }],
    );
    assert_eq!(
        runtime.apply_successor(next).unwrap_err().code,
        "E_SUCCESSOR_COLUMN_REQUIRED"
    );
    assert_eq!(stored_observations(&runtime), before);
}

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — a target
// retired by one rebuild may be the next rebuild's ordinary source.
fn retirement_fixture(retired: &str, target: &str, group: &str) -> (Runtime, Generation) {
    let source = table(
        &[
            ("id", ColumnType::Id),
            ("group", ColumnType::Text { max: 80 }),
        ],
        &[("byId", &["id"])],
    );
    let mut total = source.clone();
    total.columns.insert("value".into(), ColumnType::Int);
    total.indexes.insert(
        "byGroup".into(),
        Index {
            columns: vec!["group".into()],
            unique: true,
        },
    );
    let mut tables = BTreeMap::from([
        ("events".into(), source.clone()),
        ("archive".into(), source),
        (retired.into(), total.clone()),
        (target.into(), total),
    ]);
    let predecessor = generation(
        tables.clone(),
        vec![Maintain {
            source: "events".into(),
            target: retired.into(),
            by: vec!["group".into()],
            kind: MaintainKind::Count,
            readable: None,
        }],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), predecessor).unwrap();
    let id = canonical_json(&vec![Value::String("valid".into())]);
    // Certified schemas and author-declared seed data only; no raw row injection.
    runtime
        .seed(&[
            (
                "events".into(),
                object([
                    ("id", Value::Id("event".into())),
                    ("group", Value::String("valid".into())),
                ]),
            ),
            (
                "archive".into(),
                object([
                    ("id", Value::Id("archived".into())),
                    ("group", Value::String("history".into())),
                ]),
            ),
            (
                target.into(),
                object([
                    ("id", Value::Id(id)),
                    ("group", Value::String(group.into())),
                    ("value", Value::Int(9)),
                ]),
            ),
        ])
        .unwrap();
    for name in [retired, target] {
        let table = tables.get_mut(name).unwrap();
        table
            .columns
            .insert("group".into(), ColumnType::Text { max: 2000 });
        table.constraints.push(Constraint::Text {
            field: "group".into(),
            min: 2,
            format: None,
        });
    }
    let next = generation(
        tables,
        vec![Maintain {
            source: retired.into(),
            target: target.into(),
            by: vec!["group".into()],
            kind: MaintainKind::Count,
            readable: None,
        }],
    );
    (runtime, next)
}

fn retirement_refusal(migration: bool) {
    let (mut runtime, mut next) = retirement_fixture("aTotals", "zTotals", "x");
    if migration {
        let mut tables = next.schema().tables.clone();
        tables.remove("archive");
        next = generation(tables, next.schema().maintains.clone());
    }
    let before = stored_observations(&runtime);
    let hash = runtime.generation().hash();
    let seq = runtime.store().commit_seq().unwrap();
    println!(
        "certified predecessor={hash} successor={} migration={migration}",
        next.hash()
    );
    println!(
        "certified successor schema={}",
        serde_json::to_string(next.schema()).unwrap()
    );
    let result = if migration {
        let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
        assert_eq!(
            plan.drops,
            vec![Drop::Table {
                name: "archive".into(),
                rows: 1
            }]
        );
        runtime.apply_migration(next, &plan, 123).map_err(|error| {
            let RuntimeError::Successor(refusal) = error else {
                panic!("{error}")
            };
            *refusal
        })
    } else {
        runtime.apply_successor(next)
    };
    // Retain actual installed rows when running this invariant on the broken baseline.
    println!(
        "actual installed={} seq={} rows={:?}",
        runtime.generation().hash(),
        runtime.store().commit_seq().unwrap(),
        stored_observations(&runtime)[1]
    );
    let refusal =
        result.expect_err("a retired-source projection must not exempt an unreplaced survivor");
    assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
    assert_eq!(
        refusal.site.as_deref(),
        Some(
            format!(
                "zTotals.{}",
                canonical_json(&vec![Value::String("valid".into())])
            )
            .as_str()
        )
    );
    assert_eq!(runtime.generation().hash(), hash);
    assert_eq!(runtime.store().commit_seq().unwrap(), seq);
    assert_eq!(stored_observations(&runtime), before);
}

#[test]
fn retirement_source_ordering_refuses_the_actual_survivor() {
    retirement_refusal(false);
}

#[test]
fn retirement_source_ordering_rolls_back_an_exact_archive_drop() {
    retirement_refusal(true);
}

#[test]
fn retirement_source_ordering_refuses_changed_schema_reopening() {
    let (runtime, next) = retirement_fixture("aTotals", "zTotals", "x");
    let before = stored_observations(&runtime);
    let path = std::env::temp_dir().join(format!(
        "s2-retired-source-reopen-{}.sqlite",
        std::process::id()
    ));
    runtime.store().snapshot_to(&path).unwrap();
    let refusal = match Runtime::open(Store::open(&path).unwrap(), next) {
        Ok(_) => panic!("reopening must not install the invalid survivor"),
        Err(refusal) => refusal,
    };
    assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
    let store = Store::open(&path).unwrap();
    let mut after = store_observations(&store);
    // Store::open records lock ownership before Runtime admission; the original
    // in-memory store has no owner stamp. Every generation entry still matches.
    after[0].retain(|row| row[0] != "owner");
    assert_eq!(after, before);
    assert_eq!(
        store.commit_seq().unwrap(),
        runtime.store().commit_seq().unwrap()
    );
    drop(store);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn retirement_source_ordering_allows_valid_survival_and_actual_replacement() {
    for (retired, target, group, migration) in [
        ("aTotals", "zTotals", "survivor", false),
        // Here the new target builds first and really replaces the old x row.
        ("zTotals", "aTotals", "x", true),
    ] {
        let (mut runtime, mut next) = retirement_fixture(retired, target, group);
        if migration {
            let mut tables = next.schema().tables.clone();
            tables.remove("archive");
            next = generation(tables, next.schema().maintains.clone());
        }
        let before = stored_observations(&runtime);
        let seq = runtime.store().commit_seq().unwrap();
        let next_hash = next.hash();
        if migration {
            let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
            runtime.apply_migration(next, &plan, 123).unwrap();
        } else {
            runtime.apply_successor(next).unwrap();
        }
        assert_eq!(runtime.generation().hash(), next_hash);
        assert_eq!(runtime.store().meta("generation").unwrap(), Some(next_hash));
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        let after = stored_observations(&runtime);
        for observation in [1, 2] {
            // Rows and every persisted index key.
            assert!(!after[observation].iter().any(|row| row[0] == retired));
            let expected_table = if migration { retired } else { target };
            let expected = before[observation]
                .iter()
                .filter(|row| row[0] == expected_table)
                .map(|row| {
                    let mut row = row.clone();
                    row[0] = target.into();
                    row
                })
                .collect::<Vec<_>>();
            assert!(!expected.is_empty());
            assert_eq!(
                after[observation]
                    .iter()
                    .filter(|row| row[0] == target)
                    .cloned()
                    .collect::<Vec<_>>(),
                expected
            );
            let base = |rows: &Vec<Vec<String>>| {
                rows.iter()
                    .filter(|row| row[0] == "events" || (!migration && row[0] == "archive"))
                    .cloned()
                    .collect::<Vec<_>>()
            };
            assert_eq!(base(&after[observation]), base(&before[observation]));
            if migration {
                assert!(!after[observation].iter().any(|row| row[0] == "archive"));
            }
        }
    }
}
