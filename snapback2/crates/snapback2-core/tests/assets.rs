use snapback2_core::*;
use std::collections::{BTreeMap, VecDeque};

#[path = "assets/once.rs"]
mod once;
#[path = "assets/pending.rs"]
mod pending;
#[path = "assets/reclaim.rs"]
mod reclaim;
#[path = "assets/release_clock.rs"]
mod release_clock;

fn schema_with(table: Table) -> Schema {
    Schema {
        tables: BTreeMap::from([("media".to_owned(), table)]),
        ..Schema::default()
    }
}

fn table_with(column: &str, kind: ColumnType) -> Table {
    public_table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id), (column.to_owned(), kind)]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    )
}

fn table_without_indexes(column: &str, kind: ColumnType) -> Table {
    public_table(
        BTreeMap::from([("id".to_owned(), ColumnType::Id), (column.to_owned(), kind)]),
        BTreeMap::new(),
    )
}

fn generation(schema: Schema, programs: Vec<Program>) -> Generation {
    Generation::certify(
        &ProjectJson {
            version: 1,
            auth: schema.auth.clone(),
            schema,
            programs,
            effects: Vec::new(),
        },
        Ceilings::default(),
    )
    .unwrap()
}

fn insert_program(column: &str, kind: ArgType) -> Program {
    Program {
        name: "media.insert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), kind),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                (column.to_owned(), var("asset")),
            ])),
        }],
    }
}

fn replace_program(column: &str, kind: ArgType) -> Program {
    Program {
        name: "media.replace".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), kind),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Update {
            table: "media".to_owned(),
            key: var("rowId"),
            patch: Expr::Object(BTreeMap::from([(column.to_owned(), var("asset"))])),
        }],
    }
}

fn delete_program() -> Program {
    Program {
        name: "media.delete".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("rowId".to_owned(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Delete {
            table: "media".to_owned(),
            key: var("rowId"),
        }],
    }
}

fn user(name: &str) -> Actor {
    Actor::user(name).unwrap()
}

fn args(row_id: &str, asset: Value) -> BTreeMap<String, Value> {
    BTreeMap::from([
        ("rowId".to_owned(), Value::Id(row_id.to_owned())),
        ("asset".to_owned(), asset),
    ])
}

fn asset_id(value: &Value) -> String {
    value.field("id").unwrap().as_str().unwrap().to_owned()
}

fn image(runtime: &mut Runtime, actor: &Actor, bytes: u64, width: i64, height: i64) -> Value {
    let id = runtime.begin_asset(AssetKind::Image, actor, 0).unwrap();
    runtime.reserve_asset_finalized_bytes(&id, bytes).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &AssetReadyFacts {
                media_type: "image/png".to_owned(),
                bytes,
                width,
                height,
                duration: None,
            },
        )
        .unwrap();
    Value::Map(
        BTreeMap::from([
            ("id".to_owned(), Value::String(id)),
            ("width".to_owned(), Value::Int(width)),
            ("height".to_owned(), Value::Int(height)),
        ])
        .into(),
    )
}

fn video(
    runtime: &mut Runtime,
    actor: &Actor,
    bytes: u64,
    width: i64,
    height: i64,
    duration: i64,
) -> Value {
    let id = runtime.begin_asset(AssetKind::Video, actor, 0).unwrap();
    runtime.reserve_asset_finalized_bytes(&id, bytes).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &AssetReadyFacts {
                media_type: "video/mp4".to_owned(),
                bytes,
                width,
                height,
                duration: Some(duration),
            },
        )
        .unwrap();
    Value::Map(
        BTreeMap::from([
            ("id".to_owned(), Value::String(id)),
            ("width".to_owned(), Value::Int(width)),
            ("height".to_owned(), Value::Int(height)),
            ("duration".to_owned(), Value::Int(duration)),
        ])
        .into(),
    )
}

fn assert_state(execution: Execution, expected: &str) {
    match execution.state {
        ExecutionState::Rejected { code, .. } => assert_eq!(code, expected),
        state => panic!("expected {expected} rejection, received {state:?}"),
    }
}

fn assert_committed(execution: &Execution) {
    assert!(
        matches!(execution.state, ExecutionState::Committed { .. }),
        "expected committed execution, received {:?}",
        execution.state
    );
}

