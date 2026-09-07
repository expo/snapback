use super::*;

#[test]
fn reclamation_grace_restarts_from_the_second_release_after_reclaiming() {
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
            delete_program(),
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);

    let mut first_claim = Context::mutation(alice.clone(), args("row-1", photo.clone()));
    first_claim.now = Some(1);
    assert_committed(&runtime.execute("media.insert", first_claim).unwrap());
    let mut first_release = Context::mutation(
        alice.clone(),
        BTreeMap::from([("rowId".to_owned(), Value::Id("row-1".to_owned()))]),
    );
    first_release.now = Some(10);
    assert_committed(&runtime.execute("media.delete", first_release).unwrap());
    assert_eq!(
        runtime.store().asset(&id).unwrap().unwrap().released_at,
        Some(10)
    );

    let mut second_claim = Context::mutation(alice.clone(), args("row-2", photo));
    second_claim.now = Some(20);
    assert_committed(&runtime.execute("media.insert", second_claim).unwrap());
    assert_eq!(
        runtime.store().asset(&id).unwrap().unwrap().released_at,
        None
    );

    let mut second_release = Context::mutation(
        alice,
        BTreeMap::from([("rowId".to_owned(), Value::Id("row-2".to_owned()))]),
    );
    second_release.now = Some(100);
    assert_committed(&runtime.execute("media.delete", second_release).unwrap());
    assert_eq!(
        runtime.store().asset(&id).unwrap().unwrap().released_at,
        Some(100)
    );
    assert!(
        runtime
            .reclaim_assets(100 + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        runtime
            .reclaim_assets(100 + ASSET_RECLAIM_GRACE_MS)
            .unwrap(),
        vec![id]
    );
}

#[test]
fn destructive_successor_release_uses_the_supplied_logical_clock() {
    const LOGICAL_NOW: i64 = 2 * 24 * 60 * 60 * 1_000;
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
            Context::mutation(alice, args("row-1", photo)),
        )
        .unwrap();

    let next = generation(
        Schema {
            tables: BTreeMap::from([(
                "media".to_owned(),
                public_table(
                    BTreeMap::from([("id".to_owned(), ColumnType::Id)]),
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
        },
        Vec::new(),
    );
    runtime
        .apply_migration(
            next,
            &MigrationPlan {
                drops: vec![Drop::Column {
                    table: "media".to_owned(),
                    name: "photo".to_owned(),
                }],
            },
            LOGICAL_NOW,
        )
        .unwrap();

    assert_eq!(
        runtime.store().asset(&id).unwrap().unwrap().released_at,
        Some(LOGICAL_NOW)
    );
    assert!(
        runtime
            .reclaim_assets(LOGICAL_NOW + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        runtime
            .reclaim_assets(LOGICAL_NOW + ASSET_RECLAIM_GRACE_MS)
            .unwrap(),
        vec![id]
    );
}
