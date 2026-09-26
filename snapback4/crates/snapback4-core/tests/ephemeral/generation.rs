use super::*;
fn path()->std::path::PathBuf {
    let dir=std::env::temp_dir().join(format!("sb4-eph-{}-{}",std::process::id(),snapback4_core::ids::seed()));
    std::fs::create_dir_all(&dir).unwrap();dir.join("store.sqlite")
}
#[test]
fn adoption_fences_an_already_established_snapshot_and_rebinds_hub() {
    let path=path();let b=bind(SOURCE);let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();seed(&mut e);
    let hub=e.ephemeral_hub();let original=hub.snapshot().unwrap().version;
    let mut reader=e.reader().unwrap();
    let mut old_store=e.store().reader().unwrap();let tx=old_store.read_transaction().unwrap();
    let old_generation=tx.conn().query_row("SELECT CAST(value AS INTEGER) FROM _meta WHERE key='generation'",[],|r|r.get::<_,i64>(0)).unwrap() as u64;
    let identity=tx.conn().query_row("SELECT value FROM _meta WHERE key='store_id'",[],|r|r.get::<_,String>(0)).unwrap();
    let b=bind(&SOURCE.replace("ephemeral 4s","ephemeral 5s"));e.adopt_at(b.schema,b.programs.into_iter().map(|p|p.program),1100).unwrap();
    assert_ne!(hub.snapshot().unwrap().version.incarnation,original.incarnation);
    assert!(hub.lock().unwrap().bind(&identity,old_generation,reader.schema()).is_err());tx.rollback().unwrap();
    assert!(reader.mutate_ephemeral("setTyping",ctx("alice",1200,&args("r"))).is_err());
    e.mutate_ephemeral("setTyping",ctx("alice",1200,&args("r"))).unwrap();assert_eq!(page(&mut e,"bob",1201).next_expiry,Some(6200));
    drop(reader);drop(e);let _=std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn memory_mutation_does_not_need_sqlite_writer_lock_and_restart_is_empty() {
    let path=path();let b=bind(SOURCE);let mut e=Engine::new(Store::open(&path).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();seed(&mut e);
    let mut reader=e.reader().unwrap();let incarnation=e.ephemeral_hub().snapshot().unwrap().version.incarnation;
    let tx=e.store_mut().transaction().unwrap();
    let now=std::time::Instant::now();reader.mutate_ephemeral("setTyping",ctx("alice",1000,&args("r"))).unwrap();
    assert!(now.elapsed()<std::time::Duration::from_millis(250));tx.rollback().unwrap();
    assert_eq!(page(&mut e,"bob",1001).data.as_array().unwrap().len(),1);
    drop(reader);drop(e);let mut restarted=Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_ne!(restarted.ephemeral_hub().snapshot().unwrap().version.incarnation,incarnation);
    assert_eq!(page(&mut restarted,"bob",1001).data,Value::Array(vec![]));
    drop(restarted);let _=std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn ring_filters_interests_and_overflow_covers_the_interest() {
    let mut e=engine(SOURCE);seed(&mut e);
    for n in 0..260 {e.mutate_ephemeral("setTyping",ctx("alice",1000+n,&args("r"))).unwrap();}
    let snapshot=e.ephemeral_hub().snapshot().unwrap();let id=snapshot.version.incarnation.as_str();
    assert_eq!(snapshot.changed(259,Some(id),None),vec!["typing"]);
    assert!(snapshot.changed(259,Some(id),Some(&["viewing".into()].into())).is_empty());
    assert_eq!(snapshot.changed(0,Some(id),Some(&["typing".into()].into())),vec!["typing"]);
}