#[test]
fn asset_ir_is_externally_tagged_and_assets_are_not_indexable() {
    assert_eq!(
        serde_json::to_value(ColumnType::Image {
            max: 123,
            once: false
        })
        .unwrap(),
        serde_json::json!({"Image":{"max":123}})
    );
    assert_eq!(
        serde_json::to_value(ArgType::Video { max: 456 }).unwrap(),
        serde_json::json!({"Video":{"max":456}})
    );

    let mut table = table_with(
        "photo",
        ColumnType::Image {
            max: 1_000,
            once: false,
        },
    );
    table.indexes.insert(
        "byPhoto".to_owned(),
        Index {
            components: (vec!["photo".to_owned()])
                .into_iter()
                .map(snapback2_core::search_key::IndexComponent::Column)
                .collect(),
            unique: false,
        },
    );
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema_with(table),
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

    for kind in [
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 1_000,
            once: false,
        })),
        ColumnType::List {
            of: Box::new(ColumnType::Image {
                max: 1_000,
                once: false,
            }),
            max: 4,
        },
    ] {
        let mut table = table_with("photo", kind);
        table.indexes.insert(
            "byPhoto".to_owned(),
            Index {
                components: (vec!["photo".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: false,
            },
        );
        let errors = Generation::certify(
            &ProjectJson {
                version: 1,
                schema: schema_with(table),
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
    }
}

#[test]
fn asset_member_access_is_closed_and_evaluates() {
    let valid = Program {
        name: "clip.duration".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("clip".to_owned(), ArgType::Video { max: 1_000 })]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Field {
            base: Box::new(var("clip")),
            name: "duration".to_owned(),
        })],
    };
    let schema = Schema::default();
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&valid)
        .unwrap();
    let mut engine = Engine::memory(schema.clone()).unwrap();
    let clip = Value::Map(
        BTreeMap::from([
            (
                "id".to_owned(),
                Value::String("s2id-00000000000000000000000000000001-0000000000000001".to_owned()),
            ),
            ("width".to_owned(), Value::Int(10)),
            ("height".to_owned(), Value::Int(20)),
            ("duration".to_owned(), Value::Int(30)),
        ])
        .into(),
    );
    let execution = engine
        .execute(
            &valid,
            &certificate,
            Context::query(user("u1"), BTreeMap::from([("clip".to_owned(), clip)])),
        )
        .unwrap();
    assert_eq!(execution.result, Value::Int(30));

    let id_member = Program {
        name: "clip.id".to_owned(),
        body: vec![Stmt::Return(Expr::Field {
            base: Box::new(var("clip")),
            name: "id".to_owned(),
        })],
        ..valid.clone()
    };
    let certificate = Checker::new(&schema, Ceilings::default())
        .check(&id_member)
        .unwrap();
    let execution = engine
        .execute(
            &id_member,
            &certificate,
            Context::query(
                user("u1"),
                BTreeMap::from([(
                    "clip".to_owned(),
                    Value::Map(
                        BTreeMap::from([
                            (
                                "id".to_owned(),
                                Value::String(
                                    "s2id-00000000000000000000000000000001-0000000000000001"
                                        .to_owned(),
                                ),
                            ),
                            ("width".to_owned(), Value::Int(10)),
                            ("height".to_owned(), Value::Int(20)),
                            ("duration".to_owned(), Value::Int(30)),
                        ])
                        .into(),
                    ),
                )]),
            ),
        )
        .unwrap();
    assert!(matches!(execution.result, Value::String(_)));

    let mut invalid = valid;
    invalid.name = "clip.unknown".to_owned();
    invalid.body = vec![Stmt::Return(Expr::Field {
        base: Box::new(var("clip")),
        name: "unknown".to_owned(),
    })];
    assert_eq!(
        Checker::new(&schema, Ceilings::default())
            .check(&invalid)
            .unwrap_err()
            .code,
        "E_ARGS_TYPE"
    );
}

