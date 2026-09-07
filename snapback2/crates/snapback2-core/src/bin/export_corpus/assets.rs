use super::*;

const IMAGE_ID: &str = "s2id-00000000000000000000000000000006-0000000000000001";
const VIDEO_ID: &str = "s2id-00000000000000000000000000000006-0000000000000002";
const VIDEO_2_ID: &str = "s2id-00000000000000000000000000000006-0000000000000003";

pub(super) fn add_asset_cases(cases: &mut Vec<CorpusCase>) {
    add_valid_write_cases(cases);
    add_engine_only_cases(cases);
    add_shape_refusals(cases);
    add_member_case(cases);
    add_engine_authority_cases(cases);
}

fn asset(kind: AssetKind, id: &str, width: i64, height: i64, duration: Option<i64>) -> Value {
    let mut fields = BTreeMap::from([
        ("id".to_owned(), Value::String(id.to_owned())),
        ("width".to_owned(), Value::Int(width)),
        ("height".to_owned(), Value::Int(height)),
    ]);
    if kind == AssetKind::Video {
        fields.insert(
            "duration".to_owned(),
            Value::Int(duration.expect("video duration")),
        );
    }
    Value::Map(fields.into())
}

fn image() -> Value {
    asset(AssetKind::Image, IMAGE_ID, 640, 480, None)
}

fn video() -> Value {
    asset(AssetKind::Video, VIDEO_ID, 1_920, 1_080, Some(9_000))
}

fn video_2() -> Value {
    asset(AssetKind::Video, VIDEO_2_ID, 320, 240, Some(1_000))
}

fn asset_table(column: &str, kind: ColumnType) -> Schema {
    Schema {
        tables: BTreeMap::from([(
            "media".to_owned(),
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
            ),
        )]),
        ..Schema::default()
    }
}

fn write_program(name: &str, column: &str, kind: ArgType, replace: bool) -> Program {
    let write = if replace {
        Stmt::Update {
            table: "media".to_owned(),
            key: var("rowId"),
            patch: Expr::Object(BTreeMap::from([(column.to_owned(), var("asset"))])),
        }
    } else {
        Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                (column.to_owned(), var("asset")),
            ])),
        }
    };
    Program {
        name: name.to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), kind),
        ]),
        read_time_granularity_ms: None,
        body: vec![write, Stmt::Return(var("asset"))],
    }
}

