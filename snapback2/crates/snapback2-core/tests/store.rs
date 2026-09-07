use snapback2_core::ir::IndexKeyExpr;
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

fn test_actor() -> Actor {
    Actor::user("store-test").unwrap()
}

fn schema() -> Schema {
    Schema {
        schedules: Vec::new(),
        tables: BTreeMap::from([(
            "items".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("name".to_owned(), ColumnType::Text { max: 64 }),
                    (
                        "ownerId".to_owned(),
                        ColumnType::Optional(Box::new(ColumnType::Ref {
                            table: "items".to_owned(),
                        })),
                    ),
                    (
                        "payload".to_owned(),
                        ColumnType::Optional(Box::new(ColumnType::Json { max_bytes: 1024 })),
                    ),
                ]),
                BTreeMap::from([
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
                        "byName".to_owned(),
                        Index {
                            components: (vec!["name".to_owned(), "id".to_owned()])
                                .into_iter()
                                .map(snapback2_core::search_key::IndexComponent::Column)
                                .collect(),
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

fn reidentify_program() -> Program {
    Program {
        name: "items.reidentify".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("key".to_owned(), ArgType::Scalar),
            ("rowId".to_owned(), ArgType::Scalar),
            ("name".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "items".to_owned(),
            key: var("key"),
            patch: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                ("name".to_owned(), var("name")),
            ])),
        }],
    }
}

fn upsert_at_program() -> Program {
    Program {
        name: "items.upsertAt".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("key".to_owned(), ArgType::Scalar),
            ("rowId".to_owned(), ArgType::Scalar),
            ("name".to_owned(), ArgType::Scalar),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Upsert {
            table: "items".to_owned(),
            key: var("key"),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                ("name".to_owned(), var("name")),
            ])),
        }],
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
            prefix: (Vec::new()).into_iter().map(IndexKeyExpr::Scalar).collect(),
            order: Order::Asc,
            take: Bound::Literal(20),
            after: None,
            before: None,
            range: None,
            opaque_cursor: false,
            merge_site: None,
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
    let create_generated = Program {
        name: "items.createGenerated".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("name".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "allocated".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("allocated")),
                    ("name".to_owned(), var("name")),
                ])),
            },
            Stmt::Emit {
                effect: "audit".to_owned(),
                payload: var("name"),
            },
            Stmt::Return(var("allocated")),
        ],
    };
    let create_then_reject = Program {
        name: "items.createThenReject".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("name".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "allocated".to_owned(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "items".to_owned(),
                row: Expr::Object(BTreeMap::from([
                    ("id".to_owned(), var("allocated")),
                    ("name".to_owned(), var("name")),
                ])),
            },
            Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: "ROLLBACK".to_owned(),
            },
        ],
    };
    let delete = Program {
        name: "items.delete".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("id".to_owned(), ArgType::Scalar)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "items".to_owned(),
            key: var("id"),
        }],
    };
    Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema(),
            programs: vec![
                insert,
                list,
                rename,
                create_generated,
                create_then_reject,
                delete,
            ],
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
            Actor::try_from(&session.principal).unwrap(),
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
                    Actor::try_from(&session.principal).unwrap(),
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
        runtime.authenticate(&session.token, 101).unwrap().principal,
        session.principal
    );
    assert!(Actor::new("system", "user").is_err());
    let execution = runtime
        .execute(
            "items.list",
            Context::query(
                Actor::try_from(&session.principal).unwrap(),
                BTreeMap::new(),
            ),
        )
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
fn addressed_writes_reject_row_id_changes_without_leaving_stale_indexes() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation()).unwrap();
    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("item-1".to_owned())),
                ("name", Value::String("original".to_owned())),
            ]),
        )])
        .unwrap();

    let reidentify = reidentify_program();
    let error = Checker::new(&schema(), Ceilings::default())
        .check(&reidentify)
        .expect_err("an update patch carrying id must not certify");
    assert_eq!(error.code, "E_SCHEMA_ID_RESERVED");

    let upsert = upsert_at_program();
    let upsert_schema = schema();
    let certificate = Checker::new(&upsert_schema, Ceilings::default())
        .check(&upsert)
        .expect("argument-dependent upsert identity equality belongs to runtime validation");
    let args = |key: &str, row_id: &str| {
        BTreeMap::from([
            ("key".to_owned(), Value::Id(key.to_owned())),
            ("rowId".to_owned(), Value::Id(row_id.to_owned())),
            ("name".to_owned(), Value::String("candidate".to_owned())),
        ])
    };
    let mut engine = Engine::memory(upsert_schema).unwrap();
    let refusal = engine
        .execute(
            &upsert,
            &certificate,
            Context::mutation(test_actor(), args("item-1", "item-2")),
        )
        .expect_err("distinct runtime upsert identities must be rejected");
    assert!(matches!(&refusal, RuntimeError::Input(_)), "{refusal}");
    engine
        .execute(
            &upsert,
            &certificate,
            Context::mutation(test_actor(), args("item-2", "item-2")),
        )
        .expect("equal runtime upsert identities must commit");
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);

    let listed = runtime
        .execute("items.list", Context::query(test_actor(), BTreeMap::new()))
        .unwrap();
    assert_eq!(
        listed.result,
        Value::Array(vec![object([
            ("id", Value::Id("item-1".to_owned())),
            ("name", Value::String("original".to_owned())),
            ("ownerId", Value::Null),
            ("payload", Value::Null),
        ])])
    );

    runtime
        .seed(&[(
            "items".to_owned(),
            object([
                ("id", Value::Id("item-2".to_owned())),
                ("name", Value::String("legitimate".to_owned())),
            ]),
        )])
        .expect("rejected writes left no index entry under the attempted new id");
    let listed = runtime
        .execute("items.list", Context::query(test_actor(), BTreeMap::new()))
        .unwrap();
    assert_eq!(listed.result.as_array().unwrap().len(), 2);
}