#[test]
fn asset_id_is_text_and_object_literal_reconstruction_is_refused_at_check() {
    let schema = schema_with(public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("assetId".to_owned(), ColumnType::Text { max: 80 }),
            (
                "photo".to_owned(),
                ColumnType::Image {
                    max: 1_000,
                    once: false,
                },
            ),
        ]),
        BTreeMap::new(),
    ));
    let id_member = Expr::Field {
        base: Box::new(var("asset")),
        name: "id".to_owned(),
    };
    let text_write = Program {
        name: "media.rememberAssetId".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), ArgType::Image { max: 1_000 }),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                ("assetId".to_owned(), id_member.clone()),
                ("photo".to_owned(), var("asset")),
            ])),
        }],
    };
    Checker::new(&schema, Ceilings::default())
        .check(&text_write)
        .unwrap();

    let mut id_write = text_write.clone();
    id_write.name = "media.assetIdIsNotRowId".to_owned();
    if let Stmt::Insert {
        row: Expr::Object(fields),
        ..
    } = &mut id_write.body[0]
    {
        fields.insert("id".to_owned(), id_member.clone());
    }
    assert_eq!(
        Checker::new(&schema, Ceilings::default())
            .check(&id_write)
            .unwrap_err()
            .code,
        "E_ARGS_ID_SCALAR"
    );

    let mut reconstructed = text_write;
    reconstructed.name = "media.reconstructAsset".to_owned();
    if let Stmt::Insert {
        row: Expr::Object(fields),
        ..
    } = &mut reconstructed.body[0]
    {
        fields.insert(
            "photo".to_owned(),
            Expr::Object(BTreeMap::from([
                ("id".to_owned(), id_member),
                (
                    "width".to_owned(),
                    Expr::Field {
                        base: Box::new(var("asset")),
                        name: "width".to_owned(),
                    },
                ),
                (
                    "height".to_owned(),
                    Expr::Field {
                        base: Box::new(var("asset")),
                        name: "height".to_owned(),
                    },
                ),
            ])),
        );
    }
    assert_eq!(
        Checker::new(&schema, Ceilings::default())
            .check(&reconstructed)
            .unwrap_err()
            .code,
        "E_ARGS_TYPE"
    );
}

#[test]
fn entry_validation_rejects_missing_foreign_forged_oversize_and_duplicate_assets() {
    let table = table_with(
        "photo",
        ColumnType::Image {
            max: 100,
            once: false,
        },
    );
    let image_generation = generation(
        schema_with(table),
        vec![insert_program("photo", ArgType::Image { max: 100 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), image_generation).unwrap();
    let alice = user("alice");
    let bob = user("bob");

    let missing = Value::Map(
        BTreeMap::from([
            (
                "id".to_owned(),
                Value::String("s2id-00000000000000000000000000000001-0000000000000001".to_owned()),
            ),
            ("width".to_owned(), Value::Int(1)),
            ("height".to_owned(), Value::Int(1)),
        ])
        .into(),
    );
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("r0", missing)),
            )
            .unwrap(),
        "E_ASSET_NOT_READY",
    );

    let foreign = image(&mut runtime, &bob, 50, 10, 20);
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("r1", foreign)),
            )
            .unwrap(),
        "E_ASSET_TYPE",
    );

    let mut forged = image(&mut runtime, &alice, 50, 10, 20);
    if let Value::Map(fields) = &mut forged {
        fields.insert("height".to_owned(), Value::Int(21));
    }
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("r2", forged)),
            )
            .unwrap(),
        "E_ASSET_TYPE",
    );

    let oversized = image(&mut runtime, &alice, 101, 10, 20);
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice, args("r3", oversized)),
            )
            .unwrap(),
        "E_ASSET_TOO_LARGE",
    );

    let list_kind = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 1_000 })),
        max: 4,
    };
    let table = table_with(
        "clips",
        ColumnType::List {
            of: Box::new(ColumnType::Video { max: 1_000 }),
            max: 4,
        },
    );
    let generation = generation(schema_with(table), vec![insert_program("clips", list_kind)]);
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let clip = video(&mut runtime, &alice, 20, 10, 20, 30);
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice, args("r4", Value::Array(vec![clip.clone(), clip]))),
            )
            .unwrap(),
        "E_ASSET_TYPE",
    );
}