fn add_valid_write_cases(cases: &mut Vec<CorpusCase>) {
    let schema = asset_table(
        "photo",
        ColumnType::Image {
            max: 5_000_000,
            once: false,
        },
    );
    cases.push(case_from_parts(
        "asset-valid-image-insert",
        "asset",
        schema,
        write_program(
            "media.insertImage",
            "photo",
            ArgType::Image { max: 5_000_000 },
            false,
        ),
        mutation_context(
            [("rowId", id("media-1")), ("asset", image())],
            Vec::<String>::new(),
        ),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    cases.push(case_from_parts(
        "asset-once-image-insert",
        "asset",
        asset_table(
            "photo",
            ColumnType::Image {
                max: 5_000_000,
                once: true,
            },
        ),
        write_program(
            "media.insertOnceImage",
            "photo",
            ArgType::Image { max: 5_000_000 },
            false,
        ),
        mutation_context(
            [("rowId", id("media-once")), ("asset", image())],
            Vec::<String>::new(),
        ),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    let schema = asset_table("clip", ColumnType::Video { max: 25_000_000 });
    let old = asset(
        AssetKind::Video,
        "s2id-00000000000000000000000000000006-0000000000000004",
        100,
        100,
        Some(500),
    );
    cases.push(case_from_parts(
        "asset-valid-video-replace",
        "asset",
        schema,
        write_program(
            "media.replaceVideo",
            "clip",
            ArgType::Video { max: 25_000_000 },
            true,
        ),
        mutation_context(
            [("rowId", id("media-1")), ("asset", video())],
            Vec::<String>::new(),
        ),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([("id", id("media-1")), ("clip", old)]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));

    let column = ColumnType::List {
        of: Box::new(ColumnType::Video { max: 25_000_000 }),
        max: 4,
    };
    let argument = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 25_000_000 })),
        max: 4,
    };
    cases.push(case_from_parts(
        "asset-valid-video-list-insert",
        "asset",
        asset_table("clips", column),
        write_program("media.insertVideos", "clips", argument, false),
        mutation_context(
            [
                ("rowId", id("media-1")),
                ("asset", Value::Array(vec![video(), video_2()])),
            ],
            Vec::<String>::new(),
        ),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    let schema = Schema {
        tables: BTreeMap::from([(
            "media".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("assetId".to_owned(), ColumnType::Text { max: 80 }),
                    (
                        "photo".to_owned(),
                        ColumnType::Image {
                            max: 5_000_000,
                            once: false,
                        },
                    ),
                ]),
                BTreeMap::new(),
            ),
        )]),
        ..Schema::default()
    };
    let program = Program {
        name: "media.authoritativeInsert".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            ("asset".to_owned(), ArgType::Image { max: 5_000_000 }),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                (
                    "assetId".to_owned(),
                    Expr::Field {
                        base: Box::new(var("asset")),
                        name: "id".to_owned(),
                    },
                ),
                ("photo".to_owned(), var("asset")),
            ])),
        }],
    };
    assert_authoritative_insert(&schema, &program);
    cases.push(case_from_parts(
        "asset-authoritative-insert-id-member",
        "asset",
        schema,
        program,
        mutation_context(
            [("rowId", id("media-1")), ("asset", image())],
            Vec::<String>::new(),
        ),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));

    cases.push(case_from_parts(
        "asset-optional-clear",
        "asset",
        asset_table(
            "photo",
            ColumnType::Optional(Box::new(ColumnType::Image {
                max: 5_000_000,
                once: false,
            })),
        ),
        write_program(
            "media.clearImage",
            "photo",
            ArgType::Optional(Box::new(ArgType::Image { max: 5_000_000 })),
            true,
        ),
        mutation_context(
            [("rowId", id("media-1")), ("asset", Value::Null)],
            Vec::<String>::new(),
        ),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([("id", id("media-1")), ("photo", image())]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));

    let list_column = ColumnType::List {
        of: Box::new(ColumnType::Video { max: 25_000_000 }),
        max: 4,
    };
    let list_arg = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 25_000_000 })),
        max: 4,
    };
    cases.push(case_from_parts(
        "asset-list-shrink",
        "asset",
        asset_table("clips", list_column),
        write_program("media.shrinkVideos", "clips", list_arg, true),
        mutation_context(
            [
                ("rowId", id("media-1")),
                ("asset", Value::Array(vec![video_2()])),
            ],
            Vec::<String>::new(),
        ),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([
                    ("id", id("media-1")),
                    ("clips", Value::Array(vec![video(), video_2()])),
                ]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));
}

