use super::*;

#[test]
fn asset_maintain_keys_and_seed_values_are_schema_refusals() {
    let source = table_with(
        "photo",
        ColumnType::Image {
            max: 100,
            once: false,
        },
    );
    let target = public_table(
        BTreeMap::from([
            ("id".to_owned(), ColumnType::Id),
            (
                "photo".to_owned(),
                ColumnType::Image {
                    max: 100,
                    once: false,
                },
            ),
            ("value".to_owned(), ColumnType::Int),
        ]),
        BTreeMap::from([(
            "byId".to_owned(),
            Index {
                components: (vec!["id".to_owned()])
                    .into_iter()
                    .map(snapback3_core::search_key::IndexComponent::Column)
                    .collect(),
                unique: true,
            },
        )]),
    );
    let schema = Schema {
        tables: BTreeMap::from([
            ("media".to_owned(), source.clone()),
            ("counts".to_owned(), target),
        ]),
        maintains: vec![Maintain {
            source: "media".to_owned(),
            target: "counts".to_owned(),
            by: vec!["photo".to_owned()],
            kind: MaintainKind::Count,
            readable: None,
        }],
        ..Schema::default()
    };
    let errors = Generation::certify(
        &ProjectJson {
            version: 1,
            schema,
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
            .any(|(_, error)| error.code == "E_SCHEMA_MAINTAIN")
    );

    for kind in [
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 100,
            once: false,
        })),
        ColumnType::List {
            of: Box::new(ColumnType::Image {
                max: 100,
                once: false,
            }),
            max: 4,
        },
    ] {
        let source = table_with("photo", kind.clone());
        let target = public_table(
            BTreeMap::from([
                ("id".to_owned(), ColumnType::Id),
                ("photo".to_owned(), kind),
                ("value".to_owned(), ColumnType::Int),
            ]),
            BTreeMap::new(),
        );
        let schema = Schema {
            tables: BTreeMap::from([("media".to_owned(), source), ("counts".to_owned(), target)]),
            maintains: vec![Maintain {
                source: "media".to_owned(),
                target: "counts".to_owned(),
                by: vec!["photo".to_owned()],
                kind: MaintainKind::Count,
                readable: None,
            }],
            ..Schema::default()
        };
        let errors = Generation::certify(
            &ProjectJson {
                version: 1,
                schema,
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
                .any(|(_, error)| error.code == "E_SCHEMA_MAINTAIN")
        );
    }

    let base_generation = generation(schema_with(source), Vec::new());
    let mut runtime = Runtime::open(Store::memory().unwrap(), base_generation).unwrap();
    let seed = Value::Map(
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
    assert_eq!(
        runtime
            .seed(&[(
                "media".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("row-1".to_owned())),
                        ("photo".to_owned(), seed.clone()),
                    ])
                    .into()
                ),
            )])
            .unwrap_err()
            .code(),
        "E_SCHEMA_SEED_ASSET"
    );

    let optional_source = table_with(
        "photo",
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 100,
            once: false,
        })),
    );
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema_with(optional_source), Vec::new()),
    )
    .unwrap();
    runtime
        .seed(&[(
            "media".to_owned(),
            Value::Row(
                BTreeMap::from([
                    ("id".to_owned(), Value::Id("row-null".to_owned())),
                    ("photo".to_owned(), Value::Null),
                ])
                .into(),
            ),
        )])
        .unwrap();
    assert_eq!(
        runtime
            .seed(&[(
                "media".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("row-optional".to_owned())),
                        ("photo".to_owned(), seed.clone()),
                    ])
                    .into()
                ),
            )])
            .unwrap_err()
            .code(),
        "E_SCHEMA_SEED_ASSET"
    );

    let list_source = table_with(
        "photos",
        ColumnType::List {
            of: Box::new(ColumnType::Image {
                max: 100,
                once: false,
            }),
            max: 4,
        },
    );
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(schema_with(list_source), Vec::new()),
    )
    .unwrap();
    assert_eq!(
        runtime
            .seed(&[(
                "media".to_owned(),
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("row-list".to_owned())),
                        ("photos".to_owned(), Value::Array(vec![seed.clone()])),
                    ])
                    .into()
                ),
            )])
            .unwrap_err()
            .code(),
        "E_SCHEMA_SEED_ASSET"
    );

    let mut engine = Engine::memory(schema_with(table_with(
        "photo",
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 100,
            once: false,
        })),
    )))
    .unwrap();
    assert_eq!(
        engine
            .seed(
                "media",
                Value::Row(
                    BTreeMap::from([
                        ("id".to_owned(), Value::Id("raw-asset".to_owned())),
                        ("photo".to_owned(), seed),
                    ])
                    .into()
                ),
            )
            .unwrap_err()
            .code(),
        "E_SCHEMA_SEED_ASSET"
    );
    engine
        .seed(
            "media",
            Value::Row(
                BTreeMap::from([
                    ("id".to_owned(), Value::Id("raw-null".to_owned())),
                    ("photo".to_owned(), Value::Null),
                ])
                .into(),
            ),
        )
        .unwrap();
    assert_eq!(engine.rows("media").unwrap().len(), 1);
}
