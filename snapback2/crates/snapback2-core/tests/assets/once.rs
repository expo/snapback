use super::*;

#[test]
fn adding_once_keeps_custody_and_does_not_record_prior_views() {
    let ordinary = schema_with(table_with(
        "photo",
        ColumnType::Image {
            max: 100,
            once: false,
        },
    ));
    let mut runtime = Runtime::open(
        Store::memory().unwrap(),
        generation(
            ordinary.clone(),
            vec![insert_program("photo", ArgType::Image { max: 100 })],
        ),
    )
    .unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 4, 4);
    let id = asset_id(&photo);
    assert_committed(
        &runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("row1", photo)),
            )
            .unwrap(),
    );
    assert!(
        !runtime
            .asset_delivery(&id, Context::mutation(alice.clone(), BTreeMap::new()))
            .unwrap()
            .once
    );
    let mut next = ordinary;
    next.tables.get_mut("media").unwrap().columns.insert(
        "photo".into(),
        ColumnType::Image {
            max: 100,
            once: true,
        },
    );
    let successor = generation(
        next,
        vec![insert_program("photo", ArgType::Image { max: 100 })],
    );
    runtime.apply_successor(successor).unwrap();
    assert!(
        runtime
            .asset_delivery(&id, Context::mutation(alice, BTreeMap::new()))
            .unwrap()
            .once
    );
    assert!(!runtime.store().asset_viewed(&id, "alice").unwrap());
    runtime.record_asset_view(&id, "alice", 11).unwrap();
    assert!(runtime.store().asset_viewed(&id, "alice").unwrap());
    let error = runtime.record_asset_view(&id, "alice", 12).unwrap_err();
    assert_eq!(error.code(), "E_ASSET_VIEWED");
    runtime.record_asset_view(&id, "bob", 13).unwrap();
}

#[test]
fn removing_once_is_a_destructive_successor() {
    let schema = schema_with(table_with(
        "photo",
        ColumnType::Image {
            max: 100,
            once: true,
        },
    ));
    let mut runtime =
        Runtime::open(Store::memory().unwrap(), generation(schema.clone(), vec![])).unwrap();
    let mut next = schema;
    next.tables.get_mut("media").unwrap().columns.insert(
        "photo".into(),
        ColumnType::Image {
            max: 100,
            once: false,
        },
    );
    let error = runtime
        .apply_successor(generation(next, vec![]))
        .unwrap_err();
    assert_eq!(error.code, "E_SUCCESSOR_DESTRUCTIVE", "{error}");
}

#[test]
fn reset_clears_once_views_before_reclamation_with_seed() {
    {
        let schema = schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 100,
                once: true,
            },
        ));
        let mut runtime = Runtime::open(
            Store::memory().unwrap(),
            generation(
                schema,
                vec![insert_program("photo", ArgType::Image { max: 100 })],
            ),
        )
        .unwrap();
        let alice = user("alice");
        let photo = image(&mut runtime, &alice, 50, 4, 4);
        let id = asset_id(&photo);
        assert_committed(
            &runtime
                .execute(
                    "media.insert",
                    Context::mutation(alice.clone(), args("row1", photo)),
                )
                .unwrap(),
        );
        runtime.record_asset_view(&id, "alice", 11).unwrap();
        let ids = runtime.reset_and_seed(&[]).unwrap().asset_ids;
        assert!(ids.contains(&id));
        assert!(
            !runtime.store().asset_viewed(&id, "alice").unwrap(),
            "reset kept a view until sweep"
        );
        runtime.finish_asset_reclaims(&ids).unwrap();
        let photo = image(&mut runtime, &alice, 50, 4, 4);
        let id = asset_id(&photo);
        assert_committed(
            &runtime
                .execute(
                    "media.insert",
                    Context::mutation(alice.clone(), args("row1", photo)),
                )
                .unwrap(),
        );
        assert!(!runtime.store().asset_viewed(&id, "alice").unwrap());
        assert!(
            runtime
                .asset_delivery(&id, Context::mutation(alice, BTreeMap::new()))
                .unwrap()
                .once
        );
    }
}

