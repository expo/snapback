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

fn survivor_tables() -> BTreeMap<String, Table> {
    BTreeMap::from([
        (
            "expenses".into(),
            table(
                &[
                    ("id", ColumnType::Id),
                    ("group", ColumnType::Optional(Box::new(ColumnType::Id))),
                    ("amount", ColumnType::Int),
                ],
                &[("byId", &["id"])],
            ),
        ),
        (
            "totals".into(),
            table(
                &[
                    ("id", ColumnType::Id),
                    ("group", ColumnType::Optional(Box::new(ColumnType::Id))),
                    ("value", ColumnType::Int),
                ],
                &[("byId", &["id"])],
            ),
        ),
        (
            "scratch".into(),
            table(&[("id", ColumnType::Id)], &[("byId", &["id"])]),
        ),
    ])
}

fn survivor_count() -> Maintain {
    Maintain {
        kind: MaintainKind::Count,
        source: "expenses".into(),
        by: vec!["group".into()],
        target: "totals".into(),
        readable: None,
    }
}

fn total_row(id: &str, group: Option<&str>, value: i64) -> Value {
    let mut fields = BTreeMap::from([
        ("id".into(), Value::Id(id.into())),
        ("value".into(), Value::Int(value)),
    ]);
    if let Some(group) = group {
        fields.insert("group".into(), Value::Id(group.into()));
    }
    Value::Row(fields)
}

struct SurvivorFiles(std::path::PathBuf);
impl SurvivorFiles {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "s2-survivor-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn snapshot(&self, store: &Store) -> BTreeMap<String, Vec<Vec<rusqlite::types::Value>>> {
        let path = self.0.join("snapshot.sqlite");
        store.snapshot_to(&path).unwrap();
        let connection = rusqlite::Connection::open(&path).unwrap();
        let names = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap()
            .query_map([], |r| r.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        names
            .into_iter()
            .map(|name| {
                let quoted = name.replace('"', "\"\"");
                let mut statement = connection
                    .prepare(&format!("SELECT * FROM \"{quoted}\" ORDER BY rowid"))
                    .unwrap();
                let count = statement.column_count();
                let mut rows = statement
                    .query_map([], |row| {
                        (0..count)
                            .map(|i| row.get(i))
                            .collect::<Result<Vec<rusqlite::types::Value>, _>>()
                    })
                    .unwrap()
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                // Store::open refreshes only this lock-owner stamp before
                // Runtime sees the candidate. Compare all application and
                // generation state, including every other metadata entry.
                if name == "_meta" {
                    rows.retain(|row| row[0] != rusqlite::types::Value::Text("owner".into()));
                }
                (name, rows)
            })
            .collect()
    }
}
impl std::ops::Drop for SurvivorFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn seed_survivors(runtime: &mut Runtime, rows: Vec<Value>) {
    let mut rows = rows
        .into_iter()
        .map(|row| ("totals".into(), row))
        .collect::<Vec<_>>();
    rows.push((
        "expenses".into(),
        object([
            ("id", Value::Id("expense".into())),
            ("group", Value::Id("derived".into())),
            ("amount", Value::Int(5)),
        ]),
    ));
    rows.push(("scratch".into(), object([("id", Value::Id("keep".into()))])));
    runtime.seed(&rows).unwrap();
}

