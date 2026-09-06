use super::*;

// @ref LLP 1001#4-generation-and-runtime-registryrs-successorrs — survivor admission and destructive drops share a transaction.
// @ref LLP 1006#9-lifecycle-finalize-off-the-writer-and-reclamation — a successful release retains its original-byte charge and full grace.
#[test]
fn survivor_admission_controls_asset_drop_transaction_and_release_charge() {
    const RELEASED_AT: i64 = 123;
    for valid_survivor in [false, true] {
        let mut schema = schema_with(table_with(
            "photo",
            ColumnType::Image {
                max: 1_000,
                once: true,
            },
        ));
        let source = table_with("group", ColumnType::Text { max: 80 });
        let mut target = source.clone();
        target.columns.insert("value".into(), ColumnType::Int);
        target.indexes.insert(
            "byGroup".into(),
            Index {
                columns: vec!["group".into()],
                unique: true,
            },
        );
        schema.tables.insert("events".into(), source);
        schema.tables.insert("totals".into(), target);
        let programs = vec![
            insert_program("photo", ArgType::Image { max: 1_000 }),
            delete_program(),
        ];
        let mut runtime = Runtime::open(
            Store::memory().unwrap(),
            generation(schema.clone(), programs.clone()),
        )
        .unwrap();
        runtime
            .seed(&[
                (
                    "events".into(),
                    object([
                        ("id", Value::Id("event".into())),
                        ("group", Value::String("valid".into())),
                    ]),
                ),
                (
                    "totals".into(),
                    object([
                        ("id", Value::Id("legacy".into())),
                        (
                            "group",
                            Value::String(if valid_survivor { "legacy_ok" } else { "x" }.into()),
                        ),
                        ("value", Value::Int(9)),
                    ]),
                ),
            ])
            .unwrap();
        schema.maintains.push(Maintain {
            source: "events".into(),
            target: "totals".into(),
            by: vec!["group".into()],
            kind: MaintainKind::Count,
            readable: None,
        });
        runtime
            .apply_successor(generation(schema.clone(), programs))
            .unwrap();
        let alice = user("alice");
        let photo = image(&mut runtime, &alice, 50, 1, 1);
        let id = asset_id(&photo);
        assert_committed(
            &runtime
                .execute(
                    "media.insert",
                    Context::mutation(alice.clone(), args("row", photo)),
                )
                .unwrap(),
        );
        runtime.record_asset_view(&id, alice.id(), 1).unwrap();
        let asset_before = runtime.store().asset(&id).unwrap().unwrap();
        let usage_before = runtime.asset_staging_usage(&alice).unwrap();
        let generation_before = runtime.generation().hash();
        let seq = runtime.store().commit_seq().unwrap();
        schema.tables.remove("media");
        for name in ["events", "totals"] {
            let table = schema.tables.get_mut(name).unwrap();
            table
                .columns
                .insert("group".into(), ColumnType::Text { max: 2000 });
            table.constraints.push(Constraint::Text {
                field: "group".into(),
                min: 2,
                format: None,
            });
        }
        let next = generation(schema, Vec::new());
        let migration = runtime.apply_successor(next.clone()).unwrap_err().plan;
        assert_eq!(
            migration.drops,
            vec![Drop::Table {
                name: "media".into(),
                rows: 1
            }]
        );
        let result = runtime.apply_migration(next.clone(), &migration, RELEASED_AT);
        if valid_survivor {
            result.unwrap();
            assert_eq!(runtime.generation().hash(), next.hash());
        } else {
            let RuntimeError::Successor(refusal) = result.unwrap_err() else {
                panic!("expected the surviving row's refusal")
            };
            assert_eq!(refusal.code, "E_SUCCESSOR_ROW_INVALID");
            assert_eq!(refusal.site.as_deref(), Some("totals.legacy"));
            assert_eq!(runtime.generation().hash(), generation_before);
            assert_eq!(runtime.store().commit_seq().unwrap(), seq);
            assert_eq!(runtime.store().asset(&id).unwrap().unwrap(), asset_before);
            assert_eq!(runtime.asset_staging_usage(&alice).unwrap(), usage_before);
            // The refused migration leaves the live row/program usable. Its
            // later ordinary delete still succeeds and starts the same grace.
            let mut context = Context::mutation(
                alice.clone(),
                BTreeMap::from([("rowId".into(), Value::Id("row".into()))]),
            );
            context.now = Some(RELEASED_AT);
            assert_committed(&runtime.execute("media.delete", context).unwrap());
        }
        let released = runtime.store().asset(&id).unwrap().unwrap();
        assert!(released.locator.is_none());
        assert_eq!(released.released_at, Some(RELEASED_AT));
        assert_eq!(
            runtime.asset_staging_usage(&alice).unwrap().creator,
            AssetStagingUsage {
                objects: 0,
                bytes: 50
            }
        );
        assert!(runtime.store().asset_viewed(&id, alice.id()).unwrap());
        assert!(
            runtime
                .reclaim_assets(RELEASED_AT + ASSET_RECLAIM_GRACE_MS - 1)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            runtime
                .reclaim_assets(RELEASED_AT + ASSET_RECLAIM_GRACE_MS)
                .unwrap(),
            vec![id]
        );
    }
}