#[test]
fn widening_an_image_preserves_its_claimed_asset_through_install_and_migration() {
    for migration in [false, true] {
        let schema = schema_with(table_with("photo", ColumnType::Image { max: 100, once: false }));
        let programs = vec![insert_program("photo", ArgType::Image { max: 100 })];
        let mut runtime = Runtime::open(Store::memory().unwrap(), generation(schema.clone(), programs.clone())).unwrap();
        let alice = user("alice");
        let photo = image(&mut runtime, &alice, 50, 4, 4);
        let id = asset_id(&photo);
        assert_committed(&runtime.execute("media.insert", Context::mutation(alice.clone(), args("row1", photo))).unwrap());
        let before = runtime.asset_delivery(&id, Context::mutation(alice.clone(), BTreeMap::new())).unwrap();
        let mut next = schema;
        next.tables.get_mut("media").unwrap().columns.insert("photo".into(), ColumnType::Image { max: 200, once: false });
        let next = generation(next, programs);
        if migration { runtime.apply_migration(next, &MigrationPlan::default(), 10).unwrap(); }
        else { runtime.apply_successor(next).unwrap(); }
        let after = runtime.asset_delivery(&id, Context::mutation(alice, BTreeMap::new())).unwrap();
        assert_eq!(serde_json::to_value(after).unwrap(), serde_json::to_value(before).unwrap());
    }
}

