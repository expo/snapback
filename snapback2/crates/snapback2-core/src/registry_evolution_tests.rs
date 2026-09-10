use crate::ir::IndexKeyExpr;
use crate::*;
use std::collections::BTreeMap;

fn generation(kind: ColumnType) -> Generation {
    let table = public_table(
        BTreeMap::from([("id".into(), ColumnType::Id), ("value".into(), kind)]),
        BTreeMap::from([(
            "byId".into(),
            Index {
                components: (vec!["id".into()])
                    .into_iter()
                    .map(crate::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Auth::default(),
            effects: vec![],
            programs: vec![],
            schema: Schema {
                tables: BTreeMap::from([("items".into(), table)]),
                ..Schema::default()
            },
        },
        Ceilings::default(),
    )
    .unwrap()
}
fn runtime(kind: ColumnType, values: Vec<Option<Value>>) -> Runtime {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(kind)).unwrap();
    let rows = values
        .into_iter()
        .enumerate()
        .map(|(i, value)| {
            let mut row = BTreeMap::from([("id".into(), Value::Id(format!("id-{i:02}")))]);
            if let Some(value) = value {
                row.insert("value".into(), value);
            }
            ("items".into(), Value::Row(row.into()))
        })
        .collect::<Vec<_>>();
    runtime.seed(&rows).unwrap();
    runtime
}
fn optional(t: ColumnType) -> ColumnType {
    ColumnType::Optional(Box::new(t))
}
fn read_values(runtime: &mut Runtime) -> Value {
    let query = Program {
        name: "inspect".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items".into(),
            table: "items".into(),
            index: "byId".into(),
            prefix: (vec![]).into_iter().map(IndexKeyExpr::Scalar).collect(),
            take: Bound::Literal(30),
            order: Order::Asc,
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    runtime
        .read_operator(&query, BTreeMap::new(), OperatorId("alice".into()), 10)
        .unwrap()
        .result
}
fn enumeration(cases: &[&str]) -> ColumnType {
    ColumnType::Enum {
        variants: cases.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn enum_widening_preserves_populated_rows() {
    let mut rt = runtime(
        enumeration(&["text", "image"]),
        vec![Some(Value::String("text".into()))],
    );
    let before = read_values(&mut rt);
    let result = rt.apply_successor(generation(enumeration(&["image", "poll", "text"])));
    eprintln!("enum case add: {result:?}");
    assert!(result.is_ok());
    assert_eq!(read_values(&mut rt), before);
}

#[test]
fn enum_removal_is_checked_instead_of_destructive() {
    for removed in [false, true] {
        let mut rt = runtime(
            enumeration(&["text", "image"]),
            vec![Some(Value::String(
                if removed { "image" } else { "text" }.into(),
            ))],
        );
        let before = read_values(&mut rt);
        let result = rt.apply_successor(generation(enumeration(&["text"])));
        eprintln!("enum case removal used={removed}: {result:?}");
        if removed {
            let error = result.unwrap_err();
            assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
            assert!(error.rewrite.contains(
                "  chunk p in items first 100 by byId:\n    if p.value = 'image':\n      delete items[p.id]"
            ), "{}", error.rewrite);
        } else {
            assert!(result.is_ok());
        }
        assert_eq!(read_values(&mut rt), before);
    }
}

fn regroup_schema(by: &str) -> Schema {
    regroup_schema_with(by, MaintainKind::Count)
}
fn regroup_schema_with(by: &str, kind: MaintainKind) -> Schema {
    let mut schema = generation(ColumnType::Int).schema().clone();
    let source = schema.tables.get_mut("items").unwrap();
    source
        .columns
        .insert("sender".into(), ColumnType::Principal);
    source
        .columns
        .insert("recipient".into(), ColumnType::Principal);
    let target = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            (by.into(), ColumnType::Principal),
            ("value".into(), ColumnType::Int),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec![IndexComponent::Column("id".into())],
                    unique: true,
                },
            ),
            (
                format!("by_{by}"),
                Index {
                    components: vec![IndexComponent::Column(by.into())],
                    unique: true,
                },
            ),
        ]),
    );
    schema.tables.insert("counts".into(), target);
    schema.maintains.push(Maintain {
        target: "counts".into(),
        source: "items".into(),
        by: vec![by.into()],
        kind,
        readable: None,
    });
    schema
}
fn certified(schema: Schema) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![],
            effects: vec![],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap()
}
#[test]
fn regroup_replaces_only_the_owned_projection_without_a_plan() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        certified(regroup_schema("sender")),
    )
    .unwrap();
    rt.seed(&[(
        "items".into(),
        object([
            ("id", Value::Id("item".into())),
            ("value", Value::Int(1)),
            ("sender", Value::Id("dev:alice".into())),
            ("recipient", Value::Id("dev:bob".into())),
        ]),
    )])
    .unwrap();
    let result = rt.apply_successor(certified(regroup_schema("recipient")));
    eprintln!("maintain regroup: {result:?}");
    assert!(result.is_ok());
}

