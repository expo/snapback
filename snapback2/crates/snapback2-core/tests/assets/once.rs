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
