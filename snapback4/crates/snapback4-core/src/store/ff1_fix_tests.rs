//! FF1 review regressions: interception and legal incomplete lifecycle heaps.
use super::*;
use crate::{Engine, Program, Rows, store_port::AnyStore, value::object};

fn bound(source: &str) -> (Schema, Vec<Program>) {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    (serde_json::from_value(serde_json::to_value(b.schema).unwrap()).unwrap(),
     b.programs.into_iter().map(|p|serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect())
}
fn store(pg: bool) -> (AnyStore, PathBuf, String) {
    let name = format!("sb4_ff1f1_{:x}", crate::ids::seed());
    let dir = std::env::temp_dir().join(&name);
    if pg {
        #[cfg(feature="postgres")]
        { return (AnyStore::create_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(), &name).unwrap(), dir, name); }
        #[cfg(not(feature="postgres"))]
        panic!("postgres feature");
    }
    (AnyStore::open(&dir.join("store.sqlite")).unwrap(), dir, name)
}
fn sql(e: &mut Engine, pg: bool, statement: &str) {
    let tx=e.store_mut().transaction().unwrap();
    if pg {
        #[cfg(feature="postgres")]
        tx.test_postgres_tx().batch(statement).unwrap();
    } else {tx.test_support_conn().execute_batch(statement).unwrap();}
    tx.commit().unwrap();
}
fn refused<T>(result: Result<T,RuntimeError>) {
    let error=result.err().expect("foreign interception must refuse");
    assert_eq!(error.code(),"E_STORE");
    assert!(error.to_string().contains("SNAPBACK_MANAGED_RELATION_INTERCEPTION"),"{error}");
}
fn interception(pg: bool) {
    let source="table notes:\n  n: int\n  public\n  online only\n";
    let (s,p)=bound(source);
    let (st,dir,name)=store(pg);
    let mut e=Engine::new_release(st,s.clone(),p.clone(),1,None).unwrap();
    let generation=e.generation();
    let relations = {
        let tx=e.store_mut().transaction().unwrap();
        let mut names: Vec<String>=Vec::new();
        if pg {
            #[cfg(feature="postgres")]
            {for row in tx.test_postgres_tx().query("SELECT relname::text FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relkind='r' ORDER BY relname",&[]).unwrap() {names.push(row.get::<_,String>(0));}}
        } else {
            names=tx.test_support_conn().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
        }
        tx.rollback().unwrap(); names
    };
    assert!(relations.len()>20);
    eprintln!("managed interception pg={pg}: {} installed relations",relations.len());
    for relation in &relations {
        assert!(crate::managed_relations::TABLES.contains(&relation.as_str()),"unlisted managed table {relation}");
        let install=if pg {format!("CREATE OR REPLACE FUNCTION ff1_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$; CREATE TRIGGER ff1_suppress BEFORE DELETE ON {relation} FOR EACH ROW EXECUTE FUNCTION ff1_suppress()")}
            else {format!("CREATE TRIGGER ff1_suppress BEFORE DELETE ON {relation} BEGIN SELECT RAISE(IGNORE); END")};
        sql(&mut e,pg,&install);
        refused(e.adopt_at(s.clone(),p.clone(),1000));
        assert_eq!(e.generation(),generation);
        if pg {
            #[cfg(feature="postgres")]
            {
                let url=std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
                refused(AnyStore::open_postgres(&url,&name));
                refused(AnyStore::postgres_deployment(&url,&name)); // doctor uses this read-only probe
            }
        } else {
            refused(Store::open(&dir.join("store.sqlite")));
            refused(Store::open_read_only(&dir.join("store.sqlite"))); // doctor
        }
        sql(&mut e,pg,&if pg {format!("DROP TRIGGER ff1_suppress ON {relation}")} else {"DROP TRIGGER ff1_suppress".into()});
    }
    if pg {
        for relation in ["r","i","_log","_commits","_cap_counts","_sequences","_dormant_values","_ops"] {
            for (install,remove) in [
                (format!("CREATE RULE ff1_rule AS ON DELETE TO {relation} DO INSTEAD NOTHING"), format!("DROP RULE ff1_rule ON {relation}")),
                (format!("ALTER TABLE {relation} ENABLE ROW LEVEL SECURITY"),format!("ALTER TABLE {relation} DISABLE ROW LEVEL SECURITY")),
            ] {
                sql(&mut e,true,&install);
                refused(e.adopt_at(s.clone(),p.clone(),1000));
                #[cfg(feature="postgres")]
                refused(AnyStore::open_postgres(&std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap(),&name));
                sql(&mut e,true,&remove);
            }
        }
    } else {
        // A familiar name cannot allow a replacement guard with arbitrary SQL.
        let guard=format!("_index_keys_insert_{}",crate::rows::MAX_INDEX_KEY_BYTES);
        sql(&mut e,false,&format!("DROP TRIGGER {guard}; CREATE TRIGGER {guard} BEFORE INSERT ON i BEGIN SELECT RAISE(IGNORE); END"));
        refused(e.adopt_at(s.clone(),p.clone(),1000));
        sql(&mut e,false,&format!("DROP TRIGGER {guard}"));
    }
    e.adopt_at(s,p,1000).unwrap();
    drop(e);
    if !pg {std::fs::remove_dir_all(dir).unwrap();}
}

