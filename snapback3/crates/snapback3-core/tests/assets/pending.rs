//! Pending slots are upload intents; released originals retain byte admission charges.
use super::*;

fn asset_generation() -> Generation {
    generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: STAGING_PER_PRINCIPAL_BYTES as u32,
                once: true,
            },
        )),
        vec![
            insert_program(
                "photo",
                ArgType::Image {
                    max: STAGING_PER_PRINCIPAL_BYTES as u32,
                },
            ),
            replace_program(
                "photo",
                ArgType::Image {
                    max: STAGING_PER_PRINCIPAL_BYTES as u32,
                },
            ),
            delete_program(),
        ],
    )
}

fn claim(runtime: &mut Runtime, actor: &Actor, row: &str, photo: Value, now: i64) {
    let mut context = Context::mutation(actor.clone(), args(row, photo));
    context.now = Some(now);
    assert_committed(&runtime.execute("media.insert", context).unwrap());
}

fn release(runtime: &mut Runtime, actor: &Actor, row: &str, now: i64) {
    let mut context = Context::mutation(
        actor.clone(),
        BTreeMap::from([("rowId".to_owned(), Value::Id(row.to_owned()))]),
    );
    context.now = Some(now);
    assert_committed(&runtime.execute("media.delete", context).unwrap());
}

#[test]
fn forty_successful_releases_allow_a_new_small_upload_before_and_after_restart() {
    let path = std::env::temp_dir().join(format!(
        "snapback3-pending-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let alice = user("alice");
    let bob = user("bob");
    let moderator = user("moderator");
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), asset_generation()).unwrap();
    let mut ids = Vec::new();
    for index in 0..43 {
        let creator = if index % 2 == 0 { &alice } else { &bob };
        let photo = image(&mut runtime, creator, 50, 1, 1);
        ids.push(asset_id(&photo));
        claim(&mut runtime, creator, &format!("row-{index}"), photo, 1);
    }
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().global,
        AssetStagingUsage::default()
    );
    for index in 0..40 {
        // A permitted delete charges the immutable creator, not the moderator.
        release(&mut runtime, &moderator, &format!("row-{index}"), 100);
    }
    let before = runtime.asset_staging_usage(&alice).unwrap();
    assert_eq!(
        before.global,
        AssetStagingUsage {
            objects: 0,
            bytes: 2_000
        }
    );
    assert_eq!(
        before.creator,
        AssetStagingUsage {
            objects: 0,
            bytes: 1_000
        }
    );
    assert_eq!(
        runtime.asset_staging_usage(&moderator).unwrap().creator,
        AssetStagingUsage::default()
    );
    assert!(
        runtime
            .reclaim_assets(100 + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    for id in &ids[..40] {
        let row = runtime.store().asset(id).unwrap().unwrap();
        assert_eq!(row.released_at, Some(100));
        assert!(row.locator.is_none() && !row.reclaiming);
        assert_eq!(
            runtime.public_asset_delivery(id).unwrap_err().code(),
            "E_ASSET_NOT_READY"
        );
    }
    for id in &ids[40..] {
        assert!(
            runtime
                .store()
                .asset(id)
                .unwrap()
                .unwrap()
                .locator
                .is_some()
        );
    }
    drop(runtime);
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), asset_generation()).unwrap();
    assert_eq!(runtime.asset_staging_usage(&alice).unwrap(), before);
    assert_eq!(
        runtime
            .store()
            .unclaimed_uploads(alice.id(), "")
            .unwrap()
            .len(),
        20
    );
    // Both the previously full creator and a fresh creator can upload.
    let new = image(&mut runtime, &alice, 1, 1, 1);
    assert!(!ids.contains(&asset_id(&new)));
    image(&mut runtime, &moderator, 1, 1, 1);
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().global,
        AssetStagingUsage {
            objects: 2,
            bytes: 2_002
        }
    );
    drop(runtime);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn receiving_and_never_claimed_ready_uploads_still_fill_creator_and_global_slots() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), asset_generation()).unwrap();
    let alice = user("alice");
    let bob = user("bob");
    let mut ready = None;
    for creator in [&alice, &bob] {
        for index in 0..20 {
            if index % 2 == 0 {
                ready = Some(image(&mut runtime, creator, 2, 1, 1));
            } else {
                runtime
                    .begin_asset_charged(AssetKind::Image, creator, 0, 1)
                    .unwrap();
            }
        }
        assert_eq!(
            runtime.asset_staging_usage(creator).unwrap().creator,
            AssetStagingUsage {
                objects: 20,
                bytes: 30
            }
        );
        let error = runtime
            .begin_asset_charged(AssetKind::Image, creator, 0, 1)
            .unwrap_err();
        assert_eq!(error.code(), "E_ASSET_TOO_LARGE");
        assert!(error.to_string().contains("pending object"), "{error}");
    }
    let guest = user("fresh-guest");
    let error = runtime
        .begin_asset_charged(AssetKind::Image, &guest, 0, 1)
        .unwrap_err();
    assert_eq!(error.code(), "E_ASSET_TOO_LARGE");
    assert!(
        error.to_string().contains("owner pending object"),
        "{error}"
    );
    assert!(
        runtime
            .store()
            .unclaimed_uploads(guest.id(), "")
            .unwrap()
            .is_empty()
    );
    let ready = ready.unwrap();
    assert!(!runtime.discard_upload(&guest, &asset_id(&ready)).unwrap());
    claim(&mut runtime, &bob, "kept", ready, 1);
    runtime
        .begin_asset_charged(AssetKind::Image, &guest, 1, 1)
        .unwrap();
    assert_eq!(
        runtime.asset_staging_usage(&guest).unwrap().global.objects,
        40
    );
}

