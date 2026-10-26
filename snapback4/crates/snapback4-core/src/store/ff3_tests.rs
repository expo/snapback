//! Panel-decision witnesses on the actual activation transaction.
use super::*;

fn arm(pg: bool, relation: &str, corrupt: bool) {
    if pg {
        #[cfg(feature = "postgres")]
        crate::engine::postgres::movement::fault::arm(relation, corrupt);
    } else {
        super::super::movement::fault::arm(relation, corrupt);
    }
}
fn mismatch<T>(result: Result<T, RuntimeError>) {
    let error = result
        .err()
        .expect("unverified destination must refuse before source destruction");
    assert!(
        error
            .to_string()
            .contains("SNAPBACK_ACTIVATION_COPY_MISMATCH"),
        "{error}"
    );
}
fn activate(e: &mut Engine, source: &str, n: u64) -> Result<u64, RuntimeError> {
    let (s, p) = bound(source);
    let mut release = crate::engine::release::ReleaseActivation::new(n, Some(n - 1));
    release.restore_dormant = true;
    e.adopt_release_at(s, p, &release, false, 1000)
}
fn count(e: &mut Engine, pg: bool, relation: &str) -> i64 {
    let tx = e.store_mut().transaction().unwrap();
    let n = if pg {
        #[cfg(feature = "postgres")]
        {
            let sql = match relation {
                "r" => "SELECT count(*) FROM r",
                "_dormant_rows" => "SELECT count(*) FROM _dormant_rows",
                "_dormant_values" => "SELECT count(*) FROM _dormant_values",
                _ => panic!(),
            };
            tx.test_postgres_tx().query(sql, &[]).unwrap()[0].get(0)
        }
        #[cfg(not(feature = "postgres"))]
        panic!()
    } else {
        tx.test_support_conn()
            .query_row(&format!("SELECT count(*) FROM {relation}"), [], |r| {
                r.get(0)
            })
            .unwrap()
    };
    tx.rollback().unwrap();
    n
}
fn copies(pg: bool, corrupt: bool) {
    let source = "table notes:\n  n: int\n  public\n  online only\n";
    let (s, p) = bound(source);
    let (st, _, _) = store(pg);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [(
            "notes".into(),
            object([("id", Value::Id("a".into())), ("n", Value::Int(7))]),
        )],
        1000,
    )
    .unwrap();
    let generation = e.generation();
    arm(pg, "_dormant_rows", corrupt);
    mismatch(activate(&mut e, "", 2));
    assert_eq!(e.generation(), generation);
    assert_eq!(count(&mut e, pg, "r"), 1);
    assert_eq!(count(&mut e, pg, "_dormant_rows"), 0);
    activate(&mut e, "", 2).unwrap();
    let generation = e.generation();
    arm(pg, "r", corrupt);
    mismatch(activate(&mut e, source, 3));
    assert_eq!(e.generation(), generation);
    assert_eq!(count(&mut e, pg, "r"), 0);
    assert_eq!(count(&mut e, pg, "_dormant_rows"), 1);
    activate(&mut e, source, 3).unwrap();
    let no_column = "table notes:\n  public\n  online only\n";
    arm(pg, "_dormant_values", corrupt);
    mismatch(activate(&mut e, no_column, 4));
    assert_eq!(count(&mut e, pg, "r"), 1);
    assert_eq!(count(&mut e, pg, "_dormant_values"), 0);
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::Int(7)
    );
    activate(&mut e, no_column, 4).unwrap();
    arm(pg, "r", corrupt);
    mismatch(activate(&mut e, source, 5));
    assert_eq!(count(&mut e, pg, "r"), 1);
    assert_eq!(count(&mut e, pg, "_dormant_values"), 1);
    activate(&mut e, source, 5).unwrap();
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::Int(7)
    );
}
#[test]
fn activation_verify_before_destroy_sqlite() {
    for corrupt in [false, true] {
        copies(false, corrupt)
    }
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; verify exact destination before destruction"]
fn activation_verify_before_destroy_postgres() {
    for corrupt in [false, true] {
        copies(true, corrupt)
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; captured OIDs survive late activation DDL"]
fn activation_replaced_heap_oid_refuses() {
    let (s, p) = bound("table notes:\n  n: int\n  public\n  online only\n");
    let (st, _, _) = store(true);
    let mut e = Engine::new_release(st, s.clone(), p, 1, None).unwrap();
    let programs = BTreeMap::new();
    let generation = e.generation();
    let result=e.store_mut().activate_at_with_launch(&s,Some(&programs),false,1000,true, |_|Ok(()), |_,_,_|Ok(()), |tx| {
        tx.test_postgres_tx().batch("ALTER TABLE _dormant_rows RENAME TO replaced_heap; CREATE TABLE _dormant_rows (LIKE replaced_heap INCLUDING ALL)")?;Ok(())
    });
    refused(result);
    assert_eq!(e.generation(), generation);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; positive heap and owner admission"]
fn activation_scratch_requires_owned_plain_heap() {
    for ddl in [
        "CREATE TEMP VIEW _adopt_groups AS SELECT 1 AS n",
        "CREATE TEMP TABLE r(n int)",
        "ALTER TABLE _dormant_rows RENAME TO saved; CREATE MATERIALIZED VIEW _dormant_rows AS SELECT * FROM saved",
        "CREATE TEMP TABLE _adopt_groups(n int) PARTITION BY RANGE(n)",
        "CREATE FOREIGN DATA WRAPPER ff3_nohandler; CREATE SERVER ff3_nohandler FOREIGN DATA WRAPPER ff3_nohandler; ALTER TABLE _dormant_rows RENAME TO saved; CREATE FOREIGN TABLE _dormant_rows(n int) SERVER ff3_nohandler",
        "CREATE ROLE ff3_other_owner; CREATE TEMP TABLE _adopt_groups(n int); ALTER TABLE pg_temp._adopt_groups OWNER TO ff3_other_owner",
    ] {
        let (s, p) = bound("table notes:\n  n: int\n  public\n  online only\n");
        let (st, _, namespace) = store(true);
        // @ref LLP 3000.009.001.000.000.002#3.11 — pg_temp is pinned last; force real shadowing for this interception control.
        let ddl = if ddl == "CREATE TEMP TABLE r(n int)" {
            format!("{ddl}; SET LOCAL search_path=pg_temp,\"{namespace}\",pg_catalog")
        } else {
            ddl.to_string()
        };
        let mut e = Engine::new_release(st, s.clone(), p, 1, None).unwrap();
        let generation = e.generation();
        let programs = BTreeMap::new();
        let result = e.store_mut().activate_at_with_launch(
            &s,
            Some(&programs),
            false,
            1000,
            true,
            |_| Ok(()),
            |_, _, _| Ok(()),
            |tx| {
                tx.test_postgres_tx().batch(&ddl)?;
                Ok(())
            },
        );
        refused(result);
        assert_eq!(e.generation(), generation);
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; doctor inventories enabled event triggers and the actual owner tier"]
fn doctor_event_inventory_and_owner_cache_tier() {
    let (s, p) = bound("table notes:\n  n: int\n  public\n  online only\n");
    let (st, _, name) = store(true);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    let event = format!("ff3_doctor_{:x}", crate::ids::seed());
    let disabled = format!("{event}_disabled");
    let all = format!("{event}_all");
    sql(
        &mut e,
        true,
        &format!(
            "CREATE FUNCTION audit_ff3() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$; CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION audit_ff3(); ALTER EVENT TRIGGER {event} ENABLE ALWAYS; CREATE EVENT TRIGGER {all} ON ddl_command_start EXECUTE FUNCTION audit_ff3(); CREATE EVENT TRIGGER {disabled} ON sql_drop EXECUTE FUNCTION audit_ff3(); ALTER EVENT TRIGGER {disabled} DISABLE"
        ),
    );
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let (tier, warnings) = AnyStore::postgres_diagnostics(&url, &name).unwrap();
    sql(
        &mut e,
        true,
        &format!(
            "DROP EVENT TRIGGER {event}; DROP EVENT TRIGGER {disabled}; DROP EVENT TRIGGER {all}"
        ),
    );
    assert!(tier.starts_with("G5 revision cache (one validation statement per hit)"));
    for word in [
        "SNAPBACK4_READ_GRANT_CLOCK_BOUNDS=rate_ppm,forward_jump_ms",
        "single owner",
        "every writer grant-aware",
        "database time bounded as declared",
        "VM pause/migration longer than the lease",
    ] {
        assert!(tier.contains(word), "{tier}");
    }
    let warning = warnings
        .iter()
        .find(|s| s.contains(&format!("\"name\":\"{event}\"")))
        .unwrap();
    for field in [
        "\"events\":\"ddl_command_end\"",
        "\"tags\":[\"CREATE INDEX\"]",
        "\"owner\":",
        "audit_ff3()",
        "\"enabledMode\":\"A\"",
    ] {
        assert!(warning.contains(field), "{warning}");
    }
    let warning = warnings
        .iter()
        .find(|s| s.contains(&format!("\"name\":\"{all}\"")))
        .unwrap();
    assert!(warning.contains("\"tags\":\"all\""), "{warning}");
    assert!(!warnings.iter().any(|s| s.contains(&disabled)));
    #[cfg(target_os = "linux")]
    {
        let state = AnyStore::postgres_deployment(&url, &name).unwrap().unwrap();
        let mut lease = crate::store_port::StoreLease::connect(
            &url,
            &name,
            &state.store_id,
            "ff33",
            crate::store_port::LeasePolicy::default(),
        )
        .unwrap();
        lease.acquire().unwrap().unwrap();
        lease
            .enable_read_grant(crate::store_port::ReadClockBounds {
                rate_ppm: 1000,
                forward_jump: std::time::Duration::from_millis(250),
            })
            .unwrap();
        let (tier, _) = AnyStore::postgres_diagnostics(&url, &name).unwrap();
        assert!(
            tier.contains("persisted G6 read grant (clock bounds 1000,250)"),
            "{tier}"
        );
        assert!(lease.read_grant.read().is_some());
        lease.read_grant.revoke();
        assert!(
            lease.read_grant.read().is_none(),
            "local hits must be revoked"
        );
        let (revoked_tier, _) = AnyStore::postgres_diagnostics(&url, &name).unwrap();
        assert_eq!(tier, revoked_tier, "the persisted grant is still live");
        assert!(
            revoked_tier.contains("owner-local activity unconfirmed"),
            "{revoked_tier}"
        );
        assert!(
            !revoked_tier.contains("G6 zero-flight hits"),
            "{revoked_tier}"
        );
        lease.release().unwrap();
        assert!(
            AnyStore::postgres_diagnostics(&url, &name)
                .unwrap()
                .0
                .starts_with("G5 revision cache")
        );
    }
    #[cfg(not(target_os = "linux"))]
    eprintln!("G6 owner tier requires Linux CLOCK_BOOTTIME; event inventory and G5 remain covered");
}

#[test]
fn activation_narrowed_verify_before_destroy_sqlite() {
    for corrupt in [false, true] {
        let wide = "table notes:\n  state: enum('old', 'new')\n  public\n  online only\n";
        let narrow = wide.replace("enum('old', 'new')", "enum('old')");
        let (s, p) = bound(wide);
        let (st, _, _) = store(false);
        let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
        e.seed_at(
            [(
                "notes".into(),
                object([
                    ("id", Value::Id("a".into())),
                    ("state", Value::String("new".into())),
                ]),
            )],
            1000,
        )
        .unwrap();
        arm(false, "_dormant_narrow_rows", corrupt);
        mismatch(activate(&mut e, &narrow, 2));
        assert_eq!(
            e.store().rows("notes").unwrap()[0].field("state").unwrap(),
            &Value::String("new".into())
        );
        activate(&mut e, &narrow, 2).unwrap();
        arm(false, "r", corrupt);
        mismatch(activate(&mut e, wide, 3));
        assert_eq!(e.store().count("notes").unwrap(), 0);
        activate(&mut e, wide, 3).unwrap();
        assert_eq!(
            e.store().rows("notes").unwrap()[0].field("state").unwrap(),
            &Value::String("new".into())
        );
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; exact payload bytes under a non-key ICU collation"]
fn activation_copy_payload_is_exact_under_casefold_and_shadowed_c() {
    let (s, p) = bound("table notes:\n  n: text <=50\n  public\n  online only\n");
    let (st, _, _) = store(true);
    let mut e = Engine::new_release(st, s.clone(), p, 1, None).unwrap();
    let upper = object([
        ("id", Value::Id("a".into())),
        ("n", Value::String("Upper".into())),
    ]);
    let lower = object([
        ("id", Value::Id("a".into())),
        ("n", Value::String("upper".into())),
    ]);
    e.seed_at([("notes".into(), upper.clone())], 1000).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    let icu = tx
        .test_postgres_tx()
        .query(
            "SELECT EXISTS(SELECT 1 FROM pg_collation WHERE collprovider='i')",
            &[],
        )
        .unwrap()[0]
        .get::<_, bool>(0);
    tx.rollback().unwrap();
    if !icu {
        eprintln!("SKIP ICU casefold witness: this private PG build has no ICU collations");
        return;
    }
    let generation = e.generation();
    let programs = BTreeMap::new();
    let result=e.store_mut().activate_at_with_launch(&s,Some(&programs),false,1000,true, |_|Ok(()), |_,_,_|Ok(()), |tx| {
        let tx=tx.test_postgres_tx();
        tx.batch(r#"CREATE COLLATION folded (provider=icu,locale='und-u-ks-level2',deterministic=false); CREATE COLLATION "C" FROM folded; ALTER TABLE r ALTER COLUMN data TYPE text COLLATE folded"#)?;
        tx.execute("UPDATE r SET data=$1 WHERE t='notes' AND id='a'",&[&canonical_json(&lower)])?;
        let weak=tx.query("SELECT count(*) FROM r WHERE t='notes' AND id='a' AND data=$1",&[&canonical_json(&upper)])?[0].get::<_,i64>(0);
        assert_eq!(weak,1,"the physical case-only corruption must fool the weak comparison");
        crate::engine::postgres::movement::test_payload(tx,"notes","a",&upper)
    });
    mismatch(result);
    assert_eq!(e.generation(), generation);
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::String("Upper".into())
    );
}

fn restored_cells_verify_again_after_copy(pg: bool, payload: bool) {
    let source = "table notes:\n  n: int\n  public\n  online only\n";
    let no_column = "table notes:\n  public\n  online only\n";
    let (s, p) = bound(source);
    let (st, _, _) = store(pg);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [(
            "notes".into(),
            object([("id", Value::Id("a".into())), ("n", Value::Int(7))]),
        )],
        1000,
    )
    .unwrap();
    activate(&mut e, no_column, 2).unwrap();
    let generation = e.generation();
    if pg {
        #[cfg(feature = "postgres")]
        if payload {
            crate::engine::postgres::movement::fault::arm_late_payload();
        } else {
            crate::engine::postgres::movement::fault::arm_late();
        }
    } else {
        if payload {
            super::super::movement::fault::arm_late_payload();
        } else {
            super::super::movement::fault::arm_late();
        }
    }
    mismatch(activate(&mut e, source, 3));
    assert_eq!(e.generation(), generation);
    assert_eq!(count(&mut e, pg, "r"), 1);
    assert_eq!(count(&mut e, pg, "_dormant_values"), 1);
    activate(&mut e, source, 3).unwrap();
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::Int(7)
    );
}
#[test]
fn restoration_rechecks_destination_before_destroy_sqlite() {
    for payload in [false, true] {
        restored_cells_verify_again_after_copy(false, payload)
    }
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; destination loss after copy before retained-cell deletion"]
fn restoration_rechecks_destination_before_destroy_postgres() {
    for payload in [false, true] {
        restored_cells_verify_again_after_copy(true, payload)
    }
}

#[test]
fn dormant_asset_rename_reorders_keys_before_id_sqlite() {
    for (old, new) in [("photo", "album"), ("zebra", "apple")] {
        let source = format!(
            "table photos:\n  {old}: file <=1000\n  public 'fixture'\n  insert <- allow\n  online only\nmutation add(blob: file <=1000):\n  return insert photos {{{old}:blob}}\n"
        );
        let (s, p) = bound(&source);
        let (st, _, _) = store(false);
        let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
        let asset = e
            .store_file(
                "alice",
                b"legal rename",
                Some("text/plain"),
                "image.txt",
                100,
            )
            .unwrap();
        let handle =
            Value::Map(BTreeMap::from([("id".into(), Value::Id(asset.id.clone()))]).into());
        let out = e
            .mutate(
                "add",
                None,
                crate::Context::new("alice", BTreeMap::from([("blob".into(), handle)])).at(101),
            )
            .unwrap();
        let crate::engine::WriteState::Sent { result, .. } = out.state else {
            panic!("{out:?}")
        };
        let id = result.field("id").unwrap().as_str().unwrap().to_owned();
        activate(&mut e, "", 2).unwrap();
        let renamed = source
            .replace(
                &format!("{old}: file <=1000"),
                &format!("{new}: file <=1000 renamed from {old}"),
            )
            .replace(&format!("{{{old}:blob}}"), &format!("{{{new}:blob}}"));
        activate(&mut e, &renamed, 3).unwrap();
        let row = e.store().rows("photos").unwrap().pop().unwrap();
        assert_eq!(
            crate::assets::asset_id(row.field(new).ok()),
            Some(asset.id.as_str())
        );
        assert_eq!(
            e.store().asset(&asset.id).unwrap().unwrap().home,
            Some(("photos".into(), id, new.into()))
        );
        assert!(row.field(old).is_err());
    }
}

#[test]
fn restored_cell_legal_backfill_changes_expected_final_image_sqlite() {
    let source = "table notes:\n  n: int\n  public 'fixture'\n  online only\n";
    let (s, p) = bound(source);
    let (st, _, _) = store(false);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [(
            "notes".into(),
            object([("id", Value::Id("a".into())), ("n", Value::Int(7))]),
        )],
        1000,
    )
    .unwrap();
    activate(&mut e, &source.replace("  n: int\n", ""), 2).unwrap();
    let patched = format!("{source}backfill notes patch(n: int):\n  {{n:n + 1}}\n");
    activate(&mut e, &patched, 3).unwrap();
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::Int(8)
    );
    assert_eq!(count(&mut e, false, "_dormant_values"), 0);
}

#[test]
fn retained_rehide_native_agreement_advances_expected_image_sqlite() {
    let source = "table person:\n  n: int 0..10\n  public 'fixture'\n  online only\ntable notes:\n  who: person on delete keep\n  label: text <=100\n  public 'fixture'\n  online only\n";
    let (s, p) =
        bound(&(source.to_owned() + "backfill notes mark(label: text <=100):\n  {label:label}\n"));
    let (st, _, _) = store(false);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [
            (
                "person".into(),
                object([("id", Value::Id("p".into())), ("n", Value::Int(7))]),
            ),
            (
                "notes".into(),
                object([
                    ("id", Value::Id("a".into())),
                    ("who", Value::Id("p".into())),
                    ("label", Value::String("kept".into())),
                ]),
            ),
        ],
        1000,
    )
    .unwrap();
    let no_label = source.replace("  label: text <=100\n", "");
    activate(&mut e, &no_label, 2).unwrap();
    activate(&mut e, &no_label.replace("0..10", "0..5"), 3).unwrap();
    assert_eq!(e.store().count("notes").unwrap(), 0);
    assert_eq!(count(&mut e, false, "_dormant_values"), 1);
    let restored = source.replace("0..10", "0..5")
        + "backfill notes mark(label: text <=100):\n  {label:label}\n";
    let (schema, _) = bound(&restored);
    let key = schema.backfills[0].key();
    let conn = e.store().test_support_conn();
    let t: i64 = conn
        .query_row("SELECT t FROM _dormant_narrow_rows WHERE id='a'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let archive: String = conn
        .query_row(
            "SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id='a'",
            [t],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        serde_json::from_str::<Value>(&archive)
            .unwrap()
            .field("label")
            .is_err()
    );
    // A prior native declaration, with changed inputs: force recomputation
    // agreement rather than fingerprint equality or patch_retained's write.
    assert_eq!(conn.execute("UPDATE _backfill_absence SET column_name='old-fingerprint' WHERE t=?1 AND id='a' AND definition=?2", params![t, format!("$native:{key}")]).unwrap(), 1);
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM _backfill_evidence WHERE t=?1 AND id='a'",
            [t],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    activate(&mut e, &restored, 4).unwrap();
    assert_eq!(
        e.store().count("notes").unwrap(),
        0,
        "hidden parent re-hides its child"
    );
    let conn = e.store().test_support_conn();
    let archive: String = conn
        .query_row(
            "SELECT data FROM _dormant_narrow_rows WHERE t=?1 AND id='a'",
            [t],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&archive)
            .unwrap()
            .field("label")
            .unwrap(),
        &Value::String("kept".into())
    );
    assert_eq!(
        conn.query_row(
            "SELECT count(*) FROM _backfill_evidence WHERE t=?1 AND id='a'",
            [t],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0,
        "native agreement did not patch retained provenance"
    );
    // An unannounced physical edit still cannot advance an expected image.
    let tx = e.store_mut().transaction().unwrap();
    tx.with_sqlite(|tx| -> Result<(), RuntimeError> {
        super::super::movement::begin(tx)?;
        tx.conn().execute("UPDATE _dormant_narrow_rows SET data=replace(data,'kept','tampered') WHERE t=?1 AND id='a'", [t])?;
        mismatch(super::super::movement::verify_expected(tx, "_dormant_narrow_rows", t, "a"));
        Ok(())
    }).unwrap();
    tx.rollback().unwrap();
    activate(&mut e, &restored.replace("0..5", "0..10"), 5).unwrap();
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("label").unwrap(),
        &Value::String("kept".into())
    );
}

#[test]
fn retained_native_backfill_rejects_external_input_change_sqlite() {
    let source = "table person:\n  n: int 0..10\n  public 'fixture'\n  online only\ntable notes:\n  who: person on delete keep\n  body: text <=100\n  label: text <=100\n  public 'fixture'\n  online only\n";
    let fill = "backfill notes mark(body: text <=100):\n  {label:body}\n";
    let (s, p) = bound(&(source.to_owned() + fill));
    let (st, _, _) = store(false);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [
            (
                "person".into(),
                object([("id", Value::Id("p".into())), ("n", Value::Int(7))]),
            ),
            (
                "notes".into(),
                object([
                    ("id", Value::Id("a".into())),
                    ("who", Value::Id("p".into())),
                    ("body", Value::String("kept".into())),
                    ("label", Value::String("kept".into())),
                ]),
            ),
        ],
        1000,
    )
    .unwrap();
    let no_label = source.replace("  label: text <=100\n", "");
    activate(&mut e, &no_label, 2).unwrap();
    activate(&mut e, &no_label.replace("0..10", "0..5"), 3).unwrap();
    let generation = e.generation();
    // This edit commits outside activation. Its historical native inputs no
    // longer recompute to the separately retained output; it must still refuse.
    assert_eq!(
        e.store()
            .test_support_conn()
            .execute(
                "UPDATE _dormant_narrow_rows SET data=replace(data,'kept','edited') WHERE id='a'",
                []
            )
            .unwrap(),
        1
    );
    let restored = source.replace("0..10", "0..5") + fill;
    let error = activate(&mut e, &restored, 4).unwrap_err();
    assert!(
        matches!(&error, RuntimeError::Structural { code: "E_ADOPT", message } if message.contains("changed outside its owning release") && message.contains("recomputation differs")),
        "{error}"
    );
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().count("notes").unwrap(), 0);
    assert_eq!(count(&mut e, false, "_dormant_values"), 1);
    assert_eq!(
        e.store()
            .test_support_conn()
            .execute(
                "UPDATE _dormant_narrow_rows SET data=replace(data,'edited','kept') WHERE id='a'",
                []
            )
            .unwrap(),
        1
    );
    activate(&mut e, &restored, 4).unwrap();
    assert_eq!(e.store().count("notes").unwrap(), 0);
}

fn narrowed_final_image(pg: bool) {
    let source = "table notes:\n  n: int 0..10\n  public\n  online only\n";
    let (s, p) = bound(source);
    let (st, _, _) = store(pg);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    e.seed_at(
        [(
            "notes".into(),
            object([("id", Value::Id("a".into())), ("n", Value::Int(7))]),
        )],
        1000,
    )
    .unwrap();
    activate(&mut e, &source.replace("0..10", "0..5"), 2).unwrap();
    assert_eq!(e.store().count("notes").unwrap(), 0);
    let generation = e.generation();
    if pg {
        #[cfg(feature = "postgres")]
        crate::engine::postgres::movement::fault::arm_late_payload();
    } else {
        super::super::movement::fault::arm_late_payload();
    }
    mismatch(activate(&mut e, source, 3));
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().count("notes").unwrap(), 0);
    activate(&mut e, source, 3).unwrap();
    assert_eq!(
        e.store().rows("notes").unwrap()[0].field("n").unwrap(),
        &Value::Int(7)
    );
}
#[test]
fn narrowed_same_count_corruption_refuses_sqlite() {
    narrowed_final_image(false)
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; narrowing transforms retain an exact expected image"]
fn narrowed_same_count_corruption_refuses_postgres() {
    narrowed_final_image(true)
}

#[cfg(feature = "postgres")]
fn large_verification_pages(path: &str) {
    let (s, p) = bound("table notes:\n  payload: text <=8388608\n  public\n  online only\n");
    let (st, _, _) = store(true);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    let result = crate::engine::postgres::movement::test_large_verification_pages(
        tx.test_postgres_tx(),
        path,
    );
    tx.rollback().unwrap();
    result.unwrap();
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; production SQL compares 64 toasted 8 MiB rows under 250 ms"]
fn activation_verification_large_population_pages_fit_statement_timeout() {
    large_verification_pages("population");
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; production cell verification uses the payload byte bound"]
fn activation_verification_large_cell_pages_fit_statement_timeout() {
    large_verification_pages("cells");
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; production narrowed verification uses the payload byte bound"]
fn activation_verification_large_narrowed_pages_fit_statement_timeout() {
    large_verification_pages("narrowed");
}

#[test]
fn sqlite_json_equality_decodes_keys_and_preserves_values() {
    let source = "table notes:\n  n: int\n  m: json <=500\n  public\n  online only\n";
    let (s, p) = bound(source);
    let (st, _, _) = store(false);
    let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
    let row = object([
        ("id", Value::Id("a".into())),
        ("n", Value::Int(7)),
        (
            "m",
            Value::Map(
                BTreeMap::from([
                    ("é".into(), Value::Int(7)),
                    ("word".into(), Value::String("Upper".into())),
                    (
                        "list".into(),
                        Value::Array(vec![Value::Int(1), Value::Int(2)]),
                    ),
                ])
                .into(),
            ),
        ),
    ]);
    e.seed_at([("notes".into(), row.clone())], 1000).unwrap();
    // Both object insertion order and an escaped Unicode key differ from
    // canonical_json. json_tree.fullkey by itself would compare unequal.
    let encoded = r#"{"Row":{"n":{"Int":7},"m":{"Map":{"\u00e9":{"Int":7},"word":{"String":"Upper"},"list":{"Array":[{"Int":1},{"Int":2}]}}},"id":{"Id":"a"}}}"#;
    let tx = e.store_mut().transaction().unwrap();
    tx.with_sqlite(|tx| -> Result<(), RuntimeError> {
        let t = tx.num("notes")?;
        tx.conn().execute(
            "UPDATE r SET data=?1 WHERE t=?2 AND id='a'",
            params![encoded, t],
        )?;
        super::super::movement::test_payload(tx, t, "a", &row)?;
        for bad in [
            encoded.replacen(r#""Int":7"#, r#""Int":8"#, 1),
            encoded.replace(r#"[{"Int":1},{"Int":2}]"#, r#"[{"Int":2},{"Int":1}]"#),
            encoded.replace("Upper", "upper"),
            "bad JSON".into(),
        ] {
            tx.conn().execute(
                "UPDATE r SET data=?1 WHERE t=?2 AND id='a'",
                params![bad, t],
            )?;
            mismatch(super::super::movement::test_payload(tx, t, "a", &row));
        }
        Ok(())
    })
    .unwrap();
    tx.rollback().unwrap();
}