#[test]
fn durable_new_id_ranges_survive_rollback_reset_and_restart_without_aba() {
    let path = temp_store("durable-new-ids");
    let generation = generation();
    let old_id;
    let rolled_back_id;
    let namespace;
    {
        let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
        assert_eq!(runtime.store().meta("id_namespace").unwrap(), None);
        assert_eq!(runtime.store().meta("id_high_water").unwrap(), None);
        runtime
            .execute("items.list", Context::query(test_actor(), BTreeMap::new()))
            .unwrap();
        assert_eq!(
            runtime.store().meta("id_high_water").unwrap(),
            None,
            "read-only execution must not initialize the allocator"
        );

        let mut create = Context::mutation(
            test_actor(),
            BTreeMap::from([("name".to_owned(), Value::String("first".to_owned()))]),
        );
        create.now = Some(1);
        create.new_ids = runtime.reserve_new_ids().unwrap();
        assert_eq!(create.new_ids.len(), 1_024);
        old_id = create.new_ids.front().unwrap().clone();
        assert!(old_id.starts_with("s2id-"));
        assert!(
            !old_id.starts_with("id-"),
            "legacy ids occupy a disjoint prefix"
        );
        let created = runtime.execute("items.createGenerated", create).unwrap();
        assert_eq!(created.result.as_str().unwrap(), old_id);

        runtime
            .execute(
                "items.delete",
                Context::mutation(
                    test_actor(),
                    BTreeMap::from([("id".to_owned(), Value::Id(old_id.clone()))]),
                ),
            )
            .unwrap();

        let mut rejected = Context::mutation(
            test_actor(),
            BTreeMap::from([("name".to_owned(), Value::String("rolled back".to_owned()))]),
        );
        rejected.new_ids = runtime.reserve_new_ids().unwrap();
        rolled_back_id = rejected.new_ids.front().unwrap().clone();
        let rejection = runtime.execute("items.createThenReject", rejected).unwrap();
        assert!(matches!(
            rejection.state,
            ExecutionState::Rejected { ref code, .. } if code == "ROLLBACK"
        ));
        assert!(
            runtime
                .execute("items.list", Context::query(test_actor(), BTreeMap::new()))
                .unwrap()
                .result
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            runtime.store().meta("id_high_water").unwrap().as_deref(),
            Some("2048")
        );
        namespace = runtime.store().meta("id_namespace").unwrap().unwrap();

        runtime.reset_and_seed(&[]).unwrap();
        assert_eq!(
            runtime.store().meta("id_high_water").unwrap().as_deref(),
            Some("2048"),
            "reset must not rewind the allocator"
        );
    }

    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    assert_eq!(
        runtime.store().meta("id_namespace").unwrap().as_deref(),
        Some(namespace.as_str())
    );
    let mut successor = Context::mutation(
        test_actor(),
        BTreeMap::from([("name".to_owned(), Value::String("successor".to_owned()))]),
    );
    successor.now = Some(2);
    successor.new_ids = runtime.reserve_new_ids().unwrap();
    let successor_id = successor.new_ids.front().unwrap().clone();
    assert_ne!(successor_id, old_id);
    assert_ne!(successor_id, rolled_back_id);
    assert!(successor_id > rolled_back_id);
    assert_eq!(
        runtime.store().meta("id_high_water").unwrap().as_deref(),
        Some("3072")
    );
    let created = runtime.execute("items.createGenerated", successor).unwrap();
    assert_eq!(created.result.as_str().unwrap(), successor_id);

    let stale = runtime
        .execute(
            "items.rename",
            Context::mutation(
                test_actor(),
                BTreeMap::from([
                    ("id".to_owned(), Value::Id(old_id)),
                    ("name".to_owned(), Value::String("stale".to_owned())),
                ]),
            ),
        )
        .unwrap();
    assert!(matches!(
        stale.state,
        ExecutionState::Rejected { ref code, .. } if code == "NOT_FOUND"
    ));
    let rows = runtime
        .execute("items.list", Context::query(test_actor(), BTreeMap::new()))
        .unwrap()
        .result;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(
        rows.as_array().unwrap()[0]
            .field("id")
            .unwrap()
            .as_str()
            .unwrap(),
        successor_id
    );
    cleanup(&path);
}