#[test]
fn first_require_cannot_observe_forged_asset_facts_or_run_later_effects() {
    let table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("body".to_owned(), ColumnType::Text { max: 20 }),
        ]),
        BTreeMap::new(),
    );
    let schema = Schema {
        tables: BTreeMap::from([("events".to_owned(), table)]),
        effects: vec!["notify".to_owned()],
        ..Schema::default()
    };
    let duration = Expr::Field {
        base: Box::new(var("clip")),
        name: "duration".to_owned(),
    };
    let program = Program {
        name: "media.requireThenAct".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("clip".to_owned(), ArgType::Video { max: 1_000 })]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Require {
                site: None,
                condition: Expr::Binary {
                    op: BinaryOp::Lte,
                    left: Box::new(duration),
                    right: Box::new(Expr::Literal(Value::Int(60_000))),
                },
                code: "TOO_LONG".to_owned(),
            },
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Literal(object([
                    ("id", Value::Id("event-1".to_owned())),
                    ("body", Value::String("wrote".to_owned())),
                ])),
            },
            Stmt::Emit {
                effect: "notify".to_owned(),
                payload: Expr::Literal(Value::String("emitted".to_owned())),
            },
        ],
    };
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs: vec![program],
            effects: vec![EffectDecl {
                name: "notify".to_owned(),
                grants: Vec::new(),
                source: "async () => null".to_owned(),
                then: None,
            }],
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let mut forged = video(&mut runtime, &alice, 100, 640, 480, 90_000);
    if let Value::Map(fields) = &mut forged {
        fields.insert("duration".to_owned(), Value::Int(9_000));
    }
    let mut context = Context::mutation(alice, BTreeMap::from([("clip".to_owned(), forged)]));
    context.new_ids = VecDeque::from(["outbox-1".to_owned()]);
    let execution = runtime.execute("media.requireThenAct", context).unwrap();
    assert_state(execution, "E_ASSET_TYPE");
    assert!(runtime.store().outbox_counts().unwrap() == OutboxCounts::default());
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    let rows = runtime
        .read_rule_verdicts("events", Context::query(user("alice"), BTreeMap::new()))
        .unwrap();
    assert!(rows.is_empty());
}

#[test]
fn entry_validation_recurses_through_optional_lists() {
    let kind = ArgType::Optional(Box::new(ArgType::List {
        of: Some(Box::new(ArgType::Image { max: 100 })),
        max: 4,
    }));
    let program = Program {
        name: "media.consumeOptionalList".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("assets".to_owned(), kind)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(var("assets"))],
    };
    let generation = generation(Schema::default(), vec![program]);
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let mut forged = image(&mut runtime, &alice, 50, 10, 20);
    if let Value::Map(fields) = &mut forged {
        fields.insert("width".to_owned(), Value::Int(11));
    }
    let execution = runtime
        .execute(
            "media.consumeOptionalList",
            Context::mutation(
                alice.clone(),
                BTreeMap::from([("assets".to_owned(), Value::Array(vec![forged]))]),
            ),
        )
        .unwrap();
    assert_state(execution, "E_ASSET_TYPE");

    let execution = runtime
        .execute(
            "media.consumeOptionalList",
            Context::mutation(alice, BTreeMap::from([("assets".to_owned(), Value::Null)])),
        )
        .unwrap();
    assert_committed(&execution);
}

#[test]
fn column_asset_bound_is_enforced_after_a_wider_argument_bound_passes_entry() {
    let generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 50,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 100 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 75, 10, 20);
    let execution = runtime
        .execute(
            "media.insert",
            Context::mutation(alice, args("row-1", photo)),
        )
        .unwrap();
    assert_state(execution, "E_ASSET_TOO_LARGE");
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
}

#[test]
fn lifecycle_reconciler_preserves_same_cell_list_edits_and_refuses_reuse() {
    let column = ColumnType::List {
        of: Box::new(ColumnType::Video { max: 1_000 }),
        max: 4,
    };
    let arg = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 1_000 })),
        max: 4,
    };
    let generation = generation(
        schema_with(table_with("clips", column)),
        vec![
            insert_program("clips", arg.clone()),
            replace_program("clips", arg),
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let first = video(&mut runtime, &alice, 20, 10, 20, 30);
    let second = video(&mut runtime, &alice, 21, 11, 21, 31);
    let third = video(&mut runtime, &alice, 22, 12, 22, 32);
    let inserted = runtime
        .execute(
            "media.insert",
            Context::mutation(
                alice.clone(),
                args("row-1", Value::Array(vec![first.clone(), second.clone()])),
            ),
        )
        .unwrap();
    assert_committed(&inserted);
    let replaced = runtime
        .execute(
            "media.replace",
            Context::mutation(
                alice.clone(),
                args(
                    "row-1",
                    Value::Array(vec![second.clone(), first.clone(), third.clone()]),
                ),
            ),
        )
        .unwrap();
    assert_committed(&replaced);
    for asset in [&first, &second, &third] {
        assert_eq!(
            runtime
                .store()
                .asset(&asset_id(asset))
                .unwrap()
                .unwrap()
                .locator,
            Some(AssetLocator {
                table: "media".to_owned(),
                row: "row-1".to_owned(),
                column: "clips".to_owned(),
            })
        );
    }
    assert!(
        runtime
            .asset_delivery(
                &asset_id(&second),
                Context::query(alice.clone(), BTreeMap::new()),
            )
            .unwrap()
            .public
    );

    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice, args("row-2", Value::Array(vec![first]))),
            )
            .unwrap(),
        "E_ASSET_IN_USE",
    );
}

