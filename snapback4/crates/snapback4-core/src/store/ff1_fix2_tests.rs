//! Final FF1 admission regressions; real installers and rollback witnesses.
use super::*;

fn device_install(st: &mut Store, schema: &Schema, metadata: &BTreeMap<String,String>) {
    st.install_device_checked_with(schema, metadata, false, &BTreeMap::new(), |tx| tx.initialize_device_storage(metadata)).unwrap();
}

#[test]
fn device_residency_reopen_doctor_and_activation() {
    for legacy in [false, true] {
        let (s,_) = bound("table notes:\n  n: int\n  public\n");
        let dir=std::env::temp_dir().join(format!("ff1f2_device_{:x}",crate::ids::seed()));
        let path=dir.join("store.sqlite");
        let metadata=BTreeMap::from([("device:backend".into(),"backend-v1".into())]);
        let mut st=Store::open(&path).unwrap();
        device_install(&mut st,&s,&metadata);
        if legacy {
            st.conn().execute_batch("DROP TRIGGER _device_residency_insert; DROP TRIGGER _device_residency_delete; DROP TRIGGER _device_residency_update; DROP TABLE _device_residency;").unwrap();
        }
        drop(st); // quit; all later checks use a reopened file
        let mut st=Store::open(&path).unwrap();
        drop(Store::open_read_only(&path).unwrap()); // doctor's admission
        device_install(&mut st,&s,&metadata);
        device_install(&mut st,&s,&metadata); // admits legacy TEMP triggers too
        let namespace=if legacy {"temp"} else {"main"};
        assert_eq!(st.conn().query_row(&format!("SELECT count(*) FROM {namespace}.sqlite_master WHERE type='trigger' AND tbl_name='r'"),[],|r|r.get::<_,i64>(0)).unwrap(),3);
        assert!(crate::managed_relations::TABLES.contains(&"_device_residency"));
        for name in ["_device_residency_insert","_device_residency_delete","_device_residency_update"] {
            let definition:String=st.conn().query_row(&format!("SELECT sql FROM {namespace}.sqlite_master WHERE name=?1"),[name],|r|r.get(0)).unwrap();
            st.conn().execute_batch(&format!("DROP TRIGGER {namespace}.{name}; CREATE {}TRIGGER {name} BEFORE INSERT ON main.r BEGIN SELECT RAISE(IGNORE); END;",if legacy {"TEMP "} else {""})).unwrap();
            refused(st.install(&s));
            st.conn().execute_batch(&format!("DROP TRIGGER {namespace}.{name}; {}",if legacy {definition.replacen("CREATE TRIGGER","CREATE TEMP TRIGGER",1)} else {definition})).unwrap();
            st.install(&s).unwrap();
        }
        drop(st);std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn evaluation_tracker_activation_requires_exact_temp_definition() {
    let(s,_)=bound("table notes:\n  n: int\n  public\n");
    let mut st=Store::memory().unwrap();st.install(&s).unwrap();
    let _snapshot=super::super::evaluation::Snapshot::capture(&st,|where_,e|format!("{where_}: {e}")).unwrap();
    st.install(&s).unwrap();
    let name:String=st.conn().query_row("SELECT name FROM temp.sqlite_master WHERE type='trigger' AND tbl_name='r' LIMIT 1",[],|r|r.get(0)).unwrap();
    st.conn().execute_batch(&format!("DROP TRIGGER temp.{name}; CREATE TEMP TRIGGER {name} AFTER INSERT ON r BEGIN DELETE FROM r; END;")).unwrap();
    refused(st.install(&s));
}

#[cfg(feature="postgres")]
fn dormant_fixture() -> (Engine, Schema, Vec<Program>, String) {
    let source="table notes:\n  n: int\n  public\n  online only\n";
    let(s,p)=bound(source);let(st,_,name)=store(true);
    let mut e=Engine::new_release(st,s.clone(),p.clone(),1,None).unwrap();
    e.seed_at([("notes".into(),object([("id",Value::Id("a".into())),("n",Value::Int(7))]))],1000).unwrap();
    let(empty,programs)=bound("");
    e.adopt_release_at(empty,programs,&crate::engine::release::ReleaseActivation::new(2,Some(1)),false,1000).unwrap();
    (e,s,p,name)
}
#[cfg(feature="postgres")]
fn restore(e:&mut Engine,s:Schema,p:Vec<Program>) -> Result<u64,RuntimeError> {
    let mut release=crate::engine::release::ReleaseActivation::new(3,Some(2));release.restore_dormant=true;
    e.adopt_release_at(s,p,&release,false,1000)
}
#[cfg(feature="postgres")]
fn dormant_snapshot(e:&mut Engine) -> Vec<(String,String,String)> {
    let tx=e.store_mut().transaction().unwrap();
    let rows=tx.test_postgres_tx().query("SELECT t,id,data FROM _dormant_rows ORDER BY t,id",&[]).unwrap().iter().map(|r|(r.get(0),r.get(1),r.get(2))).collect();
    tx.rollback().unwrap();rows
}

#[cfg(feature="postgres")]
#[test] #[ignore="private PG16; privileged TEMP-view redirection regression"]
fn activation_temp_view_redirection_refuses_without_movement() {
    let (mut e,s,p,name)=dormant_fixture();
    let before=dormant_snapshot(&mut e);
    let generation=e.generation();
    let event=format!("ff3_view_{:x}",crate::ids::seed());
    sql(&mut e,true,&format!(r#"
      CREATE SEQUENCE movement_probe;
      CREATE FUNCTION erase_redirected() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('movement_probe'); DELETE FROM r WHERE t=NEW.t AND id=NEW.id; RETURN NEW; END $$;
      CREATE FUNCTION redirect_temp() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_schema()='{name}' AND to_regclass('pg_temp._evolution_restored') IS NOT NULL
        AND to_regclass('pg_temp.redirected_heap') IS NULL THEN
        ALTER TABLE pg_temp._evolution_restored RENAME TO redirected_heap;
        CREATE TEMP VIEW _evolution_restored AS SELECT * FROM pg_temp.redirected_heap;
        CREATE TRIGGER erase_redirected AFTER INSERT ON pg_temp.redirected_heap FOR EACH ROW EXECUTE FUNCTION erase_redirected();
      END IF; END $$;
      CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION redirect_temp();
    "#));
    let result=restore(&mut e,s,p);
    sql(&mut e,true,&format!("DROP EVENT TRIGGER {event}"));
    let tx=e.store_mut().transaction().unwrap();
    let advanced=tx.test_postgres_tx().query("SELECT is_called FROM movement_probe",&[]).unwrap()[0].get::<_,bool>(0);
    let live=tx.test_postgres_tx().query("SELECT count(*) FROM r WHERE t='notes'",&[]).unwrap()[0].get::<_,i64>(0);
    tx.rollback().unwrap();
    refused(result);
    assert!(!advanced,"redirection was used before admission");
    assert_eq!(live,0);
    assert_eq!(e.generation(),generation);
    assert_eq!(dormant_snapshot(&mut e),before);
}

#[cfg(feature="postgres")]
#[test] #[ignore="private PG16; scripts/test-postgres.sh"]
fn foreign_incoming_cascade_refused() {
    let(mut e,s,p,name)=dormant_fixture();let before=dormant_snapshot(&mut e);assert_eq!(before.len(),1);
    let generation=e.generation();
    sql(&mut e,true,"CREATE TABLE external(t text COLLATE \"C\",id text COLLATE \"C\",FOREIGN KEY(t,id) REFERENCES _dormant_rows(t,id) ON DELETE CASCADE); INSERT INTO external SELECT t,id FROM _dormant_rows; CREATE FUNCTION erase_restored() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM r WHERE t=OLD.t AND id=OLD.id; RETURN OLD; END $$; CREATE TRIGGER erase_restored AFTER DELETE ON external FOR EACH ROW EXECUTE FUNCTION erase_restored()");
    let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
    refused(AnyStore::open_postgres(&url,&name));
    refused(AnyStore::postgres_deployment(&url,&name));
    refused(restore(&mut e,s.clone(),p.clone()));
    assert_eq!(e.generation(),generation);assert_eq!(dormant_snapshot(&mut e),before);
    sql(&mut e,true,"DROP TABLE external");
    restore(&mut e,s,p).unwrap();assert_eq!(e.store().rows("notes").unwrap().len(),1);
}

#[cfg(feature="postgres")]
#[test] #[ignore="private PG16; scripts/test-postgres.sh"]
fn activation_event_trigger_effect_rolls_back_before_movement() {
    let(mut e,s,p,name)=dormant_fixture();let before=dormant_snapshot(&mut e);let generation=e.generation();
    let event=format!("ff1f2_event_{:x}",crate::ids::seed());
    // Database-wide event object is narrowly scoped to this fixture's schema.
    sql(&mut e,true,&format!("DROP INDEX _dormant_parent; CREATE SEQUENCE movement_probe; CREATE FUNCTION suppress_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('movement_probe'); RETURN NULL; END $$; CREATE FUNCTION install_suppressor() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF current_schema()='{name}' AND to_regclass('_dormant_parent') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='r'::regclass AND tgname='event_suppress') THEN CREATE TRIGGER event_suppress BEFORE INSERT ON r FOR EACH ROW EXECUTE FUNCTION suppress_restore(); END IF; END $$; CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION install_suppressor()"));
    let result=restore(&mut e,s.clone(),p.clone());
    // Always remove the database-wide hook, including on the negative control.
    sql(&mut e,true,&format!("DROP EVENT TRIGGER {event}"));
    refused(result);
    assert_eq!(e.generation(),generation);assert_eq!(dormant_snapshot(&mut e),before);
    let tx=e.store_mut().transaction().unwrap();
    let row=tx.test_postgres_tx().query("SELECT to_regclass('_dormant_parent') IS NULL,NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='r'::regclass AND tgname='event_suppress'),NOT EXISTS(SELECT 1 FROM r)",&[]).unwrap().remove(0);
    assert!(row.get::<_,bool>(0)&&row.get::<_,bool>(1)&&row.get::<_,bool>(2),"DDL and movement must both roll back");
    assert!(!tx.test_postgres_tx().query("SELECT is_called FROM movement_probe",&[]).unwrap()[0].get::<_,bool>(0), "admission must precede restoration, not merely undo it at commit");
    tx.rollback().unwrap();restore(&mut e,s,p).unwrap();assert_eq!(e.store().rows("notes").unwrap().len(),1);
}

#[cfg(feature="postgres")]
#[test] #[ignore="private PG16; scripts/test-postgres.sh"]
fn activation_final_admission_rolls_back_late_ddl() {
    let(s,p)=bound("table notes:\n  n: int\n  public\n  online only\n");let(st,_,_)=store(true);
    let mut e=Engine::new_at(st,s,p,1000).unwrap();let s=e.schema().clone();let programs=BTreeMap::new();
    let generation=e.generation();
    let result=e.store_mut().activate_at_with_launch(&s,Some(&programs),false,1000,true, |_|Ok(()), |_,_,_|Ok(()), |tx| {
        tx.test_postgres_tx().batch("INSERT INTO r(t,id,data) VALUES('notes','late','{}'); CREATE FUNCTION late_suppressor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER late_suppressor BEFORE DELETE ON r FOR EACH ROW EXECUTE FUNCTION late_suppressor()")?;
        Ok(())
    });
    refused(result);assert_eq!(e.generation(),generation);
    assert_eq!(e.store().count("notes").unwrap(),0);
}

#[cfg(feature="postgres")]
#[test] #[ignore="private PG16; scripts/test-postgres.sh"]
fn activation_benign_event_trigger_is_legal() {
    let(mut e,s,p,name)=dormant_fixture();
    let event=format!("ff1f2_benign_{:x}",crate::ids::seed());
    sql(&mut e,true,&format!("DROP INDEX _dormant_parent; CREATE TABLE ddl_audit(tag text); CREATE FUNCTION audit_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN IF current_schema()='{name}' THEN INSERT INTO ddl_audit VALUES(TG_TAG); END IF; END $$; CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION audit_ddl()"));
    let result=restore(&mut e,s,p);
    sql(&mut e,true,&format!("DROP EVENT TRIGGER {event}"));
    result.unwrap();assert_eq!(e.store().rows("notes").unwrap().len(),1);
    let tx=e.store_mut().transaction().unwrap();
    assert!(tx.test_postgres_tx().query("SELECT count(*) FROM ddl_audit",&[]).unwrap()[0].get::<_,i64>(0)>0);
    tx.rollback().unwrap();
}


#[test]
fn sqlite_identifier_case_cannot_hide_managed_trigger() {
    for temporary in [false, true] {
        let (s, _) = bound("table notes:\n  n: int\n  public\n");
        let mut st = Store::memory().unwrap();
        st.install(&s).unwrap();
        st.conn().execute_batch(&format!("ALTER TABLE r RENAME TO rename_step; ALTER TABLE rename_step RENAME TO R; CREATE {}TRIGGER hide_insert BEFORE INSERT ON R BEGIN SELECT RAISE(IGNORE); END",if temporary {"TEMP "} else {""})).unwrap();
        refused(st.install(&s));
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn activation_temp_event_trigger_refuses_before_restoration() {
    let (mut e, s, p, name) = dormant_fixture();
    let before = dormant_snapshot(&mut e);
    let generation = e.generation();
    let event = format!("ff2_temp_{:x}", crate::ids::seed());
    sql(
        &mut e,
        true,
        &format!(
            r#"CREATE SEQUENCE movement_probe;
      CREATE FUNCTION erase_temp_restore() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM nextval('movement_probe'); DELETE FROM r WHERE t=NEW.t AND id=NEW.id; RETURN NEW; END $$;
      CREATE FUNCTION intercept_temp() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_schema()='{name}' AND to_regclass('pg_temp._evolution_restored') IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('pg_temp._evolution_restored') AND tgname='erase_temp_restore') THEN
        CREATE TRIGGER erase_temp_restore AFTER INSERT ON pg_temp._evolution_restored FOR EACH ROW EXECUTE FUNCTION erase_temp_restore();
      END IF; END $$;
      CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION intercept_temp()"#
        ),
    );
    let result = restore(&mut e, s.clone(), p.clone());
    sql(&mut e, true, &format!("DROP EVENT TRIGGER {event}"));
    refused(result);
    assert_eq!(e.generation(), generation);
    assert_eq!(dormant_snapshot(&mut e), before);
    let tx = e.store_mut().transaction().unwrap();
    assert!(
        !tx.test_postgres_tx()
            .query("SELECT is_called FROM movement_probe", &[])
            .unwrap()[0]
            .get::<_, bool>(0),
        "TEMP interception must refuse before the first insert"
    );
    tx.rollback().unwrap();
    restore(&mut e, s, p).unwrap();
    assert_eq!(e.store().rows("notes").unwrap().len(), 1);
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn activation_precommit_checks_every_temp_authority_relation() {
    for table in ["_evolution_restored", "_adopt_groups", "_adopt_conflicts"] {
        let (s, p) = bound("table notes:\n  n: int\n  public\n  online only\n");
        let (st, _, _) = store(true);
        let mut e = Engine::new_at(st, s, p, 1000).unwrap();
        let s = e.schema().clone();
        let result=e.store_mut().activate_at_with_launch(&s,Some(&BTreeMap::new()),false,1000,true, |_|Ok(()), |_,_,_|Ok(()), |tx| {
            let tx=tx.test_postgres_tx();
            tx.batch(&format!("CREATE TEMP TABLE IF NOT EXISTS {table}(n bigint) ON COMMIT DROP; CREATE FUNCTION late_temp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER late_temp BEFORE INSERT ON pg_temp.{table} FOR EACH ROW EXECUTE FUNCTION late_temp()"))?;
            Ok(())
        });
        refused(result);
    }
}

#[cfg(feature = "postgres")]
#[test]
#[ignore = "private PG16; scripts/test-postgres.sh"]
fn activation_temp_group_tables_checked_before_first_use() {
    for table in ["_adopt_groups", "_adopt_conflicts"] {
        let source = "table notes:\n  n: int\n  public\n  online only\n";
        let (s, p) = bound(source);
        let (st, _, name) = store(true);
        let mut e = Engine::new_release(st, s, p, 1, None).unwrap();
        e.seed_at(
            ["a", "b"].map(|id| {
                (
                    "notes".into(),
                    object([("id", Value::Id(id.into())), ("n", Value::Int(7))]),
                )
            }),
            1000,
        )
        .unwrap();
        let event = format!("ff2_group_{:x}", crate::ids::seed());
        sql(
            &mut e,
            true,
            &format!(
                r#"CREATE SEQUENCE movement_probe;
          CREATE FUNCTION scratch_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('movement_probe'); RETURN NEW; END $$;
          CREATE FUNCTION intercept_group() RETURNS event_trigger LANGUAGE plpgsql AS $$
          BEGIN IF current_schema()='{name}' AND to_regclass('pg_temp.{table}') IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('pg_temp.{table}') AND tgname='scratch_probe') THEN
            CREATE TRIGGER scratch_probe AFTER INSERT ON pg_temp.{table} FOR EACH ROW EXECUTE FUNCTION scratch_probe();
          END IF; END $$;
          CREATE EVENT TRIGGER {event} ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION intercept_group()"#
            ),
        );
        let (s, p) = bound(&source.replace("  public", "  unique n\n  public"));
        let result = e.adopt_release_at(
            s,
            p,
            &crate::engine::release::ReleaseActivation::new(2, Some(1)),
            false,
            1000,
        );
        sql(&mut e, true, &format!("DROP EVENT TRIGGER {event}"));
        refused(result);
        assert_eq!(e.generation(), 1);
        assert_eq!(e.store().count("notes").unwrap(), 2);
        let tx = e.store_mut().transaction().unwrap();
        assert!(
            !tx.test_postgres_tx()
                .query("SELECT is_called FROM movement_probe", &[])
                .unwrap()[0]
                .get::<_, bool>(0),
            "scratch interception must refuse before use of {table}"
        );
        tx.rollback().unwrap();
    }
}