#[test]
fn released_originals_still_exhaust_creator_and_global_byte_admission_and_growth() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), asset_generation()).unwrap();
    let alice = user("alice");
    let bob = user("bob");
    for creator in [&alice, &bob] {
        // Ledger arithmetic at the actual production byte ceiling; no large allocation.
        let photo = image(&mut runtime, creator, STAGING_PER_PRINCIPAL_BYTES, 1, 1);
        claim(&mut runtime, creator, creator.id(), photo, 1);
    }
    // Reserve a receiving identity while the originals are live. Release itself
    // is never refused, even when it will exceed the byte admission ceiling.
    let growth = runtime
        .begin_asset_charged(AssetKind::Image, &user("growth"), 1, 0)
        .unwrap();
    for creator in [&alice, &bob] {
        release(&mut runtime, creator, creator.id(), 2);
        assert_eq!(
            runtime.asset_staging_usage(creator).unwrap().creator,
            AssetStagingUsage {
                objects: 0,
                bytes: STAGING_PER_PRINCIPAL_BYTES
            }
        );
        let error = runtime
            .begin_asset_charged(AssetKind::Image, creator, 2, 1)
            .unwrap_err();
        assert_eq!(error.code(), "E_ASSET_TOO_LARGE");
        assert!(error.to_string().contains("byte admission"), "{error}");
    }
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().global.bytes,
        STAGING_GLOBAL_BYTES
    );
    let error = runtime
        .begin_asset_charged(AssetKind::Image, &user("fresh"), 2, 1)
        .unwrap_err();
    assert_eq!(error.code(), "E_ASSET_TOO_LARGE");
    assert!(
        error.to_string().contains("owner byte admission"),
        "{error}"
    );
    assert_eq!(
        runtime
            .reserve_asset_finalized_bytes(&growth, 1)
            .unwrap_err()
            .code(),
        "E_ASSET_TOO_LARGE"
    );
    assert_eq!(runtime.store().asset(&growth).unwrap().unwrap().bytes, None);
    assert!(
        runtime
            .reclaim_assets(2 + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .iter()
            .all(|id| id == &growth)
    );
}

