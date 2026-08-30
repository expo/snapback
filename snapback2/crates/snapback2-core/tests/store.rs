use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn temp_store(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback2-core-{label}-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

fn schema() -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("name".to_owned(), ColumnType::Text { max: 64 }),
                ]),
                BTreeMap::from([
                    (
                        "byId".to_owned(),
                        Index {
                            columns: vec!["id".to_owned()],
                            unique: true,
                        },
                    ),
                    (
                        "byName".to_owned(),
                        Index {
                            columns: vec!["name".to_owned(), "id".to_owned()],
                            unique: false,
                        },
                    ),
                ]),
            ),
        )]),
        maintains: Vec::new(),
        channels: BTreeMap::new(),
        auth: Auth {
            password: true,
            guests: false,
        },
        effects: vec!["audit".to_owned()],
    }
}

fn generation() -> Generation {
    let insert = Program {
        name: "items.create".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("id".to_owned(), ArgType::Scalar),
            ("name".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("id")),
                    ("name".to_owned(), var("name")),
                ])),
            },
            Stmt::Emit {
                effect: "audit".to_owned(),
                payload: var("name"),
            },
            Stmt::Return(var("id")),
        ],
    };
    let list = Program {
        name: "items.list".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Scan(Scan {
            site: "items.list".to_owned(),
            table: "items".to_owned(),
            index: "byName".to_owned(),
            prefix: Vec::new(),
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            provenance: KeyProvenance::Const,
        }))],
    };
    let rename = Program {
        name: "items.rename".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("id".to_owned(), ArgType::Scalar),
            ("name".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "items".to_owned(),
            key: var("id"),
            patch: Expr::Object(BTreeMap::from([("name".to_owned(), var("name"))])),
        }],
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema(),
            programs: vec![insert, list, rename],
            effects: vec![EffectDecl {
                name: "audit".to_owned(),
                grants: Vec::new(),
                source: "effects/audit.ts".to_owned(),
                then: None,
            }],
            auth: Auth {
                password: true,
                guests: false,
            },
        },
        Ceilings::default(),
    )
    .unwrap()
}

#[test]
fn durable_store_reopens_rows_commits_outbox_and_sessions() {
    let path = temp_store("durability");
    let generation = generation();
    let session;
    {
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
        session = runtime
            .signup("owner@example.com", "correct horse", 100)
            .unwrap();
        let mut context = Context::mutation(
            session.principal.id.clone(),
            BTreeMap::from([
                ("id".to_owned(), Value::Id("item-1".to_owned())),
                ("name".to_owned(), Value::String("durable".to_owned())),
            ]),
        );
        context.now = Some(123);
        context.new_ids = VecDeque::from(["outbox-1".to_owned()]);
        let execution = runtime.execute("items.create", context).unwrap();
        assert_eq!(execution.state, ExecutionState::Committed { seq: 1 });
        assert_eq!(execution.trace.emits.len(), 1);
        let rename = runtime
            .execute(
                "items.rename",
                Context::mutation(
                    session.principal.id.clone(),
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("item-1".to_owned())),
                        ("name".to_owned(), Value::String("renamed".to_owned())),
                    ]),
                ),
            )
            .unwrap();
        assert_eq!(rename.state, ExecutionState::Committed { seq: 2 });
        let by_name: Vec<_> = rename
            .trace
            .touched
            .iter()
            .filter(|key| key.index == "byName")
            .collect();
        assert_eq!(by_name.len(), 2, "update traces old and new index keys");
    }

    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    assert_eq!(
        runtime.authenticate(&session.token, 101).unwrap(),
        session.principal
    );
    let execution = runtime
        .execute("items.list", Context::query("system", BTreeMap::new()))
        .unwrap();
    assert_eq!(execution.result.as_array().unwrap().len(), 1);
    let commits = runtime.store().commits_since(0, 10).unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0].emits, 1);
    assert!(commits[0].touched.iter().any(|key| key.index == "byName"));
    assert_eq!(
        runtime.store().outbox_counts().unwrap(),
        OutboxCounts {
            queued: 1,
            running: 0,
            then_pending: 0,
            sent: 0,
            failed: 0,
            sent_unknown: 0,
        }
    );
    drop(runtime);

    let connection = rusqlite::Connection::open(&path).unwrap();
    let outbox: i64 = connection
        .query_row("SELECT COUNT(*) FROM _outbox", [], |row| row.get(0))
        .unwrap();
    assert_eq!(outbox, 1);
    drop(connection);
    cleanup(&path);
}