// @ref LLP 1023.000#c--separate-live-once-publication-from-offline-redaction —
// typed aliases and list positions cannot outlive this principal's consumption.
#[test]
fn consumed_once_query_projection_preserves_receipt_custody_and_changes_validator() {
    use snapback2_core::offline::value_to_wire_json;
    let once = ColumnType::Image {
        max: 100,
        once: true,
    };
    let mut table = table_with("photo", ColumnType::Optional(Box::new(once.clone())));
    table.columns.insert(
        "photos".into(),
        ColumnType::Optional(Box::new(ColumnType::List {
            of: Box::new(once),
            max: 3,
        })),
    );
    table.columns.insert(
        "ordinary".into(),
        ColumnType::Optional(Box::new(ColumnType::Image {
            max: 100,
            once: false,
        })),
    );
    let read = |name: &str| {
        Expr::Get(Read {
            site: name.into(),
            table: "media".into(),
            index: "byId".into(),
            key: vec![var("rowId")],
            provenance: KeyProvenance::Arg,
        })
    };
    let query = Program {
        name: "media.view".into(),
        kind: ProgramKind::Query,
        args: BTreeMap::from([("rowId".into(), ArgType::Id)]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Let {
                name: "row".into(),
                value: read("view.row"),
            },
            Stmt::Return(Expr::Object(BTreeMap::from([
                ("direct".into(), var("row")),
                (
                    "alias".into(),
                    Expr::Field {
                        base: Box::new(var("row")),
                        name: "photo".into(),
                    },
                ),
                (
                    "list".into(),
                    Expr::Field {
                        base: Box::new(var("row")),
                        name: "photos".into(),
                    },
                ),
                (
                    "ordinary".into(),
                    Expr::Field {
                        base: Box::new(var("row")),
                        name: "ordinary".into(),
                    },
                ),
                (
                    "nested".into(),
                    Expr::Object(BTreeMap::from([("joined".into(), var("row"))])),
                ),
            ]))),
        ],
    };
    let missing = Program {
        name: "media.missing".into(),
        body: vec![Stmt::Return(read("missing.row"))],
        ..query.clone()
    };
    let mut list_insert = insert_program(
        "photos",
        ArgType::List {
            of: Some(Box::new(ArgType::Image { max: 100 })),
            max: 3,
        },
    );
    list_insert.name = "media.insertList".into();
    let mut ordinary_insert = insert_program("ordinary", ArgType::Image { max: 100 });
    ordinary_insert.name = "media.insertOrdinary".into();
    let generation = generation(
        schema_with(table),
        vec![
            query,
            missing,
            insert_program("photo", ArgType::Image { max: 100 }),
            list_insert,
            ordinary_insert,
        ],
    );
    let path = std::env::temp_dir().join(format!("snapback-once-query-{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation.clone()).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 4, 4);
    let first = image(&mut runtime, &alice, 50, 5, 5);
    let second = image(&mut runtime, &alice, 50, 6, 6);
    let ordinary = image(&mut runtime, &alice, 50, 7, 7);
    for (op, row, value) in [
        ("media.insert", "one", photo.clone()),
        (
            "media.insertList",
            "list",
            Value::Array(vec![first.clone(), second.clone()]),
        ),
        ("media.insertOrdinary", "ordinary", ordinary.clone()),
    ] {
        assert_committed(
            &runtime
                .execute(op, Context::mutation(alice.clone(), args(row, value)))
                .unwrap(),
        );
    }
    let context = |principal: &str, row: &str| {
        Context::query(
            user(principal),
            BTreeMap::from([("rowId".into(), Value::Id(row.into()))]),
        )
    };
    let projection = |execution: &Execution, context: &Context| {
        let certificate = &generation.programs()["media.view"].1;
        project_delivery(
            execution,
            &DeliveryProjectionContext {
                schema: generation.schema(),
                op: "media.view",
                args: &context.args,
                generation: generation.program_hash(),
                schema_hash: &generation.schema().hash(),
                plan_hash: &certificate.plan_hash,
                principal: context.viewer(),
                auth_epoch: context.auth_epoch,
                read_time: None,
            },
        )
        .unwrap()
    };
    let before = runtime
        .execute("media.view", context("alice", "one"))
        .unwrap();
    let envelope = projection(&before, &context("alice", "one"));
    assert_eq!(
        value_to_wire_json(&before.result)["alias"],
        value_to_wire_json(&photo)
    );
    runtime
        .record_asset_view(&asset_id(&photo), "alice", 11)
        .unwrap();
    let after = runtime
        .execute("media.view", context("alice", "one"))
        .unwrap();
    let current = projection(&after, &context("alice", "one"));
    assert_eq!(after.seq, before.seq);
    assert_eq!(
        value_to_wire_json(&after.result)["alias"],
        serde_json::Value::Null
    );
    assert_eq!(
        value_to_wire_json(&after.result)["direct"],
        serde_json::Value::Null
    );
    assert_eq!(
        value_to_wire_json(&after.result)["nested"]["joined"],
        serde_json::Value::Null
    );
    assert_ne!(
        current.validator, envelope.validator,
        "same-sequence conditional reads cannot keep a consumed descriptor"
    );
    assert_eq!(
        serde_json::to_value(&current.rows).unwrap(),
        serde_json::to_value(&envelope.rows).unwrap(),
        "raw row custody remains valid"
    );
    assert_eq!(
        value_to_wire_json(
            &runtime
                .execute("media.view", context("bob", "one"))
                .unwrap()
                .result
        )["alias"],
        value_to_wire_json(&photo)
    );
    runtime
        .record_asset_view(&asset_id(&first), "alice", 12)
        .unwrap();
    let partial = runtime
        .execute("media.view", context("alice", "list"))
        .unwrap();
    let data = value_to_wire_json(&partial.result);
    assert_eq!(
        data["list"],
        serde_json::json!([null, value_to_wire_json(&second)])
    );
    assert_eq!(data["direct"]["photos"], data["list"]);
    let partial_envelope = projection(&partial, &context("alice", "list"));
    assert_eq!(
        partial_envelope.data["direct"]["photos"], data["list"],
        "a pooled reference cannot bypass partial-list redaction"
    );
    runtime
        .record_asset_view(&asset_id(&ordinary), "alice", 13)
        .unwrap();
    assert_eq!(
        value_to_wire_json(
            &runtime
                .execute("media.view", context("alice", "ordinary"))
                .unwrap()
                .result
        )["ordinary"],
        value_to_wire_json(&ordinary),
        "ordinary schema custody does not become once by shape"
    );
    assert_eq!(
        runtime
            .execute("media.missing", context("alice", "absent"))
            .unwrap()
            .result,
        Value::Null
    );
    drop(runtime);
    let mut reopened = Runtime::open(Store::open(&path).unwrap(), generation).unwrap();
    assert_eq!(
        value_to_wire_json(
            &reopened
                .execute("media.view", context("alice", "one"))
                .unwrap()
                .result
        )["alias"],
        serde_json::Value::Null
    );
    assert_eq!(
        value_to_wire_json(
            &reopened
                .execute("media.view", context("alice", "list"))
                .unwrap()
                .result
        )["list"],
        serde_json::json!([null, value_to_wire_json(&second)])
    );
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}