#[test]
fn seed_is_rule_exempt_but_still_validates_columns_and_unique_constraints() {
    let mut denied = schema();
    denied.effects.clear();
    let table = denied.tables.get_mut("items").unwrap();
    table.rules.insert = RuleExpr::Deny;
    table.rules.update = RuleExpr::Deny;
    table.indexes.get_mut("byName").unwrap().components =
        vec![IndexComponent::Column("name".to_owned())];
    table.constraints.push(Constraint::Unique {
        index: "byName".to_owned(),
    });
    let denied_generation = Generation::certify(
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
    let mut runtime = Runtime::open(Store::memory().unwrap(), denied_generation).unwrap();

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

    let reserved_ref = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id("seed-4".to_owned())),
            ("name", Value::String("reserved relation".to_owned())),
            ("ownerId", Value::Id(SYSTEM_PRINCIPAL_ID.to_string())),
        ]),
    )]);
    assert!(matches!(reserved_ref, Err(RuntimeError::Input(_))));
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);

    let undeclared = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id("seed-5".to_owned())),
            ("name", Value::String("unknown field".to_owned())),
            ("notInSchema", Value::String("refuse me".to_owned())),
        ]),
    )]);
    assert!(
        matches!(undeclared, Err(RuntimeError::Input(ref message)) if message.contains("undeclared field notInSchema")),
        "{undeclared:?}"
    );

    let reserved_json = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id("seed-6".to_owned())),
            ("name", Value::String("reserved JSON".to_owned())),
            (
                "payload",
                Value::Map(
                    BTreeMap::from([(
                        "actor".to_owned(),
                        Value::Id(SYSTEM_PRINCIPAL_ID.to_string()),
                    )])
                    .into(),
                ),
            ),
        ]),
    )]);
    assert!(matches!(reserved_json, Err(RuntimeError::Input(_))));

    let reserved_row_id = runtime.seed(&[(
        "items".to_owned(),
        object([
            ("id", Value::Id(SYSTEM_PRINCIPAL_ID.to_string())),
            ("name", Value::String("reserved id".to_owned())),
        ]),
    )]);
    assert!(matches!(reserved_row_id, Err(RuntimeError::Input(_))));
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);

    let mut caller_runtime =
        Runtime::open(Store::memory().unwrap(), generation()).expect("caller generation");
    let mut caller = Context::mutation(
        Actor::user("u1").unwrap(),
        BTreeMap::from([
            ("id".to_owned(), Value::Id(SYSTEM_PRINCIPAL_ID.to_string())),
            ("name".to_owned(), Value::String("reserved arg".to_owned())),
        ]),
    );
    caller.new_ids = VecDeque::from(["unused".to_owned()]);
    let execution = caller_runtime.execute("items.create", caller).unwrap();
    assert!(matches!(
        execution.state,
        ExecutionState::Rejected { ref code, .. } if code == "E_INPUT"
    ));
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);
}