fn manual_restoration(pg: bool) {
    let parent="table parents:\n  owner: principal\n  read <- .owner = viewer\n  update <- allow\n  online only\n";
    let child="table children:\n  parent: parents\n  owner: principal\n  immutable parent\n  by byOwner: owner, id\n  cap 2 by parent\n  read through live .parent\n  online only\n";
    let (s,p)=bound(&format!("{parent}{child}"));
    let (st,dir,_)=store(pg);
    let mut e=Engine::new_release(st,s,p,1,None).unwrap();
    e.seed_at([("parents".into(),object([("id",Value::Id("p".into())),("owner",Value::Id("alice".into()))])),
        ("children".into(),object([("id",Value::Id("c".into())),("parent",Value::Id("p".into())),("owner",Value::Id("alice".into()))]))],1000).unwrap();
    let (s,p)=bound(parent);e.adopt_release_at(s,p,&crate::engine::release::ReleaseActivation::new(2,Some(1)),false,1000).unwrap();
    let table=e.schema().tables["parents"].clone();
    let tx=e.store_mut().transaction().unwrap();let old=tx.get("parents","p").unwrap().unwrap();
    let new=object([("id",Value::Id("p".into())),("owner",Value::Id("bob".into()))]);
    tx.put("parents",&table,&new,Some(&old)).unwrap();tx.commit().unwrap();
    let manual=child.replace("read through live .parent","read <- .owner = viewer");
    let (s,p)=bound(&format!("{parent}{manual}"));
    let mut options=crate::engine::release::ReleaseActivation::new(3,Some(2)); options.restore_dormant=true;
    e.adopt_release_at(s,p,&options,false,1000).unwrap();
    let row=&e.store().rows("children").unwrap()[0];
    assert_eq!(row.field("owner").unwrap(),&Value::Id("bob".into()));
    let tx=e.store_mut().transaction().unwrap();
    assert!(tx.lookup("children","byOwner",&manual_index(), &[Value::Id("bob".into()),Value::Id("c".into())]).unwrap().is_some());
    tx.rollback().unwrap();drop(e);if !pg {std::fs::remove_dir_all(dir).unwrap();}
}
fn manual_index() -> Index { bound("table children:\n  owner: principal\n  by byOwner: owner, id\n  public\n").0.tables["children"].indexes["byOwner"].clone() }