struct Disk(std::path::PathBuf);
impl Disk {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "succ-evolution-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn db(&self) -> std::path::PathBuf {
        self.0.join("store.sqlite")
    }
}
impl std::ops::Drop for Disk {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn list(of: ColumnType, max: u32) -> ColumnType {
    ColumnType::List {
        of: Box::new(of),
        max,
    }
}

#[test]
fn widening_matrix_installs_migrates_and_reopens_without_rewriting() {
    let cases = vec![
        (
            enumeration(&["text", "image"]),
            enumeration(&["poll", "image", "text"]),
            Value::String("image".into()),
        ),
        (
            ColumnType::Text { max: 10 },
            ColumnType::Text { max: 20 },
            Value::String("hello".into()),
        ),
        (
            ColumnType::Json { max_bytes: 100 },
            ColumnType::Json { max_bytes: 200 },
            Value::String("hello".into()),
        ),
        (
            ColumnType::Bytes { max: 10 },
            ColumnType::Bytes { max: 20 },
            Value::Bytes(vec![0, 255]),
        ),
        (
            optional(ColumnType::Image {
                max: 100,
                once: false,
            }),
            optional(ColumnType::Image {
                max: 200,
                once: false,
            }),
            Value::Null,
        ),
        (
            optional(ColumnType::Video { max: 100 }),
            optional(ColumnType::Video { max: 200 }),
            Value::Null,
        ),
        (
            optional(ColumnType::Image {
                max: 100,
                once: false,
            }),
            optional(ColumnType::Image {
                max: 100,
                once: true,
            }),
            Value::Null,
        ),
        (
            list(ColumnType::Text { max: 10 }, 2),
            list(ColumnType::Text { max: 20 }, 3),
            Value::Array(vec![Value::String("hello".into())]),
        ),
        (ColumnType::Int, optional(ColumnType::Int), Value::Int(10)),
        (
            optional(list(optional(enumeration(&["a"])), 2)),
            optional(list(optional(enumeration(&["b", "a"])), 3)),
            Value::Array(vec![Value::Null, Value::String("a".into())]),
        ),
    ];
    for (case, (from, to, value)) in cases.into_iter().enumerate() {
        for route in ["install", "migration", "reopen"] {
            let disk = Disk::new();
            let mut rt =
                Runtime::open(Store::open(&disk.db()).unwrap(), generation(from.clone())).unwrap();
            rt.seed(&[(
                "items".into(),
                object([("id", Value::Id("one".into())), ("value", value.clone())]),
            )])
            .unwrap();
            let before: String = rt
                .engine
                .store()
                .conn
                .query_row("SELECT data FROM rows WHERE table_name='items'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let seq = rt.store().commit_seq().unwrap();
            let next = generation(to.clone());
            match route {
                "install" => {
                    rt.apply_successor(next)
                        .unwrap_or_else(|e| panic!("case {case} {route}: {e}"));
                }
                "migration" => {
                    rt.apply_migration(next, &MigrationPlan::default(), 10)
                        .unwrap();
                }
                _ => {
                    drop(rt);
                    rt = Runtime::open(Store::open(&disk.db()).unwrap(), next).unwrap();
                }
            }
            assert_eq!(rt.store().commit_seq().unwrap(), seq);
            assert_eq!(
                rt.engine
                    .store()
                    .conn
                    .query_row::<String, _, _>(
                        "SELECT data FROM rows WHERE table_name='items'",
                        [],
                        |r| r.get(0)
                    )
                    .unwrap(),
                before,
                "case {case} {route}"
            );
        }
    }
}

#[test]
fn narrower_bounds_and_changed_scale_currency_or_once_keep_destructive_plans() {
    // Smaller text/bytes/list maxima are checked narrowing (fix round r1 ruling), below.
    for (from, to) in [
        (
            ColumnType::Json { max_bytes: 200 },
            ColumnType::Json { max_bytes: 100 },
        ),
        (
            ColumnType::Image {
                max: 200,
                once: false,
            },
            ColumnType::Image {
                max: 100,
                once: false,
            },
        ),
        (
            ColumnType::Video { max: 200 },
            ColumnType::Video { max: 100 },
        ),
        (
            ColumnType::Image {
                max: 100,
                once: true,
            },
            ColumnType::Image {
                max: 100,
                once: false,
            },
        ),
        (
            ColumnType::Decimal { scale: 2 },
            ColumnType::Decimal { scale: 3 },
        ),
        (
            ColumnType::Money {
                currency: "USD".into(),
                scale: 2,
            },
            ColumnType::Money {
                currency: "USD".into(),
                scale: 3,
            },
        ),
        (
            ColumnType::Money {
                currency: "USD".into(),
                scale: 2,
            },
            ColumnType::Money {
                currency: "EUR".into(),
                scale: 2,
            },
        ),
    ] {
        for route in ["install", "migration", "reopen"] {
            let disk = Disk::new();
            let mut rt =
                Runtime::open(Store::open(&disk.db()).unwrap(), generation(from.clone())).unwrap();
            let old_hash = rt.generation().hash();
            let next = generation(to.clone());
            let refusal = rt.apply_successor(next.clone()).unwrap_err();
            assert_eq!(refusal.code, "E_SUCCESSOR_DESTRUCTIVE");
            assert_eq!(refusal.from, old_hash);
            assert_eq!(refusal.to, next.hash());
            assert!(matches!(&refusal.plan.drops[..], [Drop::TypeChange { .. }]));
            match route {
                "migration" => {
                    rt.apply_migration(next, &refusal.plan, 10).unwrap();
                }
                "reopen" => {
                    drop(rt);
                    let error = Runtime::open(Store::open(&disk.db()).unwrap(), next)
                        .err()
                        .unwrap();
                    assert_eq!(error.code, "E_SUCCESSOR_DESTRUCTIVE");
                }
                _ => assert_eq!(rt.generation().hash(), old_hash),
            }
        }
    }
}

#[test]
fn nested_enum_removal_counts_rows_once_and_preserves_bytes_on_every_path() {
    for route in ["install", "migration", "reopen"] {
        for used in [false, true] {
            let disk = Disk::new();
            let from = optional(list(
                optional(list(optional(enumeration(&["a", "b"])), 3)),
                3,
            ));
            let to = optional(list(
                optional(list(optional(enumeration(&["a", "c"])), 4)),
                4,
            ));
            let mut rt = Runtime::open(Store::open(&disk.db()).unwrap(), generation(from)).unwrap();
            let value = Value::Array(vec![
                Value::Null,
                Value::Array(vec![
                    Value::Null,
                    Value::String(if used { "b" } else { "a" }.into()),
                    Value::String("a".into()),
                ]),
            ]);
            rt.seed(
                &(0..12)
                    .map(|i| {
                        (
                            "items".into(),
                            object([
                                ("id", Value::Id(format!("i{i:02}"))),
                                ("value", value.clone()),
                            ]),
                        )
                    })
                    .collect::<Vec<_>>(),
            )
            .unwrap();
            let before = snapshot_sql(&rt.engine.store().conn, "rows");
            let next = generation(to);
            let result = match route {
                "install" => rt.apply_successor(next),
                "migration" => rt
                    .apply_migration(next, &MigrationPlan::default(), 10)
                    .map_err(|e| match e {
                        RuntimeError::Successor(e) => *e,
                        e => panic!("{e}"),
                    }),
                _ => {
                    let old = rt.generation().clone();
                    drop(rt);
                    match Runtime::open(Store::open(&disk.db()).unwrap(), next) {
                        Ok(opened) => {
                            rt = opened;
                            let report: SuccessorReport = serde_json::from_str(
                                &rt.store().meta("last_successor").unwrap().unwrap(),
                            )
                            .unwrap();
                            // The cold-open route hands the owner the same report the
                            // hot path logs (fix round r1, item 5).
                            assert_eq!(rt.take_opened_successor().as_ref(), Some(&report));
                            assert_eq!(rt.take_opened_successor(), None);
                            Ok(report)
                        }
                        Err(e) => {
                            rt = Runtime::open(Store::open(&disk.db()).unwrap(), old).unwrap();
                            Err(e)
                        }
                    }
                }
            };
            let checks = if used {
                let error = result.unwrap_err();
                assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
                // Values inside lists cannot be one sweep (a `for` would delete one row
                // twice, which the engine refuses): the sampled job, rerun until zero,
                // with the remaining count in the message (fix round r1, item 6).
                assert!(error.rewrite.starts_with(
                    "-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).\n-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.\njob remove_items_value():\n  chunk p0 in items['i00'] first 1 by byId:\n    delete items[p0.id]\n"
                ), "{}", error.rewrite);
                assert!(error.rewrite.ends_with("  chunk p9 in items['i09'] first 1 by byId:\n    delete items[p9.id]"), "{}", error.rewrite);
                assert!(error.message.contains("12 affected rows remain"), "{}", error.message);
                error.narrowings
            } else {
                result.unwrap().narrowings
            };
            assert_eq!(checks[0].removed_cases, ["b"]);
            assert_eq!(checks[0].affected_rows, if used { 12 } else { 0 });
            assert_eq!(checks[0].sample.len(), if used { 10 } else { 0 });
            assert_eq!(snapshot_sql(&rt.engine.store().conn, "rows"), before);
        }
    }
}
fn snapshot_sql(c: &rusqlite::Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let where_clause = if table == "_meta" {
        " WHERE key != 'owner'"
    } else {
        ""
    };
    let mut s = c
        .prepare(&format!(
            "SELECT * FROM {table}{where_clause} ORDER BY 1, 2"
        ))
        .unwrap();
    let columns = s.column_count();
    s.query_map([], |r| (0..columns).map(|i| r.get(i)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn mixed_outer_narrowing_and_inner_widening_checks_nulls() {
    for null in [false, true] {
        let mut rt = runtime(
            optional(enumeration(&["a"])),
            vec![Some(if null {
                Value::Null
            } else {
                Value::String("a".into())
            })],
        );
        let result = rt.apply_successor(generation(enumeration(&["a", "b"])));
        if null {
            assert_eq!(result.unwrap_err().narrowings[0].null_rows, 1);
        } else {
            assert!(result.is_ok());
        }
    }
}

#[test]
fn text_constraints_change_only_write_admission_not_stored_rows() {
    let mut rt = runtime(
        ColumnType::Text { max: 30 },
        vec![Some(Value::String("x".into()))],
    );
    let mut schema = rt.generation().schema().clone();
    schema
        .tables
        .get_mut("items")
        .unwrap()
        .constraints
        .push(Constraint::Text {
            field: "value".into(),
            min: 10,
            format: Some(TextFormat::Url),
        });
    let before = read_values(&mut rt);
    rt.apply_successor(certified(schema.clone())).unwrap();
    assert_eq!(read_values(&mut rt), before);
    schema.tables.get_mut("items").unwrap().constraints.clear();
    rt.apply_successor(certified(schema)).unwrap();
    assert_eq!(read_values(&mut rt), before);
}

#[test]
fn regroup_with_non_owned_survivor_keeps_a_destructive_plan() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        certified(regroup_schema("sender")),
    )
    .unwrap();
    rt.seed(&[(
        "counts".into(),
        object([
            ("id", Value::Id("legacy".into())),
            ("sender", Value::Id("dev:alice".into())),
            ("value", Value::Int(3)),
        ]),
    )])
    .unwrap();
    let error = rt
        .apply_successor(certified(regroup_schema("recipient")))
        .unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_DESTRUCTIVE");
    assert!(error.plan.drops.iter().any(
        |d| matches!(d, Drop::Column { table, name } if table == "counts" && name == "sender")
    ));
}

fn with_timer(mut schema: Schema) -> Generation {
    schema.schedules.push(crate::timers::Schedule {
        name: "tick".into(),
        trigger: crate::timers::Trigger::Every {
            duration_ms: 60_000,
        },
        target: "tick.run".into(),
        binding: "tick.bind".into(),
        site: "snapback/tick.q:1:1".into(),
    });
    let program = |name: &str, kind, result| Program {
        name: name.into(),
        kind,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(result)],
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: Auth::default(),
            effects: vec![],
            schema,
            programs: vec![
                program(
                    "tick.run",
                    ProgramKind::Mutation,
                    Expr::Literal(Value::Null),
                ),
                program(
                    "tick.bind",
                    ProgramKind::Query,
                    Expr::Object(BTreeMap::from([
                        ("enabled".into(), Expr::Literal(Value::Bool(true))),
                        ("args".into(), Expr::Object(BTreeMap::new())),
                    ])),
                ),
            ],
        },
        Ceilings::default(),
    )
    .unwrap()
}
#[test]
fn injected_installation_failure_rolls_back_rows_indexes_generations_and_timers() {
    for route in ["install", "migration", "reopen"] {
        let disk = Disk::new();
        let old = certified(regroup_schema("sender"));
        let mut rt = Runtime::open(Store::open(&disk.db()).unwrap(), old.clone()).unwrap();
        rt.seed(&[(
            "items".into(),
            object([
                ("id", Value::Id("one".into())),
                ("value", Value::Int(1)),
                ("sender", Value::Id("dev:alice".into())),
                ("recipient", Value::Id("dev:bob".into())),
            ]),
        )])
        .unwrap();
        let tables = ["rows", "index_entries", "_meta", "_timers"];
        let before = tables.map(|t| snapshot_sql(&rt.engine.store().conn, t));
        rt.engine.store().conn.execute_batch("CREATE TRIGGER fail_successor BEFORE INSERT ON _meta WHEN NEW.key='generation' BEGIN SELECT RAISE(ABORT, 'injected successor failure after timer reconciliation'); END;").unwrap();
        let next = with_timer(regroup_schema("recipient"));
        match route {
            "install" => {
                assert!(
                    rt.apply_successor_at(next.clone(), 9_000)
                        .unwrap_err()
                        .message
                        .contains("injected successor failure")
                );
                assert_eq!(rt.generation().hash(), old.hash());
            }
            "migration" => {
                assert!(
                    rt.apply_migration(next.clone(), &MigrationPlan::default(), 9_000)
                        .unwrap_err()
                        .to_string()
                        .contains("injected successor failure")
                );
                assert_eq!(rt.generation().hash(), old.hash());
            }
            _ => {
                drop(rt);
                assert!(
                    Runtime::open(Store::open(&disk.db()).unwrap(), next.clone())
                        .err()
                        .unwrap()
                        .message
                        .contains("injected successor failure")
                );
                {
                    let raw = rusqlite::Connection::open(disk.db()).unwrap();
                    raw.execute_batch("DROP TRIGGER fail_successor").unwrap();
                }
                rt = Runtime::open(Store::open(&disk.db()).unwrap(), old.clone()).unwrap();
            }
        }
        // Opening the unchanged generation also persists metadata; remove the trigger first above.
        for (i, table) in tables.iter().enumerate() {
            assert_eq!(
                snapshot_sql(&rt.engine.store().conn, table),
                before[i],
                "{route}: {table}"
            );
        }
        rt.engine
            .store()
            .conn
            .execute_batch("DROP TRIGGER IF EXISTS fail_successor")
            .unwrap();
        let report = rt.apply_successor_at(next, 9_000).unwrap();
        assert_eq!(
            report.maintains,
            ["maintain counts: by sender → by recipient"]
        );
        assert_eq!(
            rt.store().meta("last_successor").unwrap().unwrap(),
            canonical_json(&report)
        );
        assert_eq!(snapshot_sql(&rt.engine.store().conn, "_timers").len(), 1);
        let count: String = rt
            .engine
            .store()
            .conn
            .query_row("SELECT data FROM rows WHERE table_name='counts'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(count.contains("recipient"));
        assert!(!count.contains("sender"));
        assert_eq!(rt.engine.store().conn.query_row::<u64, _, _>("SELECT COUNT(*) FROM index_entries WHERE table_name='counts' AND index_name='by_sender'", [], |r| r.get(0)).unwrap(), 0);
    }
}

#[test]
fn zero_enum_removal_still_checks_uniqueness_caps_and_required_columns() {
    for check in ["unique", "cap", "required"] {
        let mut rt = runtime(
            enumeration(&["a", "b"]),
            vec![Some(Value::String("a".into())); 2],
        );
        let mut schema = rt.generation().schema().clone();
        let table = schema.tables.get_mut("items").unwrap();
        table.columns.insert("value".into(), enumeration(&["a"]));
        let code = match check {
            "unique" => {
                table.indexes.insert(
                    "byValue".into(),
                    Index {
                        components: vec![IndexComponent::Column("value".into())],
                        unique: true,
                    },
                );
                "E_SUCCESSOR_UNIQUE"
            }
            "cap" => {
                table.indexes.insert(
                    "byValue".into(),
                    Index {
                        components: vec![
                            IndexComponent::Column("value".into()),
                            IndexComponent::Column("id".into()),
                        ],
                        unique: false,
                    },
                );
                table.constraints.push(Constraint::Cap {
                    by: vec!["value".into()],
                    max: 1,
                });
                "E_SUCCESSOR_CAP"
            }
            _ => {
                table.columns.insert("new".into(), ColumnType::Int);
                "E_SUCCESSOR_COLUMN_REQUIRED"
            }
        };
        assert_eq!(
            rt.apply_successor(certified(schema)).unwrap_err().code,
            code
        );
    }
}

fn table_rows(rt: &Runtime, table: &str) -> Vec<(String, Value)> {
    let mut statement = rt
        .engine
        .store()
        .conn
        .prepare("SELECT row_id, data FROM rows WHERE table_name = ?1 ORDER BY row_id")
        .unwrap();
    statement
        .query_map([table], |row| {
            Ok((
                row.get::<_, String>(0)?,
                serde_json::from_str::<Value>(&row.get::<_, String>(1)?).unwrap(),
            ))
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}

/// Fix round r1, item 1: a column that loses its outer `?` and an enum case at once
/// gets one pasted job that fills the nulls and deletes the removed case, and the
/// refusal carries both counts.
#[test]
fn combined_unwrap_and_enum_removal_pastes_one_job_that_fills_and_deletes() {
    let mut rt = runtime(
        optional(enumeration(&["a", "b", "c"])),
        vec![None, Some(Value::String("c".into())), Some(Value::String("a".into()))],
    );
    let error = rt
        .apply_successor(generation(enumeration(&["a", "b"])))
        .unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
    let check = &error.narrowings[0];
    assert_eq!(
        (check.null_rows, check.affected_rows, check.oversize_rows),
        (1, 2, 0)
    );
    assert_eq!(check.removed_cases, ["c"]);
    assert_eq!(check.sample, ["id-01"]);
    assert!(
        error.message.contains(
            "items.value removes cases [\"c\"]: 2 affected rows remain (1 null or absent)"
        ),
        "{}",
        error.message
    );
    assert_eq!(
        error.rewrite,
        "-- keep the predecessor schema; this deletes every row holding a removed case; null or absent values become the job's argument.\n-- To map instead, replace each delete with: update items[p.id] { value: <kept case> }\njob remove_items_value(value: enum('a', 'b')):\n  chunk p in items first 100 by byId:\n    if p.value = null:\n      update items[p.id] { value: value }\n    if p.value = 'c':\n      delete items[p.id]"
    );
    // The job's two effects, applied under the predecessor schema, make the successor admit.
    let conn = &rt.engine.store().conn;
    conn.execute(
        "DELETE FROM rows WHERE table_name = 'items' AND row_id = 'id-01'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE rows SET data = ?1 WHERE table_name = 'items' AND row_id = 'id-00'",
        [canonical_json(&object([
            ("id", Value::Id("id-00".into())),
            ("value", Value::String("b".into())),
        ]))],
    )
    .unwrap();
    let report = rt
        .apply_successor(generation(enumeration(&["a", "b"])))
        .unwrap();
    assert_eq!(
        (
            report.narrowings[0].affected_rows,
            report.narrowings[0].null_rows
        ),
        (0, 0)
    );
    assert_eq!(read_values(&mut rt).as_array().map(|rows| rows.len()), Ok(2));
}

/// Fix round r1, item 2: ownership is the union of the predecessor and successor
/// projected ids (RFC A3, LLP 1001 §4): a survivor sitting at a successor group key
/// is engine-owned, so the regroup is the transactional replacement, not a plan.
#[test]
fn regroup_with_survivor_at_successor_key_is_owned_and_regroups_without_a_plan() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        certified(regroup_schema("sender")),
    )
    .unwrap();
    let key = canonical_json(&vec![Value::Id("dev:bob".into())]);
    rt.seed(&[
        (
            "items".into(),
            object([
                ("id", Value::Id("item".into())),
                ("value", Value::Int(1)),
                ("sender", Value::Id("dev:alice".into())),
                ("recipient", Value::Id("dev:bob".into())),
            ]),
        ),
        (
            "counts".into(),
            object([
                ("id", Value::Id(key.clone())),
                ("sender", Value::Id("dev:carol".into())),
                ("value", Value::Int(3)),
            ]),
        ),
    ])
    .unwrap();
    let report = rt
        .apply_successor(certified(regroup_schema("recipient")))
        .unwrap();
    assert_eq!(report.maintains, ["maintain counts: by sender → by recipient"]);
    let rows = table_rows(&rt, "counts");
    assert_eq!(rows.len(), 1, "{rows:?}");
    let (id, row) = &rows[0];
    assert_eq!(id, &key);
    assert_eq!(row.field("value").unwrap(), &Value::Int(1));
    assert_eq!(row.field("recipient").unwrap(), &Value::Id("dev:bob".into()));
    assert!(row.field("sender").is_err(), "{row:?}");
}

/// Fix round r1, item 4 (ruling): a smaller list maximum is checked narrowing like enum
/// removal — counted, sampled, repaired by a pasted job — never a retype that clears.
#[test]
fn lowered_list_maximum_with_enum_removal_is_checked_narrowing() {
    let from = list(enumeration(&["a", "b"]), 5);
    let to = list(enumeration(&["a"]), 3);
    let strings = |items: &[&str]| {
        Value::Array(items.iter().map(|s| Value::String((*s).into())).collect())
    };
    let mut rt = runtime(
        from.clone(),
        vec![
            Some(strings(&["a", "b", "a", "b"])),
            Some(strings(&["a"])),
            Some(strings(&["b"])),
        ],
    );
    let before = read_values(&mut rt);
    let error = rt.apply_successor(generation(to.clone())).unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
    let check = &error.narrowings[0];
    assert_eq!(check.removed_cases, ["b"]);
    assert_eq!(
        (check.oversize_rows, check.affected_rows, check.null_rows),
        (1, 2, 0)
    );
    assert_eq!(check.sample, ["id-00", "id-02"]);
    assert!(
        error.message.contains(
            "items.value removes cases [\"b\"] and lowers its maximum: 2 affected rows remain (0 null or absent, 1 over the new maximum)"
        ),
        "{}",
        error.message
    );
    // A removed case inside a list is not one statement per row: the sampled job.
    assert_eq!(
        error.rewrite,
        "-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).\n-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.\njob remove_items_value():\n  chunk p0 in items['id-00'] first 1 by byId:\n    delete items[p0.id]\n  chunk p1 in items['id-02'] first 1 by byId:\n    delete items[p1.id]"
    );
    assert_eq!(read_values(&mut rt), before, "a refusal never clears the column");

    // A lowered maximum alone is one `.length` statement: a whole-table sweep.
    let mut rt = runtime(from.clone(), vec![Some(strings(&["a", "b", "a", "b"]))]);
    let error = rt
        .apply_successor(generation(list(enumeration(&["a", "b"]), 3)))
        .unwrap_err();
    assert_eq!(
        (error.narrowings[0].oversize_rows, error.narrowings[0].affected_rows),
        (1, 1)
    );
    assert!(error.narrowings[0].removed_cases.is_empty());
    assert_eq!(
        error.rewrite,
        "-- keep the predecessor schema; this deletes every row over the new maximum.\n-- To map instead, replace each delete with: update items[p.id] { value: <kept value> }\njob shrink_items_value():\n  chunk p in items first 100 by byId:\n    if p.value.length > 3:\n      delete items[p.id]"
    );

    let mut rt = runtime(from, vec![Some(strings(&["a", "a", "a"])), Some(strings(&[]))]);
    let before = read_values(&mut rt);
    let report = rt.apply_successor(generation(to)).unwrap();
    let check = &report.narrowings[0];
    assert_eq!(check.removed_cases, ["b"]);
    assert_eq!((check.oversize_rows, check.affected_rows), (0, 0));
    assert_eq!(read_values(&mut rt), before, "admission rewrites no row");
}

/// Fix round r1, item 4 (ruling): smaller `text` and `bytes` maxima are checked the same
/// way; text is repaired by a whole-table truncation, bytes (which Quarry cannot measure)
/// by the sampled sweep that is rerun until the count is zero.
#[test]
fn lowered_text_and_bytes_maxima_are_checked_narrowing() {
    for route in ["install", "reopen"] {
        let disk = Disk::new();
        let mut rt = Runtime::open(
            Store::open(&disk.db()).unwrap(),
            generation(ColumnType::Text { max: 20 }),
        )
        .unwrap();
        rt.seed(&[(
            "items".into(),
            object([
                ("id", Value::Id("long".into())),
                ("value", Value::String("x".repeat(15))),
            ]),
        )])
        .unwrap();
        let next = generation(ColumnType::Text { max: 10 });
        let error = match route {
            "install" => rt.apply_successor(next).unwrap_err(),
            _ => {
                drop(rt);
                let error = Runtime::open(Store::open(&disk.db()).unwrap(), next).err().unwrap();
                rt = Runtime::open(
                    Store::open(&disk.db()).unwrap(),
                    generation(ColumnType::Text { max: 20 }),
                )
                .unwrap();
                error
            }
        };
        assert_eq!(error.code, "E_SUCCESSOR_NARROWING", "{route}");
        assert_eq!(error.narrowings[0].oversize_rows, 1);
        assert_eq!(
            error.rewrite,
            "-- keep the predecessor schema; this truncates every items.value to 10 characters.\n-- To delete only over-long rows, keep any null fill and replace truncation with:\n-- if p.value != slice(p.value, 0, 10):\n--   delete items[p.id]\njob shrink_items_value():\n  chunk p in items first 100 by byId:\n    update items[p.id] { value: slice(p.value, 0, 10) }"
        );
        assert_eq!(rt.generation().hash(), generation(ColumnType::Text { max: 20 }).hash());
    }
    let mut rt = runtime(
        ColumnType::Text { max: 20 },
        vec![Some(Value::String("short".into()))],
    );
    let report = rt
        .apply_successor(generation(ColumnType::Text { max: 10 }))
        .unwrap();
    assert_eq!(
        (
            report.narrowings[0].oversize_rows,
            report.narrowings[0].affected_rows
        ),
        (0, 0)
    );

    let mut rt = runtime(
        ColumnType::Bytes { max: 20 },
        vec![Some(Value::Bytes(vec![7; 15])), Some(Value::Bytes(vec![7; 5]))],
    );
    let error = rt
        .apply_successor(generation(ColumnType::Bytes { max: 10 }))
        .unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_NARROWING");
    assert_eq!(error.narrowings[0].sample, ["id-00"]);
    assert!(error.message.contains("1 affected rows remain"), "{}", error.message);
    assert_eq!(
        error.rewrite,
        "-- keep the predecessor schema; this deletes the sampled rows (no one sweep can check values inside lists or bytes).\n-- Apply again after this job: the refusal counts the rows that remain; rerun its next sample job until that count is zero.\njob shrink_items_value():\n  chunk p0 in items['id-00'] first 1 by byId:\n    delete items[p0.id]"
    );
    rt.engine
        .store()
        .conn
        .execute(
            "DELETE FROM rows WHERE table_name = 'items' AND row_id = 'id-00'",
            [],
        )
        .unwrap();
    let report = rt
        .apply_successor(generation(ColumnType::Bytes { max: 10 }))
        .unwrap();
    assert_eq!(report.narrowings[0].affected_rows, 0);
}

/// Fix round r1, item 7: the report line fires for kind and source changes, not only `by`.
#[test]
fn maintain_report_names_kind_and_source_changes() {
    let mut rt = Runtime::open(
        Store::memory().unwrap(),
        certified(regroup_schema("sender")),
    )
    .unwrap();
    rt.seed(&[(
        "items".into(),
        object([
            ("id", Value::Id("item".into())),
            ("value", Value::Int(4)),
            ("sender", Value::Id("dev:alice".into())),
            ("recipient", Value::Id("dev:bob".into())),
        ]),
    )])
    .unwrap();
    let report = rt
        .apply_successor(certified(regroup_schema_with(
            "sender",
            MaintainKind::Sum { of: "value".into() },
        )))
        .unwrap();
    assert_eq!(report.maintains, ["maintain counts: count → sum of value"]);
    let rows = table_rows(&rt, "counts");
    assert_eq!(rows[0].1.field("value").unwrap(), &Value::Int(4));

    let old = Maintain {
        target: "counts".into(),
        source: "items".into(),
        by: vec!["sender".into()],
        kind: MaintainKind::Count,
        readable: None,
    };
    let new = Maintain {
        source: "posts".into(),
        by: vec!["recipient".into(), "day".into()],
        ..old.clone()
    };
    assert_eq!(
        crate::successor::maintain_change_line(&old, &new).as_deref(),
        Some("maintain counts: from items → from posts, by sender → by recipient, day")
    );
    assert_eq!(crate::successor::maintain_change_line(&old, &old), None);
}

#[test]
fn sampled_required_list_repair_fills_null_without_deleting_it() {
    let old = optional(list(enumeration(&["a", "b"]), 3));
    let new = list(enumeration(&["a"]), 3);
    let mut rt = runtime(old, vec![Some(Value::Null), Some(Value::Array(vec![Value::String("b".into())]))]);
    let refusal = rt.apply_successor(generation(new.clone())).unwrap_err();
    let check = &refusal.narrowings[0];
    assert_eq!((check.null_rows, check.affected_rows), (1, 2));
    assert_eq!(check.sample, ["id-01"]);
    assert!(refusal.rewrite.contains("if p.value = null:\n      update items[p.id] { value: value }"));
    assert!(!refusal.rewrite.contains("items['id-00']"));
    assert!(refusal.rewrite.contains("items['id-01']"));
    let conn = &rt.engine.store().conn;
    conn.execute("UPDATE rows SET data = ?1 WHERE table_name = 'items' AND row_id = 'id-00'", [canonical_json(&object([
        ("id", Value::Id("id-00".into())), ("value", Value::Array(vec![Value::String("a".into())])),
    ]))]).unwrap();
    conn.execute("DELETE FROM rows WHERE table_name = 'items' AND row_id = 'id-01'", []).unwrap();
    assert_eq!(rt.apply_successor(generation(new)).unwrap().narrowings[0].affected_rows, 0);
    assert_eq!(table_rows(&rt, "items").len(), 1);
    assert_eq!(table_rows(&rt, "items")[0].0, "id-00");
}