#[test]
fn seed_is_rule_exempt_but_still_validates_columns_and_unique_constraints() {
    let mut denied = schema();
    denied.effects.clear();
    let table = denied.tables.get_mut("items").unwrap();
    table.rules.insert = RuleExpr::Deny;
    table.rules.update = RuleExpr::Deny;
    table.indexes.get_mut("byName").unwrap().columns = vec!["name".to_owned()];
    table.constraints.push(Constraint::Unique {
        index: "byName".to_owned(),
    });
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: denied,
            programs: Vec::new(),
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();

    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("seed-1".to_owned())),
                ("name", Value::String("allowed only for seed".to_owned())),
            ]),
        )])
        .expect("seed bypasses deny rules");
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);

    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("seed-1".to_owned())),
                ("name", Value::String("updated by seed".to_owned())),
            ]),
        )])
        .expect("seed updates also bypass deny rules");
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);

    let duplicate = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id("seed-2".to_owned())),
            ("name", Value::String("updated by seed".to_owned())),
        ]),
    )]);
    assert!(
        matches!(duplicate, Err(RuntimeError::Constraint(_))),
        "{duplicate:?}"
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);

    let invalid = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id("seed-3".to_owned())),
            ("name", Value::Int(7)),
        ]),
    )]);
    assert!(matches!(invalid, Err(RuntimeError::Input(_))));
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);
}

#[test]
fn store_snapshot_reset_and_reserved_names_obey_the_contract() {
    let snapshot = temp_store("snapshot");
    let mut store = Store::memory().unwrap();
    store.set_meta("custom", "kept").unwrap();
    store.snapshot_to(&snapshot).unwrap();
    assert_eq!(
        Store::open(&snapshot)
            .unwrap()
            .meta("custom")
            .unwrap()
            .as_deref(),
        Some("kept")
    );
    store.reset_data().unwrap();
    assert_eq!(store.meta("custom").unwrap().as_deref(), Some("kept"));
    assert_eq!(store.commit_seq().unwrap(), 0);

    let mut invalid = schema();
    invalid
        .tables
        .insert("_owned".to_owned(), invalid.tables["items"].clone());
    assert!(matches!(
        Engine::memory(invalid),
        Err(RuntimeError::SchemaReserved(name)) if name == "_owned"
    ));
    cleanup(&snapshot);
}

#[test]
fn durable_store_has_one_owner_and_owner_can_snapshot() {
    let path = temp_store("owner");
    let snapshot = temp_store("owner-snapshot");
    let mut first = Store::open(&path).unwrap();
    first.set_meta("snapshot_marker", "present").unwrap();
    let holder = first.meta("owner").unwrap().unwrap();
    assert!(holder.starts_with(&format!("{}@", std::process::id())));
    assert_eq!(holder.matches(':').count(), 1);

    let started = Instant::now();
    let error = match Store::open(&path) {
        Ok(_) => panic!("a second store owner unexpectedly acquired the path"),
        Err(error) => error,
    };
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(matches!(
        error,
        RuntimeError::StoreOwned { holder: actual } if actual == holder
    ));

    first.snapshot_to(&snapshot).unwrap();
    let snapshot_store = Store::open(&snapshot).unwrap();
    assert_eq!(
        snapshot_store.meta("snapshot_marker").unwrap().as_deref(),
        Some("present")
    );
    drop(snapshot_store);
    drop(first);

    let reopened = Store::open(&path).unwrap();
    assert!(reopened.meta("owner").unwrap().is_some());
    drop(reopened);
    cleanup(&path);
    cleanup(&snapshot);
}

#[test]
fn commit_log_retains_exactly_the_latest_ten_thousand_mutations() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation()).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("item-1".to_owned())),
                ("name", Value::String("same".to_owned())),
            ]),
        )])
        .unwrap();
    for _ in 0..10_005 {
        runtime
            .execute(
                "items.rename",
                Context::mutation(
                    "system",
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("item-1".to_owned())),
                        ("name".to_owned(), Value::String("same".to_owned())),
                    ]),
                ),
            )
            .unwrap();
    }
    assert_eq!(runtime.store().commit_seq().unwrap(), 10_006);
    let commits = runtime.store().commits_since(0, 20_000).unwrap();
    assert_eq!(commits.len(), 10_000);
    assert_eq!(commits.first().unwrap().seq, 7);
    assert_eq!(commits.last().unwrap().seq, 10_006);
}

fn cleanup(path: &Path) {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let _ = std::fs::remove_file(path);
    }
}