fn unindexed_retirement(pg: bool) {
    // The retained definition has no expiry; the immediate predecessor later
    // acquires one while the row stays narrowed. Restoring the old image can
    // insert it without indexes before predecessor-authority retirement.
    let wide="table notes:\n  n: int\n  until: time\n  public\n  online only\n";
    let (s,p)=bound(wide);let(st,dir,_)=store(pg);
    let mut e=Engine::new_release(st,s,p,1,None).unwrap();
    e.seed_at([("notes".into(),object([("id",Value::Id("a".into())),("n",Value::Int(99)),("until",Value::Int(50))]))],0).unwrap();
    let narrow=wide.replace("n: int","n: int 0..10");
    let(s,p)=bound(&narrow);e.adopt_release_at(s,p,&crate::engine::release::ReleaseActivation::new(2,Some(1)),false,0).unwrap();
    assert_eq!(e.store().count("notes").unwrap(),0);
    let timed=narrow.replace("  public", "  expire at .until\n  public");
    let(s,p)=bound(&timed);e.adopt_release_at(s,p,&crate::engine::release::ReleaseActivation::new(3,Some(2)),false,0).unwrap();
    assert_eq!(e.store().count("notes").unwrap(),0);
    let(s,p)=bound(wide);e.adopt_release_at(s,p,&crate::engine::release::ReleaseActivation::new(4,Some(3)),false,1000).unwrap();
    assert_eq!(e.store().count("notes").unwrap(),0);
    let tx=e.store_mut().transaction().unwrap();
    assert_eq!(tx.test_support_conn().query_row("SELECT count(*) FROM _dormant_narrow_rows",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    tx.rollback().unwrap();drop(e);if !pg {std::fs::remove_dir_all(dir).unwrap();}
}
macro_rules! both {
    ($sql:ident,$pg:ident,$run:ident) => {
        #[test] fn $sql() {$run(false)}
        #[cfg(feature="postgres")]
        #[test] #[ignore="private PG16; scripts/test-postgres.sh"] fn $pg() {$run(true)}
    }
}
both!(managed_interception_sqlite,managed_interception_postgres,interception);
#[test] fn legal_manual_restoration_sqlite() {manual_restoration(false)}
#[test] fn legal_unindexed_retirement_sqlite() {unindexed_retirement(false)}

// The PG public profile excludes live-authority/backfill evolution. Exercise
// their shared physical phase inside a real activation without widening it.
#[cfg(feature="postgres")]
#[test]
#[ignore="private PG16; scripts/test-postgres.sh"]
fn legal_unindexed_lifecycle_phases_postgres() {
    let parent="table parents:\n  owner: principal\n  read <- .owner = viewer\n  online only\n";
    let live="table children:\n  parent: parents\n  owner: principal\n  immutable parent\n  cap 2 by parent\n  by byOwner: owner, id\n  read through live .parent\n  online only\n";
    let manual=live.replace("read through live .parent","read <- .owner = viewer");
    let (next,p)=bound(&format!("{parent}{manual}"));
    let (old,_)=bound(&format!("{parent}{live}"));
    let (st,_,_)=store(true);
    let mut e=Engine::new_at(st,next,p,1000).unwrap();
    e.seed_at([("parents".into(),object([("id",Value::Id("p".into())),("owner",Value::Id("bob".into()))]))],1000).unwrap();
    let next=e.schema().clone();
    let programs=BTreeMap::new();
    let row=object([("id",Value::Id("c".into())),("parent",Value::Id("p".into())),("owner",Value::Id("alice".into()))]);
    e.store_mut().activate_at_with_launch(&next,Some(&programs),false,1000,true, |_|Ok(()), |tx,_,_| {
        let inner=tx.test_postgres_tx();
        inner.execute("INSERT INTO r(t,id,data) VALUES('children','c',$1)",&[&canonical_json(&row)])?;
        crate::engine::through_activation::reconcile_manual(inner,&next,&old.tables,1000)?;
        // The lifecycle's candidate rebuild installs the complete final heap.
        inner.execute("DELETE FROM i WHERE t='children'",&[])?;
        let row=tx.get("children","c")?.unwrap();
        for (name,index) in &next.tables["children"].indexes {
            for key in stored_index_keys(&next.tables["children"],index,&row,"c") {
                inner.execute("INSERT INTO i(t,ix,k,id) VALUES('children',$1,$2,'c')",&[name,&key])?;
            }
        }
        Ok(())
    }, |_|Ok(())).unwrap();
    assert_eq!(e.store().rows("children").unwrap()[0].field("owner").unwrap(),&Value::Id("bob".into()));

    let source="table notes:\n  n: int\n  until: time\n  expire at .until\n  public\n  online only\n";
    let (old,_)=bound(source);
    let (next,p)=bound(&source.replace("  expire at .until\n", ""));
    let (st,_,_)=store(true);
    let mut e=Engine::new_at(st,next,p,1000).unwrap();
    let next=e.schema().clone();
    let row=object([("id",Value::Id("a".into())),("n",Value::Int(99)),("until",Value::Int(50))]);
    e.store_mut().activate_at_with_launch(&next,Some(&programs),false,1000,true, |_|Ok(()), |tx,_,_| {
        // Same unindexed image exposed by restoration's prepass.
        tx.test_postgres_tx().execute("INSERT INTO r(t,id,data) VALUES('notes','a',$1)",&[&canonical_json(&row)])?;
        assert!(crate::engine::through_activation::Retirement::retires_image(&next.tables["notes"],&old.tables["notes"],&row,1000));
        tx.test_postgres_tx().delete("notes",&old.tables["notes"],&row)?;
        assert!(tx.get("notes","a")?.is_none());
        Ok(())
    }, |_|Ok(())).unwrap();
    assert_eq!(e.store().count("notes").unwrap(),0);
}

#[path = "ff1_fix2_tests.rs"]
mod fix2;

#[path="ff3_tests.rs"]
mod ff3;