#[test]
fn lifecycle_reconciler_releases_scalar_replacements_and_deletes() {
    let generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![
            insert_program("photo", ArgType::Image { max: 1_000 }),
            replace_program("photo", ArgType::Image { max: 1_000 }),
            delete_program(),
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let first = image(&mut runtime, &alice, 10, 1, 1);
    let second = image(&mut runtime, &alice, 11, 2, 2);
    assert_committed(
        &runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("row-1", first.clone())),
            )
            .unwrap(),
    );
    assert_committed(
        &runtime
            .execute(
                "media.replace",
                Context::mutation(alice.clone(), args("row-1", second.clone())),
            )
            .unwrap(),
    );
    assert!(
        runtime
            .store()
            .asset(&asset_id(&first))
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
    assert_eq!(
        runtime
            .asset_delivery(
                &asset_id(&first),
                Context::query(alice.clone(), BTreeMap::new()),
            )
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
    assert!(
        runtime
            .store()
            .asset(&asset_id(&second))
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
    assert_committed(
        &runtime
            .execute(
                "media.delete",
                Context::mutation(
                    alice,
                    BTreeMap::from([("rowId".to_owned(), Value::Id("row-1".to_owned()))]),
                ),
            )
            .unwrap(),
    );
    assert!(
        runtime
            .store()
            .asset(&asset_id(&second))
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
    assert_eq!(
        runtime
            .asset_delivery(
                &asset_id(&second),
                Context::query(user("alice"), BTreeMap::new()),
            )
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
}

#[test]
fn delivery_uses_physical_id_with_no_index_and_after_by_id_is_dropped() {
    let schema = schema_with(table_without_indexes(
        "photo",
        ColumnType::Image {
            max: 1_000,
            once: false,
        },
    ));
    let first_generation = generation(
        schema,
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), first_generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    assert_committed(
        &runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("row-1", photo)),
            )
            .unwrap(),
    );
    assert!(
        runtime
            .asset_delivery(&id, Context::query(alice, BTreeMap::new()))
            .unwrap()
            .public
    );

    let base = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    runtime
        .execute(
            "media.insert",
            Context::mutation(alice.clone(), args("row-1", photo)),
        )
        .unwrap();
    let next = generation(
        schema_with(table_without_indexes(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        Vec::new(),
    );
    runtime
        .apply_migration(
            next,
            &MigrationPlan {
                drops: vec![Drop::Index {
                    table: "media".to_owned(),
                    name: "byId".to_owned(),
                }],
            },
            0,
        )
        .unwrap();
    assert!(
        runtime
            .asset_delivery(&id, Context::query(alice, BTreeMap::new()))
            .unwrap()
            .public
    );
}

#[test]
fn delivery_uses_locator_cell_and_certified_read_rule() {
    let mut table = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            ("ownerId".to_owned(), ColumnType::Principal),
            (
                "photo".to_owned(),
                ColumnType::Image {
                    max: 1_000,
                    once: false,
                },
            ),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    table.rules.read = RuleExpr::Eq(RuleTerm::Field("ownerId".to_owned()), RuleTerm::Viewer);
    let insert = Program {
        name: "media.insert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), ArgType::Image { max: 1_000 }),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                ("ownerId".to_owned(), Expr::Input(Input::Viewer)),
                ("photo".to_owned(), var("asset")),
            ])),
        }],
    };
    let generation = generation(schema_with(table), vec![insert]);
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    let inserted = runtime
        .execute(
            "media.insert",
            Context::mutation(alice.clone(), args("row-1", photo)),
        )
        .unwrap();
    assert_committed(&inserted);

    let delivered = runtime
        .asset_delivery(&id, Context::query(alice, BTreeMap::new()))
        .unwrap();
    assert_eq!(delivered.media_type, "image/png");
    assert!(!delivered.public);
    assert_eq!(
        runtime
            .asset_delivery(&id, Context::query(user("bob"), BTreeMap::new()))
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
    assert_eq!(
        runtime.public_asset_delivery(&id).unwrap_err().code(),
        "E_ASSET_NOT_READY",
        "credential-free delivery must not manufacture a viewer for a private row"
    );
}