#[test]
fn rebuilt_survivor_uniqueness_refuses_additive_migration_and_reopen_atomically() {
    for route in ["additive", "migration", "reopen"] {
        let files = SurvivorFiles::new();
        let path = files.0.join("store.sqlite");
        let tables = survivor_tables();
        let mut runtime = Runtime::open(
            Store::open(&path).unwrap(),
            generation(tables.clone(), vec![]),
        )
        .unwrap();
        seed_survivors(
            &mut runtime,
            vec![
                total_row("legacy-a", Some("aa"), 9),
                total_row("legacy-b", Some("bb"), 9),
            ],
        );
        let predecessor = generation(tables.clone(), vec![survivor_count()]);
        runtime.apply_successor(predecessor.clone()).unwrap();
        let before = files.snapshot(runtime.store());
        let seq = runtime.store().commit_seq().unwrap();
        let mut next_tables = tables;
        next_tables.get_mut("totals").unwrap().indexes.insert(
            "byValue".into(),
            Index {
                columns: vec!["value".into()],
                unique: true,
            },
        );
        if route == "migration" {
            next_tables.remove("scratch");
        }
        let next = generation(next_tables, vec![]);
        let refusal = match route {
            "additive" => runtime.apply_successor(next).unwrap_err(),
            "migration" => {
                let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
                assert!(!plan.drops.is_empty());
                match runtime.apply_migration(next, &plan, 0).unwrap_err() {
                    RuntimeError::Successor(refusal) => *refusal,
                    error => panic!("expected typed unique refusal, got {error}"),
                }
            }
            _ => {
                drop(runtime);
                let refusal = match Runtime::open(Store::open(&path).unwrap(), next) {
                    Ok(_) => panic!("reopen installed colliding survivors"),
                    Err(refusal) => refusal,
                };
                let store = Store::open(&path).unwrap();
                assert_eq!(
                    files.snapshot(&store),
                    before,
                    "{route}: every durable table must survive refusal"
                );
                runtime = Runtime::open(store, predecessor.clone()).unwrap();
                refusal
            }
        };
        assert_eq!(refusal.code, "E_SUCCESSOR_UNIQUE", "{route}");
        assert_eq!(
            refusal.conflicts,
            vec![UniqueConflict {
                table: "totals".into(),
                index: "byValue".into(),
                key: vec![Value::Int(9)]
            }]
        );
        assert_eq!(runtime.generation().hash(), predecessor.hash());
        assert_eq!(runtime.store().commit_seq().unwrap(), seq);
        assert_eq!(
            files.snapshot(runtime.store()),
            before,
            "{route}: rows, indexes and metadata must survive refusal"
        );
    }
}

#[test]
fn rebuilt_survivor_projection_collision_has_a_unique_refusal() {
    let files = SurvivorFiles::new();
    let tables = survivor_tables();
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    seed_survivors(&mut runtime, vec![total_row("legacy", Some("ordinary"), 1)]);
    let before = files.snapshot(runtime.store());
    let mut next_tables = tables;
    next_tables.get_mut("totals").unwrap().indexes.insert(
        "byValue".into(),
        Index {
            columns: vec!["value".into()],
            unique: true,
        },
    );
    let refusal = runtime
        .apply_successor(generation(next_tables, vec![survivor_count()]))
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_UNIQUE");
    assert_eq!(
        refusal.conflicts,
        vec![UniqueConflict {
            table: "totals".into(),
            index: "byValue".into(),
            key: vec![Value::Int(1)]
        }]
    );
    assert_eq!(files.snapshot(runtime.store()), before);
}

#[test]
fn rebuilt_unique_index_allows_next_projection_to_replace_an_ordinary_id() {
    let tables = survivor_tables();
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    let owned = canonical_json(&vec![Value::Id("derived".into())]);
    seed_survivors(
        &mut runtime,
        vec![
            total_row(&owned, Some("old"), 1),
            total_row("legacy", Some("ordinary"), 1),
        ],
    );
    let mut next_tables = tables;
    next_tables.get_mut("totals").unwrap().indexes.insert(
        "byValue".into(),
        Index {
            columns: vec!["value".into()],
            unique: true,
        },
    );
    let mut sum = survivor_count();
    sum.kind = MaintainKind::Sum {
        of: "amount".into(),
    };
    runtime
        .apply_successor(generation(next_tables, vec![sum]))
        .unwrap();
    assert_eq!(get(&mut runtime, owned).field("value"), Ok(&Value::Int(5)));
    assert_eq!(
        get(&mut runtime, "legacy".into()).field("value"),
        Ok(&Value::Int(1))
    );
}

#[test]
fn rebuilt_uniqueness_uses_predrop_owned_ids_when_a_source_is_removed() {
    let tables = survivor_tables();
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    seed_survivors(&mut runtime, vec![total_row("legacy", Some("ordinary"), 1)]);
    runtime
        .apply_successor(generation(tables.clone(), vec![survivor_count()]))
        .unwrap();
    let mut next_tables = tables;
    next_tables.remove("expenses");
    next_tables.get_mut("totals").unwrap().indexes.insert(
        "byValue".into(),
        Index {
            columns: vec!["value".into()],
            unique: true,
        },
    );
    let next = generation(next_tables, vec![]);
    let plan = runtime.apply_successor(next.clone()).unwrap_err().plan;
    runtime.apply_migration(next, &plan, 0).unwrap();
    assert_eq!(
        get(&mut runtime, "legacy".into()).field("value"),
        Ok(&Value::Int(1))
    );
    let owned = canonical_json(&vec![Value::Id("derived".into())]);
    assert_eq!(get(&mut runtime, owned), Value::Null);
}