#[test]
fn physical_tombstones_keep_bytes_charged_until_reclamation_finishes() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), asset_generation()).unwrap();
    let alice = user("alice");
    let receiving = runtime
        .begin_asset_charged(AssetKind::Image, &alice, 0, 10)
        .unwrap();
    runtime
        .reserve_asset_finalized_bytes(&receiving, 15)
        .unwrap();
    runtime
        .reserve_asset_finalized_bytes(&receiving, 15)
        .unwrap();
    assert_eq!(
        runtime
            .reserve_asset_finalized_bytes(&receiving, 16)
            .unwrap_err()
            .code(),
        "E_ASSET_TYPE"
    );
    let ready = image(&mut runtime, &alice, 3, 1, 1);
    let released = image(&mut runtime, &alice, 4, 1, 1);
    let released_id = asset_id(&released);
    claim(&mut runtime, &alice, "old", released, 1);
    release(&mut runtime, &alice, "old", 2);
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 2,
            bytes: 22
        }
    );
    for id in [&receiving, &asset_id(&ready), &released_id] {
        assert!(runtime.discard_upload(&alice, id).unwrap());
    }
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 1,
            bytes: 22
        }
    );
    assert_eq!(
        runtime
            .store()
            .unclaimed_uploads(alice.id(), "")
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        runtime
            .reserve_asset_finalized_bytes(&receiving, 15)
            .unwrap_err()
            .code(),
        "E_ASSET_NOT_READY"
    );
    runtime.mark_asset_failed(&receiving).unwrap();
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 0,
            bytes: 22
        }
    );
    assert_eq!(runtime.asset_ids().unwrap().len(), 3);
    runtime
        .finish_asset_reclaims(&[receiving, asset_id(&ready), released_id])
        .unwrap();
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage::default(),
        "admission credit follows physical-reclamation settlement"
    );
}

#[test]
fn ordinary_release_and_reset_do_not_require_byte_headroom() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), asset_generation()).unwrap();
    let alice = user("alice");
    for index in 0..3 {
        let photo = image(&mut runtime, &alice, STAGING_PER_PRINCIPAL_BYTES, 1, 1);
        claim(&mut runtime, &alice, &format!("row-{index}"), photo, 1);
    }
    for index in 0..2 {
        release(&mut runtime, &alice, &format!("row-{index}"), 2);
    }
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 0,
            bytes: 2 * STAGING_PER_PRINCIPAL_BYTES
        }
    );
    assert_eq!(
        runtime
            .begin_asset_charged(AssetKind::Image, &alice, 2, 1)
            .unwrap_err()
            .code(),
        "E_ASSET_TOO_LARGE"
    );
    let reset = runtime.reset_and_seed_at(&[], 3).unwrap();
    assert_eq!(reset.asset_ids.len(), 3);
    for id in reset.asset_ids {
        let row = runtime.store().asset(&id).unwrap().unwrap();
        assert!(row.reclaiming && row.locator.is_none());
    }
}