fn assert_authoritative_insert(schema: &Schema, program: &Program) {
    let mut store = Store::memory().unwrap();
    store
        .set_meta("id_namespace", "00000000000000000000000000000006")
        .unwrap();
    store.set_meta("id_high_water", "0").unwrap();
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema.clone(),
            programs: vec![program.clone()],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut runtime = Runtime::open(store, generation).unwrap();
    let actor = Actor::user("u1").unwrap();
    let id = ready(&mut runtime, AssetKind::Image, &actor, 100);
    assert_eq!(id, IMAGE_ID);
    let execution = runtime
        .execute(
            &program.name,
            mutation_context(
                [
                    ("rowId", crate::id("media-1")),
                    ("asset", asset(AssetKind::Image, &id, 640, 480, None)),
                ],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);
    assert!(
        runtime
            .store()
            .asset(&id)
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
}

fn asset_runtime(schema: Schema, programs: Vec<Program>) -> Runtime {
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
            programs,
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut store = Store::memory().unwrap();
    store
        .set_meta("id_namespace", "00000000000000000000000000000006")
        .unwrap();
    store.set_meta("id_high_water", "0").unwrap();
    Runtime::open(store, generation).unwrap()
}

fn add_engine_only_cases(cases: &mut Vec<CorpusCase>) {
    add_index_refusal_cases(cases);

    let alice = Actor::user("u1").unwrap();
    let optional_schema = asset_table(
        "photo",
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 5_000_000,
            once: false,
        })),
    );
    let optional_arg = ArgType::Optional(Box::new(ArgType::Image { max: 5_000_000 }));
    let insert_optional =
        write_program("media.insertOptional", "photo", optional_arg.clone(), false);
    let clear_optional = write_program("media.clearOptional", "photo", optional_arg, true);
    let mut runtime = asset_runtime(
        optional_schema,
        vec![insert_optional.clone(), clear_optional.clone()],
    );
    let optional_id = ready(&mut runtime, AssetKind::Image, &alice, 100);
    runtime
        .execute(
            &insert_optional.name,
            mutation_context(
                [
                    ("rowId", id("media-1")),
                    (
                        "asset",
                        asset(AssetKind::Image, &optional_id, 640, 480, None),
                    ),
                ],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    let mut clear_context = mutation_context(
        [("rowId", id("media-1")), ("asset", Value::Null)],
        Vec::<String>::new(),
    );
    clear_context.now = Some(10);
    runtime
        .execute(&clear_optional.name, clear_context)
        .unwrap();
    let released = runtime.store().asset(&optional_id).unwrap().unwrap();
    assert!(released.locator.is_none());
    assert_eq!(released.released_at, Some(10));

    let image_kind = ColumnType::Image {
        max: 5_000_000,
        once: false,
    };
    let image_arg = ArgType::Image { max: 5_000_000 };
    let image_schema = asset_table("photo", image_kind);
    let insert_image = write_program("media.insertImage", "photo", image_arg.clone(), false);
    let replace_image = write_program("media.replaceImage", "photo", image_arg, true);
    let mut runtime = asset_runtime(
        image_schema.clone(),
        vec![insert_image.clone(), replace_image.clone()],
    );
    let first_id = ready(&mut runtime, AssetKind::Image, &alice, 100);
    let second_id = ready(&mut runtime, AssetKind::Image, &alice, 100);
    let first = asset(AssetKind::Image, &first_id, 640, 480, None);
    let second = asset(AssetKind::Image, &second_id, 640, 480, None);
    runtime
        .execute(
            &insert_image.name,
            mutation_context(
                [("rowId", id("media-1")), ("asset", first.clone())],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    runtime
        .execute(
            &replace_image.name,
            mutation_context(
                [("rowId", id("media-1")), ("asset", second)],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    assert_eq!(
        runtime
            .asset_delivery(&first_id, Context::query(alice.clone(), BTreeMap::new()))
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
    cases.push(case_from_parts(
        "asset-replace-mutation",
        "asset-twin-program",
        image_schema.clone(),
        replace_image,
        mutation_context(
            [("rowId", id("media-1")), ("asset", image())],
            Vec::<String>::new(),
        ),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([("id", id("media-1")), ("photo", first)]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));

    let list_column = ColumnType::List {
        of: Box::new(ColumnType::Video { max: 25_000_000 }),
        max: 4,
    };
    let list_arg = ArgType::List {
        of: Some(Box::new(ArgType::Video { max: 25_000_000 })),
        max: 4,
    };
    let list_schema = asset_table("clips", list_column);
    let insert_list = write_program("media.insertList", "clips", list_arg.clone(), false);
    let shrink_list = write_program("media.shrinkList", "clips", list_arg, true);
    let mut runtime = asset_runtime(
        list_schema.clone(),
        vec![insert_list.clone(), shrink_list.clone()],
    );
    let removed_id = ready(&mut runtime, AssetKind::Video, &alice, 100);
    let kept_id = ready(&mut runtime, AssetKind::Video, &alice, 100);
    let removed = asset(AssetKind::Video, &removed_id, 640, 480, Some(1_000));
    let kept = asset(AssetKind::Video, &kept_id, 640, 480, Some(1_000));
    runtime
        .execute(
            &insert_list.name,
            mutation_context(
                [
                    ("rowId", id("media-1")),
                    ("asset", Value::Array(vec![removed.clone(), kept.clone()])),
                ],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    runtime
        .execute(
            &shrink_list.name,
            mutation_context(
                [
                    ("rowId", id("media-1")),
                    ("asset", Value::Array(vec![kept])),
                ],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    assert!(
        runtime
            .store()
            .asset(&removed_id)
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
    assert_eq!(
        runtime
            .asset_delivery(&removed_id, Context::query(alice.clone(), BTreeMap::new()))
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
    cases.push(case_from_parts(
        "asset-list-shrink-mutation",
        "asset-twin-program",
        list_schema,
        shrink_list,
        mutation_context(
            [
                ("rowId", id("media-1")),
                ("asset", Value::Array(vec![video_2()])),
            ],
            Vec::<String>::new(),
        ),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([
                    ("id", id("media-1")),
                    ("clips", Value::Array(vec![video(), video_2()])),
                ]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));

    let mut runtime = asset_runtime(image_schema.clone(), vec![insert_image.clone()]);
    let dropped_id = ready(&mut runtime, AssetKind::Image, &alice, 100);
    runtime
        .execute(
            &insert_image.name,
            mutation_context(
                [
                    ("rowId", id("media-1")),
                    (
                        "asset",
                        asset(AssetKind::Image, &dropped_id, 640, 480, None),
                    ),
                ],
                Vec::<String>::new(),
            ),
        )
        .unwrap();
    runtime
        .apply_migration(
            Generation::certify(
                &ProjectJson {
                    version: 1,
                    schema: Schema::default(),
                    programs: Vec::new(),
                    effects: Vec::new(),
                    auth: Auth::default(),
                },
                Ceilings::default(),
            )
            .unwrap(),
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
            .asset(&dropped_id)
            .unwrap()
            .unwrap()
            .locator
            .is_none()
    );
    cases.push(case_from_parts(
        "asset-row-delete-mutation",
        "asset-twin-program",
        image_schema,
        Program {
            name: "media.deleteForSuccessorWitness".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([("rowId".to_owned(), ArgType::Id)]),
            read_time_granularity_ms: None,
            body: vec![Stmt::Delete {
                table: "media".to_owned(),
                key: var("rowId"),
            }],
        },
        mutation_context([("rowId", id("media-1"))], Vec::<String>::new()),
        ClosureReceipt {
            rows: vec![RowRecord {
                table: "media".to_owned(),
                id: "media-1".to_owned(),
                row: row([("id", id("media-1")), ("photo", image())]),
            }],
            ..ClosureReceipt::default()
        },
        Vec::new(),
        None,
        None,
    ));
}

fn add_index_refusal_cases(cases: &mut Vec<CorpusCase>) {
    let specifications = [
        (
            "asset-index-optional-refused",
            ColumnType::Optional(Box::new(ColumnType::Image {
                max: 5_000_000,
                once: false,
            })),
        ),
        (
            "asset-index-list-refused",
            ColumnType::List {
                of: Box::new(ColumnType::Image {
                    max: 5_000_000,
                    once: false,
                }),
                max: 4,
            },
        ),
    ];
    for (name, column) in specifications {
        let mut schema = asset_table("photo", column);
        schema.tables.get_mut("media").unwrap().indexes.insert(
            "byPhoto".to_owned(),
            Index {
                components: (vec!["photo".to_owned()])
                    .into_iter()
                    .map(snapback2_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: false,
            },
        );
        cases.push(certification_refusal_case(
            name,
            "asset-certification-refusal",
            schema,
            "E_SCHEMA_INDEX_COLUMN",
        ));
    }
}

fn certification_refusal_case(
    name: &str,
    category: &str,
    schema: Schema,
    error_code: &str,
) -> CorpusCase {
    let program = Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(Expr::Literal(Value::Null))],
    };
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema.clone(),
            programs: vec![program.clone()],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .expect_err("certification-refusal corpus case must be refused");
    assert!(
        errors.iter().any(|(_, error)| error.code == error_code),
        "{name} did not produce {error_code}: {errors:?}"
    );
    let envelope = serde_json::json!({ "Error": error_code });
    CorpusCase {
        server_only: false,
        certification_rewrite: None,
        corpus_version: CORPUS_VERSION,
        name: name.to_owned(),
        category: category.to_owned(),
        random_seed: None,
        schema,
        program,
        certificate: None,
        context: Context::query(Actor::user("u1").expect("corpus actor"), BTreeMap::new()),
        receipt: ClosureReceipt::default(),
        prelude: Vec::new(),
        replacement_receipt: None,
        expected: Expected {
            error_reason: None,
            local_result: None,
            error_code: Some(error_code.to_owned()),
            local_state: "certification-refused".to_owned(),
            partial_sites: Vec::new(),
            canonical_result: serde_json::to_string(&envelope).expect("error envelope"),
            digest: digest(&envelope),
            range_stops: BTreeMap::new(),
            evicted_rows: None,
            next: None,
        },
    }
}

fn arg_case(name: &str, kind: ArgType, value: Value) -> CorpusCase {
    let program = Program {
        name: name.to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("asset".to_owned(), kind)]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(var("asset"))],
    };
    case_from_parts(
        name,
        "asset-shape",
        Schema::default(),
        program,
        query_context([("asset", value)]),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    )
}

fn add_shape_refusals(cases: &mut Vec<CorpusCase>) {
    let image_kind = || ArgType::Image { max: 5_000_000 };
    let video_kind = || ArgType::Video { max: 25_000_000 };
    cases.push(arg_case(
        "asset-shape-not-map",
        image_kind(),
        Value::String(IMAGE_ID.to_owned()),
    ));
    let Value::Map(mut missing) = image() else {
        unreachable!()
    };
    missing.remove("height");
    cases.push(arg_case(
        "asset-shape-missing-field",
        image_kind(),
        Value::Map(missing.into()),
    ));
    let Value::Map(mut extra) = image() else {
        unreachable!()
    };
    extra.insert("duration".to_owned(), Value::Int(1));
    cases.push(arg_case(
        "asset-shape-extra-field",
        image_kind(),
        Value::Map(extra.into()),
    ));
    let Value::Map(mut malformed_id) = image() else {
        unreachable!()
    };
    malformed_id.insert("id".to_owned(), Value::String("asset-1".to_owned()));
    cases.push(arg_case(
        "asset-shape-malformed-id",
        image_kind(),
        Value::Map(malformed_id.into()),
    ));
    let Value::Map(mut nominal_id) = image() else {
        unreachable!()
    };
    nominal_id.insert("id".to_owned(), Value::Id(IMAGE_ID.to_owned()));
    cases.push(arg_case(
        "asset-shape-nominal-id",
        image_kind(),
        Value::Map(nominal_id.into()),
    ));
    let Value::Map(mut zero_width) = image() else {
        unreachable!()
    };
    zero_width.insert("width".to_owned(), Value::Int(0));
    cases.push(arg_case(
        "asset-shape-nonpositive-dimension",
        image_kind(),
        Value::Map(zero_width.into()),
    ));
    let Value::Map(mut wrong_height) = image() else {
        unreachable!()
    };
    wrong_height.insert("height".to_owned(), Value::String("480".to_owned()));
    cases.push(arg_case(
        "asset-shape-wrong-dimension-type",
        image_kind(),
        Value::Map(wrong_height.into()),
    ));
    let Value::Map(mut no_duration) = video() else {
        unreachable!()
    };
    no_duration.remove("duration");
    cases.push(arg_case(
        "asset-shape-video-missing-duration",
        video_kind(),
        Value::Map(no_duration.into()),
    ));
    let Value::Map(mut zero_duration) = video() else {
        unreachable!()
    };
    zero_duration.insert("duration".to_owned(), Value::Int(0));
    cases.push(arg_case(
        "asset-shape-video-nonpositive-duration",
        video_kind(),
        Value::Map(zero_duration.into()),
    ));
    cases.push(arg_case(
        "asset-shape-list-duplicate",
        ArgType::List {
            of: Some(Box::new(video_kind())),
            max: 4,
        },
        Value::Array(vec![video(), video()]),
    ));
}

fn add_member_case(cases: &mut Vec<CorpusCase>) {
    let duration = Expr::Field {
        base: Box::new(var("clip")),
        name: "duration".to_owned(),
    };
    let program = Program {
        name: "asset-video-duration-member".to_owned(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("clip".to_owned(), ArgType::Video { max: 25_000_000 })]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Require {
                condition: Expr::Binary {
                    op: BinaryOp::Lte,
                    left: Box::new(duration.clone()),
                    right: Box::new(Expr::Literal(Value::Int(10_000))),
                },
                code: "E_CLIP_TOO_LONG".to_owned(),
            },
            Stmt::Return(duration),
        ],
    };
    cases.push(case_from_parts(
        "asset-video-duration-member",
        "asset",
        Schema::default(),
        program,
        query_context([("clip", video())]),
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    ));
}

fn authority_program(max: u32) -> Program {
    Program {
        name: "asset.authority".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("asset".to_owned(), ArgType::Image { max })]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Return(var("asset"))],
    }
}

fn assert_authority_refusal(
    name: &str,
    expected: &str,
    setup: impl FnOnce(&mut Runtime, &Actor) -> Value,
    max: u32,
) -> CorpusCase {
    let schema = Schema::default();
    let program = authority_program(max);
    let mut store = Store::memory().expect("asset authority store");
    store
        .set_meta("id_namespace", "00000000000000000000000000000006")
        .unwrap();
    store.set_meta("id_high_water", "0").unwrap();
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema.clone(),
            programs: vec![program.clone()],
            effects: Vec::new(),
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .expect("asset authority generation");
    let mut runtime = Runtime::open(store, generation).expect("asset authority runtime");
    let actor = Actor::user("u1").unwrap();
    let value = setup(&mut runtime, &actor);
    let context = mutation_context([("asset", value.clone())], Vec::<String>::new());
    let execution = runtime
        .execute(&program.name, context.clone())
        .expect("authoritative asset refusal is typed");
    assert!(
        matches!(&execution.state, ExecutionState::Rejected { code, .. } if code == expected),
        "{name}: {:?}",
        execution.state
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), 0, "{name}");
    case_from_parts(
        name,
        "asset-authority-twin-shape-only",
        schema,
        program,
        context,
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    )
}

fn ready(runtime: &mut Runtime, kind: AssetKind, actor: &Actor, bytes: u64) -> String {
    let id = runtime.begin_asset(kind, actor, 0).unwrap();
    // Publication requires the finalized byte count reserved first (LLP 1006 §6).
    runtime.reserve_asset_finalized_bytes(&id, bytes).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &AssetReadyFacts {
                media_type: if kind == AssetKind::Image {
                    "image/png"
                } else {
                    "video/mp4"
                }
                .to_owned(),
                bytes,
                width: 640,
                height: 480,
                duration: (kind == AssetKind::Video).then_some(1_000),
            },
        )
        .unwrap();
    id
}

fn add_engine_authority_cases(cases: &mut Vec<CorpusCase>) {
    cases.push(assert_authority_refusal(
        "asset-engine-missing",
        "E_ASSET_NOT_READY",
        |_, _| image(),
        1_000,
    ));
    cases.push(assert_authority_refusal(
        "asset-engine-receiving",
        "E_ASSET_NOT_READY",
        |runtime, actor| {
            let id = runtime.begin_asset(AssetKind::Image, actor, 0).unwrap();
            asset(AssetKind::Image, &id, 640, 480, None)
        },
        1_000,
    ));
    cases.push(assert_authority_refusal(
        "asset-engine-foreign-uploader",
        "E_ASSET_TYPE",
        |runtime, _| {
            let foreign = Actor::user("foreign").unwrap();
            let id = ready(runtime, AssetKind::Image, &foreign, 100);
            asset(AssetKind::Image, &id, 640, 480, None)
        },
        1_000,
    ));
    cases.push(assert_authority_refusal(
        "asset-engine-kind-mismatch",
        "E_ASSET_TYPE",
        |runtime, actor| {
            let id = ready(runtime, AssetKind::Video, actor, 100);
            asset(AssetKind::Image, &id, 640, 480, None)
        },
        1_000,
    ));
    cases.push(assert_authority_refusal(
        "asset-engine-fact-mismatch",
        "E_ASSET_TYPE",
        |runtime, actor| {
            let id = ready(runtime, AssetKind::Image, actor, 100);
            asset(AssetKind::Image, &id, 641, 480, None)
        },
        1_000,
    ));
    cases.push(assert_authority_refusal(
        "asset-engine-too-large",
        "E_ASSET_TOO_LARGE",
        |runtime, actor| {
            let id = ready(runtime, AssetKind::Image, actor, 1_001);
            asset(AssetKind::Image, &id, 640, 480, None)
        },
        1_000,
    ));
    cases.push(forged_first_require_case());
}

fn forged_first_require_case() -> CorpusCase {
    let schema = Schema {
        tables: BTreeMap::from([(
            "events".to_owned(),
            public_table(
                BTreeMap::from([
                    ("id".to_owned(), ColumnType::Id),
                    ("body".to_owned(), ColumnType::Text { max: 20 }),
                ]),
                BTreeMap::new(),
            ),
        )]),
        effects: vec!["notify".to_owned()],
        ..Schema::default()
    };
    let duration = Expr::Field {
        base: Box::new(var("clip")),
        name: "duration".to_owned(),
    };
    let program = Program {
        name: "asset.forgedFirstRequire".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([("clip".to_owned(), ArgType::Video { max: 1_000 })]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Require {
                condition: Expr::Binary {
                    op: BinaryOp::Lte,
                    left: Box::new(duration),
                    right: Box::new(Expr::Literal(Value::Int(60_000))),
                },
                code: "TOO_LONG".to_owned(),
            },
            Stmt::Insert {
                table: "events".to_owned(),
                row: Expr::Literal(row([("id", id("event-1")), ("body", text("wrote"))])),
            },
            Stmt::Emit {
                effect: "notify".to_owned(),
                payload: Expr::Literal(text("emitted")),
            },
        ],
    };
    let effects = vec![EffectDecl {
        name: "notify".to_owned(),
        grants: Vec::new(),
        source: "async () => null".to_owned(),
        then: None,
    }];
    let generation = Generation::certify(
        &ProjectJson {
            version: 1,
            schema: schema.clone(),
            programs: vec![program.clone()],
            effects,
            auth: Auth::default(),
        },
        Ceilings::default(),
    )
    .unwrap();
    let mut store = Store::memory().unwrap();
    store
        .set_meta("id_namespace", "00000000000000000000000000000006")
        .unwrap();
    store.set_meta("id_high_water", "0").unwrap();
    let mut runtime = Runtime::open(store, generation).unwrap();
    let actor = Actor::user("u1").unwrap();
    let id = runtime.begin_asset(AssetKind::Video, &actor, 0).unwrap();
    runtime.reserve_asset_finalized_bytes(&id, 100).unwrap();
    runtime
        .mark_asset_ready(
            &id,
            &AssetReadyFacts {
                media_type: "video/mp4".to_owned(),
                bytes: 100,
                width: 640,
                height: 480,
                duration: Some(90_000),
            },
        )
        .unwrap();
    let forged = asset(AssetKind::Video, &id, 640, 480, Some(9_000));
    let context = mutation_context([("clip", forged)], ["outbox-1"]);
    let execution = runtime.execute(&program.name, context.clone()).unwrap();
    assert!(
        matches!(&execution.state, ExecutionState::Rejected { code, .. } if code == "E_ASSET_TYPE")
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    assert_eq!(
        runtime.store().outbox_counts().unwrap(),
        OutboxCounts::default()
    );
    assert!(
        runtime
            .read_rule_verdicts(
                "events",
                Context::query(Actor::user("u1").unwrap(), BTreeMap::new()),
            )
            .unwrap()
            .is_empty()
    );
    case_from_parts(
        "asset-video-field-require-mutation",
        "asset-twin-program",
        schema,
        program,
        context,
        ClosureReceipt::default(),
        Vec::new(),
        None,
        None,
    )
}
