//! Reclamation grace, destructive reset, and durable staging accounting.

use super::*;

#[test]
fn reclamation_grace_starts_when_a_long_claim_is_released() {
    const YEAR_MS: i64 = 365 * 24 * 60 * 60 * 1_000;
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
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let old = image(&mut runtime, &alice, 50, 10, 20);
    let replacement = image(&mut runtime, &alice, 50, 10, 20);
    let old_id = asset_id(&old);
    runtime
        .execute(
            "media.insert",
            Context::mutation(alice.clone(), args("row-1", old)),
        )
        .unwrap();
    let mut replace = Context::mutation(alice, args("row-1", replacement));
    replace.now = Some(YEAR_MS);
    runtime.execute("media.replace", replace).unwrap();
    assert_eq!(
        runtime.store().asset(&old_id).unwrap().unwrap().released_at,
        Some(YEAR_MS)
    );
    assert!(
        runtime
            .reclaim_assets(YEAR_MS + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        runtime
            .reclaim_assets(YEAR_MS + ASSET_RECLAIM_GRACE_MS)
            .unwrap(),
        vec![old_id]
    );
}

#[test]
fn destructive_successor_reset_and_reclaim_release_engine_owned_assets() {
    let table = table_with(
        "photo",
        ColumnType::Image {
            max: 1_000,
            once: false,
        },
    );
    let base = generation(
        schema_with(table),
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
            10,
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

    let unclaimed = image(&mut runtime, &alice, 10, 1, 1);
    let unclaimed_id = asset_id(&unclaimed);
    assert!(
        runtime
            .reclaim_assets(ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    let reclaimed = runtime.reclaim_assets(ASSET_RECLAIM_GRACE_MS).unwrap();
    assert!(!reclaimed.contains(&id));
    assert_eq!(reclaimed, vec![unclaimed_id.clone()]);
    assert!(
        runtime
            .store()
            .asset(&unclaimed_id)
            .unwrap()
            .unwrap()
            .reclaiming
    );
    runtime.finish_asset_reclaims(&reclaimed).unwrap();
    assert!(runtime.store().asset(&unclaimed_id).unwrap().is_none());
    let reclaimed = runtime.reclaim_assets(i64::MAX).unwrap();
    assert_eq!(reclaimed, vec![id.clone()]);
    assert!(runtime.store().asset(&id).unwrap().unwrap().reclaiming);
    runtime.finish_asset_reclaims(&reclaimed).unwrap();
    assert!(runtime.store().asset(&id).unwrap().is_none());

    let reset_asset = image(&mut runtime, &alice, 10, 1, 1);
    let reset_id = asset_id(&reset_asset);
    let reset = runtime.reset_and_seed(&[]).unwrap();
    assert_eq!(reset.asset_ids, vec![reset_id]);
    assert!(
        runtime
            .store()
            .asset(&reset.asset_ids[0])
            .unwrap()
            .unwrap()
            .reclaiming
    );
    runtime.finish_asset_reclaims(&reset.asset_ids).unwrap();
    assert!(
        runtime
            .store()
            .asset(&reset.asset_ids[0])
            .unwrap()
            .is_none()
    );
}

#[test]
fn durable_staging_charge_covers_guest_churn_claim_reclaim_and_restart() {
    let table = table_with(
        "photo",
        ColumnType::Image {
            max: 1_000,
            once: false,
        },
    );
    let generation = generation(
        schema_with(table),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    for index in 0..STAGING_GLOBAL_OBJECTS {
        let guest = user(&format!("guest-{index}"));
        runtime
            .begin_asset_charged(AssetKind::Image, &guest, 0, 1)
            .unwrap();
    }
    let refused = runtime
        .begin_asset_charged(AssetKind::Image, &user("guest-over"), 0, 1)
        .unwrap_err();
    assert_eq!(refused.code(), "E_ASSET_TOO_LARGE");

    let claimed_actor = user("claimed");
    let claimed_id = runtime
        .begin_asset_charged(AssetKind::Image, &claimed_actor, 1, 10)
        .unwrap_err();
    assert_eq!(claimed_id.code(), "E_ASSET_TOO_LARGE");

    let reclaiming = runtime.reclaim_assets(ASSET_RECLAIM_GRACE_MS).unwrap();
    assert_eq!(reclaiming.len(), STAGING_GLOBAL_OBJECTS as usize);
    assert_eq!(
        runtime
            .asset_staging_usage(&user("guest-0"))
            .unwrap()
            .global,
        AssetStagingUsage {
            bytes: u64::from(STAGING_GLOBAL_OBJECTS),
            objects: STAGING_GLOBAL_OBJECTS
        }
    );
    runtime.finish_asset_reclaims(&reclaiming).unwrap();
    assert_eq!(
        runtime
            .asset_staging_usage(&user("guest-0"))
            .unwrap()
            .global,
        AssetStagingUsage::default()
    );

    let photo_id = runtime
        .begin_asset_charged(AssetKind::Image, &claimed_actor, 1, 10)
        .unwrap();
    runtime
        .reserve_asset_finalized_bytes(&photo_id, 10)
        .unwrap();
    runtime
        .mark_asset_ready(
            &photo_id,
            &AssetReadyFacts {
                media_type: "image/png".to_owned(),
                bytes: 10,
                width: 1,
                height: 1,
                duration: None,
            },
        )
        .unwrap();
    let photo = Value::Map(
        BTreeMap::from([
            ("id".to_owned(), Value::String(photo_id)),
            ("width".to_owned(), Value::Int(1)),
            ("height".to_owned(), Value::Int(1)),
        ])
        .into(),
    );
    assert_committed(
        &runtime
            .execute(
                "media.insert",
                Context::mutation(claimed_actor.clone(), args("row-claim", photo)),
            )
            .unwrap(),
    );
    assert_eq!(
        runtime.asset_staging_usage(&claimed_actor).unwrap().creator,
        AssetStagingUsage::default()
    );

    let path = std::env::temp_dir().join(format!(
        "snapback2-asset-quota-restart-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    // The raw string-principal mint is crate-private; restart goes through the
    // typed Runtime entry like the server does.
    let restart_generation = || {
        super::generation(
            schema_with(table_with(
                "photo",
                ColumnType::Image {
                    max: 1_000,
                    once: false,
                },
            )),
            vec![insert_program("photo", ArgType::Image { max: 1_000 })],
        )
    };
    let restart_guest = user("guest-restart");
    {
        let mut restarted =
            Runtime::open(Store::open(&path).unwrap(), restart_generation()).unwrap();
        for _ in 0..STAGING_PER_PRINCIPAL_OBJECTS {
            restarted
                .begin_asset_charged(AssetKind::Image, &restart_guest, 0, 1)
                .unwrap();
        }
    }
    let mut reopened = Runtime::open(Store::open(&path).unwrap(), restart_generation()).unwrap();
    assert_eq!(
        reopened
            .begin_asset_charged(AssetKind::Image, &restart_guest, 0, 1)
            .unwrap_err()
            .code(),
        "E_ASSET_TOO_LARGE"
    );
    drop(reopened);
    std::fs::remove_file(&path).unwrap();
}

#[test]
fn finalized_growth_cannot_cross_the_durable_staging_byte_cap() {
    let expanding = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), expanding).unwrap();
    let uploader = user("expanding-image");
    let id = runtime
        .begin_asset_charged(AssetKind::Image, &uploader, 0, STAGING_PER_PRINCIPAL_BYTES)
        .unwrap();
    let refusal = runtime
        .reserve_asset_finalized_bytes(&id, STAGING_PER_PRINCIPAL_BYTES + 1)
        .unwrap_err();
    assert_eq!(refusal.code(), "E_ASSET_TOO_LARGE");
    assert_eq!(
        runtime.asset_staging_usage(&uploader).unwrap().creator,
        AssetStagingUsage {
            bytes: STAGING_PER_PRINCIPAL_BYTES,
            objects: 1,
        }
    );
    assert_eq!(
        runtime.store().asset(&id).unwrap().unwrap().state,
        AssetState::Receiving
    );
}

#[test]
fn explicit_discard_fences_late_finalize_and_claim_without_touching_another_creator() {
    let generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![insert_program("photo", ArgType::Image { max: 1_000 })],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let bob = user("bob");
    let receiving = runtime
        .begin_asset_charged(AssetKind::Image, &alice, 0, 100)
        .unwrap();
    assert!(!runtime.discard_upload(&bob, &receiving).unwrap());
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator.objects,
        1
    );
    assert!(runtime.discard_upload(&alice, &receiving).unwrap());
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator.objects,
        1
    );
    assert!(
        runtime
            .reserve_asset_finalized_bytes(&receiving, 100)
            .is_err()
    );

    // A receiving tombstone retains its reservation until the worker reports
    // that physical custody ended; a marker alone cannot release disk quota.
    runtime.mark_asset_failed(&receiving).unwrap();
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator.objects,
        0
    );
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let id = asset_id(&photo);
    assert!(runtime.discard_upload(&alice, &id).unwrap());
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("row-1", photo)),
            )
            .unwrap(),
        "E_ASSET_NOT_READY",
    );
    let photo = image(&mut runtime, &alice, 50, 10, 20);
    let claimed = asset_id(&photo);
    assert!(matches!(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice.clone(), args("row-2", photo))
            )
            .unwrap()
            .state,
        ExecutionState::Committed { .. }
    ));
    assert!(!runtime.discard_upload(&bob, &claimed).unwrap());
    assert!(matches!(
        runtime.discard_upload(&alice, &claimed),
        Err(RuntimeError::AssetInUse(_))
    ));
    assert!(
        runtime
            .store()
            .asset(&claimed)
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
    let reclaimed = runtime.reclaim_assets(0).unwrap();
    assert!(reclaimed.contains(&receiving) && reclaimed.contains(&id));
    assert!(!reclaimed.contains(&claimed));
    runtime.finish_asset_reclaims(&reclaimed).unwrap();
    assert!(!runtime.discard_upload(&alice, &id).unwrap());
}