#[test]
fn reclaiming_a_released_identity_resets_grace_without_forgetting_once_history() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), asset_generation()).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 7, 1, 1);
    let id = asset_id(&photo);
    claim(&mut runtime, &alice, "first", photo.clone(), 1);
    runtime.record_asset_view(&id, "alice", 2).unwrap();
    release(&mut runtime, &alice, "first", ASSET_RECLAIM_GRACE_MS);
    claim(
        &mut runtime,
        &alice,
        "second",
        photo.clone(),
        ASSET_RECLAIM_GRACE_MS + 1,
    );
    let row = runtime.store().asset(&id).unwrap().unwrap();
    assert_eq!(row.released_at, None);
    assert_eq!(row.locator.unwrap().row, "second");
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage::default()
    );
    assert_eq!(
        runtime
            .record_asset_view(&id, "alice", 3)
            .unwrap_err()
            .code(),
        "E_ASSET_VIEWED"
    );
    let second_release = 2 * ASSET_RECLAIM_GRACE_MS;
    release(&mut runtime, &alice, "second", second_release);
    assert!(
        runtime
            .reclaim_assets(second_release + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        runtime
            .reclaim_assets(second_release + ASSET_RECLAIM_GRACE_MS)
            .unwrap(),
        vec![id.clone()]
    );
    assert!(runtime.store().asset_viewed(&id, "alice").unwrap());
    assert_state(
        runtime
            .execute(
                "media.insert",
                Context::mutation(alice, args("third", photo)),
            )
            .unwrap(),
        "E_ASSET_NOT_READY",
    );
    runtime.finish_asset_reclaims(&[id.clone()]).unwrap();
    assert!(runtime.store().asset(&id).unwrap().is_none());
    assert!(!runtime.store().asset_viewed(&id, "alice").unwrap());
}

#[test]
fn seven_retried_photo_sends_discard_both_charges_at_commit() {
    let mut retry = insert_program("photo", ArgType::Image { max: 50_000_000 });
    retry.name = "media.retry".into();
    retry.body = vec![Stmt::Return(var("rowId"))];
    let schema = schema_with(table_with(
        "photo",
        ColumnType::Image {
            max: 50_000_000,
            once: false,
        },
    ));
    let generation = generation(
        schema,
        vec![
            insert_program("photo", ArgType::Image { max: 50_000_000 }),
            retry,
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation).unwrap();
    let alice = user("alice");
    let original = image(&mut runtime, &alice, 50_000_000, 1, 1);
    claim(&mut runtime, &alice, "same-message", original.clone(), 1);
    for attempt in 2..=7 {
        let photo = image(&mut runtime, &alice, 50_000_000, 1, 1);
        assert_committed(
            &runtime
                .execute(
                    "media.retry",
                    Context::mutation(alice.clone(), args("same-message", photo.clone())),
                )
                .unwrap(),
        );
        assert_eq!(
            runtime.asset_staging_usage(&alice).unwrap().creator,
            AssetStagingUsage {
                objects: 0,
                bytes: 50_000_000
            },
            "physical closure has not settled photo send {attempt}"
        );
        let reclaiming = runtime.reclaim_assets(0).unwrap();
        assert_eq!(reclaiming, vec![asset_id(&photo)]);
        runtime.finish_asset_reclaims(&reclaiming).unwrap();
        assert_eq!(
            runtime.asset_staging_usage(&alice).unwrap().creator,
            AssetStagingUsage::default(),
            "photo send {attempt}"
        );
    }
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage::default()
    );
    assert!(
        runtime
            .store()
            .asset(&asset_id(&original))
            .unwrap()
            .unwrap()
            .locator
            .is_some()
    );
}