#[test]
fn store_snapshot_reset_and_reserved_names_obey_the_contract() {
    let snapshot = temp_store("snapshot");
    let mut store = Store::memory().unwrap();
    store.snapshot_to(&snapshot).unwrap();
    Store::open(&snapshot).unwrap();
    store.reset_data().unwrap();
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
    let first = Store::open(&path).unwrap();
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
    drop(snapshot_store);
    drop(first);

    let reopened = Store::open(&path).unwrap();
    assert!(reopened.meta("owner").unwrap().is_some());
    drop(reopened);
    cleanup(&path);
    cleanup(&snapshot);
}

#[test]
fn store_open_refuses_plaintext_and_unknown_session_shapes_without_publishing_owner() {
    for (label, schema) in [
        (
            "plaintext-session",
            "CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO _meta(key, value) VALUES
                ('store_version', '1'), ('owner', 'legacy-owner');
             CREATE TABLE _sessions (
                token TEXT PRIMARY KEY,
                principal TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
             );",
        ),
        (
            "unknown-session",
            "CREATE TABLE _sessions (unexpected TEXT PRIMARY KEY);",
        ),
    ] {
        let path = temp_store(label);
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch(schema).unwrap();
        drop(connection);

        let error = match Store::open(&path) {
            Ok(_) => panic!("{label} unexpectedly opened"),
            Err(error) => error,
        };
        assert_eq!(error.code(), "E_STORE_VERSION");
        assert!(error.to_string().contains("reset the development store"));

        let connection = rusqlite::Connection::open(&path).unwrap();
        let rows_table: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master
                 WHERE type = 'table' AND name = 'rows')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            !rows_table,
            "refusal must not partially initialize the store"
        );
        let owner = connection
            .query_row("SELECT value FROM _meta WHERE key = 'owner'", [], |row| {
                row.get::<_, String>(0)
            })
            .ok();
        if label == "plaintext-session" {
            assert_eq!(owner.as_deref(), Some("legacy-owner"));
        } else {
            assert_eq!(owner, None);
        }
        drop(connection);
        cleanup(&path);
    }
}

#[test]
fn store_open_refuses_digest_hybrids_without_blob_type_constraints() {
    let path = temp_store("session-digest-hybrid");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO _meta(key, value) VALUES ('store_version', '2');
             CREATE TABLE _sessions (
                auth_epoch INTEGER PRIMARY KEY AUTOINCREMENT,
                token_digest BLOB NOT NULL UNIQUE CHECK(length(token_digest) = 32),
                principal TEXT NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
             );",
        )
        .unwrap();
    drop(connection);

    let error = match Store::open(&path) {
        Ok(_) => panic!("digest hybrid unexpectedly opened"),
        Err(error) => error,
    };
    assert_eq!(error.code(), "E_STORE_VERSION");
    assert!(error.to_string().contains("reset the development store"));
    cleanup(&path);
}

#[test]
fn row_index_cleanup_seeks_the_row_on_new_and_reopened_stores() {
    let path = temp_store("row-index-plan");
    for reopened in [false, true] {
        drop(Store::open(&path).unwrap());
        let connection = rusqlite::Connection::open(&path).unwrap();
        let plan = connection
            .prepare(
                "EXPLAIN QUERY PLAN DELETE FROM index_entries
                 WHERE table_name = ?1 AND row_id = ?2",
            )
            .unwrap()
            .query_map(["messages", "one-message"], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            plan.iter()
                .any(|step| step.contains("table_name=? AND row_id=?")),
            "row cleanup must seek both keys, not scan all of a table's entries: {plan:?}"
        );
        let lookup_plan = connection
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT r.data
                 FROM index_entries ie
                 JOIN rows r ON r.table_name = ie.table_name AND r.row_id = ie.row_id
                 WHERE ie.table_name = ?1 AND ie.index_name = ?2 AND ie.c0 = ?3
                 LIMIT 1",
            )
            .unwrap()
            .query_map(["messages", "by_conversation", "one-conversation"], |row| {
                row.get::<_, String>(3)
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(
            lookup_plan.iter().any(|step| step
                .contains("index_entries_lookup (table_name=? AND index_name=? AND c0=?)")),
            "the row-cleanup index must not displace the hot point-read path: {lookup_plan:?}"
        );
        if !reopened {
            // Existing stores also acquire the access path on their next open.
            connection
                .execute_batch("DROP INDEX index_entries_by_row")
                .unwrap();
        }
    }
    cleanup(&path);
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
                    Actor::user("u1").unwrap(),
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