#[test]
fn optional_clear_and_list_shrink_release_removed_assets() {
    let optional = ColumnType::Optional(Box::new(ColumnType::Image {
        max: 1_000,
        once: false,
    }));
    let optional_arg = ArgType::Optional(Box::new(ArgType::Image { max: 1_000 }));
    let optional_generation = generation(
        schema_with(table_with("photo", optional)),
        vec![
            insert_program("photo", optional_arg.clone()),
            replace_program("photo", optional_arg),
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), optional_generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let photo_id = asset_id(&photo);
    runtime
        .execute(
            "media.insert",
            Context::mutation(alice.clone(), args("row-1", photo)),
        )
        .unwrap();
    let mut clear = Context::mutation(alice.clone(), args("row-1", Value::Null));
    clear.now = Some(10);
    assert_committed(&runtime.execute("media.replace", clear).unwrap());
    let released = runtime.store().asset(&photo_id).unwrap().unwrap();
    assert!(released.locator.is_none());
    assert_eq!(released.released_at, Some(10));

    let column = ColumnType::List {
        of: Box::new(ColumnType::Video { max: 1_000 }),
        max: 4,
    };
    let arg = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 1_000 })),
        max: 4,
    };
    let generation = generation(
        schema_with(table_with("clips", column)),
        vec![
            insert_program("clips", arg.clone()),
            replace_program("clips", arg),
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let first = video(&mut runtime, &alice, 50, 10, 20, 30);
    let second = video(&mut runtime, &alice, 50, 10, 20, 31);
    let first_id = asset_id(&first);
    let second_id = asset_id(&second);
    runtime
        .execute(
            "media.insert",
            Context::mutation(
                alice.clone(),
                args("row-1", Value::Array(vec![first, second.clone()])),
            ),
        )
        .unwrap();
    let mut shrink = Context::mutation(alice.clone(), args("row-1", Value::Array(vec![second])));
    shrink.now = Some(20);
    assert_committed(&runtime.execute("media.replace", shrink).unwrap());
    assert!(
        runtime
            .store()
            .asset(&first_id)
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
    assert_eq!(
        runtime
            .store()
            .asset(&first_id)
            .unwrap()
            .unwrap()
            .released_at,
        Some(20)
    );
    assert!(
        runtime
            .store()
            .asset(&second_id)
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
    assert_eq!(
        runtime
            .asset_delivery(&first_id, Context::query(alice, BTreeMap::new()))
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
}

#[test]
fn table_drop_and_asset_type_change_release_locators() {
    let base = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    runtime
        .execute(
            "media.insert",
            Context::mutation(alice.clone(), args("row-1", photo)),
        )
        .unwrap();
    let next = generation(Schema::default(), Vec::new());
    runtime
        .apply_migration(
            next,
            &MigrationPlan {
                drops: vec![Drop::Table {
                    name: "media".to_owned(),
                    rows: 1,
                }],
            },
            0,
        )
        .unwrap();
    assert!(
        runtime
            .store()
            .asset(&id)
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );

    let base = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), base).unwrap();
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    runtime
        .execute(
            "media.insert",
            Context::mutation(alice, args("row-1", photo)),
        )
        .unwrap();
    let next = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Optional(Box::new(ColumnType::Text { max: 80 })),
        )),
        Vec::new(),
    );
    runtime
        .apply_migration(
            next,
            &MigrationPlan {
                drops: vec![Drop::TypeChange {
                    table: "media".to_owned(),
                    column: "photo".to_owned(),
                    from: ColumnType::Image {
                        max: 1_000,
                        once: false,
                    },
                    to: ColumnType::Optional(Box::new(ColumnType::Text { max: 80 })),
                }],
            },
            0,
        )
        .unwrap();
    assert!(
        runtime
            .store()
            .asset(&id)
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
}

#[path = "assets/seed_admission.rs"]
mod seed_admission;