#[test]
fn rebuilt_survivor_unique_tuple_treats_omitted_optional_as_null() {
    let tables = survivor_tables();
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    let mut explicit_null = total_row("explicit", None, 9);
    if let Value::Row(fields) = &mut explicit_null {
        fields.insert("group".into(), Value::Null);
    }
    seed_survivors(
        &mut runtime,
        vec![total_row("omitted", None, 9), explicit_null],
    );
    runtime
        .apply_successor(generation(tables.clone(), vec![survivor_count()]))
        .unwrap();
    let mut next_tables = tables;
    next_tables.get_mut("totals").unwrap().indexes.insert(
        "byGroupValue".into(),
        Index {
            columns: vec!["group".into(), "value".into()],
            unique: true,
        },
    );
    let refusal = runtime
        .apply_successor(generation(next_tables, vec![]))
        .unwrap_err();
    assert_eq!(
        refusal.conflicts,
        vec![UniqueConflict {
            table: "totals".into(),
            index: "byGroupValue".into(),
            key: vec![Value::Null, Value::Int(9)]
        }]
    );
}

#[test]
fn rebuilt_survivor_uniqueness_reports_at_most_ten_conflicting_keys() {
    let tables = survivor_tables();
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    let rows = (0..12)
        .flat_map(|value| {
            (0..2).map(move |i| total_row(&format!("legacy-{value}-{i}"), Some("same"), value))
        })
        .collect();
    seed_survivors(&mut runtime, rows);
    runtime
        .apply_successor(generation(tables.clone(), vec![survivor_count()]))
        .unwrap();
    let mut next_tables = tables;
    next_tables.get_mut("totals").unwrap().indexes.insert(
        "byValue".into(),
        Index {
            columns: vec!["value".into()],
            unique: true,
        },
    );
    let refusal = runtime
        .apply_successor(generation(next_tables, vec![]))
        .unwrap_err();
    assert_eq!(refusal.code, "E_SUCCESSOR_UNIQUE");
    assert_eq!(refusal.conflicts.len(), 10);
    assert!(
        refusal
            .conflicts
            .iter()
            .all(|c| c.table == "totals" && c.index == "byValue")
    );
    assert_eq!(
        refusal
            .conflicts
            .iter()
            .map(|c| canonical_json(&c.key))
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        10
    );
}

#[test]
fn rebuilt_uniqueness_uses_projection_after_preceding_target_retirement() {
    let mut tables = survivor_tables();
    let totals = tables.remove("totals").unwrap();
    tables.insert("aTotals".into(), totals.clone());
    let mut z_totals = totals;
    z_totals.indexes.insert(
        "byValue".into(),
        Index {
            columns: vec!["value".into()],
            unique: true,
        },
    );
    tables.insert("zTotals".into(), z_totals);
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(tables.clone(), vec![])).unwrap();
    runtime
        .seed(&[
            ("aTotals".into(), total_row("legacy", Some("ordinary"), 9)),
            (
                "expenses".into(),
                object([
                    ("id", Value::Id("expense".into())),
                    ("group", Value::Id("derived".into())),
                    ("amount", Value::Int(5)),
                ]),
            ),
        ])
        .unwrap();
    let mut maintain = survivor_count();
    maintain.target = "aTotals".into();
    runtime
        .apply_successor(generation(tables.clone(), vec![maintain]))
        .unwrap();
    // Before retiring aTotals, the zTotals projection has two count=1 rows
    // and would appear non-unique. The actual rebuild sees only the survivor.
    runtime
        .apply_successor(generation(
            tables,
            vec![Maintain {
                kind: MaintainKind::Count,
                source: "aTotals".into(),
                target: "zTotals".into(),
                by: vec!["group".into()],
                readable: None,
            }],
        ))
        .unwrap();
    let files = SurvivorFiles::new();
    let snapshot = files.snapshot(runtime.store());
    let z_rows = snapshot["rows"]
        .iter()
        .filter(|r| r[0] == rusqlite::types::Value::Text("zTotals".into()))
        .collect::<Vec<_>>();
    assert_eq!(z_rows.len(), 1);
    let rusqlite::types::Value::Text(body) = &z_rows[0][2] else {
        panic!("stored row must be JSON");
    };
    let row: Value = serde_json::from_str(body).unwrap();
    assert_eq!(row.field("group"), Ok(&Value::Id("ordinary".into())));
    assert_eq!(row.field("value"), Ok(&Value::Int(1)));
}
