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
        let (st, _, _) = store(true);
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
    sql(
        &mut e,
        true,
        &format!(
            "CREATE FUNCTION audit_ff3() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN END $$; CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION audit_ff3(); ALTER EVENT TRIGGER {event} ENABLE ALWAYS; CREATE EVENT TRIGGER {disabled} ON sql_drop EXECUTE FUNCTION audit_ff3(); ALTER EVENT TRIGGER {disabled} DISABLE"
        ),
    );
    let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    let (tier, warnings) = AnyStore::postgres_diagnostics(&url, &name).unwrap();
    sql(
        &mut e,
        true,
        &format!("DROP EVENT TRIGGER {event}; DROP EVENT TRIGGER {disabled}"),
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
        lease.release().unwrap();
        assert_eq!(
            tier,
            "G6 zero-flight hits (read grant; clock bounds 1000,250)"
        );
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

fn restored_cells_verify_again_after_copy(pg: bool) {
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
        crate::engine::postgres::movement::fault::arm_late();
    } else {
        super::super::movement::fault::arm_late();
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
    restored_cells_verify_again_after_copy(false)
}
#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; destination loss after copy before retained-cell deletion"]
fn restoration_rechecks_destination_before_destroy_postgres() {
    restored_cells_verify_again_after_copy(true)
}