#[test]
fn discard_is_scoped_to_validated_typed_arguments_and_offline_commit() {
    let mut retry = insert_program("photo", ArgType::Image { max: 1_000 });
    retry.name = "media.retry".into();
    retry.body = vec![Stmt::Return(var("rowId"))];
    let mut untyped = retry.clone();
    untyped.name = "media.untyped".into();
    untyped
        .args
        .insert("asset".into(), ArgType::Json { max_bytes: 1024 });
    let project_generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![retry, untyped],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), project_generation).unwrap();
    let alice = user("alice");
    let bob = user("bob");
    let unrelated = image(&mut runtime, &alice, 3, 1, 1);
    let foreign = image(&mut runtime, &bob, 5, 1, 1);
    let photo = image(&mut runtime, &alice, 7, 1, 1);
    let refused = runtime
        .execute(
            "media.retry",
            Context::mutation(alice.clone(), args("same", foreign.clone())),
        )
        .unwrap();
    assert_state(refused, "E_ASSET_TYPE");
    assert_committed(
        &runtime
            .execute(
                "media.untyped",
                Context::mutation(alice.clone(), args("same", photo.clone())),
            )
            .unwrap(),
    );
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 2,
            bytes: 10
        }
    );
    let mut replay = snapback3_core::offline::ReplayCommit {
        grant: "grant-discard".into(),
        offset: 0,
        count: 1,
        intent: "grant-discard:0".into(),
        request_digest: "d".repeat(64),
        at: 1,
        trace: snapback3_core::offline::ReplayTrace {
            points: vec![snapback3_core::offline::ReplayTracePoint {
                table: "media".into(),
                index: "byId".into(),
                key: vec![Value::Id("same".into())],
                digest: Some("e".repeat(64)),
            }],
            verdicts: vec![],
        },
    };
    let conflict = runtime
        .execute_replay(
            "media.retry",
            Context::mutation(alice.clone(), args("same", photo.clone())),
            &replay,
        )
        .unwrap();
    assert_state(conflict, "conflict");
    assert!(
        !runtime
            .store()
            .asset(&asset_id(&photo))
            .unwrap()
            .unwrap()
            .reclaiming
    );
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 2,
            bytes: 10
        }
    );
    replay.trace = Default::default();
    replay.offset = 1;
    replay.intent = "grant-discard:1".into();
    assert_committed(
        &runtime
            .execute_replay(
                "media.retry",
                Context::mutation(alice.clone(), args("same", photo.clone())),
                &replay,
            )
            .unwrap(),
    );
    assert!(
        runtime
            .store()
            .asset(&asset_id(&photo))
            .unwrap()
            .unwrap()
            .reclaiming
    );
    assert!(
        !runtime
            .store()
            .asset(&asset_id(&unrelated))
            .unwrap()
            .unwrap()
            .reclaiming
    );
    assert!(
        !runtime
            .store()
            .asset(&asset_id(&foreign))
            .unwrap()
            .unwrap()
            .reclaiming
    );
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 1,
            bytes: 10
        }
    );
    assert_eq!(
        runtime.asset_staging_usage(&bob).unwrap().creator,
        AssetStagingUsage {
            objects: 1,
            bytes: 5
        }
    );
}

#[test]
fn an_already_attached_argument_uses_ordinary_release_grace() {
    let mut remove = delete_program();
    remove
        .args
        .insert("asset".into(), ArgType::Image { max: 1_000 });
    let project_generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![
            insert_program("photo", ArgType::Image { max: 1_000 }),
            remove,
        ],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), project_generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 7, 1, 1);
    claim(&mut runtime, &alice, "kept", photo.clone(), 1);
    let mut context = Context::mutation(alice.clone(), args("kept", photo.clone()));
    context.now = Some(2);
    assert_committed(&runtime.execute("media.delete", context).unwrap());
    let row = runtime.store().asset(&asset_id(&photo)).unwrap().unwrap();
    assert!(!row.reclaiming);
    assert_eq!(row.released_at, Some(2));
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 0,
            bytes: 7
        }
    );
    assert!(
        runtime
            .reclaim_assets(2 + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn insert_then_delete_in_one_commit_keeps_release_grace() {
    let mut churn = insert_program("photo", ArgType::Image { max: 1_000 });
    churn.name = "media.churn".into();
    churn.body.push(Stmt::Delete {
        table: "media".to_owned(),
        key: var("rowId"),
    });
    let mut retry = insert_program("photo", ArgType::Image { max: 1_000 });
    retry.name = "media.retry".into();
    retry.body = vec![Stmt::Return(var("rowId"))];
    let project_generation = generation(
        schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: false,
            },
        )),
        vec![churn, retry],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), project_generation).unwrap();
    let alice = user("alice");
    let photo = image(&mut runtime, &alice, 7, 1, 1);
    let mut context = Context::mutation(alice.clone(), args("churned", photo.clone()));
    context.now = Some(2);
    assert_committed(&runtime.execute("media.churn", context).unwrap());
    let released = runtime.store().asset(&asset_id(&photo)).unwrap().unwrap();
    assert!(!released.reclaiming);
    assert_eq!(released.released_at, Some(2));
    assert!(released.locator.is_none());
    let in_grace = AssetStagingUsage {
        objects: 0,
        bytes: 7,
    };
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        in_grace
    );
    // A released in-grace id passed again as an unused argument keeps that grace too.
    let mut context = Context::mutation(alice.clone(), args("again", photo.clone()));
    context.now = Some(3);
    assert_committed(&runtime.execute("media.retry", context).unwrap());
    let still_released = runtime.store().asset(&asset_id(&photo)).unwrap().unwrap();
    assert!(!still_released.reclaiming);
    assert_eq!(still_released.released_at, Some(2));
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        in_grace
    );
    assert!(
        runtime
            .reclaim_assets(2 + ASSET_RECLAIM_GRACE_MS - 1)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        runtime.reclaim_assets(2 + ASSET_RECLAIM_GRACE_MS).unwrap(),
        vec![asset_id(&photo)]
    );
}

#[test]
fn only_unattached_list_and_optional_arguments_are_discarded() {
    let image_arg = || ArgType::Image { max: 1_000 };
    let attach_first = Program {
        name: "media.attachFirst".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([
            ("rowId".to_owned(), ArgType::Id),
            (
                "photos".to_owned(),
                ArgType::List {
                    of: Some(Box::new(image_arg())),
                    max: 4,
                },
            ),
            ("extra".to_owned(), ArgType::Optional(Box::new(image_arg()))),
        ]),
        read_time_granularity_ms: None,
        body: vec![Stmt::Insert {
            table: "media".to_owned(),
            row: Expr::Object(BTreeMap::from([
                ("id".to_owned(), var("rowId")),
                (
                    "photos".to_owned(),
                    Expr::Builtin {
                        builtin: Builtin::Slice,
                        args: vec![
                            var("photos"),
                            Expr::Literal(Value::Int(0)),
                            Expr::Literal(Value::Int(1)),
                        ],
                    },
                ),
            ])),
        }],
    };
    let project_generation = generation(
        schema_with(table_with(
            "photos",
            ColumnType::List {
                of: Box::new(ColumnType::Image {
                    max: 1_000,
                    once: false,
                }),
                max: 4,
            },
        )),
        vec![attach_first],
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), project_generation).unwrap();
    let alice = user("alice");
    let kept = image(&mut runtime, &alice, 3, 1, 1);
    let dropped = image(&mut runtime, &alice, 5, 1, 1);
    let extra = image(&mut runtime, &alice, 7, 1, 1);
    let unrelated = image(&mut runtime, &alice, 11, 1, 1);
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 4,
            bytes: 26
        }
    );
    assert_committed(
        &runtime
            .execute(
                "media.attachFirst",
                Context::mutation(
                    alice.clone(),
                    BTreeMap::from([
                        ("rowId".to_owned(), Value::Id("row".to_owned())),
                        (
                            "photos".to_owned(),
                            Value::Array(vec![kept.clone(), dropped.clone()]),
                        ),
                        ("extra".to_owned(), extra.clone()),
                    ]),
                ),
            )
            .unwrap(),
    );
    let row = |value: &Value| runtime.store().asset(&asset_id(value)).unwrap().unwrap();
    assert!(row(&kept).locator.is_some());
    assert!(!row(&kept).reclaiming);
    assert!(row(&dropped).reclaiming);
    assert!(row(&extra).reclaiming);
    assert!(!row(&unrelated).reclaiming);
    assert!(row(&unrelated).locator.is_none());
    assert_eq!(
        runtime.asset_staging_usage(&alice).unwrap().creator,
        AssetStagingUsage {
            objects: 1,
            bytes: 23
        }
    );
}
